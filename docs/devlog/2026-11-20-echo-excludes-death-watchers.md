# 2026-11-20: a friend-death watcher is not an Echo; Brood Matron reworked

**Owner report:** "an echohorn just triggered a brood matron - that shouldnt happen since it is not an echo".

**Cause.** Both phases' `hasEcho` (and every "has an Echo" read in combat, Shop, UI) treated ANY `onDeath`
effect as an Echo. Friend-death watchers (`onFriendDeathSummon`, `impInheritOnDeath`, `onFriendDeathGainEcho`)
ride the `onDeath` bus too, so Echohorn spent its trigger on a left-most watcher (which then no-ops on its own
"death") instead of the real Echo to its right. Same leak in Echo Mimic copying (it copied watchers), Echo
stripping, Aftershocks-style "an Echo fired" runes on a watcher's death, and Echo tallies.

**Fix.** One predicate, `isEchoEffect` / `hasEchoEffect` + `DEATH_WATCHER_FACTORIES` in
`packages/core/src/effects/echo.ts`, read by every Echo consumer in core, sim and ui. The shop's friend-death
broadcast reads the same set. The wide reading stays (any own-death effect is an Echo). Deathsayer's strict
`deathrattle*` reading is unchanged. Doc Bot's fire-site scanner treats an `isEchoEffect(` gate as `onDeath`.
Oracle: R-ECHO-WATCHER-01 (triggers.ts).

**Brood Matron rework (owner, same PR).** "Avenge (2): Summon an Imp and give your Imps +1/+1 this game."
Gilded (assumption): 2 Imps and +2/+2. `avengeBuffImps` gained optional `summon` + `tokenId` params (summon first,
then buff, so the new Imp takes it). The `onFriendDeathSummon` factory is deleted (no other user). Avenge for
minions is combat-only, as before. Note: gilded is self-feeding (2 Imps per 2 deaths), bounded by the fight.
