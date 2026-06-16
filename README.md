# ASCENT

A single-player roguelike auto-battler. Build a board in a Battlegrounds-style shop, then fight an
ever-rising curve of threat-typed enemy boards. Survive as long as you can — score is waves
survived.

> **Status:** M0 (walking skeleton). Deterministic core engine + one tribe + a headless combat
> harness that proves determinism end-to-end. No UI yet.

## Quick start

```bash
npm install
npm run harness     # headless combat: narrated event log + determinism proof
npm test            # determinism, player-damage formula, deathrattle, content validation
npm run typecheck
```

## Layout

A TypeScript monorepo (npm workspaces). The engine is a pure, deterministic simulation fully
decoupled from any UI — combat is a pure function returning an event log that a UI merely replays.
See [CLAUDE.md](CLAUDE.md) for the architecture and milestone plan.

- `packages/core` — `@game/core`: seeded RNG, types, event bus, effect system, `simulate()`
- `packages/content` — `@game/content`: data-driven cards (zod-validated)
- `packages/tools` — `@game/tools`: headless combat harness / balance runner
