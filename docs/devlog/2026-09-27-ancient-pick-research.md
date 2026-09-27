# 2026-09-27 — Ancients awakening: research note, the pick rebuilt, and a whole-sequence AAA pass

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

### The first design (superseded the same day; kept for the record)

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

## Part 2: what shipped

The owner reviewed the first build on 5173: "looks terrible, do not use the art square to send to the hero power.
collapse it into the same pixi style effect we use for when the player gets a triple ... try and create a AAA ready
animation". Then: "take a AAA pass at the ENTIRE animation though, not just the ending half. i want this entire
animation sequence to be the best, cleanest animation we have in the game."

### The triple effect, and how the pick reuses it

A triple (gild) in the Shop is one def, `gild-trail` (`fx/defs/gild-trail.json`, played by `gildTrail.ts`):
- a **poof** of about 72 gold shards at the consumed copy, aimed at the target;
- an **arcing ribbon** (`travel`, 420 ms, bowed upward) with a glow filter;
- a **landing** at 420 ms: two 136-shard bursts and a faint shockwave, with the gilded card popping in;
- the **woosh** and **triple-impact** sounds.

The pick plays that same def, from the collapsed card to the hero power:
- recoloured to the Ancient through `recolor`, using the gild's own ramp shape (`ancientTrailPalette`);
- sped up to × 0.75 (`trailTime`);
- with `intensity` 0.55;
- with its sound layers muted. Those layers are on the combat bus, which the awakening ducks. The same two clips
  play instead as the pick's own cues (`pickWoosh`, `pickSeal`) on the hero bus.

Passes 1 and 2 showed that `recolor` swapped the ribbon's palette but not its **glow filter** (`glow_color`, gold),
so a blue trail still read cream-gold. `recolorDef` / `playDef` gained an OPT-IN `recolorGlow`, which tints the glow
to the palette's core stop. It is off by default, so every existing caller is byte-for-byte unchanged (a new
`recolorDef.test.ts` case pins both). A reference capture of the real Shop gild confirms the pick now reads as the
same language: poof, bowed ribbon, bright landing, then a ring of sparks.

### The final sequence (timing map, ms)

From the refresh that fills the meter (t = 0):

| Beat | Start → end | What |
| --- | --- | --- |
| Fill | 0 → 520 | The ring's last point sweeps in. The refreshed Shop stays visible (no more vanishing row). |
| Flash | 520 → 1000 | The full-ring flash. The awakening starts at its **peak (712)**, not after it has faded. |
| Omen | 712 → 1562 | Vignette creep, glyph ring, cracks, embers and halo, now **in the hero's theme** (they were violet under every theme). The Shop row fades out (450 ms). |
| Eruption | 1562 → 2082 | The curtain blooms out of the hero power with the seam ring and the per-hero medallion entrance (all 9 styles and 4 hero looks unchanged). A short dust burst in the theme's light seam colour (it read as dark smudges when tinted to the curtain centre). |
| Title | 2082 → 3132 | "An Ancient Awakens" rises and holds **1050** (was 1500: about 1 s of an unchanging card). |
| Reveal | 3132 → 4282 | The curtain drops over 320 ms (ease-in, so there is no murky half-fade). The middle Ancient rises through it at +80, slams at 3571, and lands at 3672. After a 140 ms gap the sides slide out and slam at 4188. Settled at 4282. |
| Pick | P + 0 → 200 | The chosen card's text fades. Its art **pinches into a core**: a 3% swell, then an ease-in implosion. A one-shot clip rounds the square into a disc by 30%, so it never reads as a shrinking square, and the core's light floods it by 50%. The backdrop, banner and other two cards fade (380 ms) as the Shop fades back. |
| Trail | P + 140 → 455 | The triple trail launches out of the core (at 70% of the collapse, so the core hands off with no dead frame) and bows into the hero power. The woosh plays. |
| Contact | P + 455 | The triple's landing burst, the seal cue, a light bloom on the power, and the power **squashes** 10% and holds: the 60 ms hit-stop. The duck releases. |
| Release | P + 515 | The power springs back past 1. A crisp ring (`ancient-pick-impact`, 0.6). A trauma² shake (5 px, 280 ms) and a 1.2% punch-zoom on `.boardbg`. The crack opens (260 ms). |
| Settled | P + 1085 | The Ancient's half is in. The last shine glint is off by about P + 1360. |

Meter-full to settled went from about 5270 ms to about **4280 ms**. Everything cut was dead air or a hold. None of
the approved beats were removed.

### Pass-by-pass critique (dense screencasts, about 40 ms per frame, headless Chrome)

**Pick, pass 1** (collapse into the trail, first cut):
- The card still read as a **shrinking square**, because the core glow was a centre radial with clear corners.
- The trail read **cream, not the Ancient's colour**.
- At the triple's native 420 ms, the ribbon's tail kept draining into the power for about 180 ms after the hit,
  hiding the squash and the crack.

**Pick, pass 2:**
- The collapse got a round clip and a flooding glow, and it now reads as a ball of light. But the clip was still
  octagonal at 30%.
- The trail was still cream. Cause: the glow filter, not the palette.
- Fixes: `recolorGlow`, a more saturated ramp, the clip rounded earlier, `trailTime` 0.75, and the crack 320 → 260 ms
  so the split reads before the sparks settle.

**Pick, pass 3:**
- Colour-consistent (Genesis green, Time blue, War red) at 16:9, 21:9 and phone.
- The split reads at about +270 ms after contact.
- Reduced motion is a plain fade plus a small burst.

**Whole sequence, pass 1:**
1. The Shop row **vanished on the refresh frame** (`body.ancoffer` hid it the moment the offer existed), leaving
   about 1.1 s of empty board.
2. About 0.5 s of nothing between the ring flash and the omen.
3. The omen was violet under Indy's gold.
4. Dark dust smudges over the bright bloom.
5. A 1.5 s static title hold.
6. A murky, ease-out curtain fade with a 220 ms wait before the first card.
7. A 250 ms gap that read as a stall, because the sides hide behind the middle card.
8. The invisible warm-up play left a visible dot on the power.

**Whole sequence, pass 2:**
- 1–8 fixed (tavern hidden only on `ancgate`, awaken at the flash peak, themed omen CSS, seam-colour dust, title
  1050, reveal delay 80, gap 140, warm-up played off screen).
- Remaining: the curtain's mid-fade still read muddy. Fix: 320 ms with an ease-in drop.

**Whole sequence, pass 3 (final):**
- Clean at 16:9 (Indy), 21:9 (Warden) and phone landscape (Auctioneer), with one colour logic per hero from the
  omen to the backdrop.
- Profiled cold: the first play of the trail is a ~70 ms task.
  - Unwarmed, it hitched the pick.
  - Warmed at the settled offer, it hitched the last slam's dust.
  - It now warms at the awakening's start, on the flash's peak, before any omen frame draws.
- Warm runs have 0 long tasks.

### Tuner (✦ Ancients › Pick → slam)

- Backdrop fade
- Collapse
- Core glow
- Trail launch
- Trail speed
- Trail particles
- Hit-stop
- Impact flash and its decay
- Burst size
- Shake length and strength
- Punch zoom
- Hero power recoil

There are also new cues: `pickWoosh` beside `pickSeal`. The trail's colour is each Ancient's colour dial.
`ancientsConfig.test.ts` pins every retuned default, and `ancientPickSlam.test.ts` pins the pick clock (launch 140,
contact 455, release 515, end 575, split settled inside 0.9 to 1.4 s).

A dev save stores every value, so saved tuner values would have pinned the old numbers on the owner's 5173. A retune
revision (`ascent.ancients.rev`, now 1) makes exactly the retuned keys take their new defaults once, and the owner's
other dials are kept.

### Perf (headless Chrome, private dev server, whole sequence: refresh → awakening → pick → settled)

- 14 `getBoundingClientRect` calls from the Ancients code, all one-shot at beat moments: the hero power at the start
  and pick, the offer's layout at reveal, the landing anchors, and the pick.
- No Ancients animation loops. The only infinite animations on screen are the game's own button sheens, the lobby
  pulse and the hero-power ready glow.
- The animated properties are transform, opacity, translate, scale, stroke-dashoffset, and two one-shot clip-paths
  (the curtain bloom and the collapse).
- Warm run: 0 long tasks, worst frame 21 ms. Cold run: 1 task (77 ms), deliberately placed on the flash peak.

This was measured on the dev server, not the prod build: the dev store handle the capture needs is stripped from prod.

## Part 3: the reveal pass

Owner, after the whole-sequence pass: "it's definitely better. can you make the ancient reveal sequence better
specifically? the before + after are a lot better now". The before (meter, omen, eruption, bloom) and the after (the
pick) stayed exactly as they were. This pass covers the middle only: from the title, through the two-beat reveal,
to the cards at rest and hovered.

### Research (short)

- **Hearthstone pack opening** stages each card with its own moment. The rarity colour shows as a glow before the
  card is seen, and a rarer card flips with a burst of its colour plus an audio cue, so a second channel carries the
  reveal ([Hearthstone wiki: Card pack](https://hearthstone.wiki.gg/wiki/Card_pack);
  [Gutjahr, "Opening card packs"](https://www.isaacgutjahr.com/understanding-the-gaming-experience/opening-card-packs-a-mini-exemplar-collection)).
- **Gacha / rarity reveals, done tastefully.** The cue comes before the object: a colour flare, a held beat, and the
  motion slowing just before the reveal. "Even before the reward appears, the player is being told that something
  important may be about to happen" ([COGconnected](https://cogconnected.com/2026/09/why-loot-boxes-feel-like-winning/)).
  We took the staging, not the slot-machine part: one short gather in the Ancient's colour, no escalating tiers.
- **Discover / boss relic choices (Hearthstone, Slay the Spire)**:
  - the title stays one continuous element above the choices;
  - each choice's name and effect read after the art;
  - the non-hovered choices step back while one is considered;
  - the choice is plainly open once everything has landed.
- **Disney principles (motion design):**
  - the eye follows motion, so move the title rather than cross-fading two copies;
  - anticipation before the main action;
  - secondary action (the text) after the primary action (the card) lands;
  - the idle "life" should be slow and small ([Marvel blog](https://marvelapp.com/blog/disneys-motion-principles-in-designing-interface-animations/)).

### What the reveal does now

R = the moment the curtain starts to drop (3132 ms after the refresh in the timing map above).

| R (ms) | Beat |
| --- | --- |
| 0 | **Title handoff.** The curtain's title vanishes (50 ms) and the offer's banner is born in its exact place and size, then rises into its position over 440 ms (ease-in-out). There is one title on screen the whole time and the eye rides it up. The medallion fades with the curtain (320 ms, ease-in drop). |
| ~40 → 460 | **Anticipation.** A soft vertical column of the first Ancient's colour gathers where it will stand, peaks as the card appears, then gives way to it. |
| 180 → 640 | **Beat 1.** The middle Ancient rises (opaque by 22%, so it never ghosts over the curtain) to a higher peak (56 px, was 34), then drops hard, ease-in, straight to rest at R 539. The same moment brings its dust, sparks and shockwave, plus a **bloom of its colour over the art**. No dip below rest and no side wobble (owner 2026-09-26). Its name rises in at +30 ms after landing and its effect at +90/+120 (240 ms each). |
| 780 → 1250 | **Beat 2.** The side two slide out from behind it and slam together at R 1156, each with its dust, sparks, card shake and colour bloom (the bloom sits inside the card, so it rides the card's motion). Their text rises in after they land, so three cards' text never overlaps mid-slide as it used to. |
| 1250 | **Settled.** Clicks open. "Choose one" (small gold caps between two fine rules) rises in under the cards. |
| idle | The three cards float very slowly (3 px, 4.8 s cycle, staggered starts). This is the only loop in the whole awakening: transform only, on the slot, paused during the pick and off under reduced motion. |
| hover | The hovered Ancient lifts 10 px and scales 2%, its rim lights in its colour, and the other two step back to 70% opacity (opacity only). |

Curtain drop to settled: about 1250 ms. It was about 1150 ms, and the 100 ms difference is the new anticipation
beat. The overall sequence is unchanged in length.

### Pass-by-pass critique

**Pass 1:**
- The handoff read as **two titles crossing**: the banner's flight began fast and was already near the top while the
  curtain's copy was still fading in the centre.
- The gather was a wide teal oval, which read as a lens blob.
- The rising card was low-opacity for its first half, so it ghosted over the curtain.
- The slam's drop (34 px) was too small to read, which made the dust look ~150 ms late even though it fired on the
  landing frame.
- Kept: the text arriving after landing, with no overlap mid-slide; the colour blooms; "Choose one"; the hover dim.

**Pass 2:**
- The curtain's title now leaves instantly and the banner starts opaque-ish, eased in-out. **One title travels up,
  and reads well.**
- The gather is a narrower column, peaking later. The card is opaque by 22%, with a 56 px peak and a harder ease-in
  drop.
- Remaining: the side cards' colour blooms sat in the slot, so they bloomed beside a card still settling from its
  overshoot (blobs of colour outside the art).

**Pass 3 (final):**
- The bloom moved inside the card.
- Clean at 16:9 (Indy, War in the middle), 21:9 (Warden) and phone landscape (Auctioneer).
- A frame-gap check found no hitches in the reveal. The gaps in the screencast were the capture itself: a rAF probe
  over the same window shows 0 frames over 30 ms on a warm run.
- The reveal slams' Pixi (the shockwave and spark defs) now pre-plays off screen at the awakening's start with the
  trail (`warmSlamFx`).

### Tuner and pins

New dials in "✦ Ancients › Reveal":
- title handoff (440)
- anticipation glow (420)
- text arrives (240)
- landing colour bloom (0.7)
- idle float (3 px) and its cycle (4800)
- hover dim (0.7)

`revealDelayMs` 80 → 180 (room for the gather). All of these are pinned in `ancientsConfig.test.ts`. The retune
revision is now 2, so an existing dev save takes the retuned values once.

### Perf

Profiled twice in headless Chrome, refresh to pick, on the dev server:
- Warm run: 0 long tasks, worst frame 17 ms.
- Cold run: one 78 ms task on the flash peak (the deliberate warm-up) and a 38 ms frame at the pick.
- New motion is transform/opacity one-shots and one transform-only loop (the idle float).
- One layout read each for the title and the banner at the reveal's start.
