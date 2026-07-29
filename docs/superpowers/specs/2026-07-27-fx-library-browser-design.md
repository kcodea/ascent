# FX library browser — design

**Date:** 2026-07-27
**Status:** approved (owner, 2026-07-27)
**Scope:** phase A of A→C. Phase C (bindings-as-data) is specified separately when A lands.

## Problem

The workbench's def library is a flat list of ids with a layer count and a duration. At 20 defs it is
already hard to use, and it answers only one question — "what is this called" — while the owner has three:

1. **Find one to build from.** "I want a red impact; show me the red impacts."
2. **See what is wired where.** "What fires on a summon? What has nothing yet?"
3. **Find a card's effects.** "What does Bloodbinder look like right now?"

Nothing in the current UI serves 2 or 3 at all, and the recent Bloodbinder work showed why that matters: a
binding can be wrong, missing, or point at a def that does not exist, and **none of those states are visible
anywhere**. They present identically — as an effect that silently does not play.

## Decisions taken

| Question | Decision |
|---|---|
| What is the library for? | All three jobs above — it must work as a palette, a coverage map, and a card lens. |
| Where do facets come from? | **Derive what is derivable; author only what is not.** No back-filling for existing defs. |
| How is an effect recognised? | **Hover plays it live.** No stored thumbnails. |
| Where does it live? | **Full-screen browse overlay**, not the 448px rail. |
| Can it change bindings? | **No.** Read-only in phase A; writing is phase C. |

## Architecture

### The catalog — `packages/ui/src/fx/ui/catalog.ts`

One new pure module produces `FxCatalogEntry[]`. Every view in this design reads that array and nothing
else, so a fact is computed exactly once and the lenses cannot disagree.

Each entry is the `StoredFxDef` plus:

**Derived (never authored):**

- **shape** — the primitives used, in layer order, as the human labels already in `ui/copy.ts`
  (`Ring + Burst + Trail`). Reuses the vocabulary the primitive row already teaches.
- **colour** — the dominant hue. For each layer with a `palette` param, read the **second** stop and convert
  to HSL; bucket the hue into `red | orange | gold | green | cyan | blue | violet | magenta | neutral`. The
  entry's colour is the most common bucket across its layers; ties go to the first layer.
  The second stop specifically: stop 4 is `#ffffff` in nearly every def, and stop 1 is the dark rim — only
  stop 2 carries the identifying colour.
- **motion** — `travels` when any layer anchors to `travel`, else `in place`.
- **bindings** — the moment kinds whose default cue names this def; the cards in `CARD_FX` that override to
  it; and those cards' tribes, read from `CARD_INDEX`.

**Authored (both optional, in the def JSON):**

- **label** — a display name (`"Ember Lance"`).
- **tags** — free text (`["impact", "spell", "big"]`).

Absent is fine. An untagged def appears in every view; it simply cannot be found by a word that is not
derivable from its data. Nothing needs back-filling.

Both fields sit at the TOP level of the def JSON, beside `id` and `duration`. `defStore.coerceDef` must
carry them through (dropping a non-string `label` and any non-string tag rather than throwing, consistent
with how it treats every other optional field), and `defs.test.ts` must accept them so a labelled def does
not fail the committed-def guard.

### The inverse index

The same module also produces **every `MomentKind` with the def bound to it, or `null`**. This is what lets
the coverage lens show gaps, and it is the single source for "which def fires on X" — the question that was
being answered in two places during the Bloodbinder work.

### Placement

`fx/ui/catalog.ts` rather than `fx/catalog.ts`, because it is the only module that needs to see both the
defs and the choreo bindings. No cycle: `choreo` imports `fx/playDef`, and `fx/playDef` never imports
`fx/ui`.

## The browse overlay

A full-screen overlay, opened from the workbench's "Start from" header and directly from the Dev Menu.
One component, one lens switch, one filter set — the lenses are groupings and filters over the catalog
array, not separate screens.

**Layout:** facet sidebar left, results right, **preview stage** pinned in the corner of the results area.

**Hover to preview.** Hovering a row plays that def in the preview stage on the One-way scenario, after a
~120ms delay, reusing a **single** player instance that is re-pointed rather than respawned. Without that,
dragging down a list of 20 rows spawns and destroys 20 players.

**Click** loads the def into the editor and closes the overlay. **⧉** still duplicates as a fresh unsaved
template.

**Facets, applying in every lens:** colour swatches, shape checkboxes, motion, bound/unbound. Plus a search
box matching id, label, tags and card names.

**Lenses:**

- **By look** — grouped by shape, then colour. The palette of starting points.
- **By event** — one row per `MomentKind` showing its bound def or a greyed *"nothing bound"*, with per-card
  overrides nested beneath. Unbound kinds are **always shown and never filtered away**: the gaps are the
  entire point of this lens.
- **By card** — **every card in `CARD_INDEX`**, grouped by tribe then card. Each card shows its explicit
  override, or *"uses defaults"*. Listing all of them (not just the bound ones) is deliberate: the value of
  this lens is seeing which tribes are bare, which is invisible if unbound cards are hidden. The search box
  is what makes a list that long usable.

### Known limitation, stated up front

The By-card lens is complete only for cards with an **explicit override**. Determining which moment kinds an
arbitrary card can produce is a static analysis of its effect data that will not be exact — many moments
exist only at runtime. So By card honestly answers *"which cards have bespoke effects, and which tribes are
bare"*, and does **not** claim to list every effect a card will ever show. An exhaustive version would have
to come from observing a real combat, and is not in this design.

## Failure modes

- **A binding naming a def that does not exist** renders as *"bound to `x` — missing"*. This is the
  improvement that matters most: today that state is a silent no-op (`playDef` returns null and nothing
  plays), indistinguishable from a binding that was never wired.
- **A `CARD_FX` entry naming an unknown card** is flagged the same way.
- **A def with no `palette` anywhere** buckets to `neutral`. Never throws.
- **No render context for the preview stage** — the overlay still browses and the preview panel says so.
  Browsing must never depend on rendering.
- **An unparseable def** is already dropped with a warning by `fxDefs.ts`; the catalog shows what the
  registry gives it and does not re-implement validation.

## Testing

All logic lives in pure functions; the component stays thin. This matches how `Inspector` and `Timeline` are
handled — neither has a component test.

- **Table tests** for hue bucketing (palette numbers → expected bucket, explicitly including the white-stop
  case that makes stop 4 useless), shape labelling, motion, and the binding roll-up.
- **Guard: every registered def appears exactly once in the catalog.**
- **Guard: every binding resolves to a def that exists.** This is the one that would have saved real time
  during the Bloodbinder work.
- Filtering and grouping are pure helpers over the catalog array, tested directly.

## Out of scope (all of it lands in phase C)

- Writing or removing bindings from the UI.
- "Fork this effect for this card only."
- Stored thumbnails or captured GIFs.
- Editing a def from the overlay beyond load / duplicate.
- Runtime observation of what a card actually fired.

Phase A is **read-only by design**, which is what makes it unable to break combat.

## Why A before C

C — moving the binding tables from TypeScript into JSON the dev plugin can write — is the full vision the
owner described: click a card, modify its effect globally or fork it for that card alone. A is not
throwaway work toward it: **A's catalog is exactly the input C needs.** A also makes C's UI obvious rather
than guessed — after using the lenses it will be clear whether "fork for this card" belongs on the card lens
or on the effect row.
