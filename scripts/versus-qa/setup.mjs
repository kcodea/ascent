import { launch, player, serveDist, sleep } from './lib.mjs';
import { step, clickSel } from './autopilot.mjs';
/** A Ranked Duos party of two real browsers on the local Cloudflare stack, started. */
export async function rankedDuos({ dist = 'apps/web/dist-bench', port = 4501, phoneA = false } = {}) {
  const srv = await serveDist(dist, port);
  const URL_ = `http://127.0.0.1:${port}/?versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
  const b = await launch();
  const A = await player(b, 'A', URL_, phoneA ? { viewport: { width: 844, height: 390 }, mobile: true } : {});
  const B = await player(b, 'B', URL_);
  for (const [p, n] of [[A, 'Ann'], [B, 'Bob']]) await p.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), n);
  await sleep(2500);
  const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
  await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
  await sleep(1500);
  await clickSel(A, 'button:has-text("Start game")');
  const mem = { A: {}, B: {} };
  const drive = async (until, { capMs = 8 * 60_000, optsA = { thinkMs: 1200, endMs: 9000 }, optsB = { thinkMs: 800, endMs: 9000 } } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < capMs) {
      const sa = await step(A, mem.A, optsA);
      const sb = await step(B, mem.B, optsB);
      if (await until(sa, sb)) return { sa, sb };
      await sleep(200);
    }
    throw new Error('drive: cap reached');
  };
  return { b, srv, A, B, mem, drive, close: async () => { await b.close(); srv.close(); } };
}
/** A's shop of wave >= w is open, A has shopped, and its teammate has had a moment. */
export const shopReady = (mem, w) => (sa) => sa.runMode === 'versus' && sa.runPhase === 'recruit' && sa.phase === 'shop' && sa.wave >= w && sa.round === sa.wave && mem.A.acted === sa.wave && Date.now() - mem.A.shopAt[sa.wave] > 2500;
