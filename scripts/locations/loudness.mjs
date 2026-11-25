// How loud each clip is: gated K-weighted loudness (BS.1770, LUFS) and peak, quietest first. Sounds are matched by this, never by ear alone.
//   node scripts/locations/loudness.mjs [file or folder...]      (default: the location sounds)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const args = process.argv.slice(2);
const files = (args.length ? args : ['apps/web/public/locations/sfx']).flatMap((f) => (fs.statSync(f).isDirectory() ? fs.readdirSync(f).map((n) => `${f}/${n}`) : [f])).filter((f) => /\.(mp3|ogg|wav)$/.test(f));
const b = await chromium.launch({ headless: true, channel: 'chrome' });
const p = await b.newPage();
await p.goto('about:blank');
const out = [];
for (const f of files) {
  out.push({ f, ...(await p.evaluate(async (b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const a = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(raw.buffer);
    const ctx = new OfflineAudioContext(a.numberOfChannels, Math.ceil(a.duration * 48000), 48000);
    const s = ctx.createBufferSource(); s.buffer = a;
    const shelf = new IIRFilterNode(ctx, { feedforward: [1.53512485958697, -2.69169618940638, 1.19839281085285], feedback: [1, -1.69065929318241, 0.73248077421585] });
    const high = new IIRFilterNode(ctx, { feedforward: [1, -2, 1], feedback: [1, -1.99004745483398, 0.99007225036621] });
    s.connect(shelf).connect(high).connect(ctx.destination); s.start();
    const k = await ctx.startRendering();
    let peak = 0; for (let c = 0; c < a.numberOfChannels; c++) for (const v of a.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    const n = 19200, hop = 4800, L = [], ch = [...Array(k.numberOfChannels)].map((_, i) => k.getChannelData(i));
    for (let i = 0; i + n <= k.length; i += hop) { let e = 0; for (const d of ch) { let q = 0; for (let j = i; j < i + n; j++) q += d[j] * d[j]; e += q / n; } L.push(ch.length === 1 ? e * 2 : e); }
    const db = (e) => -0.691 + 10 * Math.log10(e + 1e-12), mean = (x) => x.reduce((q, y) => q + y, 0) / Math.max(1, x.length);
    const loud = L.filter((e) => db(e) > -70), m = mean(loud);
    return { lufs: db(mean(loud.filter((e) => db(e) > db(m) - 10))), peak, dur: a.duration };
  }, fs.readFileSync(f).toString('base64'))) });
}
for (const o of out.sort((x, y) => x.lufs - y.lufs)) console.log(o.f.split('/').pop().padEnd(30), o.lufs.toFixed(1).padStart(6), 'LUFS  peak', o.peak.toFixed(2), ` ${o.dur.toFixed(1)}s`);
await b.close();
