# Board pool — power banding, patches, and the regeneration lifecycle

Enemy boards are real `BoardSnapshot`s — **synthetic boards generated from the card set** (banded to the tuned
enemy curve, covering every wave 1–20) plus any **imported player/friend boards** — served back as opponents
(`pickOpponent`). This doc defines how we measure their strength (**power banding**), stamp them with a
**patch**, **prune** stale ones, and **regenerate** a competitive pool when the meta shifts.

## Power banding — wave-relative strength

A board's strength only means something **relative to its wave**: a 7-wide board that's strong at wave 3 is
weak at wave 15. So `rateBoardForWave(board, wave, ladders)` (`packages/sim/src/rating.ts`) scores a board by
the **fraction of its OWN wave's calibration ladder it beats** (win = 1, draw = 0.5) → a 0..1 rating;
`ratingBand` then buckets it into `BAND_COUNT` (8) bands. **Band 0 = weak-for-the-wave, band 7 =
strong-for-the-wave.**

- **The ladder** (`buildWaveLadders`): per wave, a set of reference boards spanning weak → strong play. The
  bake builds it from the **tuned procedural enemy curve** (`buildEnemyBoard` across the 5 threat archetypes ×
  a few seeds — `opts.proceduralWaves`/`proceduralSeeds`), which is wave-scaled by `enemyScaling` for **all 20
  waves** and spans weak (venom swarm) → strong (iron wall / glass cannon) — so the ladder covers 1–20 **with
  no bot** (the bot only survives to ~wave 9). Any **imported real boards** fold in too, raising the high-wave
  ceiling. The legacy bot path (`buildBootstrapPool` at rising fidelity) is still available via `seeds`, but
  the pool bake passes `seeds: []` and calibrates purely off the designed enemy curve. Synergy-aware,
  deterministic, rebuilt from the live card set every bake, so **per patch it self-recalibrates.** (Unservable
  boards are skipped so a stale cardId can't break ratings.)
- **Why wave-relative:** the old `rateBoard` fought one fixed gauntlet (top rung 7/9/16) and **saturated** —
  by ~wave 8 any decent board beat all rungs → rating `1.0`, so it couldn't tell a weak high-wave board from
  a strong one. That's exactly how high-wave boards silently went weak after a balance patch.
- **Curation / QA only.** Live matchmaking (`pickOpponent`) still matches by wave then biases to the closest
  `Σ(atk+hp)` power. Bands drive the pool bake + pruning, **not** opponent selection (yet — see the roadmap).

## Patches

Every board carries `patch` (`BoardSnapshot.patch`) = `<pkg version>+<short git sha>` (e.g. `0.1.0+a1b2c3d`),
stamped:

- at **capture** — `boardLibrary.saveRunBoards`, via the Vite `__APP_VERSION__` / `__BUILD_SHA__` defines;
- at **house bake** — `build-pool.ts`, via `package.json` version + `git rev-parse --short HEAD`.

**Convention: bump `package.json` `version` on each balance patch.** That version is the patch id, so boards
from before a balance change are identifiable + prunable. (Boards captured before stamping shipped have no
`patch` — prune them with `--no-patch`.)

## Lifecycle / tooling

| Step | How |
|---|---|
| **Synthesize (primary source)** | `npm run pool` generates `SYNTH_PER_WAVE` (default **8**) boards for **every wave 1–20** from scratch: for each wave it copies the width + power of the procedural threat boards (the **tuned enemy curve** — the "power banding" anchor), then fills that shape with real tribe cards stat-scaled to hit it, cycling the 5 tribes for synergy variety (`synthesizeWaveFromCurve` in `synthesize.ts`). No bot, no real seed — opponents only need the right *strength*, not buildability, and the cardIds carry real keywords/effects. Tagged `origin:'synthetic'`. |
| **Import (optional)** | Finishing a run auto-captures per-wave boards to localStorage (`ascent.boards`); Export / Import via **Esc → Shared Boards**; drop exports into `docs/board-exports/` to commit them. Imported real boards are **preferred over synthetic** during curation, so the pool faces people wherever player data exists. |
| **Rate + band** | `npm run pool` builds the wave ladders (procedural curve + imports), rates every board wave-relative, and prints a per-wave **band coverage** report (`wN:count[bMin–bMax]`). |
| **Prune stale** | `npm run pool:prune -- --before <YYYY-MM-DD>` / `--patch <id>` / `--no-patch` filters `docs/board-exports/*.json` (add `--dry-run` to preview); then `npm run pool` to re-bake. In-app: **Esc → Shared Boards → Clear my boards** wipes your localStorage captures. |
| **Regenerate (per patch)** | Bump `package.json` version → (optionally `npm run pool:prune`) → `npm run pool`. Tune the knobs in `build-pool.ts`: `SYNTH_PER_WAVE` (boards/wave, the 5–8 band), `MAX_WAVE` (wave horizon), `PROC_SEEDS` (finer power spread to sample + a denser rating ladder). |

### "Competitive enough to be fun"

Synthesis anchors each wave's boards to the **tuned enemy curve** and spreads `SYNTH_PER_WAVE` of them across
that wave's power band (weak-for-wave → a notch above the curve), so every wave ships a full weak→strong
spread by construction — no wave is a free win or an unwinnable wall, and there are no thin/empty high waves
(the bot's old failure). The per-wave `count[band span]` line is the QA cue: it should show ~8 boards spanning
several bands at every wave. To make the late game *harder* than the designed curve, raise the power jitter in
`synthesizeWaveFromCurve` or import strong real boards (which the ladder + curation both prefer).

## Calibration notes

- **Ceiling + coverage — solved by construction.** The ladder and the synthetic boards both derive from the
  procedural enemy curve, which is wave-scaled for all 20 waves, so there are no thin/empty/saturated high
  waves (the bot's old `w12:b7–b7` failure). Each wave ships ~8 boards across several bands.
- **No bot, no real data needed.** Synthesis builds boards directly from the card set scaled to the curve, so
  a brand-new top wave is covered immediately — no need for someone to play it first. Synthetic opponents only
  need the right *strength* (the cardIds carry the real keywords/effects), not buildability.
- **Imports still welcome.** Dropping real exports into `docs/board-exports/` folds them into the ladder
  (raising the ceiling) and into the pool (preferred over synthetic in curation), so the pool faces people
  wherever player data exists. They're an *enhancement* now, not a prerequisite.
- Bands are **curation/QA only** — not yet wired into live matchmaking (`pickOpponent`), which still matches by
  wave + `Σ(atk+hp)` power. That's the roadmap follow-up.

## Key files

- `packages/sim/src/rating.ts` — `buildWaveLadders` (procedural-curve + optional bot/real ladders), `rateBoardForWave`, `ratingBand`, `BAND_COUNT`.
- `packages/sim/src/synthesize.ts` — `synthesizeWaveFromCurve` (from-scratch, curve-banded boards — the pool's primary source); `mutateBoard` / `synthesizeForWave` (legacy: recombine real boards).
- `packages/sim/src/threats.ts` — `buildEnemyBoard` / `enemyScaling` (the tuned enemy curve the bands anchor to).
- `packages/sim/src/snapshot.ts` — `BoardSnapshot` (`patch`, `rating`, `capturedAt`, `origin`, …) + `buildBootstrapPool` / `autoplayRun` / `BotOptions` (the legacy house bot).
- `packages/tools/src/build-pool.ts` — `npm run pool` (synthesize → rate → curate → coverage report).
- `packages/tools/src/prune-pool.ts` — `npm run pool:prune` (date / patch prune of imports).
- `packages/ui/src/boardLibrary.ts` — capture / export / import / `pruneStoredBoards` / `clearStoredBoards`.
- `packages/sim/src/opponents.ts` — `pickOpponent` (live matching: wave + `Σ(atk+hp)` power).
