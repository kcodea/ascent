/**
 * DOC BOT 2.0 WP G — THE FINDINGS LEDGER (blueprint §12.3 evidence packet, §15.1 inbox substrate).
 *
 * Every lane and sweep emits `findings.json` — a byte-stable ARRAY of `DocbotFinding`, deduplicated by
 * fingerprint WITHIN one emission. Nothing until now folded those emissions ACROSS time, so the two
 * questions the workbench inbox must answer — "is this new?" and "how long has this been standing?" —
 * had no substrate. This module is that fold: findings.json batches in, one ledger entry per fingerprint
 * out, carrying first/last seen (date + §16 semanticRevision), an occurrence count, the status transition
 * history, and the links a finding accumulates as it travels the learning loop (owner decisions, player
 * reports, curated regression scenarios).
 *
 * THREE PROPERTIES, all sabotage-tested in `ledger.test.ts`:
 *  1. **Identity is the fingerprint, never prose** (§12.2). Two emissions of the same structural finding
 *     fold to ONE entry with `occurrences: 2` — even when the title was reworded between them.
 *  2. **The fold is deterministic and order-insensitive.** Batches are sorted by (observedAt, source),
 *     findings within a batch by id, entries out by fingerprint. Feeding the same batches in any order
 *     produces byte-identical JSON. `generatedAt` is an explicit parameter, never `Date.now()` inside.
 *  3. **The ledger is DERIVED, never hand-edited** (§4.6 — generated ≠ curated). It lives in the
 *     gitignored `.local/docbot/`, is rebuildable from artifacts alone, and re-folding a previous ledger
 *     with zero new batches is a no-op apart from `generatedAt`.
 *
 * What the ledger is NOT: an oracle. It records what lanes said; it never decides whether they were right.
 */
import type { DocbotFinding, FindingClass, FindingConfidence, FindingSeverity, FindingStatus } from './findings';

export const LEDGER_SCHEMA_VERSION = 1 as const;

/** Where a finding was seen: the artifact/sweep that emitted it, plus the §16 identity of that run. */
export interface LedgerSighting {
  /** ISO date (YYYY-MM-DD) — day granularity is what "first seen / last seen" means to a human. */
  date: string;
  /** The emitting batch's label: 'nightly', 'contracts', 'interactions', 'text', a file path… */
  source: string;
  /** §16 semantic revision the emitting run was evaluated under, when it stamped one. */
  semanticRevision?: string;
}

/** One status transition. Appended ONLY when the status actually changed (a repeat is not a transition). */
export interface LedgerStatusChange {
  status: FindingStatus;
  date: string;
  source: string;
  semanticRevision?: string;
}

export interface LedgerEntry {
  /** The structural identity (§12.2). The ledger's primary key. */
  fingerprint: string;
  /** The derived finding id (`<lane>-<fingerprint>`) as first recorded. */
  id: string;
  lane: string;
  class?: FindingClass;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  /** The MOST RECENT status observed for this fingerprint. */
  status: FindingStatus;
  /** Most recent title/summary — prose moves freely; it is not identity. */
  title: string;
  summary: string;
  contentIds: string[];
  ruleIds: string[];
  contractIds?: string[];
  firstSeen: LedgerSighting;
  lastSeen: LedgerSighting;
  /** Number of BATCHES this fingerprint appeared in (never the raw duplicate count within one batch). */
  occurrences: number;
  /** Every status transition, oldest first. The first entry is the status at first sight. */
  statusHistory: LedgerStatusChange[];
  /** Rule ids with a recorded owner decision — the "has this been ruled?" column (§15.1 status buckets). */
  linkedDecisionIds: string[];
  /** Player report ids this finding was ever provenance-linked to (§14 graduation chain). */
  linkedReportIds: string[];
  /** Scenario ids that reproduce it — including the curated regression a graduation writes. */
  linkedScenarioIds: string[];
}

export interface LedgerFile {
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  generatedAt: string;
  /** Batch sources folded so far, sorted — so a rebuild can show what it read. */
  sources: string[];
  /** Every `<date>::<source>` already folded, sorted. Re-folding one is a NO-OP: an artifact directory read
   *  twice is one run seen once, not two sightings. (A genuine second run of the same lane on the same day
   *  therefore also counts once — the honest trade for making `docbot:ledger` safe to re-run.) */
  foldedBatches: string[];
  entryCount: number;
  entries: LedgerEntry[];
}

/** One findings.json emission plus the metadata the file itself cannot carry. */
export interface LedgerBatch {
  /** Label for the emitter ('nightly', 'contracts', 'interactions', 'text', or a path). */
  source: string;
  /** ISO date (YYYY-MM-DD) the emission was produced. */
  date: string;
  findings: readonly DocbotFinding[];
}

export interface FoldLedgerOptions {
  /** The ledger to grow. Absent = start empty. */
  previous?: LedgerFile | null;
  batches: readonly LedgerBatch[];
  /** Stamped into the output verbatim — the caller owns the clock, so the fold stays pure. */
  generatedAt: string;
  /** Rule ids that carry an owner decision (decisions.json). Used to fill `linkedDecisionIds`. */
  decidedRuleIds?: ReadonlySet<string>;
}

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** The empty ledger — what a first run folds into. */
export const emptyLedger = (generatedAt: string): LedgerFile => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  generatedAt,
  sources: [],
  foldedBatches: [],
  entryCount: 0,
  entries: [],
});

/**
 * Fold findings batches into a ledger. Pure: same inputs (in ANY batch order) ⇒ same output bytes.
 *
 * Occurrence semantics: one increment per (fingerprint, batch) — a batch that repeats a fingerprint
 * (findings.json already dedupes, but a merged directory read may not) counts once, so the number always
 * reads as "how many runs saw this".
 */
export function foldLedger(opts: FoldLedgerOptions): LedgerFile {
  const byFingerprint = new Map<string, LedgerEntry>();
  for (const e of opts.previous?.entries ?? []) {
    // Defensive copy — the fold never mutates the ledger it was handed.
    byFingerprint.set(e.fingerprint, {
      ...e,
      contentIds: [...e.contentIds],
      ruleIds: [...e.ruleIds],
      statusHistory: e.statusHistory.map((s) => ({ ...s })),
      linkedDecisionIds: [...e.linkedDecisionIds],
      linkedReportIds: [...e.linkedReportIds],
      linkedScenarioIds: [...e.linkedScenarioIds],
    });
  }

  // Deterministic fold order: (date, source) then id within the batch. Two batches with the same key are
  // ordered by their findings' ids anyway, so ties cannot make the output depend on argument order.
  const ordered = [...opts.batches].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );

  const sources = new Set(opts.previous?.sources ?? []);
  const folded = new Set(opts.previous?.foldedBatches ?? []);
  for (const batch of ordered) {
    const batchKey = `${batch.date}::${batch.source}`;
    if (folded.has(batchKey)) continue; // already counted — re-reading an artifact is not a new sighting
    folded.add(batchKey);
    sources.add(batch.source);
    const seenThisBatch = new Set<string>();
    const findings = [...batch.findings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const f of findings) {
      if (seenThisBatch.has(f.fingerprint)) continue; // property 1: one increment per batch
      seenThisBatch.add(f.fingerprint);

      const sighting: LedgerSighting = {
        date: batch.date,
        source: batch.source,
        ...(f.semanticRevision !== undefined ? { semanticRevision: f.semanticRevision } : {}),
      };
      const decided = uniqueSorted(f.ruleIds.filter((r) => opts.decidedRuleIds?.has(r) ?? false));
      const reportIds = f.provenance?.reportId ? [f.provenance.reportId] : [];
      const scenarioIds = uniqueSorted([
        ...(f.scenarioId ? [f.scenarioId] : []),
        ...(f.provenance?.scenarioIds ?? []),
      ]);

      const existing = byFingerprint.get(f.fingerprint);
      if (!existing) {
        byFingerprint.set(f.fingerprint, {
          fingerprint: f.fingerprint,
          id: f.id,
          lane: f.lane,
          ...(f.class !== undefined ? { class: f.class } : {}),
          severity: f.severity,
          confidence: f.confidence,
          status: f.status,
          title: f.title,
          summary: f.summary,
          contentIds: [...f.contentIds],
          ruleIds: [...f.ruleIds],
          ...(f.contractIds !== undefined ? { contractIds: [...f.contractIds] } : {}),
          firstSeen: sighting,
          lastSeen: sighting,
          occurrences: 1,
          statusHistory: [{ status: f.status, date: batch.date, source: batch.source,
            ...(f.semanticRevision !== undefined ? { semanticRevision: f.semanticRevision } : {}) }],
          linkedDecisionIds: decided,
          linkedReportIds: reportIds,
          linkedScenarioIds: scenarioIds,
        });
        continue;
      }

      // Prose and classification move with the latest sighting; identity never does.
      existing.title = f.title;
      existing.summary = f.summary;
      existing.severity = f.severity;
      existing.confidence = f.confidence;
      if (f.class !== undefined) existing.class = f.class;
      if (f.contractIds !== undefined) existing.contractIds = uniqueSorted([...(existing.contractIds ?? []), ...f.contractIds]);
      existing.contentIds = uniqueSorted([...existing.contentIds, ...f.contentIds]);
      existing.ruleIds = uniqueSorted([...existing.ruleIds, ...f.ruleIds]);
      existing.lastSeen = sighting;
      existing.occurrences += 1;
      if (existing.status !== f.status) {
        existing.status = f.status;
        existing.statusHistory.push({
          status: f.status, date: batch.date, source: batch.source,
          ...(f.semanticRevision !== undefined ? { semanticRevision: f.semanticRevision } : {}),
        });
      }
      existing.linkedDecisionIds = uniqueSorted([...existing.linkedDecisionIds, ...decided]);
      existing.linkedReportIds = uniqueSorted([...existing.linkedReportIds, ...reportIds]);
      existing.linkedScenarioIds = uniqueSorted([...existing.linkedScenarioIds, ...scenarioIds]);
    }
  }

  const entries = [...byFingerprint.values()].sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
  );
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    generatedAt: opts.generatedAt,
    sources: [...sources].sort(),
    foldedBatches: [...folded].sort(),
    entryCount: entries.length,
    entries,
  };
}

/** Byte-stable serialization (the fold already sorted everything). */
export const emitLedgerJson = (ledger: LedgerFile): string => `${JSON.stringify(ledger, null, 2)}\n`;

/** Parse a ledger from disk, rejecting anything that is not this schema — loudly, never silently empty. */
export function parseLedger(text: string): { ledger?: LedgerFile; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { errors: [`ledger is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof raw !== 'object' || raw === null) return { errors: ['ledger is not an object'] };
  const l = raw as Partial<LedgerFile>;
  if (l.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    return { errors: [`ledger schemaVersion must be ${LEDGER_SCHEMA_VERSION} (got ${String(l.schemaVersion)})`] };
  }
  if (!Array.isArray(l.entries)) return { errors: ['ledger.entries must be an array'] };
  // `foldedBatches` arrived after the first ledgers were written — an older file reads as "nothing folded
  // yet", which at worst re-counts one batch. Optional-extension rule, same as everywhere else.
  return { ledger: { ...l, foldedBatches: l.foldedBatches ?? [] } as LedgerFile, errors: [] };
}

// ── Reporting helpers (the CLI's summary + the workbench's status buckets) ───────────────────────────────

export interface LedgerFoldSummary {
  entriesBefore: number;
  entriesAfter: number;
  newFingerprints: string[];
  batchesFolded: number;
  findingsRead: number;
}

export function summarizeFold(before: LedgerFile | null, after: LedgerFile, batches: readonly LedgerBatch[]): LedgerFoldSummary {
  const known = new Set((before?.entries ?? []).map((e) => e.fingerprint));
  return {
    entriesBefore: before?.entries.length ?? 0,
    entriesAfter: after.entries.length,
    newFingerprints: after.entries.filter((e) => !known.has(e.fingerprint)).map((e) => e.fingerprint).sort(),
    batchesFolded: batches.length,
    findingsRead: batches.reduce((n, b) => n + b.findings.length, 0),
  };
}

/** §15.1 status buckets: new · acknowledged · ruled · fixed · regression-protected. Derived, never stored —
 *  the bucket is a VIEW over (status, links), so a graduation that writes a regression scenario moves the
 *  entry without anyone editing the ledger. */
export type LedgerBucket = 'new' | 'acknowledged' | 'ruled' | 'fixed' | 'regression-protected';

export function bucketOf(entry: LedgerEntry): LedgerBucket {
  if (entry.linkedScenarioIds.some((id) => id.startsWith('regression-'))) return 'regression-protected';
  if (entry.status === 'resolved') return 'fixed';
  if (entry.linkedDecisionIds.length > 0 || entry.status === 'excused') return 'ruled';
  if (entry.status === 'known') return 'acknowledged';
  return 'new';
}
