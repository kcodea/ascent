/**
 * IMITATION (B7) — THE TERM the strategist blends into the evaluator.
 *
 * `imitationTermOf(visibleState, model)` is the model's log-odds shift toward "a board that went on to survive" for
 * the pilot's board (+ hand minions at half credit while the board has room — a survivor card in hand is a survivor
 * card next turn; never spells, which are valued by casting). Returns `null` when the model has no band for the
 * wave. Pure, deterministic, ~30 lookups.
 *
 * What it ranks between two candidates of one search (same wave, same Resolve): which cards are on the board — the
 * ones the recorded players who went on to survive kept at this wave — plus goldens and board size against the
 * survivors' means. It says nothing about how big the bodies are; that is the fight terms' job.
 */
import { CARD_INDEX } from '@game/content';
import type { BotVisibleState } from '../../productionBots/types';
import { scoreBoard, type BoardScore, type ImitationModel, type ScoreOptions } from './model';

export function imitationScoreOf(v: BotVisibleState, model: ImitationModel, opts: ScoreOptions = {}): BoardScore | null {
  const hand: { cardId: string; golden: boolean }[] = [];
  for (const c of v.hand) {
    const def = CARD_INDEX[c.cardId];
    if (!def || def.spell || def.ruby) continue;
    hand.push({ cardId: c.cardId, golden: c.golden });
  }
  return scoreBoard(model, { wave: v.wave, board: v.board.map((c) => ({ cardId: c.cardId, golden: c.golden })), hand, boardMax: 7 }, opts);
}

export function imitationTermOf(v: BotVisibleState, model: ImitationModel, opts: ScoreOptions = {}): number | null {
  return imitationScoreOf(v, model, opts)?.total ?? null;
}
