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
 *
 * THE LOADING SCREEN WAITS FOR A FOUND UPDATE (owner 2026-11-10, R-UPDATE-HOLD-LOADING-01: "i want the load screen to not
 * progress if there is a new version found and downloading"). Boot opens the game only once `onRelease` has fired:
 *   - up to date, no updater (browser, older shell, dev) or a failed check: released at once;
 *   - still "checking" after CHECK_HOLD_MS: released (a slow or dead network never holds the game);
 *   - downloading: HELD, unless the percent has not moved for STALL_MS (a stuck download never traps the player);
 *   - downloaded: HELD on the "restart and install" line, with a small "Not now" beside it that releases.
 * A download that outlives the hold is still announced by the notice under START (UpdateReadyNotice), same click.
 */
import { getUpdateStatus, installUpdate, type UpdateStatus } from './desktop';

/** How often the splash re-asks the shell while a check or download is running. */
const POLL_MS = 400;
/** The longest the loading screen waits on "Checking for updates" before opening the game anyway. */
export const CHECK_HOLD_MS = 8000;
/** A download whose percent has not moved for this long stops holding the loading screen. */
export const STALL_MS = 45000;

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

/**
 * Keep `el` showing the shell's update status until it is settled or `el` leaves the page, and call `onRelease` (once)
 * when the loading screen may open the game (see the header). `skip` is the "Not now" control shown beside the
 * downloaded line; `bar` is the download's own progress bar (`#bootsplash-dl`), shown only while downloading. Returns
 * the stop function.
 */
export function watchUpdateCheck(el: HTMLElement, onRelease: () => void = () => {}, skip: HTMLElement | null = null, bar: HTMLElement | null = null): () => void {
  let alive = true;
  let timer = 0;
  let restarting = false;
  let released = false;
  const t0 = Date.now();
  let lastPercent = -1;
  let lastMove = t0;
  const release = (): void => { if (!released) { released = true; onRelease(); } };
  const showSkip = (on: boolean): void => { skip?.classList.toggle('is-on', on && !released); };
  const go = (): void => {
    if (restarting || !el.classList.contains('is-click')) return;
    restarting = true;
    el.textContent = 'Restarting…';
    el.classList.remove('is-click');
    showSkip(false);
    bar?.classList.remove('is-on');
    installUpdate();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Enter' || e.key === ' ') go(); };
  const notNow = (): void => { if (restarting) return; release(); showSkip(false); };
  const onSkipKey = (e: KeyboardEvent): void => { if (e.key === 'Enter' || e.key === ' ') notNow(); };
  el.addEventListener('click', go);
  el.addEventListener('keydown', onKey);
  skip?.addEventListener('click', notNow);
  skip?.addEventListener('keydown', onSkipKey);
  const tick = (): void => {
    void getUpdateStatus().then((s) => {
      if (!alive || restarting || !el.isConnected) return;
      const line = updateCheckLine(s);
      if (el.textContent !== line.text) el.textContent = line.text;
      el.classList.toggle('is-click', line.click);
      if (line.click) { el.setAttribute('role', 'button'); el.tabIndex = 0; }
      showSkip(s.state === 'ready');
      if (bar) {
        bar.classList.toggle('is-on', s.state === 'downloading');
        const fill = bar.firstElementChild as HTMLElement | null;
        if (fill && s.state === 'downloading') fill.style.transform = `scaleX(${(Math.max(0, Math.min(100, s.percent)) / 100).toFixed(4)})`;
      }
      const now = Date.now();
      if (s.state === 'checking') {
        if (now - t0 >= CHECK_HOLD_MS) release();
      } else if (s.state === 'downloading') {
        if (s.percent !== lastPercent) { lastPercent = s.percent; lastMove = now; }
        else if (now - lastMove >= STALL_MS) release();
      } else if (s.state !== 'ready') {
        release(); // up to date, off, or a failed check: nothing to wait for
      }
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
    skip?.removeEventListener('click', notNow);
    skip?.removeEventListener('keydown', onSkipKey);
  };
}
