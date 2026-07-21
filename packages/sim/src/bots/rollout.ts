/**
 * Combat rollout for the META bot (docs/bot-sims-handoff.md, Phase 2 — "the highest-leverage piece"). Instead
 * of trusting a stat heuristic for board ORDER, the meta bot simulates candidate arrangements against the
 * pinned next opponent and keeps the best. The eval function is the real thing: `reduce(clone, faceOmen)` runs
 * the actual combat and reports win/lose/draw + Resolve lost — no reimplementation, fully deterministic.
 *
 * The engine is saturated with positional effects (leftmost/rightmost/adjacency, Taunt front-lines), so board
 * ORDER is where cheap rollout buys the most. We converge to the best order one `reposition` at a time
 * (selection-sort toward the winning permutation), which threads cleanly through the policy's one-action loop.
 */
import type { Action, RunState, BoardCard } from '../state';
import { reduce, nextOpponent } from '../reducer';
import { CARD_INDEX } from '@game/content';
import type { BotWeights } from './scoring';

/** Rank a faceOmen outcome: any win beats any draw beats any loss; among losses, the smaller Resolve hit
 *  wins. (`playerDamage` = Resolve lost on defeat, 0 on a win.) */
function outcomeScore(after: RunState): number {
  const c = after.lastCombat;
  if (!c) return -1e9; // faceOmen didn't produce a combat (shouldn't happen in recruit) — treat as worst
  if (c.result === 'win') return 2000;
  if (c.result === 'draw') return 1000;
  return -c.playerDamage; // a loss: less Resolve lost = higher score
}

/** Evaluate a board ORDER (by uid list) by cloning the state with that order and running the real end-turn
 *  combat. Pure — the returned state is discarded, only its `lastCombat` is read. */
function evalOrder(state: RunState, order: BoardCard[]): number {
  const clone: RunState = { ...state, board: order };
  return outcomeScore(reduce(clone, { type: 'faceOmen' }));
}

function hasKw(c: BoardCard, kw: string): boolean {
  return c.keywords.includes(kw as BoardCard['keywords'][number]) || (CARD_INDEX[c.cardId]?.keywords.includes(kw as never) ?? false);
}
function stat(c: BoardCard): number { return c.attack + c.health; }

/** A few deterministic candidate orders — the strategies worth trying against a given opponent. */
function candidates(board: BoardCard[]): BoardCard[][] {
  const taunts = board.filter((c) => hasKw(c, 'T'));
  const rest = board.filter((c) => !hasKw(c, 'T'));
  return [
    board,                                                    // current
    [...taunts, ...rest],                                     // taunts to the front (soak first)
    [...board].sort((a, b) => stat(b) - stat(a)),             // strongest first (trade up early)
    [...board].sort((a, b) => stat(a) - stat(b)),             // weakest first (chip / sacrifice order)
    [...board].reverse(),                                     // mirror
  ];
}

/**
 * The meta bot's end-of-turn arrangement step. Returns the single `reposition` that moves the board one step
 * toward the best-simulated order, or `null` when the board is already best-ordered (or nothing helps / no
 * opponent / already winning) — in which case the policy falls through to `faceOmen`.
 */
export function bestFinalArrangement(state: RunState, _w: BotWeights): Action | null {
  if (state.board.length < 2 || !nextOpponent(state)) return null;

  // Already winning in the current order? Don't fiddle — reordering risks breaking a win.
  const curScore = evalOrder(state, state.board);
  if (curScore >= 2000) return null;

  // Pick the best-scoring candidate order (ties keep the current order — index 0).
  let bestOrder = state.board; let best = curScore;
  for (const cand of candidates(state.board)) {
    const sc = evalOrder(state, cand);
    if (sc > best) { best = sc; bestOrder = cand; }
  }
  if (bestOrder === state.board || best <= curScore) return null;

  // Selection-sort one step toward `bestOrder`: find the first slot that differs, and reposition the card that
  // belongs there into it. Deterministic + convergent; the loop calls again until the orders match.
  const cur = state.board.map((c) => c.uid);
  const want = bestOrder.map((c) => c.uid);
  for (let i = 0; i < want.length; i++) {
    if (cur[i] !== want[i]) {
      const move: Action = { type: 'reposition', uid: want[i]!, toIndex: i };
      return reduce(state, move) !== state ? move : null;
    }
  }
  return null;
}
