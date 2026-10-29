import { sleep } from './lib.mjs';
import { clickSel } from './autopilot.mjs';
import { rankedDuos, shopReady } from './setup.mjs';
const m = await rankedDuos({ port: 4502 });
await m.drive(shopReady(m.mem, 3));
const sample = () => m.A.page.evaluate(async () => {
  const out = []; const t0 = performance.now();
  await new Promise((res) => { const f = () => { out.push([Math.round(performance.now() - t0), window.__bench.livePlays().map((p) => p.id + ':' + p.particles + (p.filters ? 'f' + p.filters : '')).join(',')]); if (performance.now() - t0 < 700) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const dedup = []; for (const x of out) if (!dedup.length || dedup[dedup.length - 1][1] !== x[1]) dedup.push(x); return dedup;
});
const pIn = sample(); await clickSel(m.A, '.duosdock-hold[role="button"]'); console.log('IN', JSON.stringify(await pIn));
await sleep(800);
const pOut = sample(); await clickSel(m.A, '.duosdock[role="button"]'); console.log('OUT', JSON.stringify(await pOut));
await m.close();
