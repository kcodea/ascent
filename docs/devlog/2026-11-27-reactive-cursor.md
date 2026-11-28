# 2026-11-27 — Reactive Cursor: the cursor wears your board's main tribe (plumbing; art pending)

Owner (Mike): *"lets make it a toggle-able setting called "Reactive Cursor" where the cursor automatically changes to the
theme of whatever tribe you have the most of on your board. A tie is broken by whichever of the tied tribes unit is
furthest left on the board"*. It started as a tribe-cursor cosmetic idea and became a setting instead ("For now, lets
not make it a drop"). Oracle rule `R-CURSOR-REACTIVE-01`.

## What shipped

- **One cursor source.** All 160 cursor rules in `packages/ui/src/**/*.css` now read `var(--cursor-default)`,
  `var(--cursor-open)` or `var(--cursor-closed)` instead of a raw `url('/cursors/…') x y`. The three properties live
  once on `:root` in `styles.css` and are the gauntlet, so nothing looks different. `reactiveCursor.test.ts` fails on any
  new raw `cursor: url(` in a CSS file. A hand-written cursor is now `cursor: var(--cursor-open), pointer;`.
- **The pick** (`packages/ui/src/reactiveCursor/reactiveCursor.ts`, `dominantTribe`): count each tribe on `run.board`
  (tribe, tribe2, spell-added tribes; an All-types minion counts toward every tribe; Neutral never). Most wins; a tie
  goes to the tied tribe of the leftmost minion that holds one (printed order within a minion; an All-types minion
  settles nothing). The recruit board is not edited by combat, so the cursor holds still through a fight.
- **Applying it** (`ReactiveCursor.tsx`, mounted in `Game.tsx` beside `FpsCounter`): the store selector returns the
  tribe as a string, so it re-renders only when the tribe changes, and then writes the three properties inline on
  `<html>`. Off, in menus, at game over / victory, replaying, spectating or live-watching: the properties are removed
  (the gauntlet).
- **The switch**: "Reactive Cursor" (default off, `localStorage` `ascent.reactiveCursorOn`) in both settings panels
  (EscMenu Cosmetics section; shell Settings, Cosmetics tab, "Cursor" section). **Hidden until some tribe has art**
  (`reactiveCursorReady()`), because until then it would do nothing.

## Adding a tribe's art (do this when the SVGs land)

1. Put three 32×32 SVGs in `apps/web/public/cursors/tribes/`: `<tribe>_default.svg`, `<tribe>_open.svg`,
   `<tribe>_closed.svg` (tribe ids: `beast undead mech dragon demon kobold dwarf celestial spirit`). Hotspots are the
   gauntlet's: the tip at (6, 2) for default and open, the grip at (13, 12) for closed. The style prompts are in the
   chat that started this; the gauntlet SVGs beside them are the reference.
2. Add the tribe to `TRIBES_WITH_CURSOR_ART` in `reactiveCursor.ts`. The test fails if any of its three files is missing.
3. The first tribe added makes the Settings switch appear: add a `patchNotes.ts` entry (Systems) in that PR, and update
   `currentBehaviour` of `R-CURSOR-REACTIVE-01`.

## Not done / calls to check

- Spectator and replay ghost cursors (`SpectatorCursor.tsx`, `ReplayCursorGhost.tsx`, `ReplayDragGhost.tsx`) stay the
  gauntlet: only your own mouse changes.
- `apps/dash` (the separate dashboard app) still has its own raw cursor urls; it is not the game.
