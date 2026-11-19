#!/usr/bin/env node
/**
 * KEYWORD AURA CLIPS: real-time side-by-side recordings of one aura on a card, one column per variant.
 *
 *   node scripts/kwfx/clips.mjs --out <dir> --variant "label|dist|overlay|liveList" [--variant ...] [--auras R,W,V,RB] [--secs 6]
 *
 * A variant is a build (`dist`, a VITE_PERF_BENCH=1 build), an optional overlay directory served over it (so another
 * set of /kwfx pictures can be tried on the same build) and what `ascent.kwfx.live` is set to (`all` = the authored
 * live auras, `none` = every aura baked, or a list). Each variant is recorded on its own page load (Chrome's screencast:
 * a frame whenever the picture changes), cropped to the card and stacked left to right with ffmpeg. The columns are not
 * time-matched; this shows motion, not a frame-for-frame match (compare.mjs does that). The screencast tops out well
 * under 240 pictures a second, so the printed capture rate is the ceiling of what a clip can show.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { arg, launch, serve, toShop, setScene, sleep } from './lib.mjs';

const OUT = path.resolve(arg('out', 'shots/kwfx/clips'));
const port = Number(arg('port', '5262'));
const secs = Number(arg('secs', '6'));
const auras = arg('auras', 'R,W,V,RB').split(',');
const variants = process.argv.flatMap((a, i) => (a === '--variant' ? [process.argv[i + 1]] : [])).map((v) => { const [label, dist, overlay, live] = v.split('|'); return { label, dist: path.resolve(dist), overlay: overlay ? path.resolve(overlay) : undefined, live: live || '' }; });
const NAME = { R: 'rise', W: 'flurry', V: 'execute', RB: 'rebirth' };
fs.mkdirSync(OUT, { recursive: true });
const tmp = path.join(OUT, '_frames');
const ff = (args) => { const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`); };
const rates = {};

for (const v of variants) {
  const server = await serve(v.dist, port, v.overlay);
  const c = await launch({ cdpPort: Number(arg('cdp', '9675')) });
  try {
    const init = v.live === 'all' ? `try { localStorage.setItem('ascent.kwfx', 'live'); } catch {}` : `try { localStorage.removeItem('ascent.kwfx'); localStorage.setItem('ascent.kwfx.live', ${JSON.stringify(v.live === 'none' ? '' : v.live)}); } catch {}`;
    await toShop(c, { url: `http://127.0.0.1:${port}/`, initJs: init });
    for (const a of auras) {
      await setScene(c, { keywords: [a], board: 1, hand: 0 });
      await sleep(2500);
      const box = await c.ev(`(() => { const card = document.querySelector('[data-zone=warband] .card.compact'); const r = card.querySelector('.archbox').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 - 170), y: Math.round(r.top + r.height / 2 - 190), kind: card.querySelector('.kwfx') ? 'baked' : 'live' }; })()`);
      const dir = path.join(tmp, `${NAME[a]}-${v.label}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const frames = [];
      const h = (f) => { frames.push([f.metadata.timestamp, f.data]); c.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
      c.on('Page.screencastFrame', h);
      await c.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
      await sleep(secs * 1000);
      await c.send('Page.stopScreencast'); c.off('Page.screencastFrame', h);
      let list = '';
      frames.forEach(([t, d], i) => { const f = path.join(dir, `${String(i).padStart(5, '0')}.jpg`); fs.writeFileSync(f, Buffer.from(d, 'base64')); const dur = i + 1 < frames.length ? Math.max(0.001, frames[i + 1][0] - t) : 0.01; list += `file '${f.replace(/\\/g, '/')}'\nduration ${dur.toFixed(4)}\n`; });
      fs.writeFileSync(path.join(dir, 'list.txt'), list);
      const fps = frames.length / (frames[frames.length - 1][0] - frames[0][0]);
      (rates[NAME[a]] ||= {})[v.label] = `${fps.toFixed(0)}/s captured (${box.kind})`;
      // crop to the card, constant 100 pictures a second (the capture's ceiling), labelled
      ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', `crop=340:380:${box.x}:${box.y},fps=100,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='${v.label}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5`, '-t', String(secs - 0.5), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', path.join(tmp, `${NAME[a]}-${v.label}.mp4`)]);
      console.log(`${NAME[a]} / ${v.label}: ${frames.length} frames, ${fps.toFixed(1)} per second captured, ${box.kind}`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally { c.close(); server.close(); await sleep(2500); }
}
for (const a of auras) {
  const parts = variants.map((v) => path.join(tmp, `${NAME[a]}-${v.label}.mp4`)).filter((f) => fs.existsSync(f));
  if (parts.length < 2) continue;
  ff([...parts.flatMap((p) => ['-i', p]), '-filter_complex', `${parts.map((_, i) => `[${i}:v]`).join('')}hstack=inputs=${parts.length}[v]`, '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, `${NAME[a]}-side-by-side.mp4`)]);
  console.log(`-> ${path.join(OUT, `${NAME[a]}-side-by-side.mp4`)}`);
}
fs.writeFileSync(path.join(OUT, 'capture-rates.json'), JSON.stringify(rates, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
