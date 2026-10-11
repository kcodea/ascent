# 2026-10-11 — Collection: NEW no longer badges everything you already own

Owner report (with a screenshot of the Attack Animations tab, the EQUIPPED item wearing NEW): "whenever i load the
game, all of my stuff that i already own shows up as 'new' how can we fix this?"

## Root cause

Not a wipe. The seen list (`ascent.collection.seen.<userId>`) is `localStorage`, so it is per browser ORIGIN: every
dev port, the web build and the desktop app each keep their own. It started EMPTY, and the only thing that ever
added to it was a click on one owned tile. So any address that had not been clicked through badged the whole
collection, and clearing it cost one click per item. Nothing treated "equipped" as seen either.

## The fix (owner picked "Baseline + clear on view")

- **Baseline.** `ensureSeenBaseline` (new `collectionSeen.ts`): the first READABLE ownership list a device gets for
  an account is stored as seen, once (marker key `ascent.collection.baseline.<userId>`). Taken in
  `adoptProgressionProfile` (so it lands at boot, before anything is earned) and again when the Collection opens on
  the saved mirror. A profile with no `cosmetics` (ownership unreadable) is skipped so a failed read never burns
  the baseline. A list the device already had is kept and topped up, which is what clears existing players.
- **Clear on view.** The open tab's owned items are written to storage as seen while you look; the page renders
  from a SNAPSHOT of the list (taken at open, on account change and on a tab switch), so the badges stay for the
  visit and are gone the next time. A pick still clears its badge at once.
- **Equipped never wears NEW.**

## The trap worth remembering

The snapshot is re-read during RENDER, not in a mount effect. A mount effect re-reading storage runs after the
clear-on-view effect under StrictMode's effect re-run (the dev build), which would wipe the open tab's badges the
moment the page opens. There is a StrictMode test for exactly this.

## Still true

The list is per device. An item earned on one device shows NEW once on each other device that already took its
baseline. Following the account everywhere needs a server-side "seen" (a migration); offered, not chosen.

Oracle: `R-PROG-COLLECTION-05`. Tests: `CollectionScreen.test.tsx` ("the Collection screen: NEW").
