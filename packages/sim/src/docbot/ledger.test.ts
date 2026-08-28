/**
 * DOC BOT 2.0 WP G — the findings ledger (§12.3), with its sabotage proofs.
 *
 * The three properties the fold must hold, each tested in BOTH directions (§4.5 — an oracle that cannot
 * fail is not an oracle):
 *  1. identity is the fingerprint, never prose — a reworded repeat folds to ONE entry (and a genuinely
 *     different fingerprint does NOT fold);
 *  2. the fold is deterministic and order-insensitive — the same batches in any order emit the same bytes;
 *  3. the ledger is derived — re-folding with no new batches is a no-op apart from `generatedAt`.
 */
import { describe, expect, it } from 'vitest';
import { makeFinding, type DocbotFinding } from './findings';
import { bucketOf, emitLedgerJson, foldLedger, parseLedger, summarizeFold, type LedgerBatch } from './ledger';

const finding = (over: Partial<Parameters<typeof makeFinding>[0]> = {}): DocbotFinding => makeFinding({
  lane: 'contracts',
  contentIds: ['kennel'],
  ruleIds: ['R-AVWIN-03'],
  expectationKind: 'event-count',
  expected: 3,
  observed: 2,
  severity: 'error',
  confidence: 'proven',
  title: 'kennel emits 2 summons, contract says 3',
  summary: 'the contract oracle disagreed with the trace',
  ...over,
});

const batch = (source: string, date: string, findings: DocbotFinding[]): LedgerBatch => ({ source, date, findings });

describe('findings ledger — fold identity', () => {
  it('folds two emissions of the same structural finding into ONE entry with occurrences 2', () => {
    const a = finding();
    // Same structure, DIFFERENT prose — §12.2 says prose is not identity.
    const b = finding({ title: 'Kennel summon count disagrees with its contract', summary: 'reworded entirely' });
    expect(a.fingerprint).toBe(b.fingerprint);

    const led = foldLedger({
      batches: [batch('contracts', '2026-08-25', [a]), batch('nightly', '2026-08-27', [b])],
      generatedAt: 'T',
    });
    expect(led.entries).toHaveLength(1);
    expect(led.entries[0]!.occurrences).toBe(2);
    expect(led.entries[0]!.firstSeen).toMatchObject({ date: '2026-08-25', source: 'contracts' });
    expect(led.entries[0]!.lastSeen).toMatchObject({ date: '2026-08-27', source: 'nightly' });
    // The latest prose wins; identity did not move.
    expect(led.entries[0]!.title).toBe('Kennel summon count disagrees with its contract');
  });

  it('SABOTAGE: a genuinely different mismatch does NOT fold — two entries, not one', () => {
    const a = finding();
    const b = finding({ observed: 1 }); // a different observed value = a different finding
    expect(a.fingerprint).not.toBe(b.fingerprint);
    const led = foldLedger({ batches: [batch('nightly', '2026-08-27', [a, b])], generatedAt: 'T' });
    expect(led.entries).toHaveLength(2);
    expect(led.entries.map((e) => e.occurrences)).toEqual([1, 1]);
  });

  it('counts one occurrence per BATCH even when a batch repeats a fingerprint', () => {
    const a = finding();
    const led = foldLedger({ batches: [batch('nightly', '2026-08-27', [a, { ...a }, { ...a }])], generatedAt: 'T' });
    expect(led.entries[0]!.occurrences).toBe(1);
  });
});

describe('findings ledger — determinism', () => {
  it('is order-insensitive: the same batches in any order emit identical bytes', () => {
    const b1 = batch('contracts', '2026-08-25', [finding(), finding({ observed: 1 })]);
    const b2 = batch('interactions', '2026-08-26', [finding({ lane: 'interactions', expected: 9 })]);
    const b3 = batch('nightly', '2026-08-27', [finding({ title: 'reworded' })]);

    const forward = emitLedgerJson(foldLedger({ batches: [b1, b2, b3], generatedAt: 'T' }));
    const reverse = emitLedgerJson(foldLedger({ batches: [b3, b2, b1], generatedAt: 'T' }));
    const shuffled = emitLedgerJson(foldLedger({ batches: [b2, b1, b3], generatedAt: 'T' }));
    expect(reverse).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it('growing an existing ledger equals folding both batches at once', () => {
    const b1 = batch('contracts', '2026-08-25', [finding()]);
    const b2 = batch('nightly', '2026-08-27', [finding({ observed: 1 })]);
    const staged = foldLedger({ previous: foldLedger({ batches: [b1], generatedAt: 'T' }), batches: [b2], generatedAt: 'T' });
    const atOnce = foldLedger({ batches: [b1, b2], generatedAt: 'T' });
    expect(emitLedgerJson(staged)).toBe(emitLedgerJson(atOnce));
  });

  it('re-folding with no new batches is a no-op (the ledger is derived, not accumulated)', () => {
    const first = foldLedger({ batches: [batch('nightly', '2026-08-27', [finding()])], generatedAt: 'T' });
    const again = foldLedger({ previous: first, batches: [], generatedAt: 'T' });
    expect(emitLedgerJson(again)).toBe(emitLedgerJson(first));
  });

  it('re-folding the SAME batch is also a no-op — `npm run docbot:ledger` is safe to re-run', () => {
    const b = batch('docbot-contracts', '2026-08-27', [finding()]);
    const first = foldLedger({ batches: [b], generatedAt: 'T' });
    const again = foldLedger({ previous: first, batches: [b], generatedAt: 'T' });
    expect(emitLedgerJson(again)).toBe(emitLedgerJson(first));
    expect(again.entries[0]!.occurrences, 'reading one artifact twice is one sighting').toBe(1);
    // …but a DIFFERENT run (new date, or a different lane the same day) still counts.
    const next = foldLedger({ previous: first, batches: [batch('docbot-contracts', '2026-08-28', [finding()])], generatedAt: 'T' });
    expect(next.entries[0]!.occurrences).toBe(2);
    const other = foldLedger({ previous: first, batches: [batch('docbot-nightly', '2026-08-27', [finding()])], generatedAt: 'T' });
    expect(other.entries[0]!.occurrences).toBe(2);
  });

  it('never mutates the ledger it was handed', () => {
    const first = foldLedger({ batches: [batch('nightly', '2026-08-27', [finding()])], generatedAt: 'T' });
    const before = emitLedgerJson(first);
    foldLedger({ previous: first, batches: [batch('contracts', '2026-08-28', [finding({ title: 'x' })])], generatedAt: 'T' });
    expect(emitLedgerJson(first)).toBe(before);
  });
});

describe('findings ledger — status history and links', () => {
  it('records a transition only when the status actually changes', () => {
    const newF = finding();
    const knownF = finding({ status: 'known' });
    const stillKnown = finding({ status: 'known', title: 'reworded again' });
    const led = foldLedger({
      batches: [
        batch('a', '2026-08-25', [newF]),
        batch('b', '2026-08-26', [knownF]),
        batch('c', '2026-08-27', [stillKnown]),
      ],
      generatedAt: 'T',
    });
    expect(led.entries[0]!.statusHistory.map((s) => s.status)).toEqual(['new', 'known']);
    expect(led.entries[0]!.occurrences).toBe(3);
  });

  it('links owner decisions, report ids and scenario ids as they accumulate', () => {
    const f = finding({
      scenarioId: 'avenge-window-exact-copy',
      provenance: { lane: 'contracts', reportId: 'r-1', scenarioIds: ['regression-abcd1234-multiplier-fold'] },
    });
    const led = foldLedger({
      batches: [batch('nightly', '2026-08-27', [f])],
      generatedAt: 'T',
      decidedRuleIds: new Set(['R-AVWIN-03']),
    });
    const e = led.entries[0]!;
    expect(e.linkedDecisionIds).toEqual(['R-AVWIN-03']);
    expect(e.linkedReportIds).toEqual(['r-1']);
    expect(e.linkedScenarioIds).toEqual(['avenge-window-exact-copy', 'regression-abcd1234-multiplier-fold']);
    // §15.1 bucketing is a VIEW: a curated regression outranks every other signal.
    expect(bucketOf(e)).toBe('regression-protected');
  });

  it('buckets by (status, links) without storing the bucket', () => {
    const fold = (f: DocbotFinding, decided?: string[]) => foldLedger({
      batches: [batch('n', '2026-08-27', [f])], generatedAt: 'T',
      ...(decided ? { decidedRuleIds: new Set(decided) } : {}),
    }).entries[0]!;
    expect(bucketOf(fold(finding()))).toBe('new');
    expect(bucketOf(fold(finding({ status: 'known' })))).toBe('acknowledged');
    expect(bucketOf(fold(finding(), ['R-AVWIN-03']))).toBe('ruled');
    expect(bucketOf(fold(finding({ status: 'excused' })))).toBe('ruled');
    expect(bucketOf(fold(finding({ status: 'resolved' })))).toBe('fixed');
  });
});

describe('findings ledger — parsing', () => {
  it('round-trips through emit/parse', () => {
    const led = foldLedger({ batches: [batch('nightly', '2026-08-27', [finding()])], generatedAt: 'T' });
    const { ledger, errors } = parseLedger(emitLedgerJson(led));
    expect(errors).toEqual([]);
    expect(ledger).toEqual(led);
  });

  it('refuses a wrong schema version LOUDLY rather than reading it as empty', () => {
    expect(parseLedger('{"schemaVersion":2,"entries":[]}').errors[0]).toMatch(/schemaVersion must be 1/);
    expect(parseLedger('not json').errors[0]).toMatch(/not valid JSON/);
    expect(parseLedger('{"schemaVersion":1}').errors[0]).toMatch(/entries must be an array/);
  });

  it('summarizeFold names exactly the new fingerprints', () => {
    const b1 = batch('a', '2026-08-25', [finding()]);
    const b2 = batch('b', '2026-08-26', [finding(), finding({ observed: 1 })]);
    const first = foldLedger({ batches: [b1], generatedAt: 'T' });
    const second = foldLedger({ previous: first, batches: [b2], generatedAt: 'T' });
    const s = summarizeFold(first, second, [b2]);
    expect(s.entriesBefore).toBe(1);
    expect(s.entriesAfter).toBe(2);
    expect(s.newFingerprints).toEqual([finding({ observed: 1 }).fingerprint]);
  });
});
