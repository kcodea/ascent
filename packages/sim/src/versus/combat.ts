/**
 * VERSUS — the ONE authoritative fight of a round (blueprint 3, owner rulings 2026-10-13).
 *
 * Both players end their turn through `faceOmen { deferFight: true }`, which parks a fully prepared side (End of
 * Turn fired once, Start-of-Combat banks armed) without resolving anything. The resolver runs `simulate()` ONCE
 * over the two parked sides and hands each seat its own perspective: p1 always fights as simulate's `player` and takes
 * the result as-is, p2 takes `mirrorForEnemySeat` of it (the sides are 1:1 since R-SYMMETRY-01, so the labels change
 * nothing but the tie-break below). There is never a second simulation.
 *
 * HEARTS, NOT RESOLVE (owner ruling 1): the fight lands with `damageTaken: 0`, so Resolve and Armor never move in
 * Versus. A `lose` costs that seat one heart; a draw costs nobody (ruling 4).
 *
 * THE TIE-BREAK SIDE (`chair`). The one ordering choice a fight makes (`CombatConfig.firstSide`: which board mints
 * uids first, runs Start of Combat first, wins the seeded first-attacker coin's "heads") rotates: p1 on odd rounds,
 * p2 on even ones (accepted by the owner 2026-10-13; `firstSide` since the symmetry work landed, 2026-10-14).
 * Attack-first (Pre-emptive Assault) is OUT of every Versus pool (owner ruling 2026-10-13, `poolOf` in versus mode).
 *
 * SERVER BUNDLE: this module imports only `@game/core`, `@game/content` and pure siblings (types are erased), so
 * `npm run versus:bundle` can ship it to the `versus-resolve` Edge Function. Never import `../state` or
 * `../reducer` VALUES here.
 */
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type CombatResult } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { mirrorForEnemySeat } from './mirror';
import type { VersusSeat } from './constants';

export interface VersusFightInput {
  /** The match's pinned seed (server-owned, never client-chosen). */
  matchSeed: number;
  /** 1-based round number. */
  round: number;
  p1: PreparedCombatSide;
  p2: PreparedCombatSide;
}

export type VersusFightOutcome = VersusSeat | 'draw';

export interface VersusFightResult {
  /** The seat that held this round's tie-break (`firstSide`). p1 always fights as `player`. */
  chair: VersusSeat;
  /** The seat that WON, or `draw`. */
  outcome: VersusFightOutcome;
  /** The seat that loses a heart for this fight (`null` on a draw). */
  heartLostBy: VersusSeat | null;
  /** Each seat's OWN perspective of the one fight (`player` = that seat). One is the canonical result itself. */
  p1: CombatResult;
  p2: CombatResult;
}

/**
 * The fight's RNG seed: FNV-style fold of (matchSeed, round, combat tag, versus salt). Same mixer as the sim's
 * `mixSeed` (copied, not imported, so the server bundle stays core+content; `versusCombat.test.ts` pins them).
 */
export function versusCombatSeed(matchSeed: number, round: number): number {
  let h = 0x811c9dc5 | 0;
  for (const part of [matchSeed, round, 4 /* TAG.COMBAT */, 0x7e55 /* versus salt */]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

/** The seat that holds this round's tie-break (`firstSide`): p1 on odd rounds, p2 on even ones (see the header). */
export function versusChair(round: number): VersusSeat {
  return round % 2 === 1 ? 'p1' : 'p2';
}

/** Resolve the round's one fight. Pure and deterministic: same input, same bytes, in Node and in Deno. */
export function resolveVersusFight(input: VersusFightInput): VersusFightResult {
  const chair = versusChair(input.round);
  // p1 is `player`, p2 is `enemy`; the tie-break side rotates through `firstSide`. Attack-first never reaches here
  // (out of Versus pools), so only the tie-break is set on the fight's config.
  const config = { firstSide: chair === 'p1' ? ('player' as const) : ('enemy' as const) };
  // Private copies: the parked sides belong to the callers (and `simulate` mutates boards in place).
  const result = simulate(
    structuredClone(input.p1.board),
    structuredClone(input.p2.board),
    makeRng(versusCombatSeed(input.matchSeed, input.round)),
    CARD_INDEX,
    structuredClone(input.p1.state),
    structuredClone(input.p2.state),
    config,
  );
  const outcome: VersusFightOutcome = result.result === 'draw' ? 'draw' : result.result === 'win' ? 'p1' : 'p2';
  const heartLostBy: VersusSeat | null = outcome === 'draw' ? null : outcome === 'p1' ? 'p2' : 'p1';
  return { chair, outcome, heartLostBy, p1: result, p2: mirrorForEnemySeat(result) };
}

/** The side a seat fights with when it never uploaded anything (blueprint 5: two AFK players never deadlock). */
export function emptyVersusSide(): PreparedCombatSide {
  return { board: [], state: combatSide(), config: {} };
}

/** A stored side, or the empty side when it is missing or malformed (the reason is returned for the log). */
export function versusSideOrEmpty(side: unknown): { side: PreparedCombatSide; error: string | null } {
  if (side == null) return { side: emptyVersusSide(), error: 'missing' };
  const error = preparedSideError(side);
  return error ? { side: emptyVersusSide(), error } : { side: side as PreparedCombatSide, error: null };
}

const MAX_BOARD = 7;

/**
 * Structural check on a client-authored prepared side before it reaches `simulate` (blueprint 5: this first
 * unranked version trusts the payload's CONTENT, but never its SHAPE). Returns an error code or `null`.
 */
export function preparedSideError(side: unknown): string | null {
  if (!side || typeof side !== 'object') return 'side_not_object';
  const s = side as Partial<PreparedCombatSide>;
  if (!Array.isArray(s.board)) return 'board_not_array';
  if (s.board.length > MAX_BOARD) return 'board_too_large';
  for (const m of s.board) {
    if (!m || typeof m !== 'object') return 'minion_not_object';
    if (typeof m.cardId !== 'string') return 'minion_identity';
    if (!CARD_INDEX[m.cardId]) return 'unknown_card';
    if (!Number.isFinite(m.attack) || !Number.isFinite(m.health)) return 'minion_stats';
    if (m.keywords !== undefined && !Array.isArray(m.keywords)) return 'minion_keywords';
  }
  if (!s.state || typeof s.state !== 'object') return 'state_not_object';
  if (s.config !== undefined && (s.config === null || typeof s.config !== 'object')) return 'config_not_object';
  return null;
}
