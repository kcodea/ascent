/**
 * TUTORIAL LOBBY seating — authored omen opponents for the Learn Ascent course.
 *
 * A tutorial lobby keeps the whole 8-seat structure (rail, elimination, pairing, settle) but its opponents are
 * AUTHORED effectless `omen` boards rather than recorded player runs or bots. The trick that keeps this from
 * touching combat/settle at all: every authored seat's driver returns THE SAME board for a given round — the
 * course's board for that round — so whichever seat the seeded pairing hands the player, they always face the
 * round's authored board. The player's damage still applies to whoever they were paired with (the normal,
 * consistent path), and the other authored pairs fight identical boards → draws → no premature eliminations.
 * So the elimination arc is driven emergently by the player's own wins, which is what the course wants early.
 *
 * Nothing here fakes an outcome: combat still runs in `simulate`, damage still flows through the lobby. The
 * course only supplies the INPUT board, exactly like a recorded seat supplies its input board.
 */
import type { BoardMinion, Tribe } from '@game/core';
import { createRun, type RunState } from '../state';
import { rollShop } from '../shop';
import type { LobbyRules, PreparedBoard, SeatDriver } from './types';
import { DEFAULT_LOBBY_RULES } from './lobby';
import type { LobbySeatState, RunLobby } from './runLobby';

/** One authored opponent minion. By default identity is the effectless `omen` token and only Attack/Health vary;
 *  a `cardId` swaps in a REAL card (practice-bot utility units, levels 6+) which brings that card's keywords and
 *  effects while keeping the authored stat line. */
export interface AuthoredOmen {
  attack: number;
  health: number;
  cardId?: string;
}

/** Materialize a round's authored omen stat-line into real `omen` `BoardMinion`s (textless, keywordless —
 *  matching how `threats.ts` builds omen bodies). No snapshot is needed: an effectless board wants exactly the
 *  base neutral side, which the reducer supplies when `PreparedBoard.snapshot` is omitted. */
export function omenBoardMinions(board: readonly AuthoredOmen[]): BoardMinion[] {
  return board.map((m) => ({
    cardId: m.cardId ?? 'omen',
    attack: Math.max(1, Math.round(m.attack)),
    health: Math.max(1, Math.round(m.health)),
    // A real card keeps its printed keywords (`instantiate` falls back to the CardDef when this is absent);
    // an omen is explicitly keywordless.
    ...(m.cardId ? {} : { keywords: [] }),
  }));
}

/**
 * A driver for an authored seat: it fields the course's board for the current round and never progresses.
 * Behaviourally a recording (fixed input, ignores settle), so it reports `kind: 'recorded'`.
 */
/**
 * The tavern tier an authored seat fields on a given (1-based) round.
 *
 * Face damage in `simulate` is `opponent tier + 1 per surviving minion`, so the TIER — not the bodies' stats —
 * is what makes a win actually hurt. A seat with `authoredTierRamp` climbs a tier every `ramp` rounds (capped at
 * the real 6-tier ceiling), mirroring how a live board tiers up; without the field it stays on its start tier.
 * `authoredTierStart` (default 1) is where the climb begins — the top practice-bot levels open above tier 1.
 */
export function authoredTierFor(seat: Pick<LobbySeatState, 'authoredTierRamp' | 'authoredTierStart'>, round: number): number {
  const start = Math.min(6, Math.max(1, seat.authoredTierStart ?? 1));
  const ramp = seat.authoredTierRamp;
  if (!ramp || ramp <= 0) return start;
  return Math.min(6, start + Math.floor((Math.max(1, round) - 1) / ramp));
}

export function authoredSeat(seat: LobbySeatState): SeatDriver {
  const boards = seat.authoredBoards ?? [];
  const boardFor = (round: number): PreparedBoard | null => {
    // Rounds are 1-based; clamp past the last authored board to the final one (the course's exhaustion tail),
    // so a lobby that runs a round longer than authored still fields a real board rather than a bye.
    if (boards.length === 0) return null;
    const idx = Math.min(Math.max(round - 1, 0), boards.length - 1);
    // TIER drives face damage (`simulate`: opponent tier + one per surviving minion's card tier), so an authored
    // seat pinned at tier 1 deals a trickle no matter how big its bodies are. `authoredTierRamp` lets a seat
    // climb like a real board would (practice bots — owner ask 2026-08-25: games lasted far too long); absent, it
    // stays tier 1 so the TUTORIAL's gentle pacing is unchanged.
    return { minions: omenBoardMinions(boards[idx]!), tier: authoredTierFor(seat, idx + 1) };
  };
  return {
    kind: 'recorded',
    label: seat.label,
    heroId: seat.heroId,
    prepare: (round) => boardFor(round),
    finalBoard: () => boardFor(boards.length),
    canFieldBoard: () => boards.length > 0,
    settle: () => {}, // authored seats keep no private run state
  };
}

/**
 * Build a tutorial lobby: the live player at seat 0, plus N authored omen opponents that all field the course's
 * per-round board table. Deterministic and serializable (the board table is plain data on each seat).
 */
export function createTutorialLobby(
  seed: number,
  playerHeroId: string,
  authoredBoards: AuthoredOmen[][],
  opponentNames: string[],
  rules: Partial<LobbyRules> = {},
  seatsRemaining?: number[],
): RunLobby {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  const seats: LobbySeatState[] = [{
    id: 's0', label: 'You', heroId: playerHeroId, kind: 'player', seed,
    resolve: r.startingResolve, armor: r.startingArmor, alive: true,
  }];
  const count = Math.max(1, r.seatCount - 1);
  for (let i = 0; i < count; i++) {
    seats.push({
      id: `s${i + 1}`,
      label: opponentNames[i] ?? `Rival ${i + 1}`,
      // The opponent seats show a portrait; a stable tutorial-hero id keeps that render honest without pulling
      // a real hero into the course. `heroId` here only feeds the portrait — an authored seat never plays a run.
      heroId: 'aster',
      kind: 'authored',
      seed: seed * 1000 + i + 1,
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
      authoredBoards,
    });
  }
  return { version: 1, seed, round: 1, seats, encounters: [], finished: false, rules: r,
    ...(seatsRemaining && seatsRemaining.length ? { tutorialSeatsRemaining: seatsRemaining } : {}) };
}

/**
 * Start a tutorial run: an ordinary `RunState` in `tutorial` mode, carrying an authored lobby. Mirrors
 * `createLobbyRun` but seats authored omens and stamps the course id so a restored run rehydrates the coaching.
 */
export function createTutorialRun(
  seed: number,
  heroId: string,
  courseId: string,
  authoredBoards: AuthoredOmen[][],
  opponentNames: string[],
  rounds: number,
  shopScript: { minions: string[]; spell?: string }[][],
  attackFirst?: boolean[],
  forceEnemyTarget?: string[],
  discoverTribe?: Tribe,
  seatsRemaining?: number[],
): RunState {
  const run = createRun(seed, heroId, 'tutorial');
  // `createRun` already rolled a POOL shop. Attach the scripted shop and re-roll so the turn-1 offer is the
  // authored one — the tutorial branch in `rollShop` overwrites `state.shop` with the script (the discarded
  // pool draw's bookkeeping never matters, since a tutorial never consults the pool again).
  run.tutorialCourseId = courseId;
  run.tutorialShopScript = shopScript;
  run.tutorialShopRoll = 0;
  if (attackFirst) run.tutorialAttackFirst = attackFirst;
  if (forceEnemyTarget) run.tutorialForceEnemyTarget = forceEnemyTarget;
  if (discoverTribe) run.tutorialDiscoverTribe = discoverTribe;
  // GENEROUS GOLD: a tutorial is not an economy puzzle. Give the max (10) every turn so every coached action —
  // a buy AND a tavern-up in one round — is always affordable; the action gate stops the player over-spending.
  run.maxEmbers = 10;
  run.embers = 10;
  rollShop(run);
  // A fixed-round course ends by the round cap (or the player's elimination), so pin `maxRounds` to the course
  // length rather than the lobby default of 60.
  const lobby = createTutorialLobby(seed, heroId, authoredBoards, opponentNames, { maxRounds: rounds }, seatsRemaining);
  const me = lobby.seats[0]!;
  me.resolve = run.resolve;
  me.armor = run.armor;
  return { ...run, lobby };
}
