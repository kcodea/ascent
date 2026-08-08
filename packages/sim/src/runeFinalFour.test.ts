import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applySpellBought, teachMagePup } from './recruit';

/**
 * The last four runes — Counterpoint, Overflow, the Spellstone, the White Wolf.
 *
 * COUNTERPOINT MEASUREMENT NOTE. An earlier session reported this rune as a dead no-op after three separate
 * attempts, measured by TOTAL attack events. That measure is worthless here: a grinding fight runs to the same
 * length either way, so an extra out-of-turn swing does not change the total. Solaris Fang, which has queued a
 * strike this exact way for ages, shows no change by that metric either. Counting the LEADER's own swings shows
 * it plainly — the rune had been working the whole time.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());
const fodder = (n: number) => Array.from({ length: n }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] }));

describe('Rune of Counterpoint', () => {
  const board: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 600 }, ...fodder(6)];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 600 }];
  const leadSwings = (p: BoardMinion[], e: BoardMinion[], mods: object) => {
    const r = sim(p, e, mods);
    const lead = r.initial.player[0]!.uid;
    return r.events.filter((ev) => ev.type === 'attack' && ev.attacker === lead).length;
  };

  it('gives the left-most extra swings as friendlies die', () => {
    expect(leadSwings(board, enemy, { runeCounterpoint: true }), 'the rune added no swings')
      .toBeGreaterThan(leadSwings(board, enemy, {}));
  });

  it('does nothing when nothing dies', () => {
    const safe: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 900 }];
    const weak: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 600 }];
    expect(leadSwings(safe, weak, { runeCounterpoint: true })).toBe(leadSwings(safe, weak, {}));
  });
});

describe('Rune of Overflow', () => {
  const summoner = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
  const full: BoardMinion[] = Array.from({ length: 7 }, () => ({ cardId: summoner.id, attack: 1, health: 1 }));
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 600 }];

  it('carries a PERMANENT board buff back to the run', () => {
    // The whole point: a combat-only buff vanishes at settle and the word "permanently" would do nothing.
    expect(sim(full, enemy, {}).playerBoardBuffGain).toBeUndefined();
    const gain = sim(full, enemy, { runeOverflow: 4 }).playerBoardBuffGain;
    expect(gain, 'no permanent buff was carried back').toBeDefined();
    expect(gain!.attack % 4, 'should be a multiple of the per-overflow grant').toBe(0);
  });

  it('the reducer folds the carry-back onto board AND hand', () => {
    const pack = CARD_INDEX['pack']!;
    const mk = (uid: string): BoardCard => ({ uid, cardId: 'pack', tribe: pack.tribe, attack: pack.attack, health: pack.health, keywords: [], golden: false });
    const s: RunState = { ...set2(), phase: 'combat', board: [mk('b')], hand: [mk('h')],
      lastCombat: { result: 'win', playerDamage: 0, events: [], initial: { player: [], enemy: [] }, playerBoardBuffGain: { attack: 4, health: 4 } } as never };
    const next = reduce(s, { type: 'resolveCombat' });
    expect(next.board.find((c) => c.uid === 'b')!.attack, 'the board minion missed it').toBe(pack.attack + 4);
    expect(next.hand.find((c) => c.uid === 'h')!.attack, 'the hand minion missed it').toBe(pack.attack + 4);
  });
});

describe('Rune of the Spellstone', () => {
  const ruby = (uid: string): BoardCard => ({ uid, cardId: 'ruby', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false });
  const target = (): BoardCard => ({ uid: 't', cardId: 'pack', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false });
  const play = (rune: boolean) => {
    const s: RunState = { ...set2(), runeSpellstone: rune || undefined, board: [target()], hand: [ruby('r')] };
    return reduce(s, { type: 'play', uid: 'r', targetUid: 't' });
  };

  it('a Ruby cast counts toward the Shop-spell tally', () => {
    expect(play(false).spellsCast, 'a Ruby counted as a spell without the rune').toBe(0);
    expect(play(true).spellsCast, 'the rune did not make the Ruby count').toBe(1);
  });

  it('does NOT double-fire the Ruby+Spell umbrella', () => {
    // Why this uses a narrow counter instead of noteSpellCast: that path already fires the umbrella, so reusing
    // it would advance every "every N casts" card twice per Ruby.
    expect(play(true).rubyCasts, 'the Ruby meter moved more than once').toBe(1);
  });
});

describe('Rune of the White Wolf', () => {
  it('teaches a bought Shop spell to a Mage-Pup', () => {
    const s: RunState = { ...set2(), runeWhiteWolf: true, board: [], hand: [] };
    applySpellBought(s, 'growth');
    const pup = s.hand.find((c) => c.cardId === 'b2_magepup');
    expect(pup, 'no Mage-Pup was taught').toBeDefined();
    expect(pup!.taughtSpellId).toBe('growth');
  });

  it('is capped at once per turn', () => {
    const s: RunState = { ...set2(), runeWhiteWolf: true, board: [], hand: [] };
    applySpellBought(s, 'growth');
    applySpellBought(s, 'growth');
    expect(s.hand.filter((c) => c.cardId === 'b2_magepup').length, 'the per-turn cap did not hold').toBe(1);
  });

  it('teaches nothing without the rune', () => {
    const s: RunState = { ...set2(), board: [], hand: [] };
    applySpellBought(s, 'growth');
    expect(s.hand.filter((c) => c.cardId === 'b2_magepup').length).toBe(0);
  });

  it('owns its own once-per-turn budget — Mentors no longer share it (owner rework 2026-08-07)', () => {
    // The old shared ceiling was exactly the bug that hit the Mentors themselves (two Mentors, one counter):
    // every teach source now carries its own latch. `teachMagePup` is the RUNE's path — with one White Wolf
    // it teaches once per turn regardless of how many Mentors stand on the board.
    const mentor = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.do === 'grantMagePupTaught'))!;
    const s: RunState = { ...set2(), runeWhiteWolf: true, hand: [],
      board: [{ uid: 'm', cardId: mentor.id, tribe: mentor.tribe, attack: mentor.attack, health: mentor.health, keywords: [], golden: false }] };
    for (let i = 0; i < 5; i++) teachMagePup(s, 'growth');
    expect(s.hand.filter((c) => c.cardId === 'b2_magepup').length, 'the rune teaches once, on its own budget').toBe(1);
  });
});

describe('the last four runes ship as specced', () => {
  it('exist at the sheet costs, all epic', () => {
    const want: [string, number][] = [
      ['Rune of Counterpoint', 7], ['Rune of Overflow', 5], ['Rune of the Spellstone', 6], ['Rune of the White Wolf', 4],
    ];
    for (const [name, cost] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic).toBe(true);
    }
  });
});
