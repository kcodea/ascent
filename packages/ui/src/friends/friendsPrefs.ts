/**
 * "SHOW FRIENDS WHAT I'M DOING" (owner 2026-10-29, R-FRIENDS-ACTIVITY-01): the Settings switch for the granular
 * activity. On (the default): friends see the screen I am on and my game in detail. Off: friends see only Online, or
 * In a game with its mode. Saved on this device, like the other client settings.
 *
 * Also the one fact the replay viewer leaves for the presence beat: whose replay is playing (set by `startReplay`),
 * so the beat can say "Watching Ann's replay" for a friend's game without another network call.
 */
import { create } from 'zustand';

const KEY = 'ascent.friendsShowActivity';
/** "Filter bad words in messages" (R-DM-04): on unless turned off. */
const FILTER_KEY = 'ascent.dmFilter';

function load(key: string = KEY): boolean {
  try { return localStorage.getItem(key) !== 'false'; } catch { return true; }
}

export interface ReplayAuthor {
  /** The author's shown name. */
  name: string | null;
  /** The author's user id when the viewer knows it; null when it does not. */
  id: string | null;
  /** My own game (a Rewatch, or my own Career). */
  own: boolean;
}

export const useFriendsPrefs = create<{ showActivity: boolean; replayAuthor: ReplayAuthor | null; filterMessages: boolean }>(() => ({
  showActivity: load(), replayAuthor: null, filterMessages: load(FILTER_KEY),
}));

/** The direct message filter switch (masks swear words and slurs in messages I read; saved on this device). */
export function setFilterMessages(on: boolean): void {
  try { localStorage.setItem(FILTER_KEY, String(on)); } catch { /* private mode: this session only */ }
  useFriendsPrefs.setState({ filterMessages: on });
}

export function setShowActivity(on: boolean): void {
  try { localStorage.setItem(KEY, String(on)); } catch { /* private mode: this session only */ }
  useFriendsPrefs.setState({ showActivity: on });
}

/** The replay viewer: whose replay is starting (null when it ends). */
export function noteReplayAuthor(a: ReplayAuthor | null): void {
  useFriendsPrefs.setState({ replayAuthor: a });
}
