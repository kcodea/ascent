/**
 * LIVE GAMES (owner-approved 2026-10-15; every game since 2026-10-28, R-LIVE-ALL-GAMES-01: lobby games of every kind, Versus
 * 1v1 / Group / Duos and Ranked Duos, on both hosts): games being played right now, best rank first (medal and
 * division, then points, then rating), each with the player's portrait in their frame and skin, name, hero, rank crest,
 * round and watchers, and a Watch button. A ladder page like Recent Games (the menu sidebar, the `lb-` rows and
 * buttons); one page of 30 at a time with Next / Previous. Refreshed every 10 s while open.
 */
import { useEffect, useState } from 'react';
import { getHero, rankLabel } from '@game/sim';
import { Icon } from '../Icon';
import { LbHeroFrame } from '../LadderBits';
import { MenuSidebar, SidebarHost } from '../MenuSidebar';
import { refuseInGame } from '../gameMenuParts';
import { RankCrest } from '../rank/RankBar';
import { remoteEnabled } from '../remoteBoards';
import { pageHidden } from '../net/backoff';
import { sfx } from '../sfx';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { heroPortrait, opponentSkins } from '../skins/skins';
import { useGame } from '../store';
import { LIVE_PAGE, liveRemote, type LiveGameRow } from './liveRemote';
import { useLiveWatch } from './liveWatch';
import { watchGame } from '../friends/friendsGo';
import { liveModeLabel, liveNameOf, liveWatchTargetOf } from './liveTargets';
import './live.css';

const REFRESH_MS = 10_000;

/** "Round 6 · Shop" / "Round 6 · Fight" / "Finished 3rd". */
export function liveStatusText(r: Pick<LiveGameRow, 'round' | 'phase' | 'placement'>): string {
  if (r.phase === 'end') return r.placement ? `Finished #${r.placement}` : 'Finished';
  if (r.phase === 'hero') return 'Hero Select';
  return `Round ${r.round} · ${r.phase === 'combat' ? 'Fight' : 'Shop'}`;
}

export function LiveGames(): JSX.Element | null {
  const show = useGame((s) => s.showLiveGames);
  const goTo = useGame((s) => s.goTo);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const error = useLiveWatch((s) => s.error);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<LiveGameRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  // Every 10 s while visible (R-NET-BACKOFF-01): nothing while the tab is hidden (a refresh on coming back), and a
  // failing read waits 20, 40, 60 s before the next try instead of asking every 10 s forever.
  useEffect(() => {
    if (!show || !remoteEnabled()) return undefined;
    let live = true;
    let fails = 0;
    let nextAt = 0;
    const load = (): void => {
      nextAt = Date.now() + Math.min(60_000, REFRESH_MS * 2 ** fails);
      liveRemote.list(page).then((r) => { if (live) { fails = 0; setRows(r); setFailed(false); } })
        .catch(() => { if (live) { fails++; nextAt = Date.now() + Math.min(60_000, REFRESH_MS * 2 ** fails); setFailed(true); } });
    };
    load();
    const id = window.setInterval(() => { if (!pageHidden() && Date.now() >= nextAt) load(); }, 1000);
    const onVis = (): void => { if (!pageHidden() && Date.now() >= nextAt) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { live = false; window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [show, page]);

  if (!show) return null;
  const watch = (r: LiveGameRow): void => {
    if (joining) return;
    if (refuseInGame()) return; // never from inside a game (R-ESC-SIDEBAR-01)
    sfx.pulse();
    setJoining(r.game_id);
    // A Versus match or a Ranked Duos team (R-RANKED-DUOS-PARTY-01) watches its room from the stands, on its own host;
    // a lobby game opens the live watch screen. The one watch path, shared with a friend's Watch (R-WATCH-ENTERS-01).
    void watchGame(liveWatchTargetOf(r.game_id), r).then(() => setJoining(null));
  };

  return (
    <SidebarHost className="lbpage lb-ladder lv-page">
      <MenuSidebar current="live" />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="sword" />
          <div>
            <div className="esch disp">Live Games</div>
            <div className="lbsub">Games being played right now. Watch any of them live.</div>
          </div>
        </div>
      </div>
      {error && <div className="lv-error" role="alert">{error}</div>}
      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty lb-state"><Icon name="gear" /><div>Live games unavailable. No backend configured.</div></div>
        ) : rows === null ? (
          <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>{failed ? 'Live games are not available right now.' : 'Finding live games…'}</div></div>
        ) : rows.length === 0 ? (
          <div className="lbempty lb-state">
            <Icon name="sword" />
            <div>{page > 0 ? 'No more live games.' : 'No games are being played right now.'}</div>
            {/* Not a dead end (2026-10-16 audit): the finished games are one press away. */}
            {page === 0 && <div className="lb-state-sub">Check back soon, or watch a finished game.</div>}
            {page === 0 && <button type="button" className="lb-btn pressable lv-torecent" onClick={() => { sfx.pulse(); goTo('recent'); }}><Icon name="clock" />Recent Games</button>}
          </div>
        ) : (
          <div className="lb-rows lv-list">
            {rows.map((r) => {
              const skins = opponentSkins(showOpp, r.cosmetics);
              const hero = getHero(r.hero_id);
              const label = liveModeLabel(r);
              return (
                <div key={r.game_id} className="lb-row lv-row">
                  <div className="lb-row-hero">
                    <LbHeroFrame heroId={r.hero_id} art={heroPortrait(r.hero_id, skins)} frameId={frameIdOf(skins)} />
                    <div className="lb-row-name">{liveNameOf(r)}</div>
                    <div className="lb-row-herosub">{label ?? (r.phase === 'hero' ? 'Picking a hero' : hero?.name ?? 'Unknown hero')}</div>
                  </div>
                  <div className="lv-rank">
                    <RankCrest divisionIndex={r.division_index} size="row" />
                    <div className="lv-rank-label">{rankLabel({ divisionIndex: r.division_index, points: r.rank_points })}</div>
                    <div className="lv-rating">{r.rating} rating</div>
                  </div>
                  <div className="lb-row-outcome lv-state">
                    <div className="lv-status">{liveStatusText(r)}</div>
                    {r.phase !== 'end' && <div className="lv-watchers"><Icon name="eye" />{r.spectators} watching</div>}
                    <button type="button" className="lb-btn lb-watch pressable" disabled={joining !== null || r.phase === 'end' || r.spectators >= 20}
                      onClick={() => watch(r)} aria-label={`Watch ${liveNameOf(r)}`}>
                      {joining === r.game_id ? 'Joining…' : r.spectators >= 20 ? 'Full' : 'Watch'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {rows !== null && (page > 0 || rows.length === LIVE_PAGE) && (
          <div className="lv-pager">
            <button type="button" className="lb-btn pressable" disabled={page === 0} onClick={() => { sfx.pulse(); setRows(null); setPage((p) => Math.max(0, p - 1)); }}>Previous</button>
            <button type="button" className="lb-btn pressable" disabled={rows.length < LIVE_PAGE} onClick={() => { sfx.pulse(); setRows(null); setPage((p) => p + 1); }}>Next</button>
          </div>
        )}
      </div>
    </SidebarHost>
  );
}
