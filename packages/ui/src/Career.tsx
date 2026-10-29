import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GameSplit, type GameListItem } from './GameSplit';
import { GameRank } from './gameRank';
import { SeatBoard, SeatRuneRow, useLobbyParts } from './matchDetails/LobbyPicker';
import { RUNE_INDEX } from '@game/content';
import { getHero, runeLiveStateOfSnapshot, strengthText } from '@game/sim';
import { SHOW_LOBBY_STRENGTH } from './lobbyStrengthDisplay';
import type { BoardSnapshot } from '@game/sim';
import { StoredTeam } from './StoredTeam';
import { GameCard, placeText } from './GameCard';
import { TrendsBody } from './careerTrends';
import { avatarSrc } from './art';
import { GAME_STRENGTH_LABEL, GAME_STRENGTH_TIP, NO_DETAILS_TEXT } from './matchDetails/matchDetailsText';
import { RuneEmblem } from './RuneEmblem';
import { heroPortrait, opponentSkins } from './skins/skins';
import type { RunCosmeticSnapshot } from '@game/progression';
import { Icon } from './Icon';
import { HeroPortraitRing } from './portraitFrame/HeroPortraitRing';
import { frameIdOf } from './portraitFrame/PortraitFrame';
import { recordText } from './leaderboardData';
import { sfx } from './sfx';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { refuseInGame } from './gameMenuParts';
import { AddFriendButton } from './friends/AddFriendButton';
import { useGame, syncProfileFromServer, tempHandle, type CareerFocus } from './store';
import { CareerDuosTeams } from './versus/DuosBoards';
import { fetchMyPracticeGames, fetchPracticeReplay, fetchPlayerById, fetchReplayPayload, fetchRunBoards, fetchRunDetails, remoteEnabled, type PracticeGameConfig, type PracticeGameRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import type { RunHistoryRowLike } from './careerData';
import { careerFresh, careerKeyUser, carryTelemetry, loadCareer } from './careerLoad';
import { RankCard } from './rank/RankCard';
import { cosmeticOf, isMasterTitle, levelProgress, titleName } from '@game/progression';
import { TitleBadge } from './titles/TitleBadge';
import { AccountLevelCard, useCareerProgression } from './progression/AccountLevel';
import { AchievementsTab } from './progression/AchievementsTab';
import { achievementsVisible, useProgression } from './progression/progressionStore';
import { rankLabel, rankScalar } from './rank/rankFormat';
import { rankPositionOf, type RankedProfile } from './rank/types';
import {
  HERO_SORTS, HERO_SORT_LABEL, TREND_WINDOWS, TRIBE_LABEL, careerAggregates, heroCareers, matchResultOf, outcomeOf, playedOnText, runLengthText,
  runsOfHero, sortHeroCareers, trendSeries, trendWindowLabel, withRunDetails, type CareerRun, type HeroCareer, type HeroSort, type TrendWindow,
} from './careerData';

/**
 * CAREER (owner rebuild 2026-09-19/20) — three columns on the game's page backdrop, after the Battlegrounds-style
 * mockup:
 *
 *  LEFT    the most-played hero in the SAME circular frame the recruit screen wears (the `.hero > .f >
 *          .heroimg` markup + rules from StatusBar, re-seated here without the tray transforms), its name
 *          plate, and five stat tiles — 1st Place Wins · Top 4 Finish · Losses · Avg Placement · Favorite Tribe
 *          (Losses = bottom-4 finishes, the count of match losses; owner ask 2026-09-21).
 *  CENTRE  three tabs in the column header (MATCH HISTORY | HEROES | PRACTICE, the choice persisted per browser):
 *          Match History — the account's last 50 runs FROM THE SERVER (`fetchMyRuns`; never local-only runs),
 *          each a TALL BANNER that reads top to bottom (owner 2026-09-20: "chunky and fully readable"):
 *            head   hero portrait + name + the MATCH result (WIN / LOSS — by placement, see below; the fight
 *                   record only as a small caption) ‖ the outcome block (VICTORY / placement, date · length · Gold)
 *            team   the final team as 7 full-size card tiles (the real `Card`, sized like the leaderboard's; no
 *                   label — it collided with the gilded crown / tier stars, owner 2026-09-20)
 *            foot   the run's rune selections as emblems + names (hover = the rune's text) ‖ ONE button,
 *                   WATCH REPLAY, live only when a telemetry replay exists.
 *          Heroes — every hero the account has played (folded over ALL the fetched runs, not just the 25
 *          banners) as a PORTRAIT GRID (owner 2026-09-20): each hero in the game's circular frame with its name
 *          and "N games played", Top 4 %, average placement and Net MMR on the card, sortable by games played /
 *          average placement / Net MMR. No hover panel (owner 2026-10-23); CLICKING a hero opens Match History
 *          filtered to that hero's games (a removable hero chip + Back to Heroes). No per-hero rows.
 *          Practice (owner ask 2026-09-27: "add practice games as a tab in the career as well so players can see
 *          practice games they played ... the practice bot games should include the bot level"): the career
 *          owner's finished practice games from their own `practice_games` table (`fetchMyPracticeGames`, by
 *          user id; never mixed into the runs above, which stay ladder-only), each the SAME banner as Match
 *          History with the practice options as pills ("Bots · Level N" / "Players", "Unlimited HP" / "Normal
 *          HP") beside the Watch button. WATCH REPLAY (owner 2026-09-27, "okay go ahead and do it") only on a
 *          row that carries a replay (`hasReplay`: games finished after the `replay` column landed); an older
 *          row shows the pills alone, never a dead button. Read the first time the tab is shown for that
 *          player, then kept while the page stays open.
 *          Only this column scrolls; the side columns stay put. All three columns share one header row
 *          (`.cv2-colhead`), so their panels start level.
 *  RIGHT   Seasonal Ranked — the MEDAL RANK as the shared `RankBar` (crest, bar, points, name; the scalar as a
 *          caption), for your own profile AND for a viewed player (their rank rides in on `careerOf.rank` from
 *          the entry point, or is fetched here by user id; owner 2026-09-21) — the bare number only when no
 *          rank can be sourced — and Performance Trends: MMR · Avg Placement · Win Rate · Avg APM as inline-SVG
 *          lines over a 7 / 30 / 90-day or All-time window (owner ask 2026-09-22). MMR comes FIRST: it sits
 *          right under the crest whose caption prints the same scalar, so the eye reads crest → number → line,
 *          and the three rates that explain it follow.
 *
 * A MATCH WIN IS BY PLACEMENT (owner ruling 2026-09-20): top 4 = W, 5th–8th = L (`isMatchWin`). Fights are no
 * longer the unit anywhere on this page — the banner's result, the Heroes grid's record + win rate and the Win
 * Rate trend (the share of placed runs finishing top 4) all read this way.
 *
 * Every number comes from `careerData.ts` (pure, tested). The fetch is cached on the store so reopening
 * paints at once and refreshes behind; a finished run or a career reset bumps `careerVersion` and refetches.
 * Read-only; opened by the title's Career button (and by the leaderboard / Recent Games for another player).
 */

/** Which centre tab is open, persisted per browser (owner ask 2026-09-20). */
const TAB_KEY = 'ascent.career.tab';
type CenterTab = 'history' | 'heroes' | 'practice' | 'achievements';
function loadTab(): CenterTab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'heroes' || t === 'practice' || t === 'achievements' ? t : 'history';
  } catch { return 'history'; }
}
function saveTab(t: CenterTab): void {
  try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable — the choice just doesn't persist */ }
}
/** Banners in Match History (and the Practice tab): the newest 50 server runs (owner 2026-10-16 "career to 50 too"; was 25,
 *  and 10 before 2026-09-20). Matches `CAREER_DETAIL_ROWS`, the rows fetched WITH their boards. */
const MATCH_ROWS = 50;

/**
 * SKINS on a Career page (2026-09-28). Whose page it is decides the toggle: YOUR page shows your skins as recorded
 * (never filtered: "this is an opponent toggle only"); SOMEONE ELSE's shows theirs through "Show opponent skins".
 * `loadout` is the page owner's CURRENT loadout (the favourite-hero portrait + the hero tiles); a match row always
 * shows the skins RECORDED on that run's board, never the current loadout.
 */
const CareerSkinContext = createContext<{ own: boolean; loadout: RunCosmeticSnapshot | null }>({ own: true, loadout: null });
function useCareerSkins(snapshot: RunCosmeticSnapshot | null | undefined): RunCosmeticSnapshot | null {
  const { own } = useContext(CareerSkinContext);
  const show = useGame((s) => s.showOpponentSkins);
  return own ? snapshot ?? null : opponentSkins(show, snapshot);
}

/** The in-run hero frame, re-seated: the same `.hero > .f > img.heroimg` markup StatusBar renders (so the
 *  ring, disc and portrait rules are shared), scoped under `.cv2-heroframe` which only undoes the tray's
 *  transforms. `small` is the match-row portrait. `skins` = the skins to paint it with (see CareerSkinContext). */
function HeroFrame({ heroId, small, skins }: { heroId: string; small?: boolean; skins?: RunCosmeticSnapshot | null }) {
  const shown = useCareerSkins(skins);
  const art = heroPortrait(heroId, shown);
  const name = heroId ? getHero(heroId).name : '';
  // The portrait frame in the same snapshot (owner 2026-10-01: a match row the frame RECORDED on that run, the page
  // portrait the owner's current one), through the page's own/opponent rule; none = the tuner's ring, where your own
  // Career wears YOUR frame and someone else's Career wears the opponents' frame.
  return <HeroPortraitRing art={art} alt={name} small={small} side={useContext(CareerSkinContext).own ? 'self' : 'opp'} frameId={frameIdOf(shown)} />;
}

/** THE PLAYER'S PORTRAIT on their Career (owner 2026-10-16: "the chosen profile art should be displayed"): their
 *  CHOSEN profile picture in their frame, your own always, someone else's through "Show opponent cosmetics". With no
 *  chosen picture (or before the profiles.avatar migration) the favourite hero stands in, as before. */
function ProfilePortrait({ avatar, heroId, loadout }: { avatar: string | null | undefined; heroId: string; loadout: RunCosmeticSnapshot | null | undefined }) {
  const { own } = useContext(CareerSkinContext);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const shown = useCareerSkins(loadout);
  const pic = avatar && (own || showOpp) ? avatarSrc(avatar) : undefined;
  if (!pic) return <HeroFrame heroId={heroId} skins={loadout} />;
  return <HeroPortraitRing art={pic} alt="Profile picture" side={own ? 'self' : 'opp'} frameId={own ? undefined : frameIdOf(shown)} />;
}

/** The final team: the shared stored-board renderer, wearing the skins RECORDED on this board (an old board has
 *  none: default art), through the page's own/opponent rule. */
function FinalTeam({ board }: { board: BoardSnapshot }) {
  const skins = useCareerSkins(board.cosmetics);
  return <StoredTeam minions={board.minions} skins={skins} />;
}

/** A labelled small-caps stat with a big value — the left column's tiles. */
function StatTile({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="cv2-stat">
      {icon && <span className="cv2-stat-ico"><Icon name={icon} /></span>}
      <span className="cv2-stat-v">{value}</span>
      <span className="cv2-stat-l">{label}</span>
    </div>
  );
}


/** Which match row a Recent-Games click meant: the same-hero run nearest in time to the game's `createdAt`
 *  (run_history and run_telemetry stamp the same end time within seconds). -1 = no focus / no match. */
function focusIndexOf(runs: readonly CareerRun[], f: CareerFocus | undefined): number {
  if (!f) return -1;
  const ft = f.createdAt ? Date.parse(f.createdAt) : NaN;
  let best = -1, bestScore = Infinity;
  runs.forEach((r, i) => {
    if (i >= MATCH_ROWS || r.heroId !== f.heroId) return;
    const score = Number.isFinite(ft) && Number.isFinite(r.atMs) ? Math.abs(r.atMs - ft) : (r.wins === f.wins ? 0.5 : 1) * 1e15;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** A designed whole-page state (loading / offline / signed-out / no backend): an icon, a headline, a line of
 *  help and at most one action — never a bare string. */
function PageState({ icon, title, body, action, busy, className }: {
  icon: string; title: string; body: string; action?: { label: string; onClick: () => void }; busy?: boolean; className?: string;
}) {
  return (
    <div className={`cv2-state${className ? ` ${className}` : ''}`} role={busy ? 'status' : undefined} aria-busy={busy || undefined}>
      <div className={`cv2-state-ico${busy ? ' spin' : ''}`}><Icon name={icon} /></div>
      <div className="cv2-state-title">{title}</div>
      <div className="cv2-state-body">{body}</div>
      {action && <button type="button" className="cv2-btn pressable" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** One match banner. Memoised (perf 2026-10-09): a trend-window click or a Watch press re-renders the page, never the
 *  25 banners' 175 cards; `onWatch` is the page's stable callback and gets the run back. */
const MatchRow = memo(function MatchRow({ run, focus, busy, unplayable, onWatch }: {
  run: CareerRun; focus: boolean; busy: boolean; unplayable: boolean; onWatch: (run: CareerRun) => void;
}) {
  const o = outcomeOf(run.placement);
  const result = matchResultOf(run.placement);
  const when = playedOnText(run.atMs);
  const length = runLengthText(run.durationMs, run.lengthOverCap);
  const watchable = run.replayRowId !== null;
  const hasBoard = !!run.board && run.board.minions.length > 0;
  const runes = run.runes.filter((id) => RUNE_INDEX[id]);
  const runeLive = runeLiveStateOfSnapshot(run.board); // the run's FINAL value of its self-improving runes (R-RUNE-LIVE-TEXT-01)
  const fights = run.wins + run.losses + run.draws;
  // THE LOBBY PICKER (owner 2026-10-16): whose board the big board shows; yours by default.
  const { own } = useContext(CareerSkinContext);
  // A run not read in full yet (P1.3: the match details arrive when the game is opened) holds an empty slot, never
  // "no details", which would be wrong for a second.
  const lp = useLobbyParts(run.match, own, run.detailed ? <div className="cv2-lobby-none">{NO_DETAILS_TEXT}</div> : <div className="cv2-lobby-none" aria-busy="true" />);
  // THE GAME CARD (GameCard.tsx, 2026-10-16): the placement once, the hero + record, the board strip, runes and actions
  // at the side, and one quiet meta line. The match WIN / LOSS (top 4 or not) is the card's band colour now.
  return (
    <GameCard
      place={run.placement}
      label={result.cls === 'none' ? 'No placement recorded' : `${o.label === 'VICTORY' ? 'Victory' : o.label.toLowerCase()}, match ${result.label.toLowerCase()}`}
      resultClass={`cv2-verdict ${o.cls}`}
      className={`cv2-row gc-detail ${o.cls}${focus ? ' focus' : ''}`}
      rootProps={{ 'aria-label': `${run.heroId ? getHero(run.heroId).name : 'Run'}: ${o.label}` }}
      hero={<HeroFrame heroId={run.heroId} small skins={run.board?.cosmetics} />}
      title={<span className="cv2-row-heroname">{run.heroId ? getHero(run.heroId).name : '-'}</span>}
      record={fights > 0 ? (
        <span className="cv2-row-fights" aria-label={`Fights: ${run.wins} won, ${run.losses} lost${run.draws ? `, ${run.draws} drawn` : ''}`}>{recordText(run)}</span>
      ) : undefined}
      rank={run.rank != null ? <GameRank divisionIndex={run.rank} /> : undefined}
      lobby={lp.lobby}
      boardKey={lp.boardKey}
      board={lp.seat ? <SeatBoard seat={lp.seat} own={own} /> : <div className="cv2-row-team">{hasBoard ? <FinalTeam board={run.board!} /> : <div className="cv2-row-none">No final team recorded for this run.</div>}</div>}
      runes={lp.seat ? <SeatRuneRow seat={lp.seat} /> : runes.length > 0
        ? <div className="cv2-runes" aria-label="Runes picked this run">{runes.map((id, i) => <RuneEmblem runeId={id} live={runeLive} key={`${id}#${i}`} />)}</div>
        : <div className="cv2-row-none cv2-norunes">No runes recorded</div>}
      actions={<>
        <button
          type="button"
          className="cv2-btn cv2-watch pressable"
          disabled={!watchable || busy || unplayable}
          onClick={() => onWatch(run)}
          aria-label={watchable ? 'Watch this run’s replay' : 'No replay stored for this run'}
        >
          <Icon name="eye" />{busy ? 'Loading…' : unplayable ? 'No replay' : 'Replay'}
        </button>
      </>}
      meta={<div className="cv2-row-meta">
        <span className="cv2-meta"><span className="cv2-meta-l">Played</span><span className="cv2-meta-v cv2-row-when">{when || '-'}</span></span>
        <span className="cv2-meta"><span className="cv2-meta-l">Length</span><span className="cv2-meta-v cv2-row-length">{length}</span></span>
        {run.wave > 0 && <span className="cv2-meta"><span className="cv2-meta-l">Rounds</span><span className="cv2-meta-v cv2-row-rounds">{run.wave}</span></span>}
        <span className="cv2-meta"><span className="cv2-meta-l">Gold spent</span><span className="cv2-meta-v cv2-row-gold-v">{run.goldSpent === null ? '-' : run.goldSpent}</span></span>
        {/* The RATING CHANGE the run settled (green up, red down); nothing when it carries none. */}
        {run.ratingDelta != null && run.ratingDelta !== 0 && (
          <span className="cv2-meta"><span className="cv2-meta-l">Rating</span><span className={`cv2-meta-v cv2-row-delta ${run.ratingDelta > 0 ? 'up' : 'down'}`}>{run.ratingDelta > 0 ? `+${run.ratingDelta}` : `${run.ratingDelta}`}</span></span>
        )}
        {/* LOBBY STRENGTH (owner 2026-09-22), hidden for now behind SHOW_LOBBY_STRENGTH (owner 2026-09-30). */}
        {SHOW_LOBBY_STRENGTH && run.lobbyStrength && (
          <span className="cv2-meta"><span className="cv2-meta-l">Lobby</span><span className="cv2-meta-v cv2-row-lobby" aria-label={`Lobby strength ${run.lobbyStrength.value} percent`}>{strengthText(run.lobbyStrength)}</span></span>
        )}
        {/* BOARD STRENGTH (R-LOBBY-09): the run's percentile, frozen when it ended; nothing when it was not scored. */}
        {run.boardStrength != null && (
          <span className="cv2-meta gtip" data-tip={GAME_STRENGTH_TIP}><span className="cv2-meta-l">{GAME_STRENGTH_LABEL}</span><span className="cv2-meta-v cv2-row-bstrength" aria-label={`${GAME_STRENGTH_LABEL} ${run.boardStrength} out of 100`}>{run.boardStrength}</span></span>
        )}
      </div>}
      extra={lp.extra}
    />
  );
});

/** "Bots · Level 5" / "Players": the practice row's opponents pill. */
export function practiceOpponentsPill(cfg: PracticeGameConfig): string {
  return cfg.opponents === 'bots' ? `Bots · Level ${cfg.botDifficulty}` : 'Players';
}
/** "Unlimited HP" / "Normal HP": the practice row's health pill. */
export function practiceHealthPill(cfg: PracticeGameConfig): string {
  return cfg.health === 'normal' ? 'Normal HP' : 'Unlimited HP';
}

/** One practice banner (owner ask 2026-09-27): Match History's banner (hero + match result by placement + the
 *  fight record, the outcome block with date / length / rounds, the final team, the runes) with the practice
 *  options as pills, and WATCH REPLAY only when the row carries a replay (no disabled placeholder otherwise). */
function PracticeRow({ game, busy, unplayable, onWatch }: { game: PracticeGameRow; busy: boolean; unplayable: boolean; onWatch: () => void }) {
  const o = outcomeOf(game.placement);
  const result = matchResultOf(game.placement);
  const atMs = game.createdAt ? Date.parse(game.createdAt) : NaN;
  const when = playedOnText(atMs);
  const hasBoard = !!game.board && game.board.minions.length > 0;
  const runes = game.runes.filter((id) => RUNE_INDEX[id]);
  const runeLive = runeLiveStateOfSnapshot(game.board); // the game's FINAL value of its self-improving runes (R-RUNE-LIVE-TEXT-01)
  const rec = game.record;
  const fights = rec ? rec.wins + rec.losses + rec.draws : 0;
  const heroName = game.heroId ? getHero(game.heroId).name : '—';
  const cfg = game.practice;
  const { own } = useContext(CareerSkinContext);
  const lp = useLobbyParts(game.match, own, <div className="cv2-lobby-none">{NO_DETAILS_TEXT}</div>);
  return (
    <GameCard
      place={game.placement}
      label={result.cls === 'none' ? 'No placement recorded' : `${o.label === 'VICTORY' ? 'Victory' : o.label.toLowerCase()}, match ${result.label.toLowerCase()}`}
      resultClass={`cv2-verdict ${o.cls}`}
      className={`cv2-row cv2-prow gc-detail ${o.cls}`}
      rootProps={{ 'aria-label': `Practice, ${heroName}: ${o.label}` }}
      hero={<HeroFrame heroId={game.heroId} small skins={game.board?.cosmetics} />}
      title={<span className="cv2-row-heroname">{heroName}</span>}
      record={rec && fights > 0 ? (
        <span className="cv2-row-fights" aria-label={`Fights: ${rec.wins} won, ${rec.losses} lost${rec.draws ? `, ${rec.draws} drawn` : ''}`}>{recordText(rec)}</span>
      ) : undefined}
      lobby={lp.lobby}
      boardKey={lp.boardKey}
      board={lp.seat ? <SeatBoard seat={lp.seat} own={own} /> : <div className="cv2-row-team">{hasBoard ? <FinalTeam board={game.board!} /> : <div className="cv2-row-none">No final team recorded for this game.</div>}</div>}
      runes={lp.seat ? <SeatRuneRow seat={lp.seat} /> : runes.length > 0
        ? <div className="cv2-runes" aria-label="Runes picked this game">{runes.map((id, i) => <RuneEmblem runeId={id} live={runeLive} key={`${id}#${i}`} />)}</div>
        : <div className="cv2-row-none cv2-norunes">No runes recorded</div>}
      actions={<>
        {game.hasReplay && (
          <button
            type="button"
            className="cv2-btn cv2-watch pressable"
            disabled={busy || unplayable}
            onClick={onWatch}
            aria-label="Watch this practice game’s replay"
          >
            <Icon name="eye" />{busy ? 'Loading…' : unplayable ? 'No replay' : 'Replay'}
          </button>
        )}
      </>}
      meta={<div className="cv2-row-meta">
        <span className="cv2-meta"><span className="cv2-meta-l">Played</span><span className="cv2-meta-v cv2-row-when">{when || '-'}</span></span>
        <span className="cv2-meta"><span className="cv2-meta-l">Length</span><span className="cv2-meta-v cv2-row-length">{runLengthText(game.durationMs, game.lengthOverCap)}</span></span>
        <span className="cv2-meta"><span className="cv2-meta-l">Rounds</span><span className="cv2-meta-v cv2-row-rounds">{game.wave ?? '-'}</span></span>
        {cfg && <span className="cv2-meta cv2-ppills" aria-label="Practice options"><span className={`cv2-ppill${cfg.opponents === 'bots' ? ' bots' : ''}`}><Icon name={cfg.opponents === 'bots' ? 'gear' : 'taunt'} />{practiceOpponentsPill(cfg)}</span><span className="cv2-ppill"><Icon name="heart" />{practiceHealthPill(cfg)}</span></span>}
      </div>}
      extra={lp.extra}
    />
  );
}

/** One hero on the Heroes tab (owner 2026-09-20): the portrait in the game's circular frame, the name, "N games played"
 *  and the headline numbers (Top 4 %, average placement, Net MMR). No hover panel any more (owner 2026-10-23: "the
 *  mouseover tooltip here is pretty ugly and redundant info"): CLICKING (or Enter / Space, or a tap) opens Match History
 *  filtered to this hero's games so they can be watched back. Memoised: `onPick` is the page's stable callback. */
const HeroTile = memo(function HeroTile({ h, onPick }: { h: HeroCareer; onPick: (heroId: string) => void }) {
  const name = getHero(h.heroId).name;
  const careerLoadout = useContext(CareerSkinContext).loadout;
  const games = `${h.runs} game${h.runs === 1 ? '' : 's'} played`;
  const net = h.ratedGames > 0 ? h.netMmr : null;
  const netText = net === null ? '-' : net > 0 ? `+${net}` : `${net}`;
  return (
    <div
      className="cv2-hcard"
      role="button"
      tabIndex={0}
      aria-label={`${name}: ${games}. Show ${name} games`}
      onClick={() => onPick(h.heroId)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onPick(h.heroId);
      }}
    >
      <HeroFrame heroId={h.heroId} skins={careerLoadout} />
      <div className="cv2-hcard-name">{name}</div>
      <div className="cv2-hcard-games">{games}</div>
      <div className="cv2-hcard-stats" aria-hidden="true">
        <span className="cv2-hcard-stat"><b>{h.winRate === null ? '-' : `${h.winRate}%`}</b>Top 4</span>
        <span className="cv2-hcard-stat"><b>{h.avgPlacement === null ? '-' : h.avgPlacement}</b>Avg</span>
        <span className="cv2-hcard-stat cv2-hcard-net"><b className={net === null || net === 0 ? undefined : `cv2-row-delta ${net > 0 ? 'up' : 'down'}`}>{netText}</b>Net MMR</span>
      </div>
    </div>
  );
});

/** The Heroes grid's order, persisted per browser (owner 2026-10-23); games played when nothing is stored. */
const HERO_SORT_KEY = 'ascent.career.heroSort';
function loadHeroSort(): HeroSort {
  try {
    const v = localStorage.getItem(HERO_SORT_KEY);
    return v === 'avg' || v === 'mmr' ? v : 'games';
  } catch { return 'games'; }
}
function saveHeroSort(v: HeroSort): void {
  try { localStorage.setItem(HERO_SORT_KEY, v); } catch { /* storage unavailable: the choice just doesn't persist */ }
}

export function Career() {
  const show = useGame((s) => s.showCareer);
  const playerName = useGame((s) => s.playerName);
  const playerAvatar = useGame((s) => s.playerAvatar);
  const profile = useGame((s) => s.profile);
  const careerOf = useGame((s) => s.careerOf); // null = your own career
  const myId = useGame((s) => s.account.userId);
  const careerVersion = useGame((s) => s.careerVersion);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const cache = useGame((s) => s.careerCache);

  const viewing = careerOf;
  const userId = viewing?.userId ?? myId;
  const cacheKey = `${userId ?? ''}|${careerVersion}`;
  // `undefined` = loading; `null` = couldn't ask (no session / server unreachable); [] = no runs yet.
  const [loadedRuns, setRuns] = useState<CareerRun[] | null | undefined>(undefined);
  // The FIRST render of an open already shows the cached rows (this key's, else the same player's older answer), not
  // a loading frame waiting on the effect below to copy them in (perf 2026-10-09). `loadedRuns` is cleared on close.
  const cachedRuns = cache && userId && careerKeyUser(cache.key) === userId ? cache.runs : undefined;
  const runs = loadedRuns !== undefined ? loadedRuns : cachedRuns;
  const [fetchTick, setFetchTick] = useState(0); // the Retry button
  const [window_, setWindow] = useState<TrendWindow>(30);
  const [tabPicked, setTab] = useState<CenterTab>(loadTab);
  // ACHIEVEMENTS (2026-09-28): the tab exists only once the owner has switched achievements on; a remembered
  // Achievements tab reads as Match History until then.
  const achievementsOn = useProgression(achievementsVisible);
  const tab: CenterTab = tabPicked === 'achievements' && !achievementsOn ? 'history' : tabPicked;
  // HEROES -> MATCH HISTORY (owner 2026-10-23: "show the games of that hero if i clicked on the hero so i could go
  // rewatch them"): the hero Match History is filtered to (null = every run), the Heroes grid's sort, and the detailed
  // rows read for a filtered hero's light runs (one read per hero pick, per career owner).
  const [heroSort, setHeroSort] = useState<HeroSort>(loadHeroSort);
  const [heroFilter, setHeroFilter] = useState<string | null>(null);
  const [heroDetail, setHeroDetail] = useState<{ userId: string; rows: RunHistoryRowLike[] } | null>(null);
  const heroAsked = useRef(new Set<string>());
  const [watching, setWatching] = useState<number | null>(null); // run id whose replay is loading
  const [noReplay, setNoReplay] = useState<number | null>(null); // run id whose payload came back unplayable
  // PRACTICE tab rows, per career owner (`rows: null` = the read failed; no entry for this player = not read yet).
  const [practice, setPractice] = useState<{ userId: string; rows: PracticeGameRow[] | null } | null>(null);
  const [practiceTick, setPracticeTick] = useState(0); // the Practice tab's Retry
  const [watchingPractice, setWatchingPractice] = useState<number | null>(null); // practice row id whose replay is loading
  const [noPracticeReplay, setNoPracticeReplay] = useState<number | null>(null); // practice row id whose payload came back unplayable

  const lastTick = useRef(fetchTick);
  useEffect(() => {
    if (!show) { setRuns(undefined); return; }
    let live = true;
    // STALE-WHILE-REVALIDATE (perf 2026-10-09): paint the cached list at once, the exact answer for this key or the
    // same player's previous-version answer (a run finished since), and refresh behind it. A fresh exact answer
    // (read under `CAREER_FRESH_MS` ago) asks nothing. The refresh paints its run_history rows as soon as they land
    // and the telemetry join (Watch, length, APM) after, carrying the older answer's Watch handles meanwhile.
    const exact = cache && cache.key === cacheKey ? cache.runs : undefined;
    const sameUser = cache && userId && careerKeyUser(cache.key) === userId ? cache.runs : undefined;
    const shown = exact ?? sameUser;
    setRuns(shown);
    setWatching(null);
    setNoReplay(null);
    if (!userId || !remoteEnabled()) { setRuns(null); return; }
    // Re-read YOUR OWN rating from the server on every open — the profile is a local mirror of the `profiles` row and
    // this is the number the Seasonal Ranked card prints (the same one the leaderboard shows). One small read, even
    // when the runs below are fresh enough to skip.
    if (!viewing) syncProfileFromServer(playerName);
    const retry = lastTick.current !== fetchTick;
    lastTick.current = fetchTick;
    if (!retry && exact && careerFresh(cacheKey)) return () => { live = false; };
    void loadCareer(cacheKey, {
      ...(viewing ? { userId: viewing.userId } : {}),
      onHistory: (partial) => { if (live) setRuns(carryTelemetry(partial, shown)); },
    }).then((rows) => {
      if (!live) return;
      setRuns(rows ?? (shown ?? null));
    });
    return () => { live = false; };
    // `cache` is deliberately NOT a dep: the load writes it, and re-running on that write would refetch forever.
  }, [show, cacheKey, userId, viewing, playerName, fetchTick]);

  // MEDAL RANK for a VIEWED player (owner 2026-09-21). The entry point hands the rank over when it already
  // holds it (`careerOf.rank`: a Rankings row, Recent Games' profile fetch); otherwise (the Hall, a stale link)
  // the profile's rank columns are read ONCE by user id — one request, remembered per user id while the page
  // is open — so the Seasonal Ranked card paints the same crest + bar your own page shows, not a bare number.
  // `null` = asked, no rank (a pre-migration backend / no row) → the bare MMR stays.
  // The same one read also brings the player's CHOSEN profile picture when the entry point did not carry it (owner
  // 2026-10-16: "i really want the player's selected portrait to be here").
  const [viewedRank, setViewedRank] = useState<{ userId: string; rank: RankedProfile | null; avatar?: string | null } | null>(null);
  useEffect(() => {
    if (!show) { setViewedRank(null); return; }
    if (!viewing || (viewing.rank && viewing.avatar) || !remoteEnabled()) return;
    if (viewedRank?.userId === viewing.userId) return;
    let live = true;
    const who = viewing.userId;
    void fetchPlayerById(who).then((row) => { if (live) setViewedRank({ userId: who, rank: row?.rank ?? null, avatar: row?.avatar ?? null }); });
    return () => { live = false; };
  }, [show, viewing, viewedRank]);

  // The Practice tab reads the career owner's practice games the first time it is shown for them (never on
  // open: most visits never look), then keeps them while the page stays open. Closing forgets them, so the
  // next open (a practice game may have finished since) reads fresh.
  const practiceRows = practice && practice.userId === userId ? practice.rows : undefined;
  useEffect(() => {
    if (!show) { setPractice(null); return; }
    if (tab !== 'practice' || !userId || !remoteEnabled() || practiceRows !== undefined) return;
    let live = true;
    const who = userId;
    void fetchMyPracticeGames(who, MATCH_ROWS).then((rows) => { if (live) setPractice({ userId: who, rows }); });
    return () => { live = false; };
  }, [show, tab, userId, practiceRows, practiceTick]);

  const aggregates = useMemo(() => careerAggregates(runs ?? []), [runs]);
  const mmr = viewing ? viewing.rating : profile.rating;
  // MEDAL RANK (2026-09-20): the Seasonal Ranked card shows the crest + division bar once a rank exists on the
  // profile (or, for a viewed player, on the hand-over / the fetch above); the scalar stays as a small caption.
  // No rank → the bare number.
  const rank = rankPositionOf(
    viewing ? (viewing.rank ?? (viewedRank?.userId === viewing.userId ? viewedRank.rank : null)) : profile.rank,
  );
  // The viewed player's rank is still IN FLIGHT (no hand-over, the fetch above unanswered): the card holds a
  // quiet empty ring in the crest's slot rather than flashing the bare number the crest is about to replace
  // (review 2026-09-21). Offline / no backend never fetches, so it never holds: the bare number, at once.
  const rankPending = !!viewing && !viewing.rank && remoteEnabled() && viewedRank?.userId !== viewing.userId;
  // The MMR line ENDS on the number the Seasonal Ranked crest prints (owner 2026-10-03): the crest's rank
  // scalar when a rank exists, else the bare live rating; while a viewed player's rank is in flight, none yet.
  const liveMmr = rank ? rankScalar(rank) : rankPending ? null : mmr;
  const trends = useMemo(() => trendSeries(runs ?? [], window_, Date.now(), liveMmr), [runs, window_, liveMmr]);
  // The clock is read once per data / window change, on purpose (a stable `nowMs` keeps the charts' memos stable).
  const trendNow = useMemo(() => Date.now(), [runs, window_]);
  const heroes = useMemo(() => heroCareers(runs ?? []), [runs]);
  const sortedHeroes = useMemo(() => sortHeroCareers(heroes, heroSort), [heroes, heroSort]);
  // The filtered hero's newest games, read from the runs already loaded (no list fetch), their light rows upgraded
  // with the detailed rows read below once they land.
  const heroDetailRows = heroDetail && heroDetail.userId === userId ? heroDetail.rows : null;
  const heroRuns = useMemo(
    () => (heroFilter && runs ? runsOfHero(runs, heroFilter, MATCH_ROWS) : null),
    [heroFilter, runs],
  );
  // The Match History list: the hero's games or the newest MATCH_ROWS, upgraded with every row read on demand (the hero
  // filter's boards, the opened games in full).
  const matchRows = useMemo(
    () => withRunDetails(heroRuns ?? (runs ?? []).slice(0, MATCH_ROWS), heroDetailRows ?? []),
    [heroRuns, runs, heroDetailRows],
  );
  // A hero's games older than the newest `CAREER_DETAIL_ROWS` were fetched light (no final team): read their final
  // BOARDS ONCE per hero pick so the list portraits wear the recorded skins (the opened game is read in full below).
  // Replay never waits on this (the telemetry join already gave every row its handle).
  useEffect(() => {
    if (!show) { setHeroFilter(null); setHeroDetail(null); heroAsked.current.clear(); return; }
    if (tab !== 'history' || !heroFilter || !userId || !runs || !remoteEnabled()) return;
    const ask = `${userId}|${heroFilter}`;
    if (heroAsked.current.has(ask)) return;
    const ids = runsOfHero(runs, heroFilter, MATCH_ROWS).filter((r) => !r.detailed && !r.board && r.id !== null).map((r) => r.id!);
    if (ids.length === 0) return;
    heroAsked.current.add(ask);
    let live = true;
    const who = userId;
    void fetchRunBoards(who, ids).then((rows) => {
      if (!live || !rows) return;
      setHeroDetail((prev) => ({ userId: who, rows: [...(prev && prev.userId === who ? prev.rows : []), ...rows] }));
    });
    return () => { live = false; };
  }, [show, tab, heroFilter, userId, runs]);
  const focusIndex = useMemo(() => (runs ? focusIndexOf(runs, viewing?.focus) : -1), [runs, viewing?.focus]);
  // ACCOUNT LEVEL (2026-09-27): your own mirror, or the viewed player's public row. Null until the feature is on.
  const accountProgression = useCareerProgression(show ? userId : null, !viewing);
  // The equipped title for the name header, with its rarity for the colour.
  const headerTitle = titleName(accountProgression?.equippedTitleId ?? null);
  const headerTitleRarity = cosmeticOf(accountProgression?.equippedTitleId ?? null)?.rarity ?? null;
  // A hero title's master version wears the master look (owner pick 2026-10-28).
  const headerTitleMaster = isMasterTitle(accountProgression?.equippedTitleId ?? null);

  // SKINS: whose page this is, and the page owner's CURRENT loadout (public, read with their progression). Memoised
  // (perf 2026-10-09) so the context value is stable and the memoised banners below skip unrelated re-renders.
  const pageLoadout = accountProgression?.loadout ?? null;
  const careerSkins = useMemo(() => ({ own: !viewing, loadout: pageLoadout }), [viewing, pageLoadout]);
  // The game open in each tab's detail panel (GameSplit). Null = the focused run (a Recent Games open) or the newest;
  // a different player's page starts over.
  const [pickedRun, setPickedRun] = useState<string | null>(null);
  const [pickedPractice, setPickedPractice] = useState<string | null>(null);
  useEffect(() => { setPickedRun(null); setPickedPractice(null); setHeroFilter(null); }, [viewing?.userId, viewing?.focus]);
  // DETAIL ON DEMAND (Supabase cleanup P1.3, 2026-10-28): the list rows carry their board, never the match details;
  // the game open in the detail panel is read in full, once per game per page (the same pick the panel renders).
  const openRun = useMemo(() => {
    if (matchRows.length === 0) return null;
    const focusAt = heroFilter ? -1 : focusIndex;
    return matchRows.find((r, i) => `r${r.id ?? i}` === pickedRun) ?? matchRows[focusAt >= 0 ? focusAt : 0] ?? null;
  }, [matchRows, pickedRun, heroFilter, focusIndex]);
  const openRunId = openRun && !openRun.detailed ? openRun.id : null;
  useEffect(() => {
    if (!show || tab !== 'history' || openRunId === null || !userId || !remoteEnabled()) return;
    const ask = `${userId}|#${openRunId}`;
    if (heroAsked.current.has(ask)) return;
    heroAsked.current.add(ask);
    const who = userId;
    // Kept even if the player has moved on: the read is per game, and a quick flick back must not ask twice.
    void fetchRunDetails(who, [openRunId]).then((rows) => {
      if (!rows) { heroAsked.current.delete(ask); return; } // couldn't ask: the next open tries again
      setHeroDetail((prev) => ({ userId: who, rows: [...(prev && prev.userId === who ? prev.rows : []), ...rows] }));
    });
  }, [show, tab, openRunId, userId]);
  // Stable Watch callbacks for the memoised banners; the ref always holds this render's handler.
  const watchRunRef = useRef<(run: CareerRun) => void>(() => {});
  const onWatchRun = useCallback((run: CareerRun) => watchRunRef.current(run), []);
  // A hero card's click: Match History, filtered to that hero, its newest game selected.
  const onPickHero = useCallback((id: string) => {
    sfx.pulse();
    setHeroFilter(id);
    setPickedRun(null);
    setTab('history');
    saveTab('history');
  }, []);

  if (!show) return null;

  const shownName = viewing ? (viewing.author || tempHandle(viewing.userId)) : (playerName || tempHandle(myId));

  // Watch a listed run back: the join already resolved the telemetry row id, so this is the same one-row
  // payload fetch Recent Games makes, handed to the same viewer. `startReplay` closes this overlay itself and
  // restores it on exit. An unplayable payload degrades the button to "No replay", never a broken viewer.
  const watchRun = (run: CareerRun): void => {
    if (run.replayRowId === null || run.id === null || watching !== null) return;
    if (refuseInGame()) return; // never from inside a game (R-ESC-SIDEBAR-01)
    sfx.pulse();
    setNoReplay(null);
    setWatching(run.id);
    void fetchReplayPayload(run.replayRowId)
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: shownName || undefined, authorId: viewing ? viewing.userId : myId });
        else setNoReplay(run.id);
      })
      .finally(() => setWatching(null));
  };

  watchRunRef.current = watchRun;

  // Watch a practice game back: the twin of `watchRun`, reading the practice row's own `replay->v2` by id.
  const watchPractice = (game: PracticeGameRow): void => {
    if (!game.hasReplay || game.rowId === null || watchingPractice !== null) return;
    if (refuseInGame()) return;
    const id = game.rowId;
    sfx.pulse();
    setNoPracticeReplay(null);
    setWatchingPractice(id);
    void fetchPracticeReplay(id)
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: shownName || undefined, authorId: viewing ? viewing.userId : myId });
        else setNoPracticeReplay(id);
      })
      .finally(() => setWatchingPractice(null));
  };

  const heroId = aggregates.mostPlayedHero ?? viewing?.favoriteHero ?? '';
  const heroName = heroId ? getHero(heroId).name : '—';
  const filterName = heroFilter ? getHero(heroFilter).name : '';
  // Leaving Match History drops the hero filter: it only ever comes from a hero card's click.
  const pickTab = (t: CenterTab): void => { if (t === tab) return; if (t !== 'history') setHeroFilter(null); setTab(t); saveTab(t); };
  const clearHeroFilter = (): void => { sfx.pulse(); setHeroFilter(null); setPickedRun(null); };

  let body: JSX.Element;
  if (!remoteEnabled()) {
    body = <PageState icon="warn" title="Career unavailable" body="This build has no backend configured, so there is no server record to show." />;
  } else if (!userId) {
    body = (
      <PageState
        icon="taunt"
        title="Sign in to see your career"
        body="Your runs, placements and Rating live on your account, so they follow you between devices."
        action={{ label: 'Sign in', onClick: () => { sfx.pulse(); openAccountPanel(); } }}
        className="cv2-signin"
      />
    );
  } else if (runs === undefined) {
    body = <PageState icon="refresh" title="Loading your career" body="Fetching your recent runs from the server…" busy />;
  } else if (runs === null) {
    body = (
      <PageState
        icon="warn"
        title="Couldn’t reach the server"
        body="Your career is stored on your account. Check your connection and try again."
        action={{ label: 'Retry', onClick: () => { sfx.pulse(); setFetchTick((t) => t + 1); } }}
        className="cv2-signin"
      />
    );
  } else {
    body = (
      <div className="cv2-cols">
        {/* LEFT — most-played hero + the five tiles */}
        <aside className="cv2-col cv2-leftcol">
          <div className="cv2-colhead"><div className="cv2-sec"><Icon name="crown" />Career Stats</div></div>
          <div className="cv2-panel cv2-left">
            {/* THE PLAYER'S PORTRAIT (owner 2026-10-16): their chosen profile picture, the favourite hero as a small
                line under it (it was the portrait before; owner 2026-09-28 asked for it to be clearly labelled). */}
            {/* WHO THIS IS (owner 2026-10-16: "the player's selected portrait ... a bit bigger so it's more obvious"): the
                chosen profile picture in its frame (the favourite hero only when none was chosen), the account level on
                the ring, the name, and the favourite hero as a small line. */}
            <div className="cv2-idport">
              <ProfilePortrait avatar={viewing ? (viewing.avatar ?? (viewedRank?.userId === viewing.userId ? viewedRank.avatar : null)) : playerAvatar} heroId={heroId} loadout={accountProgression?.loadout} />
              {accountProgression && <span className="acctxp-level cv2-idlv" aria-label={`Level ${levelProgress(accountProgression.accountXp).level}`}><span className="acctxp-level-l">Lv</span>{levelProgress(accountProgression.accountXp).level}</span>}
            </div>
            <div className="cv2-favline">
              <span className="cv2-idname">{shownName}</span>
              <span className="cv2-idfav"><span className="cv2-favlabel">Favorite hero</span> <span className="cv2-heroname">{heroName}</span></span>
            </div>
            {/* ACCOUNT LEVEL (owner ask 2026-09-28: "move the account level to under the character portrait so it's
                not on top of ranked"): under the portrait block, above the stat tiles; Seasonal Ranked leads the right. */}
            {accountProgression && <AccountLevelCard profile={accountProgression} own={!viewing} />}
            <div className="cv2-tiles">
              <StatTile icon="crown" label="1st Place Wins" value={String(aggregates.firsts)} />
              <StatTile icon="shield" label="Top 4 Finish" value={aggregates.top4Pct === null ? '—' : `${aggregates.top4Pct}%`} />
              {/* LOSSES (owner ask 2026-09-21): the bottom-4 finishes, as a count beside the Top 4 rate. */}
              <StatTile icon="skull" label="Losses" value={String(aggregates.losses)} />
              <StatTile icon="star" label="Avg Placement" value={aggregates.avgPlacement === null ? '—' : String(aggregates.avgPlacement)} />
              <StatTile icon="paw" label="Favorite Tribe" value={aggregates.favoriteTribe ? TRIBE_LABEL[aggregates.favoriteTribe] : '—'} />
            </div>
          </div>
        </aside>

        {/* CENTRE — Match History | Heroes (the only column that scrolls) */}
        <section className="cv2-col cv2-center" aria-label={tab === 'heroes' ? 'Heroes' : tab === 'practice' ? 'Practice' : tab === 'achievements' ? 'Achievements' : 'Match History'}>
          <div className="cv2-colhead cv2-center-head">
            <div className="cv2-tabs" role="tablist" aria-label="Career view">
              <button type="button" role="tab" className={`cv2-tab${tab === 'history' ? ' on' : ''}`} aria-selected={tab === 'history'} onClick={() => pickTab('history')}>
                <Icon name="clock" />Match History
              </button>
              <button type="button" role="tab" className={`cv2-tab${tab === 'heroes' ? ' on' : ''}`} aria-selected={tab === 'heroes'} onClick={() => pickTab('heroes')}>
                <Icon name="taunt" />Heroes
              </button>
              <button type="button" role="tab" className={`cv2-tab${tab === 'practice' ? ' on' : ''}`} aria-selected={tab === 'practice'} onClick={() => pickTab('practice')}>
                <Icon name="target" />Practice
              </button>
              {achievementsOn && (
                <button type="button" role="tab" className={`cv2-tab${tab === 'achievements' ? ' on' : ''}`} aria-selected={tab === 'achievements'} onClick={() => pickTab('achievements')}>
                  <Icon name="star" />Achievements
                </button>
              )}
            </div>
            <span className="cv2-sec-sub">
              {tab === 'achievements'
                ? ''
                : tab === 'heroes'
                ? (heroes.length ? `${heroes.length} hero${heroes.length === 1 ? '' : 'es'} played` : '')
                : tab === 'practice'
                ? (practiceRows?.length ? `Last ${practiceRows.length} practice game${practiceRows.length === 1 ? '' : 's'}` : '')
                : heroFilter
                ? `${matchRows.length} ${filterName} game${matchRows.length === 1 ? '' : 's'}`
                : (matchRows.length ? `Last ${matchRows.length} run${matchRows.length === 1 ? '' : 's'}` : '')}
            </span>
          </div>
          {tab === 'achievements' && userId ? (
            <div className="cv2-list cv2-achlist" role="tabpanel">
              <AchievementsTab userId={userId} own={!viewing} ownerName={shownName} />
            </div>
          ) : tab === 'practice' ? (
            <div className="cv2-list cv2-practicelist" role="tabpanel">
              {practiceRows === undefined ? (
                <div className="cv2-panel cv2-none" role="status" aria-busy="true">
                  <div className="cv2-state-ico spin"><Icon name="refresh" /></div>
                  <div className="cv2-state-title">Loading practice games</div>
                  <div className="cv2-state-body">Fetching finished practice games from the server…</div>
                </div>
              ) : practiceRows === null ? (
                <div className="cv2-panel cv2-none">
                  <div className="cv2-state-ico"><Icon name="warn" /></div>
                  <div className="cv2-state-title">Couldn’t reach the server</div>
                  <div className="cv2-state-body">Check your connection and try again.</div>
                  <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); setPractice(null); setPracticeTick((t) => t + 1); }}>Retry</button>
                </div>
              ) : practiceRows.length === 0 ? (
                <div className="cv2-panel cv2-none">
                  <div className="cv2-state-ico"><Icon name="target" /></div>
                  <div className="cv2-state-title">No practice games yet</div>
                  <div className="cv2-state-body">{viewing ? `${shownName} hasn’t finished a practice game yet.` : 'Finish a practice game to see it here.'}</div>
                </div>
              ) : (() => {
                // LAYOUT B (owner 2026-10-16): the compact list + the selected practice game in full (GameSplit.tsx).
                const keyed = practiceRows.map((g, i) => ({ g, key: `p${g.rowId ?? `${g.createdAt ?? ''}-${i}`}` }));
                const sel = keyed.find((k) => k.key === pickedPractice) ?? keyed[0]!;
                const items: GameListItem[] = keyed.map(({ g, key }) => {
                  const name = g.heroId ? getHero(g.heroId).name : '-';
                  const rec = g.record && g.record.wins + g.record.losses + g.record.draws > 0 ? recordText(g.record) : undefined;
                  return {
                    key, place: g.placement, title: name, sub: rec, when: playedOnText(g.createdAt ? Date.parse(g.createdAt) : NaN) || undefined,
                    label: `${placeText(g.placement)}, ${name}`,
                    portrait: <HeroFrame heroId={g.heroId} small skins={g.board?.cosmetics} />,
                  };
                });
                return (
                  <GameSplit
                    className="cv2-split" items={items} selected={sel.key} onPick={setPickedPractice} label="Practice games"
                    detail={(
                      <PracticeRow
                        game={sel.g}
                        busy={watchingPractice !== null && watchingPractice === sel.g.rowId}
                        unplayable={noPracticeReplay !== null && noPracticeReplay === sel.g.rowId}
                        onWatch={() => watchPractice(sel.g)}
                      />
                    )}
                  />
                );
              })()}
            </div>
          ) : tab === 'heroes' ? (
            <div className="cv2-list cv2-herolist" role="tabpanel">
              {heroes.length === 0 ? (
                <div className="cv2-panel cv2-none">
                  <div className="cv2-state-ico"><Icon name="taunt" /></div>
                  <div className="cv2-state-title">No games played yet</div>
                  <div className="cv2-state-body">{viewing ? `${shownName} hasn’t finished a lobby run yet.` : 'Every hero you finish a lobby run with is tallied here.'}</div>
                </div>
              ) : (
                <>
                  <div className="cv2-herosort">
                    <span className="cv2-herosort-l">Sort by</span>
                    <div className="cv2-seg" role="group" aria-label="Sort heroes">
                      {HERO_SORTS.map((k) => (
                        <button
                          type="button"
                          key={k}
                          className={`cv2-seg-btn${heroSort === k ? ' on' : ''}`}
                          aria-pressed={heroSort === k}
                          onClick={() => { if (heroSort !== k) { setHeroSort(k); saveHeroSort(k); } }}
                        >
                          {HERO_SORT_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cv2-herogrid" aria-label="Heroes played">
                    {sortedHeroes.map((h) => <HeroTile key={h.heroId} h={h} onPick={onPickHero} />)}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="cv2-list" role="tabpanel">
              {heroFilter && (
                <div className="cv2-herofilter">
                  <span className="cv2-herofilter-l">Showing</span>
                  <button type="button" className="cv2-ppill cv2-herofilter-chip pressable" aria-label={`Show every hero, not just ${filterName}`} onClick={clearHeroFilter}>
                    {filterName}<span className="cv2-herofilter-x" aria-hidden="true">✕</span>
                  </button>
                  <button type="button" className="cv2-btn cv2-btn-sm pressable cv2-herofilter-back" onClick={() => { sfx.pulse(); pickTab('heroes'); }}>Back to Heroes</button>
                </div>
              )}
              {heroFilter && matchRows.length === 0 ? (
                <div className="cv2-panel cv2-none">
                  <div className="cv2-state-ico"><Icon name="taunt" /></div>
                  <div className="cv2-state-title">No {filterName} games yet</div>
                  <div className="cv2-state-body">{viewing ? `${shownName} hasn’t finished a lobby run with ${filterName} yet.` : `Finish a lobby run with ${filterName} and it will appear here.`}</div>
                </div>
              ) : matchRows.length === 0 ? (
                <div className="cv2-panel cv2-none">
                  <div className="cv2-state-ico"><Icon name="sword" /></div>
                  <div className="cv2-state-title">No runs yet</div>
                  <div className="cv2-state-body">{viewing ? `${shownName} hasn’t finished a lobby run yet.` : 'Finish a lobby run and it will appear here, final team and all.'}</div>
                </div>
              ) : (() => {
                // LAYOUT B (owner 2026-10-16: "maybe even do something like that for career"): the compact list + the
                // selected run in full (GameSplit.tsx, shared with Recent Games). A Recent Games open lands on its run.
                const keyed = matchRows.map((run, i) => ({ run, i, key: `r${run.id ?? i}` }));
                const focusAt = heroFilter ? -1 : focusIndex; // a Recent Games focus indexes the unfiltered list
                const sel = keyed.find((k) => k.key === pickedRun) ?? keyed[focusAt >= 0 ? focusAt : 0]!;
                const items: GameListItem[] = keyed.map(({ run, key }) => {
                  const name = run.heroId ? getHero(run.heroId).name : '-';
                  const fights = run.wins + run.losses + run.draws;
                  return {
                    key, place: run.placement, title: name, sub: fights > 0 ? recordText(run) : undefined, when: playedOnText(run.atMs) || undefined,
                    delta: run.ratingDelta ?? null, rank: run.rank,
                    label: `${placeText(run.placement)}, ${name}${run.rank != null ? `, played at ${rankLabel(run.rank)}` : ''}`,
                    portrait: <HeroFrame heroId={run.heroId} small skins={run.board?.cosmetics} />,
                  };
                });
                return (
                  <GameSplit
                    className="cv2-split" items={items} selected={sel.key} onPick={setPickedRun} label="Match history"
                    detail={(
                      <MatchRow
                        run={sel.run}
                        focus={sel.i === focusAt}
                        busy={watching !== null && watching === sel.run.id}
                        unplayable={noReplay !== null && noReplay === sel.run.id}
                        onWatch={onWatchRun}
                      />
                    )}
                  />
                );
              })()}
            </div>
          )}
        </section>

        {/* RIGHT — Seasonal Ranked + Performance Trends */}
        <aside className="cv2-col cv2-right">
          <div className="cv2-colhead"><div className="cv2-sec"><Icon name="star" />Seasonal Ranked</div></div>
          <RankCard position={rank ?? null}>
            {rankPending ? (
              <div className="cv2-rank-wait" aria-busy="true" aria-label="Loading rank" />
            ) : (
              <div className="cv2-mmr">
                <span className="cv2-mmr-v">{mmr}</span>
                <span className="cv2-mmr-l">MMR</span>
              </div>
            )}
          </RankCard>
          {/* RANKED DUOS (owner 2026-10-26, Q5; 2026-10-29): the player's teams as the same rank card, one team at a
              time with arrows, best rank first, above the trends (hidden with none). */}
          <CareerDuosTeams userId={userId ?? null} />
          <div className="cv2-panel cv2-trends">
            <div className="cv2-trends-head">
              <div className="cv2-sec">Performance Trends</div>
              <div className="cv2-seg" role="group" aria-label="Trend window">
                {TREND_WINDOWS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    className={`cv2-seg-btn${window_ === d ? ' on' : ''}`}
                    aria-pressed={window_ === d}
                    onClick={() => { if (window_ !== d) setWindow(d); }}
                  >
                    {trendWindowLabel(d)}
                  </button>
                ))}
              </div>
            </div>
            {/* MMR FIRST (owner ask 2026-09-22): the crest above prints "N MMR" and, with a rated run in the window,
                this headline is that same number — crest → number → line — before the three rates that explain it.
                Raw ratings on a division-snapped axis (`mmrAxisOf`); nothing here animates. */}
            {/* WITH DEPTH (owner 2026-10-16, careerTrends.tsx): one big MMR chart over the medal bands, then placement,
                top 4 rate, APM and games as small multiples with rolling averages and the change vs the period before. */}
            <TrendsBody runs={runs ?? []} window_={window_} nowMs={trendNow} live={trends.mmr.avg} own={!viewing} />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <SidebarHost className="lbpage cv2-page">
      {/* The main menu lives in the left sidebar (owner ask 2026-09-21); since the WS-2 regroup its ASCENT mark
          goes home and the rail itself replaces Back (a Career opened from the Leaderboard: the Leaderboard plaque). */}
      <MenuSidebar current="career" />
      <div className="lbtopbar">
        {/* THE NAME HEADER (owner ask 2026-09-28: "the player's name and title should be at the top of the career
            page and more obvious ... dont push everything down much at all"): a small "Career" kicker, then the
            player's name large with the equipped title beside it in its rarity colour. Same for someone else's page. */}
        <div className="lbtitle cv2-namehead">
          <Icon name="taunt" />
          <div className="cv2-namehead-body">
            <div className="cv2-kicker">{viewing ? 'Career' : 'Your Career'}</div>
            <div className="cv2-nameline">
              <span className="esch disp cv2-name">{shownName}</span>
              {headerTitle && (headerTitleMaster
                ? <TitleBadge id={accountProgression?.equippedTitleId ?? null} className="cv2-titleplate" />
                : <span className={`cv2-titlechip${headerTitleRarity ? ` r-${headerTitleRarity}` : ''}`}>{headerTitle}</span>)}
            </div>
          </div>
        </div>
        {/* ADD FRIEND (owner 2026-10-26, R-FRIENDS-01): on another player's Career, where a Leaderboard row, a Recent Games
            row and a match's players lead. Hidden on your own page, for a guest, and on a blocked player. */}
        {viewing && <AddFriendButton userId={viewing.userId} />}
      </div>
      <CareerSkinContext.Provider value={careerSkins}>
        <div className="lbscroll cv2-body">{body}</div>
      </CareerSkinContext.Provider>
    </SidebarHost>
  );
}
