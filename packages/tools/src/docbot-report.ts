/**
 * `npm run docbot:report` — DOC BOT 2.0 WP H: the machine-readable half of the final coverage report
 * (blueprint §20 metrics + §21 Definition of Done + §24.15).
 *
 * `docs/docbot2/final-report.md` is the prose. THIS is the number source it is written from, so the doc
 * can never silently rot: `docbot-report.test.ts` re-derives these numbers on every PR and fails when the
 * document's headline figures drift away from them.
 *
 *   npm run docbot:report                       # human summary + the DoD checklist roll-up
 *   npm run docbot:report -- --json             # the full FinalReport as JSON (stdout)
 *   npm run docbot:report -- --out artifacts/docbot-report   # writes report.json
 *   npm run docbot:report -- --check            # verify docs/docbot2/final-report.md against these numbers
 *
 * Exit code: 0 always, EXCEPT `--check` with a drifted document (1). This command REPORTS; it never
 * decides that something is broken — the sweeps it summarizes own that verdict.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFinalReport, currentCommit, docClaimErrors, headlineNumbers } from './docbot-report.lib';

const argv = process.argv.slice(2);
const has = (name: string): boolean => argv.includes(`--${name}`);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};

const countJson = (dir: string): number =>
  (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0);

const SCENARIOS = join('packages', 'sim', 'src', 'docbot', 'scenarios');
const started = Date.now();
const report = buildFinalReport({
  commit: currentCommit(),
  graduatedRegressions: countJson(join(SCENARIOS, 'regressions')),
  curatedFixtures: countJson(SCENARIOS),
  generatedCorpusEntries: Math.max(0, countJson(join('packages', 'sim', 'src', 'docbot', 'corpus')) - 1), // minus manifest.json
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

if (has('json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const r = report;
  const pct = (of: number, total: number): string => `${of}/${total} (${total ? ((100 * of) / total).toFixed(1) : '0.0'}%)`;
  console.log('\n══ DOC BOT 2.0 — FINAL COVERAGE REPORT (§20/§21) ═══════════════════════');
  console.log(`commit ${r.commit} · semanticRevision ${r.semanticRevision} · ${elapsed}s`);

  console.log('\n── inventory ──');
  console.log(`  ${r.inventory.cards} cards (${r.inventory.spells} spells, ${r.inventory.tokens} tokens) · ${r.inventory.heroes} hero powers`
    + ` · ${r.inventory.runes}+${r.inventory.epicRunes} runes · ${r.inventory.quests} quests`);
  console.log(`  active content objects under contract: ${r.inventory.activeObjects}`);
  // ARCHIVED content classes stay UNDER CONTRACT and stay swept — this line labels them so an inactive
  // system's coverage is never mistaken for live coverage, and never silently disappears either.
  if (r.inventory.archived.total > 0) {
    const by = Object.entries(r.inventory.archived.byType).map(([k, v]) => `${k} ${v}`).join(' · ');
    console.log(`  …of which ARCHIVED content classes: ${r.inventory.archived.total} (${by}) — contracts kept, systems switched off`);
  }

  console.log('\n── §20 coverage ──');
  console.log(`  with a contract:            ${pct(r.contracts.withContract.of, r.contracts.withContract.total)}  (${r.contracts.curated} curated · ${r.contracts.extracted} extracted)`);
  console.log(`  with a DIRECT executed case:${pct(r.contracts.withDirectExecution.of, r.contracts.withDirectExecution.total)}   + ${r.contracts.citedOnly} covered by lane citation only`);
  console.log(`  with text classification:   ${pct(r.text.classified.of, r.text.classified.total)}`);
  console.log(`  derived contract status: ${Object.entries(r.contracts.derived).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  text buckets: ${Object.entries(r.text.buckets).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  console.log('\n── rules ──');
  console.log(`  ${r.rules.total} rules · ${r.rules.approved} approved · ${r.rules.retired} retired · ${r.rules.needsRuling} needs-ruling`);
  console.log(`  approved-but-unenforced: ${r.rules.approvedButUnenforced.join(', ') || 'none'}`);
  console.log(`  release blockers:        ${r.rules.releaseBlockers.join(', ') || 'none'}`);
  console.log(`  dormant decks — conventions ${r.rules.decks.conventions} · interactions ${r.rules.decks.interactions} · wording ${r.rules.decks.wording}`);

  console.log('\n── interactions ──');
  console.log(`  graph ${r.interactions.graphNodes} nodes / ${r.interactions.graphEdges} edges`);
  console.log(`  ${r.interactions.candidatePairs} candidate pairs of ${r.interactions.naivePairs} naive (${r.interactions.candidatePct}%)`);
  console.log(`  sweep rows ${r.interactions.sweepRows}: covered ${r.interactions.covered} · failed ${r.interactions.failed} · inapplicable ${r.interactions.inapplicable} · blocked ${r.interactions.blocked}`);
  console.log(`  families with coverage: ${pct(r.interactions.familiesWithCoverage.of, r.interactions.familiesWithCoverage.total)} · combination keys ${r.interactions.combinationKeys}`);
  console.log(`  anomalies ${r.interactions.anomalies} (suppressed below floor ${r.interactions.anomaliesSuppressed})`);

  console.log('\n── retro catalog (historical catch rate) ──');
  console.log(`  ${r.retro.caught}/${r.retro.entries} mapped to a generalized family or lane`
    + ` · verified by reinject run ${r.retro.byReinjectRun} · by class analysis ${r.retro.byClassAnalysis}`);

  console.log('\n── §12.1 finding classes (this run, all sweeps) ──');
  for (const [k, v] of Object.entries(r.findings)) console.log(`  ${k.padEnd(26)} ${v}`);

  console.log('\n── oracle families (§4.5 sabotage obligation) ──');
  console.log(`  docbot vitest lanes ${r.oracles.docbotLanes} · with an in-file sabotage proof ${pct(r.oracles.withSabotageEvidence.of, r.oracles.withSabotageEvidence.total)}`
    + ` · citable enforcement lanes ${r.oracles.enforcementLanes}`);

  console.log('\n── learning loop ──');
  console.log(`  graduated regressions ${r.learningLoop.graduatedRegressions} · curated fixtures ${r.learningLoop.curatedFixtures} · generated corpus ${r.learningLoop.generatedCorpusEntries}`);

  console.log('\n── blind spots (§21 — what Doc Bot still cannot prove) ──');
  for (const b of r.blindSpots) console.log(`  ${b.count === null ? '  —' : String(b.count).padStart(4)}  ${b.id}: ${b.what}`);

  console.log('\n  prose + the DoD checklist: docs/docbot2/final-report.md');
  console.log(`  machine-readable: ${'npm run docbot:report -- --json'}\n`);
}

const OUT = flag('out');
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  artifact → ${join(OUT, 'report.json')}`);
}

if (has('check')) {
  const path = join('docs', 'docbot2', 'final-report.md');
  if (!existsSync(path)) {
    console.error(`\n✗ ${path} is missing.`);
    process.exit(1);
  }
  const errors = docClaimErrors(readFileSync(path, 'utf8'), report);
  if (errors.length === 0) {
    console.log(`\n✓ ${path} agrees with the generator on all ${Object.keys(headlineNumbers(report)).length} headline numbers.\n`);
  } else {
    console.error(`\n✗ ${path} has drifted from the generator:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
}
