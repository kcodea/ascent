import type { CardDef } from '@game/core';

/**
 * SET 3 — DRAGONS (owner 2026-10-13, authored for Set 4; MOVED to Set 3 2026-10-14, owner: "move our current set 4
 * dragons to set 3"): the WHISPER Dragons. Ids unchanged (`d4_*` records where they were first authored). Galas and Tolan GRANT a Whisper (`grantWhisper`: a Start of
 * Turn effect while on the board, and the reducer's minion play reads the same marker to hand one over the moment
 * the minion is played from hand, see `sim/whisper.ts`); Tamby and Whisp react to Whispers being cast on minions (Whisp and Gatherer archived 2026-10-23, now in `cards/archive.ts`). No art yet (missing-art convention).
 */
export const SET3_DRAGONS: readonly CardDef[] = [
  {
    // T1 3/1. Whisper: Tome. Gilded: its Tome is worth double (+2/+2, improving by +2/+2 every 4 spells).
    id: 'd4_galas',
    name: 'Galas',
    tribe: 'dragon',
    tier: 1,
    attack: 3,
    health: 1,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w4_tome' } }],
    text: '**Whisper:** Give a friendly minion **+1/+1**. Improves every 4 spells cast this game.',
    goldenText: '**Whisper:** Give a friendly minion **+2/+2**. Improves by **+2/+2** every 4 spells cast this game.',
  },
  {
    // T2 2/5. Whisper: Runebind (+2/+2, improve this: run-wide, every copy). Gilded: double the value and the improve.
    id: 'd4_tolan',
    name: 'Tolan',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w4_runebind' } }],
    text: '**Whisper:** Give a friendly minion **+2/+2**. Improve this.',
    goldenText: '**Whisper:** Give a friendly minion **+4/+4**. Improve this twice.',
  },
  {
    // T3 3/4. A Whisper cast on this hands back a copy (once per turn). Gilded: 2 copies.
    id: 'd4_tamby',
    name: 'Tamby',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'spellCastOnThis', do: 'whisperCastOnThisCopy', params: { count: 1 } }],
    text: 'When you cast a **Whisper** on this, get a copy of it. (Once per turn)',
    goldenText: 'When you cast a **Whisper** on this, get **2** copies of it. (Once per turn)',
  },
  {
    // T6 9/10 (owner 2026-10-14). "When a Dragon attacks, cast Runebind on it. (3 times per combat)". A COMBAT cast of the
    // real Whisper (`onDragonAttackCastWhisper`, core factories): it counts as a spell cast, its stat grant is combat-only
    // (a combat buff), and Runebind's improve is PERMANENT (carried back as `playerWhisperImprove`). Whisp hears it (a
    // Whisper cast on a Dragon) and Tamby copies it. Gilded: the cast Runebind is a GILDED copy (double value and improve);
    // the cap stays 3. Appended after Whisp so no earlier Set 3 pool position moves.
    id: 'd3_whaloo',
    name: 'Whaloo',
    tribe: 'dragon',
    tier: 6,
    attack: 9,
    health: 10,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onDragonAttackCastWhisper', params: { cardId: 'w4_runebind', perCombat: 3 } }],
    text: 'When a Dragon attacks, cast **Runebind** on it. **(3 times per combat)**',
    goldenText: 'When a Dragon attacks, cast a **Gilded Runebind** on it. **(3 times per combat)**',
  },
  {
    // T5 6/5 (owner 2026-10-14). "Whisper: Ripple - Trigger a minion's Shout." Grants the Whisper Ripple exactly as Galas
    // and Tolan grant theirs (on play from hand + every Start of Turn while on the board). Gilded: a gilded Ripple, which
    // triggers the Shout twice (each its own replay).
    id: 'd3_falx',
    name: 'Falx',
    tribe: 'dragon',
    tier: 5,
    attack: 6,
    health: 5,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w3_ripple' } }],
    text: "**Whisper:** Trigger a friendly minion's **Shout**.",
    goldenText: "**Whisper:** Trigger a friendly minion's **Shout** twice.",
  },
  {
    // T5 7/8 (owner 2026-10-14): "Your Spells cast an additional time in combat." Owner: "counts all spells, rubies, shop
    // spells, whispers etc". A PASSIVE read live by the one combat cast path (`spellCastRepsFor`, +1 per living Morro,
    // +2 Gilded, additive with Runebloom / Ancient of War) and by the combat Ruby primitive (`playRubyOn`). Shop-phase
    // casts are untouched ("in combat").
    id: 'd3_morro',
    name: 'Queen Morro',
    tribe: 'dragon',
    tier: 5,
    attack: 7,
    health: 8,
    keywords: [],
    effects: [{ on: 'passive', do: 'combatSpellsCastExtra', params: { extra: 1 } }],
    text: 'Your spells cast an additional time in combat.',
    goldenText: 'Your spells cast **2** additional times in combat.',
  },
  {
    // T4 5/4 (owner 2026-10-14): "Equip: Jar of Secrets (2): Get 3 random Whispers." The Equip convention (Alchemist
    // Frank): the card names its Equipment by id; "(2)" is the Equipment's Gold cost.
    id: 'd3_shush',
    name: 'Shush',
    tribe: 'dragon',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'jar_of_secrets' } }],
    text: '**Equip Jar of Secrets (2):** Get **3** random **Whispers**.',
    goldenText: '**Equip Jar of Secrets (2):** Get **3** random **Gilded Whispers**.',
  },
  // -- Owner Set 3 Dragon batch 2 (2026-10-15). Appended after Shush so no earlier Set 3 pool position moves. --
  {
    // T5 8/3 (T6 until the owner's 2026-10-15 move: "move gravus & well watcher to t5"), Dragon AND Undead (the `tribe2` dual): "Echo: Give this minion's Attack to 2 friendly minions." Its Attack
    // at death, to 2 DIFFERENT random other friendly minions (Lieutenant Thane's Rally body, reused by
    // `deathrattleGiveAttackToOthers`). Combat: a combat buff (R-BUFF-PERM); a Shop Echo is permanent. Gilded: the whole
    // spread twice (Thane's convention).
    id: 'd3_gravus',
    name: 'Gravus',
    tribe: 'dragon',
    tribe2: 'undead',
    // Owner 2026-10-23 ("Gravis -> T6, 10/3 Taunt. Echo: Give this minion's Attack to 2 friendly minions."): T5 8/3 ->
    // T6 10/3 and gains Taunt; the Echo and both tribes are unchanged.
    tier: 6,
    attack: 10,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleGiveAttackToOthers', params: { count: 2 } }],
    text: "**Taunt.** **Echo:** Give this minion's **Attack** to **2** friendly minions.",
    goldenText: "**Taunt.** **Echo:** Give this minion's **Attack** to **2** friendly minions twice.",
  },
  {
    // T5 8/8 (T6 until the owner's 2026-10-15 move): "Whisper: Discover a Dragon." Grants the Whisper Well of Dragons (on play from hand + every Start of Turn
    // while on the board, as Galas). Gilded: a gilded Well, which Discovers twice (two Discovers).
    id: 'd3_wellwatcher',
    name: 'Well Watcher',
    tribe: 'dragon',
    tier: 5,
    attack: 8,
    health: 8,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w3_wellofdragons' } }],
    text: '**Whisper:** **Discover** a **Dragon**.',
    goldenText: '**Whisper:** **Discover** a **Dragon** twice.',
  },
  {
    // T6 4/12: "When you cast a spell, give your minions +3 Health." EVERY spell (owner: Rubies, Whispers, Shop spells):
    // Shop spells, Gifts and Whispers reach every `spellCast` watcher; `includeRubies` opts it into Ruby casts in the
    // Shop, and the combat Ruby path fires it too (`onRubyCast`). Shop: permanent; combat: a combat buff (R-BUFF-PERM).
    // Gilded: +6 Health.
    id: 'd3_matriarch',
    name: 'Matriarch',
    tribe: 'dragon',
    tier: 6,
    attack: 4,
    health: 12,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffAll', params: { attack: 0, health: 3, includeRubies: true } }],
    text: 'When you cast a spell, give your minions **+3 Health**.',
    goldenText: 'When you cast a spell, give your minions **+6 Health**.',
  },
  {
    // T3 5/3: "Avenge (3): Get 2 Whispers." Random draws from the whole Whisper pool (Jar of Secrets' pool). Avenge is a
    // combat trigger: the Whispers fly to hand mid-fight and arrive for the next Shop, where every Whisper rule applies
    // (they fade at that turn's End of Turn if unused, and count as spells). Gilded: 2 GILDED Whispers (Shush's rule).
    id: 'd3_woozy',
    name: 'Woozy',
    tribe: 'dragon',
    tier: 3,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantRandomWhispers', params: { count: 3, grant: 2 } }],
    text: '**Avenge (3):** Get **2** random **Whispers**.',
    goldenText: '**Avenge (3):** Get **2** random **Gilded Whispers**.',
  },
  {
    // T5 7/2: "Immune while attacking. (Twice per combat)". Bounty Bot's immunity (`attackImmuneTurns`): its first 2
    // swings each combat take no retaliation, fresh every combat; the combat card counts down live. Gilded: 4 swings.
    id: 'd3_iggy',
    name: 'Immune Iggy',
    tribe: 'dragon',
    tier: 5,
    attack: 7,
    health: 2,
    keywords: [],
    attackImmuneTurns: 2,
    attackImmuneTurnsGilded: 4,
    effects: [],
    text: 'Immune while attacking. **(Twice per combat)**',
    goldenText: 'Immune while attacking. **(4 times per combat)**',
  },
  {
    // T2 2/5: "The first Whisper cast on this is permanent." PER TURN (owner 2026-10-15): the first Whisper cast on it
    // each turn keeps its grant for good (stats, and a Seed's Echo, which stacks with no cap). Read by the Shop cast
    // path (`keepWhispersOnHum`, sim/whisper.ts). Gilded: the first 2.
    id: 'd3_hum',
    name: 'Hum',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'passive', do: 'whisperKeepOnThis', params: { count: 1 } }],
    text: 'The first **Whisper** cast on this each turn is permanent.',
    goldenText: 'The first **2 Whispers** cast on this each turn are permanent.',
  },
  {
    // T1 1/1: "Whisper: Give a minion 'Echo: Summon a 3/3 Drake Pup with Taunt.'" Grants the Whisper Seed. The granted
    // Echo lasts until the start of your next turn, like every Whisper grant (a Hum keeps it). Gilded: a gilded Seed,
    // which grants the Echo twice (two Drake Pups).
    id: 'd3_gardener',
    name: 'Gardener',
    tribe: 'dragon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w3_seed' } }],
    text: '**Whisper:** Give a minion "**Echo:** Summon a 3/3 Drake Pup with **Taunt**."',
    goldenText: '**Whisper:** Give a minion "**Echo:** Summon a 3/3 Drake Pup with **Taunt**" twice.',
  },
  // -- Owner additions on PR #2097 (2026-10-15): Bait Brood, Hatcher, Whispwarder. --
  {
    // T2 2/4: "Whisper: Give a minion +3/+5 and Taunt." Grants the Whisper Bait. Per the Whisper rule the stats AND the
    // granted Taunt last until the start of your next turn (`whisperKeywords`); a Hum keeps both. Gilded: a gilded Bait
    // (+6/+10 and Taunt; the keyword is not doubled).
    id: 'd3_baitbrood',
    name: 'Bait Brood',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w3_bait' } }],
    text: '**Whisper:** Give a minion **+3/+5** and **Taunt**.',
    goldenText: '**Whisper:** Give a minion **+6/+10** and **Taunt**.',
  },
  {
    // T4 5/4: "Whisper: Get a random Tier 1 Dragon. Improves every turn." Each Start of Turn on the board this Hatcher
    // steps its Whisper up a tier (`whisperTick`; T1, T2, ... capped at T6) BEFORE handing it over, so the copy granted on
    // play is Tier 1 and the next turn's is Tier 2. Per instance; it does not tick in hand (the on-board cadence
    // convention). The Whisper carries its tier (`grantedTier`), drawn from the run's set pool. Gilded: get 2.
    id: 'd3_hatcher',
    name: 'Hatcher',
    tribe: 'dragon',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w3_clutch', tierStep: true } }],
    text: '**Whisper:** Get a random **Tier 1** **Dragon**. Improves every turn.',
    goldenText: '**Whisper:** Get **2** random **Tier 1** **Dragons**. Improves every turn.',
  },
  {
    // T5 7/5: "Whisper: Give a minion Ward." Grants the Whisper Warding Call; the Ward lasts until the start of your next
    // turn (`whisperKeywords`; a Hum keeps it). Gilded: its Warding Call gives Resilient Ward instead.
    id: 'd3_whispwarder',
    name: 'Whispwarder',
    tribe: 'dragon',
    tier: 5,
    attack: 7,
    health: 5,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId: 'w3_wardingcall' } }],
    text: '**Whisper:** Give a minion **Ward**.',
    goldenText: '**Whisper:** Give a minion **Resilient Ward**.',
  },
  {
    // DRAKE PUP: the 3/3 Taunt Dragon a Seed's granted Echo summons. `token: true`: never drawn, resolves globally.
    id: 'd3_drakepup',
    name: 'Drake Pup',
    tribe: 'dragon',
    tier: 1,
    attack: 3,
    health: 3,
    keywords: ['T'],
    effects: [],
    token: true,
    text: '',
  },
  {
    // VELLUM (owner 2026-10-23), T7 Summit Dragon 12/8: "Equip Royal Edict (2): Improve your Shop spells by +2/+2. Your
    // next 3 spells cast from hand this turn cast an additional time." The Equip convention (Alchemist Frank / Shush):
    // the card names its Equipment by id; "(2)" is the Gold cost. Both halves live on `ROYAL_EDICT`.
    id: 'd3_vellum',
    name: 'Vellum',
    tribe: 'dragon',
    tier: 7,
    attack: 12,
    health: 8,
    keywords: [],
    effects: [{ on: 'equip', do: 'grantEquipment', params: { equipmentId: 'royal_edict' } }],
    text: '**Equip Royal Edict (2):** Improve your **Shop spells** by **+2/+2**. Your next **3** spells cast from hand this turn cast an additional time.',
    goldenText: '**Equip Royal Edict (2):** Improve your **Shop spells** by **+4/+4**. Your next **3** spells cast from hand this turn cast **2** additional times.',
  },
];
