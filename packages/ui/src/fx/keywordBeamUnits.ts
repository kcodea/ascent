import { CARD_INDEX } from '@game/content';

/**
 * EVERY BODY IN THE SHOP PHASE A KEYWORD BEAM CAN LAND ON (R-FX-KEYWORD-ORIGIN-01, owner 2026-11-13: "i can bulwark a
 * minion in shop, it should get the same effect"): the warband, and the offers in the Shop row. A warband minion
 * carries its keywords itself; an offer's are its card's own plus any it was GIVEN (`ShopCard.keywords`).
 */
export function keywordBeamUnits(
  board: ReadonlyArray<{ uid: string; keywords: readonly string[] }>,
  shop: ReadonlyArray<{ uid: string; cardId: string; keywords?: readonly string[] }>,
): Array<{ uid: string; keywords: readonly string[] }> {
  return [
    ...board.map((c) => ({ uid: c.uid, keywords: c.keywords })),
    ...shop.map((o) => ({ uid: o.uid, keywords: [...(CARD_INDEX[o.cardId]?.keywords ?? []), ...(o.keywords ?? [])] })),
  ];
}
