#!/usr/bin/env node
/**
 * CARD RASTER DIFF (perf/card-raster, 2026-11-18): pixel-diff two sets of `perf-card-raster.mjs --shots` captures and
 * build the side-by-side contact sheets (before | after | difference x8).
 *
 *   node scripts/perf-card-raster-diff.mjs --a <dir> --atag base --b <dir> --btag after --out <dir> [--label "..."]
 *
 * Per capture it crops every card (the rects the capture run wrote, plus a margin for shadows and badges), and for the
 * hover / drag captures the region around the pointer, then reports per crop: the share of pixels that differ by more
 * than 2 / 8 / 24 levels (max over R, G, B), the mean difference and the largest one. Run it base-vs-base first: that
 * is the noise floor (ambient motion on the board, sub-pixel text), and a change is only real above it.
 */
import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const A = arg('a'), B = arg('b'), AT = arg('atag', 'base'), BT = arg('btag', 'after'), OUT = arg('out', 'shots'); const LABEL = arg('label', `${AT} vs ${BT}`);
fs.mkdirSync(OUT, { recursive: true });
const MARGIN = 26;

const raw = async (file, region) => { let img = sharp(file).removeAlpha(); if (region) img = img.extract(region); const { data, info } = await img.raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
function diffStats(a, b) {
  const n = a.w * a.h; let o2 = 0, o8 = 0, o24 = 0, sum = 0, max = 0; const d = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) { const k = i * 3; const m = Math.max(Math.abs(a.data[k] - b.data[k]), Math.abs(a.data[k + 1] - b.data[k + 1]), Math.abs(a.data[k + 2] - b.data[k + 2])); sum += m; if (m > max) max = m; if (m > 2) o2++; if (m > 8) o8++; if (m > 24) o24++; const v = Math.min(255, m * 8); d[k] = v; d[k + 1] = v; d[k + 2] = v; }
  return { over2: +(100 * o2 / n).toFixed(3), over8: +(100 * o8 / n).toFixed(3), over24: +(100 * o24 / n).toFixed(3), mean: +(sum / n).toFixed(3), max, diff: d };
}

const rows = [];
for (const dpr of [1, 2]) {
  const rectsFile = path.join(A, `${AT}-rects@${dpr}x.json`); if (!fs.existsSync(rectsFile)) continue;
  const rects = JSON.parse(fs.readFileSync(rectsFile, 'utf8'));
  const names = fs.readdirSync(A).filter((f) => f.startsWith(AT + '-') && f.endsWith(`@${dpr}x.png`)).map((f) => f.slice(AT.length + 1, -(`@${dpr}x.png`).length));
  for (const name of names) {
    const fa = path.join(A, `${AT}-${name}@${dpr}x.png`), fb = path.join(B, `${BT}-${name}@${dpr}x.png`); if (!fs.existsSync(fb)) { console.log(`missing in B: ${name}@${dpr}x`); continue; }
    const meta = await sharp(fa).metadata(); const mb = await sharp(fb).metadata(); if (meta.width !== mb.width || meta.height !== mb.height) { console.log(`size mismatch ${name}@${dpr}x`); continue; }
    const crops = [];
    const add = (label, [x, y, w, h], m = MARGIN) => { const L = Math.max(0, Math.floor((x - m) * dpr)), T = Math.max(0, Math.floor((y - m) * dpr)); const R = Math.min(meta.width, Math.ceil((x + w + m) * dpr)), Bm = Math.min(meta.height, Math.ceil((y + h + m) * dpr)); if (R - L > 4 && Bm - T > 4) crops.push({ label, region: { left: L, top: T, width: R - L, height: Bm - T } }); };
    const extra = rects.extra?.[name];
    if (extra) for (const [label, r] of Object.entries(extra)) add(label, r, 40);
    const per = rects.byShot?.[name]; if (per) for (const z of ['tavern', 'warband', 'hand']) (per[z] || []).forEach((r, i) => add(`${z}#${i}`, r, z === 'hand' ? 60 : MARGIN));
    crops.unshift({ label: 'WHOLE', region: { left: 0, top: 0, width: meta.width, height: meta.height } });
    const tiles = [];
    for (const c of crops) {
      const a = await raw(fa, c.region), b = await raw(fb, c.region); const s = diffStats(a, b);
      rows.push({ shot: `${name}@${dpr}x`, crop: c.label, w: a.w, h: a.h, over2: s.over2, over8: s.over8, over24: s.over24, mean: s.mean, max: s.max });
      if (c.label === 'WHOLE') continue;
      tiles.push({ label: c.label, w: a.w, h: a.h, a: await sharp(fa).extract(c.region).png().toBuffer(), b: await sharp(fb).extract(c.region).png().toBuffer(), d: await sharp(s.diff, { raw: { width: a.w, height: a.h, channels: 3 } }).png().toBuffer(), s });
    }
    if (!tiles.length) continue;
    // contact sheet: one row per crop, [before | after | diff x8], wrapped into columns of rows
    const PAD = 8 * dpr, TXT = 18 * dpr; const perCol = Math.ceil(tiles.length / Math.ceil(tiles.length / 6));
    const cols = []; for (let i = 0; i < tiles.length; i += perCol) cols.push(tiles.slice(i, i + perCol));
    const colW = cols.map((col) => Math.max(...col.map((t) => t.w * 3 + PAD * 4))); const colH = cols.map((col) => col.reduce((h, t) => h + t.h + TXT + PAD, PAD));
    const W = colW.reduce((a, b) => a + b, 0), H = Math.max(...colH) + TXT * 2;
    const comp = []; let x0 = 0;
    const text = (s, w, h, size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="2" y="${h - 4 * dpr}" font-family="Segoe UI, Arial" font-size="${size}" fill="#e8e8e8">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
    comp.push({ input: text(`${LABEL}: ${name} @${dpr}x.  each row: before | after | difference x8`, W, TXT * 2, 14 * dpr), left: 0, top: 0 });
    cols.forEach((col, ci) => { let y = TXT * 2 + PAD; for (const t of col) { comp.push({ input: text(`${t.label}: over 8 levels ${t.s.over8}% of pixels, mean ${t.s.mean}, max ${t.s.max}`, colW[ci], TXT, 11 * dpr), left: x0, top: y }); y += TXT; comp.push({ input: t.a, left: x0 + PAD, top: y }, { input: t.b, left: x0 + PAD * 2 + t.w, top: y }, { input: t.d, left: x0 + PAD * 3 + t.w * 2, top: y }); y += t.h + PAD; } x0 += colW[ci]; });
    const out = path.join(OUT, `sheet-${AT}-vs-${BT}-${name}@${dpr}x.png`);
    await sharp({ create: { width: W, height: H, channels: 3, background: '#1b1f27' } }).composite(comp).png({ compressionLevel: 9 }).toFile(out);
    console.log('sheet ' + out);
  }
}
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${LABEL}\n${pad('shot', 18)} ${pad('crop', 14)} ${pad('size', 10)} ${pad('>2 %', 8)} ${pad('>8 %', 8)} ${pad('>24 %', 8)} ${pad('mean', 7)} max`);
for (const r of rows) console.log(`${pad(r.shot, 18)} ${pad(r.crop, 14)} ${pad(r.w + 'x' + r.h, 10)} ${pad(r.over2, 8)} ${pad(r.over8, 8)} ${pad(r.over24, 8)} ${pad(r.mean, 7)} ${r.max}`);
fs.writeFileSync(path.join(OUT, `diff-${AT}-vs-${BT}.json`), JSON.stringify(rows, null, 1));
