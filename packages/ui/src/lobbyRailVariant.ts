import { useSyncExternalStore } from 'react';
import { DOCK_DEFAULTS, type DockCfg } from './lobbyRailDockedLayout';

/**
 * The Docked rail's layout dials (owner 2026-10-31). Lobby Rail Tuner 2 writes them here in a DEV build; production never
 * does, so it reads DOCK_DEFAULTS (the owner's tuned values).
 */
let dockCfg: DockCfg = DOCK_DEFAULTS;
const dockListeners = new Set<() => void>();
export function setDockCfg(next: DockCfg): void {
  dockCfg = next;
  for (const fn of dockListeners) fn();
}
const subscribeDock = (fn: () => void): (() => void) => {
  dockListeners.add(fn);
  return () => { dockListeners.delete(fn); };
};
const getDock = (): DockCfg => dockCfg;
export function useDockCfg(): DockCfg {
  return useSyncExternalStore(subscribeDock, getDock, getDock);
}
