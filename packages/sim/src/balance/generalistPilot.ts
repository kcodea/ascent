import { makeRng, type Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, type Action, type RunState } from '../state';
import { applyCandidate, createPlanningRoot, release, visibleOf } from '../productionBots/transition';
import { fingerprint, toBotVisibleState } from '../productionBots/visibleState';
import { candidatesFor, positionCandidates, type Candidate } from '../productionBots/legalActions';
import { evaluate, offerAppeal } from '../productionBots/evaluate';
import { pilotSearch, type PlannedStep, type PilotSearchResult } from '../productionBots/pilotSearch';
import type { BotVisibleState, PlanningStateHandle } from '../productionBots/types';
import type { PilotBudget, SeatContext, SeatPilot } from './types';

/**
 * THE GENERALIST PILOT (balance roadmap B3) — a `SeatPilot` that plans through the production planning boundary.
 *
 * One recruit action per call. It never touches the run: every speculation happens behind a planning handle
 * (`productionBots/transition`), every action it returns has been VALIDATED against the reducer on a private
 * clone first, and its only randomness is a private RNG seeded from `(seed, round, decision)` for tie-breaks.
 *
 * The decision order, per call:
 *  1. Follow the queued plan while the live state still matches the step's fingerprint (this is what makes
 *     depth worth anything — committing step 1 and re-searching abandons the plan before its payoff).
 *  2. A mandatory decision (Discover / Choose One / aim / quest / power offer / forge / scout) is answered by
 *     evaluating every option, reveal-aware; it can never be skipped.
 *  3. Beam search (`pilotSearch`) under the budget; commit the first step of the best plan when it beats doing
 *     nothing, queue the rest.
 *  4. NEVER END THE TURN HOLDING SPENDABLE GOLD WITH ROOM TO USE IT — a human never does; Gold does not carry.
 *  5. Final positioning: try curated orders (Taunt forward, glass cannon back, the edge moves) and keep the one
 *     with the best fight score.
 *  6. `null` — end the turn.
 */

export const GENERALIST_BUDGETS: Record<'smoke' | 'dev' | 'deep', PilotBudget> = {
  smoke: { depth: 1, beam: 1, maxNodes: 40, positionCandidates: 2 },
  dev: { depth: 2, beam: 3, maxNodes: 200, positionCandidates: 4 },
  deep: { depth: 3, beam: 5, maxNodes: 800, positionCandidates: 6 },
};

/** Trace of one decision, for tests and reports. */
export interface GeneralistTrace {
  round: number;
  decision: number;
  route: 'queued' | 'mandatory' | 'search' | 'replace' | 'forcedSpend' | 'position' | 'endTurn';
  search?: PilotSearchResult;
  chosen: Action | null;
}

export interface GeneralistPilot extends SeatPilot {
  budget: PilotBudget;
  /** The last decision's trace (per seat). */
  lastTrace(seatId?: string): GeneralistTrace | undefined;
}

/** Is `action` accepted by the reducer from `run`? Checked on a private clone — the live run is never touched. */
function accepted(run: RunState, action: Action): boolean {
  const root = createPlanningRoot(run);
  try {
    const t = applyCandidate(root, action);
    release(t.child);
    return t.changed;
  } finally {
    release(root);
  }
}

/** Best of a set of candidates by full evaluation from `root`, seeded tie-break. Never null when one is legal. */
function bestOf(root: PlanningStateHandle, cands: Candidate[], rng: Rng, current?: number): { action: Action; utility: number } | null {
  let best: { action: Action; utility: number; key: number } | null = null;
  for (const c of cands) {
    const t = applyCandidate(root, c.action);
    const ok = t.changed;
    const utility = ok ? evaluate(t.visible).total : -Infinity;
    release(t.child);
    if (!ok) continue;
    const key = rng.next();
    if (!best || utility > best.utility || (utility === best.utility && key < best.key)) best = { action: c.action, utility, key };
  }
  if (!best) return null;
  if (current !== undefined && best.utility <= current + 1e-9) return null;
  return { action: best.action, utility: best.utility };
}

/**
 * The best use of Gold that would otherwise be destroyed at end of turn: field a hand minion, tier up, buy the
 * most appealing affordable offer, refresh. Each is validated; `null` only when Gold genuinely buys nothing.
 */
function forcedSpend(run: RunState, v: BotVisibleState): Action | null {
  const boardFull = v.board.length >= 7;
  const options: Action[] = [];
  if (!boardFull) for (const c of v.hand) options.push({ type: 'play', uid: c.uid, toIndex: v.board.length });
  if (v.economy.upgradeCost <= v.economy.gold && v.economy.tier < 6) options.push({ type: 'upgrade' });
  if (v.hand.length < 10) {
    for (const o of [...v.shop, ...(v.spellOffer ? [v.spellOffer] : [])]
      .filter((x) => x.cost <= v.economy.gold)
      .sort((a, b) => offerAppeal(b.cardId, b.attack, b.health, b.keywords) - offerAppeal(a.cardId, a.attack, a.health, a.keywords))) {
      options.push({ type: 'buy', uid: o.uid });
    }
  }
  if (v.economy.refreshCost <= v.economy.gold && v.economy.gold >= 2 && v.board.length < 7) options.push({ type: 'roll' });
  for (const action of options) if (accepted(run, action)) return action;
  return null;
}

/**
 * Curated final-arrangement candidates, most promising first: a Taunt to the front, the biggest attacker to the
 * back (a glass cannon behind a wall attacks later and soaks less), then the generic edge moves.
 */
function orderedPositionCandidates(v: BotVisibleState, limit: number): Candidate[] {
  const generic = positionCandidates(v);
  const first: Candidate[] = [];
  const taunt = v.board.find((c, i) => i > 0 && c.keywords.includes('T'));
  if (taunt) first.push({ action: { type: 'reposition', uid: taunt.uid, toIndex: 0 }, tag: `taunt ${taunt.cardId} forward` });
  const cannon = [...v.board].filter((c) => !c.keywords.includes('T')).sort((a, b) => b.attack - a.attack)[0];
  if (cannon && v.board[v.board.length - 1]?.uid !== cannon.uid) {
    first.push({ action: { type: 'reposition', uid: cannon.uid, toIndex: v.board.length - 1 }, tag: `${cannon.cardId} to the back` });
  }
  const seen = new Set(first.map((c) => JSON.stringify(c.action)));
  const rest = generic.filter((c) => !seen.has(JSON.stringify(c.action)));
  return [...first, ...rest].slice(0, Math.max(0, limit));
}

/**
 * B4 (additive): how a SPECIALIST reuses this pilot. `id` labels the records; `wrap` runs around every decision
 * so a specialist can install its prior (`withEvaluationPrior`) for exactly the duration of the search — the
 * generalist itself passes nothing and behaves as before.
 */
export interface GeneralistOptions {
  id?: string;
  wrap?: (run: RunState, ctx: SeatContext, decide: () => Action | null) => Action | null;
  /**
   * B4 (opt-in; the generalist leaves it off): the REPLACE macro — `sell <board minion> → buy <offer> → field it`
   * (or `sell → play <hand minion>`) scored as ONE candidate beside the search's best plan. Depth-1 search can
   * never find it: the sell alone reads as a lost body and the buy alone as Gold turned into a hand card, so a
   * full board of Tier-1 bodies is never replaced (measured 2026-09-15, 100 pinned set-2 lobbies: the pilot's
   * final boards were Orin / Packstrider / Cinderchef / Void Panther at wave 10+, 69 total stats at wave 8
   * against the players' 162). When the macro's end state beats the best plan, the sell is committed and the
   * rest is queued with fingerprints like any plan step.
   */
  replaceMacro?: boolean;
}

/** Board minions a replace macro may sell: the weakest few by printed body, never a golden. */
const REPLACE_SELL_CANDIDATES = 3;

/**
 * Enumerate replace macros from `root`: for each of the weakest board minions, sell it, then either buy an
 * affordable offer and field it, or field a hand minion. A chain that crosses a reveal (a Shout that discovers, a
 * random grant) is dropped rather than scored on the real future. Returns the best chain's steps + utility.
 */
function bestReplaceChain(root: PlanningStateHandle, v: BotVisibleState, rootFp: string): { steps: PlannedStep[]; utility: number } | null {
  if (v.board.length < 7 || v.mandatoryDecision) return null;
  const sellable = [...v.board]
    .filter((c) => !c.golden)
    .sort((a, b) => a.attack + a.health - (b.attack + b.health))
    .slice(0, REPLACE_SELL_CANDIDATES);
  let best: { steps: PlannedStep[]; utility: number } | null = null;
  const consider = (steps: PlannedStep[], utility: number): void => {
    if (!best || utility > best.utility) best = { steps, utility };
  };
  for (const m of sellable) {
    const sellAction: Action = { type: 'sell', uid: m.uid };
    const sold = applyCandidate(root, sellAction);
    try {
      if (!sold.changed || sold.reveal) continue;
      const sellStep: PlannedStep = { action: sellAction, tag: `replace: sell ${m.cardId}`, fromFingerprint: rootFp };
      const after = sold.visible;
      const seat = after.board.length;
      // Field a hand minion into the freed seat.
      for (const h of after.hand) {
        const def = CARD_INDEX[h.cardId];
        if (!def || def.spell || def.ruby) continue;
        const playAction: Action = { type: 'play', uid: h.uid, toIndex: seat };
        const played = applyCandidate(sold.child, playAction);
        try {
          if (!played.changed || played.reveal || played.visible.mandatoryDecision) continue;
          consider([sellStep, { action: playAction, tag: `field ${h.cardId}`, fromFingerprint: sold.fingerprint }], evaluate(played.visible).total);
        } finally { release(played.child); }
      }
      // Buy an offer and field it.
      for (const o of after.shop) {
        if (o.spell || o.cost > after.economy.gold || after.hand.length >= 10) continue;
        const buyAction: Action = { type: 'buy', uid: o.uid };
        const bought = applyCandidate(sold.child, buyAction);
        try {
          if (!bought.changed || bought.reveal) continue;
          const before = new Set(after.hand.map((c) => c.uid));
          const inHand = bought.visible.hand.find((c) => !before.has(c.uid));
          if (!inHand) continue;
          const playAction: Action = { type: 'play', uid: inHand.uid, toIndex: seat };
          const played = applyCandidate(bought.child, playAction);
          try {
            if (!played.changed || played.reveal || played.visible.mandatoryDecision) continue;
            consider([
              sellStep,
              { action: buyAction, tag: `buy ${o.cardId}`, fromFingerprint: sold.fingerprint },
              { action: playAction, tag: `field ${o.cardId}`, fromFingerprint: bought.fingerprint },
            ], evaluate(played.visible).total);
          } finally { release(played.child); }
        } finally { release(bought.child); }
      }
    } finally { release(sold.child); }
  }
  return best;
}

export function createGeneralistPilot(budget: PilotBudget, seed: number, opts: GeneralistOptions = {}): GeneralistPilot {
  const queues = new Map<string, PlannedStep[]>();
  const counters = new Map<string, number>();
  const traces = new Map<string, GeneralistTrace>();
  const samples = budget.depth >= 3 ? 4 : 3;

  const decideCore = (run: RunState, ctx: SeatContext): Action | null => {
    if (run.phase !== 'recruit') return null;
    const seatKey = ctx.seatId;
    const round = run.wave;
    const decision = (counters.get(seatKey) ?? 0) + 1;
    counters.set(seatKey, decision);
    // Private, deterministic randomness: never the run's RNG.
    const rng = makeRng(mixSeed(seed ^ round, decision) >>> 0);
    const panelSeed = mixSeed(seed, round, 0x9a7e1) >>> 0;
    const trace = (route: GeneralistTrace['route'], chosen: Action | null, search?: PilotSearchResult): Action | null => {
      traces.set(seatKey, { round, decision, route, chosen, ...(search ? { search } : {}) });
      return chosen;
    };

    // 1) The queued plan, while it still applies.
    const liveFp = fingerprint(toBotVisibleState(run));
    const queued = queues.get(seatKey) ?? [];
    if (queued.length > 0) {
      const [head, ...rest] = queued;
      if (head && head.fromFingerprint === liveFp && accepted(run, head.action)) {
        queues.set(seatKey, rest);
        return trace('queued', head.action);
      }
      queues.set(seatKey, []);
    }

    const root = createPlanningRoot(run);
    try {
      const visible = visibleOf(root);

      // 2) A blocked run is answered, never skipped.
      if (visible.mandatoryDecision) {
        const result = pilotSearch(root, { ...budget, depth: 1 }, panelSeed, rng, samples);
        const fromSearch = result.plan[0]?.action;
        if (fromSearch && accepted(run, fromSearch)) return trace('mandatory', fromSearch, result);
        const first = candidatesFor(visible).map((c) => c.action).find((a) => accepted(run, a));
        return trace('mandatory', first ?? null, result);
      }

      // 3) Search — and, when enabled, the replace macro scored beside its best plan.
      const result = pilotSearch(root, budget, panelSeed, rng, samples);
      if (opts.replaceMacro) {
        const chain = bestReplaceChain(root, visible, liveFp);
        if (chain && chain.utility > Math.max(result.utility, result.rootUtility) + 1e-9 && accepted(run, chain.steps[0]!.action)) {
          queues.set(seatKey, chain.steps.slice(1));
          return trace('replace', chain.steps[0]!.action, result);
        }
      }
      const head = result.plan[0];
      if (head && result.utility > result.rootUtility + 1e-9 && accepted(run, head.action)) {
        queues.set(seatKey, result.plan.slice(1));
        return trace('search', head.action, result);
      }

      // 4) Spend what would be destroyed.
      const spend = forcedSpend(run, visible);
      if (spend) return trace('forcedSpend', spend, result);

      // 5) Final arrangement — one improving move at a time; the runner calls again.
      const current = evaluate(visible).total;
      const move = bestOf(root, orderedPositionCandidates(visible, budget.positionCandidates), rng, current);
      if (move && accepted(run, move.action)) return trace('position', move.action, result);

      // 6) Nothing left worth doing.
      return trace('endTurn', null, result);
    } finally {
      release(root);
    }
  };

  const decide = opts.wrap
    ? (run: RunState, ctx: SeatContext): Action | null => opts.wrap!(run, ctx, () => decideCore(run, ctx))
    : decideCore;

  return {
    id: opts.id ?? 'generalist',
    budget,
    decide,
    lastTrace: (seatId = 'seat') => traces.get(seatId),
  };
}
