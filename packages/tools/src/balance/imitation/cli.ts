/**
 * IMITATION (B7) — the CLI.
 *
 *   npm run balance:imitation:study  -- --corpus set2-players-v1 [--out docs/balance-bot-player-study.md]
 *   npm run balance:imitation:fit    -- --corpus set2-players-v1 --out set2-v1 [--horizon 3] [--prior 8] [--min-boards 8] [--pair-min-boards 8] [--mode after|odds] [--off focus,pairs]
 *   npm run balance:imitation:report -- --model set2-v1 [--corpus set2-players-v1] [--top 25]
 *
 * The study is Markdown (committed as docs/balance-bot-player-study.md — regenerate, never hand-edit); fitted models
 * are written to packages/sim/src/balance/imitation/models/<name>.json (COMMITTED — the sim ships them).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../corpus';
import { findingsOf, renderStudy, studyCorpus } from '@game/sim/balance/imitation/study';
import { DEFAULT_FIT, fitImitation, renderImitationReport, validateImitationModel, crossValidateImitation, type FitOptions, type ImitationModel } from '@game/sim/balance/imitation/model';

export const MODELS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../sim/src/balance/imitation/models');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

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

export const modelPath = (name: string): string => join(MODELS_DIR, `${name}.json`);

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const { cmd, args } = parseArgs(argv);
  const corpusName = str(args, 'corpus', 'set2-players-v1')!;
  switch (cmd) {
    case 'study': {
      const corpus = loadCorpus(corpusName);
      const study = studyCorpus(corpus.boards, { setId: corpus.setId, horizon: num(args, 'horizon', 3) });
      const out = str(args, 'out');
      const path = out ? resolve(REPO_ROOT, out) : null;
      const existing = path && existsSync(path) ? readFileSync(path, 'utf8') : null;
      const md = renderStudy(study, { corpusName: corpus.name, digest: corpus.digest, date: new Date().toISOString().slice(0, 10), findings: findingsOf(existing) });
      if (path) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, md + '\n');
        console.log(`wrote ${path}`);
      } else console.log(md);
      return;
    }
    case 'fit': {
      const corpus = loadCorpus(corpusName);
      const name = str(args, 'out', 'set2-v1')!;
      const off = (str(args, 'off') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const terms: FitOptions['terms'] = {};
      for (const k of off) terms[k as keyof NonNullable<FitOptions['terms']>] = false;
      const opts: FitOptions = {
        horizon: num(args, 'horizon', 3), prior: num(args, 'prior', DEFAULT_FIT.prior), minBoards: num(args, 'min-boards', DEFAULT_FIT.minBoards),
        pairMinBoards: num(args, 'pair-min-boards', DEFAULT_FIT.pairMinBoards), mode: (str(args, 'mode') as FitOptions['mode']) ?? DEFAULT_FIT.mode, terms,
      };
      const cv = crossValidateImitation(corpus.boards, { ...opts, setId: corpus.setId, folds: num(args, 'folds', 5) });
      const model = fitImitation(corpus.boards, { ...opts, name, setId: corpus.setId, corpus: { name: corpus.name, digest: corpus.digest }, validation: cv });
      mkdirSync(MODELS_DIR, { recursive: true });
      writeFileSync(modelPath(name), JSON.stringify(model, null, 1) + '\n');
      console.log(renderImitationReport(model, { top: num(args, 'top', 20) }));
      console.log(`\nwrote ${modelPath(name)}`);
      return;
    }
    case 'report': {
      const name = str(args, 'model', 'set2-v1')!;
      const raw = JSON.parse(readFileSync(modelPath(name), 'utf8')) as unknown;
      if (!validateImitationModel(raw)) throw new Error(`balance:imitation — model "${name}" is not a valid imitation model`);
      const model: ImitationModel = raw;
      console.log(renderImitationReport(model, { top: num(args, 'top', 20) }));
      return;
    }
    default:
      console.log('usage: balance:imitation:study | balance:imitation:fit | balance:imitation:report — see the header of packages/tools/src/balance/imitation/cli.ts');
  }
}

try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
