# Production bots — handoff (2026-07-29)

Where the PvE bot system stands, what's proven, what's still broken, and what to do next.

Branch `feat/production-bots-ticket0` → **[PR #748](https://github.com/kcodea/ascent/pull/748), open, unmerged.**
All gates green: typecheck, lint (0 errors), 2941 tests / 154 files, `build:web`, `harness` (determinism ✓).

---

## The one-paragraph version

There is now a real bot system — a planning-safety boundary, an exhaustive action catalog, a fight-grounded
evaluator, bounded beam search, four difficulty tiers — and it is wired into the lobby. Against *synthetic*
opposition it is a large gain over the old greedy bot (4.83 wins vs 2.10; 13 of 40 runs survive the course vs
1). Against **real player boards it is not**: every tier lands at 3.2–3.9 wins, nothing survives the course,
and legacy is statistically indistinguishable from expert. The system is sound; the evaluator is optimizing
against the wrong opposition. That is the next problem, and it is not a search-depth problem.

---

## What shipped

| Ticket | What | Where |
|---|---|---|
| 0 | Planning-safety boundary + rules identity | `packages/sim/src/productionBots/{transition,visibleState,rulesIdentity}.ts` |
| 1–2 | Bot shell + exhaustive legal-action generation | `{controller,actionCatalog,legalActions}.ts` |
| 4–5 | Fight-grounded evaluator + bounded beam search | `{evaluate,fightScore,search,difficulties}.ts` |
| 8 | Measurement harnesses | `packages/tools/src/{bot-ladder,lobby-ladder,fetch-boards}.ts` |
| — | Production bots actually driving lobby seats | `packages/sim/src/lobby/seats.ts` (`SeatPolicy`) |

**Ticket 3 (card profiles / package graph) was never built** and I'd argue it shouldn't be as specified — see
Open questions.

### The load-bearing design rules

- **`transition.ts` is the only module allowed to call `reduce()`.** Everything speculative happens behind a
  planning handle that clones the parent first; handles are released or the tests fail on a leak.
- **Bots see `BotVisibleState`, a curated projection**, not `RunState`. It withholds `seed`, `rngCursor`,
  `servedBoards`, `lastCombat`, `scoutedNextOpponent` and every `*Fx*` field. Difficulty is *budget, never
  information* — an Easy bot plays the same game with the same shop, it just thinks less.
- **The action catalog is `satisfies Record<Action['type'], ActionDescriptor>`**, so a new reducer action
  fails compilation rather than being silently never played.
- **A board is scored by fighting with it** (`fightScore.ts`), not by stat proxies. This was the single
  biggest quality gain and it's why the keyword-value tables and board-width curves are gone.

---

## The numbers

### Ascent mode — 40 seeds, hero drakko

`r17` = reached round 17 · `survived` = finished the course alive · par (the Oath) is **9 wins**

| tier | wins vs synthetic | r17 | survived | wins vs REAL players | r17 | survived |
|---|---|---|---|---|---|---|
| legacy | 2.10 ±0.40 | 1 | 1 | 3.33 ±0.22 | 0 | 0 |
| easy | 3.25 ±0.65 | 9 | 8 | 3.17 ±0.29 | 0 | 0 |
| normal | 3.50 ±0.69 | 9 | 9 | 3.42 ±0.33 | 0 | 0 |
| hard | 4.10 ±0.70 | 10 | 10 | 3.75 ±0.33 | 0 | 0 |
| expert | 4.83 ±0.72 | 14 | 13 | 3.88 ±0.34 | 0 | 0 |

### Lobby mode — 12 lobbies, 8 seats, mean length 17.8 rounds

Placement 1 = won the lobby, 8 = eliminated first. (Synthetic-pool opposition — the human-pool equivalent has
not been run.)

| policy | mean placement | lobby wins | top half |
|---|---|---|---|
| legacy | 6.33 ±0.30 | 0 | 13% |
| easy | 5.08 ±0.49 | 2 | 38% |
| normal | 4.08 ±0.40 | 2 | 58% |
| expert | 3.38 ±0.52 | 8 | 71% |

---

## The problem to solve next

**Against real player boards the difficulty ladder does not separate.** Legacy 3.33 ±0.22 against expert
3.88 ±0.34 is ~1.4σ. Four tiers of search budget produce one bot.

The mechanism is visible in the tier column: production bots finish at tier **4.1–5.0**, legacy at **5.6**.
They build tall-and-cheap boards. That is a *correct* optimization against the procedural threat curve, which
is banded to a power target — and a losing one against human boards, which have **synergy**: the package a
real player assembles beats its own stat-line.

`fightScore` scores candidates against that same procedural curve. So the evaluator has been optimizing for
precisely the opposition that turns out to be the easy case, and the whole measured gain evaporates when the
opposition is real.

**Next step:** point `fightScore` at the human pool (664 boards, now loadable) instead of `buildEnemyBoard`,
then re-derive difficulty against it. Watch the cost — `fightScore` runs inside the search loop, and the
performance budget is in `docs/performance.md`. Sampling a handful of wave-matched human boards per
evaluation is probably the shape; the current panel is 5 archetypes at 0.19ms.

---

## Tooling

```bash
npm run bot:ladder                    # Ascent mode vs the committed synthetic pool
npm run bot:ladder -- --human         # ...vs real player boards (needs boards:fetch first)
npm run bot:ladder -- --procedural    # ...vs no pool at all — the evaluator's own panel
npm run bot:ladder -- --seeds 40 --diagnose
npm run boards:fetch                  # cache the Supabase player pool → packages/tools/.cache (gitignored)
npm run lobby:ladder                  # lobby mode: 8 seats, placement per policy
```

**Every ladder run prints what it fought.** That line is not decoration — see the bug list.

---

## Bugs worth not repeating

Each of these produced a confident wrong number, and in every case the symptom pointed somewhere else.

1. **The fight panel was seeded from the board being scored.** Board A fought enemies from seed(A), board B
   from seed(B) — so the scores were measured against *different opponents* and comparing them was
   meaningless. Search ranked boards by noise. Symptoms: skill *fell* as the bot searched deeper, and a 0.40
   blunder rate outscored 0.00. Picking the best of a noisy comparison is worse than picking at random.
2. **The blunder picked from the pruned beam**, which at `beamWidth: 1` *is* the best node. The roll fired,
   found nothing, and all four difficulties played byte-identically — four identical rows in the ladder.
3. **The ladder never registered the opponent pool.** `OPPONENT_POOL` ships empty and only
   `packages/ui/src/store.ts` loads it, so every measured fight fell through to `buildEnemyBoard` — the same
   generator `fightScore` scores with. Train-on-test. This produced a reported 9.10 wins that was really 5.60.
4. **The lobby never ran the production bots.** `botSeat` hardcoded `DEFAULT_BOT`, so the whole system was
   built, tuned and measured in Ascent mode and never reached the mode it exists for.
5. **The ladder measured the wrong mode.** Lobby runs have no course clock, fight other seats rather than the
   pool, and are scored by placement — "par 9 wins covering the Oath" doesn't exist there.
6. **Inverted waste penalty** — gold above the cheapest offer counted as wasted, so *gaining* gold scored as a
   loss. Every bot at every difficulty finished with an empty board.
7. **Depth made bots worse** (2.50 → 1.25 wins) via plan-then-abandon: search scored the end of a multi-action
   plan, then the bot committed one action and re-searched. Fixed with queued plans + per-step
   `fromFingerprint`.
8. **Search read the future** — a reveal child was scored on the *actual* refreshed shop. Now
   `expectedAfterRefresh` scores it as the same state with the gold spent.
9. **`forcedSpend` played `hand[0]` blindly**; the reducer refuses targeted spells, the loop died, and runs
   "finished" at 3.5 rounds. Now every option is validated through `applyCandidate`.

**The meta-lesson: state the opposition, and put an error bar on it.** Bugs 1, 3, 4 and 5 all had the same
shape — a number that was real, measured against something other than what I believed. Two earlier evaluator
"improvements" were also shipped on 10-seed samples and both were regressions; stderr there is ±0.6 wins,
larger than every difference being reasoned about.

---

## Difficulty, as it stands

All four tiers are the **same search config**, scaled only by `blunderRate` (0.45 / 0.22 / 0.08 / 0). Depth,
beam width and positioning effort all measured *anti*-correlated with skill, so scaling them builds a ladder
that runs backwards. `bots.test.ts` asserts the blunder rate is the dial that moves; the budget dials are
deliberately equal, and that's commented at the assertion.

This is honest but it is a placeholder. Once the evaluator is strong enough to reward depth, depth should
become the dial again — the machinery is intact and it's a one-line change.

---

## Open questions for the owner

1. **Ticket 3 (card profiles + package graph).** The 314-entry registry was designed to *guess* board quality;
   `fightScore` answers it directly. I'd skip it — but a synergy-aware *search prior* (as opposed to a value
   table) may be exactly what closes the human-board gap. Worth deciding before anyone builds it.
2. **Personas** ("custom personas so they don't build the same thing every game"). Still unbuilt, and I'd
   hold: there's no point diversifying bots whose four tiers are statistically one bot. Plan when it's time:
   seeded evaluator weight multipliers + tribe/keyword affinity, with a board-divergence metric added to
   `lobby:ladder` so "they don't all build the same thing" is measured, not asserted.
3. **Strength limiting.** Deferred for the same reason — nothing needs capping yet.
4. **A human baseline.** Every number here is relative: bots vs bots, or bots vs recorded boards. Nobody has
   measured a bot against *you playing*. Mean placement 3.38 says expert beats the other seats; it does not
   say it would trouble a good player. A few lobbies at Expert would tell us whether it's a threat or a speed
   bump — and that's the target personas and strength-limiting should be tuned against.
5. **Deferred by owner until bot work lands:** wiring real player snapshots into lobby seats, and whether
   lobby placement feeds Renown.

---

## Files

```
packages/sim/src/productionBots/
  types.ts           BotVisibleState, PlanningStateHandle, RevealBoundary, RulesIdentity
  visibleState.ts    toBotVisibleState, fingerprint — the redaction boundary
  transition.ts      THE ONLY reduce() caller: createPlanningRoot, applyCandidate, release
  rulesIdentity.ts   rulesHashFor(setId), assertIdentity
  actionCatalog.ts   exhaustive Action['type'] coverage, enforced at compile time
  legalActions.ts    mandatory / recruit / positioning candidates
  evaluate.ts        weighted breakdown; fightStrength dominates at 44
  fightScore.ts      score a board by FIGHTING with it — panelSeed(wave), not per-board
  search.ts          bounded beam, queued plans, expectedAfterRefresh
  controller.ts      decide(run, controller), forcedSpend
  difficulties.ts    four tiers; blunder rate is the only dial that moves
  bots.test.ts       behavioural bar: finishes, legal, non-empty board, no leaks, deterministic
  planning.test.ts   isolation — hazards are CONSTRUCTED, not assumed

packages/sim/src/lobby/seats.ts     SeatPolicy — which policy drives a seat
packages/tools/src/bot-ladder.ts    Ascent mode, --human / --procedural
packages/tools/src/lobby-ladder.ts  lobby mode, placement per policy
packages/tools/src/fetch-boards.ts  cache the Supabase player pool
```

Detailed history in [`docs/devlog.md`](devlog.md) (2026-07-29 entries, newest first — note the CORRECTION
entry). Forward queue in [`docs/roadmap.md`](roadmap.md).
