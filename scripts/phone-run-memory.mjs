#!/usr/bin/env node
/**
 * PHONE RUN MEMORY (R-TOUCH-RUN-MEMORY-01, owner 2026-10-22: "I still can't even play it because of the crashing").
 *
 * The menu model (phone-menu-memory.mjs) stops at hero select and the Play model (phone-play-memory.mjs) counts audio,
 * WebGL and <img> bytes. Neither walks on into the run. This one does, on a PRODUCTION build in headless Chrome as an
 * iPhone in landscape (852 x 393, DPR 3, iOS UA, touch, coarse pointer, standalone), with REAL taps
 * (Input.dispatchTouchEvent): title -> Play -> the Play tile -> skip the tutorial nudge -> Yes -> the gate's crystal ->
 * hero select -> pick the first hero -> the ceremony -> the first shop. At each step it records:
 *   - JS heap
 *   - decoded images: every complete <img> in the DOM, every CSS background on a rendered element (and its ::before /
 *     ::after), and every Image the page decode()d that is still alive (the preloader's hold), as w x h x 4, de-duped
 *     by URL
 *   - ImageBitmaps alive and 2D canvases (backing stores w x h x 4)
 *   - WebGL contexts alive, their drawing buffers (w x h x 4 x 2) and the texture bytes uploaded into them (Pixi
 *     textures; tracked through texImage2D / texStorage2D / deleteTexture)
 *   - decoded AudioBuffers (length x channels x 4)
 *   - the WebKit LAYER model: every composited layer (Chrome's layer list) at its own size x DPR^2 x 4, clipped to the
 *     visible part; WebGL canvas layers excluded (their buffers are counted above). WebKit pays a layer inside the
 *     scaled stage at its full stage size, Chrome does not, so this is an iOS estimate, not a Chrome number.
 *   - OS private memory of the renderer / GPU / all Chrome processes of this profile (Windows only).
 *
 * Usage: npm run build:web && npm run perf:phone-run [-- --dist apps/web/dist --port 4490 --flags zoom --top 6]
 * Prints a row per step and the biggest layers / images at the steps that matter. Exits 1 when a step's iOS estimate
 * (layers + WebGL buffers + textures + decoded images + audio) is over --budget MB (default 450), or a tap missed.
 * Every request off 127.0.0.1 is blocked, so nothing reaches the live backend.
 *
 * Phone audio (2026-10-23): each row also prints the SFX play stats the phone build exposes (`window.__ascentSfx`):
 * clip plays that found their clip decoded, plays that MISSED it (a synth blip or silence), how many of those were
 * on-demand clips, and the decoded audio the game holds. `--net <kbps>,<ms>` throttles the network (e.g. 9000,60 for
 * a phone on 4G) so the order the art and the sounds arrive in matches a real phone; `--combat-ms` lengthens the
 * first fight (default 5000).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const PORT = Number(arg('port', '4490'));
const CDP_PORT = PORT + 1;
const FLAGS = arg('flags', '');
const TOP = Number(arg('top', '5'));
const BUDGET_MB = Number(arg('budget', '450'));
const W = Number(arg('w', '852')); const H = Number(arg('h', '393')); const DPR = Number(arg('dpr', '3'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Installed before any page script. `window.__runMem()` returns the in-page numbers (async: it sizes CSS images). */
const PROBE = `(() => {
  const MB = 1048576;
  // audio
  const st = { audio: 0 };
  const reg = new FinalizationRegistry((n) => { st.audio -= n; });
  const track = (b) => { if (b) { const n = b.length * b.numberOfChannels * 4; st.audio += n; reg.register(b, n); } return b; };
  if (window.BaseAudioContext) {
    const P = BaseAudioContext.prototype;
    const dec = P.decodeAudioData;
    P.decodeAudioData = function (ab, ok, bad) { return dec.call(this, ab).then((b) => { track(b); ok && ok(b); return b; }, (e) => { bad && bad(e); throw e; }); };
    const cb = P.createBuffer; P.createBuffer = function (...a) { return track(cb.apply(this, a)); };
  }
  // decoded Images held by script (decode() called), ImageBitmaps
  const decoded = [];
  const d0 = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () { decoded.push(new WeakRef(this)); return d0.call(this); };
  const bitmaps = [];
  const cib = window.createImageBitmap;
  if (cib) window.createImageBitmap = function (...a) { return cib.apply(this, a).then((b) => { bitmaps.push(new WeakRef(b)); return b; }); };
  // canvases + WebGL textures
  const gl = []; const c2d = [];
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const c = gc.call(this, t, o);
    if (c && /webgl/.test(t) && !gl.some((m) => m.cv === this)) gl.push({ cv: this, ctx: c, tex: new Map(), bound: new Map(), unit: 0 });
    if (c && t === '2d' && !c2d.some((r) => r.deref() === this)) c2d.push(new WeakRef(this));
    return c;
  };
  const rec = (ctx) => gl.find((m) => m.ctx === ctx);
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!G) continue;
    const P = G.prototype;
    const at = P.activeTexture; P.activeTexture = function (u) { const m = rec(this); if (m) m.unit = u; return at.call(this, u); };
    const bt = P.bindTexture; P.bindTexture = function (target, t) { const m = rec(this); if (m) m.bound.set(m.unit + ':' + target, t); return bt.call(this, target, t); };
    const dt = P.deleteTexture; P.deleteTexture = function (t) { const m = rec(this); if (m) m.tex.delete(t); return dt.call(this, t); };
    const size = (m, target, bytes, level) => { if (!m || level > 0) return; const t = m.bound.get(m.unit + ':' + target); if (t) m.tex.set(t, bytes); };
    const ti = P.texImage2D;
    P.texImage2D = function (...a) {
      const m = rec(this);
      try {
        let w = 0, h = 0;
        if (a.length >= 8) { w = a[3]; h = a[4]; } else { const s = a[5]; w = s && (s.naturalWidth || s.videoWidth || s.displayWidth || s.width) || 0; h = s && (s.naturalHeight || s.videoHeight || s.displayHeight || s.height) || 0; }
        size(m, a[0], w * h * 4, a[1]);
      } catch {}
      return ti.apply(this, a);
    };
    if (P.texStorage2D) { const ts = P.texStorage2D; P.texStorage2D = function (target, levels, fmt, w, h) { size(rec(this), target, w * h * 4 * (levels > 1 ? 1.33 : 1), 0); return ts.call(this, target, levels, fmt, w, h); }; }
  }
  const imgSize = new Map();
  const sizeOf = (u) => {
    if (imgSize.has(u)) return Promise.resolve(imgSize.get(u));
    return new Promise((r) => { const i = new Image(); i.onload = () => { const s = [i.naturalWidth, i.naturalHeight]; imgSize.set(u, s); r(s); }; i.onerror = () => { imgSize.set(u, [0, 0]); r([0, 0]); }; i.src = u; });
  };
  const short = (u) => decodeURIComponent(u).replace(/^.*?\\/\\/[^/]+\\//, '').replace(/-[A-Za-z0-9_-]{8}(\\.\\w+)$/, '$1');
  window.__runMem = async () => {
    const urls = new Map(); // url -> source tag
    for (const i of document.images) if (i.complete && i.naturalWidth && i.currentSrc) { urls.set(i.currentSrc, 'img'); imgSize.set(i.currentSrc, [i.naturalWidth, i.naturalHeight]); }
    for (const e of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(e, pseudo);
        if (cs.display === 'none') continue;
        const bg = cs.backgroundImage;
        if (!bg || bg === 'none' || !bg.includes('url(')) { const bi = cs.borderImageSource; if (!bi || bi === 'none' || !bi.includes('url(')) continue; }
        for (const m of ((bg || '') + ' ' + (cs.borderImageSource || '')).matchAll(/url\\("?([^")]+)"?\\)/g)) if (!/^data:/.test(m[1])) urls.set(new URL(m[1], document.baseURI).href, urls.get(m[1]) || 'css');
      }
    }
    let held = 0;
    for (const r of decoded) { const i = r.deref(); if (i && i.complete && i.naturalWidth) { if (!urls.has(i.currentSrc || i.src)) { urls.set(i.currentSrc || i.src, 'held'); imgSize.set(i.currentSrc || i.src, [i.naturalWidth, i.naturalHeight]); held++; } } }
    const list = [];
    let img = 0;
    for (const [u, src] of urls) { const [w, h] = await sizeOf(u); const b = w * h * 4; img += b; list.push([short(u), w + 'x' + h, +(b / MB).toFixed(1), src]); }
    list.sort((a, b) => b[2] - a[2]);
    let bm = 0, bmN = 0; for (const r of bitmaps) { const b = r.deref(); if (b && b.width) { bm += b.width * b.height * 4; bmN++; } }
    let cv = 0, cvN = 0; for (const r of c2d) { const c = r.deref(); if (c && c.width) { cv += c.width * c.height * 4; cvN++; } }
    const alive = gl.filter((m) => !m.ctx.isContextLost());
    let glBuf = 0, tex = 0;
    for (const m of alive) { glBuf += m.cv.width * m.cv.height * 4 * 2; for (const b of m.tex.values()) tex += b; }
    return {
      heap: (performance.memory ? performance.memory.usedJSHeapSize : 0) / MB,
      imgMB: img / MB, imgN: urls.size, held, imgTop: list,
      bitmapMB: bm / MB, bitmapN: bmN, c2dMB: cv / MB, c2dN: cvN,
      glAlive: alive.length, glMade: gl.length, glBufMB: glBuf / MB, texMB: tex / MB,
      glList: alive.map((m) => (m.cv.className || m.cv.parentElement?.className || '?').split(' ')[0] + ' ' + m.cv.width + 'x' + m.cv.height + ' tex ' + ([...m.tex.values()].reduce((s, b) => s + b, 0) / MB).toFixed(1) + 'MB' + (m.cv.isConnected ? '' : ' (detached)')),
      audioMB: st.audio / MB,
      screen: [...document.querySelectorAll('#root > *, #stage > *')].map((e) => (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName)).filter(Boolean).slice(0, 8).join(','),
    };
  };
})();`;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome found: set CHROME_PATH.');
  return hit;
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let f = path.join(DIST, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

function processMemory(profile) {
  if (process.platform !== 'win32') return null;
  try {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }; "$t $($_.PrivatePageCount)" }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    const m = { renderer: 0, gpu: 0, total: 0 };
    for (const line of out.trim().split(/\r?\n/)) {
      const [t, b] = line.trim().split(' ');
      const mb = Number(b) / 1048576;
      if (!Number.isFinite(mb)) continue;
      m.total += mb;
      if (t === 'renderer') m.renderer = Math.max(m.renderer, mb);
      if (t === 'gpu-process') m.gpu += mb;
    }
    return m;
  } catch { return null; }
}

async function launch(profile) {
  const proc = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--autoplay-policy=user-gesture-required', '--enable-precise-memory-info', 'about:blank'], { stdio: 'ignore' });
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
  return { send, on, close, proc };
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

async function tap(c, target) {
  const pt = await evaluate(c, `(() => { const t = ${JSON.stringify(target)}; let e;
    if (/^[.#]/.test(t)) e = [...document.querySelectorAll(t)].find((x) => x.offsetParent || getComputedStyle(x).position === 'fixed');
    else e = [...document.querySelectorAll('button,[role=button]')].filter((x) => x.offsetParent).find((x) => (x.innerText || '').trim().toUpperCase() === t.toUpperCase());
    if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!pt) return false;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
  await sleep(60);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}

/** The WebKit layer model (see phone-menu-memory.mjs): each composited non-canvas layer at its own size x DPR^2 x 4. */
async function layerModel(c) {
  let layers = null;
  const h = (p) => { if (p.layers) layers = p.layers; };
  c.on('LayerTree.layerTreeDidChange', h);
  await c.send('DOM.getDocument', { depth: 0 });
  await c.send('LayerTree.enable');
  await evaluate(c, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  for (let i = 0; i < 40 && !layers; i++) await sleep(100);
  await c.send('LayerTree.disable').catch(() => {});
  const byId = new Map((layers || []).map((l) => [l.layerId, l]));
  const ps = Number(await evaluate(c, `document.documentElement.getAttribute('data-page-scale')`)) || 1;
  const scaleOf = (l) => { let s = 1; let cur = l; let n = 0; while (cur && n++ < 200) { const t = cur.transform; if (t) s *= Math.hypot(t[0], t[1]); cur = cur.parentLayerId ? byId.get(cur.parentLayerId) : null; } return s; };
  let bytes = 0; const list = [];
  for (const l of layers || []) {
    if (!l.drawsContent) continue;
    const r = await c.send('LayerTree.compositingReasons', { layerId: l.layerId }).catch(() => ({}));
    const why = (r.compositingReasonIds || r.compositingReasons || []).join(',');
    if (/Canvas/i.test(why)) continue;
    let tag = '';
    try { tag = (await c.send('DOM.describeNode', { backendNodeId: l.backendNodeId })).node.localName; } catch { /* pseudo / anonymous */ }
    if (tag === 'canvas') continue; // a canvas layer's contents ARE its drawing buffer (counted under WebGL / 2D)
    const k = scaleOf(l) || 1;
    // THE PAGE SCALE (R-PHONE-PAGESCALE-01): the browser rasterises the page's layers at the page scale (their size on
    // the screen); a layer inside a transformed stage is paid at its full stage size.
    const b = ps < 1
      ? Math.min(l.width * ps, W) * Math.min(l.height * ps, H) * 4 * DPR * DPR
      : Math.min(l.width, W / k) * Math.min(l.height, H / k) * 4 * DPR * DPR;
    bytes += b;
    list.push({ mb: b / 1048576, size: `${Math.round(l.width)}x${Math.round(l.height)}`, why: why.split(',')[0], node: l.backendNodeId });
  }
  list.sort((a, b) => b.mb - a.mb);
  for (const t of list.slice(0, TOP)) {
    try {
      const n = (await c.send('DOM.describeNode', { backendNodeId: t.node })).node; const a = n.attributes || [];
      const ci = a.indexOf('class'); const ii = a.indexOf('id');
      t.el = `${n.localName}${ii >= 0 ? '#' + a[ii + 1] : ''}${ci >= 0 ? '.' + a[ci + 1].trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    } catch { t.el = '(pseudo / anonymous)'; }
  }
  return { mb: bytes / 1048576, n: list.length, top: list.slice(0, TOP) };
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`No build at ${DIST}: run npm run build:web first.`); process.exit(2); }
const server = await serve();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ascent-phone-run-'));
const c = await launch(profile);
const rows = []; let missed = 0;
try {
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('DOM.enable');
  // Page exceptions, so a stalled step can be told apart from a missed tap.
  c.on('Runtime.exceptionThrown', (p) => console.log(`   (page exception: ${String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').split('\n')[0]})`));
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  c.on('Fetch.requestPaused', (p) => {
    const local = /^https?:\/\/127\.0\.0\.1[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url);
    void (local ? c.send('Fetch.continueRequest', { requestId: p.requestId }) : c.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
  });
  const flagJs = FLAGS ? `try { localStorage.setItem('ascent.phonediag.v1', ${JSON.stringify(JSON.stringify(Object.fromEntries(FLAGS.split(',').map((f) => [f, 1]))))}); } catch {}` : '';
  // --css "<rules>": an extra stylesheet, to test which rule holds a layer before changing the source.
  const extraCss = arg('css', '');
  const cssJs = extraCss ? `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.appendChild(s); });` : '';
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE + flagJs + cssJs });
  const net = arg('net', '');
  if (net) {
    const [kbps, ms] = net.split(',').map(Number);
    await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: ms || 0, downloadThroughput: (kbps * 1000) / 8, uploadThroughput: (kbps * 1000) / 8 });
  }
  await c.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }, { name: 'display-mode', value: 'standalone' }] });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  console.log(`Phone run memory (${W}x${H} @${DPR}x, iOS UA, touch, standalone${FLAGS ? `, flags ${FLAGS}` : ''}), build ${DIST}`);
  const detail = new Set((arg('detail', 'heroselect,picked +0.25s,picked +1s,start +0.7s,start +2.5s,shop,gate down,combat')).split(','));
  const sample = async (label, ok = true) => {
    const s = await evaluate(c, 'window.__runMem()');
    s.sfx = await evaluate(c, 'window.__ascentSfx ? window.__ascentSfx() : null');
    const L = await layerModel(c);
    s.os = processMemory(profile);
    s.layers = L;
    s.ios = L.mb + s.glBufMB + s.texMB + s.imgMB + s.audioMB + s.bitmapMB + s.c2dMB;
    rows.push([label, s]);
    if (!ok) missed++;
    console.log(`${(label + (ok ? '' : ' (MISS)')).padEnd(18)} iOS est ${s.ios.toFixed(0).padStart(4)} MB = layers ${L.mb.toFixed(0).padStart(4)} (${String(L.n).padStart(2)})  gl ${s.glAlive}/${s.glMade} buf ${s.glBufMB.toFixed(0).padStart(3)} tex ${s.texMB.toFixed(0).padStart(3)}  img ${s.imgMB.toFixed(0).padStart(4)} (${s.imgN})  audio ${s.audioMB.toFixed(0).padStart(3)}  2d ${s.c2dMB.toFixed(0)} (${s.c2dN})  bmp ${s.bitmapMB.toFixed(0)}  | heap ${s.heap.toFixed(0).padStart(3)}`
      + (s.os ? `  | OS rend ${s.os.renderer.toFixed(0).padStart(4)} gpu ${s.os.gpu.toFixed(0).padStart(4)} all ${s.os.total.toFixed(0).padStart(5)}` : '') + `  [${s.screen}]`
      + (s.sfx ? `
     sfx: ${s.sfx.clips} clips ${s.sfx.decodedMB.toFixed(1)} MB @${s.sfx.rate} Hz, plays ${s.sfx.plays}, missed ${s.sfx.misses} (on demand ${s.sfx.demandMisses})` : ''));
    if (detail.has(label) || args.includes('--all-detail')) {
      for (const t of L.top) console.log(`     layer ${t.mb.toFixed(1).padStart(6)} MB  ${t.size.padEnd(10)} ${t.why.padEnd(28)} ${t.el}`);
      for (const t of s.imgTop.slice(0, TOP)) console.log(`     image ${String(t[2]).padStart(6)} MB  ${t[1].padEnd(10)} ${t[3].padEnd(5)} ${t[0]}`);
      if (s.glList.length) console.log(`     webgl ${s.glList.join(' | ')}`);
    }
    return s;
  };
  const shot = arg('shot', '');
  const snap = async (name) => {
    if (!shot) return;
    const r = await Promise.race([c.send('Page.captureScreenshot', { format: 'png' }), sleep(15000).then(() => null)]);
    if (r) fs.writeFileSync(`${shot}-${name}.png`, Buffer.from(r.data, 'base64')); else console.log(`   (screenshot ${name} timed out)`);
  };
  await sleep(10000);
  // A throttled network (--net) can still be on the loading gate after 10 s: wait for the title's Play.
  for (let i = 0; i < 240 && !(await evaluate(c, `[...document.querySelectorAll('button,[role=button]')].some((x) => x.offsetParent && (x.innerText || '').trim().toUpperCase() === 'PLAY')`)); i++) await sleep(500);
  await sample('title');
  const steps = [
    ['play', 'PLAY', 3000], ['tile', '.modecard.mc-hero', 2500], ['skip-tut', '.tutprompt-skip', 2500],
    ['yes', '.rc-btn-yes', 5000], ['crystal', '.rgate.is-armed .rgate-crystal', 1200],
  ];
  for (const [label, sel, wait] of steps) {
    const ok = await tap(c, sel);
    await sleep(wait);
    await sample(label, ok);
  }
  await sleep(4000);
  await sample('heroselect');
  await snap('heroselect');
  const picked = await tap(c, '.herocard.big');
  // A finer trail right after the pick (2026-10-23: the iPhone died 'after selecting a hero, when the animation should
  // play'). Each sample itself takes a moment, so the labels are the wait before it, not exact wall-clock marks.
  for (const [t, label] of [[250, 'picked +0.25s'], [750, 'picked +1s'], [1000, 'picked +2s'], [2000, 'picked +4s']]) { await sleep(t); await sample(label, picked); }
  await snap('ceremony');
  // The ceremony ends on Start Game.
  let started = false;
  for (let i = 0; i < 20 && !started; i++) { started = await tap(c, '.hsc-start'); if (!started) await sleep(500); }
  for (const [t, label] of [[700, 'start +0.7s'], [1800, 'start +2.5s']]) { await sleep(t); await sample(label, started); }
  // The shop: wait for it (a hero with a turn-1 Discover shows that first; the sample says which screen it is on).
  // Every request off 127.0.0.1 is blocked, so the opponent pool cannot load: take "Play anyway" (bot seats) when the
  // pool gate offers it.
  let anyway = false;
  for (let i = 0; i < 120; i++) {
    if (await evaluate(c, `!!document.querySelector('.shopbar')`)) break;
    if (!anyway && await tap(c, 'Play anyway')) { anyway = true; console.log('   (opponent pool unreachable offline: took Play anyway)'); }
    await sleep(500);
  }
  await sleep(4000);
  await sample('shop');
  await sleep(10000);
  await sample('shop +10s');
  await snap('shop');
  if (args.includes('--interact')) {
    // --interact: buy the first Shop card and play it, with real touch drags (checks the stage geometry end to end).
    const count = () => evaluate(c, `({ hand: document.querySelectorAll('[data-zone="hand"] .card[data-uid]').length, board: document.querySelectorAll('[data-zone="warband"] .row .card[data-uid]').length, shop: document.querySelectorAll('[data-zone="tavern"] .row .card[data-uid]').length })`);
    const centre = (sel) => evaluate(c, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const drag = async (from, to) => {
      if (!from || !to) return false;
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      for (let i = 1; i <= 16; i++) { await sleep(25); await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 16, y: from.y + (to.y - from.y) * i / 16 }] }); }
      await sleep(80);
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(1500);
      return true;
    };
    // A hero with a turn-1 Discover / quest offer opens it over the Shop: take its first choice (heroes are random per run).
    for (let i = 0; i < 6 && await evaluate(c, `!!document.querySelector('.discover-ov')`); i++) {
      if (!await tap(c, '.discover-ov .card') && !await tap(c, '.discover-ov button')) break;
      await sleep(2500);
    }
    const before = await count();
    await drag(await centre('[data-zone="tavern"] .row .card[data-uid]'), await centre('[data-zone="warband"]'));
    const bought = await count();
    await drag(await centre('[data-zone="hand"] .card[data-uid]'), await centre('[data-zone="warband"]'));
    const played = await count();
    console.log(`   interact: before ${JSON.stringify(before)}  after buy ${JSON.stringify(bought)}  after play ${JSON.stringify(played)}`);
    await sample('after buy+play');
    await snap('played');
    // End Turn: the falling gate, then the first fight (FX layers, the gate's crank).
    const ended = await tap(c, '.etbwrap');
    await sleep(1200);
    await sample('gate down', ended);
    await sleep(Number(arg('combat-ms', '5000')));
    await sample('combat', ended); // (no screenshots from here: headless capture hangs while the gate and combat run)
  }
} finally {
  c.close(); server.close();
  await sleep(600);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
const peak = rows.reduce((m, [, s]) => Math.max(m, s.ios), 0);
const lastSfx = rows.length ? rows[rows.length - 1][1].sfx : null;
if (lastSfx) {
  const lag = lastSfx.lagMs.length ? Math.round(lastSfx.lagMs.reduce((a, b) => a + b, 0) / lastSfx.lagMs.length) : 0;
  console.log(`SFX: ${lastSfx.plays} plays, ${lastSfx.misses} missed (${lastSfx.demandMisses} on demand), miss to decoded avg ${lag} ms; missed: ${lastSfx.missed.join(', ') || 'none'}`);
}
console.log(`Peak iOS estimate: ${peak.toFixed(0)} MB (budget ${BUDGET_MB} MB)${missed ? `; ${missed} step(s) missed their tap` : ''}`);
// PHONE BUDGETS (R-PHONE-BENCH-01, CI `phone-budgets.yml`): optional ceilings on the peak live WebGL contexts, decoded
// audio and decoded images over the walk, so a regression in any one of them fails before merge.
const peakOf = (k) => rows.reduce((m, [, s]) => Math.max(m, s[k] ?? 0), 0);
const over = [];
for (const [flag, key, unit] of [['max-gl', 'glAlive', ''], ['max-audio', 'audioMB', ' MB'], ['max-img', 'imgMB', ' MB']]) {
  const cap = arg(flag, null);
  if (cap === null) continue;
  const v = peakOf(key);
  console.log(`Peak ${key}: ${v.toFixed(key === 'glAlive' ? 0 : 1)}${unit} (budget ${cap}${unit})`);
  if (v > Number(cap)) over.push(`${key} ${v.toFixed(1)} > ${cap}`);
}
if (over.length) console.log(`OVER BUDGET: ${over.join('; ')}`);
if (args.includes('--json')) fs.writeFileSync(arg('json'), JSON.stringify(rows.map(([l, s]) => ({ step: l, ...s })), null, 1));
if (missed || peak > BUDGET_MB || over.length) process.exit(1);
