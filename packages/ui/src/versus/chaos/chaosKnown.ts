/**
 * WHAT FAILS ON `main` TODAY, per matrix cell (`scenario/mode`) and invariant, with the cause (the
 * chore/versus-reliability-audit finding it traces to). `versusChaos.db.test.ts` passes a cell only when its violations
 * are exactly these: a fix that removes one fails the cell with "fixed: ... delete its KNOWN entry", so the fix branch
 * deletes the entry (or narrows its `cells`) in its own PR. Filled from a full-matrix run (CHAOS_FULL=1).
 */
import type { InvariantId } from './chaosMatch';

interface KnownFailure {
  /** Cells it applies to (`scenario/mode`, regex). */
  cells: RegExp;
  invariant: InvariantId;
  cause: string;
}

const REALTIME_REUSE = 'Realtime channel reuse on match start: `subscribe()` closes the room channel (`removeChannel` is async: '
  + 'the channel stays registered while LEAVING) and asks for the same topic at once; realtime-js hands back the leaving channel, '
  + 'its `.subscribe()` is a no-op, and the leave ack tears it down. The whole match then runs on the 4 s heartbeat.';
const DUPLICATE_RESOLVER = 'Duplicate resolver calls: when the round closes on its clock (or on a slow / failing resolver), two clients '
  + 'own reconciles both see `resolving` and both call the resolver (`onOwnAnswer` -> `kickFinalize`), or the 4 s backstop '
  + 'overlaps a slow first call.';
const SLOW_RESUME = 'The returning player pause lifts by itself now (fix/versus-server-reliability, #2362), but about 7 s after they are back, not within '
  + '4 s (the resume waits on the next lease check and the 3-2-1).';

export const KNOWN: KnownFailure[] = [
  // Every cell where Realtime is up (the realtimeDown scenario kills it on purpose, so it has nothing to lose).
  { cells: /^(?!realtimeDown\/)/, invariant: 'realtime', cause: REALTIME_REUSE },
  { cells: /^timer\/(group3|group4|duos|ranked_duos)$|^background6min\/(group3|group4|duos|ranked_duos)$|^dropShort\/ranked_duos$|^resolverFail3\/(group4|duos)$|^resolverSlow\//, invariant: 'oneCall', cause: DUPLICATE_RESOLVER },
  { cells: /^(dropRestore|dropInFight)\/(duel|group3|group4|duos)$/, invariant: 'pauseLift', cause: SLOW_RESUME },
];

/** The known failures of one cell, invariant -> cause. */
export function knownFor(cell: string): Partial<Record<InvariantId, string>> {
  const out: Partial<Record<InvariantId, string>> = {};
  for (const k of KNOWN) if (k.cells.test(cell)) out[k.invariant] = k.cause;
  return out;
}
