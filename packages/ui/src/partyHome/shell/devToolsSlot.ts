/**
 * THE DEV TOOLS SLOT (owner 2026-11-06: "move [Scene] to the bottom left corner with the friends and settings button menu, same
 * with the dev tuner cog, in its own section titled Dev Tools"). The app shell's bottom-left dock (PhTopNav) offers one empty
 * element; the global Dev tuner button (DevMenu.tsx) renders into it while it exists, and back in its usual corner otherwise.
 * DEV builds only: the dock draws the slot only under `import.meta.env.DEV`.
 */
import { useSyncExternalStore } from 'react';

let slot: HTMLElement | null = null;
const subs = new Set<() => void>();
const emit = (): void => { for (const f of subs) f(); };

/** The dock hands its slot over on mount (and takes it back on unmount, only if it is still the one registered). */
export function setDevToolsSlot(el: HTMLElement): void { if (slot !== el) { slot = el; emit(); } }
export function clearDevToolsSlot(el: HTMLElement): void { if (slot === el) { slot = null; emit(); } }

export function useDevToolsSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => slot,
    () => null,
  );
}
