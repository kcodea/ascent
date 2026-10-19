# 2026-10-18 — Aether + Crate Shop: an earned currency replaces level-up crates

Crates are no longer handed out one per level. Players earn **Aether** by playing and spend it in a **Crate Shop**
(a mode of the Collection) on crates of five rarity floors, optionally **focused** onto categories for a fee. Spec:
`docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md`; plan: `docs/superpowers/plans/2026-10-18-aether-crate-shop.md`.
Shipped as two stacked PRs: **A** (engine + SQL + Edge Functions, `feat/aether-engine`) and **B** (UI, `feat/aether-shop-ui`).

## What shipped

- **`@game/progression` (`aether.ts`, `cosmetics.ts`)** — the pure rules, shared with the Deno Edge Functions via
  `npm run progression:shared`: `DEFAULT_AETHER_ECONOMY`, `aetherForRanked` / `aetherForVersus` / `aetherForGauntlet`,
  `quoteCrate`, `normalizeFocus`, `availableFocusCategories`, `pickTieredCrateReward`, `milestoneLevelsThrough`. The
  roll version is now 5 (`CRATE_ROLL_VERSION`).
- **SQL (`supabase/migrations/2026-10-18-aether.sql`, appended verbatim to `schema.sql`)** — `aether_config` (the switch
  plus the one-row economy), `aether_wallets`, `aether_ledger` (unique per user + reason + source, so a replayed earn or
  spend changes nothing), `buy_crate`, the 4-argument `open_crate` (focus + expected fee), and `settle_progression`,
  `record_gauntlet_clear`, `progression_result_json`, `progression_profile_json` re-written to pay Aether and grant
  milestone crates instead of a crate per level. Rolls, balances and prices are decided in SQL only; the client names a
  tier, a focus, the price it showed and a request id, and a stale price is refused (`price_changed`), never re-priced.
- **Edge Functions** — `submit-progression` (passes `aether` through), `progression-inventory` (`buy_crate`, focused
  open), `gauntlet-clear` (pays the stage's Aether).
- **UI** — `CrateShop.tsx` (tier picker, focus chips, live quote, guest sign-in gate, milestone mode), the Collection's
  crate bay + Aether wallet, post-game "Aether earned" lines, the Gauntlet clear paying Aether, `progressionStore`
  balance + economy, and the `fetchOwnCrates` / profile reads of the wallet.
- **Oracle** — the `R-PROG-AETHER-*` rules in `packages/rules/src/registry/approved/` pin the earn table, the price/fee
  tables, the guest rule, the milestone rule and the Gauntlet fallback.
- **Patch notes** — a Systems entry under 2026-10-19.

### The numbers

| | |
|---|---|
| Ranked | 50 per accepted, placed game + bonus by place 1-8: 140 / 80 / 45 / 35 / 25 / 15 / 10 / 0 |
| Versus | 25 per completed match, +45 for the winner (an abandoned match with no winner pays 25) |
| Gauntlet | 200 for the first clear of each stage, once per stage; stages cleared before rollout pay nothing |
| Practice, Tutorial | 0 |
| Crate prices | Standard 100 · Rare 200 · Epic 400 · Legendary 600 · Ancient 900 (each guarantees its rarity or better) |
| Focus fee (% of price) | by categories ticked, 1..7: 100 / 60 / 40 / 25 / 15 / 10 / 5; 8+ (but fewer than all available) 5; ticking every available category is no focus and free |
| Milestone crates | a free Legendary-floor crate at Level 10, 20, 30, ...; focusable at open for the Legendary fee; backdated at rollout |

The Level-1 Welcome Crate is unchanged. Accounts start at 0 Aether. Aether is never bought with money. Guests earn and
see Aether but cannot spend it (every spend path shows `CrateSignInGate`).

## Owner decisions (2026-10-18 brainstorm)

- The idea: "i want to make a currency instead that you are awarded from playing the game, and then you can buy crates
  of various types with that currency, alongside crates of various rarities to increase your odds of higher tier
  rewards, all for an increased cost". Named: "the currency is called Aether".
- Floors plus focus: "i want to go in a slightly different direction where you purchase a crate of various rarity
  floors, but then you can pay additional ammounts to focus it into one or more of the various categories".
- Focus fee shape: "focusing shouldnt be added cost per extra category, as adding more categories actually sort of
  removes your odds of getting precisely what you want" (so the narrower the focus, the more it costs).
- Earning and milestones: "i want a system in place where you are granted a certain amount of aether when you play a
  ranked match, no matter the outcome, but then depending on the outcome, you gain an additional amount. leveling up
  should still grant rewards, but lets change it to levels 10, 20, and every 10th level from there you receive a
  legendary crate instead."
- Placement: "make first place a 140 bonus and second 80".
- Prices: "Epic crates should be about 4x harder to obtain than a standard crate" / "lets do 6x and 9x for leg and
  ancient" / "can we make standard crates 100 aether instead?"
- Gauntlet: "yeah they can earn aether".
- Practice pays 0, milestone crates focusable at open, backdated milestones, old sealed crates kept, earned-only: "this
  is all correct".

## Calls made during the build (rulings on the owner's behalf)

- **Guest Buy stays enabled.** A guest's Buy button is live whatever their balance (unless sold out) and shows the
  sign-in gate, rather than a disabled "Need N more" that hides why they cannot buy.
- **Milestone crates are never bulk-opened (revised 2026-10-19, final review).** Every milestone crate is opened one at a
  time through its focus step, from the Collection bay. The single Open (the bay's and the New rewards pop-up's, which
  now share `openBay`) shows the focus step when the first sealed crate is a milestone crate, and otherwise plays a
  queue that stops before the first one, so "Open next" never opens one unfocused. **Open all** (the bay's and the
  pop-up's) opens only the other sealed crates and leaves milestone crates sealed; with only milestone crates sealed it
  is not offered. (The first ruling let Open all open them unfocused; the review found that spent the player's one
  chance to focus a free Legendary crate.) With Aether off, nothing changes.
- **A purchase is never charged twice (2026-10-19, final review).** A Buy whose answer never came (a timeout, a network
  error, a 5xx such as `aether_config_missing`, an unparseable answer) may have landed. The Crate Shop keeps that
  attempt's request id, keyed by tier + canonical focus + total, until a definite answer (success, or a 4xx refusal:
  `isDefiniteBuyFailure` in `progressionStore.ts`), and a retry of the same picks reuses it, so a landed purchase answers
  `already_opened` and its reveal plays. Changing the picks drops it. After such a failure the store re-reads the balance
  and the crates, and the shop says "Couldn't confirm that purchase. Try again: you won't be charged twice."
- **The shop shows each crate's live odds (2026-10-19, final review).** The quote's odds line is this exact crate's:
  each rarity's share of `tieredCrateChances` over what the crate can still give (floor, focus, what the player owns),
  so Standard + Card Plates shows no Common and Standard + Announcers reads Legendary 100%. The bay's "next crate" line
  keeps the tier's published odds (`tierOddsPercent`), since no specific crate exists there yet.
- **The shop honours the server's kill switch (2026-10-19, final review).** `eligibleForCrate` and
  `availableFocusCategories` drop anything the server has switched off (`admin_off`, read through
  `setServerCatalogState`), as the SQL pool always did, so the shop never offers a chip the server answers `bad_focus`
  to or prices a fee it calls `price_changed`. A switched-off category leaves the chip row.
- **A Gauntlet stage whose Aether is set to 0 or unreadable falls back to granting a crate**, so a stage can never be
  cleared for nothing.
- **Roll version.** `CRATE_ROLL_VERSION` stays 4 through the engine tasks and moves to 5 together with the SQL parity
  chain, so every intermediate commit stayed green.
- **Wallet reads.** The own-profile fetch reads `aether_wallets`, and a profile that lacks the key carries the previous
  same-account balance forward, so an old-server probe cannot flash the balance to 0.
- **Floor odds display.** Odds shown per rarity are rounded independently and can sum to 99.9; the UI never claims 100.
- **Economy reads are defensive in the quote too.** `aether_quote` reads the price and the fee rung through
  `aether_economy_int` and refuses a fractional or garbled value as `aether_config_missing` (503). A retune must keep
  the economy's exact shape (see the comment on the `aether_config` seed), or clients fall back to their default prices.
  The migration ends with `notify pgrst, 'reload schema'`.

## Runbook (owner-run, in this order)

1. Paste `supabase/migrations/2026-10-18-aether.sql` into the Supabase SQL Editor and Run (it is also appended to
   `schema.sql`). It is idempotent. `aether_enabled` stays **off**, so nothing about the live game changes yet.
2. Deploy the Edge Functions `submit-progression`, `progression-inventory` and `gauntlet-clear`. Run the SQL first: the
   functions call `buy_crate` and the focused `open_crate`.
3. Ship the client (`npm run release:web`). While `aether_enabled` is off the client shows today's UI.
4. Run `select public.aether_rollout();` to backdate the milestone crates and flip the switch.

### Retuning the economy

No client release is needed; clients pick the change up on their next economy read, and a purchase at a price the client
showed that no longer holds is refused (`price_changed`), never silently re-priced:

```sql
update aether_config set economy = jsonb_set(economy, '{cratePrice,epic}', '450') where id = 1;
```

## Accepted risk

**Gauntlet Aether is paid on the client's word** (the Gauntlet run is client-side), at most 2,000 per account. Owner accepted this ("yeah they can earn aether"). Ranked, Versus and every spend are decided in SQL.

## Known gaps

- Navigating away through the sidebar in the middle of a purchase skips the reveal (the item is still owned and shows its
  NEW badge). Follow-up: queue the reward into New rewards, or hoist the theatre.
- The Gauntlet reward slot that shows the Aether earned has no "Crate Shop" button.

## Verification

Engine, SQL and UI tests ship with each piece (`npx vitest run packages/progression packages/rules packages/ui/src/progression`);
the DB-backed suites run the migration against a stub. Performance was checked at code level only (no layout reads, the
quote memoised, shop state local to `CrateShop`, no looping paint animation in the new CSS). **Owner: please profile
rapid focus-chip toggling in Collection on the prod build (`npm run build:web`, then preview) and confirm no long task
over 50 ms, per `docs/performance.md`.**
