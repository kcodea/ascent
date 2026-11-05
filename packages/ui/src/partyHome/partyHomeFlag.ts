/**
 * THE PARTY HOME IS THE GAME'S UI (owner 2026-11-05: "fix this so it's on main and is THE production UI"; R-PH-PRODUCTION-01).
 * Born as a prototype on 2026-11-02 (owner: "im wondering if we should have our main screen be this instead"). A production
 * build is always on it, with no way off. A DEV client is on it too, unless the DEV menu's "Party home" action (or
 * `?partyhome=0`) turns it off to compare the old screens, remembered on this machine. Unit tests stay off unless they ask,
 * so the old screens' tests keep reading the old screens until they are removed.
 *
 * The SAMPLE PARTY (`ascent.partyHome.demo`) fills the screen with sample teammates and friends so the layout can be
 * reviewed without a live backend or a second account. Clearly labelled on screen; DEV only.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'ascent.partyHome';
const DEMO_KEY = 'ascent.partyHome.demo';
const ROOM_KEY = 'ascent.partyHome.room';
const listeners = new Set<() => void>();
let on: boolean | null = null;
let demo: boolean | null = null;
let sampleRoom: boolean | null = null;

const readKey = (k: string): boolean => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
/** A DEV client's switch: on unless it was turned off here. */
const readSwitch = (): boolean => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
const writeKey = (k: string, v: boolean): void => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* a convenience only */ } };

function fromUrl(): void {
  try {
    const q = new URLSearchParams(window.location.search);
    const p = q.get('partyhome');
    if (p === '1' || p === '0') writeKey(KEY, p === '1');
    const d = q.get('partydemo');
    if (d === '1' || d === '0') writeKey(DEMO_KEY, d === '1');
    const r = q.get('partyroom');
    if (r === '1' || r === '0') writeKey(ROOM_KEY, r === '1');
  } catch { /* no window (tests) */ }
}

/** Is the party home on? Always, in a production build. */
export function partyHomeOn(): boolean {
  if (!import.meta.env.DEV) return true;
  if (on === null) { fromUrl(); on = import.meta.env.VITEST ? readKey(KEY) : readSwitch(); }
  return on;
}
export function setPartyHome(v: boolean): void {
  on = v; writeKey(KEY, v);
  for (const l of listeners) l();
}
/** The sample party (DEV only, inside the prototype). */
export function partyDemoOn(): boolean {
  if (!import.meta.env.DEV) return false;
  if (demo === null) { fromUrl(); demo = readKey(DEMO_KEY); }
  return demo;
}
export function setPartyDemo(v: boolean): void {
  demo = v; writeKey(DEMO_KEY, v);
  for (const l of listeners) l();
}
/** The sample Versus room (DEV only, inside the prototype; sampleRoom.ts). `?partyroom=1` sets it too. */
export function partyRoomOn(): boolean {
  if (!import.meta.env.DEV) return false;
  if (sampleRoom === null) { fromUrl(); sampleRoom = readKey(ROOM_KEY); }
  return sampleRoom;
}
export function setPartyRoom(v: boolean): void {
  sampleRoom = v; writeKey(ROOM_KEY, v);
  for (const l of listeners) l();
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePartyHome = (): boolean => useSyncExternalStore(subscribe, partyHomeOn, partyHomeOn);
export const usePartyDemo = (): boolean => useSyncExternalStore(subscribe, partyDemoOn, partyDemoOn);
export const usePartyRoom = (): boolean => useSyncExternalStore(subscribe, partyRoomOn, partyRoomOn);
