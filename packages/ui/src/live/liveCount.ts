/**
 * HOW MANY RANKED GAMES ARE LIVE (owner 2026-10-16: "can we have the live games button glowing if there are any live
 * games?"). One shared poll for every Live Games plaque on screen: a head-only count of `lobby_live_games` (no rows
 * cross the wire, R-NET-01) every 45 s while at least one plaque is mounted and the tab is visible (the shared menu poller,
 * `menuPoll.ts`, which also carries the Versus open-rooms count). The plaque lives
 * only on menu screens (the side menu), so nothing polls during a match. Your own game is never counted: it is not live
 * while you are on a menu, and a finished game (phase `end`) is left out. No backend, an error or offline = 0 (no glow).
 */
import { useSyncExternalStore } from 'react';
import { menuCount } from '../menuPoll';
import { liveRemote } from './liveRemote';

// On the SHARED menu poller (menuPoll.ts, 2026-10-17): one timer for this and the Versus open-rooms count.
const live = menuCount(() => liveRemote.count());

/** The number of ranked games being played right now (0 when unknown). */
export function useLiveCount(): number {
  return live.use();
}

// Whether the window has focus: the glow's breathing pauses while it does not (no animation work in a background tab).
let focused = typeof document === 'undefined' ? true : document.hasFocus();
const focusSubs = new Set<() => void>();
function subscribeFocus(f: () => void): () => void {
  focusSubs.add(f);
  if (focusSubs.size === 1) { window.addEventListener('focus', onFocus); window.addEventListener('blur', onFocus); }
  return () => {
    focusSubs.delete(f);
    if (focusSubs.size === 0) { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onFocus); }
  };
}
function onFocus(): void {
  const next = document.hasFocus();
  if (next === focused) return;
  focused = next;
  for (const f of focusSubs) f();
}
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeFocus, () => focused, () => true);
}
