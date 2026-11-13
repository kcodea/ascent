// MAGICIAN'S MAGIC HAT, live on the local stack (R-DUOS-MAGICIAN-01). Two real headless browsers in a Ranked Duos party
// (the same pass channel as Versus Duos) against `wrangler dev`. Player A is made the Magician on the first Shop, then:
//   (three buys and a random copy that leaves from the hat: owner 2026-11-12)
//   round 1  buy 1 (counter 1/3) -> buy 1 (2/3: ready glow) -> B views A's board (sees the count and the glow)
//            -> buy 1: a copy of one of the three rises out of the hat on A, streams out, arrives in B's hand (a frame
//            burst on both screens) -> 3 more buys (the turn's second copy) -> 3 more: the hat is full but capped (no
//            glow) -> the fight (no glow)
//   round 2  the full hat is ready again at the start of the turn -> B is WATCHING A's board when A buys (the held hat
//            fires; B sees the send), B comes back (the copy lands) -> 1 more buy (2/3), B's hand is filled, A buys: the
//            copy waits for room, then lands when B makes room -> A views B's board.
// Every non-local host is blocked at the resolver, so the bench bundle never reaches a live service.
//   node scripts/versus-qa/magician-hat.mjs [--dist apps/web/dist-bench] [--cf http://127.0.0.1:8805] [--port 4521]
// QA-ONLY SHORTCUTS, on the local run objects (never in the game): A's hero id is set on the first Shop, both players are
// given Gold, A's hand is emptied between cycles, and B's hand is filled / trimmed for the full-hand case.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { QA_OUT, serveDist, sleep } from './lib.mjs';
import { clickSel, stateOf, step } from './autopilot.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const DIST = arg('dist', 'apps/web/dist-bench');
const PORT = Number(arg('port', '4521'));
const CF = arg('cf', 'http://127.0.0.1:8805');
const URL_ = `http://127.0.0.1:${PORT}/?versusHost=cf&versusCfUrl=${CF}`;
const SHOTS = path.join(QA_OUT, 'shots');
const srv = await serveDist(DIST, PORT);
const b = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--use-angle=d3d11',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
});

async function player(name) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ascent.versus', '1'); localStorage.setItem('ascent.ftue.done', '1'); } catch {} });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push(`error: ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  await page.goto(URL_, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__bench, null, { timeout: 120000 });
  return { name, ctx, page, log };
}
const shot = async (p, label) => { await p.page.screenshot({ path: path.join(SHOTS, `magician-${label}-${p.name}.png`) }).catch(() => undefined); };
/**
 * A FRAME BURST on one screen: the browser's own screencast (every painted frame, as JPEG) from now until the returned
 * `stop()`; at most `keep` frames, evenly spaced, are written. A screenshot call takes several hundred ms here, far too
 * slow for a stream that lands in under a second.
 */
async function cast(p, label, keep = 24) {
  const cdp = p.cdp ??= await p.ctx.newCDPSession(p.page);
  const frames = [];
  const t0 = Date.now();
  const on = (ev) => { frames.push({ at: Date.now() - t0, data: ev.data }); cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined); };
  cdp.on('Page.screencastFrame', on);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    cdp.off('Page.screencastFrame', on);
    const step = Math.max(1, Math.ceil(frames.length / keep));
    const kept = frames.filter((_, i) => i % step === 0);
    kept.forEach((f, i) => fs.writeFileSync(path.join(SHOTS, `magician-${label}-${p.name}-f${String(i).padStart(2, '0')}-${f.at}ms.jpg`), Buffer.from(f.data, 'base64')));
    return { frames: frames.length, kept: kept.map((f) => f.at) };
  };
}
/** Burst both screens around `fn`, for `ms` after it. */
async function burstBoth(labelA, labelB, fn, ms = 1900) {
  const stops = await Promise.all([cast(A, labelA), cast(B, labelB)]);
  await sleep(120);
  const got = await fn();
  await sleep(ms);
  const res = await Promise.all(stops.map((s) => s()));
  return { got, A: res[0], B: res[1] };
}

const A = await player('A');
const B = await player('B');
for (const [p, n] of [[A, 'Ann'], [B, 'Bob']]) await p.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), n);
await sleep(2500);
const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
await sleep(1500);
// The party's Start button (its label has changed over time: match it loosely, and wait for it to be enabled).
{
  const start = A.page.getByRole('button', { name: /^start/i }).first();
  await start.waitFor({ state: 'visible', timeout: 20000 });
  await start.click();
  // The ranked confirmation (local stack only: nothing here is rated anywhere).
  const yes = A.page.getByRole('button', { name: /^yes/i }).first();
  if (await yes.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await yes.click();
}

/** The page-side helpers (the Shop is played through the store's dispatch, as the autopilot does). */
const install = (p) => p.page.evaluate(async () => {
  const sim = await window.__bench.sim();
  const st = window.__bench.store;
  const settle = () => { const run = st.getState().run; if (sim.modalOpen(run)) { const ans = sim.versusAutoResolve(run, sim.versusTimeoutRng(1, run.wave, 'p1')); if (ans !== run) st.setState({ run: ans }); } };
  window.__qa = {
    hat: () => { const run = st.getState().run; return { ...sim.magicHatView(run), hero: run.heroId, text: sim.heroPowerText(run), outbox: (run.duos?.outbox ?? []).map((e) => ({ seq: e.seq, hat: !!e.hat, via: e.via ?? null, cardId: e.card.cardId, refunded: !!e.refunded })), hand: run.hand.length, embers: run.embers, wave: run.wave }; },
    gold: (n) => { st.setState({ run: { ...st.getState().run, embers: n } }); },
    beMagician: () => { const run = st.getState().run; st.setState({ run: { ...run, heroId: 'magician', embers: 400 } }); return st.getState().run.heroId; },
    /** Does the Shop take actions yet? (A roll: it never touches the hat.) */
    canAct: () => { const r = st.getState().run; st.getState().dispatch({ type: 'roll' }); return st.getState().run !== r; },
    clearHand: () => { st.setState({ run: { ...st.getState().run, hand: [] } }); },
    /** Buy one affordable Shop minion or spell (rolling when the row has none). Returns what was bought. */
    buy: () => {
      for (let i = 0; i < 8; i++) {
        settle();
        const run = st.getState().run;
        const o = run.shop.find((x) => !x.starform && sim.offerBuyPrice(run, x).cost <= run.embers);
        if (o) { st.getState().dispatch({ type: 'buy', uid: o.uid }); if (st.getState().run !== run) return { cardId: o.cardId, uid: o.uid }; }
        st.getState().dispatch({ type: 'roll' });
      }
      return null;
    },
    hand: () => st.getState().run.hand.map((c) => ({ uid: c.uid, cardId: c.cardId, attack: c.attack, health: c.health, golden: c.golden, passKey: c.passKey ?? null })),
    duos: () => { const d = st.getState().run.duos; return d ? { received: d.received, refused: d.refused, waiting: (d.waiting ?? []).length } : null; },
    /** B only: fill the hand to its cap with plain cards (the full-hand case), or drop one to make room. */
    fillHand: () => {
      const run = st.getState().run;
      const cards = window.__bench.combat.cards;
      const ids = Object.values(cards).filter((c) => c && !c.spell && !c.token && !c.duos && c.tier === 1).map((c) => c.id);
      const hand = [...run.hand];
      for (let i = 0; hand.length < sim.handCap(run); i++) { const d = cards[ids[i % ids.length]]; hand.push({ uid: `qa${i}`, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false }); }
      st.setState({ run: { ...run, hand, embers: 50 } });
      return st.getState().run.hand.length;
    },
    makeRoom: () => { const run = st.getState().run; st.setState({ run: { ...run, hand: run.hand.slice(1) } }); st.getState().dispatch({ type: 'roll' }); return st.getState().run.hand.length; },
  };
});
const qa = (p, fn, ...args) => p.page.evaluate(([fn, args]) => window.__qa[fn](...args), [fn, args]);
const out = { rounds: [], logs: {} };
const say = (k, v) => { console.log(k, JSON.stringify(v)); out.rounds.push([k, v]); };

/** Step both players until both sit in the Shop of `wave` (never ending the turn: the script drives it). */
async function toShop(wave, ms = 180_000) {
  const mem = toShop.mem ??= { A: {}, B: {} };
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const sa = await step(A, mem.A, { policy: 'empty', endTurn: 'timer' });
    const sb = await step(B, mem.B, { policy: 'empty', endTurn: 'timer' });
    const inShop = (s) => s.runMode === 'versus' && s.runPhase === 'recruit' && s.phase === 'shop' && s.round === wave && s.wave === wave;
    if (inShop(sa) && inShop(sb)) return true;
    await sleep(200);
  }
  return false;
}
const endTurns = async () => { await clickSel(A, '.etbwrap'); await clickSel(B, '.etbwrap'); };

try {
  if (!(await toShop(1))) throw new Error('never reached the first Shop');
  await sleep(2500); // the Shop's entrance settles
  await install(A); await install(B);
  say('A hero', await qa(A, 'beMagician'));
  await sleep(400);
  await shot(A, '00-0of3');
  const classes = (p) => p.page.evaluate(() => ({ panel: document.querySelector('.statusbar .heropanel')?.className, btn: document.querySelector('.statusbar .heropowerbtn')?.className, pill: document.querySelector('.statusbar .hpb-pill')?.textContent, bar: document.querySelector('.statusbar')?.className }));
  const buys = async (n, gap = 120) => { let ok = 0; for (let i = 0; i < n; i++) { if (await qa(A, 'buy')) ok++; await sleep(gap); } return ok; };

  // ── ROUND 1 ── 1 buy: the counter reads 1/3 ───────────────────────────────────────────────────────────────────────
  // (The Shop refuses actions until its opening has played: the first buy is retried until it lands.)
  for (let i = 0; i < 60; i++) { if (await qa(A, 'buy')) break; await sleep(500); }
  await sleep(500);
  say('after 1 buy', await qa(A, 'hat'));
  await shot(A, '01-1of3');

  // 1 more: 2/3, the next buy sends the copy (the ready call).
  await buys(1, 300);
  await sleep(800);
  say('after 2 buys', await qa(A, 'hat'));
  say('A power classes (active)', await classes(A));
  await shot(A, '02-active');
  await sleep(450);
  await shot(A, '02-active-b'); // a second phase of the ready call's throb
  // B looks at A's board: the same counter and glow.
  await clickSel(B, '.duosdock-hold[role="button"]');
  await sleep(2000);
  say('B viewing A', { teammate: (await stateOf(B)).teammate, ...(await classes(B)) });
  await shot(B, '03-mate-view-active');
  await clickSel(B, '.duosdock[role="button"]');
  await sleep(1500);
  await shot(B, '04-before-copy');

  // The 3rd buy: the copy rises out of the hat. A frame burst on both screens at once.
  say('3rd buy + burst', await burstBoth('05-send', '05-arrive', () => qa(A, 'buy'), 2400));
  say('A after the copy', await qa(A, 'hat'));
  say('A power classes (fired)', await classes(A));
  say('B hand', await qa(B, 'hand'));
  say('B duos', await qa(B, 'duos'));
  await shot(A, '06-after-fire-0of3');
  await shot(B, '06-copy-in-hand');

  // A second copy this turn (own screens), then three more buys: the hat is full but capped.
  await qa(A, 'clearHand');
  say('buys landed (second hat)', await buys(3));
  await qa(A, 'clearHand');
  say('buys landed (third fill)', await buys(3));
  await sleep(900);
  say('capped', await qa(A, 'hat'));
  say('A power classes (capped)', await classes(A));
  await shot(A, '11-capped-3of3-no-glow');
  say('B duos after two copies', await qa(B, 'duos'));
  await qa(A, 'clearHand');

  // The fight: no ready glow there.
  await endTurns();
  for (let i = 0; i < 120; i++) { const s = await stateOf(A); if (s.runPhase === 'combat') break; await sleep(250); }
  await sleep(2500);
  say('A power classes (combat)', await classes(A));
  await shot(A, '12-combat');

  // ── ROUND 2 ── the full hat is ready again at the start of the turn (its first buy fires it) ──────────────────────
  if (!(await toShop(2))) throw new Error('never reached the second Shop');
  await sleep(2000);
  await install(A); await install(B);
  await qa(A, 'gold', 300);
  for (let i = 0; i < 60; i++) { if (await qa(A, 'canAct')) break; await sleep(500); }
  await sleep(600);
  say('turn 2 start', await qa(A, 'hat'));
  say('A power classes (turn 2)', await classes(A));
  await shot(A, '13-next-turn-active');

  // B is WATCHING A's board when the copy is sent: B sees the send, then comes back and the copy lands.
  await clickSel(B, '.duosdock-hold[role="button"]');
  await sleep(2000);
  say('watched copy + burst', await burstBoth('07-send-watched-by-B', '07-watching-the-send', () => qa(A, 'buy'), 2600));
  await shot(B, '08-watching-after-send');
  {
    const stop = await cast(B, '09-back-arrival');
    await clickSel(B, '.duosdock[role="button"]');
    await sleep(3000);
    say('B back burst', await stop());
  }
  say('B hand after the watched copy', await qa(B, 'hand'));
  say('B duos', await qa(B, 'duos'));
  await shot(B, '10-copy-after-return');

  // B's hand is full: the copy waits for room, then lands.
  await qa(A, 'clearHand');
  say('buys landed (refill to 2/3)', await buys(1));
  say('refilled', await qa(A, 'hat'));
  say('B hand filled to', await qa(B, 'fillHand'));
  await sleep(700);
  say('copy to a full hand + burst', await burstBoth('14-send-full', '14-full-hand', () => qa(A, 'buy'), 2400));
  say('A after', await qa(A, 'hat'));
  say('B duos (waiting)', await qa(B, 'duos'));
  say('docks', { A: await A.page.evaluate(() => document.querySelector('.duosdock')?.textContent?.replace(/\s+/g, ' ').slice(0, 160)), B: await B.page.evaluate(() => document.querySelector('.duosdock')?.textContent?.replace(/\s+/g, ' ').slice(0, 160)) });
  await shot(A, '15-mate-hand-full');
  await shot(B, '15-waiting');
  {
    const stop = await cast(B, '16-room-arrival');
    say('B makes room, hand', await qa(B, 'makeRoom'));
    await sleep(2000);
    say('B room burst', await stop());
  }
  say('B duos (landed)', await qa(B, 'duos'));
  say('B hand tail', (await qa(B, 'hand')).slice(-2));
  await shot(B, '16-landed-after-room');
  // A looks at B's board: the copies are in their hand.
  await clickSel(A, '.duosdock-hold[role="button"]');
  await sleep(2000);
  await shot(A, '17-A-viewing-B');
  await clickSel(A, '.duosdock[role="button"]');
  await sleep(1000);
  say('final A', await qa(A, 'hat'));
} catch (e) {
  say('FAILED', String(e?.stack ?? e));
  await shot(A, 'zz-failed'); await shot(B, 'zz-failed');
} finally {
  out.logs = { A: A.log.slice(0, 20), B: B.log.slice(0, 20) };
  console.log('A log', JSON.stringify(out.logs.A));
  console.log('B log', JSON.stringify(out.logs.B));
  fs.writeFileSync(path.join(QA_OUT, 'magician-hat.json'), JSON.stringify(out, null, 1));
  await b.close(); srv.close();
}
