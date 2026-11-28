# 2026-11-28 — The pack economy: packs replace the Chest Shop (built, awaiting rollout)

The server economy behind the pack opening experience, from the approved spec
`docs/superpowers/specs/2026-11-27-pack-economy-design.md` (owner "Approved", 2026-11-27). Four stacked PRs:

- **PR #2902, the rules in TypeScript** (`packages/progression`): `packEconomy.ts` (every price, payout and odds number,
  mirrored by the server's `pack_config`), the 5-card roll (`packRoll.ts`), the shop window and Featured deals
  (`packShop.ts`: 6-hour Eastern windows, the free Rare, four 20-60% deals with per-player stock), style-pack membership
  on cosmetics, and the counter limit (5 types, 8 of each).
- **PR #2903, the server** (`supabase/migrations/2026-12-01-packs.sql`): pack tables, the versioned server roll proven
  equal to the TS roll draw for draw, `buy_pack` / `open_pack` / `claim_pack_reward` under the per-user progression lock
  (idempotent per request), Welcome and Level pack grants, the chest freeze, the 3,000 Aether launch gift and
  `pack_rollout()`.
- **PR #2904, the Edge Function**: `progression-inventory` gains the pack shop, buy, open and claim actions.
- **PR D (`feat/pack-economy-client`)**: the Pack Shop and opener on the real server, "chest" becomes "pack" in the
  game's words, odds on Rarity pack tags, the Rules wiki's pack answers, the oracle rules (R-PROG-PACK-01 to 12, plus
  amendments to the crate and Aether rules) and `docs/GAME-RULES.md`.

## The owner's rulings (2026-11-27)

Packs REPLACE the Chest Shop; every pack holds 5 cards. Rarity packs Common 100 / Rare 175 / Epic 300 / Legendary 500 /
Ancient 850; every Category and style pack a flat 200. Cards 1-4 roll at the Standard odds; card 5 is the guarantee (a
Rarity pack: its rarity or higher; a themed pack: from its theme, never owned while the theme has something new). A
duplicate pays 20% of its own rarity's pack price. The shop refreshes at 12am / 6am / 12pm / 6pm Eastern, with a free
Rare pack and four discounted deals. Every 15 packs bought earns a free Epic pack. New accounts get 5 Common, 2 Rare,
1 Epic and 1 Legendary pack; a free Legendary pack every 5 levels, only for levels reached after launch. Launch-day
accounts get 3,000 Aether once. Focus is removed. Chests already held are frozen, not converted (the lump sum is a later
project). Match payouts are unchanged.

## Final review fixes (2026-11-28)

A Rarity pack is now offered only while something at or above its rarity can roll (shelf, `buy_pack`'s expired guard and
`shelfOffers`; R-PROG-PACK-01 amended). Before, with every Ancient item admin_off the Ancient pack still sold for 850
and then failed to open. Also: the wiki and title tooltip no longer say every card is new or that packs open in the
Collection, `pack_config_missing` is a 503, the New rewards pop-up lists only packs still sealed, and the title's
Collection plaque shows with packs on.

## Rollout (spec section 12), in this order

1. Run the migration in the SQL Editor (dormant: `packs_enabled` is off and every new function refuses while it is).
2. Deploy `progression-inventory` and `submit-progression` (additive).
3. **Ship Ascent** with the new client. With the switch off it still shows the Chest Shop.
4. **Right after Ship Ascent**, the owner runs `select public.pack_rollout();`. It writes each existing account's launch
   level, pays the 3,000 Aether launch gift, then flips the switch. From that moment packs are live.
5. The patch notes entry ships with the client in step 3, worded for the day the switch flips.

Follow-ups are on the roadmap (an `aether_rollout` re-run can still create frozen chests; a real two-connection race
test on the last counter slot before `pack_rollout`).
