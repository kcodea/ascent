# 2026-11-02 — Duos: the tag-team fly-in (R-DUOS-FLYIN-01)

Owner, from live Duos play with Mike: "the team flies in and fills the 7 slots from left to right. if there's no room,
there's no fly in. flying in after combat does NOT trigger start of combats or anything, but it DOES deal more dmg to
opponents as the filled in slots tally up for damage". Ruling: if the first board fell and the teammate's board stepped
in and won, NOTHING flies in.

**Before.** A new rule, not a missing animation: core `simulate` scored a tag-team win as the ending board's tier + its
survivors, and a reserve that never stepped in counted for nothing (and never appeared).

**Engine (`packages/core`).** After the fight is decided (after `finishLastDeathCopy`, before the outcome), a side that
won with its first board (`activeMember === 0`) and still holds its reserve gets `flownIn`: the reserve's left-most
bodies, `instantiate`d for identity and stats only (no `registerEffects`, no auras, no SoC, no summon hooks), as many as
fit in `7 - countLiving(side)`. One `flyIn { side, member, index, minions }` event (new in the `CombatEvent` union,
shared boundary, documented there). They are NOT pushed onto `boards`, so no carry-back (survivors, tallies, Engrave,
the enemy-seat mirror's survivor fold) ever sees them; they only join `survivorsP/E` for the damage and its itemized
breakdown (`survivorUids` lists them). Ordinary fights, draws and the loser are untouched; the 450-fight tag-team mirror
suite stays green (the fly-in is symmetric).

**Sim / server.** `resolveVersusDuosRound` and `resolveRankedDuosRound` pass the damage through unchanged, so both
modes (and Ranked Duos fights against recorded teams) get it from the one `simulate`. The `versusDuos` damage test now
expects the teammate's tiers. **The Cloudflare Versus Worker must be redeployed** to resolve live matches with it
(Versus is Cloudflare-only; do not redeploy the Supabase `versus-resolve`).

**Presentation (`packages/ui`).** `useCombatReplay` appends the bodies to the side's row and gives them the step-in's
own `.unit.tagin` class (the same one-shot, transform/opacity fly-in from the team's edge, staggered); a `flyIn` moment
kind with its own hold (`= tagIn`, 640). `heroStrikeNumbers` now returns the full damage formation for a Duos fight
(`lastCombat.tagTeam`; 1v1 / Group Versus keep the blow-only read), with the full blow from the breakdown's own sum
since the resolver capped `enemyDamage` on the winner's view, so each flown-in minion's tier rises from its slot and the
cap beat plays when the round cap cut it.

**Verified.** `tagTeamFlyIn.test.ts` (slots, order, index, damage + breakdown, triggers nothing, no carry-back, full
board, reserve already fought, loser / draw / ordinary fight, determinism + mirror), `versusDuos.test.ts`,
`rankedDuosRound.test.ts`, `damageFormation.test.ts`, and a real-workerd test in `workers/versus/test/it/room.it.ts`
(four clients get the identical round with the fly-in and a six-body damage breakdown).
