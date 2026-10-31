#!/usr/bin/env node
/**
 * GAME BACKEND PROBE (feat/ranked-solo-cf, 2026-10-31). Plays ONE whole lobby game (ranked, or Practice against recorded
 * players) in a headless measurement build and lists every backend call the client makes, per phase (boot, hero select,
 * each round, the end of the game, the minute after it): Supabase REST / RPC / Edge Function / Storage / Auth / Realtime,
 * and the Cloudflare Workers (Versus Worker, friends hub, ranked session), with call counts, request bytes and wire bytes.
 *
 * WRITES NEVER REACH THE LIVE DATABASE. Every Supabase write (a POST/PATCH/PUT/DELETE that is not one of the known READ
 * RPCs below, every Edge Function call, every Storage upload) is answered locally with a canned success and counted with
 * its request size. A bot-played game must not enter the snapshot pool real players face, nor move a test rating. Reads
 * go to the live backend (they are what the audit measures). The ranked session Worker (when the build talks to one) is
 * reached for real: point it at a local `wrangler dev` with `?sessionUrl=` / the build's own env.
 *
 * Build:  VITE_EGRESS_METER=1 VITE_PERF_BENCH=1 npm run build:web
 * Run:    node scripts/egress-game-probe.mjs --mode ranked|practice --profile <dir> [--out result.json] [--max-rounds 40]
 *
 * THE GAME SESSION (R-SESSION-CF-01): `--session-hub http://127.0.0.1:<port>` points the game at a LOCAL hub
 * (`npx wrangler dev --config hub.wrangler.toml --port <port> --var DEV_AUTH:1 --var SESSION_MODE:on`, persistence off:
 * the session's flushes are recorded in the object, never sent). The probe loads the hub's pool mirror from the live
 * pool first (the hub's DEV `/pool/dev-load`: a local hub has no writer key to sync with), plays the game, and saves the
 * session's own record of the game (`/session/<game>/metrics`: every flush it would have written) and the mirror's
 * counters beside the call list.
 *
 * Headless only, muted, one browser per run, closed at the end. Keep runs few (the pool read is real egress).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const PORT = Number(arg('port', '4481'));
const PROFILE = path.resolve(arg('profile', '.egress-profile'));
const NAME = arg('name', 'Claudebot9');
const OUT = arg('out', '');
const MODE = arg('mode', 'ranked');
const MAX_ROUNDS = Number(arg('max-rounds', '40'));
const SESSION_HUB = arg('session-hub', '');
const QUERY = arg('query', SESSION_HUB ? `?hubUrl=${encodeURIComponent(SESSION_HUB)}` : '');
const APP_VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** RPCs that only READ (they go to the live backend). Anything else posted to /rest/v1/rpc is a write (canned). */
const READ_RPCS = new Set([
  'pool_runs_sample_keys', 'pool_runs_boards', 'pool_runs_sample', 'board_strength_histogram', 'god_board_sample',
  'versus_records', 'friends_list', 'friends_online', 'live_dir_meta', 'my_rank', 'run_fight_records', 'run_strength_histogram',
]);

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
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

// ── keys ─────────────────────────────────────────────────────────────────────────────────────────────────────
function keyOf(url, method, body) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const p = u.pathname; let m;
  if (/workers\.dev$/.test(u.hostname) || /^(127\.0\.0\.1|localhost):87\d\d$/.test(u.host)) {
    const worker = u.hostname.split('.')[0];
    return `cf:${worker.replace(/-[0-9a-f]{8}$/, '-<rev>')}:${method} ${p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '*').replace(/\/live\/[^/]+\//, '/live/*/').replace(/\/session\/[^/]+\//, '/session/*/')}`;
  }
  if (!/supabase\.co$/.test(u.hostname)) return null;
  if ((m = p.match(/^\/rest\/v1\/rpc\/([^/?]+)/))) return `rpc:${m[1]}`;
  if ((m = p.match(/^\/rest\/v1\/([^/?]+)/))) return `rest:${m[1]} ${method}`;
  if ((m = p.match(/^\/functions\/v1\/([^/?]+)/))) { const a = typeof body === 'string' ? body.match(/"action"\s*:\s*"([a-z_]+)"/) : null; return `fn:${m[1]}${a ? ':' + a[1] : ''}`; }
  if ((m = p.match(/^\/storage\/v1\/object\/([^/]+)\/([^/]+)/))) return `storage:${m[1]}/${m[2]} ${method}`;
  if ((m = p.match(/^\/auth\/v1\/([^?]+)/))) return `auth:${m[1]}`;
  if ((m = p.match(/^\/realtime\/v1\/websocket/))) return 'rt:handshake';
  return `other:${p}`;
}
const isWrite = (url, method) => {
  let u; try { u = new URL(url); } catch { return false; }
  if (!/supabase\.co$/.test(u.hostname) || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const p = u.pathname;
  if (p.startsWith('/auth/')) return false;
  const rpc = p.match(/^\/rest\/v1\/rpc\/([^/?]+)/);
  if (rpc) return !READ_RPCS.has(rpc[1]);
  return p.startsWith('/rest/') || p.startsWith('/functions/') || p.startsWith('/storage/');
};
let savedRev = 0;
/** A canned answer for a write, shaped like what the client reads back. */
function cannedFor(url, method) {
  const p = new URL(url).pathname;
  if (/\/rpc\/put_saved_run/.test(p)) return { status: 200, body: { status: 'ok', revision: ++savedRev } };
  if (/\/rpc\/clear_saved_run/.test(p)) return { status: 200, body: { status: 'ok' } };
  if (/\/functions\/v1\/submit-rating/.test(p)) return { status: 200, body: { status: 'unrated', error: 'unrated_all_generated' } };
  if (/\/functions\/v1\//.test(p)) return { status: 200, body: { ok: true } };
  if (/\/rpc\//.test(p)) return { status: 200, body: null };
  if (/\/storage\//.test(p)) return { status: 200, body: { Key: 'probe' } };
  if (method === 'POST') return { status: 201, body: [{ id: 1 }] };
  return { status: 200, body: [] };
}

// ── the wire meter (CDP) ─────────────────────────────────────────────────────────────────────────────────────
function wireMeter(cdp) {
  const reqs = new Map();
  const rows = new Map();
  const row = (k) => { let r = rows.get(k); if (!r) { r = { key: k, calls: 0, wire: 0, sent: 0, canned: 0, errors: 0 }; rows.set(k, r); } return r; };
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.method === 'OPTIONS') return;
    const k = keyOf(e.request.url, e.request.method, e.request.postData);
    if (k) reqs.set(e.requestId, { key: k, sent: e.request.postData ? Buffer.byteLength(e.request.postData) : 0, canned: isWrite(e.request.url, e.request.method) });
  });
  cdp.on('Network.responseReceived', (e) => { const q = reqs.get(e.requestId); if (q) q.status = e.response.status; });
  const done = (e, failed) => {
    const q = reqs.get(e.requestId);
    if (!q) return;
    reqs.delete(e.requestId);
    if (q.key === 'rt:handshake') return;
    const r = row(q.key);
    r.calls++; r.sent += q.sent;
    if (q.canned) r.canned++; else r.wire += failed ? 0 : (e.encodedDataLength ?? 0);
    if (failed || q.status >= 400) r.errors++;
  };
  cdp.on('Network.loadingFinished', (e) => done(e, false));
  cdp.on('Network.loadingFailed', (e) => done(e, true));
  const sockets = new Map();
  cdp.on('Network.webSocketCreated', (e) => { const k = keyOf(e.url.replace(/^ws/, 'http'), 'WS', ''); if (k) sockets.set(e.requestId, k.replace(/:WS /, ':ws ')); });
  cdp.on('Network.webSocketFrameReceived', (e) => {
    const k = sockets.get(e.requestId); if (!k) return;
    const r = row(`${k} <-`); r.calls++; r.wire += e.response.opcode === 1 ? Buffer.byteLength(e.response.payloadData) : Math.floor(e.response.payloadData.length * 3 / 4);
  });
  cdp.on('Network.webSocketFrameSent', (e) => {
    const k = sockets.get(e.requestId); if (!k) return;
    const r = row(`${k} ->`); r.calls++; r.sent += e.response.opcode === 1 ? Buffer.byteLength(e.response.payloadData) : Math.floor(e.response.payloadData.length * 3 / 4);
  });
  let last = new Map();
  return {
    mark() {
      const out = [];
      for (const [k, r] of rows) {
        const p = last.get(k) ?? { calls: 0, wire: 0, sent: 0, canned: 0, errors: 0 };
        const d = { key: k, calls: r.calls - p.calls, wire: r.wire - p.wire, sent: r.sent - p.sent, canned: r.canned - p.canned, errors: r.errors - p.errors };
        if (d.calls) out.push(d);
      }
      last = new Map([...rows].map(([k, r]) => [k, { ...r }]));
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
    all: () => [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// ── the game ─────────────────────────────────────────────────────────────────────────────────────────────────
const G = 'window.__bench.store.getState()';
async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`No build at ${DIST}`); process.exit(2); }
  const server = await serve();
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: chromePath(), headless: true, viewport: { width: 1600, height: 900 },
    args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'],
  });
  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };
  const marks = [];
  const cannedBytes = [];
  try {
    await ctx.addInitScript(([name, session]) => { try {
      if (!localStorage.getItem('ascent.playername')) localStorage.setItem('ascent.playername', name);
      localStorage.setItem('ascent.combatspeed', '5');
      if (session) localStorage.setItem('ascent.versus', '1'); // lets the page take a local hub (`?hubUrl=`)
    } catch { /* none */ } }, [NAME, !!SESSION_HUB]);
    await ctx.route(/supabase\.co\//, async (route) => {
      const req = route.request();
      if (!isWrite(req.url(), req.method())) return route.continue();
      const c = cannedFor(req.url(), req.method());
      cannedBytes.push({ key: keyOf(req.url(), req.method(), req.postData() ?? ''), bytes: req.postDataBuffer()?.length ?? 0 });
      return route.fulfill({ status: c.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(c.body) });
    });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && /session|live|pool|outbox|rank/i.test(m.text())) log(`console.${m.type()}: ${m.text().slice(0, 240)}`); });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const wire = wireMeter(cdp);
    const T0 = Date.now();
    const mark = (label, extra = {}) => { const w = wire.mark(); extra.cannedBodies = cannedBytes.splice(0); marks.push({ label, t: Math.round((Date.now() - T0) / 1000), rows: w, ...extra }); log(`mark ${label} @${marks.at(-1).t}s: ${w.reduce((a, r) => a + r.calls, 0)} calls, ${(w.reduce((a, r) => a + r.wire, 0) / 1024).toFixed(1)} KB in, ${(w.reduce((a, r) => a + r.sent, 0) / 1024).toFixed(1)} KB out`); };
    const ev = (js) => page.evaluate(js).catch((e) => `ERR ${String(e.message).slice(0, 160)}`);
    const waitFor = async (js, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(js) === true) return true; await sleep(300); } return false; };
    const clickSel = async (sel) => {
      const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
      if (!Array.isArray(r)) return false;
      await page.mouse.click(r[0], r[1]); return true;
    };

    await page.goto(`http://127.0.0.1:${PORT}/${QUERY}`);
    await waitFor('!!window.__bench', 30000);
    if (SESSION_HUB) {
      // The local hub's pool mirror, loaded from the live pool (the reads the hub's sync would make), BEFORE the boot's
      // pool fetch is counted: wait for a session, read, load, then reload the page so the count starts clean.
      await waitFor(`(async () => !!(await (await window.__bench.db())?.auth.getSession())?.data.session)()`, 30000);
      const loaded = await page.evaluate(async ([hub, prefix]) => {
        const db = await window.__bench.db();
        const { data: runs, error } = await db.from('pool_runs').select('id, author, hero_id, seed, user_id, wave_count, set_id, patch_prefix, pool_id, strength, strength_early, strength_late').eq('eligible', true).eq('patch_prefix', prefix);
        if (error) return { error: error.message };
        const ids = runs.map((r) => r.id);
        const boards = [];
        for (let i = 0; i < ids.length; i += 100) {
          const { data, error: e2 } = await db.rpc('pool_runs_boards', { p_ids: ids.slice(i, i + 100) });
          if (e2) return { error: e2.message };
          for (const b of data) boards.push({ run_id: b.run_id, rev: b.rev, boards: JSON.stringify(b.boards) });
        }
        const rev = new Map(boards.map((b) => [b.run_id, b.rev]));
        const num = (x) => (x == null ? null : String(x));
        const index = runs.map((r) => ({ run_id: r.id, run_key: `${r.author}|${r.hero_id}|${r.seed}`, author: r.author, user_id: r.user_id, wave_count: r.wave_count, set_id: r.set_id, patch_prefix: r.patch_prefix, pool_id: r.pool_id, strength: num(r.strength), strength_early: num(r.strength_early), strength_late: num(r.strength_late), rev: rev.get(r.id) ?? '' }));
        const res = await fetch(`${hub}/pool/dev-load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runs: index, boards }) });
        return { status: res.status, body: await res.json(), bytes: JSON.stringify(boards).length };
      }, [SESSION_HUB, `${APP_VERSION}+`]);
      log(`pool mirror loaded: ${JSON.stringify(loaded)}`);
      await page.evaluate(() => indexedDB.databases().then((dbs) => Promise.all(dbs.filter((d) => /pool/i.test(d.name ?? '')).map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })))));
      wire.mark();
      await page.goto(`http://127.0.0.1:${PORT}/${QUERY}`);
      await waitFor('!!window.__bench', 30000);
    }
    await sleep(12000);
    mark('boot');

    if (MODE === 'practice') {
      await ev(`(() => { const s = ${G}; s.startPractice(); s.setPracticeDraft({ godMode: false, opponents: 'players', health: 'normal', timeMult: 0 }); })()`);
      await sleep(800);
      await ev(`${G}.confirmPracticeSetup()`);
    } else {
      await ev(`${G}.startLobby()`);
    }
    if (!await waitFor(`!!document.querySelector('.herocard.big')`, 30000)) log('no hero select');
    await sleep(3000);
    mark('hero-select');
    const hero = await ev(`(${G}.heroChoices || [])[0] || null`);
    await ev(`${G}.pickHero(${JSON.stringify(hero)})`);
    for (let i = 0; i < 20; i++) { if (await clickSel('.hsc-start')) break; await sleep(500); }
    const inShop = `(() => { const r = ${G}.run; return r.phase === 'recruit' && !${G}.heroChoices; })()`;
    for (let i = 0; i < 80 && !(await ev(inShop)); i++) await sleep(500);
    log(`run ${await ev(`JSON.stringify({ mode: ${G}.run.mode, runId: ${G}.run.runId, seats: ${G}.run.lobby?.seats?.map((s) => s.kind).join(',') })`)}`);
    await sleep(2000);
    mark('game-start');

    await ev(`(async () => {
      const sim = await window.__bench.sim(); const st = window.__bench.store; const S = () => st.getState();
      window.__probeTurn = async () => {
        let n = 0;
        for (; n < 30; n++) {
          const run = S().run;
          if (run.phase !== 'recruit') break;
          if (sim.modalOpen(run) && run.discover) { S().dispatch({ type: 'discover', index: 0 }); if (S().run === run) break; continue; }
          const a = sim.DEFAULT_BOT.act(run);
          if (!a || a.type === 'faceOmen') break;
          S().dispatch(a);
          if (S().run === run) break;
          await new Promise((r) => setTimeout(r, 120));
        }
        return n;
      };
    })()`);
    let round = 0;
    for (; round < MAX_ROUNDS; round++) {
      const phase = await ev(`${G}.run.phase`);
      if (phase === 'gameover') break;
      const wave = await ev(`${G}.run.wave`);
      await ev('window.__probeTurn()');
      let fought = false;
      for (let i = 0; i < 10 && !fought; i++) {
        await clickSel('.etbwrap');
        fought = await waitFor(`${G}.run.phase !== 'recruit'`, 3000);
        if (!fought && await ev(`!!document.querySelector('.etbwrap.pressed')`)) fought = await waitFor(`${G}.run.phase !== 'recruit'`, 60000);
        if (!fought) await ev('window.__probeTurn()');
      }
      if (!fought) { log(`round ${wave}: End Turn never started the fight`); break; }
      await waitFor(`${G}.run.phase !== 'combat' || !!document.querySelector('.etbwrap.ready')`, 180000);
      for (let i = 0; i < 6 && (await ev(`${G}.run.phase`)) === 'combat'; i++) {
        await clickSel('.etbwrap.ready');
        if (await waitFor(`${G}.run.phase !== 'combat'`, 4000)) break;
        if (i === 5) await ev(`(() => { const st = ${G}; if (st.preparePresentationAction({ type: 'resolveCombat' })) st.commitPresentationAction(); })()`);
      }
      await waitFor(`${inShop} || ${G}.run.phase === 'gameover'`, 20000);
      const saveSize = await ev(`(() => { const a = localStorage.getItem('ascent.save'); const b = localStorage.getItem('ascent.save.seatruns'); return { save: a ? a.length : 0, seatRuns: b ? b.length : 0 }; })()`);
      mark(`round-${wave}`, { saveSize, resolve: await ev(`${G}.run.resolve`), alive: await ev(`${G}.run.lobby?.seats?.filter((s) => !s.eliminated).length ?? null`) });
    }
    log(`game over after ${round} rounds: ${await ev(`JSON.stringify({ phase: ${G}.run.phase, placement: ${G}.run.lobby?.placement ?? null })`)}`);
    await sleep(15000);
    mark('end-of-game');
    await sleep(60000);
    mark('after-60s');
    let session = null;
    if (SESSION_HUB) {
      const gameId = await ev(`${G}.run.runId ?? String(${G}.run.seed)`);
      session = {
        gameId,
        metrics: await fetch(`${SESSION_HUB}/session/${encodeURIComponent(gameId)}/metrics`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
        pool: await fetch(`${SESSION_HUB}/pool/metrics`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
        decisions: await ev(`localStorage.getItem('ascent.session.games')`),
      };
      log(`session ${gameId}: ${JSON.stringify(session.metrics?.counters ?? session.metrics)} flushes ${session.metrics?.flushCalls?.length ?? '?'}; pool ${JSON.stringify(session.pool)}`);
    }
    const result = { mode: MODE, name: NAME, rounds: round, marks, all: wire.all(), session, log: lines };
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  } finally {
    await ctx.close();
    server.close();
  }
}
await main();
