import { CARD_INDEX } from '@game/content';

/** Does one effect give another minion Flurry? A targeted Shout that grants keywords (Runic Beetle's Flurry option). */
const effectGivesFlurry = (f: { do: string; params?: Record<string, unknown> }): boolean =>
  f.do === 'battlecryGrantKeyword' && Array.isArray(f.params?.keywords) && f.params.keywords.includes('W');

/**
 * Does this card give ANOTHER minion Flurry? The cards the workbench offers an "On Flurry given" slot. A Choose One
 * card counts when any of its options does (Runic Beetle).
 */
export function givesFlurry(cardId: string | null | undefined): boolean {
  const def = cardId ? CARD_INDEX[cardId] : undefined;
  if (!def) return false;
  return !!def.effects?.some(effectGivesFlurry) || !!def.chooseOne?.some((o) => o.effects?.some(effectGivesFlurry));
}

/**
 * THE SHOP, MID-TURN: the Flurry a minion PLAYED this action gave (R-FX-FLURRY-GIVEN-01). A mid-turn action carries no
 * presentation batch in production, so the grant is read off the board itself: a minion that was on the board WITHOUT
 * Flurry and now has it, in the same action that put a Flurry-giving minion on the board. `prev` maps each uid on the
 * board before the action to whether it had Flurry. A Flurry the played minion gave itself is not a travel.
 */
export function playedFlurryGrants(
  prev: ReadonlyMap<string, boolean>,
  board: ReadonlyArray<{ uid: string; cardId: string; keywords: readonly string[] }>,
): Array<{ cardId: string; source: string; target: string }> {
  const giver = board.find((c) => !prev.has(c.uid) && givesFlurry(c.cardId));
  if (!giver) return [];
  return board
    .filter((c) => prev.get(c.uid) === false && c.keywords.includes('W'))
    .map((c) => ({ cardId: giver.cardId, source: giver.uid, target: c.uid }));
}
