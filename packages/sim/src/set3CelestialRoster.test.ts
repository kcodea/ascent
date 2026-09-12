import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, poolFor } from '@game/content';
import {
  createRun, reduce, tierSlots, offerBuyStats, rollShop,
  STARFORM_ID, createStarform, hasStarform, starformOf, starformStats, buffStarform, pickShopMinionFor, primeExtraPrimaryLands,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { fireRecruitDeathrattlesForTest } from './recruit';
import { runSpells } from './spellPool';
import { equipmentState, equipmentChargesOf } from './equipment';

/**
 * SET 3 CELESTIALS — THE STARFORM ROSTER (owner spec 2026-09-12): the sixteen bodies + Accretion + the Stellar
 * Lens that create, feed and cash in the Starform token (`starform.ts`, whose rules `starform.test.ts` pins).
 * Every card plain AND gilded through the real `reduce`, then the pairwise matrix the owner asked for.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  const g = over.golden ? 2 : 1;
  return { uid, cardId, tribe: d.tribe, attack: d.attack * g, health: d.health * g, keywords: [...d.keywords], golden: false, ...over };
};
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as BoardCard);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(3), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['celestial', 'undead', 'kobold'], shop: [],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const offer = (s: RunState, cardId: string, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${s.uidSeq++}`, cardId, ...over });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const play = (s: RunState, uid: string, extra: Partial<Action> = {}): RunState => reduce(s, { type: 'play', uid, ...extra } as Action);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const sf = (s: RunState): [number, number] => { const st = starformStats(s)!; return [st.attack, st.health]; };
const offerStats = (s: RunState, o: ShopCard): [number, number] => { const st = offerBuyStats(s, o); return [st.attack, st.health]; };
const buffFrom = (c: BoardCard, source: string): [number, number] =>
  (c.buffs ?? []).filter((b) => b.source === source).reduce<[number, number]>((acc, b) => [acc[0] + b.attack, acc[1] + b.health], [0, 0]);
const SRC = { cardId: 'test', name: 'test' };
/** A run holding a Starform that already carries +a/+h above its base 1/1 (an open shop slot, so nothing is eaten). */
const withStarform = (a: number, h: number, over: Partial<RunState> = {}): RunState => {
  const s = run(over);
  createStarform(s, SRC);
  if (a > 0 || h > 0) buffStarform(s, a, h, 'test');
  return s;
};
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [], ...over } as unknown as BoardMinion);
const toHand = (events: readonly CombatEvent[]): string[] =>
  events.filter((e) => e.type === 'toHand' && (e as { side: string }).side === 'player').map((e) => (e as { cardId: string }).cardId);
const buffsFrom = (events: readonly CombatEvent[], source: string) =>
  events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === source);
const fight = (player: BoardMinion[], enemy: BoardMinion[], seed = 7) =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 1 }));

// ── probes: plain bodies with one known effect, so a scenario has no second moving part ──────────────────
const PROBES: CardDef[] = [
  { id: 'dbg_cel', name: 'Celestial (probe)', tribe: 'celestial', tier: 1, attack: 1, health: 20, keywords: [], effects: [], text: '' },
  { id: 'dbg_cel2', name: 'Celestial B (probe)', tribe: 'celestial', tier: 1, attack: 1, health: 20, keywords: [], effects: [], text: '' },
  { id: 'dbg_neutral', name: 'Neutral (probe)', tribe: 'neutral', tier: 1, attack: 1, health: 20, keywords: [], effects: [], text: '' },
  { id: 'dbg_echoall', name: 'Echo: all +5/+5 (probe)', tribe: 'neutral', tier: 1, attack: 1, health: 3, keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 5, health: 5 } }], text: '' },
  { id: 'dbg_filler', name: 'Filler (probe)', tribe: 'neutral', tier: 1, attack: 1, health: 50, keywords: [], effects: [], text: '' },
  { id: 'dbg_scall', name: 'SC damage all (probe)', tribe: 'neutral', tier: 1, attack: 0, health: 40, keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scDamage', params: { amount: 4, target: 'all' } }], text: '' },
  { id: 'dbg_taunt', name: 'Taunt 30/1 (probe)', tribe: 'neutral', tier: 1, attack: 30, health: 1, keywords: ['T'], effects: [], text: '' },
];
for (const c of PROBES) CARD_INDEX[c.id] = c;

const ROSTER: [string, string, number, number, number][] = [
  ['ce3_starseed', 'Star Seed', 1, 2, 1], ['ce3_dawnsentinel', 'Dawn Sentinel', 1, 1, 3],
  ['ce3_peddler', 'Stardust Peddler', 2, 2, 3], ['ce3_wishingstar', 'Wishing Star', 2, 2, 3],
  ['ce3_accretionwarden', 'Accretion Warden', 3, 3, 4], ['ce3_shootingstar', 'Shooting Star', 3, 3, 2], ['ce3_eclipsewarden', 'Eclipse Warden', 3, 3, 6],
  ['ce3_orbitkeeper', 'Orbit Keeper', 4, 3, 6], ['ce3_coronadevotee', 'Corona Devotee', 4, 4, 5], ['ce3_starcharter', 'Star Charter', 4, 3, 4],
  ['ce3_lensgrinder', 'Lens Grinder', 5, 5, 6], ['ce3_lodestar', 'Lodestar', 5, 5, 9],
  ['ce3_twinstar', 'Twin Star', 6, 6, 8], ['ce3_novaherald', 'Nova Herald', 6, 6, 9],
  ['ce3_zenith', 'Zenith', 7, 8, 12], ['ce3_constellationprime', 'Constellation Prime', 7, 9, 9],
];

describe('the roster', () => {
  it('sixteen set-3 Celestials with the spec tier / stats, all in the set-3 pool; the two Tier 7s sit at the Summit tier', () => {
    const ids = poolFor('set3').buyable.map((c) => c.id);
    for (const [id, name, tier, a, h] of ROSTER) {
      const d = CARD_INDEX[id]!;
      expect([d.name, d.tribe, d.tier, d.attack, d.health], id).toEqual([name, 'celestial', tier, a, h]);
      expect(ids, id + ' is drawable in set 3').toContain(id);
      expect(d.goldenText, id + ' states its gilded reading').toBeTruthy();
    }
    expect(CARD_INDEX['ce3_dawnsentinel']!.keywords).toEqual(['T']);
    expect(CARD_INDEX['ce3_shootingstar']!.keywords).toEqual(['W']);
    expect(CARD_INDEX['ce3_zenith']!.tier).toBe(7);
    expect(CARD_INDEX['ce3_constellationprime']!.tier).toBe(7);
    expect(poolFor('set2').buyable.some((c) => c.id.startsWith('ce3_')), 'set 2 has none').toBe(false);
  });
  it('Accretion is a set-3 Celestial spell offered only while Celestial is a run tribe; the Stellar Lens is registered', () => {
    const d = CARD_INDEX['accretion']!;
    expect([d.spell, d.tribe, d.tier, d.cost]).toEqual([true, 'celestial', 3, 2]);
    expect(runSpells({ setId: 'set3', tribes: ['celestial', 'undead'] }).some((c) => c.id === 'accretion')).toBe(true);
    expect(runSpells({ setId: 'set3', tribes: ['undead', 'kobold'] }).some((c) => c.id === 'accretion')).toBe(false);
    expect(EQUIPMENT_INDEX['stellar_lens']).toMatchObject({ baseCost: 2, targetMode: 'none', effectId: 'equipmentBuffThisShop', params: { attack: 10, health: 10 }, gildedParams: { attack: 20, health: 20 } });
  });
});

describe('Star Seed — create a Starform, or +2/+2 to the one you have', () => {
  it('creates a 1/1 token into an open slot; a second Seed feeds it +2/+2; a gilded Seed +4/+4', () => {
    let s = run({ hand: [body('a', 'ce3_starseed'), body('b', 'ce3_starseed'), body('g', 'ce3_starseed', { golden: true })], shop: [] });
    s = play(s, 'a', { toIndex: 0 });
    expect(hasStarform(s)).toBe(true);
    expect(sf(s)).toEqual([1, 1]);
    const uid = starformOf(s)!.uid;
    s = play(s, 'b', { toIndex: 0 });
    expect(starformOf(s)!.uid, 'still one token').toBe(uid);
    expect(sf(s)).toEqual([3, 3]);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Star Seed')).toMatchObject({ attack: 2, health: 2 });
    s = play(s, 'g', { toIndex: 0 });
    expect(sf(s)).toEqual([7, 7]);
  });
  it('a gilded Seed with NO Starform creates one (nothing to double); a full row eats the right-most minion', () => {
    let s = run({ hand: [body('g', 'ce3_starseed', { golden: true })] });
    rollShop(s);
    expect(s.shop.length).toBe(tierSlots(s.tier));
    const victimIdx = pickShopMinionFor(s, 'highestTier') >= 0 ? s.shop.length - 1 : -1;
    const victim = s.shop[victimIdx]!;
    const worth = offerBuyStats(s, victim);
    s = play(s, 'g', { toIndex: 0 });
    expect(sf(s)).toEqual([1 + worth.attack, 1 + worth.health]);
    expect(s.shop.length).toBe(tierSlots(s.tier));
  });
});

describe('Dawn Sentinel — Taunt; Echo: a random friendly Celestial +2/+1 (both phases)', () => {
  it('shop Echo buffs a random OTHER friendly Celestial (never a non-Celestial); gilded +4/+2', () => {
    const s = run({ board: [body('d', 'ce3_dawnsentinel'), body('c', 'dbg_cel'), body('n', 'dbg_neutral')] });
    fireRecruitDeathrattlesForTest(s, at(s, 'd'));
    expect(stats(at(s, 'c'))).toEqual([3, 21]);
    expect(stats(at(s, 'n'))).toEqual([1, 20]);
    const g = run({ board: [body('d', 'ce3_dawnsentinel', { golden: true }), body('c', 'dbg_cel')] });
    fireRecruitDeathrattlesForTest(g, at(g, 'd'));
    expect(stats(at(g, 'c'))).toEqual([5, 22]);
  });
  it('combat Echo: dying hands +2/+1 to a friendly Celestial', () => {
    const r = fight([bm('ce3_dawnsentinel'), bm('dbg_cel')], [foe(10, 10)]);
    const sentinel = r.initial.player.find((m) => m.cardId === 'ce3_dawnsentinel')!.uid;
    const cel = r.initial.player.find((m) => m.cardId === 'dbg_cel')!.uid;
    expect(buffsFrom(r.events, sentinel).map((e) => [e.target, e.attack, e.health])).toEqual([[cel, 2, 1]]);
  });
});

describe('Stardust Peddler — whenever you buy a minion, your Starform +1/+1', () => {
  it('a normal buy feeds the token; the token\'s own dismiss buy counts as a buy but has no token left to feed', () => {
    let s = withStarform(0, 0, { board: [body('p', 'ce3_peddler')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid });
    expect(sf(s)).toEqual([2, 2]);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Stardust Peddler')).toMatchObject({ attack: 1, health: 1 });
    const bought = s.cardsBoughtThisTurn ?? 0;
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid }); // the 0-Gold dismiss
    expect(hasStarform(s)).toBe(false);
    expect(s.cardsBoughtThisTurn, 'counted as a buy').toBe(bought + 1);
    expect(stats(at(s, 'p')), 'the Peddler itself is untouched').toEqual([2, 3]);
  });
  it('gilded: +2/+2 per buy; no Starform → nothing', () => {
    let s = withStarform(0, 0, { board: [body('p', 'ce3_peddler', { golden: true })] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid });
    expect(sf(s)).toEqual([3, 3]);
    let t = run({ board: [body('p', 'ce3_peddler')], shop: [] });
    t.shop.push(offer(t, 'ce3_courier'));
    t = act(t, { type: 'buy', uid: t.shop[0]!.uid });
    expect(hasStarform(t)).toBe(false);
  });
});

describe('Wishing Star — Shout: this shop +2/+2. Echo: this shop +2/+2', () => {
  it('the Shout buffs every offer standing in the row; a refresh keeps it ONLY on the Starform', () => {
    let s = withStarform(0, 0, { hand: [body('w', 'ce3_wishingstar')] });
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'));
    s = play(s, 'w', { toIndex: 0 });
    expect(offerStats(s, s.shop[0]!)).toEqual([1 + 2, 1 + 2]);
    expect(offerStats(s, s.shop[1]!)).toEqual([2 + 2, 4 + 2]);
    expect(sf(s)).toEqual([3, 3]);
    expect(s.tavernBuyBonusTurn, 'not the per-turn channel — the offers themselves').toBeUndefined();
    s = act(s, { type: 'roll' });
    expect(sf(s), 'the Starform kept it').toEqual([3, 3]);
    for (const o of s.shop.filter((o) => !o.starform)) expect(o.buffs?.some((b) => b.source === 'Wishing Star') ?? false, 'the new offers do not carry it').toBe(false);
  });
  it('the Echo half fires in the shop through the Echo chokepoint; gilded halves are +4/+4', () => {
    const s = withStarform(0, 0, { board: [body('w', 'ce3_wishingstar')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    fireRecruitDeathrattlesForTest(s, at(s, 'w'));
    expect(offerStats(s, s.shop[0]!)).toEqual([3, 3]);
    expect(sf(s)).toEqual([3, 3]);
    let g = withStarform(0, 0, { hand: [body('w', 'ce3_wishingstar', { golden: true })] });
    g = play(g, 'w', { toIndex: 0 });
    expect(sf(g)).toEqual([5, 5]);
    fireRecruitDeathrattlesForTest(g, at(g, 'w'));
    expect(sf(g)).toEqual([9, 9]);
  });
  it('a combat death has no shop to buff — nothing fires, nothing breaks', () => {
    const r = fight([bm('ce3_wishingstar')], [foe(10, 10)]);
    const w = r.initial.player[0]!.uid;
    expect(r.events.some((e) => e.type === 'death' && e.target === w), 'it died').toBe(true);
    expect(buffsFrom(r.events, w)).toEqual([]);
  });
});

describe('Accretion Warden — the Starform consumes the highest-Tier Shop minion', () => {
  it('ties go to the RIGHT-most; the eaten offer leaves, its stats land on the token', () => {
    let s = withStarform(0, 0, { hand: [body('w', 'ce3_accretionwarden')] });
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'), offer(s, 'ce3_seer'), offer(s, 'ce3_seer'));
    const left = s.shop[2]!.uid, right = s.shop[3]!.uid;
    s = play(s, 'w', { toIndex: 0 });
    expect(s.shop.some((o) => o.uid === right), 'the right-most T3 was eaten').toBe(false);
    expect(s.shop.some((o) => o.uid === left), 'the left T3 stayed').toBe(true);
    expect(sf(s)).toEqual([1 + 3, 1 + 3]);
    expect(s.shopMinionsEaten, 'a real Shop consume').toBe(1);
  });
  it('no Starform → nothing; gilded → the token gains double the meal', () => {
    let s = run({ hand: [body('w', 'ce3_accretionwarden')], shop: [] });
    s.shop.push(offer(s, 'ce3_seer'));
    s = play(s, 'w', { toIndex: 0 });
    expect(s.shop.length).toBe(1);
    expect(hasStarform(s)).toBe(false);
    let g = withStarform(0, 0, { hand: [body('w', 'ce3_accretionwarden', { golden: true })] });
    g.shop.unshift(offer(g, 'ce3_seer'));
    g = play(g, 'w', { toIndex: 0 });
    expect(sf(g)).toEqual([1 + 6, 1 + 6]);
    expect(g.shop.length, 'one meal, not two').toBe(1);
  });
});

describe('Shooting Star — Flurry; Shout: this shop +3/+3 per Shop spell cast this turn (live text)', () => {
  const cast = (s: RunState, n: number): RunState => {
    for (let i = 0; i < n; i++) {
      s.hand.push(spell(`sc${i}`, 'starcrash'));
      s = play(s, `sc${i}`, { targetUid: 'c' });
    }
    return s;
  };
  it('0 spells → nothing; 1 → +3/+3; 3 → +9/+9; gilded with 2 → +12/+12', () => {
    for (const [n, golden, want] of [[0, false, 0], [1, false, 3], [3, false, 9], [2, true, 12]] as const) {
      let s = withStarform(0, 0, { board: [body('c', 'dbg_cel')], hand: [body('w', 'ce3_shootingstar', { golden })] });
      s.shop.unshift(offer(s, 'ce3_courier'));
      s = cast(s, n);
      expect(s.spellsThisTurn).toBe(n);
      s = play(s, 'w', { toIndex: 0 });
      expect(offerStats(s, s.shop[0]!), `${n} spells`).toEqual([1 + want, 1 + want]);
      expect(sf(s), `${n} spells (Starform)`).toEqual([1 + want, 1 + want]);
    }
  });
  // The printed text folds in the CURRENT total (hard rule): `shootingStarText` in `packages/ui/src/cardText.ts`,
  // pinned in `cardText.test.ts` and wired into the one `liveCardText` chain both the shop and combat read.
});

describe('Eclipse Warden — Avenge (3): get a Star Crash (combat)', () => {
  const fightWith = (golden: boolean) =>
    fight([bm('ce3_eclipsewarden', { golden, health: 60 }), bm('omen', { health: 1 }), bm('omen', { health: 1 }), bm('omen', { health: 1 })], [foe(5, 20)], 11);
  it('three friendly deaths → one Star Crash to hand mid-fight; gilded → two', () => {
    expect(toHand(fightWith(false).events)).toEqual(['starcrash']);
    expect(toHand(fightWith(true).events)).toEqual(['starcrash', 'starcrash']);
  });
  it('two deaths → nothing yet', () => {
    const r = fight([bm('ce3_eclipsewarden', { health: 60 }), bm('omen', { health: 1 }), bm('omen', { health: 1 })], [foe(5, 20)], 11);
    expect(toHand(r.events)).toEqual([]);
  });
});

describe('Orbit Keeper — End of Turn: Starform +2/+2. Start of Turn: create one if none', () => {
  const rollover = (s: RunState): RunState => act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  it('End of Turn feeds a held token (gilded +4/+4); with none there is nothing to feed', () => {
    let s = withStarform(0, 0, { board: [body('k', 'ce3_orbitkeeper')] });
    s = act(s, { type: 'faceOmen' });
    expect(sf(s)).toEqual([3, 3]);
    let g = withStarform(0, 0, { board: [body('k', 'ce3_orbitkeeper', { golden: true })] });
    g = act(g, { type: 'faceOmen' });
    expect(sf(g)).toEqual([5, 5]);
    let n = run({ board: [body('k', 'ce3_orbitkeeper')] });
    n = act(n, { type: 'faceOmen' });
    expect(hasStarform(n)).toBe(false);
  });
  it('Start of Turn creates a token when none is out — into the NEW turn\'s full row, eating its right-most minion', () => {
    let s = run({ board: [body('k', 'ce3_orbitkeeper')] });
    s = rollover(s);
    expect(s.phase).toBe('recruit');
    expect(hasStarform(s), 'created at shop open').toBe(true);
    expect(s.shop.length, 'the row is exactly the tier\'s width').toBe(tierSlots(s.tier));
    const st = starformStats(s)!;
    expect(st.attack + st.health, 'ate the right-most minion of the fresh row').toBeGreaterThan(2);
    expect(s.shopMinionsEaten).toBe(1);
  });
  it('Start of Turn with a token already out: no second token, the held one keeps its stats (+2/+2 from the End of Turn)', () => {
    let s = withStarform(3, 3, { board: [body('k', 'ce3_orbitkeeper')] });
    const uid = starformOf(s)!.uid;
    s = rollover(s);
    expect(s.shop.filter((o) => o.starform)).toHaveLength(1);
    expect(starformOf(s)!.uid).toBe(uid);
    expect(sf(s)).toEqual([4 + 2, 4 + 2]);
  });
});

describe('Corona Devotee — Consume your Starform; this gains all its stats', () => {
  it('gains 100% (base 1/1 included), the token leaves; gilded gains double; no token → nothing', () => {
    let s = withStarform(4, 6, { hand: [body('d', 'ce3_coronadevotee')] }); // 5/7
    s = play(s, 'd', { toIndex: 0 });
    expect(stats(at(s, 'd'))).toEqual([4 + 5, 5 + 7]);
    expect(buffFrom(at(s, 'd'), 'Corona Devotee')).toEqual([5, 7]);
    expect(hasStarform(s)).toBe(false);
    let g = withStarform(4, 6, { hand: [body('d', 'ce3_coronadevotee', { golden: true })] });
    g = play(g, 'd', { toIndex: 0 });
    expect(stats(at(g, 'd'))).toEqual([8 + 10, 10 + 14]);
    let n = run({ hand: [body('d', 'ce3_coronadevotee')] });
    n = play(n, 'd', { toIndex: 0 });
    expect(stats(at(n, 'd'))).toEqual([4, 5]);
  });
});

describe('Star Charter — Discover a Celestial', () => {
  it('offers three Celestials, never itself and never the Starform token; gilded queues a second Discover', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let s = run({ hand: [body('c', 'ce3_starcharter')], rngCursor: seed * 7919 });
      s = play(s, 'c', { toIndex: 0 });
      expect(s.discover, `seed ${seed}`).toHaveLength(3);
      for (const id of s.discover!) {
        expect(CARD_INDEX[id]!.tribe, id).toBe('celestial');
        expect(id).not.toBe('ce3_starcharter');
        expect(id).not.toBe(STARFORM_ID);
      }
    }
    let g = run({ hand: [body('c', 'ce3_starcharter', { golden: true })] });
    g = play(g, 'c', { toIndex: 0 });
    expect(g.discover).toHaveLength(3);
    expect(g.discoverQueue, 'the second Discover waits behind the first').toHaveLength(1);
  });
});

describe('Lens Grinder — Equip Stellar Lens (2): give this shop +10/+10', () => {
  it('the play grants the Lens; activating costs 2 and buffs every current offer (the Starform keeps it past a refresh); one charge per turn', () => {
    let s = withStarform(0, 0, { hand: [body('l', 'ce3_lensgrinder')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = play(s, 'l', { toIndex: 0 });
    expect(equipmentState(s).available.map((g) => g.equipmentId)).toContain('stellar_lens');
    s = act(s, { type: 'selectEquipment', equipmentId: 'stellar_lens' } as Action);
    const gold = s.embers;
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(s.embers).toBe(gold - 2);
    expect(offerStats(s, s.shop[0]!)).toEqual([11, 11]);
    expect(sf(s)).toEqual([11, 11]);
    expect(equipmentChargesOf(s, 'stellar_lens'), 'the charge is spent').toBe(0);
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(sf(s), 'a second activation this turn is refused').toEqual([11, 11]);
    expect(s.embers).toBe(gold - 2);
    s = act(s, { type: 'roll' });
    expect(sf(s), 'the Starform kept it').toEqual([11, 11]);
    for (const o of s.shop.filter((o) => !o.starform)) expect(o.buffs?.some((b) => b.source === 'Stellar Lens') ?? false).toBe(false);
  });
  it('a gilded Grinder\'s Lens gives +20/+20', () => {
    let s = withStarform(0, 0, { hand: [body('l', 'ce3_lensgrinder', { golden: true })] });
    s = play(s, 'l', { toIndex: 0 });
    s = act(s, { type: 'selectEquipment', equipmentId: 'stellar_lens' } as Action);
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(sf(s)).toEqual([21, 21]);
  });
});

describe('Lodestar — Echo: give a friendly Celestial this minion\'s stats (its MAX stats, both phases)', () => {
  it('shop Echo: a random other friendly Celestial gains the Lodestar\'s current (buffed) stats; non-Celestials never', () => {
    const s = run({ board: [body('l', 'ce3_lodestar'), body('c', 'dbg_cel'), body('n', 'dbg_neutral')] });
    at(s, 'l').attack += 3; at(s, 'l').health += 3; // 8/12
    fireRecruitDeathrattlesForTest(s, at(s, 'l'));
    expect(stats(at(s, 'c'))).toEqual([1 + 8, 20 + 12]);
    expect(stats(at(s, 'n'))).toEqual([1, 20]);
    const g = run({ board: [body('l', 'ce3_lodestar', { golden: true }), body('c', 'dbg_cel')] });
    fireRecruitDeathrattlesForTest(g, at(g, 'l'));
    expect(stats(at(g, 'c')), 'a gilded body\'s doubled stats ARE its stats').toEqual([1 + 10, 20 + 18]);
  });
  it('combat: damaged to 5/5 (max 9), then +5/+5 → hands over 10/14, not 10/10 (owner example)', () => {
    // SC: the enemy probe deals 4 to every player minion — the Lodestar 5/9 → 5/5 (max 9), and the 1/3 Echo probe dies:
    // its Echo gives every living friend +5/+5 (Lodestar 10/10, max 14; the receiver +5/+5 too). The Lodestar is now
    // the left-most attacker (the player side is wider, so it swings first): it hits the 30/1 Taunt and dies → its
    // Echo hands the receiver its MAX stats: 10/14. The enemy's other body has 0 Attack, so nothing else moves.
    const r = fight([bm('dbg_echoall'), bm('ce3_lodestar'), bm('dbg_cel'), bm('dbg_filler')], [bm('dbg_scall'), bm('dbg_taunt')], 3);
    const lode = r.initial.player.find((m) => m.cardId === 'ce3_lodestar')!.uid;
    const cel = r.initial.player.find((m) => m.cardId === 'dbg_cel')!.uid;
    const echo = buffsFrom(r.events, lode);
    expect(echo.map((e) => [e.target, e.attack, e.health])).toEqual([[cel, 10, 14]]);
  });
});

describe('Twin Star — whenever your Starform gains stats, this gains the same', () => {
  it('mirrors a direct buff, a "this shop" buff, a consume, and a Star Crash aimed at the token; gilded doubles', () => {
    let s = withStarform(0, 0, { board: [body('t', 'ce3_twinstar')], hand: [body('w', 'ce3_wishingstar'), body('a', 'ce3_accretionwarden'), spell('sc', 'starcrash')] });
    s.shop.unshift(offer(s, 'ce3_seer'));
    buffStarform(s, 2, 3, 'test');
    expect(stats(at(s, 't')), 'a direct buff').toEqual([8, 11]);
    s = play(s, 'w', { toIndex: 0 }); // this shop +2/+2 → the token grew by 2/2 (the action-boundary diff)
    expect(stats(at(s, 't')), 'a this-shop buff').toEqual([10, 13]);
    s = play(s, 'a', { toIndex: 0 }); // the token eats the 5/5 Seer (3/3 + Wishing Star's 2/2)
    expect(stats(at(s, 't')), 'a consume').toEqual([15, 18]);
    const sfUid = starformOf(s)!.uid;
    const before = stats(at(s, 't'));
    s = play(s, 'sc', { targetUid: sfUid }); // +5/+7 to the token (mirrored) — the secondary +5/+7 lands on a random board minion
    const gain: [number, number] = [at(s, 't').attack - before[0], at(s, 't').health - before[1]];
    expect(gain[0] % 5, 'the mirror + the secondary are each +5/+7').toBe(0);
    expect(buffFrom(at(s, 't'), 'Twin Star')).toEqual([2 + 2 + 5 + 5, 3 + 2 + 5 + 7]);
    const secondary = s.board.map((c) => buffFrom(c, 'Star Crash')).reduce<[number, number]>((acc, b) => [acc[0] + b[0], acc[1] + b[1]], [0, 0]);
    expect(secondary, 'the secondary half landed once, somewhere on the board').toEqual([5, 7]);
    const g = withStarform(0, 0, { board: [body('t', 'ce3_twinstar', { golden: true })] });
    buffStarform(g, 2, 3, 'test');
    expect(buffFrom(at(g, 't'), 'Twin Star')).toEqual([4, 6]);
  });
  it('a refresh that grows nothing fires nothing; the token\'s dismissal fires nothing', () => {
    let s = withStarform(1, 1, { board: [body('t', 'ce3_twinstar')] });
    const before = stats(at(s, 't'));
    s = act(s, { type: 'roll' });
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(stats(at(s, 't'))).toEqual(before);
  });
});

describe('Nova Herald — Collapse your Starform; 3 random friendly Celestials each gain half its stats', () => {
  it('three Celestials (the Herald included) each gain the rounded-up half; a non-Celestial never', () => {
    let s = withStarform(6, 9, { board: [body('a', 'dbg_cel'), body('b', 'dbg_cel2'), body('n', 'dbg_neutral')], hand: [body('h', 'ce3_novaherald')] }); // 7/10 → 4/5
    s = play(s, 'h', { toIndex: 0 });
    expect(hasStarform(s)).toBe(false);
    for (const uid of ['a', 'b', 'h']) expect(buffFrom(at(s, uid), 'Nova Herald'), uid).toEqual([4, 5]);
    expect(stats(at(s, 'n'))).toEqual([1, 20]);
  });
  it('two Celestials → both; the Herald alone → just the Herald; a token but no Celestial cannot happen (the Herald is one) — a token and non-Celestials: only the Herald', () => {
    let s = withStarform(6, 9, { board: [body('a', 'dbg_cel')], hand: [body('h', 'ce3_novaherald')] });
    s = play(s, 'h', { toIndex: 0 });
    expect(buffFrom(at(s, 'a'), 'Nova Herald')).toEqual([4, 5]);
    expect(buffFrom(at(s, 'h'), 'Nova Herald')).toEqual([4, 5]);
    let t = withStarform(6, 9, { board: [body('n', 'dbg_neutral'), body('m', 'dbg_neutral')], hand: [body('h', 'ce3_novaherald')] });
    t = play(t, 'h', { toIndex: 0 });
    expect(hasStarform(t), 'collapsed').toBe(false);
    expect(buffFrom(at(t, 'h'), 'Nova Herald')).toEqual([4, 5]);
    expect(stats(at(t, 'n'))).toEqual([1, 20]);
    expect(stats(at(t, 'm'))).toEqual([1, 20]);
  });
  it('no Starform → nothing happens; gilded → each gains the FULL stats', () => {
    let s = run({ board: [body('a', 'dbg_cel')], hand: [body('h', 'ce3_novaherald')] });
    s = play(s, 'h', { toIndex: 0 });
    expect(stats(at(s, 'a'))).toEqual([1, 20]);
    expect(stats(at(s, 'h'))).toEqual([6, 9]);
    let g = withStarform(6, 9, { board: [body('a', 'dbg_cel')], hand: [body('h', 'ce3_novaherald', { golden: true })] });
    g = play(g, 'h', { toIndex: 0 });
    expect(buffFrom(at(g, 'a'), 'Nova Herald')).toEqual([8, 10]);
  });
  it('four Celestials: exactly three gain, seeded', () => {
    let s = withStarform(6, 9, { board: [body('a', 'dbg_cel'), body('b', 'dbg_cel2'), body('c', 'dbg_cel')], hand: [body('h', 'ce3_novaherald')] });
    s = play(s, 'h', { toIndex: 0 });
    const gained = ['a', 'b', 'c', 'h'].filter((uid) => buffFrom(at(s, uid), 'Nova Herald')[0] === 4);
    expect(gained).toHaveLength(3);
  });
});

describe('Zenith — spells feed the Starform +3/+3; a consumed / collapsed token is reborn at half', () => {
  it('a Shop spell and a Ruby each pay +3/+3 (a spell of any kind); gilded +6/+6', () => {
    let s = withStarform(0, 0, { board: [body('z', 'ce3_zenith'), body('c', 'dbg_cel')], hand: [spell('sc', 'starcrash'), body('r', 'ruby')] });
    s = play(s, 'sc', { targetUid: 'c' });
    expect(sf(s)).toEqual([4, 4]);
    s = play(s, 'r', { targetUid: 'c' });
    expect(sf(s), 'a Ruby is a spell too').toEqual([7, 7]);
    let g = withStarform(0, 0, { board: [body('z', 'ce3_zenith', { golden: true }), body('c', 'dbg_cel')], hand: [spell('sc', 'starcrash')] });
    g = play(g, 'sc', { targetUid: 'c' });
    expect(sf(g)).toEqual([7, 7]);
  });
  it('after a CONSUME (Corona Devotee) a new token appears with half the old one\'s stats, rounded up', () => {
    let s = withStarform(6, 9, { board: [body('z', 'ce3_zenith')], hand: [body('d', 'ce3_coronadevotee')] }); // 7/10
    const old = starformOf(s)!.uid;
    s = play(s, 'd', { toIndex: 0 });
    expect(stats(at(s, 'd')), 'the Devotee still ate the whole 7/10').toEqual([4 + 7, 5 + 10]);
    expect(hasStarform(s)).toBe(true);
    expect(starformOf(s)!.uid).not.toBe(old);
    expect(sf(s)).toEqual([4, 5]);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Zenith')).toMatchObject({ attack: 3, health: 4 });
  });
  it('after a COLLAPSE (Nova Herald) too; NOT after the dismiss buy', () => {
    let s = withStarform(6, 9, { board: [body('z', 'ce3_zenith')], hand: [body('h', 'ce3_novaherald')] });
    s = play(s, 'h', { toIndex: 0 });
    expect(sf(s)).toEqual([4, 5]);
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(hasStarform(s), 'dismissed stays dismissed').toBe(false);
  });
  it('the rebirth into a FULL row eats the right-most minion (rule 1), and the mirror hears it', () => {
    let s = run({ board: [body('z', 'ce3_zenith'), body('t', 'ce3_twinstar')], hand: [body('d', 'ce3_coronadevotee')] });
    rollShop(s); // a full row…
    createStarform(s, SRC); // …so the creation eats one; the token then carries that meal
    buffStarform(s, 0, 0, 'noop');
    const full = starformStats(s)!;
    const half = { attack: Math.ceil(full.attack / 2), health: Math.ceil(full.health / 2) };
    const rightmost = s.shop[s.shop.length - 1]!;
    const meal = rightmost.starform ? null : offerBuyStats(s, rightmost);
    const twinBefore = stats(at(s, 't'));
    s = play(s, 'd', { toIndex: 0 });
    expect(hasStarform(s)).toBe(true);
    expect(s.shop.length, 'no overflow').toBe(tierSlots(s.tier));
    const reborn = starformStats(s)!;
    if (meal) expect([reborn.attack, reborn.health]).toEqual([half.attack + meal.attack, half.health + meal.health]);
    else expect([reborn.attack, reborn.health]).toEqual([half.attack, half.health]);
    expect(at(s, 't').attack, 'Twin Star mirrored the rebirth\'s gains').toBeGreaterThan(twinBefore[0]);
  });
  it('gilded Zenith: the new token carries the FULL stats', () => {
    let s = withStarform(6, 9, { board: [body('z', 'ce3_zenith', { golden: true })], hand: [body('d', 'ce3_coronadevotee')] });
    s = play(s, 'd', { toIndex: 0 });
    expect(sf(s)).toEqual([7, 10]);
  });
});

describe('Constellation Prime — your Star Crashes cast an additional time (the primary re-lands); Shout: 2 Star Crashes', () => {
  it('the Shout mints 2 (gilded 4)', () => {
    let s = run({ hand: [body('p', 'ce3_constellationprime')] });
    s = play(s, 'p', { toIndex: 0 });
    expect(s.hand.filter((c) => c.cardId === 'starcrash')).toHaveLength(2);
    let g = run({ hand: [body('p', 'ce3_constellationprime', { golden: true })] });
    g = play(g, 'p', { toIndex: 0 });
    expect(g.hand.filter((c) => c.cardId === 'starcrash')).toHaveLength(4);
    expect(primeExtraPrimaryLands(g)).toBe(2);
  });
  it('primary ×2, secondary ×1: a lone Celestial takes +15/+21 (vs +10/+14 without a Prime)', () => {
    let s = run({ board: [body('p', 'ce3_constellationprime')], hand: [spell('sc', 'starcrash')] });
    s = play(s, 'sc', { targetUid: 'p' });
    expect(buffFrom(at(s, 'p'), 'Star Crash')).toEqual([15, 21]);
    let n = run({ board: [body('c', 'dbg_cel')], hand: [spell('sc', 'starcrash')] });
    n = play(n, 'sc', { targetUid: 'c' });
    expect(buffFrom(at(n, 'c'), 'Star Crash')).toEqual([10, 14]);
  });
  it('with two bodies the chosen target takes the doubled primary; the single secondary lands on one of them', () => {
    let s = run({ board: [body('p', 'ce3_constellationprime'), body('c', 'dbg_cel')], hand: [spell('sc', 'starcrash')] });
    s = play(s, 'sc', { targetUid: 'c' });
    const c = buffFrom(at(s, 'c'), 'Star Crash'), p = buffFrom(at(s, 'p'), 'Star Crash');
    expect(c[0]).toBeGreaterThanOrEqual(10);
    expect([c[0] + p[0], c[1] + p[1]], 'primary twice + secondary once').toEqual([15, 21]);
  });
  it('stacks with Comet: every multiplied cast re-lands the primary (3 casts → +45/+63 on a lone body); gilded Prime → primary ×3', () => {
    let s = run({ board: [body('p', 'ce3_constellationprime')], hand: [body('o', 'ce3_artificer'), spell('sc', 'starcrash')] });
    s = play(s, 'o', { toIndex: 1 }); // the play grants Comet
    s = act(s, { type: 'selectEquipment', equipmentId: 'comet' } as Action);
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(s.nextSpellExtraCasts).toBe(2);
    s = play(s, 'sc', { targetUid: 'p' });
    const p = buffFrom(at(s, 'p'), 'Star Crash'), o = buffFrom(at(s, 'o'), 'Star Crash');
    expect([p[0] + o[0], p[1] + o[1]], '3 casts × (primary 2 + secondary 1)').toEqual([45, 63]);
    expect(p[0], 'the target took the six primaries at least').toBeGreaterThanOrEqual(30);
    let g = run({ board: [body('p', 'ce3_constellationprime', { golden: true })], hand: [spell('sc', 'starcrash')] });
    g = play(g, 'sc', { targetUid: 'p' });
    expect(buffFrom(at(g, 'p'), 'Star Crash')).toEqual([20, 28]);
  });
});

describe('Accretion (spell) — the Starform consumes the highest-Health Shop minion; get a Star Crash', () => {
  it('the highest CURRENT buy Health is eaten; a tie goes right-most; a Star Crash arrives', () => {
    let s = withStarform(0, 0, { hand: [spell('ac', 'accretion')] });
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'), offer(s, 'ce3_seer'));
    expect(pickShopMinionFor(s, 'highestHealth')).toBe(1); // the 2/4 Vendor
    s = play(s, 'ac');
    expect(s.shop.map((o) => o.cardId)).toEqual(['ce3_courier', 'ce3_seer', STARFORM_ID]);
    expect(sf(s)).toEqual([1 + 2, 1 + 4]);
    expect(s.hand.map((c) => c.cardId)).toEqual(['starcrash']);
    let t = withStarform(0, 0, { hand: [spell('ac', 'accretion')] });
    t.shop.unshift(offer(t, 'ce3_seer'), offer(t, 'ce3_seer', { hp: 1 }), offer(t, 'ce3_courier', { hp: 3 })); // 3/3, 3/4, 1/4 → the right-most 4
    const right = t.shop[2]!.uid;
    t = play(t, 'ac');
    expect(t.shop.some((o) => o.uid === right)).toBe(false);
    expect(sf(t)).toEqual([2, 5]);
  });
  it('no Starform → the consume is skipped, the Star Crash still arrives; Comet repeats the whole cast', () => {
    let s = run({ hand: [spell('ac', 'accretion')], shop: [] });
    s.shop.push(offer(s, 'ce3_vendor'));
    s = play(s, 'ac');
    expect(s.shop).toHaveLength(1);
    expect(s.hand.map((c) => c.cardId)).toEqual(['starcrash']);
    let c = withStarform(0, 0, { hand: [body('o', 'ce3_artificer'), spell('ac', 'accretion')] });
    c.shop.unshift(offer(c, 'ce3_courier'), offer(c, 'ce3_vendor'));
    c = play(c, 'o', { toIndex: 0 });
    c = act(c, { type: 'selectEquipment', equipmentId: 'comet' } as Action);
    c = act(c, { type: 'activateEquipment' } as Action);
    c = play(c, 'ac');
    expect(c.shop.filter((o) => !o.starform), 'three casts, two meals available').toHaveLength(0);
    expect(c.hand.filter((x) => x.cardId === 'starcrash')).toHaveLength(3);
    expect(sf(c)).toEqual([1 + 2 + 1, 1 + 4 + 1]);
  });
});

describe('Star Crash aimed at the Starform', () => {
  it('a friendly-Celestial spell may target the token: +5/+7 through buffStarform (the ledger names the spell); the secondary lands on a board minion', () => {
    let s = withStarform(0, 0, { board: [body('c', 'dbg_cel')], hand: [spell('sc', 'starcrash')] });
    const uid = starformOf(s)!.uid;
    s = play(s, 'sc', { targetUid: uid });
    expect(s.hand, 'the spell was cast').toHaveLength(0);
    expect(sf(s)).toEqual([6, 8]);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Star Crash')).toMatchObject({ attack: 5, health: 7 });
    expect(buffFrom(at(s, 'c'), 'Star Crash'), 'the secondary half').toEqual([5, 7]);
    expect(s.spellsThisTurn).toBe(1);
  });
  it('any OTHER offer is not a friendly minion — the cast is refused and the spell stays in hand; a Prime doubles the primary on the token too', () => {
    let s = withStarform(0, 0, { board: [body('c', 'dbg_cel')], hand: [spell('sc', 'starcrash')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    const before = s;
    s = play(s, 'sc', { targetUid: s.shop[0]!.uid });
    expect(s).toBe(before);
    let p = withStarform(0, 0, { board: [body('p', 'ce3_constellationprime')], hand: [spell('sc', 'starcrash')] });
    p = play(p, 'sc', { targetUid: starformOf(p)!.uid });
    expect(sf(p)).toEqual([11, 15]);
  });
});
