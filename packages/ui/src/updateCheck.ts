/**
 * THE LOADING SCREEN'S UPDATE LINE (owner 2026-11-10, R-UPDATE-CHECK-LOADING-01: "id love to put the check for update on
 * the loading screen"). The desktop shell checks for a newer release the moment the game window opens; this reads where
 * that check stands and writes one line onto the splash (`#bootsplash-update` in apps/web/index.html):
 *
 *   Checking for updates…  →  Your version of Ascent is up to date.
 *                          →  New version found. Downloading version X… 43%
 *                          →  New version found. Click here to restart and install version X.
 *
 * The click relaunches the app, and the new launch installs the update behind the shell's own "Installing update" screen.
 * Loading never waits on any of this: when the art is ready the game opens, and a download still running is announced by
 * the notice under START (UpdateReadyNotice), which carries the same click. Nothing shows in the browser, on a shell too
 * old to answer, or when the check fails (the updater never shows an error).
 */
import { getUpdateStatus, installUpdate, type UpdateStatus } from './desktop';

/** How often the splash re-asks the shell while a check or download is running. */
const POLL_MS = 400;

/** The line for a status, and whether it is the clickable "restart and install" line. Pure, so it is testable. */
export function updateCheckLine(s: UpdateStatus): { text: string; click: boolean } {
  switch (s.state) {
    case 'checking': return { text: 'Checking for updates…', click: false };
    case 'current': return { text: 'Your version of Ascent is up to date.', click: false };
    case 'downloading': return { text: `New version found. Downloading version ${s.version ?? ''}… ${Math.round(s.percent)}%`, click: false };
    case 'ready': return { text: `New version found. Click here to restart and install version ${s.version ?? ''}.`, click: true };
    default: return { text: '', click: false };
  }
}

/** Keep `el` showing the shell's update status until it is settled or `el` leaves the page. Returns the stop function. */
export function watchUpdateCheck(el: HTMLElement): () => void {
  let alive = true;
  let timer = 0;
  let restarting = false;
  const go = (): void => {
    if (restarting || !el.classList.contains('is-click')) return;
    restarting = true;
    el.textContent = 'Restarting…';
    el.classList.remove('is-click');
    installUpdate();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Enter' || e.key === ' ') go(); };
  el.addEventListener('click', go);
  el.addEventListener('keydown', onKey);
  const tick = (): void => {
    void getUpdateStatus().then((s) => {
      if (!alive || restarting || !el.isConnected) return;
      const line = updateCheckLine(s);
      if (el.textContent !== line.text) el.textContent = line.text;
      el.classList.toggle('is-click', line.click);
      if (line.click) { el.setAttribute('role', 'button'); el.tabIndex = 0; }
      // 'checking' and 'downloading' are still moving; everything else is this launch's final answer.
      if (s.state === 'checking' || s.state === 'downloading') timer = window.setTimeout(tick, POLL_MS);
    });
  };
  tick();
  return () => {
    alive = false;
    window.clearTimeout(timer);
    el.removeEventListener('click', go);
    el.removeEventListener('keydown', onKey);
  };
}
