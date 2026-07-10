# ASCENT — roadmap / queue

The forward queue. **Shipped detail lives in [devlog.md](devlog.md)** (newest first); high-level
milestones in [../CLAUDE.md](../CLAUDE.md). When something ships, delete it here. Keep it honest.

> **2026-06-30 reframe.** The roadmap is now organized around one **North Star** (below) rather than the
> old "next-5 patches" list. The async-PvP / captured-board work the old list was built on is largely
> shipped (see [board-backend.md](board-backend.md) / [board-pool.md](board-pool.md)); the new spine is the
> **run / career loop**. The deep-balance, content, FX, and distribution threads from before are preserved
> under **Standing backlog** — nothing was dropped, just resequenced behind the spine.

## North Star

ASCENT should become a **course-based async autobattler where every run has a record, a memory, and an
identity.** After a run, the player should know: what they were trying to do, how well they did it, what
kind of build they made, why it mattered to their career, and what their board contributed back to the
shared opponent pool.

The emotional target is **"this was *my* build that run"** — not "I forced a known comp and won." Quests,
Mastery units, Ancients, and new mechanics are real goals, but they come **after** the core run/career loop
is solid. The product first answers *"what does a good run mean?"*; the depth systems then answer *"what
kind of run did I author?"*

Each spine item below carries: **Goal · Why · Touches** (the real code surface) **· Size** (S/M/L) **·
Depends · Done-when**. The ordering is dependency- and leverage-first; several items are cheaper than they
look because the engine already produces the data.

---

## Phase A — the run/career spine ("what does a good run mean?")

### A1. Course + record (win-condition reframe) — ✅ **shipped 2026-06-30** (→ devlog)
- **Fixed course of 17 rounds** (2 calibration + 15 scored); the run completes the course (→ victory) unless
  Resolve hits 0 (→ gameover). **Record = W–L over the scored rounds** — calibration rounds cost Resolve +
  run the economy but don't count. `runRecord`/`isCalibrationRound` in `state.ts`; `CONFIG.courseRounds` /
  `calibrationRounds`; HUD shows "ROUND n/17" + record chip + a Calibration badge; end screens show the
  record ("COURSE COMPLETE" / "FALLEN"). `winsToWin` removed. **Decisions:** calibration doesn't count; the
  course always completes unless Resolve 0. **Next:** A2 (par/rating line) sits directly on this.

### A2. Par / rating line — ✅ **shipped 2026-06-30** (→ devlog)
- Every run carries a **par line** (`RunState.line`, from `CONFIG.defaultLine` = 9; static for now).
  `lineResult(state)` grades a finished run: flawless / exceeded (+Δ) / covered / missed (−Δ) / failed. HUD
  shows "Line N"; the end screen shows the verdict ("Line 9 · Exceeded (+2)"). **Seam for later:** make the
  line rating-driven (new ~7 / mid ~9 / high ~11 / elite ~12+) once the career/rating system (A7) exists —
  `rating.ts` bands feed it. **Next:** A3 (save & continue) or A4 (post-combat summary).

### A3. Save & continue — ✅ **shipped 2026-06-30** (→ devlog)
- The in-progress run autosaves to `localStorage` (`ascent.save` = serialized `RunState` + action log) on
  every change and reloads at boot; the title shows a **Continue** entry ("{hero} · Round n") that resumes
  the exact run. A finished run clears the save; starting a new run overwrites it. Built on the existing
  `serialize`/`deserialize`. Store seam: `savedRun` + `continueRun` in `store.ts`. **Next:** A4
  (post-combat summary) — the carry-back data is already on `CombatResult`.

### A4. Post-combat summary — ✅ **shipped 2026-06-30** (→ devlog)
- The post-combat overlay ("Combat Summary", via the **Summary** button) leads with a **Gains** tab — the
  permanent value the fight left you with, mapped from the `CombatResult` carry-backs by `combatGains.ts`
  (spell power, max Gold, Undead Attack, Imp/Fodder buffs, per-card enchants, kept/Engraved stats, Fodder →
  next tavern, free rerolls, cards-to-hand). Keeps the Procs (major triggers) + Log + odds-bar. Unit-tested.
- **Deferred to a follow-up:** the "Standout Unit" + "Risk Signals" sections (need per-minion damage
  derivation, not currently on `CombatResult`). **Next:** A5 (build-tag classifier — feeds A6 + A7).

### A5. Build-tag classifier — ✅ **shipped 2026-06-30** (→ devlog)
- Pure `buildTags(state)` in `@game/sim` (`buildTags.ts`) — reads the final board + run signals, emits up to
  3 build tags (tribe archetypes, trigger density, keyword walls/finishers, Gilded/Spell/Fodder/Attachment
  engines), strongest first, with a tribe fallback so identity is rarely blank. 8 unit tests. **Not surfaced
  in the UI yet** — it's the dependency A6 (post-run summary) + A7 (career) consume. **Next:** A6.

### A6. Post-run summary — ✅ **shipped 2026-06-30** (→ devlog)
- The end screen shows record + line verdict (A1/A2) + **build tags** (A5's `buildTags`, as chips) + the
  final warband + **run contributions** ("Added N boards to the pool", from a new `lastRunBoards` store
  field set in the deferred run-end capture). **Deferred:** MVP / standout-unit (needs per-minion damage
  tracking not on `CombatResult` — same gap as A4). **Next:** A7 (career / match history) — the last spine
  piece and the big persistence one.

### A7. Career page / match history — ✅ **shipped 2026-06-30** (both parts → devlog)
- **Part 1:** `runHistory.ts` — per-run entries persisted to `localStorage` (record, line verdict, tags,
  completed?, tribes, contributions, final board), capped 50; `careerStats` (overall + per-hero); wired into
  the run-end capture. **Part 2:** the **Career** overlay (`Career.tsx`, via the title's Career button) —
  profile strip + per-hero rollups + a match list (record · verdict · tags · final warband). Rating absent
  until the rating system exists. **This completes the Phase A run/career spine (A1–A7).**

### End-screen / Career polish (owner batch, session 12)
- ~~**Real APT / tag tooltips / bigger metrics / drop pool text**~~ — ✓ done (session 12, → devlog): APT now
  counts player actions only; every build tag has a hover tooltip (`TAG_INFO`); run metrics enlarged; the
  "Added N boards to the pool" line removed. Gold-spent confirmed already correct (no change).
- ~~**Round-board viewer**~~ — ✓ done (session 12, → devlog): clicking a W/L pip swaps the final-warband
  board **in place** to that round's board (re-derived via `replayRun`); label toggles back to the final
  warband. Ascent-only (practice replays wouldn't reconstruct faithfully). *Still open:* the same viewer on
  the Career expanded-run rows (the entry stores only the final board today — needs the replay stored too).
- ~~**Live card values on the final warband**~~ — ✓ done (session 12, → devlog): `instView` extracted to a
  shared module; the end-screen final warband uses it, so scaling cards show accumulated magnitude.
- ~~**Player-avatar picker**~~ — ✓ done (session 12, → devlog): pick any hero/minion/token/power art as a
  persisted cosmetic, shown on the Title chip + Career profile card. *Still open:* the metrics "stack
  vertically off to the side" layout idea (deferred; the board swap didn't need it).

### Career / menu polish (owner batch, session 12) — ✓ done (→ devlog)
- ✓ Career redesign: dropped the stat bar; Profile + **11-row Insights** + per-hero **line W–L** in one wider
  left panel; added **Favorite Minion** + avg APT/gold to insights. Bigger avatars (menu +100%, Career +50%).
- ✓ **Font Lab** (dev): bottom-right title toggle, per-role pickers (Titles/UI/Body × Outfit/Sora/Plus Jakarta
  Sans/Nunito) driving `--font-*` CSS vars. *Follow-up:* it's always-on for now — gate behind a dev flag before
  a public build; consider splitting the Outfit → title/ui boundary more finely if more granular control helps.

### Phase A follow-ups (deferred within A1–A7, do opportunistically)
- ~~**Rating system / rating-driven par line**~~ — ✓ done (session 12 → devlog): persistent `PlayerProfile`
  (rating + Line + high-water marks) in `ascent.profile`; the run's Line comes from the rating (1200 → Line 9);
  scored runs move the rating by the line-delta table + a summit bonus + a final-round-win bonus (win-weighted
  since session 19: truly winning = over your Line AND won round 17), with a promo/demo hysteresis buffer;
  end screen / Career / hero-select surface it. Pure math in `@game/sim` playerRating.ts, built local-first for
  a later Supabase-accounts swap. **Remaining:** (1) **new-Line grace** (soften the first misses after a
  promotion — `lineGrace` field reserved); (2) **rating-aware matchmaking** — still intentionally off (rating is
  expectation, not difficulty); revisit under "Matchmaking evolution" once the board pool is larger; (3) surface
  **rating Δ per run** on the Career match cards + optionally seed veterans' rating from existing history.
- ~~**MVP / standout unit** (A4 + A6)~~ — ✓ done (session 11): `packages/sim/src/contribution.ts` attributes
  player damage by cardId + counts mechanic procs from the combat log; end screen shows **MVP** + **Most**,
  Career shows favorite mechanic. Still deferred: biggest permanent-scaling source, Quest choices, Ancient.
- **Run detail page** (A7) — the Career match cards now **expand in place** (session 11) to show the run's
  stat line + final warband; the remaining step is a full **round-by-round + replay** view (the entry already
  stores the final board; add the `{seed,heroId,actions}` replay to enable re-derivation).
- ~~**Career "Rank"**~~ — ✓ done (session 12): the Profile Card's "Unranked" placeholder now shows rating +
  Line + high-water marks (rating also on the empty state).
- **Goal:** runs stop disappearing. A career surface with: current rating, best record, average wins, total
  runs, recent runs, **per-hero stats**, rating Δ per run, final-board preview, build tags. Match entry e.g.
  *"Rohan · 11–4 · Line 9 · +18 · Spell Engine / Gilded Carry / Flurry Finish."*
- **Why:** without it, runs vanish; with it, ASCENT becomes a game about building a history of climbs.
- **Touches:** a **new local run-history store** (a sibling to `boardLibrary.ts`, persisting a compact
  per-run record incl. the `{seed,heroId,actions}` replay so a run can later open into a full archive page),
  a Career overlay (reuse the scene/overlay pattern, no router), consuming A1/A2/A5.
- **Size:** L. **Depends:** A1, A2, A5 (and pairs with A3's persistence). **Done-when:** finished runs
  append to a persistent history the Career page reads back; per-hero rollups compute.

---

## Phase B — UX polish (parallelizable; slot any time)

### B0. FX follow-ups (from the Echo skull poof, session 29)
- **Watch the Echo particle budget.** ~107 pooled sprites per Echo (was ~64). Fine solo; profile a clash where
  several Echoes fire at once before adding more.
- **Extract an FX preview kit — only after a *second* effect exists.** `purple-skull-preview.html` is ~70%
  reusable (the particle sim mirroring `pixiFx`'s `spawn` contract, the slider/color tuner generated from
  `DEFAULTS`+`RANGES`+`GROUPS`, localStorage, the JSON bake box, the diag line, the error banner). What is
  *not* reusable is the driver: the skull is a **one-shot point burst**, whereas smoke trails need a
  **rate-based emitter following a moving anchor** and wisps need a **steered field**. Copy the file for the
  next effect, let it diverge, then extract the seam that actually repeated. Don't abstract from one example.
- **Glyph text-input in the preview rig.** Paste a character and audition it live (would have surfaced the
  missing-glyph/tofu case instantly). Also worth supporting an SVG `d=` path via `Path2D` for custom silhouettes.

### B1. Hero-power dragging — ✅ **shipped 2026-06-30** (→ devlog)
- Targeted hero powers use the press-drag-release card-drag language (arm on the button's pointerdown, drag
  the aim line onto a minion, release to fire; off-target cancels). A quick tap still arms for the
  press-then-click-target flow. Minimal change over the existing aim-line system.


### B2. Discover minimize — ✅ **shipped 2026-06-30** (→ devlog)
- A pending Discover minimizes to a "Return to Discover · N options" pill; the board is inspectable while
  minimized. A reducer modal-guard blocks board actions (buy/roll/play/…) while any Discover / Choose One /
  targeted Battlecry is pending, so inspecting can'''t invalidate the pick.

### B3. Keyword / terminology pass — ✅ **shipped 2026-06-30** (→ devlog)
- Display-time player-facing rename (internal ids/codes/data unchanged): Battlecry→Shout, Deathrattle→Echo,
  Divine Shield→Ward, Windfury→Flurry, Venomous→Toxin, Reborn→Rise, Magnetic→Attachment, Golden→Gilded (Taunt/
  Avenge/Choose One/SoC/EoT/Rally kept). `terms.ts renameTerms` over card text + badges + trigger pills +
  combat-log narration. **Closes Phase B (B1–B3).**


## Phase C — build-authorship depth (after the spine)

### C1. Quest Shops — 🚧 **engine + UI shipped; real content landing tribe-by-tribe**
- **Design (locked with owner):** on waves **4/8/12** a quest shop opens *before* the normal shop — 3 quest-cards
  "bought" for 0 Gold like a card (tavern locked, timer paused), added to a persistent quest panel; the objective
  (an event counter) ticks during play and applies a reward on completion. No fail / no expiry. Offer = **1
  neutral (always) + 2 distinct tribes**; waves 8/12 guarantee ≥1 of your most-played board tribe. Pool target
  ~6/8/6 per tribe+neutral (built skinny first). Reward palette: buffs/auras, economy, card gen, unique minions/
  modifiers, new scaling, global multipliers (matrix-bending reserved for capstones).
- **✅ Engine (PR 1, → devlog):** `QuestDef` + zod + 18 test quests; seeded `generateQuestOffer` (`TAG.QUEST`);
  `questOffer` / `activeQuests` on RunState; `advanceCombat` quest-phase + reducer lock + `buyQuest` + central
  objective tick + `applyQuestReward`; every headless run-loop taught the phase. Fully tested, determinism intact.
- **✅ UI (PR 2, → devlog):** the Quest Shop (card-sized tribe-hued offers, 0-Gold, banner, control-lock,
  timer-pause) + the quest panel (live objective progress), derived text (`questText.ts`). Verified organically.
- **✅ First real content (session 21, → devlog):** Trail Rations (Beast) / Warm Embers (Dragon) / Grave Toll
  (Undead) replace the same-tribe LESSER `Test ·` quests. Adds `summon` (counts tokens too, tribe-filterable) +
  `shout` objectives and `grant` (random-tribe minion + named cards like the Gold Pouch, with an optional
  `repeatInTurns` delayed re-grant) + `shoutDouble` rewards; quest-card art (`art/quests/<id>.png`); dropped the
  0-Gold coin badge.
- **✅ Discover-style modal + master toggle (session 21, → devlog):** the offer is now a blurred minimize-to-inspect
  overlay (reuses the Discover chrome) and the tavern rolls UP FRONT behind it, so the pick is **shop-informed** (see
  shop + board + threat before committing); determinism preserved (byte-identical golden run). Plus `CONFIG.questsEnabled`
  — a single-flag on/off for the whole system.
- **✅ Beast tribe — first fully authored tribe (session 26, → devlog):** all 11 Beast quests across lesser/
  greater/capstone (Forest Grove, Blood Trail, Den Marker, Forager's Trail, Apex Hunt, Pack Mentality, Trophy Den,
  Feed the Alpha, Law of Teeth, The Old Hunt, Echoing Coop) + 3 reward cards (Trail Forager, Trophy Stalker, Feed
  the Alpha spell) + art. Adds the **combat-phase objective family** (`attack` / `summonCombat` / `slaughter` /
  `deathrattle`, tallied in `simulate()` → `playerQuestTally`, applied +N post-combat, tribe-narrowed) and a big
  **reward-palette expansion**: persistent + scaling tribe auras (`tribeAura` / `scalingTribeAura`), recurring
  end-of-turn grants (`recurringGrant`), keyword-stamped grants (`grantKeywords`), and run-wide **combat flags**
  (`combatFlag` → `QuestCombatMods`: Blood Trail / Echoing Coop / Law of Teeth / The Old Hunt).
- **✅ Dragon tribe — second authored tribe (session 26, → devlog):** 9 quests + 3 reward minions + the Shout /
  End-of-Turn / stat-growth reward engine (`shoutRepeat` / `endOfTurnRepeat` / `recurringEndOfTurn` / `multi`), plus
  the combat quest-panel live-tick. Art wired.
- **✅ Undead tribe — third authored tribe (session 26, → devlog):** 9 quests + 4 reward cards + the **Echo-doubler
  engine**. Adds the `friendlyDeath` objective (raw death count, doesn't scale) vs `deathrattle` (Echo triggers,
  which scale); additive echo doublers folded through `playerEchoExtras` (Sylus + `echoExtraAlways` + `echoFirstEachCombat`);
  The Bone Throne's every-N-deaths trigger; `gainGold`/`echoRepeat`/`boneThrone` rewards; **repeatable quests**
  (`QuestDef.repeatable`); and reward cards Bone Taxer / Ossuary Rite / Gravetwin / Crypt Broker. Art NOT wired yet.
- **✅ Mech tribe + neutral keyword quests (session 26, → devlog):** 6 Mech quests (Attachment + Rally engine) + 3
  neutral Rally quests + 4 reward cards. Adds the `rally` (Rally-trigger, additive doublers via `playerRallyExtras`)
  + `playAttachment` objectives, `sell` tribe filter, `grant.randomFilter` (random Shout/Echo/Rally/… minion),
  `rallyRepeat` / `sharedCircuit` / `grantRandomAttachments` rewards. **Re-tribed** all keyword-triggered quests
  (Shout/Echo/Rally/EoT) to `neutral` and retired the 6 `Test ·` placeholders.
- **✅ Demon tribe — the fifth (final) authored tribe (session 26, → devlog):** 9 Demon quests (Fodder/Imp/Consume
  engine) + 4 reward cards. Adds `consumeFodder`/`consumeStats`/`summonImp` objectives, `fodderReward`, and the Deep
  Hunger / Contract Rewrite / Pit Without End / Run Maw combat mechanics. **All five tribes + neutral are now fully
  authored — every `Test ·` placeholder quest is retired.**
- **✅ Rulebreaker neutral quests + Chimerus (session 26, → devlog):** 12 neutral "Rulebreaker" quests (economy /
  spell / rule-bending) + 1 Dragon (Chimerus) + 4 cards (Goldcrafter / Lazarus / Taurus the Truth Bringer / Chimerus).
  Adds `winRound` / `castSpell` / `authorsHand` (compound) objectives; `gainMaxGold` / `discover` / `dupeFirstBuy` /
  `spellRepeat` / `minionCost` / `slaughterRepeat` rewards; and the double-leftmost-attack, engrave-all, and
  first-Slaughter-doubler combat mechanics.
- **Remaining:** wire Undead + Mech + Demon + Rulebreaker reward-card + quest art; and a **balance/curve retune** —
  the counter matrix + enemy curve / Line + committed opponent pool want a pass now that the quest content is in.
  **Size:** M (balance) + art wiring.

### C2. Mastery Minions
- Normal shop minions that **improve through repeated actions** (not scheduled, not quests) — find, nurture,
  build around. Reference: **Archmagus Guel** (already scales per spells cast). Patterns: improve on
  spells cast / echoes / beast summons / attachments / fodder consumed / damage absorbed. **Size:** M
  (mostly content + a couple primitives; the scaling+live-text infra exists). **Depends:** none hard.

### C3. Ancients
- One-per-run thesis pieces; once chosen, no other Ancient appears that run. Strong, run-warping, with a
  downside. Sketches: **Echoes** (first Echo each combat doubles; Shouts rarer), **Hunger** (Fodder/Imps
  scale harder; non-Demons cost more), **Steel** (first Attachment/turn free; spells +1), **Embers** (every
  3rd spell casts Growth; shop minions -1/-1). **Size:** L. **Depends:** A1; pairs well with C1's offer UI.

### C4. New mechanics (depth, later)
- **Combo** (Primer arms a Finisher → consumed for a bonus; rewards sequencing). **Balance** (average two
  units' stats — shop puzzle). **Mark / Bind / Curse** (apply Echo-style effects to allies; name by
  valence). **Rewind** (start narrow: "repeat the last friendly keyword trigger" — avoid true undo until the
  rules are sturdier). Each is its own spec when reached. **Size:** L each.

---

## Combat Choreographer (spec: [docs/superpowers/specs/2026-07-06-combat-choreographer-design.md](superpowers/specs/2026-07-06-combat-choreographer-design.md))

One system to own presentation of the combat event log — grouping, order/stagger, hold times, and
which effect channels fire at which offsets — replacing the current split across `buildBeats`,
`pacingConfig`, `useCombatReplay`'s scheduler, and the aura tracker. Four phases, each its own PR,
`main` always playable; each phase besides the last is a no-visible-change refactor.

- **Phase 1 — step tags + Compiler** — ✅ **shipped 2026-07-06** (#185; → devlog). `CombatEvent.step` +
  `simulate()`'s resolution-boundary counter (outcome-neutral, proven against a `main` worktree);
  `compileMoments` (`packages/ui/src/choreo/compile.ts`) reproduces `buildBeats` byte-identically
  while carrying sim-declared `stepGroups`; `useCombatReplay` consumes it. Reference doc:
  [`docs/combat-events.md`](combat-events.md).
- **Phase 2 — Engine (clock + kinds + config).** ✅ **shipped 2026-07-06** (→ devlog). `MomentKind`
  classifier + `kind` on every compiled moment; `pacingConfig` migrated to
  `packages/ui/src/choreo/choreoConfig.ts` (values identical, `ascent.pacing` localStorage key kept;
  Pacing tuner re-pointed + marked deprecated-but-functional); the pure `holdMs` (`choreo/clock.ts`)
  encapsulates the exact former hold formula (unit-locked to the legacy numbers) and now drives the
  scheduler. No visible change. Scope ruling: the per-moment GSAP cue-timeline mechanism was deferred
  to phase 3 (channels give it a reason to exist). **Depends:** phase 1.
- **Phase 3a — Score seam + sfx channel.** ✅ **shipped 2026-07-06** (→ devlog). `choreo/score.ts` —
  `Channel`/`Anchor`/`Cue` + an exhaustive `SCORE: Record<MomentKind, Cue[]>` (one `sfx`/`start` cue
  per kind, each kind its own array — a review fix, no shared reference) + `runMomentCues(moment,
  ctx)`. `choreo/channels/sfx.ts` — `playMomentSfx(moment, events)`, a verbatim extraction of the
  former inline per-beat combat-sound dispatch (the `once`-dedup, event→sound map, real-death-vs-Rise
  shake distinction). `useCombatReplay`'s SFX effect is now a one-line `runMomentCues` call.
  UI-only, invisible: 551 tests + build green, live smoke on a real combat, zero console errors.
- **Phase 3b — the contact cluster.** ✅ **shipped 2026-07-07** (→ devlog). The GSAP cue-timeline
  **engine** (`choreo/engine.ts` — `runAttackExchangeCues`) + `float`/`impact`/`lunge` channel adapters
  land; the attack lunge, contact FX/sfx/recoil, and the beat-advance now run off one GSAP `contact`
  position, retiring the clock's smack-lead weld (`windup+strike−smackLead`). `runMomentCues` became a
  real channel-handler registry (sfx + float; lunge/impact engine-driven). **Phase-2/3a carry-ins,
  resolved here:** (a) ✅ the `impact` MomentKind split into `damage`/`shieldPop`/`poisonTick`; (b) ✅ a
  Rise/Windfury/venom-heavy compiler equivalence fixture added; (c) ✅ `KIND_TO_KEY`'s poison lossiness
  fixed (poison now holds 500 ms, not 460). Two robustness fixes: the scheduler falls back to the
  setTimeout clock if an attack's DOM elements don't resolve (no soft-lock), and a mid-beat speed toggle
  no longer re-fires that beat's sfx/shake. Accepted nuance: backgrounding the tab mid-lunge resumes the
  lunge in place (GSAP timeline) rather than resetting it. UI-only: 569 tests + build green, live smoke
  on a real combat, zero console errors. **Depends:** phase 3a.
  - _Feel refinement (2026-07-08, session 26 → devlog; spec/plan: [corner-clack-contact](superpowers/specs/2026-07-08-corner-clack-contact-design.md)):_
    the lunge lands as a **corner clack** — a pure `contactGeometry` helper stops the attacker at the defender's
    **surface** (no more center-overshoot), tilts it to lead with a corner, rebounds; the defender counter-spins; and
    **strike duration scales with travel distance** so near/far attacks feel equally paced. The impact spark now
    originates at the leading-corner **clack point** (not the defender center). Dials tuned by eye in an interactive
    strike previewer and baked (leadTilt 20 / bite 24 / targetSpeed 1850 / strike 0.20–0.40 / defenderSpin 15 /
    rebound 2.5). Outcome-neutral (UI-only). Accepted: defender knockback still scales with distance (owner call).
- **Phase 3c — aura bursts.** ✅ **shipped 2026-07-07** (→ devlog). The `aura` channel (`choreo/channels/aura.ts`
  — burstDeathAuras/breakShieldAura/reformReborn) + pixiFx `hasAura`/`auraRect` registry queries + the pull-back-driven
  `landed` anchor (`engine.ts` — `runRiseReturn`) land; `syncShields` is reduced to position-tracking + quiet-clear only;
  all **six** cross-file welds retired (`data-rising`, `deathBurstRef`, `REBORN_SUMMON_DELAY`, `SHIELD_BREAK_DELAY`, the
  `.dying` burst-sniff, the unmount-race fallback) and the **double-burst bug is now structural** (a burst destroys the
  bubble → fires once). Two review fixes: taunt burst uses the viewport rect (was offset by board centering); the reborn
  re-form glow is speed-independent (matches the fixed risepop CSS). UI-only: 585 tests + build green, baseline live
  smoke clean; the per-aura visual feel-pass is the owner's, pending. **The choreographer's channel set is now complete
  (sfx / float / lunge / impact / aura) — Phase 4 (Authoring) is the remaining phase.**
- **Phase 4 slice 1 — the 🎬 Choreography panel.** ✅ **shipped 2026-07-08** (→ devlog; spec:
  [choreography-panel-design](superpowers/specs/2026-07-07-choreography-panel-design.md), plan:
  [choreography-panel](superpowers/plans/2026-07-07-choreography-panel.md)). The combat Score is now
  **offset-scheduled, live-editable data** — `Cue` gained `offset`/`scaled`/`enabled`, the `aura` channel
  split into independently-retimeable `auraBurst`/`auraBreak`/`auraReform` cues (the shield-break/reborn
  `setTimeout` welds retired into offsets), and `SCORE_DEFAULTS` + an `ascent.choreoScore` localStorage
  override merge via `getScore()`/`setCue()`/`resetScore()`. The **🎬 Choreography DEV panel**
  (`ChoreographyPanel.tsx`) authors it: a moment-kind rail + per-cue editor (anchor / ms-offset /
  scales-with-speed / on-off), per-moment hold + global tempo, Copy/Reset, a **drag timeline**
  (`ChoreoTimeline.tsx` + pure `timelineMath` px↔ms helpers) where each cue is a draggable chip, and a
  **▶ mock-stage FX preview** (`ChoreoPreviewStage.tsx`, overlay mounted app-wide). The **Pacing tuner is
  retired** into the panel. Invisible by default: equivalence tests + final review confirm byte-identical
  timing (incl. the reborn-glow-footprint fix). **Depends:** phase 3.
  - _Follow-up (2026-07-08, session 26 → devlog):_ ▶ Preview FX now render **in front of** the panel (the
    app-wide `.pixifx`/`.pixifx-under` layers are lifted above the panel's z200 while it's open, via a
    `body.choreo-open` class; restored on close), and timeline lanes with a non-negatable anchor (`start`)
    grey out their negative half (new `allowsNegative()` helper, derived from `clampOffset`).
- **Phase 4 — Authoring (remaining slices).** Per-target staggers / AOE death ripple; `splitPerTarget`/`chain`
  grouping rules; a separate resolution-order tool; the first real re-choreographs as proof (a Deathrattle
  chain folded into its death moment; shield-break-before-damage-number ordering); and the impact cue's
  **true-negative** offset (fire FX before contact — needs `playLunge` to expose the contact position).
  **Note:** `GroupingRules` (today: `Set<CombatEvent['type']>` membership tests) will need to grow into
  predicate/key-based rules to express `chain`/`splitPerTarget` — expect the interface in `compile.ts` to
  widen past simple type-set fields. **Depends:** phase 4 slice 1.

### Combat feel-pass (owner thread, sessions 27–28)
Iterative timing/juice polish on the live arena, one PR each. **Shipped:** Deathrattle bone-skull shatter +
tuning; consequence-overlap (summon/reborn/improve ride the preceding beat via `overlapMs`); shield/reborn auras
track the card's lunge position **and** rotation; Deathrattle attacker returns home before triggering; shield-break
burst made visible on cream (normal-blend gold); Rally attack (wind-up pause + yellow trigger pulse); **End-Combat
one synchronized crossfade** (units + FX fade out together → board + survivors fade in together; → devlog).
**Remaining:** a dying unit should begin *leaving the board* in tandem with the other units' Deathrattle/Reborn
effects (currently the `.dr` collapse hold can trail them) — needs live tuning against the #245 skull-in-own-slot
hold so we don't regress it.

## Cross-cutting threads (ongoing, alongside the phases)

### Balance & power outliers
- **Outliers to re-shape, not nuke** — make them *ask for commitment* rather than be generically strong:
  **Front to Back** (consider: improves only on **board** minions, not shop offers — note its escalation now
  scales with spell power, so re-tune deliberately, don't stack nerfs), **Crypt Drake** (scale from
  **Dragon/Undead** attacks, not all ally attacks), **Gnasher** (cap spell-power gain per combat or require
  meaningful kills), **Wildwood Shaper** (more explicitly Beast-committed).
- **Standing direction** (from `docs/balance-handoff.md` §9): counter-matrix is balance truth — keep **T1–4
  cards relevant** mid-game (scaling payoffs / triples); push **decision diversity** (tribe identity vs
  cross-tribe value engines). Tools: `npm run balance` / `curve` / `player` / `audit`.
- **New Beast levers to weigh in the tuning pass** (2026-07-06 content batch): Kennelmaster is now a
  Start-of-Combat Beast aura (+1/+1 "wherever they are", growing via Avenge), joined by **Solaris Fang**
  (Beast/Mech T5 Rally aura) and **Runic Beetle** (T3 Choose-One Rise/Flurry) — a go-wide Beast payoff spine
  that should lift the tribe's matrix. Also new: **Gildmaster** (triple-economy hero) and **Money Maker**
  (Mech econ drip) — watch both for snowball once the prober is rebuilt. Undead gains **Watcher** (a T6 Rally
  Lantern-caster that permanently pumps the Undead aura — watch that snowball too).
- **⚠ Rebuild the balance prober before the tuning pass** (review 2026-07-03): `balance.ts` bakes only each
  tribe's 7 *lowest-tier* cards and lets Consume demons eat their own board (demon reads power 9 / 0%
  everywhere), so its current "Mech dominant, Beast weak, Dragon/Undead inverted" matrix is mostly tool
  artifact, not truth. Bake tier-appropriate boards per wave (or drive the modern greedy bot constrained
  per tribe) + handle Consume/board-cap ordering, THEN read the matrix.
- **Curve shape** (from `npm run curve`/`player`): the difficulty is **mid-heavy then a victory lap** — enemy
  power steps 45→75→91 across waves 5–7 (bot win% troughs ~9%, only ~69% of runs reach wave 10), then waves
  13–17 read 54–75% win. Smooth the wave-5–7 wall + steepen the late curve. Per-turn scalers also run away
  (a greedy bot's Target Dummy hits 76/50 by wave 12 with zero synergy) — fold into the outlier re-shape list.
- **Content depth:** target **13–15 minions per tribe** (variety is meant to come from the meta layer —
  heroes + quests/mastery/ancients — not raw card count); **~40 spells** (34 today). Run `npm run audit`.
- **New-minions batch — remaining (2, the final piece):** waves 1–4 shipped 25 cards (see devlog). The last two
  are the baked **"+X wherever they are" auras**: **Squirl Scout** (Beasts +2 Attack) and **Scrap Herald**
  (Attachments/Magnetics +2/+2). Both need the run-wide tribe-enchant bake mirroring `undeadBuyAtk` — ~7 creation
  sites + a combat param + immediate application to existing bodies — a delicate change best landed on its own.
  (All batch art is wired.)

### Matchmaking evolution
- Today `pickOpponent` matches by `(wave, Σ(atk+hp) power)`. Ratings are now trustworthy per wave (synthetic
  all-wave pool). Path: **early** wave-first → **mid** wave + strength/rating band → **late** wave + rating
  band + record-similarity. Invariant: *any legal board may be served at combat time.*

### Async-PvP + shared backend (largely shipped; hardening queued)
- Live shared pool on Supabase ([board-backend.md](docs/board-backend.md)): boards upload fire-and-forget on
  run end, load once at boot. Committed `OPPONENT_POOL_DATA` is the offline floor. **Hardening before
  public:** (1) CDN-front the read path (static/edge blob, never hit the DB on boot); (2) **server-side
  replay validation** (a Worker re-derives boards from the `{seed,heroId,actions}` replay → fabricated
  boards aren't reproducible). Both are DB-independent and added *when* going public.

---

## Standing backlog (carried over — unscheduled, behind the spine)

**Epic Runeforge follow-ups:** the Epic Runeforge is plumbed (own `EPIC_RUNES` set, `openEpicRuneforge` quest
reward, shared buy/skip/reroll + Epic UI skin — session 30 devlog). Still to do: (1) **design the real Epic runes**
— it currently holds Rune of Empowerment + 6 functional *placeholders* (Opulence/Ascendance/Sorcery/Fortune/
Plunder/Insight); (2) **wire an actual quest** whose reward is `openEpicRuneforge` (no quest grants it yet, so it's
unreachable in normal play); (3) **rune art** for the Epic set (folded into the pending art pass). Empowerment is
gated to heroes with a doubleable power (`DOUBLEABLE_POWERS`) — extend that set if new value/generate powers land.

**Layout Lab extensions:** the dev Layout Lab (DevMenu → Scale & Layout) covers global + per-row card scale, UI
scale, and warband/hand/HUD position. Not yet: (1) a **shop-row position** offset — the tavern zone is
`position: static` and hosts enemy combat units, so it needs a combat-safe hook (`position: relative` + verify
its absolute children, or a recruit-only offset); (2) **per-element** movers (individual buttons/badges/panels)
rather than just the four regions. Both are quick, additive extensions to `layoutConfig.ts` + the CSS hooks.

**Leaderboard W/L spread for old rows:** the Hall of Champions round-spread only populates for victory runs
logged *after* the `runs.history` column shipped (per-round order isn't stored on older rows and can't be
re-derived from the seed alone). Optional follow-up: backfill via replay re-simulation, or fall back to an
unordered "N wins" cluster for history-less rows so every entry shows *something*.

**Welded-host live text:** the accrued magnitude a host carries from welded magnetics (Better Bot's
`rallyMechAtk`, Harry Botter's `spellAuraBonus`, Heckbinder's `fodderAuraBonus`) is invisible on the host's
card (it renders a different def's text) — needs host-side weld-text infra to fully satisfy the CLAUDE.md
"card text always states current values" rule.

**Enemy Start-of-Combat effects** never fire (`simulate` runs the SC loop over the player board only, per
A.3 step 1) — confirm against the handoff whether pool-captured enemy boards with SC minions should stay
inert; owner to rule.

**Meta / progression (PvE):** unlocks (cards/heroes gated by a persisted profile — heroes are already
data), ascension modifiers (difficulty knob), daily seeds (engine threads one seed; seed the hero-choice
roll, which still uses `Math.random` in the UI), combat replay surface (`serialize`/`deserialize` exist).

**Heroes:** 9 exist (all named + art). More are a `HeroDef` + only-if-novel a new power `kind` (cheap kinds
left: one-shot gold/mana, reroll discount, token summon). Consider always offering a simple "starter" hero
in the 3-of-N. Unwired threads: TitanHP power-master matches no hero; Nadja has no power-master art.

**Dev stats tracker (tabled):** replay-driven analytics (no live telemetry — every run is a deterministic
replay). Headless `npm run track` aggregator over persisted replays → per-minion offer/buy/play/sell +
win-rate-when-present, per-hero/tribe rollups. Pairs naturally with A7's run-history store.

**Per-mechanic combat FX (owner thread):** the first is shipped — the **Deathrattle bone-skull shatter**
(`pixiFx.deathrattle`; a painted skull pops + explodes into bone fragments/splinters/smoke, card fades in
place; session 27 → devlog). Same playbook for the rest: pick a mechanic, agree the look on a cheap preview,
bake it as a `pixiFx` effect + wire the UI-side detection. Candidates: shield-break, poison/toxin kill,
summon, big buff, Rally/Echo. (Divine Shield, Reborn, Taunt auras already done.)

**FX / juice (M4, ongoing):** PixiJS WebGL effects layer is live (hit-impact, gold sprinkle, dust, trigger
pulse, Discover burst, loss-damage blast, Taunt bulwark, Deathrattle skull-shatter). Next candidates: Pixi SoC/Blaster
projectiles (replace SVG bolts), Ward-break shimmer; mid-combat **ascension UI** (engine emits `ascend`
already — fold into `useCombatReplay` + a level-up burst + SFX); Spirit Pup→Worgen mid-combat ascension;
live Buffs window for the remaining run-buffs (Undead-attack/Fodder-Imp/Mama Bear/Guel tick only at settle).

**Audio:** sourced sell + combat-impact clips exist; priority gaps (synth placeholders) per
`docs/sfx-events.md`: Ward break, Start-of-Combat cast, poison kill, reborn, Fodder eat, magnetic weld;
non-attack damage (Blaster AOE, poison) now silent — want cues. Master-volume slider in Settings.

**Onboarding & reach (M4/M5):** first-run tutorial (shop→hand→board→Shout→threat→combat); full **touch**
support + the COMPACT-fan hand redo; **accessibility** (keyboard nav, screen-reader labels, reduced-motion,
colorblind-safe threat/tribe cues); **distribution** — WebP art is done (4.3 MB); decide web (CDN/versioned
deploy) vs desktop **exe** (Tauri/Electron) beyond the itch zip.

**Engine / content polish:** reintroduce a lighter **threat telegraph** (`Omen.tsx` retained, unrendered);
**pool "copies remaining"** cue (pool is wired but invisible) + copy-count weighting on the draw; a subtler
**Ward indicator**; more **Fodder-keyword** users; decouple the last few hardcoded card-ids (effect-system
audit — Hoarder sell, Cling stacking, Yazzus multiplier; novel: Echo Warden / Sylus / Beatboxer); aura
system follow-ups (unify aggregate auras into the `cardBuffs` map; "Aura" line in inspect); Reborn carries
the prior-fight Eternal-Knight enchant; Cassen grant fly-to-hand; ember-gain modifiers feed the projection;
Buddy/Discover pool accounting; vendor Build Handoff v2 into `docs/handoff.md`.

**Tech-debt watch (fold into whichever PR touches it):** split `Recruit.tsx` (**now ~2.7k**, past the flagged
threshold — proposed seams in the review: `recruitViews` / `useCardDrag` / `useAuraTracker` / `useLossSequence`
/ overlay components) into Shop/Hand/Board; split `run.test.ts` (**now ~3.9k**, 3× the old flag) into per-area
suites; `recruit.ts` is 2k (extract `RECRUIT_FACTORIES`, relocate `spellDisplayText` to the UI text chain);
consider sub-reducers in `reducer.ts` as actions grow. No urgent debt.

**Review follow-ups (from [code-review-2026-07-03.md](code-review-2026-07-03.md); session 15 applied the
correctness half — these remain):**
- **UI perf sweep** — two infinite `box-shadow` keyframe loops violate the project's own banned pattern:
  `endpulse` (`styles.css` — on `.heropowerbtn.ready` + `.endturn-side.urgent`, running most of every shop turn)
  and `discpulse` (Discover overlay). Convert to the approved static-shadow `::before` + opacity pattern
  (`kwglow`/`tripready`). Also: autosave is O(n²) (serializes the whole action log every dispatch — debounce);
  `venomdrip`/`aimdash`/`.cardref` minor paint loops; Pixi tickers never idle-stop.
- **UI dead-code purge** — Card still renders removed Reborn-tears DOM; **FontLab ships un-gated in prod**
  (wants `import.meta.env.DEV`); a confirmed dead-CSS list (the OMEN block, `.chip`, `.toast`, `.legend`,
  `.tavernbox`, `.zt/.zh/.hint`, `.disc-gem`).
- **UI type cleanup → `typecheck:web` CI gate** — ~50 pre-existing UI type errors (pixiFx particle types,
  Recruit `targetScope`, Career/EndScreen/Leaderboard importing `BoardMinion`/`Tribe` from `@game/sim`,
  ErrorBoundary `override`) block the gate; CI has the step commented pending the cleanup. (The DEV tuner
  label/void-return drift — 3 of these errors — is now fixed; see devlog session 17.)
- **~17 dead effect-factory ids** in `factories.ts` (verified unused across content/sim/ui/tools/tests) +
  the transitively-dead `battlecryGrantKeyword` chain + `reAttackOnKill`/`REATTACK_GUARD`/`reAttackCache` — a
  3-place sweep per id (factories + `types.ts` union + `schema.ts` enum), or mark explicitly dormant.
- **Remote-pool replay scope** — cross-session replays can serve different opponents than were fought (the
  fetched pool differs); stamp the served opponent into the run record at `faceOmen` if exact reconstruction
  ever matters (pairs with the async-PvP server-side replay-validation work).

## Recently shipped (2026-06-29 — session 9; detail in devlog)
- Hero batch: Djinn (all EoT), Rohan (per-5-casts), Nadja (19 armor), Warden (4g Ward) reworked; new heroes
  Disco Dan (turn-1 Setlist + tier-locked hand), Bagger Ben, Hermit Hank, Fi, Herald, Chronos.
- Front to Back scales Attack and Health **independently** (asymmetric spell power → e.g. +2/+4 per cast).
- Tauntbreaker (T4 Neutral 6/4, Ward + Flurry) — on attack, strips Taunt + Rise off the enemy it hits.
- The Godfodder feeds a created Fodder (no longer shop-dependent) + its art; Hex Flayer / Wolves Den /
  Crypt Wolf art wired.
- Displacement can never swap a minion for a spell (fizzles with no tavern minion).
- Front to Back's per-cast improvement scales with spell power.
- Combat odds panel shows **average damage on loss**.
- Practice mode is read-only against the snapshot DB.
