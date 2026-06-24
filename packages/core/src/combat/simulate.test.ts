import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

const run = (p: BoardMinion[], e: BoardMinion[], seed: number, enemyTier = 1) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, 0, 0, enemyTier);

describe('simulate (handoff A.3)', () => {
  it('is deterministic for the same seed', () => {
    const p: BoardMinion[] = [
      { cardId: 'pack', attack: 2, health: 2 },
      { cardId: 'alley', attack: 2, health: 4 },
      { cardId: 'gnash', attack: 6, health: 6 },
    ];
    const e: BoardMinion[] = [
      { cardId: 'sandbag', attack: 4, health: 4 },
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

  it("Skullblade's Deathrattle reports run-wide spell power to carry back (+1 Attack); golden = +2", () => {
    // Skullblade (5/1) dies to retaliation against a wall; its Deathrattle records +1 Attack spell power.
    const r = run([{ cardId: 'skullblade', attack: 5, health: 1 }], [{ cardId: 'sandbag', attack: 5, health: 30 }], 5);
    expect(r.playerSpellPower).toEqual({ attack: 1, health: 0 });
    // Golden doubles the gain.
    const golden = run([{ cardId: 'skullblade', attack: 5, health: 1, golden: true }], [{ cardId: 'sandbag', attack: 5, health: 30 }], 5);
    expect(golden.playerSpellPower).toEqual({ attack: 2, health: 0 });
    // An enemy Skullblade dying gives the player no spell power (player-only carry-back).
    const enemySide = run([{ cardId: 'sandbag', attack: 5, health: 30 }], [{ cardId: 'skullblade', attack: 5, health: 1 }], 5);
    expect(enemySide.playerSpellPower).toBeUndefined();
  });

  it("Grave Knit's combat death reports a run-wide +3/+2 card-type buff; two deaths stack to +6/+4", () => {
    // One Grave Knit dies → one carry-back entry of +3/+2 for the 'knit' card type.
    const one = run([{ cardId: 'knit', attack: 3, health: 2 }], [{ cardId: 'sandbag', attack: 5, health: 30 }], 5);
    expect(one.playerCardBuffs).toEqual([{ cardId: 'knit', attack: 3, health: 2 }]);
    // Two Grave Knits both die → the entry sums to +6/+4 (each death stacks).
    const two = run(
      [
        { cardId: 'knit', attack: 3, health: 2 },
        { cardId: 'knit', attack: 3, health: 2 },
      ],
      [{ cardId: 'sandbag', attack: 9, health: 60 }],
      5,
    );
    expect(two.playerCardBuffs).toEqual([{ cardId: 'knit', attack: 6, health: 4 }]);
    // An enemy Grave Knit dying gives the player nothing.
    const enemySide = run([{ cardId: 'sandbag', attack: 5, health: 30 }], [{ cardId: 'knit', attack: 3, health: 2 }], 5);
    expect(enemySide.playerCardBuffs).toBeUndefined();
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

  it('applies the player-damage formula on a loss (opponent tier + sum of surviving tiers)', () => {
    const a = run(
      [{ cardId: 'alley', attack: 1, health: 1 }],
      [{ cardId: 'gnash', attack: 6, health: 6 }],
      1,
    );
    expect(a.result).toBe('lose');
    // Gnasher (a T6) survives + the default enemy tier 1 → 1 + 6 = 7.
    expect(a.playerDamage).toBe(7);
    // The opponent's tavern tier adds in: the same fight served from a tier-5 board → 5 + 6 = 11.
    const t5 = run([{ cardId: 'alley', attack: 1, health: 1 }], [{ cardId: 'gnash', attack: 6, health: 6 }], 1, 5);
    expect(t5.playerDamage).toBe(11);
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
    // Player outnumbers the enemy, so the cleaving minion strikes first while two
    // adjacent enemies are present. A single attack should kill both.
    const a = run(
      [
        { cardId: 'alley', attack: 3, health: 10, keywords: ['C'] },
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

  it('Twilight Whelp Deathrattle summons a 3/3 Whelp that attacks immediately (out of turn order)', () => {
    // The 1/1 trades into the enemy and dies → its Deathrattle summons a 3/3 Whelp that strikes RIGHT AWAY.
    const a = run([{ cardId: 'twilightwhelp', attack: 1, health: 1 }], [{ cardId: 'omen', attack: 1, health: 12 }], 3);
    const summonIdx = a.events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'whelpling');
    expect(summonIdx).toBeGreaterThanOrEqual(0); // a Whelp was summoned
    const whelpUid = a.events[summonIdx]!.type === 'summon' ? (a.events[summonIdx] as { minion: { uid: string } }).minion.uid : '';
    // …and it attacked, right after spawning (before the normal rotation would have reached it).
    expect(a.events.slice(summonIdx + 1).some((e) => e.type === 'attack' && e.attacker === whelpUid)).toBe(true);
  });

  it('a golden Twilight Whelp summons two immediate-attack Whelps', () => {
    const a = run([{ cardId: 'twilightwhelp', attack: 1, health: 1, golden: true }], [{ cardId: 'omen', attack: 1, health: 30 }], 3);
    expect(a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'whelpling').length).toBe(2);
  });

  it('Twilight Broodmother Deathrattle leaves 2 Twilight Whelps that chain into 3/3 Whelps', () => {
    const a = run([{ cardId: 'broodmother', attack: 2, health: 1 }], [{ cardId: 'omen', attack: 5, health: 40 }], 3);
    expect(a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'twilightwhelp').length).toBe(2);
    expect(a.events.some((e) => e.type === 'summon' && e.minion.cardId === 'whelpling')).toBe(true); // the Whelps chain in
  });

  it('Venomous destroys whatever it damages', () => {
    const a = run(
      [{ cardId: 'sandbag', attack: 4, health: 4, keywords: ['V'] }],
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
      [{ cardId: 'sandbag', attack: 1, health: 1, keywords: ['V'] }],
      2,
    );
    expect(a.events.some((e) => e.type === 'venomLost')).toBe(true);
    expect(a.result).not.toBe('win'); // the attacker took the venom and died (draw)
    // but a Divine Shield eats the venom — the attacker shrugs it off and wins.
    const b = run(
      [{ cardId: 'omen', attack: 9, health: 30, keywords: ['DS'] }],
      [{ cardId: 'sandbag', attack: 1, health: 1, keywords: ['V'] }],
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
      [{ cardId: 'sandbag', attack: 5, health: 40, keywords: ['V'] }],
      2,
    );
    expect(a.events.some((e) => e.type === 'venomLost')).toBe(true);
  });

  it('Venomous drops off after its first proc — a second wall survives the venom', () => {
    // A fragile 1/3 Venomous vs two 1/20 walls: it poisons (destroys) the first wall (on the
    // retaliation), spends its venom, then can only chip the second for 1 before it dies. Were
    // venom permanent it would poison the second wall too and win — so a loss proves the drop-off.
    const a = run(
      [{ cardId: 'sandbag', attack: 1, health: 3, keywords: ['V'] }],
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
    // A Grave Knit (base 3/2) that entered combat buffed to a 10/3 Divine-Shield body.
    const a = run(
      [{ cardId: 'knit', attack: 10, health: 3, keywords: ['R', 'DS'] }],
      [{ cardId: 'omen', attack: 4, health: 40, keywords: [] }],
      3,
    );
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn).toBeDefined();
    if (reborn && reborn.type === 'reborn') {
      expect(reborn.attack).toBe(3); // base attack, not the buffed 10
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
    expect(reborn && reborn.type === 'reborn' ? [reborn.attack, reborn.hp] : null).toEqual([6, 4]); // 3/2 base × 2
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

  it('Junkyard Titan Deathrattle grants a random Magnetic minion to the hand (toHand event + carry-back)', () => {
    // The Titan dies to retaliation; its Deathrattle queues a random Magnetic minion for the hand and
    // logs a toHand event so the replay flies it over (mirrors Arcane Weaver). The grant is one of the
    // Magnetic-keyword minions (cling / moneybot / heckbinder).
    const a = run([{ cardId: 'junk', attack: 1, health: 1 }], [{ cardId: 'sandbag', attack: 5, health: 5 }], 5);
    expect(a.result).toBe('lose');
    const grant = a.events.find((ev) => ev.type === 'toHand');
    expect(grant && grant.type === 'toHand').toBe(true);
    if (grant && grant.type === 'toHand') {
      expect(CARD_INDEX[grant.cardId]!.keywords).toContain('M'); // a Magnetic minion
      expect(!!grant.source).toBe(true); // attributed to the Titan (for the Procs tab)
    }
    expect(a.playerHandGrants).toHaveLength(1);
    expect(CARD_INDEX[a.playerHandGrants![0]!]!.keywords).toContain('M');
  });

  it('a golden Junkyard Titan grants two Magnetic minions; an enemy Titan grants the player none', () => {
    const golden = run([{ cardId: 'junk', attack: 1, health: 1, golden: true }], [{ cardId: 'sandbag', attack: 5, health: 5 }], 5);
    expect(golden.playerHandGrants).toHaveLength(2);
    for (const id of golden.playerHandGrants!) expect(CARD_INDEX[id]!.keywords).toContain('M');
    // An enemy Titan dying must not stuff the *player's* hand.
    const enemySide = run([{ cardId: 'sandbag', attack: 5, health: 5 }], [{ cardId: 'junk', attack: 1, health: 1 }], 5);
    expect(enemySide.playerHandGrants).toBeUndefined();
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
      // Golden doubles the amount (1 → 2); Sporeling now applies it to ONE random stat, so +2/+0 or +0/+2.
      expect(buff.attack + buff.health).toBe(2);
      expect(Math.min(buff.attack, buff.health)).toBe(0);
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
    // Use a buff Deathrattle (Grim: Beasts +1/+1 per Deathrattle this game — here just Grim itself, so
    // +1) so the proc count is the number of buff events — no board-cap interference. Only the Alleycat
    // is a living Beast to buff.
    const procs = (board: BoardMinion[]): number =>
      run(board, [{ cardId: 'omen', attack: 1, health: 200 }], 1).events.filter(
        (e) => e.type === 'buff' && e.attack === 1,
      ).length;
    const grim = { cardId: 'grim', attack: 1, health: 1 }; // Deathrattle: Beasts +1/+1 per Deathrattle this game
    const carry = { cardId: 'alley', attack: 2, health: 50 }; // surviving Beast
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

  it('Grim buffs Beasts summoned *after* it dies — a persistent aura, not a one-time buff', () => {
    // Grim dies on its first swing (1 HP → retaliation) and registers a Beast aura sized to its tally
    // (here +1/+1: just Grim's own Deathrattle counts so far). Mama Pup outlives it, then dies and summons
    // 2 Pups — and though they're summoned *after* Grim is gone, the aura still catches them. Isolates the
    // aura: a one-time "buff living Beasts" could never reach a minion that didn't exist yet.
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
      const gotAura = a.events.some((b) => b.type === 'buff' && b.target === uid && b.attack === 1 && b.health === 1);
      expect(gotAura).toBe(true);
    }
  });

  it('Grim scales +1/+1 per Deathrattle triggered this game (run-wide base + this combat)', () => {
    // A run that has already seen 5 Deathrattles (the run-wide base); this fight Grim dies (1 more) →
    // tally 6 → the surviving Beast gets +6/+6.
    const p: BoardMinion[] = [
      { cardId: 'grim', attack: 1, health: 1, sourceUid: 'G' },
      { cardId: 'alley', attack: 2, health: 80, sourceUid: 'C' }, // surviving Beast (no Deathrattle)
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 300 }];
    const a = simulate(p, e, makeRng(3), CARD_INDEX, 0, 5); // 6th arg = run-wide Deathrattle base
    const allyUid = a.initial.player.find((m) => m.cardId === 'alley')!.uid;
    expect(a.events.some((ev) => ev.type === 'buff' && ev.target === allyUid && ev.attack === 6 && ev.health === 6)).toBe(true);
  });

  it('Gnasher: each kill permanently raises run-wide spell power (+1/+1)', () => {
    // Player Gnasher (wider board → goes first) kills the lone enemy → +1/+1 to your spells, carried back.
    const a = run(
      [
        { cardId: 'gnash', attack: 6, health: 6 },
        { cardId: 'sandbag', attack: 0, health: 20, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 1, health: 1 }],
      3,
    );
    expect(a.result).toBe('win');
    expect(a.playerSpellPower).toEqual({ attack: 1, health: 1 }); // one kill → +1/+1 spell power
  });

  it('Better Bot (Rally): when it attacks, your other Mechs get +5 Attack', () => {
    const a = run(
      [
        { cardId: 'betterbot', attack: 6, health: 50 }, // rallyMechAtk derived from the CardDef (5)
        { cardId: 'drone', attack: 2, health: 50 }, // a friendly Mech — the buff target
        { cardId: 'sandbag', attack: 0, health: 50, keywords: ['T'] }, // wide board → player goes first
      ],
      [{ cardId: 'omen', attack: 1, health: 200 }],
      3,
    );
    // Better Bot attacked → a +5 Attack buff landed on the Drone (the other Mech), source "Better Bot".
    expect(a.events.some((e) => e.type === 'buff' && e.source === 'Better Bot' && e.attack === 5)).toBe(true);
  });

  it('Better Bot (Rally) fires PER SWING — a Windfury body rallies twice in one attack turn', () => {
    const a = run(
      [
        { cardId: 'betterbot', attack: 6, health: 50, keywords: ['M', 'RL', 'W'] }, // Windfury → two swings
        { cardId: 'drone', attack: 2, health: 50 }, // the buff target (a Mech)
        { cardId: 'sandbag', attack: 0, health: 50, keywords: ['T'] }, // width → player attacks first
      ],
      [{ cardId: 'omen', attack: 0, health: 11 }], // dies to the Better Bot's two 6-damage swings (12 ≥ 11)
      3,
    );
    const rallies = a.events.filter((e) => e.type === 'buff' && e.source === 'Better Bot' && e.attack === 5).length;
    expect(rallies).toBe(2); // two swings → two rallies (the old once-per-attack code fired only one)
  });

  it('Supporter (Rally): when it attacks, 2 friendly Dragons get +1/+2', () => {
    const a = run(
      [
        { cardId: 'supporter', attack: 2, health: 50 }, // wide board → attacks first; 0-atk wall → never dies
        { cardId: 'bronzewarden', attack: 3, health: 50 }, // friendly Dragon (rally target)
        { cardId: 'cleric', attack: 3, health: 50 }, // friendly Dragon (rally target)
      ],
      [{ cardId: 'omen', attack: 0, health: 60 }],
      3,
    );
    // Each Supporter swing rallies its 2 fellow Dragons +1/+2 — at least one full rally (2 buffs) lands.
    const rallies = a.events.filter((e) => e.type === 'buff' && e.attack === 1 && e.health === 2);
    expect(rallies.length).toBeGreaterThanOrEqual(2);
  });

  it('a golden Supporter rallies for +2/+4', () => {
    const a = run(
      [
        { cardId: 'supporter', attack: 2, health: 50, golden: true },
        { cardId: 'bronzewarden', attack: 3, health: 50 },
        { cardId: 'cleric', attack: 3, health: 50 },
      ],
      [{ cardId: 'omen', attack: 0, health: 60 }],
      3,
    );
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 4)).toBe(true);
  });

  it('Stuntdrake (Avenge 3): after 3 friendly deaths, hands its Attack to 2 friends', () => {
    const a = run(
      [
        { cardId: 'stuntdrake', attack: 3, health: 50 }, // survives; gifts its Attack on Avenge
        { cardId: 'bronzewarden', attack: 1, health: 50 }, // a surviving recipient (Dragon)
        { cardId: 'cleric', attack: 1, health: 50 }, // a surviving recipient (Dragon)
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] }, // 3 Taunts die first → Avenge counts to 3
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 2, health: 80 }],
      4,
    );
    // Avenge(3) fires once → Stuntdrake's Attack (3) goes to its 2 surviving friends (+3/+0 each).
    const gifts = a.events.filter((e) => e.type === 'buff' && e.attack === 3 && e.health === 0);
    expect(gifts.length).toBe(2);
  });

  it('Manasaber Deathrattle summons a Saber Cub; golden summons two', () => {
    const cubs = (golden: boolean): number =>
      run(
        [{ cardId: 'manasaber', attack: 4, health: 1, golden }],
        [{ cardId: 'omen', attack: 5, health: 30 }],
        3,
      ).events.filter((e) => e.type === 'summon' && e.minion.cardId === 'sabercub').length;
    expect(cubs(false)).toBe(1);
    expect(cubs(true)).toBe(2);
  });

  it('Raptor buffs another friendly Beast +3/+1 when it attacks — but never itself', () => {
    const a = run(
      [
        { cardId: 'alley', attack: 2, health: 50 }, // a friendly Beast → gets +3/+1 each time it swings
        { cardId: 'raptor', attack: 2, health: 50 },
        { cardId: 'sandbag', attack: 0, health: 50, keywords: ['T'] }, // width → player attacks first
      ],
      [{ cardId: 'omen', attack: 0, health: 40 }],
      3,
    );
    const beastBuffs = a.events.filter((e) => e.type === 'buff' && e.attack === 3 && e.health === 1);
    expect(beastBuffs.length).toBeGreaterThanOrEqual(1); // the Alleycat got pumped on its attacks
    const raptorUid = a.initial.player.find((m) => m.cardId === 'raptor')!.uid;
    expect(a.events.some((e) => e.type === 'buff' && e.target === raptorUid)).toBe(false); // Raptor never self-buffs
  });

  it('Crypt Drake buffs your whole board +2/+2 per ally attack, improving to +4/+4 after 3', () => {
    const a = run(
      [
        { cardId: 'cryptdrake', attack: 4, health: 80 },
        { cardId: 'sandbag', attack: 1, health: 80, keywords: [] }, // a second attacker → more ally attacks
      ],
      [{ cardId: 'omen', attack: 0, health: 200 }], // 0-atk wall → the fight runs long enough to improve
      3,
    );
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 2)).toBe(true); // attacks 1–3
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 4 && e.health === 4)).toBe(true); // improved after 3
  });

  it('Taragosa casts Growth (+3/+4 to all your minions) on each ally attack', () => {
    const a = run(
      [
        { cardId: 'taragosa', attack: 4, health: 50 },
        { cardId: 'sandbag', attack: 1, health: 50, keywords: [] }, // a second attacker
      ],
      [{ cardId: 'omen', attack: 0, health: 60 }],
      3,
    );
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 3 && e.health === 4)).toBe(true); // Growth +3/+4
  });

  it('Taragosa casts a REAL spell in combat → triggers Guel and carries the cast back to the run', () => {
    const a = run(
      [
        { cardId: 'taragosa', attack: 3, health: 50 },
        { cardId: 'guel', attack: 2, health: 50 }, // After a spell is cast, buffs 2 others +1/+1 (+step)
        { cardId: 'sandbag', attack: 1, health: 50, keywords: [] }, // an attacker to drive ally attacks
      ],
      [{ cardId: 'omen', attack: 0, health: 80 }], // 0-attack → the player just keeps swinging
      3,
    );
    // Each Growth cast is a real spell cast → carried back to bump the run's spellsCast…
    expect(a.playerSpellsCast).toBeGreaterThan(0);
    // …and it fires Guel mid-combat: its +1/+1 grant (distinct from Growth's +3/+4) lands on the early casts.
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 1 && e.health === 1)).toBe(true);
  });

  it('Guel scales in combat with the run spellsCast passed in (start at 4 → +2/+2 grant)', () => {
    // spellsCast = 4 at combat start → step = floor((4+1)/4) = 1 on the first cast → Guel grants +2/+2.
    const a = simulate(
      [
        { cardId: 'taragosa', attack: 3, health: 50 },
        { cardId: 'guel', attack: 2, health: 50 },
      ],
      [{ cardId: 'omen', attack: 0, health: 80 }],
      makeRng(3), CARD_INDEX, 0, 0, 1, 0, 0, 4, // …, spellsCast = 4
    );
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 2)).toBe(true);
  });

  it('Tara tallies its in-combat stat-grants (reported via playerAscendCount)', () => {
    const a = run(
      [
        { cardId: 'tara', attack: 3, health: 80, keywords: ['EG'], sourceUid: 'T' },
        { cardId: 'taragosa', attack: 3, health: 80 }, // Growth (+3/+4 to all) each ally attack → grants Tara stats
        { cardId: 'sandbag', attack: 1, health: 80, keywords: [] },
      ],
      [{ cardId: 'omen', attack: 0, health: 200 }],
      3,
    );
    const tara = a.playerAscendCount?.find((x) => x.sourceUid === 'T');
    expect(tara?.count).toBeGreaterThan(0); // Tara was granted stats and counted them toward ascension
  });

  it('Hunter grants Health to your board whenever its Attack rises (driven here by Crypt Drake)', () => {
    const a = run(
      [
        { cardId: 'hunter', attack: 5, health: 60 },
        { cardId: 'cryptdrake', attack: 4, health: 60 }, // raises Hunter's Attack each ally attack
        { cardId: 'sandbag', attack: 1, health: 60, keywords: [] },
      ],
      [{ cardId: 'omen', attack: 0, health: 200 }],
      3,
    );
    // Hunter's reaction is a Health-only +0/+2 to the board — uniquely distinguishable from Crypt Drake's +X/+X.
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 0 && e.health === 2)).toBe(true);
  });

  it('Burial Imp: its Deathrattle queues Fodder for the next tavern (carried back)', () => {
    const a = run(
      [{ cardId: 'burialimp', attack: 3, health: 1 }],
      [{ cardId: 'omen', attack: 5, health: 50 }],
      3,
    );
    expect(a.playerFodderGrants).toBe(1); // one Burial Imp died → 1 Fodder queued for the next tavern
  });

  it('Sporebat Deathrattle banks a random tavern-tier spell (carried back); golden banks two', () => {
    const grants = (golden: boolean): number | undefined =>
      run([{ cardId: 'sporebat', attack: 2, health: 1, golden }], [{ cardId: 'omen', attack: 5, health: 5 }], 3).playerSpellGrants;
    expect(grants(false)).toBe(1);
    expect(grants(true)).toBe(2);
  });

  it('Gryphon banks a free refresh PER HIT, capped at 4 a combat', () => {
    const a = run(
      [{ cardId: 'gryphon', attack: 3, health: 40, keywords: ['T'] }], // soaks ~13 hits over the fight
      [{ cardId: 'omen', attack: 2, health: 40 }],
      3,
    );
    expect(a.playerFreeRolls).toBe(4); // 1 per hit, capped at 4 despite many more hits landing
  });

  it('a golden Gryphon banks two refreshes per hit (still capped at 4 hits → 8)', () => {
    const a = run(
      [{ cardId: 'gryphon', attack: 3, health: 40, keywords: ['T'], golden: true }],
      [{ cardId: 'omen', attack: 2, health: 40 }],
      3,
    );
    expect(a.playerFreeRolls).toBe(8); // 2 per hit × the 4-hit cap
  });

  it('Soulsman: Avenge (4) permanently raises your max Gold (carried back)', () => {
    const a = run(
      [
        { cardId: 'soulsman', attack: 0, health: 300 }, // 0-Attack: never swings, just counts friendly deaths
        ...Array.from({ length: 8 }, () => ({ cardId: 'sandbag', attack: 1, health: 1 })),
      ],
      [{ cardId: 'omen', attack: 5, health: 300 }],
      3,
    );
    expect(a.playerMaxGoldGain).toBe(2); // 8 friendly deaths / Avenge 4 = 2 procs (+1 Gold each)
    // Each proc logs a `maxGold` event (player side) so the UI can pulse Soulsman + float the gain.
    const goldEvents = a.events.filter((ev) => ev.type === 'maxGold');
    expect(goldEvents.length).toBe(2);
    expect(goldEvents.every((ev) => ev.type === 'maxGold' && ev.side === 'player' && ev.amount === 1)).toBe(true);
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
    // Deathsayer (no Deathrattle of its own) + a Sporeling (Deathrattle: buff all friends, random stat).
    // When Deathsayer attacks, its Rally fires the leftmost friendly Deathrattle (Sporeling's) first — so
    // the buff events land before that attack's damage.
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
    // Deathsayer + a Sporeling (Deathrattle: buff all friends) + two Sylus (each: Deathrattles proc 1 more
    // time). When Deathsayer attacks, the Rally-proc'd Deathrattle fires 1 + 2 = 3 times, each buffing all
    // 4 friends → 3 × 4 = 12 buff events before that attack's damage, like a real death would with two Sylus.
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
    expect(buffs).toBe(3 * p.length); // (1 base proc + 2 Sylus extras) × all 4 friends buffed per proc
  });

  it('a golden Deathsayer procs the leftmost Deathrattle twice — and multiplies on top of Sylus', () => {
    const rallyBuffs = (golden: boolean, sylus: number, seed: number): number => {
      const p: BoardMinion[] = [
        { cardId: 'deathsayer', attack: 3, health: 40, golden },
        { cardId: 'spore', attack: 1, health: 40 }, // Deathrattle: buff all friends (random stat) — 1 buff event each
        ...Array.from({ length: sylus }, (): BoardMinion => ({ cardId: 'sylus', attack: 4, health: 40 })),
      ];
      const a = run(p, [{ cardId: 'omen', attack: 1, health: 400 }], seed);
      const r = a.events.findIndex((ev) => ev.type === 'rally');
      const dmg = a.events.findIndex((ev, i) => i > r && ev.type === 'dmg');
      return a.events.filter((ev, i) => i > r && i < dmg && ev.type === 'buff').length;
    };
    // Each proc buffs every friend, so buff events = procs × friends on board.
    expect(rallyBuffs(true, 0, 7)).toBe(2 * 2); // golden → 2 procs, 2 friends
    expect(rallyBuffs(true, 1, 7)).toBe(4 * 3); // (1 + 1 Sylus) × 2 golden = 4 procs, 3 friends
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

  it('counts enemy-side deaths in enemyDeaths (Cassen Collision) — player losses excluded', () => {
    // Gnasher (re-attacks on kill) clears two 1/1 enemies on its own turn; the player loses nothing.
    const a = run(
      [
        { cardId: 'gnash', attack: 6, health: 6 },
        { cardId: 'sandbag', attack: 0, health: 20, keywords: ['T'] }, // inert filler → Gnasher goes first
      ],
      [
        { cardId: 'omen', attack: 1, health: 1 },
        { cardId: 'omen', attack: 1, health: 1 },
      ],
      1,
    );
    expect(a.result).toBe('win');
    expect(a.enemyDeaths).toBe(2); // both enemy minions died
    // A fight where the player loses a minion must not inflate enemyDeaths with player deaths.
    const b = run(
      [{ cardId: 'alley', attack: 1, health: 1 }],
      [{ cardId: 'gnash', attack: 6, health: 6 }],
      1,
    );
    expect(b.result).toBe('lose');
    expect(b.enemyDeaths).toBe(0); // only the player's Alleycat died — not counted
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
    const r = run(player, [{ cardId: 'sandbag', attack: 3, health: 80 }], 4);
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
    const r = run(player, [{ cardId: 'sandbag', attack: 8, health: 80 }], 3);
    expect(r.playerPermaBuffs).toBeDefined();
    expect(r.playerPermaBuffs!.length).toBeGreaterThan(0);
    for (const b of r.playerPermaBuffs!) {
      expect(b.attack % 3).toBe(0); // each gift is +3/+3 (or a multiple if a minion was picked twice)
      expect(b.health % 3).toBe(0);
    }
  });

  it('Taurus engraves the minion to its LEFT — that minion keeps its combat gains (carry-back)', () => {
    // A Sporeling dies and buffs every friend +1 of one stat (combat-only). The target wall has its keywords
    // stripped, so its +1 would NOT normally carry back; Taurus sits to its right and engraves it at Start of
    // Combat → the +1 is recorded as a permaGain (engraved: true), carried back even though it later dies.
    const a = run(
      [
        { cardId: 'sandbag', attack: 0, health: 30, keywords: [], sourceUid: 'G' }, // engraved target (Taurus's left)
        { cardId: 'taurus', attack: 6, health: 30, sourceUid: 'T' },
        { cardId: 'spore', attack: 1, health: 1, sourceUid: 'S' }, // dies → buffs all friends +1 (random stat)
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    const perma = a.playerPermaBuffs?.find((p) => p.sourceUid === 'G');
    expect(perma).toBeDefined();
    expect(perma!.attack + perma!.health).toBe(1); // the +1 (Attack or Health) carried back...
    expect(perma!.engraved).toBe(true); // ...labelled Engraved (sc-granted EG on the combat minion)
    // A Start-of-Combat `sc` event was logged for Taurus's engrave (source = Taurus's combat uid).
    const taurusUid = a.initial.player.find((m) => m.cardId === 'taurus')!.uid;
    expect(a.events.some((e) => e.type === 'sc' && e.source === taurusUid)).toBe(true);
  });

  it('Taurus does NOT carry back a non-adjacent friend (guard)', () => {
    // Same Sporeling buff, but a wedge sits between the target wall and Taurus, so the wall is NOT Taurus's
    // left neighbor — its +1 is combat-only and must NOT carry back.
    const a = run(
      [
        { cardId: 'sandbag', attack: 0, health: 30, keywords: [], sourceUid: 'G' }, // NOT adjacent to Taurus
        { cardId: 'sandbag', attack: 0, health: 30, keywords: ['T'] }, // wedge between the target and Taurus
        { cardId: 'taurus', attack: 6, health: 30, sourceUid: 'T' },
        { cardId: 'spore', attack: 1, health: 1, sourceUid: 'S' },
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    expect(a.playerPermaBuffs?.find((p) => p.sourceUid === 'G')).toBeUndefined(); // gain dropped, as normal
  });

  it('a golden Taurus engraves BOTH neighbors — and a non-neighbor friend still does NOT carry back', () => {
    // Golden Taurus at the center, a 0-Attack wall on EACH side (L, R) plus a NON-adjacent wall (X). A
    // Sporeling dies and buffs every friend +1 of one stat (combat-only). Golden Taurus engraved both L
    // and R at Start of Combat, so their +1 carries back; X got the same combat buff but isn't engraved,
    // so it must NOT carry back. (Carry-back applies win or lose — here the tanky omen wins.)
    const a = run(
      [
        { cardId: 'sandbag', attack: 0, health: 30, keywords: [], sourceUid: 'L' }, // left neighbor
        { cardId: 'taurus', attack: 6, health: 40, golden: true, sourceUid: 'T' },
        { cardId: 'sandbag', attack: 0, health: 30, keywords: [], sourceUid: 'R' }, // right neighbor
        { cardId: 'spore', attack: 1, health: 2, sourceUid: 'S' }, // dies → buffs all friends +1 (random stat)
        { cardId: 'sandbag', attack: 0, health: 30, sourceUid: 'X' }, // NON-adjacent friend (guard)
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    const left = a.playerPermaBuffs?.find((p) => p.sourceUid === 'L');
    const right = a.playerPermaBuffs?.find((p) => p.sourceUid === 'R');
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left!.attack + left!.health).toBe(1); // exactly one +1 (Attack or Health) kept...
    expect(right!.attack + right!.health).toBe(1);
    expect(left!.engraved && right!.engraved).toBe(true); // ...labelled Engraved
    expect(a.playerPermaBuffs?.find((p) => p.sourceUid === 'X')).toBeUndefined(); // non-neighbor: gain dropped
  });

  it('native Engraved keeps a minion combat gain (carry-back, no Taurus)', () => {
    // Regression guard for the carry-back refactor: a wall with the native EG keyword keeps whatever it
    // gains — a Sporeling dies and buffs all friends +1 of one stat; the EG wall's +1 carries back with
    // engraved: true, no Taurus involved.
    const a = run(
      [
        { cardId: 'sandbag', attack: 0, health: 30, keywords: ['EG'], sourceUid: 'G' },
        { cardId: 'spore', attack: 1, health: 1, sourceUid: 'S' },
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    const perma = a.playerPermaBuffs?.find((p) => p.sourceUid === 'G');
    expect(perma).toBeDefined();
    expect(perma!.attack + perma!.health).toBe(1);
    expect(perma!.engraved).toBe(true);
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

  it('Lantern of Souls: every player Undead enters combat with +N Attack (enemy Undead unaffected)', () => {
    // Sporeling is Undead; Target Dummy is not. The +3 applies only to the player-side Undead.
    const p: BoardMinion[] = [
      { cardId: 'spore', attack: 1, health: 2, sourceUid: 'u' }, // Undead → +3 attack
      { cardId: 'sandbag', attack: 0, health: 4 }, // not Undead → untouched
    ];
    const e: BoardMinion[] = [{ cardId: 'spore', attack: 1, health: 2 }]; // enemy Undead → no bonus
    const a = simulate(p, e, makeRng(7), CARD_INDEX, 0, 0, 1, 3); // 8th arg = undeadAttackBonus
    const pSpore = a.initial.player.find((m) => m.cardId === 'spore')!;
    const pSandbag = a.initial.player.find((m) => m.cardId === 'sandbag')!;
    const eSpore = a.initial.enemy.find((m) => m.cardId === 'spore')!;
    expect(pSpore.attack).toBe(4); // 1 + 3
    expect(pSandbag.attack).toBe(0); // non-Undead unaffected
    expect(eSpore.attack).toBe(1); // enemy Undead unaffected (player-side only)
  });

  it('Lantern of Souls re-applies to a player Undead that Reborns mid-combat', () => {
    // Grave Knit (Undead, Reborn, 3/2 base) enters at 3+3 = 6 Attack, dies to retaliation, and Reborns at
    // base — where the Lantern bonus is re-applied, so the reborn body is back to 6 Attack (not the base 3).
    const p: BoardMinion[] = [{ cardId: 'knit', attack: 2, health: 2, keywords: ['R'] }]; // R granted inline (knit is no longer Reborn by default)
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 5, health: 80 }]; // out-trades the Knit → forces the Reborn
    const a = simulate(p, e, makeRng(3), CARD_INDEX, 0, 0, 1, 3);
    const reborn = a.events.find((ev) => ev.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' && reborn.attack).toBe(6); // base 3 + Lantern 3, re-applied on rebirth
  });

  it('Lantern of Souls: the spell-power component also raises Undead Health', () => {
    // +4 Attack / +1 Health (the spell-power scaling): a 1/2 Sporeling (Undead) enters combat at 5/3.
    const p: BoardMinion[] = [{ cardId: 'spore', attack: 1, health: 2, sourceUid: 'u' }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 4 }];
    const a = simulate(p, e, makeRng(7), CARD_INDEX, 0, 0, 1, 4, 1); // 8th arg = +Attack, 9th arg = +Health
    const spore = a.initial.player.find((m) => m.cardId === 'spore')!;
    expect(spore.attack).toBe(5); // 1 + 4
    expect(spore.health).toBe(3); // 2 + 1
  });
});
