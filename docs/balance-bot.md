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

## The bar (owner, 2026-09-15)

Pilot strength is measured as **mean placement over ≥ 100 pinned lobbies against the real set-2 recorded
population**: **under 4.0 = solid (the minimum to pass)**, **under 3.0 = great (the target)**, **under 2.0 =
phenomenal**; 4.4 is a below-average player and does not pass. The generalist baseline (smoke budget) is
**6.80 [6.56, 7.05]**; search depth alone did not move it (6.76 at depth 2 / beam 3). Balance findings from a
pilot below the bar are leads about the *pilot*, not the game.

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
| Pinned lobby (`pinnedLobby` + `balance:corpus`) | the pilot's placement in the game **as shipped** against a **frozen, digest-pinned population of real player recordings** (the seat fill, the served boards, the settlement and the placements are the client's own code paths; determinism; a thin corpus censors rather than pads) | any claim that a patch changes how *players* fare, or hero/card strength beyond the pilot's own play | recordings do not adapt: a pinned job measures the PILOT against the population as it was recorded, under the CURRENT rules — a card change moves the pilot's boards and the fights, never the recorded boards' build orders, so a placement shift is "the pilot vs yesterday's players", not a new meta. The recordings' own placements are the complement of the pilot's over eight seats and are printed only for reading. Recording-vs-recording fights are the shipped tier-only path (`runLobby.ts` `settleRunLobbyRound`), the same as the live game. A corpus mixes patches (35 stamps in `set2-players-v1`); `--patch <prefix>` narrows it, at the cost of runs. |

## Next steps, in order

1. ~~Land the symmetric carry-back PR~~ (#1491, merged into this branch) — re-run the set-3 job and `compare` against the pre-fix job (`--allow-diff engineRevision,effectDigest`): hero rows that move are the carry-back-dependent ones.
2. ~~Register a set-3 opponent pool~~ — `balance:pool` builds a versioned panel from any job's round snapshots; `set3-gen-v1` (4,109 boards, waves 2–22) is the first. ~~Do the same for set 2~~ — set 2 now has the REAL corpus (`balance:corpus`, `set2-players-v1`).
2b. The pilot places ~7th against real set-2 recordings: raise pilot competence (B3/B4) and re-run the pinned smoke — a pinned job is the held-out benchmark the roadmap asks for ("human-run groups").
3. Run the first REAL patch experiment (a bounded content change, paired seeds) and read the comparison.
4. B4 strategy specialists (package manifests + curricula) so the exploration population exercises the engines the generalist ignores.
5. B7 workers + nightly entry point once throughput matters.
