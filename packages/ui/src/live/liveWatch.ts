/**
 * LIVE RANKED LOBBY GAMES, the WATCHER's session (owner-approved 2026-10-15). Watching a game reuses the Versus watch
 * screen whole (`versus/spectate.ts`): the real lobby shop and combat from the player's side, view only (the replay
 * viewer's render-only mode), the action animations, the live cursor, right-click inspect. This file joins the game
 * (`lobby_live_watch`, cap 20), opens its broadcast channel, feeds the frames in, keeps the watcher seat warm, and
 * follows the listing row. Leave goes back to the Live games list at once. When the game ENDS (owner 2026-10-24,
 * R-SPECTATE-END-01) the game's end gate closes over the watch screen and opens on the Play menu with the player's
 * placement and the XP for watching it (`spectatorEnd.ts`); the watch record that XP is judged on beats from here.
 *
 * TWO HOSTS (2026-10-29, R-LIVE-CF-01): a game whose row says `live_host: cf:<rev>` is watched on the Worker instead
 * (`liveCf.ts`): one socket carries the join (cap 20), the keyframe, the stream, the row as it changes, the stands and
 * the end; nothing is polled, and the watch record is written by the game's object (R-LIVE-CF-XP-01), so this client
 * sends no beat. The host is the game's, for its whole life: a flip of the switch never moves a watch.
 */
import { create } from 'zustand';
import { playerRunsFrom, resetLobbyDrivers, runKeyOf, setWatchedSeatRuns, type RunLobby } from '@game/sim';
import { useGame } from '../store';
import { installSpectateIo, liveSync, receiveSpectate, receiveSpectatorCursor, refreshSpectatorSeats, SPECTATE_KEY_EVENT, useSpectate } from '../versus/spectate';
import { SPECTATE_BYE_EVENT, SPECTATE_CURSOR_EVENT } from '../versus/spectateTap';
import { myWatcherIdentity, othersInStands, setWatchers } from '../versus/watchers';
import { supabaseClient } from '../remoteBoards';
import { currentUserId } from '../identity';
import { installSpectatorEmotes, onUnknownSpectatorEmote, receiveSpectatorEmote, SPECTATOR_EMOTE_EVENT, uninstallSpectatorEmotes } from '../versus/spectatorEmotes';
import { receiveWatchedEmote, resetWatchedEmotes, VERSUS_EMOTE_EVENT } from '../versus/versusEmotes';
import { liveRemote, LiveError, type LiveGameRow, type LiveRemote } from './liveRemote';
import { endWatchedGame, startSpectatorBeat, stopSpectatorBeat } from './spectatorEnd';
import { cfErrorCode, openCfWatcher, type CfWatcher, type LiveRow, type LiveWatcher } from './liveCf';
import { lobbyLiveWatchUrl } from '../versus/versusRemote';
import { receivePingEvent, setPingSession } from '../pings/pingRuntime';

export interface LiveWatchState {
  /** The game being watched (its listing row), or null. */
  game: LiveGameRow | null;
  /** The game ended: its final row (the placement), shown briefly before the list. */
  ended: LiveGameRow | null;
  /** Waiting for the player's first frame. */
  joining: boolean;
  error: string | null;
}
export const useLiveWatch = create<LiveWatchState>(() => ({ game: null, ended: null, joining: false, error: null }));

/** Watcher heartbeat / listing poll. */
export const LIVE_WATCH_POLL_MS = 5000;

let remote: LiveRemote = liveRemote;
export function setLiveWatchRemoteForTests(r: LiveRemote): void { remote = r; }

let session: {
  gameId: string; channel: { send: (e: string, p: unknown) => void; close: () => void } | null; poll: number | null;
  /** Stops waiting for the game's first lobby (`watchSeatRecordings`). */
  seatsUnsub: (() => void) | null;
  /** The watched game's seats, so leaving evicts the drivers built from its recordings. */
  seats: RunLobby['seats'] | null;
  /** When the other watchers were last read (`readFellows`), and how many polls since. */
  fellowsAt: number;
  polls: number;
  /** LIVE GAMES ON CLOUDFLARE: the game's socket (null on the Supabase path). */
  cf: CfWatcher | null;
} | null = null;

/** The auth session's user id (the id `lobby_live_watch_as` wrote my row under), or null. Never throws. */
async function mySessionId(): Promise<string | null> {
  try { return (await supabaseClient()?.auth.getSession())?.data.session?.user.id ?? null; } catch { return null; }
}

/** Re-read the other watchers every few polls (they join and leave), and at most this often on an unknown emote. */
const FELLOWS_EVERY_POLLS = 3;
const FELLOWS_ASK_MS = 3000;

/**
 * THE OTHER PEOPLE IN THE STANDS (R-SPECTATE-EMOTE-01): my top-left row lists them, and a fellow spectator's emote pops
 * from their chip. Read from the watcher rows (`lobby_live_watchers`, which a current watcher of the game may read once
 * `2026-10-16-lobby-live-fellow-watchers.sql` is applied); without it the read is refused and the row shows only me
 * (the player still sees every spectator's emote). Never from a broadcast.
 */
async function readFellows(s: NonNullable<typeof session>): Promise<void> {
  s.fellowsAt = Date.now();
  try {
    const rows = await remote.watchers(s.gameId);
    if (session !== s) return;
    // ME, by every id that is me here: the identity AND the auth session the watch call ran under (the row is keyed
    // by that one), so my own row is never drawn again among the others (R-SPECTATE-HUD-02).
    const authId = await mySessionId();
    if (session !== s) return;
    const all = (rows ?? []).map((r) => ({ id: r.user_id, name: r.display_name ?? '', profile: r.profile ?? null }));
    setWatchers(othersInStands(all, [currentUserId(), authId]).slice(0, 20));
  } catch {
    // An older server (only the player may read its watchers): the row shows only me.
  }
}

/** The watched game's recorded-seat run keys this client cannot drive from its own pool. Pure; exported for tests. */
export function missingSeatRunKeys(lobby: Pick<RunLobby, 'seats' | 'setId'>): string[] {
  const keys = lobby.seats.filter((s) => s.kind === 'snapshot' && s.runKey).map((s) => s.runKey!);
  if (keys.length === 0) return [];
  const held = new Set(playerRunsFrom(undefined, undefined, lobby.setId).map((r) => r.key));
  return keys.filter((k) => !held.has(k));
}

/**
 * THE WATCHED GAME'S RECORDED SEATS, 1:1 (owner 2026-10-16: "spectators should get as close to 1:1 experience as a
 * player", R-SPECTATE-SEATS-01). The first lobby that arrives names every seat for the whole game. Any recorded seat
 * whose run this client's pool lacks is fetched ONCE, by seed, and handed to the sim (`setWatchedSeatRuns`, kept apart
 * from the watcher's own pool), then the screen re-reads the seats (`refreshSpectatorSeats`). One read per watch, off
 * the render path; nothing is sent on the game's channel and the player's client does nothing new. A failed read
 * leaves the seats as they were (their recorded reads).
 */
function watchSeatRecordings(s: NonNullable<typeof session>): void {
  // Only the WATCHED game's screen counts (`spectatorRunOf` names it `spectate:<game>:p1`), never the run the watcher
  // left on screen before the first frame arrived.
  const tryLobby = (run: { runId?: string; lobby?: RunLobby }): boolean => {
    const lobby = run.lobby;
    if (!lobby || session !== s || !run.runId?.startsWith(`spectate:${s.gameId}:`)) return false;
    s.seats = lobby.seats;
    const missing = missingSeatRunKeys(lobby);
    if (missing.length === 0) return true;
    const want = new Set(missing);
    const seeds = [...new Set(missing.map((k) => Number(k.slice(k.lastIndexOf('|') + 1))).filter(Number.isFinite))];
    void remote.seatRecordings?.(seeds).then((boards) => {
      if (session !== s) return;
      setWatchedSeatRuns(boards.filter((b) => want.has(runKeyOf(b))));
      resetLobbyDrivers(lobby.seats); // drop the stand-ins already built for those seats
      refreshSpectatorSeats();
    }).catch(() => undefined);
    return true;
  };
  if (tryLobby(useGame.getState().run)) return;
  s.seatsUnsub = useGame.subscribe((st) => {
    if (!tryLobby(st.run)) return;
    s.seatsUnsub?.();
    s.seatsUnsub = null;
  });
}

const ERRORS: Record<string, string> = {
  spectators_full: 'That game has 20 watchers already.',
  no_game: 'That game has just ended.',
  game_ended: 'That game has just ended.',
  own_game: 'That is your own game.',
  not_deployed: 'Live games are not available yet.',
};
const errorText = (e: unknown): string => ERRORS[(e as LiveError).code] ?? 'Could not watch that game. Try again.';

/**
 * Watch a live game. Resolves once joined (the screen opens on the player's first frame). `hint`: the game's listing row
 * when the caller has it (Live Games), so a Cloudflare game goes straight to its Worker. Without one (a friend's Watch),
 * the Supabase join is tried first and a Cloudflare game answers `other_host`, whose row then names its Worker.
 */
export async function watchLiveGame(gameId: string, hint?: Pick<LiveGameRow, 'live_host'> | null): Promise<boolean> {
  leaveLiveGame(false);
  useLiveWatch.setState({ error: null, ended: null });
  if (hint?.live_host) return watchOnCf(gameId, hint.live_host);
  let row: LiveGameRow;
  try {
    // With my name and portrait, for the player's "Spectating" indicator (R-SPECTATE-WATCHERS-01).
    const me = myWatcherIdentity();
    row = await remote.watchAs(gameId, me.name, me.profile);
  } catch (e) {
    if ((e as LiveError).code === 'other_host') {
      const r = await remote.game(gameId).catch(() => null);
      if (r?.live_host) return watchOnCf(gameId, r.live_host);
    }
    useLiveWatch.setState({ error: errorText(e) });
    return false;
  }
  resetWatchedEmotes();
  const s: NonNullable<typeof session> = { gameId, channel: null, poll: null, seatsUnsub: null, seats: null, fellowsAt: 0, polls: 0, cf: null };
  session = s;
  installSpectateIo({
    latestFrames: async (id) => { const f = await remote.latestFrame(id); return f ? [{ seat: 'p1' as const, frame: f }] : []; },
    requestKey: () => s.channel?.send(SPECTATE_KEY_EVENT, {}),
    loadRounds: () => undefined,
    lobbyFor: () => undefined,
    // Leave and the end return to the Live games list.
    returnTo: () => ({ titleView: 'menu', showLiveGames: true }),
  });
  // A fellow spectator's emote pops from their chip in my top-left row (R-SPECTATE-EMOTE-01); the PLAYER's own emote,
  // forwarded by their publisher, rises from their hero portrait, as on their screen (R-SPECTATE-EMOTE-02).
  s.channel = remote.channel(gameId, (event, payload) => onGameBroadcast(s, event, payload));
  // My own emotes go out on this channel, as me; a sender I do not know yet re-reads the stands (throttled).
  const me = currentUserId();
  if (me) installSpectatorEmotes(me, s.channel.send);
  installWatchPings(s, gameId);
  onUnknownSpectatorEmote(() => { if (Date.now() - s.fellowsAt > FELLOWS_ASK_MS) void readFellows(s); });
  useSpectate.setState({ name: row.display_name });
  useLiveWatch.setState({ game: row, joining: true });
  liveSync(gameId);
  s.channel.send(SPECTATE_KEY_EVENT, {}); // a keyframe now, if the player is already publishing
  s.poll = window.setInterval(() => void follow(s), LIVE_WATCH_POLL_MS);
  // The watch record for the XP of watching it to the end (R-PROG-SPECTATE-XP-01).
  startSpectatorBeat('lobby', gameId);
  watchSeatRecordings(s);
  void readFellows(s);
  return true;
}

/** The game's channel handler (both hosts): the player's stream, cursor and emotes, and the other spectators' emotes. */
function onGameBroadcast(s: NonNullable<typeof session>, event: string, payload: unknown): void {
  if (session !== s) return;
  // LIVE PINGS (R-PING-02/03): the player's own pings show on the watched screen; a mentor ping reaches only the
  // player (the receiver drops it here); who is mentoring shows on the stands.
  if (receivePingEvent(event, payload)) return;
  if (event === 'spectate') { receiveSpectate(payload); if (useSpectate.getState().active) useLiveWatch.setState({ joining: false }); }
  else if (event === SPECTATE_CURSOR_EVENT) receiveSpectatorCursor(payload);
  else if (event === SPECTATOR_EMOTE_EVENT) receiveSpectatorEmote(payload);
  else if (event === VERSUS_EMOTE_EVENT && useSpectate.getState().active) receiveWatchedEmote(payload, useSpectate.getState().seat);
}

/** As a spectator I hold no seat; if the player makes me their mentor I may ping their screen (R-PING-03). Sent on
 *  whichever host carries the game (the Cloudflare object stamps and routes it; Supabase relies on the receiver). */
function installWatchPings(s: NonNullable<typeof session>, gameId: string): void {
  setPingSession('livewatch', { send: (e, p) => { if (session === s) s.channel?.send(e, p); }, seat: () => null, mode: () => 'lobby', gameKey: `lobby:${gameId}` });
}

let watchUrlFor: (liveHost: string) => string = lobbyLiveWatchUrl;
/** Tests: where a Cloudflare game is reached. */
export function setLiveWatchUrlForTests(fn: ((liveHost: string) => string) | null): void { watchUrlFor = fn ?? lobbyLiveWatchUrl; }

/** The other people in the stands, pushed by the game's object (never me: by my identity, and by the account the
 *  object knows me as, R-SPECTATE-HUD-02). */
function cfFellows(list: LiveWatcher[], me: string | null): void {
  const all = list.map((w) => ({ id: w.user_id, name: w.display_name ?? '', profile: w.profile ?? null }));
  setWatchers(othersInStands(all, [currentUserId(), me]).slice(0, 20));
}

/**
 * WATCH ON CLOUDFLARE (R-LIVE-CF-01): the same watch screen, fed by the game's socket. The join, the row, the keyframe
 * and the stands come with the hello; the end comes pushed (after the object wrote the watch record for it).
 */
async function watchOnCf(gameId: string, liveHost: string): Promise<boolean> {
  const s: NonNullable<typeof session> = { gameId, channel: null, poll: null, seatsUnsub: null, seats: null, fellowsAt: 0, polls: 0, cf: null };
  let key: unknown = null;
  let myId: string | null = null;
  let opened: Awaited<ReturnType<typeof openCfWatcher>>;
  try {
    opened = await openCfWatcher(watchUrlFor(liveHost), gameId, myWatcherIdentity(), {
      onBroadcast: (event, payload) => onGameBroadcast(s, event, payload),
      onRow: (row) => { if (session === s) useLiveWatch.setState({ game: row as LiveGameRow }); },
      onWatchers: (list) => { if (session === s) cfFellows(list, myId); },
      onEnd: (end) => {
        if (session !== s || useLiveWatch.getState().ended) return;
        if (end.abandoned) { leaveLiveGame(true); useLiveWatch.setState({ error: 'That game has ended.' }); return; }
        const last = (end.row ?? useLiveWatch.getState().game) as LiveGameRow | null;
        if (last) gameEnded(s, { ...last, phase: 'end', placement: end.placement });
      },
      onDead: () => {
        // The socket is gone for good (the game's object let everyone go, or refused me): back to the list.
        if (session !== s || useLiveWatch.getState().ended) return;
        leaveLiveGame(true);
        useLiveWatch.setState({ error: 'That game has ended.' });
      },
    });
  } catch (e) {
    const code = cfErrorCode(e);
    useLiveWatch.setState({ error: code === 'unreachable' ? 'Could not reach that game. Try again.' : errorText({ code }) });
    return false;
  }
  key = opened.hello.key;
  myId = opened.hello.userId ?? null;
  const row = opened.hello.row as (LiveRow & LiveGameRow) | null;
  if (!row) { opened.watcher.close(); useLiveWatch.setState({ error: errorText({ code: 'no_game' }) }); return false; }
  resetWatchedEmotes();
  s.cf = opened.watcher;
  s.channel = { send: (e, p) => opened.watcher.send(e, p), close: () => opened.watcher.close() };
  session = s;
  installSpectateIo({
    // The object's cached keyframe (the hello's), then whatever the player sends on a key request.
    latestFrames: async () => (key ? [{ seat: 'p1' as const, frame: key }] : []),
    requestKey: () => s.channel?.send(SPECTATE_KEY_EVENT, {}),
    loadRounds: () => undefined,
    lobbyFor: () => undefined,
    returnTo: () => ({ titleView: 'menu', showLiveGames: true }),
  });
  const me = currentUserId();
  if (me) installSpectatorEmotes(me, s.channel.send);
  installWatchPings(s, gameId);
  useSpectate.setState({ name: row.display_name });
  useLiveWatch.setState({ game: row, joining: true });
  cfFellows(opened.hello.watchers ?? [], myId);
  liveSync(gameId);
  s.channel.send(SPECTATE_KEY_EVENT, {}); // a keyframe now, if the player is already publishing
  // The watch record is written by the game's object (R-LIVE-CF-XP-01): no beat from here.
  startSpectatorBeat('lobby', gameId, { server: true });
  watchSeatRecordings(s);
  return true;
}

/** Keep the watcher seat warm and follow the game's row: its end, or its disappearance. */
/** Failed follows in a row (R-NET-BACKOFF-01): after a failure the next ones wait 10, 20, 40 s (capped at 60 s). */
let followFails = 0;
let followNextAt = 0;
async function follow(s: NonNullable<typeof session>): Promise<void> {
  if (session !== s) return;
  if (Date.now() < followNextAt) return;
  if (useSpectate.getState().active) useLiveWatch.setState({ joining: false });
  if (++s.polls % FELLOWS_EVERY_POLLS === 0) void readFellows(s);
  try {
    const me = myWatcherIdentity();
    const row = await remote.watchAs(s.gameId, me.name, me.profile);
    if (session !== s) return;
    followFails = 0;
    followNextAt = 0;
    useLiveWatch.setState({ game: row });
    if (row.phase === 'end' && !useLiveWatch.getState().ended) gameEnded(s, row);
  } catch (e) {
    if (session !== s) return;
    followFails++;
    followNextAt = Date.now() + Math.min(60_000, LIVE_WATCH_POLL_MS * 2 ** followFails);
    // Gone (abandoned, or silent past a minute): back to the list with a word why.
    if ((e as LiveError).code === 'no_game') { leaveLiveGame(true); useLiveWatch.setState({ error: 'That game has ended.' }); }
  }
}

/**
 * THE GAME ENDED for its player (owner 2026-10-24): the end gate shuts over the watch screen and opens on the Play menu
 * with their placement and the XP for watching it (R-SPECTATE-END-01). Behind the doors the session is left for the menu.
 */
function gameEnded(s: NonNullable<typeof session>, row: LiveGameRow): void {
  useLiveWatch.setState({ ended: row });
  if (s.poll != null) { window.clearInterval(s.poll); s.poll = null; }
  void endWatchedGame({
    kind: 'lobby', target: s.gameId, name: row.display_name, placement: row.placement ?? null,
    leave: () => {
      if (session === s) leaveLiveGame(false);
      useGame.setState({ showTitle: true, titleView: 'modes', showLiveGames: false });
    },
  });
}

/** Leave the game (Leave, the Esc menu, the end). `back`: return to the Live games list. */
export function leaveLiveGame(back = true): void {
  const s = session;
  if (!s) return;
  session = null;
  if (s.poll != null) window.clearInterval(s.poll);
  stopSpectatorBeat();
  s.seatsUnsub?.();
  setWatchedSeatRuns(null);
  if (s.seats) resetLobbyDrivers(s.seats);
  // Tell the player at once (their indicator drops me on its next heartbeat, asked for now instead of in 15 s). On
  // Cloudflare the closing socket tells the game's object, which tells the player.
  if (!s.cf) s.channel?.send(SPECTATE_BYE_EVENT, {});
  s.channel?.close();
  setPingSession('livewatch', null);
  uninstallSpectatorEmotes();
  setWatchers([]);
  if (!s.cf) void remote.unwatch(s.gameId).catch(() => undefined);
  liveSync(null); // stops the watch screen (restoring through `returnTo`)
  installSpectateIo(null);
  useSpectate.setState({ name: null });
  useLiveWatch.setState({ game: null, ended: null, joining: false });
  if (back && !useGame.getState().showLiveGames) useGame.setState({ showTitle: true, titleView: 'menu', showLiveGames: true });
}

/** Watching a live ranked lobby game right now (the bar, the Esc menu's Leave). */
export const isWatchingLive = (): boolean => session !== null;
