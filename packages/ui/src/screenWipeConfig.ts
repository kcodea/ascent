import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';
import type { WipeOrigin } from './wipeGeometry';

/**
 * THE SCREEN WIPE: the tunable numbers for the combat <-> shop curtain (owner ask 2026-09-24: *"the screen wipe
 * still isnt perfect, can you make it smoother/wider/cleaner so that there's no jank on an ultrawide?"*).
 *
 * Tuner convention: localStorage-persisted in DEV only, production always plays `WIPE_DEFAULTS`. Every value is
 * read when a wipe STARTS (Recruit reads it per render; the machine only moves between wipes), so a slider change
 * shows on the next wipe, or at once through the tuner's ▶ Play button. Shipping a feel = pasting the tuned
 * numbers into `WIPE_DEFAULTS`.
 *
 * The shape, in order: the gem's charge-up tell → the COVER bloom (an ellipse out of the gem, growing to the
 * farthest corner, with a glowing ring riding its edge) → a hold at full blue while the scene swaps underneath →
 * the linear REVEAL sweep.
 */
export interface ScreenWipeConfig {
  // ── Timing ──
  /** The cover bloom, gem to full cover. */
  coverMs: number;
  /** The linear reveal sweep after the hold. */
  revealMs: number;
  /** The gem's charge-up tell before the bloom. */
  chargeMs: number;
  /** Full-blue hold going INTO combat (long enough to read NOW FACING). */
  holdInMs: number;
  /** Full-blue hold coming back to the shop. */
  holdOutMs: number;
  // ── The bloom's easing: cubic-bezier(x1, y1, x2, y2) ──
  easeX1: number;
  easeY1: number;
  /** The TAIL: with `easeY2` below 1 the bloom is still moving when it reaches full cover, so the visible part of
   *  the seam never crawls. x2 = y2 = 1 ends dead slow (the old feel). */
  easeX2: number;
  easeY2: number;
  // ── Shape ──
  /**
   * 0 = a circle. 1 = an ellipse stretched by how much WIDER than 16:9 the screen is (so 16:9 stays a circle and a
   * 21:9 / 32:9 screen gets a proportionally wider bloom that reaches its sides together with its top and bottom).
   * Values between blend; above 1 exaggerates.
   */
  ellipse: number;
  // ── The ring on the seam ──
  /** Where the ring's bright line sits in its texture (0..1 of the radius). Lower = more room for the halo. */
  ringLine: number;
  /** How far INSIDE the seam the ring's glow reaches, as a fraction of the radius. */
  ringInner: number;
  /** Brightness of the ring itself. 0 = no ring. */
  ringGlow: number;
  /** The soft leading HALO just outside the seam, over the old scene (the "double layer" edge). 0 = none. */
  ringHalo: number;
}

/**
 * Shipped values (2026-09-24, round 2 of the ultrawide fix). Same 450 ms bloom and hold lengths as before; the
 * bloom is an aspect-stretched ellipse (a circle on 16:9), eases in and leaves the screen still moving instead of
 * crawling into the far corner, and its edge is a brighter ring with a soft leading halo.
 */
export const WIPE_DEFAULTS: ScreenWipeConfig = {
  coverMs: 450,
  revealMs: 450,
  chargeMs: 260,
  holdInMs: 900,
  holdOutMs: 700,
  easeX1: 0.45,
  easeY1: 0,
  easeX2: 0.7,
  easeY2: 0.85,
  ellipse: 1,
  ringLine: 0.88,
  ringInner: 0.1,
  ringGlow: 1,
  ringHalo: 0.55,
};

type Key = keyof ScreenWipeConfig;

export const WIPE_RANGES: Record<Key, [number, number, number]> = {
  coverMs: [150, 1500, 10],
  revealMs: [150, 1500, 10],
  chargeMs: [0, 800, 10],
  holdInMs: [0, 2500, 10],
  holdOutMs: [0, 2500, 10],
  easeX1: [0, 1, 0.01],
  easeY1: [-0.5, 1.5, 0.01],
  easeX2: [0, 1, 0.01],
  easeY2: [-0.5, 1.5, 0.01],
  ellipse: [0, 1.5, 0.05],
  ringLine: [0.6, 0.97, 0.01],
  ringInner: [0.02, 0.3, 0.01],
  ringGlow: [0, 1.5, 0.05],
  ringHalo: [0, 1.5, 0.05],
};

const KEY = 'ascent.screenwipe';

/** Clamp every field into its range (a stale or hand-edited localStorage entry can never break the wipe). */
export function sanitizeWipeConfig(c: Partial<ScreenWipeConfig>): ScreenWipeConfig {
  const out = { ...WIPE_DEFAULTS };
  for (const k of Object.keys(WIPE_DEFAULTS) as Key[]) {
    const v = Number(c[k]);
    if (!Number.isFinite(v)) continue;
    const [min, max] = WIPE_RANGES[k];
    out[k] = Math.min(max, Math.max(min, v));
  }
  return out;
}

let cfg: ScreenWipeConfig = (() => {
  if (!import.meta.env.DEV) return { ...WIPE_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return sanitizeWipeConfig(saved && typeof saved === 'object' ? (saved as Partial<ScreenWipeConfig>) : {});
  } catch {
    return { ...WIPE_DEFAULTS };
  }
})();

export function getScreenWipeConfig(): ScreenWipeConfig {
  return cfg;
}

export function setScreenWipeValue(key: Key, value: number): void {
  cfg = sanitizeWipeConfig({ ...cfg, [key]: Number(value) });
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetScreenWipeConfig(): void {
  cfg = { ...WIPE_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The bloom's CSS easing, from the four bezier handles. */
export function wipeEaseCss(c: ScreenWipeConfig): string {
  return `cubic-bezier(${c.easeX1}, ${c.easeY1}, ${c.easeX2}, ${c.easeY2})`;
}

// ─── the tuner ────────────────────────────────────────────────────────────────────────────────────────────────

const SPECS: Record<Key, [string, TunerUnit | undefined, string, string]> = {
  coverMs: ['Cover bloom', 'ms', 'How long the bloom takes to grow from the gem to full cover.', 'Timing'],
  revealMs: ['Reveal sweep', 'ms', 'How long the straight sweep that uncovers the new screen takes.', 'Timing'],
  chargeMs: ['Gem charge-up', 'ms', 'The gem’s anticipation beat before the bloom erupts.', 'Timing'],
  holdInMs: ['Hold into combat', 'ms', 'Time at full blue going into combat (NOW FACING is read here).', 'Timing'],
  holdOutMs: ['Hold back to shop', 'ms', 'Time at full blue coming back to the shop.', 'Timing'],
  easeX1: ['Start: x', undefined, 'Bloom easing, first handle. Higher = a slower, heavier start out of the gem.', 'Easing'],
  easeY1: ['Start: y', undefined, 'Bloom easing, first handle height.', 'Easing'],
  easeX2: ['Tail: x', undefined, 'Bloom easing, second handle. With Tail: y below 1 the bloom leaves the screen still moving.', 'Easing'],
  easeY2: ['Tail: y', undefined, 'Tail speed. 1 = ends dead slow (crawls into the far corner). Lower = a faster, cleaner finish.', 'Easing'],
  ellipse: ['Wide-screen stretch', undefined, '0 = always a circle. 1 = on screens wider than 16:9 the bloom stretches sideways by how much wider they are, so it reaches the sides with the top and bottom. 16:9 is a circle either way.', 'Shape'],
  ringLine: ['Ring position', undefined, 'Where the bright line sits in the ring texture. Lower leaves more room for the leading halo.', 'Edge'],
  ringInner: ['Ring width', undefined, 'How far inside the seam the ring’s glow reaches, as a share of the radius.', 'Edge'],
  ringGlow: ['Ring brightness', '×', 'Brightness of the ring on the seam. 0 = no ring.', 'Edge'],
  ringHalo: ['Leading halo', '×', 'The soft glow just OUTSIDE the seam, over the old screen. 0 = a hard edge.', 'Edge'],
};

function buildControls(): TunerControl<Key>[] {
  return (Object.keys(SPECS) as Key[]).map((key) => {
    const [label, unit, hint, group] = SPECS[key];
    const [min, max, step] = WIPE_RANGES[key];
    return { key, label, unit, hint, group, min, max, step };
  });
}

/** Window event the ▶ Play action fires; `WipePreview` listens for it in dev builds. */
export const WIPE_PLAY_EVENT = 'ascent:screen-wipe-play';

export const SPEC: TunerSpec<ScreenWipeConfig> = {
  id: 'screenwipe', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Screen wipe',
  note: () => {
    const c = getScreenWipeConfig();
    return `dev · ▶ to play · ${((c.chargeMs + c.coverMs + c.holdOutMs + c.revealMs) / 1000).toFixed(2)} s`;
  },
  read: getScreenWipeConfig,
  write: (key, value) => setScreenWipeValue(key, value),
  reset: resetScreenWipeConfig,
  defaults: WIPE_DEFAULTS,
  controls: buildControls(),
  actions: [
    {
      label: '▶ Play',
      hint: 'Play the Returning-to-Shop wipe over the current screen with the values above (nothing in the run changes).',
      run: () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WIPE_PLAY_EVENT)); },
    },
  ],
};

// ─── the CSS custom properties one wipe runs on ───────────────────────────────────────────────────────────────

/**
 * Every var the curtain, the ring and the reveal bar read (see `.wipecurtain` / `.wipefront` / `.wipebar` in
 * styles.css). Set inline on those three elements, read once per wipe: nothing here changes DURING a sweep, so
 * the ring's gradient rasterises once and the bloom's per-frame work is the clip and a compositor transform.
 */
export function wipeCssVars(c: ScreenWipeConfig, o: WipeOrigin | null): Record<string, string> {
  const line = c.ringLine * 100;
  const inner = Math.min(line - 1, c.ringInner * 100);
  const vars: Record<string, string> = {
    '--wipe-dur': `${c.coverMs}ms`,
    '--wipe-reveal-dur': `${c.revealMs}ms`,
    '--wipe-ease': wipeEaseCss(c),
    '--wf-in0': `${(line - inner).toFixed(2)}%`,
    '--wf-in1': `${(line - inner * 0.35).toFixed(2)}%`,
    '--wf-line': `${line.toFixed(2)}%`,
    '--wf-out1': `${(line + (100 - line) * 0.35).toFixed(2)}%`,
    '--wf-glow': String(c.ringGlow),
    '--wf-halo': String(c.ringHalo),
  };
  if (o) {
    vars['--wipe-cx'] = `${o.cx}px`;
    vars['--wipe-cy'] = `${o.cy}px`;
    vars['--wipe-rx'] = `${o.rx}px`;
    vars['--wipe-ry'] = `${o.ry}px`;
    vars['--wipe-front-sx'] = String(o.frontScaleX);
    vars['--wipe-front-sy'] = String(o.frontScaleY);
  }
  return vars;
}
