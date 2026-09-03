import { useEffect, useState, type ReactNode } from 'react';
import './styles.css'; // ensure the boot loading screen is styled even before <Game/> mounts
import { runBootLoader } from './bootLoader';
import { unlockAudio } from './sfx';
import { PixiFxLayer } from './PixiFxLayer';

/**
 * Boot gate: a "Click to begin" splash, then a REAL loading bar over every asset the game will ever show or
 * play, and the menu only when all of it is resident (owner ruling 2026-09-03: "I'd rather wait two minutes
 * than experience pop-in hitches"). This reverses the 2026-08-25 fixed-3.5s splash — see `bootLoader.ts` for
 * the four stages and why each exists.
 *
 * THE SPLASH ITSELF IS NOT RENDERED HERE (owner ask 2026-08-22). It lives in `apps/web/index.html` with inline
 * CSS so it paints on the FIRST frame — a React-rendered splash cannot appear until the ~3 MB bundle has
 * parsed and mounted, which is precisely the window it exists to cover. This component only drives it:
 * the unlock, the progress (`--boot-p` on the splash node), then a fade-out.
 *
 * THE CLICK. Browsers refuse to create an audio context before a user gesture, so the audio stage cannot
 * start until the player clicks. Everything else (images, fonts, the FX warm-up) starts the instant this
 * mounts. A click made before the bundle finished parsing is honoured too: the inline script stamps
 * `data-unlockedAt`, and Chromium's user activation is sticky for the document, so `unlockAudio()` from this
 * effect still gets a running context.
 *
 * THE FX CANVAS is mounted HERE, permanently, so its GL context exists before the loader warms it — and is
 * never detached afterwards (a detach throws every compiled program away with the context). It used to mount
 * from the hero picker onward (Game.tsx); its ticker auto-idles, so an unused canvas costs no per-frame work.
 */
/** Minimum splash lifetime measured from the unlock click, so a warm load never snaps the menu open. */
const SPLASH_MIN_MS = 3500;
/** THE BAR IS TWO HALVES (owner ask 2026-09-03: "I still want the loading bar to be smooth"). The first half
 *  is REAL progress — the loader's weighted mean mapped onto 0..0.5, so it can stall or jump as the network
 *  does. The second half is a SMOOTH glide from 0.5 to 1 over `FINISH_MS`, started only once every stage has
 *  settled; the menu opens when the glide lands. Real work is never hidden (the gate still waits for all of it),
 *  the last stretch just always reads as one clean fill. */
const REAL_HALF = 0.5;
const FINISH_MS = 1500;
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

/** DEV-only escape hatch for iterating on the game itself (`?skipboot`): the full warm-up is ~1000 images +
 *  every clip on every reload. Never honoured in a production build. */
function skipBootRequested(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('skipboot');
}

export function Boot({ children }: { children: ReactNode }): React.ReactElement {
  const [ready, setReady] = useState<boolean>(() => skipBootRequested());
  const [pct, setPct] = useState(0);
  const [unlockedUi, setUnlockedUi] = useState(false);

  useEffect(() => {
    if (ready) return;
    // NB: no cross-run guard — under StrictMode the effect runs twice, and the first run's cleanup flips its
    // `alive` to false; a ref guard would block the second run from re-wiring state and deadlock the loader.
    // Letting it run again is harmless (every stage is idempotent: images are HTTP-cached, clips de-duplicate
    // in flight, the FX warm-up is memoised per context).
    let alive = true;
    const el = splashEl();
    let clickAt = Number(el?.dataset.unlockedAt ?? NaN);

    const unlocked = new Promise<void>((resolve) => {
      const onUnlock = (): void => {
        window.removeEventListener('pointerdown', onUnlock);
        window.removeEventListener('keydown', onUnlock);
        if (!Number.isFinite(clickAt)) clickAt = performance.now();
        unlockAudio(); // inside the gesture, so the context starts running
        el?.classList.add('is-unlocked');
        if (alive) setUnlockedUi(true);
        resolve();
      };
      if (Number.isFinite(clickAt)) { onUnlock(); return; }
      window.addEventListener('pointerdown', onUnlock);
      window.addEventListener('keydown', onUnlock);
    });

    const onProgress = (p: number): void => {
      if (!alive) return;
      const shown = Math.min(REAL_HALF, p * REAL_HALF); // real work owns the first half of the bar
      el?.style.setProperty('--boot-p', shown.toFixed(4));
      setPct(shown);
    };

    let hold = 0;
    let finish = 0;
    void runBootLoader({ unlocked, onProgress }).then(async (report) => {
      if (import.meta.env.DEV) console.info('[boot] loaded in %d ms', report.ms, report.stages);
      await unlocked;
      if (!alive) return;
      // Everything is resident. Respect the minimum splash time first, THEN glide the second half of the bar
      // (`.is-finishing` lengthens the fill transition to FINISH_MS in index.html), and open the gate as it lands.
      const elapsed = performance.now() - clickAt;
      hold = window.setTimeout(() => {
        if (!alive) return;
        el?.classList.add('is-finishing');
        el?.style.setProperty('--boot-p', '1');
        setPct(1);
        finish = window.setTimeout(() => { if (alive) setReady(true); }, FINISH_MS);
      }, Math.max(0, SPLASH_MIN_MS - FINISH_MS - elapsed));
    });
    return () => { alive = false; window.clearTimeout(hold); window.clearTimeout(finish); };
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
    // HOLD until the fade-IN has finished (a skip-boot dev load can get here inside the 700ms in-fade, and
    // cutting to the out-fade there would snatch a half-visible image away).
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
      {/* The WebGL effects overlay — mounted for the whole session so the boot warm-up's compiled programs
          and uploaded textures survive into play. See the header. */}
      <PixiFxLayer />
      {ready ? children : null}
      {useFallback && (
        <div className="bootload" aria-live="polite" aria-busy="true">
          <div className="bootload-mark">ASCENT</div>
          <div className="bootload-bar"><div className="bootload-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          <div className="bootload-sub">{unlockedUi ? `Loading… ${Math.round(pct * 100)}%` : 'Click to begin'}</div>
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
