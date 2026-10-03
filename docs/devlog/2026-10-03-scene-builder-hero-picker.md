# 2026-10-03: Scene Builder hero picker, Ancients checks, themed skin

Owner ask (verbatim): "can you make the hero selector easier and better to use? like can we expand the panel out to
the left or something with all the hero portraits to simply click? while in set 3, can you also display a check mark
next to heroes that have ancient support so that i know who to work on next? put archived heroes at the bottom all
clumped together instead of in the mix of current heroes. also have it follow our ui theming. lean it up and improve
the usability and readability of the scene builder."

DEV tool only, so no patch note.

## What changed

- **Portrait hero picker** (`SceneBuilderHeroPicker.tsx`). The Setup hero `<select>` is now a button showing the
  current hero's portrait and name. It opens a flyout of hero portraits beside the panel: LEFT when there is room,
  otherwise right (the panel's default spot is the screen's left edge). It has a search box, current heroes A to Z,
  then an **Archived** block at the bottom (dimmed, still clickable). The current hero is ringed. Keyboard: typing
  filters, Down walks into the grid, the arrows move, Enter picks, Escape closes. It also closes on a pick and on any
  outside click. A readout line names the hovered hero. It is a line, not a tooltip, because a bubble would clip
  inside the scrolling grid.
- **Ancients coverage in Set 3** (`sceneBuilderHeroes.ts`). This is derived from `ANCIENT_PAIRINGS`
  (`packages/sim/src/ancients.ts`), never a hand list. A hero with all six pairings gets a check. One with some
  gets a half disc and `n/6`, and the readout names the missing Ancients. There is a legend, a tally ("13 / 36
  heroes") and a "needs Ancients" filter. As of today all 13 registry heroes are full: Albus, Auctioneer (`myra`),
  Frantic Frank, Gorr, Hunch, Indy, Lord of the Risen, Re-Pete, Robin, Soren, Tradesman (`hermithank`), Warden and
  Xerox. None is partial.
- **Themed skin** (`sceneBuilder.css`). The `.scenebuilder` skin moved out of `styles.css` and was rebuilt on the
  shared `--ui-*` tokens and the Gem plate look. The panel now follows the 🎨 UI Theme tuner. The legacy `--sb-*`
  names point at the tokens, so the Stage Builder, the dummy stat badges and the count stepper pick the theme up too.
  `tooltipStyle.test.ts` now fails a literal colour in `sceneBuilder.css`. The CSS rides the DEV-only lazy chunk,
  so it has left the production stylesheet.
- **Lean-up.** All controls share one height (`--sb-ctl-h`). Labels use one size, a step larger than before. The Set
  select has its own full-width row (it used to truncate as "Set 3 — 148m · 64s"). The Ancients block is laid out
  (it had no CSS, so it wrapped badly). The status line is shorter, and so are the search placeholders. The
  whole-panel collapse is remembered (`ascent.sb.collapsed`), like the section folds already were. Visible em dashes
  are gone. Every control in the panel uses the gauntlet cursor (the shared `.sb-*` base rules carry a bare
  `cursor: pointer`).

## Removed

- The native hero `<select>`, replaced by the picker. `HERO_OPTIONS` (only its test used it) moved to
  `HERO_PICKS`. No other control was removed.

## Notes

- Portraits are plain lazy `<img>`s in a ring, not `HeroPortraitRing`. That component subscribes each instance to the
  portrait-frame tuner and decodes synchronously, which is wrong for a grid of 59.
- Tests: `sceneBuilderHeroPicker.test.tsx` (order, registry derivation incl. a partial stub, grid key model, panel
  click / keyboard / Escape / outside click) and the updated archived-hero test in `sceneBuilderPanel.test.tsx`.
