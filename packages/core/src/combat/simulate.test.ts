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
      { cardId: 'razor', attack: 4, health: 4 },
      { cardId: 'pack', attack: 2, health: 2 },
      { cardId: 'alley', attack: 1, health: 1 },
    ];
    const a = run(p, e, 12345);
    const b = run(p, e, 12345);
    expect(a.events).toEqual(b.events);
    expect(a.result).toBe(b.result);
    expect(a.playerDamage).toBe(b.playerDamage);
  });

  it('Kennelmaster Avenge (3) improves its summon buff and reports the bonus to carry back', () => {
    // 3 Taunt sandbags are killed first (forced targets) while the no-Taunt Kennelmaster
    // chips the tanky enemy — so all 3 friends die with Kennelmaster alive → Avenge (3)
    // fires once → summonBonus 1, reported in playerSummonBonus (deterministic: Taunts go first).
    const p: BoardMinion[] = [
      { cardId: 'kennel', attack: 2, health: 50, sourceUid: 'K' },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 20 }];
    const r = run(p, e, 7);
    expect(r.result).toBe('win'); // Kennelmaster outlasts the attacker
    expect(r.playerSummonBonus).toContainEqual({ sourceUid: 'K', bonus: 1 });
  });

  it('Arcane Weaver Deathrattle reports a Spirit Fire to grant to the hand after combat', () => {
    // The Weaver dies to retaliation; its Deathrattle queues a Spirit Fire for the player's hand.
    const p: BoardMinion[] = [{ cardId: 'weaver', attack: 1, health: 1 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 5 }];
    const r = run(p, e, 5);
    expect(r.result).toBe('lose');
    expect(r.playerHandGrants).toEqual(['spiritfire']);
  });

  it("The Reclaimer's resummon mark destroys a minion at start of combat (Deathrattle fires) + resummons an exact copy", () => {
    // Pack Scrounger (Deathrattle: summon 2 Pups), marked + alone vs a trivial enemy.
    const p: BoardMinion[] = [{ cardId: 'pack', attack: 3, health: 2, resummon: true }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    const r = run(p, e, 7);
    // The original was destroyed (so its Deathrattle could fire)...
    expect(r.events.some((ev) => ev.type === 'death')).toBe(true);
    // ...the Deathrattle summoned 2 Pups...
    expect(r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'pup').length).toBe(2);
    // ...and an exact copy of the Pack Scrounger (same 3/2 stats) returned.
    const copy = r.events.find((ev) => ev.type === 'summon' && ev.minion.cardId === 'pack');
    expect(copy).toBeDefined();
    if (copy && copy.type === 'summon') {
      expect(copy.minion.attack).toBe(3);
      expect(copy.minion.health).toBe(2);
    }
  });

  it("The Reclaimer resummons a marked minion with no Deathrattle when there is room", () => {
    const p: BoardMinion[] = [
      { cardId: 'sandbag', attack: 1, health: 20, resummon: true }, // vanilla, marked
      { cardId: 'sandbag', attack: 1, health: 20 },
    ];
    const r = run(p, [{ cardId: 'sandbag', attack: 0, health: 1 }], 1);
    const copies = r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'sandbag').length;
    expect(copies).toBe(1); // the freed slot → an exact copy returns
  });

  it('The Reclaimer defers the resummon on a full board — tokens overflow, the copy waits for room', () => {
    // Full board (7): the marked minion dies, its Deathrattle Pups summon (1 fits, the rest overflow),
    // and the exact body is queued. The enemy has 0 Attack so no friendly ever dies — the board never
    // drops below 7, so the deferred copy never gets a slot to reclaim. Tokens won the scramble.
    const p: BoardMinion[] = [
      { cardId: 'pack', attack: 1, health: 20, resummon: true },
      ...Array.from({ length: 6 }, () => ({ cardId: 'sandbag', attack: 1, health: 20 })),
    ];
    const r = run(p, [{ cardId: 'sandbag', attack: 0, health: 1 }], 1);
    const packCopies = r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'pack').length;
    const pups = r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'pup').length;
    expect(pups).toBeGreaterThanOrEqual(1); // a Pup took the one freed slot; the rest overflowed
    expect(packCopies).toBe(0); // board stayed full → the deferred copy never reclaims a slot
  });

  it('Spirit Worgen procs in combat: +X/+X per Beast/Dragon summoned, X = 1 + spellsThisTurn', () => {
    // spellsThisTurn = 4 → X = 5. Pack Scrounger (Deathrattle: 2 Beast Pups) dies → 2 summons → +5/+5 each.
    const p: BoardMinion[] = [
      { cardId: 'spiritworgen', attack: 4, health: 50 }, // tanky so it survives to receive both buffs
      { cardId: 'pack', attack: 1, health: 1 }, // dies fast → 2 Pups (Beasts)
    ];
    const r = simulate(p, [{ cardId: 'sandbag', attack: 2, health: 10 }], makeRng(7), CARD_INDEX, 4);
    const worgenBuffs = r.events.filter((ev) => ev.type === 'buff' && ev.source === 'Spirit Worgen');
    expect(worgenBuffs.length).toBe(2); // one per summoned Pup
    expect(worgenBuffs.every((b) => b.type === 'buff' && b.attack === 5 && b.health === 5)).toBe(true);
    // With no spells that turn, the same board gives +1/+1 each.
    const base = simulate(p, [{ cardId: 'sandbag', attack: 2, health: 10 }], makeRng(7), CARD_INDEX);
    expect(base.events.filter((ev) => ev.type === 'buff' && ev.source === 'Spirit Worgen' && ev.attack === 1).length).toBe(2);
  });

  it('a golden Arcane Weaver grants two Spirit Fires; an enemy Weaver grants the player none', () => {
    const golden = run([{ cardId: 'weaver', attack: 1, health: 1, golden: true }], [{ cardId: 'sandbag', attack: 5, health: 5 }], 5);
    expect(golden.playerHandGrants).toEqual(['spiritfire', 'spiritfire']);
    // An enemy Weaver dying must not stuff the *player's* hand.
    const enemySide = run([{ cardId: 'sandbag', attack: 5, health: 5 }], [{ cardId: 'weaver', attack: 1, health: 1 }], 5);
    expect(enemySide.playerHandGrants).toBeUndefined();
  });

  it('attack order resumes after the front minion dies — does not skip the next', () => {
    // Player [1/1, 2/5, 3/5] vs a 1/20 wall: the 1/1 trades in and dies to retaliation,
    // then the SECOND minion (not the third) must swing next. Regression for the bug where
    // the attacker was indexed into the living() list, which re-indexes when a minion dies.
    const p: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 2, health: 5 },
      { cardId: 'stray', attack: 3, health: 5 },
    ];
    const e: BoardMinion[] = [{ cardId: 'stray', attack: 1, health: 20 }];
    const a = run(p, e, 3);
    const pUids = a.initial.player.map((m) => m.uid);
    const playerAttackers: string[] = [];
    for (const ev of a.events) {
      if (ev.type === 'attack' && pUids.includes(ev.attacker)) playerAttackers.push(ev.attacker);
    }
    expect(playerAttackers[0]).toBe(pUids[0]); // the 1/1 swings first (and dies)
    expect(playerAttackers[1]).toBe(pUids[1]); // the 2/5 swings next — NOT the 3/5
  });

  it('applies the player-damage formula on a loss', () => {
    const a = run(
      [{ cardId: 'alley', attack: 1, health: 1 }],
      [{ cardId: 'gnash', attack: 6, health: 6 }],
      1,
    );
    expect(a.result).toBe('lose');
    // Gnasher (going first) kills the Alleycat, and its on-kill +5/+5 grows it to ~11/10 — so it
    // survives bigger: round((11 + 10) / 8) = 3.
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

  it('Venomous (Webspinner Matron) destroys whatever it damages', () => {
    const a = run(
      [{ cardId: 'maex', attack: 4, health: 4, keywords: ['V'] }],
      [{ cardId: 'omen', attack: 2, health: 30, keywords: [] }],
      2,
    );
    expect(a.events.some((e) => e.type === 'poison')).toBe(true);
    expect(a.result).toBe('win'); // venom melts the 30-hp wall in one hit
  });

  it('attacking a Venomous target kills the attacker via retaliation venom (unless shielded)', () => {
    // a beefy non-venomous attacker into a tiny Venomous defender: the defender's retaliation venom
    // should still finish the attacker, even though the attacker easily survives the raw 1 damage.
    const a = run(
      [{ cardId: 'omen', attack: 9, health: 30, keywords: [] }],
      [{ cardId: 'maex', attack: 1, health: 1, keywords: ['V'] }],
      2,
    );
    expect(a.events.some((e) => e.type === 'venomLost')).toBe(true);
    expect(a.result).not.toBe('win'); // the attacker took the venom and died (draw)
    // but a Divine Shield eats the venom — the attacker shrugs it off and wins.
    const b = run(
      [{ cardId: 'omen', attack: 9, health: 30, keywords: ['DS'] }],
      [{ cardId: 'maex', attack: 1, health: 1, keywords: ['V'] }],
      2,
    );
    expect(b.result).toBe('win');
  });

  it('Venom procs (and drops off) even when the attacker dies to the raw retaliation damage', () => {
    // A frail attacker into a big Venomous wall: it dies to the raw 5, but the venom must still proc
    // + drop off (not silently skip because the raw hit was already lethal). Player has more minions
    // so it attacks first → its 1/2 swings into the wall and eats the retaliation.
    const a = run(
      [
        { cardId: 'omen', attack: 1, health: 2, keywords: [] },
        { cardId: 'omen', attack: 1, health: 30, keywords: [] }, // filler → player attacks first
      ],
      [{ cardId: 'maex', attack: 5, health: 40, keywords: ['V'] }],
      2,
    );
    expect(a.events.some((e) => e.type === 'venomLost')).toBe(true);
  });

  it('Venomous drops off after its first proc — a second wall survives the venom', () => {
    // A fragile 1/3 Venomous vs two 1/20 walls: it poisons (destroys) the first wall (on the
    // retaliation), spends its venom, then can only chip the second for 1 before it dies. Were
    // venom permanent it would poison the second wall too and win — so a loss proves the drop-off.
    const a = run(
      [{ cardId: 'maex', attack: 1, health: 3, keywords: ['V'] }],
      [
        { cardId: 'omen', attack: 1, health: 20, keywords: [] },
        { cardId: 'omen', attack: 1, health: 20, keywords: [] },
      ],
      4,
    );
    expect(a.events.filter((e) => e.type === 'poison').length).toBe(1); // venom procs exactly once
    expect(a.events.some((e) => e.type === 'venomLost')).toBe(true); // …and then drops off
    expect(a.result).toBe('lose'); // the second wall survives now that the venom is spent
  });

  it('Reborn (Grave Knit) returns once, at its base stats', () => {
    const a = run(
      [{ cardId: 'knit', attack: 2, health: 2, keywords: ['R'] }],
      [{ cardId: 'omen', attack: 5, health: 5, keywords: [] }],
      3,
    );
    expect(a.events.some((e) => e.type === 'reborn')).toBe(true);
  });

  it('Reborn returns at BASE stats — sheds combat buffs + granted keywords (e.g. Divine Shield)', () => {
    // A Grave Knit (base 2/2) that entered combat buffed to a 10/3 Divine-Shield body.
    const a = run(
      [{ cardId: 'knit', attack: 10, health: 3, keywords: ['R', 'DS'] }],
      [{ cardId: 'omen', attack: 4, health: 40, keywords: [] }],
      3,
    );
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn).toBeDefined();
    if (reborn && reborn.type === 'reborn') {
      expect(reborn.attack).toBe(2); // base attack, not the buffed 10
      expect(reborn.hp).toBe(2); // base health, not 3 (and not Hearthstone's 1)
      expect(reborn.keywords).not.toContain('DS'); // granted Divine Shield is gone
      expect(reborn.keywords).not.toContain('R'); // Reborn itself is spent
    }
  });

  it('a golden Reborn minion returns at doubled base stats', () => {
    const a = run(
      [{ cardId: 'knit', attack: 20, health: 9, keywords: ['R'], golden: true }],
      [{ cardId: 'omen', attack: 4, health: 60, keywords: [] }],
      3,
    );
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' ? [reborn.attack, reborn.hp] : null).toEqual([4, 4]); // 2/2 base × 2
  });

  it('a minion that Reborns from its own attack is next in line to attack again', () => {
    // Grave Knit attacks, dies to retaliation, and Reborns; the Taunt sandbag soaks the enemy's swing
    // so the Knit survives — it should be the NEXT player attacker, not bumped behind the sandbag.
    const a = run(
      [
        { cardId: 'knit', attack: 2, health: 2, keywords: ['R'] },
        { cardId: 'sandbag', attack: 0, health: 60, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 3, health: 80, keywords: [] }],
      1,
    );
    const knit = a.initial.player[0]!.uid;
    const sand = a.initial.player[1]!.uid;
    expect(a.events.some((e) => e.type === 'reborn' && e.target === knit)).toBe(true);
    const playerAttacks = a.events
      .filter((e) => e.type === 'attack' && (e.attacker === knit || e.attacker === sand))
      .map((e) => (e.type === 'attack' ? e.attacker : ''));
    // Knit attacks, Reborns, then attacks again — so the first two player swings are both Knit
    // (without the fix it would be Knit then the sandbag).
    expect(playerAttacks.slice(0, 2)).toEqual([knit, knit]);
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

  it('a golden Brood Matron breeds two Imps per death (one for a plain one)', () => {
    // The Alleycat trades with a 1/1 Omen and dies, firing Brood Matron's breed exactly once.
    const imps = (golden: boolean): number =>
      run(
        [
          { cardId: 'alley', attack: 1, health: 1 },
          { cardId: 'brood', attack: 3, health: 30, golden },
        ],
        [{ cardId: 'omen', attack: 1, health: 1, keywords: [] }],
        1,
      ).events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap').length;
    expect(imps(false)).toBe(1);
    expect(imps(true)).toBe(2);
  });

  it('Gnasher keeps attacking after killing a Reborn target', () => {
    // Gnasher (more minions → goes first) drops a Reborn Grave Knit to 0; it returns at base stats,
    // but spending its Reborn still counts as a kill, so Gnasher re-attacks and finishes the returned
    // body off — clearing the board on its own turn (exactly 2 swings, the enemy never gets to attack).
    // With the bug the kill wasn't registered, the turn passed, and combat ran far longer.
    const a = run(
      [
        { cardId: 'gnash', attack: 6, health: 6 },
        { cardId: 'sandbag', attack: 0, health: 30, keywords: ['T'] }, // inert filler so Gnasher goes first
      ],
      [{ cardId: 'knit', attack: 2, health: 2, keywords: ['R'] }],
      1,
    );
    expect(a.events.some((e) => e.type === 'reborn')).toBe(true);
    expect(a.events.filter((e) => e.type === 'attack').length).toBe(2); // both swings are Gnasher's
    expect(a.result).toBe('win');
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

  it('Echo Warden echoes each summoned unit (one more copy per Echo Warden)', () => {
    const a = run(
      [
        { cardId: 'pack', attack: 2, health: 1 }, // Deathrattle: summon two 1/1 Pups
        { cardId: 'echo', attack: 2, health: 12 },
      ],
      [{ cardId: 'omen', attack: 5, health: 30 }],
      1,
    );
    const pups = a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length;
    expect(pups).toBe(4); // 2 Pups, each echoed once → 4
  });

  it('a golden Echo Warden echoes each summoned unit twice', () => {
    const a = run(
      [
        { cardId: 'pack', attack: 2, health: 1 }, // Deathrattle: summon two 1/1 Pups
        { cardId: 'echo', attack: 2, health: 12, golden: true },
      ],
      [{ cardId: 'omen', attack: 5, health: 30 }],
      1,
    );
    const pups = a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length;
    expect(pups).toBe(6); // 2 Pups, each echoed twice → 6 (board fills: Echo + 6 = 7)
  });

  it('Sylus the Reaper procs a Deathrattle one extra time', () => {
    const a = run(
      [
        { cardId: 'pack', attack: 2, health: 1 }, // Deathrattle: summon two 1/1 Pups
        { cardId: 'sylus', attack: 4, health: 12 },
      ],
      [{ cardId: 'omen', attack: 5, health: 30 }],
      1,
    );
    const pups = a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length;
    expect(pups).toBe(4); // the Deathrattle runs 2× (1 + 1 Sylus) → 2 Pups each
  });

  it('a golden Sylus procs a Deathrattle two extra times, and Sylus stacks', () => {
    // Use a buff Deathrattle (Grim: all Beasts +6/+6) so the proc count is the number of +6 buff
    // events — no board-cap interference. Only the Cleaver is a living Beast to buff.
    const procs = (board: BoardMinion[]): number =>
      run(board, [{ cardId: 'omen', attack: 1, health: 200 }], 1).events.filter(
        (e) => e.type === 'buff' && e.attack === 6,
      ).length;
    const grim = { cardId: 'grim', attack: 1, health: 1 }; // Deathrattle: all Beasts +6/+6
    const carry = { cardId: 'cleaver', attack: 2, health: 50 }; // surviving Beast
    expect(procs([grim, carry, { cardId: 'sylus', attack: 1, health: 50, golden: true }])).toBe(3); // 1 + 2 golden
    expect(
      procs([grim, carry, { cardId: 'sylus', attack: 1, health: 50 }, { cardId: 'sylus', attack: 1, health: 50 }]),
    ).toBe(3); // 1 + 1 + 1 (Sylus stacks)
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

  it('Corrupted Lifebinder mirrors its linked minion\'s combat buffs', () => {
    // Grim dies early → its Deathrattle buffs all living Beasts +6/+6 → the Stray gains +6/+6, and the
    // Lifebinder linked to that Stray mirrors the same +6/+6 (a buff event tagged 'Lifebinder').
    const p: BoardMinion[] = [
      { cardId: 'lifebinder', attack: 1, health: 50, sourceUid: 'LB', linkUid: 'B' },
      { cardId: 'stray', attack: 1, health: 50, sourceUid: 'B' },
      { cardId: 'grim', attack: 1, health: 1, sourceUid: 'G' },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 200 }];
    const a = run(p, e, 3);
    const mirror = a.events.filter((ev) => ev.type === 'buff' && ev.source === 'Lifebinder');
    expect(mirror.some((ev) => ev.type === 'buff' && ev.attack === 6 && ev.health === 6)).toBe(true);
  });

  it('a golden Corrupted Lifebinder mirrors double its linked minion\'s combat buffs', () => {
    // Same setup, but the Lifebinder is golden → it mirrors the Stray's +6/+6 as +12/+12.
    const p: BoardMinion[] = [
      { cardId: 'lifebinder', attack: 2, health: 50, sourceUid: 'LB', linkUid: 'B', golden: true },
      { cardId: 'stray', attack: 1, health: 50, sourceUid: 'B' },
      { cardId: 'grim', attack: 1, health: 1, sourceUid: 'G' },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 200 }];
    const a = run(p, e, 3);
    const mirror = a.events.filter((ev) => ev.type === 'buff' && ev.source === 'Lifebinder');
    expect(mirror.some((ev) => ev.type === 'buff' && ev.attack === 12 && ev.health === 12)).toBe(true);
  });

  it('Grim buffs Beasts summoned *after* it dies — a persistent aura, not a one-time buff', () => {
    // Grim dies on its first swing (1 HP → retaliation) and registers a +6/+6 Beast aura for the rest of
    // combat. Mama Pup outlives it, then dies and summons 2 Pups — and though they're summoned *after*
    // Grim is gone, the aura still catches them. Isolates the aura: a one-time "buff living Beasts" could
    // never reach a minion that didn't exist yet.
    const p: BoardMinion[] = [
      { cardId: 'grim', attack: 1, health: 1, sourceUid: 'G' },
      { cardId: 'pack', attack: 2, health: 25, sourceUid: 'P' }, // Mama Pup: tanky, Deathrattle → 2 Pups
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 9, health: 100 }];
    const a = run(p, e, 3);
    const grimUid = a.initial.player.find((m) => m.cardId === 'grim')!.uid;
    const grimDeath = a.events.findIndex((ev) => ev.type === 'death' && ev.target === grimUid);
    expect(grimDeath).toBeGreaterThanOrEqual(0);
    const latePups = a.events
      .map((ev, i) => ({ ev, i }))
      .filter(({ ev, i }) => i > grimDeath && ev.type === 'summon' && ev.minion.cardId === 'pup');
    expect(latePups.length).toBeGreaterThan(0); // Pups summoned strictly after Grim died
    for (const { ev } of latePups) {
      const uid = ev.type === 'summon' ? ev.minion.uid : '';
      const gotAura = a.events.some((b) => b.type === 'buff' && b.target === uid && b.attack === 6 && b.health === 6);
      expect(gotAura).toBe(true);
    }
  });

  it('Gnasher gains a permanent +5/+5 on kill (Engraved carries it back)', () => {
    // Player Gnasher (wider board → goes first) kills the lone enemy; its on-kill +5/+5 is Engraved, so
    // it's recorded as a permaGain the run loop applies to the board after the fight.
    const a = run(
      [
        { cardId: 'gnash', attack: 6, health: 6, sourceUid: 'G' },
        { cardId: 'sandbag', attack: 0, health: 20, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 1, health: 1 }],
      3,
    );
    expect(a.result).toBe('win');
    const perma = a.playerPermaBuffs?.find((p) => p.sourceUid === 'G');
    expect(perma).toBeDefined();
    expect([perma!.attack, perma!.health]).toEqual([5, 5]); // one kill → +5/+5 kept
  });

  it('Blaster Deathrattle deals 3 to every minion on both sides (friendly included)', () => {
    const a = run(
      [
        { cardId: 'blaster', attack: 1, health: 1, sourceUid: 'B' },
        { cardId: 'sandbag', attack: 0, health: 20, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 5, health: 5 }],
      3,
    );
    const sandbagUid = a.initial.player.find((m) => m.cardId === 'sandbag')!.uid;
    const omenUid = a.initial.enemy.find((m) => m.cardId === 'omen')!.uid;
    expect(a.events.some((e) => e.type === 'dmg' && e.target === sandbagUid && e.amount === 3)).toBe(true); // friendly hit
    expect(a.events.some((e) => e.type === 'dmg' && e.target === omenUid && e.amount === 3)).toBe(true); // enemy hit
  });

  it('Jenkins & Fi Deathrattle destroys the minion that killed it', () => {
    const a = run(
      [{ cardId: 'jenkins', attack: 3, health: 2, sourceUid: 'J' }],
      [{ cardId: 'omen', attack: 5, health: 20 }],
      3,
    );
    const omenUid = a.initial.enemy.find((m) => m.cardId === 'omen')!.uid;
    expect(a.events.some((e) => e.type === 'death' && e.target === omenUid)).toBe(true); // the killer is destroyed
  });

  it('Flowing Monk buffs a friend when a combat summon overflows the full board', () => {
    // 7 living (Monk + golden Brood + 5 Taunt sandbags). The omen kills a sandbag → golden Brood
    // summons 2 Imps: the first fits (back to 7), the second overflows → Monk procs +3/+3.
    const sb = (): BoardMinion => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] });
    const p: BoardMinion[] = [
      { cardId: 'monk', attack: 1, health: 40 },
      { cardId: 'brood', attack: 6, health: 6, golden: true },
      sb(), sb(), sb(), sb(), sb(),
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 5, health: 80 }];
    const a = run(p, e, 5);
    expect(a.events.some((ev) => ev.type === 'buff' && ev.attack === 3 && ev.health === 3)).toBe(true);
  });

  it('Deathsayer Rally fires the leftmost Deathrattle before its attack lands', () => {
    // Deathsayer (no Deathrattle of its own) + a Sporeling (Deathrattle: +1/+1 a random friend). When
    // Deathsayer attacks, its Rally fires the leftmost friendly Deathrattle (Sporeling's) first — so the
    // buff event lands before that attack's damage.
    const p: BoardMinion[] = [
      { cardId: 'deathsayer', attack: 3, health: 8 },
      { cardId: 'spore', attack: 1, health: 6 },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 40 }];
    const a = run(p, e, 7);
    const rallyIdx = a.events.findIndex((ev) => ev.type === 'rally');
    expect(rallyIdx).toBeGreaterThanOrEqual(0); // Rally procced
    const buffAfter = a.events.findIndex((ev, i) => i > rallyIdx && ev.type === 'buff');
    const dmgAfter = a.events.findIndex((ev, i) => i > rallyIdx && ev.type === 'dmg');
    expect(buffAfter).toBeGreaterThanOrEqual(0); // the Deathrattle (+1/+1) fired
    expect(buffAfter).toBeLessThan(dmgAfter); // ...before the attack's damage was dealt
  });

  it('Deathsayer Rally proc respects Sylus (extra Deathrattle procs)', () => {
    // Deathsayer + a Sporeling (Deathrattle: +1/+1) + two Sylus (each: Deathrattles proc 1 more time).
    // When Deathsayer attacks, the Rally-proc'd Deathrattle fires 1 + 2 = 3 times → 3 buff events
    // before that attack's damage, just like a real death would with two Sylus out.
    const p: BoardMinion[] = [
      { cardId: 'deathsayer', attack: 3, health: 30 },
      { cardId: 'spore', attack: 1, health: 30 },
      { cardId: 'sylus', attack: 4, health: 30 },
      { cardId: 'sylus', attack: 4, health: 30 },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 300 }];
    const a = run(p, e, 7);
    const rallyIdx = a.events.findIndex((ev) => ev.type === 'rally');
    expect(rallyIdx).toBeGreaterThanOrEqual(0);
    const dmgAfter = a.events.findIndex((ev, i) => i > rallyIdx && ev.type === 'dmg');
    const buffs = a.events.filter((ev, i) => i > rallyIdx && i < dmgAfter && ev.type === 'buff').length;
    expect(buffs).toBe(3); // 1 base proc + 2 Sylus extras, all before the attack lands
  });

  it('a golden Deathsayer procs the leftmost Deathrattle twice — and multiplies on top of Sylus', () => {
    const rallyBuffs = (golden: boolean, sylus: number, seed: number): number => {
      const p: BoardMinion[] = [
        { cardId: 'deathsayer', attack: 3, health: 40, golden },
        { cardId: 'spore', attack: 1, health: 40 }, // Deathrattle: +1/+1 a random friend
        ...Array.from({ length: sylus }, (): BoardMinion => ({ cardId: 'sylus', attack: 4, health: 40 })),
      ];
      const a = run(p, [{ cardId: 'omen', attack: 1, health: 400 }], seed);
      const r = a.events.findIndex((ev) => ev.type === 'rally');
      const dmg = a.events.findIndex((ev, i) => i > r && ev.type === 'dmg');
      return a.events.filter((ev, i) => i > r && i < dmg && ev.type === 'buff').length;
    };
    expect(rallyBuffs(true, 0, 7)).toBe(2); // golden alone → twice
    expect(rallyBuffs(true, 1, 7)).toBe(4); // (1 + 1 Sylus) × 2 = 4 — multiplicative, not 3
  });

  it('a combat card grant logs a toHand event (Arcane Weaver → Spirit Fire)', () => {
    const a = run(
      [{ cardId: 'weaver', attack: 1, health: 1 }],
      [{ cardId: 'omen', attack: 5, health: 20 }],
      1,
    );
    const grant = a.events.find((ev) => ev.type === 'toHand');
    expect(grant && grant.type === 'toHand' && grant.cardId === 'spiritfire').toBe(true);
    expect(grant && grant.type === 'toHand' && !!grant.source).toBe(true); // attributed to Arcane Weaver (for the Procs tab)
    expect(a.playerHandGrants).toContain('spiritfire'); // still recorded for the post-combat hand add
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

  it('golden doubles Deathrattle summon + grant counts (Pack Scrounger 2→4 Pups, Arcane Weaver 1→2 Spirit Fires)', () => {
    const killer: BoardMinion[] = [{ cardId: 'pack', attack: 12, health: 30 }]; // lethal enough to drop the carrier
    const pups = (b: BoardMinion[]): number =>
      run(b, killer, 5).events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length;
    expect(pups([{ cardId: 'pack', attack: 4, health: 4, golden: true }])).toBe(4);
    expect(pups([{ cardId: 'pack', attack: 2, health: 2 }])).toBe(2);
    const grants = (b: BoardMinion[]): number => (run(b, killer, 5).playerHandGrants ?? []).filter((c) => c === 'spiritfire').length;
    expect(grants([{ cardId: 'weaver', attack: 6, health: 8, golden: true }])).toBe(2);
    expect(grants([{ cardId: 'weaver', attack: 3, health: 4 }])).toBe(1);
  });

  it('The Reclaimer reclaims its slot mid-combat: a full board overflows, then the copy returns once a friend dies', () => {
    // Full board (7): the marked minion dies + overflows with Pups, copy queued. The enemy now trades
    // with the fragile bodies, so the board drops below 7 during combat — and the deferred copy returns
    // into its slot. The resummon must land AFTER combat starts (deferred), not at Start of Combat.
    const fragile: BoardMinion[] = Array.from({ length: 6 }, () => ({ cardId: 'sandbag', attack: 1, health: 1 }));
    const player: BoardMinion[] = [{ cardId: 'pack', attack: 1, health: 1, resummon: true }, ...fragile];
    const r = run(player, [{ cardId: 'razor', attack: 3, health: 80 }], 4);
    const firstAttackIdx = r.events.findIndex((e) => e.type === 'attack');
    const packSummonIdx = r.events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'pack');
    expect(r.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length).toBeGreaterThanOrEqual(1);
    expect(packSummonIdx).toBeGreaterThan(-1); // the exact body did reclaim its slot...
    expect(packSummonIdx).toBeGreaterThan(firstAttackIdx); // ...but only after a mid-combat death opened one
  });

  it("Flowing Monk's overflow gift is permanent — simulate returns playerPermaBuffs to carry back", () => {
    // Full board (7): Flowing Monk + a golden Mama Pup (Deathrattle → 4 Pups). The Pups that can't fit
    // overflow, so the Monk hands a random friend +3/+3 each time — recorded for carry-back to the run
    // board (only real minions, which carry a sourceUid; summoned Pup tokens are gone after combat).
    const filler: BoardMinion[] = Array.from({ length: 5 }, (_, i) => ({ cardId: 'sandbag', attack: 1, health: 20, sourceUid: `f${i}` }));
    const player: BoardMinion[] = [
      { cardId: 'monk', attack: 1, health: 20, sourceUid: 'monk' },
      { cardId: 'pack', attack: 8, health: 8, golden: true, sourceUid: 'pack' },
      ...filler,
    ];
    const r = run(player, [{ cardId: 'razor', attack: 8, health: 80 }], 3);
    expect(r.playerPermaBuffs).toBeDefined();
    expect(r.playerPermaBuffs!.length).toBeGreaterThan(0);
    for (const b of r.playerPermaBuffs!) {
      expect(b.attack % 3).toBe(0); // each gift is +3/+3 (or a multiple if a minion was picked twice)
      expect(b.health % 3).toBe(0);
    }
  });

  it('a 0-Attack minion is skipped — it never attacks (and a 0-vs-0 board is a stalemate draw)', () => {
    // Neither 0-Attack wall can swing — no attack events fire and the fight ends as a draw with both alive.
    const r = run([{ cardId: 'sandbag', attack: 0, health: 20 }], [{ cardId: 'sandbag', attack: 0, health: 20 }], 5);
    expect(r.events.filter((e) => e.type === 'attack').length).toBe(0);
    expect(r.result).toBe('draw');
    // A 0-Attack wall in front of a real attacker still never attacks, but its ally does the work.
    const r2 = run(
      [{ cardId: 'sandbag', attack: 0, health: 20 }, { cardId: 'gnash', attack: 6, health: 6 }],
      [{ cardId: 'sandbag', attack: 0, health: 4 }],
      5,
    );
    expect(r2.result).toBe('win'); // Gnasher clears the wall; the 0-Attack sandbag contributes nothing
  });
});
