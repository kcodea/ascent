/**
 * VERSUS FLOW TIMING (owner 2026-10-26: "there's a ton of hang time when time hits 0 / when both players ready up, id
 * like to make that more seamless"; R-DUOS-FLOW-01). A tiny per-round timeline of the moments between the last End Turn
 * and the fight on screen, so the hang can be measured on a real build instead of guessed:
 *
 *   ready:sent      my End Turn's lock left this client
 *   closed:seen     this client learned the round closed (`resolving`, or straight to `combat`)
 *   finalize:start  this client asked the resolver to settle the round (only the client that closed it, or a backstop)
 *   finalize:done   the resolver answered
 *   combat:seen     this client read the committed round (`combat`) with its fight
 *   endturn:fired   the real End Turn started on screen (End of Turn effects, then the fight)
 *   fight:on        the fight screen is up (`run.phase === 'combat'`)
 *
 * Each mark is kept once per (match, round), first time only, in `performance.now()` ms. Pure bookkeeping: no network,
 * no rendering, a Map write per mark (a handful per round). Read through `window.__bench` on a bench build
 * (`versusFlowTimings()`), and by the unit tests.
 */
export type FlowMark = 'ready:sent' | 'closed:seen' | 'finalize:start' | 'finalize:done' | 'combat:seen' | 'endturn:fired' | 'fight:on';

const KEEP = 24;
const rounds = new Map<string, Partial<Record<FlowMark, number>>>();

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Record `mark` for (match, round), the first time only. */
export function markFlow(matchId: string | null | undefined, round: number, mark: FlowMark, at = now()): void {
  if (!matchId || !(round > 0)) return;
  const key = `${matchId}|${round}`;
  let row = rounds.get(key);
  if (!row) {
    row = {};
    rounds.set(key, row);
    if (rounds.size > KEEP) rounds.delete(rounds.keys().next().value as string);
  }
  if (row[mark] === undefined) row[mark] = at;
}

/** Every recorded round, oldest first, as ms offsets from its earliest mark (plus the raw marks). */
export function versusFlowTimings(): { key: string; marks: Partial<Record<FlowMark, number>>; offsets: Partial<Record<FlowMark, number>> }[] {
  return [...rounds.entries()].map(([key, marks]) => {
    const t0 = Math.min(...Object.values(marks));
    const offsets: Partial<Record<FlowMark, number>> = {};
    for (const [k, v] of Object.entries(marks) as [FlowMark, number][]) offsets[k] = Math.round(v - t0);
    return { key, marks: { ...marks }, offsets };
  });
}

/** Tests: forget everything. */
export function resetFlowTimings(): void {
  rounds.clear();
}
