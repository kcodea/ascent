# Hero Select "showcase" layout: design

Date: 2026-11-16. Owner: Mike. Branch: `feat/hero-select-showcase` (off `origin/main`).

## Intent

Mike wants to **try** a new Hero Select screen (the one that offers three heroes before a run). The idea is to
bring the Compendium's hero inspect card (`PhHeroPop` in `MinionBook.tsx`: full splash art on the left fading
into navy, name, Health and Armor, the hero power on the right) onto the pick screen, so choosing a hero feels
like that view. It is a trial: it must be comparable with the current screen, and nothing ships to players
until he decides.

## What the player sees

```
        SELECT YOUR HERO          (eyebrow, timer, Rating, Rift: as today)

  ┌────────⟳┐   ╔════════⟳╗   ┌────────⟳┐
  │ Hero A  │   ║ Hero B  ║   │ Hero C  │    tiles: portrait, name, Health, Armor
  │ ♥30 ⛨10 │   ║ ♥30 ⛨10 ║   │ ♥35 ⛨5  │    gold glow slides to the selected one
  └─────────┘   ╚═════════╝   └─────────┘

 ‹ ┌───────────────────────────────────────────┐ ›
   │  splash art ▒▒░  Name                     │
   │  (navy fade)     Health · Armor           │
   │            (◉)   Power name / facts / text│
   └───────────────────────────────────────────┘

               [   SELECT HERO   ]
```

Owner decisions (Mike, 2026-11-16):

- **Three portrait tiles** across the top. Each shows the hero portrait, name, Health and Armor.
- **Clicking a tile selects it** (it no longer picks). The selected tile is highlighted in gold with a gold
  outline, and **the glow slides** from the old tile to the new one.
- **A re-roll button sits in the corner of each tile.**
- **The inspect card** sits below the tiles and shows the selected hero, in the same navy-fade look as the
  Compendium card and the rest of the party-home UI.
- **A large "Select Hero" button** sits below the card. Pressing it picks the selected hero and starts the
  existing hero select ceremony.
- **The ceremony grows out of the inspect card's splash art** (not the small tile).
- "Go with your proposals" covers the items in the next section.

Proposals Mike accepted as a group:

- The **first hero is selected when the screen opens**, so the card is never empty.
- The card's **arrows step between the offered heroes** (wrapping). There is no "N / 42" counter.
- **Version one covers the normal three-offer screen** (solo, Ranked, Versus, spectating and the Duos teammate
  view). Practice and Gauntlet (the whole-roster browse grid, `choices.length > 6`) keep the current layout.
- It sits **behind a switch** so the two screens can be compared.

## Goals

- The layout above, feeling like the Compendium inspect card, behind a DEV switch that is off by default.
- Every pick rule the screen has today still holds (listed under Constraints).
- The ceremony starts from the splash art and, from the moment the champion portrait takes the stage, is the
  same ceremony as today.
- The Compendium's inspect card and this one are the same component, so they cannot drift.

## Non-goals

- Practice / Gauntlet browse grid. They keep today's cards.
- A phone-specific layout. The touch layer must still work (a tap selects a tile, a tap presses Select Hero),
  and the scaled stage must fit, but no compact-phone restyle in version one. With the switch off nothing on
  phones changes.
- Turning it on for players, removing the old screen, a patch-notes entry (nothing player-facing ships).
- Any change to offers, re-roll rules, the ceremony's later phases, its timing data or its Pixi FX.

## Anti-goals

- The current screen changing in any way while the switch is off (its tests must pass untouched).
- A copy of the pick logic or of the inspect card markup.
- Looping paint animations, per-frame layout reads, bare `cursor: pointer`, `title=` attributes, raw `vw`/`vh`
  (the repo's UI conventions in `CLAUDE.md` all apply).

## Constraints (today's behaviour that must survive)

All in `packages/ui/src/HeroSelect.tsx` unless noted.

- **The run is not created by the pick.** The pick commits the local ceremony machine
  (`dispatch({type:'select', heroId, rect, index, now})`); the run is created when the ceremony's Start Game
  goes through the launch curtain. Unchanged.
- **Re-roll** (R-HERO-REROLL-01): one per hero select, on any slot, free; once used every control disappears.
  Solo uses `rerollHero(slot)`, Versus `rerollVersusHero(slot)`; a watched screen shows inert controls and
  plays the swap when the frame arrives. The swap animation (old portrait fades out, new one pops in under a
  shine, `REROLL_SWAP_MS`) plays on the tile.
- **Versus**: the pick locks with the server at pick time (`lockVersusHeroPick`), a pending Versus re-roll
  blocks picking, the 20 s `VersusHeroTimer` runs, and on timeout the server's hero plays the ceremony.
- **Ranked Duos**: the teammate's hero (`mateTaken`) cannot be picked (`sfx.deny`) and is labelled.
- **Watch mode** (`watch` prop, spectators and the Duos teammate view): read-only; the watched pick plays the
  ceremony here; no Back, no Start Game.
- **Ranked Back** is a two-press abandon; Versus has no Back.
- The ceremony stays mounted over the screen and reads geometry in **stage px** (`rectToStage`).

## Approaches

1. **One screen, two bodies (chosen).** `HeroSelect` keeps owning every rule above. Behind the switch it
   renders a new body (tiles, inspect card, Select Hero) instead of the `.hsrow` of big cards. The inspect
   card is extracted from `MinionBook.tsx` into a shared component. The ceremony gains a second source, the
   splash art. Trade-off: touches `HeroSelect.tsx`, `MinionBook.tsx` and the ceremony, but there is one copy
   of each rule and of the card.
2. **Restyle the current cards in place.** Shrink `.herocard.big` into tiles with CSS and add the panel. Less
   new code, but those cards carry the hover faces, banner chrome, phone rules and the ceremony's clone
   assumptions, and "click selects" contradicts what every existing test of them asserts.
3. **A separate new screen with a copied card.** Quickest first look, but duplicates the pick rules (Versus
   lock, timer, re-roll, watch, Duos) and the inspect card; the copies would drift.

Mike handed the how to Claude; Claude chose 1 for the reasons above.

## Design

### The switch

A DEV-only flag, off by default, modelled on `partyHome/partyHomeFlag.ts`: localStorage key
`ascent.heroShowcase`, URL `?heroshowcase=1|0`, a `useHeroShowcase()` hook, and an entry in the DEV menu next
to "Party home". A production build always reads it as off. The showcase body renders when
`showcase && ph && !browse` (it needs the party-home tokens; `browse` is the Practice/Gauntlet grid).

### Shared inspect card

Extract the `article.phi` part of `PhHeroPop` into an exported component (suggested `HeroInspectCard`, its own
file) taking the hero, the portrait art to show, and optional slots. `PhHeroPop` keeps its overlay, arrows,
keyboard handling, layer handling, counter and Ancients row, and renders the shared card inside. The
Compendium must look and behave exactly as before (`compendiumHeroAncients.test.tsx` stays green).

On the pick screen the card:

- shows the hero's **equipped skin** art (`heroPortrait(id, loadout)`), like today's cards;
- shows name, Health, Armor, the power medallion, power name, the `heroPowerFacts` chips and power text;
- **does not show the Ancients row or the "Up / Down: Ancients" hint** (Claude's call: Ancients are a
  test-mode feature gated per run, and the run does not exist yet, so the row would promise something most
  runs do not have; easy to add later);
- shows the hero's **difficulty** as one more fact chip, only when the offered heroes differ in difficulty
  (the rule today's party-home look uses) (Claude's call);
- has prev / next arrows at its sides that step the selection through the offer, wrapping; Left / Right arrow
  keys do the same; no counter;
- re-keys on hero change so the card's existing entrance animations replay on each selection, as in the
  Compendium;
- is sized to fit the stage with the tiles above and the button below (the Compendium's `--phi-h` is
  overridden; exact sizes are the builder's, the whole screen must fit 1920x1080 stage with no scroll).

### Tiles

A row of one tile per offer, each a button: portrait (cropped, navy fade at the foot, in the party-home card
language), name, Health and Armor using the same medals as today's party-home cards.

- Clicking a tile selects it (`sfx.pulse`). It never picks.
- **Selection glow**: one gold highlight element in the row slides to the selected tile
  (transform only, about 0.34 s, the easing `kit.css` uses for `.phk-slide`; snap under reduced motion). Reuse
  `partyHome/kit/slideMarker.ts` if it fits a gold outline around a tile; otherwise write the same pattern
  (measure on selection change and on resize only, never per frame). The glow is static paint; only its
  transform animates.
- **Re-roll button** in the tile's top-right corner, straddling the corner as in Mike's sketch: the refresh
  icon in the existing re-roll control's look, same `aria-label` and `.gtip` tooltip text, shown and hidden by
  the existing `canReroll`. Pressing it does not change which slot is selected. The swap animation plays on
  the tile's portrait; when the re-rolled slot is the selected one, the inspect card simply shows the new hero
  (its entrance animation replays).
- The teammate's hero (Ranked Duos) is dimmed and labelled "Your teammate's pick" on its tile. It can still be
  selected and read.
- A `practiceOnly` hero cannot appear here (three-offer modes never offer one).

### Selection state

`selectedIndex` is local state in `HeroSelect`, reset to 0 whenever a new offer arrives. It is an index, so a
re-roll of the selected slot keeps that slot selected. It is not published to spectators.

### Select Hero button

A large primary button under the card, in the shared Gem plate / `phk-btn v-primary` language (no new button
style). Label "Select Hero".

- Pressing it runs today's pick path for the selected hero: the same guards as `onPick` (ceremony idle, no
  pending Versus re-roll), `sfx.pulse`, `lockVersusHeroPick` in Versus, then the `select` dispatch.
- Disabled, with `sfx.deny` on press, while the selected hero is the teammate's pick; the button then reads
  "Taken by your teammate" (Claude's call on the wording).
- Hidden in watch mode. A watcher can still click tiles and arrows to read the three heroes on their own
  screen; when the watched pick arrives, the selection jumps to that hero and the ceremony plays.
- Versus timeout: the selection jumps to the server's hero and the ceremony plays, as today.
- Enter on the focused button picks (native). No global "Enter picks" shortcut (Claude's call: avoids an
  accidental pick).

### Spring hover and press (owner, 2026-11-16)

Mike: "the same hover spring animation and click spring animation we do for many of the home screen items",
and for the hero power: "both it and the hero power explainer text to the side should spring together".

- Use the party home's existing spring: the `--ph-spring` overshoot curve (`shell.css`), a hover that grows
  with an overshoot, a press that squeezes in fast and springs back past hover size on release. The reference
  implementations are the Collection tiles / Compendium rail buttons (`phCompendium.css` ~L538) and the podium
  cards (`phLeaderboard.css` ~L138). Match their curve and durations; do not invent a new one. Transform only.
- Applies to: the three **tiles**, the **re-roll buttons**, the card's **arrows**, and the **Select Hero**
  button.
- **The hero power block**: hovering the power medallion (the circle) or its text springs the medallion and
  the power's name, fact chips and text **together, as one group** (one hover target, one transform on a
  shared wrapper, or two elements driven by the same hover state so they move in step). Pressing it gives the
  same press spring. It is feedback only: it performs no action (Claude's call; nothing was asked of a click).
- The spring is on the pick screen's card. Whether the Compendium's card gets it too is not decided: keep it
  off there (scope it to the pick screen) so the Compendium is unchanged.
- Hover rules are moved into `@media (hover: hover)` by the build; reduced motion gets no spring.
- The selected tile's spring must not fight the sliding glow: the glow tracks the tile's layout box, not its
  hover scale.

### Ceremony handoff

The machine (`heroCeremonyMachine.ts`), the timing data and the Pixi layer are unchanged. What changes is the
source the ceremony starts from when the showcase body is on:

- `sourceRect` is the **splash art's rect** on the inspect card (stage px), `sourceIndex` the selected index.
- At commit, the ceremony's clone is the **splash art alone** at that rect (same art file, same crop and
  right-edge fade as the card), painted before the original is hidden, so there is no visible swap.
- The dismiss beat fades / moves out **everything else**: the tiles (with their re-roll buttons and the glow),
  the card's plate, info column and arrows, and the Select Hero button. The header and Back already leave via
  `.hsc-active`.
- The clone travels to the ceremony's existing destination and hands over to the existing clean portrait
  layer (ring, name plate, Start Game) exactly as the card clone does today. From the materializing beat on,
  the two ceremonies are indistinguishable.
- A reset mid-ceremony (the DEV tuner's Replay, a new offer) restores the whole body, as it restores the card
  grid today.
- The current look's ceremony path (clone of `.herocard.big`, `cardEls`) is untouched when the switch is off.

How the ceremony component takes the new source (a second prop shape, a small "source adapter", a sibling
clone component) is the builder's choice, provided the old path stays byte-for-byte in behaviour.

### Files expected to change

- `packages/ui/src/HeroSelect.tsx`: the body branch, selection state, the pick path shared by both bodies.
- `packages/ui/src/MinionBook.tsx` plus a new shared inspect card file; `partyHome/pages/phCompendium.css`
  only if a rule must move to be shared.
- New files under `packages/ui/src/hero-select/` for the showcase body, its CSS and the flag.
- `packages/ui/src/hero-select/HeroSelectCeremony.tsx` (+ `heroCeremony.css`): the second source.
- The DEV menu entry.

`HeroSelect.tsx` and the ceremony are busy files; rebase on `origin/main` often.

## Verification

- The existing suites stay green untouched: `heroSelectPh.test.tsx`, `heroPickClean.test.ts`,
  `heroReroll.test.tsx`, `versus/spectateHeroSelect.test.tsx`, `gauntlet/heroSelectGauntlet.test.tsx`,
  `tapInspect.test.ts`, `touchInput.test.ts`, `compendiumHeroAncients.test.tsx`, the ceremony unit tests.
- New tests for the showcase body: first hero selected on open; clicking a tile selects and does not start
  the ceremony; Select Hero starts it for the selected hero; arrows wrap; one re-roll then the controls are
  gone, and the selected slot stays selected; teammate's hero cannot be picked; watch mode has no Select Hero
  and follows the watched pick; Practice / Gauntlet still render today's grid with the switch on; switch off
  renders today's screen.
- `npm run typecheck && npm run lint && npm test && npm run build:web`.
- Mike judges the look and the ceremony handoff himself in the dev build with `?heroshowcase=1`.

## Builder notes (settled by review, Claude's calls)

- New tests must turn on **both** flags (party home is off under Vitest unless a test opts in).
- The splash clone **shrinks to today's end rect**: the final portrait size must not grow because the source
  is larger. The source adapter owns that.
- Measure the splash art's **settled layout rect**, not a rect mid-entrance (`phi-in` scales the card for
  0.22 s on each re-key); skip the entrance on forced jumps (Versus timeout, a watched pick).
- `selectedIndex` resets on a new offer (mount, or more than one slot changed) and is kept on a single-slot
  change (a re-roll).
- Left / Right keys are scoped to the showcase body, not `window`: two `HeroSelect` instances can be mounted
  at once in Duos (own screen plus the teammate view).
- The re-roll control is a sibling of the tile button, not nested in it.
- A blocked Select Hero uses `aria-disabled` so the press still reaches `sfx.deny`; a pending Versus re-roll
  blocks it the same way.
- The body renders for any offer of six or fewer, so the tile row flexes for four to six tiles.
- The card's "Duos" badge (`duosOnly`) stays, as in the Compendium.

## Left to the builder

Exact sizes, spacing and tile proportions; the tile's art crop; the glow's exact paint; whether
`slideMarker.ts` is reused or mirrored; component and class names; the shape of the ceremony's source
adapter; the dismiss motion of the tiles, plate and button (in keeping with how the unselected cards leave
today).
