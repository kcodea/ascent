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

_(Latest few — the full history is in [`docs/devlog.md`](docs/devlog.md).)_

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
