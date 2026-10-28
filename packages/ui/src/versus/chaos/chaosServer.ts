/**
 * VERSUS CHAOS HARNESS: THE SERVER (PGlite + the real migrations + the real resolver handlers).
 *
 * One PGlite database with every Versus / Ranked Duos migration applied IN FILE ORDER (picked by name, so a fix branch's
 * new migration is applied automatically), against a stubbed `auth.uid()`. The server clock is the fake clock
 * (`versus.test_now`, read by `versus__now()` for the `postgres` session), so a fake-timer test drives every deadline.
 *
 * - `call(user, fn)`: every statement is serialized (PGlite is one connection) and runs as `authenticated` with the
 *   user's JWT claim (RLS applies), or as `service_role` for `user = null` (the resolver).
 * - REALTIME FEED: triggers on the tables the client subscribes to (`versusRemote.subscribeRoom`) append to
 *   `public._chaos_rt`; after every call the rows are drained and handed to `onChanges` (the fake realtime bus).
 * - THE RESOLVER: `resolve(user, body)` runs the SAME pure handlers the `versus-resolve` Edge Function runs
 *   (`@game/sim/versus/server`) with the same reads (mirrored from supabase/functions/versus-resolve/index.ts), plus
 *   chaos knobs: a delay, N failures (500), a 409, and a log of every call.
 * - MATCH ROW HOLD: `holdMatch(id, ms)` models another transaction holding the match row lock: every call that names the
 *   match (or its room) waits until the hold ends. (PGlite has one connection, so a real `for update` wait cannot be
 *   reproduced; this is the observable effect: those calls answer late.)
 */
import { PGlite } from '@electric-sql/pglite';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  handleRankedDuosFinalize, handleRankedDuosSeat, handleVersusDuosFinalize, handleVersusFinalize, handleVersusGroupFinalize,
  type RankedDuosFinalizeStore, type RankedDuosSeatStore, type VersusDuosFinalizeStore, type VersusFinalizeStore, type VersusGroupFinalizeStore,
} from '@game/sim/versus/server';
import { versusFreshSide } from '@game/sim';
import type { ChaosBackend, ResolverAction, ResolverCall, ResolverChaos, ServerSnap, Vitals } from './chaosBackend';
import type { ChaosMode } from './chaosMatch';
import { RealtimeBus } from './fakeSupabase';

export type { ResolverAction, ResolverCall, ResolverChaos } from './chaosBackend';

const root = join(__dirname, '../../../../..');

/** The Versus migrations every PGlite suite applies, in the order they were written (the `rankedDuosParty.db.test.ts`
 *  list plus the ready signal and the test-bots table). */
const BASE_MIGRATIONS = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-25-versus-test-bots.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql',
  '2026-10-28-versus-health.sql', '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql',
];

/**
 * Every migration the harness applies: the base list, then ANY newer Versus / Ranked Duos migration by file order (a fix
 * branch's new migration is picked up with no edit here). Skipped: the pg_cron sweep (an extension PGlite lacks; the
 * sweep function itself is in the party migration), the progression / XP files (other schemas) and the Cloudflare room's
 * result writer (`versus-cf-*`: needs pgcrypto, and it is not on the Supabase path this harness plays).
 */
export function versusMigrationFiles(): string[] {
  const dir = join(root, 'supabase/migrations');
  const newest = [...BASE_MIGRATIONS].sort().at(-1)!;
  const later = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f > newest && !BASE_MIGRATIONS.includes(f) && /versus|ranked-duos/.test(f) && !/cron|progression|-xp|versus-cf/.test(f))
    .sort();
  return [...BASE_MIGRATIONS, ...later];
}

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on auth.users to authenticated;
  create table if not exists public.progression_results (user_id uuid not null, run_id text not null, mode text not null, primary key (user_id, run_id, mode));
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;

/** The realtime feed: what `versusRemote.subscribeRoom` listens to, recorded per statement. */
const REALTIME = `
  create table public._chaos_rt (id bigserial primary key, tbl text not null, op text not null, key text not null, row jsonb);
  create or replace function public._chaos_rt_capture() returns trigger language plpgsql security definer as $$
  declare v_row jsonb := to_jsonb(coalesce(NEW, OLD));
  begin
    insert into public._chaos_rt (tbl, op, key, row)
    values (TG_TABLE_NAME, TG_OP,
      coalesce(v_row->>'match_id', v_row->>'id'),
      case when TG_TABLE_NAME = 'versus_duos_passes' then v_row else null end);
    return null;
  end $$;
  do $$ declare t text; begin
    foreach t in array array['versus_rooms','versus_matches','versus_rounds','versus_group_matches','versus_group_rounds','versus_duos_passes'] loop
      if to_regclass('public.' || t) is not null then
        execute format('drop trigger if exists _chaos_rt on public.%I', t);
        execute format('create trigger _chaos_rt after insert or update or delete on public.%I for each row execute function public._chaos_rt_capture()', t);
      end if;
    end loop;
  end $$;
`;

export interface RtChange { tbl: string; op: string; key: string; row: Record<string, unknown> | null }

/** Plain JSON values back from PGlite: Dates as ISO strings and BigInts as numbers (what PostgREST hands supabase-js). */
export function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = plain(x);
    return out;
  }
  return v;
}

/** An argument value as PGlite should bind it: objects (and arrays of objects) as JSON text, the rest as is. */
function bindArg(v: unknown): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.some((x) => x !== null && typeof x === 'object') ? JSON.stringify(v) : v;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export class ChaosServer implements ChaosBackend {
  readonly kind = 'supabase' as const;
  db!: PGlite;
  /** This match's Realtime service (fresh per scenario). */
  bus = new RealtimeBus();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  /** Fake-clock now (ms): the harness hands in `Date.now` (faked). */
  constructor(private readonly now: () => number) {}
  onChanges: (c: RtChange[]) => void = () => undefined;
  readonly resolverChaos: ResolverChaos = { delayMs: 0, fail: 0, conflict: 0 };
  readonly resolverLog: ResolverCall[] = [];
  /** match id -> hold end (ms): calls naming it wait. */
  private holds = new Map<string, number>();
  /** room id -> match id, for holds (a heartbeat names the room). */
  readonly roomOfMatch = new Map<string, string>();
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  migrations: string[] = [];

  async boot(): Promise<void> {
    // The wasm and the filesystem bundle are handed in from disk: under jsdom PGlite would try to fetch() them.
    const dist = join(root, 'node_modules/@electric-sql/pglite/dist');
    const bytes = (f: string): Uint8Array => new Uint8Array(readFileSync(join(dist, f)));
    // Node's Blob / File while PGlite starts (jsdom's have no arrayBuffer(), and initdb hands its data dir over as one).
    const g = globalThis as unknown as { Blob: unknown; File: unknown };
    const saved = { Blob: g.Blob, File: g.File };
    g.Blob = NodeBlob;
    g.File = NodeFile;
    try {
      this.db = await PGlite.create({
        pgliteWasmModule: await WebAssembly.compile(bytes('pglite.wasm') as unknown as BufferSource),
        initdbWasmModule: await WebAssembly.compile(bytes('initdb.wasm') as unknown as BufferSource),
        fsBundle: new NodeBlob([bytes('pglite.data')]),
      } as never);
    } finally {
      g.Blob = saved.Blob;
      g.File = saved.File;
    }
    await this.db.exec("set timezone = 'UTC'");
    await this.db.exec(STUB);
    this.migrations = versusMigrationFiles();
    for (const f of this.migrations) {
      const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8');
      try {
        await this.db.exec(sql);
      } catch (e) {
        throw new Error(`chaos server: migration ${f} failed: ${(e as Error).message}`);
      }
    }
    await this.db.exec('create table if not exists public.versus_test_bots (bot_user uuid primary key, host_user uuid not null, slot int not null, registered_at timestamptz not null default now())');
    await this.db.exec(REALTIME);
  }

  async close(): Promise<void> { await this.db?.close(); }

  /** Is any statement queued or running? (The harness settles until the server is idle.) */
  idle(): boolean { return this.pending === 0; }

  /** Wipe every Versus row between scenarios (the schema stays). */
  async reset(seed = 0.5): Promise<void> {
    await this.serial(async () => {
      // Match and hero seeds come from random(): seeded per scenario, every match replays the same.
      await this.db.query('select setseed($1)', [seed]);
      await this.db.exec(`delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms;
        delete from public._chaos_rt;`);
      for (const t of ['duo_runs', 'duos_rank_results', 'duos_team_ranks', 'duos_teams', 'versus_test_bots', 'versus_housekeeping']) {
        await this.db.exec(`do $$ begin if to_regclass('public.${t}') is not null then execute 'delete from public.${t}'; end if; end $$;`);
      }
    });
    this.resolverLog.length = 0;
    Object.assign(this.resolverChaos, { delayMs: 0, fail: 0, conflict: 0 });
    this.holds.clear();
    this.roomOfMatch.clear();
    this.bus = new RealtimeBus();
    this.onChanges = (c) => this.bus.changes(c);
  }

  // ── the backend seam (chaosBackend.ts) ────────────────────────────────────────────────────────────────────
  onNote: (s: string) => void = () => undefined;
  killRealtime(ms: number): string {
    this.bus.enabled = false;
    if (ms) setTimeout(() => { this.bus.enabled = true; this.onNote('chaos: realtime back'); }, ms);
    return `realtime down${ms ? ` ${ms} ms` : ''}`;
  }
  realtimeUp(): boolean { return this.bus.enabled; }
  listening(user: string, matchId: string): boolean { return this.bus.listening(user, matchId); }
  sweep(): void { this.bus.sweep(); }
  noteRoomMatch(roomId: string, matchId: string): void { this.roomOfMatch.set(roomId, matchId); }
  async currentMatchOf(roomId: string): Promise<string | null> {
    const r = (await this.admin<{ current_match_id: string | null }>('select current_match_id from public.versus_rooms where id = $1', [roomId]))[0];
    return r?.current_match_id ?? null;
  }
  snapshot(matchId: string, group: boolean): Promise<ServerSnap | null> { return snapshot(this, matchId, group); }
  committedVitals(matchId: string, r: number, mode: ChaosMode): Promise<Vitals | null> { return committedVitals(this, matchId, r, mode); }
  committedRounds(matchId: string | null, group: boolean): Promise<number> { return committedRounds(this, matchId, group); }
  serverFights(matchId: string, mode: ChaosMode): Promise<Record<number, string>> { return serverFights(this, matchId, mode); }

  /** Run `fn` alone on the connection, then drain the realtime feed. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = async (): Promise<T> => {
      try {
        return await fn();
      } finally {
        try {
          const r = await this.db.query<{ tbl: string; op: string; key: string; row: Record<string, unknown> | null }>('delete from public._chaos_rt returning tbl, op, key, row');
          if (r.rows.length) this.onChanges(r.rows.map((x) => ({ ...x, row: x.row ? (plain(x.row) as Record<string, unknown>) : null })));
        } catch { /* before boot */ }
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    void p.finally(() => { this.pending--; }).catch(() => undefined);
    return p;
  }

  /** One statement as `user` (null = service role) at the fake clock. Returns every row, plain. */
  query<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.serial(async () => {
      await this.db.exec(`set versus.test_now = '${new Date(this.now()).toISOString()}'`);
      await this.db.exec(user
        ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`
        : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
      try {
        const r = await this.db.query<Record<string, unknown>>(sql, params);
        return r.rows.map((x) => plain(x) as T);
      } finally {
        await this.db.exec('reset role');
      }
    });
  }

  /** Superuser read (the harness's own view of the truth; no RLS, no realtime side effects beyond reads). */
  admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.serial(async () => {
      await this.db.exec(`set versus.test_now = '${new Date(this.now()).toISOString()}'`);
      const r = await this.db.query<Record<string, unknown>>(sql, params);
      return r.rows.map((x) => plain(x) as T);
    });
  }

  /** An RPC with named arguments, as PostgREST calls it: one jsonb value back (or a raised `code`). */
  async rpc(user: string | null, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    await this.waitHold(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`;
    const rows = await this.query<{ v: unknown }>(user, sql, keys.map((k) => bindArg(args[k])));
    return rows[0]?.v ?? null;
  }

  // ── the match row hold (lock contention) ──────────────────────────────────────────────────────────────────
  holdMatch(matchId: string, ms: number): void { this.holds.set(matchId, this.now() + ms); }
  holding(matchId: string): boolean { return (this.holds.get(matchId) ?? 0) > this.now(); }
  private async waitHold(args: Record<string, unknown>): Promise<void> {
    for (;;) {
      const m = (args.p_match as string | undefined) ?? (args.p_room ? this.roomOfMatch.get(args.p_room as string) : undefined)
        ?? (args.matchId as string | undefined);
      const until = m ? this.holds.get(m) : undefined;
      if (until == null || this.now() >= until) return;
      await this.sleep(Math.max(1, until - this.now()));
    }
  }

  // ── the resolver (supabase/functions/versus-resolve, in process) ──────────────────────────────────────────
  async resolve(user: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const action = body.action as ResolverAction;
    const matchId = String(body.matchId ?? '');
    const round = Number.isInteger(body.round) ? (body.round as number) : null;
    const entry: ResolverCall = { at: this.now(), user, action, matchId, round, status: 0, handled: false, committed: false, body: null };
    this.resolverLog.push(entry);
    if (this.resolverChaos.delayMs > 0) await this.sleep(this.resolverChaos.delayMs);
    if (this.resolverChaos.conflict > 0) {
      this.resolverChaos.conflict--;
      return this.finish(entry, 409, { error: 'content_mismatch' });
    }
    if (this.resolverChaos.fail > 0) {
      this.resolverChaos.fail--;
      return this.finish(entry, 500, { error: 'resolver_failed' });
    }
    await this.waitHold({ matchId });
    entry.handled = true;
    try {
      const contentRev = String(body.contentRevision ?? '');
      let res: { status: number; body: Record<string, unknown> };
      if (action === 'finalize') res = await handleVersusFinalize(user, body, contentRev, this.duelStore());
      else if (action === 'finalize_group') res = await handleVersusGroupFinalize(user, body, contentRev, this.groupStore());
      else if (action === 'finalize_duos') res = await handleVersusDuosFinalize(user, body, contentRev, this.duosStore());
      else if (action === 'seat_ranked_duos') res = await handleRankedDuosSeat(user, body, this.seatStore());
      else if (action === 'finalize_ranked_duos') {
        res = await handleRankedDuosFinalize(user, body, contentRev, this.rankedStore());
        if (res.status === 409 && res.body.error === 'not_seated') {
          const seated = await handleRankedDuosSeat(user, { matchId }, this.seatStore());
          if (seated.status !== 200) return this.finish(entry, seated.status, seated.body);
          res = await handleRankedDuosFinalize(user, body, contentRev, this.rankedStore());
        }
      } else res = { status: 400, body: { error: 'unknown_action' } };
      entry.committed = res.status === 200 && action !== 'seat_ranked_duos';
      return this.finish(entry, res.status, res.body);
    } catch (e) {
      return this.finish(entry, 500, { error: 'resolver_failed', detail: (e as Error).message });
    }
  }
  /** Every resolver answer (the runner narrates them). */
  onResolve: (c: ResolverCall) => void = () => undefined;
  private finish(entry: ResolverCall, status: number, body: unknown): { status: number; body: unknown } {
    entry.status = status;
    entry.body = body;
    this.onResolve(entry);
    return { status, body };
  }

  private duelStore(): VersusFinalizeStore {
    return {
      match: async (id) => (await this.admin<any>('select id, phase, round, seed, content_revision, p1_user, p2_user, p1_hero, p2_hero, options, p1_health, p1_armor, p2_health, p2_armor from public.versus_matches where id = $1', [id]))[0] ?? null,
      finalSides: async (matchId, round) => {
        const out: Record<'p1' | 'p2', unknown> = { p1: null, p2: null };
        for (const r of await this.admin<any>('select seat, prepared_side, final, source from public.versus_submissions where match_id = $1 and round = $2', [matchId, round])) {
          if (r.final) out[r.seat as 'p1' | 'p2'] = versusFreshSide(r.prepared_side, r.source);
        }
        return out;
      },
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      commit: (a) => this.rpc(null, 'versus_commit_round', a as Record<string, unknown>),
      log: () => undefined,
    } as VersusFinalizeStore;
  }
  private groupSides = async (matchId: string, round: number): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    for (const r of await this.admin<any>('select seat, prepared_side, final, source from public.versus_group_submissions where match_id = $1 and round = $2', [matchId, round])) {
      if (r.final) out[r.seat] = versusFreshSide(r.prepared_side, r.source);
    }
    return out;
  };
  private groupStore(): VersusGroupFinalizeStore {
    return {
      match: async (id: string) => (await this.admin<any>('select id, phase, round, seed, content_revision, options from public.versus_group_matches where id = $1', [id]))[0] ?? null,
      seats: (id: string) => this.admin<any>('select seat, eliminated_round, hero, health, armor from public.versus_group_seats where match_id = $1', [id]),
      finalSides: this.groupSides,
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      commit: (a: Record<string, unknown>) => this.rpc(null, 'versus_group_commit_round', a),
      log: () => undefined,
    } as unknown as VersusGroupFinalizeStore;
  }
  private duosStore(): VersusDuosFinalizeStore {
    return {
      match: async (id: string) => (await this.admin<any>('select id, phase, round, seed, content_revision, options from public.versus_group_matches where id = $1', [id]))[0] ?? null,
      finalSides: this.groupSides,
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      commit: (a: Record<string, unknown>) => this.rpc(null, 'versus_duos_commit_round', a),
      seats: (id: string) => this.admin<any>('select seat, hero from public.versus_group_seats where match_id = $1', [id]),
      teams: (id: string) => this.admin<any>('select team, health, armor from public.versus_group_teams where match_id = $1', [id]),
      log: () => undefined,
    } as unknown as VersusDuosFinalizeStore;
  }
  private seatStore(): RankedDuosSeatStore {
    return {
      match: async (id: string) => (await this.admin<any>('select id, phase, seed, set_id, options, ranked_team, seated_at from public.versus_group_matches where id = $1', [id]))[0] ?? null,
      liveHeroes: async (id: string) => (await this.admin<any>("select seat, hero from public.versus_group_seats where match_id = $1 and seat in ('p1', 'p2') order by seat", [id])).map((r) => r.hero),
      teamDivision: async () => 0,
      // No recorded pool in the harness: the table is seated from generated teams (unrated), deterministic per seed.
      soloSample: async () => [],
      duoSample: async () => [],
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      commit: (a: Record<string, unknown>) => this.rpc(null, 'versus_ranked_duos_seat', a),
      log: () => undefined,
    } as unknown as RankedDuosSeatStore;
  }
  private rankedStore(): RankedDuosFinalizeStore {
    return {
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      input: (matchId: string, round: number) => this.rpc(null, 'versus_ranked_duos_round_input', { p_match: matchId, p_round: round }),
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      commit: (a: Record<string, unknown>) => this.rpc(null, 'versus_ranked_duos_commit_round', a),
      log: () => undefined,
    } as unknown as RankedDuosFinalizeStore;
  }
}

// ── the harness's reads (moved here from chaosMatch.ts unchanged: the SQL is this backend's) ─────────────────────

async function snapshot(server: ChaosServer, matchId: string, group: boolean): Promise<ServerSnap | null> {
  const t = Date.now();
  const ms = (x: unknown): number | null => (x == null ? null : Date.parse(String(x)));
  if (!group) {
    const m = (await server.admin<any>('select * from public.versus_matches where id = $1', [matchId]))[0];
    if (!m) return null;
    return {
      t, phase: m.phase, round: m.round, revision: m.revision, shopDeadline: ms(m.shop_deadline), pausedSeat: m.paused_seat, pausedAt: m.paused_at, resumeAt: m.resume_at ?? null,
      seats: (['p1', 'p2'] as const).map((p) => ({
        seat: p, user: m[`${p}_user`], name: m[`${p}_name`], locked: !!m[`${p}_locked`], lockedAt: null, health: m[`${p}_health`], armor: m[`${p}_armor`],
        placement: m.phase === 'complete' ? (m.winner_seat === p ? 1 : 2) : null, eliminated: null, team: null, auto: !!m[`${p}_auto`],
      })),
      teams: [],
    };
  }
  const m = (await server.admin<any>('select * from public.versus_group_matches where id = $1', [matchId]))[0];
  if (!m) return null;
  const seats = await server.admin<any>('select * from public.versus_group_seats where match_id = $1 order by seat', [matchId]);
  const teams = await server.admin<any>('select * from public.versus_group_teams where match_id = $1 order by team', [matchId]);
  return {
    t, phase: m.phase, round: m.round, revision: m.revision, shopDeadline: ms(m.shop_deadline), pausedSeat: m.paused_seat, pausedAt: m.paused_at, resumeAt: m.resume_at ?? null,
    seats: seats.map((x) => ({
      seat: x.seat, user: x.user_id, name: x.name, locked: !!x.locked, lockedAt: ms(x.locked_at), health: x.health, armor: x.armor, placement: x.placement,
      eliminated: x.eliminated_round, team: x.team ?? null, auto: !!x.auto,
    })),
    teams: teams.map((x) => ({ team: x.team, health: x.health ?? null, armor: x.armor ?? null, placement: x.placement, eliminated: x.eliminated_round })),
  };
}

/** Every seat's pools after round `r`, keyed by the seat's NAME (the rail's label), or null before it is committed. */
async function committedVitals(server: ChaosServer, matchId: string, r: number, mode: ChaosMode): Promise<Vitals | null> {
  if (mode === 'duel') {
    const row = (await server.admin<any>('select * from public.versus_rounds where match_id = $1 and round = $2', [matchId, r]))[0];
    const m = (await server.admin<any>('select p1_name, p2_name from public.versus_matches where id = $1', [matchId]))[0];
    if (!row || !m || row.p1_health == null) return null;
    return { [m.p1_name]: { health: row.p1_health, armor: row.p1_armor }, [m.p2_name]: { health: row.p2_health, armor: row.p2_armor } };
  }
  const row = (await server.admin<any>('select vitals from public.versus_group_rounds where match_id = $1 and round = $2', [matchId, r]))[0];
  if (!row?.vitals) return null;
  const seats = await server.admin<any>('select seat, name, team from public.versus_group_seats where match_id = $1', [matchId]);
  const out: Record<string, { health: number; armor: number }> = {};
  for (const s of seats) {
    const v = (mode === 'duos' || mode === 'ranked_duos') ? row.vitals[s.team] ?? row.vitals[s.seat] : row.vitals[s.seat];
    if (v) out[s.name] = { health: v.health, armor: v.armor };
  }
  return out;
}

async function committedRounds(server: ChaosServer, matchId: string | null, group: boolean): Promise<number> {
  if (!matchId) return 0;
  const r = await server.admin<{ n: number }>(`select count(*)::int n from public.${group ? 'versus_group_rounds' : 'versus_rounds'} where match_id = $1`, [matchId]);
  return r[0]?.n ?? 0;
}

/** The server's fights, one canonical line per round. */
async function serverFights(server: ChaosServer, matchId: string, mode: ChaosMode): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (mode === 'duel') {
    for (const r of await server.admin<any>('select round, outcome, digest from public.versus_rounds where match_id = $1', [matchId])) out[r.round] = `${r.outcome}:${r.digest}`;
    return out;
  }
  if (mode === 'ranked_duos') {
    const rows = await server.admin<any>('select round, fight, a_team, b_team, outcome, damage from public.versus_ranked_duos_fights where match_id = $1 order by round, fight', [matchId]);
    for (const f of rows) out[f.round] = `${out[f.round] ? `${out[f.round]} ` : ''}${f.a_team}-${f.b_team}:${f.outcome}:${f.damage}`;
    return out;
  }
  const rows = await server.admin<any>('select round, fight, a_seat, b_seat, outcome, damage from public.versus_group_fights where match_id = $1 order by round, fight', [matchId]);
  for (const f of rows) out[f.round] = `${out[f.round] ? `${out[f.round]} ` : ''}${f.a_seat}-${f.b_seat}:${f.outcome}:${f.damage}`;
  return out;
}
