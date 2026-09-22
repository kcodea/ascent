import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  aggregatePlayerReport, applyReportFilters, buildBalanceExport, buildCardCsv, cardDemand, cardImpact, getHero, goldCurve,
  impactGroups, upgradeShape, wilson, LEGACY_SET, SAMPLE_GATES,
  type CardImpactRow, type DerivedRun, type ImpactGroupRow, type PlayerReportRow, type RunTelemetryRow, type ShopCurve,
} from '@game/sim';
import { activeSet, CARD_INDEX, cardRevisions, contentRevision } from '@game/content';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchRunDerived, fetchRunTelemetry, remoteEnabled } from './remoteBoards';

/**
 * Balance Report (owner request 2026-07-13) — the REAL-PLAYER balance report, opened from the home screen. It
 * fetches finished-run telemetry (`run_telemetry`) and aggregates it client-side. This is PLAYER data, not
 * simulation — the seeded greedy-bot report still lives at `npm run report` (CLI). DEV-only (owner 2026-08-24).
 *
 * Redesign (owner 2026-07-14): ONE table at a time, full-screen + large text, picked from a dropdown, and every
 * column (Name included) is click-to-sort.
 *
 * Rework (owner ask 2026-09-22): "it should only have data for the active set in it, and nothing from scene
 * builder. also make the export export everything so that an ai can analyze all of the data for me at once.
 * Make sure the balance report is extremely thorough and represented well so it's easy to glean insights into
 * overpowered and underpowered units."
 *  · The DATA filters live in `@game/sim` (`applyReportFilters`): ladder rows only, the ACTIVE set only, a row
 *    with no set stamp read as set 1 and never as the live set. The header prints the set and the counts so
 *    the owner can SEE what the report is reading.
 *  · The Minions / Spells sections are the per-card IMPACT table (`cardImpact`): per-run samples with a
 *    visible gate, shop + Discover conversion, placement, and the placement DELTA against the report-wide
 *    baseline with its interval, a hot / cold heat, per-tier and per-tribe strips that double as filters, and
 *    a ranked diverging bar chart of the delta.
 *  · "Export all" writes ONE JSON file (`buildBalanceExport`) from the SAME filtered rows the screen renders:
 *    meta + a plain-language readme + every aggregate + every raw row + every derived stream.
 *  · The fetch is TWO stages: the flat rows first (rendered at once), then the derived payloads BY ID for the
 *    rows that survived the set filter only, merged in when they land (review fix 2026-09-22: 16 MB of payloads
 *    used to be fetched and parsed on every open, even when the report rendered nothing).
 */

type Col = 'offer' | 'pick' | 'avgWins' | 'avgTurns' | 'n' | 'avgPlace' | 'firstPct' | 'lastPct' | 'pn';

const fmtPct = (n: number): string => (n < 0 ? '–' : `${n}%`);
const fmtNum = (n: number | null): string => (n === null ? '–' : String(n));
const pctOrDash = (n: number | null): string => (n === null ? '–' : `${n}%`);
const signed = (n: number | null, dp = 2): string => (n === null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}`);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Avg-placement heat: a LOW number is a good finish. */
function placeHeat(avg: number | null): string {
  if (avg === null) return '';
  if (avg <= 3) return ' hot';
  if (avg >= 5.5) return ' cold';
  return '';
}
/** Delta heat: negative = buyers finish better than the field (green), positive = worse (red). */
function deltaHeat(d: number | null): string {
  if (d === null) return '';
  if (d <= -0.75) return ' hot';
  if (d <= -0.25) return ' warm';
  if (d >= 0.75) return ' cold';
  if (d >= 0.25) return ' cool';
  return '';
}

/** One hue per placement: 1st green → 8th red, evenly around the good→bad arc. */
const placeHue = (place: number): string => `hsl(${Math.round(140 - ((place - 1) / 7) * 140)} 70% 58%)`;
const ordinal = (n: number): string => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || (n % 100 >= 11 && n % 100 <= 13) ? 0 : n % 10] ?? 'th'}`;

// ── The generic sortable table ─────────────────────────────────────────────────────────────────────────────

interface ColDef<R> {
  key: string;
  label: string;
  /** The plain-words meaning, shown on hover of the header (every number is explained by a hover or a legend). */
  tip: string;
  /** The comparable value; null always sinks to the bottom, whatever the direction. */
  value: (r: R) => number | string | null;
  cell: (r: R) => { text: string; cls: string };
  /** Which way the first click sorts: -1 = biggest first (the default), 1 = smallest first. */
  firstDir?: 1 | -1;
}

interface TableProps<R> {
  cols: ColDef<R>[];
  rows: R[];
  keyOf: (r: R) => string;
  nameOf: (r: R) => string;
  /** A row under the sample gate renders dimmed. */
  dimOf?: (r: R) => boolean;
  defaultKey: string;
  defaultDir: 1 | -1;
  /** Dense layout for the wide impact table. */
  dense?: boolean;
}

/** A memoised row: the cells are recomputed only when the row object or the column set changes. */
const TableRow = memo(function TableRow({ r, cols, name, dim }: { r: object; cols: ColDef<any>[]; name: string; dim: boolean }) {
  return (
    <div className={`balrow${dim ? ' baldim' : ''}`} role="row">
      <span role="cell" className="balname">{name}</span>
      {cols.map((c) => { const cell = c.cell(r); return <span key={c.key} role="cell" className={cell.cls}>{cell.text}</span>; })}
    </div>
  );
});

function DataTable<R extends object>({ cols, rows, keyOf, nameOf, dimOf, defaultKey, defaultDir, dense }: TableProps<R>) {
  const [key, setKey] = useState<string>(defaultKey);
  const [dir, setDir] = useState<1 | -1>(defaultDir);
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === key);
    const arr = [...rows];
    arr.sort((a, b) => {
      if (!col) return nameOf(a).localeCompare(nameOf(b)) * dir;
      const va = col.value(a), vb = col.value(b);
      if (va === null && vb === null) return nameOf(a).localeCompare(nameOf(b));
      if (va === null) return 1; // missing values always sink, regardless of direction
      if (vb === null) return -1;
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir || nameOf(a).localeCompare(nameOf(b));
      return va === vb ? nameOf(a).localeCompare(nameOf(b)) : (va - vb) * dir;
    });
    return arr;
  }, [rows, cols, key, dir, nameOf]);

  const clickHead = (k: string): void => {
    sfx.tick();
    if (k === key) { setDir((d) => (d === 1 ? -1 : 1)); return; }
    setKey(k);
    const col = cols.find((c) => c.key === k);
    setDir(k === 'name' ? 1 : (col?.firstDir ?? -1)); // names default A to Z; numbers default biggest first
  };
  const arrow = (k: string): string => (k === key ? (dir === -1 ? ' ▾' : ' ▴') : '');

  return (
    <div className={`balsolo${dense ? ' balwide' : ''}`} style={{ ['--balcols' as string]: cols.length }}>
      <div className={`balgrid balgrid-solo${dense ? ' balgrid-dense' : ''}`} role="table">
        <div className="balrow balhead" role="row">
          <button role="columnheader" className={`balsort balname${key === 'name' ? ' on' : ''}`} onClick={() => clickHead('name')} data-tip="Sort by name">Name{arrow('name')}</button>
          {cols.map((c) => (
            <button key={c.key} role="columnheader" className={`balsort balnum${key === c.key ? ' on' : ''}`} onClick={() => clickHead(c.key)} data-tip={c.tip}>{c.label}{arrow(c.key)}</button>
          ))}
        </div>
        {sorted.map((r) => <TableRow key={keyOf(r)} r={r} cols={cols} name={nameOf(r)} dim={dimOf ? dimOf(r) : false} />)}
      </div>
    </div>
  );
}

// ── Heroes / Runes: the classic report columns ─────────────────────────────────────────────────────────────

const REPORT_COLS: Record<Col, ColDef<PlayerReportRow>> = {
  offer: { key: 'offer', label: 'Offer', tip: 'Percent of runs where this was offered.', value: (r) => (r.offerRate < 0 ? null : r.offerRate), cell: (r) => ({ text: fmtPct(r.offerRate), cls: 'balnum' }) },
  pick: { key: 'pick', label: 'Pick', tip: 'Percent of offers that were taken.', value: (r) => (r.pickRate < 0 ? null : r.pickRate), cell: (r) => ({ text: fmtPct(r.pickRate), cls: 'balnum' }) },
  avgWins: { key: 'avgWins', label: 'Round Wins', tip: 'Average combat rounds won per run with it.', value: (r) => r.avgWins, cell: (r) => ({ text: fmtNum(r.avgWins), cls: 'balnum' }) },
  avgTurns: { key: 'avgTurns', label: 'Avg Turns', tip: 'Average turns to complete. DNF means it was taken but never completed.', value: (r) => r.avgTurns, cell: (r) => ({ text: r.avgTurns === null ? (r.picked > 0 ? 'DNF' : '–') : String(r.avgTurns), cls: `balnum${r.avgTurns === null && r.picked > 0 ? ' balwin cold' : ''}` }) },
  n: { key: 'n', label: 'n', tip: 'Runs played with it.', value: (r) => r.games || r.picked, cell: (r) => ({ text: String(r.games || r.picked), cls: 'balnum baldim' }) },
  avgPlace: { key: 'avgPlace', label: 'Avg Place', tip: 'Average final placement of the runs that took it. 1 is best, 8 is worst.', value: (r) => r.avgPlace, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgPlace), cls: `balnum${r.avgPlace === null ? '' : ` balwin${placeHeat(r.avgPlace)}`}` }) },
  firstPct: { key: 'firstPct', label: '1st %', tip: 'Percent of those runs that won the lobby.', value: (r) => (r.placedGames > 0 ? r.firstRate : null), cell: (r) => ({ text: r.placedGames > 0 ? fmtPct(r.firstRate) : '–', cls: 'balnum' }) },
  lastPct: { key: 'lastPct', label: '8th %', tip: 'Percent of those runs that finished 8th.', value: (r) => (r.placedGames > 0 ? r.lastRate : null), cell: (r) => ({ text: r.placedGames > 0 ? fmtPct(r.lastRate) : '–', cls: 'balnum' }) },
  pn: { key: 'pn', label: 'placed n', tip: 'Runs behind the placement columns.', value: (r) => r.placedGames, cell: (r) => ({ text: String(r.placedGames), cls: 'balnum baldim' }) },
};
const pickCols = (keys: Col[]): ColDef<PlayerReportRow>[] => keys.map((k) => REPORT_COLS[k]);
// 'win' (win-RATE %) dropped 2026-08-24: in the lobby a win IS placing 1st, so it only duplicated '1st %'.
// 'avgWins' is average ROUND wins per run (owner: "wins should be how many round wins the hero gets").
const HERO_COLS = pickCols(['offer', 'pick', 'avgWins', 'n', 'avgPlace', 'firstPct', 'lastPct', 'pn']);
const RUNE_COLS = pickCols(['offer', 'pick', 'n', 'avgPlace', 'firstPct', 'lastPct', 'pn']);
// Quests removed 2026-08-24: not an active system. The aggregate still computes them; the export carries them.

// ── Minions / Spells: the impact columns ───────────────────────────────────────────────────────────────────

const GATE_TIP = `Runs that acquired the card, counted once per run. Rows under ${SAMPLE_GATES.preliminary} are dimmed as noise.`;
const IMPACT_COLS: Record<string, ColDef<CardImpactRow>> = {
  tier: { key: 'tier', label: 'Tier', tip: 'The card\'s shop tier.', value: (r) => r.tier, firstDir: 1, cell: (r) => ({ text: `T${r.tier}`, cls: 'balnum baldim' }) },
  tribe: { key: 'tribe', label: 'Tribe', tip: 'The card\'s tribe. Two names for a dual-tribe card.', value: (r) => r.tribe, firstDir: 1, cell: (r) => ({ text: r.tribe2 ? `${cap(r.tribe)}/${cap(r.tribe2)}` : cap(r.tribe), cls: 'balnum baldim' }) },
  n: { key: 'n', label: 'Buyers', tip: GATE_TIP, value: (r) => r.runsBought, cell: (r) => ({ text: String(r.runsBought), cls: 'balnum' }) },
  runsSeen: { key: 'runsSeen', label: 'Runs Seen', tip: 'Runs where the card showed up at all, in the shop or a Discover.', value: (r) => r.runsSeen, cell: (r) => ({ text: String(r.runsSeen), cls: 'balnum' }) },
  shopSeen: { key: 'shopSeen', label: 'Shop Seen', tip: 'Shop sightings. A card seen four times in one run counts four.', value: (r) => r.shopSeen, cell: (r) => ({ text: String(r.shopSeen), cls: 'balnum' }) },
  shopBought: { key: 'shopBought', label: 'Shop Buy', tip: 'Shop purchases, one per buy.', value: (r) => r.shopBought, cell: (r) => ({ text: String(r.shopBought), cls: 'balnum' }) },
  buypct: { key: 'buypct', label: 'Buy %', tip: 'Shop purchases as a percent of shop sightings. Do players want it when they see it.', value: (r) => r.shopBuyRate, cell: (r) => ({ text: pctOrDash(r.shopBuyRate), cls: 'balnum' }) },
  discSeen: { key: 'discSeen', label: 'Disc Seen', tip: 'Times offered as a Discover option.', value: (r) => r.discSeen, cell: (r) => ({ text: String(r.discSeen), cls: 'balnum' }) },
  discBought: { key: 'discBought', label: 'Disc Pick', tip: 'Times picked from a Discover.', value: (r) => r.discBought, cell: (r) => ({ text: String(r.discBought), cls: 'balnum' }) },
  discpct: { key: 'discpct', label: 'Disc %', tip: 'Discover picks as a percent of Discover offers.', value: (r) => r.discRate, cell: (r) => ({ text: pctOrDash(r.discRate), cls: 'balnum' }) },
  avgPlace: { key: 'avgPlace', label: 'Avg Place', tip: 'Average final placement of the runs that bought it. 1 is best, 8 is worst.', value: (r) => r.avgPlace, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgPlace), cls: `balnum${r.avgPlace === null ? '' : ` balwin${placeHeat(r.avgPlace)}`}` }) },
  firstPct: { key: 'firstPct', label: '1st %', tip: 'Percent of buyer runs that won the lobby.', value: (r) => r.firstRate, cell: (r) => ({ text: pctOrDash(r.firstRate), cls: 'balnum' }) },
  top4: { key: 'top4', label: 'Top 4 %', tip: 'Percent of buyer runs that finished in the top four. Detailed shows its 95% range.', value: (r) => r.top4Rate, cell: (r) => ({ text: pctOrDash(r.top4Rate), cls: 'balnum' }) },
  top4Ci: { key: 'top4Ci', label: 'Top 4 95%', tip: 'The 95% range the true top-four rate is likely to sit in (Wilson). Sorts by the bottom of the range, so a card whose whole range is high comes first.', value: (r) => (r.top4Ci ? r.top4Ci.lo : null), cell: (r) => ({ text: r.top4Ci ? `${r.top4Ci.lo}% to ${r.top4Ci.hi}%` : '–', cls: 'balnum baldim' }) },
  lastPct: { key: 'lastPct', label: '8th %', tip: 'Percent of buyer runs that finished 8th.', value: (r) => r.lastRate, cell: (r) => ({ text: pctOrDash(r.lastRate), cls: 'balnum' }) },
  delta: { key: 'delta', label: 'Delta', tip: 'Average placement of runs that bought it minus runs that did not. Negative means its buyers finish better than the field.', value: (r) => r.delta, firstDir: 1, cell: (r) => ({ text: signed(r.delta), cls: `balnum${r.delta === null ? '' : ` balwin${deltaHeat(r.delta)}`}` }) },
  vsTier: { key: 'vsTier', label: 'Vs Tier', tip: 'The delta minus the average delta of the card\'s tier. High tiers are bought only by runs that lived long enough to reach them, so a whole tier can read green; this shows who stands out within the tier.', value: (r) => r.tierDelta, firstDir: 1, cell: (r) => ({ text: signed(r.tierDelta), cls: `balnum${r.tierDelta === null ? '' : ` balwin${deltaHeat(r.tierDelta)}`}` }) },
  deltaCi: { key: 'deltaCi', label: 'Delta 95%', tip: 'The 95% range the true delta is likely to sit in. A range that crosses zero is not a finding yet. Sorts by the top of the range, so a card whose whole range is below zero comes first.', value: (r) => (r.deltaCi ? r.deltaCi.hi : null), firstDir: 1, cell: (r) => ({ text: r.deltaCi ? `${signed(r.deltaCi.lo, 1)} to ${signed(r.deltaCi.hi, 1)}` : '–', cls: 'balnum baldim' }) },
  impact: { key: 'impact', label: 'Impact', tip: 'The delta shrunk toward zero for a small sample. A card keeps half its delta at 20 placed buyer runs and most of it past 100. The default order: the strongest, best-supported buyer advantage first.', value: (r) => r.impact, firstDir: 1, cell: (r) => ({ text: signed(r.impact), cls: `balnum${r.impact === null ? '' : ` balwin${deltaHeat(r.impact)}`}` }) },
  buyWave: { key: 'buyWave', label: 'Buy Wave', tip: 'Average wave the card was acquired on.', value: (r) => r.avgBuyWave, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgBuyWave), cls: 'balnum baldim' }) },
};
const impactCols = (keys: string[]): ColDef<CardImpactRow>[] => keys.map((k) => IMPACT_COLS[k]!);
const IMPACT_COMPACT = impactCols(['tier', 'tribe', 'n', 'buypct', 'discpct', 'avgPlace', 'top4', 'delta', 'vsTier', 'impact']);
const IMPACT_DETAILED = impactCols(['tier', 'tribe', 'n', 'runsSeen', 'shopSeen', 'shopBought', 'buypct', 'discSeen', 'discBought', 'discpct', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'delta', 'deltaCi', 'vsTier', 'impact', 'buyWave']);

const impactKey = (r: CardImpactRow): string => r.id;
const impactName = (r: CardImpactRow): string => r.name;
const impactDim = (r: CardImpactRow): boolean => r.gate === 'below';
const reportKey = (r: PlayerReportRow): string => r.id;
const reportName = (r: PlayerReportRow): string => r.name;

/** The plain-words read of a group chip, for its hover. */
function groupTip(g: ImpactGroupRow, what: string): string {
  const head = `${what} ${g.label}: ${g.cards} cards, ${g.runsBought} buyer runs.`;
  if (g.delta === null) return `${head} No placement data yet.`;
  const abs = Math.abs(g.delta).toFixed(2);
  return `${head} Their buyers finish ${abs} places ${g.delta <= 0 ? 'better' : 'worse'} than the field on average.`;
}

/** A row of chips, one per tier or tribe, each showing its sample and delta with the delta heat. Clicking a
 *  chip filters the table and the chart to that group; clicking it again clears the filter. */
function GroupStrip({ what, groups, active, onPick }: { what: string; groups: ImpactGroupRow[]; active: string | null; onPick: (key: string | null) => void }) {
  if (groups.length === 0) return null;
  return (
    <div className="balstrip" role="group" aria-label={`${what} summary`}>
      <span className="balstrip-label">{what}</span>
      {groups.map((g) => (
        <button
          key={g.key}
          className={`balgchip${active === g.key ? ' on' : ''}`}
          onClick={() => { sfx.tick(); onPick(active === g.key ? null : g.key); }}
          data-tip={groupTip(g, what)}
        >
          <span className="balgchip-l">{g.label}</span>
          <span className="balgchip-n">{g.runsBought}</span>
          <span className={`balgchip-d balwin${deltaHeat(g.delta)}`}>{signed(g.delta)}</span>
        </button>
      ))}
    </div>
  );
}

/** The plain-words read of one bar, for its hover. */
function barTip(r: CardImpactRow): string {
  const ci = r.deltaCi ? ` (95% ${signed(r.deltaCi.lo, 1)} to ${signed(r.deltaCi.hi, 1)})` : '';
  const abs = r.delta === null ? '' : Math.abs(r.delta).toFixed(2);
  return `${r.name}: ${r.runsBought} buyer runs, average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)} for the field. Buyers finish ${abs} places ${(r.delta ?? 0) <= 0 ? 'better' : 'worse'}${ci}.`;
}

/**
 * The ranked diverging bar chart of the placement delta: bars grow LEFT (green) when a card's buyers finish
 * better than the field and RIGHT (red) when worse, strongest at the top, and FADE with a thin sample so a
 * 3-run outlier never reads as a finding. Plain HTML bars (thin, rounded data-end, a hairline baseline),
 * every bar a hover target, the table beside it the WCAG twin.
 */
function ImpactChart({ rows }: { rows: CardImpactRow[] }) {
  const [showAll, setShowAll] = useState(false);
  // Thin samples are hidden by default whenever anything clears the gate: a ranked chart whose top is a column
  // of faded two-run outliers answers nothing. One click shows them.
  const [hideThin, setHideThin] = useState(() => rows.some((r) => r.gate !== 'below'));
  const EDGE = 15;
  const ranked = useMemo(() => rows
    .filter((r) => r.delta !== null && (!hideThin || r.gate !== 'below'))
    .sort((a, b) => a.delta! - b.delta! || a.name.localeCompare(b.name)), [rows, hideThin]);
  const thinToggle = (
    <div className="balseg-row">
      <div className="balseg" role="group" aria-label="Thin samples">
        <button className={hideThin ? '' : 'on'} onClick={() => { sfx.tick(); setHideThin(false); }}>All cards</button>
        <button className={hideThin ? 'on' : ''} onClick={() => { sfx.tick(); setHideThin(true); }} data-tip={`Only cards with at least ${SAMPLE_GATES.preliminary} buyer runs`}>Hide thin samples</button>
      </div>
    </div>
  );
  if (ranked.length === 0) return <div className="balimp">{thinToggle}<div className="balempty">No cards with placement data{hideThin ? ` and at least ${SAMPLE_GATES.preliminary} buyer runs` : ''} yet.</div></div>;
  const maxAbs = Math.max(0.01, ...ranked.map((r) => Math.abs(r.delta!)));
  const shown = showAll || ranked.length <= EDGE * 2
    ? ranked
    : [...ranked.slice(0, EDGE), null, ...ranked.slice(ranked.length - EDGE)];
  const opacityOf = (r: CardImpactRow): number => 0.3 + 0.7 * Math.min(1, r.runsBought / SAMPLE_GATES.actionable);
  return (
    <div className="balimp">
      <div className="balnote">
        Each bar is the card's <b>Delta</b>: the average placement of runs that bought it minus runs that did not.
        A bar to the <b>left</b> means its buyers finish better than the field, to the <b>right</b> worse.
        Bars fade with a thin sample and are solid at {SAMPLE_GATES.actionable} buyer runs. Hover a bar for its numbers.
      </div>
      {thinToggle}
      <div className="balimp-axis"><span>buyers finish better</span><span>0</span><span>buyers finish worse</span></div>
      {shown.map((r) => (r === null ? (
        <div key="gap" className="balimp-gap">
          <button className="balrun balimp-more" onClick={() => { sfx.tick(); setShowAll(true); }}>Show all {ranked.length}</button>
        </div>
      ) : (
        <div key={r.id} className={`balimp-row${r.gate === 'below' ? ' baldim' : ''}`} data-tip={barTip(r)} tabIndex={0}>
          <span className="balimp-name">{r.name}</span>
          <span className="balimp-n">{r.runsBought}</span>
          <div className="balimp-track">
            <div
              className={`balimp-bar${r.delta! <= 0 ? ' neg' : ' pos'}`}
              style={{ width: `${(Math.abs(r.delta!) / maxAbs) * 50}%`, opacity: opacityOf(r) }}
            />
          </div>
          <span className={`balimp-val balwin${deltaHeat(r.delta)}`}>{signed(r.delta)}</span>
        </div>
      )))}
      {showAll && ranked.length > EDGE * 2 && (
        <div className="balimp-gap"><button className="balrun balimp-more" onClick={() => { sfx.tick(); setShowAll(false); }}>Show the ends only</button></div>
      )}
    </div>
  );
}

type CardView = 'table' | 'chart';
type Density = 'compact' | 'detailed';

/** The Minions / Spells section: legend, tier + tribe strips (which double as filters), the view toggles, and
 *  the table or the chart over the same rows. The tier / tribe filters are THIS section's own state: the panel
 *  keys the section by Minions / Spells, so switching between them starts clean (a Beast filter picked on
 *  Minions used to follow the owner onto Spells, which has no Beast chip to clear it with), and a filter that
 *  leaves nothing shows a Clear filters control instead of an empty table. */
function ImpactSection({ rows, view, setView, density, setDensity }: {
  rows: CardImpactRow[];
  view: CardView; setView: (v: CardView) => void;
  density: Density; setDensity: (d: Density) => void;
}) {
  const [tierFilter, setTier] = useState<string | null>(null);
  const [tribeFilter, setTribe] = useState<string | null>(null);
  const byTier = useMemo(() => impactGroups(rows, 'tier'), [rows]);
  const byTribe = useMemo(() => impactGroups(rows, 'tribe'), [rows]);
  const visible = useMemo(() => rows.filter((r) =>
    (tierFilter === null || String(r.tier) === tierFilter)
    && (tribeFilter === null || r.tribe === tribeFilter || r.tribe2 === tribeFilter)), [rows, tierFilter, tribeFilter]);
  const filtering = tierFilter !== null || tribeFilter !== null;
  const clearFilters = (): void => { sfx.tick(); setTier(null); setTribe(null); };
  if (rows.length === 0) return <div className="balempty">No card data in these runs yet.</div>;
  return (
    <>
      <div className="balnote">
        Every column is PER RUN: a run that bought a card three times is one buyer run. <b>Delta</b> is the average placement
        of runs that bought the card minus runs that did not, so a negative delta (green) means its buyers finish better
        than the field and a positive one (red) worse. <b>Vs Tier</b> compares a card with its own tier, because a high
        tier is bought only by runs that survived long enough to reach it and reads green as a whole. <b>Impact</b> is the
        delta shrunk toward zero for a thin sample and is the default order. Rows under {SAMPLE_GATES.preliminary} buyer
        runs are dimmed. Hover any column header for its meaning.
      </div>
      <GroupStrip what="Tier" groups={byTier} active={tierFilter} onPick={setTier} />
      <GroupStrip what="Tribe" groups={byTribe} active={tribeFilter} onPick={setTribe} />
      <div className="balseg-row">
        <div className="balseg" role="group" aria-label="View">
          <button className={view === 'table' ? 'on' : ''} onClick={() => { sfx.tick(); setView('table'); }}>Table</button>
          <button className={view === 'chart' ? 'on' : ''} onClick={() => { sfx.tick(); setView('chart'); }}>Chart</button>
        </div>
        {view === 'table' && (
          <div className="balseg" role="group" aria-label="Columns">
            <button className={density === 'compact' ? 'on' : ''} onClick={() => { sfx.tick(); setDensity('compact'); }} data-tip="The ten columns that answer the question">Compact</button>
            <button className={density === 'detailed' ? 'on' : ''} onClick={() => { sfx.tick(); setDensity('detailed'); }} data-tip="Every column, including the raw counts and the two 95% ranges">Detailed</button>
          </div>
        )}
        <span className="balseg-count">{visible.length} of {rows.length} cards{filtering ? ' (filtered)' : ''}</span>
        {filtering && <button className="balrun balimp-more" onClick={clearFilters} data-tip="Show every tier and tribe again">Clear filters</button>}
      </div>
      {visible.length === 0
        ? <div className="balempty">No cards match the tier and tribe picked above.</div>
        : view === 'chart'
          ? <ImpactChart rows={visible} />
          : (
            <DataTable
              key={density}
              cols={density === 'compact' ? IMPACT_COMPACT : IMPACT_DETAILED}
              rows={visible}
              keyOf={impactKey}
              nameOf={impactName}
              dimOf={impactDim}
              defaultKey="impact"
              defaultDir={1}
              dense={density === 'detailed'}
            />
          )}
    </>
  );
}

// ── The panel ──────────────────────────────────────────────────────────────────────────────────────────────

type SectionKey = 'minions' | 'spells' | 'heroes' | 'runes' | 'shopcurve' | 'demand' | 'economy' | 'upgrades';

/** How many of the newest in-set rows get their derived payload fetched (~100 KB each today). */
const DERIVED_ROWS = 400;

/** Save a text blob as a file download. */
function download(text: string, name: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BalancePanel() {
  const show = useGame((s) => s.showBalance);
  const close = useGame((s) => s.closeBalance);
  const [rows, setRows] = useState<RunTelemetryRow[]>([]); // every fetched row; the filters run below
  const [loading, setLoading] = useState(false);
  const [sectionKey, setSectionKey] = useState<SectionKey>('minions');
  // HERO FILTER (owner ask 2026-08-02: "what minions does Robin buy vs Guardian"). Re-AGGREGATES from the raw
  // rows rather than filtering the finished tables, so the denominators are that hero's too. A VIEW filter:
  // the export always carries every hero.
  const [heroFilter, setHeroFilter] = useState<string>('');
  const [cardView, setCardView] = useState<CardView>('table');
  const [density, setDensity] = useState<Density>('compact');
  // STAGE TWO of the load (the derived payloads) is in flight: the derived sections and Export all wait for it.
  const [derivedLoading, setDerivedLoading] = useState(false);
  // A Refresh that overtakes an earlier one wins: a stale completion is dropped, never merged.
  const loadSeq = useRef(0);

  const load = (): void => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setDerivedLoading(false);
    void (async () => {
      const all = await fetchRunTelemetry(1000);
      if (seq !== loadSeq.current) return;
      setRows(all);
      setLoading(false);
      // STAGE TWO: the derived payloads, BY ID, only for the rows the report reads (ladder rows of the active
      // set), newest first, after the flat rows have rendered. Pre-migration that is no rows and no bytes; with
      // data it keeps a multi-megabyte parse off the frame that paints the flat report.
      const ids = applyReportFilters(all, activeSet().id).rows.map((r) => r.id).filter((id): id is number => id != null).slice(0, DERIVED_ROWS);
      if (ids.length === 0) return;
      setDerivedLoading(true);
      const byId = await fetchRunDerived(ids);
      if (seq !== loadSeq.current) return;
      if (byId.size > 0) setRows((prev) => prev.map((r) => (r.id != null && byId.has(r.id) ? { ...r, derived: byId.get(r.id)! } : r)));
      setDerivedLoading(false);
    })();
  };
  useEffect(() => { if (show) load(); }, [show]);

  // THE DATA FILTERS: ladder rows only, the active set only (a row with no set stamp is set 1, never the
  // live set). One pure function in @game/sim, shared with the export so the screen and the file agree.
  const set = activeSet();
  const filtered = useMemo(() => applyReportFilters(rows, set.id), [rows, set.id]);
  const heroRows = useMemo(() => (heroFilter ? filtered.rows.filter((r) => r.heroId === heroFilter) : filtered.rows), [filtered, heroFilter]);
  const report = useMemo(() => aggregatePlayerReport(heroRows), [heroRows]);
  const impact = useMemo(() => {
    const all = cardImpact(heroRows);
    return { minions: all.filter((r) => !r.spell), spells: all.filter((r) => r.spell) };
  }, [heroRows]);
  const derived = useMemo(() => heroRows.map((r) => r.derived).filter((d): d is DerivedRun => d != null), [heroRows]);
  // Every hero that actually appears in the slice, so the dropdown never offers an empty choice.
  const heroIds = useMemo(() => [...new Set(filtered.rows.map((r) => r.heroId))].sort(), [filtered]);

  // EXPORT ALL (owner ask 2026-09-22): ONE JSON file from the SAME filtered rows the screen renders (every
  // hero; the hero / tier / tribe pickers are view filters). Meta + readme + aggregates + raw rows + derived.
  const exportAll = (): void => {
    sfx.pulse();
    const data = buildBalanceExport(filtered.rows, {
      activeSet: { id: set.id, name: set.name },
      appVersion: `${__APP_VERSION__}+${__BUILD_SHA__}`,
      generatedAt: new Date().toISOString(),
      contentRevision: contentRevision(),
      counts: filtered.counts,
      filters: filtered.applied,
    });
    download(JSON.stringify(data), `ascent-balance-${set.id}-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  // The per-card CSV (owner ask 2026-07-16) stays as the second button, over the same filtered rows.
  const exportCsv = (): void => {
    sfx.pulse();
    download(buildCardCsv(filtered.rows), `ascent-cards-${set.id}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  };

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const refresh = (): void => { sfx.pulse(); load(); };
  const pickSection = (k: SectionKey): void => { sfx.pulse(); setSectionKey(k); };
  const counts = filtered.counts;
  const isCards = sectionKey === 'minions' || sectionKey === 'spells';
  const isDerived = sectionKey === 'demand' || sectionKey === 'economy' || sectionKey === 'upgrades';
  const hasData = heroRows.length > 0;

  return (
    <div className="balpage">
      <div className="baltopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        {/* Section picker + the filters + the buttons, centred at the top. */}
        <div className="balhead-c">
          <div className="balcontrols">
            <select
              className="balpick"
              value={sectionKey}
              onChange={(e) => pickSection(e.target.value as SectionKey)}
              aria-label="Choose report"
            >
              <option value="minions">Minions ({impact.minions.length})</option>
              <option value="spells">Spells ({impact.spells.length})</option>
              <option value="heroes">Heroes ({report.heroes.length})</option>
              <option value="runes">Runes ({report.runes.length})</option>
              <option value="shopcurve">Shop Curve</option>
              <option value="demand">Card Demand (derived){derived.length ? ` (${derived.length} runs)` : derivedLoading ? ' (loading)' : ''}</option>
              <option value="economy">Gold Economy (derived)</option>
              <option value="upgrades">Upgrade Timing (derived)</option>
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
            <button className="balrun" disabled={loading || derivedLoading || filtered.rows.length === 0} onClick={exportAll}
              data-tip={derivedLoading ? 'Waits for the derived streams to land, so the file holds everything' : 'Downloads every run of the active set as one JSON file: the tables, the raw rows and the derived streams, with a readme inside'}>
              {derivedLoading ? 'Export (loading)' : 'Export all'}
            </button>
            <button className="balrun" disabled={loading || filtered.rows.length === 0} onClick={exportCsv}
              data-tip="Downloads the per-card spreadsheet (buy turns, win lift, source split) over the same runs">
              Export CSV
            </button>
          </div>
          {/* What the report is READING, spelled out (owner ask 2026-09-22): the set, the row counts, the filters. */}
          <div className="balsub">
            <b>{set.name}</b> only · {counts.inSet} of {counts.fetched} runs · ladder only
            {heroFilter ? ` · ${getHero(heroFilter).name} only (${heroRows.length} runs)` : ''}
          </div>
          {counts.unstamped > 0 && set.id !== LEGACY_SET && (
            <div className="balsub balwarn">
              {counts.unstamped} of the {counts.ladder} ladder runs carry no set stamp and count as Set 1. Stamp them by SQL (2026-09-22 runbook) to read them here.
            </div>
          )}
        </div>
      </div>

      <div className="balscroll">
        {!remoteEnabled() ? (
          <div className="balempty">Balance report unavailable. No backend configured.</div>
        ) : loading ? (
          <div className="balempty">Loading player data…</div>
        ) : !hasData ? (
          <div className="balempty">
            {heroFilter ? `No ${set.name} runs for ${getHero(heroFilter).name} yet.`
              : counts.ladder === 0 ? 'No player data yet. Finished lobby runs upload their telemetry to run_telemetry; this report fills once runs have banked.'
                : `No ${set.name} runs yet. ${counts.ladder} ladder runs were fetched and none is stamped ${set.name}; ${counts.unstamped} carry no stamp and count as Set 1. The 2026-09-22 devlog runbook stamps them by SQL.`}
          </div>
        ) : isCards ? (
          <ImpactSection
            key={sectionKey}
            rows={sectionKey === 'minions' ? impact.minions : impact.spells}
            view={cardView} setView={setCardView} density={density} setDensity={setDensity}
          />
        ) : isDerived ? (
          derived.length === 0 ? (
            <div className="balempty">
              {derivedLoading ? 'Loading the derived streams for these runs…' : (
                <>
                  No derived runs in this slice. These views read the <code>derived</code> payload each finished run uploads;
                  empty until the 2026-08-05 <code>run_telemetry</code> migration has been run and runs have banked since.
                </>
              )}
            </div>
          ) : sectionKey === 'demand' ? <DemandTable runs={derived} />
            : sectionKey === 'economy' ? <EconomyTable runs={derived} />
              : <UpgradeTable runs={derived} />
        ) : sectionKey === 'shopcurve' ? (
          <ShopCurveChart curve={report.shopCurve} />
        ) : sectionKey === 'heroes' ? (
          <DataTable key={`heroes:${heroFilter}`} cols={HERO_COLS} rows={report.heroes} keyOf={reportKey} nameOf={reportName} defaultKey="offer" defaultDir={-1} />
        ) : (
          <DataTable key={`runes:${heroFilter}`} cols={RUNE_COLS} rows={report.runes} keyOf={reportKey} nameOf={reportName} defaultKey="offer" defaultDir={-1} />
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
  // Real buttons: the global button rule paints the gauntlet on them (a clickable span showed the OS arrow).
  const H = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <button role="columnheader" className={`balsort${sortKey === k ? ' on' : ''}`} onClick={() => { sfx.tick(); setSortKey(k); }}>{label}</button>
  );
  return (
    <div className="balsolo" style={{ ['--balcols' as string]: 8 }}>
      <div className="balnote">
        Demand = what players DO with offers. Three rates by denominator: <b>Copy %</b> = of copies seen,
        bought; <b>Shop %</b> = of shops that showed it, ones that led to a buy; <b>Run %</b> = of runs
        offered it, ones that acquired it (any source). Dimmed rows are under the {SAMPLE_GATES.preliminary}-offer
        gate; ⚠ marks a card whose definition changed since those samples (never pooled across revisions).
      </div>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balrow-h" role="row">
          <H k="name" label="Name" /><H k="copies" label="Seen" /><span role="columnheader">Bought</span>
          <H k="conv" label="Copy %" /><span role="columnheader">95% CI</span><span role="columnheader">Shop %</span>
          <span role="columnheader">Run %</span><H k="acq" label="n" />
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
  // No 'ruby' column: Rubies are MINTED (hero powers, Kobold effects), never bought with Gold, so the outlay
  // was always empty — dropped like the omitted 'other'/'henchman' categories (owner cleanup 2026-08-24).
  const CATS = ['income', 'minion', 'spell', 'refresh', 'upgrade', 'heroPower', 'rune', 'sell'] as const;
  const LABEL: Record<string, string> = { income: 'Income', minion: 'Minions', spell: 'Spells', refresh: 'Rolls', upgrade: 'Tier Ups', heroPower: 'Hero Pwr', rune: 'Runes', sell: 'Sold' };
  return (
    <div className="balsolo" style={{ ['--balcols' as string]: CATS.length + 2 }}>
      <div className="balnote">Average Gold per run reaching each wave. <b>Income</b> is what came in. <b>Minions</b> to <b>Runes</b> are spends. <b>Sold</b> is Gold recovered by selling (an inflow, shown last).</div>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balrow-h" role="row">
          <span role="columnheader">Wave</span>
          {CATS.map((c) => <span key={c} role="columnheader">{LABEL[c]}</span>)}
          <span role="columnheader">Runs</span>
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
      <div className="balnote">Turns where a tier-up was affordable or visible, and what players did. Declines are data too.</div>
      <div className="balgrid balgrid-solo" role="table">
        <div className="balrow balrow-h" role="row">
          <span role="columnheader">Wave</span><span role="columnheader">Offered</span><span role="columnheader">Taken</span>
          <span role="columnheader">Take %</span><span role="columnheader">Avg Cost</span><span role="columnheader">After Loss</span>
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
