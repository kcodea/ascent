/**
 * VERSUS TEST BOT — the browser host (owner 2026-10-14; dev / test builds only, see `versusTestToolsEnabled`).
 *
 * A second Supabase client in this tab with its OWN anonymous session, persisted under its own storage key, so the
 * same bot guest account is reused on every test (one account per browser profile, ever). It joins the room as a
 * player through the normal RPCs and runs `VersusBotDriver` on timers with small random gaps: never in a render,
 * never on the shop's interaction path. It leaves the room when you leave or the room closes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { activeSet, contentRevision } from '@game/content';
import { create } from 'zustand';
import { VersusBotDriver, type BotStepResult } from './versusBotDriver';
import { makeVersusRemote } from './versusRemote';
import { newPublisher, nextSpectatorMessage, type SpectatorPublisher } from './spectatorView';
import { SPECTATE_KEY_EVENT } from './spectate';
import type { RunState } from '@game/sim';
import { versusServerNow } from './versusStore';

const BOT_STORAGE_KEY = 'ascent.versus.testbot';

export interface VersusBotState {
  roomId: string | null;
  userId: string | null;
  status: 'off' | 'joining' | 'playing' | 'error';
  disconnected: boolean;
  error: string | null;
}

export const useVersusBot = create<VersusBotState>(() => ({ roomId: null, userId: null, status: 'off', disconnected: false, error: null }));

let client: SupabaseClient | null = null;
function botClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: BOT_STORAGE_KEY, detectSessionInUrl: false } });
  return client;
}

/** The bot's account: its persisted anonymous session, created once if this browser never had one. */
async function botUserId(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const fresh = await c.auth.signInAnonymously();
  if (fresh.error || !fresh.data.user) throw new Error(fresh.error?.message ?? 'bot_sign_in_failed');
  return fresh.data.user.id;
}

const remote = makeVersusRemote(botClient);
let driver: VersusBotDriver | null = null;
let timer: number | null = null;

function schedule(ms: number): void {
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = null; void loop(); }, ms);
}

async function loop(): Promise<void> {
  if (!driver) return;
  driver.disconnected = useVersusBot.getState().disconnected;
  const r: BotStepResult = await driver.step();
  if (!driver) return;
  publishBotFrame();
  if (r === 'done') {
    // The match is over (or the room is gone): keep watching the continuous room for the next match.
    const room = await remote.room(useVersusBot.getState().roomId!).catch(() => null);
    if (!room) { await stopVersusBot(); return; }
  }
  // Small random gaps so it feels alive; the driver itself ends its turn with time to spare.
  schedule(r === 'acted' ? 250 + Math.random() * 550 : 500);
}

/**
 * The bot's SPECTATOR FRAMES (Versus phase 2): a spectator watching the bot's seat sees its shop and fights like a
 * person's. Same protocol as a player's client (`spectatorView.ts`): a keyframe at every shop open, on a spectator's
 * request and every 25 deltas, deltas otherwise, on the room channel; keyframes also persisted for late joiners.
 */
let pub: { matchId: string; p: SpectatorPublisher; channel: { send: (e: string, p: unknown) => void; close: () => void } } | null = null;
let lastRun: RunState | null = null;
let botKeyWanted = false;
function publishBotFrame(): void {
  const roomId = useVersusBot.getState().roomId;
  const run = driver?.run ?? null;
  const matchId = driver?.currentMatchId ?? null;
  const seat = driver?.currentSeat ?? null;
  if (!roomId || !run || !matchId || !seat) return;
  if (pub?.matchId !== matchId) {
    pub?.channel.close();
    const ch = remote.subscribeRoom(roomId, matchId, () => undefined, (event) => { if (event === SPECTATE_KEY_EVENT) botKeyWanted = true; });
    pub = { matchId, p: newPublisher(seat), channel: ch };
    lastRun = null;
    botKeyWanted = true;
  }
  if (run === lastRun && !botKeyWanted) return;
  const shopOpened = lastRun?.phase !== 'recruit' && run.phase === 'recruit';
  lastRun = run;
  const msg = nextSpectatorMessage(pub.p, run, run.wave, shopOpened || botKeyWanted);
  botKeyWanted = false;
  if (!msg) return;
  msg.m = matchId;
  pub.channel.send('spectate', msg);
  if (msg.kind === 'key') void remote.publishFrame(matchId, msg.seq, msg.round, msg).catch(() => undefined);
}

/** Seat the bot in `roomId` (an empty player seat) and start it playing. */
export async function startVersusBot(roomId: string): Promise<void> {
  if (driver) return;
  const c = botClient();
  if (!c) { useVersusBot.setState({ status: 'error', error: 'No backend.' }); return; }
  useVersusBot.setState({ status: 'joining', roomId, error: null });
  try {
    const userId = await botUserId(c);
    // A bot left behind by a reload still holds its old room (the server refuses a second one): leave that first.
    const stale = await remote.myRoomId(userId).catch(() => null);
    if (stale && stale !== roomId) await remote.leaveRoom(stale).catch(() => undefined);
    await remote.joinRoom(roomId, 'player', { displayName: 'Test Bot', profile: { avatar: 'hero:warden' }, setId: activeSet().id, contentRevision: contentRevision() });
    driver = new VersusBotDriver(remote, roomId, { userId, now: versusServerNow, seed: (Date.now() & 0x7fffffff) | 1, watchMs: 25000 });
    useVersusBot.setState({ status: 'playing', userId });
    schedule(200);
  } catch (e) {
    useVersusBot.setState({ status: 'error', error: (e as Error).message });
  }
}

/** Take the bot out of the room (and stop it). Safe to call when it is not running. */
export async function stopVersusBot(): Promise<void> {
  const roomId = useVersusBot.getState().roomId;
  driver = null;
  pub?.channel.close();
  pub = null;
  lastRun = null;
  if (timer != null) { window.clearTimeout(timer); timer = null; }
  useVersusBot.setState({ status: 'off', roomId: null, disconnected: false });
  if (roomId) await remote.leaveRoom(roomId).catch(() => undefined);
}

/** Dev: the bot concedes its running match (the concede path from the other side). */
export async function concedeVersusBot(): Promise<void> {
  const roomId = useVersusBot.getState().roomId;
  const room = roomId ? await remote.room(roomId).catch(() => null) : null;
  if (room?.current_match_id) await remote.forfeit(room.current_match_id).catch(() => undefined);
}

/** Dev toggle: the bot "disconnects" (stops heartbeating and acting) to test pause / unpause. */
export function setVersusBotDisconnected(on: boolean): void {
  useVersusBot.setState({ disconnected: on });
}

// The bot's client and loop are module singletons: a hot patch would start a second bot beside the first. Reload.
if (import.meta.hot) {
  import.meta.hot.accept(() => { window.location.reload(); });
}
