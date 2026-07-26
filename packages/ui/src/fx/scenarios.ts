import type { FxAnchors, FxPoint } from './anchors';
import { pointOnTravel } from './anchors';
import { readBoardAnchors } from './boardAnchors';

/** Everything a scenario's `headAt` needs to place the effect head for the current frame. */
export interface FxHeadContext {
  viewport: { w: number; h: number };
  /** Live pointer position, page coordinates. */
  cursor: { x: number; y: number };
  /** Last click on the stage, page coordinates. `null` until the user has clicked at least once. */
  click: { x: number; y: number } | null;
  /** 0..1 through the effect's loop. */
  progress: number;
}

export interface FxScenario {
  id: string;
  label: string;
  hint: string;
  /** Stage the anchors for this frame. `cursor` is the live pointer position in page coordinates. */
  anchorsAt(viewport: { w: number; h: number }, cursor: { x: number; y: number }): FxAnchors;
  /** Optional: scenarios that move the effect head along a custom path (chaining between units, pinning to
   *  the cursor, anchoring to a click, ...) implement this. When present, the workbench drives the effect
   *  head from this instead of the default source→target travel arc. */
  headAt?(ctx: FxHeadContext): FxPoint;
}

/** Two units facing off — the shape of an attack. */
export const twoUnits: FxScenario = {
  id: 'twoUnits',
  label: 'Two units',
  hint: 'Source on the left, target on the right — the shape an attack takes.',
  anchorsAt: (v) => ({
    source: { x: v.w * 0.3, y: v.h * 0.5 },
    target: { x: v.w * 0.7, y: v.h * 0.5 },
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
};

/** The effect head IS the live cursor — a real motion trail as you move, particles/rings sit at the
 *  pointer. Replaces the old "follow cursor" scenario (which used the cursor as a travel *target* the head
 *  arced toward); pinning the head to the cursor directly is the more honest read for tuning a live drag. */
export const pinnedCursor: FxScenario = {
  id: 'pinned',
  label: 'Pinned to cursor',
  hint: 'The effect is pinned to your live cursor — move the mouse and it drags along.',
  anchorsAt: (v, c) => ({
    source: { x: v.w * 0.5, y: v.h * 0.5 },
    target: c,
    cursor: c,
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
  headAt: (ctx) => ctx.cursor,
};

/** Click anywhere on the stage to anchor the effect there — for tuning stationary hit/impact effects at an
 *  arbitrary point instead of a fixed layout. Sits at viewport centre until the first click. */
export const clickPlace: FxScenario = {
  id: 'click',
  label: 'Click to place',
  hint: 'Click anywhere on the stage to place the effect there.',
  anchorsAt: (v) => ({
    source: { x: v.w * 0.5, y: v.h * 0.5 },
    target: { x: v.w * 0.5, y: v.h * 0.5 },
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
  headAt: (ctx) => ctx.click ?? { x: ctx.viewport.w / 2, y: ctx.viewport.h / 2 },
};

/** The four unit centres a bounce/chain effect ricochets between, staged in a horizontal row across the
 *  viewport (with a slight zigzag in y so consecutive arcs read as bouncing rather than a flat ping-pong).
 *  Exported so tests can assert `headAt` lands on these without re-deriving the layout. */
export function bounceUnits(v: { w: number; h: number }): FxPoint[] {
  const units: FxPoint[] = [];
  for (let i = 0; i < 4; i++) {
    units.push({
      x: v.w * (0.2 + i * 0.2),
      y: v.h * 0.5 + (i % 2 === 0 ? -1 : 1) * v.h * 0.05,
    });
  }
  return units;
}

/** Waypoint order for one full ping-pong cycle: out to the far end, then back. Because the sequence starts
 *  and ends on unit 0, the loop point (progress 1 -> 0) is itself continuous — the last leg's end and the
 *  first leg's start are the same unit, so looping never teleports either. */
const BOUNCE_WAYPOINTS = [0, 1, 2, 3, 2, 1, 0];

/** Bounces the effect head back and forth along a row of four units — the shape a bounce/ricochet spell
 *  takes, as opposed to a single source→target hop or a one-way loop around a ring. Reverses cleanly at
 *  each end (no teleport at the turnaround) and alternates its arc bow per leg so it reads as bouncing. */
export const bounceScenario: FxScenario = {
  id: 'bounce',
  label: 'Bounce between units',
  hint: 'The effect head bounces back and forth along four units on arcs — the shape a ricochet spell takes.',
  anchorsAt: (v) => {
    const units = bounceUnits(v);
    return {
      source: units[0],
      target: units[1],
      camera: { x: v.w * 0.5, y: v.h * 0.5 },
    };
  },
  headAt: (ctx) => {
    const units = bounceUnits(ctx.viewport);
    const legs = BOUNCE_WAYPOINTS.length - 1;
    const scaled = ctx.progress * legs;
    const leg = Math.min(Math.floor(scaled), legs - 1);
    const t = scaled - leg;
    const fromUnit = units[BOUNCE_WAYPOINTS[leg]];
    const toUnit = units[BOUNCE_WAYPOINTS[leg + 1]];
    // Alternate the bow sign per leg so consecutive arcs curve opposite ways — reads as a bounce, not a
    // one-directional whip.
    const bow = leg % 2 === 0 ? 0.22 : -0.22;
    return pointOnTravel(fromUnit, toUnit, t, bow);
  },
};

/** A short, contained sweep at screen centre — for tuning an effect's look without chasing motion across
 *  the screen. A truly-still head would make the ribbon primitive (a motion trail) vanish entirely, so this
 *  gives it a small amplitude to sweep through instead of holding one point; particle/ring primitives read
 *  as effectively stationary against it. */
export const stationary: FxScenario = {
  id: 'stationary',
  label: 'Stationary (in place)',
  hint: 'The effect animates in place at centre — for tuning the look without motion.',
  anchorsAt: (v) => ({
    source: { x: v.w * 0.5, y: v.h * 0.5 },
    target: { x: v.w * 0.5, y: v.h * 0.5 },
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
  headAt: (ctx) => {
    const amplitude = Math.min(ctx.viewport.w, ctx.viewport.h) * 0.06;
    const wave = Math.sin(ctx.progress * Math.PI * 2);
    return {
      x: ctx.viewport.w * 0.5 + wave * amplitude,
      y: ctx.viewport.h * 0.5,
    };
  },
};

/** The synthetic stand-in `realBoard` uses when the live board isn't on screen — deliberately the SAME
 *  layout `twoUnits` stages, so falling back lands you on the well-understood default rather than on a
 *  third, subtly-different geometry. */
const syntheticBoard = (v: { w: number; h: number }): FxAnchors => ({
  source: { x: v.w * 0.3, y: v.h * 0.5 },
  target: { x: v.w * 0.7, y: v.h * 0.5 },
  slot: { x: v.w * 0.3, y: v.h * 0.5 },
  camera: { x: v.w * 0.5, y: v.h * 0.5 },
});

/**
 * The REAL board: anchors read off the live game DOM (see `boardAnchors.ts`) instead of viewport fractions,
 * so an effect is tuned at the true distance and scale it will actually fire at. The workbench overlay is
 * transparent between its chrome, so the board is visible underneath while you tune.
 *
 * Degrades rather than breaks: with no board on screen (title screen, end screen, headless) it stages the
 * `twoUnits` layout instead, and `hint` says which of the two you're looking at — a silently-synthetic
 * "real board" would be worse than no scenario at all.
 */
export const realBoard: FxScenario = {
  id: 'realBoard',
  label: 'Real board',
  // A GETTER, deliberately: the hint has to report which of the two states you're in, and that is only
  // knowable at read time. Read on React render (not per frame), and `readBoardAnchors` is cached, so this
  // costs nothing. Everything else about `hint` — a plain string to the consumer — is unchanged.
  get hint(): string {
    return readBoardAnchors() !== null
      ? 'Anchors read from the LIVE board — source = your first unit, target = the first opposing unit.'
      : 'No board on screen — falling back to synthetic two-unit anchors. Open this over Recruit or a combat.';
  },
  anchorsAt: (v, c) => {
    const live = readBoardAnchors();
    // `cursor` is folded in at this level because only the scenario is handed the pointer — a cursor-anchored
    // layer must keep working over the real board too.
    return live !== null ? { ...live, cursor: c } : { ...syntheticBoard(v), cursor: c };
  },
};

export const SCENARIOS: FxScenario[] = [twoUnits, pinnedCursor, clickPlace, bounceScenario, stationary, realBoard];
