/**
 * VERSUS ON CLOUDFLARE — the room's LIVE GAMES row (R-VERSUS-CF-LIVE-01; what is listed: `core/liveListing.ts`).
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

export class SupabaseLiveSink implements LiveSink {
  readonly live = true;
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}

  async write(roomId: string, row: LiveListing | null): Promise<void> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/versus_cf_live`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, p_room: roomId, p_row: row }),
    });
    if (!res.ok) throw new Error(`live ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export function liveSinkFor(env: PersistEnv): LiveSink {
  if (env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.VERSUS_WRITER_SECRET) {
    return new SupabaseLiveSink(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.VERSUS_WRITER_SECRET);
  }
  return new LocalLiveSink();
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
