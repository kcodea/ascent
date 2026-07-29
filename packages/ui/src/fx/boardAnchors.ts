import type { FxAnchors, FxPoint } from './anchors';

/**
 * REAL on-screen anchors, read off the live game DOM — the fidelity half of the workbench.
 *
 * Every other scenario stages synthetic viewport FRACTIONS (source at 30% across, target at 70%, …), which
 * is fine for judging a primitive's look but lies about SCALE and DISTANCE: an effect tuned across 40% of a
 * 1080p viewport is a very different effect when it actually has to travel between two 190px cards two slots
 * apart. This module closes that gap by reading the same rects the real firing code reads.
 *
 * Geometry mirrors the REAL firing code (see `fxTestFire.ts`, itself a mirror of Recruit's): the player's
 * side is the `[data-zone="warband"]` row, the opposing side is the `[data-zone="tavern"]` row, and a unit
 * is any `[data-uid]` element inside one of those rows. Those are the SAME selectors the shipping code
 * uses — deliberately not new ones — so a "real board" preview can't drift from where FX actually fire.
 * (In recruit the tavern row holds the shop offers and the warband row holds your board; in combat the two
 * hold the enemy's and your units. Either way they are the two facing rows on screen, which is exactly the
 * geometry a source→target effect cares about.)
 *
 * Pure/impure split: `anchorsFromRects` is total and DOM-free (and therefore unit-tested directly);
 * `readBoardAnchors` is the thin, cached DOM read on top of it.
 */

/** The player's board row and the units inside it. */
export const PLAYER_ROW_SELECTOR = '[data-zone="warband"] .row';
export const PLAYER_UNIT_SELECTOR = '[data-zone="warband"] .row [data-uid]';
/** The opposing row — enemy units in combat, shop offers in recruit. */
export const ENEMY_UNIT_SELECTOR = '[data-zone="tavern"] .row [data-uid]';

/** Override the elements a read samples. Both default to the selectors above; supplied mainly so a caller
 *  can aim at a different pair of rows without this module inventing more selectors of its own. */
export interface BoardAnchorSource {
  sourceSel?: string;
  targetSel?: string;
}

/** The bit of a `DOMRect` the anchor math uses. Structural, so a real `DOMRect` satisfies it and a test can
 *  hand over a plain object without constructing one. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Everything `anchorsFromRects` needs — the DOM read's output, and the only thing separating the pure math
 *  from the browser. */
export interface BoardRects {
  /** The first player unit. */
  source: RectLike | null;
  /** The first enemy/opposing unit. */
  target: RectLike | null;
  /** The player's ROW, used as the `slot` anchor's vertical baseline. Optional — `slot` degrades to the
   *  source unit's own centre without it. */
  row?: RectLike | null;
  viewport: { w: number; h: number };
}

/** A rect only counts if it has real extent: a display:none / not-yet-laid-out element reports 0×0, and
 *  centring on it would silently anchor the effect at the top-left corner of the screen. */
const isUsable = (r: RectLike | null | undefined): r is RectLike =>
  r !== null && r !== undefined && r.width > 0 && r.height > 0;

const centerOf = (r: RectLike): FxPoint => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * PURE: rects → anchors, or `null` when the board isn't usable (either end missing or zero-sized).
 *
 * `slot` is the player unit's SLOT centre rather than its live rect centre: x from the unit (which slot it
 * occupies) but y from the row's midline, so a hover-lifted or mid-drag card doesn't drag the "slot" anchor
 * up with it — a slot is where the card belongs, not where it currently floats. Without a row rect it
 * degrades to the unit's own centre, which is the same point for a card sitting at rest.
 */
export function anchorsFromRects(rects: BoardRects): FxAnchors | null {
  const { source, target, row, viewport } = rects;
  if (!isUsable(source) || !isUsable(target)) return null;
  const src = centerOf(source);
  return {
    source: src,
    target: centerOf(target),
    slot: isUsable(row) ? { x: src.x, y: row.top + row.height / 2 } : src,
    camera: { x: viewport.w / 2, y: viewport.h / 2 },
  };
}

/**
 * How often the DOM is actually measured. `readBoardAnchors` is called from the workbench's per-frame
 * updater, and `getBoundingClientRect` per frame is a documented anti-pattern in this repo (CLAUDE.md,
 * "don't read layout per frame") — it forces a synchronous layout flush on every tick. The board behind the
 * workbench is static (nothing is being dragged; the overlay owns input), so sampling ~5×/second is
 * indistinguishable from sampling every frame and costs ~1/12th as much at 60fps. A scenario switch calls
 * `invalidateBoardAnchors()` so the first frame of the new scenario is never stale.
 */
export const BOARD_SAMPLE_INTERVAL_MS = 200;

/** The last sample, INCLUDING a `null` one — caching the "board isn't up" answer matters most, since that's
 *  the case that would otherwise re-query three selectors every single frame forever. */
let cache: { key: string; at: number; anchors: FxAnchors | null } | null = null;

/** Drop the cached sample so the next read measures for real. Called when the workbench switches scenario
 *  (and available to anything else that knows the board just moved). */
export function invalidateBoardAnchors(): void {
  cache = null;
}

const rectOf = (sel: string): RectLike | null => document.querySelector(sel)?.getBoundingClientRect() ?? null;

/**
 * Real on-screen anchors from the live board, or `null` when the board isn't up (headless, or the workbench
 * opened over a screen with no warband/tavern rows — the title screen, the end screen, a mid-transition
 * unmount). Callers are expected to fall back to synthetic anchors rather than treat `null` as an error.
 *
 * Throttled to `BOARD_SAMPLE_INTERVAL_MS`; see that constant for why.
 */
export function readBoardAnchors(src: BoardAnchorSource = {}): FxAnchors | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const sourceSel = src.sourceSel ?? PLAYER_UNIT_SELECTOR;
  const targetSel = src.targetSel ?? ENEMY_UNIT_SELECTOR;
  const key = `${sourceSel}|${targetSel}`;
  const now = performance.now();
  if (cache !== null && cache.key === key && now - cache.at < BOARD_SAMPLE_INTERVAL_MS) return cache.anchors;
  const anchors = anchorsFromRects({
    source: rectOf(sourceSel),
    target: rectOf(targetSel),
    row: rectOf(PLAYER_ROW_SELECTOR),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  });
  cache = { key, at: now, anchors };
  return anchors;
}
