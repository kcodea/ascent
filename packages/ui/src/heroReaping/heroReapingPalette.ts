/**
 * THE REAPING'S STOLEN COLOUR: the struck portrait's own hues, read from its art ONCE when the attack starts, so the
 * drops, shards and ribbons that carry its colour away are the colours of THAT portrait (a fiery hero bleeds reds and
 * golds; an icy one, blues).
 *
 * `paletteFromPixels` is pure (RGBA bytes in, colours out) and tested; `portraitPalette` draws the portrait's `<img>`
 * onto a tiny 24 x 24 canvas once per image (cached by its src), reads it back and picks. A tainted or missing image
 * (or no 2D canvas) gives the fallback: the caller's warm hues.
 *
 * What is picked: pixels that are neither grey nor near black or white are binned by hue (12 bins), weighted by how
 * saturated they are; the strongest bins win (at most `n`, no two neighbours), each one's average colour pushed to a
 * vivid, light version of itself (these are light on a grey screen, they must glow). A portrait of one colour gets a
 * deeper and a lighter shade of it beside it. If the art has nothing warm or nothing cool, a fallback hue fills in, so
 * there is always at least one of each.
 */

/** 0xRRGGBB -> h (0..1), s, l. */
function hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const R = r / 255, G = g / 255, B = b / 255;
  let h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h /= 6;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): number {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t: number): number => {
    let v = t; if (v < 0) v += 1; if (v > 1) v -= 1;
    const c = v < 1 / 6 ? p + (q - p) * 6 * v : v < 1 / 2 ? q : v < 2 / 3 ? p + (q - p) * (2 / 3 - v) * 6 : p;
    return Math.round(Math.max(0, Math.min(1, c)) * 255);
  };
  return (ch(h + 1 / 3) << 16) | (ch(h) << 8) | ch(h - 1 / 3);
}

/** Whether a colour reads as warm (reds, oranges, golds, magentas) rather than cool (greens, cyans, blues, violets). */
export function isWarm(c: number): boolean {
  const h = hsl((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)[0];
  return h < 0.2 || h > 0.86;
}

/** A colour pushed vivid and light enough to glow on a grey screen. */
export function vivid(c: number): number {
  const [h, s, l] = hsl((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  return fromHsl(h, Math.max(0.78, s), Math.max(0.56, Math.min(0.68, l)));
}

const BINS = 12;

/**
 * The portrait's stolen colours from its RGBA pixels (pure): up to `n` vivid hues, strongest first, with at least one
 * warm and one cool (taken from `fallback` when the art has none). Deterministic.
 */
export function paletteFromPixels(data: ArrayLike<number>, n: number, fallback: readonly number[]): number[] {
  const w = new Float64Array(BINS), rs = new Float64Array(BINS), gs = new Float64Array(BINS), bs = new Float64Array(BINS);
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 128) continue;
    const [h, s, l] = hsl(r, g, b);
    if (s < 0.22 || l < 0.12 || l > 0.92) continue;
    const k = Math.min(BINS - 1, Math.floor(h * BINS));
    const wt = s * (1 - Math.abs(l - 0.5));
    w[k] += wt; rs[k] += r * wt; gs[k] += g * wt; bs[k] += b * wt;
  }
  const order = [...Array(BINS).keys()].filter((k) => w[k]! > 0).sort((x, y) => w[y]! - w[x]! || x - y);
  const total = order.reduce((s, k) => s + w[k]!, 0);
  const picked: number[] = [];
  const used: number[] = [];
  for (const k of order) {
    if (picked.length >= n) break;
    if (w[k]! < total * 0.015) break; // a trace of a hue is not one of its colours
    if (used.some((u) => Math.min(Math.abs(u - k), BINS - Math.abs(u - k)) <= 1)) continue;
    used.push(k);
    picked.push(vivid((Math.round(rs[k]! / w[k]!) << 16) | (Math.round(gs[k]! / w[k]!) << 8) | Math.round(bs[k]! / w[k]!)));
  }
  // A portrait of one colour still gives a few: its neighbours either side (a deeper and a lighter shade of it).
  if (picked.length) {
    const [h0, s0] = hsl((picked[0]! >> 16) & 0xff, (picked[0]! >> 8) & 0xff, picked[0]! & 0xff);
    for (let i = 0; picked.length < Math.min(n, 3) && i < 2; i++) picked.push(fromHsl((h0 + (i ? 0.055 : -0.055) + 1) % 1, s0, i ? 0.7 : 0.55));
  }
  const fb = fallback.map(vivid);
  const need = (warm: boolean): void => {
    if (picked.some((c) => isWarm(c) === warm)) return;
    const f = fb.find((c) => isWarm(c) === warm);
    if (f !== undefined) { if (picked.length >= n) picked[picked.length - 1] = f; else picked.push(f); }
  };
  need(true); need(false);
  for (const f of fb) { if (picked.length >= Math.min(n, 2)) break; if (!picked.includes(f)) picked.push(f); }
  return picked.slice(0, Math.max(1, n));
}

const cache = new Map<string, number[] | null>();

/**
 * The struck portrait's colours, from the `<img>` inside its element (read once per image src and cached). Null when
 * there is no readable image: the caller uses its fallback hues.
 */
export function portraitPalette(el: HTMLElement | null | undefined, n: number, fallback: readonly number[]): number[] | null {
  if (!el || typeof document === 'undefined') return null;
  const img = (el.tagName === 'IMG' ? el : el.querySelector('img')) as HTMLImageElement | null;
  if (!img) return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  const key = `${src}|${n}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!img.complete || !(img.naturalWidth > 0)) return null;
  let out: number[] | null = null;
  try {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (g) {
      g.drawImage(img, 0, 0, 24, 24);
      out = paletteFromPixels(g.getImageData(0, 0, 24, 24).data, n, fallback);
    }
  } catch { out = null; } // a tainted canvas (a cross-origin image) cannot be read
  cache.set(key, out);
  return out;
}
