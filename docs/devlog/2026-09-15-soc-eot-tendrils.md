# Start of Combat / End of Turn buffs show their source (audit + fixes)

Owner ask 2026-09-15: every Start of Combat and End of Turn effect that **grants stats to other units** must
present as the tribe tendril-trail from the source minion to **each** recipient. Self-buffs, summons, damage,
Ward grants and non-stat effects keep their cues.

## What the audit found

Both phases already funnel buff-others through ONE shared renderer, `fireBuffFx` (`packages/ui/src/buffFxRender.ts`),
which picks the per-tribe `tendril-trail-<tribe>` off the SOURCE card and falls back to the base `tendril-trail`:

- **Combat**: a `buff` event per recipient with `source` = the buffer's uid → `groupBuffCasts` (one cast per
  recipient) inside a `buffWave` moment → `fireBuffCasts` → `fireBuffFx`. Start-of-Combat waves compile before
  the first `attack`, so the stats read before the clash.
- **Shop**: a `statsChanged` consequence per recipient under the buffer's own trigger → the `statsChanged`
  presenter → `statGain(from = the minion)` → `fireBuffFx`.

So most rows were already right. What was NOT right was the **signal** three sources handed those paths:

| Source | Bug | Fix |
| --- | --- | --- |
| Old Timber (`scBuffTribePerTally`, combat) | buff `source` was `self.name` — a LABEL, which the replay treats as bodiless → drew nothing | `self.uid` (`packages/core/src/effects/factories.ts`) |
| Emissary — United Front (combat SoC) | label-sourced, not rune-prefixed (no sparkle), no authored def → nothing | `HERO_POWER_BUFF_LABELS` in `choreo/bindings.ts` + a branch in `fireBuffCasts`: base tendril from the hero-power button, per recipient, through `fireBuffFx` |
| Aevor — Tempest (shop EoT) | fired inside a PLAIN `collector.withTrigger` → a beat with NO consequences → stats landed silently at commit | `withRecruitTrigger` (the diffing scope) → one `statsChanged` per end minion → new `heroPowerGain` presenter → tendril from the power button |

Plus: the shop `statGain` presenter now measures **resting** centres at both ends (the rule #1483 set for the
per-action replay), so an End-of-Turn ribbon aims at the slot rather than at a card mid-pulse.

## Audit table

Card · phase · current presentation · action.

### Combat — Start of Combat, minions

| Card | Effect | Current presentation | Action |
| --- | --- | --- | --- |
| Kennelmaster (Beast) | `scBeastAura` | generic **beast** tendril per Beast; self → self pulse | already — no change |
| Thunderous Sovereign (Dragon) | `scBeastAura` | generic **dragon** tendril | already |
| Pack Leader (Beast) | `scTribeBuffImproving` | generic beast tendril | already |
| Runescale Drake (Dragon) | `scTribeBuffPerSpellImproving` | generic dragon tendril | already |
| Bucky (Dwarf) | `scTribeBuffPerAle` | generic **dwarf** tendril | already (pinned by test) |
| Drunken Oaf (Dwarf) | `scBuffRandomTribePerAle` | generic dwarf tendril per rep target | already |
| Speed Demon (Demon) | `scBuffAlliesPctSelf` | generic **demon** tendril | already |
| Old Timber (Spirit) | `scBuffTribePerTally` | **nothing** (label source) | **FIXED** → spirit tendril per Spirit |
| Kobe (Kobold) | `scPlayRubiesSelfAndAdjacentTribe` | authored `ruby-gem-apply` per recipient; tendril stands down under the gem (owner 2026-08-02) | authored — kept |
| Taurus / Taurus the Truth Bringer | `scEngrave*` | Engrave (keyword) | skipped — non-stat |
| Handbound Titan, Abhorrent Horror, Daybreak Acolyte | self gains | self pulse | skipped — self |
| Twilight Sentinel, Gravewarden, Runebloom, Arena Heckler, Horizon Sentinel, Bloodbinder | keyword / Rise / Taunt / damage | own cues | skipped — non-stat |
| Imp Wrangler, Mirrorhide Rhino | summon | summon cue | skipped |
| Spots, Grave Body, Quil | fire an Echo / a hand spell | the fired effect's own cue | skipped — not a direct grant |

### Combat — Start of Combat, runes + hero powers

| Source | Current presentation | Action |
| --- | --- | --- |
| Rune of the Five Banners | rune badge burst (`runeTriggered` → `rune-burst`) + `rune-buff-unit` sparkle **per recipient** (owner 2026-08-19) | authored — kept (pinned by test) |
| Rune of Held Strength · Tempered Time · the Underdog · Stoked Menagerie | same | authored — kept |
| Rune of Warding | Ward blast + self Health (source = the lead's uid → self pulse) | skipped — self / Ward |
| Rune of the Vanguard · Centerline | Ward + Critical Strike | skipped — non-stat |
| Rune of Sylus | self | skipped |
| Emissary — United Front | **nothing** | **FIXED** → base tendril from the hero-power button, per recipient |
| Rune of Twilight / Uron extra passes | each pass is its own `buffWave` | n/a |

### Shop — End of Turn, minions

| Card | Effect | Current presentation | Action |
| --- | --- | --- | --- |
| Kringle (Dwarf) | `endOfTurnBuffEndsTribePerCard` | `statsChanged` per end Dwarf under Kringle's beat → dwarf tendril | already; now aimed at resting slots (pinned by test) |
| Striker (Dwarf) | `endOfTurnBuffAdjacentPerCard` | dwarf tendril per neighbour | already |
| Mother Moss (Spirit) | `endOfTurnBuffRandomTribeRepeatPerPlayed` | spirit tendril per pick (self pick → pulse) | already |
| Skybound Archivist (Dragon) | `endOfTurnBuffWeakestDragon` | dragon tendril (self → pulse) | already |
| Combat Prowess replaying a minion's SoC | nested minion beat → same `statGain` path | already |
| Roundabout | `endOfTurnStarformConsumeAllShop` | `starform-pull` (owner 2026-09-12) | authored — kept |
| Soul Defiler | `buffShopPermanent` | `shopChanged` → shop float + tavern gust | shop offers — kept |
| Maw of the Pit | `battlecryBuffFodder` | Fodder (shop token) | skipped — shop slot, no board unit |
| Ritualist · Void Curator · Aeon Guard | Fodder/Imp aura · spell power | aura wash / spell-power flourish | skipped — aura, not a unit grant |
| Alchemist Brisbane · Wardstone Jeweler | Rubies | gem cascade | authored — kept |

### Shop — End of Turn, runes + hero powers

| Source | Current presentation | Action |
| --- | --- | --- |
| Rune of Action | rune beat → gold rail ribbon (`questTendril`) **per recipient** + `rune-buff-unit` sparkle | authored — kept (pinned by test) |
| Rune of Spending | same, one step per Gold | authored — kept |
| Combat Prowess replays of Five Banners / Underdog / Stoked Menagerie / Warding | rune-sourced beats → rail ribbon per recipient | authored — kept |
| Rune of the Reliquary · Lasting Cadence | fire an Echo / Rally | the fired effect's own cues | n/a |
| Aevor — Tempest | **nothing** (no consequences emitted) | **FIXED** → `heroPowerGain` tendril from the power button, per recipient |
| Combat Prowess replaying United Front | `statsChanged` under a hero beat → nothing | **FIXED** (same presenter) |

## Judgement calls (flagged for the owner)

- **Runes keep their authored cues** (badge burst + sparkle in combat; rail ribbon + sparkle in the shop) rather
  than gaining a tribe tendril — a rune has no minion to leave from, and both cues were owner asks
  (2026-07-21, 2026-08-19). Each recipient still gets its own cue.
- **Kobe keeps the gem.** Its Rubies are told by `ruby-gem-apply` per landing; the tendril is deliberately
  suppressed under a gem (owner ruling 2026-08-02, Frenzied Excavator).
- **One `buffWave` moment per wave in combat, one ribbon per recipient inside it** — the existing convention
  (`collapseRuns: buff`). Splitting Start-of-Combat waves into one moment per recipient would re-pace every
  buff wave in the game (Shouts, spells) and was not done.

## Tests

`packages/ui/src/choreo/socEotTendrils.test.ts` — Bucky, Kobe, Old Timber, Five Banners, United Front (combat);
Kringle, Rune of Action, Tempest (shop). Each proves one signal per recipient from the right source.
