// VERSUS DUOS pass latency (player report 2026-11-02: "it took like 8 seconds before it showed up in my hand"). Two real
// browsers on the local Cloudflare stack (Ranked Duos party: the same pass channel as Versus Duos). A passes a card to B
// in each shop; every hop is timestamped on one clock (same machine):
//   click (A dispatches passCard) -> A's socket sends duos_pass -> A's answer -> B's socket gets the `pass` push
//   -> B's socket sends duos_passes (the pull) -> B's answer -> the card is in B's hand.
// Scenario per round: odd rounds B is on its own screen, even rounds B is WATCHING A ("View teammate") when the pass
// is sent and comes back to its own screen 1 s later (the report: "i watched you send over roomworks").
//   node scripts/versus-qa/pass-latency.mjs [--rounds 4] [--dist apps/web/dist-bench]
import { launch, serveDist, sleep } from './lib.mjs';
import { step, clickSel } from './autopilot.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg('rounds', '4'));
const DIST = arg('dist', 'apps/web/dist-bench');
const PORT = Number(arg('port', '4511'));
const srv = await serveDist(DIST, PORT);
const URL_ = `http://127.0.0.1:${PORT}/?versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
const b = await launch();

/** Every socket frame that names a pass, with its wall-clock time. */
const wsTap = () => {
  window.__passLog = [];
  const Real = window.WebSocket;
  const note = (dir, data) => {
    if (typeof data !== 'string') return;
    if (/duos_pass|"t":"pass"|duos_hand_room/.test(data) || (dir === 'in' && /"ok"/.test(data) && window.__passWatch?.has(Number((/"id":(\d+)/.exec(data) || [])[1])))) {
      const op = (/"op":"([a-z_]+)"/.exec(data) || [])[1] ?? (/"t":"([a-z]+)"/.exec(data) || [])[1] ?? 'answer';
      const id = Number((/"id":(\d+)/.exec(data) || [])[1]);
      if (dir === 'out' && Number.isFinite(id)) (window.__passWatch ??= new Set()).add(id);
      window.__passLog.push({ at: Date.now(), dir, op, id: Number.isFinite(id) ? id : null, len: data.length });
    }
  };
  class Tapped extends Real {
    constructor(...a) { super(...a); this.addEventListener('message', (e) => note('in', e.data)); }
    send(d) { note('out', d); return super.send(d); }
  }
  window.WebSocket = Tapped;
};

async function player(name) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ascent.versus', '1'); localStorage.setItem('ascent.ftue.done', '1'); } catch {} });
  await ctx.addInitScript(wsTap);
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${Date.now()} ${m.type()}: ${m.text().slice(0, 300)}`); });
  await page.goto(URL_, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__bench, null, { timeout: 120000 });
  return { name, ctx, page, log };
}
const A = await player('A');
const B = await player('B');
for (const [p, n] of [[A, 'Ann'], [B, 'Bob']]) await p.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), n);
await sleep(2500);
const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Ann'); return V.useVersus.getState().room?.id; });
await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
await sleep(1500);
await clickSel(A, 'button:has-text("Start game")');

// B watches its own run: the moment a new pass key is in its `duos.received` (its own run only: while it watches its
// teammate the store holds the teammate's synthetic run, which is skipped).
await B.page.evaluate(() => {
  window.__arrivals = [];
  const st = window.__bench.store;
  let had = null;
  st.subscribe((s) => {
    if (String(s.run.runId).startsWith('spectate:') || !s.run.duos) return;
    const now = new Set(s.run.duos.received);
    if (had) for (const k of now) if (!had.has(k)) window.__arrivals.push({ at: Date.now(), key: k });
    had = now;
  });
});

const mem = { A: {}, B: {} };
const results = [];
const t0 = Date.now();
const passed = new Set();
while (Date.now() - t0 < 12 * 60_000) {
  const sa = await step(A, mem.A, { thinkMs: 1200, endMs: 14000, policy: 'empty' });
  const sb = await step(B, mem.B, { thinkMs: 800, endMs: 14000, policy: 'empty' });
  if (sa.runMode === 'versus' && sa.runPhase === 'recruit' && sa.phase === 'shop' && sa.round === sa.wave && !passed.has(sa.wave)
    && sb.runMode === 'versus' && sb.runPhase === 'recruit' && mem.A.shopAt?.[sa.wave] && Date.now() - mem.A.shopAt[sa.wave] > 2000) {
    passed.add(sa.wave);
    const watching = sa.wave % 2 === 0;
    if (watching) {
      await clickSel(B, '.duosdock-hold[role="button"]');
      await sleep(1500);
    }
    const sB = await B.page.evaluate(async () => !!(await window.__bench.spectate()).useSpectate.getState().teammate);
    // A buys one card (if its hand is empty) and passes it.
    const sent = await A.page.evaluate(async () => {
      const sim = await window.__bench.sim();
      const st = window.__bench.store;
      let run = st.getState().run;
      if (!run.hand.length) {
        const o = run.shop.find((x) => sim.offerBuyPrice(run, x).cost <= run.embers - 1);
        if (o) st.getState().dispatch({ type: 'buy', uid: o.uid });
        run = st.getState().run;
      }
      const c = run.hand[0];
      if (!c) return null;
      window.__passLog.length = 0;
      const at = Date.now();
      st.getState().dispatch({ type: 'passCard', uid: c.uid });
      const left = !st.getState().run.hand.some((h) => h.uid === c.uid);
      return { at, cardId: c.cardId, left };
    });
    await B.page.evaluate(() => { window.__passLog.length = 0; window.__arrivals.length = 0; });
    if (!sent || !sent.left) { console.log(`r${sa.wave}: no pass sent`, JSON.stringify(sent)); continue; }
    let backAt = null;
    // Wait up to 20 s for the arrival (leaving the teammate view after 1 s in the watching case).
    for (let i = 0; i < 200; i++) {
      if (watching && backAt == null && Date.now() - sent.at > 1000) { await clickSel(B, '.duosdock[role="button"]'); backAt = Date.now(); }
      const got = await B.page.evaluate(() => window.__arrivals.length);
      if (got) break;
      await sleep(100);
    }
    const aLog = await A.page.evaluate(() => window.__passLog);
    const bLog = await B.page.evaluate(() => window.__passLog);
    const arr = await B.page.evaluate(() => window.__arrivals[0] ?? null);
    const rel = (x) => (x == null ? null : x - sent.at);
    const row = {
      round: sa.wave, bWatching: sB, cardId: sent.cardId,
      aSend: rel(aLog.find((e) => e.dir === 'out' && e.op === 'duos_pass')?.at),
      aAnswer: rel(aLog.find((e) => e.dir === 'in' && e.op === 'res')?.at),
      bPush: rel(bLog.find((e) => e.dir === 'in' && e.op === 'pass')?.at),
      bPull: rel(bLog.find((e) => e.dir === 'out' && e.op === 'duos_passes')?.at),
      bBackOwn: rel(backAt),
      bInHand: rel(arr?.at),
    };
    results.push(row);
    console.log(`r${row.round} ${watching ? 'WATCHING' : 'own screen'}: ${JSON.stringify(row)}`);
    console.log('   B frames', JSON.stringify(bLog.map((e) => [e.at - sent.at, e.dir, e.op])));
  }
  if (sa.wave > ROUNDS || sa.phase === 'complete') break;
  await sleep(150);
}
console.log('SUMMARY', JSON.stringify(results));
console.log('A log', A.log.slice(0, 10));
console.log('B log', B.log.slice(0, 10));
await b.close(); srv.close();
