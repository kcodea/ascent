// RANKED DUOS teammate-view swap measurement (owner 2026-10-29: "toggling yours and teammates screen ... can be kinda
// janky"). Two real browsers on the local Cloudflare stack, A clicks the teammate portrait and back each shop.
//   node scripts/versus-qa/duos-swap.mjs [--phone] [--rounds 3] [--dist apps/web/dist-bench]
import fs from 'node:fs';
import path from 'node:path';
import { launch, player, serveDist, shot, sleep, installRecorder, recStart, recStop, QA_OUT } from './lib.mjs';
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
    for (let k = 0; k < 2; k++) {
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
      console.log(`r${sa.wave}#${k} in: p50 ${into.p50} p95 ${into.p95} max ${into.max} >16:${into.over16} >33:${into.over33} long ${JSON.stringify(into.long)} +${into.added}/-${into.removed} ev ${JSON.stringify(into.events)}`);
      console.log(`r${sa.wave}#${k} out: p50 ${back.p50} p95 ${back.p95} max ${back.max} >16:${back.over16} >33:${back.over33} long ${JSON.stringify(back.long)} +${back.added}/-${back.removed} ev ${JSON.stringify(back.events)}`);
    }
  }
  if (sa.wave > ROUNDS || sa.phase === 'complete') break;
  await sleep(200);
}
fs.writeFileSync(path.join(QA_OUT, `swap-${TAG}.json`), JSON.stringify(results, null, 1));
console.log('A log', A.log.slice(0, 15));
console.log('B log', B.log.slice(0, 15));
await b.close(); srv.close();
