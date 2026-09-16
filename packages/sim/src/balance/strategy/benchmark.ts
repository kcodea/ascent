/**
 * BALANCE BOT B4 — the strategist's BENCHMARK: mixed self-play lobbies (four strategist seats, four generalist
 * seats), placement compared at the LOBBY level (eight seats in one lobby are not eight independent trials —
 * roadmap "Evidence levels"), plus the line-diversity census the exploration population is for.
 *
 * Pure `@game/sim`; the CLI (`npm run balance:strategist-bench`) and the test both call this.
 */
import type { SetId } from '@game/content';
import { createRun } from '../../state';
import { GENERALIST_BUDGETS, createGeneralistPilot } from '../generalistPilot';
import { runSelfPlayLobby } from '../selfPlayLobby';
import { NOOP_RECORDER, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord, type PilotBudget, type SeatPilot } from '../types';
import { createStrategistPilot } from './strategistPilot';
import { viableLineCount } from './lines';

export interface Stat { mean: number; lo: number; hi: number; n: number; sd: number }

/** Mean with a 95% normal interval over independent samples. */
export function ci95(xs: number[]): Stat {
  const n = xs.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0, sd: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? 1.96 * sd / Math.sqrt(n) : 0;
  return { mean, lo: mean - half, hi: mean + half, n, sd };
}

export const fmtStat = (s: Stat): string => `${s.mean.toFixed(2)} [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}] n=${s.n}`;

export interface MixedBenchmarkOptions {
  setId: SetId;
  seeds: number[];
  budget?: PilotBudget;
  /** Which strategist variant sits: `0` = best-fit line (the natural population); `'rotate'` = the exploration population. */
  exploration?: number | 'rotate';
  maxRounds?: number;
}

export interface MixedBenchmarkResult {
  lobbies: number;
  failed: number;
  failures: string[];
  /** Per-lobby mean placement of each side (only lobbies that placed). */
  strategistPerLobby: number[];
  generalistPerLobby: number[];
  strategist: Stat;
  generalist: Stat;
  /** Paired per-lobby difference generalist − strategist (POSITIVE = the strategist placed better, i.e. lower). */
  advantage: Stat;
  firsts: { strategist: number; generalist: number };
  topHalf: { strategist: number; generalist: number };
  /** primary line → count of strategist seats that played it. */
  linesPlayed: Record<string, number>;
  records: LobbyRecord[];
  ms: number;
}

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'bench', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };

export function runMixedBenchmark(opts: MixedBenchmarkOptions): MixedBenchmarkResult {
  const budget = opts.budget ?? GENERALIST_BUDGETS.smoke;
  const exploration = opts.exploration ?? 0;
  const manifest: ExperimentManifest = {
    schemaVersion: 1, name: `b4 mixed ${opts.setId}`, mode: 'selfPlayLobby', setId: opts.setId,
    policy: { id: 'strategist+generalist', budget }, seeds: { start: opts.seeds[0] ?? 0, count: opts.seeds.length },
    ...(opts.maxRounds !== undefined ? { maxRounds: opts.maxRounds } : {}),
  };
  const t0 = performance.now();
  const strategistPerLobby: number[] = [];
  const generalistPerLobby: number[] = [];
  const failures: string[] = [];
  const records: LobbyRecord[] = [];
  const linesPlayed: Record<string, number> = {};
  let firstsS = 0; let firstsG = 0; let topS = 0; let topG = 0;
  for (const seed of opts.seeds) {
    // Alternate the pilot per seat AND per seed so every seat index (hence hero rotation slot) hosts both.
    const isStrategist = (idx: number): boolean => ((idx + seed) & 1) === 0;
    const pilots = new Map<number, SeatPilot>();
    const pilotFor = (idx: number): SeatPilot => {
      let p = pilots.get(idx);
      if (!p) {
        p = isStrategist(idx)
          ? createStrategistPilot(budget, 0x9e3779b9, { exploration })
          : createGeneralistPilot(budget, 0x9e3779b9);
        pilots.set(idx, p);
      }
      return p;
    };
    const rec = runSelfPlayLobby(manifest, seed, pilotFor, NOOP_RECORDER, identity);
    records.push(rec);
    if (rec.failure) { failures.push(`seed ${seed}: ${rec.failure}`); continue; }
    const s: number[] = []; const g: number[] = [];
    for (const seat of rec.seats) {
      const idx = Number(seat.seatId.slice(1));
      const p = seat.placement ?? 8;
      if (isStrategist(idx)) {
        s.push(p);
        if (p === 1) firstsS++;
        if (p <= 4) topS++;
        if (seat.line) linesPlayed[seat.line.primary] = (linesPlayed[seat.line.primary] ?? 0) + 1;
      } else {
        g.push(p);
        if (p === 1) firstsG++;
        if (p <= 4) topG++;
      }
    }
    strategistPerLobby.push(s.reduce((a, b) => a + b, 0) / s.length);
    generalistPerLobby.push(g.reduce((a, b) => a + b, 0) / g.length);
  }
  const advantage = ci95(generalistPerLobby.map((g, i) => g - strategistPerLobby[i]!));
  return {
    lobbies: opts.seeds.length, failed: failures.length, failures,
    strategistPerLobby, generalistPerLobby,
    strategist: ci95(strategistPerLobby), generalist: ci95(generalistPerLobby), advantage,
    firsts: { strategist: firstsS, generalist: firstsG }, topHalf: { strategist: topS, generalist: topG },
    linesPlayed, records, ms: performance.now() - t0,
  };
}

export function renderMixedBenchmark(r: MixedBenchmarkResult, label = 'strategist vs generalist'): string {
  const lines = [
    `[b4 benchmark] ${label}: ${r.lobbies} lobbies (${r.failed} failed), ${(r.ms / 1000).toFixed(1)}s`,
    `  mean placement — strategist ${fmtStat(r.strategist)}; generalist ${fmtStat(r.generalist)}`,
    `  paired advantage (generalist − strategist, + = strategist better) ${fmtStat(r.advantage)}`,
    `  firsts — strategist ${r.firsts.strategist}, generalist ${r.firsts.generalist}; top-half — strategist ${r.topHalf.strategist}, generalist ${r.topHalf.generalist}`,
    `  lines played: ${Object.entries(r.linesPlayed).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || '—'}`,
  ];
  for (const f of r.failures) lines.push(`  FAILURE ${f}`);
  return lines.join('\n');
}

export interface LineDiversityRow { heroId: string; seeds: number; distinctPrimaries: number; viable: number; primaries: Record<string, number> }

/**
 * Line diversity across seeds for a hero under the exploration population (`strategist:rotate`): how many distinct
 * primaries the hero would play over `seeds` runs. Computed from the run's own facts (`createRun` per seed) —
 * no lobby needed, since the line is fixed at the first decision from hero + tribes + seed.
 */
export function lineDiversity(heroIds: string[], seeds: number[], setId: SetId): LineDiversityRow[] {
  return heroIds.map((heroId) => {
    const primaries: Record<string, number> = {};
    let viable = 0;
    for (const seed of seeds) {
      const run = createRun(seed, heroId, 'lobby', undefined, setId);
      viable = Math.max(viable, viableLineCount(heroId, run.tribes, setId));
      const pilot = createStrategistPilot(GENERALIST_BUDGETS.smoke, 0x9e3779b9, { exploration: 'rotate' });
      pilot.decide({ ...run, phase: 'recruit' }, { seatId: 'seat', round: 1, scoutedOpponent: null });
      const line = pilot.lineOf('seat')!;
      primaries[line.primary] = (primaries[line.primary] ?? 0) + 1;
    }
    return { heroId, seeds: seeds.length, distinctPrimaries: Object.keys(primaries).length, viable, primaries };
  });
}

export function renderLineDiversity(rows: LineDiversityRow[]): string {
  return rows.map((r) => `  ${r.heroId}: ${r.distinctPrimaries} distinct primaries over ${r.seeds} seeds (${r.viable} viable): ${Object.entries(r.primaries).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ')}`).join('\n');
}
