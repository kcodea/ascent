# Doc Bot and the balance bots — where they actually stand (2026-09-11)

An owner-requested, deliberately harsh state-of-the-instrument audit. Every claim below was checked against
the code, the CI history, or a live run on this date. Scores are out of 100 for **effectiveness at the stated
duty**, not for effort or architecture.

| Instrument | Duty | Score |
|---|---|---|
| **Doc Bot** | standing correctness auditor: catch wiring/magnitude/interaction bugs before players do | **42 / 100** |
| **Balance bots** (G0 autoplay, G1 pilots, G2 production bots + the balance tools) | measure balance and stand in as credible opponents | **14 / 100** |

---

## 1. Doc Bot — 42 / 100

### What is genuinely working (why it is not lower)

- **The PR gate is real and fast.** 67 lane files, 622 tests, ~50 s total, riding the required `verify` check.
  Every content PR since 2026-08-27 has had to satisfy it.
- **It has caught real engine bugs and they were fixed.** R-AVWIN-02 / R-AVWIN-10 (found 08-27, fixed 09-10 in
  #1408), the Xerox text defect, the kennel contract, the `onGainCard` phase misclassification that had silently
  switched off half a lane (Gangplank), and Sable's Soulbind holding a tripled uid.
- **The retro harness is honest evidence**: 14 historical bugs reinjected at the source line, 14 caught, each
  by a dated human run.
- **The owner loop has been used**: 140 decisions in `decisions.json` (99 approve / 32 revise / 9 reject).
- The wiring layer (factory×phase, ref integrity, turn-scoped resets, rune differential, live-text halves,
  tribe-predicate ratchet) is the strongest part of the program — on its own it would score ~70.

### Why it is not higher — the evidence against it

1. **The nightly lane has been red on every run of its life and nobody has looked.** 15 of 15 scheduled runs
   since 2026-08-28 fail, with the *same two* findings every night: a serialize→deserialize roundtrip
   divergence at seed 62931 (Brackus, set 1, step 19, already minimized to a 20-action repro) and a contract
   disagreement on `shaper · effects.1.summons.count.plain`. Neither string appears anywhere in the repo,
   the devlog, or an issue. The findings ledger it was built to feed (`.local/docbot/`) has never been run
   locally. An alarm that is always on and never answered is not an alarm.
2. **It missed every bug the players found in September.** Bug Board round 2 (2026-09-09, #1374) fixed four
   real defects. Doc Bot pre-caught none:
   - **Kindness's four targeted Gifts did nothing** — consumed, counted, changed nothing — from #1211 (August)
     until a player reported it. That is *exactly* the silent-no-op class Doc Bot was founded on
     (`docs/docbot.md`, "the same five shapes keep shipping"). The Gifts have extracted contracts but the
     play-differential never casts them and they are not even in its "refused spells" queue: they were
     invisible, not queued.
   - **Hawkus ignored the Rune of Rallying's free Rally** — an interaction-family miss (`fireFreeRally` skipped
     the RL-gated watchers) that the interaction matrix / family lanes did not stage.
   - Rope Wrangler's doubled beat emission and Skybound's clamp were presentation / design, fair misses.
   Score-wise: 0 of the 2 in-scope engine bugs.
3. **Verification depth is ~4%, and the headline numbers hide it.** "972 / 972 contracts" means every object
   *has* a contract. Only **36** contracts had a case actually driven; **471** applicable cases have
   `no-driver-for-shape`; **522** contracts are uncorroborated extractor drafts. The report itself says this is
   "the single most important number" — and it has not moved since WP D (08-27).
4. **The text oracle cannot read most of the game, and the queue is growing, not draining.** 582 of 972
   objects (59%) are `unresolved-parse`. The "grow-loudly ratchet" is raised on every content PR
   (577 → 582 on the Celestials PR alone) instead of forcing a parser improvement. A ratchet that only goes up
   is a counter.
5. **The owner decks are dormant.** Sitting 1 (conventions) holds 63 cards, Sitting 3 (wording) 11; the CLI
   prints "pending owner questions: 0" while the final report says 9 needs-ruling and 73 undecided — the
   instrument's two outputs disagree about its own backlog.
6. **Zero real player reports have graduated into curated regressions.** The `bugs:graduate` loop is
   refusal-tested but has one fixture in `scenarios/regressions/`, and it is synthetic. The four September
   fixes above were each given an ordinary hand-written test instead.
7. **It taxes every content PR heavily and produced no catch during Set 3.** Set 3 shipped ~85 objects across
   nine PRs (09-09 → 09-11). Each PR touched 5–8 Doc Bot registry files (phase excuses, self-exclusion,
   this-turn, contracts, conventions, art ratchet, final-report regen); #1393 touched 51 files. The five Set 3
   devlogs mention Doc Bot only as "registries updated". Not one records a bug it surfaced. New content is
   currently *excused into* the lanes (e.g. `PHASE_EXCUSED` for Vendor and Conductor in #1423) — the L9 risk
   the roadmap named ("excuses encode my judgment") is now the normal authoring path.
8. **It is bigger than the thing it audits.** `packages/sim/src/docbot` + `packages/rules` = **67,857 LOC**
   against **51,262 LOC** of non-test `sim` + `core` source. `docs/docbot.md` alone is a multi-page narrative
   of instrument history; a new session cannot tell from it what gates, what is nightly, and what is dormant
   without running the CLI.
9. **Combat causality is grouping, not parenthood; RNG has no decision trace** (the report's own blind spots 4
   and 5). A wrong *cause* in combat is undetectable — only a wrong outcome or order.

### Honest reading

Doc Bot is a strong **wiring** tripwire wrapped in a large, mostly unexecuted **correctness / interaction /
process** scaffold. The scaffold is described with great precision, which is why it reads as more complete
than it is. Measured against its duty in the month since it landed: two engine bugs found and fixed by it,
two engine bugs found by players that it should have owned, a nightly nobody reads.

### Path forward — Doc Bot

Ordered by bugs-caught-per-day. Each item is a day or less unless marked.

1. **Answer the nightly (½ day).** Reproduce `nightly-s62931-roundtrip` and the `shaper` disagreement; fix or
   excuse with a reason. Then make a red nightly *unignorable*: post the two-line summary to the Bug Board or a
   pinned GitHub issue that the run updates, and fail `npm run docbot` locally if the last nightly is red and
   unacknowledged. A finding with no owner is not a finding.
2. **Close the Gifts hole the way the roadmap says to (1 day).** Hero-granted / hand-minted spells
   (Gifts, Clue, Tower Shield, Ale, the Discover-minted cards) are a *zone* the play-differential never stages.
   Add a "granted-to-hand" stager so every card that can only arrive in hand is cast through the real reducer
   with its real call shape. Sabotage-prove it by reverting `9852e16f`.
3. **Stage free / synthetic triggers (1 day).** `fireFreeRally`, replayed Shouts, hero-power-fired triggers:
   every code path that fires a trigger *without* the natural event must reach the same watchers as the
   natural path. This is a derivation-pair lane (natural fire ↔ synthetic fire, same watcher set). Hawkus is the
   sabotage case.
4. **Stop raising the unresolved-parse ratchet; drain it (3–5 days, the biggest lever).** Pick the ten most
   common unparsed sentence shapes in Set 3 (the parser is failing on *new* phrasing, which is why the count
   climbs with every content PR) and extend the grammar until the count falls below 50%. Only then does the
   text oracle become a claim instead of a bucket.
5. **Drive the 471 no-driver cases by family, not by object (1 week).** The skip ledger already groups them.
   One generic driver per family (stat-grant, summon, economy, keyword-grant, target-select) turns ~36 directly
   executed contracts into several hundred. This is Phase A of `docbot-roadmap.md`, still unbuilt for play.
6. **Make graduation the default for player bugs (process, zero code).** Every Bug Board fix lands as a
   `bugs:graduate` fixture, not a hand-written test. Four September fixes would already be curated regressions.
7. **Reconcile the two backlogs (½ day).** `npm run docbot` and `docbot:report` must print the same rule
   counts and the same pending-question number, from the same source. Schedule Sitting 1 (63 cards) — it has
   been waiting since 08-28.
8. **Cut the authoring tax (2 days).** Contracts, conventions, final-report regeneration and the art ratchet
   should regenerate from one `npm run docbot:sync` and never be hand-edited in a content PR. Any *excuse*
   added in a content PR must be a named review item (the roadmap's L9 rule) — today it is line noise in a
   1,000-line diff.
9. **Rewrite `docs/docbot.md` as a two-page contract (½ day).** What gates on PR, what runs nightly, what is
   dormant, how to read a failure. Move the instrument history to the devlog where it belongs.

Target after items 1–5: a Doc Bot that would have pre-caught 2 of the 2 in-scope September bugs and whose
nightly is green or acknowledged every morning. That is the difference between 42 and ~70.

---

## 2. Balance bots — 14 / 100

### What exists

Three generations, none retired, none talking to each other:

| Gen | Where | Who actually uses it |
|---|---|---|
| **G0 index-0 autoplay** | `snapshot.ts` `autoplayRun` | **The recorded seats real players fight** (`lobby/seats.ts`) and the baked opponent pool. Buys the first offer, picks quest/Choose-One index 0. |
| **G1 balance pilots** (greedy/tempo/midrange/meta/explorer) | `packages/sim/src/bots/` | `npm run report`, `npm run analyze`, the dev-only Balance panel. |
| **G2 production bots** (easy→expert) | `packages/sim/src/productionBots/` | `bot:ladder`, `lobby:ladder`, tune/learn tools. **Ships in no player-facing path.** Practice "bots" are authored stat tables with no effects. |

So the bot with real search architecture (G2) neither faces players nor produces the balance report; the
balance report runs on scripted heuristics (G1); players face index-0 recordings (G0).

### Why 14

1. **No bot output has ever moved a card.** No balance change in the git history cites a bot report. The only
   candidate, #622, is an owner pass. The roadmap (owner call 2026-07-16) demotes bot sims to "relative A/B
   deltas only, never absolute truth", and real-player telemetry is the declared balance lens.
2. **Nothing has been touched since 2026-07-29.** Every commit to `productionBots/` since 08-01 is a
   compile-fix to `actionCatalog.ts`. Set 2 went live 07-31; Set 3 merged 09-09 → 09-11. The learned tables
   (`runModel.data.ts`, `boardModel.data.ts`) were fit on 07-29, from **one hero (Drakko)**, and never refit.
3. **The bots cannot see the current game.**
   - G1 reads effects by param name only; **40% of Set 3 effects (66 / 165) score as the constant 2**,
     including all 14 Equipment grants. Trigger weights know six `on` values; `equip`, `onTribePlayed`,
     `onSell`, `goldSpent`, `onRise`, `cast` all get the default.
   - G2's `BotVisibleState` projects Ruby but not `spiritTally`, Clues, Reveler, Orbit, Equipment or Ale.
     `boardFeatures.ts` hard-codes six tribes — Dwarf, Spirit, Celestial contribute zero to the learned model.
   - G2 evaluates candidate boards by fighting the **set-1** synthetic pool while playing a set-2 run
     (`opponentPool.data.ts` is stamped set 1; 7 of its 96 card ids exist in set 2).
   - `KEYWORD_VALUE` weights `RL` and `EG`, which are not in the `Keyword` union; CN/FD/IMM/ST are absent.
4. **They cannot play the game.**
   - G2 only ever generates an untargeted hero power; every targeted power branch returns `state` unchanged,
     so those heroes never use their power.
   - G1 never freezes, never passes a play index (positional effects land on the reducer default), never
     passes `targetUid` on a spell, picks runes by *price* (`8 − cost × 0.5`), and does not handle
     `powerOffer` — Mimic and Void auto-lose in the report loop.
   - Equipment, Henchmen, hand-summon, Clues, Ales, Reveler sells: unreachable for every generation.
   - "Search" in G2 is `beamWidth 1, maxDepth 1, maxNodes 40` at every difficulty; the only dial between
     easy and expert is blunder rate.
5. **The measurement tools measure the wrong game.** `balance-report.ts` defines a win as
   `phase === 'victory'` — the retired 17-round course. `balance.ts` hard-codes the six set-1 tribes and
   today reports dragon and demon at 0% everywhere. `npm run analyze` at any affordable game count lists
   0 spells, 0 heroes, 0 quests and "no dominant tribe".
6. **Nothing is scheduled, gated or diffed.** No bot tool runs in any workflow. `lobby:ladder` at n = 1
   places the legacy policy 3.5 and expert 6.0 — noise, and the last time anyone ran it was July.
7. **Meta's rollout reads the future**: it calls `nextOpponent(state)` against the pinned opponent — the exact
   information the G2 fairness boundary was built to forbid. The two generations disagree about what is legal.
8. **Tests prove existence, not strength.** The 31 bot tests check completion, legality, determinism and a
   floor of >2.5 wins on 12 seeds. There is no easy < expert assertion, no stored-number regression, no test
   that a bot uses a targeted power, freezes, or touches a Set 2/3 mechanic.

The 14 points are for G2's *architecture* — the visible-state fairness boundary, fight-grounded evaluation,
error-barred ladders — and for `docs/bot-handoff.md`, which is honest about all of this and has been ignored
for 44 days.

### Path forward — balance bots

The first decision is the owner's, and it changes everything below:

**Decide what the bots are for.** Two duties, two very different projects:

- **(A) Credible opponents / practice partners** — the bot must *play well*. This is a real AI project.
- **(B) Balance instrument** — the bot only needs to be *consistent*, and the tools need n and set-awareness.
  Real-player telemetry already owns absolute balance truth (owner call 07-16).

Recommendation: pursue **(B) first, cheaply**, and treat (A) as a scoped project only if Practice needs
opponents better than authored stat tables. Ordered steps:

**Track B — make the instrument honest (≈ 1 week total)**

1. **Retire G1 and the retired-course tools (1 day).** Delete `bots/` pilots, `balance.ts`,
   `balance-report.ts`'s `victory` win definition, `card-audit.ts`, `enemy-curve.ts`, `player-curve.ts`, or
   point every one of them at G2 and the lobby. Two bot generations disagreeing about legality is worse than
   one weak bot.
2. **Rebuild the opponent pool per set (½ day).** `npm run pool` must emit a pool per `SetDef`, and
   `fightScore.poolPanel` must filter by the run's set the way `opponents.ts` already does.
3. **Teach G2 the current action space (2–3 days).** Targeted hero powers (generate one action per legal
   target), Equipment, hand-minted spells, Henchmen, freeze, play-index. Every action the reducer accepts must
   be generatable or carry a typed `never` reason — the `actionCatalog` `satisfies` guard already forces the
   list; today it forces excuses.
4. **Project Set 2 / 3 state into `BotVisibleState` (1 day)** — `spiritTally`, Clue bonus, Reveler value,
   Equipment, Ale — and widen `boardFeatures` to every tribe in every active set.
5. **Refit the learned tables across all heroes (½ day of compute)**, not Drakko alone; commit the seeds and
   the fit date beside the data.
6. **One scheduled ladder (½ day).** A weekly workflow runs `lobby:ladder` at n ≥ 30 for every active set,
   stores the per-card pick / win table as an artifact, and diffs it against last week. The output is a
   *relative* delta report — exactly what the roadmap says bot sims are allowed to claim.
7. **Strength regression pins (½ day).** Store expert's placement distribution and per-hero win rate per set;
   fail the weekly run when a change moves them by more than the error bar.

After Track B the bots stop lying (wrong set, wrong course, wrong rune valuation) and produce a weekly
relative-delta table a human can read. That is worth ~45 / 100 as an instrument. Nothing in Track B makes
them good players.

**Track A — credible opponents (a project; only if wanted)**

- Widen search (beam ≥ 4, depth ≥ 2) with a time budget and measure it with the ladder from Track B.
- Replace the linear `effectsValue` with fight-grounded evaluation everywhere (G2 already has it; G1's
  formula is the thing that reads Equipment as "2").
- Generate real Practice opponents from G2 runs per set instead of authored stat tables.
- Difficulty must separate on real boards, not on blunder rate alone — the handoff's own top item.

Until Track A is chosen and funded, **stop claiming the bots inform balance**. They do not, and the roadmap
already says so.

---

## 3. The one shared problem

Both instruments have the same failure mode: **output nobody consumes.** Doc Bot's nightly has been red for
15 days unread; the bots' last ladder was run in July. Neither has a human on the receiving end. Before adding
another lane or another policy, wire each to a place someone looks every morning (the Bug Board, a pinned
issue, a weekly artifact diff) and make silence impossible. An instrument is only as good as its reader.

---

## Addendum — end of day 2026-09-11: what shipped against the Doc Bot paths

All nine Doc Bot items above were built the same day as seven PRs (#1425 nightly, #1429 family drivers,
#1430 text parser, #1428 entry + fire paths, #1427 catch-rate loop, #1426 beat conservation, and the
reconcile PR). The measured state after the merges, every number from a command, none typed:

| Evidence | Morning | Evening |
|---|---|---|
| Nightly | red 15/15 runs, unread | both findings were real defects, fixed; a red run now writes a pinned status issue and stays red until fixed or acknowledged |
| Forward catch rate (`docbot:retro`) | 14/16 in scope, 2/4 trailing 30 days | **17/17 in scope, 4/4 trailing 30 days** — Gifts (entry paths), Hawkus (fire paths) and Rope Wrangler (beat law) flipped MISSED → CAUGHT on re-measure; Skybound stays out of scope (owner ruling) |
| Contracts with a driver-executed case | 36 of 972 | 470 (381 observed); no-driver skips 471 → 149, each typed |
| Unresolved text parses | 582 (59%), climbing | 55 (5.7%), hard ceiling 35% |
| Lanes / with sabotage proof | 67 / 25 | 73 / 34 |
| Live engine defects found by the new lanes | — | Discover-family save leak (player-visible); Uron multiplier skipped Hawkus + Mineral Master; free-Rally watcher walk visited a shifted watcher twice; Djinn double-emitted nested beats; aimed Shouts and Choose One branches had no beat; Devourer's meal emitted no departure |
| Instrument bugs found in Doc Bot itself | — | the spell gate vacuous since it shipped; the harness briefly voting for itself; the shaper "disagreement" was the driver not answering Choose One |

**Re-score: about 72 today, 75 when the next player bug is measured.** The rubric in §1 gave +6 for the nightly,
+8 for the two September classes, and the rest for depth; every one of those landed and is measured. What I
will not claim yet is the forward rate on a bug that did not exist this morning: 17/17 is a retro number, and
the honest test of the loop is the first report that arrives after today. The remaining structural ceiling is
unchanged (combat causality unstamped, RNG decision sites untraced, pixels invisible) and is the work between
75 and anything higher.

The balance bots were not touched today and remain at 14.
