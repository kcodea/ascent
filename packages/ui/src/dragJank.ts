/**
 * THE DRAG JANK RECORDER — a dev-only ring buffer of the last couple of seconds of drag motion, so an
 * intermittent snap can be READ instead of guessed at.
 *
 * Owner report 2026-09-01: *"it still happens, and im really not sure what is causing it. it feels kind of
 * random. it seems worse when dragging a minion more than 1 slot over, but it definitely causes a snap-back
 * jank moment."*
 *
 * ── Why a recorder rather than another fix ────────────────────────────────────────────────────────────────
 *
 * Four hypotheses have now been tested against the running game and all four were WRONG:
 *
 *  1. the reorder gap oscillating — the feedback loop converges at every pointer position, including with
 *     deliberate jitter parked on a slot boundary;
 *  2. the neighbours flapping — 96 sampled frames across the warband and 78 across the shop, zero reversals;
 *  3. the floating `.dragcard` remounting mid-drag — zero node swaps across a 60-frame uneven drag;
 *  4. pointer capture dying with its element / `pointercancel` resolving a drop — both were real defects and
 *     are fixed, and the snap outlived them.
 *
 * What scripted input cannot reproduce is the thing a real drag has: a mouse polling at 125–1000 Hz against
 * a frame budget, and real dropped frames. So the next move is not a fifth guess — it is to have the game
 * record the moment, in the owner's hands, at the rate it actually happens.
 *
 * ── What it costs ────────────────────────────────────────────────────────────────────────────────────────
 *
 * DEV only, and one object push per frame INSIDE a loop that is already running per frame — no listener, no
 * layout read, no allocation beyond the sample. `record` is a no-op in production, so this cannot become
 * something players pay for.
 */

/** One frame of the drag's motion, as the rAF saw it. */
export interface DragSample {
  /** ms since the drag started. */
  t: number;
  /** The live pointer, unsmoothed. */
  px: number;
  py: number;
  /** The floating card's smoothed position — what the player actually sees. */
  cx: number;
  cy: number;
  /** The COMMITTED drag state, which advances in re-render quanta and lags `px`/`py`. */
  dx: number;
  dy: number;
  /** True while React+CSS own the transform (a snap-back or a magnet slide) rather than the rAF. */
  reactDriven: boolean;
  /** Frame delta, ms — a spike here is the difference between a real drag and a scripted one. */
  dt: number;
}

const CAPACITY = 240; // ~4s at 60fps, ~2s at 120 — enough to hold the run-up to a snap

let buffer: DragSample[] = [];
let started = 0;

/** How far the card may jump AWAY from the pointer in one frame before it counts as a snap. */
export const SNAP_PX = 18;

/** Whether this session has announced that the recorder is live. One line per SESSION, not per drag. */
let announced = false;

/** Begin a fresh recording. Called when a drag starts, so each drag is its own trace. */
export function beginDragJank(): void {
  if (!import.meta.env.DEV) return;
  buffer = [];
  started = performance.now();
  // ONE line, the first drag of the session. Without it, silence is ambiguous: "no snap happened" and "the
  // recorder never ran" look identical, and the second is the more likely explanation for a filtered console
  // showing nothing at all (owner, 2026-09-01).
  if (!announced) {
    announced = true;
    console.warn('[drag] jank recorder armed — a snap prints here; window.__dragJank() for the trace.');
  }
}

/**
 * Record one frame, and flag a SNAP the moment it happens.
 *
 * The flag is the point: an intermittent glitch that prints `[drag] SNAP` with its own run-up is a bug report
 * that can be acted on, where "it feels kind of random" cannot. Detected as the card moving BACKWARD while
 * the pointer moved forward (or vice versa) — the one thing a weighted lag can never legitimately do, since
 * easing toward a target only ever moves toward it.
 */
export function recordDragJank(s: DragSample): void {
  if (!import.meta.env.DEV) return;
  const prev = buffer[buffer.length - 1];
  buffer.push(s);
  if (buffer.length > CAPACITY) buffer.shift();
  if (!prev || s.reactDriven || prev.reactDriven) return; // a snap-back/magnet slide is SUPPOSED to move it
  // THE RULE: easing always CLOSES the gap to the pointer. `m.rx += (pointer - m.rx) * k` moves toward the
  // target for any k in (0, 1], so a frame where the card ends up FURTHER from the pointer than it started is
  // not motion — it is a discontinuity, and that is the jank.
  //
  // Measured as distance, deliberately, not as "moved the opposite way to the pointer" (the first cut). That
  // version had two blind spots the owner would have hit: a snap while the hand is momentarily STILL — the
  // most likely moment to notice one — was skipped outright, and so was a snap that happened to jump the same
  // way the pointer was already going. Distance-to-target catches both, and needs no pointer motion at all.
  // Both distances are measured to the SAME target — THIS frame's pointer — so the question is only "did the
  // step move the card toward it". Measuring each frame against its own pointer was wrong and a test caught
  // it: a fast flick moves the pointer away faster than the card can follow, so the gap grows while the card
  // is easing perfectly. That version would have cried wolf on every quick drag, which is the one thing a
  // detector must never do.
  const before = Math.hypot(s.px - prev.cx, s.py - prev.cy);
  const after = Math.hypot(s.px - s.cx, s.py - s.cy);
  const opened = after - before;
  if (opened < SNAP_PX) return;
  console.warn(
    `[drag] SNAP at t=${Math.round(s.t)}ms: the card jumped ${Math.round(opened)}px AWAY from the pointer `
    + `(gap ${Math.round(before)}px → ${Math.round(after)}px, dt ${Math.round(s.dt)}ms). `
    + 'window.__dragJank() for the trace.',
  );
}

/** The trace, newest last. Exposed on `window.__dragJank` for the console. */
export function dragJankTrace(): DragSample[] {
  return buffer;
}

/** Publish the console handle. Called once on mount, DEV only. */
export function installDragJankHandle(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  (window as unknown as { __dragJank?: () => DragSample[] }).__dragJank = dragJankTrace;
}
