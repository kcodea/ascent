/**
 * PLAYER-LEGAL SCOUTING (scout.ts) and the scouted fight panel (fightScore.ts).
 *
 * Hermetic: a fixture corpus is registered into the module-global pool, so this file owns its own worker (vitest
 * isolates files) and never shares one with the pool-sensitive lobby tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createRun, type RunState } from '../state';
import { reduce } from '../reducer';
import { registerOpponents } from '../opponents';
import type { BoardSnapshot } from '../snapshot';
import { GREEDY_PILOT } from '../balance/pilots';
import { toBotVisibleState } from './visibleState';
import { fightScore, lastFightResult, withScout } from './fightScore';
import { expectedDamageTaken, lethalRisk, resetScoutCache, scoutFromContext, scoutedPanel, shapeMatches, survivalTerm, type ScoutedBoard, type ScoutedSeat, type SeatScout } from './scout';

// ── a fixture pool: set-2 vanilla boards across waves, tiers and dominant tribes ──────────────────────────────
const body = (cardId: string, attack: number, health: number) => ({ cardId, attack, health, keywords: [] as never[], golden: false });
const snap = (o: { author: string; heroId: string; seed: number; wave: number; tier: number; cards: string[]; stat: number }): BoardSnapshot => ({
  v: 1, wave: o.wave, heroId: o.heroId, resolve: 30, armor: 0, tier: o.tier, triples: 0,
  tribes: ['dragon', 'demon', 'beast', 'dwarf', 'kobold'], threat: 'glass', power: 0,
  minions: o.cards.map((c) => body(c, o.stat, o.stat)), marksCarried: true, seed: o.seed, origin: 'self', author: o.author, setId: 'set2',
} as BoardSnapshot);
/** Dragons at every tier, Beasts at every tier, both across waves 3-9; one SEATED recording (`author9`) of Dragons. */
const FIXTURE: BoardSnapshot[] = [];
for (let wave = 3; wave <= 9; wave++) {
  for (const tier of [2, 3, 4]) {
    FIXTURE.push(snap({ author: `dragons${tier}`, heroId: 'drakko', seed: 100 + tier, wave, tier, cards: ['d2_mirrorwing', 'd2_mirrorwing', 'd2_skald'], stat: 2 + wave }));
    FIXTURE.push(snap({ author: `beasts${tier}`, heroId: 'robin', seed: 200 + tier, wave, tier, cards: ['b2_trex', 'b2_trex', 'b2_wolvie'], stat: 2 + wave }));
  }
  FIXTURE.push(snap({ author: 'author9', heroId: 'soren', seed: 999, wave, tier: 3, cards: ['d2_mirrorwing', 'd2_skald', 'd2_skald'], stat: 40 })); // the seated one: a giant, so leaking it is visible
}
const SEATED_KEY = 'author9|soren|999';

beforeAll(() => { registerOpponents(FIXTURE); resetScoutCache(); });

/** A wave-N set-2 lobby run with a board on it, driven by the greedy pilot. */
function runWithBoard(seed = 3, turns = 4): RunState {
  let s = createRun(seed, 'drakko', 'lobby', undefined, 'set2');
  for (let t = 0; t < turns; t++) {
    for (let guard = 0; guard < 60; guard++) {
      const a = GREEDY_PILOT.decide(s, { seatId: 's0', round: s.wave, scoutedOpponent: null });
      if (!a) break;
      const n = reduce(s, a); if (n === s) break; s = n;
    }
    if (t < turns - 1) {
      // A non-lobby fight advances the wave without a table: faceOmen → resolveCombat → next turn.
      const c = reduce(s, { type: 'faceOmen' }); if (c === s) break;
      const r = reduce(c, { type: 'resolveCombat' }); if (r === c) break;
      s = r;
      if (s.phase !== 'recruit') break;
    }
  }
  return s;
}

const seat = (over: Partial<ScoutedSeat> & { seatId: string }): ScoutedSeat => ({
  heroId: 'drakko', alive: true, health: 30, armor: 0, intel: null, lastFought: null, ...over,
});
const dragonIntel = (tier: number, round: number) => ({ tier, triples: 0, topTribe: 'dragon' as const, topTribeCount: 3, round });
const scoutOf = (over: Partial<SeatScout> = {}): SeatScout => ({
  round: 6, me: { health: 30, armor: 0, lossCap: 10 }, nextOpponent: null, field: [], seatedRecordings: [SEATED_KEY], ...over,
});

describe('lethalRisk / survivalTerm', () => {
  it('is 0 while the hit is comfortable and 1 when it would take everything', () => {
    expect(lethalRisk(30, 0, 5)).toBe(0);
    expect(lethalRisk(30, 0, 12)).toBe(0);
    expect(lethalRisk(30, 0, 30)).toBe(1);
    expect(lethalRisk(10, 0, 10)).toBe(1);
    expect(lethalRisk(10, 5, 15)).toBe(1);
  });
  it('rises smoothly between 40% and 100% of what you have', () => {
    const r1 = lethalRisk(20, 0, 10); const r2 = lethalRisk(20, 0, 15); const r3 = lethalRisk(20, 0, 19);
    expect(r1).toBeGreaterThan(0); expect(r2).toBeGreaterThan(r1); expect(r3).toBeGreaterThan(r2); expect(r3).toBeLessThan(1);
  });
  it('the survival term is 0 for a comfortable seat and the full capped hit for a seat about to die', () => {
    expect(survivalTerm(scoutOf({ me: { health: 40, armor: 5, lossCap: 10 } }), 10)).toBe(0);
    expect(survivalTerm(scoutOf({ me: { health: 8, armor: 0, lossCap: 10 } }), 10)).toBe(-1);
    // The round cap clamps the hit: a 25-damage swing at cap 10 is a 10-damage swing.
    expect(survivalTerm(scoutOf({ me: { health: 8, armor: 0, lossCap: 10 } }), 25)).toBe(-1);
    const mid = survivalTerm(scoutOf({ me: { health: 12, armor: 0, lossCap: 10 } }), 8);
    expect(mid).toBeLessThan(0); expect(mid).toBeGreaterThan(-1);
  });
  it('an uncapped round (the finale) still produces a bounded term', () => {
    const t = survivalTerm(scoutOf({ me: { health: 5, armor: 0, lossCap: Infinity } }), 60);
    expect(t).toBeGreaterThanOrEqual(-1); expect(t).toBeLessThan(0);
  });
});

describe('shapeMatches — pool boards that look like the scouted seat', () => {
  it('matches the scouted tier and dominant tribe, from a wave near the round', () => {
    const m = shapeMatches('set2', 6, dragonIntel(3, 6), new Set([SEATED_KEY]), 3);
    expect(m.length).toBe(3);
    for (const b of m) {
      expect(b.tier).toBe(3);
      expect(Math.abs(b.wave - 6)).toBeLessThanOrEqual(1);
      expect(b.minions.every((x) => x.cardId.startsWith('d2_'))).toBe(true);
    }
  });
  it('NEVER samples a seated recording, whatever its shape — its future boards are the exact boards to come', () => {
    for (const round of [3, 5, 7, 9]) {
      const m = shapeMatches('set2', round, dragonIntel(3, round), new Set([SEATED_KEY]), 6);
      expect(m.some((b) => b.author === 'author9')).toBe(false);
      expect(m.every((b) => b.minions[0]!.attack < 40)).toBe(true);
    }
  });
  it('widens the tier by one when the exact tier has nothing, and returns nothing without intel', () => {
    const m = shapeMatches('set2', 6, dragonIntel(5, 6), new Set(), 2);
    expect(m.length).toBe(2);
    expect(m.every((b) => b.tier === 4)).toBe(true);
    expect(shapeMatches('set2', 6, null, new Set(), 3)).toEqual([]);
  });
});

describe('scoutedPanel — composition', () => {
  const v = () => toBotVisibleState(runWithBoard());
  it('is empty without a next opponent or a field (the caller falls back to the pool panel)', () => {
    expect(scoutedPanel(v(), scoutOf(), 5)).toEqual([]);
  });
  it('the next opponent takes the lion\'s share: its recently fought board first, then boards of its shape', () => {
    const fought: ScoutedBoard = { minions: [body('n2_spellsword', 9, 9)], tier: 3, round: 4 };
    const next = seat({ seatId: 's3', intel: dragonIntel(3, 6), lastFought: fought });
    const panel = scoutedPanel(v(), scoutOf({ nextOpponent: next, field: [next] }), 5);
    expect(panel.length).toBe(5);
    expect(panel[0]!.source).toBe('nextFought');
    expect(panel[0]!.weight).toBe(1.5);
    expect(panel[0]!.minions[0]!.cardId).toBe('n2_spellsword');
    expect(panel.filter((e) => e.next).length).toBeGreaterThanOrEqual(3);
    expect(panel.filter((e) => e.source === 'nextShape').every((e) => e.minions.every((m) => m.cardId.startsWith('d2_')))).toBe(true);
    // The next-opponent share carries more than half the total weight.
    const w = (p: boolean) => panel.filter((e) => e.next === p).reduce((n, e) => n + e.weight, 0);
    expect(w(true)).toBeGreaterThan(w(false));
  });
  it('a fought board older than the memory window is dropped in favour of the seat\'s current shape', () => {
    const stale: ScoutedBoard = { minions: [body('n2_spellsword', 1, 1)], tier: 1, round: 1 };
    const next = seat({ seatId: 's3', intel: dragonIntel(3, 6), lastFought: stale });
    const panel = scoutedPanel(v(), scoutOf({ round: 6, nextOpponent: next, field: [next] }), 5);
    expect(panel.some((e) => e.source === 'nextFought')).toBe(false);
  });
  it('the rest of the field follows at half weight, one stand-in each; the plain pool fills what is left', () => {
    const next = seat({ seatId: 's3', intel: dragonIntel(3, 6) });
    const beast = seat({ seatId: 's4', intel: { tier: 2, triples: 0, topTribe: 'beast', topTribeCount: 3, round: 5 } });
    const panel = scoutedPanel(v(), scoutOf({ nextOpponent: next, field: [next, beast] }), 5);
    const field = panel.find((e) => e.source === 'fieldShape');
    expect(field).toBeDefined();
    expect(field!.weight).toBe(0.5);
    expect(field!.minions.every((m) => m.cardId.startsWith('b2_'))).toBe(true);
    expect(panel.some((e) => e.source === 'pool')).toBe(true);
    expect(panel.every((e) => e.minions[0]!.attack < 40)).toBe(true); // never the seated recording
  });
});

describe('fightScore with a scout', () => {
  it('reports `panel: scouted` and the expected hit from the next opponent; the pool panel otherwise', () => {
    const v = toBotVisibleState(runWithBoard());
    const plain = fightScore(v, 5, null);
    expect(plain.panel).toBe('pool');
    expect(plain.expectedDamageTaken).toBeUndefined();
    const next = seat({ seatId: 's3', intel: dragonIntel(3, v.wave) });
    const scouted = fightScore(v, 5, scoutOf({ round: v.wave, nextOpponent: next, field: [next] }));
    expect(scouted.panel).toBe('scouted');
    expect(scouted.fights).toBe(5);
    expect(scouted.expectedDamageTaken).toBeDefined();
    expect(scouted.expectedDamageTaken!).toBeGreaterThanOrEqual(0);
    expect(scouted.expectedDamageTaken!).toBeLessThanOrEqual(10); // round-capped
    expect(lastFightResult(v)).toBe(scouted);
  });
  it('the scope hands the scout to every call that passes none, and closes again afterwards', () => {
    const v = toBotVisibleState(runWithBoard());
    const next = seat({ seatId: 's3', intel: dragonIntel(3, v.wave) });
    const inside = withScout(scoutOf({ round: v.wave, nextOpponent: next, field: [next] }), () => fightScore(v, 5));
    expect(inside.panel).toBe('scouted');
    expect(fightScore(v, 5).panel).toBe('pool');
  });
  it('an empty board reads the full hit of the next opponent (tier + every body) rather than a guess', () => {
    const v = toBotVisibleState(createRun(5, 'drakko', 'lobby', undefined, 'set2'));
    expect(v.friendly.bodies.length).toBe(0);
    const next = seat({ seatId: 's3', intel: dragonIntel(3, 6) });
    const r = fightScore(v, 5, scoutOf({ round: 6, nextOpponent: next, field: [next], me: { health: 30, armor: 0, lossCap: 10 } }));
    expect(r.panel).toBe('scouted');
    expect(r.winRate).toBe(0);
    expect(r.expectedDamageTaken).toBeGreaterThan(0);
    expect(r.expectedDamageTaken!).toBeLessThanOrEqual(10);
  });
  it('the next-opponent hit is the same number `expectedDamageTaken` computes on its own', () => {
    const v = toBotVisibleState(runWithBoard());
    const next = seat({ seatId: 's3', intel: dragonIntel(3, v.wave) });
    const s = scoutOf({ round: v.wave, nextOpponent: next, field: [next] });
    // Same fights, same seeds: fightScore seeds per wave, the helper per call — compare the panel-level bound.
    const a = fightScore(v, 5, s).expectedDamageTaken!;
    const b = expectedDamageTaken(v, s, 5);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(10);
    expect(b).toBeLessThanOrEqual(10);
  });
});

describe('scoutFromContext', () => {
  it('is null for a context without scouting and carries the rail\'s numbers otherwise', () => {
    expect(scoutFromContext({ seatId: 's0', round: 3, scoutedOpponent: null })).toBeNull();
    const s = scoutFromContext({ seatId: 's0', round: 3, scoutedOpponent: null, nextOpponent: null, field: [], myHealth: 12, myArmor: 3, lossCap: 5, seatedRecordings: ['a|b|1'] });
    expect(s).toMatchObject({ round: 3, me: { health: 12, armor: 3, lossCap: 5 }, nextOpponent: null, field: [], seatedRecordings: ['a|b|1'] });
  });
  it('no printed cap reads as uncapped — the conservative side', () => {
    const s = scoutFromContext({ seatId: 's0', round: 16, scoutedOpponent: null, nextOpponent: null, field: [] })!;
    expect(s.me.lossCap).toBe(Infinity);
  });
});
