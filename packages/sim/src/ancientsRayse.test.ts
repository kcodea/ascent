/**
 * ANCIENTS × RAYSE (owner pairings 2026-10-09). Empowering Vines (passive): "Minions summoned in combat gain +2/+3 and
 * Taunt." Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_SPROUT_FLAG, RAYSE_SPROUT_ID, ancientAvengeCountdown, ancientCombatMods, ancientOfferText, createRun, enableAncients,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const BASE = 'Minions summoned in combat gain **+2/+3** and **Taunt**.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
/** An Echo that summons a fixed body count (the Soren / Robin fixture): a reliable source of combat summons. */
const ECHO = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.keywords.length === 0
  && c.effects.length === 1 && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon'
  && !(c.effects[0]!.params as { fixed?: boolean }).fixed)!;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'rayse'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
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
const summons = (ev: CombatEvent[]) => ev.filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player');
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);

describe('Rayse × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('rayse', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('rayse', id)).not.toMatch(/—|--/);
    }
  });
  it('the Sprout is a NEW 1/1 neutral token, not the Sprout spell', () => {
    const d = CARD_INDEX[RAYSE_SPROUT_ID]!;
    expect([d.name, d.tribe, d.attack, d.health, !!d.token, !!d.spell]).toEqual(['Sprout', 'neutral', 1, 1, true, false]);
    expect(CARD_INDEX['sprout']!.spell).toBe(true);
  });
});

describe('Rayse × DEATH: "Avenge (4): Summon a 1/1 Sprout and improve this."', () => {
  it('Shop: the 4th friendly Shop death summons a 1/1 Sprout (no Vines in the Shop) and improves the next to 2/2', () => {
    let s = picked('death');
    expect(heroPowerText(s)).toBe(`${BASE} **Avenge (4):** summon a **1/1** Sprout and improve this by **+1/+1** (**4** more to go).`);
    s = structuredClone({ ...s, board: ['d1', 'd2', 'd3', 'd4'].map((u, i) => card(u, N(i))) });
    for (const u of ['d1', 'd2', 'd3']) destroyMinionInShop(makeContext(s), at(s, u));
    expect(s.ancients!.rayseDeaths).toBe(3);
    expect(heroPowerText(s)).toContain('(**1** more to go)');
    destroyMinionInShop(makeContext(s), at(s, 'd4'));
    const sprout = s.board.find((c) => c.cardId === RAYSE_SPROUT_ID)!;
    expect(sprout).toMatchObject({ attack: 1, health: 1 });
    expect(sprout.keywords).not.toContain('T');
    expect(s.ancients!.rayseSproutSize).toBe(2);
    expect(heroPowerText(s)).toContain('summon a **2/2** Sprout');
  });
  it('combat: the carried count fires MID-FIGHT, the Sprout takes Vines (+2/+3, Taunt), and settle banks the growth', () => {
    let s = picked('death', { board: ['a', 'b', 'c'].map((u, i) => card(u, N(i), { attack: 1, health: 1 })) });
    s = { ...s, ancients: { ...s.ancients!, rayseDeaths: 3, rayseSproutSize: 3 } };
    expect(ancientCombatMods(s).ancientSproutAvenge).toEqual({ every: 4, tick: 3, cardId: RAYSE_SPROUT_ID, size: 3, flag: ANCIENT_SPROUT_FLAG, label: 'Ancient of Death' });
    expect(ancientAvengeCountdown(s)).toBe(1);
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 })).toContain('summon a **4/4** Sprout');
    s = fightNow(s, 100, 1000);
    const sprouts = summons(events(s)).filter((e) => e.minion.cardId === RAYSE_SPROUT_ID);
    expect(sprouts.length).toBeGreaterThanOrEqual(1);
    expect(sprouts[0]!.minion).toMatchObject({ attack: 3 + 2, health: 3 + 3 });
    expect(sprouts[0]!.minion.keywords).toContain('T');
    const fires = events(s).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_SPROUT_FLAG).length;
    expect(fires).toBe(sprouts.length);
    const deaths = s.lastCombat!.playerDeaths ?? 0;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.rayseSproutSize).toBe(3 + fires);
    expect(s.ancients!.rayseDeaths).toBe((3 + deaths) % 4);
  });
});

describe('Rayse × FORTUNE: "Your summons gain +1 attack for every gold spent this turn."', () => {
  it('Shop: a minion played after spending Gold gains +1 Attack per Gold, permanently; the text prints it live', () => {
    let s = picked('fortune', { hand: [card('p', N(0))], shop: [offer('o', N(1))] });
    expect(heroPowerText(s)).toBe(`${BASE} Minions you summon gain **+1 Attack** for each Gold you spent this turn (**0** spent: **+0** Attack).`);
    s = reduce(s, { type: 'buy', uid: 'o' });
    const spent = s.goldSpentThisTurn ?? 0;
    expect(spent).toBeGreaterThan(0);
    expect(heroPowerText(s)).toContain(`(**${spent}** spent: **+${spent}** Attack)`);
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(at(s, 'p')).toMatchObject({ attack: CARD_INDEX[N(0)]!.attack + spent, health: CARD_INDEX[N(0)]!.health });
  });
  it('combat: every friendly summon gains the turn\'s Attack as a combat buff', () => {
    let s = picked('fortune', { board: [card('e', ECHO.id, { attack: 1, health: 1 })], shop: [offer('o', N(1))] });
    expect(ancientCombatMods(s).ancientSummonGain).toBeUndefined();
    s = reduce(s, { type: 'buy', uid: 'o' });
    const spent = s.goldSpentThisTurn ?? 0;
    expect(ancientCombatMods(s).ancientSummonGain).toEqual({ attack: spent, health: 0, label: 'Ancient of Fortune' });
    s = fightNow({ ...s, hand: [] }, 100, 1000);
    const made = summons(events(s));
    expect(made.length).toBeGreaterThan(0);
    const grants = events(s).filter((e) => e.type === 'buff' && e.source === 'Ancient of Fortune');
    expect(grants.length).toBe(made.length);
  });
});

describe('Rayse × WAR: "Your first 3 summoned minions attack immediately."', () => {
  it('the first 3 friendly combat summons strike the moment they land; the 4th does not', () => {
    const s = picked('war');
    expect(heroPowerText(s)).toBe(`${BASE} In combat, the first **3** minions you summon attack immediately.`);
    expect(ancientCombatMods(s).ancientSummonsAttack).toEqual({ count: 3, label: 'Ancient of War' });
    const fight = (armed: boolean) => {
      let t = picked(armed ? 'war' : 'fortune', { board: ['a', 'b', 'c', 'd'].map((u) => card(u, ECHO.id, { attack: 1, health: 1 })) });
      t = fightNow(t, 100, 5000);
      const ev = events(t);
      const landed = summons(ev).map((e) => e.minion.uid);
      const struck = new Set(ev.filter((e): e is Extract<CombatEvent, { type: 'attack' }> => e.type === 'attack').map((e) => e.attacker));
      return { landed, struck };
    };
    const war = fight(true);
    expect(war.landed.length).toBeGreaterThan(3);
    expect(war.landed.slice(0, 3).every((u) => war.struck.has(u))).toBe(true);
    // The first summon strikes before the enemy's next swing: i.e. right after it lands.
    const off = fight(false);
    expect(off.landed.slice(0, 3).every((u) => off.struck.has(u))).toBe(false);
  });
});

describe('Rayse × GENESIS: "The first 2 minions you summon in combat summon twice."', () => {
  it('only the first two friendly summons make an extra copy; the copies never spend the budget', () => {
    const s = picked('genesis', { board: ['a', 'b', 'c'].map((u) => card(u, ECHO.id, { attack: 1, health: 1 })) });
    expect(ancientCombatMods(s).ancientSummonExtra).toBe(1);
    expect(ancientCombatMods(s).ancientSummonExtraLimit).toBe(2);
    expect(heroPowerText(s)).toBe(`${BASE} The first **2** minions you summon each combat summon twice.`);
    // An extra copy is summoned beside the body it copies (its `source` is that summoned body's uid); an ordinary Echo
    // summon's source is the dying Echo body.
    const made = summons(events(fightNow(s, 100, 5000)));
    const summoned = new Set(made.map((e) => e.minion.uid));
    const copies = made.filter((e) => e.source && summoned.has(e.source));
    expect(made.length).toBeGreaterThan(4);
    expect(copies.length).toBe(2);
    expect(copies.map((e) => e.source)).toEqual(made.filter((e) => !copies.includes(e)).slice(0, 2).map((e) => e.minion.uid));
  });
});

describe('Rayse × TIME: "End of turn give a minion Rise."', () => {
  it('End of Turn: a random friendly minion WITHOUT Rise gains Rise permanently; all with Rise: nothing', () => {
    let s = picked('time', { board: [card('a', N(0), { keywords: ['R'] }), card('b', N(1), { health: 50 })] });
    expect(heroPowerText(s)).toBe(`${BASE} **End of Turn:** give a random friendly minion without **Rise** **Rise**.`);
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'b')!.keywords).toContain('R');
    const allRise = fightNow(picked('time', { board: [card('a', N(0), { keywords: ['R'] })] }));
    expect(allRise.board.find((c) => c.uid === 'a')!.keywords.filter((k) => k === 'R').length).toBe(1);
  });
});

describe('Rayse × BONDS: "When a minion is summoned in combat, give 2 friendly minions +3/+3."', () => {
  it('each friendly combat summon gives 2 OTHER random friendly minions +3/+3, a combat buff', () => {
    let s = picked('bonds', { board: [card('e', ECHO.id, { attack: 1, health: 1 }), card('x', N(0), { attack: 1, health: 90 }), card('y', N(1), { attack: 1, health: 90 })] });
    expect(ancientCombatMods(s).ancientSummonBuffOthers).toEqual({ count: 2, attack: 3, health: 3, label: 'Ancient of Bonds' });
    s = fightNow(s, 100, 5000);
    const made = summons(events(s));
    expect(made.length).toBeGreaterThan(0);
    const grants = events(s).filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Ancient of Bonds');
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) expect(g).toMatchObject({ attack: 3, health: 3 });
    for (const m of made) expect(grants.some((g) => g.target === m.minion.uid && events(s).indexOf(g) < events(s).indexOf(m))).toBe(false);
    // Combat only: the run board keeps its printed stats.
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'x')?.attack ?? 1).toBe(1);
  });
});

describe('Rayse × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [card('a', ECHO.id, { attack: 3, health: 3 }), card('b', N(2), { attack: 3, health: 2 }), card('c', N(3), { attack: 2, health: 2 })], shop: [offer('o', N(1))] });
        s = reduce(s, { type: 'buy', uid: 'o' });
        return reduce(fightNow(s, 60, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
