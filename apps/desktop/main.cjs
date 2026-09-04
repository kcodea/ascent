/**
 * ASCENT desktop shell (Electron) — a thin wrapper around the SAME production web build that ships to itch.
 * It builds nothing of its own: `apps/web/dist` is served as-is, so what you test here is byte-identical to
 * what players get in the browser.
 *
 * ── Why a custom `app://` protocol instead of `file://` ────────────────────────────────────────────────
 * Loading the bundle over `file://` gives the page a **null origin**, which breaks two things this game
 * actually uses:
 *   - **Supabase** (leaderboard / board sync) — a null-origin request is not a normal CORS origin, and the
 *     browser treats the response as opaque.
 *   - **localStorage partitioning** — a null origin makes the save + every tuner config's persistence
 *     fragile across sessions.
 * `app://ascent/…` is registered as a *standard, secure* scheme, so the renderer gets a real, stable origin
 * with none of that. It costs ~15 lines and removes the whole class of problem up front.
 *
 * The build's `base: './'` (see apps/web/vite.config.ts, set for itch.io's CDN sub-path) is what makes this
 * work unchanged — every asset resolves relative to `app://ascent/`.
 */
const { Menu, app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// ── SMOKE MODE (scripts/release-desktop.mjs) ──────────────────────────────────────────────────────────────
// `ASCENT_SMOKE=1` turns the shell into a self-check of the packaged bundle: a windowed (not fullscreen) boot
// that waits for the boot loader — which preloads EVERY image, font, clip and effect the game will ever show —
// then writes a JSON report to `ASCENT_SMOKE_OUT` and exits non-zero if anything was missing: an `app://`
// asset the handler could not find, a boot stage that failed, a font that failed to load, or an FX def that
// would not fire. The point is that the check runs against the exe's own `resources/dist`, over the exe's own
// protocol handler — the exact code path a player's machine takes — not against a dev server.
const SMOKE = process.env.ASCENT_SMOKE === '1';
const smoke = { requests: 0, missing: [], consoleErrors: [] };

/** The web build. Packaged: copied into resources/ by electron-builder. Dev: read straight from the repo. */
const DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'dist')
  : path.join(__dirname, '..', 'web', 'dist');

// Must run BEFORE app-ready. `standard` gives it a real origin; `secure` puts it in a secure context (Web
// Audio, WebGL and Supabase all behave as they do over https); `supportFetchAPI` lets the bundle's own
// fetch/XHR reach its assets.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Audio starts on the title screen's first interaction anyway, but Chromium's autoplay gate has no meaning
// in a standalone game window — lift it so nothing depends on the gesture landing.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// PERF: keep the Pixi ticker + GSAP running at full rate when the window is not focused. Chromium throttles
// background renderers hard, which would otherwise make an unfocused combat replay crawl.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// No application menu at all. `autoHideMenuBar` still reserves the strip and pops it on Alt — which a game
// does not want, least of all mid-alt-tab — and the default menu binds Ctrl+W / Ctrl+R, both of which are
// hostile in a game window. F11/F12 below replace the only two entries worth keeping.
Menu.setApplicationMenu(null);

function createWindow() {
  const win = new BrowserWindow({
    // BORDERLESS FULLSCREEN by default. Electron's `fullscreen` on Windows is the borderless kind (it does not
    // take an exclusive display mode), which is what a game wants: no chrome, instant alt-tab. The width/height
    // below are the WINDOWED size — what you get after F11 or the Fullscreen toggle, never the initial state.
    fullscreen: !SMOKE,
    width: 1600,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#211d27', // the board's dark surround, so the first paint isn't a white flash
    // Taskbar / alt-tab / window icon. NB this does NOT set the .exe's own icon in Explorer — that is
    // embedded in the PE by rcedit, which is electron-builder's job and cannot run here (see
    // scripts/package-desktop.mjs on the Defender false positive).
    icon: path.join(__dirname, 'icon.png'),
    show: false, // revealed on ready-to-show to avoid a blank window while the bundle boots
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false, // the game is pure web code — it needs no Node, so don't hand it any
      backgroundThrottling: false, // pairs with the switches above
    },
  });

  // F11 escapes fullscreen — without it a borderless-fullscreen default is a trap (no title bar to click, and
  // Esc belongs to the in-game menu). F12 opens DevTools, which the removed menu used to provide and which a
  // test build genuinely wants. Handled before the page sees the key so nothing can swallow them.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.once('ready-to-show', () => win.show());
  // External links (itch, GitHub) open in the real browser rather than hijacking the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL('app://ascent/index.html');
  if (SMOKE) runSmoke(win);
  return win;
}

/** Poll for the boot report, gather the failure evidence, write it, exit. Never hangs: hard cap at 4 minutes. */
function runSmoke(win) {
  const started = Date.now();
  const finish = async (timedOut) => {
    let boot = null;
    let fontErrors = [];
    try {
      boot = await win.webContents.executeJavaScript('window.__boot ? JSON.parse(JSON.stringify(window.__boot)) : null', true);
      fontErrors = await win.webContents.executeJavaScript(
        "Array.from(document.fonts).filter((f) => f.status === 'error').map((f) => f.family + ' ' + f.weight)", true);
    } catch (e) { smoke.consoleErrors.push(`executeJavaScript failed: ${e}`); }
    const stages = boot?.stages ?? {};
    const stageFail = Object.values(stages).some((st) => !st.ok);
    const warmFailed = boot?.warmAll?.first?.failed ?? [];
    const ok = !timedOut && !!boot && !stageFail && smoke.missing.length === 0 && fontErrors.length === 0 && warmFailed.length === 0;
    const report = { ok, timedOut, ms: Date.now() - started, boot, warmFailed, fontErrors, requests: smoke.requests, missing: smoke.missing, consoleErrors: smoke.consoleErrors };
    const out = process.env.ASCENT_SMOKE_OUT;
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
    else console.log(JSON.stringify(report, null, 2));
    app.exit(ok ? 0 : 1);
  };
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) smoke.consoleErrors.push(message); // 3 = error
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => { smoke.consoleErrors.push(`did-fail-load ${code} ${desc}`); void finish(false); });
  const poll = setInterval(async () => {
    if (Date.now() - started > 4 * 60_000) { clearInterval(poll); return finish(true); }
    let done = false;
    try { done = await win.webContents.executeJavaScript('!!window.__boot', true); } catch { /* not loaded yet */ }
    if (done) {
      clearInterval(poll);
      // Give the fire-everything pass + font loads a beat to settle their final requests before reading.
      setTimeout(() => void finish(false), 1500);
    }
  }, 500);
}

// The renderer's only two levers (see preload.cjs). `quit` is what Settings → Quit game calls; the UI owns
// the confirmation, so by the time this fires the player has already double-tapped.
ipcMain.on('ascent:quit', () => app.quit());
ipcMain.on('ascent:toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.setFullScreen(!win.isFullScreen());
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = pathname === '/' || pathname === '' ? '/index.html' : decodeURIComponent(pathname);
    const target = path.normalize(path.join(DIST, rel));
    // Path-traversal guard: a crafted `app://ascent/../../…` must not escape the bundle.
    if (!target.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    // A request for a file the bundle does not contain is a real 404 (not a protocol error), and in smoke
    // mode it is recorded — this is the authoritative "every asset the game asked for exists" check.
    if (!fs.existsSync(target)) {
      if (SMOKE) smoke.missing.push(rel);
      return new Response('Not Found', { status: 404 });
    }
    if (SMOKE) smoke.requests++;
    return net.fetch(pathToFileURL(target).toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
