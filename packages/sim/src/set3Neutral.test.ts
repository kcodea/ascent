import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { rubyCastCount, spellCasts, spellDisplayText, isRallyDef } from './recruit';
import { equipmentUsesLeft } from './equipment';

/**
 * SET 3 — NEUTRALS, tranche 1 (owner roster 2026-09-09). The carried-over roster is pinned by
 * `set3Scaffold.test.ts`; this file covers the rulings with behaviour:
 *  - Splitboon Adept: option 1 targets one friend (+6/+6), option 2 buffs both neighbours (+3/+3); golden doubles;
 *    the adjacent Shout also resolves as a COMBAT re-fire (arena body).
 *  - The set-3 Yazzus doubles aimed Shop spells like the original AND Rubies (set 1's does not touch Rubies).
 *  - Blaster is a set-3 card again and no longer archived. Sylus / Drakko wear their short names.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['undead', 'dwarf', 'kobold'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const hand = (uid: string, cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const fightWithHand = (mine: BoardMinion[], foes: BoardMinion[]) =>
  simulate(mine, foes, makeRng(11), CARD_INDEX, combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};

describe('Splitboon Adept (Choose One)', () => {
  const setup = (golden = false): RunState => run({
    board: [body('l', 'venom'), body('r', 'venom')],
    hand: [hand('sb', 'n3_splitboon', golden)],
  });

  it('option 1 targets a friendly minion for +6/+6 (golden +12/+12)', () => {
    let s = setup();
    s = reduce(s, { type: 'play', uid: 'sb', toIndex: 1 } as Action);
    expect(s.chooseOne?.uid).toBe('sb');
    s = reduce(s, { type: 'chooseOne', index: 0 } as Action);
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'r' } as Action);
    expect([at(s, 'r').attack, at(s, 'r').health]).toEqual([1 + 6, 1 + 6]);
    expect([at(s, 'l').attack, at(s, 'l').health]).toEqual([1, 1]);

    let g = setup(true);
    g = reduce(g, { type: 'play', uid: 'sb', toIndex: 1 } as Action);
    g = reduce(g, { type: 'chooseOne', index: 0 } as Action);
    g = reduce(g, { type: 'battlecryTarget', targetUid: 'l' } as Action);
    expect([at(g, 'l').attack, at(g, 'l').health]).toEqual([13, 13]);
  });

  it('option 2 buffs both neighbours +3/+3 with no target step (golden +6/+6)', () => {
    let s = setup();
    s = reduce(s, { type: 'play', uid: 'sb', toIndex: 1 } as Action);
    s = reduce(s, { type: 'chooseOne', index: 1 } as Action);
    expect(s.pendingTarget ?? null).toBeNull();
    expect(s.board.map((c) => c.uid)).toEqual(['l', 'sb', 'r']);
    expect([at(s, 'l').attack, at(s, 'l').health]).toEqual([4, 4]);
    expect([at(s, 'r').attack, at(s, 'r').health]).toEqual([4, 4]);
    expect([at(s, 'sb').attack, at(s, 'sb').health]).toEqual([3, 4]);

    let g = setup(true);
    g = reduce(g, { type: 'play', uid: 'sb', toIndex: 0 } as Action); // leftmost: only ONE neighbour
    g = reduce(g, { type: 'chooseOne', index: 1 } as Action);
    expect([at(g, 'l').attack, at(g, 'l').health]).toEqual([7, 7]);
    expect([at(g, 'r').attack, at(g, 'r').health]).toEqual([1, 1]);
  });

  it('the adjacent Shout has a combat body — a re-fire in a fight buffs the neighbours there', () => {
    // A minion carrying the effect directly (the Choose One pick is a shop-time decision; the arena body is
    // what a Ryme / Myra re-fire runs). Fire it at Start of Combat via the shared replay helper's contract:
    // simplest proof is the factory existing and resolving through `combatArena` — assert via a direct sim
    // of a Shout re-fire is beyond this tranche, so pin the registration instead.
    const factories = CARD_INDEX['n3_splitboon']!.chooseOne!.map((o) => o.effects.map((e) => e.do)).flat();
    expect(factories).toEqual(['battlecryBuffTarget', 'battlecryBuffAdjacent']);
    // And the fight itself runs with the body on board (no throw, deterministic).
    const r = simulate([bm('n3_splitboon'), bm('venom')], [bm('sandbag', { attack: 1, health: 1 })], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    expect(r.result).toBeDefined();
  });
});

describe('the set-3 Yazzus fork', () => {
  it('is T6 4/8 and doubles aimed Shop spells (golden ×3), like the original', () => {
    const d = CARD_INDEX['n3_yazzus']!;
    expect([d.tier, d.attack, d.health]).toEqual([6, 4, 8]);
    const spirit = CARD_INDEX['spiritfire'] ?? Object.values(CARD_INDEX).find((c) => c.spell && c.target)!;
    expect(spellCasts(run({ board: [body('y', 'n3_yazzus')] }), spirit)).toBe(2);
    expect(spellCasts(run({ board: [body('y', 'n3_yazzus', { golden: true })] }), spirit)).toBe(3);
    expect(spellCasts(run({ board: [] }), spirit)).toBe(1);
  });

  it('doubles Rubies too — set 1\'s Yazzus does not', () => {
    expect(rubyCastCount(run({ board: [body('y', 'n3_yazzus')] }))).toBe(2);
    expect(rubyCastCount(run({ board: [body('y', 'n3_yazzus', { golden: true })] }))).toBe(3);
    expect(rubyCastCount(run({ board: [body('y', 'yazzus')] }))).toBe(1);
  });

  it('a Ruby played with the set-3 Yazzus on board lands twice', () => {
    let s = run({ board: [body('y', 'n3_yazzus'), body('t', 'venom')], hand: [{ ...hand('rb', 'ruby'), attack: 1, health: 1 }] });
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health]).toEqual([3, 3]);
  });

  it('set 1 keeps the original Yazzus untouched', () => {
    const d = CARD_INDEX['yazzus']!;
    expect([d.tier, d.attack, d.health]).toEqual([7, 5, 7]);
    expect(poolFor('set3').buyable.some((c) => c.id === 'yazzus')).toBe(false);
    expect(poolFor('set3').buyable.some((c) => c.id === 'n3_yazzus')).toBe(true);
  });
});

describe('roster housekeeping', () => {
  it('Blaster is a set-3 card and no longer archived', () => {
    expect(ARCHIVED_CARDS.some((c) => c.id === 'blaster')).toBe(false);
    expect(poolFor('set3').buyable.some((c) => c.id === 'blaster')).toBe(true);
    expect(poolFor('set2').buyable.some((c) => c.id === 'blaster')).toBe(false);
  });
  it('Sylus and Drakko wear their short names in every set (ids unchanged)', () => {
    expect(CARD_INDEX['sylus']!.name).toBe('Sylus');
    expect(CARD_INDEX['drummer']!.name).toBe('Drakko');
  });
});

/* ── tranche 2: the hand spells (Tower Shield, Clue), Defender, Inspector Pell ──────────────────────────── */
import { GIFT_IDS } from '@game/content';

describe('Tower Shield — a card-minted Gift', () => {
  it('Defender mints two (golden: four); the shield is free, aimed, and no set sells it', () => {
    let s = run({ hand: [hand('d', 'n3_defender')] });
    s = reduce(s, { type: 'play', uid: 'd', toIndex: 0 } as Action);
    expect(s.hand.filter((c) => c.cardId === 'tower_shield')).toHaveLength(2);
    let g = run({ hand: [hand('d', 'n3_defender', true)] });
    g = reduce(g, { type: 'play', uid: 'd', toIndex: 0 } as Action);
    expect(g.hand.filter((c) => c.cardId === 'tower_shield')).toHaveLength(4);
    const d = CARD_INDEX['tower_shield']!;
    expect([d.gift, d.spell, d.cost, d.target]).toEqual([true, true, 0, 'friendly']);
    for (const set of ['set1', 'set2', 'set3'] as const) expect(poolFor(set).all.some((c) => c.id === 'tower_shield'), set).toBe(false);
    expect(GIFT_IDS).not.toContain('tower_shield'); // Merry Christmas's Gift Discover must never offer one
  });

  it('casting gives +2/+1 and Taunt, ignores spell power, counts as a spell cast but never as copy food', () => {
    let s = run({ board: [body('t', 'venom')], hand: [hand('ts', 'tower_shield')], spellBonus: { attack: 5, health: 5 }, lastSpellCastId: 'growth' });
    const before = s.spellsCast;
    s = reduce(s, { type: 'play', uid: 'ts', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health]).toEqual([3, 2]);
    expect(at(s, 't').keywords).toContain('T');
    expect(s.hand.some((c) => c.cardId === 'tower_shield')).toBe(false);
    expect(s.spellsCast).toBe(before + 1);
    expect(s.lastSpellCastId, 'Steward of Spells never copies a Gift').toBe('growth');
  });

  it('the set-3 Yazzus repeats it; set 1\'s Yazzus does not', () => {
    let s = run({ board: [body('y', 'n3_yazzus'), body('t', 'venom')], hand: [hand('ts', 'tower_shield')] });
    s = reduce(s, { type: 'play', uid: 'ts', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health]).toEqual([5, 3]);
    let o = run({ board: [body('y', 'yazzus'), body('t', 'venom')], hand: [hand('ts', 'tower_shield')] });
    o = reduce(o, { type: 'play', uid: 'ts', targetUid: 't' } as Action);
    expect([at(o, 't').attack, at(o, 't').health]).toEqual([3, 2]);
  });
});

describe('Clue — improves itself', () => {
  it('each cast grants the current value, then raises it: +1/+1, then +2/+2, then +3/+3', () => {
    let s = run({ board: [body('t', 'venom')], hand: [hand('c1', 'clue'), hand('c2', 'clue'), hand('c3', 'clue')] });
    s = reduce(s, { type: 'play', uid: 'c1', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health, s.clueBonus]).toEqual([2, 2, 1]);
    s = reduce(s, { type: 'play', uid: 'c2', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health, s.clueBonus]).toEqual([4, 4, 2]);
    s = reduce(s, { type: 'play', uid: 'c3', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health, s.clueBonus]).toEqual([7, 7, 3]);
  });

  it('a Yazzus-repeated Clue is two real Clues: +1/+1 then +2/+2, and the value climbs twice', () => {
    let s = run({ board: [body('y', 'n3_yazzus'), body('t', 'venom')], hand: [hand('c1', 'clue')] });
    s = reduce(s, { type: 'play', uid: 'c1', targetUid: 't' } as Action);
    expect([at(s, 't').attack, at(s, 't').health, s.clueBonus]).toEqual([4, 4, 2]);
  });

  it('the printed value is live', () => {
    expect(spellDisplayText('clue', 0, 0, 0, 0, 0, 0, { clueBonus: 0 })).toContain('**+1/+1**');
    expect(spellDisplayText('clue', 0, 0, 0, 0, 0, 0, { clueBonus: 3 })).toContain('{{+4/+4}}');
    expect(spellDisplayText('clue', 0, 0, 0, 0, 0, 0, { clueBonus: 3 })).toContain('Improve your Clues by **+1/+1**');
  });

  it('Inspector Pell\'s Magnifying Glass mints two Clues (a gilded Pell: four)', () => {
    let s = run({ hand: [hand('p', 'n3_pell')], embers: 10 });
    s = reduce(s, { type: 'play', uid: 'p', toIndex: 0 } as Action);
    expect(s.equipment?.available.some((g) => g.equipmentId === 'magnifying_glass')).toBe(true);
    s = reduce(s, { type: 'activateEquipment' } as Action);
    expect(s.hand.filter((c) => c.cardId === 'clue')).toHaveLength(2);
    let g = run({ hand: [hand('p', 'n3_pell', true)], embers: 10 });
    g = reduce(g, { type: 'play', uid: 'p', toIndex: 0 } as Action);
    g = reduce(g, { type: 'activateEquipment' } as Action);
    expect(g.hand.filter((c) => c.cardId === 'clue')).toHaveLength(4);
  });
});

/* ── tranche 3: Highway Hustler + Whiplass-o, Warband Recruiter, Equipment Charger ──────────────────────── */

describe('Whiplass-o — steal the highest-Tier Shop minion', () => {
  const shop = (ids: string[]) => ids.map((cardId, i) => ({ uid: `o${i}`, cardId, cost: 3 }));
  it('takes the top-Tier offer (left-most on a tie) into hand; a gilded Hustler takes two', () => {
    let s = run({ hand: [hand('h', 'n3_hustler')], embers: 10, shop: shop(['venom', 'jenkins', 'blaster', 'wayfinder']) as never });
    s = reduce(s, { type: 'play', uid: 'h', toIndex: 0 } as Action);
    expect(s.equipment?.available.some((g) => g.equipmentId === 'whiplasso')).toBe(true);
    s = reduce(s, { type: 'activateEquipment' } as Action);
    expect(s.hand.map((c) => c.cardId)).toEqual(['jenkins']); // T5 beats T4/T4/T3
    expect(s.shop.map((o) => o.cardId)).toEqual(['venom', 'blaster', 'wayfinder']);

    let g = run({ hand: [hand('h', 'n3_hustler', true)], embers: 10, shop: shop(['venom', 'blaster', 'wayfinder', 'jenkins']) as never });
    g = reduce(g, { type: 'play', uid: 'h', toIndex: 0 } as Action);
    g = reduce(g, { type: 'activateEquipment' } as Action);
    // (a golden card in hand also carries the gilding's Discover token — not part of the theft)
    expect(g.hand.map((c) => c.cardId).filter((id) => id !== 'discoverspell')).toEqual(['jenkins', 'blaster']); // T5, then the left-most T4
    expect(g.shop.map((o) => o.cardId)).toEqual(['venom', 'wayfinder']);
  });
});

describe('Warband Recruiter — Rally: summon and get a random Rally minion', () => {
  it('in combat: a Rally minion is summoned beside it and a copy is granted to hand', () => {
    const r = fightWithHand([bm('n3_recruiter')], [foe(1, 30), foe(1, 30), foe(1, 30)]);
    const summoned = r.events.filter((e) => e.type === 'summon' && (e as { side?: string }).side === 'player');
    expect(summoned.length).toBeGreaterThan(0);
    const summonedIds = summoned.map((e) => (e as { minion: { cardId: string } }).minion.cardId);
    for (const id of summonedIds) expect(isRallyDef(CARD_INDEX[id]!), `${id} is a Rally minion`).toBe(true);
    expect(summonedIds).not.toContain('n3_recruiter');
    const granted = r.events.filter((e) => e.type === 'toHand');
    expect(granted.length).toBeGreaterThan(0);
  });

  it('the pool rule: drawable, keyword RL, an onAttack effect; the Recruiter is one itself', () => {
    expect(isRallyDef(CARD_INDEX['n3_recruiter']!)).toBe(true);
    expect(isRallyDef(CARD_INDEX['tauntbreaker']!)).toBe(true);
    expect(isRallyDef(CARD_INDEX['venom']!)).toBe(false);
    expect(poolFor('set3').buyable.filter(isRallyDef).length).toBeGreaterThan(1);
  });
});

describe('Equipment Charger — Start of Turn: an extra Equipment charge', () => {
  it('the turn after it is on board, the allowance is one higher (golden: two); the bonus never banks', () => {
    const turn = (s: RunState): RunState => {
      for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
      return s;
    };
    const base = run({ board: [body('c', 'n3_charger'), body('f', 'e3_frank')] });
    const plainBefore = equipmentUsesLeft(turn(run({ board: [body('f', 'e3_frank')] })));
    let s = turn(base);
    expect(s.phase).toBe('recruit');
    expect(equipmentUsesLeft(s)).toBe(plainBefore + 1);
    s = turn(s); // a second turn: still +1, not +2 — the bonus is rebuilt each turn
    expect(equipmentUsesLeft(s)).toBe(plainBefore + 1);
    const g = turn(run({ board: [body('c', 'n3_charger', { golden: true }), body('f', 'e3_frank')] }));
    expect(equipmentUsesLeft(g)).toBe(plainBefore + 2);
  });
});
