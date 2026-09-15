# Attack/Health badges get tiered milestone frames + a shop celebration

Spec: [`docs/superpowers/specs/2026-09-14-stat-milestone-frames-design.md`](../superpowers/specs/2026-09-14-stat-milestone-frames-design.md).

Attack and Health badges now sit in a frame that reflects how far the stat has grown, and buffing a stat past
a fixed milestone in the shop fires a badge-anchored celebration.

## The model (pure, headless-testable)

`packages/ui/src/choreo/statMilestones.ts` is the single source of truth: `MILESTONE_TIERS` is
`[50, 100, 500, 1000, 5000]` per stat (Attack and Health identical today, but keyed separately so one can
diverge later with a one-line edit). `tierOf(stat, value)` derives how many thresholds a value has cleared —
0 through 5 — and `crossedUp(stat, prev, next)` returns the highest tier newly reached going prev→next, or
`null` when the tier didn't increase (down-crossings and same-tier moves never fire). A jump that vaults
several tiers at once (a big buff) still reports only the top tier, so it fires exactly one celebration.

## Frames — value-derived, every phase

`Card.tsx` sets `data-milestone={tierOf(stat, value)}` on the Attack and Health badge spans directly from
`card.attack` / `card.health` — no stored per-unit state, no uid gate. The frame is just what the current
value implies, so it's correct in the shop, in hand, on the board, and in combat, and it re-derives on every
render (buff up, buff down, a Rune scaling a stat mid-game — all just work). Tier styling lives in CSS as
`--ms-plate-<tier>` custom properties, deliberately a seam for the owner to swap in authored PNG frames per
tier later without touching the derivation logic.

## The celebration — shop-only today, phase-agnostic mechanism

`packages/ui/src/fx/statMilestone.ts` exports `fireStatMilestone(cardId, stat, tier, point)`: a direct,
point-anchored single fire (the badge's own screen center is both source and target — no DOM measure to
travel between). It looks up `(cardId, statMilestoneN)` in `bindings.json` via `statMilestoneKind(tier)`, so
a per-card override can shadow the default per tier and every tier is independently rebindable from the FX
workbench. An unbound tier just changes the frame silently — the helper never throws.

The helper itself doesn't know or care what phase it's called from. Today the only call site is `Card.tsx`'s
existing `prevStats`-diffed effect, which already early-returns when `prev.uid !== uid` (the seed-on-spawn
guard) — so the celebration is shop/hand-only for free, and never fires as a side effect of a fresh card
mounting with an already-high stat. `Unit.tsx` has no `uid` in combat, so the same call is deliberately not
wired there yet; nothing stops a later PR from calling `fireStatMilestone` from combat once that's wanted.

## Binding family

`statMilestone1..5` is its own `BindingKind` family (`STAT_MILESTONE_BINDING_KINDS` in `bindings.ts`), sibling
to the HUD-badge family, because these fire directly from the badge DOM rather than through a `RecruitMoment`
or combat `CombatEvent` — there's no event to hang a moment off. `statMilestoneKind(tier)` maps a 1-5 tier to
its kind name.

## Placeholders — owner follow-up required

All five `statMilestone1..5` rows in `bindings.json` are bound to the same existing `self-buff-burst` def
(also used by `minionSelfBuffed`/`buffWave`/`attackExchange`) purely so the pipeline is testable end-to-end —
`bindings.test.ts` asserts every bound def id resolves in the registry, and this is the simplest self-anchored
burst that already does. The owner should author 5 visually distinct tier defs and rebind each
`statMilestoneN` row in the workbench; nothing else in the wiring needs to change when that happens.

## Verification

`npx vitest run packages/ui/src/choreo` — 44 files / 635 tests green, including `bindings.test.ts`'s exact
kind→def golden (updated to include the 5 new rows) and its "every bound def id resolves" check. Full gate
(`typecheck`, `lint`, `test`, `build:web`) run before commit — see the task report for exact counts. The
in-browser celebration check (buffing a unit past 50/100 Attack in a focused tab) is deferred to the owner per
task scope.

Files: `packages/ui/src/choreo/bindings.json`, `packages/ui/src/choreo/bindings.test.ts`,
`packages/ui/src/patchNotes.ts`.
