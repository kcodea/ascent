/**
 * PLATE GILD — what plays when three copies combine into a gilded card.
 *
 * The third of the plate effects, and the loudest: this is a run highlight, not a state change. The copies
 * are ALREADY gathered centre screen when it opens; they converge into one, the survivor erupts gold — the
 * plate wireframe in gold plus a flourish only gilding gets — and the gilded card flies home to its slot.
 *
 * Owner's shape (2026-07-22): fuse then crown, wireframe family plus a signature.
 * Authored on `fx/plate-gild-preview.html`.
 *
 * ## They do not fly in from their old slots
 *
 * An earlier pass flew each copy from wherever it had been sitting, which needed a cache of every card's
 * last-known rect (the copies are unmounted before the UI can see the triple). The owner cut it: the effect
 * now OPENS with the three already met in the middle. That deleted the cache, the per-render layout reads
 * that fed it, and the whole class of bug that came with reconstructing positions after the fact.
 *
 * ## The cards you see are clones
 *
 * The consumed copies are gone from the DOM by the time this runs, so the cards you see are CLONES of the
 * surviving gilded card, with `.golden` stripped so they render as the plain minion they were, and re-added
 * on the survivor at the crown so the transformation is something you actually watch happen.
 *
 * `cloneNode` gives a BLANK canvas, and sprite-art cards (those without illustrated art) draw into one — so
 * every canvas in a clone is repainted from its original. Without that, those cards would fly as empty
 * frames.
 *
 * ## Timing is expressed as beats, not sub-steps
 *
 * Each of the four beats has ONE total and its internals are shares of it, so tightening a beat can never
 * silently lengthen the effect. `crownLead` overlaps the crown into the fuse and genuinely SHORTENS it.
 */
import { WIRE_SRC, REF_W, sprite, rgba, arcaneGradient } from './plateFx';

export type Rect = { left: number; top: number; width: number; height: number };

export interface PlateGildConfig {
  /** Beat 1 — the three fade in at centre, already gathered, ms. */
  inMs: number;
  /** Beat 2 — hold as a trio, then merge, ms. */
  fuseMs: number;
  /** Beat 3 — the gold erupts, ms. */
  crownMs: number;
  /** Beat 4 — savour, then fly home, ms. */
  outMs: number;
  flyInEase: number;
  /** Share of beat 1 spent staggering the three arrivals. */
  flyStag: number;
  /** How big the cards get at centre — the hero zoom. */
  centreScale: number;
  /** How far apart the three sit on arrival, × card width. */
  cluster: number;
  fanTilt: number;
  /** How much the board dims. 0 = no dim. */
  scrim: number;
  /** Share of beat 2 the trio holds before merging; the rest is the merge. */
  holdFrac: number;
  streamCount: number;
  arc: number;
  fuseSize: number;
  trail: number;
  /** Share of beat 3 that overlaps the end of the fuse. Higher = shorter overall. */
  crownLead: number;
  /** Shares of beat 3 spent fading the wireframe in / holding it; the remainder is the fade-out. */
  wireInFrac: number;
  wireHoldFrac: number;
  wireInten: number;
  punch: number;
  g1v: number;
  g2v: number;
  cardFlash: number;
  burst: number;
  burstSpd: number;
  flourishType: 'rays' | 'crown' | 'seal' | 'rings' | 'none';
  /** Flourish length as a share of beat 3. Over 1 outlasts the crown and extends the effect. */
  flFrac: number;
  flSize: number;
  flInten: number;
  flSpin: number;
  /** Share of beat 4 the gilded card holds at centre before leaving. */
  savourFrac: number;
  flyOutEase: number;
  cDeep: string;
  cMid: string;
  cCore: string;
  grad: number;
}

/** Owner-dialed 2026-07-22 on the rig — ~936ms end to end. */
const DEFAULTS: PlateGildConfig = {
  inMs: 260, fuseMs: 170, crownMs: 400, outMs: 210,
  flyInEase: 0.65, flyStag: 0.08, centreScale: 1.5, cluster: 1.28, fanTilt: 5, scrim: 0.55,
  holdFrac: 0, streamCount: 90, arc: -1.22, fuseSize: 0.5, trail: 0.37,
  crownLead: 0.26, wireInFrac: 0.15, wireHoldFrac: 0.34, wireInten: 1.1, punch: 1.16,
  g1v: 88, g2v: 134, cardFlash: 1.6, burst: 0, burstSpd: 0,
  flourishType: 'seal', flFrac: 0.66, flSize: 1.66, flInten: 1.16, flSpin: 150,
  savourFrac: 0, flyOutEase: 0.6,
  cDeep: '#a9700f', cMid: '#f1cb5e', cCore: '#fff6d5', grad: 0.24,
};

export const PG_RANGES: Record<string, [number, number, number]> = {
  inMs: [60, 1200, 10], fuseMs: [60, 1200, 10], crownMs: [60, 1400, 10], outMs: [60, 1400, 10],
  flyInEase: [0.6, 4, 0.05], flyStag: [0, 0.7, 0.02], centreScale: [0.6, 2.4, 0.02],
  cluster: [0, 1.4, 0.02], fanTilt: [0, 30, 1], scrim: [0, 0.85, 0.02],
  holdFrac: [0, 0.8, 0.02], streamCount: [0, 900, 10], arc: [-1.5, 1.5, 0.02],
  fuseSize: [0.5, 8, 0.1], trail: [0, 0.95, 0.01],
  crownLead: [0, 0.9, 0.02], wireInFrac: [0.05, 0.8, 0.02], wireHoldFrac: [0, 0.8, 0.02],
  wireInten: [0, 2.5, 0.02], punch: [1, 1.6, 0.005], g1v: [0, 120, 1], g2v: [0, 260, 2],
  cardFlash: [0, 3, 0.05], burst: [0, 900, 10], burstSpd: [0, 900, 10],
  flFrac: [0.2, 2, 0.02], flSize: [0.4, 3, 0.02], flInten: [0, 2, 0.02], flSpin: [-360, 360, 5],
  savourFrac: [0, 0.8, 0.02], flyOutEase: [0.6, 4, 0.05], grad: [0, 1, 0.02],
};
export const PG_DESC: Record<string, string> = {
  inMs: 'Beat 1 TOTAL — the three fade in at centre, already gathered.',
  fuseMs: 'Beat 2 TOTAL — hold as a trio, then merge.',
  crownMs: 'Beat 3 TOTAL — the gold erupts.',
  outMs: 'Beat 4 TOTAL — savour, then fly home.',
  flyInEase: 'Appear easing.',
  flyStag: 'Share of beat 1 staggering the three appearances.',
  centreScale: 'How big the cards get at centre — the hero zoom.',
  cluster: 'How far apart the three sit on arrival (× card width).',
  fanTilt: 'Tilt on the two flanking cards, deg.',
  scrim: 'How much the board dims while this owns the screen.',
  holdFrac: 'Share of beat 2 the trio HOLDS before merging. The rest is the merge.',
  streamCount: 'Motes drawn out of the copies into the survivor.',
  arc: 'How much each stream bows on its way across. 0 = straight.',
  fuseSize: 'Mote radius.', trail: 'Per-frame smear.',
  crownLead: 'Share of the crown that OVERLAPS the fuse. Higher = shorter overall.',
  wireInFrac: 'Share of beat 3 fading the gold wireframe IN.',
  wireHoldFrac: 'Share HOLDING it. The remainder is the fade-out.',
  wireInten: 'Wireframe brightness.', punch: 'How much the card punches out on the crown.',
  g1v: 'Tight inner glow radius.', g2v: 'Wide outer bloom radius.',
  cardFlash: 'Gold flash pushed through the card art itself.',
  burst: 'Motes thrown outward on the crown.', burstSpd: 'Burst speed.',
  flFrac: 'Flourish length as a share of beat 3. Over 1 extends the effect.',
  flSize: 'Flourish size.', flInten: 'Flourish brightness.', flSpin: 'Flourish spin, deg/s.',
  savourFrac: 'Share of beat 4 the gilded card holds before leaving.',
  flyOutEase: 'Departure easing.',
  cDeep: 'Gold — outer.', cMid: 'Gold — middle.', cCore: 'Gold — core.',
  grad: '0 = flat mid colour. 1 = the full ramp.',
};
export const PG_NUM_KEYS = Object.keys(PG_RANGES);
export const PG_COLOR_KEYS = ['cDeep', 'cMid', 'cCore'] as const;
export const PG_FLOURISHES = ['rays', 'crown', 'seal', 'rings', 'none'] as const;

const KEY = 'ascent.plategild';
let cfg: PlateGildConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<PlateGildConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();
export const getPlateGildConfig = (): PlateGildConfig => cfg;
export function setPlateGildValue(key: keyof PlateGildConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value } as PlateGildConfig;
  sprites = null;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetPlateGildConfig(): void {
  cfg = { ...DEFAULTS };
  sprites = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

let sprites: { core: HTMLCanvasElement; mid: HTMLCanvasElement } | null = null;
const easeOut = (t: number, e: number): number => 1 - Math.pow(1 - t, e);
const centreOf = (r: Rect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** `cloneNode` yields blank canvases; repaint each from its original so sprite-art cards aren't empty. */
const SIZE_VARS = ['--cw', '--ch', '--ccw', '--scale', '--u', '--c', '--c2', '--fan-rot',
  '--card-scale', '--ui-scale', '--plate-scale', '--plate-top', '--arch-radius', '--sh', '--fill',
  '--dy', '--frameY', '--tier', '--artY', '--artZoom', '--frame-tone', '--fovl', '--fovl-a', '--fovl-blend'];

function cloneCard(src: HTMLElement): HTMLElement {
  const el = src.cloneNode(true) as HTMLElement;
  // Card sizing is driven by CSS vars set PER ZONE (`.zone[data-zone='hand'] { --ccw: ... }`), not by the
  // element's own width — so a clone appended to <body> loses them, lays out at some unrelated size, and the
  // plate (positioned `left:50%` of the card box) slides out of register with the frame inside it. Copy the
  // resolved values across so the clone renders identically wherever it lives.
  const cs = getComputedStyle(src);
  for (const v of SIZE_VARS) {
    const val = cs.getPropertyValue(v);
    if (val) el.style.setProperty(v, val);
  }
  const from = src.querySelectorAll('canvas');
  const to = el.querySelectorAll('canvas');
  for (let i = 0; i < to.length && i < from.length; i++) {
    const c = to[i], o = from[i];
    if (!o.width || !o.height) continue;
    c.width = o.width; c.height = o.height;
    try { c.getContext('2d')?.drawImage(o, 0, 0); } catch { /* tainted or lost context — skip */ }
  }
  return el;
}

interface Beats {
  flyIn: number; mergeStart: number; mergeMs: number; mergeEnd: number;
  crown: number; wireIn: number; wireHold: number; wireOut: number; flMs: number; crownEnd: number;
  savour: number; leave: number; flyOutMs: number; end: number;
}
function beats(c: PlateGildConfig): Beats {
  const flyIn = c.inMs;
  const hold = c.fuseMs * c.holdFrac;
  const mergeStart = flyIn + hold;
  const mergeMs = Math.max(1, c.fuseMs - hold);
  const mergeEnd = flyIn + c.fuseMs;
  const crown = mergeEnd - c.crownMs * c.crownLead;
  const wireIn = Math.max(10, c.crownMs * c.wireInFrac);
  const wireHold = c.crownMs * c.wireHoldFrac;
  const wireOut = Math.max(10, c.crownMs - wireIn - wireHold);
  const flMs = c.crownMs * c.flFrac;
  const crownEnd = crown + c.crownMs;
  const savour = c.outMs * c.savourFrac;
  const leave = Math.max(crownEnd, crown + flMs) + savour;
  const flyOutMs = Math.max(1, c.outMs - savour);
  return { flyIn, mergeStart, mergeMs, mergeEnd, crown, wireIn, wireHold, wireOut, flMs,
    crownEnd, savour, leave, flyOutMs, end: leave + flyOutMs };
}

/** Total run length in ms — for callers that need to know when the board is theirs again. */
export const plateGildDuration = (): number => beats(cfg).end + 160;

/**
 * Play the gild.
 *
 * @param dest   The gilded card's own rect — where it flies home to.
 * @param card   The real gilded card element; hidden until it lands, so the clone is what you watch.
 * @param copies How many cards were consumed (3 normally, 2 under Twin Gilding). The last flyer is the
 *               survivor; the rest flank it.
 */
export function playPlateGild(dest: Rect, card: HTMLElement, copies = 3): void {
  if (typeof document === 'undefined') return;
  const c = cfg;
  const T = beats(c);
  // `dest`/`sources` are CARD rects. The clone is a card, so forcing it to PLATE size (as this first did)
  // left the frame off-centre inside an oversized box. `plateW` below is measured off the clone's own plate
  // and drives the effect's scale, since the rig's px quantities were dialed against plate width.
  const W = dest.width, H = dest.height;
  if (!sprites) sprites = { core: sprite(c.cCore, 32), mid: sprite(c.cMid, 32) };

  const vw = window.innerWidth, vh = window.innerHeight;
  const CENTRE = { x: vw / 2, y: vh * 0.46 };
  const DEST = centreOf(dest);
  const n = Math.max(2, Math.min(4, Math.round(copies)));   // last one is the survivor

  // hide the real card — `!important` because a fresh card carries `.popin`, whose keyframes animate
  // opacity and would otherwise outrank a plain inline style (the bug fixed for the coalesce in #671)
  const hide = (v: string): void => card.style.setProperty('opacity', v, 'important');
  card.style.setProperty('opacity', '0', 'important');

  const scrim = document.createElement('div');
  scrim.style.cssText = `position:fixed;inset:0;background:#05040a;opacity:0;pointer-events:none;z-index:300`;
  document.body.appendChild(scrim);

  const fxCv = document.createElement('canvas');
  fxCv.width = vw; fxCv.height = vh;
  fxCv.style.cssText = `position:fixed;left:0;top:0;width:${vw}px;height:${vh}px;pointer-events:none;z-index:305`;
  const flCv = document.createElement('canvas');
  flCv.width = vw; flCv.height = vh;
  flCv.style.cssText = `position:fixed;left:0;top:0;width:${vw}px;height:${vh}px;pointer-events:none;z-index:301`;
  document.body.appendChild(flCv);   // flourish BEHIND the cards (owner call)
  const ctx = fxCv.getContext('2d'), flx = flCv.getContext('2d');

  // three flying clones, all plain — the survivor regains `.golden` at the crown so you watch it turn
  const flyers: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const el = cloneCard(card);
    el.classList.remove('golden');
    // NO width/height: the clone sizes itself from the vars copied in `cloneCard`, exactly as it did in its
    // row. It is pinned at left/top 0, so it MUST be both transformed to centre and left transparent before
    // it is appended — otherwise the browser paints one frame of a solid card in the top-left corner before
    // the first rAF moves it (the "blip" the owner saw). Beat 1 fades it in from `al`.
    el.style.cssText += `position:fixed;left:0;top:0;margin:0;pointer-events:none;`
      + `z-index:${i === n - 1 ? 304 : 303};transform-origin:50% 50%;`
      + `transform:translate(${CENTRE.x - W / 2}px, ${CENTRE.y - H / 2}px) scale(${c.centreScale * 0.88});`;
    el.style.setProperty('opacity', '0', 'important');
    document.body.appendChild(el);
    flyers.push(el);
  }
  // the plate is what the rig's px quantities were dialed against; fall back to the card box if unplated
  const plateW = flyers[0].querySelector<HTMLElement>('.cardplate')?.getBoundingClientRect().width || W;
  const k = plateW / REF_W;
  document.body.appendChild(fxCv);   // streams + burst in FRONT of the cards
  const heroEl = flyers[flyers.length - 1];

  // gold wireframe over the survivor
  // Class `cardplate` so it inherits the plate's exact geometry inside the clone (`.card.plated .cardplate`)
  // rather than stretching over the whole card box — which is what put the gold out of register.
  const imp = document.createElement('div');
  imp.className = 'cardplate';
  imp.style.cssText = [
    'opacity:0', 'pointer-events:none', 'z-index:6',
    `background:${arcaneGradient(c.cDeep, c.cMid, c.cCore, c.grad)}`,
    `-webkit-mask:url(${WIRE_SRC}) center / 100% 100% no-repeat`,
    `mask:url(${WIRE_SRC}) center / 100% 100% no-repeat`,
    `filter:drop-shadow(0 0 ${c.g1v * k}px ${rgba(c.cMid, 0.9)}) drop-shadow(0 0 ${c.g2v * k}px ${rgba(c.cDeep, 1)})`,
  ].join(';');
  heroEl.appendChild(imp);

  interface Stream { ci: number; su: number; sv: number; tu: number; tv: number; bow: number; born: number; r: number }
  const streams: Stream[] = [];
  const nCopies = Math.max(1, n - 1);   // flankers feeding the survivor
  for (let ci = 0; ci < nCopies; ci++) {
    for (let i = 0; i < Math.round(c.streamCount / nCopies); i++) {
      streams.push({ ci, su: Math.random(), sv: Math.random(), tu: Math.random(), tv: Math.random(),
        bow: (Math.random() * 0.6 + 0.7) * c.arc * plateW * 0.5 * (Math.random() < 0.5 ? -1 : 1),
        born: Math.random() * 0.5, r: c.fuseSize * k * (1 + (Math.random() - 0.5) * 1.4) });
    }
  }
  const bursts = Array.from({ length: c.burst }, () => {
    const a = Math.random() * Math.PI * 2, sp = c.burstSpd * k * (0.4 + Math.random() * 0.8);
    return { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: c.fuseSize * k * (0.6 + Math.random()), life: 0.4 + Math.random() * 0.6 };
  });

  const blit = (spr: HTMLCanvasElement, x: number, y: number, r: number, a: number): void => {
    if (!ctx || r <= 0 || a <= 0) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
  };

  const drawFlourish = (p: number, cx: number, cy: number): void => {
    if (!flx) return;
    flx.clearRect(0, 0, vw, vh);
    if (c.flourishType === 'none' || p <= 0 || p >= 1) return;
    const grow = 1 - Math.pow(1 - p, 2.2);
    const fade = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
    const R = plateW * c.flSize * grow;
    flx.save();
    flx.translate(cx, cy);
    flx.rotate((p * T.flMs / 1000) * c.flSpin * Math.PI / 180);
    flx.globalAlpha = Math.max(0, fade) * c.flInten;
    flx.strokeStyle = c.cCore; flx.fillStyle = c.cMid;
    flx.shadowColor = c.cMid; flx.shadowBlur = 24 * k;
    if (c.flourishType === 'rays') {
      for (let i = 0; i < 16; i++) {
        const len = R * (i % 2 ? 0.62 : 1);
        flx.save(); flx.rotate((i / 16) * Math.PI * 2);
        const g = flx.createLinearGradient(0, 0, 0, -len);
        g.addColorStop(0, c.cCore); g.addColorStop(1, 'transparent');
        flx.fillStyle = g;
        flx.beginPath(); flx.moveTo(-R * 0.035, 0); flx.lineTo(0, -len); flx.lineTo(R * 0.035, 0);
        flx.closePath(); flx.fill(); flx.restore();
      }
    } else if (c.flourishType === 'crown') {
      const span = Math.PI * 0.62, top = -H * 0.5 * c.centreScale - R * 0.05;
      for (let i = 0; i < 5; i++) {
        const a = -span / 2 + (i / 4) * span, px = Math.sin(a) * R * 0.62;
        const tip = top - R * 0.30 * (i === 2 ? 1.35 : 1);
        flx.beginPath(); flx.moveTo(px - R * 0.055, top); flx.lineTo(px, tip); flx.lineTo(px + R * 0.055, top);
        flx.closePath(); flx.fill();
      }
      flx.lineWidth = Math.max(1, R * 0.022);
      flx.beginPath(); flx.moveTo(-R * 0.42, top); flx.lineTo(R * 0.42, top); flx.stroke();
    } else if (c.flourishType === 'seal') {
      flx.lineWidth = Math.max(1, R * 0.02);
      flx.beginPath(); flx.arc(0, 0, R * 0.72, 0, Math.PI * 2); flx.stroke();
      flx.beginPath(); flx.arc(0, 0, R * 0.58, 0, Math.PI * 2); flx.stroke();
      for (let i = 0; i < 12; i++) {
        flx.save(); flx.rotate((i / 12) * Math.PI * 2); flx.translate(0, -R * 0.65);
        flx.beginPath(); flx.moveTo(0, -R * 0.05); flx.lineTo(R * 0.035, 0); flx.lineTo(0, R * 0.05);
        flx.lineTo(-R * 0.035, 0); flx.closePath(); flx.fill(); flx.restore();
      }
    } else if (c.flourishType === 'rings') {
      for (let i = 0; i < 3; i++) {
        const rp = Math.max(0, Math.min(1, p * 1.5 - i * 0.18));
        if (rp <= 0 || rp >= 1) continue;
        flx.globalAlpha = (1 - rp) * c.flInten;
        flx.lineWidth = Math.max(1, R * 0.03 * (1 - rp) + 1);
        flx.beginPath(); flx.arc(0, 0, R * 0.25 + R * 0.8 * rp, 0, Math.PI * 2); flx.stroke();
      }
    }
    flx.restore();
  };

  const t0 = performance.now();
  let raf = 0, goldOn = false;
  const done = (): void => {
    cancelAnimationFrame(raf);
    for (const el of flyers) el.remove();
    scrim.remove(); fxCv.remove(); flCv.remove();
    card.style.removeProperty('opacity');
  };

  const frame = (now: number): void => {
    const ms = now - t0;

    // ---- where each card is ----
    // They open ALREADY gathered: beat 1 fades them in at their cluster seats with a small scale-up, rather
    // than flying them from anywhere (owner call — see the module note).
    const pos = Array.from({ length: n }, (_, i) => {
      const born = (i / Math.max(1, n - 1)) * c.flyStag * c.inMs;
      const inT = Math.max(0, Math.min(1, (ms - born) / Math.max(1, c.inMs * (1 - c.flyStag))));
      const a = easeOut(inT, c.flyInEase);
      const isHero = i === n - 1;
      // flanks spread evenly either side of the survivor
      const side = isHero ? 0 : (n <= 2 ? -1 : (i - (n - 2) / 2) * 2 / Math.max(1, n - 2));
      return {
        x: CENTRE.x + side * c.cluster * plateW,
        y: CENTRE.y,
        sc: c.centreScale * (0.88 + 0.12 * a),
        rot: side * c.fanTilt,
        al: a,
      };
    });
    const mg = Math.max(0, Math.min(1, (ms - T.mergeStart) / T.mergeMs));
    for (let i = 0; i < n - 1; i++) {
      const e = easeOut(mg, 1.8);
      pos[i].x += (CENTRE.x - pos[i].x) * e;
      pos[i].y += (CENTRE.y - pos[i].y) * e;
      pos[i].rot *= (1 - e); pos[i].al = 1 - mg; pos[i].sc *= (1 - 0.18 * mg);
    }
    const crownP = Math.max(0, Math.min(1, (ms - T.crown) / T.wireIn));
    const outT = Math.max(0, Math.min(1, (ms - T.leave) / T.flyOutMs));
    const oa = easeOut(outT, c.flyOutEase);
    const hero = pos[n - 1];
    hero.x += (DEST.x - hero.x) * oa;
    hero.y += (DEST.y - hero.y) * oa;
    hero.sc = hero.sc * (1 + (c.punch - 1) * Math.sin(crownP * Math.PI)) * (1 - oa) + oa;
    hero.al = Math.max(hero.al, oa);          // fully solid by the time it lands
    flyers.forEach((el, i) => {
      const p = pos[i];
      el.style.transform = `translate(${p.x - W / 2}px, ${p.y - H / 2}px) scale(${p.sc}) rotate(${p.rot}deg)`;
      el.style.setProperty('opacity', String(p.al), 'important');
    });

    // the transformation itself — the survivor turns gold on the crown beat
    if (!goldOn && ms >= T.crown) { heroEl.classList.add('golden'); goldOn = true; }

    scrim.style.opacity = String(c.scrim * Math.min(1, ms / Math.max(1, c.inMs)) * (1 - oa));

    // ---- streams + burst ----
    if (ctx) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - c.trail})`;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalCompositeOperation = 'lighter';
      if (ms >= T.mergeStart) {
        const span = Math.max(1, T.mergeMs * 0.5);
        for (const p of streams) {
          const t = (ms - T.mergeStart - p.born * T.mergeMs) / span;
          if (t < 0 || t > 1) continue;
          const from = pos[Math.min(p.ci, Math.max(0, n - 2))], to = hero;
          const sx = from.x + (p.su - 0.5) * W * from.sc, sy = from.y + (p.sv - 0.5) * H * from.sc;
          const tx = to.x + (p.tu - 0.5) * W * to.sc, ty = to.y + (p.tv - 0.5) * H * to.sc;
          const a = easeOut(t, 1.6);
          const dx = tx - sx, dy = ty - sy, m = Math.hypot(dx, dy) || 1;
          const bow = Math.sin(t * Math.PI) * p.bow;
          const x = sx + dx * a + (-dy / m) * bow, y = sy + dy * a + (dx / m) * bow;
          const al = t < 0.15 ? t / 0.15 : 1;
          blit(sprites!.core, x, y, p.r, al * 0.9);
          blit(sprites!.mid, x, y, p.r * 1.8, al * 0.45);
        }
      }
      if (ms >= T.crown) {
        const bt = (ms - T.crown) / 1000;
        for (const b of bursts) {
          const age = bt / b.life;
          if (age >= 1) continue;
          const f = 1 - age;
          blit(sprites!.core, hero.x + b.vx * bt, hero.y + b.vy * bt, b.r * f, f * f * 0.9);
          blit(sprites!.mid, hero.x + b.vx * bt, hero.y + b.vy * bt, b.r * 1.8 * f, f * 0.4);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- crown ----
    const wOut = Math.max(0, Math.min(1, (ms - (T.crown + T.wireIn + T.wireHold)) / T.wireOut));
    imp.style.opacity = String(crownP * (1 - wOut) * c.wireInten);
    const flash = crownP * (1 - wOut) * c.cardFlash;
    const art = heroEl.querySelector<HTMLElement>('.art');
    if (art) {
      art.style.filter = flash > 0
        ? `brightness(${1 + flash * 0.55}) saturate(${1 + flash * 0.5}) drop-shadow(0 0 ${18 * k * flash}px ${rgba(c.cMid, 0.9)})`
        : '';
    }
    drawFlourish((ms - T.crown) / Math.max(1, T.flMs), hero.x, hero.y);

    if (ms >= T.end + 160) { done(); return; }
    // hand the real card back exactly as the clone lands on it
    if (outT >= 1) hide('1');
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
