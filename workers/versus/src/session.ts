/**
 * THE GAME SESSION ON CLOUDFLARE (R-SESSION-CF-01; owner 2026-10-31: "Is it possible to just have ranked solos run on
 * cloudflare too so that we aren't read writing in real time? Can we offload that to cloudflare" → "Do it").
 *
 * One Durable Object per lobby / Practice game, on the stable friends hub Worker (`ascent-hub`). Why the hub and not the
 * Versus Worker: the Versus Workers are one per content revision and are deleted once nothing plays on them; a session
 * owes Supabase writes until its flush lands, so it must live where a pack never retires it. Nothing in a session needs
 * the engine (the client still seats the table and plays the game; the session serves the pool, keeps what the game
 * writes, and settles), so the engine-free hub is the right home. It already holds the writer key, the origin list, the
 * deploy-on-change and the Live Games directory (in the same Worker: the listing is written straight to it).
 *
 * It is the game's LIVE HOST (`liveHost.ts`: spectating, the listing, lobby chat, pings and mentor, the watch record;
 * `live_host = 'session'`) and the game's SESSION (`core/sessionCore.ts`): the cloud save, the pinned table, the run-end
 * writes and the rating, flushed to Supabase through `session_cf_flush` (supabase/migrations/2026-11-20-game-session-cf.sql)
 * when they are due, never per round.
 *
 * HTTP (the hub routes `/session/<game>/<op>` here with the verified caller in headers): save, park, table, write, rate,
 * clear (the player), seats (any signed-in watcher: the table's seat recordings), state (the player; DEV: anyone).
 */
import { newLiveMeta, type LiveCore, type LiveMeta, type LobbyListing } from './core/liveCore';
import { SessionCore, SessionError, newSessionMeta, type FlushAnswer, type FlushPlan, type SessionMeta } from './core/sessionCore';
import { HubLobbySink } from './liveDirSink';
import type { LiveDirectory } from './liveDirectory';
import { LIVE_GAME_HEADER, LIVE_USER_HEADER, LiveGameHost, type LiveHostEnv, type PublisherHello } from './liveHost';
import type { LiveSink } from './live';
import { GUEST_HEADER } from './lobbyChat';
import { spectateSinkFor, type SpectateSink } from './spectate';
import {
  SESSION_LIVE_HOST, SESSION_MAX_SAVE_CHARS, SESSION_MAX_WRITE_CHARS, SESSION_PROTOCOL,
  type SessionClearBody, type SessionRateBody, type SessionSaveBody, type SessionState, type SessionTableBody, type SessionWriteBody,
} from './sessionProtocol';
import type { HubStoreEnv } from './dmStore';
import { RANK_RULES_VERSION, resolveRankOutcome, sameRankOutcome, strengthBonusOf } from '../../../supabase/functions/_shared/lobbyRating';

export const SESSION_OP_HEADER = 'X-Session-Op';

export interface SessionEnv extends LiveHostEnv, HubStoreEnv {
  LIVE_DIR: DurableObjectNamespace<LiveDirectory>;
}

/** Where a flush goes (Supabase in production; a recorder in the tests and with persistence off). */
export interface FlushSink {
  readonly live: boolean;
  flush(args: FlushArgs): Promise<FlushAnswer>;
}

export interface FlushArgs {
  p_user: string;
  p_guest: boolean;
  p_game: string;
  p_writes: { key: string; table: string; conflict?: string; rows: Record<string, unknown>[] }[] | null;
  p_save: { run_key: string; expected: number; device: string; payload: unknown } | null;
  p_clear: { run_key: string; expected: number } | null;
  p_rating: Record<string, unknown> | null;
}

export class SupabaseFlushSink implements FlushSink {
  readonly live = true;
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}
  async flush(args: FlushArgs): Promise<FlushAnswer> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/session_cf_flush`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, ...args }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`session_cf_flush ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as FlushAnswer;
  }
}

/**
 * Persistence off (local dev, the tests): every flush is recorded and answered as Supabase would, from a tiny in-memory
 * model of the save row and the rank ledger (so the tests can check idempotency end to end through the real object).
 */
export class LocalFlushSink implements FlushSink {
  readonly live = false;
  readonly calls: FlushArgs[] = [];
  readonly applied = new Map<string, number>();
  private row: { run_key: string; revision: number } | null = null;
  private ranked = new Map<string, unknown>();
  failNext = 0;
  async flush(a: FlushArgs): Promise<FlushAnswer> {
    if (this.failNext > 0) { this.failNext -= 1; throw new Error('local flush failure (test)'); }
    this.calls.push(JSON.parse(JSON.stringify(a)) as FlushArgs);
    if (this.calls.length > 200) this.calls.shift();
    const writes = (a.p_writes ?? []).map((w) => {
      const dup = this.applied.has(`${a.p_user}|${w.key}`);
      if (!dup) this.applied.set(`${a.p_user}|${w.key}`, w.rows.length);
      return { key: w.key, status: dup ? 'duplicate' : 'applied' };
    });
    let save: FlushAnswer['save'] = null;
    if (a.p_save) {
      if (a.p_guest) save = { status: 'refused' };
      else if (!this.row || (a.p_save.expected === 0 && this.row.run_key !== a.p_save.run_key) || (this.row.run_key === a.p_save.run_key && this.row.revision === a.p_save.expected)) {
        this.row = { run_key: a.p_save.run_key, revision: (this.row && this.row.run_key === a.p_save.run_key ? this.row.revision : 0) + 1 };
        save = { status: 'ok', revision: this.row.revision };
      } else save = { status: 'conflict', current: { run_key: this.row.run_key, revision: this.row.revision, device_id: 'other', updated_at: new Date(0).toISOString() } };
    }
    let clear: FlushAnswer['clear'] = null;
    if (a.p_clear) {
      const hit = this.row && this.row.run_key === a.p_clear.run_key && this.row.revision === a.p_clear.expected;
      if (hit) this.row = null;
      clear = { status: hit ? 'ok' : 'conflict' };
    }
    let rating: unknown = null;
    if (a.p_rating) {
      const k = `${a.p_user}|${String(a.p_rating.run_id)}`;
      const first = !this.ranked.has(k);
      const before = { divisionIndex: 3, points: 20, demotionReady: false };
      const placement = Number(a.p_rating.placement);
      const out = resolveRankOutcome(before, placement, 0);
      const result = { ...out, lobbyStrength: null };
      if (first) this.ranked.set(k, result);
      rating = { status: first ? 'confirmed' : 'deduped', result: this.ranked.get(k), profile: { position: out.after } };
    }
    return { writes, save, clear, rating };
  }
  /** The model's save row (tests). */
  savedRow(): { run_key: string; revision: number } | null { return this.row; }
}

export const flushSinkFor = (env: HubStoreEnv): FlushSink =>
  env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.HUB_WRITER_SECRET
    ? new SupabaseFlushSink(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.HUB_WRITER_SECRET)
    : new LocalFlushSink();

/** `raise exception '<code>'` inside `settle_rank` → the status `submit-rating` answers for it. */
const SQL_ERROR_STATUS: Record<string, number> = { bad_placement: 400, bad_run_id: 400, unsupported_season: 409, unsupported_rules: 409, rate_limited: 429 };

/** `settle_rank`'s jsonb → `submit-rating`'s answer (status, result, profile, rating scalar, the TS parity check). */
export function rateAnswerOf(settled: unknown): { status: number; body: unknown } {
  const out = settled as { status?: string; result?: Record<string, unknown>; profile?: Record<string, unknown>; error?: string } | null;
  if (out && typeof out.error === 'string') {
    const code = Object.keys(SQL_ERROR_STATUS).find((k) => out.error!.includes(k));
    return code ? { status: SQL_ERROR_STATUS[code]!, body: { error: code } } : { status: 500, body: { error: 'settle_failed' } };
  }
  if (!out || !out.result || !out.profile) return { status: 500, body: { error: 'settle_malformed' } };
  let parity = true;
  try {
    const r = out.result as never as Parameters<typeof sameRankOutcome>[1] & { lobbyStrength?: number | null; strengthBonus?: number };
    const bonus = typeof r.lobbyStrength === 'number' ? strengthBonusOf(r.lobbyStrength, r.placement) : (r.strengthBonus ?? 0);
    const expected = resolveRankOutcome(r.before, r.placement, bonus);
    parity = sameRankOutcome(expected, { ...r, strengthBonus: r.strengthBonus ?? 0, promotionKind: r.promotionKind ?? null, requiredFinish: r.requiredFinish ?? null, wasDemotionGame: r.wasDemotionGame === true, demotionUnlocked: r.demotionUnlocked === true });
    if (!parity) console.error(JSON.stringify({ ev: 'session_rank_parity_mismatch', sql: out.result, ts: expected }));
  } catch (e) {
    parity = false;
    console.error('session rank parity check threw', e);
  }
  const position = (out.profile as { position?: { divisionIndex: number; points: number } }).position;
  return {
    status: 200,
    body: {
      status: 'confirmed', deduped: out.status === 'deduped', result: out.result, profile: out.profile,
      rating: position ? 100 * position.divisionIndex + position.points : null, parity, via: 'session',
    },
  };
}

const SESSION_KEY = 'session';
const SAVE_KEY = 'save:payload';
const SEATS_KEY = 'seats';
const WRITE_PREFIX = 'w:';

export class GameSession extends LiveGameHost<SessionEnv> {
  private session: SessionCore | null = null;
  private sessionLoaded = false;
  private flushSink: FlushSink;
  private flushing: Promise<void> | null = null;
  private guest = false;
  readonly counters = { saves: 0, writes: 0, flushes: 0, flushFailures: 0, rates: 0 };

  constructor(ctx: DurableObjectState, env: SessionEnv) {
    super(ctx, env);
    this.flushSink = flushSinkFor(env);
  }

  /** Tests: the flush sink (to fail it, or read what was flushed). */
  flushSinkForTests(): FlushSink { return this.flushSink; }

  // ── The live host's hooks ──────────────────────────────────────────────────────────────────────────────────────

  protected makeRowSink(env: SessionEnv): LiveSink<LobbyListing> {
    const dir = env.LIVE_DIR.get(env.LIVE_DIR.idFromName('global')) as unknown as LiveDirectory;
    return new HubLobbySink({ put: (row) => dir.put(row), remove: (ids) => dir.remove(ids) });
  }

  protected makeBeatSink(env: SessionEnv): SpectateSink {
    // The hub's writer secret: its sha256 is a row of versus_cf_writer_keys, which `spectate_cf_beat` checks.
    return spectateSinkFor({ PERSIST: env.PERSIST, SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, VERSUS_WRITER_SECRET: env.HUB_WRITER_SECRET });
  }

  protected newMeta(gameId: string, now: number): LiveMeta {
    return { ...newLiveMeta(gameId, '', now), host: SESSION_LIVE_HOST };
  }

  /** Any build may publish here (the hub carries no engine; watchers render the projections they are sent). The
   *  publisher's revision is kept for the record. */
  protected acceptsPublisher(core: LiveCore, hello: PublisherHello): boolean {
    if (typeof hello.contentRevision === 'string') core.meta.contentRevision = hello.contentRevision.slice(0, 80);
    return true;
  }

  protected override keepsState(): boolean {
    return !!this.session && !this.session.forgettable(Date.now());
  }

  protected override forget(): void {
    this.session = null;
    this.sessionLoaded = false;
  }

  protected override extraDue(now: number): number | null {
    return this.session?.nextAt(now, this.publisherHere(), this.quietSince()) ?? null;
  }

  protected override async onAlarm(now: number): Promise<void> {
    const s = await this.loadSession(null);
    if (!s) return;
    await this.flush(now, false).catch(() => undefined);
    if (s.forgettable(now) && this.liveSockets().length === 0 && (!this.core || this.core.meta.end)) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.session = null;
      this.sessionLoaded = false;
    }
  }

  private publisherHere(): boolean { return !!this.core?.publisherHere; }
  private quietSince(): number | null { return this.core?.meta.publisherGoneAt ?? null; }

  // ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async loadSession(gameId: string | null): Promise<SessionCore | null> {
    if (this.sessionLoaded && this.session) return this.session;
    const meta = await this.ctx.storage.get<SessionMeta>(SESSION_KEY);
    this.sessionLoaded = true;
    if (!meta && !gameId) return null;
    this.session = new SessionCore(meta ?? newSessionMeta(gameId!, Date.now()));
    if (!this.core) await this.load(null);
    return this.session;
  }

  private async saveSession(): Promise<void> {
    if (this.session) await this.ctx.storage.put(SESSION_KEY, this.session.meta);
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────────────────────────────────────────

  protected override async onHttp(req: Request): Promise<Response | null> {
    const op = req.headers.get(SESSION_OP_HEADER);
    const userId = req.headers.get(LIVE_USER_HEADER);
    const gameId = req.headers.get(LIVE_GAME_HEADER);
    if (!op || !gameId) return null;
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (op === 'metrics') return json(200, await this.state(gameId, true));
    if (!userId) return json(401, { error: 'not_signed_in' });
    const now = Date.now();
    try {
      if (op === 'seats') {
        // A watcher's seat recordings (the table's runs, R-SPECTATE-SEATS-01): the boards the watched game's seats field.
        const seats = await this.ctx.storage.get<{ seatRuns?: unknown[][] }>(SEATS_KEY);
        return json(200, { boards: (seats?.seatRuns ?? []).flat() });
      }
      if (op === 'state') {
        const st = await this.state(gameId, false);
        if (st.owner && st.owner !== userId && this.env.DEV_AUTH !== '1') return json(403, { error: 'not_owner' });
        return json(200, st);
      }
      if (req.method !== 'POST') return json(405, { error: 'bad_method' });
      const text = await req.text();
      if (text.length > SESSION_MAX_SAVE_CHARS + 4096) return json(413, { error: 'too_big' });
      let body: Record<string, unknown>;
      try { body = JSON.parse(text) as Record<string, unknown>; } catch { return json(400, { error: 'bad_body' }); }
      if (body.protocol !== SESSION_PROTOCOL) return json(409, { error: 'version_mismatch', expected: SESSION_PROTOCOL });
      // A production hub whose writes cannot land (deployed without persistence) takes nothing: the client then writes the
      // old way at once (every session call falls back on a non-200), so nothing is held where it would be lost.
      if (!this.flushSink.live && this.env.DEV_AUTH !== '1') return json(503, { error: 'session_off' });
      const s = (await this.loadSession(gameId))!;
      this.guest = req.headers.get(GUEST_HEADER) === '1';
      const res = await this.op(op, s, userId, body, now);
      await this.rearm();
      return json(res.status, res.body);
    } catch (e) {
      if (e instanceof SessionError) return json(e.status, { error: e.code });
      console.error('session op failed', op, e);
      return json(500, { error: 'server_error' });
    }
  }

  private async op(op: string, s: SessionCore, userId: string, body: Record<string, unknown>, now: number): Promise<{ status: number; body: unknown }> {
    switch (op) {
      case 'save': {
        const b = body as unknown as SessionSaveBody;
        if (typeof b.runKey !== 'string' || !b.runKey || b.runKey.length > 128 || typeof b.save !== 'string') throw new SessionError('bad_arguments');
        if (b.save.length > SESSION_MAX_SAVE_CHARS) throw new SessionError('too_big', 413);
        let revision: number;
        try { revision = s.save(userId, b.runKey, Number(b.expected), String(b.deviceId ?? ''), now); } catch (e) {
          if (e instanceof SessionError && e.code === 'conflict') return { status: 200, body: { status: 'conflict', current: s.meta.moved } };
          throw e;
        }
        this.counters.saves += 1;
        if (Array.isArray(b.seatRuns) || Array.isArray(b.seatHybrids)) await this.ctx.storage.put(SEATS_KEY, { seatRuns: b.seatRuns ?? [], seatHybrids: b.seatHybrids ?? [] });
        await this.ctx.storage.put(SAVE_KEY, b.save);
        await this.saveSession();
        const seats = !!(await this.ctx.storage.get(SEATS_KEY));
        return { status: 200, body: { status: 'ok', revision, seats } };
      }
      case 'park': {
        s.park(userId, now);
        await this.saveSession();
        await this.flush(now, false).catch(() => undefined);
        return { status: 200, body: { ok: true, saved: !s.meta.save?.dirty } };
      }
      case 'table': {
        const b = body as unknown as SessionTableBody & { seatRuns?: unknown[]; seatHybrids?: unknown[] };
        s.table(userId, b.mode, b.seatKeys, now);
        if ((Array.isArray(b.seatRuns) || Array.isArray(b.seatHybrids)) && JSON.stringify(b.seatRuns ?? []).length <= SESSION_MAX_SAVE_CHARS) {
          await this.ctx.storage.put(SEATS_KEY, { seatRuns: b.seatRuns ?? [], seatHybrids: b.seatHybrids ?? [] });
        }
        await this.saveSession();
        return { status: 200, body: { ok: true, seatKeys: s.meta.seatKeys?.length ?? 0 } };
      }
      case 'write': {
        const item = (body as unknown as SessionWriteBody).item ?? ({} as SessionWriteBody['item']);
        if (JSON.stringify(item.rows ?? null).length > SESSION_MAX_WRITE_CHARS) throw new SessionError('too_big', 413);
        const held = s.write(userId, item, now);
        if (held) {
          await this.ctx.storage.put(WRITE_PREFIX + held.key, item.rows);
          this.counters.writes += 1;
        }
        await this.saveSession();
        return { status: 200, body: { ok: true, held: !!held } };
      }
      case 'clear': {
        const b = body as unknown as SessionClearBody;
        if (typeof b.runKey !== 'string' || !b.runKey) throw new SessionError('bad_arguments');
        s.clearSave(userId, b.runKey, Number(b.expected), now);
        await this.saveSession();
        return { status: 200, body: { status: 'ok' } };
      }
      case 'rate': {
        this.counters.rates += 1;
        const r = s.rate(userId, (body as unknown as SessionRateBody).req, now);
        await this.saveSession();
        if (r.kind === 'answer') return { status: r.status, body: r.body };
        // The settle rides a flush NOW, with every write held so far (they go first, in the same transaction).
        let answer: unknown = null;
        try {
          answer = await this.flushNow(now, { run_id: r.args.p_run_id, placement: r.args.p_placement, season: r.args.p_season, rules_version: r.args.p_rules_version, seed: r.args.p_seed, seat_keys: r.args.p_seat_keys });
        } catch {
          return { status: 503, body: { error: 'settle_failed' } };
        }
        const out = rateAnswerOf(answer);
        if (out.status === 200) { s.meta.rating = { runId: r.args.p_run_id, answer: out.body }; await this.saveSession(); }
        return out;
      }
      default:
        return { status: 404, body: { error: 'bad_op' } };
    }
  }

  // ── The flush ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Flush what is due (the alarm, a park). One at a time. */
  private async flush(now: number, _forced: boolean): Promise<void> {
    if (this.flushing) { await this.flushing.catch(() => undefined); return; }
    const s = this.session;
    if (!s || !s.meta.owner || !s.canFlush(now)) return;
    const plan = s.plan(now, this.publisherHere(), this.quietSince(), s.writesDue(now));
    if (!plan) return;
    await this.runFlush(s, plan, null, now).catch(() => undefined);
  }

  /** Flush everything held right now, with the rating. Answers `settle_rank`'s result (throws when the call failed). */
  private async flushNow(now: number, rating: Record<string, unknown>): Promise<unknown> {
    if (this.flushing) await this.flushing.catch(() => undefined);
    const s = this.session!;
    const plan: FlushPlan = s.plan(now, this.publisherHere(), this.quietSince(), true) ?? { writeKeys: [], save: false, clear: null };
    const a = await this.runFlush(s, plan, rating, now);
    return a.rating;
  }

  private async runFlush(s: SessionCore, plan: FlushPlan, rating: Record<string, unknown> | null, now: number): Promise<FlushAnswer> {
    const m = s.meta;
    const run = (async (): Promise<FlushAnswer> => {
      const writes: FlushArgs['p_writes'] = [];
      for (const key of plan.writeKeys) {
        const w = m.writes.find((x) => x.key === key);
        const rows = await this.ctx.storage.get<Record<string, unknown>[]>(WRITE_PREFIX + key);
        if (w && rows) writes.push({ key, table: w.table, ...(w.conflict ? { conflict: w.conflict } : {}), rows });
      }
      let save: FlushArgs['p_save'] = null;
      if (plan.save && m.save) {
        const raw = await this.ctx.storage.get<string>(SAVE_KEY);
        const seats = await this.ctx.storage.get<{ seatRuns?: unknown[]; seatHybrids?: unknown[] }>(SEATS_KEY);
        if (raw != null) {
          save = {
            run_key: m.save.runKey, expected: m.save.base, device: m.save.deviceId,
            payload: { v: 1, save: raw, ...(seats?.seatRuns?.length ? { seatRuns: seats.seatRuns } : {}), ...(seats?.seatHybrids?.length ? { seatHybrids: seats.seatHybrids } : {}) },
          };
        }
      }
      const clear = plan.clear
        ? { run_key: plan.clear.runKey, expected: m.save && m.save.runKey === plan.clear.runKey ? Math.max(m.save.base, plan.clear.expected) : plan.clear.expected }
        : null;
      this.counters.flushes += 1;
      let answer: FlushAnswer;
      try {
        answer = await this.flushSink.flush({ p_user: m.owner!, p_guest: this.guest, p_game: m.gameId, p_writes: writes.length ? writes : null, p_save: save, p_clear: clear, p_rating: rating });
      } catch (e) {
        this.counters.flushFailures += 1;
        s.failed(String(e), now);
        await this.saveSession();
        this.log({ ev: 'session_flush_failed', attempt: m.flush.attempt, error: String(e).slice(0, 200) });
        throw e;
      }
      for (const w of answer.writes ?? []) if (w.status === 'rejected') this.log({ ev: 'session_write_rejected', key: w.key });
      s.flushed(plan, answer, now);
      if (plan.writeKeys.length) await this.ctx.storage.delete(plan.writeKeys.map((k) => WRITE_PREFIX + k));
      if (plan.clear) await this.ctx.storage.delete([SAVE_KEY]);
      await this.saveSession();
      this.log({ ev: 'session_flushed', writes: plan.writeKeys.length, save: !!save, clear: !!clear, rating: !!rating });
      return answer;
    })();
    const done = run.then(() => undefined, () => undefined);
    this.flushing = done;
    try { return await run; } finally { if (this.flushing === done) this.flushing = null; }
  }

  private async state(gameId: string, dev: boolean): Promise<SessionState & { [k: string]: unknown }> {
    const s = await this.loadSession(null);
    const m = s?.meta;
    const base: SessionState = {
      gameId, owner: m?.owner ?? null, finished: m?.finishedAt != null, writes: m?.writes.length ?? 0, flushed: m?.flushedKeys.length ?? 0,
      pendingFlush: !!s && !s.settled(), save: m?.save ? { runKey: m.save.runKey, revision: m.save.base, dirty: m.save.dirty } : null, rated: !!m?.rating,
    };
    if (!dev) return { ...base };
    const sink = this.flushSink as Partial<LocalFlushSink>;
    return { ...base, counters: this.counters, meta: m ?? null, flushCalls: sink.calls ?? null, savedRow: sink.savedRow?.() ?? null, rulesVersion: RANK_RULES_VERSION };
  }
}
