/**
 * ARCANE PLATE COALESCE — what plays when a card is GENERATED.
 *
 * The mirror of `plateDissolve`: arcane dust rushes inward, lands on the plate's wireframe lines, the
 * wireframe forms, and then resolves into the card you just acquired. Fires for cards that come from
 * nowhere — combat grants (Deathrattle / Rally / Avenge / quest), Discover picks, spell and Battlecry
 * conjures, hero-power grants — and deliberately NOT for:
 *
 * - **Buying from the shop.** A bought card was already sitting visible in the tavern; it is acquired, not
 *   conjured. It gets its own shop→hand transition instead (owner ruling 2026-07-22) — a separate effect,
 *   not this one.
 * - **Gilding / tripling.** The owner wants its own effect. NB `golden: true` is NOT the discriminator —
 *   a gilded Discover pick and quest `grantGolden` rewards both arrive golden and ARE generations. Only an
 *   actual combine is excluded; see `run.triplesMade` in Recruit's watcher.
 * - **Rune of Refrain's bounce**, where a played minion returns to hand — a return, not a generation.
 *
 * Shares the wireframe mask, palette and spawn points with the dissolve via `plateFx`, so a card arriving
 * and a card leaving read as one magic system.
 *
 * Like the dissolve, this module renders what it configures, so its defaults ARE what ships — there is no
 * `var(--x, fallback)` CSS half, and the double-source rule deliberately does not apply.
 */
import { WIRE_SRC, REF_W, linePoints, bodyPoints, sprite, rgba, arcaneGradient } from './plateFx';

export interface PlateCoalesceConfig {
  /** Whole effect, ms. */
  total: number;
  /** How long the dust takes to rush in and land on the shape, ms. */
  gatherMs: number;
  /** Wireframe fade-IN, ms — it builds as the dust arrives. */
  wireIn: number;
  /** How long the finished wireframe holds before resolving into the card, ms. */
  holdMs: number;
  /** Crossfade from wireframe to the real card, ms. */
  cardIn: number;
  /** How far out the motes start, as a fraction of the plate width. */
  dist: number;
  distVar: number;
  /** Sideways curl on the way in. 0 = straight lines, higher = they spiral home. */
  swirl: number;
  /** Approach easing. 1 = linear; higher = they rush then settle. */
  ease: number;
  /** Spread in arrival times. 0 = all land together. */
  stag: number;
  /** How long a mote lingers after landing, as a fraction of the gather. */
  linger: number;
  count: number;
  /** 0 = land anywhere on the plate. 1 = land only on the wireframe LINES. */
  onLines: number;
  size: number;
  sizeVar: number;
  /** Per-frame smear. */
  trail: number;
  /** How much bigger the wireframe starts before contracting in — the mirror of the dissolve's puff. */
  puff: number;
  inten: number;
  g1: number;
  g2: number;
  cDeep: string;
  cMid: string;
  cCore: string;
  grad: number;
}

/** Owner-dialed 2026-07-22 on `fx/plate-coalesce-preview.html`. Palette matches the dissolve. Note `ease`
 *  below 1 is an ease-IN — the motes drift, then accelerate home — and `onLines: 1` means they land only on
 *  the wireframe lines, never the plate body. */
const DEFAULTS: PlateCoalesceConfig = {
  total: 460, gatherMs: 410, wireIn: 90, holdMs: 45, cardIn: 185,
  dist: 0.82, distVar: 0.88, swirl: 1.24, ease: 0.4, stag: 0.14, linger: 0.18,
  count: 390, onLines: 1, size: 3.1, sizeVar: 0.7, trail: 0.14,
  puff: 1.28, inten: 1.04, g1: 94, g2: 0,
  cDeep: '#75d6ff', cMid: '#b3e2ff', cCore: '#c7e9ff', grad: 0.64,
};

export const PC_RANGES: Record<string, [number, number, number]> = {
  total: [120, 2000, 10], gatherMs: [40, 1200, 10], wireIn: [0, 600, 5], holdMs: [0, 800, 5],
  cardIn: [20, 900, 5], dist: [0.1, 3, 0.02], distVar: [0, 1, 0.02], swirl: [0, 2, 0.02],
  ease: [0.4, 4, 0.05], stag: [0, 0.9, 0.02], linger: [0, 1.5, 0.02], count: [0, 1600, 10],
  onLines: [0, 1, 0.02], size: [0.5, 8, 0.1], sizeVar: [0, 1, 0.02], trail: [0, 0.95, 0.01],
  puff: [1, 1.4, 0.005], inten: [0, 2.5, 0.02], g1: [0, 120, 1], g2: [0, 260, 2], grad: [0, 1, 0.02],
};
export const PC_DESC: Record<string, string> = {
  total: 'Whole effect (ms).',
  gatherMs: 'How long the dust takes to rush in and land on the shape.',
  wireIn: 'Wireframe fade-in — it builds as the dust arrives.',
  holdMs: 'How long the finished wireframe holds before resolving into the card.',
  cardIn: 'Crossfade from wireframe to the real card.',
  dist: 'How far out the motes start (× plate width).',
  distVar: 'Randomness in start distance.',
  swirl: 'Sideways curl on the way in. 0 = straight, higher = they spiral home.',
  ease: 'Approach easing. 1 = linear; higher = rush then settle.',
  stag: 'Spread in arrival times. 0 = all land together.',
  linger: 'How long a mote sits on the shape before winking out.',
  count: 'How many motes rush in.',
  onLines: '0 = land anywhere on the plate. 1 = land only on the wireframe lines.',
  size: 'Mote radius.', sizeVar: 'Randomness in mote size.',
  trail: 'Per-frame smear. Higher = comet tails.',
  puff: 'How much bigger the wireframe starts before contracting in.',
  inten: 'Peak brightness of the wireframe.',
  g1: 'Tight inner glow radius.', g2: 'Wide outer bloom radius.',
  cDeep: 'Gradient end colour.', cMid: 'Gradient middle colour.', cCore: 'Gradient core colour.',
  grad: '0 = flat mid colour. 1 = the full ramp.',
};
export const PC_NUM_KEYS = Object.keys(PC_RANGES);
export const PC_COLOR_KEYS = ['cDeep', 'cMid', 'cCore'] as const;

const KEY = 'ascent.platecoalesce';
let cfg: PlateCoalesceConfig = (() => {
  // DEV-ONLY override, per the #615 prod-leak fix.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<PlateCoalesceConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();
export const getPlateCoalesceConfig = (): PlateCoalesceConfig => cfg;
export function setPlateCoalesceValue(key: keyof PlateCoalesceConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  sprites = null;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetPlateCoalesceConfig(): void {
  cfg = { ...DEFAULTS };
  sprites = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

let sprites: { core: HTMLCanvasElement; mid: HTMLCanvasElement } | null = null;

/** A mote flying home: it knows where it LANDS first, then where it started. */
interface Mote {
  tx: number; ty: number;      // landing point on the shape
  sx: number; sy: number;      // start, pushed outward from centre
  nx: number; ny: number;      // unit normal, for the curl
  swirl: number; born: number; r: number;
}

/**
 * Play the coalesce over a screen rect, resolving into `target` if one is given.
 *
 * `target` is the real card element that is materialising. While the effect runs we hold it hidden and fade
 * it up during the `cardIn` beat, so the card genuinely resolves out of the wireframe instead of being
 * visible underneath it the whole time.
 *
 * The hide is `!important`, which looks heavy-handed but is load-bearing: a freshly mounted card carries
 * `.popin`, whose `cardpop` / `handpop` keyframes animate `opacity: 0 -> 1`, and a RUNNING CSS ANIMATION
 * outranks a plain inline style in the cascade. Without the flag the card flashed into view for the pop's
 * ~150ms, then vanished when the animation ended and the hide finally applied — the "appears, then
 * disappears to reform" the owner reported. An `!important` author declaration outranks animations, so the
 * card stays hidden from the first frame.
 *
 * Set via `setProperty` rather than the `style` prop React renders (which only carries `--c`, `--c2`,
 * `--fan-rot` and `transform`), so a re-render mid-effect can't clobber it. Always cleaned up in `done()`.
 */
export function playPlateCoalesce(
  rect: { left: number; top: number; width: number; height: number },
  target?: HTMLElement | null,
): void {
  if (typeof document === 'undefined') return;
  const c = cfg;
  const k = rect.width / REF_W;
  if (!sprites) sprites = { core: sprite(c.cCore, 32), mid: sprite(c.cMid, 32) };

  // the card being generated stays hidden until the wireframe resolves into it (see the note above on why
  // this has to be `!important`)
  const hide = (v: string): void => target?.style.setProperty('opacity', v, 'important');
  const unhide = (): void => target?.style.removeProperty('opacity');
  hide('0');

  const imp = document.createElement('div');
  imp.style.cssText = [
    'position:fixed', `left:${rect.left}px`, `top:${rect.top}px`,
    `width:${rect.width}px`, `height:${rect.height}px`,
    'pointer-events:none', 'z-index:114', 'opacity:0',
    `background:${arcaneGradient(c.cDeep, c.cMid, c.cCore, c.grad)}`,
    `-webkit-mask:url(${WIRE_SRC}) center / 100% 100% no-repeat`,
    `mask:url(${WIRE_SRC}) center / 100% 100% no-repeat`,
    `filter:drop-shadow(0 0 ${c.g1 * k}px ${rgba(c.cMid, 0.85)}) drop-shadow(0 0 ${c.g2 * k}px ${rgba(c.cDeep, 1)})`,
  ].join(';');
  document.body.appendChild(imp);

  // roomier than the dissolve's canvas: motes START outside the plate and fly in
  const pad = 2.6;
  const cw = Math.round(rect.width * pad), ch = Math.round(rect.height * pad);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  cv.style.cssText = [
    'position:fixed', `left:${rect.left - (cw - rect.width) / 2}px`, `top:${rect.top - (ch - rect.height) / 2}px`,
    `width:${cw}px`, `height:${ch}px`, 'pointer-events:none', 'z-index:114',
  ].join(';');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  const motes: Mote[] = [];
  const cx = cw / 2, cy = ch / 2;
  const lp = linePoints(), bp = bodyPoints();
  const havePts = !!((lp && lp.length) || (bp && bp.length));
  for (let i = 0; i < c.count; i++) {
    let u: number, v: number;
    if (havePts) {
      const src = (lp && lp.length && Math.random() < c.onLines) ? lp : bp;
      if (!src || !src.length) continue;
      const p = src[(Math.random() * src.length) | 0];
      u = p.u; v = p.v;
    } else {
      // plateFx warms on load so this should be unreachable; spray rather than emit nothing if it isn't.
      u = Math.random(); v = Math.random();
    }
    const tx = cx + (u - 0.5) * rect.width, ty = cy + (v - 0.5) * rect.height;
    let dx = tx - cx, dy = ty - cy;
    const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    const d = rect.width * c.dist * (1 + (Math.random() - 0.5) * 2 * c.distVar);
    motes.push({
      tx, ty, sx: tx + dx * d, sy: ty + dy * d,
      nx: -dy, ny: dx,
      swirl: (Math.random() - 0.5) * c.swirl * rect.width * 0.5,
      born: Math.random() * c.stag,
      r: c.size * k * (1 + (Math.random() - 0.5) * 2 * c.sizeVar),
    });
  }

  const t0 = performance.now();
  let raf = 0;
  const done = (): void => {
    cancelAnimationFrame(raf);
    imp.remove(); cv.remove();
    unhide();
  };
  const frame = (now: number): void => {
    const ms = now - t0;

    if (ctx) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - c.trail})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      const span = Math.max(1, c.gatherMs * (1 - c.stag));
      for (const p of motes) {
        const t = (ms - p.born * c.gatherMs) / span;
        if (t < 0 || t > 1 + c.linger) continue;
        const e = Math.min(1, t);
        const a = 1 - Math.pow(1 - e, c.ease);          // ease-out: rush, then settle onto the shape
        const curl = Math.sin(e * Math.PI) * p.swirl;   // peaks mid-flight, resolves to zero on arrival
        const x = p.sx + (p.tx - p.sx) * a + p.nx * curl;
        const y = p.sy + (p.ty - p.sy) * a + p.ny * curl;
        const alpha = t <= 1 ? Math.min(1, e * 2.2) : Math.max(0, 1 - (t - 1) / Math.max(0.01, c.linger));
        const rr = p.r * (0.7 + 0.3 * e);
        if (rr > 0 && alpha > 0) {
          ctx.globalAlpha = Math.min(1, alpha * 0.9);
          ctx.drawImage(sprites!.core, x - rr, y - rr, rr * 2, rr * 2);
          const r2 = rr * 1.7;
          ctx.globalAlpha = Math.min(1, alpha * 0.5);
          ctx.drawImage(sprites!.mid, x - r2, y - r2, r2 * 2, r2 * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    const wireA = Math.min(1, Math.max(0, (ms - (c.gatherMs - c.wireIn)) / Math.max(1, c.wireIn)));
    const cardStart = c.gatherMs + c.holdMs;
    const cardA = Math.min(1, Math.max(0, (ms - cardStart) / Math.max(1, c.cardIn)));
    imp.style.opacity = String(wireA * (1 - cardA) * c.inten);
    imp.style.transform = `scale(${1 + (c.puff - 1) * (1 - wireA)})`;
    if (cardA >= 1) unhide(); else hide(String(cardA));

    if (ms >= c.total + 200) { done(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
