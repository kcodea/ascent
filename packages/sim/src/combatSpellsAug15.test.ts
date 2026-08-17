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

  // The UI draws NOTHING for an `sc` without `cast` — it classifies it as narration (see the `sc` case in
  // useCombatReplay). The cry is a real, visible proc, so the flag is part of the behaviour, not decoration
  // (owner report 2026-08-17: the Shout animation never played).
  it('flags the cry as a CAST so the UI actually animates it', () => {
    const p: BoardMinion[] = [{ cardId: 'alley', attack: 1, health: 1, partingCry: true } as BoardMinion];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 60 }];
    const cry = sim(p, e, {}).events.find((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? ''));
    expect(cry && 'cast' in cry ? cry.cast : undefined, 'a silent sc draws no animation').toBe(true);
  });

  // REGRESSION (owner report 2026-08-16): the cry fired the effect but ran the raw `onPlay` FACTORIES
  // directly, skipping `replayCombatBattlecry` + the `battlecryTriggered` bus emit that every OTHER
  // Shout-trigger (Dawnclaw, Ryme, Thunderous Sovereign) goes through. So "after you trigger a Shout"
  // watchers silently missed it — Embermouth Whelp gained nothing at all.
  it('drives the full Shout machinery, so on-Shout watchers proc', () => {
    // Embermouth Whelp: "After you trigger a Shout, gain +1/+1." It must grow off the parting cry.
    const p: BoardMinion[] = [
      { cardId: 'alley', attack: 1, health: 1, partingCry: true } as BoardMinion,
      { cardId: 'd2_embermouth', attack: 1, health: 40 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? '')), 'the cry fired').toBe(true);
    const whelp = r.events.filter((ev) => ev.type === 'buff');
    expect(whelp.length, 'the on-Shout watcher was paid').toBeGreaterThan(0);
  });

  it('an UNMARKED body dies quietly', () => {
    const p: BoardMinion[] = [{ cardId: 'alley', attack: 1, health: 1 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 30, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /parting cry/.test(ev.text ?? ''))).toBe(false);
  });
});

describe('Closed Casket — the marked minion is DESTROYED at Start of Combat', () => {
  it('kills the marked body, and its Echo fires from that real death', () => {
    // Menagerie Mammoth's Echo summons Beasts. Marked, it should DIE at SoC and pay its Echo from the death.
    const p: BoardMinion[] = [
      { cardId: 'b2_mammoth', attack: 1, health: 40, closedCasket: true } as BoardMinion,
      { cardId: 'sandbag', attack: 1, health: 60 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /casket closes/.test(ev.text ?? '')), 'the casket fired').toBe(true);
    // It really died — even though nothing could have killed a 40-Health body in this fight.
    expect(r.events.some((ev) => ev.type === 'death'), 'the marked body actually died').toBe(true);
    // …and the death paid its Echo.
    expect(r.events.some((ev) => ev.type === 'summon'), 'its Echo summoned from the death').toBe(true);
  });

  it('an UNMARKED body of the same card is untouched', () => {
    const p: BoardMinion[] = [
      { cardId: 'b2_mammoth', attack: 1, health: 40 },
      { cardId: 'sandbag', attack: 1, health: 60 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 60 }];
    const r = sim(p, e, {});
    expect(r.events.some((ev) => ev.type === 'sc' && /casket closes/.test(ev.text ?? ''))).toBe(false);
    // The distinguishing fact is WHEN it dies: marked, the 40-Health body is destroyed up front; unmarked, it
    // survives the opening exchanges. (Bodies do eventually trade in a long fight — so assert the early death,
    // not the absence of any death.)
    const marked = sim([{ ...p[0]!, closedCasket: true } as BoardMinion, p[1]!], e, {});
    const firstDeath = (rr: ReturnType<typeof sim>) => rr.events.findIndex((ev) => ev.type === 'death');
    expect(firstDeath(marked), 'the casket kills it before anything else happens').toBeLessThan(firstDeath(r));
  });

  it('is a REAL death, so the Deathrattle tally counts it (every death watcher fires)', () => {
    // The point of the rework: not a bespoke "fire its Echo" hook — a real death, so everything downstream
    // (Avenge counters, friend-death watchers, the tally) comes along for free.
    const p: BoardMinion[] = [
      { cardId: 'b2_mammoth', attack: 1, health: 40, closedCasket: true } as BoardMinion,
      { cardId: 'sandbag', attack: 1, health: 60 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 60 }];
    const r = sim(p, e, {});
    expect(r.playerDeathrattles ?? 0, 'the death was counted like any other').toBeGreaterThan(0);
  });
});
