/**
 * The Hero Select SHOWCASE layout switch. DEV only and OFF by default everywhere: a production build always reads it as
 * off, and a DEV client is on it only when the DEV menu's "Hero Select: showcase layout" action (or `?heroshowcase=1`)
 * turns it on, remembered on this machine.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'ascent.heroShowcase';
const listeners = new Set<() => void>();
let on: boolean | null = null;

const readKey = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const writeKey = (v: boolean): void => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* a convenience only */ } };

function fromUrl(): void {
  try {
    const p = new URLSearchParams(window.location.search).get('heroshowcase');
    if (p === '1' || p === '0') writeKey(p === '1');
  } catch { /* no window (tests) */ }
}

/** Is the showcase layout on? Never, in a production build. */
export function heroShowcaseOn(): boolean {
  if (!import.meta.env.DEV) return false;
  if (on === null) { fromUrl(); on = readKey(); }
  return on;
}
export function setHeroShowcase(v: boolean): void {
  on = v; writeKey(v);
  for (const l of listeners) l();
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useHeroShowcase = (): boolean => useSyncExternalStore(subscribe, heroShowcaseOn, heroShowcaseOn);
