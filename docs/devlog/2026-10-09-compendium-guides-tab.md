# 2026-10-09: Compendium Guides tab

Owner ask: "add a guides tab in the compendium that pulls the same guides from the rail but in an expanded/full view"

## What shipped

- **Tab** (`MinionBook.tsx`): a `guides` category at the foot of the Compendium's left rail (Book icon), an
  own-gallery tab like Runes / Heroes. The tier bar's chart space carries the tribe pills (the Runes tab's
  `.book-runetribe` style) plus an "All" pill. Neutral matches the tribe-less guides. The search box matches title,
  tagline and write-up.
- **Data**: the same `GUIDES` through the same `guidesFor(setId, tribes)` the rail uses. It follows the set picker.
  From the title that is the active set's whole tribe roster; mid-run, on the run's own set, it is the run's tribes,
  so it lists exactly what the rail lists.
- **Shared pieces** (`guides/GuideParts.tsx`): `GuideEmblem`, `GuideTribes`, `GuideText` (the highlighted, hoverable
  card names), `GuideUnits` (the portrait rows), `useGuideViews`, `guideChips` and `guideAccent`. Both the rail
  (`LobbyGuides.tsx`) and the Compendium (`CompendiumGuides.tsx`) build from them. The rail's DOM and classes are
  unchanged. `useGuideViews` now takes the run as an argument: the rail passes the game's run, the Compendium passes
  it only while showing that run's set (the same `liveRun` rule the card gallery uses).
- **Layout** (`guides/compendiumGuides.css`): owner feedback the same day: "make the portrait/title larger so they
  look more separated. can you clean up the view in general as it looks a bit out of place", and "always have core +
  enablers on different lines". Each guide is now dressed as a Compendium card, in the Heroes tab's `.bookhero`
  panel (dark brown fill, 2px gold-mix edge, 16px radius). It has an 88px art tile in the hero art's rounded-square
  style, a 28px title, the tribes in uppercase tribe ink and the tagline, with a rule between header and body. Below
  that come the write-up (15.5px, 72ch max) and then Core and Enablers, each on its own line. The rail's
  opponent-row plate, tribe left bar and round medallion are not used here. Two columns on the scaled stage. Every
  guide is open. Portraits are 0.7 of a board minion (the rail's Detailed view is 0.6).

## Performance

The guide cards and the `Card` portraits are memoized, and the views are stabilized. Off-screen cards use
`content-visibility: auto`. Nothing animates. In the dev build, switching to Guides (11 guides, 57 portraits)
logged no long task over 50 ms. Switching back to the minion gallery logged one of about 57 ms, which is the
gallery's own existing mount.

## Tests

`guides/compendiumGuides.test.tsx` checks three things. The tab renders every guide `guidesFor` gives the active
set, each with its full write-up and portraits, and with no `title=`. The pills narrow the list and All clears
them. The tab follows the set picker. `compendiumSetPicker.test.tsx` now counts seven fixed rail tabs.
