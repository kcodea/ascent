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
 *     The attempt is counted in the marker before quitting, and a 15 s watchdog catches a quit that never happens,
 *     so a failing installer can never trap the player (2 tries per version, then boot). Never shows an error.
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
const SKIP_FILE = 'skipped-update.json';
const CHECK_DELAY_MS = 10_000;
const INSTALL_TIMEOUT_MS = 60_000;
/** After quitAndInstall the app should be gone within moments; if it is still here, the install did not start. */
const QUIT_WATCHDOG_MS = 15_000;
/** Install tries per pending version (the first + one retry). A marker that used them up is dropped at launch. */
const MAX_INSTALL_ATTEMPTS = 2;

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

/**
 * 'install' only when a pending marker names a version newer than the one running AND it has not used up its
 * install attempts. `marker.attempts` is written just before each quitAndInstall; if the installer then fails after
 * the app quit (Defender, a locked file, a full disk), the next launch still runs the OLD version and sees the count.
 * Exhausted → 'boot' (the caller clears the marker and the boot path re-downloads), so a broken install can never
 * lock the player out of the game.
 * `skip` (optional, from skipped-update.json): a version whose install already failed twice is never installed again;
 * only a strictly newer one is.
 */
function decideLaunch(marker, current, skip = null) {
  if (!marker || typeof marker.version !== 'string' || !isNewer(marker.version, current)) return 'boot';
  if (isSkipped(marker.version, skip)) return 'boot';
  return attemptsExhausted(marker) ? 'boot' : 'install';
}

function attemptsExhausted(marker) {
  return (Number(marker?.attempts) || 0) >= MAX_INSTALL_ATTEMPTS;
}

/** True when `version` is the skipped one (or older). A garbage/missing skip skips nothing. */
function isSkipped(version, skip) {
  if (!skip || typeof skip.version !== 'string' || !parse(skip.version)) return false;
  return !isNewer(version, skip.version);
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
  // R11: a version whose install failed twice is skipped until a strictly newer one ships (stops the boot/try/try cycle).
  const skipPath = path.join(userData, SKIP_FILE);
  let skip = null;
  try { if (fs.existsSync(skipPath)) skip = JSON.parse(fs.readFileSync(skipPath, 'utf8')); } catch (e) { log('warn', `bad skip file: ${e}`); }
  if (!skip || typeof skip !== 'object') skip = null;

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

  /** The boot behaviour for a finished download: record it for next launch and tell the game (if it is open). */
  const recordDownload = (getGameWin) => (info) => {
    const version = String(info?.version ?? '');
    if (isSkipped(version, skip)) { log('info', `downloaded ${version}, but it is skipped (install failed twice); ignoring`); return; }
    if (skip) { log('info', `${version} is newer than skipped ${skip.version}; clearing the skip`); skip = null; try { fs.rmSync(skipPath, { force: true }); } catch (e) { log('warn', `clear skip: ${e}`); } }
    log('info', `downloaded ${version}; installs next launch`);
    try { fs.writeFileSync(markerPath, JSON.stringify({ version })); } catch (e) { log('error', `write marker: ${e}`); return; }
    const gameWin = getGameWin();
    if (gameWin && !gameWin.isDestroyed()) gameWin.webContents.send('ascent:update-ready', { version });
  };

  const current = app.getVersion();
  if (decideLaunch(marker, current, skip) === 'install') {
    runInstall({ BrowserWindow, createGameWindow, autoUpdater, deps, marker, fs, markerPath, clearMarker, log, check, recordDownload });
    return;
  }

  // BOOT. Any marker left here names a version already installed (or older), or one whose install attempts ran out.
  if (marker) {
    log('info', `dropping marker ${JSON.stringify(marker)} (running ${current})`);
    if (typeof marker.version === 'string' && isNewer(marker.version, current) && attemptsExhausted(marker) && !isSkipped(marker.version, skip)) {
      skip = { version: marker.version };
      log('warn', `install of ${marker.version} failed ${MAX_INSTALL_ATTEMPTS} times; skipping it until a newer version ships`);
      try { fs.writeFileSync(skipPath, JSON.stringify(skip)); } catch (e) { log('error', `write skip: ${e}`); }
    }
    clearMarker();
  }
  const gameWin = createGameWindow();
  autoUpdater.on('error', (e) => log('warn', `boot: ${e?.message ?? e}`));
  autoUpdater.on('update-downloaded', recordDownload(() => gameWin));
  setTimeout(check, CHECK_DELAY_MS);
}

function runInstall({ BrowserWindow, createGameWindow, autoUpdater, deps, marker, fs, markerPath, clearMarker, log, check, recordDownload }) {
  const { version } = marker;
  log('info', `installing pending ${version} (previous attempts: ${Number(marker.attempts) || 0})`);
  const win = new BrowserWindow(deps.windowOptions);
  win.once('ready-to-show', () => win.show());
  void Promise.resolve(win.loadFile(deps.updatingHtml, { query: { v: version } })).catch((e) => log('warn', `load updating.html: ${e}`));

  // 'waiting' (for the download) → 'installing' (quitAndInstall called, the app should quit) → 'gaveUp'.
  // NB quitAndInstall NEVER throws on failure in electron-updater 6.x: it emits 'error' and returns (BaseUpdater.install),
  // or spawns the installer and returns true. So failure is detected by that 'error' or by the watchdog below.
  let phase = 'waiting';
  let gameWin = null;
  let watchdog = null;
  const giveUp = (why) => {
    if (phase === 'gaveUp') return;
    phase = 'gaveUp';
    clearTimeout(timer);
    clearTimeout(watchdog);
    log('warn', `install gave up (${why}); booting the game`);
    clearMarker();
    // A download that outlives the timeout still counts: record it for next launch, exactly as the boot path does.
    autoUpdater.on('update-downloaded', recordDownload(() => gameWin));
    // Open the game BEFORE closing this window, or window-all-closed would quit the app in between.
    gameWin = createGameWindow();
    if (!win.isDestroyed()) win.close();
  };
  const timer = setTimeout(() => giveUp('timeout'), INSTALL_TIMEOUT_MS);

  autoUpdater.on('download-progress', (p) => {
    if (phase !== 'waiting' || win.isDestroyed()) return;
    win.webContents.send('ascent:update-progress', { percent: Number(p?.percent) || 0 });
  });
  autoUpdater.on('update-downloaded', () => {
    if (phase !== 'waiting') return;
    phase = 'installing';
    clearTimeout(timer);
    // Count the attempt BEFORE quitting: if the installer fails after we are gone, the next launch sees it.
    try {
      fs.writeFileSync(markerPath, JSON.stringify({ version, attempts: (Number(marker.attempts) || 0) + 1 }));
    } catch (e) { log('error', `write attempt: ${e}`); }
    log('info', 'downloaded; quitAndInstall');
    if (!win.isDestroyed()) win.webContents.send('ascent:update-progress', { percent: 100 });
    // Defer a tick so the event finishes dispatching before the app starts quitting.
    setTimeout(() => {
      if (phase !== 'installing') return;
      watchdog = setTimeout(() => giveUp('still running after quitAndInstall'), QUIT_WATCHDOG_MS);
      try { autoUpdater.quitAndInstall(true, true); } catch (e) { giveUp(`quitAndInstall threw: ${e}`); }
    }, 0);
  });
  autoUpdater.on('update-not-available', () => { if (phase === 'waiting') giveUp('not available'); });
  autoUpdater.on('error', (e) => { if (phase !== 'gaveUp') giveUp(`error: ${e?.message ?? e}`); });
  check();
}

module.exports = { UPDATES_ENABLED, MAX_INSTALL_ATTEMPTS, isNewer, decideLaunch, isSkipped, updatesAllowed, startUpdater };
