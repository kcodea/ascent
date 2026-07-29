import type { BoardMinion, CombatOutcome, CombatResult } from '@game/core';
import { combatSide, makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { HEROES } from '../heroes';
import { lossDamageCap } from '../reducer';
import { createRun, type RunState } from '../state';
import { botSeat, hybridSeat } from './seats';
import type { LobbyEncounter, LobbyRules, PreparedBoard, SeatDriver } from './types';
import { DEFAULT_LOBBY_RULES } from './lobby';

/**
 * THE PLAYER'S LOBBY — the serializable half.
 *
 * `LobbyState` (lobby.ts) holds live `SeatDriver` objects, which are closures. `RunState` is deep-cloned on
 * every dispatch and persisted, so it cannot hold those. This is the shape that CAN live on a run: plain data
 * describing each seat, with drivers rebuilt on demand from `(kind, seed, heroId)`.
 *
 * That works because every driver is a pure function of its seed and hero — the same inputs always replay the
 * same boards — so a reloaded run reconstructs byte-identical opponents rather than storing them. It costs a
 * recompute on load and buys determinism, save/replay support, and a `RunState` that stays cloneable.
 */
export interface LobbySeatState {
  id: string;
  label: string;
  heroId: string;
  kind: 'player' | 'hybrid' | 'bot';
  /** The seed its driver is rebuilt from. Unused for the player seat, whose board is the live run. */
  seed: number;
  resolve: number;
  armor: number;
  alive: boolean;
  placement?: number;
  eliminatedRound?: number;
}

export interface RunLobby {
  version: 1;
  seed: number;
  round: number;
  /** `seats[0]` is always the live player. */
  seats: LobbySeatState[];
  encounters: LobbyEncounter[];
  quietRounds: number;
  finished: boolean;
  rules: LobbyRules;
}

/**
 * Drivers are expensive to build (a recorded seat autoplays a whole run), so they are cached per
 * `(kind, seed, heroId)`. Never persisted — rebuilt on load, which is deterministic because every driver is a
 * pure function of its seed and hero.
 *
 * But a LIVE driver is stateful: it advances its own run as rounds are asked for. Two lobbies started from the
 * same seed derive the same seat seeds, so without a reset the second would inherit drivers already advanced to
 * the first lobby's final round and replay something different — measured as a determinism failure across two
 * same-seed lobbies in one process. `createRunLobby` therefore evicts its seats' drivers, so a fresh lobby
 * always starts from fresh opponents.
 */
const DRIVERS = new Map<string, SeatDriver>();

const driverKey = (seat: LobbySeatState): string => `${seat.kind}:${seat.seed}:${seat.heroId}`;

/** Evict cached drivers for these seats, so a newly created lobby starts them from round 1. */
export function resetLobbyDrivers(seats: readonly LobbySeatState[]): void {
  for (const seat of seats) DRIVERS.delete(driverKey(seat));
}

export function driverFor(seat: LobbySeatState): SeatDriver | null {
  if (seat.kind === 'player') return null; // the live run supplies the player's board
  const key = driverKey(seat);
  let d = DRIVERS.get(key);
  if (!d) {
    d = seat.kind === 'bot' ? botSeat(seat.seed, seat.heroId, seat.label) : hybridSeat(seat.seed, seat.heroId, seat.label);
    DRIVERS.set(key, d);
  }
  return d;
}

/** Build the 7 opponent seats for a player's lobby. Deterministic from the lobby seed. */
export function createRunLobby(seed: number, playerHeroId: string, rules: Partial<LobbyRules> = {}): RunLobby {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  const heroes = HEROES.filter((h) => !h.wip && h.id !== playerHeroId);
  const seats: LobbySeatState[] = [{
    id: 's0', label: 'You', heroId: playerHeroId, kind: 'player', seed,
    resolve: r.startingResolve, armor: r.startingArmor, alive: true,
  }];
  // Every seat must be able to FIELD A BOARD, or it silently sits rounds out and the table quietly shrinks —
  // measured at round 1, where a quarter of the fights never happened. Today's balance bot cannot play some
  // heroes at all (Disco Dan's turn-1 tier-locked Discovers leave it with nothing playable), so a hero whose
  // driver produces no round-1 board is skipped in favour of the next. Drivers are cached, so the probe costs
  // one build each and only at lobby creation.
  //
  // This is a BOT limitation, not a lobby rule: when a bot can play every hero, the skip simply stops firing.
  let picked = 0;
  for (let offset = 0; picked < r.seatCount - 1 && offset < heroes.length * 2; offset++) {
    const hero = heroes[(seed + offset) % heroes.length]!;
    if (seats.some((x) => x.heroId === hero.id)) continue;
    const seat: LobbySeatState = {
      id: `s${picked + 1}`,
      label: hero.name,
      heroId: hero.id,
      // Hybrid by default (owner call): a recorded run for authenticity, handed to a live bot when it runs dry.
      kind: 'hybrid',
      seed: seed * 1000 + picked + 1,
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
    };
    const d = driverFor(seat);
    if (!d?.prepare(1) && !d?.finalBoard?.()) continue; // this hero can't be driven — try the next
    seats.push(seat);
    picked++;
  }
  // The probe above advanced live drivers to round 1; drop them so the lobby starts every seat clean.
  resetLobbyDrivers(seats);
  return { version: 1, seed, round: 1, seats, encounters: [], quietRounds: 0, finished: false, rules: r };
}

/** Deterministic pairing over the living seats. Mirrors `pairSeats` but on the serializable shape. */
export function pairRunLobby(lobby: RunLobby): { pairs: [LobbySeatState, LobbySeatState][]; bye: LobbySeatState | null } {
  const rng = makeRng(lobby.seed ^ (lobby.round * 0x9e3779b9));
  const pool = lobby.seats.filter((s) => s.alive);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const met = new Map<string, number>();
  for (const e of lobby.encounters) {
    for (const k of [`${e.a}|${e.b}`, `${e.b}|${e.a}`]) met.set(k, (met.get(k) ?? 0) + 1);
  }
  const pairs: [LobbySeatState, LobbySeatState][] = [];
  const taken = new Set<string>();
  for (const a of pool) {
    if (taken.has(a.id)) continue;
    let best: LobbySeatState | null = null;
    let bestScore = Infinity;
    for (const b of pool) {
      if (b.id === a.id || taken.has(b.id)) continue;
      const score = met.get(`${a.id}|${b.id}`) ?? 0;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (!best) continue;
    taken.add(a.id); taken.add(best.id);
    pairs.push([a, best]);
  }
  return { pairs, bye: pool.find((s) => !taken.has(s.id)) ?? null };
}

/** Who the player faces this round, and the board they bring. `null` = the player has a bye. */
export function playerOpponent(lobby: RunLobby): { seat: LobbySeatState; board: PreparedBoard } | null {
  const { pairs } = pairRunLobby(lobby);
  const pair = pairs.find(([a, b]) => a.id === 's0' || b.id === 's0');
  if (!pair) return null;
  const foe = pair[0].id === 's0' ? pair[1] : pair[0];
  const board = driverFor(foe)?.prepare(lobby.round) ?? driverFor(foe)?.finalBoard?.() ?? null;
  return board ? { seat: foe, board } : null;
}

/** Apply damage through Armor then Resolve. */
function hit(seat: LobbySeatState, amount: number): void {
  const left = Math.max(0, amount);
  const fromArmor = Math.min(seat.armor, left);
  seat.armor -= fromArmor;
  seat.resolve -= left - fromArmor;
}

/**
 * Settle one lobby round from the PLAYER's already-resolved combat, then resolve every other pairing.
 *
 * The player's fight is authoritative and already happened (the reducer ran it, the UI replayed it), so its two
 * damage numbers are read straight off that one result — never re-simulated. Combat is not symmetric (measured:
 * the winner flips 22% of the time when the sides are swapped), so a second resolve would contradict what the
 * player just watched.
 */
export function settleRunLobbyRound(lobby: RunLobby, playerResult: CombatResult): RunLobby {
  if (lobby.finished) return lobby;
  const { pairs, bye } = pairRunLobby(lobby);
  const rng = makeRng(lobby.seed ^ (lobby.round * 0x51ed270b));
  const eliminated: LobbySeatState[] = [];
  const hpBefore = new Map(lobby.seats.map((s) => [s.id, s.armor + s.resolve]));
  const pressure = lobby.quietRounds >= lobby.rules.pressureAfterQuietRounds
    ? lobby.quietRounds - lobby.rules.pressureAfterQuietRounds + 1
    : 0;
  const cap = lossDamageCap(lobby.round);

  for (const [a, b] of pairs) {
    const playerSide = a.id === 's0' ? a : b.id === 's0' ? b : null;
    let outcome: CombatOutcome;
    let dmgToA: number;
    let dmgToB: number;

    if (playerSide) {
      // The player's own fight — already resolved. `playerResult` is from the PLAYER's perspective.
      const foeIsB = b.id !== 's0';
      const playerDmg = Math.min(cap, playerResult.playerDamage);
      const foeDmg = Math.min(cap, playerResult.enemyDamage ?? 0);
      outcome = foeIsB ? playerResult.result : (playerResult.result === 'win' ? 'lose' : playerResult.result === 'lose' ? 'win' : 'draw');
      dmgToA = foeIsB ? playerDmg : foeDmg;
      dmgToB = foeIsB ? foeDmg : playerDmg;
    } else {
      const boardA = driverFor(a)?.prepare(lobby.round) ?? driverFor(a)?.finalBoard?.() ?? null;
      const boardB = driverFor(b)?.prepare(lobby.round) ?? driverFor(b)?.finalBoard?.() ?? null;
      if (!boardA || !boardB) {
        lobby.encounters.push({ round: lobby.round, a: a.id, b: b.id, outcome: 'draw', damageToA: 0, damageToB: 0, fought: false });
        continue;
      }
      const r = simulate(boardA.minions, boardB.minions, rng, CARD_INDEX,
        combatSide({ tier: boardA.tier }), combatSide({ tier: boardB.tier }));
      outcome = r.result;
      dmgToA = Math.min(cap, r.playerDamage);
      dmgToB = Math.min(cap, r.enemyDamage ?? 0);
    }

    const drawn = outcome === 'draw';
    dmgToA += drawn || outcome === 'lose' ? pressure : 0;
    dmgToB += drawn || outcome === 'win' ? pressure : 0;
    hit(a, dmgToA);
    hit(b, dmgToB);
    for (const [seat, taken, dealt] of [[a, dmgToA, dmgToB], [b, dmgToB, dmgToA]] as const) {
      driverFor(seat)?.settle({
        round: lobby.round,
        outcome: seat.id === a.id ? outcome : (outcome === 'win' ? 'lose' : outcome === 'lose' ? 'win' : 'draw'),
        damageTaken: taken, damageDealt: dealt,
        seatResolve: seat.resolve, seatArmor: seat.armor,
      });
      if (seat.alive && seat.armor + seat.resolve <= 0) {
        seat.alive = false;
        seat.eliminatedRound = lobby.round;
        eliminated.push(seat);
      }
    }
    lobby.encounters.push({ round: lobby.round, a: a.id, b: b.id, outcome, damageToA: dmgToA, damageToB: dmgToB, fought: true });
  }
  if (bye) lobby.encounters.push({ round: lobby.round, a: bye.id, b: bye.id, outcome: 'draw', damageToA: 0, damageToB: 0, bye: bye.id, fought: false });

  // Never leave a round with nobody standing (see `resolveRound`'s wipeout guard).
  if (eliminated.length > 0 && lobby.seats.every((s) => !s.alive)) {
    const winner = [...eliminated].sort((x, y) => (hpBefore.get(y.id) ?? 0) - (hpBefore.get(x.id) ?? 0) || x.id.localeCompare(y.id))[0]!;
    winner.alive = true;
    winner.eliminatedRound = undefined;
    eliminated.splice(eliminated.indexOf(winner), 1);
  }

  const remaining = lobby.seats.filter((s) => s.alive).length;
  for (const seat of eliminated) seat.placement = remaining + eliminated.length;
  lobby.quietRounds = eliminated.length > 0 ? 0 : lobby.quietRounds + 1;
  lobby.round += 1;

  const living = lobby.seats.filter((s) => s.alive);
  if (living.length <= 1 || lobby.round > lobby.rules.maxRounds) {
    for (const s of living) s.placement = 1;
    lobby.finished = true;
  }
  return lobby;
}

/** The player's seat — always index 0. */
export const playerLobbySeat = (lobby: RunLobby): LobbySeatState => lobby.seats[0]!;

/** Is the player out? Their run ends when their seat does, whatever the lobby does afterwards. */
export const playerEliminated = (lobby: RunLobby): boolean => !playerLobbySeat(lobby).alive;

/** The board a lobby opponent brings this round — for the recruit-phase opponent preview. */
export function lobbyOpponentBoard(lobby: RunLobby): { seat: LobbySeatState; minions: BoardMinion[]; tier: number } | null {
  const next = playerOpponent(lobby);
  return next ? { seat: next.seat, minions: next.board.minions, tier: next.board.tier } : null;
}

/**
 * Start a run that is a seat in an 8-seat lobby: ordinary Ascent play, no course clock, and the run ends when
 * the player's SEAT is knocked out rather than after 17 rounds.
 */
export function createLobbyRun(seed: number, heroId: string, rules: Partial<LobbyRules> = {}): RunState {
  const run = createRun(seed, heroId, 'lobby');
  const lobby = createRunLobby(seed, heroId, rules);
  const me = lobby.seats[0]!;
  // The seat's pools ARE the run's health, so the HUD and every health-aware effect read one number.
  me.resolve = run.resolve;
  me.armor = run.armor;
  return { ...run, lobby };
}
