/**
 * Desktop-shell bridge — the UI's only knowledge that Electron might be hosting it.
 *
 * The Electron preload (`apps/desktop/preload.cjs`) exposes a tiny frozen object on `window.ascentDesktop`.
 * The WEB build has no such object, so its presence IS the feature flag: nothing here sniffs the user agent
 * for "Electron" (which lies, and would also match anything embedding Chromium).
 *
 * Everything degrades to a no-op in the browser, so callers never need to branch — except when deciding
 * whether to SHOW desktop-only UI, which is what `isDesktop()` is for.
 */

interface DesktopBridge {
  isDesktop: true;
  quit: () => void;
  toggleFullscreen: () => void;
}

const bridge = (): DesktopBridge | undefined =>
  (globalThis as { ascentDesktop?: DesktopBridge }).ascentDesktop;

/** True only when running inside the Electron shell — gate desktop-only controls on this. */
export function isDesktop(): boolean {
  return bridge()?.isDesktop === true;
}

/** Close the game. No-op in the browser (a web page cannot close itself unless it opened itself). */
export function quitGame(): void {
  bridge()?.quit();
}

/** Toggle borderless fullscreen. No-op in the browser — F11 is the browser's own there. */
export function toggleFullscreen(): void {
  bridge()?.toggleFullscreen();
}
