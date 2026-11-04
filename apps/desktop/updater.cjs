/**
 * The shell's self-update (electron-updater, generic provider on GitHub Releases).
 *
 * Updates install ONLY AT LAUNCH, never mid-session (so an update can never land mid-lobby):
 *   - BOOT (the normal launch): open the game, then 10 s later check for a newer release and download it quietly
 *     (main process only, so it can never hitch a frame). When it finishes, write `pending-update.json` ({ version })
 *     in userData and tell the game (`ascent:update-ready`) so it can say "installs next time you start".
 *   - INSTALL (a newer version is pending): before the game loads, show `updating.html` ("Installing update vX…"),
 *     re-check (the cached download is re-validated, not re-fetched) and `quitAndInstall` silently with a relaunch.
 *     On an error, "nothing to install", or 60 s with no download, give up: clear the marker and boot the game.
 *     It never hangs and never shows the player an error.
 *
 * OFF unless every one of these holds (`updatesAllowed`): UPDATES_ENABLED, a packaged app, not the smoke test,
 * ASCENT_NO_UPDATE !== '1', and `resources/app-update.yml` exists. electron-builder writes that file only for the NSIS
 * install, so the hand-packaged zip exe (`npm run release:desktop`) can never self-update. Off → just open the game.
 *
 * The feed comes from app-update.yml (`…/releases/latest/download`); `ASCENT_UPDATE_URL` overrides it (testing only).
 * Every side effect is injectable so `updater.test.ts` drives this with fakes and fake timers.
 */
const path = require('node:path');

/** One switch for the whole updater (a Steam build flips it: Steam updates the game itself). */
const UPDATES_ENABLED = true;
const MARKER_FILE = 'pending-update.json';
const CHECK_DELAY_MS = 10_000;
const INSTALL_TIMEOUT_MS = 60_000;

/** Parse `1.2.3-pre.4` (leading `v` tolerated). Null when it is not a semver. */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Semver precedence: true when `a` is strictly newer than `b`. A pre-release sorts before its release. */
function isNewer(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
  if (!x.pre.length || !y.pre.length) return !x.pre.length && y.pre.length > 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return false; // fewer identifiers = lower precedence
    if (q === undefined) return true;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q);
    if (pn !== qn) return !pn; // numeric identifiers sort below alphanumeric ones
    return p > q;
  }
  return false;
}

/** 'install' only when a pending marker names a version newer than the one running. */
function decideLaunch(marker, current) {
  return marker && typeof marker.version === 'string' && isNewer(marker.version, current) ? 'install' : 'boot';
}

/** The R8 gate. */
function updatesAllowed({ isPackaged, env, hasUpdateConfig }) {
  return UPDATES_ENABLED && !!isPackaged && env.ASCENT_SMOKE !== '1' && env.ASCENT_NO_UPDATE !== '1' && !!hasUpdateConfig;
}

/**
 * Called at app-ready instead of opening the game window directly.
 * @param {object} deps
 * @param {import('electron').App} deps.app
 * @param {typeof import('electron').BrowserWindow} deps.BrowserWindow
 * @param {() => import('electron').BrowserWindow} deps.createGameWindow
 * @param {object} deps.windowOptions BrowserWindow options for the installing window (the game's, own preload).
 * @param {string} deps.updatingHtml absolute path of updating.html
 * Injectable for tests: autoUpdater, fs, env, resourcesPath.
 */
async function startUpdater(deps) {
  const { app, BrowserWindow, createGameWindow } = deps;
  const fs = deps.fs ?? require('node:fs');
  const env = deps.env ?? process.env;
  const resourcesPath = deps.resourcesPath ?? process.resourcesPath;

  const hasUpdateConfig = !!resourcesPath && fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
  if (!updatesAllowed({ isPackaged: app.isPackaged, env, hasUpdateConfig })) {
    createGameWindow();
    return;
  }

  const userData = app.getPath('userData');
  const markerPath = path.join(userData, MARKER_FILE);
  const logPath = path.join(userData, 'updater.log');
  const log = (level, msg) => {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    try { fs.appendFileSync(logPath, line); } catch { /* logging must never break launch */ }
  };
  const clearMarker = () => { try { fs.rmSync(markerPath, { force: true }); } catch (e) { log('warn', `clear marker: ${e}`); } };

  let marker = null;
  try { if (fs.existsSync(markerPath)) marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch (e) { log('warn', `bad marker: ${e}`); }

  let autoUpdater;
  try {
    autoUpdater = deps.autoUpdater ?? require('electron-updater').autoUpdater;
    autoUpdater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false; // install only at launch, never mid-session
    if (env.ASCENT_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: env.ASCENT_UPDATE_URL });
  } catch (e) {
    log('error', `updater init failed: ${e}`);
    clearMarker();
    createGameWindow();
    return;
  }
  const check = () => {
    try {
      // checkForUpdates rejects AND emits 'error' on failure; the listener handles it, so swallow the rejection.
      void Promise.resolve(autoUpdater.checkForUpdates()).catch((e) => log('warn', `check: ${e?.message ?? e}`));
    } catch (e) { log('warn', `check threw: ${e}`); }
  };

  const current = app.getVersion();
  if (decideLaunch(marker, current) === 'install') {
    runInstall({ BrowserWindow, createGameWindow, autoUpdater, deps, version: marker.version, clearMarker, log, check });
    return;
  }

  // BOOT. Any marker left here names a version already installed (or older): stale.
  if (marker) clearMarker();
  const gameWin = createGameWindow();
  autoUpdater.on('error', (e) => log('warn', `boot: ${e?.message ?? e}`));
  autoUpdater.on('update-downloaded', (info) => {
    const version = String(info?.version ?? '');
    log('info', `downloaded ${version}; installs next launch`);
    try { fs.writeFileSync(markerPath, JSON.stringify({ version })); } catch (e) { log('error', `write marker: ${e}`); return; }
    if (gameWin && !gameWin.isDestroyed()) gameWin.webContents.send('ascent:update-ready', { version });
  });
  setTimeout(check, CHECK_DELAY_MS);
}

function runInstall({ BrowserWindow, createGameWindow, autoUpdater, deps, version, clearMarker, log, check }) {
  log('info', `installing pending ${version}`);
  const win = new BrowserWindow(deps.windowOptions);
  win.once('ready-to-show', () => win.show());
  void Promise.resolve(win.loadFile(deps.updatingHtml, { query: { v: version } })).catch((e) => log('warn', `load updating.html: ${e}`));

  let settled = false;
  const giveUp = (why) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    log('warn', `install gave up (${why}); booting the game`);
    clearMarker();
    // Open the game BEFORE closing this window, or window-all-closed would quit the app in between.
    createGameWindow();
    if (!win.isDestroyed()) win.close();
  };
  const timer = setTimeout(() => giveUp('timeout'), INSTALL_TIMEOUT_MS);

  autoUpdater.on('download-progress', (p) => {
    if (settled || win.isDestroyed()) return;
    win.webContents.send('ascent:update-progress', { percent: Number(p?.percent) || 0 });
  });
  autoUpdater.on('update-downloaded', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    log('info', 'downloaded; quitAndInstall');
    if (!win.isDestroyed()) win.webContents.send('ascent:update-progress', { percent: 100 });
    // Defer a tick so the event finishes dispatching before the app starts quitting.
    setTimeout(() => {
      try { autoUpdater.quitAndInstall(true, true); } catch (e) { settled = false; giveUp(`quitAndInstall: ${e}`); }
    }, 0);
  });
  autoUpdater.on('update-not-available', () => giveUp('not available'));
  autoUpdater.on('error', (e) => giveUp(`error: ${e?.message ?? e}`));
  check();
}

module.exports = { UPDATES_ENABLED, isNewer, decideLaunch, updatesAllowed, startUpdater };
