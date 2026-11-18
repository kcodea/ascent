// Records the landing page's captures from the game's own dev server.
//   node apps/site/scripts/capture.mjs <slot> [<slot> ...]     (or "all")
// It starts the game dev server itself (no backend address, and the browser is blocked from anything but this
// machine), drives a fresh guest player to each moment, records the screen, then crops and encodes with ffmpeg into
// apps/site/public/captures/<slot>.{jpg,webm,mp4}. Nothing here ships: it is a dev tool.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { ROUTINES } from './captureRoutines.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.resolve(HERE, '../public/captures');
const RAW = process.env.CAPTURE_RAW || path.join(os.tmpdir(), 'ascent-site-captures');
const PORT = Number(process.env.CAPTURE_PORT || 5311);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEW = { width: 1920, height: 1080 };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  // No backend: an empty address makes the game run as an offline guest.
  process.env.VITE_SUPABASE_URL = process.env.CAPTURE_BACKEND || '';
  process.env.VITE_SUPABASE_ANON_KEY = process.env.CAPTURE_BACKEND_KEY || ''; // only career-chart sets it (a dead local address)
  const { createServer } = await import('vite');
  const server = await createServer({
    root: path.join(REPO, 'apps/web'),
    configFile: path.join(REPO, 'apps/web/vite.config.ts'),
    server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false },
    logLevel: 'warn',
  });
  await server.listen();
  return server;
}

const INIT = () => {
  try {
    localStorage.setItem('ascent.perf', '0');
    localStorage.setItem('ascent.tutorial.v1', JSON.stringify({ version: 1, courses: { 'learn-ascent': { courseId: 'learn-ascent', courseVersion: 1, status: 'skipped' } }, lessons: {}, hintsSeen: [] }));
    localStorage.setItem('ascent.ancientsPrompt.seen', '1');
    localStorage.setItem('ascent.lobbyRevealOn', 'off');
    if (!localStorage.getItem('ascent.playername')) localStorage.setItem('ascent.playername', 'Wayfarer');
  } catch { /* storage blocked: the page still loads */ }
  // Dev-only corner controls stay out of frame, and the pointer (which a screen recording does not include) is drawn.
  const boot = () => {
    const st = document.createElement('style');
    st.textContent = '.devmenu-btn, .version, .ph-devtools { visibility: hidden !important; } #cap-cursor { position: fixed; left: 0; top: 0; width: 44px; height: 44px; z-index: 2147483647; pointer-events: none; opacity: 0; will-change: transform; }';
    document.head.append(st);
    const c = document.createElement('img');
    c.id = 'cap-cursor';
    c.src = '/cursors/gauntlet_open.svg';
    c.decoding = 'sync';
    document.documentElement.append(c);
    window.addEventListener('mousemove', (e) => { c.style.opacity = '1'; c.style.transform = 'translate(' + (e.clientX - 6) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
};

/** A fresh guest player. `record` turns on the screen recording for this context. */
async function openPlayer(browser, slot, { record = true, query = '' } = {}) {
  const dir = path.join(RAW, slot);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: VIEW });
  await ctx.route((u) => !['localhost', '127.0.0.1'].includes(u.hostname), (r) => r.abort());
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'commit', timeout: 180000 });
  await page.waitForFunction(() => !!window.useGame && !document.querySelector('#bootsplash') && document.querySelectorAll('.ph-navhost .ph-navtab').length > 3, null, { timeout: 180000, polling: 250 });
  // Screen recording: the browser hands over a frame each time the picture changes; ffmpeg stitches them later.
  const frames = [];
  let n = 0;
  if (record) {
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', (f) => {
      const file = path.join(dir, `f${String(n++).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      frames.push({ file, t: Date.now() });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  }
  const p = {
    ctx, page, dir, errs, slot, frames, t0,
    /** Seconds since the recording began: use for the clip's start and end. */
    now: () => (Date.now() - t0) / 1000,
    shot: async (name) => { const file = path.join(dir, `${name}.png`); await page.screenshot({ path: file }); return file; },
    ev: (fn, arg) => page.evaluate(fn, arg),
  };
  return p;
}

function ff(args) {
  const r = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.error?.message}`);
}

/** Turn the saved frames into one constant-rate file ffmpeg can cut (each frame is held until the next one). */
function stitch(p) {
  const list = path.join(p.dir, 'frames.txt');
  const lines = [];
  p.frames.forEach((f, i) => {
    const next = p.frames[i + 1];
    lines.push(`file '${f.file.split(path.sep).join('/')}'`, `duration ${(((next ? next.t : f.t + 40) - f.t) / 1000).toFixed(3)}`);
  });
  // The first frame is not at t0: pad so clip times measured from t0 line up.
  const lead = p.frames.length ? (p.frames[0].t - p.t0) / 1000 : 0;
  fs.writeFileSync(list, lines.join('\n') + '\n');
  const raw = path.join(p.dir, 'raw.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `tpad=start_duration=${lead.toFixed(3)}:start_mode=clone,fps=30`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', raw]);
  return raw;
}

/** Cut [start, end] seconds, crop to {x,y,w,h} (source pixels), scale to at most 1280 wide, write jpg + webm + mp4. */
function encode(slot, raw, { start, end, crop, still, png, width = 1280, share }) {
  const c = crop ?? { x: 0, y: 0, w: VIEW.width, h: VIEW.height };
  const outW = Math.min(width, c.w) & ~1;
  const outH = Math.round((outW * c.h) / c.w) & ~1;
  const vf = `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${outW}:${outH}:flags=lanczos`;
  const cut = ['-ss', String(start), '-t', String(end - start), '-i', raw];
  const base = path.join(OUT, slot);
  // A still-only slot is cut from a screenshot, not from the recording.
  if (png) { ff(['-i', png, '-frames:v', '1', '-vf', vf, '-q:v', '5', `${base}.jpg`]); return; }
  ff(['-ss', String(still ?? start), '-i', raw, '-frames:v', '1', '-vf', vf, '-q:v', '5', `${base}.jpg`]);
  // The social share card (1200x630) is cut from the same moment, full frame.
  if (share) ff(['-ss', String(still ?? start), '-i', raw, '-frames:v', '1', '-vf', 'crop=1920:1008:0:36,scale=1200:630:flags=lanczos', '-q:v', '5', path.resolve(OUT, '../share.jpg')]);
  if (end <= start) return;
  ff([...cut, '-an', '-vf', `${vf},fps=30`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', `${base}.webm`]);
  ff([...cut, '-an', '-vf', `${vf},fps=30`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${base}.mp4`]);
}

async function main() {
  const asked = process.argv.slice(2);
  const slots = asked.includes('all') ? Object.keys(ROUTINES) : asked;
  if (!slots.length || slots.some((s) => !ROUTINES[s])) {
    console.error(`usage: capture.mjs <slot>...  slots: ${Object.keys(ROUTINES).join(', ')}, all`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--mute-audio', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  let failed = 0;
  for (const slot of slots) {
    const routine = ROUTINES[slot];
    let p;
    try {
      p = await openPlayer(browser, slot, { query: routine.query ?? '' });
      const cut = await routine.run(p);
      await p.ctx.close();
      const raw = stitch(p);
      if (cut && !process.env.CAPTURE_PROBE) encode(routine.out ?? slot, raw, cut);
      console.log('OK', slot, JSON.stringify(cut ?? {}), raw, p.errs.length ? `pageerrors: ${p.errs.join(' | ')}` : '');
    } catch (e) {
      failed++;
      console.log('FAIL', slot, e.message.slice(0, 400));
      try { await p?.shot('fail'); await p?.ctx.close(); } catch { /* already closed */ }
    }
  }
  await browser.close();
  await server.close();
  process.exit(failed ? 1 : 0);
}

main();
