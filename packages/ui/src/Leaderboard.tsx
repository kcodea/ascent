import { useEffect, useState } from 'react';
import { getHero, rankLabel, type RankPosition } from '@game/sim';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { useGame } from './store';
import { fetchHallRanks, fetchSeatRecords, fetchVictories, remoteEnabled, type SeatRecord, type VictoryRow } from './remoteBoards';
import { LbHeroFrame, LbLabel, LbMedallion, LbRunes, LbTeam } from './LadderBits';
import { hallRecordOf, hallRunKeyOf, playedOnText, recordText } from './leaderboardData';

/**
 * Leaderboard — the "Hall of Champions" PAGE (not a modal): a BOARD SHOWCASE of the warbands that have won
 * the most games, scrollable, with a Back button top-left. Each champion is one chunky row (owner layout
 * 2026-09-22): the rank medallion (podium gold / silver / bronze); the hero frame with the player and the hero
 * name, and nothing else on the left; the middle EXACTLY as a Recent Games row shows a game — the final team
 * as 7 real card tiles and the runes; and on the right, in place of a verdict (every row is a winner), the run's
 * record "X–Y", the date of its most recent win, and the rank its player held when they won it. Read-only +
 * best-effort.
 *
 * WHAT A ROW RANKS BY (owner rework 2026-09-22, replacing "the latest 20 victories"): the run's WINS AGAINST
 * OTHER PLAYERS — the lobby it won for the player who built it, PLUS every player it knocked out when served as
 * a recorded seat; every time it was knocked out while that player still stood is a loss ("track the run that
 * beat the player when they were knocked out"). See `hallRecordOf`, `seatOutcomesOf` in the sim and the seat
 * ledger (`fetchSeatRecords`). Lobby mode only: the row list is already filtered to lobby victories, and the
 * seat ledger is written only by real lobbies (never practice, the tutorial or a Scene Builder run).
 *
 * WHY THE POOL IS BIGGER THAN THE PAGE. Ranking by wins means every candidate's record has to be known
 * BEFORE the top 20 can be chosen — taking the 20 most recent and sorting those would just re-order one
 * page and call it a leaderboard. So the fetch pulls `HALL_POOL` victories, reads every one's record in one
 * chunked ledger call, ranks, and only then cuts to `HALL_ROWS`.
 */
const HALL_ROWS = 20;
/** Victory rows considered for the ranking. Bounded: this is a friend-scale backend and the whole pool's
 *  records are aggregated client-side. */
const HALL_POOL = 200;

export function Leaderboard() {
  const show = useGame((s) => s.showLeaderboard);
  const close = useGame((s) => s.closeLeaderboard);
  const [rows, setRows] = useState<VictoryRow[] | null>(null);
  // Table record per candidate run, keyed by its run key. Populated for the WHOLE pool, because the ranking
  // needs every candidate's record before the page can be cut (see the header note).
  const [stats, setStats] = useState<Map<string, SeatRecord>>(new Map());
  // The rank each champion HELD when they won, keyed by the run's seed (read off the career row `settle_rank`
  // stamped). Absent for a run that was never rated, which simply shows no rank.
  const [ranks, setRanks] = useState<Map<number, RankPosition>>(new Map());
  const [sort, setSort] = useState<'recent' | 'wins'>('wins');

  useEffect(() => {
    if (!show) return;
    setRows(null); // reset to the loading state each time it opens
    setStats(new Map());
    setRanks(new Map());
    let alive = true;
    // WINNING LOBBY BOARDS only (owner rework 2026-07-31, reaffirmed 2026-09-22 "this should only be lobby
    // mode wins"): rows logged before the rework carry no mode and are filtered out. The fight ledger is
    // already lobby-only at the source — `store.ts` never records a practice or Scene Builder combat.
    void fetchVictories(HALL_POOL).then(async (rAll) => {
      const pool = rAll.filter((v) => v.mode === 'lobby');
      if (!alive) return;
      setRows(pool);
      // Every candidate's table record, in one chunked ledger call (best-effort; an empty map leaves every
      // run on its own victory, which is 1–0).
      const keys = pool.map((v) => hallRunKeyOf(v.board, v.author)).filter((k): k is string => !!k);
      const seeds = pool.map((v) => v.board?.seed).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      const [s, rk] = await Promise.all([keys.length > 0 ? fetchSeatRecords(keys) : Promise.resolve(new Map<string, SeatRecord>()), seeds.length > 0 ? fetchHallRanks(seeds) : Promise.resolve(new Map<number, RankPosition>())]);
      if (!alive) return;
      setStats(s);
      setRanks(rk);
    });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  // 'wins' (the default) ranks by TABLE wins — the run's own victory plus every lobby its seat has won since.
  // Ties break on fewer losses, then on the fetch order, which is recency: of two runs that have won the same
  // number of tables the cleaner record leads, and of two identical records the newer one does.
  // 'recent' is the old view, kept as the fetch order (created_at desc).
  const seatOf = (r: VictoryRow): SeatRecord | undefined => { const k = hallRunKeyOf(r.board, r.author); return k ? stats.get(k) : undefined; };
  const recOf = (r: VictoryRow) => hallRecordOf(seatOf(r));
  const ordered = rows === null ? null
    : (sort === 'wins'
        ? [...rows].sort((a, b) => { const x = recOf(a), y = recOf(b); return y.wins - x.wins || x.losses - y.losses; })
        : rows
      ).slice(0, HALL_ROWS);

  return (
    <SidebarHost className="lbpage lb-ladder lb-hall">
      <MenuSidebar current="hall" onBack={back} />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Hall of Champions</div>
            <div className="lbsub">The {HALL_ROWS} warbands that have won the most games</div>
          </div>
        </div>
        {/* Sort toggle — Most wins (the default, owner 2026-09-22) vs the old Most recent view. */}
        <div className="lb-seg" role="group" aria-label="Sort leaderboard">
          <button type="button" className={`lb-seg-btn${sort === 'recent' ? ' on' : ''}`} aria-pressed={sort === 'recent'} onClick={() => { if (sort !== 'recent') { sfx.pulse(); setSort('recent'); } }}>Most recent</button>
          <button type="button" className={`lb-seg-btn${sort === 'wins' ? ' on' : ''}`} aria-pressed={sort === 'wins'} onClick={() => { if (sort !== 'wins') { sfx.pulse(); setSort('wins'); } }}>Most wins</button>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Hall of Champions unavailable. No backend configured.</div></div>
        ) : ordered === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Opening the Hall…</div></div>
        ) : ordered.length === 0 ? (
          <div className="lbempty lb-state"><Icon name="crown" /><div>No champions yet. Be the first to summit.</div></div>
        ) : (
          <div className="lb-rows">
            {ordered.map((r, i) => {
              const hero = getHero(r.heroId);
              const seat = seatOf(r);
              const rec = hallRecordOf(seat);
              // The date of its most recent win: the newest knockout it has scored, else the victory that put it here.
              const lastWin = playedOnText(seat?.lastWinAt ?? r.createdAt) || r.date;
              const rank = typeof r.board?.seed === 'number' ? ranks.get(r.board.seed) : undefined;
              const board = r.board && r.board.minions.length > 0 ? r.board : null;
              return (
                <div className="lb-row" key={r.boardId ?? i}>
                  <div className="lb-row-rank"><LbMedallion rank={i + 1} /></div>
                  <div className="lb-row-hero">
                    <LbHeroFrame heroId={r.heroId} />
                    <div className="lb-row-name">{r.author || hero.name}</div>
                    <div className="lb-row-herosub">{hero.name}</div>
                  </div>
                  {/* The middle reads exactly like a Recent Games row (owner 2026-09-22): the team and the runes. */}
                  <div className="lb-row-team">
                    <LbLabel>Final team</LbLabel>
                    <LbTeam board={board} empty="No warband stored for this run" />
                    <LbLabel>Runes</LbLabel>
                    <LbRunes runes={r.board?.runes ?? []} empty="No runes taken" />
                  </div>
                  {/* No VICTORY verdict — every row is a winner. The record stands where the verdict stood. */}
                  <div className="lb-row-outcome">
                    <LbLabel>Record</LbLabel>
                    <div className="lb-verdict won lb-hallrecord" aria-label={`Won ${rec.wins}, lost ${rec.losses}`}>{recordText(rec)}</div>
                    <div className="lb-when">Last win {lastWin}</div>
                    {rank && <div className="lb-hallrank">{rankLabel(rank)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SidebarHost>
  );
}
