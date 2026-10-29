/**
 * THE DOCK'S HOME ON A MENU (owner 2026-10-29, R-FRIENDS-DOCK-03: "looks like friends moved over the menus and stuff -
 * can you fix that?"). A menu screen that has its own bottom-left corner space marks it with a `DockSlot`: the side
 * menu's foot (under Settings) and the title menu's column (under its last plaque). The Friends button then lives IN
 * that space (a portal into the slot, so it scales and moves with the layout that owns it and never sits on top of
 * anything), and the panel opens to the RIGHT of the slot's column (the side menu / the title menu), so it never hides
 * the menu's own buttons. With no slot on screen (hero select, every game, spectating, replays) the button keeps its
 * fixed corner (friendsDock.css).
 *
 * Several slots can be mounted at once (the title stays mounted under a ladder page): the LAST one mounted wins, which
 * is the page on top. Nothing here runs per frame: a slot registers once on mount and leaves on unmount.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { rectToStage, stageViewport } from '../../stage';

export interface DockSlotEntry {
  /** Where the button goes. */
  el: HTMLElement;
  /** The column the slot belongs to: the panel opens just to its right. */
  side: HTMLElement | null;
}

export const useDockSlots = create<{ slots: DockSlotEntry[] }>(() => ({ slots: [] }));

/** The slot the dock uses now (the last mounted), or null. */
export const currentDockSlot = (slots: readonly DockSlotEntry[]): DockSlotEntry | null => slots[slots.length - 1] ?? null;

/** Mark this spot as the dock's home. `side` names the column whose right edge the panel opens beside. */
export function DockSlot({ className, side }: { className: string; side: string }): JSX.Element {
  const mine = useRef<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      mine.current = el;
      // The column: a sibling of the slot (the title's plaque list) or an ancestor (the side menu).
      const entry = { el, side: el.parentElement?.querySelector<HTMLElement>(`:scope > ${side}`) ?? el.closest<HTMLElement>(side) };
      useDockSlots.setState((s) => ({ slots: [...s.slots.filter((x) => x.el !== el), entry] }));
    } else {
      const gone = mine.current;
      mine.current = null;
      useDockSlots.setState((s) => ({ slots: s.slots.filter((x) => x.el !== gone) }));
    }
  }, [side]);
  return <div className={`fdock-slot ${className}`} ref={ref} />;
}

export interface DockAnchor { left: number; bottom: number; maxH: number; maxW: number }

/**
 * Where the panel (or the message toast) goes beside the current slot, in stage px: its left edge just right of the
 * slot's column, its bottom on the slot's bottom. Measured once when `active` turns on and again on a window resize
 * (never per frame). Null with no slot (the fixed corner in friendsDock.css applies).
 */
export function useDockAnchor(active: boolean): DockAnchor | null {
  const slot = useDockSlots((s) => currentDockSlot(s.slots));
  const [anchor, setAnchor] = useState<DockAnchor | null>(null);
  useLayoutEffect(() => {
    if (!active || !slot) { setAnchor(null); return undefined; }
    const place = (): void => {
      const b = rectToStage(slot.el.getBoundingClientRect());
      const side = slot.side ? rectToStage(slot.side.getBoundingClientRect()) : b;
      const view = stageViewport();
      const left = Math.round(Math.max(side.right, b.right) + 14);
      const bottom = Math.round(Math.max(8, view.h - b.bottom));
      setAnchor({ left, bottom, maxH: Math.max(180, Math.round(view.h - bottom - 12)), maxW: Math.max(240, Math.round(view.w - left - 12)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [active, slot]);
  return anchor;
}
