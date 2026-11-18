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
- Config and tuner: an "Awakening panels" group (pop gap, pop, slide, stagger, hold, rattle, fall, settle, shake,
  sparks, lean) and two sound cues, `panelPop` and `panelSlam`.

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
- **The figures are the flat 512px paintings with a soft oval mask**, a stand-in. The owner wants depth inside each
  portrait, which needs cut-out layers per Ancient (background, figure, optional foreground) at about 800x1440.
- **The sounds are placeholders** from clips already in the repo.
- **Length.** About 3.3 s from the explosion to the reveal at the defaults, against about 1.6 s for the curtain.
- A file named `ancientPanels.ts` next to `AncientPanels.tsx` breaks the Windows typecheck (names differing only in
  case), hence `panelClock.ts`.
