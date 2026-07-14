// packages/ui/src/deathrattleBuffers.ts
import { CARD_INDEX } from '@game/content';

/** Effect `do` names that, on an `onDeath` trigger, buff OTHER friendly minions (emit buff-other events in
 *  combat). A card with one of these gets the "descend" FX for its buff-others (a Deathrattle rains down onto
 *  each ally rather than shooting a tendril from an absent/irrelevant source). KEEP IN SYNC: add any new
 *  onDeath buff-other factory here. (Excludes spell-power / run-wide-only factories that emit no combat
 *  buff-other events.) */
export const DEATHRATTLE_BUFF_FACTORIES: ReadonlySet<string> = new Set([
  'deathrattleBuffTribe', 'deathrattleBuffTribeByTally', 'deathrattleBuffAll', 'deathrattleBuffAllHealth',
  'deathrattleBuffImps', 'deathrattleBuffRandom', 'deathrattleBuffAllRandomStat',
  'deathrattleGiveHealth', 'deathrattleSummonOverflowBuff',
  'deathrattleBuffFodder', 'deathrattleBuffAllByImpAura', // Burial Imp / Chef Raag — buff OTHERS on death (their
  // source is gone by strike time, so a living-source tendril is dropped → they need the sourceless descend).
  // NOT included: 'deathrattleBuffCardTypeRunWide' (Spear Warden / 'knit') — the owner wants that card
  // reframed as an "echo-aura" (its own effect concept), kept separate from Deathrattle descend. Excluded
  // deliberately until that design lands; do not add it here.
]);

/** Does this card buff OTHERS via a Deathrattle? Used by the combat replay to route its buff-others to the
 *  descend FX instead of a source→target tendril. Same `CARD_INDEX[...].effects?.some(...)` pattern the replay
 *  already uses to detect Deathrattle units for the skull-shatter FX. */
export function isDeathrattleBufferCard(cardId: string): boolean {
  return !!CARD_INDEX[cardId]?.effects?.some(
    (e) => e.on === 'onDeath' && DEATHRATTLE_BUFF_FACTORIES.has(e.do),
  );
}
