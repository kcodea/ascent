import { useEffect, useState } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { ordinal } from './runHistory';
import { fetchRecentGames, remoteEnabled, type RecentGameRow } from './remoteBoards';

/**
 * Recent Games (owner ask 2026-08-11) — the last 20 finished games across ALL players: who played, which hero,
 * and how it ended. A full-page overlay (sibling of the Leaderboard / Hall of Champions), read from the public
 * `run_telemetry` table (`fetchRecentGames`). Read-only — no replay, no interaction; just the feed.
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
  const [rows, setRows] = useState<RecentGameRow[] | null>(null);

  useEffect(() => {
    if (!show) return;
    setRows(null);
    let alive = true;
    void fetchRecentGames(20).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;
  const back = (): void => { sfx.pulse(); close(); };

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
              return (
                <div className="matchrow" key={`${r.author ?? '?'}-${r.createdAt ?? ''}-${i}`}>
                  <span className="matchportrait">{art ? <img src={art} alt={hero?.name ?? ''} draggable={false} /> : <Icon name="anvil" />}</span>
                  <span className="matchmeta">
                    <span className="matchname">{r.author || 'Unnamed climber'}</span>
                    <span className="matchsub">{hero?.name ?? 'Unknown hero'}{whenText(r.createdAt) ? ` · ${whenText(r.createdAt)}` : ''}</span>
                  </span>
                  {o.place && <span className={`rgplace${r.placement === 1 ? ' first' : ''}`}>{o.place}</span>}
                  <span className={`rgverdict ${o.cls}`}>{o.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
