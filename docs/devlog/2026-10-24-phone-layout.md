# 2026-10-24 — Phones: the desktop game, zoomed, every piece in its housing (R-PHONE-ZOOM-01, R-PHONE-HAND-01)

**Ask (owner 2026-10-23).** Make the phone layout, sizing and UI good, using Hearthstone's mobile layout as a blind
comparison: a critic agent that never saw our code graded screenshots each round, and the loop ran until it passed. Hard
limits: phones only (landscape), desktop pixel-identical, reuse the existing UI, no code-drawn props, transform/opacity
animation only.

**What shipped.**
- `stage.ts`: on a phone in landscape, in a run, `fitStage` zooms past the plain fit as far as the HOUSED span allows
  (`PHONE_HOUSED_SPAN`, `PHONE_ART_BOTTOM`, `PHONE_SIDE_GAP`): every piece that sits in a painted housing of the board
  art stays exactly at its desktop seat and inside the safe area, and the 16:9 box is placed so that span is centred.
  One framing for shop and combat, so nothing moves between phases. It writes `data-phone-zoom` and the `--pz-*` box
  offsets; `touchUi.css` carries them to the pieces positioned off the screen edges instead of the box.
- The hand (R-PHONE-HAND-01): the real desktop cards, badges and spacing unchanged, resting low with their plates
  running off the bottom edge. A finger on a card (`touchInput.ts` marks `.tt-press`, and `.tt-handpress` on the body
  so no `:has()` is needed) pops it up 1.75x, whole and on screen, clear of the hero ring and power.
- The Runeforge: its scrim moves to a pseudo layer that overhangs every edge, so the whole screen dims as on desktop;
  its frame keeps one proportion on every phone; wider cards, a shorter art band and bigger rules text (it reads at the
  Shop's Tier / Freeze label size).
- Smaller pieces: minions 6% larger in their rows (uniform, internals untouched), the lobby rail wider with bigger
  names, round summary and Skip / Summary a size up, the Discover Peek under the cards, hero select spacing.
- Phone diagnostics (dev only) keep the switches: `nophonezoom`, `pz125` / `pz135` / `pz145`, and `phonelayout`.

**How it got here (the rounds).**
1. Rounds 0-2 built a custom 2:1 phone composition (`phoneLayout.css`). Owner verdict: "just take the normal game's
   21:9 and zoom it slightly". It is off, kept only behind the `phonelayout` diagnostics switch.
2. Zoom variants 1.25 / 1.35 / 1.45x, then "bake the ui elements into place": every housed piece exactly in its
   housing, measured per round as a phone-vs-desktop housing table (box coordinates, max centre offset 4-6 px, the foe's
   name plaque).
3. The critic loop (baked1..baked8): safe-area margins, help row and rail at their desktop corners, the Runeforge
   full-bleed and readable, the timer and Health plate back at their desktop seats, one framing for both phases (it
   costs shop zoom: iPhone 15 Pro 1.09x, Pixel 8 1.03x over the plain fit).
4. The hand went through tucked (plates hidden) to "Show the full plate" to the final ruling: rest low, pop up cleanly
   when highlighted, and "move the badges back to normal". Lesson: keep card internals identical to desktop; the phone
   gets placement and a pop, never a re-laid-out card.
5. Owner on baked8b: "Looks solid to me".

**Gotchas.**
- Vite's hover guard (`apps/web/hoverGuardPlugin.ts`) moves every `:hover` rule into `@media (hover: hover)`, so a
  touch rule that lists `:hover` silently never applies on a phone. Key touch states off a class instead.
- `R-PERF-TOUCH-HAS-01`: no `:has()` outside the touch media query; the hand pop raises the hand zone with a body
  class.
- `--ch` / `--cw` resolve on `:root`; a size change has to be re-declared on the zones.
- A phone's CDP touch emulation leaves a long-press running if the touch is never ended; the capture tools release
  every press and close Inspect after a pop shot.
