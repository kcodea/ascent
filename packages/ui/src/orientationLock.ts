/**
 * ANDROID: LOCK THE PHONE TO LANDSCAPE ON THE FIRST TAP (owner 2026-10-29, R-PHONE-SIDEWAYS-01: "Make it so mobile only
 * loads in landscape so it doesn't require a rotate").
 *
 * Chrome on Android can hold a page in landscape (`screen.orientation.lock`), but only in fullscreen, and fullscreen
 * needs a user gesture. So the first tap anywhere (the title's Play, or any other) asks for fullscreen and then the
 * lock. Until that tap, and wherever either is refused, the turned render (`sideways.ts`) shows the game sideways, so
 * there is never a rotate step. An installed app (the manifest asks for landscape) is usually locked already.
 *
 * iOS has no fullscreen for pages on an iPhone and no orientation lock at all, so this does nothing there (the feature
 * checks fail, and any refusal is swallowed): an iPhone always gets the turned render.
 *
 * If the player leaves fullscreen (the Back gesture) the lock goes with it, and the next tap asks again.
 */

interface LockableOrientation { lock?: (o: string) => Promise<void> }

/** Pure: can this browser lock the screen to landscape from a page? */
export function canLockLandscape(orientation: unknown, requestFullscreen: unknown): boolean {
  return typeof requestFullscreen === 'function' && !!orientation && typeof (orientation as LockableOrientation).lock === 'function';
}

let installed = false;
/** Phones only (stage.ts `installStage`). Arms the first-tap request once; re-arms when fullscreen is left. */
export function installLandscapeLock(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  const de = document.documentElement as HTMLElement & { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
  const orientation = typeof screen !== 'undefined' ? (screen.orientation as unknown as LockableOrientation | undefined) : undefined;
  if (!canLockLandscape(orientation, de.requestFullscreen)) return;
  installed = true;

  const lock = (): Promise<void> => orientation!.lock!('landscape').catch(() => { /* refused: the turned render stays */ });
  let armed = false;
  const onTap = (): void => {
    disarm();
    try {
      // Already fullscreen (an installed fullscreen app, or a second tap): just lock.
      if (document.fullscreenElement) { void lock(); return; }
      const p = de.requestFullscreen!({ navigationUI: 'hide' });
      if (p && typeof p.then === 'function') p.then(lock, () => { /* refused: the turned render stays */ });
    } catch { /* no fullscreen here: the turned render stays */ }
  };
  // `pointerup`, not `pointerdown`: a tap's release is a user activation in every Chrome, and it is the moment the
  // tap's own action runs, so the screen does not jump under a finger that is still deciding.
  const arm = (): void => { if (armed) return; armed = true; document.addEventListener('pointerup', onTap, { capture: true, passive: true }); };
  function disarm(): void { if (!armed) return; armed = false; document.removeEventListener('pointerup', onTap, { capture: true }); }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) arm(); });
  arm();
}
