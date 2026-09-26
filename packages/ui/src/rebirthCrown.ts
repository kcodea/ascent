/**
 * The REBIRTH flame crown (owner 2026-09-26: the first look was "not noticeable and ugly"): blue-white fire licking
 * up around the top of the portrait oval, drawn as a few PRE-RENDERED SVG frames.
 *
 * WHY PRE-RENDERED FRAMES. The looping idle must animate transform/opacity only (CLAUDE.md, the `kwglow`
 * pattern). Every gradient and blur lives inside these static SVG images, which the browser rasterises once per
 * size; the card then cross-fades between the frames (opacity) and breathes them (scale). A flipbook of
 * `CROWN_FRAMES` frames reads as flickering fire while costing a handful of composited layers per card, not one
 * per tongue.
 *
 * Geometry is in "oval units": 100 = the archbox width (`--ccw`). The standard oval window is centred on the
 * archbox with radii ~36.5 × 47 (styles.css `.stdframe .art`); tongues root just inside the gold ring
 * (`RIM_RX` × `RIM_RY`) so their bases hide behind the frame and only the licking fire shows beyond it.
 * The crown box is `CROWN_BOX` units square, centred on the oval.
 *
 * Presentation-only: the per-frame jitter is a tiny local PRNG, seeded, so the frames are the same every load.
 */

export const CROWN_FRAMES = 4;
/** The crown box side in oval units (100 = card art width). styles.css sizes `.rebirth-crown` to match. */
export const CROWN_BOX = 240;
/** Where the tongues ROOT: just inside the gold ring's outer edge, so the bases hide behind the frame. */
const RIM_RX = 43;
const RIM_RY = 50;
/** The burning band that hugs the frame's outer edge (mostly hidden behind the gold; its glow spills past it). */
const BAND_RX = 46;
const BAND_RY = 53.5;

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
 *  `lean` the tip's sideways offset, `curl` how much the body S-bends. A swelling belly that narrows into a sharp,
 *  leaning tip, closed with a round underside below the base. */
function tonguePath(w: number, l: number, lean: number, curl: number): string {
  return `M${f(-w)} 0`
    + `C${f(-w * 1.15)} ${f(-l * 0.3)} ${f(-w * 0.2 - curl)} ${f(-l * 0.58)} ${f(lean * 0.55 - w * 0.1)} ${f(-l * 0.8)}`
    + `S${f(lean * 0.9)} ${f(-l * 0.95)} ${f(lean)} ${f(-l)}`
    + `C${f(lean * 0.5 + w * 0.3)} ${f(-l * 0.84)} ${f(w * 0.45 + curl)} ${f(-l * 0.58)} ${f(w * 0.75)} ${f(-l * 0.32)}`
    + `C${f(w * 0.95)} ${f(-l * 0.18)} ${f(w * 1.05)} ${f(-l * 0.06)} ${f(w)} 0`
    + `Q0 ${f(w * 1.1)} ${f(-w)} 0Z`;
}

export interface Tongue { x: number; y: number; rot: number; w: number; l: number; lean: number; curl: number; row: 0 | 1 | 2 }

/** The tongues of one frame. `k` (0..frames-1) picks the jitter; `size` scales every flame's length.
 *  Rows: 0 = the BACK row (deeper, broader), 1 = the FRONT row, 2 = a few thin WISPS that leap high off the crest
 *  in some frames only (what makes the flipbook read as live fire). */
export function crownTongues(k: number, size = 1): Tongue[] {
  const rnd = prng(0x5eb1f7 + k * 977);
  const out: Tongue[] = [];
  const at = (deg: number): { x: number; y: number; rot: number; peak: number } => {
    const th = (deg * Math.PI) / 180;
    const x = RIM_RX * Math.sin(th);
    const y = -RIM_RY * Math.cos(th);
    // Outward normal of the ellipse, then bent toward straight up: fire rises, even off the flanks.
    const nx = x / (RIM_RX * RIM_RX);
    const ny = y / (RIM_RY * RIM_RY);
    const nl = Math.hypot(nx, ny) || 1;
    const bend = 0.45;
    const dx = (nx / nl) * (1 - bend);
    const dy = (ny / nl) * (1 - bend) - bend;
    const peak = Math.max(0, Math.cos(th * 0.66));
    return { x, y, rot: (Math.atan2(dx, -dy) * 180) / Math.PI, peak };
  };
  for (const row of [0, 1] as const) {
    const n = row === 0 ? 12 : 13;
    const span = row === 0 ? 124 : 118; // degrees either side of straight up
    for (let i = 0; i < n; i++) {
      const deg = -span + (i / (n - 1)) * span * 2 + (rnd() - 0.5) * (row === 0 ? 8 : 5);
      const p = at(deg);
      const len = (row === 0 ? 44 : 37) * (0.42 + 0.58 * p.peak * p.peak);
      out.push({
        x: p.x, y: p.y, rot: p.rot + (rnd() - 0.5) * 10,
        w: (row === 0 ? 10 : 8.5) * (0.75 + 0.35 * p.peak) * (0.85 + rnd() * 0.3),
        l: len * (0.7 + rnd() * 0.6) * size,
        lean: (rnd() - 0.5) * 14 * (0.5 + p.peak),
        curl: (rnd() - 0.5) * 5,
        row,
      });
    }
  }
  // Wisps: 2-3 per frame, near the crest, thin and tall.
  const wisps = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < wisps; i++) {
    const p = at((rnd() - 0.5) * 120);
    out.push({
      x: p.x, y: p.y, rot: p.rot + (rnd() - 0.5) * 16, w: 3.4 + rnd() * 1.4,
      l: (38 + rnd() * 22) * (0.55 + 0.45 * p.peak) * size, lean: (rnd() - 0.5) * 18, curl: (rnd() - 0.5) * 6, row: 2,
    });
  }
  return out;
}

/** The burning band: the top ~250 degrees of an ellipse hugging the frame's outer edge. */
function bandPath(): string {
  const pts: string[] = [];
  for (let d = -128; d <= 128; d += 8) {
    const th = (d * Math.PI) / 180;
    pts.push(`${f(BAND_RX * Math.sin(th))} ${f(-BAND_RY * Math.cos(th))}`);
  }
  return `M${pts.join('L')}`;
}

/** One crown frame as an SVG document. The oval's centre is (0,0). */
export function crownSvg(k: number, c: CrownColors, size = 1): string {
  const half = CROWN_BOX / 2;
  const tongues = crownTongues(k, size);
  const g = (t: Tongue, scaleW: number, scaleL: number, fill: string, extra = ''): string =>
    `<path transform="translate(${f(t.x)} ${f(t.y)}) rotate(${f(t.rot)})" d="${tonguePath(t.w * scaleW, t.l * scaleL, t.lean * scaleL, t.curl * scaleW)}" fill="${fill}"${extra}/>`;
  const back = tongues.filter((t) => t.row === 0);
  const front = tongues.filter((t) => t.row === 1);
  const wisps = tongues.filter((t) => t.row === 2);
  const band = bandPath();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${CROWN_BOX} ${CROWN_BOX}">`
    + '<defs>'
    // objectBoundingBox gradients run along each tongue's OWN axis (the bbox is taken before the rotate).
    + `<linearGradient id="d" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.hot}"/><stop offset="0.45" stop-color="${c.hot}"/><stop offset="0.8" stop-color="${c.deep}"/><stop offset="1" stop-color="${c.deep}" stop-opacity="0.35"/></linearGradient>`
    + `<linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.core}"/><stop offset="0.5" stop-color="${c.core}" stop-opacity="0.9"/><stop offset="0.75" stop-color="${c.hot}"/><stop offset="1" stop-color="${c.hot}" stop-opacity="0.2"/></linearGradient>`
    + `<linearGradient id="w" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.core}"/><stop offset="0.65" stop-color="${c.core}" stop-opacity="0.95"/><stop offset="1" stop-color="${c.core}" stop-opacity="0"/></linearGradient>`
    + '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>'
    + '<filter id="m" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>'
    + '<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.5"/></filter>'
    + '</defs>'
    // A soft halo of the whole crown (blurred deep flame) under everything.
    + `<g filter="url(#b)" opacity="0.95">${[...back, ...front].map((t) => g(t, 1.35, 1.05, c.deep)).join('')}`
    + `<path d="${band}" fill="none" stroke="${c.deep}" stroke-width="14" stroke-linecap="round"/></g>`
    + '<g filter="url(#s)">'
    + back.map((t) => g(t, 1, 1, 'url(#d)')).join('')
    + back.map((t) => g(t, 0.5, 0.72, 'url(#h)', ' opacity="0.8"')).join('')
    + '</g>'
    // The burning band: a hot ring hugging the frame, so the tongues read as ONE fire, not a row of teeth.
    + `<g filter="url(#m)"><path d="${band}" fill="none" stroke="${c.hot}" stroke-width="6" stroke-linecap="round"/></g>`
    + `<path d="${band}" fill="none" stroke="${c.core}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>`
    + '<g filter="url(#s)">'
    + front.map((t) => g(t, 1, 1, 'url(#d)')).join('')
    + front.map((t) => g(t, 0.7, 0.86, 'url(#h)')).join('')
    + front.map((t) => g(t, 0.36, 0.6, 'url(#w)')).join('')
    + wisps.map((t) => g(t, 1, 1, 'url(#h)', ' opacity="0.85"')).join('')
    + wisps.map((t) => g(t, 0.4, 0.7, 'url(#w)')).join('')
    + '</g></svg>';
}

/** A frame as a CSS `url(...)` value. */
export function crownUrl(k: number, c: CrownColors, size = 1): string {
  return `url("data:image/svg+xml,${encodeURIComponent(crownSvg(k, c, size))}")`;
}

/** The TRIGGER's flame pillar: a sheaf of tall tongues from one base (bottom centre), fanned slightly, that the
 *  `rebirthing` re-form erupts out of (styles.css `.unit.rebirthing::before/::after`). ViewBox 120 x 200, base at
 *  (60, 196). Same tongue + gradient language as the crown, so the idle fire and the eruption read as one. */
export function pillarSvg(c: CrownColors): string {
  const rnd = prng(0x0f1a3e);
  const tongues: { x: number; rot: number; w: number; l: number; lean: number; curl: number }[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5; // -0.5..0.5
    const centre = 1 - Math.abs(t) * 1.4;
    tongues.push({
      x: 60 + t * 62 + (rnd() - 0.5) * 6,
      rot: t * 34 + (rnd() - 0.5) * 8,
      w: 9 + centre * 7 + rnd() * 3,
      l: (70 + centre * 110) * (0.8 + rnd() * 0.35),
      lean: (rnd() - 0.5) * 22,
      curl: (rnd() - 0.5) * 8,
    });
  }
  const p = (t: (typeof tongues)[number], sw: number, sl: number, fill: string, extra = ''): string =>
    `<path transform="translate(${f(t.x)} 196) rotate(${f(t.rot)})" d="${tonguePath(t.w * sw, t.l * sl, t.lean * sl, t.curl * sw)}" fill="${fill}"${extra}/>`;
  const order = [...tongues].sort((a, b) => a.l - b.l).reverse(); // the tallest behind
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 200">'
    + '<defs>'
    + `<linearGradient id="d" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.hot}"/><stop offset="0.45" stop-color="${c.hot}"/><stop offset="0.8" stop-color="${c.deep}"/><stop offset="1" stop-color="${c.deep}" stop-opacity="0.3"/></linearGradient>`
    + `<linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.core}"/><stop offset="0.5" stop-color="${c.core}" stop-opacity="0.9"/><stop offset="0.8" stop-color="${c.hot}"/><stop offset="1" stop-color="${c.hot}" stop-opacity="0.2"/></linearGradient>`
    + '<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>'
    + '<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.6"/></filter>'
    + '</defs>'
    + `<g filter="url(#b)" opacity="0.9">${order.map((t) => p(t, 1.5, 1.05, c.deep)).join('')}</g>`
    + '<g filter="url(#s)">'
    + order.map((t) => p(t, 1, 1, 'url(#d)')).join('')
    + order.map((t) => p(t, 0.6, 0.8, 'url(#h)')).join('')
    + '</g></svg>';
}

export function pillarUrl(c: CrownColors): string {
  return `url("data:image/svg+xml,${encodeURIComponent(pillarSvg(c))}")`;
}
