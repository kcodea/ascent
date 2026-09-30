import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RUNE_INDEX } from '@game/content';
import { getHero, strengthText } from '@game/sim';
import { SHOW_LOBBY_STRENGTH } from './lobbyStrengthDisplay';
import type { BoardSnapshot, MatchDetails } from '@game/sim';
import { StoredTeam } from './StoredTeam';
import { MatchScoreboard } from './matchDetails/MatchScoreboard';
import { NO_DETAILS_TEXT } from './matchDetails/matchDetailsText';
import { RuneEmblem } from './RuneEmblem';
import { heroPortrait, opponentSkins } from './skins/skins';
import type { RunCosmeticSnapshot } from '@game/progression';
import { Icon } from './Icon';
import { PortraitFrame, pfClass, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { recordText } from './leaderboardData';
import { sfx } from './sfx';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { useGame, syncProfileFromServer, tempHandle, type CareerFocus } from './store';
import { fetchMyPracticeGames, fetchMyRuns, fetchPracticeReplay, fetchPlayerById, fetchReplayPayload, remoteEnabled, type PracticeGameConfig, type PracticeGameRow } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import { RankBar } from './rank/RankBar';
import { cosmeticOf, isMasterTitle, titleName } from '@game/progression';
import { TitleBadge } from './titles/TitleBadge';
import { AccountLevelCard, useCareerProgression } from './progression/AccountLevel';
import { AchievementsTab } from './progression/AchievementsTab';
import { achievementsVisible, useProgression } from './progression/progressionStore';
import { scalarCaption } from './rank/rankFormat';
import { rankPositionOf, type RankedProfile } from './rank/types';
import {
  TREND_WINDOWS, TRIBE_LABEL, careerAggregates, heroCareers, matchResultOf, mmrAxisOf, ordinalOf, outcomeOf, playedOnText, polylineOf, runLengthText,
  trendSeries, trendWindowLabel, type CareerRun, type HeroCareer, type TrendSeries, type TrendWindow,
} from './careerData';
import { rectToStage, stageHost, stageViewport } from './stage';

/**
 * CAREER (owner rebuild 2026-09-19/20) — three columns on the game's page backdrop, after the Battlegrounds-style
 * mockup:
 *
 *  LEFT    the most-played hero in the SAME circular frame the recruit screen wears (the `.hero > .f >
 *          .heroimg` markup + rules from StatusBar, re-seated here without the tray transforms), its name
 *          plate, and five stat tiles — 1st Place Wins · Top 4 Finish · Losses · Avg Placement · Favorite Tribe
 *          (Losses = bottom-4 finishes, the count of match losses; owner ask 2026-09-21).
 *  CENTRE  three tabs in the column header (MATCH HISTORY | HEROES | PRACTICE, the choice persisted per browser):
 *          Match History — the account's last 25 runs FROM THE SERVER (`fetchMyRuns`; never local-only runs),
 *          each a TALL BANNER that reads top to bottom (owner 2026-09-20: "chunky and fully readable"):
 *            head   hero portrait + name + the MATCH result (WIN / LOSS — by placement, see below; the fight
 *                   record only as a small caption) ‖ the outcome block (VICTORY / placement, date · length · Gold)
 *            team   the final team as 7 full-size card tiles (the real `Card`, sized like the leaderboard's; no
 *                   label — it collided with the gilded crown / tier stars, owner 2026-09-20)
 *            foot   the run's rune selections as emblems + names (hover = the rune's text) ‖ ONE button,
 *                   WATCH REPLAY, live only when a telemetry replay exists.
 *          Heroes — every hero the account has played (folded over ALL the fetched runs, not just the 25
 *          banners) as a PORTRAIT GRID (owner 2026-09-20): each hero in the game's circular frame with its name
 *          and "N games played", sorted by games played then win rate; hovering / focusing a portrait floats a
 *          styled panel beside it (portalled, never clipped) with the match W–L + win rate, avg placement, and
 *          1st-place wins / best placement / last played as secondary lines. No per-hero rows.
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

/** Rows fetched light (scalars only) for the trends, the tiles and the Heroes tab — effectively every run the
 *  account has (a light row is ~200 bytes); the newest `CAREER_DETAIL_ROWS` of them also carry the board. The
 *  trends' "All time" window is therefore, precisely, the newest 1000 runs — honest today by a wide margin. */
const FETCH_LIMIT = 1000;
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
/** Banners in Match History — the newest 25 server runs (owner 2026-09-20; was 10). Matches `CAREER_DETAIL_ROWS`. */
const MATCH_ROWS = 25;

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
  const art = heroPortrait(heroId, useCareerSkins(skins));
  const name = heroId ? getHero(heroId).name : '';
  // Your own Career wears YOUR frame; someone else's Career wears the opponents' frame.
  const frame = usePortraitFrame(useContext(CareerSkinContext).own ? 'self' : 'opp');
  return (
    <div className={`cv2-heroframe${small ? ' small' : ''}${pfClass(frame)}`} style={frame?.hostStyle}>
      <div className="hero">
        <div className="f">
          {art ? <img decoding="sync" className="heroimg" src={art} alt={name} draggable={false} /> : <Icon name="anvil" />}
        </div>
        <PortraitFrame frame={frame} />
      </div>
    </div>
  );
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

const CHART_W = 300, CHART_H = 110, CHART_PAD = 10;

/** One trend: a static inline-SVG polyline (no library, nothing animated) with the series' headline (the window
 *  average; for MMR the latest rating) and the axis extremes labelled. `invert` puts `yMin` at the top
 *  (placement: 1st reads high). */
function TrendChart({ title, series, yMin, yMax, invert, unit, empty }: {
  title: string; series: TrendSeries; yMin: number; yMax: number; invert?: boolean; unit?: string; empty: string;
}) {
  const pts = polylineOf(series.points, { w: CHART_W, h: CHART_H, pad: CHART_PAD, yMin, yMax, invert });
  const one = series.points.length === 1 ? pts.split(',').map(Number) : null;
  const avgText = series.avg === null ? '—' : `${series.avg}${unit ?? ''}`;
  const n = series.points.length;
  return (
    <div className="cv2-trend">
      <div className="cv2-trend-head">
        <span className="cv2-trend-title">{title}</span>
        <span className="cv2-trend-avg">{avgText}</span>
      </div>
      <div className="cv2-chart">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label={`${title} over the window`}>
          <line className="cv2-grid" x1={CHART_PAD} x2={CHART_W - CHART_PAD} y1={CHART_PAD} y2={CHART_PAD} />
          <line className="cv2-grid" x1={CHART_PAD} x2={CHART_W - CHART_PAD} y1={CHART_H / 2} y2={CHART_H / 2} />
          <line className="cv2-grid" x1={CHART_PAD} x2={CHART_W - CHART_PAD} y1={CHART_H - CHART_PAD} y2={CHART_H - CHART_PAD} />
          {n > 1 && <polyline className="cv2-line" points={pts} />}
          {one && <line className="cv2-line cv2-dot" x1={one[0]} y1={one[1]} x2={one[0]} y2={one[1]} />}
        </svg>
        <span className="cv2-axis top">{invert ? yMin : yMax}{unit}</span>
        <span className="cv2-axis bottom">{invert ? yMax : yMin}{unit}</span>
        {n === 0 && <span className="cv2-chart-empty">{empty}</span>}
      </div>
      <div className="cv2-trend-foot">{n} run{n === 1 ? '' : 's'}</div>
    </div>
  );
}

/** The APM axis top: the series' max rounded up to the next 10, never below 10 (so an empty / tiny series
 *  still draws a sensible box). */
function apmAxisMax(series: TrendSeries): number {
  const top = series.points.reduce((m, p) => Math.max(m, p.y), 0);
  return Math.max(10, Math.ceil((top + 5) / 10) * 10);
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

/** MATCH DETAILS on a match card (owner ask 2026-09-28: "add a down arrow/expand button to make a match larger and
 *  be able to see the players in the lobby"): the chevron button that grows the card. */
function LobbyToggle({ open, onToggle, id }: { open: boolean; onToggle: () => void; id: string }) {
  return (
    <button
      type="button"
      className="cv2-lobbybtn pressable"
      aria-expanded={open}
      aria-controls={id}
      aria-label={open ? 'Hide the players in this lobby' : 'Show the players in this lobby'}
      onClick={() => { sfx.tick(); onToggle(); }}
    >
      Lobby<Icon name="chevron" />
    </button>
  );
}

/** The expanded half of a match card: the SAME scoreboard the end screen's Match details dialog shows, mounted only
 *  while open. An older match (no recorded details) says so plainly. */
function LobbyPanel({ match, id }: { match: MatchDetails | null | undefined; id: string }) {
  const { own } = useContext(CareerSkinContext);
  return (
    <section className="cv2-lobby" id={id} aria-label="Players in this lobby">
      {match ? <MatchScoreboard details={match} own={own} /> : <div className="cv2-lobby-none">{NO_DETAILS_TEXT}</div>}
    </section>
  );
}

/** One match banner. */
function MatchRow({ run, focus, busy, unplayable, onWatch }: {
  run: CareerRun; focus: boolean; busy: boolean; unplayable: boolean; onWatch: () => void;
}) {
  const o = outcomeOf(run.placement);
  const result = matchResultOf(run.placement);
  const when = playedOnText(run.atMs);
  const length = runLengthText(run.durationMs);
  const watchable = run.replayRowId !== null;
  const hasBoard = !!run.board && run.board.minions.length > 0;
  const runes = run.runes.filter((id) => RUNE_INDEX[id]);
  const fights = run.wins + run.losses + run.draws;
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const lobbyId = `cv2-lobby-r${run.id ?? run.seed ?? 'x'}`;
  return (
    <article className={`cv2-row ${o.cls}${focus ? ' focus' : ''}`} aria-label={`${run.heroId ? getHero(run.heroId).name : 'Run'}: ${o.label}`}>
      <header className="cv2-row-head">
        <div className="cv2-row-hero">
          <HeroFrame heroId={run.heroId} small skins={run.board?.cosmetics} />
          <div className="cv2-row-heroid">
            <div className="cv2-row-heroname">{run.heroId ? getHero(run.heroId).name : '—'}</div>
            {/* The MATCH result — by placement (top 4 = WIN, 5th–8th = LOSS; owner 2026-09-20). The fight
                record is only a small caption beneath it — a bare "N–M" (owner 2026-09-21: no "Fights" word;
                the aria-label keeps the meaning) — and only when the run recorded any fights. */}
            <div className={`cv2-row-result ${result.cls}`} aria-label={result.cls === 'none' ? 'No placement recorded' : `Match ${result.label.toLowerCase()}`}>
              {result.label}
            </div>
            {fights > 0 && (
              <div className="cv2-row-fights" aria-label={`Fights: ${run.wins} won, ${run.losses} lost${run.draws ? `, ${run.draws} drawn` : ''}`}>
                {recordText(run)}
              </div>
            )}
          </div>
        </div>
        <div className="cv2-row-outcome">
          <div className="cv2-row-label">Match Outcome</div>
          <div className={`cv2-verdict ${o.cls}`}>{o.label}</div>
          <div className="cv2-row-meta">
            <span className="cv2-meta"><span className="cv2-meta-l">Played</span><span className="cv2-meta-v cv2-row-when">{when || '—'}</span></span>
            <span className="cv2-meta"><span className="cv2-meta-l">Length</span><span className="cv2-meta-v cv2-row-length">{length}</span></span>
            <span className="cv2-meta"><span className="cv2-meta-l">Gold spent</span><span className="cv2-meta-v cv2-row-gold-v">{run.goldSpent === null ? '—' : run.goldSpent}</span></span>
            {/* LOBBY STRENGTH (owner 2026-09-22): the number as a percentage, post-game only, and only when the run
                carries a stamp — a row without one prints nothing here rather than a guess. Hidden for now behind
                SHOW_LOBBY_STRENGTH (owner 2026-09-30); the stamp itself is still read. */}
            {SHOW_LOBBY_STRENGTH && run.lobbyStrength && (
              <span className="cv2-meta"><span className="cv2-meta-l">Lobby</span><span className="cv2-meta-v cv2-row-lobby" aria-label={`Lobby strength ${run.lobbyStrength.value} percent`}>{strengthText(run.lobbyStrength)}</span></span>
            )}
            {/* BOARD STRENGTH (R-LOBBY-09): the run's percentile, frozen when it ended; nothing when it was not scored. */}
            {run.boardStrength != null && (
              <span className="cv2-meta"><span className="cv2-meta-l">Board strength</span><span className="cv2-meta-v cv2-row-bstrength" aria-label={`Board strength ${run.boardStrength} out of 100`}>{run.boardStrength}</span></span>
            )}
          </div>
        </div>
      </header>
      {/* No "Final Team" label (owner 2026-09-20): it collided with the first tile's crown / tier stars, and the
          card row speaks for itself. The row keeps headroom above the tiles for those overhangs instead. */}
      <div className="cv2-row-team">
        {hasBoard
          ? <FinalTeam board={run.board!} />
          : <div className="cv2-row-none">No final team recorded for this run.</div>}
      </div>
      <footer className="cv2-row-foot">
        <div className="cv2-row-runes">
          <div className="cv2-row-label">Runes</div>
          {runes.length > 0
            ? <div className="cv2-runes" aria-label="Runes picked this run">{runes.map((id, i) => <RuneEmblem runeId={id} key={`${id}#${i}`} />)}</div>
            : <div className="cv2-row-none cv2-norunes">No runes recorded</div>}
        </div>
        <div className="cv2-foot-actions">
          <LobbyToggle open={lobbyOpen} onToggle={() => setLobbyOpen((o) => !o)} id={lobbyId} />
          <button
            type="button"
            className="cv2-btn cv2-watch pressable"
            disabled={!watchable || busy || unplayable}
            onClick={onWatch}
            aria-label={watchable ? 'Watch this run’s replay' : 'No replay stored for this run'}
          >
            <Icon name="eye" />{busy ? 'Loading…' : unplayable ? 'No replay' : 'Watch Replay'}
          </button>
        </div>
      </footer>
      {lobbyOpen && <LobbyPanel match={run.match} id={lobbyId} />}
    </article>
  );
}

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
  const rec = game.record;
  const fights = rec ? rec.wins + rec.losses + rec.draws : 0;
  const heroName = game.heroId ? getHero(game.heroId).name : '—';
  const cfg = game.practice;
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const lobbyId = `cv2-lobby-p${game.rowId ?? game.createdAt ?? 'x'}`;
  return (
    <article className={`cv2-row cv2-prow ${o.cls}`} aria-label={`Practice, ${heroName}: ${o.label}`}>
      <header className="cv2-row-head">
        <div className="cv2-row-hero">
          <HeroFrame heroId={game.heroId} small skins={game.board?.cosmetics} />
          <div className="cv2-row-heroid">
            <div className="cv2-row-heroname">{heroName}</div>
            <div className={`cv2-row-result ${result.cls}`} aria-label={result.cls === 'none' ? 'No placement recorded' : `Match ${result.label.toLowerCase()}`}>
              {result.label}
            </div>
            {rec && fights > 0 && (
              <div className="cv2-row-fights" aria-label={`Fights: ${rec.wins} won, ${rec.losses} lost${rec.draws ? `, ${rec.draws} drawn` : ''}`}>
                {recordText(rec)}
              </div>
            )}
          </div>
        </div>
        <div className="cv2-row-outcome">
          <div className="cv2-row-label">Match Outcome</div>
          <div className={`cv2-verdict ${o.cls}`}>{o.label}</div>
          <div className="cv2-row-meta">
            <span className="cv2-meta"><span className="cv2-meta-l">Played</span><span className="cv2-meta-v cv2-row-when">{when || '—'}</span></span>
            <span className="cv2-meta"><span className="cv2-meta-l">Length</span><span className="cv2-meta-v cv2-row-length">{runLengthText(game.durationMs)}</span></span>
            <span className="cv2-meta"><span className="cv2-meta-l">Rounds</span><span className="cv2-meta-v cv2-row-rounds">{game.wave ?? '—'}</span></span>
          </div>
        </div>
      </header>
      <div className="cv2-row-team">
        {hasBoard
          ? <FinalTeam board={game.board!} />
          : <div className="cv2-row-none">No final team recorded for this game.</div>}
      </div>
      <footer className="cv2-row-foot">
        <div className="cv2-row-runes">
          <div className="cv2-row-label">Runes</div>
          {runes.length > 0
            ? <div className="cv2-runes" aria-label="Runes picked this game">{runes.map((id, i) => <RuneEmblem runeId={id} key={`${id}#${i}`} />)}</div>
            : <div className="cv2-row-none cv2-norunes">No runes recorded</div>}
        </div>
        <div className="cv2-prow-side">
          {cfg && (
            <div className="cv2-ppills" aria-label="Practice options">
              <span className={`cv2-ppill${cfg.opponents === 'bots' ? ' bots' : ''}`}><Icon name={cfg.opponents === 'bots' ? 'gear' : 'taunt'} />{practiceOpponentsPill(cfg)}</span>
              <span className="cv2-ppill"><Icon name="heart" />{practiceHealthPill(cfg)}</span>
            </div>
          )}
          <div className="cv2-foot-actions">
            <LobbyToggle open={lobbyOpen} onToggle={() => setLobbyOpen((o) => !o)} id={lobbyId} />
            {game.hasReplay && (
              <button
                type="button"
                className="cv2-btn cv2-watch pressable"
                disabled={busy || unplayable}
                onClick={onWatch}
                aria-label="Watch this practice game’s replay"
              >
                <Icon name="eye" />{busy ? 'Loading…' : unplayable ? 'No replay' : 'Watch Replay'}
              </button>
            )}
          </div>
        </div>
      </footer>
      {lobbyOpen && <LobbyPanel match={game.match} id={lobbyId} />}
    </article>
  );
}

/** The hero panel's footprint (px) — used to seat it beside the portrait and keep it on screen. The height is
 *  the measured render (the content is fixed: a name, two headline rows, three secondary lines). */
const HERO_TIP_W = 250, HERO_TIP_H = 208;

/** One hero on the Heroes tab (owner 2026-09-20): the portrait in the game's circular frame, the name and
 *  "N games played". Hovering — or tabbing onto it — floats the hero's career in a styled panel BESIDE the
 *  portrait (to its right; flipped to the left near the screen edge; vertically centred on the tile and clamped
 *  to the viewport), portalled to <body> so the scrolling grid never clips it. Never a native `title`. */
function HeroTile({ h }: { h: HeroCareer }) {
  const name = getHero(h.heroId).name;
  const careerLoadout = useContext(CareerSkinContext).loadout;
  const [tip, setTip] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null);
  const timer = useRef<number | null>(null);
  const tipId = `cv2-herotip-${h.heroId}`;
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const place = (el: HTMLElement): void => {
    // One layout read per show (never per frame).
    const r = rectToStage(el.getBoundingClientRect()); // stage px (stage.ts): written as the tip's CSS left/top
    const vp = stageViewport();
    const gap = 12;
    const fitsRight = r.right + gap + HERO_TIP_W + 8 <= vp.w;
    const side: 'right' | 'left' = fitsRight ? 'right' : 'left';
    const left = fitsRight ? r.right + gap : Math.max(8, r.left - gap - HERO_TIP_W);
    const top = Math.max(8, Math.min(vp.h - HERO_TIP_H - 8, r.top + r.height / 2 - HERO_TIP_H / 2));
    setTip({ left, top, side });
  };
  const show = (el: HTMLElement, delay: number): void => {
    if (timer.current) window.clearTimeout(timer.current);
    if (delay <= 0) { place(el); return; }
    timer.current = window.setTimeout(() => { timer.current = null; place(el); }, delay);
  };
  const hide = (): void => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    setTip(null);
  };
  const games = `${h.runs} game${h.runs === 1 ? '' : 's'} played`;
  const last = playedOnText(h.lastAtMs);
  const best = h.bestPlacement === null ? null : outcomeOf(h.bestPlacement);
  return (
    <div
      className="cv2-hcard"
      tabIndex={0}
      aria-label={`${name}: ${games}`}
      aria-describedby={tip ? tipId : undefined}
      onMouseEnter={(e) => show(e.currentTarget, 160)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget, 0)}
      onBlur={hide}
    >
      <HeroFrame heroId={h.heroId} skins={careerLoadout} />
      <div className="cv2-hcard-name">{name}</div>
      <div className="cv2-hcard-games">{games}</div>
      {tip && createPortal(
        <div id={tipId} className={`cv2-herotip ${tip.side}`} role="tooltip" style={{ left: tip.left, top: tip.top }}>
          <div className="cv2-herotip-name">{name}</div>
          <div className="cv2-herotip-row">
            <span className="cv2-herotip-l">Record</span>
            <span className="cv2-herotip-record" aria-label={`${h.wins} wins, ${h.losses} losses`}>
              <span className="cv2-herotip-n win">{h.wins}</span><span className="cv2-herotip-wl">W</span>
              <span className="cv2-herotip-sep">–</span>
              <span className="cv2-herotip-n loss">{h.losses}</span><span className="cv2-herotip-wl">L</span>
            </span>
            <span className="cv2-herotip-rate">{h.winRate === null ? '—' : `${h.winRate}%`}</span>
          </div>
          <div className="cv2-herotip-row">
            <span className="cv2-herotip-l">Avg Placement</span>
            <span className="cv2-herotip-v">{h.avgPlacement === null ? '—' : h.avgPlacement}</span>
          </div>
          <div className="cv2-herotip-sub">
            <span className="cv2-herotip-l">1st Place Wins</span>
            <span className={`cv2-herotip-sv${h.firsts > 0 ? ' won' : ''}`}>{h.firsts}</span>
          </div>
          <div className="cv2-herotip-sub">
            <span className="cv2-herotip-l">Best Placement</span>
            <span className={`cv2-herotip-sv${best ? ` ${best.cls}` : ''}`}>{best ? ordinalOf(h.bestPlacement!) : '—'}</span>
          </div>
          <div className="cv2-herotip-sub">
            <span className="cv2-herotip-l">Last Played</span>
            <span className="cv2-herotip-sv">{last || '—'}</span>
          </div>
        </div>,
        stageHost(),
      )}
    </div>
  );
}

export function Career() {
  const show = useGame((s) => s.showCareer);
  const close = useGame((s) => s.closeCareer);
  const playerName = useGame((s) => s.playerName);
  const profile = useGame((s) => s.profile);
  const careerOf = useGame((s) => s.careerOf); // null = your own career
  const myId = useGame((s) => s.account.userId);
  const careerVersion = useGame((s) => s.careerVersion);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const cache = useGame((s) => s.careerCache);
  const setCache = useGame((s) => s.setCareerCache);

  const viewing = careerOf;
  const userId = viewing?.userId ?? myId;
  const cacheKey = `${userId ?? ''}|${careerVersion}`;
  // `undefined` = loading; `null` = couldn't ask (no session / server unreachable); [] = no runs yet.
  const [runs, setRuns] = useState<CareerRun[] | null | undefined>(undefined);
  const [fetchTick, setFetchTick] = useState(0); // the Retry button
  const [window_, setWindow] = useState<TrendWindow>(30);
  const [tabPicked, setTab] = useState<CenterTab>(loadTab);
  // ACHIEVEMENTS (2026-09-28): the tab exists only once the owner has switched achievements on; a remembered
  // Achievements tab reads as Match History until then.
  const achievementsOn = useProgression(achievementsVisible);
  const tab: CenterTab = tabPicked === 'achievements' && !achievementsOn ? 'history' : tabPicked;
  const [watching, setWatching] = useState<number | null>(null); // run id whose replay is loading
  const [noReplay, setNoReplay] = useState<number | null>(null); // run id whose payload came back unplayable
  // PRACTICE tab rows, per career owner (`rows: null` = the read failed; no entry for this player = not read yet).
  const [practice, setPractice] = useState<{ userId: string; rows: PracticeGameRow[] | null } | null>(null);
  const [practiceTick, setPracticeTick] = useState(0); // the Practice tab's Retry
  const [watchingPractice, setWatchingPractice] = useState<number | null>(null); // practice row id whose replay is loading
  const [noPracticeReplay, setNoPracticeReplay] = useState<number | null>(null); // practice row id whose payload came back unplayable

  useEffect(() => {
    if (!show) return;
    let live = true;
    // Paint the cached list at once (no loading flash on reopen), then refresh behind it.
    const cached = cache && cache.key === cacheKey ? cache.runs : undefined;
    setRuns(cached);
    setWatching(null);
    setNoReplay(null);
    if (!userId || !remoteEnabled()) { setRuns(null); return; }
    void fetchMyRuns(FETCH_LIMIT, viewing ? { userId: viewing.userId } : undefined).then((rows) => {
      if (!live) return;
      if (rows) setCache(cacheKey, rows);
      setRuns(rows ?? (cached ?? null));
    });
    // …and re-read YOUR OWN rating from the server while we're here — the profile is a local mirror of the
    // `profiles` row and this is the number the Seasonal Ranked card prints (the same one the leaderboard shows).
    if (!viewing) syncProfileFromServer(playerName);
    return () => { live = false; };
    // `cache` is deliberately NOT a dep: the effect writes it, and re-running on that write would refetch forever.
  }, [show, cacheKey, userId, viewing, playerName, fetchTick, setCache]);

  // MEDAL RANK for a VIEWED player (owner 2026-09-21). The entry point hands the rank over when it already
  // holds it (`careerOf.rank`: a Rankings row, Recent Games' profile fetch); otherwise (the Hall, a stale link)
  // the profile's rank columns are read ONCE by user id — one request, remembered per user id while the page
  // is open — so the Seasonal Ranked card paints the same crest + bar your own page shows, not a bare number.
  // `null` = asked, no rank (a pre-migration backend / no row) → the bare MMR stays.
  const [viewedRank, setViewedRank] = useState<{ userId: string; rank: RankedProfile | null } | null>(null);
  useEffect(() => {
    if (!show) { setViewedRank(null); return; }
    if (!viewing || viewing.rank || !remoteEnabled()) return;
    if (viewedRank?.userId === viewing.userId) return;
    let live = true;
    const who = viewing.userId;
    void fetchPlayerById(who).then((row) => { if (live) setViewedRank({ userId: who, rank: row?.rank ?? null }); });
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
  const trends = useMemo(() => trendSeries(runs ?? [], window_, Date.now()), [runs, window_]);
  const heroes = useMemo(() => heroCareers(runs ?? []), [runs]);
  const focusIndex = useMemo(() => (runs ? focusIndexOf(runs, viewing?.focus) : -1), [runs, viewing?.focus]);
  // ACCOUNT LEVEL (2026-09-27): your own mirror, or the viewed player's public row. Null until the feature is on.
  const accountProgression = useCareerProgression(show ? userId : null, !viewing);
  // The equipped title for the name header, with its rarity for the colour.
  const headerTitle = titleName(accountProgression?.equippedTitleId ?? null);
  const headerTitleRarity = cosmeticOf(accountProgression?.equippedTitleId ?? null)?.rarity ?? null;
  // A hero title's master version is the golden embroidered plate (owner 2026-09-29).
  const headerTitleMaster = isMasterTitle(accountProgression?.equippedTitleId ?? null);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const shownName = viewing ? (viewing.author || tempHandle(viewing.userId)) : (playerName || tempHandle(myId));
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

  // Watch a listed run back: the join already resolved the telemetry row id, so this is the same one-row
  // payload fetch Recent Games makes, handed to the same viewer. `startReplay` closes this overlay itself and
  // restores it on exit. An unplayable payload degrades the button to "No replay", never a broken viewer.
  const watchRun = (run: CareerRun): void => {
    if (run.replayRowId === null || run.id === null || watching !== null) return;
    sfx.pulse();
    setNoReplay(null);
    setWatching(run.id);
    void fetchReplayPayload(run.replayRowId)
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: shownName || undefined });
        else setNoReplay(run.id);
      })
      .finally(() => setWatching(null));
  };

  // Watch a practice game back: the twin of `watchRun`, reading the practice row's own `replay->v2` by id.
  const watchPractice = (game: PracticeGameRow): void => {
    if (!game.hasReplay || game.rowId === null || watchingPractice !== null) return;
    const id = game.rowId;
    sfx.pulse();
    setNoPracticeReplay(null);
    setWatchingPractice(id);
    void fetchPracticeReplay(id)
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: shownName || undefined });
        else setNoPracticeReplay(id);
      })
      .finally(() => setWatchingPractice(null));
  };

  const heroId = aggregates.mostPlayedHero ?? viewing?.favoriteHero ?? '';
  // SKINS: whose page this is, and the page owner's CURRENT loadout (public, read with their progression).
  const pageLoadout = accountProgression?.loadout ?? null;
  // (After Career's early return, so a plain object: this page re-renders rarely and its consumers are few.)
  const careerSkins = { own: !viewing, loadout: pageLoadout };
  const heroName = heroId ? getHero(heroId).name : '—';
  const matchRows = (runs ?? []).slice(0, MATCH_ROWS);
  const pickTab = (t: CenterTab): void => { if (t === tab) return; sfx.pulse(); setTab(t); saveTab(t); };

  let body: JSX.Element;
  if (!remoteEnabled()) {
    body = <PageState icon="mute" title="Career unavailable" body="This build has no backend configured, so there is no server record to show." />;
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
        icon="mute"
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
            {/* FAVORITE HERO (owner ask 2026-09-28: "clearly say favorite hero in the box"): the most-played hero,
                labelled. The player's name and title moved up into the page header. */}
            <div className="cv2-favlabel">Favorite hero</div>
            <HeroFrame heroId={heroId} skins={accountProgression?.loadout} />
            <div className="cv2-heroname">{heroName}</div>
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
                  <div className="cv2-state-ico"><Icon name="mute" /></div>
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
              ) : practiceRows.map((g, i) => (
                <PracticeRow
                  key={g.rowId ?? `${g.createdAt ?? ''}-${i}`}
                  game={g}
                  busy={watchingPractice !== null && watchingPractice === g.rowId}
                  unplayable={noPracticeReplay !== null && noPracticeReplay === g.rowId}
                  onWatch={() => watchPractice(g)}
                />
              ))}
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
                <div className="cv2-herogrid" aria-label="Heroes played">
                  {heroes.map((h) => <HeroTile key={h.heroId} h={h} />)}
                </div>
              )}
            </div>
          ) : (
            <div className="cv2-list" role="tabpanel">
              {matchRows.length === 0 ? (
                <div className="cv2-panel cv2-none">
                  <div className="cv2-state-ico"><Icon name="sword" /></div>
                  <div className="cv2-state-title">No runs yet</div>
                  <div className="cv2-state-body">{viewing ? `${shownName} hasn’t finished a lobby run yet.` : 'Finish a lobby run and it will appear here, final team and all.'}</div>
                </div>
              ) : matchRows.map((run, i) => (
                <MatchRow
                  key={run.id ?? i}
                  run={run}
                  focus={i === focusIndex}
                  busy={watching !== null && watching === run.id}
                  unplayable={noReplay !== null && noReplay === run.id}
                  onWatch={() => watchRun(run)}
                />
              ))}
            </div>
          )}
        </section>

        {/* RIGHT — Seasonal Ranked + Performance Trends */}
        <aside className="cv2-col cv2-right">
          <div className="cv2-colhead"><div className="cv2-sec"><Icon name="star" />Seasonal Ranked</div></div>
          <div className="cv2-panel cv2-ranked">
            {rank ? (
              <RankBar position={rank} size="big" layout="stack" caption={`${scalarCaption(rank)} MMR`} />
            ) : rankPending ? (
              <div className="cv2-rank-wait" aria-busy="true" aria-label="Loading rank" />
            ) : (
              <div className="cv2-mmr">
                <span className="cv2-mmr-v">{mmr}</span>
                <span className="cv2-mmr-l">MMR</span>
              </div>
            )}
          </div>
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
                    onClick={() => { if (window_ !== d) { sfx.pulse(); setWindow(d); } }}
                  >
                    {trendWindowLabel(d)}
                  </button>
                ))}
              </div>
            </div>
            {/* MMR FIRST (owner ask 2026-09-22): the crest above prints "N MMR" and, with a rated run in the window,
                this headline is that same number — crest → number → line — before the three rates that explain it.
                Raw ratings on a division-snapped axis (`mmrAxisOf`); nothing here animates. */}
            <TrendChart title="MMR" series={trends.mmr} {...mmrAxisOf(trends.mmr)} empty="No rated runs in this window" />
            <TrendChart title="Avg Placement" series={trends.placement} yMin={1} yMax={8} invert empty="No placements in this window" />
            <TrendChart title="Win Rate" series={trends.winRate} yMin={0} yMax={100} unit="%" empty="No placed runs in this window" />
            <TrendChart title="Avg APM" series={trends.apm} yMin={0} yMax={apmAxisMax(trends.apm)} empty="No replays with a clock in this window" />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <SidebarHost className="lbpage cv2-page">
      {/* Back + the main menu live in the left sidebar (owner ask 2026-09-21). Back keeps this page's own
          close, so a Career opened from the Leaderboard still returns there. */}
      <MenuSidebar current="career" onBack={back} />
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
      </div>
      <CareerSkinContext.Provider value={careerSkins}>
        <div className="lbscroll cv2-body">{body}</div>
      </CareerSkinContext.Provider>
    </SidebarHost>
  );
}
