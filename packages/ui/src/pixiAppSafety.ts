import { UPDATE_PRIORITY, type Application, type Ticker } from 'pixi.js';
import { perfMonitor } from './perfMonitor';

/**
 * PIXI APP SAFETY: the rules every ASCENT Pixi `Application` follows. They come from the owner's report
 * on 2026-10-10: *"sometimes i have an issue with like... my hero power or spell targeting animation completely
 * not loading, and neither will other pixi effects"*.
 *
 * ROOT CAUSE. Short-lived canvases (the hero ceremony, the crate opener, the hero-attack preview, and the board
 * overlay's own `detach`) tore their app down with `destroy({ releaseGlobalResources: true })`, or with
 * `destroy(true)`, which does the same thing. That calls Pixi's `GlobalResourceRegistry.release()`, which empties
 * Pixi's MODULE-GLOBAL pools: `TexturePool` (the filter render targets), `BigPool` and the batch pool. Those pools
 * are SHARED by every renderer on the page, so the LIVE board overlay was left holding pooled objects that had
 * just been destroyed under it. Its next filter pass (the spell-target aim line is filter-built) threw
 * `TypeError: Cannot read properties of null (reading '2')` in `FilterSystem._applyFiltersToTexture`.
 *
 * Pixi's `Ticker._tick` does not catch a listener's throw. It never requests the next animation frame, and it
 * leaves `started === true`, so every later `ticker.start()` does nothing. One throw stopped every Pixi effect on
 * that canvas for the rest of the session. That is the owner's symptom exactly: the aim line was the first to
 * go, and nothing came back.
 *
 * THE RULES:
 *  1. Destroy through `destroyPixiApp`. It never releases the global pools, because some other renderer is
 *     always still using them. Pixi still loses the WebGL context on destroy, so the live context count stays
 *     bounded either way.
 *  2. `guardAppRender` wraps the app's own render listener, so a render throw is counted and reported instead of
 *     stopping the ticker.
 *  3. `reviveTicker` restarts a ticker found in the dead state (`started` with no frame requested), as a backstop.
 *  4. `watchContextLoss` counts WebGL context losses. Pixi restores the context itself (`GlContextSystem`), but a
 *     loss is now visible in the console and in the perf HUD (`fx:ctx lost`).
 *
 * Every caught fault increments `fx:faults` on the perf monitor and logs `[pixi fault]`, so a future
 * "the FX stopped" report carries the evidence in the owner's capture.
 */

let faults = 0;
let contextLosses = 0;
let contextRecoveries = 0;
const loggedPerSite = new Map<string, number>();
let countersRegistered = false;
/** Canvases torn down on purpose: their destroy-time context loss is not counted. */
const tornDown = new WeakSet<object>();

function ensureCounters(): void {
  if (countersRegistered) return;
  countersRegistered = true;
  perfMonitor.registerCounter('fx:faults', () => faults);
  perfMonitor.registerCounter('fx:ctx lost', () => contextLosses);
  perfMonitor.registerCounter('fx:ctx rebuilt', () => contextRecoveries);
}

/** Count and log a caught FX fault. A site logs its first 5 faults, then every 100th, so a fault that repeats
 *  every frame cannot flood the console. */
export function reportFxFault(site: string, e: unknown): void {
  ensureCounters();
  faults++;
  const n = (loggedPerSite.get(site) ?? 0) + 1;
  loggedPerSite.set(site, n);
  if (n <= 5 || n % 100 === 0) console.error(`[pixi fault] ${site} threw (x${n}); the FX layer keeps running:`, e);
}

/** Totals since load. Tests and the DEV console read these. */
export function fxFaultStats(): { faults: number; contextLosses: number } {
  return { faults, contextLosses };
}

/** TEST ONLY: zero the counters. */
export function resetFxFaultStats(): void {
  faults = 0;
  contextLosses = 0;
  loggedPerSite.clear();
}

/** Tear down an `Application` WITHOUT releasing Pixi's shared global pools. See rule 1 above. */
export function destroyPixiApp(app: Application, options: { children?: boolean; texture?: boolean } = { children: true }): void {
  const canvas = app.canvas as HTMLCanvasElement | undefined;
  if (canvas) tornDown.add(canvas); // Pixi loses the context on destroy on purpose; that is not a fault
  app.destroy({ removeView: true, releaseGlobalResources: false }, options);
}

/**
 * Replace the app's own render listener (`TickerPlugin` adds `app.render` at `UPDATE_PRIORITY.LOW`) with a
 * guarded one at the same priority. One try/catch per frame. The listener order around it does not change.
 */
export function guardAppRender(app: Application, site: string): void {
  const ticker = app.ticker as Ticker | undefined;
  if (!ticker) return;
  ticker.remove(app.render, app);
  ticker.add(() => {
    try { app.render(); } catch (e) { reportFxFault(`${site}:render`, e); }
  }, undefined, UPDATE_PRIORITY.LOW);
}

/** True when the ticker is in Pixi's dead state: `started`, with listeners, but no animation frame requested. */
export function isTickerStalled(ticker: Ticker): boolean {
  const t = ticker as unknown as { started: boolean; _requestId: number | null; _head?: { next: unknown } };
  return t.started && t._requestId === null && !!t._head?.next;
}

/**
 * Start the ticker. If it is in the dead state, stop it first so `start()` really requests a frame again.
 *
 * The dead state is decided AFTER the current callback, never inside it (mobile perf pass, 2026-10-18). Pixi's
 * `_tick` clears `_requestId` before it runs the listeners and requests the next frame only once they have all
 * returned, so a call from INSIDE a listener (an FX play retiring on its last frame and waking the controller,
 * the everyday path) looked exactly like the dead state. It was reported as a fault (`[pixi fault] ...
 * ticker-stalled`, a `console.error` with a stack, several per session), and the ticker was stopped and
 * restarted in the middle of its own update. A microtask runs once `_tick` has returned: by then a live ticker
 * has requested its frame, and only a ticker that is really dead (a listener threw) is revived.
 */
export function reviveTicker(ticker: Ticker, site: string): void {
  if (!isTickerStalled(ticker)) {
    ticker.start();
    return;
  }
  queueMicrotask(() => {
    if (!isTickerStalled(ticker)) return;
    reportFxFault(`${site}:ticker-stalled`, new Error('ticker was started but had no frame requested; restarted'));
    ticker.stop();
    ticker.start();
  });
}

/** How long a lost context may stay lost (while the page is visible) before the owner rebuilds it anyway. */
export const CONTEXT_RECOVER_MS = 2500;

/**
 * Count WebGL context losses on this app's canvas, and RECOVER from them (R-PHONE-FX-CTX-01, owner 2026-10-26 on his
 * iPhone: "Lots of animations aren't showing on phone").
 *
 * Pixi restores a lost context itself (`GlContextSystem`), but a restore only brings back what has a CPU-side source.
 * Every texture made with `renderer.generateTexture` (the FX controllers' spark / glow / shard textures, the def
 * shapes in `fx/shapeTextures.ts`, the wipe and gate textures) lived only on the GPU and comes back EMPTY: measured in
 * Chromium as an iPhone, a particle burst after a lose + restore drew only its ring, every spark and glow gone, for the
 * rest of the session. iOS loses contexts under GPU memory pressure and when a Home Screen app goes to the background.
 *
 * So `onRecover` (when given) runs ONCE per loss: on the restore, or, when the context is still lost
 * `CONTEXT_RECOVER_MS` after the loss while the page is visible (the browser may never restore it), then. The owner
 * rebuilds its Application there (a new context, fresh textures, the warm-up again). A teardown's own loss is never
 * counted or recovered (`destroyPixiApp`).
 */
export function watchContextLoss(app: Application, site: string, onRecover?: () => void): void {
  const canvas = app.canvas as HTMLCanvasElement | undefined;
  if (!canvas || typeof canvas.addEventListener !== 'function') return;
  ensureCounters();
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recover = (why: string): void => {
    if (!pending || tornDown.has(canvas)) return;
    pending = false;
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    contextRecoveries++;
    console.warn(`[pixi fault] ${site}: rebuilding after a WebGL context loss (${why})`);
    try { onRecover?.(); } catch (e) { reportFxFault(`${site}:recover`, e); }
  };
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // wait for visible
      recover('still lost');
    }, CONTEXT_RECOVER_MS);
  };
  const onVisible = (): void => { if (pending && document.visibilityState === 'visible') arm(); };
  canvas.addEventListener('webglcontextlost', () => {
    if (tornDown.has(canvas)) return;
    contextLosses++;
    console.warn(`[pixi fault] ${site}: WebGL context lost (x${contextLosses} this session)${onRecover ? '; it will be rebuilt' : '; Pixi will restore it'}`);
    if (!onRecover || pending) return;
    pending = true;
    arm();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (tornDown.has(canvas)) return;
    console.warn(`[pixi fault] ${site}: WebGL context restored`);
    // Off the event: Pixi's own restore handler runs first, then the owner rebuilds.
    if (onRecover) setTimeout(() => recover('restored'), 0);
  });
}

/** Rebuilds after a context loss since load (the perf log and tests read it). */
export function contextRecoveryCount(): number { return contextRecoveries; }
