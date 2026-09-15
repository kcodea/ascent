# The balance bot — how to use it, and what to trust (2026-09-15)

The instrument specified in [balance-bot-roadmap.md](balance-bot-roadmap.md), built as one stack on
2026-09-15 (work packages B0, B1, B2/B3, B5/B6 in parallel, integrated on `feat/balance-bot`). This page is the
operator's guide; the roadmap stays the design document. Status lines below are dated — re-read the
**Trust ledger** before acting on any number.

## The lever, today

```bash
npm run balance:run     -- --manifest packages/tools/src/balance/manifests/set3-generalist-smoke.json --out my-job
npm run balance:report  -- --job my-job [--out report.md] [--format json]
npm run balance:compare -- --baseline base-job --candidate cand-job [--allow-diff contentDigest,manifestDigest] [--target hero:warden]
npm run balance:census  # per-set content census + mechanic coverage
npm run balance:packages -- set2          # B4: the strategy-package census (members, key cards, affine runes / heroes, status)
npm run balance:strategist-bench -- --seeds 20 --explore 0|rotate   # B4: strategist vs generalist mixed lobbies + line diversity
npm run balance:manifest -- <manifest.json>   # print the resolved manifest + identity
npm run balance:synth   -- --set set3 --seeds 20 --out synth   # a synthetic job to exercise the report
npm run balance:corpus  -- --set set2 --out set2-players-v1 [--patch 0.1.0+]   # the recorded PLAYER corpus a pinnedLobby job names
npm run balance:run     -- --manifest packages/tools/src/balance/manifests/set2-pinned-smoke.json --out set2-pinned-smoke
```

A **manifest** names the game being measured: mode (`selfPlayLobby` and `pinnedLobby` are wired), set, policy +
search budget, seed schedule, round cap, per-turn action cap, and `fightRules` (`corrected` = every seat fights
through the player's full combat builder — the self-play default; `shipped` = the enemy seat through the
served-board path, to measure the game as shipped).

**Two lobby modes, two questions.** `selfPlayLobby` seats eight pilots and asks what happens when every seat
develops under its own results (population mean mechanically 4.5). **`pinnedLobby`** — the roadmap's "shipped
asynchronous lobby" (owner 2026-09-15: "we need it to run against real player snapshots to actually learn and
improve; bot seats are terrible and the data won't matter") — puts ONE pilot in seat 0 of the SHIPPED eight-seat
lobby whose other seven seats are REAL RECORDED PLAYER RUNS. `balance:corpus` pulls every real (non-synthetic,
non-empty, one-set) board from the shared Supabase pool into `out/corpus/<name>.json` with an order-independent
digest; the manifest names `corpus: { name, digest }`; `balance:run` registers it before anything else (it is also
the panel the pilot's `fightScore` samples) and `createRunLobby` fills the table from it exactly as a player's
client does — seeded shuffle, unique heroes, real authors. Every round is the shipped machinery: the pilot's End
Turn resolves its fight against the paired recording's served board through the reducer, `resolveCombat` settles
the run and the whole table (`settleRunLobbyRound`: the six other fights, ghosts, knockouts, placements), and the
run ends when the pilot's seat is knocked out or the lobby finishes. `fightRules` is `shipped` by definition
there (a recording has no live run to prepare). After the pilot falls the table is played out so every recording
has a placement; a corpus that cannot fill seven seats with distinct-hero recordings FAILS the lobby (censored),
never pads with bots. The report computes hero / rune / minion / spell tables and "likely problems" over PILOT
seats only and prints the recorded population (runs, authors, patches, heroes, its mean placement beside the
pilot's) as its own section. Every record carries the manifest and an **identity** (engine revision + dirty
diff digest, content digest in pool order, pool digest, effect-implementation digest, manifest digest);
`balance:compare` refuses jobs whose identities differ in anything you did not declare.

A **job** is a directory under `packages/tools/src/balance/out/<jobId>/` (gitignored): `manifest.json`,
`identity.json`, one `lobbies/<seed>.json` per lobby with a checksum line, `summary.json`. Re-running the same
manifest resumes: seeds with a complete, checksummed file are skipped; a changed identity refuses to resume.

The **report** prints coverage first (planned / started / complete / failed / censored lobbies; failed runs by
hero and policy), then a "likely problems" lead list (entities whose lobby-level bootstrap CI excludes the
population mean — evidence level 1, descriptive), then the four tables (heroes, runes, minions, spells) and
pacing (tier curve, unspent Gold, board turnover, winner concentration, early-card retention). Every number
carries its count; sparse rows are suppressed and labelled. Symmetric self-play's population mean is
mechanically ~4.5, so hero rows and controlled comparisons carry the signal, not the overall average.

**Patch workflow** (evidence level 3, the only basis for an actual change): run a baseline job; make a bounded
content change — a DATA change as a manifest `overlay` (card id → stats / tier / cost / per-effect params, applied
in-process before the identity is computed and validated by the content schema; see `sim/balance/overlay.ts`),
an effect-CODE change as a separate build; run the candidate with the SAME manifest and seeds; `compare`
with `--allow-diff contentDigest,manifestDigest`; read the seven questions the comparison answers in order (did
the target move; rules or policy; acquisition consistency; dominant combos; pacing / diversity; early cards;
unsupported). The A/A self-check (`compare x x`) reports zero effect; the synthetic positive control (`synth
--nerf <hero>=1.5`) registers with a CI excluding zero.

## The strategist pilot (B4, 2026-09-15)

`policy.id: strategist` is the generalist's search with a **line prior** in candidate scoring
(`packages/sim/src/balance/strategy/`). Three parts:

- **Packages** (`strategy/packages.ts`) — the set's strategy roster, DERIVED from the content: a card belongs
  by predicate over its real definition (tribe, keywords, effect ids, trigger events, printed text) at strength
  1 (supporting) / 2 (engine) / 3 (payoff); a rune is affine through the `runeSynergies` tag vocabulary (+ a
  per-package text predicate); each package carries an economy profile (`tempo` tiers late; `engine` climbs
  measured; `economy` tiers on the 6 / 8 / 10 Gold thresholds) and a risk label. The ONE hand-maintained part is
  the **hero intent manifest** (`heroes`: hero id → affinity multiplier, one comment per entry). Eleven packages:
  ruby, ale, demonConsume, beastSummon, dragon, spellEngine, echo, mechAttach, rally, tempo, economy.
  `npm run balance:packages` prints the census; `strategy/packages.test.ts` pins the set-2 counts so a content
  change that empties or thins a package fails a test. A package the set cannot field is reported
  **unsupported** (Mech in set 2), never quietly empty.
- **Lines** (`strategy/lines.ts`) — for a run's hero + rolled tribes, every package's FIT = tribe availability ×
  hero affinity × pool depth; `pickLineForRun(heroId, tribes, seed, exploration)` returns the k-th best viable
  line (primary + a tribe-compatible secondary), deterministic in its inputs. Recorded on `RunRecord.line`
  (`{ primary, secondary?, fitRank }`) and echoed on `SeatContext.line`.
- **The prior** (`strategy/prior.ts`) — installed for exactly one decision through
  `withEvaluationPrior` (an additive hook in `productionBots/evaluate.ts`; weight 0 in the shipped config, so
  the generalist's numbers are untouched): card affinity on the board (and minions in hand — never spells, which
  are valued by casting), owned-rune affinity × expected payoff over the REMAINING rounds (a per-turn rune is
  worth more early), tier timing against the profile (behind < on-curve > ahead), held pairs of line cards, and
  a tiny bias to have used an affine hero power. Capped at ~1.5 normalized points × weight 10 beside
  `fightStrength`'s 26 — it steers construction; the fight decides.

The strategist also turns on the generalist's opt-in **replace macro** (`GeneralistOptions.replaceMacro`:
`sell <weakest board minion> → buy <offer> → field it`, or `sell → field <hand minion>`, scored as one candidate
beside the search's best plan and queued with fingerprints) — depth-1 search never turns a full board over
on its own. It is off for `generalist`, so the generalist's play is unchanged.

Variants: `strategist` (best-fit line every run — the natural population), `strategist:rotate` (line index
from the run seed — the **exploration** population; a forced line is never a natural pick rate),
`strategist:explore<k>` (the k-th best line pinned). `generalist` is untouched.

**Curricula** (`strategy/curriculum.test.ts`), per set-2 package with the line forced on a neutral hero: (a) a
ready payoff state takes the payoff from hand; (b) at wave 2 it buys the engine piece over a vanilla body of
the same stats — strictly, by search utility, not a tie; (c) a shop with nothing on-package still develops;
(d) the Runeforge takes the affine rune over an off-package one of equal cost, in either order; (e) the
economy profile tiers at its target (economy: 2 → 3 at wave 4; tempo: at wave 5) and not before. The
generalist's competence scenarios (spend, triple, forge, determinism, no leaked handles, no leaked prior) pass
for the strategist too.

**Benchmark** (`strategy/benchmark.test.ts`, `npm run balance:strategist-bench`): mixed set-2 lobbies, four
strategist + four generalist seats alternating by seat and seed, smoke budget, placement compared per LOBBY
(paired advantage = generalist − strategist mean placement, 95% interval). The gate is "not worse beyond
noise" (the interval reaches 0). Measured 2026-09-15, seeds 100–119: strategist mean placement **4.05 [3.62,
4.48]** vs generalist **5.33 [4.89, 5.76]**; paired advantage **+1.27 [0.42, 2.13]** (n=20 lobbies); firsts 17
vs 3; top-half 47 vs 30 of 80 seats. Line diversity for the exploration population is printed alongside
(9–10 distinct primaries per hero over 30 seeds for Fibbsy / Flint / Tiff, 10 viable).

**Against the real set-2 players (the owner's scale: < 4.0 solid, < 3.0 great, < 2.0 phenomenal; 4.4 is a
below-average player).** In the pinned lobby (`set2-pinned-strategist-smoke100.json`: seat 0 vs seven recorded
player runs from `set2-players-v1`, 100 lobbies, smoke budget, `fightRules: 'shipped'`) the strategist places
**6.72 [6.44, 6.99]** (first-place 0/100) against the generalist's **6.80 [6.56, 7.05]** on the same seeds —
a PLATEAU, not a pass. The self-play advantage does not transfer: both pilots lose to the recorded field from
wave 5 (pilot total board stats 33 / 46 / 62 / 76 at waves 5 / 6 / 7 / 8 against the players' 36 / 60 / 97 /
162; win rate 46% → 35% → 27% → 18%; eliminated at a median round 9). What the strategist's iterations moved and
what they did not (each a 100-lobby pinned job):

| change | pinned placement | note |
|---|---|---|
| line prior only (cards / runes / tier timing / pairs / hero) | 6.89 | tiered a full level earlier than the generalist (2.00 @ w3, 3.01 @ w6) — no placement gain |
| + the REPLACE macro (`sell weakest → buy → field`, opt-in on the generalist) | 6.67 | the pilot finally turns its board over from wave 7 (~1 sell per turn); bought-card tier still 2.5 at a shop tier of 3.9 |
| + board-MASS term (linear stats vs the wave reference) + INVESTMENT term (permanent Shop buff / Spell Power / auras × rounds left) | 6.63 | the evaluator's `fightStrength` reads 0 for every candidate once the field outgrows the pilot and `boardPower` is log-saturated — the prior restores a gradient, but +7 stats a turn does not catch an exponential curve |
| + PAIRS valued for every card (a golden = double stats + a tier-up Discover; players hold 0.5–1.1 goldens per board from wave 8) | 6.72 | within noise of the previous two |

Diagnosis (for B3, not hidden here): the recorded players' boards grow 21 → 60 → 162 → 456 → 1,442 total stats
over waves 4 → 12 through goldens and per-turn engines — the Demon Shop-buff line (Demon Horse / Hank / Blart /
Butcher), Ales, Rubies, Chorus Drake / Standard Bearer Rallies, Broodfire-style Shouts under Drakko — while the
one-turn evaluator values a body by the fight it wins THIS turn against a panel it can no longer beat. A prior
capped at a few utility points steers which of two equal moves is taken; it cannot make the search see a
compounding payoff three turns out. The next lever is the evaluator / search horizon (short multi-turn
rollouts for setup decisions, as the roadmap's B3 already lists), then re-tune the prior against measured
placement. Also surfaced: the pinned report's minion funnel prints `bought 0` for every card (`offered → bought
→ played`) — the buy attribution does not reach the pinned runner's records; the numbers above were
reconstructed from `cardGained` effect events.

## What the first real jobs showed (2026-09-15)

- **Set 3, greedy baseline, 40 lobbies:** every lobby completed, 0 failures, ~220 ms per eight-seat lobby. The
  pilot never tiers up (mean tier 1.00 for 50 rounds, ~10 Gold unspent per turn, 0 hero-power uses) — the report
  measured a Tier-1 stalemate. Kept as the baseline population; not a balance signal.
- **Set 3, generalist (smoke budget), 20 lobbies:** 0 failures, ~12 s per lobby (~11 ms per decision, 5.2
  actions per recruit turn). Real games: tier 1 → 6 by round 16, Gold spent through round 8, first
  eliminations around round 9, lobbies end in 14–22 rounds, 76% early-card retention on final boards.
- **Set 2, pinned lobby vs the real player recordings (`set2-pinned-smoke`, 20 lobbies, generalist smoke
  budget):** corpus `set2-players-v1` = 796 boards / 70 runs (≥ 4 waves) / 8 authors / 35 patch stamps, 37 runs
  reaching wave ≥ 12. 0 failures, ~1.9 s per lobby. The pilot's mean placement was **6.95 [6.55, 7.35]** against a
  population whose recordings averaged 4.38 — the pilot won 82 of 188 fights but was knocked out in rounds 8–12
  every time (mean tier 4.6 by round 9, Gold fully spent), i.e. it loses the early damage race to boards real
  players built. No entity's interval excluded the population mean at 20 lobbies (every hero sits once). This is
  the first measurement against real players and it says the smoke-budget generalist is well below the recorded
  field — a pilot-competence finding, not a balance signal.
- Two instrument defects surfaced and were fixed on the integration branch: the runner recorded the shop row as
  the "offers" of a Runeforge action (the Runes table listed Starforms as runes offered); and the legacy
  `fightScore` fallback was retired (a missing opponent pool now yields `panel: 'procedural'` on the result).

## Trust ledger

What each layer proves today, and what it does not. Check the boxes as the gates in the roadmap's
"Validation and release gates" are met.

| Layer | Trustworthy for | NOT yet trustworthy for | Why |
|---|---|---|---|
| Runner (B1) | recruit turns are real reducer transitions; one `simulate()` per pair; armor-first settlement; eliminations, byes, ghosts, placement per the shipped lobby rules; determinism; **both seats keep their combat carry-backs** (#1491: `CombatResult.enemyCarry`, ≈70 of 96 side-gates made symmetric, shipped result byte-identical over 1,278 captured fights) | six documented `KNOWN ASYMMETRY` groups | the enemy's Grim-style tally stays the snapshot's frozen value mid-fight; enemy spell power / Imp aura / hand-buff snapshots are static for the fight (gains still carry back); Pack Mentality live growth, mid-combat quest completion, Blood Trail / Soulbind / Echo Warden / Rallying Offensive extras and telegraph events are player-only. Listed in `simulate.ts` by name. |
| Fight context | `corrected` rules give every seat the player's full context (spell power, Ruby casts, Reveler values, banked Start-of-Combat effects, alignments) | claims about the game **as shipped** | the shipped non-player fight is tier-only (`lobby/runLobby.ts:590`, `:629`) and served boards carry no alignment; run with `fightRules: 'shipped'` to measure that, and read the discrepancy list in `seatRunner.ts`. |
| Pilot (B3) | buying, playing, tiering, selling, refreshing, freezing, targeted Shouts, Choose One, Discover, triples, hero powers, Equipment, Starform; no illegal actions; decisions are player-legal (reveal-by-effect, hidden future never read) | **strategy competence** at the level of a good player; late-game spending (unspent Gold climbs past round 12); no strategy specialists yet (B4) | single-turn benchmark vs the legacy greedy: set2 +0.85 [0.69, 1.01], set3 +0.70 [0.38, 1.02]; deeper budgets show no measurable single-turn gain (dev vs smoke 0.00 [−0.38, 0.38]) — multi-turn value unproven. Unsupported content must be labelled, not ranked as weak. |
| Strategist (B4) | plays a declared line (primary + secondary package) with the generalist's legality and information boundary; takes affine runes, engine pieces and profile-timed tiers in the curricula; BEATS the generalist in mixed self-play (4.05 vs 5.33, paired +1.27 [0.42, 2.13], 20 lobbies); line diversity 9–10 primaries per hero over 30 seeds under `strategist:rotate` | **competence against real players** — 6.72 [6.44, 6.99] in 100 pinned set-2 lobbies (owner scale: < 4.0 passes); a claim that a line is STRONG or WEAK (fit is a construction prior, not a strength estimate); packages a set cannot field (labelled unsupported) | the prior is capped and one-turn: it cannot see compounding engines; the evaluator's fight terms lose all gradient once the field outgrows the pilot (B3 work); the hero intent manifest is hand-maintained design intent, not measured. |
| Recorder / report (B5) | accepted-action reconciliation (pre/post state hash), offer → buy → play funnels per surface, spell casts by route, sold cards visible, failed/censored runs separated, lobby-level bootstrap CIs, deterministic regeneration | causal claims | everything in the report is evidence level 1 until a `compare` job exists for the change. |
| Compare (B6) | A/A = zero effect; synthetic positive control registers | a real candidate | no real patch experiment has been run yet — the first one is the next step. |
| Pinned lobby (`pinnedLobby` + `balance:corpus`) | the pilot's placement in the game **as shipped** against a **frozen, digest-pinned population of real player recordings** (the seat fill, the served boards, the settlement and the placements are the client's own code paths; determinism; a thin corpus censors rather than pads) | any claim that a patch changes how *players* fare, or hero/card strength beyond the pilot's own play | recordings do not adapt: a pinned job measures the PILOT against the population as it was recorded, under the CURRENT rules — a card change moves the pilot's boards and the fights, never the recorded boards' build orders, so a placement shift is "the pilot vs yesterday's players", not a new meta. The recordings' own placements are the complement of the pilot's over eight seats and are printed only for reading. Recording-vs-recording fights are the shipped tier-only path (`runLobby.ts` `settleRunLobbyRound`), the same as the live game. A corpus mixes patches (35 stamps in `set2-players-v1`); `--patch <prefix>` narrows it, at the cost of runs. |

## Next steps, in order

1. ~~Land the symmetric carry-back PR~~ (#1491, merged into this branch) — re-run the set-3 job and `compare` against the pre-fix job (`--allow-diff engineRevision,effectDigest`): hero rows that move are the carry-back-dependent ones.
2. ~~Register a set-3 opponent pool~~ — `balance:pool` builds a versioned panel from any job's round snapshots; `set3-gen-v1` (4,109 boards, waves 2–22) is the first. ~~Do the same for set 2~~ — set 2 now has the REAL corpus (`balance:corpus`, `set2-players-v1`).
2b. The pilot places ~7th against real set-2 recordings: raise pilot competence (B3/B4) and re-run the pinned smoke — a pinned job is the held-out benchmark the roadmap asks for ("human-run groups").
3. Run the first REAL patch experiment (a bounded content change, paired seeds) and read the comparison.
4. ~~B4 strategy specialists (package manifests + curricula)~~ — shipped as the strategist pilot, which beats the
   generalist in self-play but plateaus at 6.7 against the recorded players. Next, in order: (a) give the search a
   horizon the prior cannot fake — short multi-turn rollouts for setup / replace decisions and an evaluator gradient
   that survives losing (B3); (b) fix the pinned report's buy attribution; (c) THEN tune the prior's weights against
   pinned placement (`bot:tune`-style search, never hand-feel) and run a `strategist:rotate` job per hero.
5. B7 workers + nightly entry point once throughput matters.
