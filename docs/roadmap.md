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

### A1. Course + record (win-condition reframe) — **the foundation**
- **Goal:** turn "survive until the game ends" into "play a fixed course and post a record." A run is a set
  number of scored rounds; final **W–L record** is the headline score. Resolve stays the survival pressure
  (hit 0 → the course ends early as a failed run).
- **Why:** record gives every fight meaning (a 10–5 is a real result; 15–0 becomes exceptional, not just
  "victory"). Quests/Ancients/rating all need a stable course to sit inside.
- **Touches:** `CONFIG` (today `maxWave = 20` victory + `winsToWin = 15`), `RunState.history` (already a
  per-wave win/loss array — the record data exists), `reducer` victory/gameover transitions, the HUD win
  counter + end screen.
- **Size:** M. **Depends:** none (it's the root). **Done-when:** a run plays a defined course (recommend
  **2 calibration rounds + 15 scored**, or a flat 15 with rounds 1–2 as calibration), the UI shows a live
  **X–Y record**, and the run ends on course-complete *or* Resolve 0.
- **Open Qs (decide first):** do calibration rounds count toward record (lean: no — economy/Resolve only)?
  Does the course always complete unless Resolve hits 0 (lean: yes)? Can a player "win early"? Maps cleanly
  onto the existing waves-1–5 difficulty on-ramp.

### A2. Par / rating line
- **Goal:** each run gets a target line ("Line: 9 wins"). Beating/covering the line is success; perfection
  isn't required. 15–0 destroyed it, 9–6 covered it, 7–8 missed it.
- **Why:** ASCENT is async, not a live lobby — the player needs a calibrated personal expectation that makes
  partial success legible.
- **Touches:** new per-run line value (start **static by rating tier**: new 7 / mid 9 / high 11 / elite
  12+), surfaced in HUD + summaries. Longer-term inputs: rating, hero, ascension, patch, pool strength.
  `rating.ts` already has wave-relative board rating + bands to build a player rating on later.
- **Size:** S (static first). **Depends:** A1 (record). **Done-when:** each run shows its line and the
  end screen reports covered / missed / exceeded.

### A3. Save & continue — **cheaper than it looks**
- **Goal:** productized save/resume so a 15+ round thinking-game can be stepped away from.
- **Why:** the slow, thoughtful async identity needs "this run matters enough to come back to."
- **Touches:** `serialize`/`deserialize` **already exist** ([state.ts](packages/sim/src/state.ts)) with
  old-save field-healing — most save fields (seed, hero, round, phase, shop, spell slot, hand, board,
  Resolve, gold/maxGold, run-wide buffs, pending Discover/ChooseOne/target) already round-trip. The work is
  **UI + autosave**: write `RunState` to localStorage on phase changes, a Title "Continue" entry, restore on
  boot. Add any new A1 record fields to the save.
- **Size:** S–M. **Depends:** A1 (so the saved state includes the record). **Done-when:** quitting mid-run
  and reopening restores the exact run; verified across recruit/combat/Discover/targeting states.

### A4. Post-combat summary — **data already carried**
- **Goal:** after each fight, explain *what happened and what changed permanently* — not what to buy next.
- **Why:** reflection, not autopilot. Tells luck from a deserved result (the odds panel +
  `avgLossDamage` already does part of this).
- **Touches:** the carry-back channels are **already on `CombatResult`** — `playerSpellPower`,
  `playerMaxGoldGain`, `playerImpBuffGain`/`playerFodderBuffGain`, `playerFodderGrants`,
  `playerUndeadBuyAtkGain`, engrave `permaGain`, `odds`/`avgLossDamage`, cards-to-hand. This is a
  **presentation pass** over existing data. Sections: Result (W/L/draw + record + Resolve Δ + course
  progress), **Permanent Gains** (the carry-backs — the most important section), Major Triggers
  (shouts/echoes/spells/summons/attachments/overflow counts), Standout Unit, optional gentle Risk Signals.
- **Size:** M. **Depends:** A1. **Done-when:** the post-combat screen shows the permanent gains + a
  standout unit, with no next-shop hints.

### A5. Build-tag classifier — **pulled forward (feeds A6 + A7)**
- **Goal:** a pure function that reads a final board + run history and emits tags: *Spell Engine, Fodder
  Economy, Attachment Carry, Echo Web, Beast Swarm, Dragon Scaling, Undead Army, Gilded Carry, Shout Chain,
  End-of-Turn Engine, Flurry Carry, Ward Wall, Toxin Control, Summon Overflow*, …
- **Why:** tags give language to emergent builds and are a **dependency** of post-run summary, career, and
  later quest-gen/analytics — so the classifier ships before the screens that show it.
- **Touches:** new pure module in `@game/sim` (deterministic, unit-testable; mirrors `rating.ts` shape).
- **Size:** M. **Depends:** none (classifier itself). **Done-when:** the function returns stable tags for a
  given board, with tests over representative boards.

### A6. Post-run summary — the emotional payoff
- **Goal:** the end screen makes the player feel they *authored* a run. Final record · line (covered/
  missed/exceeded) · rating Δ · **build identity** (tags, main archetype, MVP, key card, biggest scaling
  source, final board) · **run contributions** ("Added 12 boards to your pool / uploaded N").
- **Touches:** the existing end screen, A5 tags, A1 record, A2 line, and the board-capture counts from
  `boardLibrary`/`remoteBoards` (already produced on run end).
- **Size:** M. **Depends:** A1, A2, A5. **Done-when:** the end screen shows record+line+tags+contributions.

### A7. Career page / match history — the persistence layer
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
