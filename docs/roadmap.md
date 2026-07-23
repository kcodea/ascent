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

### Drag feel is not scale-invariant (owner report 2026-07-22 — decision needed)
The drag maths works on raw pixel deltas (`tiltPerPx * hLean * gx`) without dividing by `--scale`, so the same
hand movement produces the same tilt in degrees over a card that may be 50% larger. A fullscreen exe (`--scale`
1.0) therefore feels different from a windowed browser (0.67–0.92) — confirmed: F11 in the browser matches the
exe. The dialled values are *not* drifting; only the stage scale differs. Fix would be to divide the drag pixel
deltas by `--scale`, but that changes the feel at the size it was tuned at, so it needs an owner call.

### Balance patch 2026-07-21 (owner spec — landing in chunks on `balance/patch-2026-07-21`)
Large hand-authored balance pass, sliced so each chunk lands green + tested on its own:
- **✅ Chunk 1 — Demon minions** (shipped to branch): Soulfeeder, Sword & Bored, Burial Imp, Godfodder, Pit
  Supplier, Ritualist, Chef Raag. Data-only.
- **✅ Chunk 2a — Rune costs** (shipped to branch): 23 cost tweaks + Spare Parts → 5 Attachments. Data-only.
- **✅ Chunk 2b — Rune effect reworks** (shipped to branch): all 8 — Aftershocks, Consumption, Packcraft,
  Rebirth, Refrain, Slaying, Trophy, Broodpit.
- **✅ Chunk 3 — Quest objectives** (shipped to branch): 40 quests retuned (objective count/event/tribe + 3
  reward tweaks). Data-only.
- **✅ Add-on (owner 2026-07-21, shipped to branch):** Spell Appraiser Avenge (3), Nimbus/Displacement → T5,
  Hoardbreaker Drake → Rally-only, and **Runescale Drake** reworked to per-spell-this-turn scaling (new
  `scTribeBuffPerSpellImproving` factory).
- **✅ Chunk 4 — Quest removals + flag reworks** (shipped to branch): removed Last Rites / The Author's Hand /
  The Hoard Wakes; reworked Empty Graves, Deep Hunger, Pit Without End, The Old Hunt, Blueprint Cache; applied
  the deferred Parliament of Flame + Track and Fodder with new vehicles for the orphaned regressions.

**The 2026-07-21 balance patch is now COMPLETE** — every spec item is on `balance/patch-2026-07-21`, awaiting
review + merge. Follow-up worth tracking: the `authorsHand` objective event and `slaughterRepeat` reward kind
now have no content using them (kept deliberately for a future quest — remove them if none materialises).
- **✅ Chunk 5 — New-mechanic minions** (shipped to branch): Hoard Cleric (exclude self), Attachment Mechanic
  → T4 3/5, Kennelmaster Avenge (4), Thundeer text, Hunter (improve every 3 — new `every` param), and
  Korok/Banksly on a new **`cardsBought`** trigger + `buyTick` meter (the buy-count sibling of `goldSpent`).

### Nine-card balance pass 2026-07-21 (owner spec — `balance/nine-card-pass`)
Shipped to branch, awaiting review + merge. Kennelmaster (board-wide +2 Attack, Avenge 3), Hunter (improve
every 5), Growth (T2, +1/+1), Spirit Fire (+2/+3), Patch Job (+1/+1 base + +2/+2 per 6 Gold), Badgington and
Solaris Fang (Rally halves cut), Money Maker (Gold Pouch only), and the **Graverobber self-target fix** (new
`targetNotSelf` CardDef flag). Detail in the devlog.
- **Follow-up:** `rallyGrantRandomSpell` + `rallyTribeAura` are now unused by any card. Kept as primitives for
  set 2 — remove in their own PR if nothing picks them up.

### Execute (`V`) — finish the retheme
The rename (#625), the CSS rage aura (#627) and the Pixi strike have all shipped. Remaining:
- **Owner-dial the strike.** The Execution Strike's shipped values are a considered first pass, not owner-tuned
  — dial them via the 🩸 Execute Strike tuner's Test button and bake the JSON.
- **Render-profile the aura (much less urgent).** The owner's 2026-07-22 tuning cut it from ~101 nodes / ~98
  animations per card to **42 / 40** (smoke off, shards 26 → 12), with 3 `mix-blend-mode: screen` arcs instead
  of 6. All static paint. Still worth a DevTools pass on a full board at some point, but no longer a concern.
- **"Toxin Tender"** (content, Kevin's side) now has a name that doesn't match the keyword it grants.

### Taste the Cleave beat (`feat/cleave-slash`)
Hit-stop → claw rake across the target → blood drips → attacker returns. The rake and drips were reviewed via
the static frame ladder (`apps/web/public/fx/cleave-slash-preview.html`); the two TIMING dials — `HIT-STOP ms`
and `RETURN delay ms` — live in the lunge timeline and can only be judged in a live fight. Dial in
🪓 Cleave Slash FX, then "Copy values" back into `DEFAULTS` in `cleaveFxConfig.ts`.
- **NB:** the preview rig is a hand-kept mirror of `drawSlash`. Change one, change the other.

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
- **Win-rate weighted matchmaking v1 SHIPPED 2026-07-18** (ledger-weighted bands + loss-streak softener +
  pinning + between-runs refresh; all dials + master switch in `matchmaking.ts` — expect iteration).
  Watch for: Renown/Oath calibration drift as average opponent strength shifts; self-play bias while the
  ledger is small; consider a back-to-back guard (never two 75%+ boards consecutively). The old
  rating-aware path (wave + rating band + record-similarity) remains the LATER evolution.
  Invariant kept: *any legal board may be served at combat time* (boss floor 0.09, no quarantine).
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

- **Guard the Layout Lab double-source.** Layout values live both as `def:` in `layoutConfig.ts` and as a
  `var(--z-…, <fallback>)` in `styles.css`; a bake that updates only the def ships the OLD number to
  production while looking right in dev. Three had silently drifted (`shopUiY`, `shopY`, `wbY`) before an
  audit caught them on 2026-07-21. A test that parses both and asserts they match would make it impossible.

## Next

- **Re-tune the hand row for the plated card.** The backplate makes hand cards taller than they were, so
  `handY` / `handGap` (📐 Scale & Layout) and probably `handPop` (🎴 Drag Feel) want dialing by eye. Shipped
  with reasonable starting values. When baking the export, update **both** the TS defaults and the CSS
  fallbacks — the double-source rule.

- **Quest-node row can leave the viewport.** The `--qb-*` stage pin uses a large negative Y (−256 ×
  scale); on a tall/zoomed layout the nodes sit above the top edge. 2026-07-21r clamped the TENDRIL so it
  still reads, but the nodes themselves being off-screen is the real bug.

- **Finish the quest/rune objective-wiring audit.** 2026-07-21p fixed the recruit-phase TRIGGER
  tallies (Shout/Echo/EoT) and the `replayBattlecry` callers. Still to sweep: the other ~17 objective events
  (`buy`, `spendGold`, `summonCombat`, `playAttachment`, `consumeFodder`, …) against every quest/rune reward
  that can fire them INDIRECTLY — the failure mode is always "the effect fired, the tally didn't see it".


- **Set 2 content.** Foundation is in (`docs/card-sets.md`): author cards in `packages/content/src/cards/set2/`,
  list them in `SETS.set2.own`, trim the inherited set-1 pool with `excludes`. Before flipping it live, run
  `SET=set2 npm run pool` — an unbaked set has no captured opponents and falls back to procedural boards.
  Shipped so far: the 22-Kobold tribe + Ruby engine, and Set 1's neutral spell toolkit carried over (minus the
  four tribe-locked ones). Still needed before flipping live: more tribes/minions to cover the enemy curve,
  set-scoped quests/runes, and a baked opponent pool.
- **New spell batch (owner spec 2026-07-23, 28 spells) — building in tranches.** ✅ Tranche A shipped (8:
  Crest of the Climb, Turnabout, Insurance Policy, Rift-Sunk Codex, Beyond the Summit, Invitation Above +
  Set-2 Ruby Shipment & Facetwright's Choice). **Tranche B in progress** (~14 medium), building as sub-slices:
  ✅ **B1** (Field Maneuvers, Last Stand, Executioner's Edge) + ✅ **B2** (Quick Sale, Sigil of Kinship,
  Elevation Ritual) + ✅ **B3** (Layaway, Second Draft) + ✅ **B4** (Strange Revision, Marked Target) shipped.
  ✅ **Encore** (Shout/Echo re-trigger — Rally is combat-only, flagged) + ✅ **Open the Gates** (Set 2 combat
  Imps) shipped. **Left in B:** the live-scaling pair **Veinstorm** + **Hoardflame** (one `spellDisplayText`
  pass for Ruby-stat / dragons-played live text). **Tranche C** (~5
  hard/new-UI: Common Ground two-target, Hourglass Reserve + Funeral on Loan discover-locks, Farseer's Report +
  Rival's Reflection opponent-peek). **Blocked:** Deepdelve Writ + Ironclad Requisition (need a Dwarf tribe).
- **Set-scope quests / runes / heroes** if a set needs its own. `SetDef` has room; the wiring doesn't exist.
- **Profile the PHASE TRANSITIONS, not the FX.** The first perf capture (2026-07-19) puts every bad frame at
  a phase boundary: the worst of the run was 175ms with a 181ms single task, **no FX marks**, sprite pool
  539→0 and heap 109→97.6MB — an allocation + GC signature pointing at the shop roll / board re-render on
  entering recruit. The renderer looks healthy (median 195fps, 4 janks in 115s); `fx:weld` fired 49 times
  and never landed in a bad bucket.
- **Confirm the batched-weld perf fixes with the new HUD**, against a prod build: play to a Banksly/Beatbot
  turn with `?perf=1`, then read `worst`/`jank` and the `fx:weld` suspect line. The 2026-07-19 weld fixes
  were never measured end to end (rAF is suspended in the headless preview).

- **Weld FX: pool the ring `Graphics` + give them their own sub-container.** They're allocated and destroyed
  per weld (unpooled, unlike the particle sprites), and they sit mid-layer between sprite batches, which
  breaks batching. Real but smaller than the fixes already landed (2026-07-19 audit); pooling Graphics would
  be a new pattern for `pixiFx.ts`.
### Combat replay pacing (2026-07-18 audit — the "skipped beats" report)
**PINNED by owner 2026-07-18.** Full findings + handoff:
[`docs/superpowers/specs/2026-07-18-combat-pacing-handoff.md`](superpowers/specs/2026-07-18-combat-pacing-handoff.md)
— read that before picking this up (the first attempt, PR #542, was scrapped on feel; the doc explains the
confound and why the ROLLOUT, not the approach, was the mistake — ship dark behind zeroed dials + tune live).
SoC badge beats shipped (#541). Remaining, in impact order:
- **Contact-anchored advance** — an attack's next beat fires at the GSAP `contact` position; everything
  after contact (crit flourish, flurry wind-slash, rebound/settle) is fire-and-forget and never extends
  the schedule → beats resolve "underneath" long FX then visually catch up. Fix: gate `ctx.advance()` on
  (or add a lead for) the flourish duration, like `deathConsequenceLead` already does for DR-summons.
- **Buff-tendril stat snap** — while a tendril flies the target's badges hold pre-buff values; a beat
  teardown drops the holds → stats snap. Extend the beat by the tendril's `strikeMs` or carry holds over.
- **Badge-never-fired inventory** — ~14 combat flags still have `badgeIdForCombatFlag` mappings but no
  `fireTrigger` call (runeFury, runeForthcoming, runePackcraft, runeSalvage, runeRebirth, runeAftershocks,
  runeTrophy, runeInheritance, runeUndertow, runeSlaying, bloodTrail/deepHunger marks, lawOfTeeth, oldHunt,
  feedingLine, crateringMissive) — mid-combat/reactive flags; decide per flag whether a pulse is wanted.
- **Step-collapse classes** — one Deathrattle's summons+buffs share one step (echo doublers re-fire in the
  SAME step); Avenge payoffs share the death step (only the `avenge` tag separates them); a spellCast
  broadcast (Taragosa Growth + Guel + Weaver reactions) rides the swing's step; Echo Warden copies share
  the original summon's step. Add `nextStep()` seams if these should read as separate beats.
- **Clock config gaps** — `hpGrant` hold is 0ms; `holdMs` keys on raw event type so the `KIND_TO_KEY`
  mapping (e.g. ascend→improve 520ms) is dead code; `questTrigger` holds a content-less 450ms beat while
  the badge pulses in parallel (fixed 1150ms, speed-independent).
- **Step-0 fold** — run-wide auras (Undead/Imp/Beast/Magnetic/card enchants) bake silently into the
  initial board; Fleeting Vigor is baked pre-sim with one un-stepped `sc` narration. Fine if intended —
  listed for completeness.

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
Basic + Epic Runeforges ship with 30 basic + 31 Epic runes wired (batches 7a + 7b landed 2026-07-17/18).
Remaining:
- **Spirit Worgen formula divergence** (spotted during Mastery threading): its combat half grants
  `base + spellsThisTurn` while the recruit half grants `base × (1 + spells)` — reconcile with the owner
  which is intended, then align the other half + its combat text.
- **Art:** Epic runes + the batch 7 runes fall back to the sigil glyph — author art.

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
- ~~The turn-charge glyph repaints a large area every frame.~~ **MEASURED 2026-07-19 — NOT a problem. Do not
  "optimize" it.** The suspicion (per-frame `--charge` → `mask-image` recompute = a paint, plus the two
  40px/80px `drop-shadow`s the CSS comment already fingered as "the heaviest bit") was tested with an isolated
  A/B/C harness reproducing the real construction: the actual `turn-glyph.svg`, real 1144×449 geometry,
  SVG∩gradient `mask-composite: intersect`, and the real drop-shadows. Four variants, interleaved, twice each,
  on a 360Hz display:

  | variant | median frame | frames >4.16ms |
  |---|---|---|
  | idle (control, nothing animating) | 2.8ms | 0 |
  | **shipped** (SVG∩gradient + both drop-shadows) | **2.8ms** | 0 |
  | noGlow (same, drop-shadows removed) | 2.8ms | 0 |
  | transform (static mask, transform-only — the proposed "fix") | 2.8ms | 4 |

  Every variant pins to the refresh interval (2.8ms ≈ 1000/360). The glyph sustains ~360fps with **zero**
  frames over the 240Hz budget, and removing the drop-shadows changes nothing — so the CSS comment's
  hypothesis is also disproven. The proposed transform rewrite was, if anything, the *worst* variant on
  outliers. **Caveat:** the harness is refresh-capped, so it proves "none of these threaten the budget," not
  "they cost the same" — it cannot resolve sub-2.8ms differences. It also isolates the glyph from the card
  tree. But the isolated cost is so far under budget that it is not a plausible dominant term.
  Harness: `fx/` — rebuild from the devlog entry if needed.
- `ChargeMotes` runs a second continuous per-frame canvas loop for the whole charge session. Untested; but
  given the glyph result, measure before assuming it costs anything.
- ~~Drag re-renders all of `Recruit` once per rAF via `setDrag`/`setOverZone`.~~ Shipped (2026-07-23, audit
  fix #2): the re-render is now gated on DECISION change (the drop-gap / magnetize / cast / zone signals) via
  the pure `deriveDragDecision`, not on the old 8px position quantum — so a drag re-renders only when something
  visible actually changes (~10–20× fewer than the quantum). `Card` still uses default shallow memo, but fix
  #1's value-stable views keep its props referentially stable across dispatches, so it bails; add a value
  comparator only if a profile ever shows cards reconciling mid-drag.
- ~~Autosave is O(n²) (serializes the whole action log every dispatch) — debounce.~~ Shipped: it now writes
  at turn boundaries only, with a `flushSave` on quit-to-title + tab hide/close. NOT debounced — a timer
  would only have guessed at the commitment point the phase flip already marks exactly.
- Combat replay: 55–86ms synchronous-React-render freezes on some summon/death beats (FX/Pixi/GPU/layout/GC
  all ruled ~0 — it's per-beat render/reconciliation). Profile the flame chart, memoize `computeFrame` + the
  growing per-beat event-log scans. Cheap adjacent win: `syncShields` calls `getBoundingClientRect` per aura
  bubble every frame (~100k calls/combat) — cache the rects, re-measure only on layout change.

### Combat timing clashes (per `combat-timing-audit.md`)
> Full current numbers — every event's hold, every keyword's cost, 36 interactions end to end — are in
> [`combat-timing-reference.md`](combat-timing-reference.md). Read it before tuning any of these.

Remaining: (1) standalone buff waves from a **living** source — the tendril path (`travelMs` 350–780 **plus** a
360ms badge flash) still rides a 210ms hold, so the +N can land ~500–930ms outside its beat; fold the strike
time into the hold. (The *Deathrattle* buff case — which takes the sourceless **descend** path, 340ms + 360ms
flash — was fixed 2026-07-19 by `DR_BUFF_LEAD` 500 ⇒ a 710ms beat.)
(2) CSS combat animations are fixed seconds and ignore `combatSpeed` while holds ÷ and Pixi/GSAP × it. The
`--combat-speed` var now exists and covers the DEATH animations + the floats (2026-07-19) — i.e. every case
that could actually be CUT, since a dying unit unmounts when its beat advances (it was blinking above ~1.31×).
Remaining unscaled CSS (summon/reborn pops, badge/trigger pulses) only OVERLAPS the next beat rather than
being cut, because those units persist — scale them off the same var if the overlap ever reads badly.
(3) overlap tails (`risepop 700`, re-form glow @+460) bleed past their 240ms ride. (4) poison mist
clipped 50ms. (5) the death→consequence 240ms `overlapMs` ride unmounts the dying card partway into its
collapse when a Deathrattle summon/reborn follows (measured live during the blink root-cause hunt — reads
OK in play; tune overlap vs collapse if it ever reads abrupt). (6) config gaps: `hpGrant` holds **0ms**, and
seven event types (`keyword`, `keywordLost`, `ascend`, `reveal`, `spellProgress`, `questTrigger`,
`questComplete`) have no configured hold and silently take the 300→450ms fallback; `ascend`'s `KIND_TO_KEY →
improve` mapping is dead code because `holdMs` keys on the raw event type. (7) crit text runs 1520ms and
outlives its beat by ~650ms.
Also: a dying unit should begin leaving the board in tandem with the other units' Echo/Reborn
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
  beyond the itch zip. An **Electron shell now exists** (`apps/desktop`, `npm run package:desktop`) and the
  build runs unmodified in it — but it is a TEST HARNESS, not a release: no installer, no code signing, no
  icon, no auto-update, and no CSP. Electron was chosen over Tauri for a pinned Chromium (Tauri's WebView2
  version varies per machine, which is poor for a frame-time-sensitive game). Note electron-builder cannot
  run here — Defender quarantines its `app-builder.exe`; `scripts/package-desktop.mjs` packages by hand. Seed the hero-choice roll (still uses `Math.random` in the UI) for
  daily seeds.
