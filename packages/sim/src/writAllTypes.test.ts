import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState, type ShopCard } from './state';
import { reduce } from './reducer';
import { offerIsTribe } from './recruit';

/**
 * R-WRIT-ALL-TYPES-01 (owner 2026-10-20): "paragon/other all types should be stolen from deep delve writs".
 *
 * Deep Delve Writ steals a random Dwarf from the Shop. An All-types minion counts as every type, so it is a Dwarf
 * for the Writ. The steal's own pool already said so, but the fizzle gate in front of it read only the printed
 * tribe and second tribe: a Shop whose only Dwarf-counting offer was Paragon refused the cast outright, so the
 * Writ stayed in hand and the All-types body could never be taken.
 */

const writ = (): BoardCard => ({ uid: 'sp', cardId: 'deepdelvewrit', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const offer = (uid: string, cardId: string, extra: Partial<ShopCard> = {}): ShopCard => ({ uid, cardId, cost: 3, ...extra } as ShopCard);
const nonDwarf = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && !c.ruby && !c.universalTribe && c.tribe === 'beast' && !c.tribe2)!;

function cast(shop: ShopCard[]): RunState {
  const s: RunState = { ...createRun(11), board: [], hand: [writ()], embers: 30, shop };
  return reduce(s, { type: 'play', uid: 'sp' });
}

describe('Deep Delve Writ steals All-types minions as Dwarves', () => {
  for (const id of ['n2_paragon', 'n2_standardbearer']) {
    it(`${id}: the only Dwarf-counting offer, so the Writ casts and steals it`, () => {
      expect(CARD_INDEX[id]?.universalTribe, `${id} is printed All types`).toBe(true);
      const after = cast([offer('o1', nonDwarf.id), offer('o2', id)]);
      expect(after.hand.some((c) => c.uid === 'sp'), 'the Writ was refused (stayed in hand)').toBe(false);
      expect(after.hand.map((c) => c.cardId)).toContain(id);
      expect(after.shop.map((o) => o.cardId)).toEqual([nonDwarf.id]); // the non-Dwarf is never a candidate
    });
  }

  it('a displaced body marked All types by the Anomaly Reactor counts too', () => {
    const held: BoardCard = { uid: 'h1', cardId: nonDwarf.id, tribe: nonDwarf.tribe, attack: 9, health: 9, keywords: [], golden: false, allTribes: true };
    const after = cast([offer('o1', nonDwarf.id), offer('o2', nonDwarf.id, { held })]);
    expect(after.hand.some((c) => c.uid === 'sp')).toBe(false);
    const stolen = after.hand.find((c) => c.cardId === nonDwarf.id);
    expect(stolen?.allTribes).toBe(true);
    expect(after.shop.map((o) => o.uid)).toEqual(['o1']);
  });

  it('with no Dwarf and no All-types offer it still fizzles', () => {
    const shop = [offer('o1', nonDwarf.id)];
    const s: RunState = { ...createRun(11), board: [], hand: [writ()], embers: 30, shop };
    expect(reduce(s, { type: 'play', uid: 'sp' })).toBe(s);
  });

  it('offerIsTribe: All types counts as every type but never as neutral', () => {
    const p = offer('o', 'n2_paragon');
    expect(offerIsTribe({}, p, 'dwarf')).toBe(true);
    expect(offerIsTribe({}, p, 'beast')).toBe(true);
    expect(offerIsTribe({}, p, 'neutral')).toBe(false);
    expect(offerIsTribe({}, offer('b', nonDwarf.id), 'dwarf')).toBe(false);
  });
});
