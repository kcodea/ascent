# 2026-11-22 · Round outlines on the hero attack numbers (no more spikes)

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
  works there too. These labels therefore LEFT the `data-wkt` layering (R-WEBKIT-SHADOW-01), and must stay out: that
  layering forces `text-shadow: none !important` on the label, which would delete the outline. `damageFormation.ts`
  writes plain `textContent` now. `webkitTextShadow.test.ts`'s floor of paired rules went from 9 to 6.
- **Cost.** All static paint; the labels still move by transform / opacity only. Sixteen unblurred glyph draws replace
  one stroke; the blurred pass count is unchanged (one glow per number). NOT profiled in the running game, and not
  checked on a real iPhone.

## Not done: the same spikes elsewhere

Other HTML text still outlined with `-webkit-text-stroke` + `paint-order: stroke fill`, which can spike the same way
(thicker stroke = more visible): `.float.dmg` combat damage floats and `.msnum` (styles.css), the plate tribe labels
(4px), `.wipevs-label` / `.wipevs-name` (4px), the spell / Ruby power floats, spell-card description numbers (1.5px),
hero-select names (`heroSelectPh.css` 5px, `heroShowcase.css`), the docked lobby rail (`lobbyRailDocked.css`), the
party home names (`partyHome.css`, up to 5 units) and the Collection skin tiles (`collection.css` 2px). Owner decides
whether to extend R-OUTLINE-ROUND-01 to them.
