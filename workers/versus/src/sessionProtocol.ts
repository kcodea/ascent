/**
 * THE GAME SESSION ON CLOUDFLARE — the wire contract (R-SESSION-CF-01; owner 2026-10-31: "Is it possible to just have
 * ranked solos run on cloudflare too so that we aren't read writing in real time? Can we offload that to cloudflare" →
 * "Do it"; standing ruling: Cloudflare is the source for all live information and action, Supabase is storage only).
 *
 * One Durable Object per lobby / Practice game (`GameSession`, `session.ts`) on the stable friends hub Worker
 * (`ascent-hub`, never per content revision, so a game in flight survives every pack). It is two things at once:
 *
 *   - the game's LIVE HOST: the live game protocol (`liveProtocol.ts`) on `GET /session/<game>/ws`, so spectating, the
 *     Live Games listing (written straight to the hub's own directory), lobby chat, pings and mentor and the spectators'
 *     watch record work exactly as on the Versus Worker. The row's `live_host` is `session`.
 *   - the game's SESSION: the per-round cloud save, the table's seat recordings, and the end-of-game writes are buffered
 *     in the object (HTTP below) and flushed to Supabase in ONE key-gated call (`session_cf_flush`) when the game ends,
 *     or when the player has gone quiet (the alarm). The rating settle rides that flush.
 *
 * The opponent pool is served by the hub too (`POST /pool/keys`, `POST /pool/boards`, `poolMirror.ts`): a mirror of
 * exactly what `pool_runs_sample_keys` / `pool_runs_boards` answer.
 *
 * Dependency-free: no imports (the client imports it through `@game/versus-cf/session`).
 */

/** Bump when a body or answer shape changes incompatibly. The client sends it; a mismatch is refused (`version_mismatch`). */
export const SESSION_PROTOCOL = 1;

export const SESSION_ROUTES = {
  /** `GET`: `{ enabled, protocol }`: the cutover switch (`SESSION_MODE` on the hub) and the protocol it speaks. */
  config: '/session/config',
  /** `POST`: the pool sample's keys (the `pool_runs_sample_keys` arguments as the body). */
  poolKeys: '/pool/keys',
  /** `POST`: `{ ids }`: those runs' boards (`pool_runs_boards`). */
  poolBoards: '/pool/boards',
  /** `GET`: DEV only: the mirror's counters. */
  poolMetrics: '/pool/metrics',
} as const;

/** The per-game routes: `/session/<game>/<op>`. */
export type SessionOp = 'ws' | 'save' | 'park' | 'table' | 'write' | 'rate' | 'clear' | 'seats' | 'state' | 'metrics';
export const sessionPath = (gameId: string, op: SessionOp): string => `/session/${encodeURIComponent(gameId)}/${op}`;
/** The live socket of a session-hosted game (the live game protocol). */
export const sessionSocketPath = (gameId: string): string => sessionPath(gameId, 'ws');

/** A Live Games row's `live_host` for a game hosted by a session. */
export const SESSION_LIVE_HOST = 'session';

/** A session game id: the lobby game id the Live Games listing and the watch record accept. */
export const SESSION_GAME_ID = /^[!-~]{1,80}$/;

/** The largest save the session keeps (the save string plus its seat recordings), and the largest single write. */
export const SESSION_MAX_SAVE_CHARS = 1_800_000;
export const SESSION_MAX_WRITE_CHARS = 1_800_000;
/** Write items a session keeps (a finished game makes four or five). */
export const SESSION_MAX_WRITES = 24;

/** The tables a session write may land in (the run-end outbox's tables, R-NET-OUTBOX-01). */
export const SESSION_WRITE_TABLES = ['boards', 'run_telemetry', 'run_history', 'lobby_fights'] as const;
export type SessionWriteTable = (typeof SESSION_WRITE_TABLES)[number];

/** `POST save`: the cloud save of this game (the `put_saved_run` arguments, with the payload split). */
export interface SessionSaveBody {
  protocol: number;
  runKey: string;
  /** The revision this device last saw on the Supabase row (its lease). */
  expected: number;
  deviceId: string;
  /** The local save string, byte for byte. */
  save: string;
  /** The seat recordings. Omitted when `seatsSame` (the session keeps the last ones it was sent). */
  seatRuns?: unknown[];
  seatHybrids?: unknown[];
  seatsSame?: boolean;
}

/** The answer to a save (the `put_saved_run` statuses). `revision` is the Supabase row's revision as the session knows
 *  it: a save the session holds does not move it (it is written to Supabase when the player parks or goes quiet). */
export type SessionSaveAnswer =
  | { status: 'ok'; revision: number; seats: boolean }
  | { status: 'conflict'; current: { run_key: string; revision: number; device_id: string; updated_at: string } | null };

/** `POST table`: the table's opponent keys, pinned when the game starts (the rating settle uses THESE). */
export interface SessionTableBody { protocol: number; mode: 'ranked' | 'casual' | 'practice'; seatKeys: string[] }

/** `POST write`: one run-end outbox item (rows WITHOUT `user_id`: the session stamps its owner). */
export interface SessionWriteBody {
  protocol: number;
  item: { key: string; kind: string; table: string; rows: Record<string, unknown>[]; conflict?: string };
}

/** `POST rate`: the rank request (the `submit-rating` body). Answered with `submit-rating`'s own answer. */
export interface SessionRateBody {
  protocol: number;
  req: { runId: string; placement: number; seasonId: number; rulesVersion: number; seed?: number; seatKeys?: string[]; kind?: string };
}

/** `POST clear`: the run ended; the cloud save row goes (`clear_saved_run`). */
export interface SessionClearBody { protocol: number; runKey: string; expected: number }

/** `GET state`: what the session holds (the client's diagnostics + the tests). */
export interface SessionState {
  gameId: string;
  owner: string | null;
  finished: boolean;
  writes: number;
  flushed: number;
  pendingFlush: boolean;
  save: { runKey: string; revision: number; dirty: boolean } | null;
  rated: boolean;
}
