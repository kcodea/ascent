// @vitest-environment jsdom
/**
 * LEARN ANCIENTS, PLAYED (owner ask 2026-11-16) — every step of the short Ancients course driven through the REAL
 * reducer, the REAL action gate (derived from each step exactly as the controller derives it) and the REAL predicate
 * evaluator, once per Ancient the player could pick. A branch step whose `onlyIf` does not hold is skipped, as the
 * controller skips it. Each walk must reach the end (the outro) with every visited step satisfied and nothing the
 * coach asked for blocked by its own gate.
 *
 * Also: the first-login prompt's rule (shows once, only while the release switch is on, never over the new-player
 * nudge, another dialog or a saved game).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
import {
  LEARN_ANCIENTS, createCourseRun, evalPredicate, reduce,
  type Action, type RunState, type TutorialContext, type TutorialSemanticEvent, type TutorialStep,
} from '@game/sim';
import { allowedKindsFor, mapAction, projectRun } from './TutorialController';
import { gateBlocks, setTutorialGate } from './gateBus';
import { ancientsPromptSeen, markAncientsPromptSeen, resetAncientsPromptForTests, shouldShowAncientsPrompt, type AncientsPromptGate } from './AncientsPrompt';
import { ancientsLiveForPrompt, setAncientsLiveForTests } from './ancientsLive';

const ALL_STEPS = LEARN_ANCIENTS.turns.flatMap((t) => t.steps);

function walk(pick: 'bonds' | 'war' | 'time'): { visited: string[]; problems: string[]; run: RunState } {
  let s = createCourseRun(LEARN_ANCIENTS);
  let events: TutorialSemanticEvent[] = [];
  let combatEvents: TutorialSemanticEvent[] = [];
  const problems: string[] = [];
  const visited: string[] = [];
  const ctx = (): TutorialContext => ({ run: projectRun(s), events, sawEver: new Set(), combatEvents });
  const dispatch = (a: Action, where: string): void => {
    const g = gateBlocks(a, s);
    if (g.blocked) { problems.push(`${where}: the gate blocked ${a.type} (${g.reason})`); return; }
    const prev = s;
    s = reduce(s, a);
    for (const e of mapAction(a, prev, s)) {
      if (e.type === 'combatStarted') combatEvents = [];
      events.push(e);
      combatEvents.push(e);
    }
  };
  const boardUid = (cardId: string): string => s.board.find((c) => c.cardId === cardId)!.uid;
  const act = (step: TutorialStep, where: string): void => {
    switch (step.id) {
      case 'anc-refresh': dispatch({ type: 'roll' }, where); dispatch({ type: 'roll' }, where); return;
      case 'anc-pick': dispatch({ type: 'pickAncient', id: pick }, where); return;
      case 'anc-use-bonds': case 'anc-use-time': dispatch({ type: 'heroPower', uid: boardUid('d2_scalechanter') }, where); return;
      case 'anc-use-war': dispatch({ type: 'heroPower', uid: boardUid('d2_transcendence') }, where); return;
      case 'anc-time-spell': {
        dispatch({ type: 'buy', uid: s.spell!.uid }, where);
        const ale = s.hand.find((c) => c.cardId === 'wo_champion');
        if (ale) dispatch({ type: 'play', uid: ale.uid }, where);
        return;
      }
      case 'anc-end': dispatch({ type: 'faceOmen' }, where); return;
      case 'anc-watch': dispatch({ type: 'settleCombat' }, where); return;
      case 'anc-done': dispatch({ type: 'resolveCombat' }, where); return;
      default: return; // read-and-continue beats
    }
  };
  for (const step of ALL_STEPS) {
    events = [];
    if (step.onlyIf && !evalPredicate(step.onlyIf, ctx())) continue; // the controller's branch skip
    visited.push(step.id);
    setTutorialGate({ allowedActionKinds: allowedKindsFor(step), reason: 'gated' });
    act(step, step.id);
    if (step.completion.kind !== 'always' && !evalPredicate(step.completion, ctx())) {
      problems.push(`${step.id}: completion ${JSON.stringify(step.completion)} never became true`);
    }
  }
  setTutorialGate(null);
  return { visited, problems, run: s };
}

describe('Learn Ancients — the whole course, played through the real reducer + gate', () => {
  it('BONDS (the steered pick): every step clears, the Bonds use step shows, and the fight is won', () => {
    const { visited, problems, run } = walk('bonds');
    expect(problems).toEqual([]);
    expect(visited).toContain('anc-use-bonds');
    expect(visited, 'no "other pick" line for the steered pick').not.toContain('anc-other');
    expect(visited).not.toContain('anc-use-war');
    expect(run.lastCombat?.result).toBe('win');
    expect(run.phase, 'End combat returned to the Shop (the outro then takes over)').toBe('recruit');
  });

  it.each(['war', 'time'] as const)('%s: the player is never trapped; their own branch shows and the fight is won', (pick) => {
    const { visited, problems, run } = walk(pick);
    expect(problems).toEqual([]);
    expect(visited, 'the gentle "that works too" line').toContain('anc-other');
    expect(visited).toContain(`anc-use-${pick}`);
    expect(visited).not.toContain('anc-use-bonds');
    expect(run.lastCombat?.result).toBe('win');
  });

  it('player text: no em dashes, no "Oath", no "climb"', () => {
    const copy = [LEARN_ANCIENTS.title, LEARN_ANCIENTS.summary, LEARN_ANCIENTS.outro!.title, LEARN_ANCIENTS.outro!.liveLine ?? '',
      ...ALL_STEPS.flatMap((s) => [s.title ?? '', s.body, s.why ?? ''])];
    for (const line of copy) {
      expect(line, line).not.toMatch(/—|--/);
      expect(line, line).not.toMatch(/\boath\b|\bclimb/i);
    }
  });
});

describe('the Ancients first-login prompt', () => {
  const gate = (over: Partial<AncientsPromptGate> = {}): AncientsPromptGate =>
    ({ live: true, userId: 'u-1', onMainMenu: true, newPlayer: false, otherDialog: false, hasSavedRun: false, ...over });
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage in this env */ } resetAncientsPromptForTests(); });
  afterEach(() => { setAncientsLiveForTests(null); });

  it('the switch reads OFF until the release switch lands (and ships off)', () => {
    expect(ancientsLiveForPrompt()).toBe(false);
    setAncientsLiveForTests(true);
    expect(ancientsLiveForPrompt()).toBe(true);
  });

  it('shows only while the switch is on', () => {
    expect(shouldShowAncientsPrompt(gate({ live: false }))).toBe(false);
    expect(shouldShowAncientsPrompt(gate())).toBe(true);
  });

  it('shows once: after it is seen (Try it or Later) it never shows again, for that account or device', () => {
    expect(shouldShowAncientsPrompt(gate())).toBe(true);
    markAncientsPromptSeen('u-1');
    expect(shouldShowAncientsPrompt(gate())).toBe(false);
    expect(ancientsPromptSeen(null), 'the device flag counts too').toBe(true);
    resetAncientsPromptForTests(); // a reload: only storage remembers
    expect(shouldShowAncientsPrompt(gate())).toBe(false);
  });

  it('never over the new-player tutorial nudge, another dialog, off the main menu, or with a saved game', () => {
    expect(shouldShowAncientsPrompt(gate({ newPlayer: true }))).toBe(false);
    expect(shouldShowAncientsPrompt(gate({ otherDialog: true }))).toBe(false);
    expect(shouldShowAncientsPrompt(gate({ onMainMenu: false }))).toBe(false);
    expect(shouldShowAncientsPrompt(gate({ hasSavedRun: true }))).toBe(false);
  });
});
