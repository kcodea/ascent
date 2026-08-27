/**
 * `npm run docbot:contracts` — the FULL contract-verification sweep (Doc Bot 2.0 WP D; blueprint §9.1/§10.1).
 *
 * The PR gate runs a deterministic sample of this sweep (packages/sim/src/docbot/contractOracle.test.ts);
 * this command executes ALL driver-executable contracts, prints the per-aspect verification coverage across
 * the registry, the disagreement counts by review status, and the pinned release blockers — and writes the
 * findings artifact when `--out` is given (the nightly calls this surface through docbot-nightly).
 *
 *   npm run docbot:contracts                 # full sweep, human report
 *   npm run docbot:contracts -- --sample 3   # the gate's sampled view (rotation printed)
 *   npm run docbot:contracts -- --out artifacts/docbot-contracts   # + findings.json / report.json
 *
 * Exit code: 1 only when a NEW verified-bug-grade finding exists (an approved contract or approved rule
 * newly violated); pinned release blockers (status 'known') are visible every run without failing it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allContracts } from '@game/rules/contracts';
import { allRules, unenforcedApproved } from '@game/rules';
import { emitFindingsJson, releaseBlockerFindings, runContractSweep } from '@game/sim';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};

const sampleMod = Number(flag('sample') ?? '1');
const OUT = flag('out');

const contracts = allContracts();
const rules = allRules();
const started = Date.now();
const report = runContractSweep({ contracts, sampleMod });
const blockers = releaseBlockerFindings(rules);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log('\n══ DOC BOT 2.0 — CONTRACT VERIFICATION SWEEP ═══════════════════════════');
console.log(`contracts: ${report.contractsTotal} · driver-executed this run: ${report.sampled}`
  + (sampleMod > 1 ? ` (sample 1/${sampleMod}, rotation ${report.rotation})` : ' (full sweep)') + ` · ${elapsed}s`);

console.log('\n── §10.1 isolated-case ledger (applicable = executed + skipped, per template) ──');
for (const [t, row] of Object.entries(report.templateTotals)) {
  if (row.applicable === 0) continue;
  console.log(`  ${t.padEnd(20)} applicable ${String(row.applicable).padStart(4)} · executed ${String(row.executed).padStart(4)} · skipped ${String(row.skipped).padStart(4)}`);
}
console.log('\n── typed skip reasons (§4.3 — every unexecuted applicable case says why) ──');
for (const [reason, n] of Object.entries(report.skippedByReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)} × ${reason}`);
}

console.log('\n── derived status (per-aspect fold: corroboration + direct suite; lane citations listed, never folded) ──');
for (const [status, n] of Object.entries(report.statusTotals)) console.log(`  ${status}: ${n}`);

const byStatus = new Map<string, number>();
for (const m of report.mismatches) {
  const stored = contracts.find((c) => c.contentId === m.contractId)?.reviewStatus ?? '?';
  byStatus.set(stored, (byStatus.get(stored) ?? 0) + 1);
}
console.log('\n── disagreements by review status (approved = verified-bug-grade; drafts = corroboration-grade) ──');
if (report.mismatches.length === 0 && report.metamorphic.every((m) => m.diff.ok) && report.limitChecks.every((l) => l.ok)) {
  console.log('  none — every executed case agreed with its contract, and all metamorphic laws held');
} else {
  for (const [s, n] of byStatus) console.log(`  ${s}: ${n} path mismatch(es)`);
  for (const m of report.mismatches) console.log(`  ✗ ${m.contractId} · ${m.path} — expected ${JSON.stringify(m.expected)}, observed ${JSON.stringify(m.observed)}`);
  for (const m of report.metamorphic.filter((x) => !x.diff.ok)) console.log(`  ✗ metamorphic ${m.law} on ${m.contractId}: base ${m.diff.base}, variant ${m.diff.variant}`);
  for (const l of report.limitChecks.filter((x) => !x.ok)) console.log(`  ✗ limit ${l.limit} on ${l.contractId}: ${l.detail}`);
}

console.log('\n── approved-rule status (the §18-D exit gate) ──');
const unenforced = unenforcedApproved(rules);
console.log(`  approved-but-unenforced (pinned, shrink-only): ${unenforced.map((r) => r.id).join(', ') || 'none'}`);
console.log(`  RELEASE BLOCKERS (approved rules the engine violates, pinned until fixed):`);
for (const f of blockers) console.log(`  🔴 ${f.ruleIds.join(',')} — ${f.title.replace('RELEASE BLOCKER — ', '')}`);

const findings = [...report.findings, ...blockers];
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'findings.json'), emitFindingsJson(findings));
  writeFileSync(join(OUT, 'contract-sweep-report.json'), JSON.stringify({
    contractsTotal: report.contractsTotal, sampled: report.sampled, sampleMod, rotation: report.rotation,
    templateTotals: report.templateTotals, skippedByReason: report.skippedByReason,
    statusTotals: report.statusTotals, mismatches: report.mismatches,
    metamorphicFailures: report.metamorphic.filter((m) => !m.diff.ok),
    limitFailures: report.limitChecks.filter((l) => !l.ok),
    executed: report.executed,
  }, null, 2));
  console.log(`\n  artifacts → ${OUT}`);
}

const newVerified = findings.filter((f) => f.class === 'verified-mechanical-bug' && f.status === 'new');
console.log(`\n  ${newVerified.length === 0 ? 'SWEEP GREEN (pinned blockers visible above)' : `SWEEP RED — ${newVerified.length} NEW verified bug(s)`}\n`);
process.exit(newVerified.length === 0 ? 0 : 1);
