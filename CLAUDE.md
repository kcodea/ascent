# ASCENT

Deterministic, **asynchronous auto-battler**. Battlegrounds-style loop: a shop phase (recruit + build a
7-slot board) alternating with auto-resolved combats — inside an **eight-seat elimination lobby**. Seat 0 is
the live player; the other seats are independently developed runs (recorded player snapshots, generated
hybrids, bots, or authored tutorial seats). Surviving seats are paired each round, **one authoritative
`simulate()` resolves each encounter and supplies BOTH sides' damage**, Armor absorbs before Resolve, and a
seat at zero is eliminated. **Final placement drives the ladder Rating.** Asynchronous by design: it never
requires two players online at once.

> ⚠️ **The 17-round course and the Line/Oath success contract are RETIRED.** `CONFIG.courseRounds`,
> `defaultLine`, `calibrationRounds`, `metLine` and friends still exist and are still read by tools, older
> replays and non-lobby modes — but the lobby has no course clock (`advanceCombat`'s victory branch excludes
> lobby mode) and no Line verdict. **Never infer current behaviour from a legacy symbol alone.** The lobby's
> `maxRounds: 60` is a stalemate backstop, not a course length.

> **This file is the engineering + agent-workflow contract only.** The game's *rules* (lobby structure,
> placement/rating, Resolve, quests, runes, matchmaking, terminology) live in
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
- **Nothing runs cold on first use — the boot pays for it** (owner ruling 2026-09-03). Every image, font,
  clip, shader and effect is loaded/fired behind the boot screen (`packages/ui/src/bootLoader.ts`,
  `fx/warmAll.ts`). The rule is machine-enforced: a new `public/` file needs `npm run assets:manifest`
  (`publicAssets.test.ts`), a new font weight goes in `FONT_FACES` (`fontsPreload.test.ts`), a new pixiFx fire
  method must be fired in `warmAll.ts` (`warmAll.test.ts`), a new committed def is covered by construction,
  and art/audio globs are automatic. Prove it, don't assert it: `window.__boot.stages.fx.note` after boot
  ("re-fire long tasks: 0") and `window.__perf.hitches()` after a run. See `docs/performance.md` §3e.

## UI conventions

**The game paints a custom cursor** (the gauntlet SVGs in `public/cursors/`), wired in `styles.css`: `body`
sets the default, and one rule gives `.card, .btn, button, [role="button"]` the "open" gauntlet pointer. So
**never put a bare `cursor: pointer` (or any plain keyword cursor) on an interactive element** — a class
selector out-specifies the global `button` rule and swaps the game cursor back to the OS arrow, which reads as
the cursor "breaking" on that control (owner report 2026-08-24, hit on the Patch Notes ✕). Let the global rule
paint it, or, when an element genuinely needs its own cursor, use the gauntlet URL form
(`cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer`). Check any new button/overlay for this before
shipping.

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
- **Cards live in SETS.** A set is the pool a run draws from, flipped live like rifts
  (`packages/content/src/sets.ts`); a run PINS its set at creation and reads it via `poolOf(state)` forever
  after, so flipping the switch never changes an in-flight or replayed run. `activeSet()` belongs to
  `createRun` and nowhere else; `CARD_INDEX` stays global (id→def needs no set). New cards go in that set's
  own `cards/<set>/` directory. See [`docs/card-sets.md`](docs/card-sets.md).
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

### Repo skills (`.claude/skills/ascent-*`)

Four skills carry the depth this file deliberately leaves out — they load only when the work matches, so this
file stays short:

- **`ascent-gameplay`** — effects, keywords, hero powers, reducer/simulator paths, and especially **effect
  wiring** (one ability fired through another's trigger), with the interaction matrix.
- **`ascent-content`** — authoring cards/runes/quests/heroes, pool + set membership, art wiring.
- **`ascent-lobby`** — the 8-seat lobby, pairing, placement/Rating, snapshots, and replay v2.
- **`ascent-choreography`** — beats, the Choreographer, Pixi FX, and consequence timing.

They are **source, tracked in git**, unlike installed skill packages (which `.gitignore` still excludes). When
a rule in a skill stops being true, fix it in the same PR as the behaviour change.

## Commands

- `npm install` — install workspace deps
- `npm run typecheck` — `tsc --noEmit` across all packages: `typecheck:pkgs` (engine: core/content/sim/tools)
  then `typecheck:web` (presentation: `@game/ui` + `apps/web`, which need the DOM/JSX lib). Both are gated in
  CI as separate steps. `build:web` is a Vite/esbuild transpile and does **not** typecheck — this is the gate.
- `npm test` — Vitest (determinism + golden + effect tests)
- `npm run harness` — headless combat: prints a narrated event log + proves determinism
- `npm run lint` — ESLint (incl. the `Math.random` ban)
- `npm run docbot` — Doc Bot's correctness report (phase gaps, live-text + tribe-predicate + derivation tripwires) — see [`docs/docbot.md`](docs/docbot.md)
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
>
> **Run `npm install` INSIDE a new worktree before you trust a local `typecheck`/`test`.** A fresh worktree has
> no `node_modules` of its own, so every `@game/core` / `@game/sim` / `@game/content` import resolves through
> the ROOT symlinks — which point at the **primary checkout's** `packages/*`, on whatever branch that happens
> to be sitting on. Your own `packages/ui` edits still load (they are relative imports), so the run looks
> healthy while silently checking against someone else's in-progress engine. It surfaces as errors in files you
> never touched, which reads exactly like "`main` is broken" when `main` is fine (hit 2026-08-07 — three
> phantom `runeChef` errors from a checkout parked on an unrelated branch). One install per worktree fixes it
> for good. CI is unaffected: it clones clean and installs.

- **`main` now requires a green `verify` check to MERGE — but the discipline below is still the real guard.**
  As of 2026-08-12 a base-branch policy blocks merging a PR into `main` until the required **`verify`** status
  check (the CI workflow: typecheck + lint + test + build:web) passes: `gh pr merge` fails with *"the base
  branch policy prohibits the merge"* / *"Required status check 'verify' is in progress"* until it is green.
  This is NEW — it was verified ABSENT on 2026-08-05 and added since. It is not visible through the classic
  protection API (`branches/main/protection` still 404s) or the repo rulesets endpoint (`rulesets` and
  `rules/branches/main` return `[]`), so it is most likely an ORG-level ruleset — do NOT conclude
  "unprotected" from those empty endpoints. What is NOT confirmed: whether the policy also blocks a *direct
  push* or *force-push* to `main` (untested — don't try it). So keep every rule below as hard regardless; the
  server gates the merge, the discipline gates everything else.
  - **Never commit or push straight to `main` — open a PR.** Squash-merge (one clean, revertable commit per
    feature). Never force-push `main`.
  - **CI `verify` is now a REQUIRED gate.** `.github/workflows/ci.yml` (typecheck + lint + test + build:web)
    runs as the `verify` check and MUST be green before a PR can merge. After you push, `gh pr checks <n>
    --watch` until `verify` passes, then merge. It can briefly report *"no checks"* for a minute or two before
    `verify` starts — that is not "CI disabled", just not-yet-started; wait and re-poll.
  - **Claude MAY merge from the CLI** once `verify` is green — `gh pr merge --squash` then works with no
    override. Anything `gh` does is attributed to the authenticated owner, so "a review from the other person"
    is a convention between the two of you, not something the repo can check. Ask first when the change is
    risky. Do NOT reach for `--admin` to bypass a pending `verify`: the harness safety classifier blocks
    `--admin` merges anyway, and the check just needs to finish (hit 2026-08-12).
  - **`gh pr merge --delete-branch` can report failure AFTER a successful merge.** It merges server-side,
    then tries to check `main` out locally — which fails when a worktree already holds it
    (`fatal: 'main' is already used by worktree at …`). Confirm with `gh pr view <n> --json state,mergedAt`
    before assuming the merge didn't land, and clean the branch up by hand.

  *The `verify` check is now enforced (above), so red PRs can no longer merge. What is still NOT machine-
  enforced (as far as tested): the "open a PR, never push straight to `main`" rule and "squash-merge" — those
  remain discipline. If you want those enforced too, an explicit `main` ruleset requiring a PR would close the
  gap.*
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

## Documentation — update it when its CONTRACT changes, not on every commit

The old rule was "every commit must update devlog + roadmap + README." It was replaced on 2026-08-20 because
it cost more than it bought: it produced churn on trivial commits, and — since every devlog entry prepended to
the same line of one file — it made a merge conflict *inevitable* between any two same-day sessions. Update
each doc when the thing it describes actually changes:

- **`docs/devlog/`** — a NEW FILE per entry (`YYYY-MM-DD-slug.md`; see
  [`docs/devlog/README.md`](docs/devlog/README.md)). Write one for **meaningful shipped work, migrations,
  owner decisions, and non-obvious fixes** — what a future session would otherwise re-derive. Not for typos,
  lint, or dependency bumps. **Never prepend to `docs/devlog.md`** — that file is the archive through
  2026-08-20, and prepending is exactly what made concurrent work conflict.
- **`docs/roadmap.md`** — only when priority or status actually moves. Finishing something means deleting it
  here (the devlog is the history); discovering work means adding it.
- **`README.md`** — setup, product identity, and major user-facing capabilities. It is **not** a per-commit
  changelog; keep *Recent changes* to a few genuine headlines and let the devlog carry the rest.
- **`docs/GAME-RULES.md`** and the architecture docs — whenever player-facing behaviour or an architectural
  contract changes. This is the one that must never lag: a stale rules doc makes agents wrong, not just
  uninformed.
- **Content counts are GENERATED, never hand-maintained** — see [`docs/CONTENT.md`](docs/CONTENT.md).
- **`packages/ui/src/patchNotes.ts` — the PLAYER-FACING gameplay changelog** (title-screen Patch Notes button).
  Whenever a GAMEPLAY change ships — a new/changed hero, card or rune, or an in-game UI/information change —
  PREPEND a plain-English, spoiler-light entry in the SAME PR (owner ask 2026-08-24). Non-gameplay work
  (build, tests, docs, refactors, dev tools) does NOT go here. This is enforced by convention, not a test.

summary → commit them together.
