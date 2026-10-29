// RANKED DUOS teammate-view swap measurement (owner 2026-10-29: "toggling yours and teammates screen ... can be kinda
// janky"). Two real browsers on the local Cloudflare stack, A clicks the teammate portrait and back each shop.
//   node scripts/versus-qa/duos-swap.mjs [--phone] [--rounds 3] [--dist apps/web/dist-bench]
import fs from 'node:fs';
import path from 'node:path';
import { launch, player, serveDist, shot, sleep, installRecorder, recStart, recStop, profileAround, QA_OUT } from './lib.mjs';
const PROFILE = process.argv.includes('--profile');
import { step, clickSel, stateOf } from './autopilot.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const PHONE = process.argv.includes('--phone');
const ROUNDS = Number(arg('rounds', '3'));
const DIST = arg('dist', 'apps/web/dist-bench');
const PORT = Number(arg('port', '4497'));
const TAG = arg('tag', PHONE ? 'phone' : 'desk');
const srv = await serveDist(DIST, PORT);
const URL_ = `http://127.0.0.1:${PORT}/?versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
const b = await launch();
const A = await player(b, 'A', URL_, PHONE ? { viewport: { width: 844, height: 390 }, mobile: true } : {});
const B = await player(b, 'B', URL_);
for (const [p, n] of [[A, 'Ann'], [B, 'Bob']]) await p.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), n);
let cdp = null;
if (PHONE) { cdp = await A.ctx.newCDPSession(A.page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
await sleep(3000);
const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
await sleep(1500);
await clickSel(A, 'button:has-text("Start game")');
const memA = {}, memB = {};
const results = [];
const t0 = Date.now();
await installRecorder(A);
let swapped = new Set();
while (Date.now() - t0 < 15 * 60_000) {
  const sa = await step(A, memA, { thinkMs: 1200, endMs: 9000 });
  const sb = await step(B, memB, { thinkMs: 800, endMs: 9000 });
  // The swap: once A has shopped and B has had a moment, A views B and comes back (twice per round).
  if (sa.runMode === 'versus' && sa.runPhase === 'recruit' && sa.phase === 'shop' && sa.round === sa.wave && memA.acted === sa.wave && !swapped.has(sa.wave) && Date.now() - memA.shopAt[sa.wave] > 2500) {
    swapped.add(sa.wave);
    if (PROFILE) {
      const pin = await profileAround(A, () => clickSel(A, '.duosdock-hold[role="button"]'));
      await sleep(800);
      const pout = await profileAround(A, () => clickSel(A, '.duosdock[role="button"]'));
      await sleep(800);
      fs.writeFileSync(path.join(QA_OUT, `prof-${TAG}-r${sa.wave}.json`), JSON.stringify({ pin, pout }, null, 1));
      console.log('profile r' + sa.wave + ' written');

    }
    for (let k = 0; k < (PROFILE ? 0 : 2); k++) {
      await sleep(400);
      await recStart(A);
      const okIn = await clickSel(A, '.duosdock-hold[role="button"]');
      await sleep(1200);
      const into = await recStop(A);
      const sIn = await stateOf(A);
      await shot(A, `${TAG}-r${sa.wave}-${k}-teammate`);
      await recStart(A);
      const okOut = await clickSel(A, '.duosdock[role="button"]');
      await sleep(1200);
      const back = await recStop(A);
      const sOut = await stateOf(A);
      results.push({ round: sa.wave, k, okIn, okOut, viewing: sIn.teammate, back: !sOut.teammate, into, out: back });
      const line = (x) => `p50 ${x.p50} p95 ${x.p95} max ${x.max} >16:${x.over16} >33:${x.over33} long ${JSON.stringify(x.long)} click ${JSON.stringify(x.events.filter((e) => e.n === 'click').map((e) => [e.proc, e.dur]))}`;
      console.log(`r${sa.wave}#${k} in (${sIn.teammate ? 'viewing' : 'NOT viewing'}): ${line(into)}`);
      console.log(`r${sa.wave}#${k} out (${sOut.teammate ? 'STILL viewing' : 'back'}): ${line(back)}`);
    }
  }
  if (sa.wave > ROUNDS || sa.phase === 'complete') break;
  await sleep(200);
}
console.log('END state A', JSON.stringify(await stateOf(A)), 'B', JSON.stringify(await stateOf(B)));
fs.writeFileSync(path.join(QA_OUT, `swap-${TAG}.json`), JSON.stringify(results, null, 1));
const sum = (k) => { const xs = results.map((r) => r[k]); return { maxP: Math.max(...xs.map((x) => x.max)), over33: xs.reduce((a, x) => a + x.over33, 0), over16: xs.reduce((a, x) => a + x.over16, 0), clickMs: xs.map((x) => x.events.find((e) => e.n === 'click')?.proc ?? null) }; };
if (results.length) console.log('SUMMARY in', JSON.stringify(sum('into')), 'out', JSON.stringify(sum('out')));
console.log('A log', A.log.slice(0, 15));
console.log('B log', B.log.slice(0, 15));
await b.close(); srv.close();
