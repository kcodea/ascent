import type { CardDef } from '@game/core';

/**
 * Neutral glue (handoff A.7). `broker` is a recruit-phase buff-on-buy (baked in by `@game/sim`).
 * `drummer` (Drakko the Drummer — double Battlecries) is a recruit-phase global modifier with no
 * `effects` entry: like Chronos / Yazzus, its behavior is read directly at the relevant call site
 * (`drummerRepeats` in `@game/sim`'s recruit.ts, which `playCard` and the Battlecry-replay paths
 * honor), not via a card factory. `echo` (extra combat summons) is still deferred — it ships with
 * text but no factory. None carry combat factories, so they're inert during `simulate()`.
 */
export const NEUTRAL: CardDef[] = [
  {
    id: 'sandbag',
    name: 'Target Dummy',
    tribe: 'neutral',
    tier: 1,
    attack: 0,
    health: 4,
    keywords: ['T'],
    effects: [{ on: 'onDamaged', do: 'onDamagedGainAttack', params: { attack: 1 } }],
    text: '**Taunt.** When this takes damage, it gains **+1 Attack** permanently.',
    goldenText: '**Taunt.** When this takes damage, it gains **+2 Attack** permanently.',
  },
  {
    // Sell-scaling glue: its sell value grows the longer you hold it (handled in @game/sim's reducer
    // via the BoardCard's boughtWave). Plain stats / no effects — the value is purely the climbing sell.
    id: 'hoarder',
    name: 'Hoarder',
    tribe: 'neutral',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBonusGoldNextTurn', params: { gold: 1 } }],
    text: '**Battlecry:** get **1** extra Gold next turn. Sells for **2 Gold**.',
    goldenText: '**Battlecry:** get **2** extra Gold next turn. Sells for **4 Gold**.',
  },
  {
    id: 'broker',
    name: 'Brightwing Broker',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onBuy', do: 'buffOnBuy', params: { attack: 1, health: 2 } }],
    text: 'Every minion you buy gets **+1/+2**.',
    goldenText: 'Every minion you buy gets **+2/+4**.',
  },
  {
    id: 'buddy',
    name: 'Buddy Buddy',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 1 } }],
    combo: { effects: [{ on: 'onPlay', do: 'deathrattleGrantRandomSpell', params: { exactTier: 1 } }] },
    text: '**Shout:** get a random **Tier 1** minion. **Combo:** also get a random **Tier 1** spell.',
    goldenText: '**Shout:** get **two** random **Tier 1** minions. **Combo:** also get a random **Tier 1** spell.',
  },
  {
    // A cheap Primer body: playing it arms a Combo for your next card, and at Start of Combat it hands the
    // minion on its right a Taunt (a defensive nudge for a go-wide board).
    id: 'combokim',
    name: 'Combo Kim',
    tribe: 'neutral',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: ['SC'],
    primer: true,
    effects: [{ on: 'startOfCombat', do: 'scGrantRightTaunt' }],
    text: '**Primer. Start of Combat:** give the minion to the right of this **Taunt**.',
  },
  {
    // Spell payoff. Each tavern spell you cast pumps three *other* friends (the triple-reward Discover
    // is not a tavern spell, so it doesn't proc). Targets are chosen randomly among your other minions.
    id: 'guel',
    name: 'Archmagus Guel',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'spellCastBuffOthers', params: { attack: 1, health: 1, count: 3 } }],
    text: 'After **a spell is cast** (shop or combat), give 3 friendly minions **+1/+1**, improving by **+1/+1** per 4 spells cast with this on board.',
    goldenText: 'After **a spell is cast** (shop or combat), give 3 friendly minions **+2/+2**, improving by **+2/+2** per 4 spells cast with this on board.',
  },
  {
    // Overflow payoff. When a summon can't fit your full board, TWO random friends get Engraved stats
    // instead — turning board-cap overflow into value. The grant improves every 3 overflows (the tally
    // rides in summonBonus, shared across recruit + combat via the carry-back).
    id: 'monk',
    name: 'Flowing Monk',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'summonOverflow', do: 'overflowBuffRandom', params: { attack: 2, health: 2, count: 2, improveEvery: 5 } }],
    text: "When you summon a minion that doesn't fit, Engrave 2 friendly minions **+2/+2**. Improves by **+2/+2** every 5 overflows.",
    goldenText: "When you summon a minion that doesn't fit, Engrave 2 friendly minions **+4/+4**. Improves by **+4/+4** every 5 overflows.",
  },
  {
    // Battlecry doubler (recruit). While on your board, each Battlecry minion you play fires its
    // Battlecry 1 extra time (golden: 2 extra → ×3); multiple Drakkos do NOT stack (best one counts).
    // A Battlecry that opens a Discover (Black Belt Brian) opens one per fire — Brian + Drakko → 2 spells.
    // Resolved in @game/sim via `drummerRepeats`. No combat factory → inert in combat (just a 2/4 body).
    id: 'drummer',
    name: 'Drakko the Drummer',
    tribe: 'neutral',
    tier: 5,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [],
    text: 'Your **Battlecries** fire **1 more** time.',
    goldenText: 'Your **Battlecries** fire **2 more** times.',
  },
  {
    // Deathrattle doubler. Golden procs 2 more times; multiple Sylus DO stack (additive).
    id: 'sylus',
    name: 'Sylus the Reaper',
    tribe: 'neutral',
    tier: 5,
    attack: 1,
    health: 7,
    keywords: [],
    effects: [],
    text: '**In combat,** your Deathrattles proc **1 more** time.',
    goldenText: '**In combat,** your Deathrattles proc **2 more** times.',
  },
  {
    // End-of-Turn doubler (recruit). Golden triggers 2 more times; multiple Chronos do NOT
    // stack (best one counts) — mirrors Drakko. Resolved in `applyEndOfTurn` (@game/sim).
    id: 'chronos',
    name: 'Chronos',
    tribe: 'neutral',
    tier: 5,
    attack: 1,
    health: 6,
    keywords: [],
    effects: [],
    text: 'Your **End of Turn** effects trigger **1 more** time.',
    goldenText: 'Your **End of Turn** effects trigger **2 more** times.',
  },
  {
    // Spell doubler (recruit) — AIMED spells only. While on your board, each spell you *aim at a minion*
    // (target: friendly/any) resolves its effect an extra time (golden: twice extra → ×3). Untargeted
    // economy/utility/Discover spells are NOT multiplied. Resolved in @game/sim via `spellCasts(def)`.
    // No combat factory → inert in combat; the body is just a sturdy 6/8.
    id: 'yazzus',
    name: 'Yazzus',
    tribe: 'neutral',
    tier: 6,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [],
    text: 'Your **targeted** spells cast **twice**.',
    goldenText: 'Your **targeted** spells cast **three times**.',
  },
  {
    // Engraver. At Start of Combat it grants Engraved (EG) to the minion on its LEFT (golden: both
    // neighbors) — that minion keeps whatever stats it gains in the fight. The grant is combat-time
    // (a new EG on the per-combat clone), so it only sticks for fights where Taurus is adjacent at the
    // bell; the carry-back path reads the *combat* minion's keywords, so the sc-granted EG carries back.
    id: 'taurus',
    name: 'Taurus',
    tribe: 'neutral',
    tier: 6,
    attack: 6,
    health: 8,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scEngraveNeighbor' }],
    text: '**Start of Combat:** adjacent units are **Engraved**.',
    goldenText: '**Start of Combat:** adjacent units are **Engraved** and gain **2× stats** in combat.',
  },
  {
    // Late-game Discover: peek 3 minions of EXACTLY tier 5 (a fixed-tier Discover — not tavern-bound,
    // so it works even at tier 4). It's tier 6 itself, so it can never find another Joker. Golden
    // Discovers twice. A weak 4/4 body pricing in the card advantage.
    id: 'joker',
    name: 'Mysterious Joker',
    tribe: 'neutral',
    tier: 6,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tier: 5 } }],
    text: '**Battlecry:** Discover a **Tier 5** minion.',
    goldenText: '**Battlecry:** Discover **2 Tier 5** minions.',
  },
  {
    id: 'venom',
    name: 'Venom',
    tribe: 'neutral',
    tier: 3,
    attack: 1,
    health: 1,
    keywords: ['V'],
    effects: [],
    text: '',
  },
  {
    id: 'blaster',
    name: 'Blaster',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleDamageAll', params: { amount: 3 } }],
    text: '**Deathrattle:** deal **3** damage to ALL minions.',
    goldenText: '**Deathrattle:** deal **6** damage to ALL minions.',
  },
  {
    // Anti-defensive tech — its attacks disarm what they hit: the struck enemy loses Taunt (so your board can
    // pick past it next swing) and Rise (so a lethal blow keeps it dead). Ward walls one hit; Flurry means it
    // disarms TWO enemies a turn. The strip resolves in combat via `onAttackStripKeywords` (core), which fires
    // per swing before the damage exchange, so removing Rise this swing means the same hit can finish it.
    id: 'tauntbreaker',
    name: 'Tauntbreaker',
    tribe: 'neutral',
    tier: 4,
    attack: 6,
    health: 4,
    keywords: ['DS', 'W'],
    effects: [{ on: 'onAttack', do: 'onAttackStripKeywords', params: { keywords: ['T', 'R'] } }],
    text: '**Rally:** Remove **Taunt** and **Rise** from the target before striking.',
  },
  {
    // Spell-Discover Battlecry — opens a Discover of three random spells (the normal Discover only offers
    // minions). Resolved in @game/sim's recruit factory `battlecryDiscoverSpell`, which queues the
    // Discover(s) via `queueDiscover` (RunState.discoverQueue). Golden Discovers TWICE; with a Drakko the
    // Drummer out it fires per Battlecry repeat, so Brian + Drakko → 2 spells, golden Brian + Drakko → 4.
    id: 'blackbelt',
    name: 'Black Belt Brian',
    tribe: 'neutral',
    tier: 5,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverSpell' }],
    // Combo: ALSO Discover a minion — queued after the spell Discover(s) (the combo effect runs after playCard's
    // Battlecry, and queueDiscover appends behind the already-open spell Discover). Golden Discovers 2 minions.
    combo: { effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion' }] },
    text: '**Battlecry:** Discover a spell. **Combo:** Discover a minion too.',
    goldenText: '**Battlecry:** Discover **2** spells. **Combo:** Discover **2** minions too.',
  },
  {
    id: 'jenkins',
    name: 'Jenkins & Fi',
    tribe: 'neutral',
    tier: 5,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleDestroyKiller' }],
    text: '**Deathrattle:** destroy the minion that killed this.',
  },
  {
    // End of Turn: conjure a copy of the most recent spell cast this run (golden: 2 copies). A spell engine
    // that snowballs whatever spell you're leaning on.
    id: 'stewardofspells',
    name: 'Steward of Spells',
    tribe: 'neutral',
    tier: 5,
    attack: 3,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'spellCopyRecent' }],
    text: '**End of Turn:** get a copy of the most recent spell cast.',
    goldenText: '**End of Turn:** get **2** copies of the most recent spell cast.',
  },
  {
    // Start of Combat: give the enemy's rightmost minion Taunt (golden: the two rightmost) — force your side
    // to chew through the back line first. A control/tempo tool that reshapes the enemy's block order.
    id: 'arenaheckler',
    name: 'Arena Heckler',
    tribe: 'neutral',
    tier: 4,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scGrantEnemyTaunt' }],
    text: "**Start of Combat:** Give the enemy's rightmost minion **Taunt**.",
    goldenText: "**Start of Combat:** Give the enemy's **two** rightmost minions **Taunt**.",
  },
  {
    // End of Turn: cast Lasso (steal a random tavern minion into hand) via the shared castSpell factory — a
    // repeatable steal engine on a beefy T5 body.
    id: 'ropewrangler',
    name: 'Rope Wrangler',
    tribe: 'neutral',
    tier: 5,
    attack: 5,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'castSpell', params: { spellId: 'lasso' } }],
    text: '**End of Turn:** Cast **Lasso**.',
  },
  {
    // Avenge (4): every 4 friendly deaths, permanently raise your spell power +1 Attack (stat spells give +1
    // more Attack this run). Carried back like the other spell-power sources. A tanky spell-payoff enabler.
    id: 'spellappraiser',
    name: 'Spell Appraiser',
    tribe: 'neutral',
    tier: 4,
    attack: 1,
    health: 10,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantSpellPower', params: { count: 4, attack: 1 } }],
    text: '**Avenge (4):** your Tavern spells have **+1 Attack** this run.',
    goldenText: '**Avenge (4):** your Tavern spells have **+2 Attack** this run.',
  },
  {
    // Battlecry arms the next Tavern spell you cast to resolve twice (golden: three times) — a spell-value
    // burst. Sets a run-state charge (`nextSpellMult`) read by spellCasts and spent on the next real cast;
    // persists across turns until used. Doubles untargeted economy spells too, unlike Yazzus (aimed-only).
    id: 'nimbus',
    name: 'Nimbus',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDoubleNextSpell' }],
    text: '**Battlecry:** your next Tavern spell casts **twice**.',
    goldenText: '**Battlecry:** your next Tavern spell casts **three times**.',
  },
  {
    // Echo Warden: a passive presence special-cased in the combat summon path (simulate's summonMinion) — while
    // it's alive on your board, every combat summon spawns one extra copy (golden = two). Reward-exclusive
    // (Echo Chamber quest), so token:true keeps it out of the shop/pool. No effect entry — the doubling is the
    // engine reading its cardId, like other on-board combat passives.
    id: 'echowarden',
    name: 'Echo Warden',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    token: true,
    effects: [],
    text: 'Your summons trigger **one more time**.',
    goldenText: 'Your summons trigger **two more times**.',
  },
  {
    // Battlecry Discovers a minion from an active tribe with no presence on your board — a splash into a tribe
    // you're not already building. Falls back to any tribe if you somehow control them all. Golden Discovers
    // twice (from the same uncontrolled tribe), via battlecryDiscoverMinion's golden branch.
    id: 'wayfinder',
    name: 'Wayfinder',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 2,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tribe: 'uncontrolled' } }],
    text: "**Battlecry:** Discover a minion from a tribe you don't control.",
  },
  // Spell Drummer removed from the pool 2026-07-08 (owner call — "for now"). The `rallyCastRandomStatSpell`
  // factory is kept registered so re-adding the card is a data-only change.

  // --- Rulebreaker quest rewards (2026-07-08). token: true → reward-only. ---
  {
    // The Pivot Door reward. A board-presence economy aura: while Lazarus is on your board, shop spells cost 1
    // Gold less (handled in the reducer's spell-buy cost, via spellCostReduction). Golden → 2 less.
    id: 'lazarus',
    name: 'Lazarus',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 4,
    keywords: [],
    effects: [],
    text: 'While on your board, **shop spells cost 1 less**.',
    goldenText: 'While on your board, **shop spells cost 2 less**.',
    token: true,
  },
  {
    // Impossible Shop reward. A huge body that Engraves your WHOLE board at Start of Combat (before other SoC
    // effects), so every minion keeps its combat gains for the run.
    id: 'taurustruth',
    name: 'Taurus the Truth Bringer',
    tribe: 'neutral',
    tier: 6,
    attack: 12,
    health: 12,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scEngraveAll' }],
    text: '**Start of Combat:** all your minions are **Engraved**. This triggers first.',
    token: true,
  },
];
