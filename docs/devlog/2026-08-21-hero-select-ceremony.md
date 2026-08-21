# 2026-08-21 — the Hero Select Ceremony: picking a hero is now an event, not a click

Implements `hero-select-ceremony-blueprint.md` (Phases 1–4 in one branch). Clicking a hero no longer creates
a run: the other choices yield the stage, the selected card presses in and travels to center, its chrome
dissolves while the clean portrait materializes, the hero's name and power name rise, and an explicit
**Start Game** button confirms. ~1.9s click-to-actionable on the blueprint defaults.

**Owner decisions baked in:** no skip affordance; no `prefers-reduced-motion` variant (consistent with the
repo-wide ruling in styles.css); built by Claude in phased agents; a dev tuner ships with it.

## Architecture

- **Pure phase machine** (`hero-select/heroCeremonyMachine.ts`): idle→committed→dismissing→focusing→voicing→
  materializing→ready→launching, one legal forward path, `startGame` the only door into `launching` and only
  from `ready` — double-run-creation is structurally impossible, not debounced. Illegal events return the
  same state object, so a stray timer after reset can't resurrect anything.
- **One typed timing object** (`heroCeremonyTiming.ts`) — every delay/duration, overridable live by the new
  **🎭 Hero Ceremony** dev tuner (17 sliders grouped by phase + a Replay action that re-runs the ceremony in
  place; standard tuner conventions, prod plays defaults).
- **`pickHero` untouched.** The ceremony only *delays* it: Start Game → the Game-owned launch curtain covers
  → `pickHero()` under full opacity (run creation, lobby warmup, save write, replay capture all hidden) →
  two rAF → reveal Recruit. The curtain lives in Game.tsx because `pickHero` clears `heroChoices`, which
  unmounts HeroSelect mid-transition (§7 of the blueprint).
- **Dedicated Pixi layer** (`HeroCeremonyPixi.ts`): its own Application (third in the codebase, same DPR-cap/
  init-failure pattern as the two in pixiFx), arrival burst / ambience / frame dissipation / launch pulse
  within the §18 particle budgets, pooled sprites, one self-stopping ticker, destroy-safe at any moment
  including before its async init resolves. Init failure = inert no-op; the DOM ceremony IS the fallback.
- **Geometry is math** (`heroCeremonyGeometry.ts`): rects snapshotted once at commit (+ once per debounced
  resize), never per frame; every animation is WAAPI transform/opacity.

## The bug worth remembering

First live run: the unselected cards never left. `Element.animate` was **never called** — the `dismissing`
and `focusing` advances are 20ms apart, React 18 coalesced both dispatches into one render, the transient
phase never rendered, and every effect guarded `phase !== 'dismissing'` skipped its work. In a backgrounded
tab (timers clamped to 1s) all five advances collapse and half the ceremony vanishes. Fix: one-shot beats
fire on phase-index **crossing** (`pi >= phaseIndex(p)`) latched by refs — a skipped render degrades to
"catch up now", never "never happened". Verified in the worst case: a fully hidden tab now completes every
beat.

## Verification

- 88 new tests across 6 files: machine transitions (launch-once, no-skip-to-launching, referential no-ops),
  geometry NaN-safety + clamps + stagger cap, launch-controller seam (double-press → one `pickHero` path),
  Pixi pure math (perimeter spawns, budgets, eases). Full suite 6382 ✅.
- Live on the branch dev server: click → dismiss → settle (screenshot) → transform → ready (screenshot) →
  Start Game → Recruit mounted with the picked hero, lobby seated, ceremony canvas fully torn down.
- Gates: typecheck ✅ · lint 0 errors ✅ · build:web ✅.

## Not done (deliberate)

- Hero **voicelines don't exist** (`audio/heroes/` is empty) — the `voiceAtMs` beat is silent for all heroes
  until recordings land; the timeline is visual-driven so nothing waits on it.
- §19's run-construction-throw Retry panel (curtain currently logs + reveals); §21's five-viewport visual QA
  (desktop verified; the rest is an eyes pass); per-hero accent colors (everything burns `--acc` gold).
