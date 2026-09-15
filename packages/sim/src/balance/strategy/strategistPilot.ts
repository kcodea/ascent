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
import { pickLineForRun, viableLineCount, type LineChoice, type LineImitation } from './lines';
import { IMITATION_WEIGHT, linePrior, PRIOR_WEIGHT, VALUE_WEIGHT } from './prior';
import { loadDefaultValueModel, type ValueModel } from '../value';
import { loadDefaultImitationModel, type ImitationModel } from '../imitation';

export interface StrategistOptions {
  /** 0 = best fit; k = k-th best viable line; 'rotate' = k from the run seed (a per-seed rotation). */
  exploration: number | 'rotate';
  /** Override the prior's weight (tests / tuning). Default `PRIOR_WEIGHT`. */
  priorWeight?: number;
  /** Record label; defaults to `strategist` / `strategist:explore<k>` / `strategist:rotate`. */
  id?: string;
  /** Weight of the learned value term (`balance/value`, the survival model fit on recorded players) in utility
   *  units; 0 disables it. Default `VALUE_WEIGHT`. The model is the set's committed one (`loadDefaultValueModel`). */
  valueWeight?: number;
  /** B7: weight of the IMITATION term (`balance/imitation`, the per-card survivor table fit on the recorded players)
   *  in utility units per log-odds point; 0 disables it. Default `IMITATION_WEIGHT`. */
  imitationWeight?: number;
  /** B7: how much the survivors' card table shapes LINE choice (`lines.ts`: fit × (1 + weight × affinity)); 0 = the
   *  content-derived fit alone. Default 0. */
  imitationLineWeight?: number;
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
  const weight = opts.priorWeight ?? budget.priorWeight ?? PRIOR_WEIGHT;
  const valueWeight = opts.valueWeight ?? budget.valueWeight ?? VALUE_WEIGHT;
  const imitationWeight = opts.imitationWeight ?? budget.imitationWeight ?? IMITATION_WEIGHT;
  const imitationLineWeight = opts.imitationLineWeight ?? budget.imitationLineWeight ?? 0;
  const models = new Map<string, ValueModel | null>();
  const modelFor = (setId: string): ValueModel | null => {
    if (valueWeight === 0) return null;
    if (!models.has(setId)) models.set(setId, loadDefaultValueModel(setId));
    return models.get(setId) ?? null;
  };
  const imitationModels = new Map<string, ImitationModel | null>();
  const imitationFor = (setId: string): ImitationModel | null => {
    if (imitationWeight === 0 && imitationLineWeight === 0) return null;
    if (!imitationModels.has(setId)) imitationModels.set(setId, loadDefaultImitationModel(setId));
    return imitationModels.get(setId) ?? null;
  };
  const id = opts.id ?? strategistId(opts.exploration);

  const lineFor = (run: RunState, seatId: string): LineChoice => {
    const hit = lines.get(seatId);
    if (hit) return hit;
    const setId = run.setId ?? 'set2';
    const k = opts.exploration === 'rotate'
      ? Math.abs(run.seed) % viableLineCount(run.heroId, run.tribes, setId)
      : opts.exploration;
    const im = imitationFor(setId);
    const imitation: LineImitation | undefined = im && imitationLineWeight > 0 ? { model: im, weight: imitationLineWeight } : undefined;
    const line = pickLineForRun(run.heroId, run.tribes, run.seed ^ seed, k, setId, imitation);
    lines.set(seatId, line);
    return line;
  };

  const inner = createGeneralistPilot(budget, seed, {
    id,
    replaceMacro: true,
    handDiscipline: true,
    wrap: (run: RunState, ctx: SeatContext, decide: () => Action | null): Action | null => {
      const line = lineFor(run, ctx.seatId);
      const setId = run.setId ?? 'set2';
      return withEvaluationPrior(linePrior(line, { value: modelFor(setId), imitation: imitationFor(setId) }, { value: valueWeight, imitation: imitationWeight }), weight, decide);
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
