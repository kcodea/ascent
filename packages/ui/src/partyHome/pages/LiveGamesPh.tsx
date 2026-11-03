/**
 * LIVE GAMES under the party home's app shell (DEV switch "Party home (prototype)", owner 2026-11-02). The live directory
 * as a spectate list in the Docked rail's language, built from the shell kit. Same reads, refresh and Watch path as the
 * classic page (`live/LiveGames.tsx` owns them and hands them in); this file is presentation only.
 *
 * One rail slice per game, best rank first (the directory's order): the hero art fading in from the left behind the
 * player's name and hero, the rank crest with its label and rating, the game at a glance (the mode, then the friends'
 * own `FriendGame` line: the step, place, Health + Armor, tier; the players of a Versus room; a Ranked Duos teammate),
 * and at the right the watchers and a Watch button. Pages of 30 with Previous / Next. Static paint.
 */
import { getHero, rankLabel } from '@game/sim';
import { heroThumb } from '../../art';
import { Icon } from '../../Icon';
import { RankCrest } from '../../rank/RankBar';
import { heroPortrait, opponentSkins } from '../../skins/skins';
import { FriendGame } from '../../friends/friendBits';
import { LIVE_PAGE, type LiveGameRow } from '../../live/liveRemote';
import { liveGameStatusOf, liveModeLabel, liveNameOf, liveWatchTargetOf } from '../../live/liveTargets';
import { PhButton, PhChip, PhEmpty, PhPage, PhSection } from '../kit';
import './gamesPages.css';

/** The most watchers a game takes (the Watch button reads "Full" past it; the server enforces the same cap). */
export const LIVE_WATCH_CAP = 20;

export interface LiveGamesPhProps {
  offline: boolean; rows: readonly LiveGameRow[] | null; failed: boolean; error: string | null;
  page: number; joining: string | null; showOpp: boolean;
  onWatch: (r: LiveGameRow) => void; onPage: (next: number) => void; onRecent: () => void; onPlay: () => void;
}

/** "12 live now" / "30+ live now" (a full page means there are more). */
export function liveCountText(n: number, page: number): string {
  if (page > 0) return `Page ${page + 1}`;
  return `${n}${n === LIVE_PAGE ? '+' : ''} live now`;
}

export function LiveGamesPh(p: LiveGamesPhProps) {
  const rows = p.rows;
  const actions = rows && rows.length > 0 ? <PhChip tone="teal" className="lvp-count"><i aria-hidden="true" />{liveCountText(rows.length, p.page)}</PhChip> : undefined;
  let body: JSX.Element;
  if (p.offline) body = <PhSection><PhEmpty title="Live games are unavailable" sub="This build has no backend configured." /></PhSection>;
  else if (rows === null) {
    body = <PhSection><PhEmpty title={p.failed ? 'Live games are not available right now' : 'Finding live games'} sub={p.failed ? 'Trying again shortly.' : 'One moment.'} /></PhSection>;
  } else if (rows.length === 0) {
    // Never a dead end, and centred in the page (round 4 critic): a short friendly line and the two things to do instead.
    body = (
      <div className="lvp-quiet">
        <PhSection>
          <PhEmpty
            title={p.page > 0 ? 'That is every live game' : 'All quiet in the arena'}
            sub={p.page > 0 ? 'Head back to the first page to see them all.' : 'No one is mid-game right now. Catch a recent replay, or start a game of your own.'}
            action={p.page === 0
              ? <span className="lvp-quietbtns"><PhButton variant="primary" onClick={p.onRecent}>Watch replays</PhButton><PhButton onClick={p.onPlay}>Play</PhButton></span>
              : <PhButton onClick={() => p.onPage(0)}>First page</PhButton>}
          />
        </PhSection>
      </div>
    );
  } else {
    body = (
      <div className="lvp-list" role="list" aria-label="Games being played right now">
        {rows.map((r) => <LiveRow key={r.game_id} r={r} showOpp={p.showOpp} joining={p.joining} onWatch={p.onWatch} />)}
      </div>
    );
  }
  const pager = rows !== null && (p.page > 0 || rows.length === LIVE_PAGE);
  return (
    <PhPage className="lvp" wide eyebrow="Watch any game live" title="Live Games" actions={actions}>
      {p.error && <div className="lvp-error" role="alert">{p.error}</div>}
      {body}
      {pager && rows && (
        <nav className="lvp-pager" aria-label="Pages">
          <PhButton size="s" disabled={p.page === 0} onClick={() => p.onPage(Math.max(0, p.page - 1))}>Previous</PhButton>
          <span>Page {p.page + 1}</span>
          <PhButton size="s" disabled={rows.length < LIVE_PAGE} onClick={() => p.onPage(p.page + 1)}>Next</PhButton>
        </nav>
      )}
    </PhPage>
  );
}

function LiveRow({ r, showOpp, joining, onWatch }: { r: LiveGameRow; showOpp: boolean; joining: string | null; onWatch: (r: LiveGameRow) => void }) {
  const skins = opponentSkins(showOpp, r.cosmetics);
  const hero = getHero(r.hero_id);
  const room = liveWatchTargetOf(r.game_id).kind === 'room';
  const status = liveGameStatusOf(r);
  const name = liveNameOf(r);
  // A room's name line is already its players; a lobby game names its hero (not while the player is still picking one).
  const sub = room || r.phase === 'hero' ? null : hero?.name ?? null;
  const ended = r.phase === 'end';
  const full = r.spectators >= LIVE_WATCH_CAP;
  const art = heroThumb(heroPortrait(r.hero_id, skins));
  return (
    <div role="listitem" className={`phk-row lvp-row${ended ? ' ended' : ''}`}>
      {art && <img className="phk-rowart" src={art} alt="" draggable={false} decoding="async" loading="lazy" />}
      <div className="lvp-who">
        <span className="lvp-name">{name}</span>
        {sub && <span className="lvp-hero">{sub}</span>}
      </div>
      <div className="lvp-rank">
        <RankCrest divisionIndex={r.division_index} size="row" />
        <span className="lvp-ranktxt">
          <span className="lvp-ranklbl">{rankLabel({ divisionIndex: r.division_index, points: r.rank_points })}</span>
          <span className="lvp-rating">{r.rating} MMR</span>
        </span>
      </div>
      <div className="lvp-game">
        <PhChip>{liveModeLabel(r) ?? 'Ranked'}</PhChip>
        <FriendGame game={status.hero ? { ...status, hero: null } : status} />
        {room && status.vs && <span className="lvp-mate">{status.vs}</span>}
        {status.mate && <span className="lvp-mate">{`Teammate: ${status.mate}`}</span>}
      </div>
      <div className="lvp-act">
        {!ended && <span className="lvp-watchers" aria-label={`${r.spectators} watching`}><Icon name="eye" />{r.spectators}</span>}
        <PhButton variant="primary" size="s" disabled={joining !== null || ended || full} onClick={() => onWatch(r)} aria-label={`Watch ${name}`}>
          {joining === r.game_id ? 'Joining' : ended ? 'Ended' : full ? 'Full' : 'Watch'}
        </PhButton>
      </div>
    </div>
  );
}
