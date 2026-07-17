import { useEffect, useMemo, useState } from 'react';
import { aggregatePlayerReport, type PlayerReport, type PlayerReportRow, type ShopCurve } from '@game/sim';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchRunTelemetry, remoteEnabled } from './remoteBoards';
import { buildCardCsv, type RunTelemetry } from '@game/sim';

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
  | 'shopSeen' | 'shopBought' | 'discSeen' | 'discBought' | 'discpct';
const COL_LABEL: Record<Col, string> = {
  offer: 'Offer', pick: 'Pick', win: 'Win', avgWins: 'Avg Wins', avgTurns: 'Avg Turns', n: 'n', seen: 'Seen', bought: 'Bought', buypct: 'Buy %',
  shopSeen: 'Shop Seen', shopBought: 'Shop Buy', discSeen: 'Disc Seen', discBought: 'Disc Buy', discpct: 'Disc %',
};

/** The report sections, in dropdown order — each names the rows it reads off the aggregate + the columns it shows. */
type Section = { key: keyof PlayerReport & ('heroes' | 'quests' | 'runes' | 'minions' | 'spells'); label: string; cols: Col[] };
const SECTIONS: Section[] = [
  { key: 'minions', label: 'Minions', cols: ['shopSeen', 'shopBought', 'discSeen', 'discBought', 'discpct', 'buypct'] },
  { key: 'spells', label: 'Spells', cols: ['shopSeen', 'shopBought', 'discSeen', 'discBought', 'discpct', 'buypct'] },
  { key: 'heroes', label: 'Heroes', cols: ['offer', 'pick', 'win', 'avgWins', 'n'] },
  { key: 'quests', label: 'Quests', cols: ['offer', 'pick', 'win', 'avgTurns', 'n'] },
  { key: 'runes', label: 'Runes', cols: ['offer', 'pick', 'win', 'n'] },
];
/** The chart section is not a table — it renders the shop-leveling curve instead of rows. */
const SHOP_CURVE = 'shopcurve' as const;
type SectionKey = Section['key'] | typeof SHOP_CURVE;

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
  }
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
  const [loading, setLoading] = useState(false);
  const [sectionKey, setSectionKey] = useState<SectionKey>('minions');

  const load = (): void => {
    setLoading(true);
    setReport(null);
    void fetchRunTelemetry(1000).then((rows) => {
      setRawRows(rows);
      setReport(aggregatePlayerReport(rows));
      setLoading(false);
    });
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

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const refresh = (): void => { sfx.pulse(); load(); };
  const isCurve = sectionKey === SHOP_CURVE;
  const section = SECTIONS.find((s) => s.key === sectionKey) ?? SECTIONS[0]!;
  const rows = report && !isCurve ? report[section.key] : [];

  return (
    <div className="balpage">
      <div className="baltopbar">
        <button className="lbback" onClick={back}>← Back</button>
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
                <option key={s.key} value={s.key}>{s.label}{report ? ` (${report[s.key].length})` : ''}</option>
              ))}
              <option value={SHOP_CURVE}>Shop Curve</option>
            </select>
            <button className="balrun" disabled={loading} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button>
            <button className="balrun" disabled={loading || rawRows.length === 0} onClick={exportCsv}
              title="Download per-card analytics (buy turns, win-rate impact, source split) as a spreadsheet">
              Export CSV
            </button>
          </div>
          <div className="balsub">Real player data{report ? ` · ${report.totalRuns} runs` : ''}</div>
        </div>
      </div>

      <div className="balscroll">
        {!remoteEnabled() ? (
          <div className="balempty">Balance report unavailable — no backend configured.</div>
        ) : loading ? (
          <div className="balempty">Loading player data…</div>
        ) : report && report.totalRuns > 0 ? (
          isCurve ? <ShopCurveChart curve={report.shopCurve} /> : <SortableTable key={section.key} section={section} rows={rows} />
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
  const { maxWave, won, lost, wonRuns, lostRuns, avgWaveToTier } = curve;
  if (maxWave < 1) return <div className="balempty">No shop-leveling data yet.</div>;
  const MAX_TIER = 6;
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
        <path d={path(lost)} className="balchart-line lost" fill="none" />
        <path d={path(won)} className="balchart-line won" fill="none" />
        {/* Per-wave data points + the average tavern tier reached on each — a dot at every wave with its value
            (won labelled above the point, lost below, so the two don't collide). */}
        {([['won', won, -9] as const, ['lost', lost, 17] as const]).map(([cls, series, dy]) =>
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
        <span className="balchart-key won">Won runs ({wonRuns})</span>
        <span className="balchart-key lost">Lost runs ({lostRuns})</span>
        <span className="balchart-key tieravg">◷ avg wave reaching tier</span>
      </div>
    </div>
  );
}
