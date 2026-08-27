/**
 * `npm run docbot:nightly` — the full-lifecycle QA lane (handoff §9.2 + §13.3, PR 8).
 *
 * NOT part of the PR gate (§9.2: it must never block ordinary PRs) — `.github/workflows/nightly.yml` runs
 * it on a schedule and uploads the artifact directory when something fails. Everything is deterministic:
 * a failing seed printed here reproduces exactly, and every failure ships as a minimized `QaScenarioV1`
 * with its `npm run docbot:scenario --` repro line, the original full trace preserved beside it (§9.3).
 *
 *   npm run docbot:nightly                     # the default sweep (6 runs, 4 lobbies)
 *   npm run docbot:nightly -- --runs 2         # a quick local smoke
 *   npm run docbot:nightly -- --seed-base 999  # a different deterministic universe
 *   npm run docbot:nightly -- --out somewhere  # artifact directory (default artifacts/docbot-nightly)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_NIGHTLY, emitFindingsJson, nightlyReportJson, runNightly, type DocbotFinding } from '@game/sim';

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
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n══ DOCBOT NIGHTLY ══════════════════════════════════════════════════════`);
for (const r of report.runs) {
  const verdict = r.failures.length === 0 ? 'ok' : `${r.failures.length} FAILURE(S)`;
  console.log(`  seed ${r.seed} · ${r.heroId} · ${r.setId} — ${r.steps} steps, wave ${r.wave}, ${r.endedBy} · maxCombatEvents ${r.maxCombatEvents} · ${verdict}`);
  for (const w of r.warnings) console.log(`      warn: ${w}`);
  for (const f of r.failures) {
    console.log(`      ✗ [${f.checkId}] ${f.detail}`);
    if (f.repro) console.log(`        minimized to ${f.minimizedSteps} action(s) — repro: ${f.repro}`);
    else console.log(`        (not reproducible in replay mode — original trace preserved in the artifact)`);
  }
}
console.log(`  lobbies: ${cfg.lobbies} swept — ${report.lobbyFailures.length === 0 ? 'all laws hold' : `${report.lobbyFailures.length} VIOLATION(S)`}`);
console.log(`  coverage: ${report.coverageKeys.length} semantic keys reached`);
console.log(`  ${report.ok ? 'NIGHTLY GREEN' : 'NIGHTLY RED'} in ${elapsed}s`);

// ── Artifacts — always the report; on failure, the minimized scenarios + findings + original traces ───────
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'nightly-report.json'), nightlyReportJson(report));
const findings: DocbotFinding[] = [...report.lobbyFailures];
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
console.log(`  artifacts → ${OUT}`);

process.exit(report.ok ? 0 : 1);
