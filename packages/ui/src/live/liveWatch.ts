/**
 * LIVE LOBBY GAMES, the WATCHER's session (owner-approved 2026-10-15). Watching a game reuses the Versus watch screen
 * whole (`versus/spectate.ts`): the real lobby shop and combat from the player's side, view only (the replay viewer's
 * render-only mode), the action animations, the live cursor, right-click inspect. Leave goes back to the Live games list
 * at once. When the game ENDS (owner 2026-10-24, R-SPECTATE-END-01) the game's end gate closes over the watch screen and
 * opens on the Play menu with the player's placement and the XP for watching it (`spectatorEnd.ts`).
 *
 * CLOUDFLARE ONLY (R-LIVE-CF-01, R-LIVE-CF-ONLY-01; owner 2026-10-30: "Remove fallback for spectating. I want us to make
 * cloudflare work as our source for live information and action like spectating"): a game is watched on the Worker that
 * hosts it (`liveCf.ts`). One socket carries the join (cap 20), the keyframe, the stream, the row as it changes, the
 * stands and the end; nothing is polled, and the watch record is written by the game's object (R-LIVE-CF-XP-01), so
 * this client sends no beat and calls no Supabase function. There is no Supabase watch path any more.
 */
import { create } from 'zustand';
import { contentRevision } from '@game/content';
import { playerRunsFrom, resetLobbyDrivers, runKeyOf, setWatchedSeatRuns, type RunLobby } from '@game/sim';
import { useGame } from '../store';
import { installSpectateIo, liveSync, receiveSpectate, receiveSpectatorCursor, refreshSpectatorSeats, SPECTATE_KEY_EVENT, useSpectate } from '../versus/spectate';
import { SPECTATE_CURSOR_EVENT } from '../versus/spectateTap';
import { myWatcherIdentity, othersInStands, setWatchers } from '../versus/watchers';
import { currentUserId } from '../identity';
import { installSpectatorEmotes, receiveSpectatorEmote, SPECTATOR_EMOTE_EVENT, uninstallSpectatorEmotes } from '../versus/spectatorEmotes';
import { receiveWatchedEmote, resetWatchedEmotes, VERSUS_EMOTE_EVENT } from '../versus/versusEmotes';
import { liveRemote, type LiveGameRow, type LiveRemote } from './liveRemote';
import { endWatchedGame, startSpectatorBeat, stopSpectatorBeat } from './spectatorEnd';
import { cfErrorCode, diagnoseCfOpen, openCfWatcher, type CfOpenDiagnosis, type CfWatcher, type LiveRow, type LiveWatcher } from './liveCf';
import { lobbyLiveWatchUrl } from '../versus/versusRemote';
import { receivePingEvent, setPingSession } from '../pings/pingRuntime';
import { receiveLobbyChatEvent, setLobbyChatSession } from '../lobbyChat/lobbyChatStore';

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

/** The listing read (a friend's Watch looks up which Worker hosts the game) and the seat recordings (boards). */
let remote: Pick<LiveRemote, 'game' | 'seatRecordings'> = liveRemote;
export function setLiveWatchRemoteForTests(r: Pick<LiveRemote, 'game' | 'seatRecordings'> | null): void { remote = r ?? liveRemote; }

let session: {
  gameId: string; channel: { send: (e: string, p: unknown) => void; close: () => void } | null;
  /** Stops waiting for the game's first lobby (`watchSeatRecordings`). */
  seatsUnsub: (() => void) | null;
  /** The watched game's seats, so leaving evicts the drivers built from its recordings. */
  seats: RunLobby['seats'] | null;
  /** The game's socket. */
  cf: CfWatcher | null;
} | null = null;

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
 * the render path; nothing is sent on the game's socket and the player's client does nothing new. A failed read leaves
 * the seats as they were (their recorded reads).
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
  // A game listed by an older build that published it elsewhere (R-LIVE-CF-ONLY-01).
  old_host: 'That game is on an older version. It cannot be watched.',
  // R-LIVE-WATCH-REACH-01: a genuine failure says why (never one catch-all "could not reach").
  version_mismatch: 'This game is on a different version. Reload to update.',
  not_signed_in: 'Sign in again to watch. Reload the game and try again.',
  signed_out: 'Sign in again to watch. Reload the game and try again.',
  offline: 'You are offline. Check your connection and try again.',
  server_down: 'The game server did not answer. Try again in a moment.',
  unreachable: 'Could not reach that game. Try again.',
};
const errorText = (e: { code?: string }): string => ERRORS[e.code ?? ''] ?? 'Could not watch that game. Try again.';

/**
 * Where a game is watched: the Worker its listing row names (`live_host: cf:<rev>`). `hint`: the row, when the caller has
 * it (Live Games). Without one (a friend's Watch, an accepted spectate invite) the row is read; a game with no row yet
 * (its first listing write is still on its way) is looked for on this build's own Worker. A row with no `live_host` was
 * listed by an older build on the retired Supabase path: it cannot be watched. Null = not watchable (the error is set).
 */
async function liveHostOf(gameId: string, hint?: Pick<LiveGameRow, 'live_host'> | null): Promise<string | null> {
  if (hint?.live_host) return hint.live_host;
  const row = hint ?? (await remote.game(gameId).catch(() => null));
  if (row && !row.live_host) { useLiveWatch.setState({ error: errorText({ code: 'old_host' }) }); return null; }
  return row?.live_host ?? `cf:${contentRevision()}`;
}

/**
 * Watch a live game. Resolves once joined (the screen opens on the player's first frame).
 */
export async function watchLiveGame(gameId: string, hint?: Pick<LiveGameRow, 'live_host'> | null): Promise<boolean> {
  leaveLiveGame(false);
  useLiveWatch.setState({ error: null, ended: null });
  const seq = watchSeq;
  const host = await liveHostOf(gameId, hint);
  if (seq !== watchSeq || !host) return false; // a newer Watch (or a Leave) took over meanwhile
  return watchOnCf(gameId, host);
}

/** The game's socket handler: the player's stream, cursor and emotes, and the other spectators' emotes. */
function onGameBroadcast(s: NonNullable<typeof session>, event: string, payload: unknown): void {
  if (session !== s) return;
  // LIVE PINGS (R-PING-02/03): the player's own pings show on the watched screen; a mentor ping reaches only the
  // player (the receiver drops it here); who is mentoring shows on the stands.
  if (receivePingEvent(event, payload)) return;
  // LOBBY CHAT (R-LOBBY-CHAT-01): the player's and the stands' messages.
  if (receiveLobbyChatEvent(event, payload)) return;
  if (event === 'spectate') { receiveSpectate(payload); if (useSpectate.getState().active) useLiveWatch.setState({ joining: false }); }
  else if (event === SPECTATE_CURSOR_EVENT) receiveSpectatorCursor(payload);
  else if (event === SPECTATOR_EMOTE_EVENT) receiveSpectatorEmote(payload);
  else if (event === VERSUS_EMOTE_EVENT && useSpectate.getState().active) receiveWatchedEmote(payload, useSpectate.getState().seat);
}

/** As a spectator I hold no seat; if the player makes me their mentor I may ping their screen (R-PING-03). Sent on the
 *  game's socket (the object stamps and routes it). */
function installWatchPings(s: NonNullable<typeof session>, gameId: string): void {
  setPingSession('livewatch', { send: (e, p) => { if (session === s) s.channel?.send(e, p); }, seat: () => null, mode: () => 'lobby', gameKey: `lobby:${gameId}` });
}

let watchUrlFor: (liveHost: string) => string = lobbyLiveWatchUrl;
/** Tests: where a Cloudflare game is reached. */
export function setLiveWatchUrlForTests(fn: ((liveHost: string) => string) | null): void { watchUrlFor = fn ?? lobbyLiveWatchUrl; }
let diagnose: (baseUrl: string) => Promise<CfOpenDiagnosis> = diagnoseCfOpen;
/** Tests: why an open failed. */
export function setLiveWatchDiagnoseForTests(fn: ((baseUrl: string) => Promise<CfOpenDiagnosis>) | null): void { diagnose = fn ?? diagnoseCfOpen; }
/** A Watch whose socket times out tries once more before it gives up (R-LIVE-WATCH-REACH-01). */
export const CF_WATCH_ATTEMPTS = 2;
/** Bumped by every Watch and Leave: a slow open that a newer one overtook is dropped. */
let watchSeq = 0;

/** The other people in the stands, pushed by the game's object (never me: by my identity, and by the account the
 *  object knows me as, R-SPECTATE-HUD-02). */
function cfFellows(list: LiveWatcher[], me: string | null): void {
  const all = list.map((w) => ({ id: w.user_id, name: w.display_name ?? '', profile: w.profile ?? null }));
  setWatchers(othersInStands(all, [currentUserId(), me]).slice(0, 20));
}

/**
 * WATCH ON CLOUDFLARE (R-LIVE-CF-01): the watch screen, fed by the game's socket. The join, the row, the keyframe and the
 * stands come with the hello; the end comes pushed (after the object wrote the watch record for it).
 */
async function watchOnCf(gameId: string, liveHost: string): Promise<boolean> {
  const s: NonNullable<typeof session> = { gameId, channel: null, seatsUnsub: null, seats: null, cf: null };
  let key: unknown = null;
  let myId: string | null = null;
  const seq = ++watchSeq;
  const url = watchUrlFor(liveHost);
  const open = (): ReturnType<typeof openCfWatcher> => openCfWatcher(url, gameId, myWatcherIdentity(), {
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
  let opened: Awaited<ReturnType<typeof openCfWatcher>> | null = null;
  let code = 'unreachable';
  // A timeout may be a blip: one more try. A refusal (full, ended, own game, version) is final at once.
  for (let attempt = 1; attempt <= CF_WATCH_ATTEMPTS && !opened; attempt++) {
    try { opened = await open(); } catch (e) {
      code = cfErrorCode(e);
      if (code !== 'unreachable') break;
    }
  }
  if (seq !== watchSeq) { opened?.watcher.close(); return false; } // a newer Watch (or a Leave) took over meanwhile
  if (!opened) {
    // Still unreachable: find out why (offline, the server down, a refused sign-in) and say so.
    if (code === 'unreachable') code = await diagnose(url).catch(() => 'unreachable' as const);
    if (seq !== watchSeq) return false;
    useLiveWatch.setState({ error: errorText({ code }) });
    return false;
  }
  const got = opened;
  key = got.hello.key;
  myId = got.hello.userId ?? null;
  const row = got.hello.row as (LiveRow & LiveGameRow) | null;
  if (!row) { got.watcher.close(); useLiveWatch.setState({ error: errorText({ code: 'no_game' }) }); return false; }
  resetWatchedEmotes();
  s.cf = got.watcher;
  s.channel = { send: (e, p) => got.watcher.send(e, p), close: () => got.watcher.close() };
  session = s;
  installSpectateIo({
    // The object's cached keyframe (the hello's), then whatever the player sends on a key request.
    latestFrames: async () => (key ? [{ seat: 'p1' as const, frame: key }] : []),
    requestKey: () => s.channel?.send(SPECTATE_KEY_EVENT, {}),
    loadRounds: () => undefined,
    lobbyFor: () => undefined,
    // Leave and the end return to the Live games list.
    returnTo: () => ({ titleView: 'menu', showLiveGames: true }),
  });
  // A fellow spectator's emote pops from their chip in my top-left row (R-SPECTATE-EMOTE-01); the PLAYER's own emote,
  // forwarded by their publisher, rises from their hero portrait, as on their screen (R-SPECTATE-EMOTE-02). The stands
  // come pushed with every change, so an unknown sender needs no re-read.
  const me = currentUserId();
  if (me) installSpectatorEmotes(me, s.channel.send);
  installWatchPings(s, gameId);
  setLobbyChatSession('livewatch', { send: (e, p) => got.watcher.send(e, p), gameKey: `lobby:${gameId}`, me: myId ?? currentUserId() });
  useSpectate.setState({ name: row.display_name });
  useLiveWatch.setState({ game: row, joining: true });
  cfFellows(got.hello.watchers ?? [], myId);
  liveSync(gameId);
  s.channel.send(SPECTATE_KEY_EVENT, {}); // a keyframe now, if the player is already publishing
  // The watch record is written by the game's object (R-LIVE-CF-XP-01): no beat from here.
  startSpectatorBeat('lobby', gameId, { server: true });
  watchSeatRecordings(s);
  return true;
}

/**
 * THE GAME ENDED for its player (owner 2026-10-24): the end gate shuts over the watch screen and opens on the Play menu
 * with their placement and the XP for watching it (R-SPECTATE-END-01). Behind the doors the session is left for the menu.
 */
function gameEnded(s: NonNullable<typeof session>, row: LiveGameRow): void {
  useLiveWatch.setState({ ended: row });
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
  watchSeq++;
  const s = session;
  if (!s) return;
  session = null;
  stopSpectatorBeat();
  s.seatsUnsub?.();
  setWatchedSeatRuns(null);
  if (s.seats) resetLobbyDrivers(s.seats);
  // The closing socket tells the game's object, which tells the player at once.
  s.channel?.close();
  setPingSession('livewatch', null);
  setLobbyChatSession('livewatch', null);
  uninstallSpectatorEmotes();
  setWatchers([]);
  liveSync(null); // stops the watch screen (restoring through `returnTo`)
  installSpectateIo(null);
  useSpectate.setState({ name: null });
  useLiveWatch.setState({ game: null, ended: null, joining: false });
  if (back && !useGame.getState().showLiveGames) useGame.setState({ showTitle: true, titleView: 'menu', showLiveGames: true });
}

/** Watching a live lobby game right now (the bar, the Esc menu's Leave). */
export const isWatchingLive = (): boolean => session !== null;
