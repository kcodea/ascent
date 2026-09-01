/**
 * Tunable placement for the RUNE SHEEN — three glossy discs laid on top of the owned-rune nodes in the badge
 * row (`QuestBadges.tsx`). The source art was ONE image of three discs (owner-supplied); it is sliced into
 * three separate webps (`frames/rune-sheen-1|2|3.webp`) so each disc is an independent overlay with its own
 * placement/size/opacity/blend (owner ask 2026-08-15). Purely decorative; pointer-events off.
 *
 * Same architecture as the other layout configs: dev-only localStorage persistence, values pushed onto `:root`
 * as `--rshN-*` custom properties that the `.rune-sheen-N` rules read WITH a fallback — so PRODUCTION renders
 * the shipped look with no JS. Shipping a look means pasting the JSON into DEFAULTS *and* mirroring the
 * styles.css fallbacks.
 */

/** CSS `mix-blend-mode` values offered per disc (owner ask 2026-08-15). */
export const RSH_BLENDS = ['normal', 'overlay', 'color-dodge', 'screen', 'hard-light'] as const;
export type RuneSheenBlend = (typeof RSH_BLENDS)[number];

/** One disc's controls. */
export interface RuneSheenDisc {
  /** Horizontal offset (design px × --u) from the badge row's left edge. */
  x: number;
  /** Vertical offset (design px × --u). */
  y: number;
  /** Width (design px × --u); height follows the art's native aspect. */
  w: number;
  /** Opacity (0 = hidden, 1 = full). */
  o: number;
  /** How the disc blends with the rune node beneath it (CSS mix-blend-mode). */
  blend: RuneSheenBlend;
}

// Flat config: three discs × five fields. Flat (not nested) so the schema-driven tuner can address each field
// by a single key.
export interface RuneSheenConfig {
  c1x: number; c1y: number; c1w: number; c1o: number; c1blend: RuneSheenBlend;
  c2x: number; c2y: number; c2w: number; c2o: number; c2blend: RuneSheenBlend;
  c3x: number; c3y: number; c3w: number; c3o: number; c3blend: RuneSheenBlend;
  // The CHAINS over the LOCKED third rune slot (owner ask 2026-08-19): shown when the run can't reach a 3rd
  // rune (see `canReachThirdRune` in QuestBadges). Placement only — WHETHER it shows is game logic, not tuned.
  chx: number; chy: number; chw: number;
}

// Defaults measured against the live 3-rune stagger (2026-08-15): each disc centred on its rune node, matching
// the alignment the single combined image had before the split.
// Each disc counter-scales by 1/--qb-s in its own transform (see styles.css), so its RENDERED size is
// `w × --u` regardless of the Quest-nodes scale. w is baked ×1.4 (to keep the owner's size) and x/y are
// centre-adjusted by −9 (half the size growth) so the counter-scale, which pivots on the disc centre, keeps
// each disc seated where the owner placed it (owner 2026-08-15).
// The sheen is glued to the rune nodes at a FIXED size: each disc counter-scales `--qb-s` and sizes in
// `--u-base` (immune to both the Quest-nodes Scale AND the global UI-scale sliders), while its translate rides
// the row + per-node offsets so it stays on the badges as you tune the layout (see styles.css). x/y are the
// per-disc SLOT nudge (design px × --u); w is the disc width (design px × --u-base). Calibrated to the baked
// quest-node layout (owner 2026-08-15).
const DEFAULTS: RuneSheenConfig = {
  c1x: -1, c1y: -1, c1w: 52, c1o: 1, c1blend: 'hard-light',
  c2x: 62, c2y: -1, c2w: 52, c2o: 1, c2blend: 'hard-light',
  c3x: 132, c3y: -3, c3w: 52, c3o: 1, c3blend: 'hard-light',
  chx: 131, chy: -3, chw: 54, // chains seated over the 3rd rune slot (owner-tuned 2026-08-19, re-tuned 2026-08-29)
};

/** Which keys are the blend SELECTs (string), so the numeric maps below can exclude them. */
export const RSH_BLEND_KEYS = ['c1blend', 'c2blend', 'c3blend'] as const;
export type RshBlendKey = (typeof RSH_BLEND_KEYS)[number];
export type RshNumKey = Exclude<keyof RuneSheenConfig, RshBlendKey>;

/** Numeric slider bounds for the DEV tuner — [min, max, step] per key. */
export const RSH_RANGES: Record<RshNumKey, [number, number, number]> = {
  c1x: [-200, 400, 1], c1y: [-200, 200, 1], c1w: [10, 300, 1], c1o: [0, 1, 0.01],
  c2x: [-200, 400, 1], c2y: [-200, 200, 1], c2w: [10, 300, 1], c2o: [0, 1, 0.01],
  c3x: [-200, 400, 1], c3y: [-200, 200, 1], c3w: [10, 300, 1], c3o: [0, 1, 0.01],
  chx: [-200, 400, 1], chy: [-200, 200, 1], chw: [10, 300, 1],
};

/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as RSH_DEFAULTS };

const KEY = 'ascent.runesheen';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: RuneSheenConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<RuneSheenConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getRuneSheenConfig(): RuneSheenConfig {
  return cfg;
}

/** Reflect everything onto :root as `--rshN-*`. */
export function applyRuneSheenVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const n of [1, 2, 3] as const) {
    root.setProperty(`--rsh${n}-x`, String(cfg[`c${n}x`]));
    root.setProperty(`--rsh${n}-y`, String(cfg[`c${n}y`]));
    root.setProperty(`--rsh${n}-w`, String(cfg[`c${n}w`]));
    root.setProperty(`--rsh${n}-o`, String(cfg[`c${n}o`]));
    root.setProperty(`--rsh${n}-blend`, cfg[`c${n}blend`]);
  }
  root.setProperty('--rch-x', String(cfg.chx));
  root.setProperty('--rch-y', String(cfg.chy));
  root.setProperty('--rch-w', String(cfg.chw));
}

// One setter for both channels: the numeric sliders and the blend SELECTs (a string).
export function setRuneSheenValue(key: keyof RuneSheenConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value } as RuneSheenConfig;
  applyRuneSheenVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetRuneSheenConfig(): void {
  cfg = { ...DEFAULTS };
  applyRuneSheenVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
applyRuneSheenVars();
