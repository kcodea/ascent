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

### A7. Career page / match history — the persistence layer *(part 1 ✅ shipped 2026-06-30)*
- **Part 1 (done):** `runHistory.ts` — per-run entries persisted to `localStorage` on run-end (record, line
  verdict, tags, completed?, tribes, contributions, final board), capped 50; `careerStats` rolls them up
  (overall + per-hero). Wired into the store's deferred capture. **Part 2 (next):** the Career overlay UI
  (the title's placeholder Career button) reading `loadRunHistory()` + `careerStats()`.
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

### B1. Hero-power dragging
- **Goal:** targeted hero powers use the same press-drag-release-on-target language as card drag (highlight
  valid targets; release off-target cancels) instead of a separate button mode.
- **Touches:** the existing pointer-drag system + `heroArmed`/targeting line in the store/`Recruit.tsx`.
  **Size:** M. **Done-when:** a targeted power is cast by dragging from the power onto a valid target.

### B2. Discover minimize
- **Goal:** while a Discover is open, collapse it to inspect board/shop/hand before choosing; a small
  "Return to Discover" control restores it. No board-invalidating actions while minimized.
- **Touches:** the Discover overlay in `Recruit.tsx`. **Size:** S. **Done-when:** Discover can be minimized,
  the board inspected, and the pick resumed.

### B3. Keyword / terminology pass
- **Goal:** a player-facing rename for identity: **Battlecry→Shout, Deathrattle→Echo, Golden→Gilded,
  Divine Shield→Ward, Reborn→Rise, Windfury→Flurry, Venomous→Toxin, Magnetic→Attachment** (verb "Attach").
  Keep Taunt, Avenge, Choose One, Start of Combat, End of Turn. Discover (or "Find").
- **Caveats:** **internal IDs stay unchanged** (do it in display/`cardText.ts` only) — lower risk. But it
  must thread the **live-accuracy tooltip system** (scaling cards compute text dynamically), not just static
  strings, so do it as **one atomic PR**. **Avoid "Charge" for Rally** — in card games Charge means *attack
  immediately*; pick a non-loaded word or keep Rally. **Size:** M. **Done-when:** all player-facing text +
  tooltips use the new terms; internal IDs/tests untouched; live-text cards verified.

---

## Phase C — build-authorship depth (after the spine)

### C1. Quest Shops
- Scheduled identity checkpoints (turns **4/8**, expand to 12 later) shown *before* the normal shop: pick
  1-of-3 quests (tribe/archetype leader art). Offers: 1 on-board, 1 pivot/splash, 1 economy/weird. Quest
  minions **never** roll in the normal shop. Prototype: **10–15 quests, turns 4 & 8 only, no reroll, no
  quest-refresh spell** (refresh risks a fishing economy — delay it). **Size:** L. **Depends:** A1 (course).

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

## Cross-cutting threads (ongoing, alongside the phases)

### Balance & power outliers
- **Outliers to re-shape, not nuke** — make them *ask for commitment* rather than be generically strong:
  **Front to Back** (consider: improves only on **board** minions, not shop offers — note its escalation now
  scales with spell power, so re-tune deliberately, don't stack nerfs), **Crypt Drake** (scale from
  **Dragon/Undead** attacks, not all ally attacks), **Gnasher** (cap spell-power gain per combat or require
  meaningful kills), **Wildwood Shaper** (more explicitly Beast-committed).
- **Standing direction** (from `docs/balance-handoff.md` §9): counter-matrix is balance truth — the runner
  flags **Mech dominant, Beast weak, Dragon/Undead flat** (stat numbers are starting dials); keep **T1–4
  cards relevant** mid-game (scaling payoffs / triples); push **decision diversity** (tribe identity vs
  cross-tribe value engines). Tools: `npm run balance` / `curve` / `player` / `audit`.
- **Content depth:** target **13–15 minions per tribe** (variety is meant to come from the meta layer —
  heroes + quests/mastery/ancients — not raw card count); **~40 spells** (32 today). Run `npm run audit`.

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

**Meta / progression (PvE):** unlocks (cards/heroes gated by a persisted profile — heroes are already
data), ascension modifiers (difficulty knob), daily seeds (engine threads one seed; seed the hero-choice
roll, which still uses `Math.random` in the UI), combat replay surface (`serialize`/`deserialize` exist).

**Heroes:** 9 exist (all named + art). More are a `HeroDef` + only-if-novel a new power `kind` (cheap kinds
left: one-shot gold/mana, reroll discount, token summon). Consider always offering a simple "starter" hero
in the 3-of-N. Unwired threads: TitanHP power-master matches no hero; Nadja has no power-master art.

**Dev stats tracker (tabled):** replay-driven analytics (no live telemetry — every run is a deterministic
replay). Headless `npm run track` aggregator over persisted replays → per-minion offer/buy/play/sell +
win-rate-when-present, per-hero/tribe rollups. Pairs naturally with A7's run-history store.

**FX / juice (M4, ongoing):** PixiJS WebGL effects layer is live (hit-impact, gold sprinkle, dust, trigger
pulse, Discover burst, loss-damage blast, Taunt bulwark). Next candidates: death burst, Pixi SoC/Blaster
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

**Tech-debt watch (fold into whichever PR touches it):** split `Recruit.tsx` (~1.5k) into Shop/Hand/Board;
split `run.test.ts` into per-area suites; consider sub-reducers in `reducer.ts` as actions grow. The new
A4/A6/A7 screens are the natural moment to carve `Recruit.tsx`. No urgent debt.

## Recently shipped (2026-06-29 — session 9; detail in devlog)
- The Godfodder feeds a created Fodder (no longer shop-dependent) + its art; Hex Flayer / Wolves Den /
  Crypt Wolf art wired.
- Displacement can never swap a minion for a spell (fizzles with no tavern minion).
- Front to Back's per-cast improvement scales with spell power.
- Combat odds panel shows **average damage on loss**.
- Practice mode is read-only against the snapshot DB.
