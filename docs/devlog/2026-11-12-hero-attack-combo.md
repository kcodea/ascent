# Hero attack: Flawless (the fighting game combo), a Legendary

**2026-11-12.** Style id `combo`, folder `packages/ui/src/heroCombo/`, tuner `HeroComboTuner.tsx`. DEV-only: no
cosmetic yet, it plays through the dev "Attack style" override. Built from the `baseball` scaffold (both portraits
move); nothing of the baseball look or code path remains.

## The idea

The blow is played as an arcade FIGHTING GAME COMBO with a HUD. The striking portrait steps in beside the struck one
(side by side, like a 2D fighter) and lands a combo of flat, chunky hit sparks while a COMBO COUNTER ticks up behind it.
No other attack has a HUD or a counter.

**The counter ends on the real damage.** The runner hands `o.total` (the blow the engine decided, the same number the
shared damage formation shows) to the plan. `comboCounts(total, hits)` shares it out over the hits: with more damage
than hits every hit is worth several and the counter races through them; with fewer, some hits do not move it. It
never passes the real number and the last hit always reads exactly it. So a one-hit jab for 3 reads `1 HIT` on contact
and rolls to `3 HITS` within about 130 ms. That is the one place the brief's "1 HIT" and "ends on the real damage"
pull against each other; the real damage wins.

## The four looks (shared tiers; a knockout always plays IV)

- **I, the jab.** Step in, one quick jab (a fist-shaped spark over a yellow burst), the target flinches back.
- **II, the string.** Jab, cross, low kick at three heights (yellow, a blue cross flash, yellow), the target rocking
  with each, the kick leaning the striker back.
- **III, the launcher.** Two hits, an uppercut that launches the target, the striker jumps after it and juggles it
  (three or four air hits, rolled from `rollSeed`; it bobs up with each), then a spike that drives it straight back
  into its own slot. The slam is the impact.
- **IV, the super.** Three opening hits, then the super freeze: the screen dims, a slanted navy band slides across
  with the striking hero's own portrait art in a slanted panel, speed lines race along it and four input glyphs light
  one by one (down, down-forward, forward, attack; mirrored when the striker faces left). Then a flurry of 14 small
  hits with the counter racing, one heavy blow (the impact) that sends the target flying and spinning, and "K.O."
  slams in.

## How

- `heroComboConfig.ts` is pure: the plan (every hit with its time, kind, power and counter value), the cues, the
  geometry, both portraits' poses, the counter, the cut-in and the camera.
- **The ring.** On the real screen your hero sits in the bottom left corner and the foe in the top right, which is no
  place for a launcher. `comboGeo` pulls the target's fighting spot in off the edges just far enough for the tier
  (room for the striker and its counter behind it, room for the knockback, headroom for III's launch). The target hops
  out to that spot as the striker steps in, and is knocked, spiked or sent flying back home at the end. A target with
  room round it fights in its own slot.
- **No hit-stop.** The clock never pauses. The "hit-freeze" is a held pose: both portraits stand still for 45 ms on
  every contact (`hitFreezeMs`), and nobody moves through the super freeze. Sound and the consequence cannot drift.
- **The HUD** is own sprites on a top layer of the scene: the counter is up to four pooled digit sprites and a HIT /
  HITS label from painted textures, and a texture is only swapped when the number changes. No DOM text.
- **The cut-in portrait** is painted once per image src from the portrait's own `<img>` (as Enraged's afterimages do)
  and cached. If the image is missing or cannot be read back, the cut-in shows the band, the lines and the inputs.
- Textures are painted once per session in flat fighter style (hard outlines, layered flat colours).
- The blow lands once: I the jab, II the low kick, III the slam, IV the heavy blow. Everything else is a tick.

## Sounds

Four ElevenLabs calls, four clips kept, 3.5 s in total (mono, 44.1 kHz, 128 kb/s, peaks under -1 dB):

| clip | length | use |
| --- | --- | --- |
| `fx/combo-hit` | 0.30 s | every hit, re-pitched by kind (jab high, kick low, the flurry climbing) and the input ticks |
| `fx/combo-heavy` | 0.60 s | II's kick (quietly), III's slam, IV's heavy blow |
| `fx/combo-super` | 0.70 s | the super activating (its peak is 100 ms in, as the band arrives) |
| `fx/combo-ko` | 1.90 s | the K.O. sting: an impact and a gong, no voice |

The step in, the launch, the jump and the spike reuse the shared swish. I could not listen to them: levels, onsets and
brightness were measured with ffmpeg, so the mix is a first guess for the owner's ear.

## Verified

- `heroCombo.test.ts`: plan and cues per tier, the counter ending on the damage for many blows, geometry on screen in
  both directions and from corners, the poses, the blow landing once, every exit restoring both portraits, determinism.
- Contact sheets from a headless Chrome on a manual clock, every look plus III and IV in the other direction.
- Frame times during IV (dev build), see the PR notes.

## Not done, or weak

- The shared hit number (`-N`) is DOM and sits above the canvas, so on the impact frame it covers part of the impact
  spark, and on IV it overlaps the corner of "K.O.".
- The counter is behind the striker, which on the real layout puts it over the minion row for a moment.
- Found in passing, not fixed (shared file): the tuner's "Foe attacks" preview measures the foe's preview portrait
  while it is still scaling in, so a style that moves that portrait a long way lands it about 17% off in the preview.
  A real fight's portrait is settled. The capture script waits for it.
