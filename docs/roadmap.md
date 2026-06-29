# ASCENT — roadmap / queue

Forward-looking work, broken down by milestone. When something ships, move it out of here (its detail
goes in [devlog.md](devlog.md)); when new work appears, add it under the right section. Keep honest
and current. High-level milestone summaries live in [../CLAUDE.md](../CLAUDE.md).

## Recently shipped (2026-06-29)
- The Godfodder (T2 Demon — targeted consume Battlecry), Hex Flayer (T4 Demon — tribe-wide buff Battlecry), Wolves Den (T3 Undead/Beast — 3 Crypt Wolf Deathrattle)
- Eternal Knight real-time aura fix (surviving copies now get the +3/+2 immediately in combat)

## Patch roadmap — the next 5 (strategic sequence)

Sequenced by dependency + player value: **foundation → variety → retention → learnability → reach.**
Each patch is a release a player would notice. The detailed task queue per milestone is below; this is
the order we ship it in. (Heroes/cards are data, so small ones can land continuously between patches.)

### Active sequence (set 2026-06-20) — difficulty learns from real player boards

North star: the game's enemy strength comes from **captured player boards**, feeding both PvE difficulty
and **async PvP**. This sharpens Patch 1/2 and **demotes manual counter-matrix tuning** — captured boards
drive difficulty; the `curve`/`player` tools become its validation harness, not a hand-tuning treadmill.
The next 5 concrete steps:

1. ✅ **Lock in the compact arched-card UI + balance tools** (`npm run curve` / `npm run player`). Done
   2026-06-20.
2. ✅ **Board snapshot + capture** (done 2026-06-20). `@game/sim/snapshot.ts`: `BoardSnapshot` +
   `snapshotBoard`, `Replay` = `(seed, heroId, action-log)` + `replayRun` (deterministic → per-wave
   snapshots). Store records the action log + `exportReplay()`; `npm run replay` proves the loop
   (byte-identical, ~1 KB/run). A snapshot is a `BoardMinion[]` that drops straight into `simulate`.
   **Enriched 2026-06-21:** the snapshot now also carries `resolve` (HP), `tier`, and `triples` (run-wide
   goldens, via a new `RunState.triplesMade` counter), plus `dominantTribe(snap)` for the top board tribe
   — the opponent-frame intel set.
3. ✅ **Board library + strength index** — `pickOpponent(wave, power)` + a deterministic **bootstrap pool**
   (seeded bot runs) injected at startup, and (done 2026-06-22) **your own finished-run boards persist** to
   localStorage (`boardLibrary.ts`) and load into the pool at startup. **Hardened 2026-06-23:**
   `registerOpponents` now drops boards referencing a removed/renamed card (`isServableBoard`) and `faceOmen`
   falls back to the procedural threat on any serve-time failure — a stale capture can no longer hard-lock
   End Turn (it did: a pre-removal Lifebinder board crashed combat). **Committed pool + attribution (done
   2026-06-23):** `npm run pool` bakes a curated `OPPONENT_POOL_DATA` (house bot boards + `docs/board-exports/`
   imports) shipped in the repo + loaded at startup; `BoardSnapshot` carries `origin/author/capturedAt`; the
   opponent frame shows "by {name}" / "House board". ✅ **Simulate-derived WAVE-RELATIVE strength rating +
   power bands (done 2026-06-25 → devlog + [board-pool.md](board-pool.md)):** `rateBoardForWave` rates a board
   by win-rate vs its OWN wave's calibrated ladder (no saturation); boards carry a `patch` stamp;
   `npm run pool`/`pool:prune` bake/rate/prune. Used for **curation/QA only** so far. ✅ **All-wave synthetic
   pool (done 2026-06-26 → devlog + [board-pool.md](board-pool.md)):** retired the house bot — `npm run pool`
   now **synthesizes** 8 boards/wave from the card set across waves 1–20, banded to the tuned enemy curve
   (`synthesizeWaveFromCurve`), and the rating ladder calibrates 1–20 off the **procedural enemy curve** (no
   bot). This solves both the old "queued next" items: the band ceiling (no more `w12:b7–b7` saturation) and
   sparse high waves (every wave ships a full weak→strong spread). **Queued next:** (a) **wire bands into live
   matchmaking** (`pickOpponent` still matches by `Σ(atk+hp)` power only — now that ratings are trustworthy at
   every wave, match by `(wave, band)`); (b) a **harder late-game dial** if the enemy-curve anchor proves too
   soft vs strong player boards (raise the synth power jitter, or prefer imported strong real boards);
   (c) **in-game friend export/import UX**; (d) a shared **friend backend** keyed by `(wave, power-band,
   tribe)` — the async-PvP track (step 5).
4. ✅ **Serve real boards as enemies** (done 2026-06-21). `faceOmen` draws a strength-matched real snapshot via
   `nextOpponent`/`pickOpponent` (procedural omen = thin-pool fallback), and the top-right **opponent-intel
   frame** telegraphs the next foe (portrait/HP + tier/triples/top-tribe). ✅ **Damage-dealt system (done
   2026-06-21):** a loss costs the opponent's tavern tier + Σ(surviving minion tiers), capped 5 / 10 / 15 by round,
   dealt at the *end of combat* (Resolve drops in the combat view, before the shop). ✅ **Persist your own
   finished-run boards into the pool** (done 2026-06-22 — see step 3).
5. **Async PvP mode + shared pool** — the `scene`/`MODES` registry → every wave a friend's snapshot;
   win = 10–15 wins without dying; tiny shared backend (friend-group scale, no live opponent / anti-cheat).


- **Patch 1 — Balance & Content Depth** *(finishes M2; foundation).* Make the climb fair before
  building on it. Tune the **counter matrix** (balance truth — the runner flags Mech dominant, Beast
  weak, Dragon/Undead flat; stat numbers are starting dials), build the **enemy-strength curve tool**,
  and deepen content toward the pool target: **13–15 minions per tribe** across the 6 tiers, weighted
  to T3–5 (run `npm run audit`). Most tribes are still short of the target — but **Dragon reached 12 and Beast
  13** with the 2026-06-24 batch (Dragons: Frontdrake/Supporter/Bronze Warden/Stuntdrake + the reactive
  to T3–5 (run `npm run audit`). Most tribes are still short of the target — but **Dragon reached 13 and Beast
  10** with the 2026-06-24 batch (Dragons: Frontdrake/Supporter/Bronze Warden/Stuntdrake + the reactive
  Hunter/Crypt Drake; Beasts: Manasaber/Raptor/Sea Urchin; Neutral T6 remains); fill the mid tiers, fill the
  unused primitives (`castSpell`, `endOfTurnBuff`,
  `spellCostMod`), and add **higher-tier spells** (Spirit Fire is now T2; **Growth** T4, **Channeling the
Devourer** T5, plus the 2026-06-24 batch — Tribe Portal/Corpse Board/Perfect Vision + Fleeting Vigor/Apples —
landed alongside the original T1s — **25 spells** now; keep filling toward the ~40-spell pool). The pool stays
deliberately
  small — variety comes from the **meta layer** (heroes + quests/trinkets), not card volume. *Why
  first:* every later patch sits on combat feeling right.
  - **Balance pass v1 (2026-06-22, shipped → devlog):** Yazzus → targeted-only; removed Corrupted
    Lifebinder + its mirror system; curve → 15-round win. **Queued next (deeper design):** (a) make **T1–4
    cards stay relevant** past the mid-game (scaling payoffs / recombination / triples), and (b) **decision
    diversity** — shake up *how/why* you reach destination builds (partly the thin pool, partly cross-tribe
    value engines washing out tribe identity). See `docs/balance-handoff.md` §9 for the full direction.
  - **Content batch (2026-06-23, shipped → devlog):** +6 minions (Better Bot, Sheldon, Speedy, Harry Botter,
    Burial Imp, Soulsman — Mech pool now 11, near the 13–15 target); Gnasher rework (re-attack + run-wide
    spell power); Maw → T3; Combinator now magnetizes a *random* Magnetic Mech. Mana→Gold rename (text +
    names + gold coin icon). Hero-power button on the hero frame (placeholder art). Two new carry-back
    channels (`playerFodderGrants`, `playerMaxGoldGain`).
  - **Content batch (2026-06-24, shipped → devlog):** +1 hero (Symbiote — passive token every 4 turns,
    universalTribe Magnetic attachment), +4 Demons (Acid, Trickster, Demonic Anomaly, Abhorrent Horror),
    +5 Undead (Deathswarmer, Pillager, Thundering Abomination, Sergeant, Forsaken Weaver). New engine
    primitives: `universalTribe`, `undeadBuyAtk`, `onRoll`/`applyOnRoll`, `fodderConsumedThisTurn`.
    Demon pool now 11, Undead pool now 10.
  - **Bug fixes + content batch + live text (2026-06-24, shipped → devlog):** Shop weights flattened
    (equal chance for all tiers); Spell Discover now tier-gated; `onKill` bus fires for all kills
    (not just re-attacker Gnasher). +3 Undead cards: **Karthus** (T5 8/8 DS; on-kill +3 Atk to all
    Undead permanently — new `onKillBuffUndeadAttack` + `grantUndeadBuyAtk` carry-back), **Deathless
    Hand** (T3 2/1; DR: summon a Footman), **Footman** (T1 1/1 Reborn token). Renames: Skullblade →
    **Ghastly Bladesmith**, Grave Knit → **Eternal Knight**. Tara ascend procs now show in combat
    narration log. Combat live text for Tara (`ascendProgress`), Sergeant (`hpGrantBonus` via `hpGrant`
    event), and Thundering Abomination (`permaGain` from EG buff tracking). 18 art files wired.
  - **Follow-up (2026-06-23, shipped → devlog):** Sheldon/Speedy/Harry Botter made **Magnetic** (+ `spellAura`
    weld plumbing so the aura survives a weld); **triples now keep welded fields** (`rallyMechAtk`/aura, not
    just `manaBonus`); **Archmagus Guel scales** +1/+1 per 4 spells cast (a "T1–4 stay relevant" win);
    **HUD win counter**; hero power **fires from its button only**; Spirit Worgen + Guel2 art.
  - **Polish (2026-06-23, shipped → devlog):** **live card text** convention for scaling minions (Guel now
    shows current grant + countdown via `cardText.ts`); **shop buff floats** (+X/+X above a buffed minion,
    like combat); Combinator welds credited to the **magnetic** ("Harry Botter ×2"), not Combinator;
    disabled hero-power button keeps the game cursor.
  - **Tuning follow-up (2026-06-28, shipped → devlog):** Twilight Whelp → Violet Whelp; Spirit Pup/Mama Bear/Tara
    stats + Spirit Worgen +3/+3; Commander Impala 6/6 + Windfury; new **Mechanical Jouster** (Rally → random
    Magnetic Mech); art rewires (Supporter, Guardian Drake, Violet Whelp, Taragosa, Spirit Worgen, Jouster).
  - **Balance + content batch (2026-06-28, shipped → devlog):** broad stat tuning across every tribe; 6 renames;
    cut Demonic Anomaly / Echo Warden / Cupcakes; reworks — Acid & new Banksly (spend-Gold trigger), new Commander
    Impala (on-kill Fodder/Imp buff), Target Dummy (gains Attack when hit), Taurus (engraves both neighbors; golden
    2× combat gains), Thundering Abomination, Lantern Light (spell-power scaling), Consume (creates & eats a Fodder).
    Compendium shows evolution units + cursor fixes. **Still queued:** the deeper counter-matrix tuning + T1–4
    relevance / decision-diversity direction below.
  - **Fixes + audit (2026-06-23, shipped → devlog):** rally fires **per hit** (Windfury → 2×); Cling Drone
    shows its accumulated bonus; Fodder-consume floats +X/+X. Plus a 6-agent audit cleanup: dead files/assets
    removed (−87 KB web build), dead events/data trimmed, combat hot-path allocations cut (~600k/faceOmen),
    `bestCopyRepeats`/`isTribe` dedup. **Deferred (documented in devlog):** removing 20 inert dead effect-factory
    ids (~190 lines), the `quiet`/odds-only `simulate()` flag (biggest alloc win), and several shared helpers.
- **Patch 2 — Front Door & Hero Roster** *(M3; variety).* The run's entry + variety. Generalize the
  `heroChoices` flag into a `scene` enum and build **Title → Play → Mode → Hero → run** (no router;
  small overlays reusing `herocard`). Add a data-driven **MODES** registry — the two intended modes
  are **PvE** (the bounded climb; the 20-wave win condition + meta progression hang off it) and
  **async PvP** (fight *snapshots* of other players' boards — no live opponent). Expand the **hero
  roster** (now **9** — the ~6–8 goal is met) so the 3-of-N picker is meaningful, and **seed the hero-choice roll** (for dailies).
  *Why now:* heroes are an active thread and the game needs a proper front door. *Shipped already:* the
  PvE win condition (`CONFIG.maxWave` = 20 → Victory) + Start Over.
- **Patch 3 — Meta Progression** *(M3; retention — **PvE side**).* The "why keep playing" loop, which
  attaches to **PvE**: **unlocks** (cards/heroes gated by a persisted profile), **ascension modifiers**
  (escalating difficulty as a run-config knob), **daily seeds** (shareable deterministic runs — the
  engine already threads one seed; seed from date), and **save/resume + combat replay**
  (`serialize`/`deserialize` exist; add the resume UI + a share-a-seed/replay surface). **Async PvP**
  is a separate track: its "progression" is a ladder/rating over submitted board snapshots, not the
  unlock economy — design it alongside but don't conflate it with PvE meta.
- **Patch 4 — Onboarding & Game Feel** *(M4; learnability).* Now that it's fair, varied, and sticky,
  make it teachable + juicy. A **first-run tutorial** (guided first wave: shop → hand → board →
  Battlecry → threat → combat), an **audio pass** (music + fuller SFX coverage; hooks exist), and
  **VFX polish** (lighter threat telegraph reintroduced, pool-copies-remaining cue, continued juice).
- **Patch 5 — Reach & Release** *(M4 + distribution).* Broaden who/where can play. **Full touch
  support** (tune drag/tap targets + the hand fan for small screens), **accessibility** (keyboard nav,
  screen-reader labels, reduced-motion, colorblind-safe threat/tribe cues), and the **distribution
  path** — WebP art compression (~26 → ~6 MB) for web, or a desktop **exe** (Tauri/Electron) — plus a
  hosted/versioned deploy beyond the itch zip.

**Tech-debt watch (fold into whichever patch touches it):** split `Recruit.tsx` (~1.4k lines) into
Shop/Hand/Board subcomponents if it grows past ~1.5k; split `run.test.ts` (~1.3k) into per-area suites
as tests pass ~200; consider sub-reducers in `reducer.ts` if many new actions land. No urgent debt.

## Next up — tabled 2026-06-19 (do these next session)

- [x] **Spirit Worgen procs in combat too** (done 2026-06-20). A combat-side `summonBuffSelfTribe`
      factory in `@game/core` now fires when a friendly Beast/Dragon is summoned mid-fight, +X/+X where
      X = 1 + spellsThisTurn (threaded into `simulate` + `CombatContext`). Gains are temporary —
      combat's a sim, so the run board is untouched and the Worgen is back to its recruit stats next
      shop (until the T6 below carries them back). **Interpreted "reset back to 1/1" as "back to its
      recruit-phase stats"** (combat gains drop) — confirm if you meant a literal 1/1 combat base.
- [ ] **New T6 — "adjacent units keep combat buffs permanently."** A Tier-6 minion whose **board
      neighbours** (left/right) keep the stat buffs they accrued **in combat** — i.e. combat gains carry
      onto the recruit board after the fight (normally combat is a sim and gains are dropped). Precedent
      for combat→recruit carry-back: `result.playerSummonBonus` (Kennelmaster's Avenge). Build a similar
      carry-back in `advanceAfterCombat` for the T6's neighbours (capture each neighbour's combat-final
      stat delta, apply to its run board card). Pairs with the Worgen combat proc above (a Worgen next to
      it keeps its combat gains). Needs a **name + tribe + art** (placeholder ok).
- [x] **End-of-run screen: single-row layout + bigger** (done 2026-06-20). Pips + warband forced to one
      row (`flex-wrap: nowrap`), everything scaled **~2.5×** (warband `zoom` 0.42 → 0.92; title/pips/sub/
      button up). ("We'll expand this later," so kept flexible.)

## M2 — content + balance (in progress)

- **Combat spell-casts → Archmagus Guel (shipped 2026-06-24 → devlog):** combat now has a real `ctx.castSpell`
  path. Taragosa's Growth is a real spell cast that fires Guel mid-fight (temporary buff) and **permanently**
  counts toward his improvement (carried back to the run's `spellsCast`). `simulate` takes the run `spellsCast`
  (Guel's grant scales) + returns `playerSpellsCast`. Opens the door to more in-combat spell-casters.
- **Nanon (T6 Mech, shipped 2026-06-24 → devlog):** Deathrattle floods 6 Nanobots; each one a full board can't
  fit pumps your Mechs +2/+2 (golden +4/+4). New `deathrattleSummonOverflowBuff` factory; Nanobot 1/1 token.
  **Mech pool → 12** (toward the 13–15 target).
- [ ] **Big content batch — ~16 new minions + 6 spells (Beast/Dragon push)** (specced 2026-06-24, landing
      in phased PRs). Beasts: Manasaber (+Saber Cub token), Gryphon, Raptor, Sporebat, Sea Urchin, Mama Bear.
      Dragons: Twilight Whelp (+Whelp token), Frontdrake, Tara→Taragosa (combat transform), Supporter, Bronze
      Warden, Twilight Broodmother, Hunter, Stuntdrake, Crypt Drake (Undead/Dragon dual). Spells: Apples,
      Fleeting Vigor, Tribe Portal, Corpse Board, Cupcakes, Perfect Vision. **Needs ~15 new effect
      primitives**, several touching the combat side (the shared `types.ts` boundary): new combat triggers
- [~] **Big content batch — ~16 new minions + 6 spells (Beast/Dragon push)** (specced 2026-06-24, landed in
      phased PRs). Beasts: Manasaber (+Saber Cub token), Gryphon, Raptor, Sporebat, Sea Urchin, Mama Bear.
      Dragons: Twilight Whelp (+Whelp token), Frontdrake, Tara→Taragosa, Supporter, Bronze Warden, Twilight
      Broodmother, Hunter, Stuntdrake, Crypt Drake (Undead/Dragon dual). Spells: Apples, Fleeting Vigor, Tribe
      Portal, Corpse Board, Cupcakes, Perfect Vision. Shipped ~15 new effect primitives incl. new combat triggers
      (on-damaged → Gryphon, friendly-attack → Raptor, ally-attack → Crypt Drake, on-gain-attack → Hunter),
      immediate-attack-on-summon (Twilight Whelp), the recruit-ascend Tara→Taragosa (combat tally → settle
      transform), and Taragosa's on-attack Growth cast. **Almost all merged to `main`; only Cupcakes (#15) and
      Tara→Taragosa (#16) PRs remain open.**
  - **Fixes pass + hero-power art (shipped 2026-06-24 → devlog):** wired **8 hero-power button arts** + rewired
    Cling/Stuntdrake/Sea Urchin; Hoarder → T2 2/2; Sea Urchin can't Discover itself; Gryphon refresh is per-hit
    (cap 4); Frontdrake handles Djinn (no cadence skip, works on the proc turn) + live "End of this turn." text +
    triple keeps its timing; Mama Bear triple no longer resets/doubles its accrual; live-text pass.
  - **Remaining threads:** **TitanHP** hero-power master matches no hero + **Nadja** has no power master (both
    unwired — need a hero/asset decision); **Taragosa** should keep its "all stats are Engraved" line (goes on
    the #16 branch); open design Qs: Taragosa Growth-cast scaling, Tribes-Choice-on-neutral UX.
  - **Dragon bug-fix pass (shipped 2026-06-24 → devlog):** Crypt Drake live text in combat (current +N/N +
    countdown via self-buff detection); Twilight Whelp sequential spawning (each whelp attacks before the
    next can spawn — uses new `ctx.flushImmediateAttacks()`); Broodmother's whelps show Taunt emblem from
    frame 1 (keyword now applied before the summon snapshot via `ctx.summon(..., grantKeywords)`); golden
    Stuntdrake procs twice (updated `avengeGiveAttack` + `goldenText`).
- [ ] **Enemy-strength curve tool** (the way we'll actually balance — not the old mono-tribe matrix
      runner, which is deprioritized per the user). Build a way to tune how fast enemy boards scale
      per wave so the climb's difficulty ramp feels right. Design TBD.
- [ ] **More spells + spell-synergy cards — target ~40 spells** (set 2026-06-20; spells are a core
      pillar, **19 exist now** — 11 added 2026-06-21, +3 (Mend / Undead Army / Lasso) 2026-06-22). Spread across tiers; deepen the archetype (Spirit Pup→Worgen, the
      Rohan/Spellbinder hero). Three T1 spells rotate in the slot today: Spirit Fire (+3/+3 to a friend),
      Ember Pouch (gain 1 Ember — *net-neutral as specced; revisit*), Bulwark (+0/+1 + Taunt to a friend).
      Hook usage:
  - `spellCast` event + `state.spellsCast` counter → used by Archmagus Guel (buff 2 others), and now
    **Spirit Pup → Spirit Worgen** (transform after 10 spells; the Worgen gains +X/+X per Beast/Dragon
    summoned, where X = 1 + spells cast this turn — `RunState.spellsThisTurn`). New reusable primitives:
    `spellCastTransform` (threshold transform, keep stats, optional retroactive buff), `summonBuffSelfTribe`
    (self-buff on tribe summon, scaling with spells-this-turn) — and the first **transform** mechanic
    (swap `cardId`, keep the instance's stats) + `BoardCard.spellProgress` + the live-text helpers
    (`transformProgressText`, `summonScalingText`).
  - `castSpell` factory → minions that cast a spell from an event (auto-targets the carry) — still unused.
  - `state.spellCostMod` → "your spells cost less" effects (subtracted at buy) — still unused.
  - **Spell-stat amplifiers are fully wired:** `spellStatBonus(state)` is the one source of truth for
    the +X/+X to stat spells (the Spellbinder hero feeds it today), the reducer applies it, and the UI
    shows it (`spellDisplayText`, green). A new "spells give +X/+X more" *card* just adds its term to
    `spellStatBonus` — math + card display both update for free.
  - Higher-tier spells would round out the pool.
- [x] **Targeted Battlecries (minions).** Done — the place-then-target gesture is built: a minion with
      `CardDef.target: 'friendly'` plays to the board, parks a `RunState.pendingTarget`, and the player
      aims the hero-power-style line at a friendly minion (a new `battlecryTarget` action resolves it;
      ends auto-resolve on the carry). **Toxin Tender** is the first user (grants Venomous to the chosen
      minion). To add a *stat* targeted Battlecry (e.g. +X/+X), just add a `battlecryBuffTarget`-style
      factory that reads `payload.target` — the rest is wired. **Corrupted Lifebinder** added
      `CardDef.targetTribe` (restrict the pick to one tribe + exclude self) for tribe-locked targets.
- [ ] **More cards for the keyword triggers.** End of Turn has cards (Ritualist, Combinator) + a
      multiplier (Chronos); Avenge (X) is used by Kennelmaster; the `battlecryTriggered` event has
      Karwind; Battlecry/Deathrattle/End-of-Turn all have repeat-modifiers now (Drakko/Sylus/Chronos).
      `endOfTurnBuff` (buff self) still has no card. Immune / Stealth work on any card today. Reusable
      primitives available for future cards: `deathrattleGrantSpell` (combat death adds a card to hand),
      `cardBuffs` (persistent per-cardId run enchantment), `battlecryGainRandomMinion` (add a random
      minion of a tier to hand), `battlecryTriggered`/`onBattlecryBuffTribe` (react to any Battlecry),
      and `CardDef.manaPerTurn` / `boardManaBonus` (board-derived max-mana economy — Money Bot). Added
      this batch: the **Engraved** keyword (`EG` — combat gains carry back via `permaGain`), `onKillBuffSelf`
      (buff self on kill — Gnasher), `deathrattleDamageAll` (board-wide Deathrattle — Blaster),
      `deathrattleDestroyKiller` (destroy the killer, off the `onDeath` `killer` — Jenkins & Fi), and
      `weldMagnetic` (the shared magnetize path; Beatboxer mimics every weld).

## M3 — meta

- [x] **Shareable web build** — `npm run package:itch` builds with a relative base and zips an
      itch.io-ready `ascent-itch.zip` (`index.html` at root, forward-slash entries). Good enough to hand
      a playtest build to friends; a proper hosted/versioned deploy is still future work.
- [~] **Heroes as data + hero select.** Shipped: `@game/sim/heroes.ts` registry (`HeroDef`, power
      `kind` resolved in the reducer), `RunState.heroId`/`heroPowerSpent`, a pre-run **hero picker**
      (`HeroSelect.tsx`, store flag `heroChoices`, no router) **now offering a random 3-of-N**,
      power-aware targeting (Fortify hits a tavern offer; the rest are warband-only), per-hero
      **Resolve** (`HeroDef.resolve`, shown on the picker), per-power **unlock turn**
      (`HeroPower.unlockWave`), and **passive powers** (`HeroPower.passive`). Power kinds now cover:
      recruit buffs (`fortify`/`gild`), recruit re-triggers (`replayBattlecry`/`replayEndOfTurn`),
      a passive (`spellAmplify`), and a **combat-driving** mark (`resummon` — reads in `simulate()`).
      **Nine heroes, all named + with portrait art:** Warden (Fortify), Indy (Gild), Myra (Pulse), Soren
      (Reclaim), Rohan (Attunement, passive), Djinn (Cadence), Nadja (Mana Font — a `gainMaxMana` active),
      Cassen (Collision — a `collision` carry-back: kill 5 enemies → a top-tribe minion), Drakko (Drumline —
      the first **quest** power: buy 5 Battlecry minions → a free Drakko the Drummer). Remaining:
  - **More heroes** — each is a `HeroDef` + (only if novel) a new power `kind`. Cheap kinds left: a
    one-shot gold/mana, a reroll discount, a token summon.
  - Consider always including a simple "starter" hero in the 3-of-N so a new player isn't forced into a
    niche power.
- [ ] **Menu flow — Title → Play → Mode → Hero → run.** The hero picker is the first slice; extend the
      same store-flag/scene pattern (no router) backward to a Title screen and a Mode select. Reuse the
      overlay/`herocard` components. Keep it lean — a small `scene` enum in the store, not a framework.
- [ ] **Modes — PvE + async PvP.** Two intended modes via a data-driven `MODES` registry. **PvE** is the
      bounded climb (the win condition below + the meta-progression items here hang off it). **Async PvP**
      fights *snapshots* of other players' submitted boards (no live opponent); its progression is a
      ladder/rating, a separate track from the PvE unlock economy — design alongside, don't conflate.
- [x] **PvE win condition — WIN 15 combats.** `CONFIG.winsToWin` (15): the run is won by *winning* 15
      combats → a `victory` phase + screen; losing (Resolve 0) is gameover. A loss costs Resolve but the
      climb continues, so wins ≤ waves fought. **Fixed 2026-06-23:** was `wave >= maxWave`, which wrongly
      declared victory on *reaching* wave 15 regardless of record; `maxWave` is now just the balance-tools'
      wave-reporting horizon. (Will likely move to per-mode config.)
- [ ] Unlocks — cards / heroes gated by progression (heroes are now data, ready to gate). *(PvE)*
- [ ] Ascension modifiers — escalating run-difficulty tiers. *(PvE)*
- [ ] Daily seeds — shareable, deterministic runs (the engine already threads one seed everywhere).
      Note: the hero-*choice* roll currently uses `Math.random` (UI meta) — seed it here for dailies.
- [ ] Save / replay — `serialize`/`deserialize` exist; add run-resume UI + replay of a combat's
      event log from its seed.

## M4 — juice & onboarding

- [ ] Pacing polish, audio, VFX. _(Ongoing — recently: a **PixiJS v8 WebGL effects layer** (transparent
      full-viewport overlay, pooled-particle system) wired to combat, with a **hit-impact** burst
      (additive hot core + normal-blend orange shockwave + jagged shards + rising smoke) fired on the
      lunge's contact frame, a **gold-coin sprinkle** out of the Gold counter on sell (gravity arc), and a
      low **dry-dirt dust puff** under a unit placed/moved on the board, and a **trigger-medallion pulse**
      (glow→ring + a deduped `triggerpulse` sound off a unit's mechanic badge when its effect fires in
      combat or shop; cadence cards like Frontdrake glow per tick + pulse on payoff — CSS, compositor-only),
      a **Discover burst** (golden white-hot magic erupting from center off the page edges, behind the cards),
      a **loss-damage tally → blast** (surviving enemy tiers + opponent tier fly into a capped damage
      counter, then a Pixi bolt blasts the Resolve bar), and a **Taunt bulwark** (procedural silver-metal
      heater shield rendered BEHIND the card via a third back-layer FX instance, deploy thwap + smoke + a
      "thunk" sound on play; old corner badge retired; a DEV tuner — `TauntTuner` + `tauntConfig` — drives
      the shield's shape/rim/gem/glint/tint/size/deploy LIVE via shader uniforms)
      — the additive foundation for a future Pixi combat arena (effects → sprites →
      arena, each shippable). **Next FX candidates:** death burst, Pixi-rendered Start-of-Combat/Blaster
      projectiles (replacing the SVG bolts), Divine-Shield-break shimmer; first **sourced SFX** (random sell1–4 + combat
      smack, Web-Audio sample player + synth fallback), a **master-volume slider** + mute in Settings →
      Audio (persisted, scales every sound), the combat **smack fired frame-accurately from the attack
      lunge** (lands on contact, not the beat clock) with a longer/overdriven lunge; referenced-card hover
      popups (see the token a card creates / your current Fodder), sequenced per-card End-of-Turn telegraph
      with Chronos repeats + per-card FX (Ritualist shop wash, Combinator electrify), ornate Discover frame,
      Reborn/Venomous particle FX, Triple Reward glow, tribe-coloured card frames — body wash + outlined art
      + white text box (dual = split frame/edge).)_
- [ ] **Fuller SFX coverage.** Sourced clips exist for sell + combat impact; the priority gaps (per
      `docs/sfx-events.md`) are still synth placeholders: Divine-Shield break, Start-of-Combat cast, poison
      kill, reborn, Fodder eat/chomp, magnetic weld. **Now also silent (no default smack any more):**
      non-attack damage — deathrattle AOE (Blaster), poison kills — want their own cues.
- [x] **Damage lands at the lunge connection (done 2026-06-24 → devlog).** An `attack` beat now absorbs its
      on-attack flash events (`buff`/`rally`/`summon`/`reveal`/`improve`) into the wind-up, so the damage beat
      is the next one and lands at contact. Pure, tested `combatBeats.ts` (`buildBeats`) — grouping-only, event
      order untouched. **Live-review the feel** across rally/cleave/windfury/deathrattle on the PR.
- [x] **Art preload / warm pass (done 2026-06-24 → devlog).** `art.ts` `warmArt()` preloads every card/hero
      webp on idle from `Game`'s mount, so the first shop renders with art cached — no cold-load pop-in (incl.
      the itch CDN). Verified: 157 webps fetched on the title screen.
- [x] **Soulsman tracked in combat (done 2026-06-24 → devlog).** `maxGold` combat event → gold pulse + float
      + coin-shimmer sound + narration + Procs "Max Gold" section.
- [x] **Bane proc flash (done 2026-06-24 → devlog).** Flashes Bane (+ any board Fodder it buffed) via the
      battlecry-trigger flame flash, so the enchant reads even with no Fodder out.
- [x] **Fodder consume swirl never lost (done 2026-06-24 → devlog).** The effect retries across frames until
      the tavern row is measurable instead of bailing + marking the seq seen.
- [x] **Performance is the north star (2026-06-23 → devlog).** Two adversarial audit passes; fixed the
      magnetic-board frame drop (animated `box-shadow` glows → opacity-only `::before` pulses), memoized
      `Unit`, stopped deep-cloning `lastCombat`, killed the per-frame drag reflow, `decoding="async"` +
      global `prefers-reduced-motion`. Added **`npm run perf`** (regression-tripwire harness) +
      `docs/performance.md` (the headless + DevTools playbook). **Ongoing:** run `npm run perf` before/after
      any engine/render-loop change; keep to the anti-patterns in `docs/performance.md`.
- [ ] **Remaining low-pri perf cleanups** (audited, negligible today — do opportunistically): drop live
      `drop-shadow`/animated `border-radius` from the Venom/triple-arrow/rope-flame particle loops; the dead
      Reborn-particle block (no R-keyword card exists); narrow `StatusBar`'s whole-`run` subscription.
- [ ] Tutorial / first-run onboarding.
- [ ] Full accessibility + touch support.

## Backlog / ideas (unscheduled)

- [ ] **Minion Book polish (shipped 2026-06-28 → devlog).** The Tab bestiary is live (filterable by tier ×
      tribe/Spells, paged). Future passes when content/meta grows: a name/text **search box**; sort options
      (tier / tribe / attack / health); show **copies remaining** in the live pool; a **keyword filter** row;
      decide how **set/RNG-variable cards** appear once sets exist (per owner — revisit then); maybe a real
      page-turn animation + SFX for the book feel.
- [ ] **Decouple the remaining hardcoded card-ids (effect-system audit, 2026-06-28).** The mechanics system is
      data-driven (cards = data + effect subscriptions); a content push needs no engine changes for normal
      Battlecry/Deathrattle/SoC/keyword cards. But a handful of cards still branch on their own id in logic.
      ✅ Discover spells fixed via `discoverOnPlay` (2026-06-28). Remaining: **easy data-field cases** —
      Hoarder sell value (`recruit.ts` `sellValueOf`), Cling magnetize stacking, Fodder Feeder sell, Yazzus
      spell-cast multiplier; and **genuinely-novel multiplier effects** that may warrant a new primitive rather
      than a hardcode — Echo Warden (summon duplication) + Sylus the Reaper (extra Deathrattle fires) in
      `core/combat/simulate.ts`, Beatboxer magnetic mirroring. Low priority — none block new content.
- [ ] **Aura system (shipped 2026-06-28 → devlog).** Run-wide buffs are now a declarative `AURAS` registry in
      `simulate` applied everywhere (warband/shop/start/summon/Reborn/resummon); new aggregate auras are a
      one-line entry, per-card enchants flow from `cardBuffs`. Follow-ups if useful: move the aggregate auras
      (undead/imp) into the `cardBuffs`-style map so recruit + combat share ONE source; add an "Aura" line in
      the card inspect breakdown; audit the latent imp double-apply on a starting-board Imp.

- [ ] **Dev stats tracker (TABLED 2026-06-26).** A replay-driven analytics tool — no live telemetry needed, since
      every run is a deterministic `Replay = {seed, heroId, actions}` that re-derives byte-identically. Walk each
      persisted replay through `reduce` and read state at each step to aggregate: per-minion **offer / purchase /
      play / sell rates** and **win-rate-when-present**; per-**hero** runs / win-rate / avg-waves / avg-power /
      tribes / triples; per-tribe rollups. Build in layers: (1) `npm run track` headless aggregator in
      `packages/tools/` (mirrors `balance`/`curve`; works over bot runs today, auto-reports on real runs once they
      land in a `docs/run-exports/` or the backend below); (2) persist the full **replay** on run-end (a ~1-file
      mirror of `boardLibrary.ts` — `store.ts` already keeps `replayActions` + `exportReplay()`); (3) optional
      in-app live overlay (presentation). Easy/Easy/Medium. Design fully scoped in the 2026-06-26 session.
- [ ] **Auto-persist boards (+ replays) to a shared backend — kill the manual export/bake.** Today capture →
      `localStorage` → manual Export → `docs/board-exports/` → `npm run pool` → committed `OPPONENT_POOL_DATA`.
      Replace the manual middle with a **serverless DB — DECIDED: Supabase (2026-06-26)** (hosted Postgres + JS
      client + dashboard; alternatives weighed + parked: Cloudflare Workers+D1, PocketBase, custom Worker):
      **write** = fire-and-forget POST of finished-run boards on run-end (next to `saveRunBoards`); **read** =
      fetch a curated pool ONCE at startup and `registerOpponents` it (kept static for the session → determinism
      preserved). `BoardSnapshot` already carries `patch` — store it as a column so we can **serve by patch**,
      **sort/query by patch**, and **clear stale patches** from the dashboard. Keep `OPPONENT_POOL_DATA` as the
      shipped **offline floor** (itch builds must work with no network).
      - **Seam:** all DB access behind one `remoteBoards.ts` (`uploadBoards` / `fetchPool({patch})`), reading
        `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from env — **no-ops gracefully when unset**, so the build
        stays green before a project exists. Touches `store.ts` (hot/shared — coordinate) for the two hooks. Its
        own branch/PR (`feat/board-backend`), not the title-practice branch.
      - **Why Supabase scales to public (2026-06-26 decision rationale):** this workload is read-heavy +
        identical-per-patch + low-write + no-realtime, so the DB is never the wall. The two things that actually
        gate "public" are **DB-independent** and added *when* we go public: (1) **CDN-front the read path** (serve
        the curated pool as a static/edge-cached blob, never hit the DB on boot) and (2) **server-side replay
        validation** for anti-cheat (clients upload the `{seed,heroId,actions}` replay; a Worker/edge fn runs
        `@game/sim` to re-derive the boards → fabricated boards aren't reproducible). Leaving Supabase, if a true
        hit, is a **cost** optimization (→ Cloudflare Workers+D1/R2, or self-host Neon/RDS), bounded because it's
        standard Postgres + the one-file seam.
      - **Caveat to design around:** a live pool makes replays reproducible only against the *same* pool snapshot —
        fine for same-session board capture, but daily/shareable seeds must pin to the committed pool.
      This is the concrete realization of step 3d / async-PvP step 5. Schema + seam sketched in the 2026-06-26 session.
- [ ] **Mid-combat ascension — UI presentation.** The engine now emits an `ascend` event + transforms Tara →
      Taragosa mid-fight (see the devlog). Wire the UI: `useCombatReplay` to fold the `ascend` event (swap the
      unit's cardId/name/tribe live), a new `sfx.ascend` (a triumphant level-up), an `.ascend` animation in
      `styles.css` (a gold "level-up" burst — one-shot, compositor-friendly), plus the combat-log line + trigger
      pulse. Integration map already scouted (animFor / floatFor / narrate / SFX / DELAY / combatBeats).
- [ ] **Spirit Pup → Spirit Worgen ascends mid-combat + counts in-combat spells.** `spellCastTransform` is
      recruit-only today. Add: combat spell-counting per Spirit Pup (carried back like Tara's `ascendProgress`
      so the countdown is permanent), and queue its ascension via the new infra when it crosses `at`. Needs
      `spellProgress` threaded onto the combat minion + a `playerSpellProgress` carry-back applied at settle.
- [ ] **Reborn carries the Eternal-Knight enchant accrued in PRIOR fights.** Reborn now re-applies the
      Eternal-Knight (and Undead-everywhere) buff banked in the *current* fight (see the devlog), but a Knight
      that accumulated +A/+H over earlier fights drops that part on rebirth — it's baked into the run-board
      stats and isn't passed into `simulate`. Plumb the run's `cardBuffs` into combat (a new param) so the
      full enchant carries through Reborn. Low priority (needs a Knight with Reborn *and* a prior-fight stack).
- [ ] **Live Buffs window: the remaining run-buffs.** Spell power + max Gold now tick up live in combat (folded
      from per-beat telegraphs — see the devlog). Undead-attack (Karthus), Fodder/Imp (Bane-via-Ryme), Mama
      Bear's per-summon climb, and Guel's per-spell climb still resolve only at settle — they have no clean
      per-beat signal (the run-wide enchant gain isn't evented; Guel's spells-cast is bus-only). To make them
      tick too, emit a structured run-buff-gain combat event (or extend `combatBuffDelta` to read the `improve`
      events for Mama Bear) and fold it the same way.
- [x] **Three neutral minions (done 2026-06-22).** Hoarder (T1 — sell scales +1 Mana/turn held, golden +2),
      Black Belt Brian (T5 — Battlecry: Discover a spell, golden +1 random), Yazzus (T6 — spells cast 2×/3×, the
      cast spark procs per resolution). All wired with art + tests; see the devlog. (Shipped alongside the
      Junkyard Titan rework → "Deathrattle: add a random Magnetic minion".)
- [ ] **Hand uniform-height + hover-pop (re-approach).** The absolute-drawer + raise attempt broke card
      placement on short/wide viewports (the hand crowded the warband drop zone) and was reverted to the
      original in-flow hand. Redo as a COMPACT-at-rest fan (arch only, like the warband) with the full card
      revealed on hover — survives short viewports, is naturally uniform, and stays out of the play area.
- [ ] **Cassen grant fly-to-hand animation.** Collision's granted minion is added to hand + the `N/5` counter
      ticks, but it should *fly out of the hero panel into the hand* (mirroring the mid-combat hand-grant
      flourish). The mid-combat fly is keyed to combat events; Cassen's grant lands post-combat in
      `settleCombat`, so it needs its own post-combat marker + a fly-from-hero-panel animation.
- [x] **Friendly/any spell targeting** (done 2026-06-22). `CardDef.target` gained `'any'` (vs `'friendly'`):
      **Shatter** + **Front to Back** (text says just "a minion") can be dropped onto a **tavern offer** to
      buff it pre-buy. `castSpellOnOffer` folds the buff onto the `ShopCard` (baked in on buy, like Fortify);
      `shopUidAt` resolves the drop target. Stat/keyword spells only; gild/devour/tribe-read stay friendly.
- [ ] **Ember-gain modifiers feed the projection.** The Embers-chip popup projects the next two waves'
      starting Embers from the base `maxEmbers` curve. When cards modify Ember gain (per-wave income,
      one-shot ramp, etc.), fold their effect into the projection so it stays accurate.

- [x] **Finite minion pool (copy quantities per tier).** Wired: each run stocks `POOL_QUANTITIES[tier]`
      copies (T1 **10**, T2 **9**, T3 **8**, T4 **7**, T5 **6**, T6 **6**) of every buyable minion of its
      active tribes (+ neutral) into `RunState.pool`. The shop draws from it (a card at 0 copies stops
      being offered), and sell / reroll return copies (a golden returns 3), while conjures (Discover,
      Buddy) take a copy so selling them stays balanced. *Remaining refinement:* the draw is **gated** by
      availability but not yet **weighted** by remaining count — kept the tier-proximity weighting so
      existing seeded tests stay deterministic. Add copy-count weighting (BG-style: more copies → more
      likely) if the contested feel needs sharpening.
- [ ] **Pool UI — show remaining copies.** The pool is wired but invisible; a small "copies left" cue
      (on the shop card, or fading a card type once it's exhausted) would make the contention legible.
- [ ] **Divine Shield indicator (re-add).** The `.dsfx` overlay was removed as too noisy. `effectArt()`
      + `art/effects/divineshield.png` are retained — re-add a *subtler* DS cue (small corner badge or a
      thin rim) when wanted, rather than the full-card aura.
- [ ] **Recruit perf pass — further (if it still micro-stutters locally).** Done: `Card` is memoized + its
      props stabilized (per-card view-object `useMemo` maps, one shared pointer-down handler), so the board's
      cards don't re-render during a drag; and `onMove` is now **rAF-throttled** — the pointermove burst
      coalesces into one `setDrag` per frame, capping the recruit-tree re-render at the refresh rate (high-Hz
      pointers no longer over-render). If a local `npm run dev` build *still* stutters, the next lever is to
      take the floating drag-card transform fully imperative (write it to the node via a ref on pointermove)
      so the recruit tree doesn't re-render at all between meaningful state changes (zone/insertion-index/
      magnetize). **Asset note:** ✓ card-art is now **WebP** (≤512px, q85, via `npm run optimize-art`) — 71 MB → 4.3 MB
      (−94%); the high-res masters stay out-of-repo. Also dropped `background-attachment: fixed` earlier
      (a real repaint win).
- [ ] **Fodder keyword — more users.** `FD` is now a keyword (Fred carries it; consume keys off it).
      Give other cheap/token minions the keyword and/or add cards that interact with Fodder, now that
      it's a reusable marker rather than one card.
- [x] **Dual-type minions — fully wired.** `CardDef.tribe2` (+ combat `Minion.tribe2`, + zod) is live;
      the footer shows both labels/icons + split-hue; Magnetic welds via both cards' tribe sets
      (`magnetizesTo()` — you can magnetize onto Heckbinder); and dual types now count as **both** tribes
      for tribe buffs (combat + recruit). First dual card: **Heckbinder** (Demon/Mech). *Open only:* the
      A.6 **counter matrix** still keys off the primary tribe — decide if a dual minion should be
      answered by either tribe's counter (balance call).
- [ ] **Threat telegraph — reintroduce, lighter.** The red omen bar was removed per the user ("for
      now"); the wave # in the HUD is all that's shown. The build spec still wants a pre-shop threat
      telegraph — bring back a slimmer/optional form later. `Omen.tsx` is retained (unrendered) so the
      enemy-preview derivation can be reused.
- [ ] **Hand-tuck tuning.** The hand now fans up from behind the status bar (pops on hover). The tuck
      depth / hover-lift / fan overlap are first-pass values — revisit once more cards are in play
      (and on shorter viewports) so the resting peek and the pop both feel right.
- [ ] **Buy-zone polish (optional).** The buy drop-zone + "BUY" box now mirror the sell zone — drop a shop
      card anywhere below the warband line to buy. Optional: show the dragged card's **cost** on the pill
      ("BUY −3") for full "SELL +1" symmetry, and/or float the pill nearer the warband line.

- [ ] **More single-target Battlecries** (e.g. "give a friendly minion +X/+X") — the full place-then-aim
      gesture now ships (Toxin Tender → Venomous). A stat version just needs a `battlecryBuffTarget`
      factory reading `payload.target`; the UI/aim/`pendingTarget` plumbing is reusable as-is.
- [ ] Confirm/refine the **name-on-art card layout** — implemented from a fuzzy ask (name pill on
      the art's bottom, keyword/text area below); revisit spacing + legibility with the user.
- [ ] **Minion art — remaining illustrations.** The per-card image pipeline shipped (drop
      `<id>.png` into `packages/ui/src/art/minions/` → it replaces that card's pixel sprite
      everywhere; falls back to the sprite when absent). **Every source illustration that maps to an
      existing card id is now wired** (32: alley, brood, broker, buddy, bulwark, chronos, cling,
      combinator, discoverspell, drone, drummer, echo, emberpouch, feed, fred, grim, heckbinder, imp,
      impscrap, karwind, kennel, moneybot, omen, ritualist, sandbag, shaper, spiritfire, spore, stray,
      sylus, weaver, whelp). The rest still use
      pixel sprites and have **no source art yet** — every source illustration now maps to a card.
      Source art lives in `C:\Game Assets\Ascent Art\Minions`. **Hero portraits** use a parallel
      pipeline (`art/heroes/<id>.png` → `heroArt()`); **all three heroes (Warden, Oner, Myra) are
      wired**. `downscale-art.ps1 -Sub heroes` right-sizes hero portraits the same way. NOTE: Vite
      resolves `import.meta.glob` at server start — restart the dev server after adding a new portrait.
- [ ] **Divine Shield art style — bubble vs. crest.** The effect-art overlay pipeline shipped
      (`art/effects/*.png` → `effectArt()`; `.dsfx` screen-blends a glowing aura over any `DS` minion,
      live on Spare Part Drone). The current asset is a shield **crest** shape; if a rounder "bubble/dome"
      shimmer reads better, swap the art or move it to a corner badge — user's call.
- [~] **Art compression.** *Downscale pass shipped* — `scripts/downscale-art.ps1` caps in-repo art at
      640px (System.Drawing, no deps); the four 1254px illustrations are now 640px (minion art 31.5 →
      26 MB). **Still pending: WebP** for the real win (~26 MB → ~6 MB), blocked on an encoder
      (`cwebp`/`sharp`/ImageMagick/`ffmpeg` all absent — add `sharp` as a dev dep + a build step, or
      install `cwebp`). Lower priority if the game ships as a desktop **exe** (assets load from disk, so
      bundle size becomes a one-time installer cost, not a per-play download) — revisit once the
      web-vs-exe distribution path is decided. Masters live in `C:\Game Assets\Ascent Art\Minions`.
- [ ] Vendor the full Build Handoff v2 into `docs/handoff.md` (currently in-session only).
