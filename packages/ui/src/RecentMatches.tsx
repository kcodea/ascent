import { useEffect, useState } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, displayHandle } from './store';
import { fetchRecentReplays, remoteEnabled, type ReplayListing } from './remoteBoards';
import { startReplay } from './replayDriver';

/**
 * Recent Matches — the spectator feed (owner ask 2026-08-10): the newest finished runs across all players,
 * each a one-click "watch back their game". The full replay already rides in `run_telemetry.replay` (public
 * read), so a row IS a playable run — clicking it hands the replay to the live viewer (`startReplay`), which
 * closes this overlay so exiting returns to the title. Best-effort + time-boxed; empty until a backend is
 * configured. Sibling of the Rankings/Champions full-page overlays.
 */
export function RecentMatches(): JSX.Element | null {
  const show = useGame((s) => s.showRecentMatches);
  const close = useGame((s) => s.closeRecentMatches);
  const myId = useGame((s) => s.account.userId);
  const [rows, setRows] = useState<ReplayListing[] | null>(null);

  useEffect(() => {
    if (!show) return;
    setRows(null); // loading state each open
    let alive = true;
    void fetchRecentReplays(30).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  // "3rd", "12 wins" — a compact result blurb. Placement is the lobby finish (1 = won the lobby); wins is the
  // number of combats won. Prefer placement when we have it.
  const result = (r: ReplayListing): string => {
    if (r.placement && r.placement > 0) {
      const s = r.placement % 10, d = Math.floor(r.placement / 10) % 10;
      const suffix = d === 1 ? 'th' : s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th';
      return `${r.placement}${suffix} place`;
    }
    return `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`;
  };

  return (
    <div className="lbpage rankpage">
      <div className="lbtopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="eye" />
          <div>
            <div className="esch disp">Watch a Match</div>
            <div className="lbsub">Recent runs from every player — click to spectate</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty">Recent matches unavailable — no backend configured.</div>
        ) : rows === null ? (
          <div className="lbempty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="lbempty">No matches to watch yet — finish a run to seed the feed.</div>
        ) : (
          <div className="matchlist">
            {rows.map((r, i) => {
              const hero = r.heroId ? getHero(r.heroId) : null;
              const art = r.heroId ? heroArt(r.heroId) : null;
              const mine = !!myId && r.userId === myId;
              const watch = (): void => { sfx.pulse(); startReplay(r.replay); };
              return (
                <button
                  type="button"
                  className={`matchrow pressable${mine ? ' me' : ''}`}
                  key={`${r.userId || r.author}-${r.createdAt}-${i}`}
                  onClick={watch}
                  title={`Watch ${displayHandle(r.author, undefined, r.userId)}'s run`}
                >
                  <span className="matchportrait">{art ? <img src={art} alt={hero?.name ?? ''} draggable={false} /> : <Icon name="anvil" />}</span>
                  <span className="matchmeta">
                    <span className="matchname">{displayHandle(r.author, undefined, r.userId)}{mine && <span className="rankyou">you</span>}</span>
                    <span className="matchsub">{hero?.name ?? 'Unknown hero'} · {result(r)}</span>
                  </span>
                  <span className="matchwatch">▶ Watch</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
