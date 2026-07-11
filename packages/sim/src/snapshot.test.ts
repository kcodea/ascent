import { describe, it, expect } from 'vitest';
import { createRun, reduce, serialize, snapshotBoard, replayRun, dominantTribe, buildBootstrapPool, type Action, type BoardSnapshot, type RunState } from './index';

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
    if (s.questOffer) { act({ type: 'buyQuest', index: 0 }); continue; }
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
    expect(snap.minions.every((m) => m.sourceUid === undefined)).toBe(true);
  });

  it("snapshotBoard retains per-minion accruals (Sergeant's Deathrattle HP-grant, Tara's ascend progress)", () => {
    // A served opponent must be as strong as the board it was captured from — so the snapshot keeps the
    // shop-accumulated state combat seeds from the BoardMinion, not just the stats.
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'sg', cardId: 'sergeant', tribe: 'undead', attack: 5, health: 5, keywords: [], golden: false, hpGrantBonus: 8 },
        { uid: 'ta', cardId: 'tara', tribe: 'dragon', attack: 9, health: 9, keywords: ['EG'], golden: false, ascendProgress: 15 },
      ],
    };
    const snap = snapshotBoard(s);
    expect(snap.minions.find((m) => m.cardId === 'sergeant')?.hpGrantBonus).toBe(8);
    expect(snap.minions.find((m) => m.cardId === 'tara')?.ascendProgress).toBe(15);
  });

  it('snapshotBoard captures the per-source buff breakdown (for the inspect panel), cloned from the board', () => {
    const buffs = [{ source: 'Spirit Fire', attack: 6, health: 6, count: 2 }];
    const s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'pack', tribe: 'beast', attack: 8, health: 8, keywords: [], golden: false, buffs }],
    };
    const snap = snapshotBoard(s);
    expect(snap.minions[0]!.buffs).toEqual(buffs);
    expect(snap.minions[0]!.buffs).not.toBe(buffs); // cloned — the snapshot never shares the run board's array
    // a minion with no buffs carries none (field omitted, not an empty array)
    const plain = snapshotBoard({ ...createRun(1), board: [{ uid: 'p', cardId: 'pack', tribe: 'beast', attack: 3, health: 4, keywords: [], golden: false }] });
    expect(plain.minions[0]!.buffs).toBeUndefined();
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

  it('buildBootstrapPool plays seeded runs into a deterministic pool of real boards', () => {
    const pool = buildBootstrapPool([1, 2]);
    expect(pool.length).toBeGreaterThan(0);
    for (const snap of pool) {
      expect(snap.minions.length).toBeGreaterThan(0); // real, non-empty boards
      expect(snap.tier).toBeGreaterThanOrEqual(1);
      expect(snap.resolve).toBeGreaterThan(0);
      expect(snap.minions.every((m) => m.cardId !== 'omen')).toBe(true); // real cards, not procedural omens
    }
    expect(JSON.stringify(buildBootstrapPool([1, 2]))).toBe(JSON.stringify(pool)); // deterministic
  });
});

import { opponentBoard } from './opponents';
import type { BoardMinion } from '@game/core';

describe('opponentBoard — enemy Soren Reclaim mark', () => {
  const mkSnap = (heroId: string, minions: BoardMinion[]): BoardSnapshot =>
    ({ v: 1, wave: 5, heroId, resolve: 30, tier: 4, triples: 0, tribes: ['undead'], threat: 'horde', power: 0, minions, seed: 1 }) as BoardSnapshot;

  it('marks the highest-stat Deathrattle minion on a Soren board', () => {
    const board = opponentBoard(mkSnap('soren', [
      { cardId: 'sandbag', attack: 9, health: 9 },     // biggest, but NO Deathrattle → skipped
      { cardId: 'pack', attack: 3, health: 2 },        // Deathrattle (summon Pups)
      { cardId: 'broodmother', attack: 2, health: 5 }, // Deathrattle, higher stats than pack → the pick
    ]));
    expect(board.filter((m) => m.resummon).length).toBe(1);
    expect(board.find((m) => m.resummon)?.cardId).toBe('broodmother');
  });

  it('marks nothing for a non-Soren hero, or a Soren board with no Deathrattle minion', () => {
    expect(opponentBoard(mkSnap('warden', [{ cardId: 'pack', attack: 3, health: 2 }])).some((m) => m.resummon)).toBe(false);
    expect(opponentBoard(mkSnap('soren', [{ cardId: 'sandbag', attack: 9, health: 9 }])).some((m) => m.resummon)).toBe(false);
  });

  it('restores EVERY per-minion accrual the snapshot persisted (served enemy = as strong + as accurate as captured)', () => {
    // Regression: opponentBoard used to copy only stats + summonBonus, so a served Sergeant/Tara lost its
    // accrual → showed the printed base (+2 Health) and fought weaker. It must round-trip all of them.
    const snap = mkSnap('warden', [
      { cardId: 'sergeant', attack: 8, health: 8, keywords: [], hpGrantBonus: 6 },
      { cardId: 'tara', attack: 9, health: 9, keywords: ['EG'], ascendProgress: 15 },
      { cardId: 'guel', attack: 4, health: 5, keywords: [], spellProgress: 8 },
      { cardId: 'monk', attack: 4, health: 5, keywords: [], overflowBonus: 4 },
      { cardId: 'betterbot', attack: 5, health: 5, keywords: [], rallyMechAtk: 5 },
      { cardId: 'pack', attack: 3, health: 4, keywords: [], buffs: [{ source: 'Spirit Fire', attack: 2, health: 2, count: 1 }] },
    ]);
    const board = opponentBoard(snap);
    const by = (id: string): BoardMinion => board.find((m) => m.cardId === id)!;
    expect(by('sergeant').hpGrantBonus).toBe(6);
    expect(by('tara').ascendProgress).toBe(15);
    expect(by('guel').spellProgress).toBe(8);
    expect(by('monk').overflowBonus).toBe(4);
    expect(by('betterbot').rallyMechAtk).toBe(5);
    expect(by('pack').buffs).toEqual([{ source: 'Spirit Fire', attack: 2, health: 2, count: 1 }]);
    expect(by('pack').buffs).not.toBe(snap.minions.find((m) => m.cardId === 'pack')!.buffs); // cloned, not shared
  });
});
