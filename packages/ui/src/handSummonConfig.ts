/**
 * The SUMMONED-FROM-HAND look (R-HANDSUMMON-FX-01): every timing and size of the lift and the landing. Owner asks
 * 2026-10-23: "put the hand summon options in a tuner for me", then "use the lift and land animation, but smooth it
 * out and make it overall less clunky and way more seamless" (the Quick fly and Spirit pull trials were dropped).
 *
 * Read LIVE by `handSummonFx.ts` at every launch, so a tuner change applies to the very next summon (no reload).
 * Dev-persisted under `ascent.handSummon`; production always uses DEFAULTS, so the baked look only moves when the
 * owner's copied values are pasted in here.
 */
export interface HandSummonConfig {
  /** The lifting copy's whole path, from the hand slot until it has dissolved (ms). */
  pathMs: number;
  /** How high the card lifts off its slot, as a share of its height. */
  riseHeight: number;
  /** How large it swells as it lifts (×, the peak). */
  riseScale: number;
  /** How far toward the board slot it travels before it has dissolved (share of the way). */
  drift: number;
  /** How small it is when it has dissolved (×). */
  endScale: number;
  /** When the minion starts to materialise (ms after the lift starts). */
  appearAt: number;
  /** How long the minion takes to form and settle (ms). */
  settleMs: number;
  /** The minion's size as it starts to form (×), and the slight overshoot it eases back from (×). */
  formFrom: number;
  overshoot: number;
  /** The landing pulse: ring radius (× card width), ring opacity, duration (ms), core glow size (× card width). */
  pulseSize: number;
  pulseAlpha: number;
  pulseMs: number;
  pulseCore: number;
  /** Sparks off the pulse (always 0 on phones). */
  pulseSparks: number;
  /** The game's landing dust and the summon sound on the landing (1 on, 0 off). */
  dust: number;
  sound: number;
  /** The soft glow behind the card as it lifts (opacity; 0 hides it). */
  liftGlow: number;
  /** Between several minions summoned at once (ms). Shorter than the motion, so a chain flows. */
  staggerMs: number;
}

const DEFAULTS: HandSummonConfig = {
  pathMs: 380,
  riseHeight: 0.2,
  riseScale: 1.06,
  drift: 0.55,
  endScale: 0.66,
  appearAt: 190,
  settleMs: 360,
  formFrom: 0.9,
  overshoot: 1.05,
  pulseSize: 0.62,
  pulseAlpha: 0.8,
  pulseMs: 320,
  pulseCore: 0.7,
  pulseSparks: 10,
  dust: 1,
  sound: 1,
  liftGlow: 0.4,
  staggerMs: 90,
};
export { DEFAULTS as HAND_SUMMON_DEFAULTS };

type NumKey = keyof HandSummonConfig;
export const HAND_SUMMON_RANGES: Record<NumKey, [number, number, number]> = {
  pathMs: [150, 800, 10],
  riseHeight: [0, 0.6, 0.01],
  riseScale: [1, 1.3, 0.01],
  drift: [0, 1, 0.05],
  endScale: [0.3, 1, 0.02],
  appearAt: [0, 500, 10],
  settleMs: [120, 800, 10],
  formFrom: [0.6, 1, 0.01],
  overshoot: [1, 1.15, 0.01],
  pulseSize: [0, 1.5, 0.02],
  pulseAlpha: [0, 1, 0.05],
  pulseMs: [100, 800, 10],
  pulseCore: [0, 1.5, 0.05],
  pulseSparks: [0, 40, 1],
  dust: [0, 1, 1],
  sound: [0, 1, 1],
  liftGlow: [0, 1, 0.02],
  staggerMs: [0, 400, 10],
};

const KEY = 'ascent.handSummon';

function load(): HandSummonConfig {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: HandSummonConfig = { ...DEFAULTS };
    for (const k of Object.keys(HAND_SUMMON_RANGES) as NumKey[]) if (typeof saved[k] === 'number') out[k] = saved[k] as number;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}
let cfg: HandSummonConfig = load();

function save(): void {
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage blocked: this session only */ }
}

export function getHandSummonConfig(): HandSummonConfig { return cfg; }
export function setHandSummonValue(key: NumKey, value: number): void { cfg = { ...cfg, [key]: value }; save(); }
export function resetHandSummonConfig(): void {
  cfg = { ...DEFAULTS };
  if (!import.meta.env.DEV) return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
