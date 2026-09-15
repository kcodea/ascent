/**
 * BALANCE BOT — the day-to-day lever (docs/balance-bot-roadmap.md, "The day-to-day balance lever").
 *
 *   npm run balance:report  -- --job <id> [--format md|json] [--out <file>] [--min-support 20] [--reps 1000]
 *   npm run balance:compare -- --baseline <id> --candidate <id> [--allow-diff contentDigest,manifestDigest]   (a data patch)
 *                              [--target hero:warden] [--out <file>]
 *   npm run balance:synth   -- --set set3 --seeds 20 [--start 1] [--out <jobId>] [--heroes a,b,c] [--nerf <heroId>=<bias>] [--fail-rate 0.1]
 *   npm run balance:run     -- --manifest <experiment.json>      (STUB — errors until the runner (B1) is integrated)
 *
 * Reports print to stdout unless `--out` names a file. Jobs live under packages/tools/src/balance/out/<jobId>/.
 */
import { writeFileSync } from 'node:fs';
import { aggregate } from './aggregate';
import { renderReport } from './report';
import { compareJobs, renderComparison, type CompareOptions } from './compare';
import { createJob, listJobs, loadJob, writeLobby, writeSummary } from './store';
import { synthesizeLobby, syntheticIdentity, syntheticManifest, type ExperimentIdentity, type SyntheticOptions } from './deps';
import type { SetId } from '@game/content';

type Args = Record<string, string | true>;
function parseArgs(argv: readonly string[]): { cmd: string; args: Args } {
  const [cmd = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; } else args[key] = true;
  }
  return { cmd, args };
}
const str = (args: Args, k: string, d?: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : d);
const num = (args: Args, k: string, d: number): number => { const v = str(args, k); return v === undefined ? d : Number(v); };
const need = (args: Args, k: string): string => { const v = str(args, k); if (!v) throw new Error(`missing --${k}`); return v; };

function emit(text: string, out: string | undefined): void {
  if (out) { writeFileSync(out, text, 'utf8'); console.log(`wrote ${out} (${text.length} chars)`); } else console.log(text);
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const { cmd, args } = parseArgs(argv);
  switch (cmd) {
    case 'report': {
      const job = loadJob(need(args, 'job'));
      const agg = aggregate(job.lobbies, { minSupport: num(args, 'min-support', 20), bootstrapReps: num(args, 'reps', 1000), seed: num(args, 'seed', 1) });
      if (job.rejected.length) console.error(`note: ${job.rejected.length} lobby file(s) rejected: ${job.rejected.map((r) => `${r.seed} (${r.reason})`).join('; ')}`);
      writeSummary(job.jobId, agg);
      const format = (str(args, 'format', 'md') as 'md' | 'json');
      emit(renderReport(agg, { format, manifest: job.manifest, identity: job.identity, jobId: job.jobId, maxRows: num(args, 'max-rows', 60) }), str(args, 'out'));
      return;
    }
    case 'compare': {
      const base = loadJob(need(args, 'baseline')); const cand = loadJob(need(args, 'candidate'));
      const allow = (str(args, 'allow-diff') ?? '').split(',').map((s) => s.trim()).filter(Boolean) as (keyof ExperimentIdentity)[];
      const t = str(args, 'target');
      const target = t ? ({ kind: t.split(':')[0] as NonNullable<CompareOptions['target']>['kind'], id: t.split(':').slice(1).join(':') }) : undefined;
      const cmp = compareJobs(base.lobbies, cand.lobbies, { allowDiff: allow, target, minSupport: num(args, 'min-support', 20), bootstrapReps: num(args, 'reps', 1000), seed: num(args, 'seed', 1) });
      const format = str(args, 'format', 'md');
      emit(format === 'json' ? JSON.stringify(cmp, null, 2) : renderComparison(cmp, { baselineId: base.jobId, candidateId: cand.jobId, target, maxRows: num(args, 'max-rows', 25) }), str(args, 'out'));
      return;
    }
    case 'synth': {
      const setId = (str(args, 'set', 'set3') as SetId);
      const seeds = { start: num(args, 'start', 1), count: num(args, 'seeds', 20) };
      const jobId = str(args, 'out') ?? `synth-${setId}-${seeds.start}-${seeds.count}`;
      const opts: SyntheticOptions = { failRate: num(args, 'fail-rate', 0) };
      const nerf = str(args, 'nerf');
      if (nerf) { const [id, bias] = nerf.split('='); opts.heroBias = { [id]: Number(bias ?? '1') }; }
      const tag = nerf ? `synthetic-nerf-${nerf.replace(/[^A-Za-z0-9]/g, '_')}` : 'synthetic';
      const heroes = (str(args, 'heroes') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
      const manifest = syntheticManifest(setId, seeds, { name: jobId, ...(heroes.length ? { heroes } : {}) });
      const identity = syntheticIdentity(manifest, tag);
      createJob(jobId, manifest, identity);
      let n = 0;
      for (let s = seeds.start; s < seeds.start + seeds.count; s++) { writeLobby(jobId, synthesizeLobby(s, manifest, identity, opts)); n++; }
      console.log(`synthetic job "${jobId}": ${n} lobbies (${setId}, seeds ${seeds.start}…${seeds.start + seeds.count - 1}${nerf ? `, nerf ${nerf}` : ''}) → ${loadJob(jobId).dir}`);
      return;
    }
    case 'list': { for (const j of listJobs()) console.log(j); return; }
    case 'run':
      // Left for the integrator: when the runner (B1's `selfPlayLobby`) lands, this reads the manifest, builds the
      // identity, opens the job, skips `completedSeeds`, drives one recorder per seed and `writeLobby`s each result.
      throw new Error('balance:run — runner not integrated (B1 selfPlayLobby is not on this branch). Use balance:synth to exercise the report.');
    default:
      console.log('usage: balance <report|compare|synth|list|run> [--flags]  (see packages/tools/src/balance/cli.ts)');
  }
}

main();
