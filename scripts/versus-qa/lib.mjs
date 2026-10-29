// Shared helpers for the Versus browser QA (local stack only: wrangler dev + a bench bundle with no Supabase).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const QA_OUT = process.env.QA_OUT || path.resolve('.versus-qa');
fs.mkdirSync(path.join(QA_OUT, 'shots'), { recursive: true });

export function serveDist(dist, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  const root = path.resolve(dist);
  const server = http.createServer((req, res) => {
    let f = path.join(root, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

export async function launch() {
  return chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
}

/** One player: its own context (own sessionStorage = own dev account). */
export async function player(browser, name, url, { viewport = { width: 1600, height: 900 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem('ascent.versus', '1'); localStorage.setItem('ascent.ftue.done', '1'); } catch {} });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${Date.now()} ${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log.push(`${Date.now()} pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__bench, null, { timeout: 120000 });
  return { name, ctx, page, log };
}

export async function shot(p, label) {
  await p.page.screenshot({ path: path.join(QA_OUT, 'shots', `${label}-${p.name}.png`) }).catch(() => undefined);
}

/** In-page recorder: rAF frame deltas, long tasks, layout shifts, event timing, DOM churn, resource fetches. */
export async function installRecorder(p) {
  await p.page.evaluate(() => {
    if (window.__qaRec) return;
    const rec = { on: false, frames: [], long: [], shifts: [], events: [], added: 0, removed: 0, res: [], marks: [] };
    window.__qaRec = rec;
    let last = 0;
    const loop = (t) => { if (rec.on && last) rec.frames.push([t, t - last]); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => { if (rec.on) for (const e of l.getEntries()) rec.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false }); } catch {}
    try { new PerformanceObserver((l) => { if (rec.on) for (const e of l.getEntries()) if (!e.hadRecentInput) rec.shifts.push([e.startTime, e.value]); }).observe({ type: 'layout-shift', buffered: false }); } catch {}
    try { new PerformanceObserver((l) => { if (rec.on) for (const e of l.getEntries()) rec.events.push([e.name, e.startTime, e.processingStart - e.startTime, e.processingEnd - e.processingStart, e.duration]); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch {}
    try { new PerformanceObserver((l) => { if (rec.on) for (const e of l.getEntries()) rec.res.push([e.name.split('/').pop(), e.startTime, e.duration]); }).observe({ type: 'resource', buffered: false }); } catch {}
    new MutationObserver((ms) => { if (!rec.on) return; for (const m of ms) { rec.added += m.addedNodes.length; rec.removed += m.removedNodes.length; } }).observe(document.body, { childList: true, subtree: true });
  });
}
export async function recStart(p) { await p.page.evaluate(() => { const r = window.__qaRec; Object.assign(r, { on: true, frames: [], long: [], shifts: [], events: [], added: 0, removed: 0, res: [], t0: performance.now() }); }); }
export async function recStop(p) {
  return p.page.evaluate(() => {
    const r = window.__qaRec; r.on = false;
    const d = r.frames.map((f) => f[1]).sort((a, b) => a - b);
    const q = (x) => (d.length ? +d[Math.min(d.length - 1, Math.floor(x * d.length))].toFixed(1) : null);
    return { frames: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d.length ? +d[d.length - 1].toFixed(1) : null,
      over16: d.filter((x) => x > 16.7).length, over33: d.filter((x) => x > 33.4).length, over50: d.filter((x) => x > 50).length,
      long: r.long.map(([s, dur]) => [+(s - r.t0).toFixed(0), +dur.toFixed(0)]), cls: +r.shifts.reduce((a, s) => a + s[1], 0).toFixed(4),
      events: r.events.map(([n, s, wait, proc, dur]) => ({ n, at: +(s - r.t0).toFixed(0), proc: +proc.toFixed(1), dur })), added: r.added, removed: r.removed,
      res: r.res.map(([n, s, dur]) => `${n}@${(s - r.t0).toFixed(0)}`), seq: r.frames.map(([t, dt]) => [+(t - r.t0).toFixed(0), +dt.toFixed(1)]) };
  });
}

/** CPU profile around `fn` (CDP), summarised: self time by function and inclusive time for the named roots. */
export async function profileAround(p, fn, ms = 400) {
  const cdp = p.cdp ?? (p.cdp = await p.ctx.newCDPSession(p.page));
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await fn();
  await sleep(ms);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  const incl = new Map();
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const d = (dt[i + 1] ?? dt[i] ?? 0) / 1000;
    const n = byId.get(id);
    const key = (x) => `${x.callFrame.functionName || '(anon)'} ${x.callFrame.url.split('/').pop()}:${x.callFrame.lineNumber}`;
    self.set(key(n), (self.get(key(n)) ?? 0) + d);
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + d); }
  });
  const top = (m, n) => [...m.entries()].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(1)}ms ${k}`);
  return { self: top(self, 40), incl: top(incl, 400) };
}

/** A DevTools timeline trace around `fn`: every main-thread task over 8 ms, with its style / layout / script / paint split. */
export async function traceAround(browser, p, fn, ms = 600) {
  await browser.startTracing(p.page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8.execute'] });
  const t0 = await p.page.evaluate(() => performance.timeOrigin + performance.now());
  await fn();
  await sleep(ms);
  const buf = await browser.stopTracing();
  const ev = JSON.parse(buf.toString()).traceEvents;
  // The renderer main thread: the thread carrying the most RunTask events with layout.
  const byTid = new Map();
  for (const e of ev) if (e.name === 'Layout' || e.name === 'UpdateLayoutTree') byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + 1);
  const clickEv = ev.find((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'click');
  const main = clickEv ? `${clickEv.pid}:${clickEv.tid}` : [...byTid.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mine = ev.filter((e) => `${e.pid}:${e.tid}` === main && e.ph === 'X');
  const tasks = mine.filter((e) => e.name === 'RunTask' && e.dur > 8000).sort((a, b) => a.ts - b.ts);
  const base = clickEv?.ts ?? tasks[0]?.ts ?? 0;
  const KIND = { UpdateLayoutTree: 'style', Layout: 'layout', FunctionCall: 'script', EvaluateScript: 'script', TimerFire: 'script', FireAnimationFrame: 'raf', EventDispatch: 'event', Paint: 'paint', PrePaint: 'prepaint', Layerize: 'layerize', 'Document::updateStyleAndLayout': 'layout', ParseHTML: 'parse', 'Decode Image': 'decode', 'ImageDecodeTask': 'decode', HitTest: 'hittest', GCEvent: 'gc', MinorGC: 'gc', MajorGC: 'gc', 'V8.GC_SCAVENGER': 'gc', 'BlinkGC.AtomicPhase': 'gc', UpdateLayer: 'layer', 'CompositeLayers': 'composite' };
  const out = tasks.map((t) => {
    const split = {};
    for (const e of mine) {
      if (e.ts < t.ts || e.ts + (e.dur ?? 0) > t.ts + t.dur || e === t) continue;
      const k = KIND[e.name];
      if (!k || k === 'raf' || k === 'event') continue;
      split[k] = (split[k] ?? 0) + e.dur / 1000;
    }
    // Nested script inside script double-counts; keep only the outer total for script by taking max chain: approximate.
    return { at: +((t.ts - base) / 1000).toFixed(0), ms: +(t.dur / 1000).toFixed(1), split: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, +v.toFixed(1)])) };
  });
  void t0;
  return out;
}
