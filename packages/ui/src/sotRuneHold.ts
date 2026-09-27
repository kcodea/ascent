import { useSyncExternalStore } from 'react';

/**
 * THE START-OF-TURN RUNE HOLD (R-SOT-BEAT-01). A rune that pays out at Start of Turn bumps `runeProcs` inside
 * `resolveCombat`, under the return curtain, and the badge row bursts on any `runeProcs` rise — so the burst played
 * under the blue. The sim also counts those procs on `RunState.sotRuneProcs`; the badges subtract what is still HELD
 * (`sotRuneProcs` minus what the Shop's beat player has RELEASED here) so each Start-of-Turn proc bursts on its own
 * beat instead. Both counts rise in the same commit, so no frame ever sees the proc unheld.
 *
 * Keyed per run: a new run starts with nothing released. A beat that never plays (the Shop left mid-batch, a resumed
 * save) simply stays held forever, which only offsets a counter whose DELTAS are all that matter: no burst, no harm.
 */
let key = '';
let released: Readonly<Record<string, number>> = {};
const listeners = new Set<() => void>();

/** Release a beat's rune procs (fires the badge burst on the next render of the row). */
export function releaseSotRuneProcs(runKey: string, procs: Readonly<Record<string, number>> | undefined): void {
  if (!procs) return;
  const base = runKey === key ? released : {};
  const next: Record<string, number> = { ...base };
  for (const [id, n] of Object.entries(procs)) next[id] = (next[id] ?? 0) + n;
  key = runKey;
  released = next;
  listeners.forEach((l) => l());
}

/** Rune procs still held back for a run: the Start-of-Turn ones not yet released. Pure, for the badge row + tests. */
export function heldSotRuneProcs(runKey: string, sotRuneProcs: Readonly<Record<string, number>> | undefined, id: string, rel: Readonly<Record<string, number>> = runKey === key ? released : {}): number {
  return Math.max(0, (sotRuneProcs?.[id] ?? 0) - (rel[id] ?? 0));
}

const snapshot = (): Readonly<Record<string, number>> => released;
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The released map for `runKey` (re-renders the caller on each release). */
export function useSotRuneReleased(runKey: string): Readonly<Record<string, number>> {
  const r = useSyncExternalStore(subscribe, snapshot, snapshot);
  return runKey === key ? r : EMPTY;
}
const EMPTY: Readonly<Record<string, number>> = {};

/** The key a run's releases are filed under. */
export function sotRunKey(run: { seed: number; runId?: string }): string {
  return `${run.runId ?? ''}#${run.seed}`;
}
