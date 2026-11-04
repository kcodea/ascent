/**
 * A TOP-NAV MOVE, as one crossfade (party home prototype; owner 2026-11-04: "extremely fluid and clean"). The browser's view
 * transition holds a snapshot of the old page over the new one and fades it out on the compositor, so there is never an
 * empty frame of bare backdrop, and the swap itself stays synchronous. A new press skips any fade still running, so mashing
 * cannot stack, and the snapshot layer takes no pointer events (kit.css), so a press lands at once. No API (or reduced
 * motion): the swap just happens.
 */
import { flushSync } from 'react-dom';

type WithTransition = Document & { startViewTransition?: (update: () => void) => unknown };

export function phSwap(run: () => void): void {
  const doc = document as WithTransition;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || calm) { run(); return; }
  doc.startViewTransition(() => { flushSync(run); });
}
