/**
 * docbot:retro — the pure half, sabotage-proofed without a worktree or a vitest run: suite composition (pins
 * never run), classification of a vitest JSON report, the regression rule, findings shape, and the alias
 * table that makes the throwaway load its OWN packages.
 */
import { describe, expect, it } from 'vitest';
import { RETRO_CATALOG, RETRO_SUITE_EXTRA, type RetroCatalogEntry } from '@game/sim';
import {
  DOCBOT_DIR, classifyRun, ledgerDrift, regressions, renderRetroVitestConfig, renderTable, retroAliasEntries,
  retroFindings, suiteFor, type RetroResult, type VitestJsonReport,
} from './retro-reinject.lib';

const entry = (over: Partial<RetroCatalogEntry> = {}): RetroCatalogEntry => ({
  id: 'zz-test', title: 'a test bug', fixCommits: ['abc'], reportDate: '2026-09-01',
  patch: [{ file: 'packages/x.ts', find: 'a', replace: 'b' }],
  lanes: ['packages/sim/src/docbot/combatModLane.test.ts'],
  regressionLanes: ['packages/sim/src/gifts.test.ts'],
  scope: { kind: 'generic' },
  verifiedBy: { kind: 'reinject-run', date: '2026-09-11', verdict: 'CAUGHT', caughtBy: ['packages/sim/src/docbot/combatModLane.test.ts'] },
  ...over,
});

describe('suiteFor', () => {
  it('runs the cited lanes + the extras + the docbot directory, NEVER the regression pin', () => {
    const files = suiteFor(entry());
    expect(files).toContain(DOCBOT_DIR);
    expect(files).toContain('packages/sim/src/docbot/combatModLane.test.ts');
    for (const x of RETRO_SUITE_EXTRA) expect(files).toContain(x);
    expect(files).not.toContain('packages/sim/src/gifts.test.ts');
    expect(suiteFor(entry(), { citedOnly: true })).toEqual(['packages/sim/src/docbot/combatModLane.test.ts']);
  });
});

describe('classifyRun', () => {
  const root = 'C:\\repo\\.local\\retro-worktree';
  const rep = (over: Partial<VitestJsonReport>): VitestJsonReport => ({ numTotalTests: 10, numFailedTests: 0, testResults: [], ...over });

  it('CAUGHT names the red lanes repo-relative, sorted and unique', () => {
    const r = classifyRun(entry(), rep({
      numFailedTests: 3,
      testResults: [
        { name: `${root}\\packages\\sim\\src\\docbot\\b.test.ts`, status: 'failed' },
        { name: `${root}\\packages\\sim\\src\\docbot\\a.test.ts`, status: 'failed' },
        { name: `${root}\\packages\\sim\\src\\docbot\\a.test.ts`, status: 'failed' },
        { name: `${root}\\packages\\sim\\src\\docbot\\c.test.ts`, status: 'passed' },
      ],
    }), root);
    expect(r.verdict).toBe('CAUGHT');
    expect(r.caughtBy).toEqual(['packages/sim/src/docbot/a.test.ts', 'packages/sim/src/docbot/b.test.ts']);
  });

  it('SABOTAGE — the harness\'s own anchor lane going red is NOT a catch (the 100%-by-construction trap)', () => {
    const r = classifyRun(entry(), rep({
      numFailedTests: 1,
      testResults: [{ name: `${root}\\packages\\sim\\src\\docbot\\retroCatalog.test.ts`, status: 'failed' }],
    }), root);
    expect(r.verdict).toBe('MISSED');
    expect(renderRetroVitestConfig([])).toContain('"packages/sim/src/docbot/retroCatalog.test.ts"');
  });

  it('MISSED when everything is green; UNMEASURABLE when nothing ran or no report came back', () => {
    expect(classifyRun(entry(), rep({}), root).verdict).toBe('MISSED');
    expect(classifyRun(entry(), rep({ numTotalTests: 0 }), root).verdict).toBe('UNMEASURABLE');
    expect(classifyRun(entry(), null, root).verdict).toBe('UNMEASURABLE');
  });
});

describe('the regression rule', () => {
  const res = (over: Partial<RetroResult>): RetroResult => ({ id: 'x', verdict: 'CAUGHT', caughtBy: [], detail: '', ledger: 'CAUGHT', scope: 'generic', ...over });

  it('a ledger CAUGHT that now reads MISSED is a regression; a new MISSED is not; MISSED→CAUGHT is drift to bank', () => {
    const results = [
      res({ id: 'still', ledger: 'CAUGHT', verdict: 'CAUGHT' }),
      res({ id: 'lost', ledger: 'CAUGHT', verdict: 'MISSED' }),
      res({ id: 'new-miss', ledger: 'MISSED', verdict: 'MISSED' }),
      res({ id: 'stub', ledger: 'pending', verdict: 'MISSED' }),
      res({ id: 'won', ledger: 'MISSED', verdict: 'CAUGHT', caughtBy: ['packages/sim/src/docbot/x.test.ts'] }),
    ];
    expect(regressions(results).map((g) => g.id)).toEqual(['lost']);
    expect(ledgerDrift(results).map((d) => d.id)).toEqual(['lost', 'stub', 'won']);
  });

  it('UNPATCHABLE / UNMEASURABLE are always regressions (of the harness itself)', () => {
    expect(regressions([res({ id: 'a', ledger: 'MISSED', verdict: 'UNPATCHABLE', detail: 'anchor' })]).map((g) => g.now)).toEqual(['UNPATCHABLE']);
    expect(regressions([res({ id: 'b', ledger: 'pending', verdict: 'UNMEASURABLE' })]).length).toBe(1);
  });
});

describe('findings + table', () => {
  const res = (over: Partial<RetroResult>): RetroResult => ({ id: 'zz-test', verdict: 'MISSED', caughtBy: [], detail: '9 green', ledger: 'MISSED', scope: 'generic', ...over });

  it('emits a coverage-gap per generic MISS, a mechanical-bug per regression, nothing for an out-of-scope miss', () => {
    const cat = [entry({ id: 'zz-test', verifiedBy: { kind: 'reinject-run', date: '2026-09-11', verdict: 'MISSED' } }),
      entry({ id: 'zz-lost' }),
      entry({ id: 'zz-oos', scope: { kind: 'out-of-scope', reason: 'presentation' }, verifiedBy: { kind: 'reinject-run', date: '2026-09-11', verdict: 'MISSED' } })];
    const findings = retroFindings([
      res({ id: 'zz-test' }),
      res({ id: 'zz-lost', ledger: 'CAUGHT', verdict: 'MISSED' }),
      res({ id: 'zz-oos', scope: 'out-of-scope' }),
    ], cat);
    expect(findings.map((f) => [f.class, f.severity])).toEqual([['coverage-gap', 'warning'], ['verified-mechanical-bug', 'error']]);
    for (const f of findings) {
      expect(f.lane).toBe('retro-reinject');
      expect(f.reproduction).toMatch(/npm run docbot:retro -- --only zz-/);
      expect(f.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('fingerprints are structural: the same verdict on another day is the same finding', () => {
    const cat = [entry({ id: 'zz-test', verifiedBy: { kind: 'reinject-run', date: '2026-09-11', verdict: 'MISSED' } })];
    const a = retroFindings([res({})], cat)[0]!;
    const b = retroFindings([res({ detail: '11 green (another day)' })], cat)[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.id).toBe(b.id);
  });

  it('the table carries the derived catch rate, the build order, and drift to paste', () => {
    const text = renderTable([
      res({ id: '1176-avenge-arrival', ledger: 'CAUGHT', verdict: 'CAUGHT', caughtBy: ['packages/sim/src/docbot/temporalWindow.test.ts'] }),
      res({ id: '9852e16f-gifts-no-target', ledger: 'CAUGHT', verdict: 'MISSED' }),
    ], RETRO_CATALOG, '2026-09-11');
    expect(text).toContain('forward catch rate (generic entries, as measured):');
    expect(text).toContain('docbot/temporalWindow.test.ts');
    expect(text).toContain('REGRESSIONS (1)');
    expect(text).toContain('9852e16f-gifts-no-target: ledger CAUGHT → measured MISSED');
  });
});

describe('the alias table (the docs/concurrency.md symlink trap, defused)', () => {
  it('maps every export subpath into the throwaway, deeper paths first, regex-exact', () => {
    const entries = retroAliasEntries([
      { dir: 'packages/rules', name: '@game/rules', exports: { '.': './src/index.ts', './contracts': './src/contracts/index.ts', './contracts/schema': './src/contracts/schema.ts' } },
      { dir: 'packages/sim', name: '@game/sim', exports: { '.': './src/index.ts' } },
    ], 'C:\\repo\\.local\\retro-worktree');
    expect(entries[0]!.find).toBe('^@game\\/rules\\/contracts\\/schema$');
    expect(entries.map((e) => e.replacement)).toContain('C:/repo/.local/retro-worktree/packages/sim/src/index.ts');
    expect(entries.find((e) => e.find === '^@game\\/rules\\/contracts$')!.replacement).toBe('C:/repo/.local/retro-worktree/packages/rules/src/contracts/index.ts');
    const cfg = renderRetroVitestConfig(entries);
    expect(cfg).toContain("import base from './vitest.config';");
    expect(cfg).toContain('{ find: /^@game\\/sim$/, replacement: "C:/repo/.local/retro-worktree/packages/sim/src/index.ts" }');
  });
});
