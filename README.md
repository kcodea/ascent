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
- **The dev tuners are one component now — 46 of 48 panels.** Every panel renders from a declarative spec that
  gives it real sections, a declared unit per control, a hover hint saying what you would see change, a number
  box beside each slider, and a one-click revert to the shipped value. The last three had no config module at
  all — they compose CSS — and now share one store that also owns tearing their override back down on close.
  `SfxMixer` is parked by owner request; `ShieldTuner` is handled separately (it is dead code).
- **Three dev tuner panels ignored their own close button** — their internal key disagreed with the menu's, so
  ✕ did nothing and they could only be dismissed from the menu. Fixed.
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
