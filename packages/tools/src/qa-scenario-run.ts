/**
 * `npm run docbot:scenario -- <path-or-id>` — run one QaScenarioV1 file headlessly (handoff §4.4 CLI).
 *
 * Accepts either a path to a scenario JSON file or a bare id, which resolves to the checked-in fixture
 * directory `packages/sim/src/docbot/scenarios/<id>.json`. Prints the runner's compact human summary plus
 * every expectation verdict; the exit code is the verdict (0 = valid + all expectations passed).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQaScenario, runQaScenario } from '@game/sim';

const SCENARIO_DIR = join(process.cwd(), 'packages', 'sim', 'src', 'docbot', 'scenarios');

const arg = process.argv[2];
if (!arg) {
  console.error('usage: npm run docbot:scenario -- <path-or-id>');
  console.error(`bare ids resolve in ${SCENARIO_DIR}`);
  process.exit(2);
}

const path = existsSync(arg) ? arg : join(SCENARIO_DIR, arg.endsWith('.json') ? arg : `${arg}.json`);
if (!existsSync(path)) {
  console.error(`no scenario at '${arg}' (tried ${path})`);
  process.exit(2);
}

const { scenario, errors } = parseQaScenario(readFileSync(path, 'utf8'));
if (!scenario) {
  console.error(`INVALID SCENARIO: ${path}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}

const result = runQaScenario(scenario);
console.log(`\n══ QA SCENARIO ═════════════════════════════════════════════════════════`);
console.log(result.summary);
console.log('\nexpectations:');
for (const r of result.expectationResults) {
  console.log(`  ${r.pass ? '✓' : '✗'} [${r.expectation.kind}] ${r.detail}`);
}
if (result.expectationResults.length === 0) console.log('  (none — the scenario only exercises the engine)');
console.log(`\nrepro: ${result.repro}`);
process.exit(result.ok ? 0 : 1);
