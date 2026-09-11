/**
 * `npm run docbot:retro` — the pure half (2026-09-11). Everything the harness DECIDES lives here so it can be
 * tested without git, a throwaway worktree, or a vitest run: which files an entry runs, how a vitest JSON
 * report classifies, what counts as a regression of the ledger, the printed table, and the findings.
 *
 * The IO half (`retro-reinject.ts`) creates the throwaway worktree, applies the patch, spawns vitest and
 * feeds the JSON back through these functions.
 */
import {
  RETRO_SUITE_EXTRA, emitFindingsJson, makeFinding, retroCatchRate,
  type DocbotFinding, type RetroCatalogEntry, type RetroVerdict,
} from '@game/sim';

export const RETRO_LANE = 'retro-reinject';
/** The whole docbot directory — every generic lane — runs for every entry, cited or not. */
export const DOCBOT_DIR = 'packages/sim/src/docbot';
/** Lanes that test the HARNESS, not the game. retroCatalog.test.ts asserts every patch anchors on the
 *  source — which is false the moment a patch is applied — so inside the throwaway it goes red for every
 *  entry and would make the catch rate 100% by construction (the first full run measured exactly that,
 *  2026-09-11). Excluded from the run AND filtered from classification, so neither path can credit it. */
export const SELF_LANES: readonly string[] = ['packages/sim/src/docbot/retroCatalog.test.ts'];

/** The vitest filters an entry runs: its cited generic lanes, the standing extras and the docbot directory.
 *  Regression pins are NEVER included — a pin written for the bug is not generic evidence. */
export function suiteFor(entry: RetroCatalogEntry, opts: { citedOnly?: boolean } = {}): string[] {
  const files = new Set<string>(entry.lanes);
  if (!opts.citedOnly) {
    for (const f of RETRO_SUITE_EXTRA) files.add(f);
    files.add(DOCBOT_DIR);
  }
  return [...files].sort();
}

/** The subset of vitest's JSON reporter the harness reads. */
export interface VitestJsonReport {
  numTotalTests: number;
  numFailedTests: number;
  numFailedTestSuites?: number;
  success?: boolean;
  testResults: Array<{ name: string; status: string; message?: string }>;
}

export interface RetroResult {
  id: string;
  verdict: RetroVerdict;
  /** Repo-relative lane files that went red (sorted, unique). */
  caughtBy: string[];
  /** Human detail: the anchor error, or the test counts. */
  detail: string;
  /** What the ledger (the catalog's stored verdict) said BEFORE this run. */
  ledger: RetroVerdict | 'pending';
  scope: 'generic' | 'out-of-scope';
}

const toRepoRel = (abs: string, root: string): string => {
  const norm = abs.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/$/, '');
  return norm.startsWith(`${r}/`) ? norm.slice(r.length + 1) : norm;
};

/** Classify one run. `root` is the throwaway worktree the absolute file names are under. */
export function classifyRun(entry: RetroCatalogEntry, report: VitestJsonReport | null, root: string): Omit<RetroResult, 'ledger' | 'scope'> {
  if (!report) return { id: entry.id, verdict: 'UNMEASURABLE', caughtBy: [], detail: 'vitest produced no JSON report (crashed before collection?)' };
  const redFiles = report.testResults.filter((t) => t.status === 'failed').map((t) => toRepoRel(t.name, root));
  const caughtBy = [...new Set(redFiles.filter((f) => !SELF_LANES.includes(f)))].sort();
  if (caughtBy.length > 0) {
    return { id: entry.id, verdict: 'CAUGHT', caughtBy, detail: `${report.numFailedTests} test(s) red across ${caughtBy.length} lane(s)` };
  }
  if (report.numTotalTests > 0) return { id: entry.id, verdict: 'MISSED', caughtBy: [], detail: `${report.numTotalTests} tests green` };
  return { id: entry.id, verdict: 'UNMEASURABLE', caughtBy: [], detail: 'no tests ran' };
}

export function ledgerVerdict(entry: RetroCatalogEntry): RetroVerdict | 'pending' {
  return entry.verifiedBy.kind === 'reinject-run' ? entry.verifiedBy.verdict : 'pending';
}

export interface RetroRegression {
  id: string;
  was: RetroVerdict | 'pending';
  now: RetroVerdict;
  why: string;
}

/** The weekly's failure rule: an entry the ledger records as CAUGHT that now reads anything else is a
 *  regression of a generic oracle. UNPATCHABLE / UNMEASURABLE anywhere is a regression of the harness itself
 *  (the PR gate keeps anchors fresh, so it should be impossible on main). A NEW entry recorded MISSED is the
 *  build order, not a failure — and an entry that was MISSED and is now CAUGHT is progress to bank. */
export function regressions(results: readonly RetroResult[]): RetroRegression[] {
  const out: RetroRegression[] = [];
  for (const r of results) {
    if (r.ledger === 'CAUGHT' && r.verdict !== 'CAUGHT') {
      out.push({ id: r.id, was: r.ledger, now: r.verdict, why: 'the ledger records CAUGHT; a generic oracle lost its teeth' });
    } else if (r.verdict === 'UNPATCHABLE' || r.verdict === 'UNMEASURABLE') {
      out.push({ id: r.id, was: r.ledger, now: r.verdict, why: r.detail });
    }
  }
  return out;
}

/** Entries whose measured verdict differs from the ledger in EITHER direction — what to paste back. */
export function ledgerDrift(results: readonly RetroResult[]): RetroResult[] {
  return results.filter((r) => r.ledger !== r.verdict);
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));

export function renderTable(results: readonly RetroResult[], catalog: readonly RetroCatalogEntry[], today: string): string {
  const lines: string[] = [];
  lines.push(`${pad('id', 36)}${pad('scope', 14)}${pad('ledger', 13)}${pad('measured', 13)}caught by / detail`);
  for (const r of results) {
    const tail = r.verdict === 'CAUGHT' ? r.caughtBy.map((f) => f.replace(/^packages\/sim\/src\/docbot\//, 'docbot/')).join(', ') : r.detail;
    lines.push(`${pad(r.id, 36)}${pad(r.scope, 14)}${pad(r.ledger, 13)}${pad(r.verdict, 13)}${tail}`);
  }
  const measuredCatalog = catalog.map((e) => {
    const r = results.find((x) => x.id === e.id);
    return r ? { ...e, verifiedBy: { kind: 'reinject-run' as const, date: today, verdict: r.verdict, caughtBy: r.caughtBy } } : e;
  });
  const rate = retroCatchRate(measuredCatalog, today);
  lines.push('');
  lines.push(`forward catch rate (generic entries, as measured): ${rate.overall.caught}/${rate.overall.total}`
    + ` · trailing ${rate.trailing.days} days by report date (${rate.trailing.from} → ${rate.trailing.to}): ${rate.trailing.caught}/${rate.trailing.total}`
    + ` · out of scope ${rate.outOfScope} · pending ${rate.pending}`);
  if (rate.missed.length > 0) lines.push(`build order (still MISSED, oldest report first): ${rate.missed.join(', ')}`);
  const regs = regressions(results);
  if (regs.length > 0) {
    lines.push('');
    lines.push(`REGRESSIONS (${regs.length}):`);
    for (const g of regs) lines.push(`  ✗ ${g.id}: ledger ${g.was} → measured ${g.now} — ${g.why}`);
  }
  const drift = ledgerDrift(results).filter((d) => !regs.some((g) => g.id === d.id));
  if (drift.length > 0) {
    lines.push('');
    lines.push(`ledger drift to paste into retroCatalog.ts (${drift.length}):`);
    for (const d of drift) lines.push(`  · ${d.id}: ${d.ledger} → ${d.verdict}${d.caughtBy.length ? ` (caughtBy ${d.caughtBy.join(', ')})` : ''}`);
  }
  return lines.join('\n');
}

/** Findings in the shared shape. One per MISSED generic entry (a coverage gap: the build order), one per
 *  regression (a mechanical bug in an oracle). Fingerprints are structural — the run date never enters. */
export function retroFindings(results: readonly RetroResult[], catalog: readonly RetroCatalogEntry[]): DocbotFinding[] {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const out: DocbotFinding[] = [];
  const regs = new Map(regressions(results).map((g) => [g.id, g]));
  for (const r of results) {
    const e = byId.get(r.id);
    if (!e) continue;
    const reg = regs.get(r.id);
    if (reg) {
      out.push(makeFinding({
        lane: RETRO_LANE, severity: 'error', confidence: 'proven', class: 'verified-mechanical-bug',
        contentIds: [], ruleIds: [], expectationKind: 'retro-regression',
        expected: reg.was, observed: reg.now,
        title: `retro regression: ${e.id} now ${reg.now}`,
        summary: `${e.title} — the ledger records ${reg.was}; this run measured ${reg.now}. ${reg.why}. Fix commits: ${e.fixCommits.join(', ')}.`,
        reproduction: `npm run docbot:retro -- --only ${e.id}`,
      }));
    } else if (r.verdict === 'MISSED' && e.scope.kind === 'generic') {
      out.push(makeFinding({
        lane: RETRO_LANE, severity: 'warning', confidence: 'proven', class: 'coverage-gap',
        contentIds: [], ruleIds: [], expectationKind: 'retro-missed',
        expected: 'CAUGHT', observed: 'MISSED',
        title: `no generic oracle catches ${e.id}`,
        summary: `${e.title} (reported ${e.reportDate}; fix ${e.fixCommits.join(', ')}). Reinjected and every generic lane stayed green — this is the next oracle to build. Cited lanes: ${e.lanes.join(', ') || 'none'}.`,
        reproduction: `npm run docbot:retro -- --only ${e.id}`,
      }));
    }
  }
  return out;
}

export { emitFindingsJson };

/** Alias entries so the throwaway's tests resolve EVERY `@game/*` import to the throwaway's own packages —
 *  otherwise `node_modules/@game/sim` (a symlink into the tree the harness was launched from) would serve the
 *  UNPATCHED source and every verdict would read MISSED. Deeper subpaths first; regex keys match exactly. */
export function retroAliasEntries(
  pkgs: ReadonlyArray<{ dir: string; name: string; exports: Record<string, string> }>,
  throwawayRoot: string,
): Array<{ find: string; replacement: string }> {
  const entries: Array<{ find: string; replacement: string }> = [];
  for (const p of pkgs) {
    for (const [sub, target] of Object.entries(p.exports)) {
      const specifier = sub === '.' ? p.name : `${p.name}/${sub.replace(/^\.\//, '')}`;
      const rel = target.replace(/^\.\//, '');
      entries.push({ find: `^${specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, replacement: `${throwawayRoot.replace(/\\/g, '/')}/${p.dir}/${rel}` });
    }
  }
  return entries.sort((a, b) => b.find.length - a.find.length || (a.find < b.find ? -1 : 1));
}

/** The config file written into the throwaway: the repo's own vitest config plus the alias overrides. */
export function renderRetroVitestConfig(aliases: ReadonlyArray<{ find: string; replacement: string }>): string {
  const body = aliases.map((a) => `      { find: /${a.find}/, replacement: ${JSON.stringify(a.replacement)} },`).join('\n');
  return `// GENERATED by npm run docbot:retro — lives only in the throwaway worktree.
import { mergeConfig } from 'vitest/config';
import base from './vitest.config';

export default mergeConfig(base, {
  test: {
    // The harness's own PR-gate lane asserts the patches anchor on CLEAN source — false inside the throwaway
    // by construction. It never votes.
    exclude: ['**/node_modules/**', '**/dist/**', ${SELF_LANES.map((l) => JSON.stringify(l)).join(', ')}],
  },
  resolve: {
    alias: [
${body}
    ],
  },
});
`;
}
