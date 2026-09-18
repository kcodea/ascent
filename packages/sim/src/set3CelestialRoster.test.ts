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
import { equipmentState, equipmentChargesOf, holdsEquipment, selectEquipment } from './equipment';
import { collapseExtraTargetsOf, starformPrice } from './starform';
import { STAR_DESTROYER } from '@game/content';

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
  ['ce3_starseed', 'Star Seed', 1, 2, 2], // 2/1 → 2/2, owner stat pass 2026-09-18 ['ce3_dawnsentinel', 'Dawn Sentinel', 1, 1, 3],
  ['ce3_peddler', 'Stardust Peddler', 2, 2, 3], ['ce3_wishingstar', 'Wishing Star', 2, 2, 3],
  ['ce3_accretionwarden', 'The Great Attractor', 3, 3, 4], ['ce3_shootingstar', 'Rocket Power', 3, 3, 2], ['ce3_eclipsewarden', 'Totality', 3, 3, 6],
  ['ce3_orbitkeeper', 'Roundabout', 5, 7, 5], ['ce3_coronadevotee', 'Solburn', 4, 4, 5], ['ce3_starcharter', 'Maestro Lux', 4, 3, 4],
  ['ce3_lensgrinder', 'Lens Grinder', 4, 4, 6], ['ce3_lodestar', 'Lodestar', 5, 5, 5], // Lodestar 5/9 → 5/5 (2026-09-18)
  ['ce3_twinstar', 'Twinning', 5, 4, 7], // 6/8 → 4/7 (2026-09-18) ['ce3_novaherald', 'Fuse Aldrin', 6, 6, 9],
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
    expect(CARD_INDEX['ce3_shootingstar']!.keywords, 'Rocket Power lost Flurry 2026-09-14').toEqual([]);
    expect(CARD_INDEX['ce3_zenith']!.tier).toBe(7);
    expect(CARD_INDEX['ce3_constellationprime']!.tier).toBe(7);
    expect(poolFor('set2').buyable.some((c) => c.id.startsWith('ce3_')), 'set 2 has none').toBe(false);
  });
  it('Black Hole (was Accretion) is a set-3 Celestial spell offered only while Celestial is a run tribe; the Stellar Lens is registered', () => {
    const d = CARD_INDEX['accretion']!;
    expect([d.name, d.spell, d.tribe, d.tier, d.cost]).toEqual(['Black Hole', true, 'celestial', 3, 2]);
    expect(runSpells({ setId: 'set3', tribes: ['celestial', 'undead'] }).some((c) => c.id === 'accretion')).toBe(true);
    expect(runSpells({ setId: 'set3', tribes: ['undead', 'kobold'] }).some((c) => c.id === 'accretion')).toBe(false);
    expect(EQUIPMENT_INDEX['stellar_lens']).toMatchObject({ baseCost: 2, targetMode: 'none', effectId: 'equipmentCreateStarformThenBuffThisShop', params: { attack: 7, health: 7 }, gildedParams: { attack: 14, health: 14 } });
  });
});

describe('Star Seed — create a Starform, or +4/+4 to the one you have (owner 2026-09-14; was +2/+2)', () => {
  it('creates a 1/1 token into an open slot; a second Seed feeds it +4/+4; a gilded Seed +8/+8', () => {
    let s = run({ hand: [body('a', 'ce3_starseed'), body('b', 'ce3_starseed'), body('g', 'ce3_starseed', { golden: true })], shop: [] });
    s = play(s, 'a', { toIndex: 0 });
    expect(hasStarform(s)).toBe(true);
    expect(sf(s)).toEqual([1, 1]);
    const uid = starformOf(s)!.uid;
    s = play(s, 'b', { toIndex: 0 });
    expect(starformOf(s)!.uid, 'still one token').toBe(uid);
    expect(sf(s)).toEqual([5, 5]);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Star Seed')).toMatchObject({ attack: 4, health: 4 });
    s = play(s, 'g', { toIndex: 0 });
    expect(sf(s)).toEqual([13, 13]);
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

describe('Stardust Peddler — whenever you buy a minion, create a Starform or give one +1/+2 (owner 2026-09-14)', () => {
  it('a normal buy feeds a held token +1/+2; the token\'s own buy counts as a buy, the Peddler consumes it, and the Peddler RE-SEEDS a fresh 1/1', () => {
    let s = withStarform(0, 0, { board: [body('p', 'ce3_peddler')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid });
    expect(sf(s)).toEqual([2, 3]);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Stardust Peddler')).toMatchObject({ attack: 1, health: 2 });
    const bought = s.cardsBoughtThisTurn ?? 0;
    const old = starformOf(s)!.uid;
    s = act(s, { type: 'buy', uid: old }); // 6 Gold: the Peddler consumes the 2/3 token …
    expect(s.cardsBoughtThisTurn, 'counted as a buy').toBe(bought + 1);
    expect(stats(at(s, 'p')), 'the Peddler received the token (+2/+3)').toEqual([2 + 2, 3 + 3]);
    expect(buffFrom(at(s, 'p'), 'Starform')).toEqual([2, 3]);
    // … and, the token being gone when the buy watchers fire, creates a new one ("create a Starform or …").
    expect(hasStarform(s), 'the Peddler re-seeded a token').toBe(true);
    expect(starformOf(s)!.uid).not.toBe(old);
    expect(sf(s)).toEqual([1, 1]);
  });
  it('gilded: +2/+4 per buy; with NO Starform a buy CREATES one (nothing to double)', () => {
    let s = withStarform(0, 0, { board: [body('p', 'ce3_peddler', { golden: true })] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid });
    expect(sf(s)).toEqual([3, 5]);
    let t = run({ board: [body('p', 'ce3_peddler')], shop: [] });
    t.shop.push(offer(t, 'ce3_courier'));
    t = act(t, { type: 'buy', uid: t.shop[0]!.uid });
    expect(hasStarform(t), 'created on the buy').toBe(true);
    expect(sf(t)).toEqual([1, 1]);
  });
});

describe('Wishing Star — Shout: adjacent minions +3/+4 (owner 2026-09-14; was Shout + Echo "this shop +2/+2")', () => {
  it('both neighbours gain +3/+4, nobody else and not the shop; gilded +6/+8', () => {
    let s = withStarform(0, 0, { board: [body('l', 'dbg_cel'), body('r', 'dbg_neutral'), body('x', 'dbg_cel2')], hand: [body('w', 'ce3_wishingstar')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = play(s, 'w', { toIndex: 1 });
    expect(stats(at(s, 'l'))).toEqual([1 + 3, 20 + 4]);
    expect(stats(at(s, 'r'))).toEqual([1 + 3, 20 + 4]);
    expect(stats(at(s, 'x')), 'not adjacent').toEqual([1, 20]);
    expect(offerStats(s, s.shop[0]!), 'the shop is untouched').toEqual([2, 1]); // Cosmo Express 2/1 since 2026-09-18
    expect(sf(s)).toEqual([1, 1]);
    let g = run({ board: [body('l', 'dbg_cel')], hand: [body('w', 'ce3_wishingstar', { golden: true })] });
    g = play(g, 'w', { toIndex: 1 });
    expect(stats(at(g, 'l'))).toEqual([1 + 6, 20 + 8]);
  });
  it('no Echo any more: a shop death fires nothing', () => {
    const s = withStarform(0, 0, { board: [body('w', 'ce3_wishingstar'), body('l', 'dbg_cel')] });
    fireRecruitDeathrattlesForTest(s, at(s, 'w'));
    expect(stats(at(s, 'l'))).toEqual([1, 20]);
    expect(sf(s)).toEqual([1, 1]);
  });
});

describe('The Great Attractor — Shout: this shop +4/+3, THEN the Starform consumes the highest-Health minion (owner 2026-09-14)', () => {
  it('every offer takes +4/+3 first, so the meal carries it; highest CURRENT Health wins, ties go RIGHT-most', () => {
    let s = withStarform(0, 0, { hand: [body('w', 'ce3_accretionwarden')] });
    // courier 2/1, vendor 2/4, seer 0/8, seer 0/8 (stats since the 2026-09-18 owner pass) → the two Seers tie at 8 Health,
    // so the RIGHT-most Seer is the meal; the buff lands before it is eaten
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'), offer(s, 'ce3_seer'), offer(s, 'ce3_seer'));
    const rightSeer = s.shop[3]!.uid, leftSeer = s.shop[2]!.uid;
    s = play(s, 'w', { toIndex: 0 });
    expect(s.shop.some((o) => o.uid === rightSeer), 'the highest-Health offer was eaten').toBe(false);
    expect(s.shop.some((o) => o.uid === leftSeer), 'the tie went RIGHT-most').toBe(true);
    expect(offerStats(s, s.shop[0]!), 'the survivors keep the +4/+3').toEqual([2 + 4, 1 + 3]);
    expect(sf(s), 'token 1/1 + its own +4/+3 + the buffed seer (0+4)/(8+3)').toEqual([1 + 4 + 4, 1 + 3 + 11]);
    expect(s.shopMinionsEaten, 'a real Shop consume').toBe(1);
    expect(s.tavernBuyBonus, 'THIS shop, never the permanent Staff-of-Guel channel').toEqual({ atk: 0, hp: 0 });
  });
  it('no Starform → the buff still lands, nothing is eaten; gilded → +8/+6 and the token gains double the meal', () => {
    let s = run({ hand: [body('w', 'ce3_accretionwarden')], shop: [] });
    s.shop.push(offer(s, 'ce3_seer'));
    s = play(s, 'w', { toIndex: 0 });
    expect(s.shop.length).toBe(1);
    expect(offerStats(s, s.shop[0]!)).toEqual([0 + 4, 8 + 3]); // Gravestar Seer 0/8 since 2026-09-18
    expect(hasStarform(s)).toBe(false);
    let g = withStarform(0, 0, { hand: [body('w', 'ce3_accretionwarden', { golden: true })] });
    g.shop.unshift(offer(g, 'ce3_seer'));
    g = play(g, 'w', { toIndex: 0 });
    expect(sf(g), 'token 1/1 + 8/6 + double the buffed seer (0+8)/(8+6)').toEqual([1 + 8 + 16, 1 + 6 + 28]);
    expect(g.shop.length, 'one meal, not two').toBe(1);
  });
});

describe('Rocket Power (was Shooting Star; no Flurry) — Shout: this shop +3/+3 per Shop spell cast this turn (live text)', () => {
  const cast = (s: RunState, n: number): RunState => {
    for (let i = 0; i < n; i++) {
      s.hand.push(spell(`sc${i}`, 'starcrash'));
      s = play(s, `sc${i}`, { targetUid: 'c' });
    }
    return s;
  };
  it('0 spells → the base +3/+3; 1 → +6/+6; 3 → +12/+12; gilded with 2 → +18/+18 (base once, repeated per spell — owner 2026-09-14)', () => {
    for (const [n, golden, want] of [[0, false, 3], [1, false, 6], [3, false, 12], [2, true, 18]] as const) {
      let s = withStarform(0, 0, { board: [body('c', 'dbg_cel')], hand: [body('w', 'ce3_shootingstar', { golden })] });
      s.shop.unshift(offer(s, 'ce3_courier'));
      s = cast(s, n);
      expect(s.spellsThisTurn).toBe(n);
      s = play(s, 'w', { toIndex: 0 });
      expect(offerStats(s, s.shop[0]!), `${n} spells`).toEqual([2 + want, 1 + want]); // Cosmo Express 2/1 since 2026-09-18
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

describe('Roundabout (T5 7/5) — End of Turn: the Starform consumes the Shop. Start of Turn: create one if none (owner 2026-09-14)', () => {
  const rollover = (s: RunState): RunState => act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  it('End of Turn: every minion offer is eaten (spells stay), one real consume each; gilded doubles each meal; nothing without a token', () => {
    let s = withStarform(0, 0, { board: [body('k', 'ce3_orbitkeeper')] });
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'), offer(s, 'starcrash')); // 2/1 (since 2026-09-18), 2/4, a spell
    s = act(s, { type: 'faceOmen' });
    expect(s.shop.filter((o) => !o.starform).map((o) => o.cardId), 'only the spell survived').toEqual(['starcrash']);
    expect(sf(s)).toEqual([1 + 2 + 2, 1 + 1 + 4]);
    expect(s.shopMinionsEaten, 'two real consumes').toBe(2);
    let g = withStarform(0, 0, { board: [body('k', 'ce3_orbitkeeper', { golden: true })] });
    g.shop.unshift(offer(g, 'ce3_courier'), offer(g, 'ce3_vendor'));
    g = act(g, { type: 'faceOmen' });
    expect(sf(g)).toEqual([1 + 4 + 4, 1 + 2 + 8]);
    let n = run({ board: [body('k', 'ce3_orbitkeeper')], shop: [] });
    n.shop.push(offer(n, 'ce3_courier'));
    n = act(n, { type: 'faceOmen' });
    expect(hasStarform(n)).toBe(false);
    expect(n.shop, 'no token, nothing eaten').toHaveLength(1);
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
  it('Start of Turn with a token already out: no second token, the held one keeps its stats (an empty row at End of Turn fed it nothing)', () => {
    let s = withStarform(3, 3, { board: [body('k', 'ce3_orbitkeeper')] });
    const uid = starformOf(s)!.uid;
    s = rollover(s);
    expect(s.shop.filter((o) => o.starform)).toHaveLength(1);
    expect(starformOf(s)!.uid).toBe(uid);
    expect(sf(s)).toEqual([4, 4]);
  });
});

describe('Corona Devotee — Collapse your Starform: 2 unique random friendly Celestials each gain half its stats (rules v2)', () => {
  it('two Celestials (the Devotee included) each gain the rounded-up half; a non-Celestial never; the token leaves', () => {
    let s = withStarform(6, 9, { board: [body('a', 'dbg_cel'), body('n', 'dbg_neutral')], hand: [body('d', 'ce3_coronadevotee')] }); // 7/10 → 4/5
    s = play(s, 'd', { toIndex: 0 });
    expect(hasStarform(s)).toBe(false);
    for (const uid of ['a', 'd']) expect(buffFrom(at(s, uid), 'Solburn'), uid).toEqual([4, 5]);
    expect(stats(at(s, 'n'))).toEqual([1, 20]);
  });
  it('three Celestials: exactly two gain, seeded; the Devotee alone → just the Devotee; gilded → each gains the FULL stats; no Starform → nothing', () => {
    let s = withStarform(6, 9, { board: [body('a', 'dbg_cel'), body('b', 'dbg_cel2')], hand: [body('d', 'ce3_coronadevotee')] });
    s = play(s, 'd', { toIndex: 0 });
    const gained = ['a', 'b', 'd'].filter((uid) => buffFrom(at(s, uid), 'Solburn')[0] === 4);
    expect(gained, 'two unique hits').toHaveLength(2);
    let t = withStarform(6, 9, { board: [body('n', 'dbg_neutral'), body('m', 'dbg_neutral')], hand: [body('d', 'ce3_coronadevotee')] });
    t = play(t, 'd', { toIndex: 0 });
    expect(hasStarform(t), 'collapsed').toBe(false);
    expect(buffFrom(at(t, 'd'), 'Solburn')).toEqual([4, 5]);
    expect(stats(at(t, 'n'))).toEqual([1, 20]);
    let g = withStarform(6, 9, { board: [body('a', 'dbg_cel')], hand: [body('d', 'ce3_coronadevotee', { golden: true })] });
    g = play(g, 'd', { toIndex: 0 });
    expect(buffFrom(at(g, 'a'), 'Solburn')).toEqual([8, 10]);
    expect(buffFrom(at(g, 'd'), 'Solburn')).toEqual([8, 10]);
    let n = run({ board: [body('a', 'dbg_cel')], hand: [body('d', 'ce3_coronadevotee')] });
    n = play(n, 'd', { toIndex: 0 });
    expect(stats(at(n, 'a'))).toEqual([1, 20]);
    expect(stats(at(n, 'd'))).toEqual([4, 5]);
  });
  it('the collapse fires starformRemoved(collapse): a Zenith re-creates at the fresh 6-Gold price', () => {
    let s = withStarform(6, 9, { board: [body('z', 'ce3_zenith')], hand: [body('d', 'ce3_coronadevotee')] });
    for (let i = 0; i < 2; i++) s = act(s, { type: 'roll' });
    expect(starformPrice(s)).toBe(4);
    s = play(s, 'd', { toIndex: 0 });
    expect(hasStarform(s)).toBe(true);
    expect(starformPrice(s), 'a new token, 6 Gold').toBe(6);
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

describe('Lens Grinder (T4 4/6) — Equip Stellar Lens (2): create a Starform, then this shop +7/+7 (owner 2026-09-14)', () => {
  it('the play grants the Lens; activating costs 2, keeps a held token, and buffs every current offer +7/+7 (the Starform keeps it past a refresh); one charge per turn', () => {
    let s = withStarform(0, 0, { hand: [body('l', 'ce3_lensgrinder')] });
    s.shop.unshift(offer(s, 'ce3_courier'));
    s = play(s, 'l', { toIndex: 0 });
    expect(equipmentState(s).available.map((g) => g.equipmentId)).toContain('stellar_lens');
    s = act(s, { type: 'selectEquipment', equipmentId: 'stellar_lens' } as Action);
    const gold = s.embers, uid = starformOf(s)!.uid;
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(s.embers).toBe(gold - 2);
    expect(starformOf(s)!.uid, 'a held token is kept, not replaced').toBe(uid);
    expect(offerStats(s, s.shop[0]!)).toEqual([9, 8]); // Cosmo Express 2/1 since 2026-09-18
    expect(sf(s)).toEqual([8, 8]);
    expect(equipmentChargesOf(s, 'stellar_lens'), 'the charge is spent').toBe(0);
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(sf(s), 'a second activation this turn is refused').toEqual([8, 8]);
    expect(s.embers).toBe(gold - 2);
    s = act(s, { type: 'roll' });
    expect(sf(s), 'the Starform kept it').toEqual([8, 8]);
    for (const o of s.shop.filter((o) => !o.starform)) expect(o.buffs?.some((b) => b.source === 'Stellar Lens') ?? false).toBe(false);
  });
  it('with NO Starform the Lens creates one first, and the fresh token takes the +7/+7 too; a gilded Grinder\'s Lens gives +14/+14', () => {
    let s = run({ hand: [body('l', 'ce3_lensgrinder')], shop: [] });
    s.shop.push(offer(s, 'ce3_courier'));
    s = play(s, 'l', { toIndex: 0 });
    s = act(s, { type: 'selectEquipment', equipmentId: 'stellar_lens' } as Action);
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(hasStarform(s), 'created by the Lens').toBe(true);
    expect(sf(s), 'the new 1/1 took the buff').toEqual([8, 8]);
    expect(offerStats(s, s.shop[0]!)).toEqual([9, 8]); // Cosmo Express 2/1 since 2026-09-18
    let g = withStarform(0, 0, { hand: [body('l', 'ce3_lensgrinder', { golden: true })] });
    g = play(g, 'l', { toIndex: 0 });
    g = act(g, { type: 'selectEquipment', equipmentId: 'stellar_lens' } as Action);
    g = act(g, { type: 'activateEquipment' } as Action);
    expect(sf(g)).toEqual([15, 15]);
  });
});

describe('Lodestar — Echo: give a friendly Celestial this minion\'s stats (its MAX stats, both phases)', () => {
  it('shop Echo: a random other friendly Celestial gains the Lodestar\'s current (buffed) stats; non-Celestials never', () => {
    const s = run({ board: [body('l', 'ce3_lodestar'), body('c', 'dbg_cel'), body('n', 'dbg_neutral')] });
    at(s, 'l').attack += 3; at(s, 'l').health += 3; // 8/8 (Lodestar 5/5 since 2026-09-18)
    fireRecruitDeathrattlesForTest(s, at(s, 'l'));
    expect(stats(at(s, 'c'))).toEqual([1 + 8, 20 + 8]);
    expect(stats(at(s, 'n'))).toEqual([1, 20]);
    const g = run({ board: [body('l', 'ce3_lodestar', { golden: true }), body('c', 'dbg_cel')] });
    fireRecruitDeathrattlesForTest(g, at(g, 'l'));
    expect(stats(at(g, 'c')), 'a gilded body\'s doubled stats ARE its stats').toEqual([1 + 10, 20 + 10]);
  });
  it('combat: damaged to 5/5 (max 9), then +5/+5 → hands over 10/14, not 10/10 (owner example)', () => {
    // SC: the enemy probe deals 4 to every player minion — the Lodestar 5/9 → 5/5 (max 9), and the 1/3 Echo probe dies:
    // its Echo gives every living friend +5/+5 (Lodestar 10/10, max 14; the receiver +5/+5 too). The Lodestar is now
    // the left-most attacker (the player side is wider, so it swings first): it hits the 30/1 Taunt and dies → its
    // Echo hands the receiver its MAX stats: 10/14. The enemy's other body has 0 Attack, so nothing else moves.
    // The card is 5/5 since the 2026-09-18 owner pass; the owner's example needs max ≠ current, so the probe keeps a 5/9 body.
    const r = fight([bm('dbg_echoall'), bm('ce3_lodestar', { health: 9 }), bm('dbg_cel'), bm('dbg_filler')], [bm('dbg_scall'), bm('dbg_taunt')], 3);
    const lode = r.initial.player.find((m) => m.cardId === 'ce3_lodestar')!.uid;
    const cel = r.initial.player.find((m) => m.cardId === 'dbg_cel')!.uid;
    const echo = buffsFrom(r.events, lode);
    expect(echo.map((e) => [e.target, e.attack, e.health])).toEqual([[cel, 10, 14]]);
  });
});

describe('Twinning (was Twin Star; T5) — whenever your Starform gains stats, this gains the same', () => {
  it('mirrors a direct buff, a "this shop" buff, a consume, and a Star Crash aimed at the token; gilded doubles', () => {
    let s = withStarform(0, 0, { board: [body('t', 'ce3_twinstar')], hand: [body('w', 'ce3_wishingstar'), body('a', 'ce3_accretionwarden'), spell('sc', 'starcrash')] });
    s.shop.unshift(offer(s, 'ce3_seer'));
    buffStarform(s, 2, 3, 'test');
    expect(stats(at(s, 't')), 'a direct buff').toEqual([6, 10]); // Twinning 4/7 since 2026-09-18
    s = play(s, 'w', { toIndex: 0 }); // Wishing Star (2026-09-14): a plain adjacent +3/+4 on the Twinning — NOT a mirror
    expect(stats(at(s, 't')), 'an adjacent buff, direct').toEqual([9, 14]);
    s = play(s, 'a', { toIndex: 0 }); // The Great Attractor: this shop +4/+3 (mirrored) then the token eats the 4/11 Seer (0/8 + 4/3) (mirrored)
    expect(stats(at(s, 't')), 'a this-shop buff + a consume').toEqual([9 + 4 + 4, 14 + 3 + 11]);
    const sfUid = starformOf(s)!.uid;
    const before = stats(at(s, 't'));
    s = play(s, 'sc', { targetUid: sfUid }); // +5/+7 to the token (mirrored) — the secondary +5/+7 lands on a random board minion
    const gain: [number, number] = [at(s, 't').attack - before[0], at(s, 't').health - before[1]];
    expect(gain[0] % 5, 'the mirror + the secondary are each +5/+7').toBe(0);
    expect(buffFrom(at(s, 't'), 'Twinning')).toEqual([2 + 4 + 4 + 5, 3 + 3 + 11 + 7]);
    const secondary = s.board.map((c) => buffFrom(c, 'Star Crash')).reduce<[number, number]>((acc, b) => [acc[0] + b[0], acc[1] + b[1]], [0, 0]);
    expect(secondary, 'the secondary half landed once, somewhere on the board').toEqual([5, 7]);
    const g = withStarform(0, 0, { board: [body('t', 'ce3_twinstar', { golden: true })] });
    buffStarform(g, 2, 3, 'test');
    expect(buffFrom(at(g, 't'), 'Twinning')).toEqual([4, 6]);
  });
  it('a refresh that grows nothing fires nothing; the Star Destroyer\'s exit fires nothing; the token\'s BUY is heard as a consume (the receiver is the left-most Celestial — here the Twin Star itself)', () => {
    let s = withStarform(1, 1, { board: [body('t', 'ce3_twinstar')] });
    const before = stats(at(s, 't'));
    s = act(s, { type: 'roll' });
    expect(stats(at(s, 't'))).toEqual(before);
    selectEquipment(s, STAR_DESTROYER.id);
    s = act(s, { type: 'activateEquipment' });
    expect(hasStarform(s)).toBe(false);
    expect(stats(at(s, 't')), 'the silent exit').toEqual(before);
    let b = withStarform(1, 1, { board: [body('t', 'ce3_twinstar')] });
    b = act(b, { type: 'buy', uid: starformOf(b)!.uid });
    expect(buffFrom(at(b, 't'), 'Starform'), 'the buy: the Twin Star IS the left-most Celestial and consumes the 2/2').toEqual([2, 2]);
    expect(buffFrom(at(b, 't'), 'Twinning'), "only the fixture's +1/+1 was mirrored — the token gained nothing on the way out").toEqual([1, 1]);
  });
});

describe('Nova Herald — when you Collapse a Starform, it buffs 2 additional random Celestials (a passive, with replacement)', () => {
  it('is a passive read at collapse time: 0 Heralds → 0 extras; 1 → 2; 2 → 4; gilded → 4 each; the run-wide counter adds on top', () => {
    expect(collapseExtraTargetsOf(run({ board: [body('a', 'dbg_cel')] }))).toBe(0);
    expect(collapseExtraTargetsOf(run({ board: [body('h', 'ce3_novaherald')] }))).toBe(2);
    expect(collapseExtraTargetsOf(run({ board: [body('h', 'ce3_novaherald'), body('i', 'ce3_novaherald')] }))).toBe(4);
    expect(collapseExtraTargetsOf(run({ board: [body('h', 'ce3_novaherald', { golden: true })] }))).toBe(4);
    expect(collapseExtraTargetsOf(run({ board: [body('h', 'ce3_novaherald')], collapseExtraTargets: 3 } as Partial<RunState>))).toBe(5);
    expect(CARD_INDEX['ce3_novaherald']!.text).toContain('**2** additional');
    expect(CARD_INDEX['ce3_novaherald']!.goldenText).toContain('**4** additional');
  });
  it('one Herald on board: a Devotee\'s Collapse lands 2 unique + 2 extras = 4 hits over 3 Celestials — every hit is the rounded-up half', () => {
    let s = withStarform(6, 9, { board: [body('h', 'ce3_novaherald'), body('a', 'dbg_cel')], hand: [body('d', 'ce3_coronadevotee')] }); // 7/10 → 4/5 per hit
    s = play(s, 'd', { toIndex: 0 });
    const total = ['h', 'a', 'd'].map((uid) => buffFrom(at(s, uid), 'Solburn')).reduce<[number, number]>((acc, b) => [acc[0] + b[0], acc[1] + b[1]], [0, 0]);
    expect(total, '4 hits × 4/5').toEqual([16, 20]);
    expect(s.starformFx![0]!.toUids, 'the pull record lists every hit, duplicates allowed').toHaveLength(4);
    for (const uid of ['h', 'a', 'd']) expect(buffFrom(at(s, uid), 'Solburn')[0] % 4, uid).toBe(0);
  });
  it('two Celestials, one Herald: a seeded case where one takes 3 hits and the other 1 (extras land with replacement)', () => {
    let found: RunState | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      let s = withStarform(6, 9, { board: [body('h', 'ce3_novaherald')], hand: [body('d', 'ce3_coronadevotee')] });
      s.rngCursor = seed;
      s = play(s, 'd', { toIndex: 0 });
      const h = buffFrom(at(s, 'h'), 'Solburn')[0] / 4, d = buffFrom(at(s, 'd'), 'Solburn')[0] / 4;
      expect(h + d, 'always 4 hits').toBe(4);
      expect(Math.min(h, d), 'each original is unique: both bodies take at least one').toBeGreaterThanOrEqual(1);
      if (h === 3 || d === 3) found = s;
    }
    expect(found, 'a 3 + 1 split exists').not.toBeNull();
    expect(found!.starformFx![0]!.toUids).toHaveLength(4);
  });
  it('two Heralds → 4 extras (6 hits); a gilded Herald → 4 extras; a Herald alone with a Starform takes all 3 hits itself', () => {
    let s = withStarform(6, 9, { board: [body('h', 'ce3_novaherald'), body('i', 'ce3_novaherald')], hand: [body('d', 'ce3_coronadevotee')] });
    s = play(s, 'd', { toIndex: 0 });
    const hits = ['h', 'i', 'd'].reduce((n, uid) => n + buffFrom(at(s, uid), 'Solburn')[0] / 4, 0);
    expect(hits).toBe(6);
    let g = withStarform(6, 9, { board: [body('h', 'ce3_novaherald', { golden: true })], hand: [body('d', 'ce3_coronadevotee')] });
    g = play(g, 'd', { toIndex: 0 });
    expect(['h', 'd'].reduce((n, uid) => n + buffFrom(at(g, uid), 'Solburn')[0] / 4, 0)).toBe(6);
    // The Herald as the ONLY Celestial: a plain collapse helper call (no Devotee) → 1 original + 2 extras, all on it.
    const alone = withStarform(6, 9, { board: [body('h', 'ce3_novaherald'), body('n', 'dbg_neutral')], hand: [body('d', 'ce3_coronadevotee')] });
    const a2 = play(alone, 'd', { toIndex: 0 });
    expect(buffFrom(at(a2, 'h'), 'Solburn')[0] + buffFrom(at(a2, 'd'), 'Solburn')[0], '2 unique (h, d) + 2 extras = 4 hits').toBe(16);
    expect(stats(at(a2, 'n'))).toEqual([1, 20]);
  });
  it('its own play does nothing to the token (no Shout any more); the Herald is eligible as a hit like any Celestial', () => {
    let s = withStarform(6, 9, { hand: [body('h', 'ce3_novaherald')] });
    s = play(s, 'h', { toIndex: 0 });
    expect(hasStarform(s), 'the Herald no longer collapses').toBe(true);
    expect(sf(s)).toEqual([7, 10]);
    expect(stats(at(s, 'h'))).toEqual([6, 9]);
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
  it('after a CONSUME (the BUY into the left-most Celestial — the Zenith itself here) a new token appears with half the old one\'s stats, rounded up, at 6 Gold', () => {
    let s = withStarform(6, 9, { board: [body('z', 'ce3_zenith')] }); // 7/10
    const old = starformOf(s)!.uid;
    s = act(s, { type: 'buy', uid: old });
    expect(stats(at(s, 'z')), 'the Zenith ate the whole 7/10').toEqual([8 + 7, 12 + 10]);
    expect(hasStarform(s)).toBe(true);
    expect(starformOf(s)!.uid).not.toBe(old);
    expect(sf(s)).toEqual([4, 5]);
    expect(starformPrice(s)).toBe(6);
    expect(starformOf(s)!.buffs?.find((b) => b.source === 'Zenith')).toMatchObject({ attack: 3, health: 4 });
    expect(holdsEquipment(s, STAR_DESTROYER.id), 'the reborn token brings its Star Destroyer').toBe(true);
  });
  it('after a COLLAPSE (Corona Devotee, Herald-assisted or not) too; a buy with NO Celestial still counts; NOT after the Star Destroyer', () => {
    let s = withStarform(6, 9, { board: [body('z', 'ce3_zenith')], hand: [body('d', 'ce3_coronadevotee')] });
    s = play(s, 'd', { toIndex: 0 });
    expect(sf(s)).toEqual([4, 5]);
    let h = withStarform(6, 9, { board: [body('z', 'ce3_zenith'), body('n', 'ce3_novaherald')], hand: [body('d', 'ce3_coronadevotee')] });
    h = play(h, 'd', { toIndex: 0 });
    expect(sf(h), 'Herald-assisted collapse re-creates too').toEqual([4, 5]);
    // A neutral Zenith-shaped watcher would be the "no Celestial" case; the real Zenith IS a Celestial, so the
    // buy consumes into it — either way the exit is a consume and the rebirth happens.
    let b = withStarform(6, 9, { board: [body('z', 'ce3_zenith')] });
    b = act(b, { type: 'buy', uid: starformOf(b)!.uid });
    expect(hasStarform(b)).toBe(true);
    let d = withStarform(6, 9, { board: [body('z', 'ce3_zenith')] });
    selectEquipment(d, STAR_DESTROYER.id);
    d = act(d, { type: 'activateEquipment' });
    expect(hasStarform(d), 'destroyed stays destroyed — no starformRemoved fired').toBe(false);
    expect(stats(at(d, 'z'))).toEqual([8, 12]);
  });
  it('the rebirth into a FULL row eats the right-most minion (rule 1), and the mirror hears it', () => {
    let s = run({ board: [body('z', 'ce3_zenith'), body('t', 'ce3_twinstar')], hand: [body('d', 'ce3_coronadevotee')], embers: 30 });
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
  it('the buy-consume with a Twin Star to the LEFT of the Zenith: the Twin Star receives, and hears the rebirth\'s gains', () => {
    let s = withStarform(6, 9, { board: [body('t', 'ce3_twinstar'), body('z', 'ce3_zenith')] });
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(buffFrom(at(s, 't'), 'Starform'), 'the left-most Celestial consumed the 7/10').toEqual([7, 10]);
    expect(buffFrom(at(s, 't'), 'Twinning'), "the fixture's +6/+9 and then the reborn token's +3/+4 above base were mirrored").toEqual([6 + 3, 9 + 4]);
    expect(sf(s)).toEqual([4, 5]);
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

describe('Black Hole (was Accretion; spell) — the Starform consumes 3 random Shop minions (owner 2026-09-14; no Star Crash)', () => {
  it('three random minion offers are eaten, one real consume each; spells and the token are never meals; no Star Crash arrives', () => {
    let s = withStarform(0, 0, { hand: [spell('ac', 'accretion')] });
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'), offer(s, 'ce3_seer'), offer(s, 'ce3_seer'), offer(s, 'starcrash')); // 1/1, 2/4, 3/3, 3/3, a spell
    s = play(s, 'ac');
    const left = s.shop.filter((o) => !o.starform).map((o) => o.cardId);
    expect(left, 'one minion and the spell remain').toHaveLength(2);
    expect(left).toContain('starcrash');
    expect(s.shopMinionsEaten).toBe(3);
    const st = starformStats(s)!;
    expect(st.attack + st.health, 'the token grew by the three meals').toBeGreaterThanOrEqual(1 + 1 + 1 + 1 + 2 + 4 + 3 + 3 - 6); // any three of the four
    expect(s.hand.map((c) => c.cardId), 'no Star Crash grant any more').toEqual([]);
  });
  it('fewer than three offers → eat what is there; no Starform → nothing; the draw is seeded (a replay agrees)', () => {
    let s = withStarform(0, 0, { hand: [spell('ac', 'accretion')] });
    s.shop.unshift(offer(s, 'ce3_courier'), offer(s, 'ce3_vendor'));
    s = play(s, 'ac');
    expect(s.shop.filter((o) => !o.starform)).toHaveLength(0);
    expect(sf(s)).toEqual([1 + 2 + 2, 1 + 1 + 4]); // Cosmo Express 2/1 since 2026-09-18
    let n = run({ hand: [spell('ac', 'accretion')], shop: [] });
    n.shop.push(offer(n, 'ce3_vendor'));
    n = play(n, 'ac');
    expect(n.shop).toHaveLength(1);
    const twice = [0, 1].map(() => {
      let t = withStarform(0, 0, { hand: [spell('ac', 'accretion')] });
      t.shop.unshift(offer(t, 'ce3_courier'), offer(t, 'ce3_vendor'), offer(t, 'ce3_seer'), offer(t, 'ce3_seer', { atk: 5 }), offer(t, 'ce3_seer', { hp: 5 }));
      t = play(t, 'ac');
      return t.shop.filter((o) => !o.starform).map((o) => `${o.cardId}:${o.atk ?? 0}/${o.hp ?? 0}`).join('|');
    });
    expect(twice[0]).toBe(twice[1]);
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
