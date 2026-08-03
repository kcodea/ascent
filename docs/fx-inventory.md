# FX inventory — every system that puts motion on screen

Owner ask 2026-08-02: *"I want to make sure all of our old effects systems are 1. brought into the FX
workshop and 2. aligned under the EXACT same rules."*

This is the map that makes that a **list** rather than a discovery each time. Twice now a "shared" primitive
has been built without knowing a better one already existed — most recently `scheduleLands`, whose first cut
was less capable than the buff-tendril scheduler nobody had read.

Three questions per system, because they are independent and each one is a different kind of work:

- **Renders with** — Pixi, DOM/CSS, GSAP, WAAPI. Determines whether it *can* become a def layer.
- **Authorable** — can the owner change how it looks without a code edit?
- **Schedules itself** — does it own its own timing, or use `fx/land.ts`?

> Counts are from 2026-08-02 and will drift. The COLUMNS are the durable part; re-run the greps in
> "Keeping this honest" below rather than trusting the numbers.

---

## The systems

| # | System | Renders with | Authorable | Schedules itself | Notes |
|---|---|---|---|---|---|
| 1 | **Authored defs** (`fx/defs/*.json`, 27) | Pixi | ✅ workbench | uses `fx/land.ts` at its two Ruby call sites | The target state. Five primitives: burst, emitter, ribbon, shockwave, smoke. |
| 2 | **Legacy `pixiFx` methods** (~25 effect methods) | Pixi | ❌ code only | each method's own internals | The biggest block. Some have been migrated to defs; the rest have not. |
| 3 | **Buff tendrils / waves** (`buffFxConfig` + `replayBuffFxEvents`) | Pixi (ribbons) | ❌ code + a tuner panel | **now `fx/land.ts`** | Aligned 2026-08-02. Coalescing stays local — see below. |
| 4 | **Floats** (`choreo/channels/float.ts`) | DOM, portalled to `<body>` | ❌ code | own timing | The damage/buff numbers. Named in the vocabulary as part of a `land`, not yet driven by one. |
| 5 | **Card CSS animations** (~113 `@keyframes`) | CSS | ❌ code | CSS timing | Ward/Reborn domes, buff pops, quest bounce, glow. The `card` layer design pass would make some authorable. |
| 6 | **Layout motion** (GSAP Flip, 8 files) | GSAP → transforms | ❌ code | GSAP timelines | Board reorder, drag, lunge. Structural rather than decorative. |
| 7 | **WAAPI one-shots** (7 files) | Web Animations | ❌ code | own timing | The route the CSS `card` layer would take. |
| 8 | **SFX** (`sfx.ts` + `audio/`) | Web Audio | ⚠️ levels only, via the mixing desk | per-call throttles | Levels/buses authorable; *when* a sound fires is code. |

---

## What "aligned" means, per column

**Renders with** is the hard constraint. A Pixi effect can become a def layer today. A CSS/DOM one needs the
`card` layer primitive first (see `fx-workbench-friction.md`). GSAP layout motion probably should NOT move —
it is structural, not decorative, and the FLIP baseline capture is load-bearing.

**Authorable** is the workshop goal. Today: 27 of the systems' effects are; everything else needs a code edit
plus a PR plus a review, which is the loop the workshop exists to remove.

**Schedules itself** is the alignment goal, and the cheapest of the three. Moving a system onto `fx/land.ts`
does not change how it looks — it changes whether "spread these out" means the same thing everywhere. Two of
eight are on it.

---

## Deliberate exceptions — do not "align" these

- **Coalescing** (`coalesceBuffFxByTarget`) stays out of the schedule. WHICH events deserve a land is a
  question about the events' meaning — one tendril per target because a target's stats jump once — and it
  needs to know what a `targetUid` is. The schedule is better off not knowing.
- **GSAP Flip layout motion** is not an effect. It moves cards to where they belong; an effect decorates.
  Folding it in would put the board's structural motion behind an authoring tool, which is a liability.
- **`death-dissolve`'s direct call.** It cannot be a binding: a moment kind is derived from the event alone
  and cannot see whether the dying card has an `onDeath` effect, so the call sits in the `else` of the skull's
  gate. That mutual exclusion is what stops both firing for one unit. (Audited + kept 2026-07-29.)

---

## The order that avoids re-discovery

1. **Finish the alignment column first** — it is small, behaviour-neutral, and each step reveals whether a
   system has capability the others lack. That is how the tendril scheduler was found, and it was found by
   asking rather than by assuming.
2. **Then the `card` layer**, which converts rows 5 and 7 from "unauthorable" to "a def layer".
3. **Then migrate the remaining `pixiFx` methods** — the largest block, and the one where a per-effect
   judgement ("is this worth authoring?") matters more than a sweep.

**Rule going forward:** before building a shared primitive, read every existing implementation of the thing
it replaces. Twice now the newer one was the weaker.

---

## Keeping this honest

```
ls packages/ui/src/fx/defs/*.json | wc -l            # authored defs
grep -c "@keyframes" packages/ui/src/styles.css      # CSS animations
grep -rln "gsap\." packages/ui/src | wc -l           # GSAP call sites
grep -rln "\.animate(" packages/ui/src | wc -l       # WAAPI call sites
grep -rln "scheduleLands" packages/ui/src | wc -l    # systems on the shared schedule
```

The last one is the alignment score. It was 0 this morning and is 3 now.
