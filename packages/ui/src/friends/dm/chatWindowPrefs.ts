/**
 * THE CHAT WINDOW'S PLACE ON THIS DEVICE (owner 2026-10-29, R-DM-CHAT-02: "let me move the chat panel around, resize it,
 * and pin it so that it stays while i play if i want it up"). Where I last left the window, its size, and whether it is
 * pinned, kept per device in localStorage (every read and write guarded: a private window or blocked storage just
 * starts from the centred default). Geometry is in stage px (the coordinate space every fixed layer is laid out in).
 *
 * The maths is pure (`defaultChatGeom`, `clampChatGeom`, `resizeChatGeom`) so it is pinned by unit tests; the window only
 * calls it on open, on a window resize and once per pointer move (no layout read anywhere).
 */
import { create } from 'zustand';

export interface ChatGeom { x: number; y: number; w: number; h: number }
/** A resize grip: the edges (n, e, s, w) and the corners (ne, se, sw, nw). */
export type ChatEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
export const CHAT_EDGES: readonly ChatEdge[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

/** The smallest window that still shows a tab, a few messages and the composer; the largest worth having. */
export const CHAT_MIN_W = 420;
export const CHAT_MIN_H = 320;
export const CHAT_MAX_W = 1600;
export const CHAT_MAX_H = 1200;
/** Kept this far inside the window's edges. */
export const CHAT_MARGIN = 8;
const KEY = 'ascent.chatWindow.v1';

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Today's centred window (R-DM-CHAT-01): up to 960 x 720, 32 / 48 px clear of the sides. */
export function defaultChatGeom(vw: number, vh: number): ChatGeom {
  const w = Math.round(Math.min(960, vw - 64));
  const h = Math.round(Math.min(720, vh - 96));
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

/** The window inside the view: its size between the min and max (never bigger than the view), then wholly on screen. */
export function clampChatGeom(g: ChatGeom, vw: number, vh: number): ChatGeom {
  const roomW = Math.max(0, vw - 2 * CHAT_MARGIN);
  const roomH = Math.max(0, vh - 2 * CHAT_MARGIN);
  const w = Math.round(Math.min(clamp(g.w, CHAT_MIN_W, CHAT_MAX_W), roomW));
  const h = Math.round(Math.min(clamp(g.h, CHAT_MIN_H, CHAT_MAX_H), roomH));
  return { x: Math.round(clamp(g.x, CHAT_MARGIN, vw - CHAT_MARGIN - w)), y: Math.round(clamp(g.y, CHAT_MARGIN, vh - CHAT_MARGIN - h)), w, h };
}

/** Moved by (dx, dy), wholly on screen. */
export function moveChatGeom(start: ChatGeom, dx: number, dy: number, vw: number, vh: number): ChatGeom {
  return clampChatGeom({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh);
}

/**
 * Resized from one grip by (dx, dy): the grip's edges follow the pointer, the opposite edges stay put. The size keeps to
 * the min / max and the moving edges stop at the view's margin.
 */
export function resizeChatGeom(start: ChatGeom, edge: ChatEdge, dx: number, dy: number, vw: number, vh: number): ChatGeom {
  const maxW = Math.min(CHAT_MAX_W, vw - 2 * CHAT_MARGIN);
  const maxH = Math.min(CHAT_MAX_H, vh - 2 * CHAT_MARGIN);
  let { x, y, w, h } = start;
  const right = x + w;
  const bottom = y + h;
  if (edge.includes('e')) w = clamp(Math.min(w + dx, vw - CHAT_MARGIN - x), CHAT_MIN_W, maxW);
  if (edge.includes('w')) { x = clamp(x + dx, Math.max(CHAT_MARGIN, right - maxW), right - CHAT_MIN_W); w = right - x; }
  if (edge.includes('s')) h = clamp(Math.min(h + dy, vh - CHAT_MARGIN - y), CHAT_MIN_H, maxH);
  if (edge.includes('n')) { y = clamp(y + dy, Math.max(CHAT_MARGIN, bottom - maxH), bottom - CHAT_MIN_H); h = bottom - y; }
  return clampChatGeom({ x, y, w, h }, vw, vh);
}

interface ChatPrefs {
  /** Where I left it (null: centred, the default). */
  geom: ChatGeom | null;
  /** Pinned: stays open while I play (no veil, no close on Escape or a press outside). */
  pinned: boolean;
}

const isGeom = (g: unknown): g is ChatGeom => !!g && typeof g === 'object'
  && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((g as Record<string, unknown>)[k]));

function load(): ChatPrefs {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return { geom: null, pinned: false };
    const v = JSON.parse(raw) as { geom?: unknown; pinned?: unknown };
    return { geom: isGeom(v.geom) ? v.geom : null, pinned: v.pinned === true };
  } catch {
    return { geom: null, pinned: false };
  }
}

function save(p: ChatPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify({ geom: p.geom, pinned: p.pinned })); } catch { /* private window / blocked storage: this session only */ }
}

export const useChatWindow = create<ChatPrefs>(() => load());

export function setChatGeom(geom: ChatGeom): void {
  useChatWindow.setState({ geom });
  save(useChatWindow.getState());
}

export function setChatPinned(pinned: boolean): void {
  useChatWindow.setState({ pinned });
  save(useChatWindow.getState());
}

/** Tests: forget this device's window (and re-read storage). */
export function resetChatWindowForTests(): void {
  useChatWindow.setState(load(), true);
}
