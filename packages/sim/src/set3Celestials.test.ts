import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { rubyStatBonus, spellAttackBonus, spellDisplayText, spellHealthBonus } from './recruit';
import { equipmentState } from './equipment';

/**
 * SET 3 — CELESTIALS, the reworked roster (owner sheet 2026-09-11): the SPELL tribe. Star Crash (`starcrash`,
 * "give a Celestial +5/+7, it also casts on a random friendly minion") is the tribe's own spell, so most casts
 * below land on a LONE Celestial, where the random friendly is that same body and every number is exact.
 *
 *  - Horizon Courier: Echo → a random Shop spell (combat death here).
 *  - Sugarnova (was Starpath Vendor; +4/+4 since 2026-09-18): banked for the NEXT Shop spell — it carries through
 *    combat unspent, every Shop spell prints it live, and exactly the next Shop-spell cast spends it; a Gift and a
 *    Ruby neither read nor spend it.
 *  - Gravestar Seer: +4 Attack per spell of ANY kind (Shop spell, Ruby), permanent.
 *  - Comet Conductor: Rally → a copy of the turn's first spell, once per combat.
 *  - Falling Star Herald: Shout AND Echo → a Star Crash.
 *  - Crash Course (was Crashborn Adept; 2026-09-18): the first Star Crash on it each turn casts an additional time
 *    on it (a full re-cast, Mirrorwing's shape, gated to the named spell).
 *  - Astral Spellcore: exactly the third Shop spell each turn → your Celestials +6/+6.
 *  - Orrery Artificer: Equip Comet (4) → the next spell casts 2 additional times.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as BoardCard);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(3), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['celestial', 'undead', 'kobold'], shop: [],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const play = (s: RunState, uid: string, extra: Partial<Action> = {}): RunState => reduce(s, { type: 'play', uid, ...extra } as Action);
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const buffFrom = (c: BoardCard, source: string): [number, number] =>
  (c.buffs ?? []).filter((b) => b.source === source).reduce<[number, number]>((acc, b) => [acc[0] + b.attack, acc[1] + b.health], [0, 0]); // the ledger holds TOTALS
const boardTotal = (s: RunState): [number, number] => s.board.reduce<[number, number]>((acc, c) => [acc[0] + c.attack, acc[1] + c.health], [0, 0]);
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const toHand = (events: readonly CombatEvent[]): string[] =>
  events.filter((e) => e.type === 'toHand' && (e as { side: string }).side === 'player').map((e) => (e as { cardId: string }).cardId);

describe('the roster', () => {
  it('all eight are set-3 Celestials with the sheet tier / stats, appended after the Spirits', () => {
    const rows: [string, number, number, number][] = [
      ['ce3_courier', 1, 1, 1], ['ce3_vendor', 2, 4, 2], ['ce3_seer', 3, 3, 3], ['ce3_conductor', 4, 4, 5],
      ['ce3_herald', 4, 4, 6], ['ce3_adept', 5, 5, 8], ['ce3_spellcore', 6, 7, 9], ['ce3_artificer', 6, 6, 10],
    ];
    const ids = poolFor('set3').buyable.map((c) => c.id);
    for (const [id, tier, a, h] of rows) {
      const d = CARD_INDEX[id]!;
      expect([d.tribe, d.tier, d.attack, d.health], id).toEqual(['celestial', tier, a, h]);
      expect(ids.indexOf(id), id + ' is in set 3 after the Spirits').toBeGreaterThan(ids.indexOf('sp3_grandprocession'));
    }
    expect(CARD_INDEX['ce3_seer']!.tribe2).toBe('undead');
    expect(poolFor('set2').buyable.some((c) => c.tribe === 'celestial'), 'set 2 has none').toBe(false);
  });
  it('the two archived name-twins carry an (Orbit) suffix, so no two cards share a display name', () => {
    expect(CARD_INDEX['c3_courier']!.name).toBe('Horizon Courier (Orbit)');
    expect(CARD_INDEX['c3_vendor']!.name).toBe('Starpath Vendor (Orbit)');
    // 2026-09-14 rename handoff: the live twins are Cosmo Express / Sugarnova now, so the (Orbit) suffix is
    // belt-and-braces — but every display name must still be unique.
    const names = Object.values(CARD_INDEX).map((c) => c.name);
    expect(names.filter((n) => n === 'Cosmo Express')).toHaveLength(1);
    expect(names.filter((n) => n === 'Sugarnova')).toHaveLength(1);
    expect(names.filter((n) => n === 'Horizon Courier')).toHaveLength(0);
  });
  it('Yazzus is Tier 7 4/8 — the one card for every set (owner 2026-09-16; T7 since 2026-09-11, "as he is in set 2")', () => {
    const d = CARD_INDEX['yazzus']!;
    expect([d.tier, d.attack, d.health]).toEqual([7, 4, 8]);
  });
});

describe('Horizon Courier — Echo: a random Shop spell', () => {
  it('dying in combat hands the player a spell; golden hands two', () => {
    for (const golden of [false, true]) {
      const r = simulate([bm('ce3_courier', { golden })], [foe(10, 10)], makeRng(7), CARD_INDEX,
        combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 1 }));
      const got = toHand(r.events);
      expect(got, `golden=${golden}`).toHaveLength(golden ? 2 : 1);
      for (const id of got) expect(CARD_INDEX[id]?.spell, id + ' is a spell').toBe(true);
    }
  });
});

describe('Sugarnova — your next Shop spell +4/+4 (owner handoff 2026-09-18; was +2/+2)', () => {
  it('(c) banks the bonus, the next stat spell reads it, and EXACTLY that cast spends it', () => {
    let s = run({ hand: [body('v', 'ce3_vendor'), spell('s1', 'starcrash'), spell('s2', 'starcrash')], board: [body('t', 'ce3_courier')] });
    s = play(s, 'v', { toIndex: 1 });
    expect(s.nextSpellBonus).toEqual({ attack: 4, health: 4 });
    expect([spellAttackBonus(s), spellHealthBonus(s)], 'folded into the spell-power read (so previews show it)').toEqual([4, 4]);
    const before = boardTotal(s);
    s = play(s, 's1', { targetUid: 't' });
    // Star Crash lands twice (target + a random friendly), each at +5/+7 PLUS the banked +4/+4.
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]]).toEqual([2 * 9, 2 * 11]);
    expect(s.nextSpellBonus, 'spent by that cast').toBeUndefined();
    const mid = boardTotal(s);
    s = play(s, 's2', { targetUid: 't' });
    expect([boardTotal(s)[0] - mid[0], boardTotal(s)[1] - mid[1]], 'the second spell is plain').toEqual([10, 14]);
  });
  it('a second Shout stacks; golden banks +8/+8', () => {
    let s = run({ hand: [body('v', 'ce3_vendor'), body('g', 'ce3_vendor', { golden: true })] });
    s = play(s, 'v', { toIndex: 0 });
    s = play(s, 'g', { toIndex: 1 });
    expect(s.nextSpellBonus).toEqual({ attack: 12, health: 12 });
  });
  it('(a) an unspent bonus SURVIVES End Turn → combat → the next shop, and the first Shop spell there spends it', () => {
    let s = run({ hand: [body('v', 'ce3_vendor')], board: [body('t', 'ce3_courier')] });
    s = play(s, 'v', { toIndex: 1 });
    expect(s.nextSpellBonus).toEqual({ attack: 4, health: 4 });
    // faceOmen → combat, settleCombat, resolveCombat opens the next shop (the equipment.test.ts turn helper)
    s = reduce(reduce(reduce(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    expect(s.nextSpellBonus, 'carried through combat').toEqual({ attack: 4, health: 4 });
    expect([spellAttackBonus(s), spellHealthBonus(s)], 'still folded into spell power next turn').toEqual([4, 4]);
    // Save / restore is a JSON round trip of RunState — the field rides along.
    const restored = JSON.parse(JSON.stringify(s)) as RunState;
    expect(restored.nextSpellBonus).toEqual({ attack: 4, health: 4 });
    // The first Shop spell of the new turn is the one that spends it.
    s = { ...s, hand: [...s.hand, spell('s1', 'starcrash')] };
    const t = s.board.find((c) => c.cardId === 'ce3_courier') ?? s.board[0]!;
    const before = t.attack;
    s = play(s, 's1', { targetUid: t.uid });
    expect(s.board.find((c) => c.uid === t.uid)!.attack - before, 'the +4 rode along (at least the primary)').toBeGreaterThanOrEqual(9);
    expect(s.nextSpellBonus, 'spent by the first Shop spell of the new turn').toBeUndefined();
  });
  it('(b) every Shop spell prints the pending +4/+4 live and IN PLACE (spellDisplayText through the spell-power read)', () => {
    const s = run({ nextSpellBonus: { attack: 4, health: 4 } });
    const a = spellAttackBonus(s), h = spellHealthBonus(s);
    expect([a, h]).toEqual([4, 4]);
    // Star Crash: base +5/+7 → +9/+11, greened in place, no appendix.
    const crash = spellDisplayText('starcrash', a, 0, h);
    expect(crash).toContain('{{+9/+11}}');
    expect(crash).not.toContain('+5/+7');
    expect(crash).not.toMatch(/Now \+/);
    // Stellar Chorus (base +2/+2, nothing cast yet) folds it the same way; a Gift (Tower Shield) prints its flat base.
    expect(spellDisplayText('stellarchorus', a, 0, h, 0, 0, 0, { anySpellsThisTurn: 0 })).toContain('{{+6/+6}}');
    expect(spellDisplayText('tower_shield', a, 0, h)).toBe(CARD_INDEX['tower_shield']!.text);
    // Without the bonus the printed base stands (no false green).
    expect(spellDisplayText('starcrash', 0, 0, 0)).toContain('+5/+7');
  });
  it('a Gift (Tower Shield) neither reads nor spends it', () => {
    let s = run({ hand: [spell('g', 'tower_shield')], board: [body('t', 'ce3_courier')], nextSpellBonus: { attack: 2, health: 2 } });
    const before = stats(at(s, 't'));
    s = play(s, 'g', { targetUid: 't' });
    const gained: [number, number] = [at(s, 't').attack - before[0], at(s, 't').health - before[1]];
    expect(gained, 'the printed Tower Shield value (+2/+1), no +2/+2').toEqual([2, 1]);
    expect(s.nextSpellBonus, 'still banked for the next SHOP spell').toEqual({ attack: 2, health: 2 });
  });
  it('a Ruby reads spell power without it (Rune of the Spellstone)', () => {
    const s = run({ nextSpellBonus: { attack: 2, health: 2 }, runeSpellstone: true, spellBonus: { attack: 1, health: 1 } });
    expect(rubyStatBonus(s)).toEqual({ attack: 1, health: 1 });
  });
});

describe('Gravestar Seer — +4 Attack per spell of any kind, permanently', () => {
  it('a Shop spell and a Ruby each pay it; golden pays +8', () => {
    let s = run({ hand: [spell('s', 'starcrash'), body('r', 'ruby')], board: [body('z', 'ce3_seer'), body('g', 'ce3_seer', { golden: true })] });
    s = play(s, 's', { targetUid: 'z' });
    expect(buffFrom(at(s, 'z'), 'Gravestar Seer')).toEqual([4, 0]);
    expect(buffFrom(at(s, 'g'), 'Gravestar Seer')).toEqual([8, 0]);
    s = play(s, 'r', { targetUid: 'z' });
    expect(buffFrom(at(s, 'z'), 'Gravestar Seer'), 'a Ruby is a spell too (owner 2026-09-10)').toEqual([8, 0]);
    expect(buffFrom(at(s, 'g'), 'Gravestar Seer')).toEqual([16, 0]);
  });
});

describe('Comet Conductor — Rally: a copy of the first spell you cast this turn, once per combat', () => {
  const fight = (golden: boolean, firstSpellThisTurnId?: string) =>
    simulate([bm('ce3_conductor', { golden, health: 40 })], [foe(1, 1), foe(1, 1), foe(1, 1)], makeRng(11), CARD_INDEX,
      combatSide({ tier: 6, firstSpellThisTurnId, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 1 }));
  it('pays exactly once across several attacks; golden pays two copies', () => {
    expect(toHand(fight(false, 'starcrash').events)).toEqual(['starcrash']);
    expect(toHand(fight(true, 'starcrash').events)).toEqual(['starcrash', 'starcrash']);
  });
  it('nothing cast this turn → nothing to copy', () => {
    expect(toHand(fight(false).events)).toEqual([]);
  });
  it('the reducer records the first Shop spell of the turn and carries it into combat', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: [body('t', 'ce3_seer')] });
    s = play(s, 's', { targetUid: 't' });
    expect(s.firstSpellThisTurnId).toBe('starcrash');
  });
});

describe('Falling Star Herald — Shout and Echo: a Star Crash', () => {
  it('the Shout mints one to hand (golden two)', () => {
    let s = run({ hand: [body('h', 'ce3_herald'), body('g', 'ce3_herald', { golden: true })] });
    s = play(s, 'h', { toIndex: 0 });
    expect(s.hand.filter((c) => c.cardId === 'starcrash')).toHaveLength(1);
    s = play(s, 'g', { toIndex: 1 });
    expect(s.hand.filter((c) => c.cardId === 'starcrash')).toHaveLength(3);
  });
  it('the Echo grants one in combat', () => {
    const r = simulate([bm('ce3_herald')], [foe(10, 10)], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(toHand(r.events)).toEqual(['starcrash']);
  });
});

describe('Crash Course — the first Star Crash you cast on this each turn casts an additional time (owner handoff 2026-09-18: Mirrorwing, gated to Star Crash)', () => {
  // Three Celestials and nothing else: a Star Crash is target +5/+7 plus one random friendly +5/+7, so every cast
  // adds exactly (10, 14) to the board total whichever body the random half picks.
  const board = () => [body('a', 'ce3_adept'), body('x', 'ce3_courier'), body('y', 'ce3_vendor')];
  it('one cast becomes two — the re-cast lands on THIS (its primary +5/+7 twice); the second Star Crash this turn is plain', () => {
    let s = run({ hand: [spell('s1', 'starcrash'), spell('s2', 'starcrash')], board: board() });
    const before = boardTotal(s);
    s = play(s, 's1', { targetUid: 'a' });
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]]).toEqual([2 * 10, 2 * 14]);
    expect(buffFrom(at(s, 'a'), 'Star Crash')[0], 'the primary landed on the Course twice').toBeGreaterThanOrEqual(10);
    expect(at(s, 'a').namedSpreadUsedThisTurn).toBe(true);
    const mid = boardTotal(s);
    s = play(s, 's2', { targetUid: 'a' });
    expect([boardTotal(s)[0] - mid[0], boardTotal(s)[1] - mid[1]], 'the second Star Crash this turn is a plain cast').toEqual([10, 14]);
  });
  it('gilded: 2 additional casts (three in all)', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: [body('a', 'ce3_adept', { golden: true }), body('x', 'ce3_courier')] });
    const before = boardTotal(s);
    s = play(s, 's', { targetUid: 'a' });
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]]).toEqual([3 * 10, 3 * 14]);
  });
  it('a different spell on it first does not spend it (the gate is the NAMED spell, not "first spell" — unlike Mirrorwing); a Star Crash on another body does nothing', () => {
    let s = run({ hand: [spell('g', 'tower_shield'), spell('s', 'starcrash'), spell('s2', 'starcrash')], board: [body('a', 'ce3_adept'), body('n', 'sandbag'), body('x', 'ce3_courier')] });
    s = play(s, 'g', { targetUid: 'a' });
    expect(at(s, 'a').namedSpreadUsedThisTurn, 'Tower Shield is not Star Crash').toBeFalsy();
    let before = boardTotal(s);
    s = play(s, 's2', { targetUid: 'x' });
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]], 'aimed elsewhere: a plain cast').toEqual([10, 14]);
    expect(at(s, 'a').namedSpreadUsedThisTurn).toBeFalsy();
    before = boardTotal(s);
    s = play(s, 's', { targetUid: 'a' });
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]], 'the first Star Crash ON IT still re-casts').toEqual([2 * 10, 2 * 14]);
  });
  it('the re-cast is a FULL cast: with Yazzus the original casts twice and so does the re-cast (4 in all)', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: [...board(), body('z', 'yazzus')] });
    const before = boardTotal(s);
    s = play(s, 's', { targetUid: 'a' });
    // original ×2 (Yazzus) + re-cast ×2 = 4 casts
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]]).toEqual([4 * 10, 4 * 14]);
  });
  it('two Crash Courses: a Star Crash on one never re-arms the other (each has its own once-per-turn latch, spent only by a Star Crash on ITSELF)', () => {
    let s = run({ hand: [spell('s', 'starcrash'), spell('s2', 'starcrash')], board: [body('a', 'ce3_adept'), body('b', 'ce3_adept')] });
    let before = boardTotal(s);
    s = play(s, 's', { targetUid: 'a' });
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]]).toEqual([2 * 10, 2 * 14]);
    expect(at(s, 'b').namedSpreadUsedThisTurn, 'b untouched').toBeFalsy();
    before = boardTotal(s);
    s = play(s, 's2', { targetUid: 'b' });
    expect([boardTotal(s)[0] - before[0], boardTotal(s)[1] - before[1]], 'b\'s own first Star Crash re-casts').toEqual([2 * 10, 2 * 14]);
  });
  it('the latch clears at the next Start of Turn', () => {
    let s = run({ hand: [spell('s', 'starcrash')], board: board() });
    s = play(s, 's', { targetUid: 'a' });
    expect(at(s, 'a').namedSpreadUsedThisTurn).toBe(true);
    // faceOmen → combat, settleCombat, resolveCombat opens the next shop (the equipment.test.ts turn helper)
    s = reduce(reduce(reduce(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    expect(at(s, 'a')?.namedSpreadUsedThisTurn).toBeFalsy();
  });
});

describe('Astral Spellcore — every 3 Shop spells cast while it is on the board: your Celestials +6/+6', () => {
  it('fires on every third cast (repeatable), itself included; golden +12/+12; the meter shows N/3', () => {
    const hand = ['s1', 's2', 's3', 's4', 's5', 's6'].map((u) => spell(u, 'starcrash'));
    let s = run({ hand, board: [body('c', 'ce3_spellcore'), body('g', 'ce3_spellcore', { golden: true }), body('n', 'sandbag')] });
    s = play(s, 's1', { targetUid: 'c' });
    s = play(s, 's2', { targetUid: 'c' });
    expect(at(s, 'c').spellProgress, 'the per-copy meter').toBe(2);
    expect(buffFrom(at(s, 'c'), 'Astral Spellcore')).toEqual([0, 0]);
    s = play(s, 's3', { targetUid: 'c' });
    expect(buffFrom(at(s, 'c'), 'Astral Spellcore'), 'plain + golden copies both fired on the third').toEqual([6 + 12, 6 + 12]);
    expect(buffFrom(at(s, 'g'), 'Astral Spellcore')).toEqual([6 + 12, 6 + 12]);
    expect(buffFrom(at(s, 'n'), 'Astral Spellcore'), 'not a Celestial').toEqual([0, 0]);
    s = play(s, 's4', { targetUid: 'c' });
    s = play(s, 's5', { targetUid: 'c' });
    expect(buffFrom(at(s, 'c'), 'Astral Spellcore'), 'not again until the sixth').toEqual([18, 18]);
    s = play(s, 's6', { targetUid: 'c' });
    expect(buffFrom(at(s, 'c'), 'Astral Spellcore'), 'repeatable — the sixth fires it again').toEqual([36, 36]);
    expect(at(s, 'c').spellProgress).toBe(6);
  });
  it('spells cast while it sat in hand do not count (owner 2026-09-11)', () => {
    let s = run({ hand: [body('c', 'ce3_spellcore'), spell('s1', 'starcrash'), spell('s2', 'starcrash'), spell('s3', 'starcrash')], board: [body('t', 'ce3_courier')] });
    s = play(s, 's1', { targetUid: 't' });
    s = play(s, 's2', { targetUid: 't' });
    s = play(s, 'c', { toIndex: 1 });
    expect(at(s, 'c').spellProgress ?? 0, 'nothing counted from the hand').toBe(0);
    s = play(s, 's3', { targetUid: 't' });
    expect(buffFrom(at(s, 'c'), 'Astral Spellcore'), 'one board cast is 1/3, not a payout').toEqual([0, 0]);
    expect(at(s, 'c').spellProgress).toBe(1);
  });
  it('the meter carries across turns', () => {
    let s = run({ hand: [spell('s1', 'starcrash'), spell('s2', 'starcrash')], board: [body('c', 'ce3_spellcore')] });
    s = play(s, 's1', { targetUid: 'c' });
    s = play(s, 's2', { targetUid: 'c' });
    s = reduce(reduce(reduce(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    expect(at(s, 'c')?.spellProgress, 'still 2/3 next turn').toBe(2);
  });
});

describe('Orrery Artificer — Equip Comet (4): your next spell casts 2 additional times', () => {
  it('the play grants Comet; activating costs 4 and banks 2 extra casts, which the next spell spends', () => {
    let s = run({ hand: [body('o', 'ce3_artificer'), spell('s', 'starcrash')] });
    s = play(s, 'o', { toIndex: 0 });
    expect(equipmentState(s).available.map((g) => g.equipmentId)).toContain('comet');
    expect(EQUIPMENT_INDEX['comet']!.baseCost).toBe(4);
    s = reduce(s, { type: 'selectEquipment', equipmentId: 'comet' } as Action);
    const gold = s.embers;
    s = reduce(s, { type: 'activateEquipment' } as Action);
    expect(s.embers).toBe(gold - 4);
    expect(s.nextSpellExtraCasts).toBe(2);
    const before = stats(at(s, 'o'));
    s = play(s, 's', { targetUid: 'o' });
    // a lone body: every cast is target + random friendly = +10/+14; 1 + 2 extra casts
    expect([at(s, 'o').attack - before[0], at(s, 'o').health - before[1]]).toEqual([3 * 10, 3 * 14]);
    expect(s.nextSpellExtraCasts, 'spent').toBeUndefined();
  });
  it('a gilded Artificer banks 4', () => {
    let s = run({ hand: [body('o', 'ce3_artificer', { golden: true })] });
    s = play(s, 'o', { toIndex: 0 });
    s = reduce(s, { type: 'selectEquipment', equipmentId: 'comet' } as Action);
    s = reduce(s, { type: 'activateEquipment' } as Action);
    expect(s.nextSpellExtraCasts).toBe(4);
  });
});
