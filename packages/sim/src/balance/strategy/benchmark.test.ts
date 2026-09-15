import { describe, expect, it } from 'vitest';
import { lineDiversity, renderLineDiversity, renderMixedBenchmark, runMixedBenchmark } from './benchmark';

/**
 * B4 — the strategist must not be WORSE than the generalist beyond noise: in mixed self-play lobbies (4 strategist
 * + 4 generalist seats, smoke budget), the lobby-level 95% interval of the paired placement advantage must reach 0.
 * If it fails, DIAGNOSE — never hide it by widening the seeds or the budget.
 *
 * Seed count: `BALANCE_BENCH_SEEDS` (default 6 — ~13 s per lobby). The CLI (`npm run balance:strategist-bench`)
 * runs the 20-seed version for the report.
 */
const SEEDS = Number(process.env.BALANCE_BENCH_SEEDS ?? 6);

describe('B4 benchmark — strategist vs generalist in mixed self-play (set2)', () => {
  it('places no worse than the generalist beyond noise, fails no lobby, and records every strategist seat’s line', () => {
    const seeds = Array.from({ length: SEEDS }, (_, i) => 100 + i);
    const r = runMixedBenchmark({ setId: 'set2', seeds, exploration: 0 });
    console.log(renderMixedBenchmark(r, `strategist vs generalist, set2, ${SEEDS} seeds`));
    expect(r.failures).toEqual([]);
    for (const rec of r.records) {
      for (const seat of rec.seats) {
        if (seat.policyId === 'strategist') expect(seat.line, `${rec.lobbyId} ${seat.seatId} has no line`).toBeDefined();
        else expect(seat.line).toBeUndefined();
      }
    }
    expect(Object.keys(r.linesPlayed).length).toBeGreaterThanOrEqual(3);
    expect(r.advantage.hi, `the strategist is significantly WORSE than the generalist: ${renderMixedBenchmark(r)}`).toBeGreaterThanOrEqual(0);
  }, 20 * 60_000);

  it('line diversity: the exploration population plays several distinct primaries per hero over 30 seeds', () => {
    const rows = lineDiversity(['fibbsy', 'flint', 'tiff'], Array.from({ length: 30 }, (_, i) => 1 + i), 'set2');
    console.log(`[b4 line diversity]\n${renderLineDiversity(rows)}`);
    for (const row of rows) {
      expect(row.distinctPrimaries, `${row.heroId}`).toBeGreaterThanOrEqual(5);
      expect(row.primaries.mechAttach).toBeUndefined();
    }
  }, 120_000);
});
