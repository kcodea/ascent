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

/** Re-run the stashed matchup `COMBAT_ODDS_SIMS` times. Pure + deterministic: same run seed and wave produce
 *  the identical numbers the old inline probe did (same `TAG.ODDS` stream, same round cap). */
export function computeCombatOdds(
  input: { player: BoardMinion[]; enemy: BoardMinion[]; playerState: CombatSideState; enemyState: CombatSideState; config: CombatConfig },
  seed: number,
  wave: number,
): CombatOdds {
  let win = 0, draw = 0, lose = 0, lossDamageTotal = 0;
  const cap = lossDamageCap(wave);
  for (let i = 0; i < COMBAT_ODDS_SIMS; i++) {
    const r = simulate(input.player, input.enemy, makeRng(mixSeed(seed, wave, TAG.ODDS, i)), CARD_INDEX, input.playerState, input.enemyState, input.config);
    if (r.result === 'win') win++;
    else if (r.result === 'draw') draw++;
    else { lose++; lossDamageTotal += Math.min(r.playerDamage, cap); } // round-capped, as a real loss would be
  }
  return { win: win / COMBAT_ODDS_SIMS, draw: draw / COMBAT_ODDS_SIMS, lose: lose / COMBAT_ODDS_SIMS, avgLossDamage: lose > 0 ? lossDamageTotal / lose : 0 };
}
