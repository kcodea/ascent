/**
 * THE POP-IN PROBE'S SWITCH (owner 2026-11-04: "i am seeing a ton of art pop in"). Kept apart from `popIn.ts` so the
 * entry chunk carries these few lines and nothing else: the probe itself is a lazy chunk a normal player never fetches.
 *
 * On with `?popin=1` (works on a production build, so the owner can run it on Netlify and paste the report), sticky
 * through `localStorage['ascent.popin'] = '1'` (the Dev menu's toggle writes it). `?popin=0` turns the sticky flag off.
 */
const KEY = 'ascent.popin';

export function popInEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('popin');
    if (q === '1' || q === '0') { window.localStorage.setItem(KEY, q); return q === '1'; }
  } catch { /* no location / storage blocked */ }
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Load and start the probe. Idempotent (`installPopIn` guards), never throws into the caller. */
export function startPopIn(): void {
  void import('./popIn').then((m) => m.installPopIn()).catch(() => { /* a measuring tool must never break a boot */ });
}

/** The Dev menu's toggle: remembered, and turning it off takes effect on the next load. */
export function setPopInSticky(on: boolean): void {
  try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}
