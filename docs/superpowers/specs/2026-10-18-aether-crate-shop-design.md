# Aether + the Crate Shop: design

Owner: Mike, brainstormed 2026-10-18. Status: draft, awaiting owner approval.

## Why

Today every reward is the same crate: one per Account Level, plus one per first Gauntlet stage clear. Each crate
rolls one cosmetic from all 8 categories at fixed odds. A player who only wants, say, Epic-or-better card plates
can do nothing about it but wait. Mike wants that player to be able to **choose**, and to pay more for a better
chance at exactly what they want.

So crates stop being the reward. **Aether**, an earned currency, becomes the reward, and players spend it in a
**Crate Shop**. There they pick a crate by **rarity floor**, then optionally pay a **focus fee** to narrow it to one
or more categories.

The moment this is built for (Mike's own words, paraphrased): a player finishes a lobby and sees "+85 Aether". In
Collection they have 2,000. They want a new card plate but only like the Epic and Legendary ones, so they buy an
**Epic crate**, gambling that it might not be a plate. It isn't. Next time they buy an **Epic crate focused on Card
Plates**, which costs quite a bit more but guarantees both.

## Goals

- Aether earned from play replaces level-up crates and Gauntlet first-clear crates.
- A Crate Shop where a player buys a crate by rarity floor, optionally focused on chosen categories.
- Level milestones (10, 20, 30, … every 10th level) grant a free **Legendary crate**.
- Every economy number is tunable without a client release.

## Non-goals (this version)

- Buying Aether with real money. Aether is earned by playing, only.
- Pity timers, duplicate refunds or shards. Duplicates still cannot drop, so there is nothing to refund.
- Rotating or featured shop stock, daily quests, trading or gifting.
- Any change to XP, the level curve, achievements or the rarity of existing items.

## Anti-goals (failures even if it "works")

- **Taking anything away.** Sealed crates a player already has stay openable with the odds they were earned under.
  Owned cosmetics are untouched.
- **Veterans getting nothing.** A player already past Level 10/20/… must not lose the milestone crates for levels
  they have already climbed (see Rollout).
- **Selling a dud.** The shop must never let a player pay for a crate that can't give them anything new.
- **Trusting the client with money.** The client never decides a balance, a price or a roll.
- **A shop that hitches.** Performance is this project's north star. The shop and the purchase → open flow must
  feel instant (see CLAUDE.md "Performance is the north star").

## The rules (decided by the owner)

### Earning Aether

Aether is credited in the **same server settlement that awards XP today** (`settle_progression`). It follows XP's
existing trust rules: the server decides from the facts it trusts, one settlement per run id, and a non-terminal
game earns nothing.

**Ranked:** a flat base for any accepted, placed game, win or lose, plus a placement bonus.

| | Base | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th |
|---|---|---|---|---|---|---|---|---|---|
| Aether | 50 | +140 | +80 | +45 | +35 | +25 | +15 | +10 | +0 |

The average Ranked game pays about 94 Aether, and 1st place pays 190. A Ranked game with no valid placement earns
0, matching XP.

**Practice:** 0 Aether. It can be replayed endlessly against bots, so paying it would be an easy farm.

**Versus:** about half a Ranked game. *Builder's call (Claude's proposal): 25 for a completed match, +45 for the
winner. An abandoned match with no winner pays the 25.*

**Tutorial:** *Builder's call (Claude's proposal): 0, since tutorial XP already rewards it.*

**Gauntlet:** the first clear of each stage pays a one-time **200 Aether** instead of a crate. It is keyed on the
same once-per-stage source the crate uses today. Stages already cleared before rollout keep the crate they gave
and pay no Aether.

**Accepted risk (owner, 2026-10-18):** `record_gauntlet_clear` trusts the client's clear (owner decision
2026-09-29). A cheater could fake all 10 clears for 2,000 Aether, once per account. The owner accepted this: credit
the Aether inside the existing call, and do **not** build server-verified clears for this work. This is the one
deliberate exception to "never trust the client with money" below.

**Comeback bonus:** no Aether, XP only. *(Claude's call.)*

### Level milestones

- Level-ups no longer grant a crate.
- Reaching **Level 10, 20, 30, …** (every multiple of 10) grants one sealed **Legendary crate**: Legendary floor,
  unfocused.
- When opening one, the player may pay Aether to focus it, at the same focus fee a bought Legendary crate would
  charge. The crate itself is free.
- The Level 1 Welcome Crate: *builder's call (Claude's proposal): keep it as a one-time Standard crate, so a new
  player still opens one thing on day one.*

### Crate prices (rarity floor)

| Crate | Standard | Rare | Epic | Legendary | Ancient |
|---|---|---|---|---|---|
| Floor | any rarity | Rare+ | Epic+ | Legendary+ | Ancient only |
| Price (Aether) | 100 | 200 | 400 | 600 | 900 |
| ≈ Ranked games | 1.1 | 2.1 | 4.3 | 6.4 | 9.6 |

The owner chose these ratios (1×, 2×, 4×, 6×, 9×) and the 100 anchor. That is a faster pace than today's
crate-per-level, which the owner accepted.

### Odds inside a crate

Use the current odds (Common 35 / Rare 31 / Epic 22 / Legendary 9 / Ancient 3), **renormalized over the rarities
at or above the floor**:

| Crate | Common | Rare | Epic | Legendary | Ancient |
|---|---|---|---|---|---|
| Standard | 35% | 31% | 22% | 9% | 3% |
| Rare | | 47.7% | 33.8% | 13.8% | 4.6% |
| Epic | | | 64.7% | 26.5% | 8.8% |
| Legendary | | | | 75% | 25% |
| Ancient | | | | | 100% |

The roll then works as it does today:
1. Pick a rarity.
2. Pick uniformly among the player's **unowned**, active, crate-sourced items of that rarity, inside the focused
   categories (or all enabled categories when unfocused).
3. If the rolled rarity has nothing left, fall to the nearest non-empty rarity, ties toward the more common one,
   as today. **The fall never goes below the floor.**

### Focus fee

Focusing is optional. The player ticks one or more of the 8 categories. **Ticking more categories makes the fee
smaller**, because a wider focus is less likely to land on exactly what they want. Ticking all 8 is the same as no
focus. The fee is a percentage of that crate's price:

| Categories ticked | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 / none |
|---|---|---|---|---|---|---|---|---|
| Fee | +100% | +60% | +40% | +25% | +15% | +10% | +5% | 0 |

*(The percentages are Claude's proposal. The owner chose the shape: a narrower focus costs more.)* Every
combination comes out to a whole number at these prices.

**"Ticked" counts only categories that are still available** for this player at this floor *(Claude's call, from
the builder check)*. Sold-out chips don't count, and **ticking every available category is no focus and costs
nothing**. This matters in practice:
- At the Ancient floor only 5 categories have any items at all.
- A player who has emptied a few categories shouldn't pay for a "focus" that narrows nothing.

The same rule covers `board`/`music` if they're ever switched on. The table indexes on "how many ticked of how
many available", and a full set is always free. One consequence: a crate's price can change when the player's
collection does. That's fine, because the purchase-time price check (below) already refuses a stale price.

Examples:
- An Epic crate focused on Card Plates costs 400 + 400 = **800**.
- A milestone Legendary crate focused on one category costs **600**.

### Sold out

- A category chip is **disabled** when the player owns every crate-sourced item in that category at or above the
  selected floor.
- A crate (floor + focus) that would have nothing to give **cannot be bought**.
- Expected cases in the current catalog: there are no Common card plates, and only 3 Announcers, all Legendary.
  So an Announcer focus sells out after three pulls, and a Standard crate focused on Card Plates effectively rolls
  Rare+.

## Experience

**After a game:** wherever the post-game screen shows XP earned today, it also shows Aether earned, broken down as
base + placement bonus.

**Collection:** the existing crate bay becomes the Crate Shop.
- An Aether balance is always visible.
- Step 1: pick a crate (rarity floor).
- Step 2: optional category chips to focus it.
- The live total price and the live odds for that exact crate are shown, plus how many items are still left to
  find in it.
- Sealed crates the player still holds (old level crates, milestone Legendary crates) are listed alongside, each
  openable. Milestone crates offer the focus step at open.

Mockups from the brainstorm (throwaway, in the git-ignored `.superpowers/brainstorm/` folder) show the two-step
picker. The owner chose that over a grid of every crate.

**Buying:** *builder's call (Claude's proposal): buying opens the crate right away in the existing opening theatre
(`CrateOpener`), with no extra "it's in your bay" step.*

**Guests:** a guest (anonymous account) earns Aether and sees their balance, just as they earn XP and crates
today (R-PROG-CRATE-04). But they **cannot spend it**: Buy and a milestone crate's Open both show the existing
`CrateSignInGate`. Creating an account upgrades the guest in place, so the balance carries over. *(Corrected while
planning: an earlier draft said guests earn nothing, which contradicts R-PROG-CRATE-04. Gauntlet clears already
require a full account.)*

## Constraints from the codebase

- Rolls, balances and prices are **server-side only**. Today `open_crate` (SQL, service-role, behind the
  `progression-inventory` Edge Function) is the only place a roll happens. The TS copy in
  `packages/progression/src/cosmetics.ts` mirrors it, and `sqlParity.test.ts` fails CI if the two drift. Keep that
  pattern for the new odds, fees and fall-back rules.
- `packages/progression` is dependency-free, and its Deno copy under `supabase/functions/_shared/progression*` is
  **generated** (`npm run progression:shared`). Never hand-edit the copy.
- `loot_crates` is unique on `(user, earned_level)`, and old level crates already used earned_levels 10, 20, …. So
  milestone crates need their own key (e.g. a `source` like `milestone:10`) so they don't collide with old crates.
- `progression_config` holds the existing switches (`epoch`, `crates_enabled`). The economy numbers should be
  server-owned config the owner can retune without a client release. Whether that is a config table or the
  existing constants-in-TS-plus-SQL-parity pattern is the builder's call, as long as retuning doesn't need a
  client release.
- The opening theatre, crate FX and collection screen live in `packages/ui/src/progression/` (`CrateOpener.tsx`,
  `crateFx/`, `CollectionScreen.tsx`, `collectionModel.ts`, `progressionStore.ts`, `progressionRemote.ts`).
- Repo process: branch + PR per piece, green `verify` before merging. Update `docs/GAME-RULES.md` (rewards are
  player-facing rules), add a devlog entry, and add a `patchNotes.ts` entry when it ships.

## Rollout

- Ship behind a server switch (alongside `crates_enabled`). Until it flips, the old crate-per-level behaviour is
  unchanged.
- **At the flip:**
  - Every account gets its milestone Legendary crates backdated: one per multiple of 10 at or below their current
    level. A Level 34 player gets three.
  - Accounts start at 0 Aether. *(Claude's call.)*
  - Sealed old crates stay sealed and open with the odds they were earned under (today's roll version).
- After the flip, level-ups grant only milestone crates and Gauntlet first clears grant only Aether.

## Purchase safety (requirements; the mechanism is the builder's)

- A purchase is one atomic server action: check the balance, deduct the price, create the crate with its floor and
  focus, and roll it. It either all happens or none of it does.
- A replayed or double-clicked purchase must never charge twice.
- The server computes the price itself. If the price the client showed no longer matches (the config changed, or
  the crate sold out), the purchase is refused, not silently re-priced.
- Every Aether change (earn or spend) is recorded with its reason and source, so a balance can always be explained.

## Left to the builder

- Schema and table names (wallet balance, ledger, crate floor/focus columns), the roll version, and the Edge
  Function or RPC shape.
- How the economy config is stored and read, subject to "retunable without a client release".
- UI layout and styling within the two-step picker, following the existing Gem-plate button style and game cursor
  rules in CLAUDE.md.
- How to split the work into PRs (e.g. earning first, then the shop, then milestones and rollout).
- The proposals marked *builder's call* or *Claude's call* above, unless the owner overrides them on review.
