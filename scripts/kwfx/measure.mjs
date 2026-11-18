#!/usr/bin/env node
// Keyword-aura cost: a bench build in a shop with 7 board + 7 hand minions, one keyword set at a time, idle.
// Reports per scene: compositor layers, running CSS animations, idle frame times and main-thread ms/s.
//
//   VITE_PERF_BENCH=1 npm run build:web
//   node scripts/kwfx/measure.mjs --dist apps/web/dist [--port 5252] [--reps 3] [--scenes none,R,W,V,RB,all] [--css "<rules>"] [--overlay <dir>] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { arg, launch, serve, toShop, setScene, layerCensus, idleSample, runningAnimations, sleep } from './lib.mjs';

const dist = path.resolve(arg('dist', 'apps/web/dist'));
const port = Number(arg('port', '5252'));
const reps = Number(arg('reps', '3'));
const css = arg('css', '');
const ALL = ['T', 'DS', 'V', 'W', 'R', 'C', 'RB', 'CR', 'EG'];
const SCENES = {
  none: { keywords: [] },
  R: { keywords: ['R'] }, W: { keywords: ['W'] }, V: { keywords: ['V'] }, RB: { keywords: ['RB'] },
  RWV: { keywords: ['R', 'W', 'V'] },
  mix2: { perCard: [['T', 'DS'], ['R', 'W'], ['V', 'DS'], ['RB', 'T'], ['W', 'C'], ['R', 'DS'], ['V', 'W']] },
  all: { keywords: ALL },
};
const want = arg('scenes', 'none,R,W,V,RB,mix2,all').split(',');

const server = await serve(dist, port, arg('overlay', '') ? path.resolve(arg('overlay')) : undefined);
const c = await launch({ cdpPort: Number(arg('cdp', '9552')) });
const rows = [];
try {
  await toShop(c, { url: `http://127.0.0.1:${port}/`, initJs: arg('init-js', '') });
  if (css) await c.ev(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`);
  for (const name of want) {
    const sc = SCENES[name]; if (!sc) continue;
    const seated = await setScene(c, sc);
    if (arg('scene-js', '')) await c.ev(arg('scene-js'));
    await sleep(1500);
    const layers = await layerCensus(c);
    const anims = await runningAnimations(c);
    const samples = [];
    for (let i = 0; i < reps; i++) samples.push(await idleSample(c, Number(arg('ms', '4000'))));
    const med = (k) => [...samples].map((s) => s[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    const row = { scene: name, seated, layers, anims, mean: med('mean'), p95: med('p95'), worst: Math.max(...samples.map((s) => s.worst)), over417: med('over417'), over625: med('over625'), taskMsPerS: med('taskMsPerS'), styleMsPerS: med('styleMsPerS'), means: samples.map((s) => s.mean) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally { c.close(); server.close(); }
if (arg('json', '')) fs.writeFileSync(arg('json'), JSON.stringify(rows, null, 1));
console.log('\n| scene | layers (drawing) | CSS animations | idle frame mean ms (each rep) | p95 | % > 6.25 ms | main thread ms/s (style) |\n|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.scene} | ${r.layers?.layers} (${r.layers?.drawing}) | ${r.anims} | ${r.mean} (${r.means.join(', ')}) | ${r.p95} | ${r.over625}% | ${r.taskMsPerS} (${r.styleMsPerS}) |`);
process.exit(0);
