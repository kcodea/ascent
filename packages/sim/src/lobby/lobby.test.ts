import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createLobby, pairSeats, resolveRound, runLobby, standings, DEFAULT_LOBBY_RULES } from './lobby';
import { recordRun, recordedSeat, botSeat, hybridSeat } from './seats';
import type { BoardSnapshot } from '../snapshot';
import type { SeatDriver } from './types';
import { createRun } from '../state';
import { reduce } from '../reducer';
import { CONFIG } from '../config';
import { DEFAULT_BOT } from '../bots/index';

/**
 * The 8-seat lobby prototype (owner direction 2026-07-29).
 *
 * These tests exist to answer the four questions the design actually hinges on, not to lock in the loop:
 *   1. Does one fight settle BOTH sides consistently?
 *   2. Does the lobby always terminate, and produce a single winner?
 *   3. What happens when a recorded run ends before the lobby does?
 *   4. Is the whole thing deterministic and driver-agnostic, so seats can be swapped later?
 */

/** A driver with a fixed board and a declared last round — lets exhaustion be tested without a real run. */
function stubSeat(label: string, power: number, lastRound = 99): SeatDriver {
  const snap = (wave: number): BoardSnapshot => ({
    v: 1, wave, heroId: 'warden', resolve: 30, tier: 3, triples: 0,
    tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], threat: 'glass', power,
    minions: Array.from({ length: Math.max(1, power) }, () => ({ cardId: 'sandbag', attack: power, health: power, keywords: [] })),
    seed: 1,
  }) as BoardSnapshot;
  return recordedSeat(label, Array.from({ length: lastRound }, (_, i) => snap(i + 1)));
}

describe('lobby — one fight settles both sides', () => {
  it('the winner deals damage and the loser takes it, from a SINGLE resolve', () => {
    // The load-bearing property: resolving the same fight twice with the sides swapped can disagree (attack
    // order alone can flip a close board), so both damage numbers must come out of one call.
    const strong = [{ cardId: 'sandbag', attack: 20, health: 20, keywords: [] }];
    const weak = [{ cardId: 'sandbag', attack: 1, health: 1, keywords: [] }];
    const r = simulate(strong, weak, makeRng(1), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 2 }));
    expect(r.result).toBe('win');
    expect(r.playerDamage, 'the winner should take nothing').toBe(0);
    expect(r.enemyDamage ?? 0, 'the loser took no damage — the mirror is missing').toBeGreaterThan(0);
  });

  it('…and the mirror uses the same formula as playerDamage', () => {
    // Same fight from the other seat's chair: what A deals to B must equal what B would take if the sides were
    // labelled the other way. If these ever diverge, the lobby has two truths about one encounter.
    const strong = [{ cardId: 'sandbag', attack: 20, health: 20, keywords: [] }];
    const weak = [{ cardId: 'sandbag', attack: 1, health: 1, keywords: [] }];
    const forward = simulate(strong, weak, makeRng(1), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 2 }));
    const swapped = simulate(weak, strong, makeRng(1), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 5 }));
    expect(swapped.result).toBe('lose');
    expect(forward.enemyDamage ?? 0).toBe(swapped.playerDamage);
  });

  it('damage eats Armor before Resolve', () => {
    const s = createLobby(1, [stubSeat('strong', 12), stubSeat('weak', 1)], { seatCount: 2, startingArmor: 100 });
    resolveRound(s);
    const loser = s.seats.find((x) => x.driver.label === 'weak')!;
    expect(loser.armor, 'armor absorbed nothing').toBeLessThan(100);
    expect(loser.resolve, 'resolve was chipped while armor remained').toBe(DEFAULT_LOBBY_RULES.startingResolve);
  });
});

describe('lobby — it terminates with exactly one winner', () => {
  const eight = () => [12, 10, 8, 7, 6, 4, 3, 1].map((p, i) => stubSeat(`seat${i}`, p));

  it('an 8-seat lobby of recorded seats runs to a single survivor', () => {
    const s = runLobby(createLobby(42, eight()));
    expect(s.finished).toBe(true);
    expect(s.seats.filter((x) => x.alive).length, 'more than one seat left standing').toBe(1);
    expect(s.round, 'the lobby hit the hard stop instead of resolving').toBeLessThanOrEqual(s.rules.maxRounds);
  });

  it('every seat gets a placement, and the winner is 1st', () => {
    const s = runLobby(createLobby(42, eight()));
    const order = standings(s);
    expect(order[0]!.placement).toBe(1);
    expect(order[0]!.alive).toBe(true);
    for (const seat of s.seats) expect(seat.placement, `${seat.driver.label} has no placement`).toBeDefined();
  });

  it('the stronger boards generally place higher (the loop is not noise)', () => {
    // Not a strict ordering — combat has real variance and pairings differ — but the top seat should not be
    // finishing last. Without this the tests above would pass on a lobby that assigned placements at random.
    const wins = { strong: 0, weak: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const s = runLobby(createLobby(seed, eight()));
      const champ = standings(s)[0]!.driver.label;
      if (champ === 'seat0' || champ === 'seat1') wins.strong++;
      if (champ === 'seat6' || champ === 'seat7') wins.weak++;
    }
    expect(wins.strong, 'the two strongest seats never won').toBeGreaterThan(wins.weak);
  });

  it('stall pressure prevents an unkillable stalemate', () => {
    // Eight identical boards draw forever. Pressure is what guarantees the lobby still ends.
    const mirror = Array.from({ length: 8 }, (_, i) => stubSeat(`same${i}`, 6));
    const s = runLobby(createLobby(7, mirror));
    expect(s.finished).toBe(true);
    expect(s.seats.filter((x) => x.alive).length).toBe(1);
  });
});

describe('lobby — a recorded run that ends before the lobby does', () => {
  it("'eliminate' knocks the seat out when its recording runs dry", () => {
    const short = stubSeat('short', 6, 2); // only 2 rounds of boards
    const s = createLobby(3, [stubSeat('long', 6), short], { seatCount: 2, exhaustion: 'eliminate' });
    for (let i = 0; i < 5 && !s.finished; i++) resolveRound(s);
    const seat = s.seats.find((x) => x.driver.label === 'short')!;
    expect(seat.alive, 'an exhausted recording kept fighting under the eliminate policy').toBe(false);
  });

  it("'repeatFinal' keeps the seat alive by re-fielding its last board", () => {
    // The default, and the reason it's the default: lobby length should depend on play, not on how long a
    // recording's owner happened to survive.
    const short = stubSeat('short', 6, 2);
    const s = createLobby(3, [stubSeat('long', 9), short], { seatCount: 2, exhaustion: 'repeatFinal' });
    resolveRound(s); resolveRound(s); resolveRound(s);
    const seat = s.seats.find((x) => x.driver.label === 'short')!;
    // Asserted through the LOBBY, not the driver: the driver honestly reports it is dry (`prepare` -> null)
    // and the policy is what keeps the seat fighting. Testing the driver alone missed exactly that.
    expect(seat.driver.prepare(5), 'the driver should admit it is out of recorded boards').toBeNull();
    expect(seat.driver.finalBoard?.(), 'but it must still expose its final board').toBeTruthy();
    expect(seat.alive, 'repeatFinal should keep an exhausted seat in the lobby').toBe(true);
    // `fought` is what distinguishes a real 0-damage draw from a couldn't-field-a-board round; without it the
    // two are identical in the log and a broken policy reads as a legitimate stalemate.
    expect(s.encounters.some((e) => e.round === 3 && e.fought),
      'round 3 produced no fight — the exhausted seat stopped contributing').toBe(true);
  });
});

describe('lobby — deterministic and driver-agnostic', () => {
  const eight = () => [12, 10, 8, 7, 6, 4, 3, 1].map((p, i) => stubSeat(`seat${i}`, p));

  it('the same seed and seats reproduce the same lobby exactly', () => {
    const a = runLobby(createLobby(99, eight()));
    const b = runLobby(createLobby(99, eight()));
    expect(standings(b).map((s) => s.driver.label)).toEqual(standings(a).map((s) => s.driver.label));
    expect(b.encounters).toEqual(a.encounters);
  });

  it('a different seed produces a different lobby (the seed is actually used)', () => {
    const a = runLobby(createLobby(1, eight()));
    const b = runLobby(createLobby(2, eight()));
    expect(b.encounters).not.toEqual(a.encounters);
  });

  it('pairing never sits a seat against itself, and pairs everyone it can', () => {
    const s = createLobby(5, eight());
    const { pairs, bye } = pairSeats(s, makeRng(5));
    for (const [a, b] of pairs) expect(a.id).not.toBe(b.id);
    expect(pairs.length * 2 + (bye ? 1 : 0)).toBe(8);
  });

  it('an ODD number of survivors gives exactly one bye', () => {
    const s = createLobby(5, eight());
    s.seats[0]!.alive = false;
    const { pairs, bye } = pairSeats(s, makeRng(5));
    expect(bye, 'seven living seats should leave one out').toBeTruthy();
    expect(pairs.length).toBe(3);
  });

  it('the lobby cannot tell a bot seat from a recorded one — the swap point holds', () => {
    // The owner's requirement: if snapshots don't feel right, pivot to bots (or all-bot) afterwards. That is
    // only true if the lobby consumes drivers through one interface, which this asserts structurally.
    const rec = recordRun(11, 'warden');
    expect(rec.kind).toBe('recorded');
    const s = createLobby(4, [rec, stubSeat('other', 6)], { seatCount: 2 });
    expect(() => runLobby(s)).not.toThrow();
    expect(s.finished).toBe(true);
  });

  it('a REAL recorded run supplies a board for every round it played', () => {
    // Proves the recorded-seat path against genuine autoplay output, not just the stub.
    const rec = recordRun(23, 'drakko');
    expect(rec.lastWave, 'the recording produced no waves').toBeGreaterThan(3);
    for (let round = 1; round <= rec.lastWave; round++) {
      const board = rec.prepare(round);
      expect(board, `no board at round ${round}`).toBeTruthy();
      expect(board!.minions.length).toBeGreaterThan(0);
    }
    expect(rec.prepare(rec.lastWave + 1), 'a recording should report when it runs dry').toBeNull();
  });
});

describe('lobby mode — a seat with no course clock', () => {
  it('an ordinary run still ends at the course length', () => {
    // The control: without it, the lobby-mode test below could pass because runs never end at all.
    let s = createRun(5, 'drakko', 'ascent');
    let guard = 0;
    while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 4000) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    expect(s.wave, 'an Ascent run should stop at the course length').toBeLessThanOrEqual(CONFIG.courseRounds);
  });

  it('a LOBBY run keeps playing past the course length', () => {
    // A lobby ends by elimination, not after 17 rounds, so a seat must keep shopping and scaling. Without this
    // a bot seat froze at wave 17 and every later round was fought with a stale board.
    let s = createRun(5, 'drakko', 'lobby');
    let guard = 0;
    while (s.wave <= CONFIG.courseRounds + 6 && s.phase !== 'gameover' && guard++ < 8000) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    expect(s.wave, 'the lobby run stopped at the course clock').toBeGreaterThan(CONFIG.courseRounds);
    expect(s.phase).not.toBe('victory');
  });
});

describe('option 3 — a live bot takes the seat when the recording runs dry', () => {
  it('a live bot seat still fields a board well past a recording’s length', () => {
    const seat = botSeat(31, 'drakko', 'live');
    const late = seat.prepare(CONFIG.courseRounds + 5);
    expect(late, 'the live seat ran out of boards').toBeTruthy();
    expect(late!.minions.length).toBeGreaterThan(0);
  });

  it('…and its board keeps SCALING, which is the whole point', () => {
    // A stale repeated board is why `repeatFinal` lobbies ground to the hard stop. A live seat has to actually
    // grow, or the fallback buys nothing over repeating the final board.
    const seat = botSeat(31, 'drakko', 'live');
    const early = seat.prepare(5)!;
    const late = seat.prepare(CONFIG.courseRounds + 4)!;
    const power = (b: typeof early) => b.minions.reduce((n, m) => n + m.attack + m.health, 0);
    expect(power(late), 'the late board is no stronger than the early one').toBeGreaterThan(power(early));
  });

  it('a hybrid seat uses the RECORDING early and the live bot late', () => {
    const seat = hybridSeat(31, 'drakko', 'hybrid');
    const recorded = recordRun(31, 'drakko');
    // Inside the recording's range the hybrid must serve the recorded board verbatim — that authenticity is the
    // reason to use a snapshot at all.
    expect(seat.prepare(4)).toEqual(recorded.prepare(4));
    // Past it the recording is dry, but the seat keeps fighting.
    expect(recorded.prepare(seat.lastRecordedWave + 3)).toBeNull();
    expect(seat.prepare(seat.lastRecordedWave + 3), 'the hybrid stopped when its recording did').toBeTruthy();
  });

  it('a hybrid lobby resolves without hitting the round cap', () => {
    // The measured failure it exists to fix: recorded seats on `repeatFinal` ground on to `maxRounds`.
    const seats = Array.from({ length: 8 }, (_, i) => hybridSeat(500 + i, undefined, `h${i}`));
    const s = runLobby(createLobby(3, seats));
    expect(s.finished).toBe(true);
    expect(s.round - 1, 'the lobby still ran to the hard stop').toBeLessThan(s.rules.maxRounds);
    expect(s.seats.filter((x) => x.alive).length).toBe(1);
  });
});
