import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RUNE_INDEX } from '@game/content';
import { getHero } from '@game/sim';
import type { BoardSnapshot } from '@game/sim';
import { Card, mdBold } from './Card';
import { storedCardView } from './storedBoardView';
import { heroArt, runeArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, syncProfileFromServer, tempHandle, type CareerFocus } from './store';
import { fetchMyRuns, fetchReplayPayload, remoteEnabled } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import { RankBar } from './rank/RankBar';
import { scalarCaption } from './rank/rankFormat';
import { rankPositionOf } from './rank/types';
import {
  TREND_WINDOWS, TRIBE_LABEL, careerAggregates, heroCareers, matchResultOf, ordinalOf, outcomeOf, playedOnText, polylineOf, runLengthText,
  trendSeries, type CareerRun, type HeroCareer, type TrendSeries, type TrendWindow,
} from './careerData';

/**
 * CAREER (owner rebuild 2026-09-19/20) — three columns on the game's page backdrop, after the Battlegrounds-style
 * mockup:
 *
 *  LEFT    the most-played hero in the SAME circular frame the recruit screen wears (the `.hero > .f >
 *          .heroimg` markup + rules from StatusBar, re-seated here without the tray transforms), its name
 *          plate, and four stat tiles — 1st Place Wins · Top 4 Finish · Avg Placement · Favorite Tribe.
 *  CENTRE  two tabs in the column header (MATCH HISTORY | HEROES, the choice persisted per browser):
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
 *          Only this column scrolls; the side columns stay put. All three columns share one header row
 *          (`.cv2-colhead`), so their panels start level.
 *  RIGHT   Seasonal Ranked — the account's MMR as a bare number (the server-synced profile rating; no delta,
 *          no divisions) — and Performance Trends: Avg Placement · Win Rate · Avg APM as inline-SVG lines over
 *          a 7 / 30 / 90-day window.
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
 *  account has (a light row is ~200 bytes); the newest `CAREER_DETAIL_ROWS` of them also carry the board. */
const FETCH_LIMIT = 1000;
/** Which centre tab is open, persisted per browser (owner ask 2026-09-20). */
const TAB_KEY = 'ascent.career.tab';
type CenterTab = 'history' | 'heroes';
function loadTab(): CenterTab {
  try { return localStorage.getItem(TAB_KEY) === 'heroes' ? 'heroes' : 'history'; } catch { return 'history'; }
}
function saveTab(t: CenterTab): void {
  try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable — the choice just doesn't persist */ }
}
/** Banners in Match History — the newest 25 server runs (owner 2026-09-20; was 10). Matches `CAREER_DETAIL_ROWS`. */
const MATCH_ROWS = 25;
const BOARD_SLOTS = 7;

/** The in-run hero frame, re-seated: the same `.hero > .f > img.heroimg` markup StatusBar renders (so the
 *  ring, disc and portrait rules are shared), scoped under `.cv2-heroframe` which only undoes the tray's
 *  transforms. `small` is the match-row portrait. */
function HeroFrame({ heroId, small }: { heroId: string; small?: boolean }) {
  const art = heroArt(heroId);
  const name = heroId ? getHero(heroId).name : '';
  return (
    <div className={`cv2-heroframe${small ? ' small' : ''}`}>
      <div className="hero">
        <div className="f">
          {art ? <img decoding="sync" className="heroimg" src={art} alt={name} draggable={false} /> : <Icon name="anvil" />}
        </div>
      </div>
    </div>
  );
}

/** The final team — exactly 7 slots, the real `Card` at the leaderboard's tile size, empty slots blank. */
function FinalTeam({ board }: { board: BoardSnapshot }) {
  const minions = board.minions.slice(0, BOARD_SLOTS);
  return (
    <div className="cv2-team" aria-label="Final team">
      {Array.from({ length: BOARD_SLOTS }, (_, i) => {
        const m = minions[i];
        return m
          ? <div className="cv2-tile" key={i}><Card card={storedCardView(m)} suppressPop /></div>
          : <div className="cv2-tile empty" key={i} aria-hidden="true" />;
      })}
    </div>
  );
}

/** One rune the run picked: its emblem (the real rune art) + name; hovering floats the rune's text in a
 *  styled panel (portalled + fixed, so the scrolling list never clips it — never a native tooltip). */
function RuneEmblem({ runeId }: { runeId: string }) {
  const rune = RUNE_INDEX[runeId];
  const [tip, setTip] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (!rune) return null;
  const art = runeArt(rune.id);
  const show = (el: HTMLElement): void => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // One layout read per hover (never per frame): anchor the panel under the emblem, centred, flipping
      // above when the row sits near the bottom of the screen.
      const r = el.getBoundingClientRect();
      const w = 280;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      const above = r.bottom + 150 > window.innerHeight;
      setTip({ left, top: above ? r.top - 10 : r.bottom + 10, above });
    }, 160);
  };
  const hide = (): void => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    setTip(null);
  };
  return (
    <div className={`cv2-rune${rune.epic ? ' epic' : ''}`} onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={hide}>
      <div className="cv2-rune-disc">
        {art ? <img decoding="sync" className="cv2-rune-art" src={art} alt="" aria-hidden /> : <span className="cv2-rune-emblem" aria-hidden><Icon name="anvil" /></span>}
      </div>
      <div className="cv2-rune-name">{rune.name}</div>
      {tip && createPortal(
        <div className={`cv2-rune-tip${tip.above ? ' above' : ''}`} role="tooltip" style={{ left: tip.left, top: tip.top }}>
          <div className="cv2-rune-tip-name">{rune.name}<span className="cv2-rune-tip-kind">{rune.epic ? 'Epic Rune' : 'Rune'}</span></div>
          <div className="cv2-rune-tip-body" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
        </div>,
        document.body,
      )}
    </div>
  );
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

/** One trend: a static inline-SVG polyline (no library, nothing animated) with the window average as the
 *  headline and the axis extremes labelled. `invert` puts `yMin` at the top (placement: 1st reads high). */
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
  return (
    <article className={`cv2-row ${o.cls}${focus ? ' focus' : ''}`} aria-label={`${run.heroId ? getHero(run.heroId).name : 'Run'} — ${o.label}`}>
      <header className="cv2-row-head">
        <div className="cv2-row-hero">
          <HeroFrame heroId={run.heroId} small />
          <div className="cv2-row-heroid">
            <div className="cv2-row-heroname">{run.heroId ? getHero(run.heroId).name : '—'}</div>
            {/* The MATCH result — by placement (top 4 = WIN, 5th–8th = LOSS; owner 2026-09-20). The fight
                record is only a small caption beneath it — a bare "N–M" (owner 2026-09-21: no "Fights" word;
                the aria-label keeps the meaning) — and only when the run recorded any fights. */}
            <div className={`cv2-row-result ${result.cls}`} aria-label={result.cls === 'none' ? 'No placement recorded' : `Match ${result.label.toLowerCase()}`}>
              {result.label}
            </div>
            {fights > 0 && (
              <div className="cv2-row-fights" aria-label={`Fights: ${run.wins} won, ${run.losses} lost`}>
                {run.wins}–{run.losses}
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
        <button
          type="button"
          className="cv2-btn cv2-watch pressable"
          disabled={!watchable || busy || unplayable}
          onClick={onWatch}
          aria-label={watchable ? 'Watch this run’s replay' : 'No replay stored for this run'}
        >
          <Icon name="eye" />{busy ? 'Loading…' : unplayable ? 'No replay' : 'Watch Replay'}
        </button>
      </footer>
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
  const [tip, setTip] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null);
  const timer = useRef<number | null>(null);
  const tipId = `cv2-herotip-${h.heroId}`;
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const place = (el: HTMLElement): void => {
    // One layout read per show (never per frame).
    const r = el.getBoundingClientRect();
    const gap = 12;
    const fitsRight = r.right + gap + HERO_TIP_W + 8 <= window.innerWidth;
    const side: 'right' | 'left' = fitsRight ? 'right' : 'left';
    const left = fitsRight ? r.right + gap : Math.max(8, r.left - gap - HERO_TIP_W);
    const top = Math.max(8, Math.min(window.innerHeight - HERO_TIP_H - 8, r.top + r.height / 2 - HERO_TIP_H / 2));
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
      aria-label={`${name} — ${games}`}
      aria-describedby={tip ? tipId : undefined}
      onMouseEnter={(e) => show(e.currentTarget, 160)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget, 0)}
      onBlur={hide}
    >
      <HeroFrame heroId={h.heroId} />
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
        document.body,
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
  const [tab, setTab] = useState<CenterTab>(loadTab);
  const [watching, setWatching] = useState<number | null>(null); // run id whose replay is loading
  const [noReplay, setNoReplay] = useState<number | null>(null); // run id whose payload came back unplayable

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

  const aggregates = useMemo(() => careerAggregates(runs ?? []), [runs]);
  const trends = useMemo(() => trendSeries(runs ?? [], window_, Date.now()), [runs, window_]);
  const heroes = useMemo(() => heroCareers(runs ?? []), [runs]);
  const focusIndex = useMemo(() => (runs ? focusIndexOf(runs, viewing?.focus) : -1), [runs, viewing?.focus]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const shownName = viewing ? (viewing.author || tempHandle(viewing.userId)) : (playerName || tempHandle(myId));
  const mmr = viewing ? viewing.rating : profile.rating;
  // MEDAL RANK (2026-09-20): the Seasonal Ranked card shows the crest + division bar once a rank exists on the
  // profile (or on the viewed player's row); the scalar stays as a small caption. No rank → the bare number.
  const rank = rankPositionOf(viewing ? (viewing as { rank?: unknown }).rank : profile.rank);

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

  const heroId = aggregates.mostPlayedHero ?? viewing?.favoriteHero ?? '';
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
        {/* LEFT — most-played hero + the four tiles */}
        <aside className="cv2-col cv2-leftcol">
          <div className="cv2-colhead"><div className="cv2-sec"><Icon name="crown" />Career Stats</div></div>
          <div className="cv2-panel cv2-left">
            <HeroFrame heroId={heroId} />
            <div className="cv2-heroname">{heroName}</div>
            <div className="cv2-playername">{shownName}</div>
            <div className="cv2-tiles">
              <StatTile icon="crown" label="1st Place Wins" value={String(aggregates.firsts)} />
              <StatTile icon="shield" label="Top 4 Finish" value={aggregates.top4Pct === null ? '—' : `${aggregates.top4Pct}%`} />
              <StatTile icon="star" label="Avg Placement" value={aggregates.avgPlacement === null ? '—' : String(aggregates.avgPlacement)} />
              <StatTile icon="paw" label="Favorite Tribe" value={aggregates.favoriteTribe ? TRIBE_LABEL[aggregates.favoriteTribe] : '—'} />
            </div>
          </div>
        </aside>

        {/* CENTRE — Match History | Heroes (the only column that scrolls) */}
        <section className="cv2-col cv2-center" aria-label={tab === 'heroes' ? 'Heroes' : 'Match History'}>
          <div className="cv2-colhead cv2-center-head">
            <div className="cv2-tabs" role="tablist" aria-label="Career view">
              <button type="button" role="tab" className={`cv2-tab${tab === 'history' ? ' on' : ''}`} aria-selected={tab === 'history'} onClick={() => pickTab('history')}>
                <Icon name="clock" />Match History
              </button>
              <button type="button" role="tab" className={`cv2-tab${tab === 'heroes' ? ' on' : ''}`} aria-selected={tab === 'heroes'} onClick={() => pickTab('heroes')}>
                <Icon name="taunt" />Heroes
              </button>
            </div>
            <span className="cv2-sec-sub">
              {tab === 'heroes'
                ? (heroes.length ? `${heroes.length} hero${heroes.length === 1 ? '' : 'es'} played` : '')
                : (matchRows.length ? `Last ${matchRows.length} run${matchRows.length === 1 ? '' : 's'}` : '')}
            </span>
          </div>
          {tab === 'heroes' ? (
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
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <TrendChart title="Avg Placement" series={trends.placement} yMin={1} yMax={8} invert empty="No placements in this window" />
            <TrendChart title="Win Rate" series={trends.winRate} yMin={0} yMax={100} unit="%" empty="No placed runs in this window" />
            <TrendChart title="Avg APM" series={trends.apm} yMin={0} yMax={apmAxisMax(trends.apm)} empty="No replays with a clock in this window" />
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="lbpage cv2-page">
      <div className="lbtopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="taunt" />
          <div>
            <div className="esch disp">{viewing ? `${shownName}’s Career` : 'Career'}</div>
            <div className="lbsub">{viewing ? 'Their record of climbs' : 'Your record of climbs'}</div>
          </div>
        </div>
      </div>
      <div className="lbscroll cv2-body">{body}</div>
    </div>
  );
}
