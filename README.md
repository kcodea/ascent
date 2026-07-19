# ASCENT

A single-player roguelike auto-battler. Build a board in a Battlegrounds-style shop, then fight a
**17-round course** of enemy boards. The goal is to **cover the rating-driven Line**; clearing the whole
course is a bonus achievement on top.

> **Rules & systems:** [`docs/GAME-RULES.md`](docs/GAME-RULES.md). **Content counts:**
> [`docs/CONTENT.md`](docs/CONTENT.md). **Architecture & conventions:** [`CLAUDE.md`](CLAUDE.md).
> **Full history:** [`docs/devlog.md`](docs/devlog.md). **Forward queue:** [`docs/roadmap.md`](docs/roadmap.md).

## Quick start

```bash
npm install
npm run dev          # play it (Vite dev server)
npm test             # vitest: determinism, effects, run loop, content
npm run balance      # headless: probe the tribe counter matrix with mono-tribe boards
npm run bot          # headless: a greedy bot plays full runs
npm run harness      # headless: narrated combat event log + determinism proof
npm run typecheck && npm run lint
npm run build:web    # production build (the CI gate + what players run)
npm run package:itch # build + zip ascent-itch.zip for itch.io (HTML, "play in browser")
```

New contributor? See **[ONBOARDING.md](ONBOARDING.md)** (clone → install → verify → the collaboration rules).

## The game in one screen

- **17 rounds:** 2 calibration (economy runs, don't count) + 15 scored. Alternate a **shop phase** (recruit
  minions, play them onto a 7-wide board, sell, upgrade the tavern, cast spells) with an **auto-resolved
  combat** against a served enemy board.
- **The Line** is your rating-driven target; covering it is the run's success contract. Surviving all 17 is a
  separate achievement.
- **6 tribes** (Beasts, Dragons, Undead, Mechs, Demons, + neutral glue) with triples → Gilded, Discover,
  quests (waves 5 & 11), and runes (Basic + Epic Runeforge). See [`docs/GAME-RULES.md`](docs/GAME-RULES.md).
- **Deterministic engine:** combat is a pure function returning an event log the UI replays; one seeded RNG
  threads everything (replays, shareable seeds, cheap balance sims).

## Recent changes



- **Card info panel detached** — the name/keywords/text/tribe drawer now floats beneath the card as a rounded
  dark-glass panel (matching the hero/quest panels) instead of welding onto the frame; the right-click inspect's
  Buffs panel matches. Same info, new housing.
- **Card sets** — cards now live in switchable sets (`sets.ts`), flipped live like rifts. A run pins its
  set at creation, so flipping never disturbs an in-flight or replayed run. See `docs/card-sets.md`.
- **The blink can't come back at high combat speed.** Beat holds divide by the speed slider but the death CSS was fixed seconds, so above ~1.31× a dying card was unmounted mid-animation — the same symptom as the old blink, by a different route. Death durations now divide by a `--combat-speed` var, making the ratio speed-invariant (identical at 1×).
- **Damage numbers fade properly at speed.** Their cleanup divided by combat speed but the CSS animation didn't — above ~1.07× the number was removed while still fully opaque, popping out instead of fading (at 1.6×, gone 67% into its animation). Float animations now scale with the speed slider.
- **Snappier combat pacing.** The clock held 869.5ms after *every* impact against a 320ms death animation — trimmed across two passes to **500ms** (`attackGap` 0.34 → 0.14, attack lead 353 → 240). A plain swing is now **1375ms** (was 1745), a Windfury pair **2750ms** (was 3490), and an attacker that dies mid-lunge **1925ms** (was 2595). That's the floor: the attacker's 340ms elastic settle fills most of what remains.
- **Snappier deaths + a combat-timing reference.** Death animations drop 0.42s → 0.32s and a plain attacker's
  return-home death now starts fading *as it lands* instead of idling ~260ms first — an ordinary trade resolves
  ~340ms sooner, with #503's "dies at home" read intact. The Deathrattle variant keeps its longer delay (the
  skull needs to burst first), so the pull-home hold is now variant-aware. New
  [`docs/combat-timing-reference.md`](docs/combat-timing-reference.md) documents every event's hold, every
  keyword's cost, and 36 interactions end to end.
- **Looping paint-property sweep** — the last three `infinite` keyframes that repainted every frame
  (`discpulse`, `venomdrip`, and the dead `endpulse`) are now transform/opacity only, so the resting shop is
  fully compositor-driven. Groundwork for a 240fps shop phase, where the frame budget is 4.16ms.
- **Perf HUD v2** — measured `hotspots` (real attribution, not correlation) for the reducer and autosave,
  plus the HUD restyled as a proper ASCENT panel that drags and resizes like the tuners.
- **Perf HUD** — `?perf=1` turns on a bottom-right frame-health readout (fps, worst-frame, jank, live FX
  counts) that logs a full session to exportable JSON for triage. Ships in prod builds, dormant by default.

- **Weld FX perf + Chorus Engine hand-grants** — batched weld measurement (one reflow, not N),
  a pre-solved ease LUT, and a single `conjuredStats` helper so a conjured card's preview matches what
  actually lands in your hand.
_(Latest few — the full history is in [`docs/devlog.md`](docs/devlog.md).)_

- **Runes batch 7a — 12 new runes.** Five Basic (Rebirth: Rise with full Health; Tempering: first Attachment
  each turn Wards its minion; Aftershocks: Echo summons +4/+4; Refrain: your 3rd Shout returns the turn's
  first Shout to hand; the Trophy: first Slaughter each combat → a copy next shop) and seven Epic
  (Transfusion, Mirror March, Recurrence, Replication, the Conductor, the Undertow, Endless Appetite).
  Plus **Rune of Mastery** (batch 7b): every "Improve" step your effects take applies twice — Karthus,
  Crypt Drake, Runescale, Den Mother, Ritualist, Sergeant, Front to Back, Squirl Scout, Spirit Worgen,
  Archmagus Guel, and the improve-your-X runes all double. 30 Basic + 31 Epic total.

- **Flurry swing FX + sounds.** A Flurry (W) attacker's strikes now throw a wind-slash burst (crescent blades +
  sparkles) that *replaces* the normal impact VFX — and wins even on a crit — plus a lunge-whoosh and hit sound
  on both swings. Owner-tuned via a 🌬️ dev tuner + Test button.
- **Flurry wind-blade aura.** Flurry (W) minions now swirl with a persistent vortex of wind blades — a
  multi-ring CSS aura (spinning comet arcs, per-ring squash/flip + top-middle dim, a slow 100%→20% breathe),
  owner-tuned via a standalone preview rig. Pure CSS so it rides drag + the combat lunge; Pixi swing sparkle
  is a queued follow-up.
- **The combat blink is dead — root-caused and fixed at the source.** When an attacker died in its own
  clash, its pull-home (`killTweensOf`) gutted the still-live lunge timeline and made GSAP **re-fire the
  contact callback that advances the beat clock** — the double advance skipped the death beat, so every
  card in that clash vanished with no animation (and impact beats/sfx occasionally doubled). All lunge cue
  callbacks are now once-guarded, and the end-of-fight hold gained a wall-clock floor so the final trade's
  fade completes. Also removed both live DEV combat-timing tuners (**Choreography pacing** and **Lunge**),
  whose `localStorage` overrides could silently skew combat timing from one accidental slider nudge.
- **Per-z End-of-Turn rewards land one hit per step.** Blueprint Cache (+2/+2 per Attachment), Rune of
  Spending, Rune of Action, and Forsaken Speed now strike their targets once per unit of the scaler,
  sequentially on their beat — ten Attachments read as ten +2/+2 hits, not one +20/+20 lump. (End-of-Turn
  only; Start-of-Combat lumps like Umbral Energy stay one-shot.)
- **Aura Wave FX — a global board wave.** Run-wide tribe auras (Undead Lantern **and** buy-Attack sources,
  the Imp aura, Beast buy-aura, Scrap Herald's Attachment aura) now announce themselves with a single
  tribe-colored wave that blooms from the board centre out to both edges and dissipates — a global "the whole
  board was touched" cue that fires regardless of which cards are on screen (the old per-card bloom showed
  nothing when the tribe wasn't visible). Owner-tuned via the 🌀 Aura Wave dev tuner (defaults baked).
- **Triggered rune buffs descend onto their targets.** Rune of Kindling (leftmost +3/+3 per spell), Rune
  of Scales (Dragons +1/+1 per spell), and Rune of Scale (random allies on Gold-spend) used to jump their
  targets' numbers with zero feedback — they now rain a descend onto each buffed minion, via the same FX
  path spells and Deathrattles already use.
- **EoT FX replay + targeting cursor.** End-of-Turn beats replay their real FX:
  Abyssal Feeder / Feasting Bogrot play the full fodder-eat choreography and EoT buffs (incl. Hunter's
  reaction) tendril on their beat. The OS cursor hides while a targeter's aim line is live.
- **Slaughter fires on a mutual kill.** A minion that attacks, kills an enemy, and dies to the retaliation
  in the same clash now still procs its Slaughter (on-kill) effect — previously the dead killer's effect
  was suppressed. A defender felling its attacker still doesn't count as a Slaughter.

- **Tavern Up stone button.** The "Upgrade Tavern" plaque is now a carved stone medallion on the board (owner
  art): your current shop tier lit as slot pips, a breathing blue gem glow, a warm press flash + dust +
  shockwave, and a broken "complete" gem at max tier. Stays up through combat as a passive tier indicator.
  Owner-tuned via a live 🍺 dev tuner; defaults baked into JS + CSS.
- **Three new heroes.** **Re-Pete** (Second Hand — every 3 turns, a plain copy of your left-most hand card),
  **Atrius** (Possession — Start of Combat, the leftmost minion gains the rightmost's Attack and the rightmost
  gains the leftmost's Health) and **Gorr** (Four Peat — your 3rd minion buy each turn conjures a plain copy of
  one of the three at random). All arts wired + live power tallies. Joins **Tiff** (Dragon Tamer) from earlier
  in the week.
- **Balance pass: 24 cards.** Stat/tier tuning across all tribes (Mumi, Hoarder, Imp King, Karwind, Rope
  Wrangler → T4, Haven Drake → T5, Field Mechanic → T3, …), Mechanical Jouster gains Ward — and **Karthus** /
  **Crypt Drake** now *improve permanently per copy* (Slaughter grants climb +3 each kill; the every-2-attacks
  board buff climbs +2/+2 every 4 attacks), with live card text showing the current numbers everywhere.
- **No game sounds on the main menu.** The charge glyph no longer lights (or plays its ~30s swell) invisibly
  behind the title — it's fully suppressed while any full-screen surface covers the game, and quitting to the
  menu mid-charge fades the swell out. Only deliberate UI sfx play on the menu. Round 1 now kicks off at **21s**
  (was 18s) so no turn ever starts already inside the 20s charge window.
- **End Turn diamond.** The End Turn / Start Combat action is now the gem-in-bronze diamond on the board's
  middle-right (de-coupled from the shop tray) — breathing diamond-silhouette glow, lightning arcs along its
  edges, a dulled-gem pressed state, and a full 💎 dev tuner (position / scale / glow / lightning).
- **Career + post-game visual pass.** The Career page now matches the ornate mockup — full-height profile
  panel (gold-ringed avatar with an Oath roundel, gradient Renown pill, iconed stat chips, single-line
  Insights), a "Winning Boards" header with gold round chips + aggregate record, and richer match rows
  (VICTORY/DEFEAT, labeled stat strip, Standout Stats panel). The course-complete screen got a gradient gold
  headline + beveled Play Again.
- **No more repeat opponents.** The remote pool now pulls a newest-first sample **per wave** (the old global
  cap starved waves ~9+ as the shared table grew), and the no-repeat rule widens to a fresh nearby wave before
  ever allowing a back-to-back board.
- **Vocabulary pass + hero-power rewrites.** The UI now speaks in themed terms — **Renown** (Rating), **Oath**
  (Line), Fulfilled / Surpassed / Fell Short verdicts, **ASCENDED** / **FALLEN** endings — and all 23 hero
  powers got shorter, cleaner text. Hero select shows just Renown + Oath.

- **Charge glyph fades out on End Turn.** Ending the turn now eases the charging sigil away over ~450ms instead
  of snapping it off-screen — and the long charge-build **sound** fades out with it (~300ms) instead of playing
  on under combat.
- **Turn timer → charging glyph.** The burning rope is gone: the final ~20s now charge the board's etched sigil
  with white-hot blue energy (motes flowing in, a ramped feather, a completion flash), sitting behind the cards on
  the board surface — plus a build sound at charge-start and an explosion at zero. (Timer logic unchanged.)
- **Mixing desk (dev).** The 🎛️ Mixing Desk in the Dev menu is now a horizontal console with vertical faders —
  master limiter + per-bus + per-category strips, each with its own ▶ to preview that sound and a bus-reassign
  dropdown. Readable labels throughout; meters are compositor-only.
- **Target glow fades in on attack.** The attacker's orange glow is gone; the defender's red "target" glow now
  fades in over the attacker's wind-up (a one-shot ramp) instead of snapping on. Selection glows are unchanged.
- **Teal card hover glow.** Hovering a card now lights a bright teal line hugging its frame + a stacked soft
  bloom, seated *behind* the art (never bleeds over the portrait), with the grounding shadow fading out so the
  glow reads clean. Owner-tuned via a live DEV tuner (🔆 Hover Glow); shipped defaults baked into JS + CSS.
- **Anomaly system + modes.** A registry of limited-time global rule modifiers (`ANOMALIES`, flip `enabled`),
  pinned onto each run so replays keep them, telegraphed on hero select. Current: **Runic Behavior** — every
  hero visits the basic Runeforge on turn 7. (Also built: **Freedom** — first minion each turn is free.)
- **Critical Strike VFX.** A crit (Commander Impala) now lands with a crimson-gold flourish — an amplified
  impact burst, a bold ring, a "CRIT!" pop, a red flash on the struck card, and a punchier board shake — not
  just the crit sound. Owner-tuned on a preview rig, baked into the Pixi renderer, with a live DEV tuner.
- **Real combat/UI sounds.** The synth placeholders are now real clips, each with its own mixer level (attack
  wind-up, death, Ward gain, triple/Gilded reward, Start-of-Combat zap, max-Gold raise).
- **Avenge beats wait for the summons.** An Avenge payoff now deploys after the death cascade's summons —
  presentation-only reorder; the resolved board is untouched.
- **Step counter polish.** Cleaner in the shop (hides a fresh `0/N`), honest end-of-turn cadence timing, and a
  combat-only fade-in/out.
- **No-repeat opponents + opponent pinning.** You won't face the same board within 4 rounds, and each run
  records the exact boards it fought (`servedBoards`) so a replay serves them verbatim.
- **Symmetric combat state (engine refactor).** `simulate()` now takes one `CombatSideState` per side instead
  of ~23 positional args + an enemy bag — behavior-identical, killing a class of snapshot-fidelity bugs.

## Layout

A TypeScript monorepo (npm workspaces). The engine is a pure, deterministic simulation fully decoupled from
the UI — combat is a pure function returning an event log the UI merely replays. See [CLAUDE.md](CLAUDE.md)
for architecture and conventions.

- `packages/core` — `@game/core`: seeded RNG, types, event bus, effect system, `simulate()`
- `packages/content` — `@game/content`: data-driven cards + threats + quests + runes (zod-validated)
- `packages/sim` — `@game/sim`: run loop (economy, shop, tiers, triples, scoring, quests/runes)
- `packages/ui` — `@game/ui`: React + Zustand recruit screen + combat arena
- `packages/tools` — `@game/tools`: headless combat harness, run bot, balance runner
- `apps/web` — Vite app wiring `ui` + `sim`
