# 2026-09-13 — Filter Lab: filters compose in an authored order (top → bottom)

**Owner ask.** With several filters on one layer there was no way to know — or choose — whether the Outline was
applied to the image and the Glow to the outlined result, or the reverse. `FilterStack` composed enabled
filters in fixed registry order, and the Filters panel gave no hint. This applies to every Pixi primitive
(they all share `FilterStack`), not just `custom`.

**What shipped.**
- A new `order` param kind (`params.ts`, alongside `emitpoints`/`gradient`): a list of ids that saves with the
  def, round-trips through `coerceParams` (strings, de-duplicated, capped), deep-compares in `paramIsChanged`,
  and is hidden from `visibleParamKeys` — it is never a row of its own.
- `filterLabSpecs` now emits one `filterOrder` param per primitive. `resolveFilterOrder` turns a stored order
  into the COMPLETE application order: stored ids first (unknown ones ignored), the rest in registry order —
  so `[]` (every existing def) is exactly the old behaviour, and a saved order survives new filters being added
  to the registry. `FilterStack.frame` composes enabled filters in that order; resolved lazily and cached by
  the order's joined signature, since an array param is a fresh copy every coerce.
- The Filters master group renders enabled rows in that order, numbered, with a one-line "Applied top →
  bottom" hint and ▲/▼ per enabled row (`moveFilter` swaps neighbours of the same on-state and stores the full
  rendered list, so what you see is what composes). Pixi applies `container.filters[0]` first, so the top row
  processes the raw layer and each next row processes that result.

**Deliberately not done.** The always-on core Blur stays first and is not orderable; making it a movable row in
the Filters master is a small follow-up if "blur the glow" turns out to be wanted.
