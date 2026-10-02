/**
 * ANCIENTS × XEROX (owner pairings 2026-10-02). Copy Machine: "Summon an exact copy of a friendly minion. Needs a free
 * board slot. Once per game." Every pairing in the phase(s) it fires in. "A copy" is Copy Machine's EXACT copy
 * everywhere (current stats, buffs, keywords, gilding), never a pool body.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ancientCombatMods, ancientOfferText, boardPairs, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { addBuff, destroyMinionInShop, makeContext, stampXeroxBond } from './recruit';

const BASE = 'Summon an exact copy of a friendly minion. Needs a free board slot. Once per game.';
/** An effect-less Tier 1 body (3/3), so a death, a play or a sale never muddies the numbers. */
const T1 = 'hm_test_squire';
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A second effect-less body, distinct from T1 (for pair counting). */
const OTHER = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.ruby && !c.token && c.id !== T1 && c.effects.length === 0 && c.keywords.length === 0)!.id;
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'xerox'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const copyMachine = (s: RunState, uid: string): RunState => reduce(s, { type: 'heroPower', uid });
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const playerSummons = (ev: CombatEvent[]) => ev.filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player');

describe('Xerox × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('xerox', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('xerox', id)).not.toMatch(/—|--/);
    }
  });
  it('the fixtures are effect-less minions', () => {
    expect(CARD_INDEX[T1]!.effects.length).toBe(0);
    expect(CARD_INDEX[OTHER]!.effects.length).toBe(0);
  });
  it('without Ancients, Copy Machine is still an exact copy beside the original, once per game, with no bond', () => {
    let s = base({ board: [card('a', T1, { attack: 9, health: 4, keywords: ['T'], buffs: [{ source: 'X', attack: 6, health: 1, count: 1 }] })] });
    s = copyMachine(s, 'a');
    expect(s.board.length).toBe(2);
    const copy = s.board[1]!;
    expect({ ...copy, uid: 'a' }).toEqual({ ...at(s, 'a'), resummon: false });
    expect(s.heroPowerSpent).toBe(true);
    expect(copyMachine(s, 'a'), 'once per game').toBe(s);
    expect(s.ancients).toBeUndefined();
  });
});

describe('Xerox × DEATH — Avenge (5): summon a copy of your highest Attack minion (Shop and combat, one count)', () => {
  it('the 5th Shop death copies the highest-Attack minion (ties: the left-most), beside it', () => {
    let s = picked('death', { board: [card('a', T1, { attack: 2 }), card('b', T1, { attack: 7, health: 5 }), card('c', T1, { attack: 7 }), ...['d1', 'd2', 'd3', 'd4', 'd5'].map((u) => card(u, OTHER))] });
    s = structuredClone(s);
    for (const u of ['d1', 'd2', 'd3', 'd4']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.ancients!.xeroxDeaths).toBe(4);
    expect(s.board.length).toBe(4);
    destroyMinionInShop(makeContext(s), at(s, 'd5'));
    expect(s.ancients!.xeroxDeaths, 'the count resets on a copy').toBe(0);
    expect(s.board.map((c) => c.uid).slice(0, 3)).toEqual(['a', 'b', s.board[2]!.uid]);
    const copy = s.board[2]!;
    expect(copy.uid).not.toBe('c');
    expect(copy).toMatchObject({ cardId: T1, attack: 7, health: 5 });
  });
  it('on a full board the dying body vacates its slot, so the copy takes it (never an 8th body)', () => {
    let s = picked('death', { board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => card(u, T1, { attack: u === 'c' ? 6 : 1 })) });
    s = structuredClone(s);
    s.ancients!.xeroxDeaths = 4;
    destroyMinionInShop(makeContext(s), at(s, 'a'));
    expect(s.board.length).toBe(7);
    expect(s.board.filter((c) => c.attack === 6).length, 'the highest-Attack minion was copied').toBe(2);
  });
  it('combat: the carried count + this fight\'s deaths fire the Avenge MID-FIGHT, and settle carries the remainder', () => {
    let s = picked('death', { board: [card('big', T1, { attack: 9, health: 1 }), ...['a', 'b', 'c'].map((u) => card(u, T1, { attack: 1, health: 1 }))] });
    s = { ...s, ancients: { ...s.ancients!, xeroxDeaths: 4 } };
    expect(ancientCombatMods(s).ancientXeroxAvenge).toMatchObject({ every: 5, tick: 4 });
    s = fightNow(s, 100, 1000);
    const ev = events(s);
    const cast = ev.findIndex((e) => e.type === 'sc' && e.text.startsWith('Ancient of Death: a copy of'));
    expect(cast).toBeGreaterThan(-1);
    const firstDeath = ev.findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(cast, 'right after the first friendly death (the 5th counted)').toBeGreaterThan(firstDeath);
    expect(playerSummons(ev).length).toBeGreaterThanOrEqual(1);
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.xeroxDeaths).toBe((4 + deaths) % 5);
  });
  it('prints the live countdown on the power (and folds the fight\'s deaths in)', () => {
    const s = picked('death');
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (5):** summon a copy of your highest Attack minion (**5** more to go).`);
    const t = { ...s, ancients: { ...s.ancients!, xeroxDeaths: 3 } };
    expect(heroPowerText(t)).toContain('(**2** more to go)');
    expect(heroPowerText(t, 0, { friendlyDeaths: 1 })).toContain('(**1** more to go)');
  });
});

describe('Xerox × FORTUNE — gain 4 Gold next turn for every pair on board', () => {
  it('counts pairs as floor(n / 2) per card, Gilded and plain the same card', () => {
    expect(boardPairs({ board: [card('a', T1), card('b', T1), card('c', T1), card('d', OTHER), card('e', OTHER, { golden: true })] })).toBe(2);
    expect(boardPairs({ board: [card('a', T1), card('b', T1), card('c', T1), card('d', T1)] })).toBe(2);
    expect(boardPairs({ board: [card('a', T1), card('d', OTHER)] })).toBe(0);
  });
  it('banks 4 Gold per pair at End of Turn, paid next turn; the power prints the live pairs and Gold', () => {
    const board = [card('a', T1, { health: 99 }), card('b', T1, { health: 99 }), card('c', OTHER, { health: 99 }), card('d', OTHER, { health: 99 })];
    let s = picked('fortune', { board });
    expect(heroPowerText(s)).toContain('(**2** now: **8 Gold**)');
    const before = s.bonusEmbersNextTurn ?? 0;
    s = fightNow(s, 0, 400);
    expect(s.bonusEmbersNextTurn ?? 0).toBe(before + 8);
    expect(s.ancients!.xeroxPairGold?.gold).toBe(8);
  });
  it('no pairs, no Gold', () => {
    let s = picked('fortune', { board: [card('a', T1, { health: 99 }), card('c', OTHER, { health: 99 })] });
    const before = s.bonusEmbersNextTurn ?? 0;
    s = fightNow(s, 0, 400);
    expect(s.bonusEmbersNextTurn ?? 0).toBe(before);
  });
});

describe('Xerox × WAR — Start of Combat: summon a copy of your highest Health minion', () => {
  it('copies the highest-Health body (ties: the left-most) at Start of Combat, with its current stats', () => {
    const s = fightNow(picked('war', { board: [card('a', T1, { attack: 2, health: 11 }), card('b', T1, { attack: 5, health: 11 }), card('c', T1, { attack: 9, health: 3 })] }));
    const ev = events(s);
    const sc = ev.findIndex((e) => e.type === 'sc' && e.text.startsWith('Ancient of War: a copy of'));
    expect(sc).toBeGreaterThan(-1);
    const firstAttack = ev.findIndex((e) => e.type === 'attack');
    expect(sc, 'Start of Combat, before any attack').toBeLessThan(firstAttack);
    const summon = playerSummons(ev)[0]!;
    expect(summon.minion).toMatchObject({ cardId: T1, attack: 2, health: 11 });
  });
  it('a full board copies nothing', () => {
    const s = fightNow(picked('war', { board: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => card(u, T1)) }));
    expect(events(s).some((e) => e.type === 'sc' && e.text.startsWith('Ancient of War'))).toBe(false);
  });
  it('the run board is untouched after the fight (the copy is combat-only)', () => {
    let s = fightNow(picked('war', { board: [card('a', T1, { health: 50 })] }), 0, 400);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.length).toBe(1);
  });
});

describe('Xerox × GENESIS — Copy Machine gains another use', () => {
  it('two uses for the game; the third is refused; the power prints the uses left', () => {
    let s = picked('genesis', { board: [card('a', T1), card('b', OTHER)] });
    expect(s.ancients!.xeroxCharges).toBe(1);
    expect(heroPowerText(s)).toContain('**2** uses left');
    s = copyMachine(s, 'a');
    expect(s.board.length).toBe(3);
    expect(heroPowerText(s)).toContain('**1** uses left');
    s = copyMachine(s, 'b');
    expect(s.board.length).toBe(4);
    expect(s.ancients!.xeroxCharges).toBe(0);
    expect(copyMachine(s, 'b'), 'no use left').toBe(s);
  });
  it('picked AFTER Copy Machine was spent, it is usable once more', () => {
    // (Two different cards: a third Test Squire would complete a triple.)
    let s = copyMachine(enableAncients(base({ board: [card('a', T1), card('b', OTHER)] })), 'a');
    expect(s.heroPowerSpent).toBe(true);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['genesis', 'death', 'war'] } };
    s = reduce(s, { type: 'pickAncient', id: 'genesis' });
    s = copyMachine(s, 'b');
    expect(s.board.length).toBe(4);
    expect(copyMachine(s, 'b')).toBe(s);
  });
});

describe('Xerox × TIME — Start of Turn: get a copy of a minion you control', () => {
  it('the next Shop opens with an exact copy of a board minion in hand (seeded, deterministic)', () => {
    const board = [card('a', T1, { attack: 8, health: 40 }), card('b', OTHER, { attack: 2, health: 40, keywords: ['T'] })];
    const run = (): RunState => reduce(fightNow(picked('time', { board }), 0, 400), { type: 'resolveCombat' });
    const s = run();
    const copies = s.hand.filter((c) => c.cardId === T1 || c.cardId === OTHER);
    expect(copies.length).toBe(1);
    const src = s.board.find((c) => c.cardId === copies[0]!.cardId)!;
    expect(copies[0]).toMatchObject({ attack: src.attack, health: src.health, keywords: src.keywords });
    expect(copies[0]!.uid).not.toBe(src.uid);
    expect(run().hand.map((c) => c.cardId), 'same seed, same copy').toEqual(s.hand.map((c) => c.cardId));
  });
  it('an empty board gets nothing', () => {
    const s = reduce(fightNow(picked('time', { board: [] }), 0, 400), { type: 'resolveCombat' });
    expect(s.hand.some((c) => c.cardId === T1 || c.cardId === OTHER)).toBe(false);
  });
});

describe('Xerox × BONDS — the copy and the original are bound; a triple breaks it', () => {
  const bound = (): RunState => copyMachine(picked('bonds', { board: [card('a', T1, { health: 40 })] }), 'a');
  it('Copy Machine binds the copy to its original, and the power says who is bound', () => {
    const s = bound();
    const copy = s.board[1]!;
    expect(s.ancients!.xeroxBond).toEqual({ a: 'a', b: copy.uid });
    expect(heroPowerText(s)).toContain('Bound now: **Test Squire** and its copy.');
  });
  it('a Shop gain on either end is gained by the other, once (no echo)', () => {
    const s = structuredClone(bound());
    stampXeroxBond(s);
    const copy = s.board[1]!;
    addBuff(at(s, 'a'), 'Test', 2, 3);
    expect(at(s, 'a')).toMatchObject({ attack: 5, health: 43 });
    expect(copy).toMatchObject({ attack: 5, health: 43 });
    addBuff(copy, 'Test', 1, 0);
    expect(at(s, 'a').attack).toBe(6);
    expect(copy.attack).toBe(6);
  });
  it('the bond survives save / restore (it is run state) and still mirrors after it', () => {
    const saved = JSON.parse(JSON.stringify(bound())) as RunState;
    expect(saved.ancients!.xeroxBond).toBeDefined();
    const s = reduce(saved, { type: 'reposition', uid: 'a', toIndex: 1 }); // any action re-stamps the hook
    addBuff(at(s, 'a'), 'Test', 4, 0);
    expect(s.board.find((c) => c.uid !== 'a')!.attack).toBe(7);
  });
  it('a triple breaks it for good', () => {
    let s = bound();
    s = { ...s, hand: [card('h', T1)] };
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(s.board.some((c) => c.uid === 'a'), 'consumed into the triple').toBe(false);
    expect(s.ancients!.xeroxBond).toBeUndefined();
    expect(s.ancients!.xeroxBondBroken).toBe(true);
    expect(heroPowerText(s)).toContain('The bond is broken.');
  });
  it('selling either end breaks it', () => {
    const s0 = bound();
    const s = reduce(s0, { type: 'sell', uid: s0.board[1]!.uid });
    expect(s.ancients!.xeroxBond).toBeUndefined();
    expect(s.ancients!.xeroxBondBroken).toBe(true);
    addBuff(at(s, 'a'), 'Test', 5, 5); // nothing to mirror onto, and nothing breaks
    expect(at(s, 'a').attack).toBe(8);
  });
  it('a Shop death of either end breaks it', () => {
    const s = structuredClone(bound());
    destroyMinionInShop(makeContext(s), at(s, 'a'));
    expect(s.ancients!.xeroxBond).toBeUndefined();
    expect(s.ancients!.xeroxBondBroken).toBe(true);
  });
  it('a COMBAT death does not break it (the run board keeps both bodies)', () => {
    let s = picked('bonds', { board: [card('a', T1, { attack: 1, health: 1 })] });
    s = copyMachine(s, 'a');
    s = reduce(fightNow(s, 100, 1000), { type: 'resolveCombat' });
    expect(s.ancients!.xeroxBond).toBeDefined();
  });
  it('threads the bond into the fight and mirrors a combat gain onto the partner (sourceUid match), once', () => {
    const selfBuff = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.effects.some((e) => e.on === 'onAttack' && /Self|self/.test(e.do)))!;
    const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
      ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] } as unknown as BoardMinion);
    const player = [bm(selfBuff.id, 'pA', 3, 50), bm(T1, 'pB', 3, 50)];
    const enemy = [bm('sandbag', 'e0', 0, 500)];
    const fight = (bond: boolean) => simulate(player, enemy, makeRng(7), CARD_INDEX,
      combatSide({ tier: 5, questMods: bond ? { ancientXeroxBond: { a: 'pA', b: 'pB', label: 'Ancient of Bonds' } } : {} }), combatSide({ tier: 5 }));
    const withBond = fight(true).events as CombatEvent[];
    const mirrored = withBond.filter((e) => e.type === 'buff' && e.source === 'Ancient of Bonds');
    expect(mirrored.length).toBeGreaterThan(0);
    const without = fight(false).events as CombatEvent[];
    expect(without.some((e) => e.type === 'buff' && e.source === 'Ancient of Bonds')).toBe(false);
    // Deterministic: the same fight twice is byte-identical.
    expect(JSON.stringify(fight(true).events)).toBe(JSON.stringify(withBond));
  });
  it('the combat mods carry the bond only while Bonds is picked and the bond holds', () => {
    expect(ancientCombatMods(bound()).ancientXeroxBond).toMatchObject({ a: 'a' });
    expect(ancientCombatMods(picked('death')).ancientXeroxBond).toBeUndefined();
  });
});
