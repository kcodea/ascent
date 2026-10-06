/**
 * ANCIENTS × NADJA (owner pairings 2026-10-06). Goldspring (3 Gold, untargeted): "Gain 1 maximum Gold." Every pairing in
 * the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Gain 1 maximum Gold.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'nadja'), phase: 'recruit', embers: 99, hand: [], ...over } as RunState);
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
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const spring = (s: RunState): RunState => reduce(s, { type: 'heroPower' });
const buy = (s: RunState, id: string, u = 'o'): RunState => {
  const next = reduce({ ...s, shop: [offer(u, id)] }, { type: 'buy', uid: u });
  expect(next, `bought ${id}`).not.toBe(s);
  return next;
};

describe('Nadja × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('nadja', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('nadja', id)).not.toMatch(/—|--/);
    }
  });
  it('without Ancients, Goldspring costs 3 Gold, gives +1 max Gold, and is once per turn', () => {
    let s = base();
    const gold = s.embers;
    s = spring(s);
    expect(s.maxGoldBonus).toBe(1);
    expect(s.embers).toBe(gold - 3);
    expect(spring(s)).toBe(s);
    expect(s.ancients).toBeUndefined();
  });
});

describe('Nadja × DEATH: "Goldspring becomes: Avenge (6): Gain 1 max gold."', () => {
  it('Goldspring turns passive (a click does nothing, no Gold spent)', () => {
    const s = picked('death');
    expect(activePowers(s)[0]!.passive).toBe(true);
    expect(spring(s)).toBe(s);
    expect(heroPowerText(s)).toBe('**Avenge (6):** gain **+1 max Gold** (**6** more to go). **+0** so far.');
  });
  it('Shop: the 6th friendly Shop death gives +1 max Gold right then (R-PHASE-01), and the count restarts', () => {
    let s = picked('death');
    const bonus = s.maxGoldBonus ?? 0;
    s = structuredClone({ ...s, board: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((u) => card(u, N(0))) });
    for (const u of ['d1', 'd2', 'd3', 'd4', 'd5']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.ancients!.nadjaDeaths).toBe(5);
    expect(s.maxGoldBonus ?? 0).toBe(bonus);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    destroyMinionInShop(makeContext(s), at(s, 'd6'));
    expect(s.ancients!.nadjaDeaths).toBe(0);
    expect(s.maxGoldBonus).toBe(bonus + 1);
    expect(heroPowerText(s)).toBe('**Avenge (6):** gain **+1 max Gold** (**6** more to go). **+1** so far.');
  });
  it('combat: the carried count fires MID-FIGHT (a +1 max Gold float), settle pays the max Gold and carries the remainder', () => {
    let s = picked('death', { board: ['a', 'b', 'c'].map((u) => card(u, N(1), { attack: 1, health: 1 })) });
    s = { ...s, ancients: { ...s.ancients!, nadjaDeaths: 5 } };
    expect(ancientCombatMods(s).ancientMaxGoldAvenge).toEqual({ every: 6, tick: 5, gold: 1, flag: 'ancientMaxGoldAvenge', label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    // Live through the fight: one death on screen crosses the threshold.
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 })).toContain('(**6** more to go). **+1** so far.');
    const bonus = s.maxGoldBonus ?? 0;
    s = fightNow(s, 100, 1000);
    const floats = events(s).filter((e) => e.type === 'maxGold' && e.side === 'player');
    expect(floats.length).toBe(1);
    const firstDeath = events(s).findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(events(s).indexOf(floats[0]!)).toBeGreaterThanOrEqual(firstDeath);
    expect(s.lastCombat!.playerAncientMaxGoldFires).toBe(1);
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.maxGoldBonus).toBe(bonus + 1);
    expect(s.ancients!.nadjaDeaths).toBe((5 + deaths) % 6);
  });
});

describe('Nadja × FORTUNE: "Goldspring can be used twice per turn and costs 2 gold."', () => {
  it('costs 2, fires twice a turn (+1 max Gold each), a third press is refused; it refills next turn', () => {
    let s = picked('fortune', { board: [card('a', N(0), { health: 99 })] });
    expect(activePowers(s)[0]!.cost).toBe(2);
    expect(heroPowerText(s)).toBe(`${BASE} Use it **twice** each turn (**2** left this turn).`);
    const gold = s.embers;
    const bonus = s.maxGoldBonus ?? 0;
    s = spring(s);
    expect(s.embers).toBe(gold - 2);
    expect(s.maxGoldBonus).toBe(bonus + 1);
    expect(heroPowerText(s)).toContain('(**1** left this turn)');
    s = spring(s);
    expect(s.embers).toBe(gold - 4);
    expect(s.maxGoldBonus).toBe(bonus + 2);
    expect(spring(s)).toBe(s);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(heroPowerText(s)).toContain('(**2** left this turn)');
    expect(spring(s)).not.toBe(s);
  });
});

describe('Nadja × WAR: "Start of Combat: Your left-most minion gains Rally: give your minions +3 attack per gold spent this turn."', () => {
  it('the power prints the live Gold spent and the Rally it gives; the combat mod freezes it', () => {
    let s = picked('war', { board: [card('a', N(0), { attack: 2, health: 50 }), card('b', N(1), { attack: 1, health: 50 })] });
    expect(heroPowerText(s)).toContain('(**0** spent: **+0** Attack.)');
    expect(ancientCombatMods(s).ancientSocRally).toBeUndefined();
    s = buy(s, N(2)); // 3 Gold
    expect(heroPowerText(s)).toContain('(**3** spent: **+9** Attack.)');
    expect(ancientCombatMods(s).ancientSocRally).toEqual({ attack: 9, label: 'Ancient of War' });
  });
  it('combat: the left-most minion gains Rally; its attack gives EVERY friendly minion (itself too) +X Attack, combat only', () => {
    let s = picked('war', { board: [card('a', N(0), { attack: 2, health: 50 }), card('b', N(1), { attack: 1, health: 50 })] });
    s = buy(s, N(2));
    s = fightNow({ ...s, hand: [] }, 0, 400);
    const [lead, other] = s.lastCombat!.initial.player.map((m) => m.uid);
    const ev = events(s);
    expect(ev.some((e) => e.type === 'keyword' && e.target === lead && e.keyword === 'RL')).toBe(true);
    const firstSwing = ev.find((e): e is Extract<CombatEvent, { type: 'attack' }> => e.type === 'attack' && e.attacker === lead);
    expect(firstSwing).toBeDefined();
    const rallyBuffs = ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === lead && e.attack === 9 && e.health === 0);
    expect(rallyBuffs.map((e) => e.target)).toEqual(expect.arrayContaining([lead, other]));
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'a').attack, 'combat-only').toBe(2);
    expect(at(s, 'a').keywords).not.toContain('RL');
  });
  it('nothing spent: no Rally is granted', () => {
    const s = fightNow(picked('war', { board: [card('a', N(0), { attack: 2, health: 50 })] }), 0, 400);
    expect(events(s).some((e) => e.type === 'keyword' && e.keyword === 'RL')).toBe(false);
  });
});

describe('Nadja × GENESIS: "Goldspring also grants a random minion."', () => {
  it('Goldspring gives +1 max Gold AND a random minion of your Shop tier or lower to hand', () => {
    let s = picked('genesis', { tier: 2 });
    expect(heroPowerText(s)).toBe(`${BASE} Also get a random minion.`);
    const bonus = s.maxGoldBonus ?? 0;
    s = spring(s);
    expect(s.maxGoldBonus).toBe(bonus + 1);
    expect(s.hand.length).toBe(1);
    const def = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(def.spell).toBeFalsy();
    expect(def.tier).toBeLessThanOrEqual(2);
  });
  it('is seeded: the same run gives the same minion', () => {
    const a = spring(picked('genesis', { tier: 3 }));
    const b = spring(picked('genesis', { tier: 3 }));
    expect(a.hand.map((c) => c.cardId)).toEqual(b.hand.map((c) => c.cardId));
  });
});

describe('Nadja × TIME: "Goldspring becomes: End of Turn: Gain +1 max gold."', () => {
  it('Goldspring is passive; each End of Turn adds 1 max Gold (no cap); the power prints the total', () => {
    let s = picked('time', { board: [card('a', N(0), { health: 99 })] });
    expect(spring(s)).toBe(s);
    const bonus = s.maxGoldBonus ?? 0;
    expect(heroPowerText(s)).toBe('**End of Turn:** gain **+1 max Gold**. **+0** so far.');
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.maxGoldBonus).toBe(bonus + 1);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.maxGoldBonus).toBe(bonus + 2);
    expect(heroPowerText(s)).toContain('**+2** so far');
  });
});

describe('Nadja × BONDS: "Give 2 random minions +2/+4 whenever you spend gold."', () => {
  const board = () => [card('a', N(0)), card('b', N(1)), card('c', N(2))];
  const total = (s: RunState) => s.board.reduce((n, c) => n + c.attack + c.health, 0);
  it('one spend (a 3 Gold buy) gives 2 distinct random minions +2/+4 once, not per Gold', () => {
    let s = picked('bonds', { board: board() });
    const before = s.board.map((c) => ({ ...c }));
    s = buy(s, N(3));
    const gained = s.board.filter((c, i) => c.attack !== before[i]!.attack);
    expect(gained.length).toBe(2);
    for (const c of gained) {
      const p = before.find((b) => b.uid === c.uid)!;
      expect([c.attack - p.attack, c.health - p.health]).toEqual([2, 4]);
    }
  });
  it('every spend path counts (a Refresh, Goldspring itself); a 0-Gold action does not', () => {
    let s = picked('bonds', { board: board() });
    const t0 = total(s);
    s = reduce(s, { type: 'roll' });
    expect(total(s)).toBe(t0 + 12);
    s = spring(s);
    expect(total(s)).toBe(t0 + 24);
    const free = reduce({ ...s, freeRolls: 1 }, { type: 'roll' });
    expect(total(free)).toBe(total(s));
  });
});

describe('Nadja × save / restore and determinism', () => {
  it('the Death count survives a JSON round trip', () => {
    let s = picked('death');
    s = structuredClone({ ...s, board: ['d1', 'd2'].map((u) => card(u, N(0))) });
    for (const u of ['d1', 'd2']) destroyMinionInShop(makeContext(s), at(s, u));
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain('(**4** more to go)');
    expect(ancientCombatMods(s).ancientMaxGoldAvenge).toMatchObject({ tick: 2 });
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { board: [card('a', N(0), { attack: 1, health: 1 }), card('b', N(1), { health: 40 }), card('c', N(2), { attack: 1, health: 1 })] });
        s = buy(s, N(3));
        if (!activePowers(s)[0]!.passive) s = spring(s);
        return reduce(fightNow(s, 100, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
      expect(a.maxGoldBonus, id).toBe(b.maxGoldBonus);
    }
  });
});
