import { makeRng, type Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, type Action, type RunState } from '../state';
import { applyCandidate, createPlanningRoot, release, visibleOf } from '../productionBots/transition';
import { fingerprint, toBotVisibleState } from '../productionBots/visibleState';
import { candidatesFor, positionCandidates, type Candidate } from '../productionBots/legalActions';
import { evaluate, offerAppeal } from '../productionBots/evaluate';
import { lastFightResult, withScout } from '../productionBots/fightScore';
import { scoutFromContext, survivalTerm, type SeatScout } from '../productionBots/scout';
import { pilotSearch, type PlannedStep, type PilotSearchResult } from '../productionBots/pilotSearch';
import type { BotOfferView, BotVisibleState, PlanningStateHandle } from '../productionBots/types';
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
function bestOf(root: PlanningStateHandle, cands: Candidate[], rng: Rng, current?: number, score: (v: BotVisibleState) => number = (v) => evaluate(v).total, visited?: Set<string>): { action: Action; utility: number } | null {
  let best: { action: Action; utility: number; key: number } | null = null;
  for (const c of cands) {
    const t = applyCandidate(root, c.action);
    // An arrangement already visited this turn is never re-entered (the A → B → A loop hit on 2026-09-15,
    // pinned seed 66: two edge moves each read as an improvement from the other side and the turn never ended).
    const ok = t.changed && !(visited?.has(t.fingerprint));
    const utility = ok ? score(t.visible) : -Infinity;
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
function forcedSpend(run: RunState, v: BotVisibleState, handDiscipline = false, score?: (v: BotVisibleState) => number): Action | null {
  const boardFull = v.board.length >= 7;
  const options: Action[] = [];
  if (!boardFull) {
    // A hand body is fielded here only when it is not CLEARLY worse than leaving it (within `FORCED_PLAY_TOLERANCE`
    // of the current utility): the search already rejected every play it reached, and fielding one it rejected
    // starts a play → sell → play loop with the next search (B6, 2026-09-15: seed 52 hit the 60-action guard at
    // round 11 fielding and selling hand bodies one after another). Plays the search never reached (budget) still
    // get their chance.
    const current = score ? score(v) : undefined;
    const root = score ? createPlanningRoot(run) : null;
    try {
      for (const c of v.hand) {
        const action: Action = { type: 'play', uid: c.uid, toIndex: v.board.length };
        if (root && current !== undefined) {
          const t = applyCandidate(root, action);
          const ok = t.changed && (t.reveal !== null || score!(t.visible) >= current - FORCED_PLAY_TOLERANCE);
          release(t.child);
          if (!ok) continue;
        }
        options.push(action);
      }
    } finally {
      if (root) release(root);
    }
  }
  if (v.economy.upgradeCost <= v.economy.gold && v.economy.tier < 6) options.push({ type: 'upgrade' });
  // HAND DISCIPLINE (B4, opt-in): with a full board, a bought minion sits in hand — measured 2026-09-15 (100 pinned
  // set-2 lobbies): the hand grew from 3.6 to 9.1 UNPLAYED cards from round 6 while the board never changed. So
  // only buy what can matter: a triple piece (a copy of a non-golden card held), a minion that beats the worst
  // board body by a margin (the replace macro fields it next decision), or a spell (cast, not held). Otherwise
  // a refresh is the better use of the Gold.
  const worstBody = boardFull ? Math.min(...v.board.map((c) => c.attack + c.health)) : 0;
  const held = new Set([...v.board, ...v.hand].filter((c) => !c.golden).map((c) => c.cardId));
  const worthHolding = (o: BotOfferView): boolean => {
    if (!handDiscipline || !boardFull) return true;
    if (o.spell) return true;
    if (held.has(o.cardId)) return true;
    return o.attack + o.health >= worstBody + 2;
  };
  const buys: Action[] = [];
  if (v.hand.length < 10) {
    for (const o of [...v.shop, ...(v.spellOffer ? [v.spellOffer] : [])]
      .filter((x) => x.cost <= v.economy.gold && worthHolding(x))
      .sort((a, b) => offerAppeal(b.cardId, b.attack, b.health, b.keywords) - offerAppeal(a.cardId, a.attack, a.health, a.keywords))) {
      buys.push({ type: 'buy', uid: o.uid });
    }
  }
  const roll: Action[] = v.economy.refreshCost <= v.economy.gold && v.economy.gold >= 2 && (v.board.length < 7 || handDiscipline) ? [{ type: 'roll' }] : [];
  // Disciplined and full: `buys` already holds only the non-marginal offers (a triple piece, a spell, a body that
  // beats the worst one), so they come first and the refresh is the fallback when nothing qualifies. The first
  // version put the roll FIRST here, which read as "refresh ahead of a marginal buy" but meant "refresh ahead of
  // EVERY buy": with a full board the pilot rolled its whole turn away (B6, 2026-09-15: 8 rolls and one buy on
  // 10 Gold at wave 8, past a Standard Bearer, a Chorus Drake and a Gangplank it never took).
  options.push(...buys, ...roll);
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
  /** B4 (opt-in): HAND DISCIPLINE in the forced spend — with a full board buy only triple pieces, spells, or a
   *  minion that beats the worst body (see `forcedSpend`); refresh ahead of a marginal buy. Off for the generalist. */
  handDiscipline?: boolean;
}

/** How far below the current utility a forced hand play may fall before it is left in hand (see `forcedSpend`). */
const FORCED_PLAY_TOLERANCE = 3;

/** Board minions a replace macro may sell: the weakest few by printed body, never a golden. */
const REPLACE_SELL_CANDIDATES = 3;

/**
 * Enumerate replace macros from `root`: for each of the weakest board minions, sell it, then either buy an
 * affordable offer and field it, or field a hand minion. A chain that crosses a reveal (a Shout that discovers, a
 * random grant) is dropped rather than scored on the real future. Returns the best chain's steps + utility.
 */
function bestReplaceChain(root: PlanningStateHandle, v: BotVisibleState, rootFp: string, score: (v: BotVisibleState) => number): { steps: PlannedStep[]; utility: number } | null {
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
          consider([sellStep, { action: playAction, tag: `field ${h.cardId}`, fromFingerprint: sold.fingerprint }], score(played.visible));
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
            ], score(played.visible));
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
  /** Arrangement fingerprints visited during the current turn's positioning pass (one turn at a time). */
  const arranged = new Map<string, Set<string>>();
  const traces = new Map<string, GeneralistTrace>();
  const samples = budget.depth >= 3 ? 4 : 3;
  // SCOUTING (additive, 2026-09-15 — `productionBots/scout.ts`). Off unless the budget says so, so a job without
  // the flag reproduces the pre-scouting numbers. When on, every `fightScore` inside this decision fights the
  // scouted panel (`withScout`), and the utility folds in the survival term at `survivalWeight`.
  const scouting = budget.scouting === true;
  const survivalWeight = budget.survivalWeight ?? 0;
  const scoreWith = (scout: SeatScout | null) => (v: BotVisibleState): number => {
    const total = evaluate(v).total;
    if (!scout || survivalWeight === 0) return total;
    const dmg = lastFightResult(v)?.expectedDamageTaken;
    return dmg === undefined ? total : total + survivalWeight * survivalTerm(scout, dmg);
  };

  const decideCore = (run: RunState, ctx: SeatContext): Action | null => {
    const scout = scouting ? scoutFromContext(ctx) : null;
    return withScout(scout, () => decideInner(run, ctx, scoreWith(scout)));
  };

  const decideInner = (run: RunState, ctx: SeatContext, score: (v: BotVisibleState) => number): Action | null => {
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
        const result = pilotSearch(root, { ...budget, depth: 1 }, panelSeed, rng, samples, score);
        const fromSearch = result.plan[0]?.action;
        if (fromSearch && accepted(run, fromSearch)) return trace('mandatory', fromSearch, result);
        const first = candidatesFor(visible).map((c) => c.action).find((a) => accepted(run, a));
        return trace('mandatory', first ?? null, result);
      }

      // 3) Search — and, when enabled, the replace macro scored beside its best plan.
      const result = pilotSearch(root, budget, panelSeed, rng, samples, score);
      if (opts.replaceMacro) {
        const chain = bestReplaceChain(root, visible, liveFp, score);
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
      const spend = forcedSpend(run, visible, opts.handDiscipline === true, score);
      if (spend) return trace('forcedSpend', spend, result);

      // 5) Final arrangement — one improving move at a time; the runner calls again. Arrangements seen this turn
      // are never revisited.
      const current = score(visible);
      const seenKey = `${seatKey}|${round}`;
      if (!arranged.has(seenKey)) { arranged.clear(); arranged.set(seenKey, new Set()); }
      const visited = arranged.get(seenKey)!;
      visited.add(liveFp);
      const move = bestOf(root, orderedPositionCandidates(visible, budget.positionCandidates), rng, current, score, visited);
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
