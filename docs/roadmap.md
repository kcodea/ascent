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

### By. Authored frames — live nudge pass (after `feat/card-frames-standard-spell`)
The gold-oval (minions) + purple-square (spells) frames shipped with geometry MEASURED from the art and verified
via DOM, but the **headless preview can't render a screenshot**, so the by-eye seating is deferred to Mike over
HMR. **Do-when:** in a focused tab, dial (1) the tint strength/blend on `.cframe-tint` (currently `color` @0.4),
(2) the exact tier seat on each banner + the atk/hp badges on the oval's lower curve, (3) the spell "✦ Spell"
ribbon position, (4) eyeball the DS ward / Venom / Golden / Dual-tribe states on the new shapes, and (5) the
fanned-hand overlap now that framed cards overhang ~1.1× the slot. All knobs are the `--sh` + multipliers in
`styles.css` → "AUTHORED FRAMES".

### Bx. Audio SFX — authoring pipeline (in flight)
- **Manifest + generator** (`npm run sfx:manifest`, PR #335), **wiring** (per-card play/death/effect + hero
  select/power hooks, PRs #336/#337), and the **`npm run sfx:import` drop-folder importer** (session 34, →
  devlog) are up. The recording loop is now: drop clips in `audio-inbox/` → `npm run sfx:import` → they land at
  the right path and statuses flip. **Next:** record the actual clips into `packages/ui/src/audio/{cards,heroes}/`;
  reconcile the spell default bed with `feat/spellcast-sfx` (`castspell.mp3`); a live audio + combat-feel pass
  in the focused Chrome tab once clips exist. A shared visual recording worklist exists as an Artifact.
- **Mixing desk shipped** (session 35, → devlog): all audio dials in one `audioConfig` (master limiter + 4
  category buses + per-category levels); the dev SFX panel is now a desk with master dials, per-bus faders,
  live peak/gain-reduction meters, realistic test-scenes, and Export-config. **Next (deferred slots exist):**
  per-bus compressors shipped-on (Approach 2), sidechain ducking, and ingest LUFS-normalization in `sfx:import`.

### B0. FX follow-ups (from the Echo skull poof + buff tendrils, session 29)
- **Effect-animation coverage audit (session 39 → devlog).** Full sweep of which combat effects show an animation
  vs none, across the three buff FX (pulse / tendril / descend) and non-buff effects. Ordered queue (owner: do all):
  - ✅ **Attack-windup self-pulse (shipped session 39).** On-attack / on-ally-attack self-buffs (Solaris, Trophy
    Stalker, Watcher, Crypt Drake, Taragosa, Forsaken Mage, Hunter) were absorbed into the `attackExchange` and got
    no pulse; the wind-up path now also runs `groupSelfBuffs` → in-place pulse (shared `fireSelfBuffs` helper).
  - ✅ **Descend allow-list (shipped session 39).** `deathrattleBuffFodder` (Burial Imp) + `deathrattleBuffAllByImpAura`
    (Chef Raag) added to `DEATHRATTLE_BUFF_FACTORIES` — they routed as a dead-source tendril → dropped; now descend.
    (`knit`/Spear Warden stays out pending its echo-aura redesign.)
  - ✅ **`improve` events → pulse (shipped session 39).** New `improveSelf` cue on the `improve` moment kind pops a
    bare pulse (no badge flash) at each strengthened unit. Not on `attackExchange` — Trophy Stalker's growth rides
    its on-attack self-buff pulse instead (no double-pop).
  - **Keyword grants** (Ward/Taunt/Rise/Toxin granted mid-combat). Owner chose **bubble pop-in + granter medallion**.
    - ✅ **4a — granter medallion (shipped session 39):** `keyword` events (with a source) now pulse the granter's medallion.
    - ⏳ **4b — bubble pop-in:** make the granted Ward dome / Taunt frame / Rise bubble POP at grant time. Per-keyword
      visual → build on a preview rig first (owner FX rule), then wire. Not wired blind.
  - ✅ **Combat gold gains (shipped session 39).** New `coins` cue on the `maxGold` moment bursts `pixiFx.coins` at the
    unit (Soulsman / Bone Taxer Avenge), on top of the float. (Thematic, not literal — max-Gold is a ceiling raise.)
  - ✅ **Non-melee damage (shipped session 39).** New `damageFx` cue on the `damage` + `death` moment kinds pops
    `damageBurst`+`impactPulse` at each SC-nuke / split-damage / Blaster-AoE target. Tied to the damage moment (not
    the CSS bolt), dedupes targets, and never double-bursts melee (which owns its attack impact FX).
  - ✅ **Summon arrival burst (shipped session 39).** New `summonFx` cue poofs `pixiFx.dust` under each arriving unit
    at +250ms (the `summonpop` bounce). *Wants a live eyeball* — spawn position/size + timing reasoned from the
    keyframes, not yet watched; tunable via the dev score panel offset.
  - ✅ **Transform / `ascend` (shipped session 39).** Owner tuned the **flash** morph on the rig; baked into an
    `ascendFx` cue (`pixiFx.flashBloom` + `ascendPresets.ts` + an `ascendpop` CSS pop). A lime-white flash masks the
    swap, then the new card pops in. *Wants a live eyeball* — dials in `ascendPresets.ts`. Rig retained for retuning;
    dissolve/shatter/wipe/vortex styles reserved.
  - **Minor** — `keywordLost` (Tauntbreaker strip), `venomLost`, Stealth `reveal` show nothing beyond a pill/opacity change.
- **Taunt shield frame — polish (session 34, → devlog).** The heater-shield frame + raster compositing pipeline
  shipped. Open threads: (1) a **thinner-border frame** variant so the art reaches closer to the gold (current
  window is ~70% of the shield width — art fills it correctly, the border is just wide); (2) re-add the
  **forge-heat pulse** as an opacity glow hugging the frame; (3) **portrait-aspect art** for shield units so the
  window fills with zero crop; (4) roll the same 5-layer pipeline out to a normal-card frame + golden/spell frames.
- **Buff descend — per-tribe looks.** The descend system (Deathrattle buff-others rain down; session 33) shipped
  one owner-tuned `default`. Tune a drop + landing-pulse look per tribe on `buff-descend-preview.html`, bake into
  `DESCEND_PRESETS` + `DESCEND_ASSIGN.byTribe`. Until then every tribe's Deathrattle buff uses the one amber default.
- **Buff descend — retire the factory list.** Routing keys off `DEATHRATTLE_BUFF_FACTORIES` (a UI-side set of
  onDeath buff-other `do` names) — the one maintenance point. A sim-level trigger annotation on buff events (which
  effect produced them) would remove the list and handle a future card with both a SoC and an onDeath buff-other.
- **Buff pulse — per-tribe looks.** The pulse system (self-buff point-blast) shipped `default`-only (session 32).
  Tune a look per tribe on `buff-pulse-preview.html`, paste the JSON, and bake into `PULSE_PRESETS` +
  `PULSE_ASSIGN.byTribe` — exactly like the tendril tribe presets. Until then every tribe's self-buff uses the one
  gold `default` blast.
- **Buff pulse — live look check.** The in-game pulse was never eyeballed live (headless preview can't watch rAF).
  Drive a focused Chrome tab through a combat with a self-buffing unit (e.g. a Start-of-Combat self-pump) and
  confirm the blast + badge flash read well on the cream board before per-tribe tuning.
- **Buff pulse — other styles + recruit-phase casts.** The `style` field is ready for `shard`/`nova` variants
  (only `ring` is built), and there's no dedicated `neutral` preset (falls to `default`). Separately, hero-power /
  spell buffs resolve in the **recruit/shop phase** (a different code path from the combat replay) and get only a
  sound + CSS glow today — wiring them to `pixiFx.pulse` is a future pass.
- ~~**Shop-phase buff-other FX — tendril / descend (M2).**~~ ✓ **shipped (session 36, → devlog):** a card buffing
  *other* minions in the shop now replays the same **tendril** (living-minion source) / **descend** (spell /
  Deathrattle) combat uses. Captured at the recruit dispatch layer (`recruitBuffFx`/`captureBuffFx`, mirroring
  `fodderEaten`; source→target via a board-stat diff), rendered through a shared `fireBuffFx`. Covers Battlecry,
  on-summon, Guel, spell casts, recruit Deathrattles, Karwind/Bane, Choose One, and Hunter's on-gain-Attack;
  passive auras (Lantern, Imp) stay ambient. **M1 (step counters) also shipped session 36.** *Open:* live visual
  eyeball on the cream board; optional per-tribe descend/tendril tuning (see the follow-ups above).
- ~~**Buff tendrils — on-attack buffers.**~~ ✓ **shipped (session 33, → devlog):** on-attack / Rally buff-others
  (Supporter, Chimerus, Chorus Engine, Raptor, Crypt Drake, Taragosa) now fire tendrils woven into the attacker's
  wind-up (pulse → tendril → lunge) via `onWindupBuffs` on the lunge timeline. Landed at the wind-up (not
  contact-timed as originally sketched — the owner wanted the buff to read *before* the swing).
- ~~**Ward shatter timing.**~~ ✓ **shipped (session 33, → devlog):** a warded unit's shatter now fires at the
  lunge's real `contact` (`onImpactAuras` on the lunge timeline) instead of a fixed start+300ms cue that drifted
  off the hit and left the bubble lingering disjointed from the unit. `auraBreak` removed from the `attackExchange`
  score (engine-owned there); it still handles Wards broken outside an attack.
- ~~**Ward → CSS hex-sphere dome.**~~ ✓ **shipped (session 34, → devlog):** retired the per-frame-tracked Pixi
  ward bubble for a pure-CSS layered dome glued to the card (`.ward` stack: gold pulse body + projected hex-sphere
  SVG + vignette + spot + gloss, over the card art; outer glow + breath on the card). Break shatter → rect-based
  `pixiFx.shatterAt` at contact, WITHOUT the old shield-disc flash. Gold/blue trail beefed (`count` + perpendicular
  `width` band). **Follow-ups:** (a) give **Reborn** the same CSS treatment (still on Pixi, same fragility); (b) the
  hex-sphere is a *flat-projected* SVG — no true per-cell perspective compression at the very rim (good enough, but
  a real 3D-baked asset would be crisper); (c) facet density is baked into the SVG (regenerate the script to change).
- **Spear Warden echo-aura.** `deathrattleBuffCardTypeRunWide` (`knit`) is deliberately excluded from descend
  (asserted false) — the owner wants it reframed as a persistent "echo-aura" (its own effect concept), separate
  from Deathrattle. Design + build when ready.
- **Buff tendrils — the other styles.** The `style` field + renderer seam are ready for `lightning` and `beam`
  variants (only `tendril` is built). And `neutral` has no dedicated preset (falls to the beast-green
  `default`) — tune one if neutral buffers should read distinctly.
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

### B0b. Audio — SFX authoring (manifest shipped session 31; wiring + assets next)
- **Manifest + generator — ✅ shipped (session 31, → devlog).** `docs/audio/sfx-manifest.md` enumerates all
  ~569 sounds; `npm run sfx:manifest` regenerates it from card/hero/spell data, preserving the human brief +
  status columns. Recording can now proceed against a stable checklist.
- **Wiring PR (next).** Build the four hooks the manifest documents but the engine doesn't have yet, each
  guarded by "clip present?" so it's silent until an asset exists: per-card **death** (`cards/<id>.death.mp3`
  in `choreo/channels/sfx.ts`, via the replay `cardIds` uid→cardId map), per-card **effect**
  (`cards/<id>.effect.mp3` at the combat `triggerPulse` sites + the shop Battlecry path in `store.ts`), **hero
  select/power** (`heroes/<id>[.power].mp3` in `HeroSelect.tsx` / `StatusBar.tsx`), and the **spell default
  bed** (`spellcast.mp3` routed from `sfx.castSpell()`). Plus the `audio/heroes/*.mp3` loader glob + `sampleVol`
  defaults. (Note: a concurrent branch `feat/spellcast-sfx` was already building the spell-cast bed — reconcile
  before/at that PR.)
- **Assets.** Record clips into `packages/ui/src/audio/{cards,heroes}/` per the manifest; each recorded row's
  status auto-flips `⬜→🎙️` on the next `npm run sfx:manifest`.

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
- ~~**Combo** (Primer arms a Finisher → consumed for a bonus; rewards sequencing).~~ **REMOVED** (2026-07-15): the
  `primer`/`combo` mechanic was built then pulled at the owner's call — affected cards kept their base effect, Combo
  Kim was retired. See the devlog.
- **Balance** (average two units' stats — shop puzzle). **Mark / Bind / Curse** (apply Echo-style effects to
  allies; name by valence). **Rewind** (start narrow: "repeat the last friendly keyword trigger" — avoid true
  undo until the rules are sturdier). Each is its own spec when reached. **Size:** L each.

### PR2 — Bleed + Critical Strike — ✅ **shipped 2026-07-13** (→ devlog)
- **Bloodbinder** Start-of-Combat **Bleed** (every 6 attacks → its Attack to 3 random enemies) + **Commander
  Impala** 50% **Critical Strike** (double damage, seeded per swing). New `CR` keyword + `scArmBleed` effect.
- **Follow-up:** a dedicated crit VFX in the combat replay (red flash / "CRIT" flourish) — presentation choreo.

### Withheld heroes (temporarily pulled — owner 2026-07-13)
- **Warden**, **Myra**, **Chaos** are `wip: true` (kept in the registry, hidden from the picker) pending a rework
  or re-evaluation. **Herald** was removed outright. Re-enable by clearing `wip` (or re-adding Herald) when ready.

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

**Rune build-out (the big content queue).** Batch 1 shipped the forge-size change (4 options), removed Empowerment,
and added the low-risk grant/discover/economy runes (Small Fortune, Quick Study, Scout, Spare Parts, Champion,
Armory, Gilded Spark) + re-priced Copies. The rest of the owner's list is queued below, grouped by effort. Also
pending: **Epic rune art** (the Epic runes fall back to the sigil glyph) + **more art** for the new basic runes.

- **Easy — grants / discovers / simple hooks (next batch):**
  - Rune of the Pair (2 random T4 minions — needs a "grant N random minions of exact tier N" option),
  - Rune of the Menagerie (one random Beast/Demon/Dragon/Mech/Undead — a per-tribe grant set),
  - Rune of Quick Study/Armory already done; **Second Path** (Discover a Greater-Quest reward minion — needs a
    greater-quest-reward pool), **Champion/Scout** done.
  - Rune of Kindling (cast spell → leftmost +3/+3) + Rune of Scales (cast spell → Dragons +1/+1): on-spell hooks,
    mirror Rune of Summoning.
  - Rune of the Epic Forge (schedule the Epic forge on turn 9 — reuse `pendingEpicRuneforge` + a scheduled wave).
  - Rune of the Gilded Spark done. Grants of existing cards: Stormcalling (Gilded Karwind + random Shout),
    Frontline Glory (Gilded Yazzus + Front to Back), Assembly (Beatbot + 2 Attachments), Den Mother (+ self-buff
    modifier), Soul Taxes (Souls Man + Av4 economy). These need a **"grant a Gilded/golden card"** option.
  - **New cards to build** (owner-confirmed specs, 2026-07-10):
    - **Feasting Bogrot** (Rune of the Feast) — T5 Demon, **6/4**: *End of Turn: consume a Fodder and also give its
      stats to adjacent minions.*
    - **Reconfigured Combinator** (Rune of Reconfiguration) — a NEW unit, **T5 Mech 8/8**, with **unique art**;
      triggers whenever you play Shout minions.
- **Medium — new combat effects:**
  - Avenge: Broodpit (Av6 → 2 Taunt Imps), Appraisal (Av4 → spells +1/+1), Spearline (Av4 → summon Spear Warden
    that attacks now), Soul Taxes (Av4 → +1 max Gold).
  - Start-of-Combat: First Claws (leftmost+rightmost Beasts attack now), Rising Graves (give 2 Undead Rise).
    (Rune of Rallying already established the SoC-trigger pattern.)
  - Rune of the Reliquary (End of Turn → trigger your leftmost Echo — an EoT recurring effect).
  - Rune of Bartering (Shout minions sell for 2 Gold — a sell-value override by filter),
    Rune of Packcraft (summon in combat → Beasts +1 Atk run-wide), Rune of Salvage (Mech loses Ward → attachment
    next shop), Rune of the Warden (grant Spear Warden + a combat auto-summon).
- **Hard — deep engine mechanics:** Twin Gilding (Gild at 2 copies — changes the triple threshold), Twilight
  (Start-of-Combat effects ALSO fire at End of Turn), Rune of Inheritance (leftmost dies → rightmost gains its
  stats, a combat on-death transfer), Banking (End of Turn weld Money Bots to edge Mechs).

Sequence with the owner batch-by-batch; several grants need card designs/stats confirmed first.

**Layout Lab extensions:** the dev Layout Lab (DevMenu → Scale & Layout) covers global + per-row card scale, UI
scale, and warband/hand/HUD position. Not yet: (1) a **shop-row position** offset — the tavern zone is
`position: static` and hosts enemy combat units, so it needs a combat-safe hook (`position: relative` + verify
its absolute children, or a recruit-only offset); (2) **per-element** movers (individual buttons/badges/panels)
rather than just the four regions. Both are quick, additive extensions to `layoutConfig.ts` + the CSS hooks.

**Player Leaderboard migration + hardening:** the new player Leaderboard (top players by rating) reads/writes a
`profiles` table that must be created by re-running `schema.sql` (the block is idempotent; dormant until then — it
shows the empty state meanwhile). Friend-scale trust model: anon may upsert any row by name (like the rest of the
remote seam) — hardening later = server-side validation (re-derive rating from the replay before trusting the
client), and possibly split "games played" into wins/losses or add a min-games gate so a single lucky run can't top
the board.

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
summon, big buff, Rally/Echo. (Divine Shield + Reborn auras already done. Taunt is a static grey card border,
not a Pixi aura — the old silver-bulwark shader was removed, session 31.)

**FX / juice (M4, ongoing):** PixiJS WebGL effects layer is live (hit-impact, gold sprinkle, dust, trigger
pulse, Discover burst, loss-damage blast, Deathrattle skull-shatter). Next candidates: Pixi SoC/Blaster
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
- **Combat replay frame freezes (from the "vanishing lunge" dive, session 30 — `lagSmoothing` shipped as the
  band-aid).** The remaining defect: **55–86ms synchronous-React-render freezes** on some summon/death beats
  (a probe ruled out FX/Pixi/GPU-draw/layout-reads/GC — all ~0, so it's the per-beat render/reconciliation of
  the combat view). Profile with the DevTools flame chart (Bottom-Up, self-time) to name the offender
  (`computeFrame` + the per-beat event-log scans that grow with combat length are prime suspects), then
  memoize/short-circuit it. Cheap adjacent win: `syncShields` calls `getBoundingClientRect` **per aura bubble
  every frame** (~100k calls in one combat) — cache the rects / only re-measure on layout change.
- **Combat timing clashes (from [combat-timing-audit.md](combat-timing-audit.md), session 31).** The audit
  lined up each moment's beat-hold vs its actual animation length vs the ordering doc. **Fixed so far:** the
  death→summon and Rise→reborn read-leads were bumped + generalized (`deathConsequenceLead`) so the
  consequence doesn't land on top of the skull/fade. **Remaining clashes:** (1) **standalone buff waves** —
  210ms hold vs a 600ms pulse + a tendril that travels 350–780ms before its stat-reveal, so the +N lands
  outside its beat; fold the tendril travel into the hold (or shorten it). (2) **Systemic amplifier** — CSS
  combat animations are fixed seconds and ignore the `combatSpeed` slider, while holds ÷ and Pixi/GSAP × it,
  so every margin worsens ~2× at 2× speed; drive combat CSS durations off a `--combat-speed` var. (3) overlap
  tails (`risepop 700`, re-form glow @+460) bleed past their 240ms ride; (4) poison mist clipped 50ms.
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
