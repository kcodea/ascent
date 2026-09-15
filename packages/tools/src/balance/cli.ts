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
import { completedSeeds, createJob, listJobs, loadJob, writeLobby, writeSummary } from './store';
import { loadManifest } from './manifest';
import { computeNodeIdentity } from './identity';
import { buildPool, registerPool } from './pool';
import { applyContentOverlay } from '@game/sim/balance/overlay';
import { createRecorder, pilotFor, runSelfPlayLobby, synthesizeLobby, syntheticIdentity, syntheticManifest, type ExperimentIdentity, type SyntheticOptions } from './deps';
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
    case 'pool': {
      // A versioned opponent panel from a finished job's round snapshots (see pool.ts).
      const jobId = need(args, 'job'); const name = str(args, 'out') ?? `${jobId}-pool`;
      const file = buildPool(jobId, name, { perWaveCap: num(args, 'per-wave', 400) });
      const waves = new Map<number, number>(); for (const b of file.boards) waves.set(b.wave, (waves.get(b.wave) ?? 0) + 1);
      console.log(`pool "${name}" (${file.setId}): ${file.boards.length} boards from job "${jobId}", digest ${file.digest}`);
      console.log('  per wave: ' + [...waves.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `${w}:${n}`).join(' '));
      console.log(`  name it in a manifest as  "opponentPool": { "name": "${name}", "digest": "${file.digest}" }`);
      return;
    }
    case 'list': { for (const j of listJobs()) console.log(j); return; }
    case 'run': {
      // THE LEVER (roadmap "The day-to-day balance lever"): manifest → identity → job → one authoritative self-play
      // lobby per seed (B1's runner, B5's recorder) → resumable job files → summary. A lobby that fails is written
      // as a censored record, never dropped, so the coverage ledger sees it.
      const manifest = loadManifest(need(args, 'manifest'));
      if (manifest.mode !== 'selfPlayLobby') throw new Error(`balance:run — mode "${manifest.mode}" is not runnable yet (only selfPlayLobby is wired)`);
      // The CANDIDATE OVERLAY (overlay.ts) goes on BEFORE the identity, so contentDigest tells the truth about the build.
      for (const d of applyContentOverlay(manifest.overlay)) console.log(`overlay ${d.cardId}: ${d.before}  →  ${d.after}`);
      const identity = computeNodeIdentity(manifest);
      // The opponent PANEL (balance:pool): registered once, before any lobby, and only the digest the manifest names.
      if (manifest.opponentPool) console.log(`opponent pool "${manifest.opponentPool.name}": ${registerPool(manifest.opponentPool)} boards registered`);
      else console.log('no opponent pool named — the pilot scores against the procedural threat curve (flagged on every fightScore)');
      const jobId = str(args, 'out') ?? `${manifest.name}-${identity.manifestDigest.slice(0, 8)}`;
      createJob(jobId, manifest, identity);
      const done = completedSeeds(jobId, manifest, identity);
      const budgetOverride = str(args, 'budget');
      let ran = 0, skipped = 0, failed = 0; const t0 = Date.now();
      for (let seed = manifest.seeds.start; seed < manifest.seeds.start + manifest.seeds.count; seed++) {
        if (done.has(seed)) { skipped++; continue; }
        const lobbyId = `${manifest.mode}:${manifest.setId}:${manifest.policy.id}:${seed}`;
        const recorder = createRecorder(lobbyId, seed, manifest, identity);
        const pilot = pilotFor(budgetOverride ? `${manifest.policy.id}:${budgetOverride}` : manifest.policy.id, manifest.policy.budget);
        const record = runSelfPlayLobby(manifest, seed, () => pilot, recorder, identity);
        writeLobby(jobId, record);
        ran++; if (record.failure) failed++;
        if (ran % 5 === 0 || record.failure) console.log(`  seed ${seed}: ${record.failure ? 'FAILED — ' + record.failure : record.roundsPlayed + ' rounds'} (${Math.round((Date.now() - t0) / ran)} ms/lobby avg)`);
      }
      const job = loadJob(jobId);
      const agg = aggregate(job.lobbies, { minSupport: num(args, 'min-support', 20), bootstrapReps: num(args, 'reps', 1000), seed: num(args, 'seed', 1) });
      writeSummary(jobId, agg.coverage);
      console.log(`job "${jobId}": ${ran} lobbies run (${failed} failed), ${skipped} resumed, ${Math.round((Date.now() - t0) / 1000)}s → ${job.dir}`);
      console.log(`report: npm run balance:report -- --job ${jobId}`);
      return;
    }
    default:
      console.log('usage: balance <report|compare|synth|list|run> [--flags]  (see packages/tools/src/balance/cli.ts)');
  }
}

main();
