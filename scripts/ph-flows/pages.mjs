// Every page in and out of a game, reload on each, and the sign-in surfaces: node scripts/ph-flows/pages.mjs [desk|phone] [filter]
import { atHome, flow, home, inGame, launch, must, pickHero, player, results, serve, shot, sleep, st, start, tab } from './lib.mjs';

const PORT = 4613;
const URL_ = `http://127.0.0.1:${PORT}/?partyhome=1&partydemo=0`;
const srv = await serve('apps/web/dist-flows', PORT);
const b = await launch();
const views = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['desk', 'phone'];
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : /./;
const run = (n, v, fn) => (only.test(n) ? flow(n, v, fn) : undefined);
const look = (p) => p.page.evaluate(() => {
  const h = document.documentElement; const on = document.querySelector('.ph-navhost .ph-navtab[aria-selected="true"], .ph-navhost .ph-navtab.on');
  return { on: on?.textContent.trim().slice(0, 16) ?? null, bad: /This page did not load|Game paused/.test(document.body.innerText), hosts: document.querySelectorAll('.ph-navhost').length, shell: h.hasAttribute('data-ph-shell'), over: h.hasAttribute('data-ph-ingame'), gm: !!document.querySelector('.gmenu') };
});
const navs = (p) => p.page.evaluate(() => [...document.querySelectorAll('.ph-navhost .ph-navtab')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => (x.getAttribute('aria-label') || x.textContent).trim()));
const goNav = (p, n) => p.page.evaluate((name) => [...document.querySelectorAll('.ph-navhost .ph-navtab')].find((x) => (x.getAttribute('aria-label') || x.textContent).trim() === name)?.click(), n);
const back = (p) => p.page.evaluate(() => document.querySelector('.phk-back')?.click());
for (const v of views) {
  await run('Pages from Home: open, reload, Back', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    const names = await navs(p); const out = []; must(names.length >= 4, 'nav ' + names);
    for (const n of names.filter((x) => !/^(play|home)$/i.test(x))) {
      await goNav(p, n); await sleep(1600); const a = await look(p); await shot(p, `page-${n.replace(/\W/g, '')}`);
      must(!a.bad && a.hosts === 1, `${n}: ${JSON.stringify(a)}`);
      await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(1800); const r = await look(p);
      must(!r.bad && r.hosts === 1, `${n} after reload: ${JSON.stringify(r)}`); out.push(`${n}>${r.on}`);
      for (let i = 0; i < 3 && !await atHome(p); i++) { await p.page.keyboard.press('Escape'); await sleep(700); }
      must(await atHome(p), `${n}: Back did not reach Home`);
    }
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return out.join(' ');
  });
  await run('Pages over a game: open, Back, reload, resume', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    await tab(p, 'practice'); await start(p); await pickHero(p); await inGame(p); await sleep(4000);
    const menu = async () => { for (let i = 0; i < 12; i++) { if ((await look(p)).gm) return; await p.page.keyboard.press('Escape'); await sleep(1300); } must(false, 'no game menu'); };
    await menu();
    const rows = await p.page.evaluate(() => [...document.querySelectorAll('.gmenu .msb button')].map((x) => (x.getAttribute('aria-label') || x.textContent).trim()));
    const out = [];
    for (const n of rows.filter((x) => /career|collection|leaderboard|recent|live|patch|settings/i.test(x))) {
      await p.page.evaluate((name) => [...document.querySelectorAll('.gmenu .msb button')].find((x) => (x.getAttribute('aria-label') || x.textContent).trim() === name)?.click(), n);
      await sleep(1400); const a = await look(p); await shot(p, `over-${n.replace(/\W/g, '')}`); must(!a.bad, `${n}: ${JSON.stringify(a)}`);
      await back(p); await sleep(800); const c = await look(p); must(!c.bad && !(await st(p)).title, `${n} Back left the game ${JSON.stringify(c)}`); out.push(n.slice(0, 6));
      if (!(await look(p)).gm) await menu();
    }
    // A reload with a page open over the game: the game is still there to Continue.
    await p.page.reload({ waitUntil: 'commit' }); await home(p); await sleep(2000); const s = await st(p);
    must(s.mode === 'practice' && (s.saved || !s.title), 'reload lost the game ' + JSON.stringify(s));
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return out.join(' ');
  });
  await run('Guest gates: portrait, friends, offline Versus', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    const g = await p.page.evaluate(() => window.__bench.store.getState().account);
    await tab(p, 'versus'); await sleep(600); await shot(p, 'guest-versus');
    const off = await p.page.evaluate(() => ({ dis: document.querySelector('.ph-start')?.disabled ?? null, txt: document.querySelector('.ph-stage')?.innerText.slice(0, 300) }));
    must(!(await look(p)).bad, 'crash'); must(off.dis !== null, 'no START on Versus');
    must(!p.errs.length, p.errs[0]); await p.ctx.close(); return `anon=${g?.anonymous} startDisabled=${off.dis}`;
  });
  await run('Signed-in stub: account state on the home', v, async () => {
    const p = await player(b, URL_, v); await home(p); await sleep(1500);
    await p.page.evaluate(() => { const s = window.__bench.store; s.setState({ account: { ...s.getState().account, anonymous: false, userId: 'local-stub', discriminator: '0001' } }); });
    await sleep(900); await shot(p, 'signed-in'); const a = await look(p); must(!a.bad && await atHome(p), 'home broke signed in ' + JSON.stringify(a));
    for (const t of ['ranked', 'versus', 'practice', 'gauntlet', 'learn']) { await tab(p, t); await sleep(300); must(!(await look(p)).bad, t); }
    must(!p.errs.length, p.errs[0]); await p.ctx.close();
  });
}
await b.close(); srv.close();
console.table(results);
