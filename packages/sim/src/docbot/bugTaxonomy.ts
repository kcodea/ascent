/**
 * DOC BOT 2.0 WP G — THE BUG TAXONOMY (blueprint §14: "add or update historical bug taxonomy").
 *
 * `retroInteractionMap.ts` answers the question backwards-looking: for each bug we ALREADY shipped and
 * catalogued, which generalized family or lane catches its class? This registry answers it forwards: when
 * a NEW player report graduates into a permanent regression, which class did it belong to, and what lane
 * already guards that class? Same shape, same honesty rules, same cross-check discipline — deliberately,
 * so the two can be read side by side and eventually merged.
 *
 * TWO HALVES, on purpose:
 *  · `BUG_TAXONOMY` — CURATED (§4.6). Hand-authored class definitions. `bugs:graduate` READS it to place
 *    a report; it never writes here. A new class is a human decision with a rationale.
 *  · `bugTaxonomy.graduated.json` — MACHINE-APPENDED. One record per graduation: the report, the finding
 *    fingerprint, the curated regression scenario, the semantic revision, the PR. Append-only, sorted,
 *    byte-stable. This is the file the graduation command updates, and `bugTaxonomy.test.ts` cross-checks
 *    every record against the taxonomy and against the scenario files actually on disk.
 *
 * SIBLINGS (§14 "generate sibling scenarios where a general bug class is identified"): this registry
 * records `siblingCoverage` per class and NOTHING fabricates siblings. A class marked `single-pin` carries
 * a visible TODO the graduation command prints; a class marked `generalized` names the family whose
 * generator already produces the siblings. Inventing plausible-looking sibling fixtures would be exactly
 * the silent uncertainty §4.3 bans.
 */
import type { PairFamilyId, TripleFamilyId } from './interactionSweep';
import { PAIR_FAMILIES, TRIPLE_FAMILIES } from './interactionSweep';

export interface BugClassEntry {
  /** Stable slug — the `--class` argument of `bugs:graduate`. */
  classId: string;
  title: string;
  /** Generalized interaction families whose generated scenarios exercise this class (may be empty for a
   *  single-system class whose `lanes` carry the catch). */
  families: Array<PairFamilyId | TripleFamilyId>;
  /** Repo-relative lane files that catch the class today. At least one of families/lanes must be present. */
  lanes: string[];
  /** One line: WHY that family/lane catches this class. */
  why: string;
  /** 'generalized' = a family generator already produces siblings across the class.
   *  'single-pin'   = today the class is guarded by ONE pinned fixture; siblings are outstanding work.
   *  The graduation command prints the outstanding TODO for a 'single-pin' class — it never invents them. */
  siblingCoverage: 'generalized' | 'single-pin';
  /** Free-text note about what sibling work remains (required when siblingCoverage is 'single-pin'). */
  siblingTodo?: string;
}

/**
 * The classes a graduated report can land in. Seeded from the shapes the repo has actually shipped bugs in
 * (the retro catalog's 14 entries cluster into these); grow it when a report genuinely does not fit —
 * a forced fit is worse than a new class.
 */
export const BUG_TAXONOMY: readonly BugClassEntry[] = [
  {
    classId: 'trigger-window-ordinal',
    title: 'A trigger window counts the wrong population or the wrong ordinal',
    families: ['death-x-avenge'],
    lanes: ['packages/sim/src/docbot/temporalWindow.test.ts'],
    why: 'per-instance window state (arrival wave, threshold ordinal, reset boundary) is what the temporal oracle enumerates; a miscounted window moves the first-fire ordinal off its declared threshold',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'multiplier-fold',
    title: 'A repeat/multiplier effect is not folded into the ability it multiplies',
    families: ['trigger-x-multiplier', 'death-x-echo'],
    lanes: ['packages/sim/src/docbot/interactionFamilyMatrix.test.ts', 'packages/sim/src/docbot/combatModLane.test.ts'],
    why: 'the family diff runs the same board with and without the multiplier and asserts the exact ×(1+extra) fold — a dropped consult reads ×1 on every candidate, not just the reported one',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'copy-carry-over',
    title: 'A copy/merge carries state it should shed, or sheds state it should carry',
    families: ['copy-x-counter', 'granted-effect-x-snapshot'],
    lanes: ['packages/sim/src/docbot/carryOver.test.ts', 'packages/sim/src/docbot/missDrivenOracles.test.ts'],
    why: 'the carry-over registry enumerates every per-instance field across copy/merge/snapshot boundaries, so "what rides a copy" is a table, not a case',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'phase-dispatch-gap',
    title: 'An effect factory is missing from one phase\'s dispatch map (fizzles in that phase only)',
    families: [],
    lanes: ['packages/sim/src/docbot/factoryPhase.test.ts'],
    why: 'the factory×phase tripwire requires every (trigger, factory) pair to be implemented wherever its trigger dispatches — the class is enumerable, so one lane covers all of it',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'target-eligibility',
    title: 'A targeted effect reaches an ineligible target (tribe gate, self-flag, cardinality)',
    families: [],
    lanes: ['packages/sim/src/docbot/targetCardinality.test.ts', 'packages/sim/src/docbot/tribePredicates.test.ts'],
    why: 'the eligibility sweep asserts tribe-scoped and self-scoped effects only touch eligible targets across seeds — the generalized detector for the whole class',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'economy-magnitude',
    title: 'An economy magnitude (Gold, Embers, caps, rewards) diverges from its content definition',
    families: [],
    lanes: ['packages/sim/src/docbot/economyScan.test.ts', 'packages/sim/src/docbot/conservationLaws.test.ts'],
    why: 'economy scan verifies every magnitude against its def and the conservation laws bound totals — a cap or lead applied to the wrong pool fails both',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'resolution-order',
    title: 'Non-commuting effects resolve in the wrong order',
    families: ['summon-x-watcher'],
    lanes: ['packages/sim/src/docbot/orderGoldens.test.ts'],
    why: 'the ordering goldens pin the non-commuting pairs; a flipped iteration order changes the pinned result',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'live-text-staleness',
    title: 'Printed text shows a base or stale value instead of the live one (CLAUDE.md hard rule)',
    families: [],
    lanes: ['packages/sim/src/docbot/textNumbers.test.ts', 'packages/sim/src/docbot/textOracle.test.ts'],
    why: 'the text oracles compare the printed number against the value the effect will actually produce right now, on every surface — the whole class is one sweep',
    siblingCoverage: 'generalized',
  },
  {
    classId: 'recruit-combat-identity',
    title: 'An identity established in recruit does not survive the combat boundary (or vice versa)',
    families: ['granted-effect-x-snapshot'],
    lanes: ['packages/sim/src/docbot/snapshotFidelity.test.ts', 'packages/sim/src/docbot/combatModLane.test.ts'],
    why: 'the snapshot-fidelity registry enumerates the identity fields that must cross the recruit→combat boundary; a bond keyed on the wrong one never matches its combat clone',
    siblingCoverage: 'single-pin',
    siblingTodo: 'the family\'s generated driver is outstanding (see current-state-map §5) — until it lands, a graduation here pins ONE board; siblings must be authored by hand or wait for the driver',
  },
  {
    classId: 'unclassified',
    title: 'Not yet placed in a class — the honest default',
    families: [],
    lanes: ['packages/sim/src/docbot/qaScenarioParity.test.ts'],
    why: 'the curated regression itself is the only guard; the parity lane runs every checked-in scenario, so the pin executes — but nothing generalizes it yet',
    siblingCoverage: 'single-pin',
    siblingTodo: 'classify this report into a real class (or add one) before claiming class coverage — an unclassified graduation protects exactly the reported board and nothing else',
  },
] as const;

export const bugClass = (classId: string): BugClassEntry | undefined =>
  BUG_TAXONOMY.find((e) => e.classId === classId);

/** Every class id, for CLI usage text and the workbench filter. */
export const BUG_CLASS_IDS: readonly string[] = BUG_TAXONOMY.map((e) => e.classId);

// ── The machine-appended graduation records ──────────────────────────────────────────────────────────────

/** One graduation: the full provenance chain §14 requires, in one record. */
export interface GraduationRecord {
  /** The curated regression scenario id (`regression-<short report id>-…`). Primary key. */
  scenarioId: string;
  classId: string;
  /** The player report this came from (full uuid). */
  reportId: string;
  /** The finding fingerprint that classified it, when the graduation cited one. */
  findingFingerprint?: string;
  /** §16 semantic revision the reproduction was validated under. */
  semanticRevision?: string;
  /** Approved rule / contract ids that establish the expected behaviour. At least one of these or
   *  `ownerDecision` must be present — that is exactly the "needs ruling first" refusal. */
  ruleIds: string[];
  contractIds: string[];
  /** An owner decision id from decisions.json, when the ruling came from the board rather than a rule. */
  ownerDecision?: string;
  /** ISO date of graduation. */
  graduatedAt: string;
  /** `--pr` when supplied. */
  pr?: string;
}

export interface GraduationLedger {
  schemaVersion: 1;
  records: GraduationRecord[];
}

/** Merge a new record into the ledger: replace by scenarioId (a re-graduation refreshes), then sort. */
export function mergeGraduation(ledger: GraduationLedger, record: GraduationRecord): GraduationLedger {
  const records = ledger.records.filter((r) => r.scenarioId !== record.scenarioId);
  records.push(record);
  records.sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : 0));
  return { schemaVersion: 1, records };
}

export const emitGraduationLedger = (ledger: GraduationLedger): string =>
  `${JSON.stringify(ledger, null, 2)}\n`;

// ── Integrity (the retroMapErrors pattern — a stale registry fails loudly, never silently) ───────────────

/**
 * Cross-check the taxonomy and the graduation records.
 * @param laneExists   does this repo-relative lane path exist on disk? (injected — keeps this module pure)
 * @param scenarioExists does this curated regression scenario id exist on disk?
 */
export function bugTaxonomyErrors(
  records: readonly GraduationRecord[],
  laneExists: (path: string) => boolean,
  scenarioExists: (scenarioId: string) => boolean,
): string[] {
  const errors: string[] = [];
  const roster = new Set<string>([...PAIR_FAMILIES, ...TRIPLE_FAMILIES]);
  const seen = new Set<string>();
  for (const e of BUG_TAXONOMY) {
    if (seen.has(e.classId)) errors.push(`duplicate class id '${e.classId}' in BUG_TAXONOMY`);
    seen.add(e.classId);
    if (!e.why.trim()) errors.push(`class '${e.classId}' has no rationale`);
    if (e.families.length === 0 && e.lanes.length === 0) errors.push(`class '${e.classId}' cites nothing at all`);
    for (const f of e.families) if (!roster.has(f)) errors.push(`class '${e.classId}' names unknown family '${f}'`);
    for (const lane of e.lanes) if (!laneExists(lane)) errors.push(`class '${e.classId}' cites lane '${lane}' which is not on disk`);
    if (e.siblingCoverage === 'single-pin' && !e.siblingTodo?.trim()) {
      errors.push(`class '${e.classId}' is single-pin but states no outstanding sibling work — §4.3 forbids the silent gap`);
    }
  }
  const scenarios = new Set<string>();
  for (const r of records) {
    if (scenarios.has(r.scenarioId)) errors.push(`duplicate graduation record for scenario '${r.scenarioId}'`);
    scenarios.add(r.scenarioId);
    if (!seen.has(r.classId)) errors.push(`graduation '${r.scenarioId}' cites unknown class '${r.classId}'`);
    if (!scenarioExists(r.scenarioId)) errors.push(`graduation '${r.scenarioId}' has no curated regression fixture on disk`);
    if (r.ruleIds.length === 0 && r.contractIds.length === 0 && !r.ownerDecision) {
      errors.push(`graduation '${r.scenarioId}' records no approved rule, contract, or owner decision — it should never have been written`);
    }
  }
  return errors;
}
