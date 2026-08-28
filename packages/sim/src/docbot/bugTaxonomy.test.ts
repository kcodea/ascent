/**
 * DOC BOT 2.0 WP G — the bug taxonomy's integrity lane (the `retroMapErrors` pattern).
 *
 * A citation registry that can silently rot is worse than none: it reads as coverage while covering
 * nothing. So the same cross-checks retroInteractionMap carries apply here — every cited family is on the
 * roster, every cited lane exists on disk, every single-pin class states its outstanding sibling work, and
 * every graduation record points at a class that exists and a curated fixture that is actually on disk.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUG_CLASS_IDS, BUG_TAXONOMY, bugClass, bugTaxonomyErrors, mergeGraduation, type GraduationLedger, type GraduationRecord } from './bugTaxonomy';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // repo root
const REG_DIR = fileURLToPath(new URL('./scenarios/regressions/', import.meta.url));
const LEDGER = fileURLToPath(new URL('./bugTaxonomy.graduated.json', import.meta.url));

const laneExists = (p: string): boolean => existsSync(ROOT + p);
const scenarioExists = (id: string): boolean => existsSync(`${REG_DIR}${id}.json`);

const ledger: GraduationLedger = JSON.parse(readFileSync(LEDGER, 'utf8')) as GraduationLedger;

describe('bug taxonomy', () => {
  it('is internally consistent and every citation resolves on disk', () => {
    const errors = bugTaxonomyErrors(ledger.records, laneExists, scenarioExists);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('exposes a stable class roster with an honest default', () => {
    expect(BUG_CLASS_IDS).toContain('unclassified');
    expect(bugClass('unclassified')!.siblingCoverage).toBe('single-pin');
    expect(new Set(BUG_CLASS_IDS).size).toBe(BUG_TAXONOMY.length);
  });

  it('every curated regression on disk has a graduation record (curated space is never squatted)', () => {
    const onDisk = readdirSync(REG_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    const recorded = new Set(ledger.records.map((r) => r.scenarioId));
    const orphans = onDisk.filter((id) => !recorded.has(id));
    expect(orphans, `regression fixtures with no graduation record: ${orphans.join(', ')}`).toEqual([]);
  });

  describe('SABOTAGE — the validator must be able to fail', () => {
    const record = (over: Partial<GraduationRecord> = {}): GraduationRecord => ({
      scenarioId: 'regression-deadbeef-multiplier-fold',
      classId: 'multiplier-fold',
      reportId: 'deadbeef-0000-0000-0000-000000000000',
      ruleIds: ['R-X'],
      contractIds: [],
      graduatedAt: '2026-08-27',
      ...over,
    });

    it('catches a record citing an unknown class', () => {
      const errs = bugTaxonomyErrors([record({ classId: 'no-such-class' })], laneExists, () => true);
      expect(errs.some((e) => /unknown class 'no-such-class'/.test(e))).toBe(true);
    });

    it('catches a record whose curated fixture is missing from disk', () => {
      const errs = bugTaxonomyErrors([record()], laneExists, () => false);
      expect(errs.some((e) => /no curated regression fixture on disk/.test(e))).toBe(true);
    });

    it('catches a record that rests on no rule, contract, or owner decision', () => {
      const errs = bugTaxonomyErrors([record({ ruleIds: [], contractIds: [] })], laneExists, () => true);
      expect(errs.some((e) => /records no approved rule, contract, or owner decision/.test(e))).toBe(true);
    });

    it('catches a class citing a lane that is not on disk', () => {
      const errs = bugTaxonomyErrors([], () => false, () => true);
      expect(errs.some((e) => /is not on disk/.test(e))).toBe(true);
    });

    it('catches a duplicate graduation record', () => {
      const errs = bugTaxonomyErrors([record(), record()], laneExists, () => true);
      expect(errs.some((e) => /duplicate graduation record/.test(e))).toBe(true);
    });
  });

  it('mergeGraduation replaces by scenario id and keeps the ledger sorted', () => {
    const base: GraduationLedger = { schemaVersion: 1, records: [] };
    const a: GraduationRecord = { scenarioId: 'regression-bbbb-x', classId: 'unclassified', reportId: 'b', ruleIds: [], contractIds: [], ownerDecision: 'R-1', graduatedAt: '2026-08-27' };
    const b: GraduationRecord = { scenarioId: 'regression-aaaa-x', classId: 'unclassified', reportId: 'a', ruleIds: [], contractIds: [], ownerDecision: 'R-1', graduatedAt: '2026-08-27' };
    const once = mergeGraduation(mergeGraduation(base, a), b);
    expect(once.records.map((r) => r.scenarioId)).toEqual(['regression-aaaa-x', 'regression-bbbb-x']);
    const twice = mergeGraduation(once, { ...a, pr: '1277' });
    expect(twice.records).toHaveLength(2);
    expect(twice.records.find((r) => r.scenarioId === a.scenarioId)!.pr).toBe('1277');
  });
});
