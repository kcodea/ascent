import { useSyncExternalStore } from 'react';

/**
 * Live-tunable knobs + a preview channel for the end-of-turn CHARGE GLYPH (see `.chargeglyph` in styles.css and the
 * `ChargeGlyph` component in Recruit.tsx). The look (colours/glow/gradient/pulse/feather) rides CSS `--cg-*` vars;
 * these are the two bits that DON'T fit a var: the JS-driven core-bloom curve, and a dev preview override.
 *
 * `chargeTune` — the sigil core-bloom curve, read each frame by ChargeGlyph's rAF. The dev ChargeGlyphTuner mutates
 * it live; production keeps the defaults. Plain object (not a store) — the rAF reads it every frame, no re-render.
 *
 * `chargePreview` — a tiny pub/sub (mirrors turnClock) holding a forced charge 0→1 or null. When non-null (only the
 * dev tuner sets it), ChargeGlyph renders regardless of the clock and pins `--charge` to it, so the effect can be
 * scrubbed / played on demand without waiting for a real 20s turn. null in production → zero effect.
 */
export const chargeTune = { bloomAt: 0.49, coreMax: 1 };

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
