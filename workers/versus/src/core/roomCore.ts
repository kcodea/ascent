/**
 * VERSUS ON CLOUDFLARE — the room's rules, as a pure state machine (spike, 2026-10-28; 1v1 only).
 *
 * This is the 1v1 half of the Supabase Versus SQL (`supabase/migrations/2026-10-13-versus.sql` and its follow-ups:
 * shop-start, ready-pause, scout, clock-grace, hero-reroll, health, ready-signal, live-armor), ported function by
 * function so a room behaves the same on either backend. The Durable Object (`../room.ts`) is only a shell around it:
 * sockets, storage, alarms. Everything here is synchronous except the round resolve, and nothing here touches the
 * network, a clock or a random source directly: `now` comes in with every call and seeds come from `deps.random31`,
 * so tests drive it with a fake clock (`test/roomCore.test.ts`).
 *
 * THE ROUND RESOLVES IN HERE. When both seats are locked (or the shop deadline + 250 ms grace passes) the match moves to
 * `resolving` and, in the same call, `handleVersusFinalize` (the exact handler the `versus-resolve` Edge Function runs,
 * from `@game/sim/versus/server`) resolves the one fight over an in-memory store and commits it. There is no client
 * "finalize" call, no second resolver, no row lock: the object is single-threaded.
 *
 * PRESENCE IS THE SOCKET. A seat is "gone" when it has no open socket for `DISCONNECT_GRACE_MS` (the shell also drops a
 * socket whose keep-alive went stale). That replaces the 12 s heartbeat lease: a closed tab pauses the match in about
 * 3 s, not 12-20 s.
 *
 * Seat names, row shapes and error codes are the SQL's, so the existing Versus store reads these rows unchanged.
 */
import {
  engineContentRevision,
  handleVersusFinalize,
  normalizeVersusOptions,
  reportedVitals,
  versusArmorFloorMax,
  versusFreshSide,
  versusOptionsError,
  VERSUS_COMBAT_VIEW_CAP_SECONDS,
  VERSUS_GATE_SECONDS,
  VERSUS_HERO_SELECT_SECONDS,
  VERSUS_INTRO_CAP_SECONDS,
  VERSUS_LIMITS,
  VERSUS_MISSED_ROUNDS_FORFEIT,
  VERSUS_PAUSE_GRACE_SECONDS,
  VERSUS_PROTOCOL,
  VERSUS_SPECTATOR_CAP,
  type VersusFinalizeStore,
} from '@game/sim/versus/server';
import { GroupEngine, GSEATS, newGroupState, type GroupHost, type GroupState, type GSeat } from './groupMatch';

export type Seat = 'p1' | 'p2';
/** A room role: a player seat (p3 / p4 only in a Group room) or the stands. */
export type Role = GSeat | 'spectator';
export const SEATS: readonly Seat[] = ['p1', 'p2'];
const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

/** A closed socket is given this long to come back before its seat counts as gone (a reload, a network hand-over). */
export const DISCONNECT_GRACE_MS = 3_000;
/** Shop deadline grace: a lock sent at 0:00 still counts (`versus__shop_grace`, R-VERSUS-CLOCK-LOCK-01). */
export const SHOP_GRACE_MS = 250;
/** The other player gets this long to press End Combat once one has (`versus_combat_ready`). */
export const COMBAT_LAST_READY_MS = 5_000;
/** The Unpause / back-from-disconnect 3-2-1. */
export const RESUME_COUNTDOWN_MS = 3_000;
/** Both players gone this long into a pause: the match is abandoned (`versus_reconcile`). */
export const ABANDON_MS = 10 * 60_000;
/** A member with no socket this long leaves the room (an open room, or the stands). Seated players in a match never do:
 *  the pause, auto and abandon rules handle them. Mirrors the open-room listing's "seen in the last 2 minutes". */
export const MEMBER_PRUNE_MS = 2 * 60_000;
/** A room with no match running and no request for this long closes itself (everyone leaves, storage is deleted once
 *  the outbox drains): a forgotten tab never keeps a room, or its alarm, alive. */
export const ROOM_IDLE_MS = 30 * 60_000;
/** Spectator frame cap (`versus_publish_frame`). */
const FRAME_BYTES = VERSUS_LIMITS.spectatorFrameBytes;
const CHECKPOINT_BYTES = 1_048_576;
const SCOUT_BYTES = 8_192;
const PROFILE_BYTES = 4_096;

export class CoreError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new CoreError(code);
};

// ── State ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CoreMember {
  userId: string;
  role: Role;
  displayName: string;
  profile: Record<string, unknown>;
  joinedAt: number;
  /** When the member's last socket closed (null while one is open). */
  disconnectedAt: number | null;
}

export interface CoreRoom {
  id: string;
  name: string;
  host_user_id: string;
  status: 'open' | 'sealed' | 'in_game';
  set_id: string;
  content_revision: string;
  protocol: number;
  revision: number;
  gate_deadline: number | null;
  p1_gate: boolean;
  p2_gate: boolean;
  /** Group rooms: seats 3 and 4's gates (absent on rooms stored before the Group port = false). */
  p3_gate?: boolean;
  p4_gate?: boolean;
  current_match_id: string | null;
  options: Record<string, unknown>;
  options_rev: number;
  options_changed_at: number | null;
  friends_only: boolean;
  created_at: number;
  updated_at: number;
  members: CoreMember[];
  /** Everyone left: the object deletes its storage once the outbox is drained. */
  closed: boolean;
  /** The last client request (the idle self-destruct clock). Absent on rooms stored before 2026-10-28 (= created_at). */
  last_activity_at?: number;
}

export type Phase = 'hero_select' | 'shop' | 'resolving' | 'combat' | 'complete';

export interface CoreMatch {
  id: string;
  room_id: string;
  seed: number;
  set_id: string;
  content_revision: string;
  protocol: number;
  phase: Phase;
  revision: number;
  round: number;
  p1_user: string;
  p2_user: string;
  p1_name: string;
  p2_name: string;
  p1_health: number | null;
  p1_armor: number | null;
  p2_health: number | null;
  p2_armor: number | null;
  p1_hero: string | null;
  p2_hero: string | null;
  heroes_revealed: boolean;
  hero_deadline: number | null;
  shop_starts_at: number | null;
  shop_deadline: number | null;
  combat_deadline: number | null;
  p1_locked: boolean;
  p2_locked: boolean;
  p1_ready: boolean;
  p2_ready: boolean;
  p1_intro: boolean;
  p2_intro: boolean;
  intro_deadline: number | null;
  paused_seat: Seat | null;
  paused_at: number | null;
  pause_grace_until: number | null;
  resume_at: number | null;
  p1_auto: boolean;
  p2_auto: boolean;
  p1_missed: number;
  p2_missed: number;
  winner_seat: Seat | null;
  /** 'void' (R-VERSUS-RESOLVE-TIMEOUT-01, 2026-11-02): a round that could not be resolved ends the match, no winner. */
  end_reason: 'hearts' | 'forfeit' | 'missed' | 'abandoned' | 'void' | null;
  options: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface CorePrivate {
  match_id: string;
  seat: Seat;
  user_id: string;
  hero_seed: number;
  run_seed: number;
  hero_offer: string[] | null;
  hero_index: number | null;
  hero_auto: boolean;
  hero_reroll: { slot: number; from: string; to: string } | null;
}

export type SubmissionSource = 'candidate' | 'lock' | 'deadline' | 'auto' | 'empty';

export interface CoreSubmission {
  round: number;
  seat: Seat;
  user_id: string;
  candidate_seq: number;
  prepared_side: unknown;
  final: boolean;
  source: SubmissionSource;
  checkpoint: unknown;
  scout: Record<string, unknown> | null;
}

export interface CheckpointRow {
  round: number;
  final: true;
  candidate_seq: number;
  checkpoint: unknown;
}

/** One committed round, exactly the `versus_rounds` row the Supabase build stores. */
export interface RoundRow {
  match_id: string;
  round: number;
  chair: Seat;
  outcome: Seat | 'draw';
  heart_lost_by: Seat | null;
  p1_result: unknown;
  p2_result: unknown;
  digest: string;
  p1_hearts: null;
  p2_hearts: null;
  p1_health: number;
  p1_armor: number;
  p2_health: number;
  p2_armor: number;
  p1_damage: number;
  p2_damage: number;
  p1_scout: Record<string, unknown>;
  p2_scout: Record<string, unknown>;
  committed_at: string;
}

export interface CoreState {
  v: 1;
  room: CoreRoom;
  match: CoreMatch | null;
  priv: Partial<Record<Seat, CorePrivate>>;
  /** The CURRENT round's submission per seat (older rounds are folded into `lastLocked` / `lastCheckpoint`). */
  subs: Partial<Record<Seat, CoreSubmission>>;
  /** Each seat's last LOCKED board from an earlier round (an absent seat's auto board, `versus__finalize_seat`). */
  lastLocked: Partial<Record<Seat, unknown>>;
  /** Each seat's newest locked submission with a checkpoint from an earlier round (the reconnect restore point). */
  lastCheckpoint: Partial<Record<Seat, CheckpointRow>>;
  /** The current match's committed rounds. */
  rounds: Record<number, RoundRow>;
  /** The current GROUP match (3-4 players), when the room plays Group (`groupMatch.ts`). Only one of `match` / `group`
   *  is the room's current match (`room.current_match_id`). */
  group?: GroupState | null;
}

/** What the shell persists to Supabase (in order, retried, idempotent upserts). */
export type PersistJob =
  | { kind: 'match'; row: Record<string, unknown> }
  | { kind: 'round'; row: RoundRow }
  | { kind: 'group_match' | 'group_round'; row: Record<string, unknown> };

/** What changed in a call: the shell pushes these to sockets and writes the dirty storage keys. */
export interface CoreEffects {
  room: boolean;
  match: boolean;
  priv: Set<string>;
  rounds: number[];
  /** Storage keys to rewrite (`meta`, `sub:p1`, `last:p2`, `ckpt:p1`, `round:3`, ...). */
  dirty: Set<string>;
  persist: PersistJob[];
  /** Match events for the log (the `versus_events` kinds, R-VERSUS-EVENTS-01): pause, resume, resume_request, close,
   *  resolve_ok, resolve_err, void, auto_on, auto_off. */
  events: { kind: string; round: number; detail?: Record<string, unknown> }[];
  /** Members that left (released from the directory). */
  left: string[];
  /** The room's listing summary may have changed. */
  summary: boolean;
}

export interface CoreDeps {
  /** A fresh 31-bit seed (crypto in the object, a seeded stream in tests). Seeds are server-owned, never a client's. */
  random31(): number;
  /** A fresh uuid for a match. */
  uuid(): string;
  /** Called with each resolve's wall time (observability). */
  onResolve?(round: number, ms: number): void;
  /** The resolver (tests inject a failing one; default `handleVersusFinalize`). */
  resolve?: typeof handleVersusFinalize;
  /** The group resolver (tests inject a failing one; default `handleVersusGroupFinalize`). */
  resolveGroup?: GroupHost['resolver'];
  /** High-resolution timer for the resolve measurement (performance.now in the object). */
  perfNow?(): number;
}

export interface CreateRoomInput {
  id: string;
  name: string;
  hostUserId: string;
  displayName: string;
  profile: Record<string, unknown>;
  setId: string;
  contentRevision: string;
  protocol: number;
  options?: unknown;
}

const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());
const clampName = (s: unknown, dflt: string): string => {
  const t = typeof s === 'string' ? s.trim() : '';
  return (t || dflt).slice(0, 40);
};
const jsonBytes = (v: unknown): number => (v == null ? 0 : new TextEncoder().encode(JSON.stringify(v)).length);

/** A deterministic pick from `n` by the match seed and a label (`versus__pick`; SQL used Postgres `hashtext`, the
 *  object uses FNV-1a: the pick is server-owned either way, never reproduced by a client). */
export function seededPick(seed: number, label: string, n: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${seed}:${label}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}

/** `versus_turn_seconds`: the round's shop length. */
export function turnSeconds(round: number): number {
  return Math.max(21, Math.min(80, 18 + (round - 1) * 4 + (round >= 6 ? 6 : 0)) + (round >= 12 ? 12 : 0));
}

function emptyEffects(): CoreEffects {
  return { room: false, match: false, priv: new Set(), rounds: [], dirty: new Set(), persist: [], events: [], left: [], summary: false };
}

export function newRoomState(input: CreateRoomInput, now: number): CoreState {
  const err = input.options == null ? null : versusOptionsError(input.options);
  if (err) fail(err);
  const options = normalizeVersusOptions(input.options) as unknown as Record<string, unknown>;
  if (options.mode !== 'duel' && options.mode !== 'group') fail('mode_not_supported');
  if (input.protocol !== VERSUS_PROTOCOL) fail('version_mismatch');
  if (input.contentRevision !== engineContentRevision()) fail('version_mismatch');
  if (jsonBytes(input.profile) > PROFILE_BYTES) fail('profile_too_large');
  return {
    v: 1,
    room: {
      id: input.id,
      name: clampName(input.name, 'Versus'),
      host_user_id: input.hostUserId,
      status: 'open',
      set_id: String(input.setId).slice(0, 16),
      content_revision: input.contentRevision,
      protocol: input.protocol,
      revision: 1,
      gate_deadline: null,
      p1_gate: false,
      p2_gate: false,
      current_match_id: null,
      options,
      options_rev: 0,
      options_changed_at: null,
      friends_only: false,
      created_at: now,
      updated_at: now,
      members: [{ userId: input.hostUserId, role: 'p1', displayName: clampName(input.displayName, 'Player'), profile: input.profile ?? {}, joinedAt: now, disconnectedAt: now }],
      closed: false,
    },
    match: null,
    priv: {},
    subs: {},
    lastLocked: {},
    lastCheckpoint: {},
    rounds: {},
  };
}

export class RoomCore {
  /** Runtime only: users holding at least one open socket. The SHELL decides (it sees every socket, including one that is
   *  closing while its replacement is already open), so the core never counts opens and closes itself. */
  private readonly sockets = new Set<string>();
  /** Runtime only: the latest spectator keyframe per seat (`versus_spectator_frames`; a late joiner reads it). */
  private readonly frames = new Map<GSeat, { seat: GSeat; seq: number; round: number; frame: unknown }>();
  private now = 0;
  private fx: CoreEffects = emptyEffects();
  private pendingResolve = false;
  private groupEng: GroupEngine | null = null;

  constructor(public state: CoreState, private readonly deps: CoreDeps) {}

  /** The group engine over `state.group` (rebuilt after a wake). */
  get grp(): GroupEngine | null {
    const g = this.state.group;
    if (!g) { this.groupEng = null; return null; }
    if (!this.groupEng || this.groupEng.g !== g) this.groupEng = new GroupEngine(g, this.groupHost());
    return this.groupEng;
  }

  private groupHost(): GroupHost {
    return {
      now: () => this.now,
      random31: () => this.deps.random31(),
      uuid: () => this.deps.uuid(),
      userGone: (u) => this.userGone(u),
      touchMatch: () => { this.fx.match = true; this.fx.dirty.add('meta'); },
      touchPriv: (s) => { this.fx.priv.add(s); this.fx.dirty.add('meta'); },
      dirty: (k) => { this.fx.dirty.add(k); },
      event: (k, d) => this.event(k, d),
      persist: (kind, row) => { this.fx.persist.push({ kind, row }); },
      roundCommitted: (n) => { this.fx.rounds.push(n); },
      toStands: (u) => this.toStands(u),
      matchEnded: () => this.groupEnded(),
      fail: (c) => fail(c),
      resolver: this.deps.resolveGroup,
      onResolve: this.deps.onResolve,
      perfNow: this.deps.perfNow,
    };
  }

  /** The room's player seats for its mode (`versus__mode_roles`). */
  private modeRoles(mode: unknown = this.state.room.options.mode): readonly GSeat[] {
    return mode === 'group' ? GSEATS : SEATS;
  }

  /** No open socket for `userId` past the grace. */
  private userGone(userId: string): boolean {
    if (this.sockets.has(userId)) return false;
    const mem = this.member(userId);
    if (!mem) return true;
    return mem.disconnectedAt == null || this.now - mem.disconnectedAt >= DISCONNECT_GRACE_MS;
  }

  /** A knocked-out Group player moves to the stands (R-VERSUS-GROUP-06), past a full stand. */
  private toStands(userId: string): void {
    const mm = this.member(userId);
    if (!mm || mm.role === 'spectator') return;
    mm.role = 'spectator';
    this.touchRoom();
  }

  /** A Group match ended: the room is Open again (`versus_group__complete`). */
  private groupEnded(): void {
    const r = this.state.room;
    if (r.current_match_id !== this.state.group?.match.id) return;
    r.status = 'open';
    r.p1_gate = r.p2_gate = r.p3_gate = r.p4_gate = false;
    r.gate_deadline = null;
    this.touchRoom();
  }

  /** Is a match (1v1 or Group) running? */
  private matchRunning(): boolean {
    return (!!this.state.match && this.state.match.phase !== 'complete') || (!!this.grp && this.grp.running());
  }

  /** The seat's private row (1v1 or Group) for `userId`. */
  privFor(userId: string): Record<string, unknown> | null {
    const g = this.grp;
    if (g) { const s = g.seatOf(userId); return s ? g.privJson(s) : null; }
    const seat = this.seatOf(userId);
    return seat ? this.privJson(seat) : null;
  }

  /** The current match row (1v1 json or Group json). */
  currentMatchJson(): Record<string, unknown> | null {
    return this.grp ? this.grp.json() : this.matchJson();
  }

  /** One committed round as pushed (1v1 `versus_rounds` row or Group round raw). */
  roundJson(n: number): Record<string, unknown> | null {
    const g = this.state.group;
    if (g) return (g.rounds[n] as unknown as Record<string, unknown>) ?? null;
    return (this.state.rounds[n] as unknown as Record<string, unknown>) ?? null;
  }

  // ── Shell entry points ─────────────────────────────────────────────────────────────────────────────────────────

  /** Run one client request. Returns the answer (the SQL function's jsonb) and what changed. */
  async op(userId: string, op: string, args: Record<string, unknown>, now: number): Promise<{ data: unknown; effects: CoreEffects }> {
    this.begin(now);
    if (op !== 'heartbeat') this.state.room.last_activity_at = now;
    const data = this.dispatch(userId, op, args ?? {});
    await this.settle();
    this.reconcile();
    await this.settle();
    // An answer that names the match is re-read AFTER the settle, so a lock that resolved the round answers `combat`.
    return { data: resolveSentinels(data, this), effects: this.end() };
  }

  /** Deadlines and presence (the alarm, and after every socket open/close). */
  async tick(now: number): Promise<CoreEffects> {
    this.begin(now);
    this.reconcile();
    await this.settle();
    return this.end();
  }

  /** `userId` holds an open socket. */
  connect(userId: string, now: number): CoreEffects {
    this.begin(now);
    this.sockets.add(userId);
    const m = this.member(userId);
    if (m && m.disconnectedAt != null) {
      m.disconnectedAt = null;
      this.touchRoom();
    }
    this.returned(userId, 'socket');
    return this.end();
  }

  /**
   * A seated player is back (a socket opened, or a heartbeat): auto play ends (`versus_heartbeat`), and if the match is
   * paused for THEM, the server 3-2-1 starts at once (R-VERSUS-AUTO-RESUME-01, 2026-11-02: "it would simply pause when
   * someone returned"). No client call needed: the socket coming back IS the return.
   */
  private returned(userId: string, by: string): void {
    this.grp?.returned(userId, by);
    const m = this.state.match;
    const seat = this.seatOf(userId);
    if (!m || !seat || m.phase === 'complete') return;
    if (m[`${seat}_auto`]) {
      m[`${seat}_auto`] = false;
      m[`${seat}_missed`] = 0;
      this.event('auto_off', { seat, by });
      this.touchMatch();
    }
    if (m.paused_at != null && m.resume_at == null && m.paused_seat === seat) {
      m.resume_at = this.now + RESUME_COUNTDOWN_MS;
      this.event('resume_request', { seat, by });
      this.touchMatch();
    }
  }

  private event(kind: string, detail?: Record<string, unknown>): void {
    this.fx.events.push({ kind, round: this.state.match?.round ?? this.state.group?.match.round ?? 0, ...(detail ? { detail } : {}) });
  }

  /** `userId` holds no open socket any more (its last one closed or went stale). */
  disconnect(userId: string, now: number): CoreEffects {
    this.begin(now);
    this.sockets.delete(userId);
    const m = this.member(userId);
    if (m && m.disconnectedAt == null) {
      m.disconnectedAt = now;
      this.touchRoom();
    }
    return this.end();
  }

  /** After a wake from hibernation or a restart: which users still hold sockets. A member with none starts its grace now. */
  restoreSockets(users: readonly string[], now: number): void {
    this.sockets.clear();
    for (const u of users) this.sockets.add(u);
    for (const m of this.state.room.members) {
      if (this.sockets.has(m.userId)) m.disconnectedAt = null;
      else if (m.disconnectedAt == null) m.disconnectedAt = now;
    }
  }

  /** The next moment AFTER `now` the object must wake on its own (null = nothing pending). Times at or before `now` were
   *  just handled by the tick that ran at `now` (a passed grace whose pause is already on, a deadline already closed);
   *  re-arming on them would spin the alarm (seen in workerd, 2026-10-28: thousands of wakes a second). */
  nextAlarm(now: number): number | null {
    const t: (number | null)[] = [];
    const r = this.state.room;
    if (r.status === 'sealed') t.push(r.gate_deadline);
    for (const mm of r.members) {
      if (mm.disconnectedAt == null) continue;
      t.push(mm.disconnectedAt + DISCONNECT_GRACE_MS);
      if (this.prunable(mm)) t.push(mm.disconnectedAt + MEMBER_PRUNE_MS);
    }
    {
      if (!r.closed && !this.matchRunning()) t.push((r.last_activity_at ?? r.created_at) + ROOM_IDLE_MS);
      for (const x of this.grp?.alarms() ?? []) t.push(x);
    }
    const m = this.state.match;
    if (m && m.phase !== 'complete') {
      if (m.paused_at != null) {
        t.push(m.resume_at, m.pause_grace_until, m.paused_at + ABANDON_MS);
      } else if (m.phase === 'hero_select') t.push(m.hero_deadline);
      else if (m.phase === 'shop') t.push(m.shop_deadline == null ? m.intro_deadline : m.shop_deadline + SHOP_GRACE_MS);
      else if (m.phase === 'combat') t.push(m.combat_deadline);
    }
    const future = t.filter((x): x is number => x != null && x > now);
    return future.length ? Math.min(...future) : null;
  }

  isConnected(userId: string): boolean {
    return this.sockets.has(userId);
  }

  seatOf(userId: string): Seat | null {
    const m = this.state.match;
    if (!m) return null;
    return userId === m.p1_user ? 'p1' : userId === m.p2_user ? 'p2' : null;
  }

  member(userId: string): CoreMember | undefined {
    return this.state.room.members.find((m) => m.userId === userId);
  }

  // ── JSON (the SQL's row shapes) ────────────────────────────────────────────────────────────────────────────────

  roomJson(): Record<string, unknown> {
    const r = this.state.room;
    return {
      id: r.id, name: r.name, host_user_id: r.host_user_id, status: r.status, set_id: r.set_id, content_revision: r.content_revision,
      protocol: r.protocol, revision: r.revision, gate_deadline: iso(r.gate_deadline), p1_gate: r.p1_gate, p2_gate: r.p2_gate,
      p3_gate: !!r.p3_gate, p4_gate: !!r.p4_gate, current_match_id: r.current_match_id, options: r.options, options_rev: r.options_rev,
      options_changed_at: iso(r.options_changed_at), friends_only: r.friends_only, created_at: iso(r.created_at), updated_at: iso(r.updated_at),
      members: [...r.members].sort((a, b) => a.joinedAt - b.joinedAt).map((m) => ({
        userId: m.userId, role: m.role, displayName: m.displayName, profile: m.profile,
        // A connected member is "seen" now; a disconnected one when its socket closed (the client's "is back" notice).
        lastSeenAt: iso(m.disconnectedAt ?? this.now),
      })),
      serverNow: iso(this.now),
    };
  }

  matchJson(): Record<string, unknown> | null {
    const m = this.state.match;
    if (!m) return null;
    return {
      ...m,
      p1_hearts: null, p2_hearts: null,
      hero_deadline: iso(m.hero_deadline), shop_starts_at: iso(m.shop_starts_at), shop_deadline: iso(m.shop_deadline),
      combat_deadline: iso(m.combat_deadline), intro_deadline: iso(m.intro_deadline), paused_at: iso(m.paused_at),
      pause_grace_until: iso(m.pause_grace_until), resume_at: iso(m.resume_at), created_at: iso(m.created_at),
      updated_at: iso(m.updated_at), completed_at: iso(m.completed_at), serverNow: iso(this.now),
    };
  }

  privJson(seat: string): Record<string, unknown> | null {
    if (this.state.group) return this.grp!.privJson(seat as GSeat);
    const p = this.state.priv[seat as Seat];
    return p ? { ...p } : null;
  }

  /** The listing row (`versus_list_rooms`). */
  summary(): Record<string, unknown> {
    const r = this.state.room;
    const host = r.members.find((m) => m.userId === r.host_user_id);
    return {
      id: r.id, name: r.name, status: r.status, setId: r.set_id, contentRevision: r.content_revision, protocol: r.protocol,
      createdAt: iso(r.created_at), currentMatchId: r.current_match_id, hostName: host?.displayName ?? null,
      hostProfile: host?.profile ?? null, players: r.members.filter((m) => m.role !== 'spectator').length,
      spectators: r.members.filter((m) => m.role === 'spectator').length, maxPlayers: this.modeRoles().length, options: r.options, friendsOnly: r.friends_only,
      /** Fresh = someone connected in the last two minutes (the open-room count's rule). */
      fresh: r.members.some((m) => m.disconnectedAt == null || this.now - m.disconnectedAt < MEMBER_PRUNE_MS),
      closed: r.closed,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────────────────────────────────────────

  private begin(now: number): void {
    this.now = now;
    this.fx = emptyEffects();
  }

  private end(): CoreEffects {
    const fx = this.fx;
    this.fx = emptyEffects();
    return fx;
  }

  private touchRoom(): void {
    const r = this.state.room;
    r.revision += 1;
    r.updated_at = this.now;
    this.fx.room = true;
    this.fx.summary = true;
    this.fx.dirty.add('meta');
  }

  private touchMatch(): void {
    const m = this.state.match!;
    m.revision += 1;
    m.updated_at = this.now;
    this.fx.match = true;
    this.fx.dirty.add('meta');
  }

  private touchPriv(seat: Seat): void {
    this.fx.priv.add(seat);
    this.fx.dirty.add('meta');
  }

  private dirtySub(seat: Seat): void {
    this.fx.dirty.add(`sub:${seat}`);
  }

  private requireMatch(matchId: unknown): CoreMatch {
    const m = this.state.match;
    if (!m || m.id !== matchId) fail('no_match');
    return m!;
  }

  private requireSeat(m: CoreMatch, userId: string): Seat {
    const s = this.seatOf(userId);
    if (!s || m.id !== this.state.match?.id) fail('not_a_player');
    return s!;
  }

  private gone(seat: Seat): boolean {
    const m = this.state.match!;
    const user = seat === 'p1' ? m.p1_user : m.p2_user;
    if (this.sockets.has(user)) return false;
    const mem = this.member(user);
    if (!mem) return true;
    return mem.disconnectedAt == null || this.now - mem.disconnectedAt >= DISCONNECT_GRACE_MS;
  }

  private prunable(mm: CoreMember): boolean {
    const r = this.state.room;
    if (mm.role === 'spectator') return true;
    // A seated player in a running match is never pruned (pause / auto / abandon decide); otherwise yes.
    if (this.grp?.holdsLiveSeat(mm.userId)) return false;
    const m = this.state.match;
    return !(r.status === 'in_game' && m && m.phase !== 'complete' && this.seatOf(mm.userId));
  }

  private dispatch(userId: string, op: string, a: Record<string, unknown>): unknown {
    const g = this.grp;
    if (g && a.matchId === g.m.id) return this.dispatchGroup(g, userId, op, a);
    switch (op) {
      case 'join': return this.join(userId, a);
      case 'take_seat': return this.takeSeat(userId, a.role);
      case 'leave': return this.leave(userId);
      case 'start': return this.start(userId);
      case 'gate': return this.pressGate(userId);
      case 'set_options': return this.setOptions(userId, a.options);
      case 'reconcile_room': return ROOM_JSON;
      case 'sync': return this.sync(userId);
      case 'heartbeat': return this.heartbeat(userId);
      case 'register_offer': return this.registerOffer(userId, a.matchId, a.offer);
      case 'pick_hero': return this.pickHero(userId, a.matchId, a.index);
      case 'reroll_hero': return this.rerollHero(userId, a.matchId, a.slot, a.candidates);
      case 'submit': return this.submit(userId, a);
      case 'unready': return this.unready(userId, a.matchId, a.round, a.seq);
      case 'intro_done': return this.introDone(userId, a.matchId);
      case 'combat_ready': return this.combatReady(userId, a.matchId, a.round);
      case 'forfeit': return this.forfeit(userId, a.matchId);
      case 'unpause': return this.unpause(userId, a.matchId);
      case 'request_resume': return this.requestResume(userId, a.matchId);
      case 'reconcile': this.requireMatch(a.matchId); return MATCH_JSON;
      case 'publish_frame': return this.publishFrame(userId, a);
      case 'latest_frames': this.requireMatch(a.matchId); return [...this.frames.values()];
      case 'rounds': return this.roundsFrom(a.matchId, a.from);
      case 'my_private': return this.myPrivate(userId, a.matchId);
      case 'my_checkpoint': return this.myCheckpoint(userId, a.matchId);
      default: return fail('unknown_op');
    }
  }

  /** The Group match's ops (the `versus_group_*` RPCs); every answer is the group json after the call settles. */
  private dispatchGroup(g: GroupEngine, userId: string, op: string, a: Record<string, unknown>): unknown {
    switch (op) {
      case 'register_offer': g.registerOffer(userId, a.offer); return GROUP_JSON;
      case 'pick_hero': g.pickHero(userId, a.index); return GROUP_JSON;
      case 'reroll_hero': { const x = g.reroll(userId, a.slot, a.candidates); return { match: GROUP_JSON, offer: x.offer, reroll: x.reroll }; }
      case 'submit': g.submit(userId, a); return GROUP_JSON;
      case 'unready': g.unready(userId, a.round, a.seq); return GROUP_JSON;
      case 'intro_done': g.introDone(userId); return GROUP_JSON;
      case 'combat_ready': g.combatReady(userId, a.round); return GROUP_JSON;
      case 'forfeit': g.forfeit(userId); return GROUP_JSON;
      case 'unpause': g.unpause(userId); return GROUP_JSON;
      case 'request_resume': g.requestResume(userId); return GROUP_JSON;
      case 'reconcile': return GROUP_JSON;
      case 'publish_frame': {
        const seat = g.seatOf(userId);
        if (!seat) fail('not_a_player');
        if (a.frame == null || jsonBytes(a.frame) > FRAME_BYTES) fail('frame_too_large');
        const seq = Number(a.seq);
        const prev = this.frames.get(seat!);
        if (!prev || prev.seq < seq) this.frames.set(seat!, { seat: seat!, seq, round: Number(a.round), frame: a.frame });
        return null;
      }
      case 'latest_frames': return [...this.frames.values()];
      case 'rounds': return g.roundsFrom(Number.isInteger(a.from) ? (a.from as number) : 1);
      case 'my_private': { const s = g.seatOf(userId); return s ? g.privJson(s) : null; }
      case 'my_checkpoint': { const s = g.seatOf(userId); return s ? g.myCheckpoint(s) : null; }
      default: return fail('unknown_op');
    }
  }

  // ── Room ops (versus_join_room, versus_take_seat, versus_leave_room, versus_start_game, versus_press_gate, ...) ──

  private join(userId: string, a: Record<string, unknown>): unknown {
    const r = this.state.room;
    if (r.closed) fail('no_room');
    if (a.protocol !== r.protocol || a.content !== r.content_revision) fail('version_mismatch');
    if (this.member(userId)) return ROOM_JSON; // idempotent re-join
    const profile = (a.profile && typeof a.profile === 'object' ? a.profile : {}) as Record<string, unknown>;
    if (jsonBytes(profile) > PROFILE_BYTES) fail('profile_too_large');
    let role: Role;
    if (a.as === 'player') {
      if (r.status !== 'open') fail('room_not_open');
      const free = this.modeRoles().find((s) => !r.members.some((m) => m.role === s));
      if (!free) fail('seats_full');
      role = free!;
    } else if (a.as === 'spectator') {
      if (r.members.filter((m) => m.role === 'spectator').length >= VERSUS_SPECTATOR_CAP) fail('spectators_full');
      role = 'spectator';
    } else return fail('bad_role');
    r.members.push({ userId, role, displayName: clampName(a.display, 'Player'), profile, joinedAt: this.now, disconnectedAt: this.sockets.has(userId) ? null : this.now });
    this.touchRoom();
    return ROOM_JSON;
  }

  private takeSeat(userId: string, role: unknown): unknown {
    const r = this.state.room;
    const me = this.member(userId);
    if (!me) fail('not_a_member');
    if (r.status !== 'open') fail('room_not_open');
    if (role !== 'spectator' && !this.modeRoles().includes(role as GSeat)) fail('bad_role');
    if (me!.role === role) return ROOM_JSON;
    if (role !== 'spectator' && r.members.some((m) => m.role === role)) fail('seat_taken');
    if (role === 'spectator' && r.members.filter((m) => m.role === 'spectator').length >= VERSUS_SPECTATOR_CAP) fail('spectators_full');
    me!.role = role as Role;
    this.touchRoom();
    return ROOM_JSON;
  }

  private leave(userId: string): unknown {
    const r = this.state.room;
    const me = this.member(userId);
    if (!me) return { left: true };
    const m = this.state.match;
    if (r.status === 'in_game' && me.role !== 'spectator' && m && r.current_match_id === m.id && m.phase !== 'complete') {
      const seat = this.seatOf(userId);
      if (seat) this.complete(other(seat), 'forfeit');
    }
    const g = this.grp;
    if (g && g.running() && r.current_match_id === g.m.id) {
      const seat = g.seatOf(userId);
      if (seat && g.row(seat).eliminated_round == null) g.eliminate(seat, 'left');
    }
    r.members = r.members.filter((x) => x.userId !== userId);
    this.fx.left.push(userId);
    if (r.members.length === 0) {
      r.closed = true;
      this.touchRoom();
      return { left: true, roomClosed: true };
    }
    if (r.host_user_id === userId) {
      const next = [...r.members].sort((a, b) => Number(a.role === 'spectator') - Number(b.role === 'spectator') || a.joinedAt - b.joinedAt)[0];
      r.host_user_id = next.userId;
    }
    if (r.status === 'sealed') {
      r.status = 'open';
      r.gate_deadline = null;
    }
    r.p1_gate = r.p2_gate = r.p3_gate = r.p4_gate = false;
    this.touchRoom();
    return { left: true };
  }

  private start(userId: string): unknown {
    const r = this.state.room;
    if (r.host_user_id !== userId) fail('not_host');
    if (r.status !== 'open') fail('room_not_open');
    const roles = this.modeRoles();
    const seated = r.members.filter((m) => m.role !== 'spectator' && roles.includes(m.role)).length;
    if (r.options.mode === 'group' ? seated < 3 : seated < 2) fail(r.options.mode === 'group' ? 'need_three_players' : 'need_two_players');
    r.status = 'sealed';
    r.p1_gate = r.p2_gate = r.p3_gate = r.p4_gate = false;
    r.gate_deadline = this.now + VERSUS_GATE_SECONDS * 1000;
    this.touchRoom();
    return ROOM_JSON;
  }

  private pressGate(userId: string): unknown {
    const r = this.state.room;
    const me = this.member(userId);
    if (!me || me.role === 'spectator') fail('not_a_player');
    if (r.status !== 'sealed') fail('room_not_sealed');
    if (this.now >= (r.gate_deadline ?? 0)) {
      this.reopenGate();
      fail('gate_expired');
    }
    if (me!.role === 'p1') r.p1_gate = true;
    if (me!.role === 'p2') r.p2_gate = true;
    if (me!.role === 'p3') r.p3_gate = true;
    if (me!.role === 'p4') r.p4_gate = true;
    if (r.options.mode === 'group') {
      const gateOf = (s: GSeat): boolean => (s === 'p1' ? r.p1_gate : s === 'p2' ? r.p2_gate : s === 'p3' ? !!r.p3_gate : !!r.p4_gate);
      const seated = r.members.filter((m) => m.role !== 'spectator') as (CoreMember & { role: GSeat })[];
      if (seated.length >= 3 && seated.every((m) => gateOf(m.role))) this.createGroupMatch(seated);
    } else if (r.p1_gate && r.p2_gate) this.createMatch();
    this.touchRoom();
    return ROOM_JSON;
  }

  private reopenGate(): void {
    const r = this.state.room;
    r.status = 'open';
    r.p1_gate = r.p2_gate = r.p3_gate = r.p4_gate = false;
    r.gate_deadline = null;
    this.touchRoom();
  }

  private setOptions(userId: string, raw: unknown): unknown {
    const r = this.state.room;
    if (r.host_user_id !== userId) fail('not_host');
    if (r.status !== 'open') fail('room_not_open');
    const err = versusOptionsError(raw);
    if (err) fail(err);
    const next = normalizeVersusOptions(raw) as unknown as Record<string, unknown>;
    if (next.mode !== 'duel' && next.mode !== 'group') fail('mode_not_supported'); // Duos / Ranked Duos: later phases
    if (JSON.stringify(next) === JSON.stringify(r.options)) return ROOM_JSON;
    // Switching modes: a player in a seat the new mode does not have takes a free one, else goes to the stands.
    const roles = this.modeRoles(next.mode);
    for (const mm of [...r.members].filter((x) => x.role !== 'spectator' && !roles.includes(x.role as GSeat)).sort((a, b) => GSEATS.indexOf(a.role as GSeat) - GSEATS.indexOf(b.role as GSeat))) {
      const free = roles.find((s) => !r.members.some((x) => x.role === s));
      mm.role = free ?? 'spectator';
    }
    r.options = next;
    r.options_rev += 1;
    r.options_changed_at = this.now;
    this.touchRoom();
    return ROOM_JSON;
  }

  private sync(userId: string): unknown {
    return { room: this.roomJson(), match: this.currentMatchJson(), priv: this.privFor(userId) };
  }

  /** `versus_heartbeat`: a seat on auto that is back plays again; while paused, every member's last-seen. Presence
   *  itself is the socket, so this is no longer what keeps a seat "here". */
  private heartbeat(userId: string): unknown {
    if (!this.member(userId)) fail('not_a_member');
    const m = this.state.match;
    const out: Record<string, unknown> = { serverNow: iso(this.now) };
    const seat = this.seatOf(userId);
    if (m && seat && m.phase !== 'complete') {
      this.returned(userId, 'heartbeat');
      out.match = MATCH_JSON;
    }
    const g = this.grp;
    if (g && g.running() && g.holdsLiveSeat(userId)) {
      this.returned(userId, 'heartbeat');
      out.groupMatch = GROUP_JSON;
    }
    if ((m && m.paused_at != null && m.phase !== 'complete') || (g && g.running() && g.m.paused_at != null)) {
      out.seen = Object.fromEntries(this.state.room.members.map((mm) => [mm.userId, iso(mm.disconnectedAt ?? this.now)]));
    }
    return out;
  }

  // ── Match ops ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** `versus_press_gate`, Group branch: every seated player pressed, a 3-4 player match starts. */
  private createGroupMatch(seated: (CoreMember & { role: GSeat })[]): void {
    const r = this.state.room;
    this.clearMatchKeys();
    this.state.match = null;
    this.state.group = newGroupState(this.groupHost(), r, seated.map((m) => ({ seat: m.role, userId: m.userId, name: m.displayName })));
    const g = this.grp!;
    for (const s of g.m.seats) { this.fx.priv.add(s.seat); }
    r.status = 'in_game';
    r.current_match_id = g.m.id;
    r.gate_deadline = null;
    this.fx.match = true;
    this.fx.dirty.add('meta');
    const row = g.json();
    delete row.serverNow;
    this.fx.persist.push({ kind: 'group_match', row: { ...row, room_id: null, seats: g.m.seats } });
  }

  /** A new match starts clean: every stored round / board of the previous one (either mode) is dropped. */
  private clearMatchKeys(): void {
    for (const n of Object.keys(this.state.rounds)) this.fx.dirty.add(`round:${n}`);
    for (const n of Object.keys(this.state.group?.rounds ?? {})) this.fx.dirty.add(`ground:${n}`);
    for (const s of GSEATS) for (const k of ['sub', 'last', 'ckpt', 'gsub', 'glast', 'gckpt']) this.fx.dirty.add(`${k}:${s}`);
    this.frames.clear();
  }

  private createMatch(): void {
    const r = this.state.room;
    this.clearMatchKeys();
    this.state.group = null;
    const p1 = r.members.find((m) => m.role === 'p1')!;
    const p2 = r.members.find((m) => m.role === 'p2')!;
    const id = this.deps.uuid();
    this.state.match = {
      id, room_id: r.id, seed: this.deps.random31(), set_id: r.set_id, content_revision: r.content_revision, protocol: r.protocol,
      phase: 'hero_select', revision: 1, round: 0, p1_user: p1.userId, p2_user: p2.userId, p1_name: p1.displayName, p2_name: p2.displayName,
      p1_health: null, p1_armor: null, p2_health: null, p2_armor: null, p1_hero: null, p2_hero: null, heroes_revealed: false,
      hero_deadline: this.now + VERSUS_HERO_SELECT_SECONDS * 1000, shop_starts_at: null, shop_deadline: null, combat_deadline: null,
      p1_locked: false, p2_locked: false, p1_ready: false, p2_ready: false, p1_intro: false, p2_intro: false, intro_deadline: null,
      paused_seat: null, paused_at: null, pause_grace_until: null, resume_at: null, p1_auto: false, p2_auto: false, p1_missed: 0, p2_missed: 0,
      winner_seat: null, end_reason: null, options: normalizeVersusOptions(r.options) as unknown as Record<string, unknown>,
      created_at: this.now, updated_at: this.now, completed_at: null,
    };
    this.state.priv = {};
    for (const [seat, mem] of [['p1', p1], ['p2', p2]] as const) {
      this.state.priv[seat] = {
        match_id: id, seat, user_id: mem.userId, hero_seed: this.deps.random31(), run_seed: this.deps.random31(),
        hero_offer: null, hero_index: null, hero_auto: false, hero_reroll: null,
      };
      this.touchPriv(seat);
    }
    // A new match starts clean: the previous one's rounds and boards are already persisted (or still queued).
    for (const n of Object.keys(this.state.rounds)) this.fx.dirty.add(`round:${n}`);
    this.state.rounds = {};
    this.state.subs = {};
    this.state.lastLocked = {};
    this.state.lastCheckpoint = {};
    for (const s of SEATS) for (const k of ['sub', 'last', 'ckpt']) this.fx.dirty.add(`${k}:${s}`);
    r.status = 'in_game';
    r.current_match_id = id;
    r.gate_deadline = null;
    this.touchMatch();
    this.fx.persist.push({ kind: 'match', row: this.persistMatchRow() });
  }

  private registerOffer(userId: string, matchId: unknown, offer: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (!Array.isArray(offer) || offer.length !== 3 || offer.some((o) => typeof o !== 'string' || o.length === 0 || o.length > 32)) fail('bad_offer');
    const p = this.state.priv[seat]!;
    if (p.hero_offer == null) {
      p.hero_offer = [...(offer as string[])];
      this.touchPriv(seat);
    }
    return MATCH_JSON;
  }

  private pickHero(userId: string, matchId: unknown, index: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.phase !== 'hero_select') fail('wrong_phase');
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 2) fail('bad_index');
    if (this.now >= (m.hero_deadline ?? 0)) {
      this.maybeStart();
      fail('hero_deadline_passed');
    }
    const p = this.state.priv[seat]!;
    if (p.hero_index == null) {
      p.hero_index = index as number;
      this.touchPriv(seat);
    }
    this.maybeStart();
    return MATCH_JSON;
  }

  private rerollHero(userId: string, matchId: unknown, slot: unknown, candidates: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.phase !== 'hero_select') fail('wrong_phase');
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 2) fail('bad_index');
    if (this.now >= (m.hero_deadline ?? 0)) fail('hero_deadline_passed');
    const p = this.state.priv[seat]!;
    if (!p.hero_offer) fail('no_offer');
    if (p.hero_index != null) fail('already_picked');
    if (p.hero_reroll) fail('reroll_used');
    const c = Array.isArray(candidates) ? (candidates as unknown[]) : [];
    if (c.length < 1 || c.length > 128 || c.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 32)
      || new Set(c).size !== c.length || c.some((x) => p.hero_offer!.includes(x as string))) fail('bad_candidates');
    const to = c[seededPick(m.seed, `hero-reroll:${seat}`, c.length)] as string;
    const from = p.hero_offer![slot as number];
    p.hero_offer = p.hero_offer!.map((h, i) => (i === slot ? to : h));
    p.hero_reroll = { slot: slot as number, from, to };
    this.touchPriv(seat);
    return { match: MATCH_JSON, offer: [...p.hero_offer], reroll: { ...p.hero_reroll } };
  }

  /** `versus__maybe_start`: both picked (or the deadline): reveal the heroes and open round 1's shop. */
  private maybeStart(): void {
    const m = this.state.match!;
    if (m.phase !== 'hero_select') return;
    const unpicked = SEATS.some((s) => this.state.priv[s]!.hero_index == null);
    if (this.now < (m.hero_deadline ?? 0) && unpicked) return;
    for (const s of SEATS) {
      const p = this.state.priv[s]!;
      if (p.hero_index == null) {
        p.hero_index = seededPick(m.seed, `hero:${s}`, 3);
        p.hero_auto = true;
        this.touchPriv(s);
      }
      m[`${s}_hero`] = p.hero_offer ? p.hero_offer[p.hero_index] ?? null : null;
    }
    m.heroes_revealed = true;
    this.openShop(1);
  }

  /** `versus__open_shop`: round 1 waits for both intros (or 45 s); later rounds start their clock now. */
  private openShop(round: number): void {
    const m = this.state.match!;
    const first = round === 1;
    m.phase = 'shop';
    m.round = round;
    m.shop_starts_at = first ? null : this.now;
    m.shop_deadline = first ? null : this.now + turnSeconds(round) * 1000;
    m.intro_deadline = first ? this.now + VERSUS_INTRO_CAP_SECONDS * 1000 : null;
    m.combat_deadline = null;
    m.p1_locked = m.p2_locked = m.p1_ready = m.p2_ready = false;
    // The previous round's submissions fold into the seat's history (its last locked board, its restore point).
    for (const s of SEATS) {
      const sub = this.state.subs[s];
      if (sub && sub.round < round) {
        if (sub.final && sub.prepared_side != null) { this.state.lastLocked[s] = sub.prepared_side; this.fx.dirty.add(`last:${s}`); }
        if (sub.final && sub.checkpoint != null) {
          this.state.lastCheckpoint[s] = { round: sub.round, final: true, candidate_seq: sub.candidate_seq, checkpoint: sub.checkpoint };
          this.fx.dirty.add(`ckpt:${s}`);
        }
        delete this.state.subs[s];
        this.dirtySub(s);
      }
    }
    this.touchMatch();
  }

  /** `versus__start_clock`. */
  private startClock(): void {
    const m = this.state.match!;
    if (m.phase !== 'shop' || m.shop_deadline != null) return;
    m.shop_starts_at = this.now;
    m.shop_deadline = this.now + turnSeconds(m.round) * 1000;
    m.intro_deadline = null;
    this.touchMatch();
  }

  private introDone(userId: string, matchId: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.phase !== 'shop' || m.shop_deadline != null) return MATCH_JSON;
    m[`${seat}_intro`] = true;
    this.touchMatch();
    if ((m.p1_intro || m.p1_auto) && (m.p2_intro || m.p2_auto) && m.paused_at == null) this.startClock();
    return MATCH_JSON;
  }

  private submit(userId: string, a: Record<string, unknown>): unknown {
    const m = this.requireMatch(a.matchId);
    const seat = this.requireSeat(m, userId);
    const round = a.round;
    const seq = Number(a.seq);
    const final = a.final === true;
    if (m.phase !== 'shop' || m.round !== round) fail('stale_round');
    if (m.paused_at == null && this.now >= (m.shop_deadline ?? Infinity) + SHOP_GRACE_MS) fail('deadline_passed');
    if (a.side == null || jsonBytes(a.side) > VERSUS_LIMITS.preparedSideBytes) fail('side_too_large');
    if (a.checkpoint != null && jsonBytes(a.checkpoint) > CHECKPOINT_BYTES) fail('checkpoint_too_large');
    const scout = a.scout && typeof a.scout === 'object' && !Array.isArray(a.scout) ? (a.scout as Record<string, unknown>) : null;
    if (a.scout != null && (!scout || jsonBytes(scout) > SCOUT_BYTES)) fail('scout_too_large');
    if (!Number.isInteger(seq)) fail('bad_seq');
    const cur = this.state.subs[seat]?.round === round ? this.state.subs[seat] : undefined;
    // READY SIGNAL: a seat that already ended may send its board again (a newer seq), and stays ended.
    if (cur?.final) {
      if (!final || seq <= cur.candidate_seq) return MATCH_JSON;
      cur.candidate_seq = seq;
      cur.prepared_side = a.side;
      if (a.checkpoint != null) cur.checkpoint = a.checkpoint;
      if (scout) cur.scout = scout;
      this.dirtySub(seat);
      this.raiseReportedArmor(seat, cur);
      return MATCH_JSON;
    }
    if (cur && seq <= cur.candidate_seq && !final) return MATCH_JSON; // an older candidate arriving late
    const next: CoreSubmission = {
      round: round as number, seat, user_id: userId, candidate_seq: Math.max(seq, cur?.candidate_seq ?? seq), prepared_side: a.side,
      final, source: final ? 'lock' : 'candidate', checkpoint: a.checkpoint ?? cur?.checkpoint ?? null, scout: scout ?? cur?.scout ?? null,
    };
    this.state.subs[seat] = next;
    this.dirtySub(seat);
    this.raiseReportedArmor(seat, next);
    if (final) {
      m[`${seat}_locked`] = true;
      this.touchMatch();
      this.maybeResolve();
    }
    return MATCH_JSON;
  }

  /** `versus__raise_reported_armor` (R-VERSUS-LIVE-ARMOR-01): a fresh Mend report lifts the stored pool's Armor at once. */
  private raiseReportedArmor(seat: Seat, sub: CoreSubmission): void {
    const m = this.state.match!;
    if (!['candidate', 'lock', 'deadline'].includes(sub.source)) return;
    if (m.phase !== 'shop' && m.phase !== 'resolving') return;
    const rep = reportedVitals(sub.prepared_side);
    const floor = versusArmorFloorMax();
    const health = m[`${seat}_health`];
    const armor = m[`${seat}_armor`];
    if (!rep || health == null || armor == null || armor >= floor || rep.armor <= armor) return;
    m[`${seat}_armor`] = Math.min(rep.armor, floor);
    this.touchMatch();
  }

  private unready(userId: string, matchId: unknown, round: unknown, seq: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.phase !== 'shop' || m.round !== round) fail('stale_round');
    if (m.shop_deadline == null || m.paused_at != null) fail('not_running');
    if (this.now >= m.shop_deadline!) fail('deadline_passed');
    if (m[`${seat}_auto`]) fail('eliminated');
    const sub = this.state.subs[seat];
    if (sub && sub.round === round) {
      sub.final = false;
      sub.source = 'candidate';
      sub.candidate_seq = Math.max(sub.candidate_seq, Number(seq) || 0);
      this.dirtySub(seat);
    }
    m[`${seat}_locked`] = false;
    this.touchMatch();
    return MATCH_JSON;
  }

  /** `versus__finalize_seat`: the deadline promotes the newest candidate; an absent seat plays its last locked board;
   *  nothing at all is the empty board, so two AFK players never deadlock a round. */
  private finalizeSeat(seat: Seat, auto: boolean): void {
    const m = this.state.match!;
    const user = seat === 'p1' ? m.p1_user : m.p2_user;
    const cur = this.state.subs[seat]?.round === m.round ? this.state.subs[seat] : undefined;
    const last = this.state.lastLocked[seat] ?? null;
    if (auto) {
      if (cur) {
        // SQL: prepared_side = coalesce(last locked, this round's), and 'deadline' when this round already had a board.
        const had = cur.prepared_side != null;
        cur.prepared_side = last ?? cur.prepared_side;
        cur.source = had ? 'deadline' : last == null ? 'empty' : 'auto';
        cur.final = true;
      } else {
        this.state.subs[seat] = { round: m.round, seat, user_id: user, candidate_seq: 0, prepared_side: last, final: true, source: last == null ? 'empty' : 'auto', checkpoint: null, scout: null };
      }
    } else if (cur && cur.prepared_side != null) {
      cur.final = true;
      cur.source = 'deadline';
    } else {
      this.state.subs[seat] = { round: m.round, seat, user_id: user, candidate_seq: 0, prepared_side: last, final: true, source: last == null ? 'empty' : 'auto', checkpoint: cur?.checkpoint ?? null, scout: cur?.scout ?? null };
    }
    this.dirtySub(seat);
  }

  /** `versus__maybe_resolve`: both locked (an auto seat counts) → `resolving`, and the fight is computed right here. */
  private maybeResolve(): void {
    const m = this.state.match!;
    if (m.phase !== 'shop') return;
    if (!((m.p1_locked || m.p1_auto) && (m.p2_locked || m.p2_auto))) return;
    if (m.p1_auto && !m.p1_locked) this.finalizeSeat('p1', true);
    if (m.p2_auto && !m.p2_locked) this.finalizeSeat('p2', true);
    m.phase = 'resolving';
    m.p1_locked = m.p2_locked = true;
    this.touchMatch();
    this.pendingResolve = true;
    this.event('close');
  }

  /** Resolve a `resolving` round through the Edge Function's own handler over an in-memory store. */
  private async settle(): Promise<void> {
    await this.grp?.settle();
    while (this.pendingResolve) {
      this.pendingResolve = false;
      const m = this.state.match;
      if (!m || m.phase !== 'resolving') continue;
      const t0 = this.deps.perfNow?.() ?? 0;
      const store: VersusFinalizeStore = {
        match: async (id) => (id === m.id ? {
          id: m.id, phase: m.phase, round: m.round, seed: m.seed, content_revision: m.content_revision, p1_user: m.p1_user, p2_user: m.p2_user,
          p1_hero: m.p1_hero, p2_hero: m.p2_hero, options: m.options, p1_health: m.p1_health, p1_armor: m.p1_armor, p2_health: m.p2_health, p2_armor: m.p2_armor,
        } : null),
        finalSides: async () => {
          const out = { p1: null as unknown, p2: null as unknown };
          for (const s of SEATS) {
            const sub = this.state.subs[s];
            if (sub && sub.round === m.round && sub.final) out[s] = versusFreshSide(sub.prepared_side, sub.source);
          }
          return out;
        },
        commit: async (args) => this.commitRound(args),
        log: (msg, detail) => console.warn(msg, detail),
      };
      let res: { status: number; body: Record<string, unknown> };
      try {
        res = await (this.deps.resolve ?? handleVersusFinalize)(m.p1_user, { matchId: m.id, round: m.round }, engineContentRevision(), store);
      } catch (e) {
        res = { status: 500, body: { error: String(e) } };
      }
      if (res.status === 200 && m.phase !== 'resolving') this.event('resolve_ok');
      else {
        // R-VERSUS-RESOLVE-TIMEOUT-01 in one step: the object IS the resolver, so a round it cannot resolve (an engine /
        // content mismatch, a throw) will never resolve later either. The match ends 'void': no winner, nobody charged.
        this.event('resolve_err', { status: res.status, body: res.body });
        if (m.phase === 'resolving') { this.event('void'); this.complete(null, 'void'); }
      }
      this.deps.onResolve?.(m.round, (this.deps.perfNow?.() ?? 0) - t0);
    }
  }

  /** `versus_commit_round` (+ the `versus__round_scouts` trigger). */
  private commitRound(args: Parameters<VersusFinalizeStore['commit']>[0]): unknown {
    const m = this.state.match!;
    if (this.state.rounds[args.p_round]) return { alreadyCommitted: true };
    if (m.phase !== 'resolving' || m.round !== args.p_round) fail('not_resolving');
    const v = args.p_vitals;
    const scoutOf = (s: Seat): Record<string, unknown> => {
      const sub = this.state.subs[s];
      const tier = (sub?.prepared_side as { state?: { tier?: unknown } } | null)?.state?.tier;
      return { ...(sub?.scout ?? {}), ...(tier != null ? { tier } : {}) };
    };
    const row: RoundRow = {
      match_id: m.id, round: args.p_round, chair: args.p_chair, outcome: args.p_outcome, heart_lost_by: args.p_loser,
      p1_result: args.p_p1, p2_result: args.p_p2, digest: args.p_digest, p1_hearts: null, p2_hearts: null,
      p1_health: v.p1.health, p1_armor: v.p1.armor, p2_health: v.p2.health, p2_armor: v.p2.armor, p1_damage: v.p1.damage, p2_damage: v.p2.damage,
      p1_scout: scoutOf('p1'), p2_scout: scoutOf('p2'), committed_at: iso(this.now)!,
    };
    this.state.rounds[row.round] = row;
    this.fx.rounds.push(row.round);
    this.fx.dirty.add(`round:${row.round}`);
    this.fx.persist.push({ kind: 'round', row });
    m.p1_health = v.p1.health; m.p1_armor = v.p1.armor; m.p2_health = v.p2.health; m.p2_armor = v.p2.armor;
    m.p1_missed = m.p1_auto ? m.p1_missed + 1 : 0;
    m.p2_missed = m.p2_auto ? m.p2_missed + 1 : 0;
    m.phase = 'combat';
    m.combat_deadline = this.now + VERSUS_COMBAT_VIEW_CAP_SECONDS * 1000;
    m.p1_ready = m.p2_ready = false;
    this.touchMatch();
    // Health 0 is out ('hearts' is the knockout reason's legacy id).
    if (v.p1.health <= 0 || v.p2.health <= 0) this.complete(v.p1.health <= 0 ? 'p2' : 'p1', 'hearts');
    else if (m.p1_missed >= VERSUS_MISSED_ROUNDS_FORFEIT) this.complete('p2', 'missed');
    else if (m.p2_missed >= VERSUS_MISSED_ROUNDS_FORFEIT) this.complete('p1', 'missed');
    else this.fx.persist.push({ kind: 'match', row: this.persistMatchRow() });
    return { alreadyCommitted: false };
  }

  private combatReady(userId: string, matchId: unknown, round: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.phase !== 'combat' || m.round !== round) return MATCH_JSON;
    m[`${seat}_ready`] = true;
    if ((m.p1_ready || m.p1_auto) && (m.p2_ready || m.p2_auto) && m.paused_at == null) this.openShop(m.round + 1);
    else {
      m.combat_deadline = Math.min(m.combat_deadline ?? Infinity, this.now + COMBAT_LAST_READY_MS);
      this.touchMatch();
    }
    return MATCH_JSON;
  }

  private forfeit(userId: string, matchId: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.phase !== 'complete') this.complete(other(seat), 'forfeit');
    return MATCH_JSON;
  }

  private unpause(userId: string, matchId: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.paused_at == null || m.resume_at != null) return MATCH_JSON;
    const absent = m.paused_seat!;
    if (absent === seat) fail('cannot_unpause_own_absence');
    if (this.now < (m.pause_grace_until ?? 0)) fail('grace_running');
    m[`${absent}_auto`] = true;
    this.event('auto_on', { seat: absent });
    m.resume_at = this.now + RESUME_COUNTDOWN_MS;
    this.touchMatch();
    return MATCH_JSON;
  }

  private requestResume(userId: string, matchId: unknown): unknown {
    const m = this.requireMatch(matchId);
    const seat = this.requireSeat(m, userId);
    if (m.paused_at == null || m.resume_at != null) return MATCH_JSON;
    if (m.paused_seat !== seat) fail('not_your_pause');
    m.resume_at = this.now + RESUME_COUNTDOWN_MS;
    this.touchMatch();
    return MATCH_JSON;
  }

  /** `versus__resume`: every deadline moves later by the pause. */
  private resume(): void {
    const m = this.state.match!;
    if (m.paused_at == null) return;
    const d = this.now - m.paused_at;
    this.event('resume', { pausedMs: d });
    const shift = (t: number | null): number | null => (t == null ? null : t + d);
    m.hero_deadline = shift(m.hero_deadline);
    m.shop_starts_at = shift(m.shop_starts_at);
    m.shop_deadline = shift(m.shop_deadline);
    m.combat_deadline = shift(m.combat_deadline);
    m.intro_deadline = shift(m.intro_deadline);
    m.paused_seat = null;
    m.paused_at = null;
    m.pause_grace_until = null;
    m.resume_at = null;
    this.touchMatch();
    if (m.phase === 'shop' && m.shop_deadline == null && (m.p1_intro || m.p1_auto) && (m.p2_intro || m.p2_auto)) this.startClock();
  }

  /** `versus__complete`: the match ends and the room is Open again. */
  private complete(winner: Seat | null, reason: NonNullable<CoreMatch['end_reason']>): void {
    const m = this.state.match!;
    m.phase = 'complete';
    m.winner_seat = winner;
    m.end_reason = reason;
    m.paused_seat = null;
    m.paused_at = null;
    m.pause_grace_until = null;
    m.completed_at = this.now;
    this.touchMatch();
    const r = this.state.room;
    if (r.current_match_id === m.id) {
      r.status = 'open';
      r.p1_gate = false;
      r.p2_gate = false;
      r.gate_deadline = null;
      this.touchRoom();
    }
    this.fx.persist.push({ kind: 'match', row: this.persistMatchRow() });
  }

  /** `versus_reconcile` + `versus_reconcile_room` + the prune, run on every call and every alarm. */
  private reconcile(): void {
    const r = this.state.room;
    if (r.status === 'sealed' && this.now >= (r.gate_deadline ?? 0)) this.reopenGate();
    // Idle self-destruct: no match running and nobody has asked anything for ROOM_IDLE_MS.
    const live = this.matchRunning();
    if (!r.closed && !live && this.now - (r.last_activity_at ?? r.created_at) >= ROOM_IDLE_MS) {
      for (const mm of [...r.members]) this.leave(mm.userId);
      if (!r.closed) { r.closed = true; this.touchRoom(); }
      return;
    }
    for (const mm of [...r.members]) {
      if (mm.disconnectedAt != null && this.prunable(mm) && this.now - mm.disconnectedAt >= MEMBER_PRUNE_MS) this.leave(mm.userId);
    }
    if (this.grp && !r.closed) this.grp.reconcile();
    const m = this.state.match;
    if (!m || m.phase === 'complete' || r.closed) return;
    const gone1 = this.gone('p1');
    const gone2 = this.gone('p2');
    if (m.paused_at != null) {
      if (m.resume_at != null && this.now >= m.resume_at) {
        this.resume();
        this.maybeResolve();
        if (m.phase === 'combat' && (m.p1_ready || m.p1_auto) && (m.p2_ready || m.p2_auto)) this.openShop(m.round + 1);
      } else if (gone1 && gone2 && this.now >= m.paused_at + ABANDON_MS) {
        this.complete(null, 'abandoned');
        return;
      } else return;
    }
    // A newly absent player (not already on auto) pauses the shared clock.
    if ((gone1 && !m.p1_auto) || (gone2 && !m.p2_auto)) {
      m.paused_seat = gone1 && !m.p1_auto ? 'p1' : 'p2';
      m.paused_at = this.now;
      m.pause_grace_until = this.now + VERSUS_PAUSE_GRACE_SECONDS * 1000;
      m.resume_at = null;
      this.event('pause', { seat: m.paused_seat });
      this.touchMatch();
      return;
    }
    if (m.phase === 'hero_select' && this.now >= (m.hero_deadline ?? 0)) this.maybeStart();
    else if (m.phase === 'shop' && m.shop_deadline == null) {
      if (this.now >= (m.intro_deadline ?? 0) || ((m.p1_intro || m.p1_auto) && (m.p2_intro || m.p2_auto))) this.startClock();
    } else if (m.phase === 'shop' && this.now >= m.shop_deadline! + SHOP_GRACE_MS) {
      if (!m.p1_locked) this.finalizeSeat('p1', m.p1_auto);
      if (!m.p2_locked) this.finalizeSeat('p2', m.p2_auto);
      m.p1_locked = m.p2_locked = true;
      this.maybeResolve();
    } else if (m.phase === 'shop') this.maybeResolve();
    else if (m.phase === 'combat' && this.now >= (m.combat_deadline ?? Infinity)) this.openShop(m.round + 1);
  }

  private publishFrame(userId: string, a: Record<string, unknown>): unknown {
    const m = this.requireMatch(a.matchId);
    const seat = this.requireSeat(m, userId);
    if (a.frame == null || jsonBytes(a.frame) > FRAME_BYTES) fail('frame_too_large');
    const seq = Number(a.seq);
    const prev = this.frames.get(seat);
    if (!prev || prev.seq < seq) this.frames.set(seat, { seat, seq, round: Number(a.round), frame: a.frame });
    return null;
  }

  private roundsFrom(matchId: unknown, from: unknown): unknown {
    const m = this.state.match;
    if (!m || m.id !== matchId) return [];
    const f = Number.isInteger(from) ? (from as number) : 1;
    return Object.values(this.state.rounds).filter((r) => r.round >= f).sort((a, b) => a.round - b.round);
  }

  private myPrivate(userId: string, matchId: unknown): unknown {
    const m = this.state.match;
    if (!m || m.id !== matchId) return null;
    const seat = this.seatOf(userId);
    return seat ? this.privJson(seat) : null;
  }

  private myCheckpoint(userId: string, matchId: unknown): unknown {
    const m = this.state.match;
    if (!m || m.id !== matchId) return null;
    const seat = this.seatOf(userId);
    if (!seat) return null;
    const cur = this.state.subs[seat];
    if (cur && cur.final && cur.checkpoint != null) return { round: cur.round, final: true, candidate_seq: cur.candidate_seq, checkpoint: cur.checkpoint };
    return this.state.lastCheckpoint[seat] ?? null;
  }

  /** The `versus_matches` row the persistence writer upserts (room_id is null: the room lives in the object). */
  private persistMatchRow(): Record<string, unknown> {
    const m = this.state.match!;
    const j = this.matchJson()!;
    delete j.serverNow;
    return { ...j, room_id: null, seed: m.seed, p1_hearts: 7, p2_hearts: 7 };
  }
}

/** Sentinels: "answer with the match / room json as it stands AFTER this call settles". */
const MATCH_JSON = Symbol('match_json');
const ROOM_JSON = Symbol('room_json');
const GROUP_JSON = Symbol('group_json');

/** Replace sentinels nested one level deep (the reroll answer, the heartbeat answer). */
export function resolveSentinels(data: unknown, core: RoomCore): unknown {
  if (data === MATCH_JSON) return core.matchJson();
  if (data === ROOM_JSON) return core.roomJson();
  if (data === GROUP_JSON) return core.grp?.json() ?? null;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === MATCH_JSON) { out[k] = core.matchJson(); changed = true; } else if (v === ROOM_JSON) { out[k] = core.roomJson(); changed = true; } else if (v === GROUP_JSON) { out[k] = core.grp?.json() ?? null; changed = true; } else out[k] = v;
    }
    return changed ? out : data;
  }
  return data;
}
