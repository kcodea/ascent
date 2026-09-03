import { useEffect, useState } from 'react';
import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, displayHandle } from './store';
import { fetchTopPlayers, fetchLatestReplayForUser, remoteEnabled, type PlayerRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';

/**
 * Rankings — the player Leaderboard (owner request 2026-07-13): the top 10 players by skill rating (the "MMR"),
 * each with their games played and favorite hero (most-played). A full page (like the Hall of Champions), read
 * from the shared `profiles` table (`fetchTopPlayers`). Best-effort — empty until the backend is configured +
 * the `profiles` table migrated (see schema.sql). Distinct from the Hall of Champions, which lists victory runs.
 */
export function Rankings() {
  const show = useGame((s) => s.showRankings);
  const close = useGame((s) => s.closeRankings);
  const myId = useGame((s) => s.account.userId);
  const openCareer = useGame((s) => s.openCareer);
  const [rows, setRows] = useState<PlayerRow[] | null>(null);
  const [watching, setWatching] = useState<string | null>(null); // userId whose replay is loading
  const [noReplay, setNoReplay] = useState<string | null>(null); // userId with no watchable v2 run

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
        <button className="lbback pressable" onClick={back}>← Back</button>
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
              <span className="rankwatchhead" />
            </div>
            {rows.map((r, i) => {
              const hero = r.favoriteHero ? getHero(r.favoriteHero) : null;
              const art = r.favoriteHero ? heroArt(r.favoriteHero) : null;
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
                const name = displayHandle(r.author, r.discriminator, r.userId);
                void fetchLatestReplayForUser(r.userId)
                  .then((rep) => { if (rep) startReplay(rep, { authorName: name }); else setNoReplay(r.userId); })
                  .finally(() => setWatching(null));
              };
              // A div[role=button], not a <button> — the row nests the Watch button and a button can't nest a button.
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={`rankrow rankrow-btn${mine ? ' me' : ''}`}
                  key={r.userId || r.author}
                  onClick={openTheirs}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openTheirs(); }}
                  title={`View ${displayHandle(r.author, r.discriminator, r.userId)}'s career`}
                >
                  <span className={`rankrank r${i + 1}`}>{i + 1}</span>
                  <span className="rankname">{displayHandle(r.author, r.discriminator, r.userId)}{mine && <span className="rankyou">you</span>}</span>
                  <span className="ranknum rankrating">{r.rating}</span>
                  <span className="ranknum">{r.gamesPlayed}</span>
                  <span className="rankfav">
                    {hero ? (
                      <>
                        <span className="rankportrait">{art ? <img decoding="sync" src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}</span>
                        {hero.name}
                      </>
                    ) : <span className="baldim">—</span>}
                  </span>
                  <button
                    type="button"
                    className="rankwatch pressable"
                    onClick={watch}
                    disabled={!r.userId || watching === r.userId}
                    title={noReplay === r.userId ? 'No watchable run yet' : `Watch ${displayHandle(r.author, r.discriminator, r.userId)}'s latest run`}
                  >
                    {watching === r.userId ? '…' : noReplay === r.userId ? 'No run' : '▶ Watch'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
