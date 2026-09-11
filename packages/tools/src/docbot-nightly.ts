/**
 * `npm run docbot:nightly` — the full-lifecycle QA lane (handoff §9.2 + §13.3, PR 8).
 *
 * NOT part of the PR gate (§9.2: it must never block ordinary PRs) — `.github/workflows/nightly.yml` runs
 * it on a schedule and uploads the artifact directory when something fails. Everything is deterministic:
 * a failing seed printed here reproduces exactly, and every failure ships as a minimized `QaScenarioV1`
 * with its `npm run docbot:scenario --` repro line, the original full trace preserved beside it (§9.3).
 *
 * THE VERDICT (2026-09-11): every gating finding — lifecycle failures, lobby-law breaches, verified contract
 * bugs, interaction failures — passes through the committed acknowledgement registry
 * (`packages/sim/src/docbot/nightlyAck.ts`). Unacknowledged → RED (exit 1). Acknowledged → printed as
 * `known (acknowledged YYYY-MM-DD: reason)`, never failing. The verdict is also written as
 * `nightly-status.json` (the artifact the workflow's tracking issue renders) and mirrored to the gitignored
 * `.local/docbot/nightly-status.json` so `npm run docbot` can print the last status it saw.
 *
 *   npm run docbot:nightly                     # the default sweep (6 runs, 4 lobbies)
 *   npm run docbot:nightly -- --runs 2         # a quick local smoke
 *   npm run docbot:nightly -- --seed-base 999  # a different deterministic universe
 *   npm run docbot:nightly -- --out somewhere  # artifact directory (default artifacts/docbot-nightly)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allContracts } from '@game/rules/contracts';
import { allRules } from '@game/rules';
import {
  DEFAULT_NIGHTLY, LOCAL_NIGHTLY_STATUS_PATH, buildNightlyStatus, describeAck, emitFindingsJson, makeFinding,
  nightlyReportJson, nightlyVerdict, releaseBlockerFindings, runAnomalyOracle, runContractSweep,
  runInteractionSweep, runNightly, verifyInteractionTable, type DocbotFinding,
} from '@game/sim';

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : fallback;
};

const cfg = {
  ...DEFAULT_NIGHTLY,
  runs: Number(flag('runs', String(DEFAULT_NIGHTLY.runs))),
  seedBase: Number(flag('seed-base', String(DEFAULT_NIGHTLY.seedBase))),
  maxSteps: Number(flag('max-steps', String(DEFAULT_NIGHTLY.maxSteps))),
  lobbies: Number(flag('lobbies', String(DEFAULT_NIGHTLY.lobbies))),
};
const OUT = flag('out', join('artifacts', 'docbot-nightly'))!;

const started = Date.now();
const report = runNightly(cfg);

// Every finding that can turn the night red, in one list — the registry decides which of them actually do.
const gating: DocbotFinding[] = [];

console.log(`\n══ DOCBOT NIGHTLY ══════════════════════════════════════════════════════`);
for (const r of report.runs) {
  const verdict = r.failures.length === 0 ? 'ok' : `${r.failures.length} FAILURE(S)`;
  console.log(`  seed ${r.seed} · ${r.heroId} · ${r.setId} — ${r.steps} steps, wave ${r.wave}, ${r.endedBy} · maxCombatEvents ${r.maxCombatEvents} · ${verdict}`);
  for (const w of r.warnings) console.log(`      warn: ${w}`);
  for (const f of r.failures) {
    const ack = nightlyVerdict([f.finding]).known[0]?.ack;
    console.log(`      ${ack ? '~' : '✗'} [${f.checkId}] ${f.detail}${ack ? ` — ${describeAck(ack)}` : ''}`);
    if (f.repro) console.log(`        minimized to ${f.minimizedSteps} action(s) — repro: ${f.repro}`);
    else console.log(`        (not reproducible in replay mode — original trace preserved in the artifact)`);
    gating.push(f.finding);
  }
}
gating.push(...report.lobbyFailures);
console.log(`  lobbies: ${cfg.lobbies} swept — ${report.lobbyFailures.length === 0 ? 'all laws hold' : `${report.lobbyFailures.length} VIOLATION(S)`}`);
console.log(`  coverage: ${report.coverageKeys.length} semantic keys reached`);

// ── WP D: the contracts lane — the FULL verification sweep + pinned release blockers, every night ─────────
const sweep = runContractSweep({ contracts: allContracts() });
const blockers = releaseBlockerFindings(allRules());
const sweepFails = [
  ...sweep.mismatches.map((m) => `${m.contractId}·${m.path}`),
  ...sweep.metamorphic.filter((m) => !m.diff.ok).map((m) => `${m.contractId}·${m.law}`),
  ...sweep.limitChecks.filter((l) => !l.ok).map((l) => `${l.contractId}·${l.limit}`),
];
const newVerified = sweep.findings.filter((f) => f.class === 'verified-mechanical-bug' && f.status === 'new');
console.log(`  contracts: ${sweep.contractsTotal} swept (${sweep.sampled} driver-executed) — `
  + (sweepFails.length === 0 ? 'every executed case agreed' : `${sweepFails.length} DISAGREEMENT(S): ${sweepFails.join(', ')}`));
for (const f of blockers) console.log(`  🔴 RELEASE BLOCKER (pinned): ${f.ruleIds.join(',')} — approved rule violated by the engine`);
gating.push(...newVerified);

// ── WP F: the interactions lane — the FULL pairwise sweep + §10.4 triples + the anomaly oracle ───────────
const interactions = runInteractionSweep({ contracts: allContracts(), triples: true });
const interactionErrors = [
  ...interactions.runs.filter((r) => r.verdict === 'failed').map((r) => `${r.family} [${r.members.join('+')}] — ${r.evidence}`),
  ...verifyInteractionTable(interactions.runs),
];
const anomalies = runAnomalyOracle({ runs: interactions.runs, contracts: allContracts() });
const interactionTotals = Object.values(interactions.familyTotals);
console.log(`  interactions: ${interactions.runs.length} rows across ${interactionTotals.length} families — `
  + (interactionErrors.length === 0
    ? `${interactionTotals.reduce((n, t) => n + t.covered, 0)} covered, ${interactionTotals.reduce((n, t) => n + t.blocked, 0)} visibly blocked, ${interactions.comboKeys.length} §10.5 combination keys`
    : `${interactionErrors.length} FAILURE(S): ${interactionErrors.join(' · ')}`));
console.log(`  anomalies (§9.7, questions only — never red): ${anomalies.findings.length} · suppressed below floor: ${anomalies.suppressedTotal}`);
// Interaction failures were only ever a log line; now they are findings like everything else that gates.
gating.push(...interactionErrors.map((e) => makeFinding({
  lane: 'nightly-interactions', severity: 'error', confidence: 'proven', title: 'interaction sweep failure',
  summary: e, contentIds: [], ruleIds: [], expectationKind: 'interaction-failure', expected: null, observed: { failure: e },
})));

// ── The verdict: the registry decides ────────────────────────────────────────────────────────────────────
const verdict = nightlyVerdict(gating);
const elapsed = Number(((Date.now() - started) / 1000).toFixed(1));
for (const k of verdict.known) console.log(`  ~ ${k.finding.title} — ${describeAck(k.ack)}`);
console.log(`  ${verdict.ok ? 'NIGHTLY GREEN' : 'NIGHTLY RED'} in ${elapsed}s`
  + (verdict.known.length ? ` (${verdict.known.length} acknowledged finding(s) reported, not failing)` : '')
  + (verdict.red.length ? ` — ${verdict.red.length} unacknowledged finding(s)` : ''));

// ── Artifacts — always the report + status; on failure, the minimized scenarios + findings + traces ──────
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'nightly-report.json'), nightlyReportJson(report));
// The contracts lane's findings ride the same findings.json: sweep disagreements + the pinned blockers.
const findings: DocbotFinding[] = [...report.lobbyFailures, ...sweep.findings, ...blockers, ...anomalies.findings];
writeFileSync(join(OUT, 'interaction-report.json'), JSON.stringify({
  familyTotals: interactions.familyTotals, comboKeys: interactions.comboKeys,
  failures: interactionErrors, anomaliesSuppressed: anomalies.suppressedByDetector,
}, null, 2));
for (const r of report.runs) {
  for (const f of r.failures) {
    findings.push(f.finding);
    if (f.scenario) writeFileSync(join(OUT, `${f.scenario.id}.json`), `${JSON.stringify(f.scenario, null, 2)}\n`);
    writeFileSync(
      join(OUT, `trace-s${f.runSeed}-${f.checkId}.json`),
      `${JSON.stringify({ seed: f.runSeed, heroId: f.heroId, setId: f.setId, checkId: f.checkId, detail: f.detail, actions: f.originalActions }, null, 2)}\n`,
    );
  }
}
writeFileSync(join(OUT, 'findings.json'), emitFindingsJson(findings));

const status = buildNightlyStatus({
  verdict,
  at: new Date().toISOString(),
  config: cfg,
  elapsedSeconds: elapsed,
  outDir: OUT,
  notes: [
    ...(sweepFails.length ? [`contracts: ${sweepFails.length} draft-contract disagreement(s) (corroboration-grade, not gating): ${sweepFails.join(', ')}`] : []),
    ...blockers.map((f) => `release blocker (pinned): ${f.ruleIds.join(',')}`),
    `coverage: ${report.coverageKeys.length} semantic keys · interactions: ${interactions.runs.length} rows · anomalies: ${anomalies.findings.length}`,
  ],
});
const statusJson = `${JSON.stringify(status, null, 2)}\n`;
writeFileSync(join(OUT, 'nightly-status.json'), statusJson);
// The local mirror is best-effort: a read-only checkout must not turn a green night red.
try { mkdirSync(dirname(LOCAL_NIGHTLY_STATUS_PATH), { recursive: true }); writeFileSync(LOCAL_NIGHTLY_STATUS_PATH, statusJson); } catch { /* ignore */ }
console.log(`  artifacts → ${OUT}`);

process.exit(verdict.ok ? 0 : 1);
