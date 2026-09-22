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

**IN — Sylus (review call, pending the owner's confirmation):** the rune's own text begins "Get a Sylus", but
the ability it grants is printed on the minion as "Start of Combat: double this minion's Health", so a player
holding Twilight reads it exactly as they read Underdog. The build left it OUT by the letter of the rune-text
rule; review flagged it as the same class of report waiting to happen (Sylus + Twilight would look "broken"
just as Underdog + Twilight did), so the fixer folded it IN: `runeSylus` fires on every pass (×4 Health),
pinned in `twilightRuneSoc.test.ts`. It stays a rune block rather than a real granted minion effect (that
would move its beat into the minion pass and change the no-Twilight log for every Sylus-rune fight, which the
byte-identical contract forbids), so Uron's minion-pass multiplier still does not see it. **If the owner wants
it OUT**, re-add `base &&` on the block, drop its `twilightPulse`, and flip the test.

**OUT — rune text says something else (base pass only):** Warden ("When you have room in combat, summon a
Spear Warden"), Dawnclaw ("Your Dawnclaws also trigger their Echo at Start of Combat"), Spellhide (archived).

**OUT — not runes:** Shared Circuit (also registers a listener), Weaken, United Front, Echoing Coop, Empty
Graves, and the pre-loop quest/hero grants (Rulebreaker's Crown, Possession, Umbral Energy, Contract Rewrite).

## Second-pass behaviour, pinned in `packages/core/src/combat/twilightRuneSoc.test.ts`

- **Underdog** re-sorts the living board by CURRENT Attack (board-order tie-break) — on `[1/1, 2/2, 10/10]`
  the same pair doubles twice (×4); on `[1/4, 5/8, 9/9]` pass 2 picks m0 (now 2) and m2 (9), not the 5/8.
- **Forthcoming** re-picks the living front; a Ward the first strike spent is granted again; nothing left to
  pick → no second trigger and no pulse. **First Claws**: the end Beasts strike again; a Beast lost on pass 1
  is not there to pick.
- **Crucible** APPENDS to the bank (was an overwrite, which would have dropped pass 1's bodies): on a 7-body
  board pass 2 destroys the NEXT three, one survives, and all six return when it dies. **On a board of six or
  fewer the second pass empties the board**: pass 1 takes three, pass 2 takes whatever is left, the side is
  empty, so the comeback fires AT Start of Combat (three `runeCrucible` triggers: pass 1, pass 2, the return)
  and the bank is spent before the first attack; there is no later return once the enemy kills them. The rune's
  late-fight value is gone on those boards. On a ≤3-body board pass 1 wipes the side, they return at once, pass
  2 destroys the returned bodies and they return again. All of this is the "all" ruling stated plainly and
  pinned for 3, 4, 5, 6 and 7 bodies. The alternative (skip the extra pass when fewer than three bodies remain)
  is an owner call, not taken.
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
  (`socRuneReplaysOf`) once per Prowess stack × Chronos repeat, WITHOUT a Twilight fold, while its MINION
  replays (`runeCombatProwessBeats`) DO fold Twilight. Its header comment claimed the rune replays mirrored
  combat; they no longer do, and the comment now says so. So Prowess + Twilight + Underdog is ×4 in combat and
  ×2 per turn in the shop. Folding Twilight there would compound Underdog ×4 / Warding ×9 / Sylus ×4
  PERMANENTLY every turn — an owner balance call, not shipped; the difference is now a STATED rule in
  `docs/GAME-RULES.md` ("Shop vs combat under Twilight"). If folded, multiply `prowessReps` at all three
  `socRuneReplaysOf` consumers (commit, projection, beat list) so they cannot drift. Pre-existing drift noted:
  `applyEndOfTurn` multiplies rune replays by Prowess stacks; the projection and beat list do not.
- **Uron** ("Start of Combats trigger 1 more time", card data) still multiplies only the minion pass.
- **Rune of Sylus** is IN as a review call (above); the owner may reverse it.
