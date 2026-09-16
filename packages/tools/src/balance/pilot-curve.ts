/**
 * `balance:pilot-curve` — the B6 measurement: the PILOT's placement and board-stat curve from one or more jobs, beside
 * the recorded corpus curve.
 *
 *   npm run balance:pilot-curve -- --job b6-baseline [--job b6-candidate …] [--corpus set2-players-v1]
 *
 * For every job: mean placement with a 95% normal CI over lobbies, first-place count, top-3 rate, elimination
 * round median, and the per-wave MEDIAN (and p80) total board stats (Σ attack + health over the seat-0 board
 * snapshot at the end of its recruit turn) — the number the diagnosis in docs/balance-bot.md compares against the
 * players' 139 / 432 / 1,109 medians at waves 8 / 10 / 12. The corpus curve is computed the same way from every
 * recorded board of the named corpus. Read-only over `out/`; nothing here is a balance claim.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_ROOT as OUT_DIR } from './store';

interface Args { jobs: string[]; corpus: string }
function parseArgs(argv: string[]): Args {
  const a: Args = { jobs: [], corpus: 'set2-players-v1' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = argv[i + 1];
    if (k === '--job' && v) { a.jobs.push(v); i++; }
    else if (k === '--corpus' && v) { a.corpus = v; i++; }
  }
  if (a.jobs.length === 0) throw new Error('usage: --job <jobId> [--job …] [--corpus <name>]');
  return a;
}

const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return s[i]!;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

interface Curve { byWave: Map<number, number[]> }
const WAVES = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function statsOf(minions: { attack: number; health: number }[]): number {
  return minions.reduce((n, m) => n + m.attack + m.health, 0);
}

function jobCurve(jobId: string): { placements: number[]; elim: number[]; wins: Map<number, number[]>; curve: Curve; hand: Map<number, number[]>; goldens: Map<number, number[]>; failed: number } {
  const dir = join(OUT_DIR, jobId, 'lobbies');
  if (!existsSync(dir)) throw new Error(`no such job: ${jobId}`);
  const placements: number[] = [];
  const elim: number[] = [];
  const wins = new Map<number, number[]>();
  const hand = new Map<number, number[]>();
  const goldens = new Map<number, number[]>();
  const curve: Curve = { byWave: new Map() };
  let failed = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')).record as {
      failure?: string;
      seats: { seatId: string; placement?: number; eliminatedRound?: number; termination: string }[];
      rounds: { seatId: string; round: number; result: string; hand: string[]; snapshot?: { minions: { attack: number; health: number; golden?: boolean }[] } }[];
    };
    if (rec.failure) { failed++; continue; }
    const me = rec.seats.find((s) => s.seatId === 's0');
    if (!me || me.termination !== 'placed' || me.placement === undefined) { failed++; continue; }
    placements.push(me.placement);
    if (me.eliminatedRound !== undefined) elim.push(me.eliminatedRound);
    for (const r of rec.rounds) {
      if (r.seatId !== 's0') continue;
      if (r.result === 'win' || r.result === 'loss' || r.result === 'tie') {
        if (!wins.has(r.round)) wins.set(r.round, []);
        wins.get(r.round)!.push(r.result === 'win' ? 1 : r.result === 'tie' ? 0.5 : 0);
      }
      if (!hand.has(r.round)) hand.set(r.round, []);
      hand.get(r.round)!.push(r.hand.length);
      if (r.snapshot) {
        if (!curve.byWave.has(r.round)) curve.byWave.set(r.round, []);
        curve.byWave.get(r.round)!.push(statsOf(r.snapshot.minions));
        if (!goldens.has(r.round)) goldens.set(r.round, []);
        goldens.get(r.round)!.push(r.snapshot.minions.filter((m) => m.golden).length);
      }
    }
  }
  return { placements, elim, wins, curve, hand, goldens, failed };
}

function corpusCurve(name: string): Curve | null {
  const file = join(OUT_DIR, 'corpus', `${name}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8')) as { boards?: { wave: number; minions: { attack: number; health: number }[] }[] };
  const boards = data.boards ?? (data as unknown as { wave: number; minions: { attack: number; health: number }[] }[]);
  const curve: Curve = { byWave: new Map() };
  for (const b of boards as { wave: number; minions: { attack: number; health: number }[] }[]) {
    if (!b || typeof b.wave !== 'number' || !Array.isArray(b.minions)) continue;
    if (!curve.byWave.has(b.wave)) curve.byWave.set(b.wave, []);
    curve.byWave.get(b.wave)!.push(statsOf(b.minions));
  }
  return curve;
}

export function main(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const corpus = corpusCurve(args.corpus);
  const lines: string[] = [];
  lines.push(`# pilot curve — ${args.jobs.join(', ')} vs corpus ${args.corpus}`);
  lines.push('');
  lines.push('| job | n | mean placement [95% CI] | 1st | top-3 | top-4 | elim. median | failed |');
  lines.push('|---|---|---|---|---|---|---|---|');
  const jobs = args.jobs.map((id) => ({ id, ...jobCurve(id) }));
  for (const j of jobs) {
    const n = j.placements.length;
    const m = mean(j.placements);
    const sd = Math.sqrt(mean(j.placements.map((p) => (p - m) ** 2)) * (n / Math.max(1, n - 1)));
    const half = 1.96 * sd / Math.sqrt(Math.max(1, n));
    const firsts = j.placements.filter((p) => p === 1).length;
    const top3 = j.placements.filter((p) => p <= 3).length;
    const top4 = j.placements.filter((p) => p <= 4).length;
    lines.push(`| ${j.id} | ${n} | ${m.toFixed(2)} [${(m - half).toFixed(2)}, ${(m + half).toFixed(2)}] | ${firsts} | ${(100 * top3 / n).toFixed(0)}% | ${(100 * top4 / n).toFixed(0)}% | r${quantile(j.elim, 0.5)} | ${j.failed} |`);
  }
  lines.push('');
  lines.push('## total board stats by wave — median (p80)');
  lines.push('');
  lines.push(`| wave | ${['corpus', ...jobs.map((j) => j.id)].join(' | ')} |`);
  lines.push(`|---|${['corpus', ...jobs].map(() => '---').join('|')}|`);
  for (const w of WAVES) {
    const cells = [corpus?.byWave.get(w) ?? [], ...jobs.map((j) => j.curve.byWave.get(w) ?? [])]
      .map((xs) => (xs.length ? `${quantile(xs, 0.5).toFixed(0)} (${quantile(xs, 0.8).toFixed(0)}) n=${xs.length}` : '—'));
    lines.push(`| ${w} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## win rate / hand size / goldens on board by round (pilot)');
  lines.push('');
  lines.push(`| round | ${jobs.map((j) => `${j.id} win% / hand / goldens`).join(' | ')} |`);
  lines.push(`|---|${jobs.map(() => '---').join('|')}|`);
  for (const w of WAVES) {
    const cells = jobs.map((j) => {
      const ws = j.wins.get(w) ?? [];
      const hs = j.hand.get(w) ?? [];
      const gs = j.goldens.get(w) ?? [];
      return ws.length ? `${(100 * mean(ws)).toFixed(0)}% / ${mean(hs).toFixed(1)} / ${mean(gs).toFixed(2)} (n=${ws.length})` : '—';
    });
    lines.push(`| ${w} | ${cells.join(' | ')} |`);
  }
  console.log(lines.join('\n'));
}

main();
