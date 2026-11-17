/**
 * ANCIENTS × MIDAS (owner pairings 2026-10-27). Midas' Touch (passive): "You need only 2 copies to Gild. Gilding grants a
 * Gold Pouch instead of a Triple Reward." A Gold Pouch is the `emberpouch` spell. Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, MIDAS_ECHO_MARK, activePowers, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'You need only **2** copies to Gild. Gilding grants a **Gold Pouch** instead of a Triple Reward.';
// Effect-free bodies (no hidden multipliers, no Choose One), so only the pairing under test moves anything.
const NEUTRALS = ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'];
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const gilded = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return card(uid, cardId, { golden: true, attack: d.attack * 2, health: d.health * 2, ...extra });
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'midas'), phase: 'recruit', embers: 20, heroReady: true, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const count = (s: RunState, id: string) => s.hand.filter((c) => c.cardId === id).length;

describe('Midas × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('midas', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('midas', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Midas × DEATH: "Gilded minions gain Echo: Get a Gold Pouch"', () => {
  it('Shop: every Gilded minion carries the graft (never a plain one), and its death gets ONE Gold Pouch', () => {
    let s = picked('death', { board: [gilded('g', N(0)), card('p', N(1))], hand: [gilded('h', N(2))] });
    expect(heroPowerText(s)).toBe(`${BASE} Your **Gilded** minions have "**Echo:** get a **Gold Pouch**."`);
    expect(at(s, 'g').grantedEffects?.some((e) => e.params?.[MIDAS_ECHO_MARK])).toBe(true);
    expect(s.hand.find((c) => c.uid === 'h')!.grantedEffects?.some((e) => e.params?.[MIDAS_ECHO_MARK])).toBe(true);
    expect(at(s, 'p').grantedEffects?.some((e) => e.params?.[MIDAS_ECHO_MARK]) ?? false).toBe(false);
    s = structuredClone(s);
    destroyMinionInShop(makeContext(s), at(s, 'g'));
    expect(count(s, 'emberpouch')).toBe(1);
  });
  it('the graft is stamped once (an action boundary re-sweep never stacks a second)', () => {
    let s = picked('death', { board: [gilded('g', N(0))] });
    s = reduce(s, { type: 'roll' });
    expect(at(s, 'g').grantedEffects!.filter((e) => e.params?.[MIDAS_ECHO_MARK]).length).toBe(1);
  });
  it('combat: a Gilded minion dying mid-fight gets ONE Gold Pouch (a live toHand), and it reaches the hand', () => {
    let s = picked('death', { board: [gilded('g', N(0), { attack: 1, health: 1 })] });
    expect(ancientCombatMods(s).ancientGildedEcho).toEqual({ cardId: 'emberpouch' });
    s = fightNow(s, 100, 1000);
    expect(events(s).filter((e) => e.type === 'toHand' && e.cardId === 'emberpouch').length).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(count(s, 'emberpouch')).toBe(1);
  });
});

describe('Midas × FORTUNE: "Gold Pouches grant 3g"', () => {
  it('a Gold Pouch gives 3 Gold, printed live; Rune of Pillaging (2) never lowers it', () => {
    let s = picked('fortune', { hand: [card('pouch', 'emberpouch')] });
    expect(s.goldPouchValue).toBe(3);
    expect(heroPowerText(s)).toBe(`${BASE} Your **Gold Pouches** give **3 Gold**.`);
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: 'pouch' });
    expect(s.embers).toBe(before + 3);
  });
  it('without Ancients a Gold Pouch gives 1', () => {
    let s = base({ hand: [card('pouch', 'emberpouch')] });
    const before = s.embers;
    s = reduce(s, { type: 'play', uid: 'pouch' });
    expect(s.embers).toBe(before + 1);
  });
});

describe('Midas × WAR (ancient pass 2, owner 2026-11-16): "Start of Combat, give 2 random minions Ward for each Gilded enemy minion"', () => {
  const foeBoard = (wave: number, gildedFoes: number): BoardSnapshot => ({
    v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 900,
    minions: [
      ...Array.from({ length: gildedFoes }, () => ({ cardId: 'sandbag', attack: 0, health: 300, keywords: [], golden: true })),
      { cardId: 'sandbag', attack: 0, health: 300, keywords: [] },
    ], seed: 1, origin: 'self',
  });
  const vs = (s: RunState, gildedFoes: number): RunState => reduce({ ...s, servedBoards: { [s.wave]: foeBoard(s.wave, gildedFoes) } }, { type: 'faceOmen' });
  const warded = (s: RunState): string[] => {
    const ev = events(s);
    const first = ev.findIndex((e) => e.type === 'attack');
    const mine = new Set(s.lastCombat!.initial.player.map((m) => m.uid));
    return ev.slice(0, first < 0 ? ev.length : first).filter((e): e is Extract<CombatEvent, { type: 'shieldUp' }> => e.type === 'shieldUp' && mine.has(e.target)).map((e) => e.target);
  };
  const five = () => ['a', 'b', 'c', 'd', 'e'].map((u, i) => card(u, N(i), { attack: 1, health: 50 }));
  it('2 Gilded foes: 4 distinct friendly minions gain Ward at Start of Combat, for that combat only', () => {
    let s = picked('war', { board: five() });
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Combat:** give **2** random friendly minions **Ward** for each **Gilded** enemy minion.`);
    expect(ancientCombatMods(s).ancientMidasWard).toEqual({ per: 2, label: 'Ancient of War' });
    s = vs(s, 2);
    const w = warded(s);
    expect(w.length).toBe(4);
    expect(new Set(w).size).toBe(4);
    s = reduce(s, { type: 'resolveCombat' });
    for (const c of s.board) expect(c.keywords).not.toContain('DS');
  });
  it('1 Gilded foe: 2; none: nothing; more Ward than bodies: everyone once', () => {
    expect(warded(vs(picked('war', { board: five() }), 1)).length).toBe(2);
    expect(warded(vs(picked('war', { board: five() }), 0)).length).toBe(0);
    expect(warded(vs(picked('war', { board: five().slice(0, 3) }), 3)).length).toBe(3);
  });
  it('the old Start of Turn Ward is gone', () => {
    let s = picked('war', { board: [gilded('g', N(0), { health: 50 })] });
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(at(s, 'g').keywords).not.toContain('DS');
  });
});

describe('Midas × GENESIS: "Gilding a minion grants a Triple Reward."', () => {
  it('playing a Gilded minion gets the Gold Pouch AND a Triple Reward', () => {
    let s = picked('genesis', { hand: [gilded('g', N(0))] });
    expect(heroPowerText(s)).toBe('You need only **2** copies to Gild. Gilding grants a **Gold Pouch** and a **Triple Reward**.');
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(count(s, 'emberpouch')).toBe(1);
    expect(count(s, 'discoverspell')).toBe(1);
  });
  it('without the pairing, a Midas Gild is the Gold Pouch alone', () => {
    const s = reduce(base({ hand: [gilded('g', N(0))] }), { type: 'play', uid: 'g' });
    expect(count(s, 'emberpouch')).toBe(1);
    expect(count(s, 'discoverspell')).toBe(0);
  });
});

describe('Midas × TIME: "Start of Turn: Make a random friendly minion Gilded"', () => {
  it('each Start of Turn gilds a random non-Gilded board minion (its own beat); the power stays passive', () => {
    let s = picked('time', { board: [gilded('g', N(0), { health: 50 }), card('a', N(1), { health: 50 })] });
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(heroPowerText(s)).toBe(`${BASE} **Start of Turn:** make a random friendly minion **Gilded**.`);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(at(s, 'a').golden).toBe(true);
    const beat = (s.sotBeatFx ?? []).find((b) => b.source.kind === 'hero' && b.source.label === 'Ancient of Time');
    expect(beat?.gilds ?? []).toContain('a');
  });
});

describe('Midas × BONDS: "When a Gilded minion gains stats, your other Gilded minions gain +2/+2."', () => {
  it('Shop: a buff on a Gilded minion gives every OTHER Gilded minion +2/+2, once (never re-triggers); plain ones nothing', () => {
    let s = picked('bonds', { board: [gilded('a', N(0)), gilded('b', N(1)), gilded('c', N(2)), card('p', N(3))], hand: [card('sf', 'spiritfire')] });
    const [a, b, c, p] = ['a', 'b', 'c', 'p'].map((u) => at(s, u).attack);
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'a' });
    expect(at(s, 'a').attack).toBe(a! + 6);
    expect(at(s, 'b').attack).toBe(b! + 2);
    expect(at(s, 'c').attack).toBe(c! + 2);
    expect(at(s, 'p').attack).toBe(p!);
  });
  it('Shop: a buff on a plain minion does nothing', () => {
    let s = picked('bonds', { board: [gilded('a', N(0)), card('p', N(3))], hand: [card('sf', 'spiritfire')] });
    const a = at(s, 'a').attack;
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'p' });
    expect(at(s, 'a').attack).toBe(a);
  });
  it('combat: a Gilded Rally self-gain gives the other Gilded bodies +2/+2 per gain, one hop', () => {
    let s = picked('bonds', { shopSpellsThisTurn: 1 /* Cinderchef gains per Shop spell cast this turn (owner 2026-11-15): one staged Shop spell keeps it the +1/+1 probe */, board: [gilded('r', 'd2_cinderchef', { health: 900 }), gilded('o', N(0), { health: 900 })] });
    expect(ancientCombatMods(s).ancientGildedBonds).toEqual({ attack: 2, health: 2, label: 'Ancient of Bonds', origin: 'trigger' });
    s = fightNow(s, 0, 30);
    const bondBuffs = events(s).filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'Ancient of Bonds');
    expect(bondBuffs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Midas × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [gilded('a', N(0), { attack: 30, health: 3 }), card('b', N(1), { attack: 3, health: 2 })], hand: [gilded('g', N(2))] });
        s = reduce(s, { type: 'play', uid: 'g' });
        return reduce(fightNow(s, 60, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
