/**
 * THE VERSUS HERO RE-ROLL, EXECUTED (owner 2026-10-15, R-HERO-REROLL-01). PGlite runs the real Versus migrations plus
 * `2026-10-15-versus-hero-reroll.sql` and proves the RPC: it swaps exactly one slot of the caller's three, once per
 * player per match, drawn from the match seed (the same seed and list always give the same hero), only on Hero
 * Select before the pick and the deadline, never with a candidate already offered, and the swap stays in the seat's
 * private row (the opponent cannot read it). A timeout auto-pick then picks from the CURRENT three.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentRevision } from '@game/content';
import { versusHeroOffer, versusHeroRerollCandidates } from './run';

const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-shop-start.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-scout.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-ready-pause.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-15-versus-hero-reroll.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

let db: PGlite;
let clock = Date.parse('2026-10-15T12:00:00Z');
let nextUser = 0x100;
const user = (): string => `00000000-0000-0000-0000-${(nextUser++).toString(16).padStart(12, '0')}`;

async function as<T = any>(who: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
  await db.exec(who ? `select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  } finally {
    await db.exec('reset role');
  }
}
async function fails(who: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try { await as(who, sql, params); } catch (e) { return (e as Error).message; }
  return 'ok';
}
/** My private row, read AS me (RLS applies). */
async function privOf(who: string, matchId: string): Promise<any[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who}', false); set role authenticated;`);
  try { return (await db.query<any>('select * from public.versus_seat_private where match_id = $1', [matchId])).rows; } finally { await db.exec('reset role'); }
}

interface Seats { roomId: string; matchId: string; p1: string; p2: string; offer: Record<'p1' | 'p2', string[]>; runSeed: Record<'p1' | 'p2', number> }
/** A fresh match on Hero Select with both seats' three registered. */
async function newMatch(): Promise<Seats> {
  const p1 = user(), p2 = user();
  const room = await as<any>(p1, `select public.versus_create_room('Reroll', 'Ann', '{}', 'set2', $1, 1)`, [contentRevision()]);
  await as(p2, `select public.versus_join_room($1, 'player', 'Bob', '{}', $2, 1)`, [room.id, contentRevision()]);
  await as(p1, 'select public.versus_start_game($1)', [room.id]);
  await as(p1, 'select public.versus_press_gate($1)', [room.id]);
  const r2 = await as<any>(p2, 'select public.versus_press_gate($1)', [room.id]);
  const matchId: string = r2.current_match_id;
  const offer = { p1: [] as string[], p2: [] as string[] };
  const runSeed = { p1: 0, p2: 0 };
  for (const [seat, who] of [['p1', p1], ['p2', p2]] as const) {
    const [priv] = await privOf(who, matchId);
    runSeed[seat] = Number(priv.run_seed);
    offer[seat] = versusHeroOffer(Number(priv.hero_seed), runSeed[seat], 'set2');
    await as(who, 'select public.versus_register_offer($1, $2)', [matchId, offer[seat]]);
  }
  return { roomId: room.id, matchId, p1, p2, offer, runSeed };
}
const REROLL = 'select public.versus_reroll_hero($1, $2, $3)';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('versus_reroll_hero (R-HERO-REROLL-01)', () => {
  it('swaps exactly one slot, from the candidates, deterministically from the match seed, once', async () => {
    const m = await newMatch();
    const cands = versusHeroRerollCandidates(m.runSeed.p1, 'set2', m.offer.p1);
    expect(cands.length).toBeGreaterThan(0);
    const out = await as<any>(m.p1, REROLL, [m.matchId, 1, cands]);
    const { seed } = (await db.query<any>('select seed from public.versus_matches where id = $1', [m.matchId])).rows[0];
    const idx = (await db.query<any>(`select public.versus__pick($1, 'hero-reroll:p1', $2) i`, [seed, cands.length])).rows[0].i;
    expect(out.reroll).toEqual({ slot: 1, from: m.offer.p1[1], to: cands[idx] });
    expect(out.offer).toEqual([m.offer.p1[0], cands[idx], m.offer.p1[2]]);
    expect(m.offer.p1).not.toContain(out.reroll.to);
    const [mine] = await privOf(m.p1, m.matchId);
    expect(mine.hero_offer).toEqual(out.offer);
    expect(mine.hero_reroll).toEqual(out.reroll);
    // Once per player per match: any second call is refused, whatever slot.
    expect(await fails(m.p1, REROLL, [m.matchId, 0, versusHeroRerollCandidates(m.runSeed.p1, 'set2', out.offer)])).toMatch(/reroll_used/);
    // The other seat still has its own.
    const c2 = versusHeroRerollCandidates(m.runSeed.p2, 'set2', m.offer.p2);
    expect((await as<any>(m.p2, REROLL, [m.matchId, 0, c2])).reroll.slot).toBe(0);
  });

  it('is hidden from the opponent: their private read never shows my row, and the match row carries nothing', async () => {
    const m = await newMatch();
    await as(m.p1, REROLL, [m.matchId, 2, versusHeroRerollCandidates(m.runSeed.p1, 'set2', m.offer.p1)]);
    const seen = await privOf(m.p2, m.matchId);
    expect(seen.map((r) => r.seat)).toEqual(['p2']);
    expect(seen[0].hero_reroll).toBeNull();
    const row = (await db.query<any>('select to_jsonb(m) j from public.versus_matches m where id = $1', [m.matchId])).rows[0].j;
    expect(JSON.stringify(row)).not.toMatch(/reroll/);
    expect([row.p1_hero, row.p2_hero, row.heroes_revealed]).toEqual([null, null, false]);
  });

  it('refuses a bad slot, a bad candidate list, a non-player, a re-roll after the pick, and after the deadline', async () => {
    const m = await newMatch();
    const cands = versusHeroRerollCandidates(m.runSeed.p1, 'set2', m.offer.p1);
    expect(await fails(m.p1, REROLL, [m.matchId, 3, cands])).toMatch(/bad_index/);
    expect(await fails(m.p1, REROLL, [m.matchId, -1, cands])).toMatch(/bad_index/);
    expect(await fails(m.p1, REROLL, [m.matchId, 0, []])).toMatch(/bad_candidates/);
    expect(await fails(m.p1, REROLL, [m.matchId, 0, [m.offer.p1[0]!, ...cands]])).toMatch(/bad_candidates/); // already offered
    expect(await fails(m.p1, REROLL, [m.matchId, 0, [cands[0]!, cands[0]!]])).toMatch(/bad_candidates/); // repeated
    expect(await fails(user(), REROLL, [m.matchId, 0, cands])).toMatch(/not_a_player/);
    // A refused call spends nothing.
    expect((await privOf(m.p1, m.matchId))[0].hero_reroll).toBeNull();
    // After the pick: refused.
    await as(m.p1, 'select public.versus_pick_hero($1, 0)', [m.matchId]);
    expect(await fails(m.p1, REROLL, [m.matchId, 1, cands])).toMatch(/already_picked/);
    // After the 20 s deadline: refused (the clock never stops for a re-roll).
    clock += 21_000;
    expect(await fails(m.p2, REROLL, [m.matchId, 1, versusHeroRerollCandidates(m.runSeed.p2, 'set2', m.offer.p2)])).toMatch(/hero_deadline_passed|wrong_phase/);
  });

  it('a timeout auto-pick picks from the CURRENT three (after the swap)', async () => {
    const m = await newMatch();
    const out = await as<any>(m.p1, REROLL, [m.matchId, 0, versusHeroRerollCandidates(m.runSeed.p1, 'set2', m.offer.p1)]);
    clock += 21_000;
    for (const who of [m.p1, m.p2]) await as(who, 'select public.versus_heartbeat($1)', [m.roomId]);
    await as(m.p1, 'select public.versus_reconcile($1)', [m.matchId]);
    const row = (await db.query<any>('select p1_hero, phase from public.versus_matches where id = $1', [m.matchId])).rows[0];
    expect(row.phase).toBe('shop');
    expect(out.offer).toContain(row.p1_hero);
  });
});
