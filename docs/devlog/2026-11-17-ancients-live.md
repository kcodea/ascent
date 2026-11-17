# 2026-11-17 — Ancients switched ON

Owner: "okay turn on ancients". `ANCIENTS_LIVE` in `packages/sim/src/ancientsRelease.ts` is now `true`, and
`VERSUS_CF_PROTOCOL` went 4 -> 5 in `workers/versus/src/protocol.ts` (rules change with no content change; the
`ancientsReleaseProtocol` tripwire enforces it). Every NEW run in Sets 2 and 3 (ranked, casual, Practice incl. God
Mode, Gauntlet, Versus 1v1 / group / Duos / Ranked Duos, generated and bot seats) starts with the Ancients meter.
The tutorial stays off; heroes without pairings (Runesmith, Guardian) are archived while the switch is on.
In-flight, saved and replayed runs keep what they pinned. The Versus Worker v5 ships with the next build
(`release:web` / the exe build deploys it). Turning Ancients off again: set the flag back to `false` and bump the
protocol again.
