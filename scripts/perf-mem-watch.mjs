#!/usr/bin/env node
/**
 * PERF MEM WATCH (perf degradation hunt, 2026-10-30; R-PERF-SHARED-TAIL-REVERB-01). Attach to a page a running
 * `perf:gauntlet` drives (its Chrome's CDP port = the gauntlet's --port + 1) and, every N ms, take a LIGHT Chrome
 * memory-infra dump and print the renderer's allocators (partition_alloc buffer / array_buffer, blink_gc, v8, webgl)
 * beside the game state (wave, phase, overlays, live FX plays, the falling gate's classes). A step in a bucket is then
 * pinned to a moment instead of a round. It also wraps the page's canvas / WebGL / storage / structuredClone / fetch
 * calls and prints big ones as they happen. Env: SAMPLE=1 adds the native allocation sampler's top stacks at each step
 * (addresses only, no symbols); PRESSURE=1 sends a critical memory-pressure signal at round 7's shop.
 *
 * Usage (two shells, or backgrounded together):
 *   npm run perf:gauntlet -- --only <dist> --round-probe --headless --from 8 --to 7 --port 4840
 *   node scripts/perf-mem-watch.mjs 4841 1000 > watch.log
 * Read-only: it never presses anything; every request the page makes still goes through the gauntlet's block list.
 */
// Attach to a running perf-gauntlet page (its Chrome CDP port) and take a light memory-infra dump every N s, logging the
// renderer's partition_alloc buckets beside the game state, so a step in `buffer` can be pinned to a moment.
const port = Number(process.argv[2]); const every = Number(process.argv[3] || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; for (let i = 0; i < 400 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url))?.webSocketDebuggerUrl; } catch {} if (!ws) await sleep(500); }
if (!ws) { console.log('no page'); process.exit(1); }
const s = new WebSocket(ws); await new Promise((r) => s.addEventListener('open', r));
let id = 0; const pend = new Map(); const h = new Map();
s.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } else if (x.method) for (const f of h.get(x.method) || []) f(x.params); });
s.addEventListener('close', () => process.exit(0));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })); });
const on = (m, f) => h.set(m, [...(h.get(m) || []), f]);
let events = []; let done = null; const pname = new Map();
on('Tracing.dataCollected', (p) => { for (const e of p.value) { if (e.ph === 'M' && e.name === 'process_name') pname.set(e.pid, e.args?.name); if (e.ph === 'v') events.push(e); } });
on('Tracing.tracingComplete', () => { done?.(); });
const mb = (a) => { const v = a?.attrs?.size?.value; return v ? Math.round(parseInt(v, 16) / 1048576) : 0; };

const HOOK = `(() => { if (window.__bw) return 'already';
  const log = []; window.__bw = log; const st = () => (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 6).map((l) => l.trim().replace(/^at /, '').replace(/https?:[^ )]*[/]/, '')).join(' < ');
  const big = (w, h) => w * h * 4 >= 64 * 1024;
  const rec = (kind, w, h, extra) => { if (big(w, h)) log.push([Math.round(performance.now()), kind, w + 'x' + h, Math.round(w * h * 4 / 1048576) + 'MB', extra || '', st()]); };
  const C2 = CanvasRenderingContext2D.prototype;
  const gid = C2.getImageData; C2.getImageData = function (x, y, w, h, ...a) { rec('getImageData', w, h); return gid.call(this, x, y, w, h, ...a); };
  const di = C2.drawImage; C2.drawImage = function (img, ...a) { const w = img.naturalWidth || img.videoWidth || img.width || 0, hh = img.naturalHeight || img.videoHeight || img.height || 0; rec('drawImage', w, hh, (img.currentSrc || img.src || img.constructor.name || '').toString().split('/').pop().slice(0, 40)); return di.call(this, img, ...a); };
  const tdu = HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL = function (...a) { rec('toDataURL', this.width, this.height); return tdu.apply(this, a); };
  const tb = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (...a) { rec('toBlob', this.width, this.height); return tb.apply(this, a); };
  const gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { rec('getContext:' + t, this.width, this.height); return gc.call(this, t, ...a); };
  for (const k of ['width', 'height']) { const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k); Object.defineProperty(HTMLCanvasElement.prototype, k, { configurable: true, get: d.get, set(v) { d.set.call(this, v); if (k === 'height') rec('canvasResize', this.width, v); } }); }
  if (window.createImageBitmap) { const cib = window.createImageBitmap; window.createImageBitmap = function (img, ...a) { rec('createImageBitmap', img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0); return cib.call(this, img, ...a); }; }
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!C) continue; const P = C.prototype;
    const t2 = P.texImage2D; P.texImage2D = function (...a) { const src = a[a.length - 1]; if (src && typeof src === 'object' && 'width' in src) rec('texImage2D', src.naturalWidth || src.width, src.naturalHeight || src.height, (src.currentSrc || src.src || src.constructor.name || '').toString().split('/').pop().slice(0, 40)); else if (a.length >= 9) rec('texImage2D(buf)', a[3], a[4]); return t2.apply(this, a); };
    const ts2 = P.texSubImage2D; P.texSubImage2D = function (...a) { const src = a[a.length - 1]; if (src && typeof src === 'object' && 'width' in src) rec('texSubImage2D', src.naturalWidth || src.width, src.naturalHeight || src.height, (src.currentSrc || src.src || src.constructor.name || '').toString().split('/').pop().slice(0, 40)); return ts2.apply(this, a); };
    const rp = P.readPixels; P.readPixels = function (x, y, w, h, ...r) { rec('readPixels', w, h); return rp.call(this, x, y, w, h, ...r); }; }
  let dn = 0, ds = 0; const odec = HTMLImageElement.prototype.decode; window.__decN = () => [dn, ds]; HTMLImageElement.prototype.decode = function () { dn++; if ('${process.env.STUB_DECODE || ''}' && this.complete && this.isConnected) { ds++; return Promise.resolve(); } return odec.call(this); };
  const si = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { const n = String(v).length; if (n > 200000) log.push([Math.round(performance.now()), 'localStorage.setItem', String(k), Math.round(n / 1024) + 'Kchars', '', st()]); return si.call(this, k, v); };
  const sc = window.structuredClone; window.structuredClone = function (v, o) { const t0 = performance.now(); const r = sc.call(this, v, o); const dt = performance.now() - t0; if (dt > 3) log.push([Math.round(t0), 'structuredClone', Math.round(dt) + 'ms', '', '', st()]); return r; };
  const ip = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { log.push([Math.round(performance.now()), 'idb.put', this.name, '', '', st()]); return ip.call(this, v, k); };
  const ff = window.fetch; window.fetch = function (u, i) { const b = i && i.body; if (b && (b.length || b.size || b.byteLength) > 200000) log.push([Math.round(performance.now()), 'fetch body', String(u).slice(0, 60), String(b.length || b.size || b.byteLength), '', st()]); return ff.call(this, u, i); };
  const OI = window.Image; return 'hooked'; })()`;

let hooked = false;
const ms = await send('Memory.startSampling', { samplingInterval: 262144, suppressRandomness: false }); console.log('sampling', JSON.stringify(ms.error || 'ok'));
let prevAgg = new Map();
const sampleDiff = async () => { const r = await send('Memory.getSamplingProfile'); const p = r.result?.profile; if (!p) { console.log('no profile', JSON.stringify(r.error || r).slice(0, 200)); return; } const agg = new Map(); for (const smp of p.samples) { const k = (smp.stack || []).slice(0, 14).join(' < '); agg.set(k, (agg.get(k) || 0) + smp.size); } const d = []; for (const [k, v] of agg) { const dv = v - (prevAgg.get(k) || 0); if (Math.abs(dv) > 4 * 1048576) d.push([dv, k]); } prevAgg = agg; d.sort((a, b) => b[0] - a[0]); for (const [dv, k] of d.slice(0, 6)) console.log('      SAMPLE ' + (dv / 1048576).toFixed(0) + 'MB ' + k.slice(0, 1400)); if (!globalThis.__modsShown) { globalThis.__modsShown = 1; console.log('      MODULES ' + JSON.stringify((p.modules || []).slice(0, 8).map((m) => [m.name, m.baseAddress]))); } };
let seen = 0;
const t0 = Date.now(); let prev = null;
for (;;) {
  if (!hooked) { const hr = (await send('Runtime.evaluate', { returnByValue: true, expression: 'window.__bench ? (' + HOOK + ') : null' })).result; if (hr?.exceptionDetails) console.log('hook error', JSON.stringify(hr.exceptionDetails).slice(0, 400)); else if (hr?.result?.value) { hooked = true; console.log('hook', hr.result.value); } }
  events = [];
  const st = await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['disabled-by-default-memory-infra', '__metadata'], memoryDumpConfig: { triggers: [] } } });
  if (st.error) { await sleep(every); continue; }
  await send('Tracing.requestMemoryDump', { deterministic: false, levelOfDetail: 'light' });
  const fin = new Promise((r) => { done = r; setTimeout(r, 30000); });
  await send('Tracing.end'); await fin;
  let row = null;
  for (const e of events) { if (!/Renderer/.test(pname.get(e.pid) || '')) continue; const al = e.args?.dumps?.allocators; if (!al) continue; const r = { buf: mb(al['partition_alloc/partitions/buffer']), ab: mb(al['partition_alloc/partitions/array_buffer']), gc: mb(al['blink_gc']), v8: mb(al['v8']), webgl: mb(al['webgl']), pa: mb(al['partition_alloc']) }; if (!row || r.pa > row.pa) row = r; }
  const g = (await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { try { const st = window.__bench.store.getState(); const r = st.run; const acts = (st.replayActions || []).slice(-4).map((a) => a.type || a.action?.type || '?').join(','); const ov = [...document.querySelectorAll('[class*=-ov],[role=dialog]')].filter((x) => x.getClientRects().length).map((x) => String(x.className).split(' ')[0]).slice(0,3).join(','); return 'w' + r.wave + ' ' + r.phase + ' tier' + r.tier + (r.runeforgeOffer ? ' RUNEFORGE' : '') + (r.discover ? ' DISCOVER' : '') + ' acts[' + acts + '] ov[' + ov + '] fx[' + (window.__bench.livePlays ? [...new Set(window.__bench.livePlays().map((p) => p.id))].slice(0, 6).join(',') : '') + '] wipe[' + ['.wipecurtain', '[class*=wipevista]', '.etbwrap'].map((q) => { const e = document.querySelector(q); return e ? String(e.className).split(' ').slice(0, 3).join('.') : '-'; }).join('|') + '] anims ' + document.getAnimations().length + ' imgs ' + document.images.length + ' dec ' + (window.__decN ? window.__decN().join('/') : '') + ' canv ' + document.querySelectorAll('canvas').length; } catch (e) { return 'n/a'; } })()` })).result?.result?.value;
  if (row) {
    const d = prev ? row.buf - prev.buf : 0;
    console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s buf ${String(row.buf).padStart(5)}${Math.abs(d) >= 5 ? ` (${d > 0 ? '+' : ''}${d} <<<)` : ''} ab ${row.ab} gc ${row.gc} v8 ${row.v8} webgl ${row.webgl} | ${g}`);
    if (Math.abs(d) >= 40 && process.env.SAMPLE) await sampleDiff();
    if (process.env.PRESSURE && !globalThis.__pressed && /^w7 recruit/.test(g || '')) { globalThis.__pressed = 1; await send('Runtime.evaluate', { expression: 'window.__bench.store && 0' }); const pr = await send('Memory.simulatePressureNotification', { level: 'critical' }); console.log('      PRESSURE critical sent', JSON.stringify(pr.error || 'ok')); }
    prev = row;
    const nl = (await send('Runtime.evaluate', { returnByValue: true, expression: `window.__bw ? window.__bw.slice(${seen}) : []` })).result?.result?.value || [];
    seen += nl.length;
    const agg = new Map(); for (const e of nl) { const k = e[1] + ' ' + e[2] + ' ' + e[4] + ' @ ' + e[5]; agg.set(k, (agg.get(k) || 0) + 1); }
    for (const [k, n] of agg) console.log(`        ${n}x ${k.slice(0, 260)}`);
  }
  await sleep(every);
}
