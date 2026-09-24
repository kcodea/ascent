# 2026-09-24 — The gild is a workbench effect: copies poof into golden trails that fly to the new card

Owner redesign: *"i want the cards to poof into golden sparks as a golden trail jumps from each of their
locations towards the triple reward that forms in their hand. their should be an arch to them and i wish so
badly to be able to create this effect in the fx workbench."*

## What changed

- **New:** `fx/defs/gild-trail.json`, one committed def with three layers: a `source` **burst** (the poof where
  the copy stood), a `travel` **ribbon** with `bow` (the arc), and a `target` **burst** (the landing on the new
  card). Every layer has `stagger: 70`, so the copies fire pop-pop-pop. It started as a gold clone of
  `tendril-trail`; the owner tunes it in the workbench like any other def.
- **New:** `gildTrail.ts` fires that def **once per consumed copy** (`index` = copy number, which drives each
  layer's `stagger`). It hides the gilded card and pops it in (`scale` + opacity, one-shot) as the last trail
  lands. `gildTrailSources.ts` is the pure half (unit-tested): where each trail starts and when the last lands.
- **Retired:** `plateGild.ts` (the hand-written centre-screen fuse → crown → seal ceremony), its 👑 Gild tuner
  (`PlateGildTuner.tsx`, DevMenu item, `tunerAll`, the `plategild` emblem) and `fx/plate-gild-preview.html`.
  `buySlide`, `plateFx` and the other plate effects are untouched.

## The non-obvious part: where the copies were

The sim consumes the copies **inside** the commit that raises `triplesMade`, so by the time Recruit's layout
effect sees the triple, they are already off the screen. That is why plateGild opened with the copies
"already gathered centre screen" (owner cut, 2026-07-23): the earlier fly-from-slot version needed a
last-known-position cache and died with it.

This version keeps its own small cache instead of reusing `lastCentreRef`/`departedCentreRef` (those live in
`RowFlip`, cover the **warband only**, and only refresh when the board changes, so a triple made entirely from
hand copies would have had no positions):

- `gildSnapRef` in Recruit holds `uid → { cardId, x, y }` for every hand/warband card that **could** be in the
  next triple (a `cardId` already held `need - 1` times, golden copies excluded). For an ordinary three-copy gild
  that is only your pairs: usually zero to four rect reads per render, not the whole board.
- It is refreshed at the end of the same layout effect that reads it, **after** the read, so the read always
  sees the previous commit's layout. It skips mid-drag (the settled pre-drag layout is the better origin) and
  outside the recruit phase.
- On the triple, `resolveGildSources` takes the copies of the gilded `cardId` that were in the snapshot and are
  gone now. **A third copy you BUY** was minted and consumed in one commit, so it is never in the snapshot; it
  launches from the buy's release point (`buyPendingRef.from`). Anything still missing (a copy conjured and
  consumed in one commit by another path) starts from points spread around the screen centre. The count always
  comes from the sim's rule (`runeTwinGilding || midasTouch ? 2 : 3`), never from counting vanished uids.

## Safety

The gilded card is hidden until the trails land, so every path must end with it shown (pinned by
`gildTrail.test.ts`): the arrival timer (`gildArrivalMs`, read off the def so it follows the owner's tuning),
each play's `onDone`, an immediate show when no play was admitted, and no hide at all when the FX engine is not
ready.

## The in-hand gild: the fountain

Owner, reviewing the first pass: *"one situation that can occur that this doesnt account for, is when all
three cards are in hand when they become gilded."* This is the COMMON case, not an edge: `pullCopies`
consumes from the **hand first**, and `combineIntoGolden` pushes the gold card to the **end of the hand**, so
whenever copies are held, every trail starts and ends in the same row. Two things broke there:

- **Flat hops.** `bow` is a fraction of the span, so neighbouring cards got a ~15-30px hump, and a copy that sat
  where the gold card lands did not move at all.
- **Arcs under the hand.** The bow's side follows the direction of travel (`pointOnTravel`: the control point
  is offset along `(dy, -dx)`), so left→right arcs up but right→left arcs DOWN, under the hand and off-screen.

The owner picked the **fountain**: two new optional `travel`-layer fields, default off so every existing def is
bit-identical (the old formula is untouched when neither is set):

- `bowUp: true` puts the arc on whichever side points up the screen. Diagonal trails then bulge outward and up,
  so a fan of board→hand trails sprays symmetrically too.
- `minArc: <px>` floors the arc's PEAK (half the control offset, hence `2 * minArc`), clamped to
  `MIN_ARC_LIMIT` (600). It only ever raises an arc. Coincident anchors hop straight up.

`gild-trail`'s ribbon ships `bowUp: true, minArc: 100`. Measured on an all-in-hand layout: a left copy's peak
27px → 100px; a close right copy went from dipping 9px under the hand to rising 100px; a same-slot copy from
0 → a 100px hop. Workbench: **Arc upward** (checkbox) and **Min arc** (0-300px) sit under the Arc slider.

## Fixed on the way: the workbench dropped `bow` and `stagger` on load and save

`toEditorLayer` (load / session restore) and `toStoredLayers` (save) copy layer fields one by one, and neither
copied `bow` or `stagger`. So loading any def into the workbench and saving it again silently wiped its arc and
its cascade (verified: `heavy-beam`'s `stagger: 120` came back as nothing), and those two dials only ever
worked live, until the next reload or save. Every committed def carrying them was written as JSON by hand. It
would have wiped `gild-trail`'s tuning on the owner's first save. Both directions now go through one
`arcFields()` in `fx/ui/sessionState.ts`, on the same terms as the committed-def loader (`coerceLayer`), and the
round-trip is pinned in `sessionState.test.ts`.

## Rows glide, they never blink (R-SLIDE-01)

Owner: *"when the cards are removed from the board and or shop, the units do not slide into their new spots,
they immediate blink. i want the same sliding effect we have when putting a card on board from hand."*

`RowFlip` (Recruit.tsx) has three commit paths: the drag preview, a DROP settle, and a no-drag commit slide off
the previous commit's `offsetLeft` sweep. The drop path only animated the row the card was **dragged in**, off
a drop-time capture of that row. A drag-buy that completes a triple empties copies out of the **warband** in the
same commit, and that row snapped. Reproduced live in a sandbox (Scene Builder, so nothing uploads) with a
MutationObserver on the warband: the only transforms were the drag-preview nudge, and the survivors moved 51px
with no slide.

Fix: `commitSlidePlan` (`rowSlides.ts`, pure, unit-tested) decides which cards slide and how far. The drop path
now also slides every card OUTSIDE its drop row off the sweep, exactly as a no-drag commit does. The no-drag path
goes through the same helper, unchanged. Verified live afterwards on a stable 1280px viewport: the moved survivor
slides in from exactly its old slot (-103px) and one that did not move does not slide; a no-drag shop removal
still slides +/-52px.

Also: a **window resize** flung cards. The first live check swept the warband in from ~630px away, because the
pane grew between two commits (a hidden preview pane has a tiny viewport). In play that is a real window resize,
and it flung cards on a plain sell too.

**Merged with R-PRESENT-14** (landed on main the same day, on the same RowFlip branch, for "casting Growth moves
the warband"). That fix made the sweep carry the row KEY, so `commitFlipDeltas` (`commitFlip.ts`) returns deltas
only when the rows changed, and it added its own resize listener that drops the sweep. The merge keeps both rules:
`commitFlipDeltas` decides HOW FAR (and whether anything moved), and `commitSlidePlan` now only decides WHICH ROW
(the drop's other row). My duplicate resize listener was removed in favour of R-PRESENT-14's. `rowSlides.test.ts`
composes the two.

## Tuning it

Open `gild-trail` in the FX workbench. The Stage Setter previews **one** leg (one source → one target); the game
plays that leg once per copy. The arc is the ribbon's `bow` plus **Arc upward** and **Min arc**, the gap
between copies is each layer's `stagger`, and the card appears when the `target` layer fires for the last
copy, so moving that layer moves the reveal. To preview the in-hand case, put the source and target handles
side by side, or on top of each other.
