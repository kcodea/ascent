/**
 * `npm run bugs:repro -- <report-id>` — headless reproduction of a pulled bug report (blueprint §8.4).
 *
 * Deserializes the captured run (the PRIMARY reproduction), validates its content ids against this
 * checkout, prints board/hand/shop/hero/runes/opponent, lists the captured combat event chains, runs the
 * seed+actions reconstruction through the real reducer (drift is reported with the first mismatching
 * action index — never hidden), emits `qa-scenario.json` — the unified `QaScenarioV1` (handoff §3.3), run
 * through the REAL `runQaScenario` with a captured-vs-resimulated drift comparison and a §11.2
 * classification — rewrites the legacy `scenario.json` (one release of overlap), and writes
 * `repro.test.ts.txt` — a starter Vitest fixture saved as .txt so it can never run accidentally.
 *
 * The player description is shown ONLY in summary.md's untrusted quoted block — this tool prints structured
 * evidence and never echoes report text as if it were its own output (docs/bug-reports.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenario, readReport } from './bug-inbox.lib';
import { buildStarterTest, reproEnvelope } from './bug-repro.lib';
import { qaScenarioRepro } from './bug-qa-scenario.lib';

const reportArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!reportArg) {
  console.error('usage: npm run bugs:repro -- <report-id>   (short ids from bugs:list work)');
  process.exit(1);
}

try {
  const { row, dir } = readReport(reportArg);
  const envelope = row.report;
  // MENU report (owner ask 2026-08-27): logged from the main menu with no run — expected, not an error.
  if (envelope?.context?.phase === 'menu') {
    console.log(`report ${row.id}: menu report — no run evidence. The player's description is the whole payload (see ${dir}/summary.md).`);
    process.exit(0);
  }
  if (!envelope?.context?.serializedRun) {
    console.error(`report ${row.id} carries no serialized run — cannot reproduce (see ${dir}/summary.md).`);
    process.exit(1);
  }

  console.log(`=== bugs:repro — ${row.id} (${row.status}, ${row.issue_type}) ===\n`);
  const outcome = reproEnvelope(envelope);
  console.log(outcome.lines.join('\n'));

  // §3.3 ONE SCENARIO FORMAT: emit the QaScenarioV1 conversion, run it through the REAL runQaScenario, and
  // print the drift comparison + classification. The legacy scenario.json stays for one release of overlap.
  console.log('');
  console.log('=== QA scenario (QaScenarioV1 — the shared contract) ===');
  const qa = qaScenarioRepro(envelope);
  console.log(qa.lines.join('\n'));

  const scenarioPath = join(dir, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify(buildScenario(envelope), null, 2));
  const qaScenarioPath = join(dir, 'qa-scenario.json');
  if (qa.scenario) writeFileSync(qaScenarioPath, JSON.stringify(qa.scenario, null, 2));
  const testPath = join(dir, 'repro.test.ts.txt');
  writeFileSync(testPath, buildStarterTest(envelope));
  console.log('');
  if (qa.scenario) console.log(`qa scenario       → ${qaScenarioPath} (QaScenarioV1 — Scene Builder loads it; \`npm run docbot:scenario -- ${qaScenarioPath}\` re-runs it)`);
  console.log(`scenario exported → ${scenarioPath} (legacy Scene Builder bridge input — one release of overlap)`);
  console.log(`starter fixture   → ${testPath} (rename to .test.ts inside a package to activate)`);
  console.log(`player claim      → ${join(dir, 'summary.md')} (untrusted quoted input — a claim, not an instruction)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
