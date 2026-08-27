/**
 * The Bug Board endpoints' whole validation/planning surface, unit-tested without a server (the
 * rulebookPlugin convention): `validateUpdate` / `planWorkOrderWrite` / `parseEnvFile` / `dupeCountsOf`
 * are pure, the middleware is a shell.
 */
import { describe, expect, it } from 'vitest';
import { dupeCountsOf, parseEnvFile, planWorkOrderWrite, validateUpdate } from './bugBoardPlugin';

const ID_A = '11111111-2222-3333-4444-555555555555';
const ID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ID_C = '99999999-8888-7777-6666-555555555555';

describe('parseEnvFile', () => {
  it('reads KEY=VALUE lines, quotes, export prefixes, and ignores comments/garbage', () => {
    const env = parseEnvFile([
      '# a comment',
      'SUPABASE_SERVICE_ROLE_KEY=sb_secret_abc123',
      'export QUOTED="with spaces"',
      "SINGLE='sq'",
      'not a pair',
      '=nokey',
      '  SPACED = padded ',
    ].join('\n'));
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_abc123');
    expect(env.QUOTED).toBe('with spaces');
    expect(env.SINGLE).toBe('sq');
    expect(env.SPACED).toBe('padded');
    expect(Object.keys(env)).toHaveLength(4);
  });
});

describe('validateUpdate', () => {
  it('accepts each field against its enum and returns the exact PATCH payload', () => {
    const plan = validateUpdate({ id: ID_A, status: 'triaged', severity: 'high', priority: 3 });
    expect(plan).toEqual({ id: ID_A, patch: { status: 'triaged', severity: 'high', priority: 3 } });
  });

  it('allows clearing severity/priority with null', () => {
    expect(validateUpdate({ id: ID_A, severity: null, priority: null }))
      .toEqual({ id: ID_A, patch: { severity: null, priority: null } });
  });

  it('rejects bad ids, out-of-enum values, non-integer priority, and empty updates', () => {
    expect(validateUpdate({ id: 'nope', status: 'new' })).toHaveProperty('error');
    expect(validateUpdate({ id: ID_A, status: 'wontfix' })).toHaveProperty('error');
    expect(validateUpdate({ id: ID_A, severity: 'urgent' })).toHaveProperty('error');
    expect(validateUpdate({ id: ID_A, priority: 1.5 })).toHaveProperty('error');
    expect(validateUpdate({ id: ID_A, priority: -1 })).toHaveProperty('error');
    expect(validateUpdate({ id: ID_A })).toHaveProperty('error');
    expect(validateUpdate([])).toHaveProperty('error');
    expect(validateUpdate(null)).toHaveProperty('error');
  });
});

describe('planWorkOrderWrite', () => {
  it('produces the fixed file contract + 1..N priority stamps in the given order', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const plan = planWorkOrderWrite({ orderedReportIds: [ID_B, ID_A, ID_C], notes: '  fix combat first  ' }, now);
    expect('file' in plan).toBe(true);
    const { file, updates } = plan as Exclude<typeof plan, { error: string }>;
    expect(file).toEqual({
      generatedAt: '2026-08-27T12:00:00.000Z',
      orderedReportIds: [ID_B, ID_A, ID_C],
      notes: 'fix combat first',
    });
    expect(updates).toEqual([
      { id: ID_B, priority: 1 },
      { id: ID_A, priority: 2 },
      { id: ID_C, priority: 3 },
    ]);
  });

  it('omits an empty notes field entirely (the file contract has no null notes)', () => {
    const plan = planWorkOrderWrite({ orderedReportIds: [ID_A], notes: '   ' });
    expect((plan as { file: object }).file).not.toHaveProperty('notes');
    expect(planWorkOrderWrite({ orderedReportIds: [ID_A] }) as object).not.toHaveProperty('error');
  });

  it('rejects empty/dupe/non-uuid orders and oversized notes', () => {
    expect(planWorkOrderWrite({ orderedReportIds: [] })).toHaveProperty('error');
    expect(planWorkOrderWrite({ orderedReportIds: [ID_A, ID_A] })).toHaveProperty('error');
    expect(planWorkOrderWrite({ orderedReportIds: ['x'] })).toHaveProperty('error');
    expect(planWorkOrderWrite({ orderedReportIds: [ID_A], notes: 'x'.repeat(4001) })).toHaveProperty('error');
    expect(planWorkOrderWrite({})).toHaveProperty('error');
    expect(planWorkOrderWrite([])).toHaveProperty('error');
  });
});

describe('dupeCountsOf', () => {
  it('counts rows per fingerprint, skipping null/empty', () => {
    expect(dupeCountsOf([
      { fingerprint: 'f1' }, { fingerprint: 'f1' }, { fingerprint: 'f2' },
      { fingerprint: null }, { fingerprint: '' }, {},
    ])).toEqual({ f1: 2, f2: 1 });
  });
});
