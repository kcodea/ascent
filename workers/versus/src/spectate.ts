/**
 * SPECTATOR XP FOR EVERY CLOUDFLARE WATCH (2026-10-29, R-LIVE-CF-XP-01). The watch record that decides a spectator's XP
 * (`spectate_sessions`, R-PROG-SPECTATE-XP-01) used to be written ONLY by the spectator's own client calling
 * `spectate_beat`, which proves the watch from Supabase rows: a `lobby_live_watchers` row (a live lobby game) or a
 * `versus_members` spectator row (a Versus room). A Cloudflare room or live game keeps neither, so watching one earned
 * nothing (the gap the cutover runbook listed).
 *
 * Now the OBJECT the spectator is connected to is the witness: it knows exactly who is in its stands, from their
 * verified socket. It beats on their behalf through ONE limited, key-gated function, `spectate_cf_beat`
 * (supabase/migrations/2026-11-10-lobby-live-cf.sql: same writer secret as `versus_cf_persist`, never the service role),
 * which applies `spectate_beat`'s own accrual rule to each beat (time accrues only between beats at most 45 s apart on
 * the ONE game that spectator beat last), so the XP rules and caps in `settle_progression` are untouched.
 *
 * Cost: every watcher of an object goes out in ONE call, every `SPECTATE_REPORT_MS` (inside the 45 s continuity window),
 * plus one soon after a watcher arrives or leaves and one at the end. The client's own beat was one call per watcher
 * every 10 s. A failed beat is dropped, never retried late (a late beat would stamp a later time than the watch had),
 * exactly as the client's beat was.
 */
import type { PersistEnv } from './persist';

export type SpectateKind = 'lobby' | 'versus' | 'group';

/** One spectator's beat, as the writer takes it. */
export interface WatchBeat {
  user: string;
  kind: SpectateKind;
  /** The lobby game id, or the Versus match id. */
  target: string;
  /** A lobby game's player (never the spectator); null for Versus (the match row names its players). */
  watched_user: string | null;
  /** A lobby game's start (ISO); null for Versus. */
  started_at: string | null;
  /** The game is over (a lobby game's end, seen while watching). */
  ended: boolean;
}

export interface SpectateSink {
  readonly live: boolean;
  write(beats: WatchBeat[]): Promise<void>;
}

/** Persistence off (local dev, tests): the beats are kept for the tests and the metrics route. */
export class LocalSpectateSink implements SpectateSink {
  readonly live = false;
  readonly written: { at: number; beats: WatchBeat[] }[] = [];
  async write(beats: WatchBeat[]): Promise<void> {
    this.written.push({ at: Date.now(), beats });
    if (this.written.length > 500) this.written.shift();
  }
}

export class SupabaseSpectateSink implements SpectateSink {
  readonly live = true;
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}
  async write(beats: WatchBeat[]): Promise<void> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/spectate_cf_beat`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, p_beats: beats }),
    });
    if (!res.ok) throw new Error(`spectate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export function spectateSinkFor(env: PersistEnv): SpectateSink {
  if (env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.VERSUS_WRITER_SECRET) {
    return new SupabaseSpectateSink(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.VERSUS_WRITER_SECRET);
  }
  return new LocalSpectateSink();
}

/** The regular beat: well inside the server's 45 s continuity window, so no watched second is lost between beats. */
export const SPECTATE_REPORT_MS = 30_000;
/** An arrival or a departure beats this soon (several arrivals in a burst share one call). */
export const SPECTATE_SOON_MS = 1_000;

/**
 * When an object beats its stands. Pure scheduling (the caller owns the clock and the sink):
 *   - `poke(now)`: a watcher arrived or the game state changed: beat within `SPECTATE_SOON_MS`.
 *   - `left(beat, now)`: a watcher left: their LAST beat (it accrues the time since their previous one) goes out soon.
 *   - `due(now, anyone)` / `nextAt(now, anyone)`: the regular beat, every `SPECTATE_REPORT_MS` while anyone watches.
 *   - `take(now, present)`: the beats to send now (the stands plus the leavers), and the clock moves on.
 */
export class WatchReporter {
  private soonAt: number | null = null;
  private lastAt: number | null = null;
  private leavers: WatchBeat[] = [];

  poke(now: number): void {
    const at = now + SPECTATE_SOON_MS;
    if (this.soonAt == null || this.soonAt > at) this.soonAt = at;
  }

  left(beat: WatchBeat, now: number): void {
    this.leavers = this.leavers.filter((b) => !(b.user === beat.user && b.target === beat.target));
    this.leavers.push(beat);
    this.poke(now);
  }

  /** When the next beat is due (null: nothing to report). `anyone`: someone is in the stands. */
  nextAt(anyone: boolean): number | null {
    const regular = anyone ? (this.lastAt == null ? null : this.lastAt + SPECTATE_REPORT_MS) : null;
    const soon = this.soonAt;
    if (regular == null) return soon ?? (anyone && this.lastAt == null ? 0 : null);
    return soon == null ? regular : Math.min(soon, regular);
  }

  due(now: number, anyone: boolean): boolean {
    const at = this.nextAt(anyone);
    return at != null && now >= at;
  }

  /** Take the beats owed now. Leavers who came back are in `present` and are sent once. */
  take(now: number, present: WatchBeat[]): WatchBeat[] {
    const here = new Set(present.map((b) => `${b.user}|${b.target}`));
    const out = [...present, ...this.leavers.filter((b) => !here.has(`${b.user}|${b.target}`))];
    this.leavers = [];
    this.soonAt = null;
    this.lastAt = present.length ? now : null;
    return out;
  }
}

/**
 * The SQL's accrual rule, mirrored for the tests (`spectate_beat` / `spectate_cf_beat`): a beat adds the time since the
 * spectator's previous beat when that one was on the same game and at most 45 s ago. Pure.
 */
export const SPECTATE_GAP_MS = 45_000;
export function accruedMs(beats: { at: number; target: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  let prev: { at: number; target: string } | null = null;
  for (const b of [...beats].sort((x, y) => x.at - y.at)) {
    if (!out.has(b.target)) out.set(b.target, 0);
    if (prev && prev.target === b.target && b.at > prev.at && b.at - prev.at <= SPECTATE_GAP_MS) out.set(b.target, out.get(b.target)! + (b.at - prev.at));
    prev = b;
  }
  return out;
}
