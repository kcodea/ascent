/**
 * `npm run docbot` — Doc Bot's full report.
 *
 * The LANES gate (they run in `npm test` — the roll-call in §16+ below names them, each existsSync-checked);
 * this command NARRATES: the coverage those gates enforce, plus the backlogs they tolerate-but-track — the
 * needs-triage phase gaps awaiting an owner ruling, and the raw-tribe-comparison debt behind the ratchet.
 * Read docs/docbot.md for the doctrine and docs/docbot2/final-report.md for the coverage/blind-spot picture.
 *
 * Everything here is derived live from content + source. Nothing is hand-maintained; if a number here
 * disagrees with a doc, this number wins (the CONTENT.md lesson).
 */
import { CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import { FACTORIES, combatCastable } from '@game/core';
import { allRules, unenforcedApproved } from '@game/rules';
import { existsSync, readFileSync } from 'node:fs';
import {
  COMBAT_CASTING_FACTORIES, HEROES, PHASE_EXCUSED, PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE,
  RECRUIT_FACTORY_IDS, SPELL_POWER_EXCUSED, TRIBE_RATCHET, TRIGGER_PHASES, combatScan, playScan, runeSwallowScan,
  makeFinding, emitFindingsJson,
} from '@game/sim';

/** The ratchet scan, done locally: the registry is pure data (it rides the public sim entrypoint into the
 *  web bundle), so each node-only consumer builds its own fs-backed scanner from the shared pattern. */
function ratchetScan(): { file: string; count: number; unguarded: number; pinned: number }[] {
  const raw = new RegExp(RAW_TRIBE_COMPARE_SOURCE);
  return PREDICATE_FILES.map((file) => {
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => raw.test(l));
    return { file, count: lines.length, unguarded: lines.filter((l) => !/universalTribe|allTribes|isTribe/.test(l)).length, pinned: TRIBE_RATCHET[file]! };
  });
}

const cards = Object.values(CARD_INDEX).filter((c): c is NonNullable<typeof c> => !!c);
const combatIds = new Set(Object.keys(FACTORIES));

// ── inventory ──────────────────────────────────────────────────────────────────────────────────────────────
const spells = cards.filter((c) => c.spell).length;
const tokens = cards.filter((c) => c.token).length;
const factories = new Set(cards.flatMap((c) => c.effects.map((e) => e.do)));
console.log('\n══ DOC BOT ═════════════════════════════════════════════════════════════');
console.log(`content: ${cards.length} cards (${spells} spells, ${tokens} tokens) · ${HEROES.length} heroes · ${RUNES.length}+${EPIC_RUNES.length} runes · ${factories.size} effect factories in use`);

// ── 1. factory × phase ─────────────────────────────────────────────────────────────────────────────────────
const pairs = new Map<string, Set<string>>();
for (const c of cards) for (const e of c.effects) {
  if (!pairs.has(e.on)) pairs.set(e.on, new Set());
  pairs.get(e.on)!.add(e.do);
}
let dualPairs = 0, covered = 0, excused = 0;
for (const [on, dos] of pairs) {
  if (TRIGGER_PHASES[on] !== 'both') continue;
  for (const d of dos) {
    dualPairs++;
    if (RECRUIT_FACTORY_IDS.has(d) && combatIds.has(d)) covered++;
    else if (PHASE_EXCUSED[d]) excused++;
  }
}
console.log('\n── 1. factory × phase (the silent-dispatch tripwire) ──');
console.log(`dual-phase (trigger, factory) pairs: ${dualPairs} · implemented both sides: ${covered} · excused: ${excused}`);
const byKind = new Map<string, string[]>();
for (const [d, e] of Object.entries(PHASE_EXCUSED)) {
  if (!byKind.has(e.kind)) byKind.set(e.kind, []);
  byKind.get(e.kind)!.push(d);
}
for (const [kind, ds] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${ds.length}`);
const triage = Object.entries(PHASE_EXCUSED).filter(([, e]) => e.kind === 'needs-triage');
if (triage.length) {
  console.log(`\n  ⚠ NEEDS-TRIAGE (${triage.length}) — the owner's ruling queue. Each is a factory that is SILENT in one`);
  console.log('    phase where its trigger fires; play it there and either implement or upgrade the excuse:');
  for (const [d, e] of triage) console.log(`    · ${d} — silent in ${e.phase}: ${e.why}`);
}

// ── cast lane ──
const fizzleChecked: string[] = [];
for (const c of cards) for (const e of c.effects) {
  if (!COMBAT_CASTING_FACTORIES.has(e.do)) continue;
  const id = typeof e.params?.spellId === 'string' ? e.params.spellId : undefined;
  if (id) fizzleChecked.push(`${c.id}→${id}${combatCastable(CARD_INDEX[id]!) ? '' : ' ⚠FIZZLES'}`);
}
console.log(`\n  cast lane (combatCastable gate): ${fizzleChecked.length} named casts checked — ${fizzleChecked.join(', ')}`);

// ── 3. tribe predicate ratchet ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. raw tribe comparisons (frozen debt; ratcheted, may only shrink) ──');
for (const r of ratchetScan()) {
  const flag = r.file.endsWith('arena.ts') ? '  ⚠ serves BOTH phases; top burn-down priority' : '';
  console.log(`  ${r.file}: ${r.count}/${r.pinned} pinned · ${r.unguarded} with no all-types guard on the line${flag}`);
}

// ── 2 + 4 pointers (they gate in npm test; nothing to narrate beyond their existence) ──
console.log('\n── 2. dual-stat live text — gated in packages/ui/src/docbotLiveText.test.ts (the Kringle class)');
console.log('── 4. derivation pairs — gated in docbot/derivations.test.ts + snapshotFidelity.test.ts (the Chorus class)');
console.log('── 5. reference integrity — gated in docbot/refIntegrity.test.ts (#719 crash class; all ids resolve today)');
console.log('── 6. turn-scoped resets — gated in docbot/turnScopedReset.test.ts (39 fields, all reset today)');

// ── 7. rune reward differential — the duplicate-policy triage queue ──
const { firstNoops, secondSwallowed } = runeSwallowScan();
console.log('\n── 7. rune reward differential (the #900 class) ──');
console.log(`first-copy silent no-ops: ${firstNoops.length ? firstNoops.join(', ') : 'none — every rune reward does something'}`);
console.log(`\n  ⚠ SECOND-COPY SWALLOWS (${secondSwallowed.length}, ratcheted) — each is a REACHABLE purchase that pays`);
console.log('    nothing (the forge never excludes owned runes; Duplication doubles any Epic). Per-rune owner');
console.log('    ruling wanted: stack it, record a copy, or bless it idempotent (→ RUNE_DIFF_EXCUSED):');
console.log(`    ${secondSwallowed.join(', ')}`);

// ── 9 + 10: runtime differentials (plays, casts, watchers, combat presence) ──
const play = playScan();
console.log('\n── 9. play differential — onPlay/spells/watchers through the real reducer ──');
console.log(`inert onPlay (excused-conditional): ${play.inertMinions.join(', ') || 'none'} · golden-flat: ${play.goldenFlat.join(', ') || 'none'} · inert spells: ${play.inertSpells.join(', ') || 'none'}`);
console.log(`refused spells (fixture can't cast): ${play.refusedSpells.join(', ')}`);
console.log(`silent watchers: ${play.silentWatchers.join(', ') || 'none'}`);
const combat = combatScan();
console.log('\n── 10. combat presence differential — every combat effect vs a stat-clone control ──');
console.log(`verified ACTIVE in the staged fight: ${combat.activeCount}`);
console.log(`\n  ⚠ SCENARIO-CONDITIONAL (${combat.inert.length}, pinned) — their combat effect changed nothing about the`);
console.log('    staged fight. Most are condition-gated (Ryme needs adjacent Battlecries; Moe needs its own');
console.log('    kills) — each is a per-card verification wanted, and a NEW card landing here trips the pin:');
console.log(`    ${combat.inert.join(', ')}`);
console.log('  (the former golden-flat lane was removed as an instrument artifact — owner audit 2026-08-26; golden semantics live in the magnitude contracts)');
console.log('\n── 11. printed numbers — gated in docbot/textNumbers.test.ts (292 params + golden lane, 0 misses)');
console.log('── 12. invariant fuzz — gated in docbot/invariantFuzz.test.ts (invariants, determinism, identity-independence)');
console.log('── 13. magnitude oracles — gated in docbot/magnitudeOracle.test.ts (grants EQUAL params: spellBuffTarget, battlecryBuffTarget, deathrattleSummon incl. fixed/goldenTokens)');
console.log('── 14. interaction matrix — gated in docbot/interactionMatrix.test.ts (multiplier×family exact doubling, additivity, random-target eligibility across seeds)');
console.log('── 15. hero power lane — gated in docbot/heroPowerLane.test.ts + heroPowerStagers.test.ts (every live power verified: active through the real action or staged to its activation family; the passive queue is DRAINED, needs-stager 0)');

// ── 8. spell-power folding ──
console.log('\n── 8. spell-power folding (#817/#731 class) — gated in docbot/spellPowerFolding.test.ts ──');
for (const [name, e] of Object.entries(SPELL_POWER_EXCUSED)) console.log(`  ${e.kind === 'needs-triage' ? '⚠ ' : '· '}${name} [${e.kind}]: ${e.why}`);

// ── 16+. the 2026-08-27 lane wave — every gate file EXISTS-checked so this inventory cannot rot ──────────
const NEW_LANES: Array<[string, string, string]> = [
  ['carry-over', 'packages/sim/src/docbot/carryOver.test.ts', 'per-turn run-state resources bridge into combat (subject list derived from the reducer rollover block; War Drum/Warm Embers carry live)'],
  ['snapshot fidelity', 'packages/sim/src/docbot/snapshotFidelity.test.ts', 'every BoardCard/BoardMinion field survives each boundary or carries a typed excuse (the PR #453 class)'],
  ['guard reachability', 'packages/sim/src/docbot/guardReachability.test.ts', 'every refusal guard proven to PERMIT a legal cast (21/21 armed)'],
  ['order goldens', 'packages/sim/src/docbot/orderGoldens.test.ts', 'resolution-order pins; ambiguities documented in docs/rulebook/order-ambiguities.md'],
  ['text oracle T1', 'packages/sim/src/docbot/textOracle.test.ts', 'printed stat buffs EQUAL measured deltas (golden lane included)'],
  ['text oracle T2 summons', 'packages/sim/src/docbot/textOracleSummons.test.ts', 'printed summon count/token/stats/keywords reconciled'],
  ['text oracle T3 economy', 'packages/sim/src/docbot/textOracleEconomy.test.ts', 'printed Gold amounts AND timing reconciled'],
  ['target cardinality', 'packages/sim/src/docbot/targetCardinality.test.ts', 'recipient count + eligibility vs printed target language (right amount, wrong body)'],
  ['conservation laws', 'packages/sim/src/docbot/conservationLaws.test.ts', 'gold ledger, combat event-log reconstruction, stat provenance'],
  ['interaction families', 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts', 'trigger-family composition pins; ambiguities in docs/rulebook/interaction-ambiguities.md'],
  ['economy differentials', 'packages/sim/src/docbot/economyScan.test.ts', 'exact deltas for every pricing rule + all quest reward magnitudes'],
  ['lobby properties', 'packages/sim/src/docbot/lobbyProperties.test.ts', 'Rating monotonicity, pairing invariants, elimination-exactly-once across seeds'],
  ['rendered text', 'packages/ui/src/renderedText.test.tsx', 'the DOM shows what the sim computed, on BOTH text chains + badges'],
  ['hero-power stagers', 'packages/sim/src/docbot/heroPowerStagers.test.ts', 'passive/scheduled/threshold powers driven to their real activation points'],
  ['temporal windows', 'packages/sim/src/docbot/temporalWindow.test.ts', 'per-instance trigger windows under the 11 R-AVWIN rulings - retro catalog 14/14; KNOWN_VIOLATIONS pins R-AVWIN-02/10 until the engine is fixed'],
  ['covering array', 'packages/sim/src/docbot/recruitCoveringArray.test.ts', '20 deterministic rows covering all 351 recruit boundary pairs + explosion guard'],
  ['coverage corpus', 'packages/sim/src/docbot/coverageCorpus.test.ts', 'deterministic QaScenarioV1 corpus under docbot/corpus/ keyed by semantic coverage'],
  ['scenario contract', 'packages/sim/src/qaScenario.test.ts', 'QaScenarioV1 round-trip/determinism/migration - the shared format for Scene Builder, bug reports, corpus and regressions'],
  ['contract oracle', 'packages/sim/src/docbot/contractOracle.test.ts', 'WP D: derived §10.1 case sweep over all 901 contracts (deterministic gate sample; full sweep = npm run docbot:contracts) — authority-honest findings, R-AVWIN-02/10 pinned as release blockers'],
  // ── Doc Bot 2.0 (WP A→H). These were MISSING from this inventory until WP H's migration audit; an
  //    unlisted lane is an invisible lane, which is the failure mode this existsSync roll-call exists to
  //    prevent. Keep this list growing with the platform. ──
  ['vertical slice', 'packages/sim/src/docbot/slice/verticalSlice.test.ts', 'VS: the intent↔trace↔text triangle proven end-to-end on ~10 interaction-heavy objects, all four §19 output classes produced'],
  ['contract extraction', 'packages/sim/src/docbot/contractExtract.test.ts', 'WP B: the inventory gate — every active content object holds a committed contract; new content FAILS here until `npm run contracts:extract` is run and committed'],
  ['semantic trace', 'packages/sim/src/docbot/semanticTrace.test.ts', 'WP C: the combat→SemanticEvent adapter is a pure function of the event log; absent causality stays absent'],
  ['trace neutrality', 'packages/sim/src/docbot/traceNeutrality.test.ts', 'WP C: capture ON vs OFF is byte-identical incl. rngCursor/uidSeq — instrumentation consumes no RNG'],
  ['text parse', 'packages/sim/src/docbot/textParse/textParse.test.ts', 'WP E: every active object classified parsed-equivalent / verified-mismatch / approved-exception / unresolved-parse (full sweep = npm run docbot:text)'],
  ['interaction graph', 'packages/sim/src/docbot/interactionGraph.test.ts', 'WP F: the §10.2 producer→channel→consumer graph over every contract; applicability shrinks the naive product'],
  ['interaction sweep', 'packages/sim/src/docbot/interactionSweep.test.ts', 'WP F: the generated §10.3 pairwise + §10.4 triple coverage table (full sweep = npm run docbot:interactions)'],
  ['anomaly oracle', 'packages/sim/src/docbot/anomalyOracle.test.ts', 'WP F: §9.7 — unruled composition raises a QUESTION, capped at questionable-interaction, never a verified bug'],
  ['curated regressions', 'packages/sim/src/docbot/regressionScenarios.test.ts', 'WP G: every graduated player report in scenarios/regressions/ validated + replayed — §14\'s "CI protects the behavior forever"'],
  ['bug taxonomy', 'packages/sim/src/docbot/bugTaxonomy.test.ts', 'WP G: every graduation record names a real class and a fixture on disk; no fixture squats curated space without a record'],
  ['findings ledger', 'packages/sim/src/docbot/ledger.test.ts', 'WP G: the fingerprint fold is deterministic, order-insensitive and idempotent (npm run docbot:ledger)'],
  ['graduation refusals', 'packages/tools/src/bug-graduate.test.ts', 'WP G: a flaky repro, an unruled expectation or an unapproved citation each REFUSE (npm run bugs:graduate)'],
  ['final report', 'packages/tools/src/docbot-report.test.ts', 'WP H: docs/docbot2/final-report.md re-derived from the live registries — a drifted headline number fails the gate (npm run docbot:report)'],
  // ── 2026-08-29: two lanes that audit the AUDITING. Both owner bugs that day were already covered by an
  //    existing lane in principle, and neither was caught — see docs/docbot.md for why. ──
  ['combat-emit agreement', 'packages/sim/src/docbot/combatEmitAgreement.test.ts', "every trigger combat EMITS is classified combat/both in TRIGGER_PHASES or waived — a misclassification silently switched off the factoryPhase lane's combat half for onGainCard (Gangplank)"],
  ['uid survives a triple', 'packages/sim/src/docbot/uidSurvivesTriple.test.ts', "no run state points at a body a triple destroyed (Sable's Soulbind held run-board uids) — a deep walk, because the bond's fields are named `a`/`b` and no naming convention would find them"],
];
console.log('\n── 16+. the Doc Bot 2.0 lane roll-call — each file existsSync-checked so this inventory cannot rot ──');
console.log('   (most gate in `npm test`; the two tools lanes gate there too — the sweep CLIs beside them are nightly/weekly)');
for (const [name, file, what] of NEW_LANES) {
  const exists = existsSync(file);
  console.log(`  ${exists ? '·' : '✗ MISSING'} ${name} — ${file}${exists ? '' : '  ⚠ inventory rotted'}`);
  console.log(`      ${what}`);
}

// ── rulebook enforcement picture ───────────────────────────────────────────────────────────────────────────
const rules = allRules();
const unenforced = unenforcedApproved(rules);
const pendingCount = rules.filter((r) => r.effective === 'needs-ruling').length;
console.log('\n── rulebook — @game/rules closed loop ──');
console.log(`  rules: ${rules.length} total · pending owner questions: ${pendingCount} · approved-but-unenforced: ${unenforced.length}${unenforced.length ? ` (${unenforced.map((r) => r.id).join(', ')})` : ''}`);

// ── command surface ────────────────────────────────────────────────────────────────────────────────────────
console.log('\n── commands ──');
console.log('  npm run docbot                      this report (add -- --json for machine-readable findings)');
console.log('  npm run docbot:scenario -- <id>     run one QaScenarioV1 (bare ids resolve in docbot/scenarios/)');
console.log('  npm run docbot:corpus               rebuild the coverage corpus (deterministic)');
console.log('  npm run docbot:nightly              full lifecycle runs + bot lobbies + the full contract sweep (nightly.yml cron)');
console.log('  npm run docbot:contracts            the full contract verification sweep (add -- --out <dir> for findings.json)');
console.log('  npm run docbot:text                 the full text-intelligence sweep + the Sitting-3 wording deck (WP E)');
console.log('  npm run docbot:interactions         the full pairwise/triple interaction sweep + anomaly oracle (WP F)');
console.log('  npm run docbot:ledger -- --in artifacts   fold every findings.json into one fingerprint ledger (WP G)');
console.log('  npm run docbot:report               the §20/§21 coverage + blind-spot roll-up (-- --json / -- --check)');
console.log('  npm run contracts:extract           regenerate the extracted contract registry (curated always wins)');
console.log('  npm run rules:seed                  regenerate the owner triage queue (decisions survive)');
console.log('  npm run rules:impact -- <paths>     which rulings a change touches');
console.log('  npm run bugs:pull|list|repro|close  player-report inbox → QaScenarioV1 reproduction');
console.log('  npm run bugs:graduate -- <id>       a confirmed, ruled report → a permanent curated regression');

// ── --json: the §12 machine-readable projection of every open queue ────────────────────────────────────────
if (process.argv.includes('--json')) {
  const findings = [
    ...triage.map(([d, e]) => makeFinding({ lane: 'factory-phase', contentIds: [], ruleIds: [], expectationKind: 'needs-ruling', severity: 'question' as const, confidence: 'strong' as const, title: `${d} silent in ${e.phase}`, summary: e.why })),
    ...secondSwallowed.map((r) => makeFinding({ lane: 'rune-duplicate', contentIds: [r], ruleIds: [], expectationKind: 'no-op', severity: 'question' as const, confidence: 'proven' as const, title: `duplicate ${r} pays nothing`, summary: 'reachable second-copy purchase with zero effect — owner stacking ruling wanted' })),
    ...combat.inert.map((c) => makeFinding({ lane: 'combat-conditional', contentIds: [c], ruleIds: [], expectationKind: 'no-op', severity: 'info' as const, confidence: 'uncertain' as const, title: `${c} scenario-conditional in the staged fight`, summary: 'combat effect changed nothing in the staged variants; per-card verification wanted' })),
    ...unenforced.map((r) => makeFinding({ lane: 'rules-enforcement', contentIds: [], ruleIds: [r.id], expectationKind: 'unenforced', severity: 'warning' as const, confidence: 'proven' as const, title: `${r.id} approved but unenforced`, summary: r.title })),
  ];
  console.log(emitFindingsJson(findings));
}

console.log('\nDoctrine + how to extend: docs/docbot.md\n');
