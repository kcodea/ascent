import type { Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Action } from '../state';
import type { PilotBudget } from '../balance/types';
import { applyCandidate, release, sampleCandidate, visibleOf } from './transition';
import { candidatesFor, mandatoryCandidates, type Candidate } from './legalActions';
import { evaluate } from './evaluate';
import { questValue, runeValue } from '../runModel';
import type { PlanningStateHandle, PlanningTransition } from './types';

/**
 * THE GENERALIST'S SEARCH — bounded beam search over legal, VISIBLE action sequences, under a `PilotBudget`.
 *
 * It is a sibling of `search.ts` (the Practice bots' search) rather than a replacement: Practice needs blunders
 * and difficulty profiles; the balance pilot needs fairness that survives depth. Three things are different:
 *
 *  1. **Reveals are scored by SAMPLING, never by looking.** A refresh, a Discover-generating play, a random
 *     grant, a forge — anything `transition.ts` flags (statically by effect, dynamically by the RNG cursor) is
 *     scored as the mean of the evaluator over `samples` independent futures drawn from a panel fixed for the
 *     whole decision (`transition.ts::sampleCandidate`). The real child is never evaluated. This also gives a
 *     refresh a real expected value, which the old expectation model (score the same state minus the Gold)
 *     could not — it made refreshing read as pure loss.
 *  2. **Mandatory continuations are resolved before scoring.** A targeted Shout is `play` then `battlecryTarget`
 *     in this engine, a Choose One is `play` then `chooseOne` (then maybe an aim). Scoring the play with the
 *     prompt still open would value it as a vanilla body. So a child that is blocked on a decision is extended
 *     — every option applied, the best kept — without spending depth, the way a forced-move extension works in
 *     game search. The pilot controls those choices, so max over them is the honest value.
 *  3. **Tie-breaks are seeded.** Equal utilities are ordered by a private RNG the caller seeds per decision, so
 *     the pilot is deterministic without being biased toward generation order.
 */

export interface PlannedStep {
  action: Action;
  tag: string;
  /** Fingerprint of the visible state this step expects. A mismatch when its turn comes means the plan is
   *  stale (a reveal resolved differently, a trigger fired) and it is dropped rather than applied blind. */
  fromFingerprint: string;
}

export interface PilotSearchResult {
  /** The best plan found, root-first. Empty when nothing beat doing nothing. */
  plan: PlannedStep[];
  /** The evaluator's total at the end of `plan`. */
  utility: number;
  /** `evaluate()` of the root — "do nothing". */
  rootUtility: number;
  expandedNodes: number;
  /** Root-level alternatives, best first, for traces. */
  alternatives: { tag: string; utility: number; reveal: string | null }[];
}

interface Node {
  handle: PlanningStateHandle;
  plan: PlannedStep[];
  fp: string;
  utility: number;
  /** Seeded tie-break key. */
  key: number;
  /** A reveal was crossed (scored by sampling) — the handle points at the REAL child, which must not be read. */
  terminal: boolean;
}

/** Utility of a state, with the learned pick tables for quest / rune choices folded in (as `search.ts` does). */
function pickBonus(parentVisible: ReturnType<typeof visibleOf>, action: Action): number {
  const m = parentVisible.mandatoryDecision;
  if (action.type === 'buyQuest' && m?.kind === 'quest') return 20 * questValue(m.options[action.index] ?? '');
  if (action.type === 'buyRune' && m?.kind === 'runeforge') return 20 * runeValue(m.options[action.index] ?? '');
  return 0;
}

interface Scored {
  parent: PlanningStateHandle;
  transition: PlanningTransition & { action: Action };
  utility: number;
  /** The candidate's handle after mandatory continuations (the transition's child when there were none). */
  end: PlanningStateHandle;
  endFp: string;
  steps: PlannedStep[];
  terminal: boolean;
}

/** Search context for one decision. */
interface Ctx {
  budget: PilotBudget;
  panelSeed: number;
  samples: number;
  rng: Rng;
  expanded: number;
  owned: PlanningStateHandle[];
}

/**
 * Apply `cand` from `parent`, score it fairly, and resolve any mandatory continuation it opened.
 * Returns null when the reducer rejected it (or every sampled future did).
 */
function expand(ctx: Ctx, parent: PlanningStateHandle, parentFp: string, cand: Candidate): Scored | null {
  const parentVisible = visibleOf(parent);
  const t = applyCandidate(parent, cand.action);
  ctx.owned.push(t.child);
  ctx.expanded++;
  if (!t.changed) return null;
  const bonus = pickBonus(parentVisible, cand.action);
  const step: PlannedStep = { action: cand.action, tag: cand.tag, fromFingerprint: parentFp };
  if (t.reveal) {
    // Score by expectation over an independent panel of futures — never the real child.
    const samples = sampleCandidate(parent, cand.action, ctx.panelSeed, ctx.samples);
    ctx.expanded += samples.length;
    if (samples.length === 0) return null;
    const mean = samples.reduce((n, v) => n + evaluate(v).total, 0) / samples.length;
    return { parent, transition: { ...t, action: cand.action }, utility: mean + bonus, end: t.child, endFp: t.fingerprint, steps: [step], terminal: true };
  }
  // MANDATORY CONTINUATION — the child is blocked on a decision the pilot itself will make. Extend through it.
  let end = t.child;
  let endVisible = t.visible;
  let endFp = t.fingerprint;
  const steps = [step];
  let terminal = false;
  let utility = evaluate(endVisible).total;
  for (let guard = 0; guard < 4 && endVisible.mandatoryDecision; guard++) {
    let best: Scored | null = null;
    for (const mc of mandatoryCandidates(endVisible)) {
      if (ctx.expanded >= ctx.budget.maxNodes + 200) break; // continuations get a small budget of their own
      const sub = expand(ctx, end, endFp, mc);
      if (!sub) continue;
      if (!best || sub.utility > best.utility || (sub.utility === best.utility && ctx.rng.next() < 0.5)) best = sub;
    }
    if (!best) break; // nothing legal — leave the prompt open; the pilot answers it live with the fallback
    steps.push(...best.steps);
    end = best.end;
    endFp = best.endFp;
    utility = best.utility;
    terminal = best.terminal;
    if (terminal) break;
    endVisible = visibleOf(end);
  }
  return { parent, transition: { ...t, action: cand.action }, utility: utility + bonus, end, endFp, steps, terminal };
}

/**
 * BUY → FIELD, as one candidate.
 *
 * A bought minion sits in hand until it is played, and the fight-grounded evaluator (correctly) gives a body in
 * hand a fraction of a body on the board. So at depth 1 a buy is scored as "Gold spent, nothing gained" and a
 * triple's third copy — which pulls two bodies OFF the board to make one golden in hand — reads as a disaster.
 * Humans buy in order to play; the chain is generated as its own candidate beside the plain buy (`search.ts`
 * learned the same lesson with its sell → buy → play macro). The play goes through `expand`, so its own reveal
 * (a golden's triple Discover) and continuations (a Shout's aim) are handled the same way as everything else.
 */
function chainField(ctx: Ctx, buy: Scored): Scored | null {
  if (buy.terminal || buy.transition.action.type !== 'buy') return null;
  const after = visibleOf(buy.end);
  if (after.mandatoryDecision || after.board.length >= 7) return null;
  const parentVisible = visibleOf(buy.parent);
  const before = new Set(parentVisible.hand.map((c) => c.uid));
  const bought = after.hand.find((c) => !before.has(c.uid));
  if (!bought) return null;
  const def = CARD_INDEX[bought.cardId];
  if (!def || def.spell || def.ruby) return null;
  const play = expand(ctx, buy.end, buy.endFp, { action: { type: 'play', uid: bought.uid, toIndex: after.board.length }, tag: `field ${bought.cardId}` });
  if (!play) return null;
  return { ...play, steps: [...buy.steps, ...play.steps], utility: play.utility };
}

/**
 * Plan from `root`. The caller owns `root`; every handle the search creates is released before it returns.
 * `panelSeed` fixes the sampled-future panel for the decision; `rng` breaks ties.
 */
export function pilotSearch(root: PlanningStateHandle, budget: PilotBudget, panelSeed: number, rng: Rng, samples = 3): PilotSearchResult {
  const rootVisible = visibleOf(root);
  const rootUtility = evaluate(rootVisible).total;
  const ctx: Ctx = { budget, panelSeed, samples, rng, expanded: 0, owned: [] };
  const rootFp = JSON.stringify(rootVisible);
  let beam: Node[] = [{ handle: root, plan: [], fp: rootFp, utility: rootUtility, key: 0, terminal: false }];
  let best: Node | null = null;
  const alternatives: PilotSearchResult['alternatives'] = [];

  for (let depth = 0; depth < Math.max(1, budget.depth); depth++) {
    const next: Node[] = [];
    const seen = new Set<string>();
    for (const node of beam) {
      if (node.terminal) continue;
      const visible = visibleOf(node.handle);
      for (const cand of candidatesFor(visible)) {
        if (ctx.expanded >= budget.maxNodes) break;
        const plain = expand(ctx, node.handle, node.fp, cand);
        if (!plain) continue;
        const chained = chainField(ctx, plain);
        for (const scored of chained ? [plain, chained] : [plain]) {
        if (depth === 0) alternatives.push({ tag: scored.steps.map((x) => x.tag).join(' → '), utility: scored.utility, reveal: scored.transition.reveal?.kind ?? null });
        // Two different action sequences reaching the same visible state are the same node; keeping both
        // multiplies the beam without adding an idea. A sampled (terminal) node is never deduplicated: its
        // handle's fingerprint is the REAL child's, which is not what it was scored on.
        if (!scored.terminal) {
          if (seen.has(scored.endFp)) continue;
          seen.add(scored.endFp);
        }
        const child: Node = {
          handle: scored.end,
          plan: [...node.plan, ...scored.steps],
          fp: scored.endFp,
          utility: scored.utility,
          key: rng.next(),
          terminal: scored.terminal,
        };
        next.push(child);
        if (!best || child.utility > best.utility || (child.utility === best.utility && child.key < best.key)) best = child;
        }
      }
      if (ctx.expanded >= budget.maxNodes) break;
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.utility - a.utility || a.key - b.key);
    beam = next.slice(0, Math.max(1, budget.beam));
    if (ctx.expanded >= budget.maxNodes) break;
  }

  alternatives.sort((a, b) => b.utility - a.utility);
  const result: PilotSearchResult = {
    plan: best ? best.plan : [],
    utility: best ? best.utility : rootUtility,
    rootUtility,
    expandedNodes: ctx.expanded,
    alternatives: alternatives.slice(0, 10),
  };
  for (const h of ctx.owned) release(h);
  return result;
}
