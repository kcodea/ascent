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
    effects: [{ on: 'onPlay', do: 'battlecryBuffOtherTribe', params: { tribe: 'dragon', attack: 2, health: 1 } }],
    text: '**Shout:** give another friendly Dragon **+2/+1**.',
    goldenText: '**Shout:** give another friendly Dragon **+4/+2**.',
  },
  {
    // The tribe's Tier-1 spell payoff: a body that grows every turn you cast, so casting early has a floor
    // even when you have no other Dragon out. Permanent growth (owner ruling 2026-07-24).
    id: 'd2_ashscribe',
    name: 'Ashscribe Whelp',
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
    name: 'Spellkeeper Drake',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastSecondCopyFirst', params: { count: 1 } }],
    text: 'After you cast your **second Shop spell** each turn, get a copy of the first.',
    goldenText: 'After you cast your **second Shop spell** each turn, get **2** copies of the first.',
  },
  {
    // Rally: every time it attacks, it re-fires a friend's Shout. Left-most OTHER Dragon — "other" is in the
    // text, and left-most is board order, so no RNG is consumed.
    id: 'd2_chorus',
    name: 'Chorus Drake',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyTriggerLeftmostTribeShout', params: { tribe: 'dragon' } }],
    text: '**Rally:** trigger your left-most other Dragon’s **Shout**.',
    goldenText: '**Rally:** trigger your left-most other Dragon’s **Shout** twice.',
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
    effects: [{ on: 'startOfCombat', do: 'scTriggerTribeShouts', params: { tribe: 'dragon' } }],
    text: '**Start of Combat:** trigger your Dragons’ **Shouts**.',
    goldenText: '**Start of Combat:** trigger your Dragons’ **Shouts** twice.',
  },
  {
    // The combat spell-supply piece: dying allies feed you copies of your best held spell. Reads the hand
    // snapshot taken at combat start (Vault Curator copies the left-most spell you took INTO the fight).
    id: 'd2_curator',
    name: 'Vault Curator',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeCopyLeftmostHandSpell', params: { count: 4 } }],
    text: '**Avenge (4):** get a copy of the left-most spell in your hand.',
    goldenText: '**Avenge (4):** get **2** copies of the left-most spell in your hand.',
  },
  {
    // Dragon/BEAST: a delayed spell-copier. Its Echo (dying in combat is the usual path) queues a copy of
    // NEXT turn's opening spell — so it pays off after the fight rather than before, unlike the recall line.
    id: 'd2_scalefeather',
    name: 'Scalefeather Drake',
    tribe: 'dragon',
    tribe2: 'beast',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleQueueNextSpellCopy', params: { count: 1 } }],
    text: '**Echo:** get a copy of the first **Shop spell** you cast next turn.',
    goldenText: '**Echo:** get **2** copies of the first **Shop spell** you cast next turn.',
  },
  {
    // Dragon/DEMON, Rise: the tribe's combat payoff — deaths make your SPELLS better for the rest of the run.
    // Routed through `grantSpellPower`, so it emits the `+A/+H Spell Power` narration the replay already rides
    // and the gain reads on the proc rather than at settle.
    id: 'd2_broodlord',
    name: 'Ashen Broodlord',
    tribe: 'dragon',
    tribe2: 'demon',
    tier: 5,
    attack: 6,
    health: 8,
    keywords: ['R'],
    effects: [{ on: 'avenge', do: 'avengeBuffSpellPower', params: { count: 4, attack: 1, health: 1 } }],
    text: '**Rise. Avenge (4):** improve your **Shop spells** by **+1/+1**.',
    goldenText: '**Rise. Avenge (4):** improve your **Shop spells** by **+2/+2**.',
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
    // The top-end recursion payoff: not a COPY to hand but an actual free re-cast, at End of Turn.
    id: 'd2_archivist',
    name: 'Runic Archivist',
    tribe: 'dragon',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnRecastFirstSpell', params: { count: 1 } }],
    text: '**End of Turn:** cast the first **Shop spell** you cast this turn again.',
    goldenText: '**End of Turn:** cast the first **Shop spell** you cast this turn **2 additional** times.',
  },
  {
    // The tribe's spell-supply piece: a Shout that just hands you a spell to fuel the recursion line.
    id: 'd2_chronicler',
    name: 'Hoard Chronicler',
    tribe: 'dragon',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantRandomSpell', params: { count: 1 } }],
    text: '**Shout:** get a random spell.',
    goldenText: '**Shout:** get **2** random spells.',
  },
  {
    // A spell magnet: aim your best spell at it and it resolves twice. Only the FIRST spell each turn, so it
    // rewards picking the right one rather than chaining cheap ones.
    id: 'd2_mirrorwing',
    name: 'Mirrorwing Hatchling',
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
    tier: 5,
    attack: 5,
    health: 8,
    keywords: [],
    // Two hooks for one rule: Shop spells arrive via `spellCastOnThis`, Rubies via `onRubyPlayed` (a Ruby never
    // routes through `castSpell`). Runefire deliberately works with BOTH — it's one of the two spell-reactive
    // Dragons that doesn't say "Shop spell" (owner 2026-07-24).
    effects: [
      { on: 'spellCastOnThis', do: 'onSpellCastOnThisSpreadAdjacent', params: { tribe: 'dragon', count: 1 } },
      { on: 'onRubyPlayed', do: 'onRubyPlayedSpreadAdjacent', params: { tribe: 'dragon', count: 1 } },
    ],
    text: 'The first spell or **Ruby** you cast on this each turn **also casts on adjacent Dragons**.',
    goldenText: 'The first spell or **Ruby** you cast on this each turn casts **twice** on adjacent Dragons.',
  },
  {
    // Two effects, one card: the Shout that pays out, and the cadence that grows it. Rides
    // `battlecryTriggered`, so every Shout FIRE counts (Drakko repeats included) — "Shouts you trigger".
    id: 'd2_scalechanter',
    name: 'Scalechanter',
    tribe: 'dragon',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: [],
    effects: [
      { on: 'onPlay', do: 'battlecryBuffTribeImproving', params: { tribe: 'dragon', attack: 1 } },
      { on: 'battlecryTriggered', do: 'onBattlecryImproveSelf', params: { every: 3, step: 1 } },
    ],
    text: '**Shout:** give your Dragons **+1/+1**. Improve this by **+1/+1** after every **3 Shouts** you trigger.',
    goldenText: '**Shout:** give your Dragons **+2/+2**. Improve this by **+2/+2** after every **3 Shouts** you trigger.',
  },
  {
    // Seeds BOTH halves of the tribe at once — a body to buff and a spell to recur (owner re-spec 2026-07-24:
    // was a Tier-2 Slaughter, now a Tier-4 Shout that grants a minion AND a spell).
    id: 'd2_skald',
    name: 'Traveling Skald',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 5,
    keywords: [],
    effects: [{ on: 'onPlay', do: 'battlecryGrantTribeAndSpell', params: { tribe: 'dragon', tier: 1, count: 1 } }],
    text: '**Shout:** get a random **Tier 1 Dragon** and a random **spell**.',
    goldenText: '**Shout:** get **2** random **Tier 1 Dragons** and **2** random **spells**.',
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
    // Set 1's Karwind pays on Battlecries; the Matriarch is the Attack-only Dragon version, so the tribe has a
    // Shout payoff that isn't a full Karwind. Same `battlecryTriggered` channel.
    id: 'd2_matriarch',
    name: 'Roaring Matriarch',
    tribe: 'dragon',
    tier: 4,
    attack: 4,
    health: 7,
    keywords: [],
    effects: [{ on: 'battlecryTriggered', do: 'onBattlecryBuffTribe', params: { tribe: 'dragon', attack: 2, health: 0 } }],
    text: 'After you play a **Shout** minion, give your Dragons **+2 Attack**.',
    goldenText: 'After you play a **Shout** minion, give your Dragons **+4 Attack**.',
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
