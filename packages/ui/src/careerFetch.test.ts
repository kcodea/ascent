/**
 * CAREER PAGE FETCH (owner rebuild 2026-09-19) — `fetchMyRuns` against a mocked Supabase client. Pins the
 * query shape the page depends on and the assembly of its three result sets:
 *  - `run_history` is read TWICE for the same user (a light JSON-path select for up to `limit` rows, a
 *    detailed `entry` select for the newest `CAREER_DETAIL_ROWS`), NEVER the Hall-of-Champions `runs` table;
 *  - `run_telemetry` is probed with JSON-path scalars only (id · seed · v2 stamp · first/last frame clocks) —
 *    the replay payload never crosses the wire on a list read;
 *  - the rows join by seed; a detailed row upgrades its light twin (board); the probe's clock-less fallback
 *    fires when the rich select errors;
 *  - null (not []) when there is no session for an own-career read or the light query fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Query { table: string; select?: string; eqs: [string, unknown][]; limit?: number }

const queries: Query[] = [];
let userId: string | null = 'me-1';
/** Rows per (table, select-flavour). Set per test. */
let respond: (q: Query) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Query = { table, eqs: [] };
      queries.push(q);
      const chain = {
        select: (sel: string) => { q.select = sel; return chain; },
        eq: (col: string, val: unknown) => { q.eqs.push([col, val]); return chain; },
        order: () => chain,
        limit: (n: number) => { q.limit = n; return Promise.resolve(respond(q)); },
      };
      return chain;
    },
  }),
}));

vi.mock('./identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: '', anonymous: true } : null),
  setIdentity: () => {},
}));

const load = async () => await import('./remoteBoards');

beforeEach(() => { queries.length = 0; userId = 'me-1'; respond = () => ({ data: [], error: null }); vi.resetModules(); });

/** The light select projects `x:entry->>x` scalars; the detailed one selects the `entry` column itself. */
const isLight = (q: Query): boolean => q.table === 'run_history' && !!q.select && q.select.includes('entry->>');
const isDetail = (q: Query): boolean => q.table === 'run_history' && !!q.select && /(^|, )entry$/.test(q.select);
const isProbe = (q: Query): boolean => q.table === 'run_telemetry';

const LIGHT = [
  { id: 12, created_at: '2026-09-19T05:39:50Z', hero_id: 'sable', wave: 15, wins: 9, placement: 1, mode: 'lobby', losses: '4', draws: '1', apt: '26.1', seed: '1465984878', gold_spent: '120', rating_delta: '41', at: '2026-09-19T05:39:48Z', dominant_tribe: 'beast' },
  { id: 11, created_at: '2026-09-19T05:24:42Z', hero_id: 'repete', wave: 11, wins: 5, placement: 3, mode: 'lobby', losses: '5', draws: '0', apt: '22', seed: '2068602420', gold_spent: '90', rating_delta: '9', at: '2026-09-19T05:24:40Z', dominant_tribe: 'mech' },
  { id: 10, created_at: '2026-09-18T01:00:00Z', hero_id: 'cia', wave: 8, wins: 2, placement: 7, mode: 'lobby', losses: '5', draws: '0', apt: '18', seed: '55', gold_spent: '40', rating_delta: '-30', at: '2026-09-18T00:59:00Z', dominant_tribe: null },
];
const DETAIL = [
  { id: 12, created_at: '2026-09-19T05:39:50Z', placement: 1, entry: { v: 1, at: '2026-09-19T05:39:48Z', seed: 1465984878, heroId: 'sable', wins: 9, losses: 4, draws: 1, wave: 15, placement: 1, goldSpent: 120, apt: 26.1, ratingDelta: 41, dominantTribe: 'beast', board: { minions: [{ cardId: 'alleycat', attack: 5, health: 5 }, { cardId: 'stray', attack: 2, health: 2 }], wave: 15, heroId: 'sable' } } },
  { id: 11, created_at: '2026-09-19T05:24:42Z', placement: 3, entry: { v: 1, at: '2026-09-19T05:24:40Z', seed: 2068602420, heroId: 'repete', wins: 5, losses: 5, draws: 0, wave: 11, placement: 3, goldSpent: 90, apt: 22, ratingDelta: 9, dominantTribe: 'mech', board: null } },
];
const PROBE = [
  { id: 97, created_at: '2026-09-19T05:39:50Z', placement: 1, seed: '1465984878', v2_version: '2', first_t: '0', last_t: '883179.2' },
  { id: 96, created_at: '2026-09-19T05:24:42Z', placement: 3, seed: '2068602420', v2_version: null, first_t: '0', last_t: '690108' }, // v1-only → no Watch, but a clock
];

describe('fetchMyRuns — the query shape', () => {
  it('reads run_history (light + detailed) and probes run_telemetry, all for the CURRENT user; never the `runs` table', async () => {
    respond = (q) => ({ data: isLight(q) ? LIGHT : isDetail(q) ? DETAIL : isProbe(q) ? PROBE : [], error: null });
    const runs = await (await load()).fetchMyRuns(100);
    expect(runs).not.toBeNull();
    const tables = queries.map((q) => q.table);
    expect(tables).not.toContain('runs');
    expect(queries.filter(isLight)).toHaveLength(1);
    expect(queries.filter(isDetail)).toHaveLength(1);
    expect(queries.filter(isProbe)).toHaveLength(1);
    for (const q of queries) expect(q.eqs).toContainEqual(['user_id', 'me-1']);
    // The light select projects the entry scalars server-side (never the whole jsonb).
    const light = queries.find(isLight)!;
    expect(light.select).toContain('apt:entry->>apt');
    expect(light.select).toContain('seed:entry->>seed');
    expect(light.select).not.toMatch(/(^|, )entry(,|$)/);
    expect(light.limit).toBe(100);
    // The detailed select is capped to the match-history rows.
    expect(queries.find(isDetail)!.limit).toBe((await load()).CAREER_DETAIL_ROWS);
    // The probe never selects the replay payload — only JSON-path scalars.
    const probe = queries.find(isProbe)!;
    expect(probe.select).toContain('replay->v2->>version');
    expect(probe.select).toContain('replay->v2->frames->-1->>tMs');
    expect(probe.select).not.toMatch(/replay->v2(,|$)/);
    expect(probe.select).not.toMatch(/(^|, )replay(,|$)/);
  });

  it('assembles the rows: boards from the detailed twin, replay id + length from the probe, "—"-able nulls elsewhere', async () => {
    respond = (q) => ({ data: isLight(q) ? LIGHT : isDetail(q) ? DETAIL : isProbe(q) ? PROBE : [], error: null });
    const runs = (await (await load()).fetchMyRuns(100))!;
    expect(runs.map((r) => r.id)).toEqual([12, 11, 10]);
    // Row 12: detailed (board), watchable (v2 + id), 883 s long.
    expect(runs[0]).toMatchObject({ heroId: 'sable', wins: 9, losses: 4, placement: 1, goldSpent: 120, apt: 26.1, ratingDelta: 41, detailed: true, replayRowId: 97, durationMs: 883179.2 });
    expect(runs[0]!.board?.minions).toHaveLength(2);
    // Row 11: detailed but no stored board (outcome-only banner); v1-only telemetry → no Watch, clock still read.
    expect(runs[1]).toMatchObject({ heroId: 'repete', detailed: true, board: null, replayRowId: null, durationMs: 690108, placement: 3 });
    // Row 10: light only (beyond the detail cap) and no telemetry row at all.
    expect(runs[2]).toMatchObject({ heroId: 'cia', detailed: false, board: null, replayRowId: null, durationMs: null, goldSpent: 40, placement: 7 });
  });

  it('retries the telemetry probe WITHOUT the frame clocks when the rich select errors (older PostgREST)', async () => {
    let probeCalls = 0;
    respond = (q) => {
      if (isProbe(q)) { probeCalls++; return q.select!.includes('frames->-1') ? { data: null, error: { message: 'bad path' } } : { data: [{ id: 97, seed: '1465984878', v2_version: '2', placement: 1 }], error: null }; }
      return { data: isLight(q) ? LIGHT : isDetail(q) ? DETAIL : [], error: null };
    };
    const runs = (await (await load()).fetchMyRuns(100))!;
    expect(probeCalls).toBe(2);
    expect(runs[0]).toMatchObject({ replayRowId: 97, durationMs: null }); // Watch still offered; length prints "—"
  });

  it('a foreign career reads by the id it was handed', async () => {
    respond = (q) => ({ data: isLight(q) ? LIGHT : [], error: null });
    await (await load()).fetchMyRuns(50, { userId: 'them-9' });
    for (const q of queries) expect(q.eqs).toContainEqual(['user_id', 'them-9']);
  });

  it('returns null (couldn\'t ask) with no session for an own-career read, and when the light query fails', async () => {
    userId = null;
    expect(await (await load()).fetchMyRuns(10)).toBeNull();
    expect(queries).toHaveLength(0);
    userId = 'me-1';
    respond = (q) => (isLight(q) ? { data: null, error: { message: 'boom' } } : { data: [], error: null });
    expect(await (await load()).fetchMyRuns(10)).toBeNull();
  });

  it('a failed detailed read or probe degrades to light rows (never a failed page)', async () => {
    respond = (q) => (isLight(q) ? { data: LIGHT, error: null } : { data: null, error: { message: 'nope' } });
    const runs = (await (await load()).fetchMyRuns(10))!;
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => !r.detailed && r.board === null && r.replayRowId === null)).toBe(true);
  });
});
