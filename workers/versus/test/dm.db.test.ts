/**
 * DIRECT MESSAGES, the SQL against real Postgres (PGlite): `2026-11-12-direct-messages.sql` (owner 2026-10-29: "In game
 * messaging should be direct messages through the friends list"; R-DM-02..04). Run twice (idempotent). Proves:
 *  - the hub's writer: no key, no write; friends only; a block refuses either way; guests refused; body bounds; the same
 *    client id stores once; the per-minute backstop;
 *  - offline delivery: a stored message is in the recipient's unread counts and history on their next open;
 *  - read receipts, history paging (50 at a time, older pages), a block hides the pair's history and unread;
 *  - Report message: only a message sent to me, once; the report keeps a copy of the body;
 *  - RLS: a player reads only their own conversations; no client role can write either table;
 *  - retention: `dm_prune` drops messages older than 90 days;
 *  - replies (`2026-11-15-dm-replies.sql`, R-DM-REPLY-01): a reply to a message of this conversation keeps it and its
 *    quote in every read; one to another conversation is stored plain; the 5-argument call still works; a pruned
 *    original leaves the reply without its quote.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const BASE = mig('2026-10-13-versus.sql') + mig('2026-10-24-versus-group.sql') + mig('2026-10-28-friends.sql') + mig('2026-11-09-friends-presence-window.sql');
const DM = mig('2026-11-12-direct-messages.sql');
const REPLIES = mig('2026-11-15-dm-replies.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create extension if not exists pgcrypto with schema extensions;
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
  -- The Worker's writer key table (2026-11-04-versus-cf-writer.sql), as it stands on the live project.
  create table public.versus_cf_writer_keys (key_hash text primary key, note text, created_at timestamptz not null default now());
`;
const SECRET = 'test-writer-secret-not-real';
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ANN = u(1);
const BOB = u(2);
const CAT = u(3);
const GUEST = u(9);

let db: PGlite;

async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ''}', false); set role ${who ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally { await db.exec('reset role'); }
}
async function rpc<T = unknown>(who: string | null, fn: string, args: unknown[] = []): Promise<T> {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await as<{ v: T }>(who, `select public.${fn}(${ph}) as v`, args);
  return rows[0]!.v;
}
async function fails(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
type Row = { id: string; cid: string | null; from: string; to: string; body: string; at: string; readAt: string | null; replyTo?: string | null; reply?: { id: string; from: string; body: string } | null };
const send = (from: string, to: string, body: string, cid: string = randomUUID(), key: string | null = SECRET): Promise<Row> =>
  rpc<Row>(null, 'dm_cf_send', [key, from, to, body, cid]);
async function befriend(a: string, b: string): Promise<void> {
  await rpc(a, 'friends_request', [b, null]);
  await rpc(b, 'friends_respond', [a, true]);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(DM);
  await db.exec(DM); // idempotent
  await db.exec(REPLIES);
  await db.exec(REPLIES); // idempotent
  await db.query('insert into public.versus_cf_writer_keys (key_hash) values ($1)', [createHash('sha256').update(SECRET).digest('hex')]);
  for (const [id, name, anon] of [[ANN, 'Ann', false], [BOB, 'Bob', false], [CAT, 'Cat', false], [GUEST, 'Guest', true]] as const) {
    await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, anon]);
    await db.query('insert into public.profiles (user_id, author, discriminator) values ($1, $2, $3)', [id, name, '1234']);
  }
  await befriend(ANN, BOB);
});
afterAll(async () => { await db?.close(); });

describe('dm_cf_send: the hub writer (R-DM-02)', () => {
  it('needs the writer key', async () => {
    expect(await fails(send(ANN, BOB, 'hi', randomUUID(), null))).toContain('bad_key');
    expect(await fails(send(ANN, BOB, 'hi', randomUUID(), 'wrong'))).toContain('bad_key');
  });

  it('stores a message between friends, and the same client id only once', async () => {
    const cid = randomUUID();
    const a = await send(ANN, BOB, 'Good game!', cid);
    const b = await send(ANN, BOB, 'Good game!', cid);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ from: ANN, to: BOB, body: 'Good game!', cid, readAt: null });
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.direct_messages where client_id = $1', [cid]);
    expect(n.rows[0]!.n).toBe(1);
  });

  it('refuses a non-friend, a guest, myself, and a bad body', async () => {
    expect(await fails(send(ANN, CAT, 'hi'))).toContain('not_friends');
    expect(await fails(send(GUEST, ANN, 'hi'))).toContain('not_friends');
    expect(await fails(send(ANN, ANN, 'hi'))).toContain('bad_target');
    expect(await fails(send(ANN, BOB, '   '))).toContain('bad_body');
    expect(await fails(send(ANN, BOB, 'x'.repeat(501)))).toContain('bad_body');
    expect((await send(ANN, BOB, 'x'.repeat(500))).body).toHaveLength(500);
  });

  it('a block refuses either way', async () => {
    await befriend(BOB, CAT);
    await rpc(CAT, 'friends_block', [BOB]);
    expect(await fails(send(BOB, CAT, 'hi'))).toMatch(/blocked|not_friends/);
    expect(await fails(send(CAT, BOB, 'hi'))).toMatch(/blocked|not_friends/);
    await rpc(CAT, 'friends_unblock', [BOB]);
  });

  it('dm_cf_friends lists accepted friends only', async () => {
    const f = await rpc<string[]>(null, 'dm_cf_friends', [SECRET, ANN]);
    expect(f).toEqual([BOB]);
    expect(await fails(rpc(null, 'dm_cf_friends', ['nope', ANN]))).toContain('bad_key');
  });

  it('the per-minute backstop refuses a flood', async () => {
    const d = u(20); const e = u(21);
    for (const id of [d, e]) {
      await db.query('insert into auth.users (id) values ($1)', [id]);
      await db.query('insert into public.profiles (user_id, author, discriminator) values ($1, $2, $3)', [id, `P${id.slice(-2)}`, '5555']);
    }
    await befriend(d, e);
    for (let i = 0; i < 30; i++) await send(d, e, `m${i}`);
    expect(await fails(send(d, e, 'one more'))).toContain('rate_limited');
  });
});

describe('the client calls (R-DM-03)', () => {
  it('offline delivery: unread counts and history on the next open; read receipts', async () => {
    const z = u(30); const y = u(31);
    for (const id of [z, y]) {
      await db.query('insert into auth.users (id) values ($1)', [id]);
      await db.query('insert into public.profiles (user_id, author, discriminator) values ($1, $2, $3)', [id, `Q${id.slice(-2)}`, '6666']);
    }
    await befriend(z, y);
    await send(z, y, 'first');
    await send(z, y, 'second');
    const unread = await rpc<Record<string, { count: number; last: Row }>>(y, 'dm_unread');
    expect(unread[z]!.count).toBe(2);
    expect(unread[z]!.last.body).toBe('second');
    const hist = await rpc<Row[]>(y, 'dm_history', [z, null, 50]);
    expect(hist.map((r) => r.body)).toEqual(['second', 'first']);
    expect(await rpc<number>(y, 'dm_mark_read', [z])).toBe(2);
    expect(await rpc<number>(y, 'dm_mark_read', [z])).toBe(0);
    expect(await rpc(y, 'dm_unread')).toEqual({});
    // The sender sees the read receipt in their own history.
    expect((await rpc<Row[]>(z, 'dm_history', [y, null, 50]))[0]!.readAt).not.toBeNull();
  });

  it('pages history 50 at a time, older pages by time', async () => {
    const p = u(40); const q = u(41);
    for (const id of [p, q]) {
      await db.query('insert into auth.users (id) values ($1)', [id]);
      await db.query('insert into public.profiles (user_id, author, discriminator) values ($1, $2, $3)', [id, `R${id.slice(-2)}`, '7777']);
    }
    await befriend(p, q);
    for (let i = 0; i < 60; i++) {
      await db.query(`insert into public.direct_messages (sender, recipient, body, created_at) values ($1, $2, $3, now() - ($4 || ' seconds')::interval)`, [p, q, `m${i}`, String(600 - i)]);
    }
    const page1 = await rpc<Row[]>(q, 'dm_history', [p, null, 50]);
    expect(page1).toHaveLength(50);
    expect(page1[0]!.body).toBe('m59');
    const page2 = await rpc<Row[]>(q, 'dm_history', [p, page1[49]!.at, 50]);
    expect(page2.map((r) => r.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${9 - i}`));
  });

  it('a block hides the history and the unread counts', async () => {
    await send(ANN, BOB, 'before the block');
    expect((await rpc<Record<string, unknown>>(BOB, 'dm_unread'))[ANN]).toBeTruthy();
    await rpc(BOB, 'friends_block', [ANN]);
    expect(await rpc(BOB, 'dm_history', [ANN, null, 50])).toEqual([]);
    expect(await rpc(ANN, 'dm_history', [BOB, null, 50])).toEqual([]);
    expect((await rpc<Record<string, unknown>>(BOB, 'dm_unread'))[ANN]).toBeUndefined();
    await rpc(BOB, 'friends_unblock', [ANN]);
    await befriend(ANN, BOB);
  });

  it('guests and signed-out callers are refused', async () => {
    expect(await fails(rpc(GUEST, 'dm_unread'))).toContain('guest');
    expect(await fails(rpc(null, 'dm_unread'))).toMatch(/permission|not_signed_in/);
  });
});

describe('Report message (R-DM-04)', () => {
  it('reports a message sent to me, once, keeping its body', async () => {
    const m = await send(ANN, BOB, 'something rude');
    expect(await fails(rpc(ANN, 'dm_report', [m.id, 'abuse']))).toContain('not_found');
    expect(await rpc(BOB, 'dm_report', [m.id, 'abuse'])).toEqual({ reported: true });
    expect(await rpc(BOB, 'dm_report', [m.id, 'abuse'])).toEqual({ reported: true });
    expect(await fails(rpc(BOB, 'dm_report', [m.id, 'whatever']))).toContain('bad_reason');
    const r = await db.query<{ n: number; body: string }>('select count(*)::int as n, max(body) as body from public.dm_reports where message_id = $1', [m.id]);
    expect(r.rows[0]).toEqual({ n: 1, body: 'something rude' });
  });
});

describe('RLS (R-DM-02)', () => {
  it('a player reads only their own conversations, and no client writes', async () => {
    const rows = await as<{ sender: string; recipient: string }>(CAT, 'select sender, recipient from public.direct_messages');
    expect(rows.every((r) => r.sender === CAT || r.recipient === CAT)).toBe(true);
    expect((await as(ANN, 'select * from public.direct_messages')).length).toBeGreaterThan(0);
    expect(await fails(as(ANN, `insert into public.direct_messages (sender, recipient, body) values ('${ANN}', '${BOB}', 'x')`))).toMatch(/permission/);
    expect(await fails(as(ANN, `update public.direct_messages set body = 'x'`))).toMatch(/permission/);
    expect(await fails(as(BOB, 'select * from public.dm_reports'))).toMatch(/permission/);
    expect(await fails(as(null, 'select * from public.direct_messages'))).toMatch(/permission/);
  });
});

describe('retention (R-DM-04)', () => {
  it('dm_prune drops messages older than 90 days', async () => {
    await db.query(`insert into public.direct_messages (sender, recipient, body, created_at) values ($1, $2, 'old', now() - interval '91 days')`, [ANN, BOB]);
    await db.query(`insert into public.direct_messages (sender, recipient, body, created_at) values ($1, $2, 'recent', now() - interval '89 days')`, [ANN, BOB]);
    expect(await db.query('select public.dm_prune()')).toBeTruthy();
    const left = await db.query<{ body: string }>(`select body from public.direct_messages where body in ('old', 'recent')`);
    expect(left.rows.map((r) => r.body)).toEqual(['recent']);
  });
});

describe('replies (R-DM-REPLY-01)', () => {
  const reply = (from: string, to: string, body: string, to_msg: string | null): Promise<Row> =>
    rpc<Row>(null, 'dm_cf_send', [SECRET, from, to, body, randomUUID(), to_msg]);

  it('a reply keeps the message it answers, with a short quote, in the answer, the history and the unread counts', async () => {
    const q = await send(BOB, ANN, `should we add minions to duos? ${'x'.repeat(200)}`);
    const r = await reply(ANN, BOB, 'yes, more minions', q.id);
    expect(r.replyTo).toBe(q.id);
    expect(r.reply).toMatchObject({ id: q.id, from: BOB });
    expect(r.reply!.body).toHaveLength(140);
    const hist = await rpc<Row[]>(BOB, 'dm_history', [ANN, null, 50]);
    expect(hist.find((h) => h.id === r.id)).toMatchObject({ replyTo: q.id, reply: { id: q.id } });
    const un = await rpc<Record<string, { last: Row }>>(BOB, 'dm_unread');
    expect(un[ANN]!.last).toMatchObject({ id: r.id, replyTo: q.id });
    // A plain message carries no quote.
    expect((await send(ANN, BOB, 'plain'))).toMatchObject({ replyTo: null, reply: null });
    await rpc(BOB, 'dm_mark_read', [ANN]);
    await rpc(ANN, 'dm_mark_read', [BOB]);
  });

  it('a reply to a message of another conversation is stored as a plain message', async () => {
    const d = u(60); const e = u(61);
    for (const id of [d, e]) {
      await db.query('insert into auth.users (id) values ($1)', [id]);
      await db.query('insert into public.profiles (user_id, author, discriminator) values ($1, $2, $3)', [id, `P${id.slice(-2)}`, '6666']);
    }
    await befriend(d, e);
    const theirs = await send(ANN, BOB, 'between Ann and Bob');
    const r = await reply(d, e, 'sneaky', theirs.id);
    expect(r).toMatchObject({ body: 'sneaky', replyTo: null, reply: null });
  });

  it('a pruned original leaves the reply, without its quote', async () => {
    const q = await send(BOB, ANN, 'old news');
    const r = await reply(ANN, BOB, 'agreed', q.id);
    await db.query(`update public.direct_messages set created_at = now() - interval '100 days' where id = $1`, [q.id]);
    await db.query('select public.dm_prune()');
    const hist = await rpc<Row[]>(ANN, 'dm_history', [BOB, null, 50]);
    expect(hist.find((h) => h.id === r.id)).toMatchObject({ body: 'agreed', replyTo: null, reply: null });
  });
});
