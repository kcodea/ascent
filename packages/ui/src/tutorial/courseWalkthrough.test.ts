/**
 * THE WHOLE COURSE, PLAYED — every Learn Ascent step driven through the REAL reducer, the REAL action gate and
 * the REAL predicate evaluator, in order, from round 1 to graduation.
 *
 * Owner ask 2026-08-23: "confirm that every tutorial step is unblocked by decisions etc."
 *
 * The unit tests around the tutorial check pieces in isolation — a predicate evaluates, a gate maps a verb, a
 * shop offer is tier-legal. None of them can catch the failure that actually strands a player, which is a step
 * that is fine on its own and impossible in sequence: the card was sold two rounds ago, an overlay owns the
 * screen, the gate blocks the one verb that would satisfy the step, the Gold ran out. Those only show up by
 * playing it.
 *
 * For each step this asserts, in order:
 *   1. NOT MODAL-BLOCKED — if an overlay owns the screen (Runeforge / Discover / a targeting prompt), the step
 *      must be one that acts on that overlay. This is the round-6 failure: the coach said "buy Kennelmaster"
 *      while the Runeforge was up (owner report 2026-08-23).
 *   2. THE TARGET EXISTS — the card the step names is in the zone it expects.
 *   3. THE GATE PASSES IT — the verb the step needs survives `gateBlocks` under the gate the controller derives
 *      from that very step. A step whose gate forbids its own verb is a hard lock.
 *   4. IT ACTUALLY MOVES — the reducer returns new state (a refused buy returns the same object).
 *   5. THE PREDICATE IS SATISFIED — `evalPredicate` goes true, so the course advances.
 */
import { describe, expect, it } from 'vitest';
import {
  LEARN_ASCENT, createTutorialRun, reduce, evalPredicate,
  type Action, type RunState, type TutorialPredicate, type TutorialStep,
  type TutorialSemanticEvent, type TutorialContext,
} from '@game/sim';
import { allowedKindsFor, mapAction, projectRun } from './TutorialController';
import { gateBlocks, setTutorialGate } from './gateBus';

/** Which overlay, if any, currently owns the screen. */
function openModal(s: RunState): string | null {
  if (s.runeforgeOffer) return 'runeforge';
  if (s.discover) return 'discover';
  if (s.powerOffer) return 'powerOffer';
  if (s.questOffer?.length) return 'questOffer';
  if (s.chooseOne) return 'chooseOne';
  if (s.pendingTarget) return 'pendingTarget';
  return null;
}

/** The verbs that act ON an overlay — a step may only be coached under one if it uses these. */
const MODAL_VERBS: Record<string, string[]> = {
  runeforge: ['buyRune', 'rerollRuneforge', 'skipRuneforge'],
  discover: ['discover'],
  powerOffer: ['pickPower'],
  questOffer: ['buyQuest'],
  chooseOne: ['chooseOne'],
  pendingTarget: ['battlecryTarget'],
};

/** Flatten a composite predicate to the leaves the driver knows how to satisfy. */
function leaves(p: TutorialPredicate): TutorialPredicate[] {
  if (p.kind === 'all' || p.kind === 'any') return p.of.flatMap(leaves);
  if (p.kind === 'not') return leaves(p.of);
  return [p];
}

function cardFor(step: TutorialStep): string | undefined {
  const c = step.completion as { kind: string; cardId?: string };
  return c.kind === 'bought' || c.kind === 'played' || c.kind === 'sold' ? c.cardId : undefined;
}

describe('Learn Ascent — the whole course, played start to finish', () => {
  it('every step is reachable, unblocked, and completes', () => {
    let s: RunState = createTutorialRun(
      99, LEARN_ASCENT.heroId, LEARN_ASCENT.id,
      LEARN_ASCENT.turns.map((t) => t.omenBoard) as never,
      LEARN_ASCENT.turns.map((_, i) => `Rival ${i + 1}`),
      LEARN_ASCENT.rounds,
      LEARN_ASCENT.turns.map((t) => t.shopRolls) as never,
    );
    // The scripted runes, exactly as the course seeds them.
    const runeScript: Record<number, unknown> = {};
    for (const t of LEARN_ASCENT.turns) if (t.runeOffer) runeScript[t.turn] = t.runeOffer;
    s = { ...s, tutorialRuneScript: runeScript as never };

    let events: TutorialSemanticEvent[] = [];
    let combatEvents: TutorialSemanticEvent[] = [];
    const ctx = (): TutorialContext => ({ run: projectRun(s), events, sawEver: new Set(), combatEvents });
    const problems: string[] = [];
    const trace: string[] = [];

    /** Dispatch through the SAME path the store uses: the gate first, then the reducer, then event mapping. */
    const dispatch = (a: Action, where: string): boolean => {
      const blocked = gateBlocks(a, s);
      if (blocked.blocked) { problems.push(`${where}: the gate BLOCKS its own verb '${a.type}' — ${blocked.reason}`); return true; }
      const next = reduce(s, a);
      if (next === s) { problems.push(`${where}: the reducer REFUSED '${a.type}' (state unchanged)`); return true; }
      const mapped = mapAction(a, s, next);
      events.push(...mapped); combatEvents.push(...mapped);
      s = next;
      return true;
    };

    /** Perform the leaf predicate's teaching verb. Returns false when this leaf is not the actionable one. */
    const act = (p: TutorialPredicate, where: string, step: TutorialStep): boolean => {
      switch (p.kind) {
        case 'bought': {
          const o = s.shop.find((x) => x.cardId === p.cardId);
          if (!o) { problems.push(`${where}: asks the player to buy ${p.cardId}, which is not in the shop`); return true; }
          return dispatch({ type: 'buy', uid: o.uid }, where);
        }
        case 'played': case 'castSpell': {
          const wanted = (p as { cardId?: string }).cardId;
          const h = wanted ? s.hand.find((x) => x.cardId === wanted) : s.hand[0];
          if (!h) { problems.push(`${where}: asks the player to play ${wanted ?? 'a card'}, which is not in hand`); return true; }
          const target = s.board[0]?.uid;
          return dispatch({ type: 'play', uid: h.uid, toIndex: s.board.length, ...(target ? { targetUid: target } : {}) }, where);
        }
        case 'sold': {
          const b = s.board.find((x) => x.cardId === p.cardId);
          if (!b) { problems.push(`${where}: asks the player to sell ${p.cardId}, which is not on the board`); return true; }
          return dispatch({ type: 'sell', uid: b.uid }, where);
        }
        case 'refreshed': return dispatch({ type: 'roll' }, where);
        case 'froze': return dispatch({ type: 'freeze' }, where);
        case 'tierAtLeast': {
          if (s.tier >= p.tier) return true;
          if (s.embers < s.upgradeCost) {
            problems.push(`${where}: Tier ${p.tier} costs ${s.upgradeCost} but only ${s.embers} Gold is left — a hard-gated upgrade the player cannot buy`);
            return true;
          }
          return dispatch({ type: 'upgrade' }, where);
        }
        case 'ownsRunes': {
          if (!s.runeforgeOffer) { problems.push(`${where}: waits on a rune purchase but no Runeforge is open`); return true; }
          return dispatch({ type: 'buyRune', index: 0 }, where);
        }
        case 'heroPowerUsed': case 'heroPowerReady': {
          if (!s.heroReady) return true; // the reminder's "or it is not available" branch
          return dispatch({ type: 'heroPower', uid: s.board[0]?.uid }, where);
        }
        case 'gilded': case 'cardOnBoard': case 'boardCount': {
          const h = s.hand[0];
          if (h) return dispatch({ type: 'play', uid: h.uid, toIndex: s.board.length }, where);
          const o = s.shop[0];
          return o ? dispatch({ type: 'buy', uid: o.uid }, where) : true;
        }
        case 'cardAtSlot': {
          const b = s.board.find((x) => x.cardId === p.cardId);
          if (!b) { problems.push(`${where}: asks the player to position ${p.cardId}, which is not on the board`); return true; }
          return dispatch({ type: 'reposition', uid: b.uid, toIndex: p.index }, where);
        }
        case 'discovered': {
          // A Discover beat can span BOTH actions: play the token that raises the overlay, then choose. If no
          // overlay is up yet, play the card the step spotlights first — that is what a real player does.
          if (!s.discover) {
            const alias = step.anchors.find((a) => a.kind === 'card')?.alias;
            const h = alias ? s.hand.find((x) => x.cardId === alias) : s.hand[0];
            if (!h) { problems.push(`${where}: waits on a Discover pick but nothing in hand opens one`); return true; }
            dispatch({ type: 'play', uid: h.uid, toIndex: s.board.length }, where);
          }
          if (!s.discover) { problems.push(`${where}: waits on a Discover pick but no Discover opened`); return true; }
          return dispatch({ type: 'discover', index: 0 }, where);
        }
        case 'endedTurn': case 'combatStarted': return dispatch({ type: 'faceOmen' }, where);
        case 'combatEnded': return dispatch({ type: 'settleCombat' }, where);
        case 'returnedToShop': return dispatch({ type: 'resolveCombat' }, where);
        default: return true; // 'always', 'presented', 'inspectedAny' — read-and-continue beats
      }
    };

    for (const turn of LEARN_ASCENT.turns) {
      combatEvents = [];
      for (const step of turn.steps) {
        const where = `r${turn.turn} ${step.id}`;
        events = []; // the controller clears the step's event window between steps
        setTutorialGate({ allowedActionKinds: allowedKindsFor(step), allowedCardId: cardFor(step), reason: 'gated' });

        // 1 — modal blocking.
        const modal = openModal(s);
        if (modal) {
          const verbs = allowedKindsFor(step);
          const actsOnModal = verbs.some((v) => MODAL_VERBS[modal]!.includes(v)) || step.completion.kind === 'discovered';
          if (!actsOnModal) {
            problems.push(`${where}: the ${modal} overlay owns the screen, but this step teaches [${verbs.join(', ')}] — the player cannot reach it`);
          }
        }

        // 2–4 — find and dispatch a satisfying action.
        for (const leaf of leaves(step.completion)) {
          if (evalPredicate(step.completion, ctx())) break; // already satisfied (an `any[...]` branch held)
          if (act(leaf, where, step)) break;
        }

        // 5 — the course can advance.
        if (!evalPredicate(step.completion, ctx())) {
          problems.push(`${where}: completion ${JSON.stringify(step.completion)} never became true`);
        } else {
          trace.push(`${where.padEnd(26)} ok   tier=${s.tier} gold=${s.embers} board=${s.board.length}`);
        }
      }
    }
    setTutorialGate(null);

    if (problems.length) console.log(trace.join('\n'));
    expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
    // The course must have actually been PLAYED, not skipped: it ends at the final round, at the top tier.
    expect(s.tier, 'the course finishes at the top tier').toBe(6);
    expect(s.wave, 'the course plays every authored round').toBeGreaterThanOrEqual(LEARN_ASCENT.rounds);
    // …and every authored step was actually walked, so a step cannot pass by being skipped.
    const total = LEARN_ASCENT.turns.reduce((n, t) => n + t.steps.length, 0);
    expect(trace.length, 'every step completed').toBe(total);
  });
});
