/**
 * THE IN-GAME MENU (owner 2026-10-29, R-ESC-SIDEBAR-01: "when pressing escape, have the left side bar come up with the
 * play/etc buttons. allow players to view this information in game, and have the settings panel at the bottom baked
 * into a normal 'window' just like these other pages are").
 *
 * Escape (or the gear) in a game slides in the main menu's own sidebar (`MenuSidebar`, in its in-game form: Resume, the
 * Shop clock, the pages, Settings, the leave button) over the game, which stays on screen DIMMED and keeps running.
 * A page opened from it (Career, Collection, Settings, Patch Notes, ...) is the ordinary page host, drawn without its painted
 * backdrop so the dimmed game shows through (`.gmenu ~ .lbpage` in styles.css); the page carries the same rail, so this
 * layer's own rail hides under it (visibility only, so it never replays its slide-in).
 *
 * Closing: Escape again, Resume, or a press on the dimmed game. The veil and the rail are one fixed layer under the
 * pages (z 465 < 470) and under the Friends dock (480), so the dock stays usable over the menu.
 *
 * PERF: the slide is a one-shot transform, the veil a one-shot opacity fade; the veil is a static fill (no
 * backdrop-filter), so the game behind it renders exactly as before. Nothing here mounts until the menu opens, and each
 * page mounts only when opened.
 */
import { useEffect } from 'react';
import { MenuSidebar } from './MenuSidebar';
import { PAGES_CLOSED, anyPageOpen, inGameScreen, useGame } from './store';
import { sfx } from './sfx';
import { phBack, phInLayer, phOwnsBack } from './partyHome/shell/phHistory';
import { usePartyHome } from './partyHome/partyHomeFlag';

/** Escape / the gear: in a game the in-game menu (the sidebar over the dimmed game), on the menus the Settings page. */
export function openMenu(): void {
  const st = useGame.getState();
  if (inGameScreen(st)) st.openGameMenu();
  else st.openSettings();
}

/** Does something already open answer Esc? The test an aim runs before it takes Esc for itself (R-TARGET-CANCEL-01). */
export function escapeHasOwner(st: ReturnType<typeof useGame.getState>): boolean {
  return !!(st.showBook || st.gameMenuOpen || st.settingsOpen || st.showPatchNotes || st.inspect);
}

/** Settings opened by Escape in a game: closing it goes straight back to the game, not to the in-game menu under it. Ends
 *  when the menu closes by any route (GameMenu below). */
let escSettingsInGame = false;

/** Closing a page opened over a game: Settings that Escape opened takes the in-game menu with it (R-ESC-SETTINGS-01). */
export function closeInGamePageState(): Partial<ReturnType<typeof useGame.getState>> {
  const st = useGame.getState();
  const toGame = escSettingsInGame && st.settingsOpen;
  escSettingsInGame = false;
  return toGame ? { ...PAGES_CLOSED, gameMenuOpen: false } : { ...PAGES_CLOSED };
}

/** ESCAPE OPENS SETTINGS ON EVERY SCREEN (owner 2026-11-07, R-ESC-SETTINGS-01): the home, every page, and in a game, where it
 *  is the Settings page over the dimmed game (the in-game menu's own Settings page). */
export function openSettingsFromEscape(): void {
  const st = useGame.getState();
  if (st.showBook) st.closeBook();
  if (inGameScreen(st)) {
    escSettingsInGame = true;
    useGame.setState({ ...PAGES_CLOSED, gameMenuOpen: true, settingsOpen: true });
    return;
  }
  st.openSettings();
}

/** Typing in a field: Esc lets go of the field and opens nothing. */
function escTyping(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  const typing = el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)
    || (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(el.type));
  if (!typing) return false;
  (el as HTMLElement).blur();
  return true;
}

/** THE ESCAPE KEY (Game.tsx's one listener). Whatever is open on top closes first (a layer, a dropdown, a window, the
 *  Compendium, Settings itself, the in-game menu with any page it opened); a card being inspected claims Esc itself;
 *  typing in a field only lets go of it; else Settings opens, on every screen (R-ESC-SETTINGS-01). */
export function handleEscape(): void {
  const st = useGame.getState();
  // THE PARTY HOME SHELL: the top layer goes first, one at a time, one path with every Back control (phHistory.ts).
  if (phInLayer()) { phBack(); return; }
  if (st.inspect && !st.gameMenuOpen && !st.showBook) return;
  if (escTyping()) return;
  if (phOwnsBack() && !st.gameMenuOpen) {
    if (st.practiceSetupOpen) { st.cancelPracticeSetup(); return; }
    // Settings and the Compendium open OVER a page: Esc takes them off, back to that page.
    if (st.settingsOpen || st.showBook) {
      if (!phBack()) { if (st.settingsOpen) st.closeSettings(); if (st.showBook) st.closeBook(); }
      return;
    }
    openSettingsFromEscape();
    return;
  }
  if (st.showBook) { st.closeBook(); return; }
  if (st.gameMenuOpen) { st.closeGameMenu(); return; }
  if (st.settingsOpen) { st.closeSettings(); return; }
  if (st.showPatchNotes) { st.closePatchNotes(); return; }
  if (st.practiceSetupOpen && typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ph-shell')) {
    st.cancelPracticeSetup();
    return;
  }
  openSettingsFromEscape();
}

export function GameMenu() {
  const open = useGame((s) => s.gameMenuOpen);
  const paged = useGame(anyPageOpen);
  const close = useGame((s) => s.closeGameMenu);
  // The menu belongs to a game: back on the title (Save & Quit, a game that ended into the menus) it closes itself.
  const onTitle = useGame((s) => s.showTitle);
  useEffect(() => { if (open && onTitle) close(); }, [open, onTitle, close]);
  useEffect(() => { if (!open) escSettingsInGame = false; }, [open]);
  // The party home prototype's phone rail: every row on screen, the corner icons on their own row below it (styles.css).
  const shellFlag = usePartyHome();
  const phRail = shellFlag && open && !onTitle;
  useEffect(() => {
    document.documentElement.toggleAttribute('data-ph-gm', phRail);
    return () => document.documentElement.removeAttribute('data-ph-gm');
  }, [phRail]);
  if (!open || onTitle) return null;
  return (
    <div className={`gmenu${paged ? ' paged' : ''}`} role="dialog" aria-label="Game menu">
      <div className="gmenu-veil" aria-hidden="true" onPointerDown={() => { sfx.pulse(); close(); }} />
      <div className="gmenu-rail" aria-hidden={paged || undefined}>
        <MenuSidebar current={null} />
      </div>
    </div>
  );
}
