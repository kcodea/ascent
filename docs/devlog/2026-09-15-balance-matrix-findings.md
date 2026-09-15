# 2026-09-15 — Balance bot: the hero matrix runner + the outlier findings report

Owner ask: "sim it 30 times for every hero where it picks different lines and runes and cards and comes back with
general balance results … catch the outliers on both overpowered and underpowered cards / runes / heroes … report
all data and findings back to me." Branch `feat/balance-matrix` onto `feat/balance-bot`. Tools + the balance
contract only; no player-facing change (no patch note).

## What shipped

- **`balance:matrix`** (`packages/tools/src/balance/matrix.ts`) — plans every playable hero of the set × N runs
  as ONE resumable job: seat 0 pinned to the hero (`manifest.pinnedHero`, honoured by `rotateHeroes`), the SAME
  N seeds for every hero (paired), `exploration = (seed − start) mod K` when `--exploration-rotate` is given (a
  strategist pilot's hook; today's pilots ignore it), lobby files keyed `<hero>-<seed>`, progress + ETA,
  `--workers N` child-process sharding. Runner by `mode`: `selfPlayLobby` today, `pinnedLobby` behind a dynamic
  import that names `feat/balance-pinned` when absent.
- **`balance:findings`** (`findings.ts`) — the owner-facing markdown / JSON report: coverage first (heroes ×
  planned / complete / failed, lines played, the UNEXERCISED list), then FDR-controlled outlier scans over
  heroes, runes, minions, spells (lobby-level bootstrap, two-sided bootstrap p, Benjamini–Hochberg q = 0.1 per
  family, a 0.25-placement margin, minimum support 20), the always-bought / never-bought lists, sparse-suppressed
  interactions, pacing + strategy concentration, and a "what to test next" list of bounded candidate patches.
- **Contract (additive, `types.ts`)**: `ExperimentManifest.pinnedHero / exploration / matrix`,
  `EffectEvent.forced`, `RunRecord.line` (B4's shape) — so the strategist and pinned-lobby branches drop in.
- **Store**: matrix lobbies keyed by `(pinnedHero, seed)`; a record's derived per-lobby manifest is accepted
  against the job's base manifest (`manifestMatches`); `rejected` rows now carry their file key.

## Three instrument defects found on the way (all fixed here)

1. **Real jobs had no card funnel.** `seatRunner.effectsOf` (B1) keys `cardGained` / `cardPlayed` / `cardSold`
   by `targetId`; the aggregate (B5) reads the recorder's attributer shape (`sourceId`, lineage routes). Every
   real job's minion / spell table therefore read "bought 0, played 0" — only the synthetic fixture (which uses
   the B5 shape) ever exercised those columns. `playRecruitTurn` now takes a per-seat `lineage` map and derives
   effects through `effectsFromTransition.ts`; `selfPlayLobby` keeps one map per seat across turns.
2. **Survivorship / exposure would dominate every rune / late-card lift.** Owners of a rune are, by construction,
   the seats that lived to round 6+ and reached a forge. The findings lift compares an owner against the seats of
   its own lobby with the same exposure (a forge visit / the card in an offer), alive at the acquisition round,
   that never held it. (In this smoke every living seat visits the forge at rounds 6 and 9, so the exposure gate
   changed nothing for runes; it matters for cards and for modes where the forge is hero- or quest-gated.)
3. (Matrix-specific) the plain `seed + i` hero walk seats the same dozen heroes in every lobby when the seed set
   is small (one hero sat in all 265 smoke lobbies, most only in their own 5). Pinned lobbies now draw the other
   seven seats from a per-(seed, hero) shuffle of the roster — still deterministic, still paired.

## The Set 2 smoke (53 heroes × 5 paired seeds, generalist smoke budget, 8 workers)

- **Coverage:** 265 lobbies planned, 256 complete, **9 failed (censored)** — 7 `seat/run health diverged`
  (the table's mirror of a seat's Resolve/Armor drifts from the run when a hero power grants Armor or Resolve
  mid-run: Merrin ×3, Ayse ×2, Darah, Void — a B1 runner finding, reported here, not fixed) and 2 generalist
  seats that hit the 60-action turn cap (Tiff, Emerald Warden). 2,048 placed runs, every hero 23–53 all-seat
  runs (5 pinned). ~19 s per lobby under 8-way contention, 10.5 min wall.
- **Unexercised:** 0 cards never offered; 28 cards offered but never bought; 8 bought but never played; 3 runes
  never offered; **131 of 261 eligible runes offered but never picked** — the generalist's rune taste is narrow,
  so most rune rows are unmeasured, not weak.
- **Heroes (10 of 53 flagged):** OVERPOWERED Warden (mean placement 1.39 over 46 runs), Cindara (1.82 / 33),
  Aevor (2.08 / 39), Emissary (3.16 / 45), Juggler (3.68 / 50); UNDERPOWERED Membrance (5.98 / 47), Tradesman
  (5.94 / 33), Fibbsy (5.78 / 40), Foreman Flint (5.68 / 41), Robin (5.58 / 53). Winner Herfindahl 0.041 (even
  would be 0.019).
- **Runes (19 of 41 with support flagged):** Beastial Swarm (owners 1.92 vs matched controls 5.03, n = 53),
  Aftershocks (2.09 vs 5.10, n = 146, picked 92% of the time it is offered), Scout, Hoardflame, Muster General,
  Five Banners, Last Call … on the OP side; Treasure Map (+2.04, n = 32), Second Path, Underdog, Night Market,
  Gemcutting, Kegheart on the UP side. Direct check: Aftershocks owners place 2.09; seats offered it that skipped
  place 4.46; never-offered seats 4.89; no tier difference at the offer — the lead is real at level 1.
- **Minions (34 of 128):** OP leads Impossible Todd (−1.75, n = 87), Beardsley (−1.57, n = 197), Chipper, Spots,
  Fel Spikes, Market Tormentor, Flamebeat Drake; UP leads Night Market Horror (+1.50, n = 54, never bought — the
  holders got it another way), Kegheart Dwarf, Dwarven Sharpshooter, Blade Thrower. **Spells (6 of 50):**
  Hoardflame (−1.76), Help Wanted, Champion's Ale, Fleeting Vigor OP; Decoy Sigil (+1.43, n = 20) UP.
- **Pick-rate leads:** nothing is always bought; **51 cards are never bought when offered** (Cheap Date 4% of
  5,555 offers, Deepvein Tender, Mend, Gold Font, Summoning Bulwark, …) — this pilot ignores most spells.
- At 5 runs per hero nothing on the pinned seat alone passes the 20-run support gate — the all-seat sample is
  what carries hero support. The 30-run matrix the owner asked for is `--runs-per-hero 30` (~1,590 lobbies,
  ~65 min on 8 workers at this budget).

## Judgement calls

- Heroes are tested on EVERY seat they sat in (pinned + rotated), with the pinned-seat mean shown beside it — the
  rotated seats are the same pilot on the same hero, and pooling is what reaches support at 5–30 runs/hero.
- BH runs per family (heroes / runes / minions / spells), each family one scan.
- The always-bought / never-bought lists fill the "what to test next" slots the scan leaves empty, labelled by
  source — a buy rate is a lead, not a lift.
- `lines played` / `forced` print "not recorded" / "forced exposure unknown" until a pilot writes them.
