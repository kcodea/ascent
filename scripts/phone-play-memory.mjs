#!/usr/bin/env node
/**
 * PHONE PLAY MEMORY (R-TOUCH-PLAY-MEMORY-01, owner report 2026-10-18: on a recent iPhone, from the Home Screen icon,
 * pressing PLAY crashed the page twice in a row and Safari showed "A problem repeatedly occurred").
 *
 * The menu-layer model (phone-menu-memory.mjs) clicks with element.click(), which is not a user gesture: no touchend,
 * so the iOS audio unlock never ran and nothing gesture-driven was ever measured. This script presses Play with a REAL
 * touch (Input.dispatchTouchEvent) on a production build in headless Chrome as an iPhone (932 x 430, DPR 3, iOS UA,
 * touch, coarse pointer), and samples, from the title through 15 s after the press:
 *   - decoded audio bytes (every AudioBuffer the page creates or decodes: length x channels x 4) and live ConvolverNodes
 *   - WebGL contexts and their drawing-buffer bytes
 *   - decoded <img> bytes on the page (naturalWidth x naturalHeight x 4, for every complete image in the DOM)
 *   - JS heap, and the OS private memory of every Chrome process of this profile (renderer, GPU, total)
 *
 * Usage: npm run build:web && npm run perf:phone-play [-- --dist apps/web/dist --port 4480 --query art=lite --budget 160]
 * Exits 1 when the decoded audio after the press is over --budget MB (default 96). Every request off 127.0.0.1 is
 * blocked, so nothing reaches the live backend (no anonymous sign-in, no uploads).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const PORT = Number(arg('port', '4480'));
const CDP_PORT = PORT + 1;
const QUERY = arg('query', '');
const BUDGET_MB = Number(arg('budget', '96'));
const FULL = args.includes('--full');
// --detail prints the decoded clips and the WebGL canvases; --crashtest crashes the page after Play and reads the crash log.
const W = 932; const H = 430; const DPR = 3;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Installed before any page script: counts what the page decodes / builds. Read back as `window.__mem()`. */
const PROBE = `(() => {
  window.__glStacks = [];
  const st = { audio: 0, buffers: 0, conv: 0, convBytes: 0, gl: [], byUrl: [] };
  const abUrl = new WeakMap();
  const ra = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function () { const u = this.url; return ra.call(this).then((ab) => { abUrl.set(ab, u); return ab; }); };
  const bufBytes = (b) => (b ? b.length * b.numberOfChannels * 4 : 0);
  const reg = new FinalizationRegistry((n) => { st.audio -= n; st.buffers--; });
  const track = (b) => { if (b) { const n = bufBytes(b); st.audio += n; st.buffers++; reg.register(b, n); } return b; };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const P = BaseAudioContext.prototype;
    const dec = P.decodeAudioData;
    P.decodeAudioData = function (ab, ok, bad) { const u = abUrl.get(ab) || '?'; return dec.call(this, ab).then((b) => { track(b); st.byUrl.push([u.split('/').slice(-2).join('/'), +(bufBytes(b) / 1048576).toFixed(2)]); ok && ok(b); return b; }, (e) => { bad && bad(e); throw e; }); };
    const cb = P.createBuffer;
    P.createBuffer = function (...a) { return track(cb.apply(this, a)); };
    const cc = P.createConvolver;
    const creg = new FinalizationRegistry(() => { st.conv--; });
    P.createConvolver = function () { const c = cc.call(this); st.conv++; creg.register(c, 0); return c; };
  }
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const c = gc.call(this, t, o);
    if (c && /webgl/.test(t) && !st.gl.includes(this)) { st.gl.push(this); if (window.__glStacks) window.__glStacks.push((new Error().stack || '').split(String.fromCharCode(10)).slice(2, 7).map((l) => l.trim().replace(/https?:[^ ]*[/]/, '')).join(' < ')); }
    return c;
  };
  window.__memDetail = () => ({
    top: st.byUrl.slice().sort((a, b) => b[1] - a[1]).slice(0, 12),
    groups: st.byUrl.reduce((g, [u, mb]) => { const k = u.split('/')[0]; g[k] = +((g[k] || 0) + mb).toFixed(1); return g; }, {}),
    stacks: window.__glStacks,
    canvases: st.gl.map((c) => { const g = c.getContext('webgl2') || c.getContext('webgl'); const a = g && g.getContextAttributes ? g.getContextAttributes() : {}; return [c.className || c.id || c.parentElement?.className || '?', c.width, c.height, getComputedStyle(c).display, !!(a && a.antialias), c.isConnected]; }),
  });
  window.__mem = () => {
    let img = 0, imgs = 0;
    for (const i of document.images) if (i.complete && i.naturalWidth) { img += i.naturalWidth * i.naturalHeight * 4; imgs++; }
    let glBytes = 0;
    for (const c of st.gl) glBytes += c.width * c.height * 4 * 2;
    const heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
    return { audioMB: st.audio / 1048576, buffers: st.buffers, conv: st.conv, gl: st.gl.length, glMB: glBytes / 1048576, imgMB: img / 1048576, imgs, heapMB: heap / 1048576, sr: window.__sr || 0 };
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'audio/mp4', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let f = path.join(DIST, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

/** OS private bytes of this profile's Chrome processes, by type (Windows only; empty elsewhere). */
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
  return { send, on, close };
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

/** A real tap (touchstart + touchend) at the centre of the first visible element matching `sel` / exact text. */
async function tap(c, target) {
  const pt = await evaluate(c, `(() => { const t = ${JSON.stringify(target)}; let e;
    if (/^[.#]/.test(t)) e = [...document.querySelectorAll(t)].find((x) => x.offsetParent);
    else e = [...document.querySelectorAll('button,[role=button]')].filter((x) => x.offsetParent).find((x) => (x.innerText || '').trim().toUpperCase() === t.toUpperCase());
    if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!pt) return false;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
  await sleep(60);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}

const fmt = (s) => `audio ${s.audioMB.toFixed(1).padStart(6)} MB (${String(s.buffers).padStart(3)} buf, ${s.conv} conv)  gl ${s.gl} ctx ${s.glMB.toFixed(0).padStart(4)} MB  img ${s.imgMB.toFixed(0).padStart(4)} MB (${s.imgs})  heap ${s.heapMB.toFixed(0).padStart(4)} MB`
  + (s.os ? `  | OS renderer ${s.os.renderer.toFixed(0).padStart(5)} MB  gpu ${s.os.gpu.toFixed(0).padStart(5)} MB  all ${s.os.total.toFixed(0).padStart(5)} MB` : '');

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`No build at ${DIST}: run npm run build:web first.`); process.exit(2); }
const server = await serve();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ascent-phone-play-'));
let peakAudio = 0; let tapped = false;
const c = await launch(profile);
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  c.on('Fetch.requestPaused', (p) => {
    const local = /^https?:\/\/127\.0\.0\.1[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url);
    void (local ? c.send('Fetch.continueRequest', { requestId: p.requestId }) : c.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
  });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await c.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }, { name: 'display-mode', value: 'standalone' }] });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${QUERY ? `?${QUERY}` : ''}` });
  console.log(`Phone Play memory (${W}x${H} @${DPR}x, iOS UA, touch${QUERY ? `, ?${QUERY}` : ''}), build ${DIST}`);
  const sample = async (label) => {
    const s = await evaluate(c, 'window.__mem ? window.__mem() : null');
    if (!s) return null;
    s.os = processMemory(profile);
    console.log(`${label.padEnd(14)} ${fmt(s)}`);
    return s;
  };
  await sleep(10000);
  await sample('title');
  tapped = await tap(c, 'PLAY');
  if (!tapped) console.log('MISS: no PLAY plaque on the title');
  let prev = 0;
  for (const t of [1, 2, 3, 5, 8, 12, 15]) {
    await sleep((t - prev) * 1000); prev = t;
    const s = await sample(`play +${t}s`);
    if (s) peakAudio = Math.max(peakAudio, s.audioMB);
  }
  if (FULL) {
    // On into the ranked lobby: the Play tile, the tutorial nudge (a fresh profile is "new"), "Yes, let's go.", the
    // gate's crystal once it is armed, then hero select.
    for (const [step, sel, wait] of [['tile', '.modecard.mc-hero', 2500], ['skip-tut', '.tutprompt-skip', 2500], ['yes', '.rc-btn-yes', 6000], ['crystal', '.rgate.is-armed .rgate-crystal', 4000]]) {
      const ok = await tap(c, sel);
      await sleep(wait);
      await sample(`${step}${ok ? '' : ' (miss)'}`);
    }
    for (const t of [3, 8]) { await sleep(t === 3 ? 3000 : 5000); await sample(`heroselect +${t}s`); }
  }
  if (args.includes('--detail')) console.log(JSON.stringify(await evaluate(c, 'window.__memDetail()'), null, 1));
  if (args.includes('--crashtest')) {
    // Kill the renderer the way iOS would (no pagehide), reload with ?crashlog=1, and read the readout.
    await Promise.race([c.send('Page.crash').catch(() => {}), sleep(2000)]);
    await sleep(1500);
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?crashlog=1` });
    await sleep(9000);
    console.log('crash log readout:', await evaluate(c, `(() => { const e = document.querySelector('.crashlog'); if (!e) return 'NONE'; const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + ' screen px, font ' + getComputedStyle(e).fontSize + ' x stage ' + getComputedStyle(document.documentElement).getPropertyValue('--stage-s') + ': ' + e.innerText; })()`));
  }
  const ctxRate = await evaluate(c, `(() => { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const r = a.sampleRate; a.close(); return r; } catch { return 0; } })()`);
  console.log(`AudioContext sample rate here: ${ctxRate} Hz (an iPhone runs 48000; scale audio by 48000 / ${ctxRate})`);
} finally {
  c.close(); server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
}
console.log(`Peak decoded audio after Play: ${peakAudio.toFixed(1)} MB (budget ${BUDGET_MB} MB)`);
if (!tapped || peakAudio > BUDGET_MB) process.exit(1);
