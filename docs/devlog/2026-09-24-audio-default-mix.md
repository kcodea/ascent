# 2026-09-24: The default audio mix at the 50 mark, and the Announcer dev tuner

Owner asks, verbatim:

> bake these audio values as the default volumes, but all at the 50 mark for volume.

(with a screenshot of the Settings Audio panel: Game sounds 50, Music 20, Announcer 70), and, same branch:

> add an announcer tuner to the dev panel that has volume for each event, and a timing adjust that allows me to
> offset timing of the event earlier or later

## The default mix

Each slider now DEFAULTS to 50, and 50 plays the owner's mix. A slider position is no longer the gain itself:
`sliderToGain(channel, slider)` (`packages/ui/src/audio/volumeCurve.ts`) maps it piecewise linearly per channel:

| slider | Game sounds | Music | Announcer |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 50 (default) | 0.5 | 0.2 | 0.7 |
| 100 | 1 | 1 | 1 |

0..50 runs 0..ref, 50..100 runs ref..1 (the gain 100 had before), so nothing exceeds the old maximum. Game sounds is
the identity line, so its slider still IS the SFX master gain (`cfg.masterGain`) and the mixing desk is untouched.

The curve runs at the one place each channel turns its slider into a gain: `level()` in `music.ts` and
`announcer.ts` (both still `muted ? 0 : …`, so the mutes work as before). The Settings panel still shows the slider
value (0..100).

### Saved settings

Old saved values were raw gains, which mean something else under the curve, so everyone starts once on the new
defaults:

- Music and Announcer moved to `ascent.musicvol.v2` / `ascent.announcervol.v2`. The old keys are simply not read.
- Game sounds lives inside the whole mixer config (`ascent.audiocfg`), so a new key would have reset the desk too.
  Instead `resetMasterOnce` (sfx.ts) drops the saved `masterGain` on the first load after the change, writes the
  cleaned config back and sets `ascent.audiomix.v2`, so a later choice sticks. The per-category levels stay.
- Mute keys are unchanged. Every read is in try/catch and falls back to the defaults.

Gotcha hit while building it: `cfg` in sfx.ts is initialised at the very top of the module, so a module-level
`const` key declared further down is still in its temporal dead zone when the reset runs (the reset's own catch
swallowed the ReferenceError and silently kept the old gain). The key is function-local for that reason.

## The Announcer dev tuner

`announcerConfig.ts` (config + `SPEC`) and `AnnouncerTuner.tsx` (the panel, DevMenu Audio group, 📣). One section
per event (all 19 keys of `ANNOUNCER_LINES`, titled with the built-in delay the offset rides on):

- **Volume**, 0 to 200 percent (default 100), multiplied into that line's gain. `deps.play(url, onEnded, gain)`
  now carries the multiplier; the per-line gain node is set so line x channel never passes 1
  (`announcerLineGain`), and the element fallback does the same.
- **Timing offset**, -2000 to +3000 ms (default 0), added to the event's delay inside `enqueue`, clamped to "now":
  a negative offset fires earlier but never before the moment was detected. Only `notBefore` moves, so the
  cooldown (from the previous line's real end), the cap and the shelf life are unchanged. The turn-1 quiet window
  still applies after the offset, so Game Start cannot move earlier than 3.6 s even with -2000.
- A **▶** beside each Volume row (`previewAnnouncerEvent`) plays the line now at its tuned volume, outside the
  queue (no cooldown, nothing marked), cycling variants per press. It goes through the Announcer channel, so the
  Settings slider and mute apply.
- Copy values / Reset as every tuner; the panel is in `tunerAll` so "Reset all tuners" covers it. Prod ignores the
  tuner's localStorage and ships `DEFAULTS` (bake = paste Copy values there).

`TunerControl` gained an optional `preview?: () => void` (a small ▶ on a range row) for this; no other panel uses it.

## Tests / oracle

- `audio/volumeCurve.test.ts`: default 50; 50 = 0.5 / 0.2 / 0.7; 100 = 1; 0 = 0; identity for Game sounds;
  monotonic and clamped.
- `audioDefaultMix.test.ts` (cold module loads): a fresh player gets 50 / 50 / 50; old saved values reset once and a
  later choice sticks; the desk's category gains and the mutes survive; throwing storage falls back to defaults.
- `announcer.test.ts`: the gain multiplier reaches the player and clamps; positive offset delays exactly; negative
  offset fires earlier and clamps to the detection moment; the offset does not dodge the cooldown; the ▶ preview.
- Oracle: `R-PRESENT-13` in `packages/rules/src/registry/approved/foundation.ts`; R-PRESENT-06 / 07 now name the
  `.v2` keys.
