/**
 * REPLAY V2 — Phase C entry-point gating (docs/replay-v2-handoff.md §9).
 *
 * The spectate feeds gate watchability on `replay->v2->version === 2` — the structural predicate that
 * replaced v1's `isFaithful` (every v2 recording is faithful by construction, so the only gate left is
 * "is there a v2 payload at all"). These tests pin the predicate + the Recent Games listing mapper against
 * the row shapes the network can actually serve: v1-only rows, v2 rows, and malformed payloads.
 */
import { describe, it, expect } from 'vitest';
import { isReplayV2, v2ReplayOf, asRecentGameRow } from './remoteBoards';

/** A minimal structurally-valid v2 payload (the gate checks version + a non-empty frame list; full
 *  validation is playback's job). */
const v2 = { version: 2, seed: 1, heroId: 'brackus', mode: 'lobby', author: 'kev', patch: '0.1.0', frames: [{ kind: 'shop', wave: 1, tMs: 0, cause: 'turnStart', view: {} }], result: { placement: 1, record: { wins: 5, losses: 0, draws: 0 }, finalBoard: null } };

/** A v1 action replay — what every pre-v2 `replay` column holds. Must NEVER be offered for watching. */
const v1Only = { seed: 1, heroId: 'brackus', actions: [{ type: 'buy' }], timings: [900], servedBoards: { 3: {} } };

describe('isReplayV2 / v2ReplayOf — the version-2 watchability gate', () => {
  it('accepts a structurally valid v2 payload', () => {
    expect(isReplayV2(v2)).toBe(true);
    expect(v2ReplayOf({ ...v1Only, v2 })).toBe(v2); // the upload nests v2 alongside the dormant v1 fields
    expect(v2ReplayOf({ v2 })).toBe(v2); // and a v2-only column works too
  });

  it('rejects v1-only rows (no v2 key)', () => {
    expect(v2ReplayOf(v1Only)).toBeNull();
    expect(isReplayV2(v1Only)).toBe(false);
  });

  it('rejects absent / null / non-object columns', () => {
    expect(v2ReplayOf(null)).toBeNull();
    expect(v2ReplayOf(undefined)).toBeNull();
    expect(v2ReplayOf('replay')).toBeNull();
    expect(v2ReplayOf(42)).toBeNull();
  });

  it('tolerates malformed v2 payloads by rejecting them (never by throwing)', () => {
    expect(v2ReplayOf({ v2: null })).toBeNull();
    expect(v2ReplayOf({ v2: 'garbage' })).toBeNull();
    expect(v2ReplayOf({ v2: { version: 1, frames: [{}] } })).toBeNull(); // wrong version
    expect(v2ReplayOf({ v2: { version: 2 } })).toBeNull(); // no frames at all
    expect(v2ReplayOf({ v2: { version: 2, frames: [] } })).toBeNull(); // empty frame list renders nothing
    expect(v2ReplayOf({ v2: { version: 2, frames: 'not-an-array' } })).toBeNull();
  });
});

describe('asRecentGameRow — the light-list mapper (probe column, never the payload)', () => {
  const base = { id: 7, user_id: 'u1', author: 'kev', hero_id: 'brackus', wins: 5, placement: 1, created_at: '2026-08-19T00:00:00Z' };

  it('marks a row watchable when the replay_v2_version probe says 2', () => {
    const row = asRecentGameRow({ ...base, replay_v2_version: 2 });
    expect(row.hasReplay).toBe(true);
    expect(row.rowId).toBe(7);
    expect(row).toMatchObject({ userId: 'u1', author: 'kev', heroId: 'brackus', wins: 5, placement: 1 });
  });

  it('tolerates the probe arriving as text (->> filter form)', () => {
    expect(asRecentGameRow({ ...base, replay_v2_version: '2' }).hasReplay).toBe(true);
  });

  it('filters v1-only and replay-less rows out of watchability (but keeps the rows themselves)', () => {
    expect(asRecentGameRow({ ...base, replay_v2_version: null }).hasReplay).toBe(false); // v1-only / no replay
    expect(asRecentGameRow({ ...base }).hasReplay).toBe(false); // pre-migration fallback select (no probe)
    expect(asRecentGameRow({ ...base, replay_v2_version: 1 }).hasReplay).toBe(false); // wrong version
  });

  it('never offers a Watch without the PK to fetch the payload by', () => {
    const row = asRecentGameRow({ ...base, id: undefined, replay_v2_version: 2 });
    expect(row.rowId).toBeNull();
    expect(row.hasReplay).toBe(false);
  });

  it('maps a sparse pre-accounts row without throwing', () => {
    const row = asRecentGameRow({ hero_id: 'yazzus' });
    expect(row).toMatchObject({ userId: null, author: null, heroId: 'yazzus', wins: 0, placement: null, rowId: null, hasReplay: false });
  });
});
