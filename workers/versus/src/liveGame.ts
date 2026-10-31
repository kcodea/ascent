/**
 * LIVE GAMES ON CLOUDFLARE — the live game Durable Object of the VERSUS Worker (2026-10-29; R-LIVE-CF-01). One object per
 * live lobby or Practice game (named by the game id), on the Worker of the game's content revision. Everything a live game
 * does (the sockets, the relay, the keyframe, pings, the lobby chat, the listing, the watch record) is the shared host
 * (`liveHost.ts`); this file only says what is particular to the Versus Worker:
 *
 *   - a publisher must carry THIS Worker's engine (its watchers reach the Worker by the row's `cf:<revision>`);
 *   - the Live Games row goes to the friends hub's directory (R-LIVE-DIR-01) and, until the retire migration, to Supabase
 *     through the key-gated `lobby_live_cf` (supabase/migrations/2026-11-10-lobby-live-cf.sql; it answers `retired` after
 *     2026-11-19-retire-supabase-live-list.sql, and the Supabase half stops);
 *   - the watch record goes through `spectate_cf_beat` with this Worker's writer secret.
 *
 * Since R-SESSION-CF-01 (2026-10-31) a game started by a client with the ranked session on is hosted by the friends hub's
 * `GameSession` instead (`session.ts`, `live_host = 'session'`); this object keeps serving every other game.
 */
import { engineContentRevision } from '@game/sim/versus/server';
import { newLiveMeta, type LiveCore, type LiveMeta, type LobbyListing } from './core/liveCore';
import { supabaseRowSinkFor, type LiveSink } from './live';
import { HubLobbySink, liveDirOf, TeeLiveSink, type LiveDirWriterEnv } from './liveDirSink';
import { LiveGameHost, type LiveHostEnv, type PublisherHello } from './liveHost';
import type { PersistEnv } from './persist';
import { spectateSinkFor, type SpectateSink } from './spectate';

export { LIVE_GAME_HEADER, LIVE_USER_HEADER } from './liveHost';

export interface LiveEnv extends PersistEnv, LiveDirWriterEnv, LiveHostEnv {}

export class VersusLiveGame extends LiveGameHost<LiveEnv> {
  protected makeRowSink(env: LiveEnv): LiveSink<LobbyListing> {
    const sb = supabaseRowSinkFor<LobbyListing>(env, 'lobby_live_cf');
    const dir = liveDirOf(env);
    return dir ? new TeeLiveSink(sb, new HubLobbySink(dir)) : sb;
  }

  protected makeBeatSink(env: LiveEnv): SpectateSink {
    return spectateSinkFor(env);
  }

  protected newMeta(gameId: string, now: number): LiveMeta {
    return newLiveMeta(gameId, engineContentRevision(), now);
  }

  protected acceptsPublisher(core: LiveCore, hello: PublisherHello): boolean {
    return hello.contentRevision === core.meta.contentRevision;
  }
}
