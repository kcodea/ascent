/**
 * Stat-pill number formatting (owner ask 2026-08-27): full digits up to 99,999; from 100,000 the pill
 * abbreviates — `101.1k`, `10.6m`, `105.6m`, `10b`, `405.1b` — one decimal, trimmed when it's `.0`.
 * Late-game snowball runs push six-figure stats, and seven raw digits burst the badge plate.
 */
const UNITS: Array<[number, string]> = [
  [1e12, 't'],
  [1e9, 'b'],
  [1e6, 'm'],
  [1e3, 'k'],
];

export function formatStat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 100_000) return neg + String(abs);
  for (const [size, suffix] of UNITS) {
    if (abs >= size) {
      const value = Math.round((abs / size) * 10) / 10;
      // Rounding can carry into the next unit (999,950 → "1000k"): re-express as 1 of the unit above.
      if (value >= 1000 && suffix !== 't') return neg + formatStat(value * size);
      const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
      return neg + text + suffix;
    }
  }
  return neg + String(abs);
}

/**
 * Shrink-to-fit bucket for a stat badge's printed number (owner report 2026-10-16: "the badges got messed up for
 * some reason when they go into the 1000's"). The badge number is a FIXED font size sized for up to three glyphs;
 * a four-plus glyph value (`1000`, `10000`, `104k`, `999.9k`) ran wider than the badge's disc and spilled onto the
 * frame, the portrait and the other badge. The bucket is the printed glyph count, stamped on `.value` as
 * `data-fit`; styles.css maps each bucket to a font-scale (`--sv-fit`) so the number always sits inside the disc.
 * Up to three glyphs returns undefined: no attribute, the authored size, unchanged.
 */
export type StatFit = '4' | '5' | '6' | '7';

export function statFit(text: string): StatFit | undefined {
  const n = text.length;
  if (n <= 3) return undefined;
  if (n >= 7) return '7';
  return String(n) as StatFit;
}
