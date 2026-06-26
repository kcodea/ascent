# Board pool — power banding, patches, and the regeneration lifecycle

Enemy boards are real, buildable `BoardSnapshot`s — captured player/friend boards + house-bot boards —
served back as opponents (`pickOpponent`). This doc defines how we measure their strength (**power
banding**), stamp them with a **patch**, **prune** stale ones, and **regenerate** a competitive pool when
the meta shifts.

## Power banding — wave-relative strength

A board's strength only means something **relative to its wave**: a 7-wide board that's strong at wave 3 is
weak at wave 15. So `rateBoardForWave(board, wave, ladders)` (`packages/sim/src/rating.ts`) scores a board by
the **fraction of its OWN wave's calibration ladder it beats** (win = 1, draw = 0.5) → a 0..1 rating;
`ratingBand` then buckets it into `BAND_COUNT` (8) bands. **Band 0 = weak-for-the-wave, band 7 =
strong-for-the-wave.**

- **The ladder** (`buildWaveLadders`): per wave, a set of reference boards spanning weak → strong **current**
  play — the smart bot (`buildBootstrapPool`) at rising `fidelity` (0.2…1.0) **plus the real imported boards
  folded in**, which give the high-wave ladders a real **ceiling** (the bot alone tops out below skilled play).
  Synergy-aware, deterministic, and rebuilt from the live card set every bake, so **per patch it
  self-recalibrates.** (Unservable boards are skipped so a stale cardId can't break ratings.)
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
| **Generate / capture** | House boards: `npm run pool` runs the bot. Your boards: finishing a run auto-captures per-wave boards to localStorage (`ascent.boards`); Export / Import via **Esc → Shared Boards**; drop exports into `docs/board-exports/` to commit them. |
| **Rate + band** | `npm run pool` builds the wave ladders, rates every board wave-relative, drops boards below the competitive floor, and prints a per-wave **band coverage** report (`wN:count[bMin–bMax]`). |
| **Synthesize** | `npm run pool` tops up **thin** waves: it mutates/recombines the real boards at that wave and validates each candidate to band ≥ floor via `simulate`, tagging keepers `origin:'synthetic'` (`synthesize.ts`). This is how high waves — where the bot can't build strong boards — get a competitive count + a full band spread. Knob: `SYNTH_TARGET_PER_WAVE` in `build-pool.ts` (0 = off). |
| **Prune stale** | `npm run pool:prune -- --before <YYYY-MM-DD>` / `--patch <id>` / `--no-patch` filters `docs/board-exports/*.json` (add `--dry-run` to preview); then `npm run pool` to re-bake. In-app: **Esc → Shared Boards → Clear my boards** wipes your localStorage captures. |
| **Regenerate (per patch)** | Bump `package.json` version → `npm run pool:prune -- --before <patch date>` (or `--no-patch`) → `npm run pool`. Tune the knobs in `build-pool.ts`: `HOUSE_SEEDS` (more boards), `FLOOR_BAND` / `FLOOR_FROM_WAVE` (how aggressively weak boards are dropped). |

### "Competitive enough to be fun"

Two levers keep mid/late fights competitive: the bake **drops** boards below band `FLOOR_BAND` (default `1`)
at waves ≥ `FLOOR_FROM_WAVE` (default `4`) so they're never a free win, and **synthesizes** new boards to top
thin waves up toward `SYNTH_TARGET_PER_WAVE` (default `16`). Early waves keep the full range (winnable fights
are good onboarding). The per-wave `count[band span]` line flags any wave that's still all-weak — the cue to
regenerate or import stronger boards.

## Calibration notes

- **Ceiling — solved.** The ladder folds in the real captured boards, so its high-wave ceiling reflects real
  play, not just the bot. (The bot alone tops out below skilled play, which used to saturate every high-wave
  board to band 7 — `w12:b7–b7`. With real boards in the ladder, the bands spread across the full range.)
- **Synthesis needs real data.** A wave with no real board to learn from can't be synthesized. Every current
  import reaches wave 20, so this isn't a gap today — but a brand-new top wave would stay thin until someone
  plays it. Synthetic opponents only need the right *strength* (validated by `simulate`), not buildability.
- Bands are **curation/QA only** — not yet wired into live matchmaking (`pickOpponent`). That's the roadmap
  follow-up, now unblocked since the ratings are trustworthy across all waves.

## Key files

- `packages/sim/src/rating.ts` — `buildWaveLadders` (bot + real-board ladders), `rateBoardForWave`, `ratingBand`, `BAND_COUNT`.
- `packages/sim/src/synthesize.ts` — `mutateBoard`, `synthesizeForWave` (recombine real boards + validate to band).
- `packages/sim/src/snapshot.ts` — `BoardSnapshot` (`patch`, `rating`, `capturedAt`, `origin`, …) + `buildBootstrapPool` / `autoplayRun` / `BotOptions` (the house bot).
- `packages/tools/src/build-pool.ts` — `npm run pool` (bake → rate → floor → coverage report).
- `packages/tools/src/prune-pool.ts` — `npm run pool:prune` (date / patch prune of imports).
- `packages/ui/src/boardLibrary.ts` — capture / export / import / `pruneStoredBoards` / `clearStoredBoards`.
- `packages/sim/src/opponents.ts` — `pickOpponent` (live matching: wave + `Σ(atk+hp)` power).
