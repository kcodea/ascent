/**
 * DEV-only look tuner for the three COMBAT CONTROL chips — the Summary pill, the End Combat pill, and the Skip
 * button (all top-of-board during the replay). Owner ask 2026-08-29: dial each one's shape, colours, outline and
 * text size by eye.
 *
 * Same architecture as the other look tuners (`runeSheenConfig`, `heroDuelConfig`): dev-only localStorage
 * persistence, values reflected onto `:root` as `--cc-*` custom properties that styles.css reads WITH a fallback
 * equal to the shipped value — so PRODUCTION renders the shipped look with no JS, and applying the DEFAULTS is a
 * visual no-op. Shipping a dialled look means pasting the JSON into DEFAULTS *and* mirroring the styles.css
 * `--cc-*` fallbacks.
 *
 * SCOPES. The Summary pill (`.combatsummary`) and Skip button (`.combathud-skip`) are combat-only elements, so
 * their vars ride the base rule. The "End Combat pill" is the End-Turn button's tooltip (`.etb-tip`) in its
 * `.ready` (combat-done) state — the SAME element that reads "End your turn" in recruit — so its vars are scoped
 * to `.etbwrap.ready .etb-tip`, leaving the recruit End-Turn tip untouched.
 *
 * UNITS. Summary + End Combat sizes/radii are RAW px (those pills are authored in raw px). The Skip button is
 * authored in `--u` (it scales with the board), so its size/radius knobs are UNITLESS `× --u` multipliers, not
 * px — the border width is px on all three.
 */
export interface CombatCtlConfig {
  // Summary pill (.combatsummary)
  sumSize: number; sumRadius: number; sumBorderW: number;
  sumBg: string; sumText: string; sumBorder: string;
  // End Combat pill (.etbwrap.ready .etb-tip)
  endSize: number; endRadius: number; endBorderW: number;
  endBg: string; endText: string; endBorder: string;
  // Skip button (.combathud-skip) — size/radius are × --u multipliers
  skipSize: number; skipRadius: number; skipBorderW: number;
  skipBg: string; skipText: string; skipBorder: string;
}

// Mirror of the shipped styles.css look (theme tokens resolved to hex so the picker starts on the real colour):
// the gold pill border is color-mix(--gold 55%, #000) ≈ #6e5019; --acc #f0902e / --acc-dk #c46f17 drive Skip.
const DEFAULTS: CombatCtlConfig = {
  sumSize: 14, sumRadius: 12, sumBorderW: 2,
  sumBg: '#211812', sumText: '#f4ecdb', sumBorder: '#6e5019',
  endSize: 13.5, endRadius: 11, endBorderW: 2,
  endBg: '#211812', endText: '#f4ecdb', endBorder: '#6e5019',
  skipSize: 15, skipRadius: 11, skipBorderW: 2,
  skipBg: '#f0902e', skipText: '#ffffff', skipBorder: '#c46f17',
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key (the six colour keys are pickers). */
export const CC_RANGES: Record<
  Exclude<keyof CombatCtlConfig, 'sumBg' | 'sumText' | 'sumBorder' | 'endBg' | 'endText' | 'endBorder' | 'skipBg' | 'skipText' | 'skipBorder'>,
  [number, number, number]
> = {
  sumSize: [8, 32, 0.5], sumRadius: [0, 30, 1], sumBorderW: [0, 8, 0.5],
  endSize: [8, 32, 0.5], endRadius: [0, 30, 1], endBorderW: [0, 8, 0.5],
  skipSize: [8, 30, 0.5], skipRadius: [0, 30, 1], skipBorderW: [0, 8, 0.5],
};

/** The shipped values, exported so the tuner can mark which controls you have moved. */
export { DEFAULTS as COMBAT_CTL_DEFAULTS };

const KEY = 'ascent.combatctl';
let cfg: CombatCtlConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CombatCtlConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** Push the config onto :root as the `--cc-*` custom properties styles.css reads. Values map 1:1 to the CSS
 *  fallbacks, so applying the defaults is a visual no-op. */
export function applyCombatCtlVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  // Summary pill (raw px).
  s.setProperty('--cc-sum-size', `${cfg.sumSize}px`);
  s.setProperty('--cc-sum-radius', `${cfg.sumRadius}px`);
  s.setProperty('--cc-sum-bw', `${cfg.sumBorderW}px`);
  s.setProperty('--cc-sum-bg', cfg.sumBg);
  s.setProperty('--cc-sum-text', cfg.sumText);
  s.setProperty('--cc-sum-border', cfg.sumBorder);
  // End Combat pill (raw px).
  s.setProperty('--cc-end-size', `${cfg.endSize}px`);
  s.setProperty('--cc-end-radius', `${cfg.endRadius}px`);
  s.setProperty('--cc-end-bw', `${cfg.endBorderW}px`);
  s.setProperty('--cc-end-bg', cfg.endBg);
  s.setProperty('--cc-end-text', cfg.endText);
  s.setProperty('--cc-end-border', cfg.endBorder);
  // Skip button — size/radius are UNITLESS × --u multipliers (the CSS multiplies by --u); border width is px.
  s.setProperty('--cc-skip-size', `${cfg.skipSize}`);
  s.setProperty('--cc-skip-radius', `${cfg.skipRadius}`);
  s.setProperty('--cc-skip-bw', `${cfg.skipBorderW}px`);
  s.setProperty('--cc-skip-bg', cfg.skipBg);
  s.setProperty('--cc-skip-text', cfg.skipText);
  s.setProperty('--cc-skip-border', cfg.skipBorder);
}

export function getCombatCtlConfig(): CombatCtlConfig {
  return cfg;
}
export function setCombatCtlValue(key: keyof CombatCtlConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyCombatCtlVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetCombatCtlConfig(): void {
  cfg = { ...DEFAULTS };
  applyCombatCtlVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Apply at module load — dev only (the tuner is dev-only; production keeps the CSS fallbacks = the shipped look).
if (import.meta.env.DEV) applyCombatCtlVars();
