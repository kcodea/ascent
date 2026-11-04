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
import { isPhone } from '../../deviceClass';
import { Icon } from '../../Icon';
import { rankLabel } from '../../rank/types';
import type { HeroCount } from '../../heroFilter';
import { bandOf, placeText } from '../../GameCard';
import { GAME_STRENGTH_LABEL, GAME_STRENGTH_TIP } from '../../matchDetails/matchDetailsText';
import { SHOW_LOBBY_STRENGTH } from '../../lobbyStrengthDisplay';
import { fetchRecentMatch, peekRecentMatch } from '../../remoteBoards';
import { partialText, playedAtText, recordText, runLengthText } from '../../leaderboardData';
import { heroPortrait } from '../../skins/skins';
import { DuosGameCard } from '../../duosHistory/DuosGameCard';
import { duosBand, duosGameView, duosModeLabel, teamPlaceText, type DuosGameRow } from '../../duosHistory/duosHistoryData';
import { practiceOpponentsText, summaryOf, type FeedRow, type RecentGamesTab } from '../../RecentGames';
import { PhButton, PhChip, PhEmpty, PhPage, PhSection, PhSegmented, PhStat, PhTabs } from '../kit';
import { GameDetail, GameDetailHold, GameList, useHeldKey, useNearPrefetch, type GameFact, type ListItem } from './gameView';
import './gamesPages.css';

export { placeWords } from './gameView';

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
  /** Read the feed again (the "not available" panel's Retry). */
  onRetry: () => void;
}

const TABS = [
  { id: 'ranked' as const, label: 'Ranked' },
  { id: 'practice' as const, label: 'Practice' },
  { id: 'duos' as const, label: 'Duos' },
];

/** How many hero options the filter shows on the header line before the rest fold into More ("All heroes" and More count):
 *  one row on every screen (round 5 critic). Read once per render from the window width, never per frame. */
export const heroFilterMax = (): number => (isPhone() ? 4 : typeof window !== 'undefined' && window.innerWidth < 1600 ? 5 : 7);

export function RecentGamesPh(given: RecentGamesPhProps) {
  // A TAB SWITCH NEVER BLANKS THE PAGE (round 11 critic): while the next feed is read, the last one stays up (tabs already
  // on the new tab, the strip, chips and list a little dimmed), and the data swaps in place when it lands.
  const last = useRef<Pick<RecentGamesPhProps, 'tab' | 'rows' | 'heroCounts'> | null>(null);
  if (given.state === 'ready' && given.tab !== 'duos' && given.rows.length > 0) last.current = { tab: given.tab, rows: given.rows, heroCounts: given.heroCounts };
  const stale = given.state === 'loading' && given.tab !== 'duos' && last.current !== null;
  const p: RecentGamesPhProps = stale ? { ...given, ...last.current!, state: 'ready' } : given;
  const duos = given.tab === 'duos';
  const practice = given.tab === 'practice';
  const scope = duos ? `Your last ${p.duosLimit} Duos games` : practice ? `Last ${p.feedRows} practice games` : `Last ${p.feedRows} games`;
  return (
    <PhPage
      className={`rgp${stale ? ' stale' : ''}`} wide eyebrow="Match history" title="Recent Games"
      tabs={<PhTabs tabs={TABS} value={given.tab} onChange={p.onTab} label="Recent games view" />}
      actions={duos || !(p.state === 'ready' || (p.heroFilter !== null && p.state !== 'offline'))
        ? <span className="rgp-scope">{scope}</span>
        : <HeroFilter {...p} />}
    >
      {duos ? <DuosBody {...p} /> : <FeedBody {...p} />}
    </PhPage>
  );
}

function StateBody({ state, tab, signedOut, onRetry }: { state: RecentState; tab: RecentGamesTab; signedOut?: boolean; onRetry: () => void }) {
  if (state === 'offline') return <PhSection><PhEmpty title="Recent games are unavailable" sub="This build has no backend configured." /></PhSection>;
  if (state === 'loading') {
    return <PhSection><PhEmpty title={tab === 'duos' ? 'Gathering your Duos games' : tab === 'practice' ? 'Gathering the latest practice games' : 'Gathering the latest games'} sub="One moment." /></PhSection>;
  }
  if (signedOut) return <PhSection><PhEmpty title="Sign in to see your Duos games" sub="Duos games are kept on your account." /></PhSection>;
  if (tab === 'duos') return <PhSection><PhEmpty title="No Duos games yet" sub="Finish a Ranked Duos or Versus Duos game to see it here." /></PhSection>;
  // Ranked and Practice are feeds of EVERY player, and their reads answer [] on any failure: an empty feed is a failed or
  // timed-out read, so it says so and offers Retry, never a false "no games yet" (the Leaderboard's rule).
  return (
    <PhSection>
      <PhEmpty title="Recent games are not available right now" sub="Check your connection and try again."
        action={<PhButton onClick={onRetry}>Retry</PhButton>} />
    </PhSection>
  );
}

/* ── RANKED + PRACTICE ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** The hero filter: ONE row of pills on the header line, the rest under More (the kit's PhSegmented `max`). */
function HeroFilter(p: RecentGamesPhProps) {
  return (
    <div className="rgp-filters" aria-label="Filter by hero">
      <PhSegmented<string | null>
        value={p.heroFilter} onPick={p.onHero} max={heroFilterMax()}
        options={[{ value: null, label: 'All heroes' }, ...p.heroCounts.map((c) => ({
          value: c.id, label: <>{getHero(c.id).name}<span className="rgp-n" aria-label={`, ${c.n} ${c.n === 1 ? 'game' : 'games'}`}>{c.n}</span></>,
        }))]}
      />
    </div>
  );
}

function FeedBody(p: RecentGamesPhProps) {
  if (p.state !== 'ready') return <StateBody state={p.state} tab={p.tab} onRetry={p.onRetry} />;
  if (p.rows.length === 0) {
    return <PhSection><PhEmpty title="No games with this hero" sub="Pick another hero, or show them all." action={<PhButton size="s" onClick={() => p.onHero(null)}>All heroes</PhButton>} /></PhSection>;
  }
  return <FeedReady {...p} />;
}

/** Is this row's lobby in hand? A practice row carries its own; a row with no read to make has none to wait for. */
const lobbyInHand = (r: FeedRow): boolean => 'match' in r || r.rowId == null || !r.userId || peekRecentMatch(r.rowId) !== undefined;

function FeedReady(p: RecentGamesPhProps) {
  const practice = p.tab === 'practice';
  const sel = p.rows.find((k) => k.key === p.picked) ?? p.rows[0]!;
  const rowOf = (key: string): KeyedRow | undefined => p.rows.find((k) => k.key === key);
  const readLobby = (key: string): Promise<unknown> => {
    const k = rowOf(key);
    return k && !('match' in k.r) ? fetchRecentMatch(k.r.rowId, k.r.userId) : Promise.resolve();
  };
  // The open game arrives whole: the list moves at once, the detail swaps when its lobby is in hand (gameView.tsx).
  const shownKey = useHeldKey(sel.key, (key) => { const k = rowOf(key); return !k || lobbyInHand(k.r); }, readLobby);
  const keys = useMemo(() => p.rows.map((k) => k.key), [p.rows]);
  useNearPrefetch(keys, sel.key, readLobby);
  const items = useMemo((): ListItem[] => p.rows.map(({ r, key, skins }) => {
    const heroName = r.heroId ? getHero(r.heroId).name : 'Unknown hero';
    const rank = !practice && 'rank' in r ? r.rank ?? null : null;
    const who = r.author || 'Unnamed player';
    return {
      key, place: r.placement, band: bandOf(r.placement), title: who, sub: heroName, when: playedAtText(r.createdAt) || undefined, rank,
      art: heroThumb(heroPortrait(r.heroId, skins)),
      label: `${placeText(r.placement)}, ${who}, ${heroName}${rank != null ? `, played at ${rankLabel(rank)}` : ''}`,
    };
  }), [p.rows, practice]);
  const shown = shownKey === null ? null : rowOf(shownKey) ?? sel;
  return (
    <>
      <Strip rows={p.rows} practice={practice} />
      <div className="rgp-split">
        <GameList label={practice ? 'Latest practice games' : 'Latest games'} selected={sel.key} onPick={p.onPick} items={items} onNear={readLobby} />
        <div className="rgp-detailcol">
          {shown
            ? <FeedDetail key={shown.key} row={shown} practice={practice} busy={p.watching === shown.key} unplayable={p.noReplay === shown.key} opening={p.opening === shown.key} onOpen={p.onOpen} onWatch={p.onWatch} />
            : <GameDetailHold />}
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
        <PhStat label={practice ? 'Practice, all players' : 'Games, all players'} value={s.games} />
        <PhStat label="Avg place" value={s.avgPlace === null ? '-' : s.avgPlace.toFixed(1)} />
        <PhStat label="Top 4" value={s.top4 === null ? '-' : `${Math.round(s.top4 * 100)}%`} />
        <PhStat label="Wins" value={s.wins} tone="gold" />
      </div>
      <div className="rgp-most">
        {heroArt && <img className="rgp-mostart" src={heroArt} alt="" draggable={false} decoding="sync" />}
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

/** How many games the ledger shows: few enough that every gem is chunky and none overlap (the figures cover the whole feed). */
export const LEDGER_GAMES = 30;

/** The placement ledger: the latest games as glossy GEMS, newest on the right, 1st at the top and 8th at the foot, the top 4
 *  a soft lit band. No line joining them. A gold gem for a win, silver for the rest of the top 4, bronze after. Laid out
 *  in HTML so they stay round at any width. Static: built once per list. */
const Spark = memo(function Spark({ places }: { places: readonly number[] }) {
  const shown = places.slice(-LEDGER_GAMES);
  const n = shown.length;
  // Percent of the plot box, with a little room at each end so the end gems are whole.
  const x = (i: number): number => (n <= 1 ? 50 : 2 + (i * 96) / (n - 1));
  const y = (pl: number): number => 10 + ((pl - 1) * 80) / 7;
  return (
    <div className="rgp-spark">
      <span className="rgp-k">Last {n} placements, newest on the right</span>
      <div className="rgp-sp-plot" role="img" aria-label={`Placements of the last ${n} games, oldest first: ${shown.map((pl) => placeText(pl)).join(', ')}`}>
        <span className="rgp-sp-top4" style={{ top: 0, height: `${y(4.5)}%` }} />
        {shown.map((pl, i) => <i key={i} className={`rgp-gem ${bandOf(pl)}`} style={{ left: `${x(i)}%`, top: `${y(pl)}%` }} />)}
        <span className="rgp-sp-ax" aria-hidden="true"><b style={{ top: `${y(1)}%` }}>1st</b><b style={{ top: `${y(4)}%` }}>4th</b><b style={{ top: `${y(8)}%` }}>8th</b></span>
      </div>
    </div>
  );
});

/* ── THE OPEN GAME: this feed's row, as the shared detail (gameView.tsx) ─────────────────────────────────────────────── */

interface DetailProps {
  row: KeyedRow; practice: boolean; busy: boolean; unplayable: boolean; opening: boolean;
  onOpen: (r: FeedRow, key: string) => void; onWatch: (e: MouseEvent, r: FeedRow, key: string) => void;
}

const FeedDetail = memo(function FeedDetail({ row, practice, busy, unplayable, opening, onOpen, onWatch }: DetailProps) {
  const { r, key, mine, skins } = row;
  const cfg = 'practice' in r ? r.practice : null;
  const watchable = r.hasReplay && r.rowId != null;
  // A practice row carries its lobby; a ranked row's standings load on demand (two one-row reads, cached), exactly as the
  // classic page does. Until they land, or when none were recorded, there is simply no lobby section.
  const practiceRow = 'match' in r;
  // undefined = still being read (the detail holds the lobby's place); a revisit has the answer at once.
  const [fetched, setFetched] = useState<MatchDetails | null | undefined>(() => (practiceRow || r.rowId == null || !r.userId ? null : peekRecentMatch(r.rowId)));
  useEffect(() => {
    if (practiceRow) return undefined;
    let live = true;
    void fetchRecentMatch(r.rowId, r.userId).then((m) => { if (live) setFetched(m); });
    return () => { live = false; };
  }, [practiceRow, r.rowId, r.userId]);
  const facts: GameFact[] = [
    ...(playedAtText(r.createdAt) ? [{ label: 'Played', value: playedAtText(r.createdAt) }] : []),
    { label: 'Length', value: runLengthText(r.durationMs, r.lengthOverCap) },
    ...(r.wave !== null ? [{ label: 'Rounds', value: r.wave }] : []),
    ...(cfg ? [{ label: 'Opponents', value: practiceOpponentsText(cfg) }, { label: 'Health', value: cfg.health === 'normal' ? 'Normal' : 'Unlimited' }] : []),
    ...(SHOW_LOBBY_STRENGTH && r.lobbyStrength ? [{ label: 'Lobby', value: strengthText(r.lobbyStrength) }] : []),
    ...(r.boardStrength != null ? [{ label: GAME_STRENGTH_LABEL, value: r.boardStrength, tip: GAME_STRENGTH_TIP }] : []),
  ];
  return (
    <GameDetail
      place={r.placement} who={r.author || 'Unnamed player'} heroName={r.heroId ? getHero(r.heroId).name : 'Unknown hero'}
      art={heroThumb(heroPortrait(r.heroId, skins))}
      record={r.record ? recordText(r.record) : `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`}
      recordTone={r.record ? (r.record.wins >= r.record.losses ? 'up' : 'down') : ''}
      rank={!practice && 'rank' in r && r.rank != null ? r.rank : null}
      facts={facts} notice={r.partial ? <PhChip className="rgp-partial"><Icon name="clock" />{partialText(r.firstRecordedWave)}</PhChip> : null}
      match={'match' in r ? r.match : fetched} matchPending={!practiceRow && fetched === undefined} own={mine} minions={r.board?.minions} skins={skins}
      runes={r.runes} runeLive={runeLiveStateOfSnapshot(r.board)}
      replay={!practice || watchable ? {
        watchable, busy, unplayable, onWatch: (e) => onWatch(e, r, key),
        label: watchable ? `Watch ${r.author || 'this player'}'s game` : 'No replay stored for this game',
      } : null}
      career={r.userId ? { disabled: opening, onOpen: () => onOpen(r, key), label: `View ${r.author || 'this player'}'s Career` } : null}
    />
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
  if (p.state !== 'ready') return <StateBody state={p.state} tab="duos" signedOut={p.state === 'signedout'} onRetry={p.onRetry} />;
  if (p.duosRows.length === 0) return <StateBody state="empty" tab="duos" onRetry={p.onRetry} />;
  const sel = p.duosRows.find((r) => r.matchId === p.picked) ?? p.duosRows[0]!;
  return (
    <div className="rgp-split">
      <GameList items={items} selected={sel.matchId} onPick={p.onPick} label="Your Duos games" />
      <div className="rgp-detailcol rgp-duos"><DuosGameCard key={sel.matchId} row={sel} myId={p.myId} /></div>
    </div>
  );
}
