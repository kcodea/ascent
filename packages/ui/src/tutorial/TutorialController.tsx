/**
 * TUTORIAL — the runtime controller.
 *
 * Mounted once at the app root. It does nothing until the live run is a `tutorial` run; then it loads that
 * run's course, walks its coached beats in order, and drives the presentational `TutorialOverlay`. It never
 * computes gameplay — it only OBSERVES (the action bus + run state) and DECIDES when a step is satisfied, then
 * advances. The reducer, combat, and FX are untouched.
 *
 * The walk is a flat list of "items": foundation panels + the order-demo (advanced by a Next click), then the
 * lobby-intro steps and each turn's steps (advanced when their completion predicate holds). Completion is the
 * pure `evalPredicate` from `@game/sim`, fed a projection of the live run plus the events seen since the step
 * activated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evalPredicate, getTutorialCourse,
  type Action, type RunState,
  type TutorialAnchorRef, type TutorialAnchorSpec, type TutorialCourse,
  type TutorialContext, type TutorialRunView, type TutorialSemanticEvent, type TutorialStep,
} from '@game/sim';
import { useGame } from '../store';
import { subscribeTutorialActions } from './actionBus';
import { subscribeTutorialPresented } from './presentationBus';
import { setTutorialGate, subscribeGateNudge } from './gateBus';
import type { TutorialPredicate } from '@game/sim';
import { measureAnchors } from './anchorRegistry';
import { TutorialOverlay, type TutorialOverlayView } from './TutorialOverlay';
import { FocusCutout } from './FocusMask';
import {
  completeCourse, getCourseProgress, markLessonDemonstrated, setCourseStep, startCourse,
} from './tutorialProfile';
import { TUTORIAL_LESSON_KEYS, type TutorialLessonKey } from '@game/sim';

// ─── Flattening: course → an ordered list of coached items ────────────────────────────────────────────────

type CoachItem =
  | { kind: 'panel'; id: string; title: string; body: string; why?: string; focus: TutorialAnchorSpec[] }
  | { kind: 'step'; step: TutorialStep };

function flattenCourse(course: TutorialCourse): CoachItem[] {
  const items: CoachItem[] = [];
  for (const p of course.foundation) {
    items.push({ kind: 'panel', id: p.id, title: p.title, body: p.body, why: p.why, focus: p.focus ?? [] });
  }
  if (course.orderDemo) {
    // The interactive silhouette drag is a later enrichment; for now the demo is a read-and-continue panel that
    // still teaches that position is chosen left→right. (Tracked as a follow-up.)
    items.push({ kind: 'panel', id: 'order-demo', title: 'Position matters', body: course.orderDemo.body, why: course.orderDemo.debrief, focus: [] });
  }
  for (const s of course.lobbyIntro) items.push({ kind: 'step', step: s });
  for (const t of course.turns) for (const s of t.steps) items.push({ kind: 'step', step: s });
  return items;
}

// ─── Action → semantic event mapping ──────────────────────────────────────────────────────────────────────

const findCard = (zone: readonly { uid: string; cardId: string }[], uid?: string): string | undefined =>
  uid ? zone.find((c) => c.uid === uid)?.cardId : undefined;

/** Translate a dispatched reducer action into the tutorial's semantic vocabulary. `prev` is the run BEFORE the
 *  action, so a buy/play/sell uid still resolves to its card. Returns [] for actions the tutorial ignores. One
 *  action can yield several events — pressing End Turn is BOTH "ended the turn" and "started combat" (there is no
 *  separate end-turn action; `faceOmen` is it). */
function mapAction(action: Action, prev: RunState, next: RunState): TutorialSemanticEvent[] {
  switch (action.type) {
    case 'buy': { const cardId = findCard(prev.shop, action.uid); return cardId ? [{ type: 'bought', cardId, uid: action.uid }] : []; }
    case 'play': { const cardId = findCard(prev.hand, action.uid); return cardId ? [{ type: 'played', cardId, uid: action.uid }] : []; }
    case 'sell': { const cardId = findCard(prev.board, action.uid) ?? findCard(prev.hand, action.uid); return cardId ? [{ type: 'sold', cardId }] : []; }
    case 'roll': return [{ type: 'refreshed' }];
    case 'freeze': return [{ type: 'froze' }];
    case 'upgrade': return [{ type: 'toweredUp', toTier: next.tier }];
    case 'heroPower': return [{ type: 'heroPowerUsed', targetUid: action.uid }];
    case 'reposition': case 'reorderShop': case 'reorderHand': return [{ type: 'reordered' }];
    case 'faceOmen': return [{ type: 'endedTurn' }, { type: 'combatStarted' }];
    case 'resolveCombat': return [{ type: 'combatEnded', result: prev.lastCombat?.result ?? 'draw' }];
    default: return [];
  }
}

// ─── Anchor spec (authored, alias-based) → resolved ref (uid-based) ────────────────────────────────────────

/** Resolve a course-authored anchor into the concrete ref the registry measures. A card `alias` is the card's
 *  id; the on-screen uid is looked up from the live run's zone. Returns null when the card isn't on screen. */
function resolveSpec(spec: TutorialAnchorSpec, run: RunState): TutorialAnchorRef | null {
  switch (spec.kind) {
    case 'ui': return { kind: 'ui', id: spec.id };
    case 'boardSlot': return { kind: 'boardSlot', index: spec.index };
    case 'lobbySeat': return { kind: 'lobbySeat', seatId: spec.seatId };
    case 'card':
    case 'cardBody': {
      const zone = spec.zone === 'shop' ? run.shop : spec.zone === 'hand' ? run.hand : run.board;
      const uid = zone.find((c) => c.cardId === spec.alias)?.uid;
      return uid ? { kind: spec.kind, zone: spec.zone, uid } : null;
    }
    default: return null;
  }
}

// ─── Run projection for predicates ────────────────────────────────────────────────────────────────────────

function projectRun(run: RunState): TutorialRunView {
  return {
    wave: run.wave,
    embers: run.embers,
    resolve: run.resolve,
    maxResolve: run.maxResolve,
    tier: run.tier,
    frozen: run.frozen,
    phase: run.phase,
    heroReady: run.heroReady,
    shop: run.shop.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    hand: run.hand.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    board: run.board.map((c) => ({ uid: c.uid, cardId: c.cardId, golden: c.golden })),
    livingSeats: run.lobby?.seats.filter((s) => s.alive).length,
  };
}

const isLessonKey = (id: string): id is TutorialLessonKey => (TUTORIAL_LESSON_KEYS as readonly string[]).includes(id);

/** Does this step's completion depend on ending the turn / combat? If so, ending the turn is exactly what it
 *  asks for, so End Turn must NOT be gated. Scans the predicate tree. */
function completionNeedsEndTurn(pred: TutorialPredicate): boolean {
  switch (pred.kind) {
    case 'endedTurn': case 'combatStarted': case 'combatEnded': case 'presented': return true;
    case 'not': return completionNeedsEndTurn(pred.of);
    case 'all': case 'any': return pred.of.some(completionNeedsEndTurn);
    default: return false;
  }
}

// ─── The controller ───────────────────────────────────────────────────────────────────────────────────────

export function TutorialController(): JSX.Element | null {
  const run = useGame((s) => s.run);
  const inspect = useGame((s) => s.inspect);
  const showTitle = useGame((s) => s.showTitle);
  const heroChoices = useGame((s) => s.heroChoices);
  // Coach only while the tutorial RUN is the active screen — never over the Title, the hero picker, or a
  // game-over screen (a paused/backgrounded tutorial run must not paint its overlay on top of those).
  const isTutorial = run.mode === 'tutorial' && !!run.tutorialCourseId && !showTitle && !heroChoices && run.phase !== 'gameover' && run.phase !== 'victory';
  const course = useMemo(() => (run.tutorialCourseId ? getTutorialCourse(run.tutorialCourseId) : null), [run.tutorialCourseId]);
  const items = useMemo(() => (course ? flattenCourse(course) : []), [course]);

  const [cursor, setCursor] = useState(0);
  // Events seen SINCE the current step activated (predicate scope), plus the run-lifetime "ever" set.
  const [events, setEvents] = useState<TutorialSemanticEvent[]>([]);
  const sawEverRef = useRef<Set<TutorialSemanticEvent['type']>>(new Set());
  // A transient nudge shown when the player tries a gated action (e.g. End Turn mid-lesson).
  const [nudge, setNudge] = useState<string | null>(null);

  const record = useCallback((e: TutorialSemanticEvent) => {
    sawEverRef.current.add(e.type);
    setEvents((prev) => [...prev, e]);
  }, []);

  // Mark the course started, and RESUME at the saved step when the tutorial screen (re)appears — so a player
  // who quit to the Title mid-course picks up where they left off instead of restarting. The run itself is
  // restored by the normal autosave; this realigns the coaching cursor to it. A course-version mismatch (the
  // steps changed since the save) or no saved step falls back to the start.
  // `run.seed` is stable across a run's actions and across resuming the SAME run, but changes when a fresh
  // tutorial run is launched — so it's the signal that re-runs this effect on a new run (whose `beginCourseFresh`
  // cleared the saved step → cursor 0), while a resume re-runs it via `isTutorial` flipping true (saved step
  // intact → resume). Without it, launching a fresh run for the same course wouldn't re-run this and the cursor
  // would stay on the old run's step, desynced from a wave-1 board.
  const runSeed = run.seed;
  useEffect(() => {
    if (!isTutorial || !course) return;
    const progress = getCourseProgress(course.id);
    startCourse(course.id, course.version);
    const savedIdx = progress && progress.courseVersion === course.version && progress.lastStepId
      ? items.findIndex((it) => (it.kind === 'step' ? it.step.id : it.id) === progress.lastStepId)
      : -1;
    setCursor(savedIdx >= 0 ? savedIdx : 0);
    setEvents([]);
    sawEverRef.current = new Set();
  }, [isTutorial, course, items, runSeed]);

  // Subscribe to the dispatched-action stream while a tutorial is live; translate to semantic events.
  useEffect(() => {
    if (!isTutorial) return;
    return subscribeTutorialActions((action, prev, next) => {
      for (const e of mapAction(action, prev, next)) record(e);
    });
  }, [isTutorial, record]);

  // Observe the combat presentation stream (read-only) so a Predict/Confirm step can advance when its effect is
  // actually shown — a Rally landing, a summon appearing.
  useEffect(() => {
    if (!isTutorial) return;
    return subscribeTutorialPresented((ev) => record({ type: 'presented', kind: ev.kind, srcUid: ev.srcUid, srcCard: ev.srcCard }));
  }, [isTutorial, record]);

  // Inspect is a UI action (not a reducer Action), so observe it off store state.
  useEffect(() => {
    if (isTutorial && inspect) record({ type: 'inspected', uid: inspect.cardId ?? '' });
  }, [isTutorial, inspect, record]);

  const advance = useCallback((completedStep?: TutorialStep) => {
    if (completedStep?.lessonId && isLessonKey(completedStep.lessonId)) markLessonDemonstrated(completedStep.lessonId);
    setEvents([]); // per-step event scope resets
    setCursor((c) => c + 1);
  }, []);

  const current = items[cursor];

  // Gate End Turn while a shop/lobby step is active that isn't itself about ending the turn — so a new player
  // can't skip the lesson into an empty-board fight. Cleared when the tutorial ends (below) or a combat/end-turn
  // step is active. NEVER blocks anything but faceOmen (see gateBus), so it can't soft-lock.
  useEffect(() => {
    if (!isTutorial) { setTutorialGate(null); return; }
    const blockEndTurn = !!current && current.kind === 'step' && current.step.phase !== 'combat' && !completionNeedsEndTurn(current.step.completion);
    setTutorialGate({ blockEndTurn });
    return () => setTutorialGate(null);
  }, [isTutorial, current]);

  // Flash a nudge when the player bumps a gate; auto-clear.
  useEffect(() => subscribeGateNudge((reason) => setNudge(reason)), []);
  useEffect(() => {
    if (!nudge) return;
    const t = window.setTimeout(() => setNudge(null), 2600);
    return () => window.clearTimeout(t);
  }, [nudge]);

  // Persist the current step id, and complete the course when the walk runs out.
  useEffect(() => {
    if (!isTutorial || !course) return;
    if (!current) { completeCourse(course.id); return; }
    if (current.kind === 'step') setCourseStep(course.id, current.step.id);
    else setCourseStep(course.id, current.id);
  }, [isTutorial, course, current, cursor]);

  // Evaluate a step's completion whenever the events or run change; advance when satisfied. An `always` step is
  // a READ-AND-CONTINUE beat: it never auto-advances (that would flash it past the player) — it waits for the
  // Continue button, which calls `advance` directly. So it's excluded here.
  useEffect(() => {
    if (!isTutorial || !current || current.kind !== 'step') return;
    if (current.step.completion.kind === 'always') return;
    const ctx: TutorialContext = { run: projectRun(run), events, sawEver: sawEverRef.current };
    if (evalPredicate(current.step.completion, ctx)) advance(current.step);
  }, [isTutorial, current, events, run, advance]);

  // Measure the current item's anchors → the overlay view. Re-measured when the step, run, or window changes
  // (a handful of getBoundingClientRect calls, only while a tutorial is on screen — never a per-frame loop).
  const view = useMemo<TutorialOverlayView | null>(() => {
    if (!isTutorial || !current) return null;
    const specs = current.kind === 'panel' ? current.focus : current.step.anchors;
    const refs = specs.map((s) => resolveSpec(s, run)).filter((r): r is TutorialAnchorRef => r !== null);
    const rects = measureAnchors(refs).rects.filter((r): r is DOMRect => r !== null);
    const cutouts: FocusCutout[] = rects.map((rect) => ({ rect, shape: 'rect' as const }));
    const primaryRect = rects[0] ?? null;
    const combat = current.kind === 'step' && current.step.phase === 'combat';

    if (current.kind === 'panel') {
      return {
        cutouts,
        combat: false,
        panel: { anchorRect: primaryRect, title: current.title, body: current.body, why: current.why, focusMode: 'orient', onNext: () => advance(), nextLabel: 'Continue', step: cursor + 1, total: items.length },
      };
    }
    const step = current.step;
    return {
      cutouts,
      combat,
      panel: {
        anchorRect: primaryRect,
        title: step.title,
        body: step.body,
        why: step.why,
        focusMode: step.focusMode,
        // Observe-only steps with an `always` completion get a Next button; gated steps advance on their action.
        onNext: step.completion.kind === 'always' ? () => advance(step) : undefined,
        nextLabel: 'Continue',
        step: cursor + 1,
        total: items.length,
      },
    };
    // `events`/`inspect` intentionally excluded from deps — re-measuring is driven by run/step/window, not by
    // every recorded event (which would thrash layout reads during combat).
  }, [isTutorial, current, run, cursor, items.length, advance]);

  if (!isTutorial) return null;
  return (
    <>
      <TutorialOverlay view={view} />
      {nudge && <div className="tut-nudge" role="status">{nudge}</div>}
    </>
  );
}
