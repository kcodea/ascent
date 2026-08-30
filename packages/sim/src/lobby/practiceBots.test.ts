/**
 * PRACTICE OPTIONS — the sandbox knobs (owner ask 2026-08-24): bot opponents with a difficulty curve, a
 * health toggle (invulnerable vs real elimination), and a tribe surge that doubles a tribe's shop odds.
 */
import { describe, expect, it } from 'vitest';
import { practiceBotBoard, createLobbyRun, createPracticeBotLobby, adjectiveHandle } from './index';
import { reduce, type RunState, type Action } from '../index';
import { HEROES } from '../heroes';

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

describe('practice-bots placement reflects performance (owner bug 2026-08-24: won but finished 8th)', () => {
  const runToEnd = (attack: number): number | undefined => {
    let s: RunState = createLobbyRun(77, 'aster', {}, 'practice', {
      opponents: 'bots', botDifficulty: 'easy', health: 'unlimited', timeMult: 1, tribeSurge: null,
    });
    const board = Array.from({ length: 7 }, (_, i) => ({ uid: `p${i}`, cardId: 'b2_packstrider', attack, health: attack, keywords: [], effects: [], buffs: [] }));
    let guard = 0;
    while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 80) {
      if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' } as Action);
      if (s.questOffer?.length) s = reduce(s, { type: 'buyQuest', index: 0 } as Action);
      s = { ...s, board: board as never };
      for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
    }
    return s.lobby!.seats[0]!.placement;
  };

  it('a dominating run places 1st; a hopeless run does NOT (it used to fall back to dead-last)', () => {
    expect(runToEnd(80), 'beat every bot → 1st').toBe(1);
    expect(runToEnd(1), 'lost every fight → worse than 1st').toBeGreaterThan(1);
  });
});

describe('practice bots read as real opponents', () => {
  it('every bot has a REAL hero portrait (so its rail icon is not a broken image) and a non-"Bot N" name', () => {
    const valid = new Set(HEROES.map((h) => h.id));
    const lobby = createPracticeBotLobby(42, 'aster', 'medium');
    const names = new Set<string>();
    for (const seat of lobby.seats.slice(1)) {
      expect(valid.has(seat.heroId), `${seat.heroId} is not a real hero`).toBe(true);
      expect(seat.heroId).not.toBe('aster'); // never the player's own face
      expect(seat.label).not.toMatch(/^Bot \d+$/);
      names.add(seat.label.toLowerCase());
    }
    expect(names.size, 'names are unique').toBe(lobby.seats.length - 1);
  });
});

describe('duplicate lobby handles get an adjective, not "(2)"', () => {
  it('prefixes a distinct adjective per collision', () => {
    const taken = new Set(['orangez']);
    const a = adjectiveHandle('Orangez', 111, taken); taken.add(a.toLowerCase());
    const b = adjectiveHandle('Orangez', 111, taken);
    expect(a).toMatch(/ Orangez$/);
    expect(a).not.toMatch(/\(\d+\)/);
    expect(b).not.toBe(a); // a second duplicate gets a different adjective
  });
});

describe('practice bots sit at a real lobby seat (owner ask 2026-08-30)', () => {
  it('every bot starts on the SAME Resolve and Armor the player does', () => {
    const s = createLobbyRun(42, 'aster', {}, 'practice', {
      opponents: 'bots', botDifficulty: 'medium', health: 'normal', timeMult: 1, tribeSurge: null,
    } as never);
    const seats = s.lobby!.seats.filter((x) => x.id !== 's0');
    expect(seats.length, 'a full bot table').toBeGreaterThan(3);
    // The bug this pins: bots opened on round(30 * 0.6) - seatIndex, so the standings read 18/17/16/15/...
    // opposite the player's 30. Comparing against the PLAYER's seat rather than a literal keeps this honest
    // if starting Resolve is ever retuned.
    const me = s.lobby!.seats.find((x) => x.id === 's0')!;
    for (const seat of seats) {
      expect(seat.resolve, `${seat.label} starts on the player's Resolve`).toBe(me.resolve);
      expect(seat.armor, `${seat.label} starts on the player's Armor`).toBe(me.armor);
    }
    // …and no descending stagger hiding in there.
    expect(new Set(seats.map((x) => x.resolve)).size, 'no per-seat health stagger').toBe(1);
  });
});

describe('practice-bot games resolve on a sane clock (owner ask 2026-08-25: they ran far too long)', () => {
  /** Play a full bots game with a player board that scales at `skill` per wave (0 = do nothing). */
  const roundsToFinish = (difficulty: 'easy' | 'medium' | 'hard', skill: number): number => {
    let s: RunState = createLobbyRun(42, 'aster', {}, 'practice', {
      opponents: 'bots', botDifficulty: difficulty, health: 'normal', timeMult: 1, tribeSurge: null,
    });
    let rounds = 0;
    while (s.phase !== 'gameover' && rounds++ < 80) {
      if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' } as Action);
      if (s.questOffer?.length) s = reduce(s, { type: 'buyQuest', index: 0 } as Action);
      if (skill > 0) {
        const p = Math.round(6 + s.wave * skill);
        s = { ...s, board: Array.from({ length: 7 }, (_, i) => ({ uid: `p${i}`, cardId: 'b2_packstrider', attack: p, health: p, keywords: [], effects: [], buffs: [] })) as never };
      }
      for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
    }
    return rounds;
  };

  it('a WINNING player finishes in a reasonable number of rounds (was ~25 — the bots never thinned out)', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const rounds = roundsToFinish(d, 7);
      expect(rounds, `${d}: a dominant run should not drag`).toBeLessThanOrEqual(15);
      expect(rounds, `${d}: …but it should still be a real game`).toBeGreaterThan(3);
    }
  });

  it('a do-nothing player is eliminated quickly, and harder bots kill faster', () => {
    const easy = roundsToFinish('easy', 0);
    const hard = roundsToFinish('hard', 0);
    expect(easy).toBeLessThanOrEqual(12);
    expect(hard, 'hard bots finish a hopeless run sooner than easy ones').toBeLessThan(easy);
  });
});
