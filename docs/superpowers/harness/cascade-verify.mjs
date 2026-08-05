import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5205';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => window.useGame.getState().startSceneBuilder());
await new Promise((r) => setTimeout(r, 900));

const res = await page.evaluate(async () => {
  const G = () => window.useGame.getState();
  // Four minions on the board, each a DIFFERENT card. `buy` splices the bought offer out of
  // `run.shop`, so a naive per-iteration `shop[0]` read (as the original sketch of this harness
  // did) hands the next iteration an already-emptied slot with no `cardId`. Distinct ids matter
  // too, not just non-empty ones: the starting shop's three offers aren't guaranteed distinct
  // (two `manasaber` rows is common), and buying the same card a third time fires the
  // triple-merge (three copies fuse into one golden minion in the HAND, not the board) — which
  // would silently leave fewer than four separate uids for the cascade to land on. Roll until
  // four distinct offers have been seen across the shop's history, then drive each purchase off
  // a single-item shop stamped with one of those ids.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const distinctIds = new Set();
  for (let rolls = 0; distinctIds.size < 4 && rolls < 10; rolls++) {
    for (const o of G().run.shop) distinctIds.add(o.cardId);
    if (distinctIds.size < 4) { G().dispatch({ type: 'roll' }); await sleep(120); }
  }
  const cardIds = [...distinctIds].slice(0, 4);
  for (let i = 0; i < 4; i++) {
    window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ uid: 'z' + i, cardId: cardIds[i] }] } }));
    await sleep(150);
    G().dispatch({ type: 'buy', uid: 'z' + i });
    await sleep(150);
    const h = G().run.hand;
    G().dispatch({ type: 'play', uid: h[h.length - 1].uid });
    await sleep(350);
  }
  const uids = G().run.board.map((m) => m.uid);
  const readAll = () => Object.fromEntries(uids.map((u) => {
    const el = document.querySelector(`.card[data-uid="${u}"] .badge.atk .value`);
    return [u, el ? el.textContent : null];
  }));

  const before = readAll();
  const landedAt = {};
  const t0 = performance.now();
  const tick = () => {
    const now = readAll();
    for (const u of uids) if (landedAt[u] === undefined && now[u] !== before[u]) landedAt[u] = Math.round(performance.now() - t0);
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // A Ruby landing on every minion at once — the Excavator shape.
  window.useGame.setState((s) => ({
    run: {
      ...s.run,
      board: s.run.board.map((c) => ({
        ...c, attack: c.attack + 2, health: c.health + 2,
        buffs: [...(c.buffs ?? []), { source: 'Ruby', attack: 2, health: 2, count: 1 }],
      })),
      rubyLandedFx: uids.map((u) => ({ uid: u, count: 1 })),
      rubyLandedFxSeq: (s.run.rubyLandedFxSeq ?? 0) + 1,
    },
  }));
  await new Promise((r) => setTimeout(r, 3100));

  const times = uids.map((u) => landedAt[u]);
  const spread = Math.max(...times) - Math.min(...times);
  return { uids, landedAt, spread, allLanded: times.every((t) => t !== undefined) };
});

console.log(JSON.stringify(res, null, 2));
const ok = res.allLanded && res.spread > 80;
console.log(ok ? '\nPASS — numbers are staggered' : `\nFAIL — spread ${res.spread}ms, expected a real cascade`);
await browser.close();
process.exit(ok ? 0 : 1);
