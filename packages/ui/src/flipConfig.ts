/**
 * Tunable durations for the warband/shop GSAP Flip — the slide when cards REPOSITION (reorder, close a sold
 * gap, make room for a played/summoned unit). Two feels: `dragMs` is the live slide while a card is being
 * dragged over the row (cards glide aside under the cursor); `commitMs` is the settle after a committed change
 * (drop / play / buy / sell / auto-reposition). Held in one mutable, localStorage-persisted config so the slide
 * speed can be dialed by eye via the DEV Flip tuner (`FlipTuner.tsx`); Recruit's Flip reads `getFlipConfig()`
 * at animation time, so a change applies to the next reposition.
 */
export interface FlipConfig {
  /** Live drag slide (ms) — cards gliding aside as a card is dragged across the row. */
  dragMs: number;
  /** Committed settle (ms) — the slide after a drop / play / sell / auto-reposition. */
  commitMs: number;
}

const DEFAULTS: FlipConfig = {
  dragMs: 250,
  commitMs: 180,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const FLIP_RANGES: Record<keyof FlipConfig, [number, number, number]> = {
  dragMs: [40, 800, 10],
  commitMs: [40, 800, 10],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const FLIP_DESC: Record<keyof FlipConfig, string> = {
  dragMs: 'How long cards take to slide aside while you drag a card across the row (milliseconds).',
  commitMs: 'How long cards take to settle after a committed move — drop / play / sell / auto-reposition (ms).',
};
export const FLIP_KEYS = Object.keys(DEFAULTS) as (keyof FlipConfig)[];

const KEY = 'ascent.flip';
let cfg: FlipConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<FlipConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getFlipConfig(): FlipConfig {
  return cfg;
}
export function setFlipValue(key: keyof FlipConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetFlipConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
