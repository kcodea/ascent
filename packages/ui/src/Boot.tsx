import { useEffect, useState, type ReactNode } from 'react';
import './styles.css'; // ensure the boot loading screen is styled even before <Game/> mounts
import { createPortal } from 'react-dom';
import type { SetId } from '@game/content';
import { preloadBootArt } from './preloadPlan';
import { setArtConcurrency, whenArtReady } from './artPreload';
import { useGame } from './store';

/**
 * THE LOADING GATE (owner 2026-09-30: "i think id rather load everything. i dont want blurry images, i wanna stop
 * pop in."). The splash stays up until every image a session on the live set can show is fetched AND decoded
 * (`preloadBootArt` returns that list, `whenArtReady` waits on it), and its bar is REAL progress: items decoded /
 * total. A slow line just waits longer; there is never a partial game. A returning visit reads everything from
 * the HTTP cache (`_headers`, 2026-09-29), so the gate is short. The splash replaced a fixed 3.5 s fake timer
 * (owner ask 2026-08-25), which this ask supersedes. Measured in docs/devlog/2026-09-30-art-loading-gate.md.
 *
 * THE SPLASH ITSELF IS NOT RENDERED HERE (owner ask 2026-08-22: "an image that fades out after art is
 * loaded"). It lives in `apps/web/index.html` with inline CSS so it paints on the FIRST frame — a
 * React-rendered splash cannot appear until the ~3 MB bundle has parsed and mounted, which is precisely the
 * window it exists to cover. This component only drives it: progress while loading, then a fade-out.
 *
 * The fade is why children now mount BEFORE the splash leaves: the game renders underneath at full opacity
 * and the image dissolves off it. Swapping one for the other (the old behaviour) is what made it a cut.
 */
/** Must match the `#bootsplash` opacity transition in index.html (900ms — the owner asked for a gentle
 *  dissolve into the menu rather than a quick wipe). */
const FADE_MS = 900;
/** Must match `#bootsplash-img`'s fade-IN in index.html. The out-fade never begins before this has run its
 *  course, so the art is always fully present before it starts dissolving. */
const FADE_IN_MS = 700;
/** Tasks in flight while the gate is up. Nothing is on screen to protect, so throughput is all that matters: a
 *  wider pipe hides per-request latency on a fast line (HTTP/2 multiplexes them; on HTTP/1.1 the browser caps a
 *  host at 6 anyway). Back to the pipe's normal 6 once the menu is up. */
const GATE_CONCURRENCY = 32;
const PLAY_CONCURRENCY = 6;

/** Progress + teardown for the document-level splash. No-ops when it is absent (tests, Storybook, the
 *  desktop shell loading a different host page) — never assume the node is there. */
function splashEl(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById('bootsplash');
}

/** The set of the saved run Continue would resume, when it is not a live set: the gate covers it too. */
function savedRunSets(): SetId[] {
  try {
    const saved = useGame.getState().savedRun;
    return saved?.setId ? [saved.setId] : [];
  } catch { return []; }
}

/**
 * Paint gate progress onto the splash bar: `transform: scaleX(p)` on the fill (compositor-only; index.html gives it
 * a short transform transition so steps glide) and a small count under it. Coalesced to one write per frame.
 */
function progressPainter(): (done: number, total: number) => void {
  let raf = 0;
  let last = { done: 0, total: 0 };
  const paint = (): void => {
    raf = 0;
    const el = splashEl();
    const p = last.total ? last.done / last.total : 1;
    const fill = el?.querySelector<HTMLElement>('#bootsplash-bar > i');
    if (fill) fill.style.transform = `scaleX(${p.toFixed(4)})`;
    const note = el?.querySelector<HTMLElement>('#bootsplash-note');
    if (note) note.textContent = last.total ? `Loading art ${last.done} / ${last.total}` : '';
    const fb = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.bootload-fill');
    if (fb) fb.style.transform = `scaleX(${p.toFixed(4)})`;
  };
  return (done, total) => {
    last = { done, total };
    if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(paint);
  };
}

export function Boot({ children }: { children: ReactNode }): React.ReactElement {
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    if (ready) return;
    // NB: no cross-run guard — under StrictMode the effect runs twice, and the first run's cleanup flips its
    // `alive` to false; a ref guard would block the second run from re-wiring state and deadlock the loader.
    // Running it again is harmless: `preloadBootArt` queues once and returns the same list, and `whenArtReady`
    // only listens.
    let alive = true;
    const gate = preloadBootArt(savedRunSets());
    setArtConcurrency(GATE_CONCURRENCY);
    const paint = progressPainter();
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    void whenArtReady(gate, paint).then(() => {
      setArtConcurrency(PLAY_CONCURRENCY);
      if (typeof window !== 'undefined') {
        // Read by the devlog's measuring script (and handy in a bug report): how long the gate held, for how many.
        (window as unknown as { __artGate?: unknown }).__artGate = { items: gate.length, ms: Math.round(performance.now() - t0) };
      }
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, [ready]);

  // READY → fade the splash off the mounted game, then remove the node.
  //
  // The removal is belt-and-braces: `transitionend` normally fires, but it does NOT when the element is
  // display:none'd, when the tab is backgrounded mid-fade, or under `prefers-reduced-motion` where the
  // transition is `none` and there is no event at all. A timer guarantees teardown in every one of those
  // cases; whichever lands first wins, and removing an already-removed node is a no-op.
  useEffect(() => {
    if (!ready) return;
    const el = splashEl();
    if (!el) return;
    // The bar is full: the gate only opens once every item has settled.
    // HOLD until the fade-IN has finished. With art HTTP-cached the gate can resolve in a few hundred ms —
    // well inside the 700ms in-fade — and cutting to the out-fade there would snatch a half-visible image
    // away. `inAt` is stamped by the inline reveal script; absent (image still loading) we wait the full
    // in-fade rather than guess.
    const inAt = Number(el.dataset.inAt ?? NaN);
    const elapsed = Number.isFinite(inAt) ? performance.now() - inAt : 0;
    const hold = Math.max(0, FADE_IN_MS - elapsed);
    // Then next frame, so the browser has painted the game underneath before the fade starts.
    let raf = 0;
    const start = window.setTimeout(() => { raf = requestAnimationFrame(() => el.classList.add('is-out')); }, hold);
    const drop = (): void => el.remove();
    el.addEventListener('transitionend', drop, { once: true });
    const t = window.setTimeout(drop, hold + FADE_MS + 250);
    return () => {
      window.clearTimeout(start); window.clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('transitionend', drop);
    };
  }, [ready]);

  // The FALLBACK loader renders only where the document splash is absent (a host page without it). With the
  // splash present this branch never runs — it would sit uselessly behind a full-bleed image.
  const useFallback = !ready && !splashEl();

  return (
    <>
      {ready ? children : null}
      {useFallback && (
        <div className="bootload" aria-live="polite" aria-busy="true">
          <div className="bootload-mark">ASCENT</div>
          <div className="bootload-bar"><div className="bootload-fill" /></div>
          <div className="bootload-sub">Loading…</div>
        </div>
      )}
      {/* Landscape-only on phones: CSS shows this only on a touch device held in portrait (see `.rotate-prompt`).
          Portalled to <body>, OUTSIDE the scaled stage (stage.ts): it is the one screen drawn in real device px,
          because a portrait phone would scale the 1920-wide stage down to a fifth. */}
      {typeof document !== 'undefined' && createPortal(
        <div className="rotate-prompt" role="alertdialog" aria-label="Rotate your device">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="7" y="3" width="10" height="18" rx="2.2" />
            <path d="M11 5.5h2" />
          </svg>
          <div className="rotate-prompt-t">Rotate your device</div>
          <div className="rotate-prompt-s">ASCENT plays in landscape. Turn your phone sideways to play.</div>
        </div>,
        document.body,
      )}
    </>
  );
}
