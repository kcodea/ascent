/**
 * THE HERO DUEL — the post-combat sequence: the damage tallies off the winner's surviving board, lands on that
 * hero as an attack pill, and the hero winds up and lunges at the loser (owner ask 2026-08-25).
 *
 * This config owns the parts of that sequence THIS code authored: where the foe's portrait sits, how the pill
 * is sized and placed, and the beat timings between tally → pill → swing → settle.
 *
 * It deliberately does NOT duplicate the lunge's own internals. The wind-up curve, the strike ease bands, the
 * lead tilt, the defender spin and the impact FX/sounds are Mike's authored work and already have their own
 * tuners (🗡️ Lunge, ⚡ Crit FX, and the impact defs in the FX workbench) — the hero strike runs through those
 * exact channels on purpose, so tuning them there tunes this too. What lives here is the sequence around them.
 *
 * Config is localStorage-persisted in DEV only; PRODUCTION renders DEFAULTS (Layout Lab convention). The
 * placement values reflect to `--hd-*` CSS vars, whose fallbacks in styles.css MUST mirror DEFAULTS.
 */
export interface HeroDuelConfig {
  /** Opponent portrait — scale, and px offsets from its Refresh-button anchor. */
  oppScale: number;
  oppX: number;
  oppY: number;
  /** The attack pill — scale, and px offsets from the portrait's bottom centre. */
  pillScale: number;
  pillX: number;
  pillY: number;
  /** Gap (ms) between each tallied number leaving its card. */
  tallyStagger: number;
  /** Flight time (ms) of a tallied number to the counter. */
  tallyFly: number;
  /** Beat (ms) the pill holds on the winner before the wind-up begins. */
  pillHold: number;
  /** Swing speed multiplier — feeds the lunge's own speed scaling (1 = the combat speed the fight ran at). */
  strikeSpeed: number;
  /** How hard the blow reads: scales the damage handed to `hitPower`, i.e. the impact's weight/FX intensity. */
  impactPower: number;
  /** Settle (ms) held after the blow lands before the pill retires and the sequence ends. */
  settleMs: number;
}

// Mirror the styles.css fallbacks. Timings are the shipped feel; placement is the anchor that reads correctly
// against the board frame at the default stage scale.
const DEFAULTS: HeroDuelConfig = {
  oppScale: 1,
  oppX: 0,
  oppY: 0,
  pillScale: 1,
  pillX: 0,
  pillY: 0,
  tallyStagger: 130,
  tallyFly: 430,
  pillHold: 260,
  strikeSpeed: 1,
  impactPower: 1,
  settleMs: 620,
};

export const HERO_DUEL_RANGES: Record<keyof HeroDuelConfig, [number, number, number]> = {
  oppScale: [0.4, 2.2, 0.01],
  oppX: [-500, 500, 1],
  oppY: [-500, 500, 1],
  pillScale: [0.4, 3, 0.01],
  pillX: [-120, 120, 1],
  pillY: [-120, 120, 1],
  tallyStagger: [0, 500, 5],
  tallyFly: [80, 1500, 10],
  pillHold: [0, 1500, 10],
  strikeSpeed: [0.25, 3, 0.05],
  impactPower: [0.2, 4, 0.05],
  settleMs: [0, 2500, 10],
};

export const HERO_DUEL_DESC: Record<keyof HeroDuelConfig, string> = {
  oppScale: "Size of the opponent's portrait that drops in for the fight.",
  oppX: "Move the opponent's portrait horizontally from its Refresh-button anchor.",
  oppY: "Move the opponent's portrait vertically from its anchor.",
  pillScale: 'Size of the attack pill the winning hero carries.',
  pillX: 'Move the attack pill horizontally on the portrait.',
  pillY: 'Move the attack pill vertically on the portrait.',
  tallyStagger: 'Gap between each damage number leaving its card.',
  tallyFly: 'How long a damage number takes to reach the counter.',
  pillHold: 'Pause after the pill appears, before the hero winds up.',
  strikeSpeed: 'Swing speed. Higher is faster; feeds the lunge’s own speed scaling.',
  impactPower: 'How heavy the blow reads — scales the impact FX intensity and shake.',
  settleMs: 'Hold after the blow lands, before the pill retires and the shop returns.',
};

export { DEFAULTS as HERO_DUEL_DEFAULTS };

const KEY = 'ascent.heroduel';
let cfg: HeroDuelConfig = (() => {
  if (typeof localStorage === 'undefined' || !import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HeroDuelConfig>) : {}) };
  } catch { return { ...DEFAULTS }; }
})();

export function getHeroDuelConfig(): HeroDuelConfig { return cfg; }

/** Reflect the PLACEMENT values onto :root as `--hd-*`. Timings are read directly by the sequence, not by CSS. */
export function applyHeroDuelVars(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--hd-opp-s', String(cfg.oppScale));
  r.setProperty('--hd-opp-x', `${cfg.oppX}px`);
  r.setProperty('--hd-opp-y', `${cfg.oppY}px`);
  r.setProperty('--hd-pill-s', String(cfg.pillScale));
  r.setProperty('--hd-pill-x', `${cfg.pillX}px`);
  r.setProperty('--hd-pill-y', `${cfg.pillY}px`);
}

export function setHeroDuelValue(key: keyof HeroDuelConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyHeroDuelVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroDuelConfig(): void {
  cfg = { ...DEFAULTS };
  applyHeroDuelVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

applyHeroDuelVars();
