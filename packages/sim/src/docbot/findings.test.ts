/**
 * DOC BOT — STRUCTURED FINDINGS: fingerprint stability (handoff §12.2 + §3.5 sabotage, PR 8).
 *
 * The fingerprint is the dedup key the finding ledger will live on, so it must hold under exactly the
 * changes that DON'T alter a finding's identity (message prose, id-list order, emission order) and break
 * under exactly the ones that DO (lane, content, expectation kind, the normalized mismatch itself).
 *
 * SABOTAGE (§3.5): the prose-invariance test reworded a real finding's title/summary the way a copy-edit
 * pass would and asserted the fingerprint moved — it did not, for the intended reason (the fingerprint
 * hashes the structural identity only). Reintroducing the bug shape (hashing `title` into the identity)
 * flips the first test red immediately.
 */
import { describe, expect, it } from 'vitest';
import { emitFindingsJson, fingerprintFinding, makeFinding, type FindingDraft } from './findings';

const base: FindingDraft = {
  lane: 'nightly-lifecycle',
  severity: 'error',
  confidence: 'proven',
  title: 'Gold went negative on seed 61234',
  summary: 'embers is -2 after sell at step 41',
  contentIds: ['pillager', 'sandbag'],
  ruleIds: ['rule-economy-001'],
  expectationKind: 'invariant',
  expected: null,
  observed: { detail: 'embers is -2' },
};

describe('Doc Bot — finding fingerprints (§12.2)', () => {
  it('is STABLE under message-prose changes: reworded title/summary → same fingerprint, same id', () => {
    const a = makeFinding(base);
    const b = makeFinding({ ...base, title: 'NEGATIVE GOLD detected!!', summary: 'the Gold counter dipped below zero' });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.id).toBe(a.id);
  });

  it('is order-insensitive over content/rule id lists', () => {
    const a = fingerprintFinding(base);
    const b = fingerprintFinding({ ...base, contentIds: ['sandbag', 'pillager'] });
    expect(b).toBe(a);
  });

  it('CHANGES when the structural identity changes — lane, content, kind, or the normalized mismatch', () => {
    const a = fingerprintFinding(base);
    expect(fingerprintFinding({ ...base, lane: 'nightly-lobby' })).not.toBe(a);
    expect(fingerprintFinding({ ...base, contentIds: ['pillager'] })).not.toBe(a);
    expect(fingerprintFinding({ ...base, expectationKind: 'event-count' })).not.toBe(a);
    expect(fingerprintFinding({ ...base, observed: { detail: 'embers is -3' } })).not.toBe(a);
  });

  it('emitFindingsJson deduplicates by fingerprint and is byte-stable across emission order', () => {
    const a = makeFinding(base);
    const reworded = makeFinding({ ...base, title: 'same structural finding, new words' });
    const different = makeFinding({ ...base, expectationKind: 'explosion' });
    const j1 = emitFindingsJson([a, reworded, different]);
    const j2 = emitFindingsJson([different, a, reworded]);
    expect(JSON.parse(j1)).toHaveLength(2); // the reworded duplicate collapsed
    expect(j2).toBe(j1); // emission order never changes the artifact bytes
  });
});
