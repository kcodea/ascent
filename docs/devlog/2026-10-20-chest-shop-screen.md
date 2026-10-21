# 2026-10-20 — The Chest Shop gets its own full screen; Announcers can no longer be a chest focus

The Chest Shop was a small panel in the Collection's right sidebar. Mike wanted "a shop button that leads to a dedicated
full screen experience for selecting the chest and focusing it", modelled on a mobile-game shop: the five chests side by
side, the options underneath, one big buy button. Spec: `docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md`
(with the approved mockup `…-mockup.html` next to it); plan: `docs/superpowers/plans/2026-10-20-chest-shop-screen.md`.
Branch `feat/chest-shop-screen`, built from `main` after PR 2179 (milestone chests are Epic and can't be focused).

Owner words that bound the work:

- On the screen: "i want a shop button that leads to a dedicated full screen experience for selecting the chest and
  focusing it, i dont like it being in the side bar."
- On excitement: "make selecting each of the chest rarities increasingly exciting for each rarity", and the toggle should
  be "SUPER noticeable and fun when you toggle it on. have off greyed out almost".
- On copy: "remove the text beneath it, its redundant" (the pick heading), "remove the 'x or better text' lets have that
  show when hovering over the chest and the odds for each tier rolled", "remove the name from the bar" (odds slices).
- On placement: "the shop button can be in the top right above the milestone chests (sealed chests)".
- On Announcers: "lets remove announcers from being able to be focused" / "yes, announcers can drop from the unfocused
  chests". For the all-ticked case the owner picked "Free, may give an Announcer".
- On autonomy: "build this all the way without my input based off everything ive signed off on".

## What shipped

- **Announcers are not a focus (R-PROG-AETHER-06).** `crateShop.ts` gains `NON_FOCUSABLE_CATEGORIES` and
  `isFocusableCategory`; `availableFocusCategories` leaves Announcers out, so `normalizeFocus` / `quoteCrate` follow (an
  Announcers tick is `bad`, and ticking every focusable category is "no focus": free, and it can still give an
  Announcer). `eligibleForCrate` is untouched, so unfocused pools keep dropping them. Server side,
  `supabase/migrations/2026-10-20-announcers-not-focusable.sql` replaces `aether_quote` with a `v_available` that skips
  `'announcer'` (also appended to `schema.sql`; the pool and pick functions are not changed). The Deno copy
  `supabase/functions/_shared/progressionCrateShop.ts` is regenerated. New oracle rule R-PROG-AETHER-06, new PGlite test
  `announcersNotFocusable.db.test.ts` (bad_focus at every tier, all-ticked is free, `aether_quote` equals `quoteCrate`),
  `sqlParity.test.ts` updated, `docs/GAME-RULES.md` focus section updated.
- **The model (`chestShopModel.ts`).** Category order (Heroes, Minions, Card Plates, Portrait Frames, Attack Animations,
  Emotes, Titles), `focusReceipt` (first focused row carries the full focus fee, later rows show the step down the fee
  table, and the rows always sum to the quote's total), `oddsSlices` and `leftByCategory`. Everything comes from
  `quoteCrate`, never separate math.
- **The screen (`CrateShop.tsx`, `chestShop.css`).** A full-screen mode of the Collection page: top bar (back,
  "Chest Shop", Aether wallet), "PICK A CHEST" with five painted chest cards and a rich tooltip per card (guarantee and
  odds), "FOCUS CHEST" (a count of items left to find per category, a big gold On pill against a greyed Off slab, a
  disabled "None left" state), "YOUR CHEST" (the step-by-step receipt, the "Everything ticked" note, the Odds bar with a
  per-slice tooltip of counts per category) and one big "Open Chest" button. After a purchase the player lands back on the
  shop with the same tier and focus cleared. Purchase safety (busy ref, kept request id, `price_changed`, the guest gate,
  the server kill switch) carried over unchanged. Esc returns to the Collection.
- **`ChestPicture`.** The painted chest (body + lid, composed as the theatre composes them) as a DOM component, used by
  the shop cards and the Collection's Sealed chests bay. The bay now shows the tier of the first sealed chest (Epic for a
  milestone chest, Legendary for an older held one, Standard for a plain level chest); with nothing sealed it shows Epic
  while Aether is on, Standard while it is off.
- **Escalating celebrations (`chestShopFx.ts`).** A one-shot on every tier click (repeat clicks replay it) and on every
  toggle-on: Standard a hop and a few sparks, up to Ancient with a hard shake, a long flash, three rings (cyan, pink,
  opal), 42 sparks of every hue and 16 motes. Spam-safe: each host keeps one burst at a time, nodes remove themselves,
  and a 2 s fallback sweeps the rest. Transform/opacity only; the looping pieces are a halo's opacity over a static shadow
  and the rays' rotation. Sounds are existing clips, escalating by tier; toggle-on is `triggerGlow`, toggle-off a quiet
  `tick`.
- **The Collection (`CollectionScreen.tsx`).** A full-width "Chest Shop" Gem-plate button above the Sealed chests bay
  (only while Aether is on). The sidebar panel is gone. The shop is a mode of the Collection page, not a new menu
  destination, so the theatre, the sign-in gate and the `shopBusy` interlock stay where they were.
- **Patch notes.** Two Systems entries in the 2026-10-20 block (the screen; Announcers).

## Calls made (the execution ledger, `.superpowers/sdd/2026-10-20-chest-shop-screen/progress.md`)

- Task 3 removes the sidebar `<CrateShop>` from `CollectionScreen.tsx` (one line) so typecheck stays green; Task 5 added
  the button and the shop mode. The shop was unreachable between those two commits only.
- The slice tooltip says "an Epic" / "an Ancient" instead of the copy's literal "a <Rarity>": correct English for the
  owner's copy. Cost if wrong: one word.
- The shop's Esc is a document capture-phase listener (not the plan's non-capture one) because `Game.tsx` toggles settings
  on a window-bubble Esc. It bails when settings, the book or the inspect view is open, and stops propagation when it acts.
- `.colls-crate` CSS was kept (the plan said delete): `GauntletEndScreen` still renders it for its clear reward.
- The one-shot marker is a `data-pop` attribute rather than a `pop` class: React rewrites `className` on the re-render a
  click causes and wiped the class.
- The Rare pick sound is `discoverSelect`, not `pickPress`: `pickPress` arms the pick latch and would silence a following
  `discoverSelect` (an Epic click right after a Rare one). Mike may prefer other clips (each is a one-line change in
  `TIER_PICK_SOUND`).
- Claude's calls inside the spec: Standard is selected when the screen opens (nothing is spent by opening it); a category
  with nothing left keeps its row, reading 0 with a disabled "None left" toggle; after a purchase the player returns to the
  shop; the "Everything ticked: no focus, so any category can drop, Announcers too." note under the receipt.
- Deferred minor review notes: GAME-RULES wording "available" vs "focusable" (~line 927), `aether.db.test.ts`'s all-ticked
  case still runs the old SQL (the new db test covers the new behaviour), the Shop button lacks the `pressable` class, the
  Collection JSX fragment is not re-indented, `receiptRows`' absorb branch is untested (dead today).

## Rollout (owner-run, in this order)

1. **Run `supabase/migrations/2026-10-20-announcers-not-focusable.sql` in the Supabase SQL Editor BEFORE the client
   ships.** It is idempotent. Nothing was deployed by Claude.
2. Then ship the client (`npm run release:web`).

If the client ships first, a player who ticks every focusable category is quoted free by the client but charged by the old
server (which still counts Announcers as a category), and the purchase is refused as `price_changed`. Safe, but confusing.
`inventory.ts` `parseFocus` is unchanged, so no edge function needs deploying; until the SQL runs, the live server still
accepts an Announcers focus (the SQL quote is the gate).

## Please check (owner)

- **Profile the shop on the prod build** (`npm run build:web`, then `vite preview`, as in `docs/performance.md`; Chrome
  DevTools with CPU 4x slowdown): rapid tier clicks, toggle spam, and an Ancient pick (the heaviest: 61 short-lived nodes
  per click, the same as the mockup). A dropped frame is a defect. None of this could be driven from the build session.
- **Listen to the sounds once.** The pick cues (Standard `pulse`; Rare `discoverSelect`; Epic adds a sheen; Legendary
  `upgrade` + sheen; Ancient `triple` + `gemApply` + sheen) and the toggle cue were chosen from the helpers'
  descriptions and clip lengths, not by ear.
- **Eyeball the layout at 1920x1080 and a scaled stage.** The screen was built from the mockup's proportions (1560px page,
  five columns, 1.35fr/1fr lower panels) and pinned by tests, but not visually verified in a browser by the builders.
- **Touch:** both tooltips (chest card, odds slice) have `.tt-on` twins; check a tap on a phone-sized stage.
