import type { CardDef } from '@game/core';

/**
 * SET 3 — NEUTRALS (owner roster 2026-09-09). Set 3's OWN neutral cards; the carried-over set-1 / set-2
 * neutrals are opted in BY ID in `sets.ts` (`SET1_NEUTRALS_IN_SET3` / `SET2_NEUTRALS_IN_SET3`), shared
 * definitions exactly like the Kobolds, Dwarves and Undead before them.
 *
 * Tranche 1 (this file's first cut): Blaster (restored from the archive — a set-3 card again, id unchanged so
 * every old save / replay still resolves it), Splitboon Adept (new) and the set-3 Yazzus (a FORK — set 1's
 * `yazzus` stays T7 5/7 and "Shop spells"; this one is T6 4/8 and doubles EVERY targeted spell, Rubies
 * included — owner 2026-09-09). Still to come: Defender + Tower Shields, Inspector Pell + Clues, Highway
 * Hustler + Whiplass-o, Warband Recruiter, Equipment Inspector + Start of Turn.
 */
export const SET3_NEUTRAL: readonly CardDef[] = [
  {
    // Un-archived for set 3 (owner 2026-09-09) — as it was: a Taunt body whose Echo hits EVERY minion for 3.
    // Set 1 (disabled) and set 2 never listed it, so moving the def here changes no other pool.
    id: 'blaster',
    name: 'Blaster',
    tribe: 'neutral',
    tier: 4,
    attack: 5,
    health: 3,
    keywords: ['T'],
    effects: [{ on: 'onDeath', do: 'deathrattleDamageAll', params: { amount: 3 } }],
    text: '**Taunt. Echo:** deal **3** damage to ALL minions.',
    goldenText: '**Taunt. Echo:** deal **6** damage to ALL minions.',
  },
  {
    // A Choose One between one big body and two medium ones. Option 1 TARGETS (a per-option `target`, the
    // Godfodder shape) and rides the shared targeted-Shout body; option 2 is a new Shout-family arena effect
    // (`battlecryBuffAdjacent`) so a combat re-fire (Ryme, Myra) buffs its neighbours there too. Golden doubles.
    id: 'n3_splitboon',
    name: 'Splitboon Adept',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    effects: [],
    chooseOne: [
      { text: 'Give a friendly minion **+6/+6**.', goldenText: 'Give a friendly minion **+12/+12**.', target: 'friendly',
        effects: [{ on: 'onPlay', do: 'battlecryBuffTarget', params: { attack: 6, health: 6 } }] },
      { text: 'Give adjacent minions **+3/+3**.', goldenText: 'Give adjacent minions **+6/+6**.',
        effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 3, health: 3 } }] },
    ],
    text: '**Choose One:** give a friendly minion **+6/+6**, or give adjacent minions **+3/+3**.',
    goldenText: '**Choose One:** give a friendly minion **+12/+12**, or give adjacent minions **+6/+6**.',
  },
  {
    // Set 3's Yazzus — a FORK of set 1's `yazzus` (T7 5/7, "targeted SHOP spells"), not an edit: set 2 keeps
    // the original untouched (owner 2026-09-09). This one sits at T6 on a 4/8 and widens the doubling to EVERY
    // targeted spell — Shop spells, Rubies, and the hand spells set 3 adds (Tower Shield, Clue). Resolved in
    // @game/sim: `spellCastMult` (aimed Shop spells) and `rubyCastCount` (Rubies) both read it. Best single
    // copy wins, like the original — golden = 2 additional casts. No combat factory; a sturdy body in a fight.
    id: 'n3_yazzus',
    name: 'Yazzus',
    tribe: 'neutral',
    tier: 6,
    attack: 4,
    health: 8,
    keywords: [],
    effects: [],
    text: 'Your **targeted** spells cast **an additional** time.',
    goldenText: 'Your **targeted** spells cast **2 additional** times.',
  },
];
