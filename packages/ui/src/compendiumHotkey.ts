/**
 * TAB TOGGLES THE COMPENDIUM (R-COMPENDIUM-TAB-01): on the menus (browse the whole set) and in a match (scoped to it), and
 * the same key closes it again. Not during hero select. This is the ONE Tab listener for the book: the in-match Compendium
 * page has none of its own, so a press can never open and close it at once.
 *
 * It used to stand down whenever the party home shell was up (`html[data-ph-shell]`), from when that shell was a DEV
 * prototype. The shell is the production UI now (R-PH-PRODUCTION-01), so that skip silently killed Tab on every menu of
 * the desktop app. Text fields and dialogs that want Tab for themselves stop its propagation before it gets here.
 */
import { useGame } from './store';

export function onCompendiumTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const st = useGame.getState();
  if (st.heroChoices) return;
  e.preventDefault(); // no browser focus-cycling
  // Settings is a page too: opening the book from it swaps to the book, as the top bar's Compendium button does.
  if (!st.showBook && st.settingsOpen) st.closeSettings();
  st.toggleBook();
}

export function installCompendiumHotkey(): () => void {
  window.addEventListener('keydown', onCompendiumTab);
  return () => window.removeEventListener('keydown', onCompendiumTab);
}
