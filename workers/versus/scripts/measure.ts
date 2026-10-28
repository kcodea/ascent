/**
 * `npm run versus:cf:measure` — Versus on Cloudflare, measured locally (spike, 2026-10-28).
 *
 * Boots the Worker in workerd (wrangler's local runtime, the same code `wrangler dev` runs), plays a 1v1 with two
 * headless players over the real protocol, and prints:
 *
 *   1. last End Turn → fight available on EVERY client (the `round` push), per round, both players ready;
 *   2. 0:00 → fight available on every client, for rounds closed by the shop timer (250 ms grace included);
 *   3. disconnect detection (socket drop → the room knows; → the match shows paused), a blip inside the grace (no
 *      pause), and reconnect → resumed state on screen;
 *   4. messages per round (both clients + the room, keep-alive pings excluded) and the in-object resolve time.
 *
 * Usage: npm run versus:cf:measure [-- --rounds 6 --timer-rounds 2]. Node 22+ (global WebSocket). Local only.
 */
import { performance } from 'node:perf_hooks';
import { CONTENT, Player, sideOf, startLocalWorker, toRoundOne } from '../test/it/driver';

const arg = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const ROUNDS = arg('rounds', 6);
const TIMER_ROUNDS = arg('timer-rounds', 2);

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { n: s.length, min: s[0]!, median: q(0.5), p90: q(0.9), max: s[s.length - 1]! };
};
const ms = (x: number) => `${x.toFixed(1)} ms`;

async function serverMetrics(base: string, roomId: string): Promise<{ msgsIn: number; msgsOut: number; bytesOut: number; resolveMs: number[]; alarms: number }> {
  return (await fetch(`${base}/rooms/${roomId}/metrics`)).json() as never;
}

async function main(): Promise<void> {
  const boot0 = performance.now();
  const worker = await startLocalWorker();
  const base = worker.url;
  const bootMs = performance.now() - boot0;
  const h0 = performance.now();
  await fetch(`${base}/health`);
  const coldMs = performance.now() - h0;
  console.log(`worker up in ${ms(bootMs)} (first request incl. engine module init: ${ms(coldMs)}), content ${CONTENT}`);

  const { a, b, roomId } = await toRoundOne(base);
  const readyLatency: number[] = [];
  const lockAnswer: number[] = [];
  const perRound: { round: number; clientOut: number; clientIn: number; serverIn: number; serverOut: number; bytesOut: number }[] = [];
  const snap = () => ({ a: { ...a.client!.stats }, b: { ...b.client!.stats } });

  // ── 1. Both ready ─────────────────────────────────────────────────────────────────────────────────────────────
  for (let round = 1; round <= ROUNDS; round++) {
    const s0 = snap();
    const m0 = await serverMetrics(base, roomId);
    const mid = a.matchId;
    // A real client streams candidates while it shops (one per board change); two each here.
    for (const p of [a, b] as Player[]) {
      const seat = p === a ? 'p1' : 'p2';
      await p.req('submit', { matchId: mid, round, seq: 1, side: sideOf(round, seat), final: false, checkpoint: null });
      await p.req('submit', { matchId: mid, round, seq: 2, side: sideOf(round, seat), final: false, checkpoint: null });
    }
    await a.req('submit', { matchId: mid, round, seq: 3, side: sideOf(round, 'p1'), final: true, checkpoint: { round } });
    const gotA = a.next((m) => m.t === 'round' && m.row.round === round);
    const gotB = b.next((m) => m.t === 'round' && m.row.round === round);
    const t = performance.now();
    const answer = b.req('submit', { matchId: mid, round, seq: 3, side: sideOf(round, 'p2'), final: true, checkpoint: { round } }).then(() => performance.now());
    const [ra, rb, ans] = await Promise.all([gotA, gotB, answer]);
    readyLatency.push(ra.at - t, rb.at - t);
    lockAnswer.push(ans - t);
    if ((a.match?.phase as string) === 'complete') { console.log(`match ended at round ${round}`); break; }
    const nextShop = Promise.all([a, b].map((p) => p.next((m) => m.t === 'match' && (m.match.round === round + 1 || m.match.phase === 'complete'))));
    await a.req('combat_ready', { matchId: mid, round });
    await b.req('combat_ready', { matchId: mid, round });
    await nextShop;
    const s1 = snap();
    const m1 = await serverMetrics(base, roomId);
    const d = (k: 'msgsOut' | 'msgsIn' | 'pings') => (s1.a[k] - s0.a[k]) + (s1.b[k] - s0.b[k]);
    perRound.push({ round, clientOut: d('msgsOut') - d('pings'), clientIn: d('msgsIn'), serverIn: m1.msgsIn - m0.msgsIn, serverOut: m1.msgsOut - m0.msgsOut, bytesOut: m1.bytesOut - m0.bytesOut });
  }

  // ── 2. Closed by the shop timer ───────────────────────────────────────────────────────────────────────────────
  const timerLatency: number[] = [];
  for (let i = 0; i < TIMER_ROUNDS && a.match?.phase === 'shop'; i++) {
    const round = Number(a.match.round);
    const mid = a.matchId;
    await a.req('submit', { matchId: mid, round, seq: 1, side: sideOf(round, 'p1'), final: true, checkpoint: null });
    await b.req('submit', { matchId: mid, round, seq: 1, side: sideOf(round, 'p2'), final: false, checkpoint: null });
    const deadline = Date.parse(String(a.match.shop_deadline));
    console.log(`  timer round ${round}: waiting ${((deadline - Date.now()) / 1000).toFixed(0)} s for 0:00 ...`);
    const [ra, rb] = await Promise.all([a, b].map((p) => p.next((m) => m.t === 'round' && m.row.round === round, 120_000)));
    timerLatency.push(ra.wall - deadline, rb.wall - deadline);
    console.log(`  timer round ${round}: fight on both clients; End Combat ...`);
    const nextShop = Promise.all([a, b].map((p) => p.next((m) => m.t === 'match' && (m.match.round === round + 1 || m.match.phase === 'complete'))));
    await a.req('combat_ready', { matchId: mid, round });
    await b.req('combat_ready', { matchId: mid, round });
    await nextShop;
  }

  // ── 3. Disconnects ────────────────────────────────────────────────────────────────────────────────────────────
  const rawWs = (p: Player) => (p.client as unknown as { ws: { close(): void } }).ws;
  console.log('  disconnects ...');
  // 3a. A blip: the socket drops and the client reconnects by itself (inside the 3 s grace: no pause).
  const blip0 = performance.now();
  const backOpen = b.next((m) => m.t === 'match');
  rawWs(b).close();
  await backOpen;
  const blipMs = performance.now() - blip0;
  await new Promise((r) => setTimeout(r, 3_500));
  const blipPaused = a.match?.paused_at != null;
  console.log(`  blip back in ${blipMs.toFixed(0)} ms; now gone for good ...`);
  // 3b. Gone for good: B's client is shut, the match pauses after the grace.
  const pausedP = a.next((m) => m.t === 'match' && m.match.paused_at != null);
  const roomSawClose = a.next((m) => m.t === 'room', 10_000).catch(() => null);
  const gone0 = performance.now();
  b.client!.close();
  const [paused, saw] = await Promise.all([pausedP, roomSawClose]);
  const detectMs = saw ? saw.at - gone0 : NaN;
  const pauseMs = paused.at - gone0;
  console.log('  paused; coming back ...');
  // 3c. B comes back: a fresh client, hello → the full state; request_resume → the 3-2-1 → playing.
  const back0 = performance.now();
  const b2 = new Player(base, b.userId, 'Claudebot2');
  await b2.connect(roomId);
  const helloMs = performance.now() - back0;
  const resumedP = a.next((m) => m.t === 'match' && m.match.paused_at == null, 10_000);
  await b2.req('request_resume', { matchId: a.matchId });
  const resumed = await resumedP;
  const resumeMs = resumed.at - back0;

  const server = await serverMetrics(base, roomId);
  await b2.req('forfeit', { matchId: a.matchId });
  a.client!.close();
  b2.client!.close();
  await worker.dispose();

  const r = stat(readyLatency);
  const tl = timerLatency.length ? stat(timerLatency) : null;
  const res = stat(server.resolveMs);
  console.log('\n== Versus on Cloudflare: local measurements (workerd via wrangler, one machine, no network RTT) ==');
  console.log(`last End Turn -> fight on every client: median ${ms(r.median)}, p90 ${ms(r.p90)}, max ${ms(r.max)} (n=${r.n})`);
  console.log(`  the locking player's own answer (already 'combat'): median ${ms(stat(lockAnswer).median)}`);
  console.log(`  resolve inside the object (simulate + digest + commit): median ${ms(res.median)}, max ${ms(res.max)} (n=${res.n})`);
  if (tl) console.log(`0:00 -> fight on every client (timer close, incl. 250 ms grace): median ${ms(tl.median)}, max ${ms(tl.max)} (n=${tl.n})`);
  console.log(`socket drop -> room shows the member gone: ${ms(detectMs)}; -> match paused: ${ms(pauseMs)} (3 s grace by design)`);
  console.log(`blip (drop + auto-reconnect inside the grace): back in ${ms(blipMs)}, paused: ${blipPaused}`);
  console.log(`reconnect -> full state (hello): ${ms(helloMs)}; -> resumed after the 3-2-1: ${ms(resumeMs)}`);
  console.log('messages per both-ready round (2 candidates + lock each, End Combat each; pings excluded):');
  for (const p of perRound) console.log(`  r${p.round}: clients sent ${p.clientOut}, received ${p.clientIn}; room in ${p.serverIn}, out ${p.serverOut} (${(p.bytesOut / 1024).toFixed(0)} KB out)`);
  console.log(`room alarms fired: ${server.alarms}`);
  console.log(JSON.stringify({ readyLatency: r, lockAnswer: stat(lockAnswer), resolve: res, timer: tl, detectMs, pauseMs, blipMs, blipPaused, helloMs, resumeMs, perRound, alarms: server.alarms }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
