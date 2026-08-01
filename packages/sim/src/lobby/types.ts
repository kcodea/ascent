import type { BoardMinion, CombatOutcome } from '@game/core';
import type { BoardSnapshot } from '../snapshot';

/**
 * THE 8-SEAT LOBBY (prototype, owner direction 2026-07-29).
 *
 * Eight seats, each with its own Resolve pool, fight in pairs each round until one is left standing. Exactly
 * ONE of them is the live player; the rest are filled by whatever a `SeatDriver` supplies.
 *
 * The whole design turns on one question the owner asked directly: if recorded player snapshots don't feel
 * right, can we swap to live bots — or to all-bot seats — afterwards? So the lobby never learns where a board
 * came from. It asks a driver for "your board for round N" and hands back "here's what happened", and that is
 * the entire contract. `recordedSeat` and `botSeat` are two implementations of it; a third (a live human seat,
 * if the game ever has simultaneous players) would slot in the same way.
 *
 * What this deliberately does NOT do — and why the symmetric-combat refactor in the bots handoff isn't needed
 * here: a RECORDED seat never progresses. Its board at round 12 is already on disk, so the fight doesn't have
 * to compute one. Only `enemyDamage` (the mirror of `playerDamage`) has to come out of combat, because both
 * sides of a lobby fight take damage from ONE authoritative resolve. A live seat progresses through its own
 * ordinary `RunState`, which the existing reducer already handles.
 */

/** What a seat brings to a round: the board it fights with, the tavern tier that scales its damage, and the
 *  full `BoardSnapshot` it came from.
 *
 *  The snapshot is the load-bearing part. An Ascent opponent enters combat with seventeen fields of run-level
 *  context — spell power, the Beast/Imp/Undead/Attachment auras, fodder consumed, quest and rune modifiers —
 *  all captured by `snapshotBoard`. Reducing a seat to `{minions, tier}` silently dropped every one of them, so
 *  a lobby opponent's Runescale Drake, Karthus, Imp King and runes all fired at base or not at all, and the
 *  same board was systematically weaker in a lobby than in Ascent. Carrying the snapshot lets the reducer build
 *  the enemy side through the SAME path Ascent uses. */
export interface PreparedBoard {
  minions: BoardMinion[];
  tier: number;
  /** The snapshot these bodies came from. Absent only for a hand-built board in tests. */
  snapshot?: BoardSnapshot;
}

/** The outcome of one seat's fight, handed back so a LIVE seat can settle it. A recording ignores this. */
export interface SeatRoundOutcome {
  round: number;
  outcome: CombatOutcome;
  damageTaken: number;
  damageDealt: number;
  /** The seat's Resolve/Armor AFTER this round, per the lobby. A live seat syncs its run to these so its shop
   *  decisions read the health it actually has in the lobby, not the health its own private run happens to be
   *  on. Without it a bot at 4 lobby HP shops as though it were comfortable. */
  seatResolve: number;
  seatArmor: number;
}

/**
 * The swap point. Anything that can produce a board each round and absorb a result can hold a seat.
 *
 * `prepare` returning `null` means the seat is out of material — a recorded run that ended before the lobby
 * did. The lobby treats that as a real, visible condition rather than papering over it, because how it's
 * handled is one of the open design questions (see `ExhaustionPolicy`).
 */
export interface SeatDriver {
  readonly kind: 'recorded' | 'bot' | 'player';
  /** Human-readable, for the elimination log. */
  readonly label: string;
  readonly heroId: string;
  /** The board for this round, or `null` when the driver has nothing left to field. */
  prepare(round: number): PreparedBoard | null;
  /** The last board this driver can field, if any. The driver reports what it HAS; the lobby decides what
   *  running dry means (`ExhaustionPolicy`) — otherwise a design rule would be buried in each driver. */
  finalBoard?(): PreparedBoard | null;
  /** A CHEAP "can this driver field a board at all?" probe, for seat selection.
   *
   *  `createRunLobby` has to reject a hero no bot can play, and it did that by asking every candidate for its
   *  round-1 board — which for a hybrid seat means autoplaying a whole run (~100ms) purely to answer yes/no,
   *  seven times, synchronously, on the hero-select → game transition. A driver that can answer more cheaply
   *  says so here; the lobby falls back to the board request for those that can't. */
  canFieldBoard?(): boolean;
  /** Told what happened. A recording ignores it; a live run settles and plays its next shop. */
  settle(outcome: SeatRoundOutcome): void;
}

export interface LobbySeat {
  id: string;
  driver: SeatDriver;
  resolve: number;
  armor: number;
  alive: boolean;
  /** Finishing position, 1 = winner. Set on elimination (or on winning). */
  placement?: number;
  /** The round it was knocked out, for the log. */
  eliminatedRound?: number;
}

/** What to do when a recorded seat runs out of boards before the lobby ends. */
export type ExhaustionPolicy =
  /** Keep fielding its final board forever. Simple; goes stale against a scaling player. */
  | 'repeatFinal'
  /** Treat the seat as eliminated the moment it runs dry. Honest, but shortens lobbies unpredictably. */
  | 'eliminate';

export interface LobbyRules {
  seatCount: number;
  startingResolve: number;
  startingArmor: number;
  exhaustion: ExhaustionPolicy;
  /** Rounds with no elimination before stall pressure starts adding damage to every loser. */
  pressureAfterQuietRounds: number;
  /** Hard stop, so a prototype can never hang. */
  maxRounds: number;
  /** How many seats may be driven by REAL player runs from the registered pool. Absent = NO cap (owner call
   *  2026-07-31: players first, always, up to every non-player seat) — the field remains only so a test or a
   *  future rule can pin a smaller mix. It degrades on its own: with an empty pool no snapshot seats exist and
   *  every seat is generated, exactly as before. */
  snapshotSeats?: number;
}

export interface LobbyEncounter {
  round: number;
  a: string;
  b: string;
  outcome: CombatOutcome;
  damageToA: number;
  damageToB: number;
  /** A seat with no board this round: it took the round off rather than fighting. */
  bye?: string;
  /** Whether a real combat was resolved. A 0-damage DRAW and a couldn't-field-a-board round otherwise look
   *  identical in the log, which made a broken exhaustion policy read as a legitimate stalemate. */
  fought: boolean;
}

export interface LobbyState {
  version: 1;
  seed: number;
  rules: LobbyRules;
  round: number;
  seats: LobbySeat[];
  encounters: LobbyEncounter[];
  quietRounds: number;
  finished: boolean;
}
