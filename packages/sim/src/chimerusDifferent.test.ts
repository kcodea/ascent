/** R-TARGET-CHIMERUS-01 (owner 2026-11-25): "add "different" so that it cannot buff another chimerus or itself". */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './index';
import { fireShopRally } from './recruit';

const bm = (cardId: string, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: 1, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const bc = (uid: string, cardId: string, health: number, golden = false): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 1, health, golden, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] }) as BoardCard;

describe('Chimerus gives its Health to 2 different friendly Dragons', () => {
  it.each([false, true])('COMBAT (Gilded %s): only the other Dragon is fed, never a Chimerus', (golden) => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = simulate([bm('chimerus', 40, { golden }), bm('chimerus', 40, { golden: !golden }), bm('hoardwhelp', 400)], [{ cardId: 'sandbag', attack: 0, health: 4000 }],
        makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['dragon'] }), combatSide());
      const chims = r.initial.player.filter((m) => m.cardId === 'chimerus').map((m) => m.uid);
      const whelp = r.initial.player.find((m) => m.cardId === 'hoardwhelp')!.uid;
      const gifts = r.events.filter((e) => e.type === 'buff' && chims.includes((e as { source: string }).source)) as unknown as { target: string }[];
      expect(gifts.length).toBeGreaterThan(0);
      expect([...new Set(gifts.map((e) => e.target))]).toEqual([whelp]);
    }
  });

  it.each([false, true])('SHOP (Gilded %s): the same pool; alone with a Chimerus it gives nothing', (golden) => {
    const s = { ...createRun(3), phase: 'recruit', board: [bc('a', 'chimerus', 10, golden), bc('b', 'chimerus', 10), bc('w', 'hoardwhelp', 5)] } as RunState;
    const hp = (uid: string): number => s.board.find((c) => c.uid === uid)!.health;
    fireShopRally(s, s.board[0]!);
    expect([hp('a'), hp('b'), hp('w')]).toEqual([10, 10, 5 + 10 * (golden ? 2 : 1)]);
    s.board = s.board.slice(0, 2);
    fireShopRally(s, s.board[0]!);
    expect([hp('a'), hp('b')]).toEqual([10, 10]);
  });

  it('prints "different"', () => {
    const d = CARD_INDEX.chimerus!;
    expect(d.text).toContain('**2 different** friendly Dragons');
    expect(d.goldenText).toContain('**2 different** friendly Dragons');
  });
});
