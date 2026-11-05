// Versus flows on the LOCAL Worker only (npm run versus:cf:dev on :8797, DEV_AUTH): node scripts/ph-flows/versus.mjs [desk|phone]
// The host plays through the party home; the other seats are local test clients in their own contexts.
import { atHome, flow, home, launch, must, player, press, results, serve, shot, sleep, st, start, tab } from './lib.mjs';

const PORT = 4612;
const URL_ = `http://127.0.0.1:${PORT}/?partyhome=1&partydemo=0&versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
const srv = await serve('apps/web/dist-flows', PORT);
const b = await launch();
const views = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['desk', 'phone'];
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : /./;
const run = (n, v, fn) => (only.test(n) ? flow(n, v, fn) : undefined);
const V = (p, fn, arg) => p.page.evaluate(async ([src, a]) => { const v = await window.__bench.versus(); return (0, eval)(`(${src})`)(v, a); }, [fn.toString(), arg]);
const room = (p) => V(p, (v) => { const s = v.useVersus.getState(); return { id: s.room?.id ?? null, status: s.room?.status ?? null, members: (s.room?.members ?? []).map((m) => m.role), err: s.error, phase: s.match?.phase ?? null }; });
const sub = async (p, name) => {
  if (p.view === 'phone') { await p.page.evaluate(() => [...document.querySelectorAll('.ph-side-r .phk-btn')][0]?.click()); await sleep(400); }
  await p.page.evaluate((n) => [...document.querySelectorAll('.ph-submode .phk-segbtn')].find((x) => x.textContent.trim() === n)?.click(), name); await sleep(300);
  if (p.view === 'phone') { await p.page.evaluate(() => document.querySelector('.ph-fclose')?.click()); await sleep(300); }
};
const guest = async (id, name, seat) => {
  const g = await player(b, URL_, 'desk', { name }); await home(g); await sleep(1200);
  await V(g, async (v, a) => { v.openVersus('versus'); await v.joinRoom(a.id, a.seat); }, { id, seat });
  await sleep(1200); return g;
};
for (const v of views) {
  for (const [label, subName, seats] of [['1v1', '1v1', ['p2']], ['Group', 'Group', ['p2', 'p3']], ['Duos', 'Duos', ['p2', 'p3', 'p4']]]) {
    await run(`Versus ${label}: room, join, spectate, seat, leave, Home`, v, async () => {
      const p = await player(b, URL_, v); await home(p); await sleep(1800);
      await tab(p, 'versus'); await sub(p, subName); await shot(p, `vs-${label}-home`);
      const ok = await p.page.evaluate(() => !document.querySelector('.ph-start')?.disabled); must(ok, 'START disabled: is the local Worker up? ' + await p.page.evaluate(() => document.querySelector('.ph-notes')?.innerText));
      await start(p); await sleep(2500); const r = await room(p); await shot(p, `vs-${label}-room`);
      must(r.id, 'no room ' + JSON.stringify(r)); must(await atHome(p), 'room left the home screen');
      const gs = []; for (let i = 0; i < seats.length; i++) gs.push(await guest(r.id, `Claudebot${i + 2}`, 'player'));
      const spec = await guest(r.id, 'Claudebot9', 'spectator');
      await sleep(1500); const r2 = await room(p); await shot(p, `vs-${label}-full`);
      must(r2.members.length >= seats.length + 2, 'members ' + JSON.stringify(r2.members));
      for (const g of [...gs, spec]) await g.ctx.close();
      await V(p, (x) => x.leaveRoom()); await sleep(1500); must(await atHome(p), 'not home after leaving');
      must(!p.errs.length, p.errs[0]); await p.ctx.close(); return r2.members.join(',');
    });
  }
}
await b.close(); srv.close();
console.table(results);
