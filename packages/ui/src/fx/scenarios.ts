import type { FxAnchors, FxPoint } from './anchors';
import { pointOnTravel } from './anchors';
import { anchorsFromRects, readBoardAnchors, type RectLike } from './boardAnchors';

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

/**
 * The Stage Setter's mock DOM (see `StageSetter.tsx`): a container carrying `data-fx-stage` (mounted by the
 * workbench per Task 6, only while this scenario is active), two zone rows of role-tagged `[data-uid]`
 * actors, and three draggable point handles (`data-handle="source"|"target"|"cursor"`). Mirrors
 * `boardAnchors.ts`'s selectors for the LIVE game board — same idea, different (author-composed) stage.
 */
const STAGE_CONTAINER_SELECTOR = '[data-fx-stage]';
const stageRoleSelector = (which: 'source' | 'target'): string => `${STAGE_CONTAINER_SELECTOR} [data-role="${which}"]`;
const stageHandleSelector = (which: 'source' | 'target' | 'cursor'): string =>
  `${STAGE_CONTAINER_SELECTOR} [data-handle="${which}"]`;

/** A rect only counts if it has real extent — same guard `anchorsFromRects` applies internally, needed here
 *  a step earlier to decide whether to fall back from the role-tagged actor to the bare point handle. */
const hasExtent = (r: RectLike | null | undefined): r is RectLike =>
  r !== null && r !== undefined && r.width > 0 && r.height > 0;

const rectCenter = (r: RectLike): FxPoint => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** SOURCE/TARGET rect: the role-tagged actor (an author who set a card's role to SRC/TGT wants THAT card's
 *  position) takes priority over the bare point handle, which is the floor once the stage is mounted at all —
 *  `StageSetter` always renders its three point handles even with zero actors placed, so this only returns
 *  `null` when the stage container itself isn't in the DOM. */
function stageRectFor(which: 'source' | 'target'): RectLike | null {
  const role = document.querySelector(stageRoleSelector(which))?.getBoundingClientRect() ?? null;
  if (hasExtent(role)) return role;
  const handle = document.querySelector(stageHandleSelector(which))?.getBoundingClientRect() ?? null;
  return hasExtent(handle) ? handle : null;
}

/** Same cadence as `readBoardAnchors` — `anchorsAt` is called every frame from the workbench's updater, and
 *  `getBoundingClientRect` per frame is the anti-pattern `boardAnchors.ts` already exists to avoid (see its
 *  own doc comment on `BOARD_SAMPLE_INTERVAL_MS`). Kept as its own cache (not sharing `boardAnchors.ts`'s)
 *  because the two scenarios can never be active at once, but each caches a materially different read. */
const STAGE_SAMPLE_INTERVAL_MS = 200;

let stageCache: { at: number; anchors: FxAnchors | null } | null = null;

/** Drop the cached stage sample so the first frame after a scenario/def switch never reads stale DOM — the
 *  sibling of `invalidateBoardAnchors`. */
export function invalidateStageAnchors(): void {
  stageCache = null;
}

/**
 * Real anchors read off the Stage Setter's mock DOM, or `null` when its container isn't mounted (this
 * scenario isn't active, or the workbench hasn't wired it in yet — see Task 6). `source`/`target`/`slot`/
 * `camera` come from `anchorsFromRects` (reused, not re-derived); `cursor` is folded in from the cursor point
 * handle when it has real extent, left absent otherwise so the caller's fallback (the live pointer) applies.
 */
function readStageAnchors(): FxAnchors | null {
  if (typeof document === 'undefined') return null;
  const now = performance.now();
  if (stageCache !== null && now - stageCache.at < STAGE_SAMPLE_INTERVAL_MS) return stageCache.anchors;
  let anchors: FxAnchors | null = null;
  if (document.querySelector(STAGE_CONTAINER_SELECTOR) !== null) {
    const base = anchorsFromRects({
      source: stageRectFor('source'),
      target: stageRectFor('target'),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });
    if (base !== null) {
      const cursorRect = document.querySelector(stageHandleSelector('cursor'))?.getBoundingClientRect() ?? null;
      anchors = hasExtent(cursorRect) ? { ...base, cursor: rectCenter(cursorRect) } : base;
    }
  }
  stageCache = { at: now, anchors };
  return anchors;
}

/**
 * The AUTHORED stage: anchors read off the Stage Setter's placed actors/points instead of the live game DOM
 * (`realBoard`) or a viewport fraction — for composing a look against a hand-built layout (an odd formation,
 * an off-screen source, a struck/buffed pairing) that the real board or the synthetic spots can't produce.
 *
 * Degrades exactly like `realBoard`: with the stage not mounted (this scenario isn't the active one yet, or
 * the workbench hasn't rendered it — Task 6), it stages the same synthetic bounce layout instead, and `hint`
 * says which of the two you're looking at.
 */
export const stageSetter: FxScenario = {
  id: 'stageSetter',
  label: 'Stage setter',
  get hint(): string {
    const container = typeof document === 'undefined' ? null : document.querySelector(STAGE_CONTAINER_SELECTOR);
    if (container === null) {
      return 'The Stage Setter is not open — falling back to synthetic anchors. Switch to this scenario to place actors and points.';
    }
    const n = container.querySelectorAll('[data-uid]').length;
    return `Anchors read from the STAGE SETTER — ${n} actor${n === 1 ? '' : 's'} placed; source/target prefer the SRC/TGT-tagged card, falling back to the point handles.`;
  },
  anchorsAt: (v, c) => {
    const live = readStageAnchors();
    if (live === null) return syntheticBoard(v, c);
    // Same "nothing is ever left unstaged" rule as `realBoard`: everything the live read left out (or the
    // whole read, if the stage isn't up) falls back to the synthetic layout, never to (0,0). `cursor` prefers
    // the placed cursor handle when it has real extent, else the live pointer `c`.
    return { ...syntheticBoard(v, c), ...live, cursor: live.cursor ?? c };
  },
};

// `oneWay` is FIRST, and therefore the default stage: it is the only one that shows what a def will do in
// the game — cross once, arrive, finish. The others are tuning aids for a look in isolation. `stageSetter`
// sits before `realBoard` so both remain: one previews the live game, the other an authored composition.
export const SCENARIOS: FxScenario[] = [oneWay, bounceScenario, pinnedCursor, stationary, stageSetter, realBoard];
