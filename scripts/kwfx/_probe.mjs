import path from 'node:path'; import sharp from 'sharp';
import { launch, serve, sleep } from './lib.mjs';
const server = await serve(path.resolve('.kwperf/probe/site'), 5262);
const c = await launch({ cdpPort: 9671, width: 600, height: 400 });
const files = process.argv.slice(2);
try {
  for (const f of files) {
    await c.send('Page.navigate', { url: 'http://127.0.0.1:5262/one.html?' + f }); await sleep(2500);
    const clip = { x: 10, y: 10, width: 128, height: 32, scale: 1 }; const samples = []; const t0 = performance.now();
    while (performance.now() - t0 < 3000) { const a = performance.now(); const d = (await c.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })).data; samples.push([(a + performance.now()) / 2, d]); }
    const pts = [];
    for (const [t, d] of samples) { const raw = await sharp(Buffer.from(d, 'base64')).removeAlpha().raw().toBuffer(); let idx = 0; for (let k = 0; k < 8; k++) if (raw[(16 * 128 + k * 16 + 8) * 3] > 127) idx |= 1 << k; pts.push([t, idx]); }
    let wrap = 0; const u = [pts[0]]; for (let i = 1; i < pts.length; i++) { if (pts[i][1] < pts[i - 1][1] - 20) wrap += 240; u.push([pts[i][0], pts[i][1] + wrap]); }
    const fps = (u[u.length - 1][1] - u[0][1]) / ((u[u.length - 1][0] - u[0][0]) / 1000);
    // cadence: when does the compositor activate a tree with a new picture? (one image on the page)
    const ts = []; const h = (p) => { for (const ev of p.value) if (ev.name === 'ImageAnimationController::WillActivate') ts.push(ev.ts / 1000); };
    c.on('Tracing.dataCollected', h); const done = new Promise((r) => c.on('Tracing.tracingComplete', r));
    await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['cc', 'cc.debug', 'disabled-by-default-cc.debug'] } });
    await sleep(3000); await c.send('Tracing.end'); await done; c.off('Tracing.dataCollected', h);
    ts.sort((a, b) => a - b); const iv = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b); const q = (p) => (iv.length ? +iv[Math.floor(iv.length * p)].toFixed(2) : null);
    const hist = {}; for (const x of iv) { const k = Math.round(x / 4.1667); hist[k] = (hist[k] || 0) + 1; }
    console.log(JSON.stringify({ file: f, played: +fps.toFixed(1), firstIdx: pts.slice(0, 12).map((p) => p[1]).join(','), activationsPerS: +(ts.length / 3).toFixed(1), intervalMs: { p5: q(0.05), p50: q(0.5), p95: q(0.95) }, vsyncsPerPicture: hist }));
  }
} finally { c.close(); server.close(); }
process.exit(0);
