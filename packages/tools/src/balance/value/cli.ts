/**
 * LEARNED VALUE — the CLI.
 *
 *   npm run balance:value:dataset -- --corpus set2-players-v1 --jobs set2-pinned-gen-smoke100,set2-pinned-gen-dev100 --out set2-v1
 *   npm run balance:value:fit     -- --dataset set2-v1 --out set2-v1 [--lambda 3] [--folds 5] [--pinned-weight 1] [--sweep 0.3,1,3,10,30]
 *   npm run balance:value:report  -- --model set2-v1 [--dataset set2-v1]   (re-validates when a dataset is named; else prints the stored validation)
 *
 * Datasets live under packages/tools/src/balance/out/value/<name>.json (gitignored); fitted models are written to
 * packages/sim/src/balance/value/models/<name>.json (COMMITTED — the sim ships them).
 */
import { readFileSync } from 'node:fs';
import { buildDataset, describeDataset, loadDataset, writeDataset } from './dataset';
import { crossValidate, fitFinal, modelPath, renderValueReport, writeModel, type Validation } from './fit';
import { DEFAULT_LAMBDA, validateModel, type ValueModel } from '@game/sim/balance/value/index';

type Args = Record<string, string | true>;
function parseArgs(argv: readonly string[]): { cmd: string; args: Args } {
  const [cmd = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[a.slice(2)] = next; i++; } else args[a.slice(2)] = true;
  }
  return { cmd, args };
}
const str = (args: Args, k: string, d?: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : d);
const num = (args: Args, k: string, d: number): number => { const v = str(args, k); return v === undefined ? d : Number(v); };
const need = (args: Args, k: string): string => { const v = str(args, k); if (!v) throw new Error(`missing --${k}`); return v; };

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const { cmd, args } = parseArgs(argv);
  switch (cmd) {
    case 'dataset': {
      const name = str(args, 'out') ?? 'set2-v1';
      const jobIds = (str(args, 'jobs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const ds = buildDataset({ name, ...(str(args, 'corpus') ? { corpusName: str(args, 'corpus') } : {}), jobIds });
      const path = writeDataset(ds);
      console.log(describeDataset(ds));
      console.log(`wrote ${path}`);
      return;
    }
    case 'fit': {
      const ds = loadDataset(need(args, 'dataset'));
      const name = str(args, 'out') ?? ds.name;
      const opts = { lambda: num(args, 'lambda', DEFAULT_LAMBDA), folds: num(args, 'folds', 5), pinnedWeight: num(args, 'pinned-weight', 1) };
      const sweep = str(args, 'sweep');
      if (sweep) {
        console.log(`λ sweep (${opts.folds}-fold by run):`);
        for (const l of sweep.split(',').map(Number).filter(Number.isFinite)) {
          const { validation: v } = crossValidate(ds, { ...opts, lambda: l });
          console.log(`  λ ${String(l).padEnd(5)} R² ${v.overall.model.r2.toFixed(3)} (null ${v.overall.null.r2.toFixed(3)})  ρ ${v.overall.model.spearman.toFixed(3)}  MAE ${v.overall.model.mae.toFixed(3)}  | corpus R² ${(v.bySource['corpus']?.model.r2 ?? NaN).toFixed(3)}  pinned R² ${(v.bySource['pinned']?.model.r2 ?? NaN).toFixed(3)}`);
        }
      }
      const { model, validation } = fitFinal(ds, name, opts);
      const path = writeModel(model);
      console.log(renderValueReport(model, validation, { buckets: ds.buckets }));
      console.log(`\nwrote ${path}`);
      return;
    }
    case 'report': {
      const name = need(args, 'model');
      const raw = JSON.parse(readFileSync(modelPath(name), 'utf8')) as unknown;
      if (!validateModel(raw)) throw new Error(`balance:value — model "${name}" does not match the live feature schema; re-fit it`);
      const model: ValueModel = raw;
      const dsName = str(args, 'dataset');
      let validation: Validation | null = (model.meta as { validation?: Validation }).validation ?? null;
      let buckets: { id: string; rule: string }[] | undefined;
      if (dsName) { const ds = loadDataset(dsName); validation = crossValidate(ds, { lambda: model.lambda, folds: num(args, 'folds', 5), pinnedWeight: num(args, 'pinned-weight', 1) }).validation; buckets = ds.buckets; }
      console.log(renderValueReport(model, validation, { top: num(args, 'top', 10), ...(buckets ? { buckets } : {}) }));
      return;
    }
    default:
      console.log('usage: balance:value:dataset | balance:value:fit | balance:value:report — see the header of packages/tools/src/balance/value/cli.ts');
  }
}

try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
