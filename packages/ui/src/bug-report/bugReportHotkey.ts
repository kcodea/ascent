/**
 * BUG REPORTER (PR 1) — the Ctrl+B application-level hotkey (blueprint §5.3).
 *
 * ONE window keydown listener, installed by the root game shell (`Game.tsx`) — never inside Recruit. The
 * listener is deliberately thin: every policy decision (excluded surfaces, the presentationTx toast,
 * repeat-press-focuses-the-textarea) lives in the store's `openBugReport`, so the hotkey, a future menu
 * button, and tests all go through one authority.
 */
import { useGame } from '../store';

/** Ctrl+B exactly (no Alt/Shift); Meta+B is the sanctioned macOS alias. Physical-key `code` so layouts
 *  that move the letter B still land on the documented binding. */
export function isBugReportShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyB';
}

/**
 * Install the listener; returns the uninstaller (mount-once via `useEffect(() => installBugReportHotkey(), [])`).
 * `open` is injectable for tests; the default routes to the store.
 */
export function installBugReportHotkey(
  open: () => void = () => useGame.getState().openBugReport(),
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (!isBugReportShortcut(e)) return;
    // Always claim the combo inside the game window — the browser's bookmark UI must never pop mid-run,
    // even on a surface where the reporter itself declines to open.
    e.preventDefault();
    if (e.repeat || e.isComposing) return; // holding the key opens exactly one report; never fire mid-IME
    open();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
