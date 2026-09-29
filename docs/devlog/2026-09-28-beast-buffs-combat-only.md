# 2026-09-28 — No more Beast Aura: "Give all your Beasts" in both phases

Owner ask (2026-09-28): "pack mentality - aka beastial swarm buff: this is a combat buff only, not a permanent
buff to beast aura everywhere … these affect beasts everywhere in combat, but there is no carryback (unless
somethings engraved, etc)". Clarified on PR #1813 the same day: "let's just make the effect say: "Echo: Give all
your Beasts +8/+8." … this SHOULD work in recruit and combat phase. in a recruit scenario, any beast in the warband
would get the stats from a destroyed or triggered grim." Oracle: **R-AURA-03** (`registry/approved/auras.ts`);
R-ECHOTALLY-01 retired (Grim no longer tallies Echoes); R-RUNE-06's Beastial Swarm sentence rewritten.

## What changed

- **Text** — every "give your Beast Aura" became "Give all your Beasts +X/+Y": Kennelmaster, Grim (a flat +8/+8,
  gilded +16/+16, tier/stats unchanged; supersedes the unmerged PR #1809), Armadiyo, Trophy Stalker, Rune of
  Beastial Swarm. Quest rewards: Pack Mentality ("Start of Combat: give all your Beasts +4/+4. Improve this by
  +4/+4 every 5 Beasts summoned in combat") and The Old Hunt ("Whenever a Beast attacks, give all your Beasts
  +3/+3"; the old "+3 Attack aura" text was stale, it has granted +N/+N since 2026-07-21).
- **One rule, both phases** — arena verb `buffAllOfTribe(targets, auraTribes, a, h)`. COMBAT: registers the
  rest-of-combat tribe aura (later summons inherit it) and applies plain combat buffs (no carry-back; Engrave keeps
  them via `permaGain`). SHOP / End of Turn: a normal permanent `addBuff` on each target — the warband board, the
  `friends()` convention every Shop "your Beasts" grant uses (Wildwood Shaper's `battlecryBuffTribe`), so the hand
  is not included. `scBeastAura`, `deathrattleBuffTribe`, `rallyTribeAuraGrowing` and the legacy
  `deathrattleBuffTribeByTally` all route through it.
- **Beastial Swarm Shop half** — `fireOnFriendDeath` now pays it on a Shop Beast death (warband, per copy). Its
  Avenge (2) improvement still counts combat deaths only (the Shop has no Avenge meter for any card).
- **Carry-back removed** — The Old Hunt and Beastial Swarm no longer add to `beastBuyAtkGain/HpGain`. Those result
  fields now carry ONLY Pack Mentality's grown LEVEL, which settle folds into its `questScalingAuras` entry
  (`attack`/`health`), never into Beast stats. Pack Mentality's grant happens at Start of Combat (both sides, off
  the snapshot's level; owner "okay"); its live mid-fight growth stays player-only.
- **Retired channel** — nothing feeds `beastBuyAtk` / `beastBuyHp`, but they are still READ so a pre-change
  in-flight run or recorded snapshot keeps what it banked (a pre-change Pack Mentality entry has no level, so it
  never double-dips).
- **UI** — combat `tribeAura` events no longer carry a `beast` Buffs-panel key (the board wash still blooms); the
  Buffs panel's "Beast Aura" row only ever shows a legacy banked value. The Grim announcer line fires on any Grim
  Echo payout (the 6-Echo threshold went with the tally).

## Semantics worth remembering

- **Kennelmaster's Avenge "Improve this"** — permanent per instance (`summonBonus`, carried back via
  `playerSummonBonus`). One earned mid-fight is used from the NEXT Start of Combat (owner: "as built is right").
- **Shop fires** (Graverobber/Ossuary on Grim, Spots under Combat Prowess, a Shop Rally, Kennelmaster's End-of-Turn
  replay) buff the warband Beasts permanently. Sylus doubles it in both phases.

## Verification

`packages/sim/src/beastCombatOnly0928.test.ts` (both phases: Shop warband buff + permanence, combat buff with
mid-fight summons and no carry-back, Engrave, Sylus in both phases, golden, Kennelmaster Avenge + End-of-Turn replay,
Pack Mentality, Old Hunt, Beastial Swarm combat + Shop, old-replay ids) and `packages/ui/src/beastCombatOnlyText.test.ts`
(live text on the shared `liveCardText` chain the combat `Unit` also reads, quest text + live level, rune pill).
Older suites updated; `grimLiveText.test.ts` deleted with the tally text. Doc Bot regenerated.
