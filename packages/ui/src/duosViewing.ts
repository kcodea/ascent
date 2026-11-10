/**
 * VERSUS DUOS: "I AM WATCHING MY TEAMMATE", for the three controls that dim while I do (the End Turn gem, the Refresh
 * pill and the action tray: they are my teammate's on that screen, visibly inert; R-DUOS-VIEW-01).
 *
 * It used to be a class on `<body>` (`body.duos-viewing .etbwrap`, ...). A class change on the body makes the browser walk
 * the whole page for the elements that rule could reach, on the swap's own task (measured 0.24 ms a change on a round-3
 * shop, the Duos audit of 2026-11-09). The three controls now carry the class themselves, from this one flag: a change
 * re-renders three small components and nothing else is restyled.
 *
 * Set by the swap (versus/teammateView.tsx, inside its synchronous update, so the controls dim in the same frame as the
 * teammate's board arrives) and by the Scene Builder's placeholder teammate (sbDuos.ts).
 */
import { useSyncExternalStore } from 'react';

let viewing = false;
const subs = new Set<() => void>();

export function setDuosViewing(on: boolean): void {
  if (viewing === on) return;
  viewing = on;
  for (const f of [...subs]) f();
}
export const duosViewing = (): boolean => viewing;

const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The class a dimmed control wears while I watch my teammate (`' duos-viewing'`, or nothing). */
export function useDuosViewingClass(): string {
  return useSyncExternalStore(subscribe, duosViewing, () => false) ? ' duos-viewing' : '';
}
