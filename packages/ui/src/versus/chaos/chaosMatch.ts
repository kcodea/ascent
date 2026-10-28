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
 *   vitals       after every round, every client's rail shows every seat's Health and Armor as the server has them
 *                (shop-phase changes included: Mend's Armor);
 *   fights       every client holds the same fights (digests / outcomes / damage) as the server;
 *   final        the match ends, and every client shows the server's final placements and pools;
 *   realtime     every present client is subscribed to the match's changes within 10 s (while Realtime is up);
 *   finished     the match completes inside its time cap (a full match) / reaches its round target.
 */
import { vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import { RANKED_DUOS_END_GRACE_MS, RANKED_DUOS_OVERTIME_BACKSTOP_MS } from '@game/sim';
import { ChaosClient, type ChaosClientOptions, type ChaosPolicy } from './chaosClient';
import type { ChaosServer } from './chaosServer';
import { RealtimeBus } from './fakeSupabase';

export type ChaosMode = 'duel' | 'group3' | 'group4' | 'duos' | 'ranked_duos';
export const CHAOS_MODES: readonly ChaosMode[] = ['duel', 'group3', 'group4', 'duos', 'ranked_duos'];
export const playersOf = (m: ChaosMode): number => (m === 'duel' || m === 'ranked_duos' ? 2 : m === 'group3' ? 3 : 4);
const roomModeOf = (m: ChaosMode): string => (m === 'group3' || m === 'group4' ? 'group' : m);

export type InvariantId = 'close' | 'resolve' | 'oneCall' | 'stuck' | 'falsePause' | 'pauseLift' | 'vitals' | 'fights' | 'final' | 'finished' | 'realtime' | 'error';
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
  server: ChaosServer;
  bus: RealtimeBus;
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
const STEP_MS = 100;

interface ServerSnap {
  t: number;
  phase: string;
  round: number;
  revision: number;
  shopDeadline: number | null;
  pausedSeat: string | null;
  pausedAt: string | null;
  resumeAt: string | null;
  seats: { seat: string; user: string; name: string; locked: boolean; lockedAt: number | null; health: number | null; armor: number | null; placement: number | null; eliminated: number | null; team: string | null; auto: boolean }[];
  teams: { team: string; health: number | null; armor: number | null; placement: number | null; eliminated: number | null }[];
}

export interface ChaosResult {
  scenario: string;
  mode: ChaosMode;
  violations: Violation[];
  roundsCommitted: number;
  complete: boolean;
  fakeMs: number;
  resolverCalls: number;
  log: string[];
}

/** Real setImmediate (not faked): settle the server and the promise chains between fake-time steps. */
const realImmediate = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function runChaos(server: ChaosServer, sc: ChaosScenario): Promise<ChaosResult> {
  await server.reset();
  const bus = new RealtimeBus();
  server.onChanges = (c) => bus.changes(c);
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
    }, server, bus);
    await c.build();
    clients.push(c);
    say(`client ${names[i]} built`);
  }

  // ── gone windows (for the pause invariants) ──
  const gone: { i: number; from: number; to: number }[] = [];
  const returns: { i: number; at: number }[] = [];
  const chaosRounds = new Set<number>();
  const injected = new Map<number, number>(); // round -> injected resolver faults
  let currentRound = 0;
  let matchId: string | null = null;
  const h: ChaosHarness = {
    clients, server, bus, matchId: null,
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
      bus.enabled = false;
      say(`chaos: realtime down${ms ? ` ${ms} ms` : ''}`);
      if (ms) setTimeout(() => { bus.enabled = true; say('chaos: realtime back'); }, ms);
    },
    resolver(o) {
      const rc = server.resolverChaos;
      if (o.delayMs != null) rc.delayMs = o.delayMs;
      if (o.fail != null) rc.fail = o.fail;
      if (o.conflict != null) rc.conflict = o.conflict;
      chaosRounds.add(currentRound);
      injected.set(currentRound, (injected.get(currentRound) ?? 0) + (o.fail ?? 0) + (o.conflict ?? 0));
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
  const close = new Map<number, { deadline: number | null; allLockedAt: number | null; closedAt: number | null; anyEndedAt: number | null }>();
  const resolving = new Map<number, { start: number; end: number | null }>();
  const behind = new Map<number, { since: number; flagged: boolean; why: string }>();
  const vitalsChecked = new Set<string>();
  const roundVitals = new Map<number, Record<string, { health: number; armor: number }>>();
  let pauseFlagged = false;
  const liftFlagged = new Set<string>();
  const deafSince = new Map<string, number>();
  const deafFlagged = new Set<string>();
  let last: ServerSnap | null = null;
  let complete = false;
  let doneAt: number | null = null;

  const ranked = sc.mode === 'ranked_duos';
  const group = sc.mode !== 'duel';

  while (Date.now() - t0 < cap) {
    for (const c of clients) c.tick();
    await step();
    // The match.
    if (!matchId) {
      const r = (await server.admin<{ current_match_id: string | null }>('select current_match_id from public.versus_rooms where id = $1', [roomId]))[0];
      matchId = r?.current_match_id ?? null;
      if (matchId) { server.roomOfMatch.set(roomId, matchId); h.matchId = matchId; say(`match ${matchId.slice(0, 8)}`); }
      continue;
    }
    const s = await snapshot(server, matchId, group);
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
      const present = bus.enabled && !c.hidden && !c.net.state.offline && !c.net.state.realtimeDown && s.phase !== 'complete';
      if (!present || bus.listening(c.opts.user, matchId)) { deafSince.delete(k); continue; }
      const since = deafSince.get(k) ?? now;
      deafSince.set(k, since);
      if (now - since > 10_000 && !deafFlagged.has(k)) {
        deafFlagged.add(k);
        flag('realtime', s.round, `${c.opts.name} has no live Realtime subscription to the match (${((now - since) / 1000).toFixed(0)} s)`);
      }
      void i;
    }
    const living = s.seats.filter((x) => x.eliminated == null);
    const liveSeats = ranked ? living.filter((x) => x.seat === 'p1' || x.seat === 'p2') : living;

    // CLOSE: track the round's shop.
    if (s.phase === 'shop' && s.shopDeadline) {
      const c = close.get(s.round) ?? { deadline: null, allLockedAt: null, closedAt: null, anyEndedAt: null };
      if (!s.pausedAt) c.deadline = s.shopDeadline;
      if (liveSeats.length && liveSeats.every((x) => x.locked || x.auto) && c.allLockedAt == null && !s.pausedAt) c.allLockedAt = now;
      if (ranked) {
        const ends = liveSeats.map((x) => x.lockedAt).filter((x): x is number => x != null);
        if (ends.length) c.anyEndedAt = Math.min(...ends);
      }
      close.set(s.round, c);
    }
    if (last && last.phase === 'shop' && (s.phase !== 'shop' || s.round !== last.round)) {
      const c = close.get(last.round);
      if (c && c.closedAt == null) {
        c.closedAt = now;
        const due = closeDue(c, ranked);
        if (due != null && now > due + 2000) flag('close', last.round, `shop closed ${now - due} ms after it was due (deadline ${c.deadline ? new Date(c.deadline).toISOString().slice(14, 23) : '-'}${c.allLockedAt ? ', everyone ready' : ''})`);
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
      if ((s.round === r && (s.phase === 'combat' || s.phase === 'complete')) || s.round > r) {
        rv.end = now;
        if (!chaosRounds.has(r) && rv.end - rv.start > 5000) flag('resolve', r, `the fight took ${rv.end - rv.start} ms to land after the round closed`);
      } else if (!chaosRounds.has(r) && now - rv.start > 5000 && !(rv as { flagged?: boolean }).flagged) {
        (rv as { flagged?: boolean }).flagged = true;
        flag('resolve', r, 'the round is still resolving 5 s after it closed');
      }
    }
    // PAUSES.
    if (s.pausedSeat && !pauseFlagged) {
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
        const got = await committedVitals(server, matchId, r, sc.mode);
        if (!got) continue;
        roundVitals.set(r, got);
      }
      vitalsChecked.add(k);
      const want = roundVitals.get(r)!;
      for (const seat of v.rail) {
        const exp = want[seat.label];
        if (!exp) continue;
        if (exp.health !== seat.resolve || exp.armor !== seat.armor) {
          flag('vitals', r, `${c.opts.name}'s rail shows ${seat.label} at ${seat.resolve}/${seat.armor}, the server has ${exp.health}/${exp.armor}`);
        }
      }
      const mine = want[c.opts.name];
      if (mine && (mine.health !== v.resolve || mine.armor !== v.armor)) flag('vitals', r, `${c.opts.name}'s own pools are ${v.resolve}/${v.armor}, the server has ${mine.health}/${mine.armor}`);
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
  for (const c of clients) for (const e of c.errors) flag('error', null, `${c.opts.name}: ${e}`);
  const committed = await committedRounds(server, matchId, group);
  if (!sc.rounds && !complete) flag('finished', last?.round ?? null, `the match did not finish inside ${cap / 60_000} min (server at round ${last?.round} ${last?.phase})`);
  if (sc.rounds && committed < sc.rounds) flag('finished', last?.round ?? null, `only ${committed} of ${sc.rounds} rounds committed inside ${cap / 1000} s (server at round ${last?.round} ${last?.phase}${last?.pausedSeat ? `, paused ${last.pausedSeat}` : ''})`);
  // ONE CALL per round.
  const calls = new Map<number, number>();
  for (const c of server.resolverLog) if (c.action !== 'seat_ranked_duos' && c.round != null && c.matchId === matchId) calls.set(c.round, (calls.get(c.round) ?? 0) + 1);
  for (const [r, k] of calls) {
    const allowed = 1 + (injected.get(r) ?? 0);
    if (k > allowed) flag('oneCall', r, `${k} resolver calls for the round (expected ${allowed})`);
  }
  if (matchId) {
    // FIGHTS: every client holds the server's fights.
    const truth = await serverFights(server, matchId, sc.mode);
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
    scenario: sc.name, mode: sc.mode, violations, roundsCommitted: committed, complete, fakeMs: Date.now() - t0,
    resolverCalls: server.resolverLog.filter((c) => c.matchId === matchId && c.action !== 'seat_ranked_duos').length, log,
  };
}

/** When a round's shop was due to close (ms), or null when nothing bounds it yet. */
function closeDue(c: { deadline: number | null; allLockedAt: number | null; anyEndedAt: number | null }, ranked: boolean): number | null {
  if (c.allLockedAt != null) return c.allLockedAt;
  if (c.deadline == null) return null;
  if (ranked) return c.anyEndedAt != null ? Math.max(c.deadline, c.anyEndedAt) + RANKED_DUOS_END_GRACE_MS : c.deadline + RANKED_DUOS_OVERTIME_BACKSTOP_MS;
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

async function snapshot(server: ChaosServer, matchId: string, group: boolean): Promise<ServerSnap | null> {
  const t = Date.now();
  const ms = (x: unknown): number | null => (x == null ? null : Date.parse(String(x)));
  if (!group) {
    const m = (await server.admin<any>('select * from public.versus_matches where id = $1', [matchId]))[0];
    if (!m) return null;
    return {
      t, phase: m.phase, round: m.round, revision: m.revision, shopDeadline: ms(m.shop_deadline), pausedSeat: m.paused_seat, pausedAt: m.paused_at, resumeAt: m.resume_at ?? null,
      seats: (['p1', 'p2'] as const).map((p) => ({
        seat: p, user: m[`${p}_user`], name: m[`${p}_name`], locked: !!m[`${p}_locked`], lockedAt: null, health: m[`${p}_health`], armor: m[`${p}_armor`],
        placement: m.phase === 'complete' ? (m.winner_seat === p ? 1 : 2) : null, eliminated: null, team: null, auto: !!m[`${p}_auto`],
      })),
      teams: [],
    };
  }
  const m = (await server.admin<any>('select * from public.versus_group_matches where id = $1', [matchId]))[0];
  if (!m) return null;
  const seats = await server.admin<any>('select * from public.versus_group_seats where match_id = $1 order by seat', [matchId]);
  const teams = await server.admin<any>('select * from public.versus_group_teams where match_id = $1 order by team', [matchId]);
  return {
    t, phase: m.phase, round: m.round, revision: m.revision, shopDeadline: ms(m.shop_deadline), pausedSeat: m.paused_seat, pausedAt: m.paused_at, resumeAt: m.resume_at ?? null,
    seats: seats.map((x) => ({
      seat: x.seat, user: x.user_id, name: x.name, locked: !!x.locked, lockedAt: ms(x.locked_at), health: x.health, armor: x.armor, placement: x.placement,
      eliminated: x.eliminated_round, team: x.team ?? null, auto: !!x.auto,
    })),
    teams: teams.map((x) => ({ team: x.team, health: x.health ?? null, armor: x.armor ?? null, placement: x.placement, eliminated: x.eliminated_round })),
  };
}

/** Every seat's pools after round `r`, keyed by the seat's NAME (the rail's label), or null before it is committed. */
async function committedVitals(server: ChaosServer, matchId: string, r: number, mode: ChaosMode): Promise<Record<string, { health: number; armor: number }> | null> {
  if (mode === 'duel') {
    const row = (await server.admin<any>('select * from public.versus_rounds where match_id = $1 and round = $2', [matchId, r]))[0];
    const m = (await server.admin<any>('select p1_name, p2_name from public.versus_matches where id = $1', [matchId]))[0];
    if (!row || !m || row.p1_health == null) return null;
    return { [m.p1_name]: { health: row.p1_health, armor: row.p1_armor }, [m.p2_name]: { health: row.p2_health, armor: row.p2_armor } };
  }
  const row = (await server.admin<any>('select vitals from public.versus_group_rounds where match_id = $1 and round = $2', [matchId, r]))[0];
  if (!row?.vitals) return null;
  const seats = await server.admin<any>('select seat, name, team from public.versus_group_seats where match_id = $1', [matchId]);
  const out: Record<string, { health: number; armor: number }> = {};
  for (const s of seats) {
    const v = (mode === 'duos' || mode === 'ranked_duos') ? row.vitals[s.team] ?? row.vitals[s.seat] : row.vitals[s.seat];
    if (v) out[s.name] = { health: v.health, armor: v.armor };
  }
  return out;
}

async function committedRounds(server: ChaosServer, matchId: string | null, group: boolean): Promise<number> {
  if (!matchId) return 0;
  const r = await server.admin<{ n: number }>(`select count(*)::int n from public.${group ? 'versus_group_rounds' : 'versus_rounds'} where match_id = $1`, [matchId]);
  return r[0]?.n ?? 0;
}

/** The server's fights, one canonical line per round. */
async function serverFights(server: ChaosServer, matchId: string, mode: ChaosMode): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  if (mode === 'duel') {
    for (const r of await server.admin<any>('select round, outcome, digest from public.versus_rounds where match_id = $1', [matchId])) out[r.round] = `${r.outcome}:${r.digest}`;
    return out;
  }
  if (mode === 'ranked_duos') {
    const rows = await server.admin<any>('select round, fight, a_team, b_team, outcome, damage from public.versus_ranked_duos_fights where match_id = $1 order by round, fight', [matchId]);
    for (const f of rows) out[f.round] = `${out[f.round] ? `${out[f.round]} ` : ''}${f.a_team}-${f.b_team}:${f.outcome}:${f.damage}`;
    return out;
  }
  const rows = await server.admin<any>('select round, fight, a_seat, b_seat, outcome, damage from public.versus_group_fights where match_id = $1 order by round, fight', [matchId]);
  for (const f of rows) out[f.round] = `${out[f.round] ? `${out[f.round]} ` : ''}${f.a_seat}-${f.b_seat}:${f.outcome}:${f.damage}`;
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
