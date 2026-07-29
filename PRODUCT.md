# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences share one screen, and the design must serve both without a mode switch:

- **A small known circle** (the two developers and friends) playing their fiftieth-plus run. They know
  the shop loop cold, want density and speed, and are the ones who notice a frame drop or a mis-timed
  combat beat.
- **Cold itch.io traffic** — a visitor who clicked "play in browser" with zero context, no tutorial
  expectation, and no auto-battler literacy guaranteed. They must be able to reach a first combat
  without reading anything outside the game.

The situation is a desktop browser session (or the packaged Windows desktop app), mouse in hand, one
run at a time, alternating a shop phase they drive with a combat they watch.

## Product Purpose

ASCENT is a single-player roguelike auto-battler. The player recruits minions in a Battlegrounds-style
shop, arranges a 7-slot board, and fights a fixed **17-round course** of served enemy boards, one
auto-resolved combat per round.

Success is **covering the Line** (displayed as fulfilling the **Oath**): the rating-driven number of
scored wins the run is expected to reach. Covering it is a win even if the run then falls; falling
short is a loss even if the run survives all 17 rounds. Finishing the whole course (**Ascended**) is a
separate achievement layered on top. The only failure state is Resolve reaching 0 (**Fallen**).

## Positioning

- **A bounded, single-player course.** A full arc plays out in one sitting — no lobby, no eight-player
  wait, no indefinite survival ladder. The run always completes the course unless Resolve hits 0.
- **Real opponent boards, pinned.** Opponents are actual captured player and friend boards served
  wave-first from a shared pool (remote → self/friend → committed synthetic floor), with a procedural
  threat board only as fallback. Every run records exactly which boards it fought (`servedBoards`), so
  a restored or replayed run serves them verbatim.

The Line/Oath contract and the deterministic seeded engine are core product truth (see Purpose and
Capabilities) but are **not** claimed as the differentiating pitch.

## Operating Context

- **Round loop:** shop phase (recruit, sell, reroll, tavern-up, cast spells, arrange board and hand) →
  "Face the Omen" → an auto-resolved combat the player watches as a replayed event log.
- **Course shape:** 17 rounds — 2 calibration rounds that run the full economy but don't score, then 15
  scored rounds whose W–L record is the run's result.
- **Surrounding surfaces:** hero select, title/boot, career and rankings, leaderboard, run trophies, end
  screen, an inspect view, a minion book, an esc menu, and an extensive in-app dev/authoring suite
  (FX workbench, scene builder, tuner panels, SFX mixer, balance panel).
- **Distribution:** itch.io "play in browser" build and a packaged Windows Electron desktop app.

## Capabilities and Constraints

- **Combat is a pure function.** `simulate(playerSide, enemySide, rng, cards)` returns an event log; the
  UI animates that log on its own clock and never computes an outcome.
- **One seeded RNG** (mulberry32) threaded via `fork()`; `Math.random` is banned in `core`/`content`/`sim`
  and ESLint-enforced. This buys exact replays, shareable seeds, and cheap balance simulation.
- **Cards are data + effect subscriptions**, never bespoke classes, and live in pinned **sets** a run
  reads via `poolOf(state)` for its whole life.
- **Economy and board:** Gold ("Embers") starts at 3, +1/wave, capped at 10; minion cost 3, sell 1,
  reroll 1; board holds 7, hand holds 10; tiers 1–6 with Tier 7 gated behind explicit access.
- **Resolve:** all heroes start at 30 plus per-hero Armor; loss damage is capped per round and uncapped
  for rounds 16–17.
- **Systems:** 6 tribes, triples → Gilded, Discover, quests on waves 5 and 11, runes via the Basic
  (turn 7) and Epic (turn 12) Runeforges.
- **Desktop-scale only.** Mouse and desktop viewports are the target. There is no touch or phone layout
  obligation.

## Brand Commitments

- **Name:** ASCENT.
- **Displayed vocabulary is binding.** The player-facing words are the themed ones, never the internal
  or classic terms: Rating → **Renown**, Line → **Oath**, cover → **Fulfill**, exceeded → **Surpassed**,
  missed → **Fell Short**, course completion → **Ascended**, death before round 17 → **Fallen**;
  Battlecry → **Shout**, Deathrattle → **Echo**, Divine Shield → **Ward**, Windfury → **Flurry**,
  Venomous → **Execute**, Reborn → **Rise**, Magnetize → **Attach**, Magnetic → **Attachment**,
  Golden → **Gilded**. Taunt, Avenge, and Cleave are kept as-is. The rename table lives in
  `packages/ui/src/terms.ts`.
- **Card text always prints the current computed value.** Whenever a card's magnitude depends on live run
  or combat state, the printed text folds in the actual number it will produce right now, plus the
  countdown to the next step where one exists — wired into both `liveCardText` (shop/board/hand/Discover/
  end screen) and `Unit.tsx` (combat). A stale or base-only printed number is a defect, not a polish item.
- **Snappy at all times.** A frame drop, shop hitch, or drag stutter is treated as a defect. Looping
  animation is compositor-only (`transform`/`opacity`); performance is measured before shipping. The full
  playbook is `docs/performance.md`.

## Evidence on Hand

- **Real art:** `packages/ui/src/art/` — heroes, minions, powers, quests, runes, spells; board and home
  backgrounds, frames, cursors, and FX assets in `apps/web/public/`.
- **Real audio:** `packages/ui/src/audio/` — a per-card/hero SFX library with a generated manifest.
- **Real opponent data:** a shared Supabase board pool plus committed local/synthetic boards
  (`packages/sim/src/opponentPool.data.ts`, generated — never hand-edited).
- **Canonical documentation:** `docs/GAME-RULES.md` (rules, code-cited), `docs/CONTENT.md` (content
  counts), `docs/devlog.md`, `docs/roadmap.md`, `CLAUDE.md` (engineering contract).
- **Absent — do not fabricate:** there are no testimonials, no press coverage, no player-count or
  review numbers, no pricing, and no launch or availability claims beyond the itch.io browser build and
  the Windows desktop package.

## Product Principles

1. **The simulation is the truth; the UI is a performance of it.** Presentation never computes an
   outcome, and a presentation change may never alter a result.
2. **Feel is a feature with defect status.** Responsiveness during shop, drag, and combat replay
   outranks visual ambition; anything that costs frames must be measured before it ships.
3. **Say the current number.** The interface tells the player exactly what a card will do right now, in
   the game's own vocabulary — never a base rate, never an internal term.
4. **Legible to a first-timer, fast for a veteran.** Clarity is built into the default layout rather than
   bolted on as a tutorial, so density never becomes a wall for cold traffic.
5. **A run is a record.** Seeds, served boards, and results are pinned and replayable; the interface
   should reinforce that a run is a specific, revisitable thing.

## Accessibility & Inclusion

- **Color is never the only signal.** Anything color-coded — tribe, rarity, buff and debuff, Ward and
  Rise — must also carry shape, icon, text, or position. This is the binding commitment.
- No formal standard (WCAG level, reduced-motion policy, or minimum type size) has been decided. Future
  work should not claim compliance with one.
