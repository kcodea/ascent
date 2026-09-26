/**
 * The REBIRTH look (owner 2026-09-25: "similar to rise, but less intrusive, more thin and less haze … a phoenix
 * rebirth style thing. when it rebirths it should have a little flame animation"; recoloured the same day: "make
 * rebirth a blue effect instead of orange, could be blue and white fire still" — deep cobalt → cyan → a white-hot
 * core, kept clear of Rise's aqua-green, Ward's gold and the Time Ancient's azure). The 🔥 Rebirth tuner's values:
 *  · the IDLE state on every card with Rebirth (`RB`): a thin ember rim on the oval whose opacity breathes (a static
 *    pre-rendered ring, `kwglow`-style: opacity only), and a few ember motes rising from the base (transform/opacity
 *    only, no blur);
 *  · the TRIGGER: when a minion rebirths in combat, the one-shot `rebirth-flame` Pixi def (fx/defs/rebirth-flame.json)
 *    at its slot, scaled by `burstScale`, plus a gap-gated flame cue.
 * Reflected onto :root as `--rb-*` vars (CSS reads them live). Dev-persisted; production uses the defaults.
 */
export interface RebirthConfig {
  /** Rising ember motes per card (0 hides them). Applies to cards drawn after the change. */
  emberCount: number;
  /** Peak ember opacity. */
  emberAlpha: number;
  /** Ember size (% of the card width). */
  emberSize: number;
  /** Peak opacity of the thin ember rim. */
  rimAlpha: number;
  /** Rim thickness (design px). */
  rimWidth: number;
  /** The breathe cycle (s) of the rim. */
  rimPulse: number;
  /** Hot colour (ember cores, rim inner). */
  colorA: string;
  /** Deep colour (ember tails, rim outer). */
  colorB: string;
  /** The rebirth flame burst's size (×). */
  burstScale: number;
  /** The flame cue's gain (0 mutes). */
  soundGain: number;
}

const DEFAULTS: RebirthConfig = {
  emberCount: 6,
  emberAlpha: 0.85,
  emberSize: 7,
  rimAlpha: 0.9,
  rimWidth: 3.5,
  rimPulse: 2.8,
  colorA: '#9fe6ff',
  colorB: '#2350e6',
  burstScale: 1,
  soundGain: 0.6,
};
export { DEFAULTS as REBIRTH_DEFAULTS };

export const REBIRTH_RANGES: Record<Exclude<keyof RebirthConfig, 'colorA' | 'colorB'>, [number, number, number]> = {
  emberCount: [0, 14, 1],
  emberAlpha: [0, 1, 0.01],
  emberSize: [2, 16, 0.5],
  rimAlpha: [0, 1, 0.01],
  rimWidth: [0, 8, 0.25],
  rimPulse: [0.6, 8, 0.1],
  burstScale: [0.3, 2.5, 0.05],
  soundGain: [0, 1, 0.01],
};

const KEY = 'ascent.rebirth';
let cfg: RebirthConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<RebirthConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getRebirthConfig(): RebirthConfig { return cfg; }

export function applyRebirthVars(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--rb-ember-a', String(cfg.emberAlpha));
  r.setProperty('--rb-ember-size', `${cfg.emberSize}%`);
  r.setProperty('--rb-rim-a', String(cfg.rimAlpha));
  r.setProperty('--rb-rim-w', String(cfg.rimWidth));
  r.setProperty('--rb-rim-pulse', `${cfg.rimPulse}s`);
  r.setProperty('--rb-a', cfg.colorA);
  r.setProperty('--rb-b', cfg.colorB);
}

export function setRebirthValue(key: keyof RebirthConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyRebirthVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetRebirthConfig(): void {
  cfg = { ...DEFAULTS };
  applyRebirthVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
applyRebirthVars();
