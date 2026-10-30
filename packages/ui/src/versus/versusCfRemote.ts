/**
 * VERSUS ON CLOUDFLARE: the game's one Versus transport (R-VERSUS-CF-ONLY-01, owner 2026-10-29; design:
 * docs/design/2026-10-28-versus-cloudflare.md). Every mode (1v1, Group, Versus Duos, Ranked Duos) is a room Durable
 * Object on the Versus Worker, reached over one WebSocket.
 *
 * How the calls map:
 *   - every room/match write is a request on the room socket (answered with the same row json the original SQL returned);
 *   - every room/match READ is answered from the pushes the room already sent (no round trip): the store's
 *     "something changed, read it again" wake-ups (`subscribeRoom`) arrive WITH the new rows;
 *   - `finalize` is a no-op: the room resolves the fight itself the moment the round closes, and pushes it;
 *   - the room list, my room and room creation are plain HTTP on the Worker;
 *   - the RECORDS that live in Supabase (team names, a settled ranked result, the leaderboard, the dev bot flag) go to
 *     `deps.records`.
 *
 * Auth: the game's Supabase access token when signed in (the Worker verifies it); otherwise, against a dev Worker
 * (`DEV_AUTH=1`), a dev token naming this browser's account id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ownSeatPerspective, VERSUS_PROTOCOL, type HeroReroll, type PreparedCombatSide, type VersusGroupSeat, type VersusRoomOptions, type VersusSeatScout } from '@game/sim';
import type { CombatResult } from '@game/core';
import { contentRevision } from '@game/content';
import { VersusCfClient, VersusCfError, versusCfHttp } from '@game/versus-cf/client';
import { VERSUS_CF_PROTOCOL, type VersusCfPush } from '@game/versus-cf/protocol';
import { resyncLobbyChat } from '../lobbyChat/lobbyChatStore';
import type {
  VersusDuosPassRow,
  VersusRecords,
  RankedDuosRoundRow,
  RankedDuosTableRaw,
  RankedDuosTeamRead,
  VersusGroupMatchRaw,
  VersusGroupRoundRaw,
  VersusIdentity,
  VersusMatch,
  VersusPrivate,
  VersusRemote,
  VersusRole,
  VersusRoom,
  VersusRoomSummary,
  VersusRoundRow,
  VersusOwnSubmission,
  VersusRerollResult,
} from './versusRemote';

const HOST_KEY = 'ascent.versusHost';
const URL_KEY = 'ascent.versusCfUrl';
export const VERSUS_CF_DEFAULT_URL = 'http://127.0.0.1:8787';
/**
 * THE ROOM SOCKET NEVER HANGS (R-VERSUS-CF-CONNECT-01, live 2026-10-29: Duo + Play sat on "Opening your party..." for
 * good on the Cloudflare host). Opening a room's socket waits at most this long for the room's hello; past it the call
 * fails with `timeout`, which the screen shows with Try again (never a room on another backend, R-VERSUS-CF-ONLY-01).
 */
export const VERSUS_CF_CONNECT_TIMEOUT_MS = 10_000;
/** The deployed Worker for THIS build's engine (`workers/versus/scripts/deploy.ts` names it the same way). */
export const versusCfLiveUrl = (rev: string = contentRevision()): string =>
  `https://ascent-versus-v${VERSUS_CF_PROTOCOL}-${rev}.team-ascent.workers.dev`;

/** Did this dev tab pick a Worker of its own (`?versusHost=cf` / `cf-live`, `?versusCfUrl=`)? Dev builds (or the Versus
 *  test tools) only. Every build talks to a Worker either way; this only says the tab chose which one. */
export function versusCfSelected(): boolean {
  try {
    const devOk = import.meta.env.DEV || localStorage.getItem('ascent.versus') === '1';
    if (!devOk || typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search);
    const host = q.get('versusHost');
    if (host === 'cf') sessionStorage.setItem(HOST_KEY, 'cf');
    // `cf-live`: the deployed Worker that carries THIS build's engine (versioned by content revision).
    if (host === 'cf-live') { sessionStorage.setItem(HOST_KEY, 'cf'); sessionStorage.setItem(URL_KEY, versusCfLiveUrl()); }
    if (host === 'off') sessionStorage.removeItem(HOST_KEY);
    const url = q.get('versusCfUrl');
    if (url && (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url) || /^https:\/\/[a-z0-9-]+\.team-ascent\.workers\.dev$/.test(url))) sessionStorage.setItem(URL_KEY, url);
    return sessionStorage.getItem(HOST_KEY) === 'cf';
  } catch {
    return false;
  }
}

/** The Worker a dev tab picked (`?versusCfUrl=` / `?versusHost=cf-live`), else local `wrangler dev`. */
export function versusCfDevUrl(): string {
  return workerUrl();
}

function workerUrl(): string {
  try {
    return sessionStorage.getItem(URL_KEY) ?? VERSUS_CF_DEFAULT_URL;
  } catch {
    return VERSUS_CF_DEFAULT_URL;
  }
}

export interface CfRemoteDeps {
  /** The Worker to talk to (the game passes the build's own Worker); default: the dev tab's pick. */
  baseUrl?: string;
  getClient: () => SupabaseClient | null;
  currentUserId: () => string | null;
  /** The adapter's error type (`VersusError`), injected to keep this module free of a value import cycle. */
  makeError: (code: string, message?: string) => Error;
  /** DEV ONLY: with no backend configured (no Supabase session, no account id), give this tab a throwaway account id so
   *  the store can tell which seat is its own. Never used when a real identity exists. */
  adoptDevIdentity?: (userId: string) => void;
  /** The Supabase-held records (the Duos leaderboard, team names, a ranked result, the dev bot flag): not room state. */
  records?: VersusRecords;
}

/** A throwaway account id for this TAB (each headless test player is its own tab). */
function devUserId(): string {
  const key = 'ascent.versusCfDevUser';
  try {
    const have = sessionStorage.getItem(key);
    if (have) return have;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

type Change = 'room' | 'members' | 'match' | 'rounds' | 'passes';

export function makeCfVersusRemote(deps: CfRemoteDeps): VersusRemote {
  const base = deps.baseUrl ?? workerUrl();
  let roomId: string | null = null;
  let client: VersusCfClient | null = null;
  let room: VersusRoom | null = null;
  let match: VersusMatch | null = null;
  let priv: VersusPrivate | null = null;
  const rounds = new Map<number, VersusRoundRow>();
  /** VERSUS GROUP (3-4 players): the room's current group match (`versus_group__match_json` shape) and its rounds. */
  let group: VersusGroupMatchRaw | null = null;
  const groupRounds = new Map<number, VersusGroupRoundRaw>();
  /** RANKED DUOS: the committed rounds (pushed as they commit). */
  const rankedRounds = new Map<number, RankedDuosRoundRow>();
  const isGroupJson = (m: Record<string, unknown>): boolean => Array.isArray(m.seats);
  /** The latest committed round of a match row (combat / complete: this one; otherwise the one before). */
  const committedOf = (m: { phase: string; round: number }): number => (m.phase === 'combat' || m.phase === 'complete' ? m.round : m.round - 1);
  const listeners = new Set<{ onChange: (what: Change, row?: Record<string, unknown>) => void; onBroadcast?: (event: string, payload: unknown) => void }>();

  const err = (e: unknown): never => {
    if (e instanceof VersusCfError) throw deps.makeError(e.code);
    throw deps.makeError('network', (e as Error)?.message);
  };

  async function token(): Promise<string> {
    const c = deps.getClient();
    if (c) {
      const { data } = await c.auth.getSession();
      if (data.session?.access_token) return data.session.access_token;
    }
    let me = deps.currentUserId();
    if (!me && deps.adoptDevIdentity) {
      me = devUserId();
      deps.adoptDevIdentity(me);
    }
    if (!me) throw deps.makeError('not_signed_in');
    return `dev.${me}.dev`;
  }

  const roundOf = (row: Record<string, unknown>): VersusRoundRow => {
    const r = row as unknown as VersusRoundRow;
    return r.p2_result ? { ...r, p2_result: ownSeatPerspective(r.p2_result as CombatResult) } : r;
  };

  function onPush(msg: VersusCfPush): void {
    if (msg.t === 'room') {
      room = msg.room as unknown as VersusRoom;
      for (const l of listeners) l.onChange('room');
    } else if (msg.t === 'match') {
      if (isGroupJson(msg.match)) {
        const g = msg.match as unknown as VersusGroupMatchRaw;
        if (group && g.id !== group.id) groupRounds.clear();
        group = g;
        match = null;
      } else {
        const m = msg.match as unknown as VersusMatch;
        if (match && m.id !== match.id) rounds.clear();
        match = m;
        group = null;
      }
      for (const l of listeners) l.onChange('match');
    } else if (msg.t === 'round') {
      if (msg.row.kind === 'ranked') {
        // RANKED DUOS: a committed round of the four teams (vitals by team, the live team's fight in full).
        rankedRounds.set(Number(msg.row.round), msg.row as unknown as RankedDuosRoundRow);
        for (const l of listeners) l.onChange('rounds');
        return;
      }
      if (Array.isArray(msg.row.fights)) {
        const g = msg.row as unknown as VersusGroupRoundRaw & { match_id?: string };
        if (group && g.match_id && g.match_id !== group.id) return;
        groupRounds.set(g.round, g);
        for (const l of listeners) l.onChange('rounds');
        return;
      }
      const r = roundOf(msg.row);
      if (match && r.match_id !== match.id) return;
      rounds.set(r.round, r);
      for (const l of listeners) l.onChange('rounds');
    } else if (msg.t === 'pass') {
      // VERSUS DUOS: a pass to or from my teammate (only the two teammates receive it, as the table's RLS).
      for (const l of listeners) l.onChange('passes', msg.row);
    } else if (msg.t === 'priv') {
      priv = msg.priv as unknown as VersusPrivate;
    } else if (msg.t === 'bc') {
      for (const l of listeners) l.onBroadcast?.(msg.event, msg.payload);
    } else if (msg.t === 'closed') {
      room = null;
      for (const l of listeners) l.onChange('room');
    }
  }

  /** The room's socket (opened on first use, reused after). */
  async function socket(id: string): Promise<VersusCfClient> {
    if (client && roomId === id) return client;
    client?.close();
    roomId = id;
    room = null;
    match = null;
    priv = null;
    rounds.clear();
    group = null;
    groupRounds.clear();
    rankedRounds.clear();
    const c = new VersusCfClient({
      baseUrl: base, roomId: id, token, versusProtocol: VERSUS_PROTOCOL, contentRevision: contentRevision(),
      connectTimeoutMs: VERSUS_CF_CONNECT_TIMEOUT_MS,
      ws: (url, protocols) => new WebSocket(url, protocols) as never, onPush,
      // LOBBY CHAT (R-LOBBY-CHAT-02): every (re)connect catches the room's chat up on what was said while it was down.
      onStatus: (st) => { if (st === 'open') resyncLobbyChat(); },
      // The network is back: reconnect now, not after the backoff (R-VERSUS-CF-RECONNECT-01).
      wake: (fn) => {
        if (typeof window === 'undefined') return () => undefined;
        window.addEventListener('online', fn);
        return () => window.removeEventListener('online', fn);
      },
    });
    client = c;
    try {
      await c.connect();
    } catch (e) {
      // A socket that never opened is dropped (a later call opens a fresh one) rather than left retrying behind a caller
      // that has already been told it failed.
      if (client === c) { c.close(); client = null; roomId = null; }
      else c.close();
      return err(e);
    }
    return c;
  }

  async function req<T>(id: string | null, op: Parameters<VersusCfClient['request']>[0], args: Record<string, unknown> = {}): Promise<T> {
    const target = id ?? roomId;
    if (!target) throw deps.makeError('no_room');
    try {
      return await (await socket(target)).request<T>(op, args);
    } catch (e) {
      return err(e);
    }
  }

  /** A match-scoped call goes to the room that holds the match (the current one). */
  const mreq = <T>(op: Parameters<VersusCfClient['request']>[0], args: Record<string, unknown>): Promise<T> => req<T>(roomId, op, args);
  const unsupported = (): Promise<never> => Promise.reject(deps.makeError('cf_unsupported'));
  const http = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    try {
      return await versusCfHttp<T>(base, path, await token(), init);
    } catch (e) {
      return err(e);
    }
  };

  return {
    listRooms: () => http<VersusRoomSummary[]>('/rooms'),
    openRooms: (contentRevision: string) =>
      http<{ open: number; seatOpen: number; duosOpen?: number }>(`/rooms/open?protocol=${VERSUS_PROTOCOL}&content=${encodeURIComponent(contentRevision)}`),
    setFriendsOnly: (id: string, on: boolean) => req<VersusRoom>(id, 'friends_only', { on }),
    /** FRIEND INVITES (R-VERSUS-CF-INVITE-01): the room checks the invite (open, I am in, they are not) and signs it;
     *  `friends_invite` refuses a Cloudflare invite without that proof. */
    inviteProof: async (id: string, to: string, kind: string) => (await req<{ proof: string }>(id, 'invite_proof', { to, kind })).proof,
    // Not room state: the Supabase rows (team names, the leaderboard, a settled ranked result) are read where they live.
    setTeamName: (partner: string, name: string) => (deps.records ? deps.records.setTeamName(partner, name) : unsupported()),
    duosResult: async (matchId: string) => (deps.records ? deps.records.duosResult(matchId) : null),
    duosTeam: async (a: string, b: string) => (deps.records ? deps.records.duosTeam(a, b) : null),
    duosLeaderboard: async (limit?: number, offset?: number) => (deps.records ? deps.records.duosLeaderboard(limit, offset) : []),
    duosTeamsOf: async (userId: string) => (deps.records ? deps.records.duosTeamsOf(userId) : []),
    async createRoom(name: string, me: VersusIdentity, options?: VersusRoomOptions | null) {
      const r = await http<VersusRoom>('/rooms', {
        method: 'POST', body: { name, display: me.displayName, profile: me.profile, setId: me.setId, contentRevision: me.contentRevision, protocol: VERSUS_PROTOCOL, options: options ?? null },
      });
      await socket(r.id);
      return room ?? r;
    },
    setOptions: (id: string, options: VersusRoomOptions) => req<VersusRoom>(id, 'set_options', { options }),
    joinRoom: (id: string, as: 'player' | 'spectator', me: VersusIdentity) =>
      req<VersusRoom>(id, 'join', { as, display: me.displayName, profile: me.profile, content: me.contentRevision, protocol: VERSUS_PROTOCOL }),
    takeSeat: (id: string, role: VersusRole) => req<VersusRoom>(id, 'take_seat', { role }),
    async leaveRoom(id: string) {
      const out = await req<{ left: boolean }>(id, 'leave');
      if (roomId === id) { client?.close(); client = null; roomId = null; }
      return out;
    },
    startGame: (id: string) => req<VersusRoom>(id, 'start'),
    pressGate: (id: string) => req<VersusRoom>(id, 'gate'),
    reconcileRoom: (id: string) => req<VersusRoom>(id, 'reconcile_room'),
    heartbeat: (id: string) => req<{ serverNow: string; match?: VersusMatch; seen?: Record<string, string> }>(id, 'heartbeat'),
    async room(id: string) {
      if (roomId === id && room) return room;
      const s = await req<{ room: VersusRoom | null }>(id, 'sync');
      return s.room;
    },
    async myRoomId() {
      return (await http<{ roomId: string | null }>('/me/room')).roomId;
    },
    async match(id: string) {
      if (match?.id === id) return match;
      if (group?.id === id || !roomId) return null; // a group match: the store reads it through groupMatch
      const s = await req<{ match: Record<string, unknown> | null }>(roomId, 'sync');
      if (s.match && isGroupJson(s.match)) { group = s.match as unknown as VersusGroupMatchRaw; return null; }
      return s.match?.id === id ? (s.match as unknown as VersusMatch) : null;
    },
    async myPrivate(id: string) {
      if (priv?.match_id === id) return priv;
      return roomId ? mreq<VersusPrivate | null>('my_private', { matchId: id }) : null;
    },
    async rounds(matchId: string, fromRound = 1) {
      // Served from the pushes when they cover every committed round from `fromRound`; else one read (a reload).
      const last = match?.id === matchId ? (match.phase === 'combat' || match.phase === 'complete' ? match.round : match.round - 1) : -1;
      let complete = last >= fromRound || last === fromRound - 1;
      for (let r = fromRound; complete && r <= last; r++) if (!rounds.has(r)) complete = false;
      if (!complete && roomId) {
        const rows = await mreq<Record<string, unknown>[]>('rounds', { matchId, from: fromRound });
        for (const row of rows) { const r = roundOf(row); rounds.set(r.round, r); }
      }
      return [...rounds.values()].filter((r) => r.match_id === matchId && r.round >= fromRound).sort((a, b) => a.round - b.round);
    },
    myLatestCheckpoint: (id: string) => mreq<VersusOwnSubmission | null>('my_checkpoint', { matchId: id }),
    registerOffer: (id: string, offer: string[]) => mreq<VersusMatch>('register_offer', { matchId: id, offer }),
    pickHero: (id: string, index: number) => mreq<VersusMatch>('pick_hero', { matchId: id, index }),
    async rerollHero(id: string, slot: number, candidates: string[]) {
      const out = await mreq<VersusRerollResult>('reroll_hero', { matchId: id, slot, candidates });
      if (priv?.match_id === id) priv = { ...priv, hero_offer: out.offer, hero_reroll: out.reroll };
      return out;
    },
    submit: (id: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null) =>
      mreq<VersusMatch>('submit', { matchId: id, round, seq, side, final, checkpoint, scout: scout ?? null }),
    introDone: (id: string) => mreq<VersusMatch>('intro_done', { matchId: id }),
    combatReady: (id: string, round: number) => mreq<VersusMatch>('combat_ready', { matchId: id, round }),
    forfeit: (id: string) => mreq<VersusMatch>('forfeit', { matchId: id }),
    unpause: (id: string) => mreq<VersusMatch>('unpause', { matchId: id }),
    requestResume: (id: string) => mreq<VersusMatch>('request_resume', { matchId: id }),
    reconcile: async (id: string) => (match?.id === id ? match : mreq<VersusMatch>('reconcile', { matchId: id })),
    unready: (id: string, round: number, seq: number) => mreq<VersusMatch>('unready', { matchId: id, round, seq }),
    publishFrame: (id: string, seq: number, round: number, frame: unknown) => mreq<void>('publish_frame', { matchId: id, seq, round, frame }),
    latestFrames: (id: string) => mreq<{ seat: 'p1' | 'p2'; seq: number; round: number; frame: unknown }[]>('latest_frames', { matchId: id }),

    // ── VERSUS GROUP (3-4 players): the same room ops; answers are the group json (`versus_group__match_json`). ──
    async groupMatch(id: string) {
      if (group?.id === id) return group;
      if (!roomId) return null;
      const s = await req<{ match: Record<string, unknown> | null }>(roomId, 'sync');
      if (s.match && isGroupJson(s.match) && s.match.id === id) { group = s.match as unknown as VersusGroupMatchRaw; return group; }
      return null;
    },
    async groupRounds(matchId: string, fromRound = 1) {
      const last = group?.id === matchId ? committedOf(group) : -1;
      let complete = last >= fromRound - 1;
      for (let r = fromRound; complete && r <= last; r++) if (!groupRounds.has(r)) complete = false;
      if (!complete && roomId) {
        for (const row of await mreq<VersusGroupRoundRaw[]>('rounds', { matchId, from: fromRound })) groupRounds.set(row.round, row);
      }
      return [...groupRounds.values()].filter((r) => r.round >= fromRound && r.fights.length > 0).sort((a, b) => a.round - b.round);
    },
    async groupMyPrivate(id: string) {
      if (priv?.match_id === id) return priv;
      return roomId ? mreq<VersusPrivate | null>('my_private', { matchId: id }) : null;
    },
    groupMyLatestCheckpoint: (id: string) => mreq<VersusOwnSubmission | null>('my_checkpoint', { matchId: id }),
    groupRegisterOffer: (id: string, offer: string[]) => mreq<VersusGroupMatchRaw>('register_offer', { matchId: id, offer }),
    groupPickHero: (id: string, index: number) => mreq<VersusGroupMatchRaw>('pick_hero', { matchId: id, index }),
    async groupRerollHero(id: string, slot: number, candidates: string[]) {
      const out = await mreq<{ match: VersusGroupMatchRaw; offer: string[]; reroll: HeroReroll }>('reroll_hero', { matchId: id, slot, candidates });
      if (priv?.match_id === id) priv = { ...priv, hero_offer: out.offer, hero_reroll: out.reroll };
      return out;
    },
    groupSubmit: (id: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null) =>
      mreq<VersusGroupMatchRaw>('submit', { matchId: id, round, seq, side, final, checkpoint, scout: scout ?? null }),
    groupIntroDone: (id: string) => mreq<VersusGroupMatchRaw>('intro_done', { matchId: id }),
    groupCombatReady: (id: string, round: number) => mreq<VersusGroupMatchRaw>('combat_ready', { matchId: id, round }),
    groupForfeit: (id: string) => mreq<VersusGroupMatchRaw>('forfeit', { matchId: id }),
    groupUnpause: (id: string) => mreq<VersusGroupMatchRaw>('unpause', { matchId: id }),
    groupRequestResume: (id: string) => mreq<VersusGroupMatchRaw>('request_resume', { matchId: id }),
    groupReconcile: async (id: string) => (group?.id === id ? group : mreq<VersusGroupMatchRaw>('reconcile', { matchId: id })),
    groupPublishFrame: (id: string, seq: number, round: number, frame: unknown) => mreq<void>('publish_frame', { matchId: id, seq, round, frame }),
    groupLatestFrames: (id: string) => mreq<{ seat: VersusGroupSeat; seq: number; round: number; frame: unknown }[]>('latest_frames', { matchId: id }),
    groupUnready: (id: string, round: number, seq: number) => mreq<VersusGroupMatchRaw>('unready', { matchId: id, round, seq }),
    /** The room resolved the round itself when it closed; nothing to ask for. */
    finalizeGroup: async () => undefined,

    // ── Not on Cloudflare yet (Ranked Duos): reads answer "nothing", writes refuse. ─────────────────────────────────
    /** The room resolved the round itself when it closed; nothing to ask for. */
    finalizeDuos: async () => undefined,
    /** The room seats the table and resolves every round itself; nothing to ask for. */
    finalizeRankedDuos: async () => undefined,
    seatRankedDuos: async () => undefined,
    rankedTable: (id: string) => mreq<RankedDuosTableRaw>('ranked_table', { matchId: id }),
    rankedTeams: (id: string) => mreq<RankedDuosTeamRead[]>('ranked_teams', { matchId: id }),
    async rankedRounds(id: string, fromRound = 1) {
      const last = group?.id === id ? committedOf(group) : -1;
      let complete = last >= fromRound - 1;
      for (let r = fromRound; complete && r <= last; r++) if (!rankedRounds.has(r)) complete = false;
      if (!complete && roomId) for (const row of await mreq<RankedDuosRoundRow[]>('ranked_rounds', { matchId: id, from: fromRound })) rankedRounds.set(row.round, row);
      return [...rankedRounds.values()].filter((r) => r.round >= fromRound).sort((a, b) => a.round - b.round);
    },
    duosPass: (id: string, round: number, seq: number, card: unknown) => mreq<VersusDuosPassRow>('duos_pass', { matchId: id, round, seq, card }),
    duosHandRoom: (id: string, room: number) => mreq<void>('duos_hand_room', { matchId: id, room }),
    duosAnswerPass: (id: string, fromSeat: VersusGroupSeat, seq: number, landed: boolean) =>
      mreq<VersusDuosPassRow>('duos_answer_pass', { matchId: id, fromSeat, seq, landed }),
    duosPasses: (id: string, fromRound: number) => mreq<VersusDuosPassRow[]>('duos_passes', { matchId: id, from: fromRound }),
    testBotRegister: (host: string, slot: number) => (deps.records ? deps.records.testBotRegister(host, slot) : unsupported()),
    devSetVitals: unsupported,
    devSkipShop: unsupported,
    /** The room resolved the round itself when it closed; nothing to ask for. */
    finalize: async () => undefined,

    subscribeRoom(id: string, _matchId: string | null, onChange: (what: Change, row?: Record<string, unknown>) => void, onBroadcast?: (event: string, payload: unknown) => void) {
      const l = { onChange, onBroadcast };
      listeners.add(l);
      void socket(id).catch(() => undefined);
      return {
        send: (event: string, payload: unknown) => { if (roomId === id) client?.broadcast(event, payload); },
        close: async () => { listeners.delete(l); },
      };
    },
  };
}
