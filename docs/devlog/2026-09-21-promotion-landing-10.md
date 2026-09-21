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

---

# Same day, part 2 — No instant demotions: hitting 0 arms a demotion game in EVERY division

Owner ruling (2026-09-21, later the same day): *"Hitting 0 MMR should halt the loss and put you in a demotion
game. You need to then bottom-4 that game to demote."* This WIDENS the 2026-09-20 rule, which gated only the
drop OUT of a medal (a loss at a medal's lowest division clamped at 0 and armed; everywhere else a loss below 0
demoted instantly to `100 + result`), to every division. The paragraph above that says "inside a medal it
demotes one division to `100 + result`" is superseded by this section.

## The rule

- Any negative award that would take a position below 0 in ANY division above Bronze III **clamps at 0 and
  arms** the stored `demotionReady` flag. A loss landing on exactly 0 by subtraction arms too (unchanged from
  the medal-floor rule). Bronze III (division index 0) floors at 0 with no gate, as before.
- A demotion game (`demotionReady` true): a top-4 finish **escapes** (its positive award applies from 0, flag
  cleared; reaching 100 that way unlocks the promotion gate as usual); a bottom-4 finish **demotes one
  division** to `100 + that game's award` (5th → 94, 6th → 84, 7th → 72, 8th → 60) in the previous division,
  flag cleared. Across a medal boundary the previous division is the previous medal's I (unchanged).
- Promotion gates, the 10/100 landing, the medal-gate hold at 100 and Ascendant I's uncapped top are
  untouched. A promotion landing is never armed; any non-negative result clears the flag.
- **Ascendant I** is a division above Bronze III, so a loss that hits 0 there now arms a demotion game too
  (before: an instant drop to Ascendant II at `100 + result`). Its demotion game drops to Ascendant II at
  `100 + award`. The task statement said "every division"; this is the literal reading and it is flagged in
  the implementation report in case the owner wants the top division exempt.

## The three copies

| Copy | What changed |
| --- | --- |
| `packages/sim/src/rank.ts` | `hasDemotionGate(d)` is now `d > 0 && d <= top` (name kept, doc rewritten: every division above Bronze III). `applyAward` lost its "inside a medal → demote to `100 + result`" branch and its top-division demote: the order is now *loss lands on ≤ 0 above Bronze III → clamp 0 + arm*; *below 0 → Bronze III floor*; *top division → uncapped*; *≥ 100 → gate*. The demotion-game branch is unchanged (`divisionIndex − 1` at `cap + award`). `isRankPosition`'s corruption guard accepts the flag at 0 in any division > 0. Header + "Order" doc rewritten. |
| `supabase/functions/_shared/lobbyRating.ts` | The same, line for line (`hasDemotionGate = d > 0 && d <= RANK_TOP_DIVISION`; the same `applyAward` order). |
| `settle_rank` (`supabase/migrations/2026-09-20-medal-rank.sql` = the trailing block of `schema.sql`, byte-identical) | The `(d0 % c_per_medal) = 0` medal-floor tests became `d0 > 0` in both the promotion-game negative-award branch and the normal branch; the normal branch is reordered to the TS order (arm → Bronze floor → top uncapped → gate → plain); the top division's `v_demoted … c_top - 1` branch is gone; `v_demoted` is set only in the demotion-game branch. The comment block above the function is rewritten. |

No `rulesVersion` bump (still 1 in all three): the client never resolves locally, so an old client only
mis-predicts until the server answers. The parity test now walks an ARMED start in every division above
Bronze III (17 armed starts instead of 5; ~2,300 transitions) and pins the SQL text: the constraint reads
`(rank_points = 0 and rank_division > 0)`, `(d0 % c_per_medal) = 0` no longer occurs in the function body, and
exactly one `d1 := d0 - 1` (the demotion game) is left.

## The check constraint

`profiles_rank_demotion_ready_where` dropped its `rank_division % 3 = 0` term:

```sql
alter table public.profiles drop constraint if exists profiles_rank_demotion_ready_where;
alter table public.profiles add  constraint profiles_rank_demotion_ready_where
  check (not rank_demotion_ready or (rank_points = 0 and rank_division > 0));
```

This matters operationally: the widened `settle_rank` writes `rank_demotion_ready = true` at, say, Gold II 0,
which the OLD constraint rejects, so the settlement transaction would raise and roll back (the client retries
it as `settle_failed`; nothing is lost, nothing settles). **The owner must re-run the WHOLE migration block**:
the two constraint statements AND the `create or replace function public.settle_rank …` block (re-running the
entire idempotent migration file does both; the season reset at its bottom stays commented out), THEN
`supabase functions deploy submit-rating`. Runbook section 6c carries the steps and the smoke test (8th from
Gold II 10 → Gold II 0 armed, `applied_delta −10`, `capped_points 30`; then 5th → Gold III 94, flag cleared).

## Presentation

- `demotionGateText` names the DIVISION at stake everywhere ("Demotion game. Finish top 4 to stay in Gold
  II.") — the medal name alone was only right at a medal floor. `cappedDetail`'s arming line is "base −40 RP ·
  stopped at 0" (was "clamped at the Gold floor"). `announcement` no longer doubles the period after an outcome
  line that ends in one.
- Fixtures: `demotion` is now the division-level arming (Gold II 10 → Gold II 0, outcome line, −10 RP,
  `demotionUnlocked`); new `demo-lost-division` (Gold II armed → Gold III 60, a lost demotion game inside a
  medal, the `down-rank` transition); `demo-gate` / `demo-lost` / `demo-escape` (the medal boundary) kept.
  The instant-demotion plan in `rankSequence.ts` (drain → transition down → retreat from 100) is kept only for
  results settled under the 2026-09-20 rules, pinned by a legacy-shape test; a clamping loss plans one bar
  drain to 0 + the demotion-game outcome line. `isMedalFloor` (unused, and now misleading) was removed from
  `rank/types.ts`.
- Docs: `docs/GAME-RULES.md` (Ranked ladder), `docs/rank-season-runbook.md` (the constraint expectation in
  section 4 + the new 6c), `packages/ui/src/rank/README.md`, the header comments of all three rules copies,
  and a player-facing patch note ("No instant demotions").
