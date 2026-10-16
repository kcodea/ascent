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
 * MENU BOARDS (UI refinement WS-4, 2026-10-16): the stored boards on Recent Games, the Career and the Hall show the
 * real `Card` at a small scale, where a four-digit stat already overruns the badge into the neighbouring portrait
 * (`1977`, `103.7k`, `209k` on the owner's 2026-10-16 screenshot). There the number abbreviates from 1,000 and keeps
 * at most four glyphs: `999`, `1.5k`, `21k`, `209k`, `1.2m`, `45m`. The exact value is on the card's own hover.
 * In-game cards keep `formatStat` (full digits to 99,999): this is only ever provided by a menu board.
 */
export function formatStatCompact(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return neg + String(abs);
  const units: Array<[number, string]> = [[1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k']];
  for (const [size, suffix] of units) {
    if (abs < size) continue;
    const v = abs / size;
    // One decimal under 10 of a unit (1.5k), whole numbers above (21k, 209k); a carry re-expresses one unit up.
    const r = v < 9.95 ? Math.round(v * 10) / 10 : Math.round(v);
    if (r >= 1000 && suffix !== 't') return neg + formatStatCompact(r * size);
    return neg + (Number.isInteger(r) ? String(r) : r.toFixed(1)) + suffix;
  }
  return neg + String(abs);
}
