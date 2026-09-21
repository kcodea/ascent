import { useEffect, useState } from 'react';
import { getHero } from '@game/sim';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { MenuSidebar } from './MenuSidebar';
import { useGame } from './store';
import { fetchRecentGames, fetchPlayerById, fetchReplayPayload, remoteEnabled, type RecentGameRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import { LbHeroFrame, LbLabel, LbRunes, LbTeam } from './LadderBits';
import { outcomeOf, partialText, playedAtText, recordText, runLengthText } from './leaderboardData';

/**
 * Recent Games (owner ask 2026-08-11; polished 2026-09-20) — the last 20 finished games across ALL players,
 * each as a chunky banner in the Career page's match-banner language: the circular hero frame + hero name +
 * player handle, the final board as 7 real card tiles, the run's runes as emblems + names, and the outcome
 * block — VICTORY / placement, date + time, the W–L record, the run length, a "Partial recording" caption
 * when the replay doesn't start at round 1 — with ONE button, WATCH REPLAY. A full-page overlay (sibling of
 * the Leaderboard / Hall of Champions), read from the public `run_telemetry` table (`fetchRecentGames`): the
 * list pulls light JSON-path facts only; the Watch click fetches THAT row's full payload
 * (`fetchReplayPayload`) and hands it to the viewer — `startReplay` closes this overlay, and exiting the
 * replay restores it. Clicking the banner itself opens that player's Career.
 */
const FEED_ROWS = 20;

export function RecentGames(): JSX.Element | null {
  const show = useGame((s) => s.showRecentGames);
  const close = useGame((s) => s.closeRecentGames);
  const openCareer = useGame((s) => s.openCareer);
  const [rows, setRows] = useState<RecentGameRow[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null); // row key currently being opened
  const [watching, setWatching] = useState<string | null>(null); // row key whose replay payload is loading
  const [noReplay, setNoReplay] = useState<string | null>(null); // row key whose payload came back unplayable

  useEffect(() => {
    if (!show) return;
    setRows(null);
    let alive = true;
    void fetchRecentGames(FEED_ROWS).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;
  const back = (): void => { sfx.pulse(); close(); };

  // Open the clicked game inside the player's Career, expanded to that run. The Career header wants a
  // rating / games-played that the feed row doesn't carry, so pull the player's profile first (best-effort —
  // an absent profile just opens with the name we have). `focus` pins WHICH run to expand + scroll to.
  const openGame = async (r: RecentGameRow, key: string): Promise<void> => {
    if (!r.userId || opening) return;
    sfx.pulse();
    setOpening(key);
    const p = await fetchPlayerById(r.userId).catch(() => null);
    openCareer({
      userId: r.userId,
      author: p?.author || r.author || '',
      rating: p?.rating ?? 0,
      gamesPlayed: p?.gamesPlayed ?? 0,
      favoriteHero: p?.favoriteHero,
      focus: { heroId: r.heroId, wins: r.wins, placement: r.placement, createdAt: r.createdAt },
    });
    setOpening(null);
  };

  // Watch the row's recorded run — fetch its full v2 payload (only now: the list stayed light) and hand it to
  // the viewer. The click is stopped from bubbling to the banner (which opens the Career). If the payload turns
  // out unplayable (deleted / malformed), the button degrades to "No replay" instead of a broken viewer.
  const watchGame = (e: React.MouseEvent, r: RecentGameRow, key: string): void => {
    e.stopPropagation();
    if (r.rowId == null || watching) return;
    sfx.pulse();
    setNoReplay(null);
    setWatching(key);
    void fetchReplayPayload(r.rowId)
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: r.author || undefined });
        else setNoReplay(key);
      })
      .finally(() => setWatching(null));
  };

  return (
    <div className="lbpage lb-ladder rg-page">
      <MenuSidebar current="recent" onBack={back} />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="clock" />
          <div>
            <div className="esch disp">Recent Games</div>
            <div className="lbsub">The last {FEED_ROWS} games across every player</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Recent games unavailable — no backend configured.</div></div>
        ) : rows === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Gathering the latest climbs…</div></div>
        ) : rows.length === 0 ? (
          <div className="lbempty lb-state"><Icon name="clock" /><div>No recordings yet — finish a run to seed the feed.</div></div>
        ) : (
          <div className="lb-rows rg-list">
            {rows.map((r, i) => {
              const hero = r.heroId ? getHero(r.heroId) : null;
              const o = outcomeOf(r.placement);
              const key = `${r.rowId ?? r.author ?? '?'}-${r.createdAt ?? ''}-${i}`;
              const watchable = r.hasReplay && r.rowId != null;
              const busy = watching === key;
              const unplayable = noReplay === key;
              const when = playedAtText(r.createdAt);
              const length = runLengthText(r.durationMs);
              const record = r.record ? recordText(r.record) : `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`;
              const inner = (
                <>
                  <div className="lb-row-hero">
                    <LbHeroFrame heroId={r.heroId} />
                    <div className="lb-row-name">{r.author || 'Unnamed climber'}</div>
                    <div className="lb-row-herosub">{hero?.name ?? 'Unknown hero'}</div>
                    <div className={`lb-row-record ${r.record ? (r.record.wins >= r.record.losses ? 'won' : 'lost') : 'none'}`}>{record}</div>
                  </div>
                  <div className="lb-row-team">
                    <LbLabel>Final team</LbLabel>
                    <LbTeam board={r.board} empty={r.hasReplay ? 'No board recorded' : 'No board recorded for this game'} />
                    <LbLabel>Runes</LbLabel>
                    <LbRunes runes={r.runes} empty="No runes taken" />
                  </div>
                  <div className="lb-row-outcome">
                    <LbLabel>Match outcome</LbLabel>
                    <div className={`lb-verdict ${o.cls}`}>{o.label}</div>
                    <div className="lb-when">{when || '—'}</div>
                    <div className="lb-facts">
                      <span className="lb-fact"><span className="lb-fact-l">Length</span><span className="lb-fact-v">{length}</span></span>
                      {r.wave !== null && <span className="lb-fact"><span className="lb-fact-l">Rounds</span><span className="lb-fact-v">{r.wave}</span></span>}
                    </div>
                    {r.partial && <div className="lb-partial"><Icon name="clock" />{partialText(r.firstRecordedWave)}</div>}
                    <button
                      type="button"
                      className="lb-btn lb-watch pressable"
                      onClick={(e) => watchGame(e, r, key)}
                      disabled={!watchable || busy || unplayable}
                      aria-label={watchable ? `Watch ${r.author || 'this player'}'s game` : 'No replay stored for this game'}
                    >
                      {busy ? 'Loading…' : unplayable ? 'No replay' : watchable ? 'Watch replay' : 'No replay'}
                    </button>
                  </div>
                </>
              );
              // A banner with a known player opens their Career (that run focused); a pre-accounts row (no
              // user_id) has nothing to open, so it stays a plain, non-interactive banner. A div[role=button],
              // not a <button>: the banner nests the Watch button and a button can't nest a button.
              return r.userId ? (
                <div
                  role="button"
                  tabIndex={0}
                  className={`lb-row lb-row-btn${r.partial ? ' partial' : ''}`}
                  key={key}
                  onClick={() => void openGame(r, key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void openGame(r, key); }}
                  aria-disabled={opening === key}
                  aria-label={`View ${r.author || 'this player'}'s Career`}
                >
                  {inner}
                </div>
              ) : (
                <div className={`lb-row${r.partial ? ' partial' : ''}`} key={key}>{inner}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
