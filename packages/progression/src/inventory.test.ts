import { describe, expect, it, vi } from 'vitest';
import { COSMETICS, COSMETIC_CATEGORY_DEFS, parseOpenCrateResult, type CosmeticDef } from './cosmetics';
import { parseBuyCrateResult } from './crateShop';
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

// ── The Crate Shop (Aether, 2026-10-18) ─────────────────────────────────────────────────────────────────────

const REQ = '123e4567-e89b-42d3-a456-426614174000';
const buy = (over: Record<string, unknown> = {}) => ({ action: 'buy_crate', tier: 'epic', focus: ['card_plate'], expectedTotal: 800, requestId: REQ, ...over });
const crateItems = COSMETICS.filter((c) => c.acquisition.type === 'crate' && c.active && COSMETIC_CATEGORY_DEFS[c.category].enabled);
const itemOf = (rarity: CosmeticDef['rarity'], notCategory?: CosmeticDef['category']) => crateItems.find((c) => c.rarity === rarity && c.category !== notCategory)!;
const shopCrate = (reward: CosmeticDef, over: Record<string, unknown> = {}) => ({
  crateId: CRATE, earnedLevel: null, state: 'opened', rewardId: reward.id, earnedAt: 't0', openedAt: 't1', source: `shop:${REQ}`, ...over,
});
const shopOpened = (reward: CosmeticDef, crateOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  status: 'opened', rewardId: reward.id, sealedRemaining: 0, profile, aether: 100, crate: shopCrate(reward, crateOver),
  quote: { tier: 'epic', floor: 'epic', focus: null, crate: 400, fee: 0, total: 400, remaining: 9 }, ...over,
});

describe('validateInventoryBody: buy_crate', () => {
  it('accepts a tier, a focus, the price the client showed and a request id (lowercased)', () => {
    expect(validateInventoryBody(buy())).toEqual({ ok: true, request: { action: 'buy_crate', tier: 'epic', focus: ['card_plate'], expectedTotal: 800, requestId: REQ } });
    expect(validateInventoryBody(buy({ requestId: REQ.toUpperCase(), focus: null, expectedTotal: 0 })))
      .toEqual({ ok: true, request: { action: 'buy_crate', tier: 'epic', focus: null, expectedTotal: 0, requestId: REQ } });
  });
  it('refuses each bad field with its own definite 400', () => {
    expect(validateInventoryBody(buy({ tier: 'mythic' }))).toEqual({ ok: false, status: 400, error: 'bad_tier' });
    expect(validateInventoryBody(buy({ tier: undefined }))).toMatchObject({ ok: false, error: 'bad_tier' });
    expect(validateInventoryBody(buy({ focus: ['nope'] }))).toEqual({ ok: false, status: 400, error: 'bad_focus' });
    expect(validateInventoryBody(buy({ focus: [] }))).toMatchObject({ ok: false, error: 'bad_focus' });
    expect(validateInventoryBody(buy({ focus: ['title', 'title'] }))).toMatchObject({ ok: false, error: 'bad_focus' });
    expect(validateInventoryBody(buy({ focus: 'title' }))).toMatchObject({ ok: false, error: 'bad_focus' });
    expect(validateInventoryBody(buy({ focus: Array.from({ length: 11 }, () => 'title') }))).toMatchObject({ ok: false, error: 'bad_focus' });
    expect(validateInventoryBody(buy({ expectedTotal: -1 }))).toEqual({ ok: false, status: 400, error: 'bad_price' });
    expect(validateInventoryBody(buy({ expectedTotal: 1.5 }))).toMatchObject({ ok: false, error: 'bad_price' });
    expect(validateInventoryBody(buy({ expectedTotal: '800' }))).toMatchObject({ ok: false, error: 'bad_price' });
    expect(validateInventoryBody(buy({ expectedTotal: 1_000_001 }))).toMatchObject({ ok: false, error: 'bad_price' });
    expect(validateInventoryBody(buy({ requestId: 'x' }))).toEqual({ ok: false, status: 400, error: 'bad_request_id' });
  });
  it('an absent focus is no focus', () => {
    expect(validateInventoryBody(buy({ focus: undefined }))).toMatchObject({ ok: true, request: { focus: null } });
  });
});

describe('validateInventoryBody: open_crate with a focus (a milestone crate)', () => {
  it('a plain open stays exactly as before (no focus keys at all)', () => {
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE })).toEqual({ ok: true, request: { action: 'open_crate', crateId: CRATE } });
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE, focus: null })).toEqual({ ok: true, request: { action: 'open_crate', crateId: CRATE } });
  });
  it('a focus needs the fee the client showed', () => {
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE, focus: ['board'], expectedFee: 600 }))
      .toEqual({ ok: true, request: { action: 'open_crate', crateId: CRATE, focus: ['board'], expectedFee: 600 } });
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE, focus: ['board'] })).toMatchObject({ ok: false, error: 'bad_price' });
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE, focus: ['board'], expectedFee: -5 })).toMatchObject({ ok: false, error: 'bad_price' });
    expect(validateInventoryBody({ action: 'open_crate', crateId: CRATE, focus: ['nope'], expectedFee: 5 })).toMatchObject({ ok: false, error: 'bad_focus' });
  });
});

describe('handleInventory: the Crate Shop', () => {
  it('buy_crate: names only the tier, the focus, the shown price and the request id; passes the answer (with Aether and the quote) through', async () => {
    const reward = itemOf('epic');
    const rpc = rpcReturning(shopOpened(reward));
    const res = await handleInventory(USER, buy({ focus: null, expectedTotal: 400 }), rpc);
    expect(rpc).toHaveBeenCalledWith('buy_crate', { p_user: USER, p_tier: 'epic', p_focus: null, p_expected_total: 400, p_request_id: REQ });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'opened', rewardId: reward.id, aether: 100, parity: true, quote: { total: 400 } });
  });

  it('buy_crate: a replay of the same request id answers already_opened with a null quote', async () => {
    const reward = itemOf('epic');
    const res = await handleInventory(USER, buy({ focus: null, expectedTotal: 400 }), rpcReturning(shopOpened(reward, {}, { status: 'already_opened', quote: null })));
    expect(res).toMatchObject({ status: 200, body: { status: 'already_opened', quote: null, parity: true } });
  });

  it('buy_crate: 401 without a verified caller, never touching the database', async () => {
    const rpc = rpcReturning(null);
    expect(await handleInventory(null, buy(), rpc)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('buy_crate: a malformed answer (no profile, or not an open result) is a 500', async () => {
    expect(await handleInventory(USER, buy({ focus: null }), rpcReturning({ status: 'opened' }))).toEqual({ status: 500, body: { error: 'inventory_malformed' } });
    const noReward = { ...shopOpened(itemOf('epic')), rewardId: null };
    expect(await handleInventory(USER, buy({ focus: null }), rpcReturning(noReward))).toEqual({ status: 500, body: { error: 'inventory_malformed' } });
  });

  it('maps every client-facing shop refusal: 4xx permanent, 5xx retry', async () => {
    const codes: Record<string, number> = {
      bad_tier: 400, bad_focus: 400, bad_price: 400, bad_request_id: 400,
      price_changed: 409, insufficient_aether: 409, sold_out: 409, focus_not_allowed: 409, aether_disabled: 409,
      aether_config_missing: 503,
    };
    for (const [code, status] of Object.entries(codes)) {
      const res = await handleInventory(USER, buy(), rpcReturning(null, { message: code }));
      expect(res, code).toEqual({ status, body: { error: code } });
    }
    // Postgres wraps the raised text; the code is found inside it
    expect(await handleInventory(USER, buy(), rpcReturning(null, { message: 'P0001: sold_out' }))).toEqual({ status: 409, body: { error: 'sold_out' } });
  });

  it('open_crate: sends the focus and the shown fee only when a focus is named', async () => {
    const reward = itemOf('legendary');
    const plain = rpcReturning(shopOpened(reward));
    await handleInventory(USER, { action: 'open_crate', crateId: CRATE }, plain);
    expect(plain).toHaveBeenCalledWith('open_crate', { p_user: USER, p_crate_id: CRATE });
    const focused = rpcReturning(shopOpened(reward, { focus: [reward.category], floor: 'legendary' }));
    await handleInventory(USER, { action: 'open_crate', crateId: CRATE, focus: [reward.category], expectedFee: 150 }, focused);
    expect(focused).toHaveBeenCalledWith('open_crate', { p_user: USER, p_crate_id: CRATE, p_focus: [reward.category], p_expected_fee: 150 });
  });
});

describe('openParity: a floored / focused crate', () => {
  const common = itemOf('common');
  const ancient = itemOf('ancient');
  const result = (reward: CosmeticDef, crateOver: Record<string, unknown>) => parseOpenCrateResult(shopOpened(reward, crateOver))!;

  it('holds when the reward meets the floor and the focus', () => {
    expect(openParity(result(ancient, { floor: 'epic' }))).toBe(true);
    expect(openParity(result(ancient, { floor: 'ancient', focus: [ancient.category] }))).toBe(true);
  });
  it('fails when the reward is below the floor of the crate', () => {
    expect(openParity(result(common, { floor: 'rare' }))).toBe(false);
    expect(openParity(result(common, { floor: 'ancient' }))).toBe(false);
  });
  it('fails when the reward is outside the focus of the crate', () => {
    const other = itemOf('ancient', ancient.category);
    expect(openParity(result(ancient, { floor: 'ancient', focus: [other.category] }))).toBe(false);
  });
  it('an unfloored, unfocused crate is judged exactly as before', () => {
    expect(openParity(result(common, {}))).toBe(true);
  });
  it('a bought crate flows the same check through the handler: parity false is flagged, never refused', async () => {
    const log = vi.fn();
    const res = await handleInventory(USER, buy({ focus: null, expectedTotal: 400 }), rpcReturning(shopOpened(common, { floor: 'epic' })), log);
    expect(res).toMatchObject({ status: 200, body: { parity: false } });
    expect(log).toHaveBeenCalled();
  });
});

describe('parseBuyCrateResult', () => {
  const reward = itemOf('epic');
  it('reads an open result plus the balance and the quote', () => {
    expect(parseBuyCrateResult(shopOpened(reward))).toMatchObject({ status: 'opened', rewardId: reward.id, aether: 100, quote: { tier: 'epic', total: 400, remaining: 9, focus: null } });
  });
  it('accepts a null quote (a replay of the same request id)', () => {
    expect(parseBuyCrateResult(shopOpened(reward, {}, { status: 'already_opened', quote: null }))).toMatchObject({ status: 'already_opened', quote: null, aether: 100 });
  });
  it('is null when the balance or a present quote is malformed, or it is not an open result', () => {
    expect(parseBuyCrateResult(shopOpened(reward, {}, { aether: -1 }))).toBeNull();
    expect(parseBuyCrateResult(shopOpened(reward, {}, { aether: undefined }))).toBeNull();
    expect(parseBuyCrateResult(shopOpened(reward, {}, { quote: { tier: 'epic' } }))).toBeNull();
    expect(parseBuyCrateResult(shopOpened(reward, {}, { quote: { ...shopOpened(reward).quote, tier: 'mythic' } }))).toBeNull();
    expect(parseBuyCrateResult({ status: 'opened' })).toBeNull();
    expect(parseBuyCrateResult(null)).toBeNull();
  });
});

describe('parseOpenCrateResult keeps the Aether balance', () => {
  it('only when it is a non-negative integer', () => {
    const reward = itemOf('epic');
    expect(parseOpenCrateResult(shopOpened(reward))).toMatchObject({ aether: 100 });
    expect(parseOpenCrateResult(shopOpened(reward, {}, { aether: -3 }))).not.toHaveProperty('aether');
    expect(parseOpenCrateResult(shopOpened(reward, {}, { aether: 'lots' }))).not.toHaveProperty('aether');
    expect(parseOpenCrateResult(opened())).not.toHaveProperty('aether');
  });
});
