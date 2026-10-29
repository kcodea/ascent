import { launch, player, serveDist, sleep } from './lib.mjs';
import { step, clickSel } from './autopilot.mjs';
const srv = await serveDist('apps/web/dist-bench', 4500);
const URL_ = `http://127.0.0.1:4500/?versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
const b = await launch();
const A = await player(b, 'A', URL_); const B = await player(b, 'B', URL_);
await sleep(3000);
const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
await sleep(1500);
await clickSel(A, 'button:has-text("Start game")');
const memA = {}, memB = {}; const t0 = Date.now();
while (Date.now() - t0 < 6 * 60_000) {
  const sa = await step(A, memA, { thinkMs: 1200, endMs: 9000 });
  await step(B, memB, { thinkMs: 800, endMs: 9000 });
  if (sa.runMode === 'versus' && sa.runPhase === 'recruit' && sa.phase === 'shop' && sa.wave >= 2 && memA.acted === sa.wave && Date.now() - memA.shopAt[sa.wave] > 2500) {
    const r = await A.page.evaluate(async () => {
      const root = document.getElementById('root');
      const n = root.getElementsByTagName('*').length;
      const out = [];
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));
        const a = performance.now();
        const g = root.cloneNode(true); g.removeAttribute('id'); g.className = 'duosghost'; for (const x of g.querySelectorAll('[id]')) x.removeAttribute('id'); root.after(g);
        const b = performance.now();
        void document.body.offsetHeight;
        const c = performance.now();
        await new Promise((r) => requestAnimationFrame(() => r()));
        const d = performance.now();
        g.remove(); void document.body.offsetHeight;
        const e = performance.now();
        // A forced style+layout of the unchanged page (baseline).
        document.body.classList.toggle('qa-x'); void document.body.offsetHeight; document.body.classList.toggle('qa-x'); void document.body.offsetHeight;
        const f = performance.now();
        out.push({ clone: +(b - a).toFixed(1), styleLayout: +(c - b).toFixed(1), toNextFrame: +(d - c).toFixed(1), remove: +(e - d).toFixed(1), baselineRestyle: +(f - e).toFixed(1) });
      }
      return { elements: n, out };
    });
    console.log(JSON.stringify(r));
    break;
  }
  await sleep(200);
}
await b.close(); srv.close();
