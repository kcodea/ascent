import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';

/**
 * Rune batch 10 — the two "while you have room" runes and the War Chorus.
 *
 * The BOUND is the load-bearing part of the first two: unbounded, a freed slot refills the instant it empties,
 * the board can never shrink, and the fight stops resolving. Each test therefore checks the cap, not just that
 * something got summoned.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());
/** The summoned card id lives on the event's `minion` SNAPSHOT, not on the event itself. */
const playerSummons = (r: ReturnType<typeof sim>, cardId: string) =>
  r.events.filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === cardId).length;

// A small board with room to spare, against something that kills it slowly.
const thin: BoardMinion[] = [{ cardId: 'sandbag', attack: 2, health: 300 }];
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 4, health: 300 }];

describe('Rune of the Brood — bounded slot-filling', () => {
  it('summons Imps into free slots, and stops at the cap', () => {
    expect(playerSummons(sim(thin, killer, {}), 'impscrap'), 'baseline should summon nothing').toBe(0);
    expect(playerSummons(sim(thin, killer, { runeBrood: 3 }), 'impscrap')).toBe(3);
  });

  it('honours a different cap rather than hard-coding 3', () => {
    expect(playerSummons(sim(thin, killer, { runeBrood: 1 }), 'impscrap')).toBe(1);
  });

  it('the Imps arrive with Ward and Taunt', () => {
    const r = sim(thin, killer, { runeBrood: 3 });
    const ev = r.events.find((e) => e.type === 'summon' && e.minion.cardId === 'impscrap');
    expect(ev && 'minion' in ev ? ev.minion.keywords ?? [] : []).toEqual(expect.arrayContaining(['DS', 'T']));
  });

  it('never exceeds the 7-slot board', () => {
    const full: BoardMinion[] = Array.from({ length: 7 }, () => ({ cardId: 'sandbag', attack: 1, health: 300 }));
    // With a full board there is no room, so the rune must not fire at all on the opening beats.
    const r = sim(full, killer, { runeBrood: 3 });
    const summons = playerSummons(r, 'impscrap');
    const deaths = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
    expect(summons, 'summoned more Imps than slots ever freed').toBeLessThanOrEqual(Math.min(3, deaths));
  });
});

describe('Rune of Living Echoes', () => {
  it('summons Sunmane Heralds into free slots, bounded', () => {
    expect(CARD_INDEX['b2_sunmane'], 'Sunmane Herald is missing').toBeDefined();
    expect(playerSummons(sim(thin, killer, {}), 'b2_sunmane')).toBe(0);
    expect(playerSummons(sim(thin, killer, { runeLivingEchoes: 3 }), 'b2_sunmane')).toBe(3);
  });

  it('the Herald attacks on arrival', () => {
    // It is queued with attackNow, so its summon and its strike land together.
    const r = sim(thin, killer, { runeLivingEchoes: 1 });
    const summonAt = r.events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'b2_sunmane');
    expect(summonAt, 'no Herald was summoned').toBeGreaterThanOrEqual(0);
    const attacksAfter = r.events.slice(summonAt).filter((e) => e.type === 'attack').length;
    expect(attacksAfter, 'the Herald never swung').toBeGreaterThan(0);
  });
});

describe('Rune of the War Chorus', () => {
  const rallyCard = Object.values(CARD_INDEX).find((c) => c.keywords.includes('RL') && c.effects.some((e) => e.on === 'onAttack'))!;
  const shoutCard = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onPlay') && !c.spell && !c.token)!;

  it('fires the left-most Shout on your first Rally, once', () => {
    const board: BoardMinion[] = [
      { cardId: shoutCard.id, attack: 1, health: 300 },
      { cardId: rallyCard.id, attack: 2, health: 300 },
    ];
    const shouts = (mods: object) => sim(board, killer, mods).events
      .filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Shout').length;
    expect(shouts({}), 'baseline should fire no Shout').toBe(0);
    expect(shouts({ runeWarChorus: true }), 'the chorus should fire exactly once per combat').toBe(1);
  });

  it('the chorus folds the Battlecry multiplier — with Drakko the fired Shout fires twice, still once per combat', () => {
    // q-interact-combat-shout-multipliers (owner APPROVE 2026-08-27): every combat Shout re-fire folds
    // drakkoRepeats. The once-per-combat latch is unchanged — one TRIGGER, now two FIRES.
    const board: BoardMinion[] = [
      { cardId: shoutCard.id, attack: 1, health: 300 },
      { cardId: rallyCard.id, attack: 2, health: 300 },
      { cardId: 'drummer', attack: 1, health: 300 },
    ];
    const shouts = sim(board, killer, { runeWarChorus: true }).events
      .filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Shout').length;
    expect(shouts, 'one chorus trigger × Drakko = exactly 2 fires').toBe(2);
  });

  it('a board with no Rally never spends it', () => {
    const board: BoardMinion[] = [{ cardId: shoutCard.id, attack: 2, health: 300 }];
    const shouts = sim(board, killer, { runeWarChorus: true }).events
      .filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Shout').length;
    expect(shouts, 'a plain swing spent the chorus').toBe(0);
  });
});

describe('the three runes ship as specced', () => {
  it('exist at the sheet costs and tiers', () => {
    const want: [string, number, boolean][] = [
      ['Rune of the Brood', 3, false], ['Rune of the War Chorus', 3, false], ['Rune of Living Echoes', 5, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it('only Living Echoes is set-scoped — the Sunmane Herald is a set-2 Beast', () => {
    expect(byName('Rune of Living Echoes')!.sets).toEqual(['set2']);
    expect(byName('Rune of the Brood')!.sets).toBeUndefined();
    expect(byName('Rune of the War Chorus')!.sets).toBeUndefined();
  });
});
