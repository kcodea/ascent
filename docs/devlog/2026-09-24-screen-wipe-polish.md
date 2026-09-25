# 2026-09-24: Screen wipe, round 2 (smoother on ultrawide, no bleed-through)

Owner, after playing #1707 on the ultrawide (verbatim): *"the screen wipe still isnt perfect, can you make it
smoother/wider/cleaner so that there's no jank on an ultrawide? also sometimes background elements come through the
wipe or it flickers, not sure what's causing it"*. Round 1 is `2026-09-24-screen-wipe-ultrawide.md`.

## Bleed-through / flicker: root cause

Reproduced by playing real lobby rounds in headless Chrome (CDP, real mouse clicks on the gem) with an injected
scanner. Every 40 ms while the curtain covers, it lists each visible element whose root stacking context under
`<body>` outranks the z250 curtain. Before, every run had 5 to 8 records, all from two sources:

1. **The loss-damage tally** (`.lossdmg` z2000, `.lossfly` z2001). It animates while the fight is still ending. The
   End Combat click starts the exit bloom straight away, so a tally still flying floated ON TOP of the blue for the
   whole bloom.
2. **The lobby damage float** (`.lobbydmg-float` z2000, "-N" over the seat you hit). It fires when
   `lobby.round` changes, and the round settles in `resolveCombat`, which is deliberately dispatched at
   `coveredOut`, the full-blue hold. So the float popped onto the curtain mid-hold, over a rail that is not
   visible yet.

Both are "background elements coming through" and, since they pop in and out over a flat blue, read as a flicker.
Also found, not reproduced: the hover layers above the curtain's z (`.cardref` / `.castprev-layer` z460, `.gtip`
tooltips z600) would do the same when the cursor rests on a card or a control through the transition. And the
wipe FX Pixi canvas stopped without rendering its empty stage on `clear()`, so the next wipe's first visible frame
could flash stale motes.

The curtain itself was verified continuous. Its computed clip was sampled every 25 ms across both swaps, and the
backdrop only flips on the `full settle` holds (now pinned by `wipeMachine.test.ts`).

**Fix:**
- Recruit mirrors `wipeUp(wipe)` (tell → end of reveal) onto `body.wipe-up`.
- CSS drops the z2000 floats to z240 under it and hides the hover layers. Outside a wipe the floats keep z2000,
  which clears the replay bar (owner report 2026-08-19).
- `lobbyDamageFx.whenCurtainDown` holds the float until the class clears (MutationObserver, 6 s give-up).
  LobbyPanel's pending float survives re-renders.
- `wipeFx.clear()` renders the empty stage before hiding.

After: **0 scanner records** at every size, including 5-round runs with a lost round.

## Smoother / wider / cleaner

- **Ellipse.** The bloom is an ellipse stretched by `(aspect / 16:9) ^ stretch`, which is 1 on 16:9 and narrower, so
  16:9 is still a circle. On 21:9 (×1.34) and 32:9 (×2) it reaches the sides with the top and bottom, instead of
  covering the height early and then spending its tail crawling across a thin side strip. Cover math:
  `wipeCoverEllipse` (squash x by the aspect, farthest corner, stretch back).
- **Tail.** The easing is now `cubic-bezier(0.45, 0, 0.7, 0.85)`: it eases in out of the gem and is still moving at
  full cover. The old `(.4, 0, .2, 1)` spent its last ~40% of time on the last ~10% of the radius, which on a wide
  screen is exactly the visible far edge. Durations are unchanged (450 ms bloom, 900/700 ms holds, 450 ms reveal).
  The reveals keep the old ease-in-out.
- **Double-layer edge.** The ring texture's stops come from vars. A glow rises inside the seam to the bright line,
  which is put ON the seam per axis (`--wipe-front-sx/sy`), and a soft halo fades out beyond it over the old
  screen. The vars are fixed per wipe, so the texture rasterises once and only its transform animates.
- **Dev tuner "Screen wipe"** (🌀, `screenWipeConfig.ts`): cover, reveal, charge and hold durations, the four
  bezier handles (the tail is `easeY2`), the wide-screen stretch, and the ring's position, width, brightness and
  halo. Baked defaults in `WIPE_DEFAULTS`. ▶ Play runs the real classes over any screen via `WipePreview`
  (dev only, z9000 so it also shows over menus). It is registered in `tunerAll` for Reset all.
- **Refactor for testability:** the state machine's class and transition rules moved out of Recruit into
  `wipeMachine.ts`, and Recruit and the preview both use it.

Compositor-only rewrite: measured, not needed. The worst frame in any sweep, headless on the same PC's RTX 4080
Super, per rAF:

| size | cover-in | reveal-in | cover-out | reveal-out |
|---|---|---|---|---|
| 3440x1440, before (5 rounds) | 8.4 | 12.5 | 8.5 | 4.3 |
| 3440x1440, after (5 rounds) | 8.4 | 4.3 | 12.5 | 4.3 |
| 5120x1440, before (5 rounds) | 12.6 | 12.5 | 8.4 | 4.3 |
| 5120x1440, after (5 rounds) | 16.8 | 4.3 | 16.7 | 4.3 |

No frame over 25 ms in any sweep, before or after. Two frames at 16.8 ms across 448 at 5120x1440. The long frames
(50-95 ms) are all in the covered holds, where the scene swaps under full blue by design. So `clip-path` (a
sanctioned one-shot) stays; the jank the owner saw was the geometry (crawl), the ring (round 1) and the bleed.

## Tests

- `wipeGeometry.test.ts`: the ellipse covers all four corners at 7 viewports × 8 anchors × 4 stretches; the ring
  line sits on the seam per axis; the ellipse is a circle on 16:9; it reaches the sides earlier than the circle on
  ultrawide; the bezier evaluator.
- `wipeMachine.test.ts`: the passes, the backdrop swapping only on holds, curtain continuity across the swap
  (`full` → `full settle` → `gone`, checked against the CSS), the tells snapping, the fronts, `wipe-up` span, the
  z rules keeping floats under the curtain and hover layers hidden, config sanitising, and every CSS var being read.
- `lobbyDamageFx.test.ts`: the float waits for the curtain, runs once it lifts, and can be cancelled or time out.

Oracle: R-PRESENT-15 amended (ellipse, tail, tuner), new R-PRESENT-17 (nothing paints over the curtain).
R-PRESENT-16 is taken on `fix/good-luck-sfx-tail`.
