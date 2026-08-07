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
  // WHAT each badge printed, not just WHEN it changed. The stagger assertion alone would pass a cascade that
  // flashed `-1` or `0` on its way to the right answer, and that is the failure this whole feature exists to
  // avoid: a hold is a delta subtracted from the live value, so a hold applied in a commit that has not yet
  // raised the value — or an oversized reel, or two clocks fighting over one counter — prints a number the
  // minion never had, on the readout players buy and position from. Every frame's value is recorded per uid
  // and bounded against that uid's own before/after readings below.
  const seen = {};
  const note = (u, text) => {
    const n = Number(text);
    if (!Number.isFinite(n)) return;
    const s = seen[u] ?? (seen[u] = { min: n, max: n });
    if (n < s.min) s.min = n;
    if (n > s.max) s.max = n;
  };
  for (const u of uids) note(u, before[u]);
  const t0 = performance.now();
  const tick = () => {
    const now = readAll();
    for (const u of uids) {
      note(u, now[u]);
      if (landedAt[u] === undefined && now[u] !== before[u]) landedAt[u] = Math.round(performance.now() - t0);
    }
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

  const after = readAll();
  const times = uids.map((u) => landedAt[u]);
  const spread = Math.max(...times) - Math.min(...times);
  // The buff above is +2/+2 on every minion, so the settled badge must read exactly that much higher, and no
  // frame in between may leave the corridor between the two. `min` is the one that catches the real bugs;
  // `max` catches an overshoot that never comes back down.
  const printed = uids.map((u) => {
    const base = Number(before[u]);
    const final = Number(after[u]);
    const s = seen[u] ?? { min: NaN, max: NaN };
    return {
      uid: u, base, final, min: s.min, max: s.max,
      settled: final === base + 2,
      neverBelow: s.min >= base,
      neverAbove: s.max <= final,
    };
  });
  return {
    uids, landedAt, spread, printed,
    allLanded: times.every((t) => t !== undefined),
    invariantHeld: printed.every((p) => p.settled && p.neverBelow && p.neverAbove),
  };
});

console.log(JSON.stringify(res, null, 2));
const staggered = res.allLanded && res.spread > 80;
const ok = staggered && res.invariantHeld;
if (ok) console.log('\nPASS — numbers are staggered, and no badge printed a value the minion never had');
else {
  if (!staggered) console.log(`\nFAIL — spread ${res.spread}ms, expected a real cascade`);
  for (const p of res.printed) {
    if (p.settled && p.neverBelow && p.neverAbove) continue;
    console.log(`FAIL — ${p.uid} printed ${p.min}..${p.max} against a true range of ${p.base}..${p.base + 2} (settled on ${p.final})`);
  }
}
await browser.close();
process.exit(ok ? 0 : 1);
