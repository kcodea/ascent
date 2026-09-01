# 2026-09-01 — Finalize the player rune-node values (quest nodes + sheen)

Owner sent the finalized 💠 Rune-node values. Diffed against current defaults: only four moved — everything
else in the paste already matched.

- **Quest node 3** (`layoutConfig.ts`): `qb3X 30→36`, `qb3Y 23→20`.
- **Sheen disc 3** (`runeSheenConfig.ts`): `c3x 132→126`, `c3y −3→0`.

Baked into both sources of truth per convention: the config DEFAULTS **and** the `styles.css`
`var(…, fallback)` values (production reads the fallbacks). `--qb3-x`/`--qb3-y` have three fallback sites each
(the node itself, the sheen-3 translate, and the rune-chains translate) — all moved together. The chains var
(`--rch-x 131`, `--rch-y −3`) was left untouched since `chx`/`chy` didn't change.

**Pinning preserved (owner's requirement).** Both stay pinned by construction: quest nodes translate
`× var(--scale)`, and sheen disc 3 rides its node's `× --scale` offset while counter-scaling `--qb-s` (so it
keeps a fixed size and stays glued to the node). Only the numbers moved; the pinning formulas are unchanged.

Verified: `typecheck:web` + `build:web` green; no stale old values remain in any of the three files; the
`--rch-*` chains var confirmed unchanged. (A few px of node/sheen nudge — below the Patch Notes threshold.)
