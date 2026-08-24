/**
 * BOTS LOBBY — a full 8-seat, last-man-standing lobby whose seven opponents are all the effectless `omen`
 * enemy, growing ONLY in stats round over round. A learning sandbox for brand-new players (owner ask
 * 2026-08-24): normal rules, real elimination, no rating.
 *
 * It reuses the tutorial's authored-seat trick wholesale (see `tutorialSeats.ts`): every bot seat fields the
 * SAME omen board for a given round, so whichever seat the seeded pairing hands the player, they face the
 * round's board; the other bot pairs draw identical boards and never eliminate each other. The elimination arc
 * is therefore driven entirely by the PLAYER's wins — exactly right for a sandbox where the only variable that
 * should matter is how well the newcomer builds.
 *
 * The one thing bots does NOT share with the tutorial: mode. A bots run is `mode: 'bots'`, not `'tutorial'`
 * (no coaching, no course clock) and not `'lobby'` (rating/board-pool capture gate on `mode === 'lobby'`, so
 * bots is unrated and never feeds matchmaking) and not `'practice'` (practice's invulnerability + round-15
 * curtain gate on `mode === 'practice'`, so bots has REAL elimination that runs full length). All the lobby
 * machinery keys on `run.lobby` presence, so it runs regardless.
 */
import { createRun, type RunState } from '../state';
import { DEFAULT_LOBBY_RULES } from './lobby';
import type { LobbyRules } from './types';
import type { LobbySeatState, RunLobby } from './runLobby';
import type { AuthoredOmen } from './tutorialSeats';

/** How far a bots game can run before the stalemate backstop ends it (the lobby default). Boards are authored
 *  out to this many rounds so a very long game never falls back to a bye. */
const BOTS_ROUNDS = DEFAULT_LOBBY_RULES.maxRounds;

/** Cosmetic portraits for the seven bot seats — a stable spread so the rail reads like a real lobby rather than
 *  seven identical faces. Purely a portrait; a bot seat fields an omen board and never plays a hero. */
const BOT_PORTRAITS = ['aster', 'bront', 'kael', 'odelle', 'tamsin', 'jenna', 'vale'];

/**
 * The scaling omen board for a given (1-based) round. Both the board SIZE and the per-minion stat-line grow, so
 * the threat escalates on two axes the way a real opponent's board does: more bodies AND bigger ones. The line
 * descends left-to-right (the front slot is the biggest), mirroring how the authored tutorial boards read.
 *
 * Tuned to be gentle early (a newcomer with any board clears round 1-3) and to out-scale a weak build by the
 * mid rounds — the point where a sandbox should start punishing a board that never tiered up. Kept deliberately
 * simple and centralized so it is a one-line tuning knob.
 */
export function botsOmenBoard(round: number): AuthoredOmen[] {
  const r = Math.max(1, Math.round(round));
  const count = Math.min(7, Math.max(1, Math.ceil(r / 1.3))); // 1 body at r1, a full 7 by ~r8
  const topAttack = 1 + Math.round(r * 1.2);
  const topHealth = 2 + Math.round(r * 1.4);
  return Array.from({ length: count }, (_, i) => ({
    attack: Math.max(1, topAttack - i),
    health: Math.max(1, topHealth - i),
  }));
}

/** Pre-materialize the per-round board table out to the round cap. Plain data on each seat, so the lobby stays
 *  serializable and a restored/replayed bots run fields the identical scaling boards. */
export function botsOmenBoards(rounds: number = BOTS_ROUNDS): AuthoredOmen[][] {
  return Array.from({ length: Math.max(1, rounds) }, (_, i) => botsOmenBoard(i + 1));
}

/** Build the bots lobby: the live player at seat 0, plus seven authored omen seats all fielding the scaling
 *  board table. Mirrors `createTutorialLobby` but with varied portraits, bot labels, and the full round cap. */
export function createBotsLobby(seed: number, playerHeroId: string, rules: Partial<LobbyRules> = {}): RunLobby {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  const authoredBoards = botsOmenBoards(r.maxRounds);
  const seats: LobbySeatState[] = [{
    id: 's0', label: 'You', heroId: playerHeroId, kind: 'player', seed,
    resolve: r.startingResolve, armor: r.startingArmor, alive: true,
  }];
  const count = Math.max(1, r.seatCount - 1);
  for (let i = 0; i < count; i++) {
    seats.push({
      id: `s${i + 1}`,
      label: `Bot ${i + 1}`,
      // Portrait only — an authored omen seat never plays a run (see `authoredSeat`).
      heroId: BOT_PORTRAITS[i % BOT_PORTRAITS.length]!,
      kind: 'authored',
      seed: seed * 1000 + i + 1,
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
      authoredBoards,
    });
  }
  return { version: 1, seed, round: 1, seats, encounters: [], finished: false, rules: r };
}

/**
 * Start a bots run: an ordinary `RunState` in `bots` mode carrying the scaling-omen lobby. Mirrors
 * `createLobbyRun`/`createTutorialRun` but seats only bots and runs under normal economy (no tutorial's
 * generous gold — the player is really learning to build under the real constraints).
 */
export function createBotsRun(seed: number, heroId: string): RunState {
  const run = createRun(seed, heroId, 'bots');
  const lobby = createBotsLobby(seed, heroId);
  const me = lobby.seats[0]!;
  me.resolve = run.resolve;
  me.armor = run.armor;
  return { ...run, lobby };
}
