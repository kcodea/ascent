// Solo flows: node scripts/ph-flows/solo.mjs [desk|phone] [filter]
import { atHome, flow, home, inGame, launch, must, pickHero, player, playOut, press, results, serve, shot, sleep, st, start, tab } from './lib.mjs';

const PORT = 4611;
const URL_ = `http://127.0.0.1:${PORT}/?partyhome=1&partydemo=0`;
const srv = await serve('apps/web/dist-flows', PORT);
const b = await launch();
const views = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['desk', 'phone'];
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : /./;
const run = (n, v, fn) => (only.test(n) ? flow(n, v, fn) : undefined);
const endToHome = async (p, tag) => {
  await sleep(3500); await shot(p, tag + '-end');
  must((await st(p)).end, 'no end screen');
  const btns = await p.page.evaluate(() => [...document.querySelectorAll('.endscreen button')].map((x) => x.textContent.trim().slice(0, 20)));
  const hit = await press(p, 'main menu|home|menu|back|^ *continue', '.endscreen'); await sleep(2500); await shot(p, tag + '-after');
  must(await atHome(p), `not home after end; pressed ${hit} of ${btns.join('|')}`);
  return hit;
};
for (const v of views) {
  await run('Practice: new game, results, Home', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    await p.page.evaluate(() => window.__bench.store.getState().setPracticeDraft({ health: 'normal', timeMult: 0 }));
    await tab(p, 'practice'); await start(p); await pickHero(p); await inGame(p);
    await sleep(4000); must((await st(p)).mode === 'practice', 'not in practice');
    const end = await playOut(p); const hit = await endToHome(p, 'practice');
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return `to wave ${end.wave}, ${hit}`;
  });
  await run('Saved game: Continue, reload, Replace', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    await tab(p, 'practice'); await start(p); await pickHero(p); await inGame(p); await sleep(5000);
    await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(1500);
    must((await st(p)).saved, 'no saved game after reload');
    const cont = await press(p, 'continue'); await sleep(3000); let s = await st(p);
    must(!s.title && s.mode === 'practice', 'Continue did not resume ' + cont);
    await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(1500);
    await tab(p, 'practice'); await start(p); await shot(p, 'replace-dialog');
    const rep = await press(p, 'start new', '.phk-dialog'); must(rep, 'no replace dialog'); await sleep(800);
    await p.page.waitForSelector('.herocard', { timeout: 20000 });
    must(!p.errs.length, p.errs[0]); await p.ctx.close();
  });
  await run('Gauntlet: stage, finish, Home', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    await tab(p, 'gauntlet'); await shot(p, 'gauntlet-home'); await start(p); await sleep(1500); await pickHero(p).catch(() => undefined);
    await sleep(5000); const s0 = await st(p); must(s0.mode === 'gauntlet' || !s0.title, 'not in gauntlet ' + JSON.stringify(s0));
    const end = await playOut(p); const hit = await endToHome(p, 'gauntlet');
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return `to wave ${end.wave}, ${hit}`;
  });
  await run('Ranked: first-run nudge, warning, hero, game, placement, Home', v, async () => {
    const p = await player(b, URL_, v, { seen: false }); await home(p); await sleep(1500);
    await tab(p, 'ranked'); await start(p); await shot(p, 'ranked-nudge');
    must(await press(p, 'skip', '.phk-dialog'), 'no first-run nudge'); await sleep(800); await shot(p, 'ranked-warning');
    if (!await p.page.evaluate(() => !!document.querySelector('.phk-dialog'))) await start(p);
    must(await press(p, '^ *yes', '.phk-dialog'), 'no ranked warning'); await pickHero(p); await inGame(p); await sleep(4000);
    must((await st(p)).mode === 'lobby', 'not in Ranked ' + JSON.stringify(await st(p)));
    await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(2000); await shot(p, 'ranked-reload');
    const s1 = await st(p); if (s1.title) { must(s1.saved, 'Ranked save lost on reload'); await press(p, 'continue'); await sleep(3000); }
    must((await st(p)).mode === 'lobby', 'reload lost Ranked ' + JSON.stringify(await st(p)));
    const end = await playOut(p); const hit = await endToHome(p, 'ranked');
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return `to wave ${end.wave}, ${hit}`;
  });
  await run('Learn: graduation, Home', v, async () => {
    const p = await player(b, URL_, v, { seen: false }); await home(p); await sleep(1500);
    await tab(p, 'learn'); await start(p); await sleep(6000); must(!(await st(p)).title, 'not in Learn');
    // The coached rounds have their own walkthrough (tutorial/courseWalkthrough.test.ts): here the run ends where the course ends.
    await p.page.evaluate(() => { const g = window.__bench.store; const r = g.getState().run; g.setState({ run: { ...r, phase: 'victory' } }); }); await sleep(3000); await shot(p, 'learn-end');
    const hit = await press(p, 'enter ascent|continue', '.endscreen'); await sleep(2500); await shot(p, 'learn-after');
    must(hit, 'no way out of the graduation screen'); must(await atHome(p), 'not home after graduating, pressed ' + hit);
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return hit;
  });
  await run('Learn: fresh guest, start, leave, Home', v, async () => {
    const p = await player(b, URL_, v, { seen: false }); await home(p); await sleep(1500); await shot(p, 'first-boot');
    await tab(p, 'learn'); await start(p); await sleep(6000); await shot(p, 'learn-in');
    const s = await st(p); must(!s.title, 'not in Learn ' + JSON.stringify(s));
    for (let i = 0; i < 4; i++) { if (await p.page.evaluate(() => !!document.querySelector('.gmenu'))) break; await p.page.keyboard.press('Escape'); await sleep(1200); }
    for (let i = 0; i < 3; i++) { await press(p, 'quit|tap again', '.gmenu'); await sleep(900); }
    await sleep(2500); must(await atHome(p), 'not home after leaving Learn');
    must(!p.errs.length, p.errs[0]); await p.ctx.close();
  });
}
await b.close(); srv.close();
console.table(results);
