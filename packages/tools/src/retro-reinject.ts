/**
 * `npm run docbot:retro` — the retro reinject harness, in TypeScript (2026-09-11; replaces the attended
 * Python `packages/tools/retro/reinject.py` + `reinject.sh`).
 *
 * For every catalog entry (packages/sim/src/docbot/retroCatalog.ts): apply its minimal source patch in a
 * THROWAWAY git worktree (`.local/retro-worktree`, created from HEAD and removed on exit — the launching
 * tree is never touched), run the cited generic lanes plus the whole docbot directory through vitest's JSON
 * reporter, and classify CAUGHT / MISSED / UNPATCHABLE / UNMEASURABLE. Prints the table, writes
 * `findings.json` (the shared `DocbotFinding` shape, byte-stable) + `results.json`, and — with `--check` —
 * exits 1 on a REGRESSION: an entry the ledger records as CAUGHT that now reads anything else, or a patch
 * that no longer applies. New entries measured MISSED never fail; they are the build order.
 *
 *   npm run docbot:retro                          # every entry, table + artifacts/docbot-retro/
 *   npm run docbot:retro -- --only 9852e16f-gifts-no-target,7e04222d-free-rally-watchers
 *   npm run docbot:retro -- --check               # CI mode: exit 1 on a regression
 *   npm run docbot:retro -- --cited-only          # skip the docbot directory (fast local probe of one lane)
 *   npm run docbot:retro -- --keep                # leave the throwaway worktree for inspection
 *   npm run docbot:retro -- --out somewhere       # artifact directory (default artifacts/docbot-retro)
 *
 * WHY A WORKTREE INSIDE THE REPO: node resolution walks UP from the throwaway, so the launching tree's
 * node_modules serve it without a second install; the generated `vitest.retro.config.ts` re-aliases every
 * `@game/*` entrypoint into the throwaway so the PATCHED packages are what the tests load (the
 * docs/concurrency.md symlink trap, defused on purpose). The throwaway is HEAD — commit before you measure.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RETRO_CATALOG, applyPatchOp, retroCatalogErrors, type RetroCatalogEntry } from '@game/sim';
import {
  classifyRun, emitFindingsJson, ledgerVerdict, regressions, renderRetroVitestConfig, renderTable, retroAliasEntries,
  retroFindings, suiteFor, type RetroResult, type VitestJsonReport,
} from './retro-reinject.lib';

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const git = (args: string[], cwd: string): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const ROOT = git(['rev-parse', '--show-toplevel'], process.cwd());
const THROWAWAY = resolve(ROOT, '.local', 'retro-worktree');
const OUT = resolve(ROOT, flag('out', join('artifacts', 'docbot-retro'))!);
const TODAY = flag('today', new Date().toISOString().slice(0, 10))!;
const ONLY = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);

const structural = retroCatalogErrors();
if (structural.length > 0) {
  console.error('retro catalog is not well-formed:');
  for (const e of structural) console.error(`  · ${e}`);
  process.exit(2);
}

const entries: RetroCatalogEntry[] = RETRO_CATALOG.filter((e) => !ONLY || ONLY.includes(e.id));
if (entries.length === 0) {
  console.error(`no catalog entries match --only ${ONLY?.join(',')}; ids: ${RETRO_CATALOG.map((e) => e.id).join(', ')}`);
  process.exit(2);
}

// ── the throwaway worktree: create from HEAD, remove on ANY exit ────────────────────────────────────────────
const dirty = git(['status', '--porcelain', '--', 'packages'], ROOT);
if (dirty) console.warn(`  ! uncommitted changes under packages/ — the throwaway is HEAD, so they are NOT measured:\n${dirty.split('\n').map((l) => `      ${l}`).join('\n')}`);

const removeThrowaway = (): void => {
  try { git(['worktree', 'remove', '--force', THROWAWAY], ROOT); } catch { /* not registered (or already gone) */ }
  try { if (existsSync(THROWAWAY)) rmSync(THROWAWAY, { recursive: true, force: true }); } catch { /* best effort */ }
  try { git(['worktree', 'prune'], ROOT); } catch { /* best effort */ }
};

removeThrowaway(); // a run killed mid-way leaves one behind — never reuse it
git(['worktree', 'add', '--detach', THROWAWAY, 'HEAD'], ROOT);
const KEEP = has('keep');
process.on('exit', () => { if (!KEEP) removeThrowaway(); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { process.exit(130); });

// The alias config: every @game/* entrypoint → the throwaway's own packages.
const pkgs = ['core', 'content', 'rules', 'sim', 'ui'].map((dir) => {
  const pkg = JSON.parse(readFileSync(join(THROWAWAY, 'packages', dir, 'package.json'), 'utf8')) as { name: string; exports?: Record<string, string> };
  return { dir: `packages/${dir}`, name: pkg.name, exports: pkg.exports ?? { '.': './src/index.ts' } };
});
writeFileSync(join(THROWAWAY, 'vitest.retro.config.ts'), renderRetroVitestConfig(retroAliasEntries(pkgs, THROWAWAY)));

const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const RESULT_JSON = join(THROWAWAY, '.retro-result.json');

function runVitest(files: string[]): VitestJsonReport | null {
  if (existsSync(RESULT_JSON)) rmSync(RESULT_JSON);
  const res = spawnSync(process.execPath, [VITEST, 'run', '-c', 'vitest.retro.config.ts', '--reporter=json', `--outputFile=${RESULT_JSON}`, ...files], {
    cwd: THROWAWAY, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });
  if (!existsSync(RESULT_JSON)) {
    console.error(`    vitest produced no report (exit ${res.status}); stderr tail:\n${(res.stderr ?? '').split('\n').slice(-12).join('\n')}`);
    return null;
  }
  return JSON.parse(readFileSync(RESULT_JSON, 'utf8')) as VitestJsonReport;
}

const citedOnly = has('cited-only');
const results: RetroResult[] = [];
console.log(`\n══ DOCBOT RETRO REINJECT ═══════════════════════════════════════════════════`);
console.log(`  throwaway ${THROWAWAY} @ ${git(['rev-parse', '--short', 'HEAD'], THROWAWAY)} · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${citedOnly ? ' · cited lanes only' : ''}\n`);

for (const entry of entries) {
  const started = Date.now();
  git(['checkout', '--', 'packages'], THROWAWAY); // every entry starts from clean HEAD
  const scope = entry.scope.kind;
  const ledger = ledgerVerdict(entry);
  let unpatchable: string | undefined;
  if (entry.patch.length === 0) unpatchable = 'no patch yet (pending stub)';
  for (const op of entry.patch) {
    if (unpatchable) break;
    const path = join(THROWAWAY, op.file);
    if (!existsSync(path)) { unpatchable = `${op.file} does not exist`; break; }
    const applied = applyPatchOp(readFileSync(path, 'utf8'), op);
    if (!applied.ok) { unpatchable = applied.error; break; }
    writeFileSync(path, applied.text);
  }
  if (unpatchable) {
    results.push({ id: entry.id, verdict: 'UNPATCHABLE', caughtBy: [], detail: unpatchable, ledger, scope });
    console.log(`  ${entry.id.padEnd(36)} UNPATCHABLE  ${unpatchable}`);
    continue;
  }
  const report = runVitest(suiteFor(entry, { citedOnly }));
  const r = classifyRun(entry, report, THROWAWAY);
  results.push({ ...r, ledger, scope });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  ${entry.id.padEnd(36)} ${r.verdict.padEnd(12)} ${r.verdict === 'CAUGHT' ? r.caughtBy.join(', ') : r.detail}  (${secs}s)`);
}
git(['checkout', '--', 'packages'], THROWAWAY);

// ── report + artifacts ──────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${renderTable(results, RETRO_CATALOG, TODAY)}\n`);

mkdirSync(OUT, { recursive: true });
const findings = retroFindings(results, RETRO_CATALOG);
writeFileSync(join(OUT, 'findings.json'), `${emitFindingsJson(findings)}\n`);
const stable = [...results].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => ({ ...r, caughtBy: [...r.caughtBy].sort() }));
writeFileSync(join(OUT, 'results.json'), `${JSON.stringify({ schemaVersion: 1, lane: 'retro-reinject', results: stable }, null, 2)}\n`);
console.log(`  artifacts → ${join(OUT, 'findings.json')} (${findings.length} finding(s)) · ${join(OUT, 'results.json')}`);

const regs = regressions(results);
if (has('check') && regs.length > 0) {
  console.error(`\n✗ ${regs.length} retro regression(s) — a generic oracle the ledger relies on no longer catches its bug.`);
  process.exitCode = 1;
} else if (has('check')) {
  console.log('\n✓ no retro regressions: every ledger CAUGHT still catches.');
}
