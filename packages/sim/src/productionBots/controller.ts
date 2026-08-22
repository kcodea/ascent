import { makeRng, type Rng } from '@game/core';
import type { Action, RunState } from '../state';
import { applyCandidate, createPlanningRoot, release } from './transition';
import { fingerprint, toBotVisibleState } from './visibleState';
import { search, type PlannedStep, type SearchResult } from './search';
import { DIFFICULTIES, type BotDifficultyId, type BotDifficultyProfile } from './difficulties';
import { positionCandidates } from './legalActions';
import { evaluate, offerAppeal } from './evaluate';
import type { PlanningStateHandle } from './types';

/**
 * THE BOT — decides ONE action at a time.
 *
 * One action per call, not a committed plan, because everything random (a refresh, a Discover, a random grant)
 * invalidates a queued plan the moment it resolves. Returning one action and replanning is simpler than
 * detecting staleness, and at these budgets it costs little.
 *
 * The controller owns three things search does not:
 *  - **Automatic transitions.** `settleCombat` / `resolveCombat` are not strategic choices; the run just needs
 *    driving through them.
 *  - **Ending the turn.** `faceOmen` is never a search candidate — it terminates every branch, so a beam that
 *    could choose it would find ending immediately is cheapest and explore nothing. The controller decides when
 *    no action is worth taking, then arranges the board and ends.
 *  - **Determinism.** Its RNG is derived from `(seed, wave, decisionIndex)`, so the same run replays the same
 *    decisions — including its blunders.
 */

export interface BotControllerState {
  botId: string;
  difficulty: BotDifficultyId;
  /** Increments per decision — part of the RNG derivation, so two identical states later in a turn still get
   *  independent blunder rolls rather than the same one repeatedly. */
  decisionIndex: number;
  /** The remainder of the plan search last committed to. Serializable: actions plus expected fingerprints. */
  queuedPlan: PlannedStep[];
}

export interface BotDecision {
  action: Action;
  controller: BotControllerState;
  trace?: SearchResult;
}

export function createController(botId: string, difficulty: BotDifficultyId = 'normal'): BotControllerState {
  return { botId, difficulty, decisionIndex: 0, queuedPlan: [] };
}

/** Deterministic per decision: same run + same point in it = same roll, so replays reproduce blunders too. */
function rngFor(run: RunState, c: BotControllerState): Rng {
  let h = 2166136261 >>> 0;
  for (const part of [run.seed, run.wave, c.decisionIndex, c.botId.length]) {
    h ^= part >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return makeRng(h);
}

/**
 * The next action for this run, or `null` if the bot considers the run finished.
 *
 * Never mutates `run` — everything speculative happens behind a planning handle.
 */
export function decide(run: RunState, controller: BotControllerState): BotDecision | null {
  const profile: BotDifficultyProfile = DIFFICULTIES[controller.difficulty];
  const next = { ...controller, decisionIndex: controller.decisionIndex + 1 };

  // 1) Automatic transitions — not decisions, just the run needing to be driven forward. Combat settles and
  // then advances through two actions in the same phase, so the settled flag is what distinguishes them.
  if (run.phase === 'combat') {
    // NOTE: a modal open during combat is NOT resolved here. The reducer's phase guard only admits the two
    // combat transitions while `phase === 'combat'`, so a Discover raised mid-fight cannot be answered until
    // the next recruit phase — the transition is the correct move, and the modal presents itself after it.
    // (Proposing the modal action here instead deadlocks; see the matching note in reducer.ts.)
    return { action: { type: run.combatSettled ? 'resolveCombat' : 'settleCombat' }, controller: next };
  }
  if (run.phase !== 'recruit') return null;

  // 2) FOLLOW THE QUEUED PLAN, while it still applies.
  //
  // This is what makes depth worth anything. Search scores the END of a multi-action plan but the bot commits
  // one action at a time — so committing step 1 and then re-searching abandons the plan before its payoff, and
  // the bot thrashes. Measured before this existed: depth 1 averaged 2.50 wins, depth 2 and 3 both 1.25 — more
  // search made it strictly WORSE. Following the plan is the difference between planning and pretending to.
  //
  // Each step carries the fingerprint of the state it expects. A mismatch means something moved that the plan
  // did not anticipate (a reveal resolved, a trigger fired), so the plan is dropped and search runs again — the
  // plan is a commitment, not a blindfold.
  const liveFp = fingerprint(toBotVisibleState(run));
  if (controller.queuedPlan.length > 0) {
    const [head, ...rest] = controller.queuedPlan;
    if (head && head.fromFingerprint === liveFp) {
      return { action: head.action, controller: { ...next, queuedPlan: rest } };
    }
  }

  const rng = rngFor(run, controller);
  const root = createPlanningRoot(run);
  try {
    const result = search(root, profile, rng);

    // 2) A mandatory decision must be answered even if search rated it poorly — the run is blocked otherwise.
    const visible = toBotVisibleState(run);
    if (visible.mandatoryDecision) {
      // Search always produces something here (the mandatory family is the only candidate set), but if a
      // budget of 0 nodes left it empty, fall back to the first option rather than stalling the run forever.
      // Never queued: answering a modal changes the state in ways the rest of a plan cannot have anticipated.
      const action = result.action ?? firstMandatoryAction(run);
      return action ? { action, controller: { ...next, queuedPlan: [] }, trace: result } : null;
    }

    // 3) An ordinary action, if search found one worth taking. "Worth taking" means it beat doing nothing —
    // without that check the bot buys and sells in circles until its gold runs out.
    const doNothing = evaluate(visible).total;
    if (result.action && result.utility > doNothing + 1e-9) {
      // Commit the first step and QUEUE the rest, so the plan actually gets executed.
      return { action: result.action, controller: { ...next, queuedPlan: result.plan.slice(1) }, trace: result };
    }

    // 4) NEVER END A TURN HOLDING SPENDABLE GOLD.
    //
    // Search stops as soon as no action IMPROVES the score, and early on nothing does: at wave 3-4 every board
    // loses to every threat, so buying a body changes the fight outcome not at all and the evaluator sees no
    // reason to spend. Measured: 4.6 gold left unspent per turn, when a wave-4 turn only has 5-7 gold to
    // begin with. The bot was effectively skipping its early game, which is exactly where its runs were being
    // decided (wave-4 boards losing 97% of their fights).
    //
    // A human never does this, and the reason is not subtle enough to need discovering by search: gold does not
    // carry over, so unspent gold at end of turn is destroyed. Spending it on the best available thing is
    // strictly better than losing it, whatever the evaluator thinks of the marginal body. Explicit rule.
    const spend = forcedSpend(run, visible);
    if (spend) return { action: spend, controller: { ...next, queuedPlan: [] }, trace: result };

    // 5) Nothing left worth doing: arrange the board, then end the turn.
    const arrange = bestArrangement(run, profile);
    if (arrange) return { action: arrange, controller: { ...next, queuedPlan: [] }, trace: result };
    return { action: { type: 'faceOmen' }, controller: { ...next, queuedPlan: [] }, trace: result };
  } finally {
    release(root);
  }
}

/**
 * The best use of gold that would otherwise be destroyed at end of turn.
 *
 * Every option is VALIDATED against the reducer before it is returned. The first version returned its
 * preferences unchecked and blindly played `hand[0]`, which for a targeted spell the reducer simply refuses —
 * the caller then applied a no-op, the run loop saw no state change and stopped. Runs "finished" after 3.5
 * rounds. A forced move has to be a move the game will actually accept.
 *
 * Preference order: play something already in hand (free, and a body is worth more on the board than in it),
 * then tier up (the strongest long-run use of spare gold, and the one search reliably undervalues because the
 * payoff sits beyond any beam depth), then buy the best offer, then refresh. `null` only when the gold
 * genuinely cannot buy anything — the one case where ending the turn holding it is correct.
 */
function forcedSpend(run: RunState, v: ReturnType<typeof toBotVisibleState>): Action | null {
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
  if (v.economy.refreshCost <= v.economy.gold && v.economy.gold >= 2) options.push({ type: 'roll' });
  if (options.length === 0) return null;

  const root = createPlanningRoot(run);
  try {
    for (const action of options) {
      const t = applyCandidate(root, action);
      const ok = t.changed;
      release(t.child);
      if (ok) return action;
    }
    return null;
  } finally {
    release(root);
  }
}

/** The blocked-on choice's first option — a last resort so a bot can never deadlock a run. */
function firstMandatoryAction(run: RunState): Action | null {
  const v = toBotVisibleState(run);
  const m = v.mandatoryDecision;
  if (!m) return null;
  switch (m.kind) {
    case 'discover': return { type: 'discover', index: 0 };
    case 'chooseOne': return { type: 'chooseOne', index: 0 };
    case 'battlecryTarget': return m.legalTargets[0] ? { type: 'battlecryTarget', targetUid: m.legalTargets[0] } : null;
    case 'quest': return { type: 'buyQuest', index: 0 };
    case 'powerOffer': return { type: 'pickPower', index: 0 };
    case 'runeforge': return { type: 'skipRuneforge' };
    case 'scout': return { type: 'closeScout' };
  }
}

/**
 * One repositioning move, if a curated order beats the current one.
 *
 * Deliberately greedy and one move at a time: the controller is called again after it applies, so a sequence of
 * improvements emerges without the search having to model board order as a plan. Returns `null` once no single
 * move improves things, which is what tells the controller to end the turn.
 */
function bestArrangement(run: RunState, profile: BotDifficultyProfile): Action | null {
  if (profile.positioningCandidates <= 0) return null;
  const root = createPlanningRoot(run);
  try {
    const visible = toBotVisibleState(run);
    const current = evaluate(visible).total;
    let best: { action: Action; utility: number } | null = null;
    for (const cand of positionCandidates(visible).slice(0, profile.positioningCandidates)) {
      const t = applyCandidateSafe(root, cand.action);
      if (!t) continue;
      if (t.utility > current + 1e-9 && (!best || t.utility > best.utility)) {
        best = { action: cand.action, utility: t.utility };
      }
    }
    return best?.action ?? null;
  } finally {
    release(root);
  }
}

/** Apply-and-score one candidate, releasing its handle. Returns null for a rejected action. */
function applyCandidateSafe(root: PlanningStateHandle, action: Action): { utility: number } | null {
  const t = applyCandidate(root, action);
  const out = t.changed ? { utility: evaluate(t.visible).total } : null;
  release(t.child);
  return out;
}
