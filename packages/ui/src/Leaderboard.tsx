import { useEffect, useState } from 'react';
import { getHero, rankLabel, type BoardSnapshot } from '@game/sim';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { useGame } from './store';
import { HALL_MIN_FIGHTS, HALL_ROWS, fetchHallHistory, fetchHallRecords, fetchRunFinalBoards, remoteEnabled, type HallHistoryFacts, type RunFightRecord } from './remoteBoards';
import { LbHeroFrame, LbLabel, LbMedallion, LbRunes, LbTeam } from './LadderBits';
import { hallHistoryFor, hallRowsOf, parseRunKey, playedOnText, recordText, winRateText, type HallSort } from './leaderboardData';

/**
 * Leaderboard — the "Hall of Champions" PAGE (not a modal): the warbands with the best record against everyone
 * (owner 2026-09-22: "we want the hall of champions to answer 'what board has been the best against everything
 * else' basically, and what the top 10 are in that category … we would want to know its strength start to
 * finish though, like overall win/loss across games. so a 15 round game may mean it was 12-3").
 *
 * WHAT A ROW IS. Every real lobby writes ONE ROW PER FIGHT its table resolved to the fight ledger (both sides
 * named by run key; the rounds after the reporter's elimination played out deterministically), and the server
 * aggregates that per run into the `run_fight_records` view. The Hall is the top `HALL_ROWS` runs by the Wilson
 * lower bound of their win rate (so a 30–2 run outranks a 3–0 run) with at least `HALL_MIN_FIGHTS` fights
 * (owner: "let's start at 10") — from EVERY recorded run, not only lobby winners. The page reads the view; it
 * never pulls a row pool.
 *
 * THE LAYOUT keeps #1630's: the medallion; the hero frame with the player and the hero name; the middle exactly
 * as a Recent Games row (final team + runes); the right the record block — now the W–L–D across everything, the
 * win rate, the lobbies, the run's OWN game ("12–3", from its career row), the date of its last fight, and the
 * rank its player held when they played it. The final warband comes from the run's career row (`entry.board`,
 * the same end-state board the Career shows — no extra query); a run with no career row falls back to its
 * highest-wave snapshot in the pool.
 */
export function Leaderboard() {
  const show = useGame((s) => s.showLeaderboard);
  const close = useGame((s) => s.closeLeaderboard);
  const [records, setRecords] = useState<RunFightRecord[] | null>(null);
  const [history, setHistory] = useState<Map<string, HallHistoryFacts>>(new Map());
  const [boards, setBoards] = useState<Map<string, BoardSnapshot>>(new Map());
  const [sort, setSort] = useState<HallSort>('rate');

  useEffect(() => {
    if (!show) return;
    setRecords(null); // reset to the loading state each time it opens
    setHistory(new Map());
    setBoards(new Map());
    let alive = true;
    void fetchHallRecords(HALL_ROWS, HALL_MIN_FIGHTS).then(async (recs) => {
      if (!alive) return;
      setRecords(recs);
      const parsed = recs.map((r) => ({ key: r.runKey, ...parseRunKey(r.runKey) })).filter((p): p is { key: string; author: string; heroId: string; seed: number } => typeof p.seed === 'number');
      const h = await fetchHallHistory(parsed.map((p) => p.seed));
      if (!alive) return;
      setHistory(h);
      // The pool lookup only for runs whose career row carried no board (or had no career row at all).
      const missing = parsed.filter((p) => !hallHistoryFor(h, p.key)?.board);
      if (missing.length === 0) return;
      const b = await fetchRunFinalBoards(missing);
      if (!alive) return;
      setBoards(b);
    });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  const rows = records === null ? null : hallRowsOf(records, history, boards, { minFights: HALL_MIN_FIGHTS, limit: HALL_ROWS, sort });

  return (
    <SidebarHost className="lbpage lb-ladder lb-hall">
      <MenuSidebar current="hall" onBack={back} />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Hall of Champions</div>
            <div className="lbsub">The {HALL_ROWS} warbands with the best record against everyone</div>
          </div>
        </div>
        {/* Sort toggle — Win rate (the default, owner 2026-09-22) vs Most recent (by last fight). */}
        <div className="lb-seg" role="group" aria-label="Sort leaderboard">
          <button type="button" className={`lb-seg-btn${sort === 'recent' ? ' on' : ''}`} aria-pressed={sort === 'recent'} onClick={() => { if (sort !== 'recent') { sfx.pulse(); setSort('recent'); } }}>Most recent</button>
          <button type="button" className={`lb-seg-btn${sort === 'rate' ? ' on' : ''}`} aria-pressed={sort === 'rate'} onClick={() => { if (sort !== 'rate') { sfx.pulse(); setSort('rate'); } }}>Win rate</button>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Hall of Champions unavailable. No backend configured.</div></div>
        ) : rows === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Opening the Hall…</div></div>
        ) : rows.length === 0 ? (
          <div className="lbempty lb-state"><Icon name="crown" /><div>No records yet. A warband enters the Hall after {HALL_MIN_FIGHTS} fights.</div></div>
        ) : (
          <div className="lb-rows">
            {rows.map((r, i) => {
              const hero = getHero(r.heroId);
              const board = r.board && r.board.minions.length > 0 ? (r.board as BoardSnapshot) : null;
              const lastFight = playedOnText(r.record.lastFightAt);
              const lobbies = `${r.record.lobbies} ${r.record.lobbies === 1 ? 'lobby' : 'lobbies'}`;
              return (
                <div className="lb-row" key={r.key}>
                  <div className="lb-row-rank"><LbMedallion rank={i + 1} /></div>
                  <div className="lb-row-hero">
                    <LbHeroFrame heroId={r.heroId} />
                    <div className="lb-row-name">{r.author && r.author !== 'anon' ? r.author : hero.name}</div>
                    <div className="lb-row-herosub">{hero.name}</div>
                  </div>
                  {/* The middle reads exactly like a Recent Games row (owner 2026-09-22): the team and the runes. */}
                  <div className="lb-row-team">
                    <LbLabel>Final team</LbLabel>
                    <LbTeam board={board} empty="No warband stored for this run" />
                    <LbLabel>Runes</LbLabel>
                    <LbRunes runes={r.board?.runes ?? []} empty="No runes taken" />
                  </div>
                  {/* The record block: everything the run has fought, then its own game. */}
                  <div className="lb-row-outcome">
                    <LbLabel>Record</LbLabel>
                    <div className={`lb-verdict lb-hallrecord ${r.record.wins >= r.record.losses ? 'won' : 'lost'}`} aria-label={`Won ${r.record.wins}, lost ${r.record.losses}, drawn ${r.record.draws} across ${r.record.fights} fights`}>{recordText(r.record)}</div>
                    <div className="lb-hallrate" aria-label={`Win rate ${winRateText(r.record)} over ${lobbies}`}>{winRateText(r.record)} win rate · {lobbies}</div>
                    {r.ownRecord && <div className="lb-hallown" aria-label={`Its own game: won ${r.ownRecord.wins}, lost ${r.ownRecord.losses}`}>Own game {recordText(r.ownRecord)}</div>}
                    <div className="lb-when">{lastFight ? `Last fight ${lastFight}` : 'No fights dated'}</div>
                    {r.rank && <div className="lb-hallrank">{rankLabel(r.rank)}</div>}
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
