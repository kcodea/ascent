/**
 * Shared machinery for the two PLATE effects — the dissolve (a card is played) and the coalesce (a card is
 * generated). They are mirror images and must read as one magic system, so they share the wireframe mask,
 * the mote spawn points, the sprite baking and the colour helper.
 *
 * This exists so the warm-on-load below has exactly ONE implementation. It was originally inline in
 * `plateDissolve.ts` and lazily kicked off at first use, which meant the first effect of a run played with
 * nothing sampled and no mask cached (owner report 2026-07-22, fixed in #635). Duplicating that logic into a
 * second module would be duplicating the bug's blast radius.
 */

export const WIRE_SRC = `${import.meta.env.BASE_URL}frames/cardplate-wire.webp`;
export const PLATE_SRC = `${import.meta.env.BASE_URL}frames/cardplate.webp`;

/** Plate width the effects' px-quantities were dialed against. Speeds/sizes scale by (actual / REF_W) so
 *  both effects hold their proportions at any board scale. */
export const REF_W = 240;

export type Pt = { u: number; v: number };

let LINE_PTS: Pt[] | null = null;
let BODY_PTS: Pt[] | null = null;
let sampling = false;

/** Points along the plate's WIREFRAME lines (null until sampled). */
export const linePoints = (): Pt[] | null => LINE_PTS;
/** Points anywhere on the plate's body (null until sampled). */
export const bodyPoints = (): Pt[] | null => BODY_PTS;

/** Sample both masks ONCE per session into normalised spawn points. 110px grid, so a couple of ms. */
function ensurePoints(): void {
  if (LINE_PTS || sampling || typeof document === 'undefined') return;
  sampling = true;
  const grab = (src: string, cb: (pts: Pt[]) => void): void => {
    const img = new Image();
    img.onload = () => {
      const w = 110, h = Math.round(w * (img.naturalHeight / img.naturalWidth));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (!g) { cb([]); return; }
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      const pts: Pt[] = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 60) pts.push({ u: x / w, v: y / h });
      }
      cb(pts);
    };
    img.onerror = () => cb([]);
    img.src = src;
  };
  grab(WIRE_SRC, (p) => { LINE_PTS = p; });
  grab(PLATE_SRC, (p) => { BODY_PTS = p; });
}

/**
 * Warm on load, NOT on first use — see the module note. Scheduled on idle so it stays off the boot critical
 * path: one 42 KB fetch (the plate art is already loaded by every hand card) plus the sampling.
 */
if (typeof window !== 'undefined') {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(() => ensurePoints());
  else window.setTimeout(() => ensurePoints(), 400);
}

/** A pre-baked radial glow. Blitting these beats building a gradient per particle per frame. */
export function sprite(color: string, r: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(r * 2);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, color); grd.addColorStop(0.4, color); grd.addColorStop(1, 'transparent');
  g.fillStyle = grd; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}

export const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** The arcane gradient both effects paint through the wireframe mask. */
export function arcaneGradient(cDeep: string, cMid: string, cCore: string, grad: number): string {
  const deep = grad > 0 ? cDeep : cMid, core = grad > 0 ? cCore : cMid;
  const p1 = 50 - 31 * grad, p3 = 50 + 31 * grad;
  return `linear-gradient(90deg, ${deep} 0%, ${cMid} ${p1}%, ${core} 50%, ${cMid} ${p3}%, ${deep} 100%)`;
}
