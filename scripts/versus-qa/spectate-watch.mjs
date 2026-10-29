// A real-browser spectator on the local Cloudflare stack: Versus 1v1 (2 players) or Versus Duos (4 players) plus one
// spectator who switches players mid-match. The spectator's page logs every change of its screen (run phase / wave /
// fight object / lobby / seat / resolve) with timestamps, plus frame times; screenshots burst around each fight's end.
//   node scripts/versus-qa/spectate-watch.mjs duel|duos [rounds]
import fs from 'node:fs';
import path from 'node:path';
import { launch, player, serveDist, shot, sleep, installRecorder, recStart, recStop, QA_OUT } from './lib.mjs';
import { step, clickSel, stateOf } from './autopilot.mjs';
const MODE = process.argv[2] ?? 'duel';
const ROUNDS = Number(process.argv[3] ?? 4);
const DIST = process.env.QA_DIST ?? 'apps/web/dist-bench-vt';
const PORT = 4507;
const srv = await serveDist(DIST, PORT);
const URL_ = `http://127.0.0.1:${PORT}/?versusHost=cf&versusCfUrl=http://127.0.0.1:8797`;
const b = await launch();
const n = MODE === 'duos' ? 4 : 2;
const names = ['Ann', 'Bob', 'Cat', 'Dan'];
const P = [];
for (let i = 0; i < n; i++) P.push(await player(b, names[i], URL_, { viewport: { width: 1280, height: 720 } }));
const S = await player(b, 'Eve', URL_, { viewport: { width: 1600, height: 900 } });
for (const p of [...P, S]) await p.page.evaluate((nm) => window.__bench.store.setState({ playerName: nm }), p.name);
await sleep(2000);
const roomId = await P[0].page.evaluate(async (mode) => {
  const V = await window.__bench.versus();
  V.openVersus('versus');
  await V.createRoom('QA room');
  if (mode === 'duos') await V.setRoomOptions({ v: 1, mode: 'duos', modifiers: [] });
  return V.useVersus.getState().room?.id;
}, MODE);
for (const [i, p] of P.entries()) {
  await p.page.evaluate(async ({ id, i }) => { const V = await window.__bench.versus(); if (i > 0) { V.openVersus('versus'); await V.joinRoom(id, 'player'); } await V.takeSeat(`p${i + 1}`); }, { id: roomId, i });
  await sleep(500);
}
await S.page.evaluate(async (id) => { const V = await window.__bench.versus(); V.openVersus('versus'); await V.joinRoom(id, 'spectator'); }, roomId);
await sleep(1000);
// The spectator's own log of its screen.
await S.page.evaluate(async () => {
  const sp = await window.__bench.spectate();
  const st = window.__bench.store;
  const log = (window.__specLog = []);
  const t0 = performance.now();
  let prev = st.getState();
  const fights = new Map();
  st.subscribe((s) => {
    const r = s.run, q = prev.run;
    if (r !== q) {
      const bits = [];
      if (r.runId !== q.runId) bits.push(`run ${String(r.runId).slice(-3)}`);
      if (r.phase !== q.phase || r.wave !== q.wave) bits.push(`${r.phase} ${r.wave}`);
      if (r.combatSettled !== q.combatSettled) bits.push(`settled ${!!r.combatSettled}`);
      if (r.resolve !== q.resolve || r.armor !== q.armor) bits.push(`hp ${r.resolve}/${r.armor}`);
      if (r.lobby !== q.lobby && r.phase === 'combat' && q.phase === 'combat') bits.push('LOBBY-REBUILT-IN-FIGHT');
      if (r.lastCombat !== q.lastCombat && r.phase === 'combat' && q.phase === 'combat' && r.wave === q.wave && r.runId === q.runId) bits.push('FIGHT-REPLACED');
      if (bits.length) log.push(`${(performance.now() - t0).toFixed(0)} ${bits.join(' ')}`);
    }
    if (s.combatReplayDone !== prev.combatReplayDone) log.push(`${(performance.now() - t0).toFixed(0)} replayDone ${s.combatReplayDone}`);
    if (s.showTitle !== prev.showTitle || s.titleView !== prev.titleView) log.push(`${(performance.now() - t0).toFixed(0)} title ${s.showTitle} ${s.titleView}`);
    prev = s;
  });
  sp.useSpectate.subscribe((x, y) => { if (x.active !== y.active || x.seat !== y.seat) log.push(`${(performance.now() - t0).toFixed(0)} spect ${x.active ? 'on' : 'off'} ${x.seat}`); });
});
await installRecorder(S);
await recStart(S);
await clickSel(P[0], 'button:has-text("Start")');
const mem = P.map(() => ({}));
const t0 = Date.now();
let switched = new Set();
let shots = 0;
let lastSpec = null;
while (Date.now() - t0 < 25 * 60_000) {
  const st = [];
  for (const [i, p] of P.entries()) st.push(await step(p, mem[i], { thinkMs: 800 + i * 300, endMs: 2500 + i * 400, watchMs: 1500, policy: i % 2 ? 'empty' : 'buyer' }));
  const ss = await stateOf(S);
  // Burst screenshots on the spectator while its fight ends and it goes back to the shop.
  const key = `${ss.runPhase}${ss.wave}`;
  if (lastSpec && lastSpec !== key && shots < 40) { for (let k = 0; k < 4; k++) { await shot(S, `spec-${MODE}-${String(shots).padStart(2, '0')}-${key}-${k}`); await sleep(120); } shots++; }
  lastSpec = key;
  // Switch: round 2 shop -> p2; round 3 fight -> p1.
  if (ss.wave === 2 && ss.runPhase === 'recruit' && !switched.has(2)) { switched.add(2); await S.page.keyboard.press('2'); }
  if (ss.wave === 3 && ss.runPhase === 'combat' && !switched.has(3)) { switched.add(3); await sleep(800); await S.page.keyboard.press('1'); }
  const done = st[0].phase === 'complete' || (st[0].wave > ROUNDS && ROUNDS > 0);
  if (done) { await sleep(15000); break; }
  await sleep(150);
}
const frames = await recStop(S);
const slog = await S.page.evaluate(() => window.__specLog);
const end = await stateOf(S);
console.log('SPECTATOR LOG\n' + slog.join('\n'));
console.log('spectator end state', JSON.stringify({ title: end.showTitle, view: end.titleView, spect: end.spect, phase: end.runPhase }));
console.log('spectator frames', JSON.stringify({ p50: frames.p50, p95: frames.p95, p99: frames.p99, max: frames.max, over33: frames.over33, cls: frames.cls, long: frames.long.length }));
console.log('spectator console', S.log.slice(0, 20));
for (const p of P) console.log(p.name, 'console', p.log.slice(0, 8));
fs.writeFileSync(path.join(QA_OUT, `spectate-${MODE}.json`), JSON.stringify({ slog, frames }, null, 1));
await b.close(); srv.close();
