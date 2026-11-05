/**
 * ONE BACK RULE (party home prototype; owner 2026-11-04). The shell keeps one stack of pages, mirrored by browser history entries
 * (same URL, so deep links and `?partyhome` are untouched). Esc, every Back control, the browser's Back and Android's back gesture
 * are all ONE path: `phBack()` asks the browser to step back, and the `popstate` here does the step. Home is the root: nothing
 * steps back from it, and a browser Back there is put straight back, so it can never fall off the app.
 * Whatever opens ABOVE a page (a page over a game, the game menu, a pop-up, a list, a sheet) is a LAYER on the same history: Esc and
 * Back take the top layer first, one at a time, and in a game with nothing open Back stays in the game.
 * No dependencies: the Escape handler reads this eagerly.
 */
type Apply = (page: string) => void;
/** One layer above the page: a page over a game, the game menu, a pop-up, a list, a sheet. `close` null: closed out of order, its entry still to step past. */
type Layer = { close: (() => void) | null };

let stack: string[] = [];
let apply: Apply | null = null;
const layers: Layer[] = [];
/** The shell is on: off it (production) nothing here touches history or the keyboard. */
let enabled = false;
/** History moves of our own, which the listener must ignore. */
let silent = 0;
let index = 0;
let listening = false;
const PAGE_KEY = 'ascent.ph.page';

const push = (): void => { index++; history.pushState({ phI: index }, ''); };
const quietBack = (): void => { silent++; history.back(); };
/** Layers closed out of order leave a history entry each: step past them. */
const dropDead = (): void => { while (layers.length && !layers[layers.length - 1]!.close) { layers.pop(); quietBack(); } };
const remember = (): void => { try { sessionStorage.setItem(PAGE_KEY, stack[stack.length - 1] ?? 'home'); } catch { /* a convenience only */ } };

/** A guard entry under everything: the browser's Back always lands on us, so it can never fall off the app. */
function seed(): void {
  if (stack.length) return;
  history.replaceState({ ...(history.state as object | null), phI: 0 }, '');
  index = 0;
  stack = ['home'];
  push();
}

function onPop(e: PopStateEvent): void {
  const at = (e.state as { phI?: number } | null)?.phI ?? 0;
  if (silent > 0) { silent--; index = at; return; }
  const top = layers.pop();
  if (top) { index = at; top.close?.(); dropDead(); return; }
  if (!apply) { index = at; if (enabled) push(); return; } // in a game with nothing open: stay in it
  if (at > index) { index = at; quietBack(); return; } // the browser's Forward: pages only step back
  index = at;
  if (stack.length < 2) { push(); return; } // Home: stay
  stack.pop();
  // Someone else's Career cannot be reopened from here: step past it.
  while (stack[stack.length - 1] === 'other' && stack.length > 1) { stack.pop(); quietBack(); }
  remember();
  apply(stack[stack.length - 1]!);
}

/** A search box with text: the first Esc clears it, an empty one lets go of the focus. Never leaves the page. */
function escField(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement) || el.type !== 'search') return false;
  if (el.value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.blur();
  return true;
}

/** A hover preview on screen: Esc puts it away until the pointer moves on. */
function escPreview(): boolean {
  const html = document.documentElement;
  if (html.hasAttribute('data-ph-tipoff') || !document.querySelector('.cardref')) return false;
  html.setAttribute('data-ph-tipoff', '');
  let x: number | null = null; let y = 0;
  const onMove = (e: PointerEvent): void => {
    if (x === null) { x = e.clientX; y = e.clientY; return; }
    if (Math.hypot(e.clientX - x, e.clientY - y) < 12) return;
    html.removeAttribute('data-ph-tipoff');
    window.removeEventListener('pointermove', onMove);
  };
  window.addEventListener('pointermove', onMove);
  return true;
}

/** Esc, ahead of every other listener: what is on top goes first, and only that. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !enabled) return;
  if (escField() || escPreview()) { /* claimed */ } else if (layers.length) history.back(); else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPop);
  window.addEventListener('keydown', onKey, true);
}

/** The shell is on for this session: Back is ours from here, in a game too. */
export function phEnable(): void {
  if (typeof history === 'undefined') return;
  enabled = true;
  listen();
  seed();
}

/** The nav is up: `show` brings a page on screen. Returns the detach. */
export function phAttach(show: Apply): () => void {
  phEnable();
  apply = show;
  return () => { apply = null; };
}

/** After a reload: the page the player was on, once. */
export function phTakeReloadPage(): string | null {
  try { const p = sessionStorage.getItem(PAGE_KEY); sessionStorage.removeItem(PAGE_KEY); return p && p !== 'home' && p !== 'other' ? p : null; } catch { return null; }
}

/** The shell's current page changed, by any control. */
export function phPagePushed(page: string): void {
  if (typeof history === 'undefined') return;
  phEnable();
  const top = stack[stack.length - 1];
  if (page === top) return;
  // A control went back by itself (a page's own Back, the gear): the stack and the browser follow it.
  if (page === stack[stack.length - 2]) { stack.pop(); remember(); quietBack(); return; }
  if (page === 'home') { stack = ['home']; remember(); push(); return; }
  stack.push(page);
  remember();
  push();
}

/** One step back: Esc and every Back control. False where there is no step (Home). */
export function phBack(): boolean {
  if (typeof history === 'undefined') return false;
  if (!layers.length && stack.length < 2) return false;
  history.back();
  return true;
}

/** Is Esc the shell's right now? (the nav is up, or something is open over a game) */
export const phOwnsBack = (): boolean => !!apply || layers.length > 0;
/** Something is open above the page. */
export const phInLayer = (): boolean => layers.length > 0;

/** Anything that opens above a page: Back runs `close`, the top layer first. Returns the cleanup for one closed some other way. */
export function phLayer(close: () => void): () => void {
  if (!enabled) return () => undefined;
  const layer: Layer = { close };
  push();
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    if (i === layers.length - 1) { layers.pop(); quietBack(); dropDead(); } else layer.close = null;
  };
}

/** The page and the saved game to come back to after a dev Scene Builder game. */
let returnTo: { page: string; saved: unknown } | null = null;
export function phRememberPage(saved: unknown): void { returnTo = { page: stack[stack.length - 1] ?? 'home', saved }; }
export function phTakeReturn(): { page: string; saved: unknown } | null { const r = returnTo; returnTo = null; return r; }
