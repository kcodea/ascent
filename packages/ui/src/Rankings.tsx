import { useEffect, useState } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchTopPlayers, remoteEnabled, type PlayerRow } from './remoteBoards';

/**
 * Rankings — the player Leaderboard (owner request 2026-07-13): the top 10 players by skill rating (the "MMR"),
 * each with their games played and favorite hero (most-played). A full page (like the Hall of Champions), read
 * from the shared `profiles` table (`fetchTopPlayers`). Best-effort — empty until the backend is configured +
 * the `profiles` table migrated (see schema.sql). Distinct from the Hall of Champions, which lists victory runs.
 */
export function Rankings() {
  const show = useGame((s) => s.showRankings);
  const close = useGame((s) => s.closeRankings);
  const me = useGame((s) => s.playerName);
  const [rows, setRows] = useState<PlayerRow[] | null>(null);

  useEffect(() => {
    if (!show) return;
    setRows(null); // loading state each open
    let alive = true;
    void fetchTopPlayers(10).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  return (
    <div className="lbpage rankpage">
      <div className="lbtopbar">
        <button className="lbback" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Leaderboard</div>
            <div className="lbsub">Top players by rating</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty">Leaderboard unavailable — no backend configured.</div>
        ) : rows === null ? (
          <div className="lbempty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="lbempty">No ranked players yet — finish a run to claim a slot.</div>
        ) : (
          <div className="ranktable">
            <div className="rankrow rankhead">
              <span className="rankrank">#</span>
              <span className="rankname">Player</span>
              <span className="ranknum">Rating</span>
              <span className="ranknum">Games</span>
              <span className="rankfav">Favorite hero</span>
            </div>
            {rows.map((r, i) => {
              const hero = r.favoriteHero ? getHero(r.favoriteHero) : null;
              const art = r.favoriteHero ? heroArt(r.favoriteHero) : null;
              const mine = !!me && r.author === me;
              return (
                <div className={`rankrow${mine ? ' me' : ''}`} key={r.author}>
                  <span className={`rankrank r${i + 1}`}>{i + 1}</span>
                  <span className="rankname">{r.author}{mine && <span className="rankyou">you</span>}</span>
                  <span className="ranknum rankrating">{r.rating}</span>
                  <span className="ranknum">{r.gamesPlayed}</span>
                  <span className="rankfav">
                    {hero ? (
                      <>
                        <span className="rankportrait">{art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}</span>
                        {hero.name}
                      </>
                    ) : <span className="baldim">—</span>}
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
