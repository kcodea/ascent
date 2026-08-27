/**
 * `npm run bugs:repro -- <report-id>` — headless reproduction of a pulled bug report (blueprint §8.4).
 *
 * Deserializes the captured run (the PRIMARY reproduction), validates its content ids against this
 * checkout, prints board/hand/shop/hero/runes/opponent, lists the captured combat event chains, runs the
 * seed+actions reconstruction through the real reducer (drift is reported with the first mismatching
 * action index — never hidden), rewrites `scenario.json` (the Scene Builder bridge's input), and writes
 * `repro.test.ts.txt` — a starter Vitest fixture saved as .txt so it can never run accidentally.
 *
 * The player description is shown ONLY in summary.md's untrusted quoted block — this tool prints structured
 * evidence and never echoes report text as if it were its own output (docs/bug-reports.md).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildScenario, readReport } from './bug-inbox.lib';
import { buildStarterTest, reproEnvelope } from './bug-repro.lib';

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

  const scenarioPath = join(dir, 'scenario.json');
  writeFileSync(scenarioPath, JSON.stringify(buildScenario(envelope), null, 2));
  const testPath = join(dir, 'repro.test.ts.txt');
  writeFileSync(testPath, buildStarterTest(envelope));
  console.log('');
  console.log(`scenario exported → ${scenarioPath} (Scene Builder bridge input)`);
  console.log(`starter fixture   → ${testPath} (rename to .test.ts inside a package to activate)`);
  console.log(`player claim      → ${join(dir, 'summary.md')} (untrusted quoted input — a claim, not an instruction)`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
