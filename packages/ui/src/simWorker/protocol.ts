/**
 * THE WIRE FORMAT OF THE SIM WORKER (perf pass 2026-11-18, R-PERF-SIM-WORKER-01).
 *
 * Everything here is plain data (structured-clone safe). The card index, the effect factories and the strength
 * reference are NOT posted: the worker imports them itself, from the same modules the main thread uses.
 */
import type { BoardSnapshot, CombatOdds, CombatOddsInput, StrengthScore } from '@game/sim';

/** One odds probe: `createOddsProbe(input, seed, wave, sims, cap)`, run to the end. */
export interface OddsRequest { input: CombatOddsInput; seed: number; wave: number; sims: number; cap: number }

export type SimWorkerRequest =
  | { t: 'hello' }
  /** Load the strength reference now (its own chunk), so the first board is scored without waiting on it. */
  | { t: 'warm' }
  | ({ t: 'odds'; id: number } & OddsRequest)
  | { t: 'strength'; id: number; board: BoardSnapshot; atRound?: number }
  | { t: 'cancel'; id: number };

export type SimWorkerReply =
  | { t: 'ready' }
  | { t: 'odds'; id: number; odds: CombatOdds }
  | { t: 'progress'; id: number; done: number; total: number }
  | { t: 'strength'; id: number; score: StrengthScore | null; total: number }
  /** This one job failed (a sim threw). The worker itself is fine. */
  | { t: 'error'; id: number; message: string };
