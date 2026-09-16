# Every buff-other trigger streams its tendril — the Echo class + the label-sourced grants (audit + fixes)

Owner report 2026-09-16: *"Dawn Sentinel isn't triggering the tendril. Make a quick pass and ensure all minions
that should be tendriling (that don't have their own bespoke effect overriding it) are properly triggering in
all states, recruit + combat — start of turn, start of combat, end of turn."*

PR #1504 (2026-09-15, `docs/devlog/2026-09-15-soc-eot-tendrils.md`) audited Start of Combat and End of Turn.
This pass extends it to the other trigger families — Echo, Rally, watchers, Avenge, Shout, on-sell / on-buy,
Gold-spent, Start of Turn — in both phases.

## The Dawn Sentinel bug was a whole class

Dawn Sentinel is a T1 Celestial, *Echo: give a random friendly Celestial +2/+1*. Its buff never drew anything
because of a rule, not a card:

- **Combat**: `useCombatReplay.fireBuffCasts` marked a cast `sourceless` whenever the buffer was on the
  `DEATHRATTLE_BUFF_FACTORIES` list (`isDeathrattleBufferCard`) — the dead body has no element, so it was routed
  to the descend. The descend's rain-down was **stripped on 2026-09-02** with nothing authored in its place, so
  since then EVERY Echo buffer (Dawn Sentinel, Noggin, Sergey, Grim, Armadiyo, Imp King, Trickster, Chef Raag,
  Equinox Duelist, Lodestar, Geode Guardian, Lastlight, …) landed its buff with no cue at all.
- **Shop**: `captureBuffFx` dropped `sourceUid` for a `deathrattle`-kind capture, so the per-action replay had
  nothing to measure and fell through to the same empty sourceless path.

### The fix — a fallen source still has a slot

New shared resolver `packages/ui/src/choreo/buffSource.ts` (`resolveBuffSource`): a **label** (hero power /
rune name) is sourceless; otherwise the **live** body's centre; else the **slot the body last stood in**; only
with neither is the buff sourceless. Both phases route through it:

- **Combat** — `lastRectRef` already kept the last measured rect per unit (refreshed each beat while the body is
  on screen, and the dying body is still rendered for its death beat). It now tracks BOTH sides (an enemy Echo
  buffer streams too), and `fireBuffCasts` uses it when `findEl` finds nothing. The ribbon leaves a beat after
  the death has read, on the existing `DR_BUFF_LEAD` (500 ms) — the comment block above it is updated (the
  descend numbers were stale). `deathrattleBuffers.ts` + its two tests are deleted: the routing rule they fed no
  longer exists, and with it the "KEEP IN SYNC" list nobody kept in sync.
- **Shop** — `captureBuffFx` keeps `sourceUid` on `deathrattle` captures (display metadata; no RNG, no stats).
  `Recruit.tsx` gains a **departure cache** next to `lastCentreRef`: every render, the board cards that were
  measured last render and are gone now (destroyed / sold / borrowed) are kept with their last centre, and
  `replayBuffFxEvents` streams from that slot. Pinned at replay time so a staggered wave fired from a timeout
  still sees this commit's departures. Resting centres at both ends, per #1483/#1504.

Generic sourceless cases (a spell, a quest reward, a rune tick, a hero power without a button) are unchanged:
nothing is drawn from nowhere, the descend drop time still clocks the roll.

## Label-sourced minion grants (combat)

`ctx.buff`'s `source` must be a uid for the replay to draw anything (a label is a hero power / rune, by
contract — `docbot/onAttackStatTiming.test.ts` sweeps them). Six minion-driven grants passed a NAME:

| Grant | Was | Now | Effect on screen |
| --- | --- | --- | --- |
| Flamebanner Marshal — Rally, `rallyGiveTribeAttackOfHighestAttackHand` | `self.name` | `self.uid` | spirit tendril per Spirit paid |
| Ashen Heir — `impInheritOnDeath` / `impInheritOnSummon` | `self.name` | `self.uid` | demon tendril from the Heir to the paid Imp |
| Better Bot welded onto a host (`rallyMechAtk`, two sites in `simulate.ts`) | `'Better Bot'` | the host's uid | the host's tribe tendril per Mech, on the swing |
| Bloodlust weld (`bloodlustRally`) | `'Bloodlust'` | the swinger's uid | tendril from the swinger |
| Wolvie — `deathrattleBuffNextSummon` → `queueNextSummonBuff` | `'Wolvie'` | the queuing Wolvie's uid (new optional `sourceUid` on the ctx method; stacked Echoes stay ONE summed buff, attributed to the first) | beast tendril from the fallen Wolvie's slot to the summon |
| Kindled Sprite / Handbound Titan (self gains) | `self.name` | `self.uid` | routed as a SELF buff (pulse) instead of a bodiless other-buff |

Log shape (event count, order, stats) is unchanged; only the `source` string. Tests pinned to the labels were
rewritten to the uid (`simulate.test.ts`, `beastBatchAug12.test.ts`, `runeBatch4T2.test.ts`,
`docbot/missDrivenOracles2.test.ts`).

## Shop paths that had NO capture

An empirical sweep of every `RECRUIT_FACTORIES[...]` dispatch site found three trigger families that ran outside
`captureBuffFx`, so their grants were never handed to the replay:

| Family | Cards | Fix |
| --- | --- | --- |
| `goldSpent` | Billings, Coinfire Forewoman | captured per fire, sourced on the card |
| `onGainCard` | Gangplank | captured (a self-pick stays a self-buff) |
| `onSell` | Flame / Tide / Grove Reveler | captured with the SOLD card as source → the ribbon leaves from the slot it was sold from |

## Audit table

Card · trigger · phase · presentation before · action. "already" = uid-sourced through the shared `fireBuffFx`
path, nothing changed. Rows the SoC/EoT devlog already covers are not repeated.

### Echo (combat: `buffWave` after the death; shop: `deathrattle` capture on destroy / loan / Reliquary)

| Card | Effect | Before | Action |
| --- | --- | --- | --- |
| Dawn Sentinel (Celestial), Noggin (Undead) | `deathrattleBuffRandomTribe` | nothing (sourceless) | **FIXED** — tribe tendril from the fallen slot |
| Sergey | `deathrattleBuffAllHealth` | nothing | **FIXED** |
| Sporeling | `deathrattleBuffAll` | nothing | **FIXED** |
| Grim, Armadiyo | `deathrattleBuffTribe` (+ Grim's aura on later Beasts) | nothing | **FIXED** (the aura's later payouts stream from Grim's slot too) |
| Imp King, Chef Raag, Amun Rab, Legion Shepherd | `deathrattleBuffImps` / `deathrattleBuffAllByImpAura` | nothing | **FIXED** |
| Trickster | `deathrattleGiveHealth` | nothing | **FIXED** |
| Equinox Duelist (Dusk) | `deathrattleBuffCelestials` | nothing | **FIXED** |
| Lodestar | `deathrattleGiveMaxStatsRandomTribe` | nothing | **FIXED** |
| Nanon | `deathrattleSummonOverflowBuff` | nothing | **FIXED** |
| Wolvie | `deathrattleBuffNextSummon` | nothing (label) | **FIXED** (see above) |
| Geode Guardian, Kobebes | Rubies on death | gem cascade (`ruby` flag → no cast) | authored — kept |
| Lastlight | `deathrattleGrantWardRandom` | Ward blast | keyword — kept |
| Spear Warden | `deathrattleBuffCardTypeRunWide` | run-wide enchant | n/a (no board grant) |
| Right Hand Hank, Malphas, Adeptus | shop-slot / spell-power carry-backs | own cues | n/a |
| Shop: any of the above destroyed (Cage Breaker, Graverobber, EMS, Funeral on Loan, Ossuary Rite on a living body) | `deathrattle` capture | nothing (no `sourceUid`) | **FIXED** — from the departed slot; a living body measures itself |

### Rally / on-attack (combat: absorbed into the swing's wind-up → `fireBuffCasts`)

| Card | Effect | Before | Action |
| --- | --- | --- | --- |
| Supporter | `rallyBuff` | tendril | already |
| Lieutenant Thane | `rallyGiveAttackToOthers` | tendril | already |
| Chimerus | `rallyGiveHealthToDragons` | tendril | already |
| Sunmane Herald | `rallySpreadTribeBuff` | tendril | already |
| Equinox Duelist (Dawn) | `rallyBuffCelestials` | tendril | already |
| Chorus Engine | `rallyBuffAttachments` | tendril | already |
| Paragon, Standard Bearer | `onRallyBuffOnePerTribe` | authored source def (`sourceBuffDefFor`) | authored — kept (now also plays from a last slot) |
| Crypt Drake | `onAllyAttackBuffAll` | tendril | already |
| Raptor | `onFriendlyAttackBuffTribe` | tendril | already |
| Rouge Rogue | `onImpAttackBuffImps` | tendril | already |
| Traveling Skald | `onTribeAttackBuffAttacker` | tendril | already |
| Errand Fiend | `rallySummonImpBuffImps` | tendril | already |
| Trophy Stalker | `rallyTribeAuraGrowing` | tendril (aura) | already |
| Flamebanner Marshal | `rallyGiveTribeAttackOfHighestAttackHand` | **nothing** (label) | **FIXED** |
| Better Bot (welded) | `rallyMechAtk` | **nothing** (label) | **FIXED** |
| Bloodlust (weld) | `bloodlustRally` | **nothing** (label) | **FIXED** |
| Mineral Master, Blazer, Boulderdash, Crownvein Vanguard | Rubies | gem | authored — kept |
| Warflame, Flamebeat Drake, Hoardbreaker Drake, Ashen Broodlord, Watcher | cast a spell | the spell's own cue (`authoredBuffDefFor`) / spell tendril | kept |
| Cinderchef, Packstrider, Kindled Sprite, Thundeer, Evolving Abomination | self | self pulse (Kindled Sprite **FIXED** from label) | self |
| Demon Horse, Roarcollector, Neptus, Badgington, … | shop / hand / gold grants | own cues | n/a |
| Shop Rally (Lasting Cadence / EoT replays) | beat path | the fired effect's own cue | n/a (#1504) |

### Watchers (on-summon, on-friend-death, on-kill, on-tribe-played, spell-cast, orbit, …)

| Card | Trigger · effect | Phase | Before | Action |
| --- | --- | --- | --- | --- |
| Beardsley, King Oona, Den Mother, Groveweaver, Chef Gary Toast, Hank Pepe, Broodwright | `onSummon` buffs | both | tendril / capture | already |
| Ashen Heir | `onSummon` / friend death `impInherit*` | combat | **nothing** (label) | **FIXED** |
| Karthus, Forsaken Mage, Deathswarmer | Undead Attack run-wide | both | aura wash | n/a (aura, not a unit grant) |
| Archmagus Guel, Earthbreaker, Runekeg, Fatecarver, Astral Spellcore, Zenith | `spellCast` buffs | shop (+ combat for Guel-likes) | capture / tendril | already |
| Aspect | `onTribePlayed` | shop | capture (resting centres, #1483) | already |
| Orbiting Familiar, Equinox Channeler, Constellation Tender, Celestial Crucible, Worldline Weaver, Twinlight Orbiter, Starweft Familiar | `orbit` / `orbitFired` buffs | shop | capture | already |
| Hunter, Sergey (`onGainAttack`) | reactions | shop | capture (nested) | already |
| Cratering Hulk, Squatimus, Flowing Monk | `summonOverflow` | shop | capture | already |
| Rising Tide | `onRise` | shop | capture | already |
| Gangplank | `onGainCard` | shop | **nothing** (uncaptured) | **FIXED** |
| Twinning, Zenith (starform) | starform watchers | shop | capture | already |

### Avenge (combat)

| Card | Effect | Before | Action |
| --- | --- | --- | --- |
| Obsidian Drake | `avengeGiveAttack` | tendril | already |
| Brood Matron | `avengeBuffImps` | tendril | already |
| Solaris, Solaris Fang | `avengeShieldAttack` | Ward + self | n/a |
| Kennelmaster, Broodwright, Steadfast Champion, Muster General, Dunkey, Endless Overseer | summons / improves | summon cues | n/a |
| Gem Portsmith, Gemstorm Instigator | Rubies | gem | authored — kept |
| the rest | gold / spells / spell power | own cues | n/a |

### Shout (shop on play; combat via Parting Cry / Ryme / Dawnclaw / Combat Prowess replays)

| Card | Effect | Before | Action |
| --- | --- | --- | --- |
| Wishing Star, Hoard Cleric, Warhorn Captain, Twilight Emissary, Brood Whelp, Baby Gastrid, Imp Overseer, Attachment Mechanic, Tidebud, Limelight, Conductor | direct grants | capture → tendril (shop), uid cast (combat) | already |
| Broodfire, Karwind, Bathing Matriarch (`onBattlecryBuffTribe`) | authored `minionBuffed` defs | authored | kept |
| Frenzied Excavator, Deepvein Tender, Alchemist Brisbane | Rubies | gem | authored — kept |
| Deathswarmer, Cinderwing Matron, Wardkeeper | run-wide / spell power | aura / flourish | n/a |

### On-sell / on-buy / Gold-spent / Start of Turn (shop)

| Card | Trigger | Before | Action |
| --- | --- | --- | --- |
| Brightwing Broker | `onBuy` `buffBoardOnBuy` | capture (coalesced per target) | already |
| Stardust Peddler | `onBuy` starform-or-buff | capture | already |
| Flame / Tide / Grove Reveler | `onSell` `revelerSell` | **nothing** (uncaptured) | **FIXED** — from the sold slot |
| Billings, Coinfire Forewoman | `goldSpent` | **nothing** (uncaptured) | **FIXED** |
| Feastmaster Vhal, Korok, Mountainbond | shop slot / Fodder / Rubies | own cues | n/a |
| Shift Broker, Arcane Behemoth | `minionSold` self | self | n/a |
| Start of Turn — Roundabout, Fel Conjurer, Double Dealer, Jumpstart Jules | no stat grant to units | — | none exist (runes/quests keep their rail ribbons) |

## Judgement calls (flagged for the owner)

- **No extra lead in the shop.** Combat already holds the ribbon back `DR_BUFF_LEAD` so the death reads first. In
  the shop the body already sat a beat (the two-step death) and the skull fires at ~0 ms, so the ribbon leaves
  as the body dissolves rather than after a further hold. Easy to add a lead if it reads rushed.
- **Stacked Wolvies stay one summed buff**, attributed to the first Wolvie that queued — one ribbon, not two, so
  the log shape does not change.
- **Kindled Sprite / Handbound Titan** self-gains were switched from name to uid on the way past: with a label
  they were classed as bodiless other-buffs and drew neither a tendril nor the self pulse.
- **`deathrattleBuffers.ts` deleted** rather than left as dead code — the descend routing it fed is gone.

## Tests

- `packages/ui/src/choreo/echoTendrils.test.ts` — Dawn Sentinel (the pinned regression: uid-sourced cast after
  the death → `resolveBuffSource` from the last rect → `tendril-trail-celestial`), Noggin + Grim, the resolver's
  label / never-rendered / live-wins cases, Flamebanner Marshal (Rally), Ashen Heir (watcher), Wolvie.
- `packages/sim/src/echoBuffFx.test.ts` — a shop destroy keeps `sourceUid` on the `deathrattle` capture; a
  spell capture stays sourceless; Billings + Coinfire Forewoman (Gold spent) and a Flame Reveler sell are
  captured.

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` green; `npm run beats:audit` clean (every
row covered). Live (this worktree served on its own port): a Graverobber destroy of Dawn Sentinel in the shop
fired `tendril-trail-celestial {source: ds1 → ws1}` from the departed slot; selling a Flame Reveler fired
`tendril-trail-spirit {fr1 → tb1}`. The combat replay could not be driven in the agent's embedded browser pane
(rAF never ticks while the pane is hidden, so the first lunge never lands) — the combat half is covered by the
unit tests above and should be eyeballed in a Practice fight with Celestials.
