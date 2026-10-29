// RANKED DUOS: both players press ready (End Turn) and the round must close at once (owner report 2026-10-29: "both
// players pressed ready and each said waiting on the other player, and then it eventually went through").
// Odd rounds: both press early (A at 3 s, B at 4 s). Even rounds: both wait for 0:00, then press 1 s apart (overtime).
// Logs, per client, every gem pill text and the moment the client leaves the shop.
import { sleep } from './lib.mjs';
import { clickSel } from './autopilot.mjs';
import { rankedDuos } from './setup.mjs';
const ROUNDS = Number(process.argv[2] ?? 6);
const m = await rankedDuos({ port: 4506 });
const late = (w) => w % 2 === 0;
const hold = (who) => (s) => late(s.wave) ? (s.remainingMs ?? 1) > (who === 'A' ? -500 : -1500) : Date.now() - (who === 'A' ? m.mem.A : m.mem.B).shopAt[s.wave] < (who === 'A' ? 3000 : 4000);
const log = [];
const t0 = Date.now();
let lastTip = { A: null, B: null };
const pressAt = {};
const closeAt = {};
await m.drive((sa, sb) => {
  for (const [who, s] of [['A', sa], ['B', sb]]) {
    if (s.tip !== lastTip[who]) { lastTip[who] = s.tip; log.push(`${((Date.now() - t0) / 1000).toFixed(1)} ${who} w${s.wave} ${s.runPhase}/${s.phase} tip="${s.tip}" seats ${s.locked}`); }
    const mem = m.mem[who];
    if (mem.ended === s.wave && !pressAt[`${who}${s.wave}`]) pressAt[`${who}${s.wave}`] = Date.now();
    if (s.wave && s.phase !== 'shop' && s.round === s.wave && !closeAt[`${who}${s.wave}`] && pressAt[`${who}${s.wave}`]) closeAt[`${who}${s.wave}`] = Date.now();
  }
  return sa.wave > ROUNDS || sa.phase === 'complete';
}, { capMs: 25 * 60_000, optsA: { thinkMs: 800, endMs: 0, holdEnd: hold('A') }, optsB: { thinkMs: 800, endMs: 0, holdEnd: hold('B') } });
for (const l of log) console.log(l);
for (let w = 1; w <= ROUNDS; w++) {
  const last = Math.max(pressAt[`A${w}`] ?? 0, pressAt[`B${w}`] ?? 0);
  console.log(`round ${w} (${late(w) ? 'after 0:00' : 'early'}): last press -> A sees close ${closeAt[`A${w}`] ? closeAt[`A${w}`] - last : '-'} ms, B ${closeAt[`B${w}`] ? closeAt[`B${w}`] - last : '-'} ms`);
}
console.log('A log', m.A.log.slice(0, 10)); console.log('B log', m.B.log.slice(0, 10));
await m.close();
