# 2026-10-22: Hand-buff pile-up (Cave Cutter with both Choose One effects)

Owner report (240 Hz, dev server): "when a cave cutter is played with both effects active it nukes performance".
Owner approved the fix plan ("yeah do it"). Branch `perf/hand-buff-pileup`. R-PERF-HANDBUFF-01.

## The chain

Unbroken Vein makes Cave Cutter grant both halves: +2/+1 to your Rubies AND 4 Rubies. One play then fires the
`hand-buff` def (two shard bursts, 96 particles, plus a `react` layer that pops the card) from TWO watchers in
`Recruit.tsx`: the `rubyPowerFxSeq` watcher (`fireHandBuffOnHandRubies`, every Ruby in hand, the 4 new ones included)
and the shop hand diff (`diffHandBuffs`, every held Ruby whose printed value rose). So each held Ruby popped twice,
100 ms apart: up to 12 plays and 1,152 hand-buff particles live at once, bounded only by the 1,500 shop cap. The
Unbroken Vein hands out a Cave Cutter every turn, so three of them gild, and the triple's `gild-trail` (3 x 344
particles) lands on top. That is where the report's `fx:def:gild-trail` came from.

## What actually cost the frames

Not the particles. Measured on the prod bench build (headless Chrome, RTX 4080, uncapped frames, 8 hand-buff plays
fired at once on 8 hand cards):

| | frames over 6.25 ms | GPU raster | main thread waiting on GPU |
|---|---|---|---|
| as shipped | 78-83 | 1.3 s | 0.68 s |
| same particles, no card pop | 3-5 | 0 | 0 |
| pop with `will-change: transform` | 9 | 0.02 s | 0.07 s |

The `react` layer writes each pop's playhead from JS every frame (by design: it rides the player's clock), so Chrome
cannot run it on the compositor, and a scale changing from the main thread makes Chrome re-raster the element at
the new scale every frame. Eight hand cards doing that saturated the GPU process, and the WebGL overlay then blocked
on it, which is why the HUD blamed `fx:render`.

## What shipped

1. **One live cue per card.** `playDef` takes `dedupeKey` + `coalesceMs`; `fxBudget.admit` drops a same-key fire
   younger than the window (same moment) and otherwise retires the older play (refresh). `handBuffFx` keys by card
   uid with a 300 ms window (just past the pop's 224 ms peak). The double fire from the two watchers is now one pop.
2. **Per-def live particle budgets** (`DEF_PARTICLE_BUDGETS`, `fxBudgetConfig.ts`): `hand-buff` 300, `gild-trail`
   1,100. Across calls; over it the incoming play is thinned to the headroom (floor `MIN_DEF_SCALE` 0.2) and its
   shards live shorter (`defLifeScale`, 0.6 to 1); only if even the floor does not fit is the oldest same-def play
   retired. Wired into the existing `admit` (same registry, counters `fx:thinned` / new `fx:deduped`).
3. **Fan share.** `FAN_PARTICLE_BUDGETS['hand-buff'] = 300` (the existing `fanBudget.ts`, same as Gasket): one
   fan-out over N cards splits evenly, 1 to 3 cards as authored.
4. **Gild trail** keyed per gilded card + copy; held by its 1,100 budget (one gild is 1,032, untouched).
5. **`react` primitive.** Skips a playhead write when the clamped time has not moved (a finished or not-yet-started
   beat costs nothing per frame), and while two or more whole cards pop at once each gets `will-change: transform`
   for its pop, with its previous inline value restored after (`PROMOTE_AT`). A lone pop is untouched.

## Measured (prod bench, Cave Cutter + Unbroken Vein, hand of 8 Rubies, 6 runs each, interleaved, medians)

| | before | after |
|---|---|---|
| peak hand-buff particles | 768 (1,152 on a cold first run) | 296 |
| peak FX particles | 1,037 | 565 |
| frames over 6.25 ms | 104.5 | 40 |
| frames over 4.17 ms | 170.5 | 94 |
| worst frame | 90 ms | 21 ms |
| p95 / p99 frame | 1.7 / 9.7 ms | 1.1 / 4.5 ms |
| GPU raster in window | 1.51 s | 0.61 s |
| main thread blocked on GPU | 0.77 s | 0.38 s |

Three Cave Cutters back to back (a triple, its gild, and the Discover it opens): frames over 6.25 ms 120 -> 87,
over 4.17 ms 253 -> 215, p95 6.2 -> 4.7 ms, p99 12.0 -> 9.0 ms. The worst frame there is the Discover opening
(135-394 ms in both builds, noisy run to run); this work does not touch it.

A lone hand buff: the same 96-particle, 1-filter play in both builds (bench `livePlays`), `admit` returns scale 1 with
no life change (the def reaches the player by identity), and a lone pop gets no `will-change`. The pixel frame grid
could not be made deterministic headless (a stopped Pixi ticker is not what the screenshot captures), so that check
rests on the unit tests rather than on images.

## Dev-only spikes in the owner's report

`DevMenu` is behind `import.meta.env.DEV` in `Game.tsx` (lazy import), and the prod bundle contains neither
`DevMenu` nor `devmenu-btn` in any JS chunk, so its module load and button hover long tasks cannot happen for
players. Only its CSS rules ship (unused selectors, harmless).

## Harness

Scratchpad, not in the repo: a CDP driver like `scripts/phone-play-memory.mjs` (static server, every non-local
request blocked), `VITE_PERF_BENCH=1` prod build, `newRun(424242)`, a hand of Cave Cutters + Rubies with
`runeUnbrokenVein`, then `play` + `chooseOne`. Frames are rAF deltas; the Pixi ticker is driven from the same rAF so
the FX layer is timed per frame; GPU numbers come from a `Tracing` capture of the window.
