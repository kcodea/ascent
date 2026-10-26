/**
 * THE FX LEDGER (R-PHONE-PERFLOG-01, owner 2026-10-26: "Lots of animations aren't showing on phone").
 *
 * Every effect the game ASKS for, against the ones that actually STARTED, and for the rest the reason they did not:
 * no committed def, no renderer yet, the WebGL context lost, the budget deduped it, a phone gate, the renderer not
 * ready, an anchor off the screen. "Not showing" then has a number and a reason in the phone perf log
 * (phonePerfLog.ts) instead of a guess.
 *
 * Also the registry of live Pixi Applications (every Pixi app the UI makes passes through `followStage`, which
 * registers it here), so the log can say how many renderers exist, at what size and resolution, and which lost their
 * context.
 *
 * Cost: when the log is off (desktop without `?perflog=1`) every entry point is one constant check and returns. When on,
 * a Map increment per effect request (effects, never frames). Dependency-free apart from the flag, so the FX modules can
 * import it without a cycle.
 */
import { PERF_LOG_ON } from './perfLogFlag';

/** What happened to one request. `started` = it is drawing; every other value is a reason it is not (or not fully). */
export type FxOutcome =
  | 'started'
  /** Played, but on a renderer whose WebGL context is lost: it draws nothing. */
  | 'ctx-lost'
  /** No committed def by that id (an authoring miss). */
  | 'no-def'
  /** The canvas it needs is not up (the main overlay missing, or an aux slot that failed to come up). */
  | 'no-renderer'
  /** An aux canvas was still coming up: the play waits for it (counted again as started or failed when it lands). */
  | 'waiting'
  /** Every layer muted or empty. */
  | 'empty'
  /** The budget deduped / declined it (the same moment already playing on its key). */
  | 'budget'
  /** Played with fewer particles (a budget thin). A degrade, not a drop. */
  | 'thinned'
  /** A hand-written effect called before its controller had a renderer / textures. */
  | 'not-ready'
  /** `canPlayDefs()` said no: the caller skipped (or fell back). */
  | 'defs-unavailable'
  /** Skipped on purpose on a phone (a phone-only gate). */
  | 'phone-gate'
  /** Played on a cheaper path (a degrade, not a drop). */
  | 'degraded'
  /** Every anchor was off the screen. Played, but nothing visible. */
  | 'offscreen'
  /** The phone `nofx` diagnostics switch is on. */
  | 'nofx';

export interface FxLedgerRow { req: number; out: Partial<Record<FxOutcome, number>> }

/** How many distinct effect kinds the ledger keeps (a runaway id cannot grow it without bound). */
const MAX_KINDS = 300;

const rows = new Map<string, FxLedgerRow>();
let overflow = 0;

/** True when the ledger records (the perf log is on). */
export const FX_LEDGER_ON: boolean = PERF_LOG_ON;

function row(kind: string): FxLedgerRow | null {
  let r = rows.get(kind);
  if (!r) {
    if (rows.size >= MAX_KINDS) { overflow++; return null; }
    r = { req: 0, out: {} };
    rows.set(kind, r);
  }
  return r;
}

/** One effect asked for. `kind` names it (`def:<id>`, `pixi:<method>`, `gate:land`). */
export function fxRequest(kind: string): void {
  if (!FX_LEDGER_ON) return;
  const r = row(kind);
  if (r) r.req++;
}

/** What became of it (call once per request; a degrade may be noted in addition to `started`). */
export function fxOutcome(kind: string, outcome: FxOutcome): void {
  if (!FX_LEDGER_ON) return;
  const r = row(kind);
  if (r) r.out[outcome] = (r.out[outcome] ?? 0) + 1;
}

/** A request and its outcome in one call. */
export function fxNote(kind: string, outcome: FxOutcome): void {
  if (!FX_LEDGER_ON) return;
  fxRequest(kind);
  fxOutcome(kind, outcome);
}

/** The ledger as it stands (a copy). */
export function fxLedgerSnapshot(): { rows: Record<string, FxLedgerRow>; overflow: number } {
  const out: Record<string, FxLedgerRow> = {};
  for (const [k, v] of rows) out[k] = { req: v.req, out: { ...v.out } };
  return { rows: out, overflow };
}

/** Pure: total requests and the outcome totals over every row. */
export function fxLedgerTotals(snap: Record<string, FxLedgerRow>): { req: number; out: Partial<Record<FxOutcome, number>> } {
  let req = 0;
  const out: Partial<Record<FxOutcome, number>> = {};
  for (const r of Object.values(snap)) {
    req += r.req;
    for (const [k, n] of Object.entries(r.out) as [FxOutcome, number][]) out[k] = (out[k] ?? 0) + n;
  }
  return { req, out };
}

/** Pure: the kinds that most often did NOT draw (every outcome but started / thinned / degraded / waiting), worst first. */
export function fxLedgerMisses(snap: Record<string, FxLedgerRow>, limit = 12): { kind: string; req: number; missed: number; why: string }[] {
  const DRAWN = new Set<FxOutcome>(['started', 'thinned', 'degraded', 'waiting']);
  const out: { kind: string; req: number; missed: number; why: string }[] = [];
  for (const [kind, r] of Object.entries(snap)) {
    let missed = 0;
    const why: string[] = [];
    for (const [k, n] of Object.entries(r.out) as [FxOutcome, number][]) {
      if (DRAWN.has(k) || !n) continue;
      missed += n;
      why.push(`${k} ${n}`);
    }
    if (missed > 0) out.push({ kind, req: r.req, missed, why: why.join(', ') });
  }
  return out.sort((a, b) => b.missed - a.missed).slice(0, limit);
}

/** TEST ONLY. */
export function resetFxLedger(): void { rows.clear(); overflow = 0; }

// ── Pixi Applications ────────────────────────────────────────────────────────────────────────────────────────────

/** The shape of a Pixi Application the registry reads (structural, so this module imports nothing from Pixi). */
export interface TrackedPixiApp {
  canvas?: HTMLCanvasElement;
  renderer?: { resolution?: number; width?: number; height?: number; screen?: { width: number; height: number }; gl?: { isContextLost?: () => boolean } } | null;
}

const apps: { app: TrackedPixiApp; label: string; made: number }[] = [];
let appsMade = 0;

/** Register a live Pixi Application (`followStage` does it for every one in the UI). */
export function trackPixiApp(app: TrackedPixiApp, label = ''): void {
  if (!FX_LEDGER_ON) return;
  appsMade++;
  apps.push({ app, label, made: typeof performance !== 'undefined' ? Math.round(performance.now()) : 0 });
  if (apps.length > 40) apps.splice(0, apps.length - 40);
}

/** True when this renderer's WebGL context is lost (a renderer without `gl`, WebGPU or none, is never "lost"). */
export function rendererContextLost(renderer: TrackedPixiApp['renderer'] | null | undefined): boolean {
  try { return renderer?.gl?.isContextLost?.() === true; } catch { return false; }
}

/** A canvas's name for the log: its own first class, or its host's when it carries only the generic `pixi-screen`. */
function canvasLabel(c: HTMLCanvasElement | undefined): string {
  if (!c) return 'app';
  const own = String(c.className || '').split(' ').filter((k) => k && k !== 'pixi-screen')[0];
  if (own) return own;
  const host = String(c.parentElement?.className || '').split(' ')[0];
  return host || (c.isConnected ? 'canvas' : 'detached');
}

export interface PixiAppInfo { label: string; w: number; h: number; res: number; bw: number; bh: number; lost: boolean; inPage: boolean }

/** Every Pixi Application still alive: its label (or canvas class), logical size, resolution, backing size, whether its
 *  context is lost and whether its canvas is in the page. Destroyed ones are dropped. */
export function pixiAppsSnapshot(): { made: number; alive: PixiAppInfo[] } {
  const alive: PixiAppInfo[] = [];
  for (let i = apps.length - 1; i >= 0; i--) {
    const { app, label } = apps[i]!;
    const r = app.renderer;
    if (!r) { apps.splice(i, 1); continue; } // destroyed: Pixi nulls the renderer
    const c = app.canvas;
    alive.unshift({
      label: label || canvasLabel(c),
      w: Math.round(r.screen?.width ?? 0), h: Math.round(r.screen?.height ?? 0),
      res: Math.round((r.resolution ?? 1) * 1000) / 1000,
      bw: c?.width ?? 0, bh: c?.height ?? 0,
      lost: rendererContextLost(r),
      inPage: !!c?.isConnected,
    });
  }
  return { made: appsMade, alive };
}

/**
 * Count every call of the named effect methods on a hand-written FX controller (pixiFx / discoverFx), with whether the
 * controller could draw it: `not-ready` (no renderer / textures yet), `ctx-lost`, or `started`. Installed only when the
 * ledger is on (the methods are left untouched otherwise). The original method always runs, unchanged.
 */
export function ledgerWrapMethods(
  obj: object, names: readonly string[], prefix: string,
  state: () => { ready: boolean; renderer: TrackedPixiApp['renderer'] | null },
): void {
  if (!FX_LEDGER_ON) return;
  const o = obj as Record<string, unknown>;
  for (const name of names) {
    const fn = o[name];
    if (typeof fn !== 'function') continue;
    const kind = `${prefix}:${name}`;
    o[name] = function (this: unknown, ...args: unknown[]) {
      try {
        const st = state();
        fxNote(kind, !st.ready ? 'not-ready' : rendererContextLost(st.renderer) ? 'ctx-lost' : 'started');
      } catch { /* the ledger never breaks an effect */ }
      return (fn as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}
