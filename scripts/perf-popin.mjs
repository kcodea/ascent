#!/usr/bin/env node
/**
 * THE POP-IN WALK (owner 2026-11-04: "i am seeing a ton of art pop in"). Serves a PRODUCTION bench build
 * (`VITE_PERF_BENCH=1 npm run build:web`) and drives it through a fixed session with the pop-in probe on
 * (`packages/ui/src/popIn.ts`, `?popin=1`): the title, every menu page, hero select, shop rounds with a bot's buys and
 * plays, whole fights, the end screen. Prints the probe's report per run, split by cause.
 *
 * It runs Playwright's bundled headless shell in a throwaway profile, never a system browser, and blocks every request
 * off 127.0.0.1, so nothing reaches the live backend.
 *
 *   --dist <dir>        the build (default apps/web/dist)
 *   --port <n>          static server port (default 4630)
 *   --headers <mode>    netlify  : apps/web/public/_headers, as Netlify serves them (default)
 *                       nocache  : every file `no-cache` + ETag, as `vite` and `vite preview` serve them
 *                       stale:<s>: _headers with every max-age under a year cut to <s> seconds: an hour-old tab, in <s> s
 *                       expire:<s>: a RETURNING player. Visit one only preloads, with max-age cut to <s>; the walk
 *                                 waits it out, then visit two plays under the real _headers with every copy expired
 *   --url <origin>      drive a server that is already up instead (the dev server: VITE_PERF_BENCH=1 npx vite --port N)
 *   --rtt <ms>          latency added to every response (default 20)
 *   --rounds <n>        shop rounds played (default 4)
 *   --visits <list>     comma list of cold,warm (default cold,warm): the second reuses the first's profile
 *   --gpu               ask for GPU raster on SwiftShader, the path a real GPU takes (slow; decode cache differs)
 *   --trace             the compositor's own count: decodes, and tiles drawn without a picture that landed late
 *   --no-probe          leave the probe off (its decode() calls warm what they ask for, so a clean --trace wants this)
 *   --out <file>        write every run's report as JSON
 *   --budget <n>        exit 1 when a warm visit shows more than <n> pop-ins on screen (for a CI tripwire)
 *
 * What headless cannot show: the real GPU's tile raster (a blank tile on a moving layer) and the budget of its decoded
 * image cache. See docs/performance.md.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const PORT = Number(arg('port', '4630'));
const HEADERS = arg('headers', 'netlify');
const RTT = Number(arg('rtt', '20'));
const ROUNDS = Number(arg('rounds', '4'));
const VISITS = arg('visits', 'cold,warm').split(',');
const OUT = arg('out', '');
const BUDGET = arg('budget', '');
const PROBE = !flag('no-probe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/** Bundled headless shell: the newest installed, whatever revision this playwright-core expects. */
function headlessShell() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), process.platform === 'win32' ? 'ms-playwright' : 'ms-playwright');
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    for (const rel of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win/headless_shell.exe', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error(`no bundled headless shell under ${root} (npx playwright-core install chromium-headless-shell)`);
}

// ─── the server ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `_headers` -> [{ test, cacheControl }]. Only Cache-Control matters here. */
function parseHeaders(file) {
  const rules = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = line.trim(); continue; }
    const m = /^\s+Cache-Control:\s*(.+)$/i.exec(line);
    if (m && cur) rules.push({ re: new RegExp(`^${cur.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), cc: m[1].trim() });
  }
  return rules;
}
const URL_ARG = arg('url', '');
const RULES = URL_ARG ? [] : parseHeaders(path.join(DIST, '_headers'));
const NETLIFY_DEFAULT = 'public, max-age=0, must-revalidate';
function cacheControl(p) {
  if (HEADERS === 'nocache') return 'no-cache';
  const hit = RULES.find((r) => r.re.test(p));
  const cc = hit ? hit.cc : NETLIFY_DEFAULT;
  if (HEADERS.startsWith('expire:') && visitIndex > 0) return cc;
  if (HEADERS.startsWith('stale:') || HEADERS.startsWith('expire:')) return cc.replace(/max-age=(\d+)/, (m, s) => (Number(s) > 0 && Number(s) < 31536000 ? `max-age=${HEADERS.split(':')[1]}` : m));
  return cc;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };
let visitIndex = 0;
const etags = new Map();
const served = { n200: 0, n304: 0, bytes: 0 };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p === '/' ? 'index.html' : p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  let tag = etags.get(f);
  if (!tag) { const st = fs.statSync(f); tag = `"${crypto.createHash('sha1').update(`${f}${st.size}${st.mtimeMs}`).digest('hex').slice(0, 16)}"`; etags.set(f, tag); }
  const headers = { 'Cache-Control': cacheControl(p), ETag: tag, 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' };
  setTimeout(() => {
    if (req.headers['if-none-match'] === tag) { served.n304++; res.writeHead(304, headers); res.end(); return; }
    const body = fs.readFileSync(f);
    served.n200++; served.bytes += body.length;
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(body);
  }, RTT);
});

// ─── the walk ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function walk(page, onTitle) {
  const g = 'window.__bench.store.getState()';
  const ev = (s) => page.evaluate(s);
  const wait = async (s, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(s).catch(() => false)) return true; await sleep(150); } return false; };
  const click = async (sel) => {
    const box = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    return true;
  };
  const inShop = `document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0`;

  if (!await wait(`!!window.__bench && ${PROBE ? '!!window.__popin &&' : ''} !document.getElementById('bootsplash')`, 180_000)) throw new Error('title never came up (a VITE_PERF_BENCH build?)');
  if (onTitle) await onTitle();
  if (HEADERS.startsWith('expire:') && visitIndex === 0) { await sleep(3000); return; }
  const gate = await ev('window.__artGate');
  log(`   gate: ${JSON.stringify(gate)}`);
  await sleep(2500);

  // The menus, the way the rail goes to them.
  for (const dest of ['modes', 'collection', 'career', 'rankings', 'hall', 'recent', 'live', 'settings', 'patchnotes', 'menu']) {
    await ev(`${g}.goTo(${JSON.stringify(dest)})`);
    await sleep(1400);
  }

  // A Practice game against bots: no clock, unlimited health, needs no network.
  await ev(`(() => { const s = ${g}; s.startPractice(); s.setPracticeDraft({ godMode: false, opponents: 'bots', botDifficulty: 10, health: 'unlimited', timeMult: 0, heroes: 'all', tribes: ['dwarf', 'dragon', 'beast', 'undead'] }); })()`);
  await sleep(800);
  await ev(`${g}.confirmPracticeSetup()`);
  if (!await wait(`!!document.querySelector('.herocard.big')`, 15_000)) throw new Error('no hero select');
  await ev(`window.__bench.store.setState({ pendingSeed: 424242 })`);
  await sleep(2500);
  await ev(`${g}.pickHero((${g}.heroChoices || [])[0])`);
  for (let i = 0; i < 20; i++) { if (await click('.hsc-start')) break; await sleep(500); }
  if (!await wait(inShop, 45_000)) throw new Error('no first shop');
  await sleep(1500);

  for (let round = 1; round <= ROUNDS; round++) {
    await ev(`(async () => {
      const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState();
      st.setState((s) => ({ run: { ...s.run, embers: 60 } }));
      S().dispatch({ type: 'upgrade' });
      for (let n = 0; n < 40; n++) {
        const run = S().run;
        if (run.phase !== 'recruit') break;
        let a = sim.DEFAULT_BOT.act(run);
        if (!a || a.type === 'faceOmen' || a.type === 'endTurn' || a.type === 'end') { if (n % 3 === 0) { a = { type: 'roll' }; } else break; }
        S().dispatch(a);
        if (S().run === run) { if (sim.modalOpen(run) && run.discover) S().dispatch({ type: 'discover', index: 0 }); if (S().run === run) break; }
        await new Promise((r) => setTimeout(r, 220));
      }
    })()`).catch((e) => log(`   (bot: ${String(e).slice(0, 120)})`));
    await sleep(600);
    let fought = false;
    for (let i = 0; i < 10 && !fought; i++) {
      await ev(`(async () => { const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState(); for (let n = 0; n < 12 && sim.modalOpen(S().run); n++) { const run = S().run; const a = run.discover ? { type: 'discover', index: 0 } : sim.DEFAULT_BOT.act(run); if (!a || a.type === 'faceOmen') break; S().dispatch(a); if (S().run === run) break; await new Promise((r) => setTimeout(r, 120)); } })()`);
      await click('.etbwrap');
      fought = await wait(`${g}.run.phase === 'combat'`, 3000);
      if (!fought && await ev(`!!document.querySelector('.etbwrap.pressed')`)) fought = await wait(`${g}.run.phase === 'combat'`, 40_000);
    }
    if (!fought) { log(`   round ${round}: End Turn did not start a fight`); break; }
    await wait(`${g}.run.phase !== 'combat' || !!document.querySelector('.etbwrap.ready')`, 120_000);
    let back = false;
    for (let i = 0; i < 5 && !back; i++) { await click('.etbwrap.ready'); back = await wait(`${g}.run.phase !== 'combat'`, 4000); }
    if (!back) { await ev(`(() => { const st = ${g}; if (st.preparePresentationAction({ type: 'resolveCombat' })) st.commitPresentationAction(); })()`); back = await wait(`${g}.run.phase !== 'combat'`, 5000); }
    if (!back) { log(`   round ${round}: stuck in combat`); break; }
    await wait(inShop, 20_000);
    await sleep(1200);
    log(`   round ${round} done`);
  }

  // The end screen.
  await ev(`window.__bench.store.setState((s) => ({ run: { ...s.run, phase: 'gameover' } }))`);
  await sleep(3500);
}

/**
 * --trace: the compositor's own word on images, which no page API can see. Decodes it ran (with the walk's boot behind
 * it: the trace starts once the title is up), and how often it drew a tile WITHOUT a picture and went back for it (cc's
 * checker imaging: `CheckerImageTracker::DeferImageDecode`). That second one is a real pop-in, visible on screen.
 */
async function startTrace(cdp) {
  const events = [];
  cdp.on('Tracing.dataCollected', (m) => { for (const e of m.value) if (/decode|checker|PaintImage/i.test(e.name)) events.push(e); });
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['cc', 'disabled-by-default-cc.debug', 'devtools.timeline', 'disabled-by-default-devtools.timeline'] }, transferMode: 'ReportEvents' });
  return async () => {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end');
    await done;
    const decodes = events.filter((e) => e.name === 'GpuImageDecodeCache::DecodeImage' && e.dur && e.args?.paint_image_id !== undefined);
    const raster = events.filter((e) => e.name === 'Decode Image' && e.dur);
    const ids = new Map();
    for (const e of decodes) ids.set(e.args.paint_image_id, (ids.get(e.args.paint_image_id) || 0) + 1);
    const big = {};
    for (const e of events) {
      const d = e.name === 'PaintImage' ? e.args?.data : null;
      if (!d?.isCSS || d.srcWidth * d.srcHeight * 4 < 512 * 1024) continue;
      const k = `${String(d.nodeName).slice(0, 40)} ${Math.round(d.srcWidth)}x${Math.round(d.srcHeight)}`;
      big[k] = (big[k] || 0) + 1;
    }
    return {
      // Each begin = one picture the compositor left out of a tile and went back to decode: a frame without it, then a pop.
      checkered: events.filter((e) => e.name === 'CheckerImageTracker::DeferImageDecode' && /^[Sb]$/.test(e.ph)).length,
      decodes: raster.length, decodeMs: Math.round(raster.reduce((a, e) => a + e.dur, 0) / 1000), worstDecodeMs: Math.round(Math.max(0, ...raster.map((e) => e.dur)) / 1000),
      gpuDecodes: decodes.length, distinct: ids.size, decodedAgain: [...ids.values()].filter((n) => n > 1).length,
      bigCssPaints: Object.entries(big).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v} ${k}`),
    };
  };
}

async function main() {
  if (!URL_ARG) await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'popin-'));
  const results = [];
  let failed = false;
  try {
    for (const visit of VISITS) {
      log(`\n=== ${visit} visit, headers ${HEADERS}, rtt ${RTT} ms`);
      served.n200 = 0; served.n304 = 0; served.bytes = 0;
      const ctx = await chromium.launchPersistentContext(profile, {
        executablePath: headlessShell(), headless: true, viewport: { width: Number(arg('w', '1920')), height: Number(arg('h', '1080')) },
        // Blocked by name, not with page.route: Playwright routing turns the HTTP cache off, which is what is being measured.
        args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--mute-audio', '--autoplay-policy=no-user-gesture-required', ...(flag('gpu') ? ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
      });
      const page = ctx.pages()[0] ?? await ctx.newPage();
      page.on('pageerror', (e) => log(`   (page error: ${String(e).slice(0, 160)})`));
      const cdp = await ctx.newCDPSession(page);
      await page.goto(`${URL_ARG || `http://127.0.0.1:${PORT}`}/${PROBE ? '?popin=1' : ''}`, { waitUntil: 'commit' });
      let stopTrace = null;
      try { await walk(page, async () => { if (flag('trace')) stopTrace = await startTrace(cdp); }); } catch (e) { failed = true; log(`   WALK FAILED: ${e.message}`); }
      const trace = stopTrace ? await stopTrace() : null;
      const report = await page.evaluate('window.__popin ? window.__popin.report() : null');
      const text = await page.evaluate('window.__popin ? window.__popin.text() : ""');
      log(text);
      log(`server: ${served.n200} x 200, ${served.n304} x 304, ${(served.bytes / 1048576).toFixed(1)} MB`);
      if (trace) log(`trace: ${JSON.stringify(trace)}`);
      results.push({ visit, headers: HEADERS, served: { ...served }, trace, report, events: await page.evaluate('window.__popin ? window.__popin.events : []') });
      await ctx.close();
      visitIndex++;
      if (HEADERS.startsWith('expire:')) await sleep(Number(HEADERS.split(':')[1]) * 1000 + 1500);
      if (BUDGET !== '' && visit === 'warm' && report && report.total > Number(BUDGET)) { failed = true; log(`OVER BUDGET: ${report.total} pop-ins on a warm visit, budget ${BUDGET}`); }
    }
  } finally {
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  log('\nvisit  total  by cause');
  for (const r of results) log(`${r.visit.padEnd(6)} ${String(r.report?.total ?? '?').padEnd(6)} ${JSON.stringify(r.report?.byCause ?? {})}  late fetches ${r.report?.late.total ?? '?'}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
