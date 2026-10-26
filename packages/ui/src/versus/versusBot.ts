/**
 * VERSUS TEST BOTS — the browser host (owner 2026-10-14; dev / test builds only, see `versusTestToolsEnabled`).
 *
 * Up to THREE bots (owner 2026-10-25: "id like the ability to test the various mechanics with bots", so Group and Duos
 * can be played alone): one per bot slot, each a second Supabase client in this tab with its OWN anonymous session
 * persisted under its own storage key (slot 1 keeps the original key, so the existing Test Bot account is reused), so
 * every bot holds its own seat. Each joins the room as a player through the normal RPCs, moves to the seat the host
 * picked, registers itself as this host's test bot (2026-10-25-versus-test-bots.sql: no XP, and the dev tuner may force
 * a table of only your bots), and runs `VersusBotDriver` on timers with small random gaps: never in a render, never on
 * the shop's interaction path. They leave the room when you leave or the room closes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { activeSet, contentRevision } from '@game/content';
import { normalizeVersusOptions, type RunState, type VersusGroupSeat } from '@game/sim';
import { create } from 'zustand';
import { currentUserId } from '../identity';
import { VersusBotDriver, type BotStepResult, type VersusBotHooks } from './versusBotDriver';
import { makeBotMatchApi, type BotMatchApi } from './versusBotApi';
import { makeVersusRemote, type VersusRemote, type VersusRole } from './versusRemote';
import { heroSelectFrame, newPublisher, nextHeroSelectMessage, nextSpectatorMessage, type SpectatorPublisher } from './spectatorView';
import { SPECTATE_KEY_EVENT } from './spectate';
import { versusServerNow } from './versusStore';

/** Bot slots (one anonymous account each). */
export const VERSUS_BOT_SLOTS = [1, 2, 3] as const;
export type VersusBotSlot = (typeof VERSUS_BOT_SLOTS)[number];

const storageKeyOf = (slot: VersusBotSlot): string => (slot === 1 ? 'ascent.versus.testbot' : `ascent.versus.testbot.${slot}`);
const AVATARS = ['hero:warden', 'hero:indy', 'hero:keshi'];

/** The bots' room names: "Test Bot", "Test Bot 2", "Test Bot 3", or this browser's own list
 *  (`localStorage['ascent.versus.botnames'] = 'Name1,Name2,Name3'`, so a test account set can carry its own names). */
export function versusBotName(slot: VersusBotSlot): string {
  try {
    const list = (localStorage.getItem('ascent.versus.botnames') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (list[slot - 1]) return list[slot - 1]!.slice(0, 40);
  } catch { /* the default */ }
  return slot === 1 ? 'Test Bot' : `Test Bot ${slot}`;
}

export interface VersusBotInfo {
  slot: VersusBotSlot;
  roomId: string;
  userId: string | null;
  name: string;
  status: 'joining' | 'playing' | 'error';
  disconnected: boolean;
  error: string | null;
}

export interface VersusBotsState {
  bots: VersusBotInfo[];
  /** A bot is being seated (adds are one at a time: the room hands out seats in order). */
  busy: boolean;
  /** The last add that failed, for the room's notice. */
  error: string | null;
}

export const useVersusBots = create<VersusBotsState>(() => ({ bots: [], busy: false, error: null }));

interface BotHost {
  slot: VersusBotSlot;
  client: SupabaseClient;
  remote: VersusRemote;
  userId: string | null;
  api: BotMatchApi;
  driver: VersusBotDriver | null;
  timer: number | null;
  pub: { matchId: string; p: SpectatorPublisher; channel: { send: (e: string, p: unknown) => void; close: () => void } } | null;
  lastRun: RunState | null;
  keyWanted: boolean;
}

const hosts = new Map<VersusBotSlot, BotHost>();

function patchBot(slot: VersusBotSlot, patch: Partial<VersusBotInfo>): void {
  useVersusBots.setState((s) => ({ bots: s.bots.map((b) => (b.slot === slot ? { ...b, ...patch } : b)) }));
}

function hostFor(slot: VersusBotSlot): BotHost | null {
  const have = hosts.get(slot);
  if (have) return have;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: storageKeyOf(slot), detectSessionInUrl: false } });
  const remote = makeVersusRemote(() => client);
  // The adapter projects group matches from the bot's own seat (`userId`, set once signed in).
  const h: BotHost = { slot, client, remote, userId: null, api: null as unknown as BotMatchApi, driver: null, timer: null, pub: null, lastRun: null, keyWanted: false };
  h.api = makeBotMatchApi(remote, () => h.userId);
  hosts.set(slot, h);
  return h;
}

/** The bot's account: its persisted anonymous session, created once if this browser never had one. */
async function botUserId(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const fresh = await c.auth.signInAnonymously();
  if (fresh.error || !fresh.data.user) throw new Error(fresh.error?.message ?? 'bot_sign_in_failed');
  return fresh.data.user.id;
}

function schedule(h: BotHost, ms: number): void {
  if (h.timer != null) window.clearTimeout(h.timer);
  h.timer = window.setTimeout(() => { h.timer = null; void loop(h); }, ms);
}

async function loop(h: BotHost): Promise<void> {
  const d = h.driver;
  if (!d) return;
  const info = useVersusBots.getState().bots.find((b) => b.slot === h.slot);
  d.disconnected = !!info?.disconnected;
  const r: BotStepResult = await d.step();
  if (h.driver !== d) return;
  publishBotFrame(h);
  if (r === 'done') {
    // The match is over (or the room is gone): keep watching the continuous room for the next match.
    const room = info ? await h.remote.room(info.roomId).catch(() => null) : null;
    if (!room || !room.members.some((m) => m.userId === info?.userId)) { await stopVersusBotSlot(h.slot); return; }
    // A bot that went to the stands (it conceded or was knocked out) sits back down once the room reopens, so the
    // host can start the next test straight away.
    const me = room.members.find((m) => m.userId === info?.userId);
    if (room.status === 'open' && me?.role === 'spectator') {
      const mode = normalizeVersusOptions(room.options).mode;
      const roles = mode === 'duel' || mode === 'ranked_duos' ? ['p1', 'p2'] : ['p1', 'p2', 'p3', 'p4'];
      const free = roles.find((r) => !room.members.some((m) => m.role === r)) as VersusRole | undefined;
      if (free) await h.remote.takeSeat(room.id, free).catch(() => undefined);
    }
  }
  // Small random gaps so it feels alive; the driver itself ends its turn with time to spare. After failed steps it
  // backs off (R-NET-BACKOFF-01) instead of retrying every 500 ms forever.
  schedule(h, Math.max(d.retryDelayMs, r === 'acted' ? 250 + Math.random() * 550 : 500));
}

/**
 * The bot's SPECTATOR FRAMES (Versus phase 2): a spectator (or a Duos teammate's view) watching the bot's seat sees its
 * shop and fights like a person's. Same protocol as a player's client (`spectatorView.ts`): a keyframe at every shop
 * open, on a spectator's request and every 25 deltas, deltas otherwise, on the room channel; keyframes also persisted
 * for late joiners. Frames carry the bot's REAL seat (p1..p4 in a group or Duos match).
 */
function publishBotFrame(h: BotHost): void {
  const info = useVersusBots.getState().bots.find((b) => b.slot === h.slot);
  const run = h.driver?.run ?? null;
  const matchId = h.driver?.currentMatchId ?? null;
  const seat = h.driver?.realSeat ?? null;
  // Its Hero Select, before the run exists (R-SPECTATE-HEROSELECT-01), as a person's client sends it.
  const hs = h.driver?.heroSelectShown ?? null;
  const hero = hs ? heroSelectFrame({ offer: hs.offer, picked: hs.picked, reroll: null, canReroll: false, mode: 'versus' }) : null;
  if (!info || (!run && !hero) || !matchId || !seat) return;
  if (h.pub?.matchId !== matchId || h.pub.p.seat !== seat) {
    h.pub?.channel.close();
    // The room channel also wakes the bot's Duos pass sync on each pass row change (it polls only every 5 s otherwise).
    const ch = h.remote.subscribeRoom(info.roomId, matchId, (what) => { if (what === 'passes') h.driver?.wakePasses(); }, (event) => { if (event === SPECTATE_KEY_EVENT) h.keyWanted = true; });
    h.pub = { matchId, p: newPublisher(seat), channel: ch };
    h.lastRun = null;
    h.keyWanted = true;
  }
  if (!run) {
    const hm = hero ? nextHeroSelectMessage(h.pub.p, hero, h.keyWanted) : null;
    h.keyWanted = false;
    if (hm) { hm.m = matchId; h.pub.channel.send('spectate', hm); }
    return;
  }
  if (run === h.lastRun && !h.keyWanted) return;
  const shopOpened = h.lastRun?.phase !== 'recruit' && run.phase === 'recruit';
  h.lastRun = run;
  const msg = nextSpectatorMessage(h.pub.p, run, run.wave, shopOpened || h.keyWanted);
  h.keyWanted = false;
  if (!msg) return;
  msg.m = matchId;
  h.pub.channel.send('spectate', msg);
  if (msg.kind === 'key') void h.api.publishFrame(matchId, msg.seq, msg.round, msg).catch(() => undefined);
}

/** The lowest bot slot not in use. */
export function freeVersusBotSlot(): VersusBotSlot | null {
  const used = new Set(useVersusBots.getState().bots.map((b) => b.slot));
  return VERSUS_BOT_SLOTS.find((s) => !used.has(s)) ?? null;
}

let adding: Promise<void> = Promise.resolve();

/** Seat a bot in `roomId` (on `seat`, or the first open seat) and start it playing. One add at a time. */
export function startVersusBot(roomId: string, seat?: VersusRole): Promise<void> {
  const next = adding.then(() => addBot(roomId, seat));
  adding = next.catch(() => undefined);
  return next;
}

async function addBot(roomId: string, seat?: VersusRole): Promise<void> {
  const slot = freeVersusBotSlot();
  if (!slot) { useVersusBots.setState({ error: 'Three bots at most.' }); return; }
  const h = hostFor(slot);
  if (!h) { useVersusBots.setState({ error: 'No backend.' }); return; }
  const name = versusBotName(slot);
  useVersusBots.setState((s) => ({ busy: true, error: null, bots: [...s.bots, { slot, roomId, userId: null, name, status: 'joining', disconnected: false, error: null }] }));
  try {
    const userId = await botUserId(h.client);
    h.userId = userId;
    patchBot(slot, { userId });
    // Flag it as this host's test bot (no XP; the dev tuner may force a table of only your bots). A server without
    // 2026-10-25-versus-test-bots.sql refuses the call: the bot still plays, the forcing RPCs just stay closed.
    const host = currentUserId();
    if (host) await h.remote.testBotRegister(host, slot).catch(() => undefined);
    // A bot left behind by a reload still holds its old room (the server refuses a second one): leave that first.
    const stale = await h.remote.myRoomId(userId).catch(() => null);
    if (stale && stale !== roomId) await h.remote.leaveRoom(stale).catch(() => undefined);
    const room = await h.remote.joinRoom(roomId, 'player', { displayName: name, profile: { avatar: AVATARS[slot - 1] }, setId: activeSet().id, contentRevision: contentRevision() });
    const mine = room.members?.find((m) => m.userId === userId);
    if (seat && seat !== 'spectator' && mine && mine.role !== seat) await h.remote.takeSeat(roomId, seat).catch(() => undefined);
    h.driver = new VersusBotDriver(h.api, roomId, { userId, now: versusServerNow, seed: ((Date.now() + slot * 7919) & 0x7fffffff) | 1, watchMs: 25000, passPollMs: 5000 });
    h.driver.hooks = sharedHooks;
    patchBot(slot, { status: 'playing' });
    schedule(h, 200);
  } catch (e) {
    patchBot(slot, { status: 'error', error: (e as Error).message });
    useVersusBots.setState({ error: `${name}: ${(e as Error).message}` });
    // A failed bot frees its slot (its account stays for next time).
    await stopVersusBotSlot(slot);
  } finally {
    useVersusBots.setState({ busy: false });
  }
}

/** Take one bot out of its room (and stop it). Safe to call when it is not running. */
export async function stopVersusBotSlot(slot: VersusBotSlot): Promise<void> {
  const info = useVersusBots.getState().bots.find((b) => b.slot === slot);
  const h = hosts.get(slot);
  if (h) {
    h.driver = null;
    h.pub?.channel.close();
    h.pub = null;
    h.lastRun = null;
    if (h.timer != null) { window.clearTimeout(h.timer); h.timer = null; }
  }
  useVersusBots.setState((s) => ({ bots: s.bots.filter((b) => b.slot !== slot) }));
  if (h && info?.roomId && info.status !== 'error') await h.remote.leaveRoom(info.roomId).catch(() => undefined);
}

/** Take every bot out (you left the room). */
export async function stopVersusBot(): Promise<void> {
  await Promise.all(useVersusBots.getState().bots.map((b) => stopVersusBotSlot(b.slot)));
}

/** Dev: a bot concedes its running match (the concede path from the other side). Duos: its team goes out. */
export async function concedeVersusBot(slot: VersusBotSlot): Promise<void> {
  const h = hosts.get(slot);
  const id = h?.driver?.currentMatchId;
  if (h && id) await h.api.forfeit(id).catch(() => undefined);
}

/** Dev toggle: a bot "disconnects" (stops heartbeating and acting) to test pause / grace / auto. No slot = every bot. */
export function setVersusBotDisconnected(on: boolean, slot?: VersusBotSlot): void {
  useVersusBots.setState((s) => ({ bots: s.bots.map((b) => (slot == null || b.slot === slot ? { ...b, disconnected: on } : b)) }));
}

/** The dev tuner's hooks, shared by every bot (now and later). */
let sharedHooks: VersusBotHooks = {};
export function setVersusBotHooks(hooks: VersusBotHooks): void {
  sharedHooks = hooks;
  for (const h of hosts.values()) if (h.driver) h.driver.hooks = hooks;
}

/** The dev tuner's handle on a bot's driver. */
export const versusBotDriver = (slot: VersusBotSlot): VersusBotDriver | null => hosts.get(slot)?.driver ?? null;

/** The bot playing `seat` (its REAL seat in the current match, else its room seat). */
export function versusBotAtSeat(seat: VersusGroupSeat, roomSeats?: ReadonlyMap<string, VersusRole>): VersusBotSlot | null {
  for (const b of useVersusBots.getState().bots) {
    const d = hosts.get(b.slot)?.driver;
    const s = d?.realSeat ?? (b.userId ? roomSeats?.get(b.userId) : null) ?? null;
    if (s === seat) return b.slot;
  }
  return null;
}

// The bots' clients and loops are module singletons: a hot patch would start second bots beside the first. Reload.
if (import.meta.hot) {
  import.meta.hot.accept(() => { window.location.reload(); });
}
