# ASCENT — roadmap / queue

The forward queue. **Shipped detail lives in [devlog.md](devlog.md)** (newest first); high-level
milestones in [../CLAUDE.md](../CLAUDE.md). When something ships, delete it here — this doc is a queue,
not a history. Keep it honest.

**North Star:** a course-based async autobattler where every run has a record, a memory, and an identity —
*"this was **my** build that run,"* not "I forced a known comp and won." The run/career spine (record, par
line, save/continue, post-combat + post-run summaries, build tags, career page, rating) is shipped; the work
now is making runs feel *fair and fun to play against humans*, deepening build authorship, and getting the
game ready for a public audience.

The five buckets below are ordered by when we intend to act, not by size:
- **Now** — the active near-term focus.
- **Next** — queued right behind Now; ready to start when a Now item frees up.
- **Later** — real work, unscheduled; pulled forward when it becomes the highest-leverage move.
- **Parked** — deferred, dormant, or blocked on an external step (a decision, a schema run, a rework).
- **Public Release** — the hardening gate before ASCENT goes to a public audience.

---

## Now

### Human-playtest balance
The counter matrix is balance *truth*; stat numbers are dials. With all six tribes + the quest content in,
the game wants a real tuning pass driven by human play (not just the bot).
- **Real-player telemetry is the primary balance lens** (owner call 2026-07-16). The greedy bot buys
  `shop[0]` / picks index 0 — making it "understand the game" is a real project, not a quick fix — so treat
  bot sims as RELATIVE A/B deltas only, never absolute truth. The wave-tagged buy analytics + Balance Report
  CSV export (shipped 2026-07-17) is the data source; a parallel mass-sim runner is a cheap add if relative
  deltas are wanted at scale.
- **Smooth the curve.** Difficulty is mid-heavy then a victory lap — enemy power steps 45→75→91 across waves
  5–7 (bot win% troughs ~9%), then waves 13–17 read 54–75%. Soften the wave-5–7 wall + steepen the late
  curve. Per-turn scalers also run away (a greedy bot's Target Dummy hits 76/50 by wave 12 with no synergy).
- **Reshape the power outliers, don't nuke them** — make them ask for commitment: **Front to Back** (improve
  only on board minions; it already scales with spell power, so re-tune deliberately), **Crypt Drake** (scale
  from Dragon/Undead attacks only), **Gnasher** (cap spell-power gain per combat), **Wildwood Shaper** (more
  explicitly Beast-committed).
- **Content depth targets:** ~13–15 minions per tribe (variety comes from the meta layer, not raw count);
  ~40 spells (34 today).

### Quest refinement
Engine + UI + all six tribes' quest content shipped. What's left is polish + coverage.
- **Wire the remaining quest / reward-card art** — Undead, Mech, Demon, and Rulebreaker reward cards + quest
  cards still fall back to the glyph.
- **Balance the quest offers** as part of the human-playtest pass — objective difficulty, reward power, and
  which tribe slots get guaranteed on the two quest turns (waves 5 & 11).

### Rating & matchmaking quality
Per-wave ratings are now trustworthy (synthetic all-wave pool); the run's par Line is rating-driven.
- **Rating-aware matchmaking** is intentionally off (rating is expectation, not difficulty). Revisit once the
  board pool is larger. Path: **early** wave-first (today) → **mid** wave + strength/rating band → **late**
  wave + rating band + record-similarity. Invariant: *any legal board may be served at combat time.*
- **New-Line grace** — soften the first misses after a promotion (`lineGrace` field reserved).
- **Seed veterans' rating from history** — optional backfill for players with pre-rating runs. (Surfacing the
  per-run Renown Δ on Career match cards shipped 2026-07-17 in the Standout Stats panel.)

### Run identity
The career surface exists; deepen what a finished run *remembers*.
- **Round-by-round + replay view.** Career match cards expand in place to the stat line + final warband; the
  remaining step is a full round-by-round view — store the `{seed,heroId,actions}` replay on the run-history
  entry so a run can re-derive any round's board (the end-screen round-board viewer already does this
  in-session).
- Deferred summary sections that need per-minion data not yet on `CombatResult`: biggest permanent-scaling
  source, quest-choice recap, Ancient recap.

---

## Next

### Remaining recruit-FX gaps (from the 2026-07-17 buff-animation audit)
The Aura Wash + EoT beat replay closed the big ones — plus the triggered rune buffs (Rune of Kindling /
Scales / Scale) now descend onto their targets. Still open:
- **Buff-on-summon rewards** — Den Marker (quest) buffs a Beast *as it enters play*; the buff-diff can't
  see a card that's new to the board this action, so it's silent. Needs a dedicated descend signal keyed to
  the freshly-summoned uid (not a `captureBuffFx` wrap).
- **One-time `buffBoard` quest reward** — the whole-board buff on quest completion fires at a start-of-turn
  modal moment with no FX; wants timing care before wiring a board-wide descend/wash.
- **Gold-spend feedback** — the Gold counter changes with no flash/shake on buy/reroll/upgrade (only sells
  produce gold visuals; the coin-spray primitive already exists).
- **Recruit-time quest progress** — the badge `questpulse`/`questbounce` fire only off combat deltas;
  shop-phase objective progress updates silently.
- **Quest/rune-node anchored tendrils** — quest and rune EoT rewards replay as sourceless descends; anchor
  them to the quest badge / rune chrome (needs a synthetic source kind in `BuffFxEvent` + a node rect).
- **Rune acquisition burst** — no FX when a rune is bought at the Runeforge.
- **Reroll** — sound + generic card pops only; no shuffle/sweep animation.
- **Descend looks are one-amber** — `descendPresets` has empty byCard/byTribe; give spells tribe/identity
  variants like the tendrils have.

### Build-authorship depth (meta systems)
The depth layer that answers *"what kind of run did I author?"* — comes after the balance/identity work above.
- **Mastery Minions** — normal shop minions that improve through repeated actions (not scheduled, not
  quests): find, nurture, build around. Reference: Archmagus Guel (scales per spell cast). Patterns: improve
  on spells cast / echoes / beast summons / attachments / fodder consumed / damage absorbed. Mostly content +
  a couple primitives; the scaling + live-text infra exists.
- **Ancients** — one-per-run thesis pieces; once chosen, no other Ancient appears that run. Strong,
  run-warping, with a downside. Sketches: Echoes (first Echo each combat doubles; Shouts rarer), Hunger
  (Fodder/Imps scale harder; non-Demons cost more), Steel (first Attachment/turn free; spells +1), Embers
  (every 3rd spell casts Growth; shop minions −1/−1). Pairs well with the quest offer UI.
- **Alignment** — a run-shaping identity/allegiance system (owner's next meta thread). Scope + primitives to
  be specced with the owner before build.

### Rune build-out
Basic + Epic Runeforges ship with 25 basic + 23 Epic runes wired. Remaining is content + art, sequenced with
the owner batch-by-batch (several grants need card designs/stats confirmed first):
- **Easy** — grant/discover/simple-hook runes: Rune of the Pair (2 random exact-tier minions — needs a
  "grant N random minions of tier N" option), Rune of the Menagerie (one random minion per tribe).
- **Medium** — new combat effects behind unbuilt runes; mirror the established SoC / Avenge / EoT patterns.
- **Hard** — deep engine mechanics already sketched but not fully generalized.
- **Art:** Epic runes + several new basic runes fall back to the sigil glyph — author art.

### New mechanics (depth, later within Next)
Each its own spec when reached: **Balance** (average two units' stats — a shop puzzle), **Mark / Bind /
Curse** (apply Echo-style effects to allies), **Rewind** (start narrow: "repeat the last friendly keyword
trigger"; avoid true undo until the rules are sturdier).

### Open rules question
- **Slaughter doublers on a mutual kill.** The base Slaughter now fires when the killer dies in the same
  clash (2026-07-17), but the re-trigger BONUSES (Law of Teeth, Author's Hand's "first Slaughter each
  combat", Feeding Line) stay gated on `killerAlive` — a dead killer gets its base Slaughter but not the
  extra procs. Decide whether the doublers should also fire on a mutual kill (owner call).

---

## Later

### Combat feel & FX
- **Combat Choreographer — Phase 4 (Authoring).** The channel set (sfx / float / lunge / impact / aura) and
  the 🎬 Choreography panel are shipped. Remaining: per-target staggers / AOE death ripple; `splitPerTarget` /
  `chain` grouping rules (GroupingRules widens past type-set membership); a separate resolution-order tool;
  the impact cue's true-negative offset (fire FX before contact — needs `playLunge` to expose the contact
  position); and the first real re-choreographs as proof.
- **Per-mechanic combat FX.** Deathrattle skull-shatter, Ward dome + shatter, Reborn re-form, buff pulse /
  tendril / descend all shipped. Candidates next: Pixi SoC/Blaster projectiles (replace the SVG bolts),
  poison/toxin kill, big-buff, summon-arrival tuning. Per-tribe looks for pulse/tendril/descend are default-
  only — tune on the preview rigs and bake into the `*_PRESETS` + `*_ASSIGN.byTribe` maps.
- **Keyword-grant bubble pop-in** (4b) — Ward dome / Taunt frame / Rise bubble should POP at grant time
  (granter medallion pulse already ships). Build on a preview rig first, then wire.
- **Buff / FX live eyeballs** — several session-39 cues (summon-arrival poof, `ascend` flash) were reasoned
  from keyframes, not yet watched live on the cream board; drive a focused Chrome tab and tune.
- **Recruit-phase hero/spell buffs** get only a sound + CSS glow today — wire them to `pixiFx.pulse`.

### Audio
- Record the actual SFX clips into `packages/ui/src/audio/{cards,heroes}/` per the manifest
  (`npm run sfx:manifest`); the drop-folder importer (`npm run sfx:import`) and mixing desk are up. Reconcile
  the spell default bed with `castspell.mp3`. Deferred desk slots: per-bus compressors, sidechain ducking,
  ingest LUFS-normalization.
- Priority synth-placeholder gaps (per `docs/sfx-events.md`): Ward break, Start-of-Combat cast, poison kill,
  reborn, Fodder eat, magnetic weld; non-attack damage (Blaster AOE, poison) is silent. Master-volume slider
  in Settings.

### UI performance sweep (violates our own banned pattern)
- Two infinite `box-shadow` keyframe loops break the looping-paint rule: `endpulse` (`.heropowerbtn.ready` +
  `.endturn-side.urgent`, running most of every shop turn) and `discpulse`. Convert to the approved static-
  shadow `::before` + opacity pattern (`kwglow` / `tripready`).
- Autosave is O(n²) (serializes the whole action log every dispatch) — debounce.
- Combat replay: 55–86ms synchronous-React-render freezes on some summon/death beats (FX/Pixi/GPU/layout/GC
  all ruled ~0 — it's per-beat render/reconciliation). Profile the flame chart, memoize `computeFrame` + the
  growing per-beat event-log scans. Cheap adjacent win: `syncShields` calls `getBoundingClientRect` per aura
  bubble every frame (~100k calls/combat) — cache the rects, re-measure only on layout change.

### Combat timing clashes (per `combat-timing-audit.md`)
Remaining: (1) standalone buff waves — 210ms hold vs a 600ms pulse + 350–780ms tendril, so the +N lands
outside its beat; fold the tendril travel into the hold. (2) CSS combat animations are fixed seconds and
ignore `combatSpeed` while holds ÷ and Pixi/GSAP × it — drive combat CSS durations off a `--combat-speed`
var. (3) overlap tails (`risepop 700`, re-form glow @+460) bleed past their 240ms ride. (4) poison mist
clipped 50ms. Also: a dying unit should begin leaving the board in tandem with the other units' Echo/Reborn
effects (the `.dr` collapse hold can trail them) — tune live against the skull-in-own-slot hold.

### Dev tooling
- **Layout Lab extensions:** a shop-row position offset (the tavern zone is `position: static` and hosts
  combat units — needs a combat-safe hook) + per-element movers (individual buttons/badges/panels).
- **Dev stats tracker (tabled):** replay-driven analytics — a headless `npm run track` aggregator over
  persisted replays → per-minion offer/buy/play/sell + win-rate-when-present, per-hero/tribe rollups. Pairs
  with the run-history store.
- **Font Lab** ships always-on — gate behind `import.meta.env.DEV` before a public build.

### Engine / content polish
- **Welded-host live text** — accrued magnitude a host carries from welded magnetics (Better Bot, Harry
  Botter, Heckbinder) is invisible on the host's card; needs host-side weld-text infra to satisfy the
  "card text always states current values" rule.
- Reintroduce a lighter **threat telegraph** (`Omen.tsx` retained, unrendered); **pool "copies remaining"**
  cue + copy-count draw weighting; a subtler Ward indicator; more Fodder-keyword users; decouple the last
  hardcoded card-ids (Hoarder sell, Cling stacking, Yazzus multiplier; Echo Warden / Sylus / Beatboxer);
  unify aggregate auras into the `cardBuffs` map + an "Aura" inspect line; Reborn carries the prior-fight
  Eternal-Knight enchant; Cassen grant fly-to-hand; vendor Build Handoff v2 into `docs/handoff.md`.

### Tech-debt watch (fold into whichever PR touches it)
Split `Recruit.tsx` (~2.7k — proposed seams: `recruitViews` / `useCardDrag` / `useAuraTracker` /
`useLossSequence` / overlays) and `run.test.ts` (~3.9k → per-area suites); extract `RECRUIT_FACTORIES` from
`recruit.ts` (2k); consider sub-reducers in `reducer.ts` as actions grow. **Dead-code purge:** ~17 dead
effect-factory ids (`factories.ts` + `types.ts` union + `schema.ts` enum, 3-place sweep each) +
`battlecryGrantKeyword` chain + `reAttackOnKill`/`REATTACK_GUARD`/`reAttackCache`; Card renders removed
Reborn-tears DOM; a confirmed dead-CSS list (OMEN block, `.chip`, `.toast`, `.legend`, `.tavernbox`, `.zt/.zh/
.hint`, `.disc-gem`). **UI type cleanup → `typecheck:web` CI gate:** ~50 pre-existing UI type errors block
the gate (the step is commented in CI).

---

## Parked

- **Withheld heroes** — Warden, Myra, Chaos are `wip: true` (in the registry, hidden from the picker) pending
  a rework; Herald was removed outright. Re-enable by clearing `wip` when ready.
- **Enemy Start-of-Combat effects** never fire (`simulate` runs the SC loop over the player board only, per
  A.3 step 1). Owner to rule whether pool-captured enemy boards with SC minions should stay inert.
- **Player Leaderboard migration** — the `profiles` table (top players by rating) needs `schema.sql` re-run
  (idempotent; dormant until then, shows the empty state). Trust model: anon may upsert any row by name.
- **Board fight-tracking** — leaderboard records + Career board log are built but dormant until the
  `board_results` table lands via a `schema.sql` re-run.
- **Leaderboard W/L spread for old rows** — the Hall of Champions round-spread only populates for victory runs
  logged after the `runs.history` column shipped; older rows have no per-round order. Optional backfill via
  replay re-simulation.
- **Autosave size lever** (only if it ever needs trimming): store a pool `id` reference for always-resolvable
  committed/synthetic pinned opponents instead of the full snapshot; keep full snapshots only for remote/self
  boards that can vanish.
- **Heroes backlog** — 9 exist (named + art). More are a `HeroDef` + only-if-novel a new power `kind` (cheap
  kinds left: one-shot gold/mana, reroll discount, token summon). Unwired: TitanHP power-master matches no
  hero; Nadja has no power-master art.

---

## Public Release

The hardening gate before ASCENT faces a public (non-friend-scale) audience.

- **Authentication + accounts.** Today the remote seam is friend-scale trust (anon may upsert any row by
  name). A public build needs real accounts (Supabase Auth) so ratings, leaderboards, and uploaded boards are
  attributable and not spoofable. This is the load-bearing pre-public item — most hardening below assumes it.
- **Server-side replay validation.** A Worker re-derives boards (and rating) from the `{seed,heroId,actions}`
  replay before trusting the client → fabricated boards / inflated ratings aren't reproducible. DB-independent;
  opponent pinning (`servedBoards`) already makes a run's opponents reproducible regardless of pool drift.
- **CDN-front the read path** — serve the opponent pool from a static/edge blob, never hit the DB on boot.
- **Leaderboard hardening** — server-side rating re-derivation before trusting a submission; split games-played
  into wins/losses or add a min-games gate so one lucky run can't top the board.
- **Onboarding** — first-run tutorial (shop → hand → board → Shout → threat → combat).
- **Accessibility** — keyboard nav, screen-reader labels, reduced-motion, colorblind-safe threat/tribe cues.
- **Touch** support + the COMPACT-fan hand redo.
- **Distribution** — WebP art is done (4.3 MB); decide web (CDN / versioned deploy) vs a desktop **exe**
  (Tauri/Electron) beyond the itch zip. Seed the hero-choice roll (still uses `Math.random` in the UI) for
  daily seeds.
