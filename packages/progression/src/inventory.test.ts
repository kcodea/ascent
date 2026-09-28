import { describe, expect, it, vi } from 'vitest';
import { handleInventory, openParity, validateInventoryBody } from './inventory';
import type { RpcCall } from './server';

/**
 * The `progression-inventory` Edge Function's logic with a MOCKED database: validation, the two SQL calls with
 * server-side args only (a client never names a reward), error mapping, the pool_exhausted answer, and the runtime
 * parity flag for an opened item the TS catalog says a crate cannot give.
 */

const USER = '00000000-0000-0000-0000-000000000001';
const CRATE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const profile = { accountXp: 300, accountLevel: 2, revision: 5, equippedTitleId: 'alpha_tester', titles: ['alpha_tester', 'title_ironbeard'] };
const opened = (over: Record<string, unknown> = {}) => ({
  status: 'opened', rewardId: 'title_ironbeard', sealedRemaining: 1, profile,
  crate: { crateId: CRATE, earnedLevel: 2, state: 'opened', rewardId: 'title_ironbeard', earnedAt: 't0', openedAt: 't1' },
  ...over,
});
const rpcReturning = (data: unknown, error: { message?: string } | null = null): RpcCall => vi.fn(async () => ({ data, error }));

describe('validateInventoryBody', () => {
  it('accepts open_crate with a uuid, equip_title with an id or null', () => {
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE.toUpperCase() })).toEqual({ ok: true, request: { action: 'open_crate', crateId: CRATE } });
    expect(validateInventoryBody({ action: 'equip_title', titleId: 'title_ironbeard' })).toEqual({ ok: true, request: { action: 'equip_title', titleId: 'title_ironbeard' } });
    expect(validateInventoryBody({ action: 'equip_title', titleId: null })).toEqual({ ok: true, request: { action: 'equip_title', titleId: null } });
  });
  it('refuses anything else, and ignores a reward the client tries to name', () => {
    expect(validateInventoryBody(null)).toMatchObject({ ok: false, error: 'bad_json' });
    expect(validateInventoryBody({ action: 'grant', cosmeticId: 'title_the_unbroken' })).toMatchObject({ ok: false, error: 'bad_action' });
    expect(validateInventoryBody({ action: 'open_crate', crateId: 'not-a-uuid' })).toMatchObject({ ok: false, status: 400, error: 'bad_crate_id' });
    expect(validateInventoryBody({ action: 'equip_title', titleId: '' })).toMatchObject({ ok: false, error: 'bad_title_id' });
    expect(validateInventoryBody({ action: 'equip_title' })).toMatchObject({ ok: false, error: 'bad_title_id' });
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE, rewardId: 'title_the_unbroken' }))
      .toEqual({ ok: true, request: { action: 'open_crate', crateId: CRATE } });
  });
});

describe('handleInventory', () => {
  it('401 without a verified caller, never touching the database', async () => {
    const rpc = rpcReturning(null);
    expect(await handleInventory(null, { action: 'open_crate', crateId: CRATE }, rpc)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('open_crate: calls the SQL with the caller and the crate only, and passes the answer through with parity', async () => {
    const rpc = rpcReturning(opened());
    const res = await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, rpc);
    expect(rpc).toHaveBeenCalledWith('open_crate', { p_user: USER, p_crate_id: CRATE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'opened', rewardId: 'title_ironbeard', sealedRemaining: 1, parity: true });
  });

  it('already_opened and pool_exhausted are normal answers (200), not errors', async () => {
    const again = await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, rpcReturning(opened({ status: 'already_opened' })));
    expect(again).toMatchObject({ status: 200, body: { status: 'already_opened', parity: true } });
    const sealed = { crateId: CRATE, earnedLevel: 16, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null };
    const empty = await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, rpcReturning(opened({ status: 'pool_exhausted', rewardId: null, crate: sealed })));
    expect(empty).toMatchObject({ status: 200, body: { status: 'pool_exhausted', rewardId: null, parity: true } });
  });

  it('equip_title: the SQL checks ownership; not owned is a definite 409', async () => {
    const rpc = rpcReturning({ status: 'equipped', profile });
    expect(await handleInventory(USER, { action: 'equip_title', titleId: 'title_ironbeard' }, rpc)).toEqual({ status: 200, body: { status: 'equipped', profile } });
    expect(rpc).toHaveBeenCalledWith('equip_title', { p_user: USER, p_title_id: 'title_ironbeard' });
    expect(await handleInventory(USER, { action: 'equip_title', titleId: 'title_the_unbroken' }, rpcReturning(null, { message: 'not_owned' })))
      .toEqual({ status: 409, body: { error: 'not_owned' } });
  });

  it('maps SQL refusals; anything unexpected is a 500 the client may retry', async () => {
    const call = (err: string) => handleInventory(USER, { action: 'open_crate', crateId: CRATE }, rpcReturning(null, { message: err }));
    expect(await call('crate_not_found')).toEqual({ status: 404, body: { error: 'crate_not_found' } });
    expect(await call('crates_disabled')).toEqual({ status: 409, body: { error: 'crates_disabled' } });
    expect(await call('connection reset')).toEqual({ status: 500, body: { error: 'inventory_failed' } });
    expect(await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, vi.fn(async () => { throw new Error('boom'); }))).toEqual({ status: 500, body: { error: 'inventory_failed' } });
    expect(await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, rpcReturning({ status: 'opened' }))).toEqual({ status: 500, body: { error: 'inventory_malformed' } });
  });

  it('parity:false when the SQL gave an item no crate may give (a level milestone, an unknown or switched-off item)', async () => {
    const log = vi.fn();
    const bad = opened({ rewardId: 'alpha_tester', crate: { ...opened().crate, rewardId: 'alpha_tester' } });
    const res = await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, rpcReturning(bad), log);
    expect(res.body.parity).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(openParity({ status: 'opened', rewardId: 'mystery', sealedRemaining: 0, crate: { crateId: CRATE, earnedLevel: 1, state: 'opened', rewardId: 'mystery', earnedAt: null, openedAt: null } })).toBe(false);
  });
});
