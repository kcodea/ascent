/**
 * A TOP-NAV MOVE, as one crossfade (party home prototype; owner 2026-11-04: "extremely fluid and clean"). The browser's view
 * transition holds a snapshot of the old page over the new one and fades it out on the compositor, so there is never an
 * empty frame of bare backdrop, and the swap itself stays synchronous. A new press skips any fade still running, so mashing
 * cannot stack, and the snapshot layer takes no pointer events (kit.css), so a press lands at once. No API (or reduced
 * motion): the swap just happens.
 */
import { flushSync } from 'react-dom';

interface SwapTransition { ready: Promise<unknown>; finished: Promise<unknown>; updateCallbackDone: Promise<unknown> }
type WithTransition = Document & { startViewTransition?: (update: () => void) => SwapTransition };

export function phSwap(run: () => void): void {
  const doc = document as WithTransition;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || calm) { run(); return; }
  const t = doc.startViewTransition(() => { flushSync(run); });
  // A skipped fade (the next press) rejects these: expected, never an error.
  const quiet = (): void => undefined;
  t.ready.catch(quiet); t.finished.catch(quiet); t.updateCallbackDone.catch(quiet);
}
