/**
 * SET 3 BALANCE + NEW MINIONS, owner list 2026-10-27 (R-SET3-1027-01..04):
 *
 *   Gramps          "Sell: give your Rubies +1 Attack and cast a Ruby on a friendly Kobold"   (was: a Ruby on all minions)
 *   Zapdash         "Pummel (12): Summon a Gemheart Golem and cast 2 Rubies on it. (Twice per combat)" (was Pummel (10), Rubies on Kobolds)
 *   Goldvein        2 Gold (Gilded 4) instead of 3 (Gilded 6)
 *   Whispwarder     T5 -> T4
 *   archived        Doubletap Brewer (leaves Set 3, stays a Set 2 card), Falx (Set 3 only, so the archive)
 *   NEW             Studious Steven (Dragon T4 6/4, Shout: cast Quick Study), Choosey Dragon (Dragon T3 3/4, Rally: cast
 *                   Tribes Choice on the minion to the right), Riftwalker (Dragon T6 8/8, Avenge (3): cast Waking Rift),
 *                   Beer Gut Bud (Dwarf T5 6/2, Shout and Echo: get a Dwarven Ale). Gilded: twice / 2 Ales.
 *
 * Dealski is SAME: the owner's "special Ruby" means a random Ruby (any of the six), which it already gets.
 */
import { describe, it, expect } from 'vitest';
import { ALE_IDS, combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { fireRallies } from './recruit';

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
const NEUTRAL = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)!.id;

const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[]; damageDealt?: number } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
const wall = (attack: number, uid = 'w', health = 5000): BoardMinion => bm(uid, 'sandbag', { attack, health, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
type Fight = ReturnType<typeof fight>;
const uidOf = (r: Fight, cardId: string): string => r.initial.player.find((m) => m.cardId === cardId)!.uid;

describe('roster: stats, tiers, set membership', () => {
  it.each([
    ['d3_studioussteven', 'Studious Steven', 'dragon', 4, 6, 4],
    ['d3_riftwalker', 'Riftwalker', 'dragon', 6, 8, 8],
    ['dw3_beergutbud', 'Beer Gut Bud', 'dwarf', 5, 6, 2],
  ] as const)('NEW %s is a drawable Set 3 card, not a Set 2 one', (id, name, tribe, tier, attack, health) => {
    expect(CARD_INDEX[id]).toMatchObject({ name, tribe, tier, attack, health });
    expect(CARD_INDEX[id]!.token).toBeFalsy();
    expect(poolFor('set3').buyable.some((c) => c.id === id)).toBe(true);
    expect(poolFor('set2').all.some((c) => c.id === id)).toBe(false);
  });

  it('Whispwarder is Tier 4 (stats unchanged); Goldvein pays 2 Gold (Gilded 4)', () => {
    expect(CARD_INDEX['d3_whispwarder']).toMatchObject({ tier: 4, attack: 7, health: 5 });
    const gv = CARD_INDEX['k3_goldvein']!;
    expect(gv.effects[0]).toMatchObject({ do: 'dealtDamageGoldNextTurn', params: { every: 6, gold: 2 } });
    expect(gv.text).toBe('**Pummel (6):** Gain **2 Gold** next turn. (Once per combat)');
    expect(gv.goldenText).toBe('**Pummel (6):** Gain **4 Gold** next turn. (Once per combat)');
  });

  it('Falx is archived (in no set, still resolves); Doubletap Brewer leaves Set 3 but stays a Set 2 card', () => {
    for (const setId of Object.keys(SETS) as SetId[]) expect(poolFor(setId).all.some((c) => c.id === 'd3_falx'), setId).toBe(false);
    expect(ARCHIVED_CARDS.some((c) => c.id === 'd3_falx')).toBe(true);
    expect(CARD_INDEX['d3_falx']!.name).toBe('Falx');
    expect(poolFor('set3').all.some((c) => c.id === 'dw_brewer')).toBe(false);
    expect(poolFor('set2').buyable.some((c) => c.id === 'dw_brewer')).toBe(true);
  });
});

describe('GOLDVEIN: Pummel (6) banks 2 Gold (Gilded 4)', () => {
  it.each([[false, 2], [true, 4]] as const)('golden=%s banks %i Gold for next turn', (golden, gold) => {
    const r = fight([bm('g', 'k3_goldvein', { attack: 6, health: 500, golden })], [wall(1)]);
    expect(r.playerBonusGold ?? 0).toBe(gold);
  });
});

describe('GRAMPS: Sell: give your Rubies +1 Attack and cast a Ruby on a friendly Kobold', () => {
  it('raises Ruby strength first, then one Ruby (already +1 Attack) lands on a friendly Kobold, never a non-Kobold', () => {
    let s = run({ board: [body('g', 'k3_gramps'), body('k', 'k3_dealski'), body('n', NEUTRAL)] });
    const before = s.rubyBonus ?? { attack: 0, health: 0 };
    s = act(s, { type: 'sell', uid: 'g' });
    expect(s.board.some((c) => c.uid === 'g')).toBe(false);
    expect(s.rubyBonus).toEqual({ attack: before.attack + 1, health: before.health });
    expect(sumFrom(at(s, 'k'), 'Ruby')).toEqual({ attack: 2, health: 1 });
    expect(sumFrom(at(s, 'n'), 'Ruby')).toEqual({ attack: 0, health: 0 });
  });

  it('Gilded: +2 Attack and 2 Rubies (each its own landing)', () => {
    let s = run({ board: [body('g', 'k3_gramps', { golden: true }), body('k', 'k3_dealski')] });
    s = act(s, { type: 'sell', uid: 'g' });
    expect(s.rubyBonus?.attack).toBe(2);
    expect(at(s, 'k').rubiesOnThisTurn).toBe(2);
    expect(sumFrom(at(s, 'k'), 'Ruby')).toEqual({ attack: 6, health: 2 });
  });

  it('no friendly Kobold: the Ruby strength still rises and nothing else is hit', () => {
    let s = run({ board: [body('g', 'k3_gramps'), body('n', NEUTRAL)] });
    s = act(s, { type: 'sell', uid: 'g' });
    expect(s.rubyBonus?.attack).toBe(1);
    expect(sumFrom(at(s, 'n'), 'Ruby')).toEqual({ attack: 0, health: 0 });
  });
});

describe('ZAPDASH: Pummel (12): Summon a Gemheart Golem and cast 2 Rubies on it. (Twice per combat)', () => {
  const golems = (r: Fight) => r.events.filter((e): e is Extract<CombatEvent, { type: 'summon' }> =>
    e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'gemheart-shard');
  const rubiesOn = (r: Fight, source: string, target: string) => r.events
    .filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.ruby === true && e.source === source && e.target === target && !e.bounce)
    .reduce((t, e) => t + e.attack, 0);

  it.each([[false, 2], [true, 4]] as const)('golden=%s: two payouts, each one Golem carrying %i Rubies', (golden, rubies) => {
    const r = fight([bm('z', 'k3_zapdash', { attack: 12, health: 500, golden })], [wall(1)]);
    const z = uidOf(r, 'k3_zapdash');
    expect(r.events.filter((e) => e.type === 'pummelTrigger' && e.source === z)).toHaveLength(2);
    const gs = golems(r);
    expect(gs, 'one Golem per payout (Gilded doubles the Rubies, not the Golems)').toHaveLength(2);
    for (const g of gs) expect(rubiesOn(r, z, g.minion.uid), 'plain Rubies at base strength: +1 Attack each').toBe(rubies);
  });

  it('11 damage does not pay; the 12th does', () => {
    const r = fight([bm('z', 'k3_zapdash', { attack: 11, health: 500 })], [wall(1)]);
    const z = uidOf(r, 'k3_zapdash');
    const ev = r.events;
    const firstHit = ev.findIndex((e) => e.type === 'dmg' && e.source === z);
    const firstFire = ev.findIndex((e) => e.type === 'pummelTrigger' && e.source === z);
    expect(firstHit).toBeGreaterThanOrEqual(0);
    expect(firstFire === -1 || firstFire > ev.findIndex((e, i) => i > firstHit && e.type === 'dmg' && e.source === z)).toBe(true);
  });

  it('a full board summons nothing and casts nothing', () => {
    const team = [bm('z', 'k3_zapdash', { attack: 12, health: 500 }), ...Array.from({ length: 6 }, (_, i) => bm(`n${i}`, NEUTRAL, { attack: 0, health: 500 }))];
    const r = fight(team, [wall(1)]);
    expect(golems(r)).toHaveLength(0);
    const z = uidOf(r, 'k3_zapdash');
    expect(r.events.some((e) => e.type === 'buff' && e.ruby === true && e.source === z)).toBe(false);
  });

  it('a Rise return re-arms the twice-per-combat cap (R-RETURN-RESET-01); no life exceeds it', () => {
    let returned = 0;
    for (let seed = 1; seed <= 20; seed++) {
      // Seeded at 10 with a 12-Attack body: hits to 22, 34 spend both payouts (46 is spent); the risen 4-Attack body's hit
      // reaches 50, past 48, and pays again only because the return re-armed the cap.
      const r = fight([bm('z', 'k3_zapdash', { attack: 12, health: 250, keywords: ['R'], damageDealt: 10 })], [wall(100)], seed);
      const z = uidOf(r, 'k3_zapdash');
      const lives = [0];
      for (const e of r.events) {
        if (e.type === 'reborn' && e.target === z) lives.push(0);
        else if (e.type === 'pummelTrigger' && e.source === z) lives[lives.length - 1]! += 1;
      }
      for (const l of lives) expect(l).toBeLessThanOrEqual(2);
      if (lives.length > 1 && lives[0] === 2 && lives[1]! > 0) returned++;
    }
    expect(returned, 'the risen body fires again after spending both payouts').toBeGreaterThan(0);
  });

  it('Impossible Todd (no rider) is unchanged: Gilded still doubles the Imps', () => {
    const r = fight([bm('t', 'dm_todd', { attack: 20, health: 500, golden: true })], [wall(1)]);
    expect(r.events.filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'impscrap')).toHaveLength(2);
  });
});

describe('STUDIOUS STEVEN: Shout: Cast Quick Study', () => {
  it.each([[false, 1], [true, 2]] as const)('golden=%s casts Quick Study %i time(s) for real', (golden, casts) => {
    let s = run({ hand: [body('s', 'd3_studioussteven', { golden })] });
    const spells = s.spellsCast ?? 0;
    const sb = s.spellBonus ?? { attack: 0, health: 0 };
    s = act(s, { type: 'play', uid: 's' });
    expect(s.spellBonus).toEqual({ attack: sb.attack + casts, health: sb.health + casts });
    expect((s.spellsCast ?? 0) - spells, 'each is a genuine spell cast').toBe(casts);
  });
});

describe('RIFTWALKER: Avenge (3): Cast Waking Rift', () => {
  it.each([false, true])('golden=%s: one Waking Rift (x2 gilded) per 3 friendly deaths, a real spell cast', (golden) => {
    const team = [bm('r', 'd3_riftwalker', { attack: 0, health: 90000, golden }), ...Array.from({ length: 6 }, (_, i) => bm(`f${i}`, NEUTRAL, { attack: 1, health: 1 }))];
    const r = fight(team, [wall(5)]);
    const rw = uidOf(r, 'd3_riftwalker');
    const mine = new Set(r.initial.player.map((m) => m.uid));
    const deaths = r.events.filter((e) => e.type === 'death' && mine.has(e.target) && e.target !== rw).length;
    expect(deaths).toBeGreaterThanOrEqual(3);
    const casts = r.events.filter((e) => e.type === 'sc' && e.source === rw && e.spellId === 'sparkplug').length;
    expect(casts).toBe(Math.floor(deaths / 3) * (golden ? 2 : 1));
    expect(r.playerSpellsCast ?? 0).toBe(casts);
  });
});

describe('BEER GUT BUD: Shout and Echo: Get a Dwarven Ale', () => {
  it.each([[false, 1], [true, 2]] as const)('Shout: golden=%s gets %i Ale(s)', (golden, n) => {
    let s = run({ hand: [body('b', 'dw3_beergutbud', { golden })] });
    s = act(s, { type: 'play', uid: 'b' });
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId))).toHaveLength(n);
  });

  it.each([[false, 1], [true, 2]] as const)('Echo: golden=%s gets %i Ale(s) mid-fight', (golden, n) => {
    const r = fight([bm('b', 'dw3_beergutbud', { golden })], [wall(50)]);
    const b = uidOf(r, 'dw3_beergutbud');
    expect(r.events.some((e) => e.type === 'death' && e.target === b)).toBe(true);
    expect(r.events.filter((e) => e.type === 'toHand' && e.side === 'player' && ALE_IDS.includes(e.cardId))).toHaveLength(n);
  });
});

describe('CHOOSEY DRAGON: Rally: Cast Tribes Choice on the minion to the right of this', () => {
  const isKobold = (id: string): boolean => {
    const d = CARD_INDEX[id];
    return !!d && (d.tribe === 'kobold' || d.tribe2 === 'kobold' || !!d.universalTribe);
  };
  const casts = (r: Fight, src: string) => r.events.filter((e) => e.type === 'sc' && e.source === src && e.spellId === 'tribeschoice');

  it('is a Set 3 T3 3/4 Rally Dragon naming the existing Tribes Choice spell', () => {
    expect(CARD_INDEX['d3_choosey']).toMatchObject({ name: 'Choosey Dragon', tribe: 'dragon', tier: 3, attack: 3, health: 4, keywords: ['RL'] });
    expect(CARD_INDEX['tribeschoice']!.name).toBe('Tribes Choice');
    expect(poolFor('set3').buyable.some((c) => c.id === 'd3_choosey')).toBe(true);
  });

  it.each([[false, 1], [true, 2]] as const)('combat, golden=%s: each swing casts it %i time(s) on the right neighbour, a Kobold of its type each', (golden, per) => {
    const r = fight([bm('c', 'd3_choosey', { attack: 1, health: 500, golden }), bm('k', 'k3_dealski', { attack: 0, health: 500 })], [wall(0)]);
    const c = uidOf(r, 'd3_choosey');
    const k = uidOf(r, 'k3_dealski');
    const swings = r.events.filter((e) => e.type === 'attack' && e.attacker === c).length;
    expect(swings).toBeGreaterThan(0);
    const sc = casts(r, c);
    expect(sc).toHaveLength(swings * per);
    for (const e of sc) expect((e as { target?: string }).target).toBe(k);
    const grants = r.events.filter((e) => e.type === 'toHand' && e.side === 'player' && e.source === c);
    expect(grants).toHaveLength(swings * per);
    for (const g of grants) expect(isKobold((g as { cardId: string }).cardId), (g as { cardId: string }).cardId).toBe(true);
  });

  it('the right-most slot casts nothing; a neutral neighbour yields nothing', () => {
    const last = fight([bm('k', 'k3_dealski', { attack: 0, health: 500 }), bm('c', 'd3_choosey', { attack: 1, health: 500 })], [wall(0)]);
    expect(casts(last, uidOf(last, 'd3_choosey'))).toHaveLength(0);
    const neut = fight([bm('c', 'd3_choosey', { attack: 1, health: 500 }), bm('n', NEUTRAL, { attack: 0, health: 500 })], [wall(0)]);
    expect(neut.events.some((e) => e.type === 'toHand' && e.source === uidOf(neut, 'd3_choosey'))).toBe(false);
  });

  it.each([[false, 1], [true, 2]] as const)('Shop (a forced Rally), golden=%s: %i Kobold(s) to hand from the right neighbour', (golden, n) => {
    const s = run({ board: [body('c', 'd3_choosey', { golden }), body('k', 'k3_dealski')] });
    fireRallies(s);
    expect(s.hand).toHaveLength(n);
    for (const h of s.hand) expect(isKobold(h.cardId), h.cardId).toBe(true);
  });
});
