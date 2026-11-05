// The party home's end-to-end flows: shared helpers. Local only: the flows bundle has no backend address, and every run blocks
// anything but this machine. CHROME_PATH must be the Playwright headless shell, never a system browser.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const OUT = process.env.QA_OUT || path.resolve('.ph-flows');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.webmanifest': 'application/json' };
export function serve(dist, port) {
  const root = path.resolve(dist);
  const server = http.createServer((req, res) => {
    let f = path.join(root, decodeURIComponent((req.url || '/').split('?')[0]));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}
export const launch = () => chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--mute-audio'], ignoreDefaultArgs: ['--hide-scrollbars'] });
export const VIEW = {
  desk: { viewport: { width: 1920, height: 1080 } },
  lap: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};

/** One fresh player (a new context: no save, no flags), named Claudebot. */
export async function player(browser, url, view, { name = 'Claudebot1', seen = true } = {}) {
  const ctx = await browser.newContext(VIEW[view]);
  await ctx.route((u) => !['localhost', '127.0.0.1'].includes(u.hostname), (r) => r.abort());
  await ctx.addInitScript(([n, s]) => { try { if (!localStorage.getItem('ascent.playername')) localStorage.setItem('ascent.playername', n); if (s) localStorage.setItem('ascent.ftue.done', '1'); } catch { /* */ } }, [name, seen]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
  return { ctx, page, errs, view };
}
export const home = (p) => p.page.waitForFunction(() => document.querySelectorAll('.ph-navhost .ph-navtab').length > 3 && !!window.__bench && !document.querySelector('#bootsplash'), null, { timeout: 120000, polling: 200 });
export const atHome = (p) => p.page.evaluate(() => { const s = document.querySelector('.ph-stage'); return !!document.querySelector('.ph-navhost') && !!s && getComputedStyle(s).visibility !== 'hidden'; });
export const st = (p) => p.page.evaluate(() => { const g = window.__bench.store.getState(); return { title: g.showTitle, mode: g.run.mode, phase: g.run.phase, wave: g.run.wave, hero: !!g.heroChoices, saved: !!g.savedRun, end: !!document.querySelector('.endscreen'), crash: /Game paused/.test(document.body.innerText) }; });
export const tab = async (p, name) => { await p.page.evaluate((n) => [...document.querySelectorAll('.ph-modes .phk-tab')].find((b) => new RegExp(n, 'i').test(b.textContent))?.click(), name); await sleep(450); };
export const press = (p, re, scope = 'body') => p.page.evaluate(([r0, sc]) => { const r = new RegExp(r0, 'i'); const b = [...document.querySelectorAll(`${sc} button, ${sc} [role=button]`)].filter((x) => x.getBoundingClientRect().width > 0 && getComputedStyle(x).visibility !== 'hidden').find((x) => r.test((x.getAttribute('aria-label') || '') + ' ' + x.textContent.trim())); b?.click(); return b ? b.textContent.trim().slice(0, 30) : null; }, [re, scope]);
export const start = async (p) => { await p.page.evaluate(() => document.querySelector('.ph-start')?.click()); await sleep(700); };
export async function pickHero(p) {
  await p.page.waitForSelector('.herocard', { timeout: 20000 });
  await sleep(1200);
  await p.page.evaluate(() => document.querySelector('.herocard:not([disabled])')?.click());
  await sleep(2600);
  await press(p, 'start game');
}
export const inGame = (p) => p.page.waitForFunction(() => { const g = window.__bench.store.getState(); return !g.showTitle && !g.heroChoices; }, null, { timeout: 30000, polling: 300 });
export const shot = (p, name) => p.page.screenshot({ path: path.join(OUT, `${name}-${p.view}.png`) }).catch(() => undefined);
/** Play by ending every turn until the run ends. Fights run at top speed. */
export async function playOut(p, capMs = 150000) {
  await p.page.evaluate(() => window.__bench.store.getState().setCombatSpeed?.(5));
  const t0 = Date.now(); let turns = 0;
  while (Date.now() - t0 < capMs) {
    const s = await st(p);
    if (s.end || s.phase === 'gameover' || s.phase === 'victory') return s;
    // Two real rounds, then one point of Resolve left: the next loss ends the run the way any loss does, in seconds.
    if (s.phase === 'recruit' && s.wave >= 3 && !turns++) await p.page.evaluate(() => { const b = window.__bench.store; const r = b.getState().run; b.setState({ run: { ...r, resolve: 1, armor: 0 } }); });
    await p.page.evaluate(() => { const e = document.querySelector('.etbwrap.ready') || document.querySelector('.etbwrap'); e?.click(); e?.querySelector('button')?.click(); });
    await sleep(700);
  }
  await shot(p, 'playout-stuck');
  throw new Error('playOut: cap reached ' + JSON.stringify(await st(p)));
}
export const results = [];
export async function flow(name, view, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ name, view, ok: true, note: note ?? '', s: Math.round((Date.now() - t0) / 1000) }); console.log('PASS', view, name, note ?? ''); }
  catch (e) { results.push({ name, view, ok: false, note: e.message.slice(0, 200) }); console.log('FAIL', view, name, e.message.slice(0, 240)); }
}
export const must = (c, m) => { if (!c) throw new Error(m); };
