/**
 * PRACTICE BOTS — effectless, stat-only opponents for the Practice "Bots" option (owner ask 2026-08-24).
 *
 * The seven bot seats are authored `omen` boards (no effects, no keywords — only Attack/Health), all fielding
 * the SAME board each round, so whichever seat the pairing hands the player they face the round's board and the
 * elimination arc is driven by the player's own results (the tutorial's authored-seat trick — see
 * `tutorialSeats.ts`). Unlike the tutorial, the boards SCALE: the per-round table below is the owner's measured
 * "normal" difficulty, transcribed exactly from the real-warband baseline (avg board per round). Easy/Hard
 * scale that table.
 *
 * The NORMAL table's per-round sums match the baseline screenshot's ΣAtk/ΣHP columns (spot-checked r4/r7/r8/r16).
 */
import type { AuthoredOmen } from './tutorialSeats';
import { DEFAULT_LOBBY_RULES } from './lobby';
import type { LobbyRules } from './types';
import type { LobbySeatState, RunLobby } from './runLobby';

/** A tuple shorthand for authoring — `[attack, health]`. */
type AH = [number, number];

/** NORMAL difficulty: the authored per-round board (index 0 = round 1), Attack/Health per minion, front-loaded
 *  (biggest on the left). Owner-supplied baseline, verbatim. Rounds past this table clamp to the last row. */
const NORMAL_ROWS: AH[][] = [
  /* r1  */ [[2, 1]],
  /* r2  */ [[2, 1]],
  /* r3  */ [[3, 4]],
  /* r4  */ [[4, 3], [3, 4], [3, 3]],
  /* r5  */ [[6, 4], [5, 5], [4, 4]],
  /* r6  */ [[6, 6], [6, 6], [5, 5], [5, 5]],
  /* r7  */ [[10, 10], [9, 9], [8, 9], [8, 8], [7, 8]],
  /* r8  */ [[16, 17], [15, 16], [14, 15], [13, 14], [12, 13], [12, 13]],
  /* r9  */ [[22, 22], [20, 20], [19, 19], [18, 18], [17, 17], [16, 17]],
  /* r10 */ [[28, 30], [26, 28], [24, 26], [23, 25], [21, 23], [19, 23]],
  /* r11 */ [[33, 35], [31, 33], [30, 32], [28, 30], [27, 29], [25, 27], [24, 25]],
  /* r12 */ [[44, 47], [41, 44], [39, 42], [38, 40], [36, 38], [34, 36], [33, 35]],
  /* r13 */ [[58, 53], [55, 50], [54, 49], [53, 48], [51, 47], [50, 47], [48, 46]],
  /* r14 */ [[76, 82], [73, 79], [72, 78], [71, 77], [68, 74], [65, 72]],
  /* r15 */ [[105, 110], [102, 107], [100, 105], [98, 104], [96, 102], [95, 100]],
  /* r16 */ [[145, 151], [142, 148], [138, 144], [136, 142], [134, 140], [131, 135], [126, 132]],
];

export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** EASY scales rounds 4–16 down (owner: "scale rounds 4-16 back by 20-30%") — 25%, the midpoint. Rounds 1–3 are
 *  left alone so the opening is identically gentle. */
const EASY_MULT = 0.75;
const EASY_FROM_ROUND = 4;
/** HARD scales rounds 7–16 up (owner: "increase rounds 7-16 by 10-20%") — 15%, the midpoint. Rounds 1–6 unchanged. */
const HARD_MULT = 1.15;
const HARD_FROM_ROUND = 7;

/** Apply a difficulty's multiplier to a NORMAL row for a given (1-based) round. `medium` is the baseline. */
function scaleRow(row: AH[], round: number, difficulty: BotDifficulty): AuthoredOmen[] {
  const mult =
    difficulty === 'easy' && round >= EASY_FROM_ROUND ? EASY_MULT :
    difficulty === 'hard' && round >= HARD_FROM_ROUND ? HARD_MULT : 1;
  return row.map(([a, h]) => ({
    attack: Math.max(1, Math.round(a * mult)),
    health: Math.max(1, Math.round(h * mult)),
  }));
}

/** The bot board for a given (1-based) round at a difficulty. Rounds past the authored table clamp to its last
 *  row (the authored seat also clamps, but keeping it here means callers always get a real board). */
export function practiceBotBoard(round: number, difficulty: BotDifficulty): AuthoredOmen[] {
  const idx = Math.min(Math.max(Math.round(round) - 1, 0), NORMAL_ROWS.length - 1);
  return scaleRow(NORMAL_ROWS[idx]!, idx + 1, difficulty);
}

/** Pre-materialize the per-round board table out to the round cap, so a bot seat serializes as plain data and a
 *  restored/replayed practice-bot run fields the identical scaling boards. */
export function practiceBotBoards(difficulty: BotDifficulty, rounds: number = DEFAULT_LOBBY_RULES.maxRounds): AuthoredOmen[][] {
  return Array.from({ length: Math.max(1, rounds) }, (_, i) => practiceBotBoard(i + 1, difficulty));
}

/** Cosmetic portraits for the seven bot seats — a stable spread so the rail reads like a real table rather than
 *  seven identical faces. Portrait only: an authored omen seat never plays a hero. */
const BOT_PORTRAITS = ['aster', 'bront', 'kael', 'odelle', 'tamsin', 'jenna', 'vale'];

/** Build a Practice BOTS lobby: the live player at seat 0, plus seven authored omen seats all fielding the
 *  difficulty-scaled board table. Mirrors `createTutorialLobby` but with varied portraits + "Bot N" labels. */
export function createPracticeBotLobby(seed: number, playerHeroId: string, difficulty: BotDifficulty, rules: Partial<LobbyRules> = {}): RunLobby {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  const authoredBoards = practiceBotBoards(difficulty, r.maxRounds);
  const seats: LobbySeatState[] = [{
    id: 's0', label: 'You', heroId: playerHeroId, kind: 'player', seed,
    resolve: r.startingResolve, armor: r.startingArmor, alive: true,
  }];
  const count = Math.max(1, r.seatCount - 1);
  for (let i = 0; i < count; i++) {
    seats.push({
      id: `s${i + 1}`,
      label: `Bot ${i + 1}`,
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
