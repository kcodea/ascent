import type { CardDef } from '@game/core';

/**
 * Dragons (handoff A.7) — Battlecry stat-scaling + Start-of-Combat AoE. The M1
 * second tribe: it exercises both halves of the effect system at once. The
 * Battlecry buffs (`battlecryBuffTribe`) bake into board stats during recruit
 * (`@game/sim`); the Start-of-Combat effects (`scDamage` / `scSplitDamage` /
 * `scAoePerTribe`) fire inside `simulate()` and emit `sc` log events.
 */
export const DRAGONS: CardDef[] = [
  {
    id: 'cleric',
    name: 'Hoard Cleric',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 3 } }],
    text: '**Battlecry:** give your Dragons **+2/+3**.',
  },
  {
    id: 'cinder',
    name: 'Cinderwing Matron',
    tribe: 'dragon',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffSpellPower', params: { attack: 0, health: 1 } }],
    text: '**Battlecry:** give your spells **+1 Health**.',
    goldenText: '**Battlecry:** give your spells **+2 Health**.',
  },
  {
    id: 'weaver',
    name: 'Arcane Weaver',
    tribe: 'dragon',
    tier: 4,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'spiritfire' } }],
    text: '**Deathrattle:** add a copy of **Spirit Fire** to your hand.',
    goldenText: '**Deathrattle:** add two copies of **Spirit Fire** to your hand.',
  },
  {
    // Each Battlecry *resolution* pumps your Dragons — so Drakko (which fires Battlecries an extra
    // time) procs Karwind once per fire. A recruit-phase engine that rewards a Battlecry-heavy board.
    id: 'karwind',
    name: 'Karwind',
    tribe: 'dragon',
    tier: 6,
    attack: 2,
    health: 12,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffTribe', params: { tribe: 'dragon', attack: 1, health: 2 } }],
    text: 'Whenever a **Battlecry** triggers, give your Dragons **+1/+2**.',
  },
  {
    // Dual-type Dragon/Demon payoff. Every Battlecry *fire* on your board permanently enchants the Fodder
    // card type +1/+1 run-wide (Ritualist's mechanism, on a battlecry trigger instead of End of Turn). Fires
    // per fire, so Drakko's doubling procs it twice; multiple Banes stack. Bridges Demon Fodder with a
    // Battlecry-heavy build. No combat factory → inert in combat (just a 12/12 body).
    id: 'bane',
    name: 'Bane',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 6,
    attack: 12,
    health: 12,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffFodder', params: { attack: 1, health: 1 } }],
    text: 'After you trigger a Battlecry, give Fodder **+1/+1** this run.',
    goldenText: 'After you trigger a Battlecry, give Fodder **+2/+2** this run.',
  },

  // --- New dragons (2026-06-24 content batch). Frontdrake's cadence grant, Supporter's tribe Rally, and
  //     Stuntdrake's Avenge use new effect primitives; Bronze Warden is a vanilla Divine-Shield wall. ---
  {
    // Recruit cadence faucet: every 3rd End of Turn it survives, conjure a random Dragon (tavern-tier
    // bound). Rewards keeping a fragile 2/1 alive across shops. Golden → 2 Dragons.
    id: 'frontdrake',
    name: 'Frontdrake',
    tribe: 'dragon',
    tier: 1,
    attack: 2,
    health: 1,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnGrantTribe', params: { tribe: 'dragon', every: 3, count: 1 } }],
    text: '**Every 3 turns,** get a random Dragon.',
    goldenText: '**Every 3 turns,** get **2** random Dragons.',
  },
  {
    // Tribe Rally — when it attacks in combat, pump up to 2 other friendly Dragons. The combat half of the
    // Dragon go-wide plan; extra attacks (Windfury) rally repeatedly. Golden doubles the buff.
    id: 'supporter',
    name: 'Supporter',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyBuff', params: { tribe: 'dragon', count: 2, attack: 1, health: 2 } }],
    text: '**Rally:** give 2 friendly Dragons **+1/+2**.',
    goldenText: '**Rally:** give 2 friendly Dragons **+2/+4**.',
  },
  {
    // A plain Divine-Shield wall — soaks the first hit. Keyword-only (the DS badge carries the meaning).
    id: 'bronzewarden',
    name: 'Bronze Warden',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: ['DS'],
    effects: [],
    text: '',
  },
  {
    // Avenge payoff: after 3 friendly deaths in combat, hand this minion's Attack to 2 other friends — a
    // burst that rewards a sacrificial front line. Uses the new `avengeGiveAttack` combat primitive.
    id: 'stuntdrake',
    name: 'Stuntdrake',
    tribe: 'dragon',
    tier: 5,
    attack: 3,
    health: 7,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGiveAttack', params: { count: 3, targets: 2 } }],
    text: "**Avenge (3):** give this minion's Attack to 2 friendly minions.",
  },

  // --- Reactive-buff dragons (2026-06-24 batch, combat-machinery). Hunter uses a new `onGainAttack` trigger;
  //     Crypt Drake reacts to the broadcast `onAttack` and scales via a per-combat counter. ---
  {
    // Reactive Health engine: every time Hunter's Attack rises (rally, Raptor, Crypt Drake, any buff), all
    // your minions gain Health. Pairs with Attack-pumpers. Golden → +4 Health.
    id: 'hunter',
    name: 'Hunter',
    tribe: 'dragon',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'onGainAttack', do: 'onGainAttackBuffAll', params: { health: 2 } }],
    text: 'When this gains Attack, give your minions **+2 Health**.',
    goldenText: 'When this gains Attack, give your minions **+4 Health**.',
  },
  {
    // Undead/Dragon snowball: every ally attack buffs your whole board, and the buff grows every 3 attacks.
    // Explosive on a wide board. Golden doubles the per-step buff.
    id: 'cryptdrake',
    name: 'Crypt Drake',
    tribe: 'dragon',
    tribe2: 'undead',
    tier: 6,
    attack: 4,
    health: 10,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onAllyAttackBuffAll', params: { step: 2, every: 3 } }],
    text: 'When an ally attacks, give your minions **+2/+2**. Improve this every **3** attacks.',
    goldenText: 'When an ally attacks, give your minions **+4/+4**. Improve this every **3** attacks.',
  },
  {
    // Quest dragon: Engraved (keeps combat stat gains), and after being GRANTED STATS 20 times in combat it
    // ascends to Taragosa at the next settle (keeping its accumulated stats, like Spirit Pup). The counting
    // is automatic (simulate tallies grants for any `ascendAt` card); no combat factory needed. Golden →
    // golden Taragosa.
    id: 'tara',
    name: 'Tara',
    tribe: 'dragon',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: ['EG'],
    effects: [],
    ascendAt: 20,
    ascendInto: 'taragosa',
    text: 'All stats are **Engraved**. Granted stats **20 times** in combat → ascend to **Taragosa**.',
  },

  // --- Twilight Whelp line (2026-06-24) — the immediate-attack mechanic; replaces Ember Whelp at T1. ---
  {
    // Fragile T1 that leaves a 3/3 Whelp behind — and the Whelp ATTACKS IMMEDIATELY on spawn (the
    // `whelpling` token's `attackOnSummon`, drained by simulate's immediate-attack queue). Golden → 2 Whelps.
    id: 'twilightwhelp',
    name: 'Twilight Whelp',
    tribe: 'dragon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'whelpling', count: 1 } }],
    text: '**Deathrattle:** summon a 3/3 Whelp that attacks immediately.',
    goldenText: '**Deathrattle:** summon two 3/3 Whelps that attack immediately.',
  },
  {
    // Deathrattle factory for the Whelp line: leaves 2 Twilight Whelps WITH Taunt (each leaves a 3/3
    // immediate Whelp when it dies). Golden → 4. Uses deathrattleSummon's optional `keyword` grant.
    id: 'broodmother',
    name: 'Twilight Broodmother',
    tribe: 'dragon',
    tier: 4,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'twilightwhelp', count: 2, keyword: 'T' } }],
    text: '**Deathrattle:** summon 2 **Twilight Whelps** with **Taunt**.',
    goldenText: '**Deathrattle:** summon 4 **Twilight Whelps** with **Taunt**.',
  },
];
