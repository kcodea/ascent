/**
 * VERSUS CUTOVER: the routed adapter (owner decision 2026-10-28, docs/versus-cf-cutover.md, R-VERSUS-CF-CUTOVER-01).
 *
 * One `VersusRemote` over TWO backends, so the store and every screen keep calling one adapter while rooms live on
 * Supabase or on Cloudflare:
 *
 *   - createRoom     → the host the per-mode switch names for the new room's mode (`versusHost.ts`); a Cloudflare
 *                      create that fails on the network falls back to Supabase, so a Worker outage never blocks play.
 *   - room calls     → the host the room was created on (remembered; an unknown id is looked up in the Worker's room
 *                      list, else it is a Supabase room). A room never changes host.
 *   - match calls    → the host its room is on (learned from the room's `current_match_id`; else the current room's).
 *   - listRooms / openRooms / myRoomId → BOTH backends, merged (either one failing still answers the other).
 *   - records (Duos results, teams, leaderboard) and dev bots → Supabase, where the records live for both hosts.
 *
 * With no Worker in the build (`cf === null`) every call goes straight to Supabase: today's behaviour, byte for byte.
 */
import type { VersusMode, VersusRoomOptions } from '@game/sim';
import { DEFAULT_HOST_CONFIG, hostForNewRoom, type RoomHostMemory, type VersusHost, type VersusHostConfig } from './versusHost';
import type { VersusIdentity, VersusRemote, VersusRoom, VersusRoomSummary } from './versusRemote';

type Route = 'room' | 'match' | 'supabase' | 'special';

/**
 * Every adapter method, classified. Typed as a Record over the adapter's keys: a method added to `VersusRemote` without
 * a line here fails the typecheck, so nothing can silently skip the router.
 */
export const VERSUS_ROUTES: Record<keyof VersusRemote, Route> = {
  listRooms: 'special', openRooms: 'special', createRoom: 'special', myRoomId: 'special', subscribeRoom: 'special',
  setFriendsOnly: 'room', inviteProof: 'room', setOptions: 'room', joinRoom: 'room', takeSeat: 'room', leaveRoom: 'room', startGame: 'room',
  pressGate: 'room', reconcileRoom: 'room', heartbeat: 'room', room: 'room',
  setTeamName: 'supabase', duosResult: 'supabase', duosTeam: 'supabase', duosLeaderboard: 'supabase', duosTeamsOf: 'supabase',
  testBotRegister: 'supabase',
  match: 'match', myPrivate: 'match', rounds: 'match', myLatestCheckpoint: 'match', registerOffer: 'match', pickHero: 'match',
  rerollHero: 'match', submit: 'match', introDone: 'match', combatReady: 'match', forfeit: 'match', unpause: 'match',
  requestResume: 'match', reconcile: 'match', unready: 'match', publishFrame: 'match', latestFrames: 'match',
  groupMatch: 'match', groupRounds: 'match', groupMyPrivate: 'match', groupMyLatestCheckpoint: 'match',
  groupRegisterOffer: 'match', groupPickHero: 'match', groupRerollHero: 'match', groupSubmit: 'match', groupIntroDone: 'match',
  groupCombatReady: 'match', groupForfeit: 'match', groupUnpause: 'match', groupRequestResume: 'match', groupReconcile: 'match',
  groupPublishFrame: 'match', groupLatestFrames: 'match', groupUnready: 'match',
  finalize: 'match', finalizeGroup: 'match', finalizeDuos: 'match', finalizeRankedDuos: 'match', seatRankedDuos: 'match',
  rankedTable: 'match', rankedTeams: 'match', rankedRounds: 'match',
  duosPass: 'match', duosHandRoom: 'match', duosAnswerPass: 'match', duosPasses: 'match',
  devSetVitals: 'match', devSkipShop: 'match',
};

/** Errors that mean "the Worker could not be reached", not "the Worker said no". */
const UNREACHABLE = new Set(['network', 'timeout', 'closed', 'http_500', 'http_502', 'http_503', 'http_504']);
const codeOf = (e: unknown): string => String((e as { code?: unknown })?.code ?? '');

export interface RoutedRemoteDeps {
  supabase: VersusRemote;
  /** The Cloudflare transport, or null when this build carries no Worker (then nothing is routed). */
  cf: VersusRemote | null;
  /** The per-mode switch (cached by the caller). */
  readConfig: () => Promise<VersusHostConfig>;
  /** The dev override, re-read on every room creation. */
  override?: () => Partial<VersusHostConfig> | null;
  memory: RoomHostMemory;
  /** How long the Worker's room list is trusted when looking up an unknown room id. */
  lookupTtlMs?: number;
  now?: () => number;
  warn?: (msg: string) => void;
}

export interface RoutedVersusRemote extends VersusRemote {
  /** The host of a room this client has seen (Supabase when unknown). */
  hostOf(roomId: string): VersusHost;
  /** Where a NEW room of this mode would go right now (the cached switch; no network). */
  hostForMode(mode: VersusMode): VersusHost;
  /** Teach the router a room's host (a `cf:` invite or Watch id). */
  noteRoomHost(roomId: string, host: VersusHost): void;
  /** Read the switch ahead of time (launch), so `hostForMode` answers from the server's value. */
  warmConfig(): Promise<void>;
}

export function makeRoutedVersusRemote(deps: RoutedRemoteDeps): RoutedVersusRemote {
  const { supabase, cf, memory } = deps;
  const now = deps.now ?? Date.now;
  const lookupTtl = deps.lookupTtlMs ?? 10_000;
  const matchHost = new Map<string, VersusHost>();
  let current: VersusHost = 'supabase';
  let lastConfig: VersusHostConfig | null = null;
  let cfList: { at: number; ids: Set<string> } | null = null;

  const remoteOf = (h: VersusHost): VersusRemote => (h === 'cf' && cf ? cf : supabase);

  /** Learn from anything a call answered: a room (and its current match), a match, a heartbeat's match. */
  function learn(value: unknown, host: VersusHost): void {
    if (!value || typeof value !== 'object') return;
    const v = value as { id?: unknown; current_match_id?: unknown; members?: unknown; match?: { id?: unknown }; groupMatch?: { id?: unknown }; host?: unknown };
    if (typeof v.id === 'string' && Array.isArray(v.members)) {
      memory.set(v.id, host);
      if ((v as VersusRoom).host !== host) (v as VersusRoom).host = host;
      if (typeof v.current_match_id === 'string') matchHost.set(v.current_match_id, host);
    }
    if (typeof v.match?.id === 'string') matchHost.set(v.match.id, host);
    if (typeof v.groupMatch?.id === 'string') matchHost.set(v.groupMatch.id, host);
  }

  async function cfRoomIds(): Promise<Set<string>> {
    if (!cf) return new Set();
    if (cfList && now() - cfList.at < lookupTtl) return cfList.ids;
    const ids = new Set((await cf.listRooms().catch(() => [] as VersusRoomSummary[])).map((r) => r.id));
    cfList = { at: now(), ids };
    return ids;
  }

  async function hostOfRoom(roomId: string): Promise<VersusHost> {
    if (!cf) return 'supabase';
    const known = memory.get(roomId);
    if (known) return known;
    const host: VersusHost = (await cfRoomIds()).has(roomId) ? 'cf' : 'supabase';
    memory.set(roomId, host);
    return host;
  }

  const routed: Record<string, unknown> = {};
  for (const [name, route] of Object.entries(VERSUS_ROUTES) as [keyof VersusRemote, Route][]) {
    if (route === 'special') continue;
    const call = (r: VersusRemote, args: unknown[]): Promise<unknown> => (r[name] as (...a: unknown[]) => Promise<unknown>)(...args);
    if (route === 'supabase') routed[name] = (...args: unknown[]) => call(supabase, args);
    else if (route === 'room') {
      routed[name] = async (...args: unknown[]) => {
        const host = await hostOfRoom(String(args[0]));
        current = host;
        const out = await call(remoteOf(host), args);
        learn(out, host);
        return out;
      };
    } else {
      routed[name] = async (...args: unknown[]) => {
        const host = cf ? (matchHost.get(String(args[0])) ?? current) : 'supabase';
        return call(remoteOf(host), args);
      };
    }
  }

  async function both<T>(fn: (r: VersusRemote) => Promise<T>): Promise<{ supa: T | null; cfv: T | null }> {
    if (!cf) return { supa: await fn(supabase), cfv: null };
    const [a, b] = await Promise.allSettled([fn(supabase), fn(cf)]);
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    if (b.status === 'rejected') deps.warn?.(`versus: Cloudflare list failed (${codeOf(b.reason) || 'error'}); showing Supabase rooms only`);
    return { supa: a.status === 'fulfilled' ? a.value : null, cfv: b.status === 'fulfilled' ? b.value : null };
  }

  const special = {
    async listRooms(): Promise<VersusRoomSummary[]> {
      const { supa, cfv } = await both((r) => r.listRooms());
      if (cfv) cfList = { at: now(), ids: new Set(cfv.map((r) => r.id)) };
      return mergeRoomLists(supa ?? [], cfv ?? []);
    },
    async openRooms(rev: string) {
      const { supa, cfv } = await both((r) => r.openRooms(rev));
      const add = (k: 'open' | 'seatOpen' | 'duosOpen'): number => (supa?.[k] ?? 0) + (cfv?.[k] ?? 0);
      return { open: add('open'), seatOpen: add('seatOpen'), duosOpen: add('duosOpen') };
    },
    async myRoomId(userId: string): Promise<string | null> {
      const { supa, cfv } = await both((r) => r.myRoomId(userId));
      // Both answering is a stale leftover on one side: trust the one this client last played on.
      const pick: VersusHost | null = supa && cfv ? (memory.get(cfv) === 'cf' ? 'cf' : 'supabase') : cfv ? 'cf' : supa ? 'supabase' : null;
      if (!pick) return null;
      const id = (pick === 'cf' ? cfv : supa) as string;
      memory.set(id, pick);
      current = pick;
      return id;
    },
    async createRoom(name: string, me: VersusIdentity, options?: VersusRoomOptions | null): Promise<VersusRoom> {
      const mode: VersusMode = options?.mode ?? 'duel';
      lastConfig = cf ? await deps.readConfig() : lastConfig;
      let host = hostForNewRoom(mode, lastConfig ?? DEFAULT_HOST_CONFIG, deps.override?.() ?? null, !!cf);
      let room: VersusRoom;
      try {
        room = await remoteOf(host).createRoom(name, me, options);
      } catch (e) {
        if (host !== 'cf' || !UNREACHABLE.has(codeOf(e))) throw e;
        deps.warn?.(`versus: Cloudflare unreachable (${codeOf(e)}); creating the room on Supabase`);
        host = 'supabase';
        room = await supabase.createRoom(name, me, options);
      }
      current = host;
      learn(room, host);
      return room;
    },
    subscribeRoom(...args: Parameters<VersusRemote['subscribeRoom']>) {
      const host = cf ? (memory.get(args[0]) ?? current) : 'supabase';
      if (args[1]) matchHost.set(args[1], host);
      return remoteOf(host).subscribeRoom(...args);
    },
  };

  return {
    ...(routed as unknown as VersusRemote),
    ...special,
    hostOf: (roomId: string) => (cf ? memory.get(roomId) ?? 'supabase' : 'supabase'),
    hostForMode: (mode: VersusMode) => hostForNewRoom(mode, lastConfig ?? DEFAULT_HOST_CONFIG, deps.override?.() ?? null, !!cf),
    noteRoomHost: (roomId: string, host: VersusHost) => { if (cf) memory.set(roomId, host); },
    async warmConfig(): Promise<void> { if (cf) lastConfig = await deps.readConfig(); },
  } as RoutedVersusRemote;
}

/** Both lists as one: every summary tagged with its host, newest first, a duplicate id kept once (Supabase wins). */
export function mergeRoomLists(supa: VersusRoomSummary[], cfRooms: VersusRoomSummary[]): VersusRoomSummary[] {
  const seen = new Set<string>();
  const out: VersusRoomSummary[] = [];
  for (const [list, host] of [[supa, 'supabase'], [cfRooms, 'cf']] as const) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ ...r, host });
    }
  }
  // Stable: equal timestamps keep Supabase's own order.
  return out.map((r, i) => ({ r, i })).sort((a, b) => String(b.r.createdAt ?? '').localeCompare(String(a.r.createdAt ?? '')) || a.i - b.i).map((x) => x.r);
}
