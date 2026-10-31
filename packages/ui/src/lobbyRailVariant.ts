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

/**
 * WHAT A DOCKED SLICE'S LABEL SAYS (owner 2026-10-31: "add an option for hero name in the lobby rail as text instead of
 * player name"): the player's name, the hero's name, or nothing (the default since the owner's "Full art" pick). Every mode's Docked rail reads it, the
 * fallen's slices too; the hover card keeps both names. Lobby Rail Tuner 2 ("Slice label") writes it in a DEV build;
 * production reads the default.
 */
export const SLICE_LABELS = ['player', 'hero', 'none'] as const;
export type SliceLabel = (typeof SLICE_LABELS)[number];
// The shipped default (owner pick 2026-10-31, the "Full art" look): no label; the hover card carries the names.
let sliceLabel: SliceLabel = 'none';
const labelListeners = new Set<() => void>();
export function setSliceLabel(next: SliceLabel): void {
  if (next === sliceLabel) return;
  sliceLabel = next;
  for (const fn of labelListeners) fn();
}
export const getSliceLabel = (): SliceLabel => sliceLabel;
const subscribeLabel = (fn: () => void): (() => void) => {
  labelListeners.add(fn);
  return () => { labelListeners.delete(fn); };
};
export function useSliceLabel(): SliceLabel {
  return useSyncExternalStore(subscribeLabel, getSliceLabel, getSliceLabel);
}
