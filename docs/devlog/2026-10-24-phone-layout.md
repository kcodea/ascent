# 2026-10-24 — Phones: the desktop game, zoomed, every piece in its housing (R-PHONE-ZOOM-01, R-PHONE-HAND-01, R-PHONE-MENUS-01)

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
  so no `:has()` is needed) pops it: `touchInput.ts` measures the card once on the press (`popGeometry`, layout offsets,
  never per frame) and writes `--pop-s` / `--pop-tx` / `--pop-ty`, so the whole card fills ~95% of the safe height, its
  foot just above the bottom edge, nudged inward at the ends. On a zoomed phone `.app`'s stacking context is dissolved
  for good (desktop does the same while hovering a hand card): toggling it per press cost ~3 dropped frames a press.
- Board badges (owner: "Move the attack and health badges in slightly so they don't overlap on board"): on the Shop,
  your board and both combat rows Attack / Health step in `0.03 * --ccw` (`--pz-badge-in`), ~5 px clear of neighbours.
- Framing: one framing for shop and combat (the hero ring and help row never move between phases), the foe's name
  plaque 6 px from the top and the Health plate raised 20 box px onto the ring's rim (the hero is drawn at 3.1x, so the
  CSS lift is 6.5 local px): +4% zoom over the round-8 framing. The lobby rail sits at the right safe edge, higher.
- Menus (R-PHONE-MENUS-01, owner: "Make sure all menus look good too"): the menu, Settings and Practice rules the
  retired composition had taken through the critic are keyed to every phone (`--touch-p: 2.1`), the modal panels (Patch
  Notes, Report a Problem, the Compendium, the spectator end notice) zoom 1.7 to 2.1 with their viewport caps divided to
  match, and the Leaderboard podium, Recent Games, Versus, Gauntlet and Practice are fitted. The Rules search no longer
  focuses itself on a touch device (it raised the keyboard over the page).
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
6. Then: the board badge inset, a very large pop ("it should be very large", then "pop less vertically and just make the
   pop larger"), the rail to the right edge and +4% zoom (asked +5-8%; the vertical span is bound by the foe's name
   plaque and the Health plate, so 4% is what fits with every housed piece on screen), and the menus pass, each judged by
   the same blind critic until it passed.

**Perf (prod bench build, emulated, 4x CPU throttle, vs main).** Shop idle and combat match main. A drag matches main on
iPhone; on Pixel its p99 is ~46 ms vs ~35 ms (12-13 frames over 17 ms vs 6-9) because the zoomed stage rasterises more
pixels (with `?phonediag=nophonezoom` it matches main). A hand press costs about one dropped frame (max ~55-62 ms at 4x).

**Gotchas.**
- Vite's hover guard (`apps/web/hoverGuardPlugin.ts`) moves every `:hover` rule into `@media (hover: hover)`, so a
  touch rule that lists `:hover` silently never applies on a phone. Key touch states off a class instead.
- `R-PERF-TOUCH-HAS-01`: no `:has()` outside the touch media query; the hand pop raises the hand zone with a body
  class.
- A position-fixed element inside a `zoom`ed ancestor (the lifted text field inside the zoomed Compendium) is placed in
  that ancestor's zoomed units; `touchKeyboard.ts` already probes its containing block, but stacking stays the
  ancestor's, so the Compendium frame hides while a field is lifted.
- `--ch` / `--cw` resolve on `:root`; a size change has to be re-declared on the zones.
- A phone's CDP touch emulation leaves a long-press running if the touch is never ended; the capture tools release
  every press and close Inspect after a pop shot.
