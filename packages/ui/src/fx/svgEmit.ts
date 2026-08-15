export const EMIT_POINTS_MAX = 4000;
export const EMIT_POINTS_DEFAULT = 400;
export const EMIT_POINTS_MIN = 64;

type Pt = [number, number];

/** Parse an SVG string into an <svg> element, or null if it isn't valid SVG. */
function parseSvg(svgText: string): SVGSVGElement | null {
  // Guard for non-DOM hosts (e.g. a Node test runner) so the never-throw contract holds everywhere.
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  return svg instanceof SVGSVGElement ? svg : null;
}

/** Fit raw points (in SVG user units) to [-1,1], aspect-preserved, centered on the bbox. */
function normalize(pts: Pt[]): Pt[] {
  if (pts.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const w = maxX - minX, h = maxY - minY;
  const half = Math.max(w, h) / 2;
  if (half <= 0) return []; // zero-area
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // SVG y grows DOWN; the FX world y also grows down, so no flip — keep the shape as drawn.
  return pts.map(([x, y]) => [(x - cx) / half, (y - cy) / half] as Pt);
}

/** Sample points ALONG every path's outline, distributing `count` across paths by length. */
function sampleOutline(svg: SVGSVGElement, count: number): Pt[] {
  const paths = Array.from(svg.querySelectorAll('path'));
  if (paths.length === 0) return [];
  const lengths = paths.map((p) => { try { return p.getTotalLength(); } catch { return 0; } });
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const out: Pt[] = [];
  paths.forEach((path, i) => {
    const n = Math.max(1, Math.round((lengths[i]! / total) * count));
    for (let s = 0; s < n; s++) {
      const pt = path.getPointAtLength((s / n) * lengths[i]!);
      out.push([pt.x, pt.y]);
    }
  });
  return out;
}

/** Sample points INSIDE the filled silhouette by rasterizing to a canvas and rejection-sampling the alpha. */
function sampleFill(svgText: string, svg: SVGSVGElement, count: number): Pt[] {
  const vb = svg.viewBox.baseVal;
  const W = vb && vb.width ? vb.width : (svg.width.baseVal.value || 256);
  const H = vb && vb.height ? vb.height : (svg.height.baseVal.value || 256);
  const RES = 256; // raster resolution; enough for an emit mask
  const scale = RES / Math.max(W, H);
  const cw = Math.max(1, Math.round(W * scale)), ch = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d'); if (!ctx) return [];
  const img = new Image();
  // The workshop bakes synchronously on user action; draw via a data URL. If decode is async in the host,
  // the caller (Task 4) awaits an async variant — but here we keep it sync-friendly for the common path and
  // return [] if the image isn't ready, letting the UI retry. (See Task 4 note.)
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
  if (!img.complete || img.naturalWidth === 0) return [];
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const out: Pt[] = [];
  let tries = 0; const maxTries = count * 40;
  // Deterministic-ish LCG so a given (svg,count) reproduces; seeded from dimensions.
  let seed = (cw * 73856093) ^ (ch * 19349663) ^ count; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  while (out.length < count && tries++ < maxTries) {
    const px = Math.floor(rnd() * cw), py = Math.floor(rnd() * ch);
    if (data[(py * cw + px) * 4 + 3]! / 255 > 0.5) out.push([px / scale, py / scale]);
  }
  return out;
}

export function svgToEmitPoints(svgText: string, opts: { fill: boolean; count: number }): Pt[] {
  // Hard contract: never throw on bad input or a missing DOM API — always return a (possibly empty) cloud.
  try {
    const count = Math.max(EMIT_POINTS_MIN, Math.min(EMIT_POINTS_MAX, Math.floor(opts.count) || EMIT_POINTS_DEFAULT));
    const svg = parseSvg(svgText);
    if (!svg) return [];
    const raw = opts.fill ? sampleFill(svgText, svg, count) : sampleOutline(svg, count);
    return normalize(raw);
  } catch {
    return [];
  }
}
