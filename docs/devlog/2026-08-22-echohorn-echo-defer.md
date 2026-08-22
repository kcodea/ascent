# 2026-08-22 — Echohorn's forced Fel Spikes Echo: accumulate, held windup, stop-at-0

Echohorn (`b2_echohorn`, Rally: trigger your left-most Echo; golden = twice) triggering Fel Spikes' Echo now
behaves like a death-fired spray in every way — engine and presentation. Built with the owner across the
session; touches `packages/core` (Kevin's seam) and `packages/ui` (Mike's seam).

## Engine (Kevin's seam)

- **Forced triggers defer across all procs.** `ctx.withEchoDefer` is exposed and `triggerEcho`'s whole proc
  loop is wrapped in it, so a golden Echohorn's two rallies (and any Sylus/Funeral-Engine multiplier on top)
  accumulate onto ONE board with no death resolved between them — a Void Panther dies once and its cubs summon
  after, uncaught. A no-op for every forced trigger whose Echo isn't a Fel-Spikes-style deferred-damage spray.
- **Stop at 0.** `deathrattleDamageAllExceptTribe` now only damages a target still above 0: once a volley drops
  a victim to ≤0 it takes no further hits (no overkill number, no extra spike, no extra per-volley reactor
  proc — owner ruling 2026-08-22), but it STAYS on the board via the deferred death, so it still dies once and
  its tokens spawn uncaught. Net game outcome unchanged (same deaths/survivors); a unit that dies early just
  procs fewer per-volley reactors.

## Presentation (Mike's seam)

- **Volley launches from the LIVING body.** The `fel-spike` spike volley now fires on the rally (not only a
  death); `echoWaves` gained an `endIdx` bound so each rally claims only its own waves. Forced launches use a
  shorter `ECHO_RALLY_LAUNCH_DELAY_MS` (no skull to read) so the waves come fast one after another.
- **Held windup.** A swing whose own Rally fires a launchOnDeath spray now PARKS the lunge at the top of the
  wind-up (`playLunge` `holdAfterWindup`): the beat advances off the wind-up pause, the whole spray (both rally
  pulses + every volley + the deferred deaths) plays while the attacker holds its reared-back pose, and only
  then does it strike — or it dies in the held pose if the spray killed it. Normal swings byte-identical. The
  first volley waits out the rear-back (`ECHO_WINDUP_HOLD_MS`) before any spike flies.
- **Climbing number holds smooth.** The running-total float HOLDS on-screen and climbs in place while more
  volleys are still coming (`floatupchold`), fades on the last volley, and is removed when its victim dies — so
  a dead unit shows no tally. (Replaced an earlier per-volley remount that fixed the fade but re-popped.)

Verified: `simulate.test.ts` cases (gilded / Sylus / golden Echohorn each stop the Panther at ≤0 and spare its
cubs; a doubler dying to the Echo still doubles it). Full suite (6535) + determinism harness (identical) +
typecheck (pkgs + web) + lint (0 errors) + build:web all green.
