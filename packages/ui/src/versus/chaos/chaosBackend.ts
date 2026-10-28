/**
 * VERSUS CHAOS HARNESS: THE BACKEND SEAM (what the match runner needs of a server, on either host).
 *
 * The runner (`chaosMatch.ts`) and its invariants are the same for both hosts; only these reads and knobs differ:
 *  - `ChaosServer` (`chaosServer.ts`): the Supabase path. PGlite + the real migrations + the real `versus-resolve`
 *    handlers, a fake Realtime bus, the clients on the real Supabase adapter (`makeVersusRemote`).
 *  - `CfChaosServer` (`cfChaosServer.ts`): the Cloudflare path. The real room rules (`workers/versus` RoomCore + the
 *    group engine) inside a Node mirror of the Durable Object shell, the clients on the real Cloudflare transport
 *    (`makeCfVersusRemote` behind the cutover router) over fake WebSockets.
 *
 * Every read answers in the SAME shape on both hosts (the SQL rows' fields), so a scenario's invariants judge the two
 * hosts by one rule and the two result tables compare cell by cell.
 */
import type { ChaosMode } from './chaosMatch';

export type ResolverAction = 'finalize' | 'finalize_group' | 'finalize_duos' | 'finalize_ranked_duos' | 'seat_ranked_duos';
export interface ResolverCall {
  at: number;
  user: string;
  action: ResolverAction;
  matchId: string;
  round: number | null;
  status: number;
  /** The call reached the handler (not an injected failure / 409). */
  handled: boolean;
  /** The handler committed (or found committed) this round. */
  committed: boolean;
  body: unknown;
}

/** Resolver chaos: everything optional; `delayMs` is per call, `fail` counts down per call. */
export interface ResolverChaos {
  delayMs: number;
  /** The next N calls fail without reaching the handler (Supabase: a 500; Cloudflare: the room object dies mid-resolve). */
  fail: number;
  /** The next N calls answer 409 (content / protocol mismatch). */
  conflict: number;
}

/** The server's truth at one step (the runner's view; every time in ms, `pausedAt` an opaque stamp). */
export interface ServerSnap {
  t: number;
  phase: string;
  round: number;
  revision: number;
  shopDeadline: number | null;
  pausedSeat: string | null;
  pausedAt: string | null;
  resumeAt: string | null;
  seats: { seat: string; user: string; name: string; locked: boolean; lockedAt: number | null; health: number | null; armor: number | null; placement: number | null; eliminated: number | null; team: string | null; auto: boolean }[];
  teams: { team: string; health: number | null; armor: number | null; placement: number | null; eliminated: number | null }[];
}

export type Vitals = Record<string, { health: number; armor: number }>;

export interface ChaosBackend {
  readonly kind: 'supabase' | 'cf';
  readonly resolverLog: ResolverCall[];
  readonly resolverChaos: ResolverChaos;
  /** Every resolver answer (the runner narrates them). */
  onResolve: (c: ResolverCall) => void;
  /** Narration hook for the backend's own events (object restarts, stale sockets). */
  onNote: (s: string) => void;
  /** Wipe every room and match between scenarios (seeded: match and hero seeds replay). */
  reset(seed: number): Promise<void>;
  /** Is any server work queued or running? (The runner settles until the server is idle.) */
  idle(): boolean;

  // ── chaos knobs ──
  /** Hold the match for `ms` (Supabase: the match row lock; Cloudflare: the room object is busy). */
  holdMatch(matchId: string, ms: number): void;
  holding(matchId: string): boolean;
  /** Realtime dies for `ms` (0 = until the end). Supabase: the Realtime service. Cloudflare: one socket carries pushes and
   *  requests, so the analogue is the room object restarting (a deploy / eviction): every socket drops at once. */
  killRealtime(ms: number): string;
  /** Is the push path up (the `realtime` invariant only judges while it is)? */
  realtimeUp(): boolean;
  /** Is `user`'s client subscribed to this match's changes right now? */
  listening(user: string, matchId: string): boolean;
  /** Once per runner step (dead sockets notice their network). */
  sweep(): void;

  // ── reads (the harness's own view of the truth) ──
  noteRoomMatch(roomId: string, matchId: string): void;
  currentMatchOf(roomId: string): Promise<string | null>;
  snapshot(matchId: string, group: boolean): Promise<ServerSnap | null>;
  /** Every seat's pools after round `r`, keyed by the seat's NAME (the rail's label), or null before it is committed. */
  committedVitals(matchId: string, r: number, mode: ChaosMode): Promise<Vitals | null>;
  committedRounds(matchId: string | null, group: boolean): Promise<number>;
  /** The server's fights, one canonical line per round. */
  serverFights(matchId: string, mode: ChaosMode): Promise<Record<number, string>>;
}
