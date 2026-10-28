// @vitest-environment jsdom
/**
 * SUPABASE CLEANUP P1.2 (2026-10-28): progression config once per session, the cosmetic kill switch by hash.
 *
 *  - the four probes (epoch, crates, achievements, Aether) share ONE `progression_config` request per session (was
 *    four per auth event); a failed read is not kept, so the next probe asks again;
 *  - the catalog read asks only for switched-off items, and its parsed answer is identical to the full read's;
 *  - `refreshServerCatalog` skips the catalog read while `catalog_state_hash` equals the hash its cached answer was
 *    read under, reads when it moved, and always reads on a server without the hash.
 *
 * Bytes are measured as the JSON the fake server answers (the shape PostgREST sends), over the real code catalog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COSMETICS, COSMETIC_CATEGORY_DEFS, parseServerCatalogState } from '@game/progression';

type Row = Record<string, unknown>;
interface Read { table: string; columns: string; filter: string | null }
const reads: Read[] = [];
let bytes = 0;
let config: { data: Row[] | null; error: unknown } = { data: [{ epoch: '2026-09-27', crates_enabled: true, aether_enabled: true, achievements_epoch: '2026-09-28', catalog_state_hash: 'h1' }], error: null };
let retired = new Set<string>(['skin_a']);

const catalogRows = (): Row[] => COSMETICS.map((c) => ({ cosmetic_id: c.id, active: c.active, admin_off: retired.has(c.id) }));
const categoryRows = (): Row[] => Object.keys(COSMETIC_CATEGORY_DEFS).map((k) => ({ category: k, enabled: true, admin_off: false }));

const answer = (r: { data: Row[] | null; error: unknown }) => { bytes += JSON.stringify(r.data ?? null).length; return Promise.resolve(r); };
const fake = {
  from: (table: string) => ({
    select: (columns: string) => {
      const read: Read = { table, columns, filter: null };
      reads.push(read);
      const rows = (): Row[] => {
        const all = table === 'cosmetic_catalog' ? catalogRows() : table === 'cosmetic_categories' ? categoryRows() : [];
        if (read.filter === 'retired') return all.filter((r) => r.active === false || r.admin_off === true);
        if (read.filter === 'inactive') return all.filter((r) => r.active === false);
        return all;
      };
      const chain = {
        eq: (col: string, v: unknown) => { if (table === 'cosmetic_catalog' && col === 'active' && v === false) read.filter = 'inactive'; return chain; },
        or: (f: string) => { if (f === 'active.eq.false,admin_off.eq.true') read.filter = 'retired'; return chain; },
        order: () => chain,
        limit: () => (table === 'progression_config' ? answer(config) : answer({ data: rows(), error: null })),
        range: (from: number, to: number) => answer({ data: rows().slice(from, to + 1), error: null }),
      };
      return chain;
    },
  }),
};
vi.mock('../remoteBoards', () => ({ supabaseClient: () => fake, remoteEnabled: () => true }));
vi.mock('../identity', () => ({ currentUserId: () => null }));

const R = await import('./progressionRemote');
const S = await import('./progressionStore');

beforeEach(() => {
  reads.length = 0; bytes = 0; retired = new Set(['skin_a']);
  config = { data: [{ epoch: '2026-09-27', crates_enabled: true, aether_enabled: true, achievements_epoch: '2026-09-28', catalog_state_hash: 'h1' }], error: null };
  R.resetProgressionConfigForTests();
  S.resetProgressionForTests();
});
const configReads = () => reads.filter((r) => r.table === 'progression_config').length;
const catalogReads = () => reads.filter((r) => r.table === 'cosmetic_catalog').length;

describe('progression_config: one read per session', () => {
  it('the four probes, asked repeatedly, send ONE request (was four per probe)', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await R.fetchProgressionEnabled()).toBe(true);
      expect(await R.fetchCratesEnabled()).toBe(true);
      expect(await R.fetchAchievementsEnabled()).toBe(true);
      expect(await R.fetchAetherEnabled()).toBe(true);
    }
    expect(configReads()).toBe(1);
    expect(reads[0]).toEqual({ table: 'progression_config', columns: '*', filter: null });
  });

  it('a missing table is a definite off for every probe; a failed read is asked again', async () => {
    config = { data: null, error: { code: '42P01', message: 'no table' } };
    expect(await R.fetchProgressionEnabled()).toBe(false);
    expect(await R.fetchAetherEnabled()).toBe(false);
    expect(configReads()).toBe(1);
    R.resetProgressionConfigForTests();
    config = { data: null, error: { code: '57014', message: 'timeout' } };
    expect(await R.fetchProgressionEnabled()).toBeUndefined();
    await Promise.resolve();
    config = { data: [{ epoch: '2026-09-27' }], error: null };
    expect(await R.fetchProgressionEnabled()).toBe(true);
    expect(await R.fetchCratesEnabled()).toBe(false); // an older server: no crates column = off
    expect(configReads()).toBe(3); // the missing-table answer, the failed read, the retry
  });
});

describe('the kill-switch catalog', () => {
  it('reads only switched-off items, and parses to the same answer as the full list', async () => {
    const state = await R.fetchServerCatalogState();
    expect(state).toEqual(parseServerCatalogState(catalogRows(), categoryRows()));
    expect(reads.find((r) => r.table === 'cosmetic_catalog')?.filter).toBe('retired');
    const filteredBytes = bytes;
    bytes = 0;
    const full = JSON.stringify(catalogRows()).length + JSON.stringify(categoryRows()).length;
    console.info(`[P1.2 bytes] catalog read: full ${full} B -> filtered ${filteredBytes} B (${COSMETICS.length} items, ${state!.retiredIds.length} retired)`);
    expect(filteredBytes).toBeLessThan(full / 10);
  });

  it('skips the catalog read while catalog_state_hash is unchanged, reads when it moves', async () => {
    await S.refreshServerCatalog();
    expect(catalogReads()).toBe(1); // nothing cached yet
    expect(S.useProgression.getState().catalogEpoch).toBe(1);
    // A new session, same server state: the cached answer stands.
    R.resetProgressionConfigForTests(); reads.length = 0;
    await S.refreshServerCatalog();
    expect(configReads()).toBe(1);
    expect(catalogReads()).toBe(0);
    // The owner flips an item off: the hash moves and the client reads the new answer.
    R.resetProgressionConfigForTests(); reads.length = 0;
    retired = new Set(['skin_a', COSMETICS[0]!.id]);
    config = { data: [{ ...config.data![0], catalog_state_hash: 'h2' }], error: null };
    await S.refreshServerCatalog();
    expect(catalogReads()).toBe(1);
    expect(S.useProgression.getState().catalogEpoch).toBe(2);
  });

  it('a server without the hash reads the catalog every time, as before', async () => {
    config = { data: [{ epoch: '2026-09-27' }], error: null };
    await S.refreshServerCatalog();
    R.resetProgressionConfigForTests();
    await S.refreshServerCatalog();
    expect(catalogReads()).toBe(2);
  });

  it('a whole day of probes: config + catalog cost', async () => {
    // Before: every auth event sent 4 config reads + the full catalog + categories. After: one config read per
    // session and the catalog only when the hash moved (here: once, the first session on this device).
    const perEventBefore = 4 * JSON.stringify(config.data).length + JSON.stringify(catalogRows()).length + JSON.stringify(categoryRows()).length;
    bytes = 0;
    for (let session = 0; session < 3; session++) {
      R.resetProgressionConfigForTests();
      for (let probe = 0; probe < 5; probe++) {
        await S.refreshServerCatalog();
        await R.fetchProgressionEnabled(); await R.fetchCratesEnabled(); await R.fetchAchievementsEnabled(); await R.fetchAetherEnabled();
      }
    }
    console.info(`[P1.2 bytes] 3 sessions x 5 probes: before ${15 * perEventBefore} B, after ${bytes} B`);
    expect(configReads()).toBe(3);
    expect(catalogReads()).toBe(1);
  });
});
