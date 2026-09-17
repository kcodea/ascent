# 2026-09-17 — Perf PR 3: Discover FX budget, play lifetime ceiling, DOM "leak" audit

The third of the three PRs the [perf handoff](../perf-handoff-2026-09-17.md) proposed. Owner constraint: none
of it may change how the game looks or plays; the only sanctioned visible effect is a Discover particle cap
that bites an extreme pile-up. Two of the three findings turned out to be reading errors of the capture rather
than defects; the code that shipped is a real ceiling and a real scene cap regardless, because both close a
gap the capture made visible.

## 1. The Discover scene cap — `maxParticlesDiscover: 2000`

- **What the Discover plays.** The overlay itself plays NO authored defs: its golden eruption is
  `discoverFx.discoverBurst` — 67 hand-written sprites (1 glow + 16 motes + 50 sparks, ≤ 2.4 s) on the
  overlay's OWN Pixi app and counter (`discover particles`). The 2,673 in `fx:particles` (board layer + def
  pool) in the Discover second are the moment that OPENED it (a triple's `shop-tier-up` 506, `prismatic-pick`
  364, a hero power's spark 124) stacked on whatever the shop was already playing, plus up to four protected
  `choose-one-both` loops (217 each) riding the offered cards. Which of those it actually was is **not
  verified** — the shared `perf_runs` table is RLS-gated to signed-in users, so the capture could not be
  fetched.
- **Cost per particle, measured.** The dev tab runs hidden in this harness (rAF at ~1 Hz), so the Pixi
  ticker was driven by hand: `app.ticker.update(t)` at 4.17 ms steps with `death-dissolve` fans (397 each),
  timing each pass. Means: 0.15 ms at 397 · 0.27 at 794 · 0.93 at 1,588 · 1.87 at 2,779 · 2.64 at 3,970 —
  ≈ 0.66 µs per live particle; p95 climbs past 3 ms from ~1,600 up; idle frame 0.003 ms. So the
  "`fx:tick` < 2 ms" line by the mean is ≈ 3,000 particles. The owner's 22 ms at 2,673 is not explained by
  the per-particle sim alone (spawn frame, filters, GC, a slower GPU — unknown).
- **The cap.** `fxBudget.ts` gains a scene (`setFxScene('discover' | null)`, set from `Game.tsx` off
  `run.discover` so the FX layer never imports the store) and `particleCapFor(cfg, scene)`: inside the
  Discover the live-particle ceiling is `min(maxParticles, maxParticlesDiscover)`. Same oldest-same-def-first
  trim, same protections (loops / follows / `onDone` plays are never candidates). **2,000** keeps the mean
  near 1.3 ms with headroom, clears the largest legitimate Discover moment (4 loops + a triple + a pick ≈
  1,860), and against the recorded 2,673 would have retired the oldest plays until ≤ 2,000 remained — the
  most-faded ~25% of the pile-up, never the burst landing now. The authored defs are untouched. The owner can
  move it live: `window.__fx.budget.set('maxParticlesDiscover', n)`; `window.__fx.budget.scene()` reads the
  scene in force.

## 2. The play lifetime ceiling — `fx/playLifetime.ts`

- **What the numbers meant.** `fx:def:dice-land` n = 3,545 and `spell-sparks` n = 5,643 are the per-frame
  label's **call count summed over every play of that def in the capture** (`PerfSpan.n`), not one play's
  frame count: ≈ 25 dice rolls × ~145 frames and ≈ 30 spell casts × ~180 frames at 240 Hz. Each play retires
  at its true completion — `dice-land` (on `feat/dice-roll`, not yet on `main`) at ~600 ms, `spell-sparks` at
  ~720 ms — as `player.ts`'s `firing` branch always did. Verified for real on the dev server: ten
  `death-dissolve` plays were all retired within 1.67 s of simulated time (natural end 1.23 s).
- **The gap that was real.** A one-shot play whose layer never reports `isComplete()` had exactly one
  backstop: `PLAY_TIMEOUT_MS`, 15 s of wall clock — 15 s of a leaked updater, container and live GPU-backed
  particle layer per stuck play. The ceiling is now the def's own honest end: `playLifetimeMs(def)` =
  `max(duration + longest particle life, every layer's own natural end) + 500 ms grace`, divided by the
  play's `speed`, never above the old 15 s.
- **Why not the handoff's literal `duration + maxParticleLife`, and why emitters do NOT stop at
  `duration`.** Scanning every committed def against that formula: `cia-hp` (a 900 ms def whose emitter
  emits for 2,370 ms and drains for 2,370 more), `spell-target` / `ruby-target` (1,220 ms emitters in
  1,000 ms defs), `flame-ring` / `flame-ring-crit` (a 1,568 ms shockwave in a 900 ms def), `preset-blast`,
  `ruby-lance`, `rally-link` are all authored to play PAST duration + particle life — an emitter's one-shot
  window is its own `life`, not the def's duration (`withinEmitWindow`). Cutting there, or stopping emission
  at `duration`, would visibly change those effects. So every layer's span is mirrored from its primitive's
  own `isComplete()` arithmetic (burst `life`; emitter/smoke `2 × life`; shockwave, custom, screen, beam,
  lightning their timing params; an explicit layer `life` bounds anything), and an unmodelled primitive
  (`ribbon`, `react`, `targeting`) gets the rest of the def plus 3 s so it can never be the one that is cut.
- Tests: `playLifetime.test.ts` (the arithmetic, 14 cases) and `playDef.test.ts` "lifetime" (through the
  real `playDef` with the overlay stubbed: a stuck spell-sparks-shaped play retires at 600 + 700 + 500 ms,
  not 15 s; a dice-land-shaped play retires when its last shard dies; `speed` stretches the wall-clock
  ceiling; the 15 s cap still bounds a def with a 30 s life; five plays' mounts return to zero).

## 3. The DOM "leak" — not reproduced; state growth, not a leak

Two scripted shop sessions on the dev server (`window.useGame`, a `MutationObserver` netting element
adds/removes per parent, samples every 5 s), each ~4 minutes:

- **Run A** (Disco Dan, 621 ticks, 485 actions: roll / buy / sell / Discover open-close ×8): 471 → 827
  nodes, but the hand went 0 → 10 cards at ~45 nodes each; the observer's only net growth was the hand row
  and the Discover overlay's mount/unmount churn. Nothing accumulated under `<body>`, in portals, floats,
  or FX wrappers.
- **Run B** (Warden, 453 actions: roll / buy / play to board / sell / hover-portal on random cards / end
  turn → combat → shop ×4 waves), sampled at **rest states** (everything sold, floats dead, same hand /
  board / shop counts): 384 → 392 → 385 → 388 over 200 s. Flat within the perf HUD's own +3.

So "100 → 1,027 growing with time" is almost certainly the title screen (≈100 nodes) becoming a populated
shop (7 board + 10 hand + 7 shop cards ≈ 45 nodes each, plus bars ≈ 1,000), not a leak. What this did NOT
exercise: Runeforge, the lobby panel, a full 60-round game, the Beat Lab / workbench, and a real pointer (the
hover portal was driven with synthetic `mouseover` / `mouseout` on `.card`, which does open and close
`.cardref`). PR 1's per-container node delta will settle it on the owner's machine; the test that the FX
layer's wrappers return to baseline after plays retire is in `playDef.test.ts`.

## Not verified live

- Real-frame-rate `fx:tick` numbers (the harness tab is hidden; costs were measured per manual ticker pass).
- Which defs made up the 2,673-particle Discover second (the capture is not fetchable anonymously).
- A 78 ms single-tick spike seen once in the manual-ticker run as two `death-dissolve` plays retired
  (K = 2 "tail" max) — one sample, hidden tab, not chased; worth a look if PR 1's attribution ever names a
  retire.
