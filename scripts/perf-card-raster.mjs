#!/usr/bin/env node
/**
 * CARD RASTER BENCH (perf/card-raster, 2026-11-18). One late-game recruit state (tier 6, a full board with milestone
 * stats, a full hand, a full shop), then the inputs that re-raster cards: BUY, REFRESH, a STAT TICK, SELL and PLAY,
 * each repeated, on a PRODUCTION bench bundle (`VITE_PERF_BENCH=1`) in headless Chrome with hardware GL.
 *
 *   node scripts/perf-card-raster.mjs --dist <bench dist> [--port 5251] [--reps 12] [--cycles 2]
 *        [--variants file.json]   [{ "name": "...", "css": "..." }]: each is an injected stylesheet; scenes run once per
 *                                 variant per cycle, variants interleaved (base, v1, v2, base, v1, v2), so drift on a
 *                                 busy machine lands on every variant alike
 *        [--trace]                trace each variant's scenes and report the GPU process main thread's raster time
 *        [--dump out.json]        computed filter / shadow / mask / blend on every card of each zone, every descendant
 *        [--shots dir --tag x]    screenshots of the recruit screen, three hover previews and a drag at DPR 1 and 2
 *        [--out file.json]        the numbers
 * Never the owner's browser: a throwaway profile, every request off 127.0.0.1 blocked.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIST = path.resolve(arg('dist', 'apps/web/dist')); const PORT = Number(arg('port', '5251')); const CDP = Number(arg('cdp', String(9300 + (process.pid % 600))));
const REPS = Number(arg('reps', '12')); const CYCLES = Number(arg('cycles', '2')); const W = Number(arg('w', '1920')), H = Number(arg('h', '1080'));
const VARIANTS = [{ name: 'base', css: '' }, ...(arg('variants', '') ? JSON.parse(fs.readFileSync(arg('variants'), 'utf8')) : [])];
const log = (...a) => console.log(...a);

function serve(dist, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r, rej) => { server.once('error', rej); server.listen(port, '127.0.0.1', () => r(server)); });
}
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const hit = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome found: set CHROME_PATH.'); return hit;
}
async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-chrome-'));
  const flags = ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${W},${H}`,
    ...(flag('swgl') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'])];
  const proc = spawn(chromePath(), [...flags, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 360 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up */ } if (!ws) await sleep(250); }
  if (!ws) { proc.kill(); throw new Error('Chrome did not start'); }
  const sock = new WebSocket(ws); await new Promise((r) => sock.addEventListener('open', r));
  let id = 0; const pending = new Map(); const handlers = new Map();
  sock.addEventListener('message', (m) => { let msg; try { msg = JSON.parse(m.data); } catch { return; } // a torn trace chunk is dropped, not fatal
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.rej(new Error(JSON.stringify(msg.error))); else p.res(msg.result); } else if (msg.method) for (const h of handlers.get(msg.method) || []) h(msg.params); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
  const on = (method, h) => { handlers.set(method, [...(handlers.get(method) || []), h]); };
  return { send, on, close: () => { try { sock.close(); } catch { /* closed */ } proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* busy */ } }, 1500); } };
}
const PROBE = `(() => { const cap = 1 << 20; const t = new Float64Array(cap); let n = 0; const tick = (now) => { if (n < cap) t[n++] = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const marks = []; window.__pcr = { mark: (s) => { marks.push([performance.now(), s]); }, dump: () => ({ t: Array.from(t.subarray(0, n)), marks }) }; })();`;

/** The late-game state, built through the game's own actions (buy / play / upgrade / roll), then the stats written. */
const BUILD_STATE = `(async () => {
  const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState(); const C = window.__bench.combat.cards;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gold = () => st.setState((s) => ({ run: { ...s.run, embers: 999, goldSpentThisTurn: -99999 } }));
  const settle = async () => { for (let n = 0; n < 20 && sim.modalOpen(S().run); n++) { const run = S().run;
      if (run.discover) { const opts = Array.isArray(run.discover) ? run.discover : (run.discover.options || run.discover.cards || []); S().dispatch({ type: 'discover', index: Math.floor(Math.max(1, opts.length) / 2) }); }
      else { const a = sim.DEFAULT_BOT.act(run); if (!a || a.type === 'faceOmen') break; S().dispatch(a); }
      if (S().run === run) break; await wait(120); } };
  window.__pcrSettle = settle; window.__pcrGold = gold;
  await settle();
  for (let i = 0; i < 8 && S().run.tier < 6; i++) { gold(); S().dispatch({ type: 'upgrade' }); await wait(80); await settle(); }
  const owned = () => new Set([...S().run.board, ...S().run.hand].map((c) => c.cardId));
  let stuck = 0;
  for (let i = 0; i < 260 && stuck < 12 && (S().run.board.length < 7 || S().run.hand.length < 10); i++) {
    gold(); const run = S().run; const have = owned();
    const hm = run.board.length < 7 ? run.hand.find((c) => !C[c.cardId]?.spell) : null;
    if (hm) { S().dispatch({ type: 'play', uid: hm.uid, toIndex: run.board.length }); await wait(120); await settle(); if (S().run.board.length === run.board.length) { stuck++; S().dispatch({ type: 'sell', uid: hm.uid }); await wait(60); } continue; }
    const pick = run.shop.find((c) => !have.has(c.cardId) && (run.board.length < 7 ? !C[c.cardId]?.spell : true));
    if (!pick) { S().dispatch({ type: 'roll' }); await wait(60); await settle(); continue; }
    S().dispatch({ type: 'buy', uid: pick.uid }); await wait(80); await settle();
  }
  gold(); S().dispatch({ type: 'roll' }); await wait(200); await settle();
  // Late-game numbers: every milestone tier on the board, two Gilded bodies, buffed hand cards.
  const A = [60, 180, 640, 2400, 6100, 950, 320], Hh = [75, 210, 520, 3100, 5400, 1250, 90];
  st.setState((s) => ({ run: { ...s.run, embers: 999, goldSpentThisTurn: -99999,
    board: s.run.board.map((b, i) => ({ ...b, attack: A[i % 7], health: Hh[i % 7], golden: i === 1 || i === 4 ? true : b.golden })),
    hand: s.run.hand.map((b, i) => (C[b.cardId]?.spell ? b : { ...b, attack: b.attack + i * 37, health: b.health + i * 53, golden: i === 2 ? true : b.golden })) } }));
  await wait(600);
  const r = S().run; return { tier: r.tier, board: r.board.map((b) => b.cardId + (b.golden ? '*' : '') + ' [' + b.keywords.join(',') + ']'), hand: r.hand.map((b) => b.cardId), shop: r.shop.map((b) => b.cardId), wave: r.wave };
})()`;

function stats(iv) {
  if (!iv.length) return null; const s = [...iv].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: iv.length, mean: +(iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(1),
    over417: +(100 * iv.filter((x) => x > 4.6).length / iv.length).toFixed(1), over625: +(100 * iv.filter((x) => x > 6.25).length / iv.length).toFixed(1), over167: iv.filter((x) => x > 16.7).length };
}
/** GPU process main thread: busy ms and raster ms (self time of the raster flush / deserialise events) in a trace. */
function gpuSummary(evs) {
  const pname = new Map(); const tname = new Map();
  for (const e of evs) { if (e.ph === 'M' && e.name === 'process_name') pname.set(e.pid, e.args?.name); if (e.ph === 'M' && e.name === 'thread_name') tname.set(e.pid + ':' + e.tid, e.args?.name); }
  const gpuMain = (e) => pname.get(e.pid) === 'GPU Process' && /CrGpuMain/.test(tname.get(e.pid + ':' + e.tid) || '');
  const xs = evs.filter((e) => e.ph === 'X' && typeof e.dur === 'number' && gpuMain(e)).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  if (!xs.length) return null;
  const stack = []; const self = new Map(); let busy = 0;
  for (const e of xs) { while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop(); if (stack.length) stack[stack.length - 1].rec.self -= e.dur; else busy += e.dur; const rec = { self: e.dur, name: e.name }; e.__r = rec; stack.push({ end: e.ts + e.dur, rec }); }
  for (const e of xs) self.set(e.name, (self.get(e.name) || 0) + Math.max(0, e.__r.self));
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, +(v / 1000).toFixed(1)]);
  const raster = [...self.entries()].filter(([k]) => /Raster|Deserialize|Flush|OOPR|PaintOp/i.test(k)).reduce((a, [, v]) => a + v, 0);
  const span = (xs[xs.length - 1].ts + xs[xs.length - 1].dur - xs[0].ts) / 1000;
  // Image work anywhere (decode / upload / transfer cache), by event name: is a re-raster paying for its images again?
  const img = new Map();
  for (const e of evs) { if ((e.ph !== 'X' && e.ph !== 'B' && e.ph !== 'i' && e.ph !== 'I') || !/decode|upload|transfercache|CreateLockedEntry|DeleteEntry/i.test(e.name || '')) continue; const k = (pname.get(e.pid) || e.pid) + ' | ' + e.name; const o = img.get(k) || [0, 0]; o[0]++; o[1] += (e.dur || 0) / 1000; img.set(k, o); }
  const images = [...img.entries()].sort((x, y) => y[1][1] - x[1][1] || y[1][0] - x[1][0]).slice(0, 10).map(([k, [n, ms]]) => [k, n, +ms.toFixed(1)]);
  return { spanMs: Math.round(span), busyMs: +(busy / 1000).toFixed(1), rasterMs: +(raster / 1000).toFixed(1), top, images };
}

const DUMP = `(() => {
  const PROPS = ['filter', 'backdropFilter', 'boxShadow', 'textShadow', 'maskImage', 'mixBlendMode', 'willChange', 'contain', 'clipPath'];
  const DEF = { filter: 'none', backdropFilter: 'none', boxShadow: 'none', textShadow: 'none', maskImage: 'none', mixBlendMode: 'normal', willChange: 'auto', contain: 'none', clipPath: 'none' };
  const out = {};
  const one = (root, label) => { const rows = []; const all = [root, ...root.querySelectorAll('*')];
    for (const e of all) for (const pseudo of [null, '::before', '::after']) { const cs = getComputedStyle(e, pseudo); if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue; if (cs.display === 'none') continue;
      const hit = {}; for (const p of PROPS) if (cs[p] && cs[p] !== DEF[p]) hit[p] = cs[p]; if (!Object.keys(hit).length) continue;
      const r = e.getBoundingClientRect(); rows.push({ el: e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className : e.className.baseVal || '').trim().split(/\\s+/).join('.') + (pseudo || ''), w: Math.round(r.width), h: Math.round(r.height), op: cs.opacity, ...hit }); }
    const r = root.getBoundingClientRect(); out[label] = { cls: root.className, w: +r.width.toFixed(1), h: +r.height.toFixed(1), nodes: all.length, rows }; };
  for (const z of ['tavern', 'warband', 'hand']) { const cards = [...document.querySelectorAll('[data-zone="' + z + '"] .card[data-uid]')].filter((e) => e.getClientRects().length); cards.forEach((c, i) => one(c, z + '#' + i)); }
  const pv = document.querySelector('.cardref'); if (pv) one(pv, 'preview');
  return out; })()`;

async function main() {
  const server = await serve(DIST, PORT); const c = await launch();
  const ev = async (expression) => { const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
  const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
    await c.send('Network.setBlockedURLs', { urls: ['*supabase.co*', '*supabase.in*', '*workers.dev*'] });
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    const g = 'window.__bench.store.getState()';
    const click = async (sel) => { const p = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); if (!p) return false; await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(40); await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(40); await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); return true; };
    if (!(await waitFor(`!!window.__bench && !document.getElementById('bootsplash') && [...document.querySelectorAll('button,[role=button]')].some((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === 'PLAY')`, 180_000))) { log('DEBUG ' + await ev(`JSON.stringify({ bench: !!window.__bench, splash: !!document.getElementById('bootsplash'), text: (document.body.innerText || '').slice(0, 300), btns: [...document.querySelectorAll('button,[role=button]')].filter((x) => x.getClientRects().length).map((x) => (x.innerText || '').trim()).slice(0, 12) })`).catch((e) => String(e))); throw new Error('title not reached (is this a VITE_PERF_BENCH build?)'); }
    await sleep(1500);
    log('GL: ' + await ev(`(() => { try { const gl = document.createElement('canvas').getContext('webgl'); const x = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(x.UNMASKED_RENDERER_WEBGL); } catch (e) { return 'n/a'; } })()`));
    await ev(`(() => { const s = ${g}; s.startPractice(); s.setPracticeDraft({ godMode: false, opponents: 'bots', botDifficulty: 10, health: 'unlimited', timeMult: 0, heroes: 'all', tribes: ${JSON.stringify(arg('tribes', 'dwarf,beast,dragon,undead').split(','))} }); })()`);
    await sleep(600); await ev(`${g}.confirmPracticeSetup()`);
    if (!(await waitFor(`(${g}.heroChoices || []).length > 0 && /Select Your Hero/i.test(document.body.innerText)`, 20_000))) { log('DEBUG ' + await ev(`JSON.stringify({ screen: ${g}.screen, phase: ${g}.phase, keys: Object.keys(${g}).filter((k) => /practice|hero|screen|mode|setup/i.test(k)), text: (document.body.innerText || '').slice(0, 400) })`).catch((e) => String(e))); throw new Error('heroselect not reached'); }
    await ev(`window.__bench.store.setState({ pendingSeed: ${Number(arg('seed', '20261118'))} })`); await sleep(1200);
    { const hero = arg('hero', '') || await ev(`(${g}.heroChoices || [])[0] || null`); if (hero) await ev(`${g}.pickHero(${JSON.stringify(hero)})`); else await click('.herocard.big'); }
    for (let i = 0; i < 20; i++) { if (await click('.hsc-start')) break; await sleep(500); }
    const inShop = `document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0`;
    if (!(await waitFor(inShop, 60_000))) throw new Error('first shop not reached');
    await sleep(2500);
    const state = await ev(BUILD_STATE); log('STATE ' + JSON.stringify(state));
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await sleep(2500);
    await ev(`window.__pcrSnap = ${g}.run`);
    // --css-file: an extra stylesheet for the whole run (what a CSS change would look like, before it is in a build)
    if (arg('css-file', '')) { await ev(`(() => { const s = document.createElement('style'); s.id = 'pcrcss'; s.textContent = ${JSON.stringify(fs.readFileSync(arg('css-file', ''), 'utf8'))}; document.head.appendChild(s); })()`); await sleep(1200); }
    const restore = async () => { await ev(`window.__bench.store.setState({ run: window.__pcrSnap })`); await sleep(350); };

    if (arg('shots', '')) {
      const dir = arg('shots'); const tag = arg('tag', 'x'); fs.mkdirSync(dir, { recursive: true });
      // THE GALLERY: the late state plus two Taunt bodies (one Gilded), so the heater frames are in the picture too.
      // Captured in TWO HALVES (shop + board, then the hand alone): with more than about 20 cards on screen
      // Page.captureScreenshot never returns in this headless Chrome (found 2026-11-18: 4 board + 10 hand + 6 shop
      // captures, 5 + 10 + 6 hangs, and so does anything at DPR 2), so each capture carries a timeout and the run
      // stops on the first one that does not come back.
      const GB = `window.__pcrSnap.board.map((b, i) => (i === 3 || i === 5 ? { ...b, keywords: [...new Set([...b.keywords, 'T'])], golden: i === 5 ? true : b.golden } : b))`;
      const PARTS = { s: `hand: [], board: []`, b: `hand: [], shop: [], board: ${GB}`, h: `board: [], shop: []`, h1: `board: [], shop: [], hand: window.__pcrSnap.hand.slice(0, 5)`, h2: `board: [], shop: [], hand: window.__pcrSnap.hand.slice(5)` };
      const gallery = (part) => ev(`window.__bench.store.setState({ run: { ...window.__pcrSnap, ${PARTS[part]} } })`);
      // A capture waits for a compositor frame, and a fully frozen page never makes one: a 1 px corner element keeps
      // one near-invisible opacity loop running (never frozen) so every capture returns.
      await ev(`(() => { const p = document.createElement('div'); p.id = 'pcr-pump'; p.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483647;pointer-events:none;background:#000;opacity:0.01'; document.body.appendChild(p); p.animate([{ opacity: 0.01 }, { opacity: 0.02 }], { duration: 100, iterations: Infinity, direction: 'alternate' }); })()`);
      const freeze = () => ev(`(() => { document.getAnimations().forEach((a) => { try { if (a.effect && a.effect.target && a.effect.target.id !== 'pcr-pump' && a.effect.getTiming().iterations === Infinity) { a.currentTime = 0; a.pause(); a.__pcr = 1; } } catch (e) {} }); try { window.__bench.gsap.globalTimeline.pause(); } catch (e) {} try { window.__bench.pixiFx.setPaused(true); } catch (e) {} })()`);
      const thaw = () => ev(`(() => { document.getAnimations().forEach((a) => { try { if (a.__pcr) a.play(); } catch (e) {} }); try { window.__bench.gsap.globalTimeline.resume(); } catch (e) {} try { window.__bench.pixiFx.setPaused(false); } catch (e) {} })()`);
      const SHOT_DPRS = arg('dprs', '1,2').split(',').map(Number);
      const move = (x, y, extra = {}) => c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, ...extra });
      for (const dpr of SHOT_DPRS) {
        await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false }); await sleep(2500);
        const shot = async (name) => { await freeze(); await sleep(350);
          const r = await Promise.race([c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }), sleep(20000).then(() => null)]);
          if (!r) throw new Error(`capture ${name}@${dpr}x did not return (too much on screen for this headless Chrome)`);
          fs.writeFileSync(path.join(dir, `${tag}-${name}@${dpr}x.png`), Buffer.from(r.data, 'base64')); await thaw(); log(`   shot ${name}@${dpr}x`); };
        const rectOf = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
        const cardRects = () => ev(`(() => { const o = {}; for (const z of ['tavern', 'warband', 'hand']) o[z] = [...document.querySelectorAll('[data-zone="' + z + '"] .card[data-uid]')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); return o; })()`);
        const all = { extra: {}, byShot: {} };
        for (const part of (dpr > 1 ? arg('parts2', 's,b,h1,h2') : arg('parts', 's,b,h')).split(',')) {
          await gallery(part); await move(5, 5); await sleep(1800);
          const rects = await cardRects(); all.byShot[`recruit-${part}`] = rects;
          await shot(`recruit-${part}`);
          const hovers = part === 's' ? [['tavern', 2], ['tavern', 5]] : part === 'b' ? [['warband', 1], ['warband', 3], ['warband', 4]] : [['hand', 2]];
          for (const [z, idx] of hovers) { const r = rects[z][Math.min(idx, rects[z].length - 1)]; if (!r) continue; const x = r[0] + r[2] / 2, y = r[1] + r[3] * 0.4; const name = `hover-${part}-${z}${idx}`;
            // The capture is only a hover capture if the card really is :hover (and no drag is live): wiggle until it is.
            const hovered = () => ev(`(() => { const e = [...document.querySelectorAll('[data-zone="${z}"] .card[data-uid]')].filter((c) => c.getClientRects().length)[${Math.min(idx, rects[z].length - 1)}]; return !!e && e.matches(':hover') && !document.body.classList.contains('dragging'); })()`);
            let ok = false;
            for (let tries = 0; tries < 6 && !ok; tries++) { for (let k = 1; k <= 6; k++) { await move(x - 30 + 5 * k + tries, y + tries); await sleep(30); } await sleep(400); ok = await hovered(); }
            if (!ok) log(`   WARNING ${name}@${dpr}x: the card is not :hover (body class "${await ev('document.body.className')}")`);
            await sleep(1200); await freeze(); await sleep(200);
            const ex = { card: [r[0] - 40, r[1] - (z === 'hand' ? 330 : 60), r[2] + 80, r[3] + (z === 'hand' ? 360 : 100)] }; const pv = await rectOf('.cardref'); if (pv) ex.preview = pv; all.extra[name] = ex;
            await shot(name);
            await move(5, 5); await sleep(700); }
          // the same picture again after the hovers: a card that was hovered must be back to its resting pixels
          await sleep(600); all.byShot[`recruit-${part}-after`] = rects; await shot(`recruit-${part}-after`);
          // drag: hold a card mid-air
          if (part !== 's') { const [z, idx] = part === 'b' ? ['warband', 1] : ['hand', 3]; const r = rects[z][idx]; if (r) { const x = r[0] + r[2] / 2, y = r[1] + r[3] * 0.4; const name = `drag-${part}-${z}${idx}`;
            await move(x, y); await sleep(60); await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
            for (let k = 1; k <= 20; k++) { await move(x + 3 * k, y - 7 * k * (z === 'hand' ? 1.6 : 1), { button: 'left', buttons: 1 }); await sleep(16); }
            await sleep(1200); const dc = await rectOf('.dragcard .card'); if (dc) all.extra[name] = { dragcard: dc };
            await shot(name);
            await move(x, y, { button: 'left', buttons: 1 }); await sleep(250); await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(1000);
            await ev('window.__pcrSettle()'); } }
        }
        fs.writeFileSync(path.join(dir, `${tag}-rects@${dpr}x.json`), JSON.stringify(all));
      }
      await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }); await sleep(800);
      await restore();
      log('shots -> ' + dir);
    }
    if (arg('dump', '')) { fs.writeFileSync(arg('dump'), JSON.stringify(await ev(DUMP), null, 1)); log('dump -> ' + arg('dump')); }

    if (flag('hold')) { fs.writeFileSync(arg('cdp-file', '.pcr/cdp-port'), String(CDP)); log('HOLDING: cdp ' + CDP); await new Promise(() => {}); }
    if (flag('no-bench')) return;
    // ---- scenes -------------------------------------------------------------------------------------------------
    const mark = (s) => ev(`window.__pcr.mark(${JSON.stringify(s)})`);
    const traceEvents = []; c.on('Tracing.dataCollected', (p) => { for (const e of p.value) traceEvents.push(e); });
    let traceDone = null; c.on('Tracing.tracingComplete', () => traceDone && traceDone());
    const gpu = {}; const layerRows = {}; let lastLayers = null; c.on('LayerTree.layerTreeDidChange', (p) => { if (p.layers) lastLayers = p.layers; }); await c.send('LayerTree.enable').catch(() => {});
    const scenes = {
      buy: async (tag) => { for (let k = 0; k < REPS; k++) { await restore(); await ev(`window.__bench.store.setState((s) => ({ run: { ...s.run, hand: s.run.hand.slice(0, 8) } }))`); await sleep(300);
          await mark('buy@' + tag); await ev(`(() => { const S = () => ${g}; const C = window.__bench.combat.cards; const m = S().run.shop.find((c) => !C[c.cardId]?.spell) || S().run.shop[0]; S().dispatch({ type: 'buy', uid: m.uid }); })()`); await sleep(500); await mark('ff'); await ev('window.__pcrSettle()'); } },
      refresh: async (tag) => { await restore(); for (let k = 0; k < REPS; k++) { await ev('window.__pcrGold()'); await sleep(250); await mark('refresh@' + tag); await ev(`${g}.dispatch({ type: 'roll' })`); await sleep(500); await mark('ff'); } },
      tick: async (tag) => { await restore(); await mark('tick@' + tag);
        for (let k = 0; k < REPS * 6; k++) { await ev(`window.__bench.store.setState((s) => ({ run: { ...s.run, board: s.run.board.map((b, i) => (i === ${k % 7} ? { ...b, attack: b.attack + 1, health: b.health + 1 } : b)) } }))`); await sleep(70); }
        await sleep(200); await mark('ff'); },
      sellplay: async (tag) => { for (let k = 0; k < Math.ceil(REPS / 2); k++) { await restore(); await mark('sell@' + tag); await ev(`(() => { const S = () => ${g}; const b = S().run.board; S().dispatch({ type: 'sell', uid: b[b.length - 1].uid }); })()`); await sleep(500); await mark('ff'); await ev('window.__pcrSettle()'); await sleep(150);
          const uid = await ev(`(() => { const C = window.__bench.combat.cards; const h = ${g}.run.hand.find((c) => !C[c.cardId]?.spell); return h ? h.uid : null; })()`); if (!uid) continue;
          await mark('play@' + tag); await ev(`(() => { const S = () => ${g}; S().dispatch({ type: 'play', uid: ${JSON.stringify(uid)}, toIndex: S().run.board.length }); })()`); await sleep(500); await mark('ff'); await ev('window.__pcrSettle()'); } },
      idle: async (tag) => { await restore(); await sleep(400); await mark('idle@' + tag); await sleep(2000); await mark('ff'); },
    };
    const only = arg('scenes', '') ? arg('scenes').split(',') : Object.keys(scenes);
    for (let cy = 0; cy < CYCLES; cy++) for (const v of VARIANTS) {
      await ev(`(() => { document.getElementById('pcrvar')?.remove(); const css = ${JSON.stringify(v.css)}; if (css) { const s = document.createElement('style'); s.id = 'pcrvar'; s.textContent = css; document.head.appendChild(s); } })()`);
      await restore(); await sleep(900);
      if (lastLayers) { const dc = lastLayers.filter((l) => l.drawsContent); (layerRows[v.name] ||= []).push([lastLayers.length, dc.length, +(dc.reduce((a, l) => a + l.width * l.height, 0) / 1e6).toFixed(2)]); }
      if (flag('trace')) { traceEvents.length = 0; await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'gpu', 'viz', 'cc', 'blink', 'disabled-by-default-gpu.service', ...(flag('trace-images') ? ['disabled-by-default-cc.debug', 'disabled-by-default-devtools.timeline'] : []), '__metadata'] } }); }
      for (const s of only) await scenes[s](v.name);
      if (flag('trace')) { const done = new Promise((r) => { traceDone = r; }); await c.send('Tracing.end'); await done; (gpu[v.name] ||= []).push(gpuSummary(traceEvents)); traceEvents.length = 0; }
      log(`cycle ${cy + 1}/${CYCLES} ${v.name} done`);
    }
    const { t, marks } = await ev('window.__pcr.dump()');
    const by = {};
    for (let i = 0; i < marks.length; i++) { const [at, name] = marks[i]; if (name === 'ff') continue; const end = i + 1 < marks.length ? marks[i + 1][0] : Infinity; const iv = []; for (let k = 1; k < t.length; k++) if (t[k] > at && t[k] <= end) iv.push(t[k] - t[k - 1]); (by[name] ||= []).push(iv); }
    const res = {};
    for (const [name, lists] of Object.entries(by)) { const [scene, variant] = name.split('@'); const half = Math.ceil(lists.length / 2);
      (res[scene] ||= {})[variant] = { ...stats(lists.flat()), halves: [lists.slice(0, half).flat(), lists.slice(half).flat()].map((h) => { const s = stats(h); return s ? [s.mean, s.over625] : null; }) }; }
    log('\nscene      variant                    n    mean    p50    p95    p99    max  >4.17%  >6.25%  >16.7 | halves (mean, >6.25%)');
    for (const [scene, vs] of Object.entries(res)) for (const [variant, s] of Object.entries(vs)) log(`${scene.padEnd(10)} ${variant.padEnd(22)} ${String(s.n).padStart(5)} ${String(s.mean).padStart(7)} ${String(s.p50).padStart(6)} ${String(s.p95).padStart(6)} ${String(s.p99).padStart(6)} ${String(s.max).padStart(6)} ${String(s.over417).padStart(7)} ${String(s.over625).padStart(7)} ${String(s.over167).padStart(6)} | ${JSON.stringify(s.halves)}`);
    if (flag('trace')) { log('\nGPU process main thread per variant pass (all scenes): busy ms / raster ms'); for (const [v, list] of Object.entries(gpu)) log(`  ${v.padEnd(22)} ${list.map((x) => (x ? `${x.busyMs} / ${x.rasterMs} (span ${x.spanMs})` : 'n/a')).join('   ')}\n      top: ${JSON.stringify(list[0]?.top)}\n      image events [name, count, ms]: ${JSON.stringify(list[0]?.images)}`); }
    log(String.fromCharCode(10) + 'layers per variant [all, drawing, Mpx]: ' + JSON.stringify(layerRows));
    if (arg('out', '')) fs.writeFileSync(arg('out'), JSON.stringify({ state, res, gpu, layerRows }, null, 1));
  } finally { c.close(); server.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
