# ASCENT — development log

Newest first. Each entry records **what changed and why**, plus how it was verified. The forward
queue lives in [roadmap.md](roadmap.md); high-level milestones in [../CLAUDE.md](../CLAUDE.md).

## 2026-07-05 (session 18)

### feat(ui): UNIFORM hand pop — anchor each card's bottom to one line (replaces the pop-fraction levers)

The hover-pop lifted a card by a fraction of its height, so cards of different heights (the text drawer varies —
a 62px spread across a spell vs a long-text minion in testing) ended at different bottom positions — never
uniform, which is why the previous pass needed separate spell/minion levers. The owner asked if a "point on the
bottom" could make it uniform. It can, with a clean CSS trick:

- **Bottom-anchored pop.** The hover transform is now `translateY(calc(-100% + var(--ch) * var(--hand-floor)))`.
  The `-100%` raises each card by its OWN height, so every card — spell or minion, short or long — lands its
  **bottom on the same line**; `--hand-floor` (a fraction of --ch) sets where that line sits. Verified across
  cards spanning 193–277px tall: their popped bottoms land within ~2px of each other (the residual is the 1.06
  scale pivoting from the fan's `center 42%` origin — imperceptible), flush ~6px above the play-field floor. Was
  a 58px spread, now ~2.
- **One lever replaces two.** `handPop` + `handPopSpell` collapse into a single `handFloor` in `dragFeel.ts`
  (reflected to `--hand-floor`, slider "hand pop floor" in the Drag Feel tuner, default 0.83). Since the pop is
  uniform by construction, spells and minions no longer need separate values. Dropped the per-card `--card-pop`
  resolution and the `.spellcard` override from `styles.css`. (Shipped default dialed to **0.94** by the owner.)

Verified live (throwaway `newRun` + mixed hand): a short spell (Gold Pouch) and a tall minion (Target Dummy)
both pop with their bottoms on the same line, full text on-screen, flush at the bottom, soft shadow (no glow).
`typecheck` + `lint` + `test` (483) + `build:web` green.

### fix(ui): spell frame glow softened on big cards + separate spell/minion hand-pop levers

Two owner follow-ups, presentation-only (`packages/ui`).

- **Spell "play-area glow" fixed.** A spell card carries a purple frame glow (`.card.spellcard` box-shadow,
  the demon-tribe hue) that's fine on the compact tile but reads harsh blown up on the full-size **floating
  drag card** (dragging a spell into the play area) and the **hover-reveal popup**. Dropped it in exactly those
  two contexts (`.dragcard .card.spellcard, .cardref .card.spellcard { box-shadow: none }`) — the drag card's
  wrapper drop-shadow / the popup's white haze already give the lift, and the gold willplay halo still signals
  "release to cast". Reproduced the purple halo on a lifted spell, confirmed it's gone with the rule. (The
  hover-POP was already clean — its `box-shadow: none !important` overrides the frame glow.)
- **Separate spell + minion hand-pop levers.** Spells carry different text lengths than minions, so they can
  want a different hover-pop rise. Split the `handPop` lever into `handPop` (minion) + `handPopSpell` (spell) in
  `dragFeel.ts`, reflected to `--hand-pop` / `--hand-pop-spell`. Each hand card resolves a single `--card-pop`
  to the right one by class (`.row.hand .card` → minion; `.row.hand .card.spellcard` → spell), and the one
  hover rule reads `--card-pop` — no duplication. Both sliders live in the Drag Feel tuner ("hand pop · minion",
  "hand pop · spell"). Verified independence: setting the spell lever to 0.15 gives a spell a 36px lift while a
  minion stays at 73px (0.3).

Verified live (throwaway `newRun` + planted spell): both CSS vars resolve on `:root`; spell vs minion
`--card-pop` track their own levers; the lifted spell shows no purple halo. `typecheck` + `lint` + `test` (483)
+ `build:web` green.

### feat(ui): hand hover-pop height is now a live DEV LEVER (`handPop`)

The hover-pop lift is viewport-sensitive (it's a fraction of `--ch`), so the "right" amount depends on the
player's resolution — no single hard-coded value satisfies everyone, and the owner still saw cards popping too
high. Made the lift a **live, dial-by-eye lever** instead of guessing pixels.

- New `handPop` key in the drag-feel config (`dragFeel.ts`): the hover-pop rise as a fraction of `--ch`, with a
  slider range `[0, 0.6, 0.01]`, a tooltip, and localStorage persistence like the rest of the tuner. Default
  nudged **0.35 → 0.3** (pops a touch less out of the box).
- `dragFeel.ts` now reflects the value onto the document root as the `--hand-pop` CSS var (`applyDragFeelVars()`,
  called on load + on every tuner change/reset), and `.row.hand .card:hover` reads
  `translateY(calc(-1 * var(--ch) * var(--hand-pop, 0.3)))` — so sliding the lever moves the pop **live**.
- Added the slider to the Drag Feel tuner (`DragTuner.tsx`, label "hand pop (×ch)"); also gave the previously
  label-less `collapseY` a name while there. Open it from the Dev Tuning Menu, drag "hand pop" until the card
  sits right, then "Copy values" to bake it as the shipped default in `dragFeel.ts`.

Verified live: `--hand-pop` resolves to `0.3` on `:root` after load; the `.row.hand .card:hover` transform reads
it; the forced-hover card shows its full text with the tribe line readable. `typecheck` + `lint` + `test` (483)
+ `build:web` green.

### fix(ui): the REAL "release to play" glow softened + hover-pop only lifts flush to the edge

Two owner follow-ups, presentation-only (`packages/ui/styles.css`).

- **The glow the owner was actually seeing.** Previous passes softened the hand HOVER glow, but the harsh
  bright-yellow halo the owner kept flagging was on a *different* element: `.dragcard.willplay .card` — the
  floating card while a hand minion is dragged **over the play area** (the "release here to play" signal). It
  used the exact same `box-shadow: 0 0 24px 7px rgba(255,226,110,.95)` as the old hover glow, which reads harsh
  and square-cornered blown up over the full-size dragged card. Replaced it with a soft GOLD **filter
  drop-shadow** (`drop-shadow(...202,80,.92) drop-shadow(...182,52,.5)`) that follows the card's arch alpha —
  a gentle "play here" halo that hugs the silhouette. Verified live: the lifted full card shows a soft gold
  glow around the arch, no hard box.
- **Hover-pop only rises flush to the bottom edge.** The hand hover-pop lifted the card `0.42·--ch`, floating
  it up with a gap between its bottom and the bottom of the play field. Measured the geometry (game bottom at
  y=900; card rest-bottom at 1013, i.e. tucked 113px below) and dialed the lift to `0.35·--ch` (scale 1.06),
  which lands the card bottom at y=899 — **flush with the edge (1px), zero floating gap** — with the full text
  still on-screen (top 591). Was a 14px gap, now ~0. Verified live (forced-hover screenshot): the popped card
  sits on the bottom edge, full rules text readable, nothing cut.

Verified live (throwaway `newRun`, 1600×900): dragged-into-play card shows the soft gold halo; the hover-pop
sits flush at the bottom with no gap. `typecheck` + `lint` + `test` (483) + `build:web` green.

## 2026-07-04 (session 17)

### fix(ui): buffs panel no longer pushes the board down + softer hover-pop shadow (owner follow-ups)

Two owner-reported regressions from the previous batch, both presentation (`packages/ui`).

- **The shop + board no longer shift down when buffs are active.** Moving the run-buffs window to the top-left
  last change put it in an IN-FLOW `.topleft` column alongside the round plaque — so once a buff was active the
  column grew taller than the plaque and, since `.bar` is `align-items: center`, the whole bar grew and shoved
  the tavern/board down (the owner's "shifted down dramatically"). Kept the window on the left but made
  `.topleft` **absolutely positioned** (mirroring `.topright`), floating just under the plaque (`top: 100% + 6u;
  left: 0`), so it contributes nothing to the bar's height. Verified: with buffs toggled on, the bar stays 48·u
  and the tavern top holds at y=207 (its original spot) — zero shift — while the buffs still render top-left,
  aligned under the plaque.
- **Softer hover-pop shadow (the "wrong glow").** When the hover-pop replaced the floating magnified preview,
  the popped in-hand card started inheriting the shared `.card:hover` treatment — a bright yellow box-shadow
  glow tuned for small, in-place shop/board cards. Blown up on the big popped card (and squaring off against
  the tall full-text card's arch radius) it read as harsh/wrong. The popped hand card now gets a soft dark
  **drop-shadow** instead (`box-shadow: none !important` + `filter: drop-shadow(...)`), which follows the card's
  alpha so it hugs the arch and reads as "lifted above the fan" — the same lifted look the old preview had.
  Shop/board hover glows are unchanged (only `.row.hand .card:hover` is overridden).

Verified live (throwaway `newRun`): toggling buffs leaves the tavern top + bar height unchanged; the popped
hand card shows a clean soft shadow, no yellow glow. `typecheck` + `lint` + `test` (483) + `build:web` green.

### polish(ui): roomier hand + hover pops the card itself + no pickup jiggle + buffs moved left

Owner follow-ups on the hand + HUD, all presentation (`packages/ui`).

- **A touch more room between hand cards.** Now that the hero panel shrank and the fan reads clearly, the
  overlap eased from `−0.5 ccw` → `−0.44 ccw` (a 10-card hand widened 882 → 936 px — still well clear of the
  hero frame).
- **The magnified hover preview is gone; the card itself pops up.** The floating `.handpreview` (a scaled 1.275
  crisp copy above the fan) read as too much. Removed it entirely — state, the hand-zone pointer handlers, the
  render, and the CSS. Hover now lifts the in-hand card itself up out of the tuck (`translateY(-0.42·--ch)`),
  straightens it, and scales it a gentle 1.08, so its own full text drawer reads in place. Verified the popped
  card lands fully on-screen (top 565, bottom 853 at 900×) and isn't occluded.
- **Pickup no longer jiggles the hand.** Grabbing any card (hand OR shop) made every hand card flick straight
  then re-fan. Cause: the drag-start slot measurement toggled a `.measuring` class that flattened the fan with
  `transition:none` to read upright rects — but REMOVING it restored the base `transition: transform`, so the
  cards animated flat→fan over ~0.12s on every pickup (confirmed: the transform sat at rotation 0 for ~4 frames
  then eased back). Dropped the flatten entirely: the reorder now measures the cards' rotated rects directly.
  The fan pivots near each card's centre, so the axis-aligned bbox stays centred on the card and the slot
  midpoints match the flat centres within a pixel or two — no measurable reorder cost, no jiggle.
- **Run-buffs window moved to the top-LEFT.** It used to sit under the opponent frame (top-right); it now
  stacks under the round/altitude plaque on the left (new `.topleft` flex column in `HudBar`, mirroring
  `.topright`). Verified: it renders at x=18 (aligned with the plaque), directly beneath it.

Verified live (throwaway `newRun` with a planted hand + seeded run buffs): hand ~936 px; no `.handpreview` in
the DOM; the `.measuring` rule is gone and a simulated pickup no longer animates the fan; forced-hover shows
the card popping up with full text on-screen; the buffs window renders top-left under the plaque. `typecheck` +
`lint` + `test` (483) + `build:web` green. (Hover-pop + reorder still want a real-cursor eyeball — `:hover` and
this drag system aren't drivable headlessly.)

### fix(ui): spell-target ghost card + board2c 16:9 art + fan no longer flattens on grab

Owner follow-ups, all presentation (`packages/ui`).

- **Spell-target "ghost card" fixed.** Dragging a targeted spell up to aim, then back down off the target,
  left a copy of the spell card stranded in the **top-left corner**. Root cause: the floating `.dragcard` is
  rendered only when NOT aiming (`!castingSpell`), and its transform is written imperatively by the weighted-drag
  rAF — but that effect's deps were `[drag?.active]` only. When `castingSpell` flipped true→false mid-drag the
  dragcard **remounted**, yet the rAF didn't re-run, so the fresh node never got a transform and sat at its
  default 0,0. Fix: hoisted `castingSpell` above the rAF effect and added it to the deps, so the effect re-runs
  on the flip, re-binds the remounted node, and writes its transform in the `useLayoutEffect` init **before
  paint** (no flash, no stranding). No change to normal minion drags (there `castingSpell` is always false, so
  the dep is stable).
- **New 16:9 board art `board2c`.** Replaces `board3upscaled` as the 16:9 default (`--board`; 21:9 unchanged).
  Converted `board2c.png` (1672×941) with `sharp` to an 86 KB webp at its native resolution (same res as the
  old `board2b`). The now-unused `board3upscaled.webp` was removed from `public/`. Preload list + comments
  updated; verified the URL serves `image/webp` and the board renders.
- **The fan no longer flattens when you grab a card.** The first fan pass flattened the WHOLE hand for the
  duration of a drag (`body.dragging` → `transform: translateY(tuck)`), so grabbing any card made every card
  snap straight and then re-fan on release — a distracting whoosh. That flatten is gone; the hand now stays
  fanned through the drag. Reorder correctness is preserved because the only flatten that remains is the
  **invisible** drag-start measurement (the `.measuring` class, added + removed inside one synchronous pass, so
  it's never painted — verified: it still reads clean upright 155 px slot rects). Cards parting to make room
  keep their tilt too (Card's inline reorder transform now composes `rotate(var(--fan-rot))`), so the fan just
  opens a gap. Verified live: hand cards stay fanned with `body.dragging` set; `.measuring` still flattens to
  155 px.

Verified live (throwaway `newRun`): board2c renders; the hand stays fanned during a simulated drag while the
measurement pass still flattens cleanly. `typecheck` + `lint` + `test` (483) + `build:web` green. The spell-drag
and reorder gestures themselves can't be driven headlessly (this drag system needs real pointer capture), so
those want a quick real-cursor eyeball.

### polish(ui): board3upscaled 16:9 art + a proper hand fan + Practice mirrors the Ascent course

Owner-directed batch of three. Mostly presentation (`packages/ui`); Practice parity also touches the run loop
(`packages/sim`).

- **New 16:9 board art (`board3upscaled`).** Wired `--board` (the 16:9 default, driving the in-game board +
  the hero-select / title backdrops) from `board2b.webp` → `board3upscaled.webp`; the 21:9 ultrawide art
  (`board2upscaled2.webp`) is unchanged. The source (`C:\Game Assets\…\board3upscaled.png`, 11636×6549, 49 MB)
  was converted with `sharp` to a 2560×1440 webp at q80 — **117 KB**, a real resolution bump over the old
  1672×941 board2b yet smaller on disk. Preload list (`art.ts`) updated to match. Verified live: the URL now
  serves `image/webp` (was Vite's 404→index.html fallback) and the board renders.
- **The hand now fans.** Each hand card carries a per-index tilt (`--fan-rot`, set from `Recruit` by its
  position: ±1.8°/card out from centre, capped ±7°) and rotates about a point near its own upper-middle
  (`transform-origin: center 42%`), so the cards splay like a held hand. Because they pivot near their centres
  (not a far-below point), the tilt reads as a fan **without** swinging the ends wide — so a deeper overlap
  (margin-left −0.48 → **−0.5 ccw**) genuinely narrows the hand: a 10-card hand went **970 → 882 px** wide
  (and now clears the hero frame by ~100 px). Critically, the fan **flattens during a drag** (`body.dragging`)
  and **instantly during the drag-start slot measurement** (a transient `.measuring` class with
  `transition: none`), so the reorder hit-testing always measures upright, axis-aligned 155 px cards — the
  rotated bounding boxes would otherwise inflate the slot widths (verified: measured widths are 188 px fanned
  vs 155 px flat; the `.measuring` pass reads 155). Hover straightens the card (`rotate(0)`). New `fanRot` prop
  on `Card`.
- **Practice mirrors the Ascent course.** Practice was a separate 15-round session that rendered a different
  HUD ("WAVE n", no round track, no Line). Per the owner it should read *identically* to a real run — the only
  differences being invulnerability + a longer clock. So Practice now runs the SAME course: `advanceCombat`
  ends it at `CONFIG.courseRounds` (17) instead of the now-removed `practiceRounds` (15), and the HUD drops its
  `!practice` gates — Practice shows `ROUND n / 17`, the per-round dash track, the record, the Setup label, and
  the Line, exactly like Ascent. The `ShopTimer` label also uses the shared "Setup Time"/"Time" logic. The one
  HUD difference that remains is the **`Max −X` loss row, still hidden in Practice** — it's the direct
  expression of invulnerability (no Resolve at risk). Unchanged: unlimited health (a loss costs 0 Resolve), the
  ×3 shop clock, and the unscored practice end screen. Stale "15-round" comments updated across sim/ui; the two
  practice round-count tests re-pointed at `courseRounds`.

Verified live (browser store, throwaway `newRun`): board renders; fan splays + narrows the hand (882 px) and
flattens cleanly for measurement + drag; Practice HUD reads `ROUND 8/17` + dashes + `Line 7` + record with
`Max −X` hidden, and the ×3 clock. `typecheck` + `lint` + `test` (483) + `build:web` green. Judgement call
flagged: hiding `Max −X` in Practice (rather than showing a moot value) is the one intentional HUD divergence.

### polish(ui): hand tier pills + compact 2×2 hero frame + per-round dash track

Owner-directed cleanup batch on the hand / HUD. Presentation-only — `packages/ui` (`instView.ts`,
`HudBar.tsx`, `styles.css`); no engine/content/sim changes.

- **Spells in hand now show their Tier pill.** `instView` (the board/hand `CardView` builder) hard-coded
  `tier: spell ? undefined : c.tier`, so a hand spell rendered its `SPELL` drawer but no `Tier N` badge —
  inconsistent with the shop (`shopView` always passes `tier: c.tier`) and with minions in the same hand.
  Changed to `tier: c.tier` unconditionally. `instView` also feeds board minions, but boards never hold
  spells, so this only affects hand spells (now badged like everything else). Verified: all 10 hand cards
  (spell at index 4 included) carry a `Tier 1` badge.
- **Un-clipped the hand card pills/outlines.** The earlier uniform-height pass put `max-height: var(--ch);
  overflow: hidden` on `.row.hand .card`, which cropped the Tier/cost pills (they overhang the card's top
  edge by ~9px) and shaved the rounded outline. Removed both — top-alignment now rests solely on the row's
  `align-items: flex-start` + the fixed `--hand-tuck`, so every card still tops out level but nothing is
  clipped (measured `overflow: visible`, badge sits 9px above the card top, fully drawn).
- **Hero frame → compact 2×2 grid.** The status-bar hero panel was a single 591px-wide row (portrait ·
  name/power · power button · Resolve) whose left third sat under a wide hand — with even 6 cards the
  left-most cards ducked behind it. Reflowed `.statusbar .hero` to `display: grid` with two columns
  (`auto minmax(0,1fr)`) and a fixed `232·--u` width; the existing DOM order (`.f`, `.htxt`, `.hpwrap`,
  `.hpbox`) auto-places row-major into portrait+name (top) / power-button+Resolve (bottom). The fixed width
  wraps the power line, which is where the added height comes from; power button and Resolve box shrank to
  suit. Net: **591×119 → 232×166** — narrow + tall, mirroring the opponent frame up top. Paired with a
  deeper hand overlap (`.row.hand .card` margin-left `−0.2ccw → −0.42ccw`), a full 10-card hand now clears
  the frame's right edge by ~59px (was ~3 cards overlapping).
- **Round meter → per-round dash track.** Replaced the single fill bar + calibration notch with one dash
  per course round (17): a win prints a green `✓`, a loss a red `✕`, a draw a muted dash, upcoming rounds a
  faint dash, and the current round a lit-orange dash. Setup rounds (1–2) read at 0.6 opacity with a small
  gap after round 2 (preserving the old notch's "scored climb begins here" cue). Hidden in Practice
  (endless — no fixed course). Reads `run.history[i]` (round i+1's `CombatOutcome`) + `run.wave`; pure
  derived render, no per-frame work. Verified colours via computed style (`#f0902e` current, green wins,
  raspberry losses) and glyph/opacity per round state.

Verified live (browser store, throwaway `newRun(777,'nadja')` with a planted 10-card hand incl. a spell,
and a simulated mid-run `wave 8` history): tier badges on every hand card, no pill/outline clipping, hand
clears the hero frame (+59px), 2×2 frame lays out clean (portrait/name top, power/Resolve bottom), dash
track renders ✓/✕/dash/orange correctly. `typecheck` + `lint` + `test` (483) + `build:web` green.

## 2026-07-04 (session 16)

### feat(ui): HUD restyle to the mockup — segmented stat strip + control tray, warband under the centre line

Owner-directed restyle of the recruit HUD to match a provided mockup, **keeping the three card rows
(tavern / warband / hand) in place**. Presentation-only — `packages/ui` (`Recruit.tsx` + `styles.css`); no
engine/content/sim changes.

- **Segmented stat strip.** The Gold display, Shop-tier plaque, and turn Timer — three separate plaques
  before (Gold in the action row; Shop-tier + Time spread across an info row) — merge into ONE gold-trimmed
  cream strip with thin divider rules: `Gold · Tier · Setup Time`. New `.statstrip` / `.statcell` CSS;
  `ShopTimer` renders a `.statcell time` (still the isolated per-second subscriber, so the tick never
  re-renders the card tree) and takes a `label` prop ("Setup Time" on calibration rounds, else "Time"). The
  gold cell keeps the `.gold` hook the sell-coin FX anchors to (query updated `.shopbtn.gold` → `.statcell.gold`).
- **Action control tray.** Upgrade Tavern · Reroll · Freeze · End Turn group into one recessed, gold-edged
  tray (`.shoprow.actiontray`) with warmer tan-gold button fills, a clearly-blue Freeze, and an amber End Turn
  primary; fuller labels ("Upgrade Tavern"). The standalone right-edge End Turn (`.endturn-side`) is removed
  (JSX + CSS + pointer-guard reference), so End Turn lives only in the tray — matching the mockup and dropping
  the redundant second button.
- **Shopbar footprint pinned.** The controls now occupy a FIXED `111u`-tall block (`min-height`), so its outer
  height (+10u/10u margins = 131u) EXACTLY matches the combat `.combatctl` footprint (121u + 10u) at every
  `--u`. The tray's 2px borders are fixed px, so a content-driven height drifted the warband ~1px per --u step
  on tall monitors; pinning keeps the tavern/warband/hand rows unmoved.
- **Warband dropped under the centre line.** On tall windows the big `--ch` inflates the board's bottom
  padding, pushing the board up so the warband hugged the divider. A `top: calc(var(--ch) * 0.07)` offset on
  the (already `position: relative`) warband zone, gated to `@media (min-height: 900px)`, drops it ~19px to sit
  roughly symmetric with the tavern above the line; short/laptop windows (warband already low, ~3px hero-panel
  clearance) are untouched. Uses layout `top`, NOT a `transform`: an interim `transform` on `.row.warband`
  wrapped the combat units in a transform/stacking context that their per-swing GSAP attack/hit lunges fought
  (the warband popped UP on every attack + hit — owner-reported); layout `top` on the zone is transparent to
  the units' transform animations, so combat is back to its original behaviour, just shifted down.

Verified live (browser store, throwaway `newRun`): stat strip + tray render + match the mockup; Freeze toggles
solid-blue with its shop-freeze state; timer counts down; 16:9 + 21:9 layouts hold; tavern row top unchanged
(y=207 @ 1400×600); shopbar = exactly 111·--u (147.27px @ --u≈1.33) with combat warband top == recruit warband
top (delta 0); warband 65–67px below the centre line vs tavern ~69px above (symmetric), 124px hero clearance;
combat `.row.warband` transform is `none` (the attack/hit jump-up cause removed). `typecheck` + `lint` + `test`
+ `build:web` green. (Combat lunge could only be verified structurally — the headless preview throttles rAF —
so the swing feel wants a real-browser eyeball.) Note: a deliberate departure from the flat plaque styling
toward the mockup's grouped, warmer control cluster.

## 2026-07-03 (session 15)

### fix(ui): buy-to-hand pop lands in the slot + shop info-row alignment (owner follow-up)

- **A bought card no longer settles twice.** Hand cards rest TUCKED at `translateY(42%)`, but the generic
  `cardpop` keyframe ends at `transform: none` (the RAISED position) — so a freshly bought card popped in
  raised, then dropped ~109px to the tuck when the animation ended (the reported "settles in the old position,
  then drops to a lower slot"). Added a hand-scoped `handpop` (`.row.hand .card.popin`) that fades + scales in
  at `translateY(42%)`, so the card lands once in its slot with no vertical drop (measured: 109px drop → 15px
  scale-in, no raised frame).
- **Shop-tier + Time plaques aligned.** They measured pixel-centred, but the pair clustered over the inner two
  action buttons (Gold/Freeze stuck out on the sides), which read as off-centre. The info row now stretches to
  the action row's width (`align-self: stretch; justify-content: space-between`) so Shop caps the left (over
  Gold) and Time caps the right (over Freeze) — a balanced titled-header rectangle.

### fix(ui): buy/sell drag "replay" + timer/shop-tier plaque widgets (owner follow-up)

Two owner-directed follow-ups to the review batch below:

- **Buy/sell no longer replays the slide.** The first sell fix only covered the store-dispatch path; the real
  gestures are drags (buy = shop→hand, sell = board→tavern), and they showed a double-slide: during the
  pull-out drag the source row already slides its survivors to the re-centred spots (`boardSlide`/`shopSlide`
  close the gap while the dimmed card holds width), then on commit the whole-row FLIP snapped them back to the
  full-row layout and re-slid — the "replay." Fix: route buy + sell through the SAME drop-time capture the
  reorders use (`handFlipRef`/`handPlaySnapRef`, snapshotting the source row's live `getBoundingClientRect`
  before reflow), so the commit glides each survivor from where it visually sits (already re-centred) → its
  final slot ≈ zero motion. (The `offsetLeft` commit-branch FLIP stays for non-drag mutations — summoned
  tokens, effect repositions, store-dispatch.) Owner to confirm the drag feel.
- **Timer + shop tier are now plaque widgets.** The turn timer and "Shop Tier N" were loose text above the
  control row; they're now `.shopbtn` plaques (a "Shop · Tier N" plaque with the tier-badge colour + a "Time ·
  M:SS" plaque that fills red-tinted in the last 5s) in an info row above the Gold/Tavern/Reroll/Freeze
  actions — same plaque language, so they read at a glance. `.shopbar` margin-top re-tuned 26u→10u to keep the
  warband at its combat-parity position under the taller header; dead `.shoplabel`/`.shoptimer`/`.shoptier`
  CSS removed.

Verified live: warband top identical in shop + combat (639/639) with the new header; widgets render + the
low-time red state fires; UI edits add no new `typecheck:web` errors; `typecheck` + `lint` green.

### fix: review-driven correctness batch (engine + sim + tooling + 3 owner bugs)

A full code + gameplay review of `main` (4 parallel review passes + the headless tool suite), written up in
[code-review-2026-07-03.md](code-review-2026-07-03.md), then its findings applied. Two owner rulings folded in
(enemy Start-of-Combat effects **fire**; on-kill procs on **every** kill in a clash; spent effects re-arm).

**Engine correctness (`@game/core`).**
- **0-damage hits are a non-event** (`simulate.ts` `applyDamage`) — an `amount <= 0` early-return before the
  Divine-Shield / Venomous / on-damaged branches. Load-bearing since Manasaber's 0/2 cubs shipped: a shielded
  attacker trading into a 0-Attack body no longer loses its Ward to a phantom 0-damage counter (which also fired
  a bogus Shield-Capacitor break + a `dmg 0` replay beat).
- **Enemy Start-of-Combat effects fire** (owner ruling) — the SC pass now runs player board first (A.3), then
  the enemy's, so a captured board's Taurus/SC minions aren't inert. `scGainFodderStats` (Abhorrent Horror) is
  side-gated to the player (the consumed-Fodder tally is the player's run state).
- **On-kill procs on every kill in a clash** (owner ruling) — cleave-splash and retaliation kills now emit
  `onKill` (Karthus/Impala/Karthus-attack credit each fallen body's killer), not just the main-target kill; the
  re-attack (Gnasher) stays keyed to the main target. `victims` carries each body's pre-clash Reborn state.
- **The Reclaimer's resummon copy keeps its identity + progression** — `copyBoard` now carries `sourceUid`
  (so every carry-back — Kennelmaster Avenge, Engraved permaGain, Sergeant, Tara — reaches the run card),
  plus `overflowBonus`/`hpGrantBonus`/`ascendProgress`/`buffs` and the welded-only `rallyMechAtk` delta.
- **Deathsayer's Rally-proc'd rattles tick the Deathrattle tally** (parity with Sporeling); **`gainMult`
  clears on Rise** (a golden-Taurus ×2 no longer survives a Rise to diverge display from carry-back);
  **`ascendMinion` syncs DS/R flags** for gained keywords (future-proofing, same class as the Ryme fix).
- **Ryme re-firing an AURA battlecry carries it back permanently** (owner-reported) — Deathswarmer's
  `battlecryBuffUndeadAttack` is an aura ("your Undead +Attack wherever they are"), so the combat replay now
  calls `grantUndeadBuyAtk` in addition to the live buff; settle stacks `undeadBuyAtk` + re-buffs the board
  (label unified to 'Undead Bond'). Auras persist; plain Shouts stay combat-only. 7 new core tests.

**Run-loop hardening (`@game/sim`).**
- **`deserialize` heals by construction** — merge the save over a fresh `createRun(seed, hero, mode)` skeleton
  instead of a hand-maintained `??=` list that had drifted (missing `history` crashed the HUD, missing
  `spellCostMod` NaN'd Gold). Armor still heals to 0 for pre-Armor saves. 2 new tests.
- **Reducer rejects before it clones** — the phase + modal guards hoisted above `structuredClone`, so a no-op
  dispatch (a click while a Discover is open, an unaffordable buy) no longer pays the full clone;
  `projectEndOfTurnSteps` excludes `lastCombat` from its clone (the cost the reducer already avoids).
- **Aura/sell parity fixes** — Fodder Treatment now banks Robin's Spoils (it "counts as a sell");
  held-Displacement buys count Drakko's quest; `healHero` caps at `maxResolve`; Chaos's recurring grant routes
  through the shared instantiation (card enchant + tribe-gated Undead bond); Banksly's magnetize sorts its pool.
- **Dead code removed** — `RunState.best` (+ its test), `heroPowerTick`, `CONFIG.startResolve`, the
  `spellCastMult`/`chronosRepeats` public re-exports (kept internal); practice length → `CONFIG.practiceRounds`;
  stale reducer/opponents comments corrected.

**Tooling + guardrails.** `npm run bot` (run-harness) rewritten to answer Discover/Choose-One/Battlecry modals
(it silently stalled + under-reported depth before — seed 7 now reaches wave 12, not 7) + handle victory/empty
shop. The `Math.random` ESLint ban now covers `packages/tools` (the committed pool is generated there).
`validateCards` cross-references six more effect id→card/token refs + the CardDef-level `ascendInto`;
`CardDefSchema` is `.strict()` (typo'd keys now throw). **CI note:** `typecheck:web` was going to be gated but
surfaced ~50 pre-existing UI type errors (pixiFx particle types, Recruit `targetScope`, bad imports) that
`vite build` silently strips — left a CI comment + a tracked cleanup task; the gate lands once they're cleared.

**UI (owner-reported bugs, verified live via the preview store).**
- **Warband no longer jumps between shop + combat** — `.shopbar` `margin-top` 70u→26u so the shop control
  region matches the combat `.combatctl` footprint (stale since #151 stacked the timer/SHOP label above the
  plaques). Measured: warband top identical in both phases now, at the (higher) combat position.
- **Sell no longer janks the board** — the commit-branch FLIP was rebuilt as a manual per-card glide off a
  persisted `commitRectsRef` read via **`offsetLeft`** (transform-immune): a re-centering removal used to glide
  the right survivor while the left one snapped (a capture taken mid-tween via `getBoundingClientRect` seeded a
  poisoned delta). Verified: all survivors glide symmetrically on sell-left/middle/right.
- **Defeat blast aims at the HP box** — `.hprow` (renamed in the HP-box redesign, so it always hit a guessed
  corner) → `.statusbar .hpbox`.

Verified: `typecheck` + `lint` + **479 tests** (472 → +7 core aura/exchange, +2 save-heal) + `bot`/`replay`/
`perf` green; UI edits add **no** new `typecheck:web` errors; warband parity + sell glide + blast aim confirmed
live. **Deferred (tracked):** the UI perf sweep (endpulse/discpulse box-shadow loops, dead-CSS purge, FontLab
DEV gate), the UI type cleanup, and the balance-prober rebuild + quiet-`simulate` flag.

## 2026-07-03 (session 14)

### feat: combat exchange rules + card batch (Mumi) + Flowing Monk rework + shop-button polish

One large owner-directed session, three bundles (shipped together — the engine files interleave heavily):

**1. Combat exchange rules (engine).** Triaged the full combat ordering (rules writeup relayed in-session)
and fixed the findings, all owner-ruled:
- **Two-phase simultaneous exchange** — cleave + main hit + retaliation all APPLY before any death resolves
  (split `applyDamage` from `dealDamage`); deaths then resolve in damage order. Fixes the reported bug where
  an attacker trading into a Deathrattle minion took its damage only AFTER the rattle's summons — and because
  the retaliation `dmg` is now contiguous with the defender's, the replay shows dealt + taken damage in ONE
  impact beat (locked in with a real-log `combatBeats` test). Mutual kills now count both bodies down before
  either rattle fires; cleave neighbours no longer cascade before the main target is even hit.
- **Board cap gates the Rise** — the rattle resolves first (its summons can take the last slots); at 7 living
  the minion stays dead — a real death that **counts toward Avenge** (owner ruling). One-death event, no
  double-rattle (no onDeath re-broadcast).
- **Golden Rise = 1 Health** (owner ruling) — same as normal; auras still apply on top. Base-attack ×2 stays.
- **Rotation + immediate-attack rules verified as already correct** (deathrattle-summoned tokens attack next;
  a surviving Whelp that struck on summon still takes its rotation turn) — locked in with tests.

**2. Card batch (owner-directed).** Kennelmaster Avenge 3→2 · Manasaber summons two 0/2 Taunt cubs (golden
keeps the count, GILDS them 0/4 — new `goldenTokens` summon capability) · Sporeling 2/1, rattle = +1/+1 all
friends, **procs on every Battlecry you trigger in AND out of combat** and ticks the Deathrattle tally
(rides the existing `battlecryTriggered` event both sides; a Consumed Sporeling now also fires) · Forsaken
Weaver +3 Attack (golden +6) · Arcane Weaver → Avenge (2): Spirit Fire (new `avengeGrantSpell`) · Heckbinder
T3 + a LIVE +1/+2 Fodder aura while on board/welded (mirrors the Harry Botter aura end-to-end: weld payload,
triple-merge, live read in `cardBuff`) · Guel 3 targets · **Mumi** (new T3 Undead 5/1, Deathrattle: give a
friendly Undead Rise; golden two) + name-matched art wired (`Mumi.png` → 71 KB webp). Banksly → T6.
`docs/cards.csv` regenerated. Caught mid-batch: the first combat wiring double-emitted `battlecryTriggered`
(Karwind would have double-procced on Ryme) — fixed by riding the existing emit.

**3. Flowing Monk rework + the live-text standard.**
- Monk: Engraves **2** friends per overflow; owner-nerfed to **+2/+2, improving every 5 overflows** (golden
  +4/+4). The overflow tally rides `summonBonus` across recruit + combat.
- **Triple combine (owner ruling 2026-07-03): the golden starts at the SUM of the two highest copies' current
  grants** (+10/+10 + +4/+4 → +14/+14). The surplus over the golden base rides a new flat `overflowBonus`
  field threaded through BoardCard → combat → snapshot → UnitFrame; countdown resets ("5 to go").
- **Live card text is now a hard rule** (owner: "ALWAYS print the current value, everywhere") — codified in
  CLAUDE.md's Architecture section. `monkProgressText` shows the live grant + countdown on every surface
  (shop/board/hand/Discover via `liveCardText`, combat via `Unit.tsx`, climbing mid-fight via per-overflow
  `improve` events).
- **New `keyword` combat event** (shared vocab — flagged for Mike): Mumi's Rise grant now visibly lands on
  the target (pill + float + log) instead of being engine-only; also fixed Ryme-replayed keyword battlecries
  granting keywords invisibly AND a latent bug where a Ryme-granted 'R' never set `rebornAvailable`. The
  event rides `RESULT_TYPES` so a mid-cascade grant never splits the impact beat.

**4. Shop-button polish (follow-up to #151).** Styled dark-pill tooltips (`.sbtip`) replace the native titles
on the shop row + timer; "SHOP TIER N" takes the tier-badge colour (palette promoted to `--tier-1…6` vars);
the Gold plaque is gold-tinted; Freeze is blue-tinted and fills solid blue while frozen.

Verified: **472 tests** (up from 460 — exchange ordering, Rise gates, rotation, Manasaber gilded cubs,
Sporeling shop-proc + tally, Heckbinder live aura, Mumi grant→Rise incl. the keyword event, Monk magnitudes +
triple combine, monkProgressText, beat grouping), typecheck + lint + perf harness (unchanged, within budget)
all green; live DOM checks for the Monk text (+2/+2 → +4/+4 → +14/+14 golden), Mumi's art + in-combat Rise
pill (`.reborncard` appears mid-replay), and the shop-button states.

## 2026-07-02 (session 13)

### feat(ui): HUD redesign — shop-control plaques, timer, standalone End Turn, tucked hand

A recruit-screen HUD reshape toward the owner's mockup (iterated live):

- **Shop controls** are now a labelled **row of gold-trimmed cream plaque buttons** (Gold · Tavern · Reroll ·
  Freeze) centred under a "SHOP" label, above the shop cards, with the turn **timer (M:SS + clock icon) sitting
  just above the SHOP label**. (Started from the `shopbutton.png` art, but its baked-white background keyed to a
  dithered fringe under the board dimmer, so the buttons are built in pure CSS to match the rest of the HUD.)
  Hover just brightens (no pop); click depresses; focus uses a shape-following glow (no square focus ring).
- **End Turn** is a **standalone button on the right edge** (vertically centred, "Start Combat" subtitle),
  shrunk to ~60%. The old framed control cluster + the on-board **burn-rope** are gone.
- **Gold-plaque trim pass:** the header info plaque, opponent frame, hero panel, and HP box all share the new
  `--gold` trim + inset bevel, matching the shop buttons.
- **Top bar:** removed the **ASCENT wordmark** and the **Tribes** strip; the **next-opponent frame moved to the
  top-right corner** (aligned with the header) and is **+15%**; the **mute button was removed** (it lives in the
  Esc menu). The **player name moved** to a small white box (black text) **above the hero panel**, bottom-left.
- **Hand cards seat much lower** (≈half tucked below the fold, clear of the warband) and **pop up on hover** to
  reveal ~82% while keeping their bottom at/below the screen edge.
- **Fixes** surfaced by the refactor: the sell-coin animation retargeted to the new Gold plaque (`.shopbtn.gold`),
  and the recruit pointer-down guard updated to the new `.shopbar`/`.endturn-side`.
- Pruned the now-dead CSS/JSX (`TurnRing`/`TurnRope`/`GoldChip`, `.wm`/`.tribes`/`.barplayer`/`.mutebtn`/
  `.rtimer`/`.rope*`/`.shopctl`/`.ctlbtn*`/old header timer) and removed the unused `shopbutton.webp`.

Verified: typecheck + lint + 460 tests + `build:web` all green; the recruit HUD checked live via screenshots +
computed styles across the changes (a real pointer-drag can't be driven headlessly — owner to confirm feel).

### feat(ui): recruit HUD + drag/play polish, board2upscaled2 (21:9), HP box

A batch of recruit-screen presentation work (owner-directed, iterated live):

- **Play a minion at any height (with a play floor).** A hand minion now plays when released anywhere in the
  board area, not only on the warband row — you no longer have to hit the row exactly. A measured "play floor"
  (`playFloorRef`, 10% of the play area above the warband bottom, biased so it's not too low) is the minimum:
  release **below** it (toward the hand) and the card snaps back to hand (the cancel gesture). The insertion
  preview + a soft gold "will play" glow on the floating card track the drag while it's above the floor; both
  clear below it. The glow reuses the exact `.card:hover` gold highlight.
- **Removed the drag clutter.** No more "Drag minions up…" empty-board hint; the BUY / Sell +1 text labels are
  gone; the buy/sell **gradients stay but toned down** with their dashed borders removed; the warband and hand
  drop-target **boxes/tints removed** (buying shows only the buyzone gradient now).
- **Buy requires crossing the midline.** A shop card only buys when released **below the board's midline** (the
  background divider = the `.app` vertical centre), not merely below the warband top — so a card hovered up by
  the offers won't buy. The burn-rope is aligned to that same midline (JS-measured `--rope-y`, nudged up a hair
  to sit on the art divider).
- **Gold moved up top.** Extracted the Gold counter into `GoldChip` and placed it as its own box at the LEFT of
  the shop control frame — opposite End Turn on the right — so the frame stays centred on the timer. Removed it
  from the bottom bar; retargeted the sell-coin animation to `.shopctl .chip.g`.
- **HP as a white box.** Dropped the Resolve HP bar; health now shows as a compact white box beside the hero
  power inside the hero panel (heart + Resolve `+Armor`), keeping the hit-shake + −X float. Also removed the
  bottom player-panel container box (background/border/shadow) so the hero/gold read as standalone HUD pills.
- **Board art:** wired **board2upscaled2** (native 3440×1440) as the 21:9 backdrop (`[data-res="r3440"]` + a fit
  window ≥2:1), keeping **board2b** as the 16:9 default; the hero-select screen previews the same `--board`.
  Removed the superseded `board2.webp` and updated the art preload list to the current backdrops.
- **Fix:** a board/shop **reorder no longer replays the mount-pop** on the displaced card — `popin` is dropped
  ~500ms after it plays, so a DOM move (reorder) can't restart the `cardpop` animation (was most obvious as a
  Battlecry card like Alleycat "re-summoning" when dragged past a neighbour).

Verified: typecheck + lint + 460 tests + `build:web` all green; the drag/HUD states checked live via computed
styles + DOM (a real pointer-drag couldn't be driven headlessly — owner to confirm feel). Rebased onto #148/#149.

### fix(ui): art pop-in hardening — sync decode + preload the public backdrops/cursors

The player still saw art pop-in "plenty" after the #144/#145 boot preloader. Root causes found:
(1) `Card.tsx` rendered its art `<img decoding="async">` — that attribute explicitly lets the browser paint
the card frame BEFORE the image is decoded, so every newly mounted card (each shop refresh, each combat
start) could flash frame-without-art for a frame or two even with all bytes preloaded → now `decoding="sync"`
(the art paints WITH the frame; decode cost is small for ≤512px webps). (2) The preload set only covered the
three `packages/ui/src/art/*` globs — the board backdrops (`board2b.webp` / `board2.webp`), the title
`homescreen.webp`, and the three drag-cursor SVGs are `apps/web/public/` assets referenced from CSS `url()`,
loaded lazily on first use (first combat entry / first drag) → added a `PUBLIC_ART_URLS` list to the warm-up
set. (3) The preloader discarded its `Image` objects after boot, inviting decoded-bitmap eviction on weaker
devices → a session-long `KEEP_ALIVE` array now holds them. Verified: lint + test (460) + build:web green;
`typecheck:web` unchanged at the 56 pre-existing errors; live preview confirmed the boot gate completes,
every card `<img>` reports `decoding === 'sync'`, and `/board2b.webp` answers a `cache: 'only-if-cached'`
fetch with 200 (i.e. genuinely pre-warmed — the resource-timing buffer maxes at 250 entries, so it's absent
from `getEntriesByType` but IS cached).

### fix(ui): restore the lost drag recentre glide (recenter/recenterAfter)

The player reported the card-drag feel as "accidentally reverted" — investigation found the work was never
merged: the local branch `fix/board-move-slide` (4 commits, never PR'd) held the drag **recentre glide** —
a grabbed card keeps its grab-point anchor until the pointer has dragged `recenterAfter` px (100), then
glides to sit centred on the cursor at its own slow `recenter` rate (0.12/frame) instead of snapping there
almost immediately (the old `kc = k×1.4`). Re-applied the branch's net diff onto current `main` by hand
(the branch's other experiment, an absolute board-slide Flip, had been reverted within the branch itself
and is NOT restored): two new `DragFeel` dials (`recenter`, `recenterAfter`) with ranges/descriptions +
Drag Feel tuner labels + the gated recentre in the drag rAF. The stale local branch was deleted after
extraction. Verified: lint + test (460) + build:web green; `typecheck:web` confirmed at the same 56
pre-existing errors as `main` (zero new — NB: root `typecheck` excludes packages/ui and CI never runs
`typecheck:web`; flagged as a follow-up task).

### feat(ui): DEV Smoke & Dust tuner

Extracted the previously-hardcoded parameters of the combat **impact smoke** (`pixiFx.impact` — the warm-
grey puffs that rise on a hit) and the **card-drop dust** (`pixiFx.dust` — the tan ring kicked up under a
placed/moved card) into a new localStorage-persisted `smokeConfig.ts`, and added a panel-only `SmokeTuner`
under the Dev Tuning Menu (🌫️ Smoke & Dust). 11 live sliders: per-effect count / rise or speed / spread /
lifetime / expansion (grow) / alpha, read at spawn time so they apply to the next impact/drop. The randomized
ranges were re-expressed as `base × jitter` (so a single dial cleanly scales its part of the effect); the
tuner was then used to **amp the smoke up** and the player-tuned result baked in as the shipped DEFAULTS —
bigger + longer-lived + more billowing combat smoke (`smokeCount` 4→7, `smokeRise` 75→150, `smokeDrift`
90→170, `smokeLife` 620→1720, `smokeGrow` 2.1→4.5, `smokeAlpha` 0.34→0.09 so the larger cloud stays wispy),
and a thicker/faster/longer card-drop dust (`dustCount` 12→22, `dustSpeed` 120→195, `dustLife` 380→1180).
Verified: `typecheck` + `lint` + `test` (460) + `build:web` green; a preview smoke test fired
`impact()` + `dust()` (incl. the scaled/dense taunt-deploy variant) with no runtime errors. Purely additive +
DEV-only — no player-facing behavior change at the shipped defaults.

### tweak(ui): retune the motion trail + add a blue Reborn variant

Player-tuned the wisp trail live via the DEV Trail panel and baked the result in as the shipped
defaults (`trailConfig.ts`): denser + longer-lived + wispier (`emitSpacing` 14→4, `lifeMs` 300→900,
`alpha` 0.3→0.1, `drift` 30→68, `sparkChance` 0.25→0.4, `size`/`stretch` nudged, `goldAlpha`
0.45→0.13). Also raised the tuner's `lifeMs` ceiling 900→1500 for headroom. The earlier ribbon /
card-width-wake experiments were both rejected and reverted — the original per-particle wisp trail was
the right look all along, it just needed different dials.

Added a **blue Reborn trail variant** alongside the gold Divine-Shield one: `pixiFx.trail`'s last arg
changed from `gold: boolean` to `variant: 'wind' | 'gold' | 'blue'`. A dragged/attacking card picks
its variant from keywords/marker classes — `DS` → gold, else `R` → blue (spectral blue `0x8ec7ff` +
a pale-blue glint mote), else the pale-cream wind. Gold takes precedence when a unit has both. New
`blueAlpha` dial (default 0.14) parallels `goldAlpha`; the drag hookup (`Recruit.tsx`) and the lunge
hookup (`useCombatReplay.ts`, reading `.dscard`/`.reborncard`) both compute the variant. Verified:
`typecheck` + `lint` + `test` (460) + `build:web` green; a preview smoke test drove all three variants
(`wind`/`gold`/`blue`) with no runtime errors. Visual feel is dialed live in the Trail panel.

### feat(ui): card motion trails (wind + divine-shield gold) + Dev Tuning Menu

Two threads landed together — a UI-only motion-feedback pass and a dev-tooling cleanup — spanning 6
commits (`e0b4706`..`cabfc39`). Spec: `docs/superpowers/specs/2026-07-02-card-trail-fx-design.md` (the
spec + plan + `trailConfig.ts` themselves rode along on `main` already via #144; this batch is the rest
of the implementation).

- **`pixiFx.ts` — the `trail(x, y, dx, dy, gold)` emitter.** A new pooled-particle emitter draws soft,
  feathered "wind-whoosh" wisp streaks oriented along the motion vector, via a new `makeWispTexture` and
  non-uniform `stretchX` support threaded through the existing particle pool (previously particles only
  scaled uniformly). Two visual variants, mutually exclusive — gold **replaces** wind, it never layers:
  wind is pale cream (`0xf5efe0`, normal blend), divine-shield is shield-rim gold (`0xffe9a8`, additive)
  with an occasional spark-mote glint (`sparkChance`).
- **`Recruit.tsx` — drag trails.** The existing rAF-throttled drag handler now emits distance-gated wisps
  (one every `emitSpacing` px of cursor travel) while a drag is active, gold when the dragged card's
  keywords include Divine Shield (`DS`). No new layout reads — reuses the drag handler's existing
  position tracking.
- **`useCombatReplay.ts` — attack-lunge trails.** `playAttackLunge`'s GSAP timeline gained an `onUpdate`
  hook that emits wisps only during windup + strike (cutoff at `tl.time() > windupDur + strikeDur`, so it
  stays correct at any combat speed slider setting). Positions come from one up-front rect read plus
  GSAP's already-animated x/y — no per-frame layout reads. Gold when the attacker carries the `.dscard`
  marker.
- **`TrailTuner.tsx` (new).** A DEV panel with 8 live sliders over `trailConfig.ts`
  (emitSpacing/lifeMs/size/alpha/stretch/drift/goldAlpha/sparkChance) plus Copy (bakes the dialed values)
  and Reset.
- **`DevMenu.tsx` (new) — tuner consolidation.** The six previously-separate floating DEV tuner buttons
  (SFX Mixer, Lunge, Taunt, Drag Feel, Reposition, Shield Place) plus the standalone Test FX button are
  gone; one 🛠️ button opens a compact menu that toggles each panel (now panel-only, no individual
  buttons) plus the new Trail panel and a Test FX one-shot action. Dead per-button CSS was removed and
  replaced with `.devmenu*` styles.
- **Fix folded in:** `TauntTuner` now clears its held demo bulwark on unmount — it previously assumed it
  would never unmount (there was always exactly one always-visible button); now that it lives inside a
  toggleable menu panel, closing the panel could leave a demo bulwark stuck on screen without this.

**Why.** Subtle motion feedback on drags and attacks (the "wind" reads as momentum); divine-shield
identity is now carried into motion, not just the static card badge; and the six-button dev-tuner sprawl
was becoming its own source of UI clutter, so it's now one discoverable menu.

**Verified.** `npm run typecheck`, `npm run lint`, `npm test` (460 tests), and `npm run build:web` all
green at every commit and again on the final rebased branch. Each task went through a two-stage subagent
review (spec-fidelity + code-quality) before moving on. The Dev Menu + panel toggles and trail emission
(wind on drag, gold on divine-shield attacks) were live-verified in the browser preview; the 8 Trail
dials were confirmed live-tunable via the new panel.

### tweak(ui): boot loader runs on every load (drop the sessionStorage skip)

Removed the `ascent.artWarmed` sessionStorage skip from `Boot.tsx` — the loader now runs on every page load
instead of skipping after the first in-session pass. Cheap when art is already HTTP-cached (`onload` fires
instantly, so the loader just flashes), and it always re-verifies art is ready before a card can render — and it
makes a "cold cache" test as simple as a reload (no need to clear sessionStorage first). Typecheck + lint +
build green.

### feat(ui): blocking art preload at boot — no more sprite pop-in

Card/hero art could still pop in a beat late: `warmArt` only warmed on idle (fire-and-forget), and each `<img>`
still loaded on demand, so reaching the shop before an art file decoded showed a blank-then-fill. Per the
owner's preference (wait up front, guarantee it), added a **boot loading screen** that blocks until every
bundled art file (133 minions + 12 heroes + 12 powers = 157, ~8.6 MB) is fetched:
- `art.ts` — new `preloadAllArt(onProgress)`: creates an `Image` per URL, resolves each on `onload` (the network
  round-trip is the real pop-in cause; `decode()` runs in the background, best-effort, since it can stall in a
  throttled tab). Per-image 12 s safety timeout; `ART_COUNT` exports the total.
- `Boot.tsx` — a gate component wrapping `<Game/>` (in `main.tsx`): shows a themed `ASCENT` + progress-bar
  loader until preload resolves, with a 20 s hard cap so boot can never hang, and a `sessionStorage` skip so
  in-session reloads don't re-wait. Children (Game) don't mount until art is ready, so no card renders early.
- Gotcha fixed: a `startedRef` guard deadlocked under StrictMode (run 1's cleanup flips `alive=false`; the guard
  blocked run 2 from re-wiring state) — dropped it; the second pass is harmless (art already HTTP-cached).
- Verified in a real browser tab: loader renders + gates, `onload` fires (0 ms cached), then hands off to the
  game (`artWarmed` set); 342 art requests all 200/304, no 404s. Typecheck + lint + 460 tests + build green.

### feat(ui): new play backdrops — board2b (16:9 default) + board2 (21:9), aspect-switched

Replaced the `board1` backdrop with two new boards, picked by the stage's aspect. Converted both masters with
sharp (WebP q82): `board 2.png` (1933×814) → `board2.webp` (1680×707 ≈ 21:9, 54 KB) and `board2b.png`
(1672×941) → `board2b.webp` (1672×941 = 16:9, 133 KB). The `.app` background now reads a `--board` CSS var:
default is `board2b` (16:9); it swaps to `board2` for the ultrawide resolution (`[data-res="r3440"]`) and for a
"fit" window that is itself ≥2:1 (`@media (min-aspect-ratio: 2/1)` on `:root:not([data-res])`). Fixed 16:9 res
(r1920/r2560) stays letterboxed to 16:9 so it correctly keeps board2b regardless of monitor. `board1.webp` is
left in public but is now unreferenced. Verified live: both assets serve 200; the computed `.app` background
resolves to board2b for fit/r1920/r2560 and to board2 for r3440 and a 2.37:1 fit window.

### fix(ui): reposition slide no longer replays the dragged card's move on drop

**Symptom.** Dragging a card to a new slot and dropping it — in **both** the warband and the shop — replayed
the swap: the dragged card teleported back to its old slot and re-slid to the new one *after* the drop.

**Root cause.** A regression from #131 (`fb4060e`), which set the committed Flip `commitMs 0 → 200` to fix
quick-flick reorders snapping. During a reorder the neighbours slide aside live (CSS `boardSlide`/`shopSlide`
transforms) while the dragged card holds its old slot invisibly (it rides the drag overlay). On drop, the
`reposition`/`reorderShop` dispatch reorders the array and the `flipKey` layout effect runs — but by then
`dragRef.current.active` is already `false` (from `setDrag(null)`), so the effect couldn't tell the commit came
from a drag. It fell into the `commitMs > 0` branch and ran a whole-row `Flip.from`, which animated the dragged
card from its captured *old* rect to its *new* one = the replay. (Neighbours didn't visibly double-animate —
they were already slid, so their delta ≈ 0 — but the dragged card always did.)

**Fix.** Route drag-drop commits through the same manual per-card FLIP that hand-plays already use, generalized
to whichever row the drop landed in:
- At drop, snapshot the row's live card lefts **excluding the dragged card** (it's stale at its old slot; a new
  `handFlipSelRef` records whether the row is the warband or the tavern).
- Set the existing `handPlaySnapRef` for hand-play, board reorder, and shop reorder.
- The commit branch then glides only the cards whose captured spot differs from their final slot; the dragged
  card, absent from the snapshot, simply appears at its committed slot with no slide.

This fixes both cases at once — slow drag (neighbours already home → snap; dragged card excluded → no replay)
*and* quick flick (neighbours glide from their pre-slide spots), so it's strictly better than either `commitMs`
value. `commitMs` now only governs genuine non-drag commits (summons / effects / auto-reposition).

**Verified.** `npm run typecheck` green; HMR clean (no console errors); owner confirmed both rows live — the
drop settles with neighbours gliding and no post-drop replay. **Follow-up:** board-*sell* drags still route
through the `commitMs` Flip and could show a milder version of this on the gap-close — not folded in here.

## 2026-07-01 (session 12)

### tweak: divine-shield shop default recruitDy → 0.01 (dialed by eye)

Baked the owner's tuned value: `shieldConfig.recruitDy` default `0.03 → 0.01` — perfect bubble alignment on
shop/warband cards. (Existing localStorage values still win; fresh installs get 0.01.)

### fix: divine-shield tuner slider now updates the bubble live

The 🛡 Shield tuner slider saved its value (localStorage) but the on-screen bubble didn't move — `syncShields`
only re-runs on run-state / layout changes, and dragging the slider touches neither, so nothing re-synced until
you next interacted with a card. The tuner now dispatches an `ascent:shieldcfg` window event on every slider
change (and Reset); Recruit listens for it and re-runs `syncShields`, so the bubble tracks the slider in real
time. Verified live in-browser: driving the slider to 0.16 moved the shield to delta 27 px (=0.16·h) with no
card interaction. Typecheck + lint green.

### feat/fix: divine-shield placement tuner + persist bubble on hover

Two follow-ups to the shield-under-chrome work:
- **Placement tuner.** The hardcoded recruit down-nudge (`0.07·h`) overshot (shop bubble too low). Moved it to
  a live-tunable `shieldConfig.recruitDy` (default lowered to `0.03·h`) with a DEV 🛡 Shield tuner (mirrors the
  lunge/flip tuners). Combat is untouched (offset only applies out of combat). Dial + Copy the value to bake.
- **Bubble vanished on hover.** With the persistent bubble now on the z3 `.pixifx-under` canvas, `.card:hover`'s
  `z-index: 20` turned the hovered card into a stacking context that lifted it ABOVE the bubble canvas — hiding
  the aura while hovered. Dropped the hover `z-index` (the glow no longer needs it — there's no lift anymore),
  so the card stays context-less on hover and the bubble keeps rendering between the art and the badges.
  Typecheck + lint + build:web green.

### fix: divine-shield/reborn bubble renders BELOW the card chrome (badges on top)

The persistent shield bubble drew over the attack/health/tier/effect badges (all FX share the `.pixifx` canvas
at z110, above the cards' root-context chrome at z4–9). Split the front `FxController` into two canvases: the
persistent bubbles now render on a new `.pixifx-under` canvas at **z3** (over the card art but below the badge
chrome), while the particle layer — dust, impacts, and the shield **break shatter** — stays on `.pixifx`
(z110), so the break still bursts over the chrome as before. `attach(parent, underParent?)` gains an optional
under-parent; when present the bubbles' `shieldLayer` mounts on a second `Application` there (the bubble mesh is
procedural/textureless, so it renders cleanly in the second GL context). The taunt back layer passes no
under-parent and is unchanged. Verified in-browser: `shieldLayer.parent === shieldApp.stage`, the bubble sits
over the sprite with tier/attack/health/medallion all readable on top. Typecheck + lint + build:web green.

### feat/fix: hover glow, denser dust, divine-shield fixes, attack windup swell

Batch of feel polish:
- **Card hover glow.** `.card:hover` now shows a bright white/gold surround (`0 0 0 3px #fff7d1, 0 0 24px 7px
  rgba(255,226,110,.95)`) instead of the `translateY(-3px)` lift — the card stays flat, no elevation/tilt.
  Applied to `.card.dual:hover` too; neutralized under a live drag (cursor "hovers" cards beneath the
  pointer-events:none floating card, so their glow is reset to the base shadow). Hand keeps its fan-lift.
  Follow-up: the glow was invisible at first because recruit cards are `.card.compact`, whose `box-shadow: none`
  (equal specificity, later in the file) won — fixed with a `.card.compact:hover` selector + `!important` (also
  future-proofs against the venom/triple/tripready special-card shadows); the drag neutralizer is `!important` too.
- **Placement dust +25% apparent.** `pixiFx.dust` peakAlpha 0.2+r*0.12 → 0.25+r*0.15 (more visible, same size).
- **Divine shield askew in shop.** The aura's first measure could catch a card mid `cardpop`
  (translateY(8px)/scale .96), placing the bubble low until the next interaction re-synced it. Added a delayed
  `syncShields` (240 ms, after the pop settles) so it corrects on its own. Follow-up: with that fixed the bubble
  was centred on the square art tile (verified in-browser: shield container == archbox centre, delta 0) but the
  stat badges hang BELOW the tile, so it read slightly high vs the full card. Nudged recruit shield/reborn auras
  down `0.07·h` (~12 px, verified live) so they centre on the whole card; combat units (clean square) and taunt
  (own tuner offset) are unaffected.
- **Dragged card over auras.** `.dragcard` z 100 → 115 (above `.pixifx` z110), so a card dragged past a
  shielded/reborn unit rides on top of that unit's aura instead of under it. (Its own aura sits behind it; the
  bubble still reads around the card edges.)
- **Attack windup swell.** New tunable `windupScale` (default 1.2) in `lungeConfig` + LungeTuner; the lunge
  timeline swells the attacker +20% during the wind-up and returns to 1 on the strike. Typecheck + lint +
  build:web green.

### fix: place rebound (drop = shown gap) + spell-buy collapse slide

- **Rebound, really fixed.** The drop recomputed its target index from the *release* point, but the neighbours
  had opened for the last *rendered* gap (from the rAF-throttled `drag.x`). On a fast left→right placement the
  two disagreed, so a neighbour that had shifted one way during the drag reversed on commit — the "rebound". No
  settle animation can hide a wrong-side preview. Now every drop (hand-play, warband reposition, shop reorder)
  lands at the **last-rendered gap** (`prevWarbandGapRef` / `prevShopGapRef`, fallback to the recomputed index):
  WYSIWYG — the card goes exactly where the gap was shown, so neighbours never reverse.
- **Spell-buy slide.** Buying a spell now collapses the shop like buying a minion. The pinned spell stays
  rendered (dimmed) while dragged so the row holds its width, and it's treated as the end-of-row index
  (`draggedShopIdx = run.shop.length`), so every offer recentres a half slot to fill its gap. `spellShown` is
  now always the spell uid until the buy commits. Typecheck + lint + build:web green.

### fix: hand-play neighbour jump on a fast "land far over" drop — manual FLIP

The instant snap on a hand-play commit teleported a neighbour when the release point outran the live preview:
the drop index uses the release `cx`, but the last render's gap used the rAF-throttled `drag.x` (up to a frame
behind), so on a fast left→right "land it far over" the preview hadn't opened the gap where the card actually
landed — the row snapped the difference on commit. Now the commit does a MANUAL FLIP: `onUp` snapshots the
board cards' live left-edges the instant before the row reflows (`handFlipRef`), and the FLIP `useLayoutEffect`
glides each existing neighbour from its captured spot to its final slot (`gsap.fromTo({x:delta},{x:0})`). The
freshly played card is skipped (it pops in via CSS — a full `Flip.from` would fight the entering element and
jolt the row). Cards already home (delta < 0.5) just restore their base transition; the base
`.card transition: transform 0.12s` is killed for the commit so the reset never rebounds. Typecheck + lint +
build:web green.

### fix: reorder swap asymmetry — measure neighbours at their shifted spots

Reordering a warband/shop card felt lopsided: dragging one aside needed ~50% of a neighbour's width to open
the gap, but nudging back needed only ~5% to close it. Cause — `insertRectsRef` caches each slot's RESTING
position, and the insertion index counted those fixed midpoints. Once a neighbour slides a whole slot away to
make room, its trigger midpoint stays where the card *used to be*, so on the way back the dragged card is
already past it → instant re-trigger. New `reorderIndexFromSlots` counts each non-dragged card at its CURRENT
(shifted) centre instead: with the gap at `prevGap`, the p-th neighbour sits in slot `(p < prevGap ? p : p+1)`,
so the swap threshold follows the card's real position — symmetric both directions. Carried frame-to-frame via
`prevWarbandGapRef` / `prevShopGapRef` (reset at drag start; fall back to the dragged card's home slot on frame
one). Only the reorder path (excludeUid) uses it; hand-play insert keeps the plain midpoint count. Typecheck +
lint green.

### fix: collapse over-shift (buy/sell) + hand-play rebound

Two follow-ups to the vertical-lift collapse:
- **Over-shift.** The collapse shifted survivors a FULL slot (`-1`) toward the lifted card's old spot. But
  removing a card takes the row N → N-1 and RE-CENTERS it, so each survivor should move only a HALF slot toward
  centre: cards before the lifted one `+0.5`, cards after `-0.5` (the exact mirror of a hand-play insert).
  Applied to both `boardSlide` and `shopSlide`. (Confirmed the slot unit is right: recruit cards are
  `.card.compact` → width `--ccw`, so the transforms' `--ccw + 22px` really is one slot.) Also added
  `collapsedLift` to `flipKey` so the GSAP buy/sell commit captures the collapsed layout instead of a stale
  pre-collapse one.
- **Place rebound.** After a hand card lands we snap the FLIP commit (no GSAP), but the base
  `.card { transition: transform 0.12s }` (active once `body.dragging` is off) still animated the neighbours'
  `slideDir → 0` reset while the row had already reflowed — snapping them a slot left then gliding back. Kill the
  transition for that one commit (`transition:none` → force reflow → restore) so the reset is instant: the
  neighbours are already exactly where they belong, so nothing moves. Typecheck + lint green.

### fix: hand-play jolt — snap the FLIP commit when a card lands (no GSAP thrash)

Placing a card from hand jolted: the row would quickly close then reopen as it made space. Cause — a played
minion is a NEW element entering the flex row, and GSAP Flip doesn't take entering elements out of flow, so on
the commit it fights the reflow (siblings collapse, then the new card shoves them back open). Board-reorder and
shop drops never hit this because every card already exists. Fix: `handPlaySnapRef` is set on a hand-play drop
(`acted && source==='hand' && !spell`) and the FLIP `useLayoutEffect` SNAPS that commit (skips GSAP) — the
neighbours are already parted to their final spots by the drag, and the new card pops in via CSS `popin`, so no
animation is needed. Genuine no-drag repositions (summons, effects) still use the `commitMs` slide. (Trade-off:
a very fast hand *flick* now opens the slot instantly rather than sliding — clean, no jolt.) Typecheck + lint green.

### feat: vertical-lift collapse — the row fills the gap when a card is pulled out up/down

The reorder slide already parted the row horizontally, but pulling a card straight *up* (to play/sell) or
*down* left a visible hole where the lifted card sat (it stays rendered invisible to hold row width). Now,
once the drag clears a vertical distance (`collapseY`, default 70 px), the source row closes up: every card
*after* the lifted one slides in one slot (`slideDir −1`) to fill the gap, glided by the same
`body.dragging` `transition: transform`. Applies to both the **warband** (`boardSlide`) and the **shop**
(`shopSlide` — the buy motion pulls an offer down out of the row). Gated on `gapIndex < 0` so an in-row
horizontal reorder is unaffected. New tunable `collapseY` added to the drag-feel config + 🎴 DragTuner
(range 0–200 px) with a hover definition.

Follow-up fix: the shop wasn't collapsing on a buy. Unlike the warband sell (which flips `overZone` off
`'warband'` the instant you cross the `wbTop` line), a buy pull-down stays over the tall tavern zone, so
`overShop` kept the row in reorder-hold (no gap-fill) for most of the gesture. Now `overShop` also requires
`!collapsedLift` — once the offer is lifted past `collapseY` it's a buy, not a reorder, so the collapse
takes over immediately, matching the warband feel. Verified: typecheck + lint green.

### polish: reposition slide — no pickup jerk, shop too, longer settle

Three refinements (all verified live via in-browser transform sampling):
- **No pickup re-centre jerk.** The dragged card no longer leaves the row; it stays rendered invisible
  (`dimmed`) so its slot holds the row width — the neighbours don't snap inward on lift. The gap moves only
  when the drag actually crosses a card: each other card shifts a WHOLE slot via `boardSlide(i)` (its index
  among the non-dragged cards → its index once the dragged card reinserts at the gap). On pickup gap==origin,
  so nothing moves. Verified: grabbing the middle card, the neighbour holds `tx=0` until dragged clear, then
  glides one full slot.
- **Shop row too.** Same model via `shopSlide(i)` — the tavern offers slide/hold-slot on reorder (drop-slots
  removed from both rows).
- **Longer ease-out.** Transition `0.36s cubic-bezier(0.12, 0.82, 0.12, 1)` — a more gradual settle.
- Hand-play still opens a half-slot gap each side at the insertion point.

### fix: reposition slide FINALLY works — deterministic CSS-transform gap (GSAP Flip abandoned)

Confirmed via live in-browser transform sampling (focused tab so rAF runs): GSAP Flip applied **no transform
at all** during a warband drag — the neighbour card jumped 753→941 px in one frame with transform identity the
whole time (pure flex snap). GSAP Flip simply doesn't animate the reorder in this app. Replaced it (for the
warband) with a deterministic approach: the drop slot is gone; instead each card gets a `slideDir` (−1/0/+1)
that shifts it half a slot left/right of the gap via `transform: translateX(calc((var(--ccw)+22px)*dir/2))`,
and a `body.dragging` CSS `transition: transform 0.28s cubic-bezier(0.16,1,0.3,1)` (ease-out) glides it as the
gap moves. Half-slot each side keeps the row centred AND matches the final drop position, so on release
(`body.dragging` drops → transition off) the transform resets instantly with no post-drop jump. Live sampling
confirmed bA's translateX ramps 0→~94 with decelerating steps (the requested fast-then-settle glide).

### fix: reposition slide — let the DROP settle animate (video-frame diagnosis)

Extracting frames from an owner screen-recording (portable ffmpeg via `ffmpeg-static`) finally made it
observable: on a quick drag the insertion gap only changes at the moment of DROP, so the whole reorder lands
on the commit — and `commitMs` was 0 (instant), so it snapped (a neighbour jumped index 0→1 in one 33 ms
frame). Set `commitMs` 0 → 200 so the drop settle slides. GSAP Flip only animates cards not already in place,
so a slow drag that already slid pre-emptively won't double-animate. Bumped the localStorage key to
`ascent.flip.v3` so the stale `commitMs: 0` is discarded. (The remount fix below is what lets the commit Flip
actually move the cards rather than pop them.)

### fix: THE reposition-slide root cause — drop-slot toggle was remounting cards

The real bug behind "cards don't pre-emptively slide, they pop." In the warband/shop maps the drop-slot was
rendered as an UNKEYED positional sibling inside each card's `<Fragment>`: `{gap === i && <span/>}<Card/>`.
When the slot appeared/disappeared at a card's index, React reconciled the Fragment's children by position, so
the `<Card>` went from child-0 to child-1 → **unmount + remount**. A remounted card is a new DOM node, so GSAP
Flip saw it *entering* (a scale+vertical pop) instead of *moving* (a horizontal slide) — and the remount also
replayed the `.popin` animation. A DEV transform probe nailed it: during a drag the cards showed
`matrix(0.96…, 0, 8)` (scale + translateY) with the **horizontal translate always 0** — i.e. never sliding
sideways. Fix: key the Fragment's inner children (`key="slot"` / `key="card"`) so the Card is matched across
the slot toggle and never remounts → GSAP Flip now animates it as a horizontal move. (Kept the
`body.dragging` transition-off so the CSS transform-transition doesn't re-mask GSAP's slide.)

**Root cause found.** `.card` carries `transition: transform 0.12s` (for hover/buff eases), but GSAP Flip
animates the reposition slide VIA `transform` — so the CSS transition re-smoothed every frame GSAP set and
fought the slide into looking like an instant snap. (A DEV probe confirmed it: the committed Flip *was* firing
with `moved: 2` tweens over the tuned duration, yet nothing visibly moved.) Fix, two paths:
- **Live drag** (cards preemptively sliding aside to open the drop gap): the flip re-fires every frame, so a
  per-frame JS transition toggle thrashed every card. Instead, kill the transition for the WHOLE drag via one
  CSS rule (`body.dragging .zone[warband/tavern] .card { transition: none }`) — restored on release.
- **Committed one-shot** (play / sell / summon / auto-reposition, no drag): `gsap.set(targets, { transition:
  'none' })` for the slide, restored on complete/interrupt.

The slide is the PRE-EMPTIVE one you watch while dragging (the row opening the drop slot); after the drop the
cards are already in place, so the committed settle now defaults to **instant**. Durations live in
`flipConfig.ts`: `dragMs` (the drag-across preview slide, default 180) + `commitMs` (post-commit settle, default
**0 = off**; a non-drag summon/effect can opt into a slide by raising it). `FlipTuner.tsx` (the 🔀 button)
exposes both. The localStorage key was bumped to `ascent.flip.v2` to discard earlier hand-tuned values that had
these backwards (drag near-0, commit slow).

(An `absolute: true` committed Flip was tried first and reverted — it didn't help and slid the board in from
the right on card pickup. The real culprit was the CSS transition, above.)

### tweak: card retiers + Koron rework + Choose One cursor fix

- **Choose One cursor:** the `.chooseopt` option buttons set a plain `cursor: pointer`, which overrode the
  game's gauntlet cursor and showed the OS default. Now `url('/cursors/gauntlet_open.svg') 6 2, pointer`, matching
  every other clickable ([styles.css](packages/ui/src/styles.css)). Verified live: computed cursor resolves to the
  gauntlet SVG.
- **Retiers (content):** Arcane Weaver **T4 → T3**, Harry Botter **T4 → T3**, Ghostsmith **T3 → T2**.
- **Koron, the Hungerer** now buffs **only Fodder** (+1/+1) + queues a Fodder to the next tavern — **no longer
  touches Imps**. Dropped the `buffImpsRunWide` call from the effect and renamed it `goldSpentBuffFodderImps` →
  `goldSpentBuffFodder` across the type union / schema / buildTags / handler / card; card text updated. Its Koron
  test now asserts Fodder + queued-Fodder and that `impBuff` stays untouched.
- **Verified:** 456 tests green (updated the Koron test), typecheck + lint clean. No opponent-pool regen needed —
  snapshots store card id + stats, not tier.
### feat: Armor — a per-hero effective-HP buffer on top of Resolve

A new **Armor** stat: extra effective HP that sits on top of the hero's Resolve. Functionally identical to
health — a lost combat chips **Armor first, then Resolve** — it just doesn't regenerate (no heal touches it).
Every hero starts with **15 Armor** except **Warden, Robin, Chaos, Drakko** (8). *(The original handoff named
"Brann" for the 4th 8-Armor hero; the owner clarified that meant **Drakko** — set to 8 in a follow-up.)*

- **Engine:** `HeroDef.armor` ([heroes.ts](packages/sim/src/heroes.ts)); `RunState.armor` + `maxArmor`, seeded
  from the hero in `createRun` ([state.ts](packages/sim/src/state.ts)); `deserialize` heals pre-Armor saves to
  0 (an in-progress run gets no retroactive Armor). Loss absorption in `settleCombat`
  ([reducer.ts](packages/sim/src/reducer.ts)): `absorbed = min(armor, dmg); armor -= absorbed; resolve -=
  overflow` — game over still fires only when Resolve hits 0 (i.e. after Armor is gone). Combat `simulate` is
  untouched (Armor is a post-combat run-state buffer, not a combat-minion concept).
- **UI:** the StatusBar HP bar now renders Armor as a **steel segment stacked on the red Resolve fill** over a
  shared capacity (`maxResolve + maxArmor`), with the value shown as `30 +8`; the damage-float + shake now
  trigger when *either* Armor or Resolve drops. Hero-select cards show a steel `+N` Armor chip beside Resolve.
- **Verified:** 460 tests green (incl. 4 new — hero values, absorb-then-overflow, game-over needs both gone,
  deserialize heal), typecheck + lint clean. Live: a Warden run started 30 / +8; losses chipped Armor 8→4→0
  then overflowed onto Resolve (29 → 24); the HUD bar + `30+8` + hero-select `+15`/`+8` chips render.
### fix: pin the combat HUD (Skip + speed slider) to the stage box

The in-combat HUD (`.combathud` — the Skip button + replay-speed slider) was anchored to the raw window
(`top: 146u; right: 16u`) instead of the letterboxed stage box, so with a fixed-resolution / non-16:9 window
it drifted into the letterbox, out of line with every other pinned element. Now uses `top: calc(var(--bar-y)
+ 146u); right: calc(var(--bar-x) + 16u)` — the same stage-box anchor as `.gearbtn` / `.statusbar`. Verified
live under a forced letterbox (bar-x = 238): the HUD's right edge measured 254px (= bar-x + 16), exactly
matching the gear button (was 16px, 238px adrift).
### feat: "Reset my career" control in Settings

A **Career** section in [EscMenu.tsx](packages/ui/src/EscMenu.tsx) with a two-tap-confirm **Reset my career**
button (mirrors "Clear my boards") that wipes the **local** career — the persisted `ascent.profile` (rating +
Line back to 0 / Line 7) and `ascent.history` (match history). New store action `resetCareer` calls
`clearProfile` ([profileStore.ts](packages/ui/src/profileStore.ts)) + `clearRunHistory`
([runHistory.ts](packages/ui/src/runHistory.ts)) and sets `profile: initialProfile()` / `lastRating: null`.
Clearing `ascent.history` wipes **past games, insights, and per-hero stats in one go** — they're all derived
from that log by `careerStats`, not stored separately. A `careerVersion` counter (bumped by `resetCareer`)
keys the Career page's history read, so an **open** Career view drops its stale insights/hero rows immediately
instead of only on reopen. Copy spells out the full scope ("wipes rating + past games + all stats").
Deliberately scoped to local career only — it does **not** touch the in-progress run, captured boards (the
separate "Clear my boards"), or the shared Supabase pool/leaderboard (those reset via SQL, admin-side; see the
handoff notes). Verified: typecheck + lint clean; live — seeded a 3-run/2-hero history, opened Career (insights
+ hero rows populated), tapped reset → the open view fell to the empty state, hero rows + past games gone,
`ascent.history`/`ascent.profile` removed, profile back to 0/Line 7.

### tweak: new players start at rating 0 (Line 7), not 1200 (Line 9)

`STARTING_RATING` 1200 → **0** in [playerRating.ts](packages/sim/src/playerRating.ts). By the existing bands
(0–799 → Line 7) a fresh player now begins at the **bottom of the ladder — Line 7** — and climbs, instead of
starting mid-tier. Only the *starting* rating changed; the band thresholds, delta table, and promotion/demotion
buffer are untouched. Rating still floors at 0. Updated the `initialProfile` test (0 / Line 7) + the doc
comments in playerRating.ts / profileStore.ts. Note: existing stored `ascent.profile`s keep their value — this
only affects new/reset profiles. Verified: 456 tests green (incl. the updated starting-profile case), typecheck
+ lint + build clean; live — a fresh profile loads 0 / Line 7 and hero-select reads "Rating 0 · Line 7 · Cover 7
wins · Strong 9+".
### feat: settle on board1 as the game board; drop the board picker, keep the dimmer

With the board aesthetics chosen, the multi-board selector (a testing aid) is retired: **board1** is now the
single game board (`.app` + hero-select), and the **Board dimming** slider stays (still `--scrim`,
default 15%). Removed `BOARD_OPTIONS` + the thumbnail-grid picker from [EscMenu.tsx](packages/ui/src/EscMenu.tsx)
(the section is now just **Board** → the dimmer), the `board`/`--board-img` state + effect from
[Game.tsx](packages/ui/src/Game.tsx), and the `.escboardpick`/`.escboardtile` styles. The `.app` and
hero-select backgrounds point straight at `board1.webp`. Encoded `board1.webp` (1680w, q82, 104 KB) and
deleted the now-orphaned `board4/5/7/8/9/10/11.webp` from `apps/web/public`. The stale `ascent-board`
localStorage key is simply ignored. Verified: typecheck + lint + `build:web` clean; live — `.app` uses
board1, Settings shows only the dimmer (15%), no thumbnails.

### feat: rating system — rating-derived Line, run-end delta, Career/end-screen surfaces

The career skill-pressure layer (handoff "Rating System") on top of the existing course/Line scaffolding
(A1/A2). A run's **Line** (par) now comes from the player's **rating** instead of the static
`CONFIG.defaultLine`, and finishing a scored run moves the rating by how the scored-win count compared to
the Line, plus a summit bonus. Built local-first but structured so the eventual move to Supabase-backed
accounts is a swap of the persistence layer, not a rewrite.

- **Pure math in `@game/sim`** — new [playerRating.ts](packages/sim/src/playerRating.ts): `PlayerProfile`
  (`rating`, `currentLine`, `highestRating`, `highestLine`, reserved `lineGrace?`), `lineForRating`,
  `resolveLine` (promotion/demotion hysteresis — a 75-pt buffer so a player near a band edge doesn't yo-yo),
  `lineRatingDelta` (the handoff table: +36/+30/+22/+14/+6/−8/−16/−24/−32), and `resolveRunRating(profile,
  outcome)` returning the new profile + a breakdown. Deterministic + side-effect-free (no storage, no
  `Math.random`), so the *same function* can run server-side later to re-verify a delta from the replay.
- **Line from rating** — `createRun` takes an optional `line` (defaults to `CONFIG.defaultLine` for
  tests/tools/boot); the store passes `profile.currentLine`. Starting rating **1200 → Line 9** reproduces
  today's default exactly.
- **Persistence seam** — new [profileStore.ts](packages/ui/src/profileStore.ts): one `ascent.profile`
  localStorage object (maps 1:1 to a future `profiles` row), the single read/write point. Run history
  (`RunHistoryEntry`, still `v:1`) gains optional `ratingBefore/After/Delta` + `lineDelta`.
- **Store wiring** — `store.ts` loads the profile at boot, sets the run's Line from it, and on each scored
  run's finish computes `resolveRunRating`, persists the profile, exposes `lastRating` for the end screen,
  and stamps the rating fields into history. Practice stays unscored.
- **UI surfaces** — end screen shows the rating delta + summit bonus + promo/demo tag and its copy is
  standardized on **"Line"** ("PAR COVERED" → "LINE COVERED", verdicts read "Line 9 · Covered / Exceeded +2
  / Missed −2"); Career replaces the "Unranked" placeholder with rating + Line + high-water marks (and shows
  the rating on the empty state); hero-select telegraphs the run's Line ("Rating 1200 · Line 9 · Cover 9
  wins · Strong 11+").
- **Deliberately NOT touched:** matchmaking (stays wave/power-first — rating is expectation, not difficulty)
  and the new-Line grace buffer (reserved field; a follow-up).
- **Verified:** 456 tests green (incl. 15 new — the 5 handoff worked examples + band/hysteresis/floor cases),
  typecheck + lint + `build:web` clean. Live (throwaway run, real save/profile backed up + restored): a fresh
  profile loads 1200/Line 9; `run.line` = 9; an empty-board loss to round 5 graded 0 wins → `−32` → rating
  1200→1168 with no demotion (held above the 1125 buffer) and the high-water mark held at 1200; end screen
  rendered "LINE 9 · MISSED −9" + "RATING −32 · 1168"; the history entry carried the rating fields; the
  hero-select + Career surfaces rendered the rating.

### feat: board-art selector + dimming slider in Settings

A **Board Art** section in [EscMenu.tsx](packages/ui/src/EscMenu.tsx) to compare the illustrated
game-board backgrounds without a rebuild: a thumbnail grid (`BOARD_OPTIONS`, active tile ringed) plus a
**Board dimming** slider. [Game.tsx](packages/ui/src/Game.tsx) owns both bits of state (persisted to
`localStorage` as `ascent-board` / `ascent-scrim`, mirroring the existing `res` scaler) and applies them
as `--board-img` + `--scrim` on `:root`. The `.app` board background reads
`var(--board-img)` for the image and `calc(0.34 * var(--scrim)) … calc(0.46 * …)` for the readability
scrim, so the slider scales the overlay live.

- **New defaults (owner call): board8 at 15% dimming.** The scrim multiplier defaults to **0.15** (a light
  dim — the board art reads much more vibrant than the old flat 0.34→0.46 scrim, which was making it look
  darker/duller than the source). Slider range 0–150%, 100% = the old tuned value.
- **Hero-select decoupled:** the pre-run hero picker keeps its own heavier fixed scrim (0.62→0.70) for card
  readability — the slider/default only affect the in-game board.
- **Art pipeline:** the source PNGs in `Ascent Art/Game Boards` were encoded to `apps/web/public/boardN.webp`
  via sharp (1680px wide, q82 — 58–253 KB each; both source + webp are plain sRGB, no profile loss). Available
  boards are the ones present in the folder: **4, 5, 7, 8, 9, 10, 11**.
- **Note:** the picker currently ships to players (not DEV-gated). Flagged for review — trivial to wrap in
  `import.meta.env.DEV` if it should be dev-only.
- **Verified:** typecheck + lint clean, 441 tests green, `build:web` OK. Live: all 7 boards serve real
  `image/webp`, the picker renders 7 tiles, the slider drives `--scrim` (30% → `.app` alpha 0.10/0.14), and a
  fresh browser defaults to board8 @ 0.15.

## 2026-07-01 (session 11)

### fix: Rise retaliation bug, choose-one cards, resume-clock exploit, + content/visual tweaks

Owner batch (session 12). Done this pass:
- **Rise retaliation damage bug (combat).** An attacker striking a Rise minion took the *risen* (base) attack
  back, not the body it clashed with — the main hit killed-and-rebuilt the target within `dealDamage`, then
  the retaliation read its reset attack. Now the defender's counter-attack (+ venom) is snapshotted **before**
  the hit ([simulate.ts](packages/core/src/combat/simulate.ts)): hit a 100-attack Knight, take 100 back.
- **Fleeting Vigor now scales with spell power** (owner-confirmed) — its banked +2/+1 gains the run's spell
  power on both stats; `spellDisplayText` shows the live value.
- **Wildwood Shaper → Choose One:** *Give your Beasts +1/+3* **or** *summon a 1/1 Stray* — the first card to
  use the (previously unused) choose-one engine. Updated its test.
- **Gilded Selfless Sentinel gives TWO friends a Divine Shield** (`deathrattleGrantShield` golden-aware +
  goldenText).
- **Gilded cards are more obvious** — a thicker, brighter gold ring + stronger glow (board + full card).
- **Resume-clock exploit closed** (#continue): `continueRun` now sets the turn clock to **0**, so resuming a
  shop turn (or leaving to the title to bank time) starts expired — you can End Turn / reorder but not shop.
  The next turn's timer returns to normal.
- **Overlays pause the recruit:** `overlayOpen` now also covers the Career + Compendium, so a saved game never
  ticks/runs behind them.
- **Verified:** 439 tests green, typecheck + lint clean. Live: Wildwood's two options render + apply
  (Shaper → 3/5); resuming shows the clock expired; the golden card's ring/glow reads clearly.

Second pass — the queued items:
- **Enemy-snapshot auras on Rise** (the flip side of the retaliation bug): `applyAuras` bailed on every
  non-player minion, so a captured enemy Eternal Knight lost its enchant when it Rose. Now the aggregate
  run-wide auras (Undead / Imp) stay player-only, but the **per-card enchant re-applies from the minion's own
  buff breakdown** for BOTH sides — so an enemy Knight (snapshot carries `buffs`) re-gains it on Rise (test:
  enemy Knight Rises 18/11, not 3/1). [simulate.ts](packages/core/src/combat/simulate.ts).
- **Godfodder animation** — Drakko re-fires its Battlecry, but each fire *overwrote* `fodderEaten`, so only one
  ghost animated. `applyBattlecryTarget` now clears `fodderEaten` once up front and the consume **appends** per
  fire, so N Fodder show N ghosts (verified: a Drakko'd Godfodder feeds 2, target 2/2 → 4/4, 2 events).
- **Gilded toggle in the Compendium** — [MinionBook.tsx](packages/ui/src/MinionBook.tsx) gets a "Gilded"
  toggle that flips every card to its tripled form (doubled stats, golden frame, golden text). Verified all
  116 cards gild.

- **Apples → Choose One** (the last item) — two new mechanics:
  - **Spell choose-one** — a SPELL choice, its own thing (not a Battlecry). `chooseOne` on the state now carries
    a `spell` flag; the reducer's spell path pauses (keeping the spell in hand) and the `chooseOne` handler
    casts the chosen option's effects (a synthetic def, Yazzus-quantity aware) then consumes it. The existing
    "Choose One — {name}" overlay already reads off the def, so it renders for spells unchanged.
  - **`spellBuffNextShop`** — banks a `nextShopBuff` that `refreshTavern` folds onto the NEXT roll's offers,
    then clears (registered in the effect-id schema + type).
  - Apples is now *Choose One: give the shop **+1/+3**, or the next shop **+2/+4***. Tests for both options
    (+ the buy-bake-in and the next-roll application); verified live end-to-end (overlay renders "Choose One —
    Apples", "next shop" banks +2/+4 and lands on the next refresh).

**Batch complete — all 11 items done.** 441 tests green (+ new coverage for choose-one, enemy-Rise auras,
Apples), typecheck + lint + build:web clean.

### fix: Rise→1 HP, no gilded text on cards, live discover/shop values, reorder after the timer

- **Rise (Reborn) now returns at 1 Health** (Hearthstone-style), regardless of the card's base — a golden
  minion reborns at 2. Base attack + the run-wide carry-through / auras still apply on top (so Karthus reborns
  at 7/1, not 7/8). [simulate.ts](packages/core/src/combat/simulate.ts) `killOrReborn`; updated the reborn HP
  assertions in [simulate.test.ts](packages/core/src/combat/simulate.test.ts). *(Owner-requested rules change.)*
- **No gilded text on cards.** Removed the "(Golden: +6)" parenthetical baked into Karthus's `text`
  ([undead.ts](packages/content/src/cards/undead.ts)) — it was the only card leaking a golden hint onto its
  non-golden face.
- **Discover + shop always show a card's CURRENT value.** Extracted the full live-text chain into a shared
  `liveCardText` in [instView.ts](packages/ui/src/instView.ts); `instView` (board/end screen), `shopView`, and
  the Discover overlay now all use it, so Grim reads **+32/+32**, Guel its live grant, etc. — not the printed
  base — wherever it's offered. (Previously the shop only did Grim's tally; Discover was fully static.)
- **Reorder your board after the clock runs out.** When the recruit timer expires you can now still
  drag-reorder your board minions ([Recruit.tsx](packages/ui/src/Recruit.tsx) — the drag gate allows a `board`
  source through when `timeUp`); play / buy / **sell** stay locked (sell drop + sell zone gated on `!timeUp`).
- **Verified:** 439 tests green, typecheck + lint + build:web clean. Live: Discover Grim shows +32/+32; Karthus
  text has no gilded line; with the timer expired (End Turn `urgent`), dragging a board minion fired a
  `reposition` (order changed) while the sell zone stayed hidden and no sell/gold change occurred.

### tweak: declutter the combat arena — no team tints/vignette, Skip + speed moved top-right

- **Removed the combat-area coloration.** The two faint team-tint bands (`.app.fighting` — enemy raspberry on
  the tavern row, player orange on the warband row) and the win/lose **result vignette** (`.app.combat.done::after`,
  the green-on-win / raspberry-on-lose screen glow) are gone — the arena stays uncoloured through the fight.
- **Skip button → top-right, smaller.** During the replay the Skip button now lives in a compact top-right
  **combat HUD** ([Recruit.tsx](packages/ui/src/Recruit.tsx)) instead of the big centred button, with the
  **replay-speed slider stacked beneath it** (moved out of the HudBar). Sits under the opponent frame in the
  right column; the run-buffs window is hidden during combat so nothing collides. Post-combat Summary / End
  Combat still render centred.
- **Verified live:** in a (slowed) fight the board shows no tint/vignette, and the orange Skip + speed slider
  sit stacked top-right with no overlap. 439 tests green, typecheck + lint clean.

### tweak: round-bar "Setup" rename + a pre-round notch on the meter

- Renamed the pre-round HUD label **"Calibration" → "Setup"** ([HudBar.tsx](packages/ui/src/HudBar.tsx),
  tooltip updated to match).
- Added a **notch on the round meter** at the end of the calibration/Setup rounds
  (`left: calibrationRounds / courseRounds`, i.e. 2/17 ≈ 11.8%) — a thin card-coloured vertical gap with dark
  edges so it reads on both the orange fill and the empty track. It visually separates the pre-round Setup
  segment from the scored climb. Recruit/combat only (hidden in Practice, which has no calibration).
- **Verified live:** the meter renders the notch at 11.76% and the label shows "Setup"; typecheck + lint clean.

### fix: title menu-video no longer flashes the still image before playing

- On load the `.titlescreen` webp base (also the `<video>` poster) showed until the video decoded its first
  frame, then **popped** to the video — a visible flash. Fix: the video now starts at `opacity: 0` and only
  fades in (`.titlevideo.ready`, 0.5s) once it fires its `playing` event (`onPlaying` → `videoReady` state in
  [Title.tsx](packages/ui/src/Title.tsx)), so it **cross-dissolves from the webp** instead of hard-cutting.
  Added `preload="auto"` so it's ready sooner. Reduced-motion still hides the video entirely (unchanged).
- **Verified:** opacity is 0 with no `ready` class until the video plays, then transitions to 1; typecheck +
  lint clean. (A truly cold, uncached load can't be captured in-preview — the browser caches the 31 MB clip —
  but the fade path is confirmed.)

### feat: custom build-tag tooltips + unified orange Discover minimize/return button

- **Build-tag tooltips** were the browser's native `title` bubble (plain, OS-styled). Replaced with a custom
  `.tagtip` — a dark rounded card with a caret, on-theme fonts, fading in above the chip on hover — rendered
  as a child of each `.endtag` on both the end screen and Career (removed the `title` attrs). Not clipped by
  the Career match cards' `overflow: hidden` (measured clearance; collapsed rows have more room).
- **Removed the Discover subtitle** ("Choose a minion from the next tier.") — it was unnecessary and factually
  wrong (Discover options can be from any tier, not just the next), so the `.disc-sub` line + its CSS are gone;
  `.disc-cards` gains a small top margin to keep breathing room under the banner.
- **Discover minimize/return** was two buttons in different spots (a dark "Minimize" pinned top-right of the
  panel + an orange "Return" pill at the screen bottom). Unified into **one orange `.disc-toggle`** pinned to
  the **same fixed spot just below the cards** (`top: 66%`) for both states — it flips label/action between
  Minimize (inspect the board) and "Return to Discover · N options", so the player toggles back and forth
  **without moving the mouse**. Verified live: the button's center is identical (954, 920) in both states.
- **Verified:** 439 tests green, typecheck + lint + build:web clean. Live: the Discover toggle is orange,
  centered under the cards, and swaps in place; the tag tooltip renders the styled card with the right copy.

### feat: Career redesign (Profile+Insights panel, hero W–L), bigger avatars, font dev lab

- **Bigger avatars.** Menu (`.titleavatar`) **+100%** (46→92px); Career (`.caravatar`) **+50%** (84→126px),
  placeholder glyphs scaled to match.
- **Career layout rebuilt.** Dropped the 4-square stat bar; the left column is now **one panel** = Profile +
  Insights + a per-hero record, and it's **wider** (320px). Insights grew from 5 to **11 rows**: Runs, Best
  Run, Win Rate, Avg Wins, Avg Actions/Round, Avg Gold Spent, Favorite Hero/Tribe/Mechanic/**Minion**, Current
  Streak. The old bottom "By hero" section moved into the panel as **line W–L** (green W / red L).
- **New stats** in `careerStats` ([runHistory.ts](packages/ui/src/runHistory.ts)): `favoriteMinion` (the
  minion most-used across final boards) + per-hero `lineWins`/`lineLosses` (runs that covered par vs fell
  short — the game's win = cover-your-line). Tests added for both.
- **Font Lab (dev).** [FontLab.tsx](packages/ui/src/FontLab.tsx) — a bottom-right toggle on the title opens
  three font pickers (**Titles / UI / Body**) with **Outfit, Sora, Plus Jakarta Sans, Nunito Sans**. To make
  it work, the stylesheet's `font-family`s were routed through CSS variables — `--font-title` (big display
  headings: `.disp` / `.hstitle` / `.titleword` / `.over h1`), `--font-ui` (everything else that was Outfit),
  `--font-body` (was Nunito Sans). The picker sets those vars on `:root` live, persists to `ascent.fonts`, and
  applies at boot. Loaded Sora + Plus Jakarta Sans via the Google Fonts link.
- **Verified live:** menu avatar visibly 2×; Career shows the merged panel with all 11 insights + hero W–L
  (Cassen 1W–1L, Robin 1W–0L, …) and Favorite Minion; Font Lab swaps "ASCENT" to Sora and back, persisting.
  439 tests green (+2), typecheck + lint + build:web clean.

### fix: avatar picker z-index + custom cursor over avatar buttons and scroll areas

- **Picker opened *behind* the Title/Career.** `.avatarpick` was `z-index: 80`, but `.titlescreen` is 450 and
  Career (`.lbpage`) is 470 — so clicking the avatar opened the picker underneath them ("nothing pops up").
  Raised `.avatarpick` to **z-index 520** (above every title/career/leaderboard/compendium overlay). Verified
  `elementFromPoint` at screen-center now hits the picker over both the Title and Career.
- **Custom cursor over the avatar buttons.** `.titleavatar` / `.caravatar` / `.avatarpick-opt` /
  `.avatarpick-close` set plain `cursor: pointer`, which overrode the global `button` rule and reverted to the
  OS arrow — swapped to the game's `gauntlet_open.svg` cursor.
- **Custom cursor over scroll areas (hero page, compendium, avatar picker, leaderboard/career, combat log).**
  Root cause: a native scrollbar *forces* the OS arrow — the browser ignores `cursor` on it, even on a styled
  `::-webkit-scrollbar` (the compendium already tried that and it didn't work). Fix: **hide the native
  scrollbar** on those containers (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) and
  scroll by wheel/trackpad — the gauntlet cursor now covers the whole area. Removed the old ineffective
  book-grid scrollbar-cursor block.
- **Bonus:** the practice hero picker overflowed (12 heroes, ~1645px in a ~1352px viewport) with
  `overflow: visible`, so the bottom heroes were **clipped and unreachable**. `.heroselect` is now
  `place-items: safe center; overflow-y: auto` — it scrolls (heroes reachable) without clipping the top, and
  the hidden-scrollbar rule keeps the cursor clean. Same win for a tall end screen on short viewports.
- **Verified live:** picker renders on top of Title + Career; avatar/scroll cursors are the gauntlet SVG;
  compendium, hero page, and picker all scroll with `nativeBarPx: 0`. 437 tests green, typecheck + lint clean.
- *Tradeoff flagged to owner:* the native scrollbars are now hidden (wheel-scroll only). If a visible bar is
  wanted back, the next step is a custom overlay scrollbar element (keeps both the bar and the custom cursor).

### fix: avatar picker could linger into gameplay — gated to Title/Career + reset on run start

- The avatar-picker overlay (`avatarPickerOpen`) had no reset on navigation, so a lingering-true flag could
  show the picker over a run ("the avatar selection is happening when a game starts"). Two-part fix:
  **(1)** [AvatarPicker.tsx](packages/ui/src/AvatarPicker.tsx) now renders only when `showTitle || showCareer`
  (its only entry points) — a defensive gate so it can never cover gameplay regardless of the flag; **(2)**
  every leave-the-title / run-entry store action (`startAscent`, `startPractice`, `pickHero`, `newRun`,
  `continueRun`) now sets `avatarPickerOpen: false`. Verified live: forcing the flag true mid-recruit renders
  nothing; opening it on the title still works and clicking PLAY clears it. 437 tests green, typecheck + lint clean.

### feat: round-board viewer (inline board swap), live final-warband values, avatar picker

- **Round-board viewer.** The end screen's W/L pips are now clickable: clicking a round **swaps the FINAL
  WARBAND board in place** to show the exact board you fought that round (not a popover — per owner request),
  and the board label becomes a `Round N · Won/Lost ↩ Final warband` button that returns you. The boards are
  re-derived deterministically from the run's replay (`replayRun({seed,heroId,actions})` → per-wave
  `BoardSnapshot`s), memoized once, keyed by wave. Best-effort (a replay hiccup just leaves pips
  non-clickable), and **gated to Ascent** — `replayRun` re-runs in ascent mode, so a practice replay
  (unlimited Resolve / 15-round cap) wouldn't reconstruct faithfully. *Note: replay fidelity holds within a
  session; a run whose early waves were played in a **prior** session can diverge if the opponent pool
  changed since — the end-screen use (run just finished, same session) is always faithful.*
- **Live values on the final warband.** Extracted `instView` (the recruit board's live-`CardView` composer)
  out of `Recruit.tsx` into a shared [instView.ts](packages/ui/src/instView.ts) and pointed the end-screen
  final warband at it, so scaling cards (Guel, Sergeant, Taragosa, Mama Bear, …) show their **accumulated**
  magnitude at run's end instead of the printed base "+1/+1". Recruit's behavior is unchanged (same function,
  same call sites); `EndScreen`'s `boardView` now feeds `instView` the run-wide live inputs
  (`spellAttackBonus`/`spellHealthBonus`, undeadBuyAtk, soulsmanGold, cardBuffs, …).
- **Avatar picker.** New [AvatarPicker.tsx](packages/ui/src/AvatarPicker.tsx) modal lets the player pick any
  bundled art — **heroes / minions / tokens / hero powers** (156 options, enumerated via a new `AVATAR_ART`
  export in [art.ts](packages/ui/src/art.ts), namespaced `hero:`/`minion:`/`power:`) — as their profile
  avatar. Persisted, cosmetic, local (`playerAvatar` + `setPlayerAvatar` + `avatarPickerOpen` on the store,
  `ascent.avatar` in localStorage). The avatar renders on the **Title account chip** and the **Career profile
  card**, and clicking either opens the picker (a "Default" tile clears back to the name initial).
- **Verified:** 437 tests green, typecheck + lint clean. Live (drove real in-session runs to gameover):
  clicking a pip swaps the board in place with the round's real stats and a working back control, no popover;
  the picker opens with all 156 options, and a pick persists + updates both the Title chip and Career avatar
  images. *Caveat surfaced to owner: an early live-test consumed the in-progress "Continue" run — use a
  throwaway `newRun` when driving the store, not the player's saved run.*

### feat: end-screen polish — real APT, tag tooltips, bigger metrics, drop pool text

- **Actions/round is now player decisions only.** APT counted *every* state-changing action ÷ rounds,
  which included the automatic combat-flow transitions (`faceOmen` / `settleCombat` / `resolveCombat`,
  ~once per round each) — inflating the number by a flat ~3/round. Added `isPlayerAction` in
  [state.ts](packages/sim/src/state.ts) (a small `COMBAT_FLOW_ACTIONS` exclusion set) and filtered the APT
  calc through it in both places it's computed ([store.ts](packages/ui/src/store.ts) for the saved Career
  entry, [EndScreen.tsx](packages/ui/src/EndScreen.tsx) for the live end screen). It already included the
  buys/plays/rolls/discovers the owner cared about — this just strips the phase-advance noise.
- **Build-tag tooltips.** Tags were bare strings. Added `TAG_INFO` in
  [buildTags.ts](packages/sim/src/buildTags.ts) — a terse one-line description for all 29 tags (tribe
  archetypes, trigger-density, keyword walls, board-shape, history-arc) — and wired it as a `title` hover on
  every tag chip on both the end screen and the Career match rows.
- **Bigger run metrics.** `.endstats` bumped 14→18px and brightened (0.62→0.8 alpha) so the triples / gold /
  APT / cards / MVP / strongest line reads at a glance. *(The owner also floated "maybe stack them vertically
  off to the side" — deferred to the end-screen layout pass that lands with the round-board viewer.)*
- **Removed the "Added N boards to the pool" line** (+ its `.endcontrib` style and the now-unused
  `lastRunBoards` read in EndScreen). Board capture/upload still happens; it's just no longer surfaced here.
- **Verified:** 437 tests green, typecheck + lint clean. Live: drove a finished run into the store — metrics
  render larger, tag chips carry their tooltip text, the pool line is gone. Gold-spent confirmed already
  correct (single `spendGold` chokepoint sums buys/rerolls/tier-ups/hero powers), so no change there.
- **Queued next (owner greenlit):** round-board viewer (click a W/L pip → that round's board via
  `replayRun`), live card values on the final warband (scaling cards show accumulated stats, not base text),
  and a player-avatar picker (choose any hero/minion/token art). Follow-up PRs.

### fix: par is the win condition — covering the line wins the run even if you then fall

- **Bug (the big one):** `lineResult` in [state.ts](packages/sim/src/state.ts) forced `status = 'failed'` on
  **any** gameover (Resolve 0), *regardless of wins*. So a run that beat par — e.g. **11 wins against par 9**
  — but died on round 16 of 17 graded `failed` and the end screen read **FALLEN / COURSE FAILED**. Par is
  supposed to *be* the objective; covering it should be a win whether or not you survive to the final round.
- **Fix — grade against par, death only breaks a tie under it.** `lineResult` now grades purely on scored
  wins vs par (`flawless` = won every scored round, `exceeded` > par, `covered` = par); only **under par** is
  a loss, split into `failed` (died early) vs `missed` (survived the course but short). Added a single
  exported source of truth, **`metLine(status)`** (covered/exceeded/flawless = a win), and routed every
  surface through it:
  - **End screen** ([EndScreen.tsx](packages/ui/src/EndScreen.tsx)) — win/loss title + gold styling now key
    off `metLine`, not course-completion. A covered-par-but-died run shows **PAR COVERED** (gold) / "You
    covered your line" while the sub-line still honestly reads "fell on round N of M". Course actually
    finished + covered → **COURSE COMPLETE**; under par → **FALLEN**.
  - **Career** ([Career.tsx](packages/ui/src/Career.tsx)) — the match-row record color (won/lost) is now
    par-based via `metLine`.
  - **Build tags** ([buildTags.ts](packages/sim/src/buildTags.ts)) — `Underdog Line` reuses `metLine`.
- **Also:** removed the **"the tide takes you"** loss eyebrow (now empty for a genuine FALLEN). And folded
  the earlier Career fix in — `careerStats().winRate` = runs that met their line / total runs (the local
  `metLine` copy is gone; it imports the shared one). A run of three all-failed climbs reads **0%**.
- **Verified:** full suite **437 green** (updated `run.test.ts` + `runHistory.test.ts` to the new par
  semantics — incl. a regression for "died but covered par → exceeded"). typecheck + lint clean. Live: drove
  a gameover run with 11 wins / par 9 into the store — end screen renders **PAR COVERED / EXCEEDED (+2)**,
  gold; a 3-win/par-9 death still renders **FALLEN / Course failed** with no leftover eyebrow. Screenshots
  captured.

### feat: looping menu-ambience video on the title screen

- The title screen now hosts an **autoplaying, looping `<video>`** (`.titlevideo`) behind the menu, sourced
  from `/homescreen.mp4`. Layering: the `homescreen.webp` is now the title's **base background + the video
  `poster`** (so if the file is absent or still loading the screen looks exactly as before); the video sits
  above it (`z-index:0`, `object-fit:cover`); the **left vignette moved to `.titlescreen::before`**
  (`z-index:1`) so it tints the video the same way it tinted the still; the menu / account / version sit at
  `z-index:2`. Hidden under `prefers-reduced-motion` (falls back to the webp base).
- **Audio.** The clip has a soundtrack. Browsers block autoplay *with* sound, so `muted` is controlled
  imperatively (a Title effect): it starts by trying the desired state and, if the browser blocks unmuted
  autoplay at cold boot, falls back to muted playback and **unmutes on the first user gesture** (pointer /
  key). It honors the game's **mute + master-volume** (`isMuted()` / `getVolume()` from `sfx.ts`), so the
  Settings mute silences the menu too. Returning to the title after a run (audio already unlocked) starts
  sound immediately.
- **Asset wired:** `apps/web/public/homescreen.mp4` — a ~31 MB, 28.7s, 3440×1440 (ultrawide) H.264 loop
  (compressed down from a 115 MB source). `object-fit:cover` fills the viewport and crops the ultrawide
  frame. Only the **title** ("main menu area") gets the video; Career/Leaderboard keep the lighter static
  webp. *(Note: 31 MB is above the ~10 MB target — fine for now, worth a further compression pass before a
  size-sensitive distribution.)*
- **Verified:** typecheck/lint/build green. Live: the `<video>` plays (`readyState 4`, advancing, looping,
  `currentSrc` = homescreen.mp4) full-bleed with the menu legible over the vignette; screenshot confirmed.
### feat: Career page redesign — stats bar + Profile / Match History / Insights columns

- **Reworked the Career overlay** (`Career.tsx`) from a flat list into the requested three-column layout:
  - **Top stats bar** — Runs · Best Run (record of the highest-win run) · Avg Wins · Win Rate.
  - **Left Profile Card** — a big initial avatar (falls back to the anvil icon), the account name, an
    **"Unranked"** placeholder pill (no Level/XP — those wait for a real rating system, per the owner), and a
    Completed / Flawless / Streak mini-stat strip.
  - **Center Recent Match History** — the match cards are now **click-to-expand** (newest starts open):
    collapsed shows hero · record · line verdict · tags; expanded reveals the run-stat line (triples · gold ·
    APT · cards · MVP · most-mechanic · strongest) **and** the final warband. A chevron rotates on toggle.
  - **Right Insights rail** — Favorite Hero, Favorite Tribe, Favorite Mechanic, Win Rate, Current Streak.
  - The **By hero** rollup stays below, full-width. Columns stack under 900px.
- **`careerStats` gains `winRate` (scored wins / all scored rounds, %), `streak` (consecutive newest runs
  that met their line), and `bestRun` ({wins,losses} of the highest-win run).** Pure; unit-tested (win rate,
  best run, current streak, streak-breaks-at-newest-miss + the empty-return shape).
- **Verified:** 434 tests green; typecheck/lint/build green. Live: seeded a varied 4-run history → the stats
  bar (4 · 12–3 · 9.5 · 63%), profile card, expandable cards (warband + stats render on expand, chevron
  rotates), and insights (Warden / Beast / Start of Combat / 63% / 2 on line) all render correctly.

### feat: combat-contribution tracking — MVP minion + most-triggered mechanic

- **New `packages/sim/src/contribution.ts`** — pure helpers that walk a settled combat's event log (+ its
  `initial` rosters) to attribute **player-side damage by cardId** and count **player mechanic triggers**,
  then accumulate both across the run. No `simulate`/`core` change: everything is derived from the
  `CombatResult` the reducer already has.
  - **Damage.** Combat is *simultaneous* — one `attack A→B` emits a `dmg` to B (dealt by A) **and** a `dmg`
    to A (B's retaliation). So each `dmg` is credited to whichever of the attack pair *isn't* taking it, and
    only when the target is an enemy (a card is never credited for damage it soaks). Start-of-Combat `cast`
    damage is credited to the caster. This correctly attributes retaliation kills (the common killing blow).
  - **Procs.** Player-side `sc → Start of Combat`, `rally → Rally`, `summon → Summon`, `reborn → Rise`,
    `shieldUp → Ward`, and a player card's `death` whose `CardDef` has an `onDeath` effect → `Echo`.
  - `runMvp(runDamage)` → the top-damage card; `topMechanic(runProcs)` → the most-fired mechanic.
- **`RunState` gains `runDamage` + `runProcs`** (init `{}`, deserialize-healed for old saves); `settleCombat`
  calls `accumulateContribution(...tallyCombat(result))` after pushing the round result.
- **Post-run summary** gains **MVP: <card> (N dmg)** and **Most: <mechanic> (N)** in the stats row.
- **Match history + Career** — each run stores `mvp` + `topMechanic`; the run rows show `· MVP: <card>`, and
  the profile strip shows **Favorite mechanic** (most-common per-run top mechanic across the career).
- **Verified:** 433 tests green (new `contribution.test.ts` covers the simultaneous-exchange crediting, the
  six procs, accumulation + MVP/top-mechanic derivation; `runHistory.test.ts` covers favorite mechanic).
  Live over 4 real combats: `gnash` accrued 64 dmg incl. retaliation kills → end screen reads
  *MVP: Gnasher, the Overrun (64 dmg)* · *Most: Start of Combat (6)*. typecheck/lint/build green.
- **Still deferred (Phase C / needs new signals):** biggest permanent-scaling source, Quest choices taken,
  Ancient — none are in the combat log; they'll come with the meta systems.

## 2026-06-30 (session 10)

### fix: end screen readability — own dark backdrop, board hidden

- The end-of-run screen no longer renders over the live board (which showed through, killing contrast). It
  now gets its **own dark backdrop** — the sky-castle art heavily scrimmed (`rgba(6,11,22,0.88→0.93)`) — and
  the board + status bar behind it are hidden (`body:has(.heroselect) .app/.statusbar { visibility: hidden }`,
  extended from the hero-picker to the end screen too).
- Fixed the **run-stats row** + **contributions line** (added this session) that used dark ink colors meant
  for a light background → now light (`rgba(255,255,255,·)`), readable on the dark backdrop.
- **Verified live:** the FALLEN screen reads cleanly — record, line verdict, tags, stats (triples · gold ·
  APT · cards · strongest), pips, and final warband all high-contrast over a clean backdrop.

### feat: run stats — gold spent, APT, triples, strongest + career aggregates

- **New `RunState.goldSpent`** — total Gold spent across the run, incremented at the single `spendGold`
  chokepoint (buys / rerolls / tier-ups / hero powers). Deserialize-healed for old saves.
- **Post-run summary** gains a run-stats row: **triples · gold spent · actions/round (APT) · cards played ·
  strongest minion** (APT + cards computed from the action log).
- **Match-history entry** now stores those stats plus the run's **dominant tribe** and **strongest minion**;
  `careerStats` aggregates **flawless count, total triples, avg gold, avg APT, and top tribes**.
- **Career screen** expands: profile strip adds Flawless / Triples / Avg gold / Avg APT; a **Top tribes**
  line; the match list is capped to the **last 25** and each row shows triples · gold · strongest.
- **Deferred (need per-minion combat-damage / proc counts out of `simulate`):** MVP minion, most-triggered
  mechanic, top *minions* played, Quest choices + Ancient (Phase C).
- **Verified live:** post-run row (4 triples · 143 gold · 4 APT · 14 cards · Strongest Gnasher 30/12) +
  Career aggregates (Flawless 1 · Triples 11 · Avg gold 128 · Avg APT 5.7 · Top tribes). Tests updated;
  typecheck + lint + `npm test` (421) + build:web green.

### feat: expanded build tags (A5+)

- Grew `buildTags` from ~11 to ~24 tags and bumped the display cap 3 → 4, so a run's identity reads richer.
  New tags, all computed from data we already track (board shape/stats, keywords, `history`, `triplesMade`,
  per-minion `buffs`, record vs line):
  - **Board shape:** Carry Stack (one monster holds most stats) · Wide Board (many bodies, no carry) ·
    Glass Cannon (attack-heavy + Flurry/Toxin) · Fortress Board (health-heavy + Ward/Taunt) · Token Flood ·
    Keyword Soup · Menagerie (mixed tribes).
  - **Progression / record:** Triple Hunter · Scaling Engine · Tempo Climber (strong early, fades) ·
    Late Bloom (weak start, strong finish) · Underdog Line (bad start, still covered) · Low Roll Survivor.
- History-arc tags need ≥6 scored rounds, so they only fire on a full-ish run.
- **Deferred** (need per-minion combat-damage / economy tracking we don't have yet): Economy Engine,
  Sacrifice Engine, Boss Killer, Perfect Curve, Pivot Run, Shop Sculptor, Spell Weaver, MVP-based tags.
- **Verified:** 5 new unit tests + existing A5 tests green. typecheck + lint + `npm test` (425) + build:web.

### feat: B3 — keyword / terminology pass — **Phase B complete**

- Player-facing keyword rename, **display-time only** (internal ids / keyword codes / card DATA unchanged, so
  low-risk + reversible): **Battlecry→Shout · Deathrattle→Echo · Divine Shield→Ward · Windfury→Flurry ·
  Venomous→Toxin · Reborn→Rise · Magnetize→Attach / Magnetic→Attachment · Golden→Gilded.** Kept: Taunt,
  Avenge, Choose One, Start of Combat, End of Turn, Rally, Cleave, Consume, Discover (Rally stays — not
  "Charge", per the design flag).
- New `terms.ts` `renameTerms()` (whole-word, plural-aware — Deathrattles→Echoes, etc.) applied to rendered
  **card rules text** in `Card.tsx`; the keyword-badge labels (`KW_LABEL`) + trigger pills (`triggerPill`)
  updated; the **combat-log narration + Procs summary** strings reworded grammatically ("rises at N HP",
  "Toxin destroys …", "N Wards broken").
- The tag names A5 already used (Shout/Echo/Ward/…) now match the in-game vocabulary.
- **Verified live:** the Compendium (114 cards) shows the new terms with **zero** old terms remaining; pills
  read Shout/Echo/Ward/Toxin/Flurry/Attachment/… `renameTerms` unit tests. typecheck + lint + `npm test`
  (424) + build:web green. **This closes Phase B (B1–B3).**
### feat: B1 — hero-power dragging

- Targeted hero powers now use the **same press-drag-release language as card drag**: press the power, drag
  the aim line onto a valid minion, release to fire; release off-target to cancel. One continuous gesture.
- The aim-line + fire-on-release logic already existed — the fix is arming on the button's **`pointerdown`**
  (not click), so the press flows straight into the drag. A quick **tap** (press+release without dragging)
  still arms it for the existing press-then-click-target flow, so nothing is lost. Untargeted powers still
  fire on press.
- **Verified live:** Warden's Fortify — press-drag-release onto a minion applied +1/+1 and cleared armed;
  release off-target cancelled; a tap still armed. typecheck + lint + `npm test` (421) + build:web green.

### feat: B2 — Discover minimize

- A pending **Discover** can now be **minimized** to inspect your board/shop before choosing — a "–" button
  on the panel collapses it to a floating **"Return to Discover · N options"** pill; the board is fully
  visible + inspectable (hover / right-click), and restoring reopens the pick.
- **Safety:** a new reducer guard blocks every other board action (buy / roll / play / sell / …) while a
  modal recruit state is pending (Discover / Choose One / targeted Battlecry) — so inspecting can't
  invalidate the pending pick. Only the resolving action (`discover`/`chooseOne`/`battlecryTarget`) passes.
  The behind-card shield FX stay visible while minimized.
- **Verified live:** opened a Discover → minimized (board visible, pill shown) → `roll` blocked (embers
  unchanged) → restored → picked (hand grew). New reducer test; typecheck + lint + `npm test` (421) +
  build:web green.

### feat: A7 (part 2) — Career screen — **Phase A spine complete**

- The title's **Career** button (was a placeholder) now opens a full-page **Career** overlay
  (`Career.tsx`, homescreen bg, reusing the leaderboard page shell) reading the local match history:
  - **Profile strip:** total runs · best wins · avg wins · courses completed.
  - **By hero:** per-hero rollups (runs · avg/best wins · completions), sorted by runs.
  - **Match history:** each run — hero portrait, colour-coded **W–L record**, **line verdict** chip
    (Exceeded/Covered/Missed/Failed), **build tags**, "Course complete / Fell on round N · date · N boards",
    and the **final-warband preview** (same `Card` as the leaderboard/end screen).
  - Empty state: "No runs yet — play a run to start your career." Rating is intentionally absent (no rating
    system yet).
- Store: `showCareer` + `openCareer`/`closeCareer`; `<Career/>` rendered in `Game.tsx`.
- **Verified live:** seeded 3 runs → profile (3 runs / 12 best / 7.7 avg / 2 completed), Rohan/Warden hero
  rows, 3 match entries with records + verdicts + tags + warband. typecheck + lint + `npm test` (420) +
  build:web green.
- **This closes the Phase A run/career spine (A1–A7).** Deferred within it: rating-driven par line (A2),
  MVP/standout-unit (A4/A6), and a per-run detail page (A7) — all noted in the roadmap.

### feat: A7 (part 1) — run-history persistence layer

- **Runs no longer disappear.** On run-end, a compact per-run entry is appended to `localStorage`
  (`ascent.history`, capped 50, newest first) — hero, W–L record, line + verdict, completed?, round reached,
  build tags (A5), tribes, boards contributed, and the final-board snapshot. Ascent runs only (Practice is a
  sandbox). New `runHistory.ts`: `buildRunHistoryEntry` + `loadRunHistory`/`saveRunHistoryEntry` +
  `careerStats` (overall + per-hero rollups). All best-effort.
- Wired into the store's existing deferred run-end capture (alongside the board upload), for both wins and
  losses. **No UI yet** — that's part 2 (the Career screen, which the title's placeholder Career button
  opens).
- **Verified:** unit tests for `buildRunHistoryEntry` (record/line/tags, died-run) + `careerStats`
  (empty / per-hero aggregation); live-checked a real run-end appends an entry. typecheck + lint + `npm test`
  (420) + build:web green.

### feat: A6 — post-run summary (build identity + contributions)

- The end screen now shows the run's **build identity** and **contributions**, on top of the record + line
  verdict already there — so a finished run reads as *authored*, not just completed.
- **Build tags** (A5's `buildTags`): a row of tag chips ("Beast Swarm · Gilded Carry · Spell Engine")
  under the line verdict (Ascent only; hidden for Practice / a genuinely mixed board).
- **Run contributions:** "Added N boards to the pool" — the count of snapshots this run added to the shared
  opponent pool. New `lastRunBoards` store field, set from `saveRunBoards(...).length` in the deferred
  run-end capture (0 for Practice / read-only; reset on a new run).
- **Deferred (same as A4):** MVP / key-unit needs per-minion damage tracking not on `CombatResult` — the
  final warband is shown, the "standout unit" call-out is a later add.
- **Verified live:** a completed course renders COURSE COMPLETE · Record 11–4 · Line 9 Exceeded (+2) ·
  Beast Swarm / Gilded Carry / Spell Engine · "Added 8 boards to the pool". typecheck + lint + `npm test`
  (416) + build:web green.

### feat: A5 — build-tag classifier

- New pure helper `buildTags(state)` in `@game/sim` (`buildTags.ts`) — reads a run's **final board** + a few
  run signals and emits up to **3 build tags** that give an emergent build an identity ("Spell Engine ·
  Gilded Carry · Flurry Finish"). Deterministic + testable; feeds A6 (post-run summary) and A7 (career).
- **Heuristic + thresholded scoring:** tribe archetypes (Beast Swarm / Dragon Scaling / Undead Army / Mech
  Battalion / Demon Legion), trigger density (Echo Web / Shout Chain / End-of-Turn Engine / Summon Overflow),
  keyword walls + finishers (Ward Wall / Toxin Control / Flurry Finish — reads *live* granted keywords),
  Gilded Carry, Spell Engine (spellsCast or a spell-power/aura carrier), Fodder Economy (fodder cards or
  run-wide Imp scaling), Attachment Carry (Mech-heavy welded body). Top 3 by score, strongest first; a
  tribal board that clears no other bar still gets its tribe tag, so identity is rarely blank.
- **Tag names lead with the intended flavor terms** (Shout/Echo/Ward/Toxin/Flurry/Attachment) even though the
  mechanic tooltips aren't renamed yet (B3) — tags are build labels, not rules text. **Not surfaced in the UI
  yet** — that's A6/A7.
- **Verified:** 8 unit tests (empty / tribe / deathrattle / keyword walls / gilded / spell / fodder / cap-3).
  typecheck + lint + `npm test` (416) + build:web green.

### feat: A4 — post-combat summary (permanent gains)

- The post-combat overlay (now **"Combat Summary"**, opened by the **Summary** button after a fight) leads
  with a new **Gains** tab: *"What you keep from this fight"* — the permanent value the fight left you with.
- Pure presentation over data **already carried** on `CombatResult` — no engine work. New `combatGains.ts`
  maps the carry-back channels to readable lines, most-impactful first: spell power, max Gold, Undead
  Attack, Imp/Fodder buffs, per-card run-wide enchants, kept/Engraved stats (aggregated), Fodder → next
  tavern, banked free rerolls, and cards added to hand. Empty fight → "No lasting gains this fight."
- The overlay keeps the existing **Procs** (major triggers) + **Log** (blow-by-blow) tabs and the outcome-
  odds bar; Gains is the default tab. `combatGains` unit-tested.
- **Scope note:** the roadmap's "Standout Unit" + "Risk Signals" sections are deferred (they need per-minion
  damage derivation, not currently on `CombatResult`); this ships the "Permanent Gains" core.
- **Verified live:** drove a real combat, opened Summary → the Gains tab showed the injected carry-backs
  ("spells +2/+1", "Max Gold +1", "Added to hand: Spirit Fire"). typecheck + lint + `npm test` (408) +
  build:web green.

### feat: A3 — save & continue

- **Runs now autosave and resume.** The in-progress run is persisted to `localStorage` (`ascent.save`) on
  every state change — the serialized `RunState` + the action log — and reloaded at boot. Quit mid-run,
  reopen, and the title shows a **Continue** entry (blue, "{hero} · Round n") that resumes the exact run.
- A **finished** run (victory/gameover) is not resumable — the save is cleared when the run ends, and
  starting a new run (Play/Practice) overwrites it. Both modes are saved.
- **Store** (`store.ts`): `loadSave`/`writeSave`/`clearSave` (best-effort, never throw); boots into the
  saved run behind the title; `savedRun` + `continueRun`; autosave wired into `dispatch` (clears on finish)
  + `pickHero`/`newRun`. Built on the existing `serialize`/`deserialize` (which heals older-schema saves).
- **Title** (`Title.tsx`): the Continue button (with the run's hero + round) appears above Play when a save
  exists; Play then reads "start a new run (replaces your saved run)".
- Autosave is per-action (clicks, not per-frame), so no combat-loop perf cost.
- **Verified live:** played a run, reloaded the page → Continue restored the exact state (embers, actions);
  Continue resumed; finishing cleared the save. typecheck + lint + `npm test` (405) + build:web green.

### feat: A2 — par / rating line

- Every run now carries a **par line** — a target number of scored wins to cover or beat. `RunState.line`
  (set at run start from `CONFIG.defaultLine` = **9**; static for now, a clean seam for the future
  rating-driven line). New `lineResult(state)` helper grades a finished run: **flawless** (won every scored
  round) · **exceeded** (+delta) · **covered** (met exactly) · **missed** (−delta) · **failed** (died before
  completing the course).
- **HUD:** a **"Line N"** label sits beside the record (Ascent only).
- **End screen:** a verdict row — **"Line 9 · Exceeded (+2)"** (green for flawless/exceeded/covered, threat
  red for missed/failed).
- **Verified:** `lineResult` unit tests (covered/exceeded/missed/flawless/failed) + the default-line test;
  typecheck + lint + `npm test` (405) green; live-checked the HUD line + end-screen verdict.

### feat: A1 — course + record (win-condition reframe)

- **The run is now a fixed course, scored by record.** A run plays `CONFIG.courseRounds` (**17**) rounds; the
  first `CONFIG.calibrationRounds` (**2**) are calibration — they still cost Resolve + run the economy but do
  **not** count toward your record. The run **always completes the course** (→ `victory`) unless Resolve hits
  0 (→ `gameover`). The old "win by 15 combat wins" condition is gone (`winsToWin` removed).
- **Record = W–L over the scored rounds** (rounds 3–17). New pure helpers in `state.ts`: `runRecord(state)`
  ({wins, losses, draws}, calibration excluded, draws not counted in W–L) and `isCalibrationRound(wave)`.
- **HUD:** the wave box reads **ROUND n / 17** (Ascent); the meter fills toward the course end; a
  **Calibration** badge shows on rounds 1–2, replaced by the **record chip (W–L)** on scored rounds.
- **End screen:** completion is now **"COURSE COMPLETE" · Record W–L** (not "VICTORY"); a death shows
  **"FALLEN" · Record W–L · fell on round n of 17**. Calibration pips are dimmed + labelled "not scored".
- **Config:** `maxWave` → 17 (the balance/curve horizon now covers the whole course). Practice is unchanged
  (its own 15-round session; no calibration/record concept).
- **Decisions locked with the owner:** calibration rounds don't count toward record; the course always
  completes unless Resolve hits 0.
- **Verified:** rewrote the win-condition tests as course/record tests; typecheck + lint + `npm test` (402) +
  the bot harness (terminates, no early-win) green; live-checked the HUD + both end screens.

### balance: power-outlier tuning + two cuts

- **Gnasher, the Overrun** — no longer re-attacks on kill (removed `reAttackOnKill`); it keeps only the
  on-kill run-wide spell-power gain. Removed the two combat re-attack tests.
- **Front to Back** — reverted the spell-power-scaling escalation: the per-cast improvement is again a flat
  **+2/+2** (spell power still adds a flat bonus to each grant, but is not part of the step). Dropped the
  per-stat `frontToBackBonusH` state field + its UI plumbing; `spellDisplayText`'s "Improve this by" shows a
  constant +2/+2.
- **Crypt Drake** — now procs **every 2 ally attacks** for a flat **+2/+2** (golden +4/+4); no longer
  improves. `onAllyAttackBuffAll` became a cadence (`attackSeen % every`) with no growth; live combat text
  shows the countdown to the next proc.
- **Wildwood Shaper** — reworked from a Choose One 1/1 to a plain **2/2, Battlecry: summon a Stray** (golden
  two). Removed the Choose One tests (no card uses `chooseOne` now — the reducer mechanic stays, dormant).
- **Removed Fodder Feeder** (T1 Demon) — card + its reducer sell-handler (`buffImpsRunWide` import dropped) +
  art. **Removed Hex Flayer** (T4 Demon) — card + art.
- Regenerated `docs/cards.csv`. **Verified:** typecheck + lint + `npm test` (401) + build:web green.
### feat: homescreen title art + mockup menu

- New **homescreen background** wired to the title screen: `C:\Game Assets\Ascent Art\homescreen.png` →
  `apps/web/public/homescreen.webp` (1915×821, 218 KB via sharp q82); `.titlescreen` now layers it under a
  left-edge vignette so the menu stays legible over the bright sky.
- **Title menu restyled to the provided mockup:** left-aligned ornate menu (navy fill + gold rim + bevel,
  framed gold icon cells, letter-spaced caps) — **Play** (blue active CTA → starts Ascent), **Career**
  (placeholder, no-op, per owner "doesn't go anywhere yet"), **Leaderboard**, **Settings**. The
  **transparentlogo** art sits above the ASCENT wordmark; the build **version** is bottom-right.
  **Practice + Compendium** kept as small secondary links so no mode is lost.
- **Account name (top-right):** clickable chip → inline edit lets the player name themselves (persists via the
  existing `playerName`/localStorage). Larger than the old rank chip; the XP bar + icon are gone (a real
  account/rank binding comes with the career system).
- **Leaderboard** page now uses the same homescreen background.
- **Note:** the title screen adopts the mockup's blue/gold palette, which diverges from the Sunward warm
  identity — intentional for this art; revisit if it should be reconciled.
- **Verified live:** title renders with the homescreen bg + 4 buttons; Career is a no-op, Leaderboard opens,
  no console errors; typecheck + lint + build:web green.

## 2026-06-29 (session 9)

### feat: combat odds panel shows average damage on loss

- The outcome-odds panel (estimated from the 1000-sim matchup re-run) now also reports **average damage on
  loss** — the mean Resolve you'd lose across the *losing* simulations (round-capped, like a real loss), i.e.
  what a typical loss of this matchup costs. Lets you tell an unlucky loss from a deserved one.
- Computed in the existing odds loop (no extra sims): the loop now reads each sim's full result and sums
  `min(playerDamage, lossDamageCap)` over losses → `odds.avgLossDamage` (0 when no sim lost). Shown under the
  win/draw/loss labels when `lose > 0`.
- **Touches:** `CombatResult.odds` type (+`avgLossDamage`), the reducer odds loop, `Recruit.tsx` + a small
  style. **Verified:** new test asserts the field is 0/positive and ≤ the round cap; typecheck + lint +
  `npm test` (405) + build:web green.

### fix: Front to Back's per-cast improvement scales with spell power

- **Before:** the grant grew only +2/+2 per cast (spell power was a flat add to every grant), while the card
  advertised "Improve this by +2+power" — so the text overstated the growth.
- **Now:** the escalation step itself absorbs spell power. Each cast grants +(step + accumulated escalation +
  spell power), then the escalation climbs by (step + current spell power). So the next grant really is bigger
  by step+power — matching the displayed "Improve this by". Attack and Health escalate independently (new
  `frontToBackBonusH`), since spell power can be asymmetric (Cinderwing grants Health only).
- **Touches:** `state.ts` (new `frontToBackBonusH` + deserialize heal), the `spellBuffTargetEscalating`
  factory + `spellDisplayText` (per-stat escalation), and the `Recruit.tsx` view plumbing.
- **Verified:** new tests — escalation climbs by step+power; two casts under +1 power grow +3 then +6.
  typecheck + lint + `npm test` (403) green.
### fix: Displacement can never swap a minion for a spell

- **Bug:** Displacement (and Darah's Displace power) picked a *random tavern offer* — including spells — so it
  could pull a spell onto the board (and stash your minion in the tavern). Spells must never be displaced.
- **Fix:** `swapWithTavern` now only considers tavern **minion** offers and returns false when there are
  none. Darah's power already keys its charge off that return (no charge spent on a fizzle). The Displacement
  **spell** gets a reducer guard so it fizzles and stays in hand when the tavern holds no minion.
- **Verified:** new tests — swap with a mixed tavern always picks the minion; an all-spell tavern fizzles and
  keeps the spell. typecheck + lint + `npm test` (404) green.

### art: The Godfodder, Hex Flayer, Wolves Den, Crypt Wolf

- Wired art for the four minions added in #98 — `godfodder`, `hexflayer`, `wolvesden`, and the `cryptwolf`
  token. Masters from `C:\Game Assets\Ascent Art\Minions` (TheGodfodder/HexFlayer/WolvesDen/CryptWolf.png),
  copied in under their card ids and run through `npm run optimize-art` (PNG → WebP, ≤512px, q85). Each
  shrank ~2.2MB → ~50KB.
- **Verified live:** Compendium renders godfodder/hexflayer/wolvesden at 512px (the token doesn't list in the
  Compendium but resolves through the same eager glob in combat). Note: the running dev server needs a full
  restart, not just a reload, to pick up new art (`import.meta.glob` is eager).
### fix: The Godfodder now actually feeds Fodder

- **Bug:** The Godfodder's Battlecry pulled a Fodder *from the shop* — but Fodder (Fred) is a non-rollable
  token that's essentially never in the shop, so the Battlecry silently fizzled: no stat gain, no animation.
- **Fix:** `battlecryTargetConsumeFodder` now **creates** a Fodder and feeds it to the targeted friendly
  minion (golden: 2), mirroring the Consume spell (`spellDemonConsumeFodder`). The target gains the Fodder's
  stats × its fodder multiplier, the on-consume pipeline fires, and the eat animation plays
  (`fodderEaten`/`fodderEatenSeq`, the same source-agnostic swirl + stat-float the UI already drives). Card
  text updated ("consumes a **Fodder**", dropping "from the shop").
- **Verified:** headless reduce(play → battlecryTarget) — target +1/+1, `fodderEatenSeq` bumped, `fodderEaten`
  event recorded. typecheck + lint + `npm test` (402) green.

### feat: Practice mode is read-only against the snapshot DB

- **Practice no longer writes snapshots.** Practice runs still fight real captured boards (the opponent
  pool loads at startup regardless of mode) but never contribute back: no local capture (`saveRunBoards`),
  no shared upload (`uploadBoards`), and no leaderboard log (`uploadVictory`). Only scored **Ascent** runs
  create snapshots and can reach the leaderboard.
- **Change:** the run-end capture block in `store.ts` now also gates on `next.mode !== 'practice'`. Reading
  is untouched — `fetchAndRegisterPool` (shared pool) + `loadStoredBoards` (local pool) both run at boot for
  every mode, so practice keeps facing real boards.
- **Reverses** the earlier interim decision (devlog: "Ascent win/loss AND Practice round-15, owner's call to
  let Practice contribute for now").
- **Verified:** typecheck + lint + `npm test` green.
### feat: 3 new minions + Eternal Knight real-time aura fix

**New cards:**
- **The Godfodder** (T2 Demon 3/2) — targeted Battlecry: a chosen friendly minion consumes one Fodder from the shop (golden: 2). Uses a new factory `battlecryTargetConsumeFodder` that pulls Fodder off `state.shop`, applies `offerBuyStats` × the target's `fodderMultiplier`, fires the `onConsume` pipeline, and tracks `fodderConsumedThisTurn`. Card has `target: 'friendly'` for cursor UI. Fizzles if no Fodder is in the shop.
- **Hex Flayer** (T4 Demon 3/4) — Battlecry: give your Demons +1/+3 (golden +2/+6). Uses existing `battlecryBuffTribe` — no new factory.
- **Wolves Den** (T3 Undead/Beast 3/3) — Deathrattle: summon 3 Crypt Wolves (golden: 6). New `cryptwolf` token added to `tokens.ts` (1/1 Undead/Beast dual-type). Uses existing `deathrattleSummon` — golden ×2 is the standard path.

**Eternal Knight aura fix:**
- `deathrattleBuffCardTypeRunWide` previously only called `ctx.grantCardBuff` (run-wide carry-back) — surviving Eternal Knights on the current combat board did NOT receive the +3/+2 immediately. Fixed: after the carry-back call, the factory now iterates `ctx.living(self.side)` and buffs every minion whose `cardId` matches. Future summons are covered by `cardBuffGains` in `applyAuras`, so the three paths (current board, future summons, next-fight run-board) all work correctly.

**Verified:** typecheck + lint + `npm test` (402 pass).

## 2026-06-28 (session 8)

### art: Taragosa, Gnasher the Overrun, Ghostsmith

- New art wired for Taragosa, Gnasher the Overrun (`gnash`), and Ghostsmith (`skullblade`) — confirmed loading
  live in the Compendium. Art-only (no code/test changes).

### content: Violet Whelpmother + Koron renames; art for Worgen/Karwind/Cleric/Whelpmother/Koron

- **Renames** (ids kept): Twilight Broodmother → **Violet Whelpmother**, Acid → **Koron, the Hungerer**.
- **Art wired:** Spirit Worgen, Karwind, Hoard Cleric (`cleric`), Violet Whelpmother (`broodmother`), Koron
  (`acid`) — all confirmed loading live. (The Koron master shipped as `KorokTheHungerer.png` — a one-letter
  filename typo vs the "Koron" card name; wired by card id regardless.)
- **Verified:** typecheck + lint + `npm test` (402 pass) + build:web green; CSV regenerated; live Compendium check.

### balance: Taragosa → T6, Cratering Hulk rename, Sergeant/Hulk art

- **Taragosa** (Tara's ascend form) is now a **Tier 6** unit (was T2).
- **Rename:** Thundering Abomination → **Cratering Hulk** (id `thunderingabomination` kept).
- **Art wired:** Sergeant and Cratering Hulk (`thunderingabomination.webp`) — confirmed loading live.
- **Verified:** typecheck + lint + `npm test` (402 pass) + build:web green; pool + CSV regenerated; live
  Compendium check (Taragosa T6 badge, rename, both art files render).

### balance: follow-up tuning + Violet Whelp rename, Mechanical Jouster, art rewires

- **Rename:** Twilight Whelp → **Violet Whelp** (id `twilightwhelp` kept; Twilight Broodmother's summon text now
  reads "Violet Whelps").
- **Stat/buff tuning:** Spirit Pup 6/6, Mama Bear 5/5, Tara 5/6; Spirit Worgen's per-summon gain 1/1 → **3/3**
  (golden 6/6); Commander Impala → **6/6 + Windfury**, on-kill Fodder/Imp buff 2/2 → **3/3** (golden 6/6).
- **New minion — Mechanical Jouster** (Mech, T4 4/5): *new combat factory* `rallyGrantMagnetic` — Rally (on each
  attack) adds a random Magnetic Mech to your hand (golden 2 per attack), carried back after combat.
- **Art rewired** (new masters): Supporter, Guardian Drake (`bronzewarden`), Violet Whelp (`twilightwhelp`),
  Taragosa, Spirit Worgen, + Mechanical Jouster. All wired by card id and confirmed loading live in the Compendium.
- **Verified:** typecheck + lint + `npm test` (402 pass — Spirit Worgen scaling tests updated to base 3) +
  build:web green; pool + CSV regenerated; live Compendium check (rename, new card, all six art files render).

### balance: big tuning pass + 6 renames, 3 cuts, 5 reworks, 2 new minions, Compendium polish

A broad owner-directed balance + content update. New art for Bane, Acid, Supporter (rewired earlier this
session) plus the two new minions below.

- **Stat tuning (data only):** Beasts — Gryphon 2/5, Raptor 2/6, Mama Pup 3/2, Kennelmaster 1/4, Wildwood
  Shaper 1/1, Sea Urchin 3/3. Dragons — Arcane Weaver 4/4, Cinderwing Matron 4/5, Bane 7/9, Crypt Drake 6/6.
  Mechs — Junkyard Titan → T3, Better Bot → T4 & 5/5. Undead — Sporeling 2/2, Deathswarmer 1/4, Ghostsmith
  4/2, Karthus 7/8. Demons — Fodder Feeder 2/2, Trickster → T2 & 2/4, Ritualist 5/6. Neutrals — Buddy Buddy
  3/3, Archmagus Guel 4/4, Blaster 5/3, Flowing Monk 4/5, Sylus 1/7, Yazzus 5/7.
- **Buff-value tweaks:** Karwind +2/+2 (golden +4/+4), Nanon overflow +3/+4 (golden +6/+8), Brightwing Broker
  3/4 body giving +1/+2 (golden +2/+4).
- **Renames (card `id`s kept stable → art/pool/saves intact):** Bronze Warden → **Guardian Drake**, Stuntdrake
  → **Obsidian Drake**, Spare Part Drone → **Warding Drone**, Deathless Hand → **Footman Leader**, Ghastly
  Bladesmith → **Ghostsmith**, Taurus the Ancient → **Taurus**.
- **Removals (cascaded like Sheldon — def + tests + pool + CSV + art + orphan factories):** **Demonic Anomaly**,
  **Echo Warden** (its summon-multiplier logic in `simulate.ts` + the `echo` summon-event flag + replay handling
  were live, not deferred as an old comment claimed — all removed), **Cupcakes**.
- **Reworks:**
  - **Acid** (8/8, no longer a Consume body) — *new `goldSpent` trigger*: every 7 Gold you spend permanently
    buffs your Fodder + Imps +1/+1 (golden +2/+2) AND queues 1 Fodder (golden 2) into your next tavern, via a
    continuous per-instance meter (`BoardCard.goldTick`) fired from a single `spendGold` chokepoint in the
    reducer (buys, rerolls, tier-ups, hero powers).
  - **Banksly** (new Mech, T5 5/6) — same `goldSpent` meter: every 10 Gold spent welds a random Magnetic onto
    itself (golden 2).
  - **Commander Impala** (new Demon, T5 6/4) — *new combat factory* `onKillBuffFodderImps`: each kill
    permanently buffs Fodder + Imps +2/+2 (golden +4/+4), carried back like Bane.
  - **Target Dummy** (0/4) — *new combat factory* `onDamagedGainAttack`: gains +1 Attack per hit (any damage
    amount), permanent (carried back via `permaGain`).
  - **Thundering Abomination** — dropped Engraved; its overflow grant to Undead is now the engraved (permanent)
    part (`onSummonOverflowBuffTribe` gained an `engrave` param).
  - **Taurus** — base now Engraves BOTH neighbors; a golden Taurus additionally **doubles** their combat
    stat-gains via a new per-minion `Minion.gainMult` applied at the top of `ctx.buff`.
  - **Lantern Light** — now folds run spell power onto both stats on top of +Tier/+Tier.
  - **Consume** (→ 3 cost) — instead of eating a tavern minion, the chosen Demon now **creates and eats a
    Fodder** (new `spellDemonConsumeFodder`), playing the fodder-eat animation; the Fodder carries the run-wide
    Fodder enchant.
- **Compendium:** cursor fixes — the inspect overlay's enlarged card and the book's scrollbar pseudo-elements
  now keep the themed gauntlet cursor (were falling back to the OS arrow). **Evolution units** (Spirit Worgen,
  Taragosa) now appear in the book — detected as ascend/transform targets even though they're non-buyable tokens.
- **Verified:** typecheck + lint + `npm test` (402 pass — many combat/run tests updated: Echo/Cupcakes/Demonic
  Anomaly deleted, Karwind/Nanon/Brightwing/Acid/Consume/Taurus expectations rewritten, and several scaffold
  tests switched off `sandbag` since Target Dummy is no longer an inert wall) + build:web all green. Pool + CSV
  regenerated.

### content: remove Sheldon from the card set

- **Cut the `sheldon` Mech** (tier-3, 2/4, Divine Shield + Magnetic) from `packages/content/src/cards/mechs.ts`.
  It was one of five Magnetic mechs; the others (Cling Drone, Money Bot, Speedy, Harry Botter, Better Bot) stay.
- **Cascading cleanup:** deleted the art build copy (`packages/ui/src/art/minions/sheldon.webp`); regenerated
  `docs/cards.csv` (`npm run dump-cards` → 80 minions) and the opponent pool (`npm run pool`, which sources the
  live card set). Pruned the Sheldon-specific assertion from the Magnetic-weld test (`run.test.ts`) and broadened
  the Combinator random-weld test's expected profiles to cover the **full** current Magnetic-mech pool (it had
  hardcoded a 3-of-5 subset, so dropping Sheldon shifted the seeded RNG onto Harry Botter and failed the stale
  list).
- **Verified:** `npm run typecheck`, `npm test` (406 pass), lint, build:web all green.

### feat(ui): Compendium button on the title + Ascent win-condition copy

- **Title-screen Compendium button** (`Title.tsx`) — a third centered action (`Leaderboard · Compendium ·
  Settings`; the row was already `justify-content: center`) that opens the Compendium. Opened from the title
  (no committed run), the book now browses the **whole card set** — `MinionBook` uses all six tribes + Neutral +
  Spells and the subtitle reads "… cards in the game" (vs "… findable this run" mid-run). The global **Tab**
  hotkey now also works from the title (still suppressed during hero select).
- **Ascent description** — reworded from the vague "survive the rising threat as long as you can" to the real
  win/lose condition: *"Climb the rising threat — win 15 rounds to ascend, or fall when your Resolve runs out."*
  (Matches `CONFIG.winsToWin = 15` → victory on the 15th won combat; gameover when Resolve hits 0.)
- **Verified** live: title shows three centered buttons + the new copy; the Compendium opens from the title at
  "114 of 114 cards in the game" (all tribes). typecheck + lint + build:web green.

### tweak(ui): Minion Book → "Compendium" — 6-wide, +15%, single scroll (no pages)

Per owner feedback: renamed the overlay title **Bestiary → Compendium**; the gallery is **6 columns wide**
(was 5); the whole thing is ~15% larger — the book panel grew to `min(1700px, 96vw)` × `min(1000px, 92vh)` and
the card size to `--ch: clamp(212px, 26vh, 276px)`; and **pagination is replaced with a single vertical scroll**
so you can skim the whole filtered list at once (dropped `PAGE_SIZE` + page state + the Prev/Next footer + the
arrow-key page flip; `.book-grid` was already `overflow-y: auto`). Verified live: all 114 cards render in one
scrollable 6-wide grid, scrollbar present, no footer. **Themed the scroll areas' scrollbars** (`.book-grid` /
`.book-rail`) — a native scrollbar reverts the cursor to the OS arrow, so a styled webkit scrollbar (+ Firefox
`scrollbar-color`) renders as part of the element, keeping the gauntlet cursor and matching the accent theme.
typecheck + lint + build:web green.
### feat: unify run-wide buffs as "auras" — apply everywhere (incl. resummon) + consistent naming

Run-wide buffs ("Undead everywhere", Fodder, Imp, Eternal Knight) are now treated as **auras** that follow a
player minion everywhere — the warband, the shop, and every combat body (start, summon, Reborn, **resummon**).
This fixes several inconsistencies where a fresh combat body silently shed a buff it should keep.

- **Combat (`core/combat/simulate.ts`)** — replaced the three ad-hoc helpers (`applyUndeadBonus` /
  `applyImpBonus` / `applyCardTypeCarryThrough`) with a declarative `AURAS` registry + one `applyAuras(m, fromBase)`,
  applied at combat start, summon, and Reborn. New aggregate auras are now one registry entry; per-card enchants
  (Fodder, Eternal Knight) flow from `cardBuffs`, which is now **threaded into `simulate()`** (new trailing param;
  both reducer call sites pass `s.cardBuffs`). The per-card prior total reads `cardBuffs[id]` (authoritative) and
  falls back to the minion's own buff breakdown, so existing Eternal Knight / Lantern tests stay byte-identical.
  - **Bug fixes via the unified path:** a **summoned** token now inherits its per-card enchant (a summoned Fodder
    gets the Ritualist buff); a **Reborn** body now also re-gains the Imp aura + non-undead enchants (Fodder);
    a **resummoned** body (Soren's Reclaim) now re-applies the per-card stacks banked *this fight* via a dedicated
    `applyCombatGains` — its start-of-combat copy already carries the live auras + prior stacks, so only the
    later gains were missing (this is the "resummoned Eternal Knight doesn't gain the buff" report).
- **Recruit display** — `instView` (warband/hand) now folds the Undead aura onto `universalTribe` minions too
  (it already did for plain Undead; shop + combat already did). The run-buffs window (`runBuffs.ts`) renames the
  rows to the aura vocabulary: **Undead Aura · Fodder Aura · Imp Aura · Eternal Knight Aura**.
- **Verified**: typecheck + lint + `build:web` green; full suite **405** (2 new — a resummoned Knight carries the
  Undead Aura with the exact +Attack delta, not doubled/dropped; a combat-summoned token inherits its per-card
  enchant); `npm run harness` re-confirms identical-seed determinism. Existing golden/Eternal-Knight/Lantern
  tests unchanged.
- **Note (combat-determinism boundary):** `simulate()` gained a trailing `cardBuffs` param — coordinate before
  further signature changes.
### fix: magnetic can weld onto a Chaos Attachment host + Minion Book pop-in animation

Two small fixes from a feedback batch.

- **Magnetic → Chaos Attachment.** A normal Mech Magnetic minion couldn't weld onto a Chaos Attachment (the
  `universalTribe` all-type body). Cause: the attachment's printed `tribe` is `'neutral'`, so the tribe-match in
  `magnetizesTo` (`reducer.ts`) missed it. Fix: a `universalTribe` **host** counts as every tribe (incl. Mech),
  so it now accepts any Magnetic — the mirror of the already-handled magnetic-*side* universalTribe case. Added a
  regression test (`run.test.ts`: a Cling Drone welds onto a Chaos Attachment → merges, 1/1 + 2/2 = 3/3).
- **Minion Book pop-in.** The book reused `inspectpop` (animates `scale(1.45)→1.9`, correct for the inspect card
  which *rests* at scale 1.9); the book rests at scale 1, so it ballooned then snapped down. New `bookpop`
  keyframe: opacity 0→1 + `scale(0.97)→1`. Verified live (computed `animation-name: bookpop`).
- **Verified**: typecheck + lint + test (404) + build:web green.

### feat: Minion Book (Tab) — a filterable bestiary of every card findable this run

A new reference overlay so players can browse the run's card pool. Tab toggles a blurred full-screen "tome":
tier filters (1–6) across the top, tribe + Spells filters down the left, and a paged gallery of cards you
flip through. Both filter axes are **multi-select** and combine (OR within an axis, AND across axes), e.g.
tiers 1+2 ∧ Beasts+Dragons. Pure presentation — no engine changes.

- **`ui/MinionBook.tsx`** (new) — derives contents from the same eligibility rule as `stockPool` (neutral +
  active-tribe minions off `BUYABLE_CARDS`, so the list is stable as you buy/sell) plus all `SPELL_CARDS`;
  tokens are excluded. Cards render via the existing `<Card forceFull>` (base/printed stats — it's a static
  reference, no run buffs); right-click still opens the global Inspect (which layers above the book at z 500 vs
  480). Page size 10; ArrowLeft/Right flip pages; filters reset to page 1 on change.
- **`ui/store.ts`** — added UI-only `showBook` + `toggleBook`/`closeBook` (mirrors the leaderboard toggle).
- **`ui/Game.tsx`** — a global **Tab** handler toggles the book (gated to an active run — not the title/hero
  picker; `preventDefault` stops focus-cycling). The existing **Esc** handler now lets the book claim Esc
  (closes itself) before the menu would open, matching how Inspect already does.
- **`ui/styles.css`** — `.book-ov` / `.book` + the head / tier row / left rail / grid / footer; the grid sets a
  compact `--cw`/`--ch` so cards tile 5×2, with a hover scale-up on each cell.
- **Scope note (per owner):** contents are *this run's* findable cards (active tribes + neutral), tokens
  excluded. When future set/RNG cards land we'll revisit whether/how run-variable cards appear.
- **Verified** live in the preview: Tab opens/closes; Esc closes without opening the menu; tier∧tribe and
  multi-select filtering produce correct counts (tier1∧Beast → 2; tiers1,2 ∧ Beast,Dragon → 8); right-click
  inspect layers on top; no console errors. typecheck + lint + test (403) + build:web all green.
### refactor: data-driven Discover-on-play + opponent-frame intel + cursor fix

Three small, independent changes (UI polish + an engine de-coupling).

- **`discoverOnPlay` — Discover spells are now data, not a reducer card-id chain.** The `play` action in
  `sim/reducer.ts` special-cased five card ids (`discoverspell`, `sprout`, `helpwanted`, `tribeportal`,
  `corpseboard`), each calling `queueDiscover` with bespoke params. Replaced by a single generic handler that
  reads a new optional `CardDef.discoverOnPlay` spec (`core/types.ts`, zod-validated in `content/schema.ts`):
  `{ exactTier?, tierOffset?, filter?, tribe?: Tribe | 'dominant', topTierFirst? }`. The reducer resolves the
  offer tier (`exactTier ?? tavernTier + tierOffset`) and tribe (`'dominant'` → `dominantBoardTribe(s)`) at
  play time, then builds the same `DiscoverSpec`. The five cards now carry the field; the golden Triple Reward
  token keeps its peek-up bias via `{ tierOffset: 1, topTierFirst: true }`. New Discover spells are now
  data-only — no reducer change. Behaviour is byte-identical (untargeted → still not multiplied by Yazzus,
  still consumed with no board slot). **Verified**: full `npm test` green (403 tests, incl. the existing
  sprout/helpwanted/tribeportal/corpseboard/discoverspell coverage) + typecheck + lint + build:web.
- **Opponent frame — wins + tavern tier now in the thumbnail itself.** `OpponentFrame.tsx` previously showed
  only name + hero portrait + life in the always-visible badge (the rest was hover-only). Added a stats
  column: life (♥) on top, then a meta row of wins (crown, accent) + tavern tier (star) — both already on
  `BoardSnapshot`. The hover tooltip is unchanged (still hero name / HP / tier / triples / top tribe /
  author). New CSS: `.opp-stats`, `.opp-meta`, `.opp-wins`, `.opp-tier`. **Verified** live in the preview:
  badge reads "LEMON · ♥30 · 👑0 · ★1", tooltip intact.
- **Opponent frame cursor.** `.oppframe` used the bare OS `cursor: default` on hover; switched to the custom
  `url('/cursors/gauntlet_default.svg') 6 2, help` (matching `.chip` — it's an informational hover surface).

## 2026-06-27 (session 7)

### feat: weighted card-drag — perspective tilt + a slight lag for heft

Dragged cards (the floating `.dragcard`) now tilt in 3D toward their motion and lag slightly behind the
cursor, so they feel like they have weight (inspired by the PixiJS perspective-mesh example — but done with
CSS 3D transforms on the DOM card, not a Pixi mesh, since the card is composed DOM).

- **One signal drives both.** A per-frame rAF (active only while a card is dragged) smooths the card's render
  position toward the cursor; the *gap* between cursor and render position drives BOTH the catch-up and the
  lean (`rotateX/rotateY` under a `perspective()`), so a fast drag leans hard and a stopped cursor settles
  flat. The transform is written straight to the node (no React re-render) → pure compositor, no layout reads.
- **No fights.** React owns the transform only for the snap-back / magnet-slide states (which use CSS
  transitions); the normal lean omits `transform` from the style prop so the rAF owns it cleanly. A
  `useLayoutEffect` writes the first frame before paint (no lift flash). All transforms share one function
  list (`dragTransform`) so the snap/magslide transitions interpolate smoothly back to flat.
- **Held-still sits flat.** No static 2D angle by default (`staticRotate` 0) — a card held still is square
  like one on the table (the lift read is the drop-shadow + scale, not a tilt); it only leans while moving.
- **Directional lean into motion.** Each axis tilts by its signed lag-gap (`rotateY = tiltPerPx·hLean·gx`,
  `rotateX = tiltPerPx·vLean·gy`), so left/right and up/down lean opposite ways and the card sits flat when
  the cursor stops. Two live dials — `hLean`, `vLean` (magnitude = how much, sign = which way) — replace the
  earlier magnitude/direction split (which had a footgun: with both coefficients set, one drag direction
  doubled the tilt and the other cancelled to zero). Defaults are pronounced (`tiltPerPx 0.28`, `tiltMax 14`)
  so the direction reads clearly. `DragTuner` guards a missing range so a mid-edit HMR desync can't blank the app.
- **Recentres onto the cursor.** You can grab a card anywhere, but once the drag begins the card smoothly
  slides so its CENTRE sits under the cursor (the anchor lerps grab-point → card-centre in the rAF, a hair
  quicker than the position catch-up). The drop/insertion math is unchanged because the anchor is stored as
  the centre (`ox = w/2`), so `x − ox + w/2` = the cursor; the real grab point is kept only to start the
  recentre without a pickup pop and to aim the snap-back at the original slot. (This made the old `pivot` dial
  redundant — the pivot is now the centre by definition — so it was removed.)
- **Tunable + DEV tuner.** `dragFeel.ts` holds every card-motion dial, persisted to localStorage and read
  live each frame; `DragTuner.tsx` (the 🎴 button) exposes all 11 as sliders with a hover-tooltip definition
  on each: `follow` (lag), `tiltPerPx` (lean), `tiltMax` (cap), `hLean`/`vLean` (per-axis directional lean ±),
  `perspective`, `scale` (hold size), `staticRotate` (angle while held), `threshold` (click→drag px), `snapMs`
  (snap-back), `magSlideMs` (magnet-slide). Owner-tuned defaults: hLean 0.3, vLean −0.2, tiltPerPx 0.6, tiltMax
  19°, follow 0.64, perspective 1600, scale 1.12, threshold 1;
  perspective 800, scale 1.04. snap/magslide durations are pushed to the CSS transition inline so they tune live.
- **Denser drop cloud.** The dry-dirt dust puff kicked up when a card is placed/moved on the board keeps its
  original size but is +50% DENSER — `dust()` gained a `density` arg (multiplies the puff count, not the size);
  `puffOnBoard` passes `density 1.5` (12 → 18 puffs) so the landing reads more without ballooning.

**Files:** `dragFeel.ts` (new — dials), `DragTuner.tsx` (new — DEV tuner), `Recruit.tsx` (motion rAF +
`dragTransform` helper + JSX hand-off), `Game.tsx` (mount tuner), `styles.css` (tuner button).

**Verification:** `typecheck + lint + build:web` green; page loads with no console errors, tuner mounts. The
tilt/lag feel itself is for live by-eye tuning (the headless preview throttles rAF).

### fix: the round timer kept ticking under the title / leaderboard overlays

`<Recruit />` stays mounted across every phase (combat plays out in place), and the title screen, hero
picker, and Hall of Champions render *on top* of it (see `Game.tsx`). The recruit round-timer loop only
paused for an open Discover + the hero picker — not the title or leaderboard — so the clock kept counting
down (and the last-5-seconds `sfx.tick` kept firing) on those screens, where there's no active turn.

- **`Recruit.tsx`** — the countdown effect now also pauses while an overlay is open (`showTitle ||
  showLeaderboard`), added to its guard + deps. The clock freezes where it was and resumes when the overlay
  closes (no refill). The hero-picker pause was already handled (`heroSelecting`).
- **Verified**: typecheck + lint + `build:web` green; dev server HMR'd clean. (The symptom was the audible
  tick + visible countdown on the Hall of Champions — now silent/frozen there.)
### feat: Hall of Champions shows each minion's buff breakdown (right-click inspect)

Right-clicking a champion's minion in the leaderboard now itemizes HOW it was buffed ("Spirit Fire ×2:
+6/+6", "Golden Touch", etc.) in the inspect panel — the same breakdown the shop + combat already show
(PR #77). Board snapshots didn't carry the breakdown, so this captures it.

- **`sim/snapshot.ts`** (`cleanBoard`) — carries each board card's per-source `buffs` into the snapshot
  (cloned, omitted when empty). So captured/served/leaderboard boards keep the breakdown, not just final stats.
- **`ui/Leaderboard.tsx`** (`cardViewOf`) — passes `buffs` into the card view; the existing right-click
  `<Inspect>` overlay renders it unchanged.
- **Caveat**: only boards captured AFTER this ships carry the breakdown — older leaderboard rows (captured
  before now) simply show no Buffs panel (graceful).
- **Verified**: typecheck + lint + `build:web` + full suite green (**402 tests**). New snapshot test:
  `snapshotBoard` captures the buff breakdown (cloned, not shared) and omits it for buff-less minions.

### feat: opponent selection — fully random within a source-priority cascade (Supabase → local → synthetic)

Reworked `pickOpponent` so you always face real *player* boards when any exist for your wave, picked at
random instead of power-matched. Same-wave matching (development stage) is unchanged; within the wave the
pick now follows a source priority and is otherwise uniform random:
1. **Supabase** — boards from the live shared pool (freshest, from other players), then
2. **local** — your own captured / imported friend boards, then
3. **synthetic** — the committed pool floor.

It serves uniformly at random from the highest non-empty tier (no similar-power bias), falling to synthetic
only when no real board exists for the wave.

- **`sim/snapshot.ts`** — new optional `remote?: boolean` on `BoardSnapshot`. `origin` can't tell a
  Supabase board from a local capture (both are `'self'`), so this flag marks the live-shared-pool boards.
- **`sim/opponents.ts`** (`pickOpponent`) — replaced the "sort by |power − yours|, pick among the closest 3"
  bias with a tier cascade (`remote` → `self`/`friend` → rest) and a uniform `rng.int(tier.length)` pick.
  Still seeded (replays stay byte-identical within a session); `power` is now ignored (kept in the signature
  so the recruit preview + call sites are untouched).
- **`ui/remoteBoards.ts`** (`fetchAndRegisterPool`) — stamps fetched boards `remote: true` before registering.
- **Verified**: typecheck + lint + `build:web` + full suite green (**402 tests**). New test covers the
  cascade (remote > local > synthetic, even when remote's power is far from yours) and that selection is
  fully random within a tier (both same-tier boards appear across seeds). The existing wave-match /
  real-preference / widen / empty-pool test still passes. Dev server HMR'd clean.

### tweak: Taunt bulwark — size back to 1.34, shift down to 8px

Dialed the taunt bulwark defaults: `margin` 1.54 → 1.34 (reverting the +15%) and `offsetY` 2 → 8 (a bigger
downward nudge so the heater sits lower behind the card). `tauntConfig.ts` only. (localStorage tunes still
override — Reset in the DEV taunt tuner to adopt them.)

### tweak: Taunt bulwark — +15% size, rigid deploy, +25% dust plume

Three feel tweaks to the taunt bulwark:
- **+15% size.** Footprint `margin` 1.34 → 1.54 in `tauntConfig.ts` defaults, so the silver heater reads a
  touch bigger behind the card. (Existing localStorage tunes override the default — hit Reset in the DEV
  taunt tuner to adopt the new size.)
- **Rigid deploy (no bob).** The deploy scale swapped from ease-out-**back** (overshoot ~+10% then settle —
  read as a bob) to ease-out-**quart** (`1 - (1-t)⁴`): it grows out fast and **locks** at full width with no
  overshoot. It's metal — it shouldn't spring.
- **+25% dust plume.** `dust()` gained an optional `scale` (default 1) that inflates both the ring spread and
  the puff sizes; the taunt deploy passes `1.25`. The generic card-landing dust is unchanged (still 1).

### feat: Taunt bulwark — live DEV tuner, old badge removed, deploy "thunk" sound

Follow-up polish on the Taunt bulwark, all on `feat/taunt-bulwark`:

- **Interactive tuner** (`TauntTuner.tsx` + `tauntConfig.ts`): a DEV floating panel (mirrors the Lunge
  tuner / SFX mixer pattern) with sliders for the shield **shape** (top edge, bottom point, width, taper),
  the chrome **rim**, the **gem** size, **glint speed**, the silver **tint** (R/G/B + a live swatch), the
  **footprint size**, and the **deploy ms**. The 12 values persist to `localStorage` (`ascent.taunt`) and
  drive the shader **live** — `pixiFx` reads `getTauntConfig()` every frame for each taunt bubble and pushes
  the shape/look values into uniforms, so a slider edit updates a held demo bubble instantly. "Hold demo"
  parks a bulwark at screen centre; "Deploy ▸" re-fires the thwap; "Copy values" grabs the JSON to paste
  back as the shipped defaults; "Reset" restores them. Stripped from production via the static env check.
  - To make this work, `TAUNT_FRAG`'s hardcoded shape/look constants became uniforms (`uTopY/uBotY/uHalfW/
    uWidthPow/uRimW/uGemSize/uGlintSpeed`); `setShield` builds the extra uniform group only for taunt;
    `TAUNT_DEPLOY_MS` (was a const) and the footprint margin now come from the live config.
- **Removed the old Taunt badge.** The `.tauntward` corner shield icon on cards is gone (markup + CSS) —
  Taunt now signifies purely via the silver bulwark aura, matching how Divine Shield / Reborn dropped their
  badges in favour of their Pixi auras.
- **Deploy sound.** Playing a minion that arrives **with** Taunt now fires the `taunt` "thunk" clip as the
  bulwark deploys (`store.ts`, in the `play` action). Complements the existing board-wide grant check
  (which only fired when an *existing* minion was newly granted Taunt).
- **Dead-steady size + X/Y nudge.** The taunt bulwark no longer size-breathes (the bob is now reborn-only);
  added `offsetX`/`offsetY` dials to shift the shield left/right/up/down of the card centre (applied JS-side
  in the update loop). **Tuned-in defaults** (from the live tuner): a broader, flatter heater (`halfW 0.98`,
  `widthPow 0.65`, `topY 0.83`), a thin rim (`rimW 0.07`), neutral grey steel (`0.59` all channels), a slower
  glint (`0.08`), `margin 1.34`, a 2px downward nudge, and a slower `440 ms` deploy.

**Files:** `tauntConfig.ts` (new — dials + ranges + localStorage), `TauntTuner.tsx` (new — the panel),
`pixiFx.ts` (shader uniforms + live drive + margin/deploy from config), `Card.tsx` + `styles.css` (badge
removed, tuner button/swatch CSS), `Game.tsx` (mount the tuner), `store.ts` (deploy sound on play).

**Verification:** `typecheck + lint + test (401) + build:web` all green. Live-checked on a throwaway dev
server: the rewritten shader compiles with **no WebGL errors**, the back-layer canvas is live, the taunt
bubble registers with all 11 uniforms (4 base + 7 new tunable), and the per-frame uniform drive runs
without throwing. The visual look is now the user's to dial in via the tuner.

### feat: Taunt bulwark — silver-metal heater shield BEHIND the card (deploy thwap + smoke)

A new persistent aura for Taunt minions: a procedural silver-metallic heater/kite shield (beveled chrome
rim, brushed-steel field, faceted silver gem core, sweeping specular glint) that sits **behind** the card
so its rim peeks out around every edge — unlike Divine Shield / Reborn, which render over the card.

- **Shader** (`pixiFx.ts`, `TAUNT_FRAG`): GLSL heater-shield SDF → faux-3D bevel (normal from the SDF
  gradient) + brushed field + faceted gem; `uColor` is the silver tint (live-tunable). Added `taunt` to
  the `AuraKind` / `AURA` registry (`behind: true`, margin 1.28 so it overhangs the card).
- **Back layer** (`tauntFx`): a third `FxController` instance whose canvas mounts inside `.app` (first
  child, behind the card rows) so the shield renders behind the cards. Its stage origin is the board's
  top-left, so `syncShields` shifts taunt coords by the layer's offset (front auras stay viewport-raw).
- **Routing**: `syncShields` gained a `taunt` kind (reusing the `.card.taunt` marker, `T` keyword); a
  per-kind `auraFx()` routes taunt → `tauntFx`, shield/reborn → `pixiFx`. Taunt never "breaks" — it
  deploys on gain and fades when removed.
- **Deploy**: a "thwap" — ease-out-back scale from nothing → ~+10% overshoot → snap (`TAUNT_DEPLOY_MS`
  230 ms), vs the shield's gentle grow-in. Plus a light placement-style **smoke plume** (`pixiFx.dust`)
  dispersing outward, fired on the front layer when a taunt newly deploys.
- **DEV**: `window.__tauntFx` + `__tauntDemo()` to deploy a bulwark at screen center for live tuning.

**Files:** `pixiFx.ts` (`TAUNT_FRAG`, `taunt` AURA, `tauntFx`, deploy thwap, DEV hooks), `Recruit.tsx`
(back-layer mount + attach, taunt sync routing + offset + deploy smoke), `styles.css` (`.taunt-back`).

**Verification:** `typecheck + lint + build:web` green. Live-checked on a throwaway dev server: the shader
compiles (no WebGL errors), `tauntFx` mounts behind the cards, and the bulwark renders **silver** (4144
of 4610 opaque pixels read silver, max-luma 255 glint) and deploys to full alpha after the thwap. The
look itself is for live DEV tuning (the headless preview can't show the animation).

### fix: three effect-layering bugs (shop shield position, fodder-over-shield, discover on top)

Review feedback on the reshaped divine shield surfaced three layering issues:

- **Shield sat slightly low in the SHOP only.** The aura centres on the card's measured rect, but `.card.compact`
  is `width:--ccw; height:auto` (taller than its art, so its centre is low), while a combat `.unit` is a fixed
  `--ccw` square. Fix: `Recruit.tsx` now measures the square **`.archbox`** art region (same in every row) for
  the aura centre + size, in both `measureCardRect` and the `syncShields` PASS-1 loop — so shop/hand/board align.
- **Fodder consume swirl hid behind the shield.** `.fodderghost` was z60, under the FX overlay (`.pixifx` z110),
  so a consumed shielded unit's bubble covered the swirl. Raised `.fodderghost` → **z120** (above the aura); the
  consume animation now reads in front.
- **A unit that triggers Discover covered its own menu.** `.discover-ov` (also used by Choose-One) was z50 — below
  a freshly-placed card's z111 lift. Raised → **z160**, above all effects (FX overlay, card lift, fodder swirl),
  so Discover/Choose-One is always on top.
- **Verified**: typecheck + lint + `build:web` green; app boots clean; computed z-indices confirmed live
  (discover 160 > fodder 120 > pixifx 110). The shop-shield alignment needs an in-game look (headless can't
  place a shielded shop card).

### tweak: Divine shield conforms to the arched card — polygon mask + cutouts replace the circular clip

Gave the divine-shield bubble the same shape treatment as reborn: it no longer hard-clips to a **circle**
(which didn't follow the arched card) — the glassy energy-sphere now fills an editable **polygon silhouette**
of the card, with **four elliptical cutouts** carving it off the tier pill / attack / medallion / health
badges. Sculpted live in the in-chat divine-shield shape editor (the real `SHIELD_FRAG` glass running in the
browser with draggable outline + cutout handles + glass-look sliders) and baked back as GLSL constants.

- **`pixiFx.ts`** (`SHIELD_FRAG`): added `const vec2 PTS[17]` (silhouette) + `CP[4]`/`CR[4]` (cutouts) +
  `sdPoly()`; the old `if (d>=1.0) discard` circular clip → a soft polygon **mask** (edge-softness 0.110,
  corner-round 0.010) minus the cutouts. The fresnel **rim now hugs the polygon edge** (`exp(-|sd|*5)`) so it
  conforms to the sculpted shape instead of a circle. Baked look dials: rimAmt 1.10, **interior opacity 0**
  (hollow rim+hex+glint glass — the body term is kept wired, one dial from re-enabling), specular 1.05, hex
  density 4.4 / opacity 0.40. Tint `SHIELD_GOLD_RGB` → `[1.0, 0.89, 0.36]`. The physical **size-breathe was
  removed** for the shield — the container ±4% grow/shrink (`breatheScale`, the bob-in/out) is now gated to
  reborn only; the shield holds a steady size while keeping its shader colour/energy pulse (that part stays).
  The visible **shimmer got +30% speed + swing**: hex force-field pulse 1.6→2.08 speed / 0.45→0.585 swing,
  whole-bubble colour breathe 0.85→1.105 speed / 0.15→0.195 swing.
- **`AURA.shield.margin`** 0.84 → **1.16** (matches reborn) so the bubble quad encloses the whole card and
  the polygon coords map to the card edge (the circular bubble used a smaller quad).
- **Verified**: typecheck + lint + test (395) + `build:web` green; app boots clean (no crash, Pixi ready).
  Shader proven via **framebuffer readback** — compiles + links; bright gold rim hugging the silhouette
  (edge α 89, peak α 181, gold-dominant); hollow interior (center α 18); all three sampled cutouts + outside
  the silhouette masked to α 0. Editable + re-bakeable from the shape-editor widget.

### fix: tavern consumes (Acid, Consume/Cupcakes, Demon-eats-Fodder) used base stats, not the buffed value

Consuming a buffed tavern minion fed the consumer the minion's **base** stats instead of its current value.
Each consume path computed stats ad hoc and missed different buffs: Acid (`onRollConsumeShop`) added the
per-offer buff but skipped the persistent run enchant, golden, and held; the Consume/Cupcakes spell
(`spellDemonConsumeTavern`) skipped golden and held; the Demon-eats-Fodder path (`consumeTavernFodder`)
skipped the per-offer buff, golden, and held. So a gilded / Apples-buffed / Ritualist-enchanted offer was
eaten for far less than it was worth.

- **`sim/recruit.ts`** — new shared `offerBuyStats(state, offer)`: the single source of truth for a tavern
  offer's CURRENT value — `held` (Displacement-stashed) returns its full preserved body, otherwise base +
  persistent run buff (`cardBuff`) + Undead buy-attack + per-offer buff (`atk`/`hp` from Apples / Shatter /
  Fortify) + Staff of Guel's tavern-buy bonus, all ×2 for a Golden Touch offer. Mirrors the reducer's buy
  case, so **a consumed minion now grants exactly what buying it would**. All three consume paths route
  through it. (It excludes only the Lantern of Souls *live aura*, which the buy path also doesn't bake — it
  re-applies to real Undead on board/in combat, so transferring it onto a Demon would double-dip a temporary
  aura. Flagged for follow-up if we want consume to match the on-card aura preview instead.)
- **`sim/index.ts`** — export `offerBuyStats`.
- **Verified**: typecheck + lint + `build:web` + full suite green (**401 tests**). New tests: a direct
  `offerBuyStats` unit test (run buff + per-offer buff + Staff, golden ×2, held passthrough) and a Consume
  integration test devouring a buffed + gilded + enchanted offer at its full value. Existing Acid / Consume /
  Cupcakes tests still pass. Dev server HMR'd clean.

### fix: Eternal Knight Reborn dropped its accrued stacks

An Eternal Knight that Reborned came back having shed every prior stack of its run-wide enchant. A Knight
carrying 5 stacks (base 3/2 + 15/10 = 18/12) that died — banking a 6th stack — should Reborn at base + 6
stacks = 21/14; instead it returned at 6/4 (base + only the single stack banked *this* fight).

Cause: on Reborn the body resets to base CardDef stats, then `applyCardTypeCarryThrough` re-applied only the
amount banked **this** fight (`cardBuffGains`). The stacks accrued in **prior** fights live baked into the
run-board stats, so resetting to base discarded them. They weren't available to combat before — but PR #77
now carries each minion's per-source buff breakdown into the combat snapshot, where the run-wide enchant
appears under the card's own name ("Eternal Knight", the label `settleCombat` gives the carried-back buff).

- **`core/combat/simulate.ts`** (`applyCardTypeCarryThrough`): the Reborn carry-through now sums BOTH parts —
  the prior-fight stacks read off `m.buffs` (source === the card's own name) AND this fight's `cardBuffGains`
  — and re-applies the total on top of base. Still Undead-gated; general stat / Imp / Fodder buffs don't carry.
- **Verified**: typecheck + lint + `build:web` + full suite green (**399 tests**). New test: a 5-stack Knight
  dies and Reborns at 21/14 (base 3/2 + 15/10 prior + 3/2 this fight). The existing single-stack Reborn +
  Lantern carry-through test still passes (prior = 0 → unchanged).

### feat: restore the "Clear my boards" button in the Esc menu

Brought back a one-tap way to wipe this browser's captured finished-run boards (`boardLibrary`,
`localStorage['ascent.boards']`) — the local board section was dropped in #67 when the live Supabase shared
pool replaced local export/import sharing, but the local library is still written on every finished run, so
a "these went stale after a patch" clear is still useful.

- **`EscMenu.tsx`**: a new **Saved Boards** section with a single **Clear my boards** button (shows the live
  count) using two-tap confirm (arms → `danger` style + "Tap again to confirm", second tap clears) via
  `clearStoredBoards()`; a status line confirms. Deliberately did NOT restore the old export/import buttons —
  those served the pre-#67 file-sharing model the live pool superseded. Only `clearStoredBoards` +
  `loadStoredBoards` re-imported; all CSS classes (`.escboards`, `.escboards-msg`, `.escbtn.danger`) already
  existed.
- Scope note: clears **local** captures only — not the live shared pool or the leaderboard (those are backend).
- **Verified**: typecheck + lint + test (395) + `build:web` green; exercised live in-preview — seeded 3
  boards, opened the menu (button read "3 saved"), tap 1 armed the confirm, tap 2 cleared
  `localStorage['ascent.boards']` (count → 0, "Cleared your captured boards").

### feat: right-click buff tracking in combat (recruit + combat buffs, parity with the shop)

The shop's right-click inspect itemizes a minion's per-source buff breakdown ("Spirit Fire ×2: +6/+6")
from `card.buffs` (`CardBuff[]`, accrued by `recruit.ts`). In combat the inspect panel showed **nothing**:
combat units are rebuilt from the event log as `UnitFrame`s, and the `view` handed to `Card`/`Inspect`
carried no `buffs`. This wires the same breakdown into combat — both the recruit buffs a minion entered
the fight with **and** the buffs it gains mid-fight, merged by source.

- **`core/types.ts`** — new `MinionBuff` interface (structurally mirrors sim's `CardBuff`), added as an
  optional `buffs?: MinionBuff[]` on `BoardMinion`, `Minion`, and `MinionSnapshot`. This is the shared
  combat-event/snapshot boundary, so the shape lives in core; sim's `CardBuff` assigns to it structurally.
- **`core/combat/minion.ts`** (`instantiate`) carries `board.buffs` onto the live `Minion`; combat-only
  bodies (summoned tokens, Reborn) have none.
- **`core/combat/simulate.ts`** (`snapshot`) copies `m.buffs` into the `MinionSnapshot`, so `initial`
  carries each starting minion's recruit breakdown out to the UI.
- **`sim/reducer.ts`** — the `resolveCombat` player `BoardMinion[]` now passes `buffs: b.buffs` from the
  run board card into combat.
- **`ui/useCombatReplay.ts`** — `UnitFrame` gains `buffs`; `fromSnap` clones the recruit breakdown (so the
  per-beat fold can mutate safely); `computeFrame` folds each `buff` event into the unit's breakdown by
  **source name** (resolved via the `names` map, now passed in) using a new `recordBuff` helper — the
  combat counterpart of recruit's `bumpBuff`. A `reborn` clears the breakdown (back at base stats).
- **`ui/Unit.tsx`** — the combat `view` now passes `buffs: u.buffs`; the existing `<Inspect>` panel renders
  it unchanged (its `inspect.buffs` block already handles the shape).
- **Verified**: typecheck + lint + `build:web` + full suite green (now 396 tests). New core test proves the
  recruit breakdown survives into `initial.player[].buffs` and that buff-less minions stay `undefined`. Dev
  server HMR'd clean (no console errors); the live in-combat right-click is left for a playtest (a full run
  into combat with a buffed unit isn't reliably automatable).

### feat(ui): show the wave's max loss damage under the WAVE meter

The top bar showed the wave but not the stakes — how much Resolve a loss this wave can cost. Added a small
threat-coloured "♥ Max −N" line directly under "WAVE N", where N is `lossDamageCap(wave)` — the per-round
loss-damage cap the reducer already applies at settle (5 through wave 3, 10 through wave 6, 15 from wave 7).
So the player can read the downside at a glance before committing to a fight.

- **`HudBar.tsx`** — wrapped "WAVE N" in a `.wavecol` column with the new `.maxdmg` sub-label
  (`lossDamageCap(run.wave)`, heart icon). Hidden in **Practice** mode, where Resolve is unlimited and a
  loss deals no damage.
- **`styles.css`** — `.alt .wavecol` (vertical stack) + `.alt .maxdmg` (threat-coloured, ~10px uppercase,
  heart in `--threat`).
- **Verified**: typecheck + lint + `build:web` + full suite (396) green. Live-checked in the running app —
  started an Ascent run; the top-left bar reads "WAVE 1 / ♥ MAX −5" (cap 5 at wave 1), no console errors.

### balance: Displacement + Darah's Displace can no longer target a golden minion

Both the Displacement spell and Darah's Displace hero power swap a friendly minion for a random tavern
offer. Trading away a **golden (triple)** — hard-won, doubled stats + doubled effects — for a random minion
was a strictly bad / trap interaction, so goldens are now excluded as targets for both.

- **Authoritative (the rule):** `swapWithTavern` (the shared spell + power path in `recruit.ts`) now returns
  `false` immediately on a golden `boardMinion` — before consuming any RNG — so the swap is a clean no-op.
  Darah's power already treats a `false` return as "no charge spent". For the spell, the reducer's `play`
  case fizzles a `targetNoGolden` cast on a golden target (`return state`), keeping the spell in hand — same
  pattern as Resonance's non-Battlecry fizzle.
- **Data:** new optional `targetNoGolden` flag on `CardDef` (core types + zod schema), set on `displacement`.
- **UI (`Recruit.tsx`):** the Displacement drag snaps back without consuming the spell on a golden target
  (mirrors the `targetMaxTier` guard); Darah's Displace aim line no longer lights up / accepts a golden
  minion (`heroTargetsNoGolden` in `minionAt`).
- **Verified:** typecheck + lint + `build:web` + full suite green (**397 tests**). Two new reducer tests cover
  the spell (fizzles, spell kept in hand) and the power (no swap, charge not spent); the existing
  non-golden Displacement/Displace tests still pass. Dev server HMR'd clean (no console errors) — the live
  golden-target drag is left for a playtest (not practically automatable).

### fix: Reborn aura flickered behind the card on placement (z-layering parity with divine shield)

The reborn wisp dropped **behind** the card for ~850ms when a reborn unit was placed/moved on the board —
the exact bug we'd already fixed for the divine-shield bubble. Cause: `puffOnBoard` raises a freshly-landed
card to `z-index:111` (above the `.pixifx` overlay at z110) so its landing dust tucks *behind* it. The
divine-shield fix skipped that raise for `.dscard` cards (keep the bubble in front), but the check was
hard-coded to `dscard`, so reborn cards (`.reborncard`) still got raised over their own aura.

- **`Recruit.tsx`** (`puffOnBoard`): the skip-raise check is now `AURA_CFGS.some(c => el.classList.contains(
  c.marker))` — i.e. skip the raise for **any** aura-bearing card (shield OR reborn), driven off the shared
  config so future aura kinds are covered automatically. Aura-free cards still raise as before.
- Audited the rest of the divine-shield layering/visibility work for parity: drag mini-sparkle
  (`cfg.dragKw`), per-marker combat scoping, and the discover/chooseOne hide (whole-layer
  `setShieldsVisible`) **already** iterate generically over `AURA_CFGS`, so reborn was covered everywhere
  except this one z-raise. `.pixifx` (z110) is the only overlay cards can out-stack, and `111` was its only
  offender — fix is complete.
- **Verified**: typecheck + lint + `build:web` green; app boots clean (no crash, Pixi ready). The live
  placement (dust + 850ms raise) needs an in-game look — headless can't animate it.

### tweak: Reborn aura — bake the arched-card silhouette + per-badge cutouts into `REBORN_FRAG`

Replaced the reborn aura's rounded-box SDF with a **polygon-outline SDF** that traces the game's actual
**arched card** silhouette (dome top → vertical sides → rounded bottom), plus **four elliptical cutouts**
that carve the glow off the tier pill / attack / medallion / health badges. The shape was sculpted live in
an **in-chat WebGL shape editor** (the exact `REBORN_FRAG` running in the user's browser with draggable
outline + cutout handles, since the headless preview can't animate) and the tuned values baked back as GLSL
constants — no texture, no perf cost (pure analytic SDF).

- **`pixiFx.ts`**: `REBORN_FRAG` now defines `const vec2 PTS[15]` (the outline, quad coords, y-down) +
  `CP[4]`/`CR[4]` (cutout centres/radii); `sdPoly()` (iq winding-number polygon SDF) replaces `sdRoundBox`;
  cutouts loop as soft elliptical falloffs. Tuned dials baked in: corner-round 0.010, `core` k=7, `halo`
  k=6 (snug glow), warp 0 (steady outline, no jitter), drift speed 0.20, `maxAlpha` 0.40 (subtle). Reborn
  tint `REBORN_BLUE_RGB` → `[0.32, 0.59, 1.0]`.
- **Verified**: typecheck + lint + `build:web` green; app boots clean (no crash, Pixi ready). Shader
  proven via **framebuffer readback** (compiles + links; hollow centre α≈3; bright blue side edges α=102 =
  the 0.40 cap, blue-dominant; tier + health cutouts α=0). The shape is editable + re-bakeable from the
  shape-editor widget; re-tune there rather than hand-editing the constants.

### feat: Reborn aura — blue wispy wraith (generalized the shield aura system to two kinds)

Reborn now gets a persistent **blue wispy/wraith aura** (the spirit that brings the unit back), the sibling
of the gold divine-shield bubble. Generalized the whole aura system to be **kind-aware** rather than
duplicating it:

- **`pixiFx.ts`**: a `kind: 'shield' | 'reborn'` threads through the bubble — registry keyed by `kind uid`,
  shader + colour chosen per kind (`AURA` config). New `REBORN_FRAG` shader: no glassy fresnel/hex; instead
  a hazy translucent body with drifting fbm-noise wisps that RISE, brighter tendril streaks, a feathered
  edge, gentle pulse — spectral blue. `setShield/clearShield/breakShield` take a `kind`; the same
  breathe/mini-sparkle/pop machinery serves both. Reborn break = `rebornShatter` (soft blue bloom + rising
  smoke wisps + spirit motes, no shards); reborn rebirth = `rebornSummon` (blue wisps converge + rise into
  the re-formed unit).
- **`Recruit.tsx`**: `syncShields` generalized to loop over `AURA_CFGS` (`.dscard`→shield, `.reborncard`→
  reborn) with composite keys, so a unit can carry both. Shield breaks DELAYED (hit→settle→shatter); Reborn
  breaks IMMEDIATELY on the reborn beat → fires the shatter **and** the re-form summon (so the read is:
  die → spirit shatters → unit re-forms). All the combat-scope / modal-hide / drag-from-any-source fixes
  apply to both kinds.
- **Audio**: new `sfx.rebornShatter` (`rebornshatter.mp3`) + `sfx.rebornSummon` (`rebornsummon.mp3`, a
  distinct clip from the generic summon), deduped, in the mixer + dev preview.
- **Removed** (replaced by the aura): the CSS `.reborncard` blue glow/halo/art-border, the rising "reborn
  tears", and the combat `.unit.reborn` flare/ring. `.reborncard` stays as the tracker's DOM hook.
- **Verified**: typecheck + lint + 402 tests + build green; framebuffer readback confirms the gold shield
  still renders (R>G>B) AND the reborn aura renders blue (B>R), both shaders compile (no init errors). The
  wispy look + the break/summon timing need an in-game eyeball (headless preview freezes Pixi's ticker).
### fix(art): retire stale ART_ALIAS so the refreshed art actually shows (guel, heckbinder, demonanomaly, +3)

Follow-up to the art refresh (#73): `art.ts` had a leftover `ART_ALIAS` map that forced 6 cards to render a
*different* file — `heckbinder→heckbinder2`, `combinator→combinator2`, `guel→guel2`, `demonanomaly→demonanomaly2`,
`manafont→goldfont`, `emberpouch→goldpouch` — and every one of those alias files was the **old pre-refresh art**
(Jun 23). So the new masters (correctly wired under the proper card ids by the refresh) were shadowed. The owner
caught guel + heckbinder + Demonic Anomaly; the same bug silently hit combinator, Gold Font, and Gold Pouch too.

Emptied the alias map and deleted the 6 stale files, so each card uses its new base-named art. The alias
mechanism stays (empty) for future one-off swaps. **Verification:** typecheck + build:web green; on `chore/art-refresh`
the fix was confirmed live (all 6 new arts load at 512px, the stale files 404) — but #73 merged just before that
commit, so this re-lands it on `main`.

### art: refresh all minion + hero art (new illustrated masters → optimized WebP)

Re-wired the updated art masters from `C:\Game Assets\Ascent Art\{Minions,Heroes}` — **93 minion/token arts + 12
hero portraits** (the full set — done in two passes as the owner finished exporting).

- **Matched by normalized name, not by hand.** A throwaway tsx matcher (`wire-art.ts`, deleted after) mapped each
  PascalCase source file → cardId/heroId by comparing the normalized filename to the **live** card/hero names
  (`ALL_CARDS` / `HEROES`) — so renames are correct automatically (e.g. `EternalKnight.png`→`knit`, whose old
  README name "Grave Knit" was stale). Most matched by name; the rest used verified explicit overrides:
  `ChaosMagnetic`→`symbioticattachment` (the Magnetic chaos token), `Fodder`→`fred`, `JenkinsAndFi`→`jenkins`,
  `SparePartsDrone`→`drone`, `TrainingDummy`→`sandbag` ("Target Dummy"), and `Pup1`/`Pup2`→ the two `pup` variants.
- **Optimized:** `npm run optimize-art` downscaled to ≤512px WebP q85 (and deleted the in-repo PNGs; masters stay
  out-of-repo). **105 files, 216.0 MB → 5.35 MB (97.5% smaller)** — ~2 MB masters → 36–65 KB each.
- **Only card with no new source:** `discoverspell` (Triple Reward — kept its existing art); `omen` never needs art.

**Verification:** typecheck + build:web green; restarted the dev server (the glob compiles at startup) and
confirmed **live in-preview** — hero portraits (picker + hero panel + opponent frame), shop minions, and the
Chaos Attachment token render the new art (0 broken, no console errors); the 8 second-pass arts (gryphon, acid,
tara, taragosa, betterbot, abhorrenthorror, demonanomaly, sandbag) all load at 512×512.

### feat: leaderboard — "Hall of Champions" (latest victory runs) on the title screen

A **Leaderboard** button on the title screen opens a full-page **Hall of Champions** — the latest 20 victory
runs from the shared backend, each champion shown with their final winning warband.

- **Logging** (`store.ts`): a `victory` transition now also fires `uploadVictory` (fire-and-forget) — hero,
  author, wave, and the run's **final winning board** — alongside the existing board capture. Practice doesn't
  reach `victory` (it ends in `gameover`), so the board is Ascent victories only, as intended.
- **Backend** (`remoteBoards.ts`): `uploadVictory` (insert into a new `runs` table) + `fetchVictories(20)`
  (newest first). Same no-op-when-unconfigured / fire-and-forget / never-throws contract. `runs` table + RLS
  added to `schema.sql` (anon select + insert; `board` jsonb holds the final warband).
- **UI** (`Leaderboard.tsx`, new): a full-page overlay (not a modal — that's the key change after first pass),
  scrollable, with a **← Back** button top-left. Each entry = rank · hero portrait · author · wave · date, with
  the final warband rendered **inline** using the same `Card` as the end screen (so the cards show full text on
  hover). Graceful loading / empty / offline states. Store gained `showLeaderboard` + `openLeaderboard` /
  `closeLeaderboard`; `Title.tsx` got the button (a `.titleactions` row beside Settings); `Game.tsx` renders it.
- **Two display fixes from review:** (1) the warband cards overflowed + clipped because **compact cards size off
  `--ccw`**, not `--cw` — the leaderboard now overrides `--ccw` (others derive from it) + `flex-wrap`, so a wide
  warband never overflows and tier badges aren't cut off; (2) the card's full-text hover popup rendered *behind*
  the old modal panel — making it a full page (the topmost layer) puts the popup on top.

**Files:** `Leaderboard.tsx` (new), `store.ts` (victory log + flags), `remoteBoards.ts` (`uploadVictory` /
`fetchVictories`), `Title.tsx` (button), `Game.tsx` (render), `styles.css` (full-page + `--ccw` sizing),
`schema.sql` (`runs` table). **Verification:** typecheck + lint + test (402) + build:web green; verified
**live in-preview** end-to-end — inserted 3 test champions, confirmed the rows, the inline warbands at the right
size (150px, no overflow/clipping), the Back button, and the full-text hover popup rendering **on top**; then
the test rows were cleared. **Follow-up (optional):** scope the board to the current version (a one-line filter)
if a balance patch should reset it.

Also in this PR: a **← Back** button on the hero picker (Ascent + Practice → title), matching the leaderboard's,
so picking a mode isn't a one-way door (`HeroSelect.tsx` calls `openTitle`; `.hsback` mirrors `.lbback`).
### chore(content): remove Toxin Tender

Pulled the Undead T5 **Toxin Tender** (`toxin`, "Battlecry: give a friendly Undead Venomous") per the owner.

- Card def removed from `content/cards/undead.ts`; its 7 specific tests removed from `run.test.ts` (→ 395).
- The general **targeted-Battlecry primitive stays** (`target:'friendly'` / `targetTribe` / `pendingTarget`):
  ~11 spells still use `target:'friendly'`, so the machinery + recruit UI are live. `targetTribe` now has no card
  user (a dormant primitive); the explanatory code comments still name Toxin Tender as the historical example.
- Regenerated `docs/cards.csv` (`npm run dump-cards`) and re-baked the opponent pool (`npm run pool`) so neither
  references `toxin` (synthetic boards no longer draw it; any stale committed/remote board referencing it was
  already dropped at load by `isServableBoard`). Removed the art-wiring README row.

**Verification:** typecheck + lint + test (395) + build:web green; `grep toxin` clean across content, the generated
pool data, and `cards.csv`. Left as-is: historical changelog (README highlights) + the balance-handoff snapshot.

### chore: re-baked SFX mix defaults (owner pass via the dev mixer)

Whole-bank volume pass dialed in by ear in the DEV SFX mixer, pasted into `SAMPLE_VOL_DEFAULTS` (sfx.ts)
as the shipped defaults. Notable moves: `pulse` 0.5→0.67, `roll` 0.61→0.69, `cardVoice` 0.09→0.18,
`summon` 0.65→0.37, `triggerpulse` 0.5→0.24, `triggerglow` 0.5→0.34, `divineshieldbreak` 0.6→0.26,
`taunt`/`discover`/`freeze`/`unfreeze`/`upgrade`/`buy`/`clickthock`/`combatStart`/`deny` all trimmed.
(Players who've already touched the mixer keep their saved `ascent.sfxvol` overrides — defaults apply to
fresh/never-customized installs.)

**Files:** `sfx.ts` (`SAMPLE_VOL_DEFAULTS`). **Verification:** `typecheck + lint + build:web` green.

### fix: divine-shield bubble — five bugs (stale persist, over-Discover, drag from shop/board, frozen-tavern)

Bugs surfaced in-game after the shield shader shipped:

1. **Stale bubble persists into the shop after combat** (also after roll / tavern-up). A vanished bubble
   (esp. an *enemy* combat unit's, with no recruit equivalent) was parked in `pendingClearRef` with a grace
   timer — but the rAF loop only runs during fighting/drag, so on a static shop screen the grace **never
   expired** and the bubble froze at its old position. Fix: `syncShields` now clears a vanished bubble
   **immediately** when not mid-animation (the grace is only for a live drag/post-drop settle, where a uid
   may genuinely be mid-remount); pending clears also **flush** the instant the animation window ends.
2. Same root cause as #1.
3. **Bubble shows over the Discover screen.** Discover / Choose One render at z50 with a translucent backdrop
   — *below* the z110 FX canvas — so bubbles for the dimmed board floated in front. Fix: new
   `pixiFx.setShieldsVisible()`, toggled off whenever `run.discover || run.chooseOne`.
4. **Drag sparkle didn't follow from shop or a board reposition** (only from hand). `draggedShielded` was
   inferred from whether the dragged card's *original* element was still in the `.dscard` set — true for a
   hand drag (original hidden in place) but false for shop/board (original removed). Fix: read the drag's
   `view.keywords` instead, so the follow works from any source.
5. **A frozen shielded shop minion's bubble persisted onto the combat screen.** The tavern zone keeps
   rendering shop cards during the combat `closing` stage, so `[data-zone] .card.dscard` still matched the
   frozen card → its bubble floated over the arena. Fix: during combat, scope the selector to `.unit
   .card.dscard` (combat units only); and the break-detection now fires **only for a real `.unit` that lost
   `.dscard`**, so the excluded shop card clears quietly instead of wrongly exploding.

**Files:** `pixiFx.ts` (`setShieldsVisible`), `Recruit.tsx` (`syncShields` clear-vs-grace + drag detection +
a `fightingRef` + the modal-hide effect). **Verified:** typecheck + lint + 383 tests + build green;
`setShieldsVisible` toggles the layer (DOM check). The three gameplay-state fixes need an in-game confirm
(headless preview can't drive a real combat/drag).
### feat: live shared opponent pool via a Supabase backend (auto-sync) + drop the manual board-sharing UI

The manual board pipeline (capture → Export → drop in `docs/board-exports/` → `npm run pool` → committed
`OPPONENT_POOL_DATA`) is replaced — for the live game — by an automatic shared backend. Finished runs sync to a
hosted Postgres table and load back into the opponent pool at startup, so two devs (Kevin + Mike) automatically
face each other's builds with zero manual steps. The committed pool stays the **offline floor**.

- **Provider — Supabase (decided after weighing scale).** Hosted Postgres + JS client + dashboard. The workload
  (low write, read-once-per-patch + identical-for-everyone, no realtime) is trivially cacheable, so the DB is
  never the scaling wall; the public-readiness work (CDN-front the read path, server-side replay validation for
  anti-cheat) is DB-independent and deferred. Rationale captured in `docs/roadmap.md` + `docs/board-pool.md`.
- **The seam** (`packages/ui/src/remoteBoards.ts`): `uploadBoards` (fire-and-forget INSERT on run end) +
  `fetchAndRegisterPool` (one time-boxed SELECT at boot → `registerOpponents`). **No-ops when the env vars are
  unset**, so the build, headless tests, and offline play are unaffected. Boards are served by **version prefix**
  (`patch like '<version>+%'`) so per-commit SHA churn doesn't hide them; the full `patch` (`version+sha`) is
  stored for fine-grained pruning. Determinism preserved: the remote pool is fetched once at boot and kept static
  for the session, exactly like `OPPONENT_POOL_DATA`.
- **Wiring** (`store.ts`): startup `fetchAndRegisterPool('<version>+')` after the committed/local registration;
  run-end `uploadBoards(saveRunBoards(...))` (boards captured on a `gameover`/`victory` transition — Ascent
  win/loss AND Practice round-15, owner's call to let Practice contribute for now). `saveRunBoards`
  (`boardLibrary.ts`) now **returns** the captured boards so the same set feeds both local + remote.
- **Settings cleanup** (`EscMenu.tsx`): removed the now-obsolete **Shared Boards** section (Export / Import /
  Clear my boards) + all the code that only fed it (file-import handler, board-count state, `playerName` lookup).
  Verified live in-preview: Settings is now Audio · Gameplay · Display Resolution · Run.
- **Config travels with the repo:** `apps/web/.env` is **committed** (un-ignored in `.gitignore`) with the
  Supabase URL + **publishable** key — safe by design (it ships in the client bundle; RLS protects the data), so
  Mike + the itch build get it with zero setup. `.env.local` stays gitignored for personal overrides. The
  `service_role`/secret key is never committed. RLS: anon may `select` + `insert` on `boards`; no update/delete.
- **Schema + docs:** `schema.sql` (table + `(patch,wave,power)` index + RLS policies + prune snippets) and
  `docs/board-backend.md` (setup + ops + the hardening/scaling path).

**Files:** `remoteBoards.ts` (new), `store.ts`, `boardLibrary.ts` (return type), `buildinfo.d.ts` (env typing),
`EscMenu.tsx` (drop Shared Boards), `apps/web/.env` (committed) + `.env.example`, `.gitignore`, `schema.sql`,
`docs/board-backend.md`, `packages/ui/package.json` (+`@supabase/supabase-js`). **Verification:** typecheck +
lint + test (402) + build:web all green; Supabase read+write validated end-to-end via curl (insert returned the
row; the `boards` table + RLS confirmed) AND live — the boot SELECT (`…/boards?select=snapshot&patch=like.0.1.0%2B%25`)
returned 200 in the dev server with no console errors; the Settings menu confirmed clean in-preview. **Follow-up:**
server-side replay validation (anti-cheat) + CDN-fronting before any public launch — both in the roadmap.

### feat: opponent pool is synthesized from the card set (banded to the enemy curve, waves 1–20) — retire the house bot

**Clean-slate reset + a new generation model for the committed opponent pool.** Two parts:

1. **Wiped the board "profiles."** Deleted the committed imports `docs/board-exports/lemon.json` (self) and
   `orangez.json` (friend) — the player/friend boards that had been baked in. (localStorage captures are
   per-browser and cleared separately via **Esc → Shared Boards → Clear my boards** / `clearStoredBoards`.)

2. **Replaced the house bot with from-scratch synthesis.** The bot (`buildBootstrapPool`) only survives to
   ~wave 9, so a bot-only bake covered only waves 1–9 and the rating ladder topped out there too (bands
   saturated past 9). Now the pool is **generated straight from the card set**, banded to the **tuned enemy
   curve**, covering **every wave 1–20**:
   - **All-wave rating ladder, no bot** (`rating.ts`): `buildWaveLadders(seeds, fidelities, extra, opts)` gains
     `opts.proceduralWaves`/`proceduralSeeds` — it folds the **procedural threat boards** (`buildEnemyBoard`
     across the 5 archetypes × N seeds) into every wave. They're wave-scaled by `enemyScaling` for all 20 waves
     and span weak (venom swarm) → strong (iron wall / glass cannon), so the ladder calibrates 1–20 with no bot.
     The bake passes `seeds: []` (bot off). Legacy bot/real-board paths preserved (tests still pin them).
   - **Curve-matched synthesizer** (`synthesize.ts`): new `synthesizeWaveFromCurve(wave, ladders, seed, opts)`.
     Per wave it samples the procedural boards (the "power banding" anchor), picks `perWave` of them spread
     across the power range, and for each **copies the width + power** and fills that shape with **real tribe
     cards** stat-scaled uniformly to hit it — cycling the 5 tribes for synergy variety. Real cardIds carry real
     keywords/effects, so a served board fights like a real tribe board; opponents only need the right
     *strength*, not buildability. Deterministic; tagged `origin:'synthetic'` with a baked wave-relative rating.
   - **Pool bake rewrite** (`build-pool.ts`): dropped the bot house-plan + frequency analysis + the competitive
     floor; now builds the procedural-curve ladder, synthesizes `SYNTH_PER_WAVE` (**8**) boards for each of
     waves 1–`MAX_WAVE` (**20**), merges any imports (preferred over synthetic in curation), dedupes, rates,
     curates, writes. Knobs: `SYNTH_PER_WAVE`, `MAX_WAVE`, `PROC_SEEDS`.

**Result:** `opponentPool.data.ts` is now **160 boards (8/wave × waves 1–20)**, baked under `0.1.0+<sha>`, with a
healthy weak→strong band spread at every wave (global `b0:9 b1:12 b2:10 b3:18 b4:35 b5:43 b6:17 b7:16`; every
wave shows `8[band span]` across several bands). No thin/empty/saturated high waves — the bot's old failure mode
is gone by construction. Matchmaking (`pickOpponent`) now finds exact-wave boards for 10–20 instead of clamping
to wave 9. Owner's call: anchor difficulty to the **tuned enemy curve** (not skilled-player strength).

**Files:** `rating.ts` (procedural-curve ladder option), `synthesize.ts` (+`synthesizeWaveFromCurve` + tribe-pool
helpers), `build-pool.ts` (bake rewrite), `synthesize.test.ts` (+1: high-wave, no-seed determinism + band-span),
`opponentPool.data.ts` (regenerated), deleted `docs/board-exports/{lemon,orangez}.json`, `docs/board-pool.md`
(rewritten for the new model). **Verification:** typecheck + lint + test (**401**, synth suite 2→3) + build:web all
green; `npm run pool` reports 160 boards / 20 waves / full band spread; new test proves wave-15 synthesis works
with no real seed and is byte-deterministic. **Follow-up:** to harden the late game beyond the designed curve,
raise the synth power jitter or import strong real boards (both ladder- and curation-preferred).

### feat: title screen → modes (Ascent / Practice) + Settings

A proper front door. The app now boots into a **title screen** (a new top-most overlay, same store-flag pattern as the hero picker — no router) with three entries:

- **Ascent** — the scored climb (the existing game): the 3-hero picker → run.
- **Practice** — a relaxed 15-round sandbox: the **whole hero roster** in the picker, **unlimited Resolve** (a loss costs no health; you can't game-over from HP), a **3× shop clock**, and the run **ends after round 15** regardless of W/L (the win-15 victory is Ascent-only). New `RunState.mode: 'ascent' | 'practice'`.
- **⚙ Settings** — opens the Esc menu: Audio (Volume + Mute), **Combat speed** (newly surfaced here — was HUD-only), Display resolution, Shared boards, Start Over. Dropped the **Player-name field** + the **Compact/Full-text toggle** (cards stay compact by default — the store keeps `compactCards: true`). **Bugfix:** the menu was `z-index: 320`, *below* the title's `450`, so opening Settings from the title rendered it behind the title (invisible — it looked like the button did nothing); raised to `500` so it sits above the title.

Engine: `settleCombat` skips loss-damage in Practice; `advanceCombat` ends Practice at wave 15 and gates the win-15 victory to Ascent; `createRun` takes a `mode`. UI: new `Title.tsx`; store `showTitle` / `pendingMode` + `startAscent` / `startPractice` / `openTitle`; Recruit's `turnSeconds` ×3 in Practice; the EndScreen routes "Play Again" → title and shows a "Practice complete · NW NL" summary; + title CSS (mirrors the picker's dimmed-board backdrop).

**Files:** `state.ts` (mode + createRun), `reducer.ts` (settle/advance), `store.ts` (title state + actions), `Title.tsx` (new), `Game.tsx` (route), `Recruit.tsx` (3× clock), `EndScreen.tsx` (title + practice framing), `styles.css`, `run.test.ts` (+2). **Verification:** typecheck + lint + test (401, +2) + build:web green; **live** — boots to the title; Ascent opens a 3-hero picker (`mode: ascent`), Practice opens the full 12-hero picker (`mode: practice`), the Settings button opens the Esc menu; console clean. Practice's unlimited-health + 15-round-end are unit-tested.

### fix: Displacement keeps the displaced minion intact (and swapped-in Battlecries still don't fire)

Two owner tweaks to the board↔tavern swap (Displacement spell + Darah's Displace):

- **The displaced minion keeps EVERYTHING when sent to the tavern.** Its full state (buffs, stats, keywords, golden, `summonBonus` / `ascendProgress` / etc.) is stashed on the offer's new `ShopCard.held` and restored **intact** when re-bought or swapped back — instead of resetting to a fresh base offer (the previous behavior). `swapWithTavern` stashes `held: { ...boardMinion }`; the buy path and the swap-in path restore `{ ...held, uid: new }`; `shopView` shows the held minion's preserved stats / keywords / golden frame.
- **Swapped-in Battlecries don't fire** — already the case (the incoming minion is placed, never "played"), now locked in with a test.

**Files:** `state.ts` (`ShopCard.held`), `recruit.ts` (`swapWithTavern`), `reducer.ts` (buy held-restore + checkTriples), `Recruit.tsx` (`shopView` held branch), `run.test.ts` (+2). **Verification:** typecheck + lint + test (399, +2) + build:web green; tests cover full-state preservation + re-buy restore + the no-Battlecry guarantee; **live** — a displaced 9/8 Taunt minion shows **9/8 + Taunt** in the tavern (not reset to base), console clean.

### feat: Chaos Attachment grant animation — flies in from the hero portrait

UI juice for the Chaos hero power: when a Chaos Attachment is granted (every 5th turn), the new hand token now **flies in from the hero portrait**. Engine side — the reducer's recurring grant bumps a transient `chaosGrantSeq` and records the token's `chaosGrantUid` (the established one-shot-signal pattern, like `fodderEatenSeq`). UI side — a Recruit effect watches the seq (inits to the current value, so it doesn't fire on mount / for the game-start token), finds the new hand card (`[data-uid]`) + the portrait (`.heroimg`), and `gsap.from`-flies the card from the portrait position (scaled / rotated / faded) into its hand slot with a slight overshoot, clearing the inline transform on complete.

**Files:** `reducer.ts` (signal on grant), `state.ts` (`chaosGrantSeq`/`Uid`), `Recruit.tsx` (the fly effect), `run.test.ts` (signal assertion). **Verification:** typecheck + lint + test (397) + build:web green; **live** — staged a Chaos run + a token, bumped the signal, and caught the card mid-fly (gsap translating it from the `.heroimg` portrait, scale/opacity interpolating), console clean.

### feat: Spell Cart (T5 spell) — refresh the tavern full of spells

New **T5 / 2g** untargeted spell: **refresh the tavern with spells instead of minions**. New `rollSpellShop(state)` (shop.ts) replaces the minion offers with up to `tierSlots` **distinct** random eligible spells (seeded Fisher–Yates over the tier-eligible spell list; returns the current minion offers to the pool); the right-hand spell slot is untouched, and the next normal roll/turn restocks minions — so it's inherently **one-shot** (no mode flag). The cast factory `spellRefreshToSpells` calls it. The buy path gained a branch: a **spell offer sitting in the minion row buys into the HAND at its own cost** (no minion creation / triple), like the spell slot. The shop's CardView memo now also passes the spell-display opts so those offers read their right cost + value.

**Files:** `shop.ts` (`rollSpellShop`), `recruit.ts` (`spellRefreshToSpells` + import), `reducer.ts` (buy-path spell-offer branch), `spells.ts` (Spell Cart), `schema.ts` + `core/types.ts` (`spellRefreshToSpells`), `Recruit.tsx` (`shopViews` spell opts), `run.test.ts` (+2), art, `cards.csv`. **Verification:** typecheck + lint + test (397, +2) + build:web green; **live** — forcing a spell-shop renders 3 spell cards in the minion row (art loaded, `.spell` class) and a dispatched buy moves Spirit Fire into hand for its 2 cost (embers 10→8), console clean. Tests cover the spell-shop fill (all distinct spells) + next-roll-restocks-minions + the spell-offer buy.

### feat: Steward of Spells (neutral T5) — End of Turn copies your last spell

New neutral **T5 3/7** minion: **End of Turn, conjure a copy of the most recent spell cast this run** (golden: 2 copies) — a spell-engine payoff that snowballs whatever spell you're leaning on. Added a `lastSpellCastId` field to `RunState`, set in `castSpell` on every player cast (persists across turns); the new `spellCopyRecent` End-of-Turn factory pushes 1 (× golden) copy to hand, capped at `handMax`, no-op if no spell has been cast yet. Art wired.

**Files:** `neutral.ts` (Steward), `recruit.ts` (`lastSpellCastId` in `castSpell` + `spellCopyRecent` factory), `state.ts` (`lastSpellCastId`), `schema.ts` + `core/types.ts` (`spellCopyRecent`), `run.test.ts` (+2), art, `cards.csv`. **Verification:** typecheck + lint + test (393, +2) + build:web green; tests cover the full flow (cast Spirit Fire → EOT copies it), the golden ×2, and the no-spell-yet no-op.

### feat: Darah hero + Displacement spell (board↔tavern swap)

A new shared mechanic — **swap a friendly board minion with a random tavern minion**:

- **Darah** (hero, 30 hp) — **Displace** (targeted, once per turn): choose a friendly minion and swap it with a random tavern minion. New `displace` `HeroPowerKind` + a reducer branch (no-op / no charge on a missing target or an empty tavern).
- **Displacement** (spell, T4/2, target friendly, `singleCast`) — the same swap. New `spellDisplace` factory.

Both call a shared **`swapWithTavern(state, boardMinion)`** in `recruit.ts`: the tavern minion takes the board slot as a **fresh** instance (base stats + any offer buff + golden, doubled — **no** Battlecry / summon-buff), and the displaced minion returns to the tavern as a **fresh re-buyable offer** (its accrued buffs reset — the cost of the gamble). `checkTriples` runs after, so a swapped-in third copy still combines.

**Design calls flagged (easy to change):** (1) the displaced minion **loses its buffs** (returns to the tavern fresh); (2) the swapped-in minion arrives **without** firing its Battlecry or summon-buffs (it's a placement, not a play).

Art: Darah portrait (**placeholder** — used `Darah.png`, since the requested `Darah2` master isn't in the art folder yet), Displace power (`Displace.png`), Displacement spell (`Displacement.png`).

**Files:** `heroes.ts` (Darah + `displace` kind), `recruit.ts` (`swapWithTavern` + `spellDisplace`), `reducer.ts` (displace branch + import), `spells.ts` (Displacement), `schema.ts` + `core/types.ts` (`spellDisplace`), `run.test.ts` (+2), art (3 webp), `cards.csv`. **Verification:** typecheck + lint + test (393, +2) + build:web green; **live** — Darah's portrait + "Displace" power render in hero-select. The two tests cover the spell + the power (sandbag ↔ gnash; the displaced minion lands in the tavern; the charge is spent).

### feat: Acid rework + remove Voracious Imp

- **Acid** reworked: now **every 3 refreshes** (was 4) it consumes a tavern minion **and buffs the remaining tavern minions +1/+1** (golden: double the consumed stats + tavern **+2/+2**). The `onRollConsumeShop` factory gained a `tavernBuff` param (golden ×2 via `gold(self)`); the consume became conditional so the tavern buff still lands even when there's nothing to consume. New **Acid2** art (`acid.webp` overwritten). Tier/stats unchanged (T6 7/7).
- **Voracious Imp removed** — it was the only `fodderMult` demon. Deleted the card, its `CARD_REFERENCES` popup entry, and updated its tests: the general consume-on-roll + buffed-Fodder coverage was **retargeted to a vanilla Demon** (Maw, ×1); the golden-3× multiplier test was **dropped** (no multiplier card remains — `fodderMultiplier` now always returns 1, kept for a future re-add). Not in the opponent pool, so no regen.

**Files:** `demons.ts` (Acid params/text; removed Voracious Imp), `recruit.ts` (`onRollConsumeShop` tavern buff), `Recruit.tsx` (`CARD_REFERENCES`), `run.test.ts` (Acid test + retargeted consume tests), art (`acid.webp`), `cards.csv` (81 minions now). **Verification:** typecheck + lint + test (389) + build:web green; a new test rolls 3× and asserts Acid eats a minion + the remaining offers each carry +1/+1.
### feat: Golden Touch + Consume spells; rename Point Solution → Resonance

Three tavern-spell changes:

- **Point Solution → Resonance** — rename (id `pointsolution`→`resonance`, name, comments, tests) + new art (`resonance.webp`; removed the orphaned `pointsolution.webp`). The reducer's Battlecry-target guard keys off the *factory* (`spellReplayBattlecry`), so the rename didn't touch behavior.
- **Consume** (T4, 2g, target a friendly Demon) — it devours **one** random tavern minion (reuses `spellDemonConsumeTavern` with `count: 1`, the same pipeline as Cupcakes). Not `singleCast`, so **Yazzus multiplies it** (a golden Yazzus → 3 consumed).
- **Golden Touch** (T4, 5g, untargeted) — make a random tavern minion offer **Golden**. New `ShopCard.golden` flag (factory `spellGildRandomTavern` sets a random offer golden); the **buy bakes it in by doubling the final stats exactly like the Gild hero power** (`addBuff('Golden Touch', …)` then `golden: true` — goldens store *doubled* stats, confirmed via the Gild path), and `shopView` shows the offer with the golden frame + doubled stats. A bought golden grants the golden Discover on play, like any golden. Triples exclude goldens, so there's no weird interaction.

**Files:** `spells.ts` (rename + 2 cards), `recruit.ts` (`spellGildRandomTavern` + comment), `reducer.ts` (buy golden-doubling + comment), `state.ts` (`ShopCard.golden`), `Recruit.tsx` (`shopView` golden), `core/types.ts` + `schema.ts` (factory id), `run.test.ts` (rename + 2 tests), art (3 webp), `cards.csv`. **Verification:** typecheck + lint + test (391, +2) + build:web green; **live** — a gilded sandbag offer renders with the crown + golden frame and **doubled stats (0/6 → 0/12)** in the tavern, normal offers stay 0/6, and it buys in as a Golden.
### chore: refresh Rohan + Myra hero portraits (Rohan3, Myra3)

Swapped new portrait art over the existing webp for **Rohan** (`art/heroes/rohan.webp` ← Rohan3.png) and **Myra** (`myra.webp` ← Myra3.png) via `optimize-art` (5.0 MB → 0.13 MB). Hero-power icons unchanged. Confirmed (no change) that the Chaos hero power is named **"Chaos Bond"**. The same batch also asked for new Nadja / Chaos / Darah portraits, but those masters (Nadja3 / Chaos2 / Darah2) aren't in `C:\Game Assets\Ascent Art\Heroes\` yet — deferred until they're dropped.

### feat: four tavern spells (Lantern Light, Fodder Treatment, Point Solution, Chrono Staff) + Tara → T4

Owner content batch. Four new tavern spells (all `neutral`, data + a recruit `cast` factory each) and a balance dial:

- **Lantern Light** (T1, 1g, target friendly) — give the target **+Tavern Tier / +Tavern Tier** (e.g. +3/+3 at Tier 3). New factory `spellBuffByTier`; scales with Tier *by design* (no spell-power bonus folded in — flagged).
- **Fodder Treatment** (T3, 2g, target friendly, `singleCast`) — **sell** the target (gain its base sell value as Gold) and spit its current stats onto your **left-most Demon**, firing that Demon's on-consume payoffs; no Demon → stats wasted but the sell + Gold still happen. New factory `spellSellToDemon` (mirrors `spellDevour` + the Consume `addBuff`/`onConsume` pipeline). Literal stat transfer — the Demon's fodder *multiplier* is not applied (flagged).
- **Point Solution** (T5, 3g, target friendly) — re-trigger a friendly **Battlecry** minion's Battlecry, reusing Myra's `replayBattlecry` path (so Drakko still amplifies it). New factory `spellReplayBattlecry`. "Only usable on a Battlecry minion" is enforced by a reducer guard: a non-Battlecry target **fizzles** (the spell stays in hand / drag snaps back) rather than being wasted.
- **Chrono Staff** (T5, 3g, untargeted) — your **End-of-Turn** effects fire **one extra time** this turn (stacks with Chronos, not with itself — a per-turn `extraEotThisTurn` flag, reset at the next turn start). Introduced a shared `endOfTurnRepeats(state) = chronosRepeats + staff` helper, routed through the real EOT **and** both UI previews (`projectEndOfTurnSteps`, Recruit telegraph) so they agree.
- **Balance:** **Tara → Tier 4** (was T2).

`EffectFactoryId` (core type) + the zod allowlist both gained the four ids. **Files:** `spells.ts` (+4), `dragons.ts` (Tara), `recruit.ts` (4 factories + `endOfTurnRepeats` + 2 preview callers), `reducer.ts` (turn-reset + Point Solution guard), `state.ts` (`extraEotThisTurn`), `index.ts` + `core/types.ts` + `schema.ts`, `Recruit.tsx` (telegraph helper), art (4 webp), `cards.csv`. **Verification:** typecheck + lint + test (389, +6) + build:web green; the Lantern Light spell art renders live (`lanternlight.webp`, naturalWidth > 0). New tests cover each spell + the Tara tier.
### feat: rename hero Symbiote → Chaos (+ "Chaos Attachment" token, new portrait art)

Owner: rename the Symbiote hero to Chaos, wire his new portrait, and rename his hero-power minion to "Chaos Attachment." Renamed the hero id `symbiote`→`chaos`, name → Chaos, the power `kind` `symbiote`→`chaos`, power name → "Chaos Bond", and the token's **display name** "Symbiotic Attachment" → "Chaos Attachment". The token's **card id stays `symbioticattachment`** on purpose — baked opponent boards, saves, and the magnetic / universalTribe tests reference that id, so keeping it means zero churn there. Added a legacy hero-id alias (`symbiote`→`chaos`) in `getHero` so old saves and the baked opponent pool (which carries `heroId:'symbiote'`) resolve to Chaos instead of falling back to the default hero — no pool regen needed.

Art: new portrait `Chaos.png` → `art/heroes/chaos.webp` (2.4 MB → 75 KB via `optimize-art`); the power icon reuses the existing (unchanged-power) art, renamed `art/powers/symbiote.webp` → `chaos.webp`; removed the orphaned `art/heroes/symbiote.webp`.

**Files:** `heroes.ts` (id/name/kind/power + alias), `tokens.ts` (display name), `reducer.ts` + `state.ts` (kind/heroId checks + comments), `run.test.ts` (createRun ids + titles), `core/types.ts` + `recruit.ts` (comments), art, `docs/cards.csv` (re-dumped). **Verification:** typecheck + lint + test (383) + build:web green; live hero-select renders "Chaos / Chaos Bond / Chaos Attachment" and the new `chaos.webp` portrait loads (naturalWidth > 0), console clean. The grant animation (token flying from the portrait) is its own follow-up PR.

### feat: live combat-text becomes the norm — Grim, Guel, Spirit Worgen show their current value in combat

Owner: "Grim is also not showing its current value in combat. this needs to be the norm across the board." Same gap as Mama Bear, generalized: a scaling card's COMBAT card (`Unit.tsx`) showed the *printed* rule text, while the shop (`Recruit.tsx`) already shows the live magnitude. Audited the whole live-text surface (`cardText.ts`) — every builder, which the combat chain wired vs. only the shop — and closed the combat-relevant gaps:

- **Grim** (`tallyBuffText`) — "+N/+N per Deathrattle this game" now reads the run's live Deathrattle tally instead of the printed "+1/+1".
- **Archmagus Guel** (`guelProgressText`) — the live grant + countdown from spells cast this run.
- **Spirit Worgen** (`summonScalingText`) — the per-summon gain that scales with spells cast this turn.

These three are **run-level scalers**, so combat reads them from the store frozen at the fight-start value — exactly how `Unit.tsx` already reads Taragosa's spell power (`spellAttackBonus(s.run)`). Added `useGame` selectors for `s.run.deathrattlesTriggered / spellsCast / spellsThisTurn` and slotted the three builders into the combat `??` chain, mirroring the shop's order. The recruit-only builders correctly stay out of combat: cadence (Frontdrake's turn countdown), cling (magnetize is a shop action), abhorrent ("next combat" telegraph), and the economy metrics (Soulsman gold, undead buy-bonus). The run-wide Eternal Knight enchant (`cardTypeTallyText`) is a golden-independent *suffix* with extra append/golden plumbing — deferred as a follow-up, not wired this pass.

**Files:** `Unit.tsx` (3 selectors + 3 chain entries + import), `cardText.test.ts` (+1 — `summonScalingText`; `tallyBuffText`/`guelProgressText` already covered). **Verification:** `typecheck + lint + test (380) + build:web` green; preview reload console-clean. typecheck validates the `s.run.*` selector paths; the cardText builders are unit-tested and the wiring mirrors the proven shop chain. Grim has no goldenText, so its golden card stays consistent with the shop (no regression). Staging a live Grim/Guel combat in the preview isn't practical, so verification is the cardText tests + the wired chain (as with Mama Bear).

### feat: Mama Bear's combat card shows its per-summon buff LIVE

Owner: Mama Bear's combat text should say, in real time, what the buff is. Her per-summon grant climbs (+2/+2 each Beast summoned), but the COMBAT card showed the printed text, not the live value. Two parts — the second is the load-bearing one a surface read misses:

- **UI** (`Unit.tsx`): wire the existing `summonImproveText` (already used in the shop) into the combat live-text `??` chain — it shows the current grant `+M/+M` (M = base 2 + accrued, golden-doubled), per-instance, matching the buffs-window formula.
- **Engine** (`factories.ts`): Mama Bear's combat factory `summonBuffTribeImprove` incremented `self.summonBonus` but **emitted no event**, and the UI's `computeFrame` only climbs `summonBonus` from `improve` events — so without an engine change the text would freeze at the combat-start value. Added `ctx.log({ type: 'improve', target: self.uid, amount: base })` (mirroring Kennelmaster's `avengeImproveSummon`), so the bonus — and the text — tick up live as each Beast is summoned. (Side effect, consistent with Kennelmaster: Mama Bear now also gets a ✦ float + a log line per Beast summon.)

**Files:** `factories.ts` (improve emission), `Unit.tsx` (cardText wiring + import), `cardText.test.ts` (+1), `simulate.test.ts` (+1). **Verification:** `typecheck + lint + test (379, +2) + build:web` green; the engine test asserts an `improve` per Beast summoned (Mama Pup → 2 Pups → 2 improves, amount = base 2), the cardText test pins the live string `(2 + accrued) × golden`, and no existing test broke (no prior Mama Bear *combat* test existed). Planned via a mapping workflow that caught the missing-event trap; live-combat staging (a tier-5 Mama Bear + a Beast summoner mid-fight) is impractical in the preview, so verification is the engine + cardText tests + the wired chain.
### fix: captured opponent boards retain per-minion accruals (Sergeant's Deathrattle HP-grant, Tara's ascend progress)

Owner: opponent boards should reflect their *progress + buffs* at the snapshotted moment. A captured board (`cleanBoard` in `snapshot.ts`) kept each minion's current buffed stats / keywords / golden + `summonBonus` (Mama Bear) + `rallyMechAtk` (Better Bot) — but **dropped** two accruals that `BoardMinion` carries and combat already seeds (`minion.ts`): **Sergeant's `hpGrantBonus`** (its improved Deathrattle HP-grant) and **Tara's `ascendProgress`**. So a served Sergeant reverted to its base Deathrattle grant and a served Tara lost its head-start toward Taragosa — both fought *weaker* than the real board. `cleanBoard` now copies both (same conditional pattern as the others).

**Files:** `snapshot.ts` (`cleanBoard`), `snapshot.test.ts` (+1). **Verification:** `typecheck + lint + test (378, +1) + build:web` green; new test confirms a snapshot keeps Sergeant's `hpGrantBonus` + Tara's `ascendProgress`. **Note:** takes effect for boards captured AFTER this change — the baked house pool (`opponentPool.data.ts`) + already-saved captures don't carry the fields until a re-capture or a `npm run pool` re-bake. (Spirit Pup's spell-progress isn't captured either, but that's the larger gap — it isn't threaded into combat yet; see the roadmap.)
### fix: spell-power telegraphs (Ryme→Cinderwing, Gnasher, Bladesmith) no longer fire a phantom Start-of-Combat attack

Owner: *"ryme proccing cinderwing is doing that ember whelp attack."* Same root cause as the earlier Tara fix — the `sc` combat event is overloaded. The UI replays EVERY `sc` as a Start-of-Combat cast: a zap, an `sccast` flash, and a **projectile bolt** from the source to the next beat's damage target. When Ryme re-fires Cinderwing Matron's battlecry in combat it grants spell power, whose `+A/+B Spell Power` telegraph is an `sc` event — so a bolt flew from the source to an unrelated attack's victim, reading like the long-gone Ember Whelp's scorch.

Fix: give the `sc` event a `cast?: true` discriminator. Only a **genuine Start-of-Combat *damage* cast** sets it (the `scDamage` / `scSplitDamage` / `scAoePerTribe` / `scDestroyHighestAttack` factories — all currently unused by any live card, but future-proofed). The UI now gates the bolt + zap + flash on `cast`; mid-combat narration `sc` events (spell power, etc.) keep driving the combat log, the live buffs-window spell-power tracker, and the trigger-medallion pulse, but no longer fling a phantom attack. Blaster's separate Deathrattle bolt path is untouched.

**Files:** `types.ts` (`cast?` on the `sc` event), `factories.ts` (`cast: true` on the 4 damage SoC emits), `useCombatReplay.ts` (gate bolt / sound / flash on `cast`), `simulate.test.ts` (+1). **Verification:** `typecheck + lint + test (378, +1) + build:web` green; the new test proves a mid-combat spell-power telegraph emits a narration `sc` with no `cast`. (The earlier Tara variant — the ascend narration — was already removed; this generalizes the fix to every spell-power telegraph.)
### chore: optimize 22 stale minion art PNGs → WebP

Twenty-two minion art files had been committed as raw PNG (~48 MB total) instead of the project's optimized WebP. Ran `npm run optimize-art` (the standard pipeline: downscale to ≤512px + WebP q85 + delete the source PNG; masters retained out-of-repo) over `packages/ui/src/art/minions/`, converting all 22 — **48.1 MB → 1.10 MB (97.7% smaller)**. Pure asset change, no code. **Verification:** `build:web` green; `art/minions/` now has 0 PNGs (128 WebP). (Surfaced while wiring Robin's hero art, which ran the same optimizer.)
### feat: Robin — a new hero whose Spoils pay out next turn

New hero **Robin** (30 Resolve). Passive power **Spoils**: *when you sell a minion, gain 1 Gold at the start of next turn.* It stacks within a turn but only carries to the next turn, then resets — sell 6 minions on turn 6 and you start turn 7 with **+6 Gold** (on top of the cap).

- **Mechanic** (`reducer.ts`): the sell case feeds the existing `bonusEmbersNextTurn` channel (Hoarder's "bonus Gold next turn"), gated to Robin's new `sellGold` power kind. The turn-start consume + reset (in `settleCombat`) and the on-top-of-the-cap behaviour already existed, so the whole feature is **one line** plus the hero data — no new state field. (Robin's power is also added to the passive no-op branch of the `heroPower` switch so an errant activation can't fall through to Fortify.)
- **Hero data** (`heroes.ts`): new `sellGold` `HeroPowerKind` + the Robin `HeroDef` (passive). `rollHeroChoices` already draws from all of `HEROES`, so Robin is offered automatically.
- **Art** (`packages/ui/src/art/heroes/robin.webp`, `.../powers/robin.webp`): optimized from the `Robin2.png` (portrait) / `RobinHP.png` (power) masters; the eager glob picks them up by the `robin` id match.

**Files:** `heroes.ts` (kind + HeroDef), `reducer.ts` (sell accumulation + passive no-op), `run.test.ts` (+1), 2 art webp. **Verification:** `typecheck + lint + test (378, +1) + build:web` green; the new test proves selling N minions banks +N for next turn (a non-Robin hero banks nothing). Live preview: Robin appears in hero-select with its portrait (robin.webp, 512², loaded) + the **Spoils** power text, console clean.

> **Flagged (separate cleanup):** running `optimize-art` revealed **22 minion art files committed as un-optimized PNG** (~44 MB) under `packages/ui/src/art/minions/`. Reverted them out of this PR to keep it Robin-only — they want their own "optimize stale PNGs" pass.

## 2026-06-25 (session 5)

### tweak: shield bubble −25% size + −30% interior opacity (owner dial-in)

After the shader landed and read well in-game, the owner dialed it in: `BUBBLE_MARGIN` 1.12 → 0.84 (the
sphere now sits just inside the card frame), and the interior terms (`bodyA` + `hex`) ×0.7 so the body/
force-field read softer while the fresnel rim + specular stay crisp. Verified via framebuffer readback: rim
radius 112→84 px (exactly 0.75×), interior centre alpha 49→34 (~−30%).

### feat: divine-shield bubble rebuilt as a custom WebGL energy-sphere SHADER

The bubble was stacked tinted sprites (soft disc + rim + vein streaks) — flat and low-quality. Rebuilt it as
a **custom fragment shader** (`SHIELD_FRAG` in `pixiFx.ts`, run via `Filter.from` with Pixi's
`defaultFilterVert`) that draws a glassy energy sphere procedurally: a faked-3D sphere normal → moving
specular glint, a fresnel rim (curved-glass edge), a scrolling aspect-corrected **hex force-field** lattice,
drifting value-noise caustics, and a whole-bubble breathe — all on `uTime`. Output is premultiplied gold
(`uColor`, so the same shader will serve the blue Reborn shield). Used the `pixijs` skills
(custom-rendering / scene-mesh / scene-container) + read the installed Pixi source to get the exact filter
vertex + uniform-resource wiring right (a `Filter.from({gl:{fragment}})` with no vertex throws in
`ensurePrecision` — the default vertex must be passed explicitly).

- **`ShieldBubble`** now holds one white quad `Sprite` + its per-bubble `Filter` (was fill/rim/veins). The
  container still drives position + the breathe / form-in / fade / mini / pop **scale envelope**; the shader
  owns all the internal detail + opacity. `uAspect` (card w/h) keeps the hex cells regular on tall cards;
  `uSeed` de-syncs neighbours.
- **Layering:** kept the single FX canvas (z110) — it's already bulletproof (nothing with a bubble exceeds
  it: dragcard z100, hand-hover z45, and shielded cards skip the dust-raise), so a second canvas was
  unnecessary. Break/pop **particles** still render on this canvas via the pooled system.
- **Verified**: typecheck + lint + 374 tests + build green; in-app the shader **compiles + links + renders
  with zero GL errors**, animates (`uTime`), and the mini/pop/break/clear lifecycle all run clean. The actual
  on-screen look needs an in-game eyeball (preview rAF is frozen) — this is a first shader pass to tune.
- **Tunables**: the GLSL constants in `SHIELD_FRAG` (hex scale 4.5, rim `smoothstep(0.5,1.0)`, specular pow
  26, caustic/pulse rates) + `SHIELD_GOLD_RGB`.

### feat: shield bubble — drag sparkle-trail + coalesce/pop-in on placement

Owner-chosen juice for the held→placed flow (instead of a silent instant re-show): while a shielded card
is **actively dragged** the bubble shrinks to a small trailing **sparkle**; on **placement** it coalesces
and **pops** back to full — the inverse of the break burst. (Loaded the `pixijs` skill for this; the
patterns — `Container.scale.set`, sprite `alpha`/`tint`/`blendMode`, ticker-driven animation — are all v8.)

- **`pixiFx.ts`**: `ShieldBubble` gains `mini` / `pop` / `scaleMul`. `setShield(...,mini)` — `mini=true` eases
  the bubble down to `MINI_SCALE` (0.3) and fades the veins out so it reads as a glint; a `mini→full`
  `setShield` fires `shieldPop()` (central flash + a ring of sparkles rushing **inward** to coalesce) and an
  ease-out-back size pop (peaks ~+14%, settles to 1) over `POP_MS`. Non-drag size changes ease smoothly via a
  per-frame lerp.
- **`Recruit.tsx`**: the drag-follow branch now sets the bubble `mini`; on drop the board card's normal
  `setShield` (non-mini) triggers the pop. A `SHIELD_CLEAR_GRACE` (280 ms) holds a vanished bubble across the
  hand→board **play remount** (the card unmounts from hand then remounts on the board under the same uid) so
  it resumes/pops in place instead of fading + regrowing; genuine leaves (sold/dead) still fade after the
  grace. Post-drop settle window bumped 320→450 ms to cover the grace + Flip.
- **Verified**: typecheck + lint + 374 tests + build green; live ticker-stepping confirms the shrink
  (scaleMul→0.3), the pop trigger (+sparkles), the ~+14% overshoot, and a clean settle to 1.0. The actual
  on-screen feel still needs an in-game look (preview rAF is frozen).

### fix: shield break reads after the hit + bubble always rides in front of held/hovered cards

Two polish fixes on the divine-shield bubble:

- **Break timing — hit → settle → shatter.** The break fired the instant the result beat dropped the unit's
  `.dscard` (right at the lunge's connection), so it read simultaneously with the impact. Now a consumed
  shield in combat is *scheduled* (`SHIELD_BREAK_DELAY` 300 ms, scaled by combat speed) instead of bursting
  immediately; the bubble is held and keeps tracking the (now shield-less) unit until the timer fires, so the
  read order is attacker connects → recoil/impact → THEN the shield shatters + sound. Recruit-side shield
  removal still clears instantly (no delay/burst). Implemented in `Recruit.tsx`'s `syncShields` via a
  `pendingBreakRef` map + a `measureCardRect` helper; a combat-exit flushes any pending break.
- **Always-on-top bubble.** The FX canvas (`.pixifx`) sat at z-index 41, *below* the dragged card (z100) and
  hand-hover cards (z45) — so the bubble fell behind the art while dragging / hovering. Raised `.pixifx` to
  **z110** (above the dragcard, below the modal overlays). The card-landing dust still tucks behind its own
  card — its temporary card-raise bumped 42→111 to stay above the new canvas.
- **Verified**: typecheck + lint + 374 tests + build green; live DOM confirms `.pixifx` is z110 and the app
  loads clean. The break timing + the in-front layering still want an in-game look (preview rAF is frozen).
- **Known/deferred**: the bubble now also sits above the Discover overlay (z50) — a stray bubble could show
  over a Discover dim for a shielded board card behind it. Not yet addressed (rare); flagged for follow-up.

### fix+feat: shield bubble shows in COMBAT + break sound + bigger look + smooth drag

Follow-ups on the divine-shield bubble after a first in-game look:

- **Bug — no bubble in combat (the big one):** combat units render `data-uid` on the `.unit` wrapper, not
  the inner `.card`, so the old selector `.unit .card.dscard[data-uid]` matched nothing in combat — the
  bubble never registered there, so it never appeared *or* broke. `syncShields` now resolves the uid via
  `card.closest('[data-uid]')` (the `.card` in recruit, the `.unit` in combat) and the break/clear check
  uses `[data-uid="…"]` (any element). Verified live: a combat-shaped DOM (`.unit[data-uid] > .card.dscard`)
  now registers a correctly-sized bubble.
- **Break sound:** new `sfx.shieldBreak()` (sourced `divineshieldbreak.mp3`, synth crash fallback, deduped
  60 ms so a multi-break beat plays once), fired alongside `pixiFx.breakShield` when a shield is consumed in
  combat. Registered in the mixer (`divineshieldbreak: 0.6`) + dev preview.
- **More noticeable:** body alpha 0.34→0.5, rim 0.55→0.95, veins 3→4 and brighter, margin 1.06→1.12,
  stronger breathe; the break got a second shockwave ring, 14→22 shards (faster), 6→10 motes.
- **Smooth drag:** dragging a shielded card now drives the bubble from the floating `.dragcard`'s transform
  (drag state) so it follows the cursor and is already in place on drop — no disappear / flicker / regrow.
  A ~320 ms post-drop "settle" window keeps the rAF sync running so the bubble tracks the card's Flip to its
  landed slot.
- **Verified:** typecheck + lint + 374 tests + build green; live DOM confirms recruit + combat both register
  and clear. Animated look + the real combat break/sound still need an in-game look (preview rAF is frozen).
- **Next (deferred):** a parallel BLUE bubble for Reborn, reusing this machinery.

### feat: Pixi divine-shield BUBBLE (replaces the gold glow/badge) + crack-and-shatter break

Divine Shield's signifier is now a translucent, slowly-breathing **golden bubble** drawn on the WebGL FX
overlay in front of each shielded unit — and when a shield is consumed it **cracks and explodes** into
energy + golden shrapnel. This replaces the old CSS gold glow + halo + art-border + ward badge entirely,
everywhere a shield exists (shop / hand / warband / combat). Owner decisions: everywhere, bubble is the
sole signifier, full-Pixi bubble + Pixi break.

- **`pixiFx.ts`** — a new STATEFUL sub-layer (the FX layer was previously fire-and-forget only). A
  `ShieldBubble` registry keyed by uid; each bubble is a `Container` of a translucent golden body
  (`BUBBLE_BODY_ALPHA`, normal blend so the unit reads through), an additive rim, and 3 drifting energy
  veins, breathing on the ticker (`BREATHE_MS`) with a `FORM_MS` grow-in. New API: `setShield(uid,cx,cy,w,h)`
  (create/retarget), `clearShield(uid)` (graceful `FADE_MS` fade), `breakShield(uid)` (crack flash +
  fracture lines → shockwave ring + golden shrapnel shards + energy motes, reusing the pooled particle
  system). Three generated textures (body/rim/vein). Look is tunable via the top-of-file consts +
  `window.__shieldDemo()` (DEV).
- **`Recruit.tsx`** — one DOM-driven tracker (`syncShields`) for BOTH recruit + combat, keyed off the
  `.card.dscard` marker. A card that loses `.dscard` while its element persists **in combat** → `breakShield`
  (absorbed a hit); otherwise → `clearShield` (sold / died / left). Positions re-measure on a rAF loop ONLY
  while something animates (combat / an active drag) + on resize; idle shielded units cost nothing.
- **Removed** (bubble is the sole cue): the `.card.compact.dscard` glow/halo/art-border + the `kwward.ds`
  badge (Card.tsx) + the combat `.unit.shieldgain` pulse and `.shatter` shard ring. The `.dscard` class is
  kept purely as the bubble's DOM hook.
- **Verified**: typecheck + lint + 374 tests + build all green; live DOM checks confirm the overlay inits,
  a `.dscard` card registers a correctly-sized/positioned bubble (5 children), and a recruit-side shield
  removal fades quietly (no spurious break). The animated look + the combat break can only be eyeballed in a
  real window (the preview pane runs hidden, freezing Pixi's rAF ticker).
- **Follow-ups**: dial in the look/feel in-game (consts are live); the rAF position-sync currently runs for
  all of combat — could be narrowed to active-lunge windows if a busy Mech board ever hitches.

### feat: mid-combat ascension (engine) — Tara → Taragosa transforms during the fight

Foundation for the ascension system (owner: "units need to ascend mid-combat… it will need an sfx trigger & an animation trigger"). Until now Tara → Taragosa (and Spirit Pup → Spirit Worgen) only transformed at SETTLE, between fights. The engine now transforms a qualifying minion **in place mid-combat**:

- **New `ascend` combat event** (`{ type: 'ascend'; target; into }`) in the shared `CombatEvent` vocabulary — emitted when a minion transforms, for the UI to animate (the presentation wiring is the next PR).
- **The transform** (`simulate.ts`): a queued, between-actions `ascendMinion` swaps the minion's identity (cardId / name / tribe) + effects to its ascend form and adds the new form's keywords, **keeping its current stats / buffs**. The new form's abilities go live immediately (an ascended Taragosa casts Growth the rest of the fight). The `CombatBus` can't unregister, so `registerEffects` handlers now **self-disable** when their effect is no longer in the minion's current set — the old form's abilities cleanly stop firing.
- **Tara's trigger**: her stat-grant tally in `ctx.buff` now also checks the threshold (seeded progress + this fight's grants ≥ `ascendAt`) and queues the ascension, flushed at the next clean beat (after each attack / after Start-of-Combat). The settle-time transform of the run-board card is unchanged, so the board card and the combat instance stay consistent.

**Files:** `types.ts` (`ascend` event), `simulate.ts` (ascend infra + Tara trigger + `registerEffects` self-disable + flush points), `combat-harness.ts` (narration), `simulate.test.ts` (+1). **Verification:** `typecheck + lint + test (375, +1) + build:web` green; a repro confirmed Tara ascends to Taragosa mid-fight at 20 grants and Taragosa's Growth (+3/+4) fires afterward. (Pre-existing, unrelated: `typecheck:web` flags 4 magnetize type errors in `Recruit.tsx` on clean main — noted for a separate pass.)

**Next:** (a) the UI presentation — the `ascend` SFX + a level-up animation + the live board-state swap; (b) Spirit Pup → Spirit Worgen — counting in-combat spells toward its threshold (carried back) + its mid-combat transform, reusing this infra.

### fix: in-combat spell casts feed spell power LIVE + proc Forsaken Weaver permanently

Two fixes to how mid-combat spell casts (Taragosa's Growth) feed the spell-driven effects:

1. **Live spell power (Gnasher → Taragosa's Growth).** Taragosa's Growth scales with `ctx.spellPower`, which was frozen at combat start — so Gnasher's on-kill +1/+1 spell power (and Bladesmith deaths) landed in a *separate* carry-back delta and didn't reach Growth until the next fight. Fix: `ctx.spellPower` is now a mutable local that `grantSpellPower` bumps **in place** (alongside the carry-back `spellPowerGain`), so Growth — and any spell scaled mid-fight — reads the gain in real time. Verified: with Gnasher killing a chump, Taragosa's Growth jumps **3/4 → 4/5** the same fight.

2. **Forsaken Weaver procs permanently in combat.** Its `spellCast` handler already fired mid-combat (Taragosa's Growth calls `ctx.castSpell`, which emits `spellCast`), but the combat factory `spellCastBuffUndeadAttack` only granted a *temporary* combat buff. Fix: it now also `ctx.grantUndeadBuyAtk(amount)` — exactly like Karthus and its own recruit half — so the +2 Undead Attack carries back, stacks into `undeadBuyAtk`, and applies to the run-board Undead at settle. Verified: `playerUndeadBuyAtkGain` is now `> 0` from an all-in-combat Growth chain (was nothing).

**Files:** `packages/core/src/combat/simulate.ts` (live `spellPower`), `packages/core/src/effects/factories.ts` (Forsaken Weaver carry-back), `simulate.test.ts` (+2). **Verification:** `typecheck + lint + test (376, +2) + build:web` green. *(Part of a batch — next up: Spirit Pup counting in-combat spells + mid-combat ascension for Tara/Spirit Pup.)*

### fix: Reborn fires the unit's Deathrattle on every death + carries Undead buffs through rebirth

Owner clarified how Reborn should work; two bugs in `killOrReborn` (`simulate.ts`):

1. **Deathrattle / on-death effects fire on EVERY death of a Reborn unit** (was: only the final death). The reborn branch `return`ed before the `onDeath` emit, so a Reborn unit's Deathrattle never fired on the first (reborn) death. Now the branch first fires the unit's OWN on-death effects via a new `fireOwnDeathrattles` — the unit's own factories + Sylus the Reaper re-procs, but NOT a global `onDeath` broadcast / Avenge / death event, so a Reborn doesn't double-trigger *other* minions' death-watchers — then the body returns. Example: a Twilight Whelp buffed to 2/2 + Reborn (e.g. via Symbiote) now leaves a 3/3 Whelp on the reborn death AND the final death — **two Whelps, not one**.

2. **Reborn returns at BASE stats + the Undead carry-through buffs** (was: base, dropping the Eternal-Knight enchant). Still resets to base card stats (sheds combat buffs + granted keywords like Divine Shield), but now re-applies the Undead carry-through on top: the Lantern/buy-time "everywhere" bonus (already did) AND the run-wide Eternal-Knight enchant (new `applyCardTypeCarryThrough`, gated to Undead cards). So a 3/2 Eternal Knight with Reborn that dies banks its own +3/+2 and returns **6/4**; with a Lantern it's 3+3+3 = **9** Attack. General stat / Imp / Fodder buffs still do NOT carry. Reborn HP stays **base** health (3/2 → 6/4 — matching the owner's example, not Hearthstone's 1).

**Files:** `simulate.ts` (`fireOwnDeathrattles` + `applyCardTypeCarryThrough` + the reborn branch), `simulate.test.ts` (+2 new — Whelp-per-death, fresh-Knight 6/4 — and updated the base-stats / golden / Lantern reborn tests to the carry-through). **Verification:** `typecheck + lint + test (374, +2) + build:web` green; a repro confirmed Whelp 2/2 R → **2** Whelps and Knit 3/2 R → reborn **6/4** (were 1 Whelp / bare 3/2).

**Follow-up flagged:** the Eternal-Knight enchant accrued in PRIOR fights (already baked into the run-board stats, not passed into `simulate`) doesn't carry through Reborn yet — only the amount banked in the current fight does. Plumbing the run's `cardBuffs` into combat would close that.
### perf + ux: magnetize glow no longer repaints every frame; hand cards sit 20% farther apart

Two recruit-screen fixes from owner reports (both in `styles.css`).

**Magnetize "bog down" (perf).** Magnetizing felt choppy. Cause: the electric `crackle` — the glow on a Magnetic card hovering a Mech (`.dragcard.electric`) and on the host as it's welded (`.card.electrify`, drop + Combinator's End of Turn) — animated `box-shadow` (blur + spread keyframes) on a `0.26–0.28s infinite` loop. `box-shadow` is a **paint** property, so the card repainted EVERY frame for the whole hover/weld (the #1 anti-pattern in [performance.md](performance.md)); a Combinator weld repaints several Mechs at once. Converted to the established `kwglow` pattern: a STATIC cyan halo on a `::before` whose **opacity** breathes (compositor-only, zero per-frame paint), same look. The engine path was checked too (`fireSummonBuffs` → `makeContext`/`weldMagnetic`) and is cheap — this was purely render-side.

**Hand spacing (ux).** Owner: cards in hand overlap too much to click the right one. The fan's inter-card STEP was `--cw − 84px`; now `margin-left: calc(1.2 * (var(--cw) − 84px) − var(--cw))` widens that step by exactly **20%** while staying a negative overlap across the whole responsive `--cw` clamp range (so the fan still tucks behind itself). Verified live: at `--cw` 275px the step went 191→229px (+20%), margin −45.9px (still overlapping).

**Files:** `packages/ui/src/styles.css` (`crackle` → opacity-on-`::before`; hand `margin-left` calc). **Verification:** `typecheck + lint + test (372) + build:web` green; live preview — computed inter-card step is +20% and still overlapping, console clean, and the glow now rides an opacity `::before` (no per-frame box-shadow repaint).
### tweak: more spread in the hand (overlap 20% of card width, not a fixed −84px)

Hand cards overlapped too much, especially with a full hand. The overlap was a fixed `margin-left: -84px`
— but the card width (`--ccw`) is responsive (~140–245px), so that fixed px read as ~35% overlap on big
screens and ~60% on small ones. Now the overlap is **20% of the card width** (`calc(var(--ccw) * -0.2)`),
so it's a consistent slight overlap at every size. Tradeoff (owner-accepted): a near-full 10-card hand
widens toward the screen edges rather than compressing — a dynamic fit-to-zone overlap was the alternative.

**Files:** `styles.css` (`.row.hand .card` margin). **Verification:** `lint + build:web` green; computed
overlap confirmed live at exactly 20% (card 141px → margin −28px), first card flush.

### fix: buffing Tara no longer fires a phantom "Ember Whelp" Start-of-Combat attack

Owner report: when Supporter buffs Tara mid-combat it *randomly* procs what looks like the old Ember Whelp Start-of-Combat attack. Root cause: Tara's ascend tally (in `simulate`'s `ctx.buff`) pushed a narration `sc` event on **every** stat-grant (`"Tara: N stat grants to ascend"`). The UI treats *every* `sc` as a Start-of-Combat cast — `sfx.cast` zap, a `sccast` flash on the source, and (the visual "attack") a **projectile bolt** from the source to the next beat's damage target (`useCombatReplay.ts`). So each time Supporter rallied Tara — it pumps 2 *random* Dragons, hence "randomly" — a bolt flew from Tara to an enemy, reading exactly like Ember Whelp's old scorch. (Ember Whelp itself is long gone — replaced by Twilight Whelp; nothing uses `scDamage` anymore, so this was the *only* path to that visual.)

Fix (engine-only, `simulate.ts`): keep the `buffCounts` tally that drives the ascend carry-back (`playerAscendCount` → settle/transform), but **stop emitting the per-buff `sc` narration**. The live "N to ascend" card tracker counts `buff` events in the replay (`useCombatReplay` + `cardText`), *not* this event, so the countdown is unaffected; the buffs tab only parses spell-power `sc` text. Net: no phantom Start-of-Combat on a Tara buff, ascension behaviour itself unchanged.

**Files:** `packages/core/src/combat/simulate.ts` (drop the ascend `sc` event; keep the tally). **Verification:** `typecheck + lint + test (372) + build:web` green; a 30-seed repro of Supporter-rallying-Tara boards went from **21–29 spurious `sc` events to 0** (a board with a real Start-of-Combat effect still emits its `sc`).

### feat: loss-damage tally + blast (surviving tiers → Resolve)

On a defeat, the damage you take is now telegraphed: the surviving enemy minions' **tavern tiers** plus
the **opponent's tavern tier** fly up into a damage counter above the enemy board, count up (clamped to
the round cap), then a Pixi **blast bolt** hurls the number into the **Resolve bar**, which drops on
impact. Shows *how* the loss damage was computed (`opponentTier + Σ surviving tiers`, capped 5/10/15).

Presentation-only — no engine change. The formula already lives in `simulate()` (`playerDamage`) + the
run loop's `lossDamageCap`; the UI just reads + visualises it.

- **`pixiFx.ts`**: `blastBolt(from→to)` (a comet of additive glow motes streaking to the target, tail
  lagging into a trail) + `damageBurst(x, y)` (crimson hot-core + shockwave + red shards) + a
  `blastTravelMs` so the caller fires the burst on arrival.
- **`Recruit.tsx`**: a loss-damage sequence effect (runs once at `replay.done` on a loss). It **defers
  `settleCombat`** (so Resolve drops on the blast, not instantly), computes the counter spot above the
  surviving enemy cards, flies each survivor's tier (from its card) + the opponent's tier (from the
  `.oppframe`) into the counter on a stagger, counts up clamped to `lossDamageCap(wave)`, then
  `blastBolt` → Resolve bar; on arrival `damageBurst` + screen shake + `settleCombat` (Resolve drops →
  the StatusBar's existing `−X` hit flash fires). "End Combat" is held until the blast finishes. Effect
  reads `run` fresh (not via deps) so the mid-sequence `settleCombat` can't re-fire it + clear the timers.
- **`styles.css`**: `.lossdmg` counter (crimson glow, scale-in, launch hand-off), `.lossfly` tier numbers
  (`lossflyto` — fly to the counter; opponent tier reads gold).

**Files:** `pixiFx.ts` (`blastBolt`/`damageBurst`/`blastTravelMs`), `Recruit.tsx` (sequence + deferred
settle + Climb-On gate + reset), `styles.css` (`.lossdmg`/`.lossfly`).

**Verification:** `typecheck + lint + test (369) + build:web` all green. Live: `blastBolt` spawns 16
target-bound motes, `damageBurst` 24 additive particles, the `.lossfly`/`.lossdmg` CSS resolves. (The
full moving sequence needs a real combat loss + a visible tab — owner to eyeball.)

### feat: board synthesis — "print" strong high-wave boards from real-board data (+ real boards in the ladder)

Follow-up to the wave-relative banding. Its band report exposed that high waves (9–20) saturated to band 7 and were thin (w20: 3 boards) — the smart bot can't build strong high-wave boards (it has to survive a whole run and plays greedily), so the bot-only calibration ladder had no real ceiling and high waves were under-populated. We *have* the data on what strong boards look like (331 real captured boards up to wave 20), so two changes use it:

- **Real boards in the ladder** (`rating.ts`): `buildWaveLadders(seeds, fidelities, extra)` folds the imported real boards into the per-wave ladders, giving high waves a real ceiling. Unservable boards (stale cardIds like the renamed `whelp`) are skipped so they can't break ratings.
- **Synthesis** (`synthesize.ts`, new): `mutateBoard` recombines a real board (swap 0–2 minions for ones seen on other real boards at that wave) + nudges stats ×0.8–1.3 as a strength dial; `synthesizeForWave` generates N candidates, **validates each via `simulate`** (`rateBoardForWave`) to band ≥ floor, dedupes, and tags them `origin:'synthetic'`. So "competitive" is empirical (it actually wins), and it's coherent (anchored in real boards). `build-pool.ts` tops thin waves up toward `SYNTH_TARGET_PER_WAVE` (16).

**Result (re-bake):** the band histogram went from `b7:212` (a black hole) to an even `b0:5 b1:52 … b7:57`, and every wave now spans `b1–b7` with **16 boards** (was 3–9, all b7) — **392 boards, 61 synthetic**. The "high-wave ceiling" known-limitation from the prior entry is resolved.

**Files:** `rating.ts` (`extra` ladder boards + servable guard), `synthesize.ts` (new) + `index.ts` (export), `build-pool.ts` (ladder with reals + synthesis fill + report), `synthesize.test.ts` (new, +2). **Verification:** `typecheck + lint + test (+2) + build:web` green; `npm run pool` re-baked 392 boards (61 synthetic) in 12s with an even band spread across all waves.
### feat: Symbiotic Attachment is Magnetic Reborn — grants Reborn to whatever it welds onto

Symbiote's hero-power token (`symbioticattachment`) now carries **Reborn** (`R`) on top of Magnetic — so magnetizing it onto a host grants that host Reborn. Its keywords ride along on the weld via `applyWeld` (which already transfers every non-`M` keyword), so no new plumbing. Played standalone it's a 1/1 Reborn body. A flat power bump to the Symbiote hero: every magnetize now also makes the target come back once.

**Files:** `tokens.ts` (Symbiotic Attachment → `keywords: ['M', 'R']` + text), `run.test.ts` (+1: welding grants the host `R`, not `M`). **Verification:** `typecheck + lint + test (370, +1) + build:web` green.

### tweak: snappier card hover-reveal debounce

Owner ask: the hover-reveal popup (full card / referenced cards) opens too slowly. Cut the debounce in
`Card.tsx` — compact cards **220 → 100 ms**, full-text cards **450 → 250 ms** (the `showText ? 250 : 100`
ternary on the `showRefTip` timeout). Pure timing dial; right-click inspect stays instant.

### feat: wave-relative board power banding + patch stamping + prune/populate pool lifecycle

The game's mechanics shifted a lot this week, so captured/house boards (esp. high-wave) re-simulate weaker than their stored strength implied — and the old banding couldn't see it. `rateBoard` fought every board against ONE fixed gauntlet (top rung 7/9/16) and **saturated** to `1.0` by ~wave 8, so it couldn't tell a weak high-wave board from a strong one. Redefined power banding as **wave-relative** (curation/QA only — live matchmaking still uses `Σ(atk+hp)`, owner's call), and built the maintenance lifecycle around it.

- **Wave-relative rating** (`rating.ts`): `buildWaveLadders()` runs the smart bot (`buildBootstrapPool` at fixed seeds × rising fidelity 0.2→1.0) to make per-wave reference ladders spanning weak→strong CURRENT play; `rateBoardForWave(board, wave, ladders)` scores a board by the fraction of its OWN wave's ladder it beats. No saturation (the ladder scales with the wave); deterministic; self-recalibrates per patch. Replaced the absolute `rateBoard` (+ its GAUNTLET).
- **Patch stamping**: new `BoardSnapshot.patch` = `<pkg version>+<short git sha>`, stamped at capture (`boardLibrary.ts`, via the Vite `__APP_VERSION__`/`__BUILD_SHA__` defines) and at house bake (`build-pool.ts`, via `git rev-parse`). Convention: bump `package.json` version per balance patch.
- **Prune by date/patch**: new `npm run pool:prune` (`prune-pool.ts`, `--before/--after/--patch/--no-patch/--dry-run`) filters `docs/board-exports/*.json`; `boardLibrary.pruneStoredBoards`/`clearStoredBoards` + an Esc → Shared Boards → **Clear my boards** control for localStorage captures.
- **Populate** (`build-pool.ts`): re-bake now rates every board wave-relative, drops boards below a competitive floor (band `FLOOR_BAND`=1 at waves ≥ `FLOOR_FROM_WAVE`=4 — no free wins mid/late, early waves keep the full range), and prints a per-wave **band-coverage** report. Knobs documented.
- **Docs**: new `docs/board-pool.md` (the banding definition + the capture→stamp→rate→prune→regenerate lifecycle + tooling).

**Files:** `rating.ts` (rewrite), `snapshot.ts` (`patch` field), `boardLibrary.ts` (stamp + prune/clear), `EscMenu.tsx` (Clear-my-boards), `build-pool.ts` (wave-relative bake + floor + report + patch), `prune-pool.ts` (new), `package.json` (`pool:prune`), `run.test.ts` (rewrote the rating tests), `docs/board-pool.md` (new).

**Verification:** `typecheck + lint + test (369) + build:web` green; `npm run pool` re-baked **339 boards in 12s** (dropped 91 below band 1). New tests prove `rateBoardForWave` is wave-relative (a fixed board rates no higher at a later wave — no saturation), monotonic at a fixed wave, and deterministic. **Finding surfaced by the band report:** high waves (9–20) compress to band 7 (`w12:b7–b7`) — the bot ladder's ceiling sits below expert play and lacks a weak end past ~wave 9, so it can't discriminate strong high-wave boards. Documented as a known limitation (manage high-wave staleness via prune+re-bake for now); a higher-ceiling ladder is the follow-up.

### fix: card-driven Discovers weigh every eligible tier EVENLY (no high-tier bias) — only the golden reward peeks up

Owner report: Discovers favored higher-tier minions. Root cause: `offerDiscover`'s tiered branch built its pool with a **floor-walk** — it started at the target tier (`floor = target`) and included ONLY that tier, dropping to lower tiers just enough to reach 3 candidates. So at tavern tier 5 a Sea Urchin offered three tier-5 beasts whenever ≥3 existed, never mixing in lower tiers. The shop was flattened (equal chance per tier) long ago; Discover wasn't.

Now every card-driven Discover weighs every eligible card **at or below** the target tier **evenly** (pool = `tier <= target`, uniform pick) — matching the flattened shop + the spell Discover (`offerSpellDiscover`, already uniform). This covers **Sea Urchin** (`battlecryDiscoverMinion`, up to your tavern tier) and **Help Wanted** (Battlecry-filtered, up to your tavern tier). Sprout (fixed Tier 1) and spell Discover were already uniform.

The golden/triple reward ("peek one tier up", the `discoverspell` token) is the ONE intentional exception and is **unchanged**: a new `topTierFirst` flag on the minion `DiscoverSpec` preserves the floor-walk only for it, so a triple still shows you the next tier up.

**Files:** `recruit.ts` (`offerDiscover` → uniform default + `topTierFirst` floor-walk path; `openDiscover` threads the flag), `state.ts` (`DiscoverSpec.topTierFirst`), `reducer.ts` (`discoverspell` sets `topTierFirst: true`), `run.test.ts` (+1: uniform Sea Urchin offers a Tier-1 beast; the golden reward stays top-tier-only).

**Verification:** `typecheck + lint + test (369, +1) + harness (determinism) + build:web` green. Confirmed **live in-preview**: a tier-2 Sea Urchin offered all four pool beasts across seeds (incl. the Tier-1 `alley`), not just the top tier.
### feat: card-touch sound + dust puff +20%

Follow-ups to the board-click feedback:
- **`sfx.cardTouch()`** (new) — sourced `cardtouch` clip (`packages/ui/src/audio/cardtouch.mp3`, from Cubase),
  soft sine-tick synth fallback; registered in `SAMPLE_VOL_DEFAULTS` (`cardtouch: 0.5`) + dev preview.
- **Wired at the root** (`Recruit.tsx`): the former `puffBoard` is now `onBoardPointerDown` — pressing any
  `[data-zone] .card` (shop / hand / board) fires `cardTouch` and returns. It lives on the root pointerdown
  (not the card's own drag handler) deliberately, so it plays **at any time** — including when the timer's
  up, the hero power is armed, or end-of-turn is animating, all of which detach `onCardPointerDown`. The
  empty-table click still falls through to `clickThock` + `pixiFx.clickPuff`.
- **Dust +20%**: `clickPuff` got a `SIZE = 1.2` multiplier on `fromScale`/`toScale` (owner request).
- **Verified**: `npm run typecheck && npm run lint` green; live page renders clean, both sounds fire
  without error; clip bundles via the `./audio/*.mp3` glob.

### feat: board-click "thock" + small Pixi dust puff

Owner ask: clicking the (empty) board should play a tactile click sound **and** kick up a tiny dust puff
at the cursor — like the card-landing dust, but much smaller.

- **`sfx.ts`**: new `sfx.clickThock()` — sourced `clickthock` clip (`packages/ui/src/audio/clickthock.mp3`,
  from Cubase) with a soft square-tick synth fallback; registered in `SAMPLE_VOL_DEFAULTS`
  (`clickthock: 0.5`) + the dev SFX-mixer preview.
- **`pixiFx.ts`**: new `clickPuff(x, y)` — a much smaller sibling of `dust()`: 7 dry-dirt tan puffs burst
  from the click point, hug the ground (damped vertical + gentle gravity), and fade fast (~0.26–0.44 s,
  fromScale ~0.14, low alpha). Drawn on the existing WebGL FX overlay.
- **`Recruit.tsx`**: the existing `puffBoard` handler (primary click that misses every `.card`/`button`/
  control) now fires `sfx.clickThock()` + `pixiFx.clickPuff(clientX, clientY)`. This **replaces** the old
  DOM `.boarddust` puff (removed: the `dust` state/ref, the `.boarddust` JSX, and its CSS — the Pixi puff
  matches the card-landing look the owner referenced).
- **Scope:** fires on the empty table only, not on cards or controls (those keep their own sounds —
  buy/sell/roll/etc.), matching the prior `puffBoard` semantics. Easy to broaden to all clicks if wanted.
- **Verified**: `npm run typecheck && npm run lint` green; clip bundles via the `./audio/*.mp3` glob.

### feat: battlecry-summoned tokens pop in ~0.2s after the trigger pulse

Owner ask: when a battlecry summons (e.g. Alleycat → Stray), see the medallion **pulse** fire, then the
token appears just after — not simultaneously.

The engine resolves effects synchronously (the Stray is in board state the instant you play Alleycat), so
this is a **visual** beat, not an engine change: the summoned token's mount-pop is held ~0.2s.

- **`Recruit.tsx`**: a `playWithSummonDelay()` wrapper around the warband `play` dispatch diffs the board
  before/after (synchronously, via `useGame.getState()`) to find tokens — new board minions other than the
  played card — and flags them in `summonDelayUids`. Because it runs in the **same React batch** as the
  dispatch, the flag is set before the token's card first mounts (a post-render detector would be too late —
  the pop would already have played). Cleared after ~600 ms.
- **`Card.tsx`**: new `popDelay` prop → `.popdelay` class.
- **`styles.css`**: `.card.popin.popdelay { animation-delay: 0.2s; animation-fill-mode: backwards }` — the
  token holds its invisible `from` frame during the delay, then runs the normal `cardpop`. So the pulse
  reads at ~T0 and the token pops at T≈0.2s.

Scoped to the warband minion-play path (where battlecries summon). Combat summons are already beat-sequenced.

**Files:** `Recruit.tsx` (`playWithSummonDelay`, `summonDelayUids`, `popDelay` on the board Card),
`Card.tsx` (`popDelay` prop), `styles.css` (`.card.popin.popdelay`).

**Verification:** `typecheck + lint + test (368) + build:web` all green. CSS confirmed live —
`.card.popin.popdelay` resolves `cardpop` with `animation-delay: 0.2s`, `fill-mode: backwards`. (The
moving sequence can't run in the headless preview — owner to eyeball Alleycat → Stray.)

### feat: trigger-medallion **glow** sound (distinct from the pulse)

The trigger medallion already played `triggerPulse` when an effect *officially fires* (pulse animation).
Now the **glow-only** case — a cadence card that ticks toward firing but doesn't release this turn (e.g.
Frontdrake's per-turn countdown before it supplies a Dragon) — gets its own softer cue, `triggerGlow`.

- **`sfx.ts`**: new `sfx.triggerGlow()` mirroring `triggerPulse` — sourced `triggerglow` clip
  (`packages/ui/src/audio/triggerglow.mp3`, dropped in from Cubase) with a soft triangle-tick synth
  fallback, registered in `SAMPLE_VOL_DEFAULTS` (`triggerglow: 0.5`) + the dev SFX-mixer preview. **Deduped
  like the pulse**: a 70 ms throttle (`lastTriggerGlow`) collapses simultaneous glows on the same EOT step
  into one play, so stacked cadence cards never blast.
- **`Recruit.tsx`** (EOT telegraph): the per-beat medallion cue branches — `b.completes` → `triggerPulse`;
  otherwise → `triggerGlow` (the only glow-only site; combat units only ever `pulse`). **`triggerGlow` also
  doubles as the End-of-Turn proc cue** — it now fires on *every* EOT beat, replacing the old `sfx.proc()`
  shimmer. On a glow-only beat the medallion branch and the EOT-cue line both call `triggerGlow` for the
  same card on the same tick; the dedup collapses them to one play (a completing beat is thus pulse + glow).
- **Docs**: `sfx-events.md` gains rows + a trigger-site note for both `triggerPulse` and `triggerGlow`
  (neither was previously listed).
- **Verified**: `npm run typecheck && npm run lint && npm run build:web` all green; the new mp3 bundles via
  the existing `./audio/*.mp3` glob.

### feat: Discover golden-magic burst (behind the cards)

Opening a Discover now erupts a burst of golden, white-hot magic + sparkles from screen center that shoots
outward off every edge (~2.5 s, capped under 3 s). It renders **behind the Discover cards/UI but above the
overlay's dark backdrop**, so it reads white-hot over the dim without obscuring the choice.

- **Second FX layer** (`pixiFx.ts`): a separate `discoverFx = new FxController()` instance, mounted on a
  `.disc-burst` div *inside* the Discover overlay (z0, behind `.disc-panel` at z1, above the overlay's
  `rgba(...,0.62)` backdrop). A root-level canvas can't sit between an overlay's own background and its
  children, so the burst needs to live inside the overlay — hence a dedicated instance. `attach()` now
  returns its init promise so the burst fires once the (async) app is ready; the canvas is re-appended on
  each subsequent Discover (no WebGL-context churn).
- **`discoverBurst(cx, cy)`**: a central white-gold bloom + 16 large soft glow motes drifting outward + 50
  fast radial sparkles (shards/dots, 650–1550 px/s so they reach the page edges), all **additive** so they
  glow white-hot over the dark dim. Max particle life ~2.5 s.
- **Trigger** (`Recruit.tsx`): an effect on `run.discover` attaches `discoverFx` to the `.disc-burst` ref
  and fires the burst when Discover opens.

**Files:** `pixiFx.ts` (`discoverBurst`, `discoverFx`, `attach` returns a promise, DEV `__discoverFx`),
`Recruit.tsx` (`.disc-burst` div + ref + trigger effect), `styles.css` (`.disc-burst` z0 / `.disc-panel` z1).

**Verification:** `typecheck + lint + test (354) + build:web` all green. Live: `discoverFx` initialises as
an independent app and `discoverBurst` spawns 67 additive particles (50 fast sparkles), confirmed via the
`__discoverFx` handle. (Animation can't run in the headless preview — owner to eyeball the live burst.)

### feat: trigger-medallion pulse when a unit's effect fires in combat

Each unit's mechanic medallion (`.cgem` — the centre badge showing its Battlecry/Deathrattle/keyword
glyph) now releases a slow ring of energy when that unit's effect actually fires during the combat
replay, so you can read *which* unit just did something.

- **Combat detection** (`useCombatReplay.ts`): a per-beat pass tags the acting unit's uid as "triggered"
  from the beat's events — `sc` / `buff` / `rally` (source), `summon` / `toHand` (source), `improve` /
  `maxGold` / `hpGrant` / `reborn` (target = effect owner), and **`death` where the dying card has an
  `onDeath`/`avenge` effect** (the clean Deathrattle signal — its summon/buff events don't reliably carry
  the dying unit as their source, which is why Deathrattles weren't pulsing in the first cut). Tags held a
  fixed ~950 ms (independent of combat speed, so the ring always completes) then cleared; a re-trigger
  restarts it. Exposed as `triggerUids: Set<string>`. (The `cardIds` uid→cardId memo was hoisted above
  the effects so the Deathrattle lookup can use it.)
- **Out of combat too**: the recruit warband pulses the medallion on Battlecry (on-play) and
  officially-firing End-of-Turn effects.
- **Progress glow vs official pulse** (owner ask, Frontdrake example): multi-turn *cadence* cards
  (`endOfTurn` effect with an `every: N` param, e.g. Frontdrake's every-3-turns Dragon) only **glow**
  on the turns they tick toward the trigger, and **pulse** (glow + ring) on the turn they actually pay
  off. `Recruit`'s end-of-turn beat builder computes `completes = ((eotTick+1) % every === 0)` (non-
  cadence EOT effects complete every turn); the warband `Card` gets `glow` (every proc) + `pulse` (only
  completions / Battlecries). New `glow` prop → `.cgem.glowing` (the brief glow flash, no ring).
- **Glow-then-pulse**: the medallion flares a very brief glow (`::before`, `cgemglow` 0.22s) and the ring
  (`::after`, `cgempulse`, delayed 0.15s) releases *after* it. Both **compositor-only** (only
  `transform`/`opacity` animate; the glow's radial bg + box-shadow are static — no per-frame repaint).
  Tribe-colour-tinted over a warm-white core. The trigger tag is held ~1.15s so the full sequence runs.
- **Sound** (`sfx.ts`): a new sourced **`triggerpulse`** clip (synth swell fallback) plays whenever the
  *pulse* fires (not the progress glow). **Deduped** — a ~70 ms throttle collapses simultaneous pulses
  (many units triggering on one combat beat / EOT step) into a single play so the audio never stacks; in
  combat it's also fired once per beat. Added to the dev SFX mixer.
- **Plumbing**: combat — `Recruit` → `Unit` → `Card`'s `pulse`/`glow` props; recruit — the board `Card`
  sets them directly off the proc sets.

**Files:** `useCombatReplay.ts` (trigger set + per-beat pass + `sfx.triggerPulse` + reset + export),
`Unit.tsx` (`triggered` prop + memo), `Card.tsx` (`pulse`/`glow` props → `.cgem` class), `Recruit.tsx`
(combat Units + recruit board: cadence `completes`, glow/pulse sets, Battlecry pulse + sound),
`styles.css` (`.cgem.glowing`/`.pulsing` ::before glow + ::after ring), `sfx.ts` (`triggerPulse` + dedupe
+ mixer key), `audio/triggerpulse.mp3` (new).

**Verification:** `typecheck + lint + test (354) + build:web` all green. CSS distinction confirmed live —
`.glowing` resolves `::before cgemglow` with **no** `::after` ring; `.pulsing` resolves both the glow and
the `::after cgempulse` ring. (CSS animations + GSAP combat can't run in the headless preview, so the
moving effect + sound are owner-verified in a real fight/shop.)
(Full combat playback is GSAP-driven and can't run in the headless preview; owner to eyeball in a real
fight.)

### fix: Ryme re-fires EVERY Battlecry (economy ones replay at settle) + magnetizing now triggers summon-buffs

Two owner-reported interaction gaps, both "the feature didn't extend to this case":

**1. Ryme + economy Battlecries (Soulfeeder, Hoarder, …).** Ryme's combat re-fire (`replayCombatBattlecry`) only handled the *combat-meaningful* Battlecries (summon / tribe-buff / undead-attack / grant-keyword / discover / spell-power); economy ones (Soulfeeder's `addTavernFodder`, Hoarder's `battlecryBonusGoldNextTurn`, Demonic Anomaly's shop buff, a gain-a-minion) silently no-op'd — so Ryme produced **0 Fodder**. Now the owner wants Ryme to re-fire *every* Battlecry. Rather than reimplement each economy effect in pure combat (and invent carry-backs for Gold-next-turn + the shop buff), the split is cleaner: **combat-meaningful Battlecries still resolve in the fight; economy ones are recorded and replayed through their REAL recruit factory at settle** (full RunState access). New `ctx.deferBattlecry(cardId, golden, side)` (player-only) → `CombatResult.playerDeferredBattlecries` → `settleCombat` calls `replayEconomyBattlecry(s, cardId, golden)`, which runs the card's non-combat onPlay effects via `RECRUIT_FACTORIES`. Recorded once per re-fire, so **Drakko's doubling and golden Ryme's both-neighbors carry through**; golden state rides along so the factory doubles correctly. The combat-meaningful set is exported (`COMBAT_REPLAYABLE_BATTLECRIES`) as the single source of truth the settle path reads to skip the in-combat ones. This auto-covers future economy Battlecries — no new carry-back per card.

**2. Magnetize skipped summon-buffs.** Playing a Magnetic minion onto a host welded its in-hand stats and **returned before `playCard`**, so `onSummon` never fired — Mama Bear (and every summon-buff) was skipped. Only a standalone play triggered them. The owner wants playing-a-Magnetic to count as a summon: new exported `fireSummonBuffs(state, minion)` runs the board's `onSummon` handlers on the magnetic minion **before** the weld, so a Symbiotic Attachment (universalTribe → counts as a Beast) picks up Mama Bear's +2/+2 and carries it into the host. Applies to all magnetic plays (consistent with "playing = summoning").

**Files:** `simulate.ts` (`deferredBattlecries` accumulator + `ctx.deferBattlecry` + result field), `types.ts` (`CombatResult.playerDeferredBattlecries` + `CombatContext.deferBattlecry`), `factories.ts` (export `COMBAT_REPLAYABLE_BATTLECRIES`; `replayCombatBattlecry` defers economy battlecries), `recruit.ts` (`replayEconomyBattlecry` + `fireSummonBuffs`), `reducer.ts` (settle replays deferred battlecries; magnetize path fires summon-buffs before welding), `simulate.test.ts` (+1: Ryme defers Soulfeeder/Hoarder, not Sea Urchin), `run.test.ts` (+2: settle replays deferred → 3 Fred + 1 Gold; magnetize → Attachment + Mama Bear → host 8/8).

**Verification:** `typecheck + lint + test (368, +3) + harness (determinism) + build:web` green. Confirmed **live in-preview**: Ryme dying next to Soulfeeder records `{feed,false}` and settle queues a Fred into the next tavern; a Symbiotic Attachment played onto a Gnasher (5/5) with a Mama Bear on board welds at **8/8** (Attachment 1/1 + Mama Bear +2/+2).

### feat: Buffs window ticks up LIVE in combat (spell power + max Gold) + drop the redundant hero-tooltip spell line

Two linked asks. The hero-power tooltip carried a "Your spells get +X/+Y" line; now that the Buffs window tracks spell power, that's redundant — **removed** it (and the now-unused `spellAttackBonus`/`spellHealthBonus` reads + the `.herotip-spell` rule). Then: the Buffs window was frozen at its pre-combat values during a fight (run-buff carry-backs apply at *settle*), so a spell-power build saw nothing change mid-combat. It now **ticks up live as the replay plays**, for the buffs that are cleanly telegraphed per-beat:

- **Spell power** — folded from the `+A/+B Spell Power` Start-of-Combat narrations (Ghastly Bladesmith / Gnasher / Cinderwing-via-Ryme) as their beats land.
- **Max Gold** — folded from Soulsman's Avenge `maxGold` events (player side only).

Other run buffs (Undead / Fodder / Imp / Guel / Mama Bear) have no clean per-beat signal, so they still resolve at settle (a follow-up could event them).

Mechanism mirrors the existing Cassen live-kill counter exactly: `useCombatReplay` computes the delta **up to the current beat** (`combatBuffDelta(events, processedEnd)`, memoized), `Recruit` bridges it to the store (gated on the values; **cleared to `null` at settle** so the row then reads the now-updated run state instead of double-counting), and `BuffsFrame` folds it via `gatherRunBuffs(run, combat?)`. The delta logic is pure + unit-tested; spell power is parsed from the sc text (the only run-buff signal that isn't a structured event).

**Files:** `runBuffs.ts` (`CombatBuffDelta` + `combatBuffDelta` + `gatherRunBuffs` 2nd arg folds spell/gold), `useCombatReplay.ts` (expose `combatBuffs`), `store.ts` (`combatBuffs` slice + setter), `Recruit.tsx` (bridge effect, mirrors `combatEnemyDeaths`), `BuffsFrame.tsx` (read + fold), `StatusBar.tsx` (drop the spell line + unused imports), `styles.css` (drop `.herotip-spell`), `BuffsFrame.test.ts` (+4: `combatBuffDelta` parse/enemy-skip, `gatherRunBuffs` fold + zero-base reveal).

**Verification:** `typecheck + lint + test (365, +4) + build:web` green. Confirmed **live in-preview**: the hero tooltip no longer has the spell line; a forced 3× Ghastly Bladesmith combat carries +3/+0 spell power and the Buffs window shows `Spell power +3/+0` at settle; the bridge nulls `combatBuffs` at settle (no double-count); and the store→window fold is reactive (pushing a `+2/+1` delta over a `+3/+0` base renders `+5/+1`). The per-beat animation itself can't be filmed headless (the replay clock pauses while the tab is backgrounded), but the bridge is identical to the live Cassen counter.

### fix: buffs-window polish (Eternal Knight + Mama Bear total + real Max Gold) + opponent frame stays top-right in combat

Five owner-reported fixes to the buffs window and the combat opponent frame:

- **Eternal Knight row** added to the buffs window — the run-wide enchant (`cardBuffs.knit`, each Eternal Knight death buffs all Eternal Knights +3/+2) now surfaces as `Eternal Knights +A/+B`, like the Fodder/Cling rows.
- **Mama Bear totals every copy on board.** The row used `board.find` (first Mama Bear only); with multiple Bears, *each* buffs every summon, so it now sums all `mamabear` on board — two Bears (one +2 accrued, one golden) read `+8/+8` instead of `+4/+4`.
- **Max Gold shows the real value.** It computed `maxEmbers − naturalPerWaveCurve`, which undercounts (early gains below the cap get absorbed by the natural curve) — the owner's golden Soulsman gained +2 but the row showed +1. Now reads `run.soulsmanGold` (the tracked actual Gold gained, golden-aware — the same number the card shows). The old formula needed `CONFIG`, now dropped from `runBuffs.ts`.
- **Opponent frame stays pinned top-right during combat.** It was recruit-only (`OpponentFrame` returned null off-recruit), so combat showed the foe in a separate left-side `.cbanner`. Now it renders in **recruit AND combat** (the box never jumps), and the redundant `.cbanner` (JSX + CSS + the `servedOpp`/`THREATS`/`nextOpponent` it used in `Recruit.tsx`) is removed. `nextOpponent(run)` has no phase guard, so during combat it returns the exact board being fought.
- **Opponent frame cursor → `default`** (was `help`), matching the buffs panel.

**Files:** `runBuffs.ts` (Eternal Knight row; Mama Bear `filter`+sum; Max Gold via `soulsmanGold`; dropped `CONFIG` import), `OpponentFrame.tsx` (render in combat too), `Recruit.tsx` (removed `.cbanner` + now-unused `servedOpp`/imports), `styles.css` (`.oppframe` cursor `default`; removed dead `.cbanner` rules; fixed stale `.combatspeed` comment), `BuffsFrame.test.ts` (knit assertion; Max Gold via `soulsmanGold`; +1 test for the Mama Bear sum).

**Verification:** `typecheck + lint + test (361, +1) + build:web` green. Confirmed **live in-preview**: buffs window shows `Eternal Knights +6/+4`, `Max Gold +2`, `Mama Bear · per summon +8/+8` (two Bears summed), `.oppframe` cursor `default`; and in combat the opponent frame renders **top-right** (`by Orangez · Djinn — 30 HP`) inside `.topright` with **no** `.cbanner` on the left.

### feat: generated cards now show the ACTUAL card mid-combat (real `toHand` event) — wires specific-card grant tech

Owner-prioritised: a card generated in combat must show the real card as it's generated (and this tech will back future grant animations). Combat was carrying back a *count/request* and picking the card at **settle**, so the replay couldn't show it. Now combat **picks the actual card** and routes it through the existing `grantToHand` path:

- The run's **tavern tier + active tribes** are threaded into `simulate` (two new params). `grantRandomSpell` / `grantRandomMinion` now filter the live pool (`Object.values(cards)`: spells, or `!token && !spell` minions ≤ tier, tribe-matched, active tribes, excluding the source), pick with the combat RNG, **emit a `toHand` event** with the real `cardId` (the same event Arcane Weaver uses — the card animates flying to your hand), and carry the cardId back.
- **Unified the grant settle:** every in-combat card grant (Arcane Weaver's specific card AND the now-picked random cards) flows through `CombatResult.playerHandGrants`. `settleCombat` adds each carried card with the run's per-card enchant + Undead bond and `takeFromPool` (both no-ops for spells) — so a granted minion keeps its run buffs, matching a conjure. Removed the old `playerSpellGrants` (count) / `playerMinionGrants` (request) carry-backs, their settle blocks, and `grantRandomDiscoverMinions`.
- Replaces the interim "Generated a spell/minion" `sc` telegraph (added earlier this session) with the real card flying in. Spell-power gains keep their `+A/+B Spell Power` `sc`.

**Files:** `simulate.ts` (tier/tribes params + pick-and-grantToHand in the two methods; removed accumulators), `types.ts` (dropped 2 CombatResult fields; updated ctx docs), `reducer.ts` (unified `playerHandGrants` settle with run buffs + `takeFromPool`; pass `s.tier`/`s.tribes`; removed dead blocks/import), `recruit.ts` (removed `grantRandomDiscoverMinions`), `simulate.test.ts` (run helper threads tier/tribes; 3 tests now assert `toHand` + the actual card), `run.test.ts` (settle test asserts the carried card lands with run buffs).

**Verification:** `typecheck + lint + test (360) + harness (determinism) + build:web` green. Confirmed **live in-preview**: a lost combat with a Sporebat emitted a `toHand` for the real spell (`growth`), and that same `growth` landed in the hand at settle.

### feat: combat feedback — telegraph spell-power gains + generated cards mid-fight; Taragosa combat text

Combat is a pure function whose carry-backs apply at **settle**, so several effects were invisible during the replay. Added mid-combat telegraphs (the run loop still applies them at settle — these are display-only events):

- **Spell-power gains** (Ghastly Bladesmith, Gnasher, Cinderwing via Ryme) now emit an `sc` narration **+A/+B Spell Power** sourced from the granting minion — previously silent until the shop.
- **Generated cards** (Sporebat, and the Discover battlecries Ryme re-fires — Sea Urchin / Black Belt Brian) now emit an `sc` **"Generated a spell/minion"** as they fire. The *specific* card is still chosen at settle (the pool/tier live in the run loop, not in pure combat), so this is a "card generated" telegraph rather than the exact card flying to hand — a follow-up could thread the pool into combat for the precise card.
- **Taragosa's combat card text** now reflects the run's spell power (its Growth scales with it), reading the combat-frozen value from the store. (The golden-card live-text fix shipped earlier already corrected the bulk of "combat descriptions don't show the true value".)

Implemented by adding an optional `sourceUid` to `grantSpellPower` / `grantRandomSpell` / `grantRandomMinion` (the ctx methods emit the `sc` when given one); the factory call sites pass `self.uid` / the re-fired minion's uid. Determinism is preserved (the events are deterministic and the odds sims discard them).

**Files:** `types.ts` (3 ctx signatures), `simulate.ts` (emit `sc` in the 3 grant methods), `factories.ts` (6 call sites pass the uid), `Unit.tsx` (Taragosa combat text + spell power from the store), `simulate.test.ts` (+1).

**Verification:** `typecheck + lint + test (359, +1) + harness (determinism) + build:web` green. Confirmed **live in-preview**: a lost combat with a Ghastly Bladesmith + Sporebat emits `+1/+0 Spell Power` and `Generated a spell` `sc` narrations.

### feat: run-buffs window (top-right) + Symbiote timing → start of every 5th turn

- **Symbiote** hero power now grants its Symbiotic Attachment token at the **START of every 5th turn** (waves 5/10/15…) instead of the end of every 4. Moved the grant from `faceOmen` (end of turn) to `advanceCombat` (the wave's shop opening), wave-keyed (`s.wave % 5 === 0`) — the shop-start `checkTriples` still combines a granted token. `heroPowerTick` is now unused (kept on `RunState` for save compat). Hero text + tests updated.
- **Buffs window** — a collapsible panel in the top-right, stacked **under the next-enemy frame** (`HudBar` now wraps both in a `.topright` column). Open by default, and only rendered when ≥1 tracked buff is active. Tracks the run's live permanent buffs: **spell power** (hero amplify + card-driven), **Undead · everywhere** (`undeadBuyAtk` + Lantern aura), **Fodder** (`cardBuffs.fred`), **Imps** (`impBuff`), **Clings** (`cardBuffs.cling`), and — only while on board — **Mama Bear** (current per-summon grant) and **Archmagus Guel** (current per-spell grant). The pure gather logic lives in `runBuffs.ts` (JSX-free, unit-tested); `BuffsFrame.tsx` is the view.

**Files:** `reducer.ts` (Symbiote move), `heroes.ts` (text), `run.test.ts` (+1 Symbiote, rewrote 1), `runBuffs.ts` + `BuffsFrame.tsx` (new), `BuffsFrame.test.ts` (new, +3), `HudBar.tsx` + `styles.css` (top-right column + window).

**Verification:** `typecheck + lint + test (358, +4) + harness + build:web` green. Buffs window confirmed **live in-preview** — renders under the opponent frame with all rows (spell power, undead, fodder, imps, Mama Bear, Guel) at correct live values, collapses to `Buffs N ▸`, and Mama Bear/Guel rows drop when off board.

### feat: dry-dirt dust ringing a unit placed on / moved across the board

A "flat stone dropped in dust" flourish on the Pixi FX layer: placing a minion from hand onto the
board, or repositioning one already on it, kicks up a ring of dry-dirt dust that escapes out from
under the card on every side.

- **`pixiFx.dust(cx, cy, w, h)`**: 12 soft tan puffs (dry-dirt colours) spawned **around the card's
  rectangular perimeter** and billowing **outward**, with vertical motion damped + gentle gravity so
  they stay flat to the ground rather than rising — normal blend, low peak alpha (~0.2–0.32) so it
  stays subtle. Reuses the soft-glow texture + the `gravity` particle field.
- **Renders behind the card** (owner ask: "below the card *layer*"): `puffOnBoard` briefly raises the
  landed card's `z-index` to 42 (above `.pixifx` z41) for the dust's lifetime, then restores it. `.app`
  isn't a stacking context, so the card's z-index wins over the overlay — the dust reads as escaping
  out from *under* the card, surrounding it.
- **Follows the landed position** (owner bug: dust showed where you *dragged*, not where it *landed* —
  e.g. a card that snaps back to the middle): `puffOnBoard(uid)` waits for the GSAP Flip (0.18 s) to
  settle, then measures the card's resting rect **by uid**, so the dust always rings the final slot.
- **Trigger** (`Recruit.tsx`): wired into both board-landing drops — hand→warband (`play`) and
  board→warband (`reposition`). Spell casts and Magnetic Mech merges are intentionally excluded.

**Files:** `pixiFx.ts` (`dust()`), `Recruit.tsx` (`puffOnBoard` + the two drop sites).

**Verification:** `typecheck + lint + test (354) + build:web` all green. Verified live: `dust()` spawns
12 tan puffs, all on the perimeter, all moving outward across ~9 distinct directions (a full ring), all
subtle.

### fix: golden cards now show their LIVE rules text (Sergeant, Taragosa, …), not the static printed goldenText

Owner report: golden Sergeant's tooltip "wasn't showing the right value." Root cause (general, not Sergeant-specific): `Card.tsx` renders `card.goldenText` for a golden card, but the live-text helpers (sergeantText, taragosaText, …) only ever fed the live value into `card.text`. `instView` (Recruit) had patched only Guel and Mama Bear into `goldenText`; every other golden live-text card fell back to the **static printed** goldenText. So a golden Sergeant with +6 accrued showed the printed "+4 Health" instead of the live "+10"; a golden Taragosa showed "+6/+8" instead of its spell-power-scaled value.

The live-text chain is already computed with the card's own golden flag, so for a golden card whose live text resolved, `text` *is* the golden-aware value. Both `instView` (shop) and `Unit` (combat) now feed that into `goldenText` (`golden && text !== printedText ? text : staticGoldenText`), replacing the Guel/Mama-Bear special-case with one general rule. Vanilla goldens (no live helper) still fall back to the printed/doubled golden text.

**Files:** `Recruit.tsx` (instView goldenText), `Unit.tsx` (combat goldenText). **Verification:** `typecheck + lint + test (354) + harness + build:web` green. Confirmed live in-preview: golden Sergeant now reads **+10 Health** (was +4), golden Taragosa **+14/+16** at +4/+4 spell power (was +6/+8), non-golden unchanged.

### feat: Taragosa's Growth scales with spell power + combat-log odds bar redesign

- **Taragosa's Growth now inherits the run's spell power** (it's a real spell cast — this was a flagged follow-up). Combat now receives the run's spell power (`spellAttackBonus`/`spellHealthBonus` → two new `simulate` params → `CombatContext.spellPower`), and `onAllyAttackCastGrowth` adds it to the base +3/+4 per cast (golden casts twice). New `taragosaText` shows the live scaled value in the shop tooltip — e.g. at +4/+4 spell power, Growth reads **+7/+8** (golden **+14/+16**). The card text turns green once spell power is non-zero, falling back to the printed +3/+4 otherwise.
- **Combat-log odds bar redesign.** The win/draw/loss bar is now **4× thicker**, recoloured **green → orange → red**, and its segment widths now **map to the actual odds**. (They never did: a generic `.ob { flex: 1 }` rule forced equal thirds regardless of the inline width — `flex: none` on `.oddsbar .ob` lets the per-segment width win.) Labels recoloured to match. Verified live: a 100%-win combat now shows a full green bar (not three equal segments).

**Files:** `tokens.ts` (Taragosa comment), `types.ts` (`CombatContext.spellPower`), `simulate.ts` (params + ctx), `factories.ts` (`onAllyAttackCastGrowth` adds spell power), `reducer.ts` (pass spell power to both `simulate` calls), `cardText.ts` (`taragosaText`), `Recruit.tsx` (wire it), `styles.css` (odds bar), `simulate.test.ts` (+1), `cardText.test.ts` (+1).

**Verification:** `typecheck + lint + test (354, +2) + harness (determinism) + build:web` all green. Combat-log bar confirmed live in-preview (height 4×, widths mapping, green/orange/red). _Golden Sergeant (also reported) was investigated — accrual (+4/gain golden, no double-count from the onGainAttack boundary diff), triple (keeps the highest bonus), and the live text all verified correct in the live build; awaiting the owner's specifics on what looked off (likely the tripled-golden accrual not being doubled, like Brood/Imp King)._

### fix: re-fired Discover battlecries grant a random pool card + Cinderwing via Ryme + Tara triple/tracker + Fleeting Vigor telegraph

Owner-reported batch, all in the `replayCombatBattlecry` / combat-carry-back area.

- **Discover battlecries re-fired in combat now grant a random pool card.** Ryme re-firing **Sea Urchin** (Discover-a-minion) or **Black Belt Brian** (Discover-a-spell) silently granted nothing — Discover is an interactive recruit-phase peek with no combat equivalent. Now `replayCombatBattlecry` handles them: spell-Discover → `ctx.grantRandomSpell` (the existing Sporebat carry-back); minion-Discover → new `ctx.grantRandomMinion(count, tribe, side, exclude)` → `CombatResult.playerMinionGrants` → `settleCombat` calls `grantRandomDiscoverMinions`, which picks one random pool minion **per request** of the Discover's tribe, **≤ tavern tier**, from the run's **active tribes** (tavern rules), with the run buffs baked in. Combat stays pure (the pick is deferred to settle). Golden Discovers twice (×2); Drakko composes (re-fire repeats). **Soren's Reclaim is unchanged** — per the owner, a resummon should fire the Deathrattle, not the Battlecry.
- **Ryme now procs Cinderwing Matron's +spell power.** `replayCombatBattlecry` gained a `battlecryBuffSpellPower` branch → `ctx.grantSpellPower` (the Skullblade/Gnasher carry-back), so re-firing Cinderwing in combat permanently raises run-wide spell power (golden ×2).
- **Tara: triple no longer resets the ascend counter, and the live tracker aligns.** `checkTriples` now keeps the **highest** `ascendProgress` of the three copies (lowest "to go"), mirroring Spirit Pup's spell progress — tripling a near-ascended Tara doesn't send it back to 20-to-go. And the in-combat "N to ascend" tracker was counting **only this fight's** grants; the prior accumulated `ascendProgress` is now threaded into combat (`BoardMinion`/`Minion`/`MinionSnapshot` → `instantiate` → `snapshot()` → the UI's `fromSnap`), so the live narration reads the **total** (prior + this combat) and matches the shop card. The settle carry-back still adds only this combat's grants (no double-count).
- **Fleeting Vigor now reads as doing something.** The +2/+1 start-of-combat buff worked (verified live: minions enter buffed) but was silently pre-baked into the initial board with no event — so it looked inert. `faceOmen` now prepends a Start-of-Combat **narration** (`sc`) to the combat log telegraphing the surge. `simulate` is untouched (no determinism/odds impact).

**Files:** `factories.ts` (`replayCombatBattlecry` discover + spell-power branches), `types.ts` (`grantRandomMinion`/`playerMinionGrants`, `ascendProgress` on the three combat types), `simulate.ts` (minion-grant accumulator, ascend tally uses prior, snapshot carries ascendProgress), `minion.ts` (instantiate carries ascendProgress), `recruit.ts` (`grantRandomDiscoverMinions`), `reducer.ts` (settle wiring, triple `ascendProgress`, combat-board ascend seed, Fleeting Vigor capture + narration), `useCombatReplay.ts` (`fromSnap` seeds ascendProgress), `simulate.test.ts` (+2), `run.test.ts` (+4, +1 updated).

**Verification:** `typecheck + lint + test (352, +6 new) + harness (determinism) + build:web` all green. Live in-preview: Fleeting Vigor emits its `sc` narration + minions enter at +2/+1; Tara carries `ascendProgress` into combat. New tests cover the random minion/spell grant + settle, Cinderwing via Ryme (golden ×2), Tara triple keeps max progress, Tara ascend seeding, and the Fleeting Vigor narration. Cross-checked by a 3-agent adversarial verify workflow.

### feat: triple-at-shop-start + Bane combat Fodder carry-back + combat speed slider (0.5×–5×)

Three owner requests.

- **Triples are now checked as the shop opens.** A combat carry-back can land a 3rd copy in the hand (a Deathrattle-granted minion) *after* the last recruit action that would have checked for a triple — so it sat un-combined until the next buy/play. `advanceCombat` now calls `checkTriples(s)` as its final step (after `s.phase = 'recruit'`), the one shop entry the player never triggers. It's idempotent + loop-guarded and the only settle/advance-path call, so no double-Discover; the gameover/victory early-returns sit above it, so it never runs on a run-ending transition.
- **Bane's combat Fodder buff now persists run-wide.** Previously a Bane reacting to Ryme's battlecry replays *in combat* buffed the living Fodder bodies that fight but only carried the **Imp** half back permanently — the Fodder card-type enchant was lost. Added a Fodder carry-back mirroring the Imp one exactly: new `CombatContext.grantFodderBuff` + `CombatResult.playerFodderBuffGain` (single accumulator, player-side guarded), populated in `simulate`, granted once per proc in the combat `onBattlecryBuffFodder` (golden ×2), and applied in `settleCombat` via the **same** `buffFodderRunWide` the recruit-phase Bane uses — so it enchants every Fodder type run-wide (board, hand, future copies). No double-count: the immediate `ctx.buff` is on the discarded combat clone; the permanent gain comes only from the carry-back.
- **Combat speed slider (0.5×–5×).** A `Speed` range control in the combat control bar (right-anchored, mirroring the opponent name on the left). New persisted store state `combatSpeed` (localStorage `ascent.combatspeed`, clamped 0.5–5). `useCombatReplay` divides every beat delay, the final hold, and the float lifetimes by `combatSpeed` (added to those effects' deps so a mid-fight change reschedules), and each GSAP lunge is `timeScale(combatSpeed)` — so the impact beat and the lunge connection stay in sync at every speed (both divide the same windup+strike by the multiplier). The lunge-firing effect intentionally omits `combatSpeed` from its deps (it re-runs per beat and captures the latest, and must not replay the current lunge on a slider drag).

**Files:** `reducer.ts` (triple hook + Fodder settle + `buffFodderRunWide` import), `types.ts` + `simulate.ts` + `factories.ts` (Fodder carry-back), `store.ts` + `useCombatReplay.ts` + `Recruit.tsx` + `styles.css` (speed slider), `simulate.test.ts` (+1), `run.test.ts` (+2).

**Verification:** `typecheck + lint + test (347, +3) + harness (determinism) + build:web` all green. New tests: Bane → `playerFodderBuffGain` +2/+2 (golden +4/+4); settleCombat applies it run-wide to `cardBuffs.fred` + the on-board Fodder; a combat hand-grant completes a triple at shop-start (golden, no buy/play). Speed slider verified **live in-preview**: renders in the combat bar (`Speed … 2.0×`), store default 1 + clamps to [0.5, 5] + persists, and a drag drives both the store and the readout. Cross-checked by a 3-agent adversarial verify workflow.

### feat: gold-coin sprinkle from the Gold counter on sell

A small income flourish on the new Pixi FX layer: selling a board minion now bursts a sprinkle of
**gold coins out of the Gold counter** (bottom-left status chip), arcing up and falling back under
gravity.

- **Gravity in the particle system** (`pixiFx.ts`): particles gained a `gravity` field (px/sec²,
  applied to `vy` after drag so it isn't damped the same frame); 0 = unchanged for all existing
  effects. A **gold-coin texture** (dark rim · bright face · inner ring · shine) is generated once.
- **`pixiFx.coins(x, y)`**: 9 coins fired upward in a ±33° fan with a punchy launch (speed 380–700),
  light air-drag, gravity `1700` so they pop then fall, gentle spin, holding roughly their size and
  fading out — normal blend (the texture is already gold).
- **Trigger** (`Recruit.tsx`): on a board→tavern sell, reads the Gold chip's screen rect
  (`.statusbar .chip.g`) and fires `coins()` from it, alongside the existing sell float (+N at the drop
  spot), `sfx.sell()`, and the `sellTick` gold-chip flash.
- **Overlay raised above the status bar** (`.pixifx` z-index 24 → **41**) so the coins sprinkle *over*
  the Gold counter, not behind it. Still below dragged cards (z100), modals (z50+), and the dev/settings
  buttons (z200). Side effect: combat impact effects now also render above the hand + floating damage
  numbers (brief, so readability is unaffected).

**Files:** `pixiFx.ts` (gravity field + apply, `coins()`, coin texture), `Recruit.tsx` (import + sell
trigger).

**Verification:** `typecheck + lint + test (344) + build:web` all green. Verified live: the Gold chip
is resolved at its bottom-left rect; `coins()` spawns 9 coins all born upward with gravity using the
coin texture, and pumping ~0.5 s of frames confirms all 9 reverse into a fall (the arc). Particle
recycle path unchanged (no leak).

### feat: PixiJS WebGL effects layer + combat hit-impact (sparks · shockwave · smoke)

Introduces **PixiJS v8** to the project as a **transparent WebGL effects overlay** — additive, not a
rewrite. The React 3-row board, drag, and card DOM are untouched; Pixi only draws the *juice* that
DOM/CSS does poorly (GPU particles), composited over the board. This is deliberately the foundation a
future Pixi combat arena can grow out of (same `Application`/`stage` is reused, not re-bootstrapped):
effects → combat sprites → full arena, each step shippable.

- **New dep:** `pixi.js@^8` in `@game/ui` (auto code-splits into separate renderer chunks; the main
  bundle gzips to ~251 KB).
- **`pixiFx.ts`** — a singleton `FxController` owning a lazily-created `Application` (`resizeTo: window`,
  `backgroundAlpha: 0`, high-DPI), with a **pooled-sprite particle system** on the Pixi ticker
  (frame-rate-independent decay via `deltaMS`, recycle to a free-list — no GC churn, no leaks). Public
  API: `impact(x, y, dx, dy)`. Particle textures are generated once from `Graphics`
  (`generateTexture`): a soft glow, and two **jagged shard** shapes (an 18×4 rectangle + a triangle).
- **`PixiFxLayer.tsx`** — a thin mount component (in `Game.tsx`); `.pixifx` CSS is a fixed full-viewport
  `pointer-events:none` overlay at `z-index 24` (above the board, below the floating damage numbers).
- **Wiring** (`useCombatReplay.ts`) — `pixiFx.impact()` fires from the GSAP lunge's **smack callback**
  (the exact contact frame where `sfx.hit()` already plays), using the defender's `getBoundingClientRect`
  center + the attacker→defender vector for spray direction. Hooks the existing `findEl(uid)` seam, so
  effects land 1:1 on units with no new coordinate plumbing.
- **The impact effect:** an additive white-hot **core flash** + a **normal-blend saturated-orange
  shockwave**, **16 jagged shards** (rectangles + triangles, oriented along their travel like flung
  debris, +20% size), and **4 wispy grey smoke puffs** that rise, expand, and linger after the sparks
  burn out. Particles gained an optional `peakAlpha` (born semi-transparent → fade) and initial
  `rotation`; blend mode is per-particle.

**Why the colour/blend choices:** the first cut used a small, brief, **additive-white** burst — which
washes out on the light "Sunward" cream board (additive only brightens toward white). Root-caused live
by reading the framebuffer (extract showed the particles rendered opaque, fired on-screen, `ready:true`
— so it was a *contrast/size* problem, not a render/wiring/coordinate one). Fix: saturated colours on
**normal** blend (which actually paint over cream) for the shockwave + shards, additive kept only for
the hot core glow.

**DEV affordances (stripped from prod by the static env check):** a `window.__pixiFx` handle for
console tuning, and a **"Test FX"** button (next to the SFX/Lunge dev tools) that fires an unmissable
burst at screen center + logs diagnostics.

**Files:** `packages/ui/package.json` (pixi.js dep), `packages/ui/src/pixiFx.ts` (new),
`packages/ui/src/PixiFxLayer.tsx` (new), `Game.tsx` (mount + dev button), `useCombatReplay.ts` (impact
wiring), `styles.css` (`.pixifx`, `.fxtest-btn`).

**Verification:** `typecheck + lint + test (344) + build:web` all green. Render path verified live via
the running dev server — Pixi mounts cleanly (single canvas/app, StrictMode-safe, no console errors);
framebuffer `extract` confirmed the burst rasterizes 22 particles in both blend modes with saturated
orange pixels (424 strongly-orange) and 4 rising semi-transparent grey puffs; the particle lifecycle
was proven to decay + fully recycle (no leak) by pumping synthetic frames. Owner confirmed the effect
reads clearly in real combat.

### Audio: bake full SFX mixer levels as shipped defaults

- Whole-bank mix dialed in by ear via the DEV SFX mixer, pasted into `SAMPLE_VOL_DEFAULTS` (sfx.ts). Notable
  moves: `sell` 0.51→0.3, `smack` 0.156→0.08, `cardlanding` 0.156→0.4, `freeze` 0.5→0.31, `unfreeze` 0.5→0.36,
  `roll` 0.5→0.61, `summon` 0.5→0.65, `cardVoice` 0.1→0.09. (Follow-up to PR #27, which merged before this
  tweak landed — shipped as its own PR.)

### fix: Ryme battlecry-trigger ecosystem (Drakko ×, sc animation, Karwind/Bane combat) + Hunter recruit proc + Target Dummy 0/6

Three owner-reported fixes.

- **Target Dummy → 0/6** (was 0/4). Data-only (`neutral.ts`); `docs/cards.csv` re-dumped; two def-derived tests updated (Broker bake `7 = 6+1`, Discover `[0,6]`).
- **Hunter now procs from EVERY shop Attack gain.** Hunter (T4 Dragon, "when this gains Attack, give your minions +Health") only had a *combat* reactor — in the shop, raising its Attack (Fortify, Growth, Spirit Fire, Karwind, weld, end-of-turn) spread no Health. Rather than thread the run state through ~35 `addBuff` sites, the dispatch lives at the **reducer boundary**: `reduce()` now wraps `reduceCore()` and, for any recruit-phase action, diffs the board by uid — every minion present **before and after** whose Attack strictly **rose** fires its `onGainAttack` reactor (`fireOnGainAttack`, now early-bailing for non-reactors before building a context). This mirrors combat (where `ctx.buff` emits `onGainAttack` on a positive delta) and is naturally correct for hand/board semantics: a Hunter **bought into hand** or **tripled** (the golden lands in hand) doesn't spread Health until it's on the board and gains Attack there; a freshly **played** minion is creation, not a gain. Combat settles are skipped by the recruit-phase guard. The owner chose full generality over Fortify-only.
- **Ryme's Deathrattle now actually triggers its neighbours' Battlecries in combat, with the full multiplier chain + an `sc` narration.** Rewrote `deathrattleReplayAdjacentBattlecry`: per chosen neighbour (golden Ryme = both; else a random qualifying one) it loops **`drakkoRepeats`** times — `1 + (golden Drakko ? 2 : any Drakko ? 1 : 0)`, `Math.max` (no stacking), mirroring the recruit semantics — and each iteration **(a)** logs an `sc` event (`"Ryme triggers X's Battlecry"`) so the proc animates on the dying Ryme, **(b)** calls `replayCombatBattlecry(n)` to actually fire the neighbour's battlecry, and **(c)** emits `battlecryTriggered`. That emit drives two **new combat factories**: `onBattlecryBuffTribe` (Karwind — buffs allied Dragons +1/+2 per proc, `universalTribe`/`tribe2`-aware) and `onBattlecryBuffFodder` (Bane — buffs living Fodder/Imp bodies + grants the permanent Imp carry-back). Because Sylus (`reaperBonus` re-runs onDeath) and Deathsayer (`rallyProcDeathrattle`, deathrattle-id re-invoke) each re-invoke Ryme's deathrattle by factory id and the neighbour/Drakko fan-out is re-evaluated fresh per invocation, the multipliers **compose multiplicatively**: `totalTriggers = invocations × (chosenNeighbours × drakkoRepeats)`, with `invocations = 1 + reaperBonus` on natural death (`× goldenDeathsayer` via Deathsayer). The owner's exact case — **golden Ryme + both neighbours + Drakko = 4 triggers → Karwind 4× (8 buffs)** — is locked by a test.

**Why combat-only for Karwind/Bane reacting to Ryme:** `battlecryTriggered` is emitted in combat *only* by Ryme's deathrattle, so Karwind/Bane stay inert in any fight without a Ryme dying beside a live Battlecry — purely additive, no regression (confirmed: the only `onGainAttack` combat reactors are Hunter (Health-only) and Sergeant (counter-only), so the `battlecryTriggered → Karwind buff → onGainAttack` chain is depth-bounded and can't loop; summons route through the 7-cap guard).

**Files:** `neutral.ts` (sandbag), `dragons.ts` (Bane comment), `factories.ts` (`drakkoRepeats`, rewritten Ryme factory, `onBattlecryBuffTribe`/`onBattlecryBuffFodder` combat factories), `recruit.ts` (`onGainAttackBuffAll` + cheap `fireOnGainAttack`), `reducer.ts` (`reduce` boundary-diff wrapper → `reduceCore`), `simulate.test.ts` (+2 Ryme tests), `run.test.ts` (+3 Hunter tests, sandbag assertions), `docs/cards.csv`.

**Verification:** `typecheck + lint + test (344, +7 new) + harness (determinism) + build:web` all green. New tests: Ryme → `battlecryTriggered` → Karwind +1/+2 with an `sc` narration; golden Ryme + Drakko = 4 triggers → 8 Karwind buffs; Hunter procs from Fortify; Hunter procs from a Growth spell (any Attack gain); a Health-only shop action (Mend) does NOT proc Hunter. Validated by a 3-agent adversarial verify workflow (combo math, regression/loop safety, Hunter/sandbag correctness — all CORRECT); the workflow flagged the original Fortify-only scope, which the owner then chose to generalize.

### fix: imp/Ryme/Hoarder refinements + sell float + gold-projection

Owner-requested follow-ups on the Imp/Ryme batch:

- **Imp buffs are now permanent.** Imp King's Deathrattle and Brood Matron's Avenge buff the current combat Imps **and** carry back to the run-wide `RunState.impBuff` (new `CombatContext.grantImpBuff` → `CombatResult.playerImpBuffGain` → `settleCombat`), so the gains persist into future fights like the recruit-side imp buffs.
- **Brood golden** keeps the **3-summon cap** (golden no longer raises it) and instead **doubles the Avenge stat** (+6/+4).
- **Imp King golden** stays **2 Imps** (new `fixed` param on `deathrattleSummon` skips the golden count-doubling) and doubles the buff to **+4/+6**.
- **Ryme now targets ANY Battlecry neighbour** (incl. economy battlecries — they simply no-op in combat), via `hasBattlecry` (any `onPlay`) instead of the combat-replayable-only filter.
- **Hoarder's banked Gold** is folded into the **Wave+1 Gold projection** (the bottom-left Gold mouseover), so the "+N next turn" shows up.
- **Sell float.** Selling a minion now floats the **actual Gold gained** (shared `sellValueOf` helper — Hoarder 2/4, else `CONFIG.sellValue`) at the **spot the minion was released**, reusing the combat death-float overlay; removed the old fixed "+1" by the Gold counter.
- **Imp token in hover popups.** Imp summoners/buffers (Brood, Imp King, Fodder Feeder, Ritualist, Bane) now show the **Imp token at its current buffed stats** in the hover popup (`tokenRefView` folds in `impBuff`); cards that touch both Fodder and Imps show both.

**Verification:** updated/added tests (Imp King carry-back + golden 2-Imps; Brood golden cap stays 3). `typecheck + lint + test (339) + build:web` green; the Gold projection (+banked) verified live in-preview.

### feat: Ryme (T4 Undead) — combat Battlecry-replay

**Ryme** (T4 Undead 5/3) — **Deathrattle: trigger an adjacent minion's Battlecry** in combat (golden: both neighbours; random pick when both qualify). Battlecries are recruit-phase and baked before combat, so this required a new **combat Battlecry-replay**: `replayCombatBattlecry` re-fires a minion's `onPlay` effects in the combat context, implementing the combat-meaningful battlecries — `battlecrySummon` (summon tokens), `battlecryBuffTribe` (buff matching friends, `universalTribe`-aware), `battlecryBuffUndeadAttack` (Deathswarmer), and `battlecryGrantKeyword` (auto-picks the highest-Attack friend). Economy battlecries (Discover, gain-to-hand, free rolls, spell power, tavern buffs) have no combat meaning and no-op — so Ryme only considers neighbours with a *combat-replayable* battlecry (`hasCombatBattlecry` / `COMBAT_REPLAYABLE_BC`). The replayed battlecry's magnitude respects the **neighbour's** own golden; Ryme's golden only controls 1-vs-2 neighbours.

**Files:** `packages/core/src/types.ts` + `packages/content/src/schema.ts` (factory id), `packages/core/src/effects/factories.ts` (`replayCombatBattlecry` + `deathrattleReplayAdjacentBattlecry`), `packages/content/src/cards/undead.ts` (Ryme), `ryme.png` art, `simulate.test.ts`, `docs/cards.csv`.

**Verification:** new tests — Ryme re-fires a neighbour's Alleycat Battlecry (summons a Stray); a golden Ryme re-fires both neighbours (2 Strays). `typecheck + lint + test (339) + harness + build:web` all green.

### feat: Imp archetype (2 new Demons + imp-buff system), hero-select 3, Brood/Ritualist/Bane/Karwind/Mama Bear/Hoarder reworks

A large content batch introducing an **Imp** sub-archetype plus several tuning changes.

**Hero select → 3 options** (`HERO_SELECT_COUNT` 2 → 3).

**The Imp system.** Imps are combat-only tokens (Brood Matron / Imp King summon them mid-fight — they never sit on the recruit board), so "buff your Imps everywhere" is a run-wide bonus *applied in combat*, exactly like the undead system. New `CardDef.imp` tag (the 1/1 Imp token only). **Recruit** sources accrue a persistent `RunState.impBuff` (via `buffImpsRunWide`); `simulate` applies it to every friendly Imp at combat start AND on summon (new `applyImpBonus`). **Combat** sources buff the combat Imps directly (`deathrattleBuffImps` / `avengeBuffImps`).

**2 new Demons:**
- **Fodder Feeder** (T1 1/2) — when **sold** (handled in the reducer's sell case): queue a Fodder + accrue the run-wide Imp buff +1/+1 (golden +2/+2).
- **Imp King** (T4 6/5) — Deathrattle: summon 2 Imps + buff your Imps +2/+3 (golden: 4 Imps, +4/+6).

**Changes:**
- **Brood Matron** — now breeds 1 Imp per friend death capped at 3 (golden 6, via `Minion.bredCount`); gains **Avenge (3): buff your Imps +3/+2**.
- **Ritualist** — End of Turn now gives Imps **and** Fodder **+2/+2** (was Fodder +1/+1).
- **Bane** — per-Battlecry enchant now hits Imps **and** Fodder **+2/+2** (was Fodder +1/+1).
- **Karwind** → Tier 5 (was 6).
- **Mama Bear** — +2/+2 improving +2/+2 (was +3/+3 / +3/+3); a gentler, longer ramp.
- **Hoarder** — reworked from sell-scaling to **Battlecry: +1 Gold next turn (new `bonusEmbersNextTurn`, consumed in `advanceCombat`); sells for a flat 2 Gold** (golden 4). Dropped the boughtWave sell-scaling + its live text.
- **Demonic Anomaly** — new art (`demonanomaly2`).

**Art:** Fodder Feeder, Imp King, Demonic Anomaly 2 (PNG, matching the recent minion-art convention).

**Files:** `packages/core/src/types.ts` (imp tag, 3 factory ids, `bredCount`, simulate sig), `packages/core/src/combat/simulate.ts` (`applyImpBonus`), `packages/core/src/effects/factories.ts` (`deathrattleBuffImps`/`avengeBuffImps`, Brood cap), `packages/content/src/{schema.ts,cards/{demons,dragons,beasts,neutral,tokens}.ts}`, `packages/sim/src/{state.ts,recruit.ts,reducer.ts}`, `packages/ui/src/{Recruit.tsx,art.ts}`, tests + `docs/cards.csv`.

**Verification:** new tests (imp buff applied to combat summons; Imp King Deathrattle; Fodder Feeder sell; Brood cap; Hoarder flat sell + battlecry bank; Mama Bear +2/+2). Updated the Mama Bear / Ritualist / Chronos / Bane / Djinn / Flowing Monk / Brood tests for the new values. `typecheck + lint + test (337) + harness + build:web` green; hero-select 3 + clean boot verified in-preview. **Ryme (combat battlecry-replay) lands in a follow-up commit.**

### feat: live-card-text audit + Soulsman "gained X Gold" metric

A full audit pass (3 parallel agents over all card files) cross-referencing every card against the live-text system (`cardText.ts` helpers wired into `instView`/`Unit.tsx`, plus `spellDisplayText` for spells). Most cards were already correct — ordinary stat scaling shows on the green stat badges, and the existing 13 helpers cover the scaling-text cases. The audit surfaced a small set of genuine gaps, now fixed:

- **Voracious Imp** — a golden copy printed "Gains **2x** stats from Fodder" but actually eats at **3×** (`fodderMultiplier` = base + 1, not the naive ×2). Added an explicit `goldenText: 'Gains **3x** …'`.
- **Soulsman "gained X Gold" metric** (the requested feature) — `grantMaxGold` is Soulsman-only, so `playerMaxGoldGain` is entirely Soulsman's contribution; `settleCombat` now accumulates it into a new run-wide `RunState.soulsmanGold`, and `soulsmanText` appends a live "{{Gained X Gold this run.}}" to the card.
- **Deathswarmer / Forsaken Weaver / Karthus** — these stack the run-wide `undeadBuyAtk` ("+Attack to your Undead wherever they are"), but that accumulated number had no on-screen home (only the recipients' badges showed it). `undeadBuyAtkText` now appends "{{New Undead arrive +N Attack.}}" on each contributor.
- **Eternal Knight** — its run-wide card-type enchant (`cardBuffs.knit`, +3/+2 per death) is now surfaced as "{{Now +A/+H this run.}}" (`cardTypeTallyText`), parity with Cling Drone.

These three new metrics are golden-independent suffixes, so `instView` computes one `metric` string and appends it to BOTH the normal and golden text (the `goldenText` branch was refactored into a `goldenBase` var) — non-metric cards get an empty suffix and are byte-identical to before.

**Deliberately deferred (flagged for the owner):** (a) **Ghastly Bladesmith** — its per-death +1 spell power is honest and the payoff already shows on the spell cards; surfacing a total on the minion would misattribute the *global* spell-power pool (Cinderwing/Gnasher/Harry/hero all feed it) to Bladesmith. (b) **Welded-host Better Bot / Harry Botter** — a host Mech's accrued `rallyMechAtk` / `spellAuraBonus` is genuinely invisible, but surfacing it needs host-side weld text (the host renders a different card's def) — a separate infra change.

**Files changed:** `packages/content/src/cards/demons.ts` (Imp goldenText), `packages/sim/src/state.ts` (`soulsmanGold`), `packages/sim/src/reducer.ts` (settleCombat tally), `packages/ui/src/cardText.ts` (3 helpers), `packages/ui/src/Recruit.tsx` (instView wiring), tests in `cardText.test.ts`.

**Verification:** new helper tests (Soulsman gold, the undeadBuyAtk trio, Eternal Knight tally). `npm run typecheck && npm run lint && npm test` (**335/335**) + `build:web` all green; the recruit screen renders all card types live with no console errors (verified in-preview). The Imp golden multiplier (3×) was confirmed against `fodderMultiplier`.

### fix: Undead "+Attack wherever they are" reaches Discovered/conjured copies + Symbiote token triples on grant

**Bug 1 — Discovered/conjured Undead missed `undeadBuyAtk`.** The run-wide "+Attack to your Undead wherever they are" (Deathswarmer / Forsaken Weaver / Karthus) was baked in only on **tavern buy** — a Discovered or conjured Undead came in without it. New shared helper `undeadBuyBonus(state, def)` (recruit.ts) returns the bonus for any Undead/`universalTribe` def, now applied at **every** minion-creation source: the `discover` reducer case, `conjureToHand` (Summon Stone / Tribes Choice / Undead Army / Cassen's grant), `battlecryGainRandomMinion` (Buddy Buddy), and the Lasso steal. (The buy path + the Symbiote token grant already applied it.) Lantern of Souls needs no change — it's re-derived live at combat/display for any Undead, so conjured copies already get it.

**Bug 2 — Symbiote's token didn't triple on grant.** The hero power grants a Symbiotic Attachment every 4 turns (in `faceOmen`) but never called `checkTriples`, so a 3rd copy sat un-combined until the next buy/play/Discover happened to trigger the check. Added `checkTriples(s)` right after the grant — the golden forms immediately. (`checkTriples` already counts tokens, so no other change was needed.)

**Files changed:** `packages/sim/src/recruit.ts` (helper + 3 conjure sites), `packages/sim/src/reducer.ts` (discover case + Symbiote grant), `packages/sim/src/index.ts` (export the helper), tests in `run.test.ts`.

**Verification:** 3 new tests — `undeadBuyBonus` returns the bonus for Undead/`universalTribe` and 0 for a Beast; a Discovered Sporeling gains +3 Attack with `undeadBuyAtk` 3; the Symbiote hero power triples the 3rd token immediately via `faceOmen` (3 tokens → 1 golden, 0 plain). `npm run typecheck && npm run lint && npm test` (**334/334**) + `build:web` all green.
### Audio: master limiter (prevent layer-clipping) + per-card voiceline gain tune

- **Master limiter on the whole SFX bus.** All sounds (samples + synth) now route through one shared
  `DynamicsCompressorNode` (threshold −6 dB, knee 0, ratio 20, attack 1 ms, release 0.25) before
  `ctx.destination`, created with the context in `audio()`. Fixes output **clipping when clips overlap** (the
  card-landing + voiceline + summon SFX hitting together summed past full scale and hard-clipped). Single
  sounds at playback gain sit below the threshold and pass untouched — only loud stacks get limited.
- **Verified by offline render** (OfflineAudioContext): a deliberately hot ×3 sum peaked at **2.19 (+6.8 dB,
  clipping)** straight to destination vs **0.89 (no clip)** through the limiter; tuned attack/threshold so even
  that torture case stays under 0 dBFS. Also analyzed the three shipped clips — alley peaks at 0 dBFS (4
  marginal samples), stray −1.4 dB, summon −2.7 dB (the limiter is the right fix, not per-file edits).
- **Per-card voiceline gain** lowered to `0.10` (`cardVoice`) by ear.
- **Verified:** typecheck + lint clean, 331 tests pass, app boots clean.

### Audio: per-card unique voicelines/SFX (`sfx.cardVoice`, zero-code convention)

- **New system for card-specific sounds.** A card can now have its own voiceline/SFX that plays when it's
  **played**, layered over the general `cardlanding`/`castSpell` sound. Convention-driven: drop
  `packages/ui/src/audio/cards/<cardId>.mp3` and it auto-plays for that card — no code per card.
- **How it works** (`packages/ui/src/sfx.ts`): a second eager `import.meta.glob('./audio/cards/*.mp3')` merges
  into `SAMPLE_URLS` keyed `cards/<cardId>` (sample-name derivation changed to path-relative so nested files
  don't collide with top-level names). New `sfx.cardVoice(cardId)` `playSample`s `cards/<cardId>` (silent if
  absent — no synth fallback). Called from the `play` handler in `store.ts` after the general sound. One shared
  `cardVoice` gain (0.6) in `SAMPLE_VOL_DEFAULTS` → a single DEV-mixer slider for all card clips (+ a preview
  that plays whichever card clip exists). Prefetched + bundled like every clip.
- **Ships, not local-only:** verified the built bundle references `audio/cards/<cardId>.mp3` (Vite bundles the
  glob into `dist/`); committed mp3s travel to main → every build incl. itch.
- **Summon audio (recruit + combat).** A new `sfx.summon(tokenId?)` plays a general summon cue (sourced
  `summon` clip with a synth rising-blip fallback) **layered with** the summoned token's own
  `cards/<tokenId>.mp3` (reuses the per-card system — tokens have cardIds). Fired from two places: the `play`
  handler reads the played card's `onPlay` effects for a `tokenId` (e.g. Alleycat → Stray), and the combat
  replay's previously-silent `summon` beat now calls `sfx.summon(e.minion.cardId)` (Deathrattle/other combat
  summons). One shared `summon` gain (0.5) in the mixer. So the full Alleycat moment = Alleycat's voiceline +
  the summon cue + the Stray's clip.
- **Verified:** typecheck + lint clean, 331 tests pass, build references the cards glob. First real clip
  (Alleycat / `alley`) added separately as the test case.

### fix: Sergeant's Deathrattle improves on EVERY Attack-gain, permanently (shop + combat)

**Bug:** Sergeant ("Deathrattle: give your minions +2 Health, improves each time Sergeant gains Attack") only improved its grant from **combat** Attack-gains, and only for that one fight. Attack gained in the **shop** (Forsaken Weaver on a spell cast, Deathswarmer, Karthus, Fortify, undead buy-bonus, …) did nothing, and combat improvements reset next fight. So two Forsaken Weavers + a spell improved it **zero** times in the shop instead of twice.

**Fix — `hpGrantBonus` is now a permanent, run-board–persisted accrual** (modelled on Kennelmaster's `summonBonus` carry-back), improved by **every** Attack-gain in both phases:
- **Shop:** `addBuff` (the recruit buff chokepoint) now improves a Sergeant's `hpGrantBonus` by its `improve` (×golden) once per Attack-gain *event* — so two Forsaken Weavers buffing it on one spell cast = two improvements (+2 twice; golden +4 twice). Health-only buffs don't count.
- **Combat:** the combat instance is **seeded** from the run board's `hpGrantBonus` (so the Deathrattle continues from the shop-accrued value), `onGainAttackImproveHpGrant` keeps improving it per `onGainAttack`, and the final value **carries back** to the run board (`CombatResult.playerHpGrantBonus` → `settleCombat`) so it's permanent across fights.
- **Triples:** a golden Sergeant keeps the **highest** accrued bonus of the three copies (the bigger +4 step comes from being golden).
- **Tooltip:** `sergeantText` is now wired into the **shop** card text (`instView`) too — it already showed live in combat — and the combat instance seeds `MinionSnapshot.hpGrantBonus` so the value reads true from frame 1. Both show the current grant ("+6 Health", green) updating in real time.

New plumbing: `BoardCard.hpGrantBonus` (state), `BoardMinion.hpGrantBonus` + `MinionSnapshot.hpGrantBonus` + `CombatResult.playerHpGrantBonus` (types), seeded in `instantiate`, built/returned in `simulate`, applied in `settleCombat`, combined in `checkTriples`.

**Files changed:** `packages/sim/src/state.ts`, `packages/sim/src/recruit.ts`, `packages/core/src/types.ts`, `packages/core/src/combat/minion.ts`, `packages/core/src/combat/simulate.ts`, `packages/sim/src/reducer.ts`, `packages/ui/src/Recruit.tsx`, `packages/ui/src/useCombatReplay.ts`, plus tests in `run.test.ts`, `simulate.test.ts`, `cardText.test.ts`.

**Verification:** 3 new tests — `addBuff` improves +2 per event (golden +4), health-only no-op; the combat Deathrattle uses the seeded bonus (+2 base + 4 = +6) and a survivor carries it back; `sergeantText` shows the live grant golden-aware. `npm run typecheck && npm run lint && npm test` (**331/331**) + harness (determinism) + `build:web` all green. (Live on-card render in the shop wasn't confirmable through the preview harness — it doesn't reflect injected board/hand state — but the tooltip wiring is identical to the other live-text helpers in that same `instView` chain.)

### feat: Demonic Anomaly permanent tavern buff + Abhorrent Horror live shop-phase preview

**Demonic Anomaly — permanent, run-wide tavern buff.** Its Battlecry buffed only the *current* tavern offers (`offer.atk`/`offer.hp`), so the +3/+3 evaporated on the next refresh. Per the design intent ("all tavern minions, permanently"), `battlecryFreeRollsAndBuffShop` now adds to `tavernBuyBonus` (the same run-wide buy-bonus channel as Staff of Guel) + `buffFodderRunWide`, so **current and future** offers all carry +3/+3 (golden +6/+6), shown on every offer by the shop view and baked in on buy. Card text updated: "Buff the current tavern" → "Give all Tavern minions +3/+3 this game".

**Abhorrent Horror — live pending-gain preview in the shop.** Abhorrent Horror's Start-of-Combat gain equals all Fodder consumed this turn, but nothing in the shop showed how big it would be. New `abhorrentHorrorText` (cardText.ts) appends a green "{{+A/+H next combat}}" to its card text, computed from `run.fodderConsumedThisTurn` (× golden) and threaded into `instView` (board + hand). It climbs in real time as you consume more Fodder this turn, matching exactly what the SoC factory will grant. `instView` gained a `fodderConsumed` param; both view memos now depend on `run.fodderConsumedThisTurn`.

**Files changed:** `packages/sim/src/recruit.ts` (Demonic Anomaly factory), `packages/content/src/cards/demons.ts` (card text), `packages/ui/src/cardText.ts` (`abhorrentHorrorText`), `packages/ui/src/Recruit.tsx` (instView wiring), plus regression tests in `packages/sim/src/run.test.ts` + `packages/ui/src/cardText.test.ts`.

**Verification:** 2 new tests — Demonic Anomaly sets `tavernBuyBonus {atk:3,hp:3}` + 2 free refreshes, and a later-bought minion still carries +3/+3; `abhorrentHorrorText` returns "+4/+4 next combat" (golden "+8/+8"), null when nothing consumed. `npm run typecheck && npm run lint && npm test` (**328/328**) + `npm run build:web` all green. (Live on-card render of the Abhorrent Horror text couldn't be confirmed through the preview harness — it injects shop state but not board/hand rows — but the wiring is identical to the 8 other live-text helpers already in that `instView` chain.)

### fix: Symbiote hero/power art + universalTribe honored across all tribe-buff checks

**Symbiote art** — wired the hero portrait (`art/heroes/symbiote.webp`) and hero-power button art (`art/powers/symbiote.webp`). Both keyed by the hero id `symbiote` (how `heroArt`/`heroPowerArt` are called), so the glob picks them up with no alias. Converted from the 2.3 MB masters to 512px WebP (61 KB / 53 KB) to match the all-WebP heroes folder and keep the title/HUD lean.

**universalTribe bug (reported: "Symbiote's power didn't give Mama Bear stats when played").** The `universalTribe` token (Symbiotic Attachment — counts as every non-neutral tribe) was being skipped by most *recruit-phase* tribe-gated buffs. PR #22 only taught a subset of factories about `universalTribe`; the summon-buff path it actually flows through on *play* was not among them. Audited **every** tribe-membership check in `recruit.ts` and `factories.ts` and routed them all through the `universalTribe`-aware path. Several also silently ignored a card's **second tribe** (`tribe2`) — a latent dual-type bug fixed in the same pass.

Recruit factories fixed (now via the existing `isTribe` helper, which honors `tribe2` + `universalTribe`):
- `summonBuffTribeImprove` (Mama Bear) — **the reported bug**
- `buffOnSummon` (Kennelmaster / Bristleback Matron) — also missed `tribe2`
- `battlecryBuffTribe` (Dragon battlecries) — also missed `tribe2`
- `onBattlecryBuffTribe` (Karwind)
- `deathrattleBuffTribe`
- `summonBuffSelfTribe` (Spirit Worgen, array form) — added a `universalTribe` clause

Combat factories fixed (completed the inline `universalTribe` clause already used by their corrected neighbors):
- `deathrattleSummonOverflowBuff` (Nanon), `rallyBuff` (Supporter), `onFriendlyAttackBuffTribe` (Raptor), `scAoePerTribe` (count), `scGrantShieldTribe`, `summonBuffSelfTribe` (Spirit Worgen combat), and `onShieldBreakDamage` (Arclight — also added `tribe2`, so a Demon/Mech Heckbinder's shield-break now triggers it).

The combat halves of Mama Bear / `buffOnSummon` / `deathrattleBuffTribe` already handled `universalTribe` (added in PR #22) — which is exactly why the bug only showed "on play" (recruit), confirming the diagnosis.

**Files changed:** `packages/sim/src/recruit.ts` (6 factories), `packages/core/src/effects/factories.ts` (7 factories), `packages/sim/src/run.test.ts` (new regression test), `packages/ui/src/art/heroes/symbiote.webp`, `packages/ui/src/art/powers/symbiote.webp`.

**Verification:** new regression test — a `symbioticattachment` token played beside a Mama Bear + Kennelmaster gains both buffs (1/1 → 5/5). `npm run typecheck && npm run lint && npm test` (**326/326**) + `npm run build:web` all green. Art confirmed serving as `image/webp` (200) via the live dev server; Symbiote portrait + power render in the HUD (verified by selecting the hero in-preview).

### fix: Undead buy-time Attack bonus now shows in the tavern

The Deathswarmer / Forsaken Weaver / Karthus "+Attack to your Undead **wherever they are**" (`undeadBuyAtk`) is baked into a card's stats *on buy*, but the tavern offer kept showing the unbuffed base — so an Undead's Attack jumped the moment you bought it. `shopView` (Recruit.tsx) now folds `undeadBuyAtk` into Undead offers (in addition to the Lantern of Souls `undeadAttackBonus` it already showed), so the tavern displays the buffed Attack in green, exactly matching what the offer becomes once bought. The `undead` predicate there now also matches `universalTribe`, keeping it in lockstep with the reducer's buy-time `isUndead`.

**Verified live:** with `undeadBuyAtk = 3`, a tavern Sporeling (1/2) shows **4**/2 and an Eternal Knight (3/2) shows **6**/2, both green; a Beast Kennelmaster offer stays 2/3.

**Files changed:** `packages/ui/src/Recruit.tsx`.

---

## 2026-06-24 (session 4)

### Audio: sourced End Turn / Face the Omen (`combatStart`) clip

- **Wired a real mp3 for the End Turn button.** The End Turn → Face the Omen transition fired `sfx.combatStart`,
  which was synth-only; now `packages/ui/src/audio/combatStart.mp3` plays via
  `playSample('combatStart', sampleVol.combatStart)`, with the old low sawtooth down-slide as the
  decode/missing fallback. Added a `combatStart` entry to `SAMPLE_VOL_DEFAULTS` (0.50, tunable live in the DEV
  SFX mixer) and the mixer preview map.
- **Verified:** typecheck + lint clean, 325 tests pass, `build:web` bundles `combatStart.mp3` (31.32 kB), app
  boots clean after a dev-server restart (required — the audio glob is eager). Updated `docs/sfx-events.md`
  (combatStart → sourced; removed from the needs-sourcing list).

### feat: shop weights, spell discover fix, Karthus/DeathlessHand/Footman, onKill bus, Tara combat log, live combat text, art wiring (#23)

**Bug fixes:**

- **Spell Discover now tier-gated** — `offerSpellDiscover` in `recruit.ts` was drawing from all spells with no filter; changed `const avail = [...SPELL_CARDS]` → `SPELL_CARDS.filter(c => c.tier <= state.tier)`. Players can no longer discover T6 spells at T5.
- **Shop weights flattened** — `drawOfferId` in `shop.ts` used a tier-biased formula (`1 + (tier match ? 1.2 : 0) + (within 1 tier ? 0.4 : 0)`) that gave T6 cards a 2.6× higher chance at T6 tavern. Replaced with uniform `pool[rng.int(pool.length)]` — every eligible card has equal chance. Confirmed by player request.
- **`onKill` bus now emits for ALL kills** — previously only fired when `attacker.reAttackOnKill` was true (Gnasher). Fixed `performAttack` in `simulate.ts`: emit `onKill` unconditionally on any kill, then conditionally chain the re-attack. Enables Karthus's on-kill factory.

**Card renames (id unchanged):**
- `skullblade`: "Skullblade" → **"Ghastly Bladesmith"** (effect unchanged)
- `knit`: "Grave Knit" → **"Eternal Knight"** (effect unchanged, card text updated)

**New cards:**
- **Karthus (T5 Undead 8/8 Divine Shield)** — `onKill` / new `onKillBuffUndeadAttack` factory: when Karthus kills an enemy, immediately buff all living friendly Undead +3 Attack (golden +6), and carry back `playerUndeadBuyAtkGain` so the bonus stacks into `undeadBuyAtk` AND is applied to existing run-board Undead in `settleCombat`. Future Undead buys also benefit.
- **Deathless Hand (T3 Undead 2/1)** — Deathrattle: summon a Footman (uses existing `deathrattleSummon` factory; golden summons 2).
- **Footman (T1 Undead 1/1 Reborn, token)** — not in the shop; summoned by Deathless Hand. Reborn lets it die twice — a reliable trade body and a Deathrattle trigger.

**New engine primitives:**
- `onKillBuffUndeadAttack` added to `EffectFactoryId` + `EffectFactoryIdSchema` + `FACTORIES`.
- `grantUndeadBuyAtk(amount, side)` added to `CombatContext` — accumulates `undeadBuyAtkGain`, returned in `CombatResult.playerUndeadBuyAtkGain`. `settleCombat` in reducer.ts stacks it into `s.undeadBuyAtk` and buffs existing board+hand Undead immediately via `addBuff`.
- `hpGrant` CombatEvent — emitted by the `onGainAttackImproveHpGrant` factory each time Sergeant's DR HP grant improves; the UI tracks `u.hpGrantBonus` from it.

**Tara combat log** — `simulate.ts` buff callback now emits an `sc` narration event whenever `buffCounts` increments for a card with `ascendAt`: shows "Tara: N stat grants to go" (or "has reached the ascend threshold!") directly in the combat event log.

**Combat live card text (Tara, Sergeant, Thundering Abomination):**
- `UnitFrame` gains `ascendProgress?`, `hpGrantBonus?`, `permaGain?`.
- `computeFrame` in `useCombatReplay.ts` now tracks: `ascendProgress` incremented on every `buff` event targeting a card with `ascendAt` (using existing `CARD_INDEX` import); `hpGrantBonus` from `hpGrant` events (absolute value so UI always shows current total); `permaGain` accumulated from `buff` events on EG-keyword units.
- `hpGrant: 0` added to `DELAY` (no extra pause — fires in the same beat as the triggering buff).
- `cardText.ts` gains `sergeantText()` (shows live `+N Health` replacing the printed value, green when improved) and `engraveTallyText()` (appends `{{+A/+H so far}}` for Engraved minions showing accrued combat gains).
- `Unit.tsx` text chain extended: `ascendProgressText` → `sergeantText` → `engraveTallyText` in priority order. Memo comparator updated to include all three new fields.

**Art wiring (18 files):**
- New PNGs copied to `packages/ui/src/art/minions/` for all PR#22 cards (Acid, Trickster, DemonicAnomaly, AbhorrentHorror, Deathswarmer, Pillager, ThunderingAbomination, Sergeant, ForsakenWeaver, SymbioticAttachment) plus new cards (Karthus, DeathlessHand, Footman).
- Rewired by replacing old webp with new PNG: VoraciousImp (→ `imp.png`), Spare Parts Drone (→ `drone.png`), Deathsayer (→ `deathsayer.png`).
- Renamed cards use new art: Ghastly Bladesmith (→ `skullblade.png`), Eternal Knight (→ `knit.png`).

**Files changed:** `packages/core/src/types.ts`, `packages/core/src/effects/factories.ts`, `packages/core/src/combat/simulate.ts`, `packages/content/src/schema.ts`, `packages/content/src/cards/undead.ts`, `packages/content/src/cards/tokens.ts`, `packages/sim/src/shop.ts`, `packages/sim/src/recruit.ts`, `packages/sim/src/reducer.ts`, `packages/ui/src/useCombatReplay.ts`, `packages/ui/src/cardText.ts`, `packages/ui/src/Unit.tsx`, `packages/tools/src/combat-harness.ts`, 18 art files.

**Verification:** `npm run typecheck && npm run lint && npm test` (325/325) + `npm run build:web` all green. All new art files confirmed in the Vite bundle output.

---

## 2026-06-24 (session 3)

### feat: Symbiote hero + 9 new minions (4 Demons, 5 Undead) — universalTribe, undeadBuyAtk, onRoll, fodderConsumedThisTurn

**Hero: Symbiote** — a new hero whose passive grants a 1/1 Magnetic token called **Symbiotic Attachment** at the start of the run and every 4 turns. The token has `universalTribe: true` — it counts as every tribe simultaneously, getting ALL tribe-conditional buffs and magnetizing onto any non-neutral minion (instead of only same-tribe hosts).

**New engine primitives introduced:**

- **`universalTribe?: boolean` on `CardDef`** — causes `isTribe()` (recruit), the `tribeAuras` loop (combat), and `buffOnSummon` / `summonBuffTribeImprove` / `deathrattleBuffTribe` / `deathrattleBuffTribeByTally` factories to match on any non-neutral tribe check. `magnetizesTo()` in reducer.ts also recognizes it (any non-neutral target is valid).
- **`undeadBuyAtk: number` on `RunState`** — the permanent recruit-time attack bonus stacked by Deathswarmer and Forsaken Weaver. Baked into newly bought undead at buy time (buy case in reducer.ts) via an "Undead Bond" tracked buff. Re-applied on Reborn and mid-combat summons via `applyUndeadBonus(m, true)` in simulate.ts (already wired in session 2). Kept separate from `undeadAttackBonus` (Lantern of Souls, combat-only) to prevent double-applying the buy-time bonus.
- **`'onRoll'` GameEvent + `applyOnRoll()`** — fires after every manual tavern refresh (roll action in reducer.ts). Used by Acid. `rollTick` per-instance on `BoardCard` tracks per-card refresh counts; reset each wave in `advanceCombat`.
- **`fodderConsumedThisTurn?: { attack; health }` on `RunState`** — accumulates raw fodder stats consumed in `consumeTavernFodder` each wave. Reset to `{ 0, 0 }` in `advanceCombat`. Passed to `simulate()` as `fodderConsumedAtk`/`fodderConsumedHp` on `CombatContext`; used by Abhorrent Horror's SoC factory.
- **`heroPowerTick?: number` on `RunState`** — tracks how many faceOmen ticks have passed for the Symbiote; every 4 ticks a new token is granted to the hand. Initial token is granted in `createRun`.

**4 new Demon cards:**

- **Acid (T6 7/7, Consume Native)** — `onRoll` / `onRollConsumeShop`: every 4 manual refreshes, consumes a random non-Fodder tavern offer and gains its stats (golden doubles). Wave-scoped via `rollTick`.
- **Trickster (T1 1/3)** — `onDeath` / `deathrattleGiveHealth`: give a random friendly minion this minion's current `maxHealth` (golden picks twice independently).
- **Demonic Anomaly (T4 4/4)** — `onPlay` / `battlecryFreeRollsAndBuffShop`: gain 2 free refreshes and buff the current tavern +3/+3 (golden: 4 refreshes, +6/+6).
- **Abhorrent Horror (T6 1/1, Start of Combat)** — `startOfCombat` / `scGainFodderStats`: gains Attack + Health equal to all fodder consumed this turn (golden doubles). SoC window so Soulfeeder + Anomaly combos can power it up.

**5 new Undead cards:**

- **Deathswarmer (T2 2/2)** — `onPlay` / `battlecryBuffUndeadAttack`: give your Undead +1 Attack wherever they are and stack `undeadBuyAtk` (golden +2).
- **Pillager (T3 3/4)** — `onDeath` / `deathrattleGrantCardToHand`: get a Gold Pouch (cardId `emberpouch`) in hand after combat (golden: 2 pouches).
- **Thundering Abomination (T5 4/7, Engraved)** — `onSummon` / `onSummonSelfBuff` (+3/+3 per friendly summon, golden +6/+6) + `summonOverflow` / `onSummonOverflowBuffTribe` (overflow summons give your Undead +2/+2, golden +4/+4). Stats carry back via EG.
- **Sergeant (T5 6/6)** — `onDeath` / `deathrattleBuffAllHealth` (give all living friendlies +2 Health, tracked in `self.hpGrantBonus`) + `onGainAttack` / `onGainAttackImproveHpGrant` (each time Sergeant gains Attack in combat, its DR grant improves by +2; golden +4). A snowball combo with Engraved-granting effects.
- **Forsaken Weaver (T6 5/8)** — `spellCast` / `spellCastBuffUndeadAttack` (combat half: living Undead get +2 Attack; recruit half: board+hand Undead get +2 and `undeadBuyAtk` stacks; golden +4).

**Token added:** `symbioticattachment` (1/1 Magnetic, `universalTribe: true`, counts as all tribes) in tokens.ts.

**Files changed:** `packages/core/src/types.ts`, `packages/content/src/schema.ts`, `packages/sim/src/heroes.ts`, `packages/content/src/cards/tokens.ts`, `packages/content/src/cards/demons.ts`, `packages/content/src/cards/undead.ts`, `packages/sim/src/state.ts`, `packages/core/src/combat/simulate.ts`, `packages/core/src/effects/factories.ts`, `packages/sim/src/reducer.ts`, `packages/sim/src/recruit.ts`.

**Verification:** `npm run typecheck && npm run lint && npm test` (325/325) + `npm run build:web` all green. No art files matched the new card IDs.

---

## 2026-06-24 (session 2)

### Fix: Crypt Drake live text · Twilight Whelp sequential spawn · Broodmother Taunt in snapshot · Golden Stuntdrake procs twice

Four correctness fixes for the Dragon tribe's newer cards:

**Crypt Drake live text in combat** — Crypt Drake's "Improve this every 3 attacks" buff has always
scaled mid-fight, but the card text never updated in the arena. Added `attackSeen?: number` to
`UnitFrame` (useCombatReplay.ts), detected by watching for the Crypt Drake's self-buff event in
`computeFrame` (its `onAllyAttackBuffAll` factory buffs ALL living friends including itself using its
own uid as source — a uniquely self-sourced buff with `attack > 0`). Added `cryptDrakeText()` to
`cardText.ts` (same pattern as `guelProgressText`): highlights the **current grant** in green and
appends `{{N to go}}` counting down to the next step-up. Wired into `Unit.tsx` text chain + memo
comparator. No new event types needed.

**Twilight Whelp sequential spawning** — the Whelp's Deathrattle (and Sylus extra procs) was
spawning all whelpling tokens in a batch loop, then flushing immediate attacks once after the full
cascade. This meant a second whelpling always overflowed if the first one was alive — it could never
get the chance to spawn into the slot freed by the first one dying. Fixed by:
1. Adding `flushImmediateAttacks?(): void` to `CombatContext` (types.ts) — wired from the local
   function in simulate.ts.
2. In `deathrattleSummon` (factories.ts): call `ctx.flushImmediateAttacks?.()` after each spawn
   when `card.attackOnSummon` is true. Each whelpling attacks (and may die) before the next one
   checks for board space. Correct: on a full board, if whelpling 1 dies → whelpling 2 spawns + attacks;
   if whelpling 1 survives → whelpling 2 overflows. Works for Twilight Whelp's own deathrattle, its
   golden (count=2), and Sylus extra procs (which call the same factory function an extra time per Sylus).

**Broodmother's Twilight Whelps missing Taunt in the summon snapshot** — `deathrattleSummon` was
granting keywords AFTER `ctx.summon()`, but the `summon` event is emitted with the snapshot taken
INSIDE `summonMinion` — so the keyword was on the live `Minion` but absent from the UI's first frame.
Fixed by adding optional `grantKeywords?: Keyword[]` to `ctx.summon` (interface + summonMinion signature),
applied BEFORE the snapshot is taken. `deathrattleSummon` now passes `grantKeywords` directly. The
Taunt emblem appears on Broodmother's spawned Whelps from frame one.

**Golden Stuntdrake procs twice** — golden Stuntdrake was only giving attack to 2 friends once (same
as non-golden except for a bigger Attack). Fixed: `avengeGiveAttack` loops `mul(self)` times (1 for
normal, 2 for golden), rebuilding `pickable` for each proc so targets are independently random. Card
text updated: "2 other friendly minions" (was "2 friendly minions"); added `goldenText` → "…twice."

Verified: typecheck clean, **325/325 tests** pass.

## 2026-06-24

### Audio: sourced refresh/reroll (`roll`) clip

- **Wired a real mp3 for the tavern Refresh button.** `roll` was the last tavern control still on a synth
  blip; now `packages/ui/src/audio/roll.mp3` plays via `playSample('roll', sampleVol.roll)`, with the old
  3-step square sweep as the decode/missing fallback. Added a `roll` entry to `SAMPLE_VOL_DEFAULTS` (0.50,
  tunable live in the DEV SFX mixer) and to the mixer preview map.
- **Verified:** typecheck + lint clean, 325 tests pass, `build:web` bundles `roll.mp3` (18.79 kB), app boots
  clean after a dev-server restart (required — the audio glob is eager, not hot-reloaded). Updated
  `docs/sfx-events.md` (roll → sourced; removed from the needs-sourcing list).

### Opponent pool: add Lemon's 32 boards (Drakko, waves 1–18)

- **New board export** `docs/board-exports/lemon.json` — 32 real captured boards from a Drakko run (waves 1–18,
  `origin:"self"`, `author:"Lemon"`), so players face actual human builds, not just house bot boards.
- **Regenerated the committed pool** via `npm run pool` → `packages/sim/src/opponentPool.data.ts`. The curator
  merged Lemon's 32 (all survived the per-wave cap, since real boards are preferred over house) with Orangez's
  254 and house fill → **339 boards across waves 1–20**, each re-rated by the simulate gauntlet.
- **Verified:** typecheck + lint clean, **325 tests** pass, pool regenerated deterministically (only the two
  intended files changed — an incidental `package-lock.json` version bump was reverted to keep the PR scoped).

### Feature: spells cast in combat now trigger Archmagus Guel (and count permanently)

Combat can now **cast spells** — Taragosa's Growth is a *real* spell cast, not just a buff:

- New **`ctx.castSpell(side)`** fires the `spellCast` trigger mid-combat (so any combat `spellCast` subscriber
  reacts) and tallies the cast on a running per-side counter. `simulate` now takes the run's **`spellsCast`**
  (seeding the player's counter so Guel's grant scales correctly) and reports the player's in-combat casts via
  **`CombatResult.playerSpellsCast`**.
- **Archmagus Guel** gained a combat half (`spellCastBuffOthers` in core `FACTORIES`, mirroring the recruit
  half): on a friendly combat spell-cast he buffs 2 other random friends +X/+X (X scales +1/+1 per 4 spells, via
  the running tally in the event payload), as a **temporary combat buff**. His existing `{on:'spellCast'}`
  effect auto-registers in combat now that the factory exists — no card change needed.
- **The counter is permanent:** `settleCombat` adds `playerSpellsCast` to the run's `spellsCast`, so spells cast
  in combat improve Guel (and every spell-count payoff) for the rest of the run.
- **Taragosa** now calls `ctx.castSpell` when it casts Growth (golden casts twice → 2 casts). Guel's card text
  updated to *"After a spell is cast (shop or combat)…"* + the live `guelProgressText` to match.
- Tests: Guel fires off Taragosa's combat cast (+1/+1) and carries back (`playerSpellsCast`); Guel scales with the
  passed-in `spellsCast` (start 4 → +2/+2 grant); `settleCombat` bumps the run's `spellsCast` (5 + 3 = 8).
  Verified: typecheck + lint + **322 tests** + `build:web`.
### Content: Nanon (T6 Mech) — a flood-or-pump Deathrattle

- **Nanon** (T6 Mech 6/6) — *Deathrattle: summon 6 Nanobots. For each one that can't fit, give your Mechs
  **+2/+2*** (golden +4/+4). New combat factory `deathrattleSummonOverflowBuff`: it attempts all 6 summons,
  counts the ones a full board rejects (reusing the existing `summonOverflow` path), then buffs every friendly
  Mech by `per-overflow × overflow-count`. **Golden doubles the buff, NOT the summon count** (per the card's
  "+4/+4" note) — so a packed board converts the wasted bodies into a bigger board-wide pump rather than more
  1/1s. The gift lasts the combat (it's a normal combat buff, not carried back).
- **Nanobot** — a 1/1 Mech token (not buyable). Art wired for both; Nanon uses the **`Nanon2`** master (the v1
  sits in the artist's `Unused/` folder).
- Tests: no-overflow (all 6 land, no buff), full-board overflow (5 overflow → +10/+10 to each Mech), golden
  (+20/+20, summon count unchanged). Verified: typecheck + lint + **312 tests** + `build:web`; cards.csv = 67
  minions / 24 spells / 10 tokens.

### Batch fixes: hero-power art + the card-tweaks pass (Hoarder / Sea Urchin / Gryphon / Frontdrake / Mama Bear)

A grab-bag of follow-ups on the 2026-06-24 content, all on `main`-resident cards.

**Art**
- Rewired **Cling Drone / Stuntdrake / Sea Urchin** from updated masters.
- Wired **8 hero-power button arts** (Cassen, Djinn, Drakko, Indy, Myra, Rohan, Soren, Warden →
  `packages/ui/src/art/powers/<heroId>.webp`). *`TitanHP.png` matches no hero (ids are warden/indy/myra/
  soren/rohan/djinn/nadja/cassen/drakko) and Nadja has no power master — both left unwired (flagged).*
- Audited art coverage: **all 99 card ids have art**; the prod build loads with every image intact (no broken
  images, the power webps fetch via the warm-art preloader).

**Content / rules**
- **Hoarder** → **Tier 2, 2/2** (was T1 1/1).
- **Sea Urchin** can no longer Discover **itself** — threaded an `exclude` id through the Discover plumbing
  (`DiscoverSpec.exclude` → `offerDiscover`), set to the source card.
- **Gryphon** now banks a free refresh **per hit, capped at 4 a combat** (was once-per-combat): `grantedRefresh`
  became a counter; golden banks 2 per hit. Text + a `max` param updated to match.
- **Frontdrake** (three interlocking changes):
  - **Djinn** (its replay End-of-Turn) no longer advances the cadence counter, but still pays off **on the turn
    it would proc** — a `replay` flag on the EOT payload skips the increment; the grant fires when
    `(eotTick + 1) % every === 0`.
  - Live text reads **“End of this turn.”** on the proc turn (else “Next in N turns.”).
  - A **triple** keeps the **furthest-along** cadence position (a copy about to proc keeps the “procs this turn”
    timing) — only the cycle position (mod `every`) is carried onto the golden.
- **Mama Bear** triple now **picks up the accrual at its current value** (the highest copy) — no reset, no
  Kennelmaster-style doubling; the bigger +6/+6 per-summon step just falls out of being golden.

**Card-text pass** — Mama Bear shows its live, golden-aware current grant (new `summonImproveText` helper, wired
into the recruit board for both the base and golden text); Frontdrake’s countdown reads naturally; Gryphon’s text
matches the new cap.

Verified: `typecheck` + `lint` + **314 tests** (+5 new: Frontdrake triple, Mama Bear triple, Sea Urchin no-self,
Djinn×Frontdrake on/off the proc turn; Gryphon + cadence-text tests updated) + `build:web` — all green. `cards.csv`
and the opponent pool regenerated (Hoarder’s tier shift moved two pool rows). *Follow-up: Taragosa should also keep
its “all stats are Engraved” line — that card lives on the open Tara PR (#16), so the text tweak goes there.*

### Content: Tara → Taragosa (the ascend dragon) — completes the 2026-06-24 batch

- **Tara** (T2 3/3, Engraved) — counts the stat-grants it's given in combat; after **20**, it **ascends to
  Taragosa** at the next settle, keeping its accumulated stats (like Spirit Pup). Built from **patterns
  already in the engine** — no mid-combat transform: `simulate` tallies grants for any card with `ascendAt`
  (a buff-count map → `CombatResult.playerAscendCount`), and `settleCombat` accumulates onto
  `BoardCard.ascendProgress`, swapping the cardId at the threshold (golden → golden Taragosa; the counting
  needs no combat factory).
- **Taragosa** (token, Engraved) — *All stats are **Engraved**. When a minion attacks, cast Growth (+3/+4 to
  your minions)* — explosive on a wide board (new combat factory `onAllyAttackCastGrowth`; golden casts it
  twice). Its card text leads with the **Engraved** line (it keeps the `EG` keyword, so it restates it like
  Tara). *Flagged:* the in-combat Growth does **not** inherit the run's spell power (combat has no access to it
  — a follow-up needing spell power passed into `simulate`).
- **Art** wired (Tara / Taragosa). Verified: typecheck + lint + **314 tests** + `build:web` all green.
- **Merge repair:** a prior `main`→branch merge had dropped the closing `},` on both **Tara** (dragons.ts) and
  **Taragosa** (tokens.ts), collapsing each into the next card (typecheck failed; the Tara/Taragosa combat
  tests failed because `taragosa` no longer existed as a card). Restored both braces.
- **Last card of the 2026-06-24 batch** — the whole set is now built across the session's PRs.
### Content: Cupcakes (Demon consume-the-tavern spell)

- **Cupcakes** (T5, 4g) — *Choose a Demon — it consumes 3 minions in the tavern.* A targeted spell whose
  chosen friendly **Demon** devours 3 *random* tavern minions through the real **Consume pipeline**: each
  meal feeds the Demon its stats × the Demon's fodder multiplier (Voracious Imp ×2) and fires its on-consume
  effects (Maw's shield, etc.), plus the UI consume-swirl. New cast factory `spellDemonConsumeTavern`
  (mirrors `consumeTavernFodder`, but eats any 3 tavern minions via the *chosen* Demon, not just Fodder via a
  random one). Fizzles on a non-Demon target (flagged).
- **Art** wired. Verified: typecheck + lint + **304 tests** + `build:web` all green; `cards.csv` = 25 spells.
- **Last one remaining:** Tara→Taragosa (the mid-combat Growth cast + combat transform).
### Content: final 3 Beasts (Sporebat, Gryphon, Mama Bear) — combat→run carry-backs + a summon engine

- **Two new combat→run carry-back channels** (`CombatResult.playerFreeRolls` / `playerSpellGrants`, mirroring
  the `fodderGrants`/`maxGoldGain` pattern) + a new **`onDamaged`** bus trigger (emitted by `dealDamage` on a
  hit that lands; a Map-miss when unsubscribed, so the hot path is unaffected).
- **Sporebat** (T4 2/6 Taunt) — *Deathrattle: add a random tavern-tier spell to your hand* (golden 2). The
  tier-bounded pick happens at settle (where the tavern tier is known); combat just banks the count.
- **Gryphon** (T3 3/6 Taunt) — *When it takes damage, gain a free refresh* — **once per combat** (a
  `grantedRefresh` flag; a Taunt soaks many hits, so per-hit would be runaway — flagged, a 1-line change to
  per-hit if wanted). Golden 2.
- **Mama Bear** (T5 6/6) — *When you summon a Beast, give it +3/+3 and improve this by +3/+3* — works **in and
  out of combat** (a `summonBuffTribeImprove` factory on both surfaces; the improve accrues in `summonBonus`,
  carried back; golden doubles; a triple resets the accrual — documented). Live card text TBD (follow-up).
- **Art** wired. Verified: typecheck + lint + **307 tests** + `build:web` all green; `cards.csv` = 65 minions.
- **Remaining (the last 2):** Cupcakes (a chosen Demon consumes 3 tavern minions) and Tara→Taragosa (the
  mid-combat Growth cast).
### Content: Twilight Whelp line + a new attack-on-summon combat mechanic (replaces Ember Whelp)

- **New mechanic — attack-on-summon.** A `CardDef.attackOnSummon` flag (+ schema); when a flagged minion is
  summoned mid-combat, `simulate` queues it (`pendingAttackOnSummon`) and `flushImmediateAttacks()` has it
  strike once, **out of turn order**, right after the spawning attack's death cascade settles — modeled on the
  existing `flushResummons()` drain (also run once pre-rotation for SC/Reclaimer summons). A Whelp's hit can
  spawn the enemy's Whelps (a chain), bounded by `IMMEDIATE_ATTACK_GUARD`; combat stays deterministic.
- **Twilight Whelp** (T1 1/1, replaces Ember Whelp) — *Deathrattle: summon a 3/3 Whelp that attacks
  immediately* (golden → 2). The **Whelp** (`whelpling`, a 3/3 Dragon token with `attackOnSummon`) is the payoff.
- **Twilight Broodmother** (T4 2/5) — *Deathrattle: summon 2 Twilight Whelps with Taunt* (golden → 4). Extended
  `deathrattleSummon` (combat + recruit) with an optional `keyword` grant for the Taunt. *(Minor: the Taunt is
  applied post-summon, so it works in combat but isn't on the summon-event snapshot — a cosmetic follow-up.)*
- **Ember Whelp removed** — it was the only `scDamage` user (the primitive stays available, untested-by-a-card
  now). Regenerated the opponent pool (`npm run pool` → 0 stale `whelp` boards, new cards included), repointed
  ~15 generic `whelp` test fixtures → `frontdrake`, dropped the SC-scorch test, deleted the orphaned `whelp.webp`.
- **Art** wired (twilightwhelp / whelpling / broodmother). Verified: typecheck + lint + **305 tests** +
  `build:web` all green; `cards.csv` = 63 minions / 24 spells / 9 tokens.
- **Hard tail remaining:** Sporebat (tier-aware spell carry-back), Tara→Taragosa (mid-combat Growth cast), and
  the gated Gryphon / Cupcakes / Mama Bear.

### Lunge feel re-tune + Tribes Choice no longer hands out neutral glue

- **Combat lunge defaults re-tuned (shipped from the live tuner).** New `DEFAULTS` in `lungeConfig.ts`:
  `windupDur 0.37`, `windupDepth 0.1`, `strikeDur 0.16`, `strikeDist 1.44`, `smackLead 0.005`,
  `settleDur 1.06`, `attackGap 0.22` — a weightier, more deliberate swing (longer wind-up + slow elastic
  settle, shorter inter-swing breather). These came from dialing the DEV Lunge tuner by eye, then committing
  the values as the new shipped defaults. **Stale-comment fix:** the file header warned to "keep
  windup+strike near 0.33s or retune `DELAY.attack`" — no longer true. Since the "damage lands at the lunge
  connection" change, the scheduler derives the attack-beat hold *live* from `windupDur + strikeDur -
  smackLead` (`useCombatReplay.ts`), so the damage float always lands on contact however these are dialed
  (the new sum is 0.53s and still connects correctly). Updated the comment to match.
- **Neutral is no longer a minion "type" for type-rolls.** Neutral cards still appear in shops/Discover as
  glue, but effects that "give a card of a type" no longer hand out neutrals. Concretely: **Tribes Choice**
  cast on a *neutral* target now fizzles (no conjure) instead of rolling a random neutral — `tribe ===
  'neutral'` short-circuits `spellGainOfTargetTribe` in `recruit.ts`. This mirrors `dominantBoardTribe`
  (Cassen / the upcoming Tribe Portal), which already excluded neutral. Audited the other type-rolls
  (Undead Army, Cassen's top-type grant) — they key off a fixed/dominant non-neutral tribe, so no neutral
  could leak there. Added a `run.test.ts` case asserting the neutral-target fizzle. Verified: typecheck +
  lint clean, 288 tests pass (run.test 199 → 200), `build:web` green.
- *(Note: "remove Ember Whelp" was deferred from this batch into the upcoming Dragons PR — `whelp` is a
  generic dragon test fixture in ~12 spots + baked into the generated opponent pool, and there's no other
  T1 dragon to repoint to until Twilight Whelp / Frontdrake exist. Cleaner to remove it there.)*
### Lunge feel retune — weightier swing, damage beat kept on contact

- **New shipped lunge defaults** (`packages/ui/src/lungeConfig.ts`), tuned by eye in the DEV Lunge tuner:
  `windupDur 0.22→0.37`, `windupDepth 0.14→0.1`, `strikeDur 0.11→0.16`, `strikeDist 1.22→1.44`,
  `smackLead 0.03→0.005`, `settleDur 0.55→1.06`, `attackGap 0.56→0.22`. Net feel: a longer, heavier
  wind-up driving a deeper lunge into the target, a slower springy settle, and a shorter breather between
  swings.
- **Kept the damage number/recoil ON contact.** The lunge now connects at `windupDur + strikeDur = 0.53s`
  (was 0.33s), so the result-beat schedule had to move with it or the damage would pop ~0.2s early (the
  regression PR #2 just fixed). Bumped `DELAY.attack` 220→353 in `useCombatReplay.ts` (353 × SPEED 1.5 ≈
  530ms = the new connection time). Added cross-references in both files so the two stay locked when retuned.
- **Tradeoff:** each attack beat is ~60% longer, so combat pacing is slightly slower — intentional, matches
  the heavier swing.
- **Verified:** typecheck + lint clean, **287 tests** pass, `build:web` succeeds, app boots clean (no console
  errors); feel confirmed live in the arena. localStorage tuner overrides still win for a dev who has saved
  values (hit Reset in the panel to fall back to these new defaults).
### Content: 4 new Dragons (Frontdrake, Supporter, Bronze Warden, Stuntdrake)

- **+4 Dragons** (Dragon pool 6 → 10) — purely additive. *Ember Whelp stays for now;* its removal was
  pulled out of this PR and folded into the upcoming Twilight Whelp PR, where the new "whelp" token replaces
  it as the generic T1-dragon test fixture (it's used in ~12 spots + baked into the opponent pool) and the
  pool regenerates once. The four cards:
  - **Frontdrake** (T1 2/1) — *Every 3 turns, get a random Dragon* (tier ≤ tavern, golden → 2). New recruit
    primitive **`endOfTurnGrantTribe`** + a per-card **`BoardCard.eotTick`** counter that advances once per
    turn (on Chronos proc 0, so Chronos adds extra grants on the cadence turn without speeding the count up).
    The card shows a live green **"Next in N turns"** countdown (`cadenceProgressText`, wired into Recruit's
    text chain).
  - **Supporter** (T2 2/3, Rally) — *Rally: give 2 friendly Dragons +1/+2* (golden +2/+4). Extended the
    previously-unused combat **`rallyBuff`** factory with an optional `tribe` filter + `count` cap (random
    pick among eligible). Backward-compatible (no params = buff all friends, the old behavior).
  - **Bronze Warden** (T3 3/3) — a vanilla **Divine Shield** wall (data only, keyword-only text).
  - **Stuntdrake** (T5 3/7) — *Avenge (3): give this minion's Attack to 2 friendly minions*. New combat
    primitive **`avengeGiveAttack`** (hands self's *current* Attack to N random friends; a golden's bigger
    Attack flows through automatically).
- **Art** wired for all four (masters → `npm run optimize-art` → webp; confirmed bundled by `build:web`).
  Also hardened the optimizer to skip a missing sub-dir — it crashed on an absent `art/effects/`, which the
  next art-wiring step in this content batch would have hit too (one-line `existsSync` guard).
- **Shared types/schema:** `EffectFactoryId` (core) + the zod `EffectFactoryIdSchema` (content) gain
  `endOfTurnGrantTribe` + `avengeGiveAttack`; `BoardCard` gains `eotTick?`.
- **Tests:** Supporter rally + golden rally and Stuntdrake's attack-gift (combat, `simulate.test.ts`);
  Frontdrake's 3-turn cadence (`run.test.ts`, driving `applyEndOfTurn` directly); `cadenceProgressText`
  countdown (`cardText.test.ts`). `cards.csv` regenerated (Dragon 6 → 10; 57 minions). Verified: typecheck +
  lint + **292 tests** + `build:web` all green.

### Stop honoring `prefers-reduced-motion` (it made the game unreadable)

- **The game now animates the same regardless of the OS "reduce motion" setting.** Removed the global
  `@media (prefers-reduced-motion: reduce)` rule in `styles.css` that near-instant'd (`animation-duration:
  0.001ms !important`) *every* animation. The problem: ASCENT's animations carry essential **information** —
  damage numbers, death pops, the Fodder-consume swirl, buff flashes — not just decoration. With reduce-motion
  on, all of that flashed-and-vanished, so the game looked broken ("no animations, fodder doesn't work, dmg
  numbers don't show"). This was the cause of a co-dev's "nothing works" report — he had the OS setting on; it
  reproduced on dev + itch for him, but not for anyone without the setting. Replaced the rule with a comment
  documenting the decision (and how to revisit it properly: calm *motion*, never suppress the informational
  floats). Perf on low-power machines stays handled the right way — compositor-only transform/opacity, no
  paint-property loops (see `docs/performance.md`, updated). Verified: rule gone from the loaded CSS (0
  matches), app boots clean.

### Version badge (bottom-right, above the gear)

- **In-game build badge.** A small `v{version} · {sha}` label sits just above the settings gear (bottom-right,
  scales with `--u` so it always clears the gear). Sources: the package version (bumped `0.0.0 → 0.1.0`) and
  the **short git SHA**, both injected at Vite config load via `define` (`__APP_VERSION__` / `__BUILD_SHA__`;
  SHA falls back to `dev` if git's absent). Hover shows the full `ASCENT v0.1.0 · build <sha>`. The SHA makes
  it unambiguous *which* build is live — directly addresses the "is this last night's version?" confusion.
  Ambient types in `packages/ui/src/buildinfo.d.ts`. Verified live: badge reads `v0.1.0 d2c8bf5`, above +
  right-aligned to the gear, no console errors.

### Damage lands at the lunge connection (combat-feel) — first PR through branch protection

- **The hit now reads on contact.** When a minion attacks, the sim emits the `attack`, then its on-attack
  effects (Better Bot's mech-buff, a Rally pulse / rally-summoned token), *then* the damage. The replay used
  to make a separate beat out of those buffs, so the damage number/recoil landed a beat **after** the buff
  animation — disconnected from the lunge that already connected. Now an `attack` beat **absorbs** its
  on-attack flash events (`buff`/`rally`/`summon`/`reveal`/`improve`) into the **wind-up**, so they animate
  while the attacker leans in and the **damage beat is the very next one — landing right at the lunge's
  contact frame** (where the smack already fires). Pairs with the earlier audio fix (smack only from the
  lunge), so sound + number now hit together.
- **How (safe by construction):** extracted the beat builder into a pure, tested module
  (`packages/ui/src/combatBeats.ts` — `buildBeats` + `RESULT_TYPES`). The change only alters how events are
  **grouped into beats**, never their order — so `computeFrame` (which folds the log in order to derive HP)
  is unaffected; final and intermediate state are identical, only the beat boundaries (and thus timing)
  move. 5 unit tests (`combatBeats.test.ts`) lock the grouping: plain attack, attack+buff, a rally+summon+buff
  run, a standalone buff run, and an SC cast.
- Verified: typecheck + lint clean, **287 tests** (5 new), app boots clean (no console errors). The *feel*
  across rally/cleave/windfury/deathrattle is for live review on this PR.
- **Process first:** this is the **first change through the new branch-protection flow** —
  `feat/damage-at-connection` → PR → CI gate → review, no direct push to `main`.
- **Follow-up (review feedback — same PR):** grouping wasn't enough; the damage was still late and dying
  units showed no number. Three fixes: **(1)** the replay clock now hands the wind-up beat off to its impact
  **the moment the lunge connects** — the scheduler holds an `attack` beat only for `windup+strike−smackLead`
  (read live from the lunge config) instead of the next beat's DELAY, so the damage number/recoil land on
  contact (was ~360ms late, because the wind-up beat had been held for the *dmg* beat's DELAY ≈ 690ms while
  the lunge connected at ~330ms). **(2)** floats **linger longer** (`FLOAT_MS` 1450→1950, `floatup` 1.4→1.8s,
  longer readable plateau). **(3)** **killing-blow damage now shows on death** — an in-unit float was clipped
  as the dying unit collapses (`.unit.dying` width→0); damage floats on units that die this beat are now
  captured at the unit's screen position and rendered in a **board-level overlay** (`DeathFloat` →
  `.deathfloat`) that outlives the unit and lingers. Verified: typecheck + lint + 287 tests + clean boot;
  feel is for live review.
- **Follow-up 2 (review feedback):** with damage now on contact, attacks fired too quickly and floats
  lingered too long. (a) **Inter-attack breather restored, correctly + tunable.** The old `+200` breath was
  applied to the wrong beat (off-by-one) and the connection fix dropped it; now, when an impact beat is
  followed by an attack, the scheduler adds a real pause before the next swing. It's a new **`attackGap`**
  knob in the lunge config + DEV Lunge tuner (default 0.25s) so the cadence is dialable by feel. (b) **Linger
  trimmed:** `FLOAT_MS` 1950→1500 + `floatup` 1.8→1.4s; **death floats clear faster** (`DEATH_FLOAT_MS` 1000,
  `.deathfloat .float` ≈0.9s) so a lone killing-blow number over a vanished unit doesn't hang.
- **Follow-up 3 (review feedback):** (a) **`attackGap` default → 0.56s** (tuned by ear — a clear beat between
  swings). (b) **Audio burst on tab-in fixed:** the beat clock now **pauses while the tab is hidden**
  (`visibilitychange` → a `hidden` gate on the scheduler) so beats + GSAP lunges don't pile up in the
  background and fire as one loud burst on return; `sfx` playback is also suppressed while hidden as a
  backstop. (c) **Final kill no longer cut off:** the replay reports `done` only after a short hold
  (`FINAL_HOLD_MS` 900ms) on the last beat (`done` now lags a `finished` flag) — so the killing blow's death
  collapse + damage float fully play before cleanup + the round-end UI (Climb On / settleCombat) take over.
  Verified: typecheck + lint + 287 tests + clean boot; combat feel for live review.

### Two-dev setup (CI + collaboration rules) · combat damage audio (SC zap, no default smack)

- **CI gate for two-dev work.** Added `.github/workflows/ci.yml` — on every PR (and pushes to `main` as a
  safety net) it runs typecheck + lint + test + `build:web`, so a broken build is unmergeable. Added a
  **Collaboration (2 devs)** section + **ownership map** to `CLAUDE.md` (the sim↔presentation seam: Kevin owns
  `core`/`content`/`sim`/`tools`, Mike owns `ui`/`apps/web`; shared boundary = `core/types.ts` + package
  entrypoints), plus the hot-file list to serialize. NOTE: GitHub **branch protection isn't available on this
  private repo without Pro** (or making it public) — until then "never commit to main" is a convention CI +
  review back up, not a hard gate. Owner action items in the session summary. **Update:** owner invited the
  2nd dev (Mike) + is upgrading to GitHub Pro to enable branch protection. Added **`ONBOARDING.md`** (repo
  root) — a step-by-step clone → install → verify → rules guide written for Mike's Claude Code to execute;
  linked from `CLAUDE.md` (Collaboration) + the README.
- **Combat damage audio reworked (notes 1 + 2, audio half).** The physical "smack" now comes ONLY from the
  attack lunge's GSAP timeline (at the contact frame) — the beat-driven `dmg` smack was removed entirely. So
  (a) **Start-of-Combat damage no longer smacks** — Ember Whelp & co. play a new `sfx.cast` zap on the `sc`
  beat instead; (b) the **double-smack is gone** — when an on-attack buff (Better Bot/rally) emitted a `buff`
  event between the `attack` and its `dmg`, the old positional guard (`beats[beatIdx-2]`) missed and the dmg
  beat fired a second, late smack; with no beat-driven smack at all, the lunge is the sole, on-contact smack.
  Non-attack damage (deathrattle AOE, poison) is briefly silent until it gets its own cue (tracked in
  `docs/sfx-events.md` gaps) — deliberately not defaulting to smack, per the note.
- **Deferred (note 2, visual half):** making the damage *number/recoil* land at the lunge contact (not a beat
  later when on-attack buffs interleave) is a replay-pipeline reorder — `computeFrame` derives HP by event
  order == beat order, so it needs an event-level reorder + live verification across rally/cleave/windfury/
  deathrattle. Queued as a focused next pass.
- Verified: typecheck + lint clean, 282 tests pass, live load clean (no console errors).

### DEV panels draggable + resizable

- **The SFX mixer + Lunge tuner can be moved and resized.** New shared `useDraggablePanel` hook: drag by the
  header (persists `left/top`), and the browser's native `resize: both` corner grip (persists `width/height`
  via a ResizeObserver). Position is React-controlled; size is owned by the browser and only *recorded* (never
  re-applied by React), so the resize grip and React never fight. Both persist to
  `localStorage['ascent.devpanel.<sfx|lunge>']` and restore when the panel re-opens (off-screen positions are
  clamped back in). DEV-only, so it ships nowhere. Verified live: a simulated header drag moves the panel by
  the exact delta and persists; `resize: both` active on both panels; no console errors.

### UX pass: hero-power line from the button · Bane purple haze · lunge dev tuner · player-name pill · dev cluster

- **Hero-Power aim line now starts at the button.** The targeting line was anchored to the hero *frame*
  (`.statusbar .hero .f`); it now anchors to the hero-power *button* (`.statusbar .heropowerbtn`, frame
  fallback), so the line draws from the thing you pressed. Verified the selector resolves live.
- **Bane's proc is a purple haze (not the orange flame).** The battlecry-trigger flash now renders per card:
  Karwind's Dragons keep the orange `karwindflame`; Bane + the board Fodder it enchants get a soft purple
  `fodderhaze` (one-shot opacity/transform glow swelling from under the card — the Fodder/Demon colour,
  matching the consume swirl & Ritualist wash). The `karwind` Card prop became `'flame' | 'haze' | false`.
- **Combat lunge dev tuner + slight default tweaks.** Extracted the lunge tunables into
  `lungeConfig.ts` (persisted to `localStorage['ascent.lunge']`); `playAttackLunge` reads it at call time.
  A DEV `LungeTuner.tsx` panel (🗡️, bottom-right) sliders wind-up dur/depth, strike dur, lunge distance,
  smack lead, settle — Copy/Reset; applies to the next attack. Shipped defaults nudged per the ask: **smack
  ~30ms earlier** (`smackLead 0→0.03`, fired before the strike completes), **wind-up longer** (0.2→0.22),
  **strike faster** (0.13→0.11), **lunge further** (1.15→1.22). Wind-up+strike still sums to ~0.33s, so the
  result beat still lands on contact (no `DELAY.attack` retune needed).
- **Player name moved to its own pill** below the ASCENT/Wave boxes (left), mirroring the opponent frame
  (below-right) — out of the ASCENT wordmark box. Absolutely positioned so it never reflows the top row.
- **DEV tool buttons clustered bottom-right** next to the settings gear: `[🗡️ lunge][🔊 sfx][⚙ gear]`
  (the SFX mixer moved from bottom-left). Panels open above, anchored right.
- Verified: typecheck + lint clean, 282 tests pass, live — no console errors, player pill + dev cluster
  positions confirmed, hero-power button + lunge-tuner sliders (new defaults) present.

### Art preload (itch pop-in) · Soulsman combat proc · Bane proc flash · Fodder consume never lost

- **Art preload kills the cold-load pop-in.** Card/hero/power webps were only fetched when an `<img>` first
  rendered, so on a cold load (esp. the itch CDN) each card's art "popped in" a beat after its frame.
  `art.ts` now exports `warmArt()` — on idle (`requestIdleCallback`), it kicks off a fetch + `decode()` of
  every bundled art URL into a detached `Image`, so the cache is warm before the first shop. Called once from
  `Game`'s mount effect; idempotent + non-blocking (never competes with first paint). Platform-independent —
  fixes the web + itch-embed build, not just a future desktop wrap. Verified live: **157 webps fetched on the
  title screen** (the whole set), no console errors.
- **Soulsman is now tracked + felt in combat.** Its Avenge (every 4 friendly deaths → +1 max Gold, golden
  +2) raised max Gold silently — no event, no cue. Added a `maxGold` combat event (core: emitted from
  `avengeMaxGold`, player-side only — enemies have no economy) so the UI replay can show it: a gold pulse
  (`goldproc`) on Soulsman, a "+N max gold" gold float, a rising coin-shimmer `sfx.maxGold`, a narration line,
  and a **Max Gold** section in the per-fight Procs report. Determinism preserved (it only adds log entries;
  run state was already counting the gain). Test extended: the 8-deaths case now asserts 2 `maxGold` events
  (player, +1 each).
- **Bane shows a proc.** Bane (a Battlecry trigger → enchant the Fodder card type run-wide) had no visible
  cue — with no Fodder on the board, nothing happened on screen. `onBattlecryBuffFodder` now flashes Bane
  itself (and any board Fodder it just buffed) via the existing battlecry-trigger flame flash. Test asserts
  `karwindFlash` includes Bane after a Battlecry resolves.
- **Fodder consume animation never gets lost.** The swirl effect marked its sequence "seen" and then bailed
  if the tavern row wasn't in the DOM yet — so a consume that procced before layout was lost forever (the seq
  never replays). It now **retries across frames** (`requestAnimationFrame`, up to ~40) until the tavern is
  measurable, then plays; cleanup cancels the rAF + timers. No more dropped swirls.
- Verified: typecheck + lint clean, **282 tests pass** (Soulsman + Bane assertions added), `npm run perf`
  within budget, live load clean (no console errors, full art set preloaded).

## 2026-06-23

### Tavern Up sourced clip · hardened board export for the itch iframe · SFX reference refresh

- **`tavernupgrade` clip wired.** The Tavern Up action now plays the sourced `tavernupgrade.mp3`
  (`packages/ui/src/audio/`), with the old rising-triad synth chord kept as the decode/missing fallback —
  same pattern as every other sourced clip. Registered in `SAMPLE_VOL_DEFAULTS` (vol 0.50) + `SFX_PREVIEW`,
  so it's tunable in the dev mixer. The `upgrade` action already dispatched `sfx.upgrade()` (store.ts), so no
  trigger change. Verified live (fresh server → the dev mixer lists `upgrade` as the 13th sourced key; no
  console errors). That's **14 logical sourced sounds / 17 mp3 files** now wired.
- **Board export hardened for itch's iframe.** itch embeds HTML games in a sandboxed iframe that can silently
  block file downloads. The Export-my-boards button now (a) appends the `<a>` to the DOM before `click()` and
  delays `revokeObjectURL` (a detached anchor or immediately-revoked URL drops the download in some browsers /
  the sandbox), and (b) detects an iframe (`window.self !== window.top`) and, when framed, tells the friend to
  **open the game fullscreen on itch** (the ⛶ button — loads first-party, where downloads work) if no file
  appeared. Import (file picker) already works inside the iframe. Empty-library guard moved up so "no boards
  yet" no longer triggers a junk download.
- **`docs/sfx-events.md` rewritten** to denote **all current + potential SFX**: a full per-key table (sourced
  vs synth, file(s), default vol, trigger), the 17 sourced files on disk, the synth keys that want a real
  sample (prioritized), and the still-silent combat/recruit events (with the top "missing sound" gaps). The old
  doc predated most of the wired clips (it still called everything "synthesized placeholders").

### Orangez's real boards baked into the pool · frozen-tavern ice effect · pulse cue

- **First real friend boards shipped.** Imported Orangez's export (300 boards / 22 runs), **filtered out the
  one test run** (a single injected board at wave 20 — kept only multi-board runs that terminated in a
  win/lose), retagged as `origin:'friend'`/author Orangez → `docs/board-exports/orangez.json`. `npm run pool`
  now bakes **323 boards across waves 1–20** (was 196, waves 1–9) — Orangez's runs fill the high waves the bot
  can't reach. Also taught the pool tool to **prefer real boards** when capping per wave (`curateWave`: real
  first, then house). Verified live: at wave 12 the pool serves an "Orangez" board.
- **Frozen-tavern ice effect.** When you freeze the tavern, each held shop card ices over — an icy-blue
  frosted overlay (`[data-zone="tavern"].frozen .card::after`) that **ramps up** from the top edge down
  (clip-path reveal) with a slight per-card stagger so the freeze sweeps across the row. One-shot (not a
  loop → cheap); recruit-only so combat units never frost. Verified live (computed `::after` = the frost +
  `frostin` animation).
- **`pulse` cue wired** — choosing a hero (the Choose button) and pressing the hero-power button both play
  `pulse` (replacing the old `temper` placeholder; the button press is the cue, so no per-action sound). Added
  to the tunable registry + dev mixer.

### Matchmaking back to WAVE-based + dev SFX mixer + tunable clip volumes

- **Reverted matchmaking from wins → WAVE.** Win count isn't development stage: a player at wave 5 with 0 wins
  (a losing run) has a developed Tier-2+ board but still "0 wins", so win-matching dropped that board on a
  turn-1 player (faced T2 units on wave 1). `pickOpponent` matches by **wave** again (same amount of shopping),
  still preferring real player/friend boards and using power as the fairness tiebreak. `nextOpponent` passes
  `s.wave`. (`wins` stays on the snapshot as harmless metadata.) Verified live: at wave 1 the pool serves a
  Tavern-tier-1 board, not an over-developed one.
- **Tunable sourced-clip volumes + a dev SFX mixer.** Per-clip gains moved into a registry (`sampleVol`,
  persisted to `ascent.sfxvol`); `SfxMixer.tsx` is a DEV-only floating panel (🔊 button, bottom-left) with a
  slider + ▶ preview per clip and a **Copy values** button (grab the JSON → paste back → it becomes the shipped
  default in `SAMPLE_VOL_DEFAULTS`). Stripped from production. So audio levels can be dialed in by ear without
  code round-trips.
- **reorder clip −55%** (0.5 → 0.225, the shipped default).
- Verified: typecheck + lint clean, 282 tests pass (pickOpponent test now asserts wave-matching), no console
  errors; live (mixer renders all 7 clips, wave-1 serves a tier-1 board).

### Audio: warm-up fix + sourced buy/cardlanding/discover/taunt/reorder cues

- **Fixed "sourced SFX only kick in after a hero power."** The audio context + sample decoding only started on
  the first SOUND, so the first buy/play was a silent/synth fallback while things warmed up. Now a one-time
  first-gesture listener (any click/keypress) creates + resumes the context and prefetches every mp3, so clips
  are decoded and ready by the first buy. Verified live: a single pointerdown prefetches all 11 samples.
- **New sourced cues wired:** `buy` → random `buy1`/`buy2`; a MINION landing → `cardlanding` (distinct from a
  SPELL cast — `castSpell`, its own sound, per-spell later); a **Discover** opening → `discover` (fires when an
  action sets `run.discover`); a friendly minion **GIVEN Taunt** → `taunt` (a board minion that gains the `T`
  keyword it didn't have — skips minions bought/played already-Taunt); a card **reordered** (warband/shop) →
  `reordercard`. All with synth fallbacks. (SFX live in `packages/ui/src/audio/`, lowercase — the only folder
  the glob reads; adding files needs a dev-server restart.)
- Verified: typecheck + lint clean, 282 tests pass, no console errors.

### Win-based matchmaking + friend board import/export + player name in the HUD + audio

The "real player boards" loop, end to end: name yourself, face boards by win count (real ones preferred),
and share boards with friends via a file.

- **Win-based matchmaking.** `BoardSnapshot` gains `wins` (combats won before that board fought); `pickOpponent`
  now matches by WIN COUNT (you face a board at the same point in its climb, not the same wave), then **prefers
  real player/friend boards** over house/synthetic, then biases toward similar power for a fair fight. Widens
  to the closest win count if none match; null only on an empty pool. `nextOpponent` passes the player's wins.
  Verified live: at 1 win, the pool serves the captured player board ("by TestPlayer · date") over 24 house
  boards. Pool regenerated so committed boards carry `wins`; legacy boards fall back to `wave`.
- **Friend import/export** (Settings → Shared Boards). Export downloads a shareable `{author, exportedAt,
  boards}` file; Import reads a friend's file, tags the boards `origin:'friend'` (+ their name/date), merges
  into your library (deduped) AND registers them live — you face them immediately, no reload. Same shape works
  in `docs/board-exports/` for `npm run pool`. Verified live: a friend file imports, tags `friend`, persists.
- **Player name in the top-left** HUD (under the ASCENT wordmark), in the accent colour.
- **Audio.** `buy` → random sourced `buy1`/`buy2`; a MINION landing → `cardlanding` (at the smack level), kept
  distinct from a SPELL cast (`castSpell`, its own sound — per-spell sounds later). All synth-fallback until the
  clips are dropped in `packages/ui/src/audio/` (`cardlanding.mp3`, `buy1.mp3`, `buy2.mp3` — not yet present).
- Verified: typecheck + lint clean, 282 tests pass (win-matchmaking test: matches by wins, prefers real,
  widens, null on empty pool); live (name top-left, win-matched real board served, import round-trip).

### Power framework — simulate-derived board rating (Stage 3 foundation)

The basis for true-strength matchmaking + power-band synthesis. `power = Σ(attack+health)` ignores keywords
and synergy; the new rating is a real fight.

- **`rateBoard(board, tier)` → 0..1** (`packages/sim/src/rating.ts`): the fraction of a fixed 8-rung
  CALIBRATION GAUNTLET (weak 2×1/2 → strong 7×9/16 DS+Windfury) the board beats in `simulate()` (draw =
  0.5). Keyword/synergy-aware (DS, Windfury, Venomous, Reborn, deathrattles, golden ×2 all move it),
  deterministic (fixed gauntlet + seed), ~8 sims/board. `ratingBand(r)` buckets it into `BAND_COUNT` (8)
  bands for matchmaking + synthesis targeting.
- **Baked into the committed pool.** `BoardSnapshot` gains optional `rating`; `npm run pool` computes it for
  every board and reports the band distribution. First bake: the bot pool (waves 1–9) spreads across bands
  0–3 — the gauntlet's top rungs are calibrated for much stronger boards, so high bands await real player
  boards from deep runs. Optional + back-compat (runtime/legacy boards lack it → fall back to `power`).
- Tests: rating is monotonic in strength, deterministic, 0 for empty, and **DS+Windfury rate higher than the
  same raw stats** (proving it captures what Σ power can't). 199 sim tests pass.
- **Queued next (the rest of the power framework):** (a) flip matchmaking to rating-based (rate the player's
  start-of-turn board, serve the closest-rating opponent within the wave) — balance-affecting, so it gets a
  focused validation pass; (b) **synthesize boards within a band** (`origin:'synthetic'` — mutate/recombine
  real boards, keep those whose `rateBoard` lands in the target band) to fill sparse bands/high waves; (c)
  in-game friend export/import UX.

### Committed opponent pool + board attribution (`npm run pool`) — real boards ship with the game

Until now, captured boards lived ONLY in browser `localStorage` (`ascent.boards`, written when a run ends);
the committed `OPPONENT_POOL` was empty and the app loaded a bootstrap pool recomputed from seeded bot runs at
every launch. So no real boards shipped, and nothing carried provenance. This lays the foundation for the
intended "you → friends → computer-built" opponent pool with attribution.

- **Schema — provenance.** `BoardSnapshot` gains `origin` (`'self' | 'friend' | 'house' | 'synthetic'`),
  `author` (display name), `capturedAt` (ISO date). All optional + back-compat (missing → 'house'); the
  wall-clock date is stamped by the UI/tool layer, never inside the pure `snapshotBoard`.
- **`npm run pool`** (`packages/tools/src/build-pool.ts`) bakes a curated `BoardSnapshot[]` into
  `packages/sim/src/opponentPool.data.ts` (loaded at startup via `OPPONENT_POOL_DATA`). Sources: house bot
  boards (60 seeded runs × every hero, deterministic, tagged `origin:'house'`) + any board exports dropped in
  `docs/board-exports/*.json` (your localStorage export and friends' boards, with name/date). Curation: drop
  empty/unservable, dedupe, cap per wave with an even power spread. First bake: **196 boards, waves 1–9** (the
  greedy bot rarely survives past 9 — high waves still fall back to procedural until real player boards +
  synthesis fill them). `docs/board-exports/README.md` documents the export/contribute flow.
- **Attribution wired end to end.** A persisted player **Name** (Settings → Player, `ascent.playername`);
  `saveRunBoards` stamps your runs `origin:'self'` + name + date; the opponent frame shows "by {author}" (self/
  friend) or "House board" / "Forged board", with the date. Verified live: the committed pool serves a real
  board at wave 1 ("Djinn … House board · {date}"), and a finished run stores `origin:'self', author, capturedAt`.
- Replaced the runtime `buildBootstrapPool()` startup call with the committed `OPPONENT_POOL_DATA` (+ this
  browser's own captured boards); `registerOpponents` still drops any board referencing a removed card.
- Verified: typecheck + lint clean, 279 tests pass; live (pool serves attributed boards, name persists, self-
  capture stamps provenance). **Next stages (queued):** simulate-derived strength rating + power bands, then
  computer-built boards synthesized within a band, then in-game friend export/import UX.

### Perf: the per-second turn timer no longer re-renders the whole board (heavy-board frame drops fixed)

Follow-up to the perf pass — the user still felt frame drops on a full wave-14 board (golden + Divine-Shield
Mechs) on the dev server. **Measured it in-browser** (injected a 17-card heavy board via `window.useGame`,
sampled `requestAnimationFrame` deltas): at rest the board was fine, but a **full Recruit re-render cost
~8–17ms** (p95 16.7ms — at the 60fps budget), **doubled by StrictMode in dev**. The culprit: `seconds` (the
round timer) lived in `useState` **inside Recruit**, so its tick re-rendered the entire recruit tree — board +
hand + shop, ~17 cards — **once per second**. On a slower machine that ~17ms doubles to a dropped frame every
second: the "frame droppy" feel.

- **Fix — external turn clock.** Moved the countdown to a tiny external store (`turnClock.ts`, via
  `useSyncExternalStore`). Now only the two small displays subscribe to live seconds (`useTurnSeconds` → a new
  `<TurnRing>` + `<TurnRope>`); Recruit subscribes only to the derived `timeUp` boolean (`useTurnTimeUp`), which
  flips once per turn. The per-second tick reads/writes the store directly (no React state), so it never touches
  the card tree. The countdown is a self-scheduling loop (no longer keyed on `seconds`); the reset is a
  `useLayoutEffect` so the clock is full before first paint (no "0"-flash).
- **Verified live** (same heavy 17-card board, timer actively ticking 65→62 over 3s): **avg 4.17ms, max 4.3ms,
  zero frames over 16.7ms** — vs. before, avg 8.3ms with periodic ~12.5ms spikes from the per-second re-render.
  Timer still counts down, the ring/rope update, and `timeUp` still locks actions at 0. 279 tests pass,
  typecheck + lint clean.
- **Context:** the dev server (5173) is the worst case (StrictMode double-render + unminified Vite); the packed
  build is materially smoother. This fix helps both, and removes the periodic dev hitch outright.
- Documented the pattern in `docs/performance.md` (isolate high-frequency state from large trees). Left as
  documented low-pri (measured negligible — 0 dropped frames even on the heavy board): `endpulse`'s small
  no-blur box-shadow pulse + the rope's `drop-shadow` loops.

### Performance north star: glow repaint fix + render-cost audit + `npm run perf` · win = 15 WON combats · Front to Back improve scales

**Performance is now the project's stated north star** (CLAUDE.md + new `docs/performance.md`): the game must
feel snappy at all times; a frame drop is a defect. Two adversarially-verified audit passes (a UI-render pass
and a cross-app pass — ~40 candidate findings, 19 confirmed) drove the fixes below.

- **The frame-drop culprit (magnetic-heavy boards): animated `box-shadow` glows.** `dsglow`/`rebornglow`/
  `venomglow`/`tripglow`/`tripleglow` animated box-shadow **blur+spread** on an infinite loop, forcing a full
  repaint of each glowing card every frame. Divine Shield is the canonical Mech magnetic, so "tons of magnetics"
  = a board of `.dscard` cards each repainting 60×/sec, *during the combat replay too* (shared `.card`). Fix:
  the card keeps a **static** halo; the breathing pulse moved to an **opacity-only `::before`** layer
  (`@keyframes kwglow`, `will-change: opacity`) — compositor-only, zero per-frame repaint. Verified live: a
  shielded card's `::before` runs `kwglow` and no longer paint-flashes at rest.
- **Combat re-render: memoized `Unit`.** `Unit` wasn't `React.memo`'d and rebuilt a fresh `view` object each
  render, so all ~14 units reconciled every beat. Now `React.memo` with a **value** comparator (the combat
  frame rebuilds fresh `UnitFrame`s each beat, so reference compare misses), and `floatsFor` hands out a shared
  `EMPTY_FLOATS` for float-less units so their prop stays referentially stable. Only changed units re-render.
- **Reducer: stop deep-cloning the event log.** `reduce()` `structuredClone`d the whole `RunState` — including
  `lastCombat` (the entire prior fight's event log) — on every dispatch, though the reducer never mutates it.
  Now `lastCombat` is shared by reference; the per-dispatch clone drops ~80–90%. `npm run perf` confirms a
  populated-`lastCombat` dispatch stays ~0.014ms.
- **Drag: killed the last per-frame reflow.** `warbandIndexAt`/`shopIndexAt` called `getBoundingClientRect` in
  the render body every drag frame (a read-after-Flip-write thrash) — the one drag path not yet on the cached-
  rect pattern. Now the resting slot left/width are cached once per drag in `insertRectsRef` (live-DOM fallback
  kept).
- **Cheap wins:** `decoding="async"` on card art (off-frame webp decode on rerolls); global
  `prefers-reduced-motion` rule (was 3 selectors → now `*` near-instants every loop, incl. the glow `::before`
  and particle layers — accessibility + paint win). Confirmed false positives left alone (backdrop-filter
  re-blur, `computeFrame` O(events²) measured at ~0.01ms, stable Zustand selectors).
- **Monitoring: `npm run perf`** (`packages/tools/src/perf.ts`) — times `simulate()` across board archetypes
  (incl. a keyword-heavy 7v7 "tons of magnetics"), `reduce()` per dispatch with a populated `lastCombat`, and
  full greedy-bot runs, each with a regression-tripwire budget; exits non-zero on an algorithmic regression.
  `docs/performance.md` documents the harness + the manual DevTools render-profiling routine (Performance panel,
  Paint flashing, Layers, FPS) we run together, + the anti-patterns.

- **Win condition fixed: 15 WON combats, not 15 waves reached.** Victory checked `s.wave >= CONFIG.maxWave`, so
  a non-perfect run (some losses — a loss costs Resolve but the climb continues) wrongly ended in victory at
  wave 15. Now it counts wins in `history` against new `CONFIG.winsToWin` (15); `maxWave` is repurposed as the
  balance-tools' wave-reporting horizon. The natural failure is Resolve hitting 0. Rewrote the PvE-win tests to
  be wins-based (victory decoupled from wave; reaching the horizon with fewer wins keeps climbing).
- **Front to Back: "Improve this by" now scales with spell power.** The card shows both the live grant (base 2 +
  accumulated escalation + spell power) **and** the per-cast improvement (base step 2 + spell power) — both
  greened when boosted; only the grant takes escalation. With +1 spell power the card reads
  "Give a minion +3/+3. Improve this by +3/+3" (matching the in-game screenshot). `spellDisplayText` now
  substitutes both `+N/+N` slots via a counted regex; tests exact-match both.

- Verified: `typecheck` + `lint` clean, **279** tests pass, `npm run perf` all within budget; live in the
  preview (recruit + combat render, units animate, glow `::before` pulses, combat→recruit advance after a loss,
  no console errors).

### Smack on contact (frame-accurate) · lunge 1.15 · volume slider + level pass

- **The smack now lands exactly on connection.** Root cause: the impact sound fired from a React beat-effect
  that runs ~2 frames *behind* `setBeatIdx`, while the lunge is frame-accurate GSAP — so the smack always
  trailed the visual, and the gap widened as the lunge grew longer. Moved `sfx.hit()` into the lunge's GSAP
  timeline (`playAttackLunge`'s impact `.add()` callback in `useCombatReplay.ts`), so it's emitted on the exact
  contact frame. To avoid a double-hit, the beat-driven smack is now **skipped when the damage came from an
  attack** (`fromAttack = beats[beatIdx-2]?.primary.type === 'attack'`) but still fires for non-attack damage
  (Start-of-Combat AOE, poison, deathrattle) — which has no lunge of its own.
- **Lunge strike 0.9 → 1.15** of the attacker→defender gap: the attacker now overdrives all the way into the
  target for a fuller, overlapping connect. `DELAY.attack` 340 → **220** so the result beat (damage floats +
  recoil) keeps landing in step with the (now earlier) GSAP contact.
- **Master volume slider** (was never present — the only audio control was the HUD mute speaker, which sits
  behind the enemy "NEXT" frame top-right). Added `masterVol` to `sfx.ts` (0–1, persisted to `ascent.vol`,
  multiplies every sound — both the synth `tone()` gain and the sourced `playSample()` gain) with
  `getVolume`/`setVolume` exports, and an **Audio** section at the top of the Settings (Esc) modal: a styled
  range slider + a mute toggle that disables the slider and reads "Off". A modal nothing can obscure.
- **Levels dialed down:** combat smack 0.7 → **0.39**, sell clips 0.6 → **0.51**.
- **Phantom-smack guard.** Gated the combat float + SFX beat-effects on `active` (live replay only), so a stale
  beat at the recruit↔combat phase swap can no longer fire a ghost smack/float.
- Verified: 278 tests, typecheck + lint clean; live in the preview — the slider drives volume and persists
  (`ascent.vol`), muting disables the slider + shows "Off", Settings modal renders the Audio section above
  Cards/Display, no console errors.

### Sourced SFX (sell + combat smack) + attacks overlap on contact

- **First sourced sound effects wired.** Added a Web-Audio sample player to `sfx.ts` (`import.meta.glob`'d
  `./audio/*.mp3` → decoded AudioBuffers, played via fresh BufferSources so they overlap cleanly; synth blip is
  the fallback until a clip decodes). **Sell** now plays one of `sell1–4`.mp3 at random; the **combat impact**
  (`hit`) now plays `smack`.mp3. Files live in `packages/ui/src/audio/`. Verified: all 5 mp3s resolve via the
  glob + fetch 200, decode on the first audio gesture, no console errors.
- **Attacks overlap on contact.** Lunge strike 0.75 → **0.9** of the attacker→defender gap, so the attacker
  drives into the defender and they visibly connect right as the `smack` lands.

### Attack "smack" + passive-hero power button

- **Attacks drive into the target.** The lunge strike covered ~55% of the attacker→defender gap (it stopped
  short at the edge); bumped to **~75%** so the attacker drives into the defender for a real smack, and the
  defender knockback on impact 0.09 → **0.14** so the hit reads harder.
- **Passive heroes get a power button too.** Rohan / Cassen / Drakko now show the hero-power button (so every
  hero displays its power art slot) — but it's **disabled and never glows** (no ready pulse / armed glow), with
  the game's non-action cursor, since there's nothing to activate. Active powers still pulse when ready; an
  active power on cooldown still dims (passive stays full opacity — it's always on, just not clickable).
- Verified live (passive button renders static + disabled; combat smack plays; no console errors).

### Combat feel + hero-power UI: punchier attacks · Cassen counter fix · spell-buff tooltip · bigger power button · SFX inventory

- **Punchier attacks.** `playAttackLunge` windup 0.16s → **0.20s** (more anticipation, a touch deeper pull-back)
  and strike 0.20s → **0.13s** (faster snap into the hit), so attacks read as wind-up-then-crack rather than a
  uniform slide.
- **Cassen counter double-count fixed.** The live in-combat Collision counter briefly showed 2/5 for 1 kill on
  the End-Combat screen: once combat *settled*, the kills were banked into `run.cassenKills` but the live
  `combatEnemyDeaths` bridge wasn't cleared until you left combat, so the HUD added both. Now the bridge zeroes
  the instant `combatSettled` flips — reads 1/5 consistently (verified live).
- **Hero spell-buff tooltip.** Hovering the hero now shows a "Your spells get +X/+Y" line (hero amplify + Harry
  Botter auras + Skullblade), green, hidden when zero — like the gold-next-turn tooltip.
- **Hero-power button +30%** (58u → 75u, ~86px) and the **hero frame's golden outline removed** (the ready
  pulse, armed glow, and hover accent border) — the ready/armed cue now lives entirely on the button, which is
  the click target. **Wired a hero-power art pipeline:** `heroPowerArt(heroId)` from `art/powers/<heroId>.{png,webp}`
  (added to `optimize-art`), rendered in the button with the glyph as fallback. Art spec: **512×512 square,
  transparent, subject centred** (the button is a circle / `object-fit: cover`) — see `art/powers/README.md`.
- **SFX inventory** → new `docs/sfx-events.md`: every combat + recruit event/animation, its on-screen length,
  and whether it currently has SFX (all current sounds are synthesized placeholders) — a reference for sourcing
  audio, with the priority gaps flagged (DS break, Start-of-Combat cast, poison, reborn, Fodder eat, magnet weld).
- Verified: 278 tests, typecheck + lint clean; live (bigger button, neutral frame, spell tooltip, Cassen 1/5,
  no console errors).

### Bug fixes (rally per-hit · cling legibility · fodder float) + codebase audit (dead code · redundancy · perf)

**Three reported bugs:**
- **Rally fires per hit.** Better Bot's `rallyMechAtk` fired once per attack-*turn* (before the swings loop);
  moved it inside the loop so it fires per swing — a Windfury body now rallies twice if it survives the first
  swing, matching Deathsayer's `onAttack` rallies. New test: a Windfury Better Bot → exactly 2 rallies.
- **Cling Drones legibility.** The cling +1/+1-per-magnetization growth was *correct* (manual magnetize / buy /
  conjure all verified) — but with the new random Combinator it rarely rolls a Cling, so growth was invisible.
  Per the live-text rule, the Cling Drone card now shows its current accumulated bonus ("Now +3/+3").
- **Fodder-consume float.** A Demon eating Fodder buffs itself, but the +X/+X float was masked when it fired at
  wave-start. The consume record now carries the eater's actual gain (× multiplier) and floats it as the Fodder
  swirls in — verified live (Voracious Imp ate 2 Fodder → "+4/+4").

**Codebase audit** (driven by a 6-agent analysis — 45 findings). Applied the safe, high-confidence wins:
- **Dead code removed:** `Legend.tsx` + `Omen.tsx` (superseded by OpponentFrame; −74 lines), the orphaned
  `effectArt`/`FX_ART` glob + `divineshield.webp` (drawn via `<Icon>` now; −5 lines + **−87 KB** off the web
  build), `Threat.punishes` (dead data), `SfxName` (zero refs), and the dead `onSell` + `onDamaged` GameEvents.
- **Performance (combat hot path — `simulate()` runs ~1001×/faceOmen):** the main attack-loop guard now uses a
  non-allocating `countLiving()` instead of `living(side).length` (the guard ran up to ~600×/sim → ~**600k
  fewer throwaway-array allocations per faceOmen**); the Sylus reaper count, Echo-Warden count, and Better Bot's
  per-swing rally now iterate the board directly instead of allocating a `living()` array each death/summon/swing;
  `applyUndeadBonus` early-outs when no Lantern is active (the common case); and `reAttackOnKill` is memoized per
  CardDef instead of re-scanning `effects` on every minion clone (tens of thousands of scans/faceOmen). These cut
  GC churn (most visible on death-heavy late-game boards); faceOmen stays well under 100 ms (~33 ms measured).
  All guarded by the determinism golden tests — combat outcomes are byte-identical.
- **Redundancy:** `drummerRepeats`/`chronosRepeats` collapsed onto one `bestCopyRepeats` helper (the
  "best-single-copy, golden=+2, no-stacking" rule); `magnetizeTargets` now uses the existing `isTribe` helper
  instead of an inline dual-tribe check.
- **Verified:** 278 tests, typecheck + lint clean; app loads + combat resolves live with no console errors.

**Deferred (documented for a focused follow-up — all inert or higher-risk):** removing the **20 dead effect-factory
ids** + bodies (`avengeBuff`, `rallyBuff`, the `onShieldBreak*` trio, `scSplitDamage`/`scAoePerTribe`/`scDestroyHighestAttack`/
`scGrantShieldTribe`, `deathrattleBuffTribe`/`deathrattleBuffRandom`/`deathrattleFillTribe`, the `onConsume*` trio,
`onKillBuffSelf`, `onFriendDeathBuffRandom`, `endOfTurnBuff`, `castSpell`-factory, `spellCastBuffSelf` — ~190 lines,
never dispatched so zero runtime cost) + the now-dead `onConsume`/`onLoseDivineShield` events they hung off; the
**`quiet`/odds-only `simulate()` flag** (skip the event log + snapshots + carry-backs for the 1000 odds sims — the
single biggest allocation win, but invasive); shared `num`/`str`/`highestAttack`/`makeHandCard`/`dominantTribe`
helpers (cross-package/multi-site); the `instView` 13-param → options-object refactor (no test coverage → risky);
and a drag-frame rect cache for `warbandIndexAt`/`shopIndexAt`. (The event-bus `[...list]` snapshot was flagged but
is **intentional** — a minion summoned mid-emit must not handle the in-flight event — so left as-is.)

### Live card text (Guel) · shop buff floats · Combinator attribution · hero-button cursor

Refinements on the two batches below (same day):
- **Live card text rule + Archmagus Guel progress.** Established the convention (saved to memory) that scaling
  "quest/ascension" minions keep their tooltips **live + accurate**. Applied it to Guel: a new
  `guelProgressText` (cardText.ts) shows his *current* grant (+X/+X, golden-aware) and the **countdown to the
  next step** (4→3→2→1), both green via `{{…}}`; wired into `instView` (board + hand) with `run.spellsCast`
  threaded through, including the golden path (Card shows `goldenText`, so the helper output is set there too).
- **Buff floats in the shop.** Recruit-phase buffs now float the actual **+X/+X** above the minion, exactly
  like combat (`.float.buff`), in addition to the green flash. The buff-detect effect now tracks per-card
  attack+health (not just the total) to derive the delta; `Card` gained a `buffFloat` prop (keyed so a repeat
  buff remounts the rise). Shows the *net* gain per action — e.g. casting Spirit Fire next to Guel reads
  "+6/+6" (the +4/+4 spell plus Guel's +2/+2 reaction), matching how combat collapses a beat's buffs.
- **Combinator buff attribution.** A Combinator weld is now credited to the **welded magnetic** in the inspect
  breakdown ("Harry Botter ×2"), not to "Combinator" — its weld `source` is the picked mech's name, and
  `addBuff`'s `count` + Inspect.tsx's `{source} ×{count}` render handle the rest (matches a manual magnetize).
- **Hero-power button cursor.** A *disabled* power button showed the bare OS arrow (my `:disabled { cursor:
  default }`); now it uses the game's custom `gauntlet_default` cursor like the other control buttons.
- Tests: +1 (`guelProgressText` grant/countdown/golden). **279 green**, typecheck + lint clean; verified live
  (Guel reads "+2/+2 … 3 to go"; a cast floats "+6/+6"; disabled button cursor is the custom default; a
  Combinator weld inspects as "Harry Botter"). No console errors.

### Magnetic mechs · triple keeps welds · Guel scaling · win counter · button-only hero power · art

A follow-up pass on the content batch below (same day):
- **Sheldon / Speedy / Harry Botter are now Magnetic.** Sheldon welds Divine Shield, Speedy welds Windfury,
  Harry Botter welds its spell-power aura. Keywords + stats weld through the existing path; the *aura* needed
  new plumbing so it survives being welded into a host: a new `CardDef.spellAura` (Harry Botter = 1) +
  `BoardCard.spellAuraBonus`, threaded through `MagnetPayload`/`applyWeld`, the magnetic-play payload, the
  Combinator weld, and `spellStatBonus` (now generic over `def.spellAura` + welded `spellAuraBonus`, so the
  old hard-coded Harry Botter special-case is gone and future aura cards fold in for free). Combinator's random
  magnetic pool now naturally includes all three.
- **Triple keeps welded magnetic attachments.** `checkTriples` absorbed `manaBonus` (Money Bot) but dropped
  `rallyMechAtk` (Better Bot) and the new `spellAuraBonus` — so a tripled host lost its welded Rally/aura.
  Now it sums all three welded fields into the golden (matching the Money Bot path the owner confirmed works).
- **Archmagus Guel scales.** His +atk/+hp grant now improves by **+1/+1 per 4 spells cast this run** (golden
  **+2/+2** per 4) — `step = floor(spellsCast / 4)` added to the base before the golden multiplier. Card text
  updated. Makes a T4 a build-around spell payoff that stays relevant late (a balance-direction goal).
- **Win counter in the HUD.** A gold crown + count of combats won this run, read straight off `run.history`
  (the per-combat W/L/D log) — no new state, always agrees with the end-screen summary.
- **Hero power fires from its button only.** Clicking the hero *frame* no longer arms/fires — the power circle
  on the frame's right is now the sole trigger (a real `<button>`, disabled when unusable, keyboard-focusable);
  the frame's action cursor was removed so it no longer reads as clickable.
- **Art.** Wired Spirit Worgen (`spiritworgen`) + Archmagus Guel's new art (`guel`→`guel2` alias).
- Tests: +3 (magnetic welds for the three mechs, triple-keeps-welds, Guel scaling); updated the Combinator-fork
  test to derive valid welds from the live magnetic pool. **276 green**, typecheck + lint clean; verified live
  (new art renders, win counter reads, frame-click inert / button-click arms, no console errors).

### Content batch (6 minions + reworks) · Mana→Gold · Combinator rework · hero-power button · **End-Turn freeze fix**

**The End-Turn freeze (the headline fix).** The owner reported two consecutive late-game runs (wave 6 vs
Drakko, wave 10 vs Cassen) that "hung up and froze on End of Turn" — the recruit screen stuck with the shop
visible and the button dead. Ruled out every loop first: `simulate` is fully bounded (iteration guard 300,
re-attack guard 50, summon cap 7, echo bounded — a hand-built 300-iteration stalemate is 900 events and 1000
odds sims run in **100ms**); `faceOmen`/the odds loop are fast; the End-Turn beat telegraph + the combat
replay are bounded `setTimeout` chains that can't synchronously freeze a tab. **Root cause:** the previous
balance patch *removed* Corrupted Lifebinder, but the opponent pool is hydrated at startup from the player's
**localStorage board library** (`loadStoredBoards`), which validated snapshot *shape* but never that each
minion's `cardId` still exists. A board captured by an older build (containing `lifebinder`) loaded into
`OPPONENT_POOL`; when `faceOmen` served it, `instantiate` threw `Unknown card: lifebinder`. That throw lands
inside the End-Turn beat chain's `setTimeout`, so it's uncaught — the phase never flips to `combat`, the turn
stays stuck in recruit, and the bad board **persists across runs** in localStorage (why it hit two runs in a
row, only at deep waves where captured boards are served). Fixed at two layers:
- **`registerOpponents` now filters out unservable boards** (`isServableBoard`: every minion's `cardId` must
  exist in the current `CARD_INDEX`). Both sources — the bootstrap pool and the persisted player boards —
  route through it, so a stale capture can never enter the pool. On the owner's next load this clears their
  poisoned localStorage entry automatically.
- **`faceOmen` got a belt-and-suspenders fallback:** the served-board combat (+ its odds) is wrapped in
  `try/catch`; on *any* serve-time failure it re-resolves against the procedural threat board, so combat
  **always** resolves and End Turn can never hard-lock on a bad opponent again. Refactored the enemy build
  into `proceduralEnemy()` + `resolveCombatVs(enemy, tier)` to share the path cleanly.
- Tests: `isServableBoard` accept/reject, `registerOpponents` drops a stale board, and a `faceOmen` test that
  force-pushes a `lifebinder` board past the filter and asserts it does **not** throw, reaches `combat`, and
  falls back to a fightable enemy with odds. **273 green.**

**6 new minions + carry-back plumbing.** Better Bot (T5 Mech 6/4, `Magnetic`+`Rally`: on attack gives your
other Mechs +5 Attack via a new `rallyMechAtk` field that *stacks* when welded — `applyWeld` accrues it, so 5
welded onto one Mech → +25; combat applies it in `performAttack`); Sheldon (T3 Mech 2/4 Divine Shield);
Speedy (T4 Mech 4/4 Windfury); Harry Botter (T4 Mech 1/5, passive aura — `spellStatBonus` adds +1/+1 to
stat-granting spells while it's on board, golden +2/+2); Burial Imp (T2 Demon 3/3, Deathrattle queues a
Fodder to the next tavern via new `deathrattleAddFodder` → `CombatResult.playerFodderGrants` → `settleCombat`,
golden 2); Soulsman (T3 Undead 2/5, `Avenge (4)` raises max Gold by 1 via new `avengeMaxGold` →
`playerMaxGoldGain` → `settleCombat` bumps `maxEmbers`, golden 2). Two new combat carry-back channels +
factories (`grantTavernFodder`, `grantMaxGold` on `CombatContext`).

**Gnasher rework + Maw → T3.** Gnasher, the Overrun is now "when it kills a minion it **attacks again** and
your spells permanently gain **+1/+1**" (`reAttackOnKill` + a new `onKillBuffSpellPower` factory — separate
from `deathrattleBuffSpellPower` because `onKill` carries `attacker`, not `minion`). Maw of the Pit moved T4→T3.

**Combinator → random Magnetic Mech.** Instead of always welding a Cling Drone token, Combinator's End of
Turn now magnetizes a **random Magnetic Mech** (Cling / Money Bot / Better Bot…, rolled on its own seeded
stream) onto a random friendly Mech — so the welds vary turn to turn (a Cling stacks the Cling enchant, a
Money Bot welds income, a Better Bot welds stacking Rally). The host selection is unchanged (still seeded via
`magnetizeTargets`, matching the UI's electrify telegraph). Card text + the hover reference popup updated
(now shows all three magnetic mechs). Rewrote the two cling-specific Combinator tests to the random-fork
behavior; cling-improvement stays covered by the play-path tests.

**Mana → Gold, once and for all.** All user-facing "Mana" → "Gold" (card text, spell names — Mana Pouch →
**Gold Pouch**, Mana Font → **Gold Font** — Nadja's power, StatusBar labels + tooltips, live card text). Card
ids are unchanged (`emberpouch`, `manafont`, power kind `gainMaxMana`). The cost color (`--mana`) is now gold,
and the `mana` Icon glyph was redrawn from a teal droplet to a **gold coin** (disc + stamped rim/sparkle +
shine) — shows in the Gold chip, the projected-gold rows, and the coin cost badges.

**Hero-power button.** Added a circular hero-power button **attached to the right side of the hero frame** (in
the StatusBar), with a placeholder glyph (dedicated artwork to come) and ready/armed states; clicking it
bubbles to the frame's existing arm/fire handler. (Replaces the earlier placement off the control frame.)

**Art.** Wired the 6 new minions + new art for Heckbinder (`heckbinder2`) and Combinator (`combinator2`) via
the `ART_ALIAS` map, plus the owner's new Gold Font / Gold Pouch art (alias `manafont`→`goldfont`,
`emberpouch`→`goldpouch`). Optimized 10 masters (21.8MB → 0.56MB). Verified live (fresh dev server — new art
needs a restart, not a reload): all 10 art files resolve, the coin + hero circle render, and End Turn →
combat resolves cleanly with zero console errors.

**Docs.** `docs/cards.csv` regenerated from `@game/content` via `npm run dump-cards` (53 minions, 19 spells,
7 tokens). Per the owner, `docs/balance-handoff.md` is intentionally **not** updated (inaccurate / not a
priority).

## 2026-06-22

### Balance patch v1: Yazzus targeted-only · remove Corrupted Lifebinder · 15-round win
First pass on the owner's balance list (the "tractable trio"; the deeper T1–4 + decision-diversity work is
deferred — see `docs/balance-handoff.md` §9).
- **Yazzus → aimed spells only.** It doubled *every* spell, including economy/utility/Discover — degenerate.
  A new `spellCasts(state, def)` gates the multiplier on `def.target` being set: only spells you aim at a
  minion (Spirit Fire, Shatter, Front to Back, Aresmar, Tribes Choice…) cast twice (3× golden); untargeted
  spells (Growth, Mana Pouch, Sprout, Help Wanted…) always cast once. Wired through the reducer cast path,
  the Sprout/Help Wanted Discover paths (no longer Yazzus-multiplied), and the UI cast-spark replay. Card
  text → "Your **targeted** spells cast twice."
- **Removed Corrupted Lifebinder + the entire linked-mirror system.** Cut the card (content + zod schema)
  and every trace of the mirror: `linkUid`/`linkBase`/`linkApplied` (core `BoardMinion`/`Minion`/
  `MinionSnapshot` + sim `BoardCard`), the combat `mirrorLink` + the start-of-combat linkUid remap
  (`simulate.ts`), the `battlecryLinkDemon` factory + `syncLifebinders` (`recruit.ts`) and its two reducer
  calls, and `minion.ts`'s linkUid pass-through. The `reduce()` wrapper (whose only job was the post-action
  sync) collapsed into `reduceCore`. Swingy payoff + a fragile system (the same machinery that sat next to
  the recent crash hunt). (Art asset + README art-table row left in place, harmless.)
- **Curve → 15-round win.** `CONFIG.maxWave` 20 → 15: you win the run by clearing round 15 (a perfect run
  wins all 15). Cuts the drag, and the shorter arc lowers the finale's stat peak. Left `curve.statScalePerWave`
  (0.16) as the difficulty dial to tune by feel for the new length.
- Tests: rewrote the Yazzus tests (Help Wanted no longer multiplied; the resolve-twice test now uses Spirit
  Fire; added an untargeted-Growth exclusion) and removed the 9 Lifebinder tests. **265 green**, typecheck +
  lint clean.

### Fix the End-Turn hard lock (stale combat-replay beat index) + add a render error boundary
- **Symptom:** late-game (waves 7 & 10, two consecutive runs) the game hard-locked — End Turn did nothing,
  the board frozen. **Root cause:** `useCombatReplay`'s `processedEnd = beats[beatIdx - 1]!.end`. `beatIdx`
  can outlive its beats: when a new (often **shorter**) combat's event log replaces the previous one, the
  component renders once with the **old, larger `beatIdx`** *before* the `setBeatIdx(0)` reset effect fires.
  `beats[beatIdx - 1]` is then `undefined`, `.end` throws **during render**, and — with **no error boundary** —
  React unmounts the tree and the app freezes on its last frame. It triggers specifically when **a long fight
  is followed by a shorter one** (common late game), which is why it looked random and hit deep runs.
- **How it was found:** ruled out every sim path first — fuzzed combat 120k matchups (caps ~500 events, the
  iteration guard bounds it), timed the 1000-sim odds loop (126ms even grindy), confirmed end-of-turn
  projection + `chronosRepeats` (≤3) are bounded, and `useCombatReplay` is timer-driven (no sync loop). Then
  drove the live store (`window.useGame`) to reproduce: injecting a board + End Turn surfaced the exact
  `TypeError: Cannot read properties of undefined (reading 'end')` at `useCombatReplay.ts:540`.
- **Fix:** guard the stale lookup — `beats[beatIdx - 1]?.end ?? events.length` (and the matching `?.start ?? 0`).
  The transient stale render now shows the final frame for one tick, then the reset effect lands `beatIdx = 0`
  and it re-renders cleanly. Verified live: the exact pre-fix crash sequence now logs **zero** render errors.
- **Defense in depth:** added an `ErrorBoundary` (wraps the game in `Game.tsx`). A render crash now shows a calm,
  recoverable fallback ("Try to continue" / "Reload") instead of a silently frozen app — the console had been
  explicitly flagging the missing boundary. Verified it catches a forced render error and renders the fallback.
- Typecheck + lint + 273 tests green.

### Two gameplay fixes: tavern buffs feed Fodder (Staff of Guel) + conjure spells check for triples
- **Staff of Guel now also buffs Fodder.** Its effect (`spellBuffShop`) set the run-wide tavern-buy bonus
  (`tavernBuyBonus`) but skipped Fodder — which is never *bought*, it's *eaten* — so a Demon engine got nothing
  from it. Now `spellBuffShop` also enchants the Fodder card type run-wide via `buffFodderRunWide` (same +A/+B,
  spell power folded in), exactly like Ritualist's End-of-Turn enchant: every Fodder from any source (tavern,
  Soulfeeder, conjure) carries it, Fodder already out gets it immediately, and Demons eat the bigger stats.
  To avoid double-applying on the rare *directly-bought* Fodder (cardBuff already holds the Staff buff), the
  reducer's buy path and `shopView`'s offer display both skip the `tavernBuyBonus` fold for `FD` cards. (Staff
  of Guel is the only run-wide tavern buff; Ritualist already fed Fodder — so "tavern buffs feed Fodder" holds.)
- **Conjure spells now complete triples.** The reducer's spell-cast branch returned without calling
  `checkTriples`, so a spell that *hands you minions* — Undead Army (2 copies of a random Undead), Summon Stone —
  could give you a 3rd copy that never combined into a golden. Added `checkTriples(s)` after the cast resolves
  (a no-op when there's no triple), so conjured copies combine just like a buy / play / Discover does.
- Tests: +2 (Staff of Guel → Fodder enchant + no-double-on-buy; Undead Army completing a triple). **273 green**,
  typecheck + lint clean.

### Drag feel: real "size pop" cause found (drop-slot width) + hand lift-out + quicker snap + EOT banner
- **The "cards take more space" on pick-up was real — and the cause was the drop-slot, not the lifted card.**
  Rendered shop/warband/hand cards are `.card.compact` sized to `--ccw` (`= --cw * 0.85`), but `.dropslot`
  was sized to `--cw` — i.e. **17.6% wider** (and `--ch` tall vs the card's `--ccw`-square box). So the gap that
  opens when you lift a card was a 274.5px slot replacing a 233.3px card → the center-justified row shoved the
  neighbours outward. Fixed: `.dropslot` is now `--ccw × --ccw` (`flex-basis`, `width`, `height`) with the card's
  `--arch-radius`. Verified in-page: an injected slot beside cloned compact cards now measures **233.3×233.3 ==
  the cards** (was 233.3 vs 274.5). Supersedes the prior (wrong) "no real horizontal shift" diagnosis note below.
- **Hand "ghost" gone — lifted out like shop/warband.** The dragged hand card kept a faint `dragsrc`
  `opacity: 0.3` copy in the fan, so during a hand→board drag (and especially the snap-back) you saw a dim
  "copy" *plus* the floating `.dragcard`. Now `.card.dragsrc { opacity: 0 }` — the source is fully hidden (no
  ghost) while its slot stays reserved, so the fan never reflows and the floating card is the only visible copy.
- **Snap-back is quicker.** Invalid-drop return: `.dragcard.snap` transition `0.16s → 0.1s` and the JS
  cleanup timeout `150ms → 110ms` — snappier "rejected" feedback (the delay read as sluggish).
- **"End of Turn" banner moved up off the warband.** It was `place-items: center` on a full-screen overlay →
  dead-centre, eclipsing the player's warband as end-of-turn effects resolved. Now anchored to the top `62vh`
  and centred within it, so the text lands over the shop / enemy-board region (which is closing during the
  transition anyway) and clears the warband below. Verified: text bottom 460 < warband top 630 (1352-tall vp).
- Typecheck green; verified live on the dev server (computed-style measurements + screenshots).

### Drag feel: clean the snap-back + stop the hand bobbing mid-drag
- **Snap-back** (an invalid drop returning the card to the hand) dropped the `cubic-bezier(0.34, 1.2, …)`
  overshoot — that `1.2` bounce was the "slow/janky" feel. Now `cubic-bezier(0.4, 0, 0.2, 1)` (clean ease-out).
- **Hand stops reacting mid-drag:** `.dragcard` is `pointer-events:none`, so while dragging, the cursor still
  "hovered" the hand cards underneath → they bobbed (the `:hover` `translateY` lift). `body.dragging
  .row.hand .card:hover` now holds them at rest — no bob/jitter while dragging.
- Diagnosis note: the grabbed card's slot was already fully reserved (`dragsrc` = `opacity: 0.3`, same
  size), so there was no real horizontal shift on pick-up — the "takes more space" is the lifted card going
  full-size vs its fanned/overlapped slot. Flagged for the user to confirm.

### Drag FLIP: split the easing — gentle glide while dragging, snappy settle on drop
- The during-drag side-to-side felt janky sharing one ease with the landing. `Flip.from` now branches on
  `dragRef.current?.active`: a **live drag** uses `0.25s / power2.out` (smooth side-to-side tracking under the
  cursor); a **committed change** (drop / play / buy / sell) uses `0.18s / power2.out` (snappy settle).

### Front to Back text + remove Razorscale Warlord + ease the drag FLIP
- **Front to Back** dropped the redundant "Each Front to Back you cast gives +2/+2 more" note — the grant
  already renders the live scaled value (base + escalation + per-stat spell power) in green, so the sentence
  was noise. Text is now just "Give a minion **+2/+2**" (which `spellDisplayText` substitutes with the scaled
  `{{+A/+B}}`).
- **Removed Razorscale Warlord** (`razor`, Dragon T4). Repointed its generic references: the combat tests +
  harness used it as a vanilla 4/4 → `sandbag`/`cleric`; the discover-filler → `weaver`; the Bane test's 3rd
  Battlecry minion → a 2nd `cleric` (keeps 3 battlecries → Fodder +3/+3). (The user wrote "Warden"; the card
  was "Warlord" — flagged.)
- **Eased the GSAP Flip** drag/reorder animation: `0.28s power2.out` → **`0.42s power3.out`** — gentler, less
  aggressive landing as a card settles onto the board. A one-line knob to tune further.
- 271 tests + determinism harness green; dev preview clean on HMR.

### Drag/reorder FLIP → GSAP Flip plugin (slide *during* the drag, not after the drop)
- Replaced the hand-rolled FLIP (~35 lines of manual measure/invert/CSS-transition in a `useLayoutEffect`)
  with GSAP's **Flip** plugin (already on gsap 3.15; `gsap/Flip` is free + bundled, registered once at module
  scope). `flipStateRef` holds the layout state captured before each change; `Flip.from` animates every card
  from there to its freshly-committed spot — batched reads, GPU transforms, native interruption handling.
- **Re-enabled the during-drag gap animation** (`flipKey` carries the drop-slot index again), so cards slide
  as the gap moves and a reposition resolves *while dragging* instead of snapping then animating after the
  drop (the reported "swap happens after I drop it"). The hand-rolled FLIP couldn't do this — it stormed on
  rapid gap moves (the "card dancing"); GSAP blends interruptions, so it stays smooth.
- Freshly bought/played cards pop in (cardpop) rather than sliding from nowhere (not in the prior state);
  sold cards just leave. Verified: typecheck + lint clean; `gsap/Flip` resolves at runtime (Flip.js present);
  recruit renders clean; a shop reroll runs `Flip.from` with no error or displacement. Drag *feel* is the
  user's call to confirm.

### Drop Reborn from Grave Knit
- Per the user: Grave Knit (`knit`) is no longer Reborn by default (`keywords: []`); the global death-buff
  stays. The Lantern-Reborn test now grants `['R']` inline (the other two Reborn tests already did). 271 tests.
- **Queued (design call):** if a Grave Knit is ever *granted* Reborn, the reborn copy should carry the
  accumulated death-stacks instead of resetting to printed base (current `killOrReborn` behaviour). Clean
  plan: in `killOrReborn`, after the base reset, add the combat's accumulated `cardBuffGains[cardId]` to the
  reborn copy for a death-buff card — doesn't disturb the generic "Reborn → base" path (no stacks ⇒ base).

### Fix: spell cards now reflect the per-stat spell power + wire Cinderwing art
- The spell-power rework made the bonus per-stat (`spellAttackBonus`/`spellHealthBonus` = hero amplify +
  `RunState.spellBonus`), and the cast *application* used it — but the Recruit UI still computed the spell
  card **display** off `spellStatBonus` (hero-only) and called `spellDisplayText` with 3 args (symmetric).
  So Cinderwing's +Health / Skullblade's +Attack never showed on the cards. Threaded
  `spellAttackBonus`/`spellHealthBonus` through `shopView`/`instView` + `spellDisplayText`'s 4th `bonusH`
  arg (and the useMemo deps, so the text updates when either bonus changes).
- Wired **Cinderwing Matron** art (master now provided) → `cinder.webp`.
- Verified: typecheck + lint + 271 tests; dev preview reloads clean.

### Minion batch — 4 reworks + Skullblade + 2 cuts + Bane dual-typing + a spell-power system
- **Reworked 4 existing minions** (the user's message said "updates and additions"): **Hoard Cleric**
  (`cleric`) → Dragon T3 3/4, Battlecry **+2/+3** to Dragons (was T2 1/3, +1/+1); **Cinderwing Matron**
  (`cinder`) → Dragon T4 5/5, Battlecry **+1 spell Health** (was T3 tribe buff); **Toxin Tender** (`toxin`)
  → T5 3/1, Battlecry grants Venomous to a friendly **Undead** (was any friendly); **Grave Knit** (`knit`)
  → T2 3/2, **kept Reborn**, added a global death-buff. (A first delegation mistakenly added these as
  duplicate *new* ids that collided on name with the existing cards — caught + repointed onto the originals.)
- **New: Skullblade** (Undead T3 5/1) — Deathrattle: **+1 spell Attack** for the run.
- **New spell-power channel.** There was no run-state spell power (only a hero-amplify scalar). Added
  `RunState.spellBonus {attack, health}`; `spellAttackBonus`/`spellHealthBonus` = hero amplify **+** the
  bonus; the 5 stat-granting spell factories now fold Attack/Health independently. Cinderwing bumps it at
  recruit; **Skullblade carries it back from combat** (new `CombatResult.playerSpellPower` → `settleCombat`,
  mirroring `playerHandGrants`).
- **Grave Knit's run-wide death-buff** carries a combat death back as a card-type buff
  (`CombatResult.playerCardBuffs` → `buffCardTypeRunWide('knit', +3/+2)`, a by-cardId sibling of
  `buffFodderRunWide`). Stacks per death.
- **Bane is now a proper Dragon/Demon dual-type.** A shared `isTribe(card, tribe)` (checks `tribe` +
  `CARD_INDEX[id].tribe2`, matching the existing Mech convention) gates the Demon systems — so Bane eats
  tavern Fodder (Consume) and is a valid **Corrupted Lifebinder** target (sim + the Recruit targeting UI).
- **Cut:** Rot Weaver + Webspinner Matron (the `onFriendDeathBuffRandom` primitive is kept, content-unused).
- **Art:** wired Bane + Taurus (last batch's two that were never copied into the build dir), plus Hoard
  Cleric, Skullblade, Toxin Tender, Grave Knit — masters → WebP via `npm run optimize-art` (13.4 MB → 0.36 MB).
  **Cinderwing Matron has no master** (`Ascent Art\Minions\CinderwingMatron.png` absent) → dragon sprite for now.
- 3 new factory ids (`deathrattleBuffSpellPower`, `deathrattleBuffCardTypeRunWide`, `battlecryBuffSpellPower`)
  registered in core + content. Updating the 4 cards broke 14 pre-existing tests (cleric was a heavy +1/+1
  fixture; knit's base/Reborn; toxin's any-friendly target) — all repointed to the new specs. Verified:
  typecheck + lint + **271 tests** + determinism harness.

### Drag perf, take 2 — kill the FLIP storm + cache spell-targeting hit-tests (the real fix)
- **The FLIP storm was the actual culprit** (prod stuttered identically with the earlier zoneAt cache, which
  ruled out the re-render + dev tax). The FLIP effect re-measures every shop+warband card and restarts a 0.2s
  slide on each `flipKey` change — and `flipKey` included the live drop-slot index. So dragging a card over
  the board re-ran the entire FLIP every time the gap moved, each frame interrupting the previous animation:
  this *was* the "card dancing" + the hand→board sluggishness. `flipKey` now tracks only row composition+order
  (uids); the drop slot moves **instantly** (snappy), and the FLIP animates only discrete changes
  (buy / play / sell / reposition / lift-out).
- **Spell targeting** (`boardUidAt` / `shopUidAt`) called `elementFromPoint` every frame while aiming. The
  board/shop don't shift during a spell drag (a spell opens no insertion gap), so the candidate card rects are
  cached at drag-start and hit-tested arithmetically — no per-frame layout-forcing while aiming a spell.
- Verified: typecheck + lint clean, no console errors. Combined with the earlier zoneAt-rect cache, the
  per-frame drag path no longer forces a synchronous layout (only the occasional gap-change reflow remains).

### Drag perf — hit-test cached zone rects (drop the per-frame `elementFromPoint`)
- During a drag, the zone under the pointer was found via `zoneAt` → `document.elementFromPoint`, and the
  sell/buy line via `warbandTop()` → `getBoundingClientRect` — called on **every** pointermove. Both force
  a synchronous layout, a per-frame cost behind the drag micro-stutter (worst when repositioning on the
  board). The zone *containers* hold their position during a drag (only the cards inside shift), so we now
  measure them once at drag-start and hit-test cached rects (pure arithmetic). Behaviour-equivalent — the
  floating drag card is `pointer-events: none`, so `elementFromPoint` was already returning the zone behind it.
- Remaining per-frame cost (honest): the live insertion-gap reflow (cards shifting *is* the visual feedback)
  and the React re-render. The latter is heavily inflated in dev — **StrictMode double-renders every frame**
  and the bundle is unminified — so a production build (`npm run build:web` → `npm run preview`) is the real
  test. If it still stutters there, the next lever is taking the floating-card position fully imperative
  (ref + direct transform) so a move doesn't re-render the recruit tree at all between gap/zone changes.

### Choose One is its own keyword — not a Battlecry (no Drakko / Karwind / Bane synergy)
- Playing a Choose One minion (Wildwood Shaper) and picking an option used to run through the Battlecry
  machinery: `applyChooseOne` applied `drummerRepeats` (Drakko the Drummer **doubled** the chosen effect)
  and fired `battlecryTriggered` (proccing Karwind / Bane). Choose One is its own keyword, **not** a
  Battlecry — the chosen option now resolves exactly once, with no doubling and no battlecry-triggered procs.
- `hasBattlecry` no longer counts a Choose One card, so a Choose One minion doesn't advance Drakko's quest
  or appear in Help Wanted's Discover-a-Battlecry filter. (Wildwood Shaper already had `keywords: []`, no
  Battlecry badge — so the card display was already correct.)
- Test added: with Drakko the Drummer on board, a Choose One buff lands once (+1/+1), not doubled. 258 tests.

### Card-art → WebP: 71 MB → 4.3 MB (−94%)
- The illustrated card/hero/spell art was **78 PNGs totaling 71.4 MB** (640×640 or 512×512 but poorly
  compressed — ~1 MB each). Converted all to **WebP** (downscaled to ≤512px — cards display at ~290px —
  quality 85, alpha preserved) via a new sharp-based `npm run optimize-art` (`scripts/optimize-art.mjs`):
  **71.4 MB → 4.33 MB, −93.9%** (each card ~1 MB → ~40–90 KB). The high-res masters under
  `C:\Game Assets\Ascent Art\` are untouched; the in-repo build copies are now `<id>.webp`.
- `art.ts` globs now match `*.{png,webp}` and prefer the WebP copy, so a freshly-dropped PNG still shows
  immediately and the optimizer converts it later with no rewiring. **Gotcha logged in the file:**
  `import.meta.glob`'s options must be an *inline literal* — a hoisted const fails Vite's static glob
  analysis with "Invalid glob import syntax"; `tsc` doesn't catch it (the dev server / build does), which
  the live restart-and-check surfaced.
- Verified live: dev server restarted (the eager glob re-resolves only on restart, not reload), hero-select
  renders all portraits as loaded 512×512 `.webp`, crisp at display size, no console errors. This is the
  likely fix for the "RAM feels bogged down" symptom — the browser now holds ~4 MB of art, not ~71 MB.

### Perf round 2 — rAF-throttle the drag move + dev-vs-prod guidance
- **rAF-throttle the drag:** a high-Hz pointer (120/144Hz) fires `pointermove` far more often than the
  screen repaints, and each one re-rendered Recruit (the live insertion-gap + spell-targeting line read
  `drag.x/y`, so they can't be ref'd out of React). `onMove` now stashes the latest position and schedules
  a single `requestAnimationFrame` flush — coalescing the burst into one `setDrag` per frame, capping
  re-renders at the refresh rate. The pending frame is cancelled on drag-end (effect cleanup). `onUp`
  recomputes "did it move" from the up event (a flick finished inside one frame may not have flushed
  `active` yet) so a fast drag still registers as a drop.
- **Why this is the right knob (profiling):** the per-card `Sprite` canvas only redraws inside a
  `useEffect` keyed on `[name, scale]`, so card re-renders don't repaint canvases — a drop is cheap React
  reconciliation, not paint. So I did *not* add a content-aware Card comparator (its stale-render risk
  outweighed the small gain). The remaining drag cost was purely re-render *frequency*, which the throttle caps.
- **Dev vs prod:** StrictMode double-invokes renders in dev and Vite serves an unminified bundle; the
  production build (`npm run build:web` → 135 KB gzip JS, <1s) strips both. Feel-test there (`npm run preview`
  in apps/web).
- **Flagged:** card-art PNGs are ~1.2 MB each (many) — a likely RAM/load contributor; downscale/WebP is a
  worthwhile follow-up.
- Verified: typecheck + lint clean; prod build green; Cassen counter display confirmed live ("Collision · 0/5").
  The drag itself needs a real-pointer feel-test — synthetic pointer dispatch couldn't drive React's delegated
  handler in the preview harness; the change is isolated to the move handler (drag-start untouched).

### Add Taurus the Ancient + Bane (T6 minions) + Engraved carry-back honors sc-granted EG
- **Taurus the Ancient** (Neutral T6 6/8): new `scEngraveNeighbor` Start-of-Combat factory grants the
  Engraved (EG) keyword to the minion on Taurus's **left** (golden: **both** adjacent). That neighbor then
  keeps whatever stats *it* gains in the fight — e.g. a Beast next to Taurus keeps a Grim deathrattle buff.
  The grant is combat-time (pushed onto the per-combat clone's keywords, never a `CardDef`), so it only
  sticks for fights where Taurus is adjacent at the bell. No-op if the neighbor is absent/dead/already-EG.
- **Engraved carry-back fix (the subtle part):** the EG carry-back labelled the run-board buff by
  re-checking the run-board *card's* keywords (`card.keywords.includes('EG')`) — but a Taurus neighbor's
  card has no EG (it's granted on the combat clone), so its gain was mislabelled "Flowing Monk".
  `playerPermaBuffs` now carries an `engraved` flag read off the *combat* Minion's live keywords, and
  `settleCombat` labels off that. The stats always carried back (the `if (card)` guard never gated on
  keywords); this only fixes the label. Native EG (Gnasher) + Flowing Monk paths are unchanged.
- **Bane** (Dragon/Demon dual-type T6 12/12): new `onBattlecryBuffFodder` recruit factory — every Battlecry
  you trigger permanently enchants the **Fodder** card type +1/+1 run-wide (golden +2/+2), reusing
  Ritualist's mechanism (extracted to a shared `buffFodderRunWide` helper). Fires per battlecry *fire* via
  the existing `battlecryTriggered` hook (Karwind's path), so Drakko doubling double-procs; multiple Banes
  stack. Bane has no battlecry of its own, so it never self-procs.
- New factory ids `scEngraveNeighbor` + `onBattlecryBuffFodder` registered in both `EffectFactoryId`
  (core/types.ts) and `EffectFactoryIdSchema` (content/schema.ts). Verified: typecheck + lint + 257 tests
  (8 new — Taurus left-neighbor + golden-both + non-adjacent guard + native-EG regression carry-backs;
  Bane +N/+N over N battlecries + golden + Drakko-doubled). Built by a subagent; carry-back path reviewed
  line-by-line before commit.

### Fix Cassen's in-combat Collision counter (live count + display)
- The live in-combat counter re-derived enemy kills from an enemy-uid set (initial.enemy + enemy summons),
  which could diverge from simulate's authoritative `minion.side === 'enemy'` tally on uid/reborn/summon edge
  cases. The `death` combat event now carries **`side`**, and `useCombatReplay.enemyDeaths` counts
  `side === 'enemy'` deaths directly — so the live count matches the settled total exactly (no uid-matching).
- The display used `(cassenKills + combatEnemyDeaths) % 5`, which rolled 4→0 mid-combat (the grant only fires
  at settle) and read as "wrong." Now `min(5, cassenKills + combatEnemyDeaths)`: a clean climb to **5/5**
  (grant ready), dropping to the post-grant value when settleCombat banks + grants.
- Verified: typecheck + lint + 249 tests.

### Feel pass (round 1): drag card tracks the cursor 1:1; faster landing pop
First, lowest-risk lever on the drag/buy/sell snappiness.
- **Removed the deliberate 0.08s drag "float."** `.dragcard` had `transition: transform 0.08s ease-out` —
  intentionally easing the card *after* the cursor ("floats instead of rigidly pinned"). That was the main
  "not snappy" feel. Removed it so the card tracks the cursor 1:1 (the `.snap` invalid-drop + `.magslide`
  release animations keep their own transitions, so those still animate).
- **Faster landing pop.** `cardpop` (a freshly bought/played card popping in) 0.26s → 0.15s.
- **Profiled the state-change path:** a `dispatch` is ~1.2ms (reducer + setState), so the React re-render
  isn't the obvious bottleneck — the animation timing was. (The preview's rAF is background-throttled, so
  a to-paint number isn't trustworthy there.) DRAG_THRESHOLD is already a tight 5px.
- **Next levers (pending your feel-test):** if the drag/drop still feels heavy, cap per-frame re-renders
  (rAF-throttle the move) and make a drop re-render only the changed cards (content-aware Card memo).

### Discover-queue (Yazzus → Help Wanted/Sprout, Drakko → Brian) + Hoarder triple keeps the oldest + Eyes targeting
- **Discover queue.** Discovers now QUEUE behind the open one (`RunState.discoverQueue: DiscoverSpec[]`,
  serializable — `{kind:'spell'}` or `{kind:'minion',tier,exactTier?,filter?}`) instead of overwriting.
  `queueDiscover(state, spec)` opens it or queues; the `discover` case drains the queue after each pick.
  Replaces the spell-only `pendingSpellDiscovers`. `offerDiscover`/`hasBattlecry` moved reducer→recruit so the
  import direction stays clean. Backbone for the two below.
- **Yazzus multiplies Help Wanted + Sprout** (the player-cast Discover spells) — casting them with a Yazzus out
  opens 2 (3 if golden) sequential Discovers. **Triple Reward stays single** (it's not a player-cast spell).
- **Drakko the Drummer → Black Belt Brian Discovers 2.** The drummer's Battlecry-doubling (`drummerRepeats`)
  already fired Brian's Battlecry twice, but `battlecryDiscoverSpell` *overwrote* the open Discover on the 2nd
  fire — now it queues, so Brian + Drakko opens 2 spell-Discovers (golden Brian + Drakko → 4). The drummer was
  never actually inert; its stale "deferred / no factory" comment is corrected.
- **Hoarder triple keeps the oldest copy.** `checkTriples` now sets the golden's `boughtWave` to the MIN
  (earliest) of the merged copies, so a tripled Hoarder keeps the highest sell value as its starting point.
- **Eyes of Aresmar targeting (UI).** A tier-gated spell (`targetMaxTier`) snaps back without casting if dropped
  on a >T4 minion or a tavern offer — only a valid-tier friendly *board* minion is a legal target.
- Verified: typecheck + lint + **249 tests** (7 new: Yazzus×Help-Wanted/Triple-Reward, Drakko×Brian, golden
  Brian×Drakko=4, Battlecry-fires-twice-via-drummer, Hoarder-triple-min-boughtWave).

### Fix Junkyard Titan grant doubling at combat-end + Hoarder live "Sells for X" line
- **Junkyard Titan (and any Deathrattle hand-grant) doubled at combat-end.** The combat view renders the flying
  `handGrantsShown` cards while `inCombat`, but settleCombat fires at replay-end and adds the grants to the REAL
  hand while still in the combat view — so both the real-hand copies and the flying copies showed at once (e.g.
  4 Magnetic minions read as 8). Gated the flying copies on `!run.combatSettled`, so they vanish exactly when
  the real hand receives them. (Latent for Arcane Weaver too; fixed for every Deathrattle hand-grant.)
- **Hoarder shows its live sell value.** `instView` now renders "Sells for **+N Mana** per turn you hold it.
  {{Sells for X Mana now.}}" for Hoarder, where X = `(wave − boughtWave + 1) × (golden ? 2 : 1)` — the exact
  value the sell case pays. Threaded `run.wave` into instView; golden uses an explicit `goldenText` (so the
  naive golden-text doubler doesn't double the already-scaled value — it was showing +4/turn before).
- Verified: typecheck + lint + **243 tests**; live — Hoarder reads +1/turn (non-golden) and +2/turn (golden)
  with the live "Sells for X Mana now" value.

### Tuning: Junkyard Titan → T4; Black Belt Brian golden Discovers 2 spells (a real two-pick)
- **Junkyard Titan** dropped tier 5 → **tier 4**.
- **Golden Black Belt Brian now Discovers TWO spells for real** — was a shortcut (the pick + a random spell
  added to hand). New `RunState.pendingSpellDiscovers` + an exported `offerSpellDiscover(state)` helper: golden
  Brian opens the first spell-Discover and queues one more; the reducer's `discover` case re-opens a fresh
  spell-Discover after each pick while the queue remains (base Brian still Discovers 1). goldenText →
  "Discover **2** spells."
- Verified: typecheck + lint + **243 tests** (the golden-Brian test rewritten to walk the two-pick chain).

### Three new neutral minions (Hoarder, Black Belt Brian, Yazzus) + Junkyard Titan rework
- **Junkyard Titan** (Mech T5) reworked → **"Deathrattle: Add a random Magnetic minion to your hand"** (golden:
  two). New combat factory `deathrattleGrantMagnetic` — mirrors Arcane Weaver's `deathrattleGrantSpell` (picks a
  random Magnetic-keyword minion via `ctx.rng`, grants to hand + emits the `toHand` event so the replay flies it
  over; golden grants 2 independent picks). Added a `ctx.allCards()` combat primitive so the factory enumerates
  the card pool data-drivenly. Magnetic pool (`'M'` keyword) = Cling Drone, Money Bot, Heckbinder.
- **Hoarder** (Neutral T1 1/1) — "Sells for **+1 Mana** per turn you hold it" (golden +2). `BoardCard.boughtWave`
  is stamped in the buy case; the sell case pays `(wave − boughtWave + 1) × (golden ? 2 : 1)` for a Hoarder
  instead of the flat sell value (same-turn buy+sell = 1).
- **Black Belt Brian** (Neutral T5 3/5) — "**Battlecry:** Discover a spell" (golden: the picked spell **plus** a
  second random one added to hand). New recruit factory `battlecryDiscoverSpell` — offers 3 distinct random
  spells through the existing Discover flow (which resolves a spell card straight into the hand).
- **Yazzus** (Neutral T6 6/8) — "Your spells cast **twice**" (golden: three times). New `spellCastMult(state)`
  helper (3 if a golden Yazzus is on board, 2 if a non-golden, else 1); the reducer's play-spell path resolves
  the cast that many times (the card is consumed once). Channeling the Devourer's `singleCast` is exempt (never
  multi-fires), and the Discover-spells are exempt (single pending discover). The UI fires the cast spark once
  per resolution (staggered 200 ms, via a `castSparks` helper reading `spellCastMult`) so a doubled cast visibly
  procs more than once.
- Both new factory ids registered in `EffectFactoryId` (core) + `EffectFactoryIdSchema` (content). Art wired for
  all three (Hoarder / Yazzus / Black Belt Brian — the `BlackBeltBrian.png` master existed, no fallback needed).
- Verified: typecheck + lint + **243 tests** (8 new — Hoarder sell math, Brian/golden discover, Yazzus 2×/3×,
  Junkyard Titan grant/golden/enemy-side); live — all four render with art + correct text, hand reads clean.

### Revert the hand layout (card placement broke), remove Arclight Reactor, rewire 3 spell arts
- **Reverted the hand-fan rework.** The uniform-height change (absolute drawer) + this session's raise pushed
  the hand UP into the warband drop zone on short/wide viewports — drops landed on the hand instead of the
  board (couldn't play cards) and the hand crowded the centre of the screen. Restored the original, proven CSS
  exactly (in-flow drawer, `bottom: calc(var(--bar-y) - 26px)`, hover `translateY(-5%)`): the hand sits at the
  bottom below the warband again and placement works. **Uniform-height + hover-pop is shelved** — it needs a
  compact-at-rest fan that survives a short viewport, not a raised full-text hand.
- **Removed Arclight Reactor** (`arc`, Mech T4: "when a friendly Mech Shield breaks, deal 3"). Dropped the card
  def (mechs.ts), its combat test (simulate.test.ts), and the stale tribe-blurb mention. The
  `onShieldBreakDamage` factory stays as a reusable primitive (nothing references it now, but it's harmless).
- **Rewired 3 spell arts to the v2 masters** — Eyes of Aresmar → `EyesOfAresmar2`, Growth → `Growth2`, Staff of
  Guel → `StaffOfGuel2` (copied over the in-repo build copies + downscaled to 640px).
- Verified: typecheck + lint + 235 tests (the Arclight test removed); live — hand sits at the bottom with the
  warband clear (placement restored) at both 16:9 and a wide-short viewport.

### Bug fixes: Warden opponent-pin, uncapped Mana Font, hand fan position, Cassen live counter, missing spell art
- **Next opponent no longer shifts mid-turn.** `nextOpponent` matched on the LIVE board power, so any board
  change — buying, selling, or using a Hero Power (Warden's Fortify) — re-rolled the telegraphed foe. The match
  power is now pinned at TURN START (`RunState.turnStartPower`, set in the wave advance + createRun + healed in
  deserialize), so the opponent stays fixed for the whole turn.
- **Mana Font + Nadja's Mana Font are uncapped.** Both clamped max Mana to the cap (10); now they raise it with
  no ceiling. The per-wave growth uses `Math.max(maxEmbers, min(cap, …))` so an over-cap bonus persists instead
  of being clamped away next wave; the StatusBar Mana projection got the same guard.
- **Hand cards sit above the status bar again.** The previous entry's absolute drawer collapsed each card to its
  arch height, so bottom-aligning dropped the arches behind the (z-40, bottom-pinned) status bar. Raised the hand
  zone (`bottom: calc(var(--bar-y) + var(--ch) * 0.78)`); on hover a card lifts + scales and its text drawer flips
  ABOVE the arch, so the full card reads at once.
- **Cassen's Collision counter ticks live in combat.** `useCombatReplay` now exposes `enemyDeaths` (enemy deaths
  landed up to the current beat); Recruit bridges it to the store (`combatEnemyDeaths`) and the StatusBar shows
  `(cassenKills + combatEnemyDeaths) % 5`, so the counter climbs as kills happen (cleared out of combat —
  settleCombat still banks the real total + fires the grants).
- **Wired the missing spell art** — Undead Army, Lasso, Mend (copied from the masters, downscaled to 640px).
- Verified: typecheck + lint + 236 tests (the Mana-cap tests flipped to assert the uncap); live — hand fan + the
  hover reveal, the opponent stays put through a Hero Power, dimmed picker intact. (The Cassen live tick is
  code-verified — combat wasn't driven live this pass.)

### UI/content polish: uniform hand height, Engraved text, Nadja active power, end-of-turn lock, picker backdrop
A grab-bag pass from live playtest feedback.
- **Hand cards now sit at a uniform height.** A forceFull card's text drawer was *in flow* below the fixed
  arch, so a longer drawer (e.g. Gnasher) shoved its arch upward — the hand's arches were ragged. Fix: pin
  the drawer absolutely below the arch **in the hand only** (`.row.hand .card.compact.showtext .drawer {
  position: absolute; top: 100% }`, specificity (0,6,0) to beat the base `.card.compact.showtext .drawer {
  position: relative }`). Every hand card collapses to the archbox height → arches align (verified live: both
  archboxes at y=555, 141 px tall). Drawers hang below as before (full text on hover/inspect).
- **Engraved keyword** no longer self-explains. Gnasher reads "…attacks again and gains **+5/+5**
  **Engraved**." (was "(Engraved — kept after combat)"); the keyword tooltip carries the meaning.
- **Nadja's Mana Font is a proper active power now.** It fires on click (**untargeted** — no minion to pick;
  new `HeroPower.untargeted`) and **costs 3 Mana** (new `HeroPower.cost`; the reducer gates on `embers >= cost`
  and spends it on use). StatusBar dispatches `{type:'heroPower'}` directly for untargeted powers and shows the
  cost ("Mana Font · 3 Mana" / "need 3 Mana"); the `heroPower` action's `uid` is now optional. Verified live:
  click → maxEmbers +1, embers −3, heroReady false, **no targeting line**.
- **Myra** drops the "Locked until turn 3." sentence (the picker's **UNLOCKS TURN 3** chip already says it).
- **Sporeling reworked.** Deathrattle was "+1/+1 a random friend"; now **"Give all friends +1 Attack or +1
  Health (random)"** — a new combat factory `deathrattleBuffAllRandomStat` coin-flips a stat (one flip per
  proc) and buffs every living friend by +amount of it (golden doubles the amount). The Deathsayer/Sylus/golden
  rally tests (which used Sporeling as a 1-buff-per-proc probe) updated to **procs × friends**.
- **End-of-turn action lock.** Rolling/buying/etc. was possible *while the EoT proc beats animated* before
  combat. A new store flag `endTurnAnimating` (set around the beat sequence in `Recruit.endTurn`) disables
  roll/upgrade/freeze, blocks card drags (the pick handler reads `useGame.getState().endTurnAnimating`), and
  locks the hero panel (`canHero`); a stray armed Hero Power is disarmed before the beats. Verified live: with
  the flag forced, all three controls `disabled` + the hero panel reads "spent".
- **Hero picker backdrop** is now the **board art (`/board4.png`) heavily dimmed** instead of a flat tint —
  some texture behind the panels (`.heroselect:not(.endscreen)`; the end screen keeps the flat tint, and the
  now-redundant "show only the blank board" reveal rule was dropped).
- Verified: typecheck + lint + **236 tests** (2 new Nadja hero-power tests: untargeted +1 max / −3 Mana, and a
  can't-afford no-op); live (Nadja run) — hand arches aligned, Gnasher/Myra/Nadja text correct, Nadja click
  fires, EoT controls lock, picker shows the dimmed board art.

### Hero/UI tuning: Cassen tier-cap + no-neutral + kill counter, Myra re-gated, hero-pick hides the chrome
Follow-up tuning on the hero batch + a hero-select polish (from live playtest).
- **Cassen (Collision)** — the grant is now **bound by your tavern tier** (`grantTopTypeMinion` filters
  `c.tier <= state.tier`; no T6 minion at T2 — the same cap was added to **Undead Army**'s conjure); **neutral
  no longer counts as a "type"** (`dominantBoardTribe` skips it, so a neutral-only board grants nothing); and
  the StatusBar shows the live **kills-to-go counter** (`Collision · N/5`).
- **Myra (Pulse)** re-gated to **turn 3** (`unlockWave: 3` restored); the description reads "Locked until turn 3."
- **Hero pick** now shows ONLY the blank board behind the picker — the HUD, tavern, timer, and hero panel are
  hidden until a champion is chosen (`body:has(.heroselect:not(.endscreen)) .app { visibility: hidden }` +
  reveal `[data-zone="warband"]`; the end screen, which reuses `.heroselect`, is excluded).
- Verified: typecheck + lint + **234 tests** (Myra tests moved to turn 3 + a gate test; the Cassen test now
  uses a Beast board + asserts the tier cap); live — the picker hides the chrome, board visible.
- **Still queued:** the Cassen grant should fly out of the hero panel into the hand (mirroring the mid-combat
  hand-grant flourish). The card is added + the `N/5` counter shows; the fly animation is a follow-up.

### Hero roster expansion + retheme + 3 spells (M2 content / M3 heroes)
- **9 heroes now** (was 7). Fresh art for the whole returning roster; **Oner → Indy** and **Sporen → Soren**
  (renamed id + name + art — every reference updated, no functional `oner`/`sporen` left). Two new heroes:
  **Nadja** (active *Mana Font* — press for +1 max Mana; new `gainMaxMana` power kind) and **Cassen** (passive
  *Collision* — new `collision` kind: `simulate` now returns `enemyDeaths`; `settleCombat` banks them on
  `RunState.cassenKills` and every 5 conjures a minion of the board's most-common tribe via
  `grantTopTypeMinion`, keeping the bank if the hand is full). All hero-power names/text reset to the
  canonical wording; Myra's *Pulse* drops its old turn-3 gate (now once-per-turn from turn 1).
- **Tribes Choice** is now `target: 'any'` — cast it on a tavern offer to conjure a minion of that offer's tribe.
- **3 new spells:** **Mend** (T2/4 — heal the hero 5, no overheal; `healHero`), **Undead Army** (T4/4 — conjure
  2 copies of a random Undead; `conjureTribeArmy`), **Lasso** (T3/2 — steal a random tavern minion to hand;
  `stealTavernMinion`). Spell pool 16 → 19.
- Verified: typecheck + lint + **234 tests** (new hero/spell coverage); live — every hero renders its new art
  after a dev-server restart (the `import.meta.glob` re-resolves), and the picker shows Indy/Soren/Nadja/Cassen.
  Built by a subagent to spec; lead reviewed the renames + Cassen carry-back + factories and re-ran the gate.

### Async-PvP groundwork: persist your own boards + friendly/any tavern targeting (M3)
Two framework rigs (balance/content-depth running on the side).
- **Persist your own finished-run boards into the opponent pool.** A finished run is `{ seed, heroId,
  actions }`; on game-over/victory the store re-derives its per-wave boards via `replayRun` (deterministic)
  and appends the non-empty ones to `localStorage['ascent.boards']` (FIFO-capped at 300). At startup the
  store loads them alongside the bootstrap pool (`registerOpponents([...bootstrap, ...stored])`), so future
  runs face boards you actually built. Replay-safe by construction: loaded once at startup (a static session
  pool), only *written* at run-end, never mutated mid-run. New `packages/ui/src/boardLibrary.ts`
  (`loadStoredBoards` / `saveRunBoards`). Verified live: an empty-board run to wave 8 wrote 8 valid snapshots;
  the load re-injects them next startup. This is the localStorage stand-in async-PvP later swaps for a backend.
- **Friendly/any spell targeting — `target: 'any'` can hit tavern offers.** New scope on `CardDef.target`
  (`'friendly' | 'any'`; zod + core types). **Shatter** and **Front to Back** (text says just "a minion", not
  "a *friendly* minion") are now `'any'`: drop them on a **tavern offer** to buff it before you buy. New
  `castSpellOnOffer` (recruit) runs the normal cast effects against a throwaway BoardCard built from the
  offer, then folds the net stat + added-keyword change onto the `ShopCard` (so `buy` bakes it in, like the
  Fortify hero power). UI: a `shopUidAt` drop-target helper (mirrors `boardUidAt`, excludes the pinned spell);
  `castingSpell` / `castTargetUid` / the drop handler + the offer highlight all extended to `'any'`. Verified:
  a unit test (Shatter on an offer → +2/+4 + Taunt → a 3/5 Taunt minion on buy) + the selector matches the 3
  minion offers and excludes the spell. Stat/keyword spells only; gild/devour/tribe-read stay `'friendly'`. (A
  spell that *removes* a base keyword can't subtract it from an offer — a rare edge that resolves once bought.)

### Spell/UX polish: Lantern global aura, Staff buy-buff, DS glow, live spell values, drag fix (M2)
A follow-up pass on the spell batch + VFX, driven by live-playtest feedback.
- **Divine Shield / Reborn made unmistakable.** The compact arched frame sets `box-shadow: none`, so the
  old card-level glow never rendered on resting tiles — and even fixed, a soft halo was too subtle. So a
  shielded unit now gets the full treatment: a **recoloured frame** (bright-gold art border, electric-blue
  for Reborn) + an **inner edge-glow** over the art + a strong pulsing **outer halo** (`.card.compact.dscard`,
  riding the arch) + a big **status badge** (gold shield / blue reborn icon, top-right like the Taunt ward;
  the Taunt ward slides left via `:has` when both are present). Verified live on a shielded Mech: gold frame
  (`rgb(255,210,58)`), 66px badge, and inner/outer glow all render. **Venomous** (the `V` keyword) gets the
  identical treatment in toxic **lime** — recoloured frame + inner glow + outer halo + a lime poison badge;
  a 2nd ward (e.g. Venomous + Divine Shield) stacks below the first via the `~` sibling combinator. When a
  Venomous minion **spends** its venom in combat (the `venomLost` event, already emitted by `simulate`), it
  now flashes lime + a ring puffs out, then sheds the green glow — a guarded impact-merge keeps the
  same-beat retaliation `struck` from clobbering the flourish (a death still wins). Simpler than the
  shield-break shatter. **Tuned 2026-06-22:** the pulsing halo on all three keywords is now a gentle,
  slower breath (smaller range + lower intensity) — the recoloured frame + badge carry the at-a-glance
  signal — and the late-popping `◇` (Divine-Shield break) + `♻` (Reborn) floats were removed (the
  break/reborn ring already reads on its own).
- **Lantern of Souls is now a true global Undead aura** — active in **shop offers, warband, hand, and
  combat** (was combat-only). It **scales with spell power**: base +3 Attack, with spell power folding
  +X/+X onto both stats (so +1/+1 spells → **+4/+1**). New `RunState.undeadHealthBonus`; the recruit
  `shopView`/`instView` overlay it on Undead; `simulate` applies both atk + hp (+ maxHealth) at start /
  on summon / on reborn. The card shows the live value.
- **Staff of Guel → permanent tavern-buy buff.** Was a one-shot buff to the *current* offers; now every
  minion you **buy** from the tavern (not Discovered/conjured) gets +2/+2 for the rest of the run,
  stacking + scaling with spell power. New `RunState.tavernBuyBonus`; baked on buy via `addBuff`, shown
  folded onto offers in `shopView`.
- **Live card values everywhere.** `spellDisplayText` now also renders **Front to Back**'s escalating
  grant (base + accumulated `frontToBackBonus` + spell power) and **Staff**'s spell-power-scaled value —
  threaded through `instView`/`shopView` — so a card always reads its real current value.
- **Mana Font:** raises *max* Mana only; current Mana is no longer topped up that turn.
- **Refresh:** shows **0** (and stays enabled) while free rerolls are banked.
- **Spell drag fix:** a targeted spell now only applies on an **explicit drop** onto a minion — the old
  `carryUid` auto-target silently buffed a random minion when released in empty space.
- **Hero-select** panels + the title/eyebrow above them sized up **~30%**.
- **Art "not wired"** was a stale Vite `import.meta.glob` in the running dev process (a browser reload
  doesn't re-run it) — a real process restart picks up the new spell/hero art; the build always had it.
- Verified: typecheck + lint clean, **226 tests** (Mana-Font/Staff updated for the new behaviour; Lantern
  health + spell-power scaling and Front-to-Back/Staff live display added).
- **Still queued:** the friendly/**any** tavern-targeting rule — dropping a non-"friendly" spell (Shatter,
  Front to Back) onto a tavern offer to buff it pre-buy. See roadmap.

## 2026-06-21

### 11 new spells + Drakko (7th hero) + UI polish (M2 content / M3 heroes)
A big content drop — the spell pool more than triples (5 → 16) and a quest hero lands.
- **Spells** (all art-wired): **Shatter** (T3, +2/+4 + Taunt toggle), **Tribes Choice** (T2, conjure a random
  minion of the target's tribe ≤ tavern tier), **Refreshing Texts** (T2, 2 free rerolls), **Eyes of Aresmar**
  (T6, gild a ≤T4 minion), **Mana Font** (T2, +1 max Mana permanently), **Sprout** (T1, Discover a T1), **Staff
  of Guel** (T3, +2/+2 to the whole tavern), **Summon Stone** (T1, a random T1 to hand), **Front to Back** (T4,
  +2/+2, +2/+2 more per cast this run, + spell power — linear), **Help Wanted** (T4, Discover a Battlecry
  minion), **Lantern of Souls** (T4, your Undead get +3 Attack for the rest of the game — re-applied every
  combat to current + summoned + reborn Undead).
- New spell factories (`recruit.ts`): `spellBuffTarget` gains a `toggleKeyword`; + `spellGainOfTargetTribe`,
  `spellGainRandomMinion`, `grantFreeRolls`, `gainMaxMana`, `spellBuffShop`, `spellGildTarget`,
  `spellBuffTargetEscalating`, `spellGrantTribeAttack`. New `RunState`: `freeRolls`, `frontToBackBonus`,
  `undeadAttackBonus`, `drakkoBuys`. `offerDiscover` generalized (fixed tier / card filter) for Sprout +
  Help Wanted. Lantern threads `undeadAttackBonus` into `simulate` (baked into player Undead at start + on
  summon/reborn). New `CardDef.targetMaxTier` gates Eyes' gild to ≤T4. (The core `EffectFactoryId`/`CardDef`
  TS types are a second source of truth alongside the zod schema — both updated.)
- **Drakko** (7th hero, 30 HP) — a new `quest` power: buy 5 Battlecry minions → a free **Drakko the Drummer**
  (StatusBar shows N/5).
- **UI:** removed the hero-select flavor text; **Grim** shows its *live* Deathrattle value (the printed
  "+1/+1" becomes the current "+N/+N" from the run tally, via `tallyBuffText`).
- Built by a subagent to a detailed spec, then reviewed + verified here. Verified: typecheck + lint clean;
  **224** tests (+17 for the new mechanics: Front to Back escalation, Lantern combat bonus, free rolls, Mana
  Font, Drakko quest, Eyes ≤T4 gate, Tribes Choice, Shatter toggle, Grim live text); live — app loads clean,
  flavor gone, no console errors. Art for all 12 copied + downscaled to 640px (also shrank ~16 oversized
  existing PNGs — minions art 87 → 55 MB).
- Flags: Eyes of Aresmar's ≤T4 restriction is **factory-enforced** (a >T4 pick is consumed + no-ops), not yet
  UI-gated. Tribes Choice on a neutral target conjures a neutral minion.

### Damage-dealt system + combat-flow fixes (M3 — difficulty from real boards, steps 4–5)
Real boards now hit back, the combat flow is fixed, and a finite-pool hole is closed.
- **Loss damage** = the opponent's **tavern tier + Σ(tiers of their surviving minions)** (`simulate`, new `enemyTier`
  param; a tier-4 board surviving with a T4 + T3 → 4 + 4 + 3 = 11). `faceOmen` passes the served board's tier (the
  player's tier for the procedural fallback). **Round cap** (`lossDamageCap`, run-side): 5 through wave 3, 10 through
  wave 6, 15 from wave 7.
- **Damage is dealt at the end of combat, not on shop return.** Split the post-combat reducer into `settleCombat`
  (outcome + damage, fires on `replay.done` — Resolve drops in the combat view) and `advanceCombat` (terminal check +
  next wave, on "End Combat"). `resolveCombat` settles-then-advances, so skipping the replay still applies the hit.
  New `RunState.combatSettled` + a phase-guard exception for `settleCombat`.
- **Combat-skip restart fixed.** `settleCombat` runs through the reducer's `structuredClone`, minting a new
  `lastCombat` reference; the replay hook + combat-stage effect key on it and reset → the combat replayed from the
  top (damage applied once, since settle is idempotent — hence "no extra damage"). Fix: `settleCombat` preserves the
  original `lastCombat` reference (it never changes its content).
- **Enemy death reflow fixed.** The `enemyarrive` rule was more specific than `.unit.dying` / `.unit.summoned`, so it
  overrode their collapse/expand on enemy units (the warband has no arrival rule, so it reflowed). Excluded
  dying/summoned units from the arrival rule.
- **Discover / finite-pool hole fixed (the "8 Grim").** `offerDiscover` offered cards regardless of remaining pool
  copies; picking an exhausted one gave a *free* copy beyond the stock (`takeFromPool` floors at 0). It now offers
  only cards with copies left — you can't exceed `POOL_QUANTITIES`.
- Verified: typecheck + lint clean; **207** tests (formula, round cap, `lossDamageCap`, `settleCombat`-reference,
  Discover-pool); live — Resolve drops in the combat view (30→28) with no restart (board combat: `fighting` stayed
  stable), and an enemy `.unit.dying` now resolves to `dyingcollapse`.

### Serve real player boards + opponent-intel frame (M3 — difficulty from real boards, steps 2–3)
The game now fights **real captured boards** instead of procedural omen blobs, with a telegraph of who's next.
- **Bootstrap opponent pool** (`snapshot.ts`): `buildBootstrapPool()` greedily auto-plays a fixed set of
  seeded bot runs (one per hero, for varied portraits) and captures the per-wave board each fought — real,
  buildable `BoardSnapshot`s. Deterministic (fixed seeds + seeded engine), so the pool stays *static* the way
  `OPPONENT_POOL` requires (replay-faithful). `registerOpponents()` appends to the pool, and the **store
  injects the bootstrap once at startup** — the headless harnesses + tests leave the pool empty (procedural
  baseline, zero test churn), so only the app serves real boards.
- **Serving** was already wired in `faceOmen` (`pickOpponent` → `opponentBoard`, else procedural). Extracted
  the pick into **`nextOpponent(s)`** (the board the next fight serves at the current board power, or null →
  procedural) so the opponent frame previews exactly what the fight resolves; byte-identical fallback.
- **Opponent-intel frame** (`OpponentFrame.tsx`, top-right under the tribes): the next opponent's **hero
  portrait + HP**, with **tavern tier · triples · top tribe** (`dominantTribe`) on hover. A real captured
  board when the pool matches; the threat name as a light telegraph on the procedural fallback. Recruit-phase
  only, and it firms up as you build (the match is power-based).
- Verified: typecheck + lint clean; **202** tests (a bootstrap-pool determinism test + an end-to-end
  `faceOmen`-serves-a-real-board test; the old "pool empty → omens" test kept as the headless baseline); live
  — the wave-1 enemy was a real Spare Part Drone (not an omen), and the frame showed "Oner — 30 HP, Tavern
  tier 1, 0 triples, 1 mech".
- Deferred: **persisting your own boards** into the pool — it must stay static (load-at-startup), not
  live-accumulating, or replays stop being byte-identical. Next: the **damage-dealt system** (loss damage from
  opponent tier + surviving minions) so the served boards become consequential.

### Snapshot enrichment + run-wide triples counter (M3 — difficulty from real boards, step 1)
First step of the real-player-board opponent arc: make `BoardSnapshot` a complete *opponent-intel* atom.
- **Run-wide triples counter** — new `RunState.triplesMade` (init 0), incremented in `checkTriples` each
  time a golden is formed (once per merge, including chained merges in the guard loop). It's plain run
  state, so the full-state `serialize` persists it through save/resume + replays automatically.
- **Enriched `BoardSnapshot`** (`snapshot.ts`) with the three fields the opponent frame needs that weren't
  captured: `resolve` (the run's HP at capture — full pre-combat), `tier` (tavern tier at capture), and
  `triples` (`triplesMade` at capture). `snapshotBoard` populates them; the schema stays `v: 1` (no
  snapshots are persisted yet — they're regenerated from the replay, so there's nothing to migrate).
- **`dominantTribe(snap)` helper** — the "5 undead" readout. Snapshot minions carry only `cardId`, so it
  resolves tribes via `CARD_INDEX`, counts **dual-types for both** their tribes, and returns
  `{ tribe, count }` (ties → first seen on the board) or null for an empty board. Exported via the package
  index, so the frame can call it directly.
- Verified: typecheck + lint clean; **200** tests — `triplesMade → 1` asserted on the Spirit-Pup triple
  test, a new snapshot test checks resolve/tier/triples + `dominantTribe`, and the opponent-pool test's
  hand-built snapshot literal updated for the new fields. No UI yet (the frame that reads these is step 3).
- Next in the arc: step 2 — populate the (already-present) `OPPONENT_POOL` from seeded runs via `replayRun`
  and wire `buildEnemyBoard`/`pickOpponent` to serve wave-matched real boards (procedural = thin-pool fallback).

### Remove Cleaver · Spirit-Pup triple keeps spell counter · demon-gated Fodder · buy-below-line + buy zone (M2)
- **Removed Ravenous Cleaver** (the lone default **Cleave** minion). Gone from `beasts.ts` and
  `docs/cards.csv`; the ~7 test/harness spots that used it as a generic vanilla beast now use **Alleycat**
  (its only effect is a recruit-time Battlecry — inert in combat), and the Cleave combat test keeps an
  explicit `keywords: ['C']` so the keyword + cleave logic stay covered. *Flag: no card carries Cleave by
  default now; the keyword still works on anything granted `['C']`.*
- **Tripling Spirit Pups keeps the best spell counter.** `checkTriples` now gives the golden the
  **highest `spellProgress`** of the three copies (= the lowest spells-left): a Pup 2-from-evolving merged
  with one 8-from-evolving yields a golden 2-from-evolving. (`spellProgress` counts *up* to 10, so
  max-progress = min-remaining — `Math.max(...combined.map(c => c.spellProgress ?? 0))`.) New test: 8/2/5
  → golden 8.
- **Fodder only enters the tavern with a Demon to eat it.** `injectPendingTavern` now gates on a Demon
  being on board: with one, queued Fodder is injected and immediately consumed (as before); with none, the
  Fodder is **wasted** — not added to the shop, and never stored (`pendingTavern` is always cleared). Stops
  Fodder-spawning cards from cluttering a Demon-less tavern with un-buyable garbage. The no-Demon test
  flipped to assert waste + empty `pendingTavern`.
- **Buy by dropping anywhere below the warband line.** New `inBuyRegion` mirrors `inSellRegion`: a shop
  card released *below* the warband line — the whole lower screen (warband row, the gap, or the hand) —
  buys it, instead of only a pinpoint drop on the hand zone. It resolves to `zone: 'hand'`, so the existing
  buy path (`source 'shop' && zone 'hand'`) fires and the hand glows as confirmation. Bounded by the screen
  bottom (can't go too low), just as the sell region stops at the line.
- **Buy zone box (mirror of the sell zone).** Added a `.buyzone` overlay — vertical mirror of `.sellzone`:
  bottom-anchored (`top` set inline to the warband line, `bottom: 0`), accent tint strongest at the bottom,
  dashed boundary at the **top** (the warband line), and a **"BUY" pill** at bottom-center; lights up
  (`.on`) once a shop card crosses below the line. `buyTop` is measured on shop-drag start (like `sellTop`).
- Verified: typecheck + lint clean; **199** tests (cleaver→alley swaps, fodder test flipped, +1 Spirit-Pup
  triple test); live in the dev preview — a shop card dropped 60px below the warband line bought it (hand
  `0→1`, shop `4→3`, hand glowed), and the buy-zone box renders mirroring the sell box, no console errors.

### Flowing Monk references Engraved · Beatboxer stacks Clings · Combinator nerf (M2)
- **Flowing Monk** text now references **Engraved** ("…give a random friendly minion +3/+3 (Engraved —
  kept after combat)"). Its gift was already permanent; the text just didn't say so.
- **Beatboxer counts toward Cling stacking** — its mimicked Cling copies are magnetizations too, so each
  bumps the Cling Drone improvement. Cling-stacking now routes through `weldMagnetic` (host weld + each
  Beatboxer copy, ×golden) so it's counted in one place; the separate caller increments were removed. A
  golden Beatboxer's two copies both stack.
- **Combinator nerf** — golden now scales the **number of Mechs** (1 → 2), not Clings-per-Mech: non-golden
  magnetizes 1 Cling onto 1 Mech, golden onto 2 (was: 1 Cling onto 2 Mechs, golden 2 Clings onto 2).
- Verified: typecheck + lint clean; **198** tests (Combinator tests updated for the nerf + 2 new Beatboxer
  cling-stacking tests); live (Flowing Monk renders the Engraved reference).

### Grim → +1/+1 per Deathrattle triggered this game (M2)
Grim's Deathrattle now scales: your Beasts get **+1/+1 for each Deathrattle triggered this game**
(whole-run), instead of a flat +6/+6. A run-wide counter (`RunState.deathrattlesTriggered`) tallies your
Deathrattles as they fire and persists across fights (accumulated in `advanceAfterCombat` from each
combat's `playerDeathrattles`); it's threaded into `simulate` as a base, and Grim snapshots the live total
(base + this fight's player Deathrattles, including its own death) when it dies, registering a +X/+X
rest-of-combat aura. New factory `deathrattleBuffTribeByTally` + `ctx.deathrattleTally()`. Golden = +2/+2
per Deathrattle. Verified: tests (run-wide base 5 + Grim → +6/+6; the 4 existing Grim-buff tests updated
to the new scaling); live (base 4 + Grim → +5/+5). *Flag: scales hard late-run — tunable via `per`/a cap.*

### Blaster blast VFX + Taunt, Cling Drone escalation, revert to procedural omens (M2 / M3)
- **Blaster** gained **Taunt**, and its Deathrattle now fires **purple blast bolts** at everything it
  hits: the replay detects a Blaster `death` event (via a uid→cardId map) and shoots a `.proj.blast`
  bolt from the dying Blaster to each AOE-damaged target in that beat — parallel to the SC-bolt path,
  styled purple (`kind: 'blast'`). Verified live: bolts render (up to 6 at once), no console errors.
- **Cling Drones improve +1/+1 per magnetization** — a persistent `cling` run enchantment
  (`improveClingDrones`, modeled on Ritualist's Fodder): each Cling welded bumps it +1/+1 and grows any
  Clings already in hand / on board; future Clings (shop or Combinator) carry it. **Combinator** welds
  Clings at their enchanted stats and scales the enchantment by however many it welds, so a Combinator
  board ramps Clings fast (the "scales with Combinator procs").
- **Reverted to procedural omens for every wave** — `OPPONENT_POOL` is now empty, so `pickOpponent`
  returns null and `faceOmen` always falls back to `buildEnemyBoard`. The step-4 seam stays intact;
  real boards return by populating the pool (the board library, soon).
- Verified: typecheck + lint clean; **195** tests (added Cling enchantment ×2; updated the step-4 +
  Gnasher-damage tests); live (blast bolts render).

### Engraved keyword + 4 new cards + tier-gated spell offers (M2)
- **Engraved (keyword `EG`)** — a minion with Engraved keeps the stat gains it accrues in combat: every
  `ctx.buff` on it accumulates into `permaGain`, which the run loop carries back to the board after the
  fight. Generalizes Flowing Monk's permanent gift (the Monk now records `permaGain` only for its
  *non*-Engraved recipients, since `ctx.buff` already accrues it for Engraved ones). Carry-back is
  labelled "Engraved" (vs "Flowing Monk" for the Monk's own gift). UI: pill + anvil glyph.
- **Gnasher → T6**, now **Engraved** with an on-kill **+5/+5** (`onKillBuffSelf`, fired by the existing
  `onKill` event) — it snowballs permanently as "the Overrun." (Side effect of Engraved: *all* of
  Gnasher's combat gains persist, not only the on-kill — deliberate, easy to narrow later.)
- **4 new cards** (+ art): **Beatboxer** (T6 Mech 8/8) mimics every magnetization that lands on another
  unit — the player's magnetic-drop (reducer) and Combinator's weld (recruit) now both route through a
  new `weldMagnetic(state, host, mag)` helper that also mirrors onto any Beatboxer (golden = 2×; a weld
  directly onto a Beatboxer counts once). **Blaster** (T4 6/3) Deathrattle deals 3 to ALL minions on both
  sides (`deathrattleDamageAll`). **Jenkins & Fi** (T5 3/2) Deathrattle destroys the killer — `killOrReborn`
  + the `onDeath` event now thread the `killer` (the source of the lethal hit) → `deathrattleDestroyKiller`.
  **Venom** (T3 1/1 Venomous).
- **Omega Bulwark removed** (its `scGrantShieldTribe` primitive is kept but now unused — a future Mech
  shield-wall card can reuse it). **Selfless Sentinel** art re-wired — the previous file was corrupt;
  re-copied clean from source (renders correctly now).
- **Spell offers respect the tavern tier** — `drawSpellId` filters `SPELL_CARDS` to `tier ≤ tavern tier`,
  so a T2 shop no longer offers the T5 Devourer (now gated like minions).
- Verified: typecheck + lint clean; **193** tests (added Engraved/Gnasher, Blaster, Jenkins, Beatboxer ×3,
  spell tier-gate); live on a fresh build — all five arts render (incl. the Selfless fix), Engraved +
  Venomous pills show, Gnasher/Beatboxer/Blaster/Jenkins read T6/T6/T4/T5.

### Step 4 — serve real opponent boards + Grim persistent aura + board4 (M3 / M2)
- **Serve real boards (M3 step 4)** — new `packages/sim/opponents.ts`: a STATIC, versioned `OPPONENT_POOL`
  of `BoardSnapshot`s + `pickOpponent(wave, power, rng)` (matches by wave ±1, then closest power within a
  tolerance; returns null → procedural fallback, so a thin pool degrades gracefully). `faceOmen` now serves
  a strength-matched real board when one exists, else the procedural threat — getting us off the random
  `omen` blobs for matched waves. The static pool keeps opponent selection deterministic / replay-faithful
  (a live pool would break byte-identical replays); the board library grows it in batches. Seeded with
  bootstrap real-card boards (waves 2–5). `pickOpponent` consumes the rng only when it serves, so an
  empty/no-match pool leaves the procedural board byte-identical.
- **Grim → persistent aura** — `deathrattleBuffTribe` registers a rest-of-combat tribe aura
  (`ctx.addTribeAura`) that the summon path applies to every matching friend summoned *afterward*, so a
  Beast summoned post-Grim also gains +6/+6 (Reborn-safe; multiple Grims stack). The card text already
  said "for the rest of combat" — the code now matches it.
- **board4** wired as the board background (`apps/web/public/board4.png` + the `.app` CSS), as a swap-test.
- Verified: tests (Grim aura isolation — Pups summoned after Grim still get +6/+6; `pickOpponent` matching
  + `faceOmen` serving real cards); live (board4 renders; the Grim/opponent logic is engine-tested).

### Golden Corrupted Lifebinder mirrors double its partner (M2)
A golden (tripled / Gilded) Corrupted Lifebinder now gains **2×** its linked demon's stat gains, in
both phases: recruit (`syncLifebinders` — `linkApplied` tracks the mirrored magnitude, so flipping to
golden mid-link tops it up to 2×) and combat (`mirrorLink` doubles the buff when the Lifebinder is
golden). Tests: a golden Lifebinder mirrors a +1/+1 Fortify as +2/+2 (recruit) and Grim's +6/+6 as
+12/+12 (combat). **185** tests pass; typecheck + lint clean.

### Content + combat + UX batch — spells, hero-power triples, juice, cursors, art (M2)
A large multi-session batch, committed together. Highlights by area:

**Spells & the cast system.** A spell-power-aware cast pipeline (`castSpell` → `applyCastEffects`
iterating `cast` effects; `spellStatBonus` amplifies stat grants — e.g. the Spellbinder hero). Two new
spells: **Growth** (T4 neutral, +3/+4 to your whole board, **scales with spell power**) and
**Channeling the Devourer** (T5 neutral, `singleCast`: devour a targeted friendly minion and transfer
its full stats to a random *other* friend, animated as a GSAP stat-projectile). The `singleCast` flag
(schema + `CardDef` + the cast factory) blocks spell-quantity multipliers from double-firing the
devour. **Spirit Fire** retuned to T2 +4/+4. Display text substitutes the spell-power-boosted "+A/+B"
with a highlight (`spellBuffAll` now included alongside `spellBuffTarget`).

**Triples after hero powers (bug fix).** Every card-adding path (`buy` / `play` / `chooseOne` /
`battlecryTarget` / `discover`) ran `checkTriples`, but the `heroPower` case did not — so Myra's
Encore summoning a 3rd Stray (a replayed Alleycat Battlecry) never combined into a golden. Added
`checkTriples` to the heroPower case; safe because `replayBattlecry` / `replayEndOfTurn` resolve with
an auto-target fallback and never leave a pending pick. Regression test added (`run.test.ts`).

**Combat rules & juice.** 0-Attack units skip their attack (no dead swing) and Attack now clamps at 0
(no negatives). **GSAP attack lunge** — wind-up → strike (`power3.in`) → defender knockback → elastic
settle, with GSAP owning the attacker transform so React never fights it. **Flowing Monk's** mid-combat
+X/+X gifts are now permanent (carried back to the run board as a tracked buff). **Death reflow**
reworked from a two-phase JS FLIP (death pop one beat, slide the next — read as janky) to a single
synchronized CSS slot-collapse: the dying `.unit` collapses its own flex slot (width→0; a −22px end
margin swallows one row-gap so the eventual unmount doesn't snap) *as* it plays the death pop, so the
survivors glide into the gap in one phase. Verified smooth with an `offsetLeft` sampler (max ~21px /
frame, zero >40px jumps; the old behaviour snapped ~125px). Reborn-safe — a reborning minion emits
only `reborn`, never `death`, so it never gets the collapsing class.

**UI/UX.** Round timer reworked: **18s on wave 1, +4s/round, cap 80**. End screen gained the **hero
portrait** + right-click/hover board **inspect**. Cursor fixes: hero-select flicker, and the
end-screen cards + Play-Again button now use the **gauntlet cursors** (they were pinned to the OS
`default` / `pointer`). Top-UI **tooltip z-index** (tips no longer hide behind elements); the hero
panel no longer shrinks on power-select (larger art); a more detailed **procs log** (Echo Warden impact
attributed); the **warband holds its position shop→combat** (the rope no longer pushes it down; rope
re-centered); hand cards sit a bit lower.

**Maw of the Pit** reworked → "at the end of your turn, add a Fodder to the next refresh."

**Content removals/renames.** Removed Ghastweaver, Plaguebringer, Bristleback Matron, Ravening
Glutton; Pack Scrounger → **Mama Pup**.

**Art wired.** Mama Pup, Omega Bulwark, Maw, **Gnasher** (`gnash`), **Karwind** re-pointed to the new
**Karwind2**, Growth, Devourer (+ pup / pup2 / junk / selfless / pack variants).

**Tooling.** Added **GSAP** (`gsap` 3.x) to `@game/ui`. Added **context7** as a project MCP server
(`.mcp.json`, hosted HTTP transport) for up-to-date library docs.

Verified: typecheck + lint clean; **183** tests pass (incl. the new hero-power-triple regression); live
— end-screen cursors (computed-style), gnash + Karwind2 art rendering, the reflow `offsetLeft` sampler,
and both new spells casting correctly.

## 2026-06-20

### Board snapshot + replay pipeline (M3 — difficulty learns from real boards · step 2)
The capture foundation for the player-board → async-PvP arc:
- **`@game/sim/snapshot.ts`** — a serializable **`BoardSnapshot`** (the fought board as a clean
  `BoardMinion[]` + wave / hero / tribes / threat / result / Σpower / seed; run-specific instance refs
  dropped, so it drops straight into `simulate` as a strength-matched enemy), `snapshotBoard(run)` to
  extract it, a **`Replay`** = `(seed, heroId, action-log)`, and **`replayRun(replay)`** which re-runs
  the log deterministically and yields the per-wave snapshots. The engine is fully seeded, so a whole
  run is **~1 KB** (not a board dump) and replays byte-identically.
- **Store** — records the run's action log (`replayActions`, reset per run) + **`exportReplay()`**
  (DEV: grab a real run via `useGame.getState().exportReplay()`). Verified live: 3 actions → a 117-byte
  replay.
- **`npm run replay`** (replay-harness.ts) — records a bot run → replays it → verifies it's
  byte-identical → dumps the per-wave board snapshots. Faithful across seeds (1.1–1.6 KB replays).
- Tests: `snapshot.test.ts` (round-trip fidelity + determinism). typecheck + lint clean; **179** pass.
- *Next:* step 3 — the board library (persist + index by wave/power/tribe + a `pickOpponent` query).

### Compact "Pixel Arena" card overhaul — arched frame + text drawer (M1/M2 UI)
A full pass on card presence (the player loved the direction; locked in). Every card is now one
universal **arched frame** with a `density` model instead of the old always-on rectangle:
- **Compact at rest** (shop / board / combat): a shrunk (`--ccw` = 0.85×`--cw`), arch-shaped art tile —
  the sprite fills an arched frame (tribe-coloured border + gold inner line) in a fixed-square
  `.archbox`, with gold-set circular attack/health badges in the corners, the tier pill on top, and a
  **mechanic medallion** (the card's primary keyword/trigger glyph) eclipsing the arch base. Name,
  pills, rules text and the flat minion cost are all gone at rest.
- **Full = arch + drop-down text drawer**: on hover (the reveal popup), in hand, on right-click inspect,
  or with the always-on-text setting, a text drawer (name → pills → rules text → tribe) drops down from
  the frame. Right-click always shows the full card regardless of the compact setting. Combat cards are
  the same size as the shop (the `.unit` wrapper was stretching them to full height — fixed).
- **Glyph set completed** (all 13 keywords have an SVG) and consolidated; the hover reveal shows the
  full card + any referenced cards trailing to its right. An Esc-menu **Compact / Full-text toggle**.
- **Dual-type** frames now split tribe1→tribe2 as a gradient arch border (the old squared rim is gone).
  **Spell** label is a readable white banner. **Golden/tripled** cards get a gold arch frame + crown
  emblem (easy to pinpoint in a row, not loud). **Discover** panel is transparent with arched cards.
- **End-of-run screen** scaled ~2.5× with single-row pips + warband (no wrap).
- New **Spirit Pup / Worgen** art rewired.
- Verified live across shop / hover / hand / inspect / combat / discover / end-screen; typecheck + lint
  clean. (A few transient `<Card>` console errors during editing were intermediate-HMR / synthetic-test
  artifacts — a clean reload renders with zero errors.)

### Balance tooling — enemy + player difficulty curves (M2)
Two headless analysis tools (deterministic, re-run after any tuning):
- **`npm run curve`** (`enemy-curve.ts`) — per-wave enemy board power Σ(atk+hp), width, unit stats, the
  narrow→wide threat-power spread, and a fixed reference board's win%. Found: power is ~linear (4→255
  over w1–20), a sharp **wave-6 wall** (power 45→75, ref win% 56%→23%), discrete +1-unit steps at
  w6/12/18, and ~4× threat variance (Glass ≫ Venom).
- **`npm run player`** (`player-curve.ts`) — a competent-but-naive greedy bot (best buy, tavern-up,
  sell-up, Hero Power; no synergy/triples) plays full runs × all heroes; snapshots the board it fought
  each wave + outcome, printed against the enemy curve. Found: naive play floors at ~wave 9.3, bleeds
  the early game (win% 7–31%, 0% at w6), and the late game is survivorship. A floor, not the ceiling —
  motivates the replay tool for real human curves.

### Direction set: PvE/PvP difficulty learns from real player boards
North star recorded in the roadmap: capture player boards → a strength-indexed library → serve them as
strength-matched enemies (procedural threats become the bootstrap/fallback) → **async PvP** (every wave
a friend's snapshot; win = 10–15 wins without dying; tiny shared backend). This **demotes manual
counter-matrix tuning** — captured boards drive difficulty; the curve tools become its validation harness.

### Spirit Worgen procs in combat too + spell-pool target set to ~40
- **Worgen combat proc.** The Worgen's "+X/+X per Beast/Dragon summoned" was **recruit-only**; now it
  also fires **mid-fight** when a friendly Beast/Dragon is summoned (deathrattle tokens, etc.). Added a
  **combat-side `summonBuffSelfTribe`** factory in `@game/core` (the same effect id already had a
  recruit factory — so the one card def fires in both phases). X = `1 + spellsThisTurn`, threaded into
  combat via a new optional `simulate(..., spellsThisTurn = 0)` param + `CombatContext.spellsThisTurn`
  (frozen at combat start; faceOmen passes `s.spellsThisTurn`). The combat gains are **temporary** —
  combat is a simulation, so they never touch the run board and the Worgen is back to its recruit stats
  next shop. Interpreted the user's "reset back to 1/1" as "back to its recruit-phase stats" (flagged to
  confirm). The eventual T6 ("adjacent units keep combat buffs") will be what carries these back.
- **Spell-pool target: ~40** (was 3). Recorded in `card-audit` (a `need` column for spells) + the
  roadmap — spells are a core pillar feeding the Pup/Worgen + Rohan archetype, so the pool wants depth
  across tiers.
- Verified: `typecheck` + `lint` clean, `test` **176** pass (+3: combat proc scales +5/+5 with 4 spells
  / +1/+1 with none, and the gain is temporary — run board unchanged after combat); determinism harness
  OK (existing callers default `spellsThisTurn` to 0). *(Live check skipped — it's a combat-internal
  effect the buff-event tests cover directly; the dev server was down with the user away.)*

## 2026-06-19

### Lifebinder mirrors End-of-Turn gains before combat + Spirit Worgen reworked to per-turn scaling
Two fixes from playtest feedback:
- **Corrupted Lifebinder timing bug.** A Lifebinder bound to a minion that an **End-of-Turn** effect
  buffs (e.g. Combinator magnetizing onto a Demon/Mech) didn't mirror the gain until the *next* turn —
  so it fought that combat without it. Root cause: `syncLifebinders` only ran in the reduce wrapper,
  *after* `faceOmen` had already snapshotted the combat board. Fix: call `syncLifebinders(s)` inside
  `faceOmen` right after `applyEndOfTurn`, before the snapshot. Now the mirrored gain is in the board
  the Lifebinder fights with. (Regression test: Ritualist EoT buffs a linked Fred → the Lifebinder is
  +1 in `lastCombat.initial`.)
- **Spirit Worgen reworked: per-turn, not per-game** (the old all-game spell buff was too strong, per
  the user). New text: **"Gains +X/+X each time you summon a Beast or Dragon — improves per spell cast
  this turn,"** where **X = 1 + spells cast this turn**. So cast 4 spells then play an Alleycat (it +
  its Stray = 2 Beast summons) → +10/+10. New `RunState.spellsThisTurn` (incremented on cast, reset each
  wave) drives it; `summonBuffSelfTribe` now scales with it, the transform no longer applies a
  retroactive buff (it just keeps the Pup's stats), and the card shows its **current** +X/+X live
  (`summonScalingText`, green). The Pup's "10 spells → transform" countdown is unchanged.
- Verified: `typecheck` + `lint` clean, `test` **174** pass (Worgen suite rewritten: scales with
  spells-this-turn, the Alleycat+Stray = +10/+10 case, resets each wave, ignores neutrals; + the
  Lifebinder timing test). Live: the Worgen reads "+1/+1" → "+5/+5" after 4 spells, and a played Dragon
  took it 4/6 → 9/11.

### New minion: Spirit Pup → Spirit Worgen (a transform card + spell payoff)
First **transform** card, and a meaty spell-synergy build-around (Beast pool 8→9).
- **Spirit Pup** (T5 **Beast/Dragon**, 4/6): cast **10 spells with it on board** to transform into the
  Spirit Worgen. A new per-instance counter (`BoardCard.spellProgress`) ticks on each `spellCast`
  while the Pup is on the board; the card text shows a live **"N to go"** countdown (green, via the new
  `transformProgressText`).
- **Spirit Worgen** (T5 Beast/Dragon): **keeps the Pup's stats** at transform (only the cardId swaps →
  new art + effects), and **gains +1/+1 per Beast or Dragon summoned** *and* **+1/+1 per spell cast this
  game**. The spell buff is **retroactive** — at transform it applies the *global* all-game spell tally
  (e.g. 3 spells before the Pup + 10 with it → +13/+13), not just the 10 toward the transform; then it
  keeps climbing +1/+1 per future spell. (It's a non-buyable `token: true` card — obtained only via the
  Pup — so it stays out of the shop pool while living in `CARD_INDEX` for the transform + its art.)
- **New reusable primitives:** `spellCastTransform` (tick → transform at a threshold, keeping stats +
  applying a retroactive per-spell buff), `spellCastBuffSelf` (+atk/+hp per spell), `summonBuffSelfTribe`
  (+atk/+hp when a friendly minion of given tribes is summoned). Added to `EffectFactoryId` + the zod
  enum. Art wired (`spiritpup.png` / `spiritworgen.png`).
- Judgement calls (flag if any should change): the Worgen's base 4/6 is just the schema floor (it keeps
  the instance stats); **"summoned" counts recruit-phase plays/token-summons** (so the buff is permanent),
  not combat summons; the Pup only counts spells cast while on the **board** (not in hand).
- Verified: `typecheck` + `lint` clean, `test` **172** pass (+4: transforms at 10 keeping stats +
  retroactive; retroactive counts all-game spells; Worgen +1/+1 per spell; +1/+1 per Beast/Dragon, not
  neutral). Live (fresh server re-globs the art): the Pup shows "10 → 5 to go" as spells cast, then
  transforms into the 14/16 Worgen with its art + dual-tribe footer.

### End-of-run screen (final board + W-L-W summary) + hero choices 3→2 + Sporen verified
- **End screen.** `GameOver` + `Victory` are unified into one **`EndScreen`** styled like the hero
  picker: the outcome title (gold "VICTORY" / red "FALLEN"), a round-by-round **W-L-W** pip strip, the
  **final warband** (the real Cards, shrunk via `zoom`), and **Play Again** (→ picker). New
  `RunState.history: CombatOutcome[]` records every combat's result in `advanceAfterCombat`; the pips
  read it (green W / red L / grey D). Verified live both ways (FALLEN wave 8 with "WWLWWLWL"; VICTORY
  "Survived all 20 waves", gold title).
- **Hero picker offers 2** now (was 3) — `HERO_SELECT_COUNT`.
- **Sporen ("Reclaim") — investigated, it works.** Confirmed end-to-end that the marked minion is
  destroyed at start of combat (Deathrattle fires) and an **exact copy is resummoned when there's
  room** — proven by a live combat (the resummoned Pack Scrounger 20/39 stood on the board beside its
  2 Pups) and the sim across every board state. The one no-copy case is a **full board**: the freed
  slot goes to a summoned token (precedence, as specced), so no room for the copy. Locked it with two
  regression tests (vanilla-with-room → 1 copy; full-board → 0 copies, a Pup takes the slot). No sim
  change was needed. *(The blank-screen / `<Recruit>` errors seen while probing were my forced
  mid-combat `setState`, not a real bug.)*
- Verified: `typecheck` + `lint` clean, `test` **168** pass (+2 Sporen regression). Live: end screen
  both outcomes, 2-hero picker, clean normal flow.

### Echo Warden works for *any* summon (moved to the summon chokepoint) + per-unit "copy"
- **Text:** "In combat, your summon effects **summon 1 more copy**" (golden: 2 more copies) — was
  "make 1 more **token**".
- **Now general, not token-only.** The echo moved from being read inside specific token-summon
  factories (`deathrattleSummon`, Brood Matron's `onFriendDeathSummon`) into the **single summon
  chokepoint** — a new `summonMinion()` in `simulate()`. So *every* combat summon is echoed, including
  non-token ones like `deathrattleFillTribe` (which summons real minions and was previously ignored),
  and any future summon effect — automatically. Recursion-guarded by an `isEcho` flag so the copies
  don't echo themselves; respects the board cap. Removed the now-unused `echoBonus` helper + the
  per-factory coupling.
- **Semantics: additive → per-unit.** Each summoned *unit* now gets one more copy per living Echo
  Warden (golden = 2), rather than "+1 token per effect". So Pack Scrounger (2 Pups) + one Echo Warden
  is now **4 Pups** (was 3), and **6** with a golden Echo (was 4) — i.e. "echo each summon", matching
  "any unit summoned → 1 more copy". *Flag:* this is a real buff to Echo-Warden summon boards.
- **Boundary:** this covers minion **summon effects** (the `ctx.summon` path). Sporen's hero-power
  start-of-combat resummon uses a separate copy path and isn't echoed — a sensible line (it's a hero
  power, not a summon effect), easy to include later if wanted.
- Verified: `typecheck` + `lint` clean, `test` **166** pass (the two Echo tests updated to 4 / 6),
  determinism harness OK; live a staged Pack Scrounger + Echo Warden produced **4 Pups** and the card
  reads the new text.

### Heroes named + all six portraits wired
The three placeholder heroes got real names and the full roster got art:
- **Renames:** "The Warden" → **Warden**; the resummon/Deathrattle hero (`reclaimer`) → **Sporen**; the
  spell-amplify hero (`spellbinder`) → **Rohan**; the End-of-Turn hero (`dusk`) → **Djinn**. The three
  new heroes' **ids were aligned to the names** (`reclaimer→sporen`, `spellbinder→rohan`, `dusk→djinn`)
  since they were placeholders — contained to `heroes.ts` + `run.test.ts` (the UI reads `heroId` via
  `getHero`, no hardcoded ids). Gendered pronouns in two blurbs were neutralized (names' intent unknown).
- **Art:** all six source portraits (`Warden/Oner/Myra/Rohan/Djinn/Sporen.png`) are now wired — the new
  three copied to `art/heroes/{rohan,djinn,sporen}.png` and downscaled to 640px. The picker + HUD show
  real portraits for every hero (no more anvil fallback).
- Verified: `typecheck` + `lint` clean, `test` **166** pass; live (fresh server so Vite re-globs the
  art) all six render with correct names + portraits.

### Card-spread audit tool (`npm run audit`)
A re-runnable tally of the buyable minion pool by tribe × tier (+ spells), vs the target of **13–15
minions per tribe** across the 6 tiers, weighted toward tiers 3–5 (`packages/tools/src/card-audit.ts`).
**Design intent (per the user):** the pool stays deliberately tight — run-to-run variety + complexity
come from the **meta layer (heroes + quests/trinkets)**, not pool size. A small curated set is cheaper
to balance and makes each card matter. Current snapshot: **47 buyable minions** — Beast 8, Dragon 6,
Undead 8, Mech 8, Demon 8, Neutral 9 — so each tribe is **+4 to +7 short** of 13 (≈ +33 to reach ~84
total). Aggregate tier shape already skews mid (T1 6 · T2 9 · T3 7 · T4 10 · T5 10 · T6 5) but is thin
per-cell, with two holes: **Dragon T5 = 0** and **Neutral T6 = 0**. Spells: 3, all T1. The tool's
`need` column shows each tribe's gap; re-run as the set grows.

### Spell cards show their real value (modifiers reflected) — one source of truth
Spell cards now display their *effective* stat value, not the printed base — so as the Spellbinder on
turn 1, Spirit Fire reads **+4/+4** (green), and a cast grants exactly that. Wired for the cards that
will buff spells later:
- **`spellStatBonus(state)`** (new, `@game/sim`) is the single source of truth for the +X/+X bonus to
  stat-granting spells, summing all active sources (the Spellbinder hero now; spell-buff cards just
  fold in here). The reducer's `spellBuffTarget` applies it (replacing the old inline hero check), and
  the UI reads the *same* function — so the displayed number always equals what a cast actually does.
- **`spellDisplayText(cardId, bonus)`** (new) returns the spell's text with its `+A/+B` substituted to
  the effective value and highlighted green via `{{…}}` (the existing `.descup` treatment). The tavern
  spell slot (`shopView`) and held spells (`instView`) both run it; non-stat spells (Mana Pouch) and a
  zero bonus pass through unchanged. Convention: a stat spell's text shows its value as `+A/+B` matching
  its `spellBuffTarget` params so it can be substituted.
- Verified: `typecheck` + `lint` clean, `test` **166** pass (+3: `spellStatBonus` per hero/wave,
  `spellDisplayText` substitution incl. the non-stat + no-bonus cases, and that the shown value equals
  the cast result). Live: as the Spellbinder, the tavern Spirit Fire renders "+4/+4" in green.

### Three new heroes (placeholder names): The Reclaimer, The Spellbinder, Dusk
Added the three spec'd heroes — names are **placeholders**, rename freely. Each needed a different
piece of new plumbing, all now reusable:
- **The Reclaimer — "Reclaim" (once per turn):** mark a friendly board minion; at the **start of
  combat** it's destroyed (its Deathrattle fires) and an **exact copy** (stats + granted keywords +
  golden) is resummoned if there's room. This is the first hero power that drives the **pure combat
  simulator**: a `resummon` mark on `BoardCard` → `BoardMinion` → `Minion` (via `instantiate`), and a
  new start-of-combat step in `simulate()` that force-kills the marked minion (skips Reborn so the
  Deathrattle actually fires), then resummons an exact copy if `living(player) < 7`. The mark is a
  per-turn choice (cleared in `advanceAfterCombat`); the copy is combat-only (the recruit board is
  untouched, as always). Runs *before* the normal Start-of-Combat effects so the copy + any tokens
  take part.
- **The Spellbinder — "Attunement" (passive):** stat-granting spells give **+X/+X more**, X starting
  at 1 and rising every 3 turns (`spellAmplifyBonus`). First **passive** hero — new `HeroPower.passive`
  flag; the StatusBar shows it (with the live bonus) but never arms it, and the panel uses a neutral
  `passive` style instead of the greyed "spent" look. The effect hooks `spellBuffTarget` (so it covers
  both player- and minion-cast stat spells; non-stat spells like Mana Pouch are untouched).
- **Dusk — "Cadence" (once per turn):** proc a friendly minion's **End of Turn** effect now — a near-
  clone of Myra's Encore, applied to `endOfTurn` effects (`replayEndOfTurn`, honoring Chronos repeats).
- **Hero-select now shows a random 3 of 6** (the subset behavior that was waiting on >3 heroes).
- Judgement calls (flag if any should change): Reclaimer + Dusk are once-per-turn (re-choose each turn);
  Reclaim forces a true death past Reborn so the Deathrattle fires; "when you have space" = combat board
  < 7 after the Deathrattle resolves; the resummoned copy is ephemeral (no carry-back). Spellbinder's
  scaling (`1 + floor((wave-1)/3)`) is a starting dial.
- Verified: `typecheck` + `lint` clean, `test` **163** pass (+6: Dusk procs/locks, Spellbinder amplify
  + scaling + hero-gating, Reclaimer mark + carry-into-combat, and a core `simulate` test for the
  destroy→Deathrattle→exact-copy). Live: picker shows 3-of-6 (new heroes use the anvil fallback — **no
  portrait art yet**); HUD shows Reclaim/Cadence "once per turn", Spellbinder "Attunement · +1/+1
  spells" (passive, not armable).

### PvE win condition (survive wave 20 → Victory) + Start Over + clock waits for hero select
- **Win condition (bounded PvE).** `CONFIG.maxWave` (20). Surviving the final wave ends the run in a
  new **`victory`** phase (the run doesn't advance past it); losing — Resolve hitting 0 — is still
  `gameover`. A new **Victory screen** (celebratory gold "VICTORY", "Waves Survived", a **Play Again**
  button → the hero picker) layers on like the game-over screen. This bounds what CLAUDE.md framed as
  an "endless" climb for the current PvE iteration; `maxWave` is a dial that will likely move to a
  per-mode config once PvE/PvP modes land.
- **Start Over** in the Esc menu — a red-tinted action under a new "Run" section that abandons the
  current run and reopens the hero picker (`startHeroSelect`).
- **The round clock waits for hero select.** The timer no longer ticks behind the picker — it's
  frozen (and reset to full) while `heroChoices` is set, so wave 1 begins at full time the *moment*
  a hero is chosen (also fixes the edge where dying on wave 1 + re-picking could start the new run on
  a near-zero clock).
- Verified: `typecheck` + `lint` clean, `test` **157** pass (+3: victory at maxWave, no early victory
  at maxWave−1, a loss at the cap is still gameover). Live: the clock holds at 30 during the pick and
  ticks (30→28) after; the Victory screen shows at wave 20; Start Over reopens the picker.

### Hero HP on the picker + Myra's Encore unlocks on turn 3
- **Heroes have a Resolve (HP) stat.** `HeroDef.resolve` (all 30 today, will diverge per hero) now
  seeds the run's starting + max Resolve in `createRun` instead of the global `CONFIG.startResolve`.
  The hero picker shows it under each name as a red heart + number (matching the HUD's Resolve heart).
- **Per-power unlock turn.** `HeroPower.unlockWave` (default 1) gates when a power becomes usable.
  **Myra's Encore now unlocks on turn 3** — locked on turns 1 & 2 (the reducer rejects it; the HUD
  reads "Encore · unlocks turn 3" and greys the panel; the picker shows an "Unlocks turn 3" badge).
  From turn 3 it's the usual once-per-turn power.
- Verified: `typecheck` + `lint` clean, `test` **154** pass (+2: Encore rejected on turns 1–2 and fires
  on turn 3; `createRun` seeds each hero's Resolve). Live: picker shows ♥30 on all three + the badge on
  Myra; as Myra, the HUD shows "unlocks turn 3" (greyed) at wave 1 and "once per turn" (ready) at wave 3.

### New hero "Myra" (Encore — re-trigger a Battlecry) + Oner/Myra portrait art
- **Myra — power "Encore" (once per turn):** choose a friendly board minion and **trigger its
  Battlecry again**. New effect `kind: 'replayBattlecry'` + `replayBattlecry(state, card)` in
  `recruit.ts`, which re-fires the minion's `onPlay` effects right now — honoring Drakko repeats +
  Karwind, exactly as a fresh play would. It returns whether a Battlecry fired, so the hero charge is
  only spent when it did. Edge handling: a **targeted** Battlecry re-fires with no explicit target so
  its auto-pick fallback chooses (Toxin Tender → the highest-attack eligible friend); a strict-target
  Battlecry (Corrupted Lifebinder) no-ops; a **Choose One** minion has no `onPlay` effects so it isn't
  a valid target; a vanilla minion no-ops with the charge preserved. Once per *turn* (uses `heroReady`,
  recharges each wave — unlike Oner's once-per-game).
- **Hero targeting is now power-aware.** Fortify may still target a tavern offer, but **Gild and
  Encore are warband-only** (you can't gild or replay an unbought offer) — the aim selector and the
  shop-offer highlight now respect the power kind, so offers no longer glow for board-only powers.
- **Portrait art wired for Oner + Myra** (the picker + HUD showed an anvil-icon fallback before). The
  `downscale-art.ps1` script gained a `-Sub` param (defaults to `minions`) so it right-sizes any art
  subfolder; `oner.png`/`myra.png` were copied from the masters and downscaled to 640px (4.7 → 2.7 MB).
  The hero picker now shows all three with real portraits.
- Verified: `typecheck` + `lint` clean, `test` **152** pass (+3 Myra tests: Encore re-fires Hoard
  Cleric's +1/+1 once per turn, auto-targets Toxin Tender → a friend gets Venomous, no-ops on a vanilla
  minion). Live (fresh server so Vite re-globs the new art): picker shows Warden/Oner/Myra portraits;
  picking Myra + Encoring a Hoard Cleric took it 1/3 → 2/4 and set "Encore · used".

### Heroes as data + Warden scaling + new hero "Oner" + pre-run hero picker
First real **hero system** — heroes are now data (like cards), not a hardcoded single Warden.
- **New `@game/sim/heroes.ts`.** A `HeroDef { id, name, blurb, power }` registry (`HEROES`,
  `HERO_INDEX`, `getHero`, `DEFAULT_HERO_ID`). A power has a `kind` the reducer resolves; adding a
  hero is data-only unless it needs a brand-new `kind`. `RunState` gained `heroId` + `heroPowerSpent`
  (once-per-game lock); `createRun(seed, heroId?)` seeds the chosen hero (defaults to Warden).
- **Warden's Fortify now scales with Tavern Tier** — `+Tier/+Tier` instead of a flat `+1/+1` (so at
  Tier 3 it's +3/+3). Targets a warband minion (recorded as a `Fortify` buff) or a tavern offer (the
  buff carries on the offer and bakes in when bought). Still once per wave.
- **New hero `Oner` — power "Gild" (once per game):** make a friendly **board** minion Golden. It
  doubles the minion's stats (recorded as a `Gild` buff so the inspect breakdown still sums) *and*
  flips the golden flag — so its **effects** double too (Deathrattles fire twice, ×N multipliers, the
  Demon fodder bonus, etc.). No-op (no charge spent) on a missing target or an already-golden minion.
- **Pre-run hero picker** (`HeroSelect.tsx`) — the first slice of the eventual Title → Mode → Hero
  flow. Driven by a single store flag (`heroChoices`); no router. Shows up to 3 heroes (all of them
  while only 2 exist) on first load and after a game over ("Begin a New Ascent" now opens the picker).
  Picking one starts a fresh run as that hero. Hero *choice* uses `Math.random` (UI-level meta, not
  the seeded sim). The StatusBar hero panel now renders whatever hero the run is on (name, power line,
  ready/spent, art with an icon fallback for art-less heroes like Oner).
- Verified live (clean reload, `healthy`): picker renders both heroes; picking Oner flips the run +
  HUD to "Oner · Gild · once per game"; buying→playing→gilding a Sporeling turned it golden 2/4 with
  its Deathrattle doubled to **+2/+2** (vs the shop copy's +1/+1), HUD → "Gild · spent", a second use
  rejected. `typecheck` + `lint` clean; `test` **149** pass (+5 hero-power tests: Warden tier-scaling
  + offer carry, Oner double/golden/once-per-game + already-golden no-op, createRun hero defaults).
- Follow-ups: **Oner needs portrait art** (currently the anvil icon fallback). Seed the hero-choice
  roll for daily runs later. The picker is the seed for the full Title/Mode menu (see roadmap).

### Combat hand updates live when a card is granted mid-fight
- **Bug:** the hand shows in combat now, but a card *granted during* the fight (e.g. Arcane Weaver's
  Deathrattle → Spirit Fire) didn't appear there — `run.hand` is the pre-combat snapshot (grants only
  commit at `resolveCombat`), so the new card was invisible until after the fight.
- **Fix:** `useCombatReplay` exposes `handGrantsShown` — the cards from `toHand` events *before the
  current beat*; `Recruit` appends them to the combat hand (non-interactive, `suppressPop`), so the
  hand visibly grows as each grant lands (one beat after its fly-to-hand animation). `tokenRefView`
  now carries the `spell` flag, so a granted Spirit Fire renders as a spell card (and the Arcane
  Weaver ref-popup is more correct too).
- Verified live: a fragile Arcane Weaver, on death mid-combat, made **Spirit Fire** appear in the
  combat hand (as a spell card) alongside the "Spirit Fire is added to your hand" narration.

### Combat Log "Procs" tab, hand-in-combat, no-emoji text
- **Procs tab.** The Combat Log overlay is now tabbed **Procs / Log**. The Procs tab is a per-source
  report — who triggered what, how many times — e.g. "Deathsayer → Arcane Weaver's Deathrattle — 1×"
  and "Arcane Weaver → Spirit Fire — 2×" (plus Summoned/Buffs by source + totals). To attribute, the
  `toHand` and `summon` events now carry a `source` (the producing minion's uid); `rally` already had
  source→target. Confirmed headless on the example board (1 rally Deathsayer→Arcane Weaver, 2 Spirit
  Fires from Arcane Weaver). The Log tab keeps the blow-by-blow.
- **Hand stays visible in combat.** It no longer slides away — it shrinks to a compact, non-interactive
  peek pinned to the bottom (always see what you're holding), and the narration bar moves up to sit just
  above it (`bottom: --ch×0.66 + 16`). The fly-to-hand card now lands on a visible hand.
- **No emojis in combat text.** Removed the emoji prefixes from the rolling narration lines (poison,
  shield, reborn, rally) and the "to your hand" label / Spirit-Fire line. (The over-card float symbols
  — ☠ / ◇ / ♻ — are visual indicators, left as-is; flag if those should change too.)
- Verified: `typecheck` + `lint` clean, `test` **144** pass (toHand now also asserts its `source`);
  the `.alog` position, compact-hand transform, and Procs-tab CSS confirmed via live computed-style
  probes on a clean mount. The in-combat *look* (hand peek + bar placement, Procs tab in the overlay)
  is best confirmed in a live fight.

### Combat log readability + proc-count summary + cards-to-hand animation
Three combat-feedback improvements:
- **Combat narration bar is readable now.** `.alog` was getting light cream text (from a shared
  title-screen rule) on its own light translucent pill — light-on-light. Made it a solid **dark pill
  with cream text**, bigger + bolder. (Removed `.alog` from the `#f6efe2` rule.)
- **Combat Log now opens with a proc-count summary.** New `summarize()` tallies the fight —
  `N attacks · M damage · D deaths`, **Rally procs** (per source), **Summoned** (per token, e.g. "Pup
  ×9"), **Buffs** (per source with totals, e.g. "Flowing Monk ×9 (+54/+54)"), and shields/poison/reborn
  counts — rendered above the detailed line-by-line log. Great for seeing/​debugging how many times
  things procced.
- **Combat-generated cards now visibly fly to your hand.** `grantToHand` logs a new `toHand` combat
  event; the replay shows the granted card (e.g. Arcane Weaver → **Spirit Fire**) pop in centre-screen
  and fly down into the hand on its own beat, narrated in both logs. (It's still added to the real hand
  after combat as before.)
- Verified: `typecheck` + `lint` clean, `test` **144** pass (new test: a grant logs a `toHand` event);
  `.alog`/`.handgrant`/summary CSS confirmed via live computed-style probes; app mounts clean.

### Fix — no targeting prompt when there's no viable target
A targeted Battlecry no longer strands the player on an unfulfillable prompt. The `play` action now
sets `pendingTarget` **only if a viable target exists**; otherwise the minion just plays and its
Battlecry doesn't fire. Tribe-restricted picks (Corrupted Lifebinder → a friendly Demon, never self)
need a matching friend — with none, **no prompt, no link, played as-is**. Unrestricted picks (Toxin
Tender) always have a target (themselves included), so they're unaffected. Engine-level, so the UI
inherits it. Test added. `test` **143** pass.

### Golden Deathsayer — Rally proc is a ×2 multiplier
A **golden Deathsayer** now procs the leftmost Deathrattle **twice** — implemented as a multiplier on
the whole Rally proc count: `procs = (1 + Sylus extras) × (golden ? 2 : 1)`, so it stacks
*multiplicatively* on Sylus (golden Deathsayer + 2 Sylus = (1+2)×2 = 6 procs, not 5). Added `goldenText`
("…trigger your leftmost Deathrattle **twice**."). Tests lock it: golden alone → 2 procs, golden + 1
Sylus → 4 (multiplicative, not additive). `test` **142** pass.

### Art — downscale pass (build prep)
Added `scripts/downscale-art.ps1` (System.Drawing, no new deps) that caps in-repo minion illustrations
at **640px** (cards display ~290px, so 640 is retina-crisp + headroom). Ran it: the four 1254×1254
illustrations (Guel/Monk/Lifebinder/Deathsayer) → 640px, **minion art 31.5 → 26 MB**. The high-res
masters stay in `C:\Game Assets\Ascent Art\Minions`; re-run after dropping new art (idempotent). Modest
win because most existing art was already 512px and PNG stays heavy for detailed images — the real
reduction (~6 MB total) needs **WebP** (blocked on an encoder: add `sharp` as a dev dep + build step,
or `cwebp`). Deferred since a desktop-exe path would make download size a one-time install rather than a
per-play load. _(Detail in the size discussion this session.)_

### Deathsayer Rally respects Sylus + un-wire Pup placeholder art
- **Rally now procs the Deathrattle the full number of times a real death would** — including **Sylus
  the Reaper's** extra procs (+1 each, +2 golden). Earlier today Deathsayer fired the leftmost
  Deathrattle exactly once; that was wrong (the user's board: Pack Scrounger + Echo Warden + 2 Sylus,
  full board → only 3 Flowing Monk overflow procs instead of 9). `rallyProcDeathrattle` now loops
  `1 + reaperBonus` (Sylus count) like `killOrReborn` does. Echo Warden's extra tokens were already
  folded in via the summon factories. Confirmed headless on that exact board: **9 procs** (Pack
  Scrounger ×3 via Sylus × 3 Pups via Echo). New test asserts 2 Sylus → 3 Deathrattle procs.
- **Un-wired the Pup art** — `Sprite Pup.png` was a placeholder for a *new* (future) minion, not the
  existing Pup token, so `pup.png` was removed (the Pup goes back to its pixel sprite).

### Art — wire the Pup token *(superseded — reverted below same day)*
Wired `Sprite Pup.png` → the **Pup** token, then **reverted** (see above): that art is a placeholder
for a future minion, not the Pup. `DynamiteDuo.png` remains orphan art with no matching card.

### Deathsayer — Rally that procs the leftmost Deathrattle before its attack
New **Deathsayer** (T4 Undead 3/5, **Rally**): each time it attacks, it fires your **leftmost friendly
Deathrattle first**, then the hit lands. Art wired from the name-matched source.
- **Engine:** new combat factory `rallyProcDeathrattle` (subscribed to `onAttack`, which is emitted
  *before* `dealDamage`, so the proc + any buffs/summons it produces resolve before the attack's
  damage). It finds the leftmost living friend with a *true* Deathrattle (`onDeath` effect whose id
  starts with `deathrattle`, so friend-death watchers like Brood Matron don't count), logs a new
  `rally` combat event (source = Deathsayer, target = that minion), then runs that minion's onDeath
  effects (it stays alive). _(Same-day follow-up: the proc now also respects Sylus — see the later
  entry above.)_
- **UI:** the `rally` event is its own beat with a pause (`DELAY.rally` 720 ms) — Deathsayer pulses
  (`sccast`), the chosen minion flares + shows a violet **☠** bloom marking whose Deathrattle fires,
  then its buff/summon beats play, *then* the attack's damage. Narrated in both combat logs; the
  headless harness prints it too.
- Verified: `typecheck` + `lint` clean, `test` **140** pass (new test asserts the Rally + the
  Deathrattle's buff land in the log *before* that attack's damage); production build bundles the art;
  the app mounts clean with the `rally` float styled. Stats are starting dials.

### Content pass — 3 new minions, 6 removals, Maw/Toxin tweaks, per-proc EoT animation
A big content + mechanics batch from the user's spec.

**New minions (art wired from name-matched source files):**
- **Archmagus Guel** (T4 neutral 2/3) — *After you cast a tavern spell, give 2 other friendly minions
  +1/+1.* New `spellCast` factory `spellCastBuffOthers` (seeded-random targets, excludes self). The
  triple-reward Discover routes through `offerDiscover`, **not** `castSpell`, so it correctly doesn't
  proc Guel.
- **Flowing Monk** (T4 neutral 1/4) — *When you summon a minion that doesn't fit, give a random friendly
  minion +3/+3.* Fires on **summon overflow** in both phases: recruit (`makeContext.summon`) and
  **combat** (a new `summonOverflow` bus event from `simulate`'s `ctx.summon` + a combat
  `overflowBuffRandom` factory). New `summonOverflow` GameEvent.
- **Corrupted Lifebinder** (T6 Demon 1/1) — *Battlecry: bind to a friendly Demon; also gains the stats
  whenever that minion does.* Targeted Battlecry restricted to Demons (new `targetTribe` on `CardDef`
  + UI filter). The link mirrors gains **in recruit** (`syncLifebinders`, run after every reducer
  action) **and in combat** (the linked demon's `buff` events mirror onto the Lifebinder inside
  `simulate`; the board uid is remapped to the combat uid). If the demon leaves, the link just ends and
  the Lifebinder keeps what it has.

**Changes / removals:**
- **Maw of the Pit** → *On consume, gain a Divine Shield for the next combat* — a one-combat shield now
  (new `tempShield` flag + `onConsumeShieldNextCombat`; `resolveCombat` strips the DS after the fight).
- **Toxin Tender** → Tier 5 (was 2).
- Removed **Abyssal Sovereign, Pactstone Acolyte, Chromatic Caller, Nadir Hoardlord, Galewing Apex,
  Shield Capacitor** (tests using them were updated/retired; their now-unused combat factories are left
  inert).

**End-of-Turn animation — reworked to what was actually asked:** the previous pre-turn "pending buff
chip" preview is **removed**; instead the affected minions' **stats now visibly tick up one proc at a
time during the end-of-turn animation** (new `projectEndOfTurnSteps` gives per-proc cumulative stats
aligned to the UI's beat sequence; each beat sets the shown stats + flashes whoever just gained), then
`faceOmen` bakes the same totals in.

**Bug fix — Fodder ghost replaying every turn after a Soulfeeder:** the consume animation effect listed
`run.fodderEaten` in its deps, but that array gets a fresh reference every action, so any action within
the 2.3 s window re-ran the effect → its cleanup cancelled the clear-timeout → the ghost was stranded,
then **re-mounted and replayed every time you returned from combat** (the intermittency = whether you
acted in that window). Fixed by keying the effect on `fodderEatenSeq` alone + clearing the ghost on
combat start.

- Verified: `typecheck` + `lint` clean, `test` **139** pass (added coverage for Guel, Monk recruit +
  combat, Lifebinder link/recruit-mirror/combat-mirror/link-ends, Maw one-combat shield); production
  build bundles the 3 new art files; the live app mounts clean with the new content. The fodder repro
  was confirmed headless (seq bumps once, stays) — the replay was purely the UI dep leak.

## 2026-06-18

### Live End-of-Turn buff preview + triple-ready tavern highlight
Two recruit-screen quality-of-life features:
- **End-of-Turn stat buffs now show live, during the turn, instead of only at the end.** New pure
  helper `projectEndOfTurn(state)` (in `@game/sim`) runs the *real* `applyEndOfTurn` on a throwaway
  `structuredClone` and diffs the board + hand stats, returning per-uid deltas — exact by construction
  (same code path: self-buffs, Combinator's Mech welds, Ritualist's Fodder buff) and **zero side
  effects** on the real state. The recruit UI folds those deltas into the shown stats (so the board
  reads as it *will* when the turn ends), tags each affected minion with a small teal **"↑+x/+y"
  pending chip** (top-right) and an inspect-breakdown "End of Turn" entry, and recomputes live as the
  board changes. The real buffs still bake in once at end of turn (display-only preview, so combat /
  sell / the buff-flash all still use true stats until then). Verified headless: Ritualist + 2 Fred on
  board + 1 in hand → projection shows all three Fodder +1/+1, Ritualist none, and the source board is
  left unmutated. `recruit.ts` (`projectEndOfTurn`), `Recruit.tsx` (`eotProjection`, `instView`),
  `Card.tsx` (`eotBuff` chip), `styles.css`.
- **Triple-ready tavern highlight.** A tavern offer you'd **complete a triple** by buying (you already
  hold 2 non-golden copies across board + hand) now gets a **bright gold pulsing glow** (keeps the
  tribe ring) and **gold arrows floating up** around it. Detection mirrors `checkTriples`' counting.
  `Recruit.tsx` (`tripleReadyUids`), `Card.tsx` (`tripleReady` + arrows), `styles.css`.
- Verified: `typecheck` + `lint` clean, `test` **133** pass; projection logic confirmed headless (tsx);
  all new CSS (`tripglow`, `triparrow`, `eotchippulse`, tribe-ring preserved) confirmed via live
  computed-style probes on a clean mount. In-game appearance (chip on a real Fodder minion, glow on a
  real 3rd-copy offer) is for the user to confirm — a live board can't be built in the preview harness
  (synthetic drags don't land; screenshots / timeout-evals hang).

### Combat VFX round 3 — staggered keyword procs, bright-blue reborn, two-threshold stat colours
Follow-ups from playtesting the previous round:
- **Keyword procs no longer collide with the damage number.** Poison (☠), Divine Shield (◇ break/gain)
  and Reborn (♻) floats used to spawn on top of the `−N` at the same HP corner. They now **bloom big
  (64px) in the card centre, 0.26 s after** the damage number (a new `floatsym` animation + a `sym`
  class on those float kinds), so the hit reads first and the proc lands as its own beat — and each is
  much more apparent: poison glows green, shield gold, reborn electric blue. Damage/buff numbers still
  sit in the stat corner. `Unit.tsx` (`SYM_KINDS`), `styles.css`.
- **Reborn is now unmistakable.** Replaced the dim brightness `flare` with a **bright-blue resurrection
  flash** (`rebornburst`: the unit flares electric blue, brightness 2.5 + blue drop-shadow) plus an
  **expanding blue ring** (`rebornring` ::after). Bumped the reborn beat (`DELAY.reborn` 560→640 ms) so
  the 0.85 s flash plays out before the next beat clears the class. `styles.css`, `useCombatReplay.ts`.
- **Stronger poison proc** — vivid green flash (hue-rotate + saturate + green drop-shadow) and a denser
  rising mist, so a Venomous kill is obvious. `styles.css`.
- **Stat colours fixed: green stays green until actually reduced.** Last round set the combat baseline
  to the *combat-start* stats, which made a recruit-buffed 5/5 read **neutral** the instant combat began
  (cur == base). Now combat uses **two thresholds**: green above the **printed** base (it's buffed), red
  below the **floor** it entered the fight with (it's been damaged/debuffed). So a 5/5 reads **green**
  and only its HP flips **red** when chipped to 5/3 — exactly as asked. `statCls` gained a `floor` arg;
  `CardView` gained `floorAttack`/`floorHealth`; `Unit.tsx` passes printed base + combat-start floor.
  Shop/recruit is unchanged (no floor → printed-base compare).
- Verified: `typecheck` + `lint` clean, `test` **133** pass; all new CSS confirmed applied via live
  computed-style probes (`floatsym` delay 0.26 s/64px, reborn `rebornburst`+`rebornring`, sym colours)
  on a clean fresh mount. Runtime motion is for the user to confirm in-browser (the preview renderer
  still hangs on screenshots / `setTimeout` evals, and synthetic drags don't land, so a live fight
  can't be driven here).

### Combat readability round 2 — damage numbers, in-combat stat colours, return jiggle, hero-power flash
A grab-bag of combat/recruit polish from live playtesting:
- **Damage numbers, near the HP and readable.** The floating combat numbers (`−N`, poison, shields,
  buffs) were small, brief, and flew off the *top* of the card. They now pop over each card's own
  **stat corner (next to the HP)**, are **bigger** (dmg 30→42px), **linger longer** (1.0→1.4 s,
  `FLOAT_MS` 1250→1450), and **stay on the card** (pop-in → hold → gentle rise instead of flying away).
  Because the attacker's retaliation and the target's hit already resolve in the **same impact beat**,
  both numbers now spawn at the *same instant on their respective cards* — the exchange reads as
  simultaneous (it always was in the data; the old off-top position hid it). `styles.css` (`.float`
  + `floatup` keyframe), `useCombatReplay.ts` (`FLOAT_MS`).
- **In-combat stat colours now use the *combat-start* baseline.** Previously a combat unit coloured its
  stats against the *printed card base* (1/1), so a buffed 5/5 chipped down to 5/3 still showed green
  HP (3 > 1). Now each `UnitFrame` carries `baseAttack`/`baseHealth` = the stats it **entered the fight
  with** (for tokens, their summon stats; reset on Reborn). So **damaged HP and debuffed attack read
  red**, while a genuine *combat* buff above the entry value still reads green. The shop/recruit is
  unchanged (still compares to the printed base, so a recruit-buffed minion stays green there).
  `useCombatReplay.ts` (`UnitFrame` + `fromSnap` + reborn fold), `Unit.tsx`.
- **No more warband "jiggle" returning from combat.** The player board swaps `<Unit>`→`<Card>` on the
  way back to recruit, so every card **re-mounted** and re-fired the base `cardpop` animation (the
  random jiggle). The mount-pop is now opt-in via a `popin` class that's **frozen at mount** (a
  `useState` initializer in `Card`), and the warband passes `suppressPop` on exactly the combat→recruit
  render — so returning minions don't pop, while freshly bought/played cards still do. The hand never
  re-mounts (it's hidden, not swapped) so it was already fine; the new shop still pops (it *is* new).
  `styles.css`, `Card.tsx`, `Recruit.tsx` (`returningFromCombat`).
- **Hero Power (Warden / Fortify) always flashes its target.** Releasing the Fortify line now
  explicitly fires the green buff-burst on the chosen minion (`flashBuffed`), instead of relying solely
  on the passive stat-diff flash — so it can never silently land with no animation. `Recruit.tsx`.
- **Return "noise":** traced — *nothing* fires a sound on the combat→recruit return itself
  (`resolveCombat` has no sfx hook). The only sound near that moment is the **win/lose verdict chord**
  played when the replay finishes (just before "End Combat"). Removing the jiggle should make it read as
  intentional; flagged for the user to confirm.
- Verified: `typecheck` + `lint` clean, `test` **133** pass; new float/cardpop CSS confirmed via live
  computed-style probes; fresh page mount renders clean (the transient React hook-order warnings were
  HMR add-a-hook artifacts — a clean reload to WAVE 1 shows no error boundary). The *runtime* combat
  visuals (floats by the HP, red damaged HP, no jiggle, hero burst) couldn't be screenshotted —
  the preview renderer still hangs on screenshots and `setTimeout`-based evals — so the look is for the
  user to confirm in-browser.

### Combat clarity pass — readable attacks (Phase 1–3)
- Reworked the combat replay (`useCombatReplay` — animation-only, no logic changes) so exchanges read
  as a clear back-and-forth instead of a blur:
  - **Stop hiding the target:** the attacker leans in only **~40%** of the way (taps the defender's edge
    instead of sliding over its stat badges), then **recoils** on the impact beat; and the struck
    defender is **layered above** the attacker (z-index) so its dropping HP is never covered.
  - **Weight + breathing room:** the impact beat is longer, hits **flash red**, and there's a ~200 ms
    **settle** before the next swing so attacks don't run together.
  - **Telegraph:** the defender about to be hit gets a brief **danger glow** during the wind-up.
- All driven off the deterministic event log — zero risk to the sim. `test` (133) clean. (Live visuals
  unverified this session: the preview renderer was hung for screenshots/animation polling.)

### Fix: a Reborn attacker is next in line to attack again
- A minion that died to retaliation on its own attack and **Reborned** went to the *back* of its side's
  rotation (the `nextAttacker` pointer resumed after it). Now it keeps its place — it's the next attacker
  for its side. One-line pointer rewind in `simulate`'s attack loop; +1 sim test.

### Fix: dual-card hover no longer floods with colour
- Hovering a dual-type card (Heckbinder) made its split coloring "go wild": the hover-lift `transform`
  turns the card into a stacking context, which flips the `z-index:-1` split pseudo-element to the front
  so the *solid* gradient floods the interior. Rebuilt the split rim as a **masked gradient ring**
  (border-box minus content-box) that stays a clean rim regardless of stacking context, and gave dual
  cards the same boosted-glow hover as singles.

### Combat odds — win/draw/loss bar in the log
- After a fight, the **Combat Log** now shows the matchup's estimated **outcome odds** as a 3-segment
  win / draw / loss bar with percentages. `faceOmen` re-simulates the *same two boards* on **1000
  independent seeds** (margin of error ~±1.5%) and stores the distribution on `lastCombat.odds`. The
  seeds come from a dedicated `TAG.ODDS` stream derived from the run seed, so the odds are
  **reproducible** and don't disturb the real combat RNG. The actual fight is one roll of these odds
  (a tooltip says so).
- **Cheap:** measured ~1 ms warm per fight (a few ms for a long grindy fight); only the very first fight
  of a session pays a one-time cold-JIT cost (~tens of ms). Combat is a pure function on ~14 units — the
  balance runner already hammers it thousands of times. Win = accent, draw = grey, loss =
  threat-raspberry (matching the verdict pill).
- +1 sim test (odds sum to 1 + are deterministic per seed/wave). `typecheck` + `lint` + `test` (**132**)
  clean; the bar verified rendering live (segments 62/10/28 % with matching labels).

### Selection emphasises the tribe colour (no more orange selector)
- Hovering / targeting a card now **brightens + grows its own tribe-colour glow** instead of applying
  the accent (orange) selector line — so selection reads *with* the card's type rather than clashing
  with it. Changed `.card:hover` (dropped the accent border for a boosted tribe glow), `.card.armed`
  (targeting candidates) and `.card.targeted` (the current aim — a strong tribe glow + lift/scale). The
  orange aim-*line* (the hero-power / Toxin Tender beam) is left as-is for now.
- CSS-only; verified live — armed offers glow their own tribe (green / orange / slate / purple / teal),
  no accent ring; 0 console errors.

### Card body restyle — tribe colour fills the frame
- Per feedback, the tribe colour now **fills the card frame** instead of just outlining it: the card
  body is a tribe wash, the **art is inset + outlined** (a tribe border with the wash framing it), and
  **only the description sits in a white box** — matching the painted mockups. The footer carries the
  wash too, and dual-types split the frame + footer + rim half-and-half. Golden / spell / Triple Reward
  keep their own special frames.
- **Fix (affects most cards):** centring the description via `display:flex` had turned inline `<b>` runs
  into separate flex items, so bold words rendered cramped / out of flow. Wrapped the description HTML in
  a single span so it flows inline normally and still centres in the box.
- CSS + one JSX wrapper. `typecheck` + `lint` clean; verified live across all six tribes, a vanilla
  (no-text) card, and the dual (split frame + correctly-flowing bold text) — 0 console errors.

### Tribe-coloured card edges
- Every minion card now flags its **type by its outer edge**: a tribe-coloured ring (Beast green,
  Dragon orange, Mech teal, Undead slate, Demon purple, Neutral tan) plus a soft same-hue glow.
  **Dual-types split the rim half-and-half** (Heckbinder → Demon purple / Mech teal) via a
  pseudo-element gradient rim (a `box-shadow` can't be two colours). Driven by the existing `--c` /
  `--c2` card vars, so it's data-free.
- The edge previously did double duty for keyword cues; reconciled so **tribe owns the rim**: Divine
  Shield and Reborn keep their pulsing glow but as an **outer halo** layered around the tribe ring
  (DS = tribe ring + gold halo; Reborn = tribe ring + blue halo); Taunt now relies on its shield-ward
  badge and Stealth on its faded look (their edge rings dropped). Golden / spell / Triple Reward keep
  their special gold / purple frames (the tribe edge is suppressed there).
- CSS-only. `typecheck` + `lint` + `test` (**131**) clean; verified live across all six tribes, a dual
  (split rim), a Divine-Shield card (teal ring + gold halo), a Reborn card (slate ring + blue halo),
  and a golden (gold frame preserved) — 0 console errors.
- **Tuned per feedback:** thicker ring (3 → 4px) + a more saturated glow so the type colour reads at
  a glance (the DS / Reborn outer halos and the dual split rim were scaled to match).

### Toxin Tender — player-targeted Battlecry
- Toxin Tender's Battlecry is now **player-targeted** (like the Warden's Hero Power): play it to the
  board, then aim a glowing line at any friendly minion and click to grant **Venomous** to *that*
  minion. Built on the deferred-resolution pattern (mirrors Choose One): `CardDef.target: 'friendly'`
  makes `playCard` fire onSummon but **defer** the Battlecry; the reducer parks a `RunState.pendingTarget`;
  a new `battlecryTarget` action resolves the grant on the chosen minion. `battlecryGrantKeyword` is now
  target-aware — an explicit target wins, else it auto-picks the highest-attack friend lacking the
  keyword (so **Plaguebringer keeps its auto behaviour**). An unresolved target **auto-resolves on the
  carry** if the turn ends first, so the play is never stranded.
- UI: a `pendingTarget` aim-line effect (mirrors the Hero Power's) + an accent prompt — "Choose a minion
  for Toxin Tender's Battlecry"; the board minions arm and the played minion's drag is suppressed so a
  click targets rather than drags.
- +3 sim tests (defer-then-grant on the chosen minion — not the higher-attack carry; end-turn
  auto-resolve on the carry; Plaguebringer still auto-grants) + updated the old auto-grant test.
  `typecheck` + `lint` + `test` (**131**) clean; verified live (play → pendingTarget + prompt;
  `battlecryTarget` grants Venomous to the chosen minion, not the highest-attack one; 0 console errors).

### Finite minion pool (draw-from + return-on-sell)
- Wired the shared, finite minion pool the engine was scaffolded for. Each run stocks
  `POOL_QUANTITIES[tier]` copies of every buyable minion of its active tribes (+ neutral) into a new
  `RunState.pool`. The shop **draws from it** — `rollShop` / `topUpTavern` decrement on draw, a full
  reroll returns the discarded offers first, and a card at **0 copies stops being offered** (the shop
  just offers fewer cards). **Selling returns** copies (a golden returns 3, since it ate three), and
  **conjures** (Discover, Buddy Buddy) take a copy so selling them stays balanced. Tokens / Fodder /
  spells are never pooled. Old saves heal (re-stock) on `deserialize`.
- **Quantities** (per the user): T1 **10**, T2 **9**, T3 **8**, T4 **7**, T5 **6**, T6 **6**.
- **Draw weighting unchanged** — I gate by availability rather than weighting by remaining count, which
  keeps the exact draw sequence from a full pool (so every existing seeded test is undisturbed) while
  delivering depletion + return. Copy-count weighting (a drained card appearing less often, BG-style) is
  a noted refinement; a "copies left" UI cue is queued too (the pool is currently invisible).
- +5 sim tests (stocking, copy conservation across buy/reroll/sell, sell-returns incl. golden ×3, a
  depleted card never offered + an empty pool offering nothing). `typecheck` + `lint` + `test` (**129**)
  clean; verified live (pool stocks the Target Dummy at 10, rolls draw from it, no console errors).

### Buff-panel fit + Combinator welds random Mechs
- **Buff inspect panel fits any number of sources.** Widened the breakdown (max-width 150→252px) and
  added a `max-height` + vertical scroll, so a heavily-buffed minion (e.g. `Karwind ×128 +209/+418`
  alongside a dozen other sources) shows every row. The source name flexes/ellipsizes only if a name is
  unusually long, while the `+atk/+hp` amount is pinned always-visible (`flex: 0 0 auto`). Verified live
  with 12 sources incl. 200+ buffs — all fit, nothing clipped, scroll kicks in past the height cap.
- **Combinator welds onto RANDOM Mechs (per proc).** It used to pick the 2 *highest-Attack* friendly
  Mechs (deterministic). Now it picks 2 at **random**, fresh each proc — so Chronos repeats spread to
  different Mechs. The pick is seeded by (run seed, wave, the Combinator's board slot, proc) through a
  new shared `magnetizeTargets()` helper (exported from `@game/sim`), so it's reproducible **and** the
  recruit UI derives the exact same uids to electrify — the visual stays in sync with the actual welds
  without restructuring the recruit→combat flow. +1 sim test (over 24 seeds the welded pair shifts
  around, where the old highest-Attack logic always picked the same two).
- `typecheck` + `lint` + `test` (**125**) clean; buff panel verified live.
- *(Re: pool quantities — answered the user inline: the shop currently samples with replacement from
  the eligible pool with no finite per-tier counts; `POOL_QUANTITIES` remains an unwired placeholder.)*

### Tavern control bar restyle (toward the Pixel Arena mockup)
- Reworked the shop control bar to match the user's mockup. Cost/tier numbers are now **large, bold,
  colored inline** with **no pill** (the earlier teal-pill cost treatment is dropped). The **Refresh**
  cost is bold teal Mana; the **current-tier** indicator's number is bold tangerine.
- The current-tier indicator (`.tavernbox`) gained a **house icon**, the bigger orange tier number, and
  a solid border (was dashed). The **upgrade button** got the same house icon (new `house` glyph added
  to `Icon`) and keeps **"Tavern Up" + the teal Mana cost** (→ "Tavern MAX" at cap).
- **Design note:** the mockup's leftmost "Tavern · Tier 6" is the *current-tier indicator*, not the
  upgrade button — so the "Tavern · Tier N" wording lives there, and the upgrade button stays "Tavern
  Up" to avoid showing "Tavern · Tier" twice. (Together they satisfy "tier wording + cost": the tier on
  the indicator, the cost on the button.)
- `typecheck` + `lint` clean; verified live — bar reads "🏠 Tavern · Tier 1 · Refresh 1 · Freeze · 🏠
  Tavern Up 5 · End Turn" with bold colored numbers, and a forced re-render + real roll logged zero new
  console errors.

### Gnasher vs Reborn, golden Brood Matron, Imp rename, Spirit of the Pack cut
- **Gnasher re-attacks after killing a Reborn target.** Dropping a Reborn minion to 0 revives it
  (`killOrReborn` returns it at base stats and leaves `dead` false), so the on-kill check
  `target.dead || target.health <= 0` read false and Gnasher's re-attack never fired against a Reborn
  body. Now `performAttack` snapshots the target's Reborn availability before the swing and counts a
  *consumed* Reborn as a kill too — so Gnasher keeps swinging through it. +1 sim test (Gnasher clears a
  lone Reborn Grave Knit in exactly two swings, the enemy never getting to attack — which fails under
  the old check).
- **Golden Brood Matron breeds two Imps per death.** `onFriendDeathSummon` summoned `1 + echoBonus`
  regardless of golden; it now uses `mul(self) + echoBonus`, so a golden Brood Matron makes **2** Imps
  per friend death (Echo Wardens still stack on top). Added explicit `goldenText` + 1 sim test (golden
  → 2, plain → 1).
- **Imp Scrap → Imp.** The Brood Matron token is renamed to **Imp** (id stays `impscrap`, so Brood
  Matron's `tokenId` param and the existing tests are untouched) and now has illustrated art.
- **Art wired:** Brood Matron (`BroodMatron.png` → `brood.png`) and the Imp token (`Imp.png` →
  `impscrap.png`), both 512×512 — verified loading live. Wired-art count is now 32.
- **Spirit of the Pack (`pack6`) removed.** The tier-6 Beast (Deathrattle: all Beasts +4/+4) is cut
  from the set and its art file deleted. The one test that used it as a buff-Deathrattle vehicle now
  uses **Grim** (+6/+6), which remains the board-wide Beast buff; `useCombatReplay` comments updated to
  match.
- **Tavern Up cost emphasised.** The upgrade button's cost is now larger (22px, bold) inside a teal
  Mana pill, scoped to a new `.tavernup` class so the sibling **Refresh** cost keeps its baseline look.
- `typecheck` + `lint` + `test` (**124**) + `build:web` clean; art + button verified live (brood/Imp
  render at 512×512; Tavern Up cost 22px in a pill, Refresh cost unchanged at 17px). Repacked
  `ascent-itch.zip` (41 entries — brood + impscrap in, pack6 out; `index.html` at root, forward-slash
  paths).

### Venomous retaliation + "Tavern Up" button
- **Venomous now procs on the attacker too.** A unit that *attacks* a Venomous minion took the
  defender's retaliation damage, but the venom proc/drop-off was skipped whenever that raw retaliation
  was already lethal (the guard was `if (poison && target.health > 0)`). Now the proc fires whenever
  damage actually lands — i.e. past the Immune/Divine-Shield early-returns — so attacking a Venomous
  unit kills the attacker and consumes the defender's `V`, **unless the attacker is shielded** (a
  Divine-Shield/Immune attacker absorbs the hit and the venom never lands, exactly as before). One-line
  fix in `dealDamage` (`if (poison)`); `performAttack` already forwarded the defender's venom on
  retaliation. Added 2 sim tests — (a) attacking a Venomous target kills the attacker via retaliation
  venom, shielded variant survives; (b) the proc **and drop-off** fire even when the raw retaliation is
  lethal (would fail under the old `target.health > 0` guard). All **122** tests pass.
- **"Tier ^" → "Tavern Up" + mana cost.** The upgrade button now reads **Tavern Up** (and **Tavern
  MAX** at cap) with a teal **mana drop** rendered inline before the cost number. Sized 17px to match
  the cost text (`.btn.big .c` is now an `inline-flex` row with a small gap). Verified live: the button
  shows `Tavern Up 5`, two icons, the cost icon computed at 17px / mana-dk teal; Recruit re-renders and
  a real `roll` dispatch produced **zero** new console errors (the residual `<Recruit>` errors in the
  buffer are the documented stale artifact from forcing `newRun` mid-combat on the long-running server).
- Repacked `ascent-itch.zip` (40 entries, `index.html` at root, all forward-slash paths). `typecheck`
  + `lint` + `test` (122) + `build:web` clean.

### Fix: enemy minions now animate their attacks
- Enemy (tavern-side) attacks showed no lunge. Cause: the `enemyarrive` entrance animation used
  `both` fill, so it **held its final `transform`** on every enemy unit — and a filling CSS animation
  overrides the inline lunge transform (player units have no such animation, so they were fine).
  Dropped the fill (the keyframe ends at the identity transform, so the entrance is unchanged); enemy
  lunges now apply. Verified live — an attacking enemy now lunges (`translate(326px, 218px) scale(1.04)`),
  and a full combat replays with no console errors.

### Correct Echo Warden art + new Ember Whelp art
- Re-wired **Echo Warden** from the now-present `EchoWarden.png` (replacing the earlier wrong guess —
  a spectral figure surrounded by echoed summons, fitting the card), and swapped **Ember Whelp** to
  `EmberWhelp2.png` (a fierier flame-breathing whelp). Both verified loaded in-app.
- **Policy:** only wire card art when a source file's name matches the card — never guess from an
  un-attributed file (a wrong guess is worse than the pixel-sprite fallback).

### Shaper/Echo art, minimal Karwind burn, magnetize pass 2, golden buff breakdown
- **Wired Wildwood Shaper + Echo Warden art** (`shaper.png`, `echo.png`). *Note:* there was no
  `EchoWarden.png` in the source folder — used the only un-attributed export (a leafy winged creature)
  for `echo`; swap the file if that's the wrong asset.
- **Karwind flame, reworked.** The old effect filled the whole card (72%-tall tongues, 0.9s) and read
  inconsistently. Now it's a **quick, minimal burn along the bottom edge** (5 small uniform tongues
  ~17% tall + a bottom glow band, 0.5s) — just a "Karwind is working" indicator, consistent across
  every buffed Dragon. Verified live.
- **Magnetize pass 2.** The drone now fully **vanishes into the Mech** (scale → 0.06, opacity → 0,
  accelerating ease) in **0.28s** (was a lingering 0.16-scale/0.15-opacity remnant over 0.32s), with
  the target Mech's crackle settling faster onto the green buff flash. (Drag gestures can't be driven
  headless, so the feel is best confirmed in-game.)
- **Buffs now carry through triples → goldens itemize in inspect.** The triple now keeps the two best
  copies (by total stats), **sums their stats AND merges their per-source buff breakdowns** onto the
  golden. For uniform buffs / fresh triples this is identical to the old top-two-atk/top-two-hp result;
  it only differs for oddly asymmetric per-copy buffs (rare), and in exchange a golden's inspect panel
  now lists its buffs (e.g. `Spirit Fire ×2 +6/+6`, `Karwind ×2 +2/+4`) consistently with its stats.
  Verified live + unit-tested (golden carries `Spirit Fire ×2 +6/+6`).
- `typecheck` + `lint` + `test` (**120**) + `build:web` clean; art + Karwind + golden breakdown
  verified live, no console errors.

### Cleaner magnetize "absorb"
- The magnetize merge was janky: the dropped card crept to the target over **0.72 s**, shrank to 0.32
  with a box-shadow crackle *on the flying card*, then the stats jumped — slow, and the target Mech
  never reacted. Rebuilt it as a snappy **absorb**: the drone shrinks straight into the Mech in ~0.32 s
  (down to 0.16 scale + fading out), and the electric crackle now plays on the **target Mech** (it
  keeps crackling a beat past the merge), landing on the existing green buff flash. Faster + reads as
  the Mech eating the drone. (`typecheck`/`lint`/`build` clean; merge logic unit-tested already —
  drag gestures can't be driven in the headless preview, so the timing is best felt in-game.)

### Buff-source breakdown, Karwind flames, drag-popup + sell fixes
- **Per-source buff tracking + inspect breakdown.** `BoardCard` now carries a `buffs` list (source,
  ±atk/±hp, count), populated by a new `addBuff()` that every recruit buff routes through (battlecry
  tribe buffs, Karwind, Spirit Fire, Fortify, Broker, Kennelmaster, Combinator, Ritualist, consume,
  magnetize, deathrattles). Right-click → inspect now shows the breakdown to the **left** of the card,
  e.g. `Nadir ×1 +2/+2`, `Karwind ×1 +1/+2`, `Spirit Fire ×2 +6/+6`. (Goldens don't itemize — the
  triple sums stats ambiguously; known limitation.) Verified live + unit-tested.
- **Karwind flame highlight.** When a Battlecry triggers Karwind, the Dragons it buffs now flash with
  flames (a transient `karwindFlash` uid list + seq drives a flame overlay), on top of the normal green
  buff flash — so it's clear the extra buff came from Karwind. Verified live (playing Hoard Cleric
  flame-flagged all 3 dragons) + unit-tested.
- **No referenced-card popup while dragging.** Holding/dragging a card no longer counts as "hovering" a
  minion — a `dragging` prop suppresses the popup and drops any open one.
- **Minions must be on the board to sell.** A hand minion flung up to the tavern now snaps back to the
  hand instead of selling (only board minions sell; the sell-glow matches).
- `typecheck` + `lint` + `test` (**119**) + `build:web` clean.

### Drag insertion sweet spot + tooltip proximity
- **Drag drop now follows the card, not the cursor.** The warband/shop insertion index was computed
  from the raw pointer x — but the floating card is offset by wherever you grabbed it, so grabbing the
  right side dropped the card a slot too far right. It now uses the dragged card's **centre**
  (`pointer − grabOffset + width/2`) at every insertion site (live drop-slot preview, play, reposition,
  shop reorder, magnetize target), with `INSERT_FRAC` 0.35 → **0.5** so a card slots after another only
  once its centre passes that card's midpoint. (Verified by code: the harness can't drive React's
  pointer-capture drag synthetically.)
- **Referenced-card popup hugs the hovered card.** The 0.8 scale was anchored at centre, so the popup
  appeared to drift ~30px off the source. Now the scale is anchored to the source-facing edge
  (transform-origin left/right) and positioned so the *visible* edge sits ~8px from the hovered card
  (flips side near the screen edge). Verified live: popup's visible left edge ≈ the source card's right
  edge (~8px), origin left-center.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Referenced-card popup polish — delay + float + haze
- The referenced-card popup now opens after a **~0.5s hover** (so it doesn't flash while skimming the
  board; position is measured when it opens, so it tracks a popped-up hand card). It **slides in**, then
  gently **bobs + wobbles in place** (a continuous float) so it reads clearly as an info card, not a real
  one, and it's wrapped in a **soft white haze** (layered white drop-shadows). Verified live: hidden at
  150 ms, shown by 650 ms; entrance + float animations active; haze present; no console errors.
- The popup minions also render at **80% size** (scale baked into the float keyframes so it composes with
  the wobble) — verified ~0.82× the source card on screen.

### Referenced-card hover popup
- Hovering a card that references another now shows the referenced card as a **popup to the right**,
  portalled to `<body>` at z-index 150 so it floats **above neighbouring cards / spells**. Covers every
  card that names/creates/affects another: **Alleycat / Wildwood Shaper → Stray**, **Pack Scrounger →
  Pup**, **Brood Matron → Imp Scrap**, **Combinator → Cling Drone**, and the Fodder cards **Soulfeeder /
  Voracious Imp / Ritualist / Pactstone Acolyte / Maw / Ravening Glutton → Fodder**. The Fodder popup
  reflects its **current buffed stats** (folds in Ritualist's persistent enchant), so the player can see
  what their Fodder is at right now. Positions to the right by default, flips to the left near the screen
  edge, and clamps on-screen. Wired via a memoized `refViewsByUid` map (stable across a drag, preserving
  the card memo). Verified live: Combinator→Cling Drone (2/2), Alleycat→Stray (1/1), Ritualist→Fodder
  shown at 4/4 (1/1 base + a 3/3 enchant), Soulfeeder→Fodder; popup on `<body>`, z-150, no errors.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Ornate Discover frame, centered game-over button, sequenced End-of-Turn animations
- **Discover frame redesign.** The Discover overlay is now an ornate, gold-framed parchment panel —
  a layered gold border, a "Discover" banner plaque, blue gems above/below, a ✦-flourished subtitle,
  and each of the three cards in a **tier-coloured pulsing glow** (green/red/purple by tribe). New
  classes (`.disc-panel`/`.disc-banner`/`.disc-gem`/`.disc-sub`/`.disc-slot`) so the Choose-One overlay
  (which shared `.discover-box`) is untouched. Verified live: panel + banner + 2 gems + tribe-tinted
  glows render.
- **Game-over button centered.** `.btn` is `display:flex` (block-level), so the box's `text-align:center`
  never centered it — it sat full-width/left. Made `.over .box` a centered flex column; verified the
  box centers in the window and the button centers in the box (and the real "Begin a New Ascent" path
  resets cleanly, no crash).
- **End-of-Turn plays out one card at a time.** Reworked the End-Turn telegraph: instead of flashing
  all End-of-Turn minions at once, each fires **individually in sequence**, and **repeats
  `chronosRepeats` times** when a Chronos is in play (mirrors `applyEndOfTurn`'s per-card-then-repeat
  order; `chronosRepeats` is now exported from `@game/sim`). Each beat flashes the proc flourish under
  its card plus a tailored effect — **Ritualist** washes the whole shop purple (it buffs the Fodder
  there; new `.shopflash` over the tavern), **Combinator** crackles electricity over the two Mechs it
  magnetizes onto (new `electrify` prop reusing the `crackle` keyframe). Plus a short "proc" shimmer
  per beat. Then it faces the Omen. Verified live (Ritualist×2 + shop flash, then Combinator×2 +
  electrified Drone & Money Bot, → combat).
- Added a **DEV-only `window.useGame` handle** (stripped from production) to stage UI states from the
  console for verification.
- `typecheck` + `lint` + `test` (**116**) + `build:web` + `package:itch` clean.

### Triple Reward glow + itch.io packaging
- **Triple Reward card glow.** The Discover/triple-reward spell now wears the **golden frame + gold
  text box** (like a tripled minion — gold border, gold body tint, gold name pill + footer) and a
  **bright, vibrant orange glow that pulses** (`.card.triplecard`, keyed off the `discoverspell` id,
  overriding the generic purple spell look). Verified live: rules present + `tripleglow` animation active.
- **itch.io packaging.** The production build now uses a **relative base** (`base: './'` on `build` only;
  dev stays absolute) so every asset resolves from itch's CDN sub-path. Confirmed the output is fully
  relative — `index.html` → `./assets/…`, CSS → `../board.jpg` / `../cursors/…`, JS art via
  `import.meta.url`, no leading-slash refs. Added `npm run package:itch` (build + a small PowerShell
  zipper, `scripts/package-itch.ps1`) that emits **`ascent-itch.zip`** with `index.html` at the zip root
  and **forward-slash entries** (PowerShell's `Compress-Archive` writes backslashes, which break on
  itch's Linux unzip — the script writes the zip manually to avoid that). Upload that zip to itch.io as
  an HTML game with "play in browser". (Zip + dist are gitignored.)
- `typecheck` + `lint` + `test` (**116**) + `build:web` clean.

### Golden-magnetize Discover, beefier Reborn tears + Venomous drip, Triple Reward rename/art/dynamic text
- **Golden Magnetic now grants its Discover.** Welding a golden Magnetic minion (e.g. a tripled Cling
  Drone) onto a host returned early in the reducer, skipping the `grantGoldenDiscover` that a normal
  golden play runs — so you lost the triple reward. The magnetize merge path now grants it too. Tested.
- **Reborn tears are punchier** — bigger (11×15), brighter, faster cadence, and **6** particles (was 4)
  so several drift at once instead of one-at-a-time. (Per the user — they like the effect.)
- **New: Venomous drip.** Cards with Venomous now constantly drip green venom globs (form → swell →
  elongate → fall), keyed off the `V` keyword. No rim glow (per the user) — just the drips. Same overlay
  pattern as the Reborn tears; shows in the shop, on granted-Venomous minions, and on combat venom units.
- **Glimpse Beyond → Triple Reward.** Renamed the Discover spell, wired its art from the Spells source
  folder (`art/minions/discoverspell.png`), and made its text **name the exact tier** it Discovers from:
  `Discover a Tier {min(6, currentTier + 1)} minion` — recomputed from the live shop tier (so it reads
  "Tier 2" on tier 1, "Tier 6" on tier 6). Matches the actual `offerDiscover` formula.
- `typecheck` + `lint` + `test` (**116**) + `build:web` clean; rename + art + dynamic-text formula +
  CSS verified live, no console errors.

### Heckbinder dual-tribe fix, mana tooltip, golden-text correctness + full fill, Reborn FX, Esc resolution menu
- **Magnetize onto Heckbinder now works.** `magnetizesTo()` was checking only the *target's* primary
  tribe, so a Mech-magnetic card (Cling Drone) couldn't weld onto Heckbinder (primary tribe Demon).
  It now intersects BOTH cards' tribe sets — Heckbinder counts as a Mech, so anything Mech-magnetic
  attaches to it (and it still attaches to a Mech or Demon).
- **Dual-types count as both tribes for buffs**, not just magnetizing. Added a combat `Minion.tribe2`
  (from the def) and taught the tribe-buff sites (combat: buff-tribe, AoE-per-tribe, shield-tribe;
  recruit: battlecry/deathrattle buff-tribe, Combinator's auto-magnetize) to match either tribe.
  Regression-safe — single-tribe cards have `tribe2 === undefined`. Tested (Cling→Heckbinder merge;
  Heckbinder shielded by Omega Bulwark's Mech grant).
- **Mana projection tooltip** ("coming up") icon was tinted `--acc` (orange), reading as an ember —
  now `--mana` teal, matching the chip.
- **Golden text correctness.** The naive number-doubler mis-rendered cards whose golden form changes a
  *count* or needs plural grammar. Added an explicit `CardDef.goldenText` (+ zod, threaded through the
  card views) used verbatim when golden: **Buddy Buddy** (add *two* minions), **Soulfeeder** (add *2*
  Fodder), **Combinator** (*two* Drones), and grammar fixes for **Drakko/Sylus/Chronos/Echo** ("1 more
  time" → "2 more times"). Summon cards whose counts *don't* change when golden (Alleycat, Pack
  Scrounger, Brood Matron, Wildwood Shaper) are already correct under the doubler, so they're left.
- **Golden box fills the whole card.** Tinted the `.card.golden` background gold (the body shows it
  edge-to-edge) and dropped the inset description panel, so the entire text area reads gold (+ gold
  footer, on top of the existing gold name pill).
- **Reborn FX upgraded.** The blue aura now also washes OVER the art (screen-blend, like Divine Shield)
  and the whole card pulses; added drifting spectral "tear" particles (staggered, ~one at a time) for
  life. All keyed off the `R` keyword, so they vanish the instant a minion Reborns in combat.
- **Esc menu + resolution scaler.** New pause/settings overlay (Esc key or a bottom-right gear) with a
  display-resolution picker: **Fit to Window / 1920×1080 / 2560×1440 / 3440×1440**. The whole game now
  renders into a centred "stage" box driven by `--gw`/`--gh`; the card/chrome scaling keys off the box
  (not the raw viewport), so picking a fixed 16:9 / 21:9 size letterboxes the rest against a dark frame.
  No transform-scale, so drag + pointer math are untouched; window-edge HUD (status tray, hand, timer,
  combat log) is offset into the box by `--bar-x/--bar-y`. Choice persists (localStorage). Verified
  live: fit = full window; on 1080p, 16:9 fills + 21:9 letterboxes to aspect 2.333; menu applies +
  persists; no console errors.
- `typecheck` + `lint` + `test` (**115**) + `build:web` clean.

### Rope width cap, +30% proc flourish, golden/Reborn card cues, Reborn-at-base, dual-type Heckbinder
- **Rope no longer scales with the monitor.** It was `width: 86%` of the viewport, so it stretched
  edge-to-edge on wide screens. Capped to `min(1180px, 92vw)` (the board's content frame) — verified
  live: on a 1907px monitor it renders at exactly 1180px instead of ~1640px.
- **Proc flourish ~30% more noticeable.** The under-card Battlecry / End-of-Turn sigil (`.bcryfx`)
  got bigger + brighter: glow 46→60px (expand 1.55×→2×), motes 9→12px with a larger halo, travel
  40→52px, hotter core mix.
- **Golden (tripled) cards read at a glance:** the name pill is now a filled gold gradient (not just
  gold text) and the description sits in a soft gold panel, with a gold-tinted footer.
- **Reborn cards show a pulsing blue aura** (`.card.reborncard`, keyed off the `R` keyword) — recruit
  + combat. In combat it drops the instant the minion Reborns (it sheds `R`), so the glow marks "one
  revival left."
- **Reborn now returns at BASE stats.** A minion that died Reborn used to come back at its current
  (buffed) attack and 1 health, keeping granted keywords. Now it returns at its *printed* card stats
  and base keywords — shedding all combat buffs and granted effects (Divine Shield, etc.); golden
  returns at doubled base. So a 2/1 buffed to a 10/3 Divine-Shield body comes back a plain 2/1. The
  `reborn` event now carries `attack` + `keywords` so the combat replay applies the reset. (This is
  the "combat stats are temporary" rule; recruit-permanent stats live on the run board, untouched.)
  Tested (base reset, granted-DS shed, golden = 2× base).
- **New: Heckbinder** (T4 Demon/Mech, 3/3, Magnetic) — the first **dual-type** minion. Added
  `CardDef.tribe2` (+ zod schema); a Magnetic minion now welds onto any friendly minion sharing one
  of its tribes (new `magnetizesTo()`), so Heckbinder merges onto a **Mech or a Demon** (Cling Drone
  still Mech-only). Renders the split-hue card + a "Demon / Mech" footer. Art wired. Tested
  (magnetizes to demon + mech, not beast).
- **Mechanics checks (items 5 & 6):** there's currently **no way to destroy a board minion during
  the shop phase** (selling removes it without a Deathrattle; Consume eats tavern Fodder; triple /
  magnetize aren't destroys), so those rules have no trigger yet. The model they describe already
  holds: recruit-phase Deathrattle factories apply *permanent* stat changes, and combat buffs are
  combat-only (now reinforced by Reborn-at-base). The "Reborn lost permanently unless tripled" rule
  would need a per-card flag + restore-on-triple once a shop-destroy mechanic exists — flagged for
  the user.
- `typecheck` + `lint` + `test` (**113**) + `build:web` clean; rope cap + Heckbinder load verified
  live, no console errors.

### Better burning-rope timer — real flame + braided fuse, repositioned to clear the rows
The last-15s turn timer rope was a thin faint line with a small round glow dot crammed against the
tavern row. Rebuilt it:
- **Braided fuse** (rounded, diagonal-strand texture with top highlight) instead of a flat line, and
  a **charred trail** behind the flame (dark, with a glowing ember edge right at the burn point).
- **A real flame** at the burn point: a warm halo, a flame-shaped body, a hot inner core, and three
  rising **ember** sparks — all flickering. Replaces the single radial dot.
- **Repositioned**: more vertical margin so the fuse sits centred in the tavern↔warband gap (was
  cramped against the tavern). Tuned the flame height + margin so the flame licks up to exactly the
  tavern row's bottom with **0px overlap** (measured live: 22px below the tavern, 16px above the
  warband). All sizes scale with the `--u` chrome unit.
- `typecheck` + `lint` + `build:web` clean; verified live (rope + flame parts render, correct burn
  position, no console errors).

### Triage: Soulfeeder "procs every round" — engine is correct; fixed frozen-tavern Fodder stranding
Reported: Soulfeeder seems to proc every round after one play. Triaged with deterministic tests:
- **The engine procs Soulfeeder exactly once.** A multi-round test confirms its attack goes
  `2 → 3 → 3 → 3 → 3` (eats one queued Fred on the first refresh, never again) and `pendingTavern`
  is `['fred']` then `[]` forever. `refreshTavern` clears the queue after injecting, so there is no
  per-round re-proc in the simulation.
- **Real related bug found + fixed: a frozen tavern stranded the queued Fodder.** When you froze,
  `advanceAfterCombat` took the `topUpTavern` path, which never injected/consumed `pendingTavern` —
  so a Soulfeeder-queued Fred was stuck forever (the *opposite* of "every round," but a genuine bug).
  Extracted `injectPendingTavern()` and now run it on **both** the reroll and the frozen carry-over,
  so the promised Fred always arrives (and is eaten) exactly once. Tested (frozen delivery + the
  once-only multi-round case).
- **The "every round" visual could not be reproduced.** The two candidate animations both fire once
  by construction: the Fodder eat-swirl is gated by `fodderEatenSeq` (bumped only on a real consume,
  i.e. once), and the Battlecry flourish is gated by a played-uids set (`prevBoardUidsRef`, which
  retains the card across the combat→recruit round-trip). Instrumented both + attempted a live
  repro; no re-fire observed. Awaiting a repro clip / details from the user to pin any visual.
- `typecheck` + `lint` + `test` (**110**) clean.

### Chronos (End-of-Turn doubler) + a real fix for the return-to-shop minion flicker
- **Return-to-shop flicker — root cause found + fixed.** Frame-by-frame capture of the combat→recruit
  return showed the warband card playing `boardreset` cleanly (opacity 0.45→1)… and then, at ~650ms
  when the `resetting` class was *removed*, its `animation` reverted to the base `cardpop` and
  **re-fired from opacity 0** — a second flash. The toggle itself was the bug: changing a card's
  `animation` property (boardreset ↔ cardpop) restarts it. Fix: **drop the `resetting`/`boardreset`
  toggle entirely** — the warband re-mounts and re-enters via the base `cardpop` once (no class to
  toggle, so it can't re-fire), and the stat snapshot is re-synced on the transition so the green
  buff-flash doesn't spuriously fire on the cards coming back in. Verified by capture: a single
  `cardpop` 0→1 that settles at 1.0 with no second flash (previously opacity dropped back to 0 at
  650ms). No console errors.
- **New: Chronos** (T5 neutral 1/6) — *your End-of-Turn effects trigger 1 more time* (golden: 2 more;
  multiple Chronos do **not** stack — best one counts, mirroring Drakko). `applyEndOfTurn` now repeats
  each end-of-turn effect `chronosRepeats(state)` times, so e.g. Ritualist with a Chronos buffs Fodder
  +2/+2 per turn, Combinator welds two rounds of Cling Drones, etc. Art wired. Tested.
- `typecheck` + `lint` + `test` (**108**) + `build:web` clean.

### Fix: end-of-turn proc flourish now actually shows; smooth board return from combat
Two follow-up fixes to the previous batch.
- **End-of-turn flourish was invisible.** It was triggered on *combat entry*, but the warband flips
  from recruit `Card`s to combat `Unit`s the instant the phase changes — so the cards being flashed
  no longer existed. Now **End Turn** plays the flourish on the still-mounted recruit board first: if
  any minion has an End-of-Turn effect, those minions flash the Battlecry-style `.bcryfx` sigil for a
  ~620ms beat, *then* `faceOmen` fires (effects resolve + combat). Boards with no End-of-Turn card go
  straight to combat as before. (The effects themselves always resolved in `faceOmen` — this is the
  missing visual.)
- **Board "flash/jank/reset" returning from combat.** Every `.card` plays `cardpop` on mount, and the
  warband cards re-mount when returning from combat (they were `Unit`s). The `resetting` class (which
  overrides `cardpop` with `boardreset`) was set in a `useEffect` that runs *after* the cards already
  painted `cardpop`, so the two animations raced. Fixed by setting `resetting` in a **`useLayoutEffect`
  (before paint)** so the board paints `boardreset` directly, and softened `boardreset` to a calm
  rise-in (no scale-overshoot bounce). Verified live: the returning warband card's computed animation
  is `boardreset` (not `cardpop`), with no console errors.
- Confirmed for the user: the **minion caps are all enforced** — board 7 (play, recruit summon, and
  combat summon all gate on it), hand 10, mana/gold cap 10, tier 6.
- `typecheck` + `lint` + `build:web` clean; combat round-trip verified live.

### 5 new cards + Venomous (Poison rework) + end-of-turn proc anim + mid-combat buff display fix
A big content + mechanics batch.
- **Poison → Venomous.** The keyword is renamed everywhere (code `'P'` → `'V'`, schema, all card data,
  threat templates, UI labels/tooltips, CSV, tests) and its mechanic changed: **Venomous drops off
  after its first proc in combat.** When a unit's venom destroys a target (the poison event fires),
  that poisoner loses `V` and emits a new `venomLost` combat event; the UI removes the badge mid-fight.
  So a Venomous body is a one-shot per fight (unless re-granted). Tested (one-proc-then-survives).
- **Buddy Buddy** (T3 neutral 3/4) — Battlecry: add a random Tier 1 minion to your hand (golden: two).
  New recruit factory `battlecryGainRandomMinion` (draws from the run's buyable T1 pool, honors the
  hand cap, uses the shop RNG). Fires through Drakko like any Battlecry.
- **Combinator** (T5 Mech 6/7) — End of Turn: magnetize a Cling Drone (+2/+2) onto 2 *other* friendly
  Mechs (golden: 2 drones each → +4/+4). New `endOfTurnMagnetizeMechs`.
- **Grim** (T6 Beast 7/1) — Deathrattle: give your Beasts +6/+6 for the rest of combat (golden +12/+12).
  Reuses the existing `deathrattleBuffTribe` (data-only).
- **Karwind** (T6 Dragon 2/12) — whenever a Battlecry *triggers*, give your Dragons +1/+2 (golden +2/+4).
  New `battlecryTriggered` recruit event, fired once per Battlecry resolution — **including each Drakko
  repeat**, so a doubled Battlecry procs Karwind twice. New `onBattlecryBuffTribe`. Tested (incl. Drakko).
- **Money Bot** (T3 Mech 3/3, Magnetic) — while on your board, **+1 max mana per turn** (golden +2). A
  board-derived economy: the per-turn embers are recomputed each turn as `maxEmbers + boardManaBonus`
  (a new `CardDef.manaPerTurn` + a `BoardCard.manaBonus` for the absorbed amount). Magnetizing it into a
  Spare Part Drone transfers the income onto the host, which survives the host's triple; selling the host
  removes it. The mana projection tooltip folds it in. Tested (on-board, magnetize-transfer, sell-removal).
- **End-of-turn proc flourish.** Cards whose End-of-Turn effect resolves (Ritualist, Combinator…) now
  flash the same under-card sigil as a Battlecry, on the board through the shop-closing beat.
- **Mid-combat buff display fix.** A multi-proc deathrattle (e.g. Spirit of the Pack re-procced by Sylus
  for +12/+12) showed three separate "+4/+4" floats; the combat replay now **sums buff events per target
  within a beat** and shows one correct "+12/+12" per minion. (Stat badges were already correct.)
- All 5 sprites wired (BuddyBuddy / Combinator / Grim / Karwind / MoneyBot). `typecheck` + `lint` +
  `test` (**107**) + `build:web` clean; live: cards load with the right stats/art, combat replays with no
  console errors, the End-of-Turn banner + flourish fire.

## 2026-06-17

### Bug-fix + juice batch — freeze refill, end-of-turn feel, combat grants, end-game fix, sounds
An eight-item batch of fixes and feel polish.
- **Frozen taverns top up.** Freezing a partial shop (you'd bought some minions, or the spell)
  used to carry it over with the gaps; now after combat a frozen tavern fills its empty minion
  slots back up to the tier count and re-adds a spell if missing, keeping every frozen offer in
  place. New `topUpTavern()` shares the weighted-draw helper with `rollShop` (refactored out a
  `drawOfferId`). Tested.
- **A clear "End of Turn" beat.** Ending the turn already fired end-of-turn effects (`faceOmen` →
  `applyEndOfTurn`); now a brief centred **"End of Turn"** banner plays on the recruit→combat
  transition so it reads. (Verified live.)
- **Fodder eat animation shows what was eaten.** A Demon devouring tavern Fodder showed a 1/1 ghost
  even when Ritualist had buffed it. The consume record (`fodderEaten`) now carries the Fodder's
  *effective* stats, the ghost renders them (green vs. the 1/1 base), the swirl is **slower** (1.35s
  → 2.2s, holding full-size so the stats read), and it's wreathed in **orbiting purple orbs**.
- **Combat hand-grants pop in.** A card a combat Deathrattle adds to your hand (Arcane Weaver →
  Spirit Fire) now flashes an accent glow as it arrives — the hand is snapshotted on entering
  combat, and the new uids afterward are flagged as grants.
- **End-game state fixed.** The game-over overlay (`.over`) had no `z-index`, so the live board's
  positioned chrome (hand z-25, status z-40, timer z-80, …) painted *through* it — the "busted" end
  screen where the board showed on top. It's now `position: fixed; z-index: 300` (above all chrome)
  with a near-opaque scrim, so it cleanly covers + blocks the dead board. (Verified the rule live.)
- **Imp Scrap** is a plain 1/1 with no keyword/Fodder interaction — its misleading "…meant to be
  eaten" body text is now blank.
- **A "wrong" sound on rejected actions.** A buy/play/roll/upgrade you can't afford (or that's
  otherwise a no-op — the reducer returns the same reference) now plays a low descending **deny**
  buzz instead of the success blip.
- **Battlecry flourish.** Playing a minion whose Battlecry fires now swells a tribe-tinted sigil
  from *under* the card with sparks fanning out — detected by diffing the board for a new card whose
  def has an `onPlay` effect (or Choose One). (Verified live on Soulfeeder.)
- `typecheck` + `lint` + `test` (**100**) + `build:web` all clean; no runtime console errors.

### Buttery drag — memoize Card so the board doesn't re-render on every pointermove
Dragging a card fired `setDrag`/`setOverZone` on every pointermove, re-rendering the whole recruit
tree — including all 7–14 `Card`s (each an `<img>` + pills + `dangerouslySetInnerHTML` text). Now:
- **`Card` is wrapped in `React.memo`** and its props are stabilized so the memo actually fires:
  - The per-card **view objects** are hoisted into `useMemo` maps keyed by uid
    (`shopViews` / `boardViews` / `handViews` + a `spellView`), recomputed only when the underlying
    `run.*` slice changes. During a drag nothing dispatches, so those refs are stable → the maps
    return the *same* `CardView` object for each card across pointermove re-renders.
  - The per-card `beginDrag(uid, source, view)` factory (a fresh closure every render) is replaced by
    **one stable `onCardPointerDown`** shared by every card: it reads the grabbed card's uid + zone
    from the DOM and its view from a ref, so its identity never changes mid-drag. (Hand cards now also
    carry `data-uid` so the handler can resolve them.)
- **Result (measured live):** 10 pointermoves during a drag caused **2 total card re-renders** (the
  dragged card's dim-flip + the floating card mounting once) — ~0.2/move, vs. ~one-per-card-per-move
  before. The per-second turn-timer tick also no longer re-renders the cards.
- The drag *mechanics* (`onMove`/`onUp`/`applyDrop`) are untouched, so behavior is unchanged.
  **Verified** end-to-end with synthetic pointer drags: buy (tavern→hand, −3 mana), play
  (hand→warband), and sell (board→tavern, +1 mana) all still work; the floating card appears/clears
  correctly. `typecheck` + `lint` + `test` (99) + `build:web` all clean; no runtime console errors on
  a fresh load. (Note: editing `Card.tsx` now full-reloads in dev rather than hot-swapping — Fast
  Refresh bails on a memo-wrapped export in a file that also exports helpers; harmless, dev-only.)

### Proportional chrome — HUD / controls / status tray / overlays scale with the viewport
The cards already scale with viewport height (`--ch`), but the chrome was fixed-px, so on big
monitors the HUD/buttons/fonts looked comparatively tiny (a flagged backlog item).
- **New scaled unit `--u: clamp(1px, 0.107vh, 1.34px)`** — a "scaled pixel" with a **1px floor**
  (so laptops and short windows read *exactly* as before — zero regression at ≤~935px tall) that
  grows to **+34%** on tall monitors (1440px+). Chrome dimensions are expressed as `calc(N * var(--u))`
  so every piece scales by the same factor and stays proportional to the cards.
- **Converted:** the top HUD (wordmark, wave meter, tribes, mute), the round turn-timer, the bottom
  status tray (Resolve bar + value, the hero/power panel + portrait, the Ember/Mana chips — including
  the larger "hero-sized" overrides), zone headers, the tavern controls (Refresh/Freeze/Tier/End Turn
  + the Tavern-tier label), the result toast, and the two modal overlays (Combat Log + Discover /
  Choose One). The combat arena's intentionally-huge post-fight buttons (`.cbtns .btn.big`, 32px) keep
  their fixed size via the more-specific selector — they're sized for combat readability, not chrome.
- **Verified** objectively via the preview (resize + `getComputedStyle`, no screenshots needed):
  at 800px tall every value equals its original px (wordmark 19, big button 17, status-chip value 34,
  hero name 23, hero portrait 80×80, Resolve value 28); at 1440px tall all scale by ×1.34 in lockstep
  (25.46 / 22.78 / 45.56 / 30.82 / 107×107 / 37.52). Overlay rules parsed correctly; `build:web` +
  `lint` clean; no console errors.
- Also scouted the **minion-art backlog**: every source illustration that maps to an existing card id
  is now wired (21 cards); the leftover source art (`Combinator`, `Grim`, `Karwind`) has no matching
  card, so it needs a card decision, not just wiring. **Art→WebP compression** is blocked on tooling
  (no encoder installed) — noted in the roadmap.

### Arcane Weaver + Ritualist, board dust, drag float, simultaneous deathrattle buffs, 2 sprites
A seven-item content + polish batch.
- **New: Arcane Weaver** (Tier 4 Dragon, 3/4) — **Deathrattle: add a copy of Spirit Fire to your
  hand.** Combat can't touch the recruit hand, so this is a *carry-back*: a new combat factory
  `deathrattleGrantSpell` calls `ctx.grantToHand(cardId, side)`; `simulate()` accumulates player-side
  grants into `CombatResult.playerHandGrants`, and `advanceAfterCombat` pushes each into the hand
  after the replay (win or lose, capped by `handMax`). Golden Weaver grants two; an enemy Weaver
  grants the player none. Art wired.
- **New: Ritualist** (Tier 5 Demon, 2/5) — **End of Turn: all Fodder gets +1/+1, wherever it is.**
  This is a *persistent per-cardId run buff*: a new `RunState.cardBuffs` map (`cardId → {atk,hp}`)
  is folded into **every** instantiation of a card — bought (`buy`), summoned/conjured (recruit
  `summon`), discovered (`discover`), the demon-consume math (`consumeTavernFodder`), and the live
  tavern display (`shopView`) — so a Fodder from *any* source carries the accrued buff. The new
  recruit factory `buffFodderEverywhere` (fires on `endOfTurn`) bumps `cardBuffs` for every
  FD-keyworded card and immediately buffs the Fodder already on the board / in the hand. Golden
  doubles; multiple Ritualists stack. Art wired.
- **Board dust** — a soft, earthy puff of motes kicks up on a primary click of the *empty board*.
  A `puffBoard` handler on the `.app` root ignores any click whose target is a card or control
  (`.card, button, a, input, [role=dialog], .bar, .rtimer, .shopctl`) and is suppressed while
  aiming the Hero Power or dragging — so it reads as touching the table, never a card. Purely
  cosmetic (mirrors the spell-spark pattern; doesn't block other handlers).
- **Drag float** — the dragged card now follows the cursor on a whisper of lag (`.dragcard`
  `transition: transform 0.08s ease-out`) instead of being rigidly pinned; `.snap` / `.magslide`
  still override with their own transitions.
- **Simultaneous multi-target deathrattle buffs** — `buildBeats` now collapses a *run of
  consecutive `buff` events* into one beat, so an effect that buffs many minions at once (Spirit of
  the Pack giving every Beast +4/+4, a Rally aura) flashes them all together rather than one at a
  time. (Previously each buff was its own beat → sequential.)
- **Sprites wired:** Spirit of the Pack (`pack6`) and Cling Drone (`cling`) now have art.
- **Tests (+5, 99):** Arcane Weaver reports a Spirit Fire grant (golden → two; enemy-side → none);
  Ritualist's End of Turn buffs Fodder on board + in hand and sets the run buff; a Fodder bought or
  consumed after a proc carries it. `typecheck` + `test` (**99**) pass; live (fresh dev server):
  both card defs load with the right effects, all four sprites resolve via `artFor`, the drag
  transition + `.boarddust` rule are in the live stylesheet, a background click puffs (6 motes,
  auto-expires) while a card click does not, and a Spirit-of-the-Pack death emits the two
  consecutive `+4/+4` buff events the new beat-grouping collapses.

### Mana Pouch + Drakko + Sylus, spells play "upward", CSV by type with golden column
- **`docs/cards.csv` reorganised** into `# === TRIBE ===` sections, with new **`golden_text`** +
  **`golden_effect`** columns so the *tripled* version of every card is visible for triage (incl.
  the gotchas — e.g. word-count summons like "summon a Stray" don't auto-double their text, and 3
  summoned tokens trigger their own triple).
- **Spells play anywhere from the warband up.** Dragging a spell up to the tavern now casts it
  (you can't sell spells, so the old snap-back was just annoying). A targeted spell hits the minion
  under the cursor, or auto-targets your **carry** (highest-Attack) when flung up with no minion
  under it; untargeted spells just resolve. Spells no longer show the "Sell +1" glow over the tavern.
- **Ember Pouch → Mana Pouch** (id stable), art rewired. ✓ live (name + art).
- **Doublecast Drummer → Drakko the Drummer**, moved to **Tier 5**, art rewired. The golden version
  **triples** Battlecries (fires 3×), and **multiple Drakkos do NOT stack** (only the best one
  counts; golden = +2, else +1). New `drummerRepeats` helper used by both the play + Choose-One paths.
- **New: Sylus the Reaper** (Tier 5 neutral) — "In combat, your Deathrattles proc 1 more time."
  Golden procs **2 more**, and **multiple Sylus stack** (additive). Combat re-runs the dying minion's
  own onDeath effects `bonus` extra times. Art wired.
- **Tests (+4, 94):** golden Drakko triples / multiple Drakkos don't stack; Sylus re-procs a
  Deathrattle (golden +2, and stacks). `typecheck` (+web) + `lint` + `test` (**94**) + `build:web`
  pass; live: Mana Pouch shows its new name + art, no console errors.

### Choose One, bolder DS glow, slower Magnetic/Fodder, cards CSV
- **Choose One** wired. A card can carry `chooseOne: [{ text, effects }, …]`; playing it defers the
  Battlecry, opens a modal of the options, and the picked option's `effects` resolve as the Battlecry
  (honors Doublecast Drummer; a golden Choose-One still grants its Discover after the pick). New
  `CardDef.chooseOne` (+ zod), `RunState.chooseOne` + a `chooseOne` action, `applyChooseOne` in
  recruit, the reducer flow, and a Choose-One overlay (two big option buttons). Sample card added —
  **Wildwood Shaper** (T2 Beast: "give your Beasts +1/+1" or "summon two 1/1 Strays"). 2 tests.
- **Divine Shield — way more recognizable.** Dropped to a glow but made it bold: a bright soft-yellow
  **halo + ring around** the card *and* a glowing screen-blend **wash on top** (concentrated over the
  art so text stays legible), pulsing — reads at a glance across the board.
- **Slower Magnetic + Fodder animations.** The Magnetic slide is 0.36 s → **0.72 s** (and the merge
  fires at 720 ms), and the Fodder swirl 0.8 s → **1.35 s** (ghost held to 1.4 s) — clearer what's
  happening.
- **`docs/cards.csv`** — every card (minions, spells, tokens) as editable rows: id, name, kind,
  tribe, tier, atk/hp, cost, keywords, text, an effect note, and whether art is wired. Add rows at
  the bottom for new cards; I apply edits back into the content `.ts` files.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**90**) + `build:web` pass; live: the DS card
  shows the strong yellow halo + on-top wash, no console errors. (Choose One is covered by unit tests
  — it needs a Tier-2 board to trigger in the live UI.)

### DS = golden glow only, Rally keyword, buff-replay fix, smoother Magnetic
- **Divine Shield** — dropped the overlay art entirely; a shielded card now just gets a **soft golden
  glow** (`.card.dscard`, an outer + inner glow with a gentle `dsglow` pulse, recruit + combat).
- **Rally keyword** wired (`RL`): combat now emits `onAttack` per swing, so an `{ on: 'onAttack' }`
  effect fires when a minion attacks. Added the keyword (core type + zod schema + pill/tooltip "Rally
  — Triggers each time this attacks") and a default `rallyBuff` combat factory (on attack, buff your
  other minions +atk/+hp; golden ×2). Ready for content — no card declares it yet.
- **Buff-replay fix** — grabbing a minion mid-buff-flash and moving it replayed the buff animation
  when the card re-mounted (lift-out → drop). `beginDrag` now clears the dragged uid from
  `buffedUids`, so it doesn't re-trigger.
- **Magnetic slide cleanup** — the merge animation was janky. Now when the slide starts the warband
  **settles** (the shove slot closes) and the held card **shrinks straight into the Mech** (scale →
  0.32, no tilt, 0.36 s) with the electric crackle, then merges. Tighter timing (360 ms).
- **Ember Pouch** text "Gain 1 Ember" → "Gain **1 Mana**" (Mana rename consistency).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**88**) + `build:web` pass; live: a shielded
  card shows the golden `dsglow` (no overlay art), no console errors.

### New DS art + glow, live combat buffs (Kennelmaster), additive Echo Warden, Magnetic slide
- **Divine Shield** — re-wired the new (square 1024²) effect art at `scale(1.06)`, and added a **soft
  yellow glow fill** on any card with Divine Shield (`.card.dscard` — an outer glow + inner art-panel
  glow, shared by recruit + combat; dropped the old combat-only box-shadow).
- **Live combat card state (Kennelmaster).** Combat cards were static — a golden/avenged Kennelmaster
  showed "+1/+1" and no golden frame. Now `MinionSnapshot` carries `golden` + `summonBonus`, the
  replay folds `improve` events into a unit's live `summonBonus`, and `Unit` renders the golden
  treatment + the **current** buff magnitude (via a shared `summonBuffText` helper used by recruit and
  combat). So a Kennelmaster's text now climbs mid-fight as Avenge fires (+6/+6 → +7/+7 …) and reads
  golden. (General groundwork — other live-updating combat cards can reuse it.)
- **Echo Warden is additive, not multiplicative.** It now adds *extra* summoned tokens rather than
  re-running the summon: Pack Scrounger (2 Pups) + one Echo Warden → **3** Pups (not 4). A **golden**
  Echo Warden adds **2** ("1 more" → "2 more"). Replaced `echoReps` (×) with `echoBonus` (+).
- **Magnetic slide.** A Cling Drone dropped on a Mech now **shoves the warband aside** (a slot opens),
  then the held card **slides into the Mech** (left→right) with the electric crackle before the merge
  lands — instead of vanishing instantly. (`onUp` animates the floating card into the target Mech,
  then dispatches the merge.)
- **Tests (+1, 88):** golden Echo Warden adds 2 (the existing Echo test became the additive +1 case).
  `typecheck` (+web) + `lint` + `test` (**88**) + `build:web` pass; live: DS art loads (512²) with the
  yellow glow, combat renders cleanly via the new Unit code, no console errors.

### Tripling a summon-buff card combines its accrued buffs (Kennelmaster)
- **Bug:** tripling a buffed Kennelmaster dropped its Avenge buffs — the golden showed only +2/+2
  (golden ×2 of the base) instead of combining the copies. Two Kennelmasters at +6/+6 and +4/+4
  should triple to **+10/+10**.
- **Fix:** the summon-buff magnitude now **combines like a stat on triple**. `checkTriples` carries
  a new `summonBonus = base + (top-two combined bonuses)` onto the golden, and the separate golden
  ×2 was removed from `buffOnSummon` (both the combat and recruit factories) — the combine *is* the
  doubling. So a fresh triple still doubles the base (1+1 → +2/+2; Bristleback 2+2 → +4/+4), while
  two boosted copies sum (6+4 → +10/+10). `doubleNums` now skips `{{…}}` markers so a golden
  Kennelmaster's already-final magnitude isn't doubled again in the text.
- **Combat log already covers it.** Every combat event prints to the Combat Log (the verbose
  `narrateLog` handles attack/dmg/shield/poison/reborn/death/summon/**buff**/**improve**…), so a
  beast getting buffed and Kennelmaster's Avenge "aura strengthens" both show as lines — useful for
  triage, as requested. (The `improve` line was added in the prior commit.)
- **Tests (+2, 87 total):** tripling two boosted Kennelmasters yields a golden with `summonBonus` 9
  (→ +10/+10); a golden Kennelmaster grants its full +10/+10 (no double-counting). `typecheck`
  (+web) + `lint` + `test` (**87**) + `build:web` pass; the bot plays full runs deterministically;
  app loads clean.

### Kennelmaster Avenge text/anim, DS scale nudge
- **Kennelmaster reflects its Avenge boost.** Its board card now shows the *current* summon-buff
  magnitude (`+1/+1` → **`+2/+2`** at `summonBonus` 1, etc.), rendered **green** as a modified value
  (`instView` rebuilds the text with a `{{…}}` marker → `descUp()` in the Card → `.desc .descup`).
- **A combat pulse when Avenge triggers.** `avengeImproveSummon` now logs a new `improve` combat
  event; the replay pulses the Kennelmaster (✦ green float + a beat) and the log reads "…aura
  strengthens (+1/+1)." (New `CombatEvent` variant wired through the replay + harness narrators.)
- **In-combat escalation confirmed** — `buffOnSummon` reads the live `summonBonus`, which Avenge
  increments mid-fight, so a Beast summoned *after* the trigger gets the higher buff for the rest of
  that combat (and it persists onward).
- **Divine-Shield scale** nudged 1.32 → 1.18 (less overshoot). The real fix is matching-aspect art:
  the art panel is **5:4 (1.25:1)** but the source is 3:2, so `fill` distorts — a 5:4 frame
  (e.g. **1280×1024**, edge-to-edge, transparent centre) would fill it cleanly at scale 1.0.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; app loads clean,
  DS art renders at scale 1.18, no console errors.

### Buff-jank fix (root cause), new DS art, Omen art, 2× combat buttons
- **Buff "reset" jank — actually fixed this time (found the root cause).** The card visibly
  disappeared/reappeared *after* the buff animation. Cause: `.card` always carries
  `animation: cardpop`, but `.card.cardbuff` *replaced* it; when the buff class cleared, the
  `animation` property reverted to `cardpop`, which the browser treats as a newly-added animation and
  **replays** (cardpop fades in from opacity 0). Fix: list `cardpop` first in the `.cardbuff` rule
  (`animation: cardpop 0.26s ease, cardbuff 0.62s both`) so cardpop stays in the list across the
  toggle and never restarts. Verified with `getAnimations()`: after the class clears there are no
  running animations and the card holds `opacity: 1` (no replay). Covers the Fodder-eat path too
  (same `.cardbuff`).
- **New Divine-Shield art** — re-converted the updated `Effects/DivineShield.png` (still stretched to
  fill + scaled 1.32× to wrap the art panel, fully opaque).
- **Omen Minion art** — wired `OmenMinion.png` → `art/minions/omen.png` (id `omen`); the enemy filler
  now renders its illustration instead of the pixel sprite.
- **Combat buttons** — "Climb On" → **"End Combat"** (always); both post-combat buttons (Combat Log +
  End Combat) are ~2× larger (32px, scoped to `.cbtns` so the tavern controls are unchanged) with a
  wider gap so they never overlap.
- **Verified live:** Omen enemy renders `omen.png`; DS art loads at scale 1.32 / opacity 1; the two
  combat buttons are 32px and non-overlapping; buff no longer replays cardpop. `typecheck` (+web) +
  `lint` + `build:web` pass; no console errors.

### Cleanup — removed the dead recruit-consume path + the old arena CSS
Housekeeping from the two preceding reworks (no behaviour change):
- **Dead recruit-consume code gone.** The Fodder rework left the old board-consume path unused —
  removed `RECRUIT_FACTORIES.battlecryConsume` + `consumeFodderOnSummon`, the `consume()` context
  method, `fireDeathrattle`, and the `battlecryConsume`/`consumeFodderOnSummon` `EffectFactoryId`s
  (core type + zod schema). The on-consume *effects* (Pactstone/Maw/Glutton) and the `onConsume`
  event stay — they're fired by `consumeTavernFodder`.
- **Dead arena CSS gone.** Combat renders in-place now, so the old full-screen-arena rules were
  unused — dropped `.arena/.atop/.ascene/.asub/.side/.line/.clash/.skip/.endcombat` (+ `endpop`),
  the `.result/.verdict/.rres/.rwhy/.climb` result panel, `.ares`, and the legacy unit badges
  `.unit .nm/.tok/.ua/.uh/.kb`. Kept everything still live (`.unit.*`, `.float`, `.proj`, `.alog`,
  `boardshake`/`resulttint` keyframes). CSS bundle 42 → 37 KB.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; combat still renders
  (enemy units, banner, narration) with no console errors.

### Detailed combat log, Divine-Shield effect art, visible Fodder consume
- **Detailed combat log.** The post-combat log now spells out **every event with damage and the
  defender's remaining Health** — a new `narrateLog()` returns `{ text, kind }` per event (attacks
  with their swing, each hit "takes N (M HP left)", shields, poison, reborn, deaths, summons, buffs).
  Each line is colour-tagged by kind in the overlay (Start-of-Combat, attack, damage, death, shield,
  buff…). (The terse rolling in-combat line is unchanged.)
- **Divine-Shield effect art.** Wired the updated `art/effects/divineshield.png` as a `.dsfx` overlay
  that **wraps the square art panel** of any shielded card — shown everywhere a DS minion appears
  (shop, warband, combat), with a soft shimmer. Replaced the old combat-only golden box-shadow ring
  (now just a faint glow) since the art carries the read; the shatter-on-break stays.
- **Fodder consume is now visible.** It was resolving instantaneously (the player never saw it). Now
  `consumeTavernFodder` records each consume (`state.fodderEaten` + a `fodderEatenSeq` tick), and the
  UI replays it: a **ghost Fred pops into the tavern, then spins/shrinks/swirls into the Demon that
  ate it** (purple, ~0.8s), measured from the live DOM so it flies to the right minion. The Demon's
  buff proc still fires as it grows.
- **Verified live:** the DS art overlays the art panel exactly (155×124); the combat log shows e.g.
  "Omen Minion takes 1 damage (0 HP left)." / "Omen Minion is destroyed."; and a full
  buy-Soulfeeder → roll cycle shows the ghost **Fred** swirling into Soulfeeder (which grew 2/2 → 3/3),
  no Fred left as a static offer, ghost cleared after the swirl. `typecheck` (+web) + `lint` + `test`
  (**85**) + `build:web` pass; no console errors. (Screenshot tool was unresponsive this session, so
  checks were via the live DOM.)

### Kennelmaster — "Avenge (3): Improve this", permanent across the run
Reworked Kennelmaster to **"Each Beast you summon gains +1/+1. Avenge (3): Improve this."** The
Avenge boost is **permanent for the whole run** (the user's call), which meant threading per-instance
state through the pure combat boundary and carrying it back.
- **New per-instance `summonBonus`.** `BoardCard.summonBonus` (run) ↔ `BoardMinion.summonBonus` +
  `sourceUid` (combat input) ↔ `Minion.summonBonus` (combat-mutable) ↔ `CombatResult.playerSummonBonus`
  (carry-back). `buffOnSummon` (both the combat factory and the recruit one) now adds `summonBonus` to
  its per-stat magnitude, so the bonus raises every Beast the Kennelmaster summons.
- **New `avengeImproveSummon` factory** (combat): on every 3rd friendly death, while alive, it bumps
  its own `summonBonus` by 1 — improving every Beast it summons for the rest of the fight.
- **Carry-back + persistence.** `simulate()` reports each sourced minion's final `summonBonus` in
  `playerSummonBonus`; `advanceAfterCombat` writes it back onto the originating board card (matched by
  `sourceUid`), so the improved buff persists into future fights. `faceOmen` now also threads
  `golden` into combat (it wasn't before — a latent bug where golden minions didn't fire combat
  effects at 2×), so a golden Kennelmaster's summon buff doubles correctly.
- **Tests (85 total, +3):** a combat test (3 Taunt sandbags die first → Avenge fires once → `bonus: 1`
  in `playerSummonBonus`, deterministic because Taunts are targeted first), a run test that the
  recruit summon buff scales with the accrued bonus (Stray gets +3/+3 at `summonBonus: 2`), and a run
  test that `resolveCombat` persists the bonus onto the board card.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**85**) + `build:web` pass; the headless bot
  plays full runs (waves 8–10) deterministically with no crashes; the live app loads clean. Soulfeeder
  + Kennelmaster art were wired in the earlier UI commit.

### Fodder reworked — Soulfeeder seeds the tavern, Demons devour it (+ a real tavern refresh)
Redesigned the Demon Fodder loop per the user's new spec. Fodder no longer sits in your hand to be
played beside a Demon; it **arrives in the tavern** and your Demons **eat it automatically**.
- **Fred is out of the shop pool** (`token: true`) — it can't be rolled. It now only enters play
  from other sources (Soulfeeder), and its text says so.
- **Soulfeeder → Tier 1**, "**Battlecry:** add Fodder to your next tavern" (new
  `battlecryAddTavernFodder` effect → pushes `fred` onto `state.pendingTavern`; golden adds 2). No
  longer consumes a friend.
- **Voracious Imp → Tier 2**, "Gains **2x** stats from Fodder" (golden "**3x**"). Implemented as a
  new `CardDef.fodderMult` (Imp = 2; golden = base+1 = 3). The golden card-text transform learns the
  "Nx → (N+1)x" rule so the doubled text reads "3x".
- **A real "tavern refresh".** New `refreshTavern(state)` is the single tavern-population point —
  both the manual **Refresh** and the **post-combat** refresh route through it. It rolls the shop,
  injects any `pendingTavern` Fodder, then runs the auto-consume. (This is the hook the user wanted
  so future effects can interact with refreshes.)
- **Auto-consume (`consumeTavernFodder`).** When Fodder *enters* the tavern and you have ≥1 Demon on
  board, each Fodder is eaten by **one random Demon** (2 Demons + 1 Fodder → a seeded coin-flip). The
  eater gains the Fodder's stats × its `fodderMult`, and the **normal on-consume pipeline fires**
  (Pactstone Acolyte +1/+1, Maw of the Pit Divine Shield, Ravening Glutton +2/+2). Eaten Fodder
  leaves the tavern; with no Demon present it just sits there, buyable. Per the user's call, only
  Fodder *entering* the tavern triggers this — placing a Demon next to existing Fodder does not.
- **Tests:** replaced the 6 old recruit-consume tests with 7 covering the new flow — Fred not in the
  pool, Soulfeeder queues Fodder, a Demon devours tavern Fodder (Imp 2×, golden 3×), on-consume
  Demons pay off (Pactstone, Maw), and Fodder with no Demon stays. **82 tests pass.**
- **Verified live:** Soulfeeder renders as Tier 1 with the new text; Fred never rolled across several
  refreshes; Voracious Imp is absent at a Tier-1 shop (it moved to T2). `typecheck` (+web) + `lint` +
  `build:web` pass; no console errors. (The synthetic-drag harness was too flaky to build a full
  board live for an end-to-end consume, so that path leans on the unit coverage + the shared
  `refreshTavern`/`consumeTavernFodder` code.)

### Mana economy, teal cost, combat-log + banner polish, buff-proc fixes, board 1
The UI half of a large batch (the Fodder/Demon and Kennelmaster reworks land in following
commits):
- **Board 1** — reverted the play-surface backdrop to `board1.png` (the user preferred its aesthetic).
- **Embers → Mana (display only).** Relabelled the resource to **Mana** and recoloured it **teal**
  (`--mana: #30d2ff`): a new droplet icon in the status chip, teal chip icon, teal button costs. The
  card **cost badge is back to a circle** (dropped the flame), teal. Internal identifiers stay
  `embers` (per the user's call — this is a cosmetic rename, the economy logic is unchanged).
- **Combat presentation.** Removed the `—VS—` divider; the top combat banner now shows just the
  **threat name** (the wave already lives in the HUD) as a raspberry pill pinned out-of-flow on the
  left, so the action buttons stay centred. Added a **Combat Log** button that appears beside **End
  Combat / Climb On** once the replay settles — it opens an overlay listing the whole fight narrated
  line by line (with the verdict). Both post-combat buttons are centred.
- **Buff-proc fixes.** The buff animation no longer "snaps back": the spring easing is now scoped to
  the *rise* only, and the settle eases out (`animation-fill-mode: both`), so the card returns
  smoothly. **Tavern offers buffed by the hero power now play the proc too** — the buff-detection
  effect tracks shop offers' effective stats (base + the stored offer buff), not just board/hand.
- **Card text bigger** — keyword pills 9.5→12px and the description 12→14px for readability.
- **Taunt ward −15%** (78→66px) and **Soulfeeder + Kennelmaster art** wired (`feed.png`, `kennel.png`).
- **Verified live:** board 1 + teal Mana circle + "Mana" label + teal button costs confirmed via
  screenshot; hero-powering a tavern offer now flashes it (`cardbuff` + burst); a full
  recruit→combat→recruit cycle shows the threat-name banner, no VS, the centred Combat Log + End
  Combat, and the log overlay opens with its verdict. Fresh-server console is clean (the hook-order
  warnings seen mid-edit were stale Fast-Refresh transition artifacts). `typecheck` (+web) + `lint` +
  `test` (**81**) + `build:web` all pass.

### In-place combat — the shop closes, the enemies arrive (no more separate arena screen)
Combat now plays out **on the recruit board itself** instead of cutting to a separate full-screen
arena. When you End Turn, the top half "closes up" (the tavern offers, the control bar, the timer,
the rope and the hand animate away) and the enemy team **arrives** where the tavern was — while the
**warband, the Warden hero frame, the HUD (ASCENT / wave / tribes / mute) and the Embers/Resolve
panel never move**. After the fight, your board plays a one-shot **reset** animation as the next
shop opens. (Item 11 of the batch.)
- **`Recruit` is the single, always-mounted board.** `Game.tsx` no longer swaps `Recruit` ↔ `Arena`;
  it renders `Recruit` for every phase, so the persistent chrome literally never unmounts (hence it
  can't move). `Arena.tsx` is **deleted**.
- **Replay engine extracted to a hook.** All of the old Arena's beat/lunge/projectile/float/SFX/
  verdict logic moved verbatim into `useCombatReplay(combat, { active, findEl })` (new
  `useCombatReplay.ts`); the combat `Unit` card moved to `Unit.tsx`. The hook is decoupled from
  layout: `active` gates the clock (so we can hold on the intro), and `findEl(uid)` resolves a unit's
  live DOM node for measuring lunges/bolts in *any* layout (it now looks inside the warband + tavern
  zones). The UI still only **replays** `simulate()` — it never computes combat.
- **Intro staging.** A local `combatStage` sequences `closing` → `fighting`: ~480 ms of "shop
  closing" (offers + control bar fold up and fade; the hand slides off the bottom), then the enemies
  arrive (slide-in) in the tavern's slot and the replay begins. The control bar's slot swaps to a
  compact combat bar (Wave · threat + **Skip**, then **Climb On**/End Combat when the replay settles)
  — same height, so the warband doesn't reflow. The VS divider is positioned out of flow so it can't
  shift the warband either.
- **Post-combat reset.** Returning to recruit tags the warband row `.resetting` for a 0.65 s settle
  animation; the shop reopens around it.
- **Timer-reset fix (caught live).** Because `Recruit` no longer remounts per wave, the round timer
  (which used to re-init on remount) stopped resetting — it carried 0s into the next wave. Added an
  effect keyed on `run.wave` that re-arms `seconds` to that wave's `turnSeconds` at the start of each
  recruit phase. Also gated drag-start and Hero-Power aiming on `!inCombat`.
- **Verified live (full loop):** drove a real run via synthetic pointer drags — bought + played a
  minion, hit End Turn, and confirmed through the DOM + screenshots that the shop closes (`app` →
  `app combat` → `app combat fighting`), the enemy unit arrives in the tavern zone, the warband units
  render in place, the HUD/hero/Embers stay put, the narration line shows, then End Combat returns to
  recruit (`row warband resetting` → settled), the shop reopens (4 offers), Resolve ticks 30→29, and
  the wave advances to 2 with the timer correctly re-armed (35 s). No console errors. `typecheck`
  (+web) + `lint` + `test` (**81**) + `build:web` all pass.

### Card/VFX/timer polish pass — spacing, spell sparks, buff procs, scaling timer
A grab-bag of feel + readability fixes (items 1–10 of an 11-item batch; the in-place combat
transition is the separate item below):
- **More space between cards** — the row `gap` 10→22px so the (2×) Attack/Health badges of
  adjacent cards no longer overlap.
- **Countdown ticks** — a short square-wave `tick` blip plays on each of the last five seconds of a
  turn (5·4·3·2·1), wired into the recruit timer (`sfx.tick()`), so you *hear* the clock running out.
- **Taunt ward 3×** — the Taunt corner emblem is 26→78px (icon 15→45px) so Taunt reads at a glance.
- **Divine-Shield glow +30%** — the combat DS aura's ring/blur/spread are ~30% thicker (`.unit.ds`).
- **Turn timer grows per wave** — base 30s + 5s each wave, capped at 70s (`turnSeconds`); the ring +
  rope fill scale to the new length. (Recruit remounts per wave, so it initialises fresh.)
- **Tier pills bigger + on spells** — the "Tier X" pill/text is +25%, and spells now carry a tier
  pill too (the tavern spell offer passes `tier` through `shopView`).
- **Cost ember outlined** — the flame cost badge gets a soft white outline (double `drop-shadow`) so
  it separates from the art behind it.
- **Spell spark** — casting a spell pops a one-shot accent-coloured burst (a flash + 8 radiating
  rays) at the point it resolved (`fireSpark` on the cast/play branches → `.spellspark`).
- **Buff proc** — when a recruit-phase buff lands (hero power, spell, summon buff) the card now plays
  a punchier green flash *plus* an expanding ring + spark shards (`.buffburst`), so e.g. Warden's
  Fortify reads as a clear proc rather than a faint tint.
- **Board art → board 2** — swapped the play-surface backdrop (`apps/web/public/board.jpg`) to the
  new warm crystal-arena render (1536×1024 → JPEG q82, 135 KB).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` all pass; live DOM +
  screenshot confirm row gap = 22px, the spell offer shows a "Tier 1" pill, the cost SVG carries the
  white `drop-shadow` outline, the Taunt ward = 78px (only on Taunt cards — confirmed it doesn't
  misfire on Divine-Shield/other cards), and board 2 is rendering. The tick/spark/buff-burst are
  transient VFX/audio verified via code + the green build.

### Bigger stat badges (2x, overhanging) + HUD scale-up
- **Attack / Health badges are 2× and overhang the card's bottom corners** (60px, was 30px), mirroring
  the cost ember at the top. They're absolutely positioned (out of the footer flow); the footer is
  padded so the (larger) tribe label centres cleanly between them and never slips under a badge. The
  horizontal overhang is a slight −8px (the bottom −12px does the "eclipse") so adjacent cards on a
  packed board don't clash much.
- **Cost ember pushed further up-left** (top/left −34/−32 → −44/−42) to eclipse the corner more.
- **Tribe text bigger** (11→14px, icon 14→17px).
- **Hero panel +15%** again (portrait 70→80px, name/power text scaled; panel ≈100px tall).
- **Embers chip is now as tall as the hero** — the top row stretches (`align-items: stretch`) so the
  Embers chip matches the hero's height (both ~100px), and its icon/value are scaled up to fill it.
- **HP bar scaled up** with the rest (bar 15→20px, heart 26→32px, value 22→28px).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` pass; atk/hp = 60×60,
  Embers chip = hero = 100px tall, HP bar 20px, and the tribe label fits (not clipped) — all confirmed
  via DOM + live screenshots.

### Resolve as an HP bar, hero panel +20%, cost-text nudge, re-wired Broker art
- **Resolve → an HP bar across the bottom of the status tray.** The chunky `[heart | 30 | "Resolve"]`
  chip is gone. The tray is now a column: **Embers + Hero on the top row**, and a full-width **HP bar
  across the bottom** — red heart on the left, the red fill in the middle (`resolve / maxResolve`), and
  the **current health on the right**. No "Resolve" label. Frees the tray's third slot so the hero can
  grow. (The resolve-loss shake + −X float moved onto the bar.)
- **Hero panel +20%** — the Warden portrait is 58→70px with the name/power text scaled to match, so it
  reads as the tray's centrepiece.
- **Cost text nudged up** — the number sits a little higher in the flame's body (`.costn` padding-top
  24→17px) so it reads as more centred.
- **Re-wired the new Brightwing Broker art** — re-exported the updated source to `broker.png` (512²);
  confirmed it re-bundled with a fresh hash.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**) + `build:web` pass; HP bar (full at 30/30,
  value 30, no label), 70px hero portrait, and the cost padding all confirmed via DOM (the preview
  screenshot tool was unresponsive this session, so visual checks were done through the live DOM + the
  build output).

### Combat attack-order fix, Warden + Broker art, spell rules, drag sensitivity
- **Combat bug — attacker order after a death (fixed).** The attack loop picked the next attacker by
  indexing into the **living** list (`live[pointer % live.length]`). When a minion died it dropped out
  of `living()`, which **re-indexes**, so the pointer skipped the minion to the right of the one that
  died — e.g. with `[Sporeling 1/2, Stray, Taunt Sporeling]`, the front Sporeling traded in and died,
  then the **Taunt Sporeling attacked before the Stray**. Now the next attacker is tracked by
  **identity** (resume from the last attacker's position in the full board array), which is stable
  across deaths *and* mid-combat summons. Added a regression test (front 1/1 dies → the 2nd minion,
  not the 3rd, swings next). (Not a Taunt issue — Taunt only affects targeting, never attack order.)
- **Hero (Warden) + Brightwing Broker art wired.** Added an `art/heroes/*.png` glob + `heroArt()`; the
  hero panel now shows the **Warden** portrait (falls back to the anvil icon if absent). Brightwing
  Broker (`broker`, a Tier-2 neutral) gets its illustration via the normal minion glob. Both 512²,
  confirmed bundled.
- **Hero power usable without a friend on board.** `canHero` is now just `heroReady` (was gated on
  having a board/shop minion) — since Fortify can target a tavern offer, it's always usable when ready.
- **Spells: no triple, no sell.** `checkTriples` ignores spell cards (three copies stay separate), and
  the `sell` reducer refuses spells (they're only played for their effect). Drag-to-sell already
  excluded spells in the UI; this enforces it in the engine too. (+2 tests.)
- **Card insertion is more sensitive.** Dragging a card now moves the insertion point past another
  card when the cursor reaches **~35%** into it (was the 50% centre), so cards slide out of the way
  sooner — e.g. dropping next to a lone minion pushes it aside instead of landing on the far side.
  Tunable via `INSERT_FRAC` in Recruit.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**81**, +3) + `build:web` pass; combat-order
  regression test green, Warden portrait rendering live, hero power armable on an empty board, Broker +
  Warden art bundled.

### Hero power can buff tavern minions, embers-projection popup, spell-sell fix + polish
- **Hero power targets the tavern now.** Fortify reads "give a minion +1/+1" (not "a *friendly*
  minion"), so it can target a **tavern offer**, not just the warband. `ShopCard` gained `atk`/`hp`/
  `keywords` buff fields; the hero-power reducer applies +1/+1 to a targeted offer, `shopView` shows the
  buffed stats (green), and **buy bakes the buff into the minion**. The aim (`minionAt`) now detects
  warband *or* tavern minion cards (never the spell), and `canHero` allows arming with an empty board
  as long as the shop has offers. Sets up the general "target a tavern minion" capability for future
  spells/cards. (Verified live: Fortify a shop Sporeling 1/2 → 2/3, bought as a 2/3; tests cover it.)
- **Spell "+1g" fix.** Dropping a *spell* on the tavern was hitting the minion-sell branch (`+1` Ember),
  so dragging a spell up toward the offers (now at the top) could silently sell it. Spells are now
  excluded from drag-to-sell — a spell dragged to the tavern just cancels (cast/play only). (Targeted
  spells already gave no embers when released without a target; the only intended +1 is Ember Pouch's
  net-neutral cast — buy −1, cast +1.)
- **Embers projection popup.** Hovering the Embers chip pops a small panel showing the **starting Embers
  for the next two waves** (cascading up, e.g. "Wave 2 → 4, Wave 3 → 5"), based on the maxEmbers curve.
  Made the Embers chip hoverable (it was `pointer-events: none` in the corner tray; still passes through
  mid-drag) and gave the chips the game's custom cursor instead of the OS `help` cursor.
- **Fodder tooltip** reworded — "A cheap minion your **Demon cards** can consume for its stats."
- **Cost badge** — the ember (flame) is ~10% larger and the cost number ~10% smaller, pushed further
  up-left to eclipse the corner more (number kept in the flame's body).
- **Hero panel ~15% larger** in the corner tray (portrait + text), so it reads as the tray's centrepiece.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**78**, +1 tavern-targeting) + `build:web` pass;
  embers popup, cost badge, hero panel, Fodder text, spell-no-sell, and hero-power-on-tavern all
  confirmed live.

### Bigger cost badge, reorderable shop, + two new T1 spells (Ember Pouch, Bulwark)
- **Cost badge 2× larger** — the ember/flame cost badge doubled (47→94px, font 17→34px) and its corner
  overhang scaled with it, so the cost reads at a glance.
- **Shop offers are reorderable** (like the warband). Added a `reorderShop` action (mirrors
  `reposition`, purely cosmetic on `s.shop`) + an `overShop`/`shopGapIndex` drop-slot + a `shopIndexAt`
  helper; `applyDrop` now reorders an offer dropped back in the tavern instead of snapping it back to
  its slot (the spell stays pinned at the end). This removes the "teleport back to slot" jank — a
  dragged offer lands where you drop it. Verified live: dragging offer 1 to slot 3 reorders it, the
  drop-slot shows, and the spell stays last.
- **Two new Tier-1 spells** (art wired from the Spells folder → `art/minions/{emberpouch,bulwark}.png`,
  512²; the spell slot now rotates among all three):
  - **Ember Pouch** (1 cost, untargeted) — *Gain 1 Ember.* New untargeted cast path: `gainEmbers` is
    handled in `castSpell` against the run state (embers uncapped within a turn, like selling). **Note:
    net-neutral** as specced (pay 1 on buy, gain 1 on cast) — flagged in case more/over-time gain was
    intended.
  - **Bulwark** (1 cost, target a friend) — *+0/+1 and Taunt.* Extended `spellBuffTarget` to grant an
    optional `keyword` param (so it buffs **and** grants Taunt); reused for any future buff-a-keyword
    spell.
  - Added `gainEmbers` to the `EffectFactoryId` (core type + zod schema); `params` already allowed the
    `keyword`/`amount` keys.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**77**, +2 for the new spells) + `build:web` pass;
  cost-badge size, shop reorder + drop-slot, and both spells (art + cost + text, Ember Pouch net-neutral,
  Bulwark +0/+1 + Taunt) confirmed live. `TURN_SECONDS` test bump reverted to 30.

### Cost-in-an-ember, styled hero tooltip + cursor fix, shop gets the warband lift-out drag
- **Cost sits inside an ember (flame).** The cost badge was a plain orange circle; it's now the ember
  flame `Icon` (orange) with the cost number (white) over its bulb, still overhanging the card's
  top-left corner — visually tying the cost to Embers (the currency).
- **Spent-hero cursor fixed.** `.hero.spent` used `cursor: default` (the OS arrow), so moving onto a
  used hero power visibly switched/flickered away from the game's custom SVG cursors. It now keeps the
  custom `gauntlet_default` cursor — no jarring switch. (The Embers/Resolve chips are `pointer-events:
  none`, so only the hero showed this.)
- **Hero-power tooltip now matches the aesthetic.** Replaced the native `title=""` (ugly OS tooltip)
  with a styled `.herotip` — the same dark rounded pill as the card keyword tooltips, "Fortify" in
  orange, popping above the corner tray on hover. Reads "Used this wave." when the power is spent.
- **Shop drag = warband drag (no more "shadow").** Buying used the dim-shadow (`.dragsrc` opacity) — the
  dragged offer stayed dimmed in place while a copy floated. Now the shop uses the warband's **lift-out
  + FLIP**: the dragged offer leaves the row entirely (the floating copy *is* the card) and the rest
  **slide to close the gap**; on drop it buys. Implemented by adding `displayShop` (filters the dragged
  offer, mirroring `displayBoard`), giving shop cards `data-uid`, folding the spell's shown/hidden state
  into `flipKey`, and extending the FLIP `useLayoutEffect` to track **both** the tavern and warband
  rows. Verified live: dragging an offer lifts it out (no `.dragsrc`), the others slide, release on the
  hand buys it, and the row closes up.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; cost badge, spent-hero
  cursor (`gauntlet_default`), styled tooltip, and shop lift-out/slide/buy all confirmed live.
  `TURN_SECONDS` test bump reverted to 30.

### Scale the board to the viewport (16:9 → 21:9), overhang cost badge, Stray ≠ Fodder
- **Stray is no longer treated as Fodder.** `consumeFodderOnSummon` now matches **strictly the `FD`
  keyword** (dropped the "any token" fallback), so a Voracious Imp won't eat a summoned Beast Stray.
  (Stray never had the keyword — the fallback was making it behave like Fodder.) Test updated to assert
  the Stray *stays* and the Imp is unchanged.
- **Card sizing now scales with the viewport** so the board fills big screens (the game looked tiny on
  a 3440×1440 / 21:9 monitor): `--ch: clamp(220px, 27vh, 384px)`, `--cw = --ch × 0.752`, and the
  bottom padding + warband nudge are now `--ch`-relative. Verified across sizes — at **3440×1440** cards
  are **384px** tall (was a flat 278px) with **no overflow**; fits 16:9 down to ~768px tall too. The
  ultrawide play area stays centred (cards big, side margins are expected on 21:9). *Chrome (HUD/buttons)
  is still fixed-px — flagged for a follow-up if the user wants it scaled too.*
- **Hand hover is gentle now.** The hover-pop was `translateY(-150px)` — it flung the card ~184px up,
  out from under the cursor (causing a hover/un-hover bounce). Now `translateY(-5%)` (≈33px lift) +
  `z-index` — just enough to reveal the card and bring it to the front, staying under the pointer.
- **Cost badge overhangs the corner.** Moved the `.cost` badge out of the `overflow:hidden` `.art` to
  be a direct child of `.card`, then restyled it to hang over the **top-left corner** (eclipsing the
  edge), filled solid **orange** with **white** text, **~50% larger** (26→40px, 14→21px), with a cream
  ring + shadow so it reads as a sticker.
- **Removed the "Altitude" label** from the top wave readout (just the wave number + meter now).
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; scaling measured at
  3440×1440 (no overflow), cost badge / Stray / Altitude / hand-hover confirmed live. `TURN_SECONDS`
  test bump reverted to 30.

### Mirror layout: offers vs warband across the centre, HUD to the bottom-left corner
- **Tavern controls decoupled from the offers.** The Refresh/Freeze/Tier/End-Turn `shopctl` bar moved
  out of the tavern `[data-zone]` and now sits as its own control bar under the HUD; the tavern zone
  wraps only the offer cards. The **offers and warband are now flex-grow halves that mirror each other
  across the board's centre** (`flex: 1 1 0; justify-content: center` on each) — shop on top, your
  board below, like two facing lines.
- **Rope back on the centre line.** The burning-rope timer returned to the flow *between* the two
  zones (`position: relative; align-self: center`), so it lands exactly on the offers/warband split at
  any viewport (was a fixed `top: 50%`, which sat on the warband's edge).
- **Warband nudged up** (`padding-bottom: 48px`) to open a clearer gap above the hand (measured ~130px
  warband-bottom → hand-peek at 1300px tall).
- **HUD moved to the bottom-LEFT corner** and shrunk. The Embers · Hero · Resolve tray was the
  bottom-centre centrepiece (hero portrait 108px); it's now a **compact** tray pinned bottom-left
  (hero 50px, smaller chips), so the **hand owns the whole bottom-centre** with room to breathe. The
  compact tray (~440px wide) clears the centred hand — no overlap. (Kept `pointer-events: none` + the
  mid-drag hero pass-through in case a very wide hand fan reaches the corner.)
- **Hand hover snappier** stayed (0.08s); with the bar out of the centre the hand peeks/pops in the
  open instead of from behind the panels.
- **Divine Shield overlay removed** ("too much noise for now"): dropped the `.dsfx` image from `Card`
  + its CSS and the now-unused `effectArt` import. The `effectArt()` helper + `art/effects/divineshield.png`
  are **retained** (unused) so it's a one-line re-add later.
- **Minion-pool quantities — placeholder.** Added `POOL_QUANTITIES` to `@game/sim` config (Tier 1→16,
  2→15, 3→13, 4→11, 5→9, 6→7, **7→5 as a forward placeholder** — no tier-7 cards yet). **Not wired into
  shop rolls yet**; the finite-pool refactor is queued in the roadmap.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; the mirrored layout,
  centred rope, bottom-left tray, removed DS, and Fred's Fodder pill all confirmed live (DOM probes +
  screenshots). `TURN_SECONDS`/`SPEED` test bumps reverted to 30/1.5.

### Fodder → a keyword (card becomes "Fred") + HUD tray, tavern raised, rope centred
- **Fodder is now a keyword (`FD`), not a one-off card.** Added `FD` to the `Keyword` union
  (`@game/core`) + the zod `KeywordSchema` (`@game/content`). The Tier-1 demon card is renamed
  **Fodder → Fred** (`id: 'fred'`, `keywords: ['FD']`, empty body text — the pill carries the meaning,
  so the old "Cheap fuel —" prose is gone). The consume trigger (`consumeFodderOnSummon`) now keys off
  the **keyword** (`minion.keywords.includes('FD')`) instead of the hard-coded `cardId === 'fodder'`,
  with the token fallback kept — so any future card can be marked Fodder and be eaten. Voracious Imp's
  text now reads "When you play a **Fodder** minion…". Card UI gained `FD → 'Fodder'` in the label +
  tooltip maps (label-only pill, like Consume). Art renamed `art/minions/fodder.png → fred.png` to
  track the new id. The `fred`/`FD` consume test was updated. (Verified live: Fred shows the "Fodder"
  pill + `fred.png` art + no description; the Imp eats a played Fred.)
- **Status-bar tray.** Embers · Hero · Resolve now sit in one connecting rounded frame (the
  `.statusbar` got a translucent card background, border, radius + tighter gap) so they read as a
  single unit instead of three floating panels.
- **Hero never fades.** Dropped the `opacity: 0.5` on the spent hero — the portrait/power stays full
  strength even when it can't be used this wave (the ready-pulse is the only "available" cue).
- **Tavern raised, warband lowered, rope centred.** With the freed room, the Tavern now rides high
  near the HUD (was vertically centred), the Warband floats down toward the hand (`margin-top: auto`),
  and the burning rope timer is pinned across the **centre of the board** (`position: fixed; top: 50%`)
  instead of tucked under the tavern.
- **Hand fans up from behind the tray, snappier.** The tucked hand now sits behind the status-bar
  tray (its bg cleanly hides the tucked portion; cards peek above), and the hover-pop transition was
  sped up (0.16s → 0.08s with a snappier curve). The status bar stays fully opaque (never faded).
- **Perf: dropped `background-attachment: fixed`** on the board image. The app never scrolls (100vh,
  overflow hidden), so `fixed` was pure cost — a full-viewport repaint on every paint — for zero
  visual difference. Removing it visibly smoothed repaints (preview screenshots that were *timing out*
  now return instantly). The remaining buy/drag micro-stutter is most likely the preview window's
  remote-control + screenshot overhead; a local `npm run dev` build should feel markedly smoother. A
  deeper pass (memoising cards / imperative drag-follow) is queued if it persists locally.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` pass; all of the above
  confirmed live (DOM probes + screenshots). `TURN_SECONDS`/`SPEED` test bumps reverted to 30/1.5.

### Tribe recolour + HUD/layout pass: hand tucked under the bar, omen + row labels gone
A UI/feel batch (all verified live in the running app):
- **Tribe hues recoloured** to the user's spec (each drives a card's `--c` accent → art panel
  tint, footer, keyword pills, and the HUD tribe dots): **Beast green** `#4ea83b`, **Dragon
  red/orange** `#ff6a3c`, **Mech blue** `#27a9dd`, **Undead dark slate-blue** `#5c6f8c`, **Demon
  purple** `#b15cf0`, **Neutral light greige** `#9a8d79`. Two colours were *overloaded* onto tribe
  hues and had to be decoupled first: the **Embers** chip icon (was `--t-beast`, now `--acc` so it
  stays warm) and the **combat poison** green (floats + omen badge — now a dedicated `--poison`
  `#22be86`, the old Undead hue, so poison reads green regardless of the Undead recolour).
- **Dual-type capability** (forward-looking — "dual-type minions will exist"): `CardView` gained an
  optional `tribe2`; a `.card.dual` splits the art panel + footer down the middle into both hues
  (`--c` / `--c2`). Dormant until the card data model carries a second tribe (see roadmap) — no card
  triggers it yet, so it's a ready visual, not active content.
- **Fodder's name now shows.** Root cause was a flex bug, not data: `.cbody` is a flex column and
  `.cn` (the name pill) had default `flex-shrink: 1`, so Fodder's longer description overflowed and
  squeezed the name to **5px** tall (invisible). Fixed with `.cn { flex: none }` — the name keeps its
  full height on every card; the description clips instead if it's ever too long. (Confirmed live:
  Fodder's `.cn` went 5px → 18px, text "Fodder" visible.)
- **Divine Shield overlay enlarged.** `.dsfx` now spills past the card edges (`112%`×`78%`, offset
  up/left) so the shield reads as an aura *around* the minion, not a contained icon — while the
  screen blend keeps the minion visible through it (confirmed on Spare Part Drone: bigger golden
  shield, drone still clearly readable underneath).
- **Removed the red omen bar.** Per the user, the pre-shop threat telegraph is gone for now — only
  the wave # (already in the top HUD) remains. `<Omen />` is no longer rendered (the component file
  is retained, unrendered, for easy restoration later).
- **Removed the left-row labels** ("The Tavern · Tier", "Your Warband · n/7", "Your Hand") — the
  per-zone `.zh` headers were dropped from all three rows for a cleaner board.
- **Hand reworked into a bottom fan tucked under the status bar.** The hand is now `position: fixed`
  at the bottom centre (`z-index: 25`, below the bar), its lower half behind the Embers/Hero/Resolve
  panels; a hovered card pops fully up (`translateY(-150px)`, `z-index: 45`) to read in full. The old
  dashed empty-hand box is gone (empty hand renders nothing). This frees the hand's old full-height
  row, so the **Tavern + Warband now centre lower** in the freed space (auto margins).
  - *Drop/interaction fixes this required:* the status bar is now `pointer-events: none` (only the
    hero captures, and even the hero goes click-through mid-drag via `body.dragging`) so a card can be
    **bought/played/grabbed** through the bar to the hand tucked behind it; and `onUp` now resolves
    the drop **zone before** clearing `body.dragging`, so the pass-through is still active at the
    moment the drop is read. Verified live: buying by dropping dead-centre (over the hero) lands in
    the hand, and playing a card from the tucked hand up to the warband works.
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**) + `build:web` all pass; every item
  above confirmed live via DOM probes + screenshots.

### Board art + Warden rename + aim-line spell casting + Divine Shield art + Fodder (demons fixed)
A six-part feel/content pass (all verified live in the running app):
- **Board background art.** The user's `board1` (a purple crystalline arena) is now the play surface:
  exported to `apps/web/public/board.jpg` (1536×1024, JPEG q82 → 201 kB) and painted on `body` under a
  dark scrim gradient (`linear-gradient(rgba(28,22,16,.34), …(.46))` over `url('/board.jpg') cover
  fixed`) so the cards/HUD stay legible. (Kept the taupe `--bg` as the fallback under the image.)
- **Spell casting reworked to match the hero power** (replacing last pass's drag-the-card-onto-a-friend
  gesture, per the user's spec):
  - **Non-targeted spells** ("buff your whole board", "gain Embers") — drag the card up and release
    anywhere in the warband space, like playing a minion; the effect fires. (`applyDrop` spell branch:
    no `target` → dropping on `zone==='warband'` dispatches the cast.)
  - **Targeted spells** (`target:'friendly'`, e.g. Spirit Fire) — the instant the card leaves the hand
    it **turns into the Forgewarden/Warden targeting line**: the floating card is hidden and an SVG
    aim-line (`svg.aimline`) is drawn from the hand to the cursor with a reticle that snaps **on** over
    a valid friendly minion (which gets the strong `targeted` highlight, same as the hero power).
    Release on a minion → spell goes off; **release off any minion → snaps back to hand**; **right-click
    → snaps back to hand** and the line ends. (`castingSpell`/`castTargetUid` derive from the live drag;
    `onUp` clears without dispatch when no target; a window `contextmenu` listener cancels held spells.)
  - Verified live: aim-line + reticle render on drag-out (`dragcard` hidden), release on the Imp cast
    Spirit Fire **+3/+3 (2/2 → 5/5)** and emptied the hand, and **both** cancel paths (empty-release,
    right-click) left the card in hand with the line gone.
- **Rename Forgewarden → Warden, hero power Temper → Fortify.** Pure UI/string change in `StatusBar`
  (title, hero name, "Fortify · +1/+1" subtitle) + the Recruit hint; the `+1/+1` effect is unchanged.
- **Spirit Fire art** wired (`art/minions/spiritfire.png`, 512²) — the spell card now shows its
  illustration via the existing `artFor` glob (card id = filename).
- **Divine Shield effect art.** Added an `art/effects/*.png` glob + `effectArt(name)` in `art.ts`;
  `Card` overlays `effectArt('divineshield')` on any minion with the `DS` keyword. The art is a golden
  shield-crest on transparent — rendered naïvely (`object-fit:cover`) it was opaque and hid the minion,
  so `.dsfx` uses **`mix-blend-mode:screen` + `object-fit:contain` + a slow opacity pulse**, making it a
  glowing aura the minion shows *through*. Verified live on **Spare Part Drone** (the drone reads clearly
  under the shield glow). *Follow-up for the user's call: it's a shield **crest** shape, not a bubble —
  swap art or move to a corner badge if a rounder "bubble" look is wanted.*
- **Fodder — the fix that makes Demons actually work.** The Consume engine (Voracious Imp et al.) had no
  cheap fuel to eat, so Demons were dead on arrival. Added **Fodder** (Tier 1 **1/1** Demon, art wired)
  as a buyable card, and taught the consume trigger to recognize it (`consumeFodderOnSummon` now fires
  for `cardId==='fodder'` as well as tokens). Verified live: bought + played Fodder beside a 5/5
  Voracious Imp → Imp **ate it → 6/6**, Fodder did not linger on the board. (Voracious Imp text updated:
  "When you play **Fodder**, this eats it and gains its stats.")
- **Verified:** `typecheck` (+web) + `lint` + `test` (**75**, +1 Fodder-consume test) + `build:web` all
  pass; the six features above confirmed live via DOM checks + screenshots. `TURN_SECONDS`/`SPEED` test
  bumps reverted to 30/1.5.

### Spell system + Spirit Fire + targeted casting
- **A new card kind: spells.** `CardDef` grew `spell` / `cost` / `target`; spells set their own cost
  (minions stay flat `CONFIG.minionCost`), are excluded from the minion pool, and never take a board
  slot. The shop now always offers exactly one spell on the **right** (`state.spell`, re-rolled each
  refresh from `SPELL_CARDS`). Zod schema kept in lockstep.
- **Spirit Fire** (the first spell): cost **2**, *target a friendly minion → +3/+3*. Bought into the
  hand, then **cast by dragging it onto a friend** (the target highlights; release off a minion snaps
  back). Verified live: 2/1 Drone → 5/4, spell consumed, slot re-offers on reroll.
- **Targeting mechanic** (the "target Battlecry" change): `target: 'friendly'` + a `targetUid` on the
  `play` action + `boardUidAt()` + the existing aim-highlight. Spirit Fire is its first user; targeted
  *minion* Battlecries reuse the same path (a small factory + place-then-target gesture away).
- **Plumbing set up now, ready for cards** (per the user — buffable spells, spell-casters,
  spell-trackers):
  - `spellCast` game event + `state.spellsCast` counter — minions that track spells cast.
  - `castSpell` recruit factory — a minion casts a named spell from an event (auto-targets the carry;
    counts the cast without re-firing `spellCast`, so no recursion).
  - `state.spellCostMod` — flat reduction subtracted from spell cost at buy ("your spells cost less").
- **Verified:** `typecheck` (+ web) + `lint` + `test` (**74**, +4 spell tests) + `build:web` pass;
  the shop slot, buy, drag-to-target cast (+3/+3), consume, and reroll re-offer all confirmed live.

### Fix: warband cards flew off-screen when wiggling a held minion
- Dragging a held minion back and forth over another a few times made the other cards "spazz out"
  and vanish. Cause: the FLIP slide measured each card's `getBoundingClientRect()` **including its
  in-flight transform**, then stored that interpolated value as the next "first" position — so rapid
  drags compounded the deltas until `translateX` flung cards far off-screen. Fixed by dropping any
  in-progress transform (`transition:none; transform:''`) on every tracked card *before* measuring,
  so each FLIP works from true layout positions; deltas stay bounded by the row width. Verified live:
  wiggling a held minion back and forth 8× over a 3-card board leaves every other card on-screen in
  place (was: flung away / gone).

### Warband drag — truly lift the held card out (drop-in-place, take 2)
- The previous pass only lifted the dragged board minion out *while the cursor was over the
  warband*; dragging it away (e.g. toward the hand) flipped it back to a solid card in the row, so
  you saw a duplicate — the copy you're holding *and* the original still sitting in the warband.
  Now the dragged minion is lifted out of the row for the **entire** drag (the floating copy is the
  card), the rest physically close up, and an empty drop-slot opens at the live insertion point only
  while hovering the warband — the held copy drops straight into it. Also made the drop-slot more
  visible. Verified live: dragging toward the hand leaves only the other minion in the warband (no
  duplicate); holding over the warband opens the slot with the dragged card lifted out.

### Keyword system (Immune/Stealth/Avenge/End-of-Turn + out-of-combat Deathrattle) + drop-in-place drag + lighter board
- **Lighter board** — the taupe backdrop was a touch dark; nudged `--bg` `#7d756b` → `#8c857a`.
- **Drop-in-place warband drag** — reordering a board minion no longer does a jarring post-drop
  "swap" animation. While you drag, the minion rides along as the held copy and its placeholder
  slides to the live insertion slot (the other cards open a gap via FLIP); on release the card lands
  exactly where it already shows, so there's no second shuffle. A played hand card opens the same
  slot. (Replaced the absolute drop-bar with a real `displayBoard` reorder + a `.dropslot` gap;
  `flipKey` drives the live FLIP. Verified live via a held drag — the order is already final before
  release.)
- **Keywords wired/fixed** across `@game/core` + `@game/sim` + UI, with the zod schema kept in
  lockstep:
  - **Immune (`IMM`)** — takes no damage at all (checked first in `dealDamage`, before Divine Shield;
    blocks Poison and destroy-by-damage too). Combat keyword, works on any card. Tested.
  - **Stealth (`ST`)** — can't be targeted by attacks (`chooseTarget` skips it; if every defender is
    Stealthed the swing is skipped) and is lost the moment it attacks (emits a new `reveal` event so
    the replay drops the keyword; the card wears a shadowy look until then). Tested.
  - **Avenge** — new `avenge` game event: `simulate` keeps a per-side death tally and emits it on
    each death; the `avengeBuff` factory fires every X friendly deaths. Trigger + pill wired (text
    prefix "Avenge (X):"); ready for any card that declares it.
  - **End of Turn** — new `endOfTurn` game event fired by `applyEndOfTurn` at the top of `faceOmen`
    (the turn ending / timer hitting 0), baking into the board before combat; `endOfTurnBuff` recruit
    factory + pill wired.
  - **Deathrattle now fires out of combat** — when a minion is Consumed (destroyed in the recruit
    phase) its Deathrattle resolves via recruit-side factories (summon / buff-tribe / buff-carry /
    grant-shield). Tested (Soulfeeder eating a Sporeling triggers its +1/+1).
  - Verified the rest already behave to spec: Battlecry (onPlay, +Drummer re-trigger), Divine Shield,
    Poison, Reborn, Start of Combat, Consume, Cleave, Windfury (existing tests cover them).
- **Verified:** `typecheck` (+ web) + `lint` + `test` (**70**, +3) + `build:web` all pass; lighter
  board + Target Dummy art + clean render confirmed live.

## 2026-06-16

### Combat out-of-order fix + darker board + tier-1 art + renames
- **Combat replaying out of order — fixed (the important one).** The simulator is deterministic and
  the beat advance is a monotonic `k => k+1`, so the *data* order was never wrong (confirmed by
  tracing). The bug was in the visual layer: the attacker→target **lunge** and the Start-of-Combat
  **projectiles** were measured by reading the DOM *during render* (`querySelector(...)
  .getBoundingClientRect()`), and the lunge was stored by **mutating a ref during render**. Render
  sees the *previously committed* frame, so when a death or summon shifted a minion between beats, an
  attacker lunged toward where its target *used to be* — and StrictMode's intentional double-render
  amplified the inconsistency. Moved both measurements into a `useLayoutEffect` (runs after the beat
  commits, when the DOM is current) and hold them in state, so render is pure and StrictMode-safe.
  Verified live (slow + normal speed): attackers lunge at the correct target, combat plays in order
  and completes, console clean.
- **Darker board.** The backdrop went from bright cream (`#f6f0e5`) to a warm taupe (`#7d756b`) so
  the cards and art pop; the text that sits directly on the board (zone titles, hints, combat log +
  side labels, the game-over wash) was lightened to stay legible.
- **Tier-1 art + renames.** Wired illustrations for **Alleycat, Sporeling, Stray, Target Dummy**
  (downsized to 512²). Renamed **Alleycur → Alleycat** and **Pocket Sandbag → Target Dummy** — display
  names only; the card ids (`alley`, `sandbag`) are unchanged, so art lookup + the run tests are
  unaffected (the sim references were comments).
- Verified: `typecheck` (+ web) + `lint` + `test` (67) + `build:web` (8 art PNGs bundle) all pass;
  dark board + Alleycat/Sporeling art + the rename confirmed live.

### Art fills the panel + standardized text line + Battlecry/Deathrattle pills + right-click inspect
- **Art zoomed to fill** — `object-fit` back to `cover` (from `contain`), so the illustration fills
  the 60 % art panel edge-to-edge (the user preferred full-bleed over the letterboxed full image).
- **Standardized text line** — the keyword-pill row (`.kws`) now always renders and reserves one
  pill-row of height, so a card's description starts on the same line whether or not it has pills.
  Verified Start (Ember Whelp), Battlecry (Alleycur), and Deathrattle (Sporeling) all land their
  description at the same Y (456 px).
- **Battlecry / Deathrattle pills** — these aren't keywords in the data model, so the Card derives
  them from the text prefix (tolerating the `**bold**` markdown — `/^\W*battlecry/i`) and shows a pill
  matching the existing Start / Consume style: Battlecry gets a new horn glyph, Deathrattle the skull.
- **Right-click inspect** — right-clicking any card (shop, hand, warband, or a combat unit) floats a
  centred, enlarged copy over a dimmed + blurred backdrop for a close look; click the backdrop or
  press Escape to dismiss. New `inspect` store state + `inspectCard`/`clearInspect` actions, an
  `<Inspect>` overlay at the Game root, and `onContextMenu` on the Card. Any dispatch also closes it.
- **Verified live**: art fills the panel; Start/Battlecry/Deathrattle descriptions all align at
  456 px; both new pills render with icons; inspect opens centred (centreX = viewport centre) and
  closes on backdrop-click and Escape. `typecheck` (+ web) + `lint` + `test` (67) + `build:web` pass.

### Bigger cards + 60% full-image art + compact Omen + sweet-spot targeting
- **Cards larger** — added `--cw` / `--ch` card-size variables (one standard size used in shop,
  warband, hand, and combat). Width +10 % (190→209 px) and height +14 px (264→278 px).
- **Art area 60 %, full image** — the art panel grew 50 %→60 % of the card and `object-fit` changed
  cover→**contain**, so the *whole* illustration is shown (no cropping); the tribe-tinted panel frames
  it. (The earlier "art too big" was a containment bug, already fixed; this is the size/fit the user
  asked for — 512² art is still the right source.)
- **Compact Omen** — the upcoming-threat banner was tightened (padding 11→7, name 24→19, description
  13→12, sigil 50→44, spacing) from ~123 px to ~100 px, funding the taller cards so the net vertical
  footprint barely changes. Verified live: recruit keeps ~31 px clearance above the StatusBar and the
  combat scene still fits.
- **Sweet-spot targeting** — the Hero-Power aim (and any future single-target ability) now follows the
  cursor exactly: you can aim **anywhere on a minion's card**, no snap to its centre. The minion under
  the cursor lights up with a strong accent ring (`.card.targeted`). Verified the aim circle lands at
  the cursor (901,631) rather than the card centre (954,720), and the hovered card highlights.
- **Verified live**: cards measure 209×278, art panel ~60 % showing the full image, Omen ~100 px,
  recruit clearance ~31 px, combat fits, tier colours intact, sweet-spot aim + highlight confirmed.
  `typecheck` (+ web) + `lint` + `test` (67) + `build:web` all pass.

### Drag precision pass + tier colours + art-covers-text fix
- **Drag precision** (the headline ask — make dragging exact, clean, satisfying). Six fixes to the
  pointer-drag in `Recruit.tsx`:
  1. **Zero-lag tracking** — the floating card had a 50 ms `transition: transform` so it always
     trailed the cursor; now it tracks instantly (the transition is kept only for the snap-back).
  2. **Grab-point lock** — `scale(1.04)`/`rotate` pivoted around the card's corner, sliding the
     grabbed point ~4 px off the cursor; `transform-origin` is now set to the exact grab point so the
     card stays pinned under the pointer (rotate softened to 1.5°).
  3. **Reorder off-by-one fix** — `warbandIndexAt` counted the dragged board card itself (it stays in
     the DOM, dimmed), so a rightward/inward reorder overshot by one ("doesn't go where you think").
     It now excludes the dragged card; verified live that dragging the left minion of three into the
     middle lands it at index 1, not dumped at the end.
  4. **Pointer capture** — `setPointerCapture` on press so move/up keep firing through fast flicks or
     when the pointer leaves the window.
  5. **Live insertion marker** — a glowing accent bar shows the exact slot a played / reordered minion
     will drop into, sliding between cards as you move.
  6. **Drop-zone glow** — the hand lights up when a shop card will buy, the warband when a card will
     play / reorder (the tavern already had its gold sell glow).
- **Tier colours** — the tier badge was dark on every card; tiers 1–6 now ramp cool→warm
  (slate · green · blue · violet · orange · raspberry) via a `data-tier` attribute, so tier reads at
  a glance. Applies in the shop, warband, and combat.
- **Art covers text — fixed.** The illustration was rendering 186 px tall inside a 130 px art panel
  (the grid auto-sized the square PNG to its *width*-driven height) and `​.art` had no `overflow:
  hidden`, so it spilled 56 px down over the keyword chips + description. The image is now
  absolutely positioned to fill its panel exactly and the panel clips — text sits cleanly below.
  This was a CSS bug, **not** the asset size (512² is fine). Card size was left as-is on purpose:
  growing height would break the three-rows-clear-the-StatusBar fit tuned last batch.
- **Verified live** (drove a real run via synthetic pointer-drags): the art now fills its panel
  exactly (measured), tier badges show distinct colours, the insertion marker renders at the correct
  slot, 2- and 3-card reorders land precisely where aimed, no console errors. `typecheck` (+ web) +
  `lint` + `test` (67) + `build:web` all pass.

### Illustrated art pipeline + more combat feel
- **Art pipeline** — a per-card image override. A new `packages/ui/src/art.ts` enumerates
  `art/minions/*.png` at build time via `import.meta.glob` (keyed by filename = card id), and the
  Card renders an `<img class="artimg">` (object-fit cover, top-anchored) when a matching file
  exists, falling back to the generated pixel `Sprite` otherwise — purely additive, a no-op until
  art is added. `cardId` is now threaded through every CardView (shop, warband/inst, Discover, and
  the combat Arena unit), so an illustration shows in all three rows + combat. The first four
  illustrations are wired — `whelp` (Ember Whelp), `imp` (Voracious Imp), `drone` (Spare Part
  Drone), `drummer` (Doublecast Drummer) — copied from `C:\Game Assets\Ascent Art\Minions` and
  downsized from the 1254² ~2.3 MB originals to 512×512 (~650 KB) for the bundle. A README in the
  art dir documents the card-id ↔ name table, the format/size spec, and the one Vite caveat (restart
  `npm run dev` once if you drop the *first* files into the previously-empty folder, since the glob
  compiles to an empty map at startup).
- **More combat feel** — four additions on top of the existing lunge/shatter/poison/SC/summon juice:
  (1) **death dissolve** — a dying minion now flashes, crumples with a slight tumble + desaturate,
  and fades to nothing, instead of shrinking to 0.7 and popping out; (2) a white-hot **impact spark**
  at each struck minion (a `::before` flash on the existing `struck` class); (3) a **win/lose scene
  tint** when the replay settles — a soft green vignette on a win, raspberry on a loss
  (`.arena.done.win|lose .ascene::after`); (4) **snappier lunge easing** (0.16 s with a slight
  overshoot) so a strike reads as a committed blow.
- **Verified live** (drove a real run via synthetic pointer-drags; combat slowed temporarily to film,
  then SPEED restored to 1.5): Ember Whelp / Voracious Imp / Spare Part Drone render their
  illustrations in shop, warband, *and* combat, while art-less cards keep their pixel sprite; combat
  lunges + SC scorch + deaths play; both result tints show (green win, raspberry loss). `npm run
  typecheck` + `typecheck:web` + `lint` + `test` (67) + `build:web` all pass; the four PNGs emit as
  hashed bundle assets.
- **Notes:** balance tuning stays deferred (feel + functionality first). As art scales past a handful
  of cards, the ~650 KB PNGs will want WebP/compression — flagged in the roadmap.

### Feel/functionality pass — hand box, combat juice, spell frame, golden text
- **Hand box** (`fdee24c`): the empty-hand box now spans the bottom frame's width (~760px, ≈ the
  Embers·Hero·Resolve StatusBar) and no longer clips under the hero — trimmed the card-row height to
  264 (= card height), the column gap, zone headers, and the control-bar margin so the three rows +
  chrome fit above the fixed StatusBar (~50px clearance).
- **Combat juice** (`c3f4d9a`): a breaking Divine Shield bursts a golden shard ring; in-combat
  summoned minions pop in; a kill shakes the board (hit-stop feel). Verified the shake live.
- **Spell frame + golden text** (`3462758`): the Discover spell now has a distinct demon-purple
  arcane frame; golden text-doubling broadened to bold "deal **3**" and SC-AoE phrasing ("3 to
  every", "3 more") so a tripled card's printed numbers match its doubled effect.
- Verified live this pass: taunt shield ward (steel emblem on the enemy), dead minions removed (not
  greyed), End-Combat top-centre, persistent StatusBar + hero-ready glow, board shake on a kill.
- **Note:** balance tuning (the counter matrix) is explicitly deferred — feel + functionality first.
  Minion art (the Ember Whelp dragon) is also deferred; art specs + a per-card image-override path
  are noted in the roadmap.


### Triple/Drummer/Echo fixes + combat & recruit polish + SFX
- **Engine fixes** (`7c6945a`): tripling now combines the three copies' *current* stats — the sum of
  the two highest attacks and two highest healths — and unions all their keywords (so a buffed /
  Poison / Divine-Shield copy keeps it), instead of resetting to 2× base. Doublecast Drummer now
  makes Battlecries fire one extra time per Drummer. Echo Warden now works in combat (friendly
  summons fire one extra time per Echo); its text reads "In combat, …".
- **Recruit layout** (`2f57101`): a shaded, non-clickable "Tavern · Tier N" box was added to the
  control row; the warband dropped its fixed "Empty" slots (renders just the played minions with a
  hint when empty); the keyword legend strip was removed.
- **Combat polish** (`5dac9c8`): Taunt minions wear a steel shield ward; damage/buff floats are much
  larger and the struck minion's HP badge flares; combat lines hold a static height; a burning rope
  appears in the last 15 s of a turn above the warband. Plus a Start-of-Combat **projectile** bolt
  (`6e8e285`) that flies from the caster to each target it hits.
- **Targeting** (`fe502a6`): the Hero Power is now drag-to-target — press the Forgewarden, drag the
  aim line onto a friendly minion, release to Temper it (the whole card is the target); release off
  to cancel. A plain click still arms. The same flow is ready for a single-target Battlecry.
- **Shuffle** (`4374ef7`): the warband FLIP-slides cards into place when it reorders (play / summon /
  sell / reposition); magnetic merges don't reorder so they don't shuffle.
- **SFX** (`1f1fe87`): a synthesized Web Audio sound bank (no asset files) for recruit actions,
  combat beats, triples, and win/lose, with a mute toggle (persisted) in the HUD.


### Combat overhaul + flair, stat colours, persistent HUD, even layout
- **Combat read cleanup** (`cacae5e`): attacks now play as a clear wind-up (the attacker lunges in,
  no damage) then an impact beat (it and its target take damage together, dead removed), instead of
  everything resolving at once. The lunge is cached so it stays planted through the impact then
  retracts. Combat is ~25% slower (SPEED 1.2→1.5) and floats linger longer.
- **Combat VFX + stat colours** (`e03c048`): Divine Shield is a pulsing golden aura (flashes on when
  granted, gone when broken); poison drops a green mist; Start of Combat fires a golden cast pulse;
  an in-combat buff gives a green pulse; a Cleave attacker shows a white slash. Stats above their
  base render green, below base render red, on cards everywhere.
- **Engine / balance** (`4c29eb4`): embers uncapped within a turn (sell always pays); keyword grants
  target a friend that *lacks* the keyword; early waves 1–4 softened (bot climbs to ~wave 8–10).
- **Persistent HUD + combat end** (`eb25733`): the StatusBar (Embers · Forgewarden · Resolve) is now
  rooted at the bottom across recruit and combat (moved to the Game root, fixed). Removed the bottom
  result bar; "Climb On" is now "End Combat" at the top-centre. A Resolve loss shakes/flashes the
  chip and floats the −X. The Hero Power pulses when it's available and unused.
- **Layout + flair** (`49f0ad3`): rows are fixed-height so spacing is equal (tavern↔warband ==
  warband↔hand, 54px); a hovered card's tooltip rises above the shop buttons; dragging a Magnetic
  minion over a friendly Mech crackles with electricity; a recruit-phase buff flashes the card green.

### Combat-feel beats, engine/balance fixes, card-UX pass, repo conventions
- **Combat replay → beats** (`195f2ca`): the replay advances in beats — a primary action (attack /
  Start-of-Combat / summon / buff / reborn) and all the result events it caused (both minions'
  damage, shields, poison, deaths) resolve together. So an attacker and its target take damage at
  the same instant and their floats land together. Dead minions are removed from the board (no grey
  fade): a death from a prior beat is filtered out; the minion dying in the current beat shows for
  one beat then is gone; the result screen shows survivors only.
- **Engine / balance** (`4c29eb4`): embers are uncapped within a turn — selling was clamped to
  `maxEmbers` (== current embers right after the per-turn refill) so it paid nothing at turn start;
  now sell just adds. Keyword grants (Toxin/Plaguebringer) target the highest-attack friend that
  *lacks* the keyword, never wasting the grant. Enemy strength softened for turns 1–4 (ramp 0.30→1.0
  over waves 1–7, width tracks the wave); greedy bot climbs to ~wave 8–10.
- **Card UX** (`dedf1b5` + styles in `195f2ca`): the name now sits as a pill on the bottom of the
  art with the keyword/text area below it (more room for legible text). Removed the result toast bar
  above the Omen. The drag-ghost positions via GPU transform (clean 150ms snap-back instead of a
  juddery left/top animation) with a small follow-lag + tilt for felt weight.
- **Repo conventions**: README carries a Recent-changes + Short-term-roadmap summary; CLAUDE.md gains
  a rule to keep README/devlog/roadmap current each commit, and a rule to ask clarifying questions on
  ambiguous asks. (The private GitHub repo `kcodea/ascent` was created earlier in the day.)

### UI fixes: button layering, no text-select/right-click, cursor + timer behavior (`a2c7b19`)
- **Shop controls layering** — the Refresh/Freeze/Tier/End Turn bar now sits above the tavern cards
  (`position:relative; z-index:6` + 16px clearance, tavern row aligned `flex-start`). The tall 264px
  minion cards had been eclipsing the buttons.
- **No text selection / no right-click** — `user-select:none` on `body`; `contextmenu` preventDefault
  registered in `apps/web/src/main.tsx`.
- **Drag cursor fix** — the closed-fist cursor was stranding "on" after the first drag. `body.dragging`
  is now removed on pointer release in `onUp` (immediate revert), with an effect tied to `drag.active`
  as a safety net. Also restored the gauntlet hover cursor over cards/buttons: a later `cursor:pointer`
  in the base `.card`/`.btn`/`.hero` rules had been overriding the custom-cursor rule once cards
  stopped being native-`draggable`.
- **Timer behavior** — the 30s round timer no longer auto-starts combat at 0; it now locks every
  action **except End Turn** (which pulses). `timeUp` gates `beginDrag`, Refresh/Freeze/Tier, and the
  Hero Power click.
- Verified via DOM: z-index + 9px button/card clearance, `user-select:none`, contextmenu prevented,
  `body.dragging` lifecycle (added during drag, cleared on release), gauntlet cursor resolves.

### Card sizing, tier badge, End Turn, round timer, triple rework, golden doubling, combat slide
- **Fixed 1:1 card size everywhere** (`069072b`) — cards are a constant **190×264** in tavern,
  warband, hand, combat, Discover and the drag-ghost. Recruit cards had been stretching to row height
  (so they shrank when the control bar + bigger panels tightened the layout) while combat cards were
  fixed; this unifies them and also resolves the art-at-50% flex-basis ambiguity.
- **Tier badge** on every card (top-centre, overlapping the top edge); **End Turn** (renamed from
  "Face the Omen") moved next to Tier in the tavern control bar at 2× size.
- **30s round timer** top-centre (`8bb900d`); ring depletes, turns red under 5s.
- **Two-step triple Discover + golden doubling** (`f6b8f8f`) — a triple drops a golden 2× minion into
  hand with *no* immediate Discover. Playing the golden grants a "Glimpse Beyond" Discover spell;
  playing that spell opens the Discover (3 minions from one tier up). Golden minions fire effects at
  doubled magnitude (combat + recruit factories ×2 when golden; card text doubles "+N/+N" and
  "deal N"). New `discoverspell` token; combat `Minion` gained a `golden` flag.
- **Combat slide-to-target** (`d56367b`) — the attacking card physically slides ~62% into its target
  (inline transform from the two units' live positions); damage floats at the clash.
- 62/62 tests; typecheck/lint/build clean throughout.

### Big UX pass (commit-per-feature)
- 1:1 combat cards using the real `Card` component (`dc86952`).
- Hero-Power **targeting line** with a snapping target orb (`b68a02b`).
- **Pointer-drag overhaul** — solid card follows the cursor, snap-back on invalid drop, gold "Sell +1"
  glow over the tavern (`abeb2eb`).
- Custom gauntlet/hand **cursors** (`29b23e0`).
- Hero-sized Ember/Resolve panels + a fanned, hover-pop **hand** (`6e82264`).
- 2× tavern controls above the shop + **center-anchored** warband (`1505981`).
- Terse mechanical card text + **keyword tooltips** + card width +15% (`71a31c5`).

### Content + balance
- **5 tribes per run** + active-tribe HUD (`667677b`).
- **Triples & Discover** v1 (`38bfdcd`) — later reworked to the two-step flow above.
- **Early-game balance on-ramp** (`d9fe8bb`) — enemy width capped near the wave number, stats ramp
  55%→100% over waves 1–5, and a gentler loss-damage formula, so waves 1–3 are winnable. Greedy bot
  now climbs to ~wave 7–9 (was 3–4).
- **Headless balance runner** (`216bc26`, `npm run balance`) — mono-tribe boards vs every threat,
  prints a tribe×threat win-rate matrix + counter-matrix adherence. Flags Mech dominant, Beast weak,
  Dragon/Undead flat, Demon holds.
- **Demon tribe** (`1f03feb`) — recruit-time Consume system (`onConsume` event + reactions).
- **Mech tribe** (`ba4e583`) — Divine-Shield walls + shield-break payoff chain + Magnetic merge.
- UI note batch (`cb1d95e`) — 50% card art, tribe-typed footer, big centred hero, buy/sell/summon FX.

## Earlier — M0 / M1
- **M0** — deterministic engine: seeded mulberry32 RNG, event bus, pure `simulate()` → event log;
  Beasts + neutral glue; headless determinism harness (`npm run harness`).
- **M1** — run-loop reducer + economy + 5 threats + deterministic wave/enemy generation + scoring +
  save/load; recruit-phase effect system (Battlecries / buff-on-buy / summon buffs); Dragons tribe;
  Battlegrounds hand (buy→hand→play→board); live recruit screen (`@game/ui` + `apps/web`); combat
  arena replaying the event log; full playable loop (recruit → combat → next wave / game over).
