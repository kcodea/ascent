/**
 * TUTORIAL — predicate evaluation (pure, deterministic, unit-testable).
 *
 * The controller calls `evalPredicate(step.completion, ctx)` each tick to decide whether a step is satisfied.
 * Kept as a pure function over `TutorialContext` — no store, no DOM, no time — so the whole completion logic
 * is covered by ordinary Vitest without a browser.
 */
import type { TutorialContext, TutorialPredicate, TutorialSemanticEvent } from './types';

/** Did any recorded event this step match `pred`? */
function sawEvent(events: readonly TutorialSemanticEvent[], match: (e: TutorialSemanticEvent) => boolean): boolean {
  return events.some(match);
}

export function evalPredicate(pred: TutorialPredicate, ctx: TutorialContext): boolean {
  const { run, events, combatEvents } = ctx;
  switch (pred.kind) {
    case 'always':
      return true;
    case 'bought':
      return sawEvent(events, (e) => e.type === 'bought' && e.cardId === pred.cardId);
    case 'sold':
      return sawEvent(events, (e) => e.type === 'sold' && e.cardId === pred.cardId);
    case 'played':
      return sawEvent(events, (e) => e.type === 'played' && e.cardId === pred.cardId);
    case 'cardOnBoard':
      return run.board.some((c) => c.cardId === pred.cardId);
    case 'boardCount':
      return run.board.length >= pred.atLeast;
    case 'inspectedAny':
      return sawEvent(events, (e) => e.type === 'inspected');
    case 'refreshed':
      return sawEvent(events, (e) => e.type === 'refreshed');
    case 'froze':
      return sawEvent(events, (e) => e.type === 'froze');
    case 'reordered':
      return sawEvent(events, (e) => e.type === 'reordered');
    case 'cardAtSlot':
      return run.board[pred.index]?.cardId === pred.cardId;
    case 'castSpell':
      return sawEvent(events, (e) => e.type === 'castSpell' && (pred.cardId === undefined || e.cardId === pred.cardId));
    case 'heroPowerUsed':
      return sawEvent(events, (e) => e.type === 'heroPowerUsed');
    case 'heroPowerReady':
      return run.heroReady;
    case 'tierAtLeast':
      return run.tier >= pred.tier;
    case 'gilded':
      return sawEvent(events, (e) => e.type === 'gilded');
    case 'discovered':
      return sawEvent(events, (e) => e.type === 'discovered');
    case 'endedTurn':
      return sawEvent(events, (e) => e.type === 'endedTurn');
    // Combat-lifecycle predicates read the per-COMBAT log so consecutive combat beats can each match one fight.
    case 'combatStarted':
      return sawEvent(combatEvents, (e) => e.type === 'combatStarted');
    case 'combatEnded':
      return sawEvent(combatEvents, (e) => e.type === 'combatEnded' && (pred.result === undefined || e.result === pred.result));
    case 'returnedToShop':
      return sawEvent(combatEvents, (e) => e.type === 'returnedToShop');
    case 'presented':
      return sawEvent(combatEvents, (e) => e.type === 'presented' && e.kind === pred.presented);
    case 'goldSpentToZero':
      return run.embers <= 0;
    case 'not':
      return !evalPredicate(pred.of, ctx);
    case 'all':
      return pred.of.every((p) => evalPredicate(p, ctx));
    case 'any':
      return pred.of.some((p) => evalPredicate(p, ctx));
    default: {
      // Exhaustiveness guard — a new predicate kind that forgets a branch fails the type-check here.
      const _never: never = pred;
      return _never;
    }
  }
}
