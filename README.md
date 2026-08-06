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
npm run typecheck && npm run lint   # typecheck = engine (typecheck:pkgs) + UI (typecheck:web); both gated in CI
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

_The latest highlights only. Full history, newest first, lives in [`docs/devlog.md`](docs/devlog.md)._

- **Snapshot fidelity** — served boards now carry their owner's full combat context (Ruby strength, Wild Hunt growth, hand, card-type buffs, Elderhorn modes, tribes); a fidelity test diffs the round trip against the reducer's own builder so new scalers can't silently drop.

- **Rune of Gemstorm fixed** — its Rubies now go through the real Ruby-play path, so Deepdelve Paragon doubles them (and Resonance Idol / Spellstone / Gemheart Carver see them too).

- **Celestials tranche 2** — Astral Relay, Celestial Crucible, Constellation Broker and Orrery take Set 3 to 16 cards; Orbits can now be TRIGGERED with nothing arriving.

- **Chicken Brawl's Charging Soldier charges again** — a duplicate `dw_soldier` CardDef was shadowing the one with the charge flag; one token now, plus a guard against shadowed duplicate ids.

- **Hero armor rebalance** — 19 heroes get individually-dialled starting Armor (spread now 2-20; Robin drops to 2, Brackus to 11).

- **Echohorn's Rally now detonates on the minion it procs, and hands over what it summoned.** Echohorn's
  token pulses, then a shard burst over a triple shockwave fires at the ally whose Echo it triggers — and the
  minions that Echo summons now appear *with* the burst instead of ahead of it. Once per proc, so a gilded
  Echohorn shows two bursts and delivers one litter each. Fixing this uncovered that Rally effects had never
  been able to play at all: a Rally is absorbed into its attacker's swing, so the binding that was supposed
  to drive it could never be reached.
- **A 16-item balance batch + fresh Set 2 art.** Tier/stat/cost tuning across five cards and five runes,
  Water Dragon back to its spell-copy shape, Errand Fiend to a Rally Imp engine, Rope Wrangler's Echo now
  summons (and spends) a random minion from your hand, Strange Revision works on Shop minions, Rubies count
  for Rune of Distillation, reward cards (Goldcrafter, Triple Reward…) no longer count as spells or get
  copied by spell-copy effects, and a new Dwarf — Chicken Brawl, whose Echo sends out a Charging Soldier
  that attacks immediately. Plus ~150 re-wired Set 2 minion illustrations.
- **The Effect Arena's Shout family is done** — every Shout now fires in combat when a disruptor (Ryme,
  Dawnclaw, Funeral on Loan) re-triggers it: the legacy combat switch is deleted, 60 effects run one shared
  body in both phases, and economy Shouts (card grants, Rubies, Gold, run enchants) resolve live and carry
  back to the run at settle. Only pure tavern work (consume/gild/shop enchants) still waits for the shop.
- **A Card Art tuner** — double-click any card in dev to grab its illustration and drag it into place,
  wheel to zoom, ✗/✓ to discard or save. Plus hue/saturation/contrast, saved per card to a real file.
- **Effects can now move the cards themselves.** A new `react` layer in the effects workshop animates the
  real card — the whole card, a stat badge, just the badge circle, or just the number — instead of drawing
  something on top of it. It can spread to neighbours or the whole board (rippling outward, sweeping across
  the row, or all at once), weakening with distance, with squash-and-stretch and shake channels.
- **Stat badges are now three pieces.** The attack/health badge used to be one element carrying both the
  circle and the number, so an effect couldn't touch one without dragging the other. It's now a wrapper, a
  `plate` (the circle) and a `value` (the number) — groundwork for badge-level effects like "pop the circle
  while the number counts up." Pixel-identical to before, verified across 12 card states.
- **Henchmen wired** — every hero can carry a hero-bound minion, never shop-offered, recruitable once per run
  at a Gold cost that falls every round (win −3, loss −2). System + placeholder shipped; the per-hero roster
  and real presentation come next. **Set 3 scaffolded** — registered and selectable in the Scene Builder,
  empty until its cards land.
- **Rubies now detonate on the minion they land on.** A gemshard burst over a twin shockwave, authored in the
  effects workbench, plays on the target every time a Ruby is played on it — your own drag from hand, a card
  that plays Rubies across the whole board, or one landing mid-fight. Board-wide plays sweep down the line
  60 ms apart rather than all flashing at once, which reads better and keeps the frame budget. Separate from
  the existing "your Rubies got stronger" cue, so a card that does both shows both.
- **Saving an effect no longer wipes its name and tags.** Effects carry a display name and a few tags used to
  search and group them in the effects library, and every Save was silently deleting them — the melee hit
  effect lost its own name that way, and it was only spotted by eye. Saving over an effect now keeps them.
  Saving under a *new* name still starts clean, because that's a copy, not the same effect.
- **Deleted the orphaned Pixi aura-bubble system (−1 WebGL context).** Ward and Reborn became CSS domes a while
  back, but the Pixi machinery that used to draw them stayed — including a whole third full-viewport WebGL
  context that a previous pass had merely ticker-stopped as "dormant" instead of removing. Gone with it: ~210
  lines of unused GLSL and the `.pixifx-under` layer. The break burst (`shatterAt` / `rebornSummon`) is
  untouched. Total emitted JS 2,631,425 → 2,617,973 bytes.

- **Dwarves and Kobolds are fully dressed** - both now have their own cardplate, Dwarf gets its oval and
  Taunt frames, and both tribes finally have a colour so their emblem fills in.

- **The effects tool can now take an effect back off a card.** It could attach an effect to a moment but
  never remove one — that meant editing a data file by hand. There are two ways to remove one and they do
  opposite things (go back to the default effect for that moment, or play nothing at all), so both are
  offered, each spelling out what the card will do afterwards before you press it.

- **Effects can now play *behind* the cards.** Every visual effect used to draw in front of everything, so a
  ground slam sat on top of the minions it was supposed to be shaking. An effect can now choose its layer —
  over the cards, as before, or under them on the board itself — with a toggle in the authoring tool. (It's
  beneath *every* card, not just its own; that's a limit of how cards and effects are drawn.)
- **Damage numbers are readable again.** Combat effects were painting over the damage numbers — the
  death-dissolve in particular buried them completely. The numbers now draw on top of every effect, in
  every situation, so a hit always reads. (They also cost the game slightly less to draw than before.)
- **The effects library stopped calling live effects dead.** Seven visual effects — the coin shower, the
  click puff, the melee smack and others — had been moved out of hand-written code into the authoring tool's
  own format, and the tool's coverage map, which only knew about one way of wiring an effect up, listed every
  one of them as playing nothing at all. It now tells the three cases apart: wired to a game moment, played
  directly by the code, or genuinely unused. The "played by code" list is worked out from the source itself
  and re-checked by a test on every build, so the next batch of migrated effects can't quietly go missing
  from it again.

- **Removed the dead "Shield Place" tuner.** The DEV panel had outlived its consumer: `syncShields` is gone and
  Ward/Reborn are CSS dome stacks, so dragging its slider only wrote a localStorage value nothing read. Its one
  knob — the dome's vertical offset — is already live in the 🔵 Ward Dome tuner as `domeY`. Also ESLint-ignores
  `.claude/**`, so locally-installed agent plugins stop making `npm run lint` red on a clean tree (78 → 0).
- **Audited the dead-code purge, and cleared the CSS half.** The roadmap's list was wrong in four places — two
  of them traps (`.disc-gem` and `.ob` are live; deleting them would have caused visible regressions) — and the
  dead effect-id count was 69, not "~17". Verified inventory now in `docs/dead-effect-ids.md`.


- **Fixed hand cards growing and overlapping** - the hand "make room" glide was baking the hover
  zoom into card width; it is reverted until it can be done transform-safely.

- **The hand glides open and closed** when you buy or play a card, instead of cards blinking to new
  spots. (The first version of this was inflating cards; it is rebuilt on a measurement no transform
  can pollute.)
- **The game now has a real speed limit — and the speed-o-meter was reading the wrong dial.** The target is
  **240 frames a second** (with 360 as the stretch), which leaves about **4 milliseconds** to draw each
  frame. The in-game performance readout had been judging frames against a 60-per-second monitor, so on the
  display we actually play on it only complained after *eight* frames had already been dropped — it reported
  a clean session while the game stuttered. It now measures the display it is running on and sets its own
  thresholds from that, resists being fooled by a busy first second or a throttled tab, and records which
  display a log came from so old logs stay readable. The budget itself is written down, along with the rule
  that the **worst** frame is what counts, not the average.
- **The gild opens without the hitch.** Combining three copies into a gilded card had a small stutter right as
  the animation started. It was not the gold glow or the flourish drawing — it was that the effect built two
  full-screen drawing surfaces the instant it began and wiped them clean every frame, though nothing is
  painted on either of them until a third of a second later. They are now created at the moment they are first
  drawn on, the three flying card copies are measured once instead of three times and go in together, and the
  card-art glow is only rewritten when it actually changes. Measured over the first eighth of a second of a
  real triple: the gild's cost per frame is down **24%**, with the effect looking identical.
- **The combat collision stutter is gone.** Every time two cards clashed, the game froze for about a sixth of
  a second — long enough to feel, short enough to be hard to catch. The cause turned out to have nothing to do
  with how many particles were on screen: each effect was throwing away its compiled graphics program when it
  finished and rebuilding it from scratch the next time, and rebuilding one blocks everything else for ~68 ms.
  Effects now reuse their programs (and the buffers behind them) from a pool, and the one unavoidable build
  happens quietly at load instead of mid-fight. Measured worst frame during a collision: **160 ms → under
  2 ms**, with proof that a reused effect looks byte-for-byte identical to a fresh one.
- **The effect workbench stops fighting the person using it.** Three ceilings came down at once. Art you
  import as a particle shape now survives a page reload instead of quietly reverting to a plain circle — the
  file was written to disk correctly, but the app couldn't see a file that appeared after it started, so a
  tuned effect appeared to vanish. The physics sliders got roughly four times the range, because "as dramatic
  as it goes" was landing short of what effects actually wanted (one had to trade launch speed for arc height
  to fake a lob the ceiling wouldn't allow). And the fade every particle rides — previously baked in, so
  particles faded whatever you drew on the opacity curve — is now a control that can be turned off entirely.
  Nothing already made looks different; every existing effect is pinned to that by test.
- **The melee smack is an authored effect now, and effects can aim along the blow.** An authored effect is a
  fixed recipe, but a strike has to fan its sparks *at the defender* — a direction that only exists at the
  moment of the hit. Rather than let callers bend a recipe with an angle (which would stop it being a recipe),
  a burst can now point itself along the moment itself: from where the effect came from, toward what it hit.
  The combat impact moves across on it and takes its whole dev tuner panel with it, since the workbench is
  where it is tuned from here.
- **Effects can be stretched in time at the moment they fire.** The last of the three per-call dials —
  bigger, more, and now *longer*. Not the same as slowing an effect down: the dust thrown up by a strike
  keeps its speed and simply hangs (and travels) further. The tricky part is that "life" means two different
  things — how long a particle lives and how long its layer exists — so the dial moves an effect's whole
  timeline together; stretching only half of it would have quietly cut particles off mid-flight in most of
  the library. The strike-point dust moves across as the proof, and every button that kicks it up now dials
  its own count, size and lifetime.
- **Effects can be sized at the moment they fire.** An authored effect is a fixed recipe, which is most of
  its value — but a lot of them need to know something only the caller knows: how big this card is, how hard
  this hit landed. Two per-call dials now carry exactly that, and nothing else: bigger, and more. The dust
  kicked up under a landed minion is the first effect to move across on them, and now sizes itself to the
  card it lands under. Existing effects are untouched down to the exact random roll a locked seed replays.
- **Bursts can be aimed.** A `burst`'s cone used to fan along the emitter's direction of travel — which is
  *nothing* for an effect pinned to a fixed point, so a directional pop from a static anchor couldn't be
  authored at all. Two new params fix that — point the cone at any angle you choose — and the gold coin
  sprinkle gets its upward fan back instead of popping in every direction.
  Every existing effect is untouched, down to the exact random roll a locked seed replays.
- **The first hand-written FX become data.** Now that authored effects actually reach players (below), the
  ~28 hand-tuned methods in `pixiFx.ts` can start moving to the workbench. Batch 1: the crimson damage burst,
  the click dust puff and the gold coin sprinkle are authored defs, taking `pixiFx.ts` from 3757 to 3648
  lines. The nine effects that take a per-call size or intensity are blocked until `playDef` can pass one.
- **Authored FX reach players.** The whole def runtime was dev-only by design, so nothing authored in the FX
  workbench had ever been seen outside a dev session. Three `import.meta.env.DEV` gates came out and the
  effects ship: **15 already-live bindings turn on** — attack exchanges, buff waves, keyword gain/loss, quest
  trigger/complete, rally, reveal, spell cast + progress, ward gain, venom spent, HP grants, cards to hand,
  and Bloodbinder's ruby lance. Cost: +34 KB gzipped of JS, 29 KB of it a primitives chunk fetched lazily
  on mount rather than at first paint (the main chunk grows under 5 KB gzipped). The
  *authoring tool* stays dev-only; a test now pins that split in both directions.
- **Cards and chips answer when you choose them.** Hero and mode cards already lifted on hover but did nothing
  on click; they now press into the table, chips sink, and list rows press inward.
- **Every button off the title screen now presses like the title screen** — real thickness, and a face that
  loses exactly the thickness it travels, so it compresses rather than slides. One extracted primitive, applied
  across nine screens.
- **The dev tuners look like instruments now.** Dark machined panels over the board instead of pale dialogs on
  it, with the slider track lit to its value, a flagged edge on anything moved off shipped, and the main menu's
  sheen on button hover and press. Eight ad-hoc text sizes became a four-role scale.
- **One button resets every dev tuner to the shipped values.** Per-panel Reset only ever cleared that panel, so
  nothing put the whole toolset back at once.
- **Tuning got a working surface.** Panel sections fold away and remember it, each panel has a find box, and a
  hold-or-tap button A/Bs your edits against the shipped values — the question "is this actually better than what
  we ship?" used to mean reverting every control by hand. All three landed in one shared component.
- **The dev tuners are one component now — 46 of 48 panels.** Every panel renders from a declarative spec that
  gives it real sections, a declared unit per control, a hover hint saying what you would see change, a number
  box beside each slider, and a one-click revert to the shipped value. The last three had no config module at
  all — they compose CSS — and now share one store that also owns tearing their override back down on close.
  `SfxMixer` is parked by owner request; `ShieldTuner` is handled separately (it is dead code).
- **Three dev tuner panels ignored their own close button** — their internal key disagreed with the menu's, so
  ✕ did nothing and they could only be dismissed from the menu. Fixed.
- **Set 2 content is complete: 26 quests and the full 96-rune roster.** The last stretch leaned on a handful of
  reusable primitives rather than bespoke code per item — a threshold dispatcher ("every N of X, do Y"), a
  gold-gain chokepoint, a shared free-rally helper — so most items became data plus a test. Two engine gaps
  closed along the way: Gold is now credited through one path, and combat can carry an untyped board buff back
  to the run.
- **Lobby mode stopped hitching.** Starting a lobby ran seven full headless runs to build its opponent seats —
  twice, since they were built only to be probed and then evicted. Recordings are now lazy, memoized, and warmed
  in shop-phase idle time: 750 ms → 21 ms to start, 950 ms → 4 ms for round 1. And dying in a lobby replayed the
  *entire* lobby to recapture its boards — ~20 s of frozen end screen; lobby runs now capture their boards as
  they play, so the longest task after death is 83 ms.

- **The dev tuning menu is searchable, and tuners are becoming data.** 53 flat entries became nine categories
  with filter-as-you-type and a description on every one; six of the 47 tuner panels now render from a shared
  schema that declares units, real sections, per-control hints, and a one-click revert to the shipped value.
- **FX library cleanup — and two "dead code" leads that weren't.** Five leftover workbench drafts deleted from
  `fx/defs/`. `death-dissolve` was investigated and **kept**: no binding names it, but `useCombatReplay` plays it
  directly for every plain death. Same for `pixiFx.discoverBurst`, which fires on every Discover open and is the
  only reason the second Pixi context exists. Both are now documented as do-not-delete.
- **FX workbench: stop hiding things.** Four papercuts in the effects authoring tool, one principle — make
  failure visible. "Watch in combat" now carries its own ▶/⏸ · 🔥 Fire · scrubber, so you can retrigger and scrub
  while watching an effect on a real card; the commit confirmation survives the page reload committing itself
  forces, instead of being unreadable by construction; a locked seed warns under Save (naming the seed, with a
  one-click unlock) before it bakes one frozen roll into a shipped def forever; and a preset variant whose
  adjustments reached nothing says so in the UI rather than only in the console.
- **＋ New effect — the FX workbench gets an on-ramp.** A preset gallery of archetypes (⚡ Bolt, 💥 Blast), each
  with variants (thin / heavy / crackling / beam), lands a tuned, working composition in the editor instead of a
  blank page. A variant is a multiplier table applied to slider params only — clamped, snapped, and loud about
  anything it couldn't apply. The two shipped bases are first passes awaiting a tuning pass.
- **Lobby: real players at the table.** An 8-seat lobby now seats up to 3 REAL player runs from the shared
  board pool — their actual boards, in their actual order — alongside bots wearing player handles. Measured over
  9 lobbies, recorded player runs place 3.63 against the bots' 6.58.
- **Bots that actually play.** The production bots score a board by *fighting with it* rather than guessing from
  stat proxies, and the lobby runs them at last (every seat had quietly been the old greedy bot). Against real
  player boards Expert covers 4.63 wins to legacy's 3.33 — par is 9, so the gap is real and measured.
  `npm run bot:ladder` / `lobby:ladder` report it with error bars.
- **The title menu presses back.** Every menu plaque now has a visible edge that collapses under the click, a
  down-stroke "thock", a hover sheen, a staggered entrance, and a keyboard focus ring — the column went from
  hover-only rectangles to controls with weight.
- **The UI is typechecked in CI now.** `packages/ui` was excluded from the root typecheck and `typecheck:web`
  was never gated, so the whole presentation layer had no type gate (the production build transpiles without
  checking). Cleared all 59 errors and turned the gate on. Several were real: the mixer's gain-reduction meter
  read NaN, kobold-tribe quests printed `undefined` in their text, and the two plate tuners' "demo" buttons did
  nothing.
- **Commit animation.** Pick a card and a moment in the workbench, tune the effect while watching it on the
  real card, then commit — writing the effect and its binding together, for that card only (forking it) or
  everywhere.

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
