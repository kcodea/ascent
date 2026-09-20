import { useEffect, useState } from 'react';
import { getHero, isCalibrationRound } from '@game/sim';
import { RunTrophies } from './RunTrophies';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchBoardStats, fetchVictories, remoteEnabled, type BoardWinStats, type VictoryRow } from './remoteBoards';
import { LbHeroFrame, LbLabel, LbMedallion, LbTeam } from './LadderBits';
import { playedOnText, recordOfHistory, recordText } from './leaderboardData';

/**
 * Leaderboard — the "Hall of Champions" PAGE (not a modal): the latest 20 VICTORY runs from the shared
 * backend (`fetchVictories`), scrollable, with a Back button top-left. Polished 2026-09-20 to the Career
 * page's banner language: each champion is one chunky row — the rank medallion (podium gold / silver /
 * bronze), the circular hero frame with the hero + author, the run's W–L record and round pips, the final
 * winning warband as 7 real card tiles, and the outcome block (VICTORY · date · round) with the board's
 * round-17 fight record and the quests / runes it ended with. Read-only + best-effort.
 */
const HALL_ROWS = 20;

/** The round-17 fight record for a Hall slot — how often this board has beaten others as their final
 *  opponent (owner request 2026-07-13). Compact: fights · wins · win rate. */
function WinRecord({ stats }: { stats?: BoardWinStats }) {
  if (!stats || stats.fights === 0) {
    return <div className="lb-fights none">No round-17 fights logged yet</div>;
  }
  return (
    <div className="lb-fights" aria-label="This board's record when served as a round-17 opponent">
      <span className="lb-fight"><b>{stats.fights}</b> fights</span>
      <span className="lb-fight w"><b>{stats.wins}</b> W</span>
      <span className="lb-fight l"><b>{stats.losses}</b> L</span>
      {stats.ties > 0 && <span className="lb-fight t"><b>{stats.ties}</b> T</span>}
      <span className="lb-fight wr"><Icon name="crown" />{stats.winRate}%</span>
    </div>
  );
}

export function Leaderboard() {
  const show = useGame((s) => s.showLeaderboard);
  const close = useGame((s) => s.closeLeaderboard);
  const [rows, setRows] = useState<VictoryRow[] | null>(null);
  // Round-17 fight record per leaderboard slot (keyed by the board's ledger id).
  const [stats, setStats] = useState<Map<string, BoardWinStats>>(new Map());
  const [sort, setSort] = useState<'recent' | 'wins'>('recent');

  useEffect(() => {
    if (!show) return;
    setRows(null); // reset to the loading state each time it opens
    setStats(new Map());
    let alive = true;
    // WINNING LOBBY BOARDS only (owner rework 2026-07-31): rows logged before the rework carry no mode and
    // are filtered out — the Hall restarts with the ladder.
    void fetchVictories(60).then(async (rAll) => {
      const r = rAll.filter((v) => v.mode === 'lobby').slice(0, HALL_ROWS);
      if (!alive) return;
      setRows(r);
      // Then pull each slot's round-17 win record from the fight ledger (best-effort; leaves the record empty on failure).
      const ids = r.map((v) => v.boardId).filter((id): id is string => !!id);
      if (ids.length > 0) {
        const s = await fetchBoardStats(ids, 17);
        if (alive) setStats(s);
      }
    });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  // 'recent' keeps the fetch order (created_at desc). 'wins' ranks by the round-17 win count (0 for untracked).
  const winsOf = (r: VictoryRow): number => (r.boardId ? stats.get(r.boardId)?.wins ?? 0 : 0);
  const ordered = rows === null ? null
    : sort === 'wins' ? [...rows].sort((a, b) => winsOf(b) - winsOf(a)) : rows;

  return (
    <div className="lbpage lb-ladder lb-hall">
      <div className="lbtopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Hall of Champions</div>
            <div className="lbsub">The latest {HALL_ROWS} victory runs and their warbands</div>
          </div>
        </div>
        {/* Sort toggle — Most recent (default) vs Most round-17 wins. */}
        <div className="lb-seg" role="group" aria-label="Sort leaderboard">
          <button type="button" className={`lb-seg-btn${sort === 'recent' ? ' on' : ''}`} aria-pressed={sort === 'recent'} onClick={() => { if (sort !== 'recent') { sfx.pulse(); setSort('recent'); } }}>Most recent</button>
          <button type="button" className={`lb-seg-btn${sort === 'wins' ? ' on' : ''}`} aria-pressed={sort === 'wins'} onClick={() => { if (sort !== 'wins') { sfx.pulse(); setSort('wins'); } }}>Most wins</button>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Hall of Champions unavailable — no backend configured.</div></div>
        ) : ordered === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Opening the Hall…</div></div>
        ) : ordered.length === 0 ? (
          <div className="lbempty lb-state"><Icon name="crown" /><div>No champions yet — be the first to summit.</div></div>
        ) : (
          <div className="lb-rows">
            {ordered.map((r, i) => {
              const hero = getHero(r.heroId);
              const rec = recordOfHistory(r.history);
              const when = playedOnText(r.createdAt) || r.date;
              const board = r.board && r.board.minions.length > 0 ? r.board : null;
              return (
                <div className="lb-row" key={r.boardId ?? i}>
                  <div className="lb-row-rank"><LbMedallion rank={i + 1} /></div>
                  <div className="lb-row-hero">
                    <LbHeroFrame heroId={r.heroId} />
                    <div className="lb-row-name">{r.author || hero.name}</div>
                    <div className="lb-row-herosub">{hero.name}</div>
                    {rec && <div className={`lb-row-record ${rec.wins >= rec.losses ? 'won' : 'lost'}`}>{recordText(rec)}</div>}
                  </div>
                  <div className="lb-row-team">
                    <LbLabel>Winning warband</LbLabel>
                    <LbTeam board={board} empty="No warband stored for this run" />
                    <div className="lb-row-extras">
                      {r.history && (
                        <div className="lbpips lb-pips" aria-label="Round results">
                          {[...r.history].map((c, k) => {
                            const res = c === 'W' ? 'win' : c === 'L' ? 'lose' : 'draw';
                            const cal = isCalibrationRound(k + 1);
                            return (
                              <span key={k} className={`lbpip ${res}${cal ? ' cal' : ''}`} aria-label={`Round ${k + 1}: ${res}${cal ? ' (calibration — not scored)' : ''}`}>{c}</span>
                            );
                          })}
                        </div>
                      )}
                      <RunTrophies quests={r.board?.quests} runes={r.board?.runes} />
                    </div>
                  </div>
                  <div className="lb-row-outcome">
                    <LbLabel>Match outcome</LbLabel>
                    <div className="lb-verdict won">VICTORY</div>
                    <div className="lb-when">{when}{r.wave ? ` · Round ${r.wave}` : ''}</div>
                    {/* Round-17 win record — how often this board has beaten others as their final opponent. */}
                    <WinRecord stats={r.boardId ? stats.get(r.boardId) : undefined} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
