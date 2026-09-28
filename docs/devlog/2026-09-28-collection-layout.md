# 2026-09-28 — Collection screen relaid out as a full album

Owner ask: "i think the layout is horrible. research best in class collection screens and mimic them". Stacked on
`feat/collection-crate-fx` (#1784). The crate opener, `crateFx/**`, the tuner and `Career.tsx` are untouched; the
screen only mounts `CrateOpener` as before.

## Research, in one line each

- **Hearthstone**: the whole set shows, owned or not, in a stable order; a filter bar with counts.
- **Marvel Snap**: always-visible progress ("N / M"), big touch targets.
- **Legends of Runeterra**: one Collection hub with category sub-tabs, so new cosmetic kinds slot in.
- **Fortnite Locker**: a per-category NEW marker; NEW clears on view; equipped as a full-tile rim, not a tick;
  players asked for the rarity colour back after it was removed.
- **Valorant**: the selected item large in a preview panel.
- **Clash Royale**: the rarity lives in the frame, so it reads even at a glance or on a missing card.
- **Overwatch 2 / Apex**: the top rarity gets a distinct treatment, not just a colour.

## What the screen is now

- Header: title, overall "N / M collected" with a bar, Account Level with its XP bar.
- Category TABS (not a second left rail: the menu sidebar already is one). Titles is live with an owned / total
  count and a NEW count; the six switched-off categories are locked tabs that open a "coming soon" view with a
  ghost album.
- Filter bar: Show (All / Owned / Missing) and Rarity chips, each with counts; a no-match state with Show all.
- Album grid: every title, rarest first, stable. Owned tiles bright in a rarity frame (Epic a stronger glow,
  Legendary a gold rim that breathes by opacity); missing tiles dimmed with the rarity readable and a lock; the
  equipped one has a gold rim and an Equipped ribbon; NEW badge.
- Side column: the crate bay (count, next crate, Open, Open all; the next crate's level when none are sealed)
  always in view, over the detail panel (nameplate, rarity, status, how to get it, a preview under your name,
  Equip / Take off, or the "how to get it" hint for a missing item). A slim guest save row at the foot.

## Rules kept

- The pure logic is in `packages/ui/src/progression/collectionModel.ts` (album order, filters, counts, NEW).
- NEW is `localStorage` only (`ascent.collection.seen.<userId>`), never written to the server. Only a PICK of an
  OWNED item clears it: a default selection never does, and peeking at a missing item does not spend its badge.
- Layout px only (the stage scales the page); no viewport units or viewport `@media`; no cursor rules; no
  `title=`. Tiles are `React.memo` with primitive props. Loops: the crate float (transform) and two opacity
  breathes over static paint. A test asserts every looping keyframe touches only transform / opacity.
- Oracle: `R-PROG-COLLECTION-02` in `packages/rules/src/registry/approved/foundation.ts`.
- The Collection tests moved from `Crates.test.tsx` into `CollectionScreen.test.tsx`.

## Follow-ups

- Once titles have art or other categories switch on, the tile can carry a thumbnail; the frame already scales.
