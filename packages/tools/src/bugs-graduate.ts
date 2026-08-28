/**
 * `npm run bugs:graduate -- <report-id> [flags]` — DOC BOT 2.0 WP G, blueprint §14.
 *
 * The last hop of the learning loop: a reproduced, RULED player report becomes a permanent curated
 * regression that CI runs forever. Everything the command decides lives in `bug-graduate.lib.ts` (pure,
 * sabotage-tested); this file is IO + the refusal printer.
 *
 *   npm run bugs:graduate -- 3f2a --rule R-AVWIN-03 --verdict correct
 *   npm run bugs:graduate -- 3f2a --contract C-kennel --expect '[{"kind":"state-delta","path":"embers","equals":3}]'
 *   npm run bugs:graduate -- 3f2a --decision R-TURN-01 --verdict correct --class multiplier-fold --pr 1277
 *
 * Flags:
 *   --rule <id[,id]>      APPROVED rule ids establishing expected behaviour
 *   --contract <id[,id]>  APPROVED contract ids establishing expected behaviour
 *   --decision <ruleId>   a recorded owner decision in decisions.json
 *   --verdict correct     the ruling says the OBSERVED behaviour is right → pin it (derived expectations)
 *   --expect <json>       explicit QaExpectation[] JSON — wins over --verdict
 *   --class <classId>     bug taxonomy class (default 'unclassified'; `--class list` prints the roster)
 *   --fingerprint <hex>   the finding fingerprint that classified the report
 *   --pr <n>              the PR this graduation ships in
 *   --no-close            skip the bugs:close step (a synthetic/local-only report, or offline)
 *   --dry-run             print the plan + the fixture, write nothing
 *
 * REFUSALS ARE THE POINT. A flaky repro, a drifted capsule, an unapproved rule, or an unresolved
 * expectation each stops the command with exit code 1 and nothing written. Partial graduation does not
 * exist: the fixture, the taxonomy record and the report closure land together or not at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUG_CLASS_IDS, bugClass, emitGraduationLedger, mergeGraduation, validateQaScenario,
  type GraduationLedger, type QaExpectation,
} from '@game/sim';
import { DECISIONS, allRules } from '@game/rules';
import { allContracts } from '@game/rules/contracts';
import { createSupabaseBackend, readReport, resolveSupabaseConfig } from './bug-inbox.lib';
import { qaScenarioRepro } from './bug-qa-scenario.lib';
import { REGRESSION_DIR, planGraduation } from './bug-graduate.lib';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);
const list = (name: string): string[] => (flag(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const USAGE = 'usage: npm run bugs:graduate -- <report-id> [--rule id,id] [--contract id,id] [--decision ruleId]'
  + ' [--verdict correct | --expect \'<json>\'] [--class <id>] [--fingerprint hex] [--pr n] [--no-close] [--dry-run]';

if (flag('class') === 'list') {
  console.log('bug taxonomy classes:');
  for (const id of BUG_CLASS_IDS) {
    const e = bugClass(id)!;
    console.log(`  ${id.padEnd(28)} ${e.title}\n${' '.repeat(30)}coverage: ${e.siblingCoverage}${e.siblingTodo ? ` — ${e.siblingTodo}` : ''}`);
  }
  process.exit(0);
}

// The report id is the FIRST positional — flag values are never positionals (`--rule R-X` would otherwise
// look like one). Taking argv[0] keeps that unambiguous.
const reportArg = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
if (!reportArg) {
  console.error(USAGE);
  process.exit(1);
}

const classId = flag('class') ?? 'unclassified';
const classEntry = bugClass(classId);
if (!classEntry) {
  console.error(`unknown bug class '${classId}' — run \`npm run bugs:graduate -- --class list\` for the roster.`);
  process.exit(1);
}

let expect: QaExpectation[] | undefined;
const expectRaw = flag('expect');
if (expectRaw !== undefined) {
  try {
    const parsed: unknown = JSON.parse(expectRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('--expect must be a non-empty JSON array of QaExpectation');
    expect = parsed as QaExpectation[];
  } catch (err) {
    console.error(`--expect is not valid QaExpectation[] JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ── read the report ───────────────────────────────────────────────────────────────────────────────────────
let row: ReturnType<typeof readReport>['row'];
try {
  ({ row } = readReport(reportArg));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const envelope = row.report;
if (!envelope) {
  console.error(`report ${row.id} carries no envelope — nothing to graduate.`);
  process.exit(1);
}

// ── approval predicates, read from the REAL registries (§4.2 — never re-derived from what is under test) ───
const rules = allRules();
const approvedRuleIds = new Set(
  rules.filter((r) => r.effective === 'approved' || r.effective === 'revised').map((r) => r.id),
);
const approvedContractIds = new Set(
  // A ContentContract is keyed by its contentId — so `--contract kennel` names the card whose APPROVED
  // contract establishes the expected behaviour.
  allContracts().filter((c) => c.reviewStatus === 'approved').map((c) => c.contentId),
);
const decisionIds = new Set(Object.keys(DECISIONS as Record<string, unknown>));

console.log(`=== bugs:graduate — ${row.id} (${row.status}, ${row.issue_type}) → class '${classId}' ===\n`);

const plan = planGraduation({
  envelope,
  runRepro: () => qaScenarioRepro(envelope),
  ruleIds: list('rule'),
  contractIds: list('contract'),
  ...(flag('decision') !== undefined ? { ownerDecision: flag('decision') } : {}),
  isApprovedRule: (id) => approvedRuleIds.has(id),
  isApprovedContract: (id) => approvedContractIds.has(id),
  hasDecision: (id) => decisionIds.has(id),
  ...(expect !== undefined ? { expect } : {}),
  ...(flag('verdict') === 'correct' ? { verdict: 'correct' as const } : {}),
  classId,
  ...(classEntry.siblingTodo !== undefined ? { siblingTodo: classEntry.siblingTodo } : {}),
  ...(flag('fingerprint') !== undefined ? { findingFingerprint: flag('fingerprint') } : {}),
  ...(flag('semantic-revision') !== undefined ? { semanticRevision: flag('semantic-revision') } : {}),
  ...(flag('pr') !== undefined ? { pr: flag('pr') } : {}),
  today: new Date().toISOString().slice(0, 10),
});

for (const s of plan.steps) console.log(`  ✓ ${s}`);
if (!plan.ok) {
  console.error('\nGRADUATION REFUSED — nothing was written:');
  for (const r of plan.refusals) console.error(`  ✕ ${r}`);
  process.exit(1);
}
const { scenario, record } = plan;
if (!scenario || !record) {
  console.error('\ninternal: plan reported ok with no artifact — refusing.');
  process.exit(1);
}

// ── the fixture must VALIDATE against this checkout before it enters curated space ────────────────────────
const errors = validateQaScenario(scenario);
if (errors.length > 0) {
  console.error('\nGRADUATION REFUSED — the regression fixture does not validate against this checkout:');
  for (const e of errors) console.error(`  ✕ ${e}`);
  process.exit(1);
}
console.log(`  ✓ fixture validates against this checkout (${scenario.expectations?.length ?? 0} expectation(s))`);

const scenarioPath = join(REGRESSION_DIR, `${scenario.id}.json`);
const LEDGER_PATH = 'packages/sim/src/docbot/bugTaxonomy.graduated.json';

if (has('dry-run')) {
  console.log('\n--dry-run: nothing written. The fixture would be:\n');
  console.log(JSON.stringify({ ...scenario, state: `<${scenario.state.length} chars of serialized state>` }, null, 2));
  console.log(`\nand the taxonomy record:\n${JSON.stringify(record, null, 2)}`);
  if (plan.siblingTodo) console.log(`\n⚠ SIBLING COVERAGE (class '${classId}' is single-pin): ${plan.siblingTodo}`);
  process.exit(0);
}

mkdirSync(REGRESSION_DIR, { recursive: true });
writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);
console.log(`  ✓ curated regression written → ${scenarioPath}`);

const ledger: GraduationLedger = existsSync(LEDGER_PATH)
  ? (JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as GraduationLedger)
  : { schemaVersion: 1, records: [] };
writeFileSync(LEDGER_PATH, emitGraduationLedger(mergeGraduation(ledger, record)));
console.log(`  ✓ taxonomy record appended → ${LEDGER_PATH}`);

// ── close the report (§14's final step) ───────────────────────────────────────────────────────────────────
if (has('no-close')) {
  console.log(`  ⚠ --no-close: report ${row.id} NOT closed. Close it by hand:`);
  console.log(`      npm run bugs:close -- ${row.id} --status fixed --note "graduated to ${scenario.id}"`);
} else {
  try {
    const backend = createSupabaseBackend(resolveSupabaseConfig());
    const updated = await backend.updateReport(row.id, {
      status: 'fixed',
      resolution: {
        status: 'fixed', by: 'bugs:graduate', resolvedAt: new Date().toISOString(),
        note: `graduated to curated regression ${scenario.id} (class ${classId})`,
        scenarioId: scenario.id, classId,
      },
    });
    if (updated.length === 0) throw new Error(`no row updated — is ${row.id} a real report id?`);
    console.log(`  ✓ report ${row.id} → status fixed`);
  } catch (err) {
    console.error(`\n  ✕ THE FIXTURE AND TAXONOMY RECORD ARE WRITTEN, BUT THE REPORT WAS NOT CLOSED: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`    Close it by hand: npm run bugs:close -- ${row.id} --status fixed --note "graduated to ${scenario.id}"`);
    process.exit(2);
  }
}

console.log(`\nGRADUATED. \`npm run docbot:scenario -- ${scenario.id}\` re-runs it; the regression lane runs it on every PR.`);
if (plan.siblingTodo) {
  console.log(`\n⚠ SIBLING COVERAGE — class '${classId}' is SINGLE-PIN, so this graduation protects the reported`);
  console.log('  board and nothing more. Outstanding, verbatim from the taxonomy:');
  console.log(`    ${plan.siblingTodo}`);
  console.log('  No sibling scenarios were fabricated (§4.3 — a named gap beats an invented fixture).');
} else {
  const fam = classEntry.families.length ? `families ${classEntry.families.join(', ')}` : `lane(s) ${classEntry.lanes.join(', ')}`;
  console.log(`\nSIBLINGS: class '${classId}' is generalized — ${fam} already generate coverage across the class.`);
}
