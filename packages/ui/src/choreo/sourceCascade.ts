import { revealedForShown } from '../fx/statHold';

/**
 * SOURCE CASCADE — when several minions fire the same kind of authored buff effect in one beat, they fire one
 * after another, LEFT-MOST FIRST, instead of all at once (owner ask 2026-09-24, two King Oonas: *"i would love
 * it if we could have the left-most oona fire first, then the next oona fires 200 ms later, and so on"*;
 * the gap went to 400 ms, then back to 200 ms).
 *
 * Pure: the caller supplies each source's on-screen x (so the order is what the player SEES, on either side of
 * the board) and which casts take part. Returns each participating source's rank — 0 fires immediately, rank
 * `k` fires `k * SOURCE_CASCADE_MS` later. Every cast from one source shares its rank, so a minion buffing
 * several units still fires at all of them together (a def's own per-recipient `stagger` still applies).
 */
export const SOURCE_CASCADE_MS = 200; // owner: 200 → 400 (2026-09-24) → back to 200 (2026-09-25)

export function sourceCascadeRanks<C extends { source: string }>(
  casts: readonly C[],
  xOf: (uid: string) => number | null,
  takesPart: (c: C) => boolean,
): Map<string, number> {
  const seen: { uid: string; x: number | null; order: number }[] = [];
  for (const c of casts) {
    if (!takesPart(c) || seen.some((s) => s.uid === c.source)) continue;
    seen.push({ uid: c.source, x: xOf(c.source), order: seen.length });
  }
  // Left to right by screen x. A source with no measurable position keeps its log order, after the measured ones.
  seen.sort((a, b) => (a.x === null ? 1 : 0) - (b.x === null ? 1 : 0) || (a.x ?? 0) - (b.x ?? 0) || a.order - b.order);
  return new Map(seen.map((s, i) => [s.uid, i]));
}

/** One segment of a stepped stat reveal: at `atMs` (after the batch fires), roll the hold's reveal `from → to`. */
export interface RevealStep { atMs: number; from: number; to: number }

/**
 * THE NUMBER WAITS FOR THE BANANA, one doubling at a time (owner 2026-09-24: *"have the number doubling wait
 * until it is struck by the banana, and have each doubling happen one at a time"*).
 *
 * `increments` are the unit's gains from each fire IN LOG ORDER (the order the simulator applied them — the
 * second Oona doubles what the first already doubled), and `strikeAtMs` is when each fire's effect lands, in
 * any order. The k-th strike in TIME reveals the k-th gain in LOG order, so the badge walks through every value
 * the unit really had, whichever source happened to be drawn first. Each step's `to` is the reveal point at
 * which the badge shows the cumulative gain so far (`revealedForShown`); the last one lands exactly on 1.
 * A batch with no net gain is one step at the first strike.
 */
export function steppedRevealPlan(increments: readonly number[], strikeAtMs: readonly number[]): RevealStep[] {
  const times = [...strikeAtMs].sort((x, y) => x - y);
  const n = Math.min(increments.length, times.length);
  if (n === 0) return [];
  const total = increments.slice(0, n).reduce((t, v) => t + v, 0);
  if (!(total > 0)) return [{ atMs: times[0]!, from: 0, to: 1 }];
  const steps: RevealStep[] = [];
  let cum = 0;
  let from = 0;
  for (let k = 0; k < n; k++) {
    cum += increments[k]!;
    const to = k === n - 1 ? 1 : revealedForShown(cum / total);
    steps.push({ atMs: times[k]!, from, to });
    from = to;
  }
  return steps;
}
