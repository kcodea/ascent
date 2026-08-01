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
    tier: 4,
    attack: 4,
    health: 6,
    keywords: [],
    effects: [{ on: 'endOfTurn', do: 'endOfTurnCopyNeighbour', params: { every: 2 } }],
    text: '**Every 2 turns:** get a plain copy of the minion to the **left**.',
    goldenText: '**Every 2 turns:** get a plain copy of **adjacent** minions.',
  },
  {
    // Echo: its death hands Ward to two survivors — a body that trades early and leaves the line tougher than
    // it found it (owner change 2026-07-25, replacing a positional Start of Combat).
    id: 'n2_lastlight',
    name: 'Lastlight',
    tribe: 'neutral',
    tier: 3,
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
    tier: 6,
    attack: 4,
    health: 5,
    keywords: [],
    universalTribe: true,
    effects: [{ on: 'onAttack', do: 'onRallyBuffOnePerTribe', params: { attack: 3, health: 3 } }],
    text: 'Counts as all tribes. Whenever you trigger a **Rally**, give a minion of **every type** **+3/+3** permanently.',
    goldenText: 'Counts as all tribes. Whenever you trigger a **Rally**, give a minion of **every type** **+6/+6** permanently.',
  },
  {
    // Owner roster addition 2026-07-29. Two branches, deliberately different SHAPES rather than two stat buffs:
    // branch A pays off the spell/Dragon half of set 2 (per-cast, per-type spread), branch B pays off a wide
    // aggressive board (per-attack, board-wide). Which one is live is a real read on your build.
    id: 'n2_fatecarver',
    name: 'Fatecarver',
    tribe: 'neutral',
    tier: 6,
    attack: 5,
    health: 5,
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
];
