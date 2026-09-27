# 2026-09-27 — Ancient pick: research note and the new slam ending

Owner (2026-09-27): "let's clean up the ancients animation - after selection, i dont want the black circle to go back
to the hero power, id rather the screen fade back and give more emphasis on the choice slamming the hero power. can
you add a slight pixi burst and maybe some screen react for emphasis? use deep research to decide what would look
best and clean up the overall animation".

## Part 1: research

### What strong games do when a choice is committed

These are observed patterns from play, not quotes from their developers:

- **Hearthstone** (Discover pick, Battlegrounds hero-power and trinket picks). The unchosen options drop away at
  once, and the chosen card travels to where it will live (hand, hero power slot). The travel is short, it speeds
  up into its destination, and it ends in a small flash or pulse on the destination. The screen never "rewinds"
  the opening transition. It simply returns to the board.
- **Marvel Snap** (playing a card onto a location, the Snap). The card lifts, then drops onto its location with a
  heavy landing. Marvel's own write-up says the cards always lead the visual hierarchy and the UI exists to
  highlight them ([Inside the Art of MARVEL SNAP](https://www.marvel.com/articles/games/inside-the-art-of-marvel-snap)).
  The emphasis goes on the object arriving, not on the menu leaving.
- **Balatro**. Every scoring beat stacks several small, short channels (card pop, colour, sound pitch, and a shake
  scaled to how big the moment is). A breakdown of its feedback lists the shake at 0.2 s / 0.3 s / 0.5 s by
  magnitude and 2 px for small moments up to about 8 px for the biggest
  ([Balatro: Juicy Feedback](https://blakecrosley.com/guides/design/balatro)). The lesson for us is proportion:
  the pick is one important but not climactic beat (the eruption was the climax), so it gets a small, short shake.
- **Slay the Spire / Legends of Runeterra level-up / Vampire Survivors level-up**. The reward flies to the thing it
  upgrades, and that thing reacts (a bump or flash) when it arrives, so cause and effect read as one event.

### Game-feel principles that apply

- **Anticipation, then action, then follow-through** (Disney's principles applied to UI). A small wind-up before
  the move, an ease-in into the target so it arrives at its fastest, and a settle after. Most UI motion lives in
  about 200 to 500 ms: faster than about 100 ms is missed, slower than 500 ms starts to feel sluggish
  ([Marvel blog: Disney's motion principles in UI](https://marvelapp.com/blog/disneys-motion-principles-in-designing-interface-animations/)).
- **Hit-stop.** Freeze the two objects at contact for a few frames. It gives the eye time to register the hit and
  makes it feel heavier. Fighting games use about 7 to 10 frames at 60 fps (about 115 to 165 ms) for light to heavy
  hits, and much longer only for special hits ([Celia Wagar, "Hitstop"](https://critpoints.net/2017/05/17/hitstophitfreezehitlaghitpausehitshit/)).
  Smash vibrates the hit character slightly during the freeze. For a UI element (not a fighter), the short end is
  right: **50 to 100 ms**.
- **Trauma-based screen shake** (Squirrel Eiserloh, GDC 2016). Keep a trauma value from 0 to 1 that decays
  linearly. Shake by **trauma squared** (or cubed), so it falls off fast: trauma 0.3 / 0.6 / 0.9 gives 3% / 22% /
  73% of the maximum. Use smooth (Perlin-style) noise, not white noise, so it reads as a camera and not as jitter.
  In 2D, combine translation with a little rotation
  ([slides](http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf),
  [transcript](https://archive.org/stream/GDC2016Eiserloh/GDC2016-Eiserloh_djvu.txt)).
- **The art of screenshake** (Jan Willem Nijman, Vlambeer, 2013) and **Game Maker's Toolkit, "Secrets of Game Feel
  and Juice"**. Many small layered effects (a camera kick toward the hit, a flash frame, a pause, particles,
  a sound with weight) add up to impact. Each one alone is small
  ([talk](https://www.youtube.com/watch?v=AJdEqssNZ-U), [GMTK](https://www.youtube.com/watch?v=216_5nu4aVQ)).
- **Flash safety.** A flash is fine as long as it is one flash, not three or more in a second
  ([WCAG 2.3.1](https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html)). Ours is a
  single, local bloom at the hero power, not a full-screen strobe.
- **Keep it tasteful.** The owner wants clean, not bubbly mobile effects, so: no confetti, no lingering particles,
  no big zoom. A punch-zoom of about 1% reads as a camera kick. Several percent starts to read as the whole
  screen lurching.

### The design we picked (one coherent arc)

| Step | Time from click | What happens | Why |
| --- | --- | --- | --- |
| Commit | 0 ms | The backdrop, the banner and the two other Ancients start a clean opacity fade (380 ms). The Shop row fades back in step. The chosen card's text fades. | The screen returns to the board instead of rewinding the curtain (owner ask). The fade finishes before contact, so the hero power is in view when it is hit. |
| Anticipation | 0 to 120 ms | The card art lifts about 14 design px, pulling back away from the hero power and growing 5%. | A short wind-up makes the throw read (Disney anticipation). 120 ms sits in the "felt, not waited on" band. |
| Flight | 120 to 480 ms | It accelerates into the hero power (strong ease-in, fastest at contact), shrinking to the button's size. | Ease-in into an impact sells weight. 360 ms is inside the 200 to 500 ms UI band. |
| Contact | 480 ms | The seal sound (`pickSeal`) and a warm light bloom on the hero power. The music duck lets go here. | Sound and flash land on the same frame as the hit (Nijman, GMTK). |
| Hit-stop | 480 to 550 ms | The card is held against the button, pressed in slightly. | 70 ms is a light hit-stop for a UI element (Wagar: 115 to 165 ms is for fighters). |
| Release | 550 ms | The card is absorbed (90 ms). The Pixi burst plays: one round ring plus a few sparks in the Ancient's colour. The board shakes (5 px peak, trauma squared, 280 ms, smooth noise) with a 1.2% punch-zoom toward the hero power. The hero power recoils (squash 10%, small overshoot). The crack starts drawing. | Eiserloh's trauma shake, short like Balatro's small tier. The recoil makes the struck object react. |
| Follow-through | 550 to about 1150 ms | The crack draws (320 ms). The Ancient's half slides in through it from halfway (440 ms). One shine sweeps (560 ms, ends about 1.4 s). | The existing, approved split reveal, now chained to the release with no gap. |

No rotational shake, even though Eiserloh pairs rotation with translation in 2D. On a full-screen board layer,
even a fraction of a degree reads as the room tilting, which is not the clean look the owner asked for.

Click to settled is about **1.15 s**, and the last glint is off by about **1.4 s**, inside the 0.9 to 1.4 s target.

**Reduced motion:** no lift, flight, hit-stop, shake, zoom, recoil or flash. The card fades out (200 ms), then a
small burst (70% size) and the sound play, and the split fades in.

## Part 2: build

**Removed.** The gate's contraction back into the hero power: the `clip-path` ellipse collapsing on the backdrop,
the inhaling motes (`wipeFx.inhale`) and the `closeMs` dial. The triple's `gild-trail` from the card to the
button is also gone, because the card itself flies now. (The owner had asked on 2026-09-25 to send only the triple
reward animation, not the art. Today's ask to put the emphasis on "the choice slamming the hero power" replaces
that, so the card art is what flies. Flagged in the PR so the owner can say if the trail should come back as a
tail.)

**New.**
- `packages/ui/src/ancients/ancientPickSlam.ts` holds the whole post-pick arc. `pickTimeline(cfg)` is the one
  clock (contact, release, end), and the gate, the offer and the test all read it. `playPickSlam(card, id)` is
  called from the offer's click, before the dispatch. It measures once (the art frame, the card and the hero-power
  button) and animates the real card (no clone). It schedules the contact (sound + flash) and the release (burst,
  shake, recoil), and it notes the release time for the split. `playPickImpactNow(id)` plays the impact alone
  (the tuner's ▶ Awaken).
- `ancient-pick-impact.json` is a new small def: one round shockwave ring plus 22 fast sparks, no gravity and a
  short life. It is recoloured per Ancient with a brighter ramp than the dust (rim in the colour, white-hot core).
  It is fired from `ancientsSmoke.ts` (`ancientPickBurst`) and registered in `fx/directCalls.ts` and
  `playDefUids.test.ts`. It is pre-played invisibly when the offer settles (`warmPickBurst`), because a cold first
  play landed about 250 ms late in headless Chrome.
- The screen react is one linear WAAPI animation baked up front: the individual `translate` and `scale`
  properties on `.boardbg` only (never `.app`; the gateLayout tripwire still passes). The transform origin is the
  hero power, set just for the animation.
- The impact flash is a transient `.anc-impact-flash` div (static radial gradient, screen blend, z 108: over the
  status bar, under the Pixi FX). Only its opacity and transform animate, and it removes itself when done.

**Changed.**
- `AncientOfferOverlay` keeps the reveal mounted through `closing`, using the last offer it showed, so the chosen
  card can fly while the rest fade. The overlay stays `gated` (transparent), so no Discover scrim pops in. The
  click now sets `closing` itself, in the same render as the dispatch.
- `AncientGate.close` fades the backdrop (`pickFadeMs`) instead of collapsing it. It releases the duck at contact
  and goes idle at `pickTimeline().end` (640 ms). It is idempotent: the offer clearing and the stage change both
  call it in the same commit, and before this change it ran twice.
- `body.ancclosing` lets the Shop row fade back in step with the backdrop (`--anc-pick-fade`) instead of popping
  after the close.
- `AncientSplit` reveals on the slam's release (`takePickRelease`) instead of the gild trail's arrival. The half
  now enters halfway through the crack draw (it was 60% of the way).
- A tuner demo's pick (▶ Play full sequence, then click an Ancient) now plays the split too (`playAwakenDemo`).
  Before this change it only closed the gate.
- The follow-through was tightened: `crackOpenMs` 420 → 320, `splitMs` 520 → 440, `shineMs` 800 → 560. A dev
  save from before today stored every value, so it would have pinned the old numbers. On load, a save without
  `pickFadeMs` drops those three keys (and the retired `closeMs`) so the new defaults apply. The owner's other
  dials are kept.

**Kept as approved:** the per-hero bloom styles and colours, the two-beat reveal and its speeds, the slam dust and
sparks on the reveal, no click-to-skip, and the soft fill chime.

**Tuner (✦ Ancients › Pick → slam):** Backdrop fade, Lift (anticipation), Flight, Hit-stop, Impact flash, Impact
flash decay, Burst size, Shake length, Shake strength, Punch zoom, Hero power recoil. The defaults are pinned in
`ancientsConfig.test.ts`. The new `ancientPickSlam.test.ts` pins the timeline (contact 480, release 550, end 640;
the fade is done before contact; the split settles within 0.9 to 1.4 s).

**Verified.** Headless Chrome screencast on a private dev server (port 5199), with a Scene Builder Set 3 run with
Ancients on, a real awakening and a real click. Captured at 1920×1080, 2560×1080 and 844×390 (phone, scaled
stage): the card lands on the hero power at every size. Profiled twice on the same setup, from click to 1.9 s
after it: 3 `getBoundingClientRect` calls in total (all at the click), 0 infinite animations, 0 long tasks. The
worst frame was 25 ms once on the first run and 8 ms on the second. This was measured on the dev server, not the
prod build: the dev store handle the capture needs (`window.useGame`) is stripped from prod. The dev server is the
slower of the two, so this is a conservative bound.
