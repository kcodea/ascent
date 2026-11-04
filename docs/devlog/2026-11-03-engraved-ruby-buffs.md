# Engraved keeps each combat buff as itself (2026-11-03)

Owner report 2026-11-02 (Disco Dan, Facetwright + Kobold Bebes): "the engraved buffs didnt count as rubies", clarified
"the buffs that are rubies should be counted as ruby buffs." Then the owner broadened it (2026-11-03): "'Engraved' isn't
a buff type, it just makes buffs and enchantments gained in combat permanent. So if a minion is buffed by growth +20/20
it should just keep that growth +20/20." Rules R-RUBY-ENGRAVED-01 and R-ENGRAVE-05.

## Root cause

An Engraved body's kept combat gains were summed into one `permaGain` and settled as a single `Engraved` row on the run
card. Only a Ruby share (`permaRuby`) was split out, and `applyRubyStats` filled it from the raw Ruby amount and only on
the `EG` keyword. So:

- Every non-Ruby kept gain lost its source ("Engraved" instead of Growth, the minion's name, the rune's name).
- A golden Taurus (`gainMult = 2`) doubled the Ruby but only half was labelled Ruby; `rubyGain` also counted half.
- Transcendant engraves adjacent Dragons as a live aura (no keyword), so Rubies there went home as `Engraved`.
- Every "permanent" gift path guarded with `!keywords.includes('EG')`, so on a Transcendant-adjacent Dragon it added
  `permaGain` on top of the aura's accrual: kept TWICE (Rune of Engraving Gems, Kobe, Rosey, Second Wind, Drakko...).

## Fix

- `CombatContext.buff` returns `{ attack, health, kept }` (what landed after `gainMult`, and whether an Engrave kept it).
- When kept, `ctx.buff` books the gain into `Minion.permaRows` under `engravedLabelOf`: 'Ruby' for a Ruby, the casting
  spell's name, else the source body's name, else the grant's label (the Shop's own labels). `riseCarry` copies it.
- `carryBacksFor` emits one row per label (gains before losses), then the legacy split for any remainder. The reducer
  settles with the row's label first; an unlabelled row still settles as `Engraved` / `Flowing Monk`, so old results,
  saves and replays load unchanged. No state migration needed: existing `Engraved` rows on run cards stay as they are.
- `applyRubyStats` and the 12 permanent-gift sites read `kept` instead of the EG keyword (no double keep).

Tests: `packages/core/src/combat/rubyEngravedAttribution.test.ts`, `run.test.ts` (settle label). Versus Worker redeploy
needed (core combat change).

Not changed: grafted triggers gained in combat are still not kept (R-ENGRAVE-04 owner ruling 2026-10-24); the glossary
wording stays "Keeps all stats and effects gained during combat.". Non-Engraved permanent gifts still settle under their
old labels (`permaLabel` / "Flowing Monk"). The "blue" stat badges in the report are the 5000+ stat milestone frames,
not a Ruby marker.
