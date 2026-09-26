/**
 * The REBIRTH flame crown: soft blue-white fire burning along the top of the portrait's frame, drawn as a few
 * PRE-RENDERED SVG frames. History: v1 (a 3px rim) was "not noticeable and ugly"; v2's spiky cut-out tongues
 * behind the frame were "still really bad … can you blur it and just overall improve its readability … it should
 * be on top of the card" (owner 2026-09-26). So v3 is FEW, LARGE, CALM tongues with the BLUR BAKED INTO THE
 * IMAGE, seated ON the gold ring (the card's overlay layer, like Ward's shell), plus a soft burning line along
 * the ring itself.
 *
 * WHAT IT IS, TECHNICALLY. Plain CSS layers — `div`s whose `background-image` is one of these SVG data-URIs.
 * The browser rasterises each image once per on-screen size (the blur is part of that one-time raster, never a
 * live `filter`), and the card then only cross-fades the frames (opacity) and breathes them (scale), which the
 * compositor does without repainting. No Pixi, no canvas, no per-frame layout or paint.
 *
 * Geometry is in "frame units": 100 = the archbox width (`--ccw`), (0,0) = the portrait's centre. Two rim
 * shapes, because the flames sit ON the frame and must follow it:
 *  · `oval` — every standard minion: the window is ~73 x 94 (styles.css `.stdframe .art`), the gold ring's
 *    centre line ~ 43 x 51 radii;
 *  · `shield` — Taunt's heater frame (`--heater`, window 72 x 92): the rim is the heater outline pushed out to
 *    the middle of its gold.
 * The crown box is `CROWN_BOX` units square, centred on the portrait (styles.css sizes `.rebirth-crown` to match).
 *
 * Presentation-only: the per-frame jitter is a tiny local PRNG, seeded, so the frames are the same every load.
 */

export const CROWN_FRAMES = 3;
/** The crown box side in frame units (100 = card art width). styles.css sizes `.rebirth-crown` to match. */
export const CROWN_BOX = 200;
export type CrownShape = 'oval' | 'shield';

export interface CrownColors {
  /** Deep outer flame (cobalt). */
  deep: string;
  /** Hot mid flame (cyan). */
  hot: string;
  /** White-hot core. */
  core: string;
}

/** mulberry32 — the same generator the engine uses; local copy so this presentation file imports nothing. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number): string => n.toFixed(2);

/** One tongue in its own frame: base centred on the origin, pointing up (-y). `w` half-width, `l` length,
 *  `lean` the tip's sideways offset. A full, rounded body narrowing into a soft tip (the blur does the rest). */
function tonguePath(w: number, l: number, lean: number): string {
  return `M${f(-w)} 0`
    + `C${f(-w * 1.1)} ${f(-l * 0.35)} ${f(-w * 0.45 + lean * 0.3)} ${f(-l * 0.7)} ${f(lean)} ${f(-l)}`
    + `C${f(w * 0.45 + lean * 0.3)} ${f(-l * 0.7)} ${f(w * 1.1)} ${f(-l * 0.35)} ${f(w)} 0`
    + `Q0 ${f(w * 1.2)} ${f(-w)} 0Z`;
}

/** A point on the rim at `t` (-1 = low on the left flank, 0 = top centre, 1 = low on the right), with its
 *  outward normal. */
interface RimPoint { x: number; y: number; nx: number; ny: number }

const OVAL_RX = 43;
const OVAL_RY = 51;
function ovalRim(t: number): RimPoint {
  const th = t * (112 * Math.PI) / 180;
  const x = OVAL_RX * Math.sin(th);
  const y = -OVAL_RY * Math.cos(th);
  const nx = x / (OVAL_RX * OVAL_RX), ny = y / (OVAL_RY * OVAL_RY);
  const nl = Math.hypot(nx, ny) || 1;
  return { x, y, nx: nx / nl, ny: ny / nl };
}

/** Taunt's heater window (styles.css `--heater`, % of the window box), as frame units around the centre. The
 *  outline is walked from the left flank, over the top, to the right flank, then pushed out to the gold. */
const HEATER: [number, number][] = [[7.2, 65], [2.1, 50], [0.1, 35], [0.1, 22], [1.1, 12], [3.2, 5], [19.5, 0], [50, 0], [80.9, 0], [97.1, 5], [98.9, 12], [99.9, 22], [99.9, 35], [97.9, 50], [92.8, 65]];
const HEATER_PTS = HEATER.map(([px, py]) => ({ x: (px - 50) * 0.72, y: (py - 50) * 0.92 }));
const HEATER_LEN = (() => {
  const acc = [0];
  for (let i = 1; i < HEATER_PTS.length; i++) acc.push(acc[i - 1]! + Math.hypot(HEATER_PTS[i]!.x - HEATER_PTS[i - 1]!.x, HEATER_PTS[i]!.y - HEATER_PTS[i - 1]!.y));
  return acc;
})();
function shieldRim(t: number): RimPoint {
  const total = HEATER_LEN[HEATER_LEN.length - 1]!;
  const d = ((t + 1) / 2) * total;
  let i = 1;
  while (i < HEATER_LEN.length - 1 && HEATER_LEN[i]! < d) i++;
  const a = HEATER_PTS[i - 1]!, b = HEATER_PTS[i]!;
  const u = (d - HEATER_LEN[i - 1]!) / Math.max(1e-6, HEATER_LEN[i]! - HEATER_LEN[i - 1]!);
  const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
  // Outward normal of the segment (the walk is clockwise on screen, so the outward side is (dy, -dx)).
  const dx = b.x - a.x, dy = b.y - a.y, dl = Math.hypot(dx, dy) || 1;
  const nx = dy / dl, ny = -dx / dl;
  const push = 7; // from the window edge out to the middle of the gold
  return { x: x + nx * push, y: y + ny * push, nx, ny };
}

const rimOf = (shape: CrownShape): ((t: number) => RimPoint) => (shape === 'shield' ? shieldRim : ovalRim);

export interface Tongue { x: number; y: number; rot: number; w: number; l: number; lean: number; back: boolean }

/** The tongues of one frame: 7 large front tongues across the top and upper flanks, and 6 softer back tongues
 *  between them. `k` picks the gentle per-frame jitter (±15% length, a small lean); `size` scales every length. */
export function crownTongues(k: number, size = 1, shape: CrownShape = 'oval'): Tongue[] {
  const rnd = prng(0x5eb1f7 + k * 977 + (shape === 'shield' ? 31 : 0));
  const rim = rimOf(shape);
  const out: Tongue[] = [];
  const row = (n: number, span: number, back: boolean): void => {
    for (let i = 0; i < n; i++) {
      const t = (-span + (i / (n - 1)) * span * 2);
      const p = rim(t);
      // Fire rises: the tongue's axis is the outward normal bent well toward straight up.
      const bend = 0.55;
      const dx = p.nx * (1 - bend), dy = p.ny * (1 - bend) - bend;
      const peak = Math.max(0.25, 1 - Math.abs(t) * 0.8); // tallest at the crest, low along the flanks
      out.push({
        x: p.x, y: p.y,
        rot: (Math.atan2(dx, -dy) * 180) / Math.PI,
        w: (back ? 9 : 8) * (0.75 + 0.35 * peak),
        l: (back ? 30 : 38) * peak * (0.85 + rnd() * 0.3) * size,
        lean: (rnd() - 0.5) * 6,
        back,
      });
    }
  };
  row(6, 0.78, true);
  row(7, 0.92, false);
  return out;
}

/** The soft burning line along the rim (the top ~3/4 of it). */
function rimPath(shape: CrownShape): string {
  const rim = rimOf(shape);
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) { const p = rim(-1 + (i / 40) * 2); pts.push(`${f(p.x)} ${f(p.y)}`); }
  return `M${pts.join('L')}`;
}

/** One crown frame as an SVG document. The portrait's centre is (0,0). Every edge is pre-blurred. */
export function crownSvg(k: number, c: CrownColors, size = 1, shape: CrownShape = 'oval'): string {
  const half = CROWN_BOX / 2;
  const tongues = crownTongues(k, size, shape);
  const g = (t: Tongue, sw: number, sl: number, fill: string, extra = ''): string =>
    `<path transform="translate(${f(t.x)} ${f(t.y)}) rotate(${f(t.rot)})" d="${tonguePath(t.w * sw, t.l * sl, t.lean * sl)}" fill="${fill}"${extra}/>`;
  const back = tongues.filter((t) => t.back);
  const front = tongues.filter((t) => !t.back);
  const rim = rimPath(shape);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${CROWN_BOX} ${CROWN_BOX}">`
    + '<defs>'
    // objectBoundingBox gradients run along each tongue's OWN axis (the bbox is taken before the rotate).
    + `<linearGradient id="d" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.hot}" stop-opacity="0.85"/><stop offset="0.5" stop-color="${c.deep}" stop-opacity="0.75"/><stop offset="1" stop-color="${c.deep}" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.core}"/><stop offset="0.45" stop-color="${c.hot}" stop-opacity="0.85"/><stop offset="1" stop-color="${c.hot}" stop-opacity="0"/></linearGradient>`
    + '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4.5"/></filter>'
    + '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>'
    + '<filter id="core" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.3"/></filter>'
    + '</defs>'
    // A faint halo (deep flame, heavily blurred) that seats the fire on the frame.
    + `<g filter="url(#glow)" opacity="0.55">${front.map((t) => g(t, 1.4, 1.0, c.deep)).join('')}<path d="${rim}" fill="none" stroke="${c.deep}" stroke-width="7" stroke-linecap="round"/></g>`
    // The flame bodies, soft-edged.
    + `<g filter="url(#soft)">${back.map((t) => g(t, 1, 1, 'url(#d)', ' opacity="0.7"')).join('')}${front.map((t) => g(t, 1, 1, 'url(#d)')).join('')}</g>`
    // The burning line along the ring + the hot inner tongues.
    + `<g filter="url(#core)"><path d="${rim}" fill="none" stroke="${c.hot}" stroke-width="2.6" stroke-linecap="round" opacity="0.8"/>`
    + `${front.map((t) => g(t, 0.55, 0.72, 'url(#h)')).join('')}</g>`
    + '</svg>';
}

/** A frame as a CSS `url(...)` value. */
export function crownUrl(k: number, c: CrownColors, size = 1, shape: CrownShape = 'oval'): string {
  return `url("data:image/svg+xml,${encodeURIComponent(crownSvg(k, c, size, shape))}")`;
}

/** The TRIGGER's flame pillar: a sheaf of tall tongues from one base (bottom centre), fanned slightly, that the
 *  `rebirthing` re-form erupts out of (fx/rebirthPillar.ts). ViewBox 120 x 200, base at (60, 190). Same tongue +
 *  gradient language as the crown, pre-blurred the same way, so the idle fire and the eruption read as one. */
export function pillarSvg(c: CrownColors): string {
  const rnd = prng(0x0f1a3e);
  const tongues: { x: number; rot: number; w: number; l: number; lean: number }[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5; // -0.5..0.5
    const centre = 1 - Math.abs(t) * 1.4;
    tongues.push({
      x: 60 + t * 58 + (rnd() - 0.5) * 5,
      rot: t * 30 + (rnd() - 0.5) * 6,
      w: 10 + centre * 7 + rnd() * 2,
      l: (70 + centre * 100) * (0.85 + rnd() * 0.3),
      lean: (rnd() - 0.5) * 16,
    });
  }
  const p = (t: (typeof tongues)[number], sw: number, sl: number, fill: string, extra = ''): string =>
    `<path transform="translate(${f(t.x)} 190) rotate(${f(t.rot)})" d="${tonguePath(t.w * sw, t.l * sl, t.lean * sl)}" fill="${fill}"${extra}/>`;
  const order = [...tongues].sort((a, b) => b.l - a.l); // the tallest behind
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 200">'
    + '<defs>'
    + `<linearGradient id="d" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.hot}"/><stop offset="0.5" stop-color="${c.hot}" stop-opacity="0.9"/><stop offset="0.82" stop-color="${c.deep}" stop-opacity="0.8"/><stop offset="1" stop-color="${c.deep}" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.core}"/><stop offset="0.55" stop-color="${c.core}" stop-opacity="0.85"/><stop offset="1" stop-color="${c.hot}" stop-opacity="0"/></linearGradient>`
    + '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>'
    + '<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>'
    + '</defs>'
    + `<g filter="url(#b)" opacity="0.8">${order.map((t) => p(t, 1.5, 1.05, c.deep)).join('')}</g>`
    + '<g filter="url(#s)">'
    + order.map((t) => p(t, 1, 1, 'url(#d)')).join('')
    + order.map((t) => p(t, 0.58, 0.8, 'url(#h)')).join('')
    + '</g></svg>';
}

export function pillarUrl(c: CrownColors): string {
  return `url("data:image/svg+xml,${encodeURIComponent(pillarSvg(c))}")`;
}
