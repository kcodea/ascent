/**
 * Player copy for Versus errors on the party home and its pages (the store's own strings stay as they are for the shipped
 * Versus screens). One helper, so the home and the Versus page builder say the same thing.
 */
import { useEffect, useState } from 'react';
import { versusWorkerUrl } from '../versus/versusRemote';
import { useVersus } from '../versus/versusStore';

const PLAYER_COPY: Record<string, string> = {
  "This build's game server isn't deployed yet. Run the pack or select a local server.": 'Versus is offline right now. Try again soon.',
  'You are already in a room. Leave it first.': 'You are already in a Versus room. Return to it or leave it first.',
};

/** The store's Versus error, in plain player words (unknown errors pass through unchanged). */
export function playerVersusError(text: string | null | undefined): string | null {
  if (!text) return null;
  return PLAYER_COPY[text] ?? text;
}

/** How often the home re-checks a Versus server that did not answer, while a Versus tab stays open. */
const DOWN_RECHECK_MS = 60_000;
const PROBE_TIMEOUT_MS = 4000;

/**
 * IS THE VERSUS SERVER DOWN? One quiet `/health` read when a tab that needs it opens, so the home can say so BEFORE you
 * press START. Paused while the tab is hidden; a failure re-reads once a minute at most, and the moment the browser says
 * it is back online. Recovery clears a stale error.
 */
export function useVersusDown(active: boolean): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (!active) { setDown(false); return undefined; }
    let live = true;
    let timer = 0;
    const check = async (): Promise<void> => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      let ok = false;
      if (navigator.onLine !== false) {
        const ctl = new AbortController();
        const t = window.setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
        try { ok = (await fetch(`${versusWorkerUrl().replace(/\/$/, '')}/health`, { signal: ctl.signal })).ok; } catch { ok = false; } finally { window.clearTimeout(t); }
      }
      if (!live) return;
      setDown(!ok);
      if (ok) { if (useVersus.getState().error) useVersus.setState({ error: null }); return; }
      if (navigator.onLine !== false) timer = window.setTimeout(() => { void check(); }, DOWN_RECHECK_MS);
    };
    const again = (): void => { if (!document.hidden) void check(); };
    void check();
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => { live = false; window.clearTimeout(timer); window.removeEventListener('online', again); document.removeEventListener('visibilitychange', again); };
  }, [active]);
  return down;
}
