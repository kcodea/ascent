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
npm run desktop      # build + run the game in an Electron window (fast desktop iteration)
npm run package:desktop # build + produce apps/desktop/release/ASCENT-win32-x64/ASCENT.exe
npm run desktop:icon # regenerate apps/desktop/icon.ico from icon.png (only when the logo changes)
npm run package:itch:win # build + zip ascent-itch-win64.zip for itch.io (Windows download)
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

- **Discovers are lighter on the GPU.** The Discover burst runs on its own full-screen WebGL canvas, which used
  to keep rendering an empty frame every tick for the entire session. It now goes dormant the instant its burst
  finishes and wakes only for the next one — so nothing is being drawn behind a Discover (or during normal play)
  when there's nothing to show.
- **The leftmost hand card pops on hover again at wide resolutions.** The hero Buffs strip's container box
  reached over the hand and, being pointer-interactive, swallowed that card's hover so it never lifted — only
  at wide/fullscreen sizes where the boxes overlap (e.g. the desktop build). The container is now click-through
  except for its tab/drawer, so the hover reaches the card.
- **Dragging cards is smoother, especially late-game.** A drag now re-renders only when something visible
  actually changes — a drop-gap opening, a magnetize/cast highlight, a zone crossing — instead of on every few
  pixels of pointer travel. The dragged card, aim line and trail were already frame-exact; this removes the
  ~10–20× of wasted re-renders behind them, the source of the mid/late-game "drag jank / APM drops."
- **Set 2 can be built and playtested without disturbing set 1.** The Scene Builder has a **Card set** dropdown
  that plays any set — including one still in development — without flipping the global switch that would move
  real runs onto it. Adding a card to `cards/set2/` makes it appear in the rig immediately, and set 1's seeds
  are provably untouched.
- **Djinni's Cadence now triggers your quest and rune End of Turns too.** It read "trigger all friendly End of
  Turn effects" but only ever fired the board half, skipping quest/rune rewards like Echoing Roar, The Hoard
  Wakes and Rune of Spending — and did nothing at all on an empty board.
- **Played cards dissolve into arcane dust.** When you play a minion, its card body imprints as a glowing
  blue **wireframe of itself** — the stone joints, gold rails and gem picked out in light — then burns off
  into drifting dust. The linework is edge-detected from the plate art and baked to a 42 KB asset, so nothing
  is computed while you play.
- **The board frame is pinned to the UI at every window size.** The board art used to size off window *width*
  while the whole UI sized off *height*, so a 21:9 fullscreen rendered the frame 1.32% larger than any other
  window — and the board buttons, dialled in fullscreen, sat ~45px out of the frame everywhere else. The art
  now takes a constant overscan instead, so frame and UI scale as one unit. Also: the four board buttons'
  tuned positions are baked into the CSS fallbacks that production actually renders, with a test guarding the
  mirror.
- **Hand cards have a card body now.** Cards in hand render an ornate stone/gold **backplate** framing the
  portrait and rules text, which travels with the card as you drag it and dissolves when you play a minion to
  the board. The plate is a fixed size, so long rules text shrinks to fit rather than the plate growing —
  picked from the text's length, never by measuring the DOM. Art ships at 199 KB (down from a 6.6 MB source).
- **Toxin is now EXECUTE, with a new look.** The `V` keyword keeps its rule (destroys any minion it damages,
  spent after one hit) but sheds the poison-green identity: cards now swirl with a ring of **red rage** —
  smoke, comet arcs and drifting shards, painted over the frame like the Ward shell. Its own dev tuner
  (🩸 Execute Aura). The lime rim glow and dripping venom globs are retired. When it procs and destroys its
  target, an **execution strike** now cuts across the victim: a tapered white-hot crescent, embers, and blood.
- **Nine-card balance pass.** Kennelmaster's Start-of-Combat aura is now board-wide **+2 Attack** at Avenge
  (3); Growth drops to **T2 / +1/+1**; Spirit Fire to **+2/+3**; Patch Job splits into a **+1/+1 base plus
  +2/+2 per 6 Gold**; Hunter improves every 5; Badgington and Solaris Fang lose their Rally halves; Money
  Maker always gives a Gold Pouch. **Graverobber can no longer destroy itself.**
- **Step counters pop when they fill.** Any unit with a step counter — Avenge, Guel, Flowing Monk, Crypt Drake,
  Bloodbinder, the gold/buy meters, cadence cards, Spirit Pup, Tara — now bursts a white spark shower *out of
  the counter pill* the moment it reaches its step and the effect fires, in both the shop and combat. Its own
  dev tuner (🔢 Step Proc FX), separate from the spell-power cue.
- **Cleave hits land.** A Cleave attacker's strike freezes at the moment of contact, then a claw slash rakes
  across everything it hit — blood running down out of the cuts — before the attacker pulls home.
- **New Ward look** — Divine Shield is now a light-blue hexagonal **energy shell** encasing the whole card,
  gold frame included: a white-hot rim with inner/outer glow, a honeycomb that densens toward the edge, and a
  soft cyan halo. Dialled against a concept render on a preview rig, with a 25-dial live **Ward Shell** tuner.
- **Combat FX land on the unit's slot, not mid-flight.** Every effect that marks a unit — death bursts, the
  bone skull, self-buff pulses, coins, summon dust, ascend blooms — now measures through one shared
  layout-frame helper, so none can paint over empty board while its card is mid-lunge or being pulled home.
  (The Ward shatter deliberately still tracks the visible card: its dome is drawn *on* the card.)
- **New board backdrop** — the in-game board art is now `ascentboardnostuff` (3440×1459 WebP, 0.30 MB;
  the orphaned `testboard2` was removed, so the shipped payload actually drops).

- **One strike per attack.** A clash is two-way, so the damage moment following an attack was re-bursting
  *both* units — a second strike FX on the defender and a third on the attacker, which was never struck. The
  clash pair is now skipped there (their FX rides the lunge's impact channel); Cleave/AoE splash still bursts.
- **Balance bots can use spells.** The tavern's spell offer lives in a slot the bot turn engine never read, so
  every pilot bought 0.00 spells/run; the engine now reads it, values spells by what they do, and casts them
  from a full board. Win rate up for 3 of 5 pilots — and `npm run analyze`'s spell tables finally have data.

- **New Dragon: Twilight Emissary** (T2 2/3, Taunt) — *Battlecry: give a friendly Dragon +2/+2*, a targeted
  buff on a new `battlecryBuffTarget` factory. Plus Deathswarmer → T1 1/3 and **+5 starting Armor for every
  hero**.

- **Balance patch (2026-07-21) — complete**, on `balance/patch-2026-07-21` across 12 tested commits: Demon
  minion rebalance, 23 rune costs + 8 rune effect reworks, 40 quest objective retunes, 3 quest removals + 6
  quest flag reworks, and the new-mechanic minions (a new **buy-count** trigger for Korok/Banksly, Hunter's
  every-3 improve, **Runescale Drake** rescaled to spells-cast-this-turn, plus Hoard Cleric, Kennelmaster,
  Thundeer, Attachment Mechanic, Spell Appraiser, Nimbus, Displacement and Hoardbreaker).

- **Quest tendrils** — a gold ribbon reaches from a quest's node to the unit it triggers (Echoing Roar
  re-firing a Shout), with its own dev tuner.

- **Spell-power FX** — rising pink/purple/gold arrows, a mote blast, and the floating power number when a
  spell power goes up in the shop, with a full dev tuner. (Combat wiring still to come.)

- **Lunge feel pass shipped.** First tuning done against a strike that actually renders: slower travel
  (400px/s), a shorter wind-up with a deeper lean, an `expo.in` strike curve that hangs then blurs into
  contact, and a long lazy 1.11s settle home.
- **Strikes actually reach the target now.** The probe proved every swing's card was only ~20–40% of the way
  to the defender when contact fired: the `.unit` CSS `transition: transform` re-interpolated every per-frame
  GSAP write over 160ms, so the rendered card rubber-banded behind the tween — invisible on the slow wind-up,
  fatal on a 130–190ms strike. The transition is now suspended while GSAP owns the element (lunge, knockback,
  pull-home) and restored after, so the corner visibly lands on the defender's centre at contact.
- **The phantom mid-board ring is fixed.** The "impact ring firing off-target" was never the strike (the
  probe proved the strike lands dead-on) — it was the death moment's damage burst + ring firing at a dying
  attacker's mid-pull-home position, over empty board. It now fires at the unit's slot, where the death reads.
- **Strike targets re-solve late.** The strike's landing point and the impact FX position were computed at
  swing start and fired ~0.9s later — a neighbour dying mid-wind-up re-centres the row (a layout slide) and
  the ring landed where the defender *used* to be. The strike target now re-measures when the strike launches,
  and the impact FX resolve from the defender's live rect at the moment they fire.
- **Strikes are solved in the layout frame.** Attacks measured while a card was still mid-motion (a defender
  recovering from the last knockback, a Windfury attacker mid-settle) used the displaced position and landed
  off-centre — the strike now subtracts in-flight transforms and always targets the defender's true rest
  centre.
- **Straight-across attacks slam flat.** A defender directly ahead is now hit with a straight frontal drive —
  leading-edge midpoint to centre, no tilt — instead of the corner rule's sideways sidestep; the corner + tilt
  blend in over a tunable `faceOnRamp` (90px) of horizontal offset.
- **Strikes land corner-to-centre.** The attacker's leading corner (top-right travelling left→right,
  top-left right→left; mirrored to the bottom corners for enemy swings coming down the board) now impacts the
  defender's dead centre on every attack — lunges can no longer stop short of the target. Strike *durations*
  still derive from the old surface gap, so the contact beat and all combat timing are unchanged; the extra
  depth just makes the final drive hotter. The now-meaningless `bite` + `strikePoint` dials are retired.
- **Lunge tuner rebuilt around the approach vector.** There's no stable per-slot lunge to tune: the board row
  is centre-justified (a 6-card side seats differently from a 7-card side) and re-centres mid-combat as units
  die, so "slot 3 → slot 5" is a different vector before and after a death. Every dial is now a function of the
  vector — strike ease splits into three *distance* bands, and lead tilt can fold in the *approach angle*
  (it previously read only the sign of dx, so a steep diagonal led with the same corner as a flat swing). The
  panel shows what those functions produced for the swings you just watched, including how often the duration
  clamps flattened a strike. Defaults are unchanged, so the shipped lunge is untouched pending tuning.
- **Quest nodes** — every taken quest shows as a bubble with a live `x/y` counter, dim until it activates,
  then lit in the same slot. Replaces the old quest text panel.

- **"All" types read correctly** — Lab Experiment's footer shows ALL and it now takes tribal buffs from
  every source, in the shop and in combat.
- **Hand hover fixed** — pointing at the lower half of a card no longer makes it flicker instead of opening.

- **Three UI fixes** — the Freeze button now sits still on click (a CSS specificity loss, not a missing
  rule), the Fodder reference popup folds in Heckbinder's live aura, and the run-buffs drawer slides
  out instead of appearing.

- **Mode picker behind PLAY** — Ascent / Rift / Practice. **Rifts are now opt-in**: a plain Ascent run is
  unmodified, and the Rift mode is where the active modifier lives.
- **Art for all eight Tier 7 minions.**
- **One trigger-multiplier system** — Sylus, Drakko and Chronos now declare what they multiply as card
  data instead of hardcoded id checks, and **Uron, Oathbringer** (T7) multiplies all six trigger families.
- **Seven Tier 7 minions** — Thundeer, Amun Rab, Attachment Conductor, Mauron, Anubis, Salvatore McKlusky
  and Lab Experiment, reachable only while the Summit rift is active.
- **Tier 7 + the Summit rift** — Summit grants every hero +10 Armor and unlocks a Tier 7 shop; triples at
  Tier 6/7 discover Tier 7 minions. A purple Rift button now sits above Play whenever a rift is active.
  (Tier 7 minions themselves land next.)
- **New card art** for Sylus, Brightwing Broker, Combinator and Aeon Guard.
- **Balance pass** — Ryme gains Taunt and triggers both neighbours; Brightwing Broker now buffs your whole
  board on a buy; Combinator welds 2; Grim scales +2/+2 and gains a Gilded form; Guardian Drake gains
  Critical Strike. Vineweaver Drake retired.
- **Weld rings fire again.** A recent change cleared the weld FX payload on every action, which raced React’s
  dispatch batching — a weld plus any other click in the same frame lost its ring (and its stat flash). The
  payload now survives until the UI reads it.
- **Card info panel detached** — the name/keywords/text/tribe drawer now floats beneath the card as a rounded
  dark-glass panel (matching the hero/quest panels) instead of welding onto the frame; the right-click inspect's
  Buffs panel matches. Same info, new housing.
- **Card sets** — cards now live in switchable sets (`sets.ts`), flipped live like rifts. A run pins its
  set at creation, so flipping never disturbs an in-flight or replayed run. See `docs/card-sets.md`.
- **The blink can't come back at high combat speed.** Beat holds divide by the speed slider but the death CSS was fixed seconds, so above ~1.31× a dying card was unmounted mid-animation — the same symptom as the old blink, by a different route. Death durations now divide by a `--combat-speed` var, making the ratio speed-invariant (identical at 1×).
- **Damage numbers fade properly at speed.** Their cleanup divided by combat speed but the CSS animation didn't — above ~1.07× the number was removed while still fully opaque, popping out instead of fading (at 1.6×, gone 67% into its animation). Float animations now scale with the speed slider.
- **Snappier combat pacing.** The clock held 869.5ms after *every* impact against a 320ms death animation — trimmed across two passes to **500ms** (`attackGap` 0.34 → 0.14, attack lead 353 → 240). A plain swing is now **1375ms** (was 1745), a Windfury pair **2750ms** (was 3490), and an attacker that dies mid-lunge **1925ms** (was 2595). That's the floor: the attacker's 340ms elastic settle fills most of what remains.
- **Autosave moved off the shop's hot path.** It used to serialize the whole run + action log to
  `localStorage` on *every* buy, sell, roll and reorder; it now writes at turn boundaries, with an explicit
  flush when you quit to the title or the tab is hidden/closed, so nothing is lost.
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
