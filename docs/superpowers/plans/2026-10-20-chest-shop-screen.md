# Chest Shop Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Chest Shop out of the Collection sidebar into a full-screen screen opened by a Shop button, with painted
tier chests, escalating pick/toggle celebrations, a discount-style receipt, a live odds bar, the bay showing the next
chest's painted art, and Announcers no longer focusable (client + server).

**Architecture:** Pure logic lives in `@game/progression` (the focus rule) and a new pure UI model
(`chestShopModel.ts`: category order, receipt rows, odds slices, per-category counts). `CrateShop.tsx` grows from the
sidebar panel into the full-screen screen and keeps every purchase-safety mechanism it has today. A small DOM component
draws a painted chest from the theatre's geometry (shop cards + bay). The celebrations are a small DOM-burst helper plus
CSS keyframes (transform/opacity only). The Collection page shows the shop as a local mode.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest (jsdom for UI, PGlite for `*.db.test.ts`), plain CSS, PostgreSQL
(Supabase).

**Spec:** `docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md` (approved). Visual reference:
`docs/superpowers/specs/2026-10-20-chest-shop-screen-mockup.html` (read it as source; to view it, the dev server must run
on port 5230). Read both before any task.

## Global Constraints

- Repo contract: `CLAUDE.md` at the repo root. Branch `feat/chest-shop-screen` (already exists, already pushed). Commit
  after each task; never push to `main`. Run `npm install` once in this worktree before trusting checks (done already).
- Performance north star: looping animations may only change `opacity` (over a static shadow) or `transform`; one-shots
  transform/opacity only; no layout reads per frame; transient burst nodes capped and replaced per host.
- Stage rules: no raw `vw`/`vh` or viewport `@media`; portal only into `stageHost()`; `stageTripwire.test.ts` must pass.
- No `title=` / SVG `<title>` / `el.title` (ESLint `banTitleTooltips`). No bare `cursor: pointer` on new controls.
- Touch: every hover-only reveal (chest-card tooltip, odds-slice tooltip) needs its `.tt-on` twin in the same rule
  (see `packages/ui/src/touchInput.ts`); touch-only styles go in `touchUi.css` under `html[data-touch-ui]`.
- Buttons/pills use the Gem plate tokens (`--ui-sheen`, `--ui-plate`, `--ui-edge`, `--ui-bevel`, `--ui-ring`,
  `--ui-text`, `--ui-title`, hover `--ui-hover-plate`/`--ui-hover-edge`), as in `collection.css` `.colls-shop`.
- Tier colours: Standard `#d6e0ec`, Rare `#5aa8ff`, Epic `#c07bff`, Legendary `#ffb938`, Ancient opal (`#f4eeff`, the
  name drawn cyan `#8af5ff` → `#f4eeff` → pink `#ff9bf0`). Discount green `#7fe0a0`.
- Copy (exact): "Chest Shop", "◀ Collection", "PICK A CHEST", "FOCUS CHEST", "The more categories you select, the cheaper
  the fee!", "CATEGORY", "LEFT TO FIND", "Off", "✓ On", "None left", "YOUR CHEST", "Focusing", "Total", "ODDS",
  "Open Chest", "Everything ticked: no focus, so any category can drop, Announcers too.", tooltip "Guarantees <Tier> or
  better" / "Any rarity can drop", slice tip "<Rarity> · <n>%" and "<n>% chance this chest gives a <Rarity>. <N>
  <Rarity> items left to find:". No em dashes in player text.
- Shop focus order (exact): Heroes, Minions, Card Plates, Portrait Frames, Attack Animations, Emotes, Titles
  (`hero_skin, minion_skin, card_plate, portrait_frame, hero_attack, emote, title`). Announcers never focusable.
- Every focusable category ticked = no focus: free, and the chest can give an Announcer (owner ruling 2026-10-20).
- Reduced motion: no one-shots, no breathing halos, no turning rays; states still read.
- Don't deploy anything and don't run SQL against Supabase; the owner runs the migration.

## Review Focus

1. **Rapid input**: spam-clicking a tier card or a toggle must not pile up burst nodes or stack animations
   (Task 4 pins: a second burst on the same host replaces the first).
2. **Receipt drift**: for every number of ticked categories at every tier, the receipt rows sum to `quoteCrate`'s fee
   and Total equals `quote.total` (Task 2 pins this exhaustively).
3. **A category with nothing left at the picked tier** while ticked: kept, not priced, row shows 0 and "None left"
   (Task 3 pins).
4. **Leaving mid-purchase**: Back / Esc while "Buying…" must not drop the reveal of a charged purchase (Task 5 pins:
   Back is disabled while busy, and a success after the screen closed still opens the theatre, as today).
5. **Aether switched off while the shop is open** (server kill switch): the page falls back to the Collection, no
   crash (Task 5 pins).

---

### Task 1: Announcers can't be a focus (client rules, SQL, oracle)

**Files:**
- Modify: `packages/progression/src/crateShop.ts` (`availableFocusCategories`, new constant)
- Modify: `packages/progression/src/index.ts` only if it does not already re-export everything from `crateShop.ts`
- Create: `supabase/migrations/2026-10-20-announcers-not-focusable.sql`
- Modify: `schema.sql` (append the same block verbatim at the end)
- Create: `packages/progression/src/announcersNotFocusable.db.test.ts` (copy the harness pattern of
  `milestoneChestsEpic.db.test.ts`)
- Modify: `packages/progression/src/crateShop.test.ts`; update `aether.db.test.ts` / `sqlParity.test.ts` only if they
  fail because of this change
- Regenerate: `supabase/functions/_shared/*` via `npm run progression:shared` (never hand-edit)
- Modify: `packages/rules/src/registry/approved/foundation.ts` (append R-PROG-AETHER-06; amend R-PROG-AETHER-03's
  statement only if it names the available set)
- Modify: `docs/GAME-RULES.md` (the focus section: Announcers can't be focused; everything focusable ticked is no focus)

**Interfaces:**
- Produces: `export const NON_FOCUSABLE_CATEGORIES: readonly CosmeticCategory[] = ['announcer']` and
  `export const isFocusableCategory = (c: CosmeticCategory): boolean` from `@game/progression`.
  `availableFocusCategories(owned, floor, catalog?)` never returns `'announcer'`.

- [ ] **Step 1: Write failing tests in `crateShop.test.ts`**
  - `availableFocusCategories(new Set(), 'common')` does not contain `'announcer'`; `isFocusableCategory('announcer')`
    is false and `isFocusableCategory('hero_skin')` true.
  - `quoteCrate({ tier: 'standard', focus: ['announcer'], owned: [] })` is `null` (a bad focus).
  - Ticking every category in `availableFocusCategories(owned,'legendary')` gives `focus: null`, `fee: 0`, and its
    `remaining` equals `eligibleForCrate(owned, 'legendary', null).length` (unfocused pool, Announcers included).
  - With a test catalog where only `hero_skin` and `announcer` items are left at Legendary, ticking `['hero_skin']`
    gives `focus: null` and `fee: 0`.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/crateShop.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the constant, `isFocusableCategory`, and the filter in `availableFocusCategories` (filter
  the returned list; `eligibleForCrate` is untouched so unfocused pools keep Announcers). Update the doc comments.
- [ ] **Step 4: Run** the same test — expect PASS.
- [ ] **Step 5: Write the migration.** Header in the house style (see `2026-10-20-milestone-chests-epic.sql:1-24`):
  what it does, owner quotes ("lets remove announcers from being able to be focused", "yes, announcers can drop from the
  unfocused chests"), run order (after the 2026-10-20 milestone file), idempotent, mirrored in `schema.sql`. Body:
  `create or replace function public.aether_quote(...)` identical to the current one (`schema.sql` around line 9796)
  except the `v_available` select adds `and c.category <> 'announcer'`, then the same revoke/grant lines the original
  has (`schema.sql` ~10023). `progression_tiered_crate_pool` is NOT touched.
- [ ] **Step 6: Write `announcersNotFocusable.db.test.ts`** (PGlite, runs the aether files then this file):
  `aether_quote(user,'standard',array['announcer'],false)` raises `bad_focus`; ticking every non-announcer category
  that has items returns `focus` null and `fee` 0; for a few focus sets, `aether_quote` equals `quoteCrate` (fee, total,
  remaining, focus).
- [ ] **Step 7: Run** `npx vitest run packages/progression` — expect PASS (fix `aether.db.test.ts` / `sqlParity.test.ts`
  expectations only where they encoded Announcers as focusable).
- [ ] **Step 8: Run** `npm run progression:shared` and confirm only `_shared` progression copies changed.
- [ ] **Step 9: Oracle.** Append R-PROG-AETHER-06 to `foundation.ts` following the CLAUDE.md recipe: statement
  "Announcers are never a chest focus category. They still drop from unfocused chests. When every focusable category is
  ticked (or the ticked ones are all that is left at the tier), the chest is unfocused: free, and it can give an
  Announcer."; evidence = the two owner quotes above plus "Free, may give an Announcer" (owner's pick, 2026-10-20) and a
  `code` entry for `crateShop.ts` + the migration; `currentBehaviour` honest; enforcement `scenario` refs =
  `packages/progression/src/crateShop.test.ts` and `packages/progression/src/announcersNotFocusable.db.test.ts`,
  `lastVerifiedAt: '2026-10-20'`.
- [ ] **Step 10: Run** `npx vitest run packages/rules` and `npm run docbot:report -- --check` — expect PASS.
- [ ] **Step 11: Update `docs/GAME-RULES.md`** focus section. Commit:
  `feat(progression,sql): Announcers can't be a chest focus (R-PROG-AETHER-06)`.

### Task 2: The shop's pure model

**Files:**
- Create: `packages/ui/src/progression/chestShopModel.ts`
- Test: `packages/ui/src/progression/chestShopModel.test.ts`

**Interfaces:**
- Consumes: from `@game/progression`: `eligibleForCrate`, `tieredCrateChances`, `focusFeePercent`, `isCategoryLive`,
  `isFocusableCategory` (Task 1), `CRATE_TIER_FLOOR`, `COSMETIC_RARITIES`, types.
- Produces:
  ```ts
  export const SHOP_FOCUS_ORDER: readonly CosmeticCategory[]; // hero_skin, minion_skin, card_plate, portrait_frame, hero_attack, emote, title
  export function shopFocusCategories(): CosmeticCategory[]; // SHOP_FOCUS_ORDER filtered by isCategoryLive && isFocusableCategory
  export function leftByCategory(owned: Iterable<string>, floor: CosmeticRarity): Map<CosmeticCategory, number>; // unfocused pool counts per category
  export interface ReceiptRow { category: CosmeticCategory; amount: number } // row 0 positive, later rows <= 0
  export interface FocusReceipt { rows: ReceiptRow[]; noFocus: boolean }
  export function focusReceipt(i: { price: number; ticked: readonly CosmeticCategory[]; available: number; economy?: AetherEconomy }): FocusReceipt | null;
  export interface OddsSlice { rarity: CosmeticRarity; percent: number; count: number; byCategory: { category: CosmeticCategory; count: number }[] }
  export function oddsSlices(owned: Iterable<string>, floor: CosmeticRarity, focus: readonly CosmeticCategory[] | null): OddsSlice[];
  ```
  `focusReceipt`: null when `ticked` is empty. `fee(k) = Math.floor(price * focusFeePercent(k, available, eco) / 100)`;
  row 0 = `fee(1)`, row k (k ≥ 1, zero-based) = `-(fee(k) - fee(k + 1))`; `noFocus = ticked.length >= available`.
  `ticked` arrives already in shop order and already limited to available categories.
  `oddsSlices`: rarities with a share > 0, lowest first; `percent` = share × 100 rounded to one decimal (same as today's
  `oddsLine` in `CrateShop.tsx`); `byCategory` in `SHOP_FOCUS_ORDER` then any others (Announcers last), counts > 0 only.

- [ ] **Step 1: Write failing tests**
  - `SHOP_FOCUS_ORDER` equals the exact list above; `shopFocusCategories()` has no `'announcer'`.
  - Exhaustive receipt parity: for every tier and every k from 1 to `available` (taking the first k of
    `availableFocusCategories(owned, floor)` re-ordered by `SHOP_FOCUS_ORDER`), the sum of `rows[].amount` equals
    `quoteCrate({ tier, focus: those, owned }).fee` and `price + sum === quote.total`. Use an empty `owned` and one
    partially-owned set.
  - Epic, ticked Heroes+Minions+Emotes, 7 available: amounts `[400, -160, -80]`.
  - All available ticked: `noFocus` true and the sum is 0.
  - `oddsSlices([], 'epic', null)` percents `[64.7, 26.5, 8.8]` (the current shop's pinned numbers); every slice's
    `count` equals the sum of its `byCategory` counts; with focus `['hero_skin']` no slice lists another category.
  - `leftByCategory` sums to `eligibleForCrate(owned, floor, null).length`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/chestShopModel.test.ts` — FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(ui): chest shop model (order, receipt, odds slices)`.

### Task 3: The full-screen Chest Shop and the painted chest picture

**Files:**
- Create: `packages/ui/src/progression/ChestPicture.tsx` (+ its layout math, exported for the test)
- Rewrite: `packages/ui/src/progression/CrateShop.tsx` into the full-screen screen (keep the export name `CrateShop`)
- Create: `packages/ui/src/progression/chestShop.css` (the screen's styles; import it from `CrateShop.tsx`)
- Modify: `packages/ui/src/progression/collection.css` (delete the now-unused `.colls-shop*` rules)
- Modify: `packages/ui/src/progression/CrateShop.test.tsx` (keep every behaviour test; update selectors/props)
- Test: `packages/ui/src/progression/ChestPicture.test.tsx`
- Modify (touch twins): the stylesheet holding `.tt-on` mirrors, per `touchInput.ts`

**Interfaces:**
- Consumes: Task 2's model; `chestArtFor(tier)` and `warmChestArt` (`crateFx/chestArt.ts`); `ChestTier`, `chestTierOf`,
  `CHEST_TIERS` (`crateFx/chestTiers.ts`); `AetherIcon`; everything `CrateShop.tsx` uses today.
- Produces:
  ```ts
  export function chestLayout(art: ChestArt): { padTopPct: number; lidLeftPct: number; lidWidthPct: number;
    spike: null | { leftPct: number; topPct: number; widthPct: number; aspect: number; imgWidthPct: number; imgLeftPct: number; imgTopPct: number } };
  export function ChestPicture(p: { tier: ChestTier; className?: string }): JSX.Element;
  export interface CrateShopProps { guest: boolean; onGuest: () => void;
    onOpen: (item: CrateQueueItem, open: (crateId: string) => Promise<CrateOpenOutcome>) => void;
    onBusy?: (busy: boolean) => void; onBack: () => void; reducedMotion?: boolean }
  export const CrateShop: React.NamedExoticComponent<CrateShopProps>;
  ```
  `chestLayout` expresses everything as a percent of the BODY's width (so CSS `padding-top`/`margin-top` percentages,
  which resolve against width, place it): lid width = `lidSrcW / bodySrcW`, lid left = `(spikeX - lidAttachX) / bodySrcW`,
  the lid's overhang above the body = `(lidAttachY - rimY - lidOverlap) / bodySrcW` (the wrapper's `padding-top`; the
  lid is absolutely placed at the top). `spike` (Epic, Ancient: `spikeFront`) is an overflow-hidden box at the
  spikeFront rect showing the body image again, so the spike draws over the lid, as the theatre does. Images use the
  same URL helper `chestArt.ts` uses, `alt=""`, `draggable={false}`, `decoding="sync"`.

- [ ] **Step 1: Failing tests**
  - `ChestPicture.test.tsx`: `chestLayout(CHEST_ART).lidWidthPct` ≈ `1158/1187*100`; `.lidLeftPct` ≈
    `(594-578.5)/1187*100`; `.padTopPct` ≈ `(336-41-3)/1187*100`; `.spike` null for Standard, non-null for Epic and
    Ancient; `<ChestPicture tier="epic"/>` renders two `<img>` with the epic body/lid URLs (plus the spike crop).
  - `CrateShop.test.tsx` (new cases; keep all existing behaviour cases green with updated queries):
    - renders "Chest Shop", a "◀ Collection" button that calls `onBack`, and five tier cards with live prices;
      Standard selected by default;
    - focus rows appear in the exact shop order, no Announcers row, each with its "left to find" count;
    - toggling Heroes then Minions then Emotes on Epic shows receipt rows `+400`, `−160`, `−80` and Total 560, and the
      button's total 560;
    - ticking every focusable category shows the "Everything ticked…" line and a Total equal to the bare price;
    - a category with 0 left at the picked tier: its toggle is disabled and reads "None left"; a tick made at a lower
      tier is kept but not priced;
    - the odds bar has one slice per rarity with only its percent as text, and each slice's tooltip names its
      categories with counts;
    - after a successful purchase `onOpen` is called and the focus is cleared; the tier stays;
    - while buying, the Back button is disabled and Esc does nothing;
    - no element has a `title` attribute.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/CrateShop.test.tsx packages/ui/src/progression/ChestPicture.test.tsx` — FAIL.
- [ ] **Step 3: Implement** `ChestPicture` and the screen, matching the mockup's layout and styles (top bar, the five
  cards with hover tooltips from `tierOddsPercent`, the focus rows with the static Off/On toggle look, the receipt from
  `focusReceipt`, the odds bar from `oddsSlices` with hover tips, the big "Open Chest" button with its states). The
  celebrations come in Task 4; give each card and each toggle a stable element it can attach to. Keep every purchase
  mechanism of today's `CrateShop` (busy ref, `pendingRef` request id, `isDefiniteBuyFailure`, `buyErrorCopy`, guest
  path, `catalogEpoch` memo keys, success ignoring `alive`). Warm all five chests' art on mount (`warmChestArt`). Esc
  calls `onBack` unless busy (a non-capture `keydown` listener; the theatre and the gate already capture Esc first).
- [ ] **Step 4: Run** the tests — PASS. Then `npm run typecheck` and `npm run lint` — PASS.
- [ ] **Step 5: Commit** `feat(ui): full-screen Chest Shop and painted chest picture`.

### Task 4: The celebrations (tier pick + toggle on) and their sounds

**Files:**
- Create: `packages/ui/src/progression/chestShopFx.ts`
- Test: `packages/ui/src/progression/chestShopFx.test.ts`
- Modify: `packages/ui/src/progression/CrateShop.tsx` (call the bursts + sounds), `chestShop.css` (keyframes, halos,
  rays, the On pill glow)

**Interfaces:**
- Produces:
  ```ts
  export interface PickFx { rings: number; sparks: number; reach: number; motes: number; shake: 'none' | 'small' | 'big'; flash: boolean; sweep: boolean; rays: boolean }
  export const TIER_PICK_FX: Readonly<Record<ChestTier, PickFx>>; // standard 1/6/50/0 none, rare 1/10/65/0 none, epic 2/18/90/6 none+sweep, legendary 2/28/115/10 small+flash+sweep+rays, ancient 3/42/145/16 big+flash+sweep+rays
  export const TOGGLE_FX: { sparks: number; reach: number }; // 14, ~60
  export function playPickBurst(host: HTMLElement, tier: ChestTier, reduced: boolean): void;
  export function playToggleBurst(host: HTMLElement, reduced: boolean): void;
  ```
  Each `play*` first removes any burst nodes it previously added to that host (so spam never piles up), then appends
  the transient nodes (rings, sparks, motes) with CSS custom properties for direction/colour, each removing itself on
  `animationend` plus a timeout fallback, and restarts the host's one-shot class (`pop`) the way the mockup does.
  Ancient's spark colours are random hues (`Math.random` is fine in `packages/ui`; the ESLint ban covers core/content/sim
  only).

- [ ] **Step 1: Failing tests** (`chestShopFx.test.ts`, jsdom): sparks, rings, reach and motes never decrease from
  Standard to Ancient and sparks strictly increase; `playPickBurst(host,'epic',false)` adds 2 rings + 18 sparks + 6
  motes; calling it twice leaves exactly one burst's worth of nodes; `reduced = true` adds nothing; `playToggleBurst`
  adds 14 sparks and also replaces its previous burst.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression/chestShopFx.test.ts` — FAIL.
- [ ] **Step 3: Implement** the module and the CSS (port the mockup's keyframes: `hop`, `hopwiggle`, `shake-s`,
  `shake-l`, `flash`, `csweep`, `ringx`, `spark`, `rise`, `halo`, `spin`, `togpop`, `ring`, `nmpop`, `sweep`; the
  per-tier `--h`/`--gl`/`--gs` vars; the Off slab and the gold On pill with its breathing halo; the selected card's halo
  and Legendary/Ancient rays). Guard everything under reduced motion (the `reducedMotion` prop and the
  `prefers-reduced-motion` media query, as `collection.css` does).
- [ ] **Step 4: Sounds.** On a tier pick, play a cue that escalates by tier; on toggle-on, one bright cue. Use existing
  helpers in `packages/ui/src/sfx.ts` only (no new audio files): e.g. Standard `sfx.pulse`, Rare `sfx.pickPress`,
  Epic `sfx.discoverSelect`, Legendary `sfx.upgrade`, Ancient `sfx.gemApply` + `sfx.upgrade`; toggle-on `sfx.triggerGlow`
  (listen to what each does in `sfx.ts` and pick the best escalating set; record the choice in a comment). Toggle-off
  keeps `sfx.tick`.
- [ ] **Step 5: Run** the tests, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 6: Commit** `feat(ui): chest shop celebrations escalate by tier`.

### Task 5: The Collection: Shop button, shop mode, bay chest art

**Files:**
- Modify: `packages/ui/src/progression/CollectionScreen.tsx`, `packages/ui/src/progression/collection.css`
- Modify: `packages/ui/src/progression/CollectionScreen.test.tsx` (or `Crates.test.tsx` where the bay is tested)

**Interfaces:**
- Consumes: `CrateShop` + `CrateShopProps` (Task 3), `ChestPicture` (Task 3).

- [ ] **Step 1: Failing tests**
  - with Aether on, the sidebar shows a "Chest Shop" button above the Sealed chests bay and no shop panel; clicking it
    replaces the header and body with the Chest Shop; "◀ Collection" returns;
  - with Aether off there is no Shop button;
  - the bay draws `ChestPicture` of the first sealed chest's tier (an Epic milestone crate → epic art); with nothing
    sealed and Aether on it draws the Epic chest (dimmed), with Aether off the Standard chest;
  - switching Aether off while the shop is open returns to the Collection without error;
  - a purchase in flight (`shopBusy`) still blocks the bay's Open, as today.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/progression` — FAIL.
- [ ] **Step 3: Implement**: `const [shopOpen, setShopOpen] = useState(false)`; the shop shows only while
  `shopOpen && aetherOn`; render `<CrateShop guest={anonymous} onGuest={openGate} onOpen={playBought} onBusy={setShopBusy}
  onBack={closeShop} reducedMotion={reducedMotion} />` in place of `.lbtopbar` + `.colls-body` (keep `MenuSidebar` and
  every overlay: gate, theatre, popups). The Shop button: full-width Gem plate, `<AetherIcon />` + "Chest Shop", at the
  top of `aside.colls-side`, only while `aetherOn`. Remove the sidebar `CrateShop`. Bay: replace `.colls-crate` with
  `<ChestPicture tier={bayTier} className="colls-bay-chest" />` (keep the float animation, glow, count badge and the
  dimmed state; delete the old `.colls-crate` CSS). `bayTier = sealed[0]?.tier ?? (aetherOn ? chestTierOf(MILESTONE_FLOOR) : 'standard')`.
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 5: Commit** `feat(ui): Collection opens the Chest Shop screen; the bay shows its chest`.

### Task 6: Player-facing notes, devlog, full gates

**Files:**
- Modify: `packages/ui/src/patchNotes.ts` (prepend one entry under today's date block or a new 2026-10-20 block,
  following the file's existing shape)
- Create: `docs/devlog/2026-10-20-chest-shop-screen.md` (house style: see `docs/devlog/README.md` and
  `2026-10-19-tiered-chest-openings.md`; include the owner quotes, the calls made, the rollout runbook, and a "please
  check (owner)" profiling list)
- Modify: `docs/roadmap.md` only if it lists this work

- [ ] **Step 1:** Patch note (plain English, spoiler-light): the Chest Shop now has its own screen (a Chest Shop button
  in Collection), every chest shows its painted art, focus each category with a toggle and see the price break down,
  hover the odds for detail, and Announcers can no longer be focused (they still drop from unfocused chests).
- [ ] **Step 2:** Devlog entry, including the rollout: run `supabase/migrations/2026-10-20-announcers-not-focusable.sql`
  BEFORE the client ships (otherwise ticking every focusable category quotes free on the client but the old server
  charges, and the purchase is refused as `price_changed`).
- [ ] **Step 3: Run the full gates** from the repo root: `npm run typecheck && npm run lint && npm test && npm run build:web`,
  then `npx vitest run packages/rules` and `npm run docbot:report -- --check`. All must pass; fix anything red.
- [ ] **Step 4: Commit** `docs: Chest Shop screen devlog + patch note`.
