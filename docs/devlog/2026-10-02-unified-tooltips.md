# 2026-10-02 — One tooltip style everywhere (the Aegis look) + a Tooltips tuner

Owner ask: "can we unify our tooltips everywhere stylistically so that they all match? let's use the Aegis version
for tooltips." Follow-up: "add a tuner for text size for the tooltips as well so i can adjust text size and dial it
in."

## What changed

- **`packages/ui/src/tooltips.css`** (new, imported by `Game.tsx` right after `styles.css`) owns the look of every
  tip: the `--atip-*` tokens (panel gradient, hairline, gold top edge, title, body, highlight, divider, pill, sizes)
  and the skin groups that paint them. The look is the hero-power tip (`.herotip`, "Aegis"), made fully opaque.
- Every legacy tip class keeps only its geometry and behaviour in `styles.css` (position, width, delay, show/hide);
  its paint and type moved to the skin. Migrated: hero power / second power / Equipment / foe power (`.herotip`),
  quest and rune badges everywhere (`.questbadge-tip`: HUD, opponent frame, combat foe, lobby scout sockets,
  Gauntlet foe), rift pill + rift button, run trophies + ladder rune chips, Career / match-details rune and hero
  panels (`.cv2-rune-tip`, `.cv2-herotip`), the Gold readout (`.goldtip`), the shop pills (`.sbtip`, Tavern Up,
  End Turn, Refresh), end-screen build tags, the in-game `data-tip` bubble (`.gtip`), the title / Career / ladder
  and Balance page bubbles, keyword glossary pills (`.kwbox`, type scaled by `--atip-kw-k` because the hover reveal
  and Inspect zoom them), the Inspect buff list, the lobby scout card frame and the Ancients preview card.
- The rune / quest / rift tips were translucent blurred glass; they are now the opaque panel (no
  `backdrop-filter`), left-aligned with a gold title, a divider and the state as a pill.
- Dead CSS removed: the old in-card `.tip` keyword tooltip (no markup used it). The Scout Card tuner lost its three
  frame colour dials (background top / bottom, frame), which the shared panel now owns.
- **`TipPanel.tsx`**: a small component that renders the shared `.atip` classes (title, optional icon, body,
  pills, optional arrow, or a one-line `simple` tip) for new tooltips.
- **💬 Tooltips tuner** (`tooltipConfig.ts` + `TooltipTuner.tsx`, registered in DevMenu, `PANEL_EMBLEMS` and
  `tunerAll`): title / body / pill / one-line text sizes, line height, max width and padding, written straight to
  the `--atip-*` custom properties on `:root` (no re-render). DEV-only persistence (`ascent.tooltips`); production
  plays the baked DEFAULTS, which mirror tooltips.css. Pinned sample tips in the panel; Copy values / Reset as usual.

## One size system (owner follow-up: the Gold tip was far bigger than the rest)

Most tips sit inside a SCALED control (Gold pill x1.69, Refresh x1.54, Tavern Up x1.24, quest/rune row x1.09, hero
power x0.87, the card reveal's keyword column zoomed x1.52, Inspect x1.9), and a scaled parent scaled its tip, so the
Gold readout rendered at 28px while the hero tip rendered at 13px. Each tip now declares its parent's scale as
`--atip-k` (read from that control's own tuner var), and every size is `dial / --atip-k` via the `--atip-z-*` values
derived on each tip. The dials are therefore true ON-SCREEN px and move every tip by the same amount; sizes inside
a tip are `em`. Measured at 1920x1080: every rich tip's title, body and padding render at exactly the dial values,
and moving the body dial to 22 moved hero power, rune, Gold and keyword pills to 22 together. The guard test now
also fails a tip (or a part of one) that sets its own font-size / padding / line-height.

Baked the owner's dialled values: title 17, body 17, pill 16, one-line 14, line height 1.42, max width 320,
padding 12 (on-screen px).

## Kept deliberately

- The **End Combat** label (`.etbwrap.ready .etb-tip`) keeps its Combat Controls tuner colours: it is a standing
  button label, not a hover tip. The End Turn tip keeps its owner-tuned size / padding / radius dials.
- A **Rebirth** keyword pill keeps its blue fire border and title.
- JS-placed tips keep their fixed widths (`.cv2-rune-tip` 280, `.cv2-herotip` 250) because their placement math uses
  them. Everything else is content-sized up to the max width.
- Own sizes (`OWN_SIZE_EXCEPTIONS`): the End Turn / End Combat tips (their tuner dials), the lobby scout card (Scout
  Card text dials) and the Ancients preview (its page sizer).
- The tutorial coach panels are a guided-lesson UI, not hover tips, and were left alone.

## Guard

`tooltipStyle.test.ts` (source scan, registry in `tooltipRegistry.ts`) fails when: a tip rule paints itself
outside `var(--atip-*)`; a new tip-looking class is not registered; a `role="tooltip"` element lacks a registered
tip class; a DOM element carries a native `title=`; the tuner defaults drift from the stylesheet tokens.

## Verified

Before / after screenshots at 1920x1080 (headless Chrome over CDP): hero power, rune, Tavern Up, Gold, Refresh, End
Turn, keyword pill on a card hover, lobby scout card, lobby max-loss bubble, Rules bubble, title / Career sidebar
bubble, Collection, and the tuner dialled to 18px body. Layout-shift probe: hovering each tip moves no other board
element (the only rect change is the Rules button's own 2px hover lift). Every visible tip stayed inside the viewport.

## Follow-ups

- The Freeze button's `.frz-tip` has no hover rule, so it never shows (pre-existing). Wire it or delete it.
