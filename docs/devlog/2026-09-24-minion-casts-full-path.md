# 2026-09-24 — A minion's Shop / End-of-Turn cast is a full cast

Owner ruling 2026-09-24, on the End-of-Turn minion-cast gap two earlier sessions found: *"fix that for all"*.
Oracle rule **R-MINIONCAST-01** (`packages/rules/src/registry/approved/triggers.ts`).

## The bug

Three recruit factories cast a spell through a shortcut: they called `applyCastEffects` (the spell's own `cast`
effects) and bumped `spellsCast` / `spellsThisTurn` by hand, skipping the real `castSpell()` function:

- `castSpell` (Rope Wrangler's End-of-Turn Lasso, Soul Defiler's End-of-Turn Staff of Guel),
- `endOfTurnCastSpellOnSelf` (Arnold's Beefy),
- `endOfTurnCastSpellEscalating` (no live card; the factory is kept).

So these casts never reached what lives in `castSpell()` and `noteSpellCast()`: Rune of Lassoing's +2/+2 (the
pinned known gap from #1680), Spellweaving, Lorekeeping, Spellhide, the `spellCast` / `spellCastNonAle` /
`anySpell` rune thresholds, Charted Skies / Astral Refrain, the per-cast Shop-spell runes (Kindling, Scales,
Flagship, Summoning, Might), every `spellCast` watcher on the board or in hand (Runescale, Guel, Runebloom…),
the Ruby+Spell umbrella (`fireOnRubyCast`), and the first/last-spell copy memory. #1682 had patched Goldilox
alone in with a narrow hook (`fireShopSpellGrowers`).

## The fix

- Each of the three factories now calls `castSpell(state, spellDef, target, origin)` once per repetition. The
  hand-rolled tallies and the Goldilox hook are gone (`fireShopSpellGrowers` deleted); Goldilox still grows
  through `noteSpellCast`'s board + `alsoInHand` watchers (goldilox.test.ts End-of-Turn case, unchanged).
- `minionCastTarget` picks the target: a TARGETED spell aims at the carry (highest-Attack other friend, or the
  caster on a lone board), as before; an UNTARGETED spell (Lasso, Staff of Guel) now gets no target. Before, the
  carry was handed down as `self` and ignored by those factories; passing it to `castSpell()` would have made the
  carry "cast on" (Lorekeeping +3/+3, a Mirrorwing re-cast), so it is dropped.
- The presentation tags are unchanged: `castSpell()` → `applyCastEffects` still records `castFx`, tags buffs with
  `spellId` / `castByUid` and keeps the `board:<uid>` Lasso origin.
- The shop arena's `castRepeat` (a Rally replayed in the Shop that casts Growth inline: Fatecarver, Hoardbreaker)
  already counted through `noteSpellCast`; the only `castSpell()` payout it lacked was Spellweaving. The
  measurement is split into `spellweaveSnapshot` / `settleSpellweave`, shared by `castSpell()` and `castRepeat`.

## Judgement calls (flag for the owner)

- **Cast multipliers do NOT apply** to a minion's cast (Yazzus, Spell Thesis, Orivax, Ancient Runes). They live in
  the reducer's hand-play path, and every other no-aim cast (`castSpellWithoutAim`, rune casts) resolves once too.
  A minion cast does, however, spend a live Living Grimoire charge (as rune casts already did), since
  `noteSpellCast` consumes it.
- **Rune of Might's** own Might of Aeon cast stays a bare `applyCastEffects` behind its `runeMightCasting` guard:
  routing it through `castSpell()` would make every spell pay Kindling / Scales / thresholds twice. Its comment
  claims "the spell counters see it", which is not true today; left for an owner ruling.
- The reducer's reward-spell (Copycat) and Gift branches call `applyCastEffects` on purpose (documented
  "resolves once, no bookkeeping" / "bookkeeping via `noteSpellCast`") and were not touched.
- A minion cast can now be the turn's FIRST spell, so Rune of Recurrence / Mushy / Steward of Spells / Runesnout
  Archivist can remember a Lasso or Staff of Guel cast at End of Turn, the same as a hand cast.

## Combat audit

Combat minion casts already go through one funnel: `castInCombat` (factories.ts) calls `ctx.castSpell(side)` (the
tally, Rune of Enchantment, the `spellCast` bus) and `ctx.spellResolved` (Goldilox) per repetition; the arena's
`castRepeat`, `castNamedSpellInCombat` and `resolveCombatSpellCast` all use it. No change needed.

## Verification

- New `packages/sim/src/minionCastsFullPath.test.ts`: Rope Wrangler + Rune of Lassoing pays +2/+2 once; an
  untargeted Lasso is cast on nobody; Soul Defiler, Arnold and the escalating caster each pay Rune of Kindling
  and Runescale's `spellCast` watcher exactly once and count exactly once; a Shop Rally casting Growth feeds
  Spellweaving. All five fail on the old code.
- The #1680 known-gap test in `spellFxEverySource.test.ts` is flipped (the board now gains +2/+2).
- No golden or replay test moved; the RNG draw order of existing scenarios is unchanged (the new draws only
  happen when a newly-reached watcher or rune draws).
