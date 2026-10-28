/**
 * SET 3 KOBOLD RUNES, owner batch 2026-10-22 (R-KOBOLD-RUNES-1022-01..05):
 *
 *   Basic  Refreshing Rubies  2  "When you Refresh 4 times, get a random Ruby."
 *   Basic  Ruby Sales         1  "When you Sell 3 minions, get a random Ruby."
 *   Basic  Goleming           3  "Avenge (5): summon a Gemheart Golem and cast 6 Rubies on it."
 *   Epic   Red Start          3  "Start of Combat: cast a permanent Ruby on your Kobolds."
 *   Epic   Rosey's Garden     4  "When you cast a Ruby, give a random minion +4/+5 permanently."
 *
 * Every block drives the real engine: the Runeforge `buyRune`, the reducer's `roll` / `sell` / `play`, and `simulate()`.
 */
import { describe, it, expect } from 'vitest';
import { RUBY_TYPE_IDS, combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { mintRubies } from './recruit';
import { runeTally, runeCombatTally } from '../../ui/src/runeTally';

// ── Shop helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** A Set 3 Kobold run at the Runeforge, the rune bought through the REAL `buyRune` path. */
function withRune(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set3'),
    tribes: [...SETS.set3.tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
  return { ...s, ...extra };
}
const rubiesInHand = (s: RunState): string[] => s.hand.filter((c) => RUBY_TYPE_IDS.includes(c.cardId)).map((c) => c.cardId);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const sumFrom = (c: BoardCard, source: string) =>
  (c.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), { attack: 0, health: 0 });
const gardenTotal = (s: RunState) => s.board.reduce((t, c) => { const g = sumFrom(c, "Rosey's Garden"); return { attack: t.attack + g.attack, health: t.health + g.health }; }, { attack: 0, health: 0 });
const castRuby = (s: RunState, targetUid: string): RunState => {
  mintRubies(s, 1, 'ruby');
  const ruby = s.hand.filter((c) => c.cardId === 'ruby').pop()!;
  return act(s, { type: 'play', uid: ruby.uid, targetUid });
};
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)
  .map((c) => c.id).filter((id) => !['sylus', 'chronos', 'yazzus'].includes(id)); // engine-keyed bodies (cast / trigger multipliers) are not plain
const NEUTRAL = PLAIN[0]!;
/** Distinct plain bodies, so no three copies ever triple mid-test. */
const plain = (uid: string, i: number): BoardCard => body(uid, PLAIN[i % PLAIN.length]!);

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[] } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
const wall = (attack: number, uid = 'w', health = 5000): BoardMinion => bm(uid, 'sandbag', { attack, health, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], mods: object, seed = 4) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: [...SETS.set3.tribes], questMods: mods }), combatSide({ tier: 6 }));
type Fight = ReturnType<typeof fight>;
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
type Buff = Extract<CombatEvent, { type: 'buff' }>;
type Summon = Extract<CombatEvent, { type: 'summon' }>;
const golemSummons = (r: Fight) => r.events.filter((e): e is Summon => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'gemheart-shard');
const rubyBuffsOn = (r: Fight, target: string) => r.events.filter((e): e is Buff => e.type === 'buff' && e.ruby === true && e.target === target && !e.bounce);
const homeOf = (r: Fight, sourceUid: string) => (r.playerPermaBuffs ?? []).filter((b) => b.sourceUid === sourceUid);

describe('the five runes as content', () => {
  it('names, costs, pools (Basic vs Epic by array), Kobold gate, Set 3 only, text', () => {
    const rows: [string, string, number, boolean, string][] = [
      ['rune_refreshing_rubies', 'Refreshing Rubies', 2, false, 'When you **Refresh 4 times**, get a random **Ruby**.'],
      ['rune_ruby_sales', 'Ruby Sales', 1, false, 'When you **Sell 3 minions**, get a random **Ruby**.'],
      ['rune_goleming', 'Goleming', 2, false, '**Avenge (5):** summon a **Gemheart Golem** and cast **6 Rubies** on it.'],
      ['rune_red_start', 'Red Start', 3, true, '**Start of Combat:** cast a **permanent Ruby** on your **Kobolds**.'],
      ['rune_roseys_garden', "Rosey's Garden", 3, true, 'When you cast a **Ruby**, give a random minion **+4/+5** permanently.'],
    ];
    for (const [id, name, cost, epic, text] of rows) {
      const r = RUNE_INDEX[id]!;
      expect([r.name, r.cost, r.text, r.sets, r.tribes]).toEqual([name, cost, text, ['set3'], ['kobold']]);
      expect(r.name.startsWith('Rune of'), 'bare rune names (R-RUNE-NAME-01)').toBe(false);
      expect((epic ? EPIC_RUNES : RUNES).some((x) => x.id === id), `${id} lives in the ${epic ? 'Epic' : 'Basic'} pool`).toBe(true);
      expect((epic ? RUNES : EPIC_RUNES).some((x) => x.id === id)).toBe(false);
      expect(r.text).not.toMatch(/—|--/);
    }
  });
});

describe('REFRESHING RUBIES: When you Refresh 4 times, get a random Ruby', () => {
  it('every 4th Refresh pressed (free ones included) gets one random Ruby; the meter repeats and reads N/4', () => {
    let s = withRune(['rune_refreshing_rubies'], { freeRolls: 2 });
    expect(runeTally(s, 'rune_refreshing_rubies')).toBe('0/4');
    for (let i = 0; i < 3; i++) s = act(s, { type: 'roll' });
    expect(rubiesInHand(s)).toHaveLength(0);
    expect(runeTally(s, 'rune_refreshing_rubies')).toBe('3/4');
    s = act(s, { type: 'roll' });
    expect(rubiesInHand(s)).toHaveLength(1);
    expect(RUBY_TYPE_IDS).toContain(rubiesInHand(s)[0]);
    expect(runeTally(s, 'rune_refreshing_rubies')).toBe('0/4');
    for (let i = 0; i < 4; i++) s = act(s, { type: 'roll' });
    expect(rubiesInHand(s)).toHaveLength(2);
  });

  it('a random Ruby draws from all six types (R-RAND-02), seeded: the same seed gets the same Rubies', () => {
    const seen = new Set<string>();
    const draw = (seed: number): string[] => { let s = withRune(['rune_refreshing_rubies'], { freeRolls: 40 }, seed); for (let i = 0; i < 40; i++) s = act(s, { type: 'roll' }); return rubiesInHand(s); };
    for (let seed = 1; seed <= 6; seed++) for (const id of draw(seed)) seen.add(id);
    expect(seen.size).toBeGreaterThan(2);
    expect(draw(5)).toEqual(draw(5));
  });

  it('only the player pressing Refresh ticks it: Window Shopping / a buy / a sale do not', () => {
    let s = withRune(['rune_refreshing_rubies']);
    s = { ...s, board: [plain('a', 0)] };
    s = act(s, { type: 'sell', uid: 'a' });
    expect(s.runeThresholds!.find((t) => t.sourceId === 'rune_refreshing_rubies')!.tick).toBe(0);
  });

  it('a second copy is its own meter: two Rubies every 4 Refreshes', () => {
    let s = withRune(['rune_refreshing_rubies', 'rune_refreshing_rubies'], { freeRolls: 4 });
    for (let i = 0; i < 4; i++) s = act(s, { type: 'roll' });
    expect(rubiesInHand(s)).toHaveLength(2);
  });

  it('respects the hand cap (no overflow outside the acquire moment)', () => {
    let s = withRune(['rune_refreshing_rubies'], { freeRolls: 4 });
    s = { ...s, hand: Array.from({ length: 10 }, (_, i) => plain(`h${i}`, i)) };
    for (let i = 0; i < 4; i++) s = act(s, { type: 'roll' });
    expect(s.hand).toHaveLength(10);
    expect(rubiesInHand(s)).toHaveLength(0);
  });
});

describe('RUBY SALES: When you Sell 3 minions, get a random Ruby', () => {
  it('every 3rd minion sold (board or hand) gets one random Ruby; the meter repeats and reads N/3', () => {
    let s = withRune(['rune_ruby_sales']);
    s = { ...s, board: ['a', 'b', 'c', 'd', 'e'].map((u, i) => plain(u, i)), hand: [plain('f', 5)] };
    s = act(s, { type: 'sell', uid: 'a' });
    s = act(s, { type: 'sell', uid: 'f' }); // a hand sale counts
    expect(runeTally(s, 'rune_ruby_sales')).toBe('2/3');
    expect(rubiesInHand(s)).toHaveLength(0);
    s = act(s, { type: 'sell', uid: 'b' });
    expect(rubiesInHand(s)).toHaveLength(1);
    expect(runeTally(s, 'rune_ruby_sales')).toBe('0/3');
    s = act(s, { type: 'sell', uid: 'c' });
    s = act(s, { type: 'sell', uid: 'd' });
    s = act(s, { type: 'sell', uid: 'e' });
    expect(rubiesInHand(s)).toHaveLength(2);
  });

  it('the meter carries across turns', () => {
    let s = withRune(['rune_ruby_sales']);
    s = { ...s, board: [plain('a', 0), plain('b', 1)] };
    s = act(s, { type: 'sell', uid: 'a' });
    s = act(s, { type: 'sell', uid: 'b' });
    expect(s.runeThresholds!.find((t) => t.sourceId === 'rune_ruby_sales')!.tick).toBe(2);
  });
});

describe('GOLEMING: Avenge (5): summon a Gemheart Golem and cast 6 Rubies on it', () => {
  const sixBodies = () => Array.from({ length: 6 }, (_, i) => bm(`p${i}`, NEUTRAL, { attack: 1, health: 1 }));

  it('the 5th friendly death summons a Golem that casts 6 plain Rubies on itself (combat-only)', () => {
    const r = fight(sixBodies(), [wall(50)], { runeGoleming: true });
    const golems = golemSummons(r);
    expect(golems.length).toBeGreaterThanOrEqual(1);
    const g = golems[0]!.minion.uid;
    const rubies = rubyBuffsOn(r, g);
    expect(rubies.reduce((t, e) => t + e.attack, 0)).toBe(6);
    expect(rubies.reduce((t, e) => t + e.health, 0)).toBe(6);
    expect(triggers(r.events, 'runeGoleming').length).toBe(golems.length);
    expect(homeOf(r, g), 'nothing carries back: the Golem is a combat summon').toHaveLength(0);
    expect(golemSummons(fight(sixBodies(), [wall(50)], {})), 'no rune: no Golem').toHaveLength(0);
  });

  it('fires on the 5th death, not before (the badge counts N/5)', () => {
    const few = Array.from({ length: 4 }, (_, i) => bm(`p${i}`, NEUTRAL, { attack: 1, health: 1 }));
    expect(golemSummons(fight(few, [wall(50)], { runeGoleming: true }))).toHaveLength(0);
    expect(runeCombatTally('rune_goleming', 3, 0)).toBe('3/5');
  });

  it('a second copy summons a second Golem; Gemheart hears each summon', () => {
    const two = fight(sixBodies(), [wall(50)], { runeGoleming: true, flagCopies: { runeGoleming: 2 } });
    const one = fight(sixBodies(), [wall(50)], { runeGoleming: true });
    expect(golemSummons(two).length).toBeGreaterThan(golemSummons(one).length);
    const withLegion = fight([...Array.from({ length: 5 }, (_, i) => bm(`p${i}`, NEUTRAL, { attack: 1, health: 1 })), bm('L', 'k3_legionnaire', { health: 5000 })], [wall(50, 'w', 5000)], { runeGoleming: true });
    const legion = withLegion.initial.player.find((m) => m.cardId === 'k3_legionnaire')!.uid;
    expect(golemSummons(withLegion).length).toBeGreaterThanOrEqual(1);
    expect(rubyBuffsOn(withLegion, legion).length, 'Gemheart casts its permanent Rubies on each Golem summon').toBeGreaterThanOrEqual(1);
  });

  it('is deterministic for a seed', () => {
    const a = fight(sixBodies(), [wall(50)], { runeGoleming: true }, 9);
    const b = fight(sixBodies(), [wall(50)], { runeGoleming: true }, 9);
    expect(a.events).toEqual(b.events);
  });
});

describe('RED START: Start of Combat: cast a permanent Ruby on your Kobolds', () => {
  it('one permanent Ruby on EACH friendly Kobold (All-types included), none on a non-Kobold; it carries back', () => {
    const r = fight([bm('k1', 'k3_dealski', { health: 5000 }), bm('k2', 'k3_korn', { health: 5000 }), bm('n', NEUTRAL, { health: 5000 }), bm('a', 'n2_standardbearer', { health: 5000 })], [wall(0)], { runeRedStart: true });
    const ORDER = ['k1', 'k2', 'n', 'a'];
    const uid = (src: string) => r.initial.player[ORDER.indexOf(src)]!.uid;
    expect(triggers(r.events, 'runeRedStart')).toHaveLength(1);
    for (const k of ['k1', 'a']) {
      const first = rubyBuffsOn(r, uid(k))[0]!;
      expect([first.attack, first.health]).toEqual([1, 1]);
      const home = homeOf(r, k).filter((b) => b.ruby);
      expect(home.reduce((t, b) => t + b.attack, 0), `${k}: the Red Start Ruby carries back`).toBeGreaterThanOrEqual(1);
    }
    expect(rubyBuffsOn(r, uid('n')), 'a non-Kobold gets nothing').toHaveLength(0);
  });

  it('per copy held, and Twilight repeats it (a Start of Combat rune)', () => {
    const one = fight([bm('k1', 'k3_dealski', { health: 5000 })], [wall(0)], { runeRedStart: true });
    const two = fight([bm('k1', 'k3_dealski', { health: 5000 })], [wall(0)], { runeRedStart: true, flagCopies: { runeRedStart: 2 } });
    const tw = fight([bm('k1', 'k3_dealski', { health: 5000 })], [wall(0)], { runeRedStart: true, runeTwilight: true });
    const n = (r: Fight) => triggers(r.events, 'runeRedStart').length;
    expect([n(one), n(two), n(tw)]).toEqual([1, 2, 2]);
  });

  it('no Kobold: nothing, the badge stays quiet', () => {
    const r = fight([bm('n', NEUTRAL, { health: 5000 })], [wall(0)], { runeRedStart: true });
    expect(triggers(r.events, 'runeRedStart')).toHaveLength(0);
  });

  it('buying it arms the combat flag', () => {
    const s = withRune(['rune_red_start']);
    expect(questCombatMods(s).runeRedStart).toBe(true);
  });
});

describe("ROSEY'S GARDEN: When you cast a Ruby, give a random minion +4/+5 permanently", () => {
  it('Shop: each Ruby cast gives one random board minion +4/+5', () => {
    let s = withRune(['rune_roseys_garden']);
    s = { ...s, board: [body('a', NEUTRAL), body('b', 'k3_dealski')] };
    s = castRuby(s, 'b');
    expect(gardenTotal(s)).toEqual({ attack: 4, health: 5 });
    s = castRuby(s, 'a');
    expect(gardenTotal(s)).toEqual({ attack: 8, health: 10 });
  });

  it('Shop: counts per RUBY (a Gilded Gramps sold casts 2 Rubies), and a second copy doubles it', () => {
    // Gramps since 2026-10-27: "Sell: give your Rubies +1 Attack and cast a Ruby on a friendly Kobold" (Gilded: twice).
    let s = withRune(['rune_roseys_garden']);
    s = { ...s, board: [body('g', 'k3_gramps', { golden: true }), body('a', NEUTRAL), body('b', 'k3_dealski')] };
    s = act(s, { type: 'sell', uid: 'g' });
    expect(gardenTotal(s)).toEqual({ attack: 4 * 2, health: 5 * 2 }); // 2 Rubies, both on the one Kobold
    let d = withRune(['rune_roseys_garden', 'rune_roseys_garden']);
    d = { ...d, board: [body('a', NEUTRAL)] };
    d = castRuby(d, 'a');
    expect(gardenTotal(d)).toEqual({ attack: 8, health: 10 });
  });

  it('Shop: the random pick is seeded (same seed, same minion)', () => {
    const pick = (seed: number): string[] => {
      let s = withRune(['rune_roseys_garden'], {}, seed);
      s = { ...s, board: ['a', 'b', 'c', 'd'].map((u, i) => plain(u, i)) };
      s = castRuby(s, 'a');
      return s.board.filter((c) => sumFrom(c, "Rosey's Garden").attack > 0).map((c) => c.uid);
    };
    expect(pick(7)).toEqual(pick(7));
    expect(pick(7)).toHaveLength(1);
  });

  it('LOOP GUARD: Rosey + the Garden + Double Trouble + a Ruby bounce settle after ONE Ruby, exactly once each', () => {
    let s = withRune(['rune_roseys_garden']);
    s = { ...s, board: [body('r', 'k3_rosey'), body('t', 'k3_doubletrouble'), body('a', NEUTRAL)] };
    s = castRuby(s, 'a'); // Double Trouble casts on itself in reaction (stats only), Rosey gains, the Garden pays once
    expect(sumFrom(at(s, 'r'), 'Rosey')).toEqual({ attack: 2, health: 1 });
    expect(gardenTotal(s)).toEqual({ attack: 4, health: 5 });
  });

  it('combat: each Ruby cast pays +4/+5 to a random living friendly minion, PERMANENTLY (carries back)', () => {
    const r = fight([bm('k', 'k3_korn', { health: 5000 }), bm('n', NEUTRAL, { health: 5000 })], [wall(1)], { runeRoseysGarden: true });
    const korn = r.initial.player.find((m) => m.cardId === 'k3_korn')!.uid;
    const casts = rubyBuffsOn(r, korn).filter((e) => e.source === korn).length;
    expect(casts).toBeGreaterThan(0);
    const gifts = r.events.filter((e): e is Buff => e.type === 'buff' && !e.ruby && e.attack === 4 && e.health === 5);
    expect(gifts).toHaveLength(casts);
    const home = (r.playerPermaBuffs ?? []).filter((b) => !b.ruby).reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), { attack: 0, health: 0 });
    expect(home, 'the Garden gains carry back to the Shop').toEqual({ attack: 4 * casts, health: 5 * casts });
    const off = fight([bm('k', 'k3_korn', { health: 5000 }), bm('n', NEUTRAL, { health: 5000 })], [wall(1)], {});
    expect(off.events.filter((e) => e.type === 'buff' && !(e as Buff).ruby && (e as Buff).attack === 4 && (e as Buff).health === 5)).toHaveLength(0);
  });

  it('combat LOOP GUARD: with Rosey and Red Start the fight ends and the Garden pays exactly once per Ruby cast', () => {
    const r = fight([bm('k', 'k3_korn', { health: 5000 }), bm('r', 'k3_rosey', { health: 5000 }), bm('t', 'k3_doubletrouble', { health: 5000 })], [wall(1)], { runeRoseysGarden: true, runeRedStart: true });
    const ro = r.initial.player.find((m) => m.cardId === 'k3_rosey')!.uid;
    const roseyGains = r.events.filter((e) => e.type === 'buff' && e.target === ro && e.source === ro && !(e as Buff).ruby).length;
    const gifts = r.events.filter((e): e is Buff => e.type === 'buff' && !e.ruby && e.attack === 4 && e.health === 5);
    expect(roseyGains).toBeGreaterThan(0);
    expect(gifts.length, 'one Garden gift per Ruby cast, the same count Rosey hears').toBe(roseyGains);
  });
});
