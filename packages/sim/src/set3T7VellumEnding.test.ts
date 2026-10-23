import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { fireSummonOverflow, spellCasts } from './recruit';

/**
 * SET 3 T7 SUMMIT — the owner's 2026-10-23 pair:
 *  - VELLUM (Dragon 12/8): "Equip Royal Edict (2): Improve your Shop spells by +2/+2. Your next 3 spells cast from hand
 *    this turn cast an additional time." — R-EQUIP-EDICT-01.
 *  - ENDING (Undead 1/1): "When you Overflow a minion, give your Undead Aura +4 Health." — R-AURA-ENDING-01.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, 'set3'), phase: 'recruit', embers: 60, tier: 6, hand: [], board: [], ...over } as RunState);
const nextTurn = (s: RunState): RunState => act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });

describe('the cards', () => {
  it('Vellum and Ending are drawable Set 3 T7 cards at the owner stats; Royal Edict is a 2-Gold untargeted Equipment', () => {
    const ids = poolFor('set3').buyable.map((c) => c.id);
    for (const [id, tribe, a, h] of [['d3_vellum', 'dragon', 12, 8], ['u3_ending', 'undead', 1, 1]] as const) {
      const d = CARD_INDEX[id]!;
      expect([d.tribe, d.tier, d.attack, d.health], id).toEqual([tribe, 7, a, h]);
      expect(ids, id).toContain(id);
      for (const t of [d.text, d.goldenText ?? '']) expect(/—|--/.test(t), `${id}: ${t}`).toBe(false);
    }
    const edict = EQUIPMENT_INDEX['royal_edict']!;
    expect([edict.name, edict.baseCost, edict.targetMode]).toEqual(['Royal Edict', 2, 'none']);
    expect(CARD_INDEX['d3_vellum']!.effects[0]).toMatchObject({ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'royal_edict' } });
  });
});

describe('R-EQUIP-EDICT-01: Royal Edict improves Shop spells and arms 3 extra-cast charges for this turn', () => {
  const armed = (golden = false): RunState => {
    let s = act(run({ hand: [body('v', 'd3_vellum', { golden })] }), { type: 'play', uid: 'v', toIndex: 0 } as Action);
    const gold = s.embers;
    const sp = { ...(s.spellBonus ?? { attack: 0, health: 0 }) };
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(s.embers, 'paid its 2 Gold').toBe(gold - 2);
    const g = golden ? 2 : 1;
    expect(s.spellBonus, 'Shop spells improved').toEqual({ attack: sp.attack + 2 * g, health: sp.health + 2 * g });
    return s;
  };

  it('the next 3 spells cast from hand each cast once more; the 4th is back to normal', () => {
    let s = armed();
    s = { ...s, hand: [1, 2, 3, 4].map((i) => body(`c${i}`, 'sharedspirit')) };
    const def = CARD_INDEX['sharedspirit']!;
    for (let i = 1; i <= 4; i++) {
      const want = i <= 3 ? 2 : 1;
      expect(spellCasts(s, def), `preview for spell ${i}`).toBe(want);
      const before = s.spellsCast;
      s = act(s, { type: 'play', uid: `c${i}` } as Action);
      expect(s.spellsCast - before, `spell ${i} resolved`).toBe(want);
    }
    expect(s.edictCharges ?? 0).toBe(0);
  });

  it('Gilded: +4/+4 and each of the next 3 spells casts 2 additional times', () => {
    let s = armed(true);
    s = { ...s, hand: [body('c1', 'sharedspirit')] };
    const before = s.spellsCast;
    s = act(s, { type: 'play', uid: 'c1' } as Action);
    expect(s.spellsCast - before).toBe(3);
    expect(s.edictCharges).toBe(2);
  });

  it('"this turn": unspent charges expire at the turn boundary; the spell power stays', () => {
    let s = armed();
    expect(s.edictCharges).toBe(3);
    const sp = { ...s.spellBonus! };
    s = nextTurn(s);
    expect(s.edictCharges ?? 0).toBe(0);
    expect(spellCasts(s, CARD_INDEX['sharedspirit']!)).toBe(1);
    expect(s.spellBonus).toEqual(sp);
  });
});

describe('R-AURA-ENDING-01: Ending — an Overflow gives your Undead Aura +4 Health, in both phases, permanently', () => {
  it('SHOP: each overflow raises the run Aura by +4 Health (Gilded +8); Attack is untouched', () => {
    const s = run({ board: [body('e', 'u3_ending'), body('pup', 'u3_poochy')] });
    const a0 = s.undeadAttackBonus, h0 = s.undeadHealthBonus;
    fireSummonOverflow(s);
    fireSummonOverflow(s);
    expect([s.undeadAttackBonus - a0, s.undeadHealthBonus - h0]).toEqual([0, 8]);
    const g = run({ board: [body('e', 'u3_ending', { golden: true, attack: 2, health: 2 })] });
    const gh0 = g.undeadHealthBonus;
    fireSummonOverflow(g);
    expect(g.undeadHealthBonus - gh0).toBe(8);
  });

  it('COMBAT: an Echo summon that does not fit raises the Aura live (living Undead +0/+4) and the gain carries home', () => {
    const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
      const d = CARD_INDEX[cardId]!;
      return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
    };
    // Wolves Den's Echo summons 3 Crypt Wolves into one free slot: two overflow (the Bicycle Bob fixture).
    const mine = (golden = false): BoardMinion[] => [
      bm('wolvesden'),
      bm('u3_ending', { health: 60, ...(golden ? { golden: true } : {}) } as Partial<BoardMinion>),
      bm('u3_poochy', { health: 60, keywords: [] } as Partial<BoardMinion>),
      ...[0, 1, 2, 3].map(() => ({ cardId: 'sandbag', attack: 1, health: 60, keywords: [] } as unknown as BoardMinion)),
    ];
    const foe = { cardId: 'sandbag', attack: 20, health: 25, keywords: [] } as unknown as BoardMinion;
    const pool = poolFor('set3').all.map((c) => c.id);
    const r = simulate(mine(), [foe], makeRng(7), CARD_INDEX, combatSide({ tier: 6, poolIds: pool }), combatSide({ tier: 6 }));
    expect(r.playerUndeadAuraGain, 'two overflows, +4 Health each, carried home').toEqual({ attack: 0, health: 8 });
    const ending = r.initial.player.find((m) => m.cardId === 'u3_ending')!.uid;
    const hits = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === ending) as unknown as { attack: number; health: number }[];
    expect(hits.length, 'the living Undead feel it now').toBeGreaterThan(0);
    for (const h of hits) expect([h.attack, h.health]).toEqual([0, 4]);
    const rg = simulate(mine(true), [foe], makeRng(7), CARD_INDEX, combatSide({ tier: 6, poolIds: pool }), combatSide({ tier: 6 }));
    expect(rg.playerUndeadAuraGain).toEqual({ attack: 0, health: 16 });
  });
});
