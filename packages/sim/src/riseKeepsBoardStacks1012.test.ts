import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * RISE KEEPS THE BOARD CARD'S STACKS (owner ruling 2026-10-12, R-RISE-06).
 *
 * Owner report: "my kennelmaster just lost all of its stacks of the attack buff and i have no idea why". A gilded
 * Kennelmaster with a granted Rise died in combat and Rose; the risen body restarts at its printed values
 * (R-RISE-01) and the old carry-back (R-FLORIDA-01, 2026-10-08) wrote that reset 0 home to the Shop card.
 *
 * Owner ruling: "a minion rising in combat would rise with the reset values, yes, but then back in shop phase it's
 * still the original copy w/ the stack values from before. basically think of it like... rise rises a 'fresh copy'
 * of something, but that is a combat only thing. the recruit phase would still have the original copy with all its
 * stacks."
 *
 * The board card keeps what the ORIGINAL body had when it died (pre-fight stacks + growth earned before dying);
 * growth the risen fresh copy earns after the Rise is combat-only.
 */

const fight = (player: BoardMinion[], enemy: BoardMinion[], seed: number): CombatResult =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
const bm = (cardId: string, sourceUid: string | undefined, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, ...(sourceUid ? { sourceUid } : {}), keywords: [], ...extra });
/** Index of the first (non-Rebirth) Rise return of `uid`, or -1. */
const riseAt = (events: CombatEvent[], uid: string): number =>
  events.findIndex((e) => e.type === 'reborn' && e.target === uid && !e.rebirth);
const improvesOn = (events: CombatEvent[], uid: string): number =>
  events.reduce((n, e) => n + (e.type === 'improve' && e.target === uid ? e.amount : 0), 0);

describe('Kennelmaster with stacks + Rise (the owner report)', () => {
  // A gilded Kennelmaster holding 5 stacks and a Rise, behind six 1/1 friends whose deaths tick its Avenge (3).
  const kennelBoard = (): BoardMinion[] => [
    bm('kennel', 'K', 4, 12, { golden: true, keywords: ['SC', 'R'], summonBonus: 5 }),
    ...Array.from({ length: 6 }, (_, i) => bm('stray', `s${i}`, 1, 1)),
  ];
  const wall = (): BoardMinion[] => [bm('sandbag', undefined, 9, 90000)];

  it('the board card keeps its stacks (+ the original\'s pre-death growth); the risen copy\'s growth stays in combat', () => {
    let rose = 0;
    let grewBefore = 0;
    let grewAfter = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = fight(kennelBoard(), wall(), seed);
      const uid = r.initial.player[0]!.uid;
      const at = riseAt(r.events, uid);
      if (at < 0) continue;
      rose++;
      const before = improvesOn(r.events.slice(0, at), uid);
      const after = improvesOn(r.events.slice(at), uid);
      if (before > 0) grewBefore++;
      if (after > 0) grewAfter++;
      // Never the risen copy's reset 0, never its post-Rise regrowth: the original's 5 + what it earned before dying.
      expect(r.playerSummonBonus, `seed ${seed}`).toEqual([{ sourceUid: 'K', bonus: 5 + before }]);
    }
    expect(rose, 'some seeds Rose').toBeGreaterThan(0);
    expect(grewBefore, 'some seeds grew the ORIGINAL before it died (kept)').toBeGreaterThan(0);
    expect(grewAfter, 'some seeds grew the RISEN copy after the Rise (combat only, dropped)').toBeGreaterThan(0);
  });

  it('through the real reducer: after a fight where it Rose, the Shop card still holds its stacks', () => {
    const recruit = (seed: number): RunState =>
      ({ ...createRun(seed, 'warden', 'ascent'), wave: 6, tier: 6, phase: 'recruit', embers: 40,
        board: [{ uid: 'K', cardId: 'kennel', tribe: 'beast', attack: 4, health: 1, keywords: ['SC', 'R'], golden: true, summonBonus: 5 } as BoardCard] } as RunState);
    let checked = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const safe = { ...recruit(seed), resolve: 999, maxResolve: 999, armor: 999 } as RunState;
      const s = reduce(reduce(safe, { type: 'faceOmen' }) as RunState, { type: 'resolveCombat' }) as RunState;
      const uid = s.lastCombat?.initial.player.find((m) => m.cardId === 'kennel')?.uid;
      if (!uid || riseAt(s.lastCombat!.events, uid) < 0) continue;
      const before = improvesOn(s.lastCombat!.events.slice(0, riseAt(s.lastCombat!.events, uid)), uid);
      expect(s.board.find((c) => c.uid === 'K')!.summonBonus, `seed ${seed}`).toBe(5 + before);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('Sergey (hpGrantBonus): the other per-instance channel follows the same rule', () => {
  // Sporelings' Echo gives every friend +1/+1: each one that dies is an Attack gain for Sergey (improve +2).
  const board = (): BoardMinion[] => [
    bm('sergeant', 'S', 1, 1, { keywords: ['R'], hpGrantBonus: 6 }),
    ...Array.from({ length: 5 }, (_, i) => bm('spore', `p${i}`, 2, 1)),
  ];
  const wall = (): BoardMinion[] => [bm('sandbag', undefined, 9, 90000)];

  it('the risen copy restarts its grant in combat; the board card keeps the original\'s accrual', () => {
    let rose = 0;
    let grewAfter = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = fight(board(), wall(), seed);
      const uid = r.initial.player[0]!.uid;
      const at = riseAt(r.events, uid);
      if (at < 0) continue;
      rose++;
      const grants = (from: number, to?: number) =>
        r.events.slice(from, to).filter((e): e is Extract<CombatEvent, { type: 'hpGrant' }> => e.type === 'hpGrant' && e.target === uid).map((e) => e.amount);
      const pre = grants(0, at);
      const post = grants(at);
      // In combat the risen copy is the printed card: its first improvement reads +2 again, not 6 + earned + 2.
      if (post.length > 0) { grewAfter++; expect(post[0], `seed ${seed}: the risen copy starts fresh`).toBe(2); }
      const original = pre.length > 0 ? pre[pre.length - 1]! : 6;
      expect(r.playerHpGrantBonus, `seed ${seed}`).toEqual([{ sourceUid: 'S', bonus: original }]);
    }
    expect(rose).toBeGreaterThan(0);
    expect(grewAfter, 'some seeds improved the risen copy (dropped at settle)').toBeGreaterThan(0);
  });
});

describe('the enemy seat uses the same single carry-back path (lobby snapshots match)', () => {
  it('a Kennelmaster that Rose as the ENEMY reports the same kept stacks on enemyCarry', () => {
    const kennel = (): BoardMinion[] => [
      bm('kennel', 'K', 4, 12, { golden: true, keywords: ['SC', 'R'], summonBonus: 5 }),
      ...Array.from({ length: 6 }, (_, i) => bm('stray', `s${i}`, 1, 1)),
    ];
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulate([bm('sandbag', undefined, 9, 90000)], kennel(), makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
      const uid = r.initial.enemy[0]!.uid;
      const at = riseAt(r.events, uid);
      if (at < 0) continue;
      expect(r.enemyCarry?.summonBonus, `seed ${seed}`).toEqual([{ sourceUid: 'K', bonus: 5 + improvesOn(r.events.slice(0, at), uid) }]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
