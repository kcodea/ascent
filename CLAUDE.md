# ASCENT

Single-player roguelike auto-battler. Battlegrounds-style shop → build a board → fight an
ever-rising curve of **threat-typed** enemy boards. Survive as long as you can; score = waves
survived. Endless ascension, **bounded engine** (6 tiers, gold cap 10, board 7), threat telegraph
before each shop.

## Performance is the north star

**The game must feel snappy at ALL times — this is fundamental to the feel of play, above all else.**
Treat a frame drop, a shop hitch, or drag stutter as a *defect*, not a polish item. When a change could
cost performance, **measure it before shipping** (`npm run perf` for engine/logic; Chrome DevTools for
render/paint). The full playbook — the headless harness, the manual render-profiling routine we run
together, and the established anti-patterns — lives in [`docs/performance.md`](docs/performance.md). The
load-bearing rules:

- **Never animate paint properties in a loop** (`box-shadow`, `filter`, `drop-shadow`, `background`,
  `border-radius`) — they repaint every frame. Animate `transform`/`opacity` only (compositor-only). For a
  breathing glow, animate the **opacity** of a `::before` with a *static* shadow (see `kwglow` in `styles.css`).
- **Don't read layout (`getBoundingClientRect`) per frame** — cache it once per drag (see `insertRectsRef`).
- **Memoize per-beat/per-frame list items** (`Unit` is `React.memo`'d with a value comparator) and keep their
  props referentially stable.
- **Don't deep-clone large read-only state** (the reducer shares `lastCombat` by reference).
- Always confirm a "slow" report against the **prod build**, not `npm run dev` (StrictMode + Vite dev are
  much slower than what players run).

## Working with the user

**Ask clarifying questions whenever a direction is confusing or you're unsure what's wanted for a
specific ask** — don't guess at ambiguous UI/UX or design intent and build the wrong thing. Use the
question tool for genuine forks (the user's call); for the rest, state your assumption and proceed.
When you do make a judgement call on a fuzzy ask, flag it in your summary so the user can correct it.

## What is locked vs open

- **LOCKED — game rules & content** (per the user's Build Handoff v2): economy, combat
  resolution, the card set, threat archetypes, the tribe↔threat counter matrix. Build to spec; do
  not re-litigate. The counter matrix is balance *truth*; stat numbers are starting dials.
- **DECIDED — visual identity & layout** (2026-06-15): the UI direction is **"Pixel Arena"** —
  clean, bright, bold flat design (Nintendo/Splatoon clarity) with **pixel-art sprites** on cards,
  and the **Battlegrounds 3-row layout** (Tavern shop → Warband → Hand). Color scheme: **Sunward**
  (warm cream base, tangerine accent, raspberry threat). Cards are one standardized size across all
  rows; stats sit in corner badges over the sprite. Canonical mockup:
  `docs/design/recruit-E2-pixel.html` (sprites are palette-indexed 16×16 matrices → canvas). The old
  `ascent-ui-v3.html` prototype is dead — do **not** reproduce it.

## Architecture (non-negotiable)

The game is a **deterministic simulation, fully decoupled from the UI.**

- **Combat is a pure function** → event log → replay: `simulate(player, enemy, rng, cards)` returns
  `{ events, result, playerDamage, initial }`. The UI animates the event log on its own clock; it
  **never computes outcomes**.
- **One seeded RNG** (mulberry32) threaded through everything via `fork()`. **`Math.random` is
  banned** in `core`/`content`/`sim` (ESLint-enforced). This buys replays, shareable seeds, daily
  runs, and cheap exact balance sims.
- **Cards are data + effect subscriptions**, never bespoke classes. New cards = data only unless
  they need a genuinely new effect primitive.
- **Never mutate shared `CardDef`s** — clone into combat `Minion` instances.
- Recruit-phase effects (Battlecry, buff-on-summon, consume) bake into stats before combat; the
  combat simulator runs combat-time effects (Start-of-Combat, Deathrattle, on-shield-break,
  on-kill) and emits log events. Combat event vocabulary: `sc · attack · dmg · shield · shieldUp ·
  poison · reborn · death · summon · buff`.

## Monorepo

```
packages/core/     @game/core     pure engine: rng, types, event bus, effects, simulate()
packages/content/  @game/content  data-driven cards + threats, zod-validated   → core
packages/sim/      @game/sim       run loop: economy, shop, tiers, triples, scoring  → core+content  (M1)
packages/ui/       @game/ui        React + Zustand: recruit screen + combat arena      (M1)
packages/tools/    @game/tools     headless balance runner + combat harness       → core+content
apps/web/          Vite app wiring ui + sim                                              (M1)
```
`ui` depends on the others **through public package entrypoints only** — importing an internal
means the boundary leaked.

## Commands

- `npm install` — install workspace deps
- `npm run typecheck` — `tsc --noEmit` across all packages
- `npm test` — Vitest (determinism + golden + effect tests)
- `npm run harness` — headless combat: prints a narrated event log + proves determinism
- `npm run lint` — ESLint (incl. the Math.random ban)

## Collaboration (2 devs — Kevin + Mike, both using Claude Code)

Two people don't go 2× by typing faster (Claude already removed typing as the bottleneck) — the new
bottleneck is **coordination and integration**. The win comes from parallelizing along clean seams and
keeping `main` always-playable so neither dev ever blocks or breaks the other.

- **`main` is always playable + protected.** Never commit straight to `main` — open a PR. Every merge has
  passed CI (`.github/workflows/ci.yml`: typecheck + lint + test + build:web) and a quick review from the
  other person. Squash-merge (one clean, revertable commit per feature).
- **GitHub Flow, short branches.** One feature/fix = one branch = one PR, lived in hours-to-~2-days. Branch
  off latest `main`; rebase on `origin/main` at the start of a session and before pushing. Name by risk:
  `feat/…`, `fix/…`, `chore/…`, `refactor/…`.
- **Prove the checks ran.** Before claiming done: `npm run typecheck && npm run lint && npm test && npm run
  build:web` all green — report the result. CI re-checks, but don't make the other person wait on a red PR.
- **Scope discipline.** Stay inside the feature's files. No "while I was in there" refactors — propose those
  as their own PR. Read the diff before committing; never blind-commit Claude's output.
- **Serialize the hot files.** Don't have both devs/agents editing the same chokepoint at once. Announce
  ("taking `store.ts` for an hour") and rebase frequently. The most expensive conflicts live in:
  `packages/sim/src/state.ts` + `reducer.ts` (run state), `packages/core/src/types.ts` (shared types),
  `packages/ui/src/store.ts` (Zustand), `packages/sim/src/opponentPool.data.ts` (generated — never hand-edit;
  re-run `npm run pool`).
- **Keep the docs current** (devlog / roadmap / README) per the section below — same rule, both devs.

### Ownership map (the cheapest collision-avoidance — update as work shifts)

Split along the **simulation ↔ presentation** seam; meet only at the package entrypoints + shared types.
- **Kevin** — engine + content + run loop: `packages/core/**`, `packages/content/**`, `packages/sim/**`,
  balance tools (`packages/tools/**`).
- **Mike** — presentation: `packages/ui/**`, `apps/web/**` (React, GSAP, styles, audio).
- **Shared boundary (coordinate before changing):** `packages/core/src/types.ts` (combat event vocab,
  `CombatEvent`/`CombatResult`), the package public entrypoints, and any new card-data ↔ UI contract.

## Milestones

- **M0 — walking skeleton** ✓: core types + seeded RNG + event bus; Beasts + neutral glue;
  `simulate()` event log; headless determinism harness (`npm run harness`). Done.
- **M1 — vertical slice** *(in progress)*: ✓ run state machine + economy + 5 threats +
  deterministic wave/enemy generation + scoring + save/load; ✓ recruit-phase effect system
  (Battlecries / buff-on-buy / summon buffs) + combat Start-of-Combat effects; ✓ 2 tribes (Beasts,
  Dragons) + neutral glue; ✓ Battlegrounds hand + `play` action (buy→hand→play→board). ✓ **live
  recruit screen** — `@game/ui` (React + Zustand over `@game/sim`) + `apps/web` (Vite), Sunward look
  + pixel-art sprites, all actions wired; ✓ **combat arena** — replays the `simulate()` event log on
  its own clock (lunges, shield pops, poison kills, deaths, narrated verdict; UI never computes
  combat) via a `recruit → combat → advance` phase machine; ✓ **full playable loop** (recruit →
  Face the Omen → arena → Climb On → next wave / game over), verified live. Run: `npm run dev`;
  headless: `npm run bot`. M1's "is it fun / is it readable" slice is up. **Remaining for M1 polish:**
  click-to-target Hero Power, reposition (drag), a little combat juice.
- **M2 — content + balance** *(in progress)*: ✓ all 6 tribes + full card set (Beasts, Dragons,
  Undead, Mechs, Demons + neutral glue — Mech adds Divine-Shield/shield-break + Magnetic merge;
  Demon adds the recruit-time Consume system); ✓ headless **balance runner** (`npm run balance`)
  that probes the A.6 counter matrix with mono-tribe boards; ✓ **triples + Discover** (3 copies →
  golden 2×, peek 1-of-3 one tier up); ✓ **5 tribes per run** + active-tribe HUD; ✓ early-game
  **balance on-ramp** (enemy width/stats ramp in over waves 1–5 + gentler loss damage, so waves 1–3
  are winnable); ✓ a big **UX pass** — pointer-drag with snap-back + gold sell glow, custom
  gauntlet/hand cursors, keyword tooltips + terse mechanical text, fanned hover-pop hand, 1:1 combat
  cards, Hero-Power targeting line, 2× tavern controls, hero-sized Ember/Resolve panels, center-
  anchored warband, +15% card width. **Remaining:** the deeper counter-matrix tuning pass (the
  runner flags Mech dominant, Beast underpowered, Dragon/Undead flat — starting-dial work).
- **M3 — meta**: unlocks, ascension modifiers, daily seeds, save/replay.
- **M4 — juice & onboarding**: pacing polish, audio, VFX, tutorial, full accessibility + touch.

> The full Build Handoff v2 (exact card text/stats, threat templates, combat spec A.3, UX spec) was
> provided by the user in-session. Ask to vendor it into `docs/handoff.md` if you want it on disk.

## Dev log & roadmap (KEEP CURRENT — do this every commit)

Two living docs track the project's history and queue. **Every commit must update them:**

- **`docs/devlog.md`** — the detailed history. For each commit (or tight group of commits),
  prepend a dated entry: the commit subject, an extremely detailed description of *what changed and
  why* (engine/content/UI/balance), how it was verified (tests, harness, live DOM checks), and any
  follow-ups it created. Newest first. This is the "what was done" record — be thorough.
- **`docs/roadmap.md`** — the forward queue, broken down by milestone/section (M2 remaining, M3, M4)
  plus a Backlog/Ideas section. When you finish something, move it out of the queue (it's now in the
  devlog); when you discover new work, add it under the right section. Keep it honest and current.
- **`README.md`** — keep its **Recent changes** (the latest few highlights) and **Short-term
  roadmap** sections current, so the repo's front page shows at a glance what just changed and
  what's next.

The `## Milestones` list above stays a high-level summary; the granular, always-current queue lives
in `docs/roadmap.md`. Order of operations for a commit: make the change → update `docs/devlog.md` +
`docs/roadmap.md` + the README summary → commit them together.
