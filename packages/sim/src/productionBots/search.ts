import type { Rng } from '@game/core';
import type { Action } from '../state';
import { applyCandidate, release, visibleOf } from './transition';
import { candidatesFor } from './legalActions';
import { fingerprint } from './visibleState';
import { evaluate, expectedAfterRefresh, type EvaluationBreakdown } from './evaluate';
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
  // Depth-0 children kept in full. The blunder picks from THESE, not from the pruned beam: at beamWidth 1 the
  // beam after pruning IS the best node, so looking for the alternative there always found the thing it was
  // trying to avoid and the blunder silently never happened — every difficulty played identically.
  const rootChildren: Node[] = [];
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

        // A REVEAL is scored by EXPECTATION, never by its result: evaluating `t.visible` here would read the
        // shop the refresh actually produced, and the engine is seeded — that is reading the future of the very
        // decision being made. It did exactly that until this line existed.
        const breakdown = t.reveal?.kind === 'refresh' ? expectedAfterRefresh(visible) : evaluate(t.visible);
        const child: Node = {
          handle: t.child,
          plan: [...node.plan, { action: cand.action, tag: cand.tag, fromFingerprint: node.fp }],
          fp: t.fingerprint,
          utility: breakdown.total,
          breakdown,
          // A reveal is scored where it stands and never expanded — see the header.
          terminal: t.reveal !== null,
        };
        if (depth === 0) { rootAlternatives.push({ tag: cand.tag, utility: child.utility }); rootChildren.push(child); }
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

  rootChildren.sort((a, b) => b.utility - a.utility);
  // REPLACEMENT MACROS — the fix for the board fossilizing at full width.
  //
  // Measured at wave 10: expert boards averaged meanTier 1.73 against the human corpus's 4.21, and per-round
  // win rate collapsed from ~55% to ~0% starting exactly when boards fill (wave 6-7). The mechanism: once the
  // board is full, improving it is a SELL -> PLAY (or SELL -> BUY -> PLAY) sequence, and at depth 1 the sell is
  // scored alone — it always loses value, so it is always pruned, and the board keeps the tier-1 bodies it
  // filled up with at wave 3 forever. Deeper uniform search does not fix this (beam 1 prunes the sell before
  // its payoff is visible); scoring the SEQUENCE as one candidate does.
  //
  // Reuses the depth-0 sell children search already produced: the 3 least-bad sells each expand into plays of
  // hand minions and buy->play chains of affordable shop minions, and the whole plan is scored at its END state.
  if (rootVisible.board.length >= 7) {
    const sells = rootChildren
      .filter((n) => n.plan[0]?.action.type === 'sell')
      .sort((a, b) => b.utility - a.utility)
      .slice(0, 5);
    for (const sellNode of sells) {
      if (expanded >= profile.maxNodes + 80) break; // macros get their own small budget on top
      const afterSell = visibleOf(sellNode.handle);
      for (const cand of candidatesFor(afterSell)) {
        if (cand.action.type !== 'play' && cand.action.type !== 'buy') continue;
        if (expanded >= profile.maxNodes + 80) break;
        expanded++;
        const step2 = applyCandidate(sellNode.handle, cand.action);
        owned.push(step2.child);
        if (!step2.changed || step2.reveal) { release(step2.child); continue; }
        let endHandle = step2.child;
        let endVisible = step2.visible;
        let plan = [...sellNode.plan, { action: cand.action, tag: cand.tag, fromFingerprint: sellNode.fp }];
        if (cand.action.type === 'buy') {
          // The bought minion lands in hand; the macro only pays off once it is FIELDED. Find it by diffing the
          // hand and chain the play on.
          const before = new Set(afterSell.hand.map((c) => c.uid));
          const bought = endVisible.hand.find((c) => !before.has(c.uid));
          if (!bought) { continue; }
          const step3 = applyCandidate(endHandle, { type: 'play', uid: bought.uid, toIndex: endVisible.board.length });
          owned.push(step3.child);
          if (!step3.changed) { release(step3.child); continue; }
          expanded++;
          plan = [...plan, { action: { type: 'play', uid: bought.uid, toIndex: endVisible.board.length }, tag: `field ${bought.cardId}`, fromFingerprint: fingerprint(endVisible) }];
          endHandle = step3.child;
          endVisible = step3.visible;
        }
        const breakdown = evaluate(endVisible);
        const label = `replace: ${sellNode.plan[0]!.tag} -> ${cand.tag}`;
        const node: Node = { handle: endHandle, plan, fp: fingerprint(endVisible), utility: breakdown.total, breakdown, terminal: false };
        rootAlternatives.push({ tag: label, utility: node.utility });
        if (node.utility > best.utility) best = node;
      }
    }
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
        const alt = rootChildren.find((n) => n.plan[0]?.tag === pick.tag);
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
