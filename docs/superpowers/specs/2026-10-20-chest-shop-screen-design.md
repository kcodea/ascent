# The Chest Shop screen: design

Owner: Mike, brainstormed 2026-10-20. Status: approved (owner: "build this all the way without my input based off
everything ive signed off on").
Builds on: `2026-10-18-aether-crate-shop-design.md` (Aether, the shop's rules) and `2026-10-19-tiered-chest-openings-design.md`
(the painted tier chests). Starts from `main` at PR 2179 (milestone chests are Epic and can't be focused; `CrateShop` is
the shop alone, no milestone mode).

**The approved mockup is `2026-10-20-chest-shop-screen-mockup.html` next to this file.** Open it while the dev server runs
on port 5230 (it loads the game's art from `http://localhost:5230/`). It is the visual reference for every section
below: layout, sizes, colours, the toggle, the tooltips, the receipt and the per-tier selection effects. Where this
document and the mockup disagree, this document wins. The mockup's "items left" numbers are made up.

## Why

Today the Chest Shop is a small panel in the Collection's right sidebar. Mike: "i want a shop button that leads to a
dedicated full screen experience for selecting the chest and focusing it, i dont like it being in the side bar." His
reference was a mobile-game shop screen: the chest tiers side by side, then the options below, then one big buy button.
Buying a chest should feel like an event: "make selecting each of the chest rarities increasingly exciting for each
rarity", and the focus toggle should be "SUPER noticeable and fun when you toggle it on".

## Goals

1. A **Shop** button in the Collection that opens a **full-screen Chest Shop**. The sidebar panel goes away.
2. On that screen, players pick a chest tier from the five painted chests, focus it category by category, see exactly
   what they pay and why, see the odds, and open it with one big button.
3. Picking a tier and switching a focus on are celebrations, bigger with each tier.
4. **Announcers can no longer be a focus.** They still drop from unfocused chests (owner: "lets remove announcers from
   being able to be focused" / "yes, announcers can drop from the unfocused chests").
5. The **Sealed chests** bay shows the painted chest of the next chest's tier (an Epic milestone chest shows the Epic
   chest), not today's generic CSS crate.

## Non-goals

- Prices, the fee table, the odds, the roll: all unchanged (the Announcers rule aside).
- The opening theatre (`CrateOpener`): unchanged. The shop hands it a purchase exactly as today.
- The Collection's tab order: unchanged. The shop has its own category order.
- A Shop entry on the main menu or the left menu sidebar. Only the Collection's button, for now.

## Anti-goals

- **Any frame drop.** Performance is the north star (`CLAUDE.md`, `docs/performance.md`). Rapid tier clicks and toggle
  spam must stay smooth on the prod build.
- **A purchase the server refuses because client and server disagree about Announcers** (see Rollout).
- **A charge the player didn't see coming.** The total on the button is always the total charged; the purchase-safety
  rules of the Aether design (kept request id, never charged twice, `price_changed` handling) carry over untouched.
- **Desktop changing because of touch, or touch losing a hover-only detail** (the stage and touch rules below).

## The screen (top to bottom; see the mockup)

### Top bar
- Left: a **"◀ Collection"** Gem-plate button that returns to the Collection. Esc does the same (when no theatre or
  sign-in gate is open).
- Then the title **"Chest Shop"** (Outfit 900, `--ui-title` gold).
- Right: the **Aether wallet** chip (the Aether crystal + balance + "Aether"), the same reading as the Collection's.

### Pick a chest
- Heading **"PICK A CHEST"**, large (mockup: 26px, 900, letter-spaced, `--colls-gold`), with the game's
  `frames/name-divider.webp` under it. No subtitle (owner: "remove the text beneath it, its redundant").
- **Five chest cards in one row**: Standard 100, Rare 200, Epic 400, Legendary 600, Ancient 900 (live prices from the
  economy, not literals). Each card: the painted chest (body + lid composed as the theatre composes them, from
  `CHEST_ART` / `CHEST_TIER_ART`, including Epic's and Ancient's `spikeFront`), the tier name in its tier colour, and
  a Gem-plate price pill with the Aether icon. Standard's name is `#d6e0ec`, Rare `#5aa8ff`, Epic `#c07bff`, Legendary
  `#ffb938`, Ancient the opal look (the mockup uses a cyan→opal→pink gradient on the name).
- No "X or better" line on the card (owner: "remove the 'x or better text' lets have that show when hovering over the
  chest and the odds for each tier rolled").
- **Hover a card**: a tooltip in the game's rich tip skin (`.atip`) below the card: "<Tier> Chest", then "Guarantees
  <Tier> or better" (Standard: "Any rarity can drop"), a divider, then one row per rarity it can give with that tier's
  published odds (`tierOddsPercent`), each rarity name in its colour.
- The **selected card** lifts, takes its tier colour on the border, wears a check badge, and keeps a steady halo.
- The default selection when the screen opens is **Standard** (Claude's call: matches today's shop; nothing is spent by
  merely opening the screen).

### Selecting a chest: escalating by tier (owner: "increasingly exciting for each rarity")
A one-shot on every click (clicking the selected card again replays it), plus a steady "selected" look. Numbers are the
mockup's starting points; the builder may tune them, but each tier must clearly out-do the one below.

| Tier | One-shot on click | While selected |
|---|---|---|
| Standard | small hop, 1 white ring, 6 sparks | soft white halo |
| Rare | bigger hop, 1 blue ring, 10 blue sparks | stronger blue halo |
| Epic | hop + wiggle, 2 purple rings, 18 sparks, 6 rising motes, a purple light sweep across the card | bright purple halo |
| Legendary | the card shakes, a white flash, 2 gold rings, 28 sparks, 10 motes, a gold sweep | big gold halo + gold rays slowly turning behind the chest |
| Ancient | a hard shake, a longer flash, 3 rings (cyan, pink, opal), 42 sparks of every hue, 16 motes, a sweep | widest cyan/pink halo + faster multichrome rays |

Each tier also plays a sound on click, escalating by tier, built from clips already in the game (see "Left to the
builder").

### Focus Chest (left panel under the chests)
- Panel heading **"FOCUS CHEST"**, with the line **"The more categories you select, the cheaper the fee!"** (owner's
  exact words).
- Column headings "CATEGORY" and "LEFT TO FIND", then **one row per focusable category**, in this order (owner):
  **Heroes, Minions, Card Plates, Portrait Frames, Attack Animations, Emotes, Titles.** Announcers are not listed.
  A category the server has switched off is not listed (as today).
- Each row: the category name | the count of items **left to find in that category for the picked chest** (its own
  column, right-aligned, so every count sits in the same spot) | the toggle on the right.
- **The toggle** (owner: "SUPER noticeable and fun when you toggle it on. have off greyed out almost"):
  - **Off**: a flat, dim grey slab reading "Off" in faint text; it brightens slightly on hover.
  - **On**: a polished gold pill (the `--ui-edge` gold as its fill) reading "✓ On" in dark ink, with a soft gold halo
    that breathes; the row gets a faint gold wash and its name and count turn gold.
  - **Switching on** plays a one-shot: the pill bounces (shrink, overshoot, settle), a bright ring blasts out of it,
    ~14 gold/white sparks fly, a light band sweeps across the row, and the name pops. A short sound plays. Switching off
    is quiet.
- **A category with nothing left at this tier**: its row stays (so the list never reflows), the count reads 0, and the
  toggle is disabled and dimmer than Off, reading "None left". A tick on it is kept but not priced or shown (today's
  rule). *(Claude's call: the mockup has no sold-out row.)*

### Your Chest (right panel under the chests)
- Panel heading **"YOUR CHEST"**.
- **The receipt** (owner's structure, step by step in the brainstorm):
  ```
  Epic Chest ................ 400
  Focusing
   │ ✓ Heroes ............... +400
   │ ✓ Minions .............. −160
   │ ✓ Emotes ............... −80
  Total ..................... 560
  ```
  - The chest line: "<Tier> Chest" and its price.
  - With no focus, there is no Focusing block at all.
  - "Focusing" is a heading with no amount. Under it, the focused categories in the focus list's order, each with a
    gold check, indented under a thin gold line.
  - **The first focused category carries the full cost of focusing**: the one-category fee (`focusFeePercent[0]`,
    today 100% of the price), in gold.
  - **Every later category shows a discount**, in green, as "−<n>" with the Aether icon: the step down the fee table
    that it causes. With `fee(k)` = the fee for k categories (`round(price × focusFeePercent[k−1] / 100)`, and 0 when k
    equals the number of available categories): row k (k ≥ 2) shows `fee(k−1) − fee(k)`. The rows always sum to the
    real fee, and the Total equals the quote's total exactly.
  - Turning on every available category discounts focusing to 0 (today's rule: everything ticked is no focus, free).
  - **Everything focusable ticked = NO FOCUS, and the chest can still give an Announcer** (owner ruling 2026-10-20, picked
    over "free, never an Announcer" and "charge a fee"). This also covers the case where the ticked categories are
    simply all that's left at this tier (e.g. a Legendary chest where only Heroes and Announcers have items left: ticking
    Heroes is "everything focusable"). The screen must say so, or players feel cheated. *(Claude's call on how:)*
    - The receipt keeps the Focusing block (the discounts sum to 0) and adds one line under it, in the dim note style:
      "Everything ticked: no focus, so any category can drop, Announcers too."
    - The odds come from the unfocused pool (as the quote already does: `quote.focus` is null), so the odds bar and its
      hover counts include Announcers; the hover rows name "Announcers" like any other category.
    - The focus rows' "left to find" counts stay per category; Announcers is still not a row.
  - The discounts are assigned by row order, not click order.
  - The receipt's numbers must come from the same quote the purchase sends (`quoteCrate`), never from separate math
    that could drift. If the fee rounding in `quoteCrate` differs from the formula above, the receipt follows
    `quoteCrate` and makes the last row absorb the difference.
- **Odds**: heading **"ODDS"**, then a tall bar with one slice per rarity this exact chest can give, coloured by rarity,
  sized by its live share, **showing only its percentage inside** (owner: "remove the name from the bar"). These are
  the live odds of this exact chest (floor + focus + what the player owns), as today's quote line computes them
  (`tieredCrateChances` over `eligibleForCrate`). A slice keeps a minimum width so its number stays readable.
  - **Hover a slice**: a rich tooltip: "<Rarity> · <n>%", "<n>% chance this chest gives a <Rarity>. <N> <Rarity> items
    left to find:", then one row per category in the pool with its count of that rarity (real counts).
- No "items left" line and no "You'll have X Aether left" line (owner removed both).
- **The button**: a big Gem-plate button, "Open Chest" with the total under it (Aether icon + number, gold). States, as
  today: "Buying…" (held pressed) while the purchase runs; "Need N more Aether" (disabled) when short; "Sold out" when
  nothing is left at this tier and focus; a guest's button stays live at the price and opens the sign-in gate.
- Errors (price changed, couldn't confirm, …) show under the button with today's copy (`buyErrorCopy`).

### After a purchase
The theatre opens over the shop as today and plays the reveal. On Done the player is **back on the Chest Shop screen**,
balance updated, same tier selected, focus cleared. *(Claude's call: a shop session usually buys more than one.)*

## The Collection changes

- **The Shop button**: at the top of the right sidebar, **above the Sealed chests bay** (owner: "the shop button can be
  in the top right above the milestone chests (sealed chests)"). A full-width Gem-plate button: the Aether crystal +
  "Chest Shop". Shown only while Aether is on (`aetherVisible`), like today's panel.
- The sidebar's `CrateShop` panel is removed. The rest of the sidebar is unchanged.
- **The Sealed chests bay**: the CSS crate (`.colls-crate`) is replaced by the painted chest of the **first sealed
  chest's tier** (`chestTierOf(floor)`; a milestone chest's floor is Epic now, an old held one Legendary; none = Standard).
  It keeps today's float animation and the count badge, and the dimmed look when nothing is ready. With nothing sealed,
  the dimmed chest is the tier of the next chest the player will earn: **Epic while Aether is on** (the next is a
  milestone chest; matches the bay's odds line, `firstFloor ?? MILESTONE_FLOOR`), Standard while it is off. *(Claude's
  call, from the builder check.)*

## Navigation (Claude's call)

The shop is a **mode of the Collection page** (local state in `CollectionPage`), not a new menu destination: the page
swaps its header and body for the shop while the left menu sidebar stays. This keeps the theatre, the sign-in gate and
the purchase interlock (`shopBusy`) where they already live. The left menu still shows Collection as current.
Navigating away and back returns to the Collection, not the shop.

## Rules change: Announcers can't be a focus

- **Client** (`packages/progression/src/crateShop.ts`): `availableFocusCategories` leaves out Announcers (a named
  constant, e.g. `NON_FOCUSABLE_CATEGORIES`). `normalizeFocus`, `focusFeePercent` and `quoteCrate` follow from it. The
  shop's category list comes from the new order constant, filtered by `isCategoryLive` and focusability.
- **Server**: a new migration (`supabase/migrations/2026-10-20-announcers-not-focusable.sql`, idempotent, also appended
  to `schema.sql`) replaces `aether_quote` so its `v_available` leaves out `'announcer'`. Then an Announcers tick is
  `bad_focus`, and the all-ticked-is-free count matches the client. `progression_tiered_crate_pool` is NOT changed, so
  unfocused chests still drop Announcers. Optionally `inventory.ts` `parseFocus` rejects `'announcer'` early.
- `npm run progression:shared` regenerates the Deno copies.
- Tests: the SQL/TS parity tests (`aether.db.test.ts`, `sqlParity.test.ts`, `crateShop.test.ts`) cover it.
- **Oracle**: a new approved rule (next free id, R-PROG-AETHER-06) in `packages/rules/src/registry/approved/foundation.ts`:
  Announcers are never a focus category and still drop from unfocused chests; the "every focusable category ticked is no
  focus" count excludes them, and such a chest is unfocused (free, and it can give an Announcer). Evidence also quotes the
  owner's pick of "Free, may give an Announcer". Evidence: the owner's two quotes above. Update R-PROG-AETHER-03 if its statement names
  the available set.
- `docs/GAME-RULES.md` (focus section) says Announcers can't be focused.

## Rollout (owner-run, in this order)

1. Paste the new migration into the Supabase SQL Editor and Run.
2. (If `inventory.ts` changed) deploy `progression-inventory`.
3. Then ship the client.

If the client ships first, a player who ticks every focusable category is quoted free by the client but charged by the
old server, and the purchase is refused (`price_changed`, safe but confusing). Nothing is deployed by Claude; Mike runs
these when he releases. (Mike is mid-way through a Collection rewards fix before the next web release.)

## Constraints

- **Performance** (`docs/performance.md`): one-shots animate transform/opacity only; the looping pieces are a halo's
  OPACITY over a static shadow (the `kwglow` pattern) and the rays' ROTATION. No layout reads per frame. Spark/ring/mote
  nodes are transient and capped per click; rapid clicks must not pile them up (cancel/replace the previous burst on
  that card or row). Chest art comes through the existing `warmChestArt` cache; the five chests are warmed when the
  shop opens. The quote, odds and per-category counts are memoized as `CrateShop` does today; a toggle re-renders the
  shop only. Profile on the prod build: rapid tier clicks, toggle spam, Ancient select.
- **The stage**: the shop renders inside the scaled stage; no raw `vw`/`vh` or viewport media queries; tooltips are in
  the page's own DOM (or portalled into `stageHost()`), never `document.body`.
- **No `title=`** anywhere (ESLint `banTitleTooltips`); tooltips are the game's own.
- **Cursor**: no bare `cursor: pointer` on the new controls; the global gauntlet cursor rule paints them.
- **Touch**: both hover tooltips (chest card, odds slice) need their `.tt-on` twins (`touchInput.ts`); any touch-only
  styling goes in `touchUi.css` under `html[data-touch-ui]`. Desktop stays pixel-identical to the design.
- **Reduced motion**: no one-shots, no halos breathing, no rays turning; states still read (colours, check, gold pill).
- **Buttons are the Gem plate** (the shared `--ui-*` tokens), as in the mockup. No new literal colours beyond the tier
  colours, the opal look and the discount green.
- **Purchase safety and guests**: everything in the current `CrateShop` (busy ref, kept request id, definite-failure
  handling, guest gate, server kill switch via `catalogEpoch`) carries over unchanged.
- **Tests**: the existing `CrateShop` tests move with the component; add tests for the receipt math (rows sum to the
  quote at every k, all-ticked = 0), the category order, Announcers absent, the bay's tier art choice, and the Shop
  button opening/closing the screen.
- **Repo rules**: one PR into `main` (branch `feat/chest-shop-screen`), squash auto-merge on green `verify`; a
  `patchNotes.ts` entry (the new Chest Shop screen; Announcers can't be focused); the oracle rule above; a devlog entry.

## Left to the builder

- Component structure (a new `ChestShopScreen` reusing `CrateShop`'s logic, or `CrateShop` grown into the screen).
- The exact sounds: pick from existing clips (`packages/ui/src/audio/`, the `sfx` helpers, the crate tier cues'
  candidates in the tiered-chest spec), escalating by tier for chest picks, one bright cue for toggle-on.
- Exact FX numbers, as long as each tier clearly escalates.
- How the composed chest art is drawn in DOM (two positioned `<img>`s, or a small shared helper with the theatre's
  geometry), as long as it matches the theatre's assembly and keeps `decoding="sync"`.
- The layout's exact proportions inside the 1920×1080 stage, keeping the mockup's arrangement.
