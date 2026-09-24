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

## Tuning it

Open `gild-trail` in the FX workbench. The Stage Setter previews **one** leg (one source → one target); the game
plays that leg once per copy. The arc is the ribbon's `bow`, the gap between copies is each layer's `stagger`,
and the card appears when the `target` layer fires for the last copy, so moving that layer moves the reveal.
