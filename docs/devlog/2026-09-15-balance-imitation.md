# Balance bot B7 — the imitation term: learned from the recorded players, measured, left off (2026-09-15)

**Ask.** The strategist pilot plateaus at 6.44 / 8 against seven real recorded set-2 runs (owner's bar: < 4.0
passes). Its boards hold a third of the field's stats from wave 7. Beside the evaluator work (another agent), try a
different lever: a TARGET-BOARD signal learned directly from the corpus — "does this end-of-turn board look like the
boards of runs that went on to survive?" — blended into the strategist's prior and into line choice.

**Built.**
- `packages/sim/src/balance/imitation/`: `trajectories.ts` (the corpus as 70 run trajectories, the survival label
  with a wave-12 floor), `study.ts` (the per-wave curve, per-band card / pair tables, tribe finishes, hero → tribe →
  core lines; renders Markdown and preserves a hand-written Findings block), `model.ts` (per-card weights per wave
  band — holders' waves-survived-after vs non-holders', shrunk; goldens, board size, pair interactions; 5-fold-by-run
  validation; the readable report), `term.ts` (the `BotVisibleState` hook), `lineFit.ts` (a package's survivor
  affinity), the committed `models/set2-v1.json`.
- `packages/tools/src/balance/imitation/cli.ts`: `balance:imitation:study | fit | report`.
- Wiring, all opt-in and off by default: `imitationWeight`, `imitationLineWeight`, `imitationVariant` on the budget
  (manifest + `StrategistOptions`), through `withEvaluationPrior` in `strategy/prior.ts` and an optional argument on
  `rankPackages` / `pickLineForRun`. `evaluate.ts` and the generalist untouched.
- `docs/balance-bot-player-study.md` (generated + five hand-written findings); the "Imitation term (B7)" section,
  trust-ledger row and next-step rewrite in `docs/balance-bot.md`; nine `set2-pinned-strategist-b7-*` manifests.

**Measured** (100 pinned lobbies each, paired seeds): baseline 6.44 [6.12, 6.76] (reproduces B4 exactly); weight 3 /
6 / 10 all 6.63; + line shaping 6.71; positive-only / cards-only / line-only 6.56–6.62. No variant better than the
baseline; the worst (+0.27 [0.01, 0.53]) is the line shaping, which sends 29 of 51 heroes into Demon consume. The
boards DO move toward the survivors' vocabulary (Bob Blart 0% → 21% at round 8, Storm Chaser 0% → 18%, Embermouth
Whelp 15% → 0%, goldens 0.69 → 0.88 at wave 10) — the stats do not, because the pilot holds the engines and never
feeds them.

**Held-out quality of the model itself:** AUC 0.61 / 0.63 / 0.60 / 0.47 (open / build / scale / late). Two authors
wrote 87% of the corpus.

**Lesson (the same one the value model gave from the other side):** the recordings can name the surviving board; a
one-turn search cannot learn from them how to reach it. The next lever is an engine-OPERATION model (credit a turn by
what it feeds the engines already on the board) with a horizon that sees the payoff.

**Study findings worth keeping** (full text at the top of the study): the field grows ×1.6–1.9 per wave from wave 7
with no change in body count; the survival cards are all fed engines (Bob Blart holders at waves 5–7 lasted 9.8 vs
5.5 more waves); early filler kept past wave 6 is the strongest death signal (Embermouth Whelp 4% survivor at waves
5–7); end-game boards are a small tribe-locked vocabulary (Vaultkeeper 7 / 0, Lastlight 6 / 0, Tapkeeper 5 / 0 on
end vs early final boards); and the `ale` strategy package does not contain the Dwarf cards the survivors held.
