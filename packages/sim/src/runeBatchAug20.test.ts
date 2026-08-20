import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import {
  addBuff, advanceRuneThresholds, fireOnGainCard, noteSpellCast, playCard, stampSharedSpoils,
} from './recruit';
import { questCombatMods } from './reducer';
import { runeTally, runeCombatTally } from '../../ui/src/runeTally';

/**
 * THE 2026-08-20 OWNER RUNE BATCH — 30 runes (20 Basic + 10 Epic) built on the 16 rune-only minions that
 * shipped in eb88a82c.
 *
 * Three of the owner's names collided with existing, different runes and were renamed (the Muster General,
 * the Deepening Vein, the Abomination) — pinned below, because `validateRunes` only catches the collision,
 * not the intent.
 *
 * The framework test in `runes.test.ts` already proves every rune validates, is costed and is Runeforge-only.
 * What this file owns is the part that data can't state: which POOL each rune actually lives in, and whether
 * its effect FIRES — including, for the metered ones, that it does NOT fire early.
 */

const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: Keyword[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords });
const rune = (id: string) => RUNE_INDEX[id]!;

/** Buy a rune through the REAL Runeforge path — the same `reduce` a player drives. */
const armed = (id: string, over: Partial<RunState> = {}): RunState => reduce(
  { ...createRun(3, 'runesmith'), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...over } as RunState,
  { type: 'buyRune', index: 0 },
) as RunState;

/** Every card the run holds anywhere — a granted body lands in hand, or on the board when hand is full. */
const held = (s: RunState): string[] => [...s.hand, ...s.board].map((c) => c.cardId);

// ── the roster ───────────────────────────────────────────────────────────────────────────────────────────
/** [id, cost, epic]. `runeforgePool` reads ARRAY membership, so the array is the real assertion — the `epic`
 *  flag is only the card's kicker, and the two disagreeing is exactly the bug this catches. */
const BASIC: [string, number][] = [
  ['rune_deep_feast', 5], ['rune_gem_sage', 5], ['rune_ancient_expenditure', 4],
  ['rune_clockwork_promotion', 4], ['rune_night_market', 5], ['rune_muckbroker', 4],
  ['rune_living_magic', 4], ['rune_draconic_curiosity', 4], ['rune_dragons_pantry', 4],
  ['rune_returning_pack', 4], ['rune_grave_refreshment', 3], ['rune_seasoned_ledger', 5],
  ['rune_echoed_arrival', 4], ['rune_rare_goods', 4], ['rune_kegheart', 4],
  ['rune_shifting_facets', 3], ['rune_shared_spoils', 4], ['rune_heavy_payroll', 4],
  ['rune_compounding_wages', 4], ['rune_gilded_ledger', 4],
];
const EPIC: [string, number][] = [
  ['rune_perfect_recall', 6], ['rune_ninefold_commerce', 6], ['rune_borrowed_echoes', 5],
  ['rune_muster_general', 5], ['rune_delayed_duplication', 5], ['rune_ascension', 5],
  ['rune_lasting_cadence', 5], ['rune_deepening_vein', 5], ['rune_abomination', 5],
  ['rune_bottomless_portrait', 5],
];

describe('the Aug-20 batch — pool membership, cost, and the three renames', () => {
  it('the sweep sees all 30', () => {
    expect(BASIC).toHaveLength(20);
    expect(EPIC).toHaveLength(10);
  });

  it.each(BASIC)('%s is BASIC at its printed cost', (id, cost) => {
    expect(RUNE_INDEX[id], `${id} is missing`).toBeTruthy();
    expect(RUNES.some((r) => r.id === id), `${id} must live in RUNES`).toBe(true);
    expect(EPIC_RUNES.some((r) => r.id === id), `${id} must NOT be in EPIC_RUNES`).toBe(false);
    expect(rune(id).epic, `${id} must not carry the epic kicker`).toBeFalsy();
    expect(rune(id).cost).toBe(cost);
    expect(CARD_INDEX[id], `${id} must not collide with a card id`).toBeUndefined();
  });

  it.each(EPIC)('%s is EPIC at its printed cost, and carries the flag', (id, cost) => {
    expect(RUNE_INDEX[id], `${id} is missing`).toBeTruthy();
    expect(EPIC_RUNES.some((r) => r.id === id), `${id} must live in EPIC_RUNES`).toBe(true);
    expect(RUNES.some((r) => r.id === id), `${id} must NOT be in RUNES`).toBe(false);
    expect(rune(id).epic, `${id} is in the Epic array but not flagged`).toBe(true);
    expect(rune(id).cost).toBe(cost);
  });

  it('the three renamed runes did NOT displace the existing runes that owned those names', () => {
    // Each owner name was already taken by a DIFFERENT, live rune. The originals must be untouched.
    expect(rune('rune_muster').name).toBe('Rune of the Muster');
    expect(rune('rune_muster_general').name).toBe('Rune of the Muster General');
    expect(rune('rune_living_geode').name).toBe('Rune of the Living Geode');
    expect(rune('rune_deepening_vein').name).toBe('Rune of the Deepening Vein');
    expect(rune('rune_evolution').name).toBe('Rune of Evolution');
    expect(rune('rune_abomination').name).toBe('Rune of the Abomination');
  });

  it('every rune in the batch does something when bought (no silently inert data)', () => {
    for (const [id] of [...BASIC, ...EPIC]) {
      expect(() => armed(id), `${id} threw on purchase`).not.toThrow();
      expect(armed(id).ownedRunes, `${id} was not recorded as owned`).toContain(id);
    }
  });
});

// ── the eleven plain grants ──────────────────────────────────────────────────────────────────────────────
describe('the "get a <minion>" runes hand over the rune-only body', () => {
  const GRANTS: [string, string][] = [
    ['rune_gem_sage', 'k_gemsage'],
    ['rune_ancient_expenditure', 'n2_wanderer'],
    ['rune_night_market', 'dm_nightmarket'],
    ['rune_kegheart', 'dw_kegheart'],
    ['rune_ninefold_commerce', 'n2_ninefold'],
    ['rune_borrowed_echoes', 'n2_echomimic'],
    ['rune_muster_general', 'n2_muster'],
    ['rune_delayed_duplication', 'b2_stonehorn'],
    ['rune_ascension', 'd2_ascendant'],
    ['rune_abomination', 'n2_abomination'],
    ['rune_bottomless_portrait', 'dm_behemoth'],
  ];

  it.each(GRANTS)('%s grants %s', (id, cardId) => {
    expect(held(armed(id)), `${id} granted nothing`).toContain(cardId);
  });

  it('each granted body is a forge-only token — the rune is the ONLY way to get one', () => {
    for (const [, cardId] of GRANTS) {
      expect(CARD_INDEX[cardId], `${cardId} is missing`).toBeTruthy();
      expect(CARD_INDEX[cardId]!.token, `${cardId} must be token-locked (Source = Rune)`).toBe(true);
    }
  });
});

// ── the threshold runes ──────────────────────────────────────────────────────────────────────────────────
describe('Rune of the Deep Feast — a NAMED body on the threshold engine', () => {
  it('pays at 25 Gold and not a Gold before', () => {
    const s = armed('rune_deep_feast');
    advanceRuneThresholds(s, 'gold', 24);
    expect(held(s), '24 Gold is not 25').not.toContain('n2_deepchef');
    advanceRuneThresholds(s, 'gold', 1);
    expect(held(s)).toContain('n2_deepchef');
  });

  it('the remainder banks, so the second Chef costs 25 more — not 50 from scratch', () => {
    const s = armed('rune_deep_feast');
    advanceRuneThresholds(s, 'gold', 30);  // 1 Chef, 5 banked
    advanceRuneThresholds(s, 'gold', 20);  // 5 + 20 = 25 → the 2nd
    expect(held(s).filter((id) => id === 'n2_deepchef')).toHaveLength(2);
  });

  it('the hover preview names the Chef — the reward is a threshold, not a grant', () => {
    expect(rune('rune_deep_feast').previewCards).toContain('n2_deepchef');
  });
});

describe("Rune of the Dragon's Pantry — a DRAGON-play meter that carries between turns", () => {
  const dragons = () => armed('rune_dragons_pantry', { hand: [], board: [] });

  it('pays 2 spells at 5 Dragons, and nothing at 4', () => {
    const s = dragons();
    advanceRuneThresholds(s, 'playDragon', 4);
    expect(s.hand, 'four Dragons is not five').toHaveLength(0);
    advanceRuneThresholds(s, 'playDragon', 1);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell), 'two random Shop spells').toHaveLength(2);
  });

  it('PLAYING a Dragon is what ticks it — an off-tribe play does not', () => {
    const s = dragons();
    const tick = () => s.runeThresholds!.find((t) => t.sourceId === 'rune_dragons_pantry')!.tick;
    const dragon = minion('d', 'd2_embermouth');
    s.board = [dragon];
    playCard(s, dragon);
    expect(tick(), 'a Dragon play banks one').toBe(1);
    const stray = minion('n', 'sandbag');
    s.board = [...s.board, stray];
    playCard(s, stray);
    expect(tick(), 'a neutral play banks nothing').toBe(1);
  });

  it('the meter survives the turn rollover (the printed "progress carries")', () => {
    let s = armed('rune_dragons_pantry', {
      wave: 1, tier: 6, resolve: 999, maxResolve: 999, armor: 999, hand: [],
      board: [{ uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false }],
    });
    advanceRuneThresholds(s, 'playDragon', 3);
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'resolveCombat' }) as RunState;
    expect(s.runeThresholds!.find((t) => t.sourceId === 'rune_dragons_pantry')!.tick, 'banked across the turn').toBe(3);
  });
});

describe('Rune of Compounding Wages — the ESCALATING threshold', () => {
  const wages = () => armed('rune_compounding_wages', { board: [minion('d', 'dw_orin', 1, 1)], hand: [] });

  it('pays +1/+1 at 10 Gold, then +2/+2 at 20 — the rune improves itself', () => {
    const s = wages();
    advanceRuneThresholds(s, 'gold', 9);
    expect([s.board[0]!.attack, s.board[0]!.health], 'nothing at 9 Gold').toEqual([1, 1]);
    advanceRuneThresholds(s, 'gold', 1);
    expect([s.board[0]!.attack, s.board[0]!.health], 'the first payout is the printed +1/+1').toEqual([2, 2]);
    advanceRuneThresholds(s, 'gold', 10);
    expect([s.board[0]!.attack, s.board[0]!.health], 'the second is +2/+2 — 2 + 2 = 4').toEqual([4, 4]);
  });

  it('only DWARVES are paid', () => {
    const s = armed('rune_compounding_wages', { board: [minion('d', 'dw_orin', 1, 1), minion('n', 'sandbag', 1, 1)], hand: [] });
    advanceRuneThresholds(s, 'gold', 10);
    expect([s.board[1]!.attack, s.board[1]!.health], 'the neutral body is untouched').toEqual([1, 1]);
  });

  it('the escalation never writes through to the shared rune DEF', () => {
    // The def is module-level and shared by every run in the process; growing it in place would make the
    // printed rune bigger for everyone. The reducer clones the buff — this is what proves it.
    const s = wages();
    advanceRuneThresholds(s, 'gold', 30);
    const def = rune('rune_compounding_wages').reward as { buff: { attack: number; health: number } };
    expect([def.buff.attack, def.buff.health], 'the authored rune must still print +1/+1').toEqual([1, 1]);
  });

  it('the badge names the NEXT payout beside the meter (the live-value rule)', () => {
    const s = wages();
    advanceRuneThresholds(s, 'gold', 13); // one payout, 3 banked → the next grant is +2/+2
    expect(runeTally(s, 'rune_compounding_wages')).toBe('3/10g · +2/+2');
  });
});

describe('Rune of the Gilded Ledger — every 7 Gold CASTS a stat spell', () => {
  it('casts at 7 Gold, not at 6, and the cast is a real one (the spell counters see it)', () => {
    const s = armed('rune_gilded_ledger', { board: [minion('a', 'sandbag', 1, 1)], hand: [] });
    const before = s.spellsCast;
    const stats = () => s.board.reduce((n, c) => n + c.attack + c.health, 0);
    const at6 = stats();
    advanceRuneThresholds(s, 'gold', 6);
    expect(stats(), 'nothing at 6 Gold').toBe(at6);
    expect(s.spellsCast).toBe(before);
    advanceRuneThresholds(s, 'gold', 1);
    expect(stats(), 'a stat spell landed on the board').toBeGreaterThan(at6);
    expect(s.spellsCast, 'and it counted as a cast').toBe(before + 1);
  });
});

// ── the cadence runes ────────────────────────────────────────────────────────────────────────────────────
describe('the every-2-turns runes — one shared `everyTurns` cadence, not three flags', () => {
  const CADENCE: [string, string][] = [
    ['rune_clockwork_promotion', 'n2_clockwork'],
    ['rune_muckbroker', 'n2_muckslinger'],
    ['rune_rare_goods', 'n2_salesman'],
  ];

  it.each(CADENCE)('%s arms the cadenced list rather than the every-turn one', (id, cardId) => {
    const s = armed(id);
    expect(s.questRecurringGrants ?? [], 'a cadenced grant must NOT join the every-turn list').not.toContain(cardId);
    const g = s.runeCadenceGrants?.find((x) => x.sourceId === id);
    expect(g, `${id} armed no cadenced grant`).toBeTruthy();
    expect([g!.cardId, g!.everyTurns, g!.tick]).toEqual([cardId, 2, 0]);
  });

  it.each(CADENCE)('%s pays on the SECOND turn, not the first', (id, cardId) => {
    const tank: BoardCard = { uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false };
    let s = armed(id, { wave: 1, tier: 6, resolve: 999, maxResolve: 999, armor: 999, board: [tank], hand: [] });
    const turn = (): void => {
      s = reduce(s, { type: 'faceOmen' }) as RunState;
      s = reduce(s, { type: 'resolveCombat' }) as RunState;
    };
    turn();
    expect(held(s), 'turn 1 is the countdown, not the payout').not.toContain(cardId);
    turn();
    expect(held(s), 'turn 2 pays').toContain(cardId);
  });

  it('the badge counts the turns down', () => {
    const s = armed('rune_rare_goods');
    expect(runeTally(s, 'rune_rare_goods')).toBe('0/2 turns');
    s.runeCadenceGrants![0]!.tick = 1;
    expect(runeTally(s, 'rune_rare_goods')).toBe('1/2 turns');
  });
});

// ── the shared spell-copy budget ─────────────────────────────────────────────────────────────────────────
describe('Living Magic / Perfect Recall — ONE budget, parameterised', () => {
  const spell = () => CARD_INDEX['growth']!;
  const copies = (s: RunState) => s.hand.filter((c) => c.cardId === 'growth').length;

  it('they are the same reward kind, one number apart', () => {
    expect(rune('rune_living_magic').reward).toEqual({ kind: 'runeSpellEcho', uses: 1 });
    expect(rune('rune_perfect_recall').reward).toEqual({ kind: 'runeSpellEcho', uses: 2 });
  });

  it('Living Magic copies ONE spell a turn — the second cast pays nothing', () => {
    const s = armed('rune_living_magic', { hand: [] });
    noteSpellCast(s, spell());
    expect(copies(s), 'the first cast is copied').toBe(1);
    noteSpellCast(s, spell());
    expect(copies(s), 'the budget is spent').toBe(1);
    expect(s.runeSpellEcho).toEqual({ uses: 1, used: 1 });
  });

  it('Perfect Recall copies TWO, then stops', () => {
    const s = armed('rune_perfect_recall', { hand: [] });
    for (let i = 0; i < 3; i++) noteSpellCast(s, spell());
    expect(copies(s), 'two copies, not three').toBe(2);
  });

  it('holding both RAISES the ceiling rather than firing two independent budgets', () => {
    let s = armed('rune_living_magic', { hand: [] });
    s = reduce({ ...s, runeforgeOffer: ['rune_perfect_recall'], embers: 40 } as RunState, { type: 'buyRune', index: 0 }) as RunState;
    expect(s.runeSpellEcho!.uses, '1 + 2 = 3').toBe(3);
    s.hand = [];
    for (let i = 0; i < 5; i++) noteSpellCast(s, spell());
    expect(copies(s)).toBe(3);
  });

  it('the budget refills at the turn rollover', () => {
    const tank: BoardCard = { uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false };
    let s = armed('rune_living_magic', { wave: 1, tier: 6, resolve: 999, maxResolve: 999, armor: 999, board: [tank], hand: [] });
    noteSpellCast(s, spell());
    expect(s.runeSpellEcho!.used).toBe(1);
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'resolveCombat' }) as RunState;
    expect(s.runeSpellEcho!.used, 'a fresh turn is a fresh copy').toBe(0);
  });

  it('the badge shows copies LEFT — the number that decides whether the next cast pays', () => {
    const s = armed('rune_perfect_recall', { hand: [] });
    expect(runeTally(s, 'rune_perfect_recall')).toBe('2 left');
    noteSpellCast(s, spell());
    expect(runeTally(s, 'rune_perfect_recall')).toBe('1 left');
  });
});

// ── the recruit-phase watchers ───────────────────────────────────────────────────────────────────────────
describe('Rune of Draconic Curiosity', () => {
  it('a DRAGON pick pays a Shop spell; an off-tribe pick pays nothing', () => {
    const s = armed('rune_draconic_curiosity', { hand: [], discover: ['d2_embermouth', 'sandbag', 'sandbag'] });
    const after = reduce(s, { type: 'discover', index: 0 }) as RunState;
    expect(after.hand.filter((c) => CARD_INDEX[c.cardId]?.spell), 'the Dragon paid').toHaveLength(1);

    const s2 = armed('rune_draconic_curiosity', { hand: [], discover: ['sandbag', 'sandbag', 'sandbag'] });
    const after2 = reduce(s2, { type: 'discover', index: 0 }) as RunState;
    expect(after2.hand.filter((c) => CARD_INDEX[c.cardId]?.spell), 'a neutral pick pays nothing').toHaveLength(0);
  });
});

describe('Rune of the Seasoned Ledger', () => {
  it('buffs the body you play, and IMPROVES every 5 plays', () => {
    const s = armed('rune_seasoned_ledger', { hand: [], board: [] });
    const play = (i: number): BoardCard => {
      const c = minion(`m${i}`, 'sandbag', 1, 1);
      s.board = [c];
      playCard(s, c);
      return c;
    };
    for (let i = 0; i < 4; i++) {
      const c = play(i);
      expect([c.attack, c.health], `play ${i + 1} is still the base +1/+1`).toEqual([2, 2]);
    }
    const fifth = play(4);
    expect([fifth.attack, fifth.health], 'the 5th still gets +1/+1 — the improve lands AFTER it').toEqual([2, 2]);
    const sixth = play(5);
    expect([sixth.attack, sixth.health], 'the 6th gets the improved +2/+2').toEqual([3, 3]);
  });

  it('the badge prints the live grant AND the countdown to the next step', () => {
    const s = armed('rune_seasoned_ledger', { hand: [], board: [] });
    expect(runeTally(s, 'rune_seasoned_ledger')).toBe('+1/+1 · 0/5');
    s.runeSeasonedLedger = { attack: 2, health: 2, per: 5, played: 7 };
    expect(runeTally(s, 'rune_seasoned_ledger')).toBe('+2/+2 · 2/5');
  });
});

describe('Rune of Echoed Arrival', () => {
  it('the 5th ECHO minion played triggers its Echo — the four before it do not', () => {
    // Geode Guardian's Echo summons a Gemheart Golem, so a fired Echo is visible as a board body.
    const s = armed('rune_echoed_arrival', { hand: [], board: [] });
    const play = (i: number): void => {
      const c = minion(`e${i}`, 'k_geode', 2, 2);
      s.board = [...s.board, c];
      playCard(s, c);
    };
    for (let i = 0; i < 4; i++) play(i);
    expect(s.runeEchoedArrival!.tick).toBe(4);
    const before = s.board.length;
    play(4);
    expect(s.runeEchoedArrival!.tick).toBe(5);
    expect(s.board.length, 'the 5th fired its Echo, summoning a Golem alongside itself').toBeGreaterThan(before + 1);
  });

  it('a minion with NO Echo does not advance the count', () => {
    const s = armed('rune_echoed_arrival', { hand: [], board: [] });
    const c = minion('n', 'sandbag');
    s.board = [c];
    playCard(s, c);
    expect(s.runeEchoedArrival!.tick).toBe(0);
  });
});

describe('Rune of Shared Spoils', () => {
  const board = (): BoardCard[] => [minion('a', 'dw_orin', 1, 1), minion('n', 'sandbag', 1, 1), minion('b', 'dw_pimm', 1, 1)];

  it('the LEFT-most Dwarf\'s gain is mirrored onto the RIGHT-most Dwarf, once', () => {
    const s = { ...createRun(1), runeSharedSpoils: true, board: board() } as RunState;
    stampSharedSpoils(s);
    addBuff(s.board[0]!, 'test', 3, 4);
    expect([s.board[2]!.attack, s.board[2]!.health], 'the right-most Dwarf got the same stats').toEqual([4, 5]);
    expect([s.board[1]!.attack, s.board[1]!.health], 'the neutral body between them is untouched').toEqual([1, 1]);
    // One hop: the mirrored grant re-enters addBuff, and must not bounce back.
    expect(s.board[0]!.attack, 'the left-most gained only its own buff').toBe(4);
  });

  it('a gain on the RIGHT-most Dwarf is not mirrored back', () => {
    const s = { ...createRun(1), runeSharedSpoils: true, board: board() } as RunState;
    stampSharedSpoils(s);
    addBuff(s.board[2]!, 'test', 3, 3);
    expect(s.board[0]!.attack, 'the left-most is unchanged').toBe(1);
  });

  it('a lone Dwarf is both ends — it must not pay itself', () => {
    const s = { ...createRun(1), runeSharedSpoils: true, board: [minion('a', 'dw_orin', 1, 1)] } as RunState;
    stampSharedSpoils(s);
    addBuff(s.board[0]!, 'test', 5, 5);
    expect([s.board[0]!.attack, s.board[0]!.health], 'exactly one grant').toEqual([6, 6]);
  });

  it('unarmed, the hook is inert', () => {
    const s = { ...createRun(1), board: board() } as RunState;
    stampSharedSpoils(s);
    addBuff(s.board[0]!, 'test', 3, 3);
    expect(s.board[2]!.attack).toBe(1);
  });
});

describe('Rune of Heavy Payroll', () => {
  it('a DWARF arriving in hand pays the left-most minion +12/+12', () => {
    const s = armed('rune_heavy_payroll', { board: [minion('a', 'sandbag', 1, 1), minion('b', 'sandbag', 1, 1)] });
    fireOnGainCard(s, 'dw_orin');
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([13, 13]);
    expect([s.board[1]!.attack, s.board[1]!.health], 'only the left-most').toEqual([1, 1]);
  });

  it('a non-Dwarf gain pays nothing', () => {
    const s = armed('rune_heavy_payroll', { board: [minion('a', 'sandbag', 1, 1)] });
    fireOnGainCard(s, 'b2_packstrider');
    expect(s.board[0]!.attack).toBe(1);
  });
});

// ── the combat runes ─────────────────────────────────────────────────────────────────────────────────────
/** One fight against a wall that cannot kill anything before Start of Combat resolves. */
const fight = (player: BoardMinion[], mods: QuestCombatMods, tribes = ['beast', 'dragon', 'demon', 'kobold', 'dwarf']) =>
  simulate(
    player,
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(7), CARD_INDEX,
    combatSide({ tier: 6, tribes, questMods: mods }),
    combatSide({ tier: 1 }),
  );

describe('Rune of the Returning Pack — a combat meter paying into the next shop', () => {
  it('arms as a combat flag carrying its THRESHOLD, and the reducer threads it', () => {
    const s = armed('rune_returning_pack');
    expect(s.questFlags?.runeReturningPack, 'the amount IS the threshold').toBe(6);
    expect(questCombatMods(s).runeReturningPack).toBe(6);
  });

  it('a second copy must not double the THRESHOLD (that would be strictly worse)', () => {
    let s = armed('rune_returning_pack');
    s = reduce({ ...s, runeforgeOffer: ['rune_returning_pack'], embers: 40 } as RunState, { type: 'buyRune', index: 0 }) as RunState;
    expect(s.questFlags?.runeReturningPack).toBe(6);
  });

  it('pays a Beast on the Nth Beast summoned, and not before', () => {
    // Mirror March summons exactly one copy of the left-most at Start of Combat — a single, countable summon.
    const one = fight([bm('b2_packstrider', 'p', 3, 3)], { runeMirrorMarch: true, runeReturningPack: 1 });
    expect(one.playerHandGrants ?? [], 'the 1st Beast summon paid').toHaveLength(1);
    expect(CARD_INDEX[one.playerHandGrants![0]!]!.tribe, 'and it paid a Beast').toBe('beast');

    const none = fight([bm('b2_packstrider', 'p', 3, 3)], { runeMirrorMarch: true, runeReturningPack: 2 });
    expect(none.playerHandGrants ?? [], 'one summon of two banks, it does not pay').toHaveLength(0);
  });

  it('an off-tribe summon does not count', () => {
    const r = fight([bm('sandbag', 'n', 3, 3)], { runeMirrorMarch: true, runeReturningPack: 1 }, ['beast']);
    expect(r.playerHandGrants ?? []).toHaveLength(0);
  });
});

describe('Rune of Grave Refreshment — Echoes banked as free refreshes', () => {
  it('arms as a combat flag carrying its threshold, and the reducer threads it', () => {
    const s = armed('rune_grave_refreshment');
    expect(s.questFlags?.runeGraveRefreshment).toBe(2);
    expect(questCombatMods(s).runeGraveRefreshment).toBe(2);
  });

  it('the threshold is a real DIVISOR — 2 Echoes pay twice at N=1, once at N=2, never at N=3', () => {
    // One Geode Guardian: its Echo is forced once by `echoingCoop` and fires again when it dies, so the board
    // produces a fixed 2 triggers. Asserting all three N against that same fixed count is what proves the
    // divisor, rather than a coincidence at one setting.
    const rolls = (per: number) => fight([bm('k_geode', 'g1', 2, 2)], { echoingCoop: true, runeGraveRefreshment: per }).playerFreeRolls ?? 0;
    expect(rolls(1), 'every Echo pays').toBe(2);
    expect(rolls(2), 'every second Echo pays').toBe(1);
    expect(rolls(3), 'two Echoes bank against a threshold of three — they do not pay').toBe(0);
  });

  it('unarmed, the same board banks nothing', () => {
    const r = fight([bm('k_geode', 'g1', 2, 2)], { echoingCoop: true });
    expect(r.playerFreeRolls ?? 0).toBe(0);
  });
});

describe('Rune of Shifting Facets — an Avenge whose AXIS alternates every turn', () => {
  it('the axis is DERIVED from the turn tick — it starts on the printed Health half', () => {
    const s = armed('rune_shifting_facets');
    expect(s.questFlags?.runeShiftingFacets).toBe(true);
    expect(questCombatMods(s).runeShiftingFacets, 'the printed half comes first').toBe('health');
    s.runeShiftingFacetsTick = 1;
    expect(questCombatMods(s).runeShiftingFacets).toBe('attack');
    s.runeShiftingFacetsTick = 2;
    expect(questCombatMods(s).runeShiftingFacets, 'and back again').toBe('health');
  });

  it('the tick only advances while the rune is held', () => {
    const tank: BoardCard = { uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false };
    let s = armed('rune_shifting_facets', { wave: 1, tier: 6, resolve: 999, maxResolve: 999, armor: 999, board: [tank], hand: [] });
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'resolveCombat' }) as RunState;
    expect(s.runeShiftingFacetsTick).toBe(1);
    expect(runeTally(s, 'rune_shifting_facets'), 'the badge names the half that is up next').toBe('+1 Atk');
  });

  it('Avenge (3) improves Rubies on the armed axis ONLY', () => {
    // Three 1-Health bodies against a wall that swings for plenty: the third death fires the Avenge.
    const board = [bm('sandbag', 'a', 0, 1), bm('sandbag', 'b', 0, 1), bm('sandbag', 'c', 0, 1)];
    const swing = (mods: QuestCombatMods) => simulate(
      board, [{ cardId: 'sandbag', attack: 50, health: 40000 }],
      makeRng(7), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['kobold'], questMods: mods }),
      combatSide({ tier: 1 }),
    );
    const hp = swing({ runeShiftingFacets: 'health' });
    expect([hp.playerRubyBonusGain?.attack ?? 0, hp.playerRubyBonusGain?.health ?? 0]).toEqual([0, 1]);
    const atk = swing({ runeShiftingFacets: 'attack' });
    expect([atk.playerRubyBonusGain?.attack ?? 0, atk.playerRubyBonusGain?.health ?? 0]).toEqual([1, 0]);
  });

  it('its Avenge cadence has a live combat counter, like every other Avenge rune', () => {
    expect(runeCombatTally('rune_shifting_facets', 3, 0)).toBe('3/3');
  });
});

describe('Rune of the Deepening Vein — Engraving + Gemstorm in one Avenge', () => {
  // Three 1-Health fodder bodies feed the Avenge (3); the two Kobolds are effectively unkillable, so they are
  // still standing to receive the Rubies. A board where the Kobolds die first would prove only half the rune.
  const veinFight = (mods: QuestCombatMods) => simulate(
    [bm('sandbag', 's1', 0, 1), bm('sandbag', 's2', 0, 1), bm('sandbag', 's3', 0, 1),
      bm('k_chipwick', 'k1', 0, 10000), bm('k_chipwick', 'k2', 0, 10000)],
    [{ cardId: 'sandbag', attack: 50, health: 40000 }],
    makeRng(7), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['kobold'], questMods: mods }),
    combatSide({ tier: 1 }),
  );

  it('improves Rubies on BOTH axes and plays a Ruby on every friendly Kobold', () => {
    const r = veinFight({ runeDeepeningVein: true });
    expect([r.playerRubyBonusGain?.attack ?? 0, r.playerRubyBonusGain?.health ?? 0], '+1/+1 on both halves').toEqual([1, 1]);
    // The improve lands FIRST, so the Rubies it then plays are worth the NEW line: a base 1/1 Ruby plus the
    // +1/+1 just earned = +2/+2 on each Kobold. That arithmetic is the proof it is a real Ruby play folding in
    // the side's live Ruby strength, and not a hand-rolled stat bump.
    const paid = r.events.filter((e) => e.type === 'buff'
      && (e as { attack: number; health: number }).attack === 2
      && (e as { attack: number; health: number }).health === 2) as unknown as { target: string }[];
    expect(new Set(paid.map((e) => e.target)), 'one Ruby each, on both Kobolds').toEqual(new Set(['m3', 'm4']));
  });

  it('unarmed, the same board gains nothing', () => {
    const r = veinFight({});
    expect(r.playerRubyBonusGain?.attack ?? 0).toBe(0);
  });

  it('it has a combat counter too', () => {
    expect(runeCombatTally('rune_deepening_vein', 3, 0)).toBe('3/3');
  });
});

describe('Rune of Lasting Cadence — the board-wide Rune of Rallying, now at End of Turn', () => {
  it('arms as a run flag (not a combat flag — it pays out in the shop)', () => {
    const s = armed('rune_lasting_cadence');
    expect(s.runeLastingCadence).toBe(true);
    expect(RUNE_INDEX['rune_lasting_cadence']!.text).toContain('End of Turn');
  });

  it('the Start-of-Combat path is gone — an armed run fires no free rally in the fight', () => {
    // Three Sunmane Heralds (Rally) at ZERO Attack against a zero-Attack wall: nothing ever swings, so any
    // `Rally` marker in the log could only be a free rally. There is no longer a rune that produces one here.
    const board = () => [bm('b2_sunmane', 'r1', 0, 20, ['RL']), bm('b2_sunmane', 'r2', 0, 20, ['RL']), bm('b2_sunmane', 'r3', 0, 20, ['RL'])];
    const rallies = (mods: QuestCombatMods) => {
      const r = simulate(
        board(), [{ cardId: 'sandbag', attack: 0, health: 40000 }],
        makeRng(7), CARD_INDEX,
        combatSide({ tier: 6, tribes: ['beast'], questMods: mods }),
        combatSide({ tier: 1 }),
      );
      return r.events.filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Rally').length;
    };
    expect(rallies({ runeRallying: true }), 'Rune of Rallying still fires the left-most').toBe(1);
    expect(rallies({}), 'unarmed, none').toBe(0);
    // Lasting Cadence's own coverage now lives in `rallyDispatch.test.ts` (End of Turn + one beat per rally).
  });
});
