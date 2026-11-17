/**
 * The v2 measurement, as pure functions (strength v2 design 2026-11-16, sections 6.B, 6.C and the drift alarm of
 * 6.A). The CLI (`cliV2.ts`) feeds them raw win rates; nothing here touches the pool or the network.
 */
import { runInStrengthBand, MAX_SEATS_PER_PLAYER_SHORT, type RunV2, type StrengthBand } from '@game/sim';

export { rawRoundsOfRun, rateRunsV2, type RawRound, type RunV2 } from '@game/sim';

/** The drift alarm: a round's reference is outgrown when the median board beats it more than 60% of the time or the
 *  90th percentile more than 92%. */
export function driftOf(raws: readonly number[]): { median: number; p90: number; rebaseline: boolean } {
  const a = [...raws].sort((x, y) => x - y);
  if (!a.length) return { median: 0, p90: 0, rebaseline: false };
  const median = a[Math.floor(a.length / 2)]!;
  const p90 = a[Math.min(a.length - 1, Math.floor(0.9 * a.length))]!;
  return { median, p90, rebaseline: median > 0.6 || p90 > 0.92 };
}

/** Seats a set of runs can fill under the per-player cap of a short table (3, R-LOBBY-16; a run with no owner counts alone). */
export function seatsOf(runs: readonly Pick<RunV2, 'owner'>[]): number {
  const per = new Map<string, number>();
  let loose = 0;
  for (const r of runs) { if (r.owner === null) loose++; else per.set(r.owner, (per.get(r.owner) ?? 0) + 1); }
  let n = loose;
  for (const c of per.values()) n += Math.min(MAX_SEATS_PER_PLAYER_SHORT, c);
  return n;
}

/** Is the run in the band, the band's own peak cap included (R-LOBBY-21)? */
export const inBandV2 = (r: RunV2, band: StrengthBand | null): boolean =>
  runInStrengthBand({ strength: r.strength, early: r.early, late: r.late, peak: r.peak }, band);

/** For each candidate peak cap: the band's runs that stay (peak at or under the cap; a run with no peak stays),
 *  how many it removes, and the seats the rest can fill. The base is the band WITHOUT its own peak cap, so a
 *  candidate above the live cap still shows what it would keep. */
export function peakCapRows(runs: readonly RunV2[], band: StrengthBand | null, caps: readonly number[]): { cap: number; runs: number; removed: number; seats: number }[] {
  const { peakCap: _live, ...uncapped } = band ?? ({} as StrengthBand);
  const inBand = runs.filter((r) => inBandV2(r, band ? (uncapped as StrengthBand) : null));
  return caps.map((cap) => {
    const kept = inBand.filter((r) => r.peak === null || r.peak <= cap);
    return { cap, runs: kept.length, removed: inBand.length - kept.length, seats: seatsOf(kept) };
  });
}
