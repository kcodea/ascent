# 2026-09-24 — Owner rulings: Gilded Wolvie, Humphry, Karwind, two rune archives, Spare Forge set scoping

Five owner rulings in one branch (`feat/owner-rulings-0924`).

## What changed

- **Gilded Wolvie** ("give 1 beast +4/+8"). The Echo's keyword rider (`deathrattleBuffRandomTribe` in
  `packages/core/src/effects/arena.ts`) used the house keyword-grant gild: 2 different Beasts, each doubled. It
  now reads an optional `goldenTargets` param that overrides the gilded body count; Wolvie sets
  `goldenTargets: 1`, so a gilded Wolvie gives ONE Beast +4/+8 and Rise. Plain Wolvie and the other users of the
  factory (Noggin, the Celestial T1) are unchanged. Golden text: "give a **Beast** **+4/+8** and **Rise**". The
  contract extractor now reads the gilded delta as a plain x2 (was "reshape"). Oracle R-ECHOKW-01 amended.
- **Humphry** ("make humphry - Shout: Give a friendly Dragon +5/+5"). +3/+4 → +5/+5, gilded +10/+10. Text keeps
  the house form (`**Shout:** give a friendly **Dragon +5/+5**.`); the split-bold form the ask was typed in trips
  the Doc Bot text parser.
- **Karwind** 4/12 → 2/8. Stats only; tier, Ward, effect and text unchanged. The set-2 strategy census moves one
  body out of the tempo engines (6 → 5).
- **Rune of the Grave Orbit + Rune of the Full Hand archived** ("remove them"). The Set 3 rune cut left both in no
  set (`sets: []`); they now live in `ARCHIVED_RUNES`, still resolvable through `RUNE_INDEX` for saves and
  replays. Their presentation-policy entries were removed like every other archived rune's. `RUNES` 158 → 157;
  the Set 3 cut test drops them from its named list (26/28 → 25/27).
- **Spare Forge / Runic Passage** ("limit to the runs own set only"). The `grantRune` reward drew from the whole
  rarity list, so a Set 3 run could be handed a Set-2-only Ruby/Ale rune. It now filters to runes offered in the
  run's PINNED set (`setIdOf(state)`, no `sets` = every set), the same scope test the Runeforge uses. Archived
  runes were already excluded (they are in neither array). Seeded RNG unchanged. New oracle rule **R-RUNE-17**.
  The tribe gate is deliberately NOT applied (the ruling names the set only).
- **R-HERO-01** gains the owner's confirmation ("yes keep it that way") that Mimic / Power Shifter must not offer an
  archived hero's power (built in #1697).

## Replays and saves

The grant now draws from a smaller pool, so the same seed can land a different rune. No golden/replay test pinned
the old draw. Recorded runs are safe: `ownedRunes` is stored run state, and replay v2 is a pure state recording
(no `reduce()`, no RNG), so past runs keep the rune they were handed.

## Verification

New `packages/sim/src/ownerRulings0924.test.ts` (Karwind, the archive, the set-scoped grant across 40 seeds x 3 sets,
determinism; the grant tests fail on the old reducer). Wolvie gilded tests rewritten in
`beastDragonBatch0924.test.ts` (shop, 6 seeds) and `beastBatchAug12.test.ts` (combat); Humphry tests at +5/+5.
`contracts:extract` re-run. `final-report.md`: only the contract total moved (1047 → 1045, the two archived
runes); `docbot:report -- --check` needs that literal in the prose (and the SABOTAGE test forbids a placeholder for
it), so the one contracted-objects sentence and the text-classification row now say 1045. No rule count was
touched (those are generated placeholders). Gate: typecheck, lint, test, build:web, `docbot:report -- --check`.
