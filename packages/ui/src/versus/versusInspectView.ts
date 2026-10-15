/**
 * VERSUS: the right-click inspect view of a minion in the match stats overlay (owner 2026-10-14: "add the ability to
 * right click and view the buffs etc from the game"). Built from the fight's own starting snapshot (`CombatResult.
 * initial`, already stored whole on every `versus_rounds` row): the card's live text from its per-instance values, its
 * keywords, gilded state and the per-source buff breakdown the inspect panel lists. The same treatment the combat row
 * gives an ENEMY body (`Unit.tsx`): run-wide scalers a snapshot does not carry fall back to the printed rule. An older
 * round with no breakdown on its snapshot simply shows the card without one.
 */
import { CARD_INDEX } from '@game/content';
import type { MinionSnapshot } from '@game/core';
import type { CardView } from '../Card';
import { stepProgress } from '../cardText';
import { liveCardText } from '../instView';
import { grantedTriggersOfSnapshot } from '../grantedTriggers';

export function versusSnapshotView(m: MinionSnapshot, tier = 1): CardView {
  const def = CARD_INDEX[m.cardId];
  const goldMul = m.golden ? 2 : 1;
  const live = def
    ? liveCardText(m.cardId, {
        tier, golden: !!m.golden, keywords: m.keywords, chosenOption: m.chosenOption,
        // Run-wide scalers a snapshot does not carry: the printed rule (an enemy body's combat fallback).
        spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0,
        rallySpreadAtk: m.rallySpreadAtk, grantedRallyShout: m.grantedRallyShout, taughtSpellId: m.taughtSpellId, seedEchoes: m.seedEchoes, whisperTick: m.whisperTick,
        soldProgress: m.soldProgress, keeperFirstSpellName: m.boardFirstSpellId ? CARD_INDEX[m.boardFirstSpellId]?.name : undefined,
        spellProgress: m.spellProgress, spiritTally: m.spiritTally, ascendProgress: m.ascendProgress, summonBonus: m.summonBonus,
        overflowBonus: m.overflowBonus, hpGrantBonus: m.hpGrantBonus, eotBonus: m.eotBonus, eotTick: m.eotTick, sellBonus: m.sellBonus,
      })
    : { text: '', goldenText: undefined };
  return {
    name: m.name ?? def?.name ?? m.cardId,
    cardId: m.cardId,
    tribe: m.tribe ?? def?.tribe ?? 'neutral',
    tribe2: m.tribe2 ?? def?.tribe2,
    chosenOption: m.chosenOption,
    attack: m.attack,
    health: m.health,
    keywords: m.keywords ?? [],
    golden: m.golden,
    riseTint: m.riseTint,
    grantedTriggers: grantedTriggersOfSnapshot(m), // granted triggers on the medallion (R-MEDAL-GRANTED-01)
    text: live.text,
    goldenText: live.goldenText ?? def?.goldenText,
    tier: def?.tier,
    baseAttack: (def?.attack ?? m.attack) * goldMul,
    baseHealth: (def?.health ?? m.health) * goldMul,
    buffs: m.buffs && m.buffs.length > 0 ? m.buffs.map((b) => ({ ...b })) : undefined,
    stepProgress: stepProgress(m.cardId, {
      spellProgress: m.spellProgress, spiritTally: m.spiritTally, summonBonus: m.summonBonus, ascendProgress: m.ascendProgress,
      damageDealt: m.damageDealt,
    }) ?? undefined,
  };
}
