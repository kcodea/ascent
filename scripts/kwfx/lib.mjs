// Shared by the keyword-aura tools (scripts/kwfx/*): serve a built dist, drive headless Chrome over CDP with the real
// GPU, and put a bench build (`VITE_PERF_BENCH=1 npm run build:web`) into a shop with chosen keywords on its cards.
// Never the owner's browser: a throwaway profile, and every request off 127.0.0.1 is failed (no Supabase, no workers).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt; };
export const flag = (name) => process.argv.includes(`--${name}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };

/** Serve `dist` on 127.0.0.1:port. `overlay` (optional) is a second directory checked FIRST, so a candidate asset can
 *  be tried against an existing build without rebuilding. */
export function serve(dist, port, overlay) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    let f = overlay && fs.existsSync(path.join(overlay, rel)) && fs.statSync(path.join(overlay, rel)).isFile() ? path.join(overlay, rel) : path.join(dist, rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r, rej) => { server.once('error', rej); server.listen(port, '127.0.0.1', () => r(server)); });
}

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome found: set CHROME_PATH.');
  return hit;
}

/** Headless Chrome on the machine's real GPU (ANGLE / D3D11), a throwaway profile. Returns a small CDP client. */
export async function launch({ cdpPort = 9552, width = 1920, height = 1080, dpr = 1, gpu = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kwfx-chrome-'));
  const flags = ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${width},${height}`, '--hide-scrollbars'];
  if (gpu) flags.push('--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization');
  const proc = spawn(chromePath(), [...flags, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try { ws = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
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
  const off = (method, h) => { handlers.set(method, (handlers.get(method) || []).filter((x) => x !== h)); };
  const close = () => { try { sock.close(); } catch { /* closed */ } proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ } }, 1500); };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expression).catch(() => false)) return true; await sleep(200); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable', { timeDomain: 'timeTicks' });
  // Nothing leaves the machine.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  on('Fetch.requestPaused', (p) => {
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url);
    void (local ? send('Fetch.continueRequest', { requestId: p.requestId }) : send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
  });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
  return { send, on, off, close, ev, waitFor, profile };
}

const G = `window.__bench.store.getState()`;

/** Title -> a Practice game against bots (no network) -> the first shop. */
export async function toShop(c, { url, hero = 'nadja', seed = 424242, initJs = '' } = {}) {
  if (initJs) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: initJs });
  await c.send('Page.navigate', { url });
  if (!(await c.waitFor(`!!window.__bench && !document.getElementById('bootsplash') && [...document.querySelectorAll('button,[role=button]')].some((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === 'PLAY')`, 120000))) throw new Error('no __bench: is this a VITE_PERF_BENCH=1 build?');
  await sleep(2500);
  await c.ev(`(() => { const s = ${G}; s.startPractice(); s.setPracticeDraft({ godMode: false, opponents: 'bots', botDifficulty: 10, health: 'unlimited', timeMult: 0, heroes: 'all' }); })()`);
  await sleep(600);
  await c.ev(`${G}.confirmPracticeSetup()`);
  if (!(await c.waitFor(`(${G}.heroChoices || []).length > 0 && !!document.querySelector('[class*=hero]')`, 20000))) { await shot(c, 'kwfx-fail.png'); throw new Error('no hero select (see kwfx-fail.png)'); }
  await c.ev(`window.__bench.store.setState({ pendingSeed: ${seed} })`);
  await sleep(1200);
  const h = (await c.ev(`(${G}.heroChoices || []).includes(${JSON.stringify(hero)})`)) ? hero : await c.ev(`(${G}.heroChoices || [])[0] || null`);
  await c.ev(`${G}.pickHero(${JSON.stringify(h)})`);
  const inShop = `document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0`;
  for (let i = 0; i < 80 && !(await c.ev(inShop)); i++) {
    await c.ev(`(() => { const b = document.querySelector('.hsc-start') || [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Play anyway'); if (b) b.click(); })()`);
    await sleep(500);
  }
  if (!(await c.ev(inShop))) throw new Error('never reached the first shop');
  await sleep(2500);
}

/** Fill the board (7) and the hand with real minions (bought + played once, then kept as the base) and give every one
 *  `keywords` (null = each card's own), or `perCard[i % n]`. A bench-only write on a throwaway Practice run. */
export async function setScene(c, { keywords = null, hand = 7, board = 7, perCard = null } = {}) {
  await c.ev(`(async () => {
    const st = window.__bench.store; const S = () => st.getState();
    if (!window.__kwBase) {
      // Buy real minions (so every instance has the shape the reducer makes) into a pool, then seat them by a state write.
      const pool = [];
      for (let n = 0; n < 120 && pool.length < 14; n++) {
        st.setState((x) => ({ run: { ...x.run, embers: 999, hand: [] } }));
        const defs = window.__bench.combat.cards; const offer = (S().run.shop || []).find((o) => o && o.uid && defs[o.cardId] && typeof defs[o.cardId].attack === 'number' && typeof defs[o.cardId].health === 'number');
        if (!offer) { S().dispatch({ type: 'roll' }); continue; }
        S().dispatch({ type: 'buy', uid: offer.uid });
        const got = S().run.hand[0];
        if (got && typeof got.attack === 'number') pool.push(got); else S().dispatch({ type: 'roll' });
      }
      window.__kwBase = { board: pool.slice(0, 7), hand: pool.slice(7, 14) };
      st.setState((x) => ({ run: { ...x.run, discover: null } }));
    }
    const kws = ${JSON.stringify(keywords)}; const per = ${JSON.stringify(perCard)};
    const base = window.__kwBase;
    const up = (m, i) => (kws || per ? { ...m, keywords: per ? per[i % per.length] : kws } : m);
    st.setState((x) => ({ run: { ...x.run, board: base.board.slice(0, ${board}).map(up), hand: base.hand.slice(0, ${hand}).map((m, i) => up(m, i + 7)) } }));
  })()`);
  await sleep(1500);
  return c.ev(`({ board: ${G}.run.board.length, hand: ${G}.run.hand.length, phase: ${G}.run.phase })`);
}

/** The compositor's layer tree, briefly. */
export async function layerCensus(c) {
  let tree = null; let done;
  const got = new Promise((res) => { done = res; });
  const h = (p) => { if (p.layers) { tree = p.layers; done(); } };
  c.on('LayerTree.layerTreeDidChange', h);
  await c.send('LayerTree.enable').catch(() => {});
  await Promise.race([got, sleep(2500)]);
  await c.send('LayerTree.disable').catch(() => {});
  c.off('LayerTree.layerTreeDidChange', h);
  if (!tree) return null;
  const drawing = tree.filter((l) => l.drawsContent);
  return { layers: tree.length, drawing: drawing.length, mpx: +(drawing.reduce((n, l) => n + l.width * l.height, 0) / 1e6).toFixed(2) };
}

const METRIC_KEYS = ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'];
const metrics = async (c) => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.filter((m) => METRIC_KEYS.includes(m.name)).map((m) => [m.name, m.value * 1000]));

/** Idle for `ms`: frame intervals from a rAF recorder (mean, p95, worst, % over the 240 Hz and 160 Hz budgets) and the
 *  main thread's work per second (all tasks, and the style share). */
export async function idleSample(c, ms = 4000) {
  const m0 = await metrics(c);
  const t = await c.ev(`new Promise((res) => { const out = []; let last = 0; const t0 = performance.now(); const tick = (now) => { if (last) out.push(now - last); last = now; if (now - t0 < ${ms}) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); })`);
  const m1 = await metrics(c);
  const s = [...t].sort((a, b) => a - b); const n = s.length || 1;
  const mean = t.reduce((a, b) => a + b, 0) / n;
  return {
    frames: t.length, mean: +mean.toFixed(2), p50: +s[Math.floor(n * 0.5)].toFixed(2), p95: +s[Math.floor(n * 0.95)].toFixed(2), worst: +s[n - 1].toFixed(2),
    over417: +(100 * t.filter((x) => x > 4.17 * 1.25).length / n).toFixed(2), over625: +(100 * t.filter((x) => x > 6.25).length / n).toFixed(2),
    taskMsPerS: +((m1.TaskDuration - m0.TaskDuration) / (ms / 1000)).toFixed(1), styleMsPerS: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) / (ms / 1000)).toFixed(1),
  };
}

export const runningAnimations = (c) => c.ev(`document.getAnimations().filter((a) => a.playState === 'running').length`);

/** A PNG of the page (or `clip`: { x, y, width, height, scale }), transparent where nothing paints when `alpha`. */
export async function shot(c, file, clip, alpha = false) {
  if (alpha) await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const r = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { scale: 1, ...clip } } : {}), captureBeyondViewport: false });
  if (alpha) await c.send('Emulation.setDefaultBackgroundColorOverride', {});
  const buf = Buffer.from(r.data, 'base64');
  if (file) fs.writeFileSync(file, buf);
  return buf;
}

/** Seat a keyworded board that cannot win quickly (0 Attack, a lot of Health), press End Turn and wait for the units:
 *  the fight then lasts as long as the measurement. Returns false when the fight never started. */
export async function toCombat(c, scene) {
  await setScene(c, { ...scene, hand: 0 });
  await c.ev(`window.__bench.store.setState((x) => ({ run: { ...x.run, board: x.run.board.map((m) => ({ ...m, attack: 0, health: 400 })) } }))`);
  await sleep(2500); // the baked pictures land
  for (let i = 0; i < 12 && (await c.ev(`window.__bench.store.getState().run.phase`)) !== 'combat'; i++) {
    const p = await c.ev(`(() => { const b = document.querySelector('.etbwrap'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    if (p) for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await sleep(1200);
  }
  return c.waitFor(`document.querySelectorAll('.unit .card.compact').length >= 8 && !document.body.classList.contains('wipe-up')`, 30000);
}

