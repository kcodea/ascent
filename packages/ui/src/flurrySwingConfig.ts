/**
 * Tunable parameters for the FLURRY SWING FX — the one-shot wind-slash sparkle that fires when a Flurry (W)
 * minion lands its EXTRA swing (windfury's 2nd attack). Same pattern as `critFxConfig.ts`: one mutable,
 * localStorage-persisted config dialed by eye via the DEV "Flurry Swing FX" tuner (`FlurrySwingTuner.tsx`);
 * `getFlurrySwingConfig()` is read at strike time (`pixiFx.windSlash`), so edits apply to the next swing.
 *
 * Persistence is DEV-only (production always ships DEFAULTS). Fire it on demand from the Dev menu's "Test
 * Flurry" button (or `__pixiFx.testFlurry()` in the console) to tune without hunting a real Flurry fight.
 *
 * The layers, at the contact point, oriented along the blow direction:
 *   - CRESCENT WIND-BLADES — a few thin curved slashes sweeping across the impact (the "blade of wind" cutting),
 *     scaling up + fading fast, jittered in angle.
 *   - SPARKLE MOTES — a cone of small bright sparks flung along the blow (the sparkle + oomph).
 *   - a soft GLOW puff — a pale flash at contact.
 * Colours default to the pale cyan-white of the persistent aura so the swing reads as the same wind.
 */
export interface FlurrySwingConfig {
  /** Overall intensity (scales counts / sizes / speeds). */
  power: number;
  /** Wind-blades — how many crescent slashes. */
  slashCount: number;
  /** Wind-blades — drawn size (px). */
  slashSize: number;
  /** Wind-blades — lifetime (ms). */
  slashLife: number;
  /** Wind-blades — how far each is flung outward (px/s). */
  slashSpeed: number;
  /** Wind-blades — angular scatter around the blow direction (deg). */
  slashSpread: number;
  /** Wind-blades — colour (hex). */
  slashColor: string;
  /** Sparkles — mote count. */
  sparkCount: number;
  /** Sparkles — initial speed (px/s). */
  sparkSpeed: number;
  /** Sparkles — lifetime (ms). */
  sparkLife: number;
  /** Sparkles — drawn size (px). */
  sparkSize: number;
  /** Sparkles — cone width around the blow direction (deg). */
  sparkSpread: number;
  /** Sparkles — colour (hex). */
  sparkColor: string;
  /** Glow — soft contact-flash diameter (px). 0 = no glow. */
  glowSize: number;
  /** Glow — peak opacity (0–1). */
  glowAlpha: number;
  /** Glow — colour (hex). */
  glowColor: string;
}

// Owner-tuned starting point (dial in the 🌬️ tuner, then bake here). Pale cyan-white to match the aura.
const DEFAULTS: FlurrySwingConfig = {
  power: 1,
  slashCount: 3,
  slashSize: 42,
  slashLife: 300,
  slashSpeed: 260,
  slashSpread: 46,
  slashColor: '#eaffff',
  sparkCount: 14,
  sparkSpeed: 420,
  sparkLife: 460,
  sparkSize: 9,
  sparkSpread: 90,
  sparkColor: '#c8f4ff',
  glowSize: 34,
  glowAlpha: 0.7,
  glowColor: '#d8fbff',
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const FSW_RANGES: Record<Exclude<keyof FlurrySwingConfig, 'slashColor' | 'sparkColor' | 'glowColor'>, [number, number, number]> = {
  power: [0.2, 3, 0.05],
  slashCount: [0, 8, 1],
  slashSize: [8, 120, 1],
  slashLife: [80, 900, 10],
  slashSpeed: [0, 700, 10],
  slashSpread: [0, 180, 1],
  sparkCount: [0, 40, 1],
  sparkSpeed: [0, 900, 10],
  sparkLife: [80, 900, 10],
  sparkSize: [2, 24, 0.5],
  sparkSpread: [0, 360, 1],
  glowSize: [0, 120, 1],
  glowAlpha: [0, 1, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const FSW_DESC: Record<keyof FlurrySwingConfig, string> = {
  power: 'Overall intensity — scales counts, sizes, and speeds.',
  slashCount: 'Wind-blades — how many crescent slashes at the hit. 0 = none.',
  slashSize: 'Wind-blades — drawn size (px).',
  slashLife: 'Wind-blades — how long each slash lasts (ms).',
  slashSpeed: 'Wind-blades — how fast each is flung outward (px/s).',
  slashSpread: 'Wind-blades — angular scatter around the blow direction (deg).',
  slashColor: 'Wind-blades — colour.',
  sparkCount: 'Sparkles — how many bright motes burst out. 0 = none.',
  sparkSpeed: 'Sparkles — initial speed (px/s).',
  sparkLife: 'Sparkles — mote lifetime (ms).',
  sparkSize: 'Sparkles — drawn mote size (px).',
  sparkSpread: 'Sparkles — cone width around the blow direction (deg). 360 = all around.',
  sparkColor: 'Sparkles — colour.',
  glowSize: 'Glow — soft contact-flash diameter (px). 0 = no glow.',
  glowAlpha: 'Glow — peak opacity.',
  glowColor: 'Glow — colour.',
};

/** Keys grouped by control type for the tuner UI. */
export const FSW_NUM_KEYS = [
  'power',
  'slashCount', 'slashSize', 'slashLife', 'slashSpeed', 'slashSpread',
  'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'sparkSpread',
  'glowSize', 'glowAlpha',
] as const;
export const FSW_COLOR_KEYS = ['slashColor', 'sparkColor', 'glowColor'] as const;

const KEY = 'ascent.flurryswingfx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: FlurrySwingConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<FlurrySwingConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getFlurrySwingConfig(): FlurrySwingConfig {
  return cfg;
}
export function setFlurrySwingValue(key: keyof FlurrySwingConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetFlurrySwingConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
