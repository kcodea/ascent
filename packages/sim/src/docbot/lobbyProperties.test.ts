/**
 * DOC BOT — LOBBY PROPERTY TESTS.
 *
 * The eight-seat elimination lobby (docs/GAME-RULES.md, `.claude/skills/ascent-lobby/SKILL.md`) is driven
 * HEADLESSLY through its real loop — `createLobby` → `resolveRound` → `runLobby` over `SeatDriver`s — across
 * many seeds, and the properties the rules doc states are asserted structurally rather than by example:
 *
 *   · Rating: a better placement never yields a smaller Rating change (`LOBBY_PLACEMENT_DELTAS` +
 *     `resolveLobbyRating`, including the 0-floor).
 *   · Pairing: every living seat fights exactly once per round or takes the documented bye; an eliminated
 *     seat is never paired; no seat fights itself.
 *   · Elimination: a seat at zero is eliminated exactly once and stays out; final placements follow the
 *     documented competition-ranking rule (simultaneous knockouts SHARE a placement, the next skips).
 *   · The `maxRounds` stalemate backstop terminates a lobby of boards that cannot hurt each other.
 *
 * Seeding goes through the repo's `makeRng` (Math.random is banned). Seat drivers are `recordedSeat`s over
 * synthetic snapshots — the same driver contract every real seat kind implements, so the loop under test is
 * the shipped one, not a mock.
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { createLobby, resolveRound, runLobby, standings, DEFAULT_LOBBY_RULES } from '../lobby/lobby';
import { recordedSeat } from '../lobby/seats';
import type { LobbyState } from '../lobby/types';
import type { SeatDriver } from '../lobby/types';
import type { BoardSnapshot } from '../snapshot';
import { LOBBY_PLACEMENT_DELTAS, initialProfile, resolveLobbyRating } from '../playerRating';

/** A recorded seat that fields the same synthetic board every round — strength scales with `power`.
 *  (`sandbag` at attack=power: the same stub the shipped lobby tests drive the loop with.) */
function stubSeat(label: string, power: number): SeatDriver {
  const snap = (wave: number): BoardSnapshot => ({
    v: 1, wave, heroId: 'warden', resolve: 30, tier: 3, triples: 0,
    tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], threat: 'glass', power,
    minions: Array.from({ length: Math.min(7, Math.max(1, power)) }, () => ({ cardId: 'sandbag', attack: power, health: power, keywords: [] })),
    seed: 1,
  }) as BoardSnapshot;
  return recordedSeat(label, Array.from({ length: 40 }, (_, i) => snap(i + 1)));
}

/** Eight seats of seed-derived, deliberately unequal strength (ties still happen — that is the point). */
function eightSeats(seed: number): SeatDriver[] {
  const rng = makeRng(seed);
  return Array.from({ length: 8 }, (_, i) => stubSeat(`seat${i}`, 1 + rng.int(6)));
}

const SEEDS = Array.from({ length: 30 }, (_, i) => 1000 + i * 37);

describe('Doc Bot — Rating monotonicity across placements', () => {
  it('the placement delta table covers all 8 seats and is strictly decreasing (1st best … 8th worst)', () => {
    expect(LOBBY_PLACEMENT_DELTAS).toHaveLength(8);
    for (let i = 1; i < LOBBY_PLACEMENT_DELTAS.length; i++) {
      expect(LOBBY_PLACEMENT_DELTAS[i]!, `placement ${i + 1} must pay less than placement ${i}`).toBeLessThan(LOBBY_PLACEMENT_DELTAS[i - 1]!);
    }
  });

  it('resolveLobbyRating: a better placement never yields a lower post-run rating, at any starting rating', () => {
    // Low starting ratings exercise the 0-floor: -92 and -62 can clamp to the same landing spot, but a better
    // placement must never land BELOW a worse one.
    for (const start of [0, 10, 50, 100, 500, 1200, 2500]) {
      const profile = { ...initialProfile(), rating: start };
      let prevAfter = Infinity;
      let prevDelta = Infinity;
      for (let placement = 1; placement <= 8; placement++) {
        const change = resolveLobbyRating(profile, placement);
        expect(change.ratingDelta, `raw delta at placement ${placement} (start ${start})`).toBeLessThanOrEqual(prevDelta);
        expect(change.ratingAfter, `rating after placement ${placement} (start ${start})`).toBeLessThanOrEqual(prevAfter);
        expect(change.ratingAfter, 'the floor is 0').toBeGreaterThanOrEqual(0);
        expect(change.ratingDelta).toBe(LOBBY_PLACEMENT_DELTAS[placement - 1]);
        prevAfter = change.ratingAfter;
        prevDelta = change.ratingDelta;
      }
    }
  });

  it('out-of-range placements clamp to the table edges rather than reading past it', () => {
    const p = initialProfile();
    expect(resolveLobbyRating({ ...p, rating: 500 }, 0).ratingDelta).toBe(LOBBY_PLACEMENT_DELTAS[0]);
    expect(resolveLobbyRating({ ...p, rating: 500 }, 99).ratingDelta).toBe(LOBBY_PLACEMENT_DELTAS[7]);
  });
});

describe('Doc Bot — pairing + elimination invariants (the real loop, many seeds)', () => {
  it('every round: living seats fight exactly once or take the bye; the dead are never paired; nobody fights itself', () => {
    for (const seed of SEEDS) {
      const state = createLobby(seed, eightSeats(seed));
      let guard = 0;
      while (!state.finished && guard++ <= state.rules.maxRounds + 1) {
        const round = state.round;
        const aliveBefore = new Set(state.seats.filter((s) => s.alive).map((s) => s.id));
        const deadBefore = new Set(state.seats.filter((s) => !s.alive).map((s) => s.id));
        resolveRound(state);
        const entries = state.encounters.filter((e) => e.round === round);
        const seen = new Map<string, number>();
        for (const e of entries) {
          if (e.bye) {
            // The documented bye treatment: the odd seat out takes the round off — recorded a=b, no damage.
            expect(e.a, `seed ${seed} r${round}: a bye is recorded as itself`).toBe(e.b);
            expect(e.fought).toBe(false);
            expect(e.damageToA + e.damageToB).toBe(0);
            seen.set(e.a, (seen.get(e.a) ?? 0) + 1);
            continue;
          }
          expect(e.a, `seed ${seed} r${round}: a seat fought ITSELF`).not.toBe(e.b);
          seen.set(e.a, (seen.get(e.a) ?? 0) + 1);
          seen.set(e.b, (seen.get(e.b) ?? 0) + 1);
        }
        for (const id of aliveBefore) {
          expect(seen.get(id) ?? 0, `seed ${seed} r${round}: living seat ${id} must appear exactly once (fight or bye)`).toBe(1);
        }
        for (const id of deadBefore) {
          expect(seen.has(id), `seed ${seed} r${round}: ELIMINATED seat ${id} was paired`).toBe(false);
        }
      }
      expect(state.finished, `seed ${seed}: the lobby never finished`).toBe(true);
    }
  });

  it('elimination is exactly-once and sticky; placements follow the shared-placement competition rule', () => {
    for (const seed of SEEDS) {
      const state = createLobby(seed, eightSeats(seed));
      const eliminatedAt = new Map<string, number>();
      let guard = 0;
      while (!state.finished && guard++ <= state.rules.maxRounds + 1) {
        resolveRound(state);
        for (const seat of state.seats) {
          if (!seat.alive) {
            expect(seat.eliminatedRound, `seed ${seed}: a dead seat must record its elimination round`).toBeDefined();
            const prev = eliminatedAt.get(seat.id);
            if (prev !== undefined) {
              expect(seat.eliminatedRound, `seed ${seed}: seat ${seat.id} was eliminated TWICE (round moved ${prev} → ${seat.eliminatedRound})`).toBe(prev);
            } else {
              eliminatedAt.set(seat.id, seat.eliminatedRound!);
            }
          } else if (eliminatedAt.has(seat.id)) {
            // The one sanctioned resurrection is the wipeout guard, which crowns THE winner — a revived seat
            // must therefore end the lobby placed 1st, never quietly rejoin the field.
            expect(seat.placement ?? 1, `seed ${seed}: seat ${seat.id} came back from the dead without winning`).toBe(1);
          }
        }
        // A dead seat never appears in any encounter after its elimination round.
        for (const e of state.encounters) {
          for (const id of e.bye ? [e.a] : [e.a, e.b]) {
            const died = eliminatedAt.get(id);
            if (died !== undefined) expect(e.round, `seed ${seed}: dead seat ${id} appeared in round ${e.round}`).toBeLessThanOrEqual(died);
          }
        }
      }
      // Final placements: all assigned in 1..8. Simultaneous knockouts SHARE a placement and the ranking
      // skips by the tie size (competition ranking): seats placed strictly better than p == p − count(p).
      const placements = state.seats.map((s) => s.placement);
      expect(placements.every((p) => p !== undefined && p >= 1 && p <= 8), `seed ${seed}: unplaced seat or out-of-range placement (${placements.join(',')})`).toBe(true);
      const stalemate = state.round > state.rules.maxRounds && state.seats.filter((s) => s.alive).length > 1;
      if (!stalemate) {
        const counts = new Map<number, number>();
        for (const p of placements) counts.set(p!, (counts.get(p!) ?? 0) + 1);
        for (const [p, c] of counts) {
          const better = placements.filter((q) => q! < p).length;
          expect(better, `seed ${seed}: placement ${p} held by ${c} seat(s) must have exactly ${p - c} seats above it (got ${better})`).toBe(p - c);
        }
        expect(counts.get(1), `seed ${seed}: no single winner`).toBe(1);
      }
      // standings() must agree: winner first, everyone present once.
      const order = standings(state as LobbyState);
      expect(order).toHaveLength(8);
      expect(order[0]!.placement).toBe(1);
      for (let i = 1; i < order.length; i++) expect(order[i]!.placement!).toBeGreaterThanOrEqual(order[i - 1]!.placement!);
    }
  });

  it('determinism: the same seed + seats produce identical placements', () => {
    const a = runLobby(createLobby(4242, eightSeats(4242)));
    const b = runLobby(createLobby(4242, eightSeats(4242)));
    expect(a.seats.map((s) => [s.id, s.placement, s.eliminatedRound])).toEqual(b.seats.map((s) => [s.id, s.placement, s.eliminatedRound]));
  });
});

describe('Doc Bot — the maxRounds stalemate backstop', () => {
  it('the shipped backstop is the documented 60 (a backstop, not a course length)', () => {
    expect(DEFAULT_LOBBY_RULES.maxRounds).toBe(60);
  });

  it('a table of boards that cannot hurt each other terminates AT the backstop with every survivor placed 1st', () => {
    // Eight 0-attack Taunt walls: every fight is a 0-damage draw forever — the exact shape the rules doc
    // names as the backstop's reason to exist. A small maxRounds keeps the test fast; the mechanism under
    // test (the round-counter hard stop) is the same one the shipped 60 uses.
    const walls = Array.from({ length: 8 }, (_, i) => stubSeat(`wall${i}`, 0));
    const state = runLobby(createLobby(7, walls, { maxRounds: 12 }));
    expect(state.finished, 'the stalemate lobby never terminated').toBe(true);
    expect(state.round, 'it must stop exactly when the counter passes maxRounds').toBe(13);
    expect(state.seats.every((s) => s.alive), 'nobody can be eliminated by 0-damage draws').toBe(true);
    expect(state.seats.every((s) => s.placement === 1), 'the documented stalemate outcome: all survivors share 1st').toBe(true);
    // And no round is recorded past the stop.
    expect(Math.max(...state.encounters.map((e) => e.round))).toBeLessThanOrEqual(12);
  });
});
