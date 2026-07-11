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
]);

/** Does this card buff OTHERS via a Deathrattle? Used by the combat replay to route its buff-others to the
 *  descend FX instead of a source→target tendril. Same `CARD_INDEX[...].effects?.some(...)` pattern the replay
 *  already uses to detect Deathrattle units for the skull-shatter FX. */
export function isDeathrattleBufferCard(cardId: string): boolean {
  return !!CARD_INDEX[cardId]?.effects?.some(
    (e) => e.on === 'onDeath' && DEATHRATTLE_BUFF_FACTORIES.has(e.do),
  );
}
