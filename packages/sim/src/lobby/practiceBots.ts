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
import { playableHeroes } from '../heroes';
import { handleKeyOf, uniqueHandleFor } from './handles';

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

/**
 * How fast a bot seat climbs tavern tiers: one tier every N rounds, capped at 6 (see `authoredTierFor`).
 *
 * This is the DAMAGE lever (owner ask 2026-08-25: practice bot games ran far too long). Face damage in
 * `simulate` is `opponent tier + 1 per surviving minion`, so bots pinned at tier 1 dealt a trickle — 2→7 a round
 * regardless of difficulty, no matter how huge their bodies got. Ramping the tier makes a lost round actually
 * cost Resolve, and makes the three difficulties diverge (harder = tiers up faster).
 */
const TIER_RAMP: Record<BotDifficulty, number> = { easy: 3, medium: 2, hard: 1 };

/**
 * Damage multiplier for a bot table, by difficulty. Applied to BOTH the player's fight (mirrored in the
 * reducer's `practiceBotDamageMult`) and to seat-vs-seat fights (`settleRunLobbyRound` reads it off the seats).
 *
 * The seat-vs-seat half is what actually fixes the LENGTH complaint: every bot fields the same board, so bots
 * only ever chip each other a few points a round and a WINNING player waited ~25 rounds for the table to thin
 * itself out. Keep this in sync with `practiceBotDamageMult`.
 */
export const BOT_DAMAGE_MULT: Record<BotDifficulty, number> = { easy: 1.5, medium: 2, hard: 2.5 };

/** Bot seats start on this fraction of the player's Resolve (and no Armor) — see the seat build below. */
const BOT_HEALTH_MULT = 0.6;

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

/**
 * A per-seat variant of the authored table: each seat's bodies are nudged by a small, deterministic percentage
 * (index-derived, roughly -6%..+6%). Without this every bot fields the IDENTICAL board, mirrors its opponent and
 * draws 0-0, so the table never thins and a winning player waits forever for seven seats to knock each other out.
 */
function variedBoards(boards: AuthoredOmen[][], seatIndex: number): AuthoredOmen[][] {
  // A fixed spread per seat: seat 0 is the authored table, the rest fan out either side of it.
  const SPREAD = [0, 0.06, -0.05, 0.03, -0.03, 0.05, -0.06];
  const f = 1 + (SPREAD[seatIndex % SPREAD.length] ?? 0);
  if (f === 1) return boards;
  return boards.map((row) => row.map((m) => ({
    attack: Math.max(1, Math.round(m.attack * f)),
    health: Math.max(1, Math.round(m.health * f)),
  })));
}

/**
 * Build a Practice BOTS lobby: the live player at seat 0, plus seven authored omen seats all fielding the
 * difficulty-scaled board table. The bots read like a real table of opponents — each gets a random player-style
 * handle and a REAL hero portrait (owner ask 2026-08-24; the old "Bot N" labels + a hand-list of portrait ids
 * that were mostly not real heroes rendered blank icons). Portrait + name are cosmetic: an authored omen seat
 * never plays a hero. Deterministic from the seed, so a restored/replayed run seeds the same faces and names.
 */
export function createPracticeBotLobby(seed: number, playerHeroId: string, difficulty: BotDifficulty, rules: Partial<LobbyRules> = {}): RunLobby {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  const authoredBoards = practiceBotBoards(difficulty, r.maxRounds);
  const seats: LobbySeatState[] = [{
    id: 's0', label: 'You', heroId: playerHeroId, kind: 'player', seed,
    resolve: r.startingResolve, armor: r.startingArmor, alive: true,
  }];
  // REAL hero ids so `heroArt(seat.heroId)` resolves to an actual portrait (a fake id renders a broken image).
  // The player's own hero is excluded so a bot never wears the player's face.
  const portraits = playableHeroes().map((h) => h.id).filter((id) => id !== playerHeroId);
  const count = Math.max(1, r.seatCount - 1);
  const taken = new Set<string>(['you']);
  for (let i = 0; i < count; i++) {
    const label = uniqueHandleFor(handleKeyOf(`practicebot|${seed}|${i}`), taken);
    taken.add(label.toLowerCase());
    seats.push({
      id: `s${i + 1}`,
      label,
      heroId: portraits[(seed + i) % Math.max(1, portraits.length)] ?? playerHeroId,
      kind: 'authored',
      seed: seed * 1000 + i + 1,
      // Each bot gets a slightly DIFFERENT board (±few %, deterministic per seat). Identical tables mirrored each
      // other, so roughly half of every round's bot-vs-bot fights ended 0-0 draws and the table barely thinned —
      // the real reason a winning player waited ~20+ rounds (owner ask 2026-08-25). A little variance makes those
      // fights resolve, so the bots eliminate each other on a sane clock. The PLAYER still faces the same curve:
      // the spread is small, and whichever seat they draw is within a few percent of the authored table.
      authoredBoards: variedBoards(authoredBoards, i),
      // Bot seats start on LESS health than the player (who keeps the full Resolve + Armor). Seven seats each
      // soaking 45 was the last brake on length — the table had to absorb ~315 points before a winner existed.
      // A shorter bot pool shortens the sandbox without making the PLAYER's own fights any easier, and the
      // per-seat stagger keeps them from all falling on the same round.
      resolve: Math.max(10, Math.round(r.startingResolve * BOT_HEALTH_MULT) - i),
      armor: 0,
      alive: true,
      authoredTierRamp: TIER_RAMP[difficulty],
      botDamageMult: BOT_DAMAGE_MULT[difficulty],
    });
  }
  return { version: 1, seed, round: 1, seats, encounters: [], finished: false, rules: r };
}
