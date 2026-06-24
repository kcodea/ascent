# ASCENT — roadmap / queue

Forward-looking work, broken down by milestone. When something ships, move it out of here (its detail
goes in [devlog.md](devlog.md)); when new work appears, add it under the right section. Keep honest
and current. High-level milestone summaries live in [../CLAUDE.md](../CLAUDE.md).

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
   opponent frame shows "by {name}" / "House board". **Queued next:** (a) **simulate-derived strength rating**
   (win-rate vs a calibration ladder, cached) + **power-band indexing** so matchmaking is even/on-curve; (b)
   **synthesized boards within a band** (`origin:'synthetic'` — mutate/recombine real boards, validate via
   `simulate`) to fill sparse bands (esp. high waves the bot can't reach); (c) **in-game friend export/import
   UX**; (d) a shared **friend backend** keyed by `(wave, power-band, tribe)` — the async-PvP track (step 5).
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
  to T3–5 (run `npm run audit`). Today each tribe is +4 to +7 short (47 total, holes at Dragon T5 +
  Neutral T6); fill the mid tiers, fill the unused primitives (`castSpell`, `endOfTurnBuff`,
  `spellCostMod`), and add **higher-tier spells** (Spirit Fire is now T2, **Growth** T4 and **Channeling
the Devourer** T5 have landed alongside the original T1s — keep filling the mid/high tiers toward the
~40-spell pool). The pool stays deliberately
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
  - **Follow-up (2026-06-23, shipped → devlog):** Sheldon/Speedy/Harry Botter made **Magnetic** (+ `spellAura`
    weld plumbing so the aura survives a weld); **triples now keep welded fields** (`rallyMechAtk`/aura, not
    just `manaBonus`); **Archmagus Guel scales** +1/+1 per 4 spells cast (a "T1–4 stay relevant" win);
    **HUD win counter**; hero power **fires from its button only**; Spirit Worgen + Guel2 art.
  - **Polish (2026-06-23, shipped → devlog):** **live card text** convention for scaling minions (Guel now
    shows current grant + countdown via `cardText.ts`); **shop buff floats** (+X/+X above a buffed minion,
    like combat); Combinator welds credited to the **magnetic** ("Harry Botter ×2"), not Combinator;
    disabled hero-power button keeps the game cursor.
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

- [ ] Pacing polish, audio, VFX. _(Ongoing — recently: first **sourced SFX** (random sell1–4 + combat
      smack, Web-Audio sample player + synth fallback), a **master-volume slider** + mute in Settings →
      Audio (persisted, scales every sound), the combat **smack fired frame-accurately from the attack
      lunge** (lands on contact, not the beat clock) with a longer/overdriven lunge; referenced-card hover
      popups (see the token a card creates / your current Fodder), sequenced per-card End-of-Turn telegraph
      with Chronos repeats + per-card FX (Ritualist shop wash, Combinator electrify), ornate Discover frame,
      Reborn/Venomous particle FX, Triple Reward glow, tribe-coloured card frames — body wash + outlined art
      + white text box (dual = split frame/edge).)_
- [ ] **Fuller SFX coverage.** Sourced clips exist for sell + combat impact; the priority gaps (per
      `docs/sfx-events.md`) are still synth placeholders: Divine-Shield break, Start-of-Combat cast, poison
      kill, reborn, Fodder eat/chomp, magnetic weld.
- [ ] **Art preload / warm pass (fixes itch art pop-in).** Card/hero webps are only fetched when an `<img>`
      first renders, so on a cold itch-CDN load the art "pops in" a beat after the card frame. Warm every art
      URL (`new Image().src` / `img.decode()`) during the title / hero-select screen so the shop opens with art
      cached. Platform-independent — fixes the web + itch-embed build, not just a future Electron/desktop wrap
      (which only removes the *network* half). ~5 MB of small webps; cheap to warm. `art.ts` already has every
      URL via the eager glob — just export the list + add a `warmArt()` call from the app entry.
- [ ] **Notes (2026-06-23, from play): three animation/combat gaps.**
      - **Fodder consume animation can get lost** — make the swirl/eat animation robust so it never silently
        drops (audit the Demon-eats-Fodder path in Recruit; ensure the FX always fires even on fast input /
        re-renders).
      - **Bane needs an animation** — its effect currently fires with no visible cue.
      - **Soulsman needs a proc animation + sound AND to be tracked in combat** — it isn't surfaced in the
        combat replay/log today; give it a proc beat (FX + `sfx`) and make its trigger show up in the event log.
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
