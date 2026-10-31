/**
 * THE GAME SESSION — the rules on a fake clock (R-SESSION-CF-01; `src/core/sessionCore.ts`). The Durable Object round
 * trip is `test/it/session.it.ts` (real workerd); the SQL writer is `test/sessionFlush.db.test.ts` (PGlite).
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_FINISH_SETTLE_MS, SESSION_FLUSH_GIVE_UP, SESSION_FORGET_MS, SESSION_QUIET_MS, SESSION_STALE_SAVE_MS, SESSION_UNFINISHED_SETTLE_MS,
  SessionCore, SessionError, cleanSeatKeys, flushDelayMs, newSessionMeta,
} from '../src/core/sessionCore';
import { RANK_RULES_VERSION, RANK_SEASON } from '../../../supabase/functions/_shared/lobbyRating';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const T0 = 1_000_000;
const game = (id = 'run-abc') => new SessionCore(newSessionMeta(id, T0));
const rateReq = (over: Record<string, unknown> = {}) => ({ runId: 'run-abc', placement: 3, seasonId: RANK_SEASON, rulesVersion: RANK_RULES_VERSION, seed: 42, seatKeys: ['a|warden|1', 'b|soren|2'], ...over }) as never;

describe('ownership', () => {
  it('the first account owns the session; nobody else may use it', () => {
    const s = game();
    s.save(ME, 'run:abc', 0, 'dev1', T0);
    expect(() => s.save(OTHER, 'run:abc', 0, 'dev2', T0)).toThrow(SessionError);
    expect(() => s.write(OTHER, { key: 'k', table: 'boards', rows: [{}] }, T0)).toThrow('not_owner');
  });
});

describe('the cloud save: held, written only when it matters', () => {
  it('a save during play is held; the answer is the Supabase row revision (never bumped by the session)', () => {
    const s = game();
    expect(s.save(ME, 'run:abc', 0, 'dev1', T0)).toBe(0);
    expect(s.save(ME, 'run:abc', 0, 'dev1', T0 + 30_000)).toBe(0);
    // A client that knows a newer revision (a Continue claimed the row directly) moves the session's base up.
    expect(s.save(ME, 'run:abc', 4, 'dev1', T0 + 60_000)).toBe(4);
    expect(s.save(ME, 'run:abc', 2, 'dev1', T0 + 90_000)).toBe(4);
  });

  it('not due while the player is connected; due SESSION_QUIET_MS after the socket went; due when parked', () => {
    const s = game();
    s.save(ME, 'run:abc', 0, 'dev1', T0);
    expect(s.saveDue(T0 + 5 * 60_000, true, null)).toBe(false);
    expect(s.saveDue(T0 + SESSION_QUIET_MS - 1, false, T0)).toBe(false);
    expect(s.saveDue(T0 + SESSION_QUIET_MS, false, T0)).toBe(true);
    // The socket went later than the save: quiet counts from then.
    expect(s.saveDue(T0 + SESSION_QUIET_MS + 10, false, T0 + 30_000)).toBe(false);
    expect(s.saveDue(T0 + 30_000 + SESSION_QUIET_MS, false, T0 + 30_000)).toBe(true);
    s.park(ME, T0 + 1);
    expect(s.saveDue(T0 + 2, true, null)).toBe(true);
  });

  it('a held save older than SESSION_STALE_SAVE_MS is written even with the socket open', () => {
    const s = game();
    s.save(ME, 'run:abc', 0, 'dev1', T0);
    expect(s.saveDue(T0 + SESSION_STALE_SAVE_MS - 1, true, null)).toBe(false);
    expect(s.saveDue(T0 + SESSION_STALE_SAVE_MS, true, null)).toBe(true);
  });

  it('a written save takes the row revision; a conflict marks the run moved and the next save is told', () => {
    const s = game();
    s.save(ME, 'run:abc', 0, 'dev1', T0);
    const plan = s.plan(T0 + SESSION_QUIET_MS, false, T0, false)!;
    expect(plan).toEqual({ writeKeys: [], save: true, clear: null });
    s.flushed(plan, { save: { status: 'ok', revision: 1 } }, T0 + SESSION_QUIET_MS);
    expect(s.meta.save).toMatchObject({ base: 1, dirty: false });
    expect(s.save(ME, 'run:abc', 1, 'dev1', T0 + 70_000)).toBe(1);
    const p2 = s.plan(T0 + 70_000 + SESSION_QUIET_MS, false, T0, false)!;
    const moved = { run_key: 'run:abc', revision: 2, device_id: 'dev2', updated_at: 'x' };
    s.flushed(p2, { save: { status: 'conflict', current: moved } }, T0 + 200_000);
    expect(s.meta.moved).toEqual(moved);
    expect(() => s.save(ME, 'run:abc', 1, 'dev1', T0 + 210_000)).toThrow('conflict');
  });
});

describe('the run-end writes', () => {
  it('kept by key: a resend (before or after the flush) is not stored twice', () => {
    const s = game();
    expect(s.write(ME, { key: 'boards:1', kind: 'boards', table: 'boards', rows: [{ wave: 1 }], conflict: 'user_id,upload_key' }, T0)).not.toBeNull();
    expect(s.write(ME, { key: 'boards:1', kind: 'boards', table: 'boards', rows: [{ wave: 1 }] }, T0 + 1)).toBeNull();
    const plan = { writeKeys: ['boards:1'], save: false, clear: null };
    s.flushed(plan, { writes: [{ key: 'boards:1', status: 'applied' }] }, T0 + 10);
    expect(s.meta.writes).toEqual([]);
    expect(s.write(ME, { key: 'boards:1', kind: 'boards', table: 'boards', rows: [{ wave: 1 }] }, T0 + 20)).toBeNull();
  });

  it('only the four run-end tables, a bounded conflict spec', () => {
    const s = game();
    expect(() => s.write(ME, { key: 'k', table: 'profiles', rows: [{}] }, T0)).toThrow('bad_write');
    expect(() => s.write(ME, { key: 'k', table: 'boards', rows: [] }, T0)).toThrow('bad_write');
    const w = s.write(ME, { key: 'k', table: 'lobby_fights', rows: [{}], conflict: 'x; drop table' }, T0);
    expect(w?.conflict).toBeUndefined();
  });

  it('flushed SESSION_FINISH_SETTLE_MS after the last write once the game ended, else SESSION_UNFINISHED_SETTLE_MS', () => {
    const s = game();
    s.write(ME, { key: 'a', table: 'boards', rows: [{}] }, T0);
    expect(s.writesDue(T0 + SESSION_FINISH_SETTLE_MS)).toBe(false);
    expect(s.writesDue(T0 + SESSION_UNFINISHED_SETTLE_MS)).toBe(true);
    s.clearSave(ME, 'run:abc', 0, T0 + 1000);
    expect(s.writesDue(T0 + 1000 + SESSION_FINISH_SETTLE_MS - 1)).toBe(false);
    expect(s.writesDue(T0 + 1000 + SESSION_FINISH_SETTLE_MS)).toBe(true);
    const plan = s.plan(T0 + 20_000, true, null, true)!;
    expect(plan.writeKeys).toEqual(['a']);
    expect(plan.clear).toEqual({ runKey: 'run:abc', expected: 0 });
  });

  it('the clear stops the save from being written again, and goes with the flush', () => {
    const s = game();
    s.save(ME, 'run:abc', 3, 'dev1', T0);
    s.clearSave(ME, 'run:abc', 3, T0 + 5);
    expect(s.saveDue(T0 + 10 * SESSION_STALE_SAVE_MS, false, T0)).toBe(false);
    expect(() => s.save(ME, 'run:abc', 3, 'dev1', T0 + 6)).toThrow('game_ended');
    const plan = s.plan(T0 + 30_000, false, T0, true)!;
    s.flushed(plan, { clear: { status: 'ok' } }, T0 + 30_000);
    expect(s.meta.clear).toBeNull();
    expect(s.settled()).toBe(true);
  });
});

describe('the flush: retries and forgetting', () => {
  it('a failed flush backs off (2 s, 4 s ... capped), gives up after SESSION_FLUSH_GIVE_UP tries; a rate still forces one', () => {
    const s = game();
    s.write(ME, { key: 'a', table: 'boards', rows: [{}] }, T0);
    s.failed('boom', T0);
    expect(s.meta.flush.retryAt).toBe(T0 + flushDelayMs(1));
    expect(s.canFlush(T0 + 1)).toBe(false);
    expect(s.canFlush(T0 + 1, true)).toBe(true);
    expect(s.canFlush(T0 + flushDelayMs(1))).toBe(true);
    for (let i = 1; i < SESSION_FLUSH_GIVE_UP; i++) s.failed('boom', T0);
    expect(s.meta.flush.gaveUp).toBe(true);
    expect(s.canFlush(T0 + 10 ** 9)).toBe(false);
    expect(flushDelayMs(30)).toBe(10 * 60_000);
  });

  it('nothing owed and quiet for SESSION_FORGET_MS: forgettable; owing anything: never', () => {
    const s = game();
    s.write(ME, { key: 'a', table: 'boards', rows: [{}] }, T0);
    expect(s.forgettable(T0 + 10 * SESSION_FORGET_MS)).toBe(false);
    s.flushed({ writeKeys: ['a'], save: false, clear: null }, {}, T0 + 1);
    expect(s.forgettable(T0 + 1 + SESSION_FORGET_MS)).toBe(true);
  });

  it('nextAt: the settle, the quiet save, the forget', () => {
    const s = game();
    s.save(ME, 'run:abc', 0, 'd', T0);
    expect(s.nextAt(T0, true, null)).toBe(T0 + SESSION_STALE_SAVE_MS);
    expect(s.nextAt(T0, false, T0 + 5)).toBe(T0 + 5 + SESSION_QUIET_MS);
    s.write(ME, { key: 'a', table: 'boards', rows: [{}] }, T0 + 10);
    expect(s.nextAt(T0 + 10, true, null)).toBe(T0 + 10 + SESSION_UNFINISHED_SETTLE_MS);
  });
});

describe('the rating: submit-rating\'s checks, plus this game and the pinned table', () => {
  it('bad run id, another game\'s run id, bad placement, unsupported season / rules', () => {
    const s = game();
    expect(s.rate(ME, rateReq({ runId: '' }), T0)).toMatchObject({ kind: 'answer', status: 400, body: { error: 'bad_run_id' } });
    expect(s.rate(ME, rateReq({ runId: 'run-other' }), T0)).toMatchObject({ kind: 'answer', status: 400, body: { error: 'bad_run_id' } });
    expect(s.rate(ME, rateReq({ placement: 9 }), T0)).toMatchObject({ status: 400, body: { error: 'bad_placement' } });
    expect(s.rate(ME, rateReq({ placement: 2.5 }), T0)).toMatchObject({ status: 400, body: { error: 'bad_placement' } });
    expect(s.rate(ME, rateReq({ seasonId: RANK_SEASON - 1 }), T0)).toMatchObject({ status: 409, body: { error: 'unsupported_season' } });
    expect(s.rate(ME, rateReq({ rulesVersion: RANK_RULES_VERSION + 1 }), T0)).toMatchObject({ status: 409, body: { error: 'unsupported_rules' } });
  });

  it('settles with the PINNED table, never the keys sent at the end (an easier table cannot be swapped in)', () => {
    const s = game();
    s.table(ME, 'ranked', ['real|warden|1', 'real|soren|2'], T0);
    s.table(ME, 'ranked', ['bot:hybrid:x'], T0 + 1); // a later pin cannot replace the first
    const r = s.rate(ME, rateReq({ seatKeys: ['bot:hybrid:a', 'bot:hybrid:b'] }), T0 + 2);
    expect(r).toMatchObject({ kind: 'settle', args: { p_run_id: 'run-abc', p_placement: 3, p_season: RANK_SEASON, p_rules_version: RANK_RULES_VERSION, p_seed: 42, p_seat_keys: ['real|warden|1', 'real|soren|2'] } });
    expect(s.meta.finishedAt).toBe(T0 + 2);
  });

  it('an all-generated table is unrated (the pinned keys decide when pinned)', () => {
    const s = game();
    s.table(ME, 'casual', ['bot:hybrid:a', 'bot:bot:b'], T0);
    expect(s.rate(ME, rateReq({ seatKeys: ['real|warden|1'] }), T0)).toMatchObject({ kind: 'answer', status: 200, body: { status: 'unrated', error: 'unrated_all_generated' } });
    const t = game();
    expect(t.rate(ME, rateReq({ seatKeys: ['bot:hybrid:a'] }), T0)).toMatchObject({ body: { status: 'unrated' } });
  });

  it('a settled rating is answered again from the session (a retried rate request)', () => {
    const s = game();
    s.meta.rating = { runId: 'run-abc', answer: { status: 'confirmed', deduped: false } };
    expect(s.rate(ME, rateReq(), T0)).toEqual({ kind: 'answer', status: 200, body: { status: 'confirmed', deduped: false } });
  });

  it('cleanSeatKeys: the submit-rating filter', () => {
    expect(cleanSeatKeys(null)).toBeNull();
    expect(cleanSeatKeys(['a', 5, '', 'x'.repeat(97), 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
});
