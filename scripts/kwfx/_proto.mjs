import path from 'node:path';
import { launch, serve, sleep } from './lib.mjs';
const server = await serve(path.resolve('.kwperf/proto'), 5263);
for (const qs of process.argv.slice(2)) {
  const c = await launch({ cdpPort: 9673, width: 1920, height: 1080 });
  try {
    await c.send('Page.navigate', { url: 'http://127.0.0.1:5263/index.html?' + qs });
    if (!(await c.waitFor('window.__ready === true', 120000))) throw new Error('not ready');
    await sleep(3000);
    const threads = new Map(); const busy = new Map();
    const h = (p) => { for (const ev of p.value) { if (ev.name === 'thread_name') threads.set(ev.pid + ':' + ev.tid, ev.args.name); if (ev.ph === 'X' && ev.dur && (ev.name === 'RunTask' || ev.name === 'ThreadControllerImpl::RunTask')) busy.set(ev.pid + ':' + ev.tid, (busy.get(ev.pid + ':' + ev.tid) || 0) + ev.dur / 1000); } };
    c.on('Tracing.dataCollected', h); const done = new Promise((r) => c.on('Tracing.tracingComplete', r));
    await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', '__metadata'] } });
    const ms = 5000;
    const t = await c.ev(`new Promise((res) => { const out = []; let last = 0; const t0 = performance.now(); const tick = (now) => { if (last) out.push(now - last); last = now; if (now - t0 < ${ms}) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); })`);
    await c.send('Tracing.end'); await done;
    const s = [...t].sort((a, b) => a - b); const by = {};
    for (const [k, v] of busy) { const n = (threads.get(k) || '?').replace(/\d+$/, '').replace(/ThreadPool.*/, 'ThreadPool'); by[n] = +((by[n] || 0) + v / (ms / 1000)).toFixed(1); }
    console.log(qs, JSON.stringify({ mainFrameMean: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), over625: +(100 * t.filter((x) => x > 6.25).length / t.length).toFixed(1), worker: await c.ev('window.__stat'), busyMsPerS: Object.fromEntries(Object.entries(by).filter(([, v]) => v > 5).sort((a, b) => b[1] - a[1])) }));
  } finally { c.close(); await sleep(2500); }
}
server.close(); process.exit(0);
