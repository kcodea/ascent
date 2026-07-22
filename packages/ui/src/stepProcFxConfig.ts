/**
 * Tunable parameters for the STEP-PROC FX — the "this unit's counter just filled and its effect fired" cue
 * (owner ask 2026-07-21): the SAME rising-arrow + mote-blast flourish as the spell-power cue, but fired from
 * the unit's STEP COUNTER pill, for every step-based card.
 *
 * WHICH CARDS: everything `cardText.stepProgress()` gives a counter to — Guel (per 4 spells), Flowing Monk,
 * Crypt Drake, **Avenge** (Solaris / Soulsman / Bone Taxer / Brood Matron…), Bloodbinder's bleed, the gold-spent
 * and buy-count meters, cadence cards ("2 Turns"), Spirit Pup's transform, Tara's ascend. Hooking the one
 * `.stepcounter` element covers them all uniformly, in BOTH phases (the counter renders in shop and combat).
 *
 * WHEN: the counters are cyclic (1/4 → 4/4 → 1/4) or count up to a threshold, and the effect fires exactly as
 * the counter REACHES `total` — so the FX fires on the transition INTO `current === total` (never on mount, so
 * a card entering play already full doesn't burst). See `Card.tsx`'s step-proc effect.
 *
 * WHY ITS OWN CONFIG: this is a deliberate clone of `spellPowerFxConfig`'s shape (it feeds the same
 * `pixiFx.spellPower` primitive, which is fully config-driven) rather than a shared one — the owner wants to
 * size/tune the counter flourish independently of the spell-power cue. Dialed via the DEV "🔢 Step Proc FX"
 * tuner (`StepProcFxTuner.tsx`); `getStepProcFxConfig()` is read at FIRE TIME, so an edit applies to the NEXT
 * proc rather than needing a reload. DEV-only persistence — production always ships DEFAULTS.
 *
 * NOTE: no floating number here (owner call) — a step proc has no natural stat gain to print, unlike spell
 * power's "+2/+2". The `numShow` family is deliberately absent; this is arrows + blast only.
 */
export interface StepProcFxConfig {
  // ---- the rising arrows ----
  arrowCount: number;   // arrows per proc, fanned across the spread
  arrowRise: number;    // px — how far an arrow travels upward
  arrowSpread: number;  // px — horizontal fan width the arrows launch across
  arrowLen: number;     // px — an arrow's shaft length
  arrowWidth: number;   // px — shaft stroke width
  arrowHead: number;    // px — arrowhead size
  arrowMs: number;      // ms — a single arrow's rise
  arrowStagger: number; // ms — delay between successive arrows
  arrowDrift: number;   // px — sideways wander over the rise
  arrowFadeAt: number;  // 0..1 — fraction of the rise after which an arrow starts fading

  // ---- the origin blast ----
  blastCount: number;   // motes popped at the counter (0 = off)
  blastSpeed: number;   // px/s — initial mote speed
  blastSize: number;    // px — mote size
  blastLife: number;    // ms — mote lifetime
  blastGravity: number; // px/s² — downward pull on the motes (0 = float free)
  blastSpread: number;  // degrees — arc the shrapnel is thrown across (360 = full ring)
  blastAngle: number;   // degrees — which way that cone points (0 = up, 90 = right)
  blastDrag: number;    // 0..1 per frame — how fast the motes slow
  blastJitter: number;  // 0..1 — random speed variance per mote
  blastRise: number;    // px/s — extra upward kick at spawn
  blastSpin: number;    // deg/s — mote rotation
  blastStagger: number; // ms — delay between motes (0 = all at once)
  blastShrink: number;  // 0..1 — end scale as a fraction of start

  // ---- palette ----
  colorA: string;       // arrow core
  colorB: string;       // arrow alt
  colorC: string;       // accent / blast
  glowAlpha: number;    // 0..1 — soft underlay around each arrow stroke
  glowWidth: number;    // px — that underlay's extra width
}

// Shipping defaults: a SMALLER, tighter read than the spell-power cue. A step proc fires far more often (every
// Avenge, every 4th spell, every cadence turn), and it fires from a little pill ON a card rather than over the
// whole tavern — so it's scaled down to punctuate without burying the board. Owner will tune from here.
const DEFAULTS: StepProcFxConfig = {
  arrowCount: 5,
  arrowRise: 74,
  arrowSpread: 44,
  arrowLen: 17,
  arrowWidth: 2.5,
  arrowHead: 6.5,
  arrowMs: 440,
  arrowStagger: 28,
  arrowDrift: 9,
  arrowFadeAt: 0.6,

  blastCount: 11,
  blastSpeed: 140,
  blastSize: 3,
  blastLife: 430,
  blastGravity: 190,
  blastSpread: 360,
  blastAngle: 0,
  blastDrag: 0.06,
  blastJitter: 0.5,
  blastRise: 40,
  blastSpin: 0,
  blastStagger: 0,
  blastShrink: 0.12,

  colorA: '#ff5fc8',
  colorB: '#a45cff',
  colorC: '#ffcf5a',
  glowAlpha: 0.5,
  glowWidth: 4,
};

export const STEPPROCFX_KEYS = [
  'arrowCount', 'arrowRise', 'arrowSpread', 'arrowLen', 'arrowWidth', 'arrowHead', 'arrowMs', 'arrowStagger',
  'arrowDrift', 'arrowFadeAt',
  'blastCount', 'blastSpeed', 'blastSize', 'blastLife', 'blastGravity',
  'blastSpread', 'blastAngle', 'blastDrag', 'blastJitter', 'blastRise', 'blastSpin', 'blastStagger', 'blastShrink',
  'glowAlpha', 'glowWidth',
  'colorA', 'colorB', 'colorC',
] as const satisfies readonly (keyof StepProcFxConfig)[];

export const STEPPROCFX_COLOR_KEYS: (keyof StepProcFxConfig)[] = ['colorA', 'colorB', 'colorC'];

export const STEPPROCFX_RANGES: Partial<Record<keyof StepProcFxConfig, [number, number, number]>> = {
  arrowCount: [1, 20, 1], arrowRise: [20, 320, 2], arrowSpread: [0, 260, 2], arrowLen: [6, 80, 1],
  arrowWidth: [1, 12, 0.5], arrowHead: [0, 28, 0.5], arrowMs: [120, 1600, 10], arrowStagger: [0, 160, 2],
  arrowDrift: [0, 90, 1], arrowFadeAt: [0, 1, 0.02],
  blastCount: [0, 60, 1], blastSpeed: [0, 600, 5], blastSize: [1, 20, 0.5], blastLife: [80, 1600, 20],
  blastGravity: [0, 900, 10],
  blastSpread: [0, 360, 5], blastAngle: [0, 360, 5], blastDrag: [0, 0.5, 0.01], blastJitter: [0, 1, 0.02],
  blastRise: [0, 400, 5], blastSpin: [0, 720, 10], blastStagger: [0, 120, 1], blastShrink: [0, 1, 0.02],
  glowAlpha: [0, 1, 0.02], glowWidth: [0, 24, 0.5],
};

const KEY = 'ascent.stepProcFx';

let cfg: StepProcFxConfig = load();

function load(): StepProcFxConfig {
  // DEV-only persistence, matching every other FX tuner: production always renders DEFAULTS, so a dialed-in
  // localStorage on a dev machine can never leak into what players see.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<StepProcFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getStepProcFxConfig(): StepProcFxConfig {
  return cfg;
}
export function getStepProcFxDefaults(): StepProcFxConfig {
  return { ...DEFAULTS };
}
export function setStepProcFxValue(key: keyof StepProcFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetStepProcFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
