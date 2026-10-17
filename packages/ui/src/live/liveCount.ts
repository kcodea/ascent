/**
 * HOW MANY RANKED GAMES ARE LIVE (owner 2026-10-16: "can we have the live games button glowing if there are any live
 * games?"). One shared poll for every Live Games plaque on screen: a head-only count of `lobby_live_games` (no rows
 * cross the wire, R-NET-01) every 45 s while at least one plaque is mounted and the tab is visible. The plaque lives
 * only on menu screens (the side menu), so nothing polls during a match. Your own game is never counted: it is not live
 * while you are on a menu, and a finished game (phase `end`) is left out. No backend, an error or offline = 0 (no glow).
 */
import { useSyncExternalStore } from 'react';
import { remoteEnabled } from '../remoteBoards';
import { liveRemote } from './liveRemote';

const POLL_MS = 45_000;
let count = 0;
const subs = new Set<() => void>();
let timer: number | null = null;

function publish(n: number): void {
  if (n === count) return;
  count = n;
  for (const f of subs) f();
}
async function poll(): Promise<void> {
  if (!remoteEnabled() || (typeof navigator !== 'undefined' && navigator.onLine === false)) { publish(0); return; }
  try { publish(await liveRemote.count()); } catch { publish(0); }
}
function subscribe(f: () => void): () => void {
  subs.add(f);
  if (subs.size === 1 && timer === null && typeof window !== 'undefined') {
    void poll();
    timer = window.setInterval(() => { if (document.visibilityState === 'visible') void poll(); }, POLL_MS);
  }
  return () => {
    subs.delete(f);
    if (subs.size === 0 && timer !== null) { window.clearInterval(timer); timer = null; }
  };
}

/** The number of ranked games being played right now (0 when unknown). */
export function useLiveCount(): number {
  return useSyncExternalStore(subscribe, () => count, () => 0);
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
