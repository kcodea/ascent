/**
 * THE LEADERBOARD ON THE APP SHELL (party home prototype, DEV only; owner 2026-11-02: "really sleek looking ... take a
 * lot of inspiration from valorant's menus"). Rankings.tsx keeps the reads (the ladder, the skins, your rank); while the
 * party home switch is on it hands them here, laid out like Valorant's leaderboard in the shell's language:
 *
 *   HEADER   the shared PhPage head: "Season ranked" eyebrow, LEADERBOARD, Solo | Duos tabs (with Versus on), the count.
 *   PODIUM   the top three as tall cards (2nd, 1st, 3rd): the player's portrait fading into the navy, the podium metal
 *            place box, name + title + favourite hero, then the rank crest, MMR and games across the foot.
 *   TABLE    the rest as rail rows: place, a portrait slice, name + title + hero, the rank crest + name + bar, MMR, games.
 *            Your row wears the gold edge and is scrolled into view once; when you are not on the board, your standing
 *            is pinned at the foot.
 *   DUOS     the same table for teams: both players' portraits, the team name, the pair, rank, games.
 *
 * Every row still opens that player's Career (the whole row is the button). Static paint; one scroll on land, no layout
 * reads per frame; small portraits use the phone thumbnails (`heroThumb`).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { getHero } from '@game/sim';
import type { RunCosmeticSnapshot } from '@game/progression';
import { avatarSrc, heroThumb } from '../../../art';
import { MenuSidebar, SidebarHost } from '../../../MenuSidebar';
import { RankCrest, RankBar } from '../../../rank/RankBar';
import { rankLabel, scalarCaption } from '../../../rank/rankFormat';
import { rankPositionOf, type RankPosition } from '../../../rank/types';
import type { RankedRow } from '../../../Rankings';
import { heroPortrait, opponentSkins } from '../../../skins/skins';
import { useSocial } from '../../../socialCache';
import { displayHandle } from '../../../store';
import { TitleBadge } from '../../../titles/TitleBadge';
import { DUOS_RANKINGS_KEY, DUOS_ROWS, duosTeamLabel, loadDuosRankings } from '../../../versus/DuosBoards';
import type { DuosLeaderboardRow, DuosPlayerCard } from '../../../versus/versusRemote';
import { PhChip, PhEmpty, PhPage, PhPlace, PhTabs } from '../../kit';
import './phLeaderboard.css';

export type PhBoard = 'solo' | 'duos';

export interface PhLeaderboardProps {
  rows: RankedRow[] | null;
  rowsShown: number;
  remote: boolean;
  versusOn: boolean;
  board: PhBoard;
  onBoard: (b: PhBoard) => void;
  myId: string | null;
  myName: string;
  myDisc: string | null | undefined;
  myRank: RankPosition | null;
  myAvatar: string | null | undefined;
  myLoadout: RunCosmeticSnapshot | null | undefined;
  showOpp: boolean;
  onOpen: (r: RankedRow) => void;
}

/** The art a row shows: the chosen profile picture (yours always, theirs through "Show opponent cosmetics"), else the
 *  favourite hero in its equipped skin; null with neither. Same rule as the old table. */
function rowArt(r: RankedRow, p: PhLeaderboardProps, mine: boolean): string | undefined {
  const theirs = mine ? null : opponentSkins(p.showOpp, r.skins);
  return (mine ? avatarSrc(p.myAvatar ?? r.avatar ?? null) : p.showOpp ? avatarSrc(r.avatar ?? null) : undefined)
    ?? heroPortrait(r.favoriteHero, mine ? (p.myLoadout ?? r.skins) : theirs);
}

/** The medal cell: the crest, the division name, the bar (a legacy row with no rank: its bare MMR). */
function RankCell({ rank }: { rank: RankPosition | null }) {
  if (!rank) return <span className="phl-rank none">Unranked</span>;
  return <span className="phl-rank"><RankBar position={rank} size="row" showGate={false} /></span>;
}

function Num({ v, unit, gold }: { v: ReactNode; unit: string; gold?: boolean }) {
  return <span className={`phl-num${gold ? ' gold' : ''}`}><b>{v}</b><small>{unit}</small></span>;
}

function SoloBoard(p: PhLeaderboardProps & { rows: RankedRow[] }) {
  const mineRef = useRef<HTMLDivElement | null>(null);
  // Bring YOUR row into view once the list has painted: one scroll, not a per-frame read.
  useEffect(() => { mineRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [p.rows]);
  const { rows, myId } = p;
  const podium = rows.length >= 3 ? rows.slice(0, 3) : [];
  const rest = rows.slice(podium.length);
  const meOnBoard = !!myId && rows.some((r) => r.userId === myId);
  const who = (r: RankedRow, mine: boolean) => {
    const hero = r.favoriteHero ? getHero(r.favoriteHero) : null;
    return { handle: displayHandle(r.author, r.discriminator, r.userId), hero: hero ? hero.name : 'No favorite hero yet', title: <TitleBadge id={mine || p.showOpp ? r.equippedTitleId : null} className="phl-title" /> };
  };
  return (
    <>
      {podium.length > 0 && (
        <div className="phl-podium" role="list" aria-label="Top three">
          {[1, 0, 2].map((i) => {
            const r = podium[i]!;
            const mine = !!myId && r.userId === myId;
            const w = who(r, mine);
            const rank = rankPositionOf(r.rank);
            const art = rowArt(r, p, mine);
            return (
              <div role="listitem" key={r.userId || r.author} className={`phl-pod p${i + 1}${mine ? ' me' : ''}`} ref={mine ? mineRef : undefined}>
                <button type="button" className="phl-podbtn" onClick={() => p.onOpen(r)} aria-label={`${i + 1}. ${w.handle}. View their career`}>
                  {art && <img className="phl-podart" src={art} alt="" draggable={false} decoding="async" />}
                  <span className="phl-podplace"><PhPlace place={i + 1} size={i === 0 ? 'l' : 'm'} /></span>
                  {mine && <PhChip tone="gold" className="phl-you">You</PhChip>}
                  <span className="phl-podwho">
                    <span className="phl-podname">{w.handle}</span>
                    {w.title}
                    <span className="phl-podhero">{w.hero}</span>
                  </span>
                  <span className="phl-podfoot">
                    {rank ? <span className="phl-podrank"><RankCrest divisionIndex={rank.divisionIndex} size="row" /><span>{rankLabel(rank)}</span></span> : <span className="phl-podrank none">Unranked</span>}
                    <Num v={r.rating} unit="MMR" gold />
                    <Num v={r.gamesPlayed} unit="Games" />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {rest.length > 0 && (
        <div className="phl-table" role="table" aria-label="Top players by rating">
          <div className="phl-head" role="row">
            <span>#</span><span />
            <span>Player</span><span>Rank</span><span className="r">MMR</span><span className="r">Games</span><span />
          </div>
          {rest.map((r, j) => {
            const place = j + podium.length + 1;
            const mine = !!myId && r.userId === myId;
            const w = who(r, mine);
            const art = heroThumb(rowArt(r, p, mine));
            return (
              <div role="row" key={r.userId || r.author} className={`phl-row${mine ? ' me' : ''}`} ref={mine ? mineRef : undefined}>
                <button type="button" className="phl-rowbtn" onClick={() => p.onOpen(r)} aria-label={`${place}. ${w.handle}. View their career`}>
                  <PhPlace place={place} />
                  <span className="phl-thumb">{art && <img src={art} alt="" draggable={false} decoding="async" loading="lazy" />}</span>
                  <span className="phl-who">
                    <span className="phl-name">{w.handle}{mine && <PhChip tone="gold">You</PhChip>}{w.title}</span>
                    <span className="phl-sub">{w.hero}</span>
                  </span>
                  <RankCell rank={rankPositionOf(r.rank)} />
                  <Num v={r.rating} unit="MMR" gold />
                  <Num v={r.gamesPlayed} unit="Games" />
                  <span className="phl-go" aria-hidden="true">›</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!meOnBoard && p.myRank && (
        <div className="phl-mepin" role="note" aria-label="Your standing">
          <PhChip tone="gold">You</PhChip>
          <span className="phl-name">{displayHandle(p.myName, p.myDisc, p.myId)}</span>
          <RankCell rank={p.myRank} />
          <Num v={scalarCaption(p.myRank)} unit="MMR" gold />
          <span className="phl-sub">Outside the top {p.rowsShown}</span>
        </div>
      )}
    </>
  );
}

const handleOf = (c: DuosPlayerCard | null): string => (c ? displayHandle(c.name ?? 'Player', c.discriminator, c.userId) : 'Player');

function DuosBoard({ myId }: { myId: string | null }) {
  const rows = useSocial<DuosLeaderboardRow[]>(DUOS_RANKINGS_KEY, loadDuosRankings) ?? null;
  if (rows === null) return <PhEmpty title="Loading the teams" sub="Fetching the top Ranked Duos teams." />;
  if (rows.length === 0) return <PhEmpty title="No ranked teams yet" sub="Team up with a friend in Ranked Duos." />;
  return (
    <div className="phl-table duos" role="table" aria-label="Top Ranked Duos teams">
      <div className="phl-head" role="row"><span>#</span><span /><span>Team</span><span>Rank</span><span className="r">Games</span></div>
      {rows.map((r, i) => {
        const [a, b] = r.players;
        const mine = !!myId && (a?.userId === myId || b?.userId === myId);
        const artA = heroThumb(heroPortrait(a?.hero, null));
        const artB = heroThumb(heroPortrait(b?.hero, null));
        return (
          <div role="row" className={`phl-row${mine ? ' me' : ''}`} key={r.teamId}>
            <span className="phl-rowbtn static">
              <PhPlace place={i + 1} />
              <span className="phl-pair" aria-hidden="true">
                <span className="phl-thumb">{artA && <img src={artA} alt="" draggable={false} decoding="async" loading="lazy" />}</span>
                <span className="phl-thumb">{artB && <img src={artB} alt="" draggable={false} decoding="async" loading="lazy" />}</span>
              </span>
              <span className="phl-who">
                <span className="phl-name">{duosTeamLabel(r.name, a, b)}{mine && <PhChip tone="gold">You</PhChip>}</span>
                <span className="phl-sub">{handleOf(a)} and {handleOf(b)}</span>
              </span>
              <RankCell rank={{ divisionIndex: r.division, points: r.points }} />
              <Num v={r.games} unit="Games" />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PhLeaderboard(p: PhLeaderboardProps) {
  const duos = p.versusOn && p.board === 'duos';
  let body: ReactNode;
  if (!p.remote) body = <PhEmpty title="Leaderboard unavailable" sub="This build has no backend configured." />;
  else if (duos) body = <DuosBoard myId={p.myId} />;
  else if (p.rows === null) body = <PhEmpty title="Loading the ladder" sub="Fetching the top players." />;
  else if (p.rows.length === 0) body = <PhEmpty title="No ranked players yet" sub="Finish a run to claim a slot." />;
  else body = <SoloBoard {...p} rows={p.rows} />;
  return (
    <SidebarHost className="lbpage rankpage phl-page">
      <MenuSidebar current="rankings" />
      <PhPage
        className="phl-pg"
        eyebrow="Season ranked"
        title="Leaderboard"
        tabs={p.versusOn ? <PhTabs tabs={[{ id: 'solo', label: 'Solo' }, { id: 'duos', label: 'Duos' }]} value={p.board} onChange={p.onBoard} label="Leaderboard" /> : undefined}
        actions={<span className="phl-count">{duos ? `Top ${DUOS_ROWS} teams` : `Top ${p.rowsShown} players by MMR`}</span>}
      >
        {body}
      </PhPage>
    </SidebarHost>
  );
}
