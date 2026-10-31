#!/usr/bin/env node
/**
 * TRACE A HIT SHAPE (R-HIT-SHAPE-01, owner 2026-10-31: "make the other buttons as clean cut as you did with end turn so
 * that mousing over them feels snappy and accurate").
 *
 * Reads a button's painted art and prints the CSS `clip-path: polygon(...)` that traces its silhouette, in percent of
 * the image box, for the button's hit layer in `packages/ui/src/hitShapes.css`. The outline is found by casting rays
 * from the silhouette's centre (every art piece it is used on is star-shaped about its centre: a gem, an orb, a pill)
 * and keeping the farthest pixel on each ray whose alpha is at least --alpha (default 128, half opaque), then thinning
 * the ring of points with Douglas-Peucker at --tol percent.
 *
 * Usage: node scripts/trace-hit-shape.mjs apps/web/public/frames/tavernup_base.webp [--rays 180] [--tol 0.6] [--alpha 128]
 *        [--grow px]   push the outline out by that many source px (one screen px at the drawn size)
 *        [--fit contain --box 263x112]   art drawn with object-fit: contain inside a box of another aspect
 *
 * Re-run it whenever a traced art file changes, and paste the result over the old polygon (the contract test,
 * hitShapes.test.ts, fails while a polygon no longer covers its art).
 */
import sharp from 'sharp';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) { console.error('usage: node scripts/trace-hit-shape.mjs <art.webp> [--rays N] [--tol pct] [--alpha 0-255]'); process.exit(2); }
const RAYS = Number(arg('rays', '180'));
const TOL = Number(arg('tol', '0.6'));
const ALPHA = Number(arg('alpha', '128'));
// Grow the outline by this many SOURCE pixels (about one screen pixel at the size the art is drawn), so the soft
// antialiased rim of the art is inside the hit shape too.
const GROW = Number(arg('grow', '0'));

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : data[(y * W + x) * 4 + 3]);
let sx = 0, sy = 0, n = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A(x, y) >= ALPHA) { sx += x; sy += y; n++; }
const cx = sx / n, cy = sy / n;
const R = Math.hypot(W, H);
const ring = [];
for (let i = 0; i < RAYS; i++) {
  const t = (i / RAYS) * Math.PI * 2;
  const dx = Math.cos(t), dy = Math.sin(t);
  let far = 0;
  for (let r = 0; r < R; r += 0.5) if (A(Math.round(cx + dx * r), Math.round(cy + dy * r)) >= ALPHA) far = r;
  // half a pixel out, so the edge pixel itself is inside
  ring.push([cx + dx * (far + 0.5 + GROW), cy + dy * (far + 0.5 + GROW)]);
}
// percent of the box (object-fit: contain maps the image into the middle of the box)
let toPct = ([x, y]) => [(x / W) * 100, (y / H) * 100];
if (arg('fit') === 'contain') {
  const [bw, bh] = arg('box').split('x').map(Number);
  const k = Math.min(bw / W, bh / H), ox = (bw - W * k) / 2, oy = (bh - H * k) / 2;
  toPct = ([x, y]) => [((ox + x * k) / bw) * 100, ((oy + y * k) / bh) * 100];
}
const pts = ring.map(toPct);
// Douglas-Peucker on the closed ring
function dp(p, tol) {
  if (p.length < 3) return p;
  const [a, b] = [p[0], p[p.length - 1]];
  let best = -1, bi = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i];
    const d = Math.abs((b[1] - a[1]) * x - (b[0] - a[0]) * y + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    if (d > best) { best = d; bi = i; }
  }
  if (best <= tol) return [a, b];
  return [...dp(p.slice(0, bi + 1), tol).slice(0, -1), ...dp(p.slice(bi), tol)];
}
const half = Math.floor(pts.length / 2);
const simple = [...dp([...pts.slice(0, half + 1)], TOL).slice(0, -1), ...dp([...pts.slice(half), pts[0]], TOL).slice(0, -1)];
const f = (v) => `${+Math.min(100, Math.max(0, v)).toFixed(1)}%`;
console.log(`/* ${file.replace(/\\/g, '/').split('/').slice(-2).join('/')}: ${simple.length} points, alpha >= ${ALPHA}, grown ${GROW}px */`);
console.log(`clip-path: polygon(${simple.map(([x, y]) => `${f(x)} ${f(y)}`).join(', ')});`);
