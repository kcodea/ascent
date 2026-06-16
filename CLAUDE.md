# ASCENT

Single-player roguelike auto-battler. Battlegrounds-style shop → build a board → fight an
ever-rising curve of **threat-typed** enemy boards. Survive as long as you can; score = waves
survived. Endless ascension, **bounded engine** (6 tiers, gold cap 10, board 7), threat telegraph
before each shop.

## What is locked vs open

- **LOCKED — game rules & content** (per the user's Build Handoff v2): economy, combat
  resolution, the card set, threat archetypes, the tribe↔threat counter matrix. Build to spec; do
  not re-litigate. The counter matrix is balance *truth*; stat numbers are starting dials.
- **DECIDED — visual identity & layout** (2026-06-15): the UI direction is **"Pixel Arena"** —
  clean, bright, bold flat design (Nintendo/Splatoon clarity) with **pixel-art sprites** on cards,
  and the **Battlegrounds 3-row layout** (Tavern shop → Warband → Hand). Color scheme: **Sunward**
  (warm cream base, tangerine accent, raspberry threat). Cards are one standardized size across all
  rows; stats sit in corner badges over the sprite. Canonical mockup:
  `docs/design/recruit-E2-pixel.html` (sprites are palette-indexed 16×16 matrices → canvas). The old
  `ascent-ui-v3.html` prototype is dead — do **not** reproduce it.

## Architecture (non-negotiable)

The game is a **deterministic simulation, fully decoupled from the UI.**

- **Combat is a pure function** → event log → replay: `simulate(player, enemy, rng, cards)` returns
  `{ events, result, playerDamage, initial }`. The UI animates the event log on its own clock; it
  **never computes outcomes**.
- **One seeded RNG** (mulberry32) threaded through everything via `fork()`. **`Math.random` is
  banned** in `core`/`content`/`sim` (ESLint-enforced). This buys replays, shareable seeds, daily
  runs, and cheap exact balance sims.
- **Cards are data + effect subscriptions**, never bespoke classes. New cards = data only unless
  they need a genuinely new effect primitive.
- **Never mutate shared `CardDef`s** — clone into combat `Minion` instances.
- Recruit-phase effects (Battlecry, buff-on-summon, consume) bake into stats before combat; the
  combat simulator runs combat-time effects (Start-of-Combat, Deathrattle, on-shield-break,
  on-kill) and emits log events. Combat event vocabulary: `sc · attack · dmg · shield · shieldUp ·
  poison · reborn · death · summon · buff`.

## Monorepo

```
packages/core/     @game/core     pure engine: rng, types, event bus, effects, simulate()
packages/content/  @game/content  data-driven cards + threats, zod-validated   → core
packages/sim/      @game/sim       run loop: economy, shop, tiers, triples, scoring  → core+content  (M1)
packages/ui/       @game/ui        React + Zustand: recruit screen + combat arena      (M1)
packages/tools/    @game/tools     headless balance runner + combat harness       → core+content
apps/web/          Vite app wiring ui + sim                                              (M1)
```
`ui` depends on the others **through public package entrypoints only** — importing an internal
means the boundary leaked.

## Commands

- `npm install` — install workspace deps
- `npm run typecheck` — `tsc --noEmit` across all packages
- `npm test` — Vitest (determinism + golden + effect tests)
- `npm run harness` — headless combat: prints a narrated event log + proves determinism
- `npm run lint` — ESLint (incl. the Math.random ban)

## Milestones

- **M0 — walking skeleton** ✓: core types + seeded RNG + event bus; Beasts + neutral glue;
  `simulate()` event log; headless determinism harness (`npm run harness`). Done.
- **M1 — vertical slice** *(in progress)*: ✓ run state machine + economy + 5 threats +
  deterministic wave/enemy generation + scoring + save/load; ✓ recruit-phase effect system
  (Battlecries / buff-on-buy / summon buffs) + combat Start-of-Combat effects; ✓ 2 tribes (Beasts,
  Dragons) + neutral glue; ✓ Battlegrounds hand + `play` action (buy→hand→play→board). ✓ **live
  recruit screen** — `@game/ui` (React + Zustand over `@game/sim`) + `apps/web` (Vite), Sunward look
  + pixel-art sprites, all actions wired; ✓ **combat arena** — replays the `simulate()` event log on
  its own clock (lunges, shield pops, poison kills, deaths, narrated verdict; UI never computes
  combat) via a `recruit → combat → advance` phase machine; ✓ **full playable loop** (recruit →
  Face the Omen → arena → Climb On → next wave / game over), verified live. Run: `npm run dev`;
  headless: `npm run bot`. M1's "is it fun / is it readable" slice is up. **Remaining for M1 polish:**
  click-to-target Hero Power, reposition (drag), a little combat juice.
- **M2 — content + balance** *(in progress)*: ✓ all 6 tribes + full card set (Beasts, Dragons,
  Undead, Mechs, Demons + neutral glue — Mech adds Divine-Shield/shield-break + Magnetic merge;
  Demon adds the recruit-time Consume system); ✓ headless **balance runner** (`npm run balance`)
  that probes the A.6 counter matrix with mono-tribe boards; ✓ **triples + Discover** (3 copies →
  golden 2×, peek 1-of-3 one tier up); ✓ **5 tribes per run** + active-tribe HUD; ✓ early-game
  **balance on-ramp** (enemy width/stats ramp in over waves 1–5 + gentler loss damage, so waves 1–3
  are winnable); ✓ a big **UX pass** — pointer-drag with snap-back + gold sell glow, custom
  gauntlet/hand cursors, keyword tooltips + terse mechanical text, fanned hover-pop hand, 1:1 combat
  cards, Hero-Power targeting line, 2× tavern controls, hero-sized Ember/Resolve panels, center-
  anchored warband, +15% card width. **Remaining:** the deeper counter-matrix tuning pass (the
  runner flags Mech dominant, Beast underpowered, Dragon/Undead flat — starting-dial work).
- **M3 — meta**: unlocks, ascension modifiers, daily seeds, save/replay.
- **M4 — juice & onboarding**: pacing polish, audio, VFX, tutorial, full accessibility + touch.

> The full Build Handoff v2 (exact card text/stats, threat templates, combat spec A.3, UX spec) was
> provided by the user in-session. Ask to vendor it into `docs/handoff.md` if you want it on disk.
