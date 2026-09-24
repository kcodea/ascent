# 2026-09-24: Discover shows the live board; native tooltips removed everywhere

Owner (verbatim, with screenshots): *"why does the discover not have the actual live board"* and *"also remove
the window tooltips on these buttons (and every button they break immersion so badly)"*.

## 1. The Discover backdrop

**Root cause.** `packages/ui/src/styles.css`, the `.discover-ov::before` rule added by #1344 (2026-08-31,
"hero-select blur + darkening on Discover / Choose One"). To copy the hero-select look without a live
`backdrop-filter`, it painted a full-viewport `::before` of the STATIC board art (`var(--board)` under a dark
gradient, `filter: blur(16px)`). That layer is opaque, so it hid everything the player owns: the shop row, the
warband, the hero cluster, the hand and the lobby rail. The player saw an empty table behind the cards. Nothing
was unmounted or hidden in React; the board was there, just painted over.

**Fix.** The `::before` is gone. `.discover-ov` is a plain translucent scrim, `rgba(22, 15, 9, 0.72)`, over the
real board. The existing `body.modalup .app { z-index: auto }` stacking fix already puts the hero panel and the
rail under the overlay, so they dim with the board. Every overlay on the same chrome gets this: Discover, Choose
One, the quest and hero-power offers, the scout reveal and the commission picks. The Runeforge is different on
purpose. It already opted out of the `::before` and paints its own near-opaque slate scrim plus the forge frame
art over the live board, so it did not have this bug. It is unchanged.

**No blur, measured.** The obvious fix, a `backdrop-filter: blur()` over the live board, was measured and
rejected. Method: headless Chrome through CDP against the dev server (5279) at 1920x1080. An uncapped frame
loop (`--disable-gpu-vsync --disable-frame-rate-limit`) with a Discover open for 2.5 s per variant, three
interleaved reps. Blur cost is compositor/GPU work, the same in dev and prod. Things under the modal DO animate
on loops: the End Turn / Refresh / Tavern sheens, the charge pulse, the lobby foe pulse and the FX canvases. So a
live blur is recomputed every frame.

| Variant | RTX 4080 (D3D11), fps | SwiftShader (software raster), worst frame |
|---|---|---|
| Old static board-art layer | 226 to 796 | 332 to 476 ms |
| Live board, scrim only (shipped) | 237 to 861 | 385 to 1073 ms |
| Live board + 5px backdrop blur | 259 to 836 | **2487 to 7364 ms** |
| Live board + 16px backdrop blur | 265 to 915 | 476 to 722 ms |

On a real GPU nothing is measurable; every variant is far past any refresh rate, and the spread is run-to-run
noise. On software raster, the stand-in for a weak integrated GPU, the live blur produced multi-second frames.
The scrim stays in the same band as the old static layer. So the scrim ships, and the CSS comment warns against
putting a blur back without re-measuring.

## 2. Native `title` tooltips

298 `title=` attributes on DOM elements across 46 files, plus one SVG `<title>` (the FX Workbench curve handle)
and one imperative `btn.title` (the dev-panel close button in `useDraggablePanel.ts`). All are gone.

Codemod rule (TypeScript AST, lowercase JSX tags only; component props named `title` were left alone):
- the element already had an `aria-label`: the `title` was dropped (39);
- the element shows its own text: `title` became `aria-description`, so the visible name still wins (about 110);
- icon-only or glyph-only (`✕`, `▶`, `⧉`): `title` became `aria-label` (about 150).

The four `Minimize` / `Return to …` toggles (Discover, quest, Runeforge) and the scout Close button carry
`aria-description`, so their accessible name stays their visible label.

**Moved into the game's own hover** (new `.gtip[data-tip]` bubble in styles.css; opt-in, compositor-only, opens
above by default, with `.gtip-down` / `.gtip-end` variants): the text a player actually needs.
- Henchman recruit chip: the cost and the win -3 / loss -2 decay.
- Lobby rail and course HUD max-loss chip: "Most Health you can lose if you lose this combat". It sits inside the
  rail's clipped scroller, so it opens below, right-anchored, narrowed to fit.
- Runeforge free re-roll: once per game, and spending it forfeits the other forge's re-roll.
- Rune card "Does not stack" / "Copy refunds" note under Rune of Duplication, and the pivot-discount cost gem.
- Combat Summary: "Outcome odds" (estimated from simulations) and "Avg damage on loss".

**Tripwire.** `eslint.config.mjs` `banTitleTooltips` (`no-restricted-syntax`, packages/ui + apps/web, tests
exempt). It flags a `title` attribute on a lowercase JSX element, a JSX `<title>` element, `x.title = …` (except
`document.title`), and `setAttribute('title', …)`. `packages/ui/src/discoverBackdropNoTitle.test.ts` repeats the
JSX scan under `npm test` and pins the Discover scrim (no `var(--board)` layer, translucent rgba, no
`backdrop-filter` / `filter`). Oracle: R-PRESENT-11. CLAUDE.md UI conventions carry the rule next to the cursor
rule.

`document.querySelectorAll('[title]').length` on the dev server, before and after. The "before" figure counts the
dev-only PerfHud; the figure in brackets leaves it out.

| Surface | Before | After |
|---|---|---|
| Title screen | 24 (4) | 0 |
| Shop | 26 (7) | 0 |
| Discover open | 27 (8) | 0 |
| Discover minimized | not measured | 0 |
| Esc menu | 27 (7) | 0 |
| Career | 23 (4) | 0 |
| Ladder | 20 (4) | 0 |
