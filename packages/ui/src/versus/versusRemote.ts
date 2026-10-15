/**
 * VERSUS — the Supabase adapter (RPC + Realtime). No React, no store: every call returns plain data or throws a
 * `VersusError` with the SQL's error code (`raise exception '<code>'`), and every subscription hands back an
 * unsubscribe function. The rows are the truth; Realtime only says "something changed, read it again"
 * (blueprint 4). See supabase/migrations/2026-10-13-versus.sql for every RPC this wraps.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { VERSUS_PROTOCOL, type PreparedCombatSide, type VersusSeat, type VersusSeatScout } from '@game/sim';
import { supabaseClient } from '../remoteBoards';

export type VersusRoomStatus = 'open' | 'sealed' | 'in_game';
export type VersusRole = VersusSeat | 'spectator';
export type VersusPhase = 'hero_select' | 'shop' | 'resolving' | 'combat' | 'complete';

export interface VersusMember {
  userId: string;
  role: VersusRole;
  displayName: string;
  profile: Record<string, unknown>;
  lastSeenAt: string;
}

export interface VersusRoom {
  id: string;
  name: string;
  host_user_id: string;
  status: VersusRoomStatus;
  set_id: string;
  content_revision: string;
  protocol: number;
  revision: number;
  gate_deadline: string | null;
  p1_gate: boolean;
  p2_gate: boolean;
  current_match_id: string | null;
  members: VersusMember[];
  serverNow: string;
}

export interface VersusRoomSummary {
  id: string;
  name: string;
  status: VersusRoomStatus;
  setId: string;
  contentRevision: string;
  protocol: number;
  createdAt: string;
  currentMatchId: string | null;
  hostName: string | null;
  hostProfile: Record<string, unknown> | null;
  players: number;
  spectators: number;
}

export interface VersusMatch {
  id: string;
  room_id: string | null;
  seed: number;
  set_id: string;
  content_revision: string;
  protocol: number;
  phase: VersusPhase;
  revision: number;
  round: number;
  p1_user: string;
  p2_user: string;
  p1_name: string;
  p2_name: string;
  p1_hearts: number;
  p2_hearts: number;
  p1_hero: string | null;
  p2_hero: string | null;
  heroes_revealed: boolean;
  hero_deadline: string | null;
  shop_starts_at: string | null;
  shop_deadline: string | null;
  combat_deadline: string | null;
  p1_locked: boolean;
  p2_locked: boolean;
  p1_ready: boolean;
  p2_ready: boolean;
  /** Round 1: each player's game start has played out (`introDone`). The clock starts when both are in. */
  p1_intro?: boolean;
  p2_intro?: boolean;
  /** Round 1: when the clock starts anyway if an intro never reports in (null once it runs). */
  intro_deadline?: string | null;
  paused_seat: VersusSeat | null;
  paused_at: string | null;
  pause_grace_until: string | null;
  /** The Unpause 3-2-1: the match resumes at this moment (null when no countdown is running). */
  resume_at?: string | null;
  p1_auto: boolean;
  p2_auto: boolean;
  p1_missed: number;
  p2_missed: number;
  winner_seat: VersusSeat | null;
  end_reason: 'hearts' | 'forfeit' | 'missed' | 'abandoned' | null;
  completed_at: string | null;
  serverNow?: string;
}

export interface VersusPrivate {
  match_id: string;
  seat: VersusSeat;
  hero_seed: number;
  run_seed: number;
  hero_offer: string[] | null;
  hero_index: number | null;
  hero_auto: boolean;
}

export interface VersusRoundRow {
  match_id: string;
  round: number;
  chair: VersusSeat;
  outcome: VersusSeat | 'draw';
  heart_lost_by: VersusSeat | null;
  p1_result: unknown;
  p2_result: unknown;
  digest: string;
  p1_hearts: number;
  p2_hearts: number;
  /** Each seat's public state at its lock (tier from the locked side), for the scout card. Null on older rounds. */
  p1_scout?: VersusSeatScout | null;
  p2_scout?: VersusSeatScout | null;
}

export interface VersusOwnSubmission {
  round: number;
  final: boolean;
  candidate_seq: number;
  checkpoint: string | null;
}

export class VersusError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

/** The SQL's `raise exception 'code'` arrives as the message; anything else is a network/unknown failure. */
const KNOWN = /^[a-z_]+$/;
function fail(e: { message?: string; code?: string } | null | undefined): never {
  const msg = (e?.message ?? 'unknown').trim();
  // The Versus tables/functions are not on this server yet (PostgREST: unknown function / relation).
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205' || e?.code === '42P01') throw new VersusError('not_deployed', msg);
  throw new VersusError(KNOWN.test(msg) ? msg : 'network', msg);
}

export interface VersusIdentity {
  displayName: string;
  profile: Record<string, unknown>;
  setId: string;
  contentRevision: string;
}

/**
 * The adapter over ONE Supabase client. The game's own session uses `versusRemote` (the app client); the dev test bot
 * (`versusBot.ts`) builds a second one over its own client and anonymous session, so it plays through exactly the
 * same RPCs, tables and Edge Function as a person (no server shortcut).
 */
export function makeVersusRemote(getClient: () => SupabaseClient | null) {
  const db = (): SupabaseClient => {
    const c = getClient();
    if (!c) throw new VersusError('no_backend');
    return c;
  };
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    // rows: every Versus RPC returns ONE jsonb value (a row object or a room list capped by the room count), never a table (R-NET-01).
    const { data, error } = await db().rpc(fn, args);
    if (error) fail(error);
    return data as T;
  }
  return {

  listRooms: () => rpc<VersusRoomSummary[]>('versus_list_rooms'),
  createRoom: (name: string, me: VersusIdentity) =>
    rpc<VersusRoom>('versus_create_room', { p_name: name, p_display: me.displayName, p_profile: me.profile, p_set_id: me.setId, p_content: me.contentRevision, p_protocol: VERSUS_PROTOCOL }),
  joinRoom: (roomId: string, as: 'player' | 'spectator', me: VersusIdentity) =>
    rpc<VersusRoom>('versus_join_room', { p_room: roomId, p_as: as, p_display: me.displayName, p_profile: me.profile, p_content: me.contentRevision, p_protocol: VERSUS_PROTOCOL }),
  takeSeat: (roomId: string, role: VersusRole) => rpc<VersusRoom>('versus_take_seat', { p_room: roomId, p_role: role }),
  leaveRoom: (roomId: string) => rpc<{ left: boolean }>('versus_leave_room', { p_room: roomId }),
  startGame: (roomId: string) => rpc<VersusRoom>('versus_start_game', { p_room: roomId }),
  pressGate: (roomId: string) => rpc<VersusRoom>('versus_press_gate', { p_room: roomId }),
  reconcileRoom: (roomId: string) => rpc<VersusRoom>('versus_reconcile_room', { p_room: roomId }),
  heartbeat: (roomId: string) => rpc<{ serverNow: string; match?: VersusMatch }>('versus_heartbeat', { p_room: roomId }),

  async room(roomId: string): Promise<VersusRoom | null> {
    const { data, error } = await db().from('versus_rooms').select('*').eq('id', roomId).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    // rows: a room holds at most 22 members (2 seats + 20 spectators, enforced in SQL) (R-NET-01).
    const { data: members, error: e2 } = await db().from('versus_members').select('user_id, role, display_name, profile, last_seen_at, joined_at').eq('room_id', roomId).order('joined_at');
    if (e2) fail(e2);
    return {
      ...(data as Omit<VersusRoom, 'members' | 'serverNow'>),
      members: (members ?? []).map((m) => ({ userId: m.user_id, role: m.role, displayName: m.display_name, profile: m.profile ?? {}, lastSeenAt: m.last_seen_at })),
      serverNow: new Date().toISOString(),
    } as VersusRoom;
  },
  /** The room this account is a member of, if any (a returning player rejoins it). */
  async myRoomId(userId: string): Promise<string | null> {
    // rows: one row at most (unique index on user_id) (R-NET-01).
    const { data, error } = await db().from('versus_members').select('room_id').eq('user_id', userId).maybeSingle();
    if (error) fail(error);
    return (data as { room_id: string } | null)?.room_id ?? null;
  },
  async match(matchId: string): Promise<VersusMatch | null> {
    const { data, error } = await db().from('versus_matches').select('*').eq('id', matchId).maybeSingle();
    if (error) fail(error);
    return (data as VersusMatch | null) ?? null;
  },
  async myPrivate(matchId: string): Promise<VersusPrivate | null> {
    const { data, error } = await db().from('versus_seat_private').select('*').eq('match_id', matchId).maybeSingle();
    if (error) fail(error);
    return (data as VersusPrivate | null) ?? null;
  },
  async rounds(matchId: string, fromRound = 1): Promise<VersusRoundRow[]> {
    // rows: a match has one row per round and ends long before 1,000 rounds (7 hearts; the slowest is a draw run) (R-NET-01).
    const { data, error } = await db().from('versus_rounds').select('*').eq('match_id', matchId).gte('round', fromRound).order('round');
    if (error) fail(error);
    return (data as VersusRoundRow[]) ?? [];
  },
  /** My newest LOCKED submission with a checkpoint (the reconnect restore point). */
  async myLatestCheckpoint(matchId: string): Promise<VersusOwnSubmission | null> {
    const { data, error } = await db().from('versus_submissions').select('round, final, candidate_seq, checkpoint')
      .eq('match_id', matchId).eq('final', true).not('checkpoint', 'is', null).order('round', { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error);
    return (data as VersusOwnSubmission | null) ?? null;
  },

  registerOffer: (matchId: string, offer: string[]) => rpc<VersusMatch>('versus_register_offer', { p_match: matchId, p_offer: offer }),
  pickHero: (matchId: string, index: number) => rpc<VersusMatch>('versus_pick_hero', { p_match: matchId, p_index: index }),
  /** A candidate or the lock. `scout` is my public state for the opponent's scout card, recorded on the round once it
   *  is fought (2026-10-14-versus-scout.sql). A server without that migration takes the submit without it. */
  async submit(matchId: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null): Promise<VersusMatch> {
    const base = { p_match: matchId, p_round: round, p_seq: seq, p_side: side, p_final: final, p_checkpoint: checkpoint };
    if (!scout) return rpc<VersusMatch>('versus_submit', base);
    try {
      return await rpc<VersusMatch>('versus_submit', { ...base, p_scout: scout });
    } catch (e) {
      if ((e as VersusError).code !== 'not_deployed') throw e;
      return rpc<VersusMatch>('versus_submit', base);
    }
  },
  /** My game start (Hero Select ceremony + Good Luck) has played out; round 1's clock starts when both have. */
  introDone: (matchId: string) => rpc<VersusMatch>('versus_intro_done', { p_match: matchId }),
  combatReady: (matchId: string, round: number) => rpc<VersusMatch>('versus_combat_ready', { p_match: matchId, p_round: round }),
  forfeit: (matchId: string) => rpc<VersusMatch>('versus_forfeit', { p_match: matchId }),
  unpause: (matchId: string) => rpc<VersusMatch>('versus_unpause', { p_match: matchId }),
  /** Back from a disconnect: start the 3-2-1 that resumes the match (`resume_at`). */
  requestResume: (matchId: string) => rpc<VersusMatch>('versus_request_resume', { p_match: matchId }),
  reconcile: (matchId: string) => rpc<VersusMatch>('versus_reconcile', { p_match: matchId }),
  publishFrame: (matchId: string, seq: number, round: number, frame: unknown) =>
    rpc<void>('versus_publish_frame', { p_match: matchId, p_seq: seq, p_round: round, p_frame: frame }),
  async latestFrames(matchId: string): Promise<{ seat: VersusSeat; seq: number; round: number; frame: unknown }[]> {
    // rows: at most two rows per match, one per seat (primary key match_id + seat) (R-NET-01).
    const { data, error } = await db().from('versus_spectator_frames').select('seat, seq, round, frame').eq('match_id', matchId);
    if (error) fail(error);
    return (data as { seat: VersusSeat; seq: number; round: number; frame: unknown }[]) ?? [];
  },

  /** Ask the resolver to settle a `resolving` round (idempotent server-side; any member may ask). */
  async finalize(matchId: string, round: number, contentRevision: string): Promise<void> {
    const { error } = await db().functions.invoke('versus-resolve', {
      body: { action: 'finalize', protocol: VERSUS_PROTOCOL, contentRevision, matchId, round },
    });
    if (error) throw new VersusError('finalize_failed', (error as Error).message);
  },

  /**
   * One Realtime channel per room: row changes on the room, its members, its current match and that match's
   * rounds (each just a wake-up), plus the match's BROADCAST events (spectator deltas, emotes). `onBroadcast`
   * receives `{ event, payload }`.
   */
  subscribeRoom(roomId: string, matchId: string | null, onChange: (what: 'room' | 'members' | 'match' | 'rounds', row?: Record<string, unknown>) => void,
    onBroadcast?: (event: string, payload: unknown) => void): { channel: RealtimeChannel; send: (event: string, payload: unknown) => void; close: () => void } {
    const c = db();
    let ch = c.channel(`versus:${roomId}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_rooms', filter: `id=eq.${roomId}` }, () => onChange('room'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_members', filter: `room_id=eq.${roomId}` }, (p: { eventType?: string; new?: Record<string, unknown> }) => onChange('members', p.eventType === 'UPDATE' ? p.new : undefined));
    if (matchId) {
      ch = ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_matches', filter: `id=eq.${matchId}` }, () => onChange('match'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'versus_rounds', filter: `match_id=eq.${matchId}` }, () => onChange('rounds'));
    }
    if (onBroadcast) ch = ch.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => onBroadcast(msg.event, msg.payload));
    ch.subscribe();
    return {
      channel: ch,
      send: (event, payload) => { void ch.send({ type: 'broadcast', event, payload }); },
      close: () => { void c.removeChannel(ch); },
    };
  },
  };
}

export type VersusRemote = ReturnType<typeof makeVersusRemote>;
export const versusRemote: VersusRemote = makeVersusRemote(supabaseClient);
