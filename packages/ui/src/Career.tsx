import { useEffect, useMemo, useState } from 'react';
import { getHero } from '@game/sim';
import type { BoardSnapshot } from '@game/sim';
import { Card } from './Card';
import { storedCardView } from './storedBoardView';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, syncProfileFromServer, tempHandle, type CareerFocus } from './store';
import { fetchMyRuns, fetchReplayPayload, remoteEnabled } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';
import {
  TREND_WINDOWS, TRIBE_LABEL, careerAggregates, outcomeOf, playedOnText, polylineOf, runLengthText, trendSeries,
  type CareerRun, type TrendSeries, type TrendWindow,
} from './careerData';

/**
 * CAREER (owner rebuild 2026-09-19) — three columns on the game's page backdrop, after the Battlegrounds-style
 * mockup:
 *
 *  LEFT    the most-played hero in the SAME circular frame the recruit screen wears (the `.hero > .f >
 *          .heroimg` markup + rules from StatusBar, re-seated here without the tray transforms), its name
 *          plate, and four stat tiles — 1st Place Wins · Top 4 Finish · Avg Placement · Favorite Tribe.
 *  CENTRE  Match History — the account's last 10 runs FROM THE SERVER (`fetchMyRuns`; never local-only runs):
 *          hero + record · the final team as 7 small card tiles · the outcome block (VICTORY / placement,
 *          date + run length, Gold) and ONE button, WATCH REPLAY, live only when a telemetry replay exists.
 *  RIGHT   Seasonal Ranked — the account's MMR as a plain number (the server-synced profile rating) with the
 *          last run's delta beside it — and Performance Trends: Avg Placement · Fight Win Rate · Avg APM as
 *          inline-SVG lines over a 7 / 30 / 90-day window.
 *
 * Every number comes from `careerData.ts` (pure, tested). The fetch is cached on the store so reopening
 * paints at once and refreshes behind; a finished run or a career reset bumps `careerVersion` and refetches.
 * Read-only; opened by the title's Career button (and by the leaderboard / Recent Games for another player).
 */

/** Rows fetched for the trends + tiles (light); the newest `CAREER_DETAIL_ROWS` of them carry the board. */
const FETCH_LIMIT = 100;
const MATCH_ROWS = 10;
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

/** The final team — exactly 7 slots, the real `Card` at a small scale, empty slots blank. */
function FinalTeam({ board }: { board: BoardSnapshot }) {
  const minions = board.minions.slice(0, BOARD_SLOTS);
  return (
    <div className="cv2-team" aria-label="Final team">
      {Array.from({ length: BOARD_SLOTS }, (_, i) => {
        const m = minions[i];
        return m
          ? <div className="cv2-tile" key={i}><div className="cv2-tile-scale"><Card card={storedCardView(m)} suppressPop /></div></div>
          : <div className="cv2-tile empty" key={i} aria-hidden="true" />;
      })}
    </div>
  );
}

/** A labelled small-caps stat with a big value — the left column's tiles + the outcome block's Gold. */
function StatTile({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="cv2-stat">
      {icon && <span className="cv2-stat-ico"><Icon name={icon} /></span>}
      <span className="cv2-stat-v">{value}</span>
      <span className="cv2-stat-l">{label}</span>
    </div>
  );
}

const CHART_W = 300, CHART_H = 96, CHART_PAD = 8;

/** One trend: a static inline-SVG polyline (no library, nothing animated) with the window average as the
 *  headline and the axis extremes labelled. `invert` puts `yMin` at the top (placement: 1st reads high). */
function TrendChart({ title, series, yMin, yMax, invert, unit, empty }: {
  title: string; series: TrendSeries; yMin: number; yMax: number; invert?: boolean; unit?: string; empty: string;
}) {
  const pts = polylineOf(series.points, { w: CHART_W, h: CHART_H, pad: CHART_PAD, yMin, yMax, invert });
  const one = series.points.length === 1 ? pts.split(',').map(Number) : null;
  const avgText = series.avg === null ? '—' : `${series.avg}${unit ?? ''}`;
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
          {series.points.length > 1 && <polyline className="cv2-line" points={pts} />}
          {one && <line className="cv2-line cv2-dot" x1={one[0]} y1={one[1]} x2={one[0]} y2={one[1]} />}
        </svg>
        <span className="cv2-axis top">{invert ? yMin : yMax}{unit}</span>
        <span className="cv2-axis bottom">{invert ? yMax : yMin}{unit}</span>
        {series.points.length === 0 && <span className="cv2-chart-empty">{empty}</span>}
      </div>
      <div className="cv2-trend-foot">{series.points.length} run{series.points.length === 1 ? '' : 's'}</div>
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
    // `profiles` row and this is the number the Seasonal Ranked card prints.
    if (!viewing) syncProfileFromServer(playerName);
    return () => { live = false; };
    // `cache` is deliberately NOT a dep: the effect writes it, and re-running on that write would refetch forever.
  }, [show, cacheKey, userId, viewing, playerName, fetchTick, setCache]);

  const aggregates = useMemo(() => careerAggregates(runs ?? []), [runs]);
  const trends = useMemo(() => trendSeries(runs ?? [], window_, Date.now()), [runs, window_]);
  const focusIndex = useMemo(() => (runs ? focusIndexOf(runs, viewing?.focus) : -1), [runs, viewing?.focus]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const shownName = viewing ? (viewing.author || tempHandle(viewing.userId)) : (playerName || tempHandle(myId));
  const mmr = viewing ? viewing.rating : profile.rating;
  const lastDelta = runs?.[0]?.ratingDelta ?? null;

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

  let body: JSX.Element;
  if (!remoteEnabled()) {
    body = <div className="lbempty">Career unavailable — no backend configured.</div>;
  } else if (!userId) {
    body = (
      <div className="lbempty cv2-signin">
        <div>Sign in to see your career.</div>
        <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</button>
      </div>
    );
  } else if (runs === undefined) {
    body = <div className="lbempty">Loading…</div>;
  } else if (runs === null) {
    body = (
      <div className="lbempty cv2-signin">
        <div>Couldn’t reach the server.</div>
        <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); setFetchTick((t) => t + 1); }}>Retry</button>
      </div>
    );
  } else {
    body = (
      <div className="cv2-cols">
        {/* LEFT — most-played hero + the four tiles */}
        <aside className="cv2-panel cv2-left">
          <HeroFrame heroId={heroId} />
          <div className="cv2-heroname">{heroName}</div>
          <div className="cv2-playername">{shownName}</div>
          <div className="cv2-tiles">
            <StatTile icon="crown" label="1st Place Wins" value={String(aggregates.firsts)} />
            <StatTile icon="shield" label="Top 4 Finish" value={aggregates.top4Pct === null ? '—' : `${aggregates.top4Pct}%`} />
            <StatTile icon="star" label="Avg Placement" value={aggregates.avgPlacement === null ? '—' : String(aggregates.avgPlacement)} />
            <StatTile icon="paw" label="Favorite Tribe" value={aggregates.favoriteTribe ? TRIBE_LABEL[aggregates.favoriteTribe] : '—'} />
          </div>
        </aside>

        {/* CENTRE — Match History */}
        <section className="cv2-center">
          <div className="cv2-sec"><Icon name="clock" />Match History</div>
          {matchRows.length === 0 ? (
            <div className="cv2-panel cv2-none">{viewing ? `No runs to show for ${shownName}.` : 'No runs yet — play a run to start your career.'}</div>
          ) : matchRows.map((run, i) => {
            const o = outcomeOf(run.placement);
            const when = playedOnText(run.atMs);
            const length = runLengthText(run.durationMs);
            const watchable = run.replayRowId !== null;
            const busy = watching !== null && watching === run.id;
            const unplayable = noReplay !== null && noReplay === run.id;
            const hasBoard = !!run.board && run.board.minions.length > 0;
            return (
              <div className={`cv2-row${hasBoard ? '' : ' noboard'}${i === focusIndex ? ' focus' : ''}`} key={run.id ?? i}>
                <div className="cv2-row-hero">
                  <HeroFrame heroId={run.heroId} small />
                  <div className="cv2-row-heroname">{run.heroId ? getHero(run.heroId).name : '—'}</div>
                  <div className={`cv2-row-record ${run.wins >= run.losses ? 'won' : 'lost'}`}>{run.wins}–{run.losses}</div>
                </div>
                {hasBoard && (
                  <div className="cv2-row-team">
                    <div className="cv2-row-label">Final Team</div>
                    <FinalTeam board={run.board!} />
                  </div>
                )}
                <div className="cv2-row-outcome">
                  <div className="cv2-row-label">Match Outcome</div>
                  <div className={`cv2-verdict ${o.cls}`}>{o.label}</div>
                  <div className="cv2-row-when">{when}{when && length !== '—' ? ' · ' : ''}{length !== '—' ? length : (when ? '' : '—')}</div>
                  <div className="cv2-row-gold"><span className="cv2-row-gold-l">Gold</span><span className="cv2-row-gold-v">{run.goldSpent === null ? '—' : run.goldSpent}</span></div>
                  <button
                    type="button"
                    className="cv2-btn cv2-watch pressable"
                    disabled={!watchable || busy || unplayable}
                    onClick={() => watchRun(run)}
                    aria-label={watchable ? 'Watch this run’s replay' : 'No replay stored for this run'}
                  >
                    {busy ? 'Loading…' : unplayable ? 'No replay' : 'Watch Replay'}
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        {/* RIGHT — Seasonal Ranked + Performance Trends */}
        <aside className="cv2-right">
          <div className="cv2-panel cv2-ranked">
            <div className="cv2-sec">Seasonal Ranked</div>
            <div className="cv2-mmr">
              <span className="cv2-mmr-l">MMR</span>
              <span className="cv2-mmr-v">{mmr}</span>
              {lastDelta !== null && (
                <span className={`cv2-mmr-d ${lastDelta >= 0 ? 'up' : 'down'}`}>{lastDelta >= 0 ? '+' : '−'}{Math.abs(lastDelta)}</span>
              )}
            </div>
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
            <TrendChart title="Fight Win Rate" series={trends.winRate} yMin={0} yMax={100} unit="%" empty="No fights in this window" />
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
      <div className="lbscroll">{body}</div>
    </div>
  );
}
