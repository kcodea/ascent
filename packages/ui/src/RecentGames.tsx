import { useEffect, useState } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { ordinal } from './runHistory';
import { fetchRecentGames, fetchPlayerById, fetchReplayPayload, remoteEnabled, type RecentGameRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';

/**
 * Recent Games (owner ask 2026-08-11) — the last 20 finished games across ALL players: who played, which hero,
 * and how it ended. A full-page overlay (sibling of the Leaderboard / Hall of Champions), read from the public
 * `run_telemetry` table (`fetchRecentGames`). Rows whose telemetry carries a v2 state replay grow a per-row
 * ▶ Watch (replay-v2 Phase C): the list read only probed watchability, so the click fetches THAT row's full
 * payload (`fetchReplayPayload`) and hands it to the viewer — `startReplay` closes this overlay, and exiting
 * the replay restores it.
 */

/** placement → verdict label + colour class (1st = win, 2–4 = top-4, else defeat). Null placement (pre-lobby
 *  rows) falls back to the win count. */
function outcome(r: RecentGameRow): { label: string; cls: string; place: string | null } {
  if (r.placement == null) return { label: `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`, cls: 'top4', place: null };
  const place = ordinal(r.placement);
  if (r.placement === 1) return { label: 'Victory', cls: 'won', place };
  if (r.placement <= 4) return { label: 'Top 4', cls: 'top4', place };
  return { label: 'Defeat', cls: 'lost', place };
}

const whenText = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

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
    void fetchRecentGames(20).then((r) => { if (alive) setRows(r); });
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
  // the viewer. The click is stopped from bubbling to the row (which opens the Career). If the payload turns
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
    <div className="lbpage rankpage">
      <div className="lbtopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="clock" />
          <div>
            <div className="esch disp">Recent Games</div>
            <div className="lbsub">The last 20 games across every player</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty">Recent games unavailable — no backend configured.</div>
        ) : rows === null ? (
          <div className="lbempty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="lbempty">No games to show yet — finish a run to seed the feed.</div>
        ) : (
          <div className="matchlist">
            {rows.map((r, i) => {
              const hero = r.heroId ? getHero(r.heroId) : null;
              const art = r.heroId ? heroArt(r.heroId) : null;
              const o = outcome(r);
              const key = `${r.author ?? '?'}-${r.createdAt ?? ''}-${i}`;
              const watchable = r.hasReplay && r.rowId != null;
              // The v2-replay Watch — a real button, so the CLICKABLE row variant below is a div[role=button]
              // (a button can't nest a button) exactly like the leaderboard's rows.
              const watchBtn = watchable && (
                <button
                  type="button"
                  className="matchwatch pressable"
                  onClick={(e) => watchGame(e, r, key)}
                  disabled={watching === key}
                  title={noReplay === key ? 'This replay is unavailable' : `Watch ${r.author || 'this player'}'s game`}
                >
                  {watching === key ? '…' : noReplay === key ? 'No replay' : '▶ Watch'}
                </button>
              );
              const inner = (
                <>
                  <span className="matchportrait">{art ? <img decoding="sync" src={art} alt={hero?.name ?? ''} draggable={false} /> : <Icon name="anvil" />}</span>
                  <span className="matchmeta">
                    <span className="matchname">{r.author || 'Unnamed climber'}</span>
                    <span className="matchsub">{hero?.name ?? 'Unknown hero'}{whenText(r.createdAt) ? ` · ${whenText(r.createdAt)}` : ''}</span>
                  </span>
                  {o.place && <span className={`rgplace${r.placement === 1 ? ' first' : ''}`}>{o.place}</span>}
                  <span className={`rgverdict ${o.cls}`}>{o.label}</span>
                  {watchBtn}
                </>
              );
              // A row with a known player opens their Career (that run expanded); a pre-accounts row (no
              // user_id) has nothing to open, so it stays a plain, non-interactive row.
              return r.userId ? (
                <div
                  role="button"
                  tabIndex={0}
                  className={`matchrow matchrow-btn${watchable ? ' haswatch' : ''}`}
                  key={key}
                  onClick={() => void openGame(r, key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void openGame(r, key); }}
                  aria-disabled={opening === key}
                  title={`View ${r.author || 'this player'}'s Career`}
                >
                  {inner}
                  <span className="rgchev" aria-hidden="true">›</span>
                </div>
              ) : (
                <div className={`matchrow${watchable ? ' haswatch' : ''}`} key={key}>{inner}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
