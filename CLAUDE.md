# ASCENT

Single-player roguelike auto-battler. Battlegrounds-style loop: a shop phase (recruit + build a board)
alternating with auto-resolved combats against a **17-round course** of enemy boards. The central success
contract is **covering the rating-driven Line**; surviving the whole course is an additional achievement.

> **This file is the engineering + agent-workflow contract only.** The game's *rules* (course structure,
> Line/rating, Resolve, quests, runes, matchmaking, terminology) live in
> [`docs/GAME-RULES.md`](docs/GAME-RULES.md); current content counts in [`docs/CONTENT.md`](docs/CONTENT.md);
> the forward queue in [`docs/roadmap.md`](docs/roadmap.md); the detailed history in
> [`docs/devlog.md`](docs/devlog.md). Keep game-design facts *out* of this file so it can't go stale.

## Performance is the north star

**The game must feel snappy at ALL times — this is fundamental to the feel of play, above all else.**
Treat a frame drop, a shop hitch, or drag stutter as a *defect*, not a polish item. When a change could
cost performance, **measure it before shipping** (`npm run perf` for engine/logic; Chrome DevTools for
render/paint). The full playbook — the headless harness, the manual render-profiling routine we run
together, and the established anti-patterns — lives in [`docs/performance.md`](docs/performance.md). The
load-bearing rules:

- **Don't animate paint properties in a *looping* animation** (`box-shadow`, `filter`, `drop-shadow`,
  `background`, `border-radius`) — they repaint every frame. Animate `transform`/`opacity` only
  (compositor-only). For a breathing glow, animate the **opacity** of a `::before` with a *static* shadow
  (see `kwglow` in `styles.css`). A short **one-shot** transition/animation may touch paint properties if
  profiled (e.g. the `cardbuff` / `questbounce` pops).
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

## Architecture (non-negotiable)

The game is a **deterministic simulation, fully decoupled from the UI.**

- **Combat is a pure function** → event log → replay: `simulate(playerSide, enemySide, rng, cards)` returns
  `{ events, result, playerDamage, initial }` (each side is a `CombatSideState`). The UI animates the event
  log on its own clock; it **never computes outcomes**.
- **One seeded RNG** (mulberry32) threaded through everything via `fork()`. **`Math.random` is banned** in
  `core`/`content`/`sim` (ESLint-enforced). This buys replays, shareable seeds, daily runs, and cheap exact
  balance sims.
- **Cards are data + effect subscriptions**, never bespoke classes. New cards = data only unless they need a
  genuinely new effect primitive (add it to the factories + whitelist it in the content schema + the
  `EffectFactoryId` union).
- **Card text ALWAYS shows the CURRENT value of what the card is doing — a hard default, not a special case**
  (owner rulings 2026-07-02, reaffirmed 2026-07-08). Whenever a card's magnitude depends on live run/combat
  state (quests, tallies, auras, per-N improvements, spell power, Gold spent this turn, a per-spell / per-summon
  scaler, an escalating cast count, per-instance spell progress, …), the printed text must fold in the **actual
  number it will produce right now** — plus the countdown to the next step when there is one — never a static
  placeholder or the base rate alone. Wire it via the `cardText.ts` helpers into BOTH chains: `liveCardText`
  (shop / board / hand / Discover / end screen) and `Unit.tsx` (combat). A stale or base-only printed number
  is a **defect** — add the helper in the same PR that adds the scaling effect. When the live value simply
  equals a stat already shown in a corner badge (e.g. "deals its Attack"), referencing that stat by name is
  an acceptable way to stay current. (A sanctioned exception: a minion that *casts a named spell* may name the
  spell and let the spell's hover-preview show its live value, instead of restating it — owner ruling 2026-07-15.)
- **Never mutate shared `CardDef`s** — clone into combat `Minion` instances.
- Recruit-phase effects (Battlecry/Shout, buff-on-summon, consume) bake into stats before combat; the combat
  simulator runs combat-time effects (Start-of-Combat, Deathrattle/Echo, on-shield-break, on-kill) and emits
  log events. Combat event vocabulary lives in the `CombatEvent` union in `packages/core/src/types.ts` — that
  union is the source of truth for the event count (don't hardcode a number in docs).
- **Opponents are pinned.** Each run records the exact board it fought every wave (`servedBoards`) so a
  restored/replayed run serves those verbatim; matchmaking is wave-first + source-prioritized (see
  `docs/GAME-RULES.md` / `packages/sim/src/opponents.ts`).

## Monorepo

```
packages/core/     @game/core     pure engine: rng, types, event bus, effects, simulate()
packages/content/  @game/content  data-driven cards + threats + quests + runes, zod-validated   → core
packages/sim/      @game/sim      run loop: economy, shop, tiers, triples, scoring, quests/runes  → core+content
packages/ui/       @game/ui       React + Zustand: recruit screen + combat arena                  → all
packages/tools/    @game/tools    headless balance runner + combat harness                        → core+content
apps/web/          Vite app wiring ui + sim
```
`ui` depends on the others **through public package entrypoints only** — importing an internal means the
boundary leaked.

## Commands

- `npm install` — install workspace deps
- `npm run typecheck` — `tsc --noEmit` across all packages
- `npm test` — Vitest (determinism + golden + effect tests)
- `npm run harness` — headless combat: prints a narrated event log + proves determinism
- `npm run lint` — ESLint (incl. the `Math.random` ban)
- `npm run build:web` — production build (the CI gate + what players actually run)
- `npm run dev` — live dev server

## Collaboration (2 devs — Kevin + Mike, both using Claude Code)

> New to the repo? Start with [`ONBOARDING.md`](ONBOARDING.md) (clone → install → verify → the rules).
>
> **Running several sessions at once? Read [`docs/concurrency.md`](docs/concurrency.md) FIRST.** The one rule
> that prevents most pain: each active session works in **its own worktree/clone off latest `origin/main`** and
> touches nothing else's — never another session's worktree, branch, or the shared primary checkout. Commit +
> push early (origin is the only durable copy), keep branches tiny, take `main` in often, and split by ownership
> seam so two sessions never edit the same file.

- **`main` is always playable + protected.** Never commit straight to `main` — open a PR. Every merge has
  passed CI (`.github/workflows/ci.yml`: typecheck + lint + test + build:web) and a quick review from the other
  person. Squash-merge (one clean, revertable commit per feature). Branch protection requires a review that
  can't be satisfied solo, so **Claude can't merge from the CLI — the owner merges.**
- **GitHub Flow, short branches.** One feature/fix = one branch = one PR, lived in hours-to-~2-days. Branch off
  latest `main`; rebase on `origin/main` at the start of a session and before pushing. Name by risk: `feat/…`,
  `fix/…`, `chore/…`, `refactor/…`, `docs/…`.
- **Prove the checks ran.** Before claiming done: `npm run typecheck && npm run lint && npm test && npm run
  build:web` all green — report the result.
- **Scope discipline.** Stay inside the feature's files. No "while I was in there" refactors — propose those as
  their own PR. Read the diff before committing; never blind-commit Claude's output.
- **Serialize the hot files.** Don't have both devs/agents editing the same chokepoint at once. Announce and
  rebase frequently. The most expensive conflicts live in: `packages/sim/src/state.ts` + `reducer.ts` (run
  state), `packages/core/src/types.ts` (shared types), `packages/ui/src/store.ts` (Zustand),
  `packages/sim/src/opponentPool.data.ts` (generated — never hand-edit; re-run `npm run pool`).

### Ownership map (the cheapest collision-avoidance — update as work shifts)

Split along the **simulation ↔ presentation** seam; meet only at the package entrypoints + shared types.
- **Kevin** — engine + content + run loop: `packages/core/**`, `packages/content/**`, `packages/sim/**`,
  balance tools (`packages/tools/**`).
- **Mike** — presentation: `packages/ui/**`, `apps/web/**` (React, GSAP, styles, audio).
- **Shared boundary (coordinate before changing):** `packages/core/src/types.ts` (combat event vocab,
  `CombatEvent`/`CombatResult`), the package public entrypoints, and any new card-data ↔ UI contract.

## Dev log & roadmap (KEEP CURRENT — do this every commit)

Two living docs track history and queue. **Every commit must update them:**

- **`docs/devlog.md`** — the detailed history. For each commit (or tight group), prepend a dated entry: the
  subject, a detailed description of *what changed and why* (engine/content/UI/balance), how it was verified
  (tests, harness, live DOM checks), and any follow-ups. Newest first.
- **`docs/roadmap.md`** — the forward queue (Now / Next / Later / Parked / Public Release). When you finish
  something, move it out (it's now in the devlog); when you discover new work, add it under the right section.
- **`README.md`** — keep its **Recent changes** (latest few highlights) and **Short-term roadmap** current, so
  the repo's front page shows at a glance what just changed and what's next.

Order of operations for a commit: make the change → update `docs/devlog.md` + `docs/roadmap.md` + the README
summary → commit them together.
