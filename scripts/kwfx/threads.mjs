// Where the work goes, beyond the main thread: per-thread busy time and image decode work from a trace, and the
// Chrome processes' memory. Used by scripts/kwfx/measure.mjs --threads.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sleep } from './lib.mjs';

/** Working-set MB of this Chrome's processes by type (renderer, gpu-process, ...), found by its throwaway profile
 *  directory. Windows only (PowerShell CIM); returns null elsewhere. Coarse, but it is the machine's own number. */
export function processMemory(c) {
  if (process.platform !== 'win32' || !c.profile) return null;
  try {
    const tag = path.basename(c.profile);
    const ps = `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match '${tag}' } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }; "$t " + [int]($_.WorkingSetSize / 1MB) }`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    const by = {};
    for (const line of out.split('\n')) { const m = /^([a-z-]+) (\d+)\s*$/.exec(line.trim()); if (m) by[m[1]] = (by[m[1]] || 0) + Number(m[2]); }
    return by;
  } catch { return null; }
}

/** Trace `ms` of the page: per thread name, busy ms per second (top-level tasks) and image decode + upload ms per
 *  second (the animated pictures' frames are decoded off the main thread; this is where). */
export async function threadWork(c, ms = 2500) {
  const threads = new Map(); const busy = new Map(); const dec = new Map(); let decodes = 0;
  const h = (p) => {
    for (const ev of p.value) {
      const k = `${ev.pid}:${ev.tid}`;
      if (ev.name === 'thread_name') threads.set(k, ev.args.name);
      if (ev.ph !== 'X' || !ev.dur) continue;
      if (ev.name === 'RunTask' || ev.name === 'ThreadControllerImpl::RunTask' || ev.name === 'ThreadPool_RunTask') busy.set(k, (busy.get(k) || 0) + ev.dur / 1000);
      if (/ImageDecodeTask|GpuImageDecodeCache::DecodeImage|ImageUploadTask|GpuImageDecodeCache::UploadImage/.test(ev.name)) { dec.set(k, (dec.get(k) || 0) + ev.dur / 1000); if (/DecodeImage$/.test(ev.name)) decodes++; }
    }
  };
  let fin; const done = new Promise((r) => { fin = r; });
  c.on('Tracing.dataCollected', h); c.on('Tracing.tracingComplete', fin);
  // The previous trace can still be closing after its tracingComplete ("Tracing has already been started"): retry.
  for (let i = 0; ; i++) {
    try { await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', '__metadata', 'cc'] } }); break; }
    catch (e) { if (i >= 20 || !/already been started/.test(String(e))) throw e; await sleep(500); }
  }
  await sleep(ms); await c.send('Tracing.end'); await Promise.race([done, sleep(180000)]); c.off('Tracing.dataCollected', h); c.off('Tracing.tracingComplete', fin);
  const fold = (m) => {
    const by = {};
    for (const [k, v] of m) { const n = (threads.get(k) || '?').replace(/\/?\d+$/, '').replace(/ThreadPool.*/, 'ThreadPool worker'); by[n] = +((by[n] || 0) + v / (ms / 1000)).toFixed(1); }
    return Object.fromEntries(Object.entries(by).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]));
  };
  return { busyMsPerS: fold(busy), imageDecodeMsPerS: fold(dec), decodesPerS: +(decodes / (ms / 1000)).toFixed(0) };
}
