import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner for the STAT MILESTONE FRAMES — the art discs an Attack/Health badge sits in once it crosses a
 * value tier (see choreo/statMilestones.ts), the state tint over them, and the number itself (owner ask
 * 2026-09-15: *"can you just create a tuner for me to adjust the size and positioning of each component?
 * including the number sizes, background colors, number colors, everything"*).
 *
 * Every dial here is a CSS custom property the badge styling in `styles.css` reads (the `MILESTONE FRAMES`
 * block). Nothing about the game logic changes — the tier a badge is in is still a pure function of its value;
 * this only moves and colours the pixels. The values ship: in production the config falls back to DEFAULTS and
 * `applyMilestoneFrameVars()` still runs at load, so the owner's tuned numbers are what players see once baked
 * into DEFAULTS below.
 *
 * ── Why per-tier frame SIZE but a single frame OFFSET ────────────────────────────────────────────────────
 * The five frame arts share one disc geometry (the leather sits at the same spot in each PNG), but the ornate
 * high tiers wrap the disc in a thicker rim, so the disc is a SMALLER fraction of the image — each tier needs
 * its own scale to keep the disc (and thus the number) a constant on-screen size. The disc's OFFSET within the
 * image is the same across tiers, so one dx/dy nudge seats all five.
 */
export interface MilestoneFrameConfig {
  // ── Frame size, per tier (× of the 60px badge) ──────────────────────────────────────────────────────────
  scale1: number; scale2: number; scale3: number; scale4: number; scale5: number; scale6: number;
  // ── Frame position (px nudge so the disc lands on the number) ────────────────────────────────────────────
  frameDx: number; frameDy: number;

  // ── State tint (the disc that recolours the leather by stat state) ──────────────────────────────────────
  /** Tint disc size as a fraction of the frame width. */
  tintFrac: number;
  /** Tint strength (0 = invisible, 1 = full blend). */
  tintOpacity: number;
  /** Tint nudge from the disc centre (px). */
  tintDx: number; tintDy: number;
  /** Tint colour at base (neutral), when buffed above base (up), and below base/floor (down). */
  tintNeutral: string; tintUp: string; tintDown: string;

  // ── The number ──────────────────────────────────────────────────────────────────────────────────────────
  /** Font size of the digit on a framed badge (px). */
  numSize: number;
  /** Number nudge from the disc centre (px). */
  numDx: number; numDy: number;
  /** Number fill colour, outline width (px) and outline colour. */
  numColor: string; numStrokeW: number; numStrokeColor: string;

  // ── Glow underneath each frame ──────────────────────────────────────────────────────────────────────────
  /** Glow disc size (fraction of the frame), blur radius (px), and strength (opacity). */
  glowSize: number; glowBlur: number; glowOpacity: number;
  /** Glow colour per tier 1..6 — controllable individually. */
  glow1: string; glow2: string; glow3: string; glow4: string; glow5: string; glow6: string;
}

/** Shipped values — the current authored look. Frame scales seat each tier's disc; tint/number match today. */
const DEFAULTS: MilestoneFrameConfig = {
  scale1: 1, scale2: 1, scale3: 1, scale4: 1, scale5: 1, scale6: 1,
  frameDx: -0.5, frameDy: 3,

  tintFrac: 0.66, tintOpacity: 1, tintDx: -1.5, tintDy: -0.5,
  tintNeutral: '#be8c04', tintUp: '#00992e', tintDown: '#bd311f',

  numSize: 33, numDx: -0.5, numDy: 0, numColor: '#ffffff', numStrokeW: 0, numStrokeColor: '#000000',

  glowSize: 0.95, glowBlur: 9, glowOpacity: 0.75,
  glow1: '#c9d3e0', glow2: '#c9d3e0', glow3: '#ffd54a', glow4: '#ff5edb', glow5: '#4fd1ff', glow6: '#ffffff',
};

type ColorKey = 'tintNeutral' | 'tintUp' | 'tintDown' | 'numColor' | 'numStrokeColor'
  | 'glow1' | 'glow2' | 'glow3' | 'glow4' | 'glow5' | 'glow6';

const RANGES: Record<Exclude<keyof MilestoneFrameConfig, ColorKey>, [number, number, number]> = {
  scale1: [0.8, 3, 0.01], scale2: [0.8, 3, 0.01], scale3: [0.8, 3, 0.01], scale4: [0.8, 3, 0.01], scale5: [0.8, 3, 0.01], scale6: [0.8, 3, 0.01],
  frameDx: [-40, 40, 0.5], frameDy: [-40, 40, 0.5],
  tintFrac: [0, 1, 0.01], tintOpacity: [0, 1, 0.01], tintDx: [-40, 40, 0.5], tintDy: [-40, 40, 0.5],
  numSize: [10, 60, 1], numDx: [-40, 40, 0.5], numDy: [-40, 40, 0.5], numStrokeW: [0, 6, 0.5],
  glowSize: [0, 2, 0.01], glowBlur: [0, 40, 1], glowOpacity: [0, 1, 0.01],
};

export { DEFAULTS as MILESTONE_FRAME_DEFAULTS };

const KEY = 'ascent.milestoneframe';

let cfg: MilestoneFrameConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<MilestoneFrameConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getMilestoneFrameConfig(): MilestoneFrameConfig {
  return cfg;
}

/** Push every dial to the CSS custom properties `styles.css` reads. Colours go through as-is; pixel dials get
 *  a `px` unit; the per-tier scales are unitless multipliers keyed `--ms-scale-<tier>`. */
export function applyMilestoneFrameVars(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--ms-scale-1', String(cfg.scale1));
  r.setProperty('--ms-scale-2', String(cfg.scale2));
  r.setProperty('--ms-scale-3', String(cfg.scale3));
  r.setProperty('--ms-scale-4', String(cfg.scale4));
  r.setProperty('--ms-scale-5', String(cfg.scale5));
  r.setProperty('--ms-scale-6', String(cfg.scale6));
  r.setProperty('--msf-dx', `${cfg.frameDx}px`);
  r.setProperty('--msf-dy', `${cfg.frameDy}px`);
  r.setProperty('--mstint-frac', String(cfg.tintFrac));
  r.setProperty('--mstint-opacity', String(cfg.tintOpacity));
  r.setProperty('--mstint-dx', `${cfg.tintDx}px`);
  r.setProperty('--mstint-dy', `${cfg.tintDy}px`);
  r.setProperty('--mstint-neutral', cfg.tintNeutral);
  r.setProperty('--mstint-up', cfg.tintUp);
  r.setProperty('--mstint-down', cfg.tintDown);
  r.setProperty('--msnum-size', `${cfg.numSize}px`);
  r.setProperty('--msnum-dx', `${cfg.numDx}px`);
  r.setProperty('--msnum-dy', `${cfg.numDy}px`);
  r.setProperty('--msnum-color', cfg.numColor);
  r.setProperty('--msnum-stroke-w', `${cfg.numStrokeW}px`);
  r.setProperty('--msnum-stroke-color', cfg.numStrokeColor);
  r.setProperty('--msglow-frac', String(cfg.glowSize));
  r.setProperty('--msglow-blur', `${cfg.glowBlur}px`);
  r.setProperty('--msglow-opacity', String(cfg.glowOpacity));
  r.setProperty('--ms-glow-1', cfg.glow1);
  r.setProperty('--ms-glow-2', cfg.glow2);
  r.setProperty('--ms-glow-3', cfg.glow3);
  r.setProperty('--ms-glow-4', cfg.glow4);
  r.setProperty('--ms-glow-5', cfg.glow5);
  r.setProperty('--ms-glow-6', cfg.glow6);
}

const COLOR_KEYS: ReadonlySet<string> = new Set<ColorKey>(['tintNeutral', 'tintUp', 'tintDown', 'numColor', 'numStrokeColor', 'glow1', 'glow2', 'glow3', 'glow4', 'glow5', 'glow6']);

export function setMilestoneFrameValue(key: keyof MilestoneFrameConfig, value: number | string): void {
  const isColor = COLOR_KEYS.has(key);
  cfg = { ...cfg, [key]: isColor ? String(value) : Number(value) };
  applyMilestoneFrameVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetMilestoneFrameConfig(): void {
  cfg = { ...DEFAULTS };
  applyMilestoneFrameVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** [label, unit, hint, group] per numeric dial; colours are appended after, declaration order = render order. */
const NUM_SPECS: Record<keyof typeof RANGES, [string, TunerControl['unit'], string, string]> = {
  scale1: ['Tier 1 size (0–49)', '×', 'Size of the plain silver frame vs the badge.', 'Frame size (per tier)'],
  scale2: ['Tier 2 size (≥50)', '×', 'Size of the silver dagger frame.', 'Frame size (per tier)'],
  scale3: ['Tier 3 size (≥150)', '×', 'Size of the gold frame.', 'Frame size (per tier)'],
  scale4: ['Tier 4 size (≥500)', '×', 'Size of the pink frame.', 'Frame size (per tier)'],
  scale5: ['Tier 5 size (≥2000)', '×', 'Size of the blue frame.', 'Frame size (per tier)'],
  scale6: ['Tier 6 size (≥5000)', '×', 'Size of the top (crystal) frame — the ornate one with the most overflow.', 'Frame size (per tier)'],
  frameDx: ['Frame X', 'px', 'Nudge every frame left/right so its disc sits on the number.', 'Frame position'],
  frameDy: ['Frame Y', 'px', 'Nudge every frame up/down so its disc sits on the number.', 'Frame position'],
  tintFrac: ['Tint size', undefined, 'Tint disc size as a fraction of the frame — how much of the leather it covers.', 'State tint'],
  tintOpacity: ['Tint strength', 'opacity', '0 hides the tint, 1 is a fully opaque solid disc over the leather.', 'State tint'],
  tintDx: ['Tint X', 'px', 'Nudge the tint disc left/right.', 'State tint'],
  tintDy: ['Tint Y', 'px', 'Nudge the tint disc up/down.', 'State tint'],
  numSize: ['Number size', 'px', 'Font size of the digit on a framed badge.', 'Number'],
  numDx: ['Number X', 'px', 'Nudge the number left/right within the disc.', 'Number'],
  numDy: ['Number Y', 'px', 'Nudge the number up/down within the disc.', 'Number'],
  numStrokeW: ['Number outline', 'px', 'Outline width around the digit — 0 is none.', 'Number'],
  glowSize: ['Glow size', undefined, 'Glow disc size as a fraction of the frame.', 'Glow'],
  glowBlur: ['Glow blur', 'px', 'How soft the glow halo is — higher spreads it wider.', 'Glow'],
  glowOpacity: ['Glow strength', 'opacity', 'How strong the glow reads behind the frame. 0 hides it.', 'Glow'],
};

const numControls: TunerControl<Extract<keyof MilestoneFrameConfig, string>>[] =
  (Object.keys(NUM_SPECS) as (keyof typeof RANGES)[]).map((key) => {
    const [label, unit, hint, group] = NUM_SPECS[key];
    const [min, max, step] = RANGES[key];
    return { key, label, unit, hint, group, min, max, step } as TunerControl<Extract<keyof MilestoneFrameConfig, string>>;
  });

const colorControls: TunerControl<Extract<keyof MilestoneFrameConfig, string>>[] = [
  { key: 'tintNeutral', label: 'Neutral colour', hint: 'Tint at base value (stat unchanged).', group: 'State tint colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'tintUp', label: 'Buffed colour', hint: 'Tint when the stat is above its printed base.', group: 'State tint colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'tintDown', label: 'Reduced colour', hint: 'Tint when the stat is below base / combat floor.', group: 'State tint colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'numColor', label: 'Number colour', hint: 'Fill colour of the digit on a framed badge.', group: 'Number colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'numStrokeColor', label: 'Number outline colour', hint: 'Colour of the digit outline (width above).', group: 'Number colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glow1', label: 'Tier 1 glow (0–49)', hint: 'Glow colour behind the plain silver frame.', group: 'Glow colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glow2', label: 'Tier 2 glow (≥50)', hint: 'Glow colour behind the silver dagger frame.', group: 'Glow colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glow3', label: 'Tier 3 glow (≥150)', hint: 'Glow colour behind the gold frame.', group: 'Glow colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glow4', label: 'Tier 4 glow (≥500)', hint: 'Glow colour behind the pink frame.', group: 'Glow colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glow5', label: 'Tier 5 glow (≥2000)', hint: 'Glow colour behind the blue frame.', group: 'Glow colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glow6', label: 'Tier 6 glow (≥5000)', hint: 'Glow colour behind the top crystal frame.', group: 'Glow colours', kind: 'color', min: 0, max: 0, step: 0 },
];

const controls = [...numControls, ...colorControls];

export const SPEC: TunerSpec<MilestoneFrameConfig> = {
  id: 'milestoneframe',            // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Milestone Badges',
  note: 'dev · live · buff a unit past 50/150/…',
  read: getMilestoneFrameConfig,
  write: (key, value) => setMilestoneFrameValue(key, value),
  writeColor: (key, value) => setMilestoneFrameValue(key, value),
  reset: resetMilestoneFrameConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so the badges are live before the first paint (the equipSlotConfig-era pattern).
applyMilestoneFrameVars();
