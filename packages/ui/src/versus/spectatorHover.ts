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
/** The key the watched player is hovering (applied whenever the spectator's own hand is not on a rune). */
let wanted: { key: string | null; root: ParentNode } = { key: null, root: typeof document === 'undefined' ? (null as unknown as ParentNode) : document };
/** The rune the SPECTATOR's own mouse is on (R-SPECTATE-RUNEHOVER-01), or null. */
let local: Element | null = null;

function fire(el: HTMLElement, over: boolean): void {
  const init = { bubbles: true, cancelable: true, composed: true, relatedTarget: null } as const;
  el.dispatchEvent(new MouseEvent(over ? 'mouseover' : 'mouseout', init));
  const PE: typeof MouseEvent = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new PE(over ? 'pointerover' : 'pointerout', { ...init, pointerType: 'mouse', isPrimary: true } as MouseEventInit));
}

/** Hover the element for `key` on this screen (null: hover nothing). A no-op while the key is unchanged. While the
 *  spectator's own mouse is on a rune, the player's hover waits (their own hover wins on their own screen). */
export function setSpectatorHover(key: string | null, root: ParentNode = document): void {
  wanted = { key, root };
  if (local) return;
  applyHover(key, root);
}

function applyHover(key: string | null, root: ParentNode): void {
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

/**
 * THE SPECTATOR'S OWN RUNE HOVER (owner 2026-10-16: "also, let spectators mouse over the runes themselves";
 * R-SPECTATE-RUNEHOVER-01). A spectator can hover any rune (the watched player's rune badges, the Runeforge's offer
 * cards, an opponent's runes) and get the same preview the player gets, locally. While their own mouse is on one, the
 * player's mirrored hover is lifted (their hover wins on their screen); when it leaves, the player's comes back.
 * Nothing is sent. Only REAL pointer events count (the mirrored hover's own synthetic events are untrusted).
 */
export const LOCAL_HOVER_SELECTOR = '.runebadge, .runecard, .lobbyscout-socket, .combatopp-rune';
export function noteLocalHover(el: Element | null): void {
  if (el === local) return;
  local = el;
  if (el) applyHover(null, wanted.root);
  else applyHover(wanted.key, wanted.root);
}
const onLocalOver = (e: Event): void => {
  if (!e.isTrusted) return;
  const t = e.target instanceof Element ? e.target.closest(LOCAL_HOVER_SELECTOR) : null;
  noteLocalHover(t);
};
let watching = false;
/** Listen for the spectator's own hand while the watch screen is open (one capture listener, a `closest` per entry). */
export function watchLocalHover(on: boolean): void {
  if (on === watching || typeof document === 'undefined') return;
  watching = on;
  if (on) document.addEventListener('pointerover', onLocalOver, true);
  else { document.removeEventListener('pointerover', onLocalOver, true); local = null; }
}

/** The key hovered right now (tests). */
export const spectatorHoverKey = (): string | null => current?.key ?? null;
