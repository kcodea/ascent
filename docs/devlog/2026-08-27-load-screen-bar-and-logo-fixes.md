# 2026-08-27 — Load screen: bar now fills, logo no longer spikes

Two owner-reported boot-splash bugs (`apps/web/index.html` + `loadScreenConfig.ts`), root-caused with live DOM
evidence rather than guessed.

## Bar snapped instantly full instead of filling

**Symptom:** the fake 3.5s progress bar was *instantly full*, no fill — on both warm and hard reloads, with
reduced-motion OFF.

**Root cause:** the fill was a CSS **transition** (`#bootsplash-bar > i` `scaleX(0)` → `scaleX(1)` on `.is-in`).
A transition only animates if its start value was PAINTED in a prior frame. The AscentIcon (a local asset)
loads before the splash's first paint, so the reveal script adds `.is-in` in the *same frame* the bar first
renders — the transition has no "before" and snaps straight to the end value. (Cold-in-a-focused-browser was
the only case it ever animated, which is why it looked intermittent.)

**Fix:** replace the transition with a **keyframe animation** (`@keyframes bootbarfill` `scaleX(0)`→`scaleX(1)`,
`3500ms linear forwards`). An animation runs from its `0%` keyframe unconditionally — independent of when
`.is-in` is applied or whether the start state was painted — so it always fills. The `prefers-reduced-motion`
rule now sets `animation: none; transform: scaleX(1)` (was `transition: none`).

## Logo spiked to a larger size a beat into boot

**Symptom:** the AscentIcon jumped up in size ~900ms after the splash appeared (dev only).

**Root cause:** the index.html fallback is responsive — `--ls-icon: min(570px, 42vw, 42vh)` — but
`loadScreenConfig.ts`'s DEFAULT `iconSize` is a flat `570`, and in DEV `applyLoadScreenVars()` ran at module
load (bundle mount) and pinned `--ls-icon: 570px`, overriding the responsive `min()`. On any viewport where
`42vh`/`42vw` < 570 that's a visible jump up. (No-op in prod — `applyLoadScreenVars` is dev-gated — so this was
a dev-only regression.)

**Fix:** only pin the flat tuner px on load when the user has actually SAVED a tuner config
(`localStorage.getItem(KEY) !== null`). Untuned dev now leaves the responsive fallback in place, matching prod.
A tuned dev build is already applied pre-paint by index.html's inline script, so it stays WYSIWYG.

## Notes

Investigation was constrained: the in-app preview pane pauses all CSS timelines (rAF, transitions,
animations), so it could confirm the `.is-in` rule *applies* but never whether it *animates* — the owner's
"instantly full / reduced-motion off" answers were the decisive evidence, and the owner verified the fix in a
focused browser. Verified: typecheck ✅, lint 0 errors ✅, build:web ✅.
