/**
 * VERSUS: the adapter's types and the game's one adapter (`versusRemote`, the Versus Worker on Cloudflare). No React, no
 * store: every call returns plain data or throws a `VersusError` with the server's error code, and every subscription
 * hands back an unsubscribe function. The row shapes are the ones the original SQL defined
 * (supabase/migrations/2026-10-13-versus.sql onward); the Worker answers in the same shapes and writes its results into
 * those tables through its limited writer, which is where every history / record screen reads them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { type RankResult, type HeroReroll, type PreparedCombatSide, type VersusGroupSeat, type VersusRoomOptions, type VersusSeat, type VersusSeatScout } from '@game/sim';
import type { BoardMinion, CombatResult } from '@game/core';
import { supabaseClient } from '../remoteBoards';
import { currentUserId, setIdentity } from '../identity';
import { makeCfVersusRemote, versusCfDevUrl, versusCfLiveUrl, versusCfSelected } from './versusCfRemote';
import { embeddedCfUrl, encodeRoomRef } from './versusHost';
import { contentRevision } from '@game/content';

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
  /** RANKED DUOS (2026-11-01-ranked-duos-party.sql): the party is listed for the host's friends only. */
  friends_only?: boolean;
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
  /** RANKED DUOS: a friends-only party (listed only to the host's friends). */
  friendsOnly?: boolean;
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
  /** LEGACY (hearts era, before 2026-10-26): still on the row for old matches; never moved now. */
  p1_hearts?: number | null;
  p2_hearts?: number | null;
  /** Each seat's Health and Armor after the last committed round (R-VERSUS-HEALTH-01, 2026-10-28-versus-health.sql).
   *  Null before round 1 commits: the seat is on its hero's start (`versusStartingVitals`). */
  p1_health?: number | null;
  p1_armor?: number | null;
  p2_health?: number | null;
  p2_armor?: number | null;
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
  end_reason: 'hearts' | 'forfeit' | 'missed' | 'abandoned' | 'void' | null;
  completed_at: string | null;
  serverNow?: string;
  /** The room options this match started with (R-VERSUS-OPTIONS-01). Null on a match before 2026-10-24. */
  options?: VersusRoomOptions | null;
  /** THE CLOSER (R-VERSUS-RELIABLE-02; fix/versus-server-reliability): true on an answer to MY call (submit / reconcile)
   *  when that call closed the round, so this client alone asks the resolver at once. Absent on an older server. */
  closed_by_me?: boolean;
  /** THE SERVER'S RESOLVE RETRY (fix/versus-server-reliability): 0 when the round entered `resolving`, bumped each time
   *  the server wants the resolver asked again. Absent on an older server. */
  resolve_retry?: number | null;
  /** VERSUS GROUP (R-VERSUS-GROUP-01): this row is a 3-4 player match PROJECTED onto the 1v1 shape from one seat's
   *  side (`versusGroupView.ts`): p1 = that seat, p2 = its opponent this round. The full table rides here. */
  group?: VersusGroupView;
}

/** One seat of a group match, as `versus_group__match_json` (and the client's own table read) names it. */
export interface VersusGroupSeatRow {
  seat: VersusGroupSeat;
  userId: string;
  name: string;
  /** LEGACY (hearts era): kept readable for old matches. */
  hearts?: number | null;
  /** The seat's Health and Armor after the last committed round (Duos: its team's pool); null before round 1. */
  health: number | null;
  armor: number | null;
  hero: string | null;
  locked: boolean;
  ready: boolean;
  intro: boolean;
  auto: boolean;
  missed: number;
  eliminatedRound: number | null;
  outReason: 'hearts' | 'forfeit' | 'left' | 'missed' | null;
  placement: number | null;
  /** RANKED DUOS (2026-10-29-ranked-duos.sql): when the seat ended its turn, went auto, left the match for good (table
   *  reads only; an RPC answer carries `VersusGroupMatchRaw.endedAt` / `leftAt` instead). */
  lockedAt?: string | null;
  autoSince?: string | null;
  leftAt?: string | null;
  /** RANKED DUOS (client only): a recorded team's member, seated virtually (p3..p8) for the Duos helpers. */
  served?: boolean;
  /** A seat's team letter (Duos / Ranked Duos). */
  team?: string | null;
}

/** RANKED DUOS: one recorded team member as the rail shows it (`versus_ranked_duos_table`). */
export interface RankedDuosServedRow {
  team: string;
  member: 0 | 1;
  name: string;
  hero: string;
  kind: 'duo' | 'solo' | 'generated';
  /** This round's board (a team that is out: the round it fell), null before its recording begins. */
  board: { minions: BoardMinion[]; tier: number | null } | null;
}

/** RANKED DUOS: the recorded teams (one read per shop). */
export interface RankedDuosTableRaw {
  round: number;
  teamName: string | null;
  served: RankedDuosServedRow[];
  /** A recorded duo run's own fight order for the round served (team -> member first); absent = the seeded 50/50. */
  orders?: Record<string, 0 | 1>;
  /** A recorded duo run's team name (when that pair named itself). */
  teamNames?: Record<string, string>;
}

/** RANKED DUOS: one team's row (`versus_group_teams`). */
export interface RankedDuosTeamRead {
  team: string;
  health: number | null;
  armor: number | null;
  eliminated_round: number | null;
  placement: number | null;
  served_kind: string | null;
}

/** RANKED DUOS: one fight row (`versus_ranked_duos_fights`): the live team's own fight carries `live_result`. */
export interface RankedDuosFightRow {
  round: number;
  fight: number;
  a_team: string;
  b_team: string;
  ghost: boolean;
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  loser: string | null;
  damage: number;
  first: Record<string, 0 | 1> | null;
  live_result: CombatResult | null;
}

/** RANKED DUOS: a committed round (`versus_group_rounds`: every team's pool after it, keyed by team letter). */
export interface RankedDuosRoundRow {
  round: number;
  vitals: Record<string, { health: number; armor: number }>;
  fights: RankedDuosFightRow[];
}

/** A group match row with its seats (`versus_group_matches` + `versus_group_seats`). */
export interface VersusGroupMatchRaw {
  id: string;
  /** THE CLOSER (R-VERSUS-RELIABLE-02): see `VersusMatch.closed_by_me`. */
  closed_by_me?: boolean;
  /** See `VersusMatch.resolve_retry`. */
  resolve_retry?: number | null;
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
  end_reason: 'hearts' | 'forfeit' | 'missed' | 'abandoned' | 'void' | null;
  completed_at: string | null;
  serverNow?: string;
  seats: VersusGroupSeatRow[];
  /** RANKED DUOS (`versus_ranked_duos__json` / the table row): when the round closes, who ended when, who left, the
   *  pair's team identity and name, the table seated, why it is unrated. Absent on every other mode. */
  closeAt?: string | null;
  endedAt?: Record<string, string | null>;
  leftAt?: Record<string, string | null>;
  teamName?: string | null;
  ranked_team?: string | null;
  seated_at?: string | null;
  seated?: boolean;
  unrated?: string | null;
  /** RANKED DUOS (client only, `withServedSeats`): the recorded duo runs' team names. */
  servedTeamNames?: Record<string, string>;
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
  /** When the server recorded it: a reload replays the round's passes in this order (passing back, 2026-10-25). */
  created_at?: string;
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
  /** The seat that took the fight's damage (named for the hearts era; null on a draw or a copy / ghost loss). */
  heart_lost_by: VersusGroupSeat | null;
  /** The damage it took (the lobby formula, capped). Null on a hearts-era round. */
  damage?: number | null;
  a_result: CombatResult;
  b_result: CombatResult;
  a_scout: VersusSeatScout | null;
  b_scout: VersusSeatScout | null;
}

/** A committed group round: every seat's Health and Armor after it and its fights. */
export interface VersusGroupRoundRaw {
  round: number;
  /** Every seat's pools after the round (R-VERSUS-HEALTH-01). Empty on a hearts-era round. */
  vitals: Partial<Record<VersusGroupSeat, { health: number; armor: number }>>;
  /** LEGACY (hearts era). */
  hearts?: Partial<Record<VersusGroupSeat, number>> | null;
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
  /** The seat that lost the round and took its damage (named for the hearts era). */
  heart_lost_by: VersusSeat | null;
  p1_result: unknown;
  p2_result: unknown;
  digest: string;
  /** LEGACY (hearts era): null on a round committed since 2026-10-26. */
  p1_hearts?: number | null;
  p2_hearts?: number | null;
  /** Each seat's Health and Armor after the round, and the damage it took (R-VERSUS-HEALTH-01). Null on an old round. */
  p1_health?: number | null;
  p1_armor?: number | null;
  p2_health?: number | null;
  p2_armor?: number | null;
  p1_damage?: number | null;
  p2_damage?: number | null;
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
 * THE VERSUS ADAPTER (Cloudflare only since 2026-10-29, R-VERSUS-CF-ONLY-01): every room and match call is served by the
 * room's Durable Object on the Versus Worker (`makeCfVersusRemote`). The few RECORD reads and writes that live in
 * Supabase (a Duos team's name, its ranked result, the leaderboard, a player's teams, the dev bot flag) go through
 * `makeVersusRecords`, whichever room produced them.
 */
export interface VersusRemote {
  listRooms: () => Promise<VersusRoomSummary[]>;
  /** How many rooms I could join right now (open, fresh, my version, not mine): two integers, no rows
   *  (2026-10-17-versus-open-rooms.sql, R-VERSUS-OPEN-ROOMS-01). The menus' "2 open" indicator. */
  openRooms: (contentRevision: string) => Promise<{
      open: number;
      seatOpen: number;
      duosOpen?: number;
  }>;
  /** The host keeps the party to friends (or lists it). */
  setFriendsOnly: (roomId: string, on: boolean) => Promise<VersusRoom>;
  /** FRIEND INVITES (R-VERSUS-CF-INVITE-01): the room's signed check for an invite (`friends_invite` needs it). */
  inviteProof: (roomId: string, to: string, kind: string) => Promise<string | null>;
  /** Name my team with `partner` (blank = the default "Name1 & Name2"). */
  setTeamName: (partner: string, name: string) => Promise<{
      id: string;
      name: string | null;
  }>;
  /** My team's result for one match (RLS: only the two teammates read it), as the rank screen reads a result. */
  duosResult(matchId: string): Promise<RankResult | null>;
  /** The pair's team row (name), or null before the pair has played or named itself. */
  duosTeam(a: string, b: string): Promise<{
      id: string;
      name: string | null;
  } | null>;
  /** The Duos leaderboard: teams by division then points (this season). */
  duosLeaderboard: (limit?: number, offset?: number) => Promise<DuosLeaderboardRow[]>;
  /** A player's Duos teams (the Career). */
  duosTeamsOf: (userId: string) => Promise<DuosTeamOfRow[]>;
  createRoom: (name: string, me: VersusIdentity, options?: VersusRoomOptions | null) => Promise<VersusRoom>;
  /** The host sets the room's options while it is Open (R-VERSUS-OPTIONS-01; 2026-10-24-versus-group.sql). */
  setOptions: (roomId: string, options: VersusRoomOptions) => Promise<VersusRoom>;
  joinRoom: (roomId: string, as: "player" | "spectator", me: VersusIdentity) => Promise<VersusRoom>;
  takeSeat: (roomId: string, role: VersusRole) => Promise<VersusRoom>;
  leaveRoom: (roomId: string) => Promise<{
      left: boolean;
  }>;
  startGame: (roomId: string) => Promise<VersusRoom>;
  pressGate: (roomId: string) => Promise<VersusRoom>;
  reconcileRoom: (roomId: string) => Promise<VersusRoom>;
  /** `seen` (2026-10-27-versus-egress.sql): the room members' last heartbeats, sent only while the match is paused. */
  heartbeat: (roomId: string) => Promise<{
      serverNow: string;
      match?: VersusMatch;
      groupMatch?: VersusGroupMatchRaw;
      seen?: Record<string, string>;
  }>;
  room(roomId: string): Promise<VersusRoom | null>;
  /** The room this account is a member of, if any (a returning player rejoins it). */
  myRoomId(userId: string): Promise<string | null>;
  match(matchId: string): Promise<VersusMatch | null>;
  myPrivate(matchId: string): Promise<VersusPrivate | null>;
  rounds(matchId: string, fromRound?: number): Promise<VersusRoundRow[]>;
  /** My newest LOCKED submission with a checkpoint (the reconnect restore point). */
  myLatestCheckpoint(matchId: string): Promise<VersusOwnSubmission | null>;
  registerOffer: (matchId: string, offer: string[]) => Promise<VersusMatch>;
  pickHero: (matchId: string, index: number) => Promise<VersusMatch>;
  /** Spend my one hero re-roll on `slot`. The SERVER draws the replacement from `candidates` with the match seed. */
  rerollHero: (matchId: string, slot: number, candidates: string[]) => Promise<VersusRerollResult>;
  /** A candidate or the lock. `scout` is my public state for the opponent's scout card, recorded on the round once it
   *  is fought (2026-10-14-versus-scout.sql). A server without that migration takes the submit without it. */
  submit(matchId: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null): Promise<VersusMatch>;
  /** My game start (Hero Select ceremony + Good Luck) has played out; round 1's clock starts when both have. */
  introDone: (matchId: string) => Promise<VersusMatch>;
  combatReady: (matchId: string, round: number) => Promise<VersusMatch>;
  forfeit: (matchId: string) => Promise<VersusMatch>;
  unpause: (matchId: string) => Promise<VersusMatch>;
  /** Back from a disconnect: start the 3-2-1 that resumes the match (`resume_at`). */
  requestResume: (matchId: string) => Promise<VersusMatch>;
  reconcile: (matchId: string) => Promise<VersusMatch>;
  /** 1v1 (R-VERSUS-READY-01): take back my End Turn while the clock is above 0:00 (`versus_unready`). */
  unready: (matchId: string, round: number, seq: number) => Promise<VersusMatch>;
  publishFrame: (matchId: string, seq: number, round: number, frame: unknown) => Promise<void>;
  latestFrames(matchId: string): Promise<{
      seat: VersusSeat;
      seq: number;
      round: number;
      frame: unknown;
  }[]>;
  groupMatch(matchId: string): Promise<VersusGroupMatchRaw | null>;
  groupRounds(matchId: string, fromRound?: number): Promise<VersusGroupRoundRaw[]>;
  groupMyPrivate(matchId: string): Promise<VersusPrivate | null>;
  groupMyLatestCheckpoint(matchId: string): Promise<VersusOwnSubmission | null>;
  groupRegisterOffer: (matchId: string, offer: string[]) => Promise<VersusGroupMatchRaw>;
  groupPickHero: (matchId: string, index: number) => Promise<VersusGroupMatchRaw>;
  groupRerollHero: (matchId: string, slot: number, candidates: string[]) => Promise<{
      match: VersusGroupMatchRaw;
      offer: string[];
      reroll: HeroReroll;
  }>;
  groupSubmit: (matchId: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null) => Promise<VersusGroupMatchRaw>;
  groupIntroDone: (matchId: string) => Promise<VersusGroupMatchRaw>;
  groupCombatReady: (matchId: string, round: number) => Promise<VersusGroupMatchRaw>;
  groupForfeit: (matchId: string) => Promise<VersusGroupMatchRaw>;
  groupUnpause: (matchId: string) => Promise<VersusGroupMatchRaw>;
  groupRequestResume: (matchId: string) => Promise<VersusGroupMatchRaw>;
  groupReconcile: (matchId: string) => Promise<VersusGroupMatchRaw>;
  groupPublishFrame: (matchId: string, seq: number, round: number, frame: unknown) => Promise<void>;
  groupLatestFrames(matchId: string): Promise<{
      seat: VersusGroupSeat;
      seq: number;
      round: number;
      frame: unknown;
  }[]>;
  /** VERSUS DUOS: ask the resolver to settle a Duos round (`finalize_duos`, idempotent server-side). */
  finalizeDuos(matchId: string, round: number, contentRevision: string): Promise<void>;
  /** RANKED DUOS: settle a round (`finalize_ranked_duos`: seats the table first if needed; idempotent server-side). */
  finalizeRankedDuos(matchId: string, round: number, contentRevision: string): Promise<void>;
  /** RANKED DUOS: seat the recorded teams once both heroes are locked (`seat_ranked_duos`, idempotent server-side). */
  seatRankedDuos(matchId: string, contentRevision: string): Promise<void>;
  /** RANKED DUOS: the recorded teams, their names and heroes and this round's boards (one small read per shop). */
  rankedTable: (matchId: string) => Promise<RankedDuosTableRaw>;
  /** RANKED DUOS: the four teams' rows (pools, placements). */
  rankedTeams(matchId: string): Promise<RankedDuosTeamRead[]>;
  /** RANKED DUOS: committed rounds from `fromRound`: every team's pool, every fight's result, and the live team's own fight
   *  in full (owner Q11: the other pairing is a result only, so only one full fight per round is ever read). */
  rankedRounds(matchId: string, fromRound?: number): Promise<RankedDuosRoundRow[]>;
  /** VERSUS GROUP / DUOS / RANKED DUOS (R-VERSUS-READY-01): take back my End Turn while the clock is above 0:00
   *  (`versus_group_unready`). `seq` fences out a re-lock still in flight from before the press. Answers the match row
   *  (group json, Ranked Duos json for that mode). */
  groupUnready: (matchId: string, round: number, seq: number) => Promise<VersusGroupMatchRaw>;
  /** VERSUS DUOS: record a pass to my teammate (exactly once per seq; the run already paid the Gold). */
  duosPass: (matchId: string, round: number, seq: number, card: unknown) => Promise<VersusDuosPassRow>;
  /** VERSUS DUOS: my free hand slots (the server refuses a pass to a full hand: "Pass is refused if hand is full"). */
  duosHandRoom: (matchId: string, room: number) => Promise<void>;
  /** VERSUS DUOS: my run's answer to a teammate's pass: it landed, or my full hand refused it. */
  duosAnswerPass: (matchId: string, fromSeat: VersusGroupSeat, seq: number, landed: boolean) => Promise<VersusDuosPassRow>;
  /** VERSUS DUOS: my team's passes from `fromRound` on (RLS: only the two teammates read them). */
  duosPasses(matchId: string, fromRound: number): Promise<VersusDuosPassRow[]>;
  /** The calling (anonymous) bot account names the host whose browser drives it. */
  testBotRegister: (host: string, slot: number) => Promise<unknown>;
  /** DEV: set a living seat's Health and Armor (Duos: its team's pool). Host only, every other seat one of the host's bots. */
  devSetVitals: (matchId: string, seat: VersusGroupSeat, health: number, armor: number) => Promise<VersusGroupMatchRaw>;
  /** DEV: the shop clock jumps to 5 seconds. */
  devSkipShop: (matchId: string) => Promise<VersusGroupMatchRaw>;
  /** Settle a group round. The Worker resolves every round itself the moment it closes, so this is a no-op kept for the
   *  store's one code path. */
  finalizeGroup(matchId: string, round: number, contentRevision: string): Promise<void>;
  /** Settle a `resolving` round (a no-op on the Worker, which resolves the round itself). */
  finalize(matchId: string, round: number, contentRevision: string): Promise<void>;
  /** The room's wake-ups: "something changed, read it again" (the room's socket pushes the new rows with it), plus the
   *  match's BROADCAST events (spectator deltas, emotes). Answers a sender on the room and its close. */
  subscribeRoom(roomId: string, matchId: string | null, onChange: (what: "room" | "members" | "match" | "rounds" | "passes", row?: Record<string, unknown>) => void, onBroadcast?: (event: string, payload: unknown) => void): {
      send: (event: string, payload: unknown) => void;
      close: () => Promise<unknown>;
  };
}

/** The Supabase-held RECORDS the Versus screens read and write (the rest of `VersusRemote` is the Worker's). */
export type VersusRecords = Pick<VersusRemote, 'setTeamName' | 'duosResult' | 'duosTeam' | 'duosLeaderboard' | 'duosTeamsOf' | 'testBotRegister'>;

/** The records over ONE Supabase client (the game's own, or a dev bot's). */
export function makeVersusRecords(getClient: () => SupabaseClient | null): VersusRecords {
  const db = (): SupabaseClient => {
    const c = getClient();
    if (!c) throw new VersusError('no_backend');
    return c;
  };
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    // NO CALL HANGS FOREVER (R-VERSUS-RELIABLE-05): supabase-js has no fetch timeout of its own.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), VERSUS_RPC_TIMEOUT_MS);
    try {
      // rows: every records RPC returns ONE jsonb value or a list capped by its own limit, never a table (R-NET-01).
      const { data, error } = await db().rpc(fn, args).abortSignal(abort.signal);
      if (error) fail(abort.signal.aborted ? { message: 'network' } : error);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    /** Name my team with `partner` (blank = the default "Name1 & Name2"). */
    setTeamName: (partner: string, name: string) => rpc<{ id: string; name: string | null }>('duos_team_set_name', { p_partner: partner, p_name: name }),
    /** My team's result for one match (RLS: only the two teammates read it), as the rank screen reads a result. */
    async duosResult(matchId: string): Promise<RankResult | null> {
      // rows: at most one row per team per match (primary key team_id + match_id) (R-NET-01).
      const { data, error } = await db().from('duos_rank_results').select('*').eq('match_id', matchId).limit(1);
      if (error) fail(error);
      const r = (data as Record<string, unknown>[] | null)?.[0];
      return r ? duosRankResultOfRow(r) : null;
    },
    /** The pair's team row (name), or null before the pair has played or named itself. */
    async duosTeam(a: string, b: string): Promise<{ id: string; name: string | null } | null> {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      // rows: at most one (unique user_lo + user_hi) (R-NET-01).
      const { data, error } = await db().from('duos_teams').select('id, name').eq('user_lo', lo).eq('user_hi', hi).limit(1);
      if (error) fail(error);
      return ((data as { id: string; name: string | null }[] | null) ?? [])[0] ?? null;
    },
    /** The Duos leaderboard: teams by division then points (this season). */
    duosLeaderboard: (limit = 50, offset = 0) => rpc<DuosLeaderboardRow[]>('duos_leaderboard', { p_limit: limit, p_offset: offset }),
    /** A player's Duos teams (the Career). */
    duosTeamsOf: (userId: string) => rpc<DuosTeamOfRow[]>('duos_teams_of', { p_user: userId }),
    /** DEV: the calling (anonymous) bot account names the host whose browser drives it (2026-10-25-versus-test-bots.sql). */
    testBotRegister: (host: string, slot: number) => rpc<unknown>('versus_test_bot_register', { p_host: host, p_slot: slot }),
  };
}

/** Every Versus records RPC is aborted after this long (R-VERSUS-RELIABLE-05). */
export const VERSUS_RPC_TIMEOUT_MS = 8000;

/** A `versus_group_seats` table row in the RPC json's camelCase shape. */
export function groupSeatOfRow(r: Record<string, unknown>): VersusGroupSeatRow {
  return {
    seat: r.seat as VersusGroupSeat, userId: String(r.user_id), name: String(r.name ?? ''),
    health: r.health == null ? null : Number(r.health), armor: r.armor == null ? null : Number(r.armor),
    hero: (r.hero as string | null) ?? null, locked: !!r.locked, ready: !!r.ready, intro: !!r.intro, auto: !!r.auto,
    missed: Number(r.missed ?? 0), eliminatedRound: r.eliminated_round == null ? null : Number(r.eliminated_round),
    outReason: (r.out_reason as VersusGroupSeatRow['outReason']) ?? null, placement: r.placement == null ? null : Number(r.placement),
    ...(r.locked_at !== undefined ? { lockedAt: (r.locked_at as string | null) ?? null } : {}),
    ...(r.auto_since !== undefined ? { autoSince: (r.auto_since as string | null) ?? null } : {}),
    ...(r.left_at !== undefined ? { leftAt: (r.left_at as string | null) ?? null } : {}),
    ...(r.team !== undefined ? { team: (r.team as string | null) ?? null } : {}),
  };
}
/** A `duos_rank_results` row as the rank screen's `RankResult` (the match id stands in for the run id). */
export function duosRankResultOfRow(r: Record<string, unknown>): RankResult {
  const n = (k: string): number => Number(r[k] ?? 0);
  const b = (k: string): boolean => r[k] === true;
  return {
    runId: String(r.match_id), seasonId: n('season'), rulesVersion: n('rules_version'),
    revisionBefore: n('revision_before'), revisionAfter: n('revision_after'), placement: n('placement'),
    before: { divisionIndex: n('division_before'), points: n('points_before'), demotionReady: b('demotion_ready_before') },
    after: { divisionIndex: n('division_after'), points: n('points_after'), demotionReady: b('demotion_ready_after') },
    baseDelta: n('base_delta'), strengthBonus: 0, lobbyStrength: null, appliedDelta: n('applied_delta'), cappedPoints: n('capped_points'),
    wasPromotionGame: b('was_promotion_game'), promotionKind: (r.promotion_kind as RankResult['promotionKind']) ?? null,
    requiredFinish: r.required_finish == null ? null : n('required_finish'),
    promotionUnlocked: b('promotion_unlocked'), promoted: b('promoted'),
    wasDemotionGame: b('was_demotion_game'), demotionUnlocked: b('demotion_unlocked'), demoted: b('demoted'),
    highestAfter: { divisionIndex: n('highest_division_after'), points: n('highest_points_after') },
  };
}

/** One Duos leaderboard row (`duos_leaderboard`). */
export interface DuosPlayerCard { userId: string; name: string | null; discriminator: string | null; hero: string | null }
export interface DuosLeaderboardRow { teamId: string; name: string | null; division: number; points: number; demotionReady: boolean; games: number; players: [DuosPlayerCard | null, DuosPlayerCard | null] }
/** One of a player's Duos teams (`duos_teams_of`). */
export interface DuosTeamOfRow { teamId: string; name: string | null; partner: DuosPlayerCard | null; division: number; points: number; games: number }

/**
 * The game's adapter: the Versus Worker, and nothing else (owner 2026-10-29: "why are we using supabase for versus instead
 * of cloudflare? stop doing that"; R-VERSUS-CF-ONLY-01). The Worker is the one the pack baked in (`VITE_VERSUS_CF_URL`,
 * set by `npm run release:web`) when it is this build's own engine, else the deployed Worker named after this build's
 * engine. A dev build does the same: the DEPLOYED Worker of its own engine, as a pack (R-VERSUS-DEV-DEPLOYED-01, owner
 * 2026-10-31: Versus "Create room" and Ranked Duos on the dev server both showed "Connection problem. Try again."; a dev
 * build with no pick used to target local `wrangler dev`, which nothing served). Only a dev tab that PICKED a Worker
 * (`?versusHost=cf` for `npm run versus:cf:dev`, `?versusCfUrl=`, `?versusHost=cf-live`) talks to that one, and only
 * there is the dev-identity token used (a deployed Worker refuses it; a signed-in tab sends its real Supabase token).
 * A Worker that cannot be reached is an error the screens show with Try again, never a room on another backend.
 */
const devCf = versusCfSelected();
const cfUrl: string = devCf ? versusCfDevUrl() : embeddedCfUrl(import.meta.env.VITE_VERSUS_CF_URL) ?? versusCfLiveUrl();

/**
 * R-VERSUS-DEV-DEPLOYED-01: a dev build ahead of the last pack has no deployed Worker for its engine. When a call fails
 * without the Worker answering, its `/health` is probed (a success is remembered, so a reachable Worker is probed once)
 * and a missing Worker says so plainly instead of "Connection problem".
 */
let workerSeen = false;
export async function devWorkerMissing(url: string = cfUrl, f: typeof fetch = fetch): Promise<string | null> {
  if (workerSeen) return null;
  try {
    const res = await f(`${url.replace(/\/$/, '')}/health`);
    if (res.ok) { workerSeen = true; return null; }
  } catch { /* no answer at all: a workers.dev name with no Worker behind it answers without CORS */ }
  return 'server_not_deployed';
}
/** For the tests. */
export function resetDevWorkerProbeForTests(): void { workerSeen = false; }

export const versusRemote: VersusRemote = makeCfVersusRemote({
  baseUrl: cfUrl, getClient: supabaseClient, currentUserId, makeError: (code, message) => new VersusError(code, message),
  adoptDevIdentity: devCf ? (userId) => setIdentity({ userId, displayName: 'Dev', anonymous: true, email: null }) : undefined,
  whyUnreachable: import.meta.env.DEV && !devCf ? () => devWorkerMissing() : undefined,
  // The Supabase-held records (a Duos team's name and ranked result, the leaderboard) are read where they live.
  records: makeVersusRecords(supabaseClient),
});
/** The Worker this tab plays Versus on (the dev test bots join the same one). */
export const versusWorkerUrl = (): string => cfUrl;
/** A room as it travels in an invite / a Watch id / a Live Games row: `cf:<id>` (every room is on the Worker). */
export const versusRoomRef = (room: Pick<VersusRoom, 'id'>): string => encodeRoomRef(room.id);

/**
 * LIVE GAMES ON CLOUDFLARE (R-LIVE-CF-01): the Worker a NEW live lobby / Practice game publishes to: this build's own
 * Worker (the server switch is no longer read, R-VERSUS-CF-ONLY-01).
 */
export function lobbyLivePublishUrl(): string {
  // A dev build with no Worker pick does not list its games on the deployed Worker (R-VERSUS-DEV-DEPLOYED-01 moved only
  // its Versus rooms there): its Live Games publish still targets local `wrangler dev`, as before.
  return devCf || !import.meta.env.DEV ? cfUrl : versusCfDevUrl();
}

/**
 * The Worker that hosts a game whose row says `cf:<content revision>`: ALWAYS the deployed Worker named after that
 * engine (a dev tab's explicit pick aside). Every listed row was written by a deployed Worker (a local `wrangler dev`
 * writes no rows), so it is never this build's own fallback. Before (R-LIVE-WATCH-REACH-01, owner 2026-10-30: "i keep
 * getting this error trying to spectate"): a dev build on the same engine as the game sent the watch to its local
 * `wrangler dev` (127.0.0.1:8787), which nothing was serving, and every Watch timed out as "Could not reach that game".
 * A pack's own Worker IS `versusCfLiveUrl(<its revision>)` (`embeddedCfUrl`), so a live build is unchanged. The
 * watcher's own engine does not matter: the object never refuses a watcher by revision (spectators render projections).
 */
export function lobbyLiveWatchUrl(liveHost: string): string {
  const rev = liveHost.startsWith('cf:') ? liveHost.slice(3) : liveHost;
  if (devCf) return cfUrl;
  return versusCfLiveUrl(rev || contentRevision());
}
