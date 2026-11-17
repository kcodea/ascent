# Hero Select "All heroes": the showcase window over the roster grid

Date: 2026-11-17. Owner: Mike. Branch: `feat/hero-select-all-heroes` (off `origin/main`).
Companion to `2026-11-16-hero-select-showcase-design.md` (the three-hero showcase), which left this screen out.

## Intent

The Hero Select showcase (tiles, the Compendium-style inspect card, Select Hero on the START plaque) covers every
offer of six heroes or fewer. The whole-roster screen (Practice with "All heroes", and Gauntlet: `browse =
choices.length > 6` in `HeroSelect.tsx`) still picks a hero the moment its card is clicked. Mike wants that screen
to use the same showcase card, without losing the big grid.

Mike, 2026-11-17: "i want it to be the card view we just did for the new showcase but still the massive grid we
currently have. when clicking a hero, it pulls up the showcase view and in the top right there should be an X to
X out. or clicking outside of the showcase window should automatically close it." On whether the grid cards
change: "stay as is."

## What the player sees

```
  SELECT YOUR HERO                               (header as today)
 ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐              the grid, exactly as today, dimmed
 │    │ │  ┌──────────────────────────────┐ ✕    while the window is open
 └────┘ └──│ splash ▒░  Name              │
 ┌────┐ ┌ ‹│ art        Health · Armor    │›
 │    │ │  │      (◉)   Power / Ancients  │
 └────┘ └──└──────────────────────────────┘
                 [  SELECT HERO  ]
```

Owner decisions (Mike, 2026-11-17):

- **The grid stays as it is today**: the same big banner cards, alphabetical, the same columns, two rows visible,
  inner scroll, power text and hover face unchanged.
- **Clicking a hero opens the showcase view** for that hero over the grid. It no longer picks.
- **An X in the top right** closes the window.
- **Clicking outside the window** closes it.

Claude's proposals, shown to Mike with the sketch above; he answered only the grid question and raised no
objection to the rest. They stand as Claude's calls until he reads this doc:

- The window holds the shared inspect card (splash art, name, Health, Armor, power, Ancients row) and the Select
  Hero button under it. No tile row inside it: the grid behind is the tile row.
- The grid dims behind the window. Escape also closes it.
- The card's arrows and Left / Right step through the whole roster in the grid's alphabetical order, wrapping.
- Select Hero starts the pick ceremony from the splash art, as the showcase does.
- It sits behind the same DEV switch as the showcase (`heroShowcaseFlag.ts`), so the two turn on together.

## Amendments after Mike saw the build (2026-11-17)

These override anything below that disagrees.

- **The grid is the showcase's tiles, not the big banners.** Mike, on seeing the banner grid, with a screenshot of the
  three-hero showcase's tile row: "ugh no. i want the grid to be like thissssss". The whole roster renders as the
  showcase tile (portrait, name, Health, Armor), seven across, wrapping, in one inner scroll box. The earlier "stay as
  is" answer is withdrawn; the banner grid remains only with the switch off. Claude's calls: no re-roll and no sliding
  glow in the grid; the tile whose hero is on show (and still that tile after closing) wears the showcase glow as static
  paint.
- **Soft scroll edges.** "can you create a blur on these edges here? top and bottom. so its not as jarring when
  scrolling". The scroll box fades out over its top and bottom 44 units (a static mask). Claude's call: a fade, not a
  blur filter, which would repaint on every scroll frame.
- **The X sits fully inside the card's top-right corner.** After trying it over the corner and then floating off it:
  "can you move it fully inside the corner instead?" 16 units in from the top and right edges (Claude's number).
- **Select Hero lettering, on every Hero Select.** "can we also slightly reduce the size and spacing between the
  characters of this select hero button across the board?" Font size 90% of START's, letter spacing 0.1em (was 0.16em).
  Claude's numbers. The main menu START button is untouched.
- **The showcase switch is live for players** (PR 2764, merged while this was being built), so this is no longer
  DEV-only by default. Whether it ships to players on merge is Mike's open decision; if it does, `patchNotes.ts` must
  be updated in the same PR.

## Goals

- With the showcase switch on, in the party home look, a whole-roster offer shows today's grid, and a card click
  opens the window described above.
- Picking happens only through the window's Select Hero button, and plays the same ceremony the three-hero
  showcase plays (splash source).
- The window's card and button are the same components the three-hero showcase uses, so they cannot drift.

## Non-goals

- Any change to the grid cards, their order, column count, scroll box or hover face.
- Search, filter, grouping or sorting of the roster.
- A phone-specific layout. The touch layer must work (a tap on a card opens the window, taps on X / outside /
  Select Hero do what a click does) and the window must fit the scaled stage, but there is no compact restyle.
- Turning the switch on for players, a `patchNotes.ts` entry (nothing player-facing ships while it is DEV-only).
- Any change to the three-hero showcase's look or behaviour, the Compendium, the ceremony's later phases, its
  timing data or Pixi FX.

## Anti-goals

- The whole-roster screen changing in any way while the switch is off, or outside the party home look. Its
  existing tests (`gauntlet/heroSelectGauntlet.test.tsx`, `heroSelectPh.test.tsx`, `heroPickClean.test.ts`) pass
  untouched.
- A second copy of the inspect card markup, the Select Hero button, or the pick guards.
- The full page scrolling, a `title=` attribute, a bare `cursor: pointer`, raw `vw` / `vh`, a looping paint
  animation, a per-frame layout read, or a portal into `document.body` (repo UI conventions in `CLAUDE.md`).

## Constraints (today's behaviour that must survive)

- **The run is not created by the pick.** The pick commits the local ceremony machine (`commitPick` in
  `HeroSelect.tsx`); the run is created at the ceremony's Start Game. Unchanged.
- **Hook order in `HeroSelect`**: every hook sits above the `!choices` early return (a past crash, see the
  comment on the row-height measurer). New state follows the same rule.
- The two-row measurer (`--hs-rowh`) keeps working: the grid still renders as `.hsrow.browse`.
- Whole-roster offers have **no re-roll** (`canReroll` excludes `browse`), and occur only in Practice and
  Gauntlet, so Versus locking, the Versus clock, and the Ranked Duos teammate rule do not arise. The shared
  guards in `commitPick` still run (they are no-ops here).
- `practiceOnly` heroes appear in this grid and wear "Not currently enabled in Play" on their card. They can be
  picked.
- The ceremony reads geometry in stage px (`rectToStage`) and stays mounted over the screen.
- The showcase needs the party home look (`showcaseOn = useHeroShowcase() && ph`).

## Approaches

1. **Reuse the showcase body inside a window (chosen).** The grid stays the screen. A card click opens a window
   that renders the same inspect card and Select Hero button as the three-hero showcase, without its tile row,
   plus the X, click-outside and Escape. `HeroSelect` keeps the pick rules; the ceremony uses its existing
   `splash` source. Trade-off: `HeroShowcase.tsx` has to offer its card-plus-button part separately from its
   tile row, and the ceremony's `splash` path has to send the grid cards out instead of tile slots.
2. **Open the Compendium's own hero popup (`PhHeroPop`).** It already has the X, click-outside, arrows and a
   counter. But it is a Compendium page layer with no Select Hero and no ceremony hand-off, so the pick would be
   bolted onto the Compendium, and a change here could break it.
3. **A new standalone window with its own copy of the card and button.** Quickest first look, but a second copy
   of the button and its guards, which would drift from the showcase.

Mike described outcomes and left the how to Claude; Claude chose 1.

## Design

### When it applies

`browseShowcase = showcaseOn && browse` (so: DEV switch on, party home look, more than six heroes offered). When
false, the screen is byte-for-byte today's. The existing `showcase` flag (six or fewer) is unchanged. Watch mode
never reaches this path today (nobody spectates Practice or Gauntlet); if a watched whole-roster screen ever
arrives, it keeps today's grid with no window (Claude's call: out of scope).

### The grid

Rendered exactly as today (`.hsrow.browse`, the same `herocard big` buttons). The only change: with
`browseShowcase` on, a card's click opens the window for that hero instead of calling `commitPick`. The click
plays `sfx.pulse`, as selecting a showcase tile does. Hover and the touch long-press power face are unchanged.

### The window

State in `HeroSelect`: `openIndex: number | null` (an index into `shown`, the alphabetical list), `null` when
closed. Reset to `null` on a new offer.

- **Layout**: a dim scrim over the Hero Select screen (header included), and centred on it the showcase's card
  stage (prev arrow, `HeroInspectCard`, next arrow) with the Select Hero button beneath, at the same sizes the
  three-hero showcase uses for them where they fit. The window and button must fit the 1920x1080 stage with no
  scroll. It renders inside `.heroselect` (not a body portal), above the grid and below the ceremony.
- **X**: a close button straddling the card's top-right corner, `aria-label="Close"`. It wears the same round
  navy Gem plate as the showcase's re-roll button (`.hss-reroll`: gold rim, theme hover, the same spring hover
  and press) with an X glyph in place of the refresh icon, sitting on the card's corner the way the re-roll sits
  on a tile's corner (Claude's call: the Compendium's `PhHeroPop` has no close button to copy, and the repo's
  other close buttons are older looks; this reuses a control already on the showcase rather than adding a
  style). Share the re-roll's rules; do not copy them.
- **Closing**: the X, a press on the scrim (anywhere outside the card, its arrows and the Select Hero button),
  or Escape. Closing plays no pick. Focus returns to the grid card of the hero last shown, and if that card is
  outside the grid's visible rows the grid scrolls it into view (Claude's call), so the player can see where
  they were.
- **Open / close motion**: a short one-shot fade for the scrim and the window; close is a quick fade. The card
  does **not** pop: the showcase card's `phi-in` scale was removed by Mike on 2026-11-16 (`heroShowcase.css`,
  "can we remove this motion?") and the window keeps the showcase card's rules as they are, on open and on
  every step: only the contents rise and the art settles. Transform / opacity only; none under reduced motion.
- **Card content**: as the three-hero showcase: the hero's equipped skin art (`heroPortrait(id, loadout)`),
  name, Health, Armor, power medallion, name, fact chips and text, the Ancients row (preview only, seeded from
  `lastPickedAncient()`, remembered with `rememberAncient`, Up / Down step it), and the same spring hover and
  press on the arrows, power block and Select Hero. Difficulty chip follows the existing `showDifficulty` value.
  A `practiceOnly` hero also shows "Not currently enabled in Play" on the card (Claude's call: the note should
  not disappear when the card is opened).
- **Stepping**: the arrows and Left / Right move `openIndex` through `shown`, wrapping. The card re-keys per
  hero so its contents' entrance replays, as in the showcase. No "N / 42" counter (Claude's call: matches the three-hero showcase). The grid
  behind does not scroll while stepping.
- **Keys and focus**: opening moves focus into the window (the body element takes it, as the showcase body
  does) so the arrow keys and Escape work at once. Keys are handled on the window, not `window`. While open,
  the grid behind takes no pointer or keyboard input and does not scroll.
- **Select Hero**: the same button as the showcase (`hss-confirm ph-start`, label "Select Hero"). Pressing it
  runs `commitPick(heroId, index, splashArtEl)` with the splash art box as the source, exactly as
  `onShowcaseConfirm` does. The blocked states ('mate', 'pending') cannot occur here; 'busy' (ceremony running)
  behaves as in the showcase.

### Sharing with the three-hero showcase

`HeroShowcase.tsx` today renders tiles, then the stage (arrows + card), then the confirm button, and owns the
Ancient preview state and the key handler. Split it so the stage-plus-confirm part (with the Ancient state and
keys) can render without the tile row, and the three-hero showcase composes tiles plus that part. The three-hero
showcase must render and behave exactly as before (`heroShowcase.test.tsx` stays green untouched). The window
adds only the scrim, the X, Escape, and its own sizing rules, scoped under a new class so no existing
`.heroselect.hss` rule changes meaning. The lazy-loading of the showcase body stays: the switch-off path must
not load it or the Compendium stylesheet.

### Ceremony handoff

The ceremony's `splash` source is reused: `artEl` is the window card's splash art; the clone, travel and
hand-over to the clean portrait are the showcase's, unchanged.

- At commit, the scrim, the card's plate, info column, arrows, X and the Select Hero button fade out with the
  showcase's existing dismiss timing (`.hsc-active` rules), leaving the splash clone.
- **The grid cards leave too**, all of them (none is the source): pass the grid's card elements as the
  `splash.exitEls`, so they use the ceremony's existing exit motion and its dense-roster cap (the existing rule
  that keeps a 40-card exit short). Cards outside the visible rows need not animate.
- The grid's scroll box is already frozen during the ceremony (`.heroselect.hsc-active .hsrow.browse`).
- A reset mid-ceremony (the DEV tuner's Replay, a new offer) restores the grid; after a Replay the window state
  is whatever lets the same selection re-commit from the splash art (the showcase's Replay path is the model).
- Switch off: the ceremony's card-clone path for the browse grid (`hsc-browse`) is untouched.

### Files expected to change

- `packages/ui/src/HeroSelect.tsx`: `browseShowcase`, `openIndex`, the card click branch, mounting the window,
  the ceremony's `splash` prop for this path.
- `packages/ui/src/hero-select/HeroShowcase.tsx`: the split described above; a new window component beside it
  (suggested `HeroBrowseWindow.tsx`) or a mode of the same file.
- `packages/ui/src/hero-select/heroShowcase.css` (or a new sibling stylesheet): scrim, X, window sizing, the
  dismiss rules.
- `packages/ui/src/hero-select/HeroSelectCeremony.tsx` / `heroCeremony.css` only if the exit set or dismiss
  rules need it.
- `docs/devlog/2026-11-17-hero-select-all-heroes.md` when it ships.

`HeroSelect.tsx` and the ceremony are busy files; rebase on `origin/main` often.

## Verification

- Existing suites green and untouched: `heroShowcase.test.tsx`, `heroSelectPh.test.tsx`,
  `gauntlet/heroSelectGauntlet.test.tsx`, `heroPickClean.test.ts`, `heroCeremonySplash.test.tsx`,
  `compendiumHeroAncients.test.tsx`, `tapInspect.test.ts`, `touchInput.test.ts`, the ceremony unit tests.
- New tests (both flags on, as the showcase tests do): a whole-roster offer renders the grid and no window; a
  card click opens the window for that hero and does not start the ceremony; X, a scrim press and Escape each
  close it without picking; a press inside the card does not close it; arrows and Left / Right step through the
  alphabetical roster and wrap; Select Hero starts the ceremony for the hero on show; a new offer closes the
  window; a `practiceOnly` hero shows its note in the window; switch off (and party home off) renders today's
  grid where a click picks.
- `npm run typecheck && npm run lint && npm test && npm run build:web`.
- Mike judges the look, the open / close and the ceremony handoff himself in the dev build with
  `?heroshowcase=1`, in Practice "All heroes" and in Gauntlet.

## Left to the builder

Exact window and scrim sizes, the scrim's darkness, the X's exact placement and size at the card's top-right
corner, open / close durations, component and class names, how `HeroShowcase.tsx` is split, the shape of the
exit set handed to the ceremony, and the dismiss motion of the scrim (in keeping with how the showcase's card
and button leave).
