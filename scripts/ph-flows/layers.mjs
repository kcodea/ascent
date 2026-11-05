// Esc and Back take the single top layer first, on the menus and in a game: node scripts/ph-flows/layers.mjs [desk|lap|phone|all] [filter]
import { atHome, flow, home, inGame, launch, must, pickHero, player, press, results, serve, shot, sleep, st, start, tab } from './lib.mjs';

const PORT = 4614;
const URL_ = `http://127.0.0.1:${PORT}/?partyhome=1&partydemo=0`;
const srv = await serve('apps/web/dist-flows', PORT);
const b = await launch();
const views = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['desk', 'lap', 'phone'];
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : /./;
const run = (n, v, fn) => (only.test(n) ? flow(n, v, fn) : undefined);
const see = (p) => p.page.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const g = window.__bench.store.getState();
  return { pop: vis('.inspect-ov'), book: !!g.showBook, list: vis('.book-setpick.is-open') || !!document.querySelector('[role=listbox]'), gm: !!document.querySelector('.gmenu'), page: !!(g.showCareer || g.showRecentGames || g.showCollection || g.settingsOpen), recent: !!g.showRecentGames, friends: !!document.querySelector('.ph-side-r .ph-friends, .ph-fdrawer, .ph-fcatch'), title: g.showTitle, q: document.querySelector('.book-search')?.value ?? null };
});
const key = async (p, how) => { if (how === 'esc') await p.page.keyboard.press('Escape'); else await p.page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => undefined); await sleep(650); };
const openBook = async (p) => { await p.page.evaluate(() => [...document.querySelectorAll('.ph-navhost .ph-navtab')].find((x) => /compendium/i.test(x.getAttribute('aria-label') || x.textContent))?.click()); await p.page.waitForSelector('.phb .book-grid', { timeout: 15000 }); await sleep(900); };
const rail = async (p, n) => { await p.page.evaluate((name) => [...document.querySelectorAll('.book-tribe, .book-cat, .book-rail button, .phb button')].find((x) => x.textContent.trim().toLowerCase() === name)?.click(), n.toLowerCase()); await sleep(900); };
const openCell = (p, sel) => p.page.evaluate((s) => document.querySelector(s)?.click(), sel);
const CELLS = { 'all minions': '.book-cell .card', spells: '.book-cell .card', gifts: '.book-cell .card', runes: '.book-cell .runecard', 'rune rewards': '.book-cell .card', heroes: '.phh' };
const game = async (p) => { await tab(p, 'practice'); await start(p); await pickHero(p); await inGame(p); await sleep(4000); };
const menu = async (p) => { for (let i = 0; i < 12; i++) { if ((await see(p)).gm) return; await p.page.keyboard.press('Escape'); await sleep(1300); } must(false, 'no game menu'); };

for (const v of views) {
  for (const how of ['esc', 'back']) {
    await run(`Compendium pop-ups, ${how}: top layer only`, v, async () => {
      const p = await player(b, URL_, v); await home(p); await sleep(1200); await openBook(p);
      const out = [];
      for (const [row, sel] of Object.entries(CELLS)) {
        if (row === 'all minions') await rail(p, 'all minions').catch(() => undefined); else await rail(p, row);
        await openCell(p, sel); await sleep(700); const a = await see(p); await shot(p, `pop-${row.replace(/\W/g, '')}`);
        must(a.pop, `${row}: a press opened nothing`);
        await key(p, how); const c = await see(p); must(!c.pop && c.book, `${row} ${how}: ${JSON.stringify(c)}`); out.push(row.slice(0, 5));
      }
      await key(p, how); await sleep(500); must(!(await see(p)).book, 'Compendium did not close after the pop-up'); must(await atHome(p), 'not Home');
      must(!p.errs.length, p.errs[0]); await p.ctx.close(); return out.join(' ');
    });
    await run(`In a game, ${how}: page to menu to game, never out`, v, async () => {
      const p = await player(b, URL_, v); await home(p); await sleep(1200); await game(p);
      await menu(p);
      await p.page.evaluate(() => window.__bench.store.getState().toggleBook()); await p.page.waitForSelector('.phb .book-grid', { timeout: 15000 }); await sleep(900); await shot(p, 'ingame-book');
      await openCell(p, '.book-cell .card'); await sleep(700); must((await see(p)).pop, 'no pop-up in the game Compendium');
      await key(p, how); let s = await see(p); must(!s.pop && s.book, 'pop-up: ' + JSON.stringify(s));
      await key(p, how); s = await see(p); must(!s.book && s.gm, 'Compendium: ' + JSON.stringify(s));
      await p.page.evaluate(() => [...document.querySelectorAll('.gmenu .msb button')].find((x) => /career/i.test(x.getAttribute('aria-label') || x.textContent))?.click()); await sleep(1300);
      await key(p, how); s = await see(p); must(s.gm && !s.page, 'page: ' + JSON.stringify(s));
      await key(p, how); s = await see(p); must(!s.gm && !s.title, 'menu: ' + JSON.stringify(s));
      if (how === 'back') { for (let i = 0; i < 4; i++) await key(p, how); must(!(await st(p)).title && (await p.page.evaluate(() => !!window.__bench)), 'Back left the game'); must(p.page.url().startsWith('http://127.0.0.1'), 'left the app'); }
      must(!p.errs.length, p.errs[0]); await p.ctx.close();
    });
    await run(`Lists and fields, ${how}`, v, async () => {
      const p = await player(b, URL_, v); await home(p); await sleep(1200); await openBook(p);
      // The Set picker: above everything, every row answers.
      await p.page.evaluate(() => document.querySelector('.book-setpick-btn')?.click()); await sleep(500); await shot(p, 'setpick');
      const rows = await p.page.evaluate(() => [...document.querySelectorAll('.book-setpick-opt')].map((o) => { const r = o.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { t: o.textContent.trim().slice(0, 8), ok: o === hit || o.contains(hit), in: r.bottom <= innerHeight }; }));
      must(rows.length >= 3 && rows.every((r) => r.ok && r.in), 'set rows ' + JSON.stringify(rows));
      await key(p, how); let s = await see(p); must(s.book && !(await p.page.evaluate(() => !!document.querySelector('.book-setpick.is-open'))), 'set list: ' + JSON.stringify(s));
      if (how === 'esc') {
        await p.page.fill('.book-search', 'imp'); await sleep(400); await key(p, 'esc'); s = await see(p); must(s.book, 'search Esc left the page'); must(s.q === '', 'search kept ' + s.q);
        if (v !== 'phone') {
          await p.page.hover('.book-cell .card'); await sleep(900);
          if (await p.page.evaluate(() => !!document.querySelector('.cardref'))) { await key(p, 'esc'); s = await see(p); must(s.book, 'hover Esc left the page'); }
        }
      }
      await p.page.evaluate(() => { for (const x of document.querySelectorAll('.ph-navhost .ph-navtab')) if (/recent/i.test(x.getAttribute('aria-label') || x.textContent)) x.click(); }); await sleep(1500);
      const more = await press(p, '^ *more', '.phk-page'); await sleep(500); await shot(p, 'recent-more');
      if (more) { await key(p, how); s = await see(p); must(s.recent, 'More list left the page ' + JSON.stringify(s)); }
      must(!p.errs.length, p.errs[0]); await p.ctx.close(); return more ? 'with More' : 'no More list here';
    });
    if (v === 'phone') await run(`Phone sheets, ${how}`, v, async () => {
      const p = await player(b, URL_, v); await home(p); await sleep(1200);
      const open = () => p.page.evaluate(() => document.querySelector('.ph-friendsbtn')?.click());
      await open(); await sleep(800); await shot(p, 'sheet-friends'); must(await p.page.evaluate(() => !!document.querySelector('.ph-fcatch')), 'no Friends sheet');
      await key(p, how); must(!await p.page.evaluate(() => !!document.querySelector('.ph-fcatch')), 'Friends sheet stayed'); must(await atHome(p), 'left Home');
      await tab(p, 'practice'); await p.page.evaluate(() => [...document.querySelectorAll('.ph-side-r .phk-btn, .ph-stage .phk-btn')].find((x) => /options/i.test(x.textContent))?.click()); await sleep(800); await shot(p, 'sheet-options');
      must(await p.page.evaluate(() => !!document.querySelector('.ph-fcatch')), 'no Options sheet');
      await key(p, how); must(!await p.page.evaluate(() => !!document.querySelector('.ph-fcatch')), 'Options sheet stayed');
      must(!p.errs.length, p.errs[0]); await p.ctx.close();
    });
  }
}
await b.close(); srv.close();
console.table(results);
