# FX anchor parts — "a target within a source"

A workbench layer anchored to `source` / `target` / `travel` can now land on a **part** of that unit's card
instead of its centre. New per-layer `anchorPart` (Inspector → Anchor → **Part**), defaulting to `card` (the
centre, exactly what every existing def means). The owner's ask: *"if the anchor is 'source', can we further
say the **medallion** is the source's location?"* — so an effect can rise out of the tribe plate, a stat badge,
the tier plaque, or a card edge.

## Parts

`FxAnchorPart` (in `def.ts`): `card` · `badge.attack` · `badge.health` · `medallion` · `tier` · `top` ·
`bottom` · `left` · `right`.

- **Selector parts** name real card markup and reuse `Card.tsx`'s classes (the same `.badge.atk` / `.badge.hp`
  the `react` primitive already targets): `medallion` → `.plate-tribe` (the round tribe plate — the owner's
  word for it, confirmed 2026-09-13), `tier` → `.tierbadge:not(.tierglow)` (skips the tier-7 glow halo).
- **Edge parts** (`top`/`bottom`/`left`/`right`) are pure geometry off the card rect — no query.
- A card that lacks a part (a spell has no badges) falls back to the card centre, so a def is never thrown
  off-screen.

## How it resolves (once per fire, never per frame)

- `anchorParts.ts` is the new home: pure maths (`partPointFromRects`, `partsUsedByLayers`), one DOM read per
  unit (`readUnitPartPoints` — one card rect + one `querySelector`+rect **per selector part actually used**),
  and the glue (`withUnitParts` / `partsFromElements`).
- `playDef` samples anchors once at fire time, then decorates them with `withUnitParts(...)` for exactly the
  parts the def's layers ask for, off the moment's `opts.uids` (via the shared `unitSelector`). A def with no
  parts costs nothing extra.
- `anchors.ts`: `FxAnchors` gains an optional `parts` layer; `resolveAnchor(..., part)` and `driveLayerHeads`
  read it. A `travel` layer with a part runs **part-to-part** (a beam from the caster's medallion to the
  victim's badge).
- Workbench previews resolve parts too: `realBoard` (`readBoardAnchors`) and `stageSetter` (`readStageAnchors`)
  both thread `partsUsedByLayers(...)` through; `StageCard` gained inert `.plate-tribe` / `.tierbadge` decoys
  so a part-anchored layer previews about where it lands on a real card.

## Serialisation

`anchorPart` rides the same omit-unless-set discipline as `muted`/`travelMs`: `card` (the default) is never
written, so a pre-parts session/def round-trips byte-for-byte. `coerceLayer`/`toEditorLayer`/`toStoredLayers`
drop `card` and junk; `setLayerAnchorPart`/`toDef` serialise only real parts.

No player-facing change (the shipping defs use no parts yet) — this is a dev-workbench authoring capability, so
no patch note.
