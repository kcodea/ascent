/**
 * SET 3 KOBOLDS, owner batch 2026-10-22 (R-KOBOLD-1022-02):
 *
 *   Boy Scout     T2 3/3  "Shout: Gain 2 free Refreshes."
 *   Gramps        T3 4/2  "Sell: Cast a Ruby on all of your minions."            (sheet: "Play"; one verb, 2026-08-30)
 *   Zapdash       T3 4/4  "Pummel (10): Cast a Ruby on your Kobolds. (Twice per combat)"
 *   Frack Attack  T4 6/5  "Start of Combat: Cast 3 Rubies on this. Repeat after 3 friendly attacks."
 *   Rosey         T6 2/2  "When you cast a Ruby, this gains +2/+1 permanently. Improves every 3 Refreshes."
 *
 * Owner confirmed 2026-10-22: "a Ruby" without "random" is the PLAIN Ruby; Rosey's "permanently" carries combat gains
 * back to the Shop (like Engraved); Frack Attack's meter counts every friendly attack, each Flurry swing included.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { mintRubies } from './recruit';

// ── Shop helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: [...SETS.set3.tribes],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], hand: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const sumFrom = (c: BoardCard, source: string) =>
  (c.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), { attack: 0, health: 0 });
const castRuby = (s: RunState, targetUid: string): RunState => {
  mintRubies(s, 1, 'ruby');
  const ruby = s.hand.filter((c) => c.cardId === 'ruby').pop()!;
  return act(s, { type: 'play', uid: ruby.uid, targetUid });
};
const ALL_TYPES = 'n2_standardbearer'; // a plain All-types body
const NEUTRAL = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)!.id;

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[]; damageDealt?: number; eotTick?: number } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
const wall = (attack: number, uid = 'w', health = 5000): BoardMinion => bm(uid, 'sandbag', { attack, health, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], seed: number) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
type Fight = ReturnType<typeof fight>;
const uidOf = (r: Fight, cardId: string): string => r.initial.player.find((m) => m.cardId === cardId)!.uid;
const rubyBuffs = (ev: readonly CombatEvent[], source: string, target?: string) =>
  ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.ruby === true && e.source === source && (target === undefined || e.target === target) && !e.bounce);
function perLife(ev: readonly CombatEvent[], uid: string, pred: (e: CombatEvent) => boolean): number[] {
  const lives = [0];
  for (const e of ev) {
    if (e.type === 'reborn' && e.target === uid) lives.push(0);
    else if (pred(e)) lives[lives.length - 1]! += 1;
  }
  return lives;
}
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('the five Kobolds are new Set 3 cards with the owner stats', () => {
  it.each([
    ['k3_boyscout', 'Boy Scout', 2, 3, 3],
    ['k3_gramps', 'Gramps', 3, 4, 2],
    ['k3_zapdash', 'Zapdash', 3, 4, 4],
    ['k3_frackattack', 'Frack Attack', 4, 6, 5],
    ['k3_rosey', 'Rosey', 6, 2, 2],
  ] as const)('%s', (id, name, tier, attack, health) => {
    expect(CARD_INDEX[id]).toMatchObject({ name, tier, attack, health, tribe: 'kobold' });
    expect(CARD_INDEX[id]!.token).toBeFalsy();
    expect(poolFor('set3').buyable.some((c) => c.id === id), 'drawable in Set 3').toBe(true);
    expect(poolFor('set2').all.some((c) => c.id === id), 'not a Set 2 card').toBe(false);
  });
});

describe('BOY SCOUT: Shout: Gain 2 free Refreshes', () => {
  it('banks 2 free Refreshes (Gilded 4), spent before Gold on a roll', () => {
    let s = run({ hand: [body('b', 'k3_boyscout')], freeRolls: 0 });
    s = act(s, { type: 'play', uid: 'b' });
    expect(s.freeRolls).toBe(2);
    const gold = s.embers;
    s = act(s, { type: 'roll' });
    expect(s.freeRolls).toBe(1);
    expect(s.embers, 'a free Refresh costs no Gold').toBe(gold);
    let g = run({ hand: [body('b', 'k3_boyscout', { golden: true })], freeRolls: 0 });
    g = act(g, { type: 'play', uid: 'b' });
    expect(g.freeRolls).toBe(4);
  });
});

describe('GRAMPS: Sell: Cast a Ruby on all of your minions', () => {
  it('casts a plain Ruby on every remaining minion (any tribe), never on itself', () => {
    let s = run({ board: [body('g', 'k3_gramps'), body('k', 'k3_dealski'), body('n', NEUTRAL)] });
    s = act(s, { type: 'sell', uid: 'g' });
    expect(s.board.some((c) => c.uid === 'g')).toBe(false);
    expect(sumFrom(at(s, 'k'), 'Ruby')).toEqual({ attack: 1, health: 1 });
    expect(sumFrom(at(s, 'n'), 'Ruby'), '"all of your minions", not only Kobolds').toEqual({ attack: 1, health: 1 });
  });

  it('Gilded casts 2 Rubies on each, as two separate casts', () => {
    let s = run({ board: [body('g', 'k3_gramps', { golden: true }), body('k', 'k3_dealski')] });
    s = act(s, { type: 'sell', uid: 'g' });
    expect(sumFrom(at(s, 'k'), 'Ruby')).toEqual({ attack: 2, health: 2 });
    expect(at(s, 'k').rubiesOnThisTurn, 'each Ruby is its own landing').toBe(2);
  });
});

describe('ZAPDASH: Pummel (10): Cast a Ruby on your Kobolds. (Twice per combat)', () => {
  it('each payout casts a plain Ruby on every friendly Kobold (itself and All-types included), never a non-Kobold', () => {
    const r = fight([bm('z', 'k3_zapdash', { attack: 10, health: 500 }), bm('k', 'k3_dealski', { health: 500 }), bm('u', ALL_TYPES, { health: 500 }), bm('n', NEUTRAL, { health: 500 })], [wall(1)], 3);
    const z = uidOf(r, 'k3_zapdash');
    const fires = r.events.filter((e) => e.type === 'pummelTrigger' && e.source === z).length;
    expect(fires).toBe(2);
    for (const id of ['k3_zapdash', 'k3_dealski', ALL_TYPES]) {
      const got = rubyBuffs(r.events, z, uidOf(r, id));
      expect(got.length, `${id} gets one Ruby per payout`).toBe(2);
      expect(got[0]).toMatchObject({ attack: 1, health: 1 });
    }
    expect(rubyBuffs(r.events, z, uidOf(r, NEUTRAL))).toHaveLength(0);
  });

  it('Gilded casts 2 Rubies per Kobold per payout, still twice per combat', () => {
    const r = fight([bm('z', 'k3_zapdash', { attack: 10, health: 500, golden: true }), bm('k', 'k3_dealski', { health: 500 })], [wall(1)], 3);
    const z = uidOf(r, 'k3_zapdash');
    expect(r.events.filter((e) => e.type === 'pummelTrigger' && e.source === z)).toHaveLength(2);
    const got = rubyBuffs(r.events, z, uidOf(r, 'k3_dealski'));
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ attack: 2, health: 2 });
  });

  it('a Rise return re-arms the twice-per-combat cap (R-RETURN-RESET-01); no life exceeds it', () => {
    let returned = 0;
    for (const seed of SEEDS) {
      // Seeded at 6 with a 10-Attack body: three hits (16, 26, 36) spend both payouts; the risen 4-Attack body's hit
      // reaches 40 and pays again only because the return re-armed the cap.
      const r = fight([bm('z', 'k3_zapdash', { attack: 10, health: 250, keywords: ['R'], damageDealt: 6 })], [wall(100)], seed);
      const z = uidOf(r, 'k3_zapdash');
      const lives = perLife(r.events, z, (e) => e.type === 'pummelTrigger' && e.source === z);
      for (const l of lives) expect(l).toBeLessThanOrEqual(2);
      if (lives.length > 1 && lives[0] === 2 && lives[1]! > 0) returned++;
    }
    expect(returned, 'the risen body fires again after spending both payouts').toBeGreaterThan(0);
  });
});

describe('FRACK ATTACK: Start of Combat: Cast 3 Rubies on this. Repeat after 3 friendly attacks', () => {
  /** Rubies Frack casts on itself, against the friendly attacks (each swing) seen while it lives. */
  const trace = (r: Fight) => {
    const f = uidOf(r, 'k3_frackattack');
    const mine = new Set(r.initial.player.map((m) => m.uid));
    let seen = 0, expected = 1, actual = 0, alive = true; // the Start of Combat cast is the first
    for (const e of r.events) {
      if (e.type === 'reborn' && e.target === f) { seen = 0; alive = true; } // the meter starts over on a return
      if (e.type === 'death' && e.target === f) alive = false; // a dead body counts nothing
      if (alive && e.type === 'attack' && mine.has(e.attacker)) { seen++; if (seen % 3 === 0) expected++; }
      if (e.type === 'buff' && e.ruby && e.source === f && e.target === f && !e.bounce) actual++;
    }
    return { f, expected, actual };
  };

  it('casts 3 plain Rubies on itself at Start of Combat, and again every 3rd friendly attack (Flurry swings count)', () => {
    const r = fight([bm('f', 'k3_frackattack', { health: 5000 }), bm('k', 'k_blazer', { health: 5000, keywords: ['W'] })], [wall(1)], 2);
    const { f, expected, actual } = trace(r);
    expect(expected).toBeGreaterThan(2);
    expect(actual).toBe(expected);
    expect(rubyBuffs(r.events, f, f)[0]).toMatchObject({ attack: 3, health: 3 });
    // Flurry: the Blazer's second swing is its own friendly attack.
    const k = uidOf(r, 'k_blazer');
    expect(r.events.some((e) => e.type === 'attack' && e.attacker === k && e.swing === 1)).toBe(true);
  });

  it('Gilded casts 6 each time', () => {
    const r = fight([bm('f', 'k3_frackattack', { health: 5000, golden: true })], [wall(1)], 2);
    const f = uidOf(r, 'k3_frackattack');
    expect(rubyBuffs(r.events, f, f)[0]).toMatchObject({ attack: 6, health: 6 });
  });

  it('the Rubies are combat-only (nothing carries back)', () => {
    const r = fight([bm('f', 'k3_frackattack', { health: 5000 })], [wall(1)], 2);
    expect(r.playerPermaBuffs?.filter((b) => b.sourceUid === 'f') ?? []).toHaveLength(0);
  });

  it('a Rise return restarts the 3-attack meter', () => {
    let returned = 0;
    for (const seed of SEEDS) {
      // A Flurry Blazer swings twice ahead of Frack, so Frack usually dies with 1 or 2 attacks banked: without the reset the
      // risen body would fire early on its first swing back.
      const r = fight([bm('k', 'k_blazer', { health: 5000, keywords: ['W'] }), bm('f', 'k3_frackattack', { health: 150, keywords: ['R'] })], [wall(100)], seed);
      const { f, expected, actual } = trace(r);
      expect(actual, `seed ${seed}`).toBe(expected);
      if (r.events.some((e) => e.type === 'reborn' && e.target === f)) returned++;
    }
    expect(returned).toBeGreaterThan(0);
  });
});

describe('ROSEY: When you cast a Ruby, this gains +2/+1 permanently. Improves every 3 Refreshes', () => {
  it('gains +2/+1 per Ruby you cast, on any minion (itself and a Shop minion included)', () => {
    let s = run({ board: [body('r', 'k3_rosey'), body('k', 'k3_dealski')], shop: [{ uid: 'o', cardId: 'k3_dealski' }] as RunState['shop'] });
    s = castRuby(s, 'k');
    expect(sumFrom(at(s, 'r'), 'Rosey')).toEqual({ attack: 2, health: 1 });
    s = castRuby(s, 'r');
    expect(sumFrom(at(s, 'r'), 'Rosey')).toEqual({ attack: 4, health: 2 });
    s = castRuby(s, 'o');
    expect(sumFrom(at(s, 'r'), 'Rosey'), 'a Ruby cast on a Shop minion counts').toEqual({ attack: 6, health: 3 });
  });

  it('counts per RUBY: a Gilded Gramps sold beside it pays 2 per minion', () => {
    let s = run({ board: [body('g', 'k3_gramps', { golden: true }), body('r', 'k3_rosey'), body('k', 'k3_dealski')] });
    s = act(s, { type: 'sell', uid: 'g' });
    expect(sumFrom(at(s, 'r'), 'Rosey')).toEqual({ attack: 8, health: 4 }); // 4 Rubies cast
  });

  it('improves by +2/+1 every 3 Refreshes pressed (Gilded doubles base and step)', () => {
    let s = run({ board: [body('r', 'k3_rosey')], freeRolls: 10 });
    for (let i = 0; i < 3; i++) s = act(s, { type: 'roll' });
    expect(at(s, 'r').eotTick).toBe(3);
    s = castRuby(s, 'r');
    expect(sumFrom(at(s, 'r'), 'Rosey')).toEqual({ attack: 4, health: 2 });
    let g = run({ board: [body('r', 'k3_rosey', { golden: true, eotTick: 6 })] });
    g = castRuby(g, 'r');
    expect(sumFrom(at(g, 'r'), 'Rosey')).toEqual({ attack: 12, health: 6 });
  });

  it('in combat: gains per Ruby cast and the gain carries back (owner confirmed 2026-10-22)', () => {
    // Korn and the Kob (Rally: cast a permanent Ruby on itself) swings first; Rosey hears each of those casts.
    const r = fight([bm('k', 'k3_korn', { health: 5000 }), bm('r', 'k3_rosey', { health: 5000, eotTick: 3 })], [wall(1)], 4);
    const ro = uidOf(r, 'k3_rosey');
    const korn = uidOf(r, 'k3_korn');
    const casts = rubyBuffs(r.events, korn, korn).length;
    expect(casts).toBeGreaterThan(0);
    const gains = r.events.filter((e) => e.type === 'buff' && e.target === ro && e.source === ro);
    expect(gains).toHaveLength(casts);
    expect(gains[0]).toMatchObject({ attack: 4, health: 2 }); // level 2 (3 Refreshes)
    const home = r.playerPermaBuffs?.filter((b) => b.sourceUid === 'r') ?? [];
    expect(home.reduce((t, b) => t + b.attack, 0), 'carried back to the Shop').toBe(4 * casts);
  });
});
