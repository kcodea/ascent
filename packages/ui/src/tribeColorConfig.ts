/**
 * TRIBE COLOURS (owner ask 2026-09-14: "a color picker tuner for celestials and spirits for me to add their
 * colors in"). Every card's accent `--c` is `var(--t-<tribe>)`, so a tribe with no token renders its tribe
 * label, bold rules text and medallion glyph unpainted — which is exactly what Celestial and Spirit did until
 * now: the two set-3 tribes were never given a hue.
 *
 * HOW IT WORKS. Same contract as `uiThemeConfig`: values are pushed onto `:root` as the `--t-<tribe>` custom
 * properties, and styles.css declares each token with the shipped value, so with no override the look is
 * byte-identical and production (which never runs the dev menu) is untouched. The tuner writes localStorage,
 * which is per-browser — TO SHIP a colour, paste it into `DEFAULTS` below AND the matching `--t-<tribe>` line
 * at the top of styles.css (the CSS is what the packaged exe reads).
 */
import type { Tribe } from '@game/core';

export type TribeColorConfig = Record<Tribe, string>;

/** The shipped hues — MUST equal the `--t-*` tokens at the top of styles.css. */
const DEFAULTS: TribeColorConfig = {
  // The two set-3 tribes — the owner's picks (2026-09-14): Celestial a moonlit periwinkle, Spirit a warm
  // lantern peach.
  celestial: '#96a0c5',
  spirit: '#f8cd90',
  // The eight that already had a hue, unchanged.
  beast: '#4ea83b', dragon: '#ffffff', mech: '#27a9dd', undead: '#22b8a8', demon: '#b15cf0', neutral: '#9a8d79',
  dwarf: '#f0c33c', kobold: '#e8763a',
};
export { DEFAULTS as TRIBE_COLOR_DEFAULTS };

const KEY = 'ascent.tribecolors';
let cfg: TribeColorConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TribeColorConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

const HEX = /^#[0-9a-f]{6}$/i;

/** Push every tribe hue onto :root. A half-typed hex is skipped (the CSS token keeps painting) rather than
 *  blanking a whole tribe mid-edit. */
export function applyTribeColorConfig(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  for (const [tribe, hex] of Object.entries(cfg)) {
    if (HEX.test(hex)) s.setProperty(`--t-${tribe}`, hex);
    else s.removeProperty(`--t-${tribe}`);
  }
}

export function getTribeColorConfig(): TribeColorConfig {
  return cfg;
}

export function setTribeColor(tribe: Tribe, hex: string): void {
  cfg = { ...cfg, [tribe]: hex };
  persist();
}

export function resetTribeColorConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyTribeColorConfig();
}

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyTribeColorConfig();
}

applyTribeColorConfig();
