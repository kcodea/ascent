import { useEffect, useRef, useState } from 'react';
import { getHero } from '@game/sim';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, displayHandle } from './store';
import { fetchTopPlayers, fetchLatestGamesForUsers, fetchLatestReplayForUser, remoteEnabled, type LatestGameFacts, type PlayerRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import { LbHeroFrame, LbMedallion, LbTeam } from './LadderBits';
import { ordinalOf, playedOnText } from './leaderboardData';

/**
 * Rankings — the player LEADERBOARD (owner request 2026-07-13; polished 2026-09-20 to the Career page's
 * standard): the top players by skill rating (the "MMR") as a proper ranked table — podium medallions for the
 * top 3, the circular hero frame, the handle, the rating as the big number, games played, and each player's
 * LATEST recorded board as real card tiles (a light two-step read of `run_telemetry`, never a payload). Your
 * own row is highlighted and scrolled into view once the list lands. A row opens that player's Career; its
 * WATCH button plays their latest recorded run. Read from the shared `profiles` table (`fetchTopPlayers`);
 * best-effort — empty until the backend is configured. Distinct from the Hall of Champions (victory runs).
 */
export const RANKED_ROWS = 10;

export function Rankings() {
  const show = useGame((s) => s.showRankings);
  const close = useGame((s) => s.closeRankings);
  const myId = useGame((s) => s.account.userId);
  const openCareer = useGame((s) => s.openCareer);
  const [rows, setRows] = useState<PlayerRow[] | null>(null);
  const [latest, setLatest] = useState<Map<string, LatestGameFacts> | null>(null); // null = still loading
  const [watching, setWatching] = useState<string | null>(null); // userId whose replay is loading
  const [noReplay, setNoReplay] = useState<string | null>(null); // userId with no watchable v2 run
  const mineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!show) return;
    setRows(null); // loading state each open
    setLatest(null);
    let alive = true;
    void fetchTopPlayers(RANKED_ROWS).then(async (r) => {
      if (!alive) return;
      setRows(r);
      // Then each ranked player's latest recorded board (best-effort; a failure just leaves the cell empty).
      const facts = await fetchLatestGamesForUsers(r.map((p) => p.userId));
      if (alive) setLatest(facts);
    });
    return () => { alive = false; };
  }, [show]);

  // Bring YOUR row into view once the list has painted — one scroll, not a per-frame read.
  useEffect(() => {
    if (!rows || !mineRef.current) return;
    mineRef.current.scrollIntoView({ block: 'center' });
  }, [rows]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  return (
    <div className="lbpage rankpage lb-ladder">
      <div className="lbtopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Leaderboard</div>
            <div className="lbsub">Top {RANKED_ROWS} players by rating</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Leaderboard unavailable — no backend configured.</div></div>
        ) : rows === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Summoning the ladder…</div></div>
        ) : rows.length === 0 ? (
          <div className="lbempty lb-state"><Icon name="crown" /><div>No ranked players yet — finish a run to claim a slot.</div></div>
        ) : (
          <div className="lb-panel lb-table" role="table" aria-label="Top players by rating">
            <div className="lb-trow lb-thead" role="row">
              <span className="lb-c-rank">#</span>
              <span className="lb-c-player">Player</span>
              <span className="lb-c-rating">Rating</span>
              <span className="lb-c-games">Games</span>
              <span className="lb-c-board">Latest board</span>
              <span className="lb-c-act" />
            </div>
            {rows.map((r, i) => {
              const hero = r.favoriteHero ? getHero(r.favoriteHero) : null;
              const handle = displayHandle(r.author, r.discriminator, r.userId);
              const game = latest?.get(r.userId);
              // Match the player by their real identity (`user_id`), NOT the display name — two accounts can
              // share a name (that's what the `#tag` disambiguates), and matching by name lit up every row of
              // duplicates as "YOU" (owner report 2026-08-10).
              const mine = !!myId && r.userId === myId;
              // The row OPENS THEIR CAREER. Rankings stays mounted underneath, so Back returns here rather
              // than to the title — the Career overlay renders after it and simply covers it.
              const openTheirs = (): void => {
                sfx.pulse();
                openCareer({ userId: r.userId, author: r.author, rating: r.rating, gamesPlayed: r.gamesPlayed, favoriteHero: r.favoriteHero });
              };
              // Watch their latest run — fetch that player's newest v2 replay and hand it to the viewer.
              // `startReplay` closes this overlay; exiting the replay restores it. A player with no
              // watchable run yet degrades the pill to "No run" rather than opening a broken viewer.
              const watch = (e: React.MouseEvent): void => {
                e.stopPropagation();
                if (!r.userId || watching) return;
                sfx.pulse();
                setNoReplay(null);
                setWatching(r.userId);
                void fetchLatestReplayForUser(r.userId)
                  .then((rep) => { if (rep) startReplay(rep, { authorName: handle }); else setNoReplay(r.userId); })
                  .finally(() => setWatching(null));
              };
              const when = playedOnText(game?.createdAt);
              // A div[role=button], not a <button> — the row nests the Watch button and a button can't nest a button.
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={`lb-trow lb-trow-btn${mine ? ' me' : ''}`}
                  key={r.userId || r.author}
                  ref={mine ? mineRef : undefined}
                  onClick={openTheirs}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openTheirs(); }}
                  aria-label={`View ${handle}'s career`}
                >
                  <span className="lb-c-rank"><LbMedallion rank={i + 1} /></span>
                  <span className="lb-c-player">
                    <LbHeroFrame heroId={r.favoriteHero} />
                    <span className="lb-who">
                      <span className="lb-handle">{handle}{mine && <span className="lb-you">you</span>}</span>
                      <span className="lb-herosub">{hero ? hero.name : 'No favorite hero yet'}</span>
                    </span>
                  </span>
                  <span className="lb-c-rating"><span className="lb-rating">{r.rating}</span><span className="lb-unit">MMR</span></span>
                  <span className="lb-c-games"><span className="lb-num">{r.gamesPlayed}</span></span>
                  <span className="lb-c-board">
                    {game ? (
                      <>
                        <LbTeam board={game.board} empty="No board stored for their latest game" />
                        {game.placement !== null && (
                          <span className={`lb-latest-place ${game.placement === 1 ? 'won' : game.placement <= 4 ? 'top4' : 'lost'}`}>
                            {game.placement === 1 ? 'Victory' : ordinalOf(game.placement)}{when ? ` · ${when}` : ''}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="lb-team-none dim">{latest === null ? 'Loading…' : 'No recorded game yet'}</span>
                    )}
                  </span>
                  <span className="lb-c-act">
                    <button
                      type="button"
                      className="lb-btn pressable"
                      onClick={watch}
                      disabled={!r.userId || watching === r.userId || noReplay === r.userId}
                      aria-label={noReplay === r.userId ? 'No watchable run yet' : `Watch ${handle}'s latest run`}
                    >
                      {watching === r.userId ? 'Loading…' : noReplay === r.userId ? 'No run' : 'Watch'}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
