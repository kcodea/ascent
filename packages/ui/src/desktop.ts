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

/** Where the shell's launch update check stands (updater.cjs `getUpdateStatus`). */
export interface UpdateStatus {
  state: 'off' | 'checking' | 'current' | 'downloading' | 'ready' | 'error';
  version: string | null;
  percent: number;
}
const NO_STATUS: UpdateStatus = { state: 'off', version: null, percent: 0 };
const STATES: ReadonlySet<string> = new Set(['off', 'checking', 'current', 'downloading', 'ready', 'error']);

interface DesktopBridge {
  isDesktop: true;
  quit: () => void;
  toggleFullscreen: () => void;
  /** Fires with the version once an update has finished downloading. Returns the unsubscribe. */
  onUpdateReady?: (cb: (version: string) => void) => () => void;
  /** The update already downloaded this session (its version), or null. Older shells lack it. */
  getUpdateReady?: () => Promise<string | null>;
  /** Where this launch's update check stands. Older shells lack it. */
  getUpdateStatus?: () => Promise<{ state: string; version: string | null; percent: number }>;
  /** Relaunch to install the downloaded update. Older shells lack it. */
  installUpdate?: () => void;
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

/** Be told when the shell has finished downloading an update (it installs at the next launch). No-op in the browser;
 *  the returned function unsubscribes. */
export function onUpdateReady(cb: (version: string) => void): () => void {
  return bridge()?.onUpdateReady?.(cb) ?? (() => {});
}

/** Ask the shell for an update it has already downloaded this session (null when none, in the browser, or on a shell
 *  too old to answer). The push above fires once and is lost if nothing is listening yet, so a notice asks as well. */
export function getUpdateReady(): Promise<string | null> {
  const ask = bridge()?.getUpdateReady;
  if (!ask) return Promise.resolve(null);
  return Promise.resolve(ask()).then((v) => (v ? String(v) : null), () => null);
}

/** Where the shell's launch update check stands ('off' in the browser, on an older shell, or on any failure). */
export function getUpdateStatus(): Promise<UpdateStatus> {
  const ask = bridge()?.getUpdateStatus;
  if (!ask) return Promise.resolve(NO_STATUS);
  return Promise.resolve(ask()).then(
    (s) => (s && STATES.has(s.state) ? { state: s.state as UpdateStatus['state'], version: s.version ? String(s.version) : null, percent: Number(s.percent) || 0 } : NO_STATUS),
    () => NO_STATUS,
  );
}

/** True when this shell can restart to install a downloaded update (older shells cannot: they install next launch). */
export function canInstallUpdate(): boolean {
  return typeof bridge()?.installUpdate === 'function';
}

/** Restart the app to install the downloaded update. No-op in the browser and on an older shell. */
export function installUpdate(): void {
  bridge()?.installUpdate?.();
}
