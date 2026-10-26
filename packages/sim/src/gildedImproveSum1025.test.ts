import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { improvingRubyGrantText, summonBuffText, summonEscalatingText } from '../../ui/src/cardText';

/**
 * R-GILD-SUM-01 — OWNER RULING 2026-10-25. Asked: "Kennelmaster has improved twice (now +6 Attack: base +2, plus +2 per
 * Avenge) and you make it Gilded. What should the Gilded one give?" Answer: "it should be at the sum of the 2 highest
 * buff values. so if you had a +16 and a +10 and gilded it, it should be at +26."
 *
 * Before: the triple stored `base + sb1 + sb2` and `scBeastAura` doubled the WHOLE grant at read time, so the golden
 * doubled the copies' earned improvements (and even a fresh triple read +8, not the printed +4). Now every card whose
 * payout is `(base + step x accrual) x golden` (GOLD_SCALED_ACCRUAL_CARDS) stores the HALF-SUM of the two best copies'
 * accruals: the x2 read lands on copy A + copy B exactly, and later improves run at the golden step.
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const mk = (cardId: string, uid: string, summonBonus?: number): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...(summonBonus ? { summonBonus } : {}) };
};
/** Three copies in hand, played in turn — the real triple path. */
const tripleOf = (cardId: string, bonuses: (number | undefined)[], setId = 'set1'): BoardCard => {
  let s: RunState = { ...createRun(1), setId, phase: 'recruit', embers: 60, board: [], tier: 6,
    hand: bonuses.map((b, i) => mk(cardId, `c${i}`, b)) } as RunState;
  for (let i = 0; i < bonuses.length; i++) s = reduce(s, { type: 'play', uid: `c${i}` });
  const g = [...s.hand, ...s.board].find((c) => c.cardId === cardId && c.golden);
  expect(g, 'the triple produced a golden').toBeDefined();
  return g!;
};
/** Kennelmaster's printed grant for an accrual (the copy's current value, as the card prints it). */
const kennelGrant = (sb: number, golden: boolean): number => (2 + 2 * sb) * (golden ? 2 : 1);
const liveKennel = (c: BoardCard): string =>
  summonBuffText('kennel', c.summonBonus ?? 0, c.golden) ?? (c.golden ? CARD_INDEX['kennel']!.goldenText! : CARD_INDEX['kennel']!.text);

const bm = (cardId: string, uid: string, attack = 2, health = 900, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const sim = (p: BoardMinion[], e: BoardMinion[], seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES }), combatSide({ tier: 6, tribes: ALL_TRIBES }));
const buffs = (r: CombatResult) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 90000 }];

describe('R-GILD-SUM-01: a Gilded Kennelmaster is the sum of its two best copies', () => {
  it('+16 and +10 copies gild to +26 (the owner example)', () => {
    expect(kennelGrant(7, false)).toBe(16);
    expect(kennelGrant(4, false)).toBe(10);
    const g = tripleOf('kennel', [7, 4, undefined]);
    expect(kennelGrant(g.summonBonus ?? 0, true)).toBe(26);
    expect(liveKennel(g)).toContain('{{+26 Attack}}');
  });

  it('two fresh copies gild to the printed Gilded +4', () => {
    const g = tripleOf('kennel', [undefined, undefined, undefined]);
    expect(g.summonBonus ?? 0).toBe(0);
    expect(kennelGrant(g.summonBonus ?? 0, true)).toBe(4);
    expect(liveKennel(g)).toContain('**+4 Attack**');
  });

  it('three copies of different values: only the top two count', () => {
    const g = tripleOf('kennel', [1, 3, 2]); // +4, +8, +6 -> +8 + +6
    expect(kennelGrant(g.summonBonus ?? 0, true)).toBe(14);
    expect(liveKennel(g)).toContain('{{+14 Attack}}');
  });

  it('the Set 2 Kennelmaster follows the same rule', () => {
    const g = tripleOf('kennel', [7, 4, 0], 'set2');
    expect(kennelGrant(g.summonBonus ?? 0, true)).toBe(26);
  });

  it('combat applies exactly the printed +26, and one Avenge then makes it +30 (the golden step, not a doubling)', () => {
    const g = tripleOf('kennel', [7, 4, undefined]);
    const r = sim([bm('kennel', 'K', 0, 900, { golden: true, summonBonus: g.summonBonus }), bm('alley', 'A', 1, 900)], wall);
    const ally = r.initial.player[1]!.uid;
    expect(buffs(r).some((b) => b.target === ally && b.attack === 26)).toBe(true);
    expect(buffs(r).some((b) => b.target === ally && b.attack === 52), 'never doubled again').toBe(false);

    // Three friendly deaths -> Avenge (3) fires once -> the carry-back is one golden step (+4).
    const fodder = (i: number) => bm('sandbag', `F${i}`, 0, 1);
    const r2 = sim([bm('kennel', 'K', 0, 900, { golden: true, summonBonus: g.summonBonus }), fodder(1), fodder(2), fodder(3)],
      [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const carried = (r2.playerSummonBonus ?? []).find((x) => x.sourceUid === 'K')?.bonus ?? 0;
    expect(kennelGrant(carried, true)).toBe(30);
    expect(summonBuffText('kennel', carried, true)).toContain('{{+30 Attack}}');
    const r3 = sim([bm('kennel', 'K', 0, 900, { golden: true, summonBonus: carried }), bm('alley', 'A', 1, 900)], wall);
    expect(buffs(r3).some((b) => b.target === r3.initial.player[1]!.uid && b.attack === 30)).toBe(true);
  });

  it('both combat sides pay the same grant (symmetry)', () => {
    const g = tripleOf('kennel', [7, 4, undefined]);
    const r = sim(wall, [bm('kennel', 'K', 0, 900, { golden: true, summonBonus: g.summonBonus }), bm('alley', 'A', 1, 900)]);
    const ally = r.initial.enemy[1]!.uid;
    expect(buffs(r).some((b) => b.target === ally && b.attack === 26)).toBe(true);
  });
});

describe('R-GILD-SUM-01: the other (base + accrual) x golden improvers', () => {
  it('Trophy Stalker: +15/+15 and +10/+10 copies gild to +25/+25', () => {
    // (5 + sb) per copy: sb 10 -> +15, sb 5 -> +10.
    const g = tripleOf('trophystalker', [10, 5, undefined]);
    expect((5 + (g.summonBonus ?? 0)) * 2).toBe(25);
    expect(summonBuffText('trophystalker', g.summonBonus ?? 0, true)).toContain('{{+25/+25}}');
  });

  it('Beardsley: +4/+4 and +3/+3 copies gild to +7/+7', () => {
    const g = tripleOf('b2_beardsley', [3, 2, 1], 'set2');
    expect((1 + (g.summonBonus ?? 0)) * 2).toBe(7);
    expect(summonEscalatingText('b2_beardsley', true, g.summonBonus)).toContain('+7/+7');
  });

  it('Vicious: +20/+20 and +10/+10 copies gild to +30/+30', () => {
    const g = tripleOf('b2_florida', [3, 1, 0], 'set2');
    expect((5 + 5 * (g.summonBonus ?? 0)) * 2).toBe(30);
    expect(summonEscalatingText('b2_florida', true, g.summonBonus)).toContain('+30/+30');
  });

  it('Alchemist Brisbane: +4/+4 and +2/+2 copies gild to +6/+6', () => {
    const g = tripleOf('k_alchemist', [3, 1, 0], 'set2');
    expect((1 + (g.summonBonus ?? 0)) * 2).toBe(6);
    expect(improvingRubyGrantText('k_alchemist', true, g.summonBonus ?? 0)).toContain('+6/+6');
  });

  it('raw-read improvers (Thundeer, Muster General) keep the plain top-two sum', () => {
    expect(tripleOf('n2_muster', [3, 2, 1], 'set2').summonBonus).toBe(5);
  });
});
