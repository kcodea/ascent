import { describe, it, expect } from 'vitest';
import { createRun, reduce, serialize, snapshotBoard, replayRun, dominantTribe, type Action, type BoardSnapshot } from './index';

/** A tiny greedy bot that plays a run while recording its action log + the live snapshot at each combat. */
function recordRun(seed: number): { replay: { seed: number; heroId: string; actions: Action[] }; live: BoardSnapshot[] } {
  let s = createRun(seed);
  const actions: Action[] = [];
  const live: BoardSnapshot[] = [];
  const act = (a: Action): boolean => {
    const before = s;
    s = reduce(s, a);
    if (s !== before) actions.push(a);
    return s !== before;
  };
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 5000) {
    if (s.discover) { act({ type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { act({ type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { act({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { act({ type: 'resolveCombat' }); continue; }
    if (s.board.length < 7 && s.hand.length > 0) { act({ type: 'play', uid: s.hand[0]!.uid }); continue; }
    if (s.embers >= 3 && s.board.length + s.hand.length < 7 && s.shop[0]) { act({ type: 'buy', uid: s.shop[0]!.uid }); continue; }
    // faceOmen is the fallback — record its snapshot (board final, result computed)
    const before = s;
    s = reduce(s, { type: 'faceOmen' });
    if (s === before) break;
    actions.push({ type: 'faceOmen' });
    if (s.lastCombat) live.push(snapshotBoard(s));
  }
  return { replay: { seed, heroId: s.heroId, actions }, live };
}

describe('board snapshot + replay', () => {
  it('snapshotBoard captures the fought board (power = Σ atk+hp; run-specific refs dropped)', () => {
    const { live } = recordRun(7);
    expect(live.length).toBeGreaterThan(0);
    const snap = live[0]!;
    expect(snap.v).toBe(1);
    expect(snap.wave).toBe(1);
    expect(snap.power).toBe(snap.minions.reduce((s, m) => s + m.attack + m.health, 0));
    // transferable board only — no run-specific instance refs leak into the snapshot
    expect(snap.minions.every((m) => m.linkUid === undefined && m.sourceUid === undefined)).toBe(true);
  });

  it('replayRun reproduces the run byte-identically and yields the same per-wave snapshots', () => {
    const { replay, live } = recordRun(7);
    const a = replayRun(replay);
    const b = replayRun(replay);
    expect(a.snapshots).toEqual(live); // re-derived snapshots match the live ones, in order
    expect(serialize(b.final)).toBe(serialize(a.final)); // replay is itself deterministic
    expect(a.snapshots.length).toBe(live.length);
  });

  it('a replay is tiny — just (seed, heroId, actions), not a board dump', () => {
    const { replay } = recordRun(7);
    expect(replay.actions.length).toBeGreaterThan(5);
    expect(JSON.stringify(replay).length).toBeLessThan(20000);
  });

  it('snapshots carry opponent intel — resolve, tier, triples, and a dominant tribe', () => {
    const { live } = recordRun(7);
    const snap = live[0]!; // wave 1 (the existing test confirms live[0].wave === 1)
    expect(snap.tier).toBe(1); // wave 1 → tavern tier 1
    expect(snap.resolve).toBe(30); // full HP at capture (combat not yet resolved)
    expect(snap.triples).toBeGreaterThanOrEqual(0); // goldens made by this wave
    const dom = dominantTribe(snap);
    if (snap.minions.length > 0) {
      expect(dom).not.toBeNull();
      expect(dom!.count).toBeGreaterThan(0);
      expect(dom!.count).toBeLessThanOrEqual(snap.minions.length); // a tribe can't exceed the board size
    } else {
      expect(dom).toBeNull();
    }
  });
});
