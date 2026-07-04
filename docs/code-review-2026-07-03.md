# ASCENT — code + gameplay review (2026-07-03, main @ 15a1106)

Produced per `docs/codex-handoff.md` (§6 review + §7 roadmap). Four parallel review passes
(core / sim / ui+web / content+tools+hygiene) plus the full headless tool suite. Baseline:
**typecheck + lint + 472 tests green; replay byte-identity ✓; perf harness within budget.**
Every finding below cites a line that was actually read; the top four were independently re-verified.

---

## 1. Bugs (prioritized)

### 1.1 HIGH — 0-damage hits pop Divine Shield (and emit junk events)
`packages/core/src/combat/simulate.ts:564-599` — `applyDamage` has no `amount > 0` gate. The shield
check (line 575) runs before any amount check, so a **0-damage retaliation consumes a Divine Shield**
(and fires `onLoseDivineShield` → phantom Shield Capacitor/Arclight procs), and line 583 pushes a
`dmg` event with `amount: 0` (a "0" float in the replay). Newly load-bearing: 15a1106 shipped
Manasaber's **0/2 Taunt cubs**, making 0-attack defenders common — a DS Mech attacking into a cub
wall now loses its shield for nothing. Note line 585 already gates `onDamaged` on `amount > 0`.
**Fix:** early-return `if (amount <= 0) return;` after the dead/IMM guards (venom requires a landed
hit; shield pop and the `dmg` event stay behind it). No card depends on 0-damage pops.

### 1.2 HIGH — save `deserialize` heal-list has drifted; old saves crash or NaN-corrupt
`packages/sim/src/state.ts:470-492` — the heal list is hand-maintained and misses required fields
added mid-June while healing both older and newer ones:
- `history` (added 06-19) missing → `runRecord` (`state.ts:348`) throws → **HudBar crashes on first render**.
- `tavernBuyBonus` (06-22) missing → TypeError on every buy (`reducer.ts:184`).
- `spellCostMod` (06-17) missing → NaN spell cost → `embers` **NaN forever** (silent corruption).
- Also missing: `freeRolls`, `frontToBackBonus`, `undeadAttackBonus/HealthBonus`, `drakkoBuys`,
  `fodderEatenSeq`/`karwindFlashSeq`.
**Fix (structural, ends the drift class):** merge the parsed save over a defaults skeleton
(`{ ...runDefaults(), ...parsed }` with nested defaults), or zod-validate + migrate. Stop whack-a-mole.

### 1.3 HIGH — CI never typechecks `packages/ui`
`tsconfig.json:12` excludes `packages/ui` ("typechecked separately via apps/web/tsconfig.json") but
`.github/workflows/ci.yml` never runs `typecheck:web`, and `vite build` strips types without checking
them. **UI type errors — Mike's entire domain — merge green**, contradicting the CLAUDE.md claim.
**Fix:** add `- run: npm run typecheck:web` to ci.yml (one line).

### 1.4 MEDIUM — The Reclaimer's resummon copy drops carry-back identity + persistable fields
`packages/core/src/combat/simulate.ts:727-734` — `copyBoard` omits `sourceUid`, so every carry-back
for the copy (Kennelmaster `playerSummonBonus`, Engraved `playerPermaBuffs`, Sergeant, Tara) is
silently discarded by the `sourceUid !== undefined` filters at 837-863. Also drops `rallyMechAtk`
(welds), `overflowBonus` (Monk), `hpGrantBonus`, `ascendProgress`, `buffs`. Reclaiming a
Kennelmaster/Gnasher/golden Monk loses real permanent progression. **Fix:** copy the remaining
fields (store the weld-only `rallyMechAtk` delta the way `settleCombat` does, `reducer.ts:597`).

### 1.5 MEDIUM — remote opponent pool silently breaks replay byte-identity across sessions
`packages/sim/src/opponents.ts:27,43-62` — `pickOpponent` prefers session-fetched `remote` boards,
but the module comment promises a "STATIC, versioned … replay-faithful" pool. A saved
`(seed,heroId,actions)` replay reconstructs **different fought boards** whenever the fetched pool
differs from the original session's. Fine within a session (documented); wrong across sessions —
and A7's planned run-archive replays sit right on this. **Fix:** stamp the served opponent into the
action log/state at `faceOmen`, or exclude `remote` boards from replay contexts; at minimum fix the comment.

### 1.6 MEDIUM — Mumi can re-grant spent Rise (contradicts its own doc)
`packages/core/src/effects/factories.ts:422-438` — the doc says spent Rise isn't re-grantable, but
`killOrReborn` strips `R` on a successful Rise (`simulate.ts:505`), so a spent body passes the
candidate filter and a second Mumi re-grants it (inflates Avenge/rattle tallies). **Fix:** add a
`rebornSpent` flag on `Minion`, set in the Rise path, include in Mumi's exclusion — or rule it intended.

### 1.7 MEDIUM — enemy Start-of-Combat effects never fire (owner ruling needed — now with evidence)
`simulate.ts:741-749` iterates the **player** board only; `bus.emit('startOfCombat')` never fires.
Already on the backlog as "confirm with owner", but the pool now contains **7 Abhorrent Horrors** —
captured boards fight weaker than their rating implied. Rule it (document) or mirror the loop
(side-gate `fodderConsumedAtk`, which is a player-run value).

### 1.8 MEDIUM — `npm run bot` (run-harness) is stale and silently stalls
`packages/tools/src/run-harness.ts:15-28` — the bot never dispatches `discover`/`chooseOne`/
`battlecryTarget`, but the reducer modal-guard (`reducer.ts:111`) rejects all actions while one is
pending → the bot spins 100k no-op reduces and reports the stalled wave as the run's end. Also
misses `phase === 'victory'` and crashes on an empty shop (`s.shop[0]!`). Every newer bot
(replay-harness, player-curve, perf) handles all of this — port it. **Bot-derived depth numbers are
currently untrustworthy.**

### 1.9 Smaller confirmed bugs
- **UI, real bug:** defeat-blast targets stale `.hprow` — no such element since the HP-box redesign;
  always takes the guessed fallback (`packages/ui/src/Recruit.tsx:713-715`). Query `.statusbar .hpbox`.
- **Deathsayer's proc'd rattles don't tick the Deathrattle tally** (`factories.ts:600-619`) while
  Sporeling's explicitly do (`:409`) — Grim undercounts. Align on one rule.
- **`onKill` fires only for main-target kills** (`simulate.ts:692-701`) — cleave-splash and
  retaliation kills never proc Karthus/Impala. Card text reads broader; rule it or emit per victim.
- **`gainMult` (golden Taurus) survives Rise** while granted `EG` is shed (`simulate.ts:499-513`) —
  post-Rise carry-back diverges from displayed buffs. Clear it in the Rise reset.
- **`ascendMinion` doesn't sync `divineShield`/`rebornAvailable`** for gained keywords
  (`simulate.ts:428`) — latent (no ascend form grants DS/R yet); same class as the Ryme bug just fixed.
- **`checkTriples` can push the golden past the hand cap** (`reducer.ts:821`) — reachable when all 3
  copies are on board via token summons. Decide the rule (BG allows overflow) or clamp.
- **Sell-path inconsistencies:** Fodder Treatment "counts as a sell" but skips Robin's Spoils
  (`recruit.ts:1122-1135` vs `reducer.ts:415`); held-displacement buys skip Drakko's quest count
  (`reducer.ts:153-159` vs `:192-211`). Confirm intent.
- **Venomous+Cleave spends one venom across three bodies** (`simulate.ts:651,669,679`) vs the
  "drops off after first proc" doc (`types.ts:10`). Defensible as simultaneity — one-line doc fix either way.
- `healHero` caps at `getHero(...).resolve` not `s.maxResolve` (`recruit.ts:956-960`) — drifts the
  day maxResolve changes.

---

## 2. Performance

The hot paths are in excellent shape — drag (rAF-throttled, rects cached once, compositor-only
transforms outside React), combat replay (memoized per beat), `turnClock` isolation, `Unit`'s value
comparator. Findings are concentrated elsewhere:

- **HIGH — `endpulse` animates `box-shadow` in an infinite loop** (`styles.css:298`), applied to
  `.heropowerbtn.ready` (`:278` — most of every shop turn, including during drag) and
  `.endturn-side.urgent` (`:261` — the whole post-timer period). This is the project's own banned
  pattern. Fix = the in-repo `kwglow`/`tripready` template (static shadow on `::before`, animate opacity).
- **HIGH — `discpulse`** (`styles.css:679-683`): three card-sized box-shadow glows repainting every
  frame the Discover overlay is open. Same one-line pattern fix.
- **MED-HIGH — autosave is O(n²) across a run** (`store.ts:235-237,354-358`): every dispatch
  synchronously `JSON.stringify`s the run **plus the entire growing action log** into localStorage.
  Also double-encoded (`serialize` then `JSON.stringify` again) and includes `lastCombat`'s full
  event log. Debounce (trailing ~250ms or on phase transitions) and/or append actions incrementally;
  exclude transients from `serialize`.
- **MED — `reduceCore` deep-clones before any validation** (`reducer.ts:101-113`): every rejected
  action (modal-blocked clicks, can't-afford buys) pays a full `structuredClone`. Hoist the phase +
  modal guards above the clone; add cheap per-action precondition reads.
- **MED — `projectEndOfTurnSteps` clones `lastCombat`** (`recruit.ts:1955`) — the exact cost the
  reducer deliberately avoids, on every End-Turn preview. Destructure it out before cloning.
- **MED — `.cardref` hover popup**: infinite bob (`cardreffloat`) inside a triple `drop-shadow`
  filter (`styles.css:688-694`) → full-card re-rasterize per frame while open.
- **LOW-MED:** `venomdrip` animates `border-radius` infinitely (tiny 9×9 elements, `styles.css:395-404`);
  `aimdash` animates a filtered SVG stroke while aiming (`:1004-1010`).
- **LOW:** Pixi tickers never idle-stop (up to 4 GL canvases presenting every frame; `pixiFx.ts:492`);
  combat hand-grant cards defeat `Card`'s memo (`Recruit.tsx:2357-2359`).
- **Engine allocation profile** (for the balance-sim path): biggest wins are the `quiet`/odds-only
  simulate flag (~25-40% of allocations in `faceOmen`'s 1000-sim odds loop — moderate, not 2×;
  route ~16 `events.push` sites through a gated log helper, skip `initial`/summon snapshots) and
  three `living().length >= 7` → `countLiving` swaps (`simulate.ts:361,490,546`). Fold the flag into
  an **options-object refactor of `simulate`'s 20 positional params** (`simulate.ts:29-50` — 16 are
  `number`; two swapped args compile silently today).

---

## 3. Dead / stale code ("old code not set up properly")

**Engine (verified dead — no card references, cross-checked content/sim/ui/tools/tests):**
- **17 dead factory ids ≈ 170 lines** in `factories.ts` (roadmap said ~20/~190 — close):
  `deathrattleBuffTribe`, `onKillBuffSelf`, `reAttackOnKill`, `scDamage`, `scSplitDamage`,
  `scAoePerTribe`, `deathrattleBuffRandom`, `deathrattleBuffAllRandomStat`, `deathrattleGrantSpell`,
  `onFriendDeathBuffRandom`, `avengeBuff`, `deathrattleFillTribe`, `scGrantShieldTribe`,
  `onShieldBreakGrantShield`, `onShieldBreakDamage`, `onShieldBreakBuffAll`, `scDestroyHighestAttack`.
- An 18th, `battlecryGrantKeyword`, is also unused — making its combat-replay branch, its
  `COMBAT_REPLAYABLE_BATTLECRIES` entry, and the sim recruit factory unreachable. Knock-on: with
  `reAttackOnKill` unused, `Minion.reAttackOnKill`, `REATTACK_GUARD`, the re-attack branch
  (`simulate.ts:698-700`), and `minion.ts`'s `reAttackCache` are all dead weight.
- Removal is a 3-place sweep per id (factories.ts + `types.ts` union + `schema.ts` enum). Decide:
  delete, or mark explicitly dormant.

**Sim (confirmed dead):** `RunState.heroPowerTick` (`state.ts:260` — never written or read, comment
doubly wrong); `CONFIG.startResolve` (`config.ts:13`); `RunState.best` (test-only vestige of
score=waves); `spellCastMult` + `chronosRepeats` re-exports (`index.ts:15`); `drawOfferId`'s `_tier`
param; `pickOpponent`'s `void power` + the maintained `turnStartPower` field feeding it.

**UI (confirmed):** Card still renders the removed "Reborn tears" (7 orphan elements per Reborn card,
`Card.tsx:412-418` — CSS deleted); **FontLab ships un-gated in prod** (`Game.tsx:118`, roadmap wants
a DEV gate; `DevMenu` at `:110` shows the pattern); dead CSS blocks with zero TSX usage — the whole
OMEN block (`styles.css:177-195`), `.chip` family, `.toast`, `.legend/.lt/.li`, `.tavernbox`,
`.btn.go`, `.btn.frozen`, `.btn.big.endturn.urgent`, `.zt/.zh/.hint`; `.disc-gem` rendered but
`display:none` — delete both sides. No orphaned components; no boundary leaks; storage keys clean.

**Stale comments/docs that misdirect the next reader:** `reducer.ts:70-73` ("recruit effects are not
wired yet" — false for weeks); `recruit.ts:1611` ("exported so the UI can replay" — UI moved on);
`neutral.ts:78-80` (Monk "every 3" vs data `improveEvery: 5`); `undead.ts:5-7` (cites removed
Plaguebringer); `types.ts:71` (mis-attributes Sporeling); roadmap/handoff say `run.test.ts` ~1.3k —
it's **3,894 lines**; `Recruit.tsx` is **2,671** (threshold was ~1.5k); `recruit.ts` is 2,009.

**Guardrail gaps (tools/content):** the **Math.random ESLint ban doesn't cover `packages/tools`**
(`eslint.config.mjs:9`) — clean today, but `build-pool` generates the *committed* pool;
`validateCards` misses 6 cross-reference types (all resolve today — extend it);
`CardDefSchema` isn't `.strict()` (typo'd optional keys validate silently); enum lockstep is
hand-maintained (make it `satisfies`-checked). `MAX_WAVE = 20` in build-pool/enemy-curve vs
`courseRounds = 17` — the pool bakes boards a course run can't meet.

**Clean bills of health:** schema ↔ types fully in lockstep (119/119 ids, verified programmatically);
card data (129 ids, no dupes, no dangling refs, 13 scaling cards' text matches data);
`docs/cards.csv` generated + in sync; carry-back channels consumed exactly once, idempotence-guarded;
no `Math.random`/`Date` in core/content/sim; package boundaries respected everywhere.

---

## 4. Gameplay review (headless tools, current main)

1. **The balance runner's numbers are not trustworthy anymore.** `balance.ts:31-55` bakes each
   tribe's **7 lowest-tier cards** and fights waves 4–13; for Demons the naive "play everything"
   lets Consume eat its own board (probe shows **power 9, 0% everywhere** vs Dragon's 60). The
   docs' standing "Mech dominant, Beast weak" reading predates this drift — the current output
   (matrix holds 1/4, Dragon/Undead *inverted*) is mostly tool artifact. **Rebuild the prober before
   the counter-matrix tuning pass** — bake tier-appropriate boards per wave (or drive the modern
   greedy bot constrained per tribe) and handle Consume/board-cap ordering.
2. **Difficulty curve is mid-heavy, then a victory lap.** Enemy power steps 45 → 75 → 91 across
   waves 5–7 (width 3.8→4.8 + sScale jump) while the bot troughs; bot win% craters to 9% at wave 6
   and only 69% of runs reach wave 10 — then waves 13–17 read **54–75% win** (player pulls ahead).
   On a 17-round record course, the record is decided by surviving waves 5–9, and the last third is
   low-tension. Caveats: the bot plays no synergy and (finding 1.8) can stall — fix the bot, then
   re-measure; but the wave-6 step is visible in the enemy-curve tool alone.
3. **Per-turn scalers run away with runs.** Greedy-bot boards are carried by single snowballers —
   Target Dummy **76/50**, Manasaber **51/48** by wave 12 — with zero synergy play. Aligns with the
   roadmap's outlier list (Front to Back, Crypt Drake, Gnasher, Wildwood Shaper); add the
   leave-alone-and-win per-turn scalers to that re-shape pass.
4. **Content gaps vs targets** (`npm run audit`): Demons 12 (+1 needed), spells 32 (+8), Neutral
   over target at 16.

---

## 5. What to do next (recommended sequencing)

The Phase A spine (A1–A7) + Phase B are genuinely done and verified in code. Before starting
Phase C, spend one short cycle converting this review into trust, then go into C1 with clean
instruments. Split along the sim ↔ presentation seam:

**Bundle 1 — engine correctness (Kevin, S-M, PR-sized):** 0-damage gate (1.1) · Reclaimer copyBoard
(1.4) · Mumi rebornSpent (1.6) · Deathsayer tally (1.9) · gainMult-on-Rise + ascend keyword flags ·
checkTriples clamp · owner rulings batch: enemy SC (1.7), onKill scope, venom+cleave, sell-path
quirks. Each is small and test-coverable; several interact with 15a1106's new exchange rules, so do
them while that context is fresh.

**Bundle 2 — save/persistence hardening (Kevin, S):** deserialize defaults-merge (1.2) ·
serialize transient-exclusion + single-encode · decide the remote-pool replay rule (1.5). Do before
A7's run-archive replay lands on this seam.

**Bundle 3 — CI + tooling guardrails (either, S):** `typecheck:web` in CI (1.3) · ESLint ban over
tools · port the modern bot into run-harness (1.8) · validateCards + `.strict()` + enum lockstep
check. Cheap, permanent leverage for a 2-dev + agents workflow.

**Bundle 4 — UI perf + dead-code sweep (Mike, S-M):** endpulse/discpulse → kwglow pattern ·
`.hprow` → `.hpbox` · autosave debounce (measure first) · Reborn-tears removal · FontLab DEV gate ·
dead-CSS purge · cardref/venomdrip/aimdash opportunistically. Natural moment to start carving
`Recruit.tsx` (proposed seams: recruitViews / useCardDrag / useAuraTracker / useLossSequence /
overlay components).

**Bundle 5 — balance instrumentation, then the tuning pass (Kevin, M-L):** rebuild `balance.ts`'s
bake (4.1) · quiet-flag + options-object `simulate` refactor (2) · then the deferred counter-matrix
tuning with trustworthy numbers, including the wave-5–7 wall smoothing, late-curve steepening
(4.2), and the scaler-outlier re-shape (4.3). This unblocks the standing M2 item.

**Then Phase C as planned** — C1 Quest Shops first (as sequenced; the offer UI pairs with C3
later), with C2 Mastery Minions as the cheap parallel content track (the scaling + live-text infra
already exists). The engine is ready for C; nothing in this review blocks it.

**Debt to fold into whichever PR touches it:** dead factory sweep (or explicit dormant markers) ·
dead sim fields · `run.test.ts` split (it's 3× the size the docs claim) · stale-comment fixes ·
`spellDisplayText` relocation to the UI text chain.
