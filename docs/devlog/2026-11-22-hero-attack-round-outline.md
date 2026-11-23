# 2026-11-22 · Round outlines on all outlined text (no more spikes)

Branch `fix/hero-attack-round-outline`. Rule R-OUTLINE-ROUND-01 (approved/foundation.ts). Owner 2026-11-22: "the pointy
edge that you fixed on N is the same issue that the numbers during all of the attack animation ceremony have".

## What

The damage formation's labels (`packages/ui/src/heroAttack/damageFormation.css`: tier chips, the minion and hero
totals, the full blow and its flash, the captions, the "Damage capped" stamp, the hit number) outlined their text with
a thick `-webkit-text-stroke` under the fill. Browsers draw that stroke with mitre joins, so every acute letter corner
(1, 4, 7, N, M, A, W) shot a spike out of the outline. `stroke-linejoin` does nothing on HTML text in Chrome.

The outline is now a ring: 16 unblurred `text-shadow` copies of the letters on a circle of radius `--ol-r` (half the
old stroke width, the half that showed outside the letter), colour `--ol-c`. A number's hard drop shadow and side glow
moved from `text-shadow` to a static `filter: drop-shadow(...) drop-shadow(...)`, with the blur halved (a text-shadow
blur radius is two standard deviations, a drop-shadow takes the deviation).

## Decisions worth knowing

- **Why the ring and not inline SVG `<text>` (the marketing site's fix).** SVG needs the label's box sized and its
  baseline placed by hand from the font's metrics, for nine labels that are centred by their own box and rewritten
  per frame during the cap crunch, and about forty style tests read these labels' `textContent`. The ring is a CSS-only
  change with the DOM untouched.
- **Why the shadow and glow became a filter.** Chromium's text-shadow shadows the STROKED shape, so the old drop shadow
  showed as a heavier bottom edge and the glow started at the outline's edge. A text-shadow next to the ring would
  shadow the bare letters only (the drop shadow vanishes under the ring, the glow shrinks). `filter: drop-shadow`
  shadows everything the label paints, ring included, which matches the old picture. Checked side by side in Chromium
  on a scratch page at the shipped sizes (128px total, 50px chip, caption sizes, and under a 1.6 scale).
- **WebKit.** No stroke means `paint-order` is normal, so iPhone draws the ring natively and `filter: drop-shadow`
  works there too. These labels therefore left the `data-wkt` layering (R-WEBKIT-SHADOW-01), which is deleted altogether below.
- **Cost.** All static paint; the labels still move by transform / opacity only. Sixteen unblurred glyph draws replace
  one stroke; the blurred pass count is unchanged (one glow per number). NOT profiled in the running game, and not
  checked on a real iPhone.

## Extended to every outlined label (owner, same day: "Yes, extend it")

The same ring now replaces the text stroke on: the Now Facing announcement (`.wipevs-label` / `.wipevs-name`), the
bold words on spell cards, the plate and drawer tribe labels, the combat damage floats (`.float.dmg`, radius = half
the tuner's `--dmg-num-stroke`), the spell / Ruby power floats, hero-select names and power names, the showcase
name, the docked lobby rail team name, the party home player name and the Collection skin tiles. 8 copies for an
outline of about 2px or less, 16 for the big names. The rule's home comment is "ROUND OUTLINES" in styles.css.

- **The WebKit layering is deleted**, not kept beside it: `webkitText.ts`, `installWebKitText()` in
  `apps/web/src/main.tsx`, every `data-wkt`, `--wk-stroke` / `--wk-ts` and the `html[data-webkit-text]` block.
  It existed only because a stroke under the fill needs `paint-order: stroke fill`, under which WebKit draws no
  text-shadow. No stroke, no paint-order, nothing to rebuild. `webkitTextShadow.test.ts` now pins "no HTML text
  rule sets a non-normal paint-order".
- **Shadows outside the hero attack are still text-shadows, listed after the ring** (no filter: these sit on every
  card or on many tiles, and a filter there was not worth an unprofiled risk). They are now cast by the bare letters,
  not the outlined shape, so the tribe labels, lobby rail name and Collection tiles had each blur widened by the
  outline radius to reach as far. Two things are knowingly different: the 1px hard drop under the lobby rail name
  and under the hero names (part of `--ph-shadow`) is now hidden by the outline instead of showing as a 1px heavier
  bottom edge.
- **A side fix on iPhone:** the party home player name and the hero-select hero name had a stroke with paint-order
  plus an inherited shadow and were never in the layering, so WebKit drew them with no shadow. They get it now.
- **Left alone:** the tier badge number (`.badge > .value`), whose stroke is a tuner value shipping at 0 and is not
  an outline under the fill. `roundOutline.test.ts` allows exactly that one declaration and fails on any new
  text stroke in `packages/ui`.
- **Not eyeballed:** only the hero attack sizes were compared against the old stroke (scratch page, Chromium). The
  other labels were converted by the same arithmetic and are unseen in the game and on a real iPhone.
