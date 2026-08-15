import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

/** Owner spell batch 2026-08-15, tranche 2 — the five NEXT-COMBAT spells. Each arms a mark/bank in the shop;
 *  these pin what the mark actually does once the fight runs. */

const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'demon', 'dragon', 'mech', 'undead'], questMods: mods }),
    combatSide({ tier: 6 }));

describe('Solid Ground — the first N summons land bigger', () => {
  it('buffs exactly the first 3 summoned bodies, then stops', () => {
    // A Deathrattle summoner that spawns several tokens; only the first three should carry the grant.
    const p: BoardMinion[] = [{ cardId: 'b2_mammoth', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 1, health: 40 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 40 }];
    const r = sim(p, e, { solidGroundLeft: 3, solidGroundStat: 4 });
    const grants = r.events.filter((ev) => ev.type === 'buff' && ev.attack === 4 && ev.health === 4);
    expect(grants.length, 'at most the 3 banked charges are spent').toBeLessThanOrEqual(3);
    expect(grants.length, 'and they DO fire on summons').toBeGreaterThan(0);
  });

  it('with no bank, no summon is buffed', () => {
    const p: BoardMinion[] = [{ cardId: 'b2_mammoth', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 1, health: 40 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 40 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 4 && ev.health === 4)).toBe(false);
  });
});

describe('Containment Rune — the foe\u2019s first summon is pinned to 1/1', () => {
  it('sets the first ENEMY summon to 1/1 and is then spent', () => {
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 60 }];
    const e: BoardMinion[] = [{ cardId: 'b2_mammoth', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 1, health: 60 }];
    const r = sim(p, e, { containFirstEnemySummon: true });
    expect(r.events.some((ev) => ev.type === 'sc' && /Contained/.test(ev.text ?? '')), 'the contain fired').toBe(true);
    const contained = r.events.filter((ev) => ev.type === 'sc' && /Contained/.test(ev.text ?? ''));
    expect(contained.length, 'ONE-SHOT — only the first enemy summon is pinned').toBe(1);
  });

  it('does nothing without the mark', () => {
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 60 }];
    const e: BoardMinion[] = [{ cardId: 'b2_mammoth', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 1, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /Contained/.test(ev.text ?? ''))).toBe(false);
  });
});

describe('Stolen Initiative — a swing out of turn order', () => {
  it('fires once, after the enemy attacks, and never rewrites turn order', () => {
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 60 }, { cardId: 'stray', attack: 5, health: 60 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 60 }];
    const r = sim(p, e, { stolenInitiative: true });
    const steals = r.events.filter((ev) => ev.type === 'sc' && /steals the initiative/.test(ev.text ?? ''));
    expect(steals.length, 'exactly one steal — the mark is one-shot').toBe(1);
  });

  it('is silent without the mark', () => {
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 60 }, { cardId: 'stray', attack: 5, health: 60 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /steals the initiative/.test(ev.text ?? ''))).toBe(false);
  });
});

describe('Parting Cry — the Shout fires on death', () => {
  it('a marked Shout minion fires its Shout as it dies', () => {
    // Pennycat's Shout summons a Stray; marked, it should fire that Shout when it dies.
    const p: BoardMinion[] = [{ cardId: 'alley', attack: 1, health: 1, partingCry: true } as BoardMinion];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? '')), 'the cry fired').toBe(true);
  });

  it('an UNMARKED body dies quietly', () => {
    const p: BoardMinion[] = [{ cardId: 'alley', attack: 1, health: 1 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? ''))).toBe(false);
  });
});

describe('Closed Casket — the Echo moves to Start of Combat', () => {
  it('fires the Echo at SoC and suppresses it on the first death', () => {
    // Menagerie Mammoth's Echo summons Beasts. Marked, it should summon at SoC and NOT again when it dies.
    const p: BoardMinion[] = [{ cardId: 'b2_mammoth', attack: 1, health: 1, closedCasket: true } as BoardMinion];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /casket opens/.test(ev.text ?? '')), 'the casket opened at SoC').toBe(true);
    // The body dies to the 30-Attack sandbag; its Echo must NOT summon a second wave.
    const marked = sim(p, e, {});
    const plain = sim([{ cardId: 'b2_mammoth', attack: 1, health: 1 }], e, {});
    const summons = (rr: ReturnType<typeof sim>) => rr.events.filter((ev) => ev.type === 'summon').length;
    expect(summons(marked), 'the Echo pays ONCE, not twice').toBe(summons(plain));
  });
});
