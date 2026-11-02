# Scene Builder: rail navy skin + a denser layout (2026-11-01)

Owner ask: *"might as well update the scene builder too. if you think there's a better layout for this, please go
ahead and modernize that while you're at it"*. DEV tool only, so no patch note.

## Skin

`sceneBuilder.css` now wears the Docked lobby rail's look (the navy slice plate, a thin gold edge, white title text
under the rail's layered dark shadow, tabular numbers) instead of the purple Gem plate. Secondary buttons are navy
with a gold edge; primary buttons, the picked segment and "on" tiles take a gold fill printed in navy. Tier badges
keep their tier colours. The hero flyout follows.

Colours go through panel-local `--sbn-*` tokens that read the shared `--pill-*` tokens (from
`feat/pills-rail-style`, not on main when this shipped) and fall back to the rail's own values (`--lr2-navy` and the
stops its gradient resolves to by default). So the panel looks right today and follows the shared tokens when they
land. `tooltipStyle.test.ts` (no literal colour in this file) still holds. The Stage Builder shares `.scenebuilder`,
so it gets the navy skin too; its own layout is unchanged (the new layout rules are scoped to `.sb-modern`).

## Layout (judgement calls)

- **Fixed-height panel** (86vh, capped), with its own scroll regions instead of one long scrolling column. The shared
  `resize: both` grip still works, and a dragged height is kept.
- **Header**: the emblem went, the readout became chips (`R1 · 8 left`, `GOD`/`NORMAL`), plus a ⇔ wide toggle.
- **Quick bar** (never folds): the tier row, +1k Gold, ∞ refill (god), ❄ freeze, ✎ edit, ↻ rewatch. Edit and rewatch
  moved here from Enemy; Gold, refill, freeze and tier moved here from Table.
- **Library is the main body**, right under the quick bar, so the search box never moves. Tabs and search are pinned;
  the list fills the remaining height. It is no longer a foldable section.
- **Tools** sit under the library in their own scroll (max 46% of the panel): Enemy, Teammate (Duos only, as before),
  Table (sweeps + Runeforge doors), Setup, Scenarios.
- **Setup folds by default.** Its heading names the current picks (`Warden · Set 2 · bots 5 · duos`). A remembered
  open state still wins.
- **Wide mode**: ⇔ (or dragging the grip past 560px) switches to two columns, tools left and library right, both full
  height. It is a container query on the panel, no new state.
- **"/" focuses the library search** from anywhere outside a text field.
- Enemy's `+ enemy` and the three presets are one 4-wide tile row; Duos and Ancients toggles sit side by side;
  Scenarios uses the same 2- and 3-wide grids.

Every existing control is still in the panel. Behaviour and logic are unchanged apart from the "/" shortcut and the
⇔ width toggle. The only test changes: two suites open Setup first, plus a new layout test.
