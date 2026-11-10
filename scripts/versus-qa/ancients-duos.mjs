// ANCIENTS x THE DUOS HEROES, live on the local stack (R-ANCDUOS-01). Two real headless browsers in a Ranked Duos party
// (the same pass channel and tag-team fight as Versus Duos) against `wrangler dev`, with Ancients forced on through the
// DEV / bench seam (`localStorage['ascent.dev.duosAncients']`, read only by a DEV server or a `VITE_PERF_BENCH=1`
// bundle). Player A is the Priestess, then the Magician; player B is the teammate.
//   round 1  the meter awakens on A's first Refresh (the offer shows in a live match) -> Priestess x BONDS: Passaria and
//            an ordinary pass each give both left-most minions +4/+4 (a frame burst on both screens)
//            -> Priestess x WAR: the fight opens with +2/+2 per card passed this turn
//   round 2  Magician x GENESIS: 8 buys, the hat is active, the 9th buy sends a GILDED copy (both screens)
//            -> Magician x WAR: both boards hold the same minion; the tag-team fight swaps their stats
//   round 3  Priestess x BONDS again, then B RELOADS mid-turn: the +4/+4 is there once (never twice, never lost)
// Every non-local host is blocked at the resolver, so the bench bundle never reaches a live service.
//   node scripts/versus-qa/ancients-duos.mjs [--dist apps/web/dist-bench] [--cf http://127.0.0.1:8806] [--port 4526]
// QA-ONLY SHORTCUTS, on the local run objects (never in the game): A's hero id and Ancient pick are set by hand, both
// players are given Gold, and the boards for the War fights are placed directly.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { QA_OUT, serveDist, sleep } from './lib.mjs';
import { clickSel, stateOf, step } from './autopilot.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const DIST = arg('dist', 'apps/web/dist-bench');
const PORT = Number(arg('port', '4526'));
const CF = arg('cf', 'http://127.0.0.1:8806');
const URL_ = `http://127.0.0.1:${PORT}/?versusHost=cf&versusCfUrl=${CF}`;
const SHOTS = path.join(QA_OUT, 'shots');
const srv = await serveDist(DIST, PORT);
const b = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--use-angle=d3d11',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
});

async function player(name, seam) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  // The seam: a bench bundle reads this key. A: `cost:1` awakens the Ancient on the first Refresh. B: the default meter
  // (16), so the teammate's Shop is never paused behind an offer of its own during the check.
  await ctx.addInitScript((seam) => { try { localStorage.setItem('ascent.versus', '1'); localStorage.setItem('ascent.ftue.done', '1'); localStorage.setItem('ascent.dev.duosAncients', seam); } catch {} }, seam);
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push(`error: ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  await page.goto(URL_, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__bench, null, { timeout: 120000 });
  return { name, ctx, page, log };
}
const shot = async (p, label) => { await p.page.screenshot({ path: path.join(SHOTS, `ancduos-${label}-${p.name}.png`) }).catch(() => undefined); };
async function cast(p, label, keep = 16) {
  const cdp = p.cdp ??= await p.ctx.newCDPSession(p.page);
  const frames = [];
  const t0 = Date.now();
  const on = (ev) => { frames.push({ at: Date.now() - t0, data: ev.data }); cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined); };
  cdp.on('Page.screencastFrame', on);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    cdp.off('Page.screencastFrame', on);
    const every = Math.max(1, Math.ceil(frames.length / keep));
    const kept = frames.filter((_, i) => i % every === 0);
    kept.forEach((f, i) => fs.writeFileSync(path.join(SHOTS, `ancduos-${label}-${p.name}-f${String(i).padStart(2, '0')}-${f.at}ms.jpg`), Buffer.from(f.data, 'base64')));
    return { frames: frames.length, kept: kept.map((f) => f.at) };
  };
}
async function burstBoth(labelA, labelB, fn, ms = 2000) {
  const stops = await Promise.all([cast(A, labelA), cast(B, labelB)]);
  await sleep(120);
  const got = await fn();
  await sleep(ms);
  const res = await Promise.all(stops.map((s) => s()));
  return { got, A: res[0], B: res[1] };
}

const A = await player('A', 'cost:1');
const B = await player('B', '1');
for (const [p, n] of [[A, 'Ann'], [B, 'Bob']]) await p.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), n);
await sleep(2500);
const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
await sleep(1500);
{
  const start = A.page.getByRole('button', { name: /^start/i }).first();
  await start.waitFor({ state: 'visible', timeout: 20000 });
  await start.click();
  const yes = A.page.getByRole('button', { name: /^yes/i }).first();
  if (await yes.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await yes.click();
}

/** The page-side helpers (the Shop is played through the store's dispatch, as the autopilot does). */
const install = (p) => p.page.evaluate(async () => {
  const sim = await window.__bench.sim();
  const st = window.__bench.store;
  const cards = window.__bench.combat.cards;
  const run = () => st.getState().run;
  const d = (a) => { const before = run(); st.getState().dispatch(a); return run() !== before; };
  const settle = () => { const r = run(); if (sim.modalOpen(r) && !r.ancients?.offer) { const ans = sim.versusAutoResolve(r, sim.versusTimeoutRng(1, r.wave, 'p1')); if (ans !== r) st.setState({ run: ans }); } };
  const view = (c) => ({ uid: c.uid, cardId: c.cardId, attack: c.attack, health: c.health, golden: !!c.golden, keywords: c.keywords, passKey: c.passKey ?? null });
  const plainIds = Object.values(cards).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0 && c.keywords.length === 0).map((c) => c.id);
  const mk = (uid, id, attack, health) => { const c = cards[id]; return { uid, cardId: id, tribe: c.tribe, attack, health, keywords: [...c.keywords], golden: false }; };
  window.__qa = {
    snap: () => { const r = run(); return { hero: r.heroId, wave: r.wave, phase: r.phase, embers: r.embers, ancients: r.ancients ? { enabled: !!r.ancientsEnabled, points: r.ancients.points, cost: r.ancients.cost, offer: r.ancients.offer ?? null, picked: r.ancients.picked ?? null } : null, text: sim.heroPowerText(r), board: r.board.map(view), hand: r.hand.map(view), outbox: (r.duos?.outbox ?? []).map((e) => ({ seq: e.seq, wave: e.wave, cardId: e.card.cardId, via: e.via ?? null, hat: !!e.hat, bonds: e.bonds ?? null, copies: e.copies ?? null, refunded: !!e.refunded, golden: !!e.card.golden })), received: r.duos?.received ?? [], waiting: (r.duos?.waiting ?? []).length, hat: r.heroId === 'magician' ? sim.magicHatView(r) : null }; },
    gold: (n) => { st.setState({ run: { ...run(), embers: n } }); },
    /** QA shortcut: become `heroId` on the local run (the room dealt another hero). */
    be: (heroId) => { st.setState({ run: { ...run(), heroId, heroReady: true, heroUsesThisTurn: 0, embers: 400, magicHatBuys: 0, magicHatSent: 0 } }); return run().heroId; },
    canAct: () => { const r = run(); if (r.ancients?.offer) return true; st.getState().dispatch({ type: 'roll' }); return run() !== r; },
    roll: () => d({ type: 'roll' }),
    /** QA shortcut: put `id` in the open (or a reopened) Ancient offer, then take it through the real `pickAncient`. */
    pick: (id) => {
      const r = run();
      const a = r.ancients;
      if (!a) return { ok: false, why: 'no ancients on the run' };
      const rest = ['death', 'fortune', 'war', 'genesis', 'time', 'bonds'].filter((x) => x !== id).slice(0, 2);
      st.setState({ run: { ...r, ancients: { ...a, points: a.cost, picked: undefined, powerOverride: undefined, powerOverrideFor: undefined, offer: [id, ...rest] } } });
      const ok = d({ type: 'pickAncient', id });
      return { ok, picked: run().ancients?.picked ?? null, text: sim.heroPowerText(run()) };
    },
    clearHand: () => { st.setState({ run: { ...run(), hand: [] } }); },
    /** Buy one affordable Shop card (rolling when the row has none). `minion`: a minion only. */
    buy: (minion) => {
      for (let i = 0; i < 10; i++) {
        settle();
        const r = run();
        const o = r.shop.find((x) => !x.starform && sim.offerBuyPrice(r, x).cost <= r.embers && (!minion || (!cards[x.cardId]?.spell && !cards[x.cardId]?.ruby)));
        if (o) { st.getState().dispatch({ type: 'buy', uid: o.uid }); if (run() !== r) return { cardId: o.cardId, uid: o.uid }; }
        st.getState().dispatch({ type: 'roll' });
      }
      return null;
    },
    /** Buy and play minions until the board holds `n`. */
    field: (n) => {
      for (let i = 0; i < 30 && run().board.length < n; i++) {
        settle();
        const r = run();
        const h = r.hand.find((c) => !cards[c.cardId]?.spell && !cards[c.cardId]?.ruby);
        if (h) { if (!d({ type: 'play', uid: h.uid })) st.setState({ run: { ...run(), hand: run().hand.filter((c) => c.uid !== h.uid) } }); continue; }
        window.__qa.buy(true);
      }
      settle();
      return run().board.length;
    },
    /** Passaria on the first legal Shop minion. */
    passaria: () => {
      for (let i = 0; i < 6; i++) {
        const r = run();
        const o = r.shop.find((x) => sim.passariaTarget(r, x.uid));
        if (o) return { ok: d({ type: 'heroPower', uid: o.uid }), cardId: o.cardId };
        st.getState().dispatch({ type: 'roll' });
      }
      return { ok: false };
    },
    /** An ordinary pass of a freshly bought minion (hand only). */
    dragPass: () => {
      const got = window.__qa.buy(true);
      const r = run();
      const c = r.hand[r.hand.length - 1];
      return c ? { ok: d({ type: 'passCard', uid: c.uid }), cardId: c.cardId, bought: got } : { ok: false };
    },
    /** QA shortcut: place a board directly (the War fights need known bodies). Entries: [slot, attack, health]. */
    setBoard: (entries) => { st.setState({ run: { ...run(), board: entries.map(([slot, a, h], i) => mk(`qa${run().wave}_${i}`, plainIds[slot], a, h)) } }); return run().board.map(view); },
    /** The fight on screen: every buff an Ancient of War gave, and each tag-in's bodies. */
    fight: () => {
      const lc = run().lastCombat;
      if (!lc) return null;
      const name = (uid) => { for (const e of lc.events) { if (e.type === 'tagIn') { const m = e.minions.find((x) => x.uid === uid); if (m) return m.cardId; } } const m = [...lc.initial.player, ...lc.initial.enemy].find((x) => x.uid === uid); return m?.cardId ?? uid; };
      return {
        war: lc.events.filter((e) => e.type === 'buff' && e.source === 'Ancient of War').map((e) => ({ target: name(e.target), attack: e.attack, health: e.health })),
        initialPlayer: lc.initial.player.map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health })),
        tagIns: lc.events.filter((e) => e.type === 'tagIn').map((e) => ({ side: e.side, member: e.member, minions: e.minions.map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health })) })),
        member: lc.duosMember ?? null,
      };
    },
    plainIds: () => plainIds.slice(0, 4),
  };
});
const qa = (p, fn, ...args) => p.page.evaluate(([fn, args]) => window.__qa[fn](...args), [fn, args]);
const out = { steps: [], logs: {} };
const say = (k, v) => { console.log(k, JSON.stringify(v)); out.steps.push([k, v]); };
const brief = (s) => ({ hero: s.hero, picked: s.ancients?.picked, board: s.board.map((c) => `${c.cardId} ${c.attack}/${c.health}${c.golden ? ' G' : ''}`), hand: s.hand.map((c) => `${c.cardId} ${c.attack}/${c.health}${c.golden ? ' G' : ''}`), outbox: s.outbox.length, received: s.received.length });

async function toShop(wave, ms = 240_000) {
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
const ready = async (p) => { for (let i = 0; i < 60; i++) { if (await qa(p, 'canAct')) return true; await sleep(500); } return false; };
/** Wait for the fight to be on screen on `p`, then return what it held. */
async function fightOf(p, label) {
  for (let i = 0; i < 160; i++) { const s = await stateOf(p); if (s.runPhase === 'combat') break; await sleep(250); }
  await sleep(3500);
  await shot(p, `${label}-early`);
  await sleep(3500);
  await shot(p, `${label}-mid`);
  return qa(p, 'fight');
}

try {
  // ── ROUND 1: PRIESTESS ────────────────────────────────────────────────────────────────────────────────────────────
  if (!(await toShop(1))) throw new Error('never reached the first Shop');
  await sleep(2500);
  await install(A); await install(B);
  await ready(A); await ready(B);
  say('seam: Ancients on both runs', { A: (await qa(A, 'snap')).ancients, B: (await qa(B, 'snap')).ancients });
  say('A hero', await qa(A, 'be', 'priestess'));
  await qa(B, 'gold', 400);
  // The meter (cost 1) awakens on the first Refresh: the offer opens in a live Duos match.
  await qa(A, 'roll');
  await sleep(2500);
  say('A offer after one Refresh', (await qa(A, 'snap')).ancients);
  await shot(A, '01-offer-open');
  say('A picks Bonds', await qa(A, 'pick', 'bonds'));
  await sleep(2500);
  await shot(A, '02-bonds-picked');
  say('A fields', await qa(A, 'field', 2));
  say('B fields', await qa(B, 'field', 2));
  await sleep(1200);
  const a0 = await qa(A, 'snap'); const b0 = await qa(B, 'snap');
  say('before the pass', { A: brief(a0), B: brief(b0) });
  await shot(A, '03-before-pass'); await shot(B, '03-before-pass');

  // BONDS, Passaria: both left-most minions +4/+4.
  say('Passaria + burst', await burstBoth('04-passaria-send', '04-passaria-arrive', () => qa(A, 'passaria'), 2400));
  const a1 = await qa(A, 'snap'); const b1 = await qa(B, 'snap');
  say('after Passaria', { A: brief(a1), B: brief(b1), entry: a1.outbox.at(-1) });
  say('BONDS deltas (Passaria)', {
    A: [a1.board[0].attack - a0.board[0].attack, a1.board[0].health - a0.board[0].health],
    B: [b1.board[0].attack - b0.board[0].attack, b1.board[0].health - b0.board[0].health],
    Bhand: b1.hand.length - b0.hand.length,
  });
  await shot(A, '05-after-passaria'); await shot(B, '05-after-passaria');

  // BONDS, an ordinary pass: again.
  say('ordinary pass + burst', await burstBoth('06-pass-send', '06-pass-arrive', () => qa(A, 'dragPass'), 2400));
  const a2 = await qa(A, 'snap'); const b2 = await qa(B, 'snap');
  say('BONDS deltas (ordinary pass)', {
    A: [a2.board[0].attack - a1.board[0].attack, a2.board[0].health - a1.board[0].health],
    B: [b2.board[0].attack - b1.board[0].attack, b2.board[0].health - b1.board[0].health],
    Bhand: b2.hand.length - b1.hand.length,
  });
  await shot(A, '07-after-pass'); await shot(B, '07-after-pass');

  // WAR: two cards passed this turn. B's board is cleared (QA) so A's board is the one that fights first.
  say('A picks War', await qa(A, 'pick', 'war'));
  await sleep(800);
  await shot(A, '08-war-text');
  await B.page.evaluate(() => { const st = window.__bench.store; st.setState({ run: { ...st.getState().run, board: [] } }); });
  const aWar = await qa(A, 'snap');
  say('War before the fight', { text: aWar.text, board: brief(aWar).board });
  await endTurns();
  const f1 = await fightOf(A, '09-priestess-war-fight');
  say('PRIESTESS WAR fight (A)', f1);
  await shot(B, '09-priestess-war-fight-mid');

  // ── ROUND 2: MAGICIAN ─────────────────────────────────────────────────────────────────────────────────────────────
  if (!(await toShop(2))) throw new Error('never reached the second Shop');
  await sleep(2500);
  await install(A); await install(B);
  await ready(A); await ready(B);
  say('A hero', await qa(A, 'be', 'magician'));
  await qa(B, 'gold', 400);
  say('A picks Genesis', await qa(A, 'pick', 'genesis'));
  await sleep(800);
  await qa(A, 'clearHand');
  let landed = 0;
  for (let i = 0; i < 8; i++) { if (await qa(A, 'buy', false)) landed++; await qa(A, 'clearHand'); await sleep(150); }
  await sleep(900);
  const hatFull = await qa(A, 'snap');
  say('after 8 buys', { landed, hat: hatFull.hat, text: hatFull.text });
  await shot(A, '10-hat-8of8-active');
  await qa(B, 'clearHand');
  await sleep(300);
  await shot(B, '10-before-gilded-copy');
  say('9th buy (a minion) + burst', await burstBoth('11-gilded-send', '11-gilded-arrive', () => qa(A, 'buy', true), 2600));
  const a3 = await qa(A, 'snap'); const b3 = await qa(B, 'snap');
  say('GENESIS', { sent: a3.outbox.at(-1), Akept: a3.hand.at(-1), Bhand: b3.hand, hat: a3.hat });
  await shot(A, '12-after-gilded'); await shot(B, '12-gilded-in-hand');

  // WAR: both boards hold the same minion (QA places them).
  say('A picks War', await qa(A, 'pick', 'war'));
  await qa(A, 'clearHand'); await qa(B, 'clearHand');
  say('plain ids', await qa(A, 'plainIds'));
  // A's board is frail on purpose: it falls, so the teammate's board steps in and its copy can be read.
  say('A board', await qa(A, 'setBoard', [[1, 1, 1], [0, 3, 2]]));
  say('B board', await qa(B, 'setBoard', [[0, 7, 9], [2, 2, 30]]));
  await sleep(900);
  await shot(A, '13-war-boards'); await shot(B, '13-war-boards');
  await endTurns();
  const fa = await fightOf(A, '14-magician-war-fight');
  say('MAGICIAN WAR fight (A)', fa);
  say('MAGICIAN WAR fight (B)', await qa(B, 'fight'));
  await shot(B, '14-magician-war-fight-mid');

  // ── ROUND 3: PRIESTESS x BONDS, then B reloads mid-turn ───────────────────────────────────────────────────────────
  if (!(await toShop(3))) throw new Error('never reached the third Shop');
  await sleep(2500);
  await install(A); await install(B);
  await ready(A); await ready(B);
  say('A hero', await qa(A, 'be', 'priestess'));
  say('A picks Bonds', await qa(A, 'pick', 'bonds'));
  const b4 = await qa(B, 'snap');
  say('B at the start of turn 3 (its locked board)', brief(b4));
  say('Passaria', await qa(A, 'passaria'));
  await sleep(2500);
  const b5 = await qa(B, 'snap');
  say('B after the pass', { board: brief(b5).board, hand: brief(b5).hand, delta: [b5.board[0].attack - b4.board[0].attack, b5.board[0].health - b4.board[0].health] });
  await shot(B, '15-before-reload');
  await B.page.reload({ waitUntil: 'commit', timeout: 120000 });
  await B.page.waitForFunction(() => !!window.__bench, null, { timeout: 120000 });
  await sleep(2500);
  // Back into the party's room (the same local account: its id lives in the tab's sessionStorage).
  say('B rejoins', await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); window.__bench.store.setState({ playerName: 'Bob' }); V.openVersus('duos'); try { await V.joinRoom(id, 'player'); return 'joined'; } catch (e) { return String(e?.message ?? e); } }, roomId));
  for (let i = 0; i < 120; i++) { const s = await stateOf(B).catch(() => null); if (s && s.runMode === 'versus' && s.runPhase === 'recruit' && s.wave === 3) break; await sleep(500); }
  await sleep(8000);
  await install(B);
  const sB = await stateOf(B);
  say('B state after the reload', { runMode: sB.runMode, runPhase: sB.runPhase, wave: sB.wave, phase: sB.phase, round: sB.round, screen: sB.screen, err: sB.err });
  const b6 = await qa(B, 'snap');
  const dl = (x) => (x.board[0] ? [x.board[0].attack - b4.board[0].attack, x.board[0].health - b4.board[0].health] : null);
  say('B after the RELOAD', { board: brief(b6).board, hand: brief(b6).hand, received: b6.received, delta: dl(b6), passedCopies: b6.hand.filter((c) => c.passKey).length });
  await shot(B, '16-after-reload');
  // A second look a few seconds on: the pull's backstop has run again, and nothing was given twice.
  await sleep(6000);
  const b7 = await qa(B, 'snap');
  say('B a few seconds later', { board: brief(b7).board, delta: dl(b7), passedCopies: b7.hand.filter((c) => c.passKey).length });
  await shot(B, '17-after-reload-later');
} catch (e) {
  say('FAILED', String(e?.stack ?? e));
  await shot(A, 'zz-failed'); await shot(B, 'zz-failed');
} finally {
  out.logs = { A: A.log.slice(0, 20), B: B.log.slice(0, 20) };
  console.log('A log', JSON.stringify(out.logs.A));
  console.log('B log', JSON.stringify(out.logs.B));
  fs.writeFileSync(path.join(QA_OUT, 'ancients-duos.json'), JSON.stringify(out, null, 1));
  await b.close(); srv.close();
}
