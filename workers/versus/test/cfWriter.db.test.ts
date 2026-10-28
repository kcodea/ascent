/**
 * VERSUS ON CLOUDFLARE — the result writer, executed (PGlite runs every Versus migration in order, then
 * `2026-11-04-versus-cf-writer.sql` twice: idempotent). Owner ruling 2026-10-28: results go through a dedicated,
 * limited path, never the service role. Proves: no key, no write; a Cloudflare match and its rounds land as the readers
 * expect (scouts kept); a Supabase-hosted match can never be touched; a finished Cloudflare match is frozen; the sweep
 * leaves Cloudflare matches alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
  '2026-11-02-versus-server-reliability.sql', '2026-11-03-versus-live-armor.sql',
];
const WRITER = mig('2026-11-04-versus-cf-writer.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '00000000-0000-0000-0000-000000000002';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 'test-writer-secret-not-real';

let db: PGlite;
async function call(key: string | null, kind: string, row: unknown): Promise<unknown> {
  await db.exec('set role anon');
  try {
    const r = await db.query<{ v: unknown }>('select public.versus_cf_persist($1, $2, $3::jsonb) as v', [key, kind, JSON.stringify(row)]);
    return r.rows[0]!.v;
  } finally {
    await db.exec('reset role');
  }
}
async function fails(key: string | null, kind: string, row: unknown): Promise<string> {
  try { await call(key, kind, row); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const matchRow = (over: Record<string, unknown> = {}) => ({
  id: MATCH, seed: 42, set_id: 'set1', content_revision: 'rev1', protocol: 2, phase: 'combat', revision: 5, round: 1,
  p1_user: P1, p2_user: P2, p1_name: 'Claudebot1', p2_name: 'Claudebot2', p1_hero: 'h1', p2_hero: 'h2', heroes_revealed: true,
  p1_health: 30, p1_armor: 5, p2_health: 27, p2_armor: 0, p1_missed: 0, p2_missed: 0, p1_auto: false, p2_auto: false,
  winner_seat: null, end_reason: null, options: { v: 1, mode: 'duel', modifiers: [] },
  created_at: '2026-10-28T12:00:00.000Z', updated_at: '2026-10-28T12:01:00.000Z', completed_at: null, ...over,
});
const roundRow = (round: number) => ({
  match_id: MATCH, round, chair: 'p1', outcome: 'p1', heart_lost_by: 'p2', p1_result: { result: 'win' }, p2_result: { result: 'lose' },
  digest: 'd' + round, p1_health: 30, p1_armor: 5, p2_health: 27, p2_armor: 0, p1_damage: 0, p2_damage: 3,
  p1_scout: { tier: 2 }, p2_scout: { tier: 1 }, committed_at: '2026-10-28T12:01:00.000Z',
});

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(FILES.map(mig).join('\n'));
  await db.exec(WRITER);
  await db.exec(WRITER);
  const hash = createHash('sha256').update(SECRET).digest('hex');
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [hash, 'test']);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('versus_cf_persist (the Cloudflare room\'s only write path)', () => {
  it('refuses without the writer key, and anon cannot read the key table', async () => {
    expect(await fails(null, 'match', matchRow())).toContain('not_authorized');
    expect(await fails('wrong', 'match', matchRow())).toContain('not_authorized');
    await db.exec('set role anon');
    await expect(db.query('select * from public.versus_cf_writer_keys')).rejects.toThrow();
    await db.exec('reset role');
  });

  it('writes a Cloudflare match and its rounds as the readers expect (scouts kept, room-less, backend marked)', async () => {
    expect(await call(SECRET, 'match', matchRow())).toMatchObject({ ok: true });
    expect(await call(SECRET, 'round', roundRow(1))).toMatchObject({ ok: true });
    expect(await call(SECRET, 'round', roundRow(1))).toMatchObject({ ok: true }); // a retry is harmless
    const m = (await db.query<Record<string, unknown>>(`select * from public.versus_matches where id = '${MATCH}'`)).rows[0]!;
    expect(m).toMatchObject({ backend: 'cloudflare', room_id: null, phase: 'combat', p2_health: 27 });
    const r = (await db.query<Record<string, unknown>>(`select * from public.versus_rounds where match_id = '${MATCH}'`)).rows;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ p1_scout: { tier: 2 }, p2_scout: { tier: 1 }, p2_damage: 3 });
  });

  it('leaves Cloudflare matches to their room: the sweep skips them', async () => {
    await call(SECRET, 'match', matchRow({ updated_at: '2020-01-01T00:00:00.000Z', revision: 6 }));
    await db.exec('set role service_role');
    await db.query('select public.versus_sweep()');
    await db.exec('reset role');
    const m = (await db.query<{ phase: string }>(`select phase from public.versus_matches where id = '${MATCH}'`)).rows[0]!;
    expect(m.phase).toBe('combat');
  });

  it('a finished Cloudflare match is frozen; a Supabase-hosted match can never be written', async () => {
    await call(SECRET, 'match', matchRow({ phase: 'complete', winner_seat: 'p1', end_reason: 'hearts', completed_at: '2026-10-28T12:10:00.000Z' }));
    expect(await call(SECRET, 'match', matchRow({ phase: 'combat' }))).toMatchObject({ frozen: true });
    const m = (await db.query<{ phase: string }>(`select phase from public.versus_matches where id = '${MATCH}'`)).rows[0]!;
    expect(m.phase).toBe('complete');
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.query(`insert into public.versus_matches (id, seed, set_id, content_revision, protocol, phase, p1_user, p2_user, p1_name, p2_name)
      values ('${other}', 1, 'set1', 'rev1', 2, 'shop', '${P1}', '${P2}', 'a', 'b')`);
    expect(await fails(SECRET, 'match', matchRow({ id: other }))).toContain('not_cloudflare');
    expect(await fails(SECRET, 'round', { ...roundRow(1), match_id: other })).toContain('not_cloudflare');
  });
});
