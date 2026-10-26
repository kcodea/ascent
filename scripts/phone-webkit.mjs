#!/usr/bin/env node
/**
 * PHONE LAYOUT IN WEBKIT (R-PHONE-PAGESCALE-01, owner report 2026-10-25, a real iPhone: "Mobile looks like this").
 *
 * Every earlier phone check ran in Chromium's device emulation, and Chromium lays CSS `zoom` out differently from WebKit:
 * the iPhone showed the Shop minions collapsed to their badges in one spot, the lobby rail tiny and Tier / Freeze / the
 * Refresh cost huge, while every Chromium capture looked right. This walks a PRODUCTION build in Playwright's WebKit as an
 * iPhone 15 Pro in landscape, both as the Home Screen app (852 x 393, standalone) and in Safari (734 x 343, the browser's
 * own bars taking the rest), with touch, DPR 3 and the iPhone's safe area (59 / 59 / 21, faked through the stage's
 * safe-area probe: headless WebKit reports none). Title -> Play -> Practice -> hero select -> the first Shop, then it
 * CHECKS the layout and saves a screenshot per step:
 *   - the stage is neither zoomed nor transformed on the phone: the browser scales the PAGE (`data-page-scale`, the meta
 *     viewport), so nothing WebKit mis-lays-out under CSS zoom is in play
 *   - the Shop minions have their real size and seven different seats (the 2026-10-25 collapse: ~20 px wide, one x)
 *   - the card size chain (`--ccw`) and the Tier label's font size match the desktop layout (the double-zoomed registered
 *     lengths, and WebKit's minimum font size under a zoom)
 *   - the drawn width of the stage is the screen's (the page scale is applied)
 *
 * Usage: npm run build:web && npm run phone:webkit [-- --dist apps/web/dist --out <dir> --port 4520 --mode app|safari|both]
 * Needs Playwright's WebKit once: `npx playwright-core install webkit`. Exits 1 when a check fails. Every request off
 * 127.0.0.1 is blocked (no backend), so the game runs offline with bot seats.
 * Chromium stays covered by the other phone scripts (phone-run-memory.mjs, phone-menu-memory.mjs).
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'ascent-phone-webkit')));
const PORT = Number(arg('port', '4520'));
const MODES = arg('mode', 'both') === 'both' ? ['app', 'safari'] : [arg('mode', 'app')];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let webkit;
try { ({ webkit } = await import('playwright-core')); } catch {
  console.error('phone:webkit needs playwright-core (a dev dependency: npm install) and its WebKit: npx playwright-core install webkit');
  process.exit(2);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error(`No build at ${DIST}: run npm run build:web first.`); process.exit(2); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent((req.url || '/').split('?')[0]));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
fs.mkdirSync(OUT, { recursive: true });

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SIZES = { app: { width: 852, height: 393 }, safari: { width: 734, height: 343 } };
const failures = [];
const browser = await webkit.launch({ headless: true });
try {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: SIZES[mode], screen: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA });
    await ctx.route((u) => !/^http:\/\/127\.0\.0\.1[:/]/.test(String(u)), (r) => r.abort());
    // The iPhone's landscape safe area (headless WebKit reports none) and, for the app, the Home Screen flag.
    await ctx.addInitScript({ content: `(() => {
      ${mode === 'app' ? "try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch {}" : ''}
      const add = () => { const s = document.createElement('style'); s.textContent = '#safe-probe{padding:0 59px 21px 59px !important}'; (document.head || document.documentElement).appendChild(s); };
      if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
    })();` });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`   [${mode}] page error: ${e.message.slice(0, 200)}`));
    // Taps go to the element (pointerdown / pointerup / click): a screen-point tap would also do, but this needs no geometry.
    const tapSel = async (sel, i = 0, wait = 800) => {
      const ok = await page.evaluate(([s, i]) => { const e = [...document.querySelectorAll(s)].filter((x) => x.getClientRects().length > 0)[i]; if (!e) return false; const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click(); return true; }, [sel, i]);
      await sleep(wait); return ok;
    };
    const tapText = async (t, wait = 800) => {
      const ok = await page.evaluate((t) => { const e = [...document.querySelectorAll('button,[role=button],.btn,a')].find((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === t.toUpperCase()); if (!e) return false; const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click(); return true; }, t);
      await sleep(wait); return ok;
    };
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${mode}-${name}.png`), scale: 'device' });
    const check = (name, ok, detail) => { console.log(`   [${mode}] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures.push(`${mode}: ${name} ${detail || ''}`); };

    console.log(`${mode}: ${SIZES[mode].width} x ${SIZES[mode].height} @3x`);
    await page.goto(`http://127.0.0.1:${PORT}/?phonediag=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('bootsplash'), null, { timeout: 240000 });
    await sleep(3000);
    await shot('01-title');
    await tapText('PLAY', 2500);
    await tapSel('.modecard.mc-tile', 0, 2000);
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!document.querySelector('.postart'))); i++) await sleep(250);
    await shot('02-practice');
    await tapSel('.postart', 0, 5000);
    await shot('03-heroselect');
    await tapSel('.herocard.big', 0, 2500);
    await tapSel('.hsc-start', 0, 3000);
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0)) break;
      if (await tapText('Play anyway', 1000)) continue;
      await sleep(500);
    }
    await sleep(4000);
    await shot('04-shop');
    const m = await page.evaluate(() => {
      const de = document.documentElement; const st = document.getElementById('stage')?.style;
      const cards = [...document.querySelectorAll('[data-zone=tavern] .card[data-uid]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const tier = document.querySelector('.tvb-tierpill');
      return {
        pageScale: Number(de.getAttribute('data-page-scale')) || 0,
        zoom: st?.zoom || '', transform: st?.transform || '',
        meta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
        cards: cards.map((r) => ({ x: Math.round(r.left), w: Math.round(r.width) })),
        ccw: parseFloat(getComputedStyle(document.querySelector('[data-zone=tavern] .card[data-uid]') || de).getPropertyValue('--ccw')) || 0,
        tierFont: tier ? parseFloat(getComputedStyle(tier).fontSize) : 0,
        drawnW: innerWidth * (window.visualViewport?.scale || 1),
      };
    });
    check('the page scale is on', m.pageScale > 0.2 && m.pageScale < 1, `data-page-scale ${m.pageScale}`);
    check('the stage is neither zoomed nor transformed', !m.zoom && !m.transform, `zoom '${m.zoom}' transform '${m.transform}'`);
    check('the meta viewport carries the layout width and scale', /width=\d+, initial-scale=0\.\d+/.test(m.meta), m.meta);
    check('the drawn width is the screen width', Math.abs(m.drawnW - SIZES[mode].width) < 2, `${m.drawnW.toFixed(1)} px`);
    check('the Shop shows its minions at their size', m.cards.length >= 3 && m.cards.every((c) => c.w > 100), m.cards.map((c) => c.w).join(','));
    check('each Shop minion has its own seat', new Set(m.cards.map((c) => c.x)).size === m.cards.length, m.cards.map((c) => c.x).join(','));
    check('the card size chain is the desktop one (--ccw)', m.ccw > 100 && m.ccw < 200, `--ccw ${m.ccw.toFixed(1)}`);
    check('the Tier label keeps its desktop font size', m.tierFont > 0 && m.tierFont < 20, `${m.tierFont.toFixed(1)} px`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`screenshots: ${OUT}`);
if (failures.length) { console.log(`${failures.length} check(s) failed`); process.exit(1); }
console.log('all checks passed');
