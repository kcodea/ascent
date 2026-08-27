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
      let value = Math.round((abs / size) * 10) / 10;
      // Rounding can carry into the next unit (999,950 → "1000k"): re-express as 1 of the unit above.
      if (value >= 1000 && suffix !== 't') return neg + formatStat(value * size);
      const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
      return neg + text + suffix;
    }
  }
  return neg + String(abs);
}
