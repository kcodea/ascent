# 2026-10-20 — Milestone chests are Epic and can't be focused

Owner: *"i want the chest quality to reduce down to Epic for the milestone chests (every 10 levels) and you cannot focus
those ones specifically"*. Asked about the milestone chests players already hold (the launch backfill granted them at
Legendary): *"Keep them Legendary"*. Rule: **R-PROG-AETHER-04** (amended).

## What changed

- **Server** — `supabase/migrations/2026-10-20-milestone-chests-epic.sql` (also appended to `schema.sql`). It replaces
  three functions, each a verbatim copy of the current one with only the ruling's change (generated, so the copies cannot
  drift):
  - `settle_progression` and `aether_rollout` create `milestone:<L>` crates at floor **Epic**. Each level's milestone crate is
    still made once (the one-crate-per-source index), so a crate already held at Legendary is never touched; the
    self-heal only adds missing ones, at Epic.
  - `open_crate` refuses **any** focus at open (`focus_not_allowed`), before charging or rolling. The 4-argument signature
    stays so an older client's focused call gets that refusal rather than an unknown-function error.
  - The `loot_crates_milestone_is_legendary` check becomes `loot_crates_milestone_floor`: Epic or Legendary only.
  - Untouched on purpose: `aether_quote(..., p_milestone)` and its TS mirror `quoteCrate({ milestone })` (now called by
    nothing, kept for the draw-for-draw parity test), `buy_crate`, the tiered pick, roll version 5.
- **Client** — the Collection's milestone focus step is gone: a milestone crate opens in the bay like any other earned
  crate, and Open all (bay and New rewards pop-up) includes it. `CrateShop` lost its milestone mode (`mode`, `onBack`,
  `held`). The chest's name and its opening follow its own floor: "Level 10 Epic Chest", a kept one "Level 20 Legendary
  Chest". With nothing sealed, the bay's odds line shows the next milestone chest's (Epic) odds.
- `MILESTONE_CRATE_TIER = 'epic'` in `aether.ts` is the TS copy; `sqlParity.test.ts` pins the SQL literal to it.

## Rollout (owner)

1. Merge (ships the client: no focus step, Epic naming).
2. Paste `supabase/migrations/2026-10-20-milestone-chests-epic.sql` into the Supabase SQL Editor and Run. Until then the
   server still grants Legendary milestone crates; the new client simply opens them unfocused.
3. The `progression-inventory` Edge Function needs **no** redeploy: its shared copies changed only in comments and the
   chest name (`crateLabel`), which the function never returns.

An older client (the current web zip) still shows the focus step: its unfocused Open keeps working; a focused Open is
refused with nothing charged and the chest left sealed.

## Tests

`milestoneChestsEpic.db.test.ts` (PGlite, the full migration chain plus this file): Epic from the rollout and from a
settlement, a held Legendary crate kept, every focus at open refused uncharged, the free unfocused roll at or above the
crate's own floor, the table check, and a second run of the file. `aether.db.test.ts` still tests the 2026-10-18 file on
its own (its milestone-focus cases describe that file, not production after this one).
