# 2026-09-26 — Master volume in the Audio panel

Owner ask: "add a master volume slider to the audio panel in game".

- **One master stage in front of the speakers.** New `packages/ui/src/audio/master.ts` owns the master volume +
  mute and builds ONE `GainNode` per AudioContext (`masterOutput(ctx)`) that feeds `ctx.destination`. The three
  modules that used to connect straight to the destination now connect to it instead: sfx.ts (the Skip mute bus,
  which carries every category bus: combat, UI, hero voice, ...), music.ts (the music level gain) and announcer.ts
  (the announcer level gain). Nothing else in the UI reaches the destination, and sfx.ts owns the only
  AudioContext.
- **Channel sliders keep their meaning.** Effective gain = channel gain x master. Everything that moves a level
  (the Ancients duck, music fades, the announcer's line fades, a Skip's `stopAllAudio`) happens upstream of the
  master, so it composes unchanged.
- **Curve: plain linear.** Slider 0..100 maps to gain 0..1, so 100 is unity (the pre-master mix) and 50 is half
  amplitude. The channel curves' reference-gain anchoring does not apply: the master only attenuates.
- **Element fallbacks.** Without Web Audio, music's and the announcer's `HTMLAudioElement`s multiply
  `masterLevel()` into `element.volume` and re-apply via `onMasterChange`; the announcer's fade-out tail starts
  from the element's current volume, so it inherits the master too.
- **Defaults + persistence.** Default 100, unmuted. `ascent.mastervol.v1` + `ascent.mastermuted`, all storage in
  try/catch. The master mute leaves the channel mutes untouched.
- **UI.** A "Master" row at the top of the Esc > Audio panel (the same `AudioChannel` row, fixed 104px label
  column, own Mute, aria-labels, no `title=`). The range slider + thumb rules in `.escvol` had a bare
  `cursor: pointer` (and `default` when disabled); they now use the gauntlet URL form / `inherit`.
- **Tests.** `packages/ui/src/audio/master.test.ts` (curve, defaults, persistence, blocked storage, mute,
  listeners, and a recording fake AudioContext proving each channel's only path to the destination runs through
  the master with effective gain = channel x master, duck included), plus a music element-path case in
  `music.test.ts`.
