import type { CardDef } from '@game/core';

/**
 * Dragons (set 2) — the SPELL-RECURSION tribe. Where set 1's Dragons scaled off Battlecries, these scale off
 * SPELLS: copying the ones you already cast, re-casting them, and paying you for casting early in a turn.
 *
 * The engine already tracks what this tribe needs — `firstSpellThisTurnId` and `lastSpellCastId` are recorded
 * by `castSpell` for the Runes, `spellsThisTurn` counts them, and `nextSpellExtraCasts` banks extra casts — so
 * most of the line reads existing state rather than adding bookkeeping.
 *
 * The full 21-card roster is in (20 here + Karwind, carried from set 1). Every mechanic the tribe needed
 * is now a real primitive — spell copy/recast, combat Shout re-triggering, the umbrella cast meter, a spend-
 * and-reset amplifier, cross-turn pending copies, and the two persistent Choose-One modes.
 *
 * (Karwind is a set-1 Dragon carried into this set — see `SET1_DRAGONS_IN_SET2` in `sets.ts`. It was re-spec'd
 * to Tier 6 4/12 for this tribe on the owner's call, which changes it in set 1 too.)
 */
export const SET2_DRAGONS: CardDef[] = [
  {
    // Tier-1 tempo: a Shout that pushes another Dragon, so the tribe has an early curve piece that isn't
    // spell-dependent. Buffs ONE other friendly Dragon (never itself), left-most for determinism.
    id: 'd2_embermouth',
    name: 'Embermouth Whelp',
    tribe: 'dragon',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffSelf', params: { attack: 1, health: 1 } }],
    text: 'After you trigger a **Shout**, gain **+1/+1**.',
    // The golden text was a leftover from the card's old buff-another-Dragon Shout shape.
    goldenText: 'After you trigger a **Shout**, gain **+2/+2**.',
  },
  {
    // Rewards casting TWICE in a turn rather than once — the recursion line's "keep going" piece.
    id: 'd2_spellkeeper',
    name: 'Spell Warden',
    tribe: 'dragon',
    tier: 5, // owner balance 2026-08-11: T4 → T5
    attack: 7,
    health: 3,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastSecondCopyFirst', params: { count: 1 } }],
    text: 'After you cast your **second Shop spell** each turn, get a copy of the first.',
    goldenText: 'After you cast your **second Shop spell** each turn, get **2** copies of the first.',
  },
  {
    // Rally: every time it attacks, it re-fires a Dragon's Shout. Left-most Dragon (owner text change
    // 2026-07-25 dropped "other"); left-most is board order, so no RNG is consumed.
    id: 'd2_chorus',
    name: 'Chorus Drake',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGrantSpellPower', params: { attack: 0, health: 1 } }],
    text: '**Rally:** your **Shop Spells** gain **+1 Health**.',
    goldenText: '**Rally:** your **Shop Spells** gain **+2 Health**.',
  },
  {
    // A rechargeable spell amplifier: it doubles your opening spell, then goes quiet until you trigger 3
    // Shouts — so it pulls the tribe's two halves (spells and Shouts) into one card.
    id: 'd2_grimoire',
    name: 'Living Grimoire',
    tribe: 'dragon',
    tier: 6,
    attack: 5,
    health: 10,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'battlecryArmGrimoire' },
      { on: 'battlecryTriggered', do: 'onBattlecryRearmGrimoire', params: { every: 3 } },
    ],
    // Deliberately says "spell", NOT "Shop spell": a RUBY also spends the Grimoire charge
    // (`consumeGrimoireCharge` on the ruby path), so this really is the inclusive umbrella. Pinned by
    // set2RubyExclusion.test.ts so a wording sweep can't narrow it — which is exactly what happened on
    // 2026-07-28 before the test caught it.
    text: 'The first spell you cast each turn **casts twice**. Once used, trigger **3 Shouts** to reset this.',
    goldenText: 'The first spell you cast each turn **casts 3 times**. Once used, trigger **3 Shouts** to reset this.',
  },
  {
    // Dragon/BEAST: a delayed spell-copier. Its Echo (dying in combat is the usual path) queues a copy of
    // NEXT turn's opening spell — so it pays off after the fight rather than before, unlike the recall line.
    id: 'd2_scalefeather',
    name: 'Mushy',
    tribe: 'dragon',
    tier: 5, // owner balance 2026-08-18: T4 → T5
    attack: 4,
    health: 6,
    keywords: [],
    // Shout AND Echo, so it pays on both ends. The two halves use different factories on purpose: the Shout is
    // a recruit grant (`spellId`), the Echo a combat one (`cardId`) — the keys differ per factory and mixing
    // them up silently grants nothing (the Big Huggies bug, 2026-07-25).
    effects: [
      { on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'growth', count: 1 } },
      { on: 'onDeath', do: 'deathrattleGrantSpell', params: { cardId: 'growth' } },
    ],
    text: '**Shout and Echo:** get a **Growth**.',
    goldenText: '**Shout and Echo:** get **2 Growths**.',
  },
  {
    // Turns selling into value: the first Dragon you cash out each turn comes back as a fresh copy, so the
    // tribe can cycle bodies without losing them. PLAIN copy — buffs and golden are deliberately not carried.
    id: 'd2_voicekeeper',
    name: 'Voicekeeper',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'minionSold', do: 'onMinionSoldCopyFirstOfTribe', params: { tribe: 'dragon', count: 1 } }],
    text: 'Get a **plain copy** of the first Dragon you sell each turn.',
    goldenText: 'Get **2 plain copies** of the first Dragon you sell each turn.',
  },
  {
    // The tribe's spell-supply piece: a Shout that just hands you a spell to fuel the recursion line.
    id: 'd2_chronicler',
    name: 'Scalefeather',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantRandomSpell', params: { count: 1, tier: 1 } }],
    text: '**Shout:** get a random **Tier 1** Spell.',
    goldenText: '**Shout:** get **2** random **Tier 1** Spells.',
  },
  {
    // A spell magnet: aim your best spell at it and it resolves twice. Only the FIRST spell each turn, so it
    // rewards picking the right one rather than chaining cheap ones.
    id: 'd2_mirrorwing',
    name: 'Mirrorwing',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'spellCastOnThis', do: 'onSpellCastOnThisRecast', params: { count: 1 } }],
    text: 'The first **Shop spell** you cast on this each turn **casts again**.',
    goldenText: 'The first **Shop spell** you cast on this each turn casts **2 additional** times.',
  },
  {
    // Two effects, one card: the Shout that pays out, and the cadence that grows it. Rides
    // `battlecryTriggered`, so every Shout FIRE counts (Drakko repeats included) — "Shouts you trigger".
    id: 'd2_scalechanter',
    name: 'Earthbreaker',
    tribe: 'dragon',
    tier: 4, // owner balance 2026-08-18: T3 → T4
    attack: 4,
    health: 3,
    keywords: [],
    // Owner rework 2026-08-18: the buff is now Dragon-scoped and grants Health too (+2/+3), via the `tribe`
    // filter on `spellCastBuffAll`.
    effects: [
      { on: 'spellCast', do: 'spellCastBuffAll', params: { tribe: 'dragon', attack: 2, health: 3 } },
    ],
    text: 'Whenever you cast a **Shop spell**, give your **Dragons +2/+3**.',
    goldenText: 'Whenever you cast a **Shop spell**, give your **Dragons +4/+6**.',
  },
  {
    // Seeds BOTH halves of the tribe at once — a body to buff and a spell to recur (owner re-spec 2026-07-24:
    // was a Tier-2 Slaughter, now a Tier-4 Shout that grants a minion AND a spell).
    id: 'd2_skald',
    name: 'Traveling Skald',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onTribeAttackBuffAttacker', params: { tribe: 'dragon', attack: 2, health: 1 } }],
    text: 'When **another** friendly **Dragon** attacks, give it **+2/+1**.',
    goldenText: 'When **another** friendly **Dragon** attacks, give it **+4/+2**.',
  },
  {
    // Recursion, on tempo: replay whatever you just cast. Reads `lastSpellCastId` (already tracked for the
    // Steward of Spells rune), so casting BEFORE playing this is the whole skill.
    id: 'd2_recaller',
    name: 'Recaller',
    tribe: 'dragon',
    tier: 4,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryCopyCastSpell', params: { which: 'last', count: 1 } }],
    text: '**Shout:** get a copy of the last **Shop spell** you cast this turn.',
    goldenText: '**Shout:** get **2** copies of the last **Shop spell** you cast this turn.',
  },
  {
    // A Shout that FETCHES another Shout — the tribe's engine piece for a Shout-heavy build. "Shout Dragon"
    // means a Dragon with an `onPlay`, which deliberately excludes payoff cards like Karwind that only WATCH
    // Shouts without having one (owner ruling 2026-07-25). Tier-capped by the shop like every other random get.
    id: 'd2_blazingkeeper',
    name: 'Commander Warpath', // renamed 2026-07-29 (owner); id unchanged so saved runs and pool boards still resolve
    tribe: 'dragon',
    tier: 5,
    attack: 5,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantMinion', params: { cardId: 'd2_broodwhelp', count: 1 } }],
    text: '**Shout:** get a **Brood Whelp**.',
    goldenText: '**Shout:** get **2 Brood Whelps**.',
  },
  {
    // The tribe capstone: a Choose-One that installs a permanent global mode, and Gilds into BOTH. Chorus
    // pumps the Shout half of the tribe; Spellweave pumps the spell half. Every other Dragon feeds one or the
    // other, so Orivax is the payoff either build was climbing toward.
    id: 'd2_orivax',
    name: 'Orivax, the Spellchoir',
    tribe: 'dragon',
    tier: 7,
    attack: 10,
    health: 14,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Your **Shouts** trigger an additional time.', effects: [{ on: 'onPlay', do: 'battlecryGrantShoutExtra', params: { extra: 1 } }] },
      { text: 'Your first **Shop spell** each turn casts **3 times**.', effects: [{ on: 'onPlay', do: 'battlecryGrantFirstSpellMult', params: { mult: 3 } }] },
    ],
    chooseBothWhenGolden: true,
    // No flavour names (owner 2026-07-25) — its OPTIONS never carried them, but the combined card text did.
    text: '**Choose One:** your **Shouts** trigger an additional time, or your first **Shop spell** each turn casts **3 times**.',
    goldenText: '**Choose One:** gain **both** — your **Shouts** trigger an additional time, and your first **Shop spell** each turn casts **3 times**.',
  },
  {
    // Owner add 2026-08-11 (renamed Herzog → Vaultkeeper 2026-08-12; the id stays — saved runs store ids). A
    // Dragon-tempo payoff whose per-play grant SCALES RETROACTIVELY with your lifetime Shop-Spell count: +1/+1
    // per Dragon at base, climbing +1 every 4 SPELLS cast this run (Shop Spells + Rubies — owner 2026-08-15). Live text folds in the current grant.
    id: 'd2_herzog',
    name: 'Vaultkeeper',
    tribe: 'dragon',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'onTribePlayedBuffSelfPerSpell', params: { tribe: 'dragon', base: 2, per: 4 } }],
    text: 'Gain **+2/+2** whenever you play a **Dragon**. Improves **+2/+2** for every **4 spells** cast this game.',
    goldenText: 'Gain **+4/+4** whenever you play a **Dragon**. Improves **+4/+4** for every **4 spells** cast this game.',
  },
  {
    // Owner add 2026-08-14, respec 2026-08-17. The Dragon line's PERMANENCE card: a warded T4 whose Start of
    // Combat buffs the whole flight, and whose Engrave is a LIVE ADJACENCY AURA rather than a one-shot grant.
    // The aura is evaluated in `ctx.buff` at the moment stats are gained (see `auraEngraved` in simulate.ts),
    // which is what makes "while alive and adjacent" literally true: a neighbour keeps the gains it made
    // beside a living Transcendant and nothing it gains after Transcendant dies. Its own +3/+3 is engraved for
    // its neighbours for free, since Transcendant is trivially alive when its own SoC resolves. Every other
    // Dragon still gets the +3/+3, it just doesn't keep it. Golden doubles the buff, not the Engrave.
    id: 'd2_transcendence',
    name: 'Transcendant',
    tribe: 'dragon',
    tier: 4,
    attack: 3,
    health: 4,
    // Owner rework 2026-08-18: the Start-of-Combat buff (and the `SC` pill) are GONE — it is now purely a warded
    // Engrave anchor. The aura is a LIVE ADJACENCY read in `ctx.buff` (`nb.cardId === 'd2_transcendence'` in
    // simulate.ts), independent of any effect or the `SC` keyword, so removing the effect leaves the Engrave intact.
    keywords: ['DS'], // Ward
    effects: [],
    text: '**Ward.** Adjacent **Dragons** are **Engraved**.',
    goldenText: '**Ward.** Adjacent **Dragons** are **Engraved** and gain **2× stats** in combat.',
  },

  // ── Owner add 2026-08-18: eight new Dragons (Shout-trigger + spell-cast lines) ────────────────────────────
  {
    // The Shout-tribe capstone on a Rally: every swing re-fires your OTHER Dragons' Shouts through the shared
    // combat re-trigger (so every "after you trigger a Shout" watcher — Karwind, Bane, Embermouth — procs).
    // Golden re-triggers each Shout twice.
    id: 'd2_embercrest',
    name: 'Embercrest',
    tribe: 'dragon',
    tier: 6,
    attack: 8,
    health: 9,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyTriggerTribeShouts', params: { tribe: 'dragon' } }],
    text: '**Rally:** trigger your **Dragon** Shouts.',
    goldenText: '**Rally:** trigger your **Dragon** Shouts **twice**.',
  },
  {
    // A cheap early Shout that pushes the flight — includes itself (owner default for "your Dragons").
    id: 'd2_broodfire',
    name: 'Broodfire',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 2 } }],
    text: '**Shout:** give your **Dragons +2/+2**.',
    goldenText: '**Shout:** give your **Dragons +4/+4**.',
  },
  {
    // Tier-1 Rally tempo: grows itself every swing. Golden doubles the step.
    id: 'd2_cinderchef',
    name: 'Cinderchef',
    tribe: 'dragon',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyBuffSelf', params: { attack: 1, health: 1 } }],
    text: '**Rally:** gain **+1/+1**.',
    goldenText: '**Rally:** gain **+2/+2**.',
  },
  {
    // A Shout-fetcher on a Rally: each swing hands you a random SHOUT minion (a minion with a real Shout),
    // tier-capped by the pool. Golden gets two.
    id: 'd2_roarcollector',
    name: 'Roarcollector',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGrantRandomShoutMinion', params: {} }],
    text: '**Rally:** get a random **Shout** minion.',
    goldenText: '**Rally:** get **2** random **Shout** minions.',
  },
  {
    // Casts a REAL Dragonflame on each swing (in-combat, fires spell watchers). Golden casts it twice. Names
    // the spell and lets its hover-preview show the live value (sanctioned exception, owner ruling 2026-07-15).
    id: 'd2_flamebeat',
    name: 'Flamebeat Drake',
    tribe: 'dragon',
    tier: 5,
    attack: 6,
    health: 5,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'sp_dragonflame' } }],
    text: '**Rally:** cast **Dragonflame**.',
    goldenText: '**Rally:** cast **Dragonflame** twice.',
  },
  {
    // Turns a sale into a spell for the recursion line. Uses the same random-spell grant as Scalefeather, on the
    // self-sell trigger. Golden gets two.
    id: 'd2_riverdrake',
    name: 'River Drake',
    tribe: 'dragon',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onSell', do: 'battlecryGrantRandomSpell', params: { count: 1 } }],
    text: 'When you **sell** this, get a **random Spell**.',
    goldenText: 'When you **sell** this, get **2 random Spells**.',
  },
  {
    // A board-wide Dragonflame engine: every Dragon's swing (its own included) casts Dragonflame. Golden casts
    // twice per attack.
    id: 'd2_warflame',
    name: 'Warflame',
    tribe: 'dragon',
    tier: 6,
    attack: 5,
    health: 8,
    keywords: ['CR'],
    critChance: 0.5,
    effects: [{ on: 'onAttack', do: 'onTribeAttackCastNamedSpell', params: { tribe: 'dragon', spellId: 'sp_dragonflame' } }],
    text: '**Critical Strike (50%).** When a friendly **Dragon** attacks, cast **Dragonflame**.',
    goldenText: '**Critical Strike (50%).** When a friendly **Dragon** attacks, cast **Dragonflame** twice.',
  },
  {
    // Owner add 2026-08-19. Dual-type Dragon/Demon: a spell-power engine — every shop turn opens with a Quick
    // Study in hand. Reuses the trigger-agnostic `battlecryGrantSpell` on the `startOfTurn` hook; golden two.
    id: 'd2_felconjurer',
    name: 'Fel Conjurer',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'startOfTurn', do: 'battlecryGrantSpell', params: { spellId: 'quickstudy', count: 1 } }],
    text: '**Start of Turn:** get a **Quick Study**.',
    goldenText: '**Start of Turn:** get **2 Quick Studies**.',
  },
  {
    // Seeds the Flutter combo — hand a Flutter to pump a Dragon into a Flurry threat. Golden gets two.
    id: 'd2_flutterdrake',
    name: 'Flutterdrake',
    tribe: 'dragon',
    tier: 5,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantSpell', params: { spellId: 'sp_flutter', count: 1 } }],
    text: '**Shout:** get a **Flutter**.',
    goldenText: '**Shout:** get **2 Flutters**.',
  },
];
