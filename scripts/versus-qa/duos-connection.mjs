// RANKED DUOS, CONNECTION CASES (netcode audit 2026-11-09; fix/duos-connection). Two real browsers on the LOCAL stack
// (a bench bundle with no Supabase + `wrangler dev`), every non-local host blocked.
//
//   node scripts/versus-qa/duos-connection.mjs <cfPort> <label> [dist] [webPort]
//
// What it does, in order:
//   1. THE 3 s BLIP: in round 2, B shops, B's socket is held down for 4 s, and A presses End Turn 3.5 s into the drop.
//      Reports whether the round closed while B was down, and which board fought for B.
//   2. THE LONG DROP: B shops in round 3, then B's socket is held down for 16 s. Screenshots B's status strip
//      ("Reconnecting", "Connection lost"). At 13.5 s (B is away) A presses End Turn: reports which board fought for B.
//   3. A SECOND TAB: the same account opens the game again. Screenshots the first tab's "Open somewhere else" panel,
//      presses "Play here", then "Back to menu" on the tab that lost the game.
//
// The socket is dropped from inside the page: the page's WebSocket is wrapped so every open socket can be closed and
// new ones refused for a while (a clean drop, then no network), which is what a wifi hiccup looks like to the client.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { QA_OUT, serveDist, sleep } from './lib.mjs';
import { clickSel, shopTurn, stateOf, step } from './autopilot.mjs';

const CF = Number(process.argv[2] ?? 8803);
const LABEL = process.argv[3] ?? 'after';
const DIST = process.argv[4] ?? 'apps/web/dist-bench';
const WEB = Number(process.argv[5] ?? 4511);
const SHOTS = path.join(QA_OUT, 'shots');
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

const NET_HOOK = () => {
  const Real = window.WebSocket;
  const socks = [];
  function Hooked(url, protocols) {
    // "No network": a socket to a closed local port fails at once, as an offline connect does.
    const ws = window.__netDown ? new Real('ws://127.0.0.1:9/') : new Real(url, protocols);
    if (!window.__netDown) socks.push(ws);
    return ws;
  }
  Hooked.prototype = Real.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Hooked[k] = Real[k];
  window.WebSocket = Hooked;
  window.__drop = (ms) => {
    window.__netDown = true;
    for (const s of socks.splice(0)) { try { s.close(); } catch { /* gone */ } }
    setTimeout(() => { window.__netDown = false; }, ms);
  };
  try { localStorage.setItem('ascent.versus', '1'); localStorage.setItem('ascent.ftue.done', '1'); } catch { /* */ }
};

async function tab(ctx, name, url) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => !!window.__bench, null, { timeout: 120000 });
  return { name, ctx, page, log: errs };
}
async function player(browser, name, url) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(NET_HOOK);
  return tab(ctx, name, url);
}
const shot = async (p, label) => { const f = path.join(SHOTS, `conn-${LABEL}-${label}.png`); await p.page.screenshot({ path: f }).catch(() => undefined); log('shot', f); return f; };
const strip = (p) => p.page.evaluate(() => ({
  strip: document.querySelector('.vslink')?.textContent ?? null,
  panel: document.querySelector('.vslink-veil .vspanel')?.textContent ?? null,
}));
/** B's board as its own run holds it, and what the room says of the match. */
const facts = (p) => p.page.evaluate(async () => {
  const V = await window.__bench.versus();
  const g = window.__bench.store.getState();
  const m = V.useVersus.getState().match;
  const raw = m?.group?.raw;
  const lc = g.run.lastCombat;
  return {
    phase: m?.phase ?? null, round: m?.round ?? null, wave: g.run.wave, runPhase: g.run.phase,
    board: g.run.board.map((c) => c.cardId), seats: (raw?.seats ?? []).map((s) => `${s.seat}:${s.locked ? 'L' : '-'}${s.auto ? 'A' : '-'}`).join(' '),
    // The fight my run last played: which teammate I am in it, and both teammates' boards as they fought.
    duosMember: lc?.duosMember ?? null,
    duosBoards: lc?.duosBoards ? JSON.stringify(lc.duosBoards, (k, v) => (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'cardId' in v[0] ? v.map((x) => x.cardId) : v)).slice(0, 500) : null,
  };
});

fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serveDist(DIST, WEB);
const URL_ = `http://127.0.0.1:${WEB}/?versusHost=cf&versusCfUrl=http://127.0.0.1:${CF}`;
// Every non-local host is unreachable (the bench bundle would otherwise call the live hub).
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--use-angle=d3d11',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
const out = { label: LABEL, cf: CF };
try {
  const A = await player(browser, 'A', URL_);
  const B = await player(browser, 'B', URL_);
  for (const [p, n] of [[A, 'Claudebot1'], [B, 'Claudebot2']]) await p.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), n);
  await sleep(2500);
  const roomId = await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.enterDuosParty('Claudebot1'); return V.useVersus.getState().room?.id; });
  await B.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId);
  await sleep(1500);
  await A.page.evaluate(async () => { const V = await window.__bench.versus(); await V.startGame(); }); // the host's Start
  log('party started', roomId);
  const mem = { A: {}, B: {} };
  const hold = { A: false, B: false };
  const opts = (who) => ({ thinkMs: 900, endMs: 4000, holdEnd: () => hold[who] });
  const drive = async (until, capMs = 6 * 60_000) => {
    const t0 = Date.now();
    for (;;) {
      const sa = await step(A, mem.A, opts('A'));
      const sb = await step(B, mem.B, opts('B'));
      if (await until(sa, sb)) return { sa, sb };
      if (Date.now() - t0 > capMs) throw new Error(`drive cap: A ${JSON.stringify(sa)} B ${JSON.stringify(sb)}`);
      await sleep(200);
    }
  };
  // Round 1 plays normally; round 2 is held open (nobody presses End Turn by the autopilot).
  await drive((sa) => sa.runPhase === 'recruit' && sa.phase === 'shop' && sa.wave === 1 && sa.round === 1);
  log('round 1 shop');
  await drive((sa, sb) => { if (sa.wave >= 2) hold.A = hold.B = true; return sa.wave === 2 && sb.wave === 2 && sa.runPhase === 'recruit' && sb.runPhase === 'recruit' && sa.phase === 'shop' && sa.round === 2 && mem.A.acted === 2 && mem.B.acted === 2; });
  await shopTurn(B, 'buyer');
  await sleep(1500); // B's candidate goes up at idle (at most 600 ms)
  out.beforeBlip = await facts(B);
  log('round 2, both shopped. B', JSON.stringify(out.beforeBlip));

  // ── 1. THE 3 s BLIP ──
  await B.page.evaluate(() => window.__drop(4000));
  const tDrop = Date.now();
  await sleep(2000);
  out.blipStripAt2s = await strip(B);
  await shot(B, 'blip-2s-B');
  await sleep(1500); // 3.5 s into the drop: past the room's 3 s socket grace
  out.seatsAt3_5s = (await facts(A)).seats;
  await clickSel(A, '.etbwrap'); // the present teammate ends the turn
  log('A pressed End Turn at', Date.now() - tDrop, 'ms into the drop; seats', out.seatsAt3_5s);
  await sleep(1200);
  const a1 = await facts(A);
  out.closedWhileDown = a1.phase !== 'shop';
  out.afterPress = { phase: a1.phase, seats: a1.seats };
  log('1.2 s later: phase', a1.phase, 'seats', a1.seats, '=> closed while B was down:', out.closedWhileDown);
  await sleep(2500); // B is back
  out.blipStripBack = await strip(B);
  if (!out.closedWhileDown) {
    // B kept its turn: one more buy, then End Turn. The fight must use B's final board.
    await shopTurn(B, 'buyer');
    await sleep(800);
    out.bFinal = (await facts(B)).board;
    hold.B = false;
    await clickSel(B, '.etbwrap');
  }
  const t1 = Date.now();
  for (;;) { const f = await facts(B); if (f.runPhase === 'combat' || f.phase === 'combat' || Date.now() - t1 > 40_000) break; await sleep(300); }
  await sleep(1500);
  out.fight = await facts(B);
  log('fight: B', JSON.stringify(out.fight));
  hold.A = hold.B = false;

  // ── 2. THE LONG DROP (round 3 shop) ──
  await drive((sa, sb) => { if (sa.wave >= 3) hold.A = hold.B = true; return sa.wave === 3 && sb.wave === 3 && sa.runPhase === 'recruit' && sb.runPhase === 'recruit' && sa.phase === 'shop' && sa.round === 3 && mem.A.acted === 3 && mem.B.acted === 3; });
  await shopTurn(B, 'buyer');
  await sleep(1500); // B's round 3 candidate is with the room
  out.beforeLongDrop = await facts(B);
  log('round 3, B shopped:', JSON.stringify(out.beforeLongDrop.board));
  await B.page.evaluate(() => window.__drop(16000));
  const tLong = Date.now();
  await sleep(1000);
  out.long1s = await strip(B);
  await sleep(1500);
  out.long2_5s = await strip(B);
  await shot(B, 'reconnecting-B');
  await B.page.setViewportSize({ width: 844, height: 390 });
  await sleep(400);
  await shot(B, 'reconnecting-B-phone');
  await B.page.setViewportSize({ width: 1600, height: 900 });
  await sleep(4000);
  out.seatsAt7s = (await facts(A)).seats;
  await sleep(6500); // 13.5 s
  out.long13s = await strip(B);
  out.seatsAt13s = (await facts(A)).seats;
  await shot(B, 'lost-B');
  await shot(A, 'lost-teammate-view-A');
  log('long drop: 1 s', JSON.stringify(out.long1s), '2.5 s', JSON.stringify(out.long2_5s), '13.5 s', JSON.stringify(out.long13s), 'seats 7 s', out.seatsAt7s, '13.5 s', out.seatsAt13s);
  // B is away: the present teammate ends the turn. Which board does the room field for B?
  await clickSel(A, '.etbwrap');
  const t3 = Date.now();
  for (;;) { const f = await facts(A); if (f.runPhase === 'combat' || Date.now() - t3 > 20_000) break; await sleep(300); }
  await sleep(800);
  out.awayFight = await facts(A);
  log('B away, A ended the turn. B had', JSON.stringify(out.beforeLongDrop.board), 'the fight (as A saw it) fielded', out.awayFight.duosBoards);
  hold.A = hold.B = false;
  await sleep(Math.max(0, 16000 - (Date.now() - tLong)) + 2500);
  out.longBack = await strip(B);
  out.seatsBack = (await facts(A)).seats;
  log('back:', JSON.stringify(out.longBack), 'seats', out.seatsBack);

  // ── 3. A SECOND TAB, SAME ACCOUNT ──
  const devUser = await B.page.evaluate(() => sessionStorage.getItem('ascent.versusCfDevUser'));
  await B.ctx.addInitScript((id) => { try { sessionStorage.setItem('ascent.versusCfDevUser', id); } catch { /* */ } }, devUser);
  const B2 = await tab(B.ctx, 'B2', URL_);
  await B2.page.evaluate((n) => window.__bench.store.setState({ playerName: n }), 'Claudebot2');
  await B2.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('duos'); await V.joinRoom(id, 'player'); }, roomId).catch((e) => log('B2 join:', e.message));
  await sleep(2500);
  out.replacedFirstTab = await strip(B);
  await shot(B, 'elsewhere-B');
  log('second tab open. first tab:', JSON.stringify(out.replacedFirstTab));
  const t2 = Date.now();
  await sleep(3000);
  out.firstTabStillOnly = await B.page.evaluate(() => document.querySelectorAll('.vslink-veil').length);
  await clickSel(B, '.vslink-veil button:has-text("Play here")');
  await sleep(2500);
  out.afterPlayHere = { first: await strip(B), second: await strip(B2) };
  await shot(B2, 'elsewhere-B2');
  log('Play here pressed', Date.now() - t2, 'ms after. first tab', JSON.stringify(out.afterPlayHere.first), 'second tab', JSON.stringify(out.afterPlayHere.second));
  await clickSel(B2, '.vslink-veil button:has-text("Back to menu")');
  await sleep(1500);
  out.afterBackToMenu = { second: await strip(B2), secondState: await B2.page.evaluate(async () => { const V = await window.__bench.versus(); const g = window.__bench.store.getState(); return { room: !!V.useVersus.getState().room, showTitle: g.showTitle, titleView: g.titleView }; }),
    firstStillIn: (await stateOf(B)).phase, seats: (await facts(A)).seats };
  await shot(B2, 'back-to-menu-B2');
  log('Back to menu:', JSON.stringify(out.afterBackToMenu));
  out.errors = { A: A.log.slice(0, 5), B: B.log.slice(0, 5), B2: B2.log.slice(0, 5) };
} catch (e) {
  out.error = String(e?.stack ?? e);
  log('FAILED', out.error);
} finally {
  fs.writeFileSync(path.join(QA_OUT, `duos-connection-${LABEL}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  srv.close();
}
