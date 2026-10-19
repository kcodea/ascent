// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AETHER_ECONOMY } from '@game/progression';

/**
 * AETHER + THE CRATE SHOP (2026-10-18): the network seam over a FAKE Supabase client. Pins the three probes' answers,
 * the crate read's step-down for a server from before the Aether (and Gauntlet) migrations, and the exact bodies the
 * client sends: `buy_crate` names a tier, a focus, the total it showed and a request id and NOTHING the server decides;
 * a plain `open_crate` stays exactly as it was.
 */
type Res = { data: unknown; error: unknown };
let tableImpl: (table: string, columns: string) => Res;
let invokeImpl: (name: string, opts: { body: Record<string, unknown> }) => Promise<Res>;
const reads: Array<{ table: string; columns: string }> = [];
const invokes: Array<{ name: string; body: Record<string, unknown> }> = [];

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: (name: string, opts: { body: Record<string, unknown> }) => { invokes.push({ name, body: opts.body }); return invokeImpl(name, opts); } },
    from: (table: string) => ({
      select: (columns: string) => {
        reads.push({ table, columns });
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve(tableImpl(table, columns)),
          range: () => Promise.resolve(tableImpl(table, columns)),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock('../identity', () => ({ currentUserId: () => 'u-1' }));

const R = await import('./progressionRemote');

const profileJson = { accountXp: 300, accountLevel: 2, revision: 5, equippedTitleId: null, titles: [], aether: 0 };
const crateJson = { crateId: 'c-1', earnedLevel: null, source: 'shop:00000000-0000-4000-8000-000000000001', state: 'opened', rewardId: 'alpha_tester', earnedAt: null, openedAt: '2026-10-18T00:00:00Z' };

beforeEach(() => {
  reads.length = 0; invokes.length = 0;
  tableImpl = () => ({ data: [], error: null });
  invokeImpl = async () => ({ data: null, error: new Error('unset') });
});

describe('fetchAetherEnabled', () => {
  it('reads aether_enabled from the progression_config row', async () => {
    tableImpl = () => ({ data: [{ aether_enabled: true }], error: null });
    expect(await R.fetchAetherEnabled()).toBe(true);
    expect(reads).toEqual([{ table: 'progression_config', columns: 'aether_enabled' }]);
    tableImpl = () => ({ data: [{ aether_enabled: false }], error: null });
    expect(await R.fetchAetherEnabled()).toBe(false);
  });
  it.each(['42703', 'PGRST204', '42P01', 'PGRST205'])('a server from before the migration (%s) is off', async (code) => {
    tableImpl = () => ({ data: null, error: { message: 'no column', code } });
    expect(await R.fetchAetherEnabled()).toBe(false);
  });
  it('any other failure is "could not ask"', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom', code: '57014' } });
    expect(await R.fetchAetherEnabled()).toBeUndefined();
  });
});

describe('fetchAetherEconomy', () => {
  it('parses the economy document of row 1', async () => {
    tableImpl = () => ({ data: [{ economy: { ...DEFAULT_AETHER_ECONOMY, version: 3 } }], error: null });
    expect((await R.fetchAetherEconomy())?.version).toBe(3);
    expect(reads).toEqual([{ table: 'aether_config', columns: 'economy' }]);
  });
  it('a malformed document, no row, or an error is undefined (the caller keeps what it had)', async () => {
    tableImpl = () => ({ data: [{ economy: { version: 1 } }], error: null });
    expect(await R.fetchAetherEconomy()).toBeUndefined();
    tableImpl = () => ({ data: [], error: null });
    expect(await R.fetchAetherEconomy()).toBeUndefined();
    tableImpl = () => ({ data: null, error: { message: 'boom' } });
    expect(await R.fetchAetherEconomy()).toBeUndefined();
  });
});

describe('fetchOwnCrates column step-down', () => {
  const rows = [{ crate_id: 'c-1', earned_level: null, state: 'opened', reward_cosmetic_id: 'alpha_tester', earned_at: null, opened_at: null, source: 'shop:00000000-0000-4000-8000-000000000001', floor_rarity: 'rare', focus_categories: ['title'] }];
  it('asks for the Aether columns first and maps floor + focus', async () => {
    tableImpl = () => ({ data: rows, error: null });
    const list = await R.fetchOwnCrates();
    expect(reads).toHaveLength(1);
    expect(reads[0]!.columns).toContain('floor_rarity');
    expect(reads[0]!.columns).toContain('focus_categories');
    expect(list?.[0]).toMatchObject({ crateId: 'c-1', floor: 'rare', focus: ['title'], source: 'shop:00000000-0000-4000-8000-000000000001' });
  });
  it('a server without the Aether columns retries with `source` only, then with the base columns', async () => {
    const missing = { message: 'column does not exist', code: '42703' };
    tableImpl = (_t, columns) => (columns.includes('floor_rarity') || columns.includes('source') ? { data: null, error: missing } : { data: [rows[0]], error: null });
    const list = await R.fetchOwnCrates();
    expect(reads.map((r) => r.columns.includes('floor_rarity') ? 'full' : r.columns.includes('source') ? 'source' : 'base')).toEqual(['full', 'source', 'base']);
    expect(list).toHaveLength(1);
  });
  it('a server with `source` but not the Aether columns steps down once', async () => {
    tableImpl = (_t, columns) => (columns.includes('floor_rarity') ? { data: null, error: { message: 'x', code: 'PGRST204' } } : { data: [rows[0]], error: null });
    expect(await R.fetchOwnCrates()).toHaveLength(1);
    expect(reads).toHaveLength(2);
  });
  it('any other error is "could not ask" and does not step down', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom', code: '57014' } });
    expect(await R.fetchOwnCrates()).toBeUndefined();
    expect(reads).toHaveLength(1);
  });
});

// THE OWN PROFILE CARRIES THE BALANCE: the profile columns never include `aether`, so the own read adds it from the
// owner-read wallet table. Anything unreadable leaves the key OUT (the store keeps its balance) and never fails the read.
describe('fetchOwnProgression reads the wallet', () => {
  const profRow = { account_xp: 300, account_level: 2, progression_revision: 5, equipped_title_id: null };
  const serve = (wallet: Res): void => {
    tableImpl = (table) => (table === 'profiles' ? { data: [profRow], error: null } : table === 'aether_wallets' ? wallet : { data: [], error: null });
  };
  it('includes the wallet balance of THIS account', async () => {
    serve({ data: [{ balance: 340 }], error: null });
    expect(await R.fetchOwnProgression()).toMatchObject({ accountXp: 300, revision: 5, aether: 340 });
    expect(reads).toContainEqual({ table: 'aether_wallets', columns: 'balance' });
  });
  it('a missing wallet row reads as 0', async () => {
    serve({ data: [], error: null });
    expect((await R.fetchOwnProgression())?.aether).toBe(0);
  });
  it.each(['42P01', 'PGRST205', '57014', ''])('an unreadable wallet (%s) leaves the key absent and the profile still loads', async (code) => {
    serve({ data: null, error: { message: 'no table', code } });
    const p = await R.fetchOwnProgression();
    expect(p).toMatchObject({ accountXp: 300, revision: 5 });
    expect(p).not.toHaveProperty('aether');
  });
  it('a malformed balance leaves the key absent', async () => {
    serve({ data: [{ balance: -3 }], error: null });
    expect(await R.fetchOwnProgression()).not.toHaveProperty('aether');
  });
  it("another player's public profile never reads the wallet", async () => {
    serve({ data: [{ balance: 999 }], error: null });
    const p = await R.fetchPublicProgression('u-2');
    expect(p).toMatchObject({ accountXp: 300 });
    expect(p).not.toHaveProperty('aether');
    expect(reads.some((r) => r.table === 'aether_wallets')).toBe(false);
  });
});

describe('the inventory calls', () => {
  const opened = { status: 'opened', crate: crateJson, rewardId: 'alpha_tester', sealedRemaining: 0, aether: 0, profile: profileJson };
  it('buyCrateRemote sends the tier, focus, total and request id, and parses the quote + balance', async () => {
    invokeImpl = async () => ({ data: { ...opened, quote: { tier: 'rare', floor: 'rare', focus: null, crate: 200, fee: 0, total: 200, remaining: 3 } }, error: null });
    const out = await R.buyCrateRemote({ tier: 'rare', focus: null, expectedTotal: 200, requestId: 'req-1' });
    expect(invokes).toEqual([{ name: 'progression-inventory', body: { action: 'buy_crate', tier: 'rare', focus: null, expectedTotal: 200, requestId: 'req-1' } }]);
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.value).toMatchObject({ aether: 0, quote: { total: 200 } });
  });
  it('buyCrateRemote answers the server code, or server_outdated when the answer does not parse', async () => {
    invokeImpl = async () => ({ data: null, error: { context: { status: 409, json: async () => ({ error: 'price_changed' }) } } });
    expect(await R.buyCrateRemote({ tier: 'rare', focus: null, expectedTotal: 200, requestId: 'r' })).toEqual({ status: 'error', reason: 'price_changed' });
    invokeImpl = async () => ({ data: { ...opened, aether: undefined }, error: null });
    expect(await R.buyCrateRemote({ tier: 'rare', focus: null, expectedTotal: 200, requestId: 'r' })).toEqual({ status: 'error', reason: 'server_outdated' });
  });
  it('openCrateRemote: a plain open sends only the crate; a focused milestone open adds focus + expectedFee', async () => {
    invokeImpl = async () => ({ data: opened, error: null });
    await R.openCrateRemote('c-1');
    await R.openCrateRemote('c-2', ['title', 'hero_skin'], 120);
    expect(invokes.map((i) => i.body)).toEqual([
      { action: 'open_crate', crateId: 'c-1' },
      { action: 'open_crate', crateId: 'c-2', focus: ['title', 'hero_skin'], expectedFee: 120 },
    ]);
  });
});
