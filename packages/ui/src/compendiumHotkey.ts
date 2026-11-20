/**
 * C TOGGLES THE COMPENDIUM (R-COMPENDIUM-TAB-01; the key was Tab until the owner moved it to C on 2026-11-20): on the
 * menus (browse the whole set), in a match (scoped to it) and on my own Hero Select (the same overlay its View Compendium
 * button opens), and the same key closes it again. This is the ONE key listener for the book: the in-match Compendium page
 * has none of its own, so a press can never open and close it at once.
 *
 * C is a letter, so it stands down wherever a letter means typing: a text field, a text area, a select or anything
 * editable (the Compendium's own search box, chat, names, guides). With Ctrl / Cmd / Alt held it is someone else's
 * (Ctrl+C copies). A held key's repeats never toggle the book again.
 *
 * Not on someone else's Hero Select (the stands, a Duos teammate's choices), and not once my own pick's ceremony runs:
 * the same places the button is absent. An open book always closes.
 *
 * It used to stand down whenever the party home shell was up (`html[data-ph-shell]`), from when that shell was a DEV
 * prototype. The shell is the production UI now (R-PH-PRODUCTION-01), so that skip silently killed the key on every menu
 * of the desktop app.
 */
import { useGame } from './store';
import { useSpectate } from './versus/spectate';
import { useOwnHeroPick } from './hero-select/ownHeroPick';

/** The default key for the Compendium (there is no rebinding yet; this is the one place it is named). */
export const COMPENDIUM_KEY = 'c';

const TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image']);

/** A letter typed here is text, not a hotkey. */
export function typingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return !TEXT_INPUTS.has(el.type);
  return !!el.closest('[contenteditable]:not([contenteditable="false"])');
}

/** Someone else's Hero Select is on screen (HeroSelectWatch's own test). */
function watchingHeroSelect(): boolean {
  const sp = useSpectate.getState();
  return !!sp.hero && (sp.teammateHero === true || sp.active);
}

export function onCompendiumKey(e: KeyboardEvent): void {
  if (e.key.toLowerCase() !== COMPENDIUM_KEY || e.ctrlKey || e.metaKey || e.altKey) return;
  if (typingTarget(e.target) || typingTarget(typeof document !== 'undefined' ? document.activeElement : null)) return;
  const st = useGame.getState();
  if (!st.showBook) {
    if (watchingHeroSelect()) return;
    if (st.heroChoices && useOwnHeroPick.getState().heroId !== null) return; // my pick's ceremony is running
  }
  e.preventDefault();
  if (e.repeat) return;
  // Settings is a page too: opening the book from it swaps to the book, as the top bar's Compendium button does.
  if (!st.showBook && st.settingsOpen) st.closeSettings();
  st.toggleBook();
}

export function installCompendiumHotkey(): () => void {
  window.addEventListener('keydown', onCompendiumKey);
  return () => window.removeEventListener('keydown', onCompendiumKey);
}
