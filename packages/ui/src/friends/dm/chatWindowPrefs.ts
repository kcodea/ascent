/**
 * THE CHAT WINDOW'S PLACE ON THIS DEVICE (owner 2026-10-29, R-DM-CHAT-02: "let me move the chat panel around, resize it,
 * and pin it so that it stays while i play if i want it up"). The direct messages' window on the shared chat window
 * maths and remembered prefs (`../../chat/chatGeom.ts`, which the lobby chat panel uses too): its size limits, its
 * centred default and its own storage key.
 */
import {
  clampGeom, createChatPrefs, moveGeom, resizeGeom, type ChatEdge, type ChatGeom, type ChatLimits,
} from '../../chat/chatGeom';

export { CHAT_EDGES, type ChatEdge, type ChatGeom } from '../../chat/chatGeom';

/** The smallest window that still shows a tab, a few messages and the composer; the largest worth having. */
export const CHAT_MIN_W = 420;
export const CHAT_MIN_H = 320;
export const CHAT_MAX_W = 1600;
export const CHAT_MAX_H = 1200;
/** Kept this far inside the window's edges. */
export const CHAT_MARGIN = 8;
export const DM_CHAT_LIMITS: ChatLimits = { minW: CHAT_MIN_W, minH: CHAT_MIN_H, maxW: CHAT_MAX_W, maxH: CHAT_MAX_H, margin: CHAT_MARGIN };

/** Today's centred window (R-DM-CHAT-01): up to 960 x 720, 32 / 48 px clear of the sides. */
export function defaultChatGeom(vw: number, vh: number): ChatGeom {
  const w = Math.round(Math.min(960, vw - 64));
  const h = Math.round(Math.min(720, vh - 96));
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

export const clampChatGeom = (g: ChatGeom, vw: number, vh: number): ChatGeom => clampGeom(g, vw, vh, DM_CHAT_LIMITS);
export const moveChatGeom = (start: ChatGeom, dx: number, dy: number, vw: number, vh: number): ChatGeom => moveGeom(start, dx, dy, vw, vh, DM_CHAT_LIMITS);
export const resizeChatGeom = (start: ChatGeom, edge: ChatEdge, dx: number, dy: number, vw: number, vh: number): ChatGeom =>
  resizeGeom(start, edge, dx, dy, vw, vh, DM_CHAT_LIMITS);

export const dmChatPrefs = createChatPrefs('ascent.chatWindow.v1');
export const useChatWindow = dmChatPrefs.use;
export const setChatGeom = dmChatPrefs.setGeom;
export const setChatPinned = dmChatPrefs.setPinned;
/** Tests: forget this device's window (and re-read storage). */
export const resetChatWindowForTests = dmChatPrefs.reset;
