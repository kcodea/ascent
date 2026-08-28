/**
 * `npm run docbot:interactions` — Doc Bot 2.0 WP F: the FULL interaction sweep (blueprint §10.2–§10.5 +
 * §9.7). The PR gate runs a candidate-capped sample (packages/sim/src/docbot/interactionSweep.test.ts);
 * this command runs EVERY candidate plus the §10.4 triples, prints the graph size, the applicability
 * report (candidates vs the naive product), the §15.5 coverage table, and the anomaly-oracle verdicts —
 * then RESEEDS the owner's Sitting-2 deck (pendingInteractions.generated.ts) through the shared seed
 * hygiene (decisions survive; rejects tombstone). The deck ships DORMANT — the main session schedules the
 * sitting; nothing here triggers one.
 *
 *   npm run docbot:interactions                 # full sweep + triples, human report, deck reseed
 *   npm run docbot:interactions -- --no-seed    # sweep only (no registry write)
 *   npm run docbot:interactions -- --out artifacts/docbot-interactions   # + findings.json / report.json
 *
 * Exit code: 1 only when a pair/triple diff FAILED (a real regression to triage). Anomalies are questions
 * (§9.7 — never verified, never red).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX, QUEST_DEFS, RUNE_INDEX } from '@game/content';
import {
  AUTO_RETIRED_RULES, DECISIONS, INTERACTION_PENDING, RETIRED_IDS, applySeedHygiene, type RetiredRule,
} from '@game/rules';
import { allContracts } from '@game/rules/contracts';
import {
  buildInteractionGraph, buildInteractionQuestions, candidatePairs, emitFindingsJson, graphStats,
  runAnomalyOracle, runInteractionSweep, verifyInteractionTable,
} from '@game/sim';

const argv = process.argv.slice(2);
const has = (name: string): boolean => argv.includes(`--${name}`);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const OUT = flag('out');

const contracts = allContracts();
const started = Date.now();

// ── §10.2 graph + applicability ──────────────────────────────────────────────────────────────────────────
const graph = buildInteractionGraph(contracts);
const stats = graphStats(graph);
const { report: candReport } = candidatePairs(graph, contracts);

console.log('\n══ DOC BOT 2.0 — INTERACTION INTELLIGENCE (WP F) ═══════════════════════');
console.log(`graph: ${stats.nodes} nodes / ${stats.edges} edges`);
console.log(`  nodes by kind: ${Object.entries(stats.nodesByKind).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`  edges by kind: ${Object.entries(stats.edgesByKind).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`applicability: ${candReport.candidatePairs} candidate pairs vs ${candReport.naivePairs} naive all-pairs `
  + `(${(100 * candReport.candidatePairs / candReport.naivePairs).toFixed(1)}% — producer→channel→consumer join only)`);
for (const [ch, row] of Object.entries(candReport.perChannel).sort()) {
  console.log(`    ${ch.padEnd(14)} producers ${String(row.producers).padStart(4)} × consumers ${String(row.consumers).padStart(4)} → ${row.pairs} pairs`);
}
if (candReport.unmappedTriggers.length) {
  console.log(`  unmapped triggers (visible to-do, hero/objective namespaces): ${candReport.unmappedTriggers.length}`);
}

// ── §10.3/§10.4 the full sweep ───────────────────────────────────────────────────────────────────────────
const sweep = runInteractionSweep({ contracts, triples: true });
const tableErrors = verifyInteractionTable(sweep.runs);
console.log(`\n── §15.5 coverage table (full sweep + §10.4 triples; ${sweep.runs.length} rows) ──`);
for (const [family, t] of Object.entries(sweep.familyTotals)) {
  const verdict = t.failed > 0 ? '✗' : t.covered > 0 ? '✓' : '◌';
  console.log(`  ${verdict} ${family.padEnd(44)} covered ${String(t.covered).padStart(3)} · failed ${t.failed} · inapplicable ${String(t.inapplicable).padStart(3)} · blocked ${t.blocked}`);
}
const failed = sweep.runs.filter((r) => r.verdict === 'failed');
for (const r of failed) console.log(`  ✗ FAILED ${r.family} [${r.members.join('+')}] — ${r.evidence}`);
for (const r of sweep.runs.filter((x) => x.verdict === 'blocked')) {
  console.log(`  ◌ blocked ${r.family}${r.members.length ? ` [${r.members.join('+')}]` : ''} — ${r.blockedReason}: ${r.evidence.slice(0, 110)}`);
}
if (tableErrors.length) for (const e of tableErrors) console.log(`  ✗ TABLE INTEGRITY: ${e}`);
console.log(`  §10.5 combination keys recorded: ${sweep.comboKeys.length}`);
for (const k of sweep.comboKeys) console.log(`    ${k}`);

// ── §9.7 the anomaly oracle ──────────────────────────────────────────────────────────────────────────────
const oracle = runAnomalyOracle({ runs: sweep.runs, contracts });
console.log(`\n── §9.7 anomaly oracle (floor 'strong', fingerprint-deduped) ──`);
console.log(`  anomalies: ${oracle.findings.length} · suppressed below floor: ${oracle.suppressedTotal}`
  + (oracle.suppressedTotal ? ` (${Object.entries(oracle.suppressedByDetector).map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''));
for (const f of oracle.findings) {
  console.log(`  ? ${f.title}`);
  for (const ci of f.competingInterpretations ?? []) console.log(`      · ${ci.interpretation}`);
}

// ── the Sitting-2 deck (dormant) through the shared seed hygiene ─────────────────────────────────────────
if (!has('no-seed')) {
  const fresh = buildInteractionQuestions(oracle.findings);
  const questIds = new Set(QUEST_DEFS.map((q) => q.id));
  const priorAutoIds = new Set(AUTO_RETIRED_RULES.map((t) => t.id));
  const hygiene = applySeedHygiene({
    fresh,
    previous: INTERACTION_PENDING,
    decisions: DECISIONS,
    retiredIds: new Set([...RETIRED_IDS, ...priorAutoIds]),
    contentResolves: (id) => !!CARD_INDEX[id] || !!RUNE_INDEX[id] || questIds.has(id),
    today: new Date().toISOString().slice(0, 10),
  });
  const header = `/**
 * GENERATED by \`npm run docbot:interactions\` — do not hand-edit. The owner's SITTING-2 deck (Doc Bot 2.0
 * WP F): one pending question card per surviving §9.7 anomaly (confidence-floored, fingerprint-deduped),
 * at the fly-through language bar — one short statement, one concrete example, the compact ✓/✕/✎ click
 * tail. Decided through the SAME board + decisions.json as every other pending rule; decisions survive
 * regeneration and rejects tombstone via the shared seed-hygiene pass. THE DECK SHIPS DORMANT — the main
 * session schedules the sitting.
 */
import type { GameRule } from '../schema';

export const INTERACTION_PENDING: GameRule[] = `;
  writeFileSync(
    'packages/rules/src/registry/pendingInteractions.generated.ts',
    `${header}${JSON.stringify(hygiene.pending, null, 2)} as GameRule[];\n`,
  );
  if (hygiene.newTombstones.length) {
    const allTombstones: RetiredRule[] = [...AUTO_RETIRED_RULES, ...hygiene.newTombstones];
    const retiredHeader = `/**
 * GENERATED by \`npm run rules:seed\` — do not hand-edit. AUTO-retired tombstones: pending questions that
 * left the board mechanically (owner REJECTED the recommendation, or the question's content ids vanished),
 * each with an audit record. Entries are append-only — the seeder merges, never drops. Ids here are never
 * recycled as new pending ids (tested in rules.test.ts).
 */
import type { RetiredRule } from './retired';

export const AUTO_RETIRED_RULES: RetiredRule[] = `;
    writeFileSync(
      'packages/rules/src/registry/retired.generated.ts',
      `${retiredHeader}${JSON.stringify(allTombstones, null, 2)} as RetiredRule[];\n\n`
      + 'export const AUTO_RETIRED_IDS: ReadonlySet<string> = new Set(AUTO_RETIRED_RULES.map((r) => r.id));\n',
    );
  }
  console.log(`\nSITTING-2 DECK: ${hygiene.pending.length} pending question card(s) → pendingInteractions.generated.ts (dormant — the main session schedules the sitting)`
    + (hygiene.newTombstones.length ? `; auto-retired ${hygiene.newTombstones.map((t) => t.id).join(', ')}` : ''));
}

// ── artifacts ────────────────────────────────────────────────────────────────────────────────────────────
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'findings.json'), emitFindingsJson(oracle.findings));
  writeFileSync(join(OUT, 'interaction-report.json'), JSON.stringify({
    graph: stats,
    candidates: candReport,
    familyTotals: sweep.familyTotals,
    comboKeys: sweep.comboKeys,
    runs: sweep.runs,
    anomaliesSuppressed: oracle.suppressedByDetector,
  }, null, 2));
  console.log(`  artifacts → ${OUT}`);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const red = failed.length > 0 || tableErrors.length > 0;
console.log(`\n  ${red ? `SWEEP RED — ${failed.length} failed pair diff(s), ${tableErrors.length} table error(s)` : 'SWEEP GREEN (blocked rows are the visible burn-down; anomalies are questions)'} in ${elapsed}s\n`);
process.exit(red ? 1 : 0);
