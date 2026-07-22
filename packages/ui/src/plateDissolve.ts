/**
 * ARCANE PLATE DISSOLVE — what the hand-card backplate does when you play a minion.
 *
 * The plate imprints as a glowing blue WIREFRAME of itself (its own structural lines — stone joints, gold
 * rails, the gem, the greek-key tabs), then burns off to arcane dust with a slight outward puff, leaving
 * nothing. Authored and dialed by the owner in `apps/web/public/fx/plate-dissolve-preview.html`; the values
 * below are that rig's shipped export.
 *
 * ## Why there is no CSS side to keep in sync
 *
 * Unlike the tuner configs in this folder, this module OWNS its rendering: the imprint element and the dust
 * canvas are built in JS and styled from `cfg` directly, and `Recruit.tsx` imports this to fire the effect,
 * so it always ships. There is no `var(--x, fallback)` half to drift out of sync — the double-source rule
 * that governs `cardPlateConfig` / `dragFeel` / `layoutConfig` deliberately does not apply here.
 *
 * ## Why the wireframe is an asset and not computed here
 *
 * Extracting it costs a box blur, a Sobel pass and a percentile sort over ~300k pixels. It is deterministic
 * from fixed art plus fixed dials, so it is baked once by `scripts/build-plate-wire.mjs` into
 * `frames/cardplate-wire.webp` and used as a plain mask image. Nothing edge-detects at runtime; the shop
 * phase must not hitch the first time a card is played.
 */

const WIRE_SRC = `${import.meta.env.BASE_URL}frames/cardplate-wire.webp`;
const PLATE_SRC = `${import.meta.env.BASE_URL}frames/cardplate.webp`;
/** Plate width the px-quantities below were dialed against (the rig's stage). Speeds/sizes scale by
 *  (actual / REF_W) so the effect holds its proportions at any board scale. */
const REF_W = 240;

export interface PlateDissolveConfig {
  /** Whole effect, ms — start to nothing left. Governs how long the DUST lives. */
  total: number;
  /** Plate art → wireframe crossfade, ms. */
  inMs: number;
  /** How long the wireframe sits at full before it starts burning off, ms. */
  holdMs: number;
  /** How fast the real plate art disappears under the imprint, ms. 0 = instant. */
  plateOut: number;
  /** Wireframe burn-off duration, ms. Deliberately INDEPENDENT of `total`: tying it to the remainder meant a
   *  long total forced a slow fade, and the frame could never snap away while the dust hung on after it. */
  fadeMs: number;
  /** How far the wireframe swells as it goes — the outward puff. 1 = none. */
  puff: number;
  /** Peak brightness of the wireframe. */
  inten: number;
  /** Tight inner glow radius, px @ REF_W. */
  g1: number;
  /** Wide outer bloom radius, px @ REF_W. */
  g2: number;
  cDeep: string;
  cMid: string;
  cCore: string;
  /** 0 = flat mid colour across the plate. 1 = the full deep→mid→core ramp. */
  grad: number;
  /** How many motes the plate breaks into. */
  count: number;
  /** 0 = dust off the whole plate. 1 = dust only off the wireframe LINES. */
  onLines: number;
  /** Outward drift, px/s @ REF_W. */
  spd: number;
  spdVar: number;
  /** Vertical drift, px/s @ REF_W — negative rises. */
  lift: number;
  size: number;
  sizeVar: number;
  /** Mote lifetime as a fraction of `total`. */
  life: number;
  lifeVar: number;
  /** Fraction of the effect over which motes are born. 0 = all at once, one crisp burst. */
  stag: number;
  /** Per-frame smear. Higher = comet tails. */
  trail: number;
}

/** Owner-dialed 2026-07-22 (rig export). Palette drifted off the charge glyph's deep blue to a paler,
 *  icier family with a very wide bloom — deliberate; it reads as its own magic rather than the turn timer. */
const DEFAULTS: PlateDissolveConfig = {
  total: 210, inMs: 15, holdMs: 15, plateOut: 0, fadeMs: 180,
  puff: 1.15, inten: 0.58, g1: 42, g2: 154,
  cDeep: '#75d6ff', cMid: '#b3e2ff', cCore: '#c7e9ff', grad: 1,
  count: 320, onLines: 0.8, spd: 50, spdVar: 1, lift: -25,
  size: 2.3, sizeVar: 0.7, life: 1.66, lifeVar: 0.94, stag: 0.14, trail: 0.37,
};

export const PD_RANGES: Record<string, [number, number, number]> = {
  total: [60, 1600, 10], inMs: [0, 400, 5], holdMs: [0, 500, 5], plateOut: [0, 400, 5], fadeMs: [20, 1400, 10],
  puff: [1, 1.4, 0.005], inten: [0, 2.5, 0.02], g1: [0, 120, 1], g2: [0, 260, 2], grad: [0, 1, 0.02],
  count: [0, 1600, 10], onLines: [0, 1, 0.02], spd: [0, 400, 5], spdVar: [0, 1, 0.02], lift: [-300, 300, 5],
  size: [0.5, 8, 0.1], sizeVar: [0, 1, 0.02], life: [0.1, 2, 0.02], lifeVar: [0, 1, 0.02],
  stag: [0, 1, 0.02], trail: [0, 0.95, 0.01],
};
export const PD_DESC: Record<string, string> = {
  total: 'Whole effect (ms). Governs how long the dust lives.',
  inMs: 'Plate → wireframe crossfade (ms).',
  holdMs: 'How long the wireframe sits at full before burning off (ms).',
  plateOut: 'How fast the real plate art vanishes under the imprint (ms). 0 = instant.',
  fadeMs: 'Wireframe burn-off (ms). Independent of total, so the frame can snap away while dust hangs on.',
  puff: 'How far the wireframe swells as it goes. 1 = no puff.',
  inten: 'Peak brightness of the wireframe.',
  g1: 'Tight inner glow radius.',
  g2: 'Wide outer bloom radius.',
  cDeep: 'Gradient end colour.', cMid: 'Gradient middle colour.', cCore: 'Gradient core colour.',
  grad: '0 = flat mid colour. 1 = the full deep→mid→core ramp across the plate.',
  count: 'How many motes the plate breaks into.',
  onLines: '0 = dust off the whole plate. 1 = dust only off the wireframe lines.',
  spd: 'Outward drift speed.', spdVar: 'Randomness in each mote’s speed.',
  lift: 'Vertical drift — negative rises, positive sinks.',
  size: 'Mote radius.', sizeVar: 'Randomness in mote size.',
  life: 'Mote lifetime, as a fraction of total.', lifeVar: 'Randomness in lifetime.',
  stag: '0 = every mote born at once (one crisp burst). Higher = a rolling burn.',
  trail: 'Per-frame smear. Higher = comet tails.',
};
export const PD_NUM_KEYS = Object.keys(PD_RANGES);
export const PD_COLOR_KEYS = ['cDeep', 'cMid', 'cCore'] as const;

const KEY = 'ascent.platedissolve';
let cfg: PlateDissolveConfig = (() => {
  // DEV-ONLY override, per the #615 prod-leak fix: a tuner's saved values must never beat what ships.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<PlateDissolveConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();
export const getPlateDissolveConfig = (): PlateDissolveConfig => cfg;
export function setPlateDissolveValue(key: keyof PlateDissolveConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  sprites = null; // colours may have changed
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetPlateDissolveConfig(): void {
  cfg = { ...DEFAULTS };
  sprites = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ spawn points */
type Pt = { u: number; v: number };
let LINE_PTS: Pt[] | null = null;
let BODY_PTS: Pt[] | null = null;
let sampling = false;

/** Sample both masks ONCE per session into normalised spawn points. Small grid (110px wide), so this is a
 *  couple of ms and never repeats; the effect runs without it (dust simply skipped) until it resolves. */
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

/* ------------------------------------------------------------------ sprites */
let sprites: { core: HTMLCanvasElement; mid: HTMLCanvasElement } | null = null;
function sprite(color: string, r: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(r * 2);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, color); grd.addColorStop(0.4, color); grd.addColorStop(1, 'transparent');
  g.fillStyle = grd; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  return c;
}
const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/* ------------------------------------------------------------------ the effect */
interface Mote { x: number; y: number; vx: number; vy: number; born: number; life: number; r: number }

/**
 * Play the dissolve over a screen rect (the plate's own bounding box at the moment of release).
 * Everything is created detached on <body> and torn down when it finishes, so nothing survives the effect
 * and it can't interact with React's tree.
 */
export function playPlateDissolve(rect: { left: number; top: number; width: number; height: number }): void {
  if (typeof document === 'undefined') return;
  ensurePoints();
  const c = cfg;
  const k = rect.width / REF_W;
  if (!sprites) sprites = { core: sprite(c.cCore, 32), mid: sprite(c.cMid, 32) };

  // --- the wireframe imprint: the gradient shown through the baked line mask ---
  const imp = document.createElement('div');
  const p1 = 50 - 31 * c.grad, p3 = 50 + 31 * c.grad;
  const deep = c.grad > 0 ? c.cDeep : c.cMid, core = c.grad > 0 ? c.cCore : c.cMid;
  imp.style.cssText = [
    'position:fixed', `left:${rect.left}px`, `top:${rect.top}px`,
    `width:${rect.width}px`, `height:${rect.height}px`,
    'pointer-events:none', 'z-index:114', 'opacity:0',
    `background:linear-gradient(90deg, ${deep} 0%, ${c.cMid} ${p1}%, ${core} 50%, ${c.cMid} ${p3}%, ${deep} 100%)`,
    `-webkit-mask:url(${WIRE_SRC}) center / 100% 100% no-repeat`,
    `mask:url(${WIRE_SRC}) center / 100% 100% no-repeat`,
    `filter:drop-shadow(0 0 ${c.g1 * k}px ${rgba(c.cMid, 0.85)}) drop-shadow(0 0 ${c.g2 * k}px ${rgba(c.cDeep, 1)})`,
  ].join(';');
  document.body.appendChild(imp);

  // --- the dust canvas, oversized so outward motes + bloom aren't clipped at the plate's edge ---
  const pad = 1.9;
  const cw = Math.round(rect.width * pad), ch = Math.round(rect.height * pad);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  cv.style.cssText = [
    'position:fixed', `left:${rect.left - (cw - rect.width) / 2}px`, `top:${rect.top - (ch - rect.height) / 2}px`,
    `width:${cw}px`, `height:${ch}px`, 'pointer-events:none', 'z-index:114',
  ].join(';');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  // --- motes, born on the wireframe (or anywhere on the plate) and pushed outward from centre ---
  const motes: Mote[] = [];
  const cx = cw / 2, cy = ch / 2;
  for (let i = 0; i < c.count; i++) {
    const src = (LINE_PTS && LINE_PTS.length && Math.random() < c.onLines) ? LINE_PTS : BODY_PTS;
    if (!src || !src.length) break;
    const p = src[(Math.random() * src.length) | 0];
    const x = cx + (p.u - 0.5) * rect.width, y = cy + (p.v - 0.5) * rect.height;
    let dx = x - cx, dy = y - cy;
    const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    const sp = c.spd * k * (1 + (Math.random() - 0.5) * 2 * c.spdVar);
    motes.push({
      x, y, vx: dx * sp, vy: dy * sp + c.lift * k,
      born: Math.random() * c.stag,
      life: c.life * (1 + (Math.random() - 0.5) * 2 * c.lifeVar),
      r: c.size * k * (1 + (Math.random() - 0.5) * 2 * c.sizeVar),
    });
  }

  const t0 = performance.now();
  const burnStart = c.inMs + c.holdMs;
  let raf = 0;
  const done = (): void => {
    cancelAnimationFrame(raf);
    imp.remove(); cv.remove();
  };
  const frame = (now: number): void => {
    const ms = now - t0, t = ms / c.total;
    const inA = c.inMs > 0 ? Math.min(1, ms / c.inMs) : 1;
    const burn = Math.max(0, Math.min(1, (ms - burnStart) / Math.max(1, c.fadeMs)));
    imp.style.opacity = String(Math.max(0, inA * (1 - burn) * c.inten));
    imp.style.transform = `scale(${1 + (c.puff - 1) * burn})`;

    if (ctx) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - c.trail})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      const dt = 1 / 60;
      for (const p of motes) {
        if (t < p.born) continue;
        const age = (t - p.born) / Math.max(0.01, p.life);
        if (age >= 1) continue;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const fade = 1 - age, rr = p.r * (0.6 + 0.4 * fade);
        if (rr > 0) {
          ctx.globalAlpha = Math.min(1, fade * fade * 0.9);
          ctx.drawImage(sprites!.core, p.x - rr, p.y - rr, rr * 2, rr * 2);
          const r2 = rr * 1.7;
          ctx.globalAlpha = Math.min(1, fade * 0.5);
          ctx.drawImage(sprites!.mid, p.x - r2, p.y - r2, r2 * 2, r2 * 2);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (ms >= c.total + 260) { done(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
