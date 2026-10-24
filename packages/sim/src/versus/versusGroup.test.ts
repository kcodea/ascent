/**
 * VERSUS GROUP (owner 2026-10-24, R-VERSUS-GROUP-01): the round-robin pairing, the copy rule, the hearts rules and the
 * determinism of a group round's resolution.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreparedCombatSide } from '../state';
import { resolveVersusGroupRound, versusGroupAliveAt, versusGroupCombatSeed, versusGroupPairings, type VersusGroupPairing, type VersusGroupSeat } from './group';
import { canonicalJson } from './canonical';
import { versusCombatSeed } from './combat';

const FOUR: VersusGroupSeat[] = ['p1', 'p2', 'p3', 'p4'];
const THREE: VersusGroupSeat[] = ['p1', 'p2', 'p3'];
const key = (p: VersusGroupPairing): string => [p.a, p.b].sort().join('-');
const real = (ps: VersusGroupPairing[]): VersusGroupPairing[] => ps.filter((p) => !p.copy);

describe('Versus Group pairing (R-VERSUS-GROUP-01)', () => {
  it('4 alive: two fights a round, everyone meets everyone once per 3-round cycle, then it repeats', () => {
    const seen = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      const ps = versusGroupPairings(FOUR, {}, r);
      expect(ps).toHaveLength(2);
      expect(ps.every((p) => !p.copy)).toBe(true);
      expect(new Set(ps.flatMap((p) => [p.a, p.b])).size).toBe(4); // everyone fights each round
      for (const p of ps) { expect(seen.has(key(p))).toBe(false); seen.add(key(p)); }
    }
    expect(seen.size).toBe(6);
    expect(versusGroupPairings(FOUR, {}, 4)).toEqual(versusGroupPairings(FOUR, {}, 1));
  });

  it('3 alive: one real fight + the odd player faces a COPY; over a cycle every pair fights, every player faces and is copied once', () => {
    const faced = new Map<string, number>();
    const copied = new Map<string, number>();
    const pairs = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      const ps = versusGroupPairings(THREE, {}, r);
      expect(ps).toHaveLength(2);
      const [fight, copy] = [real(ps), ps.filter((p) => p.copy)];
      expect(fight).toHaveLength(1);
      expect(copy).toHaveLength(1);
      const odd = copy[0]!.a;
      expect(copy[0]!.b).not.toBe(odd); // never a copy of yourself
      expect([fight[0]!.a, fight[0]!.b]).not.toContain(odd);
      faced.set(odd, (faced.get(odd) ?? 0) + 1);
      copied.set(copy[0]!.b, (copied.get(copy[0]!.b) ?? 0) + 1);
      pairs.add(key(fight[0]!));
    }
    expect(pairs.size).toBe(3);
    expect([...faced.values()]).toEqual([1, 1, 1]);
    expect([...copied.values()]).toEqual([1, 1, 1]);
  });

  it('a 4-player match losing a player continues as 3 with a copy, avoiding an immediate rematch', () => {
    // Round 1: AB CD. p4 is knocked out in round 1, so round 2 is the 3-alive cycle.
    expect(versusGroupPairings(FOUR, { p4: 1 }, 1).map(key)).toEqual(['p1-p2', 'p3-p4']);
    const r2 = versusGroupPairings(FOUR, { p4: 1 }, 2);
    expect(r2.some((p) => p.copy)).toBe(true);
    expect(real(r2).map(key)).not.toContain('p1-p2'); // p1-p2 just fought
    expect(r2.flatMap((p) => [p.a, p.b])).not.toContain('p4');
  });

  it('2 alive: they face each other every round; 1 alive: no fights', () => {
    expect(versusGroupPairings(FOUR, { p3: 2, p4: 3 }, 5)).toEqual([{ a: 'p1', b: 'p2', copy: false }]);
    expect(versusGroupPairings(THREE, { p2: 1, p3: 1 }, 2)).toEqual([]);
  });

  it('a seat that goes out DURING round r still fights round r (a ghost): the pairing never changes under the players', () => {
    expect(versusGroupPairings(FOUR, { p2: 4 }, 4)).toEqual(versusGroupPairings(FOUR, {}, 4));
    expect(versusGroupAliveAt(FOUR, { p2: 4 }, 4)).toEqual(FOUR);
    expect(versusGroupAliveAt(FOUR, { p2: 4 }, 5)).toEqual(['p1', 'p3', 'p4']);
    // Out during Hero Select (round 0) = never alive: a 3-player schedule from round 1.
    expect(versusGroupPairings(FOUR, { p4: 0 }, 1)).toEqual(versusGroupPairings(THREE, {}, 1));
  });

  it('seat gaps work (p1, p2 and p4 seated)', () => {
    const ps = versusGroupPairings(['p1', 'p2', 'p4'], {}, 1);
    expect(ps.flatMap((p) => [p.a, p.b]).sort()).toEqual(['p1', 'p1', 'p2', 'p4']);
  });

  it('every fight has its own seed, distinct from the 1v1 seed', () => {
    const seeds = new Set([versusGroupCombatSeed(9, 3, 0), versusGroupCombatSeed(9, 3, 1), versusGroupCombatSeed(9, 4, 0), versusCombatSeed(9, 3)]);
    expect(seeds.size).toBe(4);
  });
});

describe('Versus Group round resolution (one simulate per fight, hearts rules)', () => {
  const { cases } = JSON.parse(readFileSync(join(__dirname, 'fixtures/parity.v1.json'), 'utf8')) as { cases: { p1: PreparedCombatSide; p2: PreparedCombatSide }[] };
  const c1 = cases[1]!;
  const c2 = cases[2]!;
  const sides = { p1: c1.p1, p2: c1.p2, p3: c2.p1, p4: c2.p2 };

  it('is deterministic: same input, same bytes; the input sides are never mutated', () => {
    const before = canonicalJson(sides);
    const a = resolveVersusGroupRound({ matchSeed: 77, round: 3, seats: FOUR, eliminated: {}, sides: structuredClone(sides) });
    const b = resolveVersusGroupRound({ matchSeed: 77, round: 3, seats: FOUR, eliminated: {}, sides: structuredClone(sides) });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    resolveVersusGroupRound({ matchSeed: 77, round: 3, seats: FOUR, eliminated: {}, sides });
    expect(canonicalJson(sides)).toBe(before);
    expect(a.fights).toHaveLength(2);
  });

  it('a loser loses one heart; a draw nobody; side b holds the mirrored perspective; the chair rotates', () => {
    for (const round of [1, 2, 3, 4]) {
      const out = resolveVersusGroupRound({ matchSeed: 5, round, seats: FOUR, eliminated: {}, sides });
      for (const f of out.fights) {
        expect(f.chair).toBe(round % 2 === 1 ? 'a' : 'b');
        if (f.outcome === 'draw') expect(f.heartLostBy).toBeNull();
        else expect(f.heartLostBy).toBe(f.outcome === 'a' ? f.b : f.a);
        expect(f.aResult.result).toBe(f.outcome === 'a' ? 'win' : f.outcome === 'b' ? 'lose' : 'draw');
        expect(f.bResult.result).toBe(f.outcome === 'b' ? 'win' : f.outcome === 'a' ? 'lose' : 'draw');
      }
    }
  });

  it('a COPY never loses a heart, but beating the facing player costs them one', () => {
    let copyLosses = 0;
    let copyWins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const round of [1, 2, 3]) {
        const out = resolveVersusGroupRound({ matchSeed: seed, round, seats: THREE, eliminated: {}, sides });
        const f = out.fights.find((x) => x.copy)!;
        if (f.outcome === 'a') { copyLosses++; expect(f.heartLostBy).toBeNull(); }
        if (f.outcome === 'b') { copyWins++; expect(f.heartLostBy).toBe(f.a); }
      }
    }
    expect(copyLosses + copyWins).toBeGreaterThan(0);
  });

  it('the copy fights with the copied seat\'s own locked board for the round', () => {
    const out = resolveVersusGroupRound({ matchSeed: 3, round: 1, seats: THREE, eliminated: {}, sides });
    const f = out.fights.find((x) => x.copy)!;
    const copiedBoard = (sides as Record<string, { board: { cardId: string }[] }>)[f.b]!.board.map((m) => m.cardId);
    expect(f.aResult.initial.enemy.map((m) => m.cardId)).toEqual(copiedBoard);
  });

  it('a ghost (a seat out during the round) never loses a heart; a missing or malformed side fights empty', () => {
    const out = resolveVersusGroupRound({ matchSeed: 4, round: 1, seats: FOUR, eliminated: { p2: 1 }, sides: { ...sides, p4: { board: 'x' } } });
    for (const f of out.fights) expect(f.heartLostBy).not.toBe('p2');
    expect(out.refused.p4).toBe('board_not_array');
  });
});
