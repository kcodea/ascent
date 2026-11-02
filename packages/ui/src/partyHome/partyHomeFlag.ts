/**
 * THE PARTY HOME, A PROTOTYPE (owner 2026-11-02: "im wondering if we should have our main screen be this instead, with big
 * cards with your chosen portrait art like in valorant front and center, with the tabs for career etc at the top, then
 * allowing the player to invite from there"). DEV only, OFF by default: the DEV menu's "Party home (prototype)" action
 * flips it, and it is remembered on this machine (a convenience, localStorage). Production never reads it: `partyHomeOn`
 * is false whenever `import.meta.env.DEV` is, so the shipped title screen is unchanged.
 *
 * `?partyhome=1` / `?partyhome=0` on a DEV URL sets it too (the headless screenshots use it).
 * The SAMPLE PARTY (`ascent.partyHome.demo`) fills the screen with sample teammates and friends so the layout can be
 * reviewed without a live backend or a second account. Clearly labelled on screen; DEV only.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'ascent.partyHome';
const DEMO_KEY = 'ascent.partyHome.demo';
const listeners = new Set<() => void>();
let on: boolean | null = null;
let demo: boolean | null = null;

const readKey = (k: string): boolean => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const writeKey = (k: string, v: boolean): void => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* a convenience only */ } };

function fromUrl(): void {
  try {
    const q = new URLSearchParams(window.location.search);
    const p = q.get('partyhome');
    if (p === '1' || p === '0') writeKey(KEY, p === '1');
    const d = q.get('partydemo');
    if (d === '1' || d === '0') writeKey(DEMO_KEY, d === '1');
  } catch { /* no window (tests) */ }
}

/** Is the party home prototype on? Always false outside a DEV build. */
export function partyHomeOn(): boolean {
  if (!import.meta.env.DEV) return false;
  if (on === null) { fromUrl(); on = readKey(KEY); }
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
/** The party home's backdrop (owner 2026-11-02: "the backdrop art can maybe still be the old main menu art with the citadel,
 *  but blur it out? idk could try both"): the Mode screen's hall, or the title's citadel, pre-blurred and darkened. */
export type PartyBackdrop = 'citadel' | 'hall';
const BD_KEY = 'ascent.partyHome.backdrop';
let backdrop: PartyBackdrop | null = null;
export function partyBackdrop(): PartyBackdrop {
  if (backdrop === null) { try { backdrop = localStorage.getItem(BD_KEY) === 'citadel' ? 'citadel' : 'hall'; } catch { backdrop = 'hall'; } }
  return backdrop;
}
export function setPartyBackdrop(v: PartyBackdrop): void {
  backdrop = v; try { localStorage.setItem(BD_KEY, v); } catch { /* a convenience only */ }
  for (const l of listeners) l();
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePartyHome = (): boolean => useSyncExternalStore(subscribe, partyHomeOn, partyHomeOn);
export const usePartyBackdrop = (): PartyBackdrop => useSyncExternalStore(subscribe, partyBackdrop, partyBackdrop);
export const usePartyDemo = (): boolean => useSyncExternalStore(subscribe, partyDemoOn, partyDemoOn);
