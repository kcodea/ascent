#!/usr/bin/env node
/**
 * PERF: APM ON AN ENGINE BOARD (owner 2026-11-18: "the biggest problem to me is when i have a board with cards like
 * Karwind and im playing APM and the game gets bogged down and nearly impossible to play. this needs to be butter
 * smooth."). R-PERF-APM-01.
 *
 * What it does, on a PRODUCTION bench bundle (`VITE_PERF_BENCH=1`) in a real-GPU headless Chrome (ANGLE D3D11, its
 * own throwaway profile, every request off 127.0.0.1 blocked):
 *   1. A seeded Practice game (no clock, bots), Nadja. Through the store, a late-game ENGINE board is built with the
 *      game's own actions (God Mode's print into the shop, buy, triple, play): by default a gilded Karwind ("whenever
 *      a Shout triggers, give your Dragons +4/+4 twice"), Firebird (every Shout casts Dragonflame), Scalechanter
 *      (every Shop spell: Dragons +2/+2), Embermouth, Herzog and Transcendence, a hand of five held cards, Tier 6,
 *      and the Ancient of Bonds awakened (every Gold spent sends buff trails to two minions).
 *   2. THE BURST, by REAL input (CDP mouse events: press, moves, release; a click on Refresh), never a store dispatch:
 *      buy a Shout minion (drag shop -> hand), play it (drag hand -> board), cast what it gave (drag up), sell it
 *      (drag board -> shop), refresh when the shop is empty, at --rate actions a second for --secs seconds. What to do
 *      next is read off the store (no layout); where to click is one rect read per action (timed and reported).
 *      The shop is restocked with the scripted Shout minions inside the same task as the game's own refresh.
 *      The driver is CLOSED-LOOP, like a player: it waits for Chrome to take each mouse event, so a slower page is
 *      driven more slowly. Accepted actions a second is therefore a RESULT; at a rate the page cannot hold, every
 *      build's main thread is saturated, and builds compare on ms per accepted action, not on ms per second.
 *   3. THE TAIL: no input for --tail seconds, to see what is still playing.
 *
 * What it measures, separately:
 *   (a) FRAMES   rAF intervals in the burst and the tail: mean / p50 / p95 / p99 / max, % over the 240 Hz budget
 *                (an interval over 5 ms missed a 4.17 ms frame), % over 6.25, 16.7, 33 ms; long animation frames.
 *   (b) INPUT    per action: pointerdown -> its handler (queueing), pointerup -> the store accepted it,
 *                pointerup -> the first frame after it, and Event Timing's own input -> next paint. Actions that the
 *                game did not accept (a missed pick-up, a refused drop) are counted and listed.
 *   (c) BACKLOG  sampled every 100 ms: stat badges whose printed number is behind the run's real number (and by how
 *                much), live GSAP tweens, live Pixi FX plays, the Shop's paced steps still waiting
 *                (fx/shopFxQueue.ts), pending timeouts, DOM nodes; peak vs idle, growth across the burst, and how
 *                long after the LAST input each one takes to return to idle.
 *   (d) COST     main-thread time from CDP (script / style / layout / all tasks) per second and per accepted action,
 *                and the in-game monitor's labelled spans; --profile a CPU profile (top self time, and who called
 *                the layout natives); --trace a GPU / raster trace summary; --trace-style who forced and who dirtied
 *                style; --per-action what one buy / play / cast / sell / refresh costs.
 *
 * THE MACHINE IS USUALLY SHARED. Every run prints the whole machine's CPU share during its burst. Compare builds
 * ROUND-ROBIN (one run of each, then the next round: `--runs 1 --label <build>-<round>`), never one build's runs
 * after another's.
 *
 * Usage:
 *   npm run perf:apm                         build this working tree, 1 run, print the report
 *   npm run perf:apm -- --runs 3             more runs: the report gives the median and the spread (the machine is shared)
 *   npm run perf:apm -- --dist <dir>         bench an existing VITE_PERF_BENCH dist (skip the build)
 *   npm run perf:apm -- --scene dragons-max  the same board with Orivax (Shouts trigger 2 additional times)
 *   npm run perf:apm -- --rate 8 --secs 30   actions a second, burst length
 *   npm run perf:apm -- --guard              exit 3 when the backlog guard fails (see GUARD below)
 *   npm run perf:apm -- --rapid '{"snapStats":false,"dropStale":false,"dedupe":false,"maxSpeed":1,"minIntensity":1}' --roll-step 0
 *                                            the same bundle with the rapid-input presentation (fx/rapidConfig.ts) switched off
 *   npm run perf:apm -- --toggle nofx        the same run with one cost class switched off: nofx | nofilter | nocardfilter | noanim
 *   npm run perf:apm -- --profile | --trace | --trace-style | --census | --shots <dir> | --headed | --label <name>
 *   npm run perf:apm -- --per-action         before the burst, one action every 1.2 s: what a buy / play / cast / sell / refresh costs
 *   npm run perf:apm -- --screencast <dir>   JPEG frames of five seconds of the burst (a capture to look at, not a measurement)
 *   npm run perf:apm -- --no-priority        do not raise this run's Chrome and driver to High priority (Windows)
 * Exit code: 0 done; 1 the scene could not be built; 2 setup error; 3 the --guard failed.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const ROOT = process.cwd();
const PORT = Number(arg('port', '5255'));
const RUNS = Number(arg('runs', '1'));
const RATE = Number(arg('rate', '6'));
const SECS = Number(arg('secs', '25'));
const TAIL = Number(arg('tail', '6'));
const SEED = Number(arg('seed', '424242'));
const SCENE = arg('scene', 'dragons');
const W = 1920, H = 1080;
const OUT = arg('out', path.join(ROOT, '.perf-apm', 'out'));
const LABEL = arg('label', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/** THE SCENES. `board`: card ids, a trailing * = gilded (bought three times). `shop`: what every refresh offers.
 *  `fillers`: cards held in hand the whole burst (never played). */
const SCENES = {
  // Karwind's board: every played Shout fires Karwind twice, Firebird's Dragonflame (a repeat per Dragon), then
  // Scalechanter on that cast, Embermouth and Herzog on themselves.
  dragons: {
    tribes: ['dragon', 'dwarf', 'kobold'],
    board: ['karwind*', 'd2_firebird', 'd2_scalechanter', 'd2_embermouth', 'd2_herzog', 'd2_transcendence'],
    shop: ['d2_broodfire', 'd2_scalefeather', 'd2_broodfire', 'd2_scalefeather', 'd2_broodfire', 'd2_scalefeather'],
    fillers: ['d2_cinderchef', 'd2_cinderchef', 'd2_chorus', 'd2_chorus', 'd2_mirrorwing'],
  },
  // The same with the multiplier: Orivax makes every Shout trigger two more times.
  'dragons-max': {
    tribes: ['dragon', 'dwarf', 'kobold'],
    board: ['karwind*', 'd2_firebird', 'd2_scalechanter', 'd2_embermouth', 'd2_orivax', 'd2_transcendence'],
    shop: ['d2_broodfire', 'd2_scalefeather', 'd2_broodfire', 'd2_scalefeather', 'd2_broodfire', 'd2_scalefeather'],
    fillers: ['d2_cinderchef', 'd2_cinderchef', 'd2_chorus', 'd2_chorus', 'd2_mirrorwing'],
  },
};
const scene = SCENES[SCENE];
if (!scene) { console.error(`Unknown --scene ${SCENE}. Known: ${Object.keys(SCENES).join(', ')}`); process.exit(2); }
if (arg('board', '')) scene.board = arg('board').split(',');
if (arg('shop', '')) scene.shop = arg('shop').split(',');
const ANCIENT = arg('ancient', 'bonds');
const HERO = arg('hero', 'nadja');

/** --toggle <name[,name]>: applied after the warm-up. Each removes one class of cost, so the run shows what is left
 *  without it (the same toggles as the 2026-11-18 scope measurement, E1). Not a fix: a measuring stick. */
const STY = (css) => `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`;
const TOGGLES = {
  // No Pixi effects at all: the FX overlay is detached, so no effect can start (`canPlayDefs()` is false) and nothing
  // ticks or draws. (Hiding the canvases alone changes nothing: the effects still simulate and render.)
  nofx: `(() => { const p = window.__bench.pixiFx; try { p.detach(); } catch (e) { console.error('nofx', e); } const s = document.createElement('style'); s.textContent = 'canvas { display: none !important; }'; document.head.appendChild(s); })()`,
  // No CSS filter / shadow anywhere (the card raster cost).
  nofilter: STY('*, *::before, *::after { filter: none !important; backdrop-filter: none !important; box-shadow: none !important; text-shadow: none !important; }'),
  // Only the card frame filters and the card shadow.
  nocardfilter: STY('.cshadow { display: none !important } .cframe, .tframe, .msframe, .msglow, .cgem-img { filter: none !important }'),
  // No CSS animation or transition (keyword loops, pops, glides).
  noanim: STY('*, *::before, *::after { animation: none !important; transition: none !important; }'),
};

// GUARD (--guard): the bounds the burst must stay inside. Chosen from the measured numbers in
// docs/devlog/2026-11-18-perf-apm-engine.md, with headroom for a shared machine.
const GUARD = {
  acceptedPct: Number(arg('guard-accepted', '97')),     // % of attempted actions the game accepted
  settleMs: Number(arg('guard-settle', '3500')),        // every backlog counter back to idle this long after the last input
  staleBadgeMs: Number(arg('guard-stale', '1500')),     // the longest any stat badge stayed behind the real number
  growthPct: Number(arg('guard-growth', '60')),         // last third of the burst vs the first third, per counter
};

// ---------------------------------------------------------------------------------------------------------------
// Build / serve / Chrome
// ---------------------------------------------------------------------------------------------------------------
function buildWorking() {
  log('Building this working tree with VITE_PERF_BENCH=1 ...');
  execSync('npm run build:web', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VITE_PERF_BENCH: '1' } });
  return path.join(ROOT, 'apps/web/dist');
}
function serve(dist, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r, rej) => { server.once('error', (e) => rej(new Error(`port ${port} is busy (${e.code}). Pass --port.`))); server.listen(port, '127.0.0.1', () => r(server)); });
}
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome found: set CHROME_PATH.');
  return hit;
}
async function launch(profile) {
  const flags = [
    // Port 0: Chrome picks a free one and writes it to <profile>/DevToolsActivePort (a fixed port collides with a
    // Chrome from the previous run that is still letting go, or with another bench on this machine).
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    `--window-size=${W},${H}`, '--window-position=0,0',
    // A REAL GPU, headless too (the E1 measurement, 2026-11-18): without these headless Chrome falls back to SwiftShader.
    '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  ];
  if (!flag('headed')) flags.unshift('--headless=new');
  const proc = spawn(chromePath(), [...flags, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 240 && !ws; i++) {
    try {
      const cdpPort = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'), 10);
      if (cdpPort) ws = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
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
/**
 * ON A SHARED MACHINE THE BENCH RUNS ABOVE THE CROWD. With other builders' tests and builds holding every core, this
 * Chrome and this driver were starved: a third of the actions and frames that belong to the scheduler, not the game
 * (2026-11-18: 55 actions in 25 s at 100% machine CPU, 130 to 170 when it was quiet). So the driver and every
 * process of this run's Chrome (found by its throwaway profile path) go to HIGH priority: they use about two cores
 * of sixteen and take them first. Windows only; --no-priority turns it off. It changes who gets a core, not what the
 * page costs.
 */
function raisePriority(profile) {
  if (flag('no-priority')) return 'off';
  try { os.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH); } catch { /* not allowed: carry on */ }
  if (process.platform !== 'win32') return 'driver only';
  try {
    const key = path.basename(profile).replace(/'/g, '');
    const ps = `$n = 0; Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${key}*' } | ForEach-Object { try { (Get-Process -Id $_.ProcessId).PriorityClass = 'High'; $n++ } catch {} }; $n`;
    return `${execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30_000 }).trim()} Chrome processes + the driver at High`;
  } catch { return 'failed'; }
}

async function evaluate(c, expression, ms = 120_000) {
  // A page whose main thread is stuck never answers: fail the run with what was asked instead of hanging forever.
  const r = await Promise.race([c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => null)]);
  if (!r) throw new Error(`the page did not answer in ${ms} ms: ${expression.slice(0, 120)}`);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

// ---------------------------------------------------------------------------------------------------------------
// In-page probe (installed before any page script)
// ---------------------------------------------------------------------------------------------------------------
const PROBE = `(() => {
  const cap = 1 << 20;
  const ft = new Float64Array(cap); let fn = 0;
  const tick = (now) => { if (fn < cap) ft[fn++] = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const loaf = []; const evt = []; const longtasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push([e.startTime, e.duration, e.blockingDuration || 0]); }).observe({ type: 'long-animation-frame', buffered: false }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'pointerdown' || e.name === 'pointerup' || e.name === 'click') evt.push([e.name, e.startTime, e.processingStart, e.processingEnd, e.duration]); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch {}
  // Every pointer event the page receives, at the capture phase: [type, hardware time, handler time].
  const input = [];
  for (const t of ['pointerdown', 'pointerup', 'click']) window.addEventListener(t, (e) => { input.push([t, e.timeStamp, performance.now()]); }, true);
  // Live timeouts (a queue of FX timers shows here) and how many were ever scheduled.
  const to = new Set(); let toMade = 0;
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => { let id; const w = typeof fn === 'function' ? (...x) => { to.delete(id); return fn(...x); } : fn; id = st(w, ms, ...a); to.add(id); toMade++; return id; };
  window.clearTimeout = (id) => { to.delete(id); return ct(id); };
  // WebGL draw calls (all contexts) and audio source starts.
  let draws = 0; let sounds = 0;
  try { for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!C) continue; for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const o = C.prototype[m]; if (o) C.prototype[m] = function (...a) { draws++; return o.apply(this, a); }; } } } catch {}
  try { for (const C of [window.AudioBufferSourceNode, window.OscillatorNode]) { if (!C) continue; const P = C.prototype; const o = P.start; P.start = function (...a) { sounds++; return o.apply(this, a); }; } } catch {}
  const marks = []; const storeLog = []; const samples = []; const notes = []; const harness = { n: 0, ms: 0 };
  let sampler = 0; let perfBuckets = [];
  const num = (s) => { const t = (s || '').trim().replace(/,/g, ''); return /^-?\\d+$/.test(t) ? Number(t) : null; };
  const sample = (census) => {
    const b = window.__bench; if (!b) return;
    const run = b.store.getState().run; if (!run) return;
    // Printed stat badges vs the run's real numbers (no layout: text reads only).
    let behind = 0, owed = 0;
    for (const m of run.board) {
      const el = document.querySelector('[data-zone="warband"] .card[data-uid="' + m.uid + '"]'); if (!el) continue;
      const a = num(el.querySelector('.badge.atk .value')?.textContent), h = num(el.querySelector('.badge.hp .value')?.textContent);
      const da = a === null ? 0 : Math.abs(m.attack - a), dh = h === null ? 0 : Math.abs(m.health - h);
      if (da || dh) { behind++; owed += da + dh; }
    }
    let tweens = 0; try { tweens = b.gsap.globalTimeline.getChildren(true, true, false).length; } catch {}
    let plays = 0, particles = 0; try { const lp = b.livePlays(); plays = lp.length; for (const p of lp) particles += p.particles || 0; } catch {}
    let queued = 0, droppedFx = 0, pressure = 0; try { if (b.shopFx) { queued = b.shopFx.pending(); droppedFx = b.shopFx.dropped(); pressure = b.shopFx.pressure(); } } catch {}
    const row = { t: performance.now(), behind, owed, tweens, plays, particles, queued, droppedFx, pressure, timeouts: to.size, nodes: document.getElementsByTagName('*').length, draws, sounds, toMade, floats: document.querySelectorAll('.floatnum, .statfloat, .sellfloat, .bufffloat, .dmgfloat, .goldfloat').length };
    if (census) { try { row.anims = document.getAnimations().length; } catch {} }
    samples.push(row);
  };
  window.__apm = {
    mark: (name) => { marks.push([performance.now(), name]); },
    note: (kind, extra) => { notes.push([performance.now(), kind, extra || null]); },
    harness,
    startSampler: (census) => { if (sampler) return; sampler = setInterval(() => sample(census), 100); },
    stopSampler: () => { clearInterval(sampler); sampler = 0; },
    hookStore: (shopIds) => {
      const b = window.__bench; if (!b || window.__apmHooked) return; window.__apmHooked = true;
      let q = 0; let busy = false; let prev = b.store.getState().run;
      b.store.subscribe((s) => {
        const run = s.run; if (!run || run === prev) return;
        const p = prev; prev = run;
        storeLog.push([performance.now(), run.shop.length, run.hand.length, run.board.length, run.embers, run.recruitFxSeq || 0, (run.recruitBuffFx || []).length, p ? (p.recruitFxSeq || 0) : 0]);
        // THE SCRIPTED SHOP: the game's own refresh just rolled offers; swap in the scripted Shout minions inside the
        // same task (React batches both writes into one commit), so every refresh offers the same cards on every build.
        if (!busy && window.__apmScripted && run.phase === 'recruit' && run.shop.some((c) => !String(c.uid).startsWith('apm'))) {
          busy = true;
          try { b.store.setState((x) => ({ run: { ...x.run, shop: shopIds.map((cardId) => ({ uid: 'apm' + (q++), cardId })) } })); } finally { busy = false; }
        }
      });
      try { if (window.__perf) window.__perf.subscribe((bk) => { perfBuckets.push({ t: performance.now(), long: bk.long, jank: bk.jank, worst: bk.worst, timings: bk.timings, counts: bk.counts, longAttrib: bk.longAttrib }); }); } catch {}
    },
    dump: () => ({ ft: Array.from(ft.subarray(0, fn)), loaf, longtasks, evt, input, marks, storeLog, samples, notes, harness, perfBuckets }),
  };
})();`;

// ---------------------------------------------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------------------------------------------
/** The whole machine's CPU busy share between two `os.cpus()` readings (0..100). This machine is shared with other
 *  builders: a run made while they were busy drives fewer actions and drops more frames, whatever the build. */
function cpuBusyPct(a, b) {
  let idle = 0, total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    for (const k of Object.keys(b[i].times)) total += b[i].times[k] - a[i].times[k];
    idle += b[i].times.idle - a[i].times.idle;
  }
  return total > 0 ? Math.round(1000 * (1 - idle / total)) / 10 : 0;
}

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => pct(a, 0.5);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
function frameStats(ft, from, to) {
  const iv = [];
  for (let i = 1; i < ft.length; i++) if (ft[i] > from && ft[i] <= to) iv.push(ft[i] - ft[i - 1]);
  const n = iv.length || 1; const over = (ms) => iv.filter((x) => x > ms).length;
  const secs = Math.max(0.001, (to - from) / 1000);
  return { frames: iv.length, mean: r2(mean(iv)), p50: r2(pct(iv, 0.5)), p95: r2(pct(iv, 0.95)), p99: r2(pct(iv, 0.99)), max: r1(Math.max(0, ...iv)),
    over5pct: r1(100 * over(5) / n), over625pct: r1(100 * over(6.25) / n), over167pct: r2(100 * over(16.7) / n), over33: over(33.4),
    droppedPerSec: r1(over(6.25) / secs), over167PerSec: r2(over(16.7) / secs) };
}

// ---------------------------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------------------------
async function oneRun(port, runIdx, dist) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-apm-'));
  const c = await launch(profile);
  const traceEvents = [];
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Performance.enable', { timeDomain: 'timeTicks' });
    const errs = new Set();
    c.on('Runtime.exceptionThrown', (p) => { const m = String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').split('\n')[0]; if (!errs.has(m)) { errs.add(m); log(`   (page exception: ${m})`); } });
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    c.on('Fetch.requestPaused', (p) => {
      const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url);
      void (local ? c.send('Fetch.continueRequest', { requestId: p.requestId }) : c.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
    });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    if (arg('css', '')) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(arg('css', ''))}; document.head.appendChild(s); });` });
    if (arg('init-js', '')) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: arg('init-js') });
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    if (Number(arg('cpu-throttle', '0')) > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: Number(arg('cpu-throttle')) });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

    const ev = (e) => evaluate(c, e);
    const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
    const g = `window.__bench.store.getState()`;
    const METRIC_KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
    const metrics = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.filter((m) => METRIC_KEYS.includes(m.name)).map((m) => [m.name, /Count$/.test(m.name) ? m.value : m.value * 1000]));
    // An input event that the page never acknowledges must not hang the bench: 1.5 s, then it is counted and the run goes on.
    let hungInputs = 0;
    const input = (params) => Promise.race([c.send('Input.dispatchMouseEvent', params), sleep(1500).then(() => 'hung')]).then((r) => { if (r === 'hung') hungInputs++; return r; });
    const mouse = (type, p, extra = {}) => input({ type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

    // ---- to the first shop ----
    if (!(await waitFor(`!!window.__bench && !document.getElementById('bootsplash') && [...document.querySelectorAll('button,[role=button]')].some((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === 'PLAY')`, 120_000))) throw new Error('title not reached (is this a VITE_PERF_BENCH build?)');
    const gpu = await ev(`(() => { try { const gl = document.createElement('canvas').getContext('webgl'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; } catch { return 'none'; } })()`);
    await sleep(1500);
    await ev(`(() => { const s = ${g}; s.startPractice(); s.setPracticeDraft({ godMode: false, opponents: 'bots', botDifficulty: 10, health: 'unlimited', timeMult: 0, heroes: 'all', tribes: ${JSON.stringify(scene.tribes)} }); })()`);
    await sleep(600);
    await ev(`${g}.confirmPracticeSetup()`);
    if (!(await waitFor(`!!document.querySelector('.heroselect')`, 15_000))) throw new Error('hero select not reached');
    await ev(`window.__bench.store.setState({ pendingSeed: ${SEED} })`);
    await sleep(1200);
    await ev(`${g}.pickHero(${JSON.stringify(HERO)})`);
    const inShop = `document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0`;
    for (let i = 0; i < 80 && !(await ev(inShop)); i++) {
      const p = await ev(`(() => { const e = [...document.querySelectorAll('.hsc-start')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (p) { await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await mouse('mousePressed', p); await mouse('mouseReleased', p); }
      await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Play anyway'); if (b) b.click(); })()`);
      await sleep(600);
    }
    if (!(await ev(inShop))) throw new Error('first shop not reached');
    const priority = raisePriority(profile);
    await sleep(2500);

    // ---- the scene, through the store (the game's own actions) ----
    const built = await ev(`(async () => {
      const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState();
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const settle = async () => {
        for (let n = 0; n < 20 && (sim.modalOpen(S().run) || (sim.ancientOfferOpen && sim.ancientOfferOpen(S().run))); n++) {
          const run = S().run;
          if (sim.ancientOfferOpen && sim.ancientOfferOpen(run)) {
            const want = ${JSON.stringify(ANCIENT)};
            if (want && !run.ancients.offer.includes(want)) st.setState((x) => ({ run: { ...x.run, ancients: { ...x.run.ancients, offer: [want, ...x.run.ancients.offer.filter((o) => o !== want).slice(0, 2)] } } }));
            const offer = S().run.ancients.offer;
            S().dispatch({ type: 'pickAncient', id: offer.includes(want) ? want : offer[0] });
            await wait(4500); continue;
          }
          if (run.discover) {
            const opts = Array.isArray(run.discover) ? run.discover : (run.discover.options || run.discover.cards || []);
            const before = new Set(run.hand.map((h) => h.uid));
            S().dispatch({ type: 'discover', index: Math.floor(Math.max(1, opts.length) / 2) });
            if (S().run === run) break;
            const got = S().run.hand.find((h) => !before.has(h.uid));
            if (got) S().dispatch({ type: 'sell', uid: got.uid });
            if (got && S().run.hand.some((h) => h.uid === got.uid)) st.setState((x) => ({ run: { ...x.run, hand: x.run.hand.filter((h) => h.uid !== got.uid) } }));
          } else {
            const a = sim.DEFAULT_BOT.act(run);
            if (!a || a.type === 'faceOmen') break;
            S().dispatch(a);
            if (S().run === run) break;
          }
          await wait(200);
        }
      };
      const gold = () => st.setState((s) => ({ run: { ...s.run, embers: 9999 } }));
      const buyPrinted = async (id) => {
        st.setState((s) => ({ run: { ...s.run, godMode: true, embers: 9999 } }));
        S().dispatch({ type: 'godPrint', cardId: id });
        st.setState((s) => ({ run: { ...s.run, godMode: undefined } }));
        const card = S().run.shop[S().run.shop.length - 1];
        if (card && card.cardId === id) S().dispatch({ type: 'buy', uid: card.uid });
        await wait(250); await settle();
      };
      const playFromHand = async (id, golden) => {
        const c = S().run.hand.find((h) => h.cardId === id && !!h.golden === golden);
        if (!c) return false;
        S().dispatch({ type: 'play', uid: c.uid, toIndex: S().run.board.length });
        await wait(450); await settle();
        return S().run.board.some((b) => b.uid === c.uid);
      };
      await settle();
      // No seat can be eliminated and the round reads as a late one (the HUD's round, nothing else reads it here).
      st.setState((s) => ({ run: { ...s.run, lobby: s.run.lobby ? { ...s.run.lobby, seats: s.run.lobby.seats.map((seat, i) => (i === 0 ? seat : { ...seat, invulnerable: true })) } : s.run.lobby } }));
      // Tier 6 through the game's own upgrade.
      for (let i = 0; i < 8 && S().run.tier < 6; i++) { gold(); S().dispatch({ type: 'upgrade' }); await wait(350); await settle(); }
      const missing = [];
      for (const spec of ${JSON.stringify(scene.board)}) {
        const gilded = spec.endsWith('*'); const id = spec.replace(/\\*$/, '');
        for (let k = 0; k < (gilded ? 3 : 1); k++) await buyPrinted(id);
        if (!(await playFromHand(id, gilded))) missing.push(spec);
      }
      for (const id of ${JSON.stringify(scene.fillers)}) await buyPrinted(id);
      // The Ancient: awaken it through the game's own meter + pick.
      if (${JSON.stringify(ANCIENT)} !== 'none') {
        if (!S().run.ancientsEnabled && sim.enableAncients) st.setState((s) => ({ run: sim.enableAncients(s.run) }));
        const r = S().run;
        if (r.ancientsEnabled && r.ancients && !r.ancients.picked) { S().dispatch({ type: 'ancientSetMeter', points: r.ancients.cost }); await wait(600); await settle(); }
      }
      gold();
      // Whatever else the build left in hand (a triple's reward) goes: the hand is exactly the held cards.
      { const keep = new Set(${JSON.stringify(scene.fillers)}); st.setState((s) => ({ run: { ...s.run, hand: s.run.hand.filter((h) => keep.has(h.cardId)) } })); }
      const r = S().run;
      window.__apmFillers = new Set(r.hand.map((h) => h.uid));
      return { board: r.board.map((b) => b.cardId + (b.golden ? '*' : '')), hand: r.hand.map((h) => h.cardId), tier: r.tier, wave: r.wave, ancient: r.ancients ? r.ancients.picked || null : null, hero: r.heroId, missing, set: r.setId || null };
    })()`);
    log(`   scene: board [${built.board.join(', ')}] hand ${built.hand.length} tier ${built.tier} ancient ${built.ancient} hero ${built.hero}${built.missing.length ? `  MISSING ${built.missing.join(', ')}` : ''}`);
    if (built.missing.length || built.board.length !== scene.board.length) throw new Error('the scene board could not be built');
    await ev(`(() => { window.__apm.hookStore(${JSON.stringify(scene.shop)}); window.__apmScripted = true; })()`);

    // ---- the driver: what next is read off the store (no layout); where to click is one rect read (timed) ----
    const state = () => evaluate(c, `(() => { const r = ${g}.run; return { shop: r.shop.map((c) => c.uid), hand: r.hand.filter((c) => !window.__apmFillers.has(c.uid)).map((c) => [c.uid, c.cardId]), board: r.board.map((c) => c.uid), gold: r.embers, modal: !!(r.discover || r.chooseOne || r.pendingTarget) }; })()`, 8000);
    const rectOf = (sel) => ev(`(() => { const t0 = performance.now(); const e = document.querySelector(${JSON.stringify(sel)}); const r = e && e.getClientRects().length ? e.getBoundingClientRect() : null; const h = window.__apm.harness; h.n++; h.ms += performance.now() - t0; return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom } : null; })()`);
    const zones = { tavern: await rectOf('[data-zone="tavern"]'), warband: await rectOf('[data-zone="warband"]'), hand: await rectOf('[data-zone="hand"]'), refresh: await rectOf('[data-spec="refresh"]') };
    if (!zones.tavern || !zones.warband || !zones.hand || !zones.refresh) throw new Error('a zone is missing: ' + JSON.stringify(zones));
    const DRAG_STEPS = 4, STEP_MS = 8;
    const drag = async (from, to) => {
      await input({ type: 'mouseMoved', x: from.x, y: from.y });
      await mouse('mousePressed', from);
      for (let i = 1; i <= DRAG_STEPS; i++) { const k = i / DRAG_STEPS; await mouse('mouseMoved', { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }); await sleep(STEP_MS); }
      await mouse('mouseReleased', to);
    };
    const click = async (p) => { await input({ type: 'mouseMoved', x: p.x, y: p.y }); await mouse('mousePressed', p); await sleep(STEP_MS); await mouse('mouseReleased', p); };
    const isSpell = (cardId) => /^sp_|flame|flutter/.test(cardId) && !/^d2_/.test(cardId);
    /** One action, decided from the live store. Returns the kind attempted (or null when nothing can be done). */
    const act = async () => {
      const s = await state();
      if (s.modal) { await ev(`window.__apm.note('modal')`); return null; }
      if (s.gold < 500) await ev(`window.__bench.store.setState((x) => ({ run: { ...x.run, embers: 9999 } }))`);
      let kind, from, to;
      const extra = s.hand; // the hand minus the held cards
      const spell = extra.filter(([, id]) => isSpell(id)).pop();
      if (s.board.length > scene.board.length) {
        kind = 'sell'; const uid = s.board[s.board.length - 1];
        from = await rectOf(`[data-zone="warband"] .card[data-uid="${uid}"]`); to = { x: zones.tavern.x, y: zones.tavern.y };
      } else if (spell) {
        kind = 'cast'; from = await rectOf(`[data-zone="hand"] .card[data-uid="${spell[0]}"]`); to = { x: zones.warband.x - 300, y: zones.warband.y - 40 };
      } else if (extra.length) {
        kind = 'play'; const uid = extra[extra.length - 1][0];
        from = await rectOf(`[data-zone="hand"] .card[data-uid="${uid}"]`); to = { x: zones.warband.right - 60, y: zones.warband.y };
      } else if (s.shop.length) {
        kind = 'buy'; from = await rectOf(`[data-zone="tavern"] .card[data-uid="${s.shop[0]}"]`); to = { x: zones.hand.x, y: zones.hand.y };
      } else {
        kind = 'refresh'; from = zones.refresh; to = null;
      }
      if (!from) { await ev(`window.__apm.note('nopos', ${JSON.stringify(kind)})`); return null; }
      await ev(`window.__apm.note(${JSON.stringify(kind)})`);
      if (to) await drag(from, to); else await click(from);
      if (flag('debug')) log(`      ${kind} shop ${s.shop.length} hand+${s.hand.length} board ${s.board.length}${hungInputs ? ` hung ${hungInputs}` : ''}`);
      return kind;
    };

    // ---- warm-up (unmeasured): two shops' worth at an easy pace, so every FX def, texture and sound is loaded ----
    for (let i = 0; i < 44; i++) { await act(); await sleep(450); }
    await sleep(3500);
    if (arg('shots', '')) { fs.mkdirSync(arg('shots'), { recursive: true }); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(arg('shots'), `scene-${LABEL || 'run'}-${runIdx}.png`), Buffer.from(s.data, 'base64')); }

    // ---- --rapid '{"dedupe":false}' / --roll-step <ms>: the rapid-input presentation's dials (fx/rapidConfig.ts) ----
    const dials = await ev(`(() => {
      const b = window.__bench; if (!b.rapidFx) return null;
      const want = ${JSON.stringify(arg('rapid', ''))}; if (want) Object.assign(b.rapidFx, JSON.parse(want));
      const step = ${JSON.stringify(arg('roll-step', ''))}; if (step !== '') b.statRoll.stepMs = Number(step);
      return { ...b.rapidFx, rollStepMs: Math.round(b.statRoll.stepMs * 10) / 10 };
    })()`);
    if (arg('rapid', '') || arg('roll-step', '') !== '') log(`   dials: ${JSON.stringify(dials)}`);

    // ---- --toggle: switch one cost class off for the measured part (an upper bound on what fixing it could buy) ----
    for (const t of arg('toggle', '').split(',').filter(Boolean)) {
      if (!TOGGLES[t]) throw new Error(`unknown --toggle ${t} (known: ${Object.keys(TOGGLES).join(', ')})`);
      await ev(TOGGLES[t]);
    }
    if (arg('toggle', '')) await sleep(1500);

    // ---- --per-action: what ONE action costs, by kind (a slow pass before the burst: one action, then 250 ms) ----
    // The main-thread time (CDP) of the 250 ms after each action, less what the same 250 ms costs with no action.
    let perAction = null;
    if (flag('per-action')) {
      const WIN = 250; const rows = []; const idleRows = [];
      const delta = (a, b) => ({ task: b.TaskDuration - a.TaskDuration, script: b.ScriptDuration - a.ScriptDuration, style: b.RecalcStyleDuration - a.RecalcStyleDuration, layout: b.LayoutDuration - a.LayoutDuration });
      for (let i = 0; i < 66; i++) {
        await sleep(650); // the previous action's effects have mostly played out
        const i0 = await metrics(); await sleep(WIN); const i1 = await metrics(); idleRows.push(delta(i0, i1));
        const a0 = await metrics(); const kind = await act(); await sleep(WIN); const a1 = await metrics();
        if (kind) rows.push({ kind, ...delta(a0, a1) });
      }
      const med = (v) => { const x = [...v].sort((a, b) => a - b); return x.length ? x[x.length >> 1] : 0; };
      const base = { task: med(idleRows.map((r) => r.task)), script: med(idleRows.map((r) => r.script)), style: med(idleRows.map((r) => r.style)), layout: med(idleRows.map((r) => r.layout)) };
      perAction = { windowMs: WIN, idle: base, byKind: {} };
      for (const kind of [...new Set(rows.map((r) => r.kind))]) {
        const rs = rows.filter((r) => r.kind === kind);
        perAction.byKind[kind] = { n: rs.length, task: r1(med(rs.map((r) => r.task)) - base.task), script: r1(med(rs.map((r) => r.script)) - base.script), style: r1(med(rs.map((r) => r.style)) - base.style), layout: r1(med(rs.map((r) => r.layout)) - base.layout) };
      }
      await sleep(3000);
    }

    // ---- idle baseline ----
    await ev(`window.__apm.startSampler(${flag('census')})`);
    await ev(`window.__apm.mark('idle')`);
    const m0 = await metrics();
    await sleep(3000);
    const m1 = await metrics();

    // ---- the burst ----
    if (flag('profile')) { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 200 }); await c.send('Profiler.start'); }
    if (flag('trace')) {
      c.on('Tracing.dataCollected', (p) => { for (const e of p.value) traceEvents.push(e); });
      await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'gpu', 'viz', 'blink', 'toplevel'] } });
    }
    // --trace-style: the timeline WITH stacks: which code forced each style recalc / layout, and who dirtied them.
    if (flag('trace-style')) {
      c.on('Tracing.dataCollected', (p) => { for (const e of p.value) traceEvents.push(e); });
      await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-blink.debug', 'v8.execute', '__metadata'] } });
    }
    await ev(`window.__apm.mark('burst')`);
    const cpu0 = os.cpus();
    // --screencast <dir>: what the burst LOOKS like (a capture for a review, never a measuring run: it costs frames).
    // JPEG frames of seconds 4 to 9 of the burst, named by their time, to be stitched by any tool.
    if (arg('screencast', '')) {
      const dir = arg('screencast'); fs.mkdirSync(dir, { recursive: true }); let n = 0; const t0 = Date.now();
      c.on('Page.screencastFrame', (p) => {
        void c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
        fs.writeFileSync(path.join(dir, `${LABEL || 'run'}-${String(n++).padStart(4, '0')}-${Date.now() - t0}ms.jpg`), Buffer.from(p.data, 'base64'));
      });
      setTimeout(() => { void c.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 }).catch(() => {}); }, 4000);
      setTimeout(() => { void c.send('Page.stopScreencast').catch(() => {}); }, 9000);
    }
    const period = 1000 / RATE; const tStart = Date.now(); let attempted = 0; const shotAt = arg('shots', '') ? [0.4, 0.8].map((k) => tStart + SECS * 1000 * k) : [];
    while (Date.now() - tStart < SECS * 1000) {
      const t0 = Date.now();
      if (await act()) attempted++;
      if (shotAt.length && Date.now() > shotAt[0]) { shotAt.shift(); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(arg('shots'), `burst-${LABEL || 'run'}-${runIdx}-${2 - shotAt.length}.png`), Buffer.from(s.data, 'base64')); }
      const left = period - (Date.now() - t0);
      if (left > 0) await sleep(left);
    }
    await ev(`window.__apm.mark('tail')`);
    const machineBusyPct = cpuBusyPct(cpu0, os.cpus());
    const m2 = await metrics();
    let cpuProfile = null;
    if (flag('profile')) cpuProfile = (await c.send('Profiler.stop')).profile;
    if (flag('trace') || flag('trace-style')) { const done = new Promise((r) => c.on('Tracing.tracingComplete', r)); await c.send('Tracing.end'); await Promise.race([done, sleep(60000)]); }
    if (arg('shots', '')) { for (const [i, ms] of [[0, 150], [1, 600], [2, 1500]]) { await sleep(ms - (i ? [150, 600][i - 1] : 0)); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(arg('shots'), `tail-${LABEL || 'run'}-${runIdx}-${ms}ms.png`), Buffer.from(s.data, 'base64')); } }
    await sleep(TAIL * 1000);
    await ev(`window.__apm.mark('end')`);
    const m3 = await metrics();
    await ev(`window.__apm.stopSampler()`);
    const final = await ev(`(() => { const r = ${g}.run; return { board: r.board.map((b) => [b.cardId, b.attack, b.health]) }; })()`);
    const dump = await ev(`window.__apm.dump()`);
    return { gpu, built, dump, dist, hungInputs, machineBusyPct, priority, perAction, metrics: { idle: [m0, m1], burst: [m1, m2], tail: [m2, m3] }, attempted, profile: cpuProfile, traceEvents, final };
  } catch (e) {
    // What was on screen when the run failed (the usual cause: a screen the script did not expect).
    try { fs.mkdirSync(OUT, { recursive: true }); const s = await Promise.race([c.send('Page.captureScreenshot', { format: 'png' }), sleep(8000).then(() => { throw new Error('no screenshot'); })]); fs.writeFileSync(path.join(OUT, `failed-${LABEL || 'run'}-${runIdx}.png`), Buffer.from(s.data, 'base64')); } catch { /* the page is gone */ }
    throw e;
  } finally {
    c.close();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still letting go */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Analysis of one run
// ---------------------------------------------------------------------------------------------------------------
function analyse(run) {
  const d = run.dump;
  const markAt = (n) => (d.marks.find((m) => m[1] === n) || [0])[0];
  const tIdle = markAt('idle'), tBurst = markAt('burst'), tTail = markAt('tail'), tEnd = markAt('end');
  const out = { gpu: run.gpu, attempted: run.attempted, hungInputs: run.hungInputs, machineBusyPct: run.machineBusyPct, priority: run.priority };
  out.frames = { idle: frameStats(d.ft, tIdle, tBurst), burst: frameStats(d.ft, tBurst, tTail), tail: frameStats(d.ft, tTail, tEnd) };
  out.loaf = { burst: d.loaf.filter((l) => l[0] >= tBurst && l[0] < tTail).length, tail: d.loaf.filter((l) => l[0] >= tTail && l[0] < tEnd).length, worstMs: r1(Math.max(0, ...d.loaf.filter((l) => l[0] >= tBurst && l[0] < tEnd).map((l) => l[1]))) };
  out.longtasks = { burst: d.longtasks.filter((l) => l[0] >= tBurst && l[0] < tTail).length, totalMs: r1(d.longtasks.filter((l) => l[0] >= tBurst && l[0] < tTail).reduce((a, l) => a + l[1], 0)) };

  // (b) input: every note is one attempted action; its events and the store change that followed.
  const notes = d.notes.filter((n) => n[0] >= tBurst && n[0] < tTail && !['modal', 'nopos'].includes(n[1]));
  const skipped = d.notes.filter((n) => n[0] >= tBurst && n[0] < tTail && ['modal', 'nopos'].includes(n[1]));
  const acts = [];
  for (let i = 0; i < notes.length; i++) {
    const [t, kind] = notes[i]; const tNext = i + 1 < notes.length ? notes[i + 1][0] : tTail;
    const evs = d.input.filter((e) => e[2] >= t && e[2] < tNext);
    const down = evs.find((e) => e[0] === 'pointerdown'); const up = evs.find((e) => e[0] === (kind === 'refresh' ? 'click' : 'pointerup'));
    const a = { kind, t, accepted: false };
    if (down) a.downQueue = down[2] - down[1];
    if (up) {
      a.upQueue = up[2] - up[1];
      // Accepted = the run changed within 250 ms of the release handler (the drop / click dispatches synchronously).
      const st = d.storeLog.find((s) => s[0] >= up[2] - 0.5 && s[0] < up[2] + 250);
      if (st) {
        a.accepted = true; a.toStore = st[0] - up[1];
        const f = d.ft.find((x) => x >= st[0]); if (f) a.toFrame = f - up[1];
        a.buffEvents = st[5] !== st[7] ? st[6] : 0;
      }
    }
    acts.push(a);
  }
  const ok = acts.filter((a) => a.accepted);
  const lat = (k) => { const v = ok.map((a) => a[k]).filter((x) => x !== undefined); return { p50: r1(median(v)), p95: r1(pct(v, 0.95)), max: r1(Math.max(0, ...v)) }; };
  const byKind = {}; for (const a of acts) { const b = (byKind[a.kind] ||= { n: 0, ok: 0 }); b.n++; if (a.accepted) b.ok++; }
  const evtB = d.evt.filter((e) => e[1] >= tBurst && e[1] < tTail);
  out.input = {
    attempted: acts.length, accepted: ok.length, acceptedPct: r1(100 * ok.length / Math.max(1, acts.length)), skipped: skipped.length, byKind,
    actionsPerSec: r1(ok.length / Math.max(0.001, (tTail - tBurst) / 1000)),
    downQueue: (() => { const v = acts.map((a) => a.downQueue).filter((x) => x !== undefined); return { p50: r1(median(v)), p95: r1(pct(v, 0.95)), max: r1(Math.max(0, ...v)) }; })(),
    toStore: lat('toStore'), toFrame: lat('toFrame'),
    // Event Timing only reports interactions slower than 16 ms: how many there were, and their worst input -> paint.
    slowEvents: evtB.length, slowEventWorst: r1(Math.max(0, ...evtB.map((e) => e[4]))), slowEventsOver50: evtB.filter((e) => e[4] > 50).length,
    buffEventsPerAction: r1(mean(ok.map((a) => a.buffEvents || 0))), buffEventsTotal: ok.reduce((s, a) => s + (a.buffEvents || 0), 0),
  };

  // (c) backlog
  const S = d.samples; const inWin = (a, b) => S.filter((s) => s.t >= a && s.t < b);
  const idle = inWin(tIdle, tBurst), burst = inWin(tBurst, tTail), tail = inWin(tTail, tEnd);
  const lastInput = Math.max(tBurst, ...d.input.filter((e) => e[2] < tTail + 200).map((e) => e[2]));
  const keys = ['behind', 'owed', 'tweens', 'plays', 'particles', 'queued', 'timeouts', 'nodes', 'floats'].concat(S.some((s) => s.anims !== undefined) ? ['anims'] : []);
  const third = Math.floor(burst.length / 3);
  out.backlog = {};
  for (const k of keys) {
    const idleMax = Math.max(0, ...idle.map((s) => s[k] || 0)); const idleMed = median(idle.map((s) => s[k] || 0));
    const slack = k === 'nodes' ? Math.max(40, idleMax * 0.02) : k === 'timeouts' ? 3 : k === 'tweens' ? 2 : 0;
    const after = S.filter((s) => s.t >= lastInput);
    // Settle = the first sample after the last input from which the counter STAYS at or under idle.
    let settle = null;
    for (let i = after.length - 1; i >= 0; i--) { if ((after[i][k] || 0) > idleMax + slack) { settle = i + 1 < after.length ? after[i + 1].t - lastInput : null; break; } if (i === 0) settle = 0; }
    const firstT = mean(burst.slice(0, third).map((s) => s[k] || 0)), lastT = mean(burst.slice(-third).map((s) => s[k] || 0));
    out.backlog[k] = { idle: r1(idleMed), idleMax, burstMean: r1(mean(burst.map((s) => s[k] || 0))), peak: Math.max(0, ...burst.map((s) => s[k] || 0)), firstThird: r1(firstT), lastThird: r1(lastT),
      growthPct: firstT > 0 ? Math.round(100 * (lastT - firstT) / firstT) : 0, settleMs: settle === null ? null : Math.round(settle), tailEnd: tail.length ? tail[tail.length - 1][k] || 0 : 0 };
  }
  // The longest any badge stayed behind the real number, and the share of burst samples with a stale badge.
  let longest = 0, cur = null;
  for (const s of S.filter((x) => x.t >= tBurst)) { if (s.behind > 0) { cur ??= s.t; longest = Math.max(longest, s.t - cur); } else cur = null; }
  out.staleBadge = { pctOfBurst: r1(100 * burst.filter((s) => s.behind > 0).length / Math.max(1, burst.length)), meanBehind: r1(mean(burst.map((s) => s.behind))), longestMs: Math.round(longest), afterLastInputMs: out.backlog.behind.settleMs };
  out.rapidPct = r1(100 * burst.filter((x) => (x.pressure || 0) >= 3).length / Math.max(1, burst.length));
  const perSec = (k) => burst.length > 1 ? r1((burst[burst.length - 1][k] - burst[0][k]) / ((burst[burst.length - 1].t - burst[0].t) / 1000)) : 0;
  out.rates = { drawCallsPerSec: perSec('draws'), soundsPerSec: perSec('sounds'), timeoutsMadePerSec: perSec('toMade'), pacedStepsDroppedPerSec: perSec('droppedFx') };

  // (d) cost
  const cost = (pair, secs) => { const [a, b] = pair; const o = {}; for (const k of Object.keys(b)) o[k] = r1((b[k] - a[k]) / secs); return o; };
  const bs = (tTail - tBurst) / 1000;
  out.cost = { idlePerSec: cost(run.metrics.idle, (tBurst - tIdle) / 1000), burstPerSec: cost(run.metrics.burst, bs), tailPerSec: cost(run.metrics.tail, (tEnd - tTail) / 1000) };
  const tot = (k) => run.metrics.burst[1][k] - run.metrics.burst[0][k];
  out.cost.perAction = { task: r2(tot('TaskDuration') / Math.max(1, ok.length)), script: r2(tot('ScriptDuration') / Math.max(1, ok.length)), style: r2(tot('RecalcStyleDuration') / Math.max(1, ok.length)), layout: r2(tot('LayoutDuration') / Math.max(1, ok.length)) };
  out.harness = { rectReads: d.harness.n, ms: r1(d.harness.ms), msPerRead: r2(d.harness.ms / Math.max(1, d.harness.n)) };
  if (d.perfBuckets.length) {
    const agg = {}; const attrib = {}; const counts = {};
    for (const b of d.perfBuckets.filter((x) => x.t >= tBurst && x.t < tTail + 1000)) {
      for (const [n, v] of Object.entries(b.timings || {})) { const x = (agg[n] ||= { n: 0, total: 0, self: 0, max: 0 }); x.n += v.n || 0; x.total += v.total || 0; x.self += v.self || 0; x.max = Math.max(x.max, v.max || 0); }
      for (const [n, v] of Object.entries(b.longAttrib || {})) { const x = (attrib[n] ||= { ms: 0, frames: 0 }); x.ms += v.ms; x.frames += v.frames; }
      for (const [n, v] of Object.entries(b.counts || {})) if (typeof v === 'number') counts[n] = Math.max(counts[n] || 0, v);
    }
    out.spans = Object.entries(agg).sort((a, b) => b[1].self - a[1].self).slice(0, 25).map(([n, v]) => ({ label: n, n: v.n, selfMsPerSec: r1(v.self / bs), totalMsPerSec: r1(v.total / bs), max: r1(v.max) }));
    out.longAttrib = Object.entries(attrib).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12).map(([n, v]) => ({ label: n, ms: Math.round(v.ms), frames: v.frames }));
    out.fxCounts = counts;
  }
  if (run.profile) out.profileTop = topSelf(run.profile, 40, run.dist);
  if (run.traceEvents.length && flag('trace-style')) out.styleTrace = styleTrace(run.traceEvents, run.dist, bs, ok.length);
  else if (run.traceEvents.length) out.trace = traceSummary(run.traceEvents, bs);
  if (run.perAction) out.perActionCost = run.perAction;
  out.final = run.final;
  return out;
}
/** Top self time, named through the bench build's hidden source maps, plus WHO CALLED the native layout / lookup
 *  functions (getBoundingClientRect, getComputedStyle, ...): the first app frame above each sample. */
function topSelf(profile, n, dist) {
  const require_ = createRequire(import.meta.url);
  const maps = new Map();
  const mapFor = (url) => {
    if (maps.has(url)) return maps.get(url);
    let consumer = null;
    try { const file = path.join(dist, new URL(url).pathname + '.map'); if (fs.existsSync(file)) { const { SourceMapConsumer } = require_('source-map-js'); consumer = new SourceMapConsumer(JSON.parse(fs.readFileSync(file, 'utf8'))); } } catch { /* unnamed */ }
    maps.set(url, consumer); return consumer;
  };
  const nameOf = (f) => {
    if (!f.url) return f.functionName || '(native)';
    const m = mapFor(f.url); const o = m ? m.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber }) : null;
    if (o && o.source) return `${o.name || f.functionName || '(anon)'} ${o.source.replace(/^.*\/(packages|node_modules|apps)\//, '$1/')}:${o.line}`;
    return `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`;
  };
  const byId = new Map(profile.nodes.map((x) => [x.id, x])); const parent = new Map();
  for (const node of profile.nodes) for (const c of node.children || []) parent.set(c, node.id);
  const self = new Map(); const callers = new Map(); const dt = profile.timeDeltas;
  const NATIVE = /^(getBoundingClientRect|getComputedStyle|getClientRects|elementsFromPoint|elementFromPoint|querySelector|querySelectorAll|offsetLeft|offsetTop|offsetWidth|offsetHeight|offsetParent|getPropertyValue|transform|getAnimations)$/;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]); if (!node) continue;
    const ms = (dt[i] || 0) / 1000; const f = node.callFrame;
    const key = nameOf(f); self.set(key, (self.get(key) || 0) + ms);
    if (!f.url && NATIVE.test(f.functionName)) {
      // The nearest two app frames above the native call.
      const chain = []; let p = parent.get(node.id);
      while (p !== undefined && chain.length < 2) { const pn = byId.get(p); if (pn && pn.callFrame.url) chain.push(nameOf(pn.callFrame)); p = parent.get(p); }
      const k = `${f.functionName} <- ${chain.join(' <- ')}`; callers.set(k, (callers.get(k) || 0) + ms);
    }
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => ({ fn: k, ms: Math.round(ms), pct: r1(100 * ms / total) }));
  const nat = [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => ({ fn: k, ms: Math.round(ms), pct: r1(100 * ms / total) }));
  return { top, nativeCallers: nat };
}
function traceSummary(events, secs) {
  const procName = new Map(); const threadName = new Map();
  for (const e of events) { if (e.ph === 'M' && e.name === 'process_name') procName.set(e.pid, e.args?.name); if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name); }
  const byName = new Map(); const byThread = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const proc = procName.get(e.pid) || '?'; const th = threadName.get(`${e.pid}:${e.tid}`) || '?';
    const k = `${proc}/${th.replace(/\d+$/, '')}: ${e.name}`;
    const x = byName.get(k) || { ms: 0, n: 0 }; x.ms += e.dur / 1000; x.n++; byName.set(k, x);
    if (/^(ThreadControllerImpl::RunTask|ThreadPool_RunTask)$/.test(e.name)) { const t = `${proc}/${th.replace(/\d+$/, '')}`; byThread.set(t, (byThread.get(t) || 0) + e.dur / 1000); }
  }
  const want = /Layerize|UpdateLayerTree|Paint|PrePaint|Commit|RasterTask|RasterizerTaskImpl|GpuRasterization|ImageDecodeTask|Decode Image|DrawAndSwap|Graphics\.Pipeline|RasterDecoderImpl|FunctionCall|RecalculateStyles|Layout|HitTest|AnimationFrame|EventDispatch/;
  return {
    threadBusyMsPerSec: [...byThread.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, ms]) => ({ thread: t, msPerSec: r1(ms / secs) })),
    top: [...byName.entries()].filter(([k]) => want.test(k)).sort((a, b) => b[1].ms - a[1].ms).slice(0, 28).map(([k, v]) => ({ event: k, msPerSec: r1(v.ms / secs), n: v.n })),
  };
}

/** --trace-style: main-thread time by kind, and the style recalcs / layouts that JS FORCED, grouped by the code that
 *  forced them (source-mapped), the biggest single recalcs, and who dirtied style (the gauntlet's summary, per action). */
function styleTrace(events, dist, secs, actions) {
  const require_ = createRequire(import.meta.url); const maps = new Map();
  const mapFor = (url) => { if (maps.has(url)) return maps.get(url); let m = null; try { const file = path.join(dist, new URL(url).pathname + '.map'); if (fs.existsSync(file)) { const { SourceMapConsumer } = require_('source-map-js'); m = new SourceMapConsumer(JSON.parse(fs.readFileSync(file, 'utf8'))); } } catch { /* unnamed */ } maps.set(url, m); return m; };
  const frame = (f) => {
    const m = f.url && /^https?:/.test(f.url) ? mapFor(f.url) : null;
    const o = m ? m.originalPositionFor({ line: f.lineNumber, column: Math.max(0, (f.columnNumber || 1) - 1) }) : null;
    return o && o.source ? `${o.name || f.functionName || '(anon)'} @ ${o.source.replace(/^.*?(packages|node_modules)\//, '$1/')}:${o.line}` : `${f.functionName || '(anon)'} @ ${(f.url || '').replace(/^.*\//, '')}:${f.lineNumber}`;
  };
  const mains = events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const count = new Map();
  for (const e of events) if (e.ph === 'X') { const k = `${e.pid}:${e.tid}`; count.set(k, (count.get(k) || 0) + 1); }
  const main = mains.map((m) => `${m.pid}:${m.tid}`).sort((a, b) => (count.get(b) || 0) - (count.get(a) || 0))[0];
  const on = events.filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === main);
  const NAMES = ['RunTask', 'FunctionCall', 'FireAnimationFrame', 'TimerFire', 'EventDispatch', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'MinorGC', 'MajorGC', 'HitTest', 'UpdateLayer', 'CompositeLayers', 'RunMicrotasks'];
  const byName = new Map();
  for (const e of on) if (NAMES.includes(e.name)) { const r = byName.get(e.name) || { ms: 0, n: 0 }; r.ms += (e.dur || 0) / 1000; r.n++; byName.set(e.name, r); }
  const forced = { Layout: new Map(), UpdateLayoutTree: new Map() }; const forcedTotal = { Layout: 0, UpdateLayoutTree: 0 };
  for (const e of on) {
    if (e.name !== 'Layout' && e.name !== 'UpdateLayoutTree') continue;
    const st = e.args?.beginData?.stackTrace; if (!st || !st.length) continue;
    const ms = (e.dur || 0) / 1000; forcedTotal[e.name] += ms;
    const key = st.slice(0, 2).map(frame).join('  <  ');
    const r = forced[e.name].get(key) || { ms: 0, n: 0 }; r.ms += ms; r.n++; forced[e.name].set(key, r);
  }
  const dirtied = new Map();
  for (const e of events) {
    if ((e.name !== 'ScheduleStyleRecalculation' && e.name !== 'InvalidateLayout') || `${e.pid}:${e.tid}` !== main) continue;
    const st = e.args?.data?.stackTrace;
    const key = `${e.name === 'InvalidateLayout' ? 'layout' : 'style'}  ${st && st.length ? st.slice(0, 2).map(frame).join('  <  ') : '(no JS: animation / browser)'}`;
    dirtied.set(key, (dirtied.get(key) || 0) + 1);
  }
  const recalcs = on.filter((e) => e.name === 'UpdateLayoutTree');
  const big = [...recalcs].sort((a, b) => b.dur - a.dur).slice(0, 10).map((e) => `${(e.dur / 1000).toFixed(1)} ms, ${e.args?.elementCount ?? '?'} elements${e.args?.beginData?.stackTrace ? ', forced by ' + frame(e.args.beginData.stackTrace[0]) : ''}`);
  // The recalcs by size: how much of the style time is the per-frame trickle and how much the big per-action ones.
  const buckets = [[0, 20], [20, 100], [100, 400], [400, 1e9]].map(([lo, hi]) => { const b = recalcs.filter((e) => (e.args?.elementCount ?? 0) >= lo && (e.args?.elementCount ?? 0) < hi); return `${lo}${hi > 1e8 ? '+' : '-' + hi} elements: x${b.length}, ${(b.reduce((a, e) => a + e.dur, 0) / 1000).toFixed(0)} ms`; });
  const lines = [];
  lines.push(`main thread, per second of burst (and per accepted action):`);
  for (const n of NAMES) { const r = byName.get(n); if (r) lines.push(`  ${n.padEnd(20)} ${(r.ms / secs).toFixed(1).padStart(7)} ms/s  ${(r.ms / Math.max(1, actions)).toFixed(2).padStart(7)} ms/action  x${r.n}`); }
  for (const kind of ['Layout', 'UpdateLayoutTree']) {
    const all = byName.get(kind) || { ms: 0, n: 0 };
    lines.push(`FORCED ${kind === 'Layout' ? 'layout' : 'style recalc'}: ${forcedTotal[kind].toFixed(0)} ms of ${all.ms.toFixed(0)} ms (x${all.n}), by the code that forced it:`);
    for (const [k, r] of [...forced[kind].entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14)) lines.push(`  ${r.ms.toFixed(0).padStart(7)} ms  x${String(r.n).padEnd(6)} ${k}`);
  }
  lines.push('style recalcs by size: ' + buckets.join('; '));
  lines.push('biggest single style recalcs:', ...big.map((l) => '  ' + l));
  const sel = new Map();
  for (const e of events) { const t = e.args?.selector_stats?.selector_timings; if (!t) continue; for (const x of t) { const r = sel.get(x.selector) || { us: 0, attempts: 0, matches: 0 }; r.us += x['elapsed (us)'] || 0; r.attempts += x.match_attempts || 0; r.matches += x.match_count || 0; sel.set(x.selector, r); } }
  if (sel.size) { lines.push('costliest CSS selectors:'); for (const [k, r] of [...sel.entries()].sort((a, b) => b[1].us - a[1].us).slice(0, 15)) lines.push(`  ${(r.us / 1000).toFixed(1).padStart(7)} ms  ${String(r.attempts).padStart(8)} tries ${String(r.matches).padStart(7)} hits  ${k.slice(0, 140)}`); }
  lines.push('who dirtied style / layout (count):');
  for (const [k, n] of [...dirtied.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) lines.push(`  x${String(n).padEnd(6)} ${k}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------
function spread(vals) { const v = vals.filter((x) => typeof x === 'number'); if (!v.length) return 'n/a'; const m = median(v); return v.length > 1 ? `${r1(m)} (${r1(Math.min(...v))}-${r1(Math.max(...v))})` : `${r1(m)}`; }
function report(results) {
  const pick = (f) => spread(results.map(f));
  const lines = [];
  const a0 = results[0];
  lines.push(`# perf:apm ${LABEL ? `[${LABEL}] ` : ''}scene ${SCENE}, ${RATE} actions/s for ${SECS} s, ${results.length} run(s)`);
  lines.push(`GPU: ${a0.gpu}. Values are the median of the runs (min-max).`);
  lines.push(`Whole-machine CPU busy during the burst: ${results.map((r) => r.machineBusyPct + '%').join(' / ')} (this page and Chrome's own processes are about 15 to 20 points of it; more means other work on the machine). Priority: ${a0.priority}.`);
  lines.push('');
  lines.push('## (a) Frames');
  lines.push('| window | mean ms | p95 | p99 | max | % over 240 Hz budget | % over 6.25 | dropped/s | over 16.7/s | over 33 ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const w of ['idle', 'burst', 'tail']) lines.push(`| ${w} | ${pick((r) => r.frames[w].mean)} | ${pick((r) => r.frames[w].p95)} | ${pick((r) => r.frames[w].p99)} | ${pick((r) => r.frames[w].max)} | ${pick((r) => r.frames[w].over5pct)} | ${pick((r) => r.frames[w].over625pct)} | ${pick((r) => r.frames[w].droppedPerSec)} | ${pick((r) => r.frames[w].over167PerSec)} | ${pick((r) => r.frames[w].over33)} |`);
  lines.push(`Long animation frames (> 50 ms): burst ${pick((r) => r.loaf.burst)}, tail ${pick((r) => r.loaf.tail)}, worst ${pick((r) => r.loaf.worstMs)} ms. Long tasks in the burst: ${pick((r) => r.longtasks.burst)} (${pick((r) => r.longtasks.totalMs)} ms).`);
  lines.push('');
  lines.push('## (b) Input');
  lines.push(`Attempted ${pick((r) => r.input.attempted)}, accepted ${pick((r) => r.input.accepted)} (${pick((r) => r.input.acceptedPct)}%), ${pick((r) => r.input.actionsPerSec)} accepted actions/s. Buff events per accepted action: ${pick((r) => r.input.buffEventsPerAction)}.`);
  if (results.some((r) => r.hungInputs)) lines.push(`INPUT EVENTS THE PAGE NEVER ACKNOWLEDGED within 1.5 s: ${pick((r) => r.hungInputs)}.`);
  lines.push(`By kind (run 1): ${Object.entries(a0.input.byKind).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join(', ')}.`);
  lines.push('| latency ms | p50 | p95 | max |');
  lines.push('|---|---|---|---|');
  for (const [k, n] of [['downQueue', 'press -> its handler ran'], ['toStore', 'release -> the store accepted it'], ['toFrame', 'release -> the first frame after it']]) lines.push(`| ${n} | ${pick((r) => r.input[k].p50)} | ${pick((r) => r.input[k].p95)} | ${pick((r) => r.input[k].max)} |`);
  lines.push(`Slow interactions (Event Timing, input -> next paint over 16 ms): ${pick((r) => r.input.slowEvents)}, over 50 ms: ${pick((r) => r.input.slowEventsOver50)}, worst ${pick((r) => r.input.slowEventWorst)} ms.`);
  lines.push('');
  lines.push('## (c) Backlog');
  lines.push('| counter | idle | burst mean | peak | first third | last third | growth | back to idle after the last input (ms) |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const k of Object.keys(a0.backlog)) lines.push(`| ${k} | ${pick((r) => r.backlog[k].idle)} | ${pick((r) => r.backlog[k].burstMean)} | ${pick((r) => r.backlog[k].peak)} | ${pick((r) => r.backlog[k].firstThird)} | ${pick((r) => r.backlog[k].lastThird)} | ${pick((r) => r.backlog[k].growthPct)}% | ${results.map((r) => r.backlog[k].settleMs ?? 'never').join(' / ')} |`);
  lines.push(`Stat badges behind the real number: ${pick((r) => r.staleBadge.pctOfBurst)}% of burst samples, ${pick((r) => r.staleBadge.meanBehind)} badges on average, longest stretch ${pick((r) => r.staleBadge.longestMs)} ms.`);
  lines.push(`Rapid-input presentation engaged in ${pick((r) => r.rapidPct)}% of burst samples (three or more accepted actions inside a second; 0 on a build without it).`);
  lines.push(`Per second of burst: ${pick((r) => r.rates.drawCallsPerSec)} WebGL draw calls, ${pick((r) => r.rates.soundsPerSec)} sounds started, ${pick((r) => r.rates.timeoutsMadePerSec)} timeouts scheduled, ${pick((r) => r.rates.pacedStepsDroppedPerSec)} paced steps of earlier actions dropped.`);
  lines.push('');
  lines.push('## (d) Main-thread cost (CDP)');
  lines.push('| | all tasks ms/s | script | style | layout | style recalcs/s | layouts/s |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [w, n] of [['idlePerSec', 'idle'], ['burstPerSec', 'burst'], ['tailPerSec', 'tail']]) lines.push(`| ${n} | ${pick((r) => r.cost[w].TaskDuration)} | ${pick((r) => r.cost[w].ScriptDuration)} | ${pick((r) => r.cost[w].RecalcStyleDuration)} | ${pick((r) => r.cost[w].LayoutDuration)} | ${pick((r) => r.cost[w].RecalcStyleCount)} | ${pick((r) => r.cost[w].LayoutCount)} |`);
  lines.push(`Per accepted action: ${pick((r) => r.cost.perAction.task)} ms of tasks (script ${pick((r) => r.cost.perAction.script)}, style ${pick((r) => r.cost.perAction.style)}, layout ${pick((r) => r.cost.perAction.layout)}).`);
  lines.push(`Harness: ${pick((r) => r.harness.rectReads)} rect reads, ${pick((r) => r.harness.ms)} ms in total (${pick((r) => r.harness.msPerRead)} ms each; they force a layout the next frame would have done).`);
  if (a0.perActionCost) {
    lines.push(''); lines.push(`### What one action costs, by kind (run 1: main-thread ms in the ${a0.perActionCost.windowMs} ms after it, less an idle ${a0.perActionCost.windowMs} ms; one action every 1.2 s)`);
    lines.push('| action | n | all tasks | script | style | layout |'); lines.push('|---|---|---|---|---|---|');
    for (const [k, v] of Object.entries(a0.perActionCost.byKind)) lines.push(`| ${k} | ${v.n} | ${v.task} | ${v.script} | ${v.style} | ${v.layout} |`);
    lines.push(`(idle ${a0.perActionCost.windowMs} ms: ${r1(a0.perActionCost.idle.task)} ms of tasks, ${r1(a0.perActionCost.idle.style)} style)`);
  }
  if (a0.spans) { lines.push(''); lines.push('### In-game monitor spans (run 1, self ms per second of burst)'); lines.push('| label | calls | self ms/s | total ms/s | worst ms |'); lines.push('|---|---|---|---|---|'); for (const s of a0.spans) lines.push(`| ${s.label} | ${s.n} | ${s.selfMsPerSec} | ${s.totalMsPerSec} | ${s.max} |`); lines.push(''); lines.push(`Inside dropped frames: ${a0.longAttrib.map((x) => `${x.label} ${x.ms} ms / ${x.frames} frames`).join('; ')}`); lines.push(`Peak FX counters: ${JSON.stringify(a0.fxCounts)}`); }
  if (a0.profileTop) { lines.push(''); lines.push('### CPU profile, top self time (run 1)'); for (const p of a0.profileTop.top) lines.push(`- ${p.ms} ms (${p.pct}%) ${p.fn}`); lines.push(''); lines.push('### Who called the layout / lookup natives (run 1, self ms)'); for (const p of a0.profileTop.nativeCallers) lines.push(`- ${p.ms} ms (${p.pct}%) ${p.fn}`); }
  if (a0.styleTrace) { lines.push(''); lines.push('### Style / layout trace (run 1)'); lines.push(...a0.styleTrace); }
  if (a0.trace) { lines.push(''); lines.push('### Trace (run 1)'); lines.push(`Thread busy ms/s: ${a0.trace.threadBusyMsPerSec.map((t) => `${t.thread} ${t.msPerSec}`).join('; ')}`); for (const t of a0.trace.top) lines.push(`- ${t.msPerSec} ms/s x${t.n} ${t.event}`); }
  return lines.join('\n');
}
function guard(results) {
  const fails = [];
  for (const [i, r] of results.entries()) {
    if (r.input.acceptedPct < GUARD.acceptedPct) fails.push(`run ${i + 1}: only ${r.input.acceptedPct}% of actions accepted (< ${GUARD.acceptedPct}%)`);
    for (const k of ['behind', 'tweens', 'plays', 'queued', 'timeouts', 'floats']) {
      const b = r.backlog[k]; if (!b) continue;
      if (b.settleMs === null || b.settleMs > GUARD.settleMs) fails.push(`run ${i + 1}: ${k} not back to idle ${GUARD.settleMs} ms after the last input (${b.settleMs ?? 'never'})`);
      if (b.firstThird >= 4 && b.growthPct > GUARD.growthPct) fails.push(`run ${i + 1}: ${k} grew ${b.growthPct}% across the burst (${b.firstThird} -> ${b.lastThird})`);
    }
    if (r.staleBadge.longestMs > GUARD.staleBadgeMs) fails.push(`run ${i + 1}: a stat badge stayed behind the real number for ${r.staleBadge.longestMs} ms (> ${GUARD.staleBadgeMs})`);
  }
  return fails;
}

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const dist = path.resolve(arg('dist', '') || buildWorking());
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error(`No index.html in ${dist}`); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(dist, PORT);
  const results = []; let failed = false;
  try {
    for (let i = 0; i < RUNS; i++) {
      log(`Run ${i + 1}/${RUNS} ...`);
      try {
        let run;
        try { run = await oneRun(PORT, i, dist); } catch (e) { log(`   run failed (${e.message}); once more`); run = await oneRun(PORT, i + 10, dist); }
        const a = analyse(run);
        if (run.profile) fs.writeFileSync(path.join(OUT, `profile-${LABEL || 'run'}-${i + 1}.cpuprofile`), JSON.stringify(run.profile));
        results.push(a);
        fs.writeFileSync(path.join(OUT, `raw-${LABEL || 'run'}-${i + 1}.json`), JSON.stringify({ analysis: a, dump: { ...run.dump, ft: undefined }, frames: run.dump.ft.length }));
        log(`   frames burst: mean ${a.frames.burst.mean} p99 ${a.frames.burst.p99} max ${a.frames.burst.max} dropped/s ${a.frames.burst.droppedPerSec} | accepted ${a.input.accepted}/${a.input.attempted} | task ${a.cost.burstPerSec.TaskDuration} ms/s | stale badges ${a.staleBadge.pctOfBurst}% longest ${a.staleBadge.longestMs} ms | machine ${a.machineBusyPct}% busy`);
      } catch (e) { failed = true; log(`   RUN FAILED: ${e.message}`); }
    }
  } finally { server.close(); }
  if (!results.length) process.exit(1);
  const text = report(results);
  log('\n' + text + '\n');
  fs.writeFileSync(path.join(OUT, `report-${LABEL || 'run'}.md`), text + '\n');
  fs.writeFileSync(path.join(OUT, `summary-${LABEL || 'run'}.json`), JSON.stringify(results, null, 1));
  if (flag('guard')) {
    const fails = guard(results);
    if (fails.length) { log('GUARD FAILED:\n- ' + fails.join('\n- ')); process.exit(3); }
    log('GUARD OK: the backlog stayed bounded and went back to idle.');
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
