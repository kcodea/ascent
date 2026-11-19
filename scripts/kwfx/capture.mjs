#!/usr/bin/env node
/**
 * KEYWORD AURA BAKE (perf 2026-11-18, R-PERF-KEYWORD-AURA-01).
 *
 * The four heavy keyword auras (Rise, Flurry, Execute, Rebirth's crown) are AUTHORED as DOM + CSS: Card.tsx's live
 * markup, styled by styles.css and tuned in executeConfig / flurryConfig / rebirthConfig. That stays the source of
 * truth and the tuning surface. What players see is a CAPTURE of it: this script plays the live aura in headless
 * Chrome (the real GPU), photographs one loop of it frame by frame on a transparent page, and packs the frames into
 * one animated AVIF per aura (plus a WebP still for the paused state). The card then shows that picture on ONE layer with
 * no CSS animation, instead of 10 to 40 animating layers. Nothing here is drawn by hand: retune the aura, run this
 * again, commit the new files.
 *
 *   VITE_PERF_BENCH=1 npm run build:web
 *   node scripts/kwfx/capture.mjs [--dist apps/web/dist] [--only rise,flurry] [--port 5252] [--keep-frames <dir>]
 *   node scripts/kwfx/capture.mjs --stamp     no capture: re-stamp the manifest's signature after an edit to the aura
 *                                             sources that does NOT change the look (you are asserting that)
 *
 * HOW A LOOP IS MADE TO CLOSE. An aura is several CSS animations with unrelated periods (three Execute rings, twelve
 * shards, a flicker), so it never repeats exactly. Each animation is seeked by hand (Web Animations `currentTime`) to
 * `t * n * D / L`, where D is its own period, L the loop length and n the whole number of cycles nearest L / D: every
 * animation completes whole cycles in L, so frame N is frame 0 again. That changes each period by a few percent at
 * most (printed per aura, and written to the manifest as `maxSpeedChangePct`). A ring of k identical blades repeats
 * every D / k, so it is rounded on that finer period (`sym`).
 *
 * WHY A TRANSPARENT CAPTURE IS EXACT. Every aura root is its own stacking context (a transform), so its
 * `mix-blend-mode: screen` layers only ever blend with each other, never with the card under them. The group's RGBA
 * result is therefore the whole picture, and normal alpha compositing of the capture is what the browser already did.
 */
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { arg, flag, launch, serve, toShop, setScene } from './lib.mjs';
import { auraSignature } from './signature.mjs';
import { VARIANTS, ART_HALF, REACH, AURA_PAGE_JS } from './variants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.resolve(arg('dist', path.join(ROOT, 'apps/web/dist')));
const port = Number(arg('port', '5252'));
const OUT = path.resolve(arg('out', path.join(ROOT, 'apps/web/public/kwfx')));
const MANIFEST = path.resolve(arg('manifest', path.join(ROOT, 'packages/ui/src/kwfx/manifest.json')));
const only = arg('only', '') ? new Set(arg('only').split(',')) : null;
const keep = arg('keep-frames', '');



async function main() {
  if (flag('stamp')) {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); m.signature = auraSignature();
    fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n'); console.log(`manifest re-stamped: ${m.signature}`); return;
  }
  const server = await serve(dist, port);
  const c = await launch({ cdpPort: Number(arg('cdp', '9553')) });
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { auras: {} };
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  try {
    // The LIVE aura is what gets photographed, whatever the build's default (kwfx/kwfxMode.ts).
    await toShop(c, { url: `http://127.0.0.1:${port}/`, initJs: `try { localStorage.setItem('ascent.kwfx', 'live'); } catch {}` });
    await c.ev(AURA_PAGE_JS);
    for (const v of VARIANTS) {
      if (only && !only.has(v.id)) continue;
      await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: v.scale, mobile: false });
      await setScene(c, { keywords: v.kw, hand: 0 });
      const info = await c.ev(`window.__kwcap.prep(${JSON.stringify(v.sel)}, ${JSON.stringify(v.sym || null)}, ${JSON.stringify(v.tint || null)}, true)`);
      if (!info) throw new Error(`${v.id}: no ${v.sel} on the capture card`);
      const N = Math.round(v.loop * v.fps);
      let worst = 0;
      for (const a of info.anims) { if (!(a.D > 0) || v.loop / a.D < 0.25) continue; const n = Math.max(1, Math.round(v.loop * a.k / a.D)) / a.k; worst = Math.max(worst, Math.abs(v.loop / n - a.D) / a.D); }
      const R = Math.ceil(REACH * info.ccw);
      const clip = { x: Math.round(info.cx - R), y: Math.round(info.cy - R), width: 2 * R, height: 2 * R, scale: 1 };
      console.log(`${v.id}: ${info.anims.length} animations, loop ${v.loop}s x ${v.fps} fps = ${N} frames, largest period change ${(worst * 100).toFixed(2)}%`);
      await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      const pngs = [];
      for (let i = 0; i < N; i++) {
        await c.ev(`window.__kwcap.seek(${(i * v.loop / N).toFixed(5)}, ${v.loop})`);
        pngs.push(Buffer.from((await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })).data, 'base64'));
      }
      await c.send('Emulation.setDefaultBackgroundColorOverride', {});
      if (keep) { const d = path.join(keep, v.id); fs.mkdirSync(d, { recursive: true }); pngs.forEach((p, i) => { if (i % Math.max(1, Math.floor(N / 24)) === 0) fs.writeFileSync(path.join(d, `${String(i).padStart(4, '0')}.png`), p); }); }

      // The crop: the art window for an aura the card clips there, otherwise the union of every frame's alpha bounds,
      // kept symmetric about the aura's centre (so the card can seat it with one translate).
      const S = v.scale; const side = 2 * R * S; const mid = side / 2;
      let hw; let hh;
      if (v.box === 'art') { hw = Math.ceil(ART_HALF[0] * info.ccw * S); hh = Math.ceil(ART_HALF[1] * info.ccw * S); }
      else {
        let x0 = side; let y0 = side; let x1 = 0; let y1 = 0;
        for (const p of pngs) {
          const { data, info: im } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          if (im.width !== side || im.height !== side) throw new Error(`${v.id}: screenshot is ${im.width} x ${im.height}, wanted ${side}`);
          for (let y = 0; y < side; y++) { const row = y * side * 4; for (let x = 0; x < side; x++) if (data[row + x * 4 + 3] > 3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        }
        if (x1 < x0) throw new Error(`${v.id}: every frame is empty`);
        hw = Math.min(mid, Math.ceil(Math.max(mid - x0, x1 + 1 - mid)) + 2); hh = Math.min(mid, Math.ceil(Math.max(mid - y0, y1 + 1 - mid)) + 2);
        if (hw >= mid || hh >= mid) console.log(`   WARNING ${v.id}: the aura reaches the edge of the photographed square (raise REACH)`);
      }
      const w = 2 * hw; const h = 2 * hh;
      // Frames -> a PNG sequence -> one animated AVIF (AV1 predicts each frame from the last, which is what makes a
      // soft, slowly moving picture small: the same frames as an animated WebP were 15x the bytes).
      // Where a pixel is all but transparent its straight colour is noise (1/255 of alpha cannot carry a hue), and
      // noise costs bits and can fringe: those pixels take the aura's mean colour. Their alpha is untouched.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwfx-seq-'));
      let first = null; let mean = null;
      for (let i = 0; i < N; i++) {
        const raw = await sharp(pngs[i]).ensureAlpha().extract({ left: mid - hw, top: mid - hh, width: w, height: h }).raw().toBuffer();
        if (!mean) { let r = 0; let g = 0; let bl = 0; let n = 0; for (let p = 0; p < raw.length; p += 4) if (raw[p + 3] > 48) { r += raw[p]; g += raw[p + 1]; bl += raw[p + 2]; n++; } if (n) mean = [Math.round(r / n), Math.round(g / n), Math.round(bl / n)]; }
        if (mean) for (let p = 0; p < raw.length; p += 4) if (raw[p + 3] <= 4) { raw[p] = mean[0]; raw[p + 1] = mean[1]; raw[p + 2] = mean[2]; }
        if (i === 0) first = Buffer.from(raw);
        await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 1 }).toFile(path.join(tmp, String(i).padStart(4, '0') + '.png'));
      }
      const file = path.join(OUT, `${v.id}.avif`); const still = path.join(OUT, `${v.id}-still.webp`);
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', (N / v.loop).toFixed(4), '-i', path.join(tmp, '%04d.png'),
        '-filter_complex', '[0:v]split[c0][a0];[c0]scale=out_color_matrix=bt709:out_range=full,format=yuv444p[c];[a0]alphaextract,scale=out_range=full,format=gray[a]',
        '-map', '[c]', '-map', '[a]', '-c:v', 'libaom-av1', '-crf', String(v.crf), '-b:v', '0', '-cpu-used', arg('cpu-used', '3'),
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'pc', '-loop', '0', '-f', 'avif', file], { stdio: 'inherit' });
      fs.rmSync(tmp, { recursive: true, force: true });
      await sharp(first, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(still);
      if (keep) await sharp(first, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(keep, `${v.id}-frame0.png`));
      manifest.auras[v.id] = { w: +(w / S / info.ccw).toFixed(4), h: +(h / S / info.ccw).toFixed(4), px: [w, h], frames: N, fps: v.fps, loopSec: v.loop, maxSpeedChangePct: +(worst * 100).toFixed(2), bytes: fs.statSync(file).size, stillBytes: fs.statSync(still).size };
      console.log(`   -> ${path.relative(ROOT, file)} ${w} x ${h} px, ${(fs.statSync(file).size / 1024).toFixed(0)} KB (still ${(fs.statSync(still).size / 1024).toFixed(1)} KB)`);
    }
  } finally { c.close(); server.close(); }
  manifest.signature = auraSignature();
  manifest.note = 'GENERATED by scripts/kwfx/capture.mjs. Do not edit: re-run the capture.';
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${path.relative(ROOT, MANIFEST)} (signature ${manifest.signature})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await main(); process.exit(0); }
