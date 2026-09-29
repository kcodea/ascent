# 2026-09-28 — Beast buffs are combat-only (no more Beast Aura)

Owner ask (2026-09-28): "pack mentality - aka beastial swarm buff: this is a combat buff only, not a permanent
buff to beast aura everywhere … these affect beasts everywhere in combat, but there is no carryback (unless
somethings engraved, etc)". Oracle: **R-AURA-03** (`packages/rules/src/registry/approved/auras.ts`); R-ECHOTALLY-01
retired (Grim no longer tallies Echoes); R-RUNE-06's Beastial Swarm sentence rewritten.

## What changed

- **Text** — every "give your Beast Aura" became "Give all Beasts +X/+Y this combat": Kennelmaster, Grim (now a
  flat +8/+8, gilded +16/+16, tier/stats unchanged; supersedes the unmerged PR #1809), Armadiyo, Trophy Stalker,
  Rune of Beastial Swarm. Quest rewards: Pack Mentality ("Start of Combat: give all Beasts +4/+4 this combat.
  Improve this by +4/+4 every 5 Beasts summoned in combat") and The Old Hunt ("Whenever a Beast attacks, give all
  Beasts +3/+3 this combat" — the old "+3 Attack aura" text was stale; it has granted +N/+N since 2026-07-21).
- **Engine** — one new arena verb, `buffThisCombat(targets, auraTribes, a, h)`: combat registers the
  rest-of-combat tribe aura (later summons inherit it) and applies plain combat buffs; the SHOP adapter is a
  no-op (the `addTribeAura` class — there is no "this combat" in a shop). `scBeastAura`, `deathrattleBuffTribe`,
  `rallyTribeAuraGrowing` and the legacy `deathrattleBuffTribeByTally` all route through it.
- **Carry-back removed** — The Old Hunt and Beastial Swarm no longer add to `beastBuyAtkGain/HpGain`. Those
  result fields now carry ONLY Pack Mentality's grown LEVEL, which settle folds into its `questScalingAuras`
  entry (`attack`/`health`), never into Beast stats. Pack Mentality's grant happens at Start of Combat (both
  sides, off the snapshot's level); its live mid-fight growth stays player-only as before.
- **Retired channel** — nothing feeds `beastBuyAtk` / `beastBuyHp` any more, but they are still READ so an
  in-flight run or recorded snapshot from before this change keeps what it banked (a pre-change Pack Mentality
  entry has no level, so it never double-dips).
- **UI** — combat no longer tags Beast grants as a run-wide Aura row (`tribeAura` events carry no `beast` key;
  the board wash still blooms); the Buffs panel's "Beast Aura" row only ever shows a legacy banked value. The
  Grim announcer line now fires on any Grim Echo payout (the 6-Echo threshold went with the tally).

## Semantics worth remembering

- **Avenge "Improve this"** (Kennelmaster): permanent per instance — `avengeImproveSummon` bumps `summonBonus`,
  which carries back via `playerSummonBonus`. A mid-fight improvement is used from the NEXT Start of Combat (the
  current one already resolved). Beastial Swarm's Avenge level and Pack Mentality's level persist the same way.
- **Shop-phase fires** (a Graverobber/Ossuary destroy of Grim, Spots under Rune of Combat Prowess, a Shop Rally
  of Trophy Stalker, Kennelmaster's End-of-Turn SoC replay): the trigger still fires and counts for every tally
  (Echo counters, Sylus doubling, …) but the grant gives nothing. Trophy Stalker's Shop Rally still improves it.
- **Engrave** keeps the fight's buff (ordinary `permaGain` path) — pinned.

## Verification

New suites `packages/sim/src/beastCombatOnly0928.test.ts` (combat-only, mid-fight summons, no carry-back, Engrave,
Kennelmaster Avenge, Grim combat + Shop, golden, Pack Mentality, Old Hunt, Beastial Swarm, old-replay ids) and
`packages/ui/src/beastCombatOnlyText.test.ts` (live text on the shared `liveCardText` chain the combat `Unit`
also reads, quest text + live level, rune pill). Older suites updated to the new rulings; `grimLiveText.test.ts`
deleted with the tally text. Doc Bot regenerated (`contracts:extract`, `docbot:text`, `rules:seed`).
