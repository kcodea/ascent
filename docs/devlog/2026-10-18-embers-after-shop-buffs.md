# Rune of the Embers resolves after every other shop buff (2026-10-18)

Owner report (Kevin, with the rune tooltip): "this rune should happen after all buffs are applied etc, like
veinstorm, stat buffs etc etc".

**Before.** `applyShopRefreshed` doubled the right-most Shop minion's Health inside the refresh tail. Anything that
landed later in the same action added on top of the undoubled Health: a Shop spell's cast watchers (Rune of Infernal
Ink after Sigil of Kinship read 2h + 1), Start of Turn effects after the turn-start roll, and Pete's contraband,
which replaced the doubled offer so the doubling was lost.

**After.** The refresh only PINS its right-most minion (`RunState.embersPending`, per-action scratch). The doubling
is a post-buff phase, `resolveRefreshMultipliers` (recruit.ts), which `reduce` runs once right after `reduceCore`
and before the boundary diffs (so the Starform gain remainder and the shopStats tally still see it in the same
action). A pin that left the Shop falls to the current right-most only for the action's last refresh. No RNG is
consumed, so seeds and goldens are unchanged.

**Not covered (boundary-only writers).** The quest ticks and Shout meters that `reduce` runs after the phase
(Bane's Presence, Merchant's Chorus, quest rewards) still land after it. None of them fires on a refresh action
today.

Rule: R-EMBERS-LATE-01 (ordering). Tests: `packages/sim/src/embersAfterShopBuffs.test.ts`.
