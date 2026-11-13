# "On Execute given": Raven and Tort send a beam (2026-11-12)

Owner: "applying execute is another effect much like ward, that applies instantly ... get ready for me to send you a
tendril effect for execute applications", then "ok i saved it called execute-beam".

## What plays now

- **Combat.** A minion that gives another minion Execute and has an "On Execute given" effect bound (`executeGiven`,
  a new card mechanic kind; Raven and Tort both bind `execute-beam`) launches it from itself to each receiver. Raven's
  grant sits inside his own swing, so the beam leaves at the Rally medallion pulse; Tort's leaves as his Avenge beat
  starts. The receiver's Execute aura AND its medallion change are held (`fx/executeHold.ts`) until the beam lands
  (`defArrivalMs`, 380 ms for this def).
- **The Shop.** A Rally forced at End of Turn delivers the grant as a `keywordChanged` consequence on Raven's own beat.
  The presenter now hands the beat's minion to the keyword cue (`from`), which launches the same beam in place of the
  generic keyword flash. Not covered: a Rally forced mid-turn outside the End of Turn beats, and quiet repeat ticks.
- **Sounds.** `sfx-execute-slice` as the beam leaves; `sfx-execute-applied` (blood + ding) as it lands. Each rings
  once per giver per beat, so a Gilded Raven's two beams are not two stacked copies.
- **The medallion.** A body that was GIVEN Execute (keyword on the instance, not printed) wears the red Execute dagger
  over whatever badge it had, the Watcher eye included (R-MEDAL-EXECUTE-GIVEN-01). Printed Execute races as before.
- **Landing on a moving minion.** The death that fires an Avenge collapses the row while the beam flies. The launch
  aims at the receiver's settled slot and follows it for the flight (`trackSettledSlot` in `fx/settledSlot.ts`, the
  King Oona banana approach packaged for reuse). The source end stays where the giver was at launch.

## One launcher, two phases

`launchExecuteGiven` in `fx/executeGivenLaunch.ts` is the single grant path. Combat calls it per grant found by
`executesGivenIn` (a `keyword` event for `V` whose `source` is another body); the Shop calls it from the
`keywordChanged` presenter. Keeping one `playDef(b.def, ...)` site keeps the `directCalls` ledger at one dynamic site.

## Levels

Measured every clip in `audio/fx` with ffmpeg `ebur128`. 301 of 388 sit at -20.4 LUFS (the voice import target); the
57 non-voice clips have a median of -17.4 (quartiles -20.4 / -13.7). The Execute clips as exported: slice -12.0,
ding -15.2 (true peak +0.9), blood -19.3. The slice was louder than about 85% of the non-voice clips, so its layer
plays at 0.56 (about -5 dB, near -17) and the ding at 0.8 (about -2 dB). The clips themselves were not re-encoded,
so the Level slider in the workbench is the one place to retune.

## A test gap that hid nothing, this time

The first Tort test compiled moments from the raw event log, not `replayBeats(replayOrder(...))`, which is what the
live replay walks. A probe through the real ordering showed the same grant in the same beat, so the launch was right;
worth remembering that a moment-shape test should go through `replayBeats`.
