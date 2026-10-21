# 2026-10-21 — Versus spectators: no box, a hand

Owner on #2196's bench: "versus spectator area looks terrible. clean that up". Rule R-VERSUS-ROOM-STANDS-01
(`packages/rules/src/registry/approved/foundation.ts`), pinned by `packages/ui/src/versus/versusRoomPolish.test.tsx`.

Three variants were rendered at 1920x1080 with 1 and 5 spectators (a local-only mock room in the store, no backend):
A, no box with a contact shadow under each card; B, the shop hand's treatment; C, a full-width floor gradient over the
bottom 20%. B shipped: it is the game's own hand language (the shop hand has no tray, its cards sit flat with
`--fan-rot: 0deg` on the hover drop shadow), so the spectators read as "a hand" without any new element. A's contact
shadow read as a smudge on the blurred floor; C barely differed from the existing vignette.

- `.vsbench::before` (the navy band) is gone.
- `--vsb-tilt: 0deg`, `--vsb-arc: 0px`: one flat baseline. `--vsb-step` is 0.9 of a plate (was 0.96), a light overlap
  that keeps every Attack / Health pill visible. The hover pads read the same vars and still cover the popped card
  (measured: pad 588 to 822 over the popped plate 590 to 1053; a hand travelling up from the fan stays on it).
- Each bench plate wears the shop hand's hover shadow (`drop-shadow(0 9u 20u rgba(20, 12, 4, 0.42))`), static.
- The "Spectators n / 20" pill stays centred on the row just above the cards.
