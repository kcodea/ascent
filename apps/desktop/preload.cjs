/**
 * Preload — the ONLY bridge between the game and Electron.
 *
 * The renderer runs with `contextIsolation: true` and `nodeIntegration: false` (the game is pure web code and
 * needs no Node), so it cannot reach `ipcRenderer` on its own. This exposes a deliberately tiny, frozen API
 * on `window.ascentDesktop` — nothing here sends page data to the main process or returns anything the page
 * could exploit (`onUpdateReady` takes only a local callback, fed by the main process).
 *
 * Its presence is also the DESKTOP FEATURE FLAG: the web build has no `window.ascentDesktop`, so the UI can
 * feature-detect rather than guess (see `packages/ui/src/desktop.ts`). That's why `isDesktop` is here at all —
 * a truthy marker is more honest than sniffing the user agent for "Electron".
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ascentDesktop', Object.freeze({
  isDesktop: true,
  /** Close the game. The main process quits the app; there is nothing to confirm here — the UI does that. */
  quit: () => ipcRenderer.send('ascent:quit'),
  /** Toggle borderless fullscreen (the shell also binds F11 for this). */
  toggleFullscreen: () => ipcRenderer.send('ascent:toggle-fullscreen'),
  /**
   * Subscribe to "an update finished downloading and installs next launch" (see updater.cjs). The callback gets
   * only the version string the MAIN process sends; nothing from the page reaches the main process. Returns an
   * unsubscribe function.
   */
  onUpdateReady: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, payload) => cb(String(payload?.version ?? ''));
    ipcRenderer.on('ascent:update-ready', listener);
    return () => ipcRenderer.removeListener('ascent:update-ready', listener);
  },
}));
