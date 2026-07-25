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
    // A Tier-1 Echo that trades its own small body for a bigger one that swings immediately — so it wants to
    // die early, which is the opposite of most T1 bodies.
    id: 'n2_tamer',
    name: 'Tamer',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 1,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'n2_whelp', count: 1 } }],
    text: '**Echo:** summon a **3/3 Whelp** that attacks immediately.',
    goldenText: '**Echo:** summon two **3/3 Whelps** that attack immediately.',
  },
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
    text: '**Choose One — Shout:** give your Shop spells **+1 Attack** or **+1 Health**.',
    goldenText: '**Choose One — Shout:** give your Shop spells **+2 Attack** or **+2 Health**.',
  },
  {
    id: 'n2_gravelight',
    name: 'Gravelight Acolyte',
    tribe: 'neutral',
    tier: 2,
    attack: 2,
    health: 2,
    keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattleSummonRandomTier', params: { tier: 1, count: 1 } }],
    text: '**Echo:** summon a random **Tier 1** minion.',
    goldenText: '**Echo:** summon **2** random **Tier 1** minions.',
  },
  {
    // Avenge that pays in survivability rather than damage — the Ward is the point, the stats are the sweetener.
    id: 'n2_oathbound',
    name: 'Oathbound Avenger',
    tribe: 'neutral',
    tier: 3,
    attack: 2,
    health: 5,
    keywords: [],
    effects: [{ on: 'avenge', do: 'avengeBuffRandomFriendlyShield', params: { count: 3, attack: 1, health: 3 } }],
    text: '**Avenge (3):** give a random friendly minion **+1/+3** and **Ward**.',
    goldenText: '**Avenge (3):** give a random friendly minion **+2/+6** and **Ward**.',
  },
  {
    // A cadence engine that rewards board ARRANGEMENT: what it copies is whatever you seat to its left.
    id: 'n2_bellringer',
    name: 'Bellringer Voss',
    tribe: 'neutral',
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCopyNeighbour', params: { every: 2 } }],
    text: '**Every 2 turns:** get a plain copy of the minion to the **left**.',
    goldenText: '**Every 2 turns:** get a plain copy of **adjacent** minions.',
  },
  {
    // Positional Start of Combat: the two ends of your line get the two keywords that matter most there —
    // Flurry on the leader that strikes first, Ward on the tail that gets attacked into.
    id: 'n2_lastlight',
    name: 'Lastlight Marshal',
    tribe: 'neutral',
    tier: 5,
    attack: 5,
    health: 7,
    keywords: [],
    effects: [{ on: 'startOfCombat', do: 'scGrantEndsFlurryWard' }],
    text: '**Start of Combat:** give your **left-most** minion **Flurry** and your **right-most** minion **Ward**.',
  },
  {
    // The summon-build capstone: every body you make in combat lands at double size. Its Gilded text on the
    // owner's roster is identical to the base, so it deliberately doesn't scale with golden.
    id: 'n2_fatecarver',
    name: 'Fatecarver',
    tribe: 'neutral',
    tier: 6,
    attack: 5,
    health: 10,
    keywords: [],
    effects: [{ on: 'onSummon', do: 'onSummonDoubleStats' }],
    text: 'When you summon a minion in combat, **double its stats**.',
  },
];
