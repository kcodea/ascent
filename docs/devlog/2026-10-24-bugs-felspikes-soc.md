# 2026-10-24 — Bug Board: Fel Spikes at Start of Combat (three reports)

Three older Bug Board reports on the Demon spray and Shout multipliers, each checked against current `main`.

## d3a682a6: Herald-fired Fel Spikes showed no spikes (FIXED)

Rune of the Herald ("Start of Combat: trigger all your Echoes") fires a living Fel Spikes' Echo directly. The
log has the rune's `questTrigger` and then the spray's waves. There is no `death` of the sprayer and no `rally`
targeting it. The `launchOnDeath` volley only launched from those two signals, but the damage beat still claimed
and hid the stock hit burst. So the spray landed with no animation.

Fix (presentation only, `packages/ui/src/useCombatReplay.ts`): `unsignalledEchoLaunch(shown, next, …)` finds a
`launchOnDeath` spray that opens on `next` with no launch signal. The cue effect launches the volley from the living
body as `shown` (the rune pulse) plays, using the rally timing. `echoDeliveryLead` holds the first wave for the same
launch plus travel. A golden second pass is a continuation of the same launch. A spray that a death or a rally
already launched returns null, so nothing is thrown twice. Oracle: **R-ECHO-LAUNCH-01** (`ordering.ts`). Tests:
`packages/ui/src/heraldEchoLaunch.test.ts` (Herald launch, golden continuation, death path untouched, Spots rally
path untouched).

The report's second claim (Fel Spikes / Gasket / buff beats felt broken) is already covered on main by #2074
(R-DEMON-DMG-BEATS-02, 2026-10-13). On a re-sim of the captured matchup, each pass is now its own beat and is
followed by its own reaction beat.

## 4657b2d2: Echohorn died to a Spots-forced spray before Rad Rachel's buffs (ALREADY FIXED)

The capture (build c4001453b, 2026-10-12) shows Spots' Start of Combat forcing Fel Spikes. The 4/3 Echohorn was
hit to 0, and every Rachel buff skipped it. #2074 (2026-10-13) added **R-DEMON-DMG-DEATH-01**: a pass lands whole,
then its reactions run, then deaths are checked. Re-simulating the captured `oddsInput` on current main gives the
Echohorn every Rachel buff, and it survives (no `death` event for it before the first attack).

## fb06e6d9: Blasting Voices gave extra Shouts in the Shop but not in combat (ALREADY FIXED)

Captured on build 6e2f97c24 (2026-09-29). #1933 (2026-10-03, **R-SHOUT-TRIGGER-01**) wired `shoutExtraAlways`
into every combat Shout ("no combat Shout heard the Choir" was the pre-fix state). The captured combat had no
Shout at all. Blasting Voices was also archived on 2026-10-07.

No engine change, so versus-resolve does not need a redeploy for this PR.
