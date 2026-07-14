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
 */
const HARD_CAP_MS = 20000;

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
    void preloadAllArt((loaded, total) => { if (alive) setPct(total ? loaded / total : 1); }).then(() => {
      window.clearTimeout(cap);
      finish();
    });
    return () => { alive = false; window.clearTimeout(cap); };
  }, [ready]);

  return (
    <>
      {ready ? (
        children
      ) : (
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
