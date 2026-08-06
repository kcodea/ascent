import { useEffect, useMemo, useState } from 'react';
import { aggregatePlayerReport, cardDemand, getHero, goldCurve, upgradeShape, wilson, SAMPLE_GATES, type DerivedRun, type PlayerReport, type PlayerReportRow, type ShopCurve } from '@game/sim';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchDerivedRuns, fetchRunTelemetry, remoteEnabled } from './remoteBoards';
import { buildCardCsv, type RunTelemetry } from '@game/sim';
import { CARD_INDEX, cardRevisions } from '@game/content';

/**
 * Balance Report (owner request 2026-07-13) — the REAL-PLAYER balance report, opened from the home screen. It
 * fetches recent finished-run telemetry (`run_telemetry`, reconstructed from each run's replay at run-end) and
 * aggregates it client-side into offer / pick / win / average tables for heroes, quests, runes, minions, and spells.
 * This is PLAYER data, not simulation — the seeded greedy-bot report still lives at `npm run report` (CLI). Best-
 * effort: empty until the backend is configured + the `run_telemetry` table migrated (see schema.sql).
 *
 * Redesign (owner 2026-07-14): ONE table at a time, full-screen + large text, picked from a dropdown, and every
 * column (Name included) is click-to-sort. Beats five tiny side-by-side tables you couldn't read or reorder.
 */
// offer/pick/win are per-run RATES (%); seen/bought are raw COUNTS (a card is seen many times per run); buypct =
// bought/seen. avgTurns shows DNF when a quest was taken but never completed.
type Col = 'offer' | 'pick' | 'win' | 'avgWins' | 'avgTurns' | 'n' | 'seen' | 'bought' | 'buypct'
  | 'shopSeen' | 'shopBought' | 'discSeen' | 'discBought' | 'discpct'
  // Placement analytics (owner ask 2026-08-02) — only populated from rows carrying a placement, i.e. lobby
  // runs finished since the 2026-08-02 capture. `pn` is that sample size, shown so a 1-run average is visible
  // AS a 1-run average rather than read as a trend.
  | 'avgPlace' | 'firstPct' | 'lastPct' | 'pn';
const COL_LABEL: Record<Col, string> = {
  offer: 'Offer', pick: 'Pick', win: 'Win', avgWins: 'Avg Wins', avgTurns: 'Avg Turns', n: 'n', seen: 'Seen', bought: 'Bought', buypct: 'Buy %',
  shopSeen: 'Shop Seen', shopBought: 'Shop Buy', discSeen: 'Disc Seen', discBought: 'Disc Buy', discpct: 'Disc %',
  avgPlace: 'Avg Place', firstPct: '1st %', lastPct: '8th %', pn: 'placed n',
};

/** The report sections, in dropdown order — each names the rows it reads off the aggregate + the columns it shows. */
type Section = { key: keyof PlayerReport & ('heroes' | 'quests' | 'runes' | 'minions' | 'spells'); label: string; cols: Col[] };
const SECTIONS: Section[] = [
  { key: 'minions', label: 'Minions', cols: ['shopSeen', 'shopBought', 'discSeen', 'discBought', 'discpct', 'buypct', 'avgPlace', 'firstPct', 'lastPct', 'pn'] },
  { key: 'spells', label: 'Spells', cols: ['shopSeen', 'shopBought', 'discSeen', 'discBought', 'discpct', 'buypct', 'avgPlace', 'firstPct', 'lastPct', 'pn'] },
  { key: 'heroes', label: 'Heroes', cols: ['offer', 'pick', 'win', 'avgWins', 'n', 'avgPlace', 'firstPct', 'lastPct', 'pn'] },
  { key: 'quests', label: 'Quests', cols: ['offer', 'pick', 'win', 'avgTurns', 'n', 'avgPlace', 'firstPct', 'lastPct', 'pn'] },
  { key: 'runes', label: 'Runes', cols: ['offer', 'pick', 'win', 'n', 'avgPlace', 'firstPct', 'lastPct', 'pn'] },
];
/** The chart section is not a table — it renders the shop-leveling curve instead of rows. */
const SHOP_CURVE = 'shopcurve' as const;
/** The DERIVED sections (2026-08-06) — read the runDerive streams (`derived` jsonb) rather than the flat
 *  telemetry row: true per-copy demand with Wilson intervals, the Gold ledger curve, and upgrade behaviour.
 *  Empty until the 2026-08-05 schema migration has been run and runs have banked derived payloads. */
const DEMAND = 'demand' as const;
const ECONOMY = 'economy' as const;
const UPGRADES = 'upgrades' as const;
type SectionKey = Section['key'] | typeof SHOP_CURVE | typeof DEMAND | typeof ECONOMY | typeof UPGRADES;

const fmtPct = (n: number): string => (n < 0 ? '–' : `${n}%`);
const fmtNum = (n: number | null): string => (n === null ? '–' : String(n));
/** Win-rate → a coarse hue class so hot/cold entries pop. */
function heat(n: number): string {
  if (n < 0) return '';
  if (n >= 55) return ' hot';
  if (n >= 35) return ' warm';
  if (n >= 20) return ' cool';
  return ' cold';
}

function cellFor(r: PlayerReportRow, c: Col): { text: string; cls: string } {
  switch (c) {
    case 'offer': return { text: fmtPct(r.offerRate), cls: 'balnum' };
    case 'pick': return { text: fmtPct(r.pickRate), cls: 'balnum' };
    case 'win': return { text: fmtPct(r.winRate), cls: `balnum balwin${heat(r.winRate)}` };
    case 'avgWins': return { text: fmtNum(r.avgWins), cls: 'balnum' };
    // Quests: "DNF" when it was picked but never completed (no completion turn recorded); else the avg turn.
    case 'avgTurns': return { text: r.avgTurns === null ? (r.picked > 0 ? 'DNF' : '–') : String(r.avgTurns), cls: `balnum${r.avgTurns === null && r.picked > 0 ? ' balwin cold' : ''}` };
    case 'seen': return { text: String(r.offered), cls: 'balnum' };
    case 'bought': return { text: String(r.picked), cls: 'balnum' };
    case 'buypct': return { text: fmtPct(r.pickRate), cls: 'balnum' };
    case 'discpct': return { text: r.discoverOffered > 0 ? fmtPct(Math.round((100 * r.discoverPicked) / r.discoverOffered)) : '–', cls: 'balnum' };
    case 'shopSeen': return { text: String(r.shopOffered), cls: 'balnum' };
    case 'shopBought': return { text: String(r.shopPicked), cls: 'balnum' };
    case 'discSeen': return { text: String(r.discoverOffered), cls: 'balnum' };
    case 'discBought': return { text: String(r.discoverPicked), cls: 'balnum' };
    case 'n': return { text: String(r.games || r.picked), cls: 'balnum baldim' };
    // Placement columns read '–' with no placed sample, so an empty cell means "no data yet" rather than a
    // finish of zero. Avg place heats INVERTED (1st is good, 8th is bad).
    case 'avgPlace': return { text: fmtNum(r.avgPlace), cls: `balnum${r.avgPlace === null ? '' : ` balwin${placeHeat(r.avgPlace)}`}` };
    case 'firstPct': return { text: r.placedGames > 0 ? fmtPct(r.firstRate) : '–', cls: 'balnum' };
    case 'lastPct': return { text: r.placedGames > 0 ? fmtPct(r.lastRate) : '–', cls: 'balnum' };
    case 'pn': return { text: String(r.placedGames), cls: 'balnum baldim' };
  }
}

/** One hue per placement: 1st green → 8th red, evenly around the good→bad arc. */
const placeHue = (place: number): string => `hsl(${Math.round(140 - ((place - 1) / 7) * 140)} 70% 58%)`;
const ordinal = (n: number): string => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || (n % 100 >= 11 && n % 100 <= 13) ? 0 : n % 10] ?? 'th'}`;

/** Avg-placement heat, INVERTED against win rate: a LOW number is a good finish. */
function placeHeat(avg: number): string {
  if (avg <= 3) return ' hot';
  if (avg >= 5.5) return ' cold';
  return '';
}

/** The comparable value for a column — a number (missing → null, always sorted to the bottom). `name` sorts
 *  by the display name (handled separately, as a string). */
function sortValue(r: PlayerReportRow, c: Col): number | null {
  switch (c) {
    case 'offer': return r.offerRate < 0 ? null : r.offerRate;
    case 'pick': case 'buypct': return r.pickRate < 0 ? null : r.pickRate;
    case 'win': return r.winRate < 0 ? null : r.winRate;
    case 'avgWins': return r.avgWins;
    case 'avgTurns': return r.avgTurns; // DNF (picked but null) + never-picked both read null → bottom
    case 'seen': return r.offered;
    case 'bought': return r.picked;
    case 'shopSeen': return r.shopOffered;
    case 'shopBought': return r.shopPicked;
    case 'discSeen': return r.discoverOffered;
    case 'discBought': return r.discoverPicked;
    case 'discpct': return r.discoverOffered > 0 ? Math.round((100 * r.discoverPicked) / r.discoverOffered) : null;
    case 'n': return r.games || r.picked;
    // Avg place sorts ASCENDING-good; the table's default is descending, so the raw value is right (a click
    // flips it) — null when no placed sample, which sinks to the bottom like every other missing value.
    case 'avgPlace': return r.avgPlace;
    case 'firstPct': return r.placedGames > 0 ? r.firstRate : null;
    case 'lastPct': return r.placedGames > 0 ? r.lastRate : null;
    case 'pn': return r.placedGames;
  }
}

type SortKey = Col | 'name';

function SortableTable({ section, rows }: { section: Section; rows: PlayerReportRow[] }) {
  // Default: the section's first data column, descending (biggest sample / most-picked first).
  const [key, setKey] = useState<SortKey>(section.cols[0] ?? 'name');
  const [dir, setDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name) * dir;
      const va = sortValue(a, key), vb = sortValue(b, key);
      if (va === null && vb === null) return a.name.localeCompare(b.name); // stable-ish tiebreak
      if (va === null) return 1; // missing values always sink, regardless of direction
      if (vb === null) return -1;
      return va === vb ? a.name.localeCompare(b.name) : (va - vb) * dir;
    });
    return arr;
  }, [rows, key, dir]);

  const clickHead = (k: SortKey): void => {
    sfx.tick();
    if (k === key) { setDir((d) => (d === 1 ? -1 : 1)); return; }
    setKey(k);
    setDir(k === 'name' ? 1 : -1); // names default A→Z; numbers default high→low
  };
  const arrow = (k: SortKey): string => (k === key ? (dir === -1 ? ' ▾' : ' ▴') : '');

  return (
    <div className="balsolo" style={{ ['--balcols' as string]: section.cols.length }}>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balhead" role="row">
          <button role="columnheader" className={`balsort balname${key === 'name' ? ' on' : ''}`} onClick={() => clickHead('name')}>Name{arrow('name')}</button>
          {section.cols.map((c) => (
            <button key={c} role="columnheader" className={`balsort balnum${key === c ? ' on' : ''}`} onClick={() => clickHead(c)}>{COL_LABEL[c]}{arrow(c)}</button>
          ))}
        </div>
        {sorted.map((r) => (
          <div className="balrow" role="row" key={r.id}>
            <span role="cell" className="balname" title={`${r.name} (${r.id})`}>{r.name}</span>
            {section.cols.map((c) => { const cell = cellFor(r, c); return <span key={c} role="cell" className={cell.cls}>{cell.text}</span>; })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BalancePanel() {
  const show = useGame((s) => s.showBalance);
  const close = useGame((s) => s.closeBalance);
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [rawRows, setRawRows] = useState<RunTelemetry[]>([]); // kept for the CSV export (per-card analytics)
  const [derived, setDerived] = useState<DerivedRun[]>([]); // the runDerive payloads (demand/economy/upgrade views)
  const [loading, setLoading] = useState(false);
  const [sectionKey, setSectionKey] = useState<SectionKey>('minions');
  // HERO FILTER (owner ask 2026-08-02: "what minions does Robin buy vs Guardian"). Re-AGGREGATES from the raw
  // rows rather than filtering the finished tables — a hero's card/rune/quest stats are only meaningful when
  // the denominators (offer counts, run totals, the curve) are that hero's too.
  const [heroFilter, setHeroFilter] = useState<string>('');

  const load = (): void => {
    setLoading(true);
    setReport(null);
    // The report reads the LADDER only (owner rework 2026-07-31): lobby rows; pre-rework rows carry no mode.
    void fetchRunTelemetry(1000).then((rowsAll) => {
      const rows = rowsAll.filter((t) => t.mode === 'lobby');
      setRawRows(rows);
      setReport(aggregatePlayerReport(rows));
      setLoading(false);
    });
    // The derived streams load in parallel and independently: a pre-migration DB returns [] here while the
    // flat report above still works, so the classic sections never wait on (or break with) the new ones.
    void fetchDerivedRuns(200).then(setDerived);
  };

  // Export the per-card acquisition analytics (buy turns, win-rate impact, source split) as a CSV download —
  // the spreadsheet the owner analyzes offline (owner ask 2026-07-16).
  const exportCsv = (): void => {
    sfx.pulse();
    const csv = buildCardCsv(rawRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ascent-cards-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => { if (show) load(); }, [show]);

  // Re-aggregate whenever the hero filter moves. Cheap (client-side over ≤1000 rows) and keeps ONE aggregation
  // path, so a filtered view can never drift from the unfiltered one.
  const shown = useMemo(() => {
    if (!heroFilter) return report;
    const rows = rawRows.filter((r) => r.heroId === heroFilter);
    return rows.length > 0 ? aggregatePlayerReport(rows) : null;
  }, [report, rawRows, heroFilter]);
  // Every hero that actually appears in the data, so the dropdown never offers an empty slice.
  const heroIds = useMemo(() => [...new Set(rawRows.map((r) => r.heroId))].sort(), [rawRows]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const refresh = (): void => { sfx.pulse(); load(); };
  const isCurve = sectionKey === SHOP_CURVE;
  const isDerived = sectionKey === DEMAND || sectionKey === ECONOMY || sectionKey === UPGRADES;
  const section = SECTIONS.find((s) => s.key === sectionKey) ?? SECTIONS[0]!;
  const rows = shown && !isCurve && !isDerived ? shown[section.key] : [];

  return (
    <div className="balpage">
      <div className="baltopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        {/* Section picker + Refresh, centred at the top. */}
        <div className="balhead-c">
          <div className="balcontrols">
            <select
              className="balpick"
              value={sectionKey}
              onChange={(e) => { sfx.pulse(); setSectionKey(e.target.value as SectionKey); }}
              aria-label="Choose report"
            >
              {SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}{shown ? ` (${shown[s.key].length})` : ''}</option>
              ))}
              <option value={SHOP_CURVE}>Shop Curve</option>
              <option value={DEMAND}>Card Demand (derived){derived.length ? ` (${derived.length} runs)` : ''}</option>
              <option value={ECONOMY}>Gold Economy (derived)</option>
              <option value={UPGRADES}>Upgrade Timing (derived)</option>
            </select>
            {/* HERO SLICE: re-aggregates the whole report for one hero (owner ask 2026-08-02). */}
            <select
              className="balpick"
              value={heroFilter}
              onChange={(e) => { sfx.pulse(); setHeroFilter(e.target.value); }}
              aria-label="Filter by hero"
              disabled={heroIds.length === 0}
            >
              <option value="">All heroes</option>
              {heroIds.map((h) => (
                <option key={h} value={h}>{getHero(h).name}</option>
              ))}
            </select>
            <button className="balrun" disabled={loading} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button className="balrun" disabled={loading || rawRows.length === 0} onClick={exportCsv}
              title="Download per-card analytics (buy turns, win-rate impact, source split) as a spreadsheet">
              Export CSV
            </button>
          </div>
          <div className="balsub">
            Real player data{shown ? ` · ${shown.totalRuns} runs` : ''}
            {heroFilter ? ` · ${getHero(heroFilter).name} only` : ''}
          </div>
        </div>
      </div>

      <div className="balscroll">
        {!remoteEnabled() ? (
          <div className="balempty">Balance report unavailable — no backend configured.</div>
        ) : loading ? (
          <div className="balempty">Loading player data…</div>
        ) : isDerived ? (
          derived.length === 0 ? (
            <div className="balempty">
              No derived runs yet. These views read the <code>derived</code> payload each finished run uploads —
              empty until the 2026-08-05 <code>run_telemetry</code> migration has been run and runs have banked since.
            </div>
          ) : sectionKey === DEMAND ? <DemandTable runs={derived} />
            : sectionKey === ECONOMY ? <EconomyTable runs={derived} />
            : <UpgradeTable runs={derived} />
        ) : shown && shown.totalRuns > 0 ? (
          isCurve ? <ShopCurveChart curve={shown.shopCurve} /> : <SortableTable key={`${section.key}:${heroFilter}`} section={section} rows={rows} />
        ) : heroFilter && report ? (
          <div className="balempty">No runs yet for {getHero(heroFilter).name}.</div>
        ) : (
          <div className="balempty">
            No player data yet. Finished runs upload their offers/picks/outcomes to <code>run_telemetry</code>; this report
            aggregates them once runs have been logged (and the <code>run_telemetry</code> migration has been run).
          </div>
        )}
      </div>
    </div>
  );
}

/** Shop-leveling curve — average tavern tier reached by each wave, won runs (green) vs lost runs (red). A pure
 *  SVG line chart (bounded engine: 6 tiers). Null slots (no runs reached that wave) break the line. */
function ShopCurveChart({ curve }: { curve: ShopCurve }) {
  const { maxWave, won, lost, wonRuns, lostRuns, avgWaveToTier, byPlacement, placedRuns } = curve;
  // BY PLACEMENT (owner ask 2026-08-02) — one line per finish, off rows carrying a placement. Off by default:
  // the won/lost pair is the readable view, and eight lines is a different question. Hidden entirely when no
  // placed rows exist yet (pre-2026-08-02 data), rather than offering a toggle that reveals nothing.
  const [byPlace, setByPlace] = useState(false);
  const placedTotal = (placedRuns ?? []).reduce((n, v) => n + v, 0);
  if (maxWave < 1) return <div className="balempty">No shop-leveling data yet.</div>;
  const MAX_TIER = 7;
  const W = 760, H = 420, padL = 82, padR = 22, padT = 22, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = (wave: number): number => padL + (maxWave === 1 ? plotW / 2 : ((wave - 1) / (maxWave - 1)) * plotW);
  const y = (tier: number): number => padT + (1 - (tier - 1) / (MAX_TIER - 1)) * plotH;
  const path = (series: (number | null)[]): string => {
    let d = '', pen = false;
    for (let w = 1; w <= maxWave; w++) {
      const v = series[w];
      if (v == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(w).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  };
  // Thin the X ticks on long runs so labels don't collide.
  const waveTicks: number[] = [];
  for (let w = 1; w <= maxWave; w++) if (maxWave <= 12 || w % 2 === 1 || w === maxWave) waveTicks.push(w);
  return (
    <div className="balchart">
      <svg viewBox={`0 0 ${W} ${H}`} className="balchart-svg" role="img" aria-label="Average tavern tier by wave, won vs lost runs">
        {Array.from({ length: MAX_TIER }, (_, i) => i + 1).map((tier) => {
          const avg = avgWaveToTier?.[tier]; // avg wave a run first reaches this tavern tier (T1 = wave 1, a given)
          return (
            <g key={`y${tier}`}>
              <line x1={padL} y1={y(tier)} x2={W - padR} y2={y(tier)} className="balchart-grid" />
              <text x={padL - 9} y={y(tier) + 4} className="balchart-axl" textAnchor="end">T{tier}</text>
              {avg != null && tier > 1 && (
                <text x={padL - 34} y={y(tier) + 4} className="balchart-tieravg" textAnchor="end">◷{avg.toFixed(1)}</text>
              )}
            </g>
          );
        })}
        {waveTicks.map((w) => (
          <text key={`x${w}`} x={x(w)} y={H - padB + 22} className="balchart-axl" textAnchor="middle">{w}</text>
        ))}
        <text x={padL + plotW / 2} y={H - 6} className="balchart-axt" textAnchor="middle">Wave</text>
        {byPlace
          ? (byPlacement ?? []).map((series, place) => (series && place >= 1 ? (
              <path key={`pl${place}`} d={path(series)} className="balchart-line place" style={{ stroke: placeHue(place) }} fill="none" />
            ) : null))
          : (
            <>
              <path d={path(lost)} className="balchart-line lost" fill="none" />
              <path d={path(won)} className="balchart-line won" fill="none" />
            </>
          )}
        {/* Per-wave data points + the average tavern tier reached on each — a dot at every wave with its value
            (won labelled above the point, lost below, so the two don't collide). */}
        {(byPlace ? [] : [['won', won, -9] as const, ['lost', lost, 17] as const]).map(([cls, series, dy]) =>
          Array.from({ length: maxWave }, (_, i) => i + 1).map((w) => {
            const v = series[w];
            if (v == null) return null;
            return (
              <g key={`pt-${cls}-${w}`}>
                <circle cx={x(w)} cy={y(v)} r={3.4} className={`balchart-dot ${cls}`} />
                {/* Wave 1 is always T1 (a given) — skip its "1.0" label to cut noise, keep the dot. */}
                {w > 1 && <text x={x(w)} y={y(v) + dy} className={`balchart-ptl ${cls}`} textAnchor="middle">{v.toFixed(1)}</text>}
              </g>
            );
          }),
        )}
      </svg>
      <div className="balchart-legend">
        {byPlace ? (
          (placedRuns ?? []).map((n, place) => (place >= 1 && n > 0 ? (
            <span className="balchart-key" key={`k${place}`} style={{ color: placeHue(place) }}>{ordinal(place)} ({n})</span>
          ) : null))
        ) : (
          <>
            <span className="balchart-key won">Won runs ({wonRuns})</span>
            <span className="balchart-key lost">Lost runs ({lostRuns})</span>
          </>
        )}
        <span className="balchart-key tieravg">◷ avg wave reaching tier</span>
        {placedTotal > 0 && (
          <button className="balrun balchart-toggle" onClick={() => { sfx.tick(); setByPlace((v) => !v); }}>
            {byPlace ? 'Won / lost' : `By placement (${placedTotal})`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── DERIVED VIEWS (2026-08-06) — the runDerive streams rendered in-app ─────────────────────────────────── */

const pct = (v: number | null): string => (v === null ? '–' : `${Math.round(v * 100)}%`);

/** Per-card demand off the derived offers/acquisitions — the three separately-named conversion rates with a
 *  Wilson interval on copy conversion, revision-pooled. Rows on a STALE revision (the card changed since)
 *  are marked; rows under the preliminary sample gate render dimmed — visible, but flagged as noise. */
function DemandTable({ runs }: { runs: DerivedRun[] }) {
  const [sortKey, setSortKey] = useState<'copies' | 'conv' | 'acq' | 'name'>('copies');
  const rows = useMemo(() => {
    const revs = cardRevisions();
    const all = cardDemand(runs).map((d) => ({ ...d, stale: revs[d.cardId] !== undefined && revs[d.cardId] !== d.rev }));
    const val = (d: (typeof all)[number]): number | string =>
      sortKey === 'name' ? (CARD_INDEX[d.cardId]?.name ?? d.cardId)
        : sortKey === 'conv' ? (d.copyConversion ?? -1)
          : sortKey === 'acq' ? d.acquisitions : d.copiesOffered;
    return all.sort((a, b) => {
      const va = val(a), vb = val(b);
      return typeof va === 'string' ? String(va).localeCompare(String(vb)) : Number(vb) - Number(va);
    });
  }, [runs, sortKey]);
  const H = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <span role="columnheader" className={`balsort${sortKey === k ? ' on' : ''}`} onClick={() => setSortKey(k)}>{label}</span>
  );
  return (
    <div className="balsolo" style={{ ['--balcols' as string]: 8 }}>
      <div className="balnote">
        Demand = what players DO with offers (human data answers demand; per-card performance needs the bot
        fleet's sample sizes). Dimmed rows are under the {SAMPLE_GATES.preliminary}-offer preliminary gate;
        ⚠ marks a card whose definition changed since those samples (never pooled across revisions).
      </div>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balrow-h" role="row">
          <H k="name" label="Name" /><H k="copies" label="Copies Seen" /><span role="columnheader">Bought</span>
          <H k="conv" label="Copy Conv" /><span role="columnheader">95% CI</span><span role="columnheader">Shop Conv</span>
          <span role="columnheader">Run Acq</span><H k="acq" label="n (acq)" />
        </div>
        {rows.map((d) => {
          const ci = wilson(d.copiesBought, d.copiesOffered);
          const dim = d.copiesOffered < SAMPLE_GATES.preliminary;
          return (
            <div className={`balrow${dim ? ' baldim' : ''}`} role="row" key={`${d.cardId}@${d.rev}`}>
              <span role="cell" className="balname">{CARD_INDEX[d.cardId]?.name ?? d.cardId}{d.stale ? ' ⚠' : ''}</span>
              <span role="cell" className="balnum">{d.copiesOffered}</span>
              <span role="cell" className="balnum">{d.copiesBought}</span>
              <span role="cell" className="balnum">{pct(d.copyConversion)}</span>
              <span role="cell" className="balnum">{ci ? `${Math.round(ci.lo * 100)}–${Math.round(ci.hi * 100)}%` : '–'}</span>
              <span role="cell" className="balnum">{pct(d.shopConversion)}</span>
              <span role="cell" className="balnum">{pct(d.runAcquisitionRate)}</span>
              <span role="cell" className="balnum">{d.acquisitions}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The Gold ledger curve: where a turn's economy actually goes, per wave, averaged over runs that reached it. */
function EconomyTable({ runs }: { runs: DerivedRun[] }) {
  const rows = useMemo(() => goldCurve(runs), [runs]);
  const CATS = ['income', 'minion', 'spell', 'ruby', 'refresh', 'upgrade', 'heroPower', 'rune', 'sell'] as const;
  const LABEL: Record<string, string> = { income: 'Income', minion: 'Minions', spell: 'Spells', ruby: 'Rubies', refresh: 'Rolls', upgrade: 'Tier Ups', heroPower: 'Hero Pwr', rune: 'Runes', sell: 'Sold' };
  return (
    <div className="balsolo" style={{ ['--balcols' as string]: CATS.length + 2 }}>
      <div className="balnote">Average Gold per run reaching each wave — the reconciled ledger, so no source can hide. Spends shown as outlay.</div>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balrow-h" role="row">
          <span role="columnheader">Wave</span>
          {CATS.map((c) => <span key={c} role="columnheader">{LABEL[c]}</span>)}
          <span role="columnheader">runs</span>
        </div>
        {rows.map((r) => (
          <div className="balrow" role="row" key={r.wave}>
            <span role="cell" className="balname">{r.wave}</span>
            {CATS.map((c) => <span key={c} role="cell" className="balnum">{r.avg[c] || '–'}</span>)}
            <span role="cell" className="balnum">{r.runs}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Upgrade behaviour per wave: availability vs takes, the price paid, and the after-a-loss split. */
function UpgradeTable({ runs }: { runs: DerivedRun[] }) {
  const rows = useMemo(() => upgradeShape(runs), [runs]);
  return (
    <div className="balsolo" style={{ ['--balcols' as string]: 6 }}>
      <div className="balnote">Turns where a tier-up was affordable-or-visible, and what players did — declines are data too.</div>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balrow-h" role="row">
          <span role="columnheader">Wave</span><span role="columnheader">Offered</span><span role="columnheader">Taken</span>
          <span role="columnheader">Take %</span><span role="columnheader">Avg Cost</span><span role="columnheader">After-Loss Take % (n)</span>
        </div>
        {rows.map((r) => (
          <div className="balrow" role="row" key={r.wave}>
            <span role="cell" className="balname">{r.wave}</span>
            <span role="cell" className="balnum">{r.offered}</span>
            <span role="cell" className="balnum">{r.taken}</span>
            <span role="cell" className="balnum">{pct(r.takeRate)}</span>
            <span role="cell" className="balnum">{r.avgCost ?? '–'}</span>
            <span role="cell" className="balnum">{r.afterLossN ? `${pct(r.afterLossTakeRate)} (${r.afterLossN})` : '–'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
