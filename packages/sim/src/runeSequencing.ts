import { CARD_INDEX } from '@game/content';
import { advanceSequence } from '@game/core';
import { conjureToHand, mintRubies } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, runeGrantOverflow, type RunState } from './state';

/**
 * RUNE OF SEQUENCING (Set 2 Epic Dragon rune, owner design 2026-11-14) — the Shop half. "When you cast 3 different
 * spells, get a copy of the first one."
 *
 * Called from `noteSpellForCountRunes`, the Shop's every-spell chokepoint: a Shop spell, a Discover spell, a Whisper, a
 * Ruby cast from hand, and every rune / minion / End of Turn cast reach it once per resolution. The rule itself is
 * core's `advanceSequence`, which combat's `spellResolved` hook calls too, so the ONE sequence on the run
 * (`RunState.runeSequence`) continues across the Shop, End of Turn and combat.
 *
 * The payout is a copy of the sequence's FIRST spell, one per copy of the rune held (the meter family's "doubled payoff
 * per trip"), under the normal hand cap: a Ruby through the Ruby mint (the run's current line), anything else through
 * the shared conjure.
 */
export function sequencingOnCast(state: RunState, spellId: string): void {
  if (!state.questFlags?.runeSequencing) return;
  const step = advanceSequence(state.runeSequence, CARD_INDEX[spellId]);
  if (!step) return;
  state.runeSequence = step.seq;
  if (!step.pay) return;
  const def = CARD_INDEX[step.pay];
  if (!def) return;
  procRuneId(state, 'rune_sequencing');
  const n = runeStacksOf(state, 'rune_sequencing');
  if (def.ruby) mintRubies(state, n, def.id);
  else conjureToHand(state, [def], n, runeGrantOverflow());
}
