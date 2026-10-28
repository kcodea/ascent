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
  /** A race that happens on some runs only (the client's retry jitter): its absence does not fail the cell. */
  sometimes?: true;
}

// Fixed on main by #2362 (server reliability) + #2363 (client reliability), proven by this matrix on 2026-10-28:
// Realtime channel reuse on match start, duplicate resolver calls at 0:00 / on a slow or failing resolver, and the
// returning player's pause that never (then slowly) lifted. Add an entry here only for a failure that is real and known.
const SLOW_LIFT = 'The returning player pause lifts by itself, but about 4.9 s after they are back (Group of 4, Duos, and a '
  + 'drop during the fight in 1v1); the bar is 4 s with no press.';
const LATE_BACKSTOP = 'A second resolver call for a round already settled or being retried: with a 10 s resolver another '
  + 'client backstop still asks ~5 s after the first call committed; after a long hang (Group) or an injected 409 (Group of 4) '
  + 'two clients ask at once.';

export const KNOWN: KnownFailure[] = [
  { cells: /^dropRestore\/(group4|duos)$|^dropInFight\/(duel|group4|duos)$/, invariant: 'pauseLift', cause: SLOW_LIFT },
  { cells: /^resolverSlow\/|^hang\/(group3|group4)$|^resolver409\/group4$/, invariant: 'oneCall', cause: LATE_BACKSTOP },
];

/** The known failures of one cell, invariant -> cause. */
export function knownFor(cell: string): Partial<Record<InvariantId, { cause: string; sometimes: boolean }>> {
  const out: Partial<Record<InvariantId, { cause: string; sometimes: boolean }>> = {};
  for (const k of KNOWN) if (k.cells.test(cell)) out[k.invariant] = { cause: k.cause, sometimes: !!k.sometimes };
  return out;
}
