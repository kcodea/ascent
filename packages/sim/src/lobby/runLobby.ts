import type { BoardMinion, CombatOutcome, CombatResult, Tribe } from '@game/core';
import type { BoardSnapshot } from '../snapshot';
import { combatSide, makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { HEROES } from '../heroes';
import { lossDamageCap } from '../reducer';
import { createRun, type RunState } from '../state';
import { botSeat, hybridSeat, type SeatPolicy } from './seats';
import { playerRunByKey, playerRunsFrom, snapshotSeat } from './snapshotSeats';
import { handleKeyOf, uniqueHandleFor } from './handles';
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
  kind: 'player' | 'hybrid' | 'bot' | 'snapshot';
  /** `snapshot` seats only: which real player run drives this seat. Stored rather than the boards themselves so
   *  the lobby stays small and serializable; resolved against the registered pool by `driverFor`. */
  runKey?: string;
  /** The seed its driver is rebuilt from. Unused for the player seat, whose board is the live run. */
  seed: number;
  resolve: number;
  armor: number;
  alive: boolean;
  /** Which policy drives this seat. Absent = the default in `botSeat`; 'legacy' selects the old greedy bot. */
  policy?: SeatPolicy;
  placement?: number;
  eliminatedRound?: number;
  /** Scouting intel about the board this seat last fielded — what the rail's hover card reads.
   *
   *  RECORDED at settle, never derived on demand. `prepare()` costs 200-900 ms for a bot seat, so calling it
   *  from a render to answer "what tier is seat 5 on" would stall the shop phase once per hovered seat. Settle
   *  already prepares every board, so this is free there. */
  intel?: SeatIntel;
}

/** What one seat's last-fielded board looked like, for the rail's hover card. */
export interface SeatIntel {
  /** Tavern tier the board was captured at. */
  tier: number;
  /** Triples made this run. */
  triples: number;
  /** The board's DOMINANT tribe — the one most of its bodies share, which is what reads as "what they're
   *  playing". Absent when the board is all-neutral or empty. */
  topTribe?: Tribe;
  /** Round the intel is from, so a stale read is visible rather than presented as current. */
  round: number;
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

const driverKey = (seat: LobbySeatState): string => `${seat.kind}:${seat.seed}:${seat.heroId}:${seat.runKey ?? ''}`;

/** Evict cached drivers for these seats, so a newly created lobby starts them from round 1. */
export function resetLobbyDrivers(seats: readonly LobbySeatState[]): void {
  for (const seat of seats) DRIVERS.delete(driverKey(seat));
}

/**
 * Build ONE seat's driver and its board for the CURRENT round, ahead of the round that needs it.
 *
 * A hybrid seat's recording is an autoplayed run (~100ms), and it is built lazily so lobby creation stays off
 * the hero-select transition. Lazily, though, means "all seven at once during the first combat" — the hitch
 * moves rather than goes. The UI calls this per seat in idle time during the shop phase, so by the time the
 * round resolves the work is already done. It also covers a RESUMED lobby, whose driver cache is empty: those
 * seats have to be rebuilt AND re-advanced to wherever the lobby had got to.
 *
 * Safe to call any number of times, in any order: a driver is cached, and asking for a round it has already
 * reached is a no-op. Doing it early can't change what the lobby produces — this is exactly the request the
 * round itself would make.
 */
export function warmLobbySeat(lobby: RunLobby, index: number): void {
  const seat = lobby.seats[index];
  if (!seat || seat.kind === 'player' || !seat.alive) return;
  const d = driverFor(seat);
  if (!d) return;
  if (!d.prepare(lobby.round)) d.finalBoard?.();
}

export function driverFor(seat: LobbySeatState): SeatDriver | null {
  if (seat.kind === 'player') return null; // the live run supplies the player's board
  const key = driverKey(seat);
  let d = DRIVERS.get(key);
  if (!d) {
    if (seat.kind === 'snapshot') {
      // A restored lobby can land in a session whose pool doesn't hold that run (different device, pruned
      // patch, backend offline). Falling back to a bot keeps the table full instead of silently dropping a
      // seat and changing the shape of someone's saved game.
      const run = seat.runKey ? playerRunByKey(seat.runKey) : null;
      d = run ? snapshotSeat(run, seat.policy) : hybridSeat(seat.seed, seat.heroId, seat.label, seat.policy);
    } else {
      d = seat.kind === 'bot'
        ? botSeat(seat.seed, seat.heroId, seat.label, seat.policy)
        : hybridSeat(seat.seed, seat.heroId, seat.label, seat.policy);
    }
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
  // Handles must be unique across the table — two seats with one name reads as a rendering bug.
  const taken = new Set<string>(['you']);
  // EVERY seat whose driver we build, seated or not. The probe below caches a driver for candidates it then
  // rejects, and evicting only the seats that made it left those behind — a live driver already advanced to
  // round 1, kept for the rest of the session.
  const probed: LobbySeatState[] = [];
  /** Can this seat field a board? Cheap where the driver offers a cheap answer (see `SeatDriver.canFieldBoard`). */
  const canPlay = (seat: LobbySeatState): boolean => {
    probed.push(seat);
    const d = driverFor(seat);
    if (d?.canFieldBoard) return d.canFieldBoard();
    return !!(d?.prepare(1) ?? d?.finalBoard?.());
  };

  // REAL PLAYER RUNS FIRST (owner call 2026-07-29). Every seat used to be generated; now any run in the
  // registered pool with enough material can hold one, replaying that player's actual boards in their actual
  // order before a bot inherits the seat. Capped so the table never becomes entirely other people's ghosts —
  // the mix is what makes a lobby feel populated rather than pre-recorded.
  //
  // Seeded rotation over a deterministically-ordered list: the same lobby seed always seats the same runs, so
  // a restored or replayed lobby is identical.
  const available = playerRunsFrom();
  // ONE ACTIVE SNAPSHOT PER PLAYER (owner rule 2026-07-29). Deduping on `runKey` alone was not enough: a key is
  // `author|hero|seed`, so two DIFFERENT runs by the same person are two different keys and both took seats —
  // the reported lobby with "someone crazytown okay" sitting at the table twice. Your OWN runs are not excluded
  // (you may face yourself for now), they just also cap at one seat.
  //
  // Author-less runs can't be deduped by name — nothing identifies who played them — so they stay distinct and
  // are only deduped by run key. That is a known limitation of unnamed uploads, not a rule.
  const seatedAuthors = new Set<string>();
  const maxSnapshotSeats = Math.min(r.snapshotSeats ?? Math.floor((r.seatCount - 1) / 2), available.length);
  for (let i = 0; i < available.length && picked < r.seatCount - 1 && seats.filter((x) => x.kind === 'snapshot').length < maxSnapshotSeats; i++) {
    const run = available[(seed + i * 7) % available.length]!;
    if (seats.some((x) => x.runKey === run.key)) continue; // never seat the same run twice
    const who = run.author && run.author !== 'anon' ? run.author.toLowerCase() : null;
    if (who && seatedAuthors.has(who)) continue; // this player already holds a seat
    const seat: LobbySeatState = {
      id: `s${picked + 1}`,
      // A real author's name when the run has one; otherwise a generated handle. 142 of the pool's 664 boards
      // carry no author, and labelling those "run 1534" leaked the seed and read as debug output.
      label: run.author && run.author !== 'anon' ? run.author : uniqueHandleFor(handleKeyOf(run.key), taken),
      heroId: run.heroId,
      kind: 'snapshot',
      runKey: run.key,
      seed: seed * 1000 + picked + 1,
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
    };
    if (!canPlay(seat)) continue; // no round-1 board — skip rather than seat a ghost
    taken.add(seat.label.toLowerCase());
    if (who) seatedAuthors.add(who);
    seats.push(seat);
    picked++;
  }

  for (let offset = 0; picked < r.seatCount - 1 && offset < heroes.length * 2; offset++) {
    const hero = heroes[(seed + offset) % heroes.length]!;
    if (seats.some((x) => x.heroId === hero.id)) continue;
    const seat: LobbySeatState = {
      id: `s${picked + 1}`,
      // A HANDLE, not the hero's name. "Nadja" read as scenery and made the real snapshot seats obvious by
      // contrast, since those carry a player's actual name; the hero is still visible in the seat's portrait.
      label: uniqueHandleFor(handleKeyOf(`${seed}|${hero.id}|${picked}`), taken),
      heroId: hero.id,
      // Hybrid by default (owner call): a recorded run for authenticity, handed to a live bot when it runs dry.
      kind: 'hybrid',
      seed: seed * 1000 + picked + 1,
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
    };
    if (!canPlay(seat)) continue; // this hero can't be driven — try the next
    taken.add(seat.label.toLowerCase());
    seats.push(seat);
    picked++;
  }
  // The probe above advanced live drivers to round 1; drop them so the lobby starts every seat clean. Every
  // PROBED seat, not just the seated ones — a rejected candidate's driver is cached too.
  resetLobbyDrivers(probed);
  return { version: 1, seed, round: 1, seats, encounters: [], quietRounds: 0, finished: false, rules: r };
}

/** Deterministic pairing over the living seats. Mirrors `pairSeats` but on the serializable shape. */
/** You may not face the same seat again within this many rounds (owner rule 2026-07-29). */
export const NO_REPEAT_ROUNDS = 3;

/**
 * Pairing for one round: a seeded shuffle, then a greedy pass that prefers the opponent you have met least
 * often and least recently.
 *
 * The hard rule is the recency one: **you never face the same seat within 3 rounds** — unless the table is too
 * small to avoid it. That exception is why it's a preference layered over a fallback rather than a filter: once
 * the lobby is down to a top 4 (or a final 2), every legal opponent is someone you just fought, and a rule that
 * refuses to pair them would deadlock the round. So a seat inside the window is scored as heavily penalised but
 * still selectable, and it only gets picked when nothing else is left.
 */
export function pairRunLobby(lobby: RunLobby): { pairs: [LobbySeatState, LobbySeatState][]; bye: LobbySeatState | null } {
  const rng = makeRng(lobby.seed ^ (lobby.round * 0x9e3779b9));
  const pool = lobby.seats.filter((s) => s.alive);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const met = new Map<string, number>();
  const lastMet = new Map<string, number>();
  for (const e of lobby.encounters) {
    if (e.bye) continue; // a bye is not a meeting
    for (const k of [`${e.a}|${e.b}`, `${e.b}|${e.a}`]) {
      met.set(k, (met.get(k) ?? 0) + 1);
      lastMet.set(k, Math.max(lastMet.get(k) ?? 0, e.round));
    }
  }
  const cost = (a: LobbySeatState, b: LobbySeatState): number => {
    const key = `${a.id}|${b.id}`;
    const since = lobby.round - (lastMet.get(key) ?? -Infinity);
    // Inside the no-repeat window: a huge penalty, not a ban — a top-4 table has no other option.
    const recent = since < NO_REPEAT_ROUNDS ? 1e6 * (NO_REPEAT_ROUNDS - since) : 0;
    return recent + (met.get(key) ?? 0) * 100 - Math.min(since, 99);
  };

  // EXHAUSTIVE matching, not a greedy pass. Greedy honours the no-repeat rule for whoever it happens to pair
  // FIRST and then strands the rest: measured on seed 6, s1 and s4 were forced into a rematch one round apart
  // while a violation-free arrangement of the same table existed. At 8 seats the whole search is ~105
  // pairings, so the optimal answer is simply cheap — and "unless there is no other option" then means exactly
  // that, rather than "unless the greedy order painted us into a corner".
  let bestPairs: [LobbySeatState, LobbySeatState][] = [];
  let bestCost = Infinity;
  const search = (rest: LobbySeatState[], acc: [LobbySeatState, LobbySeatState][], total: number): void => {
    if (total >= bestCost) return; // branch can't beat what we have
    if (rest.length < 2) {
      bestCost = total;
      bestPairs = [...acc];
      return;
    }
    const [head, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      const partner = others[i]!;
      acc.push([head!, partner]);
      search(others.filter((_, j) => j !== i), acc, total + cost(head!, partner));
      acc.pop();
    }
  };
  // The bye (odd count) is decided first, so the search only ever sees an even table. Prefer to bye whoever has
  // had the FEWEST byes, so the ghost round rotates instead of landing on the same seat.
  const byeCount = new Map<string, number>();
  for (const e of lobby.encounters) if (e.bye) byeCount.set(e.bye, (byeCount.get(e.bye) ?? 0) + 1);
  let bye: LobbySeatState | null = null;
  let field = pool;
  if (pool.length % 2 === 1) {
    bye = [...pool].sort((a, b) => (byeCount.get(a.id) ?? 0) - (byeCount.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0]!;
    field = pool.filter((x) => x.id !== bye!.id);
  }
  search(field, [], 0);
  return { pairs: bestPairs, bye };
}

/**
 * The GHOST a seat faces when the living count is odd (owner rule 2026-07-29).
 *
 * Sitting the odd seat out was a free round — it took no damage and dealt none, which at 7, 5 and 3 alive is a
 * meaningful and arbitrary advantage. Instead it fights the most recently eliminated seat's board **from the
 * round that seat died**, so the ghost is a real board at a real point in its climb rather than a synthetic
 * filler. Damage applies to the living seat normally; the ghost is already out and takes nothing.
 *
 * Returns `null` only before the first elimination, when there is no ghost to raise — the odd seat then genuinely
 * sits out. In an 8-seat lobby that can't happen, since the count is only odd after someone has died.
 */
export function ghostFor(lobby: RunLobby): { seat: LobbySeatState; board: PreparedBoard } | null {
  const fallen = lobby.seats
    // Strictly BEFORE this round: the pairs and the bye resolve simultaneously, so a seat knocked out in this
    // very round hasn't fallen yet from the bye's point of view — raising it as its own round's ghost would be
    // fighting someone who is still, as far as this round is concerned, alive.
    .filter((x) => !x.alive && x.eliminatedRound !== undefined && x.eliminatedRound < lobby.round)
    .sort((a, b) => (b.eliminatedRound ?? 0) - (a.eliminatedRound ?? 0));
  for (const seat of fallen) {
    const d = driverFor(seat);
    // The board it had the round it DIED — not its final recorded board, and not a fresh one for this round.
    const board = d?.prepare(seat.eliminatedRound!) ?? d?.finalBoard?.() ?? null;
    if (board) return { seat, board };
  }
  return null;
}

/** Who the player faces this round, and the board they bring. `null` = the player has a bye. */
export function playerOpponent(lobby: RunLobby): { seat: LobbySeatState; board: PreparedBoard; ghost?: boolean } | null {
  const { pairs, bye } = pairRunLobby(lobby);
  const pair = pairs.find(([a, b]) => a.id === 's0' || b.id === 's0');
  if (!pair) {
    // Holding the bye: face the most recently fallen seat's board instead of sitting the round out.
    if (bye?.id !== 's0') return null;
    const g = ghostFor(lobby);
    return g ? { seat: g.seat, board: g.board, ghost: true } : null;
  }
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
/**
 * Read a prepared board as scouting intel.
 *
 * The dominant tribe is counted off the BODIES rather than taken from the snapshot's `tribes` field: that field
 * is the run's five ACTIVE tribes (what the shop could offer), which is a different question from what the
 * board in front of you is actually made of. A Dragon run holding six Beasts reads as Beasts here, correctly.
 */
export function boardIntel(board: PreparedBoard, round: number): SeatIntel {
  const counts = new Map<Tribe, number>();
  for (const m of board.minions) {
    const def = CARD_INDEX[m.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) {
      if (!t || t === 'neutral') continue; // neutral is the absence of a tribe, not a tribe to lead with
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let topTribe: Tribe | undefined;
  let best = 0;
  for (const [t, n] of counts) if (n > best) { best = n; topTribe = t; }
  return { tier: board.tier, triples: board.snapshot?.triples ?? 0, topTribe, round };
}

/** One past fight from a seat's point of view — the rail's "last 3 results" list. */
export interface SeatResult {
  round: number;
  foeLabel: string;
  outcome: CombatOutcome;
  dealt: number;
  taken: number;
}

/**
 * The last `n` fights this seat actually FOUGHT, newest first.
 *
 * Byes and couldn't-field-a-board rounds are filtered out: `fought: false` exists precisely because a 0-damage
 * draw and a seat that never showed up are indistinguishable otherwise, and listing the latter as a result
 * would read as a stalemate that never happened.
 */
export function seatResults(lobby: RunLobby, seatId: string, n = 3): SeatResult[] {
  const label = (id: string): string => lobby.seats.find((s) => s.id === id)?.label ?? id;
  const out: SeatResult[] = [];
  for (let i = lobby.encounters.length - 1; i >= 0 && out.length < n; i--) {
    const e = lobby.encounters[i]!;
    if (!e.fought || (e.a !== seatId && e.b !== seatId)) continue;
    const isA = e.a === seatId;
    out.push({
      round: e.round,
      foeLabel: label(isA ? e.b : e.a),
      // `outcome` is written from A's side, so B reads it inverted.
      outcome: isA ? e.outcome : (e.outcome === 'win' ? 'lose' : e.outcome === 'lose' ? 'win' : 'draw'),
      dealt: isA ? e.damageToB : e.damageToA,
      taken: isA ? e.damageToA : e.damageToB,
    });
  }
  return out;
}

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
      // Free intel: these boards are already built for the fight, so reading them costs nothing extra.
      if (boardA) a.intel = boardIntel(boardA, lobby.round);
      if (boardB) b.intel = boardIntel(boardB, lobby.round);
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
  // THE ODD SEAT FIGHTS A GHOST rather than taking a free round. The player's own ghost fight was already
  // resolved by the reducer (it goes through `playerOpponent` like any other opponent), so only a NON-player
  // bye is resolved here. The ghost is already eliminated and settles nothing.
  if (bye) {
    const ghost = ghostFor(lobby);
    const board = ghost ? ghost.board : null;
    const mine = bye.id === 's0' ? null : (driverFor(bye)?.prepare(lobby.round) ?? driverFor(bye)?.finalBoard?.() ?? null);
    if (bye.id !== 's0' && board && mine) {
      const r = simulate(mine.minions, board.minions, rng, CARD_INDEX,
        combatSide({ tier: mine.tier }), combatSide({ tier: board.tier }));
      const drawn = r.result === 'draw';
      const dmg = Math.min(cap, r.playerDamage) + (drawn || r.result === 'lose' ? pressure : 0);
      hit(bye, dmg);
      driverFor(bye)?.settle({
        round: lobby.round, outcome: r.result, damageTaken: dmg, damageDealt: 0,
        seatResolve: bye.resolve, seatArmor: bye.armor,
      });
      if (bye.alive && bye.armor + bye.resolve <= 0) {
        bye.alive = false;
        bye.eliminatedRound = lobby.round;
        eliminated.push(bye);
      }
      lobby.encounters.push({ round: lobby.round, a: bye.id, b: ghost!.seat.id, outcome: r.result, damageToA: dmg, damageToB: 0, bye: bye.id, fought: true });
    } else if (bye.id === 's0' && board) {
      // The PLAYER holds the bye: their ghost fight was already resolved by the reducer and is in
      // `playerResult`, so it settles from that rather than being re-simulated — the same one-fight-one-truth
      // rule as any other round. Without this the player took a free round whenever the count went odd.
      const drawn = playerResult.result === 'draw';
      const dmg = Math.min(cap, playerResult.playerDamage) + (drawn || playerResult.result === 'lose' ? pressure : 0);
      hit(bye, dmg);
      if (bye.alive && bye.armor + bye.resolve <= 0) {
        bye.alive = false;
        bye.eliminatedRound = lobby.round;
        eliminated.push(bye);
      }
      lobby.encounters.push({ round: lobby.round, a: bye.id, b: ghost!.seat.id, outcome: playerResult.result, damageToA: dmg, damageToB: 0, bye: bye.id, fought: true });
    } else {
      // No ghost yet (nobody has been eliminated) — a genuine sit-out.
      lobby.encounters.push({ round: lobby.round, a: bye.id, b: bye.id, outcome: 'draw', damageToA: 0, damageToB: 0, bye: bye.id, fought: false });
    }
  }

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
export function lobbyOpponentBoard(
  lobby: RunLobby,
): { seat: LobbySeatState; minions: BoardMinion[]; tier: number; snapshot?: BoardSnapshot } | null {
  const next = playerOpponent(lobby);
  return next
    ? { seat: next.seat, minions: next.board.minions, tier: next.board.tier, snapshot: next.board.snapshot }
    : null;
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

/**
 * What each seat took and dealt in the round that just finished.
 *
 * `lobby.round` has already advanced by the time the shop reopens, so "last round" is `round - 1`. Returned per
 * seat id so the table can print the number against the seat it happened to — a health bar that silently drops
 * tells you something changed but not how much, and how much is the whole read on whether you're winning.
 */
export function lastRoundDamage(lobby: RunLobby): Record<string, { taken: number; dealt: number }> {
  const round = lobby.round - 1;
  const out: Record<string, { taken: number; dealt: number }> = {};
  for (const e of lobby.encounters) {
    if (e.round !== round || !e.fought) continue;
    out[e.a] = { taken: e.damageToA, dealt: e.damageToB };
    out[e.b] = { taken: e.damageToB, dealt: e.damageToA };
  }
  return out;
}

/** The seat the player just fought, and how that went — for the post-combat readout. */
export function lastPlayerEncounter(lobby: RunLobby): { foe: LobbySeatState; taken: number; dealt: number } | null {
  const round = lobby.round - 1;
  const e = lobby.encounters.find((x) => x.round === round && x.fought && (x.a === 's0' || x.b === 's0'));
  if (!e) return null;
  const foeId = e.a === 's0' ? e.b : e.a;
  const foe = lobby.seats.find((x) => x.id === foeId);
  if (!foe) return null;
  const meIsA = e.a === 's0';
  return { foe, taken: meIsA ? e.damageToA : e.damageToB, dealt: meIsA ? e.damageToB : e.damageToA };
}
