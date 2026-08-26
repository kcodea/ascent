/**
 * The Rulebook decision endpoint's whole validation surface, unit-tested without a server (the
 * beatLabPlugin convention): `planDecisionWrite` / `planDecisionClear` are pure, the middleware is a shell.
 */
import { describe, expect, it } from 'vitest';
import { planDecisionClear, planDecisionWrite } from './rulebookPlugin';

describe('rulebook decision plugin', () => {
  it('accepts a well-formed approve and stamps it', () => {
    const plan = planDecisionWrite({}, { id: 'q-mod-lawOfTeeth', decision: 'approve' });
    expect('next' in plan).toBe(true);
    const rec = (plan as { next: Record<string, { decision: string; decidedAt: string }> }).next['q-mod-lawOfTeeth']!;
    expect(rec.decision).toBe('approve');
    expect(rec.decidedAt).toBeTruthy();
  });

  it('a revise without wording is refused — the note IS the rule', () => {
    expect(planDecisionWrite({}, { id: 'q-rune2-rune_thrift', decision: 'revise' })).toHaveProperty('error');
    expect(planDecisionWrite({}, { id: 'q-rune2-rune_thrift', decision: 'revise', note: '  ' })).toHaveProperty('error');
    expect('next' in planDecisionWrite({}, { id: 'q-rune2-rune_thrift', decision: 'revise', note: 'stack to -4' })).toBe(true);
  });

  it('rejects bad ids, bad decisions, prototype pollution, and oversized notes', () => {
    expect(planDecisionWrite({}, { id: 'nope', decision: 'approve' })).toHaveProperty('error');
    expect(planDecisionWrite({}, { id: '__proto__', decision: 'approve' })).toHaveProperty('error');
    expect(planDecisionWrite({}, { id: 'q-x-y', decision: 'maybe' })).toHaveProperty('error');
    expect(planDecisionWrite({}, { id: 'q-x-y', decision: 'approve', note: 'x'.repeat(2001) })).toHaveProperty('error');
    expect(planDecisionWrite({}, [])).toHaveProperty('error');
  });

  it('preserves other decisions on write, and clear removes exactly one', () => {
    const base = { 'q-a-b': { decision: 'approve', decidedAt: 't' } };
    const plan = planDecisionWrite(base, { id: 'q-c-d', decision: 'reject' }) as { next: Record<string, unknown> };
    expect(Object.keys(plan.next).sort()).toEqual(['q-a-b', 'q-c-d']);
    const cleared = planDecisionClear(plan.next, 'q-a-b') as { next: Record<string, unknown> };
    expect(Object.keys(cleared.next)).toEqual(['q-c-d']);
    expect(planDecisionClear(plan.next, 'q-none-here')).toHaveProperty('error');
    expect(planDecisionClear(plan.next, '__proto__')).toHaveProperty('error');
  });
});
