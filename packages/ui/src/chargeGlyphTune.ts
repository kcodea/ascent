import { useSyncExternalStore } from 'react';

/**
 * The dev PREVIEW channel for the end-of-turn charge (the crystal fuse: `ChargeGlyph` in Recruit.tsx, tuned in the
 * Crystal Fuse panel, values in fuseTune.ts).
 *
 * `chargePreview` — a tiny pub/sub (mirrors turnClock) holding a forced charge 0→1 or null. When non-null (only the
 * dev tuner sets it), ChargeGlyph renders regardless of the clock and pins the burn to it, so the effect can be
 * scrubbed / played on demand without waiting for a real 20s turn. null in production → zero effect.
 */
let preview: number | null = null;
const subs = new Set<() => void>();

export const chargePreview = {
  get: (): number | null => preview,
  set: (v: number | null): void => {
    if (v !== preview) {
      preview = v;
      subs.forEach((f) => f());
    }
  },
  subscribe: (f: () => void): (() => void) => {
    subs.add(f);
    return () => subs.delete(f);
  },
};

/** The forced preview charge (0→1) or null when the glyph runs off the real turn clock. Re-renders the caller. */
export function useChargePreview(): number | null {
  return useSyncExternalStore(chargePreview.subscribe, chargePreview.get, chargePreview.get);
}
