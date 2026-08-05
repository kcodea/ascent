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
    // The tribe's Tier-1 spell payoff: a body that grows every turn you cast, so casting early has a floor
    // even when you have no other Dragon out. Permanent growth (owner ruling 2026-07-24).
    id: 'd2_ashscribe',
    name: 'Ashscribe',
    tribe: 'dragon',
    tier: 1,
    attack: 1,
    health: 3,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastFirstBuffSelf', params: { attack: 2, health: 2 } }],
    text: 'The first time you cast a **Shop spell** each turn, gain **+2/+2**.',
    goldenText: 'The first time you cast a **Shop spell** each turn, gain **+4/+4**.',
  },
  {
    // Rewards casting TWICE in a turn rather than once — the recursion line's "keep going" piece.
    id: 'd2_spellkeeper',
    name: 'Spell Warden',
    tribe: 'dragon',
    tier: 4, // owner balance 2026-08-04: T3 → T4
    attack: 3,
    health: 4,
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
    attack: 7,
    health: 9,
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
    // The tribe's combat headline: one Start of Combat that fires the whole board's Shouts. Pairs with
    // Karwind (also a Dragon) — every trigger procs it, so the two together are the tribe's payoff turn.
    id: 'd2_sovereign',
    name: 'Thunderous Sovereign',
    tribe: 'dragon',
    tier: 6,
    attack: 8,
    health: 8,
    keywords: ['SC'],
    // The improvement is PER-INSTANCE and non-retroactive: it counts only spells cast while THIS body has
    // been on the board (`onSpellCastImproveSummon` ticks `summonBonus`), so a Sovereign bought late doesn't
    // inherit the turn's history. `scBeastAura` spends that accrual as the Start-of-Combat grant — the same
    // pairing Kennelmaster uses, tribe-swapped to Dragons.
    effects: [
      { on: 'startOfCombat', do: 'scBeastAura', params: { tribe: 'dragon', attack: 1, health: 1, stepAttack: 1, stepHealth: 1 } },
      { on: 'spellCast', do: 'onSpellCastImproveSummon', params: { step: 1 } },
    ],
    text: '**Start of Combat:** give your Dragons **+1/+1**. Improves with every Shop spell you cast.',
    goldenText: '**Start of Combat:** give your Dragons **+2/+2**. Improves with every Shop spell you cast.',
  },
  {
    // The combat spell-supply piece: dying allies feed you copies of your best held spell. Reads the hand
    // snapshot taken at combat start (Vault Curator copies the left-most spell you took INTO the fight).
    id: 'd2_curator',
    name: 'Water Dragon',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    // Owner balance 2026-08-04: back to the Vault-Curator copy shape (the factory survived), at Avenge (3) —
    // it copies the LEFT-MOST spell in the hand snapshot taken at combat start; no spell held = clean no-op.
    effects: [{ on: 'avenge', do: 'avengeCopyLeftmostHandSpell', params: { count: 3 } }],
    text: '**Avenge (3):** get a copy of the **left-most Spell** in your hand.',
    goldenText: '**Avenge (3):** get **2** copies of the **left-most Spell** in your hand.',
  },
  {
    // Dragon/BEAST: a delayed spell-copier. Its Echo (dying in combat is the usual path) queues a copy of
    // NEXT turn's opening spell — so it pays off after the fight rather than before, unlike the recall line.
    id: 'd2_scalefeather',
    name: 'Mushy',
    tribe: 'dragon',
    tribe2: 'beast',
    tier: 4,
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
    // Dragon/DEMON. Owner rework 2026-07-31 (second pass): from the capped friendly-Demon consume payoff to a
    // RALLY that casts a Staff of Guel — permanent (the tavern-buy enchant carries out of combat), scaled by
    // the run's spell power, and a real spell cast that feeds Guel / Groveweaver / Runebloom.
    id: 'd2_broodlord',
    name: 'Ashen Broodlord',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 5,
    attack: 6,
    health: 8,
    keywords: ['RL'], // Rally — the badge has to match the trigger
    effects: [{ on: 'onAttack', do: 'rallyCastShopBuffSpell', params: { attack: 2, health: 2 } }],
    text: '**Rally:** cast a **Staff of Guel**.',
    goldenText: '**Rally:** cast **2 Staves of Guel**.',
  },
  {
    // Turns selling into value: the first Dragon you cash out each turn comes back as a fresh copy, so the
    // tribe can cycle bodies without losing them. PLAIN copy — buffs and golden are deliberately not carried.
    id: 'd2_voicekeeper',
    name: 'Voicekeeper',
    tribe: 'dragon',
    tier: 5,
    attack: 5,
    health: 9,
    keywords: [],
    effects: [{ on: 'minionSold', do: 'onMinionSoldCopyFirstOfTribe', params: { tribe: 'dragon', count: 1 } }],
    text: 'Get a **plain copy** of the first Dragon you sell each turn.',
    goldenText: 'Get **2 plain copies** of the first Dragon you sell each turn.',
  },
  {
    id: 'd2_archivist',
    name: 'Runic Archivist',
    tribe: 'dragon',
    tier: 5,
    attack: 5,
    health: 5,
    keywords: [],
    // Owner rework 2026-07-27 — the recast moved to Water Dragon; the Archivist now pays for SELLING. The
    // tally rides on the card (`soldProgress`) and carries round to round.
    effects: [{ on: 'minionSold', do: 'minionSoldGrantSpell', params: { count: 5 } }],
    text: 'After you sell **5 minions**, get a **Shop spell**.',
    goldenText: 'After you sell **5 minions**, get **2 Shop spells**.',
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
    effects: [{ on: 'onPlay', do: 'battlecryGrantRandomSpell', params: { count: 1 } }],
    text: '**Shout:** get a random Shop spell.',
    goldenText: '**Shout:** get **2** random Shop spells.',
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
    // The wide version of Mirrorwing: instead of doubling on itself, it copies the spell onto its Dragon
    // neighbours — so seating matters, and it scales with a built board rather than with one big spell.
    id: 'd2_runefire',
    name: 'Runefire',
    tribe: 'dragon',
    tier: 6,
    attack: 6,
    health: 9,
    keywords: [],
    // Owner rework 2026-07-27 — reuses the same End-of-Turn recast Runic Archivist had (which now reads
    // `lastSpellCastId`), so the two cards share one primitive rather than two near-identical ones.
    effects: [{ on: 'endOfTurn', do: 'endOfTurnRecastFirstSpell', params: { count: 1 } }],
    text: '**End of Turn:** cast the last **Shop spell** you cast this turn again.',
    goldenText: '**End of Turn:** cast the last **Shop spell** you cast this turn **2 additional** times.',
  },
  {
    // Two effects, one card: the Shout that pays out, and the cadence that grows it. Rides
    // `battlecryTriggered`, so every Shout FIRE counts (Drakko repeats included) — "Shouts you trigger".
    id: 'd2_scalechanter',
    name: 'Earthbreaker',
    tribe: 'dragon',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [
      { on: 'spellCast', do: 'spellCastBuffAll', params: { attack: 1, health: 0 } },
    ],
    text: 'Whenever you cast a **Shop spell**, give your minions **+1 Attack**.',
    goldenText: 'Whenever you cast a **Shop spell**, give your minions **+2 Attack**.',
  },
  {
    // Seeds BOTH halves of the tribe at once — a body to buff and a spell to recur (owner re-spec 2026-07-24:
    // was a Tier-2 Slaughter, now a Tier-4 Shout that grants a minion AND a spell).
    id: 'd2_skald',
    name: 'Traveling Skald',
    tribe: 'dragon',
    tier: 2,
    attack: 2,
    health: 4,
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
    attack: 5,
    health: 4,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryCopyCastSpell', params: { which: 'last', count: 1 } }],
    text: '**Shout:** get a copy of the last **Shop spell** you cast this turn.',
    goldenText: '**Shout:** get **2** copies of the last **Shop spell** you cast this turn.',
  },
  {
    // The End-of-Turn half of the same idea — it pays out AFTER the turn's casting is done, so it rewards
    // opening with your best spell rather than saving it.
    id: 'd2_spellvault',
    name: 'Spellvault Drake',
    tribe: 'dragon',
    tier: 5,
    attack: 6,
    health: 7,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCopyCastSpell', params: { which: 'first', count: 1 } }],
    text: '**End of Turn:** get a copy of the first **Shop spell** you cast this turn.',
    goldenText: '**End of Turn:** get **2** copies of the first **Shop spell** you cast this turn.',
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
    // Set 1's Karwind pays on Battlecries; the Matriarch is the Attack-only Dragon version, so the tribe has a
    // Shout payoff that isn't a full Karwind. Same `battlecryTriggered` channel.
    id: 'd2_matriarch',
    name: 'Bathing Matriarch', // renamed 2026-07-29 (owner); id unchanged so saved runs and pool boards still resolve
    tribe: 'dragon',
    tier: 4,
    attack: 2,
    health: 7,
    keywords: [],
    effects: [
      { on: 'battlecryTriggered', do: 'onBattlecryBuffTribeAlternating', params: { tribe: 'dragon', amount: 2 } },
      { on: 'endOfTurn', do: 'endOfTurnAlternateMode' },
    ],
    // The printed stat is filled in live by `alternatingBuffText` — an alternating card must never print a
    // stat it isn't currently giving, so this base text is only the fallback shape.
    text: 'After you play a **Shout** minion, give your Dragons **+2 Attack**. This alternates every turn.',
    goldenText: 'After you play a **Shout** minion, give your Dragons **+4 Attack**. This alternates every turn.',
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
];
