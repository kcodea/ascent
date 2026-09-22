# Division numerals now ascend: Bronze I → II → III → Silver I

**Date:** 2026-09-22 · **Branch:** `feat/rank-numerals-ascending` · **Owner ask:** "change the ranks to 1->2->3 instead of 3->2->1"

## What changed

The order of the numeral within a medal. A player now climbs **Bronze I → Bronze II → Bronze III → Silver I**,
where before they climbed Bronze III → II → I → Silver III. The medals themselves and everything about how the
ladder settles are untouched.

## Why it is only two lines of code

The division **index** (0 … 17) is the ladder. Every rule, every comparison, every promotion and demotion, the
Edge Function and the `settle_rank` plpgsql writer all move that index. The numeral was always a label derived
from it, in exactly one place:

- `packages/sim/src/rank.ts` `divisionTierOf` — now `(index % divisionsPerMedal) + 1`, was
  `divisionsPerMedal - (index % divisionsPerMedal)`.
- `packages/ui/src/rank/types.ts` `DIVISION_NUMERALS` — reversed to `['I', 'II', 'III']`, indexed by
  `divisionTierOf - 1`.

`rankLabel`, the crest plate, the rank screen, the Career card, the Rankings rows and the end-of-game timeline
all read through those two, so they moved together.

## What was NOT touched, deliberately

- **No stored data.** A profile keeps the `division_index` it had. Nobody was promoted, demoted or migrated.
  A player sitting at index 2 was "Bronze I" yesterday and is "Bronze III" today, in the same place on the
  ladder, with the same points.
- **No server deploy.** `settle_rank` and `supabase/functions/_shared/lobbyRating.ts` render no labels; only
  their comments named divisions, and those were corrected for readers. The SQL body is unchanged, so there is
  nothing to run in the Supabase editor.

## The sweep

478 medal-plus-numeral labels across the rank code, tests, fixtures, docs, `schema.sql` and the migration were
flipped in one pass (`Bronze III` ↔ `Bronze I`, II unchanged). Two things that pass had to be handled by hand:

- `rank.test.ts` builds its fixtures from labels through a `D(label)` parser whose numeral table is the
  inverse map. Flipping the labels without flipping the parser silently re-pointed every fixture at a
  different division, which is what the first test run caught (40+ failures, all "expected index 6, got 8").
  The parser table is flipped with them, so every fixture keeps its original index and the settlement rules
  are asserted on exactly the same ladder positions as before.
- Bare numeral assertions with no medal beside them (`.rankcrest-plate` text, `divisionTierOf(9)`) do not
  match the sweep's pattern and were updated individually.

Past devlogs and shipped patch-note entries were left alone: they are the record of what was true when they
were written.

## Oracle

`R-RANK-03` pins the contract, including the half that matters most: the flip is display-only and no rule may
read the numeral. Enforced by `packages/sim/src/rank.test.ts` and `packages/ui/src/rank/rankFormat.test.ts`.
