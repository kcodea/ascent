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
npm run balance:manifest -- <manifest.json>   # print the resolved manifest + identity
npm run balance:synth   -- --set set3 --seeds 20 --out synth   # a synthetic job to exercise the report
npm run balance:corpus  -- --set set2 --out set2-players-v1 [--patch 0.1.0+]   # the recorded PLAYER corpus a pinnedLobby job names
npm run balance:run     -- --manifest packages/tools/src/balance/manifests/set2-pinned-smoke.json --out set2-pinned-smoke
npm run balance:matrix  -- --manifest packages/tools/src/balance/manifests/set2-generalist-200.json --runs-per-hero 30 --out set2-matrix [--heroes a,b] [--exploration-rotate] [--workers 8]
npm run balance:findings -- --job set2-matrix --out findings.md [--format json] [--q 0.1] [--margin 0.25] [--min-support 20]
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

### The hero matrix + the findings report (owner ask 2026-09-15)

"Sim it 30 times for every hero where it picks different lines and runes and cards … catch the outliers on both
overpowered and underpowered cards / runes / heroes." Two commands:

**`balance:matrix`** plans a SCHEDULE from a base manifest: every playable hero of the set (production eligibility
— `playableHeroes()`, minus a tribe-gated hero no tribe of the set can seat) × N runs. Each run is one lobby with
seat 0 PINNED to the hero (`manifest.pinnedHero`, honoured by `rotateHeroes`; the other seven rotate from the roster
minus it) on a PAIRED seed schedule — the same N seeds for every hero, so heroes are compared on identical seat-0
run seeds, shop draws and fight RNG. `--exploration-rotate` sets `manifest.exploration = (seed − start) mod K`
(K default 4) so a strategist pilot plays different lines across a hero's runs; today's pilots ignore it and the
record still carries it. One job holds every lobby (`lobbies/<hero>-<seed>.json`; the job's `manifest.json` is the
base plus a `matrix` plan, each record carries its derived per-lobby manifest), it resumes like `balance:run`,
prints progress + ETA, and `--workers N` shards it across N child processes. The runner follows the base
manifest's `mode` — `selfPlayLobby` today; `pinnedLobby` is loaded dynamically and reports "not on this branch"
until `feat/balance-pinned` merges. A lobby whose seat 0 did not get its hero is FAILED, never accepted.

**`balance:findings`** is the owner-facing report, in this order: **coverage** (heroes × planned / complete /
failed, lines played per hero when the pilot has lines, paired-seed check, and the UNEXERCISED list — content never
offered / never bought / never played is *unmeasured, not weak*); **outlier scans** for heroes (mean placement
over every seat the hero sat in, lobby-level bootstrap CI, top-half rate, elimination-round median, plus the
pinned-seat mean), runes (owner lift paired within lobbies that hold both sides, pick rate WHEN OFFERED,
acquisition round, `forced` picks reported separately or "forced exposure unknown"), minions and spells
(offer → buy → play/cast funnel, held-vs-not lift shrunk with k = 10, triple rate, held-never-played rate, and the
**always-bought (≥ 90%) / never-bought (≤ 5%)** lists); **interactions** (hero × rune, rune × line, minion × minion
on winning boards — sparse cells suppressed); **pacing + strategy concentration** (tier / unspent / turnover
curve, winner Herfindahl, line prevalence); and **what to test next** — the top 5 OP and top 5 UP entities each
turned into a bounded candidate patch (an `overlay` snippet for a card; a named `HeroDef.armor` / `RuneDef.cost`
parameter for a hero / rune) with the `balance:compare` line to run.

How to read a flag: an entity is **OVERPOWERED / UNDERPOWERED** only when (1) it has at least `--min-support`
placed runs (default 20 — a matrix at 5 runs/hero flags nothing on the pinned seat alone; the all-seat sample
is what carries the support), (2) its two-sided bootstrap p-value survives **Benjamini–Hochberg at q = 0.1**
within its family (all heroes; all runes; all minions; all spells — each family is one scan), and (3) its 95% CI
clears the population mean (heroes) or zero (lifts) by `--margin` (default 0.25 placements). "sig., inside margin"
means BH passed but the effect is too small to act on. Rune and card lifts are **matched**: the control for an
owner is the seats of the same lobby that had the same exposure (reached a Runeforge / saw the card offered), were
still alive at the round it acquired the entity, and never held it — "owners vs everyone" would be mostly
survivorship. Everything is evidence level 1; the suggestion list is the bridge to a level-3 `compare`.
`--format json` carries the full lists the markdown truncates.

## Scouting — the pilot sees what a player sees (2026-09-15)

The roadmap asks that "legally revealed scout information should be available under the same conditions as
for a player". The rule, read off the shipped lobby and pinned with file:line in `productionBots/scout.ts`: while
shopping, a player knows **who they meet next** (`LobbyPanel.tsx:87` → `playerOpponent`, the NEXT chip — the
pairing is a pure function of the table) and can hover **every seat's scout card** (`LobbyPanel.tsx:205`): hero,
live Resolve/Armor, alive/placement, and `SeatIntel` — tavern **tier, triples, dominant tribe + count, completed
quests, owned runes** — recorded **at settle** from the board each seat last fielded (`runLobby.ts:584-586`); for
the next foe alone the card reads the board it brings **this** round (`LobbyPanel.tsx:89-91`), which only a
recorded seat can show. A player **never** sees another seat's minion list; the only bodies they have seen are the
boards they **themselves fought**. Both runners now hand the pilot exactly that as additive `SeatContext` fields
(`nextOpponent`, `field`, `myHealth` / `myArmor` / `lossCap`): the pinned lobby from the real table (this-round
intel for the next foe, settle intel for the rest, the pilot's own combat memory of boards it fought); the
self-play lobby from each seat's settled state (there the next foe's intel is last round's — its board does not
exist yet). A test (`balance/scoutContext.test.ts`) proves no context ever carries a board from a wave the pilot has
not met. The runners also pass `seatedRecordings` — a **fairness guard, not player information** — so the pool
panel never samples a seated recording (its future boards would be the exact boards to come).

Turned on per manifest (`policy.budget.scouting: true`, default off so old jobs reproduce), `fightScore` fights a
**scouted panel** (`panel: 'scouted'`): the next opponent's stand-ins take ≥ 60% of the weight — the board the
pilot last fought from that seat when ≤ 3 rounds old, then pool boards **of its scouted shape** (tier + dominant
tribe near this wave) — the rest of the living field follows at half weight, the plain pool fills. The result
carries `expectedDamageTaken` (the round-capped hit expected from the next foe: the engine's own tier + surviving
tiers). `survivalWeight` (default 0) adds `survivalTerm` = −(capped hit ÷ cap) × `lethalRisk` (0 under 40% of
your Resolve+Armor, 1 at all of it) to the utility, so a seat one loss from elimination prefers the safe board and
a comfortable one stays greedy. **Measured** against the owner's bar (under 4.0 passes):

| job (100 pinned set-2 lobbies, smoke budget) | mean placement [95% CI] | 1st | top-4 | elim. median | win% by round 5 / 6 / 7 / 8 |
|---|---|---|---|---|---|
| baseline `set2-pinned-gen-smoke100` | 6.80 [6.55, 7.05] | 0% | 6% | r9 | 56 / 36 / 20 / 12 |
| + scouting (`set2-pinned-scout-smoke100`) | 6.87 [6.62, 7.11] | 0% | 6% | r9 | 59 / 42 / 19 / 17 |
| + scouting + survival 8 | 6.87 [6.62, 7.11] | 0% | 6% | r9 | 59 / 42 / 19 / 17 |
| + scouting + survival 20 | 6.84 [6.58, 7.09] | 0% | 7% | r9 | 59 / 42 / 19 / 18 |

Scouting does not move the pilot, and the round logs say why: it wins rounds 1–5 (real players are tiering), then
from round 6 the board is full (6.8–7.0 bodies, tier 1–2) and stays that way while the hand grows from 3.6 to 9
unplayed cards; tier keeps pace with the recordings by round 10 but the bodies never change. At the smoke budget a
sell reads as pure loss, `forcedSpend` keeps buying into a full board, and there is no sell → play replacement
chain — a B3/B4 competence defect (sell-to-replace, tiering, hand discipline), not an information defect. The
survival term is verified to change decisions at lethal health (probe: root utility 28.2 → 6.2 at 9 Resolve vs a
tier-4 next foe; the pick moved from a buy to fielding a body) but by then the placement is decided.

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
- **Set 2 hero matrix smoke (53 heroes × 5 paired seeds, generalist, 8 workers):** see the matrix PR's devlog
  entry (`docs/devlog/2026-09-15-balance-matrix-findings.md`) for the coverage, timings and the leads that
  survived support + FDR.
- Three instrument defects surfaced and were fixed on the integration branch: the runner recorded the shop row as
  the "offers" of a Runeforge action (the Runes table listed Starforms as runes offered); and the legacy
  `fightScore` fallback was retired (a missing opponent pool now yields `panel: 'procedural'` on the result); and
  the self-play runner emitted its own lean effect diff (`cardGained` keyed by `targetId`) while the aggregate read
  the recorder's attributer (`sourceId`, lineage routes), so every REAL job's minion / spell funnel read "bought 0" —
  `playRecruitTurn` now takes a per-seat `lineage` and derives effects through `effectsFromTransition.ts`.

## The bar (owner, 2026-09-15)

Pilot strength is measured as **mean placement over ≥ 100 pinned lobbies against the real set-2 recorded
population**: **under 4.0 = solid (the minimum to pass)**, **under 3.0 = great (the target)**, **under 2.0 =
phenomenal**; 4.4 is a below-average player and does not pass. The generalist baseline (smoke budget) is
**6.80 [6.56, 7.05]**; search depth alone did not move it (6.76 at depth 2 / beam 3). Balance findings from a
pilot below the bar are leads about the *pilot*, not the game.

## Learned value (2026-09-15)

The pinned lobbies diagnosed a STRATEGIC gap (placement 6.80/8 at depth 1, 6.76 at depth 2): real players tier a
full level earlier, hold 1–2 bodies at waves 2–3, and scale exponentially from wave 8 because they build engines;
the pilot fills seven slots with bodies by wave 7 and wins 5% of fights from wave 9. The learned value model is the
piece that lets the pilot learn what surviving boards look like FROM THE RECORDINGS instead of from a hand-written
proxy. It lives in `packages/sim/src/balance/value/` (features, model, the term, the committed model) and
`packages/tools/src/balance/value/` (dataset builder, fit, report).

```bash
npm run balance:value:dataset -- --corpus set2-players-v1 --jobs set2-pinned-gen-smoke100,set2-pinned-gen-dev100 --out set2-v1
npm run balance:value:fit     -- --dataset set2-v1 --out set2-v1 [--lambda 100] [--pinned-weight 1] [--sweep 10,30,100,300]
npm run balance:value:report  -- --model set2-v1 [--dataset set2-v1]
```

**The label is SURVIVAL, not placement.** A recording carries no placement, so a board at wave *w* of a run whose
last recorded wave is *L* is labelled `(L − w) / (maxWave − w)` (`maxWave` = the corpus' last recorded wave, 18 for
`set2-players-v1`); `reachedTop` (`L ≥ 14`) is kept as the top-finish proxy. A run that reached the end-game scores
1 whether it won or lost the final — late survival means "reached the end-game", never "won". Pinned-lobby PILOT
rounds are rows too (same label; the recorded seats are the corpus again), and they additionally carry the pilot's
final placement (`(8 − placement) / 7`) and that round's fight result as EVALUATION columns (rank-correlation
targets), never as fitted labels.

**Leakage rules.** Features come from ONE function (`featuresOfInput`, reached by `featuresOf(visibleState)` at
inference and `featuresOfSnapshot` in the dataset builder, so training and inference cannot drift) and read only
what the player sees at the end of a recruit turn: wave, tier, tier − expected(wave) (the diagnosis curve), Gold
unspent, board and hand size, stat totals / maxima, goldens, mean/max minion tier, pairs held, own Resolve + Armor,
keyword counts, tribe counts + dominant-tribe share, and twelve MECHANIC buckets derived from the effect vocabulary
(`packages/content/src/schema.ts`: per-turn scalers, on-play, death, summon, spell synergy, Ruby, Ale, Consume,
attachment, combat-time, shop buffs, card generation — the rules print at the bottom of the report). Nothing from
the opponent, the served board, the future shop, the seed or the fight result. A recorded snapshot has no Gold, so
that column is `null` and imputed to the wave mean — never faked as 0. Validation splits by ORIGINATING RUN (the
row's `group`: corpus run key, or job + lobby + seat), never by board; the null model is the training fold's
per-wave mean.

**The model** is a deterministic ridge regression (closed form, no RNG), one weight vector per wave band (early
1–5 / mid 6–10 / late 11+), on features standardised PER WAVE (shrunk toward the band for thin waves, clipped at
±6) so a weight reads "one wave-σ more of this than the typical board at that wave". `set2-v1` (λ 100, chosen by
the run-split sweep) on 2,716 rows (794 corpus / 70 runs + 1,922 pilot rounds / 200 lobbies): held-out R² 0.483
vs null 0.250 overall; on the recordings alone 0.195 vs −0.201 (Spearman 0.48 vs 0.24); early band R² 0.31 (null
0.09), mid 0.51 (null 0.07), **late 11+ is NOT predictive (−0.05, 218 rows)** — treat the late band as the
intercept. What the weights say: at every band the strongest board predictor of survival is mean minion tier for
the wave (+ tier gap), then per-turn scalers (`mech_perTurn`), Consume and Kobold engines; at waves 6–10 an
unspent hand, Wards and Taunts on the board, and a Demon/Dragon/Dwarf-heavy board predict elimination; at 11+
card generation and tribe concentration help. `valueTermOf(visibleState, model)` returns the expected normalised
survival (`null` = no opinion); `loadDefaultValueModel('set2')` returns the committed model.

**Standalone worth, measured (50 pinned lobbies, seeds 1–50, smoke budget, the term added to the evaluator's total
at weight W, paired against the same seeds of the 6.80 baseline):** W 30 → 6.70 (Δ −0.14 ± 0.20, 10 better / 5
worse); W 100 → 7.10 (Δ +0.17 ± 0.31); W 300 → 7.64 (Δ +0.80 ± 0.34). The heavier the term the faster the pilot
tiers (mean tier 3.0 at round 4 under W 300 vs 1.7 baseline — exactly the recorded curve) and the EARLIER it dies
(24 of 50 eliminated in round 8), because the depth-1 search cashes the tier-up as an immediate fight loss it never
recovers from. The term knows what survivors look like; it does not know how to get there. It is a direction for
the strategist (B4), not a drop-in weight: blend it small (≤ 30), or use it to choose BETWEEN plans of equal fight
strength, and pair it with a tempo plan that fields a fight-winning board the round after a tier-up.

## Trust ledger

What each layer proves today, and what it does not. Check the boxes as the gates in the roadmap's
"Validation and release gates" are met.

| Layer | Trustworthy for | NOT yet trustworthy for | Why |
|---|---|---|---|
| Runner (B1) | recruit turns are real reducer transitions; one `simulate()` per pair; armor-first settlement; eliminations, byes, ghosts, placement per the shipped lobby rules; determinism; **both seats keep their combat carry-backs** (#1491: `CombatResult.enemyCarry`, ≈70 of 96 side-gates made symmetric, shipped result byte-identical over 1,278 captured fights) | six documented `KNOWN ASYMMETRY` groups | the enemy's Grim-style tally stays the snapshot's frozen value mid-fight; enemy spell power / Imp aura / hand-buff snapshots are static for the fight (gains still carry back); Pack Mentality live growth, mid-combat quest completion, Blood Trail / Soulbind / Echo Warden / Rallying Offensive extras and telegraph events are player-only. Listed in `simulate.ts` by name. |
| Fight context | `corrected` rules give every seat the player's full context (spell power, Ruby casts, Reveler values, banked Start-of-Combat effects, alignments) | claims about the game **as shipped** | the shipped non-player fight is tier-only (`lobby/runLobby.ts:590`, `:629`) and served boards carry no alignment; run with `fightRules: 'shipped'` to measure that, and read the discrepancy list in `seatRunner.ts`. |
| Pilot (B3) | buying, playing, tiering, selling, refreshing, freezing, targeted Shouts, Choose One, Discover, triples, hero powers, Equipment, Starform; no illegal actions; decisions are player-legal (reveal-by-effect, hidden future never read) | **strategy competence** at the level of a good player; late-game spending (unspent Gold climbs past round 12); no strategy specialists yet (B4) | single-turn benchmark vs the legacy greedy: set2 +0.85 [0.69, 1.01], set3 +0.70 [0.38, 1.02]; deeper budgets show no measurable single-turn gain (dev vs smoke 0.00 [−0.38, 0.38]) — multi-turn value unproven. Unsupported content must be labelled, not ranked as weak. |
| Recorder / report (B5) | accepted-action reconciliation (pre/post state hash), offer → buy → play funnels per surface, spell casts by route, sold cards visible, failed/censored runs separated, lobby-level bootstrap CIs, deterministic regeneration | causal claims | everything in the report is evidence level 1 until a `compare` job exists for the change. |
| Compare (B6) | A/A = zero effect; synthetic positive control registers | a real candidate | no real patch experiment has been run yet — the first one is the next step. |
| Learned value (`sim/balance/value`) | what SURVIVING recorded boards look like at waves 1–10 (run-split held-out R² 0.31 early / 0.51 mid vs a wave-mean null of 0.09 / 0.07; the weight table is readable) | placement (recordings have none), the late game (11+ not predictive), and using it as a SEARCH TARGET on its own (measured: W 300 → 7.64, worse than the 6.80 baseline) | survival is the label; the pilot's rows dominate the dataset 2.4:1; a linear model of visible board shape cannot see the tempo needed to survive a tier-up. |
| Pinned lobby (`pinnedLobby` + `balance:corpus`) | the pilot's placement in the game **as shipped** against a **frozen, digest-pinned population of real player recordings** (the seat fill, the served boards, the settlement and the placements are the client's own code paths; determinism; a thin corpus censors rather than pads) | any claim that a patch changes how *players* fare, or hero/card strength beyond the pilot's own play | recordings do not adapt: a pinned job measures the PILOT against the population as it was recorded, under the CURRENT rules — a card change moves the pilot's boards and the fights, never the recorded boards' build orders, so a placement shift is "the pilot vs yesterday's players", not a new meta. The recordings' own placements are the complement of the pilot's over eight seats and are printed only for reading. Recording-vs-recording fights are the shipped tier-only path (`runLobby.ts` `settleRunLobbyRound`), the same as the live game. A corpus mixes patches (35 stamps in `set2-players-v1`); `--patch <prefix>` narrows it, at the cost of runs. |

## Next steps, in order

1. ~~Land the symmetric carry-back PR~~ (#1491, merged into this branch) — re-run the set-3 job and `compare` against the pre-fix job (`--allow-diff engineRevision,effectDigest`): hero rows that move are the carry-back-dependent ones.
2. ~~Register a set-3 opponent pool~~ — `balance:pool` builds a versioned panel from any job's round snapshots; `set3-gen-v1` (4,109 boards, waves 2–22) is the first. ~~Do the same for set 2~~ — set 2 now has the REAL corpus (`balance:corpus`, `set2-players-v1`).
2b. The pilot places ~7th against real set-2 recordings: raise pilot competence (B3/B4) and re-run the pinned smoke — a pinned job is the held-out benchmark the roadmap asks for ("human-run groups").
3. Run the first REAL patch experiment (a bounded content change, paired seeds) and read the comparison.
4. B4 strategy specialists (package manifests + curricula) so the exploration population exercises the engines the generalist ignores.
5. B7 workers + nightly entry point once throughput matters.
