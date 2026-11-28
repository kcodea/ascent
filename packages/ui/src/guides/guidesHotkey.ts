/**
 * G TOGGLES THE GUIDES (owner 2026-11-27: "add "g" as a keybind to open guides"; R-GUIDES-KEY-01). The default key; it is
 * rebindable in Settings like every other key (keybinds.ts, R-SETTINGS-KEYBINDS-01). It opens the same Guides overlay the
 * bottom-right Guides square opens, and the same key closes it again (so does Esc, a press outside it and its X).
 *
 * The rail (LobbyPanel.tsx) listens with this only while its Guides square is on screen: never in the Tutorial, in
 * combat or off a game. G is a letter, so it stands down wherever a letter means typing (a text field, the chat, the
 * Compendium's search; the Compendium key's own test), while a Settings key button waits for a key, and on Hero Select.
 * With Ctrl / Cmd / Alt held it is someone else's. A held key's repeats never toggle it again.
 *
 * One overlay at a time: opening the guides from the Compendium or from Settings swaps to them, as C does from Settings.
 */
import { typingTarget } from '../compendiumHotkey';
import { keyCaptureActive, matchesAction } from '../keybinds/keybinds';
import { useGame } from '../store';

export function onGuidesKey(e: KeyboardEvent, toggle: () => void): void {
  if (!matchesAction('guides', e)) return;
  if (keyCaptureActive()) return;
  if (typingTarget(e.target) || typingTarget(typeof document !== 'undefined' ? document.activeElement : null)) return;
  const st = useGame.getState();
  if (st.heroChoices || st.combatStaged) return;
  e.preventDefault();
  if (e.repeat) return;
  if (st.showBook) st.closeBook();
  if (st.settingsOpen) st.closeSettings();
  toggle();
}
