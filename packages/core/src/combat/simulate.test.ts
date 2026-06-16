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
    // The Gnasher survives ~6/5 → 1 + ceil((6 + 5) / 9) = 3.
    expect(a.playerDamage).toBe(3);
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
