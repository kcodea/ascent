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
```

A **manifest** names the game being measured: mode (`selfPlayLobby` is the one wired), set, policy + search
budget, seed schedule, round cap, per-turn action cap, and `fightRules` (`corrected` = every seat fights through
the player's full combat builder — the default; `shipped` = the enemy seat through the served-board path, to
measure the game as shipped). Every record carries the manifest and an **identity** (engine revision + dirty
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
content change on a separate build (or overlay); run the candidate with the SAME manifest and seeds; `compare`
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
| Recorder / report (B5) | accepted-action reconciliation (pre/post state hash), offer → buy → play funnels per surface, spell casts by route, sold cards visible, failed/censored runs separated, lobby-level bootstrap CIs, deterministic regeneration | causal claims | everything in the report is evidence level 1 until a `compare` job exists for the change. |
| Compare (B6) | A/A = zero effect; synthetic positive control registers | a real candidate | no real patch experiment has been run yet — the first one is the next step. |

## Next steps, in order

1. ~~Land the symmetric carry-back PR~~ (#1491, merged into this branch) — re-run the set-3 job and `compare` against the pre-fix job (`--allow-diff engineRevision,effectDigest`): hero rows that move are the carry-back-dependent ones.
2. ~~Register a set-3 opponent pool~~ — `balance:pool` builds a versioned panel from any job's round snapshots; `set3-gen-v1` (4,109 boards, waves 2–22) is the first. Do the same for set 2.
3. Run the first REAL patch experiment (a bounded content change, paired seeds) and read the comparison.
4. B4 strategy specialists (package manifests + curricula) so the exploration population exercises the engines the generalist ignores.
5. B7 workers + nightly entry point once throughput matters.
