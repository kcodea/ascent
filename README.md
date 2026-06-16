# ASCENT

A single-player roguelike auto-battler. Build a board in a Battlegrounds-style shop, then fight an
ever-rising curve of threat-typed enemy boards. Survive as long as you can — score is waves survived.

> **Status:** M2 (content + balance) — fully playable. All 6 tribes, triples + Discover, the run
> loop, and the recruit/combat UI are in. Remaining M2 work is the counter-matrix balance tuning.

## Quick start

```bash
npm install
npm run dev          # play it (Vite dev server)
npm test             # vitest: determinism, effects, run loop, content
npm run balance      # headless: probe the A.6 counter matrix
npm run bot          # headless: a greedy bot plays full runs
npm run harness      # headless: narrated combat event log + determinism proof
npm run typecheck && npm run lint
```

## Recent changes

_(Most recent first — the full history is in [docs/devlog.md](docs/devlog.md).)_

- **Combat feel** — replay now resolves each clash in one beat (attacker + target take damage
  simultaneously); dead minions are removed instead of greyed; attackers slide into their target.
- **Card UX** — fixed 1:1 card size everywhere; the name sits on the art with the text below; a
  30s turn timer that locks actions (except End Turn) at zero; transform-based drag with a clean
  snap-back + a little weight.
- **Rules/balance** — embers uncapped within a turn (sell always pays); keyword grants skip minions
  that already have the keyword; early waves (1–4) softened considerably.
- **Triples/Discover** — a triple makes a golden 2× minion; playing it grants a Discover spell that
  reveals one tier up; golden minions' effects are doubled.

## Short-term roadmap

_(Full queue in [docs/roadmap.md](docs/roadmap.md).)_

- **M2 (now):** counter-matrix tuning — Mech is too strong, Beast too weak, Dragon/Undead flat.
- **M3 (meta):** unlocks, ascension modifiers, daily seeds, save/replay.
- **M4 (juice & onboarding):** audio/VFX, tutorial, full accessibility + touch.

## Layout

A TypeScript monorepo (npm workspaces). The engine is a pure, deterministic simulation fully
decoupled from the UI — combat is a pure function returning an event log the UI merely replays.
See [CLAUDE.md](CLAUDE.md) for architecture, conventions, and the milestone plan.

- `packages/core` — `@game/core`: seeded RNG, types, event bus, effect system, `simulate()`
- `packages/content` — `@game/content`: data-driven cards + threats (zod-validated)
- `packages/sim` — `@game/sim`: run loop (economy, shop, tiers, triples, scoring)
- `packages/ui` — `@game/ui`: React + Zustand recruit screen + combat arena
- `packages/tools` — `@game/tools`: headless combat harness, run bot, balance runner
- `apps/web` — Vite app wiring `ui` + `sim`
