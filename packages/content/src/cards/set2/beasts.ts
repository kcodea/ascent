import type { CardDef } from '@game/core';

/**
 * Beasts (set 2) — the tribe brought forward from set 1 with a spell/summon-synergy tilt (owner roster
 * 2026-07-24). Several set-1 Beasts carry over unchanged (see `SET1_BEASTS_IN_SET2` in `sets.ts`); the cards
 * authored HERE are the set-2 additions.
 *
 * IN PROGRESS — this tranche holds only the fully-specified new cards. The rest of the owner's 21-card roster
 * is blocked on missing Attack/Health (14 cards list none) and a few genuinely new mechanics (Moonhowl Mentor's
 * "teach a bought spell to a Mage-Pup", the self-replicating Rally on Sunmane Herald / Solaris); those land once
 * the owner supplies stats + rulings.
 */
export const SET2_BEASTS: CardDef[] = [
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
      { on: 'onSummon', do: 'summonBuffTribeAsym', params: { tribe: 'beast', attack: 2, health: 4 } },
      { on: 'spellCast', do: 'onSpellCastImproveSummon', params: { step: 1 } },
    ],
    text: 'When you summon a Beast, give it **+2/+4**. Improve this when you cast a spell.',
    goldenText: 'When you summon a Beast, give it **+4/+8**. Improve this when you cast a spell (twice as much).',
  },
  {
    // An opener: your front Beast enters shielded and swings before the turn order starts, so a big left-most
    // body gets a free hit in. Left-most = board order (deterministic, no RNG).
    id: 'b2_lancel',
    name: 'Lancel',
    tribe: 'beast',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scShieldAttackLeftmostTribe', params: { tribe: 'beast', count: 1 } }],
    text: '**Start of Combat:** give your left-most Beast **Ward**. It attacks immediately.',
    goldenText: '**Start of Combat:** give your **2** left-most Beasts **Ward**. They attack immediately.',
  },
  {
    // A summon-payoff aura: it does NOT buff the board you already have — it makes everything you summon
    // during the fight enter bigger. Pairs with the Echo-summon line (T-Rex, Mammoth, Void Panther).
    id: 'b2_oona',
    name: 'Denkeeper Oona',
    tribe: 'beast',
    tier: 5,
    attack: 4,
    health: 6,
    keywords: ['SC'],
    effects: [{ on: 'startOfCombat', do: 'scSummonOnlyTribeAura', params: { tribe: 'beast', attack: 5, health: 5 } }],
    text: 'Beasts you **summon in combat** have **+5/+5**.',
    goldenText: 'Beasts you **summon in combat** have **+10/+10**.',
  },
  {
    // Avenge that pays twice: a spell for the hand AND a lasting Beast Attack aura (later summons inherit it).
    id: 'b2_scavenger',
    name: 'Moonlit Scavenger',
    tribe: 'beast',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [
      { on: 'avenge', do: 'avengeGrantRandomSpell', params: { count: 3 } },
      { on: 'avenge', do: 'avengeBuffTribeLasting', params: { count: 3, tribe: 'beast', attack: 2, health: 0 } },
    ],
    text: '**Avenge (3):** get a random spell and give your Beasts **+2 Attack** wherever they are.',
    goldenText: '**Avenge (3):** get **2** random spells and give your Beasts **+4 Attack** wherever they are.',
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
    name: 'Echohorn Stag',
    tribe: 'beast',
    tier: 3,
    attack: 4,
    health: 3,
    keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyProcLeftmostEcho' }],
    text: '**Rally:** trigger your left-most **Echo**.',
    goldenText: '**Rally:** trigger your left-most **Echo** twice.',
  },
  {
    // The tribe's go-wide finisher: dying floods the board with real Beasts (tokens excluded from the pool).
    id: 'b2_mammoth',
    name: 'Menagerie Mammoth',
    tribe: 'beast',
    tier: 6,
    attack: 6,
    health: 8,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonRandomTribe', params: { tribe: 'beast', count: 2 } }],
    text: '**Echo:** summon **2 random Beasts**.',
    goldenText: '**Echo:** summon **4 random Beasts**.',
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
    // A low-tier spell payoff: your first cast each turn washes the board of Beasts with +1/+1.
    id: 'b2_mosswhisker',
    name: 'Mosswhisker Adept',
    tribe: 'beast',
    tier: 2,
    attack: 1,
    health: 2,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastFirstBuffTribe', params: { tribe: 'beast', attack: 1, health: 1 } }],
    text: 'The first time you cast a spell each turn, give your Beasts **+1/+1** wherever they are.',
    goldenText: 'The first time you cast a spell each turn, give your Beasts **+2/+2** wherever they are.',
  },
  {
    // The top-end spell payoff: every cast rains +3/+3 onto three Beasts. Rewards a spell-heavy Beast board.
    id: 'b2_runebloom',
    name: 'Runebloom Matriarch',
    tribe: 'beast',
    tier: 6,
    attack: 5,
    health: 9,
    keywords: [],
    effects: [{ on: 'spellCast', do: 'onSpellCastBuffRandomTribe', params: { tribe: 'beast', count: 3, attack: 3, health: 3 } }],
    text: 'Whenever you cast a spell, give 3 Beasts **+3/+3**.',
    goldenText: 'Whenever you cast a spell, give 3 Beasts **+6/+6**.',
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
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleReplayAdjacentBattlecry' }],
    text: "**Echo:** trigger adjacent minions' **Shouts**.",
    goldenText: "**Echo:** trigger adjacent minions' **Shouts** twice.",
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
    effects: [{ on: 'onAttack', do: 'rallyBuffSelfPerTribe', params: { tribe: 'beast', attack: 1, health: 1 } }],
    text: '**Rally:** gain **+1/+1** for every Beast you control.',
    goldenText: '**Rally:** gain **+2/+2** for every Beast you control.',
  },
];
