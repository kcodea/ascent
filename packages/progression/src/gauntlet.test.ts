import { describe, expect, it, vi } from 'vitest';
import { crateLabel, crateName, parseCrate } from './cosmetics';
import { GAUNTLET_ERROR_STATUS, GAUNTLET_STAGE_COUNT, handleGauntletClear, validateGauntletClearBody } from './gauntlet';
import type { RpcCall } from './server';

/**
 * The `gauntlet-clear` Edge Function's logic with a MOCKED database (2026-09-29): who may record a clear (a signed-in,
 * non-anonymous account), the stage check, the one SQL call with server-side args only, error mapping, and the crate
 * a first clear answers with. Plus the crate typing a Gauntlet crate needs (no level, a `gauntlet:<n>` source).
 */

const USER = '00000000-0000-0000-0000-000000000001';
const CRATE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const gauntletCrate = (stage = 3) => ({ crateId: CRATE, earnedLevel: null, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null, source: `gauntlet:${stage}` });
const rpcReturning = (data: unknown, error: { message?: string } | null = null): RpcCall => vi.fn(async () => ({ data, error }));

describe('validateGauntletClearBody', () => {
  it('accepts an integer stage 1..10 and nothing else', () => {
    expect(GAUNTLET_STAGE_COUNT).toBe(10);
    expect(validateGauntletClearBody({ stage: 1 })).toEqual({ ok: true, stage: 1 });
    expect(validateGauntletClearBody({ stage: 10 })).toEqual({ ok: true, stage: 10 });
    expect(validateGauntletClearBody(null)).toEqual({ ok: false, status: 400, error: 'bad_body' });
    expect(validateGauntletClearBody('stage=1')).toEqual({ ok: false, status: 400, error: 'bad_body' });
    for (const stage of [0, 11, 2.5, '3', null, undefined, Number.NaN]) {
      expect(validateGauntletClearBody({ stage }), String(stage)).toEqual({ ok: false, status: 400, error: 'bad_stage' });
    }
  });
});

describe('handleGauntletClear', () => {
  it('401 without a verified caller, 403 for an anonymous (guest) account; neither touches the database', async () => {
    const rpc = rpcReturning(null);
    expect(await handleGauntletClear(null, false, { stage: 1 }, rpc)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(await handleGauntletClear(USER, true, { stage: 1 }, rpc)).toEqual({ status: 403, body: { error: 'sign_in_required' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('400 on a bad body or stage, never touching the database', async () => {
    const rpc = rpcReturning(null);
    expect(await handleGauntletClear(USER, false, null, rpc)).toEqual({ status: 400, body: { error: 'bad_body' } });
    expect(await handleGauntletClear(USER, false, { stage: 11 }, rpc)).toEqual({ status: 400, body: { error: 'bad_stage' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a first clear: calls the SQL with the caller and the stage only, answers the crate', async () => {
    const rpc = rpcReturning({ status: 'first_clear', crate: gauntletCrate(3) });
    const res = await handleGauntletClear(USER, false, { stage: 3, crate: 'give me a legendary' }, rpc);
    expect(rpc).toHaveBeenCalledWith('record_gauntlet_clear', { p_user: USER, p_stage: 3 });
    expect(res).toEqual({ status: 200, body: { status: 'first_clear', crate: { crateId: CRATE, earnedLevel: null, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null, source: 'gauntlet:3' } } });
  });

  it('a replay: already_cleared with no crate is a normal answer', async () => {
    const res = await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning({ status: 'already_cleared', crate: null }));
    expect(res).toEqual({ status: 200, body: { status: 'already_cleared', crate: null } });
  });

  it('a malformed SQL answer is a 500', async () => {
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning(null))).toEqual({ status: 500, body: { error: 'gauntlet_malformed' } });
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning({ status: 'won' }))).toEqual({ status: 500, body: { error: 'gauntlet_malformed' } });
    // A first clear always carries its crate; one without (or with an unparseable one) is malformed.
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning({ status: 'first_clear', crate: null }))).toEqual({ status: 500, body: { error: 'gauntlet_malformed' } });
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning({ status: 'first_clear', crate: { crateId: CRATE } }))).toEqual({ status: 500, body: { error: 'gauntlet_malformed' } });
  });

  it('maps raised SQL codes to statuses; anything else is a retryable 500', async () => {
    expect(GAUNTLET_ERROR_STATUS).toMatchObject({ unauthenticated: 401, bad_stage: 400 });
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning(null, { message: 'P0001: bad_stage' }))).toEqual({ status: 400, body: { error: 'bad_stage' } });
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning(null, { message: 'unauthenticated' }))).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    const log = vi.fn();
    expect(await handleGauntletClear(USER, false, { stage: 2 }, rpcReturning(null, { message: 'connection reset' }), log)).toEqual({ status: 500, body: { error: 'gauntlet_failed' } });
    expect(log).toHaveBeenCalled();
    const throwing: RpcCall = vi.fn(async () => { throw new Error('boom'); });
    expect(await handleGauntletClear(USER, false, { stage: 2 }, throwing)).toEqual({ status: 500, body: { error: 'gauntlet_failed' } });
  });
});

describe('crate typing: level crates and Gauntlet crates', () => {
  it('a level crate parses exactly as before (no source key)', () => {
    const level = { crateId: 'c-1', earnedLevel: 4, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null };
    expect(parseCrate(level)).toEqual(level);
    expect(parseCrate({ ...level, source: null })).toEqual(level);
    expect(parseCrate({ ...level, earnedLevel: 0 })).toBeNull();
    expect(parseCrate({ ...level, earnedLevel: null })).toBeNull();
  });

  it('a Gauntlet crate has no level and a gauntlet:<n> source (camelCase or snake_case)', () => {
    expect(parseCrate(gauntletCrate(7))).toEqual({ ...gauntletCrate(7), earnedLevel: null });
    expect(parseCrate({ crate_id: CRATE, earned_level: null, state: 'opened', reward_cosmetic_id: 'title_ironbeard', earned_at: 't0', opened_at: 't1', source: 'gauntlet:1' }))
      .toEqual({ crateId: CRATE, earnedLevel: null, state: 'opened', rewardId: 'title_ironbeard', earnedAt: 't0', openedAt: 't1', source: 'gauntlet:1' });
    // No level needs a known source.
    expect(parseCrate({ ...gauntletCrate(), source: 'event:halloween' })).toBeNull();
    expect(parseCrate({ ...gauntletCrate(), source: undefined })).toBeNull();
  });

  it('names: level crates keep theirs; a Gauntlet crate names its stage', () => {
    expect(crateName(1)).toBe('Welcome Crate');
    expect(crateName(5)).toBe('Level 5 Crate');
    expect(crateLabel({ earnedLevel: 1 })).toBe('Welcome Crate');
    expect(crateLabel({ earnedLevel: 5, source: null })).toBe('Level 5 Crate');
    expect(crateLabel({ earnedLevel: null, source: 'gauntlet:4' })).toBe('Gauntlet Crate · Stage 4');
  });
});
