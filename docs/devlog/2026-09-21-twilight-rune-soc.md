# 2026-09-21 — Rune of Twilight repeats RUNE Start-of-Combat effects

**Owner report:** "Rune of Twilight just did not work with Rune of the Underdog. Why not?"

**Cause.** Twilight's extra pass (`simulate.ts`) iterated the board and re-fired only minion effects with
`on: 'startOfCombat'`. Every rune Start-of-Combat block (Underdog, Warding, Vanguard, …) was an inline
`if (rmods.runeX) { … }` in the same per-side loop and ran exactly once. Rune copies (`flagCopies`) did
double within the block, so two Underdog copies gave ×4 while Underdog + Twilight gave ×2.

**Ruling.** Twilight repeats all rune Start-of-Combat effects too: every rune whose printed text begins
"Start of Combat:" gets one extra pass per Twilight fire, in the same order as the first pass, exactly like
the minions do.

## The refactor

The per-side rune section is now one closure, `runRuneStartOfCombat(rside, pass)`, in the same block order
as before. It runs once with `pass = 0` (the base pass) and then `socTwilightExtraFires(mods)` more times for
that side, AFTER the whole base pass — the only placement that keeps a no-Twilight log byte-identical and lets
every second-pass block read the board the first pass left. The existing Twilight MINION pass stays where it
was (inside the base pass), so Twilight + rune boards keep their minion/rune interleaving. `twilightPulse` is
per-side state shared by the minion and rune passes: one `runeTwilight` badge pulse, on the beat of the FIRST
extra effect, minion or rune. Rune of First Claws lives in its own later loop (after the Avenge / Inheritance
/ Passing Spears listeners register, so its kills feed them) and repeats its passes at that site.

Rune copies still multiply WITHIN a pass (`flagCopiesOf` loops untouched); Twilight multiplies passes.

## Membership (by printed rune text)

**IN — 18 runes, text begins "Start of Combat:":** Mirror March, Waking Reserve (its text is unbolded, so a
grep for `**Start of Combat` undercounts at 17), Food Chain, Forthcoming, Five Banners, Centerline, Tempered
Time, Herald, Crucible, Underdog, Stoked Menagerie, Vanguard, Warding, Held Strength, Rallying, Rebirth,
Rising Graves, First Claws.

**OUT — rune text says something else (base pass only):** Warden ("When you have room in combat, summon a
Spear Warden"), Dawnclaw ("Your Dawnclaws also trigger their Echo at Start of Combat"), Sylus ("Your Sylus
gain Start of Combat: double this minion's Health" — the one open case: it GRANTS a minion Start-of-Combat
ability but is implemented as a rune block, so Twilight's minion pass never sees it; the parity fix would be
a real granted minion effect, out of scope), Spellhide (archived).

**OUT — not runes:** Shared Circuit (also registers a listener), Weaken, United Front, Echoing Coop, Empty
Graves, and the pre-loop quest/hero grants (Rulebreaker's Crown, Possession, Umbral Energy, Contract Rewrite).

## Second-pass behaviour, pinned in `packages/core/src/combat/twilightRuneSoc.test.ts`

- **Underdog** re-sorts the living board by CURRENT Attack (board-order tie-break) — on `[1/1, 2/2, 10/10]`
  the same pair doubles twice (×4); on `[1/4, 5/8, 9/9]` pass 2 picks m0 (now 2) and m2 (9), not the 5/8.
- **Forthcoming** re-picks the living front; a Ward the first strike spent is granted again; nothing left to
  pick → no second trigger and no pulse. **First Claws**: the end Beasts strike again; a Beast lost on pass 1
  is not there to pick.
- **Crucible** APPENDS to the bank (was an overwrite, which would have dropped pass 1's bodies): pass 2
  destroys the NEXT three and all six return on the wipe. On a ≤3-body board pass 1 wipes the side, they return
  at once, pass 2 destroys the returned bodies and they return again (the "all" ruling, stated plainly).
- **Rebirth / Rising Graves** skip bodies that already carry the keyword, so a second body gets it; none
  eligible → no second trigger.
- **Herald** triggers every Echo again. **Stoked Menagerie** re-checks the full house and doubles three more
  random bodies at their current stats. **Warding** ×9, **Tempered Time** twice, **Vanguard** keywords idempotent.
- A served ENEMY holding Twilight repeats its own runes. Two Twilight copies = two extra rune passes.
- Twilight with only minion Start-of-Combat effects emits the pre-ruling log (pinned inline); the base pass
  without Twilight was diffed pre/post on several rune boards: identical. No replay fixture or golden holds
  Twilight, so nothing was regenerated.

## Not changed, flagged

- **Rune of Combat Prowess (shop End of Turn)** already replays the rune Start-of-Combat blocks
  (`socRuneReplaysOf`) once per Prowess stack × Chronos repeat, WITHOUT a Twilight fold. Its header comment
  claimed this mirrored combat; it no longer does, and the comment now says so. Folding Twilight there would
  compound Underdog ×4 / Warding ×9 / Sylus ×4 PERMANENTLY every turn — an owner balance call, not shipped.
- **Uron** ("Start of Combats trigger 1 more time", card data) still multiplies only the minion pass.
- **Rune of Sylus** membership (above).
