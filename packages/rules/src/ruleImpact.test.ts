/**
 * ruleImpact (§10.5) — pure unit tests over a fabricated corpus, plus one live smoke over the real
 * registry (a change to a pinning test file must surface the rule it enforces).
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedRule } from './index';
import { ruleImpact } from './ruleImpact';

const rule = (id: string, over: Partial<ResolvedRule> = {}): ResolvedRule => ({
  id, title: `title for ${id}`, statement: 's', domain: 'triggers', status: 'approved',
  evidence: [{ kind: 'owner-handoff', ref: 'docs/handoff.md' }], effective: 'approved', ...over,
});

describe('ruleImpact (fabricated corpus)', () => {
  const corpus: ResolvedRule[] = [
    rule('R-A-01', {
      contentIds: ['gravebody'],
      enforcement: { kind: 'scenario', refs: ['packages/sim/src/a.test.ts'] },
    }),
    rule('R-B-01', {
      enforcement: { kind: 'oracle', refs: ['heroPowerLane'] }, // backing file: docbot/heroPowerLane.test.ts
    }),
    rule('R-C-01'), // approved, no enforcement — the standing debt
    rule('q-x', { status: 'needs-ruling', effective: 'needs-ruling' }), // undecided: never in the debt list
  ];

  it('touches rules via content id', () => {
    const r = ruleImpact({ paths: [], contentIds: ['gravebody'] }, corpus);
    expect(r.touchedRules.map((t) => t.id)).toEqual(['R-A-01']);
    expect(r.touchedRules[0]!.via).toEqual(['content-id']);
    expect(r.enforcementRefs).toEqual(['packages/sim/src/a.test.ts']);
  });

  it('touches rules via a changed enforcement ref (scenario path, separator-tolerant)', () => {
    const r = ruleImpact({ paths: ['packages\\sim\\src\\a.test.ts'] }, corpus);
    expect(r.touchedRules.map((t) => t.id)).toEqual(['R-A-01']);
    expect(r.touchedRules[0]!.via).toEqual(['enforcement-ref']);
  });

  it("touches rules via an oracle lane's backing file", () => {
    const r = ruleImpact({ paths: ['packages/sim/src/docbot/heroPowerLane.test.ts'] }, corpus);
    expect(r.touchedRules.map((t) => t.id)).toEqual(['R-B-01']);
    expect(r.enforcementRefs).toEqual(['packages/sim/src/docbot/heroPowerLane.test.ts']);
  });

  it('touches rules via a changed evidence ref', () => {
    const r = ruleImpact({ paths: ['docs/handoff.md'] }, corpus);
    expect(r.touchedRules.length).toBe(4); // every fabricated rule cites the same handoff
    expect(r.touchedRules[0]!.via).toContain('evidence-ref');
  });

  it('always reports the approved-but-unenforced debt (and never counts undecided questions in it)', () => {
    const r = ruleImpact({ paths: [] }, corpus);
    expect(r.touchedRules).toEqual([]);
    expect(r.unenforcedApproved.map((u) => u.id)).toEqual(['R-C-01']);
  });
});

describe('ruleImpact (live registry smoke)', () => {
  it('changing the copycat pin surfaces the exact-copy rule and its probe', () => {
    const r = ruleImpact({ paths: ['packages/sim/src/copycat.test.ts'] });
    expect(r.touchedRules.map((t) => t.id)).toContain('R-COPY-02');
    expect(r.enforcementRefs).toContain('packages/sim/src/copycat.test.ts');
  });
});
