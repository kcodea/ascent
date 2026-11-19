#!/usr/bin/env node
/**
 * HOW FAST CAN CHROMIUM PLAY AN ANIMATED IMAGE? (docs/performance.md §3p, measured 2026-11-19)
 *
 *   node scripts/kwfx/fps-probe.mjs [--rates 30,60,90,100,120,240] [--port 5262] [--out <dir>]
 *
 * Makes 240-frame animated AVIF and WebP probes at each rate, every frame stamped with its index as 8 black / white
 * bars, shows each alone on a page in headless Chrome (real GPU), and reports per file:
 *  - played: pictures a second actually shown (frame indices read back from screenshots over 3 s);
 *  - the compositor's new-picture cadence from a trace (`ImageAnimationController::WillActivate`), as display
 *    refreshes per picture at 240 Hz (an even rate shows one bucket, e.g. 4 for 60 a second).
 * Result 2026-11-19 (Chrome 150, RTX 4080): 30, 60 and 90 play; 100, 120 and 240 all play at 10 (Blink holds a frame
 * of 10 ms or less for 100 ms). 90 lands on an uneven 1 to 4 refreshes a picture.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import { arg, launch, serve, sleep } from './lib.mjs';

const rates = arg('rates', '30,60,90,100,120,240').split(',').map(Number);
const out = path.resolve(arg('out', path.join(os.tmpdir(), 'kwfx-fps-probe')));
const port = Number(arg('port', '5262'));
const N = 240; const W = 128; const H = 32;
fs.mkdirSync(out, { recursive: true });
const seq = fs.mkdtempSync(path.join(os.tmpdir(), 'kwfx-probe-seq-'));
const frames = [];
for (let i = 0; i < N; i++) {
  const b = Buffer.alloc(W * H * 4);
  for (let x = 0; x < W; x++) { const v = (i >> Math.floor(x / 16)) & 1 ? 255 : 0; for (let y = 0; y < H; y++) { const p = (y * W + x) * 4; b[p] = b[p + 1] = b[p + 2] = v; b[p + 3] = 255; } }
  frames.push(b); await sharp(b, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(seq, String(i).padStart(4, '0') + '.png'));
}
const files = [];
for (const fps of rates) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(seq, '%04d.png'), '-c:v', 'libaom-av1', '-crf', '20', '-b:v', '0', '-cpu-used', '6', '-pix_fmt', 'yuv444p', '-loop', '0', '-f', 'avif', path.join(out, `p${fps}.avif`)]);
  await sharp(Buffer.concat(frames), { raw: { width: W, height: H * N, channels: 4, pageHeight: H } }).webp({ lossless: true, loop: 0, delay: Array(N).fill(Math.round(1000 / fps)), effort: 2 }).toFile(path.join(out, `p${fps}.webp`));
  files.push(`p${fps}.avif`, `p${fps}.webp`);
}
fs.rmSync(seq, { recursive: true, force: true });
const page = `<!doctype html><body style="margin:0;background:#222"><div id="x" style="position:absolute;left:10px;top:10px;width:${W}px;height:${H}px;will-change:transform"></div><script>document.getElementById('x').style.background='url('+location.search.slice(1)+') 0 0/100% 100% no-repeat';const t=()=>requestAnimationFrame(t);requestAnimationFrame(t)</script></body>`;
for (const f of ['one.html', 'index.html']) fs.writeFileSync(path.join(out, f), page); // lib's serve() falls back to index.html

const server = await serve(out, port);
const c = await launch({ cdpPort: Number(arg('cdp', '9671')), width: 600, height: 400 });
try {
  for (const f of files) {
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/one.html?${f}` }); await sleep(2500);
    const clip = { x: 10, y: 10, width: W, height: H, scale: 1 }; const pts = []; const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      const a = performance.now(); const d = (await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })).data;
      const raw = await sharp(Buffer.from(d, 'base64')).removeAlpha().raw().toBuffer(); let idx = 0;
      for (let k = 0; k < 8; k++) if (raw[(16 * W + k * 16 + 8) * 3] > 127) idx |= 1 << k;
      pts.push([(a + performance.now()) / 2, idx]);
    }
    let wrap = 0; const u = [pts[0]]; for (let i = 1; i < pts.length; i++) { if (pts[i][1] < pts[i - 1][1] - 20) wrap += N; u.push([pts[i][0], pts[i][1] + wrap]); }
    const played = (u[u.length - 1][1] - u[0][1]) / ((u[u.length - 1][0] - u[0][0]) / 1000);
    const ts = []; const h = (p) => { for (const ev of p.value) if (ev.name === 'ImageAnimationController::WillActivate') ts.push(ev.ts / 1000); };
    let fin; const done = new Promise((r) => { fin = r; }); c.on('Tracing.dataCollected', h); c.on('Tracing.tracingComplete', fin);
    await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['cc', 'disabled-by-default-cc.debug'] } });
    await sleep(3000); await c.send('Tracing.end'); await done; c.off('Tracing.dataCollected', h); c.off('Tracing.tracingComplete', fin); await sleep(300);
    ts.sort((a, b) => a - b); const hist = {}; for (let i = 1; i < ts.length; i++) { const k = Math.round((ts[i] - ts[i - 1]) / (1000 / 240)); hist[k] = (hist[k] || 0) + 1; }
    console.log(JSON.stringify({ file: f, played: +played.toFixed(1), newPicturesPerS: +(ts.length / 3).toFixed(1), refreshesPerPictureAt240Hz: hist }));
  }
} finally { c.close(); server.close(); }
process.exit(0);
