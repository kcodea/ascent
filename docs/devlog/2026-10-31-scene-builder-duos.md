# 2026-10-31 · Scene Builder Duos: a placeholder teammate, held locally

Owner ask 2026-10-31: "scene builder needs a duo toggle which gives a placeholder teammate to view their board and pass
things to, a button on the builder tuner to have the teammate pass to you, and the duos minions and spells in the
shop/list when active". Branch `feat/scene-builder-duos`. Rule R-SB-DUOS-01 (approved/foundation.ts). DEV only, no patch
note.

## What

- **Duos toggle** (Setup): relaunches the rig with `createLobbyRun(..., runOpts: { duos: true })` (new optional arg), so
  the run carries `duos` and stocks the set's Duos pool exactly as a Versus Duos run. Persisted (`ascent.sb.duos`).
- **The placeholder teammate** (`packages/ui/src/sbDuos.ts`, in the Scene Builder's lazy DEV chunk): a second run in the
  browser, seeded off yours (`sbMateSeed`), another playable hero, your tribes, your set, God Gold under God rules.
- **The local team channel** (`packages/ui/src/sbDuosChannel.ts`, pure): ships each new outbox entry both ways through the
  SAME run actions a match uses (`receivePass`, `passRefunded`, `noteMateTribes`), mirroring the Worker's refusals
  (`hand_full` for a drag pass, `golden` except a `sale`, the per-round caps). Combat team effects (`combatIdx`) are held
  until the replay reaches their `teamSend` beat, as `duosPasses.ts` holds them.
- **The real Duos UI on top**, via one seam (`versus/localMate.ts`): `DuosMateDock` (faces), `teammateView` (the swap and
  its cross-fade), `duosPassUi` (hand-full refusal, never "away"), `duosPasses.duosReleaseCombatFx` + `useDuosCombatSync`
  (real-time combat release). Nothing installs the seam outside the Scene Builder.
- **Viewing the teammate** puts their run in the store (mine held aside; `useSpectate.teammate` holds the board key, as
  the real view). Unlike a match, their screen is LIVE: every rig tool and every play edits their run, and a drag onto
  your own portrait passes to you. Their run never fights: End Turn / the clock on their screen takes you back
  (`localMateRefuses`, checked in `dispatch` and `preparePresentationAction`).
- **Teammate section** (tuner): pass you a picked card (lands in their hand, then their real `passCard`), a random hand
  card, a random board minion (`passMinionToTeammate`, an effect pass); sells a minion (Hippie Hulk); fill / empty their
  hand; empty their board.
- **Library**: with Duos on, `duosCardRowsFor` adds the Duos-only minions and spells (tagged `duos`); the rune list shows
  Duos runes only while Duos is on (they never apply to a non-Duos run anyway).

## Judgement calls / out of scope

- Tag-team combat is out of scope: the teammate's run never fights, so their turn never advances (their wave stays 1).
  Turn-keyed team effects (Playing Catch's round, Brian's Pal's per turn) read the sender's wave as in a match.
- "Teammate casts / plays" was not added as a button: viewing their board lets you play any card as them.
- Playing on the teammate's screen records into the rig's replay capture (sandbox only, never uploaded).
- The `you` portrait name is "You"; the teammate's is "Placeholder".

## Verification

`sbDuosChannel.test.ts` (parity with the Worker path: drag pass + Hitchhiker on both sides, Richmond + Share the Wealth,
hand-full refusal and refund, effect pass waiting, golden guard, both directions, exactly-once, combat hold) and
`sbDuos.test.ts` (the store: toggle, both-way passes, tuner pass and sale, view swap, End Turn refusal, full-hand refusal,
teardown). Headless Playwright on a local dev build: the toggle, a tuner pass streaming in, a drag pass onto the portrait,
the teammate view and back.
