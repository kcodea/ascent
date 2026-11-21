/**
 * THE "ACHIEVEMENT POP-UPS" SWITCH (Settings > Game, owner 2026-11-20, R-ACH-TOAST-01). On by default. Off = no
 * achievement toast at all, mid-game or when a game settles (the achievements themselves are still earned and listed in
 * the Career and the Collection as before). Saved on this device.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'ascent.achievementPopups';
const listeners = new Set<() => void>();
let on: boolean | null = null;

export function achievementPopupsOn(): boolean {
  if (on === null) { try { on = localStorage.getItem(KEY) !== 'off'; } catch { on = true; } }
  return on;
}
export function setAchievementPopupsOn(v: boolean): void {
  on = v;
  try { if (v) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* lasts this session */ }
  for (const l of listeners) l();
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useAchievementPopupsOn(): boolean {
  return useSyncExternalStore(subscribe, achievementPopupsOn, achievementPopupsOn);
}
/** Listen for the switch changing (the toast queue empties when it goes off). */
export const onAchievementPopupsChange = subscribe;
/** Tests only. */
export function resetAchievementPopupsForTests(): void { on = null; }
