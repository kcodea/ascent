/**
 * RANKED DUOS boards (owner design 2026-10-26, Q5; phase 3): the rating belongs to the PAIR, so the Leaderboard's Duos
 * tab lists TEAMS (name, both players, medal + bar, games) and the Career shows a player's teams. Same row chrome as the
 * solo Leaderboard (`.lb-trow`, `LbMedallion`, `RankBar`); one capped read each (R-NET-01), cached across opens.
 */
import { defaultTeamName } from '@game/sim';
import { Icon } from '../Icon';
import { LbHeroFrame, LbMedallion } from '../LadderBits';
import { RankBar } from '../rank/RankBar';
import { displayHandle } from '../store';
import { useSocial } from '../socialCache';
import { remoteEnabled } from '../remoteBoards';
import { versusRemote, type DuosLeaderboardRow, type DuosPlayerCard, type DuosTeamOfRow } from './versusRemote';

export const DUOS_ROWS = 25;
export const DUOS_RANKINGS_KEY = 'rankings:duos';
export const loadDuosRankings = (): Promise<DuosLeaderboardRow[]> => versusRemote.duosLeaderboard(DUOS_ROWS, 0).catch(() => []);

const handleOf = (p: DuosPlayerCard | null): string => (p ? displayHandle(p.name ?? 'Player', p.discriminator, p.userId) : 'Player');
/** The team's shown name: its own, or "Name1 & Name2" (computed, never stored). */
export const duosTeamLabel = (name: string | null, a: DuosPlayerCard | null, b: DuosPlayerCard | null): string =>
  name ?? defaultTeamName(a?.name ?? 'Player', b?.name ?? 'Player');

/** The Leaderboard's Duos tab: the top teams by medal rank. */
export function DuosLeaderboard({ show, myId }: { show: boolean; myId: string | null }) {
  const rows = useSocial<DuosLeaderboardRow[]>(show ? DUOS_RANKINGS_KEY : null, loadDuosRankings) ?? null;
  if (rows === null) return <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>Summoning the teams…</div></div>;
  if (rows.length === 0) return <div className="lbempty lb-state"><Icon name="crown" /><div>No ranked teams yet. Team up with a friend in Ranked Duos.</div></div>;
  return (
    <div className="lb-panel lb-table lb-duos" role="table" aria-label="Top Ranked Duos teams">
      <div className="lb-trow lb-thead" role="row">
        <span className="lb-c-rank">#</span>
        <span className="lb-c-player">Team</span>
        <span className="lb-c-rating">Rank</span>
        <span className="lb-c-games">Games</span>
      </div>
      {rows.map((r, i) => {
        const [a, b] = r.players;
        const mine = !!myId && (a?.userId === myId || b?.userId === myId);
        return (
          <div role="row" className={`lb-trow${mine ? ' me' : ''}`} key={r.teamId}>
            <span className="lb-c-rank"><LbMedallion rank={i + 1} /></span>
            <span className="lb-c-player">
              <span className="lb-duopair" aria-hidden="true">
                <LbHeroFrame heroId={a?.hero} side={a?.userId === myId ? 'self' : 'opp'} />
                <LbHeroFrame heroId={b?.hero} side={b?.userId === myId ? 'self' : 'opp'} />
              </span>
              <span className="lb-who">
                <span className="lb-handle">{duosTeamLabel(r.name, a, b)}{mine && <span className="lb-you">you</span>}</span>
                <span className="lb-herosub">{handleOf(a)} and {handleOf(b)}</span>
              </span>
            </span>
            <span className="lb-c-rating rk-rating"><RankBar position={{ divisionIndex: r.division, points: r.points }} size="row" showGate={false} /></span>
            <span className="lb-c-games"><span className="lb-num">{r.games}</span><span className="lb-unit">played</span></span>
          </div>
        );
      })}
    </div>
  );
}

/** The Career's Duos section: this player's teams, each with its partner, medal and games. Hidden with none. */
export function CareerDuosTeams({ userId }: { userId: string | null }) {
  const rows = useSocial<DuosTeamOfRow[]>(userId && remoteEnabled() ? `career:duos:${userId}` : null, () => versusRemote.duosTeamsOf(userId!).catch(() => [])) ?? null;
  if (!rows || rows.length === 0) return null;
  return (
    <div className="cv2-duos" aria-label="Ranked Duos teams">
      <div className="cv2-duos-head">Ranked Duos</div>
      {rows.slice(0, 5).map((t) => (
        <div className="cv2-duos-row" key={t.teamId}>
          <span className="cv2-duos-name">{t.name ?? `With ${handleOf(t.partner)}`}</span>
          <span className="cv2-duos-sub">{t.name ? `With ${handleOf(t.partner)} · ` : ''}{t.games} game{t.games === 1 ? '' : 's'}</span>
          <span className="cv2-duos-rank"><RankBar position={{ divisionIndex: t.division, points: t.points }} size="row" showGate={false} /></span>
        </div>
      ))}
    </div>
  );
}
