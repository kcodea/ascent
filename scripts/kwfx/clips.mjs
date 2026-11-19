#!/usr/bin/env node
/**
 * KEYWORD AURA FRAME-RATE CLIPS: what a 240 Hz display shows of each aura, live vs baked at N pictures a second,
 * side by side, frame for frame.
 *
 *   VITE_PERF_BENCH=1 npm run build:web
 *   node scripts/kwfx/clips.mjs --out <dir> [--dist apps/web/dist] [--rates 90,60,30] [--auras rise,flurry,execute,rebirth] [--secs 4] [--hz 240]
 *
 * Writes, per aura, `<aura>-<hz>hz.mp4` (real time, one video frame per display frame) and `<aura>-quarter-speed.mp4`
 * (the same frames at a quarter of the speed, to judge on a 60 Hz screen), columns left to right: live, then each rate.
 *
 * HOW. A real-time recording cannot do this: Chrome's screencast and screenshots top out near 30 a second, and an
 * animated image does not advance under headless begin-frame control (tried 2026-11-19). So each display frame is made
 * by seeking: the live aura is put at time t = k / hz on its card in the shop (`__kwcap.seek`, the capture's own loop
 * clock) and photographed; a column baked at F pictures a second shows, at display frame k, the picture for time
 * floor(t * F) / F, which is what the capture baked for that instant. That is the BEST case for a rate that does not
 * divide the display: measured in Chromium, 90 a second holds each picture for an uneven 1 to 4 refreshes of 240 Hz,
 * not the even 2 to 3 shown here. AV1 compression is left out (live vs baked differ by 0.1 to 0.3 of 255 on average,
 * compare.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { arg, launch, serve, toShop, setScene } from './lib.mjs';
import { VARIANTS, AURA_PAGE_JS } from './variants.mjs';

const OUT = path.resolve(arg('out', 'shots/kwfx/clips'));
const dist = path.resolve(arg('dist', 'apps/web/dist'));
const port = Number(arg('port', '5252'));
const secs = Number(arg('secs', '4'));
const HZ = Number(arg('hz', '240'));
const rates = arg('rates', '90,60,30').split(',').map(Number);
const auras = arg('auras', 'rise,flurry,execute,rebirth').split(',');
fs.mkdirSync(OUT, { recursive: true });
const ff = (args) => { const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`); };
const FONT = "fontfile='C\\:/Windows/Fonts/arial.ttf'";

const server = await serve(dist, port);
const c = await launch({ cdpPort: Number(arg('cdp', '9554')) });
try {
  await toShop(c, { url: `http://127.0.0.1:${port}/`, initJs: `try { localStorage.setItem('ascent.kwfx', 'live'); } catch {}` });
  await c.ev(AURA_PAGE_JS);
  for (const id of auras) {
    const v = VARIANTS.find((x) => x.id === id); if (!v) throw new Error(`no variant ${id}`);
    // 2 device pixels per CSS pixel: the card photographed at twice the size, as on a 4K screen.
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
    await setScene(c, { keywords: v.kw, board: 3, hand: 0 });
    const info = await c.ev(`window.__kwcap.prep(${JSON.stringify(v.sel)}, ${JSON.stringify(v.sym || null)}, null, false)`);
    if (!info) throw new Error(`${id}: no ${v.sel} on the card`);
    await c.ev('window.__kwcap.zeroOthers()');
    const R = Math.round(0.95 * info.ccw); const H = Math.round(1.15 * info.ccw);
    const clip = { x: Math.round(info.cx - R), y: Math.round(info.cy - H), width: 2 * R, height: 2 * H, scale: 1 };
    const tmp = path.join(OUT, `_${id}`); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const shots = new Map(); // loop time (rounded to 1 us) -> png file
    const at = async (t) => {
      const key = t.toFixed(6); if (shots.has(key)) return shots.get(key);
      await c.ev(`window.__kwcap.seek(${t.toFixed(6)}, ${v.loop})`);
      const f = path.join(tmp, `s${shots.size}.png`);
      fs.writeFileSync(f, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })).data, 'base64'));
      shots.set(key, f); return f;
    };
    const cols = [{ label: `live (${HZ} Hz)`, F: HZ }, ...rates.map((F) => ({ label: `baked ${F}/s`, F }))];
    const N = Math.round(secs * HZ);
    for (const col of cols) {
      let list = '';
      for (let k = 0; k < N; k++) { const t = Math.floor((k / HZ) * col.F + 1e-9) / col.F; list += `file '${(await at(t)).replace(/\\/g, '/')}'\nduration ${(1 / HZ).toFixed(6)}\n`; }
      fs.writeFileSync(path.join(tmp, `${col.F}.txt`), list);
      ff(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, `${col.F}.txt`), '-vf', `fps=${HZ},drawtext=${FONT}:text='${col.label}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5`,
        '-frames:v', String(N), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', path.join(tmp, `${col.F}.mp4`)]);
    }
    const parts = cols.map((col) => path.join(tmp, `${col.F}.mp4`));
    const stack = `${parts.map((_, i) => `[${i}:v]`).join('')}hstack=inputs=${parts.length}`;
    const rt = path.join(OUT, `${id}-${HZ}hz.mp4`); const slow = path.join(OUT, `${id}-quarter-speed.mp4`);
    ff([...parts.flatMap((p) => ['-i', p]), '-filter_complex', `${stack}[v]`, '-map', '[v]', '-r', String(HZ), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', rt]);
    ff([...parts.flatMap((p) => ['-i', p]), '-filter_complex', `${stack},setpts=4*PTS[v]`, '-map', '[v]', '-r', String(HZ / 4), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', slow]);
    console.log(`${id}: ${shots.size} photographs, ${N} display frames -> ${rt}, ${slow}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} finally { c.close(); server.close(); }
process.exit(0);
