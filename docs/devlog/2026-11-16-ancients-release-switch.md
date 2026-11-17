# 2026-11-16 — Ancients release switch (shipped OFF) + the release wiring

Owner, 2026-11-16: "Ancients will go live everywhere, so build the flip to turn them on/off as needed. When on, they're
live everywhere." Later the same day: "Ship the ancient switch off. I'll tell you when to turn it on."

So everything below is built and tested with the switch both ways, and **ships OFF**: no player run has Ancients.

## The switch

`ANCIENTS_LIVE` in `packages/sim/src/ancientsRelease.ts`, `false` today. **To turn Ancients on:**

1. set `ANCIENTS_LIVE = true`;
2. bump `VERSUS_CF_PROTOCOL` 3 → 4 in `workers/versus/src/protocol.ts` (a fight-rules change with no content change,
   R-VERSUS-WORKER-RULES-01). `packages/ui/src/versus/ancientsReleaseProtocol.test.ts` fails CI until you do;
3. add the player-facing patch note (none ships now: nothing is visible while off);
4. deploy the v4 Versus Worker with that build (`release:web` / `npm run versus:cf:deploy -- --persist`).

It follows the card-sets rule: read ONLY at run creation (`releaseAncients`) and pinned on the run as
`ancientsEnabled` + the meter. `deserialize` merges a save over a plain `createRun`, which never reads the switch, so a
flip never changes an in-flight, saved, restored or replayed run. The switch is deliberately NOT inside `createRun`:
that would have turned Ancients on for every restored pre-release save.

## Where it is read

- `createLobbyRun` (ranked + casual lobby, Practice incl. God Mode). `runOpts.ancients` overrides it; the Scene Builder
  passes `false` and keeps its own toggle (works with the switch off). The live-replay perf tool pins what the recorded
  game had (frame 0's `ancientsEnabled`).
- `createVersusRun` (1v1, Group, Duos, Ranked Duos). The DEV-only Duos seam became a DEV / bench meter override for any
  mode (`dev.ancients`, `versusDevAncients`); `dev.ancients === false` forces off.
- `createGauntletRun` (optional `ancients` override).
- Generated seats: `autoplayRun` (hybrid recordings, the pool bake; optional `ancients` override) and `botSeat`.
- Never: `createTutorialRun`. Gates: `ancientsSetSupported` (Sets 2 and 3; the Scene Builder's `sceneAncientsSet` reads it)
  and `heroHasAncientPairings` (all six written). **Runesmith and Guardian (`runeguard`) have no pairings, so they get no
  meter even with the switch on, until the owner writes them.**

## Bots answer the awakening (audit F5)

`autoplayRun` answers the offer after its other modals; the greedy bot (`bots/policy.ts decide`) and the production bot
(`pickAncient` is now `mandatory` + `reveal`; a new `ancient` mandatory kind in the visible state, candidates, controller
fallback and growth probe) pick; the Versus test bot answers it mid-shop and before a pass. The recorder and the greedy
bot take the offer's first option, which is already a seeded draw.

## Enemy Ancient visible (audit F4)

`BoardSnapshot.ancient` (`{ id, heroId, wave }`, `ancientSnapshotOf`) is captured with every board; `boardIntel` passes it
to `SeatIntel.ancient`. `FoeAncientLine` prints the Ancient's name + pairing text under the base power in the combat foe
tip (`CombatOpponent.tsx`) and the rail scout card (`LobbyPanel.tsx`). Boards without the field show the base power only.

## Recorded

- Match details: `MatchSeat.ancient` on every seat, `parseMatchAncient` on read (unknown ids dropped).
- Telemetry: `RunTelemetry.ancients` / `.ancient` from `lobbyRunTelemetry`, and the same keys in `derived`.
  Additive jsonb keys only: **no SQL** (no server-side key whitelist on `derived` or board snapshots). The Balance Report
  does not split by Ancient yet; the data is there for it.

## Tests

`packages/sim/src/ancientsRelease.test.ts` (both switch states, every door, pinning, F3 heroes, bots, snapshot, records),
`packages/ui/src/ancients/foeAncientLine.test.tsx`, the protocol tripwire. Test loops that drive lobby runs past the
awakening (God Mode, report sources, the Practice curtain) now answer the offer so they keep passing once it is on.
Oracle: R-ANCIENTS-RELEASE-01 (persistence), -02..04 (foundation).

## Open

- Runesmith and Guardian pairings (owner).
- Many `R-ANC*` rules' `currentBehaviour` still say "Dev-only (Scene Builder...)", still true while the switch is off.
