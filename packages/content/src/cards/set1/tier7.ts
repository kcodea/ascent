import type { CardDef } from '@game/core';

/**
 * TIER 7 — the Summit rift's capstone minions (2026-07-20).
 *
 * These are **not reachable in a normal run**: Tier 7 only exists while the Summit rift is active
 * (`maxTierFor`), so outside Summit they are unbuyable simply because no shop ever reaches their tier. No
 * extra gating flag is needed — `availableOffers` already filters on `card.tier <= state.tier`. They can
 * still arrive through anything that names a tier explicitly (a quest/rune Discover, a hero grant, a rift),
 * which is the intended back door.
 *
 * Pool quantity is 6 copies each (`POOL_QUANTITIES[7]`), matching Tier 6.
 *
 * Text is authored in the INTERNAL vocabulary (Battlecry / Deathrattle / Magnetic); `terms.ts` renames it
 * to Shout / Echo / Attachment at display time.
 */
export const TIER7: CardDef[] = [
  {
    // Beast payoff that turns a wide Beast board into a single enormous body. Engraved ('EG') is what makes
    // the gain PERMANENT across the run; the factory only supplies the growth. Improves +10/+10 per proc.
    id: 'thundeer',
    name: 'Thundeer',
    tribe: 'beast',
    tier: 7,
    attack: 10,
    health: 10,
    keywords: ['EG'],
    effects: [{ on: 'onAttack', do: 'onAllyTribeAttackBuffSelf', params: { tribe: 'beast', attack: 10, step: 10 } }],
    text: 'When your Beasts attack, gain **+10/+10** permanently. Improve this.',
    goldenText: 'When your Beasts attack, gain **+20/+20** permanently. Improve this.',
  },
  {
    // Demon finisher: a 15/3 glass cannon whose death floods the board with warded Imps and permanently
    // enchants every Imp you will ever summon. `fixed: true` keeps the summon count at 7 when gilded —
    // the gild lifts the Imp BUFF instead (the Imp King pattern).
    id: 'amunrab',
    name: 'Amun Rab',
    tribe: 'demon',
    tier: 7,
    attack: 15,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 7, fixed: true, keyword: 'DS' } },
      { on: 'onDeath', do: 'deathrattleBuffImpsImproving', params: { attack: 10, step: 10 } },
    ],
    text: '**Deathrattle:** Summon **7** Imps with **Divine Shield** and give your Imps **+10/+10**. Improve this.',
    goldenText: '**Deathrattle:** Summon **7** Imps with **Divine Shield** and give your Imps **+20/+20**. Improve this.',
  },
  {
    // The Mech capstone: every Attachment in the run lands twice. Multiplies Banksly, Combinator, Cling
    // Drones, Money Bots AND the Beatbot mirror. Best-copy-counts (no stacking) — see conductorWelds.
    id: 'attachmentconductor',
    name: 'Attachment Conductor',
    tribe: 'mech',
    tier: 7,
    attack: 7,
    health: 10,
    keywords: [],
    effects: [],
    text: 'Your **Magnetics** magnetize **twice**.',
    goldenText: 'Your **Magnetics** magnetize **three times**.',
  },
  {
    // Dragon capstone: a 9/3 that sweeps the enemy line and never takes retaliation. Keyword-only — the
    // Cleave badge plus `attackImmuneAlways` carry the whole card, so the gild is pure stats.
    id: 'mauron',
    name: 'Mauron',
    tribe: 'dragon',
    tier: 7,
    attack: 9,
    health: 3,
    keywords: ['C'],
    attackImmuneAlways: true,
    effects: [],
    text: 'Immune while attacking.',
    goldenText: 'Immune while attacking.',
  },
  {
    // Undead capstone: Rise itself, hand Rise to the whole board on death, and cast Lantern of Souls for a
    // permanent run-wide Undead Attack buff. Three payoffs on one 8/5 body.
    id: 'anubis',
    name: 'Anubis',
    tribe: 'undead',
    tier: 7,
    attack: 8,
    health: 5,
    keywords: ['R'],
    effects: [
      { on: 'onDeath', do: 'deathrattleGrantRebornAll', params: {} },
      { on: 'onDeath', do: 'deathrattleCastTribeAttack', params: { tribe: 'undead', amount: 3 } },
    ],
    text: '**Deathrattle:** Give your minions **Reborn**. Cast **Lantern of Souls**.',
    goldenText: '**Deathrattle:** Give your minions **Reborn**. Cast **Lantern of Souls** twice.',
  },
  {
    // A Tier 7 body you're rewarded for GETTING RID of — the anti-carry. Selling it opens two Tier 6
    // Discovers (gilded when Salvatore is gilded), converting one slot into two finished cards.
    id: 'salvatore',
    name: 'Salvatore McKlusky',
    tribe: 'neutral',
    tier: 7,
    attack: 5,
    health: 5,
    keywords: [],
    effects: [{ on: 'onSell', do: 'onSellDiscover', params: { tier: 6, count: 2 } }],
    text: 'When you sell this, **Discover** 2 Tier 6 minions.',
    goldenText: 'When you sell this, **Discover** 2 **golden** Tier 6 minions.',
  },
  {
    // The multiplier capstone: SIX trigger families at once, through the shared `triggerMultiplier` system
    // (there is no bespoke Uron code anywhere). Non-stacking, matching Drakko and Chronos — two Urons do
    // not silently 3x. It does NOT touch Yazzus's targeted-spell doubling, which is a spell-cast count
    // rather than a trigger family.
    id: 'uron',
    name: 'Uron, Oathbringer',
    tribe: 'neutral',
    tier: 7,
    attack: 7,
    health: 7,
    keywords: [],
    effects: [],
    triggerMultiplier: { families: ['rally', 'endOfTurn', 'startOfCombat'], extra: 1 },
    text: 'Your **Rallies**, **End of Turns** and **Start of Combats** trigger an additional time.',
    goldenText: 'Your **Rallies**, **End of Turns** and **Start of Combats** trigger **2** additional times.',
  },
  {
    // The RECRUIT-side multiplier and Uron's counterpart: Shouts + Echoes, the two families Uron gave up.
    // Stacks with Drakko (battlecry) and Sylus (deathrattle) the same way any two multipliers do — Sylus
    // sums, Zyff takes the best copy — so a Sylus + Zyff board is +2 Echoes.
    id: 'zyff',
    name: 'Zyff, the Betrayer',
    tribe: 'neutral',
    tier: 7,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [],
    triggerMultiplier: { families: ['battlecry', 'deathrattle'], extra: 1 },
    text: 'Your **Battlecries** and **Deathrattles** trigger an additional time.',
    goldenText: 'Your **Battlecries** and **Deathrattles** trigger **2** additional times.',
  },
  {
    // Counts as EVERY tribe (`universalTribe`), so it slots into any tribal build — and pays out twice: a
    // Tier 6 minion when played and a Tier 5 when it dies. Venomous makes the 12/10 body trade up.
    id: 'labexperiment',
    name: 'Lab Experiment',
    tribe: 'neutral',
    tier: 7,
    attack: 12,
    health: 10,
    keywords: ['V'],
    universalTribe: true,
    effects: [
      { on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 6 } },
      { on: 'onDeath', do: 'deathrattleGainRandomMinion', params: { tier: 5 } },
    ],
    text: '**Battlecry:** get a Tier 6 minion. **Deathrattle:** get a Tier 5 minion.',
    goldenText: '**Battlecry:** get **2** Tier 6 minions. **Deathrattle:** get **2** Tier 5 minions.',
  },
];
