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
  /** The friend whose direct message panel is open (null: just the list). */
  dmWith: string | null;
  tab: DockTab;
}

export const useFriendsDock = create<DockState>(() => ({ phase: 'closed', dmWith: null, tab: 'friends' }));

/** How long the collapse plays before the panels unmount (matches `.fdock-stack.closing` in friendsDock.css). */
export const DOCK_CLOSE_MS = 160;

let closeTimer: ReturnType<typeof setTimeout> | null = null;
const clearCloseTimer = (): void => { if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; } };

export function openDock(): void {
  clearCloseTimer();
  useFriendsDock.setState({ phase: 'open' });
}

/** Close the list AND the direct message panel together, in one motion. */
export function closeDock(): void {
  const st = useFriendsDock.getState();
  if (st.phase !== 'open') return;
  useFriendsDock.setState({ phase: 'closing' });
  clearCloseTimer();
  closeTimer = setTimeout(() => { closeTimer = null; useFriendsDock.setState({ phase: 'closed', dmWith: null }); }, DOCK_CLOSE_MS);
}

export function toggleDock(): void {
  if (useFriendsDock.getState().phase === 'open') closeDock(); else openDock();
}

/** Open the dock on a direct message with this friend (the list stays up beside it). Same friend again closes it. */
export function openDm(userId: string): void {
  clearCloseTimer();
  const st = useFriendsDock.getState();
  useFriendsDock.setState({ phase: 'open', dmWith: st.phase === 'open' && st.dmWith === userId ? null : userId });
}

/** Open the dock on a tab (a request's notice, a deep link that used to open the Friends page). */
export function openDockOn(tab: DockTab): void {
  clearCloseTimer();
  useFriendsDock.setState({ phase: 'open', tab });
}

export function setDockTab(tab: DockTab): void {
  useFriendsDock.setState({ tab });
}

export function closeDm(): void {
  useFriendsDock.setState({ dmWith: null });
}

/** Tests: back to closed at once. */
export function resetDockForTests(): void {
  clearCloseTimer();
  useFriendsDock.setState({ phase: 'closed', dmWith: null, tab: 'friends' });
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

/** Close at once, no motion (the dock's screen went away under it). */
export function closeDockNow(): void {
  clearCloseTimer();
  if (useFriendsDock.getState().phase !== 'closed') useFriendsDock.setState({ phase: 'closed', dmWith: null });
}
