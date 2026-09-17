import type { BoardMinion, CombatResult, CombatSideState, CombatConfig } from '@game/core';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, TAG } from './state';
import { lossDamageCap } from './reducer';

/**
 * How many Monte Carlo runs back the pre-combat odds bar ("73% win / 4% draw / 23% loss").
 *
 * 200 rather than the original 1000 (owner call 2026-07-20): the display rounds to whole percent, and the 95%
 * confidence interval is +-3.1% at n=1000 vs +-3.5% at n=200 — invisible after rounding, for a 5x cost cut.
 *
 * DEFERRED off the End Turn click entirely (perf audit 2026-08-01, owner call): `faceOmen` stashes
 * `CombatResult.oddsInput` and the UI calls this in idle time after the combat transition. The probe reads its
 * own RNG tag (`TAG.ODDS`), consumes no game randomness, and feeds nothing but the bar — so WHERE it runs is
 * free to choose, and the answer is "not on the frame the player clicked".
 */
export const COMBAT_ODDS_SIMS = 200;

export type CombatOdds = NonNullable<CombatResult['odds']>;

export type CombatOddsInput = { player: BoardMinion[]; enemy: BoardMinion[]; playerState: CombatSideState; enemyState: CombatSideState; config: CombatConfig };

/**
 * A RESUMABLE odds probe (perf pass 2026-09-16, owner-approved as a mechanical cleanup).
 *
 * The one-shot `computeCombatOdds` ran all `COMBAT_ODDS_SIMS` sims as ONE synchronous block: ~7 ms at wave 2,
 * 30-44 ms by waves 9-14 (bigger boards → longer sims) — a measured long-task spike at every combat start,
 * because the rIC `timeout` fired mid-frame on a busy replay. This form runs `n` sims per `step` so the UI can
 * spread the work across idle slices and stop a slice when the deadline runs low.
 *
 * Byte-identical to the one-shot: sim `i` ALWAYS takes seed `mixSeed(seed, wave, TAG.ODDS, i)` no matter how
 * the steps are sliced, and the tallies fold in the same order — so `result()` after any slicing equals
 * `computeCombatOdds(input, seed, wave)` exactly (pinned in `odds.test.ts`).
 */
export interface OddsProbe {
  /** Run up to `n` more sims. Returns `true` once every sim has run (further calls are no-ops). */
  step(n: number): boolean;
  /** `true` once every sim has run. */
  done(): boolean;
  /** Sims run so far (0..COMBAT_ODDS_SIMS). */
  progress(): number;
  /** The odds over the sims run SO FAR — call once `done()` for the full-probe numbers. */
  result(): CombatOdds;
}

export function createOddsProbe(input: CombatOddsInput, seed: number, wave: number, sims = COMBAT_ODDS_SIMS): OddsProbe {
  let win = 0, draw = 0, lose = 0, lossDamageTotal = 0, i = 0;
  const cap = lossDamageCap(wave);
  const step = (n: number): boolean => {
    const end = Math.min(sims, i + Math.max(0, n));
    for (; i < end; i++) {
      const r = simulate(input.player, input.enemy, makeRng(mixSeed(seed, wave, TAG.ODDS, i)), CARD_INDEX, input.playerState, input.enemyState, input.config);
      if (r.result === 'win') win++;
      else if (r.result === 'draw') draw++;
      else { lose++; lossDamageTotal += Math.min(r.playerDamage, cap); } // round-capped, as a real loss would be
    }
    return i >= sims;
  };
  return {
    step,
    done: () => i >= sims,
    progress: () => i,
    result: () => {
      const n = Math.max(1, i);
      return { win: win / n, draw: draw / n, lose: lose / n, avgLossDamage: lose > 0 ? lossDamageTotal / lose : 0 };
    },
  };
}

/** Re-run the stashed matchup `COMBAT_ODDS_SIMS` times in one go. Pure + deterministic: same run seed and wave
 *  produce the identical numbers the old inline probe did (same `TAG.ODDS` stream, same round cap). The
 *  one-shot wrapper over `createOddsProbe` — tests and headless tools use this; the UI slices the probe. */
export function computeCombatOdds(input: CombatOddsInput, seed: number, wave: number): CombatOdds {
  const probe = createOddsProbe(input, seed, wave);
  probe.step(COMBAT_ODDS_SIMS);
  return probe.result();
}
