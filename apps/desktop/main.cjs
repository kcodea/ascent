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
const { pathToFileURL } = require('node:url');

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
    fullscreen: true,
    width: 1600,
    height: 950,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#211d27', // the board's dark surround, so the first paint isn't a white flash
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
  return win;
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
