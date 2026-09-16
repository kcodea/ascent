import { makeRng, type Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mixSeed, type Action, type RunState } from '../state';
import { applyCandidate, createPlanningRoot, release, visibleOf } from '../productionBots/transition';
import { fingerprint, toBotVisibleState } from '../productionBots/visibleState';
import { candidatesFor, mandatoryCandidates, positionCandidates, type Candidate } from '../productionBots/legalActions';
import { evaluate, offerAppeal } from '../productionBots/evaluate';
import { lastFightResult, withScout } from '../productionBots/fightScore';
import { scoutFromContext, survivalTerm, type SeatScout } from '../productionBots/scout';
import { pilotSearch, type PlannedStep, type PilotSearchResult } from '../productionBots/pilotSearch';
import type { BotCardView, BotOfferView, BotVisibleState, PlanningStateHandle } from '../productionBots/types';
import type { PilotBudget, SeatContext, SeatPilot } from './types';
import { comboProgress, isComboPiece, type ComboProgress, type EngineCombo } from './strategy/combos';

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
  route: 'queued' | 'mandatory' | 'search' | 'replace' | 'assemble' | 'macroBuy' | 'macroRoll' | 'macroFreeze' | 'forcedSpend' | 'position' | 'endTurn';
  search?: PilotSearchResult;
  chosen: Action | null;
}

export interface GeneralistPilot extends SeatPilot {
  budget: PilotBudget;
  /** The last decision's trace (per seat). */
  lastTrace(seatId?: string): GeneralistTrace | undefined;
  /** B11: the engine combo a seat is committed to (undefined = none). */
  commitmentOf(seatId?: string): MacroCommitment | undefined;
}

/** B11: a seat's commitment to assembling one combo. */
export interface MacroCommitment {
  comboId: string;
  /** The wave the commitment was made. */
  since: number;
  /** Refreshes spent on the commitment this turn (`wave` tags the turn). */
  wave: number;
  rolls: number;
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
  /**
   * B6 round 2 (opt-in): a HORIZON re-ranking of the search step. After the beam search, the root, its best
   * `horizonTop` non-terminal end states and the replace chain's end state are each given `horizon(visible)` (a
   * utility adjustment, or null when the state cannot be probed — treated as 0) and the best of `utility +
   * adjustment` is committed. A sampled plan (a refresh) is not in the list; it keeps competing on its base utility
   * with the root's adjustment, so a board-preserving reveal is neither favoured nor punished by the horizon.
   */
  horizon?: (v: BotVisibleState) => number | null;
  horizonTop?: number;
  /**
   * B11 (opt-in): ENGINE-COMBO MACROS — `assemble(combo)` proposals in the candidate set (see `MacroOptions`).
   * Off for the generalist; the strategist turns them on at `macroWeight > 0`.
   */
  macros?: MacroOptions;
}

/**
 * B11 — THE ENGINE-COMBO MACRO. The search's candidate set is depth-1 (three ways of buying one card); an engine
 * is assembled over turns. `assemble(combo)` is one candidate beside the search's best plan and the replace
 * chain: THIS turn buy the combo's pieces on offer (payoff first, a second copy of the payoff toward its golden),
 * field them (selling the weakest non-piece, non-pair body when the board is full), then FEED the engine with the
 * line operator's own procedure (`operators/feedSteps.ts`); the chain's end state is re-ranked with `horizon` —
 * which, under the strategist, is the COMPLETION-weighted two-turn probe (`growth.ts::completionTermOf`), so a
 * half-built engine is credited for what it becomes, at the chance of finding the missing piece. Once a seat is
 * COMMITTED to a combo (an assemble step taken, or its payoff fielded), the COMMIT-AND-ROLL opening runs at waves
 * `commitFrom`..`commitTo`: a missing due piece on offer is bought on sight (or frozen when unaffordable), and up to
 * `reserve` Gold a turn goes into refreshes looking for it before the search spends the rest. At `pivotWave` a
 * commitment whose engine is still incomplete is dropped for good — the search plays the current board.
 */
export interface MacroOptions {
  /** The combos this run can field (the run's tribes; `combos.ts::combosFor`), line-preferred first. */
  combos: (run: RunState) => readonly EngineCombo[];
  /** The line's feed actions from a state (`operators/feedSteps.ts`), or none for a line without an operator. */
  feed: (combo: EngineCombo, v: BotVisibleState, run: RunState, refused: ReadonlySet<string>) => Action[];
  /** Gold per turn spent on refreshes while committed and a piece is missing (the commit window only). */
  reserve: number;
  commitFrom: number;
  commitTo: number;
  /** From this wave an incomplete commitment is abandoned. */
  pivotWave: number;
  /** Is assembling `combo` from `v` worth committing the reserve to? (The strategist reads the completion probe:
   *  the expected gain of the completed engine over the held board.) A payoff the ordinary search fielded commits
   *  the seat only when this says so; an assemble step the re-ranking chose always does. */
  worth: (combo: EngineCombo, v: BotVisibleState) => boolean;
  /** What a seat may commit on: `payoff` (default — the payoff held) or `piece` (any piece held while the payoff
   *  is drawable at the current Shop tier: a Hank at Tier 3 commits to rolling for Blart, the way the recorded
   *  darah runs opened). */
  commitOn?: 'payoff' | 'piece';
}

/** How far below the current utility a forced hand play may fall before it is left in hand (see `forcedSpend`). */
const FORCED_PLAY_TOLERANCE = 3;

/** Board minions a replace macro may sell: the weakest few by printed body, never a golden. */
const REPLACE_SELL_CANDIDATES = 3;
/** Feed steps an assemble chain may take after fielding its pieces. */
const MACRO_FEED_STEPS = 6;
/** Mandatory follow-ups (an aim, a Choose One) an assemble chain resolves after one play. */
const MACRO_PROMPT_GUARD = 3;
/** Gold a commit-and-roll refresh must leave behind (a body's price). */
const MACRO_ROLL_FLOOR = 3;

/**
 * Enumerate replace macros from `root`: for each of the weakest board minions, sell it, then either buy an
 * affordable offer and field it, or field a hand minion. A chain that crosses a reveal (a Shout that discovers, a
 * random grant) is dropped rather than scored on the real future. Returns the best chain's steps + utility.
 */
function bestReplaceChain(root: PlanningStateHandle, v: BotVisibleState, rootFp: string, score: (v: BotVisibleState) => number, protect: (c: BotCardView) => boolean = () => false): { steps: PlannedStep[]; utility: number; visible: BotVisibleState } | null {
  if (v.board.length < 7 || v.mandatoryDecision) return null;
  const sellable = [...v.board]
    .filter((c) => !c.golden && !protect(c))
    .sort((a, b) => a.attack + a.health - (b.attack + b.health))
    .slice(0, REPLACE_SELL_CANDIDATES);
  let best: { steps: PlannedStep[]; utility: number; visible: BotVisibleState } | null = null;
  const consider = (steps: PlannedStep[], utility: number, visible: BotVisibleState): void => {
    if (!best || utility > best.utility) best = { steps, utility, visible };
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
          consider([sellStep, { action: playAction, tag: `field ${h.cardId}`, fromFingerprint: sold.fingerprint }], score(played.visible), played.visible);
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
            ], score(played.visible), played.visible);
          } finally { release(played.child); }
        } finally { release(bought.child); }
      }
    } finally { release(sold.child); }
  }
  return best;
}

/** A held pair (two non-golden copies) — two-thirds of a golden; never sold by a macro. */
const heldPair = (v: BotVisibleState, cardId: string): boolean => [...v.board, ...v.hand].filter((c) => c.cardId === cardId && !c.golden).length >= 2;

const isBodyCard = (cardId: string): boolean => { const d = CARD_INDEX[cardId]; return !!d && !d.spell && !d.ruby; };

const ROLE_ORDER = { payoff: 0, feeder: 1, enabler: 2 } as const;

export interface AssembleChain {
  combo: EngineCombo;
  steps: PlannedStep[];
  utility: number;
  visible: BotVisibleState;
  progress: ComboProgress;
}

/**
 * Build `assemble(combo)` from `root`: buy the combo's affordable pieces on offer (payoff first), field every held
 * piece (the weakest non-piece, non-pair body sold to make the seat), answer the prompts a play opens by the
 * evaluator, then take the line's feed steps. Every step is applied on a clone and validated; a step that crosses
 * a reveal is skipped rather than scored on the real future. Null when the chain would be empty.
 */
export function assembleChain(root: PlanningStateHandle, rootFp: string, run: RunState, combo: EngineCombo, score: (v: BotVisibleState) => number, feed: MacroOptions['feed']): AssembleChain | null {
  const steps: PlannedStep[] = [];
  const owned: PlanningStateHandle[] = [];
  let node = root;
  let fp = rootFp;
  let v = visibleOf(root);
  if (v.mandatoryDecision) return null;
  const apply = (action: Action, tag: string): boolean => {
    const t = applyCandidate(node, action);
    owned.push(t.child);
    if (!t.changed || t.reveal) return false;
    steps.push({ action, tag, fromFingerprint: fp });
    node = t.child; fp = t.fingerprint; v = t.visible;
    return true;
  };
  /** Answer whatever a play opened (an aim, a Choose One) by the evaluator — the pilot's own choice, max is honest. */
  const settle = (): boolean => {
    for (let guard = 0; guard < MACRO_PROMPT_GUARD && v.mandatoryDecision; guard++) {
      let best: { action: Action; utility: number } | null = null;
      for (const mc of mandatoryCandidates(v)) {
        const t = applyCandidate(node, mc.action);
        const ok = t.changed && !t.reveal;
        const u = ok ? score(t.visible) : -Infinity;
        release(t.child);
        if (ok && (!best || u > best.utility)) best = { action: mc.action, utility: u };
      }
      if (!best || !apply(best.action, `answer ${best.action.type}`)) return false;
    }
    return !v.mandatoryDecision;
  };
  try {
    // 1. BUY the pieces on offer — payoff first, then feeders, then enablers; a second copy of the payoff counts.
    const wanted = [...combo.pieces].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    for (const piece of wanted) {
      const prog = comboProgress(combo, v).pieces.find((p) => p.piece === piece);
      if (!prog || prog.offers.length === 0 || v.hand.length >= 10) continue;
      const o = prog.offers[0]!;
      apply({ type: 'buy', uid: o.uid }, `assemble ${combo.id}: buy ${o.cardId}`);
    }
    // 2. FIELD the held pieces (a golden's Discover is a reveal — the play is skipped and left to the search).
    const fieldOrder = (c: BotCardView): number => { const p = combo.pieces.find((x) => x.ids.includes(c.cardId)); return p ? ROLE_ORDER[p.role] : 9; };
    for (const h of [...v.hand].filter((c) => isComboPiece(combo, c.cardId) && isBodyCard(c.cardId)).sort((a, b) => fieldOrder(a) - fieldOrder(b))) {
      if (!v.hand.some((c) => c.uid === h.uid)) continue;
      if (v.board.length >= 7) {
        const worst = [...v.board]
          .filter((c) => !c.golden && !isComboPiece(combo, c.cardId) && !heldPair(v, c.cardId))
          .sort((a, b) => a.attack + a.health - (b.attack + b.health))[0];
        if (!worst) continue;
        if (!apply({ type: 'sell', uid: worst.uid }, `assemble ${combo.id}: sell ${worst.cardId}`)) continue;
      }
      if (apply({ type: 'play', uid: h.uid, toIndex: v.board.length }, `assemble ${combo.id}: field ${h.cardId}`)) { if (!settle()) break; }
    }
    if (v.mandatoryDecision) return null;
    // 3. FEED — the line's own operation, one validated step at a time from the live chain state.
    const refused = new Set<string>();
    for (let i = 0; i < MACRO_FEED_STEPS; i++) {
      const next = feed(combo, v, run, refused).find((a) => !refused.has(JSON.stringify(a)));
      if (!next) break;
      const key = JSON.stringify(next);
      if (!apply(next, `assemble ${combo.id}: feed ${next.type}`)) { refused.add(key); if (next.type === 'play') refused.add(`play:${next.uid}`); if (next.type === 'reposition') refused.add(`seat:${next.uid}`); continue; }
      if (!settle()) break;
    }
    // A chain is a plan only when it MOVES the engine (a buy, a play, a cast, a sell) — never repositions alone.
    if (v.mandatoryDecision || !steps.some((st) => st.action.type !== 'reposition')) return null;
    return { combo, steps, utility: score(v), visible: v, progress: comboProgress(combo, v) };
  } finally {
    for (const h of owned) release(h);
  }
}

export function createGeneralistPilot(budget: PilotBudget, seed: number, opts: GeneralistOptions = {}): GeneralistPilot {
  const queues = new Map<string, PlannedStep[]>();
  const counters = new Map<string, number>();
  /** Arrangement fingerprints visited during the current turn's positioning pass (one turn at a time). */
  const arranged = new Map<string, Set<string>>();
  const traces = new Map<string, GeneralistTrace>();
  /** B11: per-seat combo commitments, and the combos a seat has pivoted away from (never re-committed). */
  const commitments = new Map<string, MacroCommitment>();
  const pivoted = new Map<string, Set<string>>();
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

      // 2b) B11 — the commitment: pivot an incomplete one at the pivot wave; commit-and-roll inside the window.
      const macros = opts.macros;
      const combos = macros ? macros.combos(run).filter((c) => run.wave >= c.fromWave) : [];
      let commitment = commitments.get(seatKey);
      const comboOf = (id: string): EngineCombo | undefined => combos.find((c) => c.id === id);
      if (macros && commitment) {
        const combo = comboOf(commitment.comboId);
        const prog = combo ? comboProgress(combo, visible) : null;
        if (!combo || !prog) { commitments.delete(seatKey); commitment = undefined; }
        else if (!prog.complete && round >= macros.pivotWave) {
          // THE PIVOT: the piece never showed — the search plays the board it has (the combo is never re-committed).
          commitments.delete(seatKey); commitment = undefined;
          if (!pivoted.has(seatKey)) pivoted.set(seatKey, new Set());
          pivoted.get(seatKey)!.add(combo.id);
        } else if (commitment.wave !== round) { commitment.wave = round; commitment.rolls = 0; }
      }
      if (macros && !commitment) {
        // A payoff fielded by the ordinary search commits the seat too (its feeders are worth looking for).
        const stake = (p: ComboProgress): boolean => {
          if (p.payoffFielded) return true;
          if (macros.commitOn !== 'piece') return false;
          const payoff = p.pieces.find((x) => x.piece.role === 'payoff');
          return p.heldPieces > 0 && !!payoff && payoff.piece.ids.some((id) => (CARD_INDEX[id]?.tier ?? 99) <= visible.economy.tier);
        };
        const ready = combos
          .filter((c) => !pivoted.get(seatKey)?.has(c.id))
          .map((c) => comboProgress(c, visible))
          .filter((p) => stake(p) && !p.complete && macros.worth(p.combo, visible))
          .sort((a, b) => b.heldPieces - a.heldPieces)[0];
        if (ready) { commitment = { comboId: ready.combo.id, since: round, wave: round, rolls: 0 }; commitments.set(seatKey, commitment); }
      }
      if (macros && commitment && round >= macros.commitFrom && round <= macros.commitTo) {
        const combo = comboOf(commitment.comboId)!;
        const prog = comboProgress(combo, visible);
        const missing = prog.pieces.filter((p) => p.held === 0 && p.due);
        // A wanted piece on offer — a missing one, or the payoff's second copy — is bought ON SIGHT (the chain
        // below fields it), payoff first; it is never rolled away.
        const wanted = prog.pieces.filter((p) => p.due && p.held < (p.piece.copies ?? 1) && p.offers.length > 0).sort((a, b) => ROLE_ORDER[a.piece.role] - ROLE_ORDER[b.piece.role]);
        const onOffer = wanted[0]?.offers[0];
        if (onOffer && visible.hand.length < 10) {
          const buy: Action = { type: 'buy', uid: onOffer.uid };
          if (accepted(run, buy)) return trace('macroBuy', buy);
        }
        if (missing.length > 0 && !onOffer) {
          // An unaffordable missing piece is frozen for next turn.
          const unaffordable = missing.some((p) => visible.shop.some((o) => !o.spell && !o.ruby && p.piece.ids.includes(o.cardId) && o.cost > visible.economy.gold));
          if (unaffordable && !visible.frozen && accepted(run, { type: 'freeze' })) return trace('macroFreeze', { type: 'freeze' });
          // COMMIT-AND-ROLL: the reserve goes into refreshes looking for the piece before the search spends the rest —
          // only for a piece the CURRENT Shop tier can draw (measured 2026-09-15: the first build rolled 4 Gold a turn
          // at Tier 2 for a Tier-3 Blart through waves 4–6 and never tiered up — 6.60 vs 6.37), and never below a
          // body's price (a roll that leaves nothing to buy what it finds is a roll wasted).
          const cost = visible.economy.freeRolls > 0 ? 0 : visible.economy.refreshCost;
          const spent = commitment.rolls * Math.max(1, visible.economy.refreshCost);
          const drawable = missing.some((p) => p.piece.ids.some((id) => (CARD_INDEX[id]?.tier ?? 99) <= visible.economy.tier));
          if (drawable && !visible.frozen && spent + cost <= macros.reserve && visible.economy.gold - cost >= MACRO_ROLL_FLOOR && accepted(run, { type: 'roll' })) {
            commitment.rolls++;
            return trace('macroRoll', { type: 'roll' });
          }
        }
      }

      // 3) Search — and, when enabled, the replace macro scored beside its best plan.
      // `horizonTop` 0 (the macros' default) probes the root and the assemble chains ONLY: the search plan and the
      // replace chain compete at their utility + the root's adjustment, which keeps the horizon's cost to the
      // question it is there to answer (assemble, or not) — the B6 round-2 re-ranking of search plans measured
      // within noise and each probed state is two imagined futures.
      const topK = opts.horizon ? Math.max(0, opts.horizonTop ?? 3) : 0;
      const result = pilotSearch(root, budget, panelSeed, rng, samples, score, topK);
      const committedCombo = commitment ? comboOf(commitment.comboId) : undefined;
      const protect = macros
        ? (c: BotCardView): boolean => heldPair(visible, c.cardId) || (!!committedCombo && isComboPiece(committedCombo, c.cardId))
        : undefined;
      const chain = opts.replaceMacro ? bestReplaceChain(root, visible, liveFp, score, protect) : null;
      // B11: one assemble chain per combo the run has a stake in (a piece held or on offer).
      const assembles: AssembleChain[] = [];
      if (macros) {
        for (const combo of combos) {
          const prog = comboProgress(combo, visible);
          if (prog.heldPieces === 0 && !prog.pieces.some((p) => p.offers.length > 0)) continue;
          const a = assembleChain(root, liveFp, run, combo, score, macros.feed);
          if (a) assembles.push(a);
        }
      }
      const commitTo = (combo: EngineCombo, after: BotVisibleState): void => {
        if (!macros || pivoted.get(seatKey)?.has(combo.id)) return;
        // A commitment needs the PAYOFF in hand or on the board: an assemble step that only took a feeder (a Hank, an
        // Echo body) is a good buy, not a plan to roll for (the first build committed on a lone Hank and rolled).
        const prog = comboProgress(combo, after);
        const payoffHeld = prog.pieces.some((p) => p.piece.role === 'payoff' && p.held > 0);
        const payoffDrawable = prog.pieces.some((p) => p.piece.role === 'payoff' && p.piece.ids.some((id) => (CARD_INDEX[id]?.tier ?? 99) <= after.economy.tier));
        if (!payoffHeld && !(macros.commitOn === 'piece' && payoffDrawable)) return;
        if (!macros.worth(combo, after) && !prog.payoffFielded) return;
        const cur = commitments.get(seatKey);
        if (cur && cur.comboId !== combo.id) {
          const curCombo = comboOf(cur.comboId);
          if (curCombo && comboProgress(curCombo, visible).heldPieces >= comboProgress(combo, visible).heldPieces) return;
        }
        if (!cur || cur.comboId !== combo.id) commitments.set(seatKey, { comboId: combo.id, since: round, wave: round, rolls: 0 });
      };
      if (opts.horizon) {
        // B6 round 2 — THE HORIZON RE-RANKING. Root, the search's top end states and the replace chain, each at
        // utility + horizon; the sampled best plan (a reveal) competes at its utility + the root's horizon.
        const adj = (v: BotVisibleState): number => opts.horizon!(v) ?? 0;
        const rootAdj = adj(visible);
        let bestScore = result.rootUtility + rootAdj;
        const choice: { steps: PlannedStep[]; route: GeneralistTrace['route'] } = { steps: [], route: 'search' };
        const consider = (steps: PlannedStep[], total: number, route: GeneralistTrace['route']): void => {
          if (steps.length > 0 && total > bestScore + 1e-9) { bestScore = total; choice.steps = steps; choice.route = route; }
        };
        for (const t of result.top) consider(t.plan, t.utility + adj(t.visible), 'search');
        if (result.plan.length > 0 && !result.top.some((t) => t.plan === result.plan)) consider(result.plan, result.utility + rootAdj, 'search');
        if (chain) consider(chain.steps, chain.utility + (topK > 0 ? adj(chain.visible) : rootAdj), 'replace');
        let chosenCombo: EngineCombo | null = null;
        for (const a of assembles) {
          const before = bestScore;
          consider(a.steps, a.utility + adj(a.visible), 'assemble');
          if (bestScore > before) chosenCombo = a.combo;
          else if (choice.route !== 'assemble') chosenCombo = null;
        }
        if (choice.steps.length > 0 && accepted(run, choice.steps[0]!.action)) {
          if (choice.route === 'assemble' && chosenCombo) commitTo(chosenCombo, assembles.find((a) => a.combo === chosenCombo)?.visible ?? visible);
          queues.set(seatKey, choice.steps.slice(1));
          return trace(choice.route, choice.steps[0]!.action, result);
        }
      } else {
        // Without a horizon the assemble chain competes on its plain utility (tests; a macro job names a weight).
        const bestAssemble = assembles.sort((a, b) => b.utility - a.utility)[0];
        const bar = Math.max(result.utility, result.rootUtility, chain?.utility ?? -Infinity);
        if (bestAssemble && bestAssemble.utility > bar + 1e-9 && accepted(run, bestAssemble.steps[0]!.action)) {
          commitTo(bestAssemble.combo, bestAssemble.visible);
          queues.set(seatKey, bestAssemble.steps.slice(1));
          return trace('assemble', bestAssemble.steps[0]!.action, result);
        }
        if (chain && chain.utility > Math.max(result.utility, result.rootUtility) + 1e-9 && accepted(run, chain.steps[0]!.action)) {
          queues.set(seatKey, chain.steps.slice(1));
          return trace('replace', chain.steps[0]!.action, result);
        }
        const head = result.plan[0];
        if (head && result.utility > result.rootUtility + 1e-9 && accepted(run, head.action)) {
          queues.set(seatKey, result.plan.slice(1));
          return trace('search', head.action, result);
        }
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
    commitmentOf: (seatId = 'seat') => commitments.get(seatId),
  };
}
