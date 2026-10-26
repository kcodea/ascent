#!/usr/bin/env node
/**
 * SUPABASE EGRESS PROBE (perf/supabase-egress-audit, 2026-10-26). Measures how many bytes the LIVE backend sends one
 * client during a scripted session, two ways at once:
 *
 *   - WIRE (Chrome DevTools Protocol): every response's encodedDataLength (gzip as sent) and every WebSocket frame the
 *     server pushed, keyed like the in-app meter (rest:<table>, rpc:<fn>, fn:<name>:<action>, auth:<path>, rt:<topic>:<event>).
 *   - APP (`window.__egress`, packages/ui/src/net/egressMeter.ts): decoded body bytes + error responses, per key.
 *
 * Needs a MEASUREMENT build (the meter is compiled out of a player build):
 *   VITE_EGRESS_METER=1 npm run build:web
 *   node scripts/egress-probe.mjs --scenario menus --profile <dir> --name Claudebot1 [--out result.json] [--shots dir]
 *
 * The profile dir keeps one anonymous account per test identity across runs (no new account per run). Headless only,
 * audio muted, one browser per run, closed at the end. Talks to the LIVE backend named in apps/web/.env: keep runs short.
 * `--steps '[...]'` runs an ad-hoc step list instead of a named scenario (exploration).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const PORT = Number(arg('port', '4480'));
const PROFILE = path.resolve(arg('profile', '.egress-profile'));
const NAME = arg('name', 'Claudebot1');
const OUT = arg('out', '');
const SHOTS = arg('shots', '');
const SCENARIO = arg('scenario', 'menus');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── keys (the same scheme as egressMeter.ts) ─────────────────────────────────────────────────────────────────
const fold = (t) => t.replace(/^realtime:/, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '*').replace(/[A-Za-z0-9_-]{20,}/g, '*');
function keyOf(url, method, body) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/supabase\.co$/.test(u.hostname)) return null;
  const p = u.pathname; let m;
  if ((m = p.match(/^\/rest\/v1\/rpc\/([^/?]+)/))) return `rpc:${m[1]}`;
  if ((m = p.match(/^\/rest\/v1\/([^/?]+)/))) return `rest:${m[1]} ${method}`;
  if ((m = p.match(/^\/functions\/v1\/([^/?]+)/))) { const a = typeof body === 'string' ? body.match(/"action"\s*:\s*"([a-z_]+)"/) : null; return `fn:${m[1]}${a ? ':' + a[1] : ''}`; }
  if ((m = p.match(/^\/auth\/v1\/([^?]+)/))) return `auth:${m[1]}`;
  if ((m = p.match(/^\/realtime\/v1\/websocket/))) return 'rt:handshake';
  if ((m = p.match(/^\/realtime\/v1\/(.+)/))) return `rt-http:${m[1]}`;
  return `other:${p}`;
}
function frameKey(opcode, data) {
  if (opcode === 1) {
    try {
      const msg = JSON.parse(data);
      const [topic, event, payload] = Array.isArray(msg) ? [msg[2], msg[3], msg[4]] : [msg.topic, msg.event, msg.payload];
      let sub = '';
      if (event === 'postgres_changes') sub = `:${payload?.data?.table ?? '?'}:${payload?.data?.type ?? '?'}`;
      else if (event === 'broadcast') sub = `:${payload?.event ?? '?'}`;
      return { key: `rt:${fold(String(topic ?? ''))}:${event}${sub}`, error: (event === 'phx_reply' && payload?.status && payload.status !== 'ok') || (event === 'system' && payload?.status === 'error') || event === 'phx_error' };
    } catch { return { key: 'rt:unparsed', error: false }; }
  }
  const b = Buffer.from(data, 'base64');
  if (b[0] === 4 && b.length > 5) {
    const tl = b[1], el = b[2];
    return { key: `rt:${fold(b.subarray(5, 5 + tl).toString())}:broadcast:${b.subarray(5 + tl, 5 + tl + el).toString()}`, error: false };
  }
  return { key: `rt:binary:${b[0]}`, error: false };
}

// ── the wire meter (CDP) ─────────────────────────────────────────────────────────────────────────────────────
const subOf = (jwt) => {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString()).sub ?? null; } catch { return null; }
};
/** Each request / socket is attributed to the account that made it (the human or one of the in-tab test bots), from
 *  its bearer token (HTTP) or the access_token of its first channel join (WebSocket). `who(sub)` names it. */
function wireMeter(cdp, who) {
  const reqs = new Map();
  const sockWho = new Map();
  const rows = new Map();
  const row = (k) => { let r = rows.get(k); if (!r) { r = { key: k, calls: 0, wire: 0, errors: 0, codes: {} }; rows.set(k, r); } return r; };
  cdp.on('Network.requestWillBeSent', (e) => {
    const k = keyOf(e.request.url, e.request.method, e.request.postData);
    // CORS preflights: their own bucket (a few hundred bytes of headers each, but one per cross-origin call).
    const auth = e.request.headers?.Authorization ?? e.request.headers?.authorization ?? '';
    const sub = auth.startsWith('Bearer ') ? subOf(auth.slice(7)) : null;
    if (k) reqs.set(e.requestId, { key: `${who(sub)}|${e.request.method === 'OPTIONS' ? 'preflight (OPTIONS)' : k}`, url: e.request.url });
  });
  cdp.on('Network.responseReceived', (e) => {
    const q = reqs.get(e.requestId);
    if (q) q.status = e.response.status;
  });
  cdp.on('Network.loadingFinished', (e) => {
    const q = reqs.get(e.requestId);
    if (!q) return;
    reqs.delete(e.requestId);
    if (q.key.endsWith('|rt:handshake')) return;
    const r = row(q.key);
    r.calls++;
    r.wire += e.encodedDataLength;
    if (!r.urls) r.urls = [];
    if (r.urls.length < 3) r.urls.push(`${Math.round(e.encodedDataLength / 1024)}KB ${decodeURIComponent(q.url).replace(/^https:\/\/[^/]+/, '').slice(0, 400)}`);
    if (q.status >= 400) { r.errors++; r.codes[q.status] = (r.codes[q.status] ?? 0) + 1; }
  });
  cdp.on('Network.loadingFailed', (e) => {
    const q = reqs.get(e.requestId);
    if (!q) return;
    reqs.delete(e.requestId);
    if (q.key.endsWith('|rt:handshake')) return;
    const r = row(q.key); r.calls++; r.errors++; r.codes.failed = (r.codes.failed ?? 0) + 1;
  });
  const sockets = new Set();
  const errorSamples = [];
  cdp.on('Network.webSocketCreated', (e) => { if (/supabase\.co/.test(e.url)) sockets.add(e.requestId); });
  cdp.on('Network.webSocketFrameSent', (e) => {
    if (!sockets.has(e.requestId) || sockWho.has(e.requestId) || e.response.opcode !== 1) return;
    const t = e.response.payloadData.match(/"access_token":"([^"]+)"/);
    if (t) sockWho.set(e.requestId, who(subOf(t[1])));
  });
  cdp.on('Network.webSocketFrameReceived', (e) => {
    if (!sockets.has(e.requestId)) return;
    const { opcode, payloadData } = e.response;
    const { key, error } = frameKey(opcode, payloadData);
    const r = row(`${sockWho.get(e.requestId) ?? 'anon'}|${key}`);
    r.calls++;
    r.wire += opcode === 1 ? Buffer.byteLength(payloadData) : Math.floor(payloadData.length * 3 / 4);
    if (error) { r.errors++; if (errorSamples.length < 20) errorSamples.push(`${key}: ${String(payloadData).slice(0, 400)}`); }
  });
  let last = new Map();
  return {
    mark() {
      const out = [];
      for (const [k, r] of rows) {
        const p = last.get(k);
        const d = { key: k, calls: r.calls - (p?.calls ?? 0), wire: r.wire - (p?.wire ?? 0), errors: r.errors - (p?.errors ?? 0) };
        if (d.calls) out.push(d);
      }
      last = new Map([...rows].map(([k, r]) => [k, { ...r }]));
      return out.sort((a, b) => b.wire - a.wire);
    },
    all: () => [...rows.values()].sort((a, b) => b.wire - a.wire),
    errorSamples: () => errorSamples,
  };
}

// ── steps ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Click the first visible element whose text is exactly `t` (case-insensitive), `~prefix`, or a CSS selector. */
async function click(page, t) {
  return page.evaluate((t) => {
    const vis = (x) => x.offsetParent || x.getClientRects().length;
    let e;
    if (t.startsWith('~')) e = [...document.querySelectorAll('button,[role=button],.modecard,.btn')].filter(vis).find((x) => (x.innerText || '').trim().toUpperCase().startsWith(t.slice(1).toUpperCase()));
    else if (/^[.#[]/.test(t)) e = [...document.querySelectorAll(t)].find(vis);
    else {
      const same = (x) => (x.innerText || '').trim().toUpperCase() === t.toUpperCase();
      e = [...document.querySelectorAll('button,[role=button],.btn')].filter(vis).find(same)
        ?? [...document.querySelectorAll('a,div,span')].filter(vis).find(same);
    }
    if (!e) return `MISS ${t}`;
    const b = e.getBoundingClientRect();
    return [b.left + b.width / 2, b.top + b.height / 2];
  }, t).then(async (r) => {
    if (typeof r === 'string') return r;
    await page.mouse.click(r[0], r[1]); // a real pointer click (some controls act on pointer events, not .click())
    return 'ok';
  });
}

async function run(steps, page, wire, log) {
  const marks = [];
  let n = 0;
  for (const s of steps) {
    if (s.wait) await sleep(s.wait);
    else if (s.click) { const r = await click(page, s.click); log(`click ${s.click}: ${r}`); await sleep(s.after ?? 2500); }
    else if (s.drag) {
      const [x1, y1, x2, y2] = s.drag;
      await page.mouse.move(x1, y1); await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12); await sleep(30); }
      await page.mouse.up(); log(`drag ${s.drag}`); await sleep(s.after ?? 2500);
    }
    else if (s.dragTo) {
      // Drag from a point onto the centre of the first visible element matching a selector.
      const r = await page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, s.dragTo);
      if (!r) { log(`dragTo ${s.dragTo}: MISS`); continue; }
      const [x1, y1] = s.from;
      await page.mouse.move(x1, y1); await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(x1 + ((r[0] - x1) * i) / 12, y1 + ((r[1] - y1) * i) / 12); await sleep(30); }
      await page.mouse.up(); log(`dragTo ${s.dragTo} ${r.map(Math.round)}`); await sleep(s.after ?? 2500);
    }
    else if (s.key) { await page.keyboard.press(s.key); log(`key ${s.key}`); await sleep(s.after ?? 1500); }
    else if (s.at) { await page.mouse.click(s.at[0], s.at[1]); log(`click at ${s.at}`); await sleep(s.after ?? 2500); }
    else if (s.until) {
      // Wait (up to s.max ms) until an expression is truthy; log what it was.
      const t0 = Date.now(); let v = null;
      while (Date.now() - t0 < (s.max ?? 60000)) { v = await page.evaluate(s.until).catch(() => null); if (v) break; await sleep(500); }
      log(`until ${s.until.slice(0, 60)}: ${JSON.stringify(v)?.slice(0, 120)} after ${Date.now() - t0} ms`);
    }
    else if (s.eval) { const r = await page.evaluate(s.eval).catch((e) => `ERR ${e.message}`); log(`eval: ${JSON.stringify(r)?.slice(0, 300)}`); }
    else if (s.shot && SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${s.shot}.png`) }); }
    else if (s.mark) {
      const app = await page.evaluate((l) => (window.__egress ? window.__egress.mark(l) : null), s.mark);
      const w = wire.mark();
      marks.push({ label: s.mark, wire: w, wireTotal: w.reduce((a, r) => a + r.wire, 0), app });
      log(`mark ${s.mark}: wire ${(marks.at(-1).wireTotal / 1024).toFixed(1)} KB, app ${app ? (app.totals.bytes / 1024).toFixed(1) : '?'} KB, errors ${app?.totals.errors ?? '?'}`);
    }
  }
  return marks;
}

const SCENARIOS = {
  // Boot + every menu page, then Live Games left open for 60 s.
  menus: [
    { wait: 12000 }, { shot: 'title' }, { mark: 'launch' },
    { click: 'PLAY' }, { shot: 'play' }, { mark: 'play' },
    { click: 'CAREER', after: 6000 }, { shot: 'career' }, { mark: 'career' },
    { click: 'LEADERBOARD', after: 6000 }, { shot: 'leaderboard' }, { mark: 'leaderboard' },
    { click: 'RECENT GAMES', after: 6000 }, { shot: 'recent' }, { mark: 'recent' },
    { click: 'LIVE GAMES', after: 1000 }, { wait: 60000 }, { shot: 'live' }, { mark: 'live-idle-60s' },
  ],
  idle: [{ wait: 12000 }, { mark: 'launch' }, { wait: 60000 }, { mark: 'title-idle-60s' }],
  // Versus 1v1 against an in-tab test bot (Claudebot6): room, gate, hero select, ~3 rounds passive (the clock locks the
  // human's turn), then concede + leave so no test room is left open.
  versus: [
    { wait: 12000 }, { mark: 'launch' },
    { click: 'PLAY' }, { click: '~Versus', after: 4000 }, { wait: 20000 }, { mark: 'versus-browser-24s' },
    { click: 'Create room', after: 5000 }, { wait: 30000 }, { mark: 'room-idle-35s' },
    { click: 'Add bot', after: 8000 }, { drag: [800, 780, 1025, 350], after: 4000 }, { mark: 'room-setup' },
    { at: [800, 607], after: 1500 }, { until: '!!document.querySelector(".rgate.is-armed .rgate-crystal")', max: 15000 },
    { click: '.rgate.is-armed .rgate-crystal', after: 6000 }, { wait: 30000 }, { mark: 'gate+hero' },
    { wait: 150000 }, { shot: 'match' }, { mark: 'match-150s' },
    'LEAVE',
  ],
  // Versus Duos (2v2) with three in-tab test bots (Claudebot6..8): ~2 min of the match, then concede + leave.
  duos: [
    { wait: 12000 }, { mark: 'launch' },
    { click: 'PLAY' }, { click: '~Versus', after: 4000 }, { click: 'Create room', after: 5000 },
    { click: 'Room options', after: 2000 }, { at: [989, 432], after: 2000 }, { at: [1064, 317], after: 2000 },
    { click: 'Add bot', after: 7000 }, { click: 'Add bot', after: 7000 }, { click: 'Add bot', after: 7000 },
    { dragTo: '.vspcard-open:not(.gone), .vspcard-joinable', from: [800, 780], after: 4000 }, { shot: 'duos-room' }, { mark: 'duos-room-setup' },
    { click: 'Start game', after: 1500 }, { until: '!!document.querySelector(".rgate.is-armed .rgate-crystal")', max: 15000 },
    { click: '.rgate.is-armed .rgate-crystal', after: 6000 }, { wait: 30000 }, { mark: 'gate+hero' },
    { wait: 120000 }, { shot: 'duos-match' }, { mark: 'duos-match-120s' },
    'LEAVE',
  ],
  // A spectator: watch the newest in-game room for 120 s (run beside `versus`, as another identity), then leave.
  spectate: [
    { wait: 12000 }, { mark: 'launch' },
    { click: 'PLAY' }, { click: '~Versus', after: 4000 },
    // Only the probe host's own room (never another tester's): the row naming "<host>'s room" with a Watch button.
    { until: `(() => { const name = ${JSON.stringify(`${arg('host', 'Claudebot5')}'s room`)}; const own = (x) => { let p = x.parentElement; while (p && p.querySelectorAll('button').length === 1) { if (p.innerText.includes(name)) return true; p = p.parentElement; } return false; }; const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Watch' && own(x)); if (b) { b.click(); return true; } return false; })()`, max: 150000 },
    { wait: 8000 }, { shot: 'watch' }, { mark: 'watch-join' },
    { wait: 90000 }, { shot: 'watching' }, { mark: 'watch-90s' },
    'LEAVE',
  ],
};
/** Never leave a test room behind: concede a running match (two presses), then Leave the room. */
const LEAVE_JS = `(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent);
  const f = b.find((x) => /^Leave/.test(x.innerText.trim())); if (f) { f.click(); return 'clicked ' + f.innerText.trim(); } return 'none'; })()`;
const LEAVE = [
  { eval: LEAVE_JS }, { wait: 3000 },
  { key: 'Escape' }, { at: [518, 144], after: 1000 }, { at: [518, 144], after: 1000 },
  { wait: 6000 }, { key: 'Escape' },
  { click: 'PLAY' }, { click: '~Versus', after: 8000 }, { eval: LEAVE_JS }, { wait: 4000 }, { eval: LEAVE_JS }, { wait: 2000 },
  { eval: `[...document.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean).join('|')` },
];
for (const k of Object.keys(SCENARIOS)) SCENARIOS[k] = SCENARIOS[k].flatMap((s) => (s === 'LEAVE' ? LEAVE : [s]));

const steps = arg('steps', '') ? JSON.parse(arg('steps', '[]')) : SCENARIOS[SCENARIO];
if (!steps) { console.error(`unknown scenario ${SCENARIO}`); process.exit(2); }
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`No build at ${DIST}`); process.exit(2); }

const server = await serve();
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: chromePath(), headless: true, viewport: { width: 1600, height: 900 },
  args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'],
});
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
try {
  // The player name, and the in-tab Versus test bots named Claudebot2.. (owner rule: live test identities are Claudebot1, 2, ...).
  await ctx.addInitScript((name) => { try {
    if (!localStorage.getItem('ascent.playername')) localStorage.setItem('ascent.playername', name);
    localStorage.setItem('ascent.versus', '1');
    localStorage.setItem('ascent.versus.botnames', 'Claudebot6,Claudebot7,Claudebot8');
  } catch { /* none */ } }, NAME);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  // The human's account id: read from the persisted session once the page has one (bots keep their own storage keys).
  let me = null;
  const who = (sub) => (!sub ? 'anon' : `u:${sub.slice(0, 8)}`); // relabelled 'me' in the output
  const wire = wireMeter(cdp, who);
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const readMe = async () => {
    me = await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) { try { return JSON.parse(localStorage.getItem(k)).user.id; } catch { /* next */ } }
      return null;
    }).catch(() => null);
  };
  await sleep(3000); await readMe();
  const meTimer = setInterval(() => { if (!me) void readMe(); }, 2000);
  const marks = await run(steps, page, wire, log);
  const app = await page.evaluate(() => (window.__egress ? { totals: window.__egress.totals(), rows: window.__egress.rows() } : null));
  clearInterval(meTimer);
  const mine = me ? `u:${me.slice(0, 8)}|` : '(none)';
  const relabel = (rows) => rows.map((r) => ({ ...r, key: r.key.startsWith(mine) ? `me|${r.key.slice(mine.length)}` : r.key }));
  for (const m of marks) m.wire = relabel(m.wire);
  const result = { scenario: SCENARIO, name: NAME, me, marks, wireAll: relabel(wire.all()), app, rtErrors: wire.errorSamples(), log: lines };
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
} finally {
  await ctx.close();
  server.close();
}
