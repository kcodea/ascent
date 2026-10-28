import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunCosmeticSnapshot } from '@game/progression';
import type { MatchDetails } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { getHero, runeLiveStateOfSnapshot, strengthText } from '@game/sim';
import { SHOW_LOBBY_STRENGTH } from './lobbyStrengthDisplay';
import { GAME_STRENGTH_LABEL, GAME_STRENGTH_TIP } from './matchDetails/matchDetailsText';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { useGame } from './store';
import { useSocial } from './socialCache';
import { GameSplit, type GameListItem } from './GameSplit';
import { GameRank } from './gameRank';
import { rankLabel } from './rank/types';
import { StoredTeam } from './StoredTeam';
import { SeatBoard, SeatRuneRow, useLobbyParts } from './matchDetails/LobbyPicker';
import { fetchPracticeGames, fetchPracticeReplay, fetchRecentGames, fetchRecentMatch, fetchPlayerById, fetchReplayPayload, remoteEnabled, type PracticeGameConfig, type PracticeGameRow, type RecentGameRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import { LbHeroFrame, LbRunes } from './LadderBits';
import { GameCard, bandOf, placeText } from './GameCard';
import { outcomeOf, partialText, playedAtText, recordText, runLengthText } from './leaderboardData';
import { heroPortrait, opponentSkins } from './skins/skins';
import { frameIdOf } from './portraitFrame/PortraitFrame';
import { HeroFilterChips } from './HeroFilterChips';
import { heroFilterCounts } from './heroFilter';

/**
 * Recent Games (owner ask 2026-08-11; polished 2026-09-20) — the last 100 finished games across ALL players (20, then 50, on 2026-10-16),
 * each as a chunky banner in the Career page's match-banner language: the circular hero frame + hero name +
 * player handle, the final board as 7 real card tiles, the run's runes as emblems + names, and the outcome
 * block — VICTORY / placement, date + time, the W–L record, the run length, a "Partial recording" caption
 * when the replay doesn't start at round 1 — with ONE button, WATCH REPLAY. A full-page overlay (sibling of
 * the Leaderboard / Hall of Champions), read from the public `run_telemetry` table (`fetchRecentGames`): the
 * list pulls light JSON-path facts only; the Watch click fetches THAT row's full payload
 * (`fetchReplayPayload`) and hands it to the viewer — `startReplay` closes this overlay, and exiting the
 * replay restores it. Clicking the banner itself opens that player's Career.
 *
 * TWO TABS (owner ask 2026-09-24: "can we add a practice tab to recent games, which shows the latest practice
 * mode games played?"), in the Career page's tab style: RANKED (the feed above, unchanged) and PRACTICE, the
 * last 20 finished practice games, read from their own `practice_games` table (`fetchPracticeGames`) so a
 * practice row can never reach the ladder's tables. A practice row is the same banner with the practice options
 * as facts (opponents with the bot level, health) and a Watch only when the row carries a replay (owner
 * 2026-09-27: practice games record replays from then on; older rows show no button); its banner opens the player's
 * Career on its default view (practice runs are not in the Career's match history, so there is no run to focus).
 * Each tab fetches when it is first shown and keeps its rows while the page stays open.
 */
/** How many games the feed lists (owner 2026-10-16: "allow up to 50 games", then "can recent games show last 100 games"). A plain
 *  PostgREST `.limit`, well under the 1000-row cap (R-NET-01); no RPC caps it. */
const FEED_ROWS = 100;

export type RecentGamesTab = 'ranked' | 'practice';

/** "Bots Lv 5" / "Players": the practice row's Opponents fact. */
export function practiceOpponentsText(cfg: PracticeGameConfig): string {
  return cfg.opponents === 'bots' ? `Bots Lv ${cfg.botDifficulty}` : 'Players';
}

/** The two feeds' cache keys + loaders (shared with the title's idle prefetch). */
export const RECENT_RANKED_KEY = 'recent:ranked';
export const RECENT_PRACTICE_KEY = 'recent:practice';
export const loadRecentRanked = (): Promise<RecentGameRow[]> => fetchRecentGames(FEED_ROWS);
export const loadRecentPractice = (): Promise<PracticeGameRow[]> => fetchPracticeGames(FEED_ROWS);

/** A feed row (ranked or practice). */
type FeedRow = RecentGameRow | PracticeGameRow;

/** The SUMMARY over the games shown (Valorant / League put this over their history): count, average placement, top-4
 *  rate, wins, the most-played hero and the most common tribe on the final boards, plus a placement sparkline. */
export function summaryOf(rows: readonly FeedRow[]): {
  games: number; avgPlace: number | null; top4: number | null; wins: number;
  hero: { id: string; n: number } | null; tribe: { id: string; n: number } | null; places: number[];
} {
  const placed = rows.filter((r) => r.placement !== null && r.placement > 0).map((r) => r.placement!);
  const heroN = new Map<string, number>();
  const tribeN = new Map<string, number>();
  for (const r of rows) {
    if (r.heroId) heroN.set(r.heroId, (heroN.get(r.heroId) ?? 0) + 1);
    for (const m of r.board?.minions ?? []) {
      const t = CARD_INDEX[m.cardId]?.tribe;
      if (t && t !== 'neutral') tribeN.set(t, (tribeN.get(t) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>): { id: string; n: number } | null => {
    let best: { id: string; n: number } | null = null;
    for (const [id, n] of m) if (!best || n > best.n) best = { id, n };
    return best;
  };
  return {
    games: rows.length,
    avgPlace: placed.length ? placed.reduce((a, b) => a + b, 0) / placed.length : null,
    top4: placed.length ? placed.filter((p) => p <= 4).length / placed.length : null,
    wins: placed.filter((p) => p === 1).length,
    hero: top(heroN),
    tribe: top(tribeN),
    // Oldest first, so the line reads left to right in time (the feed is newest first).
    places: [...rows].reverse().map((r) => r.placement).filter((p): p is number => p !== null && p > 0),
  };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function Summary({ rows, practice }: { rows: readonly FeedRow[]; practice: boolean }) {
  const s = useMemo(() => summaryOf(rows), [rows]);
  // THE PLACEMENT CHART (2026-10-16 polish): every game a mark on a 1st (top) to 8th axis, in its band colour AND shape
  // (1st a gold diamond, top 4 a green dot, 5th-8th a red ring), a thin line joining them, the 4.5 split dashed.
  const W = 520; const H = 120; const L = 30; const R = 8; const T = 10; const B = 10;
  const n = s.places.length;
  const x = (i: number): number => (n <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (p: number): number => T + ((p - 1) * (H - T - B)) / 7;
  const line = n > 1 ? s.places.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ') : '';
  return (
    <section className="rg-summary" aria-label={practice ? 'The latest practice games at a glance' : 'The latest games at a glance'}>
      <div className="rg-sum-stats">
        <div className="rg-sum-stat"><span className="rg-sum-v">{s.games}</span><span className="rg-sum-l">Games</span></div>
        <div className="rg-sum-stat"><span className="rg-sum-v">{s.avgPlace === null ? '-' : s.avgPlace.toFixed(1)}</span><span className="rg-sum-l">Avg placement</span></div>
        <div className="rg-sum-stat"><span className="rg-sum-v">{s.top4 === null ? '-' : `${Math.round(s.top4 * 100)}%`}</span><span className="rg-sum-l">Top 4</span></div>
        <div className="rg-sum-stat"><span className="rg-sum-v won">{s.wins}</span><span className="rg-sum-l">Wins</span></div>
      </div>
      <div className="rg-sum-hero">
        {s.hero && <LbHeroFrame heroId={s.hero.id} />}
        <span className="rg-sum-txt">
          <span className="rg-sum-l">Most played</span>
          <span className="rg-sum-name">{s.hero ? getHero(s.hero.id).name : '-'}</span>
          <span className="rg-sum-sub">{s.hero ? `${s.hero.n} ${s.hero.n === 1 ? 'game' : 'games'}` : ''}{s.tribe ? ` · Top tribe ${cap(s.tribe.id)}` : ''}</span>
        </span>
      </div>
      <div className="rg-sum-chart">
        <span className="rg-sum-l">Placements, oldest to newest</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid meet" role="img" aria-label={`Placements of the last ${n} games`}>
          {[1, 4, 8].map((p) => <text key={p} className="rg-ax" x={L - 8} y={y(p) + 4} textAnchor="end">{placeText(p)}</text>)}
          <line className="rg-spark-mid" x1={L} x2={W - R} y1={y(4.5)} y2={y(4.5)} />
          {line && <polyline className="rg-spark" points={line} />}
          {s.places.map((p, i) => {
            const band = bandOf(p);
            // Marks thin out as the feed grows (100 games since 2026-10-16), so the line stays readable.
            const d = n > 60 ? 2.6 : 4;
            return band === 'won'
              ? <rect key={i} className="rg-pt won" x={x(i) - d} y={y(p) - d} width={d * 2} height={d * 2} transform={`rotate(45 ${x(i)} ${y(p)})`} />
              : <circle key={i} className={`rg-pt ${band}`} cx={x(i)} cy={y(p)} r={n > 60 ? 2.2 : n > 30 ? 3 : band === 'top4' ? 4 : 3.5} />;
          })}
        </svg>
      </div>
    </section>
  );
}

interface CardProps {
  r: FeedRow; rowKey: string; practice: boolean; mine: boolean; skins: RunCosmeticSnapshot | null;
  busy: boolean; unplayable: boolean; opening: boolean;
  onOpen: (r: FeedRow, key: string) => void; onWatch: (e: React.MouseEvent, r: FeedRow, key: string) => void;
}

/** The selected game as the shared GameCard in its detail layout (GameSplit's right panel; owner 2026-10-16, layout B).
 *  The same card the Career's Match History shows: board strip (`StoredTeam`), runes inline with the actions, one
 *  meta line, and the lobby standings under it when the game recorded them. */
const FeedCard = memo(function FeedCard({ r, rowKey, practice, mine, skins, busy, unplayable, opening, onOpen, onWatch }: CardProps) {
  const cfg = 'practice' in r ? r.practice : null;
  const hero = r.heroId ? getHero(r.heroId) : null;
  const o = outcomeOf(r.placement);
  const watchable = r.hasReplay && r.rowId != null;
  const when = playedAtText(r.createdAt);
  const length = runLengthText(r.durationMs, r.lengthOverCap);
  const record = r.record ? recordText(r.record) : `${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`;
  // A practice row carries its lobby; a ranked row's standings live on the player's career row, loaded on demand when
  // the game opens (fetchRecentMatch: two one-row reads, cached). Until they land, or when none were recorded, the
  // card simply has no lobby section.
  const [fetched, setFetched] = useState<MatchDetails | null>(null);
  const practiceRow = 'match' in r;
  useEffect(() => {
    if (practiceRow) return undefined;
    let live = true;
    void fetchRecentMatch(r.rowId, r.userId).then((m) => { if (live) setFetched(m); });
    return () => { live = false; };
  }, [practiceRow, r.rowId, r.userId]);
  const match = 'match' in r ? r.match : fetched;
  // THE LOBBY PICKER: shown when this game recorded its lobby (practice games today; ranked once its standings load).
  const lp = useLobbyParts(match, mine);
  return (
    <GameCard
      as="div"
      place={r.placement}
      label={o.label === 'VICTORY' ? 'Victory' : `${o.label.toLowerCase()} place`}
      resultClass={`lb-verdict ${o.cls}`}
      className={`lb-row rg-card gc-detail${r.partial ? ' partial' : ''}`}
      rootProps={{ 'aria-label': `${r.author || 'Unnamed player'}, ${hero?.name ?? 'Unknown hero'}: ${o.label}` }}
      hero={<LbHeroFrame heroId={r.heroId} side={mine ? 'self' : 'opp'} art={heroPortrait(r.heroId, skins)} frameId={frameIdOf(skins)} />}
      title={<span className="lb-row-name">{r.author || 'Unnamed player'}</span>}
      subtitle={<span className="lb-row-herosub">{hero?.name ?? 'Unknown hero'}</span>}
      record={<span className={`lb-row-record ${r.record ? (r.record.wins >= r.record.losses ? 'won' : 'lost') : 'none'}`}>{record}</span>}
      rank={!practice && 'rank' in r && r.rank != null ? <GameRank divisionIndex={r.rank} /> : undefined}
      lobby={lp.lobby}
      boardKey={lp.boardKey}
      board={lp.seat ? <SeatBoard seat={lp.seat} own={mine} /> : r.board && r.board.minions.length > 0
        ? <StoredTeam minions={r.board.minions} skins={skins} />
        : <div className="lb-team-none">{r.hasReplay ? 'No board recorded' : 'No board recorded for this game'}</div>}
      runes={lp.seat ? <SeatRuneRow seat={lp.seat} /> : <LbRunes runes={r.runes} live={runeLiveStateOfSnapshot(r.board)} empty="No runes taken" />}
      actions={<>
        {(!practice || watchable) && (
          <button
            type="button"
            className="lb-btn lb-watch pressable"
            onClick={(e) => onWatch(e, r, rowKey)}
            disabled={!watchable || busy || unplayable}
            aria-label={watchable ? `Watch ${r.author || 'this player'}'s game` : 'No replay stored for this game'}
          >
            <Icon name="eye" />{busy ? 'Loading…' : unplayable ? 'No replay' : watchable ? 'Replay' : 'No replay'}
          </button>
        )}
        {/* The player's Career (the whole banner did this in the old list layout). */}
        {r.userId && (
          <button type="button" className="lb-btn lb-career pressable" onClick={() => onOpen(r, rowKey)} disabled={opening} aria-label={`View ${r.author || 'this player'}'s Career`}>
            Career<span className="lb-go" aria-hidden="true">›</span>
          </button>
        )}
      </>}
      meta={<div className="lb-facts">
        {when && <span className="lb-fact lb-fact-when"><span className="lb-when">{when}</span></span>}
        <span className="lb-fact"><span className="lb-fact-l">Length</span><span className="lb-fact-v">{length}</span></span>
        {r.wave !== null && <span className="lb-fact"><span className="lb-fact-l">Rounds</span><span className="lb-fact-v">{r.wave}</span></span>}
        {cfg && <span className="lb-fact"><span className="lb-fact-l">Opponents</span><span className="lb-fact-v">{practiceOpponentsText(cfg)}</span></span>}
        {cfg && <span className="lb-fact"><span className="lb-fact-l">Health</span><span className="lb-fact-v">{cfg.health === 'normal' ? 'Normal' : 'Unlimited'}</span></span>}
        {SHOW_LOBBY_STRENGTH && r.lobbyStrength && <span className="lb-fact"><span className="lb-fact-l">Lobby</span><span className="lb-fact-v lb-fact-lobby" aria-label={`Lobby strength ${r.lobbyStrength.value} percent`}>{strengthText(r.lobbyStrength)}</span></span>}
        {/* BOARD STRENGTH (R-LOBBY-09): frozen when the game ended; nothing at all when it was not scored. */}
        {r.boardStrength != null && <span className="lb-fact gtip" data-tip={GAME_STRENGTH_TIP}><span className="lb-fact-l">{GAME_STRENGTH_LABEL}</span><span className="lb-fact-v lb-fact-bstrength" aria-label={`${GAME_STRENGTH_LABEL} ${r.boardStrength} out of 100`}>{r.boardStrength}</span></span>}
        {r.partial && <span className="lb-fact lb-partial"><Icon name="clock" />{partialText(r.firstRecordedWave)}</span>}
      </div>}
      extra={lp.extra}
    />
  );
});

export function RecentGames(): JSX.Element | null {
  const show = useGame((s) => s.showRecentGames);
  const openCareer = useGame((s) => s.openCareer);
  const myId = useGame((s) => s.account.userId);
  const showOppCosmetics = useGame((s) => s.showOpponentSkins);
  const [tab, setTab] = useState<RecentGamesTab>('ranked');
  // Each tab's list is cached across opens (socialCache.ts): it reads the first time the tab is shown, a revisit paints
  // the last list at once and refreshes behind it when stale, and switching back and forth never flashes a spinner.
  const rows = useSocial<RecentGameRow[]>(show && tab === 'ranked' ? RECENT_RANKED_KEY : null, loadRecentRanked) ?? null;
  const practiceRows = useSocial<PracticeGameRow[]>(show && tab === 'practice' ? RECENT_PRACTICE_KEY : null, loadRecentPractice) ?? null;
  const [opening, setOpening] = useState<string | null>(null); // row key currently being opened
  const [watching, setWatching] = useState<string | null>(null); // row key whose replay payload is loading
  const [noReplay, setNoReplay] = useState<string | null>(null); // row key whose payload came back unplayable
  const [heroFilter, setHeroFilter] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // the game open in the detail panel (null = the newest)

  // Every open starts on RANKED (reset on close, so a reopen never reads the practice feed for a frame first).
  useEffect(() => {
    if (!show) { setTab('ranked'); setHeroFilter(null); setPicked(null); }
  }, [show]);

  const practice = tab === 'practice';
  const all: FeedRow[] | null = practice ? practiceRows : rows;
  const shown = useMemo(() => (all && heroFilter ? all.filter((r) => r.heroId === heroFilter) : all), [all, heroFilter]);
  const keyOf = useCallback((r: FeedRow, i: number): string => `${tab}-${r.rowId ?? r.author ?? '?'}-${r.createdAt ?? ''}-${i}`, [tab]);
  // The hero filter: every hero in this feed with its game count, most played first (HeroFilterChips shows as many as
  // fit on one line as chips, the rest behind "More"). Memoised on the feed, so a pick or a hover never recounts.
  const heroCounts = useMemo(() => heroFilterCounts(all), [all]);
  const pickHero = useCallback((id: string | null): void => { setHeroFilter(id); setPicked(null); }, []);

  // Open the clicked game inside the player's Career, expanded to that run. The Career header wants a
  // rating / games-played that the feed row doesn't carry, so pull the player's profile first (best-effort —
  // an absent profile just opens with the name we have). The same fetch brings their medal rank, so the
  // Seasonal Ranked card paints the crest + bar at once. `focus` pins WHICH run to expand + scroll to.
  // Stable (refs to the latest state): the memoised cards never re-render because a callback changed identity.
  const live = useRef({ opening, watching, practice, openCareer });
  live.current = { opening, watching, practice, openCareer };
  const onOpen = useCallback((r: FeedRow, key: string): void => {
    const L = live.current;
    if (!r.userId || L.opening) return;
    sfx.pulse();
    setOpening(key);
    void fetchPlayerById(r.userId).catch(() => null).then((p) => {
      L.openCareer({
        userId: r.userId!,
        author: p?.author || r.author || '',
        rating: p?.rating ?? 0,
        gamesPlayed: p?.gamesPlayed ?? 0,
        favoriteHero: p?.favoriteHero,
        ...(p?.rank ? { rank: p.rank } : {}),
        ...(p?.avatar ? { avatar: p.avatar } : {}),
        ...(!L.practice ? { focus: { heroId: r.heroId, wins: r.wins, placement: r.placement, createdAt: r.createdAt } } : {}),
      });
      setOpening(null);
    });
  }, []);

  // Watch the row's recorded run — fetch its full v2 payload (only now: the list stayed light) and hand it to
  // the viewer. The click is stopped from bubbling to the banner (which opens the Career). If the payload turns
  // out unplayable (deleted / malformed), the button degrades to "No replay" instead of a broken viewer.
  const onWatch = useCallback((e: React.MouseEvent, r: FeedRow, key: string): void => {
    e.stopPropagation();
    if (r.rowId == null || live.current.watching) return;
    sfx.pulse();
    setNoReplay(null);
    setWatching(key);
    // A practice row's replay lives on its own table (`practice_games.replay`), a ranked row's on run_telemetry.
    void ('practice' in r ? fetchPracticeReplay(r.rowId) : fetchReplayPayload(r.rowId))
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: r.author || undefined, authorId: r.userId ?? null });
        else setNoReplay(key);
      })
      .finally(() => setWatching(null));
  }, []);

  if (!show) return null;
  const pickTab = (t: RecentGamesTab): void => { if (t === tab) return; setTab(t); setHeroFilter(null); setPicked(null); };
  // The skin + portrait frame RECORDED with the game's final board (owner 2026-10-16): your own game always, everyone
  // else's through "Show opponent cosmetics". No recorded cosmetics = the hero's own art in the default ring.
  const skinsOf = (r: FeedRow): { mine: boolean; skins: RunCosmeticSnapshot | null } => {
    const mine = !!myId && r.userId === myId;
    return { mine, skins: mine ? (r.board?.cosmetics ?? null) : opponentSkins(showOppCosmetics, r.board?.cosmetics) };
  };
  const card = (r: FeedRow, key: string): JSX.Element => {
    const { mine, skins } = skinsOf(r);
    return (
      <FeedCard r={r} rowKey={key} practice={practice} mine={mine} skins={skins}
        busy={watching === key} unplayable={noReplay === key} opening={opening === key} onOpen={onOpen} onWatch={onWatch} />
    );
  };

  let body: JSX.Element;
  if (!remoteEnabled()) body = <div className="lbempty lb-state"><Icon name="gear" /><div>Recent games unavailable. No backend configured.</div></div>;
  else if (shown === null) body = <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>{practice ? 'Gathering the latest practice games…' : 'Gathering the latest games…'}</div></div>;
  else if ((all ?? []).length === 0) {
    body = practice
      ? <div className="lbempty lb-state"><Icon name="target" /><div>No practice games yet. Finish a practice game to see it here.</div></div>
      : <div className="lbempty lb-state"><Icon name="clock" /><div>No recordings yet. Finish a run to seed the feed.</div></div>;
  } else {
    const keyed = shown.map((r, i) => ({ r, key: keyOf(r, i) }));
    const sel = keyed.find((k) => k.key === picked) ?? keyed[0];
    // LAYOUT B (owner 2026-10-16): the compact list + the one selected game in full (GameSplit.tsx). Only the selected
    // game's board mounts, so the 50 light rows need no lazy mounting.
    const items: GameListItem[] = keyed.map(({ r, key }) => {
      const { mine, skins } = skinsOf(r);
      const heroName = r.heroId ? getHero(r.heroId).name : 'Unknown hero';
      // The rank the game was played at (R-GAME-RANK-01): ranked rows only; Practice is unranked.
      const rank = !practice && 'rank' in r ? r.rank ?? null : null;
      return {
        key, place: r.placement, title: r.author || 'Unnamed player', sub: heroName, when: playedAtText(r.createdAt) || undefined, rank,
        label: `${placeText(r.placement)}, ${r.author || 'Unnamed player'}, ${heroName}${rank != null ? `, played at ${rankLabel(rank)}` : ''}`,
        portrait: <LbHeroFrame heroId={r.heroId} side={mine ? 'self' : 'opp'} art={heroPortrait(r.heroId, skins)} frameId={frameIdOf(skins)} />,
      };
    });
    body = (
      <GameSplit
        className={`rg-split${practice ? ' rg-practice' : ''}`}
        items={items} selected={sel?.key ?? null} onPick={setPicked}
        label={practice ? 'Latest practice games' : 'Latest games'}
        detail={sel ? card(sel.r, sel.key) : null}
      />
    );
  }

  return (
    <SidebarHost className="lbpage lb-ladder rg-page">
      <MenuSidebar current="recent" />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="clock" />
          <div>
            <div className="esch disp">Recent Games</div>
            <div className="lbsub">{practice ? `The last ${FEED_ROWS} practice games across every player` : `The last ${FEED_ROWS} games across every player`}</div>
          </div>
        </div>
      </div>
      <div className="lbscroll">
        {shown && shown.length > 0 && <Summary rows={shown} practice={practice} />}
        {/* ONE FILTER BAR (2026-10-16 polish): the Ranked / Practice feed and the hero chips together. */}
        <div className="rg-filterbar">
          <div className="cv2-tabs rg-tabs" role="tablist" aria-label="Recent games view">
            <button type="button" role="tab" className={`cv2-tab${tab === 'ranked' ? ' on' : ''}`} aria-selected={tab === 'ranked'} onClick={() => pickTab('ranked')}>
              <Icon name="crown" />Ranked
            </button>
            <button type="button" role="tab" className={`cv2-tab${practice ? ' on' : ''}`} aria-selected={practice} onClick={() => pickTab('practice')}>
              <Icon name="target" />Practice
            </button>
          </div>
          <HeroFilterChips counts={heroCounts} value={heroFilter} onChange={pickHero} />
        </div>
        {body}
      </div>
    </SidebarHost>
  );
}
