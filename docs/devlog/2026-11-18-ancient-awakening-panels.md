# 2026-11-18: the awakening's six panels

The Ancients awakening's centre beat (the curtain blooming out of the hero power, the hero power's medallion and the
"An Ancient Awakens" title hold) is replaced by a sequence built around the six Ancients' portraits. The omen before
it and the three-card reveal after it are unchanged.

## Owner direction (2026-11-18)

- "i was imagining more of a transition that is focused around the six portraits of the ancients"
- "a big (pixi fx driven) explosion occurs from the hero power section"
- "i want all 6 background colors to pop in from left to right, and then the ancient itself to slide down into place
  from completely off the screen either top or bottom, and then slide and slam to a stop"
- "almost grinding against eachother as their edges meet. and land with a shaking thud and sparks where they hit the
  other edge of the screen"
- "then 3 shake and their edges glow as the other three fade out and fall away, revealing the ancient select screen"

Same day, after seeing the first build in the game (it popped all six colours left to right, then slid the Ancients
in, with "An Ancient Awakens" over the six):

- "i dont like how the rainbow of colors shows up and then the ancients slide in. i want each background to slide in
  with the ancient quickly following. and we can try doing it outside to inside instead of left to right"
- "lets remove the ancient has awwakened text from the animation and have it pop in once the ancient select moment
  occurs"

So the panels set off in pairs, outside to inside; each background slides in from its own side with its Ancient right
behind it; the panels carry no title, and the select screen's banner pops in (with the title sting) on the reveal.

Agreed first on a standalone HTML mock (two rejected directions before it: an upward climb through painted scenery,
then panels that slid in whole), then built.

## What shipped

- `packages/ui/src/ancients/panelClock.ts`: the clock (`panelTimeline`) and the geometry (`panelGeometry`, the slanted
  strip and card polygons, the seam and leading-edge positions). Pure, pinned by `panelClock.test.ts`.
- `packages/ui/src/ancients/AncientPanels.tsx`: the layer. One-shot WAAPI transform / opacity, plus the offered
  three's one-shot clip onto their cards' art squares on the gate's `reveal` beat.
- `AncientGate.tsx`: `gateStyle` picks the centre beat. `panels` is the default; `curtain` keeps the earlier bloom,
  medallion, per-hero bloom signatures and title hold, untouched and selectable in the Ancients tuner.
- `wipeFx.ts`: `grind` (sparks along a moving point) and `spray` (a directional burst of streaks).
- `ancientsSmoke.ts`: `ancientEruptionBlast` (the pick's ring and the slam sparks at several times their size, plus
  streaks), in the hero's theme colour.
- Config and tuner: an "Awakening panels" group (pair stagger, pair gap, background slide, Ancient follows, slide, hold,
  rattle, fall, settle, shake, sparks, lean) and two sound cues, `panelBg` and `panelSlam`.

## Things a later session would otherwise re-derive

- **No live blur.** The owner asked for the screen to darken and blur. `styles.css` records that a 5px
  `backdrop-filter` over an open Discover measured multi-second frames on a weak GPU, so the Shop only darkens (the
  Discover backdrop fades in whole). The six colours cover the screen about 0.6 s later anyway.
- **Grinding sparks read no layout.** Their position comes from the slide's own cubic-bezier (`slideLeadY`), not a
  per-frame `getBoundingClientRect`.
- **The card target must not be read from the card.** On the `reveal` beat each card is still scaled down to its
  spark, so its rect is a point (the three panels shrank to dots in the first build). The slot is never transformed:
  the target is the slot's rect plus the art frame's layout offsets.
- **Only the panels' own host shakes**, never the game tree (`gateLayout.test.ts`).
- **Layered portraits (2026-11-19).** An Ancient with `art/ancients/panels/<id>_{back,figure,front}.webp` is drawn from
  three sheets (the place, the cut-out Ancient, loose magic painted on black and converted to alpha) that move by
  different amounts (`panelDepth`). All six have them (an Ancient without falls back to the flat 512px painting with a soft oval mask).
  `PANEL_FIGURE_FITS` places each tall figure so its mask lands where the flat painting's mask is, because the panel
  ends on the card and the card shows the flat painting; the figures are framed differently, so each has its own,
  measured by eye. `panelFigureRest` stands the figure whole in the strip before that. Masters:
  `C:Game AssetsAscent ArtAncientsParallax`; the ChatGPT brief is `docs/art-briefs/ancient-panel-layers.md`.
- **The sounds are placeholders** from clips already in the repo.
- **Length.** About 3.1 s from the explosion to the reveal at the defaults, against about 1.6 s for the curtain.
- A file named `ancientPanels.ts` next to `AncientPanels.tsx` breaks the Windows typecheck (names differing only in
  case), hence `panelClock.ts`.

## 2026-11-19: the curtain is deleted

Owner: "delete the curtain and its dials". The panels are the only awakening. Gone: the bloom, the hero power
medallion, the nine per-hero bloom styles and medallion entrances (`ancientHeroBloom.ts`, `AncientBloom.tsx`), the held
title card and its handoff to the banner, the seam ring and runes, the `gateStyle` switch and the dials `eruptionMs`,
`seamGlow`, `titleHoldMs`, `revealFadeMs`, `handoffMs`, `tunerStyle` (dropped from saved tuner values on load). Each
hero keeps its five awakening colours (omen, explosion, backdrop); their config names still say `curtain…` so saved
values survive. Anything above that describes the curtain as selectable is history. To bring the bloom styles back,
recover them from git before this commit.

## 2026-11-19: the figures stand in front of the strips

Owner: "i want the 'back' files to fall in the same slice format you currently have, but i want the 'figures' not to be
cut from those edges ... have them in front of those edges". Each panel is now two boxes over the same place:
`.anc-pn` (what the slanted strip clips: background, lit wash, seam) and `.anc-pn-over` in a second layer above all six
strips (the uncut figure, the foreground magic still clipped to its strip, the edge glow, the name). A figure cannot
simply be un-clipped inside its own panel: each panel is its own stacking context, so the next panel's background
would paint over it. Whatever moves a whole panel moves both boxes. The overs stack middle pair on top; the offered
three come to the front at the pick; the reveal crops each uncut figure to its card (`openPolygon` to `cardPolygon`).
At full size the figures overlap and cover most of the backgrounds; `panelFigureScale` ("Figure size") shrinks them
about their bottom edge.

## 2026-11-19: the ending (owner, same day)

- The names sit at the top of each panel; each Ancient has its own size dial (`<id>PanelSize`, on top of `panelFigureScale`).
- Every figure rises from the bottom (the backgrounds still alternate top and bottom).
- The chosen three get an OUTLINE glow (`.anc-pn-rim`: the cut-out again behind the figure with a static
  drop-shadow; only its opacity animates) that pulses with the strip edges.
- After the pulse ALL SIX backgrounds fall and fade, with the three Ancients not on offer. The chosen three slide
  along the bottom to the centres of three equal thirds (`spreadX`, `panelSpreadMs`), then the reveal moves each onto
  its card. `panelTimeline` gained `spreadAt`; `revealAt` now waits for the spread.
- The reveal is a SHOOTING STAR: each chosen figure pinches to a point at its mask (`panelFigureMaskY`) and the pick's
  own `gild-trail` (recoloured, muted) carries it to its card, timed to land as the card bursts out of its spark. The
  figure no longer shrinks onto the card's art, so `PANEL_FIGURE_FITS` now only places the figure in its panel;
  `panelToCardMs` is retired.
- New front layers (same day): the masters are no longer 2:3 (1201x1310 with empty margins; War 1024x1536), so the
  converter crops each to its art and the panel shows it at its natural shape, on the bottom edge, 1.5 strips wide and
  uncut. Converter scripts live in the session scratchpad, not the repo: black to alpha is `a = clamp((max(r,g,b) - 10)
  * 255 / 200)` with the colour un-multiplied, then a bounding-box crop on alpha > 24 with 10 px of padding.

## 2026-11-19: sound

- **The opening rumble was inaudible.** `omenRumble` is the 21 s turn-charge clip slowed to 0.62; the omen lasts 0.85 s,
  so only the clip's first half second ever played, which measures -61 to -49 dB at 30 to 90 Hz. Still to replace.
- New clips in `audio/fx/`: `ancient-stone-slide-1..6` (the owner's "sliding stone 1/2" takes layered in pairs and
  time-compressed with `atempo`, pitch kept, to about 0.5 s), `ancient-slam` (two cinematic booms layered, tail faded
  by 1.5 s), `ancient-hp-explosion` and `ancient-explosion-swoosh` (the owner's Cubase exports, unchanged).
- New cue `panelSlide` ("Ancient slides in"): `playCue`'s `variant` picks each Ancient's own slide from
  `PANEL_SLIDE_CLIPS` while the slot's clip is the shipped first one. The ids are literals so the phone pre-decode
  scan (`audio/codeClips.ts`) finds them.
- The tuner has a play button on every sound's volume row (`auditionCue`), and the sounds are named for their moment.
- `RETUNED_AT` replaces `RETUNED`: bumping `REV` used to re-reset every key an EARLIER revision had retuned, which
  would have wiped the owner's later tuning of those. Each revision now lists only its own keys.
- Audio work used the repo's `ffmpeg-static`; the build scripts were session scratch, not committed.
- `pickPulse` ("Three chosen"): `fx/ancient-pick-pulse`, a shine twice (0 and 345 ms, +11 dB) under a sparkle whoosh with
  its 0.5 s silent lead-in cut, so it peaks around 0.75 to 1.25 s, as the 820 ms pulse ends. One sound for the three.
- LEVELS: measured as heard (a clip's loudest 100 ms + the cue's gain in dB). Anchors tuned by the owner on
  2026-09-26: old explosion -11, title sting -12, pick impact -13. New: explosion -12 (gain 0.55), slam -18 (0.4),
  each stone slide -25 (0.32, all six re-rendered equally loud), three chosen -22 (0.4), pick click -22 (0.8).
- `omenRumble` is now `fx/ancient-opening-rise` (a 2.4 s riser). `playOmenRise` offsets or delays its start so the
  peak (`OMEN_RISE.peakMs`) lands on the explosion at any `omenMs`; gain 0.3 (its peak hits -5 dB, with the boom).
- `pickClick` ("Pick click"): `fx/ancient-pick-click`, on the click, before the woosh and impact.
- Still silent: the backgrounds falling, the slide along the bottom, the shooting stars.
