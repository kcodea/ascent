// Versus flows on the LOCAL Worker only (npm run versus:cf:dev on :8797, DEV_AUTH): node scripts/ph-flows/versus.mjs [desk|phone]
// The host plays through the party home; the other seats are local test clients in their own contexts.
import { stateOf, step } from '../versus-qa/autopilot.mjs';
import { atHome, flow, home, launch, must, player, press, results, serve, shot, sleep, start, tab } from './lib.mjs';

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
const seatGuest = async (g, seat) => { const ok = await V(g, (v, s) => v.takeSeat(s), seat); must(ok, `seat ${seat} refused: ${JSON.stringify(await room(g))}`); };
/** Everyone seated plays on the autopilot until `until` says stop. */
const drive = async (ps, mems, until, capMs = 300000) => {
  const t0 = Date.now(); let last = []; let seen = '';
  while (Date.now() - t0 < capMs) {
    last = []; for (let i = 0; i < ps.length; i++) { last.push(await step(ps[i], mems[i], { thinkMs: 300, endMs: 900, heroThinkMs: 4500, watchMs: 300 })); if (last[i].heroCards && mems[i].picked) await press(ps[i], '^ *start game'); }
    const k = JSON.stringify(last.map((s) => [s.phase, s.round, s.runMode, s.runPhase, s.wave, s.screen, s.gate, s.heroCards, s.err]));
    if (k !== seen) { seen = k; console.log(Math.round((Date.now() - t0) / 1000), k); }
    if (await until(last)) return last;
    await sleep(250);
  }
  throw new Error('drive cap: ' + JSON.stringify(last.map((s) => [s.phase, s.round, s.runMode, s.runPhase, s.wave, s.screen, s.gate, s.heroCards, s.err])));
};
const concede = (g) => V(g, (x) => x.forfeitMatch());
for (const v of views) {
  for (const [label, subName, seats, foes] of [['1v1', '1v1', ['p2'], [0]], ['Group', 'Group', ['p2', 'p3'], [0, 1]], ['Duos', 'Duos', ['p2', 'p3', 'p4'], [1, 2]]]) {
    await run(`Versus ${label}: room, seats, spectate, game, rematch, Home`, v, async () => {
      const p = await player(b, URL_, v); await home(p); await sleep(1800);
      await tab(p, 'versus'); await sub(p, subName); await shot(p, `vs-${label}-home`);
      const ok = await p.page.evaluate(() => !document.querySelector('.ph-start')?.disabled); must(ok, 'START disabled: is the local Worker up? ' + await p.page.evaluate(() => document.querySelector('.ph-notes')?.innerText));
      await start(p); await sleep(2500); const r = await room(p); await shot(p, `vs-${label}-room`);
      must(r.id, 'no room ' + JSON.stringify(r)); must(await atHome(p), 'room left the home screen');
      const gs = []; for (let i = 0; i < seats.length; i++) { const g = await guest(r.id, `Claudebot${i + 2}`, 'spectator'); await seatGuest(g, seats[i]); gs.push(g); }
      const spec = await guest(r.id, 'Claudebot9', 'spectator');
      // A seat change: the last seat goes to the stands and back.
      await seatGuest(gs.at(-1), 'spectator'); await sleep(900); await seatGuest(gs.at(-1), seats.at(-1)); await sleep(1500);
      const r2 = await room(p); await shot(p, `vs-${label}-full`);
      must(r2.members.filter((m) => m !== 'spectator').length === seats.length + 1, 'seats ' + JSON.stringify(r2.members));
      // Reload in the room: back in the same room.
      await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(3000);
      const r3 = await room(p); must(r3.id === r.id, 'reload lost the room ' + JSON.stringify(r3)); must(await atHome(p), 'reload left the home');
      const ps = [p, ...gs]; const mems = ps.map(() => ({}));
      for (const round of [1, 2]) {
        await start(p); await sleep(1500);
        await drive(ps, mems, (ss) => ss.every((s) => s.phase === 'shop' && s.runMode === 'versus' && s.runPhase === 'recruit' && s.wave >= 1));
        await shot(p, `vs-${label}-shop${round}`);
        if (round === 1) {
          await drive(ps, mems, (ss) => ss.every((s) => s.phase === 'shop' && s.runPhase === 'recruit' && s.wave >= 2 && s.round === s.wave));
          if (label === '1v1') {
            await p.page.reload({ waitUntil: 'commit' }); await home(p).catch(() => undefined); await sleep(4000);
            const s = await stateOf(p); await shot(p, `vs-${label}-reload`); must(s.runMode === 'versus' && !s.showTitle, 'reload lost the game ' + JSON.stringify(s));
            mems[0] = {};
          }
        }
        for (const f of foes) await concede(gs[f]);
        await drive(ps, mems, (ss) => ss[0].phase === 'complete' || ss[0].phase === null || ss[0].screen === 'room');
        await sleep(2500); await shot(p, `vs-${label}-over${round}`);
        await drive(ps, mems, (ss) => ss[0].screen === 'room' && ss[0].runMode !== 'versus', 60000);
        await sleep(1500); await shot(p, `vs-${label}-back${round}`);
        await press(p, '^ *(close|done|continue)', '.vs-stats, .phk-dialog'); await p.page.keyboard.press('Escape'); await sleep(800);
        const back = await room(p); must(back.id === r.id, 'not in the same room ' + JSON.stringify(back)); must(await atHome(p), 'not the same home after the game');
        for (let i = 0; i < gs.length; i++) await drive([gs[i]], [mems[i + 1]], (ss) => ss[0].screen === 'room' || ss[0].runMode !== 'versus', 30000).catch(() => undefined);
        for (let i = 0; i < gs.length; i++) await seatGuest(gs[i], seats[i]).catch(() => undefined);
        for (let i = 1; i < mems.length; i++) mems[i] = {}; mems[0] = {};
        await sleep(1200);
      }
      for (const g of [...gs, spec]) await g.ctx.close();
      await V(p, (x) => x.leaveRoom()); await sleep(1500); must(await atHome(p), 'not home after leaving');
      must(!p.errs.length, p.errs[0]); await p.ctx.close(); return r2.members.join(',');
    });
  }
}
for (const v of views) {
  await run('Ranked Duos: party, join, warning, game, post-game, party, Home', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1800);
    await tab(p, 'ranked');
    await V(p, (x, n) => x.enterDuosParty(n), 'Claudebot1'); await sleep(1500); const r = await room(p); must(r.id, 'no party ' + JSON.stringify(r));
    await sub(p, 'Duos'); await shot(p, 'duos-party');
    const g = await player(b, URL_, 'desk', { name: 'Claudebot2' }); await home(g); await sleep(1200);
    await V(g, async (x, id) => { x.openVersus('duos'); await x.joinRoom(id, 'player'); }, r.id); await sleep(1800);
    must((await room(p)).members.length >= 2, 'partner not in the party ' + JSON.stringify(await room(p))); await shot(p, 'duos-full');
    // Locally the account only exists after the first Worker call (a real one is there at boot), so that call comes first.
    await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(1500);
    await V(p, async (x) => { await x.refreshRooms(); await x.resumeVersusMatch(true); }); await sleep(1500);
    must((await room(p)).id === r.id, 'reload lost the party ' + JSON.stringify(await room(p))); await tab(p, 'ranked'); await sub(p, 'Duos');
    await start(p); await sleep(500); await shot(p, 'duos-warning'); must(await press(p, '^ *yes', '.phk-dialog'), 'no ranked warning'); await sleep(1500);
    const ps = [p, g]; const mems = [{}, {}];
    await drive(ps, mems, (ss) => ss.every((s) => s.phase === 'shop' && s.runMode === 'versus' && s.runPhase === 'recruit'), 120000); await shot(p, 'duos-shop');
    await concede(p); await sleep(800);
    await drive(ps, mems, (ss) => ss[0].screen === 'room' && ss[0].runMode !== 'versus', 90000).catch((e) => { throw new Error('after concede: ' + e.message); });
    await sleep(2500); await shot(p, 'duos-post');
    const c = await press(p, '^ *continue'); await sleep(1500); await shot(p, 'duos-after');
    must(await atHome(p), 'not the party home after the game, pressed ' + c);
    // The teammate plays on, then goes out: the last one out reads the team's post-game and lands in the party.
    await concede(g); await drive([g], [mems[1]], (ss) => ss[0].screen === 'room' && ss[0].runMode !== 'versus', 90000); await sleep(3000); g.view = 'desk'; await shot(g, 'duos-post-mate');
    const post = await g.page.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => x.textContent.trim().slice(0, 16)).filter((t) => /continue|details/i.test(t)).join('|'));
    await press(g, '^ *continue'); await sleep(2500); must(await atHome(g), 'teammate not home after the post-game'); await shot(g, 'duos-after-mate');
    await g.ctx.close(); await V(p, (x) => x.leaveDuosParty()); await sleep(1500); must(await atHome(p), 'not Home after leaving');
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return `post-game: ${post || 'none'}`;
  });
}
await b.close(); srv.close();
console.table(results);
