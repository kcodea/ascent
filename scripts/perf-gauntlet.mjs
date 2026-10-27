#!/usr/bin/env node
/**
 * PERF GAUNTLET — the desktop frame judge (R-PERF-GAUNTLET-01, owner 2026-10-27: "we really need to continue doing
 * performance passes").
 *
 * Builds two PRODUCTION bench bundles (`VITE_PERF_BENCH=1`): the CANDIDATE (this working tree) and the BASELINE
 * (`origin/main` by default), then drives each through the same fixed desktop scenes in real Chrome at 1920 x 1080
 * with real mouse input (CDP), alternating builds run by run (A B B A ...), and judges every scene against the frame
 * budget in docs/performance.md §0: 4.17 ms (240 Hz), on the WORST frame first, then long / jank, then p95.
 *
 * BLIND: the two builds are shuffled into X and Y before anything runs. The report names only X and Y; the key is
 * written to its own file and printed last (or not at all with --blind), so a critic agent can pick the winner from
 * the numbers alone before it learns which one is ours.
 *
 * THE LATE GAME IS WHAT IS MEASURED (owner 2026-10-27: "early game performance is not where we should be looking to
 * optimize. its on turns 9-14 when a LOT of cards have been played throughout the game"). One Practice game against
 * level-10 bots, a fixed seed and hero, so both builds play the identical game, in a throwaway Chrome profile:
 *   rounds 1..8   FAST-FORWARD, unmeasured: the same buy-and-play turns, and the fights play out unmeasured
 *   rounds 9..14  MEASURED (--from / --to), each one:
 *     shop-idle     idle in the shop
 *     reroll        tier up + refresh the shop
 *     drag          mouse drags on a full board: sell, buy, play, reorder
 *     shop-actions  the bot plays the rest of the turn (many buys, plays, spells)
 *     end-turn      End Turn -> the falling gate -> combat begins
 *     combat        the whole fight
 *     return        the trip back to the shop
 * Plus, once per run: title, heroselect, run-start (the hero pick -> ceremony -> first shop).
 *
 * WHAT IS MEASURED, per scene:
 *   - frame intervals from a rAF recorder installed before any page script: worst / p99 / p95 / p50, and
 *     long (>= 2 refresh intervals: dropped a frame) / jank (>= 3: a visible hitch), as perfMonitor counts them;
 *   - over-budget frames: intervals > the budget (only meaningful when the display refreshes at >= 240 Hz, since
 *     an interval can never be shorter than one refresh; on a slower display the verdict says so);
 *   - main-thread work per frame from CDP Performance.getMetrics (script + style + layout + all tasks), which does
 *     not depend on the display at all (and is the only trustworthy number with --headless: docs/performance.md §3i);
 *   - long animation frames (LoAF, > 50 ms) and their blocking time.
 *
 * Usage:
 *   npm run perf:gauntlet                       build both, 1 run each (a quick screen), headed Chrome, report + key
 *   npm run perf:gauntlet -- --runs 5 --from 10 --to 12
 *   npm run perf:gauntlet -- --base <ref>       compare against another ref (default origin/main)
 *   npm run perf:gauntlet -- --a <dist> --b <dist>   skip building: compare two existing bench dists
 *   npm run perf:gauntlet -- --only <dist>      one build, no A/B: just the budget verdict
 *   npm run perf:gauntlet -- --blind --out <dir>    report without the key (the key goes to <dir>/key.json)
 *   npm run perf:gauntlet -- --profile shop-actions   CPU-profile that scene; prints its top functions (source-mapped)
 *   npm run perf:gauntlet -- --trace shop-actions     trace that scene: style / layout / paint time, and which code FORCED each layout
 *   npm run perf:gauntlet -- --anim-census shop-actions   list the animations running during that scene (name, properties, target)
 *   npm run perf:gauntlet -- --debug-end              log the wipe / End Turn state after each End combat press that did not land
 *   A run that loses a scene is run again once (--no-retry turns that off).
 *   npm run perf:gauntlet -- --headless         no window (main-thread numbers only; frame intervals are not real)
 *   npm run perf:gauntlet -- --scenes drag,combat   report only these scenes
 * Exit code: 0 = done; 1 = a run failed to reach a scene; 2 = setup error. The budget verdict never fails the exit
 * code (most scenes are over 4.17 ms today; this is a judge for a loop, not a CI gate yet).
 *
 * Keep the Chrome window visible and leave the machine alone while it runs: a covered or minimised window, or other
 * heavy work, inflates every frame. Every request off 127.0.0.1 is blocked, so nothing reaches the live backend.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { budgetVerdict, foldRuns, framesByScene, median, refreshInterval, sceneStats, winner } from '../packages/tools/src/perfGauntletStats.ts';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const ROOT = process.cwd();
const CACHE = path.join(ROOT, '.perf-gauntlet');
// One run a build by default (owner 2026-10-27: "2 would suffice"): a quick screen. On the identical-builds data a
// single pair made a false call on the target scene's p95 / p99 / work in about 1 of 9 pairings (one odd run), so
// confirm a win with another pair (--runs 2) before shipping it.
const RUNS = Number(arg('runs', '1'));
const FROM = Number(arg('from', '9')); // the first MEASURED round: everything before it is fast-forwarded
const TO = Number(arg('to', '14')); // the last measured round
const FF_ACTION_MS = Number(arg('ff-ms', '40')); // the pause between the bot's shop actions
const PORT = Number(arg('port', '4520'));
const BUDGET = Number(arg('budget', '4.17'));
const SEED = Number(arg('seed', '424242'));
const HERO = arg('hero', '');
const HEADLESS = flag('headless');
const BLIND = flag('blind');
const OUT = path.resolve(arg('out', path.join(CACHE, 'reports', new Date().toISOString().replace(/[:.]/g, '-'))));
const TRACE = arg('trace', ''); // a scene to trace: layout / style / paint time, and which JS FORCED each layout
const PROFILE = arg('profile', ''); // a scene to CPU-profile (e.g. shop-actions): its top functions are printed per run
const ONLY_SCENES = arg('scenes', '') ? new Set(arg('scenes', '').split(',')) : null;
const W = 1920; const H = 1080;
const SCENES = ['title', 'heroselect', 'run-start', 'shop-idle', 'reroll', 'drag', 'shop-actions', 'end-turn', 'combat', 'return'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------------------------------------------

const sh = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

function copyDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
}

/** A bench build of the working tree (what the candidate IS, uncommitted edits included). */
function buildWorking() {
  const stamp = `working-${Date.now()}`;
  log(`Building the candidate (this working tree) with VITE_PERF_BENCH=1 ...`);
  sh('npm run build:web', ROOT, { VITE_PERF_BENCH: '1' });
  const dst = path.join(CACHE, 'builds', stamp, 'dist');
  copyDir(path.join(ROOT, 'apps/web/dist'), dst);
  return { dist: dst, label: `working tree (${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--untracked-files=no') ? ' + edits' : ''})` };
}

/** A bench build of a ref, cached by sha (a throwaway worktree with its own npm install, so its packages resolve to
 *  ITS sources, never this checkout's: the worktree-contamination trap in CLAUDE.md). */
function buildRef(ref) {
  try { git('fetch', '-q', 'origin'); } catch { /* offline: use what we have */ }
  const sha = git('rev-parse', ref);
  const dst = path.join(CACHE, 'builds', sha, 'dist');
  if (fs.existsSync(path.join(dst, 'index.html'))) { log(`Baseline ${ref} (${sha.slice(0, 9)}): cached build.`); return { dist: dst, label: `${ref} (${sha.slice(0, 9)})` }; }
  const src = path.join(CACHE, `src-${sha.slice(0, 9)}`);
  log(`Building the baseline ${ref} (${sha.slice(0, 9)}) in a throwaway worktree (npm install + build, a few minutes the first time) ...`);
  try { git('worktree', 'remove', '--force', src); } catch { /* none */ }
  git('worktree', 'add', '--detach', src, sha);
  try {
    sh('npm install --no-audit --no-fund', src);
    sh('npm run build:web', src, { VITE_PERF_BENCH: '1' });
    copyDir(path.join(src, 'apps/web/dist'), dst);
  } finally {
    try { git('worktree', 'remove', '--force', src); } catch { fs.rmSync(src, { recursive: true, force: true }); try { git('worktree', 'prune'); } catch { /* */ } }
  }
  return { dist: dst, label: `${ref} (${sha.slice(0, 9)})` };
}

// ---------------------------------------------------------------------------------------------------------------
// Serving + Chrome
// ---------------------------------------------------------------------------------------------------------------

function serve(dist, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    let f = path.join(dist, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r, rej) => { server.once('error', (e) => rej(new Error(`port ${port} is busy (${e.code}): another perf:gauntlet still running? Pass --port.`))); server.listen(port, '127.0.0.1', () => r(server)); });
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome found: set CHROME_PATH.');
  return hit;
}

async function launch(profile, cdpPort) {
  const flags = [
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--enable-precise-memory-info',
    // A covered window must not be throttled mid-measurement.
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    `--window-size=${W},${H}`, '--window-position=0,0',
  ];
  if (HEADLESS) flags.unshift('--headless=new');
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
  const close = () => { try { sock.close(); } catch { /* closed */ } proc.kill(); };
  return { send, on, close };
}

async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

/** Installed before any page script: a rAF frame recorder, scene marks and a LoAF observer. */
const PROBE = `(() => {
  const cap = 1 << 18;
  const t = new Float64Array(cap); let n = 0; let last = 0;
  const tick = (now) => { if (last && n < cap) t[n++] = now; last = now; requestAnimationFrame(tick); };
  requestAnimationFrame((now) => { last = now; t[n++] = now; requestAnimationFrame(tick); });
  const marks = [];
  const loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push([e.startTime, e.duration, e.blockingDuration || 0]); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
  const hidden = []; // [from, to] spans the page was hidden: their frames are dropped, not judged
  document.addEventListener('visibilitychange', () => { if (document.hidden) hidden.push([performance.now(), Infinity]); else if (hidden.length) hidden[hidden.length - 1][1] = performance.now(); });
  window.__pg = {
    mark: (scene) => { marks.push([performance.now(), scene]); },
    dump: () => ({ t: Array.from(t.subarray(0, n)), marks, loaf, hidden: hidden.map(([a, b]) => [a, b === Infinity ? 1e15 : b]) }),
  };
})();`;

// ---------------------------------------------------------------------------------------------------------------
// Driving the game (desktop: real mouse events through CDP)
// ---------------------------------------------------------------------------------------------------------------

function driver(c) {
  const ev = (e) => evaluate(c, e);
  const visible = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: !!e.disabled }; })()`);
  const byText = (txt) => ev(`(() => { const e = [...document.querySelectorAll('button,[role=button],.btn,a')].find((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === ${JSON.stringify(txt.toUpperCase())}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const mouse = (type, p, extra = {}) => c.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (p) => {
    if (!p || p.disabled) return false;
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await sleep(40);
    await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p);
    return true;
  };
  /** A hand drag: ~one move per 8 ms over `ms`, with a sideways wander, as a player's mouse would. */
  const drag = async (from, to, ms = 700) => {
    if (!from || !to) return false;
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await sleep(30);
    await mouse('mousePressed', from);
    const steps = Math.max(8, Math.round(ms / 8));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      await mouse('mouseMoved', { x: from.x + (to.x - from.x) * k + Math.sin(k * 10) * 30, y: from.y + (to.y - from.y) * k });
      await sleep(8);
    }
    await mouse('mouseReleased', to);
    await sleep(900);
    return true;
  };
  const waitFor = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } return !!(await ev(expr)); };
  return { ev, visible, byText, click, drag, waitFor };
}

/** One full pass of the scenes. Returns the scenes it failed to reach. */
async function playScenes(c) {
  const d = driver(c);
  const mark = (s) => d.ev(`window.__pg.mark(${JSON.stringify(s)})`);
  const missed = [];
  const need = (ok, what) => { if (!ok) missed.push(what); return ok; };
  const g = `window.__bench.store.getState()`;
  const inShop = `document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0`;
  const takeDiscovers = async () => { if (await d.ev('!!window.__pgResolve')) await d.ev('window.__pgResolve()'); };

  if (!need(await d.waitFor(`!!window.__bench && !document.getElementById('bootsplash') && [...document.querySelectorAll('button,[role=button]')].some((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === 'PLAY')`, 120_000), 'title (is this a VITE_PERF_BENCH build?)')) return missed;
  await sleep(2500);
  await mark('title'); await sleep(4000);

  // A Practice game against level-10 bots at a fixed seed: no clock, unlimited health, every hero. The seed is pinned
  // AFTER the setup rolls its own, so both builds play the identical game. Bot seats need no network (God Mode's
  // real-player boards do, and every request off 127.0.0.1 is blocked), and the Gold is topped up each round below
  // so the boards grow like God Mode's.
  await d.ev(`(() => { const s = ${g}; s.startPractice(); s.setPracticeDraft({ godMode: false, opponents: 'bots', botDifficulty: 10, health: 'unlimited', timeMult: 0, heroes: 'all', tribes: ['dwarf'] }); })()`);
  await sleep(600);
  await d.ev(`${g}.confirmPracticeSetup()`);
  need(await d.waitFor(`!!document.querySelector('.herocard.big')`, 15_000), 'heroselect');
  await d.ev(`window.__bench.store.setState({ pendingSeed: ${SEED} })`);
  await sleep(1500);
  await mark('heroselect'); await sleep(3000);

  await mark('run-start');
  const hero = HERO || await d.ev(`(${g}.heroChoices || [])[0] || null`);
  if (hero) await d.ev(`${g}.pickHero(${JSON.stringify(hero)})`); else need(await d.click(await d.visible('.herocard.big')), 'hero pick');
  for (let i = 0; i < 20; i++) { if (await d.click(await d.visible('.hsc-start'))) break; await sleep(500); }
  for (let i = 0; i < 80 && !(await d.ev(inShop)); i++) { if (await d.click(await d.byText('Play anyway'))) await sleep(1000); else await sleep(500); }
  if (!need(await d.ev(inShop), 'first shop')) return missed;
  await takeDiscovers();
  await sleep(2000);

  // Gold for a shop turn (a bench-only write; the game is a throwaway Practice run in a throwaway profile).
  const topUp = () => d.ev(`window.__bench.store.setState((s) => ({ run: { ...s.run, embers: 999 } }))`);
  const wave = () => d.ev(`${g}.run.wave`);
  // OPEN CHOICES, one handler for the whole walk. A DISCOVER (a triple reward or anything else) takes the MIDDLE
  // option and sells the card it gave (owner 2026-10-27: "when discovering a card - simply select the middle one and
  // sell it, whether its from a triple reward or anything else"). Any other choice (Choose One, a target, a quest, the
  // Runeforge) gets the balance bot's greedy pick. Returns how many choices it answered.
  await d.ev(`(async () => {
    const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState();
    // The owner's five, kept BY CARD, not by uid: a triple (two more copies bought from the shop) replaces the board
    // card with a gilded one under a new uid, and that card is still one of the five. Up to the quota per card, gilded
    // copies first; anything past the quota is ordinary filler.
    const QUOTA = { dw_edward: 1, dw_tapkeeper: 2, dw_mountainbond: 1, dw_chef: 1 };
    window.__pgKept = (run) => {
      const left = { ...QUOTA }; const kept = new Set();
      for (const b of [...run.board].sort((x, y) => (y.golden ? 1 : 0) - (x.golden ? 1 : 0))) if (left[b.cardId] > 0) { left[b.cardId]--; kept.add(b.uid); }
      return kept;
    };
    window.__pgResolve = async () => {
      let n = 0;
      for (; n < 20 && sim.modalOpen(S().run); n++) {
        const run = S().run;
        if (run.discover) {
          const opts = Array.isArray(run.discover) ? run.discover : (run.discover.options || run.discover.cards || []);
          const before = new Set(run.hand.map((h) => h.uid));
          S().dispatch({ type: 'discover', index: Math.floor(Math.max(1, opts.length) / 2) });
          if (S().run === run) break;
          const got = S().run.hand.find((h) => !before.has(h.uid));
          if (got) S().dispatch({ type: 'sell', uid: got.uid });
        } else {
          const a = sim.DEFAULT_BOT.act(run);
          if (!a || a.type === 'faceOmen') break;
          S().dispatch(a);
          if (S().run === run) break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      return n;
    };
  })()`);
  const resolveChoices = () => d.ev(`window.__pgResolve()`);

  // THE BOARD (owner 2026-10-27: "put the following on the board. a gilded edward keg hands, two gilded tapkeepers, a
  // mountainbond, and a chef gary toast. buy and play as many cards as you can"). Built on turn 1 through the game's
  // own paths: God Mode's print action puts each card in the shop (the run is flagged God Mode only while printing),
  // three bought copies TRIPLE into the gilded card, and every card is played from hand. They are kept by card
  // (window.__pgKept), so the walk never sells them.
  const setupBoard = () => d.ev(`(async () => {
    const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const settle = () => window.__pgResolve();
    const buyPrinted = async (id) => {
      st.setState((s) => ({ run: { ...s.run, godMode: true, embers: 999 } }));
      S().dispatch({ type: 'godPrint', cardId: id });
      st.setState((s) => ({ run: { ...s.run, godMode: undefined } }));
      const card = S().run.shop[S().run.shop.length - 1];
      if (card && card.cardId === id) S().dispatch({ type: 'buy', uid: card.uid });
      await wait(250); await settle();
    };
    const playFromHand = async (id, golden) => {
      const c = S().run.hand.find((h) => h.cardId === id && !!h.golden === golden);
      if (!c) return null;
      S().dispatch({ type: 'play', uid: c.uid, toIndex: S().run.board.length });
      await wait(400); await settle();
      return S().run.board.find((b) => b.uid === c.uid) ? c.uid : null;
    };
    // The other seats can never be eliminated (as in God Mode, makeGodModeRun): this board wins the lobby by round 13
    // otherwise, and the game ends before the rounds being measured.
    st.setState((s) => ({ run: { ...s.run, lobby: s.run.lobby ? { ...s.run.lobby, seats: s.run.lobby.seats.map((seat, i) => (i === 0 ? seat : { ...seat, invulnerable: true })) } : s.run.lobby } }));
    const keep = [];
    for (const [id, gilded] of [['dw_edward', true], ['dw_tapkeeper', true], ['dw_tapkeeper', true], ['dw_mountainbond', false], ['dw_chef', false]]) {
      for (let k = 0; k < (gilded ? 3 : 1); k++) await buyPrinted(id);
      const uid = await playFromHand(id, gilded);
      if (uid) keep.push(uid);
    }
    return S().run.board.map((b) => b.cardId + (b.golden ? '*' : '')).join(', ');
  })()`);
  // BUY AND PLAY AS MANY CARDS AS YOU CAN (owner 2026-10-27), through the store one action at a time. Any open choice
  // (Discover, Choose One, target, quest, Runeforge) gets the balance bot's greedy pick. Otherwise:
  //   BUYING: cast spells (Ales) as they land in hand; buy from the shop (refresh it when it runs dry) and keep the
  //           minions in hand.
  //   HAND FULL (owner: "when your hand is full, sell the units that are not the ones i specified, and play the other
  //           cards in your hand and sell them all, then continue buying and playing cards/ales"): sell every board
  //           unit that is not one of the five, play the hand (selling a non-key unit again whenever the board is
  //           full), sell the non-key units, then back to BUYING.
  // The five kept cards are never sold.
  const buyPlayTurn = (maxActions, paceMs) => d.ev(`(async () => {
    const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState();
    const CARDS = window.__bench.combat.cards;
    const isSpell = (c) => !!CARDS[c.cardId]?.spell;
    const filler = (run) => { const k = window.__pgKept(run); return run.board.find((b) => !k.has(b.uid)); };
    const tried = new Set(); let n = 0; let rolls = 0; let dumping = false; let cycles = 0;
    S().dispatch({ type: 'upgrade' }); // one tavern tier a turn, so the late shop offers late cards
    for (; n < ${maxActions}; n++) {
      const run = S().run;
      if (run.phase !== 'recruit') break;
      let a = null;
      if (sim.modalOpen(run)) { await window.__pgResolve(); if (sim.modalOpen(S().run)) break; continue; }
      {
        if (!dumping && run.hand.length >= 10) { dumping = true; cycles++; }
        const spell = run.hand.find((c) => isSpell(c) && !tried.has(c.uid));
        if (dumping) {
          const minion = run.hand.find((c) => !isSpell(c) && !tried.has(c.uid));
          const f = filler(run);
          if (spell) a = { type: 'play', uid: spell.uid };
          else if (minion && run.board.length < 7) a = { type: 'play', uid: minion.uid, toIndex: run.board.length };
          else if (minion && f) a = { type: 'sell', uid: f.uid };
          else if (f) a = { type: 'sell', uid: f.uid }; // the hand is played out: sell the rest of the non-key units
          else { dumping = false; tried.clear(); continue; }
          if (a.type === 'play') tried.add(a.uid);
        } else if (spell) { tried.add(spell.uid); a = { type: 'play', uid: spell.uid }; }
        else if (run.shop.length) a = { type: 'buy', uid: run.shop[0].uid };
        else if (rolls < 40) { rolls++; a = { type: 'roll' }; }
      }
      if (!a || a.type === 'faceOmen') break;
      S().dispatch(a);
      if (S().run === run) {
        if (a.type === 'buy' && rolls < 40) { rolls++; S().dispatch({ type: 'roll' }); if (S().run !== run) continue; }
        if (a.type === 'buy' || a.type === 'roll') { if (run.hand.length > 0 && !dumping) { dumping = true; cycles++; continue; } break; } // out of Gold
        if (a.type === 'sell') break; // a refused sell would loop forever
      }
      await new Promise((r) => setTimeout(r, ${paceMs}));
    }
    await window.__pgResolve(); // never leave a choice open: it blocks End Turn
    return n + ' (' + cycles + ' sell cycles)';
  })()`);
  /** End Turn, then the whole fight: measured, or (fast-forward) played out unmeasured. */
  const fight = async (label, watch) => {
    let fought = false;
    for (let i = 0; i < 10 && !fought; i++) {
      await resolveChoices();
      await d.click(await d.visible('.etbwrap'));
      fought = await d.waitFor(`${g}.run.phase === 'combat'`, 2500);
    }
    if (!need(fought, `fight ${label}`)) {
      const shot = await c.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (shot) fs.writeFileSync(path.join(OUT, `noend-${label}.png`), Buffer.from(shot.data, 'base64'));
      log(`   End Turn did not start the fight: ${JSON.stringify(await d.ev(`(() => { const r = ${g}.run; const b = document.querySelector('.etbwrap'); return { phase: r.phase, hand: r.hand.length, board: r.board.length, discover: !!r.discover, chooseOne: !!r.chooseOne, pendingTarget: !!r.pendingTarget, questOffer: !!r.questOffer, powerOffer: !!r.powerOffer, runeforge: !!r.runeforgeOffer, scouted: !!r.scoutedNextOpponent?.length, etb: b ? b.className + ' disabled=' + b.disabled : 'none', overlays: [...document.querySelectorAll('[class*=-ov],[role=dialog]')].filter((x) => x.getClientRects().length).map((x) => x.className.split(' ')[0]).join(',') }; })()`))}`);
      return false;
    }
    if (watch) { await sleep(1200); await mark('combat'); }
    // The replay is over when End Turn turns into "End combat and go back to shop" (`.etbwrap.ready`); during the
    // fight it is the Skip diamond, which the walk NEVER presses: pressing it right as the gate falls, or then ending
    // the fight, left the game stuck in combat in 3 of ~10 runs (2026-10-27, a likely game bug, see the devlog). So
    // fast-forward fights play out in full too, just unmeasured.
    const replayed = await d.waitFor(`${g}.run.phase !== 'combat' || !!document.querySelector('.etbwrap.ready')`, 180_000);
    if (watch) await mark('return');
    // End combat: a press can be swallowed (seen once in ~40 fights, under load), so press again a few times.
    let back = false; let endPresses = 0;
    for (let i = 0; replayed && !back && i < 5; i++) {
      endPresses++;
      const btn = await d.visible('.etbwrap.ready');
      await d.click(btn);
      back = await d.waitFor(`${g}.run.phase !== 'combat'`, 4000);
      // --debug-end: what the exit's wipe machine (wipeMachine.ts curtainClassFor / vistaClassFor) shows after each press.
      if (!back && flag('debug-end')) log(`   (End combat press ${endPresses} at ${label}: ${btn ? 'button found' : 'NO .etbwrap.ready'}, ${await d.ev(`(() => { const c = document.querySelector('.wipecurtain'); const v = document.querySelector('.wipevista, [class*=wipevista]'); const e = document.querySelector('.etbwrap'); return 'curtain=' + (c ? c.className : 'none') + ' | vista=' + (v ? v.className : 'none') + ' | etb=' + (e ? e.className : 'none') + ' | presentationTx=' + JSON.stringify(window.__bench.store.getState().presentationTx?.action?.type ?? null) + ' | endTurnAnimating=' + window.__bench.store.getState().endTurnAnimating; })()`)})`);
    }
    if (back && endPresses > 1) log(`   (End combat needed ${endPresses} presses at ${label}: a press was ignored, a possible game bug)`);
    if (replayed && !back) {
      // Still stuck after five presses (about 1 run in 4, 2026-10-27): resolve the fight through the store, the same
      // resolveCombat the End combat handler commits, so one stuck button does not cost the whole run.
      await d.ev(`(() => { const st = window.__bench.store.getState(); if (st.preparePresentationAction({ type: 'resolveCombat' })) st.commitPresentationAction(); })()`);
      back = await d.waitFor(`${g}.run.phase !== 'combat'`, 5000);
      log(`   (End combat ignored 5 presses at ${label}: resolved through the store${back ? '' : ', still stuck'}; a likely game bug)`);
    }
    if (!need(back, `fight end ${label}`)) {
      // Stalled: leave a screenshot + the visible buttons, so the walk can be fixed.
      const shot = await c.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (shot) fs.writeFileSync(path.join(OUT, `stall-${label}.png`), Buffer.from(shot.data, 'base64'));
      log(`   stalled in combat; buttons: ${await d.ev(`[...document.querySelectorAll('button,[role=button]')].filter((x) => x.getClientRects().length).map((x) => (x.className || '').split(' ')[0] + ':' + (x.innerText || x.getAttribute('aria-label') || '').trim().slice(0, 20)).join(' | ')`)}`);
      return false;
    }
    await d.waitFor(inShop, 20_000);
    return true;
  };

  // FAST-FORWARD (unmeasured) to round FROM: every shop turn is the buy-and-play turn and the fights play out, so the run
  // arrives at the late game carrying everything a long game piles up (a full board, tallies, quests, runes).
  await mark('ff');
  log(`   board: ${await setupBoard()}`);
  log(`   fast-forward to round ${FROM} ...`);
  for (let guard = 0; guard < 40 && (await wave()) < FROM; guard++) {
    await topUp();
    await buyPlayTurn(150, FF_ACTION_MS);
    if (!(await fight(`ff-r${await wave()}`, false))) return missed;
    await sleep(800);
  }

  // MEASURED: rounds FROM..TO, played in full.
  while ((await wave()) <= TO) {
    const r = await wave();
    // The game can end before --to (owner 2026-10-27: "its ok if it doesnt get to 14"): the rounds measured so far stand.
    if ((await d.ev(`${g}.run.phase`)) === 'gameover') { log(`   the game ended before round ${r}: measured up to round ${r - 1}`); break; }
    await topUp();
    await takeDiscovers();
    await mark('shop-idle'); await sleep(3000);
    await mark('reroll');
    await d.click(await d.visible('.tvbwrap')); await sleep(1000);
    for (let k = 0; k < 3; k++) { await d.click(await d.visible('.rfbwrap')); await sleep(900); }
    // Hand drags with a full late-game board: sell one FILLER board card into the tavern, buy one, play it, reorder.
    await mark('drag');
    const tavern = await d.visible('[data-zone="tavern"]');
    const filler = await d.ev(`(() => { const k = window.__pgKept(window.__bench.store.getState().run); const e = [...document.querySelectorAll('[data-zone="warband"] .row .card[data-uid]')].find((x) => x.getClientRects().length && !k.has(x.getAttribute('data-uid'))); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (filler) await d.drag(filler, tavern ? { x: tavern.x, y: tavern.y } : null, 800); // never one of the five
    need(await d.drag(await d.visible('[data-zone="tavern"] .row .card[data-uid]'), await d.visible('[data-zone="warband"]')), `buy r${r}`);
    await mark('shop-idle'); await takeDiscovers(); await mark('drag');
    await d.drag(await d.visible('[data-zone="hand"] .card[data-uid]'), await d.visible('[data-zone="warband"]'));
    await mark('shop-idle'); await takeDiscovers(); await mark('drag');
    const first = await d.visible('[data-zone="warband"] .row .card[data-uid]');
    const lastCard = await d.ev(`(() => { const a = [...document.querySelectorAll('[data-zone="warband"] .row .card[data-uid]')].filter((x) => x.getClientRects().length); const e = a[a.length - 1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.right + 40, y: r.top + r.height / 2 }; })()`);
    await d.drag(first, lastCard, 900);
    // The rest of the turn the way a late game spends it: lots of buys, plays and spells (measured as its own scene).
    await mark('shop-actions');
    const acts = await buyPlayTurn(150, 60);
    log(`   round ${r}: kept ${await d.ev(`window.__pgKept(${g}.run).size`)}/5, board ${await d.ev(`${g}.run.board.length`)}, tier ${await d.ev(`${g}.run.tier`)}, hand ${await d.ev(`${g}.run.hand.length`)}, actions ${acts}`);
    await sleep(1000);
    await mark('end-turn');
    if (!(await fight(`r${r}`, true))) break;
    await sleep(2500);
  }
  await mark('end');
  await d.ev(`${g}.openTitle()`).catch(() => {});
  return missed;
}

// ---------------------------------------------------------------------------------------------------------------
// One measured run of one build
// ---------------------------------------------------------------------------------------------------------------

const METRIC_KEYS = ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'];

async function measureOnce(dist, runIdx) {
  const port = PORT + runIdx * 2;
  const server = await serve(dist, port);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ascent-perf-gauntlet-'));
  const c = await launch(profile, port + 1);
  const metricMarks = []; // [wallclock page time, scene, metrics]
  const profiles = []; let profiling = false;
  const traceEvents = []; let tracing = false;
  // --trace: Chrome's own timeline events while the chosen scene is on. Tracing.end flushes them asynchronously,
  // so stopping waits for tracingComplete.
  const stopTrace = async (send) => {
    const complete = new Promise((r) => c.on('Tracing.tracingComplete', r));
    await send('Tracing.end');
    await Promise.race([complete, sleep(20000)]);
    tracing = false;
  };
  try {
    if (TRACE) c.on('Tracing.dataCollected', (p) => { for (const e of p.value) traceEvents.push(e); });
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Performance.enable', { timeDomain: 'timeTicks' });
    if (PROFILE) { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 250 }); }
    c.on('Runtime.exceptionThrown', (p) => log(`   (page exception: ${String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '').split('\n')[0]})`));
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    c.on('Fetch.requestPaused', (p) => {
      const local = /^https?:\/\/127\.0\.0\.1[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url);
      void (local ? c.send('Fetch.continueRequest', { requestId: p.requestId }) : c.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
    });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.bringToFront').catch(() => {});
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    // Main-thread work is sampled at each scene mark: wrap __pg.mark from the outside.
    const metrics = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.filter((m) => METRIC_KEYS.includes(m.name)).map((m) => [m.name, m.value * 1000]));
    const origSend = c.send;
    const cc = { ...c, send: async (method, params) => {
      if (method === 'Runtime.evaluate' && /window\.__pg\.mark\(/.test(params?.expression || '')) {
        const r = await origSend(method, params);
        const scene = /mark\("([^"]+)"\)/.exec(params.expression)?.[1];
        metricMarks.push([scene, await metrics()]);
        // --profile: the CPU profiler runs only while the chosen scene is on.
        if (profiling && scene !== PROFILE) { profiles.push((await origSend('Profiler.stop')).profile); profiling = false; }
        if (!profiling && PROFILE && scene === PROFILE) { await origSend('Profiler.start'); profiling = true; }
        // --anim-census <scene>: which CSS animations / transitions / WAAPI animations are running during that scene,
        // by name and target, sampled three times (an animation dirties its element's style every frame).
        if (arg('anim-census', '') === scene) {
          for (const ms of [1500, 3000, 4500]) setTimeout(() => { void origSend('Runtime.evaluate', { returnByValue: true, expression: `(() => {
            const by = new Map();
            for (const a of document.getAnimations()) {
              if (a.playState !== 'running') continue;
              const t = a.effect && a.effect.target; const el = t && (t.nodeType === 1 ? t : null);
              const cls = el ? (el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) : '?';
              const name = a.animationName || (a.transitionProperty ? 'transition:' + a.transitionProperty : (a.id || 'waapi'));
              const props = a.effect && a.effect.getKeyframes ? [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))))].join('+') : '';
              const key = name + ' [' + props + '] on ' + cls;
              by.set(key, (by.get(key) || 0) + 1);
            }
            return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
          })()` }).then((r) => log(`   anim census @${ms}ms in ${scene}:\n` + (r.result.value || []).map(([k, n]) => `     x${String(n).padEnd(4)} ${k}`).join('\n'))).catch(() => {}); }, ms);
        }
        if (tracing && scene !== TRACE) await stopTrace(origSend);
        if (!tracing && TRACE && scene === TRACE) {
          await origSend('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-blink.debug', 'v8.execute', '__metadata'] } });
          tracing = true;
        }
        return r;
      }
      return origSend(method, params);
    } };
    const missed = await playScenes(cc);
    if (profiling) profiles.push((await c.send('Profiler.stop')).profile);
    if (tracing) await stopTrace(c.send);
    const dump = await evaluate(c, 'window.__pg.dump()');
    return { missed, dump, metricMarks, profiles, traceEvents };
  } finally {
    c.close(); server.close();
    await sleep(600);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// --profile: where the CPU went during one scene, by function, named through the bench build's hidden source maps
// ---------------------------------------------------------------------------------------------------------------

const require_ = createRequire(import.meta.url);
const mapCache = new Map();
function mapFor(dist, url) {
  if (mapCache.has(url)) return mapCache.get(url);
  let consumer = null;
  try {
    const file = path.join(dist, new URL(url).pathname + '.map');
    if (fs.existsSync(file)) { const { SourceMapConsumer } = require_('source-map-js'); consumer = new SourceMapConsumer(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  } catch { /* no map: minified names */ }
  mapCache.set(url, consumer);
  return consumer;
}

/** Self time per function over every profiled stretch of a run, biggest first. For a NATIVE function (a browser API
 *  such as getBoundingClientRect or drawImage, which has no source of its own) the time is also split by the JS that
 *  called it, two frames deep, since "who forced the layout" is the actual question. */
function summariseProfiles(profiles, dist) {
  const self = new Map(); const callers = new Map(); let total = 0;
  const nameOf = (f) => {
    let key = f.functionName || '(anonymous)';
    if (f.url && /^https?:/.test(f.url)) {
      const m = mapFor(dist, f.url);
      const o = m ? m.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber }) : null;
      key = o && o.source ? `${o.name || f.functionName || '(anonymous)'}  ${o.source.replace(/^.*?(packages|node_modules)\//, '$1/')}:${o.line}` : `${key}  ${f.url.replace(/^.*\//, '')}:${f.lineNumber + 1}`;
    }
    return key;
  };
  for (const prof of profiles) {
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of prof.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
    const names = new Map();
    const nm = (n) => { if (!names.has(n.id)) names.set(n.id, nameOf(n.callFrame)); return names.get(n.id); };
    for (let i = 0; i < prof.samples.length; i++) {
      const node = byId.get(prof.samples[i]); const dt = (prof.timeDeltas[i] || 0) / 1000; // ms
      if (!node) continue;
      total += dt;
      const key = nm(node);
      self.set(key, (self.get(key) || 0) + dt);
      if (!node.callFrame.url && !/^\(/.test(key)) {
        const chain = []; let p = parent.get(node.id);
        while (p !== undefined && chain.length < 2) { const pn = byId.get(p); if (pn.callFrame.url) chain.push(nm(pn).replace(/\s+/, ' @ ')); p = parent.get(p); }
        const c = callers.get(key) || new Map(); const ck = chain.join('  <  ') || '(no JS caller)';
        c.set(ck, (c.get(ck) || 0) + dt); callers.set(key, c);
      }
    }
  }
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]);
  const callerRows = new Map([...callers.entries()].map(([k, c]) => [k, [...c.entries()].sort((a, b) => b[1] - a[1])]));
  return { total, rows, callerRows };
}

/** --trace: main-thread time by event (style, layout, paint, script, GC), and the layouts / style recalcs that JS
 *  FORCED, grouped by the code that forced them (source-mapped). A forced layout is the expensive kind: it runs in
 *  the middle of the frame, and if anything writes after it, the browser lays out a second time before paint. */
function summariseTrace(events, dist) {
  const mains = events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const count = new Map();
  for (const e of events) if (e.ph === 'X') { const k = `${e.pid}:${e.tid}`; count.set(k, (count.get(k) || 0) + 1); }
  const main = mains.map((m) => `${m.pid}:${m.tid}`).sort((a, b) => (count.get(b) || 0) - (count.get(a) || 0))[0];
  const on = events.filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === main);
  const NAMES = ['RunTask', 'FunctionCall', 'FireAnimationFrame', 'TimerFire', 'EventDispatch', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'BeginMainThreadFrame'];
  const byName = new Map();
  for (const e of on) if (NAMES.includes(e.name)) { const r = byName.get(e.name) || { ms: 0, n: 0 }; r.ms += (e.dur || 0) / 1000; r.n++; byName.set(e.name, r); }
  const frame = (f) => {
    const m = f.url && /^https?:/.test(f.url) ? mapFor(dist, f.url) : null;
    const o = m ? m.originalPositionFor({ line: f.lineNumber, column: Math.max(0, (f.columnNumber || 1) - 1) }) : null;
    return o && o.source ? `${o.name || f.functionName || '(anonymous)'} @ ${o.source.replace(/^.*?(packages|node_modules)\//, '$1/')}:${o.line}` : `${f.functionName || '(anonymous)'} @ ${(f.url || '').replace(/^.*\//, '')}:${f.lineNumber}`;
  };
  const forced = { Layout: new Map(), UpdateLayoutTree: new Map() };
  const forcedTotal = { Layout: 0, UpdateLayoutTree: 0 };
  for (const e of on) {
    if (e.name !== 'Layout' && e.name !== 'UpdateLayoutTree') continue;
    const st = e.args?.beginData?.stackTrace;
    if (!st || !st.length) continue;
    const ms = (e.dur || 0) / 1000;
    forcedTotal[e.name] += ms;
    const key = st.slice(0, 2).map(frame).join('  <  ');
    const r = forced[e.name].get(key) || { ms: 0, n: 0 }; r.ms += ms; r.n++; forced[e.name].set(key, r);
  }
  // Who DIRTIED style: ScheduleStyleRecalculation / InvalidateLayout carry the JS stack that wrote (with the .stack category).
  const dirtied = new Map();
  for (const e of events) {
    if ((e.name !== 'ScheduleStyleRecalculation' && e.name !== 'InvalidateLayout') || `${e.pid}:${e.tid}` !== main) continue;
    const st = e.args?.data?.stackTrace;
    const key = `${e.name === 'InvalidateLayout' ? 'layout' : 'style'}  ${st && st.length ? st.slice(0, 2).map(frame).join('  <  ') : '(no JS: animation / browser)'}`;
    dirtied.set(key, (dirtied.get(key) || 0) + 1);
  }
  // The biggest single style recalcs (element count = how much of the tree each one touched).
  const bigRecalcs = on.filter((e) => e.name === 'UpdateLayoutTree').sort((a, b) => b.dur - a.dur).slice(0, 8)
    .map((e) => `${(e.dur / 1000).toFixed(1)} ms, ${e.args?.elementCount ?? '?'} elements${e.args?.beginData?.stackTrace ? ', forced by ' + frame(e.args.beginData.stackTrace[0]) : ''}`);
  const lines = [];
  const frames = on.filter((e) => e.name === 'AnimationFrame' || e.name === 'BeginMainThreadFrame').length;
  lines.push(`main thread: ${frames} frames begun`);
  for (const n of NAMES) { const r = byName.get(n); if (r && n !== 'BeginMainThreadFrame') lines.push(`  ${n.padEnd(20)} ${r.ms.toFixed(0).padStart(7)} ms  x${r.n}`); }
  for (const kind of ['Layout', 'UpdateLayoutTree']) {
    const all = byName.get(kind) || { ms: 0, n: 0 };
    lines.push(`FORCED ${kind === 'Layout' ? 'layout' : 'style recalc'}: ${forcedTotal[kind].toFixed(0)} ms of ${all.ms.toFixed(0)} ms (${all.n} in all, ${frames ? (all.n / frames).toFixed(2) : '?'} a frame), by the code that forced it:`);
    for (const [k, r] of [...forced[kind].entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)) lines.push(`  ${r.ms.toFixed(0).padStart(7)} ms  x${String(r.n).padEnd(6)} ${k}`);
  }
  lines.push('biggest single style recalcs:', ...bigRecalcs.map((l) => '  ' + l));
  // CSS selector cost (DevTools 'selector stats', the blink.debug category): which rules the recalcs spent their time on.
  const sel = new Map();
  for (const e of events) {
    const t = e.args?.selector_stats?.selector_timings;
    if (!t) continue;
    for (const x of t) { const r = sel.get(x.selector) || { us: 0, attempts: 0, matches: 0 }; r.us += x['elapsed (us)'] || 0; r.attempts += x.match_attempts || 0; r.matches += x.match_count || 0; sel.set(x.selector, r); }
  }
  if (sel.size) {
    lines.push('costliest CSS selectors (total match time over the scene):');
    for (const [k, r] of [...sel.entries()].sort((a, b) => b[1].us - a[1].us).slice(0, 20)) lines.push(`  ${(r.us / 1000).toFixed(1).padStart(7)} ms  ${String(r.attempts).padStart(8)} tries ${String(r.matches).padStart(7)} hits  ${k.slice(0, 140)}`);
  }
  lines.push('who dirtied style / layout (count):');
  for (const [k, n] of [...dirtied.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) lines.push(`  x${String(n).padEnd(6)} ${k}`);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Analysis (the pure rules live in packages/tools/src/perfGauntletStats.ts, unit-tested)

/** Per-scene stats for one run. */
function analyse(run) {
  const { t, marks, loaf, hidden } = run.dump;
  const { by, hiddenFrames, intervals } = framesByScene(t, marks, hidden, ['end', 'ff']);
  const interval = refreshInterval(intervals);
  const hz = 1000 / interval;
  const sceneAt = (time) => { let s = null; for (const [mt, sc] of marks) { if (mt <= time) s = sc; else break; } return s; };
  // Main-thread ms per scene: the metric delta from each mark to the next, summed per scene.
  const work = new Map();
  for (let i = 0; i + 1 < run.metricMarks.length; i++) {
    const [s, m0] = run.metricMarks[i]; const m1 = run.metricMarks[i + 1][1];
    if (!s || s === 'end' || s === 'ff') continue;
    const w = work.get(s) || { task: 0, script: 0, style: 0, layout: 0 };
    w.task += (m1.TaskDuration ?? 0) - (m0.TaskDuration ?? 0);
    w.script += (m1.ScriptDuration ?? 0) - (m0.ScriptDuration ?? 0);
    w.style += (m1.RecalcStyleDuration ?? 0) - (m0.RecalcStyleDuration ?? 0);
    w.layout += (m1.LayoutDuration ?? 0) - (m0.LayoutDuration ?? 0);
    work.set(s, w);
  }
  const scenes = {};
  for (const [s, dts] of by) scenes[s] = sceneStats(dts, interval, work.get(s) || { task: 0, script: 0, style: 0, layout: 0 }, loaf.filter(([st]) => sceneAt(st) === s), BUDGET);
  return { hz, interval, scenes, missed: run.missed, hiddenFrames };
}

const fmt = (x, d = 1) => (x === undefined || x === null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));


function report(folded, hz, names) {
  const lines = [];
  const p = (l = '') => { lines.push(l); };
  p(`PERF GAUNTLET  budget ${BUDGET} ms (240 Hz)  display ~${Math.round(hz)} Hz  ${RUNS} run(s)/build, measured rounds ${FROM}-${TO} (1-${FROM - 1} fast-forwarded)${HEADLESS ? '  HEADLESS: frame intervals are NOT real, judge on work/frame' : ''}`);
  p(`Per scene, the median across runs. Winner: X / Y = better on EVERY run AND by a real margin (10% on times/work, 25% on counts, 1 refresh on p95/p99); ~ = noise; worst never decides (·).`);
  if (RUNS === 1) p('ONE run a build: a quick screen (a single odd run fakes a win ~1 time in 9 on the target scene); confirm a win with --runs 2.');
  p(`Order of judgement (docs/performance.md §0): worst, then long/jank, then p95. work = main-thread ms per frame.`);
  p();
  const cols = [['worst', 1], ['long', 0], ['jank', 0], ['p95', 1], ['p99', 1], ['workPerFrame', 2], ['loafBlocking', 0]];
  for (const s of SCENES) {
    if (ONLY_SCENES && !ONLY_SCENES.has(s)) continue;
    const rows = names.map((n) => [n, folded[n]?.[s]]);
    if (rows.every(([, r]) => !r)) continue;
    p(`${s}`);
    for (const [n, r] of rows) {
      if (!r) { p(`   ${n}  (not reached)`); continue; }
      p(`   ${n}  frames ${String(Math.round(r.frames.med)).padStart(5)}  ` + cols.map(([k, d]) => `${k === 'workPerFrame' ? 'work' : k === 'loafBlocking' ? 'LoAF block' : k} ${fmt(r[k].med, d).padStart(6)}`).join('  ') + `   budget: ${budgetVerdict(r, hz, HEADLESS, BUDGET)}`);
    }
    if (names.length === 2) {
      const [a, b] = names.map((n) => folded[n]?.[s]);
      p(`   winner  ` + cols.map(([k]) => `${k === 'workPerFrame' ? 'work' : k === 'loafBlocking' ? 'LoAF' : k}:${winner(a, b, k, 1000 / hz) || '-'}`).join('  '));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true });
let builds;
try {
  if (arg('only', '')) builds = [{ dist: path.resolve(arg('only')), label: arg('only') }];
  else if (arg('a', '') && arg('b', '')) builds = [{ dist: path.resolve(arg('a')), label: arg('a') }, { dist: path.resolve(arg('b')), label: arg('b') }];
  else builds = [buildWorking(), buildRef(arg('base', 'origin/main'))];
  for (const b of builds) if (!fs.existsSync(path.join(b.dist, 'index.html'))) throw new Error(`No build at ${b.dist}`);
} catch (e) { console.error(String(e.message || e)); process.exit(2); }

// Blind: shuffle the builds into X / Y.
const names = builds.length === 2 ? ['X', 'Y'] : ['X'];
const order = builds.length === 2 && crypto.randomInt(2) === 1 ? [1, 0] : [0, 1];
const blind = Object.fromEntries(names.map((n, i) => [n, builds[order[i]]]));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(Object.fromEntries(Object.entries(blind).map(([n, b]) => [n, b.label])), null, 1));

// Interleave A B B A A B ... so drift (thermals, background work) lands on both builds evenly.
const schedule = [];
for (let r = 0; r < RUNS; r++) schedule.push(...(names.length === 2 ? (r % 2 ? ['Y', 'X'] : ['X', 'Y']) : ['X']));
log(`\n${schedule.length} measured run(s): ${schedule.join(' ')}. Keep the Chrome window visible and the machine idle.\n`);
const results = Object.fromEntries(names.map((n) => [n, []]));
let failed = 0;
for (let i = 0; i < schedule.length; i++) {
  const n = schedule[i];
  log(`run ${i + 1}/${schedule.length}: build ${n}`);
  try {
    let raw = await measureOnce(blind[n].dist, i);
    // A run that lost a scene (the intermittent stuck End combat, 2026-10-27) is run again once, so one stuck fight
    // does not cost the comparison. The retry's numbers replace the failed run's.
    if (raw.missed.length && !flag('no-retry')) {
      log(`   missed: ${raw.missed.join(', ')}; running build ${n} again`);
      raw = await measureOnce(blind[n].dist, i);
    }
    if (TRACE && raw.traceEvents?.length) {
      const tl = summariseTrace(raw.traceEvents, blind[n].dist);
      fs.writeFileSync(path.join(OUT, `trace-run${i + 1}-${n}.json`), JSON.stringify({ traceEvents: raw.traceEvents })); // DevTools > Performance > Load
      fs.writeFileSync(path.join(OUT, `trace-run${i + 1}-${n}.txt`), [`${TRACE}:`, ...tl, ''].join('\n'));
      log([`   trace (${TRACE}):`, ...tl.map((l) => '     ' + l)].join('\n'));
    }
    if (PROFILE && raw.profiles?.length) {
      const { total, rows, callerRows } = summariseProfiles(raw.profiles, blind[n].dist);
      fs.writeFileSync(path.join(OUT, `profile-run${i + 1}-${n}.cpuprofile.json`), JSON.stringify(raw.profiles)); // DevTools > Performance can load one
      const pct = (ms) => `${ms.toFixed(0).padStart(7)} ms ${(100 * ms / total).toFixed(1).padStart(5)}%`;
      const lines = [];
      for (const [k, ms] of rows.slice(0, 40)) {
        lines.push(`${pct(ms)}  ${k}`);
        for (const [c, cms] of (callerRows.get(k) || []).slice(0, 6)) if (cms >= ms * 0.03) lines.push(`          ${pct(cms)}    from ${c}`);
      }
      fs.writeFileSync(path.join(OUT, `profile-run${i + 1}-${n}.txt`), [`${PROFILE}: ${total.toFixed(0)} ms profiled (self time)`, ...lines, ''].join('\n'));
      log([`   profile (${PROFILE}, ${total.toFixed(0)} ms, top 12 by self time):`, ...lines.slice(0, 12).map((l) => '     ' + l)].join('\n'));
    }
    const a = analyse(raw);
    if (a.missed.length) { failed++; log(`   missed: ${a.missed.join(', ')}`); }
    if (a.hiddenFrames) log(`   WARNING: ${a.hiddenFrames} frame(s) inside a scene ran while the page was hidden (dropped from the report). Keep the window visible.`);
    log(`   display ~${Math.round(a.hz)} Hz, ${Object.values(a.scenes).reduce((s, x) => s + x.frames, 0)} frames`);
    results[n].push(a);
  } catch (e) { failed++; log(`   run failed: ${String(e.message || e).slice(0, 300)}`); }
}
const hz = median(Object.values(results).flat().map((r) => r.hz));
const folded = Object.fromEntries(names.map((n) => [n, foldRuns(results[n].map((r) => r.scenes), SCENES)]));
const text = report(folded, hz, names);
fs.writeFileSync(path.join(OUT, 'report.txt'), text + '\n');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ budget: BUDGET, hz, runs: RUNS, from: FROM, to: TO, seed: SEED, headless: HEADLESS, folded, raw: results }, null, 1));
log('\n' + text + '\n');
log(`Report: ${path.join(OUT, 'report.txt')}`);
if (BLIND) log(`Blind: the key (which of X / Y is which build) is in ${path.join(OUT, 'key.json')}`);
else log(`Key: ${names.map((n) => `${n} = ${blind[n].label}`).join('   ')}`);
process.exit(failed ? 1 : 0);
