# 2026-09-21 — A won promotion lands at 10 / 100, not 0 / 100

Owner ruling (2026-09-21): *"small ranked update: when a player promotes to the next medal/division, set their
rating at 10/100 instead of 0/100 so they can't lose 1 game and demote."*

## The rule

A WON promotion game (top-4 at a division gate, 1st at a medal gate) now lands the player at **10 points** in
the next division. It is a named constant, `promotionLanding`, in all three copies of the rules:

| Copy | Constant |
| --- | --- |
| `packages/sim/src/rank.ts` (the client) | `RANK_RULES.promotionLanding: 10` |
| `supabase/functions/_shared/lobbyRating.ts` (the Edge Function's runtime parity check) | `RANK_PROMOTION_LANDING = 10` |
| `settle_rank` in `supabase/migrations/2026-09-20-medal-rank.sql` and the identical block at the end of `schema.sql` (the WRITER) | `c_promo_landing constant int := 10`, used where the won gate sets `p1` |

`rating` (the derived scalar `100 × division + points`) follows automatically. What the numbers now say:

- A won promotion's `appliedDelta` is `(100 × (d+1) + 10) − (100 × d + 100)` = **+10** (was 0), for BOTH gate
  kinds and every winning finish. `cappedPoints` stays **0** on a promotion in both TS copies and the SQL
  (`if v_promoted then v_capped := 0`): the award is reported as converted into the promotion, never as
  capped. The rank screen still prints the finish's base award (+16 / +40) as the delta line, not the +10,
  which is the owner's 2026-09-20 ruling ("a big 0 RP over a promotion reads as a bug") carried forward.
- The demotion-gate rule is untouched. From the 10-point landing a 5th (−6) leaves the player at 4, still in
  the division. A 6th or worse crosses 0: inside a medal it demotes one division to `100 + result` (Gold I 10,
  6th → Gold II 94); at a medal's lowest division it clamps at 0 and ARMS the demotion game (Gold III 10, 8th
  → Gold III 0 armed, the second loss demotes). A promotion landing is still never armed.
- `highest` tracks the landing: a first promotion to Silver III now records Silver III 10 as the career best.

The cushion absorbs exactly one loss size with the current award table: a 5th (−6). A 6th (−16), 7th (−28) or
8th (−40) from the landing still crosses 0 in one game (inside a medal that is a one-game demotion; at a medal
floor it is the arming loss). If the owner wants *every* single loss absorbed, the landing has to be at least 40
or the within-medal demotion needs its own gate — flagged in the implementation report, not built.

## Why NO rules-version bump (still 1 in all three)

The client never resolves a rank locally: `resolveRank` / `settleRank` are called only by tests, fixtures and
the DEV preview, and the store adopts the server's `RankResult` + profile verbatim (`parseRankResult` /
`parseRankedProfile` validate SHAPE, never re-derive). So an old client against the new server only
mis-predicts the landing until the server's answer arrives, then shows 10 / 100 correctly. A bump would have
forced every existing client to refuse to settle (`unsupported_rules`) for no protection gained. The header
comments in all three copies now say when a bump IS needed (a change an old client would mis-show or refuse).

The Edge Function's runtime parity check (`_shared/lobbyRating.ts` against the SQL's committed row) is the
reason the function must be redeployed with the SQL: until both carry 10 the function logs `rank parity
mismatch` on every promotion (the SQL's write is still what stands).

## What the owner runs (production; nothing here executes against Supabase)

1. SQL Editor: paste and run the whole `create or replace function public.settle_rank(…) … $$;` block from
   `supabase/migrations/2026-09-20-medal-rank.sql` (re-running the whole idempotent file is equally fine; the
   season reset at its bottom stays commented out).
2. `supabase functions deploy submit-rating`.
3. Smoke: win a promotion game on a throwaway account → `rank_results.points_after = 10`, `applied_delta = 10`,
   `capped_points = 0`, profile `rank_points = 10`; a 5th from there → `rank_points = 4`, not demoted.

Runbook section 6b carries the same steps.

## Verification

- `packages/sim/src/rank.test.ts`: the fixture table's every promoted row lands at 10 with applied +10 and
  capped 0; new rows for a 5th / 6th from a division landing and from a medal-floor landing; the owner's
  sequence (medal promotion → loss arms → loss demotes) walks from 10; the every-division gate loop and the
  settleRank climb (career best = Silver III 10) updated.
- `packages/ui/src/lobbyRatingParity.test.ts`: reads `c_promo_landing` from the migration text and pins the
  `p1 := c_promo_landing;` use; the 1,700-transition walk agrees TS ↔ TS; the schema.sql block is still
  byte-identical to the migration's.
- `packages/sim/src/docbot/lobbyProperties.test.ts`: the gate property expects the landing constant and now
  includes 10 in its start points.
- `packages/ui/src/rank/fixtures.ts` (`promo-won`, `promo-medal` land at 10, applied 10, capped 0),
  `rankFormat.test.ts` (announcement "Now Platinum III, 10 / 100"; the plan's new bar ticks 0 → 10 for both
  gate kinds — a small tick, kept on purpose), `RankScreen.test.tsx` (live-region sentence).
- Docs: `docs/GAME-RULES.md` (Ranked ladder), `docs/rank-season-runbook.md` (6b), `packages/ui/src/rank/README.md`,
  the header comments of all three rules copies, and a player-facing patch note.
