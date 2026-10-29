import { shot } from './lib.mjs';
import { rankedDuos, shopReady } from './setup.mjs';
const m = await rankedDuos({ dist: 'apps/web/dist-bench-vt', port: 4514, phoneA: true });
await m.drive(shopReady(m.mem, 1));
await shot(m.A, 'phone-dock-before');
const info = await m.A.page.evaluate(() => {
  const el = document.querySelector('.duosdock-hold[role="button"]');
  const r = el?.getBoundingClientRect();
  if (!r) return { none: true, docks: [...document.querySelectorAll('.duosdock')].map((d) => d.className) };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { rect: [r.left, r.top, r.width, r.height].map(Math.round), vw: innerWidth, vh: innerHeight, hit: hit?.className, hitTag: hit?.tagName, hitParent: hit?.parentElement?.className };
});
console.log(JSON.stringify(info));
await m.close();
