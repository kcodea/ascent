import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * The Ales (owner batch 2026-07-25, renamed from Work Orders 2026-07-26) — a five-card cycle of cheap
 * Tier-3 utility spells, SET 2 ONLY. The card IDS keep their `wo_` prefix: art files and saved runs key off
 * them, the same rule every other rename here has followed.
 * Same tier and cost by design, each paying a different axis.
 */
const WORK_ORDERS = ['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'];

/** DISTINCT card ids, all effect-free Beasts. Three copies of the SAME minion would TRIPLE-COMBINE into a
 *  golden and vanish mid-test — a trap that has produced false failures here before. */
const INERT = ['stray', 'pup', 'babycub', 'sabercub', 'trailforager'] as const;
const minion = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'beast', attack = 1, health = 1): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false });
/** `n` distinct inert Beasts, uid'd u0…u(n-1). */
const board = (n: number): BoardCard[] => INERT.slice(0, n).map((id, i) => minion(`u${i}`, id));
const spell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

describe('The Ales — set scoping and shared shape', () => {
  it('are in SET 2 and NOT in set 1', () => {
    // The whole point of authoring them in `cards/set2/spells.ts`: a set-1 run must never see them.
    const set2 = new Set(poolFor('set2').spells.map((c) => c.id));
    const set1 = new Set(poolFor('set1').spells.map((c) => c.id));
    for (const id of WORK_ORDERS) {
      expect(set2.has(id), `${id} in set 2`).toBe(true);
      expect(set1.has(id), `${id} absent from set 1`).toBe(false);
    }
  });

  it('all share Tier 3 / cost 2', () => {
    for (const id of WORK_ORDERS) {
      const c = CARD_INDEX[id]!;
      expect([c.tier, c.cost], id).toEqual([3, 2]);
      expect(c.spell, id).toBe(true);
    }
  });
});

describe('Golden Ale', () => {
  it('gains 2 Gold', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', embers: 5, board: [], hand: [spell('m', 'wo_mine')] };
    s = reduce(s, { type: 'play', uid: 'm' });
    expect(s.embers).toBe(7);
  });
});

describe("Champion's Ale", () => {
  it('buffs the LEFT-MOST minion only', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: board(3),
      hand: [spell('w', 'wo_champion')],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    const at = (uid: string) => { const m = s.board.find((c) => c.uid === uid)!; return [m.attack, m.health]; };
    expect(at('u0')).toEqual([7, 7]); // 1/1 + 6/6
    expect(at('u1')).toEqual([1, 1]);
    expect(at('u2')).toEqual([1, 1]);
  });

  it('fizzles cleanly on an empty board', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [spell('w', 'wo_champion')] };
    s = reduce(s, { type: 'play', uid: 'w' });
    expect(s.hand.some((c) => c.cardId === 'wo_champion')).toBe(false); // still consumed
    expect(s.board).toEqual([]);
  });
});

describe('Defensive / Bloody Ale', () => {
  it('Health buffs exactly 3 DISTINCT minions by +4 Health', () => {
    // Distinct matters: "3 random friendly minions" means three bodies, not three rolls that can double up.
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: board(5),
      hand: [spell('w', 'wo_health')],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    const buffed = s.board.filter((c) => c.health > 1);
    expect(buffed.length).toBe(3);
    for (const c of buffed) expect([c.attack, c.health]).toEqual([1, 5]); // health only
  });

  it('Attack buffs exactly 3 DISTINCT minions by +4 Attack', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: board(5),
      hand: [spell('w', 'wo_attack')],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    const buffed = s.board.filter((c) => c.attack > 1);
    expect(buffed.length).toBe(3);
    for (const c of buffed) expect([c.attack, c.health]).toEqual([5, 1]); // attack only
  });

  it('a board SMALLER than 3 just buffs everyone (no double-dipping)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: board(2),
      hand: [spell('w', 'wo_attack')],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    // Each gains +4 exactly once — a with-replacement pick could have put +8 on one and +0 on the other.
    for (const c of s.board) expect([c.attack, c.health]).toEqual([5, 1]);
  });

  it('is deterministic for a given RNG cursor', () => {
    const build = (): RunState => ({
      ...createRun(1), phase: 'recruit', rngCursor: 12345,
      board: board(5),
      hand: [spell('w', 'wo_attack')],
    });
    const pick = (s: RunState) => s.board.filter((c) => c.attack > 1).map((c) => c.uid).join(',');
    expect(pick(reduce(build(), { type: 'play', uid: 'w' })))
      .toBe(pick(reduce(build(), { type: 'play', uid: 'w' })));
  });
});

describe('Reinforcing Ale', () => {
  it('grants a minion of the dominant tribe, into hand', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', tier: 3,
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      board: board(3), // three distinct Beasts → beast is dominant
      hand: [spell('w', 'wo_reinforcement')],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    const granted = s.hand.filter((c) => c.cardId !== 'wo_reinforcement');
    expect(granted.length).toBe(1);
    const def = CARD_INDEX[granted[0]!.cardId]!;
    expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true);
    expect(def.tier).toBeLessThanOrEqual(3); // capped at the tavern tier
  });

  it('no-ops on an empty board (no dominant tribe) without stranding the spell', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', tier: 3, board: [], hand: [spell('w', 'wo_reinforcement')],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    expect(s.hand.some((c) => c.cardId === 'wo_reinforcement')).toBe(false); // consumed, not stuck
  });
});
