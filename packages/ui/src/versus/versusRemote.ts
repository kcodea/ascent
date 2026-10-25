/**
 * VERSUS — the Supabase adapter (RPC + Realtime). No React, no store: every call returns plain data or throws a
 * `VersusError` with the SQL's error code (`raise exception '<code>'`), and every subscription hands back an
 * unsubscribe function. The rows are the truth; Realtime only says "something changed, read it again"
 * (blueprint 4). See supabase/migrations/2026-10-13-versus.sql for every RPC this wraps.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { ownSeatPerspective, VERSUS_PROTOCOL, type HeroReroll, type PreparedCombatSide, type VersusGroupSeat, type VersusRoomOptions, type VersusSeat, type VersusSeatScout } from '@game/sim';
import type { CombatResult } from '@game/core';
import { supabaseClient } from '../remoteBoards';

export type VersusRoomStatus = 'open' | 'sealed' | 'in_game';
/** A room role: a player seat (p3 / p4 only in a group room, R-VERSUS-GROUP-01) or the stands. */
export type VersusRole = VersusGroupSeat | 'spectator';
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
  /** Group rooms only (2026-10-24-versus-group.sql). */
  p3_gate?: boolean;
  p4_gate?: boolean;
  current_match_id: string | null;
  /** THE ROOM OPTIONS (R-VERSUS-OPTIONS-01): the host's mode + modifiers, on the room. Absent before the migration. */
  options?: VersusRoomOptions | null;
  /** Bumped on every options change (the room's "options changed" notice). */
  options_rev?: number;
  options_changed_at?: string | null;
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
  /** The room's seats for its mode (2 or 4) and its options (absent before 2026-10-24-versus-group.sql). */
  maxPlayers?: number;
  options?: VersusRoomOptions | null;
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
  /** The room options this match started with (R-VERSUS-OPTIONS-01). Null on a match before 2026-10-24. */
  options?: VersusRoomOptions | null;
  /** VERSUS GROUP (R-VERSUS-GROUP-01): this row is a 3-4 player match PROJECTED onto the 1v1 shape from one seat's
   *  side (`versusGroupView.ts`): p1 = that seat, p2 = its opponent this round. The full table rides here. */
  group?: VersusGroupView;
}

/** One seat of a group match, as `versus_group__match_json` (and the client's own table read) names it. */
export interface VersusGroupSeatRow {
  seat: VersusGroupSeat;
  userId: string;
  name: string;
  hearts: number;
  hero: string | null;
  locked: boolean;
  ready: boolean;
  intro: boolean;
  auto: boolean;
  missed: number;
  eliminatedRound: number | null;
  outReason: 'hearts' | 'forfeit' | 'left' | 'missed' | null;
  placement: number | null;
}

/** A group match row with its seats (`versus_group_matches` + `versus_group_seats`). */
export interface VersusGroupMatchRaw {
  id: string;
  room_id: string | null;
  seed: number;
  set_id: string;
  content_revision: string;
  protocol: number;
  options: VersusRoomOptions | null;
  phase: VersusPhase;
  revision: number;
  round: number;
  seat_count: number;
  heroes_revealed: boolean;
  hero_deadline: string | null;
  shop_starts_at: string | null;
  shop_deadline: string | null;
  intro_deadline: string | null;
  combat_deadline: string | null;
  paused_seat: VersusGroupSeat | null;
  paused_at: string | null;
  pause_grace_until: string | null;
  resume_at: string | null;
  winner_seat: VersusGroupSeat | null;
  end_reason: 'hearts' | 'forfeit' | 'missed' | 'abandoned' | null;
  completed_at: string | null;
  serverNow?: string;
  seats: VersusGroupSeatRow[];
}

/** VERSUS DUOS: one recorded pass (`versus_duos_passes`). */
export interface VersusDuosPassRow {
  match_id: string;
  round: number;
  from_seat: VersusGroupSeat;
  to_seat: VersusGroupSeat;
  seq: number;
  card: Record<string, unknown>;
  /** 'sent' until the receiver's run answers: 'landed', or 'refused' (its hand was full). */
  status: 'sent' | 'landed' | 'refused';
}

/** One fight of a committed group round (`versus_group_fights`). */
export interface VersusGroupFightRow {
  round: number;
  fight: number;
  a_seat: VersusGroupSeat;
  b_seat: VersusGroupSeat;
  b_copy: boolean;
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  heart_lost_by: VersusGroupSeat | null;
  a_result: CombatResult;
  b_result: CombatResult;
  a_scout: VersusSeatScout | null;
  b_scout: VersusSeatScout | null;
}

/** A committed group round: every seat's hearts after it and its fights. */
export interface VersusGroupRoundRaw {
  round: number;
  hearts: Partial<Record<VersusGroupSeat, number>>;
  eliminated: VersusGroupSeat[];
  fights: VersusGroupFightRow[];
}

/** What a projected group match carries beyond the 1v1 shape (see `VersusMatch.group`). */
export interface VersusGroupView {
  raw: VersusGroupMatchRaw;
  /** The viewer's REAL seat (null for a spectator). */
  me: VersusGroupSeat | null;
  /** The opponent this round: a seat, or a Copy of that seat. */
  foe: { seat: VersusGroupSeat; copy: boolean } | null;
  /** Living seats with each flag (an auto seat counts), and how many are living: the "Players ready N/M" pill. */
  counts: { locked: number; ready: number; intro: number; living: number };
  /** Who caused the pause (the pause panel names them). */
  pausedName: string | null;
  pausedUser: string | null;
  /** VERSUS DUOS (R-DUOS-01): my team, my teammate's seat and this round's fight order. Absent in a group match. */
  duos?: { team: 'a' | 'b'; mate: VersusGroupSeat | null; first: { a: VersusGroupSeat; b: VersusGroupSeat } };
}

export interface VersusPrivate {
  match_id: string;
  seat: VersusSeat;
  hero_seed: number;
  run_seed: number;
  hero_offer: string[] | null;
  hero_index: number | null;
  hero_auto: boolean;
  /** THE HERO RE-ROLL (R-HERO-REROLL-01, 2026-10-15-versus-hero-reroll.sql): my one re-roll, once spent. Absent on a
   *  server without that migration. */
  hero_reroll?: HeroReroll | null;
}

/** `versus_reroll_hero`'s answer: my three after the swap and the swap itself (both private to me). */
export interface VersusRerollResult {
  match: VersusMatch;
  offer: string[];
  reroll: HeroReroll;
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
  /** VERSUS GROUP: every seat's OWN result this round (the spectator's view of any seat), and the round's raw row. */
  results?: Partial<Record<VersusGroupSeat, CombatResult>>;
  group?: VersusGroupRoundRaw;
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
  /** How many rooms I could join right now (open, fresh, my version, not mine): two integers, no rows
   *  (2026-10-17-versus-open-rooms.sql, R-VERSUS-OPEN-ROOMS-01). The menus' "2 open" indicator. */
  openRooms: (contentRevision: string) =>
    rpc<{ open: number; seatOpen: number }>('versus_open_rooms', { p_protocol: VERSUS_PROTOCOL, p_content: contentRevision }),
  createRoom: (name: string, me: VersusIdentity, options?: VersusRoomOptions | null) =>
    rpc<VersusRoom>('versus_create_room', {
      p_name: name, p_display: me.displayName, p_profile: me.profile, p_set_id: me.setId, p_content: me.contentRevision, p_protocol: VERSUS_PROTOCOL,
      ...(options ? { p_options: options } : {}),
    }),
  /** The host sets the room's options while it is Open (R-VERSUS-OPTIONS-01; 2026-10-24-versus-group.sql). */
  setOptions: (roomId: string, options: VersusRoomOptions) => rpc<VersusRoom>('versus_set_options', { p_room: roomId, p_options: options }),
  joinRoom: (roomId: string, as: 'player' | 'spectator', me: VersusIdentity) =>
    rpc<VersusRoom>('versus_join_room', { p_room: roomId, p_as: as, p_display: me.displayName, p_profile: me.profile, p_content: me.contentRevision, p_protocol: VERSUS_PROTOCOL }),
  takeSeat: (roomId: string, role: VersusRole) => rpc<VersusRoom>('versus_take_seat', { p_room: roomId, p_role: role }),
  leaveRoom: (roomId: string) => rpc<{ left: boolean }>('versus_leave_room', { p_room: roomId }),
  startGame: (roomId: string) => rpc<VersusRoom>('versus_start_game', { p_room: roomId }),
  pressGate: (roomId: string) => rpc<VersusRoom>('versus_press_gate', { p_room: roomId }),
  reconcileRoom: (roomId: string) => rpc<VersusRoom>('versus_reconcile_room', { p_room: roomId }),
  heartbeat: (roomId: string) => rpc<{ serverNow: string; match?: VersusMatch; groupMatch?: VersusGroupMatchRaw }>('versus_heartbeat', { p_room: roomId }),

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
    // THE ONE READ of stored rounds: p2's result in p2's own perspective, whichever resolver stored it (a round stored
    // by the old mirror has its event sides unflipped: summons on the wrong row, live bug 2026-10-14).
    return ((data as VersusRoundRow[]) ?? []).map((r) => (r.p2_result ? { ...r, p2_result: ownSeatPerspective(r.p2_result as CombatResult) } : r));
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
  /** Spend my one hero re-roll on `slot`. The SERVER draws the replacement from `candidates` with the match seed. */
  rerollHero: (matchId: string, slot: number, candidates: string[]) =>
    rpc<VersusRerollResult>('versus_reroll_hero', { p_match: matchId, p_slot: slot, p_candidates: candidates }),
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

  // ── VERSUS GROUP (R-VERSUS-GROUP-01, 2026-10-24-versus-group.sql): the 3-4 player match's tables and RPCs. ──────
  async groupMatch(matchId: string): Promise<VersusGroupMatchRaw | null> {
    const { data, error } = await db().from('versus_group_matches').select('*').eq('id', matchId).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    // rows: at most four rows, one per seat (primary key match_id + seat) (R-NET-01).
    const { data: seats, error: e2 } = await db().from('versus_group_seats').select('*').eq('match_id', matchId).order('seat');
    if (e2) fail(e2);
    return { ...(data as Omit<VersusGroupMatchRaw, 'seats'>), seats: ((seats ?? []) as Record<string, unknown>[]).map(groupSeatOfRow) };
  },
  async groupRounds(matchId: string, fromRound = 1): Promise<VersusGroupRoundRaw[]> {
    // rows: one row per round; a group match ends long before 1,000 rounds (7 hearts each) (R-NET-01).
    const { data, error } = await db().from('versus_group_rounds').select('round, hearts, eliminated').eq('match_id', matchId).gte('round', fromRound).order('round');
    if (error) fail(error);
    if (!data?.length) return [];
    // rows: at most two fights per round (R-NET-01).
    const { data: fights, error: e2 } = await db().from('versus_group_fights').select('*').eq('match_id', matchId).gte('round', fromRound).order('round').order('fight');
    if (e2) fail(e2);
    const byRound = new Map<number, VersusGroupFightRow[]>();
    for (const f of (fights ?? []) as VersusGroupFightRow[]) byRound.set(f.round, [...(byRound.get(f.round) ?? []), f]);
    return (data as { round: number; hearts: VersusGroupRoundRaw['hearts']; eliminated: VersusGroupSeat[] }[])
      .map((r) => ({ round: r.round, hearts: r.hearts ?? {}, eliminated: r.eliminated ?? [], fights: byRound.get(r.round) ?? [] }))
      .filter((r) => r.fights.length > 0);
  },
  async groupMyPrivate(matchId: string): Promise<VersusPrivate | null> {
    const { data, error } = await db().from('versus_group_seat_private').select('*').eq('match_id', matchId).maybeSingle();
    if (error) fail(error);
    return (data as VersusPrivate | null) ?? null;
  },
  async groupMyLatestCheckpoint(matchId: string): Promise<VersusOwnSubmission | null> {
    const { data, error } = await db().from('versus_group_submissions').select('round, final, candidate_seq, checkpoint')
      .eq('match_id', matchId).eq('final', true).not('checkpoint', 'is', null).order('round', { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error);
    return (data as VersusOwnSubmission | null) ?? null;
  },
  groupRegisterOffer: (matchId: string, offer: string[]) => rpc<VersusGroupMatchRaw>('versus_group_register_offer', { p_match: matchId, p_offer: offer }),
  groupPickHero: (matchId: string, index: number) => rpc<VersusGroupMatchRaw>('versus_group_pick_hero', { p_match: matchId, p_index: index }),
  groupRerollHero: (matchId: string, slot: number, candidates: string[]) =>
    rpc<{ match: VersusGroupMatchRaw; offer: string[]; reroll: HeroReroll }>('versus_group_reroll_hero', { p_match: matchId, p_slot: slot, p_candidates: candidates }),
  groupSubmit: (matchId: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null) =>
    rpc<VersusGroupMatchRaw>('versus_group_submit', { p_match: matchId, p_round: round, p_seq: seq, p_side: side, p_final: final, p_checkpoint: checkpoint, p_scout: scout ?? null }),
  groupIntroDone: (matchId: string) => rpc<VersusGroupMatchRaw>('versus_group_intro_done', { p_match: matchId }),
  groupCombatReady: (matchId: string, round: number) => rpc<VersusGroupMatchRaw>('versus_group_combat_ready', { p_match: matchId, p_round: round }),
  groupForfeit: (matchId: string) => rpc<VersusGroupMatchRaw>('versus_group_forfeit', { p_match: matchId }),
  groupUnpause: (matchId: string) => rpc<VersusGroupMatchRaw>('versus_group_unpause', { p_match: matchId }),
  groupRequestResume: (matchId: string) => rpc<VersusGroupMatchRaw>('versus_group_request_resume', { p_match: matchId }),
  groupReconcile: (matchId: string) => rpc<VersusGroupMatchRaw>('versus_group_reconcile', { p_match: matchId }),
  groupPublishFrame: (matchId: string, seq: number, round: number, frame: unknown) =>
    rpc<void>('versus_group_publish_frame', { p_match: matchId, p_seq: seq, p_round: round, p_frame: frame }),
  async groupLatestFrames(matchId: string): Promise<{ seat: VersusGroupSeat; seq: number; round: number; frame: unknown }[]> {
    // rows: at most four rows per match, one per seat (primary key match_id + seat) (R-NET-01).
    const { data, error } = await db().from('versus_group_spectator_frames').select('seat, seq, round, frame').eq('match_id', matchId);
    if (error) fail(error);
    return (data as { seat: VersusGroupSeat; seq: number; round: number; frame: unknown }[]) ?? [];
  },
  /** VERSUS DUOS: ask the resolver to settle a Duos round (`finalize_duos`, idempotent server-side). */
  async finalizeDuos(matchId: string, round: number, contentRevision: string): Promise<void> {
    const { error } = await db().functions.invoke('versus-resolve', {
      body: { action: 'finalize_duos', protocol: VERSUS_PROTOCOL, contentRevision, matchId, round },
    });
    if (error) throw new VersusError('finalize_failed', (error as Error).message);
  },
  /** VERSUS DUOS: record a pass to my teammate (exactly once per seq; the run already paid the Gold). */
  duosPass: (matchId: string, round: number, seq: number, card: unknown) =>
    rpc<VersusDuosPassRow>('versus_duos_pass', { p_match: matchId, p_round: round, p_seq: seq, p_card: card }),
  /** VERSUS DUOS: my free hand slots (the server refuses a pass to a full hand: "Pass is refused if hand is full"). */
  duosHandRoom: (matchId: string, room: number) => rpc<void>('versus_duos_hand_room', { p_match: matchId, p_room: room }),
  /** VERSUS DUOS: my run's answer to a teammate's pass: it landed, or my full hand refused it. */
  duosAnswerPass: (matchId: string, fromSeat: VersusGroupSeat, seq: number, landed: boolean) =>
    rpc<VersusDuosPassRow>('versus_duos_answer_pass', { p_match: matchId, p_from_seat: fromSeat, p_seq: seq, p_landed: landed }),
  /** VERSUS DUOS: my team's passes from `fromRound` on (RLS: only the two teammates read them). */
  async duosPasses(matchId: string, fromRound: number): Promise<VersusDuosPassRow[]> {
    // rows: at most 10 passes per seat per round, two seats, read from the current round (R-NET-01).
    const { data, error } = await db().from('versus_duos_passes').select('match_id, round, from_seat, to_seat, seq, card, status')
      .eq('match_id', matchId).gte('round', fromRound).order('seq').limit(200);
    if (error) fail(error);
    return (data as VersusDuosPassRow[]) ?? [];
  },
  /** Ask the resolver to settle a group round (`finalize_group`, idempotent server-side). */
  async finalizeGroup(matchId: string, round: number, contentRevision: string): Promise<void> {
    const { error } = await db().functions.invoke('versus-resolve', {
      body: { action: 'finalize_group', protocol: VERSUS_PROTOCOL, contentRevision, matchId, round },
    });
    if (error) throw new VersusError('finalize_failed', (error as Error).message);
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
  subscribeRoom(roomId: string, matchId: string | null, onChange: (what: 'room' | 'members' | 'match' | 'rounds' | 'passes', row?: Record<string, unknown>) => void,
    onBroadcast?: (event: string, payload: unknown) => void): { channel: RealtimeChannel; send: (event: string, payload: unknown) => void; close: () => void } {
    const c = db();
    let ch = c.channel(`versus:${roomId}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_rooms', filter: `id=eq.${roomId}` }, () => onChange('room'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_members', filter: `room_id=eq.${roomId}` }, (p: { eventType?: string; new?: Record<string, unknown> }) => onChange('members', p.eventType === 'UPDATE' ? p.new : undefined));
    if (matchId) {
      // A match id lives in exactly one of the two match tables (1v1 or group): listening on both costs nothing.
      ch = ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_matches', filter: `id=eq.${matchId}` }, () => onChange('match'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'versus_rounds', filter: `match_id=eq.${matchId}` }, () => onChange('rounds'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_group_matches', filter: `id=eq.${matchId}` }, () => onChange('match'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'versus_group_rounds', filter: `match_id=eq.${matchId}` }, () => onChange('rounds'))
        // VERSUS DUOS: a teammate's pass (RLS lets only the team see the row, so only the teammates wake).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'versus_duos_passes', filter: `match_id=eq.${matchId}` }, (p: { new?: Record<string, unknown> }) => onChange('passes', p.new));
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

/** A `versus_group_seats` table row in the RPC json's camelCase shape. */
export function groupSeatOfRow(r: Record<string, unknown>): VersusGroupSeatRow {
  return {
    seat: r.seat as VersusGroupSeat, userId: String(r.user_id), name: String(r.name ?? ''), hearts: Number(r.hearts ?? 0),
    hero: (r.hero as string | null) ?? null, locked: !!r.locked, ready: !!r.ready, intro: !!r.intro, auto: !!r.auto,
    missed: Number(r.missed ?? 0), eliminatedRound: r.eliminated_round == null ? null : Number(r.eliminated_round),
    outReason: (r.out_reason as VersusGroupSeatRow['outReason']) ?? null, placement: r.placement == null ? null : Number(r.placement),
  };
}
export const versusRemote: VersusRemote = makeVersusRemote(supabaseClient);
