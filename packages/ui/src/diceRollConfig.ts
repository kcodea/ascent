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
}

const DEFAULTS: DiceRollConfig = {
  tumbleTime: 1100, spinCount: 3,
  spellTumbleTime: 700, spellSpinCount: 2,
  hopHeight: 80, settleBounce: 0.22,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. The spell never drops below ~600 ms / 1 spin
 *  (owner handoff): a shorter tumble stops reading as a roll at all. */
export const DICEROLL_RANGES: Record<keyof DiceRollConfig, [number, number, number]> = {
  tumbleTime: [400, 2200, 10], spinCount: [1, 6, 1],
  spellTumbleTime: [600, 2200, 10], spellSpinCount: [1, 6, 1],
  hopHeight: [0, 150, 1], settleBounce: [0, 0.5, 0.01],
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

/** The four timeline knobs for one caller — the shared ones plus that variant's preset. */
export function diceRollParamsFor(variant: DiceVariant): { tumbleTime: number; spinCount: number; hopHeight: number; settleBounce: number } {
  const c = cfg;
  return variant === 'spell'
    ? { tumbleTime: c.spellTumbleTime, spinCount: c.spellSpinCount, hopHeight: c.hopHeight, settleBounce: c.settleBounce }
    : { tumbleTime: c.tumbleTime, spinCount: c.spinCount, hopHeight: c.hopHeight, settleBounce: c.settleBounce };
}
