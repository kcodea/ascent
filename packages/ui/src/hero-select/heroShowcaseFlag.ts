/**
 * The Hero Select SHOWCASE layout switch. LIVE for players since 2026-11-17 (owner: "Yes, go live"): a production build
 * is always on it. Two things keep the older three-banner layout:
 *   - the TOUCH UI (a touch device on a scaled stage: phones and small tablets). The showcase has no phone layout yet.
 *   - a DEV client that turned it off with the DEV menu's "Hero Select: showcase layout" action (or `?heroshowcase=0`),
 *     remembered on this machine, to compare the two layouts. Production has no way off.
 * The whole-roster grid (more than six heroes offered) is HeroSelect's own rule, not this switch.
 */
import { useSyncExternalStore } from 'react';
import { onTouchUiChange, touchUi } from '../touchUi';

const KEY = 'ascent.heroShowcase';
const listeners = new Set<() => void>();
let on: boolean | null = null;

// On unless this machine stored an explicit "0".
const readKey = (): boolean => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
const writeKey = (v: boolean): void => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* a convenience only */ } };

function fromUrl(): void {
  try {
    const p = new URLSearchParams(window.location.search).get('heroshowcase');
    if (p === '1' || p === '0') writeKey(p === '1');
  } catch { /* no window (tests) */ }
}

/** The DEV choice alone (always on in a production build), before the touch UI rule. */
function chosen(): boolean {
  if (!import.meta.env.DEV) return true;
  if (on === null) { fromUrl(); on = readKey(); }
  return on;
}

/** Is the showcase layout on? Always in a production build, except under the touch UI. */
export function heroShowcaseOn(): boolean {
  return !touchUi().on && chosen();
}
export function setHeroShowcase(v: boolean): void {
  on = v; writeKey(v);
  for (const l of listeners) l();
}
// The touch UI can turn on or off while the screen is up (a rotation, a resize), so its changes notify too.
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  const offTouch = onTouchUiChange(l);
  return () => { listeners.delete(l); offTouch(); };
};
export const useHeroShowcase = (): boolean => useSyncExternalStore(subscribe, heroShowcaseOn, heroShowcaseOn);
