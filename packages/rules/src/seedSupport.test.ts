/**
 * Seed hygiene (§10.4) — the pure pass `npm run rules:seed` runs, unit-tested with fabricated boards,
 * including the sabotage case: a pending rule whose content vanished must retire WITH an audit record,
 * never silently disappear.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionMap, GameRule } from './schema';
import { applySeedHygiene } from './seedSupport';

const rule = (id: string, over: Partial<GameRule> = {}): GameRule => ({
  id, title: `title for ${id}`, statement: 's', domain: 'triggers', status: 'needs-ruling',
  evidence: [{ kind: 'docbot-scan', ref: 'lane' }], currentBehaviour: 'silent', ...over,
});
const base = {
  decisions: {} as DecisionMap,
  retiredIds: new Set<string>(),
  contentResolves: () => true,
  today: '2026-08-27',
};

describe('seed hygiene', () => {
  it('rejected questions leave the active set with an audit tombstone (§10.4)', () => {
    const decisions: DecisionMap = { 'q-a': { decision: 'reject', decidedAt: '2026-08-26T12:00:00.000Z' } };
    const out = applySeedHygiene({ ...base, fresh: [rule('q-a'), rule('q-b')], previous: [], decisions });
    expect(out.pending.map((r) => r.id)).toEqual(['q-b']);
    expect(out.newTombstones.map((t) => t.id)).toEqual(['q-a']);
    expect(out.newTombstones[0]!.why).toContain('REJECTED');
    expect(out.newTombstones[0]!.why).toContain('2026-08-26');
  });

  it('approve/revise decisions leave their questions on the board — decisions survive regeneration (§15)', () => {
    const decisions: DecisionMap = {
      'q-a': { decision: 'approve', decidedAt: '2026-08-26T12:00:00.000Z' },
      'q-b': { decision: 'revise', note: 'owner wording', decidedAt: '2026-08-26T12:00:00.000Z' },
    };
    const out = applySeedHygiene({ ...base, fresh: [rule('q-a'), rule('q-b')], previous: [], decisions });
    expect(out.pending.map((r) => r.id)).toEqual(['q-a', 'q-b']);
    expect(out.newTombstones).toEqual([]);
  });

  it('SABOTAGE: a previously-pending question whose content ids vanished retires WITH an audit record', () => {
    const prev = rule('q-ghost', { contentIds: ['vanished_card'] });
    const out = applySeedHygiene({
      ...base, fresh: [rule('q-b')], previous: [prev, rule('q-b')],
      contentResolves: (id) => id !== 'vanished_card',
    });
    expect(out.pending.map((r) => r.id)).toEqual(['q-b']);
    const tomb = out.newTombstones.find((t) => t.id === 'q-ghost');
    expect(tomb, 'the stale question must not silently disappear').toBeTruthy();
    expect(tomb!.why).toContain("'vanished_card'");
    expect(tomb!.why).toContain('no longer resolve');
    expect(tomb!.retiredAt).toBe('2026-08-27');
  });

  it('a drained question whose content still resolves is NOT auto-tombstoned (explicit hand retirement owns that path)', () => {
    const out = applySeedHygiene({ ...base, fresh: [], previous: [rule('q-verified', { contentIds: ['still_here'] })] });
    expect(out.newTombstones).toEqual([]);
  });

  it('a tombstoned id is never re-emitted as pending, and never double-tombstoned', () => {
    const out = applySeedHygiene({
      ...base, fresh: [rule('q-dead'), rule('q-live')], previous: [rule('q-dead', { contentIds: ['gone'] })],
      retiredIds: new Set(['q-dead']), contentResolves: () => false,
    });
    expect(out.pending.map((r) => r.id)).toEqual(['q-live']);
    expect(out.newTombstones).toEqual([]);
  });
});
