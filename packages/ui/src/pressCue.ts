/**
 * PRESS CUES — the shop buttons' own press visuals, replayable without the press (Versus spectating, owner 2026-10-14:
 * a spectator sees the SAME animation the player saw). Each button keeps its press visual in one function and plays it
 * both on its own click and when a cue for it is emitted here; the action itself is never part of the cue.
 */
export type PressCue = 'refresh' | 'freeze' | 'upgrade' | 'heroPower' | 'endTurn' | 'endCombat' | 'skipCombat';

const subs = new Map<PressCue, Set<() => void>>();

/** Subscribe a button's press visual. Returns the unsubscribe (a `useEffect` cleanup). */
export function onPressCue(kind: PressCue, play: () => void): () => void {
  let set = subs.get(kind);
  if (!set) { set = new Set(); subs.set(kind, set); }
  set.add(play);
  return () => { set!.delete(play); };
}

/** Play every mounted button's press visual for `kind` (a no-op when none is on screen). */
export function emitPressCue(kind: PressCue): void {
  for (const play of subs.get(kind) ?? []) {
    try { play(); } catch { /* a visual must never break the caller */ }
  }
}
