# 2026-09-21 — Rank screen: the demotion effect (`down-rank`)

Owner ask: "add this effect to when you down rank." The owner authored `down-rank` in the FX workbench
(`packages/ui/src/fx/defs/down-rank.json`, params verbatim — 900 ms: a `shockwave` off the crest at 60 ms, a
141-shard blue→orange `burst` falling under gravity at 90 ms, and a `sound` layer at 0 ms playing the imported
clip `fx/downrank` — `packages/ui/src/audio/fx/downrank.mp3`, bundled through `sfx.ts`'s `audio/fx/*.mp3`
glob — trimmed to its 130 → −750 ms window on the `combat` bus). This wires it in as the down twin of
`rank-up`.

## What changed

- **`rank/rankTimeline.ts`** — the `transition` step's DOWN branch now mirrors the up branch's shape: at the
  beat start the OLD crest's screen centre is read ONCE (`crestCentre`, never per frame) and
  `playDef('down-rank', …)` fires behind `canPlayDefs()`; the old crest HOLDS while the shockwave leaves it;
  at `RANK_DOWN_HIT_MS` (= 90, the burst's `at`) `swap()` runs, the old crest drops and shrinks out
  (transform + opacity only), the new crest settles in from slightly small, the label / bar / points restore,
  and the beat pads to the def's full 900 ms (`RANK_DOWN_FX_MS`) so the shard fall is not cut off. Every
  `direction: 'down'` transition takes it — the plain division demotion AND the lost demotion game's medal
  drop. **No cue fires**: the def's own `sound` layer is the sound (there is no demotion cue in
  `RankTimelineCues`, and `cues.hit` is the promotion clang). With no canvas (`playDef` declines) the same
  hold → drop → replace plays without particles, which is the fade-and-replace fallback. The play sits inside
  a `.call()`, so a skip (`progress(1, true)` suppresses callbacks) never starts it and stays silent.
- **`rank/rankSequence.ts`** — `RANK_BEAT_MS.transitionDown: 900` replaces the 550 ms `transition` for both
  demotion plans (a demotion now runs 3400 ms; the budget test's window is 2200–3500).
- **The def carries `"slot": "above"`** (added — it was the one thing `rank-up` had that the workbench
  export lacked): the rank overlay (z400) covers the `over` canvas, and only the above-modal canvas is lifted
  over the screen by `body:has(.heroselect.rankend) .pixifx-above { z-index: 470 }`. Without the slot the
  effect would draw under the screen and never be seen.
- **Registrations**: `fx/directCalls.ts` (`'down-rank': ['rank/rankTimeline.ts']`), the
  `directCalls.test.ts` allow-list, a `playDefUids.test.ts` unit-less entry (crest-anchored, no run, no unit)
  and `defs.test.ts`'s above-modal inventory. The DEV "🎖️ Rank Screen" preview already mounts `PixiFxLayer`
  from the title, so the `demotion` and `demo-lost` fixtures exercise it with no further change.
- Patch note (2026-09-21, UI / Info).

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` — see the PR. Not verified here: the
browser (the play + sound was not watched in this session); the owner should hit `demotion` and `demo-lost`
in the DEV Rank Screen panel.

## Noticed, not changed

The up branch's `fxPlayed.v ? 0.05 : 0.18` crest-out duration is read when the timeline is BUILT (before the
`.call()` that sets it), so the promotion's "snap when the FX played" is always the 0.18 s cross-fade. The
down branch deliberately does not branch on it. Worth a one-line fix in its own PR.
