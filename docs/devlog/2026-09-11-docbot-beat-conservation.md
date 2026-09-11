# 2026-09-11 — Doc Bot: the beat conservation lane (+ three presentation defects it found)

**Why.** Roughly half of the repo's historical fixes are presentation: beats, FX, doubled emissions. Doc Bot
cannot see pixels, but the machine-checkable half of a presentation bug is a *claim* (a beat's consequences)
that disagrees with the *state diff* — checkable after every single action. The canonical shape is Rope Wrangler
(#1374): a recruit scope opened inside another diffed the same window twice, so every stolen card was previewed
twice and Arnold's Beefy read +16/+16 for a real +8/+8. A player found it. The point of this lane is that CI finds
the next one.

**What shipped.**
- `packages/sim/src/docbot/beatConservation.ts` — pure reconciliation: fold a `reduceWithPresentation` batch per
  uid (Σ `statsChanged` + `rubyPlayed`, grants, summons, destroys, transforms, hero Gold, orphans) and compare it
  with the real before→after diff. Consequences under `startOfCombat` / `combat` triggers are excluded (they
  describe the combat copies — Rayse's vigour never moves the run board). Transient uids (arrived and merged into
  a golden within one action) reconcile only where provable. The action's own primary move (bought / played /
  sold / picked card, a triple merge) is not an effect and is not an under-claim.
- `packages/sim/src/docbot/beatConservation.test.ts` — the lane. Over-claims are hard on every action type;
  under-claims are hard where the resolution is scoped and pinned shrink-only (`KNOWN_UNATTRIBUTED`) where a
  dispatch site opens no scope yet. **Every pin carries a deterministic repro fixture** — proven by construction,
  not by seed luck (the first cut verified pins through the sweep, and a planted-hand change made `buyRune` stop
  reproducing for no engine reason). Drivers: the invariant-fuzz policy, a dense builder policy (free play sells
  its board down — 6 batches in 207 turn ends; the builder plants one cast-at-End-of-Turn card per seed and runs
  Djinn every fourth seed so the nested classes are actually inside the sweep, asserted), the whole coverage
  corpus, and nested fixtures. Combat: every `factory:` stamp names a card carrying the effect. Gate cost ~0.8 s;
  `DOCBOT_DEPTH=nightly` multiplies seeds ×4.
- Wired into `npm run docbot`'s roll-call and `docs/docbot.md`; `docs/docbot2/final-report.md` regenerated.

**What it found (all fixed here, each with a fixture in the lane).**
1. **Djinn's `replayAllEndOfTurn`** — the hero wrap (`reduceWithPresentation` → `emitHeroPowerDiff`) diffs the
   whole action, while the End-of-Turn effects it replays open nested `withRecruitTrigger` scopes that also emit.
   Arnold read +16/+16, every Lasso steal previewed twice: the Rope Wrangler class, live on the hero rail. The
   wrap now taps what the nested scopes claimed and emits only the residual.
2. **Aimed Shouts and Choose One branches had no beat at all.** `applyBattlecryTarget`, `applyChooseOne` and
   `applyChooseOneTarget` dispatched their factories bare — Toxin Tender / Emissary / Runic Beetle / Shaper
   resolved with an empty batch, so the beat system had nothing to schedule. All three now open the same
   `withPlayTrigger` scope an untargeted Shout gets.
3. **`emitHeroPowerDiff` had no departure half** — Devourer's meal left the board with no `cardDestroyed`.
   Added, with the slot index.

Presentation capture is DEV-only in the store today (`captureBeats = import.meta.env.DEV`), so none of these is
visible in a production build — no patch-notes entry; the fixes are for the Beat Lab / the coming live cutover.

**Sabotage.** Reverting the #1374 frame stack locally (`parent?.flush()` / `parent?.rebase()` removed) turned
5 of 13 tests red — the builder sweep itself, not just the fixtures:
`seed 2 step 12 (flash, board 3) after faceOmen: dw_arnold (plant2): beats claim +16/+16 but the action changed
it by +8/+8 — OVER-claimed`; `cardGranted claimed 2× for dw_orin (b14)`. The free-play sweep stayed green under
the sabotage, which is exactly why the builder policy exists. In-file: a doctored batch re-emitting a child's
consequences at the parent, a dropped consequence, a claim moved to the wrong body, a phantom uid and an orphan
consequence each alarm with the uid and numbers in the message.

**The pinned backlog (the "missing beat" half, `KNOWN_UNATTRIBUTED`, shrink-only).** `fire(onBuy)` /
`fire(onSummon)` / Den Marker, `fireBattlecryTriggered` (Karwind, Embermouth), `applyGoldSpent` (Coinfire),
on-sell effects (Beggy), `onGainCard` (Gangplank), rune spell-cast procs (Rune of Scales), a Ruby played from
hand, and a reward that consumes a body (Rune of the Altar) all change state with no scope. Each is a real
"effect that resolves invisibly" — the beat-system-status item-2 gap, now enumerated with a repro per site.

**Instrument lessons worth keeping.** (a) A whole-action diff and a nested per-effect scope are two accountants
for one ledger — either the outer subtracts the inner's claims or one of them must not exist; the hero wrap and
`withQuestRewardBeat` are both whole-action diffs, so any nested scope under them is a double-count waiting to
happen (`withQuestRewardBeat` had none reachable in this sweep; it is on the watch list). (b) The `events.length
=== 0` early return hid every silent action from the under-claim half on the first cut — silence is a claim too.
(c) The bought card is re-minted with a fresh uid, so "exclude `action.uid`" excluded nothing for `buy`.

## Retro measurement (same day, on the rebase)

`npm run docbot:retro -- --only bb5195d5-nested-scope-double-emit` against this branch: **CAUGHT by
`beatConservation.test.ts`**. The catalog entry moved from out-of-scope to generic on that run (the class is
machine-checkable now), the map row cites the lane, and the forward catch rate reads 17/17 in scope · trailing
30 days 4/4 — pasted from the run output, never typed.
