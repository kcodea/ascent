/**
 * RECENT GAMES under the party home's app shell (DEV switch "Party home (prototype)", owner 2026-11-02: "all of these menus
 * should get revamped to work with the new setup", "take a lot of inspiration from valorant's menus"). A match history in
 * the Docked rail's language, built from the shell kit. Same data, same reads, same handlers as the classic page
 * (`RecentGames.tsx` owns all of them and hands them in); this file is presentation only.
 *
 *   HEADER   the title, whose games these are, and the Ranked / Practice / Duos tabs.
 *   STRIP    the games at a glance: games, average place, top 4 rate, wins, the most played hero (portrait fading into
 *            the navy) and the placement line, oldest to newest, every game a podium-coloured mark.
 *   FILTER   the heroes in this feed, most played first, as the kit's segmented row (the rest under More).
 *   SPLIT    LEFT the history: one rail slice per game, its placement in podium metal, a band edge (gold 1st, teal top 4,
 *            rose 5th to 8th), the player, the hero, the rank it was played at and when, the hero art fading in from
 *            the right. RIGHT the open game: a banner (placement, player, hero, record, rank, Replay + Career), the
 *            facts as tiles, the board as the real cards with whose board it is, the runes, and the lobby grid of all
 *            eight players' boards (pick one to show it above).
 *
 * Both halves scroll on their own, so the strip and the filter stay put. Up / Down move through the list.
 * PERFORMANCE: static paint (hover is a colour); only the open game's board mounts; the board's card FX stay still until
 * pointed at (the classic page's rule). Phone portraits are the 256 px thumbnails (`heroThumb`).
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { MatchDetails } from '@game/sim';
import type { RunCosmeticSnapshot } from '@game/progression';
import { getHero, runeLiveStateOfSnapshot, strengthText } from '@game/sim';
import { heroThumb } from '../../art';
import { Icon } from '../../Icon';
import { ReplayEye } from '../../menuIcons';
import { GameRank } from '../../gameRank';
import { rankLabel } from '../../rank/types';
import { StoredTeam } from '../../StoredTeam';
import { LbRunes } from '../../LadderBits';
import type { HeroCount } from '../../heroFilter';
import { bandOf, placeText, type GameBand } from '../../GameCard';
import { LobbyTiles, SeatBoard, SeatRuneRow, ShowingLine, useLobbySeat } from '../../matchDetails/LobbyPicker';
import { GAME_STRENGTH_LABEL, GAME_STRENGTH_TIP } from '../../matchDetails/matchDetailsText';
import { SHOW_LOBBY_STRENGTH } from '../../lobbyStrengthDisplay';
import { fetchRecentMatch } from '../../remoteBoards';
import { partialText, playedAtText, recordText, runLengthText } from '../../leaderboardData';
import { heroPortrait } from '../../skins/skins';
import { DuosGameCard } from '../../duosHistory/DuosGameCard';
import { duosBand, duosGameView, duosModeLabel, teamPlaceText, type DuosGameRow } from '../../duosHistory/duosHistoryData';
import { practiceOpponentsText, summaryOf, type FeedRow, type RecentGamesTab } from '../../RecentGames';
import { PhButton, PhChip, PhEmpty, PhFact, PhPage, PhPlace, PhSection, PhSegmented, PhSelectList, PhStat, PhTabs } from '../kit';
import './gamesPages.css';

export interface KeyedRow { r: FeedRow; key: string; mine: boolean; skins: RunCosmeticSnapshot | null }
export type RecentState = 'offline' | 'loading' | 'empty' | 'signedout' | 'ready';

export interface RecentGamesPhProps {
  tab: RecentGamesTab; onTab: (t: RecentGamesTab) => void; state: RecentState;
  feedRows: number; duosLimit: number;
  rows: readonly KeyedRow[]; duosRows: readonly DuosGameRow[]; myId: string | null;
  heroCounts: readonly HeroCount[]; heroFilter: string | null; onHero: (id: string | null) => void;
  picked: string | null; onPick: (key: string) => void;
  watching: string | null; noReplay: string | null; opening: string | null;
  onOpen: (r: FeedRow, key: string) => void; onWatch: (e: MouseEvent, r: FeedRow, key: string) => void;
}

const TABS = [
  { id: 'ranked' as const, label: 'Ranked' },
  { id: 'practice' as const, label: 'Practice' },
  { id: 'duos' as const, label: 'Duos' },
];

/** The words for a placement: "Victory", "4th place", "No placement". */
export function placeWords(place: number | null): string {
  if (place === null || !(place > 0)) return 'No placement';
  return place === 1 ? 'Victory' : `${placeText(place)} place`;
}

/** A placement box: the kit's `PhPlace`, plain (no podium metal) when the band did not earn it (a Duos team's 2nd of 2 is
 *  a loss). No placement: the same box with a dash. */
function Place({ place, band, big }: { place: number | null; band: GameBand; big?: boolean }) {
  if (place === null || !(place > 0)) return <span className={`phk-place${big ? ' s-l' : ''}`} aria-label="No placement">-</span>;
  return <PhPlace place={place} size={big ? 'l' : 'm'} plain={band === 'lost'} />;
}

/** How many hero options the filter shows before the rest fold into More ("All heroes" counts as one). */
export const HERO_FILTER_MAX = 9;

export function RecentGamesPh(p: RecentGamesPhProps) {
  const duos = p.tab === 'duos';
  const practice = p.tab === 'practice';
  const scope = duos ? `Your last ${p.duosLimit} Duos games` : practice ? `The last ${p.feedRows} practice games, every player` : `The last ${p.feedRows} games, every player`;
  return (
    <PhPage
      className="rgp" wide eyebrow="Match history" title="Recent Games"
      tabs={<PhTabs tabs={TABS} value={p.tab} onChange={p.onTab} label="Recent games view" />}
      actions={<span className="rgp-scope">{scope}</span>}
    >
      {duos ? <DuosBody {...p} /> : <FeedBody {...p} />}
    </PhPage>
  );
}

function StateBody({ state, tab, signedOut }: { state: RecentState; tab: RecentGamesTab; signedOut?: boolean }) {
  if (state === 'offline') return <PhSection><PhEmpty title="Recent games are unavailable" sub="This build has no backend configured." /></PhSection>;
  if (state === 'loading') {
    return <PhSection><PhEmpty title={tab === 'duos' ? 'Gathering your Duos games' : tab === 'practice' ? 'Gathering the latest practice games' : 'Gathering the latest games'} sub="One moment." /></PhSection>;
  }
  if (signedOut) return <PhSection><PhEmpty title="Sign in to see your Duos games" sub="Duos games are kept on your account." /></PhSection>;
  const empty = tab === 'duos'
    ? { t: 'No Duos games yet', s: 'Finish a Ranked Duos or Versus Duos game to see it here.' }
    : tab === 'practice'
      ? { t: 'No practice games yet', s: 'Finish a practice game to see it here.' }
      : { t: 'No games recorded yet', s: 'Finish a run to seed the feed.' };
  return <PhSection><PhEmpty title={empty.t} sub={empty.s} /></PhSection>;
}

/* ── RANKED + PRACTICE ─────────────────────────────────────────────────────────────────────────────────────────────── */

function FeedBody(p: RecentGamesPhProps) {
  const practice = p.tab === 'practice';
  const filterBar = p.state === 'ready' || (p.heroFilter !== null && p.state !== 'offline')
    ? (
      <div className="rgp-filters">
        <PhSegmented<string | null>
          label="Hero" value={p.heroFilter} onPick={p.onHero} max={HERO_FILTER_MAX}
          options={[{ value: null, label: 'All heroes' }, ...p.heroCounts.map((c) => ({
            value: c.id, label: <>{getHero(c.id).name}<span className="rgp-n" aria-label={`, ${c.n} ${c.n === 1 ? 'game' : 'games'}`}>{c.n}</span></>,
          }))]}
        />
      </div>
    )
    : null;
  if (p.state !== 'ready') return <><StateBody state={p.state} tab={p.tab} />{filterBar}</>;
  if (p.rows.length === 0) {
    return <>{filterBar}<PhSection><PhEmpty title="No games with this hero" sub="Pick another hero, or show them all." action={<PhButton size="s" onClick={() => p.onHero(null)}>All heroes</PhButton>} /></PhSection></>;
  }
  const sel = p.rows.find((k) => k.key === p.picked) ?? p.rows[0]!;
  return (
    <>
      <Strip rows={p.rows} practice={practice} />
      {filterBar}
      <div className="rgp-split">
        <GameList
          label={practice ? 'Latest practice games' : 'Latest games'} selected={sel.key} onPick={p.onPick}
          items={p.rows.map(({ r, key, skins }) => {
            const heroName = r.heroId ? getHero(r.heroId).name : 'Unknown hero';
            const rank = !practice && 'rank' in r ? r.rank ?? null : null;
            const who = r.author || 'Unnamed player';
            return {
              key, place: r.placement, band: bandOf(r.placement), title: who, sub: heroName, when: playedAtText(r.createdAt) || undefined, rank,
              art: heroThumb(heroPortrait(r.heroId, skins)),
              label: `${placeText(r.placement)}, ${who}, ${heroName}${rank != null ? `, played at ${rankLabel(rank)}` : ''}`,
            };
          })}
        />
        <div className="rgp-detailcol">
          <FeedDetail
            key={sel.key} row={sel} practice={practice}
            busy={p.watching === sel.key} unplayable={p.noReplay === sel.key} opening={p.opening === sel.key}
            onOpen={p.onOpen} onWatch={p.onWatch}
          />
        </div>
      </div>
    </>
  );
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** THE STRIP: the shown games at a glance (over the hero filter, like the classic page's summary). */
const Strip = memo(function Strip({ rows, practice }: { rows: readonly KeyedRow[]; practice: boolean }) {
  const s = useMemo(() => summaryOf(rows.map((k) => k.r)), [rows]);
  const heroArt = s.hero ? heroThumb(heroPortrait(s.hero.id, null)) : undefined;
  return (
    <section className="rgp-strip" aria-label={practice ? 'The latest practice games at a glance' : 'The latest games at a glance'}>
      <div className="rgp-stats">
        <PhStat label="Games" value={s.games} />
        <PhStat label="Avg place" value={s.avgPlace === null ? '-' : s.avgPlace.toFixed(1)} />
        <PhStat label="Top 4" value={s.top4 === null ? '-' : `${Math.round(s.top4 * 100)}%`} />
        <PhStat label="Wins" value={s.wins} tone="gold" />
      </div>
      <div className="rgp-most">
        {heroArt && <img className="rgp-mostart" src={heroArt} alt="" draggable={false} decoding="async" />}
        <span className="rgp-k">Most played</span>
        <span className="rgp-mostname">{s.hero ? getHero(s.hero.id).name : '-'}</span>
        <span className="rgp-mostsub">
          {s.hero ? `${s.hero.n} ${s.hero.n === 1 ? 'game' : 'games'}` : ''}{s.tribe ? `, top tribe ${cap(s.tribe.id)}` : ''}
        </span>
      </div>
      <Spark places={s.places} />
    </section>
  );
});

/** The placement ledger: 1st at the top, 8th at the foot, the top 4 a soft lit band. The line is a soft rounded stroke in
 *  a stretched SVG; every game is a glossy GEM laid over it in HTML (so it stays round at any width): a gold gem for a win,
 *  silver for the rest of the top 4, bronze after. Static: built once per list. */
const Spark = memo(function Spark({ places }: { places: readonly number[] }) {
  const n = places.length;
  // Percent of the plot box, with a little room at each end so the end gems are whole.
  const x = (i: number): number => (n <= 1 ? 50 : 2 + (i * 96) / (n - 1));
  const y = (pl: number): number => 8 + ((pl - 1) * 84) / 7;
  const line = n > 1 ? places.map((pl, i) => `${(x(i) * 10).toFixed(1)},${y(pl).toFixed(1)}`).join(' ') : '';
  return (
    <div className="rgp-spark">
      <span className="rgp-k">Placements, oldest to newest</span>
      <div className={`rgp-sp-plot${n > 60 ? ' dense' : ''}`} role="img" aria-label={`Placements of the last ${n} games`}>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <rect className="rgp-sp-top4" x="0" y={y(1) - 6} width="1000" height={y(4.5) - y(1) + 6} rx="6" />
          {line && <polyline className="rgp-sp-line" points={line} />}
        </svg>
        {places.map((pl, i) => <i key={i} className={`rgp-gem ${bandOf(pl)}`} style={{ left: `${x(i)}%`, top: `${y(pl)}%` }} />)}
        <span className="rgp-sp-ax" aria-hidden="true"><b style={{ top: `${y(1)}%` }}>1st</b><b style={{ top: `${y(4)}%` }}>4th</b><b style={{ top: `${y(8)}%` }}>8th</b></span>
      </div>
    </div>
  );
});

/* ── THE LIST ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface ListItem {
  key: string; place: number | null; band: GameBand; title: string; sub?: string; when?: string;
  rank?: number | null; delta?: number | null; art?: string; label: string;
}

/** The history: one rail slice per game, in the kit's keyboard list (Up / Down / Home / End). */
export const GameList = memo(function GameList({ items, selected, onPick, label }: {
  items: readonly ListItem[]; selected: string; onPick: (key: string) => void; label: string;
}) {
  // Keep the picked row in view when the pick comes from outside the list (a filter change). `nearest` never moves a
  // visible row; the kit list scrolls its own keyboard moves.
  // Scrolls only the list itself (scrollIntoView would also scroll the phone's page and hide the strip): one read per pick.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = ref.current;
    const on = box?.querySelector<HTMLElement>('.rgp-item.sel')?.parentElement;
    if (!box || !on) return;
    const top = on.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + on.offsetHeight - box.clientHeight;
  }, [selected]);
  return (
    <div className="rgp-listwrap" ref={ref}>
      <PhSelectList
        className="rgp-list" label={label} items={items} keyOf={(it) => it.key} selected={selected}
        onSelect={(it) => { if (it.key !== selected) onPick(it.key); }}
        render={(it, on) => (
          <div className={`phk-row rgp-item b-${it.band}${on ? ' sel' : ''}`} aria-label={it.label}>
            {it.art && <img className="phk-rowart rgp-itemart" src={it.art} alt="" draggable={false} decoding="async" loading="lazy" />}
            <Place place={it.place} band={it.band} />
            <span className="phk-rowwho">
              <span className="phk-rowtitle">{it.title}</span>
              {it.sub && <span className="phk-rowsub">{it.sub}</span>}
            </span>
            <span className="rgp-itemend">
              {it.rank != null && <GameRank divisionIndex={it.rank} compact />}
              {it.delta != null && it.delta !== 0 && <span className={`rgp-delta ${it.delta > 0 ? 'up' : 'down'}`}>{it.delta > 0 ? `+${it.delta}` : it.delta}</span>}
              {it.when && <span className="rgp-when">{it.when}</span>}
            </span>
          </div>
        )}
      />
    </div>
  );
});

/* ── THE OPEN GAME ─────────────────────────────────────────────────────────────────────────────────────────────────── */

interface DetailProps {
  row: KeyedRow; practice: boolean; busy: boolean; unplayable: boolean; opening: boolean;
  onOpen: (r: FeedRow, key: string) => void; onWatch: (e: MouseEvent, r: FeedRow, key: string) => void;
}

/** One fact tile (the kit's), with the game's hover tip when it has one. */
function Fact({ label, children, tip }: { label: string; children: React.ReactNode; tip?: string }) {
  const tile = <PhFact label={label} value={children} />;
  return tip ? <span className="gtip rgp-tip" data-tip={tip}>{tile}</span> : tile;
}

const FeedDetail = memo(function FeedDetail({ row, practice, busy, unplayable, opening, onOpen, onWatch }: DetailProps) {
  const { r, key, mine, skins } = row;
  const cfg = 'practice' in r ? r.practice : null;
  const hero = r.heroId ? getHero(r.heroId) : null;
  const band = bandOf(r.placement);
  const watchable = r.hasReplay && r.rowId != null;
  const who = r.author || 'Unnamed player';
  const record = r.record ? recordText(r.record) : `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`;
  // A practice row carries its lobby; a ranked row's standings load on demand (two one-row reads, cached), exactly as the
  // classic page does. Until they land, or when none were recorded, there is simply no lobby section.
  const practiceRow = 'match' in r;
  const [fetched, setFetched] = useState<MatchDetails | null>(null);
  useEffect(() => {
    if (practiceRow) return undefined;
    let live = true;
    void fetchRecentMatch(r.rowId, r.userId).then((m) => { if (live) setFetched(m); });
    return () => { live = false; };
  }, [practiceRow, r.rowId, r.userId]);
  const match = 'match' in r ? r.match : fetched;
  const { seat, pick } = useLobbySeat(match);
  // A pick in the lobby (below the board) brings the board back into view; nothing moves when it is already on screen.
  const boardRef = useRef<HTMLElement | null>(null);
  // Only on a real change of seat (StrictMode runs effects twice), and it scrolls only the detail column, never the page.
  const shownSeat = useRef<string | null>(null);
  useEffect(() => {
    const id = seat?.id ?? null;
    if (id === shownSeat.current) return;
    shownSeat.current = id;
    const el = boardRef.current;
    const col = el?.closest<HTMLElement>('.rgp-detailcol');
    if (!el || !col || typeof col.scrollTo !== 'function') return;
    const top = el.getBoundingClientRect().top - col.getBoundingClientRect().top;
    if (top < 0) col.scrollTo({ top: col.scrollTop + top, behavior: 'smooth' });
  }, [seat?.id]);
  const art = heroThumb(heroPortrait(r.heroId, skins));
  const rank = !practice && 'rank' in r && r.rank != null ? r.rank : null;
  const replayText = busy ? 'Loading' : unplayable || !watchable ? 'No replay' : 'Replay';

  return (
    <article className={`rgp-detail b-${band}`} aria-label={`${who}, ${hero?.name ?? 'Unknown hero'}: ${placeWords(r.placement)}`}>
      <header className="rgp-banner">
        {art && <img className="rgp-bannerart" src={art} alt="" draggable={false} decoding="async" />}
        <Place place={r.placement} band={band} big />
        <div className="rgp-bannerwho">
          <span className={`rgp-verdict b-${band}`}>{placeWords(r.placement)}</span>
          <h2 className="rgp-name">{who}</h2>
          <span className="rgp-line">
            <span>{hero?.name ?? 'Unknown hero'}</span>
            <span className={`rgp-record ${r.record ? (r.record.wins >= r.record.losses ? 'up' : 'down') : ''}`}>{record}</span>
            {rank != null && <GameRank divisionIndex={rank} />}
          </span>
        </div>
        <div className="rgp-bannerbtns">
          {(!practice || watchable) && (
            <PhButton
              variant="primary" onClick={(e) => onWatch(e, r, key)} disabled={!watchable || busy || unplayable}
              aria-label={watchable ? `Watch ${r.author || 'this player'}'s game` : 'No replay stored for this game'}
            >
              <ReplayEye />{replayText}
            </PhButton>
          )}
          {r.userId && (
            <PhButton onClick={() => onOpen(r, key)} disabled={opening} aria-label={`View ${r.author || 'this player'}'s Career`}>
              Career<span className="rgp-go" aria-hidden="true">›</span>
            </PhButton>
          )}
        </div>
      </header>

      <div className="rgp-facts">
        {playedAtText(r.createdAt) && <Fact label="Played">{playedAtText(r.createdAt)}</Fact>}
        <Fact label="Length">{runLengthText(r.durationMs, r.lengthOverCap)}</Fact>
        {r.wave !== null && <Fact label="Rounds">{r.wave}</Fact>}
        {cfg && <Fact label="Opponents">{practiceOpponentsText(cfg)}</Fact>}
        {cfg && <Fact label="Health">{cfg.health === 'normal' ? 'Normal' : 'Unlimited'}</Fact>}
        {SHOW_LOBBY_STRENGTH && r.lobbyStrength && <Fact label="Lobby">{strengthText(r.lobbyStrength)}</Fact>}
        {r.boardStrength != null && <Fact label={GAME_STRENGTH_LABEL} tip={GAME_STRENGTH_TIP}>{r.boardStrength}</Fact>}
        {r.partial && <PhChip className="rgp-partial"><Icon name="clock" />{partialText(r.firstRecordedWave)}</PhChip>}
      </div>

      <section className="rgp-boardsec" aria-label="Final board" ref={boardRef}>
        {match
          ? <ShowingLine seat={seat} details={match} onBack={() => pick(null)} own={mine} />
          : <div className="lp-showing"><span className="lp-showing-l">Final board</span></div>}
        <div className="rgp-board"><div className="rgp-boardin" key={seat?.id ?? 'own'}>
          {seat ? <SeatBoard seat={seat} own={mine} /> : r.board && r.board.minions.length > 0
            ? <StoredTeam minions={r.board.minions} skins={skins} />
            : <div className="rgp-none">No board recorded for this game</div>}
        </div></div>
        <div className="rgp-runes">
          {seat ? <SeatRuneRow seat={seat} /> : <LbRunes runes={r.runes} live={runeLiveStateOfSnapshot(r.board)} empty="No runes taken" />}
        </div>
      </section>

      {match && (
        <section className="rgp-lobby" aria-label="Players in this lobby">
          <header className="rgp-lobbyhead"><h3>The lobby</h3></header>
          <LobbyTiles details={match} selectedId={seat?.id ?? null} onPick={pick} own={mine} />
        </section>
      )}
    </article>
  );
});

/* ── DUOS ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */

function DuosBody(p: RecentGamesPhProps) {
  const items = useMemo((): ListItem[] => p.duosRows.map((r) => {
    const v = duosGameView(r.record, p.myId);
    const heroName = v.me?.heroId ? getHero(v.me.heroId).name : 'Unknown hero';
    const title = v.myTeam?.name ?? duosModeLabel(r.mode);
    const sub = v.mate ? `${heroName} with ${v.mate.name}` : heroName;
    const rank = r.mode === 'ranked_duos' && r.rank ? r.rank.divisionBefore : null;
    return {
      key: r.matchId, place: v.place, band: duosBand(v.place, v.teamCount), title, sub, when: playedAtText(r.completedAt) || undefined, rank,
      delta: r.rank?.delta ?? null, art: heroThumb(heroPortrait(v.me?.heroId, null)),
      label: `${teamPlaceText(v.place, v.teamCount)}, ${duosModeLabel(r.mode)}, ${sub}${rank != null ? `, played at ${rankLabel(rank)}` : ''}`,
    };
  }), [p.duosRows, p.myId]);
  if (p.state !== 'ready') return <StateBody state={p.state} tab="duos" signedOut={p.state === 'signedout'} />;
  if (p.duosRows.length === 0) return <StateBody state="empty" tab="duos" />;
  const sel = p.duosRows.find((r) => r.matchId === p.picked) ?? p.duosRows[0]!;
  return (
    <div className="rgp-split">
      <GameList items={items} selected={sel.matchId} onPick={p.onPick} label="Your Duos games" />
      <div className="rgp-detailcol rgp-duos"><DuosGameCard key={sel.matchId} row={sel} myId={p.myId} /></div>
    </div>
  );
}
