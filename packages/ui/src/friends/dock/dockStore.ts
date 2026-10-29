/**
 * THE FRIENDS DOCK's state (owner 2026-10-29, R-FRIENDS-DOCK-01 / -02): open or closed, which tab the panel shows, and
 * whose direct message panel is up. One store for the whole app: the dock lives on every screen, so moving between
 * screens keeps all of it. Kept apart from the component so the messaging work can open a conversation from anywhere (a new
 * message, a notice) with `openDm(userId)`, and so the context menu can close everything in one call.
 *
 * `phase` drives the one-shot open / close motion: 'open' mounts the panels (they animate in), 'closing' keeps them
 * mounted for the collapse, 'closed' renders only the button. Nothing here ticks.
 */
import { create } from 'zustand';

export type DockPhase = 'closed' | 'open' | 'closing';
/** The panel's tabs: the friends list (with Add by handle), requests in and out, blocked players. */
export type DockTab = 'friends' | 'requests' | 'blocked';

export interface DockState {
  phase: DockPhase;
  /** The friend whose conversation the chat window shows (null: the chat window is closed). R-DM-CHAT-01. */
  dmWith: string | null;
  /** The chat window's tabs: every conversation opened this session, in the order they were opened. Friends with
   *  unread messages join them on screen (ChatWindow) without being added here. */
  chatTabs: string[];
  tab: DockTab;
}

export const useFriendsDock = create<DockState>(() => ({ phase: 'closed', dmWith: null, chatTabs: [], tab: 'friends' }));

/** How long the collapse plays before the panels unmount (matches `.fdock-stack.closing` in friendsDock.css). */
export const DOCK_CLOSE_MS = 160;

const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

let closeTimer: ReturnType<typeof setTimeout> | null = null;
const clearCloseTimer = (): void => { if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; } };

export function openDock(): void {
  clearCloseTimer();
  useFriendsDock.setState({ phase: 'open' });
}

/** Close the list, in one motion (the chat window has its own close: `closeDm`). */
export function closeDock(): void {
  const st = useFriendsDock.getState();
  if (st.phase !== 'open') return;
  useFriendsDock.setState({ phase: 'closing' });
  clearCloseTimer();
  closeTimer = setTimeout(() => { closeTimer = null; useFriendsDock.setState({ phase: 'closed' }); }, DOCK_CLOSE_MS);
}

export function toggleDock(): void {
  if (useFriendsDock.getState().phase === 'open') closeDock(); else openDock();
}

/**
 * Open the chat window on this friend (R-DM-CHAT-01, owner 2026-10-29: "the chat should open as a larger overlay in the
 * center of the screen, and should have tabs that hold all conversations"): their tab is added (or picked) and the
 * friends list collapses, so one surface is up at a time.
 */
export function openDm(userId: string): void {
  const st = useFriendsDock.getState();
  const has = st.chatTabs.some((t) => sameId(t, userId));
  useFriendsDock.setState({ dmWith: userId, chatTabs: has ? st.chatTabs : [...st.chatTabs, userId] });
  if (st.phase === 'open') closeDock();
}

/** Open the dock on a tab (a request's notice, a deep link that used to open the Friends page). */
export function openDockOn(tab: DockTab): void {
  clearCloseTimer();
  useFriendsDock.setState({ phase: 'open', tab });
}

export function setDockTab(tab: DockTab): void {
  useFriendsDock.setState({ tab });
}

/** Close the chat window (its tabs stay for the session). */
export function closeDm(): void {
  useFriendsDock.setState({ dmWith: null });
}

/**
 * Close one tab of the chat window. The next tab (else the one before) takes its place; the last one closes the window.
 * `shown` is the window's tab order as drawn (the session's tabs plus unread ones), so the neighbour matches the screen.
 */
export function closeChatTab(userId: string, shown: readonly string[] = useFriendsDock.getState().chatTabs): void {
  const st = useFriendsDock.getState();
  const chatTabs = st.chatTabs.filter((t) => !sameId(t, userId));
  let dmWith = st.dmWith;
  if (dmWith && sameId(dmWith, userId)) {
    const rest = shown.filter((t) => !sameId(t, userId));
    const i = shown.findIndex((t) => sameId(t, userId));
    dmWith = rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? null;
  }
  useFriendsDock.setState({ chatTabs, dmWith });
}

/** Tests: back to closed at once. */
export function resetDockForTests(): void {
  clearCloseTimer();
  useFriendsDock.setState({ phase: 'closed', dmWith: null, chatTabs: [], tab: 'friends' });
}

/**
 * The press that closed the dock (or the friend menu) must not become a click on the board once the catcher is gone:
 * a slow tap can lift after the 160 ms collapse unmounted it. The very next click (within 700 ms) is eaten, once.
 */
export function swallowNextClick(): void {
  if (typeof window === 'undefined') return;
  const until = performance.now() + 700;
  const eat = (e: MouseEvent): void => {
    window.removeEventListener('click', eat, true);
    if (performance.now() > until) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', eat, true);
  setTimeout(() => window.removeEventListener('click', eat, true), 750);
}

/** Close at once, no motion (the dock's screen went away under it, or the identity changed: the chat goes too). */
export function closeDockNow(): void {
  clearCloseTimer();
  const st = useFriendsDock.getState();
  if (st.phase !== 'closed' || st.dmWith || st.chatTabs.length) useFriendsDock.setState({ phase: 'closed', dmWith: null, chatTabs: [] });
}
