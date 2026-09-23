# 2026-09-22 — Medallion tuners, gem cleanup, gilded badge, keyword panel & dragon glow

Follow-on polish to the mechanic-medallion rework ([2026-09-21](2026-09-21-medallion-png-rework.md)),
all in `packages/ui`. Owner-driven, tuned live in the running game.

## Medallion tuner (`medallionConfig.ts` / `MedallionTuner.tsx` / `styles.css`)

The 🎖️ Medallions tuner grew from size/placement/art-inset to also own:

- **Backing circle** — a tunable background colour + outline (colour and width) and an on/off toggle. This drops
  the old per-tribe tint on the gem for a single global colour (`--cgem-bg` / `--cgem-outline`).
- **Art tint** — a desaturate % plus a tint colour/amount, applied as an overlay masked to the art's own shape
  (`--cgem-tint*`), so a medallion can be greyed or gold-washed.
- **Drop shadow** — a `filter: drop-shadow` (not `box-shadow`), so it follows the circle, or the bare art when
  the circle is toggled off.
- **Trigger-pulse colour** — the flash+ring a medallion fires on trigger was per-tribe; now a tunable colour.
  Rally / Watcher / Crit keep their own forced colours.

## Per-mechanic art size (`mechMedallion.ts`)

`MECH_MEDALLION_ART_SCALE` — a non-destructive per-mechanic multiplier layered on top of the global Art-inset,
to normalise arts that read small/large in the same box: `shout` 1.15, `endTurn` 0.90.

## Gem cleanup (`mechIcon.ts` / `Card.tsx`)

- `resolveMech` now excludes **Taunt** and **Ward** (`MEDALLION_EXCLUDED`) — they are signified by the shield
  frame and the divine-shield dome, so a glyph in the gem is redundant. Both remain in the compendium (which
  iterates `MECHANICS` directly). A card with Taunt/Ward + another mechanic shows the other one.
- No resolved mechanic → the `.cgem` span is not rendered at all (was an empty circle).

## Keyword panel (`KeywordDefs.tsx` / `Inspect.tsx`)

The hover/inspect definition column takes the card's resolved medallion mechanic (`resolveMech`, passed as a
prop) and, when it maps to a listed term (`KeywordDef.mechanic`), hoists that term to the top and badges its
title with the medallion icon. Runes/equipment pass no mechanic, so they are unchanged.

## Gilded (`styles.css` / `Card.tsx` / `gildedBadgeConfig.ts` / `GildedBadgeTuner.tsx`)

- Golden cards skip the global medallion desaturate/tint (`.card.golden .cgem`), so the naturally-gold art shows.
- The corner "tripled" marker is now authored art (`frames/gilded.webp`) instead of a CSS gold circle + crown
  glyph. Its layer was corrected from `z-index: 8` to `5` so it sits below the tier plate but above the frame on
  the board, matching the hover/inspect card (where `.archbox`'s `z-index: 1` had already trapped it correctly).
- A new 👑 **Gilded Badge** tuner (size / offset X / offset Y) with owner-baked defaults (size 1.58, dx 53,
  dy −30), registered in the dev menu, `tunerAll` and `PANEL_EMBLEMS`.

## Dragon term glow (`styles.css` / `Card.tsx`)

Dragon's tribe colour is white (= body text), so its coloured terms didn't stand out. Dragon cards (via a new
`data-tribe` on the card root) give their `.term` letters a subtle static pastel-rainbow text halo — static
paint only, no animation.

## Card rules-text box (`cardTextConfig.ts` / `styles.css`)

Owner tune: `padTop` 0.075 → 0.125, line-height 1.43 → 1.34 (CSS `--ctx-*` fallbacks mirrored).
