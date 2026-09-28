import { describe, expect, it, vi } from 'vitest';
import { handleSubmitProgression, validateSubmitBody, type RpcCall } from './server';

/**
 * The `submit-progression` Edge Function's logic with a MOCKED database (no live Supabase, no Deno): input
 * validation, the SQL error mapping (permanent vs retryable), the dedupe pass-through, and the runtime parity
 * flag that catches a rules edit that missed the SQL copy.
 */

const USER = '00000000-0000-0000-0000-000000000001';
const ranked = { mode: 'ranked', runId: 'run-1', rulesVersion: 1, comeback: false };

const okResult = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1', mode: 'ranked', rulesVersion: 1, placement: 3, comeback: false,
  xp: { base: 100, topFour: 40, firstPlace: 0, comeback: 0, total: 140 },
  before: { lifetimeXp: 200, level: 1 }, after: { lifetimeXp: 340, level: 2 },
  unlockedTitles: ['alpha_tester'], revisionAfter: 2, settledAt: '2026-09-27T12:00:00Z',
  ...over,
});
const okProfile = { accountXp: 340, accountLevel: 2, revision: 2, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'] };
const rpcReturning = (data: unknown, error: { message?: string } | null = null): RpcCall => vi.fn(async () => ({ data, error }));

describe('validateSubmitBody', () => {
  it('accepts the three modes', () => {
    expect(validateSubmitBody(ranked)).toMatchObject({ ok: true, request: { mode: 'ranked', runId: 'run-1', sourceId: null } });
    expect(validateSubmitBody({ mode: 'practice', runId: 'practice:7', sourceId: 7, rulesVersion: 1, comeback: true }))
      .toMatchObject({ ok: true, request: { mode: 'practice', sourceId: 7, comeback: true } });
    expect(validateSubmitBody({ mode: 'tutorial', runId: 'learn-ascent:v1', rulesVersion: 1, courseId: 'learn-ascent', courseVersion: 1 }))
      .toMatchObject({ ok: true, request: { mode: 'tutorial', comeback: false } });
  });
  it('refuses bad input with a definite 4xx', () => {
    expect(validateSubmitBody(null)).toMatchObject({ ok: false, status: 400, error: 'bad_json' });
    expect(validateSubmitBody({ ...ranked, mode: 'sandbox' })).toMatchObject({ ok: false, error: 'bad_mode' });
    expect(validateSubmitBody({ ...ranked, rulesVersion: 2 })).toMatchObject({ ok: false, status: 409, error: 'unsupported_rules' });
    expect(validateSubmitBody({ ...ranked, runId: '' })).toMatchObject({ ok: false, error: 'bad_run_id' });
    expect(validateSubmitBody({ ...ranked, runId: 'x'.repeat(129) })).toMatchObject({ ok: false, error: 'bad_run_id' });
    // practice: the run id must be the source row's
    expect(validateSubmitBody({ mode: 'practice', runId: 'practice:8', sourceId: 7, rulesVersion: 1 })).toMatchObject({ ok: false, error: 'bad_run_id' });
    expect(validateSubmitBody({ mode: 'practice', runId: 'practice:0', sourceId: 0, rulesVersion: 1 })).toMatchObject({ ok: false, error: 'bad_source' });
    // tutorial: only the current course version, only its own run id
    expect(validateSubmitBody({ mode: 'tutorial', runId: 'learn-ascent:v1', rulesVersion: 1, courseId: 'learn-ascent', courseVersion: 2 }))
      .toMatchObject({ ok: false, status: 409, error: 'unsupported_course' });
    expect(validateSubmitBody({ mode: 'tutorial', runId: 'learn-ascent:v9', rulesVersion: 1, courseId: 'learn-ascent', courseVersion: 1 }))
      .toMatchObject({ ok: false, error: 'bad_run_id' });
  });
  it('refuses malformed or mismatched facts, accepts none', () => {
    expect(validateSubmitBody({ ...ranked, facts: { version: 1 } })).toMatchObject({ ok: false, error: 'bad_facts' });
    const facts = { version: 1, runId: 'other', mode: 'ranked', setId: 'set2', patch: 'p', heroId: 'h', placement: 3, waveReached: 9, terminal: true, comebackAfterFourLosses: false, combats: { wins: 1, losses: 1, draws: 0 } };
    expect(validateSubmitBody({ ...ranked, facts })).toMatchObject({ ok: false, error: 'bad_facts' });
    expect(validateSubmitBody({ ...ranked, facts: { ...facts, runId: 'run-1' } })).toMatchObject({ ok: true });
  });
});

describe('handleSubmitProgression', () => {
  it('401 without a verified caller, and never calls the database', async () => {
    const rpc = rpcReturning(null);
    expect(await handleSubmitProgression(null, ranked, rpc)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls settle_progression with the SERVER-side args only (never an XP number)', async () => {
    const rpc = rpcReturning({ status: 'ok', result: okResult(), profile: okProfile });
    const res = await handleSubmitProgression(USER, { ...ranked, xp: 9999, placement: 1 }, rpc);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('settle_progression', {
      p_user: USER, p_mode: 'ranked', p_run_id: 'run-1', p_source_id: null, p_comeback: false, p_rules_version: 1, p_facts: null,
    });
    expect(res.body).toMatchObject({ status: 'confirmed', deduped: false, parity: true });
  });

  it('a duplicate is a success that carries the ORIGINAL result', async () => {
    const rpc = rpcReturning({ status: 'deduped', result: okResult(), profile: okProfile });
    const res = await handleSubmitProgression(USER, ranked, rpc);
    expect(res).toMatchObject({ status: 200, body: { deduped: true, result: okResult() } });
  });

  it('maps SQL refusals to permanent 4xx and a rate limit to 429', async () => {
    for (const [code, status] of [['source_not_found', 409], ['before_epoch', 409], ['progression_disabled', 409], ['rate_limited', 429], ['bad_source', 400]] as const) {
      const rpc = rpcReturning(null, { message: `P0001: ${code}` });
      expect(await handleSubmitProgression(USER, ranked, rpc), code).toEqual({ status, body: { error: code } });
    }
  });

  it('an unknown database failure is a retryable 500', async () => {
    expect(await handleSubmitProgression(USER, ranked, rpcReturning(null, { message: 'connection reset' }))).toEqual({ status: 500, body: { error: 'settle_failed' } });
    expect(await handleSubmitProgression(USER, ranked, vi.fn(async () => { throw new Error('boom'); }))).toEqual({ status: 500, body: { error: 'settle_failed' } });
    expect(await handleSubmitProgression(USER, ranked, rpcReturning({ status: 'ok', result: { nope: 1 }, profile: okProfile }))).toEqual({ status: 500, body: { error: 'settle_malformed' } });
  });

  it('flags parity:false when the SQL wrote numbers the TS rules disagree with', async () => {
    const log = vi.fn();
    const skewed = okResult({ xp: { base: 100, topFour: 50, firstPlace: 0, comeback: 0, total: 150 }, after: { lifetimeXp: 350, level: 2 } });
    const res = await handleSubmitProgression(USER, ranked, rpcReturning({ status: 'ok', result: skewed, profile: okProfile }), log);
    expect(res.body).toMatchObject({ status: 'confirmed', parity: false });
    expect(log).toHaveBeenCalled();
    // a level that does not match the XP, or a missing title reveal on the crossing, is also a mismatch
    const badLevel = okResult({ after: { lifetimeXp: 340, level: 3 } });
    expect((await handleSubmitProgression(USER, ranked, rpcReturning({ status: 'ok', result: badLevel, profile: okProfile }))).body.parity).toBe(false);
    const noTitle = okResult({ unlockedTitles: [] });
    expect((await handleSubmitProgression(USER, ranked, rpcReturning({ status: 'ok', result: noTitle, profile: okProfile }))).body.parity).toBe(false);
  });

  it('practice parity: the scaled numbers', async () => {
    const practice = { mode: 'practice', runId: 'practice:5', sourceId: 5, rulesVersion: 1, comeback: true };
    const result = okResult({
      runId: 'practice:5', mode: 'practice', placement: 1, comeback: true,
      xp: { base: 60, topFour: 24, firstPlace: 36, comeback: 15, total: 135 },
      before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 135, level: 1 }, unlockedTitles: [],
    });
    const res = await handleSubmitProgression(USER, practice, rpcReturning({ status: 'ok', result, profile: { ...okProfile, accountXp: 135, accountLevel: 1, titles: [], equippedTitleId: null } }));
    expect(res.body).toMatchObject({ parity: true });
  });
});
