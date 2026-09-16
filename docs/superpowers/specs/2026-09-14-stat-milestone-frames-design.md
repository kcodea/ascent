# Stat Milestone Frames & Celebrations — Design

**Date:** 2026-09-14
**Owner ask (Mike):** Make the Health/Attack badges more exciting. Keep the value roll-up/down and
badge motion exactly as-is — those are loved. Add: (1) **frames** the badges sit in that do *not* move
with the numbers, and (2) **milestones** where a Pixi effect fires when a stat reaches certain values,
after which the frame changes. Requested for the **shop phase** first, but **built with the combat phase
in mind** — the shop-only gate may be lifted later.

## 1. Summary

Each stat badge gains a **tiered frame** whose look is a pure function of the badge's current value, and a
**per-tier celebration FX** that fires when the value crosses a threshold upward. Tiers are fixed value
thresholds. The frame reflects the current value **everywhere** (shop, hand, combat) and moves both up and
down with the value. The celebration FX is **phase-gated to the shop today**, but the detector and firing
path are **phase-agnostic** so enabling combat later is a config flag plus wiring one combat signal — not a
rewrite.

The feature is deliberately **stateless**: no per-unit milestone memory is stored. The frame is
`tierOf(currentValue)` every render; the FX is "did `tierOf` increase since last render." This is what makes
shop and combat behave identically for free.

## 2. Decisions (locked with owner)

| Question | Decision |
|---|---|
| What defines a milestone | **Fixed value tiers** (absolute thresholds on the shown stat). |
| Tier count / thresholds | **5 tiers:** `50 / 100 / 500 / 1000 / 5000`, same for Attack and Health to start. Structure is **per-stat** so HP can diverge later with a one-line edit. |
| Where the frame shows | **Everywhere** — shop, hand, and combat. The frame is value-derived. |
| Where the FX fires | **Shop only** today, via a one-line phase gate. Mechanism is phase-agnostic; combat later = flip the gate + feed a combat stat-delta signal. |
| Down-crossing behaviour | **Frame follows the value both ways.** If a stat drops below a tier and later climbs back over, the FX **re-fires**. (Shop values almost only climb, so re-fire wobble is a non-issue there; add a debounce only when combat is enabled.) |
| FX distinctness | **Distinct authored def per tier** (spark at tier 1 → eruption at tier 5). Attack vs Health share the def but the cue passes a **tint** param (hot vs green). |
| Frame pipeline | **CSS-authored tiers now**, structured so a per-tier PNG plate can drop in later with no structural change. |

### First tuning knob (flagged for owner)

At `50/100/500/1000/5000`, **most units in a normal shop will not cross even tier 1**, so the base frame is
the common case and any lit frame reads as a genuine standout (rare = exciting). This is intended per the
owner's numbers. If the *first* tier should instead fire often (a buffed token popping tier 1 quickly), the
attack tier-1 threshold wants to sit far lower (~15–20). This is a one-array edit in `MILESTONE_TIERS`.

## 3. Architecture

All presentation — lives entirely in `packages/ui/**` (Mike's ownership seam). **No** `packages/core`,
`packages/sim`, reducer, `state.ts`, or `types.ts` changes: the milestone moment is UI-derived by design,
following the `recruitMoments.ts` precedent of deriving cues from signals the UI already has rather than
adding emission to the hot conflict files.

### 3.1 Tier model — `packages/ui/src/choreo/statMilestones.ts` (new)

Pure, React-free, headlessly unit-testable (like `channels/rallyFired.ts`). The single source of truth for
thresholds; both the frame class and the FX derive from it.

```ts
export type StatKind = 'attack' | 'health';

// Tunable in ONE place. Per-stat so HP can run higher than Atk later.
export const MILESTONE_TIERS: Record<StatKind, number[]> = {
  attack: [50, 100, 500, 1000, 5000],
  health: [50, 100, 500, 1000, 5000],
};

/** Tier of a value: 0 = below the first threshold, up to MILESTONE_TIERS[stat].length. Pure. */
export function tierOf(stat: StatKind, value: number): number;

/** If next is in a strictly higher tier than prev, return the tier reached; else null.
 *  A multi-tier jump (e.g. 40 → 1200) returns the HIGHEST tier reached (fires once). */
export function crossedUp(stat: StatKind, prev: number, next: number): number | null;
```

**Multi-jump rule:** a single buff that vaults two tiers fires **once, at the highest tier reached** (not a
cascade of intermediate bursts). Chosen for restraint; trivially changeable to a cascade later if wanted.

### 3.2 Detection + firing — `useStatMilestones` hook (new, shared)

`useStatMilestones(uid, attack, health, { phase, enabled })`:

- Holds `prevTier` per stat in a ref, **seeded from the first observed value on mount** so a card that
  appears already above a threshold does **not** falsely celebrate when the shop first paints or a run
  rehydrates.
- Each render, compares `tierOf(prev)` → `tierOf(next)` per stat. On an up-cross it emits a **`statMilestone`
  moment** `{ uid, stat, tier }` into the existing cue runner (the same pipeline recruit/combat cues use).
- **The shop gate is one line:** the cue only plays when `phase === 'shop'` today. Combat later = pass
  `phase: 'combat'` from `Unit.tsx` and widen that check.

Used by **`Card.tsx`** now (it already has `uid`, `card.attack`, `card.health`, and a `prevStats` ref for the
roll). Used by **`Unit.tsx`** when combat is enabled — same hook, no new detector.

### 3.3 Binding — `bindings.json` + cue

Distinct-per-tier defs are **workbench-rebindable** rows, keyed per tier:
`statMilestone.1 … statMilestone.5`, each → its own authored def. The cue reads `tier` off the moment and
selects the row; it passes a `tint` param derived from `stat` (Attack = hot red/orange, Health = green) so
the two stats share one def per tier. The def **anchors on the `.badge.atk` / `.badge.hp` element** — the
existing three-node badge structure (`.badge` wrapper / `.plate` shape / `.value` digit) gives a clean,
stable anchor.

New `RecruitMomentKind` (or the shared moment kind vocabulary) gains `statMilestone`. Adding the kind will
touch the golden fixtures noted in §5.

### 3.4 The frame — `styles.css`, new `MILESTONE FRAMES` block

- `Card.tsx` (and later `Unit.tsx`) sets a derived attribute on the badge wrapper:
  `data-tier={tierOf(stat, shownValue)}` — computed from the **same** `shownAttack` / `shownHealth` the badge
  already displays, so the frame never disagrees with the printed number (respects floor/debuff/`formatStat`).
- CSS drives per-tier **rim color, metal gradient, and an ornament via `::before`**, richer per tier
  (bronze → mythic), following the existing `AUTHORED FRAMES` convention.
- **Perf-safe by construction:** all per-tier styling is **static paint** — no looping animation of
  `box-shadow` / `filter` / `background` (the north-star rule; cf. `kwglow`). The only badge motion remains
  the existing one-shot pop (`useBadgePop`) and value roll — untouched.
- **Art-swappable:** the `.plate` stays a single element; a later per-tier PNG points its background at
  `--plate-img-<tier>` with zero structural change.
- **No cursor regression:** no bare `cursor:` keyword added to any interactive element (per the UI-conventions
  rule in CLAUDE.md).

## 4. Data flow

```
value changes (buff in shop / damage or buff in combat)
        │
        ▼
Card.tsx (shop/hand)  ──►  useStatMilestones(uid, atk, hp, {phase:'shop'})
Unit.tsx (combat, later) ─►  useStatMilestones(uid, atk, hp, {phase:'combat'})
        │
        ├─► data-tier = tierOf(shownValue)  ──►  CSS frame (ALWAYS, both phases)
        │
        └─► crossedUp(prev, next)?  ──►  emit statMilestone{uid,stat,tier}
                                              │
                                     cue runner + bindings.json
                                       (phase gate: shop only today)
                                              │
                                     authored def per tier, anchored on .badge, tinted by stat
```

## 5. Testing & verification

- **Headless unit tests** on `statMilestones.ts`: `tierOf` boundary values (49/50/51 … 4999/5000/5001),
  `crossedUp` up / down / multi-jump / no-cross, and the seed-no-fire-on-mount behaviour.
- **Golden fixtures:** adding the `statMilestone` kind updates `bindings.test` / `catalog.test` /
  `score.test` golden refs (memory: these break when a moment kind is added — expected, update in same PR).
- **Frame render:** verify `data-tier` maps to the right CSS in a focused real browser (per the FX-verify
  convention — the headless preview is unreliable for visuals); confirm frame rises AND falls with value.
- **FX:** author the 5 tier defs in the workbench; confirm the shop celebration fires on an up-cross, does
  **not** fire on spawn, and does **not** fire in combat (gate on). Commit each def's PNG in the same commit
  as the def if any custom-image layer is used (memory: def-without-PNG ships blank).
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green.
- **Patch notes:** prepend a spoiler-light entry to `patchNotes.ts` (player-facing UI/information change).

## 6. Scope / non-goals

- No sim, reducer, `types.ts`, or balance changes.
- Combat FX firing is **not** built now — only made reachable (phase-agnostic hook + gate). When enabled,
  the combat stat-delta signal needs care because combat stat changes fold into `attackExchange`/`buffWave`
  moments (known buff-FX coverage gap) — noted for the follow-up, out of scope here.
- No per-tier PNG art now (CSS tiers; art-swap structured for later).
- Final tier numbers and per-tier frame/FX aesthetics are tuned in play after the first build.

## 7. Files

- `packages/ui/src/choreo/statMilestones.ts` — new pure module.
- `packages/ui/src/choreo/statMilestones.test.ts` — new headless tests.
- `packages/ui/src/choreo/useStatMilestones.ts` (or colocated hook) — new shared hook.
- `packages/ui/src/choreo/recruitMoments.ts` + cue + `bindings.json` — add `statMilestone` kind + per-tier rows.
- `packages/ui/src/Card.tsx` — call the hook; set `data-tier` on both badges.
- `packages/ui/src/styles.css` — new `MILESTONE FRAMES` block.
- `packages/ui/src/patchNotes.ts` — player-facing entry.
- (Later, not this PR) `packages/ui/src/Unit.tsx` — same hook with `phase:'combat'`.
