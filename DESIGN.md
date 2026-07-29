---
name: ASCENT
description: A warm, gilded auto-battler board — precious objects under lamplight, dense with information and legible under pressure.
colors:
  tangerine-signal: "#f0902e"
  tangerine-deep: "#c46f17"
  struck-gold: "#c8922e"
  struck-gold-light: "#e6b45a"
  ember-rose: "#e5446b"
  ember-rose-deep: "#b32c50"
  gold-coin: "#f4be35"
  gold-coin-deep: "#a8780f"
  attack-amber: "#f0a32a"
  health-coral: "#ff5a4f"
  execute-red: "#e8283f"
  vellum: "#fffdf8"
  parchment: "#efe5d4"
  board-stone: "#8c857a"
  rule-line: "#e7dcc7"
  ink: "#2a2017"
  ink-muted: "#6c5d48"
  ink-faint: "#9c8b71"
  contact-shadow: "rgba(90, 66, 30, 0.16)"
  tribe-beast: "#4ea83b"
  tribe-dragon: "#ffffff"
  tribe-mech: "#27a9dd"
  tribe-undead: "#22b8a8"
  tribe-demon: "#b15cf0"
  tribe-neutral: "#9a8d79"
  tier-1: "#74809a"
  tier-2: "#1f9d6b"
  tier-3: "#2b82d4"
  tier-4: "#7b54c8"
  tier-5: "#ef8a25"
  tier-6: "#e0395f"
  tier-7: "#9b4dff"
  night-navy: "#18243a"
  menu-cream: "#e7d9b5"
typography:
  display:
    fontFamily: "Outfit, sans-serif"
    fontSize: "86px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.1em"
  headline:
    fontFamily: "Outfit, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "0.14em"
  title:
    fontFamily: "Outfit, sans-serif"
    fontSize: "calc(18 * var(--u))"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.03em"
  body:
    fontFamily: "Nunito Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.34
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit, sans-serif"
    fontSize: "calc(11 * var(--u))"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  numeral:
    fontFamily: "Outfit, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  chip: "9px"
  card: "13px"
  stat: "16px"
  panel: "22px"
  plaque: "calc(13 * var(--u))"
  control: "calc(15 * var(--u))"
  pill: "999px"
  arch: "48% 48% 20% 20% / 35% 35% 14% 14%"
spacing:
  hair: "calc(4 * var(--u))"
  tight: "calc(6 * var(--u))"
  snug: "calc(9 * var(--u))"
  base: "calc(12 * var(--u))"
  wide: "calc(18 * var(--u))"
  broad: "calc(26 * var(--u))"
  row-gap: "calc(22px * var(--scale) / 0.745)"
components:
  button-shop:
    backgroundColor: "{colors.struck-gold-light}"
    textColor: "#5a3d12"
    typography: "{typography.title}"
    rounded: "calc(12 * var(--u))"
    padding: "0 calc(18 * var(--u))"
    height: "calc(50 * var(--u))"
  button-shop-hover:
    backgroundColor: "{colors.struck-gold-light}"
    textColor: "#5a3d12"
  button-go:
    backgroundColor: "{colors.tangerine-signal}"
    textColor: "#ffffff"
    rounded: "{rounded.chip}"
    padding: "7px 20px"
  button-menu:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.menu-cream}"
    typography: "{typography.headline}"
    rounded: "{rounded.chip}"
    padding: "15px 22px"
  button-menu-active:
    backgroundColor: "#3f7fc4"
    textColor: "#ffffff"
  card:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    width: "var(--cw)"
    height: "var(--ch)"
  card-text-drawer:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.chip}"
    padding: "6px 8px"
  plaque:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plaque}"
    padding: "calc(6 * var(--u)) calc(15 * var(--u))"
  tier-badge:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.chip}"
    padding: "3px 13px"
  opponent-name-pill:
    backgroundColor: "{colors.ember-rose}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "calc(2 * var(--u)) calc(14 * var(--u))"
---

# Design System: ASCENT

## Overview

**Creative North Star: "The Sunward Reliquary"**

ASCENT is warm sunlit metal and glass. Every meaningful object on screen is a *precious thing under
light* — a gold-framed portrait, a jewel-cut cost gem, an energy shell around a warded minion, a
plaque of struck gold holding a number. The board is not a canvas and not a document; it is a lit
surface with objects resting on it, and the objects have thickness. Nothing important floats
unmounted.

The system is **warm, tactile, and ornate**, and simultaneously **legible under pressure**. Those two
are not in tension here: ornament is load-bearing. A frame's metal tells you what kind of card it is
(gold oval = minion, purple square = spell, heater shield = Taunt); a badge's position never moves, so
a veteran reads seven minions and their stats in one glance; a colored halo means a *state*, not
decoration. Density is high by design — this is a board you scan, not a page you read — and the way it
stays readable is that every element holds a fixed, framed, predictable seat.

Two looks are confirmed anti-references. **Flat SaaS** — cool greys, hairline borders, muted accents,
neutral surfaces — is the opposite of this game and must never creep in through a new panel or dialog.
**Neon / cyberpunk / glassmorphism** — dark-mode gradients, cold glow, frosted translucency as an
aesthetic — is equally rejected. The warmth *is* the identity.

**Key Characteristics:**
- Warm vellum and parchment surfaces on a stone-grey board, trimmed in struck gold.
- Every control has thickness: a hard bottom edge and a bevel, built to be pressed.
- One tangerine call-to-action hue, used sparingly, against a field of gold and warm neutral.
- A fixed 16:9 stage scaled by one unitless factor, so the layout never reflows — it only zooms.
- Ornament as information: frame shape, badge position, and halo color all carry meaning.

## Colors

A warm, sunlit palette: an orange-to-gold core on warm neutrals and brown ink, with color reserved for
meaning — tribe, tier, threat, and stat.

### Primary

- **Tangerine Signal** (`--acc`): the single call-to-action hue. It marks what the player should act on
  next — the Face-the-Omen button, the frozen shop state, the tavern's next-tier number, the round-dot
  cursor. Deepened to **Tangerine Deep** (`--acc-dk`) for the pressed bottom edge and borders.
- **Struck Gold** (`--gold`): the trim metal. Every plaque, HUD frame, statstrip, shop control, and
  action tray is rimmed in it; **Struck Gold Light** (`--gold-lt`) is its lit top face in the
  180° button gradient.

### Secondary

- **Ember Rose** (`--threat`): the opponent-and-danger channel, and nothing else. The Omen banner, the
  opponent name pill, loss damage. **Ember Rose Deep** (`--threat-dk`) is its hard bottom edge.
- **Gold Coin** (`--mana`) / **Gold Coin Deep** (`--mana-dk`): the economy. Every cost numeral and coin
  glyph. Distinct from Struck Gold on purpose — trim is structure, coin is currency.

### Tertiary

- **Attack Amber** (`--atk`) and **Health Coral** (`--hpc`): the two stat badges, in fixed corners of
  every card, at every size. These two hues mean *only* attack and health.
- **Execute Red** (`--poison`): the Execute keyword channel — the ☠ float, the combat-log rule, the
  enemy-preview pip. (Retheme 2026-07-22; the CSS var name still tracks the engine's `poison` event.)
- **The tribe hues** (`--t-beast` … `--t-neutral`): six identity colors that drive each card's accent
  `--c` — the frame tint, the card body mix, and the outer ring. Dual-type cards split the card into
  both hues via `--c2`.
- **The tier ramp** (`--tier-1` … `--tier-6`): one source of truth for tier badges and the shop's TIER
  label, walking slate → green → blue → violet → orange → rose. **`--tier-7`** is deliberately
  *outside* that ramp in rift purple, so Tier 7 reads as beyond the ladder rather than one more rung.

### Neutral

- **Vellum** (`--card`): every card face, plaque, and panel fill.
- **Parchment** (`--bg2`): recessed and non-interactive chrome (the Tavern Tier label).
- **Board Stone** (`--bg`): the page behind the board art.
- **Rule Line** (`--line`): borders and dividers on non-gold panels.
- **Ink** / **Ink Muted** / **Ink Faint** (`--ink`, `--ink2`, `--ink3`): a warm brown text ramp —
  primary values, card description body, and small uppercase labels respectively.
- **Contact Shadow** (`--shadow`): the warm brown used for every grounding shadow. Shadows on this
  board are brown, never black-grey.

### Named Rules

**The One Signal Rule.** Tangerine Signal marks the *next action* and nothing else. If two things on a
screen are tangerine, one of them is wrong. Gold is structure; tangerine is the verb.

**The Meaning-Only Color Rule.** A hue on this board must be answerable: tribe, tier, stat, cost,
threat, or keyword. Decorative color has no seat. A new panel inherits vellum, gold, and ink — it does
not get its own accent.

**The Warm Shadow Rule.** Every shadow uses `--shadow` (warm brown) or a warm black. A cool or neutral
grey shadow reads instantly as foreign.

## Typography

**Display Font:** Outfit (with `sans-serif` fallback)
**Body Font:** Nunito Sans (with `sans-serif` fallback)
**Label/UI Font:** Outfit — `--font-ui` and `--font-title` are both Outfit today, but they are separate
roles and are swappable independently via the dev font selector on the title screen. Sora and Plus
Jakarta Sans are also loaded as selectable alternates.

**Character:** Outfit is a geometric sans with a wide, confident cap height — at weight 800–900 with
open letter-spacing it reads as struck metal lettering, which is why it carries every label, numeral,
and button. Nunito Sans is rounder and softer, and it earns its one job: card rules text, where reading
comfort at small sizes beats presence.

### Hierarchy

- **Display** (900, 86px, 0.1em tracking): the ASCENT wordmark on the title screen only, in warm cream
  with a soft blue outer glow.
- **Headline** (800, 24px, 0.14em tracking, uppercase): title-menu button labels. The widest tracking in
  the system — it is what makes the menu feel ceremonial.
- **Title** (800, `calc(18 * var(--u))`): HUD values and framed readouts — the win count, statstrip
  numbers, shop button labels.
- **Body** (600, 14px, 1.34 line-height): card description text, in Ink Muted on a vellum drawer, with
  `<b>` lifting key terms to full Ink. The only place Nunito Sans appears.
- **Label** (700, `calc(11 * var(--u))`, 0.08em tracking, uppercase): small chrome labels in Ink Faint
  — "RECORD", "MAX DMG", section captions.
- **Numeral** (800, 30px): the attack and health badges. Large, white, in a fixed 60×60 badge.

### Named Rules

**The Fixed-Badge Rule.** The attack / health / tribe cluster is identical on every card and is *never*
repositioned for a special frame. When a new frame shape arrives, the frame is sized around the badges —
not the other way around.

**The Uppercase-Is-Chrome Rule.** Uppercase plus letter-spacing means "this is interface furniture"
(labels, tier badges, menu items). Card names, rules text, and player-facing prose are never uppercased.

**The Live Number Rule.** Card text always prints the value the card will produce *right now* — folded
in by the `cardText.ts` helpers into both `liveCardText` and `Unit.tsx`. A base-only or stale printed
number is a defect, not a typographic choice.

## Layout

The game renders into a **centred stage box locked to 16:9** (`--gw` / `--gh`, derived from `100vw` and
`100dvh`). Everything sizes off that box, never off the raw viewport, so the UI *never reflows*: a wider
or taller window simply adds margin, which the board art extends into (`.boardbg`) rather than
letterboxing to black.

**One scale factor governs everything.** `--scale` is a unitless ratio — stage height ÷ a 1440px design
reference — set from JS (`applyStageScale` in `Game.tsx`) and clamped to `[0.45, 1.25]`. Every authored
dimension is expressed in reference pixels multiplied by `--scale`, so the entire UI grows and shrinks
as one locked unit against the board art. CSS cannot derive a unitless ratio from a length, which is why
this one value comes from JS.

Two derived scales hang off it:

- `--u` — the chrome unit (`1.34px × --scale × --ui-scale`). All HUD, tavern controls, status tray, and
  plaque geometry is authored as `calc(N * var(--u))`. This is the spacing system: there is no px scale,
  there are multiples of `--u`.
- `--ch` / `--cw` / `--ccw` — one standard card size everywhere (shop, warband, hand, combat): 384px tall
  at the reference, 0.752 aspect, with the compact card 15% narrower.

**Density and rows.** Cards sit in flex rows with a gap authored at 22px against the owner's ~0.745
desktop scale and re-scaled (`22px × --scale / 0.745`) so desktop is pixel-identical while the gap
shrinks *with* the cards on a small stage — without this, a seven-minion warband pushed its last card off
the board. Hand cards overlap instead of gapping, tucked down and fanned, popping up on hover.

**Responsive behavior is zoom, not reflow.** The Esc menu offers fixed resolution caps (1920/2560/3440),
each with its exact pixel ratio. Phone stages get two targeted boosts — `--mobile-boost` (1.15) enlarges
*cards only* for readability, `--hud-mobile` (1.1) enlarges non-shop HUD chrome — and off-stage overlays
(title, settings), authored in raw px outside the `--scale` system, use `--ui-zoom`: a shrink-only clamp
that never enlarges past the authored look. Phones are held landscape; a portrait touch device gets a
full-screen rotate prompt.

### Named Rules

**The One-Unit Rule.** New chrome is authored in `calc(N * var(--u))`, new card geometry off `--ch` /
`--cw` / `--ccw`. A raw `px` value in the in-stage UI is a bug: it will not scale with the board.

**The No-Reflow Rule.** The layout has one shape. Screen size changes the *scale*, never the arrangement.
Do not add a breakpoint that moves, stacks, or hides in-stage elements.

## Elevation & Depth

The model is **objects on a lit table**. Depth comes from three distinct devices that must not be
confused with each other:

1. **Hard offset shadows are structure.** `0 3px 0 var(--shadow)` under a card, `0 4px 0 var(--acc-dk)`
   under the Go button — no blur, a solid colored edge. This is *thickness*: the object has a side you
   can see, which is what makes it look pressable.
2. **Soft blurred shadows are contact.** `0 4px 12px -4px var(--shadow)` under plaques and frames; for
   authored-frame cards, a blurred black silhouette of the card's own frame PNG (`.cshadow`, seated
   behind the art) so every shape casts its own true contact shadow onto the board instead of floating.
3. **Inset highlights are lighting.** `inset 0 1px 0 rgba(255,255,255,0.6)` along the top edge of every
   gold-rimmed surface — the lamp above the table catching the metal.

**Colored halos are state, not depth.** A glow means something is happening: triple-ready (amber),
Ward's blue shell, hover (white), quest pulse. Never reach for a halo to make something look elevated.

### Shadow Vocabulary

- **Thickness** (`box-shadow: 0 3px 0 var(--shadow)`): the resting edge under a card or big button.
- **Thickness, accented** (`box-shadow: 0 4px 0 var(--acc-dk)`): the same, for a colored CTA — the edge
  is the darkened version of the button's own hue.
- **Plaque lift** (`inset 0 1px 0 rgba(255,255,255,0.6), 0 calc(3 * var(--u)) calc(8 * var(--u)) -3px var(--shadow)`):
  the standard gold-rimmed HUD surface — lit top edge plus a tight warm shadow.
- **Panel float** (`0 24px 70px -20px rgba(0,0,0,0.7)`): full-screen overlays only (the Minion Book),
  where the panel genuinely leaves the board.
- **Frame ground** (`filter: drop-shadow(0 4px 6px rgba(0,0,0,0.45))` on the frame PNG): grounds an
  authored-frame card to its own silhouette rather than a rectangle.

### Named Rules

**The Hard-Edge Rule.** If it can be clicked or dragged, it gets a hard offset edge. Blur-only shadows
read as "floating panel", which is a different and rarer thing.

**The Silhouette Rule.** Glow and shadow follow the *visible* shape, not the border box. On arched and
framed cards this means `filter: drop-shadow` or a frame-silhouette copy — a `box-shadow` there traces
the rectangle and shows as a boxy halo under the card.

## Shapes

The form language is **framed and rounded, never sharp**. Radii cluster tightly: 9px for chips, badges,
and menu buttons; 13px for cards and gold plaques (`calc(13 * var(--u))` where it must scale); 15–16px
for large controls and stat badges; 22px for full-screen panels; `999px` for name pills; `50%` for the
cost gem and the Ward shell.

The system's signature silhouettes are not rectangles at all:

- **The arch** (`--arch-radius`, `48% 48% 20% 20% / 35% 35% 14% 14%`): the compact card's domed top,
  shared by the frame, the card box, and keyword overlays.
- **The heater shield**: a 21-point `clip-path` polygon for Taunt minions — the shape *is* the keyword.
- **The gold oval** and **the purple square**: authored PNG frames for standard minions and spells,
  layered portrait → frame → tribe tint → DOM badges → FX, with geometry measured from each PNG's alpha.
  If the PNG fails to load, `Card.tsx` drops the class and the card falls back to its arch look.

Borders are 2px and near-universal: `--line` on neutral panels, `--gold` on anything the HUD owns, and a
4px ring of the card's own tribe hue around every card (`0 0 0 4px var(--c)`).

### Named Rules

**The Frame-Tells-The-Type Rule.** Silhouette is a category signal — oval minion, square spell, heater
Taunt, rift-purple Tier 7. Do not introduce a new frame shape without a new meaning behind it, and never
reuse an existing shape for a different category.

**The Fallback-Shape Rule.** Every authored-frame treatment must degrade to a plain arched card if its
asset is missing. A card with no frame is acceptable; a card with no art window is not.

## Components

### Buttons

- **Shape:** softly rounded (`calc(12 * var(--u))`), 2px Struck Gold border, `calc(50 * var(--u))` tall.
- **Shop button (primary chrome):** a 180° warm gradient from `#f5e8cb` to `#e4c992` — lit metal — with
  deep brown label text (`#5a3d12`), a lit inset top edge, and a warm offset shadow. Costs inside a
  button render in Gold Coin Deep.
- **Hover / press:** `transform` and `filter` only, at 0.1s ease. Never animate the gradient on a loop.
- **Go button (the CTA):** solid Tangerine Signal, white label, hard `0 4px 0` Tangerine Deep edge that
  disappears on `:disabled` — the button visibly loses its thickness when it can't be pressed.
- **Tavern Tier box (non-interactive):** the same silhouette in Parchment with an Ink Muted label and a
  `--line` border, so a *label* is legible as not-a-button at a glance.
- **Title menu button:** the ceremonial variant — night-navy gradient, thin gold rim, a framed gold icon
  cell, uppercase 0.14em label. Hover slides it 6px right and brightens the rim; the active item swaps to
  a blue call-to-action fill.

### Cards / Containers

- **Corner style:** 13px, or the arch / authored frame for compact cards.
- **Background:** the card's tribe hue mixed 30% into Vellum, so every card is subtly its own color.
- **Ring:** a 4px ring of the tribe hue, plus a soft outer bloom of the same hue at 70%.
- **Shadow strategy:** thickness edge at rest (see Elevation); on hover, a white glow that hugs the
  silhouette via `drop-shadow` — no lift, no tilt, and no `z-index` bump (raising z would create a
  stacking context above the shield canvas and hide the Ward aura).
- **Internal padding:** 7px art inset; a Vellum text drawer with 6px/8px padding and a hairline shadow.
- **Mount:** `popin` is opt-in and frozen at mount, so freshly bought cards pop but a warband
  re-mounting after combat does not jiggle. Hand cards use `handpop`, which ends at the *tucked* resting
  transform so they land once instead of settling twice.

### Plaques and Readouts

The HUD's universal container: Vellum fill, 2px Struck Gold border, `calc(13 * var(--u))` radius, lit
inset top edge, warm offset shadow. The hero panel, alt-stats strip, statstrip, and opponent frame are
all this one object at different widths. Labels inside are uppercase Ink Faint; values are Outfit 800.

### Pills and Badges

- **Tier badge:** Ink fill, white uppercase 12px at 0.05em, 9px radius, seated at the card's top edge.
- **Opponent name pill:** Ember Rose fill, white, `999px`, with a 2px Vellum border so it reads as
  mounted *on* the frame rather than sitting inside it.
- **Cost gem:** a circular radial-gradient jewel (`#ffe293 → #eab63f → #b9821f`) with a near-black 3px
  rim and both inner highlight and inner shadow — the most three-dimensional object in the system.
  Discounted cost swaps to the green variant with the same construction.

### Signature Component — The Authored Frame

The system's defining component. A compact card composites: portrait clipped to the frame's measured
window → authored PNG frame on top → per-tribe tint (minions only) → DOM badges and tier → FX layer.
Geometry is measured from each PNG's alpha and expressed as multipliers off a single `--sh` knob, so one
value scales the whole composite with no JS measurement. A second copy of the frame image, blackened and
blurred, sits behind the art as the grounding shadow; a third copy behind the portrait carries the hover
glow, so the glow can never bleed over the art.

### Signature Component — The Ward Glass Shell

A light-blue hexagonal energy shell encasing the whole card, painted *over* the frame so the gold sits
inside the glass. Layers paint fill → hex → sheen → rim, with the halo cast by the container. The box is
derived from each frame asset's real pixel aspect and centre-anchored, so it tracks the frame at any size
with no measuring. `border-radius: 50%` is load-bearing — the halo is a `box-shadow`, and a `clip-path`
would cut it away entirely.

## Do's and Don'ts

### Do:

- **Do** author in-stage geometry as `calc(N * var(--u))` for chrome and off `--ch` / `--cw` / `--ccw`
  for cards, so it scales with the board.
- **Do** give anything clickable or draggable a hard offset edge (`0 3px 0 var(--shadow)`, or `0 4px 0`
  in the control's own darkened hue) and remove it on `:disabled`.
- **Do** use warm shadows (`--shadow`, or warm blacks). Cool grey shadows read as foreign instantly.
- **Do** follow the visible silhouette with `filter: drop-shadow` (or a frame-silhouette copy) on arched
  and framed cards.
- **Do** keep the attack / health / tribe cluster in its fixed position and size a new frame *around* it.
- **Do** print the live computed value in card text, wired through both `liveCardText` and `Unit.tsx`.
- **Do** pair every color-coded signal with a second channel — shape, icon, text, or position.
- **Do** degrade an authored-frame treatment to the plain arched card when its asset is missing.

### Don't:

- **Don't** animate paint properties (`box-shadow`, `filter`, `background`, `border-radius`) in a
  *looping* animation. Loop `transform` and `opacity` only; for a breathing glow, animate the opacity of
  a `::before` carrying a static shadow (see `kwglow`). One-shot transitions may touch paint if profiled.
- **Don't** introduce flat-SaaS chrome — cool greys, hairline borders, neutral surfaces, muted accents.
  It is a confirmed anti-reference.
- **Don't** introduce neon, cyberpunk gradients, or glassmorphism. The warmth is the identity.
- **Don't** use Tangerine Signal for anything but the next action. Two tangerine things on one screen
  means one is wrong.
- **Don't** give a new panel its own accent color. It inherits Vellum, Struck Gold, and Ink.
- **Don't** put a raw `px` value in the in-stage UI — it will not scale with the board.
- **Don't** add a breakpoint that moves, stacks, or hides in-stage elements. Screen size changes scale,
  never arrangement.
- **Don't** uppercase card names, rules text, or player-facing prose. Uppercase means interface furniture.
- **Don't** bump `z-index` on card hover — it creates a stacking context above the shield canvas and hides
  the Ward aura.
- **Don't** use a colored halo to convey elevation. Halos mean state.
