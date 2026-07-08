import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/** The health deltas of every `buff` event in a combat (for asserting Deathrattle HP grants). */
const buffHealths = (events: CombatEvent[]): number[] =>
  events.flatMap((ev) => (ev.type === 'buff' ? [ev.health] : []));

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon'];
const run = (p: BoardMinion[], e: BoardMinion[], seed: number, enemyTier = 1, playerTier = 6, playerTribes: string[] = ALL_TRIBES) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, 0, 0, enemyTier, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, playerTier, playerTribes);

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

  it('carries the recruit-phase buff breakdown into the initial snapshot (for the combat inspect)', () => {
    // A board minion enters combat with a recruit-buff breakdown; the snapshot the UI reads must keep it
    // so right-click inspect can itemize recruit buffs in combat (parity with the shop panel).
    const p: BoardMinion[] = [
      { cardId: 'pack', attack: 8, health: 8, buffs: [{ source: 'Spirit Fire', attack: 6, health: 6, count: 2 }] },
    ];
    const r = run(p, [{ cardId: 'sandbag', attack: 1, health: 1 }], 1);
    expect(r.initial.player[0]!.buffs).toEqual([{ source: 'Spirit Fire', attack: 6, health: 6, count: 2 }]);
    // A summoned token (enemy sandbag here had none) carries no breakdown.
    expect(r.initial.enemy[0]!.buffs).toBeUndefined();
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
    const e: BoardMinion[] = [{ cardId: 'cleric', attack: 3, health: 20 }]; // inert 3-Attack wall (battlecry no-ops in combat)
    const r = run(p, e, 7);
    expect(r.result).toBe('win'); // Kennelmaster outlasts the attacker
    expect(r.playerSummonBonus).toContainEqual({ sourceUid: 'K', bonus: 1 });
  });

  it('Kennelmaster Start of Combat: buffs your Beasts +1/+1, and a Beast summoned later inherits the aura', () => {
    // The SoC aura buffs the living Beasts now (Kennelmaster + Mama Pup), then Mama Pup dies and its Pups —
    // summoned AFTER the aura registered — pick it up too ("wherever they are, incl. combat summons").
    const p: BoardMinion[] = [
      { cardId: 'kennel', attack: 1, health: 30 }, // aura source; tanky so it survives
      { cardId: 'pack', attack: 2, health: 1 },    // Mama Pup — a Beast; dies → summons two Pups (Beasts)
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 30 }];
    const r = run(p, e, 1);
    const summonEvents = r.events.filter((ev) => ev.type === 'summon');
    expect(summonEvents.length).toBeGreaterThanOrEqual(1); // Mama Pup's Pups spawned
    const summonedUids = new Set(summonEvents.flatMap((ev) => (ev.type === 'summon' ? [ev.minion.uid] : [])));
    // A Beast summoned after Kennelmaster's SoC still receives the +1/+1 aura.
    const summonAura = r.events.some((ev) => ev.type === 'buff' && ev.attack === 1 && ev.health === 1 && summonedUids.has(ev.target));
    expect(summonAura).toBe(true);
  });

  it('Gravewarden Start of Combat gives a friendly Undead Rise (Reborn)', () => {
    // Gravewarden + Soulsman (both Undead). At combat start the OTHER Undead is granted Reborn — a keyword event.
    const p: BoardMinion[] = [
      { cardId: 'gravewarden', attack: 3, health: 40 },
      { cardId: 'soulsman', attack: 2, health: 40 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 200 }];
    const r = run(p, e, 5);
    const soulsmanUid = r.initial.player.find((u) => u.cardId === 'soulsman')!.uid;
    expect(r.events.some((ev) => ev.type === 'keyword' && ev.keyword === 'R' && ev.target === soulsmanUid)).toBe(true);
  });

  it("Arena Heckler Start of Combat gives the enemy's rightmost minion Taunt", () => {
    const p: BoardMinion[] = [{ cardId: 'arenaheckler', attack: 2, health: 40 }];
    const e: BoardMinion[] = [
      { cardId: 'sandbag', attack: 1, health: 40 },
      { cardId: 'omen', attack: 1, health: 40 }, // rightmost → gets Taunt
    ];
    const r = run(p, e, 3);
    const rightmost = r.initial.enemy[r.initial.enemy.length - 1]!.uid;
    expect(r.events.some((ev) => ev.type === 'keyword' && ev.keyword === 'T' && ev.target === rightmost)).toBe(true);
  });

  it("Bloodbinder Rally gives another friendly Demon Attack equal to its own", () => {
    const p: BoardMinion[] = [
      { cardId: 'bloodbinder', attack: 5, health: 20 },
      { cardId: 'impscrap', attack: 1, health: 20 }, // another Demon (Imp) → the Rally target
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 50 }]; // tanky → Bloodbinder gets to attack
    const r = run(p, e, 3);
    const impUid = r.initial.player.find((u) => u.cardId === 'impscrap')!.uid;
    expect(r.events.some((ev) => ev.type === 'buff' && ev.target === impUid && ev.attack === 5)).toBe(true);
  });

  it('Mirrorhide Rhino Start of Combat summons one EXACT copy (current stats + keywords, no chain)', () => {
    const p: BoardMinion[] = [{ cardId: 'mirrorrhino', attack: 10, health: 8, keywords: ['W'] }]; // buffed + Flurry
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 80 }];
    const r = run(p, e, 6);
    const copies = r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'mirrorrhino');
    expect(copies.length).toBe(1); // exactly one copy — the summoned copy does NOT re-fire Start of Combat
    const c = copies[0]!;
    expect(c.type === 'summon' && c.minion.attack).toBe(10); // current Attack, not base 6
    expect(c.type === 'summon' && c.minion.health).toBe(8);
    expect(c.type === 'summon' && c.minion.keywords.includes('W')).toBe(true); // Flurry copied
  });

  it('Moe Slaughter banks free rerolls for next shop (carried back)', () => {
    const p: BoardMinion[] = [{ cardId: 'moe', attack: 4, health: 20 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }]; // Moe kills it → grants 1 free reroll
    const r = run(p, e, 3);
    expect(r.playerFreeRolls).toBe(1);
  });

  it('Bounty Bot Slaughter grants Gold to next shop (carried back)', () => {
    const p: BoardMinion[] = [{ cardId: 'bountybot', attack: 7, health: 20 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }]; // Bounty Bot kills it → grants 2 Gold
    const r = run(p, e, 5);
    expect(r.playerBonusGold).toBe(2);
  });

  it('Pit Supplier Avenge (3) queues a Fodder into the next shop (carried back)', () => {
    // Three 1/1 Strays die (attacking into the omen's retaliation) → the 3rd death procs Avenge (3) → 1 Fodder.
    const p: BoardMinion[] = [
      { cardId: 'pitsupplier', attack: 4, health: 40 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 60 }];
    const r = run(p, e, 3);
    expect(r.playerFodderGrants).toBe(1);
  });

  it('Runescale Drake Start of Combat buffs your Dragons +2/+2 (base, 0 spells)', () => {
    const p: BoardMinion[] = [{ cardId: 'runescale', attack: 4, health: 20 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 50 }];
    const r = run(p, e, 3);
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 2 && ev.health === 2)).toBe(true);
  });

  it('Runescale Drake scales with spells cast this turn (3 spells → +5/+5)', () => {
    const p: BoardMinion[] = [{ cardId: 'runescale', attack: 4, health: 20 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 50 }];
    const r = simulate(p, e, makeRng(3), CARD_INDEX, 3); // 3 spells this turn → base 2 + 3
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 5 && ev.health === 5)).toBe(true);
  });

  it('Spell Appraiser Avenge (4) raises run-wide spell power +1 Attack (carried back)', () => {
    const p: BoardMinion[] = [
      { cardId: 'spellappraiser', attack: 1, health: 40 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 60 }];
    const r = run(p, e, 4);
    expect(r.playerSpellPower?.attack).toBe(1); // 4th friendly death → Avenge (4) → +1 spell Attack
  });

  it('Baby Cub is a vanilla Cleave beast — one swing splashes the target’s neighbour', () => {
    const p: BoardMinion[] = [{ cardId: 'babycub', attack: 4, health: 30 }];
    const e: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 50 },
      { cardId: 'sandbag', attack: 0, health: 50 }, // the other enemy — Cleave splashes it as the neighbour
    ];
    const r = run(p, e, 3);
    const enemyUids = new Set(r.initial.enemy.map((m) => m.uid));
    // Damage landed by Baby Cub's FIRST swing (between the 1st and 2nd `attack` events): with only two enemies,
    // whichever it hits, the other is its neighbour — so Cleave damages BOTH on that one swing.
    const firstAttack = r.events.findIndex((ev) => ev.type === 'attack');
    const nextAttack = r.events.findIndex((ev, i) => i > firstAttack && ev.type === 'attack');
    const window = r.events.slice(firstAttack + 1, nextAttack === -1 ? undefined : nextAttack);
    const hit = new Set(window.flatMap((ev) => (ev.type === 'dmg' && enemyUids.has(ev.target) ? [ev.target] : [])));
    expect(hit.size).toBe(2);
  });

  it('Hoardbreaker Drake Slaughter casts Growth (buffs all friends +3/+4)', () => {
    const p: BoardMinion[] = [
      { cardId: 'hoardbreaker', attack: 4, health: 20 },
      { cardId: 'sandbag', attack: 0, health: 20 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }]; // dies to Hoardbreaker → Slaughter
    const r = run(p, e, 3);
    expect(r.events.some((ev) => ev.type === 'buff' && ev.attack === 3 && ev.health === 4)).toBe(true);
  });

  it('Spark Capacitor Avenge (4) adds a Spark Plug to hand', () => {
    const p: BoardMinion[] = [
      { cardId: 'sparkcapacitor', attack: 4, health: 40 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 80 }];
    const r = run(p, e, 4);
    expect(r.playerHandGrants).toContain('sparkplug'); // 4 friendly deaths → Avenge (4) → get a Spark Plug
  });

  it('Imp Overseer Echo summons an Imp when it dies in combat', () => {
    const p: BoardMinion[] = [{ cardId: 'impoverseer', attack: 3, health: 1 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 20 }]; // kills the 3/1 Overseer
    const r = run(p, e, 3);
    expect(r.events.some((ev) => ev.type === 'summon')).toBe(true); // its Echo (Deathrattle) summoned an Imp
  });

  it('Moe Slaughter banks 1 free refresh + 1 guaranteed-attachment shop (2 golden)', () => {
    const p: BoardMinion[] = [{ cardId: 'moe', attack: 4, health: 10 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }]; // Moe kills it → Slaughter
    const r = run(p, e, 3);
    expect(r.playerFreeRolls).toBe(1);
    expect(r.playerGuaranteedAttachments).toBe(1);
    // golden Moe → 2 of each
    const g = run([{ cardId: 'moe', attack: 8, health: 10, golden: true }], e, 3);
    expect(g.playerFreeRolls).toBe(2);
    expect(g.playerGuaranteedAttachments).toBe(2);
  });

  it('Bounty Bot is immune for its first 2 attacks each combat, then takes retaliation', () => {
    // A friendly Taunt soaks the enemy's own swings, so the ONLY damage that can reach Bounty Bot is retaliation
    // on ITS attacks. Its first two swings are immune; the third takes the 10 retaliation and kills the 3-HP body.
    // The enemy needs all THREE of Bounty Bot's 7-damage hits to fall (21 HP) — which only happens if the first
    // two swings were immune (otherwise Bounty Bot dies on swing 1 and the enemy survives at 14 HP).
    const p: BoardMinion[] = [
      { cardId: 'bountybot', attack: 7, health: 100 }, // high HP so it survives to swing 3 and we can count retaliation
      { cardId: 'sabercub', attack: 0, health: 500, keywords: ['T'] }, // inert 0-Attack Taunt (no effects) soaks the enemy
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 10, health: 21 }]; // 3 hits of 7 → dies on Bounty Bot's 3rd swing
    const r = run(p, e, 3);
    const bounty = r.initial.player[0]!.uid;
    const enemyBag = r.initial.enemy[0]!.uid;
    expect(r.events.some((ev) => ev.type === 'death' && ev.target === enemyBag)).toBe(true); // Bounty Bot landed all 3 hits itself
    // First two swings immune, third retaliates → exactly ONE retaliation hit lands on Bounty Bot.
    const retaliations = r.events.filter((ev) => ev.type === 'dmg' && ev.target === bounty).length;
    expect(retaliations).toBe(1);
  });

  it('Philippe Rally splashes a random enemy on attack (and takes no damage back from it)', () => {
    const p: BoardMinion[] = [{ cardId: 'philippe', attack: 4, health: 7 }];
    const e: BoardMinion[] = [
      { cardId: 'sabercub', attack: 0, health: 30 }, // inert (no attack-on-damage) so it can't retaliate
      { cardId: 'sabercub', attack: 0, health: 30 },
    ];
    const r = run(p, e, 3);
    const enemyUids = new Set(r.initial.enemy.map((m) => m.uid));
    const phil = r.initial.player[0]!.uid;
    // Philippe's first swing: the main hit PLUS the random-enemy splash → ≥2 enemy dmg events before its next attack.
    const firstAttack = r.events.findIndex((ev) => ev.type === 'attack' && ev.attacker === phil);
    const nextAttack = r.events.findIndex((ev, i) => i > firstAttack && ev.type === 'attack');
    const window = r.events.slice(firstAttack + 1, nextAttack === -1 ? undefined : nextAttack);
    const enemyHits = window.filter((ev) => ev.type === 'dmg' && enemyUids.has(ev.target)).length;
    expect(enemyHits).toBeGreaterThanOrEqual(2);
    // 0-Attack enemies → Philippe takes no damage: the splash target never retaliates, only the minion it attacks.
    expect(r.events.some((ev) => ev.type === 'dmg' && ev.target === phil && ev.amount > 0)).toBe(false);
    // Golden: the splash deals Attack + 2 — a golden 8-Attack Philippe splashes a lone enemy for 10.
    const gr = run([{ cardId: 'philippe', attack: 8, health: 7, golden: true }], [{ cardId: 'sabercub', attack: 0, health: 40 }], 3);
    expect(gr.events.some((ev) => ev.type === 'dmg' && ev.amount === 10)).toBe(true);
  });

  it('Solaris Fang Rally builds a Beast Attack aura; Rallying Offensive makes it fire twice', () => {
    // Solaris + Mama Pup are both Beasts. On Solaris's one killing swing its Rally grants +5 Attack to both
    // (2 buff events). With Rallying Offensive armed the Rally re-runs → 4.
    const p: BoardMinion[] = [
      { cardId: 'solaris', attack: 5, health: 10 },
      { cardId: 'pack', attack: 1, health: 10 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }]; // dies to one swing → exactly one Rally
    const call = (rallyDouble: boolean) =>
      simulate(p, e, makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ALL_TRIBES, {}, false, rallyDouble);
    const rally5 = (r: ReturnType<typeof simulate>) => r.events.filter((ev) => ev.type === 'buff' && ev.attack === 5).length;
    expect(rally5(call(false))).toBe(2); // Solaris + Mama Pup, once
    expect(rally5(call(true))).toBe(4);  // …twice with Rallying Offensive
  });

  it('Solaris Fang Avenge (5): gains a Divine Shield (Ward) and attacks immediately', () => {
    // Five 0/1 Taunts are the forced targets — they die first while Solaris chips the wall; the 5th death
    // triggers Avenge (5) → Solaris gains a shield (shieldUp) and takes a bonus out-of-turn attack.
    const p: BoardMinion[] = [
      { cardId: 'solaris', attack: 5, health: 40 },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 120 }];
    const r = run(p, e, 7);
    const solarisUid = r.initial.player[0]!.uid;
    expect(r.events.some((ev) => ev.type === 'shieldUp' && ev.target === solarisUid)).toBe(true);
  });

  it('a golden Solaris Fang gains a fresh Ward before EACH of its two immediate Avenge strikes', () => {
    // Golden strikes twice; a non-Taunt wall retaliates and pops the Ward each strike, so a fresh Ward must be
    // re-granted before the second (two shieldUp events on Solaris) — not just one up front.
    const p: BoardMinion[] = [
      { cardId: 'solaris', attack: 5, health: 40, golden: true },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
    ];
    // A tanky wall: it must outlast Solaris's Rally ramp (golden +10 Attack per swing) so all FIVE Taunts
    // fall to it first and Avenge (5) fires — then it retaliates and pops the Ward on each immediate strike.
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 500 }];
    const r = run(p, e, 7);
    const solarisUid = r.initial.player[0]!.uid;
    const wards = r.events.filter((ev) => ev.type === 'shieldUp' && ev.target === solarisUid).length;
    expect(wards).toBeGreaterThanOrEqual(2); // one Ward before each of the two immediate strikes
  });

  it('Watcher Rally casts Lantern of Souls: the Undead aura carries back (+3/+0) AND counts as a spell cast; golden 2×', () => {
    // Watcher one-shots a 0/1 wall → its Rally casts Lantern once: your Undead gain +3/+0 permanently (carried
    // back via playerUndeadAuraGain — the Lantern channel) and it registers as a real spell cast.
    const p: BoardMinion[] = [
      { cardId: 'watcher', attack: 8, health: 30 },
      { cardId: 'spore', attack: 1, health: 30 }, // a friendly Undead that receives the aura
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }]; // dies to one swing → exactly one Rally
    const r = run(p, e, 1);
    expect(r.playerUndeadAuraGain).toEqual({ attack: 3, health: 0 }); // one Lantern cast → +3/+0 Undead aura
    expect(r.playerSpellsCast).toBe(1);       // counts as a spell cast (feeds Spirit Pup / Guel)
    // Golden Watcher casts it twice.
    const rg = run([{ cardId: 'watcher', attack: 8, health: 30, golden: true }, { cardId: 'spore', attack: 1, health: 30 }], e, 1);
    expect(rg.playerUndeadAuraGain).toEqual({ attack: 6, health: 0 }); // +3/+0 × 2 casts
    expect(rg.playerSpellsCast).toBe(2);
  });

  it("Watcher's Lantern folds spell power into BOTH stats (+5/+2 with +2/+2)", () => {
    const p: BoardMinion[] = [{ cardId: 'watcher', attack: 8, health: 30 }, { cardId: 'spore', attack: 1, health: 30 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
    // spellPowerAtk = 2, spellPowerHp = 2 (16th/17th positional args after CARD_INDEX).
    const r = simulate(p, e, makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 6, ALL_TRIBES);
    expect(r.playerUndeadAuraGain).toEqual({ attack: 5, health: 2 }); // base 3 + spell power → +5/+2
  });

  it('mid-combat Undead aura gains reach Undead summoned later that fight (Watcher → Steadfast Spear Warden)', () => {
    const p: BoardMinion[] = [
      { cardId: 'watcher', attack: 8, health: 100 },   // Rally casts Lantern → +3 Undead aura
      { cardId: 'steadfast', attack: 4, health: 100 }, // Avenge (4) → summons a Spear Warden
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }];
    const r = run(p, e, 7);
    const wardenSummon = r.events.find((ev) => ev.type === 'summon' && ev.minion.cardId === 'knit');
    expect(wardenSummon).toBeDefined();
    // The summoned Spear Warden (base 3 Attack) must inherit the Undead aura Watcher pumped this fight.
    expect(wardenSummon && wardenSummon.type === 'summon' ? wardenSummon.minion.attack : 0).toBeGreaterThan(3);
  });

  it('Kennelmaster aura re-applies to a Reborn Beast (summoned in any way)', () => {
    // A Beast that RISES mid-fight must re-inherit Kennelmaster's Start-of-Combat aura, not just fresh summons.
    // The Gryphon (granted Rise + Taunt so it's the forced target) dies, returns at base, and comes back aura'd.
    const p: BoardMinion[] = [
      { cardId: 'kennel', attack: 1, health: 40 },
      { cardId: 'gryphon', attack: 2, health: 1, keywords: ['R', 'T'] }, // granted Rise; the forced target
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 60 }];
    const r = run(p, e, 3);
    const rebornIdx = r.events.findIndex((ev) => ev.type === 'reborn');
    expect(rebornIdx).toBeGreaterThanOrEqual(0); // the Gryphon Rose
    const gUid = (r.events[rebornIdx] as { target: string }).target;
    // A +1/+1 aura buff lands on the Gryphon AFTER it Rises (the bug: reborn bodies were skipped).
    const auraAfterRise = r.events.slice(rebornIdx + 1).some(
      (ev) => ev.type === 'buff' && ev.target === gUid && ev.attack === 1 && ev.health === 1,
    );
    expect(auraAfterRise).toBe(true);
  });

  it('Sergeant Deathrattle uses its seeded hpGrantBonus, and a survivor carries the accrual back', () => {
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 9 }];
    // Seeded +4 from the shop → Deathrattle gives friends +2 base + 4 = +6 Health.
    const seeded = run(
      [{ cardId: 'sergeant', attack: 1, health: 1, sourceUid: 'S', hpGrantBonus: 4 }, { cardId: 'sandbag', attack: 0, health: 10 }],
      enemy, 3,
    );
    expect(buffHealths(seeded.events)).toContain(6);
    // No accrual → the same Deathrattle gives only the +2 base.
    const plain = run(
      [{ cardId: 'sergeant', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 0, health: 10 }],
      enemy, 3,
    );
    expect(buffHealths(plain.events)).toContain(2);
    // A surviving Sergeant carries its accrual back so the improvement is permanent across fights.
    const survives = run([{ cardId: 'sergeant', attack: 10, health: 10, sourceUid: 'S', hpGrantBonus: 4 }], [{ cardId: 'sandbag', attack: 0, health: 1 }], 3);
    expect(survives.result).toBe('win');
    expect(survives.playerHpGrantBonus).toContainEqual({ sourceUid: 'S', bonus: 4 });
  });

  it('Arcane Weaver Avenge (2) reports a Spirit Fire to grant to the hand after combat', () => {
    // Two friends die with the Weaver alive → Avenge (2) fires once → one Spirit Fire queued for the hand.
    const p: BoardMinion[] = [
      { cardId: 'weaver', attack: 0, health: 30 },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 5 }];
    const r = run(p, e, 5);
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
    // Inert enemy (sabercub: 0-Attack, no on-damage growth) so it never retaliates → no friendly dies → the
    // board stays full and the deferred copy can't reclaim a slot.
    const r = run(p, [{ cardId: 'sabercub', attack: 0, health: 1 }], 1);
    const packCopies = r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'pack').length;
    const pups = r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'pup').length;
    expect(pups).toBeGreaterThanOrEqual(1); // a Pup took the one freed slot; the rest overflowed
    expect(packCopies).toBe(0); // board stayed full → the deferred copy never reclaims a slot
  });

  it('Nanon Deathrattle: with room, all 6 Nanobots summon and no overflow buff fires', () => {
    // Nanon alone → its death leaves an empty board, so all 6 Nanobots fit (0 overflow → no buff).
    const p: BoardMinion[] = [{ cardId: 'nanon', attack: 1, health: 1 }];
    const r = run(p, [{ cardId: 'sandbag', attack: 5, health: 50 }], 1);
    expect(r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'nanobot').length).toBe(6);
    expect(r.events.filter((ev) => ev.type === 'buff' && ev.source === 'Nanon').length).toBe(0);
  });

  it('Nanon Deathrattle: on a full board the overflow Nanobots pump your Mechs (+2/+2 each)', () => {
    // Nanon (front, 1 hp) dies first; 6 tanky Mechs remain → only 1 Nanobot fits the freed slot, the other
    // 5 overflow → every Mech gets +10/+10 (5 overflow × +2/+2).
    const p: BoardMinion[] = [
      { cardId: 'nanon', attack: 1, health: 1 },
      ...Array.from({ length: 6 }, () => ({ cardId: 'drone', attack: 1, health: 50 })),
    ];
    const r = run(p, [{ cardId: 'sandbag', attack: 5, health: 300 }], 1);
    expect(r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'nanobot').length).toBe(1);
    // 5 overflow × +3/+4 = +15/+20 to each Mech (the only buffs this fight).
    const buffs = r.events.filter((ev) => ev.type === 'buff' && ev.attack === 15 && ev.health === 20);
    expect(buffs.length).toBeGreaterThan(0);
  });

  it('a golden Nanon doubles the overflow buff (+4/+4 each), summon count unchanged', () => {
    // Same full board → still 5 overflow (golden does NOT summon more), but each Mech gets +30/+40 (5 × +6/+8).
    const p: BoardMinion[] = [
      { cardId: 'nanon', attack: 1, health: 1, golden: true },
      ...Array.from({ length: 6 }, () => ({ cardId: 'drone', attack: 1, health: 50 })),
    ];
    const r = run(p, [{ cardId: 'sandbag', attack: 5, health: 300 }], 1);
    expect(r.events.filter((ev) => ev.type === 'summon' && ev.minion.cardId === 'nanobot').length).toBe(1);
    const buffs = r.events.filter((ev) => ev.type === 'buff' && ev.attack === 30 && ev.health === 40);
    expect(buffs.length).toBeGreaterThan(0); // +30/+40 confirms golden keeps 6 summons (5 overflow × +6/+8)
  });


  it('a golden Arcane Weaver grants two Spirit Fires per Avenge; an enemy Weaver grants the player none', () => {
    const golden = run(
      [
        { cardId: 'weaver', attack: 0, health: 30, golden: true },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      ],
      [{ cardId: 'sandbag', attack: 5, health: 5 }], 5,
    );
    expect(golden.playerHandGrants).toEqual(['spiritfire', 'spiritfire']);
    // An enemy Weaver's Avenge must not stuff the *player's* hand.
    const enemySide = run(
      [{ cardId: 'sandbag', attack: 5, health: 40 }],
      [
        { cardId: 'weaver', attack: 0, health: 30 },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      ], 5,
    );
    expect(enemySide.playerHandGrants).toBeUndefined();
  });

  it("Gnasher's Slaughter reports run-wide spell power to carry back (+1/+1); golden = +2/+2", () => {
    // Gnasher scores a kill on a 0/1 wall → its Slaughter records +1/+1 spell power (player-side carry-back).
    const r = run([{ cardId: 'gnash', attack: 6, health: 6 }], [{ cardId: 'sandbag', attack: 0, health: 1 }], 5);
    expect(r.playerSpellPower).toEqual({ attack: 1, health: 1 });
    // Golden doubles the gain.
    const golden = run([{ cardId: 'gnash', attack: 6, health: 6, golden: true }], [{ cardId: 'sandbag', attack: 0, health: 1 }], 5);
    expect(golden.playerSpellPower).toEqual({ attack: 2, health: 2 });
    // An enemy Gnasher scoring the kill gives the player no spell power (player-only carry-back).
    const enemySide = run([{ cardId: 'sandbag', attack: 0, health: 1 }], [{ cardId: 'gnash', attack: 6, health: 6 }], 5);
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

  it('Reborn returns at base ATTACK with 1 Health — sheds combat buffs + granted keywords, keeps the carry-through', () => {
    // An Eternal Knight (base 3/2) that entered combat buffed to a 10/3 Divine-Shield body. On death it sheds
    // the combat buff + granted DS, returning at base attack with 1 Health — then its own Deathrattle's +3/+2
    // Eternal-Knight enchant carries through, so it returns 6/3 (base 3 + 3 attack, 1 + 2 health).
    const a = run(
      [{ cardId: 'knit', attack: 10, health: 3, keywords: ['R', 'DS'] }],
      [{ cardId: 'omen', attack: 4, health: 40, keywords: [] }],
      3,
    );
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn).toBeDefined();
    if (reborn && reborn.type === 'reborn') {
      expect(reborn.attack).toBe(6); // base 3 + its own death's +3 Eternal-Knight enchant (not the buffed 10)
      expect(reborn.hp).toBe(3); // 1 (Rise base Health) + the +2 enchant
      expect(reborn.keywords).not.toContain('DS'); // granted Divine Shield is gone
      expect(reborn.keywords).not.toContain('R'); // Reborn itself is spent
    }
  });

  it('a golden Reborn minion returns at 1 Health (same as normal) + doubled base attack + doubled carry-through', () => {
    const a = run(
      [{ cardId: 'knit', attack: 20, health: 9, keywords: ['R'], golden: true }],
      [{ cardId: 'omen', attack: 4, health: 60, keywords: [] }],
      3,
    );
    // Golden: base attack 3×2 = 6 + golden enchant +6 → 12; Health 1 (Rise base — golden does NOT double it,
    // owner ruling 2026-07-02) + golden enchant +4 → 5. Auras/enchants still apply on top of the 1.
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' ? [reborn.attack, reborn.hp] : null).toEqual([12, 5]);
  });

  it('an attack exchange is simultaneous — retaliation damage lands BEFORE the dead defender\'s Deathrattle resolves', () => {
    // The reported bug: trading into a Deathrattle minion logged the attacker's retaliation damage AFTER the
    // rattle's summons (the defender's whole death cascade ran inline inside the main hit). Two-phase rule
    // (owner ruling 2026-07-02): all damage of the clash applies first, then deaths/rattles resolve.
    const p: BoardMinion[] = [
      { cardId: 'stray', attack: 3, health: 10 },
      { cardId: 'sandbag', attack: 0, health: 5 },
    ];
    const a = run(p, [{ cardId: 'pack', attack: 2, health: 2 }], 3); // Mama Pup: Deathrattle summons 2 Pups
    const strayUid = a.initial.player[0]!.uid;
    const packUid = a.initial.enemy[0]!.uid;
    const idx = (pred: (e: CombatEvent) => boolean): number => a.events.findIndex(pred);
    const retaliation = idx((e) => e.type === 'dmg' && e.target === strayUid);
    const packDeath = idx((e) => e.type === 'death' && e.target === packUid);
    const firstPup = idx((e) => e.type === 'summon' && e.minion.cardId === 'pup');
    expect(retaliation).toBeGreaterThanOrEqual(0);
    expect(retaliation).toBeLessThan(packDeath); // the counter-hit lands with the clash…
    expect(packDeath).toBeLessThan(firstPup); // …and only then does the rattle summon
  });

  it('a full board blocks the Rise — the Deathrattle resolves first, and if its summons fill the board the minion stays dead', () => {
    // Board cap rule (owner ruling 2026-07-02): Rattle procs BEFORE the Rise; the dying body holds no slot
    // during the rattle. Mama Pup (R) + 5 sandbags: she dies attacking the 20/20 wall → her 2 Pups take the
    // board to 7 living → no room → she does NOT return (a real death, exactly one death event, no reborn).
    const p: BoardMinion[] = [
      { cardId: 'pack', attack: 1, health: 1, keywords: ['R'] },
      { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'sandbag', attack: 0, health: 1 },
      { cardId: 'sandbag', attack: 0, health: 1 },
    ];
    const a = run(p, [{ cardId: 'omen', attack: 20, health: 20 }], 3);
    const packUid = a.initial.player[0]!.uid;
    expect(a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length).toBe(2); // rattle fired
    expect(a.events.some((e) => e.type === 'reborn')).toBe(false); // …but the board was full → no Rise
    expect(a.events.filter((e) => e.type === 'death' && e.target === packUid).length).toBe(1); // one real death
    // Contrast: with only 3 sandbags there's room after the Pups (4+2 = 6 living) → the Rise happens.
    const b = run(p.slice(0, 4), [{ cardId: 'omen', attack: 20, health: 20 }], 3);
    expect(b.events.some((e) => e.type === 'reborn')).toBe(true);
  });

  it('a Deathrattle-summoned token next to the dead attacker attacks next — before the minion to its right', () => {
    // Rotation rule: summons insert beside their source, and the pointer resumes after the dead attacker —
    // so Mama Pup's Pups (spawned in her slot) swing before the pre-existing right neighbour. The Taunt on
    // the neighbour pins the enemy's swings, keeping the 1/1 Pups alive for a deterministic order read.
    const p: BoardMinion[] = [
      { cardId: 'pack', attack: 1, health: 1 },
      { cardId: 'stray', attack: 3, health: 10, keywords: ['T'] },
    ];
    const a = run(p, [{ cardId: 'omen', attack: 1, health: 30 }], 3);
    const pupUids = a.events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'pup' ? [e.minion.uid] : []));
    expect(pupUids.length).toBe(2);
    const pUids = [a.initial.player[0]!.uid, a.initial.player[1]!.uid, ...pupUids];
    const playerAttackers = a.events.flatMap((e) => (e.type === 'attack' && pUids.includes(e.attacker) ? [e.attacker] : []));
    expect(playerAttackers[0]).toBe(pUids[0]); // Mama Pup (leftmost) swings first and dies
    expect(pupUids).toContain(playerAttackers[1]); // a fresh Pup — NOT the taunt stray — swings next
  });

  it('a Whelp that attacked immediately on summon still attacks in rotation when it is next in line', () => {
    // Immediate attacks are out-of-band: they do not consume the rotation slot. Twilight Whelp dies attacking →
    // its 3/3 Whelp spawns in her slot, strikes immediately, survives — and being next after the dead attacker,
    // it swings AGAIN on the side's next turn (two attacks before any other friendly acts).
    const p: BoardMinion[] = [
      { cardId: 'twilightwhelp', attack: 1, health: 1 },
      { cardId: 'sandbag', attack: 0, health: 20, keywords: ['T'] }, // Taunt soaks the enemy swings
    ];
    const a = run(p, [{ cardId: 'omen', attack: 1, health: 30 }], 3);
    const whelpUid = a.events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'whelpling' ? [e.minion.uid] : []))[0];
    expect(whelpUid).toBeDefined();
    const whelpAttacks = a.events.filter((e) => e.type === 'attack' && e.attacker === whelpUid);
    expect(whelpAttacks.length).toBeGreaterThanOrEqual(2); // the immediate strike + its own rotation turn
  });

  it('Steadfast Champion Avenge (4): summons a Spear Warden that attacks immediately', () => {
    // Four 1/1 Strays die (attacking into retaliation / eaten by the omen) while the Champion survives →
    // the 4th friendly death procs Avenge: a Spear Warden spawns and strikes OUT OF TURN ORDER — the very
    // next attack event after its summon is its own (no enemy swing squeezes between).
    const p: BoardMinion[] = [
      { cardId: 'steadfast', attack: 7, health: 7 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
    ];
    const a = run(p, [{ cardId: 'omen', attack: 1, health: 60 }], 5);
    const summonIdx = a.events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'knit');
    expect(summonIdx).toBeGreaterThan(-1); // the Warden spawned
    const ev = a.events[summonIdx]!;
    const wardenUid = ev.type === 'summon' ? ev.minion.uid : '';
    const nextAttack = a.events.slice(summonIdx + 1).find((e) => e.type === 'attack');
    expect(nextAttack && nextAttack.type === 'attack' && nextAttack.attacker).toBe(wardenUid); // immediate strike
  });

  it('GOLDEN Steadfast Champion summons a GOLDEN Spear Warden (doubled base stats), not two', () => {
    const p: BoardMinion[] = [
      { cardId: 'steadfast', attack: 14, health: 14, golden: true },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
    ];
    const a = run(p, [{ cardId: 'omen', attack: 1, health: 60 }], 5);
    const wardens = a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'knit');
    expect(wardens.length).toBe(1); // golden upgrades the summon, it does NOT double the count
    const w = wardens[0]!;
    expect(w.type === 'summon' && w.minion.attack).toBe(6); // 3/2 base → gilded 6/4
    expect(w.type === 'summon' && w.minion.health).toBe(4);
  });

  it('playerAttacksFirst (Pre-emptive Assault) overrides the more-minions initiative rule', () => {
    // 1 player minion vs 3 enemy minions: the enemy normally attacks first (more living minions). The
    // override flips it — the first attack event of the fight is the player's.
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 2, health: 30 }];
    const e: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 2 },
      { cardId: 'stray', attack: 1, health: 2 },
      { cardId: 'stray', attack: 1, health: 2 },
    ];
    const first = (attackFirst: boolean): string => {
      const r = simulate(p, e, makeRng(9), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, [], {}, attackFirst);
      const atk = r.events.find((ev) => ev.type === 'attack');
      return atk && atk.type === 'attack' ? atk.attacker : '';
    };
    const playerUid = 'm0'; // the single player minion instantiates first
    expect(first(false)).not.toBe(playerUid); // 3v1 → enemy leads by default
    expect(first(true)).toBe(playerUid); // the override puts the player first
  });

  it('a captured ENEMY Spear Warden re-gains its OWN enchant when it Rises (snapshot auras intact)', () => {
    // An enemy snapshot Warden carrying a +15/+10 Spear-Warden enchant on its buff breakdown (base 3/2 →
    // 18/12) with Rise. On death it Rises from base — applyAuras must re-fold its own enchant even for the
    // enemy side: base attack 3 + 15 = 18, Rise Health 1 + 10 = 11 (NOT bare 3/1).
    const a = run(
      [{ cardId: 'omen', attack: 30, health: 90, keywords: [] }],
      [{ cardId: 'knit', attack: 18, health: 12, keywords: ['R'], buffs: [{ source: 'Spear Warden', attack: 15, health: 10, count: 5 }] }],
      3,
    );
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' ? [reborn.attack, reborn.hp] : null).toEqual([18, 11]);
  });

  it('Reborn fires the unit\'s Deathrattle on EVERY death — Twilight Whelp + Reborn leaves a Whelp per death', () => {
    // Twilight Whelp (1/1, Deathrattle: summon a 3/3 Whelp) buffed to 2/2 and given Reborn. Its Deathrattle
    // must fire on the reborn death AND the final death → two Whelps, not one (the old bug fired only the last).
    const a = run(
      [{ cardId: 'twilightwhelp', attack: 2, health: 2, keywords: ['R'] }],
      [{ cardId: 'omen', attack: 3, health: 14, keywords: [] }],
      1,
    );
    expect(a.events.some((e) => e.type === 'reborn')).toBe(true); // reborns once, at base 1/1
    const whelps = a.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'whelpling');
    expect(whelps.length).toBe(2);
  });

  it('Rise dies THEN rattles THEN returns to the RIGHT of what it summoned', () => {
    // Owner ruling 2026-07-06: a Rise minion's death reads as a real removal FIRST. A Violet Whelp (Deathrattle:
    // summon a 3/3 Whelp) granted Rise must (1) emit its own death — flagged `rise` (shown, not counted) —
    // BEFORE the Whelp is summoned, (2) summon the Whelp, then (3) Rise, re-slotting to the RIGHT of that Whelp
    // (the `reborn` event's `after` anchors to the Whelp's uid).
    const a = run(
      [{ cardId: 'twilightwhelp', attack: 2, health: 2, keywords: ['R'] }],
      [{ cardId: 'omen', attack: 3, health: 40 }],
      1,
    );
    const whelpUid = a.initial.player[0]!.uid;
    const riseDeath = a.events.findIndex((e) => e.type === 'death' && e.target === whelpUid && e.rise === true);
    const summonIdx = a.events.findIndex((e) => e.type === 'summon' && e.minion.cardId === 'whelpling');
    const rebornIdx = a.events.findIndex((e) => e.type === 'reborn' && e.target === whelpUid);
    expect(riseDeath).toBeGreaterThanOrEqual(0); // the Whelp emits a rise-flagged death…
    expect(riseDeath).toBeLessThan(summonIdx); // …BEFORE its Deathrattle summons the 3/3 Whelp…
    expect(summonIdx).toBeLessThan(rebornIdx); // …and the Rise resolves AFTER that summon
    const tokenUid = a.events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'whelpling' ? [e.minion.uid] : []))[0];
    const reborn = a.events[rebornIdx];
    expect(reborn && reborn.type === 'reborn' && reborn.after).toBe(tokenUid); // returns to the RIGHT of the Whelp
  });

  it('Reborn carries the Eternal-Knight enchant — a fresh Reborn Knight returns at base attack + 1 Health + its own +3/+2', () => {
    // Example: a 3/2 Eternal Knight with Reborn dies, banks its own +3/+2, and reborns as a 6/3 (base 3 + 3
    // attack; 1 Rise Health + 2 enchant).
    const a = run(
      [{ cardId: 'knit', attack: 3, health: 2, keywords: ['R'] }],
      [{ cardId: 'omen', attack: 4, health: 24, keywords: [] }],
      1,
    );
    const reborn = a.events.find((e) => e.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' ? [reborn.attack, reborn.hp] : null).toEqual([6, 3]);
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

  it('Brood Matron breeds 1 Imp per friend death, capped at 3 (golden keeps the cap)', () => {
    // A tanky 0-Attack Brood survives while sacrificial bodies (and the bred Imps) die to a big attacker;
    // breeding stops at the cap. Golden does NOT raise the summon cap (it doubles the Avenge buff instead).
    const imps = (golden: boolean): number =>
      run(
        [
          { cardId: 'brood', attack: 0, health: 1000, golden },
          { cardId: 'sandbag', attack: 0, health: 1 },
          { cardId: 'sandbag', attack: 0, health: 1 },
          { cardId: 'sandbag', attack: 0, health: 1 },
        ],
        [{ cardId: 'omen', attack: 100, health: 1000, keywords: [] }],
        1,
      ).events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap').length;
    expect(imps(false)).toBe(3); // capped at 3
    expect(imps(true)).toBe(3); // golden cap stays 3
  });

  it('the run-wide Imp buff applies to combat-summoned Imps', () => {
    // impAtkBonus/impHpBonus = 2/2 → a Brood-summoned Imp enters as a 3/3 (1/1 base + 2/2).
    const r = simulate(
      [{ cardId: 'brood', attack: 0, health: 1000 }, { cardId: 'sandbag', attack: 0, health: 1 }],
      [{ cardId: 'omen', attack: 100, health: 1000, keywords: [] }],
      makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 2,
    );
    const imp = r.events.find((e) => e.type === 'summon' && e.minion.cardId === 'impscrap');
    expect(imp?.type === 'summon' ? [imp.minion.attack, imp.minion.health] : null).toEqual([3, 3]);
  });

  it('Imp King Deathrattle summons 2 Imps + a PERMANENT +2/+3 Imp buff (golden: still 2 Imps, +4/+6)', () => {
    const r = run([{ cardId: 'impking', attack: 6, health: 1 }], [{ cardId: 'omen', attack: 50, health: 400, keywords: [] }], 1);
    expect(r.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap').length).toBe(2);
    expect(r.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 3)).toBe(true);
    expect(r.playerImpBuffGain).toEqual({ attack: 2, health: 3 }); // permanent — carried back to the run
    // Golden: still 2 Imps (not 4), but the buff doubles to +4/+6.
    const g = run([{ cardId: 'impking', attack: 6, health: 1, golden: true }], [{ cardId: 'omen', attack: 50, health: 400, keywords: [] }], 1);
    expect(g.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap').length).toBe(2);
    expect(g.playerImpBuffGain).toEqual({ attack: 4, health: 6 });
  });

  it("Ryme's Deathrattle re-fires an adjacent minion's combat Battlecry (Alleycat → a Stray)", () => {
    // Ryme (the only attacker) strikes the omen, dies to retaliation → its neighbour Alleycat's Battlecry
    // re-fires in combat → a Stray is summoned. (The 0-Attack Alleycat never swings or dies itself.)
    const r = run(
      [{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'alley', attack: 0, health: 100 }],
      [{ cardId: 'omen', attack: 50, health: 400, keywords: [] }],
      1,
    );
    expect(r.events.some((e) => e.type === 'summon' && e.minion.cardId === 'stray')).toBe(true);
  });

  it('a golden Ryme re-fires BOTH adjacent Battlecries', () => {
    const r = run(
      [
        { cardId: 'alley', attack: 0, health: 100 },
        { cardId: 'ryme', attack: 5, health: 1, golden: true },
        { cardId: 'alley', attack: 0, health: 100 },
      ],
      [{ cardId: 'omen', attack: 50, health: 400, keywords: [] }],
      1,
    );
    expect(r.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'stray').length).toBe(2);
  });

  it("Ryme's Deathrattle fires battlecryTriggered → Karwind buffs the Dragons (+1/+2), with an sc narration", () => {
    const r = run(
      [
        { cardId: 'ryme', attack: 5, health: 1 },
        { cardId: 'alley', attack: 0, health: 100 }, // neighbour with a Battlecry
        { cardId: 'karwind', attack: 4, health: 100 },
        { cardId: 'cleric', attack: 3, health: 100 },
      ],
      [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }],
      1,
    );
    expect(r.events.filter((e) => e.type === 'sc' && /triggers/.test(e.text)).length).toBe(1); // 1 trigger narrated
    expect(r.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 2)).toBe(true); // Karwind procced (+2/+2)
  });

  it('a golden Ryme + Drakko triggers both neighbours twice each (4 triggers → Karwind 4×)', () => {
    const r = run(
      [
        { cardId: 'alley', attack: 0, health: 100 },
        { cardId: 'ryme', attack: 5, health: 1, golden: true },
        { cardId: 'alley', attack: 0, health: 100 },
        { cardId: 'drummer', attack: 2, health: 100 }, // Drakko: doubles each trigger
        { cardId: 'karwind', attack: 4, health: 100 },
        { cardId: 'cleric', attack: 3, health: 100 },
      ],
      [{ cardId: 'omen', attack: 50, health: 4000, keywords: [] }],
      1,
    );
    // 2 neighbours × 2 (Drakko) = 4 triggers — one sc narration each.
    expect(r.events.filter((e) => e.type === 'sc' && /triggers/.test(e.text)).length).toBe(4);
    // Karwind procs once per trigger → +2/+2 to both Dragons (Karwind + Hoard Cleric), 4× = 8 buff events.
    expect(r.events.filter((e) => e.type === 'buff' && e.attack === 2 && e.health === 2).length).toBe(8);
  });

  it("Bane reacting to Ryme's battlecry trigger carries the Fodder enchant back to the run", () => {
    const board = (baneGolden: boolean) => [
      { cardId: 'ryme', attack: 5, health: 1 },        // dies → triggers the neighbour's Battlecry
      { cardId: 'alley', attack: 0, health: 100 },     // battlecry neighbour (Alleycat)
      { cardId: 'bane', attack: 12, health: 100, golden: baneGolden }, // reacts to battlecryTriggered
      { cardId: 'fred', attack: 1, health: 100 },      // a living Fodder body (also buffed this combat)
    ];
    const omen = [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }];
    // One trigger → Bane fires once → the run-wide Fodder enchant carries back (like the Imp buff does).
    expect(run(board(false), omen, 1).playerFodderBuffGain).toEqual({ attack: 2, health: 2 });
    expect(run(board(true), omen, 1).playerFodderBuffGain).toEqual({ attack: 4, health: 4 }); // golden Bane doubles
  });

  it('Ryme re-firing a Discover Battlecry grants the ACTUAL card — a toHand event + a playerHandGrant', () => {
    const omen = [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }];
    const toHandIds = (r: ReturnType<typeof run>) =>
      r.events.flatMap((e) => (e.type === 'toHand' ? [e.cardId] : []));
    // Sea Urchin = Discover-MINION (tribe beast). Re-fired in combat it picks a real beast NOW (≤ tier, active
    // tribes), emits a toHand event so it animates in, and carries the cardId back via playerHandGrants.
    const urchin = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'seaurchin', attack: 0, health: 100 }], omen, 1);
    expect(toHandIds(urchin)).toHaveLength(1);
    const pickedId = toHandIds(urchin)[0]!;
    const def = CARD_INDEX[pickedId]!;
    expect(def.tribe === 'beast' || def.tribe2 === 'beast' || def.universalTribe).toBe(true); // a beast
    expect(pickedId).not.toBe('seaurchin'); // source excluded
    expect(urchin.playerHandGrants).toContain(pickedId);
    const goldUrchin = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'seaurchin', attack: 0, health: 100, golden: true }], omen, 1);
    expect(toHandIds(goldUrchin)).toHaveLength(2); // golden Discovers twice
    // Black Belt Brian = Discover-SPELL → picks a real spell, same toHand + handGrant path.
    const brian = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'blackbelt', attack: 0, health: 100 }], omen, 1);
    expect(toHandIds(brian)).toHaveLength(1);
    expect(CARD_INDEX[toHandIds(brian)[0]!]?.spell).toBe(true); // a spell
  });

  it('Ryme re-firing Cinderwing Matron in combat grants the run-wide spell power', () => {
    const omen = [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }];
    // Cinderwing's Battlecry permanently raises spell power (+0/+1); re-fired in combat it now carries back.
    const r = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'cinder', attack: 0, health: 100 }], omen, 1);
    expect(r.playerSpellPower).toEqual({ attack: 0, health: 1 });
    const gold = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'cinder', attack: 0, health: 100, golden: true }], omen, 1);
    expect(gold.playerSpellPower).toEqual({ attack: 0, health: 2 }); // golden Cinderwing doubles
  });

  it("Ryme re-firing an ECONOMY Battlecry records it for settle (Soulfeeder, Hoarder) — not the combat ones", () => {
    const omen = [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }];
    // Soulfeeder = addTavernFodder (economy) — can't touch the tavern in pure combat, so it's recorded on
    // playerDeferredBattlecries for the run loop to replay at settle (and the golden state rides along).
    const feed = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'feed', attack: 0, health: 100 }], omen, 1);
    expect(feed.playerDeferredBattlecries).toEqual([{ cardId: 'feed', golden: false }]);
    const goldFeed = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'feed', attack: 0, health: 100, golden: true }], omen, 1);
    expect(goldFeed.playerDeferredBattlecries).toEqual([{ cardId: 'feed', golden: true }]);
    // Hoarder = battlecryBonusGoldNextTurn (economy) → also deferred.
    const hoard = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'hoarder', attack: 0, health: 100 }], omen, 1);
    expect(hoard.playerDeferredBattlecries).toEqual([{ cardId: 'hoarder', golden: false }]);
    // A combat-meaningful Battlecry (Sea Urchin's Discover) resolves IN the fight — never deferred.
    const urchin = run([{ cardId: 'ryme', attack: 5, health: 1 }, { cardId: 'seaurchin', attack: 0, health: 100 }], omen, 1);
    expect(urchin.playerDeferredBattlecries).toBeUndefined();
  });

  it('a combat-generated card is shown mid-fight as a toHand event', () => {
    const omen = [{ cardId: 'omen', attack: 50, health: 2000, keywords: [] }];
    const r = run([
      { cardId: 'sporebat', attack: 2, health: 1 },   // Deathrattle → generates a real spell → a toHand event
    ], omen, 1);
    const grant = r.events.find((e) => e.type === 'toHand');
    expect(grant).toBeDefined();
    expect(CARD_INDEX[(grant as { cardId: string }).cardId]?.spell).toBe(true); // the actual spell that was generated
  });

  it("a mid-combat spell-power telegraph is a narration sc (no `cast`) — the UI won't replay it as a SoC attack", () => {
    // Gnasher's Slaughter grants +1/+1 spell power, telegraphed mid-fight as a "Spell Power" sc.
    // It carries NO `cast` flag (only genuine Start-of-Combat damage casts do), so the UI fires no projectile
    // bolt / zap — fixing "Ryme procs Cinderwing → phantom Ember Whelp attack" (spell power shares this channel).
    const r = run([{ cardId: 'gnash', attack: 6, health: 6 }], [{ cardId: 'sandbag', attack: 0, health: 1 }], 1);
    const sp = r.events.find((e) => e.type === 'sc' && /Spell Power/.test(e.text));
    expect(sp).toBeDefined();
    expect(sp?.type === 'sc' ? sp.cast : 'missing').toBeUndefined(); // narration, not a cast
  });

  it("Taragosa's Growth scales with the run's spell power", () => {
    const board: BoardMinion[] = [
      { cardId: 'taragosa', attack: 5, health: 100 },
      { cardId: 'sandbag', attack: 0, health: 100 },
    ];
    const enemy: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 4000, keywords: [] }];
    // simulate(...15 args..., spellPowerAtk, spellPowerHp). With +4/+4 spell power each Growth is +7/+8.
    const r = simulate(board, enemy, makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4);
    expect(r.events.some((e) => e.type === 'buff' && e.attack === 7 && e.health === 8)).toBe(true);
    const r0 = simulate(board, enemy, makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(r0.events.some((e) => e.type === 'buff' && e.attack === 3 && e.health === 4)).toBe(true); // no spell power → base
  });

  it('Mama Bear emits an `improve` event per Beast summoned in combat (drives the live per-summon text)', () => {
    // Mama Pup dies → Deathrattle summons 2 Pups (Beasts); Mama Bear buffs each AND emits an `improve` so the
    // UI's live "+M/+M per summon" card text climbs mid-fight (that field only moves on improve events).
    const p: BoardMinion[] = [
      { cardId: 'mamabear', attack: 6, health: 30 },
      { cardId: 'pack', attack: 2, health: 1 }, // Mama Pup — dies → summons 2 Pups
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 5, health: 40 }];
    const a = run(p, e, 1);
    const mb = a.initial.player.find((m) => m.cardId === 'mamabear')!.uid;
    const improves = a.events.filter((ev) => ev.type === 'improve' && ev.target === mb);
    expect(improves.length).toBe(2); // one per Pup summoned
    expect(improves.every((ev) => ev.type === 'improve' && ev.amount === 2)).toBe(true); // pre-golden step = base (2)
  });

  it('Tara ascends to Taragosa MID-combat once her stat-grants cross the threshold, and Taragosa then casts Growth', () => {
    const p: BoardMinion[] = [
      { cardId: 'tara', attack: 3, health: 40, keywords: ['EG'], ascendProgress: 19 }, // 1 more grant → ascend
      { cardId: 'cryptdrake', attack: 4, health: 40 }, // buffs all on each ally attack → grants Tara a stat
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 1, health: 400 }];
    const a = run(p, e, 1);
    const ascend = a.events.find((ev) => ev.type === 'ascend');
    expect(ascend && ascend.type === 'ascend' ? ascend.into : null).toBe('taragosa'); // transformed mid-fight
    // The new form's effect is live the rest of the combat: Taragosa casts Growth (+3/+4 to all) on a later attack.
    const ai = a.events.findIndex((ev) => ev.type === 'ascend');
    expect(a.events.slice(ai + 1).some((ev) => ev.type === 'buff' && ev.attack === 3 && ev.health === 4)).toBe(true);
  });

  it("Gnasher's kill raises spell power LIVE — Taragosa's Growth jumps from 3/4 to 4/5 the same fight", () => {
    const p: BoardMinion[] = [
      { cardId: 'gnash', attack: 20, health: 40 },
      { cardId: 'taragosa', attack: 3, health: 40, keywords: ['EG'] },
      { cardId: 'karthus', attack: 1, health: 40 }, // 3rd minion → player attacks first
    ];
    const e: BoardMinion[] = [
      { cardId: 'pup', attack: 1, health: 1, keywords: ['T'] }, // Taunt → Gnasher kills it → +1/+1 spell power
      { cardId: 'omen', attack: 1, health: 400 },
    ];
    const a = run(p, e, 1); // spell power starts at 0
    const growth = a.events.filter((ev) => ev.type === 'buff' && ev.attack >= 3).map((ev) => (ev.type === 'buff' ? `${ev.attack}/${ev.health}` : ''));
    expect(growth).toContain('3/4'); // Growth before the kill (spell power 0)
    expect(growth).toContain('4/5'); // after Gnasher's kill bumped spell power +1/+1 — read LIVE, same fight
  });

  it("Forsaken Weaver procs PERMANENTLY from an in-combat spell (Taragosa's Growth) — undeadBuyAtk carries back", () => {
    const p: BoardMinion[] = [
      { cardId: 'taragosa', attack: 6, health: 20, keywords: ['EG'] },
      { cardId: 'forsakenweaver', attack: 5, health: 20 },
      { cardId: 'karthus', attack: 4, health: 20 }, // an Undead to receive the bonus
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 2, health: 80 }];
    const a = run(p, e, 3);
    expect(a.playerUndeadBuyAtkGain).toBeGreaterThan(0); // each Growth = a spell cast → Forsaken Weaver banks +2 permanently
  });

  it('Ryme re-firing Deathswarmer in combat carries the Undead-attack AURA back permanently (owner ruling 2026-07-03)', () => {
    // Deathswarmer's Battlecry is an aura ("your Undead +Attack wherever they are"), so a Ryme re-fire in
    // combat must persist it — not just buff this fight. Ryme (adjacent to Deathswarmer) dies, its Deathrattle
    // re-fires Deathswarmer's Battlecry → +1 Undead attack must land in playerUndeadBuyAtkGain (was: dropped).
    const p: BoardMinion[] = [
      { cardId: 'deathswarmer', attack: 1, health: 40 }, // survives; its aura re-fires
      { cardId: 'ryme', attack: 1, health: 1 }, // adjacent — dies fast, re-fires the neighbour's Battlecry
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 3, health: 200 }]; // out-trades Ryme
    const a = run(p, e, 3);
    expect(a.playerUndeadBuyAtkGain).toBe(1); // Deathswarmer's +1, carried back (non-golden)
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
      // Golden doubles the amount: Sporeling's rattle gives all friends +1/+1 → golden +2/+2.
      expect(buff.attack).toBe(2);
      expect(buff.health).toBe(2);
    }
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

  it('Manasaber Deathrattle summons two 0/2 Saber Cubs; golden keeps the count and GILDS them (0/4)', () => {
    const cubEvents = (golden: boolean) =>
      run(
        [{ cardId: 'manasaber', attack: 4, health: 1, golden }],
        [{ cardId: 'omen', attack: 5, health: 30 }],
        3,
      ).events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'sabercub' ? [e.minion] : []));
    const base = cubEvents(false);
    expect(base.length).toBe(2); // two cubs either way — golden upgrades the BODY, not the count
    expect(base.map((m) => [m.attack, m.health, m.golden ?? false])).toEqual([[0, 2, false], [0, 2, false]]);
    const gilded = cubEvents(true);
    expect(gilded.length).toBe(2);
    expect(gilded.map((m) => [m.attack, m.health, m.golden])).toEqual([[0, 4, true], [0, 4, true]]);
  });

  it('Mumi Deathrattle grants a friendly Undead Rise — the keyword event fires and the Rise later procs', () => {
    // Mumi (5/1, leftmost) attacks the wall and dies to retaliation → its rattle hands the Eternal Knight
    // Rise (a `keyword` event, so the replay shows the pill). When the Knight later dies, the Rise procs.
    const a = run(
      [
        { cardId: 'mumi', attack: 5, health: 1 },
        { cardId: 'knit', attack: 3, health: 2 },
      ],
      [{ cardId: 'omen', attack: 10, health: 40 }],
      3,
    );
    const mumiUid = a.initial.player[0]!.uid;
    const knitUid = a.initial.player[1]!.uid;
    expect(a.events.some((e) => e.type === 'keyword' && e.keyword === 'R' && e.target === knitUid && e.source === mumiUid)).toBe(true);
    expect(a.events.some((e) => e.type === 'reborn' && e.target === knitUid)).toBe(true);
  });

  it('Flowing Monk Engraves TWO friends per overflow, at the improved magnitude once past the every-5 step', () => {
    // Monk seeded at 5 prior overflows (summonBonus 5 → step 1 → 4/4) plus a flat +10 from a triple combine
    // (overflowBonus) → 14/14 grants. Full board; the golden Mama Pup dies → 4 Pups; one fits the freed
    // slot, three overflow → 3 procs × 2 recipients, all +14/+14.
    const cubs: BoardMinion[] = Array.from({ length: 5 }, (): BoardMinion => ({ cardId: 'sabercub', attack: 0, health: 30, keywords: ['T'] }));
    const a = run(
      [
        { cardId: 'monk', attack: 4, health: 30, summonBonus: 5, overflowBonus: 10 },
        { cardId: 'pack', attack: 1, health: 1, golden: true },
        ...cubs,
      ],
      [{ cardId: 'omen', attack: 20, health: 60 }],
      3,
    );
    const monkUid = a.initial.player[0]!.uid;
    const monkBuffs = a.events.filter((e) => e.type === 'buff' && e.source === monkUid);
    expect(monkBuffs.length).toBe(6); // 3 overflows × 2 Engraved friends
    expect(monkBuffs.every((b) => b.type === 'buff' && b.attack === 14 && b.health === 14)).toBe(true);
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

  it('Crypt Drake buffs your whole board a flat +2/+2 every 2 ally attacks (no improvement)', () => {
    const a = run(
      [
        { cardId: 'cryptdrake', attack: 4, health: 80 },
        { cardId: 'sandbag', attack: 1, health: 80, keywords: [] }, // a second attacker → more ally attacks
      ],
      [{ cardId: 'omen', attack: 0, health: 200 }], // 0-atk wall → the fight runs long
      3,
    );
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 2)).toBe(true); // fires every 2nd attack
    expect(a.events.some((e) => e.type === 'buff' && e.attack === 4 && e.health === 4)).toBe(false); // flat — never improves
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

  it('Sporebat Deathrattle generates a real tavern-tier spell (toHand + handGrant); golden generates two', () => {
    const spellGrants = (golden: boolean): string[] => {
      const r = run([{ cardId: 'sporebat', attack: 2, health: 1, golden }], [{ cardId: 'omen', attack: 5, health: 5 }], 3);
      const ids = r.events.flatMap((e) => (e.type === 'toHand' ? [e.cardId] : []));
      expect(ids.every((id) => CARD_INDEX[id]?.spell)).toBe(true); // each is an actual spell
      expect(r.playerHandGrants ?? []).toEqual(ids); // carried back to add at settle
      return ids;
    };
    expect(spellGrants(false)).toHaveLength(1);
    expect(spellGrants(true)).toHaveLength(2);
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
    // 7 living (0-Attack Monk + Imp King + 5 walls). Imp King (the only attacker) strikes the big omen and
    // dies to retaliation → its Deathrattle summons 2 Imps: the first fits (back to 7), the second overflows
    // → Monk procs +2/+2. (The walls + Monk have 0 Attack, so only Imp King ever swings or dies.)
    const wall = (): BoardMinion => ({ cardId: 'sandbag', attack: 0, health: 100 });
    const p: BoardMinion[] = [
      { cardId: 'monk', attack: 0, health: 200 },
      { cardId: 'impking', attack: 6, health: 1 },
      wall(), wall(), wall(), wall(), wall(),
    ];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 50, health: 400 }];
    const a = run(p, e, 5);
    expect(a.events.some((ev) => ev.type === 'buff' && ev.attack === 2 && ev.health === 2)).toBe(true);
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
      [
        { cardId: 'weaver', attack: 0, health: 30 },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
        { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      ],
      [{ cardId: 'omen', attack: 5, health: 20 }],
      1,
    );
    const grant = a.events.find((ev) => ev.type === 'toHand');
    expect(grant && grant.type === 'toHand' && grant.cardId === 'spiritfire').toBe(true);
    expect(grant && grant.type === 'toHand' && !!grant.source).toBe(true); // attributed to Arcane Weaver (for the Procs tab)
    expect(a.playerHandGrants).toContain('spiritfire'); // still recorded for the post-combat hand add
  });

  it('counts enemy-side deaths in enemyDeaths (Cassen Collision) — player losses excluded', () => {
    // Gnasher (6/6) clears two 1/1 enemies over its turns; the player loses nothing (sandbag Taunt absorbs).
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

  it('golden doubles Deathrattle summon + grant counts (Pack Scrounger 2→4 Pups, Arcane Weaver 1→2 Spirit Fires per Avenge)', () => {
    const killer: BoardMinion[] = [{ cardId: 'pack', attack: 12, health: 30 }]; // lethal enough to drop the carrier
    const pups = (b: BoardMinion[]): number =>
      run(b, killer, 5).events.filter((e) => e.type === 'summon' && e.minion.cardId === 'pup').length;
    expect(pups([{ cardId: 'pack', attack: 4, health: 4, golden: true }])).toBe(4);
    expect(pups([{ cardId: 'pack', attack: 2, health: 2 }])).toBe(2);
    // Weaver's grant is Avenge (2) now: two 1-HP taunts die → one proc → 1 Spirit Fire (golden 2).
    const grants = (weaver: BoardMinion): number =>
      (run(
        [weaver, { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] }, { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] }],
        killer, 5,
      ).playerHandGrants ?? []).filter((c) => c === 'spiritfire').length;
    expect(grants({ cardId: 'weaver', attack: 0, health: 60, golden: true })).toBe(2);
    expect(grants({ cardId: 'weaver', attack: 0, health: 60 })).toBe(1);
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
    // overflow, so the Monk Engraves two friends +2/+2 each time — recorded for carry-back to the run
    // board (only real minions, which carry a sourceUid; summoned Pup tokens are gone after combat).
    const filler: BoardMinion[] = Array.from({ length: 5 }, (_, i) => ({ cardId: 'sabercub', attack: 1, health: 20, keywords: [], sourceUid: `f${i}` }));
    const player: BoardMinion[] = [
      { cardId: 'monk', attack: 1, health: 20, sourceUid: 'monk' },
      { cardId: 'pack', attack: 8, health: 8, golden: true, sourceUid: 'pack' },
      ...filler,
    ];
    const r = run(player, [{ cardId: 'sandbag', attack: 8, health: 80 }], 3);
    expect(r.playerPermaBuffs).toBeDefined();
    expect(r.playerPermaBuffs!.length).toBeGreaterThan(0);
    for (const b of r.playerPermaBuffs!) {
      expect(b.attack % 2).toBe(0); // each gift is +2/+2 (or a multiple if a minion was picked twice)
      expect(b.health % 2).toBe(0);
    }
  });

  it('Taurus engraves an adjacent minion — that minion keeps its combat gains (carry-back)', () => {
    // A Sporeling dies and buffs every friend +1 of one stat (combat-only). The target wall has its keywords
    // stripped, so its +1 would NOT normally carry back; Taurus sits to its right and engraves it at Start of
    // Combat → the +1 is recorded as a permaGain (engraved: true), carried back even though it later dies.
    const a = run(
      [
        { cardId: 'sabercub', attack: 0, health: 30, keywords: [], sourceUid: 'G' }, // engraved target (Taurus's left) — inert wall
        { cardId: 'taurus', attack: 6, health: 30, sourceUid: 'T' },
        { cardId: 'spore', attack: 1, health: 1, sourceUid: 'S' }, // dies → buffs all friends +1/+1
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    const perma = a.playerPermaBuffs?.find((p) => p.sourceUid === 'G');
    expect(perma).toBeDefined();
    expect(perma!.attack + perma!.health).toBe(2); // Sporeling's +1/+1 carried back...
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
        { cardId: 'sabercub', attack: 0, health: 30, keywords: [], sourceUid: 'G' }, // NOT adjacent to Taurus — inert wall
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
        { cardId: 'sabercub', attack: 0, health: 30, keywords: [], sourceUid: 'L' }, // left neighbor — inert wall
        { cardId: 'taurus', attack: 6, health: 40, golden: true, sourceUid: 'T' },
        { cardId: 'sabercub', attack: 0, health: 30, keywords: [], sourceUid: 'R' }, // right neighbor — inert wall
        { cardId: 'spore', attack: 1, health: 2, sourceUid: 'S' }, // dies → buffs all friends +1/+1
        { cardId: 'sabercub', attack: 0, health: 30, keywords: [], sourceUid: 'X' }, // NON-adjacent friend (guard)
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    const left = a.playerPermaBuffs?.find((p) => p.sourceUid === 'L');
    const right = a.playerPermaBuffs?.find((p) => p.sourceUid === 'R');
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    // Golden Taurus DOUBLES its neighbors' combat gains, so the Sporeling's +1/+1 carries back as +2/+2.
    expect(left!.attack + left!.health).toBe(4);
    expect(right!.attack + right!.health).toBe(4);
    expect(left!.engraved && right!.engraved).toBe(true); // ...labelled Engraved
    expect(a.playerPermaBuffs?.find((p) => p.sourceUid === 'X')).toBeUndefined(); // non-neighbor: gain dropped
  });

  it('native Engraved keeps a minion combat gain (carry-back, no Taurus)', () => {
    // Regression guard for the carry-back refactor: a wall with the native EG keyword keeps whatever it
    // gains — a Sporeling dies and buffs all friends +1/+1; the EG wall's +1 carries back with
    // engraved: true, no Taurus involved.
    const a = run(
      [
        { cardId: 'sabercub', attack: 0, health: 30, keywords: ['EG'], sourceUid: 'G' }, // inert wall with native EG
        { cardId: 'spore', attack: 1, health: 1, sourceUid: 'S' },
      ],
      [{ cardId: 'omen', attack: 3, health: 200 }],
      3,
    );
    const perma = a.playerPermaBuffs?.find((p) => p.sourceUid === 'G');
    expect(perma).toBeDefined();
    expect(perma!.attack + perma!.health).toBe(2); // Sporeling's +1/+1
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

  it('Lantern of Souls AND the Eternal-Knight enchant both re-apply to a player Undead that Reborns mid-combat', () => {
    // Eternal Knight (Undead, Reborn, 3/2 base) enters at 3+3 = 6 Attack (Lantern), dies to retaliation, and
    // Reborns at base — where BOTH Undead carry-through buffs re-apply: the Lantern (+3 Attack) AND its own
    // death's Eternal-Knight enchant (+3/+2). So the reborn body is 3 + 3 + 3 = 9 Attack (not the base 3).
    const p: BoardMinion[] = [{ cardId: 'knit', attack: 2, health: 2, keywords: ['R'] }]; // R granted inline (knit is no longer Reborn by default)
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 5, health: 80 }]; // out-trades the Knit → forces the Reborn
    const a = simulate(p, e, makeRng(3), CARD_INDEX, 0, 0, 1, 3);
    const reborn = a.events.find((ev) => ev.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' && reborn.attack).toBe(9); // base 3 + Lantern 3 + Eternal-Knight 3
  });

  it('a Footman summoned mid-combat inherits the run-wide Undead aura (Lantern + the baked buy-time bonus)', () => {
    // Footman Captain (Undead) dies → summons a Footman (1/1 Undead token). A summon starts from BASE, so it
    // takes the FULL aura: Lantern (+5/+3) AND the baked buy-time Undead attack (+4, re-added only for a
    // from-base body — a bought Undead already has it in its stats). → 1 + 5 + 4 = 10 attack, 1 + 3 = 4 health.
    const p: BoardMinion[] = [{ cardId: 'deathlesshand', attack: 0, health: 1, sourceUid: 'u' }]; // 0-atk so it can't win — it dies, summoning the Footman
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 10, health: 40 }];
    const a = simulate(p, e, makeRng(3), CARD_INDEX, 0, 0, 1, 5, 3, 0, 4); // undeadAttackBonus 5, undeadHealthBonus 3, undeadBuyAtk 4
    const summon = a.events.find((ev) => ev.type === 'summon' && ev.minion.cardId === 'footman');
    expect(summon && summon.type === 'summon' ? [summon.minion.attack, summon.minion.health] : null).toEqual([10, 4]);
  });

  it('Spear Warden Reborn keeps its accrued stacks: a 5-stack Warden dies (→6) and Reborns at 6 stacks', () => {
    // A Warden that entered with 5 prior stacks of its run-wide enchant (+3/+2 each = +15/+10, carried into
    // combat on its buff breakdown under the card's own name) at base 3/2 → 18/12. It dies, banking a 6th
    // stack this fight, and Reborns at base attack 3 + 6 stacks and 1 Health + the enchant health = 21/13.
    const p: BoardMinion[] = [{
      cardId: 'knit', attack: 18, health: 12, keywords: ['R'],
      buffs: [{ source: 'Spear Warden', attack: 15, health: 10, count: 5 }],
    }];
    const e: BoardMinion[] = [{ cardId: 'omen', attack: 20, health: 200 }]; // out-trades the Warden → forces the Reborn
    const a = simulate(p, e, makeRng(3), CARD_INDEX, 0, 0, 1);
    const reborn = a.events.find((ev) => ev.type === 'reborn');
    expect(reborn && reborn.type === 'reborn' && reborn.attack).toBe(21); // base 3 + (15 prior + 3 this fight)
    expect(reborn && reborn.type === 'reborn' && reborn.hp).toBe(13); // 1 (Rise) + (10 prior + 2 this fight)
  });

  it('Soren resummon re-applies run-wide auras (regression: a resummoned body used to shed the Undead Aura)', () => {
    // A marked minion is destroyed at Start of Combat and resummoned later. It used to come back with NO
    // run-wide auras re-applied (flushResummons skipped them) — so a resummoned Undead lost its Lantern aura.
    // Compare the resummoned Eternal Knight's Attack with the aura off vs on: the delta must be the +Attack.
    const mk = (): BoardMinion[] => [
      { cardId: 'knit', attack: 3, health: 2, resummon: true },
      { cardId: 'sandbag', attack: 0, health: 50 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 50 }];
    const resummonAtk = (undeadAtk: number): number => {
      const a = simulate(mk(), e, makeRng(5), CARD_INDEX, 0, 0, 1, undeadAtk, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ALL_TRIBES);
      const ev = a.events.filter((x) => x.type === 'summon' && x.minion.cardId === 'knit').pop();
      return ev && ev.type === 'summon' ? ev.minion.attack : -1;
    };
    // The resummoned Knight returns with the live Undead Aura (captured at Start of Combat) — the delta from
    // turning the aura on must be exactly its +Attack, not doubled and not dropped.
    expect(resummonAtk(4) - resummonAtk(0)).toBe(4);
  });

  it('a combat-summoned token inherits its run-wide per-card enchant (the Fodder Aura mechanism)', () => {
    // Per-card run enchants (the channel Ritualist uses for Fodder, and Eternal Knight for its type) now
    // re-apply to bodies summoned mid-combat. Mama Pup summons 1/1 Pups; a +2/+3 enchant on the Pup type
    // means the summoned Pups arrive at 3/4.
    const p: BoardMinion[] = [{ cardId: 'pack', attack: 1, health: 1 }]; // dies → Deathrattle summons Pups
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 50 }];
    const a = simulate(p, e, makeRng(3), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ALL_TRIBES, { pup: { attack: 2, health: 3 } });
    const pup = a.events.find((ev) => ev.type === 'summon' && ev.minion.cardId === 'pup');
    expect(pup && pup.type === 'summon' && pup.minion.attack).toBe(3); // base 1 + 2
    expect(pup && pup.type === 'summon' && pup.minion.health).toBe(4); // base 1 + 3
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

  it('a 0-damage retaliation is a non-event: no Divine Shield pop, no dmg-0 beats', () => {
    // A shielded attacker trades into a 0-Attack inert wall (Manasaber's cubs made these common). The
    // 0-damage counter must NOT spend the shield, and the log must carry no `dmg` event with amount 0.
    // (sabercub keywords:[] = truly inert — Target Dummy would gain Attack when hit and start retaliating.)
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 5, keywords: ['DS'] }];
    const e: BoardMinion[] = [{ cardId: 'sabercub', attack: 0, health: 12, keywords: [] }];
    const r = run(p, e, 5);
    expect(r.result).toBe('win');
    expect(r.events.some((ev) => ev.type === 'shield')).toBe(false); // shield never popped
    expect(r.events.some((ev) => ev.type === 'dmg' && ev.amount === 0)).toBe(false); // no junk beats
  });

  it("enemy Start-of-Combat effects fire — after the player's full pass (owner ruling 2026-07-03)", () => {
    // A Taurus on EACH side: both engrave their line, and the player's `sc` narration lands first.
    const p: BoardMinion[] = [
      { cardId: 'taurus', attack: 6, health: 8 },
      { cardId: 'sabercub', attack: 0, health: 30, keywords: [] },
    ];
    const e: BoardMinion[] = [
      { cardId: 'taurus', attack: 6, health: 8 },
      { cardId: 'sabercub', attack: 0, health: 30, keywords: [] },
    ];
    const r = run(p, e, 3);
    const engraves = r.events.filter((ev) => ev.type === 'sc' && ev.text.includes('engraves'));
    expect(engraves.length).toBe(2); // both sides' Taurus fired
    const playerUids = new Set(r.initial.player.map((m) => m.uid));
    expect(engraves[0]!.type === 'sc' && playerUids.has(engraves[0]!.source)).toBe(true); // player first
    expect(engraves[1]!.type === 'sc' && playerUids.has(engraves[1]!.source)).toBe(false); // then enemy
  });

  it("an enemy Abhorrent Horror's SC is a no-op — it must not absorb the PLAYER's consumed-Fodder tally", () => {
    // fodderConsumedAtk/Hp on the context are the player's run state; a captured enemy snapshot has none.
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 20 }];
    const e: BoardMinion[] = [{ cardId: 'abhorrenthorror', attack: 1, health: 1 }];
    const r = simulate(p, e, makeRng(7), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 5, 5); // 12th/13th args = consumed Fodder 5/5
    const horrorUid = r.initial.enemy[0]!.uid;
    expect(r.events.some((ev) => ev.type === 'buff' && ev.target === horrorUid)).toBe(false);
    // Control: the PLAYER's Horror still absorbs the tally.
    const r2 = simulate(e, p, makeRng(7), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 5, 5);
    const pHorrorUid = r2.initial.player[0]!.uid;
    expect(r2.events.some((ev) => ev.type === 'buff' && ev.target === pHorrorUid && ev.attack === 5 && ev.health === 5)).toBe(true);
  });

  it('a retaliation kill procs on-kill (owner ruling 2026-07-03): defending Karthus counts its fellers', () => {
    // Enemy attacks first (more minions). Both 2/1s die to Karthus's 7-Attack retaliation or his swing —
    // every kill in a clash procs onKill now, so BOTH kills bank +3 Undead Attack (was: only his own attack).
    const p: BoardMinion[] = [{ cardId: 'karthus', attack: 7, health: 20 }];
    const e: BoardMinion[] = [
      { cardId: 'sandbag', attack: 2, health: 1 },
      { cardId: 'sandbag', attack: 2, health: 1 },
    ];
    const r = run(p, e, 5);
    expect(r.result).toBe('win');
    // Kill 1: the first attacker fell to retaliation (NEW). Kill 2: Karthus's own swing (as before). 2 × +3.
    expect(r.playerUndeadBuyAtkGain).toBe(6);
  });

  it('cleave-splash kills proc on-kill per victim (owner ruling 2026-07-03)', () => {
    // Karthus granted Cleave one-shots a taunted 1/1 line: three bodies fall in one clash → three procs.
    const p: BoardMinion[] = [
      { cardId: 'karthus', attack: 7, health: 30, keywords: ['C'] },
      { cardId: 'sandbag', attack: 0, health: 30 },
      { cardId: 'sandbag', attack: 0, health: 30 },
      { cardId: 'sandbag', attack: 0, health: 30 },
    ];
    const e: BoardMinion[] = [
      { cardId: 'sabercub', attack: 1, health: 1, keywords: [] }, // Taunt stripped — the middle is forced
      { cardId: 'sabercub', attack: 1, health: 1, keywords: ['T'] },
      { cardId: 'sabercub', attack: 1, health: 1, keywords: [] },
    ];
    const r = run(p, e, 5);
    expect(r.result).toBe('win');
    expect(r.playerUndeadBuyAtkGain).toBe(9); // 3 kills × +3 (was 3: main target only)
  });

  it("Deathsayer's Rally-proc'd Deathrattles tick the tally (parity with Sporeling's Battlecry proc)", () => {
    // No player minion ever dies here — every playerDeathrattles tick comes from the Rally procs, one per
    // `rally` event (a rattle triggered without a death still counts, same rule as Sporeling).
    const p: BoardMinion[] = [
      { cardId: 'deathsayer', attack: 3, health: 5 },
      { cardId: 'sergeant', attack: 1, health: 30 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sabercub', attack: 0, health: 9, keywords: [] }]; // inert wall (never retaliates into a kill)
    const r = run(p, e, 5);
    const rallies = r.events.filter((ev) => ev.type === 'rally').length;
    expect(rallies).toBeGreaterThan(0);
    expect(r.playerDeathrattles).toBe(rallies);
  });

  it("The Reclaimer's copy keeps its carry-back identity: a reclaimed Kennelmaster still persists its Avenge", () => {
    // Same shape as the Kennelmaster carry-back test above, but the Kennelmaster is MARKED — destroyed at
    // Start of Combat and resummoned as a copy. The copy's Avenge improvements must still reach the run
    // card via sourceUid (the copy used to drop it, silently discarding the permanent progression).
    const p: BoardMinion[] = [
      { cardId: 'kennel', attack: 2, health: 50, sourceUid: 'K', resummon: true },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] },
    ];
    const e: BoardMinion[] = [{ cardId: 'cleric', attack: 3, health: 20 }];
    const r = run(p, e, 7);
    expect(r.result).toBe('win');
    const entry = r.playerSummonBonus?.find((b) => b.sourceUid === 'K');
    expect(entry).toBeDefined();
    expect(entry!.bonus).toBeGreaterThanOrEqual(1);
  });
});

describe('resolution step tags', () => {
  it('every event carries a monotonically non-decreasing step id', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'sandbag', attack: 0, health: 5 }],
      [{ cardId: 'pack', attack: 2, health: 2 }],
      makeRng(3), CARD_INDEX,
    );
    expect(r.events.length).toBeGreaterThan(0);
    let prev = -1;
    for (const e of r.events) {
      expect(typeof e.step).toBe('number');
      expect(e.step!).toBeGreaterThanOrEqual(prev);
      prev = e.step!;
    }
  });

  it('an attack and its same-swing damage (hit + retaliation) share one step', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'sandbag', attack: 2, health: 8 }],
      makeRng(3), CARD_INDEX,
    );
    const atkIdx = r.events.findIndex((e) => e.type === 'attack');
    const atk = r.events[atkIdx]!;
    const dmgs = r.events.filter((e) => e.type === 'dmg' && e.step === atk.step);
    expect(dmgs.map((d) => (d as { target: string }).target).sort()).toEqual(
      [(atk as { attacker: string }).attacker, (atk as { defender: string }).defender].sort(),
    );
  });

  it("a Deathrattle's summons land in a LATER step than the death they follow", () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'pack', attack: 2, health: 2 }],
      makeRng(3), CARD_INDEX,
    );
    const death = r.events.find((e) => e.type === 'death')!;
    const summon = r.events.find((e) => e.type === 'summon')!;
    expect(summon.step!).toBeGreaterThan(death.step!);
  });

  it("an on-kill reward lands in a LATER step than the victim's death (not merged into a rattle step)", () => {
    // Karthus's Slaughter buffs your living Undead (itself included) via ctx.buff the moment it kills —
    // the reward must get its own step AFTER every death in the clash, not ride the last victim's rattle.
    const r = simulate(
      [{ cardId: 'karthus', attack: 7, health: 8 }],
      [{ cardId: 'sandbag', attack: 1, health: 1 }],
      makeRng(3), CARD_INDEX,
    );
    const karthus = r.initial.player[0]!.uid;
    const death = r.events.find((e) => e.type === 'death')!;
    const reward = r.events.find((e) => e.type === 'buff' && e.source === karthus)!;
    expect(death).toBeDefined();
    expect(reward).toBeDefined();
    expect(reward.step!).toBeGreaterThan(death.step!);
  });

  it('step tags are deterministic (same seed → identical tags)', () => {
    const roster: Parameters<typeof simulate>[0] = [{ cardId: 'stray', attack: 3, health: 10 }];
    const foe: Parameters<typeof simulate>[1] = [{ cardId: 'pack', attack: 2, health: 2 }];
    const a = simulate(roster, foe, makeRng(7), CARD_INDEX);
    const b = simulate(roster, foe, makeRng(7), CARD_INDEX);
    expect(a.events.map((e) => e.step)).toEqual(b.events.map((e) => e.step));
  });
});

describe('combat-phase quest tallies', () => {
  it('counts player attacks + enemy slaughters, attributed to the killer/attacker tribe', () => {
    // A fat Beast (Pennycat overridden to 10/10) grinds down two weak enemies — it attacks and slaughters both.
    const p: BoardMinion[] = [{ cardId: 'alley', attack: 10, health: 10 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }, { cardId: 'sandbag', attack: 0, health: 1 }];
    const r = simulate(p, e, makeRng(1), CARD_INDEX);
    expect(r.result).toBe('win');
    expect(r.playerQuestTally).toBeDefined();
    expect(r.playerQuestTally!.slaughter).toBe(2);
    expect(r.playerQuestTally!.slaughterByTribe.beast).toBe(2); // both kills credited to a Beast
    expect(r.playerQuestTally!.attack).toBeGreaterThanOrEqual(2);
    expect(r.playerQuestTally!.attackByTribe.beast).toBe(r.playerQuestTally!.attack);
  });

  it('The Old Hunt (questMods.oldHuntStep): each Beast attack pumps the Beast aura, carried back', () => {
    const p: BoardMinion[] = [{ cardId: 'alley', attack: 3, health: 40 }]; // survives to attack several times
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 30 }];
    const r = simulate(
      p, e, makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, ['beast'], {}, false, false, 0, 0, 0, 0,
      { oldHuntStep: 7 },
    );
    // At least one Beast attack landed → the aura grew by a multiple of the step.
    expect(r.playerBeastBuyAtkGain).toBeGreaterThanOrEqual(7);
    expect(r.playerBeastBuyAtkGain! % 7).toBe(0);
  });
});
