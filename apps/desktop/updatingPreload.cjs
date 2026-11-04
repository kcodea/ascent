/**
 * Preload for the "Installing update…" window ONLY (updating.html, opened by updater.cjs before the game loads).
 * It is separate from preload.cjs so the game never gets this channel and the installing screen never gets the
 * game's levers. Frozen, and it only RECEIVES from the main process: nothing the page does reaches Electron.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ascentUpdating', Object.freeze({
  /** Download progress, 0–100, as the main process reports it. */
  onUpdateProgress: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('ascent:update-progress', (_event, payload) => cb(Number(payload?.percent) || 0));
  },
}));
