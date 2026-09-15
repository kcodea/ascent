/**
 * BALANCE BOT B4 — THE STRATEGIST PILOT: the generalist's search with a LINE PRIOR in candidate scoring.
 *
 * On its first decision for a seat it picks a line for the run — `pickLineForRun(heroId, tribes, run.seed,
 * exploration)` from player-visible facts only — and from then on every decision runs the generalist's whole
 * routine (queued plan, mandatory prompts, beam search, forced spend, positioning) with `linePrior(line)`
 * installed in the evaluator for the duration of the call. So:
 *
 *  - card affinity to the line shapes buy / keep / play / sell (the engine piece over the vanilla body; never
 *    sell the engine piece; field line cards first);
 *  - rune affinity shapes the Runeforge (buy / skip / reroll all score through the same evaluator, with the
 *    affine rune's expected payoff over the remaining rounds folded in);
 *  - the economy profile shapes tier timing (upgrade when the curve says so, not before);
 *  - held pairs of line cards and an affine hero power get their small nudges.
 *
 * What it does NOT do: propose any action the generalist could not (the candidate set is unchanged and every
 * action is reducer-validated on a clone), read hidden information (the prior sees `BotVisibleState` only), or
 * outweigh the fight — `PRIOR_WEIGHT` caps the prior at a few utility points beside `fightStrength`'s 26.
 *
 * `exploration`: `0` plays the best-fit line every run; `k` the k-th best; `'rotate'` derives k from the run
 * seed so a seeded matrix rotates through every viable line for the hero (the exploration population of the
 * roadmap — label it as such; forced lines are not natural pick rates).
 */
import type { Action, RunState } from '../../state';
import { withEvaluationPrior } from '../../productionBots/evaluate';
import { createGeneralistPilot, type GeneralistPilot } from '../generalistPilot';
import type { PilotBudget, SeatContext, SeatPilot } from '../types';
import { pickLineForRun, viableLineCount, type LineChoice } from './lines';
import { linePrior, PRIOR_WEIGHT } from './prior';

export interface StrategistOptions {
  /** 0 = best fit; k = k-th best viable line; 'rotate' = k from the run seed (a per-seed rotation). */
  exploration: number | 'rotate';
  /** Override the prior's weight (tests / tuning). Default `PRIOR_WEIGHT`. */
  priorWeight?: number;
  /** Record label; defaults to `strategist` / `strategist:explore<k>` / `strategist:rotate`. */
  id?: string;
}

export interface StrategistPilot extends SeatPilot {
  budget: PilotBudget;
  exploration: number | 'rotate';
  /** The line chosen for a seat (undefined before its first decision). */
  lineOf(seatId?: string): LineChoice | undefined;
  /** The wrapped generalist's last decision trace. */
  lastTrace: GeneralistPilot['lastTrace'];
}

export function strategistId(exploration: number | 'rotate'): string {
  if (exploration === 'rotate') return 'strategist:rotate';
  return exploration === 0 ? 'strategist' : `strategist:explore${exploration}`;
}

export function createStrategistPilot(budget: PilotBudget, seed: number, opts: StrategistOptions): StrategistPilot {
  const lines = new Map<string, LineChoice>();
  const weight = opts.priorWeight ?? PRIOR_WEIGHT;
  const id = opts.id ?? strategistId(opts.exploration);

  const lineFor = (run: RunState, seatId: string): LineChoice => {
    const hit = lines.get(seatId);
    if (hit) return hit;
    const setId = run.setId ?? 'set2';
    const k = opts.exploration === 'rotate'
      ? Math.abs(run.seed) % viableLineCount(run.heroId, run.tribes, setId)
      : opts.exploration;
    const line = pickLineForRun(run.heroId, run.tribes, run.seed ^ seed, k, setId);
    lines.set(seatId, line);
    return line;
  };

  const inner = createGeneralistPilot(budget, seed, {
    id,
    replaceMacro: true,
    wrap: (run: RunState, ctx: SeatContext, decide: () => Action | null): Action | null => {
      const line = lineFor(run, ctx.seatId);
      return withEvaluationPrior(linePrior(line), weight, decide);
    },
  });

  return {
    id,
    budget,
    exploration: opts.exploration,
    decide: inner.decide,
    lineOf: (seatId = 'seat') => lines.get(seatId),
    lastTrace: inner.lastTrace,
  };
}
