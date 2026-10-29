// The swap, traced: which main-thread tasks run long, and what they spend it on (style / layout / script / paint).
import { launch, player, serveDist, sleep, traceAround } from './lib.mjs';
import { step, clickSel } from './autopilot.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const DIST = arg('dist', 'apps/web/dist-bench'); const PORT = Number(arg('port', '4499'));
const srv = await serveDist(DIST, PORT);
const URL_ = `http://127.0.0.1:${PORT}/?versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
const b = await launch();
const A = await player(b, 'A', URL_); const B = await player(b, 'B', URL_);
await sleep(3000);
const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
await sleep(1500);
await clickSel(A, 'button:has-text("Start game")');
const memA = {}, memB = {}; const t0 = Date.now(); const done = new Set();
while (Date.now() - t0 < 10 * 60_000) {
  const sa = await step(A, memA, { thinkMs: 1200, endMs: 9000 });
  await step(B, memB, { thinkMs: 800, endMs: 9000 });
  if (sa.runMode === 'versus' && sa.runPhase === 'recruit' && sa.phase === 'shop' && sa.wave >= Number(arg('round', '3')) && memA.acted === sa.wave && !done.has(sa.wave) && Date.now() - memA.shopAt[sa.wave] > 2500) {
    done.add(sa.wave);
    const tin = await traceAround(b, A, () => clickSel(A, '.duosdock-hold[role="button"]'));
    await sleep(600);
    const tout = await traceAround(b, A, () => clickSel(A, '.duosdock[role="button"]'));
    console.log('IN tasks >8ms', JSON.stringify(tin, null, 0));
    console.log('OUT tasks >8ms', JSON.stringify(tout, null, 0));
    break;
  }
  await sleep(200);
}
await b.close(); srv.close();
