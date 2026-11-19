#!/usr/bin/env node
/**
 * KEYWORD AURA LOOK CHECK: the live (authored DOM + CSS) aura against its baked picture, ON THE CARD.
 *
 *   VITE_PERF_BENCH=1 npm run build:web
 *   node scripts/kwfx/compare.mjs [--dist apps/web/dist] [--out shots/kwfx] [--port 5252]
 *
 * For every baked picture, at 1x and 2x device pixels, in the shop:
 *   LIVE   the page runs with `ascent.kwfx = live`; every animation is paused, the aura is seeked to loop time t exactly
 *          as the capture does, and the card is photographed;
 *   BAKED  the same card in the default mode; frame t of the shipped AVIF (decoded in the page with ImageDecoder) is put
 *          on the aura's element, and the card is photographed.
 * Same card, same instant, so the two crops can be differenced: the table prints the mean and the largest channel
 * difference (0-255) and the share of pixels more than 16 apart, and the contact sheet lays live | baked | difference x4
 * side by side. Then one combat pair per mode (units in a fight, real time, not time-matched: it shows seating and
 * layering on a unit, not a frame match).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { arg, launch, serve, toShop, toCombat, setScene, sleep } from './lib.mjs';
import { REPO_ROOT } from './signature.mjs';
import { VARIANTS, AURA_PAGE_JS } from './variants.mjs';

const dist = path.resolve(arg('dist', path.join(REPO_ROOT, 'apps/web/dist')));
const port = Number(arg('port', '5252'));
const OUT = path.resolve(arg('out', path.join(REPO_ROOT, 'shots/kwfx')));
const only = arg('only', '') ? new Set(arg('only').split(',')) : null;
const TIMES = [0, 0.27, 0.61, 0.83]; // fractions of the loop
const BAKED_SEL = { '.reborn': '.kwfx-rise', '.flurry': '.kwfx-flurry', '.execute': '.kwfx-execute', '.rebirth-crown': '.kwfx-rebirth' };
fs.mkdirSync(OUT, { recursive: true });

const server = await serve(dist, port);
const c = await launch({ cdpPort: Number(arg('cdp', '9554')) });
const url = `http://127.0.0.1:${port}/`;
const crops = {}; // id -> dpr -> mode -> [png per time]
const rows = [];

const cropOf = (info) => { const R = Math.ceil(1.1 * info.ccw); return { x: Math.round(info.acx - R), y: Math.round(info.acy - R * 0.92), width: 2 * R, height: Math.round(2 * R * 1.04), scale: 1 }; };
const snap = async (clip) => Buffer.from((await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })).data, 'base64');
const cardInfo = `(() => { const cards = [...document.querySelectorAll('[data-zone=warband] .card.compact')]; const card = cards[Math.floor(cards.length / 2)]; const a = card.querySelector('.archbox').getBoundingClientRect(); return { acx: a.left + a.width / 2, acy: a.top + a.height / 2, ccw: parseFloat(getComputedStyle(card).getPropertyValue('--ccw')) }; })()`;

async function pass(mode) {
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: mode === 'live' ? `try { localStorage.setItem('ascent.kwfx', 'live'); } catch {}` : `try { localStorage.removeItem('ascent.kwfx'); } catch {}` });
  await toShop(c, { url });
  await c.ev(AURA_PAGE_JS);
  await c.ev(`window.__kwFrame = async (src, k) => { const r = await fetch(src); const dec = new ImageDecoder({ data: r.body, type: 'image/avif' }); await dec.tracks.ready; const { image } = await dec.decode({ frameIndex: k }); const cv = new OffscreenCanvas(image.displayWidth, image.displayHeight); cv.getContext('2d').drawImage(image, 0, 0); image.close(); const blob = await cv.convertToBlob({ type: 'image/png' }); const u = URL.createObjectURL(blob); const im = new Image(); im.src = u; await im.decode(); window.__kwHold = im; return u; }`);
  for (const dpr of [1, 2]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: dpr, mobile: false });
    for (const v of VARIANTS) {
      if (only && !only.has(v.id)) continue;
      await setScene(c, { keywords: v.kw, hand: 0, board: 1 }); // one card: no neighbour's aura in the crop
      if (mode === 'baked' && !(await c.waitFor(`!!document.querySelector('[data-zone=warband] ${BAKED_SEL[v.sel]}')`, 20000))) throw new Error(`${v.id}: the baked aura never rendered (did the pictures load?)`);
      const N = Math.round(v.loop * v.fps);
      const shots = [];
      for (const f of TIMES) {
        const k = Math.round(f * N) % N;
        if (mode === 'live') {
          const info = await c.ev(`window.__kwcap.prep(${JSON.stringify(v.sel)}, ${JSON.stringify(v.sym || null)}, ${JSON.stringify(v.tint || null)}, false)`);
          if (!info) throw new Error(`${v.id}: no live ${v.sel}`);
          await c.ev(`window.__kwcap.zeroOthers()`);
          await c.ev(`window.__kwcap.seek(${(k * v.loop / N).toFixed(5)}, ${v.loop})`);
        } else {
          await c.ev(`(async () => { document.querySelectorAll('.card.compact').forEach((e) => e.classList.remove('risetint-blue', 'risetint-red')); const cards = [...document.querySelectorAll('[data-zone=warband] .card.compact')]; const card = cards[Math.floor(cards.length / 2)]; ${v.tint ? `card.classList.add('risetint-${v.tint}');` : ''} for (const a of document.getAnimations()) { a.pause(); try { a.currentTime = 0; } catch {} } const el = card.querySelector(${JSON.stringify(BAKED_SEL[v.sel])}); el.style.backgroundImage = 'url(' + await window.__kwFrame('/kwfx/${v.id}.avif', ${k}) + ')'; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
        }
        await sleep(120);
        shots.push(await snap(cropOf(await c.ev(cardInfo))));
      }
      ((crops[v.id] ||= {})[dpr] ||= {})[mode] = shots;
      console.log(`${mode} ${v.id} @${dpr}x: ${shots.length} crops`);
    }
  }
  // Combat: a keyworded board in a fight, real time, on a fresh page (the shop pass leaves every animation paused).
  if (!flagNoCombat) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await toShop(c, { url });
    if (!(await toCombat(c, { perCard: [['R'], ['W'], ['V'], ['RB'], ['R', 'W'], ['V', 'RB'], ['R', 'T']] }))) { console.log(`${mode} combat: the fight never started`); return; }
    for (const dpr of [1, 2]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: dpr, mobile: false });
      await sleep(700);
      const row = await c.ev(`(() => { const us = [...document.querySelectorAll('.unit .card.compact')].map((e) => e.getBoundingClientRect()); if (!us.length) return null; const y1 = Math.max(...us.map((r) => r.bottom)); const mine = us.filter((r) => r.bottom > y1 - 60); const x0 = Math.max(0, Math.min(...mine.map((r) => r.left)) - 50); const x1 = Math.min(1920, Math.max(...mine.map((r) => r.right)) + 50); const y0 = Math.max(0, Math.min(...mine.map((r) => r.top)) - 70); return { x: x0, y: y0, width: x1 - x0, height: Math.min(1080, y1 + 50) - y0, n: mine.length }; })()`);
      if (row) { fs.writeFileSync(path.join(OUT, `combat-${mode}-${dpr}x.png`), await snap({ x: row.x, y: row.y, width: row.width, height: row.height, scale: 1 })); console.log(`${mode} combat @${dpr}x: ${row.n} unit cards in the row`); }
    }
  }
}
const flagNoCombat = process.argv.includes('--no-combat');

try {
  await pass('live');
  await pass('baked');
} finally { c.close(); server.close(); }

// Difference + contact sheets.
const label = (text, w, h = 22) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#14161c"/><text x="6" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#e8e6df">${text}</text></svg>`) });
for (const dpr of [1, 2]) {
  const tiles = []; let y = 0; let sheetW = 0;
  for (const v of VARIANTS) {
    const pair = crops[v.id]?.[dpr]; if (!pair?.live || !pair?.baked) continue;
    let worstMean = 0; let worstMax = 0; let worstOver = 0; let x = 0; let rowH = 0;
    const N = Math.round(v.loop * v.fps);
    for (let i = 0; i < TIMES.length; i++) {
      const A = await sharp(pair.live[i]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const B = await sharp(pair.baked[i]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const w = Math.min(A.info.width, B.info.width); const h = Math.min(A.info.height, B.info.height);
      const D = Buffer.alloc(w * h * 3); let sum = 0; let mx = 0; let over = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        let px = 0;
        for (let ch = 0; ch < 3; ch++) { const d = Math.abs(A.data[(yy * A.info.width + xx) * 3 + ch] - B.data[(yy * B.info.width + xx) * 3 + ch]); sum += d; if (d > mx) mx = d; if (d > px) px = d; D[(yy * w + xx) * 3 + ch] = Math.min(255, d * 4); }
        if (px > 16) over++;
      }
      const mean = sum / (w * h * 3); const pct = 100 * over / (w * h);
      worstMean = Math.max(worstMean, mean); worstMax = Math.max(worstMax, mx); worstOver = Math.max(worstOver, pct);
      const diffPng = await sharp(D, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
      const frame = Math.round(TIMES[i] * N) % N;
      for (const [buf, name] of [[pair.live[i], `LIVE  ${v.id} frame ${frame}`], [pair.baked[i], 'BAKED'], [diffPng, `difference x4 (mean ${mean.toFixed(2)}, max ${mx})`]]) {
        tiles.push({ ...label(name, w), left: x, top: y }); tiles.push({ input: buf, left: x, top: y + 22 }); x += w + 4;
      }
      x += 10; rowH = Math.max(rowH, h + 22);
    }
    rows.push({ id: v.id, dpr, mean: +worstMean.toFixed(2), max: worstMax, over16: +worstOver.toFixed(2) });
    sheetW = Math.max(sheetW, x); y += rowH + 8;
  }
  if (tiles.length) {
    await sharp({ create: { width: sheetW, height: y, channels: 3, background: { r: 20, g: 22, b: 28 } } }).composite(tiles).png({ compressionLevel: 9 }).toFile(path.join(OUT, `contact-shop-${dpr}x.png`));
    console.log(`contact sheet: ${path.join(OUT, `contact-shop-${dpr}x.png`)}`);
  }
}
for (const dpr of [1, 2]) {
  const a = path.join(OUT, `combat-live-${dpr}x.png`); const b = path.join(OUT, `combat-baked-${dpr}x.png`);
  if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
  const ma = await sharp(a).metadata(); const mb = await sharp(b).metadata();
  const w = Math.max(ma.width, mb.width);
  await sharp({ create: { width: w, height: ma.height + mb.height + 48, channels: 3, background: { r: 20, g: 22, b: 28 } } })
    .composite([{ ...label('LIVE (authored DOM + CSS), in combat. Units: Rise, Flurry, Execute, Rebirth, Rise+Flurry, Execute+Rebirth, Rise+Taunt', w), left: 0, top: 0 }, { input: a, left: 0, top: 22 }, { ...label('BAKED (one picture per aura), in combat. Real time, not time-matched', w), left: 0, top: ma.height + 24 }, { input: b, left: 0, top: ma.height + 46 }])
    .png({ compressionLevel: 9 }).toFile(path.join(OUT, `contact-combat-${dpr}x.png`));
  fs.rmSync(a); fs.rmSync(b);
}
console.log('\n| aura | device pixels | mean difference (0-255) | largest difference | pixels more than 16 apart |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} | ${r.dpr}x | ${r.mean} | ${r.max} | ${r.over16}% |`);
fs.writeFileSync(path.join(OUT, 'difference.json'), JSON.stringify(rows, null, 1));
process.exit(0);
