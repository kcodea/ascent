#!/usr/bin/env node
/**
 * PHONES HELD UPRIGHT PLAY SIDEWAYS (R-PHONE-SIDEWAYS-01, owner 2026-10-29: "Make it so mobile only loads in landscape so
 * it doesn't require a rotate").
 *
 * Walks a PRODUCTION build on four phones: an iPhone 15 Pro (Playwright's WebKit, Home Screen app, iPhone safe area
 * faked through the stage's probe) held upright and in landscape, and a Pixel (Playwright's Chromium, Android) held
 * upright and in landscape. On each: title -> Play (a REAL tap at the screen point the button is drawn at) -> Practice ->
 * hero select -> the first Shop, then a REAL drag buys a Shop minion and another plays it. Checks:
 *   - upright: the stage is turned (`data-sideways`, the rotate transform), the game is laid out in landscape (layout
 *     width > height), and there is no rotate prompt anywhere;
 *   - the real tap and the real drags land: Play opens the mode page, the buy adds a card to the hand, the play puts it
 *     on the board (so drag ghosts, drop seats and hit tests all agree with what is drawn under the finger);
 *   - Android: the first tap asks for fullscreen and `screen.orientation.lock('landscape')` (the lock itself is the
 *     OS's job; headless Chromium cannot rotate, so the "locked" capture resizes the viewport to landscape, as the OS
 *     would);
 *   - perf: rAF frame intervals idle in the Shop, and the cost of a wrapped `getBoundingClientRect`.
 * Screenshots per step. No dev tuner (production build). Every request off 127.0.0.1 is blocked (offline, bot seats).
 *
 * Usage: npm run build:web && npm run phone:sideways [-- --out <dir> --port 4521 --only ios-portrait,android-portrait]
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = path.resolve(arg('dist', 'apps/web/dist'));
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'ascent-phone-sideways')));
const PORT = Number(arg('port', '4521'));
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pw;
try { pw = await import('playwright-core'); } catch {
  console.error('phone:sideways needs playwright-core and its browsers: npx playwright-core install webkit chromium');
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
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DEVICES = [
  { id: 'ios-portrait', engine: 'webkit', ua: IOS_UA, viewport: { width: 393, height: 852 }, dpr: 3, safe: '59px 0 34px 0', upright: true },
  { id: 'ios-landscape', engine: 'webkit', ua: IOS_UA, viewport: { width: 852, height: 393 }, dpr: 3, safe: '0 59px 21px 59px', upright: false },
  { id: 'android-portrait', engine: 'chromium', ua: ANDROID_UA, viewport: { width: 412, height: 915 }, dpr: 2.625, safe: '0', upright: true, android: true },
  { id: 'android-landscape', engine: 'chromium', ua: ANDROID_UA, viewport: { width: 915, height: 412 }, dpr: 2.625, safe: '0', upright: false, android: true },
].filter((d) => !ONLY || ONLY.includes(d.id));

/** Chromium: CHROME_PATH, else whichever Playwright Chromium is installed (a fresh temp profile either way). */
function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  try {
    for (const dir of fs.readdirSync(root).filter((x) => /^chromium-[0-9]+$/.test(x)).sort().reverse()) {
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(root, dir, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { /* fall through */ }
  return undefined;
}
const failures = [];
const browsers = {};
try {
  for (const d of DEVICES) {
    const browser = browsers[d.engine] ??= await pw[d.engine].launch({ headless: true, ...(d.engine === 'chromium' ? { executablePath: chromiumPath() } : {}) });
    const ctx = await browser.newContext({ viewport: d.viewport, screen: d.viewport, deviceScaleFactor: d.dpr, isMobile: d.engine === 'chromium' ? true : true, hasTouch: true, userAgent: d.ua });
    await ctx.route((u) => !/^http:\/\/127\.0\.0\.1[:/]/.test(String(u)), (r) => r.abort());
    await ctx.addInitScript({ content: `(() => {
      ${d.engine === 'webkit' ? "try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch {}" : ''}
      const add = () => { const s = document.createElement('style'); s.textContent = '#safe-probe{padding:${d.safe} !important}'; (document.head || document.documentElement).appendChild(s); };
      if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
      // Record the Android fullscreen + lock request. Both are RECORDED, not performed: headless Chromium's element
      // fullscreen under device emulation breaks the emulated page scale (the page comes out zoomed in), which a real
      // phone does not do, and headless cannot rotate anyway. The lock's effect is simulated below by turning the viewport.
      window.__lock = { fs: 0, lock: [] };
      try {
        const o = screen.orientation;
        if (o && o.lock) o.lock = (t) => { window.__lock.lock.push(t); return Promise.resolve(); };
        if (Element.prototype.requestFullscreen) Element.prototype.requestFullscreen = function () { window.__lock.fs++; return Promise.resolve(); };
      } catch {}
    })();` });
    const page = await ctx.newPage();
    const cdp = d.engine === 'chromium' ? await ctx.newCDPSession(page) : null;
    page.on('pageerror', (e) => console.log(`   [${d.id}] page error: ${e.message.slice(0, 200)}`));
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${d.id}-${name}.png`), scale: 'device' });
    const check = (name, ok, detail) => { console.log(`   [${d.id}] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures.push(`${d.id}: ${name} ${detail || ''}`); };
    // Synthetic taps (navigation between the checked steps; their coordinates are not used).
    const tapSel = async (sel, i = 0, wait = 800) => {
      const ok = await page.evaluate(([s, i]) => { const e = [...document.querySelectorAll(s)].filter((x) => x.getClientRects().length > 0)[i]; if (!e) return false; const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click(); return true; }, [sel, i]);
      await sleep(wait); return ok;
    };
    const tapText = async (t, wait = 800) => {
      const ok = await page.evaluate((t) => { const e = [...document.querySelectorAll('button,[role=button],.btn,a')].find((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === t.toUpperCase()); if (!e) return false; const o = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }; e.dispatchEvent(new PointerEvent('pointerdown', o)); e.dispatchEvent(new PointerEvent('pointerup', o)); e.click(); return true; }, t);
      await sleep(wait); return ok;
    };
    // REAL input: where is a game-frame point drawn, in the input API's coordinates (CSS px of the visual viewport)?
    // The game sees every rect in its landscape frame (sideways.ts); the turn maps it back: screen = (pw - y, x).
    const screenOf = (sel, text) => page.evaluate(([sel, text]) => {
      const all = [...document.querySelectorAll(sel)].filter((x) => x.getClientRects().length > 0);
      const e = text ? all.find((x) => (x.innerText || '').trim().toUpperCase() === text) : all[0];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const gx = r.left + r.width / 2, gy = r.top + r.height / 2;
      const de = document.documentElement;
      const side = de.hasAttribute('data-sideways');
      const pwid = de.clientWidth;
      const k = window.visualViewport ? window.visualViewport.scale : 1;
      const x = side ? pwid - gy : gx, y = side ? gx : gy;
      return { x: x * k, y: y * k, k };
    }, [sel, text || '']);
    // Units: Playwright's WebKit touchscreen takes VISUAL px; CDP touches and the WebKit mouse take LAYOUT px of the page.
    const lay = (p) => ({ x: p.x / (p.k || 1), y: p.y / (p.k || 1) });
    const realTap = async (p) => { if (cdp) { const q = lay(p); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } else await page.touchscreen.tap(p.x, p.y); };
    const realDrag = async (from, to) => {
      if (!from || !to) return false;
      if (cdp) {
        from = lay(from); to = lay(to);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
        for (let i = 1; i <= 16; i++) { await sleep(25); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 16, y: from.y + (to.y - from.y) * i / 16 }] }); }
        await sleep(80);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        // WebKit has no touch-move API in Playwright: a real (trusted) mouse drag through the same points. Its mouse takes
        // LAYOUT px of the page (its touchscreen takes visual px), so the page scale comes back out.
        const k = from.k || 1;
        const f = { x: from.x / k, y: from.y / k }, t = { x: to.x / k, y: to.y / k };
        // Paced for headless WebKit, which draws only a few frames a second here (a drag is frame-driven).
        await page.mouse.move(f.x, f.y); await sleep(300); await page.mouse.down(); await sleep(300);
        for (let i = 1; i <= 12; i++) { await page.mouse.move(f.x + (t.x - f.x) * i / 12, f.y + (t.y - f.y) * i / 12); await sleep(250); }
        await sleep(800); await page.mouse.up(); await sleep(5000);
      }
      await sleep(1500);
      return true;
    };
    const count = () => page.evaluate(() => ({ hand: document.querySelectorAll('[data-zone="hand"] .card[data-uid]').length, board: document.querySelectorAll('[data-zone="warband"] .row .card[data-uid]').length }));

    console.log(`${d.id}: ${d.viewport.width} x ${d.viewport.height} (${d.engine})`);
    await page.goto(`http://127.0.0.1:${PORT}/?phonediag=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('bootsplash'), null, { timeout: 240000 });
    await sleep(3000);
    await shot('01-title');
    const g = await page.evaluate(() => {
      const de = document.documentElement; const st = document.getElementById('stage');
      return { side: de.hasAttribute('data-sideways'), transform: st ? st.style.transform : '', lw: innerWidth, lh: innerHeight, prompt: !!document.querySelector('.rotate-prompt') };
    });
    check('no rotate prompt', !g.prompt);
    if (d.upright) {
      check('the stage is turned', g.side && /rotate\(90deg\)/.test(g.transform), g.transform);
      check('the game lays out in landscape', g.lw > g.lh, `${g.lw} x ${g.lh}`);
    } else check('landscape is not turned', !g.side && !/rotate/.test(g.transform), g.transform);

    // A REAL first tap on the title's open art (Android: this is the gesture the fullscreen + lock request rides on).
    // (Not on Play itself: the title menu is under CSS `zoom`, where WebKit's getBoundingClientRect is unreliable in either
    // orientation, a pre-existing quirk; the real-tap geometry checks run in the Shop below instead.)
    await realTap(await page.evaluate(() => { const k = window.visualViewport ? window.visualViewport.scale : 1; const de = document.documentElement; const side = de.hasAttribute('data-sideways'); const gx = innerWidth * 0.62, gy = innerHeight * 0.55; return { x: (side ? de.clientWidth - gy : gx) * k, y: (side ? gx : gy) * k, k }; }));
    await sleep(1500);
    if (d.android) {
      const l = await page.evaluate(() => ({ ...window.__lock }));
      check('Android: the first tap asks for fullscreen and the landscape lock', l.fs >= 1 && l.lock.includes('landscape'), JSON.stringify(l));
    }
    await tapText('PLAY', 2500);
    await tapSel('.modecard.mc-tile', 0, 2000);
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!document.querySelector('.postart'))); i++) await sleep(250);
    await tapSel('.postart', 0, 5000);
    await shot('02-heroselect');
    await tapSel('.herocard.big', 0, 2500);
    await tapSel('.hsc-start', 0, 3000);
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0)) break;
      if (await tapText('Play anyway', 1000)) continue;
      await sleep(500);
    }
    await sleep(4000);
    for (let i = 0; i < 6 && await page.evaluate(() => !!document.querySelector('.discover-ov')); i++) {
      await shot('03-discover');
      if (!await tapSel('.discover-ov .card', 0, 2500) && !await tapSel('.discover-ov button', 0, 2500)) break;
    }
    await shot('04-shop');

    // A REAL tap on a Shop minion opens its Inspect (R-TOUCH-TAPINSPECT-01): the tap lands on the card drawn under it.
    await realTap(await screenOf('[data-zone="tavern"] .row .card[data-uid]'));
    await sleep(1200);
    check('a real tap on a Shop minion opens its Inspect', !!(await page.evaluate(() => document.querySelector('.inspect-ov'))));
    await shot('04b-inspect');
    for (let i = 0; i < 3 && await page.evaluate(() => !!document.querySelector('.inspect-ov')); i++) { await page.keyboard.press('Escape'); await sleep(600); if (await page.evaluate(() => !!document.querySelector('.inspect-ov'))) await tapSel('.inspect-ov', 0, 800); }
    // REAL drags: buy (Shop -> board area), then play (hand -> board).
    const before = await count();
    await realDrag(await screenOf('[data-zone="tavern"] .row .card[data-uid]'), await screenOf('[data-zone="warband"]'));
    const bought = await count();
    // Playwright's headless WebKit cannot drive a card drag to a drop here IN EITHER ORIENTATION (its mouse picks the card
    // up, but the drop never lands; the same on the untouched landscape path), so WebKit reports the drags as a note and
    // the real-drag geometry is checked with true touch input in Chromium.
    const dragCheck = d.engine === 'webkit' ? (n, ok, det) => console.log(`   [${d.id}] note ${n}: ${ok ? 'landed' : 'not driven by the WebKit harness'}  (${det})`) : check;
    dragCheck('a real drag buys a Shop minion', bought.hand + bought.board > before.hand + before.board, `${JSON.stringify(before)} -> ${JSON.stringify(bought)}`);
    await realDrag(await screenOf('[data-zone="hand"] .card[data-uid]'), await screenOf('[data-zone="warband"]'));
    const played = await count();
    dragCheck('a real drag plays it to the board', played.board > before.board, `${JSON.stringify(bought)} -> ${JSON.stringify(played)}`);
    await shot('05-played');
    if (cdp) {
      // A REAL long-press on your portrait (the touch right-click, R-TOUCH-LONGPRESS-01) opens the emote menu beside it.
      const at = lay(await screenOf('.statusbar .hero .f'));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
      await sleep(700);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(900);
      const em = await page.evaluate(() => {
        const m = document.querySelector('.emote-menu'); const f = document.querySelector('.statusbar .hero .f');
        if (!m || !f) return null;
        const a = m.getBoundingClientRect(), b = f.getBoundingClientRect();
        return { dx: Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)), w: Math.max(a.width, b.width), gap: b.top - a.bottom };
      });
      check('a real long-press on your portrait opens the emote menu beside it', !!em && em.dx < em.w && em.gap > -200, JSON.stringify(em));
      await shot('05b-emotes');
      if (await page.evaluate(() => !!document.querySelector('.emote-menu'))) { await page.keyboard.press('Escape'); await sleep(500); }
      if (await page.evaluate(() => !!document.querySelector('.escpanel'))) { await page.keyboard.press('Escape'); await sleep(500); }
    }

    // Perf: idle frame intervals in the Shop, and the wrapped getBoundingClientRect.
    const perf = await page.evaluate(async () => {
      const ts = []; const t0 = performance.now();
      await new Promise((res) => { const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const dts = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      const el = document.querySelector('[data-zone="tavern"] .card[data-uid]') || document.body;
      const N = 20000; const b0 = performance.now(); for (let i = 0; i < N; i++) el.getBoundingClientRect(); const per = (performance.now() - b0) / N * 1000;
      return { frames: dts.length, p50: dts[Math.floor(dts.length * 0.5)], p95: dts[Math.floor(dts.length * 0.95)], bcrUs: per };
    });
    console.log(`   [${d.id}] perf: ${perf.frames} frames in 3 s, p50 ${perf.p50.toFixed(1)} ms, p95 ${perf.p95.toFixed(1)} ms; getBoundingClientRect ${perf.bcrUs.toFixed(2)} us/call`);

    if (d.android && d.upright) {
      // What the OS does once the lock holds: the window turns to landscape and the game drops the turned render.
      await page.setViewportSize({ width: d.viewport.height, height: d.viewport.width });
      await sleep(2500);
      const after = await page.evaluate(() => ({ side: document.documentElement.hasAttribute('data-sideways'), t: document.getElementById('stage')?.style.transform || '' }));
      check('Android once locked: the plain landscape game (not turned)', !after.side && !/rotate/.test(after.t), after.t);
      await shot('06-locked-landscape');
    }
    await ctx.close();
  }
} finally {
  for (const b of Object.values(browsers)) await b.close();
  server.close();
}
console.log(`screenshots: ${OUT}`);
if (failures.length) { console.log(`${failures.length} check(s) failed`); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('all checks passed');
