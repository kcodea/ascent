/**
 * THE BALANCE REPORT FETCH (2026-09-22) — `fetchRunTelemetry` + `fetchRunDerived` against a mocked Supabase
 * client. Pins the select ladder the report depends on: the NEWEST migration's columns (`set_id`, `source`) are
 * the FIRST thing dropped when a select errors, so a backend that has not run the 2026-09-22 migration answers
 * from the next rung instead of erroring on every rung and emptying the report; that next rung still reads the
 * stamps a new client writes INSIDE `derived` (as two scalars), so a run played on this build is stamped even
 * before the owner's migration; the flat fetch never carries a payload; and the payloads are fetched BY ID, in
 * chunks, only for the rows the report reads (review fix 2026-09-22: 16 MB of payloads used to land on the
 * title screen's frame even when the report rendered nothing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Query { table: string; select?: string; nots: [string, string, unknown][]; ins: [string, readonly unknown[]][]; limit?: number }

const queries: Query[] = [];
let respond: (q: Query) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Query = { table, nots: [], ins: [] };
      queries.push(q);
      // A thenable builder, like the real one: every filter returns the chain, and awaiting it runs the query.
      const chain = {
        select: (sel: string) => { q.select = sel; return chain; },
        not: (col: string, op: string, val: unknown) => { q.nots.push([col, op, val]); return chain; },
        in: (col: string, vals: readonly unknown[]) => { q.ins.push([col, vals]); return chain; },
        order: () => chain,
        limit: (n: number) => { q.limit = n; return chain; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(respond(q)).then(res, rej),
      };
      return chain;
    },
  }),
}));

vi.mock('./identity', () => ({
  currentUserId: () => 'me-1',
  currentIdentity: () => ({ userId: 'me-1', displayName: '', anonymous: true }),
  setIdentity: () => {},
}));

const load = async () => await import('./remoteBoards');

// The module graph behind remoteBoards (@game/sim, @game/content) is re-imported per test after `resetModules`;
// under a busy machine that alone can pass the 5 s default, so the box is wider (careerFetch pays the same).
vi.setConfig({ testTimeout: 30000 });

beforeEach(() => { queries.length = 0; respond = () => ({ data: [], error: null }); vi.resetModules(); });

const missingColumn = (col: string) => ({ data: null, error: { code: '42703', message: `column run_telemetry.${col} does not exist` } });

const FLAT = [
  { id: 12, created_at: '2026-09-22T10:00:00Z', patch: '0.1.0+bbb', author: 'Kev', content_revision: 'r2', set_id: 'set2', source: 'ladder', hero_id: 'warden', hero_offer: ['mode:lobby', 'warden', 'drakko'], won: false, wins: 3, offered_quests: [], picked_quests: [], quest_turns: {}, offered_runes: [], picked_runes: [], offered_cards: ['alley'], bought_cards: ['alley'], discover_offered_cards: [], discover_bought_cards: [], tier_by_wave: [0, 1, 2], buy_events: [{ id: 'alley', wave: 1, src: 'shop' }], placement: 2 },
  { id: 11, created_at: '2026-09-21T10:00:00Z', patch: '0.1.0+aaa', author: 'Mike', content_revision: 'r1', set_id: null, source: null, hero_id: 'drakko', hero_offer: ['mode:lobby', 'drakko'], won: true, wins: 9, offered_quests: [], picked_quests: [], quest_turns: {}, offered_runes: [], picked_runes: [], offered_cards: [], bought_cards: [], discover_offered_cards: [], discover_bought_cards: [], tier_by_wave: [0, 1], buy_events: [], placement: 1 },
];
/** The same two rows as a backend WITHOUT the 2026-09-22 columns returns them from the rung below: no `set_id` /
 *  `source`, but the stamps the new client wrote inside `derived`, read back as two scalars. Row 11 predates the
 *  client and carries neither. */
const FLAT_RUNG2 = FLAT.map(({ set_id: _s, source: _o, ...rest }) => ({ ...rest, derived_set: rest.id === 12 ? 'set2' : null, derived_source: rest.id === 12 ? 'ladder' : null }));
const DERIVED = [
  { id: 12, derived: { contentRevision: 'r2', heroId: 'warden', mode: 'lobby', seed: 5, finalWave: 2, wins: 3, won: false, diverged: false, offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [], playerActions: 1 } },
  { id: 99, derived: { notAPayload: true } }, // a malformed payload is dropped, never joined
];

describe('fetchRunTelemetry — the select ladder', () => {
  it('reads the stamps and the row metadata from the top rung when the backend has every column, and never a payload', async () => {
    respond = () => ({ data: FLAT, error: null });
    const rows = await (await load()).fetchRunTelemetry(1000);
    expect(queries, 'ONE flat query; the payloads are a separate, id-keyed fetch').toHaveLength(1);
    expect(queries[0]!.select).toContain('set_id, source');
    expect(queries[0]!.select, 'the stamps inside derived ride as two scalars, never the payload').toContain('derived_set:derived->>setId');
    expect(queries[0]!.select).not.toMatch(/(^|, )derived(,|$)/);
    expect(queries[0]!.limit).toBe(1000);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 12, createdAt: '2026-09-22T10:00:00Z', patch: '0.1.0+bbb', author: 'Kev', contentRevision: 'r2', setId: 'set2', source: 'ladder', mode: 'lobby', heroId: 'warden', placement: 2, derived: null });
    expect(rows[0]!.heroOffer, 'the mode tag is stripped back out of the offer').toEqual(['warden', 'drakko']);
    expect(rows[1]!.setId, 'a null stamp reads as absent, so the legacy rule applies').toBeUndefined();
    expect(rows[1]!.source).toBeUndefined();
  });

  it('a backend WITHOUT the 2026-09-22 columns errors the first rung and answers from the second, where a stamp written inside derived still reads', async () => {
    respond = (q) => (q.select!.includes('set_id') ? missingColumn('set_id') : { data: FLAT_RUNG2, error: null });
    const rows = await (await load()).fetchRunTelemetry(500);
    expect(queries).toHaveLength(2);
    expect(queries[0]!.select).toContain('set_id');
    expect(queries[1]!.select).not.toContain('set_id');
    expect(queries[1]!.select, 'the rung below keeps everything older').toContain('content_revision');
    expect(queries[1]!.select).toContain('derived_source:derived->>source');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.setId, 'the payload stamp counts as a stamp: a run played on this build is not legacy').toBe('set2');
    expect(rows[0]!.source).toBe('ladder');
    expect(rows[1]!.setId, 'a row with neither reads as legacy').toBeUndefined();
    expect(rows[1]!.source).toBeUndefined();
  });

  it('walks the whole ladder down to the original columns, dropping one migration per rung', async () => {
    respond = (q) => {
      const sel = q.select!;
      for (const col of ['set_id', 'content_revision', 'placement', 'buy_events', 'discover_offered_cards']) if (sel.includes(col)) return missingColumn(col);
      return { data: FLAT.map((r) => ({ id: r.id, created_at: r.created_at, patch: r.patch, author: r.author, hero_id: r.hero_id, hero_offer: r.hero_offer, won: r.won, wins: r.wins, offered_cards: r.offered_cards, bought_cards: r.bought_cards, tier_by_wave: r.tier_by_wave })), error: null };
    };
    const mod = await load();
    const rows = await mod.fetchRunTelemetry(500);
    expect(queries).toHaveLength(mod.BALANCE_SELECTS.length);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 12, heroId: 'warden', mode: 'lobby', offeredCards: ['alley'], placement: undefined, derived: null });
    expect(rows[0]!.buyEvents).toBeUndefined();
    expect(rows[0]!.setId).toBeUndefined();
  });

  it('the ladder drops the newest migration first: set_id and source go before anything older, and the derived stamps travel with content_revision', async () => {
    const mod = await load();
    const rungs = mod.BALANCE_SELECTS;
    expect(rungs[0]).toContain('set_id, source');
    for (const r of rungs.slice(1)) expect(r).not.toContain('set_id');
    expect(rungs[1]).toContain('content_revision');
    expect(rungs[1], 'the 2026-08-05 migration brought derived and content_revision together').toContain('derived->>setId');
    expect(rungs[2]).not.toContain('derived');
    expect(rungs[rungs.length - 1]).not.toContain('placement');
    expect(rungs[rungs.length - 1]).toContain('hero_offer');
  });
});

describe('fetchRunDerived — the payloads, by id', () => {
  it('asks for nothing when there is nothing to read', async () => {
    const m = await (await load()).fetchRunDerived([]);
    expect(m.size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it('fetches only the ids it is given, in chunks, and joins them by id, dropping a malformed payload', async () => {
    respond = (q) => ({ data: (q.ins[0]![1] as number[]).includes(12) ? DERIVED : [], error: null });
    const mod = await load();
    const ids = Array.from({ length: 2 * mod.DERIVED_CHUNK + 5 }, (_, i) => i + 1); // 12 sits in the first chunk
    const m = await mod.fetchRunDerived(ids);
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.table).toBe('run_telemetry');
      expect(q.select).toBe('id, derived');
      expect(q.ins).toHaveLength(1);
      expect(q.ins[0]![0]).toBe('id');
      expect(q.limit, 'no limit: the ids ARE the limit').toBeUndefined();
    }
    expect(queries.map((q) => q.ins[0]![1].length)).toEqual([mod.DERIVED_CHUNK, mod.DERIVED_CHUNK, 5]);
    expect(queries[0]!.ins[0]![1]).toEqual(ids.slice(0, mod.DERIVED_CHUNK));
    expect(m.get(12)?.seed).toBe(5);
    expect(m.has(99), 'a malformed payload is dropped, never joined').toBe(false);
    expect(m.size).toBe(1);
  });

  it('a backend without the derived column errors the query and the map is simply empty; the flat report stands', async () => {
    respond = () => missingColumn('derived');
    const m = await (await load()).fetchRunDerived([12, 11]);
    expect(m.size).toBe(0);
  });
});
