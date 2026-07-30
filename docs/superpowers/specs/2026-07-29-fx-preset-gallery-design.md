# The preset gallery — design

**Date:** 2026-07-29
**Status:** approved (owner, 2026-07-29)
**Follows:** the three-phase live-authoring arc — ① bindings as data (2026-07-27), ② the proc harness
(2026-07-28), ③ the authoring panel (2026-07-29).

## The problem

The authoring loop closes, but it has no on-ramp.

Phases ①–③ made it possible to tune an effect against a real card and commit it with one button. What they
did not touch is the step *before* all of that: turning an idea into a composition. Today the honest advice —
written into [`fx-workbench-guide.md`](../../fx-workbench-guide.md) §2 — is **don't author from scratch,
duplicate something close**. That advice is correct, and it is also an admission. If the effect in your head
isn't already roughly present in the 21 shipped defs, you are looking at five primitives and dozens of
parameters (`burst` alone has ~25) with nothing connecting "a crackling chain of lightning" to which knobs
produce it.

Scored against the owner's own goal — *think it up → build it → test on a live subject → apply it* — steps 3
and 4 are good and step 1 is unsupported. This spec is step 1.

**Three findings from the codebase shaped this design:**

- **Only `kind: 'slider'` params carry `min`/`max`/`step`** (`params.ts`). Toggles, enums, colours, palettes,
  curves and shapes have no numeric range. So a variant expressed as a multiplier is well-defined on sliders
  and *meaningless* everywhere else — which turns a fuzzy idea into a rule with a testable boundary.
- **Param names are shared across primitives.** `size`, `speed`, `life`, `count`, `turbulence` recur, so one
  name-keyed transform can act on a composition without knowing which primitives it contains.
- **The library browser already previews on hover** (`LibraryBrowser.tsx` / `catalog.ts`). The gallery needs a
  preview surface and one already exists; building a second would be the wrong kind of new code.

## Decisions

| Question | Chosen | Rejected, and why |
|---|---|---|
| What you land on | **A finished, tuned composition** per archetype × variant | A skeleton — still a blank-ish page, doesn't answer "what makes it look good". Composable parts — needs an assembly layer and yields combinations that don't read |
| How ~40 presets get authored | **~10 hand-authored bases × 4 shared variant axes**, with per-base overrides | Authoring 40 by hand — every rejected batch is fully wasted, and this is precisely where three trail builds were rejected before. Auto-derived from the 21 existing defs — coverage is lumpy and accidental |
| What a variant *is* | **A param-name → multiplier table, sliders only, clamped and step-snapped** | Absolute values — an axis would have to know each base's scale. Free-form per-base overrides only — that is just 40 hand-authored defs again |
| Where it lives | **A `＋ New effect` button** beside `Browse all` | The default landing screen — changes what opening the workbench does for every existing habit. A fourth lens in `Browse all` — mixes "start something new" with "inspect what's bound", two different jobs |
| Bases in the library | **Filtered out of `Browse all`** | Showing them — pads the library with 10 permanent "nothing bound" rows, degrading the coverage map that lens exists to provide |

## Architecture

```
＋ New effect
   ↓
10 archetype cards  (icon · name · blurb · hover-preview)
   ↓  click
4 variant thumbnails for that archetype
   ↓  click
applyVariant(baseDef, axis) → an UNSAVED composition in the editor, pre-named `bolt-heavy`
   ↓
the existing loop: tune → Watch in combat → Commit animation
```

Nothing here writes to disk. The gallery hands the editor a starting composition and then gets out of the
way; every downstream step is the loop that already exists.

### The preset table

`packages/ui/src/fx/presets/presets.json`

```jsonc
{
  "version": 1,
  "archetypes": [
    {
      "id": "bolt",
      "label": "Bolt",
      "icon": "⚡",
      "blurb": "travels fast and lands hard",
      "base": "preset-bolt",
      "variants": ["thin", "heavy", "crackling", "beam"],
      // optional: pin ABSOLUTE values where a shared rule reads badly on this base.
      // Same key space as a transform — slider param names — but replacing, not multiplying.
      "overrides": { "beam": { "turbulence": 0, "speed": 900 } }
    }
  ],
  "variantAxes": [
    { "id": "thin", "label": "Thin", "transform": { "size": 0.6, "speed": 1.3 } },
    { "id": "heavy", "label": "Heavy", "transform": { "size": 1.6, "speed": 0.7, "life": 1.2 } }
  ]
}
```

The 10 bases are **ordinary defs** under a `preset-` id prefix. They are real files, previewable and editable
in the workbench like anything else — they are simply excluded from `Browse all`, because they are bound to
nothing by design and would otherwise dominate that lens's "nothing bound" column.

### `applyVariant` — pure, and the whole risk surface

```ts
export interface VariantResult {
  def: FxDef;
  /** Param keys the transform actually changed, as `<layerIndex>.<param>`. */
  applied: string[];
  /** Transform keys that matched no slider param on any layer — an authoring error. */
  missed: string[];
}

export function applyVariant(base: FxDef, axis: VariantAxis, override?: VariantOverride): VariantResult;
```

Three rules, each of which exists because its absence is a silent failure:

- **Sliders only.** A transform key that names a non-slider param (a toggle, enum, colour, palette, curve or
  shape) cannot be multiplied. It is reported in `missed`, never partially applied.
- **Clamped to the spec, then snapped to `step`.** Multiplying blind produces out-of-range values that fail
  validation at Save time — a failure that surfaces long after the cause, in a different screen.
- **Misses are loud.** A transform naming a param no layer has is a no-op that looks exactly like "the variant
  did nothing". `missed` is returned rather than swallowed, and a test asserts every declared axis key resolves
  to a slider param on at least one base.

An override uses the **same key space** as a transform — slider param names — but supplies an **absolute
value** rather than a multiplier:

```ts
/** Slider param name → absolute value. Applied after the transform; clamped and snapped identically. */
export type VariantOverride = Record<string, number>;
```

Overrides are applied **after** the transform and win outright, so a base can pin a value the rule would
otherwise mangle. A base drops a variant entirely by omitting it from its `variants` list — there is no
"disable" flag, because an absent entry already means exactly that and two ways to say it would drift.

## Units

| File | Responsibility |
|---|---|
| `fx/presets/presets.json` | The table. Data, hand-edited, zod-validated at load |
| `fx/presets/presetTable.ts` | Parse + validate. Rejects an archetype naming a missing base, or a variant naming a missing axis |
| `fx/presets/applyVariant.ts` | Pure. The transform, the clamp, the override merge, the diagnostics |
| `fx/presets/index.ts` | Public surface for the UI |
| `fx/ui/PresetGallery.tsx` | The overlay: archetype grid → variant row → hand off to the editor |
| `fx/ui/Workbench.tsx` | The `＋ New effect` button and the load-into-editor seam |
| `fx/ui/catalog.ts` | One change: exclude `preset-` ids from `Browse all` |
| `fx/defs/preset-*.json` | The 10 bases. Content, landing incrementally |

## Delivery order — the part that protects the owner's time

**The shell ships against two bases, not ten.** The gallery mechanics, `applyVariant`, the table, the tests
and the button are one unit of work provable end to end with `preset-bolt` and `preset-blast` alone. The
remaining eight bases land afterwards, incrementally.

This is deliberate, and it is the lesson from the three rejected trail builds: a base the owner rejects must
cost **one def**, not the feature. Separating the shell from the content is what makes that true.

For review, the bases are judged on **one screen, fired side by side at real card scale** — not in ten
separate rounds. Judging a bolt against a blast next to each other is also the only way to catch the failure
mode that matters here, which is not "this one looks wrong" but "these all feel the same".

## Testing

`applyVariant` and `presetTable` get real unit tests — they are pure, and they carry every decision:

- a multiplier hits every layer with that slider param, and no layer without it
- a value that would exceed `max` clamps, and one below `min` clamps
- results snap to the param's `step`
- a transform key naming a toggle/enum/colour lands in `missed`, and the param is untouched
- an override beats the transform for the same key
- **coverage:** every key of every declared axis resolves to a slider param on at least one shipped base
- **integrity:** every archetype's `base` names a def that exists; every entry of `variants` names a declared axis

`PresetGallery.tsx` gets none. This repo has no jsdom and no `@testing-library/react`, so React components
cannot be tested here — the same constraint that kept `CommitPanel` thin. The gallery stays a renderer of
data computed elsewhere.

The end-to-end path (pick → land in editor → Save → bind) is verified in the browser, once, on the two-base
shell.

## Scope

**In:** the preset table + schema, `applyVariant`, the gallery overlay, the `＋ New effect` button, the
`Browse all` exclusion, the tests above, and **two** bases with their four variant axes.

**Out:** the remaining eight bases (they follow, incrementally, and each is content not code). Editing preset
metadata from the UI. Any change to what an effect *is* (①), how a fight is staged (②), or how a commit is
written (③). The separate friction batch — rail-mode transport, the commit-success toast, `fanOut` wording,
seed auto-unlock — is queued next and deliberately not folded in here.
