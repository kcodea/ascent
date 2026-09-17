/**
 * Tunable parameters for the DICE ROLL overlay (`DiceRoll.tsx` / `diceRollTimeline.ts`) — the top-down 3D die that
 * the Gambler's hero power lands on the power button and the Gamble spell lands at the cast point.
 *
 * Two callers, ONE component (owner handoff 2026-09-17): the differences are the per-variant PRESETS here —
 * the Gambler's roll is the slower, showier one (1100 ms / 3 spins); the spell is quicker (700 ms / 2 spins)
 * because a card is being withheld from the hand until it lands. `hopHeight` and `settleBounce` are shared.
 *
 * Same pattern as the other FX configs: localStorage-persisted, dialed via the DEV "🎲 Dice" tuner
 * (`DiceRollTuner.tsx`); read at ROLL time, so edits apply to the next roll. Production ships the DEFAULTS.
 */
export interface DiceRollConfig {
  tumbleTime: number;      // ms — Gambler (power): the whole roll, first lift to final settle
  spinCount: number;       // Gambler (power): full X turns (Y gets one more)
  spellTumbleTime: number; // ms — Gamble (spell) tumble
  spellSpinCount: number;  // Gamble (spell) spins
  hopHeight: number;       // px — how far the die lifts toward the camera on its first hop
  settleBounce: number;    // 0..0.5 — second-hop height as a fraction of hopHeight, and the rotation overshoot
  /* THE THROW (spell only, owner follow-up 2026-09-17): the Gamble die is thrown from the cast point toward the
   * board centre and bounces across the table. The power path ignores all four. */
  throwDistance: number;   // px — how far along the cast-point → board-centre line the die travels
  bounceCount: number;     // 1..4 — decaying parabolas before it settles
  bounceDecay: number;     // 0.3..0.7 — each apex as a fraction of the previous
  throwJitterDeg: number;  // deg — seeded ± wobble off the throw line
  flickScale: number;      // 0..1 — how much the mouse's flick SPEED stretches / shortens the throw (0 = ignore)
}

const DEFAULTS: DiceRollConfig = {
  tumbleTime: 1100, spinCount: 3,
  spellTumbleTime: 700, spellSpinCount: 2,
  hopHeight: 80, settleBounce: 0.22,
  throwDistance: 220, bounceCount: 3, bounceDecay: 0.5, throwJitterDeg: 10, flickScale: 0.5,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. The spell never drops below ~600 ms / 1 spin
 *  (owner handoff): a shorter tumble stops reading as a roll at all. */
export const DICEROLL_RANGES: Record<keyof DiceRollConfig, [number, number, number]> = {
  tumbleTime: [400, 2200, 10], spinCount: [1, 6, 1],
  spellTumbleTime: [600, 2200, 10], spellSpinCount: [1, 6, 1],
  hopHeight: [0, 150, 1], settleBounce: [0, 0.5, 0.01],
  throwDistance: [60, 500, 5], bounceCount: [1, 4, 1], bounceDecay: [0.3, 0.7, 0.01], throwJitterDeg: [0, 25, 1], flickScale: [0, 1, 0.05],
};

export { DEFAULTS as DICEROLL_DEFAULTS };

const KEY = 'ascent.diceroll';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: DiceRollConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<DiceRollConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getDiceRollConfig(): DiceRollConfig {
  return cfg;
}
export function setDiceRollValue(key: keyof DiceRollConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetDiceRollConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export type DiceVariant = 'power' | 'spell';

/** DEV test-fire channel: the Dice tuner's ▶ Test dispatches this on `window` with `{ face }`, and `Recruit`
 *  mounts a spell-variant die at the screen centre. Lives here (not in the tuner) so Recruit never imports
 *  the panel. */
export const DICE_TEST_EVENT = 'ascent:dice-test';

export interface DiceRollParams {
  tumbleTime: number; spinCount: number; hopHeight: number; settleBounce: number;
  /** Present for the spell only — the throw geometry. */
  throw?: { distance: number; bounceCount: number; bounceDecay: number; jitterDeg: number; flickScale: number };
}

/** The timeline knobs for one caller — the shared ones plus that variant's preset (and, for the spell, the throw). */
export function diceRollParamsFor(variant: DiceVariant): DiceRollParams {
  const c = cfg;
  return variant === 'spell'
    ? {
      tumbleTime: c.spellTumbleTime, spinCount: c.spellSpinCount, hopHeight: c.hopHeight, settleBounce: c.settleBounce,
      throw: { distance: c.throwDistance, bounceCount: c.bounceCount, bounceDecay: c.bounceDecay, jitterDeg: c.throwJitterDeg, flickScale: c.flickScale },
    }
    : { tumbleTime: c.tumbleTime, spinCount: c.spinCount, hopHeight: c.hopHeight, settleBounce: c.settleBounce };
}

/** One recent pointer sample — the caller keeps a short ring of these while a card is being dragged. */
export interface PointerSample { x: number; y: number; t: number }

/** The window of pointer history a flick is read from, and how far back the reference sample is taken. */
export const FLICK_WINDOW_MS = 150;
export const FLICK_LOOKBACK_MS = 120;
/** Below this much travel inside the window the pointer counts as STILL (no flick). */
export const FLICK_MIN_TRAVEL_PX = 8;

/**
 * The FLICK the mouse made just before release (owner ask 2026-09-17: the throw follows the hand's motion, not
 * the board). Direction = from the sample ~`FLICK_LOOKBACK_MS` before release (or the oldest inside the window)
 * to the release point; `speed` in px/ms over that span. `null` when the pointer was effectively still.
 * Pure: the samples and the release time are inputs.
 */
export function flickOf(samples: readonly PointerSample[], release: { x: number; y: number; t: number }): { dir: { x: number; y: number }; speed: number } | null {
  const inWindow = samples.filter((p) => release.t - p.t <= FLICK_WINDOW_MS && p.t <= release.t);
  if (inWindow.length === 0) return null;
  // The sample closest to LOOKBACK ms ago — the oldest in the window when the history is shorter than that.
  const target = release.t - FLICK_LOOKBACK_MS;
  let ref = inWindow[0]!;
  for (const p of inWindow) if (Math.abs(p.t - target) < Math.abs(ref.t - target)) ref = p;
  const dx = release.x - ref.x, dy = release.y - ref.y;
  const dist = Math.hypot(dx, dy);
  if (dist < FLICK_MIN_TRAVEL_PX) return null;
  const span = Math.max(1, release.t - ref.t);
  return { dir: { x: dx / dist, y: dy / dist }, speed: dist / span };
}

/** The flick-speed multiplier on the throw distance: 1 px/ms (a brisk drag) is neutral, faster stretches, slower
 *  shortens, all scaled by `flickScale` (0 = ignore speed) and clamped to 0.6×–1.6×. */
export function flickDistanceScale(speed: number, flickScale: number): number {
  return Math.min(1.6, Math.max(0.6, 1 + Math.min(1, Math.max(0, flickScale)) * (speed - 1)));
}

/** The fallback throw direction when the pointer was still: from the cast point toward the board centre, and
 *  always AWAY from the hand — the hand sits at the bottom of the screen, so the vector never carries a downward
 *  component (a card dropped ABOVE the centre still travels up the table). Cast exactly ON the centre: straight up. */
export function towardBoard(from: { x: number; y: number }, boardCentre: { x: number; y: number }): { x: number; y: number } {
  const dx = boardCentre.x - from.x;
  const dy = -Math.abs(boardCentre.y - from.y);
  if (dx === 0 && dy === 0) return { x: 0, y: -1 };
  const d = Math.hypot(dx, dy);
  return { x: dx / d, y: dy / d };
}

/**
 * Where a thrown die LANDS: `distance` px from the cast point along `dir` (the flick, or `towardBoard` when the
 * pointer was still), bent by the seeded jitter (`throwJitter` in [-1, 1] × `jitterDeg`), then clamped inside the
 * viewport and above the hand row. Pure — every rect is passed in, measured ONCE by the caller. The direction
 * comes from real input, so only the jitter is the seeded, replay-pinned part.
 */
export function throwLanding(
  from: { x: number; y: number },
  dir: { x: number; y: number },
  params: { distance: number; jitterDeg: number },
  throwJitter: number,
  bounds: { width: number; height: number; handTop: number; margin: number },
): { x: number; y: number } {
  let ang = dir.x === 0 && dir.y === 0 ? -Math.PI / 2 : Math.atan2(dir.y, dir.x);
  ang += (throwJitter * params.jitterDeg * Math.PI) / 180;
  const x = from.x + Math.cos(ang) * params.distance;
  const y = from.y + Math.sin(ang) * params.distance;
  const m = bounds.margin;
  const maxY = Math.min(bounds.height - m, bounds.handTop - m);
  return {
    x: Math.min(bounds.width - m, Math.max(m, x)),
    y: Math.min(Math.max(m, maxY), Math.max(m, y)),
  };
}
