# 2026-09-15 — Balance bot B9: hand-authored expert line operators (a different structure, measured)

**Branch** `feat/balance-b9-operators` → base `feat/balance-bot`. The three search-based levers on the strategist (line
prior B4, engine-growth probe B6, imitation term B7) each moved the pinned placement by < 0.2 (6.39–6.44 against the
owner's < 4.0 bar), with the same diagnosis every time: the pilot holds the engine cards and never OPERATES them. B9
tests the other structure — not another evaluator term, but an explicit per-turn PROCEDURE per line, written the way a
strong player plays it, and measured on the same instrument.

## What shipped

`packages/sim/src/balance/strategy/operators/` — a `SeatPilot` (`operatorPilot.ts`) that runs a `LineOperator`
(`types.ts`) one reducer-validated action at a time, and hands everything it does not script (Choose One, Runeforge,
quest / power offers, lines without an operator, the pivot) to the wrapped strategist:

- **Four operators** — `demon.ts` (Bob Blart's End-of-Turn eat fed by Right Hand Hank's Echo / Demon Horse's Rally /
  Market Tormentor on the right-most Shop slot; leave the meal in the row, never end on an empty Shop, Hank forward,
  Blarts back), `dwarf.ts` (Brunni's Ales cast every turn in order with the champion seated LEFT for Champion's Ale,
  Coinfire / Billings / Tapkeeper fed by spending EVERY coin — leftover Gold into refreshes), `dragon.ts` (buy the spell
  slot once an engine is out, every targeted spell on Mirrorwing first then the Vaultkeeper, Transcendant seated between
  the Chorus Drakes), `beast.ts` (the best Echo left-most for Echohorn / Hawkus / Spots, the payoffs at the back,
  Jensen's Dynamite Dig while it is cheap). Each is a hand-authored role table (want 0–3, `core`, `filler`, `fromWave`)
  + hooks (feed, spellTarget, aim, slot, pinned, heroPower, beforeEnd, avoidBuying, rollBudget), with the procedure
  written out at the top of each file.
- **The shared skeleton**: tier on the line's curve (T2@2, T3@4, T4@6, T5@8–9, T6@10–11 — the recorded runs), a core
  piece may delay a due tier-up, field engines first, sell filler from wave 6 by ONE keep-value bar read by both the
  field step and the buy step (so nothing is bought that will not be seated), a `spells.ts` policy naming every drawable
  set-2 spell (kind + buy appeal; Channeling the Devourer / Closed Casket / Turnabout are `never`), roll caps that climb
  while the engine is missing, freeze a wanted piece, the line's arrangement then the EXISTING positioning pass
  (`positionCandidates` + the evaluator) restricted to moves that keep the line's pinned seats, a pivot to the
  strategist at wave 7 with no engine fielded.
- **Registry**: `operator` (routed by the strategist's natural line), `operator:<demon|dwarf|dragon|beast>` (pinned),
  `operator:adaptive` (uncommitted union procedure until a core engine of any line is fielded — measured, negative).
- The pinned lobby's pilot `RunRecord` now carries `line` (owed since B4), with the additive `operator` field
  (`demon` … / `none` / `pivoted` / `uncommitted`) so a job can be split by what actually played.
- 28 curricula in `operators.test.ts` (fixture → the operator takes the FEED, through the real reducer).

## What it measured (100 pinned set-2 lobbies each, seeds 1–100, smoke budget, corpus `set2-players-v1`)

The numbers are in `docs/balance-bot.md` ("Line operators (B9)"). The short version: **no line passes**. Per hero
(the study's best hero per line), operator vs strategist on the same seeds: Demon / darah 6.75 vs 6.35 (paired Δ
+0.40 [0.15, 0.65] — the operator is worse); Dwarf / robin 7.24 vs 7.05 (+0.19 [−0.09, 0.47]); Dragon / emeraldwarden
6.21 vs 5.78 (+0.41 [0.08, 0.75] — worse); Beast / jenkins 5.73 vs 5.72 (+0.01 [−0.29, 0.31]). Rotated heroes:
`operator` 6.70, `operator:adaptive` 6.96, the strategist 6.39. Two first places in 900 operator lobbies (both the
Dragon operator); the strategist took one on emeraldwarden.

## What the traces say — the finding

1. **When the engine assembles, the procedure works.** The Demon operator's 2nd-place run (seed 43) fielded Hank at
   wave 4, Horse + Blart at 5, a second Hank at 7: Blart 9/7 → 15/12 → 31/27 → 54/48 → 87/78 → 138/122 → 203/189 →
   290/272 — doubling every wave, the recorded darah run's exact shape one wave behind. The Dragon operator's two
   firsts ran Mirrorwing to 128/115 and 178/436 with Flamebeat / Warflame / Transcendant around it.
2. **A fixed line assembles its engine by wave 5 in 15–43% of runs, and never in 25–58%.** Bob Blart never appeared
   in 58 of 100 darah runs; a Dwarf converter (Brunni / Coinfire / Gangplank) never in 25; Chorus Drake / Earthbreaker
   never in 33. The runs that found the engine by wave 5 did NOT place better on average (Demon 6.73 vs 6.63 later),
   because the engine alone is not the engine: Blart without Hank / Horse grows +1..+5 a turn (seed 33: 4/6 → 26/38 over
   six waves); with them it doubles. The corpus' survivors held ALL the pieces by wave 5–6.
3. **The operator is AHEAD of the recorded field through wave 5 and behind from wave 7.** Dragon / emeraldwarden stat
   medians 44 / 54 / 77 / 96 / 146 / 173 at waves 5–10 against the corpus' 31 / 53 / 88 / 139 / 248 / 432 (the gap
   table); goldens per board 0.17 vs 0.48 at wave 8 (a third of the players' triples). Growth from wave 7 is ×1.2–1.5
   a wave, the corpus' ×1.6–1.9. Every operator's win rate is 40–99% through wave 5 (Beast / jenkins 84–99%: the free
   Digs) and 13–27% from wave 8; damage taken per round from wave 8 is 9–12 against the 5.5–6 the recordings take from
   each other (the shipped tier-only recording-vs-recording path — the instrument, not the pilot) and the seat is dead
   by round 10 in most lobbies.
4. **The Beast line as authored does not grow.** Its stats sit at 58 / 86 / 108 at waves 8 / 10 / 12: the Echo-trigger
   engine (Echohorn / Hawkus / Spots) is combat-time; the corpus' Beast survivors grew through Paragon / Todd / Axeman
   Rally- and damage-payoffs the line does not own. It still placed best (5.73) — through the early Dig tempo, not the
   engine. An authored line is only as good as the author's model of the growth mechanism.
5. **Adaptive commitment made it worse** (6.96 rotated, 7.20 on darah): the commonest core to appear first is a T3
   Dwarf converter, which commits the run to the weakest line.

So: a hand line does NOT beat the search at this stage, and the gap is in PLAY, in two specific places the numbers
name — (a) the mid-game (waves 6–9): the engine's FEEDERS arrive 2–3 waves after the recorded players' and the
board's non-engine bodies stay at printed stats while the players' come from an already-buffed Shop; (b) triples: the
pilot holds a third of the players' goldens. The instrument adds a third, the shipped fight asymmetry (a pilot at a
25% win rate bleeds ~2× per round what the recordings bleed against each other), which a passing pilot has to beat
through.


## The boards, side by side (the operator vs a real player on the same hero)

Demon — `operator:demon` on darah, seed 43 (placed 2nd, eliminated r15) vs the corpus' LazerLemon | darah (reached w18):

| wave | operator (seed 43) | LazerLemon \| darah |
|---|---|---|
| 8 | T4, 200: Hank 3/1, Hank 7/6, Horse 3/7, Horse 7/8, Big Huggies 9/7, Leech 32/8, **Blart 54/48** | T4, 270: Horse* 7/8, Chorus 8/14, Storm Chaser 11/12, Huggies 10/12, Fel Conjurer 6/6, **Blart 55/59, Blart 30/32** |
| 10 | T5, 403: Hank* 19/19, Horse 3/7, Horse 7/8, Huggies 9/7, Leech 56/8, **Blart 138/122** | T6, 851: Horse* 7/8, Chorus 8/14, Storm Chaser 11/12, Huggies 10/12, Conjurer 6/6, **Blart 219/271, Blart 115/152** |
| 12 | T6, 837: Hank* 19/19, Horse 3/7, Horse 7/8, Huggies 9/7, Lastlight 45/53 ×2, **Blart 290/272** | T6, 2,110: Echohorn 36/49 ×2, Chorus 8/14, **Blart 567/731, Blart 247/339**, Huggies 10/12, Conjurer 6/6 |

The same engine one Blart short and one wave behind: the player's meals were bigger earlier (two Hanks from wave 5,
a golden Horse). A median operator run on the same hero (seed 12, placed 6th, eliminated r9) at wave 8 held Standard
Bearer 5/6, Void Panther 6/6, Butcher 4/3, Embermouth 6/4, Tunnelcharger 7/6, Coinfire 6/7, Leech 5/6 — 77 stats, no
Blart ever offered, pivoted to the strategist at wave 7.

Dragon — `operator:dragon` on emeraldwarden, seed 39 (placed 1st) vs LazerLemon | emeraldwarden (reached w14):

| wave | operator (seed 39) | LazerLemon \| emeraldwarden |
|---|---|---|
| 8 | T5, 138: Standard Bearer 3/5, Wardkeeper 6/4 ×2, Recaller 3/4 ×2, Fel Conjurer 6/6, **Mirrorwing 48/36** | T6, 203: Chorus 4/10, Gangplank 30/63, Rope Wrangler 9/19, Storm Chaser 8/11, Drakko 3/10, Fatecarver 8/9, Bellringer 6/13 |
| 10 | T6, 166: Flamebeat 6/5, Standard Bearer 3/5, Wardkeeper ×2, Recaller, Conjurer, **Mirrorwing 60/48** | T6, 324: Chorus 10/35, **Vaultkeeper 44/56**, Bellringer 8/28, Drakko 7/17, Chronos 19/31, Fatecarver ×2 |
| 12 | T6, 387: Chorus 9/13, Warflame 11/17, Flamebeat 12/14, Standard Bearer 9/14 ×2, Earthbreaker 10/12, **Mirrorwing 128/115** | T6, 3,456: Flamebeat* 46/239, Chorus 27/188, Chorus 16/83, Lastlight 52/150, **Vaultkeeper* 1,171/1,302**, Mushy, Drakko |

The operator's Dragon engine is ONE body (every spell recast on Mirrorwing) surrounded by printed-stat bodies; the
player's is a golden Vaultkeeper (two Vaultkeepers tripled at wave 11) with four bodies over 40 — the triple and the
spell-count multiplier, neither of which the operator reached.

## Next lever

Not a fifth evaluator term and not a fifth line. Two things the traces point at, in order: (1) an **operator that
plays the corpus' actual opening** — the study's survivors reach wave 5 with the whole engine (Blart + Hank + Horse; two
Coinfires + Brunni) — which means rolling far harder for the specific pieces at waves 4–6 than any pilot here does
(the operators cap at 6–7 rolls a turn; the recorded runs' Gold-spent counters imply more) and holding pairs for the
triple; measure it as "share of runs with the full engine by wave 6" before placement; (2) the **Beast / Dwarf role
tables re-authored from the growth mechanism** (Paragon / Rally payoffs; two Coinfires as the core) rather than the
tribe roster. If (1) does not move the wave-8 stat median past the corpus' 139, the remaining gap is the instrument's
fight asymmetry and the owner's bar needs a fairer ruler (recording-vs-recording through the same full builder).

## Verification

`npm run typecheck`, `npm run lint`, `npx vitest run packages/sim/src/balance` green; the nine 100-lobby jobs ran with 0
failed lobbies and 0 refused actions (the runner fails a seat on a rejected action — none did).
