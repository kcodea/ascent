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
  // Summary pill (.combatsummary) — X/Y are px offsets × --scale from its top-centre anchor
  sumX: number; sumY: number;
  sumSize: number; sumRadius: number; sumBorderW: number;
  sumBg: string; sumText: string; sumBorder: string;
  // End Combat pill (.etbwrap.ready .etb-tip) — X/Y are raw px (an individual `translate:` on the tip)
  endX: number; endY: number;
  endSize: number; endRadius: number; endBorderW: number;
  endBg: string; endText: string; endBorder: string;
  // Skip button (.combathud-skip) — X/Y are px offsets × --scale; size/radius are × --u multipliers
  skipX: number; skipY: number;
  skipSize: number; skipRadius: number; skipBorderW: number;
  skipBg: string; skipText: string; skipBorder: string;
}

// Mirror of the shipped styles.css look (theme tokens resolved to hex so the picker starts on the real colour):
// the gold pill border is color-mix(--gold 55%, #000) ≈ #6e5019; --acc #f0902e / --acc-dk #c46f17 drive Skip.
// Owner-tuned + locked 2026-08-29 (dev 🎚️ Combat Controls tuner). Mirrored into the styles.css `--cc-*`
// fallbacks. X/Y are board-pinned (Summary/Skip × --scale off the stage box; End Combat rides the diamond).
const DEFAULTS: CombatCtlConfig = {
  sumX: 89, sumY: 57,
  sumSize: 23, sumRadius: 30, sumBorderW: 1,
  sumBg: '#006fd6', sumText: '#f2f2f2', sumBorder: '#b07047',
  endX: -4, endY: 0,
  endSize: 12, endRadius: 10, endBorderW: 1,
  endBg: '#002242', endText: '#f2f2f2', endBorder: '#b07047',
  skipX: -95, skipY: 49,
  skipSize: 18, skipRadius: 30, skipBorderW: 1,
  skipBg: '#006fd6', skipText: '#f2f2f2', skipBorder: '#b07047',
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key (the six colour keys are pickers). */
export const CC_RANGES: Record<
  Exclude<keyof CombatCtlConfig, 'sumBg' | 'sumText' | 'sumBorder' | 'endBg' | 'endText' | 'endBorder' | 'skipBg' | 'skipText' | 'skipBorder'>,
  [number, number, number]
> = {
  sumX: [-500, 500, 1], sumY: [-500, 500, 1],
  sumSize: [8, 32, 0.5], sumRadius: [0, 30, 1], sumBorderW: [0, 8, 0.5],
  endX: [-500, 500, 1], endY: [-500, 500, 1],
  endSize: [8, 32, 0.5], endRadius: [0, 30, 1], endBorderW: [0, 8, 0.5],
  skipX: [-500, 500, 1], skipY: [-500, 500, 1],
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
  // Summary pill (raw px). X/Y offsets are px, multiplied by --scale in styles.css.
  s.setProperty('--cc-sum-x', `${cfg.sumX}px`);
  s.setProperty('--cc-sum-y', `${cfg.sumY}px`);
  s.setProperty('--cc-sum-size', `${cfg.sumSize}px`);
  s.setProperty('--cc-sum-radius', `${cfg.sumRadius}px`);
  s.setProperty('--cc-sum-bw', `${cfg.sumBorderW}px`);
  s.setProperty('--cc-sum-bg', cfg.sumBg);
  s.setProperty('--cc-sum-text', cfg.sumText);
  s.setProperty('--cc-sum-border', cfg.sumBorder);
  // End Combat pill (raw px). X/Y are raw px — an individual `translate:` on the tip (composes with its transform).
  s.setProperty('--cc-end-x', `${cfg.endX}px`);
  s.setProperty('--cc-end-y', `${cfg.endY}px`);
  s.setProperty('--cc-end-size', `${cfg.endSize}px`);
  s.setProperty('--cc-end-radius', `${cfg.endRadius}px`);
  s.setProperty('--cc-end-bw', `${cfg.endBorderW}px`);
  s.setProperty('--cc-end-bg', cfg.endBg);
  s.setProperty('--cc-end-text', cfg.endText);
  s.setProperty('--cc-end-border', cfg.endBorder);
  // Skip button — size/radius are UNITLESS × --u multipliers (the CSS multiplies by --u); border width is px.
  // X/Y offsets are px, multiplied by --scale in styles.css.
  s.setProperty('--cc-skip-x', `${cfg.skipX}px`);
  s.setProperty('--cc-skip-y', `${cfg.skipY}px`);
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
