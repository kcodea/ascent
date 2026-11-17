# 2026-11-17 — Hero Select "All heroes": the showcase card in a window (DEV-only)

The whole-roster Hero Select grid (Practice with "All heroes", and Gauntlet: more than six heroes offered) now uses the showcase card. It sits behind the **same DEV switch** as the three-hero showcase (`?heroshowcase=1` or the DEV menu entry "Hero Select: showcase layout"), needs the party home look, and is off by default. Switch off, the screen is exactly what it was. Design: `docs/superpowers/specs/2026-11-17-hero-select-all-heroes-design.md`; plan: `docs/superpowers/plans/2026-11-17-hero-select-all-heroes.md`.

**Owner asks (Mike, 2026-11-17).** "i want it to be the card view we just did for the new showcase but still the massive grid we currently have. when clicking a hero, it pulls up the showcase view and in the top right there should be an X to X out. or clicking outside of the showcase window should automatically close it." On the grid cards: "stay as is."

**What it is.** The grid is untouched. With the switch on, a card click no longer picks: it opens a window over the dimmed grid with the showcase's inspect card (splash art, Health, Armor, power, Ancients row), its arrows, and the Select Hero button. The X on the card's top-right corner, a press anywhere outside the card / arrows / button, and Escape close it. Only Select Hero picks.

**What is shared.** `HeroShowcase.tsx` now exports `useShowcaseNav` (stepping, keys, the Ancient on show) and `HeroShowcaseCard` (the card stage plus Select Hero). The three-hero showcase composes its tiles with them; the new `HeroBrowseWindow.tsx` composes a scrim and the X with them. The card's CSS rules in `heroShowcase.css` are written `.heroselect:is(.hss, .hsb)` so both roots get the same paint; the window's own rules are in `heroBrowseWindow.css` under `.heroselect.hsb`. One rule (`.heroselect.hss.hsc-active :is(.hss-stage, .hss-confirm)`) is pinned by exact text in `heroShowcase.test.tsx`, so it was left alone and the window has its own copy.

**In `HeroSelect`.** `browseShowcase` (switch on, more than six offered, not a watched screen) and `openIndex` (an index into the grid's alphabetical list). Root classes `hsb` and `hsb-open`. While the window is up the grid row is `inert`. On close, focus returns to the card of the hero last shown and `scrollIntoView({ block: 'nearest' })` brings it into view only if it is outside the visible rows. A new offer closes the window.

**The ceremony.** The existing `splash` source: the window card's splash art is the source, and the grid's cards are the exit set (every one leaves; none is the source). While it runs, nothing closes or steps.

**Claude's calls (not owner rulings).** The X wears the showcase re-roll's round navy plate with an inline two-stroke glyph (there is no X in `Icon.tsx`). No card pop on open or step (Mike removed that motion from the showcase card on 2026-11-16). Arrows step the whole roster alphabetically and wrap, with no counter. A `practiceOnly` hero keeps "Not currently enabled in Play" in the window. Scrim darkness (0.72) and the window's sizes are first guesses for Mike to tune.

**Verified.** New suites `heroShowcaseCard.test.tsx`, `heroBrowseWindow.test.tsx`, `heroBrowseSelect.test.tsx`; the existing hero-select, Gauntlet and spectate suites pass unmodified. Not yet seen in a browser: the look, the open / close and the hand-off are Mike's to judge.

**Not done.** No phone restyle, no search or filter, no `patchNotes.ts` entry (nothing player-facing ships while it is DEV-only).
