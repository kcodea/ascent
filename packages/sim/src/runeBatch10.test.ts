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

  // R-ECHOES-CHARGE-01 (owner report 2026-11-03): "if the first sunmane survives, no other sunmanes summon once space
  // clears up again". A Sunmane's summon is queued (it attacks immediately), so the fill used to see the same free
  // slot three times, spend every charge at once, and lose the extra Sunmanes.
  const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 300 }]; // 1 Attack: a Sunmane (5/3) survives its swing
  type Ev = ReturnType<typeof sim>['events'][number];
  const sunmanes = (r: ReturnType<typeof sim>) =>
    r.events.filter((e): e is Extract<Ev, { type: 'summon' }> =>
      e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'b2_sunmane');

  it('3 open slots at the start: all 3 Sunmanes summon at once and fill the board', () => {
    const four: BoardMinion[] = Array.from({ length: 4 }, () => ({ cardId: 'sandbag', attack: 1, health: 300 }));
    const r = sim(four, wall, { runeLivingEchoes: 3 });
    const s = sunmanes(r);
    expect(s.length).toBe(3);
    const firstDeath = r.events.findIndex((e) => e.type === 'death' && e.side === 'player');
    for (const ev of s) {
      const at = r.events.indexOf(ev);
      expect(firstDeath < 0 || at < firstDeath, 'every Sunmane should land before any slot had to free up').toBe(true);
    }
    // Each lands into its own slot: 4 + 3 = a full board of 7, all on it together.
    const uids = new Set(s.map((e) => e.minion.uid));
    expect(uids.size).toBe(3);
    const firstNormalSwing = r.events.findIndex((e) => e.type === 'attack' && !uids.has(e.attacker));
    expect(s.every((ev) => r.events.indexOf(ev) < firstNormalSwing), 'all 3 land before the rotation starts').toBe(true);
  });

  it('1 open slot: one Sunmane at a time, and a surviving Sunmane does not stop the rest arriving as space clears', () => {
    const six: BoardMinion[] = Array.from({ length: 6 }, () => ({ cardId: 'sandbag', attack: 1, health: 1 }));
    const r = sim(six, wall, { runeLivingEchoes: 3 });
    const s = sunmanes(r);
    expect(s.length, 'later Sunmanes never arrived once space opened').toBe(3);
    const idx = (ev: (typeof r.events)[number]) => r.events.indexOf(ev);
    const firstUid = s[0]!.minion.uid;
    // The first Sunmane swings and SURVIVES (no death for it before the second arrives).
    const firstSwing = r.events.findIndex((e) => e.type === 'attack' && e.attacker === firstUid);
    expect(firstSwing).toBeGreaterThan(idx(s[0]!));
    expect(firstSwing).toBeLessThan(idx(s[1]!));
    const firstDiesAt = r.events.findIndex((e) => e.type === 'death' && e.target === firstUid);
    expect(firstDiesAt < 0 || firstDiesAt > idx(s[1]!), 'the first Sunmane should still be alive when the second lands').toBe(true);
    // Each later Sunmane waits for a fresh free slot: a player death between consecutive summons.
    for (let i = 1; i < s.length; i++) {
      const between = r.events.slice(idx(s[i - 1]!), idx(s[i]!));
      expect(between.some((e) => e.type === 'death' && e.side === 'player'), `Sunmane ${i + 1} arrived without space opening`).toBe(true);
    }
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
      .filter((e) => e.type === 'shout' /* R-SHOUT-TRIGGER-01: a forced Shout is a counted `shout` beat now */).length;
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
      .filter((e) => e.type === 'shout' /* R-SHOUT-TRIGGER-01: a forced Shout is a counted `shout` beat now */).length;
    expect(shouts, 'one chorus trigger × Drakko = exactly 2 fires').toBe(2);
  });

  it('a board with no Rally never spends it', () => {
    const board: BoardMinion[] = [{ cardId: shoutCard.id, attack: 2, health: 300 }];
    const shouts = sim(board, killer, { runeWarChorus: true }).events
      .filter((e) => e.type === 'shout' /* R-SHOUT-TRIGGER-01: a forced Shout is a counted `shout` beat now */).length;
    expect(shouts, 'a plain swing spent the chorus').toBe(0);
  });
});

describe('the three runes ship as specced', () => {
  it('exist at the sheet costs and tiers', () => {
    const want: [string, number, boolean][] = [
      ['Brood', 2, false], ['War Chorus', 2, false], ['Living Echoes', 4, true], // owner 2026-10-23: were 3 / 3 / 5
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it('only Living Echoes is set-scoped — the Sunmane Herald is a set-2 Beast', () => {
    expect(byName('Living Echoes')!.sets).toEqual(['set2']);
    expect(byName('Brood')!.sets).toEqual(['set1', 'set2']); // CUT FROM SET 3 2026-09-24 (owner) (Demon rune)
    expect(byName('War Chorus')!.sets).toEqual(['set1', 'set2']); // CUT FROM SET 3 2026-09-25 (owner's Set 3 rune list)
  });
});
