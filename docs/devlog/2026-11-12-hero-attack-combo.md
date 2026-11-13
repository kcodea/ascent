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

## Second pass (2026-11-12, after the owner played it)

The owner's verdict on the batch: the attacks need sound, and the big looks are quick and not impactful.

**The counter now counts real hits.** The first pass shared the damage out over the hits, so a one-hit jab for 3 read
`1 HIT` and then rolled to `3 HITS`. That is gone (`comboCounts` and the roll are deleted): hit n reads n, on every
tier. The damage is the game's own number (the formation and the `-N`). On the smallest blows the two agree anyway:
a blow of 1, 2 or 3 is now that many quick taps (`jabTaps`; 4 and 5 are three taps), so Tier I reads `1 HIT`,
`2 HITS`, `3 HITS` as they land. The "counter ends on the real damage" paragraphs above describe the first pass only.

**Sound.** Measured with a recorder on the audio output (100 ms RMS windows, after the formation). First pass, Tier IV:
mean -34.2 dB, hits about -31 to -36 dB per window, and 400 ms of silence (-61 dB or lower) through the super freeze.
Reference, measured the same way: Soccer IV -32.0 dB mean, Frost IV -31.8 dB. Now: IV mean -24.8 dB (peak -7.8 dB),
hits -21 to -28, the freeze -28 to -29 all the way through, the flurry -26 to -28, the heavy blow -18, K.O. -15 to -21
for about a second (the formation's own peak is -17). III: mean -27.2 dB. No window after the first hit is under
-34 dB until the tail. This is deliberately louder than the two references. Levels are measured, not heard.

- Three new clips (three ElevenLabs calls): `fx/combo-punch` (0.45 s, a low body punch), `fx/combo-charge` (1.14 s, a
  rising charge), `fx/combo-boom` (1.5 s, a deep boom). The attack's own clips are now seven, 6.6 s in total.
- Every hit is a body punch under the snap, both re-pitched by the kind of hit (jab high, kick low, spike lowest); the
  launcher, the spike and every finisher add the heavy thump.
- The super freeze: the charge is placed as a riser that peaks as the band leaves. The input ticks are louder.
- The flurry rises in pitch and level through all 14 hits, a body punch under every other one.
- The heavy blow has a wind-up riser that peaks on the impact, then heavy + punch + snap + a short boom.
- K.O.: the sting over the full boom. The two landings after the blow each get a thud.
- The gains of the first four clips went up (hit 0.6 to 0.9, heavy 0.75 to 1.1, super 0.6 to 0.8, K.O. 0.7 to 1).

**Impact (IV).** Running time after the formation: 4036 ms before, 5436 ms now (Soccer IV 3308, Frost IV 3083). The
extra time is anticipation and aftermath, nothing was slowed evenly:
- A held WIND-UP between the flurry and the heavy blow (300 to 600 ms): the striker rears back further and swells, light
  is pulled into it (`gather`), the view pushes in and trembles.
- The blow: a whole-screen flash, shake 18 to 30 px over 560 ms (was 300), a bigger punch-in, a white-hot core, more
  rings, shards that arc down under gravity.
- The aftermath: the target is blasted away in 150 ms, lands, bounces twice, rocks and settles there (dust, embers and
  a low glow on each landing), and the striker stays for 1.7 s (was 0.9). K.O. holds 1.75 s (was 1.15) with its own
  jolt, a hot bar of light behind it and sparks off its ends.
- The cut-in is longer (760 to 980 ms) so the charge has room. III's slam got more shake (11 to 18), a flash and dust.

**Style.** The cartoon fist (a drawn white glove on the jab and the heavy blow) is removed; drive lines through the hit
carry that beat. No new drawn objects. The input arrows and the band stay: they are the HUD, which is the idea.

**Verified this pass.** `heroCombo.test.ts` rewritten for the hit counter, the taps, the wind-up, the aftermath and the
new scene calls. Sheets of all four looks with the player striking and IV with the foe striking. Frame times on IV in
the dev build, on a machine also running other builders: median 4.2 ms, 99th percentile 4.3 to 8.4 ms over three runs;
the only frames over 12.5 ms were in the first 130 ms (first use of the textures), plus one 37 ms frame once.

**Still weak.** The `-N` still overlaps the K.O. word. The first frame of the flash is close to a white-out. Nobody
has heard the mix. The config key moved to `ascent.herocombo.v3`, so tuner values saved for the first pass are dropped.

Note on the three new clips: the raw clips decoded about 2 dB over full scale, so they were clipping when the numbers
above were measured. They were then re-levelled to a true -1.2 dB peak and their gains raised by the same 2 dB
(punch 1, charge 0.7, boom 0.95). The loudness numbers were NOT re-measured after that last step; they should be
within a dB.
