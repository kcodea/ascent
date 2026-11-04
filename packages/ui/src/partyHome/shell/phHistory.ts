/**
 * ONE BACK RULE (party home prototype; owner 2026-11-04). Every page move in the shell is a browser history entry (same URL, so
 * deep links and `?partyhome` are untouched), so Esc, the browser's Back and Android's back gesture all step to the page you
 * came from. Only the nav's lifetime writes here: a run adds nothing. No dependencies: the Escape handler reads it eagerly.
 */
let depth = 0;
let last: string | null = null;

/** The shell's current page changed. */
export function phPagePushed(page: string): void {
  if (typeof history === 'undefined') return;
  if (last === null) { last = page; history.replaceState({ ...(history.state as object | null), phPage: page }, ''); return; }
  if (page === last) return;
  last = page;
  depth++;
  history.pushState({ phPage: page }, '');
}

/** A popped entry: `apply` shows that page. Records it first, so showing it adds no new entry. */
export function phPopped(page: string, apply: (page: string) => void): void {
  depth = Math.max(0, depth - 1);
  last = page;
  apply(page);
}

/** The page to come back to after a dev Scene Builder game (the nav remounts when the menus return). */
let returnPage: string | null = null;
export function phRememberPage(): void { returnPage = last; }
export function phTakeReturnPage(): string | null { const p = returnPage; returnPage = null; return p; }

/** One step back, when there is a step. */
export function phBack(): boolean {
  if (depth <= 0) return false;
  history.back();
  return true;
}
