/**
 * VERSUS RELIABILITY (owner 2026-10-27: Versus 1v1, Group, Versus Duos and Ranked Duos "need to be spotless
 * experiences"; End of Turn freezes "completely locking us out", reconnects where "it would simply pause when someone
 * returned"). The client rules from the 2026-10-27 audit, each pinned here with fake timers and a fake network:
 *  R-VERSUS-RELIABLE-02  only the client that closed the round asks the resolver at once; the rest wait a jittered
 *                        backstop; never two resolver calls in flight from one client.
 *  R-VERSUS-RELIABLE-03  a waking tab sends its heartbeat FIRST and holds reconciles until it answers.
 *  R-VERSUS-RELIABLE-05  no RPC hangs forever (8 s); a lost End Combat is owed and re-sent; a stalled End Turn is retried.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beatFresh, BEAT_FRESH_MS, closedByMeOf, combatReadyOwed, createResolverFlight, createWakeGate, duelLeader, endTurnStalled, finalizeAsk,
  finalizeBackstopMs, FINALIZE_BACKSTOP_MS, FINALIZE_JITTER_MS, groupLeader,
} from './versusReliability';
import { makeVersusRemote, VersusError, VERSUS_RPC_TIMEOUT_MS } from './versusRemote';
import type { SupabaseClient } from '@supabase/supabase-js';

afterEach(() => { vi.useRealTimers(); });

describe('R-VERSUS-RELIABLE-02: one resolver call per round, from the client that closed it', () => {
  it('the server says who closed the round: that client asks now, every other one waits its backstop', () => {
    expect(finalizeAsk({ phase: 'resolving', closed_by_me: true }, false)).toBe('now');
    expect(finalizeAsk({ phase: 'resolving', closed_by_me: false }, true), 'the server\'s word beats the fallback').toBe('backstop');
    expect(finalizeAsk({ phase: 'resolving', closedByMe: true }, false), 'camelCase too').toBe('now');
  });

  it('an older server says nothing: exactly one deterministic asker (the table\'s first live seat)', () => {
    expect(finalizeAsk({ phase: 'resolving' }, true)).toBe('now');
    expect(finalizeAsk({ phase: 'resolving' }, false)).toBe('backstop');
    expect(finalizeAsk({ phase: 'shop', closed_by_me: true }, true), 'never for a round that is not closed').toBe('none');
  });

  it('at 0:00 every client\'s close answer reads `resolving`: four clients, ONE asks now', () => {
    const seats = (['p1', 'p2', 'p3', 'p4'] as const).map((seat, i) => ({ seat, userId: `u${i + 1}`, eliminatedRound: null, auto: false }));
    const raw = { seats } as never;
    const asks = ['u1', 'u2', 'u3', 'u4'].map((me) => finalizeAsk({ phase: 'resolving' }, groupLeader(raw, me)));
    expect(asks.filter((a) => a === 'now')).toHaveLength(1);
    // With the server's flag, the one whose call closed it (say u3) is the asker, whatever the seat order.
    const flagged = ['u1', 'u2', 'u3', 'u4'].map((me) => finalizeAsk({ phase: 'resolving', closed_by_me: me === 'u3' }, groupLeader(raw, me)));
    expect(flagged).toEqual(['backstop', 'backstop', 'now', 'backstop']);
  });

  it('the fallback asker skips seats that are out, on auto, or recorded (Ranked Duos)', () => {
    const raw = { seats: [
      { seat: 'p1', userId: 'a', eliminatedRound: 3, auto: false },
      { seat: 'p2', userId: 'b', eliminatedRound: null, auto: true },
      { seat: 'p3', userId: 'c', eliminatedRound: null, auto: false, served: true },
      { seat: 'p4', userId: 'd', eliminatedRound: null, auto: false },
    ] } as never;
    expect(['a', 'b', 'c', 'd'].map((me) => groupLeader(raw, me))).toEqual([false, false, false, true]);
    expect(duelLeader('p1')).toBe(true);
    expect(duelLeader('p2')).toBe(false);
  });

  it('closed_by_me is read off a raw answer only when it is a boolean', () => {
    expect(closedByMeOf({ closed_by_me: true })).toBe(true);
    expect(closedByMeOf({ closedByMe: false })).toBe(false);
    expect(closedByMeOf({ closed_by_me: 'yes' })).toBeUndefined();
    expect(closedByMeOf(null)).toBeUndefined();
  });

  it('the backstop: 4 s plus up to 1.5 s of jitter, so the others never all ask in the same instant', () => {
    expect(finalizeBackstopMs(0)).toBe(FINALIZE_BACKSTOP_MS);
    expect(finalizeBackstopMs(0.5)).toBe(FINALIZE_BACKSTOP_MS + FINALIZE_JITTER_MS / 2);
    expect(finalizeBackstopMs(1)).toBeLessThan(FINALIZE_BACKSTOP_MS + FINALIZE_JITTER_MS);
    expect(new Set([0.1, 0.4, 0.7, 0.95].map(finalizeBackstopMs)).size).toBe(4);
  });

  it('never two resolver calls in flight from one client; three failures in a row raise the notice', () => {
    const f = createResolverFlight();
    expect(f.start()).toBe(true);
    expect(f.start(), 'a second call while the first is out').toBe(false);
    expect(f.failed('m|3')).toBe(1);
    expect(f.start()).toBe(true);
    expect(f.failed('m|3')).toBe(2);
    expect(f.start()).toBe(true);
    expect(f.failed('m|3')).toBe(3);
    expect(f.start()).toBe(true);
    f.done('m|3');
    expect(f.start()).toBe(true);
    expect(f.failed('m|3'), 'a success resets the streak').toBe(1);
    expect(f.start()).toBe(true);
    expect(f.failed('m|4'), 'a new round starts its own streak').toBe(1);
  });
});

describe('R-VERSUS-RELIABLE-03: a waking tab sends its heartbeat first', () => {
  it('reconciles are held until the wake\'s heartbeat answers; a second wake joins the first', async () => {
    vi.useFakeTimers();
    const gate = createWakeGate();
    const calls: string[] = [];
    const beat = vi.fn(() => new Promise<void>((r) => setTimeout(() => { calls.push('heartbeat answered'); r(); }, 300)));
    const reconcile = (): void => { if (!gate.held()) calls.push('reconcile'); };
    void gate.wake(beat);
    void gate.wake(beat);
    reconcile(); // the tick fires right after the wake
    expect(gate.held()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    reconcile();
    expect(beat).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['heartbeat answered', 'reconcile']);
    expect(gate.held()).toBe(false);
  });

  it('a failed heartbeat still releases the hold', async () => {
    const gate = createWakeGate();
    await gate.wake(() => Promise.reject(new Error('offline')));
    expect(gate.held()).toBe(false);
  });

  it('a stale heartbeat (a throttled background tab) blocks reconciles until a fresh one answers', () => {
    expect(beatFresh(10_000, 0), 'never answered').toBe(false);
    expect(beatFresh(10_000, 9_000)).toBe(true);
    expect(beatFresh(10_000 + BEAT_FRESH_MS, 10_000)).toBe(false);
    expect(BEAT_FRESH_MS).toBeLessThan(12_000); // inside the server's 12 s lease
  });
});

describe('R-VERSUS-RELIABLE-05: lost calls recover', () => {
  it('no Versus RPC hangs forever: a request with no answer fails as `network` at 8 s', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fakeClient = {
      rpc: () => ({
        abortSignal: (sig: AbortSignal) => new Promise((resolve) => {
          sig.addEventListener('abort', () => { aborted = true; resolve({ data: null, error: { message: 'AbortError: The user aborted a request.' } }); });
        }),
      }),
    } as unknown as SupabaseClient;
    const remote = makeVersusRemote(() => fakeClient);
    const p = remote.heartbeat('r1');
    const seen = p.then(() => 'answered', (e: unknown) => (e as VersusError).code);
    await vi.advanceTimersByTimeAsync(VERSUS_RPC_TIMEOUT_MS - 1);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(await seen).toBe('network');
  });

  it('a quick answer is unaffected (and its timer is cleared)', async () => {
    vi.useFakeTimers();
    const fakeClient = { rpc: () => ({ abortSignal: () => Promise.resolve({ data: { ok: 1 }, error: null }) }) } as unknown as SupabaseClient;
    const remote = makeVersusRemote(() => fakeClient);
    await expect(remote.heartbeat('r1')).resolves.toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a lost End Combat is owed: I am back, the row does not have me back', () => {
    const match = { phase: 'combat' as const, round: 4, paused_at: null, p1_ready: false, p2_ready: false };
    const run = (phase: string, wave: number) => ({ mode: 'versus', phase, wave });
    expect(combatReadyOwed({ match, seat: 'p1', readyRound: 4, run: run('combat', 4) }), 'pressed End Combat').toBe(true);
    expect(combatReadyOwed({ match, seat: 'p1', readyRound: null, run: run('recruit', 5) }), 'already left the fight').toBe(true);
    expect(combatReadyOwed({ match, seat: 'p1', readyRound: null, run: run('combat', 4) }), 'still watching the fight').toBe(false);
    expect(combatReadyOwed({ match: { ...match, p1_ready: true }, seat: 'p1', readyRound: 4, run: run('combat', 4) }), 'the server has it').toBe(false);
    expect(combatReadyOwed({ match: { ...match, paused_at: 'x' }, seat: 'p1', readyRound: 4, run: run('combat', 4) }), 'paused').toBe(false);
    expect(combatReadyOwed({ match: { ...match, phase: 'shop' as never }, seat: 'p1', readyRound: 4, run: run('combat', 4) }), 'next shop open').toBe(false);
  });

  it('a stalled End Turn: the fight is in, the run still shops it, nothing animates, not paused', () => {
    const run = { mode: 'versus', phase: 'recruit', wave: 6 };
    expect(endTurnStalled({ endTurnWave: 6, run, presenting: false, paused: false })).toBe(true);
    expect(endTurnStalled({ endTurnWave: 6, run, presenting: true, paused: false }), 'its beats are playing').toBe(false);
    expect(endTurnStalled({ endTurnWave: 6, run, presenting: false, paused: true })).toBe(false);
    expect(endTurnStalled({ endTurnWave: 6, run: { ...run, phase: 'combat' }, presenting: false, paused: false }), 'it played').toBe(false);
    expect(endTurnStalled({ endTurnWave: null, run, presenting: false, paused: false }), 'no fight yet').toBe(false);
  });
});
