# FX workbench: per-end anchor parts for a travel layer (From → To)

Owner ask (2026-09-18): a `travel` primitive (leaves the source, crosses to the target) could only pin BOTH
ends to the *same* anchor part — there was no way to say "from the **source's medallion** to the **target's
centre**."

## What changed
A layer now carries an optional **`anchorPartTo`** — the TARGET (to) end's part. `anchorPart` becomes the
SOURCE (from) end for a travel layer; `anchorPartTo` is the TO end. **Absent `anchorPartTo` falls back to
`anchorPart`**, so both ends share one part exactly as before — every existing def is byte-identical and
untouched.

- **Engine** (`anchors.ts`): `resolveAnchor` gains a `toPart` param (defaults to `part`); the travel target
  end resolves against it. `driveLayerHeads` reads `layer.anchorPartTo ?? layer.anchorPart` for the target end
  (both the head and the source→target aim vector).
- **Parts collection** (`anchorParts.ts`): `partsUsedByLayers` now gathers BOTH ends so a fire resolves each.
- **Inspector** (`Workbench.tsx`): a travel layer shows TWO part pickers — **"From part"** and **"To part"**;
  a source/target layer keeps the single **"Part"**.
- **Persistence**: `anchorPartTo` round-trips through the def store (`coerceDef`/`toStoredDef`), the session
  state (`toEditorLayer`/`toStoredLayers`) and `toDef` — kept ONLY on a travel layer with a real non-`card`
  value, otherwise omitted.

Non-travel layers ignore `anchorPartTo` (it's dropped on save). `card` on either end means the centre / the
fallback, unchanged.

Dev-authoring tool → no patch note.

Files: `packages/ui/src/fx/anchors.ts`, `anchorParts.ts`, `def.ts`, `defStore.ts`,
`packages/ui/src/fx/ui/{Workbench,layerModel,sessionState}.tsx?` (+ `anchorPartsWiring.test.ts`,
`anchorParts.test.ts`).
