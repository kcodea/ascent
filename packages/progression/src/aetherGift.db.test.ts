import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AETHER GIFTS, EXECUTED (owner 2026-11-20: "i would like upon them logging in, to recieve a prompt. it should say,
 * you've been gifted XXX Aether from the Ascent team for: ..."; R-PROG-GIFT-02). PGlite runs the progression
 * migrations in production order, then 2026-10-18-aether.sql, then 2026-11-22-aether-gifts.sql, and checks on real
 * Postgres: `aether_gift` finds the one account by name (and #tag), pays once through the ledger, records the reason
 * and moves the revision; a missing or ambiguous name refuses and pays nothing; the player reads only their own gifts
 * and can only mark their own seen; and no API role can call the admin tool or write the table.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-11-03-secret-plushie-plate.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');
const GIFTS = read('2026-11-22-aether-gifts.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (author text primary key, discriminator text, user_id uuid unique references auth.users(id),
    rating int not null default 0, rank_highest_division int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(),
    promoted boolean not null default false, division_before int not null default 0, was_demotion_game boolean not null default false,
    demoted boolean not null default false, lobby_strength int, primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, hero_id text, placement int, config jsonb, record jsonb, created_at timestamptz default now());
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  -- Hosted Supabase's default privileges: EXECUTE on new functions and full DML on new tables for the API roles, so
  -- the tests below prove the migration's revokes, not the stub's silence.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
`;
const API_GRANTS = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;

let db: PGlite;
let userSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function newUser(author: string, tag: string | null): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.profiles (author, discriminator, user_id) values ($1, $2, $3)', [author, tag, u]);
  return u;
}
async function balance(u: string): Promise<number> {
  return (await db.query<{ balance: number }>('select balance from public.aether_wallets where user_id = $1', [u])).rows[0]?.balance ?? 0;
}
async function revision(u: string): Promise<number> {
  return (await one<{ r: number }>('select progression_revision::int as r from public.profiles where user_id = $1', [u])).r;
}
type Gift = { player: string; gift_id: string; amount: number; reason: string; balance: number };
async function gift(name: string, tag: string | null, amount: number, reason: string): Promise<Gift> {
  return (await one<{ g: Gift }>('select public.aether_gift($1, $2, $3, $4) as g', [name, tag, amount, reason])).g;
}
async function asUser<T>(u: string, run: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated;');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u]);
    return await run();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  await db.exec(AETHER);
  await db.exec(API_GRANTS);
  await db.exec(GIFTS);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('aether_gift (the admin tool)', () => {
  it('pays the one named account once, through the ledger, records the reason and moves the revision', async () => {
    const u = await newUser('Arivas', '2635');
    const before = await revision(u);
    const g = await gift('arivas', null, 1000, '  being one of our first players  ');
    expect(g).toMatchObject({ player: 'Arivas#2635', amount: 1000, reason: 'being one of our first players', balance: 1000 });
    expect(await balance(u)).toBe(1000);
    expect(await revision(u)).toBe(before + 1);
    const ledger = (await db.query<{ delta: number; reason: string; source_id: string }>(
      'select delta, reason, source_id from public.aether_ledger where user_id = $1', [u])).rows;
    expect(ledger).toEqual([{ delta: 1000, reason: 'grant', source_id: `gift:${g.gift_id}` }]);
    const row = await one<{ amount: number; reason: string; seen_at: unknown }>('select amount, reason, seen_at from public.aether_gifts where gift_id = $1', [g.gift_id]);
    expect(row).toEqual({ amount: 1000, reason: 'being one of our first players', seen_at: null });
    // A second gift is its own gift (its own ledger source), not a deduped replay.
    const g2 = await gift('Arivas', '2635', 250, 'finding a bug');
    expect(g2.balance).toBe(1250);
    expect(g2.gift_id).not.toBe(g.gift_id);
  });

  it('refuses a missing name and an ambiguous name, paying nothing; the tag picks one of several', async () => {
    expect(await raises("select public.aether_gift('Nobody', null, 100, 'x')")).toMatch(/no signed-in player named Nobody/);
    const a = await newUser('Twin', '0001');
    const b = await newUser('twin', '0002');
    expect(await raises("select public.aether_gift('Twin', null, 100, 'x')")).toMatch(/2 players are named Twin \(tags: #0001, #0002\)/);
    expect(await balance(a)).toBe(0);
    expect(await balance(b)).toBe(0);
    expect((await gift('Twin', '0002', 100, 'x')).player).toBe('twin#0002');
    expect(await balance(a)).toBe(0);
    expect(await balance(b)).toBe(100);
  });

  it('refuses a bad amount or reason and pays nothing', async () => {
    const u = await newUser('Picky', '0003');
    expect(await raises("select public.aether_gift('Picky', null, 0, 'x')")).toMatch(/positive/);
    expect(await raises("select public.aether_gift('Picky', null, -5, 'x')")).toMatch(/positive/);
    expect(await raises("select public.aether_gift('Picky', null, 5, '   ')")).toMatch(/reason is required/);
    expect(await raises("select public.aether_gift('Picky', null, 5, $1)", ['x'.repeat(301)])).toMatch(/300/);
    expect(await balance(u)).toBe(0);
    expect((await one<{ n: number }>('select count(*)::int as n from public.aether_gifts where user_id = $1', [u])).n).toBe(0);
  });
});

describe('the player side', () => {
  it('a player reads only their own gifts and marks only their own seen', async () => {
    const u = await newUser('Reader', '0004');
    const other = await newUser('Other', '0005');
    const mine = await gift('Reader', null, 300, 'winning the community cup');
    const theirs = await gift('Other', null, 50, 'x');
    const seen = await asUser(u, async () => {
      const rows = (await db.query<{ gift_id: string; amount: number; reason: string }>(
        'select gift_id, amount, reason from public.aether_gifts where seen_at is null')).rows;
      expect(rows).toEqual([{ gift_id: mine.gift_id, amount: 300, reason: 'winning the community cup' }]);
      // Another account's gift: a no-op. A direct write: refused.
      expect((await one<{ ok: boolean }>('select public.ack_aether_gift($1) as ok', [theirs.gift_id])).ok).toBe(false);
      expect(await raises('update public.aether_gifts set amount = 99999')).toMatch(/permission denied/);
      expect(await raises("insert into public.aether_gifts (user_id, amount, reason) values ($1, 5, 'self')", [u])).toMatch(/permission denied/);
      return (await one<{ ok: boolean }>('select public.ack_aether_gift($1) as ok', [mine.gift_id])).ok;
    });
    expect(seen).toBe(true);
    expect((await one<{ s: unknown }>('select seen_at as s from public.aether_gifts where gift_id = $1', [mine.gift_id])).s).not.toBeNull();
    expect((await one<{ s: unknown }>('select seen_at as s from public.aether_gifts where gift_id = $1', [theirs.gift_id])).s).toBeNull();
    // Seen twice: the second ack changes nothing.
    expect(await asUser(u, async () => (await one<{ ok: boolean }>('select public.ack_aether_gift($1) as ok', [mine.gift_id])).ok)).toBe(false);
    expect(other).toBeTruthy();
  });

  it('no API role can call the admin tool', async () => {
    const u = await newUser('Hacker', '0006');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role};`);
      try {
        expect(await raises("select public.aether_gift('Hacker', null, 1000000, 'free money')")).toMatch(/permission denied/);
      } finally {
        await db.exec('reset role;');
      }
    }
    expect(await balance(u)).toBe(0);
    await db.exec('set role anon;');
    try {
      expect(await raises("select public.ack_aether_gift('00000000-0000-0000-0000-000000000000')")).toMatch(/permission denied/);
    } finally {
      await db.exec('reset role;');
    }
  });
});
