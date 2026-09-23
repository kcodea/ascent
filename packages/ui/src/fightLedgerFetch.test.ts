// @vitest-environment jsdom
/**
 * THE FIGHT LEDGER SEAM (owner 2026-09-22) against a mocked Supabase client: the batched upsert of a lobby's
 * fights (unique on lobby_seed + round + run_a + run_b, duplicates ignored), the `run_fight_records` view reads
 * (the Hall's top-10 query shape, the seven-key strength read), and the strength fold. Pins that the client
 * reads the VIEW, never a row pool, that a dead view stamps nothing (never a guessed 50), and that bot keys
 * never hit the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Query { table: string; op: 'select' | 'upsert'; select?: string; filters: [string, string, unknown][]; orders: [string, unknown][]; limit?: number; rows?: unknown; opts?: unknown }

const queries: Query[] = [];
let userId: string | null = 'me-1';
let respond: (q: Query) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Query = { table, op: 'select', filters: [], orders: [] };
      queries.push(q);
      const chain = {
        select: (sel: string) => { q.select = sel; return chain; },
        upsert: (rows: unknown, opts: unknown) => { q.op = 'upsert'; q.rows = rows; q.opts = opts; return Promise.resolve(respond(q)); },
        in: (col: string, val: unknown) => { q.filters.push([col, 'in', val]); return chain; },
        eq: (col: string, val: unknown) => { q.filters.push([col, 'eq', val]); return chain; },
        gte: (col: string, val: unknown) => { q.filters.push([col, 'gte', val]); return chain; },
        not: (col: string, op: string, val: unknown) => { q.filters.push([col, `not.${op}`, val]); return chain; },
        order: (col: string, opts: unknown) => { q.orders.push([col, opts]); return chain; },
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

// Every case re-imports `remoteBoards` after `vi.resetModules()`, which re-evaluates the whole `@game/sim` graph
// behind it: cold, under a loaded CI box, that import alone can pass the 5 s default test timeout. A case that
// times out mid-import then finishes its call DURING the next case and pollutes `queries` (seen 2026-09-22:
// three overlapping runs failed the first case at 5.0 s and the offline-queue case right after it). The same
// allowance `balanceFetch.test.ts` carries; the mocked client answers synchronously, so no case is ever slow
// for a reason the test controls.
vi.setConfig({ testTimeout: 30000 });

beforeEach(() => { queries.length = 0; userId = 'me-1'; respond = () => ({ data: [], error: null }); vi.resetModules(); try { localStorage.clear(); } catch { /* jsdom-less */ } });

const VIEW_ROW = { run_key: 'Mike|warden|1', fights: 39, wins: 31, losses: 7, draws: 1, lobbies: 4, win_rate: 0.7948, wilson_lb: 0.64, last_fight_at: '2026-09-21T10:00:00Z' };

describe('recordLobbyFights — the batched upsert', () => {
  it('one upsert of every row, owner-stamped, unique on the pairing with duplicates ignored', async () => {
    const { recordLobbyFights } = await load();
    await recordLobbyFights([
      { lobbySeed: 31337, round: 1, runA: 'Mike|warden|1', runB: 'Me|drakko|31337', outcome: 'a', observed: true, patch: 'p' },
      { lobbySeed: 31337, round: 9, runA: 'Mike|warden|1', runB: 'bot:hybrid:gorr', outcome: 'draw', observed: false, patch: 'p' },
    ]);
    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    expect(q.table).toBe('lobby_fights');
    expect(q.op).toBe('upsert');
    expect(q.opts).toEqual({ onConflict: 'lobby_seed,round,run_a,run_b', ignoreDuplicates: true });
    expect(q.rows).toEqual([
      { user_id: 'me-1', lobby_seed: 31337, round: 1, run_a: 'Mike|warden|1', run_b: 'Me|drakko|31337', outcome: 'a', observed: true, patch: 'p' },
      { user_id: 'me-1', lobby_seed: 31337, round: 9, run_a: 'Mike|warden|1', run_b: 'bot:hybrid:gorr', outcome: 'draw', observed: false, patch: 'p' },
    ]);
  });

  it('with no session the rows queue for the flush instead of being lost; an empty list sends nothing', async () => {
    userId = null;
    const { recordLobbyFights } = await load();
    await recordLobbyFights([{ lobbySeed: 1, round: 1, runA: 'a|h|1', runB: 'b|h|2', outcome: 'b', observed: true, patch: 'p' }]);
    expect(queries).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('ascent.uploadqueue') ?? '[]')).toMatchObject([{ kind: 'fights' }]);
    userId = 'me-1';
    await recordLobbyFights([]);
    expect(queries).toHaveLength(0);
  });
});

describe('fetchHallRecords — the Hall reads the view', () => {
  it('top 10 by Wilson lower bound, at least 10 fights, never a bot key; the row is shaped, not re-aggregated', async () => {
    respond = (q) => ({ data: q.table === 'run_fight_records' ? [VIEW_ROW] : [], error: null });
    const { fetchHallRecords, HALL_MIN_FIGHTS, HALL_ROWS } = await load();
    const rows = await fetchHallRecords();
    expect(HALL_ROWS).toBe(10);
    expect(HALL_MIN_FIGHTS).toBe(10);
    const q = queries[0]!;
    expect(q.table).toBe('run_fight_records');
    expect(q.select).toBe('run_key, fights, wins, losses, draws, lobbies, win_rate, wilson_lb, last_fight_at');
    expect(q.filters).toEqual([['run_key', 'not.like', 'bot:%'], ['fights', 'gte', 10]]);
    expect(q.orders[0]).toEqual(['wilson_lb', { ascending: false }]);
    expect(q.limit).toBe(10);
    expect(queries.map((x) => x.table)).not.toContain('lobby_fights');
    expect(rows).toEqual([{ runKey: 'Mike|warden|1', fights: 39, wins: 31, losses: 7, draws: 1, lobbies: 4, winRate: 0.7948, wilsonLb: 0.64, lastFightAt: '2026-09-21T10:00:00Z' }]);
  });

  it('a missing view (pre-migration) is an empty Hall, not an error', async () => {
    respond = () => ({ data: null, error: { code: 'PGRST205', message: 'relation not found' } });
    const { fetchHallRecords } = await load();
    expect(await fetchHallRecords()).toEqual([]);
  });
});

describe('fetchLobbyStrength — the seven-key read', () => {
  it('ONE read of the real keys (bots never hit the network), folded through the formula: an unserved key reads the prior', async () => {
    respond = (q) => ({ data: q.table === 'run_fight_records' ? [VIEW_ROW] : [], error: null });
    const { fetchLobbyStrength } = await load();
    const keys = ['Mike|warden|1', 'bot:hybrid:gorr', 'Kev|sable|2', 'bot:hybrid:odelle', 'bot:hybrid:x', 'bot:hybrid:y', 'bot:hybrid:z'];
    const s = await fetchLobbyStrength(keys);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.table).toBe('run_fight_records');
    expect(queries[0]!.filters).toEqual([['run_key', 'in', ['Mike|warden|1', 'Kev|sable|2']]]);
    // (31+10)/(39+20) = 0.695, 0.5 for the unserved run, 0.25 × 5 bots → mean 0.349 → 35, Even.
    expect(s).toMatchObject({ value: 35, tier: 'Even' });
    expect(s!.inputs).toEqual([
      { key: 'Mike|warden|1', fights: 39, wins: 31 }, { key: 'bot:hybrid:gorr', fights: 0, wins: 0 }, { key: 'Kev|sable|2', fights: 0, wins: 0 },
      { key: 'bot:hybrid:odelle', fights: 0, wins: 0 }, { key: 'bot:hybrid:x', fights: 0, wins: 0 }, { key: 'bot:hybrid:y', fights: 0, wins: 0 }, { key: 'bot:hybrid:z', fights: 0, wins: 0 },
    ]);
  });

  it('a table of bots needs no network at all and reads 25 / Easy', async () => {
    const { fetchLobbyStrength } = await load();
    const s = await fetchLobbyStrength(Array.from({ length: 7 }, (_, i) => `bot:hybrid:h${i}`));
    expect(queries).toHaveLength(0);
    expect(s).toMatchObject({ value: 25, tier: 'Easy' });
  });

  it('a dead view stamps NOTHING (null), never a guessed 50', async () => {
    respond = () => ({ data: null, error: { message: 'relation not found' } });
    const { fetchLobbyStrength } = await load();
    expect(await fetchLobbyStrength(['Mike|warden|1', 'bot:hybrid:gorr'])).toBeNull();
    expect(await fetchLobbyStrength([])).toBeNull();
  });
});

describe('fetchHallHistory + fetchRunFinalBoards — the per-row facts', () => {
  it('history by seed reads EVERY placement (a candidate need not have won), filed by full run key with the rank held, the own record, the board', async () => {
    respond = (q) => ({
      data: q.table === 'run_history'
        ? [{ placement: 3, entry: { seed: 8, author: 'Kev', heroId: 'sable', wins: 9, losses: 5, draws: 0, at: '2026-09-18T14:00:00Z', rank: { before: { divisionIndex: 1, points: 40, demotionReady: false } }, board: { minions: [{ cardId: 'x' }], runes: ['r'] } } }]
        : [],
      error: null,
    });
    const { fetchHallHistory } = await load();
    const h = await fetchHallHistory([8, 9]);
    const q = queries[0]!;
    expect(q.table).toBe('run_history');
    expect(q.filters).toEqual([['mode', 'eq', 'lobby'], ['entry->>seed', 'in', ['8', '9']]]);
    expect(q.filters.some(([col]) => col === 'placement')).toBe(false);
    expect(h.get('Kev|sable|8')).toMatchObject({ seed: 8, author: 'Kev', heroId: 'sable', rank: { divisionIndex: 1, points: 40 }, record: { wins: 9, losses: 5, draws: 0 }, at: '2026-09-18T14:00:00Z', placement: 3 });
    expect(h.get('Kev|sable|8')!.board?.minions).toHaveLength(1);
    expect(h.size).toBe(1);
  });

  it('two players on the SAME shared seed with the same hero each keep their own row; an older row with no author files under the seed', async () => {
    respond = (q) => ({
      data: q.table === 'run_history'
        ? [
            { placement: 1, entry: { seed: 8, author: 'Kev', heroId: 'sable', wins: 12, losses: 3, draws: 0 } },
            { placement: 6, entry: { seed: 8, author: 'Mike', heroId: 'sable', wins: 4, losses: 6, draws: 0 } },
            { placement: 2, entry: { seed: 9, heroId: 'warden', wins: 10, losses: 2, draws: 0 } },
          ]
        : [],
      error: null,
    });
    const { fetchHallHistory } = await load();
    const h = await fetchHallHistory([8, 9]);
    expect([...h.keys()]).toEqual(['Kev|sable|8', 'Mike|sable|8', 'seed:9']);
    expect(h.get('Kev|sable|8')).toMatchObject({ author: 'Kev', placement: 1, record: { wins: 12, losses: 3, draws: 0 } });
    expect(h.get('Mike|sable|8')).toMatchObject({ author: 'Mike', placement: 6, record: { wins: 4, losses: 6, draws: 0 } });
    expect(h.get('seed:9')).toMatchObject({ author: null, heroId: 'warden', placement: 2 });
  });

  it('the own game is ONE batched read of the candidates\' lobbies from the ledger (never per row), filed by key from the run\'s side; a lobby with no rows is absent', async () => {
    respond = (q) => ({
      data: q.table === 'lobby_fights'
        ? [
            { lobby_seed: 8, run_a: 'Kev|sable|8', run_b: 'Mike|warden|1', outcome: 'a' },
            { lobby_seed: 8, run_a: 'Nadja|brackus|7', run_b: 'Kev|sable|8', outcome: 'a' },
            { lobby_seed: 8, run_a: 'Kev|sable|8', run_b: 'bot:hybrid:gorr', outcome: 'draw' },
            { lobby_seed: 8, run_a: 'Mike|warden|1', run_b: 'Nadja|brackus|7', outcome: 'b' },
            { lobby_seed: 9, run_a: 'Robin|gorr|9', run_b: 'Kev|sable|8', outcome: 'b' },
            { lobby_seed: 'junk', run_a: 'Robin|gorr|9', run_b: 'x', outcome: 'a' },
          ]
        : [],
      error: null,
    });
    const { fetchHallOwnGames } = await load();
    const own = await fetchHallOwnGames([{ key: 'Kev|sable|8', seed: 8 }, { key: 'Robin|gorr|9', seed: 9 }, { key: 'Old|warden|3', seed: 3 }]);
    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    expect(q.table).toBe('lobby_fights');
    expect(q.select).toBe('lobby_seed, run_a, run_b, outcome');
    expect(q.filters).toEqual([['lobby_seed', 'in', [8, 9, 3]]]);
    expect(own.get('Kev|sable|8')).toEqual({ wins: 1, losses: 1, draws: 1 });
    expect(own.get('Robin|gorr|9')).toEqual({ wins: 0, losses: 1, draws: 0 });
    expect(own.has('Old|warden|3')).toBe(false);
  });

  it('a dead ledger read is an empty own-game map (the Hall then reads the tally and says so), never an error', async () => {
    respond = () => ({ data: null, error: { message: 'relation not found' } });
    const { fetchHallOwnGames } = await load();
    expect(await fetchHallOwnGames([{ key: 'Kev|sable|8', seed: 8 }])).toEqual(new Map());
    expect(await fetchHallOwnGames([])).toEqual(new Map());
  });

  it('a pool board is the run\'s highest-wave snapshot by author + hero + seed (one row, the snapshot only)', async () => {
    respond = (q) => ({ data: q.table === 'boards' ? [{ snapshot: { minions: [{ cardId: 'x' }], wave: 14, heroId: 'sable' } }] : [], error: null });
    const { fetchRunFinalBoards } = await load();
    const b = await fetchRunFinalBoards([{ key: 'Kev|sable|8', author: 'Kev', heroId: 'sable', seed: 8 }]);
    const q = queries[0]!;
    expect(q.table).toBe('boards');
    expect(q.select).toBe('snapshot');
    expect(q.filters).toEqual([['author', 'eq', 'Kev'], ['hero_id', 'eq', 'sable'], ['seed', 'eq', 8]]);
    expect(q.orders).toEqual([['wave', { ascending: false }]]);
    expect(q.limit).toBe(1);
    expect(b.get('Kev|sable|8')?.minions).toHaveLength(1);
  });
});
