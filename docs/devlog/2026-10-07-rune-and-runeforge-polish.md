# 2026-10-07 · Rune cards + Runeforge polish (PR #1977)

Owner asks, in order: remove the lightning-bolt badge on rune cards, rune text +20%, then "polish the full rune
experience", which ran through many rejected rounds before landing on the shipped look.

## What shipped
- **Bolt badge removed.** It was `.runecard-emblem`, a generic "rune sigil" medallion drawing the shared `sc`
  (lightning) icon. It meant nothing (not a trigger marker) and had already been hidden in the forge since 2026-08-30.
  The artless-rune badge fallback now uses the `engrave` glyph.
- **Rune card** (`RuneCard.tsx`, `runeCard.css`): one deep navy Gem plate body for every card (the `--ui-plate-*`
  theme tokens); the rune's FULL square art across the top, its lower 30% blurring and fading onto that body (crisp
  layer + blurred copy, both masked to zero, plus a navy wash; no seam); name in cream, a tribe-colour divider
  hairline, rules in light grey with tribe-coloured keywords. Tribe is an ACCENT only (`--rt-body`; neutral = soft
  gold, Dragon = coral since its tribe hue is white). Thin theme-gold rim; Epic differs only by a faint violet hint in
  the body. Tall card (`min-height: 1.72 cw`). Shared Gold coin (#1971) centred on the top edge.
- **Text +20%:** `--runecard-text-scale: 1.2` (rules) and the Look tuner's `nameScale` 1.12 to 1.34.
- **Hover/focus:** a 6 px lift (no scale) and a pre-rendered rim glow faded by opacity. No filter fog.
- **Rune rack badges:** the round art in a gold rim; Epic adds a thin violet + gold ring.
- **Runeforge** (`runeforgeEntrance/runeforgeLook.css`): the illustrated frame `runeforgebg2.webp` behind the offer
  at its shipped size (`50% 55% / auto 72%`, scrim 0.96); the Gem plate title ABOVE the frame (as before); Gold pill,
  Re-roll and Inspect as Gem plate pills with diamond studs; 60 rising embers (transform + opacity, stilled under
  reduced motion). Nothing bobs; no magic streaks.
- **Scene Builder:** "Enter Runeforge" / "Enter Epic Runeforge" (new dev-only `devOpenRuneforge` action through the
  real forge openers).
- **Tuners:** the Runeforge Look tuner is geometry-only now (colours come from the UI theme), storage key bumped to
  `ascent.runeforgeLook.v2`; the Runeforge Backdrop tuner is deleted (its art is fixed at the shipped values).

## Rejected along the way (don't re-propose)
Stone/gem-socket bezels, forged-iron and enamel settings, bobbing medallions over code-drawn anvils and a smithy,
magic streaks, a CSS-drawn signboard/chains/drapes/dais (owner HARD RULE: never fake illustration with CSS/SVG
drawings), a blurred-board backdrop with three grades, a six-option style sheet, per-tribe body fills ("mustardy"),
and a blurred art "bleed" behind a round window ("the cutout looks sloppy"). History is in the PR's WIP commits.

## Perf
Prod build, forge open with embers: avg 4.17 ms, p99 4.3 ms, worst 8.4 ms, 0 frames over 20 ms (240 Hz display).
The full-screen `backdrop-filter` experiment was dropped with the blurred backdrop (styles.css documents a 5 px
backdrop blur costing seconds per frame on a weak iGPU).
