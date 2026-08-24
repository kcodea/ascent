/**
 * PRACTICE OPTIONS — the sandbox knobs (owner ask 2026-08-24): bot opponents with a difficulty curve, a
 * health toggle (invulnerable vs real elimination), and a tribe surge that doubles a tribe's shop odds.
 */
import { describe, expect, it } from 'vitest';
import { practiceBotBoard, createLobbyRun } from './index';
import { reduce, type RunState, type Action } from '../index';

const totals = (b: { attack: number; health: number }[]) => ({
  atk: b.reduce((n, m) => n + m.attack, 0),
  hp: b.reduce((n, m) => n + m.health, 0),
  n: b.length,
});

describe('practiceBotBoard — the authored NORMAL table', () => {
  it('matches the owner-supplied baseline sums (spot-checked rounds)', () => {
    expect(totals(practiceBotBoard(1, 'medium'))).toEqual({ atk: 2, hp: 1, n: 1 });
    expect(totals(practiceBotBoard(4, 'medium'))).toEqual({ atk: 10, hp: 10, n: 3 });
    expect(totals(practiceBotBoard(7, 'medium'))).toEqual({ atk: 42, hp: 44, n: 5 });
    expect(totals(practiceBotBoard(8, 'medium'))).toEqual({ atk: 82, hp: 88, n: 6 });
    expect(totals(practiceBotBoard(16, 'medium'))).toEqual({ atk: 952, hp: 992, n: 7 });
  });

  it('grows on both axes and is front-loaded (biggest on the left)', () => {
    const r10 = practiceBotBoard(10, 'medium');
    for (let i = 1; i < r10.length; i++) expect(r10[i]!.attack).toBeLessThanOrEqual(r10[i - 1]!.attack);
    expect(totals(practiceBotBoard(12, 'medium')).atk).toBeGreaterThan(totals(practiceBotBoard(8, 'medium')).atk);
  });
});

describe('difficulty scales the right rounds', () => {
  it('EASY weakens rounds 4+ but leaves the 1–3 opening identical', () => {
    for (const r of [1, 2, 3]) {
      expect(practiceBotBoard(r, 'easy')).toEqual(practiceBotBoard(r, 'medium'));
    }
    for (const r of [4, 8, 16]) {
      expect(totals(practiceBotBoard(r, 'easy')).atk).toBeLessThan(totals(practiceBotBoard(r, 'medium')).atk);
    }
  });

  it('HARD strengthens rounds 7+ but leaves rounds 1–6 identical', () => {
    for (const r of [1, 4, 6]) {
      expect(practiceBotBoard(r, 'hard')).toEqual(practiceBotBoard(r, 'medium'));
    }
    for (const r of [7, 12, 16]) {
      expect(totals(practiceBotBoard(r, 'hard')).atk).toBeGreaterThan(totals(practiceBotBoard(r, 'medium')).atk);
    }
  });
});

describe('createLobbyRun — Practice opponents', () => {
  it('BOTS opponents seat seven authored omen bots; PLAYERS seat recorded/hybrid runs', () => {
    const bots = createLobbyRun(7, 'aster', {}, 'practice', {
      opponents: 'bots', botDifficulty: 'medium', health: 'unlimited', timeMult: 1, tribeSurge: null,
    });
    expect(bots.mode).toBe('practice');
    expect(bots.practiceConfig?.opponents).toBe('bots');
    for (const seat of bots.lobby!.seats.slice(1)) expect(seat.kind).toBe('authored');

    const players = createLobbyRun(7, 'aster', {}, 'practice', {
      opponents: 'players', botDifficulty: 'medium', health: 'unlimited', timeMult: 1, tribeSurge: null,
    });
    for (const seat of players.lobby!.seats.slice(1)) expect(seat.kind).not.toBe('authored');
  });
});

describe('health: unlimited vs normal', () => {
  const cfg = (health: 'unlimited' | 'normal') => ({
    opponents: 'bots' as const, botDifficulty: 'hard' as const, health, timeMult: 1 as const, tribeSurge: null,
  });
  const playARound = (s: RunState): RunState => {
    for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
    return s;
  };

  it('UNLIMITED keeps the seat invulnerable through a lost fight', () => {
    // A do-nothing board vs a hard bot loses; the invulnerable seat must survive with full resolve.
    let s = createLobbyRun(3, 'aster', {}, 'practice', cfg('unlimited'));
    // Jump to a wave where the hard bot board is lethal.
    s = { ...s, wave: 10, lobby: { ...s.lobby!, round: 10 } };
    s = playARound(s);
    expect(s.lobby!.seats[0]!.alive).toBe(true);
    expect(s.phase).not.toBe('gameover');
  });

  it('NORMAL takes real damage and can end the run', () => {
    let s = createLobbyRun(3, 'aster', {}, 'practice', cfg('normal'));
    s = { ...s, wave: 12, lobby: { ...s.lobby!, round: 12 } };
    const before = s.resolve;
    // Play rounds until the run ends or resolve drops — a do-nothing board against a round-12 hard bot loses.
    let guard = 0;
    while (s.phase !== 'gameover' && guard++ < 20) s = playARound(s);
    expect(s.resolve, 'normal health lets the bots actually chip resolve').toBeLessThan(before);
  });
});

describe('tribe surge doubles a tribe in the shop', () => {
  it('a beast surge yields more Beast offers than the same seed without it', () => {
    const roll = (tribeSurge: 'beast' | null): number => {
      let s = createLobbyRun(11, 'aster', {}, 'practice', {
        opponents: 'players', botDifficulty: 'medium', health: 'unlimited', timeMult: 1, tribeSurge,
      });
      // Tier up so the pool is broad, then reroll many times and count Beast offers.
      s = { ...s, tier: 4, embers: 999, maxEmbers: 999 };
      let beasts = 0;
      for (let i = 0; i < 60; i++) {
        s = reduce(s, { type: 'roll' } as Action);
        beasts += s.shop.filter((o) => (poolTribe(o.cardId) === 'beast')).length;
      }
      return beasts;
    };
    const surged = roll('beast');
    const flat = roll(null);
    // With 2× weight the surged count should be clearly higher — allow slack, but it must not be a tie/lower.
    expect(surged).toBeGreaterThan(flat);
  });
});

// Local helper: a card's tribe by id (the test only needs Beast identification).
import { CARD_INDEX } from '@game/content';
function poolTribe(cardId: string): string {
  return CARD_INDEX[cardId]?.tribe ?? 'neutral';
}
