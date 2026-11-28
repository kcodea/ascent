// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE PACK ECONOMY's network seam (2026-12-01) over a FAKE Supabase client: the `packs_enabled` switch rides the one
 * `progression_config` read (R-EGRESS-02); the four `progression-inventory` pack actions send exactly what the server
 * needs and nothing it decides; their answers (and their JSON refusals, 403 / 409 bodies) parse defensively, so a
 * malformed answer is never half-trusted.
 */
type Res = { data: unknown; error: unknown };
let tableImpl: (table: string) => Res;
let invokeImpl: (name: string, opts: { body: Record<string, unknown> }) => Promise<Res>;
const reads: Array<{ table: string; columns: string; eqs: Array<[string, unknown]> }> = [];
const invokes: Array<{ name: string; body: Record<string, unknown> }> = [];

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => { invokes.push({ name, body: opts.body }); return invokeImpl(name, opts); } },
    from: (table: string) => ({
      select: (columns: string) => {
        const read = { table, columns, eqs: [] as Array<[string, unknown]> };
        reads.push(read);
        const chain = {
          eq: (c: string, v: unknown) => { read.eqs.push([c, v]); return chain; },
          order: () => chain,
          limit: () => Promise.resolve(tableImpl(table)),
          range: () => Promise.resolve(tableImpl(table)),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock('../identity', () => ({ currentUserId: () => 'u-1' }));

const R = await import('./progressionRemote');

const look = { kind: 'rarity', id: 'rarity-rare', name: 'Rare Pack', guaranteedFloor: 'rare' };
const odds = { cards: { common: 35, rare: 31, epic: 22, legendary: 9, ancient: 3 }, last: { common: 0, rare: 47.7, epic: 33.8, legendary: 13.8, ancient: 4.6 } };
const shopJson = () => ({
  windowId: '2026-12-01T06',
  nextRefreshAt: 1764590400000,
  shelves: [{ id: 'featured', name: 'Daily Featured' }, { id: 'category', name: 'Themed Packs' }, { id: 'rarity', name: 'Rarity Packs' }],
  offers: [
    { offerId: '2026-12-01T06:free', look, price: 0, shelf: 'featured', contains: 1, badge: 'free', odds, newToYou: { unowned: 40, total: 120 } },
    { offerId: '2026-12-01T06:deal:0', look, price: 105, fullPrice: 175, stock: 0, soldOut: true, shelf: 'featured', contains: 1, odds, newToYou: { unowned: 40, total: 120 } },
    { offerId: '2026-12-01T06:category-emote', look: { kind: 'category', id: 'category-emote', name: 'Emote Pack', guaranteedFloor: 'common' }, price: 200, shelf: 'category', contains: 1, newToYou: { unowned: 3, total: 9 } },
  ],
  packs: [{ packId: 'p-1', look }],
  packMeter: { progress: 4, ready: 0 },
  aether: 3200,
});
/** A non-2xx answer as supabase-js reports it: the body is read from the response context. */
const httpError = (status: number, body: unknown): Res => ({ data: null, error: { context: { status, json: async () => body } } });

beforeEach(() => {
  reads.length = 0; invokes.length = 0;
  R.resetProgressionConfigForTests();
  tableImpl = () => ({ data: [], error: null });
  invokeImpl = async () => ({ data: null, error: new Error('unset') });
});

describe('fetchPacksEnabled', () => {
  it('reads packs_enabled from the ONE progression_config read every other switch shares (R-EGRESS-02)', async () => {
    tableImpl = () => ({ data: [{ epoch: 'e', crates_enabled: true, aether_enabled: true, achievements_epoch: 'a', packs_enabled: true }], error: null });
    for (let i = 0; i < 3; i++) {
      expect(await R.fetchPacksEnabled()).toBe(true);
      expect(await R.fetchProgressionEnabled()).toBe(true);
      expect(await R.fetchCratesEnabled()).toBe(true);
      expect(await R.fetchAetherEnabled()).toBe(true);
      expect(await R.fetchAchievementsEnabled()).toBe(true);
    }
    expect(reads).toEqual([{ table: 'progression_config', columns: '*', eqs: [['id', 1]] }]);
  });
  it('off: the switch is false, or an older server has no column', async () => {
    tableImpl = () => ({ data: [{ epoch: 'e', packs_enabled: false }], error: null });
    expect(await R.fetchPacksEnabled()).toBe(false);
    R.resetProgressionConfigForTests();
    tableImpl = () => ({ data: [{ epoch: 'e' }], error: null });
    expect(await R.fetchPacksEnabled()).toBe(false);
  });
  it('could not ask is undefined', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom', code: '57014' } });
    expect(await R.fetchPacksEnabled()).toBeUndefined();
  });
});

describe('fetchPackShop', () => {
  it('sends only the action and parses the shop: offers (sold-out deals, odds, counts), the hand in order, the meter, the balance', async () => {
    invokeImpl = async () => ({ data: shopJson(), error: null });
    const out = await R.fetchPackShop();
    expect(invokes).toEqual([{ name: 'progression-inventory', body: { action: 'pack_shop' } }]);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.shop.windowId).toBe('2026-12-01T06');
    expect(out.shop.nextRefreshAt).toBe(1764590400000);
    expect(out.shop.shelves.map((s) => s.name)).toEqual(['Daily Featured', 'Themed Packs', 'Rarity Packs']);
    expect(out.shop.offers.map((o) => o.offerId)).toEqual(['2026-12-01T06:free', '2026-12-01T06:deal:0', '2026-12-01T06:category-emote']);
    expect(out.shop.offers[0]).toMatchObject({ price: 0, badge: 'free', odds });
    expect(out.shop.offers[1]).toMatchObject({ price: 105, fullPrice: 175, stock: 0, soldOut: true });
    expect(out.shop.offers[2]!.odds).toBeUndefined();
    expect(out.shop.offers[2]!.newToYou).toEqual({ unowned: 3, total: 9 });
    expect(out.shop.packs).toEqual([{ packId: 'p-1', look: { ...look } }]);
    expect(out.shop.packMeter).toEqual({ progress: 4, ready: 0 });
    expect(out.shop.aether).toBe(3200);
  });
  it('the switch off (409 packs_disabled) is an error the shop shows as failed', async () => {
    invokeImpl = async () => httpError(409, { error: 'packs_disabled' });
    expect(await R.fetchPackShop()).toEqual({ status: 'error', reason: 'packs_disabled' });
  });
  it.each([
    ['a malformed offer', (j: ReturnType<typeof shopJson>) => { (j.offers[0] as Record<string, unknown>).price = -5; }],
    ['an unknown badge', (j: ReturnType<typeof shopJson>) => { (j.offers[0] as Record<string, unknown>).badge = 'hot'; }],
    ['a pack with no look', (j: ReturnType<typeof shopJson>) => { (j.packs[0] as Record<string, unknown>).look = null; }],
    ['no meter', (j: ReturnType<typeof shopJson>) => { (j as Record<string, unknown>).packMeter = null; }],
    ['a negative balance', (j: ReturnType<typeof shopJson>) => { j.aether = -1; }],
    ['odds missing a rarity', (j: ReturnType<typeof shopJson>) => { (j.offers[0] as Record<string, unknown>).odds = { cards: { common: 35 }, last: odds.last }; }],
  ])('%s is never half-trusted: server_outdated', async (_n, spoil) => {
    const j = shopJson(); spoil(j);
    invokeImpl = async () => ({ data: j, error: null });
    expect(await R.fetchPackShop()).toEqual({ status: 'error', reason: 'server_outdated' });
  });
});

describe('buyPackRemote', () => {
  const req = { offerId: '2026-12-01T06:rarity-rare', expectedPrice: 175, requestId: '00000000-0000-4000-8000-000000000001' };
  it('names the offer, the price it showed and the request id, nothing the server decides', async () => {
    invokeImpl = async () => ({ data: { status: 'ok', packs: [{ packId: 'p-2', look }], aether: 3025, meter: { progress: 5, ready: 0 } }, error: null });
    expect(await R.buyPackRemote(req)).toEqual({ status: 'ok', packs: [{ packId: 'p-2', look }], aether: 3025, meter: { progress: 5, ready: 0 } });
    expect(invokes[0]!.body).toEqual({ action: 'buy_pack', ...req });
  });
  it('a 409 refusal is read from its body: the reason, the balance, and the current offers of an expired one', async () => {
    invokeImpl = async () => httpError(409, { status: 'error', reason: 'no_room', aether: 3200 });
    expect(await R.buyPackRemote(req)).toEqual({ status: 'error', reason: 'no_room', aether: 3200 });
    invokeImpl = async () => httpError(409, { status: 'error', reason: 'expired', aether: 3200, offers: shopJson().offers });
    const exp = await R.buyPackRemote(req);
    expect(exp.status === 'error' && exp.reason).toBe('expired');
    expect(exp.status === 'error' && exp.offers?.map((o) => o.offerId)).toEqual(shopJson().offers.map((o) => o.offerId));
  });
  it('a guest is a 403 refusal', async () => {
    invokeImpl = async () => httpError(403, { status: 'error', reason: 'guest', aether: 3200 });
    expect(await R.buyPackRemote(req)).toEqual({ status: 'error', reason: 'guest', aether: 3200 });
  });
  it('a raised code, a timeout-shaped error or a bad answer is a plain error', async () => {
    invokeImpl = async () => httpError(409, { error: 'packs_disabled' });
    expect(await R.buyPackRemote(req)).toEqual({ status: 'error', reason: 'packs_disabled' });
    invokeImpl = async () => httpError(500, { error: 'inventory_failed' });
    expect(await R.buyPackRemote(req)).toEqual({ status: 'error', reason: 'inventory_failed' });
    invokeImpl = async () => ({ data: { status: 'ok', packs: [], aether: 1 }, error: null });
    expect(await R.buyPackRemote(req)).toEqual({ status: 'error', reason: 'server_outdated' });
  });
});

describe('openPackRemote', () => {
  const cards = [
    ...[0, 1, 2, 3].map((i) => ({ rewardId: `x${i}`, rarity: 'common', guaranteed: false, duplicate: i === 0 ? { aether: 20 } : null })),
    { rewardId: 'x4', rarity: 'rare', guaranteed: true, duplicate: null },
  ];
  it('names the pack only, and parses opened and already_opened as the opener result', async () => {
    invokeImpl = async () => ({ data: { status: 'opened', packId: 'p-1', pack: look, cards, aether: 3220 }, error: null });
    const out = await R.openPackRemote('p-1');
    expect(invokes[0]!.body).toEqual({ action: 'open_pack', packId: 'p-1' });
    expect(out.status === 'ok' && out.result.aether).toBe(3220);
    expect(out.status === 'ok' && out.alreadyOpened).toBe(false);
    invokeImpl = async () => ({ data: { status: 'already_opened', packId: 'p-1', pack: look, cards, aether: 3220 }, error: null });
    const again = await R.openPackRemote('p-1');
    expect(again.status === 'ok' && again.alreadyOpened).toBe(true);
  });
  it('pack_not_found (404), a guest and a malformed result are errors', async () => {
    invokeImpl = async () => httpError(404, { error: 'pack_not_found' });
    expect(await R.openPackRemote('p-9')).toEqual({ status: 'error', reason: 'pack_not_found' });
    invokeImpl = async () => httpError(403, { status: 'error', reason: 'guest', aether: 0 });
    expect(await R.openPackRemote('p-1')).toEqual({ status: 'error', reason: 'guest' });
    invokeImpl = async () => ({ data: { status: 'opened', packId: 'p-1', pack: look, cards: cards.slice(0, 4), aether: 1 }, error: null });
    expect(await R.openPackRemote('p-1')).toEqual({ status: 'error', reason: 'server_outdated' });
  });
});

describe('claimPackRewardRemote', () => {
  it('names the request id only; ok carries the pack and the meter; none is a refusal', async () => {
    const epic = { kind: 'rarity', id: 'rarity-epic', name: 'Epic Pack', guaranteedFloor: 'epic' };
    invokeImpl = async () => ({ data: { status: 'ok', packs: [{ packId: 'p-r', look: epic }], meter: { progress: 1, ready: 0 } }, error: null });
    expect(await R.claimPackRewardRemote('00000000-0000-4000-8000-000000000002')).toEqual({ status: 'ok', packs: [{ packId: 'p-r', look: epic }], meter: { progress: 1, ready: 0 } });
    expect(invokes[0]!.body).toEqual({ action: 'claim_pack_reward', requestId: '00000000-0000-4000-8000-000000000002' });
    invokeImpl = async () => httpError(409, { status: 'error', reason: 'none' });
    expect(await R.claimPackRewardRemote('00000000-0000-4000-8000-000000000003')).toEqual({ status: 'error', reason: 'none' });
  });
});

describe('fetchPackLaunchGiftReceived', () => {
  it('reads one ledger row of THIS account: the grant, keyed pack_launch', async () => {
    tableImpl = (t) => (t === 'aether_ledger' ? { data: [{ id: 7 }], error: null } : { data: [], error: null });
    expect(await R.fetchPackLaunchGiftReceived('u-1')).toBe(true);
    expect(reads.at(-1)).toEqual({ table: 'aether_ledger', columns: 'id', eqs: [['user_id', 'u-1'], ['reason', 'grant'], ['source_id', 'pack_launch']] });
    tableImpl = () => ({ data: [], error: null });
    expect(await R.fetchPackLaunchGiftReceived('u-1')).toBe(false);
    tableImpl = () => ({ data: null, error: { message: 'boom' } });
    expect(await R.fetchPackLaunchGiftReceived('u-1')).toBeUndefined();
  });
});
