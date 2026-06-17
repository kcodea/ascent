import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

const run = (p: BoardMinion[], e: BoardMinion[], seed: number) =>
  simulate(p, e, makeRng(seed), CARD_INDEX);

describe('simulate (handoff A.3)', () => {
  it('is deterministic for the same seed', () => {
    const p: BoardMinion[] = [
      { cardId: 'pack', attack: 2, health: 2 },
      { cardId: 'cleaver', attack: 2, health: 4 },
      { cardId: 'gnash', attack: 6, health: 6 },
    ];
    const e: BoardMinion[] = [
      { cardId: 'matron', attack: 4, health: 4 },
      { cardId: 'pack', attack: 2, health: 2 },
      { cardId: 'alley', attack: 1, health: 1 },
    ];
    const a = run(p, e, 12345);
    const b = run(p, e, 12345);
    expect(a.events).toEqual(b.events);
    expect(a.result).toBe(b.result);
    expect(a.playerDamage).toBe(b.playerDamage);
  });

  it('applies the player-damage formula on a loss', () => {
    const a = run(
      [{ cardId: 'alley', attack: 1, health: 1 }],
      [{ cardId: 'gnash', attack: 6, health: 6 }],
      1,
    );
    expect(a.result).toBe('lose');
    // The Gnasher survives ~6/5 → round((6 + 5) / 8) = 1 (min 1).
    expect(a.playerDamage).toBe(1);
  });

  it('fires Pack Scrounger Deathrattle — summons two Pups', () => {
    const a = run(
      [{ cardId: 'gnash', attack: 6, health: 6 }],
      [{ cardId: 'pack', attack: 2, health: 2 }],
      5,
    );
    const pups = a.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'pup');
    expect(pups.length).toBe(2);
    expect(a.result).toBe('win');
  });

  it('buffs Beasts summoned during combat (Kennelmaster)', () => {
    const a = run(
      [
        { cardId: 'kennel', attack: 2, health: 100 },
        { cardId: 'pack', attack: 2, health: 2 },
      ],
      [{ cardId: 'gnash', attack: 6, health: 6 }],
      7,
    );
    // When Pack Scrounger dies its Pups are summoned, and the living
    // Kennelmaster buffs each +1/+1.
    const buffs = a.events.filter((ev) => ev.type === 'buff');
    expect(buffs.length).toBeGreaterThanOrEqual(2);
  });

  it('Cleave hits the target and its neighbours in one swing', () => {
    // Player outnumbers the enemy, so the Cleaver strikes first while two
    // adjacent enemies are present. A single attack should kill both.
    const a = run(
      [
        { cardId: 'cleaver', attack: 3, health: 10 },
        { cardId: 'alley', attack: 1, health: 1 },
        { cardId: 'alley', attack: 1, health: 1 },
      ],
      [
        { cardId: 'pup', attack: 1, health: 1 },
        { cardId: 'pup', attack: 1, health: 1 },
      ],
      4,
    );
    const attacks = a.events.filter((ev) => ev.type === 'attack');
    const enemyDeaths = a.events.filter((ev) => ev.type === 'death');
    expect(attacks.length).toBe(1); // both enemies fell to one Cleave swing
    expect(enemyDeaths.length).toBe(2);
    expect(a.result).toBe('win');
  });

  it('Start of Combat fires first — Ember Whelp pings the leftmost enemy', () => {
    const a = run(
      [{ cardId: 'whelp', attack: 2, health: 1 }],
      [
        { cardId: 'omen', attack: 4, health: 4, keywords: [] },
        { cardId: 'omen', attack: 1, health: 1, keywords: [] },
      ],
      2,
    );
    expect(a.events[0]?.type).toBe('sc');
    const ping = a.events[1];
    expect(ping?.type).toBe('dmg');
    if (ping?.type === 'dmg') expect(ping.amount).toBe(1);
  });

  it('Start of Combat split damage — Chromatic Caller hits for its Attack', () => {
    const a = run(
      [{ cardId: 'chrom', attack: 3, health: 5 }],
      [{ cardId: 'omen', attack: 6, health: 9, keywords: [] }],
      3,
    );
    expect(a.events[0]?.type).toBe('sc');
    const scHits = a.events.slice(1, 4).filter((e) => e.type === 'dmg');
    expect(scHits.length).toBe(3); // Attack 3 → three 1-damage hits before the attack loop
  });

  it('Poison (Webspinner Matron) destroys whatever it damages', () => {
    const a = run(
      [{ cardId: 'maex', attack: 4, health: 4, keywords: ['P'] }],
      [{ cardId: 'omen', attack: 2, health: 30, keywords: [] }],
      2,
    );
    expect(a.events.some((e) => e.type === 'poison')).toBe(true);
    expect(a.result).toBe('win'); // poison melts the 30-hp wall in one hit
  });

  it('Reborn (Grave Knit) returns once at 1 Health', () => {
    const a = run(
      [{ cardId: 'knit', attack: 2, health: 2, keywords: ['R'] }],
      [{ cardId: 'omen', attack: 5, health: 5, keywords: [] }],
      3,
    );
    expect(a.events.some((e) => e.type === 'reborn')).toBe(true);
  });

  it('Sporeling Deathrattle buffs a surviving friend', () => {
    const a = run(
      [
        { cardId: 'spore', attack: 1, health: 1 },
        { cardId: 'sandbag', attack: 0, health: 12, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 6, health: 9, keywords: [] }],
      5,
    );
    expect(a.events.some((e) => e.type === 'buff')).toBe(true);
  });

  it('Ghastweaver Deathrattle fills the board with Undead', () => {
    const a = run(
      [{ cardId: 'ghast', attack: 5, health: 5 }],
      [{ cardId: 'omen', attack: 9, health: 9, keywords: [] }],
      7,
    );
    const undead = new Set(['spore', 'toxin', 'knit', 'rot', 'maex', 'plague']);
    const summons = a.events.filter((e) => e.type === 'summon' && undead.has(e.minion.cardId));
    expect(summons.length).toBeGreaterThan(0);
  });

  it('Omega Bulwark Start of Combat shields every other friendly Mech', () => {
    const a = run(
      [
        { cardId: 'omega', attack: 6, health: 6, keywords: ['DS', 'T'] },
        { cardId: 'arc', attack: 3, health: 3 },
      ],
      [{ cardId: 'omen', attack: 1, health: 1, keywords: [] }],
      11,
    );
    expect(a.events[0]?.type).toBe('sc');
    // Omega already has its own Shield, so only the unshielded Arclight gains one.
    expect(a.events.filter((e) => e.type === 'shieldUp').length).toBe(1);
  });

  it('Selfless Sentinel Deathrattle grants a surviving friend a Shield', () => {
    const a = run(
      [
        { cardId: 'selfless', attack: 2, health: 1 },
        { cardId: 'sandbag', attack: 0, health: 30, keywords: [] },
      ],
      [{ cardId: 'omen', attack: 3, health: 30, keywords: [] }],
      6,
    );
    expect(a.events.some((e) => e.type === 'death')).toBe(true);
    expect(a.events.some((e) => e.type === 'shieldUp')).toBe(true);
  });

  it('Arclight Reactor pings an enemy when a friendly Mech Shield breaks', () => {
    const a = run(
      [
        { cardId: 'drone', attack: 2, health: 1, keywords: ['DS'] },
        { cardId: 'arc', attack: 3, health: 3 },
      ],
      [{ cardId: 'omen', attack: 2, health: 40, keywords: [] }],
      8,
    );
    const i = a.events.findIndex((e) => e.type === 'shield');
    expect(i).toBeGreaterThanOrEqual(0);
    const ping = a.events[i + 1];
    expect(ping?.type).toBe('dmg');
    if (ping?.type === 'dmg') expect(ping.amount).toBe(3); // Reactor's 3, fired off the break
  });

  it('Junkyard Titan buffs the whole board when a friendly Shield breaks', () => {
    const a = run(
      [
        { cardId: 'drone', attack: 2, health: 1, keywords: ['DS'] },
        { cardId: 'junk', attack: 4, health: 4 },
        { cardId: 'sandbag', attack: 0, health: 20, keywords: [] },
      ],
      [{ cardId: 'omen', attack: 2, health: 40, keywords: [] }],
      8,
    );
    // The break buffs all three living friends +1/+1.
    expect(a.events.filter((e) => e.type === 'buff').length).toBeGreaterThanOrEqual(3);
  });

  it('Abyssal Sovereign Start of Combat destroys the highest-Attack enemy', () => {
    const a = run(
      [{ cardId: 'sov', attack: 7, health: 7, keywords: ['SC'] }],
      [
        { cardId: 'omen', attack: 9, health: 9, keywords: [] },
        { cardId: 'omen', attack: 2, health: 5, keywords: [] },
      ],
      9,
    );
    expect(a.events[0]?.type).toBe('sc');
    const firstDeath = a.events.findIndex((e) => e.type === 'death');
    const firstAttack = a.events.findIndex((e) => e.type === 'attack');
    expect(firstDeath).toBeGreaterThanOrEqual(0);
    expect(firstDeath).toBeLessThan(firstAttack); // the 9/9 fell before the attack loop
    expect(a.result).toBe('win');
  });

  it('Brood Matron breeds an Imp each time a friend dies', () => {
    const a = run(
      [
        { cardId: 'brood', attack: 3, health: 30 },
        { cardId: 'alley', attack: 1, health: 1 },
      ],
      [{ cardId: 'omen', attack: 2, health: 40, keywords: [] }],
      4,
    );
    expect(a.events.some((e) => e.type === 'summon' && e.minion.cardId === 'impscrap')).toBe(true);
  });

  it('a golden minion fires its effect at doubled magnitude', () => {
    const a = run(
      [
        { cardId: 'spore', attack: 1, health: 1, golden: true }, // golden Sporeling
        { cardId: 'sandbag', attack: 0, health: 20, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 5, health: 30, keywords: [] }],
      5,
    );
    const buff = a.events.find((e) => e.type === 'buff');
    expect(buff).toBeDefined();
    if (buff?.type === 'buff') {
      expect(buff.attack).toBe(2); // +1/+1 doubled to +2/+2
      expect(buff.health).toBe(2);
    }
  });

  it('Echo Warden makes a Deathrattle summon fire one extra time', () => {
    const a = run(
      [
        { cardId: 'pack', attack: 2, health: 1 }, // Deathrattle: summon two 1/1 Pups
        { cardId: 'echo', attack: 2, health: 12 },
      ],
      [{ cardId: 'omen', attack: 5, health: 30 }],
      1,
    );
    const pups = a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length;
    expect(pups).toBe(4); // 2 pups × (1 + one Echo)
  });

  it('Immune — takes no damage at all (A.4)', () => {
    const a = run(
      [{ cardId: 'omen', attack: 3, health: 3, keywords: ['IMM'] }],
      [{ cardId: 'omen', attack: 4, health: 6, keywords: [] }],
      3,
    );
    // m0 is the immune player minion — it never takes a point of damage, even on retaliation.
    expect(a.events.some((e) => e.type === 'dmg' && e.target === 'm0')).toBe(false);
    expect(a.result).toBe('win'); // grinds the 4/6 down while taking nothing
  });

  it('Stealth — not targeted until it attacks, then loses Stealth (A.4)', () => {
    const a = run(
      [{ cardId: 'omen', attack: 2, health: 6, keywords: ['ST'] }],
      [{ cardId: 'omen', attack: 1, health: 8, keywords: [] }],
      4,
    );
    const revealIdx = a.events.findIndex((e) => e.type === 'reveal' && e.target === 'm0');
    expect(revealIdx).toBeGreaterThan(-1); // m0 attacked and lost Stealth
    const attackedWhileStealthed = a.events
      .slice(0, revealIdx)
      .some((e) => e.type === 'attack' && e.defender === 'm0');
    expect(attackedWhileStealthed).toBe(false); // never hit while Stealthed
  });

  it('produces a finite, well-formed event log', () => {
    const a = run(
      [{ cardId: 'pack', attack: 2, health: 2 }],
      [{ cardId: 'pack', attack: 2, health: 2 }],
      77,
    );
    expect(a.events.length).toBeGreaterThan(0);
    expect(['win', 'lose', 'draw']).toContain(a.result);
    for (const ev of a.events) {
      if (ev.type === 'dmg') {
        expect(Number.isFinite(ev.amount)).toBe(true);
        expect(Number.isFinite(ev.remainingHp)).toBe(true);
      }
    }
  });
});
