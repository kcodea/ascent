/**
 * SPECTATOR HOVER PREVIEWS (owner 2026-10-15: "in spectating, the mouseover previews dont work when the player playing
 * mouses over something"; R-SPECTATE-HOVER-01).
 *
 * The watched player's cursor sample carries the UI element under their pointer as a stable key (`cursorSpace.ts`:
 * `u:<uid>` for a card or minion, `s:<spec>` for a button, rune, quest or the hero power), never DOM. The spectator
 * resolves the key to ITS OWN element and hovers it the way a mouse does: a `mouseover` + `pointerover` (no related
 * target) in, a `mouseout` + `pointerout` out. Every hover preview in the game is opened by that element's own
 * enter / leave handler, so the stands see the SAME preview component, placed against their own screen, with no second
 * preview UI to keep in step. A CSS `:hover` tip (a `.gtip` bubble, the rune / quest badge tip, the hero power's) is
 * lit the way a touch tap lights it (`touchInput.ts markChain`): the game's existing `tt-on` class on the element and
 * its ancestors.
 *
 * Cost: work only when the hovered key CHANGES (a key is a short string on a sample that is already sent), one
 * `querySelector` then; nothing per frame.
 */
import { findAnchor } from './cursorSpace';

let current: { key: string; el: HTMLElement; lit: Element[] } | null = null;

function fire(el: HTMLElement, over: boolean): void {
  const init = { bubbles: true, cancelable: true, composed: true, relatedTarget: null } as const;
  el.dispatchEvent(new MouseEvent(over ? 'mouseover' : 'mouseout', init));
  const PE: typeof MouseEvent = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new PE(over ? 'pointerover' : 'pointerout', { ...init, pointerType: 'mouse', isPrimary: true } as MouseEventInit));
}

/** Hover the element for `key` on this screen (null: hover nothing). A no-op while the key is unchanged. */
export function setSpectatorHover(key: string | null, root: ParentNode = document): void {
  if (current && current.key === key && current.el.isConnected) return;
  const prev = current;
  current = null;
  if (prev && prev.el.isConnected) {
    fire(prev.el, false);
  }
  for (const n of prev?.lit ?? []) n.classList.remove('tt-on');
  if (!key) return;
  const el = findAnchor(key, root);
  if (!el) return;
  fire(el, true);
  // The chain, minus anything already lit (a touch tap's own chain is never cleared by us).
  const lit: Element[] = [];
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (!n.classList.contains('tt-on')) { n.classList.add('tt-on'); lit.push(n); }
  }
  current = { key, el, lit };
}

/** The key hovered right now (tests). */
export const spectatorHoverKey = (): string | null => current?.key ?? null;
