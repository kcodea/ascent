/**
 * QA Workbench — the pure half (BugBoard's house pattern: logic in exported functions, the component a
 * thin shell). These are the decisions a reviewer relies on: which bucket a finding is in, what a filter
 * actually excludes, and whether the interaction table rolls up honestly.
 */
import { describe, expect, it } from 'vitest';
import type { QaScenarioResult } from '@game/sim';
import {
  EMPTY_FILTERS, bucketOfEntry, distinct, familyCoverage, filterInbox, printedTextOf, traceRowsOf,
  type LedgerEntryView,
} from './QaWorkbench';

const entry = (over: Partial<LedgerEntryView> = {}): LedgerEntryView => ({
  fingerprint: 'aaaa0001',
  id: 'contracts-aaaa0001',
  lane: 'contract-oracle',
  class: 'verified-mechanical-bug',
  severity: 'critical',
  confidence: 'proven',
  status: 'new',
  title: 'kennel summons 2, contract says 3',
  summary: 'the contract oracle disagreed with the trace',
  contentIds: ['kennel'],
  ruleIds: ['R-AVWIN-03'],
  firstSeen: { date: '2026-08-25', source: 'docbot-contracts' },
  lastSeen: { date: '2026-08-27', source: 'docbot-nightly' },
  occurrences: 3,
  linkedDecisionIds: [],
  linkedReportIds: [],
  linkedScenarioIds: [],
  ...over,
});

describe('bucketOfEntry (§15.1 status buckets)', () => {
  it('ranks a curated regression above every other signal', () => {
    expect(bucketOfEntry(entry({ linkedScenarioIds: ['regression-abcd-multiplier-fold'], status: 'new' })))
      .toBe('regression-protected');
  });
  it('separates new · acknowledged · ruled · fixed', () => {
    expect(bucketOfEntry(entry())).toBe('new');
    expect(bucketOfEntry(entry({ status: 'known' }))).toBe('acknowledged');
    expect(bucketOfEntry(entry({ linkedDecisionIds: ['R-AVWIN-03'] }))).toBe('ruled');
    expect(bucketOfEntry(entry({ status: 'excused' }))).toBe('ruled');
    expect(bucketOfEntry(entry({ status: 'resolved' }))).toBe('fixed');
  });
  it('a non-regression scenario link does NOT count as protection', () => {
    expect(bucketOfEntry(entry({ linkedScenarioIds: ['combat-generic-wave1'] }))).toBe('new');
  });
});

describe('filterInbox', () => {
  const rows = [
    entry(),
    entry({ fingerprint: 'bbbb0002', class: 'wording-recommendation', severity: 'info', lane: 'text-advisor', contentIds: ['emissary'], ruleIds: [] }),
    entry({ fingerprint: 'cccc0003', status: 'known', lane: 'interactions', lastSeen: { date: '2026-08-28', source: 'docbot-interactions' } }),
  ];

  it('passes everything through with empty filters, newest last-seen first', () => {
    expect(filterInbox(rows, EMPTY_FILTERS).map((r) => r.fingerprint)).toEqual(['cccc0003', 'aaaa0001', 'bbbb0002']);
  });

  it('filters by each field independently', () => {
    expect(filterInbox(rows, { ...EMPTY_FILTERS, cls: 'wording-recommendation' }).map((r) => r.fingerprint)).toEqual(['bbbb0002']);
    expect(filterInbox(rows, { ...EMPTY_FILTERS, severity: 'info' })).toHaveLength(1);
    expect(filterInbox(rows, { ...EMPTY_FILTERS, lane: 'interactions' })).toHaveLength(1);
    expect(filterInbox(rows, { ...EMPTY_FILTERS, bucket: 'acknowledged' }).map((r) => r.fingerprint)).toEqual(['cccc0003']);
  });

  it('the text query searches title, summary, content ids and rule ids', () => {
    expect(filterInbox(rows, { ...EMPTY_FILTERS, q: 'emissary' })).toHaveLength(1);
    expect(filterInbox(rows, { ...EMPTY_FILTERS, q: 'R-AVWIN-03' })).toHaveLength(2);
    expect(filterInbox(rows, { ...EMPTY_FILTERS, q: 'no such thing' })).toHaveLength(0);
  });

  it('is stable when two rows share a last-seen date (ties break by fingerprint)', () => {
    const same = [entry({ fingerprint: 'zzzz' }), entry({ fingerprint: 'aaaa' })];
    expect(filterInbox(same, EMPTY_FILTERS).map((r) => r.fingerprint)).toEqual(['aaaa', 'zzzz']);
  });

  it('distinct builds the dropdowns from the data, sorted and without blanks', () => {
    expect(distinct(rows, (e) => e.lane)).toEqual(['contract-oracle', 'interactions', 'text-advisor']);
    expect(distinct(rows, (e) => e.class ?? '')).toEqual(['verified-mechanical-bug', 'wording-recommendation']);
  });
});

describe('familyCoverage (§15.5)', () => {
  it('rolls runs up per family with per-verdict counts', () => {
    const table = familyCoverage([
      { family: 'death-x-echo', tier: 'pair', members: ['a', 'b'], verdict: 'covered' },
      { family: 'death-x-echo', tier: 'pair', members: ['a', 'c'], verdict: 'blocked' },
      { family: 'copy-x-counter', tier: 'pair', members: ['d', 'e'], verdict: 'covered' },
      { family: 'death-x-echo', tier: 'pair', members: ['a', 'd'], verdict: 'covered' },
    ]);
    expect(table.map((t) => t.family)).toEqual(['copy-x-counter', 'death-x-echo']);
    expect(table[1]).toEqual({ family: 'death-x-echo', verdicts: { covered: 2, blocked: 1 }, total: 3 });
  });
  it('is empty, not broken, with no runs', () => {
    expect(familyCoverage([])).toEqual([]);
  });
});

describe('printedTextOf (§15.2)', () => {
  it('finds a real card and returns its verbatim printed text', () => {
    const p = printedTextOf('pup');
    expect(p).not.toBeNull();
    expect(p!.name).toBeTruthy();
    expect(p!.kind).toMatch(/^card · /);
  });
  it('returns null for an id this checkout does not carry', () => {
    expect(printedTextOf('definitely-not-a-card')).toBeNull();
  });
});

describe('traceRowsOf (§15.4)', () => {
  it('pools recruit events then combat events, indexed continuously', () => {
    const result = {
      events: [{ type: 'cardSummoned' }],
      combatLog: [{ type: 'attack' }, { type: 'death' }],
    } as unknown as QaScenarioResult;
    expect(traceRowsOf(result).map((r) => [r.index, r.type])).toEqual([[0, 'cardSummoned'], [1, 'attack'], [2, 'death']]);
  });
  it('handles a scenario with no combat log', () => {
    expect(traceRowsOf({ events: [], combatLog: undefined } as unknown as QaScenarioResult)).toEqual([]);
  });
});
