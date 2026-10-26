import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * THE PHONE HAND POP (R-PHONE-POP-01): how large a hand card grows while a finger is on it on a phone, and where its foot
 * sits. Owner 2026-10-26, after the phone captures: "I think the hand pop still goes a bit too vertical is really my
 * biggest gripe." So the pop no longer lifts off the hand: its foot stays on the hand row's own foot (the line the
 * resting hand runs down to), and it is shorter, its top at the board's lower row instead of over the Shop row. Then,
 * on the captures: "The hand pop location is better but needs to be a bit larger": as large as it gets with its top
 * still below the Shop row.
 *
 * Tuner convention: localStorage-persisted in DEV only, production always plays `PHONE_POP_DEFAULTS`. `touchInput.ts`
 * reads it on every press (once, never per frame), so a slider change shows on the next press. Shipping a feel =
 * pasting the tuned numbers into `PHONE_POP_DEFAULTS`.
 */
export interface PhonePopConfig {
  /** The popped card's whole height (plates and tribe label included), as a share of the safe screen height. */
  heightFrac: number;
  /** Screen px (pt) the popped card's foot sits ABOVE the resting hand row's foot. 0 = on it; negative = lower. The foot
   *  never goes below the run's foot line (`PHONE_FOOT_FRAC` of the screen above the bottom edge). */
  footLift: number;
}

/** Shipped values (2026-10-26): the top lands just below the Shop row (at the board's lower row) on every phone; the foot
 *  on the hand's. 0.57 is the largest that keeps it there (0.6 reached over the Shop minions' stat badges). */
export const PHONE_POP_DEFAULTS: PhonePopConfig = {
  heightFrac: 0.57,
  footLift: 0,
};

type Key = keyof PhonePopConfig;

export const PHONE_POP_RANGES: Record<Key, [number, number, number]> = {
  heightFrac: [0.35, 0.8, 0.01],
  footLift: [-20, 60, 1],
};

const KEY = 'ascent.phonepop';

/** Clamp every field into its range (a stale or hand-edited localStorage entry can never break the pop). */
export function sanitizePhonePop(c: Partial<PhonePopConfig>): PhonePopConfig {
  const out = { ...PHONE_POP_DEFAULTS };
  for (const k of Object.keys(PHONE_POP_DEFAULTS) as Key[]) {
    const v = Number(c[k]);
    if (!Number.isFinite(v)) continue;
    const [min, max] = PHONE_POP_RANGES[k];
    out[k] = Math.min(max, Math.max(min, v));
  }
  return out;
}

let cfg: PhonePopConfig = (() => {
  if (!import.meta.env.DEV) return { ...PHONE_POP_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return sanitizePhonePop(saved && typeof saved === 'object' ? (saved as Partial<PhonePopConfig>) : {});
  } catch {
    return { ...PHONE_POP_DEFAULTS };
  }
})();

export function getPhonePopConfig(): PhonePopConfig {
  return cfg;
}

export function setPhonePopValue(key: Key, value: number): void {
  cfg = sanitizePhonePop({ ...cfg, [key]: Number(value) });
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetPhonePopConfig(): void {
  cfg = { ...PHONE_POP_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const SPECS: Record<Key, [string, TunerUnit | undefined, string, string]> = {
  heightFrac: ['Pop height', '×', 'How tall a pressed hand card grows, as a share of the safe screen height. Lower keeps more of the board in view.', 'Phone hand pop'],
  footLift: ['Foot lift', 'px', 'How far (screen pt) the popped card’s foot sits above the resting hand’s foot. 0 = on it; negative = lower (never past the bottom edge).', 'Phone hand pop'],
};

function buildControls(): TunerControl<Key>[] {
  return (Object.keys(SPECS) as Key[]).map((key) => {
    const [label, unit, hint, group] = SPECS[key];
    const [min, max, step] = PHONE_POP_RANGES[key];
    return { key, label, unit, hint, group, min, max, step };
  });
}

export const SPEC: TunerSpec<PhonePopConfig> = {
  id: 'phonepop', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Phone hand pop',
  note: 'dev · phones · next press',
  read: getPhonePopConfig,
  write: (key, value) => setPhonePopValue(key, value),
  reset: resetPhonePopConfig,
  defaults: PHONE_POP_DEFAULTS,
  controls: buildControls(),
};
