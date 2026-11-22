/**
 * DESKTOP CRASH REPORTS (R-CRASH-REPORT-DESKTOP-01, owner 2026-11-22, ahead of the Steam invite-only playtest).
 *
 * The renderer cannot report its own death: when it crashes, runs out of memory or is killed, nothing in the page runs.
 * The MAIN process sees it (`render-process-gone`, `child-process-gone`, a renderer that stops answering, its own
 * uncaught exceptions), so it writes a small report to `<userData>/crash-reports.json`. The NEXT game session's page
 * takes the file over through the preload (`ascentDesktop.takeCrashReports`, which deletes it as it answers) and sends
 * the reports through the same pipeline and table as every other client report (packages/ui/src/errorReport.ts). No
 * network code here: the main process never talks to the backend.
 *
 * After a renderer crash the game window is not left white: the player is asked to reload it (or quit).
 *
 * Small by design: at most MAX_REPORTS reports in the file (the newest), each field capped, the player's home folder
 * scrubbed from paths. Every function here is pure or takes its fs / dialog / clock, so the tests need no Electron.
 */
const MAX_REPORTS = 10;
const MAX_TEXT = 2000;
const FILE_NAME = 'crash-reports.json';
const KINDS = new Set(['renderer-gone', 'child-gone', 'renderer-hang', 'main-exception', 'main-rejection']);

/** The player's user name out of a path (`C:\Users\<name>\…`, `/home/<name>/…`, `/Users/<name>/…`). */
function scrubPaths(s) {
  return String(s ?? '')
    .replace(/([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s'"]+/gi, '$1~')
    .replace(/(\/(?:Users|home)\/)[^/\s'"]+/g, '$1~');
}
const text = (v, max = MAX_TEXT) => (v === undefined || v === null || v === '' ? undefined : scrubPaths(v).slice(0, max));
const number = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A short id for a report (time + counter: unique enough within one file, no randomness needed). */
let seq = 0;
function reportId(now) { seq = (seq + 1) % 1000; return `${now.toString(36)}${seq.toString(36)}`; }

/**
 * Pure: one report. `fields` carries the event's own facts (reason, exitCode, processType, serviceName, name, message,
 * stack); `meta` the shell's (app, os, mem, uptimeS). Undefined fields are left out.
 */
function makeReport(kind, fields, meta, now) {
  if (!KINDS.has(kind)) throw new Error(`unknown crash report kind ${kind}`);
  const f = fields ?? {};
  const r = {
    id: reportId(now), at: now, kind,
    reason: text(f.reason, 40), exitCode: number(f.exitCode), processType: text(f.processType, 40),
    serviceName: text(f.serviceName, 80), name: text(f.name, 80), message: text(f.message, 300), stack: text(f.stack),
    app: meta?.app, os: meta?.os, mem: meta?.mem, uptimeS: number(meta?.uptimeS),
  };
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}

/** Pure: the reports in a file's text ([] for a missing, empty or broken file). */
function parseReports(raw) {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((r) => r && typeof r === 'object' && KINDS.has(r.kind) && typeof r.id === 'string').slice(-MAX_REPORTS) : [];
  } catch { return []; }
}

/** Add a report to the file (the newest MAX_REPORTS kept). Synchronous: a main process about to die must not lose it.
 *  Never throws. */
function appendReport(file, report, fsx) {
  try {
    let raw = null;
    try { raw = fsx.readFileSync(file, 'utf8'); } catch { raw = null; }
    const list = [...parseReports(raw), report].slice(-MAX_REPORTS);
    fsx.writeFileSync(file, JSON.stringify(list));
    return true;
  } catch { return false; }
}

/** Hand the reports over ONCE: read them and delete the file. Never throws; [] when there is nothing. */
function takeReports(file, fsx) {
  let raw = null;
  try { raw = fsx.readFileSync(file, 'utf8'); } catch { return []; }
  try { fsx.unlinkSync(file); } catch { /* could not delete: they may be sent again, the page dedupes by id */ }
  return parseReports(raw);
}

/** Should a `render-process-gone` / `child-process-gone` be recorded? Not a clean exit, and not while the app quits
 *  (Chromium kills its helpers on the way out). */
function worthRecording(details, quitting) {
  return !quitting && !!details && details.reason !== 'clean-exit';
}

/** The "the game stopped" dialog after a renderer crash (no em dashes: player text). */
function reloadDialogOptions(reason) {
  const why = reason === 'oom' ? 'The game ran out of memory and stopped.' : 'The game stopped unexpectedly.';
  return {
    type: 'warning',
    title: 'ASCENT',
    message: why,
    detail: 'Reload to keep playing. A crash report will be sent the next time the game loads, to help us fix it.',
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}

/**
 * After the game window's renderer died: ask, then reload the window (or quit). Never leaves a white window without a
 * choice. `deps`: { dialog, app, createWindow }. Resolves to what it did.
 */
async function promptReload(win, reason, deps) {
  try {
    const opts = reloadDialogOptions(reason);
    const res = win && !win.isDestroyed() ? await deps.dialog.showMessageBox(win, opts) : await deps.dialog.showMessageBox(opts);
    if (res.response === 1) { deps.app.quit(); return 'quit'; }
    if (win && !win.isDestroyed()) win.webContents.reload();
    else deps.createWindow();
    return 'reload';
  } catch {
    // The dialog itself failed: reload rather than leave the white window.
    try { if (win && !win.isDestroyed()) win.webContents.reload(); else deps.createWindow(); } catch { /* nothing left to try */ }
    return 'reload';
  }
}

/** The shell's facts every report carries. */
function shellMeta(app, proc, os) {
  let mem;
  try { const m = proc.getSystemMemoryInfo?.(); if (m) mem = { totalMB: Math.round(m.total / 1024), freeMB: Math.round(m.free / 1024) }; } catch { mem = undefined; }
  return {
    app: { version: app.getVersion(), electron: proc.versions?.electron, chrome: proc.versions?.chrome },
    os: { platform: proc.platform, release: os.release(), arch: proc.arch },
    mem,
    uptimeS: Math.round(proc.uptime()),
  };
}

/**
 * Wire it all (main.cjs, once, before app-ready). `deps`: { app, ipcMain, fs, path, os, process, now }. Returns
 * `{ record, watchWindow, setQuitting }`: `watchWindow(win, { onGone })` adds the hang report and the reload prompt to
 * the game window.
 */
function installCrashRecording(deps) {
  const { app, ipcMain, fs, path, os } = deps;
  const proc = deps.process ?? process;
  const now = deps.now ?? (() => Date.now());
  let quitting = false;
  const file = () => path.join(app.getPath('userData'), FILE_NAME);
  const record = (kind, fields) => {
    try { return appendReport(file(), makeReport(kind, fields, shellMeta(app, proc, os), now()), fs); } catch { return false; }
  };
  app.on('before-quit', () => { quitting = true; });
  app.on('render-process-gone', (_e, _wc, details) => {
    if (worthRecording(details, quitting)) record('renderer-gone', { reason: details.reason, exitCode: details.exitCode, processType: 'renderer' });
  });
  app.on('child-process-gone', (_e, details) => {
    if (worthRecording(details, quitting)) record('child-gone', { reason: details.reason, exitCode: details.exitCode, processType: details.type, serviceName: details.serviceName, name: details.name });
  });
  proc.on('uncaughtException', (err) => {
    console.error('[main] uncaught exception', err);
    record('main-exception', { name: err?.name, message: err?.message ?? String(err), stack: err?.stack });
  });
  proc.on('unhandledRejection', (reason) => {
    console.error('[main] unhandled rejection', reason);
    record('main-rejection', { name: reason?.name, message: reason?.message ?? String(reason), stack: reason?.stack });
  });
  ipcMain.handle('ascent:take-crash-reports', () => takeReports(file(), fs));

  let hangRecorded = false;
  const watchWindow = (win, w) => {
    win.on('unresponsive', () => {
      if (hangRecorded || quitting) return; // once a launch: a long hang fires again and again
      hangRecorded = true;
      record('renderer-hang', { processType: 'renderer' });
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      if (!worthRecording(details, quitting)) return;
      w?.onGone?.(details);
    });
  };
  return { record, watchWindow, setQuitting: (q) => { quitting = q; }, file };
}

module.exports = {
  MAX_REPORTS, FILE_NAME, scrubPaths, makeReport, parseReports, appendReport, takeReports, worthRecording,
  reloadDialogOptions, promptReload, shellMeta, installCrashRecording,
};
