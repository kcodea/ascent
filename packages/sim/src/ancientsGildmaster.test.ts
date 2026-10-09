/**
 * ANCIENTS × GILDMASTER (owner pairings 2026-10-09). Gildcrafter (3 Gold, 3 uses per game): "When you have 2 copies of a
 * minion, this grants a third." A Goldcrafter is the `goldcrafter` spell token. Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_GILD_CHARGE_FLAG, ANCIENT_IDS, activePowers, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'When you have **2 copies** of a minion, this grants a third.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const gilded = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return card(uid, cardId, { golden: true, attack: d.attack * 2, health: d.health * 2 });
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'gildmaster'), phase: 'recruit', embers: 20, heroReady: true, hand: [], ...over } as RunState);
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
const rewards = (s: RunState) => s.hand.filter((c) => c.cardId === 'discoverspell').length;

describe('Gildmaster × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('gildmaster', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('gildmaster', id)).not.toMatch(/—|--/);
    }
  });
});

describe('Gildmaster × DEATH: "Avenge (14): Get a Goldcrafter."', () => {
  it('Shop: the 14th friendly Shop death gets a Goldcrafter right then', () => {
    let s = picked('death');
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (14):** get a **Goldcrafter** (**14** more to go).`);
    s = structuredClone({ ...s, board: [card('d', N(0))], ancients: { ...s.ancients!, gildDeaths: 13 } });
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.hand.map((c) => c.cardId)).toEqual(['goldcrafter']);
    expect(s.ancients!.gildDeaths).toBe(0);
  });
  it('combat: the carried count pays a Goldcrafter MID-FIGHT (a live toHand); settle carries the remainder', () => {
    let s = picked('death', { board: ['a', 'b'].map((u, i) => card(u, N(i), { attack: 1, health: 1 })) });
    s = { ...s, ancients: { ...s.ancients!, gildDeaths: 13 } };
    expect(ancientCombatMods(s).ancientGorrAvenge).toEqual({ every: 14, tick: 13, ids: ['goldcrafter'], label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    s = fightNow(s, 100, 1000);
    expect(events(s).filter((e) => e.type === 'toHand' && e.cardId === 'goldcrafter').length).toBe(1);
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.map((c) => c.cardId)).toContain('goldcrafter');
    expect(s.ancients!.gildDeaths).toBe((13 + deaths) % 14);
  });
});

describe('Gildmaster × FORTUNE: "Triple Rewards also grant 5 Gold."', () => {
  it('getting a Triple Reward (playing a Gilded minion) also gains 5 Gold, printed live', () => {
    let s = picked('fortune', { hand: [gilded('g', N(0))] });
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(rewards(s)).toBe(1);
    expect(s.embers).toBe(25);
    expect(heroPowerText(s)).toBe(`${BASE} Triple Rewards also give you **5 Gold** (**5 Gold** so far).`);
  });
});

describe('Gildmaster × WAR: "Pummel (1000): Gain a charge of Gildmaster."', () => {
  it('the first 1000 crossed in a fight (once) adds one use to Gildcrafter\'s budget', () => {
    let s = picked('war', { board: [card('a', N(0), { attack: 400, health: 9000 })] });
    expect(activePowers(s)[0]!.maxUses).toBe(3);
    expect(heroPowerText(s)).toBe(`${BASE} **Pummel (1000):** it gains a use. Once per combat. Counts damage dealt by all your minions (**0/1000**). Uses left: **3**.`);
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 900 } };
    expect(ancientCombatMods(s).ancientPummelCharge).toEqual({ every: 1000, dealt: 900, flag: ANCIENT_GILD_CHARGE_FLAG, label: 'Ancient of War' });
    s = fightNow(s, 1, 5000);
    const flags = events(s).filter((e) => e.type === 'questTrigger' && e.flag === ANCIENT_GILD_CHARGE_FLAG).length;
    expect(flags).toBe(1);
    expect(s.lastCombat!.playerAncientPummelDealt!).toBeGreaterThanOrEqual(2000);
    s = reduce(s, { type: 'resolveCombat' });
    expect(activePowers(s)[0]!.maxUses).toBe(4);
    expect(heroPowerText(s)).toContain('Uses left: **4**.');
  });
  it('the extra use is real: a 4th Gildcrafter fires once the budget is 4', () => {
    let s = picked('war', { hand: [card('x', N(0)), card('y', N(0))] });
    s = { ...s, heroPowerUses: 3 };
    expect(reduce(s, { type: 'heroPower' })).toBe(s);
    s = { ...s, ancients: { ...s.ancients!, powerOverride: { ...(s.ancients!.powerOverride ?? {}), maxUses: 4 } } };
    const t = reduce(s, { type: 'heroPower' });
    expect(t).not.toBe(s);
    expect(t.hand.some((c) => c.golden)).toBe(true);
  });
});

describe('Gildmaster × GENESIS: "Triple Rewards trigger twice."', () => {
  it('EVERY Triple Reward triggers twice (the repeat never repeats itself)', () => {
    let s = picked('genesis', { hand: [gilded('g', N(0)), gilded('h', N(1))] });
    expect(heroPowerText(s)).toBe(`${BASE} Triple Rewards trigger **twice**.`);
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(rewards(s)).toBe(2);
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(rewards(s)).toBe(4);
  });
  it('without Ancients a Triple Reward is one', () => {
    const s = reduce(base({ hand: [gilded('g', N(0))] }), { type: 'play', uid: 'g' });
    expect(rewards(s)).toBe(1);
  });
});

describe('Gildmaster × TIME: "Gildcrafter becomes: Start of Turn: Make a random friendly minion Gilded."', () => {
  it('Gildcrafter turns passive; each Start of Turn gilds a random non-Gilded board minion (its own beat)', () => {
    let s = picked('time', { board: [gilded('g', N(0)), card('a', N(1), { health: 50 })] });
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(heroPowerText(s)).toBe('**Start of Turn:** make a random friendly minion **Gilded**.');
    expect(reduce({ ...s, hand: [card('x', N(2)), card('y', N(2))] }, { type: 'heroPower' }).hand.some((c) => c.golden)).toBe(false);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(at(s, 'a').golden).toBe(true);
    const beat = (s.sotBeatFx ?? []).find((b) => b.source.kind === 'hero' && b.source.label === 'Ancient of Time');
    expect(beat?.gilds ?? []).toContain('a');
  });
});

describe('Gildmaster × BONDS: "Playing a triple grants your Gilded minions +5/+5. Repeat for every Gilded minion this game."', () => {
  it('a Gilded play gives your Gilded minions +5/+5, then once more per Gilded minion this game (each its own step)', () => {
    let s = picked('bonds', { board: [gilded('b', N(1))], hand: [gilded('g', N(0))] });
    s = { ...s, ancients: { ...s.ancients!, gilds: 2 } };
    expect(heroPowerText(s)).toContain('(**2** so far: **3** times)');
    const bAtk = at(s, 'b').attack;
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(at(s, 'b').attack).toBe(bAtk + 15);
    expect(at(s, 'g').attack).toBe(CARD_INDEX[N(0)]!.attack * 2 + 15);
    expect(s.recruitBuffFx.filter((f) => f.fromHeroPower).length).toBeGreaterThanOrEqual(3);
  });
  it('a plain play does nothing', () => {
    let s = picked('bonds', { board: [gilded('b', N(1))], hand: [card('p', N(0))] });
    const bAtk = at(s, 'b').attack;
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(at(s, 'b').attack).toBe(bAtk);
  });
});

describe('Gildmaster × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [card('a', N(0), { attack: 300, health: 3 }), card('b', N(1), { attack: 3, health: 2 })], hand: [gilded('g', N(2))] });
        s = { ...s, ancients: { ...s.ancients!, gildDeaths: 13, pummelDealt: 950 } };
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
