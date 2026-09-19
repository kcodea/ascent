import type { TunerControl, TunerSpec } from './tunerSchema';

/** `#rrggbb` + a 0..1 strength → a `rgba(r,g,b,a)` string, so a colour-picker hex and an opacity slider can
 *  drive one `text-shadow` colour. A malformed hex falls back to black. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const v = Number.isFinite(n) ? n : 0;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

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

  // ── Stat tint (the disc BEHIND the frame — a fixed colour per stat, NOT per state) ──────────────────────
  /** Tint disc size as a fraction of the frame width. */
  tintFrac: number;
  /** Tint strength (0 = invisible, 1 = full blend). */
  tintOpacity: number;
  /** Tint nudge from the disc centre (px). */
  tintDx: number; tintDy: number;
  /** Tint colour per TIER, per stat (owner ask 2026-09-19): each tier's disc has its own Attack and Health
   *  colour. A framed unit is always buffed to reach a milestone, so this IS the buffed look; the stat STATE
   *  (reduced) is shown by the number colour below. */
  tintAtk1: string; tintAtk2: string; tintAtk3: string; tintAtk4: string; tintAtk5: string; tintAtk6: string;
  tintHp1: string; tintHp2: string; tintHp3: string; tintHp4: string; tintHp5: string; tintHp6: string;

  // ── The number (its COLOUR carries the stat state) ──────────────────────────────────────────────────────
  /** Font size of the digit on a framed badge (px). */
  numSize: number;
  /** Number nudge from the disc centre (px). */
  numDx: number; numDy: number;
  /** Number fill colour at base (neutral) and below base/floor (down); plus outline width (px) and colour. The
   *  BUFFED colour is per-tier per-stat below (owner ask 2026-09-19). */
  numColor: string; numColorDown: string; numStrokeW: number; numStrokeColor: string;
  /** Buffed digit colour per TIER, per stat — changes alongside the tint. Neutral/reduced stay single above. */
  numUpAtk1: string; numUpAtk2: string; numUpAtk3: string; numUpAtk4: string; numUpAtk5: string; numUpAtk6: string;
  numUpHp1: string; numUpHp2: string; numUpHp3: string; numUpHp4: string; numUpHp5: string; numUpHp6: string;
  /** Drop shadow behind the digit: offset (px), blur (px), colour and strength (0 = off, 1 = full). */
  numShadowX: number; numShadowY: number; numShadowBlur: number; numShadowOpacity: number; numShadowColor: string;

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

  tintFrac: 0.76, tintOpacity: 1, tintDx: 0, tintDy: 0,
  tintAtk1: '#ffa200', tintAtk2: '#ffa200', tintAtk3: '#ffa200', tintAtk4: '#ffa200', tintAtk5: '#ffa200', tintAtk6: '#ffa200',
  tintHp1: '#cf0707', tintHp2: '#cf0707', tintHp3: '#cf0707', tintHp4: '#cf0707', tintHp5: '#cf0707', tintHp6: '#cf0707',

  numSize: 26, numDx: -1, numDy: -1.5,
  numColor: '#ffffff', numColorDown: '#ff5a4f', numStrokeW: 0, numStrokeColor: '#000000',
  numUpAtk1: '#6ffe5d', numUpAtk2: '#6ffe5d', numUpAtk3: '#6ffe5d', numUpAtk4: '#6ffe5d', numUpAtk5: '#6ffe5d', numUpAtk6: '#6ffe5d',
  numUpHp1: '#6ffe5d', numUpHp2: '#6ffe5d', numUpHp3: '#6ffe5d', numUpHp4: '#6ffe5d', numUpHp5: '#6ffe5d', numUpHp6: '#6ffe5d',
  numShadowX: 0, numShadowY: 1, numShadowBlur: 4.5, numShadowOpacity: 0.87, numShadowColor: '#000000',

  glowSize: 0.95, glowBlur: 9, glowOpacity: 0.75,
  glow1: '#c9d3e0', glow2: '#c9d3e0', glow3: '#ffd54a', glow4: '#ff5edb', glow5: '#4fd1ff', glow6: '#ffffff',
};

type ColorKey =
  | 'tintAtk1' | 'tintAtk2' | 'tintAtk3' | 'tintAtk4' | 'tintAtk5' | 'tintAtk6'
  | 'tintHp1' | 'tintHp2' | 'tintHp3' | 'tintHp4' | 'tintHp5' | 'tintHp6'
  | 'numColor' | 'numColorDown' | 'numStrokeColor' | 'numShadowColor'
  | 'numUpAtk1' | 'numUpAtk2' | 'numUpAtk3' | 'numUpAtk4' | 'numUpAtk5' | 'numUpAtk6'
  | 'numUpHp1' | 'numUpHp2' | 'numUpHp3' | 'numUpHp4' | 'numUpHp5' | 'numUpHp6'
  | 'glow1' | 'glow2' | 'glow3' | 'glow4' | 'glow5' | 'glow6';

const RANGES: Record<Exclude<keyof MilestoneFrameConfig, ColorKey>, [number, number, number]> = {
  scale1: [0.8, 3, 0.01], scale2: [0.8, 3, 0.01], scale3: [0.8, 3, 0.01], scale4: [0.8, 3, 0.01], scale5: [0.8, 3, 0.01], scale6: [0.8, 3, 0.01],
  frameDx: [-40, 40, 0.5], frameDy: [-40, 40, 0.5],
  tintFrac: [0, 1, 0.01], tintOpacity: [0, 1, 0.01], tintDx: [-40, 40, 0.5], tintDy: [-40, 40, 0.5],
  numSize: [10, 60, 1], numDx: [-40, 40, 0.5], numDy: [-40, 40, 0.5], numStrokeW: [0, 6, 0.5],
  numShadowX: [-20, 20, 0.5], numShadowY: [-20, 20, 0.5], numShadowBlur: [0, 20, 0.5], numShadowOpacity: [0, 1, 0.01],
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
  r.setProperty('--ms-tint-atk-1', cfg.tintAtk1); r.setProperty('--ms-tint-atk-2', cfg.tintAtk2); r.setProperty('--ms-tint-atk-3', cfg.tintAtk3);
  r.setProperty('--ms-tint-atk-4', cfg.tintAtk4); r.setProperty('--ms-tint-atk-5', cfg.tintAtk5); r.setProperty('--ms-tint-atk-6', cfg.tintAtk6);
  r.setProperty('--ms-tint-hp-1', cfg.tintHp1); r.setProperty('--ms-tint-hp-2', cfg.tintHp2); r.setProperty('--ms-tint-hp-3', cfg.tintHp3);
  r.setProperty('--ms-tint-hp-4', cfg.tintHp4); r.setProperty('--ms-tint-hp-5', cfg.tintHp5); r.setProperty('--ms-tint-hp-6', cfg.tintHp6);
  r.setProperty('--msnum-size', `${cfg.numSize}px`);
  r.setProperty('--msnum-dx', `${cfg.numDx}px`);
  r.setProperty('--msnum-dy', `${cfg.numDy}px`);
  r.setProperty('--msnum-color', cfg.numColor);
  r.setProperty('--ms-numup-atk-1', cfg.numUpAtk1); r.setProperty('--ms-numup-atk-2', cfg.numUpAtk2); r.setProperty('--ms-numup-atk-3', cfg.numUpAtk3);
  r.setProperty('--ms-numup-atk-4', cfg.numUpAtk4); r.setProperty('--ms-numup-atk-5', cfg.numUpAtk5); r.setProperty('--ms-numup-atk-6', cfg.numUpAtk6);
  r.setProperty('--ms-numup-hp-1', cfg.numUpHp1); r.setProperty('--ms-numup-hp-2', cfg.numUpHp2); r.setProperty('--ms-numup-hp-3', cfg.numUpHp3);
  r.setProperty('--ms-numup-hp-4', cfg.numUpHp4); r.setProperty('--ms-numup-hp-5', cfg.numUpHp5); r.setProperty('--ms-numup-hp-6', cfg.numUpHp6);
  r.setProperty('--msnum-down', cfg.numColorDown);
  r.setProperty('--msnum-stroke-w', `${cfg.numStrokeW}px`);
  r.setProperty('--msnum-stroke-color', cfg.numStrokeColor);
  r.setProperty('--msnum-shadow-x', `${cfg.numShadowX}px`);
  r.setProperty('--msnum-shadow-y', `${cfg.numShadowY}px`);
  r.setProperty('--msnum-shadow-blur', `${cfg.numShadowBlur}px`);
  r.setProperty('--msnum-shadow-color', hexToRgba(cfg.numShadowColor, cfg.numShadowOpacity));
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

const COLOR_KEYS: ReadonlySet<string> = new Set<ColorKey>([
  'tintAtk1', 'tintAtk2', 'tintAtk3', 'tintAtk4', 'tintAtk5', 'tintAtk6',
  'tintHp1', 'tintHp2', 'tintHp3', 'tintHp4', 'tintHp5', 'tintHp6',
  'numColor', 'numColorDown', 'numStrokeColor', 'numShadowColor',
  'numUpAtk1', 'numUpAtk2', 'numUpAtk3', 'numUpAtk4', 'numUpAtk5', 'numUpAtk6',
  'numUpHp1', 'numUpHp2', 'numUpHp3', 'numUpHp4', 'numUpHp5', 'numUpHp6',
  'glow1', 'glow2', 'glow3', 'glow4', 'glow5', 'glow6']);

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
  numShadowX: ['Shadow X', 'px', 'Drop-shadow offset left/right behind the digit.', 'Number shadow'],
  numShadowY: ['Shadow Y', 'px', 'Drop-shadow offset up/down behind the digit.', 'Number shadow'],
  numShadowBlur: ['Shadow blur', 'px', 'How soft the drop shadow is — 0 is a hard edge.', 'Number shadow'],
  numShadowOpacity: ['Shadow strength', 'opacity', '0 hides the shadow, 1 is fully opaque.', 'Number shadow'],
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

/** Per-tier label with its value band, shared by every per-tier colour group. */
const TIER_LABEL: Record<number, string> = {
  1: 'Tier 1 (0–49)', 2: 'Tier 2 (≥50)', 3: 'Tier 3 (≥150)', 4: 'Tier 4 (≥500)', 5: 'Tier 5 (≥2000)', 6: 'Tier 6 (≥5000)',
};
/** Six per-tier colour pickers for one `<prefix><1..6>` family (owner ask 2026-09-19). */
function tierColorControls(prefix: string, group: string, hint: string): TunerControl<Extract<keyof MilestoneFrameConfig, string>>[] {
  return [1, 2, 3, 4, 5, 6].map((t) => ({
    key: `${prefix}${t}` as Extract<keyof MilestoneFrameConfig, string>,
    label: TIER_LABEL[t], hint: `${hint} — tier ${t}.`, group, kind: 'color' as const, min: 0, max: 0, step: 0,
  }));
}

const colorControls: TunerControl<Extract<keyof MilestoneFrameConfig, string>>[] = [
  ...tierColorControls('tintAtk', 'Attack tint (per tier)', 'Tint disc colour behind the Attack frame'),
  ...tierColorControls('tintHp', 'Health tint (per tier)', 'Tint disc colour behind the Health frame'),
  { key: 'numColor', label: 'Number colour (neutral)', hint: 'Digit colour at base value (stat unchanged).', group: 'Number colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'numColorDown', label: 'Number colour (reduced)', hint: 'Digit colour when the stat is below base / combat floor — one red for every tier.', group: 'Number colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'numStrokeColor', label: 'Number outline colour', hint: 'Colour of the digit outline (width above).', group: 'Number colours', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'numShadowColor', label: 'Number shadow colour', hint: 'Colour of the drop shadow behind the digit (strength above).', group: 'Number colours', kind: 'color', min: 0, max: 0, step: 0 },
  ...tierColorControls('numUpAtk', 'Buffed number — Attack', 'Buffed Attack digit colour'),
  ...tierColorControls('numUpHp', 'Buffed number — Health', 'Buffed Health digit colour'),
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
