#!/usr/bin/env node
// Keyword-aura cost IN A FIGHT: seven board minions that each carry Rise, Flurry, Execute and Rebirth, End Turn, and
// the fight itself traced: frame intervals (rAF), and the main thread's Layerize / style / paint time from a trace.
//
//   node scripts/kwfx/measure-combat.mjs --dist apps/web/dist [--port 5252] [--reps 3] [--kw R,W,V,RB] [--ms 9000]
import path from 'node:path';
import { arg, launch, serve, toShop, toCombat, layerCensus, runningAnimations, sleep } from './lib.mjs';

const dist = path.resolve(arg('dist', 'apps/web/dist'));
const port = Number(arg('port', '5252'));
const reps = Number(arg('reps', '3'));
const ms = Number(arg('ms', '9000'));
const kw = arg('kw', 'R,W,V,RB').split(',').filter(Boolean);
const NAMES = ['Layerize', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Commit', 'FunctionCall', 'RunTask'];
const rows = [];
for (let rep = 0; rep < reps; rep++) {
  const server = await serve(dist, port);
  const c = await launch({ cdpPort: Number(arg('cdp', '9555')) });
  try {
    await toShop(c, { url: `http://127.0.0.1:${port}/` });
    const sums = Object.fromEntries(NAMES.map((n) => [n, 0]));
    c.on('Tracing.dataCollected', (p) => { for (const e of p.value) if (e.ph === 'X' && e.dur && sums[e.name] !== undefined) sums[e.name] += e.dur / 1000; });
    if (!(await toCombat(c, { keywords: kw }))) throw new Error('the fight never started');
    await sleep(600);
    const layers = await layerCensus(c); const anims = await runningAnimations(c);
    const done = new Promise((r) => c.on('Tracing.tracingComplete', r));
    await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'toplevel', '__metadata'] } });
    const t = await c.ev(`new Promise((res) => { const out = []; let last = 0; const t0 = performance.now(); const tick = (now) => { if (last) out.push(now - last); last = now; if (now - t0 < ${ms}) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); })`);
    await c.send('Tracing.end'); await Promise.race([done, sleep(20000)]);
    const s = [...t].sort((a, b) => a - b); const n = s.length || 1;
    const row = { rep, phaseAtEnd: await c.ev(`window.__bench.store.getState().run.phase + (document.querySelector('.etbwrap.ready') ? ' (fight over)' : '')`), units: await c.ev(`document.querySelectorAll('.unit .card.compact').length`), aurasOffUnits: await c.ev(`[...document.querySelectorAll('.kwfx, .reborn, .flurry, .execute, .rebirth-crown')].filter((e) => !e.closest('.unit')).length`), layers: layers?.layers, anims, frames: n, mean: +(t.reduce((a, b) => a + b, 0) / n).toFixed(2), p95: +s[Math.floor(n * 0.95)].toFixed(2), worst: +s[n - 1].toFixed(1),
      over417: +(100 * t.filter((x) => x > 4.17 * 1.25).length / n).toFixed(1), over625: +(100 * t.filter((x) => x > 6.25).length / n).toFixed(1),
      layerizeMsPerS: +(sums.Layerize / (ms / 1000)).toFixed(1), styleMsPerS: +(sums.UpdateLayoutTree / (ms / 1000)).toFixed(1), prePaintMsPerS: +(sums.PrePaint / (ms / 1000)).toFixed(1), paintMsPerS: +(sums.Paint / (ms / 1000)).toFixed(1), commitMsPerS: +(sums.Commit / (ms / 1000)).toFixed(1) };
    rows.push(row); console.log(JSON.stringify(row));
  } finally { c.close(); server.close(); await sleep(2500); }
}
console.log('\n| rep | unit cards | layers | CSS animations | frame mean ms | p95 | worst | % over 5.2 ms | % over 6.25 ms | Layerize ms/s | style ms/s | pre-paint ms/s | paint ms/s |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.rep + 1} | ${r.units} | ${r.layers} | ${r.anims} | ${r.mean} | ${r.p95} | ${r.worst} | ${r.over417}% | ${r.over625}% | ${r.layerizeMsPerS} | ${r.styleMsPerS} | ${r.prePaintMsPerS} | ${r.paintMsPerS} |`);
process.exit(0);
