/**
 * WHAT FAILS ON THE CLOUDFLARE ROOM TODAY, per matrix cell (`scenario/mode`) and invariant, with the cause. The same
 * contract as the retired Supabase ledger had: `versusChaosCf.test.ts` passes a cell only when its violations are
 * exactly these, so a fix fails its cell with "fixed: ... delete its KNOWN entry" and the fix PR edits this file.
 * Filled from a full-matrix run (CHAOS_FULL=1).
 */
import type { InvariantId } from './chaosMatch';

interface KnownFailure {
  /** Cells it applies to (`scenario/mode`, regex). */
  cells: RegExp;
  invariant: InvariantId;
  cause: string;
  /** A race that happens on some runs only: its absence does not fail the cell. */
  sometimes?: true;
}

export const KNOWN_CF: KnownFailure[] = [];

/** The known failures of one cell, invariant -> cause. */
export function knownForCf(cell: string): Partial<Record<InvariantId, { cause: string; sometimes: boolean }>> {
  const out: Partial<Record<InvariantId, { cause: string; sometimes: boolean }>> = {};
  for (const k of KNOWN_CF) if (k.cells.test(cell)) out[k.invariant] = { cause: k.cause, sometimes: !!k.sometimes };
  return out;
}
