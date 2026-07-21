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
    // Early Dragon glue: a Taunt body that hands a single friendly Dragon a real stat bump. `target: 'friendly'`
    // + `targetTribe: 'dragon'` drive the player's pick; `battlecryBuffTarget` applies it. Follows the standing
    // tribe-restricted-target convention (Toxin Tender): with no OTHER friendly Dragon on board there's no
    // viable target, so the Battlecry doesn't fire and the body plays as-is (no prompt). A Myra / face-Omen
    // re-fire with no explicit target auto-picks the highest-Attack friendly Dragon. Golden doubles the grant.
    id: 'emissary',
    name: 'Twilight Emissary',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: ['T'],
    target: 'friendly',
    targetTribe: 'dragon',
    effects: [{ on: 'onPlay', do: 'battlecryBuffTarget', params: { attack: 2, health: 2 } }],
    text: '**Taunt.** **Battlecry:** give a friendly **Dragon** **+2/+2**.',
    goldenText: '**Taunt.** **Battlecry:** give a friendly **Dragon** **+4/+4**.',
  },
  {
    id: 'cleric',
    name: 'Hoard Cleric',
    tribe: 'dragon',
    tier: 3,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 3, health: 3, includeSelf: false } }],
    text: '**Battlecry:** give your **other** Dragons **+3/+3**.',
  },
  {
    id: 'cinder',
    name: 'Cinderwing Matron',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffSpellPower', params: { attack: 0, health: 1 } }],
    text: '**Shout:** give your spells **+1 Health**.',
    goldenText: '**Shout:** give your spells **+2 Health**.',
  },
  {
    id: 'weaver',
    name: 'Arcane Weaver',
    tribe: 'dragon',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantSpell', params: { count: 2, cardId: 'spiritfire' } }],
    text: '**Avenge (2):** add a copy of **Spirit Fire** to your hand.',
    goldenText: '**Avenge (2):** add two copies of **Spirit Fire** to your hand.',
  },
  {
    // Each Battlecry *resolution* pumps your Dragons — so Drakko (which fires Battlecries an extra
    // time) procs Karwind once per fire. A recruit-phase engine that rewards a Battlecry-heavy board.
    id: 'karwind',
    name: 'Karwind',
    tribe: 'dragon',
    tier: 5,
    attack: 5,
    health: 10,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 2 } }],
    text: 'Whenever a **Battlecry** triggers, give your Dragons **+2/+2**.',
    goldenText: 'Whenever a **Battlecry** triggers, give your Dragons **+2/+2** twice.',
  },
  {
    // Dual-type Dragon/Demon payoff. Every Battlecry *fire* on your board permanently enchants the Fodder
    // card type +1/+1 run-wide (Ritualist's mechanism, on a battlecry trigger instead of End of Turn). Fires
    // per fire, so Drakko's doubling procs it twice; multiple Banes stack. Bridges Demon Fodder with a
    // Battlecry-heavy build. In combat it also reacts to Ryme's battlecry replays via onBattlecryBuffFodder
    // (buffs living FD/imp bodies this combat + grants the permanent Imp carry-back).
    id: 'bane',
    name: 'Bane',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 6,
    attack: 7,
    health: 9,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffFodder', params: { attack: 2, health: 2 } }],
    text: 'After you trigger a Battlecry, give Fodder and Imps **+2/+2** this run.',
    goldenText: 'After you trigger a Battlecry, give Fodder and Imps **+4/+4** this run.',
  },

  // --- New dragons (2026-06-24 content batch). Frontdrake's cadence grant, Supporter's tribe Rally, and
  //     Stuntdrake's Avenge use new effect primitives; Bronze Warden is a vanilla Divine-Shield wall. ---
  {
    // Recruit cadence faucet: every 3rd End of Turn it survives, conjure a random Dragon (tavern-tier
    // bound). Rewards keeping a fragile 2/1 alive across shops. Golden → 2 Dragons.
    id: 'frontdrake',
    name: 'Bard',
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
    // Battlecry tempo: conjure a random Dragon from the run's buyable pool, tavern-tier bound (the
    // same "shop tier laws" as every conjure). Golden conjures 2.
    id: 'havendrake',
    name: 'Haven Drake',
    tribe: 'dragon',
    tier: 5,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tribe: 'dragon' } }],
    text: '**Battlecry:** get a random **Dragon**.',
    goldenText: '**Battlecry:** get **2** random **Dragons**.',
  },
  {
    // Tribe Rally — when it attacks in combat, pump up to 2 other friendly Dragons. The combat half of the
    // Dragon go-wide plan; extra attacks (Windfury) rally repeatedly. Golden doubles the buff.
    id: 'supporter',
    name: 'Supporter',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyBuff', params: { tribe: 'dragon', count: 2, attack: 1, health: 2 } }],
    text: '**Rally:** give 2 friendly Dragons **+1/+2**.',
    goldenText: '**Rally:** give 2 friendly Dragons **+2/+4**.',
  },
  {
    // A Divine-Shield wall that also threatens back — the shield buys a swing, Critical Strike makes that
    // swing matter. Keyword-only (the DS + CR badges carry the meaning); `critChance` is the per-swing roll.
    id: 'bronzewarden',
    name: 'Guardian Drake',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: ['DS', 'CR'],
    critChance: 0.5,
    effects: [],
    text: '',
  },
  {
    // Avenge payoff: after 3 friendly deaths in combat, hand this minion's Attack to 2 other friends — a
    // burst that rewards a sacrificial front line. Uses the new `avengeGiveAttack` combat primitive.
    id: 'stuntdrake',
    name: 'Obsidian Drake',
    tribe: 'dragon',
    tier: 5,
    attack: 3,
    health: 7,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGiveAttack', params: { count: 3, targets: 2 } }],
    text: "**Avenge (3):** give this minion's Attack to 2 other friendly minions.",
    goldenText: "**Avenge (3):** give this minion's Attack to 2 other friendly minions **twice**.",
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
    effects: [{ on: 'onGainAttack', do: 'onGainAttackBuffImproving', params: { attack: 1, every: 3 } }],
    text: 'When this gains Attack, give your minions **+1/+1**. Improve this by **+1/+1** every **3** times.',
    goldenText: 'When this gains Attack, give your minions **+2/+2**. Improve this by **+2/+2** every **3** times.',
  },
  {
    // Undead/Dragon snowball: every 2 ally attacks, buff your whole board +2/+2 — improving +2/+2 every
    // 4 attacks, permanently for this copy (rides summonBonus; a triple sums the two highest accruals).
    // Golden doubles both the grant and the improve step.
    id: 'cryptdrake',
    name: 'Crypt Drake',
    tribe: 'dragon',
    tribe2: 'undead',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onAllyAttackBuffAll', params: { step: 2, every: 2, improveEvery: 4 } }],
    text: 'Every **2** ally attacks, give your minions **+2/+2**. Improves **+2/+2** every **4** attacks.',
    goldenText: 'Every **2** ally attacks, give your minions **+4/+4**. Improves **+4/+4** every **4** attacks.',
  },
  {
    // Quest dragon: Engraved (keeps combat stat gains), and after being GRANTED STATS 20 times in combat it
    // ascends to Taragosa at the next settle (keeping its accumulated stats, like Spirit Pup). The counting
    // is automatic (simulate tallies grants for any `ascendAt` card); no combat factory needed. Golden →
    // golden Taragosa.
    id: 'tara',
    name: 'Tara',
    tribe: 'dragon',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: ['EG'],
    effects: [],
    ascendAt: 15,
    ascendInto: 'taragosa',
    text: '**Engraved**. Grant stats **15 times** in combat to ascend.',
  },

  // --- Twilight Whelp line (2026-06-24) — the immediate-attack mechanic; replaces Ember Whelp at T1. ---
  {
    // Fragile T1 that leaves a 3/2 Whelp behind — and the Whelp ATTACKS IMMEDIATELY on spawn (the
    // `whelpling` token's `attackOnSummon`, drained by simulate's immediate-attack queue). Golden → 2 Whelps.
    id: 'twilightwhelp',
    name: 'Violet Whelp',
    tribe: 'dragon',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'whelpling', count: 1 } }],
    text: '**Deathrattle:** summon a 3/2 Whelp that attacks immediately.',
    goldenText: '**Deathrattle:** summon two 3/2 Whelps that attack immediately.',
  },
  {
    // Deathrattle factory for the Whelp line: leaves 2 Twilight Whelps WITH Taunt (each leaves a 3/2
    // immediate Whelp when it dies). Golden → 4. Uses deathrattleSummon's optional `keyword` grant.
    id: 'broodmother',
    name: 'Violet Whelpmother',
    tribe: 'dragon',
    tier: 4,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'twilightwhelp', count: 2, keyword: 'T' } }],
    text: '**Deathrattle:** summon 2 **Violet Whelps** with **Taunt**.',
    goldenText: '**Deathrattle:** summon 4 **Violet Whelps** with **Taunt**.',
  },
  {
    // Start of Combat: give your Dragons +2/+2 for EVERY spell cast this turn (grant scales with the turn's spell
    // count). The per-spell rate improves by +1/+1 for every 4 spells cast while THIS Runescale has been on the
    // board (per-instance `spellProgress`, ticked by spellCastImproveSelf; tripling SUMS the copies' progress).
    // Golden doubles the whole grant. Cast no spells this turn → no grant.
    id: 'runescale',
    name: 'Runescale Drake',
    tribe: 'dragon',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [
      { on: 'spellCast', do: 'spellCastImproveSelf' },
      { on: 'startOfCombat', do: 'scTribeBuffPerSpellImproving', params: { tribe: 'dragon', attack: 2, health: 2, step: 1, every: 4 } },
    ],
    text: '**Start of Combat:** give your **Dragons** **+2/+2** for every spell cast this turn (at least **+2/+2**). Improve this by **+1/+1** every **4** spells cast.',
    goldenText: '**Start of Combat:** give your **Dragons** **+4/+4** for every spell cast this turn (at least **+4/+4**). Improve this by **+2/+2** every **4** spells cast.',
  },
  {
    // Rally: on attacking, "cast Growth" — buff all your minions +3/+4 (+ combat spell power). A Dragon
    // finisher that snowballs a winning fight; every attack re-casts it. Golden → +6/+8. (Art pending.)
    id: 'hoardbreaker',
    name: 'Hoardbreaker Drake',
    tribe: 'dragon',
    tier: 4,
    attack: 6,
    health: 4,
    keywords: ['RL'],
    effects: [
      { on: 'onAttack', do: 'rallyCastSpell', params: { spellId: 'growth' } },
    ],
    text: '**Rally:** Cast **Growth**.',
    goldenText: '**Rally:** Cast **Growth twice**.',
  },

  // ── Dragon quest reward minions (owner spec 2026-07-08) — `token: true` = reward-exclusive (never in the shop
  //    or "random Dragon" grants). ────────────────────────────────────────────────────────────────────────────
  {
    // Coin Hoard reward — a value bank you cash in on sell, plus a steady stream of Tier-1 cards each turn.
    id: 'hoardwhelp',
    name: 'Hoard Whelp',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: [],
    token: true,
    effects: [
      { on: 'onSell', do: 'onSellGainGold', params: { amount: 6 } },
      { on: 'endOfTurn', do: 'endOfTurnGrantRandomTierCard', params: { tier: 1 } },
    ],
    text: '**Sell:** get **6 Gold**. **End of Turn:** get a random Tier 1 Spell or Minion.',
    goldenText: '**Sell:** get **12 Gold**. **End of Turn:** get **2** random Tier 1 Spells or Minions.',
  },
  {
    // Skybound Pact reward — End of Turn, drags your weakest Dragon up toward your strongest. T4 so Eyes of
    // Aresmar (≤T4) can gild it; golden hands over the strongest's FULL stats.
    id: 'skybound',
    name: 'Skybound Archivist',
    tribe: 'dragon',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: [],
    token: true,
    effects: [{ on: 'endOfTurn', do: 'endOfTurnBuffWeakestDragon', params: { pct: 50 } }],
    text: "**End of Turn:** your weakest Dragon gains stats equal to **50%** of your strongest Dragon's stats.",
    goldenText: "**End of Turn:** your weakest Dragon gains stats equal to **100%** of your strongest Dragon's stats.",
  },
  {
    // Taragosa's Inheritance reward — a stat-gain amplifier: every stat gain THIS minion receives from any source
    // is multiplied (×2, golden ×3). RECRUIT gains: the reducer's stat-gain diff. COMBAT gains: it's Engraved
    // (EG) so its combat gains carry back to the run board, and the settle carry-back multiplies the Heir's
    // entry ×2/×3 — so "all sources" genuinely includes combat, matching the recruit amplifier.
    id: 'taragosaheir',
    name: "Taragosa's Heir",
    tribe: 'dragon',
    tier: 6,
    attack: 7,
    health: 6,
    keywords: ['EG'],
    token: true,
    effects: [],
    text: 'Gains **2× stats** from all sources. **Engraved** — keeps its combat gains.',
    goldenText: 'Gains **3× stats** from all sources. **Engraved** — keeps its combat gains.',
  },
  {
    // Chimerus quest reward (Dragon capstone). Rally: each attack hands its own Health to 2 friendly Dragons —
    // a tanky body that turns its bulk into board-wide Dragon Health. Golden runs the whole hand-out TWICE.
    id: 'chimerus',
    name: 'Chimerus',
    tribe: 'dragon',
    tier: 6,
    attack: 4,
    health: 8,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGiveHealthToDragons' }],
    text: "**Rally:** give this minion's Health to 2 friendly Dragons.",
    goldenText: "**Rally:** give this minion's Health to 2 friendly Dragons, **twice**.",
    token: true,
  },
];
