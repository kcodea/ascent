# 2026-10-12: Leaderboard games played, portrait skins, rank frames

Owner asks (2026-10-12), about the Leaderboard page (`Rankings.tsx`):
1. "is this page broken and only showing 50 games max?"
2. "the portrait skins should show here."
3. "can you also use the proper ranked portrait for every rank? ... the corresponding frame should be the frame outline"

## 1. Games played stopped at 50 (a bug)

**Root cause.** `profiles.games_played` is written by the client at run end (`store.ts` → `uploadPlayerProfile`). The
number was `careerStats(await fetchRunHistory()).runs`, and `fetchRunHistory(limit = 50)` reads the newest 50
`run_history` rows. So every player past 50 finished games was stored as exactly 50, and `favorite_hero` was the
most-played hero of those 50 only. Evidence: a read-only anon probe on 2026-10-12 showed the top player (Orangez) at
`games_played = 50` with 100 rows in `run_telemetry` (one per recorded ranked game). `run_history` itself is readable
only by signed-in accounts, so the anon probe could not count it directly.

**Fix.** `fetchCareerTotals()` (`remoteBoards.ts`) reads ONE light column (`hero_id`) of every `run_history` row of the
account, newest first, paged to the end through `fetchAllRows` (R-NET-01), and `careerTotalsOf()` (`runHistory.ts`)
folds it into `{ runs, favoriteHero }` (a favourite tie goes to the most recently played hero, as `careerStats` did). A
failed read still skips the profile write. Rule: **R-LADDER-GAMES-01** (`registry/approved/foundation.ts`).

**Stored rows.** A profile heals on that player's next finished game. To fix everyone at once, the owner runs the
data-only backfill `supabase/migrations/2026-10-12-games-played-backfill.sql` (idempotent; no schema change).

## 2. Portrait skins

The row portrait is now `heroPortrait(favoriteHero, skins)`, the same resolver the Career page header uses. The
skins come from the public `cosmetic_loadouts` table (the Career page's source, `fetchLoadoutRows`), read for all ten
shown players in ONE paged request (`fetchHeroSkinLoadouts` in `progressionRemote.ts`, `hero_skin` slot only), after
the rows are published (a cached revisit keeps the skins it had, so a refresh never flashes default art). Your own row
uses your live loadout; everyone else's goes through "Show opponent skins". `LbHeroFrame` takes an optional `art`.

## 3. Rank frames (on the RANK badge, not the portrait)

Owner correction (2026-10-12): "the RANK badge portrait frame should change based on rank, not the player's
portrait. Rank 1 frame also only applies > ascendant rank."

The Ranked Rewards ring masters (`C:\Game Assets\Ascent Art\Ranked Rewards\Frames`) were already wired as 768 px WebP
by the portrait-frame tuner (#1821: `art/frames/frame_{bronze,silver,gold,platinum,diamond,ascendant,rank1}.webp`,
with measured holes in `FRAME_ART`). No new art. `RankCrest` (`rank/RankBar.tsx`, the ONE rank badge component) now
resolves its medal's ring (`crestFrameOf` → `resolveImageFrame('bronze' ... 'ascendant')`) and paints it with the
shared `PortraitFrame` renderer, which swaps out the generic gold `.portring` ring (`pf-on`). The hero portrait keeps
its normal outline.

Because `RankCrest` is shared, the tier ring shows on every surface that draws the rank badge: the Leaderboard's Rank
column, the Career page's Seasonal Ranked card (`RankBar size="big"`), the post-game rank screen (`RankScreen`, both
crests of a transition), and the title screen's mini crest.

**Rank #1 ring: not wired.** The ladder is Bronze to Ascendant, three divisions each (`RANK_MEDALS`), and Ascendant III
is the uncapped top division (`rankTopDivision()`). There is no tier above Ascendant, so `frame_rank1` stays unused
until one exists.

## Judgement calls (owner can reverse)

- The tier ring applies to every rank badge surface, because they all share `RankCrest`.
- Leaderboard skins: your own row uses your live loadout. Other rows use the stored loadout, through "Show opponent
  skins".
