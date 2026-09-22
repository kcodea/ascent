/**
 * THE BALANCE REPORT FETCH (2026-09-22) — `fetchRunTelemetry` against a mocked Supabase client. Pins the select
 * ladder the report depends on: the NEWEST migration's columns (`set_id`, `source`) are the FIRST thing dropped
 * when a select errors, so a backend that has not run the 2026-09-22 migration answers from the next rung
 * instead of erroring on every rung and emptying the report; the derived payloads are fetched in their own
 * query and joined onto the rows by id; and the stamps map onto the row when present.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Query { table: string; select?: string; nots: [string, string, unknown][]; limit?: number }

const queries: Query[] = [];
let respond: (q: Query) => { data: unknown[] | null; error: unknown } = () => ({ data: [], error: null });

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Query = { table, nots: [] };
      queries.push(q);
      const chain = {
        select: (sel: string) => { q.select = sel; return chain; },
        not: (col: string, op: string, val: unknown) => { q.nots.push([col, op, val]); return chain; },
        order: () => chain,
        limit: (n: number) => { q.limit = n; return Promise.resolve(respond(q)); },
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

const isDerived = (q: Query): boolean => q.select === 'id, derived';
const isFlat = (q: Query): boolean => q.table === 'run_telemetry' && !isDerived(q);
const missingColumn = (col: string) => ({ data: null, error: { code: '42703', message: `column run_telemetry.${col} does not exist` } });

const FLAT = [
  { id: 12, created_at: '2026-09-22T10:00:00Z', patch: '0.1.0+bbb', author: 'Kev', content_revision: 'r2', set_id: 'set2', source: 'ladder', hero_id: 'warden', hero_offer: ['mode:lobby', 'warden', 'drakko'], won: false, wins: 3, offered_quests: [], picked_quests: [], quest_turns: {}, offered_runes: [], picked_runes: [], offered_cards: ['alley'], bought_cards: ['alley'], discover_offered_cards: [], discover_bought_cards: [], tier_by_wave: [0, 1, 2], buy_events: [{ id: 'alley', wave: 1, src: 'shop' }], placement: 2 },
  { id: 11, created_at: '2026-09-21T10:00:00Z', patch: '0.1.0+aaa', author: 'Mike', content_revision: 'r1', set_id: null, source: null, hero_id: 'drakko', hero_offer: ['mode:lobby', 'drakko'], won: true, wins: 9, offered_quests: [], picked_quests: [], quest_turns: {}, offered_runes: [], picked_runes: [], offered_cards: [], bought_cards: [], discover_offered_cards: [], discover_bought_cards: [], tier_by_wave: [0, 1], buy_events: [], placement: 1 },
];
const DERIVED = [
  { id: 12, derived: { contentRevision: 'r2', heroId: 'warden', mode: 'lobby', seed: 5, finalWave: 2, wins: 3, won: false, diverged: false, offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [], playerActions: 1 } },
  { id: 99, derived: { notAPayload: true } }, // a malformed payload is dropped, never joined
];

describe('fetchRunTelemetry — the select ladder', () => {
  it('reads the stamps, the row metadata and the derived payloads in ONE joined result when the backend has every column', async () => {
    respond = (q) => ({ data: isDerived(q) ? DERIVED : FLAT, error: null });
    const rows = await (await load()).fetchRunTelemetry(1000, 400);
    expect(queries.filter(isFlat)).toHaveLength(1);
    expect(queries.find(isFlat)!.select).toContain('set_id, source');
    expect(queries.find(isFlat)!.limit).toBe(1000);
    const d = queries.find(isDerived)!;
    expect(d.limit).toBe(400);
    expect(d.nots).toEqual([['derived', 'is', null]]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 12, createdAt: '2026-09-22T10:00:00Z', patch: '0.1.0+bbb', author: 'Kev', contentRevision: 'r2', setId: 'set2', source: 'ladder', mode: 'lobby', heroId: 'warden', placement: 2 });
    expect(rows[0]!.heroOffer, 'the mode tag is stripped back out of the offer').toEqual(['warden', 'drakko']);
    expect(rows[0]!.derived?.seed).toBe(5);
    expect(rows[1]!.setId, 'a null stamp reads as absent, so the legacy rule applies').toBeUndefined();
    expect(rows[1]!.source).toBeUndefined();
    expect(rows[1]!.derived, 'no payload for this id').toBeNull();
  });

  it('a backend WITHOUT the 2026-09-22 columns errors the first rung and answers from the second, stamps absent', async () => {
    respond = (q) => {
      if (isDerived(q)) return { data: DERIVED, error: null };
      if (q.select!.includes('set_id')) return missingColumn('set_id');
      return { data: FLAT.map(({ set_id: _s, source: _o, ...rest }) => rest), error: null };
    };
    const rows = await (await load()).fetchRunTelemetry(500);
    const flats = queries.filter(isFlat);
    expect(flats).toHaveLength(2);
    expect(flats[0]!.select).toContain('set_id');
    expect(flats[1]!.select).not.toContain('set_id');
    expect(flats[1]!.select, 'the rung below keeps everything older').toContain('content_revision');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.setId).toBeUndefined();
    expect(rows[0]!.source).toBeUndefined();
    expect(rows[0]!.derived?.seed, 'the derived join still works').toBe(5);
  });

  it('walks the whole ladder down to the original columns, dropping one migration per rung', async () => {
    respond = (q) => {
      if (isDerived(q)) return missingColumn('derived');
      const sel = q.select!;
      for (const col of ['set_id', 'content_revision', 'placement', 'buy_events', 'discover_offered_cards']) if (sel.includes(col)) return missingColumn(col);
      return { data: FLAT.map((r) => ({ id: r.id, created_at: r.created_at, patch: r.patch, author: r.author, hero_id: r.hero_id, hero_offer: r.hero_offer, won: r.won, wins: r.wins, offered_cards: r.offered_cards, bought_cards: r.bought_cards, tier_by_wave: r.tier_by_wave })), error: null };
    };
    const mod = await load();
    const rows = await mod.fetchRunTelemetry(500);
    expect(queries.filter(isFlat)).toHaveLength(mod.BALANCE_SELECTS.length);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 12, heroId: 'warden', mode: 'lobby', offeredCards: ['alley'], placement: undefined, derived: null });
    expect(rows[0]!.buyEvents).toBeUndefined();
  });

  it('a derived query that errors costs only the derived join; the flat report still loads', async () => {
    respond = (q) => (isDerived(q) ? missingColumn('derived') : { data: FLAT, error: null });
    const rows = await (await load()).fetchRunTelemetry(500);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.derived === null)).toBe(true);
    expect(rows[0]!.setId).toBe('set2');
  });

  it('the ladder drops the newest migration first: set_id and source go before anything older', async () => {
    const mod = await load();
    const rungs = mod.BALANCE_SELECTS;
    expect(rungs[0]).toContain('set_id, source');
    for (const r of rungs.slice(1)) expect(r).not.toContain('set_id');
    expect(rungs[1]).toContain('content_revision');
    expect(rungs[rungs.length - 1]).not.toContain('placement');
    expect(rungs[rungs.length - 1]).toContain('hero_offer');
  });
});
