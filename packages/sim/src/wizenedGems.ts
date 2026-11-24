import { advanceWizenedGems, WIZENED_GEMS } from '@game/core';
import { improveRubies, mintRubies } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, type RunState } from './state';

/** A payout is running: a cast it sets off does not count (the combat half's `wizenedPaying`). */
let paying = false;

/**
 * WIZENED GEMS (Set 2 + 3 Basic rune, owner design 2026-11-23, R-WIZENED-1123-01), the Shop half: "When you cast 3 Shop
 * spells, improve your Rubies by +1/+1 and get a Ruby." Called the moment a Shop spell is cast, at the two Shop
 * chokepoints: `noteSpellCast` (an R-SHOPSPELL-01 spell from hand, a rune, a minion, an Equipment, Start or End of Turn,
 * each repetition) and `countRubyAsShopSpell` (a Ruby the Spellstone makes count). The combat half is
 * `wizenedGemsCombat` (simulate.ts); the run's ONE count (`runeWizenedGemsTick`) crosses phases and turns.
 *
 * Per copy held, one trip improves the run's Rubies +1/+1 first (Rubies in hand grow too), then mints a Ruby at that
 * strength. A full hand loses the Ruby and keeps the improvement (the Ruby mint's normal hand cap).
 */
export function wizenedGemsOnCast(state: RunState, casts: number): void {
  if (!state.questFlags?.runeWizenedGems || paying || casts <= 0) return;
  const step = advanceWizenedGems(state.runeWizenedGemsTick, casts);
  state.runeWizenedGemsTick = step.tick;
  if (step.trips <= 0) return;
  const n = runeStacksOf(state, 'rune_wizened_gems');
  paying = true;
  try {
    for (let i = 0; i < step.trips; i++) {
      procRuneId(state, 'rune_wizened_gems');
      improveRubies(state, WIZENED_GEMS.attack * n, WIZENED_GEMS.health * n);
      mintRubies(state, n);
    }
  } finally { paying = false; }
}
