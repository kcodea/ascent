# 2026-09-25: The Discover look (ornate banner + spotlight backdrop)

Owner ask: improve the look of the Discover view. From the options offered, the owner picked two: an **ornate title
banner** and a **spotlight backdrop**. They did NOT pick "full cards with text" or "hover lift", so the option cards
are unchanged. The Discover entrance (PR #1712) and the Minimize / Return to Discover pill are untouched.

## What changed

- **Ornate title banner** (`discoverEntrance/OfferBanner.tsx`). The Discover and Choose One headings are no longer
  the flat dark-glass `.disc-banner` box. The title is now the Good Luck intro's gold Cinzel Decorative lettering
  between two filigree flourishes, sized for a heading. It reuses the intro's `Flourish` SVG, now exported from
  `goodLuck/GoodLuckIntro.tsx`. The banner is absolutely positioned and anchored by its bottom where the old
  banner's bottom sat, so the card row does not move and the Minimize pill still clears it. The quest shop,
  Runeforge, scout, power and commission overlays keep their own banners.
- **Source subtitle** (`discoverEntrance/offerSource.ts`). A small "From X" line under the title, shown only when the
  run state *records* the source:
  - **Choose One: yes.** `chooseOne.cardId` names the card being played ("From Runic Beetle"), and
    `chooseOne.equipmentId` names the Equipment ("From Prismatic Pick"). This replaces the old
    "Runic Beetle · click away to cancel" line. The cancel hint stays on its own line ("Click away to cancel").
  - **Discover: no.** `RunState.discover` is only the offered ids, and `DiscoverSpec` has no source field. The
    per-offer side flags (`discoverLockTier`, `discoverGolden`, `discoverBorrowed`, …) describe mechanics, not
    sources, and several are shared. Inferring "the last card played" would be wrong for queued Discovers,
    start-of-turn runes and hero powers. So, per the brief, a Discover shows **no subtitle**. "Triple reward" is
    not shown either: the Triple Reward token's Discover is not recorded as such once it opens.
    `DiscoverDialog` takes a `source` prop, ready for when the sim stamps a source on `DiscoverSpec`. That is a
    `state.ts` / `recruit.ts` / `reducer.ts` change across ~60 `queueDiscover` call sites, so it is left as a
    follow-up.
- **Spotlight backdrop** (`.discover-ov.disc-look` in `discoverEntrance.css`). The flat `rgba(22,15,9,0.72)` scrim
  over the live board is replaced, for the Discover and the Choose One, by two static gradients:
  - a warm radial spotlight centred on the card row, sized in `vh` so an ultrawide gets the same pool of light and
    not a wider one;
  - under it, a scrim that is `--dcl-tint` (0.84) behind the cards and darkens to `--dcl-vignette` (0.95) at the
    screen's edges.

  The board now shows through at about 14% behind the cards, down from 28%, so its cards stop competing.
- **Tuner.** Five dials were added to the 💫 Discover entrance tuner, in a "Look" group: Banner size (50), Backdrop
  tint (0.84), Vignette (0.95), Spotlight radius (40 vh; it is 1.6x as wide), and Spotlight strength (0.4). They are
  written as `--dcl-*` custom properties on the document root by `applyDiscoverLook` (once at load, and on every
  write or reset), so they move live. The CSS carries the same defaults as fallbacks. A test pins the CSS fallbacks
  to `DCE_DEFAULTS` so the two cannot drift apart.

## The Peek / Return button (follow-up ask, same day)

Owner, after seeing the above: *"can you make the minimize button better though?"*

- `discoverEntrance/DiscoverPeekToggle.tsx` replaces the plain dark "👁 Minimize" pill and its
  "Return to Discover · N options" twin. It is still **one button in one fixed spot** (`.disc-toggle`: viewport
  50% / 67%) for both states, so the player can flip back and forth without moving the mouse.
- **Label: "Peek at board"**, not "Minimize" (a judgement call, easy to revert). It says what the button is for.
  While minimized it reads **"Return to Discover"** with a small gold **"3 options"** chip.
- **Look:** a dark glass fill and a gold gradient trim (the banner's gold, drawn with the `padding-box` /
  `border-box` two-background trick), with small gold diamonds riding the trim at each end. The icons are inline
  SVG: an eye for Peek, and fanned cards rising for Return. The Icon-sprite glyph and the emoji are gone. The
  button carries `aria-pressed`. There is no `title=`, and the cursor is the global gauntlet.
- **Hover and press** are one-shot transitions of `transform` only (lift + 1.04 scale; press 0.97), plus the
  `opacity` of a separate glow layer whose `box-shadow` is static. Nothing loops. While minimized, the glow sits at
  0.55 so the button stays easy to find over the un-dimmed board.
- **Placement** is unchanged (top 67%). It clears the cards and the hand at both 1920x1080 and 3440x1440 (see the
  screenshots).
- **Tuner:** "Peek button size" (×1) in the same "Look" group (`--dcl-peek`).
- The Farseer scout's Close button, the quest shop's toggle and the Runeforge's toggle share `.disc-toggle` but are
  untouched: the new look is scoped to `.disc-peek`.

## Performance

Everything is static: no blur, no `backdrop-filter`, nothing animated. The backdrop is one full-viewport paint when
the overlay mounts, the same cost as the flat scrim it replaces. It fades in with the overlay's existing 200 ms
opacity fade. The title's glow is a static `filter`, rasterized once, like the Good Luck words.

## Gotcha: Cinzel Decorative's "oo"

Cinzel Decorative kerns its small-cap `oo` pair so tightly that the two rings interlock, so "Choose One" read as
"CHꝏSE ONE". It is **kerning** (about -21 px at 50 px), not a ligature: `font-variant-ligatures: none`, turning
off `liga`/`dlig`/`calt`, and a ZWNJ between the o's all measured identical widths. `font-kerning: none` on the
title fixes it. Any future mixed-case Cinzel Decorative title with "oo" needs the same fix.

## Screenshots

These are in `C:\Users\kevin\Pictures\ascent-shots\discover-look\`, outside the repo.

- `before-*` / `after-*`: a Discover, a Triple Reward Discover and a Choose One, at 1920x1080 and 3440x1440.
- `pill-before-*` / `pill-after-*`: the button, resting (`discover`), hovered (`pill-hover`) and minimized
  (`pill-minimized`).

The minimized shot exists at 1920x1080 only. At 3440x1440, headless Chrome never returned a frame of the full,
un-dimmed live board (software raster), before or after this change.
