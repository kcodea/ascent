/**
 * A CHAT WINDOW'S PLACE ON THIS DEVICE, shared by every chat window (the direct messages' window, R-DM-CHAT-02, and the
 * lobby chat panel, R-LOBBY-CHAT-02). Where I last left a window, its size, and whether it is pinned, kept per device in
 * localStorage under that window's own key (every read and write guarded: a private window or blocked storage just
 * starts from the window's default). Geometry is in stage px (the coordinate space every fixed layer is laid out in).
 *
 * The maths is pure (`clampGeom`, `moveGeom`, `resizeGeom`, each with the window's own size limits) so it is pinned by
 * unit tests; a window only calls it on open, on a screen change and once per pointer move (no layout read anywhere).
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface ChatGeom { x: number; y: number; w: number; h: number }
/** A resize grip: the edges (n, e, s, w) and the corners (ne, se, sw, nw). */
export type ChatEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
export const CHAT_EDGES: readonly ChatEdge[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

/** A window's size limits and how far inside the screen's edges it keeps. */
export interface ChatLimits { minW: number; minH: number; maxW: number; maxH: number; margin: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The window inside the view: its size between the min and max (never bigger than the view), then wholly on screen. */
export function clampGeom(g: ChatGeom, vw: number, vh: number, l: ChatLimits): ChatGeom {
  const roomW = Math.max(0, vw - 2 * l.margin);
  const roomH = Math.max(0, vh - 2 * l.margin);
  const w = Math.round(Math.min(clamp(g.w, l.minW, l.maxW), roomW));
  const h = Math.round(Math.min(clamp(g.h, l.minH, l.maxH), roomH));
  return { x: Math.round(clamp(g.x, l.margin, vw - l.margin - w)), y: Math.round(clamp(g.y, l.margin, vh - l.margin - h)), w, h };
}

/** Moved by (dx, dy), wholly on screen. */
export function moveGeom(start: ChatGeom, dx: number, dy: number, vw: number, vh: number, l: ChatLimits): ChatGeom {
  return clampGeom({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh, l);
}

/**
 * Resized from one grip by (dx, dy): the grip's edges follow the pointer, the opposite edges stay put. The size keeps to
 * the min / max and the moving edges stop at the view's margin.
 */
export function resizeGeom(start: ChatGeom, edge: ChatEdge, dx: number, dy: number, vw: number, vh: number, l: ChatLimits): ChatGeom {
  const maxW = Math.min(l.maxW, vw - 2 * l.margin);
  const maxH = Math.min(l.maxH, vh - 2 * l.margin);
  let { x, y, w, h } = start;
  const right = x + w;
  const bottom = y + h;
  if (edge.includes('e')) w = clamp(Math.min(w + dx, vw - l.margin - x), l.minW, maxW);
  if (edge.includes('w')) { x = clamp(x + dx, Math.max(l.margin, right - maxW), right - l.minW); w = right - x; }
  if (edge.includes('s')) h = clamp(Math.min(h + dy, vh - l.margin - y), l.minH, maxH);
  if (edge.includes('n')) { y = clamp(y + dy, Math.max(l.margin, bottom - maxH), bottom - l.minH); h = bottom - y; }
  return clampGeom({ x, y, w, h }, vw, vh, l);
}

export interface ChatPrefs {
  /** Where I left it (null: the window's default place). */
  geom: ChatGeom | null;
  /** Pinned: stays up while I play. */
  pinned: boolean;
}

const isGeom = (g: unknown): g is ChatGeom => !!g && typeof g === 'object'
  && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((g as Record<string, unknown>)[k]));

/** One window's remembered place: its store and its writers. */
export interface ChatPrefsStore {
  use: UseBoundStore<StoreApi<ChatPrefs>>;
  setGeom: (geom: ChatGeom) => void;
  setPinned: (pinned: boolean) => void;
  /** Tests: forget this device's window (and re-read storage). */
  reset: () => void;
}

/** A window's remembered place on this device, under `key` (`pinnedByDefault`: the pin before I ever touch it). */
export function createChatPrefs(key: string, pinnedByDefault = false): ChatPrefsStore {
  const fallback = (): ChatPrefs => ({ geom: null, pinned: pinnedByDefault });
  const load = (): ChatPrefs => {
    try {
      const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
      if (!raw) return fallback();
      const v = JSON.parse(raw) as { geom?: unknown; pinned?: unknown };
      return { geom: isGeom(v.geom) ? v.geom : null, pinned: typeof v.pinned === 'boolean' ? v.pinned : pinnedByDefault };
    } catch {
      return fallback();
    }
  };
  const use = create<ChatPrefs>(() => load());
  const save = (): void => {
    const p = use.getState();
    try { localStorage.setItem(key, JSON.stringify({ geom: p.geom, pinned: p.pinned })); } catch { /* private window / blocked storage: this session only */ }
  };
  return {
    use,
    setGeom: (geom) => { use.setState({ geom }); save(); },
    setPinned: (pinned) => { use.setState({ pinned }); save(); },
    reset: () => { use.setState(load(), true); },
  };
}
