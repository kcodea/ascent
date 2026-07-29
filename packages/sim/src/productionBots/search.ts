import type { Rng } from '@game/core';
import type { Action } from '../state';
import { applyCandidate, release, visibleOf } from './transition';
import { candidatesFor } from './legalActions';
import { fingerprint } from './visibleState';
import { evaluate, type EvaluationBreakdown } from './evaluate';
import type { BotDifficultyProfile } from './difficulties';
import type { PlanningStateHandle } from './types';

/**
 * BOUNDED BEAM SEARCH over legal, VISIBLE action sequences.
 *
 * Returns the first action of the best plan it found — the bot commits one action at a time so it stays
 * compatible with the reducer and the UI, and replans after anything random resolves.
 *
 * Two rules the search is built around:
 *
 *  - **It stops at reveal boundaries.** A refresh is scored, never expanded. The engine is seeded, so expanding
 *    a refresh would let the bot read the shop it is deciding whether to buy — deterministic and still cheating.
 *  - **It never expands `faceOmen`.** Ending the turn terminates every branch immediately; if it were a
 *    candidate the beam would find "end turn now" is cheapest and explore nothing. The controller adds it.
 */

/** One step of a plan, with the state it is valid against. */
export interface PlannedStep {
  action: Action;
  tag: string;
  /** Fingerprint of the state this step expects. If the live state doesn't match when its turn comes, the plan
   *  is stale and is discarded rather than applied blind. */
  fromFingerprint: string;
}

export interface SearchResult {
  action: Action | null;
  /** The whole plan found. The controller QUEUES it — see the note there on why committing only the first
   *  action and re-searching made deeper search play worse than no search at all. */
  plan: PlannedStep[];
  utility: number;
  breakdown: EvaluationBreakdown;
  expandedNodes: number;
  /** Set when the chosen action was a deliberate, seeded near-best pick rather than the best. */
  blundered: boolean;
  /** Alternatives considered at the root, best first — the "why not that instead" half of a trace. */
  alternatives: { tag: string; utility: number }[];
}

interface Node {
  handle: PlanningStateHandle;
  plan: PlannedStep[];
  /** This node's own fingerprint — the `fromFingerprint` of any step expanded out of it. */
  fp: string;
  utility: number;
  breakdown: EvaluationBreakdown;
  /** True once this node may not be expanded further (a reveal, or the depth cap). */
  terminal: boolean;
}

export function search(root: PlanningStateHandle, profile: BotDifficultyProfile, rng: Rng): SearchResult {
  const rootVisible = visibleOf(root);
  const rootEval = evaluate(rootVisible);
  let expanded = 0;

  const rootFp = fingerprint(rootVisible);
  let beam: Node[] = [{ handle: root, plan: [], fp: rootFp, utility: rootEval.total, breakdown: rootEval, terminal: false }];
  let best: Node = beam[0]!;
  const rootAlternatives: { tag: string; utility: number }[] = [];
  // Handles created during search, released at the end so planning memory can't accumulate across decisions.
  const owned: PlanningStateHandle[] = [];

  for (let depth = 0; depth < profile.maxDepth; depth++) {
    const next: Node[] = [];
    const seen = new Set<string>();
    for (const node of beam) {
      if (node.terminal) continue;
      const visible = visibleOf(node.handle);
      for (const cand of candidatesFor(visible)) {
        if (expanded >= profile.maxNodes) break;
        expanded++;
        const t = applyCandidate(node.handle, cand.action);
        owned.push(t.child);
        // The reducer rejected it — not a legal move from here, whatever the projection suggested.
        if (!t.changed) { release(t.child); continue; }
        // Two different action sequences reaching the same visible state are the same node; keeping both
        // multiplies the beam without adding an idea.
        if (seen.has(t.fingerprint)) { release(t.child); continue; }
        seen.add(t.fingerprint);

        const breakdown = evaluate(t.visible);
        const child: Node = {
          handle: t.child,
          plan: [...node.plan, { action: cand.action, tag: cand.tag, fromFingerprint: node.fp }],
          fp: t.fingerprint,
          utility: breakdown.total,
          breakdown,
          // A reveal is scored where it stands and never expanded — see the header.
          terminal: t.reveal !== null,
        };
        if (depth === 0) rootAlternatives.push({ tag: cand.tag, utility: child.utility });
        next.push(child);
        if (child.utility > best.utility) best = child;
      }
      if (expanded >= profile.maxNodes) break;
    }
    if (next.length === 0) break;
    // Keep the top K. A diversity reserve (different package directions) belongs here once Ticket 3 gives the
    // bot a notion of direction to be diverse about; until then top-K is honest.
    next.sort((a, b) => b.utility - a.utility);
    beam = next.slice(0, profile.beamWidth);
    if (expanded >= profile.maxNodes) break;
  }

  rootAlternatives.sort((a, b) => b.utility - a.utility);

  // BLUNDER — a seeded pick among near-best root actions, so a weak bot makes ordinary mistakes (the second
  // best buy) rather than incoherent ones. Only ever chooses from candidates within `maxRegret` of the best,
  // and never applies to a mandatory decision, where "a slightly worse option" can mean stalling the run.
  let blundered = false;
  let chosen = best;
  if (profile.blunderRate > 0 && !rootVisible.mandatoryDecision && best.plan.length > 0) {
    if (rng.next() < profile.blunderRate) {
      const bar = Math.abs(best.utility) * profile.maxRegret;
      const nearBest = rootAlternatives.filter((a) => best.utility - a.utility <= bar);
      if (nearBest.length > 1) {
        const pick = nearBest[rng.int(nearBest.length)]!;
        // Re-derive the node whose plan starts with that action — the beam may have dropped it, in which case
        // the blunder simply doesn't happen rather than committing something unsearched.
        const alt = [...beam, best].find((n) => n.plan[0]?.tag === pick.tag);
        if (alt && alt !== best) { chosen = alt; blundered = true; }
      }
    }
  }

  const result: SearchResult = {
    action: chosen.plan[0]?.action ?? null,
    plan: chosen.plan,
    utility: chosen.utility,
    breakdown: chosen.breakdown,
    expandedNodes: expanded,
    blundered,
    alternatives: rootAlternatives.slice(0, 8),
  };
  for (const h of owned) release(h);
  return result;
}
