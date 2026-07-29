import { makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot } from './snapshot';
import { sideFromSnapshot } from './boardSide';

/**
 * GROUND-TRUTH BOARD STRENGTH, BY PLAYING THE BOARDS AGAINST EACH OTHER.
 *
 * Every board evaluator in this repo so far has been a *guess* at one question — is this board good? — and each
 * one failed the same way: hand-weighted stat sums, keyword value tables and board-width curves all reward the
 * things that are easy to count, and none of them can see synergy. Measured consequence: bots optimized against
 * the procedural threat curve build tall-and-cheap boards that beat a power-banded opponent and lose to boards
 * real people built.
 *
 * The engine can answer the question directly and it is cheap — one combat is ~0.017ms — so instead of guessing,
 * fight every board against every other board in its wave band and rate the results. Synergy needs no encoding
 * whatsoever: a board whose package wins simply wins more fights and rates higher.
 *
 * BOTH ORDERINGS ARE PLAYED. Combat is NOT symmetric — measured over 325 real pairings, swapping sides flips the
 * winner 22% of the time and changes the damage 62% of the time (attack order, and who runs out of bodies
 * first). Rating a board on one ordering would bake that bias into the ratings.
 */

/** A rated board: its snapshot, its Bradley-Terry strength, and how it got there. */
export interface RatedBoard {
  snapshot: BoardSnapshot;
  /** Elo-scaled strength. 1500 is the band average by construction. */
  elo: number;
  /** Raw share of points won (win 1, draw ½) across every fight it played. */
  score: number;
  fights: number;
}

const DRAW = 0.5;

/** Turn a snapshot's captured minions into combat bodies. */
const bodies = (s: BoardSnapshot): BoardMinion[] => s.minions.map((m) => ({ ...m }));

/**
 * Play `a` against `b` once in each ordering and return a's share of the two points.
 *
 * The seed is derived from the PAIR, so the same two boards always meet under the same conditions no matter
 * what order the round-robin visits them in — the property that makes ratings reproducible.
 */
export function headToHead(a: BoardSnapshot, b: BoardSnapshot, pairSeed: number, poolIds: string[]): number {
  const wave = Math.max(a.wave, b.wave);
  let points = 0;
  for (let flip = 0; flip < 2; flip++) {
    const [x, y] = flip === 0 ? [a, b] : [b, a];
    const r = simulate(
      bodies(x), bodies(y), makeRng(pairSeed + flip * 7919), CARD_INDEX,
      sideFromSnapshot(x, wave, poolIds), sideFromSnapshot(y, wave, poolIds),
    );
    // `result` is from the FIRST side's point of view, so a flipped fight has to be read inverted.
    const aWon = flip === 0 ? r.result === 'win' : r.result === 'lose';
    const aLost = flip === 0 ? r.result === 'lose' : r.result === 'win';
    points += aWon ? 1 : aLost ? 0 : DRAW;
  }
  return points / 2;
}

/** One recorded pairing — kept so ratings can be refit without re-simulating. */
export interface PairResult { i: number; j: number; scoreI: number; }

/**
 * Round-robin every board in a band. O(n²) fights, which the engine's speed makes practical: 664 boards is
 * ~440k fights at ~0.017ms ≈ 8 seconds. `maxOpponents` samples instead when a band is too large for that.
 */
export function roundRobin(boards: readonly BoardSnapshot[], poolIds: string[], maxOpponents = Infinity): PairResult[] {
  const out: PairResult[] = [];
  for (let i = 0; i < boards.length; i++) {
    // A deterministic stride rather than a random sample, so a capped run is still reproducible and every board
    // still meets a spread of opponents rather than only its neighbours.
    const stride = Math.max(1, Math.ceil((boards.length - 1) / Math.min(maxOpponents, boards.length - 1 || 1)));
    for (let j = i + 1; j < boards.length; j += stride) {
      out.push({ i, j, scoreI: headToHead(boards[i]!, boards[j]!, (i * 92_837 + j * 31_337) >>> 0, poolIds) });
    }
  }
  return out;
}

/**
 * Fit Bradley-Terry strengths to the pairings by gradient ascent on the log-likelihood.
 *
 * Plain win rate would be wrong here: with a capped round-robin, boards face different opponents, so beating
 * strong boards has to count for more than beating weak ones. Bradley-Terry is exactly that correction, and it
 * is what turns "won 60% of its fights" into a rating that transfers across bands.
 *
 * Deterministic: fixed iteration count, fixed step, zero initialisation — no RNG anywhere.
 */
export function fitRatings(n: number, pairs: readonly PairResult[], iterations = 300, lr = 0.6): number[] {
  const r = new Array<number>(n).fill(0);
  const grad = new Array<number>(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    grad.fill(0);
    for (const p of pairs) {
      const expected = 1 / (1 + Math.exp(-(r[p.i]! - r[p.j]!)));
      const err = p.scoreI - expected;
      grad[p.i]! += err;
      grad[p.j]! -= err;
    }
    // L2 pull toward zero keeps an undefeated board's rating finite rather than running away to infinity.
    for (let k = 0; k < n; k++) r[k] = r[k]! + lr * (grad[k]! / Math.max(1, pairs.length / n)) - 0.001 * r[k]!;
  }
  return r;
}

/** Rate one band of boards end to end. Elo scale: 1500 ± 400/ln(10) × strength. */
export function rateBand(boards: readonly BoardSnapshot[], poolIds: string[], maxOpponents = Infinity): RatedBoard[] {
  const pairs = roundRobin(boards, poolIds, maxOpponents);
  const strength = fitRatings(boards.length, pairs);
  const played = new Array<number>(boards.length).fill(0);
  const points = new Array<number>(boards.length).fill(0);
  for (const p of pairs) {
    played[p.i]!++; played[p.j]!++;
    points[p.i]! += p.scoreI; points[p.j]! += 1 - p.scoreI;
  }
  return boards.map((snapshot, k) => ({
    snapshot,
    elo: 1500 + (400 / Math.LN10) * strength[k]!,
    score: played[k]! ? points[k]! / played[k]! : 0,
    fights: played[k]! * 2, // both orderings
  }));
}
