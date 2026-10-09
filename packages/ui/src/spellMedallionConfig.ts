import type { TunerControl, TunerSpec } from './tunerSchema';

/** `#rrggbb` + a 0..1 strength → a `rgba(r,g,b,a)` string, so a colour-picker hex and a strength slider can drive
 *  one colour. A malformed hex falls back to black. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const v = Number.isFinite(n) ? n : 0;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

/**
 * DEV tuner for the 💠 SPELL / RUBY / GIFT MEDALLIONS — the crystal art that replaced the purple "✦ Spell" /
 * "◆ Ruby" type pill (owner 2026-10-09). EVERY control is per-medallion (owner call 2026-10-09): each of the three
 * has its own size + placement, drop shadow and coloured glow. Layered on TOP of the pill's seat
 * (`.ctype.spell.spellmed` in styles.css, itself moved by the 🏷️ Card Pills tuner's spell nudge). Offsets are
 * card-relative (× --ccw / --ccw-ref) so the medallion holds on every screen. One global setting; ships via
 * DEFAULTS. Fallbacks in styles.css MUST mirror DEFAULTS.
 */
const KINDS = ['spell', 'ruby', 'gift'] as const;
type Kind = (typeof KINDS)[number];

type NumField = 'Size' | 'Dx' | 'Dy' | 'ShadowX' | 'ShadowY' | 'ShadowBlur' | 'ShadowStrength' | 'GlowSize' | 'GlowStrength';
type ColorField = 'ShadowColor' | 'GlowColor';

export type SpellMedallionConfig =
  { [K in `${Kind}${NumField}`]: number } & { [K in `${Kind}${ColorField}`]: string };

/** One medallion's shipped look. */
const seat = (k: Kind, v: { size: number; dx: number; dy: number; glowColor: string; glowSize: number; glowStrength: number }) => ({
  [`${k}Size`]: v.size, [`${k}Dx`]: v.dx, [`${k}Dy`]: v.dy,
  [`${k}ShadowX`]: 0, [`${k}ShadowY`]: 4.5, [`${k}ShadowBlur`]: 6.5, [`${k}ShadowColor`]: '#000000', [`${k}ShadowStrength`]: 1,
  [`${k}GlowColor`]: v.glowColor, [`${k}GlowSize`]: v.glowSize, [`${k}GlowStrength`]: v.glowStrength,
});

/** Shipped values — owner-tuned, all three medallions (2026-10-09). CSS fallbacks in styles.css mirror these. */
const DEFAULTS = {
  ...seat('spell', { size: 0.94, dx: 4, dy: 0, glowColor: '#4df3ff', glowSize: 2, glowStrength: 0 }),
  ...seat('ruby', { size: 0.84, dx: 3, dy: -3, glowColor: '#ff3b4a', glowSize: 3, glowStrength: 1 }),
  ...seat('gift', { size: 0.74, dx: 4, dy: -3, glowColor: '#c45bff', glowSize: 9, glowStrength: 0.68 }),
} as SpellMedallionConfig;

const COLOR_KEYS: ReadonlySet<string> = new Set(KINDS.flatMap((k) => [`${k}ShadowColor`, `${k}GlowColor`]));

export { DEFAULTS as SPELL_MEDALLION_DEFAULTS };

const KEY = 'ascent.spellmedallion';

let cfg: SpellMedallionConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULTS };
    // Only known keys — an older save (the shared shadow/glow keys) must not leak into Copy's JSON.
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(DEFAULTS) as (keyof SpellMedallionConfig)[]) {
        const v = (saved as Record<string, unknown>)[k];
        if (v !== undefined) (out as Record<string, unknown>)[k] = v;
      }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getSpellMedallionConfig(): SpellMedallionConfig {
  return cfg;
}

/** Push the dials to the `--smed-<kind>-*` CSS custom properties `styles.css` reads. Offsets and blur radii get a
 *  `px` unit; sizes are unitless multipliers; each colour folds its strength in via `hexToRgba`. */
export function applySpellMedallionVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const k of KINDS) {
    root.setProperty(`--smed-${k}-size`, String(cfg[`${k}Size`]));
    root.setProperty(`--smed-${k}-dx`, `${cfg[`${k}Dx`]}px`);
    root.setProperty(`--smed-${k}-dy`, `${cfg[`${k}Dy`]}px`);
    root.setProperty(`--smed-${k}-shadow-x`, `${cfg[`${k}ShadowX`]}px`);
    root.setProperty(`--smed-${k}-shadow-y`, `${cfg[`${k}ShadowY`]}px`);
    root.setProperty(`--smed-${k}-shadow-blur`, `${cfg[`${k}ShadowBlur`]}px`);
    root.setProperty(`--smed-${k}-shadow-color`, hexToRgba(cfg[`${k}ShadowColor`], cfg[`${k}ShadowStrength`]));
    root.setProperty(`--smed-${k}-glow-size`, `${cfg[`${k}GlowSize`]}px`);
    root.setProperty(`--smed-${k}-glow-color`, hexToRgba(cfg[`${k}GlowColor`], cfg[`${k}GlowStrength`]));
  }
}

export function setSpellMedallionValue(key: keyof SpellMedallionConfig, value: number | string): void {
  cfg = { ...cfg, [key]: COLOR_KEYS.has(key) ? String(value) : Number(value) };
  applySpellMedallionVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetSpellMedallionConfig(): void {
  cfg = { ...DEFAULTS };
  applySpellMedallionVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

type K = Extract<keyof SpellMedallionConfig, string>;

/** The eleven controls for one medallion, in three sections (placement / drop shadow / glow). */
function controlsFor(k: Kind, name: string): TunerControl<K>[] {
  const g = (section: string): string => `${name} — ${section}`;
  return [
    { key: `${k}Size`, label: 'Size', unit: '×', hint: `${name} medallion scale, as a multiple of its base size.`, group: g('placement'), min: 0.2, max: 3, step: 0.01 },
    { key: `${k}Dx`, label: 'Offset X', unit: 'px', hint: 'Nudge left/right (card-relative, so it holds on every screen).', group: g('placement'), min: -120, max: 120, step: 0.5 },
    { key: `${k}Dy`, label: 'Offset Y', unit: 'px', hint: 'Nudge up/down.', group: g('placement'), min: -160, max: 160, step: 0.5 },
    { key: `${k}ShadowColor`, label: 'Shadow colour', hint: `Colour of the ${name} drop shadow.`, group: g('drop shadow'), kind: 'color', min: 0, max: 0, step: 0 },
    { key: `${k}ShadowX`, label: 'Shadow X', unit: 'px', hint: 'Horizontal shadow offset.', group: g('drop shadow'), min: -20, max: 20, step: 0.5 },
    { key: `${k}ShadowY`, label: 'Shadow Y', unit: 'px', hint: 'Vertical shadow offset.', group: g('drop shadow'), min: -20, max: 20, step: 0.5 },
    { key: `${k}ShadowBlur`, label: 'Shadow blur', unit: 'px', hint: 'Shadow softness — 0 is a hard edge.', group: g('drop shadow'), min: 0, max: 30, step: 0.5 },
    { key: `${k}ShadowStrength`, label: 'Shadow strength', unit: 'opacity', hint: '0 hides the shadow, 1 is fully opaque.', group: g('drop shadow'), min: 0, max: 1, step: 0.01 },
    { key: `${k}GlowColor`, label: 'Glow colour', hint: `Colour of the glow around the ${name} medallion.`, group: g('glow'), kind: 'color', min: 0, max: 0, step: 0 },
    { key: `${k}GlowSize`, label: 'Glow size', unit: 'px', hint: 'Glow blur radius — 0 hides it.', group: g('glow'), min: 0, max: 40, step: 0.5 },
    { key: `${k}GlowStrength`, label: 'Glow strength', unit: 'opacity', hint: '0 hides the glow, 1 is fully opaque.', group: g('glow'), min: 0, max: 1, step: 0.01 },
  ];
}

const controls: TunerControl<K>[] = [
  ...controlsFor('spell', 'Shop Spell'),
  ...controlsFor('ruby', 'Ruby'),
  ...controlsFor('gift', 'Gift'),
];

export const SPEC: TunerSpec<SpellMedallionConfig> = {
  id: 'spellmedallion',            // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Spell Medallions',
  note: 'dev · live · Shop Spell / Ruby / Gift',
  read: getSpellMedallionConfig,
  write: (key, value) => setSpellMedallionValue(key, value),
  writeColor: (key, value) => setSpellMedallionValue(key, value),
  reset: resetSpellMedallionConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so the medallions are live before the first paint (the equipSlotConfig-era pattern).
applySpellMedallionVars();
