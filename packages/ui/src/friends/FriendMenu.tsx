/**
 * THE FRIEND MENU (owner 2026-10-29: "There should be a right click -> spectate/invite to lobby/invite to duos/invite to
 * spectate features as well from this friends list, as well as the friends list in the main menu"; R-FRIENDS-MENU-01).
 *
 * Right-click (a mouse) or a long press (a finger) on a friend row, on the Friends page or in the in-game dock, opens a
 * short list in the game's own hover-panel look (`.atip`, the emote menu's panel): only the entries that make sense
 * right now (`friendMenuEntries`), a room invite mid-game shown disabled with its reason. ONE layer, mounted once in
 * Game; rows only call `openFriendMenu`. A press outside it (or Escape) closes it, and that same press is caught by the
 * menu's own transparent catcher, so it never also lands on the board (the dock's rule, R-FRIENDS-DOCK-01). A press
 * outside the dock as well closes the dock in the same motion.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { sfx } from '../sfx';
import { pointToStage, stageHost, stageViewport, toStage } from '../stage';
import { LONG_PRESS_MS, TAP_SLOP } from '../touchInput';
import { friendMenuContext, friendMenuEntries, runFriendMenu, type FriendMenuEntry } from './friendsGo';
import { handleOf } from './friendBits';
import type { Friend } from './friendsRemote';
import { closeDock, swallowNextClick, useFriendsDock } from './dock/dockStore';
import './friends.css';

interface MenuState { friend: Friend | null; x: number; y: number; entries: FriendMenuEntry[] }
export const useFriendMenu = create<MenuState>(() => ({ friend: null, x: 0, y: 0, entries: [] }));

/** Open the menu for a friend at a viewport point (client px). Its entries are read once, now. */
export function openFriendMenu(f: Friend, x: number, y: number): void {
  useFriendMenu.setState({ friend: f, x, y, entries: friendMenuEntries(f, friendMenuContext()) });
}
export function closeFriendMenu(): void {
  if (useFriendMenu.getState().friend) useFriendMenu.setState({ friend: null, entries: [] });
}

/** A long press eats the click its release makes (so the row's own click, a direct message, does not also fire). */
let eatClickUntil = 0;
export const friendMenuEatsClick = (): boolean => performance.now() < eatClickUntil;

/**
 * The row handlers: right-click, and a long press for a finger (iOS never sends contextmenu). One timer per press, only
 * while a finger is down; nothing runs otherwise.
 */
export function friendMenuHandlers(f: Friend): {
  onContextMenu: (e: ReactMouseEvent) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
} {
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pressTimer) return; // the long press below owns a finger's menu
      sfx.pulse();
      openFriendMenu(f, e.clientX, e.clientY);
    },
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch') return;
      cancelPress();
      const x = e.clientX; const y = e.clientY;
      press = { x, y };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        press = null;
        eatClickUntil = performance.now() + 600;
        sfx.pulse();
        openFriendMenu(f, x, y);
      }, LONG_PRESS_MS + 100);
    },
    onPointerMove: (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) cancelPress(); },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  };
}
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let press: { x: number; y: number } | null = null;
function cancelPress(): void { if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; } press = null; }

/** The menu layer (mounted once). */
export function FriendMenu(): JSX.Element | null {
  const { friend, x, y, entries } = useFriendMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // The harmful entry pressed once (it asks again before it acts); cleared whenever the menu opens or closes.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => { setArmed(null); }, [friend]);

  // Keep it on screen: one measure when it opens (never per frame). It lives in the scaled stage (stageHost), so the
  // press point (window px) and its size become stage px, clamped to the stage's visible box.
  const at = pointToStage(x, y);
  useLayoutEffect(() => {
    if (!friend || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const w = toStage(r.width); const h = toStage(r.height);
    const view = stageViewport();
    setPos({ left: Math.max(8, Math.min(at.x, view.w - w - 8)), top: Math.max(8, Math.min(at.y, view.h - h - 8)) });
  }, [friend, at.x, at.y]);

  // Escape closes it (capture, so the same press neither opens the Esc menu nor closes the dock underneath).
  useEffect(() => {
    if (!friend) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeFriendMenu();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [friend]);

  if (!friend || typeof document === 'undefined') return null;
  const onCatch = (e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    swallowNextClick();
    closeFriendMenu();
    // Outside the dock too: the dock closes in the same press (one motion, never two clicks).
    if (useFriendsDock.getState().phase === 'open') {
      const stack = document.querySelector('.fdock-stack');
      const btn = document.querySelector('.fdock-btn');
      const inside = [stack, btn].some((el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (!inside) closeDock();
    }
  };
  const name = handleOf(friend);
  return createPortal(
    <>
      <div className="frmenu-catch" onPointerDown={onCatch} onContextMenu={(e) => { e.preventDefault(); closeFriendMenu(); }} aria-hidden="true" />
      {/* The outer box is placed in stage px. */}
      <div ref={ref} className="frmenu-at"
        style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: `${at.x}px`, top: `${at.y}px`, visibility: 'hidden' }}>
      <div className="frmenu-z">
      <div className="atip frmenu" role="menu" aria-label={`${name} options`} onContextMenu={(e) => e.preventDefault()}>
        <b className="atip-title frmenu-title">{name}</b>
        {entries.length === 0 ? (
          <div className="frmenu-empty">Nothing to do right now.</div>
        ) : entries.map((it, i) => {
          const armedNow = armed === it.id;
          return (
            <Fragment key={it.id}>
              {/* Remove friend and Block sit apart at the bottom (R-FRIENDS-MENU-03). */}
              {it.confirm && !entries[i - 1]?.confirm && <div className="frmenu-sep" role="separator" />}
              <button type="button" role="menuitem" className={`frmenu-item pressable${it.confirm ? ' frmenu-harm' : ''}${armedNow ? ' frmenu-armed' : ''}`}
                disabled={!!it.disabled}
                aria-label={it.disabled ? `${it.label}. ${it.disabled}` : armedNow ? it.confirm : it.label}
                onBlur={() => { if (armedNow) setArmed(null); }}
                onClick={() => {
                  sfx.pulse();
                  // The first press only arms a harmful entry; the second acts (the Friends page's old ConfirmButton).
                  if (it.confirm && !armedNow) { setArmed(it.id); return; }
                  setArmed(null);
                  closeFriendMenu();
                  if (!it.confirm) closeDock();
                  void runFriendMenu(it.id, friend);
                }}>
                <span className="frmenu-label">{armedNow ? it.confirm : it.label}</span>
                {it.disabled && <span className="frmenu-why">{it.disabled}</span>}
              </button>
            </Fragment>
          );
        })}
      </div>
      </div>
      </div>
    </>,
    stageHost(),
  );
}
