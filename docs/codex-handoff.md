# ASCENT — Handoff for Codex (code review + roadmap)

> **Purpose of this doc.** You (Codex) are being asked to do two things: **(1) review the codebase**
> for correctness, architecture, performance, and tech debt, and **(2) propose a forward roadmap**.
> This file is your single entry point — it tells you what ASCENT is, how it's built, the invariants
> you must not break, where everything lives, what we already know is weak, and how to frame your
> output so it's directly actionable for the team.
>
> **Audience:** the two devs (Kevin + Mike), both driving AI coding agents. Your output will be read
> by humans and fed back to agents. Optimize for *decisions*, not prose.

---

## 1. What ASCENT is

A **single-player roguelike auto-battler** (Hearthstone Battlegrounds-style). Loop:

```
Shop (recruit) → build a 7-slot board → fight an enemy board → survive → repeat, rising difficulty
```

- Score = waves survived. **Win condition:** survive to wave 20 (Victory); **lose** when Resolve (HP) hits 0.
- **Bounded engine:** 6 shop tiers, gold cap 10, board cap 7. A threat archetype is telegraphed before each shop.
- Enemies are **real captured player boards** (snapshots), not hand-authored — async-PvP-adjacent. A
  procedural curve is the fallback when the pool is thin.
- Two modes today: **Ascent** (the scored climb; writes snapshots, can hit the leaderboard) and
  **Practice** (any hero, unlimited Resolve, 3× clock, ends at round 15; reads real boards but never writes).

**Performance is the stated north star** — a frame drop, shop hitch, or drag stutter is treated as a
*defect*. See `docs/performance.md`. Keep this lens during review.

---

## 2. How to run / verify

```bash
npm install            # workspace install (npm workspaces monorepo)
npm run dev            # Vite dev server (apps/web) — the playable game
npm run typecheck      # tsc --noEmit across all packages
npm run lint           # ESLint (incl. a hard ban on Math.random in core/content/sim)
npm test               # Vitest: determinism + golden + effect + run tests (~400 tests)
npm run build:web      # production build (the real perf target — dev is much slower)
```

Headless / analysis tools (all in `packages/tools/`):

| Command | What it does |
|---|---|
| `npm run harness` | Narrated combat event log; proves determinism |
| `npm run bot` | Headless full-run loop |
| `npm run replay` | Proves the `(seed, heroId, actions)` replay is byte-identical |
| `npm run balance` | Probes the tribe↔threat counter matrix with mono-tribe boards |
| `npm run curve` / `npm run player` | Enemy-strength / player-strength curve tools |
| `npm run audit` | Card-pool audit (tribe/tier coverage vs targets) |
| `npm run perf` | Engine/logic perf harness |
| `npm run pool` / `pool:prune` | (Re)synthesize + rate + prune the committed opponent pool |

**Before claiming any change is done:** `typecheck && lint && test && build:web` all green.

---

## 3. Architecture — the non-negotiable invariants

The game is a **deterministic simulation, fully decoupled from the UI.** Treat these as hard rules
when reviewing; flag any violation as a bug, not a style nit.

1. **Combat is a pure function.** `simulate(player, enemy, rng, cards, …) → { events, result, playerDamage, initial, …carryBacks }`.
   It returns an **event log**; the UI *replays* that log on its own clock. The UI **never computes combat outcomes.**
2. **One seeded RNG** (mulberry32) threaded everywhere via `fork()`. **`Math.random` is banned** in
   `core`/`content`/`sim` (ESLint-enforced). This buys replays, shareable seeds, daily runs, cheap exact balance sims.
3. **Cards are data + effect subscriptions**, never bespoke classes. A new card = data only, unless it
   needs a genuinely new *effect primitive* (a factory). Effects subscribe to events
   (`onPlay·onSummon·onDeath·onAttack·onKill·startOfCombat·avenge·spellCast·…`).
4. **Never mutate shared `CardDef`s.** Clone into combat `Minion` instances. (Reviewers: watch for
   accidental shared-object mutation — it's the classic determinism/replay corrupter here.)
5. **Recruit-phase effects bake into stats *before* combat**; combat-time effects run inside `simulate`
   and emit log events. Permanent gains made *during* combat travel back to the run board via explicit
   **carry-back channels** on `CombatResult` (e.g. `playerSummonBonus`, `playerSpellPower`,
   `playerCardBuffs`, `playerImpBuffGain`, `playerFodderGrants`, `playerMaxGoldGain`, `playerPermaBuffs`,
   `playerUndeadBuyAtkGain`, …). This pattern is load-bearing — understand it before reviewing combat code.
6. **Auras** = run-wide buffs that follow a minion everywhere (board, shop, every combat body incl. Reborn/
   resummon). Two storage styles: aggregate (Undead Aura, Imp Aura) and per-card enchants (`cardBuffs`,
   e.g. Eternal Knight). See the big comment block at the top of `packages/core/src/combat/simulate.ts`.

### Performance rules that are easy to regress (verify in review)
- **Never animate paint properties in a loop** (`box-shadow`, `filter`, `drop-shadow`, `background`,
  `border-radius`). Animate `transform`/`opacity` only (compositor). Breathing glow = animate the
  `opacity` of a `::before` with a *static* shadow.
- **Don't read layout (`getBoundingClientRect`) per frame** — cache once per drag.
- **Memoize per-beat/per-frame list items**; keep their props referentially stable. `Unit` is `React.memo`'d with a value comparator.
- **Don't deep-clone large read-only state** (the reducer shares `lastCombat` by reference).

---

## 4. Monorepo map (~25k LOC TS/TSX)

```
packages/core/      @game/core     pure engine: rng, types, event bus, effect factories, simulate()
packages/content/   @game/content  data-driven cards + threats, zod-validated      → core
packages/sim/       @game/sim      run loop: economy, shop, tiers, triples, scoring → core+content
packages/ui/        @game/ui       React + Zustand: recruit screen + combat arena   → all (public entrypoints only)
packages/tools/     @game/tools    headless balance/curve/replay/perf harnesses     → core+content
apps/web/           Vite app wiring ui + sim
```

**Boundary rule:** `ui` imports the others only through public package entrypoints. Importing an internal
file = a leaked seam (flag it). The shared chokepoints (where the two devs coordinate):
`packages/core/src/types.ts` (combat event vocab + `CombatEvent`/`CombatResult`),
`packages/sim/src/state.ts` + `reducer.ts` (run state), `packages/ui/src/store.ts` (Zustand),
`packages/sim/src/opponentPool.data.ts` (generated — never hand-edit; re-run `npm run pool`).

### Where specific things live
- **Combat resolution:** `packages/core/src/combat/simulate.ts` (the heart) + `minion.ts` (instantiate/clone).
- **Effect primitives (combat):** `packages/core/src/effects/factories.ts` — one `EffectFn` per `do` id.
- **Effect primitives (recruit):** `RECRUIT_FACTORIES` in `packages/sim/src/recruit.ts`.
- **Card data:** `packages/content/src/cards/{beasts,dragons,undead,mechs,demons,neutral,spells,tokens}.ts`.
  Counts today: Beasts 14, Dragons 14, Undead 14, Mechs 13, Demons 15, Neutral 16, Spells 32, Tokens 11.
- **Schema (runtime validation, kept in lockstep with `types.ts`):** `packages/content/src/schema.ts`.
- **Run state machine + economy:** `packages/sim/src/{state,reducer,shop,recruit,threats,heroes,config}.ts`.
- **Snapshots / opponent pool / async-PvP foundation:** `snapshot.ts`, `opponents.ts`, `synthesize.ts`,
  `rating.ts`, `opponentPool.data.ts` in `packages/sim/src`.
- **UI store + capture/upload:** `packages/ui/src/store.ts`; backend seam `remoteBoards.ts`; local pool
  `boardLibrary.ts`. Backend design in `docs/board-backend.md` + `docs/board-pool.md`.
- **Combat replay clock:** `packages/ui/src/{useCombatReplay,combatBeats,turnClock}.ts`.
- **Art:** `packages/ui/src/art.ts` (eager `import.meta.glob` keyed by card id) + `art/minions/<id>.webp`.
  Masters live out-of-repo at `C:\Game Assets\Ascent Art\`; `npm run optimize-art` converts PNG→WebP.
  **Gotcha:** the glob is eager — adding art needs a full dev-server *restart*, not a reload.

### Docs worth reading before reviewing a given area
- `CLAUDE.md` — the canonical project rules (locked vs open decisions, ownership map, collaboration).
- `docs/devlog.md` — detailed dated history (newest first). The "why" record.
- `docs/roadmap.md` — the live forward queue (patches 1–5, backlog).
- `docs/performance.md` — the perf playbook + established anti-patterns.
- `docs/balance-handoff.md` — balance direction + the §9 deeper-design notes.
- `docs/board-pool.md` / `docs/board-backend.md` — opponent pool + backend.

---

## 5. What we already know is weak (don't just re-report these — go deeper)

**Balance (the live priority):**
- Counter matrix is *truth* but stat dials are off: the runner flags **Mech dominant, Beast underpowered,
  Dragon/Undead flat**. Card stat numbers are starting dials, not locked.
- **T1–4 relevance:** early cards fall off hard mid-game. We want scaling payoffs / recombination / triple
  value so they stay relevant.
- **Decision diversity:** cross-tribe value engines wash out tribe identity; builds converge. We want more
  meaningfully different paths to a strong board.
- Target curve: a satisfying run is ~15+ rounds with real decisions.

**Content depth:** pool target is **13–15 minions per tribe** (variety is meant to come from the *meta
layer* — heroes + quests/trinkets — not raw card volume). Some tribes are at/near target; check `npm run audit`.

**Tech debt (from `docs/roadmap.md`, none urgent):**
- `Recruit.tsx` (~1.4k lines) — split into Shop/Hand/Board if it passes ~1.5k.
- `run.test.ts` (~1.3k) — split into per-area suites as it grows.
- `reducer.ts` — consider sub-reducers if many new actions land.
- Documented-but-deferred: ~20 inert dead effect-factory ids (~190 lines), a `quiet`/odds-only `simulate()`
  flag (the biggest alloc win for balance sims), a few shareable helpers.

**Matchmaking:** `pickOpponent` still matches by `Σ(atk+hp)` power only. Ratings are now trustworthy per
wave (the synthetic all-wave pool), so the intended next step is matching by `(wave, band)`.

---

## 6. Your review — what we want from you

Please produce a **prioritized findings report**, not a file-by-file walkthrough. For each finding give:
**severity** (blocker / high / medium / low), **location** (`path:line`), **what's wrong**, **why it
matters**, and a **concrete fix sketch**. Group by theme. Suggested lenses, in priority order:

1. **Correctness / determinism** — anything that could break replay byte-identity or cross the
   pure-combat boundary: shared-`CardDef` mutation, `Math.random` leaks, UI computing outcomes, RNG used
   off the seeded stream, carry-back channels that drop or double-apply gains, aura double-dips, golden
   (triple) magnitude bugs. **This is the highest-value area** — determinism bugs are silent and corrosive.
2. **Combat edge cases** — Reborn/Divine-Shield/Venomous/Windfury/Cleave/Reattack/attack-on-summon
   interactions, board-overflow handling, mid-combat ascension, the iteration/reattack guards. Look for
   ordering bugs and infinite-loop risks.
3. **Performance** — against the rules in §3 and `docs/performance.md`. Per-frame layout reads, paint-
   property animation, unstable React props, avoidable clones/allocations in the combat hot path.
4. **Architecture / seams** — leaked package internals, the shared chokepoints, schema vs `types.ts`
   drift, places where "data-only card" has quietly become bespoke code.
5. **Tech debt / simplification** — dead code (start with the ~20 inert factory ids), oversized files,
   duplication, test coverage gaps around carry-backs and aura application.

Constraints to respect in any fix you propose: the **locked** items in `CLAUDE.md` (economy, combat
resolution spec, card set identity, threat archetypes, the tribe↔threat counter matrix) are build-to-spec —
propose tuning *dials*, not rule rewrites, unless you're flagging an actual spec contradiction.

---

## 7. The roadmap we want you to build out

There's an existing patch sequence in `docs/roadmap.md` (Patch 1 Balance & Content → 2 Front Door & Hero
Roster → 3 Meta Progression → 4 Onboarding & Game Feel → 5 Reach & Release). **Don't replace it blindly** —
read it, then give us:

- **A critique of the current sequence** — is the ordering right given what the code can actually support
  today? What's underspecified? What's secretly blocked on something else?
- **A concrete, sequenced backlog** for the next ~2–3 milestones, each item with: a one-line goal, the
  files/systems it touches, rough size (S/M/L), dependencies, and a "definition of done." Favor items that
  parallelize cleanly along the **simulation ↔ presentation** seam (Kevin owns core/content/sim/tools;
  Mike owns ui/web).
- **A few "10x" bets** — higher-leverage directions worth considering even if not on the current list
  (e.g. the meta layer of heroes + quests/trinkets that's supposed to carry variety; the async-PvP track;
  a balance-autotuning loop on top of the existing sims).
- **Risks & unknowns** — call out where you're guessing and what you'd want to confirm with the team.

### Open questions you'll likely hit (flag your assumptions)
- How hard should the late game (waves 12–20) be against strong *real* player boards vs the synthetic curve?
- Meta progression (unlocks/ascension/dailies) is **PvE-only**; async-PvP "progression" is a separate
  rating ladder. Keep them un-conflated — does the current code make that easy?
- The pool stays deliberately small; variety is meant to come from heroes + quests/trinkets (not yet built).
  Is that the right bet, and what's the minimum viable version of that meta layer?

---

## 8. Working norms (so your output lands cleanly)

- **`main` is protected & always-playable.** All changes go through PRs (squash-merge, CI must be green:
  typecheck + lint + test + build:web). If you propose changes, scope them as small, single-purpose PRs.
- **Keep the docs current** — any shipped change updates `docs/devlog.md` (prepend dated entry) +
  `docs/roadmap.md` (move the item out of the queue) + the README's Recent-changes/roadmap blurbs.
- **Scope discipline** — no "while I was in there" refactors mixed into a feature; propose them separately.
- Deliver the review + roadmap as **markdown we can drop into `docs/`** (e.g. `docs/codex-review.md` and
  an updated/annotated `docs/roadmap.md` proposal).
```
