/**
 * THE IN-GAME MENU (owner 2026-10-29, R-ESC-SIDEBAR-01: "when pressing escape, have the left side bar come up with the
 * play/etc buttons. allow players to view this information in game, and have the settings panel at the bottom baked
 * into a normal 'window' just like these other pages are").
 *
 * Escape (or the gear) in a game slides in the main menu's own sidebar (`MenuSidebar`, in its in-game form: Resume, the
 * Shop clock, the pages, Settings, the leave button) over the game, which stays on screen DIMMED and keeps running.
 * A page opened from it (Career, Collection, Settings, ...) is the ordinary page host, drawn without its painted
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
import { anyPageOpen, useGame } from './store';
import { sfx } from './sfx';

export function GameMenu() {
  const open = useGame((s) => s.gameMenuOpen);
  const paged = useGame(anyPageOpen);
  const close = useGame((s) => s.closeGameMenu);
  // The menu belongs to a game: back on the title (Save & Quit, a game that ended into the menus) it closes itself.
  const onTitle = useGame((s) => s.showTitle);
  useEffect(() => { if (open && onTitle) close(); }, [open, onTitle, close]);
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
