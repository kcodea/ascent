/**
 * ONE BACK RULE (party home prototype; owner 2026-11-04). The shell keeps one stack of pages, mirrored by browser history entries
 * (same URL, so deep links and `?partyhome` are untouched). Esc, every Back control, the browser's Back and Android's back gesture
 * are all ONE path: `phBack()` asks the browser to step back, and the `popstate` here does the step. Home is the root: nothing
 * steps back from it, and a browser Back there is put straight back, so it can never fall off the app.
 * A page opened over a game is a LAYER on the same history: Back closes it, whatever history came before.
 * No dependencies: the Escape handler reads this eagerly.
 */
type Apply = (page: string) => void;

let stack: string[] = [];
let apply: Apply | null = null;
let layerClose: (() => void) | null = null;
/** History moves of our own, which the listener must ignore. */
let silent = 0;
let index = 0;
let listening = false;

const push = (): void => { index++; history.pushState({ phI: index }, ''); };
const quietBack = (): void => { silent++; history.back(); };

function onPop(e: PopStateEvent): void {
  const at = (e.state as { phI?: number } | null)?.phI ?? 0;
  if (silent > 0) { silent--; index = at; return; }
  if (layerClose) { const close = layerClose; layerClose = null; index = at; close(); return; }
  if (!apply) return;
  if (at > index) { index = at; quietBack(); return; } // the browser's Forward: pages only step back
  index = at;
  if (stack.length < 2) { push(); return; } // Home: stay
  stack.pop();
  // Someone else's Career cannot be reopened from here: step past it.
  while (stack[stack.length - 1] === 'other' && stack.length > 1) { stack.pop(); quietBack(); }
  apply(stack[stack.length - 1]!);
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPop);
}

/** The nav is up: `show` brings a page on screen. Returns the detach. */
export function phAttach(show: Apply): () => void {
  listen();
  apply = show;
  return () => { apply = null; };
}

/** The shell's current page changed, by any control. */
export function phPagePushed(page: string): void {
  if (typeof history === 'undefined') return;
  if (stack.length === 0) {
    // A guard entry under the first page: the browser's Back always lands on us.
    history.replaceState({ ...(history.state as object | null), phI: 0 }, '');
    index = 0;
    stack = ['home'];
    push();
  }
  const top = stack[stack.length - 1];
  if (page === top) return;
  // A control went back by itself (a page's own Back, the gear): the stack and the browser follow it.
  if (page === stack[stack.length - 2]) { stack.pop(); quietBack(); return; }
  if (page === 'home') { stack = ['home']; push(); return; }
  stack.push(page);
  push();
}

/** One step back: Esc and every Back control. False where there is no step (Home). */
export function phBack(): boolean {
  if (typeof history === 'undefined') return false;
  if (!layerClose && stack.length < 2) return false;
  history.back();
  return true;
}

/** Is Esc the shell's right now? (the nav is up, or a page is open over a game) */
export const phOwnsBack = (): boolean => !!apply || !!layerClose;
/** A page open over a game. */
export const phInLayer = (): boolean => !!layerClose;

/** A page opened over a game: Back runs `close`. Returns the cleanup for a page closed some other way. */
export function phLayer(close: () => void): () => void {
  listen();
  push();
  layerClose = close;
  return () => { if (layerClose === close) { layerClose = null; quietBack(); } };
}

/** The page and the saved game to come back to after a dev Scene Builder game. */
let returnTo: { page: string; saved: unknown } | null = null;
export function phRememberPage(saved: unknown): void { returnTo = { page: stack[stack.length - 1] ?? 'home', saved }; }
export function phTakeReturn(): { page: string; saved: unknown } | null { const r = returnTo; returnTo = null; return r; }
