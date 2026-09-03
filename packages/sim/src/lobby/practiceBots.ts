/**
 * PRACTICE BOTS — scaling opponents for the Practice "Bots" option (owner ask 2026-08-24), on a 1–10 ladder
 * (owner ask 2026-09-02, replacing easy/medium/hard).
 *
 * The seven bot seats are authored `omen` boards (no effects, no keywords — only Attack/Health), all fielding
 * (nearly) the SAME board each round, so whichever seat the pairing hands the player they face the round's board
 * and the elimination arc is driven by the player's own results (the tutorial's authored-seat trick — see
 * `tutorialSeats.ts`). Unlike the tutorial, the boards SCALE: the per-round table below is the owner's measured
 * "normal" difficulty, transcribed exactly from the real-warband baseline (avg board per round). Each level
 * scales that table and turns the damage dials (`BOT_LEVELS`).
 *
 * Levels 6–10 add NEWNESS on top of stats: a level-gated roster of real UTILITY minions (Echo AoE, Ward-granting
 * Echoes, Venomous, Cleave, Rally …) replaces one to three omen slots a round, keeping the slot's authored stat
 * line so the level's curve stays exactly what the table says while the effects scale with the round.
 *
 * The NORMAL table's per-round sums match the baseline screenshot's ΣAtk/ΣHP columns (spot-checked r4/r7/r8/r16).
 */
import { makeRng, type Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { AuthoredOmen } from './tutorialSeats';
import { DEFAULT_LOBBY_RULES } from './lobby';
import type { LobbyRules } from './types';
import type { LobbySeatState, RunLobby } from './runLobby';
import { playableHeroes } from '../heroes';
import { handleKeyOf, uniqueHandleFor } from './handles';
import { mixSeed, type BotLevel } from '../state';

export type { BotLevel } from '../state';

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

/** Everything a level turns. One row per level; the anchors are the three old difficulties. */
export interface BotLevelSpec {
  /** Multiplier on the NORMAL table's Attack/Health from `statFrom` onward (rounds before it are untouched, so
   *  the opening is identically gentle at every level). */
  statMult: number;
  /** The first (1-based) round `statMult` applies to. */
  statFrom: number;
  /** Bots climb one tavern tier every this-many rounds (capped at 6). Face damage is `tier + surviving
   *  minions`, so this is what makes a lost round actually cost Resolve. See `authoredTierFor`. */
  tierRamp: number;
  /** The tier a bot opens on. The ramp is already one-per-round from level 4, so the top levels push the
   *  START instead — a level-10 bot opens at tier 3 and is tier 6 by round 4. */
  startTier: number;
  /** Multiplier on what the PLAYER takes from a lost fight (mirrored in the reducer's `practiceBotDamageMult`)
   *  and on seat-vs-seat bot fights via `botDamageMult`. */
  damageMult: number;
  /** How many omen slots a round are swapped for real utility minions (levels 6+). Capped by the row length. */
  utilitySlots: number;
}

/**
 * The 1–10 ladder. Anchors (owner 2026-09-02): 1 = the old Easy, 3 = the old Medium (the raw table), 5 = the old
 * Hard; 2 and 4 interpolate; 6–10 push past anything that existed and start mixing in utility minions.
 */
export const BOT_LEVELS: Record<BotLevel, BotLevelSpec> = {
  1:  { statMult: 0.75, statFrom: 4, tierRamp: 3, startTier: 1, damageMult: 1.5,  utilitySlots: 0 },
  2:  { statMult: 0.87, statFrom: 4, tierRamp: 3, startTier: 1, damageMult: 1.75, utilitySlots: 0 },
  3:  { statMult: 1,    statFrom: 1, tierRamp: 2, startTier: 1, damageMult: 2,    utilitySlots: 0 },
  4:  { statMult: 1.07, statFrom: 7, tierRamp: 1, startTier: 1, damageMult: 2.25, utilitySlots: 0 },
  5:  { statMult: 1.15, statFrom: 7, tierRamp: 1, startTier: 1, damageMult: 2.5,  utilitySlots: 0 },
  6:  { statMult: 1.25, statFrom: 7, tierRamp: 1, startTier: 1, damageMult: 2.75, utilitySlots: 1 },
  7:  { statMult: 1.35, statFrom: 7, tierRamp: 1, startTier: 2, damageMult: 3,    utilitySlots: 1 },
  8:  { statMult: 1.5,  statFrom: 7, tierRamp: 1, startTier: 2, damageMult: 3.25, utilitySlots: 2 },
  9:  { statMult: 1.65, statFrom: 7, tierRamp: 1, startTier: 3, damageMult: 3.5,  utilitySlots: 2 },
  10: { statMult: 1.8,  statFrom: 7, tierRamp: 1, startTier: 3, damageMult: 3.75, utilitySlots: 3 },
};

export const MIN_BOT_LEVEL: BotLevel = 1;
export const MAX_BOT_LEVEL: BotLevel = 10;

/** Where the retired easy/medium/hard names land on the ladder — for persisted drafts and saved runs that still
 *  carry the old strings. */
export const LEGACY_BOT_DIFFICULTY: Record<'easy' | 'medium' | 'hard', BotLevel> = { easy: 1, medium: 3, hard: 5 };

/** Coerce anything a persisted config might hold (an old 'easy'/'medium'/'hard' string, a number, a numeric
 *  string, garbage) to a valid level. Unknown → the baseline (3, the old Medium). */
export function normalizeBotDifficulty(v: unknown): BotLevel {
  if (typeof v === 'string' && v in LEGACY_BOT_DIFFICULTY) return LEGACY_BOT_DIFFICULTY[v as keyof typeof LEGACY_BOT_DIFFICULTY];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 3;
  return Math.min(MAX_BOT_LEVEL, Math.max(MIN_BOT_LEVEL, Math.round(n))) as BotLevel;
}

/** The player-damage multiplier for a level (1 = every other mode). Tolerates a legacy string. */
export function botDamageMultFor(level: unknown): number {
  return BOT_LEVELS[normalizeBotDifficulty(level)].damageMult;
}

/** The tavern tier a bot at `level` fields on a (1-based) round — the same arithmetic as `authoredTierFor`, so
 *  the utility gate below agrees with the face damage the seat actually deals. */
export function botTierFor(level: BotLevel, round: number): number {
  const { tierRamp, startTier } = BOT_LEVELS[level];
  return Math.min(6, startTier + Math.floor((Math.max(1, round) - 1) / tierRamp));
}

/**
 * How hard bot seats hit EACH OTHER. Level-independent, and deliberately so.
 *
 * `damageMult` above is the DIFFICULTY dial: it scales what the player takes on the chin, so level 1 has to
 * stay gentle. This one is the PACING dial: it decides how fast seven AI seats chew through each other, which
 * is what actually sets the length of a bots game and has nothing to do with how hard the player's own fights
 * are. They were one constant until 2026-08-30, which meant the only way to stop a game dragging was to also
 * make it harder.
 *
 * REACH FOR THIS FIRST if bot games drag. It is the lever with no side effects on difficulty or on fiction.
 *
 * 5 is where it stops mattering: `lossDamageCap` bounds a round's damage, so from about here a losing bot takes
 * the cap and raising this further changes nothing (measured 2026-08-30 — a dominant run finishes in
 * 19/16/15/15 rounds at 2/3/5/6). It is chosen as the smallest value that reaches that floor.
 */
export const BOT_SEAT_DAMAGE_MULT = 5;

/**
 * The utility roster (owner list 2026-09-02) — real cards a level-6+ bot can field in place of an omen. Each
 * unlocks at a level (cumulative: a level fields everything unlocked at or below it) and is further gated by
 * the bot's CURRENT tier that round, so a tier-6 card never appears before the bots could "afford" it.
 *
 * A fielded unit takes over the omen slot's authored stat line (owner ruling: slot stats, not printed), so the
 * level's curve is unchanged and the effects scale with the round — a round-12 Anvilshade summons a 40-Attack
 * soldier. `fixedAttack` pins the exception: Venom stays a 1-Attack trade piece rather than a wall that also
 * kills whatever it touches (owner ruling 2026-09-02).
 */
export interface UtilityUnit {
  cardId: string;
  unlock: BotLevel;
  fixedAttack?: number;
}
export const UTILITY_ROSTER: readonly UtilityUnit[] = [
  { cardId: 'n2_lastlight', unlock: 6 },               // Echo: give 2 friendly minions Ward
  { cardId: 'venom', unlock: 6, fixedAttack: 1 },      // Venomous
  { cardId: 'dm_felspikes', unlock: 7 },               // Taunt. Echo: 4 damage to all but friendly Demons
  { cardId: 'dw_brakka', unlock: 7 },                  // Cleave
  { cardId: 'jenkins', unlock: 8 },                    // Jensen & Fi — Echo: destroy its killer
  { cardId: 'tauntbreaker', unlock: 8 },               // Rally: strip Taunt + Rise before striking
  { cardId: 'dw_anvilshade', unlock: 9 },              // Echo: a Charging Soldier with its Attack
  { cardId: 'b2_solaris', unlock: 9 },                 // Avenge (4): Ward + attack immediately
  { cardId: 'dw_thane', unlock: 10 },                  // Rally: give its Attack to 2 others
];

/** The roster entries a bot at `level` may field on `round` (unlocked AND within its tier). */
export function eligibleUtility(level: BotLevel, round: number): UtilityUnit[] {
  const tier = botTierFor(level, round);
  return UTILITY_ROSTER.filter((u) => u.unlock <= level && (CARD_INDEX[u.cardId]?.tier ?? Infinity) <= tier);
}

/** Apply a level's stat multiplier to a NORMAL row for a given (1-based) round. */
function scaleRow(row: AH[], round: number, level: BotLevel): AuthoredOmen[] {
  const { statMult, statFrom } = BOT_LEVELS[level];
  const mult = round >= statFrom ? statMult : 1;
  return row.map(([a, h]) => ({
    attack: Math.max(1, Math.round(a * mult)),
    health: Math.max(1, Math.round(h * mult)),
  }));
}

/** A fixed per-seat stat spread (roughly -6%..+6%, index-derived). Without it every bot fields the IDENTICAL
 *  board, mirrors its opponent and draws 0-0, so the table never thins and a winning player waits forever for
 *  seven seats to knock each other out. Index 0 is the authored table itself. */
const SEAT_SPREAD = [0, 0.06, -0.05, 0.03, -0.03, 0.05, -0.06];

function spreadRow(row: AuthoredOmen[], spreadIndex: number): AuthoredOmen[] {
  const f = 1 + (SEAT_SPREAD[spreadIndex % SEAT_SPREAD.length] ?? 0);
  if (f === 1) return row;
  return row.map((m) => ({
    ...m,
    attack: Math.max(1, Math.round(m.attack * f)),
    health: Math.max(1, Math.round(m.health * f)),
  }));
}

/** Deterministically pick `n` distinct indices from `0..len-1`. */
function pickIndices(rng: Rng, len: number, n: number): number[] {
  const idx = Array.from({ length: len }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, n);
}

/** Swap up to `utilitySlots` omen slots of a row for eligible utility units (level 6+). Which units and which
 *  slots is drawn from `rng`, so every seat's draw differs while a restored/replayed run redraws identically. */
function placeUtility(row: AuthoredOmen[], round: number, level: BotLevel, rng: Rng): AuthoredOmen[] {
  const want = Math.min(BOT_LEVELS[level].utilitySlots, row.length);
  if (want <= 0) return row;
  const pool = eligibleUtility(level, round);
  if (pool.length === 0) return row;
  const n = Math.min(want, pool.length);
  const units = pickIndices(rng, pool.length, n).map((i) => pool[i]!);
  const slots = pickIndices(rng, row.length, n);
  const out = row.slice();
  slots.forEach((slot, k) => {
    const u = units[k]!;
    const base = out[slot]!;
    out[slot] = {
      ...base,
      cardId: u.cardId,
      ...(u.fixedAttack !== undefined ? { attack: u.fixedAttack } : {}),
    };
  });
  return out;
}

/** Per-seat authoring options. Both default to the canonical table (seat 0's draw, no spread). */
export interface BotBoardOptions {
  /** Seeds the utility draw. Different seats pass different seeds so their boards don't look cloned. */
  seatSeed?: number;
  /** Index into the per-seat stat spread (0 = the authored table verbatim). */
  spreadIndex?: number;
}

/** The bot board for a given (1-based) round at a level. Rounds past the authored table clamp to its last row
 *  (the authored seat also clamps, but keeping it here means callers always get a real board). */
export function practiceBotBoard(round: number, level: BotLevel, opts: BotBoardOptions = {}): AuthoredOmen[] {
  const idx = Math.min(Math.max(Math.round(round) - 1, 0), NORMAL_ROWS.length - 1);
  const r = Math.max(1, Math.round(round));
  const scaled = spreadRow(scaleRow(NORMAL_ROWS[idx]!, r, level), opts.spreadIndex ?? 0);
  const rng = makeRng(mixSeed(opts.seatSeed ?? 0, r, level, 0x0b07));
  return placeUtility(scaled, r, level, rng);
}

/** Pre-materialize the per-round board table out to the round cap, so a bot seat serializes as plain data and a
 *  restored/replayed practice-bot run fields the identical boards. */
export function practiceBotBoards(level: BotLevel, rounds: number = DEFAULT_LOBBY_RULES.maxRounds, opts: BotBoardOptions = {}): AuthoredOmen[][] {
  return Array.from({ length: Math.max(1, rounds) }, (_, i) => practiceBotBoard(i + 1, level, opts));
}

/**
 * Build a Practice BOTS lobby: the live player at seat 0, plus seven authored seats all fielding the level's
 * board table. The bots read like a real table of opponents — each gets a random player-style handle and a REAL
 * hero portrait (owner ask 2026-08-24; the old "Bot N" labels + a hand-list of portrait ids that were mostly not
 * real heroes rendered blank icons). Portrait + name are cosmetic: an authored seat never plays a hero.
 * Deterministic from the seed, so a restored/replayed run seeds the same faces, names and boards.
 */
export function createPracticeBotLobby(seed: number, playerHeroId: string, level: BotLevel, rules: Partial<LobbyRules> = {}): RunLobby {
  const r: LobbyRules = { ...DEFAULT_LOBBY_RULES, ...rules };
  const spec = BOT_LEVELS[level];
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
    const seatSeed = seed * 1000 + i + 1;
    seats.push({
      id: `s${i + 1}`,
      label,
      heroId: portraits[(seed + i) % Math.max(1, portraits.length)] ?? playerHeroId,
      kind: 'authored',
      seed: seatSeed,
      // Each bot gets a slightly DIFFERENT board (±few %, deterministic per seat) and its own utility draw.
      // Identical tables mirrored each other, so roughly half of every round's bot-vs-bot fights ended 0-0 draws
      // and the table barely thinned — the real reason a winning player waited ~20+ rounds (owner ask
      // 2026-08-25). The PLAYER still faces the same curve: whichever seat they draw is within a few percent of
      // the authored table.
      authoredBoards: practiceBotBoards(level, r.maxRounds, { seatSeed, spreadIndex: i }),
      // FULL Resolve and Armor — exactly what a real lobby seat gets (owner ask 2026-08-30). Length is governed
      // by the tier ramp + damage multipliers, never by starting health.
      resolve: r.startingResolve,
      armor: r.startingArmor,
      alive: true,
      authoredTierRamp: spec.tierRamp,
      authoredTierStart: spec.startTier,
      botDamageMult: spec.damageMult,
      botSeatDamageMult: BOT_SEAT_DAMAGE_MULT,
    });
  }
  return { version: 1, seed, round: 1, seats, encounters: [], finished: false, rules: r };
}
