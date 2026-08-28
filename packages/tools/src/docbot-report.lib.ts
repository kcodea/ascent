/**
 * DOC BOT 2.0 WP H — the FINAL-REPORT GENERATOR (blueprint §20 metrics + §21 Definition of Done + §24.15).
 *
 * `docs/docbot2/final-report.md` states numbers about the platform. Hand-maintained numbers rot (the
 * CONTENT.md lesson), so every headline number in that document is DERIVED HERE and the doc is checked
 * against this module by `docbot-report.test.ts`. If the doc and this generator disagree, the generator
 * wins and the doc is wrong.
 *
 * WHY IT LIVES IN `packages/tools` and not in `@game/sim`:
 *   it pulls the whole rules registry AND the 901-row contract registry (both pure data) through
 *   `@game/rules` + `@game/rules/contracts`. Exporting it from the sim entrypoint would ride that data
 *   into the web bundle — the exact trap `semanticRevision.ts` and docbot.ts's local `ratchetScan` already
 *   dodge (current-state-map D-2). Node-only consumers build their own; this is one of them.
 *
 * HONESTY RULES BAKED IN (§4.3 — no silent uncertainty):
 *  · every percentage carries its numerator AND denominator, so a reader can re-derive it;
 *  · "covered" never means "cited" — the contract fold counts direct execution and corroboration only,
 *    exactly as `runContractSweep` derives it, and lane citations are reported in their own field;
 *  · the blind-spot list is DERIVED where a number backs it (unresolved parses, no-driver shapes, blocked
 *    pairs, graduated regressions) and hand-written only where the limit is categorical (visual/FX, fun).
 *
 * Deliberately NOT included: anything requiring `playScan()`/`combatScan()`. Those are the expensive half
 * of Doc Bot and already gate elsewhere; keeping them out is what lets the doc-drift test ride the PR gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';
import {
  APPROVED_RULES, CONVENTION_PENDING, INTERACTION_PENDING, LANGUAGE_GUIDE, RETIRED_RULES, WORDING_PENDING,
  allRules, unenforcedApproved,
} from '@game/rules';
import { CURATED_CONTRACT_IDS, allContracts } from '@game/rules/contracts';
import { ENFORCEMENT_LANES } from '@game/rules';
import {
  RETRO_INTERACTION_MAP, archivedInventory, buildInteractionGraph, candidatePairs, graphStats, releaseBlockerFindings,
  runAnomalyOracle, runContractSweep, runInteractionSweep, runRewriteAdvisor, runTextSweep, textObjectOf,
  type DocbotFinding, type FindingClass,
} from '@game/sim';
import { semanticRevision } from '@game/sim/semanticRevision';

export const REPORT_COMMAND = 'npm run docbot:report';
export const REPORT_SCHEMA_VERSION = 1;

/** A ratio reported honestly: never a bare percentage. */
export interface Ratio {
  of: number;
  total: number;
  pct: number;
}

const ratio = (of: number, total: number): Ratio =>
  ({ of, total, pct: total === 0 ? 0 : Math.round((1000 * of) / total) / 10 });

export interface FinalReport {
  schemaVersion: number;
  generatedBy: string;
  /** `<buildSha>.<contentRev>.<rulesRev>.<schemaRev>` — the §16 identity these numbers were measured under. */
  semanticRevision: string;
  commit: string;

  inventory: {
    cards: number; spells: number; tokens: number; heroes: number;
    runes: number; epicRunes: number; quests: number;
    /** The contract registry's own count of active objects (cards + runes + quests + hero powers). */
    activeObjects: number;
    /** How much of `activeObjects` covers an ARCHIVED content class — a system switched off but neither
     *  deleted nor un-contracted. Reported, never subtracted; see `ARCHIVED_CONTENT_TYPES`. */
    archived: { byType: Record<string, number>; total: number };
  };

  contracts: {
    total: number; curated: number; extracted: number;
    withContract: Ratio;
    /** Derived status folded from corroboration + direct suites only (citations excluded, by design). */
    derived: Record<string, number>;
    /** Contracts with at least one case a driver actually EXECUTED this sweep. */
    withDirectExecution: Ratio;
    /** Contracts whose coverage is only a lane citation (evidence a human can follow — not a fold). */
    citedOnly: number;
    templateTotals: Record<string, { applicable: number; executed: number; skipped: number }>;
    skippedByReason: Record<string, number>;
    mismatches: number;
    metamorphicFailures: number;
    limitFailures: number;
  };

  text: {
    classified: Ratio;
    buckets: Record<string, number>;
    unresolvedParse: number;
    verifiedMismatch: number;
    unpinnedMismatches: number;
    staleKnownPins: number;
    recommendations: number;
    languageGuideRules: number;
  };

  rules: {
    total: number; approved: number; retired: number;
    needsRuling: number;
    approvedButUnenforced: string[];
    releaseBlockers: string[];
    /** The three DORMANT decks — reachable needs-ruling cards awaiting a sitting. */
    decks: { conventions: number; interactions: number; wording: number };
  };

  interactions: {
    graphNodes: number; graphEdges: number;
    candidatePairs: number; naivePairs: number; candidatePct: number;
    unmappedTriggers: number;
    sweepRows: number;
    covered: number; failed: number; inapplicable: number; blocked: number;
    familiesWithCoverage: Ratio;
    combinationKeys: number;
    anomalies: number;
    anomaliesSuppressed: number;
  };

  retro: {
    entries: number;
    caught: number;
    byReinjectRun: number;
    byClassAnalysis: number;
    multiSystem: number;
  };

  findings: Record<FindingClass | 'unclassified', number>;

  oracles: {
    /** vitest lane FILES under packages/sim/src/docbot (the executable half of the platform). */
    docbotLanes: number;
    /** …of which carry an in-file mutation/sabotage proof (the §4.5 obligation). */
    withSabotageEvidence: Ratio;
    /** Named lanes an `oracle` rule-enforcement ref may cite (each fs-checked by enforcement.test.ts). */
    enforcementLanes: number;
  };

  learningLoop: {
    /** Curated regressions on disk — graduated player reports the PR gate replays forever. */
    graduatedRegressions: number;
    curatedFixtures: number;
    generatedCorpusEntries: number;
  };

  /** Every honest limit, each with the number that measures it (0 where the limit is categorical). */
  blindSpots: Array<{ id: string; count: number | null; what: string }>;
}

/** `git rev-parse --short HEAD`, or 'unknown' outside a checkout (never throws — a report must still run). */
export function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

const DOCBOT_DIR = join('packages', 'sim', 'src', 'docbot');

/** Every `*.test.ts` under docbot/ (one level of nesting — textParse/ and slice/), sorted. */
function docbotLaneFiles(root = DOCBOT_DIR): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...docbotLaneFiles(p));
    else if (e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

export interface BuildReportOptions {
  commit?: string;
  /** Counted from disk by the CLI (fs access kept out of the pure-ish builder's required path). */
  graduatedRegressions?: number;
  curatedFixtures?: number;
  generatedCorpusEntries?: number;
}

export function buildFinalReport(opts: BuildReportOptions = {}): FinalReport {
  const commit = opts.commit ?? currentCommit();
  const contracts = allContracts();
  const rules = allRules();

  // ── contracts (WP B/D) ────────────────────────────────────────────────────────────────────────────────
  const sweep = runContractSweep({ contracts });
  const executedIds = new Set(sweep.executed.map((e) => e.contractId));
  const citedOnly = sweep.rows.filter((r) => !executedIds.has(r.contractId) && r.citedAspects.length > 0).length;

  // ── text (WP E) ───────────────────────────────────────────────────────────────────────────────────────
  const text = runTextSweep({ contracts });
  const recs = runRewriteAdvisor({ objects: contracts.map(textObjectOf), guide: LANGUAGE_GUIDE });

  // ── interactions (WP F) ───────────────────────────────────────────────────────────────────────────────
  const graph = buildInteractionGraph(contracts);
  const gStats = graphStats(graph);
  const { report: cand } = candidatePairs(graph, contracts);
  const iSweep = runInteractionSweep({ contracts, triples: true });
  const anomalies = runAnomalyOracle({ runs: iSweep.runs, contracts });
  const familyTotals = Object.values(iSweep.familyTotals);
  const tally = (k: 'covered' | 'failed' | 'inapplicable' | 'blocked'): number =>
    familyTotals.reduce((n, t) => n + t[k], 0);

  // ── rules ─────────────────────────────────────────────────────────────────────────────────────────────
  const blockers = releaseBlockerFindings(rules);
  const reachable = (deck: readonly { id: string }[]): number => {
    const ids = new Set(deck.map((d) => d.id));
    return rules.filter((r) => ids.has(r.id) && r.effective === 'needs-ruling').length;
  };

  // ── the four §12.1 classes, over every finding this platform can emit in one pass ──────────────────────
  const allFindings: DocbotFinding[] = [
    ...sweep.findings, ...blockers, ...text.findings, ...recs, ...anomalies.findings,
  ];
  const findings: Record<string, number> = {
    'verified-mechanical-bug': 0, 'verified-text-defect': 0, 'wording-recommendation': 0,
    'questionable-interaction': 0, 'coverage-gap': 0, unclassified: 0,
  };
  for (const f of allFindings) findings[f.class ?? 'unclassified'] = (findings[f.class ?? 'unclassified'] ?? 0) + 1;

  const cards = Object.values(CARD_INDEX).filter((c): c is NonNullable<typeof c> => !!c);
  const heroPowerContracts = contracts.filter((c) => c.contentId.startsWith('hero:')).length;

  const noDriver = sweep.skippedByReason['no-driver-for-shape'] ?? 0;
  const familiesCovered = familyTotals.filter((t) => t.covered > 0).length;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedBy: REPORT_COMMAND,
    semanticRevision: semanticRevision(commit),
    commit,

    inventory: {
      cards: cards.length,
      spells: cards.filter((c) => c.spell).length,
      tokens: cards.filter((c) => c.token).length,
      heroes: heroPowerContracts,
      runes: RUNES.length,
      epicRunes: EPIC_RUNES.length,
      quests: QUEST_DEFS.length,
      activeObjects: contracts.length,
      /** Contracts belonging to an ARCHIVED content class (owner ruling 2026-08-28: the quest system and the
       *  henchman system). These are still extracted, still gated by the WP B inventory check and still swept
       *  by the oracle/text lanes — this line exists so 118 contracts' worth of INACTIVE content is visibly
       *  labelled instead of being read as live coverage. See `ARCHIVED_CONTENT_TYPES` in contractExtract.ts. */
      archived: archivedInventory(contracts),
    },

    contracts: {
      total: contracts.length,
      curated: CURATED_CONTRACT_IDS.size,
      extracted: contracts.length - CURATED_CONTRACT_IDS.size,
      withContract: ratio(contracts.length, contracts.length),
      derived: { ...sweep.statusTotals },
      withDirectExecution: ratio(executedIds.size, contracts.length),
      citedOnly,
      templateTotals: Object.fromEntries(Object.entries(sweep.templateTotals).map(([k, v]) => [k, { ...v }])),
      skippedByReason: { ...sweep.skippedByReason },
      mismatches: sweep.mismatches.length,
      metamorphicFailures: sweep.metamorphic.filter((m) => !m.diff.ok).length,
      limitFailures: sweep.limitChecks.filter((l) => !l.ok).length,
    },

    text: {
      classified: ratio(text.total, contracts.length),
      buckets: { ...text.buckets },
      unresolvedParse: text.buckets['unresolved-parse'],
      verifiedMismatch: text.buckets['verified-mismatch'],
      unpinnedMismatches: text.unpinnedMismatchIds.length,
      staleKnownPins: text.staleKnownIds.length,
      recommendations: recs.length,
      languageGuideRules: LANGUAGE_GUIDE.length,
    },

    rules: {
      total: rules.length,
      approved: APPROVED_RULES.length,
      retired: RETIRED_RULES.length,
      needsRuling: rules.filter((r) => r.effective === 'needs-ruling').length,
      approvedButUnenforced: unenforcedApproved(rules).map((r) => r.id),
      releaseBlockers: [...new Set(blockers.flatMap((f) => f.ruleIds))].sort(),
      decks: {
        conventions: reachable(CONVENTION_PENDING),
        interactions: reachable(INTERACTION_PENDING),
        wording: reachable(WORDING_PENDING),
      },
    },

    interactions: {
      graphNodes: gStats.nodes,
      graphEdges: gStats.edges,
      candidatePairs: cand.candidatePairs,
      naivePairs: cand.naivePairs,
      candidatePct: Math.round((1000 * cand.candidatePairs) / cand.naivePairs) / 10,
      unmappedTriggers: cand.unmappedTriggers.length,
      sweepRows: iSweep.runs.length,
      covered: tally('covered'),
      failed: tally('failed'),
      inapplicable: tally('inapplicable'),
      blocked: tally('blocked'),
      familiesWithCoverage: ratio(familiesCovered, familyTotals.length),
      combinationKeys: iSweep.comboKeys.length,
      anomalies: anomalies.findings.length,
      anomaliesSuppressed: anomalies.suppressedTotal,
    },

    retro: {
      entries: RETRO_INTERACTION_MAP.length,
      // Every catalog entry carries a family/lane citation; retroMapErrors() fails the gate if one loses it.
      caught: RETRO_INTERACTION_MAP.filter((e) => e.families.length > 0 || e.lanes.length > 0).length,
      byReinjectRun: RETRO_INTERACTION_MAP.filter((e) => e.verifiedBy === 'reinject-run').length,
      byClassAnalysis: RETRO_INTERACTION_MAP.filter((e) => e.verifiedBy === 'class-analysis').length,
      multiSystem: RETRO_INTERACTION_MAP.filter((e) => e.multiSystem).length,
    },

    findings: findings as FinalReport['findings'],

    oracles: (() => {
      const lanes = docbotLaneFiles();
      const sabotaged = lanes.filter((f) => /sabotag/i.test(readFileSync(f, 'utf8'))).length;
      return {
        docbotLanes: lanes.length,
        withSabotageEvidence: ratio(sabotaged, lanes.length),
        enforcementLanes: Object.keys(ENFORCEMENT_LANES).length,
      };
    })(),

    learningLoop: {
      graduatedRegressions: opts.graduatedRegressions ?? 0,
      curatedFixtures: opts.curatedFixtures ?? 0,
      generatedCorpusEntries: opts.generatedCorpusEntries ?? 0,
    },

    blindSpots: [
      { id: 'visual-fx', count: null, what: 'whether an animation, FX binding or beat LOOKS right — §22 non-goal; beats:audit checks wiring, never appearance' },
      { id: 'fun-and-balance', count: null, what: 'whether a working card is too strong, or a design is fun — §22 non-goal; the balance tools answer strength, not correctness' },
      { id: 'undecided-design', count: rules.filter((r) => r.effective === 'needs-ruling').length, what: 'behaviour with no approved rule cannot be called broken — it reports as questionable (§4.3)' },
      { id: 'unresolved-parse', count: text.buckets['unresolved-parse'], what: 'printed text the WP E parser could not fully resolve — classified, queued, never counted as a clean pass' },
      { id: 'no-driver-contract-shapes', count: noDriver, what: 'applicable isolated cases with no executable driver yet — the largest single contract-coverage hole' },
      { id: 'interaction-blocked-pairs', count: tally('blocked'), what: 'candidate pairs the sweep could not observe (no emission, no generic driver) — visible burn-down, not silence' },
      { id: 'hero-power-magnitudes', count: sweep.skippedByReason['hero-power-behaviour-unextracted'] ?? 0, what: 'hero-power magnitude claims are not extracted; activation is covered by heroPowerLane/heroPowerStagers, magnitude is not' },
      { id: 'graduated-regressions', count: opts.graduatedRegressions ?? 0, what: 'real player reports that have completed capture→ruling→graduation; the loop is proven by a synthetic walkthrough only' },
      { id: 'combat-causality', count: null, what: 'WP C adapts CombatEvent into a semantic trace but the combat log carries no parent/cause ids — causality in combat is inferred from ordering, not stamped' },
      { id: 'rng-decision-trace', count: null, what: 'the RNG tap is observational; which choice a roll produced is not attributed to a decision site' },
      { id: 'anomaly-suppression', count: anomalies.suppressedTotal, what: 'anomalies below the confidence floor are counted but not reported — deliberate noise control, and a place a real question can hide' },
    ],
  };
}

/** The doc-drift contract: the exact numbers `docs/docbot2/final-report.md` must state verbatim. */
export function headlineNumbers(r: FinalReport): Record<string, number> {
  return {
    'contracts.total': r.contracts.total,
    // The ARCHIVED-content count is a HEADLINE number on purpose (owner ruling 2026-08-28). Archiving a
    // content class is exactly the move that can make coverage evaporate unnoticed, so the drift rail makes
    // the number a documented claim: the final report must state how much of its coverage is of inactive
    // content, and the moment that figure moves the gate fails until the doc is rewritten.
    'inventory.archived.total': r.inventory.archived.total,
    'contracts.curated': r.contracts.curated,
    'contracts.derived.corroborated': r.contracts.derived['corroborated'] ?? 0,
    'contracts.withDirectExecution.of': r.contracts.withDirectExecution.of,
    'contracts.noDriverForShape': r.contracts.skippedByReason['no-driver-for-shape'] ?? 0,
    'text.classified.of': r.text.classified.of,
    'text.unresolvedParse': r.text.unresolvedParse,
    'text.verifiedMismatch': r.text.verifiedMismatch,
    'text.recommendations': r.text.recommendations,
    'rules.total': r.rules.total,
    'rules.approved': r.rules.approved,
    'rules.needsRuling': r.rules.needsRuling,
    'interactions.graphNodes': r.interactions.graphNodes,
    'interactions.graphEdges': r.interactions.graphEdges,
    'interactions.candidatePairs': r.interactions.candidatePairs,
    'interactions.covered': r.interactions.covered,
    'interactions.blocked': r.interactions.blocked,
    'interactions.anomalies': r.interactions.anomalies,
    'retro.entries': r.retro.entries,
    'retro.caught': r.retro.caught,
    'oracles.docbotLanes': r.oracles.docbotLanes,
    'oracles.withSabotageEvidence': r.oracles.withSabotageEvidence.of,
    'decks.conventions': r.rules.decks.conventions,
    'decks.interactions': r.rules.decks.interactions,
    'decks.wording': r.rules.decks.wording,
  };
}

/**
 * Every headline number must appear, as a standalone token, somewhere in the doc. Deliberately a
 * CONTAINMENT check rather than a parse: it catches the failure that actually happens (a number moves and
 * the prose keeps the old one) without dictating how the prose is written.
 */
export function docClaimErrors(markdown: string, r: FinalReport): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(headlineNumbers(r))) {
    const token = new RegExp(`(^|[^\\d.,])${value}([^\\d.%]|%|$)`, 'm');
    if (!token.test(markdown)) errors.push(`${key} = ${value} does not appear in the document — run \`${REPORT_COMMAND}\` and update it`);
  }
  if (!markdown.includes(REPORT_COMMAND)) errors.push(`the document must cite its generator (\`${REPORT_COMMAND}\`)`);
  if (!/commit\s*[`:]/i.test(markdown)) errors.push('the document must stamp the commit it was generated at');
  return errors;
}
