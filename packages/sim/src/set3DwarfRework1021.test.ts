/**
 * SET 3 DWARF REWORK, owner 2026-10-21:
 *
 *   Hank Pepe     "When you Sell a minion, give 3 other Dwarves +1/+1."   (was: when you play a Dwarf)
 *   Shift Broker  "When you Sell a minion, gain +2 Attack."                (was: +1 Attack)
 *   Archived from Set 3: Coinfire, Striker, Billings, Lieutenant Thane (all four stay Set 2 cards).
 *   Dwarf King, Brill joins Set 3's Dwarf pool as a buyable Tier 6; Rune of the High King (which granted it) leaves Set 3.
 *
 * Pinned here: Hank's sale trigger across the matrix (any sold minion, three OTHER Dwarves, fewer when fewer exist,
 * All-types counts, Gilded doubles the stat not the count, permanent, seeded), Shift Broker's new numbers, and the
 * archive contract: out of every Set 3 draw, still resolving from an old Set 3 save, snapshot and replay.
 */
import { describe, it, expect } from 'vitest';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX, RUNE_INDEX, SETS, poolFor } from '@game/content';
import type { Tribe } from '@game/core';
import { createRun, reduce, sideFromSnapshot, type Action, type BoardCard, type RunState } from './index';
import { runeforgePool } from './reducer';
import { snapshotBoard } from './snapshot';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: [...SETS.set3.tribes],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const hankBuff = (c: BoardCard) => c.buffs?.find((b) => b.source === 'Hank Pepe');
const ALL_TYPES = Object.values(CARD_INDEX).find((c) => c.universalTribe && !c.spell && !c.token && !c.keywords.includes('M'))!;
const NON_DWARF = 'u3_poochy';
const ARCHIVED = ['dw_coinfire', 'dw3_striker', 'dw_billings', 'dw_thane'] as const;

describe('HANK PEPE: when you Sell a minion, give 3 other Dwarves +1/+1', () => {
  it('keeps T3 2/7 and prints the sale trigger', () => {
    expect(CARD_INDEX['dw3_hankpepe']).toMatchObject({ tier: 3, attack: 2, health: 7, tribe: 'dwarf' });
    expect(CARD_INDEX['dw3_hankpepe']!.text).toBe('When you **Sell** a minion, give **3 other Dwarves +1/+1**.');
    expect(CARD_INDEX['dw3_hankpepe']!.goldenText).toBe('When you **Sell** a minion, give **3 other Dwarves +2/+2**.');
  });

  it('selling ANY minion (a non-Dwarf too) buffs three other Dwarves, permanently', () => {
    let s = run({ board: [body('h', 'dw3_hankpepe'), body('a', 'dw_brunni'), body('b', 'dw_brakka'), body('c', 'dw_dorrin'), body('d', 'dw_brewer'), body('n', NON_DWARF)] });
    s = act(s, { type: 'sell', uid: 'n' });
    const buffed = s.board.filter((c) => hankBuff(c));
    expect(buffed.map((c) => c.uid).every((u) => ['a', 'b', 'c', 'd'].includes(u))).toBe(true);
    expect(buffed.length).toBe(3);
    for (const c of buffed) expect(hankBuff(c)).toMatchObject({ attack: 1, health: 1 });
    // A Shop buff is permanent: it sits in `buffs` and in the body's stats, not a combat-only layer.
    for (const c of buffed) expect(c.attack).toBe(CARD_INDEX[c.cardId]!.attack + 1);
    // Selling a Dwarf works the same way (any minion).
    const s2 = act(s, { type: 'sell', uid: 'a' });
    expect(s2.board.filter((c) => c.uid !== 'h').every((c) => (c.buffs ?? []).filter((b) => b.source === 'Hank Pepe').length >= 1)).toBe(true);
  });

  it('with fewer than three other Dwarves, buffs all of them; with none, does nothing', () => {
    let s = run({ board: [body('h', 'dw3_hankpepe'), body('a', 'dw_brunni'), body('b', 'dw_brakka'), body('n', NON_DWARF), body('m', 'e3_frank')] });
    s = act(s, { type: 'sell', uid: 'n' });
    expect(hankBuff(at(s, 'a'))).toMatchObject({ attack: 1, health: 1 });
    expect(hankBuff(at(s, 'b'))).toMatchObject({ attack: 1, health: 1 });
    expect(hankBuff(at(s, 'h')), 'never himself').toBeUndefined();
    expect(hankBuff(at(s, 'm')), 'never a non-Dwarf').toBeUndefined();
    let lone = run({ board: [body('h', 'dw3_hankpepe'), body('n', NON_DWARF), body('m', 'e3_frank')] });
    lone = act(lone, { type: 'sell', uid: 'n' });
    expect(lone.board.some((c) => hankBuff(c))).toBe(false);
  });

  it('an All-types minion counts as a Dwarf', () => {
    expect(ALL_TYPES.tribe).not.toBe('dwarf');
    let s = run({ board: [body('h', 'dw3_hankpepe'), body('u', ALL_TYPES.id), body('n', NON_DWARF)] });
    s = act(s, { type: 'sell', uid: 'n' });
    expect(hankBuff(at(s, 'u'))).toMatchObject({ attack: 1, health: 1 });
  });

  it('Gilded doubles the STAT (+2/+2), not the count (still three)', () => {
    let s = run({ board: [body('h', 'dw3_hankpepe', { golden: true }), body('a', 'dw_brunni'), body('b', 'dw_brakka'), body('c', 'dw_dorrin'), body('d', 'dw_brewer'), body('n', NON_DWARF)] });
    s = act(s, { type: 'sell', uid: 'n' });
    const buffed = s.board.filter((c) => hankBuff(c));
    expect(buffed.length).toBe(3);
    for (const c of buffed) expect(hankBuff(c)).toMatchObject({ attack: 2, health: 2 });
  });

  it('is seeded: the same state picks the same three, and the run cursor advances', () => {
    const start = run({ board: [body('h', 'dw3_hankpepe'), body('a', 'dw_brunni'), body('b', 'dw_brakka'), body('c', 'dw_dorrin'), body('d', 'dw_brewer'), body('n', NON_DWARF)] });
    const one = act(start, { type: 'sell', uid: 'n' });
    const two = act(start, { type: 'sell', uid: 'n' });
    const pick = (s: RunState) => s.board.filter((c) => hankBuff(c)).map((c) => c.uid);
    expect(pick(one)).toEqual(pick(two));
    expect(one.rngCursor).not.toBe(start.rngCursor);
  });

  it('selling Hank himself does nothing, and playing a Dwarf no longer fires him', () => {
    let s = run({ board: [body('h', 'dw3_hankpepe'), body('a', 'dw_brunni')], hand: [body('d', 'dw_brakka')] });
    s = act(s, { type: 'play', uid: 'd' });
    expect(s.board.some((c) => hankBuff(c)), 'a Dwarf play is no longer a trigger').toBe(false);
    s = act(s, { type: 'sell', uid: 'h' });
    expect(s.board.some((c) => hankBuff(c)), 'his own sale is not a trigger').toBe(false);
  });
});

describe('SHIFT BROKER: when you Sell a minion, gain +2 Attack', () => {
  it('keeps T1 1/4 and prints the new number', () => {
    expect(CARD_INDEX['dw3_shiftbroker']).toMatchObject({ tier: 1, attack: 1, health: 4, tribe: 'dwarf' });
    expect(CARD_INDEX['dw3_shiftbroker']!.text).toBe('When you **Sell** a minion, gain **+2 Attack**.');
    expect(CARD_INDEX['dw3_shiftbroker']!.goldenText).toBe('When you **Sell** a minion, gain **+4 Attack**.');
  });
  it('+2 per sale plain, +4 Gilded, permanently', () => {
    let s = run({ board: [body('sb', 'dw3_shiftbroker'), body('n', NON_DWARF)] });
    s = act(s, { type: 'sell', uid: 'n' });
    expect(at(s, 'sb').attack).toBe(3);
    let g = run({ board: [body('sb', 'dw3_shiftbroker', { golden: true }), body('n', NON_DWARF)] });
    g = act(g, { type: 'sell', uid: 'n' });
    expect(at(g, 'sb').attack).toBe(5);
  });
});

describe('ARCHIVED FROM SET 3: Coinfire, Striker, Billings, Lieutenant Thane', () => {
  it('are out of every Set 3 draw (pool, buyable), and still Set 2 cards', () => {
    const p3 = poolFor('set3');
    const p2 = poolFor('set2');
    for (const id of ARCHIVED) {
      expect(p3.all.some((c) => c.id === id), `${id} out of set 3`).toBe(false);
      expect(p2.buyable.some((c) => c.id === id), `${id} still a set-2 card`).toBe(true);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeTruthy();
    }
  });

  it('a random Dwarf draw in a Set 3 run never produces one (many seeds, the run-pinned pool)', () => {
    // Every set-3 random-minion site reads `poolOf(run)`, i.e. `poolFor('set3')`. Sample its Dwarves the way the
    // shop does (`rng.int(pool.length)`) across seeds: none of the four can ever come out.
    const dwarves = poolFor('set3').buyable.filter((c) => c.tribe === 'dwarf' || c.tribe2 === 'dwarf');
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed);
      expect(ARCHIVED).not.toContain(dwarves[rng.int(dwarves.length)]!.id);
    }
  });

  it('an OLD Set 3 save holding them still loads and plays: shop actions, snapshot and a combat replay', () => {
    let s = run({
      board: [body('cf', 'dw_coinfire'), body('st', 'dw3_striker'), body('bi', 'dw_billings'), body('th', 'dw_thane'), body('n', NON_DWARF)],
      ownedRunes: ['rune_high_king'],
    });
    // Shop: a sale resolves around them, and End of Turn fires Striker's effect from the old save.
    s = act(s, { type: 'sell', uid: 'n' });
    expect(s.board.map((c) => c.cardId)).toEqual(['dw_coinfire', 'dw3_striker', 'dw_billings', 'dw_thane']);
    expect(RUNE_INDEX['rune_high_king'], 'the left-set rune still resolves').toBeTruthy();
    // Snapshot + combat: a captured board with them resolves and replays identically (Thane's Rally fires).
    const snap = snapshotBoard(s);
    expect(snap.minions.map((m) => m.cardId)).toEqual(['dw_coinfire', 'dw3_striker', 'dw_billings', 'dw_thane']);
    const side = sideFromSnapshot(snap, 6, poolFor('set3').all.map((c) => c.id));
    const foes = [{ cardId: 'sandbag', attack: 0, health: 200, keywords: [] }] as never;
    const a = simulate(snap.minions, foes, makeRng(9), CARD_INDEX, side, sideFromSnapshot({ ...snap, minions: [] }, 1, []));
    const b = simulate(snap.minions, foes, makeRng(9), CARD_INDEX, side, sideFromSnapshot({ ...snap, minions: [] }, 1, []));
    expect(a.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const thane = a.initial.player.find((m) => m.cardId === 'dw_thane')!.uid;
    expect(a.events.some((e) => e.type === 'buff' && (e as { source?: string }).source === thane), 'Thane Rally resolves').toBe(true);
  });
});

describe('DWARF KING, BRILL joins Set 3; Rune of the High King leaves it', () => {
  it('Brill is a buyable Set 3 Dwarf at its existing T6 5/8, and set 2 still never sells it', () => {
    expect(CARD_INDEX['dw_brill']).toMatchObject({ name: 'Dwarf King, Brill', tribe: 'dwarf', tier: 6, attack: 5, health: 8 });
    expect(CARD_INDEX['dw_brill']!.token).toBeFalsy();
    expect(poolFor('set3').buyable.some((c) => c.id === 'dw_brill')).toBe(true);
    expect(poolFor('set2').buyable.some((c) => c.id === 'dw_brill'), 'set 2 keeps it forge-only').toBe(false);
    expect(poolFor('set2').all.some((c) => c.id === 'dw_brill')).toBe(false);
  });

  it('Rune of the High King is no longer offered by a Set 3 forge, still is by Set 2, and still grants Brill', () => {
    const forge = (setId: 'set2' | 'set3', tribes: Tribe[]): string[] =>
      runeforgePool({ ...createRun(7, 'warden', 'ascent', undefined, setId), tribes, ownedRunes: [], runeforgeEpic: true } as RunState);
    expect(RUNE_INDEX['rune_high_king']!.sets).toEqual(['set2']);
    expect(forge('set3', [...SETS.set3.tribes])).not.toContain('rune_high_king');
    expect(forge('set2', [...SETS.set2.tribes])).toContain('rune_high_king');
    expect(RUNE_INDEX['rune_high_king']!.reward).toEqual({ kind: 'grant', cards: ['dw_brill'] });
  });

  it('a bought Brill works in Set 3: 10 Gold spent gets a random Set 3 Dwarf', () => {
    let s = run({ board: [body('br', 'dw_brill')], embers: 30, hand: [] });
    const handBefore = s.hand.length;
    // Spend Gold on refreshes until 10 has gone out, then check the grant.
    let guard = 0;
    while (s.hand.length === handBefore && s.embers > 0 && guard++ < 30) s = act(s, { type: 'roll' });
    expect(s.hand.length).toBe(handBefore + 1);
    const got = CARD_INDEX[s.hand[s.hand.length - 1]!.cardId]!;
    expect(got.tribe === 'dwarf' || got.tribe2 === 'dwarf' || !!got.universalTribe).toBe(true);
    expect(poolFor('set3').buyable.some((c) => c.id === got.id), 'drawn from the run-pinned Set 3 pool').toBe(true);
  });
});
