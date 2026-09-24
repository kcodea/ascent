import type { CardDef } from '@game/core';

/**
 * Beasts (set 2) — the tribe brought forward from set 1 with a spell/summon-synergy tilt (owner roster
 * 2026-07-24). Several set-1 Beasts carry over unchanged (see `SET1_BEASTS_IN_SET2` in `sets.ts`); the cards
 * authored HERE are the set-2 additions.
 *
 * The full 21-card roster is in: 15 authored here plus 6 carried from set 1 (Badgington, Sea Urchin, Sporebat,
 * Void Panther, and the re-spec'd Kennelmaster + Runic Beetle — see `SET1_BEASTS_IN_SET2` in `sets.ts`).
 */
export const SET2_BEASTS: CardDef[] = [
  {
    // The tribe capstone: a Choose-One that permanently multiplies one HALF of the Beast trigger suite. Hunt
    // pumps the aggressive line (Rally + Slaughter), Ritual the Echo line — so it rewards whichever build you
    // actually assembled. Gilded doubles the chosen mode (2 additional triggers), NOT gain-both (owner
    // 2026-07-24) — which is why it does not set `chooseBothWhenGolden` the way Orivax does.
    id: 'b2_elderhorn',
    name: 'Elderhorn',
    tribe: 'beast',
    tier: 7,
    attack: 8,
    health: 10,
    keywords: [],
    effects: [],
    // No flavour names on the options (owner 2026-07-25): "Hunt" / "Ritual" read as extra rules the player had
    // to decode, when the mechanic is the whole choice. The factory ids keep the names — they're internal, and
    // renaming them would churn the run-state fields for a display-only change.
    chooseOne: [
      { text: 'Your Beast **Rallies** trigger an additional time.',
        goldenText: 'Your Beast **Rallies** trigger **2 additional** times.',
        effects: [{ on: 'onPlay', do: 'battlecryGrantBeastHunt', params: { extra: 1 } }] },
      { text: 'Your Beast **Echoes** trigger an additional time.',
        goldenText: 'Your Beast **Echoes** trigger **2 additional** times.',
        effects: [{ on: 'onPlay', do: 'battlecryGrantBeastRitual', params: { extra: 1 } }] },
    ],
    text: '**Choose One:** your Beast **Rallies**, or your Beast **Echoes**, trigger an additional time.',
    goldenText: '**Choose One:** your Beast **Rallies**, or your Beast **Echoes**, trigger **2 additional** times.',
  },
  {
    // A viral Rally whose escalation is EMERGENT: every Beast it buffs learns the rally, and a carrier grants
    // whatever it has ACCUMULATED — so later carriers hand out more purely because they were handed more.
    // Sunmane never buffs itself, so it keeps granting its printed +3 while the Beasts it feeds grow. The
    // accumulation lives on the combat instance, so death loses the stacks. See `rallySpreadTribeBuff`.
    id: 'b2_sunmane',
    name: 'Sunmane Herald',
    tribe: 'beast',
    tier: 5,
    attack: 5, // owner balance 2026-09-23: 3/3 → 5/3
    health: 3,
    keywords: ['RL'],
    // COMBAT-ONLY (owner ruling 2026-08-20): a shop-fired Sunmane under Rune of Lasting Cadence loops the
    // game away — every grant mints new PERMANENT ralliers that rally again next End of Turn, compounding
    // without bound. `combatOnly` scopes the effect out of the shop dispatch at the data level (it is not a
    // rallier in the shop at all — no beat, no rally tally, no graft).
    effects: [{ on: 'onAttack', do: 'rallySpreadTribeBuff', params: { tribe: 'beast', attack: 3 }, combatOnly: true }],
    // The plain wording is the ACCURATE one: nothing doubles anything, the growth is just the buff compounding
    // as it spreads (owner 2026-07-25). The live value is folded in by `rallySpreadText` on the combat card.
    text: '**Rally:** give your Beasts **+3 Attack** and this **Rally**, **only in combat**.',
    goldenText: '**Rally:** give your Beasts **+6 Attack** and this **Rally**, **only in combat**.',
  },
  {
    // A summon payoff: everything you summon mid-fight lands bigger. Reworked 2026-07-25 (owner) from a flat
    // +5/+5 aura to "+1/+1 then DOUBLE", so it scales with whatever the token was already worth. `SC` dropped
    // from keywords — it's an onSummon watcher now, not a Start of Combat.
    id: 'b2_oona',
    name: 'King Oona',
    tribe: 'beast',
    tier: 5,
    attack: 6, // owner balance 2026-09-23: 4/6 → 6/6
    health: 6,
    keywords: [],
    effects: [
      // Owner rebalance 2026-08-02 (final): the flat buff and the Avenge improve are CUT — the card is purely
      // the multiply now. `attack: 0, health: 0` keeps the shared factory's grant half silent (it guards on
      // `a > 0 || h > 0`), so only the stat-doubling runs; golden still triples via `mul(self)`.
      // Owner 2026-08-21: back to BOTH stats (`attackOnly` dropped — the 2026-08-12 Attack-only trial is over).
      { on: 'onSummon', do: 'onSummonTribeBuffThenDouble', params: { tribe: 'beast', attack: 0, health: 0 } },
    ],
    text: 'When you summon a Beast in combat, **double its stats**.',
    goldenText: 'When you summon a Beast in combat, **triple its stats**.',
  },
  {
    // Echo summon on the Void Panther pattern: `fixed` keeps the count at 1 and `goldenTokens` upgrades the
    // Baby to gilded instead (matching "summon a Gilded T-Rex Baby"). Taunt is granted at summon time.
    id: 'b2_trex',
    name: 'T-Rex',
    tribe: 'beast',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'b2_trexbaby', count: 1, keyword: 'T', fixed: true, goldenTokens: true } }],
    text: '**Echo:** summon a **T-Rex Baby** with **Taunt**.',
    goldenText: '**Echo:** summon a **Gilded T-Rex Baby** with **Taunt**.',
  },
  {
    // Rally: re-fire your left-most friendly Echo without killing it — the Deathsayer mechanic, board-order
    // (deterministic) rather than "first that has one".
    id: 'b2_echohorn',
    name: 'Echohorn', // renamed from Echohorn Stag (owner 2026-07-31); id unchanged
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyProcLeftmostEcho' }],
    text: '**Rally:** trigger your left-most **Echo**.',
    goldenText: '**Rally:** trigger your left-most **Echo** twice.',
  },
  {
    // Owner rework 2026-08-12: a summon engine again — Echo: summon 3 random OTHER Beasts, drawn from the run's
    // set pool (`excludeSelf` keeps it from summoning more Mammoths). Golden doubles the count to 6 via
    // `deathrattleSummonRandomTribe`'s built-in `mul(self)`.
    id: 'b2_mammoth',
    name: 'Menagerie Mammoth',
    tribe: 'beast',
    tier: 5,
    attack: 7,
    health: 4,
    keywords: [],
    // Owner 2026-09-10 (R-TARGET-02): the pool drops EVERY Mammoth card, not just this body — that is "DIFFERENT".
    effects: [{ on: 'onDeath', do: 'deathrattleSummonRandomTribe', params: { tribe: 'beast', count: 3, excludeSelf: true } }],
    text: '**Echo:** summon **3** random different **Beasts**.',
    goldenText: '**Echo:** summon **6** random different **Beasts**.',
  },
  {
    // Reuses Solaris Fang's `avengeShieldAttack` verbatim — Ward + an immediate out-of-turn strike every 4
    // friendly deaths (golden strikes twice, each shielded).
    id: 'b2_solaris',
    name: 'Solaris',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeShieldAttack', params: { count: 4 } }],
    text: '**Avenge (4):** gain **Ward** and attack immediately.',
    goldenText: '**Avenge (4):** gain **Ward** and attack immediately **twice**.',
  },
  {
    // Owner addition 2026-08-07, the Rune of the Wildscript's reward. Turns a held spell into a per-combat
    // engine: the LEFT-MOST spell in hand is cast on its two neighbours at the start of every fight, and it is
    // NOT consumed (owner ruling) — so you steer it by ordering your hand and it keeps paying.
    //
    // `token: true` keeps it out of the shop pool and the "random Beast" grants: it is rune-exclusive.
    id: 'b2_quil',
    name: 'Quil',
    tribe: 'beast',
    tier: 6,
    attack: 7,
    health: 7,
    keywords: ['SC'],
    token: true,
    effects: [{ on: 'startOfCombat', do: 'scCastLeftmostHandSpell' }],
    text: '**Start of Combat:** cast the left-most spell in your hand on adjacent Beasts.',
    goldenText: '**Start of Combat:** cast the left-most spell in your hand on adjacent Beasts **twice**.',
  },
  {
    // Reuses Ryme's adjacent-Battlecry re-fire (`deathrattleReplayAdjacentBattlecry`): on death in combat, both
    // neighbours' Shouts fire again (golden fires each twice) — exactly the shared primitive.
    id: 'b2_dawnclaw',
    name: 'Dawnclaw',
    tribe: 'beast',
    tier: 4,
    attack: 5,
    health: 3,
    // Taunt (owner 2026-07-25): it has to be attacked INTO for its Echo to pay, so guarding the line is what
    // makes the card do its own job.
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry', params: { one: true } }],
    text: "**Taunt. Echo:** trigger an adjacent minion's **Shout**.",
    goldenText: "**Taunt. Echo:** trigger **both** adjacent minions' **Shouts**.",
  },
  {
    // A go-wide Rally payoff: the more Beasts you field, the harder it hits. Buffs ITSELF (not the board) so
    // it's a finisher you build around rather than an aura.
    id: 'b2_packstrider',
    name: 'Packstrider',
    tribe: 'beast',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyBuffSelfPerTribe', params: { tribe: 'beast', attack: 1, health: 0 } }],
    text: '**Rally:** gain **+1 Attack** for every Beast you control.',
    goldenText: '**Rally:** gain **+2 Attack** for every Beast you control.',
  },
  {
    // Owner add 2026-08-12. Echo: summon a random Beast from the run pool and STAMP it 7/7 — a fixed body
    // whatever it rolls (`deathrattleSummonRandomTribeSetStats`). Golden doubles the STATLINE (one 14/14),
    // not the count.
    id: 'b2_bullseye',
    name: 'Bullseye',
    tribe: 'beast',
    tier: 3,
    attack: 3,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonRandomTribeSetStats', params: { tribe: 'beast', count: 1, stat: 7 } }],
    text: '**Echo:** summon a random **Beast** and set its stats to **7/7**.',
    goldenText: '**Echo:** summon a random **Beast** and set its stats to **14/14**.',
  },
  {
    // Owner rework 2026-08-18: an ESCALATING summon buff — whenever you summon a Beast give it +3/+3, and the
    // grant improves +3/+3 every 3 Beasts summoned (per-instance tally in `summonBonus`, both phases). Golden
    // doubles both the grant and the step. The live grant is folded into the printed text.
    id: 'b2_beardsley',
    name: 'Beardsley',
    tribe: 'beast',
    tier: 4,
    attack: 5,
    health: 5,
    keywords: ['DS'],
    effects: [{ on: 'onSummon', do: 'onSummonTribeBuffFlat', params: { tribe: 'beast', attack: 3, health: 3, improve: 3, every: 3 } }],
    text: '**Ward.** Whenever you summon a **Beast**, give it **+3/+3**. Improves **+3/+3** every **3 Beasts** summoned.',
    goldenText: '**Ward.** Whenever you summon a **Beast**, give it **+6/+6**. Improves **+6/+6** every **3 Beasts** summoned.',
  },
  {
    // Owner add 2026-08-12 (was: the next Beast summoned gets +2/+4). Owner batch 2026-09-24: "Taunt. Echo: Give a
    // Beast +2/+4 and Rise." A RANDOM other friendly Beast takes both (`deathrattleBuffRandomTribe`'s keyword
    // rider, one arena body for the Shop and combat). Golden: +4/+8, and the Rise grant goes to 2 Beasts (the
    // house keyword-grant gild), each taking the doubled stats.
    id: 'b2_wolvie',
    name: 'Wolvie',
    tribe: 'beast',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffRandomTribe', params: { tribe: 'beast', attack: 2, health: 4, keyword: 'R' } }],
    text: '**Taunt. Echo:** give a **Beast** **+2/+4** and **Rise**.',
    goldenText: '**Taunt. Echo:** give **2** **Beasts** **+4/+8** and **Rise**.',
  },
  {
    // Owner add 2026-08-12. Echo: buff your Beasts "wherever they are" — `deathrattleBuffTribe` buffs the living
    // Beasts and registers a rest-of-combat aura so bodies summoned later inherit it. Golden +4/+8.
    id: 'b2_armadiyo',
    name: 'Armadiyo',
    tribe: 'beast',
    tier: 3,
    attack: 5,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleBuffTribe', params: { tribe: 'beast', attack: 2, health: 4 } }],
    text: '**Taunt. Echo:** give your **Beast Aura** **+2/+4**.',
    goldenText: '**Taunt. Echo:** give your **Beast Aura** **+4/+8**.',
  },
  {
    // Owner add 2026-08-12. Rune-only (Rune of the Voidmother grants it) — `token: true` keeps it out of the
    // shop pool + the "random Beast" grants. Echo: summon a Void Panther (`manasaber`). Golden summons 2.
    id: 'b2_voidmother',
    name: 'Voidmother',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 1,
    keywords: [],
    token: true,
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'manasaber', count: 1 } }],
    text: '**Echo:** summon a **Void Panther**.',
    goldenText: '**Echo:** summon **2 Void Panthers**.',
  },

  // ── Owner add 2026-08-18: the Echo-trigger pair ──────────────────────────────────────────────────────────
  {
    // Reacts to EVERY Rally you trigger (any friendly minion with the Rally keyword swinging) by re-firing your
    // left-most Echo — a Rally board becomes an Echo engine. Golden triggers the Echo twice per Rally.
    id: 'b2_hawkus',
    name: 'Hawkus',
    tribe: 'beast',
    tier: 5,
    attack: 6,
    health: 9,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onRallyProcLeftmostEcho', params: {} }],
    text: 'When a **Rally** is triggered, trigger your **left-most Echo**.',
    goldenText: 'When a **Rally** is triggered, trigger your **left-most Echo** **twice**.',
  },
  {
    // A one-shot burst of the same idea: fire your two left-most Echoes as the fight opens. Golden triggers each
    // twice.
    id: 'b2_spots',
    name: 'Spots',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 10,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scTriggerLeftmostEchoes', params: { count: 2 } }],
    text: '**Start of Combat:** trigger your **2 left-most Echoes**.',
    goldenText: '**Start of Combat:** trigger your **2 left-most Echoes** **twice** each.',
  },
  {
    // -- RUNE-ONLY (Source: Rune), owner batch 2026-08-20 --------------------------------------------------
    // STONEHORN ARCHIVIST - Bellringer Voss aimed at the HAND instead of the board, which makes it a very
    // different card: what it copies is whatever you choose to LEAVE in hand, so holding a bomb is now a
    // decision with an upside. A Ruby in the left slot is skipped (its whole value is the stats baked in at
    // mint, which a plain copy wouldn't carry) and the scan falls through to the first ordinary card.
    id: 'b2_stonehorn',
    name: 'Stonehorn Archivist',
    tribe: 'beast',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    token: true, // forge-only: Source = Rune
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCopyLeftmostHandCard', params: { every: 2 } }],
    text: '**Every 2 turns:** get a plain copy of the **left-most** card in your hand.',
    goldenText: '**Every 2 turns:** get a plain copy of the **2 left-most** cards in your hand.',
  },

  // ── Owner batch 2026-09-24: the Execute Beasts + two Beast payoffs ─────────────────────────────────────────
  // "Another Beast" = a RANDOM other friendly Beast that does not already have Execute (never wasted, never
  // itself), from the shared `rallyGrantKeywordRandomTribe` arena body. Golden grants it to 2 Beasts.
  {
    id: 'b2_raven',
    name: 'Raven',
    tribe: 'beast',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyGrantKeywordRandomTribe', params: { tribe: 'beast', keyword: 'V' } }],
    text: '**Rally:** give another **Beast** **Execute**.',
    goldenText: '**Rally:** give **2** other **Beasts** **Execute**.',
  },
  {
    // Avenge is a combat trigger, so Tort only acts in combat (like every other Avenge card).
    id: 'b2_tort',
    name: 'Tort',
    tribe: 'beast',
    tier: 5,
    attack: 2,
    health: 9,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeGrantKeywordRandomTribe', params: { count: 4, tribe: 'beast', keyword: 'V' } }],
    text: '**Avenge (4):** give another **Beast** **Execute**.',
    goldenText: '**Avenge (4):** give **2** other **Beasts** **Execute**.',
  },
  {
    // A summon payoff that pumps the whole pack, this one and the new arrival included. Its own arrival does
    // not trigger it. Shop plays and combat summons both count (`onSummonBuffTribeAll`, one arena body).
    id: 'b2_florida',
    name: 'Flo Rida',
    tribe: 'beast',
    tier: 6,
    attack: 7,
    health: 5,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'onSummonBuffTribeAll', params: { tribe: 'beast', attack: 4, health: 4 } }],
    text: 'When you summon a **Beast**, give your **Beasts +4/+4**.',
    goldenText: 'When you summon a **Beast**, give your **Beasts +8/+8**.',
  },
  {
    // Any friendly Beast attacking (Beev itself included) buffs the attacker AND Beev. When Beev is the attacker
    // it is one body, so it gains the grant once.
    id: 'b2_beev',
    name: 'Beev',
    tribe: 'beast',
    tier: 3,
    attack: 4,
    health: 4,
    keywords: [],
    effects: [{ on: 'onAttack', do: 'onTribeAttackBuffAttackerAndSelf', params: { tribe: 'beast', attack: 2, health: 2 } }],
    text: 'When a **Beast** attacks, give it and this **+2/+2**.',
    goldenText: 'When a **Beast** attacks, give it and this **+4/+4**.',
  },
];
