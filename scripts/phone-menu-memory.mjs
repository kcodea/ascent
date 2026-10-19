#!/usr/bin/env node
/**
 * PHONE MENU MEMORY (R-TOUCH-MENU-MEMORY-01, owner report 2026-10-18: a recent iPhone, opened from the Home Screen
 * icon, showed Safari's "A problem repeatedly occurred" page on the menus, i.e. iOS killed the page for memory).
 *
 * Serves a PRODUCTION build, opens it in headless Chrome as an iPhone in landscape (932 x 430, DPR 3, touch, iOS UA,
 * so the phone art path and the touch UI both engage), visits every menu screen on a fresh page, and prints the
 * per-screen iOS LAYER-MEMORY ESTIMATE. It fails (exit 1) when a screen is over its budget.
 *
 * The estimate models WebKit, not Chrome: iOS rasterizes a composited layer at the layer's OWN size times the device
 * pixel ratio (an ancestor's scale-down does not shrink it), so a layer inside the ~0.4-scaled stage costs its full
 * stage px x 9 x 4 bytes, clipped to the visible part (big layers are tiled). WebGL canvas layers are not counted
 * (their drawing buffers exist whether or not they are composited). Chrome's layer list stands in for WebKit's, so the
 * absolute numbers are a proxy: compare builds, and keep every screen under budget.
 *
 * Usage:  npm run build:web && npm run perf:phone-menus [-- --dist apps/web/dist --port 4470 --only title,versus --flags nofx,res1]
 * Each screen also prints its live WebGL contexts and their drawing buffers (R-TOUCH-GPU-MEMORY-01): the total is the
 * layer estimate plus those buffers.
 * Needs a local Chrome (CHROME_PATH to override). Every request off 127.0.0.1 is blocked, so nothing reaches the live
 * backend (no anonymous sign-in, no uploads).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const PORT = Number(arg('port', '4470'));
const CDP_PORT = PORT + 1;
const W = 932; const H = 430; const DPR = 3;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Per-screen budget in MB of estimated iOS layer memory. Measured 2026-10-18 after the fix: 140 to 295, Practice
 *  292; the Compendium (587) predates the touch UI and is a listed follow-up. Before the fix main measured up to 685. */
const BUDGET_MB = { default: 350, collection: 650 };

/** Each screen: the clicks from the title (exact text, `~prefix` for a mode tile, or a CSS selector). */
const SCREENS = {
  title: [], modes: ['PLAY'], practice: ['PLAY', '~Practice'], versus: ['PLAY', '~Versus'], career: ['PLAY', 'CAREER'],
  leaderboard: ['PLAY', 'LEADERBOARD'], recent: ['PLAY', 'RECENT GAMES'], live: ['PLAY', 'LIVE GAMES'],
  collection: ['.bookbtn'], heroselect: ['PLAY', '.modecard.mc-hero'],
  // The ranked gate, waiting on its crystal (a fresh profile is "new": the tutorial nudge comes first).
  gate: ['PLAY', '.modecard.mc-hero', '.tutprompt-skip', '.rc-btn-yes'],
  // Real hero select: through the gate and its crystal (the `heroselect` path above stops at the tutorial nudge).
  hero: ['PLAY', '.modecard.mc-hero', '.tutprompt-skip', '.rc-btn-yes', '@2500', '.rgate.is-armed .rgate-crystal', '@4000'],
};
/** GPU estimate (R-TOUCH-GPU-MEMORY-01): WebGL contexts still alive (made and not lost, in the page or not) and their
 *  drawing buffers (width x height x 4, x2 for the front and back buffer). Installed before any page script. */
const GL_PROBE = `(() => {
  const made = [];
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const c = gc.call(this, t, o);
    if (c && /webgl/.test(t) && !made.some((m) => m.cv === this)) made.push({ cv: this, gl: c });
    return c;
  };
  window.__gpu = () => {
    const alive = made.filter((m) => !m.gl.isContextLost());
    let bytes = 0;
    for (const m of alive) bytes += m.cv.width * m.cv.height * 4 * 2;
    return { made: made.length, alive: alive.length, mb: bytes / 1048576,
      list: alive.map((m) => (m.cv.className || m.cv.parentElement?.className || '?').split(' ')[0] + ' ' + m.cv.width + 'x' + m.cv.height + (m.cv.isConnected ? '' : ' (detached)')) };
  };
})();`;
/** `--flags nofx,res1,...` presets the phone diagnostics (phoneDiag.ts) before the page loads. */
const FLAGS = arg('flags', '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome found: set CHROME_PATH.');
  return hit;
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let f = path.join(DIST, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

async function launch(profile) {
  const proc = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try { ws = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
    if (!ws) await sleep(250);
  }
  if (!ws) { proc.kill(); throw new Error('Chrome did not start'); }
  const sock = new WebSocket(ws);
  await new Promise((r) => sock.addEventListener('open', r));
  let id = 0; const pending = new Map(); const handlers = new Map();
  sock.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result); }
    else if (msg.method) for (const h of handlers.get(msg.method) || []) h(msg.params);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
  const on = (method, h) => { handlers.set(method, [...(handlers.get(method) || []), h]); };
  const close = () => { try { sock.close(); } catch { /* closed */ } proc.kill(); };
  return { send, on, close };
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

async function measureScreen(name, clicks, profile) {
  const c = await launch(profile);
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('DOM.enable');
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    c.on('Fetch.requestPaused', (p) => {
      const local = /^https?:\/\/127\.0\.0\.1[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url);
      void (local ? c.send('Fetch.continueRequest', { requestId: p.requestId }) : c.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
    });
    await c.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }] });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: GL_PROBE + (FLAGS ? `try { localStorage.setItem('ascent.phonediag.v1', ${JSON.stringify(JSON.stringify(Object.fromEntries(FLAGS.split(',').map((f) => [f, 1]))))}); } catch {}` : '') });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(9000);
    const nav = [];
    for (const t of clicks) {
      if (t.startsWith('@')) { await sleep(Number(t.slice(1))); continue; } // `@ms`: wait longer before the next step
      nav.push(await evaluate(c, `(() => { const t = ${JSON.stringify(t)}; let e;
        if (t.startsWith('~')) e = [...document.querySelectorAll('button,[role=button],.modecard')].filter((x) => x.offsetParent).find((x) => (x.innerText || '').trim().startsWith(t.slice(1)));
        else if (/^[.#]/.test(t)) e = document.querySelector(t);
        else e = [...document.querySelectorAll('button,[role=button],.btn,a,div,span')].filter((x) => x.offsetParent).find((x) => (x.innerText || '').trim().toUpperCase() === t.toUpperCase());
        if (!e) return 'MISS ' + t; e.click(); return 'ok'; })()`));
      await sleep(3000);
    }
    await sleep(1500);
    const touch = await evaluate(c, `document.documentElement.getAttribute('data-touch-ui')`);
    // A fresh layer tree (LayerTree only reports after it is enabled on a live page).
    let layers = null;
    c.on('LayerTree.layerTreeDidChange', (p) => { if (p.layers) layers = p.layers; });
    await c.send('DOM.getDocument', { depth: 0 });
    await c.send('LayerTree.enable');
    await evaluate(c, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    for (let i = 0; i < 40 && !layers; i++) await sleep(100);
    const byId = new Map((layers || []).map((l) => [l.layerId, l]));
    const scaleOf = (l) => { let s = 1; let cur = l; let n = 0; while (cur && n++ < 200) { const t = cur.transform; if (t) s *= Math.hypot(t[0], t[1]); cur = cur.parentLayerId ? byId.get(cur.parentLayerId) : null; } return s; };
    let bytes = 0; const big = [];
    for (const l of layers || []) {
      if (!l.drawsContent) continue;
      const r = await c.send('LayerTree.compositingReasons', { layerId: l.layerId }).catch(() => ({}));
      const why = (r.compositingReasonIds || r.compositingReasons || []).join(',');
      if (/Canvas/.test(why)) continue;
      const k = scaleOf(l);
      const b = Math.min(l.width, W / k) * Math.min(l.height, H / k) * 4 * DPR * DPR;
      bytes += b;
      big.push({ mb: b / 1048576, size: `${Math.round(l.width)}x${Math.round(l.height)}`, why: why.split(',')[0], node: l.backendNodeId });
    }
    big.sort((a, b) => b.mb - a.mb);
    for (const t of big.slice(0, 3)) {
      try {
        const n = (await c.send('DOM.describeNode', { backendNodeId: t.node })).node; const a = n.attributes || [];
        const ci = a.indexOf('class'); const ii = a.indexOf('id');
        t.el = `${n.localName}${ii >= 0 ? '#' + a[ii + 1] : ''}${ci >= 0 ? '.' + a[ci + 1].trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
      } catch { t.el = '?'; }
    }
    // --rects: the on-screen boxes of the main controls (compare a --flags run, e.g. zoom, against a plain one).
    const rects = args.includes('--rects') ? await evaluate(c, `[...document.querySelectorAll('.menubtn, .modecard, .msb, .gearbtn, .titlelogo')].filter((e) => e.offsetParent).slice(0, 12).map((e) => { const r = e.getBoundingClientRect(); return (e.className.split(' ')[0]) + ' ' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(','); })`) : [];
    const gpu = await evaluate(c, 'window.__gpu ? window.__gpu() : null');
    // --anims: the animations still running on the screen (name, target), the usual reason for a lingering layer.
    const anims = args.includes('--anims') ? await evaluate(c, `document.getAnimations().filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty || '?') + ' @ ' + ((a.effect && a.effect.target && (a.effect.target.className || a.effect.target.tagName)) || '?') + (a.effect && a.effect.pseudoElement ? a.effect.pseudoElement : '')).slice(0, 20)`) : [];
    return { mb: bytes / 1048576, layers: big.length, touch, nav, top: big.slice(0, 3), gpu, anims, rects };
  } finally { c.close(); await sleep(400); }
}

const only = arg('only', '');
const names = only ? only.split(',') : Object.keys(SCREENS);
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`No build at ${DIST}: run npm run build:web first.`); process.exit(2); }
const server = await serve();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ascent-phone-mem-'));
let over = 0;
try {
  console.log(`Phone menu layer memory (iOS estimate, ${W}x${H} @${DPR}x), build ${DIST}`);
  for (const name of names) {
    const r = await measureScreen(name, SCREENS[name], path.join(tmp, name));
    const budget = BUDGET_MB[name] ?? BUDGET_MB.default;
    const bad = r.mb > budget || r.touch == null || r.nav.some((n) => n !== 'ok');
    if (bad) over++;
    const g = r.gpu || { alive: 0, made: 0, mb: 0, list: [] };
    console.log(`${bad ? 'OVER' : ' ok '} ${name.padEnd(12)} ${r.mb.toFixed(0).padStart(5)} MB / ${budget} MB  ${String(r.layers).padStart(3)} layers  | WebGL ${g.alive} alive of ${g.made} made, ${g.mb.toFixed(0)} MB  | total ${(r.mb + g.mb).toFixed(0)} MB  touch=${r.touch}  ${r.nav.filter((n) => n !== 'ok').join(' ')}`);
    if (g.list.length) console.log(`        WebGL: ${g.list.join(', ')}`);
    if (r.anims.length) console.log(`        running: ${r.anims.join(', ')}`);
    if (r.rects.length) console.log(`        rects: ${r.rects.join(' | ')}`);
    for (const t of r.top) console.log(`        ${t.mb.toFixed(1).padStart(6)} MB  ${t.size.padEnd(10)} ${t.why}  ${t.el}`);
  }
} finally {
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
if (over) { console.error(`${over} screen(s) over budget (or the touch UI / navigation did not engage).`); process.exit(1); }
