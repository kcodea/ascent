/**
 * PRACTICE OPTIONS — the sandbox knobs (owner ask 2026-08-24): bot opponents with a difficulty curve, a
 * health toggle (invulnerable vs real elimination), and a tribe surge that doubles a tribe's shop odds.
 */
import { describe, expect, it } from 'vitest';
import { practiceBotBoard, createLobbyRun, createPracticeBotLobby, adjectiveHandle, BOT_LEVELS, UTILITY_ROSTER, UTILITY_FROM_ROUND, botTierFor, eligibleUtility, normalizeBotDifficulty, authoredTierFor, omenBoardMinions, type BotLevel } from './index';
import { reduce, type RunState, type Action } from '../index';
import { HEROES } from '../heroes';

const totals = (b: { attack: number; health: number }[]) => ({
  atk: b.reduce((n, m) => n + m.attack, 0),
  hp: b.reduce((n, m) => n + m.health, 0),
  n: b.length,
});

describe('practiceBotBoard — the authored NORMAL table', () => {
  it('matches the owner-supplied baseline sums (spot-checked rounds)', () => {
    expect(totals(practiceBotBoard(1, 3))).toEqual({ atk: 2, hp: 1, n: 1 });
    expect(totals(practiceBotBoard(4, 3))).toEqual({ atk: 10, hp: 10, n: 3 });
    expect(totals(practiceBotBoard(7, 3))).toEqual({ atk: 42, hp: 44, n: 5 });
    expect(totals(practiceBotBoard(8, 3))).toEqual({ atk: 82, hp: 88, n: 6 });
    expect(totals(practiceBotBoard(16, 3))).toEqual({ atk: 952, hp: 992, n: 7 });
  });

  it('grows on both axes and is front-loaded (biggest on the left)', () => {
    const r10 = practiceBotBoard(10, 3);
    for (let i = 1; i < r10.length; i++) expect(r10[i]!.attack).toBeLessThanOrEqual(r10[i - 1]!.attack);
    expect(totals(practiceBotBoard(12, 3)).atk).toBeGreaterThan(totals(practiceBotBoard(8, 3)).atk);
  });
});

describe('difficulty scales the right rounds', () => {
  it('level 1 (the old Easy) weakens rounds 4+ but leaves the 1–3 opening identical', () => {
    for (const r of [1, 2, 3]) {
      expect(practiceBotBoard(r, 1)).toEqual(practiceBotBoard(r, 3));
    }
    for (const r of [4, 8, 16]) {
      expect(totals(practiceBotBoard(r, 1)).atk).toBeLessThan(totals(practiceBotBoard(r, 3)).atk);
    }
  });

  it('level 5 (the old Hard) strengthens rounds 7+ but leaves rounds 1–6 identical', () => {
    for (const r of [1, 4, 6]) {
      expect(practiceBotBoard(r, 5)).toEqual(practiceBotBoard(r, 3));
    }
    for (const r of [7, 12, 16]) {
      expect(totals(practiceBotBoard(r, 5)).atk).toBeGreaterThan(totals(practiceBotBoard(r, 3)).atk);
    }
  });
});

describe('createLobbyRun — Practice opponents', () => {
  it('BOTS opponents seat seven authored omen bots; PLAYERS seat recorded/hybrid runs', () => {
    const bots = createLobbyRun(7, 'aster', {}, 'practice', {
      opponents: 'bots', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribeSurge: null,
    });
    expect(bots.mode).toBe('practice');
    expect(bots.practiceConfig?.opponents).toBe('bots');
    for (const seat of bots.lobby!.seats.slice(1)) expect(seat.kind).toBe('authored');

    const players = createLobbyRun(7, 'aster', {}, 'practice', {
      opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribeSurge: null,
    });
    for (const seat of players.lobby!.seats.slice(1)) expect(seat.kind).not.toBe('authored');
  });
});

describe('health: unlimited vs normal', () => {
  const cfg = (health: 'unlimited' | 'normal') => ({
    opponents: 'bots' as const, botDifficulty: 5 as const, health, timeMult: 1 as const, tribeSurge: null,
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
        opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribeSurge,
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
      opponents: 'bots', botDifficulty: 1, health: 'unlimited', timeMult: 1, tribeSurge: null,
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
    const lobby = createPracticeBotLobby(42, 'aster', 3);
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
      opponents: 'bots', botDifficulty: 3, health: 'normal', timeMult: 1, tribeSurge: null,
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
  const roundsToFinish = (difficulty: BotLevel, skill: number): number => {
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
    for (const d of [1, 3, 5, 8, 10] as const) {
      const rounds = roundsToFinish(d, 7);
      expect(rounds, `${d}: a dominant run should not drag`).toBeLessThanOrEqual(15);
      expect(rounds, `${d}: …but it should still be a real game`).toBeGreaterThan(3);
    }
  });

  it('a do-nothing player is eliminated quickly, and harder bots kill faster', () => {
    const easy = roundsToFinish(1, 0);
    const hard = roundsToFinish(5, 0);
    expect(easy).toBeLessThanOrEqual(12);
    expect(hard, 'hard bots finish a hopeless run sooner than easy ones').toBeLessThan(easy);
  });
});

describe('the 1–10 ladder (owner ask 2026-09-02: 5 = the old Hard)', () => {
  it('every level is monotone: stats, damage and opening tier never go DOWN as the level rises', () => {
    for (let l = 2; l <= 10; l++) {
      const lo = BOT_LEVELS[(l - 1) as BotLevel], hi = BOT_LEVELS[l as BotLevel];
      expect(hi.damageMult, `damage ${l}`).toBeGreaterThan(lo.damageMult);
      expect(hi.statMult, `stats ${l}`).toBeGreaterThanOrEqual(lo.statMult);
      expect(hi.tierRamp, `ramp ${l}`).toBeLessThanOrEqual(lo.tierRamp);
      expect(hi.startTier, `start tier ${l}`).toBeGreaterThanOrEqual(lo.startTier);
      expect(totals(practiceBotBoard(12, l as BotLevel)).hp, `r12 health ${l}`)
        .toBeGreaterThanOrEqual(totals(practiceBotBoard(12, (l - 1) as BotLevel)).hp);
    }
  });

  it('rounds 1–3 are the same gentle opening at EVERY level (stats only — utility may swap identity)', () => {
    for (let l = 1; l <= 10; l++) for (const r of [1, 2, 3]) {
      const b = practiceBotBoard(r, l as BotLevel).map((m) => ({ h: m.health }));
      expect(b).toEqual(practiceBotBoard(r, 3).map((m) => ({ h: m.health })));
    }
  });

  it("levels 1–5 are pure omens; 6+ field the level's utility slots once the roster is in tier", () => {
    for (let l = 1; l <= 5; l++) for (let r = 1; r <= 16; r++) {
      for (const m of practiceBotBoard(r, l as BotLevel)) expect(m.cardId).toBeUndefined();
    }
    for (let l = 6; l <= 10; l++) {
      // Utility is a per-round ROLL, so scan seats for one that fired; when it fires it fills every slot.
      let fired = 0;
      for (let seed = 0; seed < 30; seed++) {
        const real = practiceBotBoard(12, l as BotLevel, { seatSeed: seed }).filter((m) => m.cardId);
        if (real.length === 0) continue;
        fired++;
        expect(real.length, `level ${l} fills its slots when it fires`).toBe(BOT_LEVELS[l as BotLevel].utilitySlots);
        for (const m of real) expect(UTILITY_ROSTER.some((u) => u.cardId === m.cardId), `${m.cardId} is on the roster`).toBe(true);
      }
      expect(fired, `level ${l} fires on SOME seats`).toBeGreaterThan(0);
      expect(fired, `level ${l} does NOT fire on every seat`).toBeLessThan(30);
    }
  });

  it("a utility unit is never fielded before its unlock level or above the bot's current tier", () => {
    for (let l = 6; l <= 10; l++) for (let r = 1; r <= 16; r++) for (let seat = 0; seat < 7; seat++) {
      const tier = botTierFor(l as BotLevel, r);
      for (const m of practiceBotBoard(r, l as BotLevel, { seatSeed: 100 + seat, spreadIndex: seat })) {
        if (!m.cardId) continue;
        const u = UTILITY_ROSTER.find((x) => x.cardId === m.cardId)!;
        expect(u.unlock, `${m.cardId} at level ${l}`).toBeLessThanOrEqual(l);
        expect(CARD_INDEX[m.cardId]!.tier, `${m.cardId} r${r} tier ${tier}`).toBeLessThanOrEqual(tier);
      }
    }
    // NEVER before round 7, whatever the level or tier (owner report 2026-09-02: tier-4 cards on turn 2).
    for (let l = 6; l <= 10; l++) for (let r = 1; r < UTILITY_FROM_ROUND; r++) for (let seed = 0; seed < 20; seed++) {
      for (const m of practiceBotBoard(r, l as BotLevel, { seatSeed: seed })) expect(m.cardId, `level ${l} r${r}`).toBeUndefined();
    }
    expect(eligibleUtility(10, UTILITY_FROM_ROUND - 1)).toEqual([]);
    // Thane (tier 6, unlock 10) exists on the ladder and can actually appear at the top.
    expect(eligibleUtility(10, 16).some((u) => u.cardId === 'dw_thane')).toBe(true);
    expect(eligibleUtility(9, 16).some((u) => u.cardId === 'dw_thane')).toBe(false);
  });

  it("utility units take the SLOT's stats — except Venom, pinned at 1 Attack (owner ruling)", () => {
    let sawVenom = false, sawOther = false;
    const omenHp = practiceBotBoard(12, 3).map((m) => m.health);
    for (let seat = 0; seat < 40; seat++) {
      const b = practiceBotBoard(12, 10, { seatSeed: seat });
      b.forEach((m, i) => {
        if (!m.cardId) return;
        // Slot stats: the health is the authored (scaled) slot health, not the card's printed line.
        expect(m.health).toBe(Math.round(omenHp[i]! * BOT_LEVELS[10].statMult));
        if (m.cardId === 'venom') { sawVenom = true; expect(m.attack).toBe(1); }
        else { sawOther = true; expect(m.attack).toBeGreaterThan(10); }
      });
    }
    expect(sawVenom && sawOther).toBe(true);
  });

  it('utility slots materialize as REAL cards with their printed keywords; omens stay keywordless', () => {
    const minions = omenBoardMinions([{ attack: 9, health: 9 }, { attack: 9, health: 9, cardId: 'dm_felspikes' }]);
    expect(minions[0]).toEqual({ cardId: 'omen', attack: 9, health: 9, keywords: [] });
    expect(minions[1]!.cardId).toBe('dm_felspikes');
    expect(minions[1]!.keywords, 'absent → instantiate uses the CardDef keywords (Taunt)').toBeUndefined();
  });

  it('the top levels open above tier 1 and the seat driver agrees with botTierFor', () => {
    expect(botTierFor(10, 1)).toBe(3);
    expect(botTierFor(10, 4)).toBe(6);
    expect(botTierFor(1, 1)).toBe(1);
    expect(botTierFor(1, 4)).toBe(2);
    const lobby = createPracticeBotLobby(9, 'aster', 10);
    const seat = lobby.seats[1]!;
    for (const r of [1, 3, 6, 12]) expect(authoredTierFor(seat, r)).toBe(botTierFor(10, r));
  });

  it('seats draw DIFFERENT utility units and a rebuild redraws the same ones', () => {
    const a = createPracticeBotLobby(9, 'aster', 10);
    const b = createPracticeBotLobby(9, 'aster', 10);
    expect(a.seats.map((s) => s.authoredBoards)).toEqual(b.seats.map((s) => s.authoredBoards));
    const ids = a.seats.slice(1).map((s) => s.authoredBoards![11]!.filter((m) => m.cardId).map((m) => m.cardId).join(','));
    expect(new Set(ids).size, 'not every seat fields the identical utility trio').toBeGreaterThan(1);
  });

  it('a level-10 bot board fights through simulate without blowing up (effects actually run)', () => {
    let s: RunState = createLobbyRun(5, 'aster', {}, 'practice', {
      opponents: 'bots', botDifficulty: 10, health: 'normal', timeMult: 1, tribeSurge: null,
    });
    s = { ...s, wave: 12, lobby: { ...s.lobby!, round: 12 } };
    const board = Array.from({ length: 7 }, (_, i) => ({ uid: `p${i}`, cardId: 'b2_packstrider', attack: 60, health: 60, keywords: [], effects: [], buffs: [] }));
    s = { ...s, board: board as never };
    s = reduce(s, { type: 'faceOmen' } as Action);
    expect(s.lastCombat, 'combat resolved').toBeTruthy();
    const fielded = s.lobby!.seats.slice(1).some((seat) => seat.authoredBoards![11]!.some((m) => m.cardId));
    expect(fielded, 'some seat fields a utility unit on round 12').toBe(true);
  });

  it('legacy easy/medium/hard strings (old saves + drafts) normalize onto the ladder', () => {
    expect(normalizeBotDifficulty('easy')).toBe(1);
    expect(normalizeBotDifficulty('medium')).toBe(3);
    expect(normalizeBotDifficulty('hard')).toBe(5);
    expect(normalizeBotDifficulty(7)).toBe(7);
    expect(normalizeBotDifficulty('9')).toBe(9);
    expect(normalizeBotDifficulty(42)).toBe(10);
    expect(normalizeBotDifficulty(undefined)).toBe(3);
    expect(normalizeBotDifficulty('nonsense')).toBe(3);
  });
});
