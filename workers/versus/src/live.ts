/**
 * VERSUS ON CLOUDFLARE — the room's LIVE GAMES row (R-VERSUS-CF-LIVE-01; what is listed: `core/liveListing.ts`). Since
 * R-LIVE-DIR-01 the row goes to the friends hub's live directory (`liveDirSink.ts`), and to Supabase only until the
 * retire migration.
 *
 * One "latest wins" slot, not a queue: only the newest listing matters, so a run of changes while Supabase is slow
 * collapses into one write, and the removal at the end can never be overtaken by an older upsert. A write is due when
 * the listing's key changes, or `LIVE_REFRESH_MS` after the last one while a row is up; a failed write retries with the
 * persistence backoff. The writer is the limited RPC `versus_cf_live` (same writer secret and publishable key as
 * `versus_cf_persist`), never the service role.
 *
 * The last key the room PUBLISHED is kept in the object's storage (`live`), so a room woken from hibernation neither
 * re-sends an unchanged row nor sends a removal for a row it never wrote (a 1v1 room never writes at all).
 */
import { LIVE_REFRESH_MS, liveKeyOf, type LiveListing } from './core/liveListing';
import { HubRoomSink, liveDirOf, TeeLiveSink, type LiveDirWriterEnv } from './liveDirSink';
import { persistBackoffMs, type PersistEnv } from './persist';

export interface LiveSink<R = LiveListing> {
  readonly live: boolean;
  /** Upsert the room's row, or remove it (`row` null). */
  write(roomId: string, row: R | null): Promise<void>;
}

/** Persistence off (local dev, tests): nothing leaves the Worker; the writes are kept for tests. */
export class LocalLiveSink<R = LiveListing> implements LiveSink<R> {
  readonly live = false;
  readonly written: { roomId: string; row: R | null }[] = [];
  async write(roomId: string, row: R | null): Promise<void> {
    this.written.push({ roomId, row });
    if (this.written.length > 200) this.written.shift();
  }
}

/**
 * A key-gated Supabase listing writer (`versus_cf_live` for a room, `lobby_live_cf` for a live lobby game). Since the
 * hub directory took the list over (R-LIVE-DIR-01) this only feeds clients from before it. Once the retire migration
 * (`2026-11-19-retire-supabase-live-list.sql`) is applied the function answers `{ retired: true }` and writes nothing:
 * the writer then stops for the object's life (no call per keep-alive into a retired function).
 */
export class SupabaseRowSink<R> implements LiveSink<R> {
  readonly live = true;
  /** The server said the Supabase listing is retired: every later write is skipped. */
  retired = false;
  constructor(
    private readonly url: string,
    private readonly anonKey: string,
    private readonly secret: string,
    private readonly fn: 'versus_cf_live' | 'lobby_live_cf',
  ) {}

  async write(id: string, row: R | null): Promise<void> {
    if (this.retired) return;
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/${this.fn}`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(this.fn === 'versus_cf_live' ? { p_key: this.secret, p_room: id, p_row: row } : { p_key: this.secret, p_game: id, p_row: row }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${this.fn} ${res.status}: ${text.slice(0, 200)}`);
    if (isRetired(text)) this.retired = true;
  }
}

/** Did a Supabase listing writer answer that it is retired? */
export function isRetired(body: string): boolean {
  try { return (JSON.parse(body) as { retired?: unknown } | null)?.retired === true; } catch { return false; }
}

/** The Supabase half (or the local log, persistence off). */
export function supabaseRowSinkFor<R>(env: PersistEnv, fn: 'versus_cf_live' | 'lobby_live_cf'): LiveSink<R> {
  if (env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.VERSUS_WRITER_SECRET) {
    return new SupabaseRowSink<R>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.VERSUS_WRITER_SECRET, fn);
  }
  return new LocalLiveSink<R>();
}

/** A room's listing writer: the hub directory (R-LIVE-DIR-01) and, until the retire migration, the Supabase row. */
export function liveSinkFor(env: PersistEnv & LiveDirWriterEnv): LiveSink {
  const sb = supabaseRowSinkFor<LiveListing>(env, 'versus_cf_live');
  const dir = liveDirOf(env);
  return dir ? new TeeLiveSink(sb, new HubRoomSink(dir)) : sb;
}

/** The storage value: the key of the row the room last published (absent = nothing published). */
export const LIVE_STORAGE_KEY = 'live';
/** Failed writes in a row after which a CLOSED room stops waiting for its removal (see `pending`). */
export const LIVE_GIVE_UP_AFTER = 5;

/** One listing slot. Generic over the row (a room's `LiveListing`, a live lobby game's `LobbyListing`, R-LIVE-CF-01). */
export class LiveSlot<R = LiveListing> {
  private wantRow: R | null = null;
  private wantKey = 'none';
  private sentKey: string;
  private sentAt = 0;
  private retryAt: number | null = null;
  private attempt = 0;
  private inflight: Promise<void> | null = null;

  /** `published`: the key restored from storage after a wake (null = nothing is up). */
  constructor(
    private readonly sink: LiveSink<R>,
    private readonly roomId: () => string | null,
    private readonly store: (key: string | null) => Promise<void>,
    published: string | null = null,
    now = 0,
    private readonly keyOf: (row: R | null) => string = liveKeyOf as unknown as (row: R | null) => string,
  ) {
    this.sentKey = published ?? 'none';
    this.wantKey = this.sentKey;
    // A restored row counts as freshly written: the keep-alive picks it up after one refresh period at most.
    this.sentAt = now;
  }

  /** Set the listing the room wants up now. */
  want(row: R | null): void {
    this.wantRow = row;
    this.wantKey = this.keyOf(row);
  }

  /** Is a write due at `now`? */
  due(now: number): boolean {
    if (this.inflight) return false;
    if (this.retryAt != null) return now >= this.retryAt;
    if (this.wantKey !== this.sentKey) return true;
    return this.wantKey !== 'none' && now - this.sentAt >= LIVE_REFRESH_MS;
  }

  /** When the alarm should next look at the slot (null: nothing to do until the listing changes). */
  nextAt(now: number): number | null {
    if (this.inflight) return null;
    if (this.retryAt != null) return this.retryAt;
    if (this.wantKey !== this.sentKey) return now;
    return this.wantKey !== 'none' ? this.sentAt + LIVE_REFRESH_MS : null;
  }

  /** A write is running or owed (the room must not forget itself before the row is gone). After
   *  `LIVE_GIVE_UP_AFTER` failed tries in a row it stops holding the room: the SQL hides a silent row within 4 minutes. */
  pending(): boolean {
    if (this.attempt >= LIVE_GIVE_UP_AFTER && !this.inflight) return false;
    return !!this.inflight || this.wantKey !== this.sentKey;
  }

  /** Write the wanted row if one is due. Never throws: a failure schedules a retry. */
  async flush(now: number): Promise<void> {
    if (!this.due(now)) return;
    const id = this.roomId();
    if (!id) return;
    const row = this.wantRow;
    const key = this.wantKey;
    const run = (async () => {
      try {
        await this.sink.write(id, row);
        this.sentKey = key;
        this.sentAt = now;
        this.retryAt = null;
        this.attempt = 0;
        await this.store(key === 'none' ? null : key).catch(() => undefined);
      } catch (e) {
        this.retryAt = now + persistBackoffMs(this.attempt++);
        console.warn(JSON.stringify({ ev: 'versus_cf_live_retry', room: id, attempt: this.attempt, error: String(e) }));
      }
    })();
    this.inflight = run;
    try { await run; } finally { this.inflight = null; }
  }
}
