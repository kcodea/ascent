# Shop-phase performance — the plan

**Status 2026-08-17:** scoped, not started. Derived from Codex's three-item audit, **corrected against the
code** (its item 1 is largely already built) and re-ordered accordingly.

Goal: make buying feel immediate, especially several purchases in quick succession, without changing game
rules, card behaviour, authored FX, or how a purchase looks.

---

## What the measurements actually say

Two independent traces agree on the shape:

| Source | `render:recruit` | `layout:flip` | reducers |
|---|---:|---:|---:|
| Owner trace, 30s @ 240Hz (prod-ish) | 330.2ms total, max **13.2ms** | 313.0ms total, max 12.8ms | ~1ms |
| Codex rapid-buy profile (dev Scene Builder) | **17.5ms** | 4.9ms | 0.2ms (3 buys) |

Both put React rendering + layout at **~94% of measured time**, and both put the simulator and the `buy`
reducer at effectively zero. The bottleneck is presentation, not simulation.

The 240Hz budget is **4.17ms**. A single 13.2ms recruit render burns three whole frames — so this is not death
by a thousand cuts, it is a handful of very expensive spikes on action.

**Idle costs nothing.** Every bucket in the owner trace with zero recruit renders sits at a clean 240fps with
0 long frames. The cost is entirely per-ACTION.

> ⚠ **Get a PROD trace before starting.** Codex's numbers come from dev Scene Builder. StrictMode alone
> double-invokes renders, which would inflate its "~32 Recruit renders" substantially, and CLAUDE.md requires
> confirming slow reports against the prod build. The ratio between items A and B below could move materially.

---

## Correction: Codex's item 1 is largely already implemented

Codex describes a purchase as running the full generic pipeline (measure → dispatch → render → measure again →
force layout → animate) and proposes a dedicated purchase transition that commits the drag-preview positions
instead.

**That path already exists, and buy already takes it.** In `Recruit.tsx`:

```ts
if (acted && (handMinionDrop || boardReorderDrop || shopReorderDrop || sellDrop || buyDrop))
  handPlaySnapRef.current = true;
```

…which selects a MANUAL flip over `Flip.from`, excludes the dragged/bought card from the captured rects, and
glides only the neighbours. Its own comment notes "on a sell/buy the survivors already sat re-centred, so they
barely move."

There is also a drag-time optimisation the audit does not mention: during a drag only ONE row is captured
(warband *or* tavern, never both), added after a 2026-08-06 capture where `layout:flip` was 90% of all work.

**What genuinely remains** from that item is much narrower: the manual path still does a `gsap.set` plus a
**forced reflow** (`void document.body.offsetWidth`) and per-element rect reads on every commit. Real, but a
footnote rather than the headline.

---

## The plan, re-ordered

### A. Isolate drag + purchase rendering (was Codex #2) — DO FIRST

The dominant cost. React rendering is ~3.5× the layout cost in Codex's own profile.

Drag state is owned high in `Recruit`, so a meaningful drag change re-renders a large part of the screen:
active card, zone, hand insert, shop gap, board gap, cast target, magnetize target, sell target, drop
validity, overlay position.

**Staged, one PR per stage, profile between each:**

1. Extract pointer position + the drag overlay only. Pointer-following becomes an imperative transform;
   React state commits only when a DECISION changes, not per pointer move.
2. Give shop / hand / board their own render boundaries so a gap change re-renders one row.
3. Move decision state behind narrower boundaries — only after 1 and 2 are verified.

**Non-negotiable:** the existing drop-legality logic stays the source of truth. It moves behind narrower
update boundaries; it is not rewritten. Gap, cast, magnetize, sell and board-target calculations must stay
synchronised, and gameplay dispatch timing must not change.

Test every drag route and every failed-drop case, mouse and touch separately, and confirm target highlights
clear immediately.

### B. Incremental card-view caching (was Codex #3)

The reducer's clone gives cards new object identities, so Recruit rebuilds display data for cards that did not
visibly change. This is what makes cost scale with board complexity late in a run.

Cache each card's view behind a **value signature** covering everything that can change appearance or
interaction: definition + instance id, attack/health, tier, cost, gilded, live text and scaling values,
keywords and temporary statuses, attachments, tribe changes, targetability, disabled/affordability, and
combat-only modifiers.

**Biggest stale-display risk in the plan.** Centralise signature construction — never hand-maintain partial
signatures per component — and add a dev-mode comparison of cached vs freshly built output that reports
mismatches. Version the cache on content-set change.

Note this interacts with a known smell already on record: `shopViews` rebuilds every offer view when ANY of
its ~30 deps changes. A signature cache is the principled fix for that, not another dep-array tweak.

### C. The remainder of the purchase transition (was Codex #1)

Only what is actually left: the forced reflow and per-element rect reads in the manual-FLIP commit. Where
possible, capture shop + hand geometry in ONE read phase and do all writes after.

Keep the general FLIP path for refreshes, generated cards, shop replacements, scripted purchases, and any
purchase with no valid drag preview — and detect that case explicitly rather than assuming a preview exists.

---

## Benchmark (run identically before and after each stage)

Buy one card · buy three rapidly · buy six rapidly · repeat on a full late-game board · repeat on
attachment-heavy and trigger-heavy boards.

Record: worst frame, p95 frame time, recruit renders, layout time, reducer time.

**The target is the same interaction with redundant work removed** — not a visually reduced purchase. Authored
FX timings are out of scope; this is the surrounding React and layout pipeline only.
