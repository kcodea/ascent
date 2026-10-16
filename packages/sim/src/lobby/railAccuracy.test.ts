import { describe, it, expect, beforeAll } from 'vitest';
import { makeRng, simulate, type CombatResult, type Tribe } from '@game/core';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX, activeSet, poolFor } from '@game/content';
import { reduce, roundLossCap } from '../reducer';
import { DEFAULT_BOT } from '../bots/index';
import { registerOpponents } from '../opponents';
import { playableHeroes } from '../heroes';
import { seatCombatSide } from '../boardSide';
import { setIdOf } from '../cardPool';
import type { BoardSnapshot } from '../snapshot';
import type { RunState } from '../state';
import {
  createLobbyRun, driverFor, lastRoundDamage, pairRunLobby, ghostFor, resetLobbyDrivers, seatResults,
  type LobbySeatState, type RunLobby, type SeatIntel,
} from './runLobby';
import { lobbyRailView, railSeatIntel } from './railView';
import type { PreparedBoard } from './types';

/**
 * THE LOBBY RAIL, FIELD BY FIELD, AGAINST GROUND TRUTH (owner 2026-10-16, R-LOBBY-RAIL-01: "can you have an agent look
 * at the lobby rail info and make sure that it is accurate? the tier pill being wrong has me wondering if the rest of
 * it is wrong too").
 *
 * Real 8-seat lobbies are played through the REAL reducer (the player's seat by `DEFAULT_BOT`, seven RECORDED player
 * runs registered below, each with its own tier / Gilded / tribe / quest / rune curve). Every round, in the shop the
 * player is looking at, every field the rail prints (`lobbyRailView`, `railSeatIntel`, `seatResults`,
 * `lastRoundDamage`) is checked against a ledger this test keeps ITSELF:
 *
 *  - the player's fight is read off the fight the reducer actually ran (`run.lastCombat`), never off the table;
 *  - every other pairing is RE-SIMULATED here from the seats' recorded boards (same pairing, same RNG stream, same
 *    sides), so who won, who took what and from whom is independent of the settle's own bookkeeping;
 *  - health is charged Armor first by this file's own arithmetic, knockouts and shared placements are derived here;
 *  - a seat's scouting intel is read straight off its RECORDING (the board for the viewer's round, or the board it
 *    fell with), not off the driver the rail itself asks.
 *
 * DMG is the hit the seat took, Armor and Resolve together (the same number its health drops by, the floating "-N"
 * and the round's max damage are in), capped by the round.
 */

// ── Seven recorded player runs, each a different shape. ────────────────────────────────────────────────────────
const SET = activeSet().id;
const minionsOf = (tribe: Tribe): string[] => poolFor(SET).all
  .filter((c) => !c.spell && !c.token && c.tribe === tribe && !c.tribe2 && c.tier <= 2)
  .map((c) => c.id);
const TRIBES: Tribe[] = (['beast', 'undead', 'mech', 'dragon', 'demon', 'kobold', 'dwarf'] as Tribe[]).filter((t) => minionsOf(t).length > 0);
const QUESTS = Object.keys(QUEST_INDEX);
const RUNES = Object.keys(RUNE_INDEX);
const RUN_LENGTHS = [16, 6, 12, 9, 16, 5, 14]; // some recordings end early: their seats keep serving the final board
/** Per-run strength, so the table sorts itself out: the weak runs fall, the strong ones knock them out. */
const GROWTH = [0.2, 0.7, 0.3, 0.9, 0.2, 0.8, 0.4];

const recordedRuns = (): BoardSnapshot[] => {
  const heroes = playableHeroes().filter((h) => h.id !== 'drakko' && !h.tribes);
  const out: BoardSnapshot[] = [];
  for (let r = 0; r < 7; r++) {
    for (let wave = 1; wave <= RUN_LENGTHS[r]!; wave++) {
      // A dominant tribe that SWITCHES mid-run, so a stale read and a current read disagree.
      const main = TRIBES[(r + (wave > 4 ? 1 : 0)) % TRIBES.length]!;
      const side = TRIBES[(r + 3) % TRIBES.length]!;
      const count = Math.min(7, 1 + Math.floor(wave / 2));
      const ids = Array.from({ length: count }, (_, i) => {
        const pool = minionsOf(i % 3 === 2 ? side : main);
        return pool[(wave + i) % pool.length]!;
      });
      out.push({
        v: 1, wave, heroId: heroes[r]!.id, resolve: 30, armor: 15,
        tier: Math.min(6, 1 + Math.floor((wave - 1) / 2)),
        triples: Math.floor(wave / (3 + r)),
        tribes: TRIBES.slice(0, 5), threat: 'venom', power: count * 6,
        minions: ids.map((cardId, i) => ({ cardId, attack: 1 + Math.floor(wave * GROWTH[r]!) + (i % 2), health: 1 + Math.floor(wave * GROWTH[r]!), keywords: [] })),
        seed: 9000 + r, origin: 'self', author: `Rec${r}`, setId: SET,
        ...(wave >= 3 + r % 3 ? { quests: [QUESTS[(r * 3) % QUESTS.length]!] } : {}),
        ...(wave >= 5 ? { runes: RUNES.slice(r, r + 1 + Math.min(2, Math.floor((wave - 5) / 3))) } : {}),
      } as BoardSnapshot);
    }
  }
  return out;
};

beforeAll(() => { registerOpponents(recordedRuns()); });

// ── The ledger. ────────────────────────────────────────────────────────────────────────────────────────────────
interface Fight { round: number; foe: string; outcome: 'win' | 'lose' | 'draw'; taken: number; dealt: number }
interface Book { resolve: number; armor: number; alive: boolean; placement?: number; eliminatedRound?: number; fights: Fight[] }
const flip = (o: 'win' | 'lose' | 'draw'): 'win' | 'lose' | 'draw' => (o === 'win' ? 'lose' : o === 'lose' ? 'win' : 'draw');

/** The recording a snapshot seat replays, by wave: the board for `round`, else its last one. */
function recordedBoard(seat: LobbySeatState, round: number): BoardSnapshot | null {
  const author = seat.label;
  const waves = recordedRuns().filter((b) => b.author === author && b.heroId === seat.heroId);
  if (waves.length === 0) return null;
  return waves.find((b) => b.wave === round) ?? waves[waves.length - 1]!;
}

/** What a scout card should say about a board, computed from the recording alone. */
function expectedIntel(snap: BoardSnapshot, round: number): SeatIntel {
  const counts = new Map<Tribe, number>();
  for (const m of snap.minions) {
    const d = CARD_INDEX[m.cardId]!;
    for (const t of [d.tribe, d.tribe2]) if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let top: Tribe | undefined; let n = 0;
  for (const [t, c] of counts) if (c > n) { n = c; top = t; }
  return {
    tier: snap.tier, triples: snap.triples, topTribe: top, round,
    ...(top ? { topTribeCount: n } : {}),
    ...(snap.quests?.length ? { quests: snap.quests } : {}),
    ...(snap.runes?.length ? { runes: snap.runes } : {}),
  };
}

const charge = (b: Book, n: number): void => {
  const fromArmor = Math.min(b.armor, n);
  b.armor -= fromArmor;
  b.resolve -= n - fromArmor;
};

/** The board a seat brings to `round` in the table's own fights (recording first; a generated seat asks its driver). */
function boardFor(lobby: RunLobby, seat: LobbySeatState, round: number): PreparedBoard | null {
  const d = driverFor(seat, lobby.setId);
  return d?.prepare(round) ?? d?.finalBoard?.() ?? null;
}

/** Re-resolve the round's non-player fights from the shop-time lobby: the same pairing, the same RNG stream. */
function otherFights(lobby: RunLobby, cap: number): { a: string; b: string; outcome: 'win' | 'lose' | 'draw'; toA: number; toB: number; ghostOf?: string }[] {
  const { pairs, bye } = pairRunLobby(lobby);
  const rng = makeRng(lobby.seed ^ (lobby.round * 0x51ed270b));
  const poolIds = poolFor(setIdOf({ setId: lobby.setId })).all.map((c) => c.id);
  const out: ReturnType<typeof otherFights> = [];
  const fight = (A: PreparedBoard, B: PreparedBoard): CombatResult => {
    const sa = seatCombatSide(A, lobby.round, poolIds);
    const sb = seatCombatSide(B, lobby.round, poolIds);
    return simulate(sa.minions, sb.minions, rng, CARD_INDEX, sa.state, sb.state);
  };
  for (const [a, b] of pairs) {
    if (a.id === 's0' || b.id === 's0') continue;
    const A = boardFor(lobby, a, lobby.round);
    const B = boardFor(lobby, b, lobby.round);
    if (!A || !B) continue;
    const r = fight(A, B);
    out.push({ a: a.id, b: b.id, outcome: r.result, toA: Math.min(cap, r.playerDamage), toB: Math.min(cap, r.enemyDamage ?? 0) });
  }
  if (bye && bye.id !== 's0') {
    const g = ghostFor(lobby, bye.id);
    const mine = boardFor(lobby, bye, lobby.round);
    if (g && mine) {
      const r = fight(mine, g.board);
      out.push({ a: bye.id, b: g.seat.id, outcome: r.result, toA: Math.min(cap, r.playerDamage), toB: 0, ghostOf: g.seat.id });
    }
  }
  return out;
}

/** The opponents start SHORT of health (12 Resolve, 3 Armor) so seats fall inside a dozen rounds and the rail's
 *  knockout, placement and ghost states are all exercised; the player keeps the run's own health. */
const RULES = { startingResolve: 12, startingArmor: 3 };

function playAndCheck(seed: number, heroId: string, rounds: number): { checked: number; ghosts: number; knockouts: number } {
  let run: RunState = createLobbyRun(seed, heroId, RULES);
  const lobby0 = run.lobby!;
  const book = new Map<string, Book>(lobby0.seats.map((s) => [s.id, { resolve: s.resolve, armor: s.armor, alive: true, fights: [] }]));
  let checked = 0; let ghosts = 0; let knockouts = 0;
  let guard = 0;
  for (let round = 1; round <= rounds && run.phase !== 'gameover'; round++) {
    // Shop until the bot ends its turn.
    let act = DEFAULT_BOT.act(run);
    while (act.type !== 'faceOmen' && guard++ < 50_000) { run = reduce(run, act); act = DEFAULT_BOT.act(run); }
    const L = run.lobby!;
    const where = `seed ${seed} round ${round}`;

    // ── THE SHOP-TIME RAIL ──────────────────────────────────────────────────────────────────────────────────────
    const view = lobbyRailView(L, { self: { resolve: run.resolve, armor: run.armor } });
    expect(view.round, `${where}: header round`).toBe(run.wave);
    expect(view.round).toBe(round);
    const living = [...book.values()].filter((b) => b.alive).length;
    expect(view.left, `${where}: "N left"`).toBe(living);
    const order = L.seats.map((s) => s.id);
    const expectedRows = [...book.entries()].sort(([ia, a], [ib, b]) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      const d = a.alive ? (b.resolve + b.armor) - (a.resolve + a.armor) : (a.placement ?? 99) - (b.placement ?? 99);
      return d || order.indexOf(ia) - order.indexOf(ib);
    }).map(([id]) => id);
    expect(view.rows.map((r) => r.id), `${where}: row order`).toEqual(expectedRows);
    for (const row of view.rows) {
      const b = book.get(row.id)!;
      const seat = L.seats.find((s) => s.id === row.id)!;
      expect(row.label).toBe(seat.label);
      expect(row.heroId).toBe(seat.heroId);
      expect(row.alive, `${where} ${row.id}: alive`).toBe(b.alive);
      if (b.alive) {
        expect(row.resolve, `${where} ${row.id}: Resolve`).toBe(b.resolve);
        expect(row.armor, `${where} ${row.id}: Armor`).toBe(b.armor);
        expect(row.placement).toBeUndefined();
      } else {
        expect(row.placement, `${where} ${row.id}: placement`).toBe(b.placement);
      }
      // THE ROUND HISTORY (Round / Vs / Outcome / Dmg), newest first, last three fights.
      const shown = seatResults(L, row.id, 3).map((r) => ({ round: r.round, foe: r.foeId, outcome: r.outcome, taken: r.taken, dealt: r.dealt }));
      expect(shown, `${where} ${row.id}: round history`).toEqual(b.fights.slice(-3).reverse());
      // The history's face is the foe SEAT'S hero and label.
      for (const r of seatResults(L, row.id, 3)) {
        const foe = L.seats.find((s) => s.id === r.foeId)!;
        expect(r.foeHeroId).toBe(foe.heroId);
        expect(r.foeLabel).toBe(foe.label);
      }
    }
    // THE FLOATING "-N" of the round that just closed: every standing seat that took a hit, by exactly that hit.
    if (round > 1) {
      const floats = lastRoundDamage(L);
      for (const [id, b] of book) {
        const last = b.fights.filter((f) => f.round === round - 1);
        const taken = last.reduce((n, f) => n + f.taken, 0);
        if (last.length) expect(floats[id]?.taken, `${where} ${id}: last round's damage`).toBe(taken);
      }
    }
    // SCOUTING: every opponent's card reads the board for THIS round (or the board it fell with), off its recording.
    const opp = view.opponent;
    for (const seat of L.seats) {
      if (seat.id === 's0') continue;
      const intel = railSeatIntel(L, seat, opp);
      const snapRound = seat.alive ? round : seat.eliminatedRound!;
      if (seat.kind === 'snapshot') {
        const rec = recordedBoard(seat, snapRound)!;
        expect(intel, `${where} ${seat.id}: scout card`).toEqual(expectedIntel(rec, snapRound));
      } else {
        const b = boardFor(L, seat, snapRound)!;
        expect(intel?.tier, `${where} ${seat.id}: tier`).toBe(b.tier);
      }
    }
    expect(view.rows.filter((r) => r.next).length, `${where}: one next opponent`).toBe(opp ? 1 : 0);

    // ── THE ROUND ───────────────────────────────────────────────────────────────────────────────────────────────
    const cap = roundLossCap(L.rules, L.round);
    expect(view.lossCap, `${where}: max damage`).toBe(cap);
    const others = otherFights(L, cap);
    const pending = new Map(L.seats.map((s) => [s.id, s.alive]));
    run = reduce(run, act); // End Turn: the reducer runs the player's ONE fight
    const c = run.lastCombat!;
    expect(c.initial.enemy.map((m) => m.cardId), `${where}: the foe the rail marked is the board fought`)
      .toEqual(opp!.board.minions.map((m) => m.cardId));
    run = reduce(run, { type: 'resolveCombat' });
    const N = run.lobby!;

    // Ledger: the player's fight, from the fight itself.
    const me = book.get('s0')!;
    const foe = book.get(opp!.seat.id)!;
    const myHit = c.result === 'lose' ? Math.min(cap, c.playerDamage) : 0;
    const foeHit = opp!.ghost ? 0 : (c.result === 'win' ? Math.min(cap, c.enemyDamage ?? 0) : 0);
    charge(me, myHit);
    if (!opp!.ghost) charge(foe, foeHit);
    me.fights.push({ round, foe: opp!.seat.id, outcome: c.result, taken: myHit, dealt: foeHit });
    foe.fights.push({ round, foe: 's0', outcome: flip(c.result), taken: foeHit, dealt: myHit });
    if (opp!.ghost) ghosts++;
    // …and every other pairing, re-simulated here.
    for (const f of others) {
      const A = book.get(f.a)!; const B = book.get(f.b)!;
      // Attribution: the loser is the one charged, the winner never is, a draw charges nobody.
      if (f.outcome === 'win') expect(f.toA).toBe(0);
      if (f.outcome === 'lose') expect(f.toB).toBe(0);
      if (f.outcome === 'draw') expect(f.toA + f.toB).toBe(0);
      charge(A, f.toA);
      if (!f.ghostOf) charge(B, f.toB);
      A.fights.push({ round, foe: f.b, outcome: f.outcome, taken: f.toA, dealt: f.toB });
      B.fights.push({ round, foe: f.a, outcome: flip(f.outcome), taken: f.toB, dealt: f.toA });
      if (f.ghostOf) ghosts++;
    }
    // Knockouts and shared placements.
    const fallen = [...book.entries()].filter(([id, b]) => pending.get(id) && b.resolve + b.armor <= 0);
    for (const [, b] of fallen) { b.alive = false; b.eliminatedRound = round; }
    const standing = [...book.values()].filter((b) => b.alive).length;
    if (standing === 0) throw new Error(`${where}: a wipeout round; pick another seed`);
    for (const [, b] of fallen) b.placement = standing + fallen.length;
    if (standing <= 1) for (const b of book.values()) if (b.alive) b.placement = 1;
    knockouts += fallen.length;
    // The table agrees with the ledger the moment it settles.
    for (const s of N.seats) {
      const b = book.get(s.id)!;
      expect(s.alive, `${where} ${s.id}: alive after settle`).toBe(b.alive);
      if (b.alive) expect([s.resolve, s.armor], `${where} ${s.id}: health after settle`).toEqual([b.resolve, b.armor]);
    }
    // ...and the player's own row reads the run, which equals the seat (never negative).
    expect([run.resolve, run.armor]).toEqual([Math.max(0, me.resolve), Math.max(0, me.armor)]);
    if (run.phase === 'gameover') break;
    checked++;
  }
  return { checked, ghosts, knockouts };
}

describe('the lobby rail is accurate, every field, every seat, every round (R-LOBBY-RAIL-01)', () => {
  it('seats seven recorded player runs', () => {
    const run = createLobbyRun(21, 'drakko', RULES);
    expect(run.lobby!.seats.filter((s) => s.kind === 'snapshot')).toHaveLength(7);
  });

  for (const seed of [21, 34, 55]) {
    it(`seed ${seed}: 12 rounds of a real lobby`, () => {
      const r = playAndCheck(seed, 'drakko', 12);
      expect(r.checked, 'the lobby must run at least six checked rounds').toBeGreaterThanOrEqual(6);
    }, 120_000);
  }

  it('the harness actually reaches knockouts and ghost fights (not vacuous)', () => {
    let ghosts = 0; let knockouts = 0;
    for (const seed of [21, 34, 55]) { const r = playAndCheck(seed, 'drakko', 16); ghosts += r.ghosts; knockouts += r.knockouts; }
    expect(knockouts).toBeGreaterThan(0);
    expect(ghosts).toBeGreaterThan(0);
  }, 240_000);

  it('a recorded seat this client cannot load shows its RECORDED read on every row, the next opponent included', () => {
    // A live-game WATCHER whose own pool lacks the watched game's recordings drives those seats with generated
    // stand-ins. The next opponent's card used to print the stand-in's invented board (tier, build, runes the player
    // never had) while every other row printed the seat's recorded read.
    const run = createLobbyRun(21, 'drakko', RULES);
    const lobby = run.lobby!;
    const seat = lobby.seats.find((s) => s.kind === 'snapshot')!;
    resetLobbyDrivers([seat]);
    seat.runKey = `${seat.runKey}|not-in-this-pool`;
    seat.intel = { tier: 4, triples: 1, round: 3, topTribe: 'beast', topTribeCount: 3 };
    const standIn = driverFor(seat, lobby.setId)!;
    expect(standIn.realPlayer, 'the seat is driven by a stand-in').toBeUndefined();
    const board = standIn.prepare(lobby.round)!;
    expect(railSeatIntel(lobby, seat, { seat, board }), 'as the next opponent').toBe(seat.intel);
    expect(railSeatIntel(lobby, seat, null), 'as any other row').toBe(seat.intel);
    resetLobbyDrivers([seat]);
  });

  it('a row never prints negative health (the wipeout guard revives its best seat at or below zero)', () => {
    const run = createLobbyRun(21, 'drakko', RULES);
    const lobby = run.lobby!;
    const s = lobby.seats[3]!;
    s.resolve = -4; s.armor = 0;
    const row = lobbyRailView(lobby).rows.find((r) => r.id === s.id)!;
    expect([row.resolve, row.armor]).toEqual([0, 0]);
  });
});
