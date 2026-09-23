# 2026-09-23 — Balance 9/23, tranche 5: rune reworks, group B (summon / board / token runes)

Nineteen owner items from the 9/23 balance batch, shipped on `feat/balance-923-rune-reworks-b`. Every rune keeps
its id; the texts are the owner's words (bolded, no dashes); the numbers that scale print live on the rune badge.
Two rune masters re-wired through `npm run art:wire --only=runes` (Rune of Full Measure, Rune of the Gem Golem;
the other 275 re-encoded webps the pass rewrote were restored, so the diff carries only the two new masters).

## The "Get X. Repeat at Start of Turn" family (R-RUNE-08)

Full Measure, Open Appetite, the Unbroken Vein and the Display Case swapped their `grant` for a
`recurringGrant` inside the same `multi` reward. The reducer's rune rule (an immediate copy on purchase, then the
every-turn list at each turn setup) does the rest; each rune's second half (the Attack grant, the any-type aim,
both Choose One effects, the left-most Shop enchant) is untouched. The Deep now pays its first Tier 7 minion at
the reward site through the same `payDeep` its turn setup runs. The Muckbroker is `multi: [grant, recurringGrant
everyTurns 2]`, so the first Muckslinger lands on purchase and the shared cadence keeps paying. Copies is a text
change only ("Start of Turn", which is what the mechanic always was).

## Combat-summon triggers that carry back (R-RUNE-06)

- **Packcraft** escalates: each combat summon gains the current level (starts +2/+1, `PACKCRAFT_STEP`) and the
  level grows by the step. Per side in `simulate` (`packcraftLevel`), carried back as `playerPackcraftLevel`
  only when it grew, persisted on `RunState.packcraftLevel`, seeded back in by `questCombatMods`. The badge
  prints the live grant (`runeTally`).
- **Reinvestment** is +3/+4 per summon (`REINVESTMENT_PER_SUMMON`, one constant for the mods builder and the
  badge). The combat mod became an object; the badge pulses on each friendly summon at the summon chokepoint;
  the Shop buff still pays once at settle on the permanent channel.
- **Beastial Swarm** grows the Beast AURA on every friendly Beast death: the same four lines The Old Hunt uses
  on an attack (both aura halves for the fight, both carry-back halves for the run, the living Beasts on the
  spot). Avenge (2) still raises the per-death amount.

## The rest

- **Slaying** pays every 5 kills; `SLAYING_KILLS` replaces two literals (settle + badge) (R-RUNE-07).
- **Hatchery** +5/+5. **Finality** 3 Imps.
- **Five Banners** is an End-of-Turn grant (+5/+4, one body per type): a boolean `runeFiveBanners` turned into
  virtual recurring-EoT entries by `recurringEotEffects`, exactly like the Lapidary; `bannerRecipientsOf` is now
  module-level and shared with the legacy Start-of-Combat replay and United Front. The old `runeFiveBanners`
  combat flag is no longer authored but the engine still reads it, so pinned replays / recorded seats resolve
  byte-identically (tested). The surface classifier and the policy registry re-keyed it to `:endOfTurn`.
- **Living Treasure** grants Rebirth (`RB`) to Gemheart Golems: at the bell (base pass only, not a "Start of
  Combat:" rune, so Twilight does not repeat it) and at the summon site. Replaces the exact-copy Echo graft.
- **Gem Golem** summons a real Gemheart Golem (1/1) plus the Kobold's Rubies, with or without Rubies. The Golem
  is itself a Kobold, so a dying Golem is excluded from the trigger; without that guard the chain never ended
  (the old Ruby gate was what stopped it).
- **Food Chain** reads the left-most living Demon when the first summon lands; the Start-of-Combat capture is
  gone and so is its slot in the Start-of-Combat rune pass.
- **Banquet Hall**: the turn's first buy (buffed or not) hands its current stats, in full, to 2 random other
  friendly board minions (seeded off the run cursor). Replaces the per-type dispersal.
- **Lassoing**: a Rope Wrangler grant + `runeLassoing`, read in `castSpell` after a Lasso resolves (any caster).
  The old `lassoing` End-of-Turn effect stays in the engine for saves that still list it; the policy registry
  re-keyed the rune to `:recruit`.

## Assumptions flagged for the owner

- Gem Golem: "with its Rubies" read as base 1/1 + Rubies, unconditional (Kurse's Golem already follows that
  convention). The old rune summoned nothing for a Ruby-less Kobold.
- Banquet Hall: "gives its stats" read as the full current stats to EACH of the 2 recipients (not split), the
  buyer excluded (it is in hand after the buy anyway), once per turn kept from the old cadence.
- Food Chain: "gains the stats of your left-most Demon" read as the Demon's CURRENT stats at the summon, and the
  rune left the Start-of-Combat pass because its text no longer begins "Start of Combat:".
- Beastial Swarm keeps its name spelling ("Beastial"); the owner wrote "Bestial".
- Muckslinger keeps the card's real name in the rune text (the owner wrote "Muck Slinger").

## Rails

`npm run contracts:extract` was re-run (the extracted registry + pending conventions had drifted on earlier
text-only PRs; the regenerated files are committed). Rules R-RUNE-06..07 appended to
`packages/rules/src/registry/approved/runes.ts`. Player changelog: one Balance entry, "Balance 9/23: rune
reworks B".
