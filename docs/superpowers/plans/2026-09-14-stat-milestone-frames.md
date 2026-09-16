# Stat Milestone Frames & Celebrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Attack/Health badges tiered CSS frames driven by their current value, and fire a distinct authored Pixi celebration when a stat crosses a fixed value tier upward (shop phase today, phase-agnostic mechanism).

**Architecture:** A pure tier module (`tierOf`/`crossedUp`) is the single source of truth. `Card.tsx` sets a `data-milestone` attribute on each badge (pure function of the current value → CSS frame, shown in every phase) and, inside its existing stat `useLayoutEffect`, detects an upward tier crossing and fires a per-tier authored def anchored at the badge's screen point. The FX is a new binding *family* (`statMilestone1…5`), sibling to `HudBindingKind`, fired directly from the badge DOM like `runeTriggered` — workbench-rebindable per tier. No sim/reducer/types changes.

**Tech Stack:** TypeScript, React (function components + refs + `useLayoutEffect`), the repo's FX binding table (`bindings.ts`/`bindings.json`) + `playDef`, CSS (`styles.css`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-stat-milestone-frames-design.md` (read it — this plan refines §3.3: milestone kinds are their own binding family fired directly from the badge DOM, not a `RecruitMoment`; anchoring is badge-precise via a captured point; the atk/hp tint param is dropped because `playDef` has no param channel and the plate colour already distinguishes the stat).

## Global Constraints

- **Presentation only — `packages/ui/**` exclusively.** No `packages/core`, `packages/sim`, `reducer.ts`, `state.ts`, or `types.ts` edits (Mike's ownership seam; the milestone signal is UI-derived by design).
- **Tier thresholds (owner-set, do not alter):** Attack `[50, 100, 500, 1000, 5000]`, Health `[50, 100, 500, 1000, 5000]`. Structure is per-stat so they can diverge later.
- **Naming:** use `data-milestone` / `--ms-N`, NEVER `data-tier` / `--tier-N` — those already mean the unit's shop tier (`.statcell`/`.tierbadge` in `styles.css`).
- **Perf north star:** per-tier frame styling must be **static paint** — no looping animation of `box-shadow`/`filter`/`background`/`border-radius` (see `kwglow`). The only badge motion stays the existing one-shot `useBadgePop` and value roll — do not touch them.
- **No bare `cursor:` keyword** on any interactive element (game cursor rule).
- **FX committed art ships** — if any authored def uses a `custom` image layer, its PNG must be `git add`ed in the same commit as the def (that is Mike's workbench step, not this plan's).
- **Gates before "done":** `npm run typecheck && npm run lint && npm test && npm run build:web` all green. Run `npm install` in the worktree first if it is fresh.
- **Patch notes:** prepend a spoiler-light entry to `packages/ui/src/patchNotes.ts` (player-facing UI change).

---

### Task 1: Pure tier model + tests

**Files:**
- Create: `packages/ui/src/choreo/statMilestones.ts`
- Test: `packages/ui/src/choreo/statMilestones.test.ts`

**Interfaces:**
- Produces:
  - `type StatKind = 'attack' | 'health'`
  - `const MILESTONE_TIERS: Record<StatKind, number[]>`
  - `function tierOf(stat: StatKind, value: number): number` — 0..N (count of thresholds at or below `value`)
  - `function crossedUp(stat: StatKind, prev: number, next: number): number | null` — the highest tier newly reached, or null

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/choreo/statMilestones.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { crossedUp, MILESTONE_TIERS, tierOf } from './statMilestones';

describe('MILESTONE_TIERS', () => {
  it('is the owner-set schedule, per stat', () => {
    expect(MILESTONE_TIERS.attack).toEqual([50, 100, 500, 1000, 5000]);
    expect(MILESTONE_TIERS.health).toEqual([50, 100, 500, 1000, 5000]);
  });
});

describe('tierOf', () => {
  it('is 0 below the first threshold', () => {
    expect(tierOf('attack', 0)).toBe(0);
    expect(tierOf('attack', 49)).toBe(0);
  });
  it('steps up exactly AT each threshold (inclusive)', () => {
    expect(tierOf('attack', 50)).toBe(1);
    expect(tierOf('attack', 99)).toBe(1);
    expect(tierOf('attack', 100)).toBe(2);
    expect(tierOf('attack', 500)).toBe(3);
    expect(tierOf('attack', 1000)).toBe(4);
    expect(tierOf('attack', 5000)).toBe(5);
  });
  it('caps at the top tier for anything above the last threshold', () => {
    expect(tierOf('attack', 999999)).toBe(5);
  });
  it('never returns a tier for a negative value', () => {
    expect(tierOf('health', -10)).toBe(0);
  });
});

describe('crossedUp', () => {
  it('returns the tier reached on a single-step up-cross', () => {
    expect(crossedUp('attack', 49, 50)).toBe(1);
    expect(crossedUp('attack', 99, 100)).toBe(2);
  });
  it('returns the HIGHEST tier when a jump vaults several at once', () => {
    expect(crossedUp('attack', 40, 1200)).toBe(4);
  });
  it('is null when the tier did not change', () => {
    expect(crossedUp('attack', 50, 60)).toBeNull();
    expect(crossedUp('attack', 10, 20)).toBeNull();
  });
  it('is null on a DOWN-cross (frame follows down, but no celebration)', () => {
    expect(crossedUp('attack', 120, 40)).toBeNull();
    expect(crossedUp('attack', 100, 99)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/choreo/statMilestones.test.ts`
Expected: FAIL — cannot resolve `./statMilestones`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ui/src/choreo/statMilestones.ts`:

```ts
/**
 * STAT MILESTONES — fixed value tiers for the Attack/Health badges.
 *
 * Pure and React-free (unit-testable headlessly, like `channels/rallyFired.ts`). This is the SINGLE source of
 * truth for the thresholds: the badge frame is `tierOf(currentValue)` and the celebration fires on
 * `crossedUp(prev, next)`. No per-unit state lives anywhere — the frame is derived every render and the FX
 * needs only the previous value the badge already tracks (`prevStats` in `Card.tsx`).
 *
 * Tiers are OWNER-SET (docs/superpowers/specs/2026-09-14-stat-milestone-frames-design.md). Per-stat by
 * construction so Health can run higher than Attack later with a one-line edit; identical today.
 */
export type StatKind = 'attack' | 'health';

export const MILESTONE_TIERS: Record<StatKind, number[]> = {
  attack: [50, 100, 500, 1000, 5000],
  health: [50, 100, 500, 1000, 5000],
};

/** How many thresholds `value` has reached: 0 (below the first) up to the number of thresholds. Pure. */
export function tierOf(stat: StatKind, value: number): number {
  const tiers = MILESTONE_TIERS[stat];
  let t = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (value >= tiers[i]) t = i + 1;
    else break;
  }
  return t;
}

/** The highest tier newly reached going prev→next, or null when the tier did not increase. A jump that vaults
 *  several tiers reports the top one, so a single big buff fires ONE celebration (at the tier reached). */
export function crossedUp(stat: StatKind, prev: number, next: number): number | null {
  const before = tierOf(stat, prev);
  const after = tierOf(stat, next);
  return after > before ? after : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/choreo/statMilestones.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/statMilestones.ts packages/ui/src/choreo/statMilestones.test.ts
git commit -m "feat(ui): pure stat-milestone tier model (tierOf/crossedUp)"
```

---

### Task 2: Milestone binding-kind family

**Files:**
- Modify: `packages/ui/src/choreo/bindings.ts` (add the kind family alongside `HudBindingKind`, ~line 18–35)
- Modify: `packages/ui/src/choreo/bindings.test.ts` (add the new kinds to the valid-key set — mirror `HUD_BINDING_KINDS`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type StatMilestoneBindingKind = 'statMilestone1' | 'statMilestone2' | 'statMilestone3' | 'statMilestone4' | 'statMilestone5'`
  - `const STAT_MILESTONE_BINDING_KINDS: readonly StatMilestoneBindingKind[]`
  - `function statMilestoneKind(tier: number): StatMilestoneBindingKind`
  - `BindingKind` widened to include `StatMilestoneBindingKind`

- [ ] **Step 1: Add the kind family to `bindings.ts`**

Immediately after the `HUD_BINDING_KINDS` declaration (~line 23), add:

```ts
/**
 * A binding key for a STAT MILESTONE — a badge crossing a fixed value tier (see `choreo/statMilestones.ts`).
 * One key per tier so each tier's celebration is an independently workbench-rebindable slot.
 *
 * Its own family, sibling to `HudBindingKind`, for the same reason: these kinds are fired DIRECTLY from the
 * badge DOM (`fx/statMilestone.ts`), have no combat cue list in `SCORE_DEFAULTS`, and are NOT emitted through
 * `recruitMoments.ts` — so folding them into `MomentKind` or `RecruitMomentKind` would break those modules'
 * invariants (an exhaustive score row / "every declared kind has an emitter") with a kind they can never produce.
 */
export type StatMilestoneBindingKind =
  | 'statMilestone1' | 'statMilestone2' | 'statMilestone3' | 'statMilestone4' | 'statMilestone5';

export const STAT_MILESTONE_BINDING_KINDS: readonly StatMilestoneBindingKind[] =
  ['statMilestone1', 'statMilestone2', 'statMilestone3', 'statMilestone4', 'statMilestone5'];

/** The binding kind for a milestone tier (1..5). Clamped so an out-of-range tier resolves to a real key. */
export function statMilestoneKind(tier: number): StatMilestoneBindingKind {
  const n = Math.min(STAT_MILESTONE_BINDING_KINDS.length, Math.max(1, Math.round(tier)));
  return STAT_MILESTONE_BINDING_KINDS[n - 1];
}
```

- [ ] **Step 2: Widen `BindingKind`**

Change the `BindingKind` union (currently `MomentKind | RecruitMomentKind | HudBindingKind`) to:

```ts
export type BindingKind = MomentKind | RecruitMomentKind | HudBindingKind | StatMilestoneBindingKind;
```

- [ ] **Step 3: Update the binding key-validation test**

In `packages/ui/src/choreo/bindings.test.ts`, find where `HUD_BINDING_KINDS` is used to build the set of legal binding keys (grep the file for `HUD_BINDING_KINDS`). Add `STAT_MILESTONE_BINDING_KINDS` to that same set exactly as HUD is added — import it from `./bindings` and spread it into the valid-keys collection so a `statMilestoneN` row is recognised as naming a real kind.

- [ ] **Step 4: Run the binding tests**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: PASS (no bound `statMilestoneN` rows exist yet, so nothing new is asserted beyond the union compiling; the key-validation set now accepts the family).

- [ ] **Step 5: Typecheck the UI package**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/choreo/bindings.ts packages/ui/src/choreo/bindings.test.ts
git commit -m "feat(ui): stat-milestone binding-kind family (statMilestone1..5)"
```

---

### Task 3: The badge-anchored fire helper

**Files:**
- Create: `packages/ui/src/fx/statMilestone.ts`

**Interfaces:**
- Consumes: `StatKind` (Task 1); `bindingFor`, `statMilestoneKind` (Task 2); `canPlayDefs`/`playDef` (`./playDef`); `sfx` (`../sfx`).
- Produces: `function fireStatMilestone(cardId: string | null, stat: StatKind, tier: number, point: { x: number; y: number }): void`

**Note:** DOM/`playDef`-touching, so it is NOT unit-tested (no jsdom in this repo — same as `recruitCues.ts`). It is verified via typecheck/build and the browser check in Task 6.

- [ ] **Step 1: Write the helper**

Create `packages/ui/src/fx/statMilestone.ts`:

```ts
import type { StatKind } from '../choreo/statMilestones';
import { bindingFor, statMilestoneKind } from '../choreo/bindings';
import { canPlayDefs, playDef } from './playDef';
import { sfx } from '../sfx';

/**
 * Fire the authored celebration for a badge that just crossed a milestone tier upward.
 *
 * A DIRECT, point-anchored single fire — the badge's own screen point is source AND target, so the def plays
 * ON the badge with nothing to travel between (the `spellCast` single-fire shape, minus the DOM measure the
 * point makes unnecessary). WHICH def plays comes from `bindings.json` keyed `(cardId, statMilestoneN)`, so a
 * per-card override can shadow the per-tier default and every tier is rebindable from the workbench.
 *
 * PHASE-AGNOSTIC: the caller decides when to fire. Today only `Card.tsx`'s uid-gated recruit path calls it, so
 * the celebration is shop/hand-only for free; `Unit.tsx` can call the same helper for combat later.
 */
export function fireStatMilestone(
  cardId: string | null,
  stat: StatKind,
  tier: number,
  point: { x: number; y: number },
): void {
  if (!canPlayDefs()) return;
  const binding = bindingFor(cardId, statMilestoneKind(tier));
  if (!binding) return; // unbound tier plays nothing — the frame still changes
  const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  playDef(binding.def, { source: point, target: point, cursor: point, camera }, { uids: { source: cardId, target: cardId } });
  if (binding.sfx !== undefined) sfx[binding.sfx]?.();
}
```

- [ ] **Step 2: Confirm the `playDef` call shape**

Open `packages/ui/src/fx/playDef.ts` and confirm `playDef(def, anchors, opts)` accepts an anchors object with `source`/`target`/`cursor`/`camera` and an opts object with `uids` (compare against the `runSpellCastFire` call in `recruitCues.ts:239`). Adjust the call to match the exact signature if it differs (e.g. `uids` value shape). Do not change `playDef` itself.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/statMilestone.ts
git commit -m "feat(ui): badge-anchored stat-milestone fire helper"
```

---

### Task 4: Tiered badge frames (CSS + data-milestone attribute)

**Files:**
- Modify: `packages/ui/src/Card.tsx` (badge render block, ~lines 1106–1113)
- Modify: `packages/ui/src/styles.css` (new `MILESTONE FRAMES` block; existing badge/plate styles ~lines 1837–1848)

**Interfaces:**
- Consumes: `tierOf` (Task 1).

- [ ] **Step 1: Import and compute the tier in `Card.tsx`**

Near the other `choreo` imports in `Card.tsx`, add:

```ts
import { tierOf } from './choreo/statMilestones';
```

The frame reflects the SETTLED value (so it agrees with the number once a roll lands), which is `card.attack` / `card.health` — NOT the mid-roll `shownAttack`/`shownHealth`.

- [ ] **Step 2: Add `data-milestone` to both badges**

In the badge render block (`Card.tsx:1106` and `1110`), add the attribute to each `.badge` span:

```tsx
<span ref={atkPopRef} data-milestone={tierOf('attack', card.attack)} className={`badge atk${statCls(shownAttack, card.baseAttack, card.floorAttack)}`}>
  <span className="plate" aria-hidden="true" />
  <span className="value">{formatStat(shownAttack)}</span>
</span>
<span ref={hpPopRef} data-milestone={tierOf('health', card.health)} className={`badge hp${statCls(shownHealth, card.baseHealth, card.floorHealth)}`}>
  <span className="plate" aria-hidden="true" />
  <span className="value">{formatStat(shownHealth)}</span>
</span>
```

(`tierOf(..)` returns `0` for the common below-50 case; the CSS below only styles tiers ≥ 1, so tier 0 renders exactly as today.)

- [ ] **Step 3: Add the `MILESTONE FRAMES` CSS block**

In `styles.css`, after the existing `.badge > .plate` rules (~line 1848), add a new commented block. Static paint only — per-tier rim colour + gradient + a static ornament via `::before`. Placeholder palette (Mike tunes; keep the variable names):

```css
/* ── MILESTONE FRAMES ────────────────────────────────────────────────────────────────────────────────────
   A tiered frame the badge sits in, driven by `data-milestone` (0..5 = tierOf(value); see choreo/
   statMilestones.ts). Pure STATIC paint — no looping animation of paint properties (perf north star). The
   number's roll and the one-shot `useBadgePop` are untouched; this only restyles the `.plate` shape.
   NOTE: `data-milestone`/`--ms-N` are milestone tiers — DISTINCT from the unit's shop tier (`--tier-N`). */
:root {
  --ms-1: #b87333; /* bronze  */
  --ms-2: #c0c0c0; /* silver  */
  --ms-3: #ffd54a; /* gold    */
  --ms-4: #4fd1ff; /* diamond */
  --ms-5: #ff5edb; /* mythic  */
}
.badge[data-milestone='1'] > .plate { border-color: var(--ms-1); box-shadow: 0 0 6px var(--ms-1), 0 2px 6px rgba(0,0,0,0.3); }
.badge[data-milestone='2'] > .plate { border-color: var(--ms-2); box-shadow: 0 0 7px var(--ms-2), 0 2px 6px rgba(0,0,0,0.3); }
.badge[data-milestone='3'] > .plate { border-color: var(--ms-3); box-shadow: 0 0 9px var(--ms-3), 0 2px 6px rgba(0,0,0,0.3); }
.badge[data-milestone='4'] > .plate { border-color: var(--ms-4); box-shadow: 0 0 11px var(--ms-4), 0 2px 8px rgba(0,0,0,0.35); }
.badge[data-milestone='5'] > .plate { border-color: var(--ms-5); box-shadow: 0 0 14px var(--ms-5), 0 2px 8px rgba(0,0,0,0.4); }
/* Art-swap seam: a later per-tier PNG points a plate background at `--ms-plate-<tier>` with no markup change. */
```

- [ ] **Step 4: Verify the frame visually (dev server + real browser)**

Start the dev server (`preview_start` with the project's launch config, or `npm run dev`). In a card with a boosted stat (or via `window.useGame` in a focused tab), confirm: a badge at ≥50 shows the tier-1 rim, tiers step up at 100/500/1000/5000, a badge below 50 looks exactly as before, and the frame appears in combat too (value-derived). Confirm the number still rolls and pops normally. (Preview pane is unreliable for visuals — use a focused Chrome tab per the FX-verify convention.)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Card.tsx packages/ui/src/styles.css
git commit -m "feat(ui): tiered badge frames driven by data-milestone (all phases)"
```

---

### Task 5: Fire the celebration on an upward crossing

**Files:**
- Modify: `packages/ui/src/Card.tsx` (the stat `useLayoutEffect`, ~lines 531–542)

**Interfaces:**
- Consumes: `crossedUp` (Task 1), `fireStatMilestone` (Task 3), the badge refs `atkPopRef`/`hpPopRef` (existing).

- [ ] **Step 1: Import the crossing detector and the fire helper**

In `Card.tsx`:

```ts
import { crossedUp, tierOf } from './choreo/statMilestones';   // tierOf already imported in Task 4 — keep one import line
import { fireStatMilestone } from './fx/statMilestone';
```

- [ ] **Step 2: Confirm the def-id field for the binding key**

Confirm the prop that holds the card DEFINITION id (needed for `bindingFor(cardId, ...)`). It is the card's `id` (e.g. `card.id`), NOT the instance `uid`. Grep `Card.tsx` for `card.id` / how other bindings key cards; use that field name in Step 3.

- [ ] **Step 3: Detect the crossing inside the existing stat effect**

The stat `useLayoutEffect` (`Card.tsx:531`) already computes `dA`/`dH` from `prevStats` under the exact guards we want: it early-returns when `prev.uid !== uid` (a freshly-mounted/recycled card — this is our seed-no-fire-on-spawn) and when `uid === undefined` (combat/static surfaces carry no uid — this is our shop/hand-only gate). Extend it, AFTER the `holdStat(...)` call, without altering the roll:

```ts
    holdStat(uid, { attack: dA, health: dH }, { origin: 'intrinsic' });

    // Milestone celebration: fire the per-tier def when a badge crosses a fixed value tier UPWARD. Guarded by
    // the same conditions as the roll above — a real stat change on a uid-bearing (recruit) surface, never on
    // spawn (prev.uid !== uid returned already) — so it is shop/hand-only for free and combat-ready via Unit.
    const atkTier = crossedUp('attack', prev.attack, card.attack);
    const hpTier = crossedUp('health', prev.health, card.health);
    if (atkTier !== null) {
      const r = atkPopRef.current?.getBoundingClientRect();
      if (r) fireStatMilestone(card.id, 'attack', atkTier, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    if (hpTier !== null) {
      const r = hpPopRef.current?.getBoundingClientRect();
      if (r) fireStatMilestone(card.id, 'health', hpTier, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
```

Add `card.id` (the def-id field confirmed in Step 2) to the effect's dependency array only if the linter requires it; `card.attack`/`card.health`/`uid` are already deps and are what actually drive the effect.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck:web && npm run lint`
Expected: PASS. (Fix any `card.id` field-name mismatch from Step 2 here.)

- [ ] **Step 5: Verify the fire path end-to-end (after Task 6 binds a def)**

The celebration cannot be seen until Task 6 binds a real def to the tiers. Defer visual verification to Task 6 Step 4; for now confirm no console errors when a stat crosses 50 in the shop (the helper no-ops on an unbound tier).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Card.tsx
git commit -m "feat(ui): fire per-tier celebration on an upward stat-milestone crossing"
```

---

### Task 6: Placeholder bindings, patch notes, devlog, full verification

**Files:**
- Modify: `packages/ui/src/choreo/bindings.json` (5 kind rows)
- Modify: `packages/ui/src/patchNotes.ts` (prepend one entry)
- Create: `docs/devlog/2026-09-14-stat-milestone-frames.md`

**Interfaces:**
- Consumes: an existing authored def id that resolves in the registry (placeholder until Mike authors 5 real defs).

- [ ] **Step 1: Pick a real placeholder def id**

Find an existing burst def that resolves (so `bindings.test.ts`'s "every bound def id resolves in the registry" passes). Grep `packages/ui/src/fx/defs/` for a simple self-anchored burst — e.g. the def `self-buff-burst` or the one bound to `shopBuffAll`/`minionSelfBuffed` in the current `bindings.json`. Confirm the chosen stem exists as `packages/ui/src/fx/defs/<stem>.json`.

- [ ] **Step 2: Add the 5 kind rows to `bindings.json`**

Under `"kinds"`, add (using the confirmed placeholder def id; keys are sorted on the next workbench write, so raw order here does not matter). Optionally add `"sfx": "maxGold"` — a whitelisted sound that fits a milestone:

```json
"statMilestone1": { "def": "<placeholder-def>" },
"statMilestone2": { "def": "<placeholder-def>" },
"statMilestone3": { "def": "<placeholder-def>" },
"statMilestone4": { "def": "<placeholder-def>" },
"statMilestone5": { "def": "<placeholder-def>" }
```

- [ ] **Step 3: Run the binding + golden tests**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: PASS — every `statMilestoneN` row names a legal kind (Task 2) and a def that resolves (Step 1).
Then run the broader FX/catalog goldens that enumerate bindings: `npx vitest run packages/ui/src/choreo` and update any golden snapshot that legitimately gained the 5 new rows (memory: `bindings.test`/`catalog.test`/`score.test` refs move when a kind is added — confirm each delta is exactly the new rows, nothing else).

- [ ] **Step 4: Verify the celebration in a focused browser**

With the dev server running, in the shop buff a unit's Attack across 50 (drag a buff, use a shop spell, or drive `window.useGame`). Confirm: the placeholder burst fires at the ATTACK badge's corner; it does NOT fire on card spawn; it does NOT fire in combat (Card has no uid there); the frame upgrades to tier 1. Cross 100 to see tier 2 fire + reframe. (Focused Chrome tab, not the preview pane.)

- [ ] **Step 5: Prepend the patch note**

At the top of the entries in `packages/ui/src/patchNotes.ts`, add a spoiler-light entry, e.g.:

> **Milestone badges.** Attack and Health badges now sit in tiered frames that light up as a unit grows, with a celebration when a stat hits a new milestone in the shop.

- [ ] **Step 6: Write the devlog entry**

Create `docs/devlog/2026-09-14-stat-milestone-frames.md` summarising: the pure tier model, the value-derived frames (all phases), the shop-gated-by-uid celebration, the `statMilestone1..5` binding family fired directly from the badge DOM, and that the 5 defs are placeholders for Mike to author + rebind in the workbench. Link the spec.

- [ ] **Step 7: Full gate run**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Report the results.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/choreo/bindings.json packages/ui/src/patchNotes.ts docs/devlog/2026-09-14-stat-milestone-frames.md
git commit -m "feat(ui): bind placeholder milestone defs + patch notes + devlog"
```

---

## Self-Review

**Spec coverage:**
- Fixed value tiers `50/100/500/1000/5000`, per-stat structure → Task 1 (`MILESTONE_TIERS`, Global Constraints). ✓
- Frame value-derived, shown everywhere → Task 4 (`data-milestone` from `card.attack/health`, no uid gate). ✓
- FX shop-only today, phase-agnostic mechanism → Task 3 (helper is caller-agnostic) + Task 5 (uid-gated call site). ✓
- Frame follows value both ways; FX fires on up-cross only, re-fires on re-cross → Task 1 (`crossedUp` null on down/same) + Task 4 (frame purely derived). ✓
- Distinct def per tier, workbench-rebindable → Task 2 (`statMilestone1..5` family) + Task 6 (per-tier rows). ✓
- CSS tiers now, PNG-swappable later → Task 4 (`--ms-plate-<tier>` seam). ✓
- Seed-no-fire on spawn → Task 5 (existing `prev.uid !== uid` early return). ✓
- No sim/reducer/types changes; patch notes; goldens → Global Constraints + Task 6. ✓
- **Deviations from spec (flagged for owner):** milestone kinds are their own binding family fired directly from the badge DOM rather than a `RecruitMoment` (spec §3.3); atk/hp tint param dropped (no `playDef` param channel; plate colour distinguishes the stat). Both preserve every approved decision.

**Placeholder scan:** the only literal placeholders are the intended-to-be-tuned CSS palette values and the `<placeholder-def>` binding, each with an explicit resolution step (Task 6 Step 1). No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `StatKind`, `tierOf`, `crossedUp` (Task 1) used verbatim in Tasks 3–5; `statMilestoneKind`/`STAT_MILESTONE_BINDING_KINDS`/`StatMilestoneBindingKind` (Task 2) used verbatim in Task 3; `fireStatMilestone(cardId, stat, tier, point)` signature identical in Task 3 (def) and Task 5 (call). `card.id` flagged for confirmation in Task 5 Step 2 before use.
