/**
 * VERSUS CHAOS HARNESS: THE MATCH RUNNER (scenario -> a full match on the fake clock -> invariant violations).
 *
 * A scenario seats N `ChaosClient`s (the real store, isolated per player) in one mode, plays the match on the fake
 * clock in fixed steps, fires its chaos events when the server reaches a round/phase, records what the server and every
 * client show at every step, and returns the INVARIANT violations (an empty list = spotless):
 *
 *   close        every round's shop closes by its deadline + 2 s (Ranked Duos: its end-turn gate), and within 2 s of
 *                the last living seat's End Turn;
 *   resolve      a closed round's fight is in within 5 s (while the resolver is healthy);
 *   oneCall      exactly one resolver call per round (plus one per injected failure);
 *   stuck        no live client sits more than 10 s behind the server's phase (locked / ready / fight / back);
 *   falsePause   a pause only names a seat whose client was really gone (offline, hung, hidden past its lease);
 *   pauseLift    a pause lifts within 4 s of that player's return, with no button pressed;
 *   latePause    a player who is really gone (an absence longer than 21 s) has paused the match within 20 s of leaving
 *                (Ranked Duos never pauses: a gone seat plays on auto);
 *   vitals       after every round, every client's rail shows every seat's Health and Armor as the server has them
 *                (shop-phase changes included: Mend's Armor);
 *   fights       every client holds the same fights (digests / outcomes / damage) as the server;
 *   final        the match ends, and every client shows the server's final placements and pools;
 *   realtime     every present client is subscribed to the match's changes within 10 s (while Realtime is up);
 *   finished     the match completes inside its time cap (a full match) / reaches its round target.
 */
import { vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { rankedDuosCloseAt } from '@game/sim';
import { ChaosClient, type ChaosClientOptions, type ChaosPolicy } from './chaosClient';
import type { ChaosBackend, ServerSnap } from './chaosBackend';

export type ChaosMode = 'duel' | 'group3' | 'group4' | 'duos' | 'ranked_duos';
export const CHAOS_MODES: readonly ChaosMode[] = ['duel', 'group3', 'group4', 'duos', 'ranked_duos'];
export const playersOf = (m: ChaosMode): number => (m === 'duel' || m === 'ranked_duos' ? 2 : m === 'group3' ? 3 : 4);
const roomModeOf = (m: ChaosMode): string => (m === 'group3' || m === 'group4' ? 'group' : m);

export type InvariantId = 'close' | 'resolve' | 'oneCall' | 'stuck' | 'falsePause' | 'pauseLift' | 'latePause' | 'vitals' | 'fights' | 'final' | 'finished' | 'realtime' | 'error';
export interface Violation { id: InvariantId; at: number; round: number | null; detail: string }

export type ChaosPhase = 'hero_select' | 'shop' | 'resolving' | 'combat';
export interface ChaosEvent {
  /** Fire once the server shows this round in this phase, `afterMs` later (fake ms). */
  round: number;
  phase: ChaosPhase;
  afterMs?: number;
  act: (h: ChaosHarness) => void;
}

export interface ChaosScenario {
  name: string;
  mode: ChaosMode;
  seed: number;
  /** One per player (default: alternating buyer / empty, so someone loses every round and the match ends). */
  players?: Partial<ChaosClientOptions>[];
  events?: ChaosEvent[];
  /** Stop once this many rounds are committed (fast scenarios); omit to play the match to its end. */
  rounds?: number;
  /** Fake-time cap (ms). */
  capMs?: number;
}

/** What the scenario's chaos can do (handed to every event). */
export interface ChaosHarness {
  clients: ChaosClient[];
  /** The host under test (Supabase or Cloudflare; `chaosBackend.ts`). */
  server: ChaosBackend;
  now(): number;
  /** Network off for `ms` (the player is gone). */
  drop(i: number, ms: number): void;
  /** The tab goes to the background for `ms`. */
  background(i: number, ms: number): void;
  /** Every request from client `i` hangs for `ms` (a dead socket that comes back). */
  hang(i: number, ms: number): void;
  /** Realtime down for everyone for `ms` (0 = until the end). */
  killRealtime(ms: number): void;
  /** The resolver: slow / failing / 409 (counted against the current round). */
  resolver(chaos: { delayMs?: number; fail?: number; conflict?: number; forMs?: number }): void;
  /** Hold the match row lock for `ms`. */
  holdMatch(ms: number): void;
  /** Mark rounds whose resolver behaviour is under test (resolve / oneCall are then judged with the injected faults). */
  matchId: string | null;
}

const LEASE_MS = 12_000;
/** latePause: a gone player must have paused the match this long after leaving (Supabase: the 14 s lease and a reconcile;
 *  Cloudflare: the 15 s stale keep-alive and the 3 s grace). Judged only for absences that outlast it by a second. */
const LATE_PAUSE_MS = 20_000;
const STEP_MS = 100;


export interface ChaosResult {
  scenario: string;
  mode: ChaosMode;
  /** The match played (null when none started). */
  matchId: string | null;
  violations: Violation[];
  roundsCommitted: number;
  complete: boolean;
  fakeMs: number;
  resolverCalls: number;
  log: string[];
}

/** Real setImmediate (not faked): settle the server and the promise chains between fake-time steps. */
const realImmediate = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function runChaos(server: ChaosBackend, sc: ChaosScenario): Promise<ChaosResult> {
  await server.reset(((sc.seed % 1000) / 1000) * 2 - 1);
  const n = playersOf(sc.mode);
  const log: string[] = [];
  const violations: Violation[] = [];
  const t0 = Date.now();
  const say = (s: string): void => {
    const line = `${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`;
    log.push(line);
    // CHAOS_LOG=<file>: stream the narrative (a long matrix run is watchable while it plays).
    if (process.env.CHAOS_LOG) appendFileSync(process.env.CHAOS_LOG, `[${sc.name}/${sc.mode}] ${line}\n`);
  };
  const flag = (id: InvariantId, round: number | null, detail: string): void => {
    violations.push({ id, at: Date.now() - t0, round, detail });
    say(`VIOLATION ${id} r${round ?? '-'}: ${detail}`);
  };

  server.onNote = (s) => say(s);
  server.onResolve = (c) => say(`resolver: ${c.action} r${c.round ?? '-'} by ${names[clients.findIndex((x) => x.opts.user === c.user)] ?? '?'} -> ${c.status}${c.status !== 200 ? ` ${JSON.stringify(c.body).slice(0, 160)}` : ''}`);

  // ── the players ──
  const names = ['Ann', 'Bob', 'Cat', 'Dan'];
  const clients: ChaosClient[] = [];
  for (let i = 0; i < n; i++) {
    const p = sc.players?.[i] ?? {};
    const policy: ChaosPolicy = p.policy ?? (i % 2 === 0 ? 'buyer' : 'empty');
    const c = new ChaosClient({
      user: `00000000-0000-0000-0000-0000000000${String(i + 1).padStart(2, '0')}`, name: names[i]!, seed: sc.seed * 31 + i,
      endTurn: 'early', ...p, policy,
    }, server);
    await c.build();
    clients.push(c);
    say(`client ${names[i]} built`);
  }

  // ── gone windows (for the pause invariants) ──
  const gone: { i: number; from: number; to: number }[] = [];
  const returns: { i: number; at: number }[] = [];
  const chaosRounds = new Set<number>();
  let currentRound = 0;
  let matchId: string | null = null;
  const h: ChaosHarness = {
    clients, server, matchId: null,
    now: () => Date.now(),
    drop(i, ms) {
      const net = clients[i]!.net.state;
      net.offline = true;
      gone.push({ i, from: Date.now(), to: Date.now() + ms });
      say(`chaos: ${names[i]} offline ${ms} ms`);
      setTimeout(() => { net.offline = false; returns.push({ i, at: Date.now() }); say(`chaos: ${names[i]} back online`); }, ms);
    },
    background(i, ms) {
      const net = clients[i]!.net.state;
      net.hiddenSince = Date.now();
      // Gone only if the throttled heartbeat can miss its lease (past 5 minutes: once a minute).
      if (ms > 5 * 60_000) gone.push({ i, from: Date.now() + 5 * 60_000, to: Date.now() + ms });
      say(`chaos: ${names[i]} hidden ${ms} ms`);
      setTimeout(() => { net.hiddenSince = null; returns.push({ i, at: Date.now() }); say(`chaos: ${names[i]} visible`); }, ms);
    },
    hang(i, ms) {
      const net = clients[i]!.net.state;
      net.hangUntil = Date.now() + ms;
      if (ms >= LEASE_MS) gone.push({ i, from: Date.now(), to: Date.now() + ms });
      say(`chaos: ${names[i]} requests hang ${ms} ms`);
      setTimeout(() => returns.push({ i, at: Date.now() }), ms);
    },
    killRealtime(ms) {
      say(`chaos: ${server.killRealtime(ms)}`);
    },
    resolver(o) {
      const rc = server.resolverChaos;
      if (o.delayMs != null) rc.delayMs = o.delayMs;
      if (o.fail != null) rc.fail = o.fail;
      if (o.conflict != null) rc.conflict = o.conflict;
      chaosRounds.add(currentRound);
      say(`chaos: resolver ${JSON.stringify(o)}`);
      if (o.forMs) setTimeout(() => { rc.delayMs = 0; rc.fail = 0; rc.conflict = 0; say('chaos: resolver healthy'); }, o.forMs);
    },
    holdMatch(ms) {
      if (!matchId) return;
      server.holdMatch(matchId, ms);
      chaosRounds.add(currentRound);
      say(`chaos: match row lock held ${ms} ms`);
    },
  };
  const isGone = (i: number, t: number, slackMs = 0): boolean => gone.some((g) => g.i === i && t >= g.from - slackMs && t <= g.to + slackMs);
  const lastReturn = (i: number): number => Math.max(-Infinity, ...returns.filter((r) => r.i === i).map((r) => r.at));

  // ── seat the room (through each client's store, as the room screen does) ──
  const roomMode = roomModeOf(sc.mode);
  const step = async (ms = STEP_MS): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let k = 0; k < 400; k++) {
      await realImmediate();
      if (server.idle()) { await realImmediate(); if (server.idle()) break; }
    }
  };
  /** Run a store call while the fake clock moves (its requests wait on fake-time latency). */
  const during = async <T,>(p: Promise<T>): Promise<T> => {
    let done = false;
    void p.then(() => { done = true; }, () => { done = true; });
    for (let k = 0; k < 600 && !done; k++) await step(50);
    return p;
  };
  const roomId = await during(clients[0]!.createRoom(roomMode));
  for (const [i, c] of clients.entries()) {
    if (i > 0) await during(c.join(roomId, roomMode));
    await step(200);
  }
  if (sc.mode !== 'ranked_duos') {
    for (const [i, c] of clients.entries()) { await during(c.takeSeat(`p${i + 1}`)); await step(200); }
  }
  await step(500);
  await during(clients[0]!.start());
  say(`room ${roomId.slice(0, 8)} (${roomMode}) started`);

  // ── the loop ──
  const cap = sc.capMs ?? (sc.rounds ? 60_000 + sc.rounds * 90_000 : 45 * 60_000);
  const fired = new Set<ChaosEvent>();
  const firstSeen = new Map<string, number>(); // `${round}|${phase}` -> t
  const close = new Map<number, { deadline: number | null; allLockedAt: number | null; closedAt: number | null; ends: (number | null)[] }>();
  const resolving = new Map<number, { start: number; end: number | null }>();
  const behind = new Map<number, { since: number; flagged: boolean; why: string }>();
  const vitalsChecked = new Set<string>();
  const roundVitals = new Map<number, Record<string, { health: number; armor: number }>>();
  let pauseFlagged = false;
  /** Every pause the server started: the client it named, and when (latePause). */
  const pauseStarts: { i: number; at: number }[] = [];
  const lateJudged = new Set<number>();
  const liftFlagged = new Set<string>();
  const deafSince = new Map<string, number>();
  const railSince = new Map<string, number>();
  const railFlagged = new Set<string>();
  const deafFlagged = new Set<string>();
  let last: ServerSnap | null = null;
  let complete = false;
  let doneAt: number | null = null;

  const ranked = sc.mode === 'ranked_duos';
  const group = sc.mode !== 'duel';

  while (Date.now() - t0 < cap) {
    for (const c of clients) c.tick();
    server.sweep();
    await step();
    // The match.
    if (!matchId) {
      matchId = await server.currentMatchOf(roomId);
      if (matchId) { server.noteRoomMatch(roomId, matchId); h.matchId = matchId; say(`match ${matchId.slice(0, 8)}`); }
      continue;
    }
    const s = await server.snapshot(matchId, group);
    if (!s) continue;
    const now = Date.now();
    currentRound = s.round;
    const key = `${s.round}|${s.phase}`;
    if (!firstSeen.has(key)) {
      firstSeen.set(key, now);
      say(`server: round ${s.round} ${s.phase}${s.pausedSeat ? ` (paused ${s.pausedSeat})` : ''}`);
    }
    // Chaos events.
    for (const ev of sc.events ?? []) {
      if (fired.has(ev)) continue;
      const seen = firstSeen.get(`${ev.round}|${ev.phase}`);
      if (seen != null && now >= seen + (ev.afterMs ?? 0)) { fired.add(ev); ev.act(h); }
    }
    // REALTIME: every present client hears this match's changes (a dead channel leaves it to the 4 s heartbeat).
    for (const [i, c] of clients.entries()) {
      const k = `${c.opts.name}`;
      const present = server.realtimeUp() && !c.hidden && !c.net.state.offline && !c.net.state.realtimeDown && s.phase !== 'complete';
      if (!present || server.listening(c.opts.user, matchId)) { deafSince.delete(k); continue; }
      const since = deafSince.get(k) ?? now;
      deafSince.set(k, since);
      if (now - since > 10_000 && !deafFlagged.has(k)) {
        deafFlagged.add(k);
        flag('realtime', s.round, `${c.opts.name} has no live Realtime subscription to the match (${((now - since) / 1000).toFixed(0)} s)`);
      }
      void i;
    }
    const rc = server.resolverChaos;
    if (rc.delayMs > 0 || rc.fail > 0 || rc.conflict > 0 || server.holding(matchId)) chaosRounds.add(s.round);
    const living = s.seats.filter((x) => x.eliminated == null);
    const liveSeats = ranked ? living.filter((x) => x.seat === 'p1' || x.seat === 'p2') : living;

    // CLOSE: track the round's shop.
    if (s.phase === 'shop' && s.shopDeadline) {
      const c = close.get(s.round) ?? { deadline: null, allLockedAt: null, closedAt: null, ends: [] };
      if (!s.pausedAt) c.deadline = s.shopDeadline;
      if (liveSeats.length && liveSeats.every((x) => x.locked || x.auto) && c.allLockedAt == null && !s.pausedAt) c.allLockedAt = now;
      if (ranked) {
        // A seat's end counts only while it is locked THIS round (`locked_at` can outlive the round it was set in).
        c.ends = liveSeats.map((x) => (x.locked || x.auto ? Math.max(x.lockedAt ?? now, firstSeen.get(`${s.round}|shop`) ?? 0) : null));
      }
      close.set(s.round, c);
    }
    if (last && last.phase === 'shop' && (s.phase !== 'shop' || s.round !== last.round)) {
      const c = close.get(last.round);
      if (c && c.closedAt == null) {
        c.closedAt = now;
        const due = closeDue(c, ranked);
        // A shop that closes while the match is paused closed on everyone's locks (the clock was stopped): its deadline
        // moved by the pause, so the pre-pause one is not its due time.
        if (due != null && now > due + 2000 && !s.pausedAt && !last.pausedAt) flag('close', last.round, `shop closed ${now - due} ms after it was due (deadline ${c.deadline ? new Date(c.deadline).toISOString().slice(14, 23) : '-'}${c.allLockedAt ? ', everyone ready' : ''})`);
      }
    }
    // A shop still open well past when it was due (a round that never closes).
    if (s.phase === 'shop' && !s.pausedAt) {
      const c = close.get(s.round);
      const due = c ? closeDue(c, ranked) : null;
      if (c && c.closedAt == null && due != null && now > due + 2000 && !(c as { overdue?: boolean }).overdue) {
        (c as { overdue?: boolean }).overdue = true;
        flag('close', s.round, `shop still open ${now - due} ms after it was due`);
      }
    }
    // RESOLVE: closed -> fight in.
    if (s.phase === 'resolving' && !resolving.has(s.round)) resolving.set(s.round, { start: now, end: null });
    for (const [r, rv] of resolving) {
      if (rv.end != null) continue;
      // A pause holds the round (by design): the 5 s run from the resume.
      if (s.pausedAt) { rv.start = now; continue; }
      if ((s.round === r && (s.phase === 'combat' || s.phase === 'complete')) || s.round > r) {
        rv.end = now;
        if (!chaosRounds.has(r) && rv.end - rv.start > 5000) flag('resolve', r, `the fight took ${rv.end - rv.start} ms to land after the round closed`);
      } else if (!chaosRounds.has(r) && now - rv.start > 5000 && !(rv as { flagged?: boolean }).flagged) {
        (rv as { flagged?: boolean }).flagged = true;
        flag('resolve', r, 'the round is still resolving 5 s after it closed');
      }
    }
    // PAUSES.
    const newPause = !!s.pausedAt && s.pausedAt !== last?.pausedAt;
    if (newPause) {
      say(`server: paused on ${s.pausedSeat}`);
      const pi = clients.findIndex((c) => c.opts.user === s.seats.find((x) => x.seat === s.pausedSeat)?.user);
      if (pi >= 0) pauseStarts.push({ i: pi, at: now });
    }
    // LATE PAUSE: a player gone for longer than the bar has paused the match by the bar (unless it already ended, the
    // seat is out or on auto, another seat's pause already holds the clock, or the mode never pauses).
    if (!ranked && s.phase !== 'complete') {
      for (const [k, g] of gone.entries()) {
        if (lateJudged.has(k) || g.to - g.from <= LATE_PAUSE_MS + 1000 || now < g.from + LATE_PAUSE_MS) continue;
        lateJudged.add(k);
        const seat = s.seats.find((x) => x.user === clients[g.i]!.opts.user);
        if (!seat || seat.eliminated != null || seat.auto) continue;
        if (pauseStarts.some((p) => p.i === g.i && p.at >= g.from - 1000 && p.at <= g.from + LATE_PAUSE_MS)) continue;
        if (s.pausedSeat && s.pausedSeat !== seat.seat) continue;
        flag('latePause', s.round, `${clients[g.i]!.opts.name} has been gone ${((now - g.from) / 1000).toFixed(1)} s and the match has not paused for them`);
      }
    }
    if (!s.pausedAt && last?.pausedAt) say(`server: resumed (was paused on ${last.pausedSeat})`);
    if (s.pausedSeat && newPause && !pauseFlagged) {
      const seat = s.seats.find((x) => x.seat === s.pausedSeat);
      const i = clients.findIndex((c) => c.opts.user === seat?.user);
      if (i < 0 || !isGone(i, now, LEASE_MS + 4000)) {
        pauseFlagged = true;
        flag('falsePause', s.round, `paused on ${s.pausedSeat} (${seat?.name ?? '?'}) while that player was present`);
      }
    }
    if (s.pausedSeat) {
      const seat = s.seats.find((x) => x.seat === s.pausedSeat);
      const i = clients.findIndex((c) => c.opts.user === seat?.user);
      const back = i >= 0 ? lastReturn(i) : -Infinity;
      const k = `${i}|${back}`;
      if (i >= 0 && Number.isFinite(back) && !isGone(i, now) && now - back > 4000 && !liftFlagged.has(k)) {
        liftFlagged.add(k);
        flag('pauseLift', s.round, `${seat?.name} came back ${now - back} ms ago and the match is still paused`);
      }
    }
    // STUCK: every live, present client keeps up with the server's phase.
    for (const [i, c] of clients.entries()) {
      const seat = s.seats.find((x) => x.user === c.opts.user);
      const absentRecently = isGone(i, now, 10_000) || c.hidden || c.net.state.offline || now - lastReturn(i) < 10_000;
      if (!seat || seat.eliminated != null || s.pausedAt || absentRecently || s.phase === 'hero_select') { behind.delete(i); continue; }
      const why = lagOf(s, c.view());
      if (!why) { behind.delete(i); continue; }
      const b = behind.get(i) ?? { since: now, flagged: false, why };
      b.why = why;
      behind.set(i, b);
      if (!b.flagged && now - b.since > 10_000) {
        b.flagged = true;
        flag('stuck', s.round, `${c.opts.name}: ${why} for ${now - b.since} ms`);
      }
    }
    // VITALS: a client entering the shop of round W shows every seat as the server has it after round W-1.
    for (const c of clients) {
      const v = c.view();
      if (v.runMode !== 'versus' || v.runPhase !== 'recruit' || v.wave < 2 || v.matchId !== matchId || v.spectating) continue;
      // A player knocked out watches the rest from the stands: their screen is someone else's run.
      const mySeatRow = s.seats.find((x) => x.user === c.opts.user);
      if (!mySeatRow || (mySeatRow.eliminated != null && mySeatRow.eliminated < v.wave)) continue;
      const k = `${c.opts.name}|${v.wave}`;
      if (vitalsChecked.has(k)) continue;
      const r = v.wave - 1;
      if (!roundVitals.has(r)) {
        const got = await server.committedVitals(matchId, r, sc.mode);
        if (!got) continue;
        roundVitals.set(r, got);
      }
      vitalsChecked.add(k);
      // Either the pools the round committed, or the server's pools NOW (a shop raise, Mend, that already reached the
      // server's pool since the round opened: R-VERSUS-LIVE-ARMOR-01).
      const want = roundVitals.get(r)!;
      const live = livePools(s, sc.mode);
      const okFor = (label: string, health: number, armor: number): string | null => {
        const a = want[label];
        const b = live[label];
        if (!a && !b) return null;
        if ((a && a.health === health && a.armor === armor) || (b && b.health === health && b.armor === armor)) return null;
        return `${a ? `${a.health}/${a.armor} after round ${r}` : ''}${a && b ? ', ' : ''}${b ? `${b.health}/${b.armor} now` : ''}`;
      };
      for (const seat of v.rail) {
        const why = okFor(seat.label, seat.resolve, seat.armor);
        if (why) flag('vitals', r, `${c.opts.name}'s rail shows ${seat.label} at ${seat.resolve}/${seat.armor}, the server has ${why}`);
      }
      const mine = okFor(c.opts.name, v.resolve, v.armor);
      if (mine) flag('vitals', r, `${c.opts.name}'s own pools are ${v.resolve}/${v.armor}, the server has ${mine}`);
    }
    // LIVE VITALS: during a shop, every present client's rail catches up with the server's pools (a shop raise
    // included) within 8 s (the heartbeat's re-read is 4 s; Realtime is faster).
    if (s.phase === 'shop' && s.shopDeadline && !s.pausedAt) {
      const live = livePools(s, sc.mode);
      for (const [i, c] of clients.entries()) {
        const v = c.view();
        const k = c.opts.name;
        const present = !c.hidden && !c.net.state.offline && !isGone(i, now, 10_000);
        if (!present || v.runMode !== 'versus' || v.runPhase !== 'recruit' || v.wave !== s.round || v.spectating) { railSince.delete(k); continue; }
        const off = v.rail.find((x) => live[x.label] && (live[x.label]!.health !== x.resolve || live[x.label]!.armor !== x.armor));
        if (!off) { railSince.delete(k); continue; }
        const since = railSince.get(k) ?? now;
        railSince.set(k, since);
        const fk = `${k}|${s.round}|${off.label}`;
        if (now - since > 8000 && !railFlagged.has(fk)) {
          railFlagged.add(fk);
          flag('vitals', s.round, `${k}'s rail shows ${off.label} at ${off.resolve}/${off.armor} for ${((now - since) / 1000).toFixed(0)} s; the server's pool is ${live[off.label]!.health}/${live[off.label]!.armor}`);
        }
      }
    }

    last = s;
    // The end.
    if (s.phase === 'complete') {
      complete = true;
      doneAt ??= now;
      const settled = clients.every((c, i) => {
        const v = c.view();
        return v.runMode !== 'versus' || c.hidden || clients[i]!.net.state.offline;
      });
      if (settled || now - doneAt > 60_000) break;
    }
    if (sc.rounds && s.round > sc.rounds && s.phase === 'shop') break;
  }

  // ── after the match ──
  for (const c of clients) for (const m of c.mends) say(`${c.opts.name} cast Mend in round ${m.wave}: Armor ${m.before} -> ${m.after}`);
  say(`vitals: ${vitalsChecked.size} rail checks against the server`);
  for (const c of clients) for (const e of c.errors) flag('error', null, `${c.opts.name}: ${e}`);
  const committed = await server.committedRounds(matchId, group);
  if (!sc.rounds && !complete) flag('finished', last?.round ?? null, `the match did not finish inside ${cap / 60_000} min (server at round ${last?.round} ${last?.phase})`);
  if (sc.rounds && !complete && committed < sc.rounds) flag('finished', last?.round ?? null, `only ${committed} of ${sc.rounds} rounds committed inside ${cap / 1000} s (server at round ${last?.round} ${last?.phase}${last?.pausedSeat ? `, paused ${last.pausedSeat}` : ''})`);
  // ONE CALL per round (plus one per call the harness itself failed: an injected 500 / 409).
  const calls = new Map<number, number>();
  const allowed = new Map<number, number>();
  for (const c of server.resolverLog) {
    if (c.action === 'seat_ranked_duos' || c.round == null || c.matchId !== matchId) continue;
    calls.set(c.round, (calls.get(c.round) ?? 0) + 1);
    allowed.set(c.round, (allowed.get(c.round) ?? 1) + (c.handled ? 0 : 1));
  }
  for (const [r, k] of calls) {
    const ok = allowed.get(r) ?? 1;
    if (k > ok) flag('oneCall', r, `${k} resolver calls for the round (expected ${ok})`);
  }
  if (matchId) {
    // FIGHTS: every client holds the server's fights.
    const truth = await server.serverFights(matchId, sc.mode);
    for (const c of clients) {
      const mine = clientFights(c, sc.mode);
      for (const [r, f] of Object.entries(mine)) {
        const want = truth[Number(r)];
        if (want == null) flag('fights', Number(r), `${c.opts.name} shows a fight the server never committed`);
        else if (want !== f) flag('fights', Number(r), `${c.opts.name} shows ${f}, the server ${want}`);
      }
    }
    // FINAL: placements and pools.
    if (complete && last) {
      for (const c of clients) {
        const fin = clientFinal(c, sc.mode);
        if (!fin) continue;
        for (const seat of last.seats) {
          const mine = fin[seat.seat];
          if (!mine) continue;
          const team = last.teams.find((t) => t.team === seat.team);
          const exp = sc.mode === 'duos' || sc.mode === 'ranked_duos' ? { health: team?.health ?? seat.health, armor: team?.armor ?? seat.armor, placement: team?.placement ?? seat.placement } : seat;
          if (mine.health !== exp.health || mine.armor !== exp.armor || (mine.placement != null && exp.placement != null && mine.placement !== exp.placement)) {
            flag('final', null, `${c.opts.name} ends with ${seat.seat} at ${mine.health}/${mine.armor} #${mine.placement}, the server ${exp.health}/${exp.armor} #${exp.placement}`);
          }
        }
      }
    }
  }
  return {
    scenario: sc.name, mode: sc.mode, matchId, violations, roundsCommitted: committed, complete, fakeMs: Date.now() - t0,
    resolverCalls: server.resolverLog.filter((c) => c.matchId === matchId && c.action !== 'seat_ranked_duos').length, log,
  };
}

/** When a round's shop was due to close (ms), or null when nothing bounds it yet. */
function closeDue(c: { deadline: number | null; allLockedAt: number | null; ends: (number | null)[] }, ranked: boolean): number | null {
  if (c.allLockedAt != null) return c.allLockedAt;
  if (c.deadline == null) return null;
  // RANKED DUOS: the shared end-turn gate (the SQL twin is pinned to it by its own db test).
  if (ranked) return rankedDuosCloseAt({ deadline: c.deadline, ended: c.ends });
  return c.deadline + 250;
}

/** Why a client is behind the server right now (or null when it is where it should be). */
function lagOf(s: ServerSnap, v: ReturnType<ChaosClient['view']>): string | null {
  if (v.runMode !== 'versus') return s.phase === 'complete' ? null : `off the match screen (${v.screen}) while the server is in round ${s.round} ${s.phase}`;
  if (s.phase === 'shop' && s.shopDeadline) {
    if (v.runPhase === 'recruit' && v.wave === s.round) return null;
    return `run in ${v.runPhase} wave ${v.wave} (turn ${v.turn}) while the server's round ${s.round} shop is open`;
  }
  if (s.phase === 'resolving') return v.runPhase === 'recruit' && v.wave === s.round ? null : `run in ${v.runPhase} wave ${v.wave} while round ${s.round} resolves`;
  if (s.phase === 'combat') {
    if ((v.runPhase === 'combat' && v.wave === s.round) || (v.runPhase === 'recruit' && v.wave === s.round + 1)) return null;
    return `run in ${v.runPhase} wave ${v.wave} (turn ${v.turn}) while round ${s.round}'s fight is in`;
  }
  return null;
}

/** The server's pools right now, keyed by seat NAME (Duos / Ranked Duos: the team's pool); none before round 1 commits. */
function livePools(s: ServerSnap, mode: ChaosMode): Record<string, { health: number; armor: number }> {
  const out: Record<string, { health: number; armor: number }> = {};
  for (const seat of s.seats) {
    const team = mode === 'duos' || mode === 'ranked_duos' ? s.teams.find((t) => t.team === seat.team) : null;
    const health = team ? team.health : seat.health;
    const armor = team ? team.armor : seat.armor;
    if (health != null && armor != null) out[seat.name] = { health, armor };
  }
  return out;
}

/** The fights a client holds, in the same canonical form. */
function clientFights(c: ChaosClient, mode: ChaosMode): Record<number, string> {
  const rounds = c.store.useVersus.getState().rounds;
  const out: Record<number, string> = {};
  for (const [k, r] of Object.entries(rounds)) {
    if (mode === 'duel') { out[Number(k)] = `${r.outcome}:${r.digest}`; continue; }
    if (mode === 'ranked_duos') continue; // the Ranked Duos rounds ride a separate cache (checked through the rail)
    const fights = r.group?.fights ?? [];
    if (!fights.length) continue;
    out[Number(k)] = fights.slice().sort((a, b) => a.fight - b.fight).map((f) => `${f.a_seat}-${f.b_seat}:${f.outcome}:${f.damage}`).join(' ');
  }
  return out;
}

/** A client's last view of every seat's pools and placement (from its match row / table). */
function clientFinal(c: ChaosClient, mode: ChaosMode): Record<string, { health: number | null; armor: number | null; placement: number | null }> | null {
  const m = c.store.useVersus.getState().match;
  if (!m) return null;
  if (mode === 'duel') {
    if (m.phase !== 'complete') return null;
    return {
      p1: { health: m.p1_health ?? null, armor: m.p1_armor ?? null, placement: m.winner_seat ? (m.winner_seat === 'p1' ? 1 : 2) : null },
      p2: { health: m.p2_health ?? null, armor: m.p2_armor ?? null, placement: m.winner_seat ? (m.winner_seat === 'p2' ? 1 : 2) : null },
    };
  }
  const raw = m.group?.raw;
  if (!raw || raw.phase !== 'complete') return null;
  const out: Record<string, { health: number | null; armor: number | null; placement: number | null }> = {};
  for (const s of raw.seats) if (!s.served) out[s.seat] = { health: s.health, armor: s.armor, placement: s.placement };
  void mode;
  return out;
}
