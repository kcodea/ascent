import type { FxAnchors, FxPoint } from './anchors';
import { pointOnTravel } from './anchors';
import { readBoardAnchors } from './boardAnchors';

/** Everything a scenario's `headAt` needs to place the effect head for the current frame. */
export interface FxHeadContext {
  viewport: { w: number; h: number };
  /** Live pointer position, page coordinates. */
  cursor: { x: number; y: number };
  /** 0..1 through the effect's loop. */
  progress: number;
}

export interface FxScenario {
  id: string;
  label: string;
  hint: string;
  /** Stage the anchors for this frame. `cursor` is the live pointer position in page coordinates. */
  anchorsAt(viewport: { w: number; h: number }, cursor: { x: number; y: number }): FxAnchors;
  /** Optional: scenarios that move the effect head along a custom path (bouncing between spots, pinning to
   *  the cursor, ...) implement this. When present, the workbench drives the effect head from this instead
   *  of the default source→target travel arc. */
  headAt?(ctx: FxHeadContext): FxPoint;
}

/**
 * Stage EVERY anchor a layer can be pinned to, from the two points a travel arc runs between plus the live
 * cursor.
 *
 * Staging all of them is load-bearing, not tidiness. `resolveAnchor` falls back to (0,0) for an anchor the
 * scenario left out, which parks the effect in the top-left corner of the page — off-stage, and completely
 * indistinguishable from "this scenario is broken". Most of the old scenarios staged only source/target/
 * camera, so any layer anchored to `cursor` or `slot` rendered nothing in all of them, which is exactly the
 * bug this replaces. Every scenario below goes through here, so a new anchor id can never be silently
 * unstaged in one mode and fine in another.
 */
function stageAll(
  source: FxPoint,
  target: FxPoint,
  cursor: FxPoint,
  v: { w: number; h: number },
): FxAnchors {
  return {
    source,
    target,
    // `slot` is a board position in the real game; on a synthetic stage the source position is the honest
    // stand-in (it's where the acting unit sits).
    slot: source,
    cursor,
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  };
}

/**
 * Source on the left, target on the right, and the head crosses ONCE — the shape a real attack takes, and
 * the only stage that previews what a def will actually do in combat.
 *
 * Deliberately has NO `headAt`. That hands `travel` back to `resolveAnchor`, which now runs it along each
 * layer's own window (`layerTravelProgress`), so a layer with a `travelMs` genuinely arrives at the target
 * and STAYS there — which is what lets a ribbon's tail drain into the stopped head and a burst read as a
 * consequence of the arrival. A scenario with a custom path overrides `travel` outright and drives the head
 * forever, so on Bounce the head never stops, the drain never fires and an arrival never happens: fine for
 * judging a trail's look in motion, useless for judging a composition that has an ending.
 */
export const oneWay: FxScenario = {
  id: 'oneWay',
  label: 'One-way (source → target)',
  hint: 'The head crosses once, lands on the target and stays — the shape a real attack takes. Use this one with Loop off and Fire.',
  anchorsAt: (v, c) => {
    const [a, b] = bounceSpots(v);
    return stageAll(a, b, c, v);
  },
};

/** The two spots a bounce ricochets between. Exported so tests can assert `headAt` lands on them without
 *  re-deriving the layout. */
export function bounceSpots(v: { w: number; h: number }): [FxPoint, FxPoint] {
  return [
    { x: v.w * 0.32, y: v.h * 0.5 },
    { x: v.w * 0.68, y: v.h * 0.5 },
  ];
}

/** Perpendicular bow on each bounce leg. The SAME sign is used both ways on purpose: `pointOnTravel`
 *  measures the bow perpendicular to the direction of travel, so reversing the leg already flips which side
 *  it bows to. Same sign therefore traces a flattened loop (out one way, back the other); flipping the sign
 *  would retrace the identical arc backwards, and the head would appear to reverse through its own trail. */
const BOUNCE_BOW = 0.22;

/**
 * The head bounces back and forth between two spots. One full cycle is out (A→B) and back (B→A), so the
 * loop point is continuous: progress 1 ends on A, which is where progress 0 starts.
 */
export const bounceScenario: FxScenario = {
  id: 'bounce',
  label: 'Bounce between two spots',
  hint: 'The head arcs back and forth between two points — the shape a travelling or ricocheting effect takes.',
  anchorsAt: (v, c) => {
    const [a, b] = bounceSpots(v);
    return stageAll(a, b, c, v);
  },
  headAt: (ctx) => {
    const [a, b] = bounceSpots(ctx.viewport);
    const outbound = ctx.progress < 0.5;
    const t = outbound ? ctx.progress * 2 : (ctx.progress - 0.5) * 2;
    return outbound ? pointOnTravel(a, b, t, BOUNCE_BOW) : pointOnTravel(b, a, t, BOUNCE_BOW);
  },
};

/** The effect head IS the live cursor — a real motion trail as you move, particles/rings sit at the
 *  pointer. The honest read for tuning anything that follows a drag or a moving unit. */
export const pinnedCursor: FxScenario = {
  id: 'pinned',
  label: 'Pinned to cursor',
  hint: 'The effect is pinned to your live cursor — move the mouse and it drags along.',
  anchorsAt: (v, c) => stageAll({ x: v.w * 0.5, y: v.h * 0.5 }, c, c, v),
  headAt: (ctx) => ctx.cursor,
};

/**
 * Dead still at screen centre — for judging an effect's look with no motion in the way.
 *
 * Genuinely stationary, unlike the earlier version of this scenario, which crept along a small sine sweep
 * so that the ribbon primitive (a motion trail, which draws nothing from a still head) would still show
 * something. That traded an honest "stationary" for one primitive's convenience; a ribbon belongs on a
 * stage that moves, and the hint says so.
 */
export const stationary: FxScenario = {
  id: 'stationary',
  label: 'Stationary (in place)',
  hint: 'The effect animates in place at centre, with no movement. (A ribbon is a motion trail — it needs One-way, Bounce or Pinned to draw anything.)',
  anchorsAt: (v, c) => {
    const centre = { x: v.w * 0.5, y: v.h * 0.5 };
    return stageAll(centre, centre, c, v);
  },
  headAt: (ctx) => ({ x: ctx.viewport.w * 0.5, y: ctx.viewport.h * 0.5 }),
};

/** The synthetic stand-in `realBoard` uses when the live board isn't on screen: the same two spots Bounce
 *  stages, so falling back lands you on a layout you already understand. */
const syntheticBoard = (v: { w: number; h: number }, c: FxPoint): FxAnchors => {
  const [a, b] = bounceSpots(v);
  return stageAll(a, b, c, v);
};

/**
 * The REAL board: anchors read off the live game DOM (see `boardAnchors.ts`) instead of viewport fractions,
 * so an effect is tuned at the true distance and scale it will actually fire at. The workbench overlay is
 * transparent between its chrome, so the board is visible underneath while you tune.
 *
 * Degrades rather than breaks: with no board on screen (title screen, end screen, headless) it stages the
 * synthetic layout instead, and `hint` says which of the two you're looking at — a silently-synthetic
 * "real board" would be worse than no scenario at all.
 */
export const realBoard: FxScenario = {
  id: 'realBoard',
  // A GETTER, deliberately: the hint has to report which of the two states you're in, and that is only
  // knowable at read time. Read on React render (not per frame), and `readBoardAnchors` is cached, so this
  // costs nothing. Everything else about `hint` — a plain string to the consumer — is unchanged.
  label: 'Real board',
  get hint(): string {
    return readBoardAnchors() !== null
      ? 'Anchors read from the LIVE board — source = your first unit, target = the first opposing unit.'
      : 'No board on screen — falling back to synthetic anchors. Open this over Recruit or a combat.';
  },
  anchorsAt: (v, c) => {
    const live = readBoardAnchors();
    if (live === null) return syntheticBoard(v, c);
    // The live read supplies source/target/slot/camera; `cursor` is folded in at this level because only the
    // scenario is handed the pointer. Anything the board read left out falls back to the synthetic stage
    // rather than to (0,0) — the same "no anchor is ever unstaged" rule `stageAll` enforces.
    return { ...syntheticBoard(v, c), ...live, cursor: c };
  },
};

// `oneWay` is FIRST, and therefore the default stage: it is the only one that shows what a def will do in
// the game — cross once, arrive, finish. The others are tuning aids for a look in isolation.
export const SCENARIOS: FxScenario[] = [oneWay, bounceScenario, pinnedCursor, stationary, realBoard];
