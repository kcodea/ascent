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
