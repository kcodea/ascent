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
  evalPredicate, getTutorialCourse, getHero, heroPowerLockTurns,
  type Action, type RunState,
  type TutorialAnchorRef, type TutorialAnchorSpec, type TutorialCourse, type TutorialPredicate,
  type TutorialContext, type TutorialRunView, type TutorialSemanticEvent, type TutorialStep,
  type TutorialPanelNudge,
} from '@game/sim';
import { useGame } from '../store';
import { subscribeTutorialActions } from './actionBus';
import { subscribeTutorialPresented } from './presentationBus';
import { setTutorialGate, subscribeGateNudge } from './gateBus';
import { measureAnchors, resolveAnchorRect, useAnchorMeasureTick } from './anchorRegistry';
import { TutorialOverlay, type TutorialOverlayView } from './TutorialOverlay';
import { FocusCutout } from './FocusMask';
import {
  completeCourse, getCourseProgress, markLessonDemonstrated, setCourseStep, startCourse,
} from './tutorialProfile';
import { TUTORIAL_LESSON_KEYS, type TutorialLessonKey } from '@game/sim';

// ─── Flattening: course → an ordered list of coached items ────────────────────────────────────────────────

type CoachItem =
  | { kind: 'panel'; id: string; title: string; body: string; why?: string; focus: TutorialAnchorSpec[]; panelNudge?: TutorialPanelNudge }
  | { kind: 'step'; step: TutorialStep };

function flattenCourse(course: TutorialCourse): CoachItem[] {
  const items: CoachItem[] = [];
  for (const p of course.foundation) {
    items.push({ kind: 'panel', id: p.id, title: p.title, body: p.body, why: p.why, focus: p.focus ?? [], panelNudge: p.panelNudge });
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
export function mapAction(action: Action, prev: RunState, next: RunState): TutorialSemanticEvent[] {
  switch (action.type) {
    // Each of these confirms the TRANSITION, not just the attempt: the reducer returns the same state when it
    // refuses (a play into a full board, a buy you cannot afford), and `dispatch` notifies either way — so
    // without the `next === prev` guard the coach ticked the lesson off for something that visibly did not
    // happen, then pointed its next spotlight at a card that never moved (audit 2026-08-21).
    case 'buy': { const cardId = findCard(prev.shop, action.uid); return cardId && next !== prev ? [{ type: 'bought', cardId, uid: action.uid }] : []; }
    case 'play': {
      const cardId = findCard(prev.hand, action.uid);
      if (!cardId || next === prev) return [];
      // A SPELL played from hand is a cast — the `castSpell` predicate exists in the contract but nothing ever
      // emitted it, so any course authoring it would have hung forever. Emit both: the card was played, and
      // (if it is a spell) it was cast.
      const isSpell = !next.board.some((c) => c.uid === action.uid); // a minion lands on the board; a spell never does
      return isSpell
        ? [{ type: 'played', cardId, uid: action.uid }, { type: 'castSpell', cardId }]
        : [{ type: 'played', cardId, uid: action.uid }];
    }
    case 'sell': { const cardId = findCard(prev.board, action.uid) ?? findCard(prev.hand, action.uid); return cardId && next !== prev ? [{ type: 'sold', cardId }] : []; }
    case 'roll': return next === prev ? [] : [{ type: 'refreshed' }];
    case 'freeze': return next === prev ? [] : [{ type: 'froze' }];
    // A REJECTED verb must not advance the lesson. The reducer returns the SAME state object when it refuses
    // an action (a locked power, a missing target), and `dispatch` notifies either way — so without this a
    // whiffed hero-power press ticked the coached step off while the player got no buff at all. `buy`/`play`/
    // `sell` already guard via their uid lookup; these are the verbs that could silently no-op.
    case 'heroPower': return next === prev ? [] : [{ type: 'heroPowerUsed', targetUid: action.uid }];
    case 'upgrade': return next === prev ? [] : [{ type: 'toweredUp', toTier: next.tier }];
    case 'reposition': case 'reorderShop': case 'reorderHand': return [{ type: 'reordered' }];
    case 'faceOmen': return [{ type: 'endedTurn' }, { type: 'combatStarted' }];
    // Combat is SETTLED when the replay finishes (win/loss known) — that's "combat ended". The player then
    // clicks "End combat, back to shop" (resolveCombat), which is a SEPARATE beat the coach can guide.
    case 'settleCombat': return [{ type: 'combatEnded', result: prev.lastCombat?.result ?? 'draw' }];
    // `resolveCombat` settles the fight ITSELF when the player skips ahead (reducer: `if (!s.combatSettled)
    // settleCombat(...)`), which used to swallow `combatEnded` entirely and strand any step awaiting it.
    // The Discover PICK. `discover` is always-allowed by the gate (it is a sub-choice), so this only feeds
    // predicates — but it lets a step wait for the actual choice instead of the play that opened the modal.
    case 'discover': return next === prev ? [] : [{ type: 'discovered' }];
    case 'resolveCombat': return prev.combatSettled
      ? [{ type: 'returnedToShop' }]
      : [{ type: 'combatEnded', result: prev.lastCombat?.result ?? 'draw' }, { type: 'returnedToShop' }];
    default: return [];
  }
}

/** The player verb(s) a step's completion is teaching — used to lock input to exactly that action. `null` means
 *  "don't gate a verb" (a combat/observe step: only flow actions apply, and those always pass). */
export function allowedKindsFor(step: TutorialStep): string[] {
  if (step.allowedActionKinds) return step.allowedActionKinds;
  return verbsForPredicate(step.completion);
}

/**
 * The verbs a predicate could possibly need. COMPOSITES RECURSE (owner report 2026-08-21: step 19 hard-locked):
 * a completion of `any[heroPowerUsed, not heroPowerReady]` used to fall through to `[]`, which the gate reads
 * as "no verb allowed" — so the coach asked for the hero power and the gate dropped every attempt to use it.
 * Unioning the children keeps the lock as tight as the authored intent while never blocking the verb the step
 * is teaching, and it holds for any future composite a course author writes.
 */
export function verbsForPredicate(c: TutorialPredicate): string[] {
  switch (c.kind) {
    case 'not': return verbsForPredicate(c.of);
    case 'all': case 'any': return [...new Set(c.of.flatMap(verbsForPredicate))];
    case 'bought': return ['buy'];
    case 'ownsRunes': return ['buyRune', 'rerollRuneforge']; // the forge's own verbs; skipping is handled below
    case 'played': return ['play'];
    case 'sold': return ['sell'];
    case 'refreshed': return ['roll'];
    case 'froze': return ['freeze'];
    case 'tierAtLeast': return ['upgrade'];
    case 'heroPowerUsed': return ['heroPower'];
    case 'castSpell': return ['play']; // spells are played from hand
    case 'endedTurn': case 'combatStarted': return ['faceOmen'];
    case 'gilded': return ['buy']; // a Gild completes on the third buy
    case 'inspectedAny': return []; // inspect is always allowed anyway
    // A readiness CHECK needs the verb that would satisfy it, so an "any[used, notReady]" reminder still lets
    // the player press the power on the turns it IS available.
    case 'heroPowerReady': return ['heroPower'];
    // Verbless by design — the player is watching, or clicking a flow control that `ALWAYS_ALLOWED` passes.
    case 'always': case 'combatStarted': case 'combatEnded': case 'returnedToShop': case 'presented':
      return [];
    // Positional lessons complete on a drag; `reposition` is always allowed, but name it rather than relying
    // on that (the dependency is invisible from here).
    case 'cardAtSlot': case 'reordered': return ['reposition'];
    case 'discovered': return []; // picking is always allowed (a sub-choice within an allowed action)
    // Board-state goals need the verbs that change the board; a spend goal needs the ways to spend.
    case 'cardOnBoard': case 'boardCount': return ['buy', 'play', 'sell']; // a count goal moves either way
    case 'goldSpentToZero': return ['buy', 'roll', 'upgrade', 'freeze'];
    // A KIND WE DO NOT KNOW must fall OPEN, never shut. `[]` means "block every player verb", so a predicate
    // added to the contract without a branch here would hard-lock its step — the exact failure that shipped
    // with composite predicates. A too-loose gate is a smudge; a too-tight one ends the run.
    default: return ['buy', 'play', 'sell', 'roll', 'freeze', 'upgrade', 'heroPower', 'faceOmen'];
  }
}

/** The specific card a buy/play step is restricted to (so the player can't buy a different offered minion). */
function allowedCardFor(step: TutorialStep): string | undefined {
  const c = step.completion;
  return c.kind === 'bought' || c.kind === 'played' || c.kind === 'sold' ? c.cardId : undefined;
}

/** Which run phase a step expects to be shown in, so its spotlight never resolves against a screen that isn't
 *  there (a combat step must not try to light up shop chrome, and vice-versa). */
function stepMatchesPhase(step: TutorialStep, phase: string): boolean {
  if (step.phase === 'combat') return phase === 'combat';
  // shop / lobby / runeforge / debrief / foundation steps all live in the recruit (shop) phase.
  return phase === 'recruit';
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

export function projectRun(run: RunState): TutorialRunView {
  return {
    wave: run.wave,
    embers: run.embers,
    resolve: run.resolve,
    maxResolve: run.maxResolve,
    tier: run.tier,
    ownedRunes: run.ownedRunes ?? [],
    frozen: run.frozen,
    phase: run.phase,
    // ACTUAL usability, not the raw flag: `heroReady` re-arms every wave, but a recharge-locked power
    // (Aster's Preparation) is still unusable on its locked turn. Without this the tutorial's
    // `heroPowerReady` predicate reads true on a locked turn and its "use your power" reminder can never
    // clear (owner report 2026-08-21, step 19).
    heroReady: run.heroReady && heroPowerLockTurns(run, getHero(run.heroId).power.kind) === 0,
    shop: run.shop.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    hand: run.hand.map((c) => ({ uid: c.uid, cardId: c.cardId })),
    board: run.board.map((c) => ({ uid: c.uid, cardId: c.cardId, golden: c.golden })),
    livingSeats: run.lobby?.seats.filter((s) => s.alive).length,
  };
}

const isLessonKey = (id: string): id is TutorialLessonKey => (TUTORIAL_LESSON_KEYS as readonly string[]).includes(id);


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
  // Events seen SINCE the current step activated (predicate scope), plus the run-lifetime "ever" set, plus the
  // per-COMBAT log (reset when a new fight starts) so consecutive combat beats each see one fight's outcome.
  const [events, setEvents] = useState<TutorialSemanticEvent[]>([]);
  const sawEverRef = useRef<Set<TutorialSemanticEvent['type']>>(new Set());
  const combatEventsRef = useRef<TutorialSemanticEvent[]>([]);
  // A transient nudge shown when the player tries a gated action (e.g. End Turn mid-lesson).
  const [nudge, setNudge] = useState<string | null>(null);
  // A `dismissible` step's panel can be hidden with "Got it" (the free-play rounds) — cleared whenever the step
  // changes so the next step's panel always shows.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [cursor]);

  const record = useCallback((e: TutorialSemanticEvent) => {
    sawEverRef.current.add(e.type);
    if (e.type === 'combatStarted') combatEventsRef.current = []; // a new fight — clear the last one's log
    combatEventsRef.current.push(e);
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
  // The live run, readable from effects that must NOT re-subscribe to it.
  const runRef = useRef(run);
  runRef.current = run;
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
    // SEED the combat log from the RESTORED RUN rather than clearing it (audit 2026-08-21). `combatEnded` is
    // only ever emitted by a `settleCombat` ACTION, and that action fires once, guarded on `!combatSettled`.
    // So a player who quit to the Title after the fight resolved but before pressing "End combat" came back to
    // a step waiting on an event that could never be produced again — every verb gated, the step unclearable,
    // the run abandonable only from the Esc menu. Rebuilding the log from state makes the resume self-healing.
    // Read the run through a REF, never the deps: this effect resets the cursor and clears the logs, so
    // listing combat fields here would re-run it on every phase flip mid-run and repeatedly rewind the course
    // (caught in a full playthrough — the round-1 debrief could never clear).
    const r = runRef.current;
    const seeded: TutorialSemanticEvent[] = [];
    if (r.phase === 'combat') {
      seeded.push({ type: 'combatStarted' });
      if (r.combatSettled) seeded.push({ type: 'combatEnded', result: r.lastCombat?.result ?? 'draw' });
    }
    combatEventsRef.current = seeded;
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
  // Re-measure the spotlight while the board settles. Keyed on the step so each activation gets its own
  // bounded settle sweep; also bumps on resize/scroll/transition/animation end. Listed in the view memo's
  // deps below — that is what actually moves the cutout onto a card that was still animating when the step
  // began (owner report: the step-12 highlight sitting off Packstrider).
  const measureTick = useAnchorMeasureTick(
    current ? (current.kind === 'panel' ? current.id : current.step.id) : 'none',
    run.phase === 'combat' && !run.combatSettled, // suspended: nothing is spotlighted while the fight plays
  );

  // LOCK input to the current step's coached action — the player can do only what the coach is pointing at, so
  // they stay in lock-step and can't desync the course. Flow/positioning/inspect always pass (see gateBus), so
  // this can't soft-lock. A foundation panel blocks every verb (the player clicks Continue).
  useEffect(() => {
    if (!isTutorial || !current) { setTutorialGate(null); return; }
    if (current.kind === 'panel') {
      setTutorialGate({ allowedActionKinds: [], reason: 'Read this, then press Continue.' });
    } else {
      setTutorialGate({ allowedActionKinds: allowedKindsFor(current.step), allowedCardId: allowedCardFor(current.step), reason: 'Follow the highlighted step first — that action comes next.' });
    }
    return () => setTutorialGate(null);
  }, [isTutorial, current]);

  // Flash a nudge when the player bumps a gate; auto-clear.
  useEffect(() => subscribeGateNudge((reason) => setNudge(reason)), []);
  useEffect(() => {
    if (!nudge) return;
    const t = window.setTimeout(() => setNudge(null), 2600);
    return () => window.clearTimeout(t);
  }, [nudge]);

  // FINISHING the course: the last debrief's `resolveCombat` also ends the lobby, so the same commit flips the
  // phase to victory/gameover — which turns `isTutorial` false and made every effect below early-return. The
  // course therefore sat at `in_progress` forever, even for a perfect playthrough. Watch the terminal phase
  // directly, outside the `isTutorial` guard (audit 2026-08-21).
  const tutorialCourseId = run.tutorialCourseId;
  const terminal = run.phase === 'gameover' || run.phase === 'victory';
  useEffect(() => {
    if (run.mode === 'tutorial' && tutorialCourseId && terminal) completeCourse(tutorialCourseId);
  }, [run.mode, tutorialCourseId, terminal]);

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
    const ctx: TutorialContext = { run: projectRun(run), events, sawEver: sawEverRef.current, combatEvents: combatEventsRef.current };
    if (evalPredicate(current.step.completion, ctx)) advance(current.step);
  }, [isTutorial, current, events, run, advance]);

  // Measure the current item's anchors → the overlay view. Re-measured when the step, run, or window changes
  // (a handful of getBoundingClientRect calls, only while a tutorial is on screen — never a per-frame loop).
  const view = useMemo<TutorialOverlayView | null>(() => {
    if (!isTutorial || !current) return null;
    // PHASE SAFETY: only resolve spotlights when the game is on the screen the step expects. A combat step must
    // never try to light up shop chrome (its anchors aren't there) — during a mismatch we still show the panel,
    // just centered with no cutout, until the phase catches up.
    const phaseOk = current.kind === 'panel' || stepMatchesPhase(current.step, run.phase);
    const specs = current.kind === 'panel' ? current.focus : current.step.anchors;
    const refs = phaseOk ? specs.map((s) => resolveSpec(s, run)).filter((r): r is TutorialAnchorRef => r !== null) : [];
    // Drop VIEWPORT-SIZED rects (audit 2026-08-21): `.discover-ov` is `position: fixed; inset: 0`, so
    // spotlighting it punched a hole through the entire screen — no highlight at all — and handed `placePanel`
    // a full-screen anchor, which clamps the panel across the bottom of the Discover picker it is covering.
    // A modal needs no cutout: it already owns the screen.
    const coversViewport = (r: DOMRect): boolean => r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.95;
    const rects = measureAnchors(refs).rects.filter((r): r is DOMRect => r !== null && !coversViewport(r));
    // PULL A BOARD-ROW SPOTLIGHT IN TO THE BOARD (owner 2026-08-24: "nudge these boxes in closer to the sides of
    // the board"). The warband/shop/hand rows are `align-items: stretch` items in a full-width column zone, so
    // their box spans the ENTIRE stage even when empty — the spotlight spilled way past the board's frame walls
    // out to the stage edges. Any cutout that spans nearly the whole stage is clamped to the board's felt
    // interior (the central slice between the ornate frame walls), centred on the stage. Narrow anchors (a seat,
    // the rail, a button, the Health box) are well under the threshold and pass through untouched.
    const stage = document.querySelector('.app')?.getBoundingClientRect() ?? null;
    const BOARD_INTERIOR_FRAC = 0.52; // eyeball-tuned: the felt width as a fraction of the 16:9 stage. Tune here.
    const toBoardInterior = (rect: DOMRect): DOMRect => {
      if (!stage || rect.width < stage.width * 0.9) return rect; // not a full-stage row — leave it
      const w = stage.width * BOARD_INTERIOR_FRAC;
      return new DOMRect(stage.left + (stage.width - w) / 2, rect.top, w, rect.height);
    };
    const cutouts: FocusCutout[] = rects.map((rect) => ({ rect: toBoardInterior(rect), shape: 'rect' as const }));
    const primaryRect = rects[0] ?? null;

    // Resolve a connector (drag/causal line) when the step declares one and both ends are on screen.
    let connector: TutorialOverlayView['connector'];
    if (phaseOk && current.kind === 'step' && current.step.connector) {
      const c = current.step.connector;
      const from = resolveSpec(c.from, run);
      const to = resolveSpec(c.to, run);
      const fr = from ? resolveAnchorRect(from) : null;
      const tr = to ? resolveAnchorRect(to) : null;
      if (fr && tr) connector = { from: fr, to: tr, style: c.style, label: c.label };
    }

    if (current.kind === 'panel') {
      return {
        cutouts,
        connector,
        combat: false,
        panel: { anchorRect: primaryRect, title: current.title, body: current.body, why: current.why, focusMode: 'orient', onNext: () => advance(), nextLabel: 'Continue', step: cursor + 1, total: items.length, nudge: current.panelNudge },
      };
    }
    const step = current.step;
    // WHILE COMBAT IS ANIMATING, don't dim: the player should watch the fight at full clarity (a Rally-watch
    // step). The scrim + spotlight return for the post-combat debrief once the fight has settled. The coach
    // panel drops to the bottom of the screen so it never covers the fighting minions it's asking you to watch.
    const combatAnimating = step.phase === 'combat' && !run.combatSettled;
    // A Discover / Choose-One picker owns the centre of the screen while it is open.
    const modalOpen = !!run.discover?.length || !!run.chooseOne;
    // A step that ASKED for a spotlight but resolved none — a phase mismatch, or an anchor whose card is not
    // on screen — used to dim the entire board at 0.7 with nothing highlighted, which is indistinguishable
    // from a broken overlay and is exactly the state a stranded step terminates in. Keep the panel, drop the
    // scrim: the player can at least see and read the board (audit 2026-08-21).
    const anchoredButUnresolved = step.anchors.length > 0 && cutouts.length === 0;
    // NO-SCRIM steps (the independence rounds): the player is driving, so drop the dim + spotlight entirely —
    // the coach panel still shows, but the whole board stays at full clarity (same treatment as combat-watch).
    // NO SCRIM while a picker owns the screen (owner 2026-08-21: "step 36 should have no scrim so the
    // player's screen isn't dark"). The Discover overlay already dims the board behind itself; the coach's
    // scrim stacked a second dim on top, so the cards the player is choosing between sat under two layers.
    const noScrim = !combatAnimating && (!!step.noScrim || anchoredButUnresolved || modalOpen);
    const clearScreen = combatAnimating || noScrim;
    // A MODAL OWNS THE CENTRE (owner 2026-08-21: "step 36 obstructs the player's choices", "step 57 is
    // obstructing in the middle"). The coach panel — centred when a step has no anchor, or flipped up off the
    // hand when it does — landed straight on the cards being chosen between. Park it at the bottom instead,
    // the same treatment combat already uses, so the choice is never covered.
    const parkAtBottom = combatAnimating || modalOpen;
    const bottomAnchor = parkAtBottom ? new DOMRect(window.innerWidth / 2 - 1, window.innerHeight - 46, 2, 26) : null;
    // A dismissible free-play step whose panel the player closed with "Got it": hide the panel, keep everything
    // else (no scrim, gate still open) so they can play until they End Turn.
    const panelDismissed = !!step.dismissible && dismissed;
    // WATCH THE FIGHT, THEN READ (owner report 2026-08-20: "the next step shows below the board — hide it until
    // after combat so the player focuses on the combat itself"). A debrief's completion is `returnedToShop`, so
    // it activates the moment the fight STARTS and its panel then sat parked at the bottom of the screen for the
    // whole fight, competing with the combat it is supposed to be summarising.
    //
    // Scoped to `confirm` deliberately. A `predict` step is the opposite case — its entire job is to name what
    // to watch for BEFORE it happens ("Packstrider is about to attack…"), and it holds at an authored safe
    // boundary to do it. Hiding those would delete the lesson rather than protect it.
    const heldForCombat = combatAnimating && step.focusMode === 'confirm';
    return {
      cutouts: clearScreen ? [] : cutouts,
      connector: combatAnimating ? undefined : connector,
      combat: step.phase === 'combat',
      dim: clearScreen ? 0 : undefined,
      panel: panelDismissed || heldForCombat ? undefined : {
        anchorRect: parkAtBottom ? bottomAnchor : primaryRect, // parked at the bottom during a fight or an open picker
        title: step.title,
        body: step.body,
        why: step.why,
        focusMode: step.focusMode,
        // Dismissible steps get a "Got it" that HIDES the panel (no advance); observe-only `always` steps get a
        // Continue that advances; gated steps advance on their action (no button).
        onNext: step.dismissible ? () => setDismissed(true) : (step.completion.kind === 'always' ? () => advance(step) : undefined),
        nextLabel: step.dismissible ? 'Got it' : 'Continue',
        step: cursor + 1,
        total: items.length,
        nudge: step.panelNudge,
      },
    };
    // `events`/`inspect` intentionally excluded from deps — re-measuring is driven by run/step/window, not by
    // every recorded event (which would thrash layout reads during combat).
  }, [isTutorial, current, run, cursor, items.length, advance, dismissed, measureTick]);

  if (!isTutorial) return null;
  return (
    <>
      <TutorialOverlay view={view} />
      {nudge && <div className="tut-nudge" role="status">{nudge}</div>}
    </>
  );
}
