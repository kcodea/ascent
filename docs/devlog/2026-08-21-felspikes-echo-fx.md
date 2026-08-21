# 2026-08-21 — Fel Spikes' Echo: a climbing spike volley that accumulates across every fire

Fel Spikes' Deathrattle (`dm_felspikes`) now throws its `fel-spike` workbench effect as a real projectile
volley from the dying body, tuned live with the owner across the session. Two seams: an engine change to how a
multi-fire Echo resolves (Kevin's seam, flagged), and the presentation timing/reflow (Mike's seam).

## Engine — any multi-fire Echo accumulates (flagged for Kevin)

A Fel-Spikes-style board-damage Deathrattle can fire many times over one death: gilded sprays twice, and any
Echo doubler (Sylus / Funeral Engine / a golden Echohorn) re-fires the whole rattle. All fires must hit the
SAME victims and resolve their deaths ONCE, after the last fire — otherwise a body that summons tokens on death
(Void Panther → two Void Cubs) dies to volley 1 and its fresh tokens are mown down by volley 2, and a low-HP
victim vanishes before later volleys' reactors (Axeman / Leech) can proc.

- **Deferred-death scope** (`withEchoDefer` / `echoDeferDepth` / `echoDeferredDeaths`, `combat/simulate.ts`)
  wraps a death's own rattle firing — the base Echo (via the `onDeath` bus) and every `playerEchoExtras`
  re-fire, in both firing paths. While a scope is open, `resolveEchoDeath` QUEUES a ≤0 victim; the outermost
  scope flushes the queue in capture order after all firing. Only Fel-Spikes-style effects call
  `resolveEchoDeath`, so it is a **byte-identical no-op for every other death** (determinism harness holds).
- **`applyDamage` gains `overkill`** + new ctx primitives `damageDeferred` (apply, overkill, no death) and
  `ctx.onBoard` (like `living` but keeps a ≤0-not-dead body). `deathrattleDamageAllExceptTribe` captures its
  victims from `onBoard` each fire, so gilded, Sylus, Echohorn and any combination pile onto one accumulating
  set. Victims read every volley and proc the per-volley reactors; they die once, together, after the spray.
- **A doubler dying to the Echo it doubles still doubles it.** A gilded Fel Spikes sprays its own non-Demon
  Sylus to ≤0 on the base fire; the scope keeps Sylus on the board (not dead), so the doubler filter in
  `playerEchoExtras` widened from `health > 0` to `!m.dead` — Sylus was alive at the trigger and is only
  mid-deferred-death from the very spray it doubles, so gilded + Sylus fires "4 twice, twice" (4 volleys).

## Presentation — climbing number, per-volley timing, held slot (Mike's seam)

- **Projectile per volley** (`fel-spike` binding `launchOnDeath` + `fanOut: struck`): each wave launches its
  spikes from the dying body via `scheduleEchoVolleys`; the stock hit-burst on the damage beat is claimed +
  suppressed so only the relocated projectile plays.
- **Every volley fires.** The volley timers moved to a combat-lifetime registry (`echoVolleyTimersRef`, cleared
  only on reset/seek) — they used to live in the per-beat `timers` array and got wiped on the beat advance,
  which silently dropped a gilded+Sylus spray's later volleys once the skull→spray gap widened.
- **Climbing number.** A wave-tagged `dmg` shows the running total to its victim under a stable id (the first
  volley's index), and `onFloats` upserts by id, so the number ticks up in place (4 → 8) instead of stacking
  pops. Each volley's number lands as ITS spike strikes: `echoDeliveryLead` holds each wave to its own spike
  (`ECHO_PASS_GAP_MS` apart) rather than batching to the last; `ECHO_IMPACT_BUFFER_MS` 80 (rides the burst's
  brightest frame), `ECHO_LAUNCH_DELAY_MS` 400 (the skull reads before the spray). Deaths resolve in the
  post-spray step, so the numbers climb, then everything resolves after.
- **Held slot.** `holdecho` cancels a launchOnDeath sprayer's CSS slot-collapse (the card still fades in place)
  so its slot stays full through the whole spray — the survivors reflow ONCE, when its ghost is dropped after
  the last volley, instead of sliding into the gap and then reversing.

Verified: `simulate.test.ts` (gilded/Sylus accumulate, Void Panther cubs survive, doubler-dying → 4 waves) +
choreo/score/float suites; full suite 5934 + determinism harness (identical) + typecheck (pkgs + web) + lint +
build:web all green.
