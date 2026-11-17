/**
 * HERO SELECT CEREMONY — pure geometry (hero-select-ceremony-blueprint.md §8, §9, §17).
 *
 * Everything here is math over plain numbers: rect snapshots, the centered destination, clone transforms,
 * and the unselected cards' exit vectors. No DOM reads — the component reads `getBoundingClientRect()`
 * exactly once at click time (and once per debounced resize) and feeds the numbers through here.
 * NaN-safety is part of the contract: a zero-sized or degenerate rect must produce a usable (if boring)
 * result, never NaN in a transform string.
 */
import type { RectSnapshot } from './heroCeremonyMachine';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Snapshot a DOMRect-ish into plain numbers (§8: never hold the live DOMRect). */
export function snapshotRect(r: { left: number; top: number; width: number; height: number }): RectSnapshot {
  return {
    left: finite(r.left, 0),
    top: finite(r.top, 0),
    width: Math.max(0, finite(r.width, 0)),
    height: Math.max(0, finite(r.height, 0)),
  };
}

export const rectCenter = (r: RectSnapshot): { x: number; y: number } => ({
  x: r.left + r.width / 2,
  y: r.top + r.height / 2,
});

/**
 * The big hero card's own aspect (height ÷ width). FIXED, never taken from the source card.
 *
 * The ceremony always presents a BIG card — the clone re-renders the big-card markup whatever it flew from —
 * so the destination must use the big card's shape. Deriving it from the source instead broke Practice
 * outright (owner report 2026-08-21): the dense roster's compact card is ~2.72:1 against the big card's
 * ~1.31:1, so the destination came out more than twice as tall and the portrait sat off the top of the screen.
 */
export const CEREMONY_ASPECT = 1.31;

/** The design stage the whole UI is authored against (Game.tsx: `--scale` = stage height ÷ 1440). */
const REFERENCE_STAGE_H = 1440;

/**
 * The game's UNIFORM stage scale — the same unitless number every other authored size in the UI multiplies
 * by, so the ceremony grows and shrinks in lockstep with the board instead of drifting against it. Mirrors
 * Game.tsx's own formula rather than reading the CSS var, so the geometry stays a pure function.
 */
export function stageScale(viewportW: number, viewportH: number): number {
  const gh = Math.min(finite(viewportH, REFERENCE_STAGE_H), (finite(viewportW, REFERENCE_STAGE_H) * 9) / 16, REFERENCE_STAGE_H);
  return clamp(gh / REFERENCE_STAGE_H, 0.2, 1.25);
}

/**
 * The centered portrait destination (§8) — SCALE-DRIVEN, not viewport-fraction-driven.
 *
 * It used to be `clamp(0.28 × viewport width, 360, 520)`, which meant the portrait's size tracked the WINDOW
 * while every tuned offset around it (the name plate, the ring, the button) stayed in raw pixels — so the
 * whole composition came apart at any resolution but the one it was dialed at (owner report 2026-08-21:
 * "on 16:9 monitors the sizing is off"). Everything is now reference px × the stage scale, exactly like the
 * rest of the UI, so the ceremony is proportionally identical at every window size.
 */
export function destinationRect(viewportW: number, viewportH: number, _source?: RectSnapshot): RectSnapshot {
  const vw = Math.max(1, finite(viewportW, 1));
  const vh = Math.max(1, finite(viewportH, 1));
  const scale = stageScale(vw, vh);
  const narrow = vw < 720;
  // Reference widths at the 1440 stage. The narrow branch keeps the phone's "fit the shorter side" behaviour.
  const width = narrow
    ? Math.max(200, Math.min(vw * 0.76, vh * 0.42))
    : 636 * scale;
  const height = width * CEREMONY_ASPECT;
  const cx = vw / 2;
  const cy = vh * (narrow ? 0.43 : 0.46);
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * The party-home banner's art frame inside its card, in the 784x1321 flag art's own units (heroSelectPh.css). The card
 * is `padding: 0; container-type: inline-size`; `> .hcframe` is `width: calc(100cqi * 667 / 784); margin-inline: auto;
 * margin-top: calc(100cqi * 96 / 784)`, and the unconditional "PLAY FLAG'S PORTRAIT" rule (R-HS-FADE-01) sets its
 * `aspect-ratio: 667 / 844`. So on desktop the card path's frame is 667 x 844 (taller than wide), which the ceremony's
 * `artCrop` leaves as it is (it only squares a crop WIDER than tall).
 * Small touch screens differ: `html[data-touch-ui][data-touch-small]` rules override the aspect to 1/0.5 or 1/0.8 and
 * `artCrop` then squares that frame to its width. This pure function cannot see that state; it matches desktop.
 */
const PH_FLAG_W = 784;
const PH_FRAME_W = 667;
const PH_FRAME_H = 844;
const PH_FRAME_LEFT = (PH_FLAG_W - PH_FRAME_W) / 2;
const PH_FRAME_TOP = 96;

/**
 * The SHOWCASE's portrait crop (hero select showcase, 2026-11-16; the showcase only renders in the party-home look): the
 * rect the party-home card path's `.hcframe` settles at inside `dest`. The splash path hands THIS to the materializing
 * beat as the art crop (it is not measured), so the final portrait, ring, clip and name plate keep today's size and place.
 */
export function splashDest(dest: RectSnapshot): RectSnapshot {
  const u = Math.max(0, finite(dest.width, 0)) / PH_FLAG_W;
  return {
    left: finite(dest.left, 0) + u * PH_FRAME_LEFT,
    top: finite(dest.top, 0) + u * PH_FRAME_TOP,
    width: u * PH_FRAME_W,
    height: u * PH_FRAME_H,
  };
}

/**
 * The square a cover-fit square image fills to cover `r`: side max(width, height), centred on `r`. The splash clone (a
 * square of art) travels here, so at the handover its art sits at exactly the scale and place the clean portrait's
 * `object-fit: cover` image draws inside the crop: no jump, only the overhang outside the crop, which fades out.
 */
export function coverSquare(r: RectSnapshot): RectSnapshot {
  const w = Math.max(0, finite(r.width, 0));
  const h = Math.max(0, finite(r.height, 0));
  const side = Math.max(w, h);
  return { left: finite(r.left, 0) + (w - side) / 2, top: finite(r.top, 0) + (h - side) / 2, width: side, height: side };
}

/**
 * Where the splash clone TRAVELS (focus keyframes and the resize snap). The source box need not be square: on the showcase
 * the inspect card can grow taller than its art column is wide (e.g. 500 x 532). Its cover-fit square art is then a square
 * of side max(width, height) centred on the box, and THAT square must land on coverSquare(splashDest(dest)). So: uniform
 * scale k = cover side / max(source side), the source box scaled by k and centred on the cover square. The width carries
 * k (transformTo / focusKeyframes scale by width only). A square source gives coverSquare(splashDest(dest)) itself; a
 * degenerate source falls back to it too.
 */
export function splashTravelTarget(source: RectSnapshot, dest: RectSnapshot): RectSnapshot {
  const cover = coverSquare(splashDest(dest));
  const w = Math.max(0, finite(source.width, 0));
  const h = Math.max(0, finite(source.height, 0));
  const side = Math.max(w, h);
  if (side <= 0 || w <= 0) return cover;
  const k = cover.width / side;
  const c = rectCenter(cover);
  return { left: c.x - (w * k) / 2, top: c.y - (h * k) / 2, width: w * k, height: h * k };
}

/**
 * Transform (translate+scale, relative to the clone sitting at the SOURCE rect) that lands the clone on a
 * target rect. The clone is positioned fixed at the source, `transform-origin: top left` — so start is
 * identity and every keyframe is a pure compositor transform.
 */
export function transformTo(source: RectSnapshot, target: RectSnapshot): string {
  const scale = source.width > 0 ? target.width / source.width : 1;
  const dx = target.left - source.left;
  const dy = target.top - source.top;
  return `translate(${finite(dx, 0).toFixed(1)}px, ${finite(dy, 0).toFixed(1)}px) scale(${finite(scale, 1).toFixed(4)})`;
}

/** The §9 focus keyframes: identity → overshoot (at `offset` 0.82) → settle ~3% smaller. */
export function focusKeyframes(source: RectSnapshot, dest: RectSnapshot): Keyframe[] {
  const scale = source.width > 0 ? dest.width / source.width : 1;
  const over = scale * 1.03;
  const dx = dest.left - source.left;
  const dy = dest.top - source.top;
  // Overshoot keeps the same translation target (the center) but a hair larger — it reads as arrival
  // momentum, not a position miss.
  const overDx = dx - (source.width * (over - scale)) / 2;
  const overDy = dy - (source.height * (over - scale)) / 2;
  return [
    { transform: 'translate(0px, 0px) scale(1)' },
    { transform: `translate(${overDx.toFixed(1)}px, ${overDy.toFixed(1)}px) scale(${over.toFixed(4)})`, offset: 0.82 },
    { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(4)})` },
  ];
}

export interface ExitVector {
  x: number;
  y: number;
  rotateDeg: number;
  scale: number;
  /** ms after the first exit begins (already capped — §17's dense-roster rule). */
  delayMs: number;
}

/**
 * Exit vector for one unselected card (§9): cards yield AWAY from the selected card with a distance-driven
 * stagger. `row` nudges vertical drift so multi-row (Practice) grids don't exit as one flat sheet.
 *
 * `alternate` breaks the tie when a card is exactly on the selected center (same column, another row):
 * odd indexes go right, even go left.
 */
export function exitVector(
  card: RectSnapshot,
  selected: RectSnapshot,
  index: number,
  row: number,
  staggerMs: number,
): ExitVector {
  const delta = rectCenter(card).x - rectCenter(selected).x;
  const direction = Math.sign(delta) || (index % 2 === 0 ? -1 : 1);
  const x = direction * clamp(Math.abs(finite(delta, 0)) * 0.24, 90, 180);
  const y = row <= 0 ? -10 : clamp(10 + row * 10, 10, 30);
  const rotateDeg = direction * clamp(Math.abs(finite(delta, 0)) / 240, 0.5, 3);
  // Stagger by distance rank, capped at 180ms total so a 23-card Practice roster clears as fast as three.
  const distanceRank = Math.abs(finite(delta, 0)) / Math.max(1, card.width);
  const delayMs = Math.min(distanceRank * staggerMs, 180);
  return { x, y, rotateDeg, scale: 0.9, delayMs };
}
