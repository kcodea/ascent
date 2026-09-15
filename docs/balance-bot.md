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
npm run balance:pilot-curve -- --job <job> [--job <job> ...] [--corpus set2-players-v1]   # B6: placement + per-wave board-stat curve vs the corpus
npm run balance:manifest -- <manifest.json>   # print the resolved manifest + identity
npm run balance:synth   -- --set set3 --seeds 20 --out synth   # a synthetic job to exercise the report
npm run balance:corpus  -- --set set2 --out set2-players-v1 [--patch 0.1.0+]   # the recorded PLAYER corpus a pinnedLobby job names
npm run balance:run     -- --manifest packages/tools/src/balance/manifests/set2-pinned-smoke.json --out set2-pinned-smoke
npm run balance:matrix  -- --manifest packages/tools/src/balance/manifests/set2-generalist-200.json --runs-per-hero 30 --out set2-matrix [--heroes a,b] [--exploration-rotate] [--workers 8]
npm run balance:findings -- --job set2-matrix --out findings.md [--format json] [--q 0.1] [--margin 0.25] [--min-support 20]
npm run balance:gap     -- --job set2-pinned-gen-dev100 [--corpus set2-players-v1] [--out gap.md] [--format json]   # the pilot ↔ real players measuring stick
npm run balance:imitation:study -- --corpus set2-players-v1 --out docs/balance-bot-player-study.md   # B7: the recorded-player study
npm run balance:imitation:fit   -- --corpus set2-players-v1 --out set2-v1                          # B7: the per-card survivor table the strategist can blend (imitationWeight)
```

**`balance:gap`** is the shared measuring stick for "how far is the pilot from real players" (2026-09-15). For a
job's PILOT seats (any seat whose `policyId` is not `recording`) against a recorded corpus (default: the one the job
names) it prints, per wave 1..16, `n`, board stat total (Σ attack + health) median and p80, minion count, golden
count, mean tier and largest-tribe share for pilot / corpus side by side; the growth multiplier (median stat total at
W ÷ W−1) per side; the top-25 card frequencies at wave ≥ 10 (share of boards holding the card) side by side; and the
pilot's placement histogram, mean with a lobby-level bootstrap 95% CI, firsts, top-3 and the **pass line** (owner
2026-09-15: **< 4.0 pass, < 3.0 strong, < 2.0 phenomenal**). The pilot side reads each `RoundRecord.snapshot` (the
served board at the end of the recruit turn; an empty board counts as 0); the corpus side groups boards into runs by
`author | hero | seed` as `playerRunsFrom` does. Descriptive (evidence level 1): a recorded board carries no
placement, so the corpus is board shape only.

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
  worth more early), tier timing against the profile (behind < on-curve > ahead), held pairs (any pair is
  two-thirds of a golden), a tiny bias to have used an affine hero power, a linear BOARD-MASS term (the gradient
  the fight terms lose once the field outgrows the pilot), an INVESTMENT term (the permanent Shop buff, Spell
  Power and the auras × rounds left), a CLUTTER penalty (unplayable non-pair hand minions on a full board), and
  the learned VALUE term (`balance/value`, `valueWeight`, default 20 utility). Weight 10 per normalized point
  (`priorWeight`); both dials are manifest fields on the budget. It steers construction; the fight decides.

The strategist also turns on two opt-in generalist behaviours (`GeneralistOptions`, both OFF for `generalist`
so its play is unchanged): the **replace macro** (`sell <weakest board minion> → buy <offer> → field it`, or
`sell → field <hand minion>`, scored as one candidate beside the search's best plan and queued with
fingerprints — depth-1 search never turns a full board over on its own) and **hand discipline** in the forced
spend (with a full board buy only a triple piece, a spell, or a body that beats the worst one by ≥ 2 stats;
refresh ahead of a marginal buy).

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
noise" (the interval reaches 0). Measured 2026-09-15 on the final build, seeds 100–119: strategist mean
placement **3.34 [3.04, 3.63]** vs generalist **6.17 [5.85, 6.50]**; paired advantage **+2.84 [2.23, 3.44]**
(n=20 lobbies); firsts 20 vs 0; top-half 59 vs 13 of 80 seats. (Before hand discipline + the replace macro the
same seeds read 4.05 vs 5.33, +1.27 [0.42, 2.13] — the turnover fixes are what widened it.) Line diversity for the exploration population is printed alongside
(9–10 distinct primaries per hero over 30 seeds for Fibbsy / Flint / Tiff, 10 viable).

**Against the real set-2 players (the owner's scale: < 4.0 solid, < 3.0 great, < 2.0 phenomenal; 4.4 is a
below-average player).** In the pinned lobby (`set2-pinned-strategist-smoke100.json`: seat 0 vs seven recorded
player runs from `set2-players-v1`, 100 lobbies, smoke budget, `fightRules: 'shipped'`) the strategist places
**6.44 [6.12, 6.76]** (first-place 0/100, 0 failed lobbies) against the generalist's **6.80 [6.56, 7.05]** on the
same seeds — a PLATEAU, not a pass. The self-play advantage does not transfer: both pilots lose to the recorded
field from wave 5 (strategist total board stats 32 / 47 / 64 / 86 / 157 at waves 5 / 6 / 7 / 8 / 10 against the
players' 36 / 60 / 97 / 162 / 456; win rate 41% → 36% → 27% → 18% → 13%). What each iteration moved and what it
did not (each a 100-lobby pinned job on the same seeds):

| change | pinned placement | note |
|---|---|---|
| line prior only (cards / runes / tier timing / pairs / hero) | 6.89 | tiered a full level earlier than the generalist (2.00 @ w3, 3.01 @ w6) — no placement gain |
| + the REPLACE macro (`sell weakest → buy → field`, opt-in on the generalist) | 6.67 | the pilot finally turns its board over from wave 7 (~1 sell per turn); bought-card tier still 2.5 at a shop tier of 3.9 |
| + board-MASS term (linear stats vs the wave reference) + INVESTMENT term (permanent Shop buff / Spell Power / auras × rounds left) | 6.63 | the evaluator's `fightStrength` reads 0 for every candidate once the field outgrows the pilot and `boardPower` is log-saturated — the prior restores a gradient, but +7 stats a turn does not catch an exponential curve |
| + PAIRS valued for every card (a golden = double stats + a tier-up Discover; players hold 0.5–1.1 goldens per board from wave 8) | 6.72 | within noise of the previous two |
| + HAND DISCIPLINE (a hand minion is credited only while the board has room; unplayable non-pair hand minions penalised; the forced spend with a full board buys only triple pieces / spells / a body that beats the worst one, refresh ahead of a marginal buy) + the LEARNED VALUE term at weight 20 | **6.44** | the board finally turns over (below); the value weight is inert within noise (0 → 6.55, 20 → 6.44, 30 → 6.48) |

Board turnover and unplayed hand by round, the two numbers the diagnosis named (strategist, final build, 100 pinned
lobbies; the generalist's hand grew 3.6 → 9.1 unplayed cards from round 6 with a board that never changed):

| round | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|
| tier | 2.20 | 2.76 | 2.99 | 3.39 | 3.93 | 4.13 | 4.83 | 5.44 | 5.80 |
| board turnover (share of the board replaced since last round) | 36% | 20% | 21% | 24% | 19% | 19% | 13% | 13% | 19% |
| hand size at end of turn | 0.9 | 1.3 | 1.8 | 2.7 | 3.7 | 4.4 | 4.7 | 5.2 | 4.4 |
| unspent Gold | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.4 | 0.5 |
| total board stats (players) | 23 (21) | 32 (36) | 47 (60) | 64 (97) | 86 (162) | 116 (265) | 157 (456) | 204 (793) | 253 (1,442) |
| win rate | 59% | 41% | 36% | 27% | 18% | 12% | 13% | 13% | 33% |

Diagnosis (for B3, not hidden here): the recorded players' boards grow 21 → 60 → 162 → 456 → 1,442 total stats
over waves 4 → 12 through goldens and per-turn engines — the Demon Shop-buff line (Demon Horse / Hank / Blart /
Butcher), Ales, Rubies, Chorus Drake / Standard Bearer Rallies, Broodfire-style Shouts under Drakko — while the
one-turn evaluator values a body by the fight it wins THIS turn against a panel it can no longer beat. A prior
capped at a few utility points steers which of two equal moves is taken; it cannot make the search see a
compounding payoff three turns out. The next lever is the evaluator / search horizon (short multi-turn
rollouts for setup decisions, as the roadmap's B3 already lists), then re-tune the prior against measured
placement. Also surfaced (and FIXED the same day, see below): the pinned report's minion funnel printed `bought 0`
for every card — the pinned runner omitted the per-seat `lineage`, so its effects fell through to the runner's
retired lean diff; the numbers above were reconstructed from `cardGained` effect events at the time.

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
- The same defect recurred in the PINNED runner (`pinnedLobby.ts` never passed a `lineage`, so it kept falling
  through to the lean `targetId` diff): fixed 2026-09-15 — the pinned lobby keeps one lineage per run, and the lean
  fallback is RETIRED (`playRecruitTurn` always attributes through `effectsFromTransition.ts`, with a throwaway map
  when a caller passes none). `pinnedLobby.test.ts` + `tools/balance/pinnedFunnel.test.ts` pin the funnel.

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

## Imitation term (B7, 2026-09-15)

The other lever beside the evaluator: learn a TARGET-BOARD signal directly from the recorded players instead of
from a hand-written proxy, and blend it into the strategist's prior. It lives in `packages/sim/src/balance/imitation/`
(trajectories → study → model → term → line fit, plus the committed `models/set2-v1.json`) and
`packages/tools/src/balance/imitation/cli.ts`:

```bash
npm run balance:imitation:study  -- --corpus set2-players-v1 --out docs/balance-bot-player-study.md   # the player study (regenerates; keeps the hand-written Findings block)
npm run balance:imitation:fit    -- --corpus set2-players-v1 --out set2-v1 [--prior 8] [--min-boards 8] [--mode after|odds] [--off focus,pairs]
npm run balance:imitation:report -- --model set2-v1 [--top 25]
```

**The study first.** [`docs/balance-bot-player-study.md`](balance-bot-player-study.md) groups the 796 boards back into
70 run trajectories (author | hero | seed) and prints the per-wave curve (stats p20 / median / p80, goldens, bodies,
tier, tribe focus, survivor and win rates), per band the cards on the most boards with their survivor rate against the
band's base and the waves their holders' runs went on for, the common card pairs, the end-game vs early-out final
boards, and the hero → tribe → core-card lines. Its five findings are at the top of that file; the one that matters for
the pilot: **the cards that predict survival are engines that the owner feeds every turn** (Bob Blart holders at waves
5–7 went on 9.8 more waves vs 5.5, Storm Chaser, Kennelmaster, Brakka, Echohorn), and the field's growth from wave 7
is ×1.6–1.9 per wave with no change in body count.

**The model** (`model.ts`) is a per-card table, one weight per wave band (open 1–4 / build 5–7 / scale 8–10 / late
11+): the mean waves-survived-after of the boards holding the card, shrunk toward the band mean with 8 pseudo-boards,
minus the non-holders', in band standard deviations (`mode: after`; the binary log-odds `odds` mode is kept), plus a
per-golden term (survivors' vs others' goldens per board, log rate ratio), a per-body term, and pair interactions beyond
the two singles (≥ 8 boards, shrunk twice as hard). A dominant-tribe-share term exists and is OFF (noise). The label is
**survival with a floor**: a board is a survivor when its run went on ≥ 3 more waves AND reached wave 12 (the median
finish) or reached 14+ — without the floor the early bands read 100% survivors (the corpus holds no run that ends before
wave 7) and learn nothing. Every weight is a sentence (`balance:imitation:report`: "players who kept X at waves 8–10
survived 5.1 vs 3.4 waves, +51%"). `scoreBoard` sums the terms for a board (+ hand minions at half credit while the
board has room); `imitationTermOf(visibleState)` is the evaluator hook; `lineSurvivorAffinity(package)` averages the
best five engine / payoff members' weights over the build + scale bands.

**Held out (5-fold by run, `set2-v1`): AUC 0.61 / 0.63 / 0.60 / 0.47 at open / build / scale / late (null 0.50),
Spearman vs waves-survived 0.22 / 0.28 / 0.27 / −0.13.** A modest predictor: the corpus is 70 runs, two authors wrote
87% of it, and card membership is a coarse view of a board. The sweep behind the defaults: `after` beat `odds` in the
open / build bands (0.61 / 0.65 vs 0.57 / 0.63); golden + size alone score 0.66 at scale; focus alone 0.45–0.54 (off);
pairs add ~0.03 at scale; prior 4–32 and min-boards 4–8 move AUC by ≤ 0.02. The late band is not predictive — read its
rows as description.

**Wired as an opt-in** through the existing `withEvaluationPrior` hook (`strategy/prior.ts`, the `imitation` term of
`linePriorBreakdown`; `evaluate.ts` untouched): `imitationWeight` (utility per log-odds point, default `IMITATION_WEIGHT`
= 0 = off), `imitationLineWeight` (line ranking becomes fit × (1 + w × survivor affinity); default 0) and
`imitationVariant` ("positive" = never push away from a held card, "cardsOnly" = no golden / size terms) are budget fields
on the manifest. The generalist is untouched.

**Measured (100 pinned set-2 lobbies each, seeds 1–100, smoke budget, `fightRules: shipped`, paired against the
baseline on the same seeds; the baseline reproduces the B4 number exactly):**

| variant | mean placement [95% CI] | firsts | top-3 | paired Δ vs baseline [95% CI] | board stats w8 / w10 / w12 (players 139 / 432 / 1,109) | goldens w10 |
|---|---|---|---|---|---|---|
| baseline `set2-pinned-strategist-b7-base` (= B4 strategist) | **6.44 [6.12, 6.76]** | 0 | 7 | — | 83 / 133 / 253 | 0.69 |
| imitationWeight 3 | 6.63 [6.35, 6.91] | 0 | 2 | +0.19 [−0.01, 0.39] | 79 / 124 / 228 | 0.73 |
| imitationWeight 6 | 6.63 [6.36, 6.90] | 0 | 2 | +0.19 [−0.06, 0.44] | 74 / 140 / 320 | 0.82 |
| imitationWeight 10 | 6.63 [6.35, 6.91] | 0 | 2 | +0.19 [−0.07, 0.45] | 81 / 118 / 178 | 0.88 |
| imitationWeight 6 + imitationLineWeight 1 | 6.71 [6.45, 6.97] | 0 | 1 | +0.27 [0.01, 0.53] | 76 / 140 / 211 | 0.79 |
| imitationWeight 6, `positive,cardsOnly` | 6.57 [6.29, 6.85] | 0 | 3 | +0.13 [−0.11, 0.37] | 82 / 129 / 233 | 0.75 |
| imitationWeight 3, `positive` | 6.56 [6.28, 6.84] | 0 | 3 | +0.12 [−0.07, 0.31] | 83 / 138 / 209 | 0.88 |
| imitationWeight 6, `cardsOnly` | 6.62 [6.34, 6.90] | 0 | 1 | +0.18 [−0.07, 0.43] | 83 / 142 / 298 | 0.57 |
| imitationLineWeight 1 only | 6.62 [6.34, 6.90] | 0 | 5 | +0.18 [−0.05, 0.41] | 83 / 132 / 194 | 0.78 |

**It does not move placement** (every variant within noise of the baseline or slightly worse; none better). It DOES
move the boards: at round 8 the pilot's boards under weight 6 hold Cinderchef 45% (30% baseline), Bob Blart 21% (0%),
Storm Chaser 18% (0%), Imp Overseer 24%, Standard Bearer 16%, and Embermouth Whelp drops from 15% to 0; goldens per
board at wave 10 rise from 0.69 to 0.82–0.88 under the heavier weights. Stat totals do not follow: the pilot holds the
survivors' engine cards and does not run them — Bob Blart with nothing consumed into it, Storm Chaser with no spells
cast, is a below-curve body. Line shaping is worse for a visible reason: at weight 1 the survivors' table sends 29 of
51 heroes into `demonConsume` (25 heroes change primary), because Bob Blart is the single strongest weight in the
corpus, and the pilot cannot operate that line either. The conclusion is the same one the value model reached from the
other side: **the recordings can say what a surviving board holds; they cannot teach a one-turn search how to feed it.**
`IMITATION_WEIGHT` stays 0. What the lever leaves behind: the study, a readable per-card survival table, a line
affinity that names the corpus' real lines (Demon consume, Kobold spell, Beast echo — and the finding that the
`ale` package's members are NOT the Dwarf cards the survivors held: Brakka sits in `tempo`, Gangplank scores < 2),
and the sweep infrastructure (`b7-*` manifests).

## Engine growth (B6, 2026-09-15)

The B4 diagnosis said the one-turn evaluator cannot see that an engine card is worth more than a vanilla body of
the same stats. B6 gives it that sight EMPIRICALLY — by running the engine, never by a per-card table
(`packages/sim/src/productionBots/growth.ts`, the probe session in `transition.ts::probeFuture`):

- **The probe.** For a candidate state, a private clone of the state behind its projection is driven through ONE
  scripted turn: End of Turn fires (`faceOmen { deferFight }` — the side is prepared, no fight is resolved), a
  neutral 0-damage draw lands (`resolveCombat`: start-of-turn grants, Gold refill, an IMAGINED shop drawn from a
  per-decision panel seed exactly as `sampleCandidate` replaces the hidden future), the turn's prompts are
  answered (first option / skip a forge), the held bodies are fielded (selling the weakest printed body to make
  room when the board is full, at most two), up to three bodies of the dominant tribe are bought and fielded, the
  spell offer is bought and cast, and the spells the turn GENERATED (a Dwarf's Ale, a Kobold's Ruby, a triple's
  reward — never a spell the pilot already held, which would reward hoarding it) are cast. The yield is total
  board + hand-minion stats after minus before minus the printed stats of what the script bought. A vanilla
  body yields 0; a shop-buff line, a per-spell scaler, a Gourmand's End-of-Turn Consume yield their real number
  in the real context. The clone has no lobby (no other seat's board is ever touched), the served board for the
  wave is pinned to none, and a frozen shop never carries into the imagined turn. Memoised on (composition,
  panel seed): board with order, hand, runes, auras, counters, quests, equipment, tier, hero — not Gold, not the
  current shop.
- **Combat carry-back.** Every `fightScore` fight already computes the permanent gains a fight leaves on the run
  (`CombatResult`'s `playerPermaBuffs`, hand buffs, card-type buffs, the Shop-buff / Spell-Power / Ruby-bonus /
  tribe-aura channels, generated Rubies and hand grants); `carryBackOf` sums them (channels at `CHANNEL_USES` = 8
  future uses, a generated card at a flat 6) and `FightResult.carryBack` carries the panel mean.
- **The Rally trial.** A board the field outgrows dies before it swings, so its Rally engines (Standard Bearer,
  Paragon, Chorus Drake, Hungerling — on every recorded late board) carry back 0 from the panel: the
  chicken-and-egg of the diagnosis. `rallyTrial` fights the board once against a WALL (seven 0-Attack bodies
  whose total Health is two rounds of the board's Attack) and reads the permanent gain — the engine's potential
  once it gets to attack. The term takes the larger of the realised panel carry-back and the trial, never both.
- **The term.** `growth = clamp((probe.delta + combat) / (8 + 7·wave), −0.5, 2.5) × min(1, turnsLeft / 6)` with
  `turnsLeft = 16 − wave` — one turn's engine yield relative to a healthy board at the wave, credited by the turns
  left to cash it. `EvaluationBreakdown.growth`, weight 0 in the shipped config; the strategist installs a scope
  per decision (`withGrowth`, one panel seed per pilot × round, so every candidate is probed against the same
  imagined future) at `budget.growthWeight` (manifest field; default `GROWTH_WEIGHT` = 20; 0 = no probe at all,
  which is how the pre-B6 strategist is reproduced — `set2-pinned-strategist-b6-g0-smoke100.json`).
- **Cost.** ~1.8 ms per probe (≈ 10 reducer dispatches on a lobby-less clone) plus one wall fight; memoised across
  a turn's decisions. A pinned lobby went from 4.2 s to 6.1 s (1.5×) with the term on.

Defects the probe's traces surfaced and this PR fixes (each measured in a "g0" arm below, growth off):
**Rubies were never cast** — `recruitCandidates` treated `ruby: true` as a minion (a seat index, gated on a full
board), which the reducer refuses, so the pilot held hands of six Rubies to elimination; **two held Rubies read
as a pair** in the prior (3 utility to hold rather than cast — spells and Rubies never triple, in `evaluate` too);
**a frozen shop** made the probe read the real offers as next turn's shop and score "freeze" over "buy"
(freeze → forced roll → freeze burned 8 Gold in a turn); the forced spend with a full board **rolled before every
buy** (the comment said "ahead of a marginal buy"); and a forced hand play the search had just rejected started a
play → sell loop that hit the 60-action guard (seed 52, round 11) — forced plays are now tolerance-gated.

**Measured** (100 pinned set-2 lobbies each, seeds 1–100, smoke budget, corpus `set2-players-v1`, hero rotated by
seed; `balance:pilot-curve` prints these tables from any job; paired Δ = same-seed placement difference):

| job | mean placement [95% CI] | paired Δ vs the 6.44 baseline | 1st | top-4 | board stats w8 / w10 / w12 (median) | win% r7 / r8 |
|---|---|---|---|---|---|---|
| baseline `set2-pinned-strategist-smoke100` (pre-B6 build) | 6.44 [6.12, 6.76] | — | 0 | 16% | 83 / 133 / 253 | 29 / 19 |
| Ruby cast fix only (growth 0) | 6.51 [6.20, 6.82] | +0.07 [−0.08, +0.22] | 0 | 15% | 81 / 160 / 253 | 32 / 21 |
| probe + carry-back + trial, weight 8 / 12 / 20 | 6.40 / 6.37 / 6.49 | −0.04 / −0.07 / +0.05 (each ± 0.28) | 0 | 15–18% | 97 / 181 / 321 at w12 | 34 / 20 |
| + replace-to-field, forced spend buys first — growth 0 | 6.60 [6.31, 6.88] | +0.14 [−0.08, +0.36] | 0 | 12% | 81 / 153 / 220 | 30 / 19 |
| … growth weight 12 / 20 | 6.30 / **6.27 [5.97, 6.57]** | −0.14 / −0.17 [−0.44, +0.10] | 0 | 13% / 19% | 96 / 162 / 259 · 104 / 180 / 305 | 37 / 26 · 37 / 25 |
| + Ruby pairs fix, forced-play guard, channels ×8 — growth 0 | 6.55 [6.28, 6.82] | +0.11 [−0.12, +0.34] | 0 | 13% | 86 / 121 / 192 | 25 / 20 |
| … growth weight 12 / 20 (**the shipped build, default 20**) | 6.41 / 6.39 [6.12, 6.66] | −0.03 / −0.05 [−0.30, +0.20] | 0 | 9% / 11% | 93 / 163 / 307 · 98 / 176 / 319 | 35 / 24 · 32 / 25 |
| recorded players (corpus medians) | 4.38 (their own placements) | | | | 139 / 432 / 1,109 | |

Growth ON vs OFF within one build, paired by seed: −0.28 [−0.56, −0.01] (weight 12) and −0.31 [−0.56, −0.07]
(weight 20) on the third build; −0.14 [−0.38, +0.10] and −0.16 [−0.38, +0.06] on the shipped one. Against the
pre-B6 baseline every candidate sits inside its interval.

**What worked.** The evaluator now has an engine gradient and uses it: the pilot's board-stat curve rises 20–35%
at waves 8–10 (83 → 98–104 at w8, 133 → 176–181 at w10), its unplayed hand at round 8 falls from 3.7 to 1.9
cards, its round-7/8 win rate rises from 29/19% to 35–37/25%, and the traces show it doing the right things — it
moved a Chorus Drake next to a Transcendence to Engrave it and cashed +28 Health the next fight; it turned a
Tier-1 body board into Tapkeeper / Mountainbond / Arnold Dwarves probing +86 → +107 a turn. The probe measures
what it claims (`growth.test.ts`: an Arnold outyields a stat-identical vanilla in the same imagined future; a
Paragon board leaves stats against the wall, a vanilla none; the root, the live run and the handle store are
byte-identical after a probe; two panel seeds imagine two futures; a foreign projection probes null).

**What did not.** Placement. The recorded curve is not 30% steeper, it is exponential — 139 → 432 → 1,109 at
waves 8 / 10 / 12 against the pilot's 98 → 176 → 319 — and the pilot still takes twice the damage per round that
the recordings take from each other (9.9 vs 5.4 at round 8; the shipped recording-vs-recording fight is the
tier-only path) and is eliminated at round 9–10 in 60 of 100 lobbies. A one-turn yield credited linearly cannot
price a Gourmand that eats a Hungerling-buffed shop every turn (recorded: 7/8 → 55/59 → 219/271 → 567/731 over
waves 5–12) or a Standard Bearer under Engraved Dwarves; the engines that do pay arrive at waves 8–9 in the
pilot's runs, two to three waves after the players', because until fielded they read 0 and the fight term (26)
and the line prior (10) outweigh them. The wall trial over-credits "when a Demon deals damage" Leeches (41 of 100
wave-10 boards under weight 20). Zero first places in 900 candidate lobbies.

**The single next lever.** Compounding, not weight: a two-turn probe (K = 2 scripted turns, the second on the
first's outcome) whose SECOND-turn yield is the credited number — an engine whose yield grows turn over turn is
the recorded curve's whole shape, and one turn cannot see it — scored against corpus boards at wave + 2 rather
than the same-wave panel (`poolPanel` takes a wave; the probe's clone knows its own). Budget it by probing only
the root and the search's top-3 end states.

## Pinned-lobby fairness audit (B10, 2026-09-15)

**Question.** Is `pinnedLobby` FAIR to the pilot — does seat 0's experience in
`packages/sim/src/balance/pinnedLobby.ts` match what a real player gets in the shipped lobby? Prompted by the B6
reading that "the pilot takes ~2× the per-round damage the recordings take from each other (shipped tier-only
path)", filed as an asymmetry of the game as played.

**Verdict: clean.** No defect was found where the pilot is handicapped relative to a real player. Every round of a
pinned lobby is the client's own code path — the same `createLobbyRun` → `createRunLobby` seat fill, the same
`faceOmen` served-board fight, the same `settleRunLobbyRound` / `closeRunLobbyRound` settlement — with the pilot
on the `'lobby'` mode run the client creates on hero select. Nothing was fixed; the evidence below is pinned by
three tripwire tests in `pinnedLobby.test.ts` ("B10 fairness tripwires"): the runner's table equals
`createLobbyRun(seed, hero, {}, 'lobby')`'s seat for seat; every fought encounter is charged by one formula for
pilot and recordings alike; every seat is placed by the shipped shared-placement rule.

**The "2× damage" claim is a LOSS-RATE effect, not a fight asymmetry.** Read off the shipped-build job
(`b6-r4-g20`, 100 lobbies): the damage a seat takes *when it loses* is the same for the pilot and for a recording
losing to another recording — 12.4 vs 12.7 at round 8, 13.0 vs 12.9 at round 9, 14.4 vs 13.7 at round 10 — because
both fights charge `winner tier + Σ surviving-minion tiers`, capped by `lossDamageCap(round)`, through the same
`hitSeat`. The per-round MEAN differs (9.0 vs 5.5 at round 8) because the pilot loses 73% of its round-8 fights and a
recording loses 43% of its (the rest are wins and ~10% draws, which cost 0). Early it is the other way round: at
rounds 1–4 the pilot loses 13–29% against the recordings' 34–46%. The pilot's placement is its board, not the table.

| round | pilot: n / loss % / mean taken / mean taken ON A LOSS | recordings: n / loss % / mean taken / mean taken ON A LOSS |
|---|---|---|
| 4 | 100 / 28% / 1.7 / 5.9 | 700 / 46% / 2.7 / 5.9 |
| 6 | 100 / 52% / 4.6 / 8.9 | 700 / 47% / 4.0 / 8.4 |
| 8 | 99 / 73% / 9.0 / 12.4 | 693 / 43% / 5.5 / 12.7 |
| 10 | 54 / 85% / 12.3 / 14.4 | 528 / 45% / 6.2 / 13.7 |
| 12 | 8 / 88% / 15.8 / 18.0 | 344 / 48% / 8.4 / 17.5 |

| # | Claim | Evidence (file:line) | Verdict |
|---|---|---|---|
| 1a | Recording-vs-recording fights are a REAL `simulate()` of both recorded boards, not a tier/power estimate | `lobby/runLobby.ts:584-607` — `driverFor(a).prepare(round)` / `driverFor(b).prepare(round)`, then `simulate(boardA.minions, boardB.minions, rng, CARD_INDEX, combatSide({ tier: boardA.tier }), combatSide({ tier: boardB.tier }))` | ✅ real fight; both sides `combatSide({ tier })` only (no snapshot scalers — the "tier-only path") |
| 1b | The pinned runner uses the identical code path for those six fights | `balance/pinnedLobby.ts:224` dispatches `resolveCombat`; `reducer.ts:4188-4195` → `settleRunLobbyRound` — the runner never resolves a non-player fight itself. After the pilot falls it calls `settleRunLobbyRound` directly (`pinnedLobby.ts:242`) with a dead-seat result nobody reads (`pairRunLobby` pairs living seats only, `runLobby.ts:313`) | ✅ identical |
| 1c | The damage formula is the same for seat 0's fight and the recordings' fights | `core/src/combat/simulate.ts:4185-4188` (`playerDamage = enemyState.tier + Σ survivor tiers`) and `:4204-4207` (`enemyDamage` = the mirror); the player's fight caps it at `reducer.ts:3356` (`lossDamageCap(s.wave)`) and again at `runLobby.ts:577-578`; seat fights cap at `runLobby.ts:605-606` with `seatDamageMult = 1` (no practice-bot seat, `:565-566`). Charged through one `hitSeat` (`:449-454`) | ✅ identical; measured per-loss damage equal (table above) |
| 1d | The RECORDING fights the pilot at full strength but other recordings at tier-only | `reducer.ts:3388-3395` — the lobby foe's `snapshot` goes through `sideFromSnapshot` (spell power, auras, quests, runes); `runLobby.ts:600-601` — `combatSide({ tier })` for seat-vs-seat | ⚠️ true, and SHIPPED: a real player faces the same. Named in the trust ledger since B1. Not a pilot handicap — it makes the recordings *weaker against each other*, which is the same table a human sits in |
| 2a | The pilot faces the paired recording's board at the pilot's CURRENT round, stats verbatim | `runLobby.ts:433-447` `playerOpponent` → `driverFor(foe).prepare(lobby.round)`; `lobby/seats.ts:81-85` `recordedSeat.prepare(round)` → `boardAt(sorted, round)` (`:40-50`: exact wave, else the closest earlier, else the earliest); `toPrepared` (`:52-59`) copies the bodies and keeps the snapshot. Served through `lobbyOpponentBoard` (`:745-755`) in `faceOmen` (`reducer.ts:3388-3391`) | ✅ same lookup the client makes |
| 2b | Past the recording's last wave it repeats its final board | `runLobby.ts:445`, `:584-585`, `:428` — `prepare(round) ?? finalBoard()`; `DEFAULT_LOBBY_RULES.exhaustion: 'repeatFinal'` (`lobby/lobby.ts:12`) | ✅ identical in both |
| 2c | Ghost / knockout handling | ghost = most recently fallen seat's board from the round it died (`runLobby.ts:416-431`), bye only to the bottom three by standing (`:373-389`); the pilot's ghost fight goes through `playerOpponent` → the reducer and settles from that one result (`:623-628`) | ✅ identical (the runner records it as `bye`, `pinnedLobby.ts:79-81`) |
| 3a | Recordings lose Resolve per the settled fights and can be eliminated | `runLobby.ts:609-618` — `hitSeat` + `knockOutIfDead` for BOTH seats of every pairing; `:674-680` the one knockout test | ✅ not on rails |
| 3b | The pilot's starting Resolve / Armor equal a real player's for that hero | `runLobby.ts:776-778` `createLobbyRun`: `me.resolve = run.resolve; me.armor = run.armor` (the hero's own pools); the client calls the same function (`ui/src/store.ts:1791`); the runner asserts seat and run agree every round (`pinnedLobby.ts:231`) | ✅ identical |
| 3c | Recordings start at the lobby rules' 30 / 15 while the player (pilot OR human) starts at 30 / hero Armor | `runLobby.ts:260-261`, `:201`; `DEFAULT_LOBBY_RULES` (`lobby/lobby.ts:8-9`). Playable heroes' Armor today: mean **11.25**, range 4–18, only 7 of 53 at ≥ 15 | ⚠️ SHIPPED asymmetry, same for a human — every non-player seat carries 3.75 more Armor than the average hero. Not a pinned defect; **an owner question** (see below) |
| 4a | Placement is computed the same way as a real player's | `runLobby.ts:688-707` `closeRunLobbyRound` — the only writer of `placement`, reached from the reducer's `settleLobbyRound` (`reducer.ts:4188-4195`); the run ends at `gameover` when `playerEliminated` (`reducer.ts:4750-4753`). Ties: simultaneous knockouts SHARE the worse place (`remaining + eliminated.length`, `:700`; rule stated at `lobby/lobby.ts:190-193`); wipeout guard `:690-695` | ✅ identical |
| 4b | The recordings' mean placement should be (36 − pilotMean) / 7 | Measured on `b6-r4-g20`: pilot 6.39, recordings **4.49**, expected-if-sum-36 4.23. But the per-lobby placement sum averages **37.80**, not 36 — 97 of 100 lobbies had at least one shared placement (two seats knocked out in one round both take the WORSE place). (37.80 − 6.39) / 7 = **4.49** | ✅ consistent: the complement over the actual sum. The (36 − p)/7 expectation is wrong under the shipped tie rule |
| 5a | Seating: seeded shuffle, unique heroes, real authors | `runLobby.ts:238` `shuffleRuns(playerRunsFrom(…, setId), makeRng(seed ^ 0x2545f491))`; `:246` unique heroes; `:198` `playableHeroes()`; the pilot's `createLobbyRun` call (`pinnedLobby.ts:146`) differs from the client's (`store.ts:1791`) only by an explicit default `maxRounds: 60` | ✅ identical (tripwire test: seat-for-seat equality) |
| 5b | "Wave-first" matchmaking | Not a lobby concept: in the lobby the opponent is the paired SEAT (`docs/GAME-RULES.md` "Matchmaking"); the pool-path `pickOpponent` serves non-lobby modes only | n/a |
| 5c | Corpus population = the client's population | `balance/corpus.ts:1-15` pulls every real one-set board by REST paging; the client (`ui/src/remoteBoards.ts:304-335`) pulls the newest **120 per wave** for waves 1..`CONFIG.courseRounds` (17), `patch like '<version>+%'` (`store.ts:99`). On `set2-players-v1`: 796 boards, 70 runs, 8 authors; every patch stamp begins `0.1.0+` (35 stamps, all pass the client filter); the busiest wave has 70 boards (< 120); 2 boards sit at wave 18 (the client never fetches them; `boardAt` would serve them only at round ≥ 18). The client also registers the player's OWN local boards (`ui/src/boardLibrary.ts:166`), so a human may face their past selves | ✅ same population today. Two future drifts to know: a wave past 120 boards (the client caps, the corpus does not) and the `courseRounds` wave ceiling |
| 5d | Survivorship: a wave-12 recording is a wave-12 survivor | True, and the same for a human: `playerRunsFrom` (`snapshotSeats.ts:38-71`, ≥ 4 waves) groups the same uploads for both; a run that died at wave 8 keeps fielding its wave-8 board (2b) in both. Author concentration (LazerLemon 421 + Orangez 267 of 796 boards) is uncapped by owner rule 2026-09-13 in both | ✅ identical |
| 5e | Hero choice | client: a 3-hero offer from `playableHeroes(tribes)` (`store.ts:103-119`); runner: the roster rotated by seed with the same tribe gate (`pinnedLobby.ts:56-66`) | ✅ same eligibility; a different sampling of it (by design — a job must cover the roster) |
| 6 | Hero powers, Runeforge, quests, Discovers at the same rounds | the pilot's turn is real reducer actions on the `'lobby'` run (`balance/seatRunner.ts:100-171`); every prompt is the pilot's to answer or the seat FAILS (`:143-153`) — nothing is skipped or auto-resolved; `faceOmen` is the shipped End Turn (`deferFight: false`, `pinnedLobby.ts:211`) | ✅ identical. The pilot has no shop clock (a human does) — if anything an advantage |

**Owner question surfaced (not changed).** In the shipped lobby every recorded / generated seat starts at
`startingArmor: 15` while the player's seat starts at their hero's Armor (4–18, mean 11.25). A human and the pilot
are handicapped identically, so it is not the instrument's problem — but it is a ~8% health deficit against the
table for the average hero, and a recording's `heroId` is known, so seating it at its own hero's Armor is a
one-line change if that is the intent. Filed here for a ruling; nothing in this PR changes it.

**What this means for the numbers.** 6.39–6.44 is the pilot's real standing in the game as played against
`set2-players-v1`. Reading the recordings' 4.46–4.49 as "the population's mean" is fine; reading it as "4.23 was
expected, so something leaks" is not — the shared-placement rule lifts every mean. The B6 sentence "the pilot takes
~2× the per-round damage … is the game as played" should be read as "the pilot loses ~2× as often from round 6";
per-loss damage is identical. Re-running the same manifest on this branch (`audit-after`) reproduces the baseline
by determinism — nothing in the instrument changed.

## Trust ledger

What each layer proves today, and what it does not. Check the boxes as the gates in the roadmap's
"Validation and release gates" are met.

| Layer | Trustworthy for | NOT yet trustworthy for | Why |
|---|---|---|---|
| Runner (B1) | recruit turns are real reducer transitions; one `simulate()` per pair; armor-first settlement; eliminations, byes, ghosts, placement per the shipped lobby rules; determinism; **both seats keep their combat carry-backs** (#1491: `CombatResult.enemyCarry`, ≈70 of 96 side-gates made symmetric, shipped result byte-identical over 1,278 captured fights) | six documented `KNOWN ASYMMETRY` groups | the enemy's Grim-style tally stays the snapshot's frozen value mid-fight; enemy spell power / Imp aura / hand-buff snapshots are static for the fight (gains still carry back); Pack Mentality live growth, mid-combat quest completion, Blood Trail / Soulbind / Echo Warden / Rallying Offensive extras and telegraph events are player-only. Listed in `simulate.ts` by name. |
| Fight context | `corrected` rules give every seat the player's full context (spell power, Ruby casts, Reveler values, banked Start-of-Combat effects, alignments) | claims about the game **as shipped** | the shipped non-player fight is tier-only (`lobby/runLobby.ts:590`, `:629`) and served boards carry no alignment; run with `fightRules: 'shipped'` to measure that, and read the discrepancy list in `seatRunner.ts`. |
| Pilot (B3) | buying, playing, tiering, selling, refreshing, freezing, targeted Shouts, Choose One, Discover, triples, hero powers, Equipment, Starform; no illegal actions; decisions are player-legal (reveal-by-effect, hidden future never read) | **strategy competence** at the level of a good player; late-game spending (unspent Gold climbs past round 12); no strategy specialists yet (B4) | single-turn benchmark vs the legacy greedy: set2 +0.85 [0.69, 1.01], set3 +0.70 [0.38, 1.02]; deeper budgets show no measurable single-turn gain (dev vs smoke 0.00 [−0.38, 0.38]) — multi-turn value unproven. Unsupported content must be labelled, not ranked as weak. |
| Strategist (B4) | plays a declared line (primary + secondary package) with the generalist's legality and information boundary; takes affine runes, engine pieces and profile-timed tiers in the curricula; turns its board over from wave 4 (13–36% per round) with a hand under 3 from B6; casts its Rubies (B6); BEATS the generalist in mixed self-play (the 20-seed numbers are in the B4 section); line diversity 9–10 primaries per hero over 30 seeds under `strategist:rotate` | **competence against real players** — 6.39 [6.12, 6.66] in 100 pinned set-2 lobbies with the B6 growth term (6.44 before it; owner scale: < 4.0 passes); a claim that a line is STRONG or WEAK (fit is a construction prior, not a strength estimate); packages a set cannot field (labelled unsupported) | the prior is capped and one-turn; the evaluator's fight terms lose all gradient once the field outgrows the pilot (B3 work); the learned value term is inert within noise at any weight tried; the hero intent manifest is hand-maintained design intent, not measured. |
| Engine growth (B6, `productionBots/growth.ts`) | that a candidate board's ENGINES yield more than a vanilla one, measured by running the engine (a probed turn on an isolated clone + the fight's own carry-back + a Rally trial) — the pilot's board curve is 20–35% higher at waves 8–10 and its hand empties; the probe reads nothing the pilot cannot see (tests pin isolation, replaced futures, a null on foreign projections) | **placement** — growth on vs off is −0.15 to −0.3 placements paired; against the pre-B6 baseline every weight tried (8 / 12 / 20) is inside the interval; 0 first places; the wall trial is a POTENTIAL (it over-credits a Leech-style "when a Demon deals damage" engine that a real fight never lets swing) | one turn's yield credited linearly cannot price compounding (the recorded curve triples every two waves); the engines are bought two to three waves late because until fielded they read 0; the pilot's per-round damage (~2× the recordings') is a LOSS-RATE difference, not a fight asymmetry — per-loss damage is identical (B10 audit above). |
| Recorder / report (B5) | accepted-action reconciliation (pre/post state hash), offer → buy → play funnels per surface, spell casts by route, sold cards visible, failed/censored runs separated, lobby-level bootstrap CIs, deterministic regeneration | causal claims | everything in the report is evidence level 1 until a `compare` job exists for the change. |
| Compare (B6) | A/A = zero effect; synthetic positive control registers | a real candidate | no real patch experiment has been run yet — the first one is the next step. |
| Learned value (`sim/balance/value`) | what SURVIVING recorded boards look like at waves 1–10 (run-split held-out R² 0.31 early / 0.51 mid vs a wave-mean null of 0.09 / 0.07; the weight table is readable) | placement (recordings have none), the late game (11+ not predictive), and using it as a SEARCH TARGET on its own (measured: W 300 → 7.64, worse than the 6.80 baseline) | survival is the label; the pilot's rows dominate the dataset 2.4:1; a linear model of visible board shape cannot see the tempo needed to survive a tier-up. |
| Imitation (`sim/balance/imitation`, B7) | what the recorded SURVIVORS' boards hold, card by card and per wave band (run-split AUC 0.61 / 0.63 / 0.60 at open / build / scale, every weight readable as "holders survived X vs Y waves"); the player study's per-wave curve, goldens, tribe and line tables | placement (no variant moved it: 6.56–6.71 vs 6.44 baseline over 100 paired pinned lobbies), the late band (AUC 0.47), per-hero claims (≤ 4 runs per hero), and line choice (weight 1 sends 29 of 51 heroes into Demon consume) | card membership is not engine operation: the pilot fields Bob Blart / Storm Chaser and never feeds them; two authors wrote 87% of the corpus. |
| Pinned lobby (`pinnedLobby` + `balance:corpus`) | the pilot's placement in the game **as shipped** against a **frozen, digest-pinned population of real player recordings** (the seat fill, the served boards, the settlement and the placements are the client's own code paths; determinism; a thin corpus censors rather than pads) | any claim that a patch changes how *players* fare, or hero/card strength beyond the pilot's own play | recordings do not adapt: a pinned job measures the PILOT against the population as it was recorded, under the CURRENT rules — a card change moves the pilot's boards and the fights, never the recorded boards' build orders, so a placement shift is "the pilot vs yesterday's players", not a new meta. The recordings' own placements are the complement of the pilot's over eight seats and are printed only for reading. Recording-vs-recording fights are the shipped tier-only path (`runLobby.ts` `settleRunLobbyRound`), the same as the live game. **Audited fair to the pilot (B10, 2026-09-15): seat fill, served boards, damage formula, settlement, placement and hero eligibility are the client's own paths; the one asymmetry (player seat at hero Armor, every other seat at 15) is shipped and hits a human identically.** A corpus mixes patches (35 stamps in `set2-players-v1`); `--patch <prefix>` narrows it, at the cost of runs. |

## Next steps, in order

1. ~~Land the symmetric carry-back PR~~ (#1491, merged into this branch) — re-run the set-3 job and `compare` against the pre-fix job (`--allow-diff engineRevision,effectDigest`): hero rows that move are the carry-back-dependent ones.
2. ~~Register a set-3 opponent pool~~ — `balance:pool` builds a versioned panel from any job's round snapshots; `set3-gen-v1` (4,109 boards, waves 2–22) is the first. ~~Do the same for set 2~~ — set 2 now has the REAL corpus (`balance:corpus`, `set2-players-v1`).
2b. The pilot places ~7th against real set-2 recordings: raise pilot competence (B3/B4) and re-run the pinned smoke — a pinned job is the held-out benchmark the roadmap asks for ("human-run groups").
3. Run the first REAL patch experiment (a bounded content change, paired seeds) and read the comparison.
4. ~~B4 strategy specialists (package manifests + curricula)~~ — shipped as the strategist pilot, which beats the
   generalist in self-play but plateaus at 6.4 against the recorded players. ~~B7 imitation term~~ — built and
   measured (above): a target-board prior learned from the recordings moves the pilot's boards toward the survivors'
   cards and moves placement not at all, because the pilot does not OPERATE the engines it now holds. Next, in order:
   (a) an engine-operation model — score a candidate turn by how much it FEEDS the engines on the board (consumes into
   Blart, spells past Storm Chaser / Chorus Drake, summons past Kennelmaster, Ales past Brakka) and give the search the
   horizon to see the payoff (short multi-turn rollouts for setup / replace decisions, B3); the study's finding 2 is
   the spec; (b) ~~fix the pinned report's buy attribution~~ (done 2026-09-15; still owed: record the strategist's line on pinned seats); (c) THEN
   tune the prior's weights against pinned placement (`bot:tune`-style search, never hand-feel).

   generalist in self-play but plateaus at 6.4 against the recorded players. ~~(a) an engine gradient the prior
   cannot fake~~ — B6's growth term (a probed turn + carry-back + the Rally trial) raised the board curve 20–35% and
   moved placement only within noise (6.39). Next, in order: (a′) a TWO-turn probe whose second-turn yield is the
   credited number, scored against corpus boards at wave + 2 (compounding is the recorded curve's whole shape);
   (b) fix the pinned report's buy attribution; (c) THEN tune the prior's and growth's weights against pinned
   placement (`bot:tune`-style search, never hand-feel) and run a `strategist:rotate` job per hero.
5. B7 workers + nightly entry point once throughput matters.
