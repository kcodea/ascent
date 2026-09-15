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
import type { SetId } from '@game/content';
import { mixSeed, type Action, type RunState } from '../../state';
import type { BotVisibleState } from '../../productionBots/types';
import { withEvaluationPrior } from '../../productionBots/evaluate';
import { completionTermOf, horizonTermOf, withGrowth, type HorizonTerm } from '../../productionBots/growth';
import { createGeneralistPilot, type GeneralistPilot, type MacroCommitment, type MacroOptions } from '../generalistPilot';
import { comboProgress, combosFor, completionChance, type EngineCombo } from './combos';
import { OPERATORS } from './operators/operatorPilot';
import { operatorFeedActions } from './operators/feedSteps';
import type { PilotBudget, SeatContext, SeatPilot } from '../types';
import { pickLineForRun, viableLineCount, type LineChoice, type LineImitation } from './lines';
import { GROWTH_WEIGHT, HORIZON_FIGHT_WEIGHT, HORIZON_WEIGHT, IMITATION_WEIGHT, linePrior, MACRO_COMMIT_FROM, MACRO_COMMIT_GAIN, MACRO_COMMIT_TO, MACRO_FIGHT_WEIGHT, MACRO_PIVOT_WAVE, MACRO_PROBED, MACRO_RESERVE, MACRO_SEEDS, MACRO_WEIGHT, PRIOR_WEIGHT, VALUE_WEIGHT } from './prior';
import { loadDefaultValueModel, type ValueModel } from '../value';
import { loadDefaultImitationModel, parseScoreOptions, type ImitationModel } from '../imitation';

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
  /** B7: inference variant flags for the imitation term ("positive", "cardsOnly"; see `parseScoreOptions`). */
  imitationVariant?: string;
  /** B6: weight of the ENGINE-GROWTH term (`productionBots/growth.ts`) in utility units; 0 turns the probe off.
   *  Default `GROWTH_WEIGHT`. */
  growthWeight?: number;
  /** B6 round 2: the horizon re-ranking's weights (see `PilotBudget`); 0 / 0 = no horizon probe. Defaults
   *  `HORIZON_WEIGHT` / `HORIZON_FIGHT_WEIGHT`. */
  horizonWeight?: number;
  horizonFightWeight?: number;
  horizonTop?: number;
  /** B11: the ENGINE-COMBO MACROS (`generalistPilot.ts::MacroOptions`, `combos.ts`). `macroWeight` (utility per
   *  normalised point of the completion-weighted two-turn yield; 0 = macros off), `macroFightWeight` (utility per
   *  point of the completed board's fight at wave + 2), `macroReserve` (Gold a turn into refreshes while committed
   *  and a piece is missing), `macroCommitFrom` / `macroCommitTo` (the commit-and-roll window), `macroPivotWave`.
   *  Defaults `MACRO_*` in `prior.ts`. */
  macroWeight?: number;
  macroFightWeight?: number;
  macroReserve?: number;
  macroCommitFrom?: number;
  macroCommitTo?: number;
  macroPivotWave?: number;
  /** B11: imagined futures per completion / horizon probe under the macros (default `MACRO_SEEDS` = 2 — the
   *  runtime budget; 3 is the horizon's own default) and the expected utility gain that commits the reserve
   *  (default `MACRO_COMMIT_GAIN`). */
  macroSeeds?: number;
  macroCommitGain?: number;
}

export interface StrategistPilot extends SeatPilot {
  budget: PilotBudget;
  exploration: number | 'rotate';
  /** The line chosen for a seat (undefined before its first decision). */
  lineOf(seatId?: string): LineChoice | undefined;
  /** The wrapped generalist's last decision trace. */
  lastTrace: GeneralistPilot['lastTrace'];
  /** B11: the combo a seat is committed to assembling (undefined = none / macros off). */
  commitmentOf(seatId?: string): MacroCommitment | undefined;
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
  const imitationOptions = parseScoreOptions(opts.imitationVariant ?? budget.imitationVariant);
  const growthWeight = opts.growthWeight ?? budget.growthWeight ?? GROWTH_WEIGHT;
  const horizonWeight = opts.horizonWeight ?? budget.horizonWeight ?? HORIZON_WEIGHT;
  const horizonFightWeight = opts.horizonFightWeight ?? budget.horizonFightWeight ?? HORIZON_FIGHT_WEIGHT;
  const horizonTop = opts.horizonTop ?? budget.horizonTop ?? 3;
  const macroWeight = opts.macroWeight ?? budget.macroWeight ?? MACRO_WEIGHT;
  const macroFightWeight = opts.macroFightWeight ?? budget.macroFightWeight ?? MACRO_FIGHT_WEIGHT;
  const macroReserve = opts.macroReserve ?? budget.macroReserve ?? MACRO_RESERVE;
  const macroCommitFrom = opts.macroCommitFrom ?? budget.macroCommitFrom ?? MACRO_COMMIT_FROM;
  const macroCommitTo = opts.macroCommitTo ?? budget.macroCommitTo ?? MACRO_COMMIT_TO;
  const macroPivotWave = opts.macroPivotWave ?? budget.macroPivotWave ?? MACRO_PIVOT_WAVE;
  const macroSeeds = opts.macroSeeds ?? budget.macroSeeds ?? MACRO_SEEDS;
  const macroCommitGain = opts.macroCommitGain ?? budget.macroCommitGain ?? MACRO_COMMIT_GAIN;
  const macrosOn = macroWeight > 0;
  const horizonOn = horizonWeight > 0 || horizonFightWeight > 0;
  // The horizon probe's panel seed for the decision in flight (set by `wrap`, read by `horizon`).
  let horizonSeed = 0;
  // B11: the run in flight (player-visible facts the macro term needs: tribes, set) — set by `wrap`.
  let current: { tribes: readonly string[]; setId: string; combos: readonly EngineCombo[] } | null = null;
  let currentSeat = 'seat';
  const comboCache = new Map<string, readonly EngineCombo[]>();
  const combosOf = (run: RunState, line: LineChoice): readonly EngineCombo[] => {
    const key = `${run.setId ?? 'set2'}|${[...run.tribes].sort().join(',')}|${line.primary}|${line.secondary ?? ''}`;
    const hit = comboCache.get(key);
    if (hit) return hit;
    // The run's line first (its packages), then the rest — a combo of another tribe the run rolled is still a plan.
    const rank = (c: EngineCombo): number => (c.packages.includes(line.primary) ? 0 : line.secondary && c.packages.includes(line.secondary) ? 1 : 2);
    const list = [...combosFor((run.setId ?? 'set2') as SetId, run.tribes)].sort((a, b) => rank(a) - rank(b));
    comboCache.set(key, list);
    return list;
  };
  /**
   * B11 — THE MACRO TERM: the horizon re-ranking with the COMPLETION probe folded in. For a state holding part of
   * a combo, the credited number is `p × completed + (1 − p) × held` — the two-turn probe of the board WITH the
   * missing pieces found, weighted by the chance of drawing them over the commit window, else the plain horizon.
   * The best combo wins; a state with no stake in any combo reads the plain horizon.
   */
  const value = (h: HorizonTerm | null): number | null => (h ? h.growth2 * macroWeight + h.fight2 * macroFightWeight : null);
  /** The expected gain (utility) of assembling `combo` from `v` over holding what `v` holds: p × (completed − held). */
  const comboGain = (combo: EngineCombo, v: BotVisibleState, plain: number | null): number | null => {
    if (!current || v.wave < combo.fromWave) return null;
    const prog = comboProgress(combo, v);
    if (prog.heldPieces === 0 || prog.missing.length === 0) return null;
    const completed = value(completionTermOf(v, horizonSeed, prog.missing, macroSeeds));
    if (completed === null) return null;
    const inWindow = v.wave >= macroCommitFrom && v.wave <= macroCommitTo;
    const rollsPerTurn = 1 + (inWindow ? Math.floor(macroReserve / Math.max(1, v.economy.refreshCost)) : 0);
    const turns = Math.max(1, macroPivotWave - v.wave);
    const p = completionChance(current.setId as SetId, current.tribes, prog.missing, v.economy.tier, { rollsPerTurn, turns });
    return p * (completed - (plain ?? 0));
  };
  /** The combos worth probing from `v`, most advanced first (the committed one leads), capped at `MACRO_PROBED`
   *  — the dragon roster alone has five combos sharing Chorus Drake, and each probe is two imagined futures. */
  const stakes = (v: BotVisibleState, committedId: string | undefined): EngineCombo[] => {
    if (!current) return [];
    return current.combos
      .map((combo, rank) => ({ combo, rank, prog: comboProgress(combo, v) }))
      .filter((x) => v.wave >= x.combo.fromWave && x.prog.heldPieces > 0 && x.prog.missing.length > 0)
      .sort((a, b) => (b.combo.id === committedId ? 1 : 0) - (a.combo.id === committedId ? 1 : 0) || b.prog.heldPieces - a.prog.heldPieces || a.rank - b.rank)
      .slice(0, MACRO_PROBED)
      .map((x) => x.combo);
  };
  const macroTerm = (v: BotVisibleState): number | null => {
    const plain = value(horizonTermOf(v, horizonSeed, macroSeeds));
    if (!current) return plain;
    let best = plain;
    for (const combo of stakes(v, inner?.commitmentOf(currentSeat)?.comboId)) {
      const gain = comboGain(combo, v, plain);
      if (gain === null) continue;
      const term = (plain ?? 0) + gain;
      if (best === null || term > best) best = term;
    }
    return best;
  };
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

  const macroOptions: MacroOptions | undefined = macrosOn ? {
    combos: (run) => current?.combos ?? combosOf(run, lineFor(run, 'seat')),
    feed: (combo, v, run, refused) => (combo.line === 'none' ? [] : operatorFeedActions(OPERATORS[combo.line], v, run, refused)),
    reserve: macroReserve,
    commitFrom: macroCommitFrom,
    commitTo: macroCommitTo,
    pivotWave: macroPivotWave,
    worth: (combo, v) => (comboGain(combo, v, value(horizonTermOf(v, horizonSeed, macroSeeds))) ?? -Infinity) >= macroCommitGain,
  } : undefined;
  // eslint-disable-next-line prefer-const
  let inner: GeneralistPilot | undefined;
  inner = createGeneralistPilot(budget, seed, {
    id,
    replaceMacro: true,
    handDiscipline: true,
    ...(macrosOn ? { horizonTop: opts.horizonTop ?? budget.horizonTop ?? 0, horizon: macroTerm, macros: macroOptions } : horizonOn ? {
      horizonTop,
      horizon: (v) => {
        const h = horizonTermOf(v, horizonSeed);
        return h ? h.growth2 * horizonWeight + h.fight2 * horizonFightWeight : null;
      },
    } : {}),
    wrap: (run: RunState, ctx: SeatContext, decide: () => Action | null): Action | null => {
      const line = lineFor(run, ctx.seatId);
      const setId = run.setId ?? 'set2';
      if (macrosOn) { current = { tribes: run.tribes, setId, combos: combosOf(run, line) }; currentSeat = ctx.seatId; }
      // B6: one growth panel seed per (pilot, round) — every candidate of every decision this turn is probed
      // against the same imagined future, and the probe cache carries across the turn's decisions.
      horizonSeed = mixSeed(seed, run.wave, 0x6f07) >>> 0;
      const growth = growthWeight > 0 ? { weight: growthWeight, panelSeed: horizonSeed } : null;
      return withGrowth(growth, () => withEvaluationPrior(linePrior(line, { value: modelFor(setId), imitation: imitationFor(setId) }, { value: valueWeight, imitation: imitationWeight, imitationOptions }), weight, decide));
    },
  });

  return {
    id,
    budget,
    exploration: opts.exploration,
    decide: inner.decide,
    lineOf: (seatId = 'seat') => lines.get(seatId),
    lastTrace: inner.lastTrace,
    commitmentOf: inner.commitmentOf,
  };
}
