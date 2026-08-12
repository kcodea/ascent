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
    // Turns spell purchases into bodies: a bought Shop spell is taught to a Mage-Pup, and at End of Turn that
    // Pup joins your hand — a 2/2 Beast whose Shout casts the spell it learned (owner ruling 2026-07-24). So
    // the spell is effectively duplicated onto a body you can also buff. Golden teaches twice each turn.
    id: 'b2_moonhowl',
    name: 'Moonhowl Mentor',
    tribe: 'beast',
    tier: 6, // T6 -> T5 (2026-08-07 batch) -> back to T6 (owner, same day)
    attack: 4,
    health: 9,
    keywords: [],
    // Fires the moment the spell is BOUGHT (owner 2026-07-24) — the Pup lands in hand right away, so you can
    // play it the same turn. It used to queue and mint at End of Turn, which put the payoff a turn away.
    effects: [{ on: 'spellBought', do: 'grantMagePupTaught' }],
    text: 'Once per turn, when you buy a Shop spell, get a **Mage-Pup** that has learned it.',
    goldenText: 'Twice per turn, when you buy a Shop spell, get a **Mage-Pup** that has learned it.',
  },
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
    attack: 3,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallySpreadTribeBuff', params: { tribe: 'beast', attack: 3 } }],
    // The plain wording is the ACCURATE one: nothing doubles anything, the growth is just the buff compounding
    // as it spreads (owner 2026-07-25). The live value is folded in by `rallySpreadText` on the combat card.
    text: '**Rally:** give your Beasts **+3 Attack** and this **Rally**.',
    goldenText: '**Rally:** give your Beasts **+6 Attack** and this **Rally**.',
  },
  {
    // The tribe's two halves in one card: it pays your summons, and your SPELLS make that payment bigger.
    id: 'b2_groveweaver',
    name: 'Groveweaver',
    tribe: 'beast',
    tier: 5,
    attack: 4,
    health: 8,
    keywords: [],
    effects: [
      // Owner balance 2026-08-04: the base grant is +3/+3 (was +2/+2); each spell still improves it +2/+2.
      { on: 'onSummon', do: 'summonBuffTribeAsym', params: { tribe: 'beast', attack: 3, health: 3, step: 2 } },
      { on: 'spellCast', do: 'onSpellCastImproveSummon', params: { step: 2 } },
    ],
    text: 'When you summon a Beast, give it **+3/+3**. Improve this by **+2/+2** when you cast a Shop spell.',
    goldenText: 'When you summon a Beast, give it **+6/+6**. Improve this by **+4/+4** when you cast a Shop spell.',
  },
  {
    // A summon payoff: everything you summon mid-fight lands bigger. Reworked 2026-07-25 (owner) from a flat
    // +5/+5 aura to "+1/+1 then DOUBLE", so it scales with whatever the token was already worth. `SC` dropped
    // from keywords — it's an onSummon watcher now, not a Start of Combat.
    id: 'b2_oona',
    name: 'King Oona',
    tribe: 'beast',
    tier: 5,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [
      // Owner rebalance 2026-08-02 (final): the flat buff and the Avenge improve are CUT — the card is purely
      // the multiply now. `attack: 0, health: 0` keeps the shared factory's grant half silent (it guards on
      // `a > 0 || h > 0`), so only the stat-doubling runs; golden still triples via `mul(self)`.
      { on: 'onSummon', do: 'onSummonTribeBuffThenDouble', params: { tribe: 'beast', attack: 0, health: 0 } },
    ],
    text: 'When you summon a Beast in combat, **double** its stats.',
    goldenText: 'When you summon a Beast in combat, **triple** its stats.',
  },
  {
    // Echo summon on the Void Panther pattern: `fixed` keeps the count at 1 and `goldenTokens` upgrades the
    // Baby to gilded instead (matching "summon a Gilded T-Rex Baby"). Taunt is granted at summon time.
    id: 'b2_trex',
    name: 'T-Rex',
    tribe: 'beast',
    tier: 2,
    attack: 3,
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
    tier: 3,
    attack: 3,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyProcLeftmostEcho' }],
    text: '**Rally:** trigger your left-most **Echo**.',
    goldenText: '**Rally:** trigger your left-most **Echo** twice.',
  },
  {
    // Owner rework 2026-08-07: the summon-buff engine is out (and Rune of the Mammoth retires with it —
    // archived). It is a hand-caster now: every 3 friendly deaths it casts a random spell from your hand,
    // through the combat resolver — kept, not consumed, like Quil's. Targeted spells pick a random friendly.
    id: 'b2_mammoth',
    name: 'Menagerie Mammoth',
    tribe: 'beast',
    tier: 5,
    attack: 6,
    health: 6,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeCastRandomHandSpell', params: { count: 3 } }],
    text: '**Avenge (3):** cast a random spell in your hand.',
    goldenText: '**Avenge (3):** cast a random spell in your hand **twice**.',
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
    // The top-end spell payoff. Owner rework 2026-08-07: instead of paying out PER cast, it multiplies the
    // casts themselves — every Shop Spell your board casts mid-fight resolves an extra time. It reads the
    // combat cast path (`castInCombat`), so it reaches every caster at once rather than a hand-kept list.
    // Start of Combat, so the grant is locked in and does not retract if the Matriarch dies.
    id: 'b2_runebloom',
    name: 'Runebloom Matriarch',
    tribe: 'beast',
    tier: 6,
    attack: 5,
    health: 9,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scGrantSpellCastExtra', params: { extra: 1 } }],
    text: 'Your **Shop Spells** cast an extra time in combat.',
    goldenText: 'Your **Shop Spells** cast **2** extra times in combat.',
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
    // Owner add 2026-07-28. A Shout ENGINE that pays in the shop rather than in combat: park it between two
    // Shouts and it re-fires both every End of Turn. Gilded fires the whole thing twice (not "twice as big"),
    // so a golden Moira between two summoners really does double the bodies.
    id: 'b2_moira',
    name: 'Moira',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 4,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnTriggerAdjacentShouts', params: {} }],
    text: '**End of Turn:** trigger adjacent **Shouts**.',
    goldenText: '**End of Turn:** trigger adjacent **Shouts** **twice**.',
  },
];
