import { describe, expect, it } from 'vitest';
import { compareJobs, isZeroEffect, renderComparison, selfCompare } from './compare';
import { synthesizeJob, syntheticIdentity, syntheticManifest } from './deps';

const ROSTER = ['warden', 'drakko', 'nadja', 'gorr', 'midas', 'pete', 'harlan', 'fibbsy'];
const make = (count: number, tag: string, bias?: Record<string, number>, start = 1) => {
  const m = syntheticManifest('set3', { start, count }, { heroes: ROSTER, name: `cmp-${tag}` });
  return synthesizeJob(m, syntheticIdentity(m, tag), bias ? { heroBias: bias } : {});
};

describe('compareJobs', () => {
  it('A/A: a job compared with itself reports zero effect everywhere', () => {
    const x = make(20, 'aa');
    const c = selfCompare(x, { bootstrapReps: 200 });
    const check = isZeroEffect(c);
    expect(check.offenders).toEqual([]);
    expect(check.ok).toBe(true);
    expect(c.pairing).toEqual({ pairedSeeds: 20, baselineOnly: 0, candidateOnly: 0 });
    expect(c.identity.differing).toEqual([]);
    expect(c.identity.rulesChanged).toBe(false);
    expect(c.identity.policyChanged).toBe(false);
    const md = renderComparison(c, { baselineId: 'a', candidateId: 'a' });
    expect(md).toContain('## 1. Did the target move?');
    expect(md).toContain('## 7. What remains unsupported?');
    expect(md).toContain('A/A');
  });

  it('refuses undeclared identity differences, accepts declared ones', () => {
    const base = make(10, 'base');
    const cand = make(10, 'cand');
    expect(() => compareJobs(base, cand, { bootstrapReps: 50 })).toThrow(/not declared in allowDiff/);
    expect(() => compareJobs(base, cand, { bootstrapReps: 50, allowDiff: ['contentDigest'] })).toThrow(/manifestDigest/);
    const c = compareJobs(base, cand, { bootstrapReps: 50, allowDiff: ['contentDigest', 'manifestDigest'] });
    expect(c.identity.differing.sort()).toEqual(['contentDigest', 'manifestDigest']);
    expect(c.identity.rulesChanged).toBe(true);
  });

  it('positive control: nerfing one hero registers with a CI excluding zero, and only that hero', () => {
    const base = make(40, 'pc');
    const cand = make(40, 'pc-nerf', { midas: 1.5 }); // +1.5 latent weakness → worse placement
    const c = compareJobs(base, cand, { bootstrapReps: 500, allowDiff: ['contentDigest', 'manifestDigest'], target: { kind: 'hero', id: 'midas' } });
    expect(c.pairing.pairedSeeds).toBe(40);
    const midas = c.heroPlacement.find((h) => h.id === 'midas')!;
    expect(midas.diff.est).toBeGreaterThan(0.5);
    expect(midas.diff.lo).toBeGreaterThan(0);
    expect(midas.diff.paired).toBe(40);
    // The other seven absorb the displacement (self-play is zero-sum in placement) — each moves less than the target.
    for (const h of c.heroPlacement) if (h.id !== 'midas') expect(Math.abs(h.diff.est!)).toBeLessThan(midas.diff.est!);
    const md = renderComparison(c, { baselineId: 'base', candidateId: 'cand', target: { kind: 'hero', id: 'midas' } });
    expect(md).toContain('Target **Midas**');
    expect(md).toContain('**moved**');
    expect(md).toContain('Policy frozen, rules changed');
  });

  it('pairs by seed where seeds overlap and treats the rest as unpaired', () => {
    const base = make(12, 'p', undefined, 1);
    const cand = make(12, 'p', undefined, 7);
    const c = compareJobs(base, cand, { bootstrapReps: 50, allowDiff: ['manifestDigest'] });
    expect(c.pairing).toEqual({ pairedSeeds: 6, baselineOnly: 6, candidateOnly: 6 });
  });

  it('is deterministic', () => {
    const base = make(8, 'd'); const cand = make(8, 'd2', { warden: 1 });
    const opts = { bootstrapReps: 100, allowDiff: ['contentDigest', 'manifestDigest'] as const };
    expect(JSON.stringify(compareJobs(base, cand, opts))).toBe(JSON.stringify(compareJobs(base, cand, opts)));
  });
});
