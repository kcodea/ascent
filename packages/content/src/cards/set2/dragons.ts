import type { CardDef } from '@game/core';

/**
 * Dragons (set 2) — the SPELL-RECURSION tribe. Where set 1's Dragons scaled off Battlecries, these scale off
 * SPELLS: copying the ones you already cast, re-casting them, and paying you for casting early in a turn.
 *
 * The engine already tracks what this tribe needs — `firstSpellThisTurnId` and `lastSpellCastId` are recorded
 * by `castSpell` for the Runes, `spellsThisTurn` counts them, and `nextSpellExtraCasts` banks extra casts — so
 * most of the line reads existing state rather than adding bookkeeping.
 *
 * This file fills in as the remaining primitives land. Currently here: the cards that build on effects the
 * engine already supports. Still to come (each needs a genuinely new primitive, so each is its own piece of
 * work):
 *   • per-minion "the first spell cast ON THIS each turn" tracking — Mirrorwing Hatchling, Runefire
 *   • Shout re-triggering inside COMBAT (`replayBattlecry` is recruit-only) — Thunderous Sovereign, Chorus Drake
 *   • cross-turn pending effects — Scalefeather Drake ("next turn")
 *   • a spend-and-reset counter — Living Grimoire
 *   • persistent Choose-One global modes — Orivax
 *   • first/second-spell-this-turn hooks on a minion — Ashscribe Whelp, Spellkeeper Drake
 *   • an on-sell per-turn flag — Voicekeeper; improve-per-N-Shouts — Scalechanter
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
    text: '**Shout:** get a copy of the last spell you cast this turn.',
    goldenText: '**Shout:** get **2** copies of the last spell you cast this turn.',
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
    text: '**End of Turn:** get a copy of the first spell you cast this turn.',
    goldenText: '**End of Turn:** get **2** copies of the first spell you cast this turn.',
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
];
