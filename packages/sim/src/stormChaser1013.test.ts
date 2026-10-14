import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * STORM CHASER (owner 2026-10-13): "storm chaser needs to change from: Cast a Veinstorm to Get a Veinstorm. So it
 * should add a veinstorm to hand instead of casting it directly." Back to the pre-10-10 grant, through the real
 * reducer / End-of-Turn / `simulate` paths.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const veinstorms = (s: RunState): number => s.hand.filter((c) => c.cardId === 'veinstorm').length;
const rubies = (c: BoardCard | { buffs?: { source: string }[] } | undefined): number => (c?.buffs ?? []).filter((b) => b.source === 'Ruby').length;
const NO_BANK = { atk: 0, hp: 0 };

describe('Storm Chaser: "Shout: Get a Veinstorm"', () => {
  it.each([[false, 1], [true, 2]] as const)('golden=%s: playing it puts %i Veinstorm(s) in hand and casts nothing', (golden, n) => {
    const s0 = run({ board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [body('sc', 'k_stormchaser', { golden })] });
    const s = act(s0, { type: 'play', uid: 'sc' });
    expect(veinstorms(s)).toBe(n);
    expect(s.veinstormRubies ?? NO_BANK, 'the Shop is not gemmed until the player casts it').toEqual(NO_BANK);
    expect(rubies(s.shop.find((o) => o.uid === 'o1'))).toBe(0);
    expect(rubies(s.board.find((c) => c.uid === 'a'))).toBe(0);
  });

  it('the Veinstorm it hands over is the real spell: casting it gems the Shop', () => {
    let s = act(run({ shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [body('sc', 'k_stormchaser')] }), { type: 'play', uid: 'sc' });
    const vs = s.hand.find((c) => c.cardId === 'veinstorm')!;
    s = act(s, { type: 'play', uid: vs.uid });
    expect(veinstorms(s)).toBe(0);
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
  });

  it('a re-fired Shout in the Shop grants another (Shrieker, End of Turn: trigger Shouts)', () => {
    const s = run({ board: [body('sh', 'd2_shrieker'), body('sc', 'k_stormchaser')], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    applyEndOfTurn(s);
    expect(veinstorms(s)).toBe(1);
    expect(s.veinstormRubies ?? NO_BANK).toEqual(NO_BANK);
  });

  // Ryme (5 Attack, 1 Health) re-fires its neighbour's Shout in combat; the omen wall never dies.
  const refire = (golden: boolean) => simulate(
    [{ cardId: 'ryme', attack: 5, health: 1 } as BoardMinion, { cardId: 'k_stormchaser', attack: 0, health: 100, golden, sourceUid: 'SC' } as BoardMinion],
    [{ cardId: 'omen', attack: 50, health: 2000 } as BoardMinion], makeRng(1), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it.each([[false, 1], [true, 2]] as const)('a re-fired Shout in COMBAT (golden=%s) sends %i Veinstorm(s) to hand, live: nothing is cast, nothing defers', (golden, n) => {
    const r = refire(golden);
    expect((r.playerHandGrants ?? []).filter((id) => id === 'veinstorm')).toHaveLength(n);
    expect(r.playerShoutCarry?.shopSpellHalves ?? [], 'no Shop half is banked: it is not a cast').toEqual([]);
    expect(r.events.filter((e) => e.type === 'buff' && (e as { ruby?: boolean }).ruby === true), 'no Ruby in the fight').toEqual([]);
    expect(r.playerDeferredBattlecries ?? [], 'not a deferred Shop-only Shout').toEqual([]);
  });

  it('after that fight the Veinstorm is in hand', () => {
    const r = refire(false);
    const s0 = run({ phase: 'combat', lastCombat: r, board: [body('SC', 'k_stormchaser')], shop: [{ uid: 'o1', cardId: 'sandbag' }] } as Partial<RunState>);
    const s = act(s0, { type: 'resolveCombat' });
    expect(veinstorms(s)).toBe(1);
    expect(s.veinstormRubies ?? NO_BANK).toEqual(NO_BANK);
  });

  it('the card: same body, matching text', () => {
    const d = CARD_INDEX['k_stormchaser']!;
    expect([d.tier, d.attack, d.health]).toEqual([3, 4, 1]);
    expect(d.effects.map((e) => [e.on, e.do, e.params])).toEqual([['onPlay', 'battlecryGrantSpell', { spellId: 'veinstorm', count: 1 }]]);
    expect([d.text, d.goldenText]).toEqual(['**Shout:** Get a **Veinstorm**.', '**Shout:** Get **2 Veinstorms**.']);
  });
});
