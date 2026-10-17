/**
 * THE MENU POLLER: one timer for every "something is happening" count the menus show (the Live Games plaque's live
 * games, 2026-10-16; the Versus open rooms on Play and the Versus tile, 2026-10-17, R-VERSUS-OPEN-ROOMS-01).
 *
 *  - ONE interval for all of them (`POLL_MS`), running only while at least one indicator is mounted. Each tick asks
 *    every count that has a subscriber, in parallel. The first subscriber polls at once.
 *  - Never during a game: a tick does nothing (no request) unless a MENU is on screen (`menuOnScreen`): the title
 *    (main menu, Mode screen and the pages over it) or the Practice setup. Hero select and every match hide the title.
 *    A count may add its own gate (Versus: not while a Versus match is being played).
 *  - Never in a background tab (`document.visibilityState`), and never offline: no backend, offline or an error
 *    reads 0, so no indicator shows.
 */
import { useSyncExternalStore } from 'react';
import { remoteEnabled } from './remoteBoards';
import { useGame } from './store';

/** 45 s (the owner's ask: every 30 to 45 seconds). */
export const MENU_POLL_MS = 45_000;

/** A menu is on screen: the title (and the Mode screen / ladder pages it hosts) or the Practice setup. */
export function menuOnScreen(): boolean {
  const g = useGame.getState();
  return g.showTitle || g.practiceSetupOpen;
}

export interface MenuCount {
  /** The current value (0 when unknown, offline, gated or not deployed). */
  use(): number;
  get(): number;
  /** Ask now (tests, and the first subscriber). */
  poll(): Promise<void>;
}

interface Source {
  value: number;
  subs: Set<() => void>;
  fetch: () => Promise<number>;
  gate: () => boolean;
}

const sources: Source[] = [];
let timer: number | null = null;

function publish(s: Source, n: number): void {
  if (n === s.value) return;
  s.value = n;
  for (const f of s.subs) f();
}

async function pollOne(s: Source): Promise<void> {
  if (!menuOnScreen()) { publish(s, 0); return; } // a game is on screen: no request
  if (!remoteEnabled() || (typeof navigator !== 'undefined' && navigator.onLine === false) || !s.gate()) { publish(s, 0); return; }
  try { publish(s, Math.max(0, Math.floor(await s.fetch()) || 0)); } catch { publish(s, 0); }
}

function tick(): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  for (const s of sources) if (s.subs.size > 0) void pollOne(s);
}

const subscribed = (): number => sources.reduce((n, s) => n + s.subs.size, 0);

function subscribeTo(s: Source, f: () => void): () => void {
  s.subs.add(f);
  if (s.subs.size === 1) void pollOne(s);
  if (timer === null && typeof window !== 'undefined') timer = window.setInterval(tick, MENU_POLL_MS);
  return () => {
    s.subs.delete(f);
    if (subscribed() === 0 && timer !== null) { window.clearInterval(timer); timer = null; }
  };
}

/** Register a count on the shared poller. `gate` false = 0 without asking. */
export function menuCount(fetch: () => Promise<number>, gate: () => boolean = () => true): MenuCount {
  const s: Source = { value: 0, subs: new Set(), fetch, gate };
  sources.push(s);
  const sub = (f: () => void): (() => void) => subscribeTo(s, f);
  return {
    use: () => useSyncExternalStore(sub, () => s.value, () => 0),
    get: () => s.value,
    poll: () => pollOne(s),
  };
}

/** Tests: whether the shared interval is running. */
export const menuPollRunning = (): boolean => timer !== null;
