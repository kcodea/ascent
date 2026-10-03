# 2026-10-02 - The lobby rail wears the Gem plate (CSS frame, themed), Classic kept behind a DEV switch

Owner ask: "is this a png? how can you modernize/clean this up?" (the copper bevelled rail frame). Yes: it was
`public/opponents-backplate.webp`, stretched 100% x 100% over `.lobbyrail`, so its bevels distorted with the rail's
height. Plan approved: "sure, give it a shot".

## What changed

- **`packages/ui/src/lobbyRail.css`** (new, imported by `LobbyPanel.tsx`): the Gem rail. A 2px gold edge (a
  gradient under a transparent border), the `--ui-plate` gradient, an inner filigree ring (`.lobbyrail::before`)
  and a stud at its bottom centre (`::after`). Every colour reads the shared `--ui-*` tokens, so the 🎨 UI Theme
  tuner recolours the rail with the tooltips and HUD pills.
- **Rows**: resting seats are a darker inset panel; YOUR seat is a slim gold edge + soft gold glow (was a solid
  blue fill); the NEXT FOE is a red left accent bar + red hairline over a faint red wash (was a solid red fill),
  and its existing opacity-only pulse still runs; Health uses the health pill heart (`heartPill`, facet + gloss) and
  Armor the steel shield chip; the health bar draws at 60% thickness; names are a hair tighter. Dead seats: dimmed,
  grey portrait (static filter on the image only), name struck through and muted, placement as a muted label.
- **"N left"** is a small Gem pill hung on the inner ring at the top.
- **Switch**: `data-lobby-rail` on `<html>`, set by `lobbyRailLookConfig.ts` (🎨 Lobby Rail Look tuner, new "Look"
  select, persisted in DEV localStorage `ascent.lobbyRailLook`). The CSS paints Gem for anything but `classic`, so
  production is Gem with no JS. Classic keeps the bitmap and the old rows for comparison.
- **Tuners**: padding, rail / seat corners, portrait, pulse and size dials reach both looks. In Gem the rail corner
  dial is ADDED to a Gem base of 1.2 (it ships at 0, which suits the bitmap, not a CSS plate). The 🖼️ Opponents
  Backplate tuner's art rule is now scoped to Classic; its Dim also darkens the Gem plate (`--lby-dim`). The colour
  dials only reach Classic (Gem is themed by the UI Theme).
- **Guard**: `tooltipStyle.test.ts` fails a Gem rail rule in `lobbyRail.css` that hard-codes a colour.

## Layout contract (measured)

Rects compared Classic vs Gem in a live lobby at 1920x1080 and 1366x768 (headless Chrome over CDP): the rail, the
round header, the "N left" row, every seat, portrait, name line, health cluster, the three board zones, shop bar,
timer, hero, Refresh, Tier, Gold, End Turn and Freeze are identical to the hundredth of a pixel. The only change is
the health bar's VISIBLE height (60%, centred in its old box via margin). The rail still does not scroll, and still
slides away under the combat curtain.

## Fill-out pass (owner: "can you fill the opponent boxes out better so they are more readable and take up more of the space?")

Gem no longer keeps Classic's INNER geometry, only its outer box. The rail gets an explicit height, `--lgem-h`.
It is rebuilt from Classic's row recipe plus the seat count `--lby-n`, which `LobbyPanel` sets on the rail.
A measured 0.41-unit trim makes it match Classic to 0.01px at 1920x1080 and 1366x768. Inside that height:
- a thin gutter (the Rail inset dial x 1.78, so 8 units);
- seats that flex to share the column;
- a 1.22x portrait spanning the row;
- the name (1.3x, weight 900) on top, then the heart + armor chips (1.32x) with the round damage at the far right,
  then the health bar across the row at 0.8x Classic's thickness;
- long names ellipsize.

The rail clips (`overflow: hidden`) instead of scrolling, since the rows always fit.

## Knockout smoke + ghost marker

The owner asked: "can you add a simple animation for when a player is knocked out? some pixi smoke/burst as their
card fades. then, if the player is facing a ghost, make the target highlight greenish blue instead of red".

### The knockout

- **The effect:** a new FX def, `fx/defs/lobby-knockout.json`. It is 850 ms of grey-violet smoke, a puff burst and
  about 20 embers.
- **How it plays:** `lobbyKnockoutFx.ts` measures the row once and calls
  `playDef('lobby-knockout', centre)`. It is added to the `directCalls` snapshot and to the `UNIT_LESS` list in
  `playDefUids.test.ts` (the row is HUD chrome, not a unit).
- **When it fires:** `LobbyPanel` diffs the alive set against the one it last saw (`newlyKnockedOut`). The first
  sight of a table only records it, so a seat that is already out on mount or reload never plays the effect.
- **Timing:** a knockout lands at the settle, under the curtain. The effect is held by `whenCurtainDown` plus a
  rAF, the same hold the damage float uses, so it plays over the revealed rail.
- **The row:** it gets `.ko` for 950 ms, a one-shot swell-then-fade to its dead look (`lobbyko`, transform +
  opacity only). This works in both looks.
- **Sound:** none. No poof-like clip exists.

### The ghost marker

- **How a ghost pairing is marked:** `playerOpponent` (sim) returns `{ seat, board, ghost: true }`. This happens
  when the player holds the bye, or when its paired foe fields no board. `seat` is the FALLEN seat whose board is
  served, so its own (dead) rail row is the one marked.
- **The row:** `.lobbyseat.foe.ghost` paints the `--ui-ghost` teal. In Gem that is the left bar, the hairline, the
  wash and the pulse ring; in Classic it is the fill and the ring, glow and bar vars. The row is lifted to 0.92
  opacity so the marker reads.
- **The token:** `--ui-ghost` is new. It is #4fdccb in five themes and a cyan #62d8f2 in Verdant, so it doesn't
  read as the theme's green.
- **Other ghost surfaces:** the only one is the Fight Recap, which prints "Ghost" as the foe's subtitle (text, no
  colour). Now Facing and the combat opponent don't mark ghosts.

## Follow-up

When Classic is removed, `public/opponents-backplate.webp` is referenced only by the Classic rule in `styles.css`,
the Opponents Backplate tuner and `preloadPlan.ts`; delete it with them.
