import { useEffect, useState, type ReactNode } from 'react';
import './styles.css'; // ensure the boot loading screen is styled even before <Game/> mounts
import { preloadAllArt, ART_COUNT } from './art';

/**
 * Boot gate: holds a loading screen up front while EVERY bundled art file is fetched + decoded, so the game
 * never renders a card before its illustration is ready — no pop-in (the owner would rather wait a beat at boot
 * than see art appear late in the shop). Children (the actual <Game/>) don't mount until art is ready, so no
 * card can render early. A hard cap resolves the gate anyway if preloading stalls (offline / a broken CDN), so
 * boot can never hang. A `sessionStorage` flag skips the wait on in-session reloads (art is already HTTP-cached).
 */
const SKIP_KEY = 'ascent.artWarmed';
const HARD_CAP_MS = 20000;

export function Boot({ children }: { children: ReactNode }): React.ReactElement {
  const [ready, setReady] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SKIP_KEY) === '1' || ART_COUNT === 0; } catch { return ART_COUNT === 0; }
  });
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (ready) return;
    // NB: no cross-run guard — under StrictMode the effect runs twice, and the first run's cleanup flips its
    // `alive` to false; a ref guard would block the second run from re-wiring state and deadlock the loader.
    // Letting it run again is harmless (images are already HTTP-cached from the first pass).
    let alive = true;
    const finish = (): void => {
      if (!alive) return;
      try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ }
      setReady(true);
    };
    const cap = window.setTimeout(finish, HARD_CAP_MS); // never hang the boot
    void preloadAllArt((loaded, total) => { if (alive) setPct(total ? loaded / total : 1); }).then(() => {
      window.clearTimeout(cap);
      finish();
    });
    return () => { alive = false; window.clearTimeout(cap); };
  }, [ready]);

  if (ready) return <>{children}</>;

  return (
    <div className="bootload" aria-live="polite" aria-busy="true">
      <div className="bootload-mark">ASCENT</div>
      <div className="bootload-bar"><div className="bootload-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
      <div className="bootload-sub">Loading art… {Math.round(pct * 100)}%</div>
    </div>
  );
}
