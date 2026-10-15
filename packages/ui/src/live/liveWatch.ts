/**
 * LIVE RANKED LOBBY GAMES, the WATCHER's session (owner-approved 2026-10-15). Watching a game reuses the Versus watch
 * screen whole (`versus/spectate.ts`): the real lobby shop and combat from the player's side, view only (the replay
 * viewer's render-only mode), the action animations, the live cursor, right-click inspect. This file joins the game
 * (`lobby_live_watch`, cap 20), opens its broadcast channel, feeds the frames in, keeps the watcher seat warm, and
 * follows the listing row: when the game ends the player's placement shows (the end screen's numeral) and the viewer
 * goes back to the Live games list. Leave goes back at once.
 */
import { create } from 'zustand';
import { useGame } from '../store';
import { installSpectateIo, liveSync, receiveSpectate, receiveSpectatorCursor, SPECTATE_KEY_EVENT, useSpectate } from '../versus/spectate';
import { SPECTATE_CURSOR_EVENT } from '../versus/spectateTap';
import { liveRemote, LiveError, type LiveGameRow, type LiveRemote } from './liveRemote';

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
/** How long the final placement shows before the list. */
export const LIVE_END_HOLD_MS = 6000;

let remote: LiveRemote = liveRemote;
export function setLiveWatchRemoteForTests(r: LiveRemote): void { remote = r; }

let session: { gameId: string; channel: { send: (e: string, p: unknown) => void; close: () => void } | null; poll: number | null; endTimer: number | null } | null = null;

const ERRORS: Record<string, string> = {
  spectators_full: 'That game has 20 watchers already.',
  no_game: 'That game has just ended.',
  own_game: 'That is your own game.',
  not_deployed: 'Live games are not available yet.',
};
const errorText = (e: unknown): string => ERRORS[(e as LiveError).code] ?? 'Could not watch that game. Try again.';

/** Watch a live game. Resolves once joined (the screen opens on the player's first frame). */
export async function watchLiveGame(gameId: string): Promise<boolean> {
  leaveLiveGame(false);
  useLiveWatch.setState({ error: null, ended: null });
  let row: LiveGameRow;
  try {
    row = await remote.watch(gameId);
  } catch (e) {
    useLiveWatch.setState({ error: errorText(e) });
    return false;
  }
  const s: NonNullable<typeof session> = { gameId, channel: null, poll: null, endTimer: null };
  session = s;
  installSpectateIo({
    latestFrames: async (id) => { const f = await remote.latestFrame(id); return f ? [{ seat: 'p1' as const, frame: f }] : []; },
    requestKey: () => s.channel?.send(SPECTATE_KEY_EVENT, {}),
    loadRounds: () => undefined,
    lobbyFor: () => undefined,
    // Leave and the end return to the Live games list.
    returnTo: () => ({ titleView: 'menu', showLiveGames: true }),
  });
  s.channel = remote.channel(gameId, (event, payload) => {
    if (session !== s) return;
    if (event === 'spectate') { receiveSpectate(payload); if (useSpectate.getState().active) useLiveWatch.setState({ joining: false }); }
    else if (event === SPECTATE_CURSOR_EVENT) receiveSpectatorCursor(payload);
  });
  useSpectate.setState({ name: row.display_name });
  useLiveWatch.setState({ game: row, joining: true });
  liveSync(gameId);
  s.channel.send(SPECTATE_KEY_EVENT, {}); // a keyframe now, if the player is already publishing
  s.poll = window.setInterval(() => void follow(s), LIVE_WATCH_POLL_MS);
  return true;
}

/** Keep the watcher seat warm and follow the game's row: its end, or its disappearance. */
async function follow(s: NonNullable<typeof session>): Promise<void> {
  if (session !== s) return;
  if (useSpectate.getState().active) useLiveWatch.setState({ joining: false });
  try {
    const row = await remote.watch(s.gameId);
    if (session !== s) return;
    useLiveWatch.setState({ game: row });
    if (row.phase === 'end' && !useLiveWatch.getState().ended) gameEnded(s, row);
  } catch (e) {
    if (session !== s) return;
    // Gone (abandoned, or silent past a minute): back to the list with a word why.
    if ((e as LiveError).code === 'no_game') { leaveLiveGame(true); useLiveWatch.setState({ error: 'That game has ended.' }); }
  }
}

function gameEnded(s: NonNullable<typeof session>, row: LiveGameRow): void {
  useLiveWatch.setState({ ended: row });
  s.endTimer = window.setTimeout(() => { if (session === s) leaveLiveGame(true); }, LIVE_END_HOLD_MS);
}

/** Leave the game (Leave, the Esc menu, the end). `back`: return to the Live games list. */
export function leaveLiveGame(back = true): void {
  const s = session;
  if (!s) return;
  session = null;
  if (s.poll != null) window.clearInterval(s.poll);
  if (s.endTimer != null) window.clearTimeout(s.endTimer);
  s.channel?.close();
  void remote.unwatch(s.gameId).catch(() => undefined);
  liveSync(null); // stops the watch screen (restoring through `returnTo`)
  installSpectateIo(null);
  useSpectate.setState({ name: null });
  useLiveWatch.setState({ game: null, ended: null, joining: false });
  if (back && !useGame.getState().showLiveGames) useGame.setState({ showTitle: true, titleView: 'menu', showLiveGames: true });
}

/** Watching a live ranked lobby game right now (the bar, the Esc menu's Leave). */
export const isWatchingLive = (): boolean => session !== null;
