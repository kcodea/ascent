/**
 * LIVE GAMES ON THE HUB — the Versus Worker's half (R-LIVE-DIR-01). A room's or a live lobby game's listing goes to the
 * friends hub's ONE live directory (`liveDirectory.ts`, on the version-independent `ascent-hub` Worker) through the
 * `LIVE_DIR` service binding, so Live Games lists the games of every content revision.
 *
 * Until the retire migration (`2026-11-19-retire-supabase-live-list.sql`) the same row is still written to Supabase
 * (`versus_cf_live` / `lobby_live_cf`) for clients from before the hub list: `TeeLiveSink` writes both, through the one
 * `LiveSlot` that already decides when a write is due (a listing change, the 2-minute keep-alive). After that migration
 * the Supabase writer answers `retired` and the Supabase half stops for the object's life (`live.ts`).
 *
 * No binding (a local `versus:cf:dev` without `hub:dev`, the unit tests): the hub half is simply absent.
 */
import type { LobbyListing } from './core/liveCore';
import type { LiveListing } from './core/liveListing';
import type { LiveSink } from './live';
import type { LiveDirPut } from './liveDirProtocol';

/** The hub's `LiveDirectoryWriter` entrypoint, as a service binding exposes it (RPC). */
export interface LiveDirBinding {
  put(row: LiveDirPut): Promise<unknown>;
  remove(gameIds: string[]): Promise<unknown>;
}

export interface LiveDirWriterEnv {
  /** `[[services]] binding = "LIVE_DIR"` (wrangler.toml). Absent: the hub half is skipped. */
  LIVE_DIR?: LiveDirBinding;
  /** "1": skip the hub half although the binding exists (a local Worker run with no hub beside it: the tests). */
  LIVE_DIR_OFF?: string;
}

/** The hub's directory, when this Worker writes to it. */
export const liveDirOf = (env: LiveDirWriterEnv): LiveDirBinding | null => (env.LIVE_DIR && env.LIVE_DIR_OFF !== '1' ? env.LIVE_DIR : null);

/** A Versus room's two possible game ids (a room may change mode, so a removal clears both). */
export const roomGameIds = (roomId: string): [versus: string, duos: string] => [`versus:cf:${roomId}`, `duos:cf:${roomId}`];

/** A room's listing as a directory row. Rank, medal and team name are the directory's to look up. */
export function roomDirPut(l: LiveListing): LiveDirPut {
  const [versus, duos] = roomGameIds(l.room);
  const duo = l.mode === 'ranked_duos';
  const first = l.players.split(' vs ')[0]?.trim() ?? '';
  return {
    game_id: duo ? duos : versus, user_id: l.p1,
    display_name: (duo ? l.team_name || l.players : first) || (duo ? 'Duo' : 'Player'),
    hero_id: l.hero, cosmetics: null, round: l.round, phase: l.phase, spectators: l.spectators, mode: l.mode,
    players: l.players || null, live_host: null, status: null, private_host: duo ? null : l.private_host, team: l.team,
    replaces: [duo ? versus : duos],
    ...(duo ? { division_index: l.division ?? 0 } : {}),
  };
}

/** A live lobby / Practice game's listing as a directory row (its own reported rank is the fallback). */
export function lobbyDirPut(l: LobbyListing): LiveDirPut {
  return {
    game_id: l.game, user_id: l.user, display_name: l.name, hero_id: l.hero, cosmetics: l.cosmetics, round: l.round,
    phase: l.phase, spectators: l.spectators, mode: l.mode, players: null, live_host: l.host, status: l.status,
    private_host: null, team: null, started_at: l.started_at ?? null,
    division_index: l.division ?? 0, rank_points: l.points ?? 0, rating: l.rating ?? 0,
  };
}

/** A room's listing into the hub's directory. */
export class HubRoomSink implements LiveSink<LiveListing> {
  readonly live = true;
  constructor(private readonly dir: LiveDirBinding) {}
  async write(roomId: string, row: LiveListing | null): Promise<void> {
    if (row) await this.dir.put(roomDirPut(row));
    else await this.dir.remove(roomGameIds(roomId));
  }
}

/** A live lobby game's listing into the hub's directory. */
export class HubLobbySink implements LiveSink<LobbyListing> {
  readonly live = true;
  constructor(private readonly dir: LiveDirBinding) {}
  async write(gameId: string, row: LobbyListing | null): Promise<void> {
    if (row) await this.dir.put(lobbyDirPut(row));
    else await this.dir.remove([gameId]);
  }
}

/**
 * Both writers, for the cutover window: each write goes to both, and a failure of either fails the write so the slot
 * retries it. A retry re-sends only to the writer that failed (the other already holds that exact row), so a hub that
 * cannot be reached never makes the Supabase row be written again and again, and vice versa.
 */
export class TeeLiveSink<R> implements LiveSink<R> {
  readonly live: boolean;
  /** What each writer last accepted (`id` + row, as JSON). */
  private okA = '';
  private okB = '';
  constructor(private readonly a: LiveSink<R>, private readonly b: LiveSink<R>) {
    this.live = a.live || b.live;
  }
  /** The first writer's log (the local writer keeps one for the tests and the metrics route). */
  get written(): unknown[] | undefined {
    return (this.a as { written?: unknown[] }).written;
  }
  async write(id: string, row: R | null): Promise<void> {
    const key = JSON.stringify([id, row]);
    const [x, y] = await Promise.allSettled([
      this.okA === key ? Promise.resolve() : this.a.write(id, row).then(() => { this.okA = key; }),
      this.okB === key ? Promise.resolve() : this.b.write(id, row).then(() => { this.okB = key; }),
    ]);
    if (x.status === 'rejected') throw x.reason;
    if (y.status === 'rejected') throw y.reason;
  }
}
