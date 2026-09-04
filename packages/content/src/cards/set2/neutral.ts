import type { CardDef } from '@game/core';

/**
 * Set 2's OWN neutral minions (owner roster 2026-07-25) — the seven that don't already exist in set 1. The other
 * 21 names on that roster are set-1 neutrals carried over unchanged via `SET1_NEUTRALS_IN_SET2` in `sets.ts`.
 *
 * Set-2-only by construction: they live in this file, so they reach the pool through `SETS.set2.own` and are
 * never visible to a set-1 run.
 */
export const SET2_NEUTRAL: CardDef[] = [
  {
    // The spell-power enabler for a spell build, as a Choose One so you commit to the axis you need. Both
    // options are the same factory with mirrored params.
    id: 'n2_spellsword',
    name: 'Coppercoat Spellsword',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Give your Shop spells **+1 Attack**.',
        goldenText: 'Give your Shop spells **+2 Attack**.',
        effects: [{ on: 'onPlay', do: 'battlecryGrantSpellPowerRun', params: { attack: 1, health: 0 } }] },
      { text: 'Give your Shop spells **+1 Health**.',
        goldenText: 'Give your Shop spells **+2 Health**.',
        effects: [{ on: 'onPlay', do: 'battlecryGrantSpellPowerRun', params: { attack: 0, health: 1 } }] },
    ],
    // Phrased like the set's other Choose Ones: no "— Shout" qualifier. It's a legitimate KEYWORD rather than a
    // flavour name, but the dash form reads the same as the flavour labels the owner had stripped, and a Choose
    // One already implies it resolves on play.
    text: '**Choose One:** give your Shop spells **+1 Attack** or **+1 Health**.',
    goldenText: '**Choose One:** give your Shop spells **+2 Attack** or **+2 Health**.',
  },
  {
    // A cadence engine that rewards board ARRANGEMENT: what it copies is whatever you seat to its left.
    id: 'n2_bellringer',
    name: 'Bellringer Voss',
    tribe: 'neutral',
    tier: 4, // owner balance 2026-08-18: T5 → T4
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCopyNeighbour', params: { every: 2 } }],
    text: '**Every 2 turns:** get a plain copy of the minion to the **left**.',
    goldenText: '**Every 2 turns:** get a plain copy of **adjacent** minions.',
  },
  {
    // CONDUCTOR — the neutral Squirl Scout (owner 2026-08-21): a positional Shout whose grant SNOWBALLS
    // run-wide. Every Conductor Shout raises `conductorBuff` by one weighted step (×2 gilded, ×2 Mastery),
    // and the grant to the two adjacent minions is the accumulated total — so the first play gives +2/+3,
    // the next +4/+6, and so on across the run. Live grant surfaces via cardText's conductorText.
    id: 'n2_conductor',
    name: 'Conductor',
    tribe: 'neutral',
    tier: 4,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryConductorAdjacent', params: { attack: 2, health: 3 } }],
    text: '**Shout:** give adjacent minions **+2/+3**. Every Conductor played improves this by **+2/+3**.',
    goldenText: '**Shout:** give adjacent minions **+4/+6**. Every Conductor played improves this by **+4/+6**.',
  },
  {
    // Echo: its death hands Ward to two survivors — a body that trades early and leaves the line tougher than
    // it found it (owner change 2026-07-25, replacing a positional Start of Combat).
    id: 'n2_lastlight',
    name: 'Lastlight',
    tribe: 'neutral',
    tier: 3, // owner balance 2026-08-18: T4 → T3
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleGrantWardRandom', params: { count: 2 } }],
    text: '**Echo:** give **2** friendly minions **Ward**.',
    goldenText: '**Echo:** give **4** friendly minions **Ward**.',
  },
  {
    // Owner rework 2026-07-29: was Pouchpincher (T2 4/2, "Shout: get a Gold Pouch"). The roster's Cheap Date is a
    // different card entirely — a T1 body whose value is in SELLING it, so it rewards churning the early shop
    // rather than holding a board slot. `onSell` fires when THIS minion is sold; `battlecryGainRandomMinion` is
    // trigger-agnostic, so no new factory is needed.
    id: 'k_pouchpincher',
    name: 'Cheap Date',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onSell', do: 'battlecryGainRandomMinion', params: { tier: 1, count: 1 } }],
    text: 'When you **sell** this, get a random **Tier 1** minion.',
    goldenText: 'When you **sell** this, get **2** random **Tier 1** minions.',
  },
  {
    // Owner add 2026-07-28 — the set's ALL-TYPE minion (Taurus was pulled from set 2 earlier in this batch, so
    // the slot was empty). `universalTribe` makes it count as every tribe: it takes buffs from every tribal
    // source, and it is itself "a minion of every type", which is why it always collects its own Rally payout.
    //
    // Tier 6 / 4-5 stats are MY call, not the owner's — the spec gave the effect only. It sits where the other
    // build-around all-type bodies do, with a body small enough that the permanent Rally scaling is the reason
    // to play it. Flag for tuning.
    id: 'n2_paragon',
    name: 'Paragon',
    tribe: 'neutral',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    universalTribe: true,
    effects: [{ on: 'onAttack', do: 'onRallyBuffOnePerTribe', params: { attack: 4, health: 4 } }],
    text: 'Whenever you trigger a **Rally**, give a minion of **every type** **+4/+4** permanently.',
    goldenText: 'Whenever you trigger a **Rally**, give a minion of **every type** **+8/+8** permanently.',
  },
  {
    // Owner add 2026-08-18: a cheaper, lower-tier Paragon — an all-type Rally payoff that spreads a buff over
    // one minion of every type. Same `onRallyBuffOnePerTribe` factory (gild doubles).
    // Owner rebalance 2026-09-01: +2/+3 → +3/+3, and the buff is no longer PERMANENT (`permanent: false`) —
    // a bigger swing that lasts the fight, which is what separates it from Paragon at T3 rather than it being
    // simply a smaller Paragon.
    // Owner fix 2026-09-03: `selfOnly: true` — Standard Bearer prints "**Rally:**" (its OWN rally), so it must
    // NOT fire as a watcher on every ally's Rally the way Paragon does. Without the flag the shared
    // `onRallyBuffOnePerTribe` watcher dispatch buffed on every friendly Rally attack (owner bug report).
    id: 'n2_standardbearer',
    name: 'Standard Bearer',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: ['RL'],
    universalTribe: true,
    effects: [{ on: 'onAttack', do: 'onRallyBuffOnePerTribe', params: { attack: 3, health: 3, permanent: false, selfOnly: true } }],
    text: '**Rally:** give a minion of **each type** **+3/+3**.',
    goldenText: '**Rally:** give a minion of **each type** **+6/+6**.',
  },
  {
    // Owner roster addition 2026-07-29 (un-archived + T6 → T5, owner 2026-08-18). Two branches, deliberately
    // different SHAPES rather than two stat buffs: branch A pays off the spell/Dragon half of set 2 (per-cast,
    // per-type spread), branch B pays off a wide aggressive board (per-attack, board-wide).
    id: 'n2_fatecarver',
    name: 'Fatecarver',
    tribe: 'neutral',
    tier: 5, // owner balance 2026-08-18: T6 → T5
    attack: 8,
    health: 9,
    keywords: [],
    // Both branches are PERSISTENT, so they are printed effects gated on `option` rather than
    // `chooseOne[].effects` — the latter fires once at pick time and never again (see Malphas).
    effects: [
      { on: 'spellCast', do: 'onSpellCastBuffOnePerTribe', params: { option: 0, attack: 2, health: 2 } },
      // `spellId` is required by the content validator — it is what makes the cast a REAL Growth cast (Guel and the
      // spell counters see it), not just a buff wearing Growth's name.
      { on: 'onAttack', do: 'onAllyAttackCastGrowth', params: { option: 1, attack: 1, health: 1, spellId: 'growth' } },
    ],
    chooseOne: [
      { text: 'When you cast a **Shop spell**, give **1 minion of each type +2/+2**.', goldenText: 'When you cast a **Shop spell**, give **1 minion of each type +4/+4**.', effects: [] },
      { text: 'When a friendly minion attacks, cast **Growth**.', goldenText: 'When a friendly minion attacks, cast **Growth twice**.', effects: [] },
    ],
    text: '**Choose One:** when you cast a **Shop spell**, give **1 minion of each type +2/+2**, or cast **Growth** when a friendly minion attacks.',
    goldenText: '**Choose One:** when you cast a **Shop spell**, give **1 minion of each type +4/+4**, or cast **Growth twice** when a friendly minion attacks.',
  },
  // ── RUNE-ONLY (Source: Rune), owner batch 2026-08-20 ──────────────────────────────────────────────────
  // Every card in this block is `token: true` for the same reason `dw_baal` is: the roster marks them
  // Source = Rune, so they ride the set pool for resolution (an id must resolve) but are never drawable.
  {
    // DEEPWATER CHEF — one card that hands you the whole curve at once: a T1 body to combine, a T3 to play
    // now, a T5 you probably can't afford yet. Three separate `battlecryGainRandomMinion` fires rather than
    // one factory taking a tier LIST: the primitive already pins an exact tier, and three data rows say
    // exactly what happens, in the order it happens.
    id: 'n2_deepchef',
    name: 'Deepwater Chef',
    tribe: 'neutral',
    tier: 5,
    attack: 4,
    health: 3,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [
      { on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 1, count: 1 } },
      { on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 3, count: 1 } },
      { on: 'onPlay', do: 'battlecryGainRandomMinion', params: { tier: 5, count: 1 } },
    ],
    text: '**Shout:** get a random **Tier 1**, **Tier 3** and **Tier 5** minion.',
    // Golden doubles the COUNT at each tier (`count × gold`), which is what the factory does — six cards, not
    // three bigger ones.
    goldenText: '**Shout:** get **2** random **Tier 1**, **Tier 3** and **Tier 5** minions.',
  },
  {
    // ANCIENT WANDERER — a 1/1 that is worth exactly what your run has cost you. The stat line IS the card, so
    // it prints its CURRENT bonus on every surface (`goldSpentScalerValue` in @game/sim, `ancientWandererText`
    // in the UI) rather than the rate alone — the hard live-text rule.
    //
    // It reads the run TOTAL, not the spend it witnessed: buying one on turn 12 is paid for the whole run
    // behind it. That is why `goldSpentScaleSelf` is a SYNCED enchant rather than a `goldSpent` threshold.
    id: 'n2_wanderer',
    name: 'Ancient Wanderer',
    tribe: 'mech',
    tier: 5,
    attack: 1,
    health: 1,
    keywords: [],
    token: true, // forge-only: Source = Rune
    // `passive` — declared but never dispatched through the bus (Deepdelve Paragon's contract):
    // `syncGoldSpentScalers` reads the effect off the card at the two moments its value can move.
    effects: [{ on: 'passive', do: 'goldSpentScaleSelf', params: { per: 3, attack: 1, health: 1 } }],
    text: 'Has **+1/+1** for every **3 Gold** you have spent this run.',
    goldenText: 'Has **+2/+2** for every **3 Gold** you have spent this run.',
  },
  {
    // CLOCKWORK ASSISTANT — a peek one rung above where you are. Reuses `battlecryDiscoverMinion` through the
    // new `tierOffset` param, so it inherits the exclude-self rule, the Drakko stacking and the Discover
    // queueing for free. The offset clamps to the RUN's ceiling, so a non-Summit board tops out at Tier 6
    // instead of promising a Tier 7 the run can never reach.
    id: 'n2_clockwork',
    name: 'Clockwork Assistant',
    tribe: 'mech',
    tier: 4,
    attack: 3,
    health: 3,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onPlay', do: 'battlecryDiscoverMinion', params: { tierOffset: 1 } }],
    text: '**Shout: Discover** a minion from **one Tier above** your Shop Tier.',
    goldenText: '**Shout: Discover 2** minions from **one Tier above** your Shop Tier.',
  },
  {
    // MUCKSLINGER — the Shout tutor. `filter: 'shout'` on the shared conjure primitive; a Shout minion is one
    // with a real `onPlay` (`hasBattlecry`), the same definition the rune rewards' `randomFilter` uses.
    id: 'n2_muckslinger',
    name: 'Muckslinger',
    tribe: 'beast',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onPlay', do: 'battlecryGainRandomMinion', params: { filter: 'shout', count: 1 } }],
    text: '**Shout:** get a random **Shout** minion.',
    goldenText: '**Shout:** get **2** random **Shout** minions.',
  },
  {
    // TRAVELING SALESMAN — a sell payoff aimed at the triple you are one copy short of. The Discover pool is
    // built from the board at sell time, so it is a different offer every turn; a Golden body already counts
    // as three copies and is therefore never "exactly one".
    id: 'n2_salesman',
    name: 'Traveling Salesman',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 4,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onSell', do: 'onSellDiscoverSingleton' }],
    text: 'When you **sell** this, **Discover** a minion you control **exactly one** copy of.',
    goldenText: 'When you **sell** this, **Discover 2** minions you control **exactly one** copy of.',
  },
  {
    // NINEFOLD BROKER — nine is the card. A big body whose real cost is that its engine RUNS OUT: the charge
    // counter is per-instance and per-run (it rides `buyTick`), so selling and re-buying does not refill it,
    // and a second Broker brings its own nine.
    id: 'n2_ninefold',
    name: 'Ninefold Broker',
    tribe: 'neutral',
    tier: 6,
    attack: 9,
    health: 9,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onBuy', do: 'onBuyGrantSpellSameTier', params: { charges: 9, count: 1 } }],
    text: 'After you buy a minion, get a random **Shop spell** of the **same Tier**. **(9 times)**',
    // Golden doubles the CHARGES, not the payout — nine is the identity, so the gild buys more of it.
    goldenText: 'After you buy a minion, get a random **Shop spell** of the **same Tier**. **(18 times)**',
  },
  {
    // ECHO MIMIC — a combat body that gets better the worse the fight goes. Each friendly death grafts that
    // minion's Echo onto the Mimic for the rest of the combat, so by the time it dies it can be carrying a
    // whole graveyard. Nothing carries back: "this combat" is the balance lever.
    id: 'n2_echomimic',
    name: 'Echo Mimic',
    tribe: 'neutral',
    tier: 5,
    attack: 4,
    health: 7,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onDeath', do: 'onFriendDeathGainEcho' }],
    text: 'Whenever another friendly minion dies, gain its **Echo** for the rest of combat.',
    goldenText: 'Whenever another friendly minion dies, gain its **Echo twice** for the rest of combat.',
  },
  {
    // MUSTER GENERAL — an Avenge that builds an army AND makes the army better. The improvement is permanent
    // (it rides `summonBonus`, carried back at settle), so the Troopers are 1/1 in the first fight and 4/4 by
    // the late course. Its printed "1/1 Trooper" is therefore a LIVE value — `musterTrooperText` folds the
    // current line into every surface (the hard live-text rule).
    id: 'n2_muster',
    name: 'Muster General',
    tribe: 'dwarf',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'avenge', do: 'avengeSummonAttackImproving', params: { count: 3, cardId: 'n2_trooper', step: 1 } }],
    text: '**Avenge (3):** summon a **1/1 Trooper** that attacks immediately, then improve future Troopers by **+1/+1** permanently.',
    // Gilded: the Trooper is summoned GOLDEN (the summon path's `golden` flag) and the improvement steps twice.
    goldenText: '**Avenge (3):** summon a **Gilded 1/1 Trooper** that attacks immediately, then improve future Troopers by **+2/+2** permanently.',
  },
  {
    // EVOLVING ABOMINATION — the batch's ALL-TYPE body. `universalTribe` IS the tribal line: the ALL pill on
    // the plate already says "counts as every type", so the text does NOT repeat it (owner ruling 2026-08-20,
    // the same sweep that stripped that clause from every other universal card). Its text is the Rally, full
    // stop.
    //
    // Doubling COMPOUNDS — 6/6 → 12/12 → 24/24 — and it doubles whatever it has been buffed to, so it is a
    // multiplier on your whole investment rather than a flat grant. The per-combat cap is what keeps that
    // honest.
    id: 'n2_abomination',
    name: 'Evolving Abomination',
    tribe: 'neutral',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: ['RL'],
    universalTribe: true,
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'onAttack', do: 'rallyDoubleSelf', params: { max: 2 } }],
    text: "**Rally:** double this minion's stats. **(Twice per combat)**",
    // Golden raises the CAP rather than the multiplier — doubling harder isn't a thing.
    goldenText: "**Rally:** double this minion's stats. **(4 times per combat)**",
  },
  {
    // YIRIN'S REFLECTOR — a hero-granted TOKEN, never drawable. `token: true` keeps it out of every shop pool
    // and Discover (the same treatment Chaos's Symbiotic Attachment gets); the only way to get one is to start
    // a run as Yirin. Its effect is Runefire's shape with a seeded random friendly instead of the neighbours.
    id: 'n2_reflector',
    name: 'Reflector',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    token: true,
    effects: [
      { on: 'spellCastOnThis', do: 'onSpellCastOnThisSpreadRandom', params: { count: 1 } },
      { on: 'onRubyPlayed', do: 'onRubyPlayedSpreadRandom', params: { count: 1 } },
    ],
    // The text names RUBIES as well as spells, because the card reacts to both and they SHARE one
    // once-per-turn allowance (see the two effects above, and the `spells + rubies !== 1` guard both
    // factories use). Player report 224af0ee hit exactly that gap: two Rubies had landed on this Reflector
    // that turn, so a spell cast on it afterwards did nothing — behaving correctly, and unexplainable from a
    // card that only mentioned spells. A Ruby is not a Shop Spell, so "Spells" never covered it.
    text: 'Spells and **Rubies** cast on this **also cast** on a random friendly minion. **(Once per turn)**',
    goldenText: 'Spells and **Rubies** cast on this **also cast twice** on a random friendly minion. **(Once per turn)**',
  },
];