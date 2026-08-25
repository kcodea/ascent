import { useEffect, useState, type ReactNode } from 'react';
import './styles.css'; // ensure the boot loading screen is styled even before <Game/> mounts
import { preloadAllArt, ART_COUNT } from './art';

/**
 * Boot gate: holds a loading screen up front while EVERY bundled art file is fetched + decoded, so the game
 * never renders a card before its illustration is ready — no pop-in (the owner would rather wait a beat at boot
 * than see art appear late in the shop). Children (the actual <Game/>) don't mount until art is ready, so no
 * card can render early. A hard cap resolves the gate anyway if preloading stalls (offline / a broken CDN), so
 * boot can never hang. The loader runs on EVERY load (no skip flag) — cheap when art is already HTTP-cached
 * (onload fires instantly), and it always re-verifies art is ready before a card can render.
 *
 * THE SPLASH ITSELF IS NOT RENDERED HERE (owner ask 2026-08-22: "an image that fades out after art is
 * loaded"). It lives in `apps/web/index.html` with inline CSS so it paints on the FIRST frame — a
 * React-rendered splash cannot appear until the ~3 MB bundle has parsed and mounted, which is precisely the
 * window it exists to cover. This component only drives it: progress while loading, then a fade-out.
 *
 * The fade is why children now mount BEFORE the splash leaves: the game renders underneath at full opacity
 * and the image dissolves off it. Swapping one for the other (the old behaviour) is what made it a cut.
 */
const HARD_CAP_MS = 20000;
/** The fake load duration (owner ask 2026-08-24): the splash is held up for at least this long so the progress
 *  bar always runs its full course, even when art is already HTTP-cached and the real preload is instant. The
 *  bar fills over 3s (index.html) and this 3.5s hold leaves it sitting full for ~0.5s before the dissolve. */
const MIN_SPLASH_MS = 3500;
/** Must match the `#bootsplash` opacity transition in index.html (900ms — the owner asked for a gentle
 *  dissolve into the menu rather than a quick wipe). */
const FADE_MS = 900;
/** Must match `#bootsplash-img`'s fade-IN in index.html. The out-fade never begins before this has run its
 *  course, so the art is always fully present before it starts dissolving. */
const FADE_IN_MS = 700;

/** Progress + teardown for the document-level splash. No-ops when it is absent (tests, Storybook, the
 *  desktop shell loading a different host page) — never assume the node is there. */
function splashEl(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById('bootsplash');
}
export function Boot({ children }: { children: ReactNode }): React.ReactElement {
  const [ready, setReady] = useState<boolean>(() => ART_COUNT === 0);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (ready) return;
    // NB: no cross-run guard — under StrictMode the effect runs twice, and the first run's cleanup flips its
    // `alive` to false; a ref guard would block the second run from re-wiring state and deadlock the loader.
    // Letting it run again is harmless (images are already HTTP-cached from the first pass).
    let alive = true;
    const finish = (): void => {
      if (!alive) return;
      setReady(true);
    };
    const cap = window.setTimeout(finish, HARD_CAP_MS); // never hang the boot
    // Gate on BOTH the real art preload (no card renders before its art is decoded — no pop-in) AND the fixed
    // MIN_SPLASH_MS, so the fake 3.5s bar always completes even when art is warm-cached and preload is instant.
    const artReady = preloadAllArt((loaded, total) => { if (alive) setPct(total ? loaded / total : 1); });
    const minHold = new Promise<void>((res) => window.setTimeout(res, MIN_SPLASH_MS));
    void Promise.all([artReady, minHold]).then(() => {
      window.clearTimeout(cap);
      finish();
    });
    return () => { alive = false; window.clearTimeout(cap); };
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
    // The bar has already filled on its own 3s CSS transition (and sat full for ~0.5s) — nothing to finish here.
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
          <div className="bootload-bar"><div className="bootload-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          <div className="bootload-sub">Loading art… {Math.round(pct * 100)}%</div>
        </div>
      )}
      {/* Landscape-only on phones: CSS shows this only on a touch device held in portrait (see `.rotate-prompt`). */}
      <div className="rotate-prompt" role="alertdialog" aria-label="Rotate your device">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="7" y="3" width="10" height="18" rx="2.2" />
          <path d="M11 5.5h2" />
        </svg>
        <div className="rotate-prompt-t">Rotate your device</div>
        <div className="rotate-prompt-s">ASCENT plays in landscape — turn your phone sideways to play.</div>
      </div>
    </>
  );
}
