import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  aggregatePlayerReport, applyReportFilters, buildBalanceExport, buildCardCsv, cardImpact, getHero, goldEconomy, heroImpact,
  impactGroups, runeGroups, runeImpact, tierImpact, upgradeShape, LEGACY_SET, SAMPLE_GATES, SPEND_CATEGORIES,
  type CardImpactRow, type DerivedRun, type EconomyBucket, type EconomyWaveRow, type GoldEconomy, type HeroImpactRow, type ImpactGroupRow,
  type PlacementStats, type RuneImpactRow, type RunTelemetryRow, type SampleGate, type ShopCurve, type SpendCategory, type TierImpactRow,
} from '@game/sim';
import { activeSet, contentRevision } from '@game/content';
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
 *
 * Round 2 (owner ask 2026-09-22): "apply the same updates to heroes, runes, shop tiers ... clean up and improve
 * the overall economy table ... the average gold a player has/spends per round ... remove the card demand one".
 *  · `ImpactSection` is GENERIC: one section component (legend, group strips that filter, Table / Chart,
 *    Compact / Detailed, the sortable table with hover explanations, the ranked bar chart) over any row that
 *    carries the shared `PlacementStats`. Cards, heroes, runes and shop tiers all feed it; the sim computes
 *    every delta through the one `placementImpact` helper.
 *  · The Shop Tiers section keeps the leveling curve and adds the per-tier impact table under it.
 *  · The Gold Economy table is rebuilt from the derived ledgers: per round, the Gold a player HAS at the start,
 *    SPENDS (and on what), and LEAVES unspent, for every run and by placement bucket, with a static line chart.
 *  · Card Demand is gone (redundant with the Minions table); `cardDemand` left the sim with it.
 */

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
/** Delta heat: negative = the group finishes better than its baseline (green), positive = worse (red). */
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
  /** The name column's header (Name unless the rows are rounds or tiers). */
  nameLabel?: string;
  /** How the name column sorts when it is not alphabetical (a wave number). */
  nameValue?: (r: R) => number;
  /** A row under the sample gate renders dimmed. */
  dimOf?: (r: R) => boolean;
  /** The plain-words read of one row, shown on hover of its name. */
  tipOf?: (r: R) => string;
  defaultKey: string;
  defaultDir: 1 | -1;
  /** Dense layout for the wide impact table. */
  dense?: boolean;
}

/** A memoised row: the cells are recomputed only when the row object or the column set changes. */
const TableRow = memo(function TableRow({ r, cols, name, dim, tip }: { r: object; cols: ColDef<any>[]; name: string; dim: boolean; tip?: string }) {
  return (
    <div className={`balrow${dim ? ' baldim' : ''}`} role="row">
      <span role="cell" className={`balname${tip ? ' baltipname' : ''}`} data-tip={tip} tabIndex={tip ? 0 : undefined}>{name}</span>
      {cols.map((c) => { const cell = c.cell(r); return <span key={c.key} role="cell" className={cell.cls}>{cell.text}</span>; })}
    </div>
  );
});

function DataTable<R extends object>({ cols, rows, keyOf, nameOf, nameLabel, nameValue, dimOf, tipOf, defaultKey, defaultDir, dense }: TableProps<R>) {
  const [key, setKey] = useState<string>(defaultKey);
  const [dir, setDir] = useState<1 | -1>(defaultDir);
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === key);
    const arr = [...rows];
    const byName = (a: R, b: R): number => (nameValue ? nameValue(a) - nameValue(b) : nameOf(a).localeCompare(nameOf(b)));
    arr.sort((a, b) => {
      if (!col) return byName(a, b) * dir;
      const va = col.value(a), vb = col.value(b);
      if (va === null && vb === null) return byName(a, b);
      if (va === null) return 1; // missing values always sink, regardless of direction
      if (vb === null) return -1;
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir || byName(a, b);
      return va === vb ? byName(a, b) : (va - vb) * dir;
    });
    return arr;
  }, [rows, cols, key, dir, nameOf, nameValue]);

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
          <button role="columnheader" className={`balsort balname${key === 'name' ? ' on' : ''}`} onClick={() => clickHead('name')} data-tip={`Sort by ${(nameLabel ?? 'name').toLowerCase()}`}>{nameLabel ?? 'Name'}{arrow('name')}</button>
          {cols.map((c) => (
            <button key={c.key} role="columnheader" className={`balsort balnum${key === c.key ? ' on' : ''}`} onClick={() => clickHead(c.key)} data-tip={c.tip}>{c.label}{arrow(c.key)}</button>
          ))}
        </div>
        {sorted.map((r) => <TableRow key={keyOf(r)} r={r} cols={cols} name={nameOf(r)} dim={dimOf ? dimOf(r) : false} tip={tipOf ? tipOf(r) : undefined} />)}
      </div>
    </div>
  );
}

// ── The shared placement columns ───────────────────────────────────────────────────────────────────────────

/** The columns every impact table shares, worded for its own group and baseline ("buyer runs" against "runs
 *  that did not buy it"; "runs with the hero" against "every other run"; ...). The numbers come from the one
 *  `placementImpact` helper in the sim, so the columns are the same object with different words. */
function placementCols<R extends PlacementStats>(group: string, baseline: string): Record<string, ColDef<R>> {
  return {
    placedN: { key: 'placedN', label: 'Placed n', tip: `${cap(group)} that carry a placement: the runs behind the placement columns.`, value: (r) => r.placedN, cell: (r) => ({ text: String(r.placedN), cls: 'balnum baldim' }) },
    avgPlace: { key: 'avgPlace', label: 'Avg Place', tip: `Average final placement of ${group}. 1 is best, 8 is worst.`, value: (r) => r.avgPlace, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgPlace), cls: `balnum${r.avgPlace === null ? '' : ` balwin${placeHeat(r.avgPlace)}`}` }) },
    firstPct: { key: 'firstPct', label: '1st %', tip: `Percent of ${group} that won the lobby.`, value: (r) => r.firstRate, cell: (r) => ({ text: pctOrDash(r.firstRate), cls: 'balnum' }) },
    top4: { key: 'top4', label: 'Top 4 %', tip: `Percent of ${group} that finished in the top four. Detailed shows its 95% range.`, value: (r) => r.top4Rate, cell: (r) => ({ text: pctOrDash(r.top4Rate), cls: 'balnum' }) },
    top4Ci: { key: 'top4Ci', label: 'Top 4 95%', tip: 'The 95% range the true top-four rate is likely to sit in (Wilson). Sorts by the bottom of the range, so a row whose whole range is high comes first.', value: (r) => (r.top4Ci ? r.top4Ci.lo : null), cell: (r) => ({ text: r.top4Ci ? `${r.top4Ci.lo}% to ${r.top4Ci.hi}%` : '–', cls: 'balnum baldim' }) },
    lastPct: { key: 'lastPct', label: '8th %', tip: `Percent of ${group} that finished 8th.`, value: (r) => r.lastRate, cell: (r) => ({ text: pctOrDash(r.lastRate), cls: 'balnum' }) },
    baseline: { key: 'baseline', label: 'Base Avg', tip: `Average placement of ${baseline}: the other side of the delta. Detailed only.`, value: (r) => r.baselineAvgPlace, firstDir: 1, cell: (r) => ({ text: r.baselineAvgPlace === null ? '–' : `${r.baselineAvgPlace} (${r.baselineN})`, cls: 'balnum baldim' }) },
    delta: { key: 'delta', label: 'Delta', tip: `Average placement of ${group} minus ${baseline}. Negative means ${group} finish better.`, value: (r) => r.delta, firstDir: 1, cell: (r) => ({ text: signed(r.delta), cls: `balnum${r.delta === null ? '' : ` balwin${deltaHeat(r.delta)}`}` }) },
    deltaCi: { key: 'deltaCi', label: 'Delta 95%', tip: 'The 95% range the true delta is likely to sit in. A range that crosses zero is not a finding yet. Sorts by the top of the range, so a row whose whole range is below zero comes first.', value: (r) => (r.deltaCi ? r.deltaCi.hi : null), firstDir: 1, cell: (r) => ({ text: r.deltaCi ? `${signed(r.deltaCi.lo, 1)} to ${signed(r.deltaCi.hi, 1)}` : '–', cls: 'balnum baldim' }) },
    impact: { key: 'impact', label: 'Impact', tip: `The delta shrunk toward zero for a small sample. A row keeps half its delta at ${SAMPLE_GATES.preliminary} placed ${group} and most of it past ${SAMPLE_GATES.confident}. The default order: the strongest, best-supported advantage first.`, value: (r) => r.impact, firstDir: 1, cell: (r) => ({ text: signed(r.impact), cls: `balnum${r.impact === null ? '' : ` balwin${deltaHeat(r.impact)}`}` }) },
  };
}

const pick = <R,>(cols: Record<string, ColDef<R>>, keys: string[]): ColDef<R>[] => keys.map((k) => cols[k]!);
const dimBelow = (r: { gate: SampleGate }): boolean => r.gate === 'below';
const better = (d: number | null): string => ((d ?? 0) <= 0 ? 'better' : 'worse');
const abs2 = (d: number | null): string => Math.abs(d ?? 0).toFixed(2);
const ciText = (ci: { lo: number; hi: number } | null): string => (ci ? ` (95% ${signed(ci.lo, 1)} to ${signed(ci.hi, 1)})` : '');

// ── Minions / Spells: the card columns ─────────────────────────────────────────────────────────────────────

const GATE_TIP = `Runs that acquired the card, counted once per run. Rows under ${SAMPLE_GATES.preliminary} are dimmed as noise.`;
const CARD_COLS: Record<string, ColDef<CardImpactRow>> = {
  ...placementCols<CardImpactRow>('buyer runs', 'runs that did not buy it'),
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
  vsTier: { key: 'vsTier', label: 'Vs Tier', tip: 'The delta minus the average delta of the card\'s tier. High tiers are bought only by runs that lived long enough to reach them, so a whole tier can read green; this shows who stands out within the tier.', value: (r) => r.tierDelta, firstDir: 1, cell: (r) => ({ text: signed(r.tierDelta), cls: `balnum${r.tierDelta === null ? '' : ` balwin${deltaHeat(r.tierDelta)}`}` }) },
  buyWave: { key: 'buyWave', label: 'Buy Wave', tip: 'Average wave the card was acquired on.', value: (r) => r.avgBuyWave, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgBuyWave), cls: 'balnum baldim' }) },
};
const CARD_COMPACT = pick(CARD_COLS, ['tier', 'tribe', 'n', 'buypct', 'discpct', 'avgPlace', 'top4', 'delta', 'vsTier', 'impact']);
const CARD_DETAILED = pick(CARD_COLS, ['tier', 'tribe', 'n', 'runsSeen', 'shopSeen', 'shopBought', 'buypct', 'discSeen', 'discBought', 'discpct', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'delta', 'deltaCi', 'vsTier', 'impact', 'buyWave']);
const cardTip = (r: CardImpactRow): string =>
  `${r.name}: ${r.runsBought} buyer runs, average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)} for the field. Buyers finish ${abs2(r.delta)} places ${better(r.delta)}${ciText(r.deltaCi)}.`;

// ── Heroes ─────────────────────────────────────────────────────────────────────────────────────────────────

const HERO_COLS: Record<string, ColDef<HeroImpactRow>> = {
  ...placementCols<HeroImpactRow>('runs with the hero', 'every other run'),
  n: { key: 'n', label: 'Runs', tip: `Runs that picked the hero. Rows under ${SAMPLE_GATES.preliminary} are dimmed as noise.`, value: (r) => r.runs, cell: (r) => ({ text: String(r.runs), cls: 'balnum' }) },
  offered: { key: 'offered', label: 'Offered', tip: 'Runs whose hero picker offered it.', value: (r) => r.offered, cell: (r) => ({ text: String(r.offered), cls: 'balnum' }) },
  offer: { key: 'offer', label: 'Offer %', tip: 'Percent of all runs where the picker offered it.', value: (r) => r.offerRate, cell: (r) => ({ text: pctOrDash(r.offerRate), cls: 'balnum' }) },
  pick: { key: 'pick', label: 'Pick %', tip: 'Percent of offers that were taken. Do players want it when they see it.', value: (r) => r.pickRate, cell: (r) => ({ text: pctOrDash(r.pickRate), cls: 'balnum' }) },
  avgWins: { key: 'avgWins', label: 'Round Wins', tip: 'Average combat rounds won per run with it.', value: (r) => r.avgWins, cell: (r) => ({ text: fmtNum(r.avgWins), cls: 'balnum' }) },
};
const HERO_COMPACT = pick(HERO_COLS, ['n', 'offer', 'pick', 'avgWins', 'avgPlace', 'firstPct', 'top4', 'lastPct', 'delta', 'impact']);
const HERO_DETAILED = pick(HERO_COLS, ['offered', 'n', 'offer', 'pick', 'avgWins', 'placedN', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'baseline', 'delta', 'deltaCi', 'impact']);
const heroTip = (r: HeroImpactRow): string =>
  `${r.name}: ${r.runs} runs, average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)} for every other run. Its runs finish ${abs2(r.delta)} places ${better(r.delta)}${ciText(r.deltaCi)}.`;

// ── Runes ──────────────────────────────────────────────────────────────────────────────────────────────────

const RUNE_COLS: Record<string, ColDef<RuneImpactRow>> = {
  ...placementCols<RuneImpactRow>('taker runs', 'the runs offered it that skipped it'),
  forge: { key: 'forge', label: 'Forge', tip: 'Which Runeforge offers it: Basic on turn 6, Epic on turn 9.', value: (r) => (r.forge === 'basic' ? 0 : 1), firstDir: 1, cell: (r) => ({ text: cap(r.forge), cls: 'balnum baldim' }) },
  cost: { key: 'cost', label: 'Cost', tip: 'The rune\'s Gold cost.', value: (r) => r.cost, firstDir: 1, cell: (r) => ({ text: fmtNum(r.cost), cls: 'balnum baldim' }) },
  tribe: { key: 'tribe', label: 'Tribe', tip: 'The rune\'s tribe gate, when it has one. Most runes have none.', value: (r) => (r.tribes.length ? r.tribes.join('/') : null), firstDir: 1, cell: (r) => ({ text: r.tribes.length ? r.tribes.map(cap).join('/') : '–', cls: 'balnum baldim' }) },
  offered: { key: 'offered', label: 'Offered', tip: 'Runs the Runeforge offered it to, counted once per run.', value: (r) => r.offered, cell: (r) => ({ text: String(r.offered), cls: 'balnum' }) },
  n: { key: 'n', label: 'Takers', tip: `Runs that took the rune, counted once per run. Rows under ${SAMPLE_GATES.preliminary} are dimmed as noise.`, value: (r) => r.picked, cell: (r) => ({ text: String(r.picked), cls: 'balnum' }) },
  pick: { key: 'pick', label: 'Pick %', tip: 'Percent of runs offered it that took it.', value: (r) => r.pickRate, cell: (r) => ({ text: pctOrDash(r.pickRate), cls: 'balnum' }) },
  vsField: { key: 'vsField', label: 'Vs Field', tip: 'The uncontrolled read: average placement of taker runs minus every other run in the report, including runs eliminated before any forge. Reads green for most runes, because only a run that survived to turn 6 or 9 is offered one.', value: (r) => r.fieldDelta, firstDir: 1, cell: (r) => ({ text: signed(r.fieldDelta), cls: `balnum${r.fieldDelta === null ? '' : ` balwin${deltaHeat(r.fieldDelta)}`}` }) },
  vsFieldCi: { key: 'vsFieldCi', label: 'Vs Field 95%', tip: 'The 95% range of Vs Field. Sorts by the top of the range.', value: (r) => (r.fieldDeltaCi ? r.fieldDeltaCi.hi : null), firstDir: 1, cell: (r) => ({ text: r.fieldDeltaCi ? `${signed(r.fieldDeltaCi.lo, 1)} to ${signed(r.fieldDeltaCi.hi, 1)}` : '–', cls: 'balnum baldim' }) },
};
const RUNE_COMPACT = pick(RUNE_COLS, ['forge', 'cost', 'offered', 'n', 'pick', 'avgPlace', 'top4', 'delta', 'vsField', 'impact']);
const RUNE_DETAILED = pick(RUNE_COLS, ['forge', 'cost', 'tribe', 'offered', 'n', 'pick', 'placedN', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'baseline', 'delta', 'deltaCi', 'vsField', 'vsFieldCi', 'impact']);
const runeTip = (r: RuneImpactRow): string =>
  `${r.name}: taken in ${r.picked} of the ${r.offered} runs offered it. Takers average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)} for the ${r.baselineN} placed runs that skipped it, so takers finish ${abs2(r.delta)} places ${better(r.delta)}${ciText(r.deltaCi)}.`;

// ── Shop tiers ─────────────────────────────────────────────────────────────────────────────────────────────

const TIER_COLS: Record<string, ColDef<TierImpactRow>> = {
  ...placementCols<TierImpactRow>('early runs', 'runs that reached the tier later or never'),
  reached: { key: 'reached', label: 'Reached', tip: 'Runs whose shop ever reached this tier.', value: (r) => r.runsReached, cell: (r) => ({ text: String(r.runsReached), cls: 'balnum' }) },
  reachPct: { key: 'reachPct', label: 'Reach %', tip: 'Percent of all runs that reached this tier.', value: (r) => r.reachRate, cell: (r) => ({ text: pctOrDash(r.reachRate), cls: 'balnum' }) },
  avgWave: { key: 'avgWave', label: 'Avg Wave', tip: 'The average wave a run first reached this tier, over the runs that did.', value: (r) => r.avgWaveReached, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgWaveReached), cls: 'balnum' }) },
  reachedPlaced: { key: 'reachedPlaced', label: 'Reached Placed', tip: 'Runs that reached the tier and carry a placement.', value: (r) => r.reachedPlacedN, cell: (r) => ({ text: String(r.reachedPlacedN), cls: 'balnum baldim' }) },
  reachedAvg: { key: 'reachedAvg', label: 'Reached Avg', tip: 'Average final placement of every run that reached this tier, early or late.', value: (r) => r.reachedAvgPlace, firstDir: 1, cell: (r) => ({ text: fmtNum(r.reachedAvgPlace), cls: `balnum${r.reachedAvgPlace === null ? '' : ` balwin${placeHeat(r.reachedAvgPlace)}`}` }) },
  vsNever: { key: 'vsNever', label: 'Vs Never', tip: 'Average placement of runs that reached the tier minus runs that never did. Reads green for every tier, because the runs that never reached it are the early eliminations. Delta is the useful one.', value: (r) => r.reachedDelta, firstDir: 1, cell: (r) => ({ text: signed(r.reachedDelta), cls: `balnum${r.reachedDelta === null ? '' : ` balwin${deltaHeat(r.reachedDelta)}`}` }) },
  cut: { key: 'cut', label: 'By Wave', tip: 'The cut that defines early: the average wave rounded. Early runs reached the tier on or before this wave.', value: (r) => r.cutWave, firstDir: 1, cell: (r) => ({ text: r.cutWave === null ? '–' : `wave ${r.cutWave}`, cls: 'balnum baldim' }) },
  early: { key: 'early', label: 'Early Runs', tip: `Runs that reached the tier by the cut wave: the sample behind the placement columns. Rows under ${SAMPLE_GATES.preliminary} are dimmed as noise.`, value: (r) => r.earlyRuns, cell: (r) => ({ text: String(r.earlyRuns), cls: 'balnum' }) },
};
const TIER_COMPACT = pick(TIER_COLS, ['reached', 'reachPct', 'avgWave', 'reachedAvg', 'vsNever', 'cut', 'early', 'avgPlace', 'delta', 'impact']);
const TIER_DETAILED = pick(TIER_COLS, ['reached', 'reachPct', 'avgWave', 'reachedPlaced', 'reachedAvg', 'vsNever', 'cut', 'early', 'placedN', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'baseline', 'delta', 'deltaCi', 'impact']);
const tierTip = (r: TierImpactRow): string => {
  if (r.cutWave === null) return `${r.name}: no run reached this tier.`;
  if (r.delta === null) return `${r.name}: ${r.earlyRuns} runs reached it by wave ${r.cutWave}. No placement to compare yet.`;
  return `Runs that reached ${r.name} by wave ${r.cutWave} (${r.earlyRuns} runs) finished ${abs2(r.delta)} places ${better(r.delta)} than runs that reached it later or never: average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)}${ciText(r.deltaCi)}.`;
};

// ── The generic impact section ─────────────────────────────────────────────────────────────────────────────

/** The plain-words read of a group chip, for its hover. */
function groupTip(g: ImpactGroupRow, what: string, noun: string, sample: string, baseline: string): string {
  const head = `${what} ${g.label}: ${g.cards} ${noun}, ${g.runsBought} ${sample}.`;
  if (g.delta === null) return `${head} No placement data yet.`;
  return `${head} They finish ${Math.abs(g.delta).toFixed(2)} places ${g.delta <= 0 ? 'better' : 'worse'} than ${baseline} on average.`;
}

/** A group strip: one chip per tier / tribe / forge, its sample and its delta with the delta heat. Clicking a
 *  chip filters the section to that group; clicking it again clears the filter. */
interface StripDef<R> {
  what: string;
  groups: ImpactGroupRow[];
  matches: (r: R, key: string) => boolean;
}

function GroupStrip({ what, groups, active, onPick, noun, sample, baseline }: { what: string; groups: ImpactGroupRow[]; active: string | null; onPick: (key: string | null) => void; noun: string; sample: string; baseline: string }) {
  if (groups.length === 0) return null;
  return (
    <div className="balstrip" role="group" aria-label={`${what} summary`}>
      <span className="balstrip-label">{what}</span>
      {groups.map((g) => (
        <button
          key={g.key}
          className={`balgchip${active === g.key ? ' on' : ''}`}
          onClick={() => { sfx.tick(); onPick(active === g.key ? null : g.key); }}
          data-tip={groupTip(g, what, noun, sample, baseline)}
        >
          <span className="balgchip-l">{g.label}</span>
          <span className="balgchip-n">{g.runsBought}</span>
          <span className={`balgchip-d balwin${deltaHeat(g.delta)}`}>{signed(g.delta)}</span>
        </button>
      ))}
    </div>
  );
}

/** What a row needs to be drawn as a bar in the ranked chart. */
type BarRow = PlacementStats & { name: string; gate: SampleGate };

/**
 * The ranked diverging bar chart of the placement delta: bars grow LEFT (green) when a row's group finishes
 * better than its baseline and RIGHT (red) when worse, strongest at the top, and FADE with a thin sample so a
 * 3-run outlier never reads as a finding. Plain HTML bars (thin, rounded data-end, a hairline baseline),
 * every bar a hover target, the table beside it the WCAG twin.
 */
function ImpactChart<R extends BarRow>({ rows, keyOf, nOf, tipOf, noun, group, baseline }: {
  rows: R[]; keyOf: (r: R) => string; nOf: (r: R) => number; tipOf: (r: R) => string;
  noun: string; group: string; baseline: string;
}) {
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
        <button className={hideThin ? '' : 'on'} onClick={() => { sfx.tick(); setHideThin(false); }}>All {noun}</button>
        <button className={hideThin ? 'on' : ''} onClick={() => { sfx.tick(); setHideThin(true); }} data-tip={`Only ${noun} with at least ${SAMPLE_GATES.preliminary} ${group}`}>Hide thin samples</button>
      </div>
    </div>
  );
  if (ranked.length === 0) return <div className="balimp">{thinToggle}<div className="balempty">No {noun} with placement data{hideThin ? ` and at least ${SAMPLE_GATES.preliminary} ${group}` : ''} yet.</div></div>;
  const maxAbs = Math.max(0.01, ...ranked.map((r) => Math.abs(r.delta!)));
  const shown = showAll || ranked.length <= EDGE * 2
    ? ranked
    : [...ranked.slice(0, EDGE), null, ...ranked.slice(ranked.length - EDGE)];
  const opacityOf = (r: R): number => 0.3 + 0.7 * Math.min(1, nOf(r) / SAMPLE_GATES.actionable);
  return (
    <div className="balimp">
      <div className="balnote">
        Each bar is the row's <b>Delta</b>: the average placement of {group} minus {baseline}.
        A bar to the <b>left</b> means they finish better, to the <b>right</b> worse.
        Bars fade with a thin sample and are solid at {SAMPLE_GATES.actionable} {group}. Hover a bar for its numbers.
      </div>
      {thinToggle}
      <div className="balimp-axis"><span>finish better</span><span>0</span><span>finish worse</span></div>
      {shown.map((r) => (r === null ? (
        <div key="gap" className="balimp-gap">
          <button className="balrun balimp-more" onClick={() => { sfx.tick(); setShowAll(true); }}>Show all {ranked.length}</button>
        </div>
      ) : (
        <div key={keyOf(r)} className={`balimp-row${r.gate === 'below' ? ' baldim' : ''}`} data-tip={tipOf(r)} tabIndex={0}>
          <span className="balimp-name">{r.name}</span>
          <span className="balimp-n">{nOf(r)}</span>
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

type SectionView = 'table' | 'chart';
type Density = 'compact' | 'detailed';

/**
 * ONE impact section for every kind of row: the legend, the group strips (which double as filters), the view
 * toggles, and the table or the chart over the same rows. The strip filters are the section's own state: the
 * panel keys the section by its kind, so switching kinds starts clean (a Beast filter picked on Minions used
 * to follow the owner onto Spells, which has no Beast chip to clear it with), and a filter that leaves nothing
 * shows a Clear filters control instead of an empty table.
 */
function ImpactSection<R extends BarRow>({ rows, cols, strips, keyOf, nOf, tipOf, legend, noun, group, baseline, defaultKey, nameLabel, nameValue, view, setView, density, setDensity }: {
  rows: R[];
  cols: { compact: ColDef<R>[]; detailed: ColDef<R>[] };
  strips: StripDef<R>[];
  keyOf: (r: R) => string;
  nOf: (r: R) => number;
  tipOf: (r: R) => string;
  legend: ReactNode;
  /** The plural noun of the rows (cards, heroes, runes, tiers), the group's runs (buyer runs, taker runs,
   *  ...) and the baseline, in plain words, for every hover and the chart's axis. */
  noun: string; group: string; baseline: string;
  defaultKey?: string;
  nameLabel?: string;
  nameValue?: (r: R) => number;
  view: SectionView; setView: (v: SectionView) => void;
  density: Density; setDensity: (d: Density) => void;
}) {
  const [filters, setFilters] = useState<(string | null)[]>(() => strips.map(() => null));
  const visible = useMemo(() => rows.filter((r) => strips.every((s, i) => filters[i] == null || s.matches(r, filters[i]!))), [rows, strips, filters]);
  const filtering = filters.some((f) => f !== null);
  const clearFilters = (): void => { sfx.tick(); setFilters(strips.map(() => null)); };
  const nameOf = (r: R): string => r.name;
  if (rows.length === 0) return <div className="balempty">No {noun} in these runs yet.</div>;
  return (
    <>
      <div className="balnote">{legend}</div>
      {strips.map((s, i) => (
        <GroupStrip key={s.what} what={s.what} groups={s.groups} active={filters[i] ?? null} noun={noun} sample={group} baseline={baseline}
          onPick={(k) => setFilters((f) => f.map((v, j) => (j === i ? k : v)))} />
      ))}
      <div className="balseg-row">
        <div className="balseg" role="group" aria-label="View">
          <button className={view === 'table' ? 'on' : ''} onClick={() => { sfx.tick(); setView('table'); }}>Table</button>
          <button className={view === 'chart' ? 'on' : ''} onClick={() => { sfx.tick(); setView('chart'); }}>Chart</button>
        </div>
        {view === 'table' && (
          <div className="balseg" role="group" aria-label="Columns">
            <button className={density === 'compact' ? 'on' : ''} onClick={() => { sfx.tick(); setDensity('compact'); }} data-tip={`The ${cols.compact.length} columns that answer the question`}>Compact</button>
            <button className={density === 'detailed' ? 'on' : ''} onClick={() => { sfx.tick(); setDensity('detailed'); }} data-tip={`Every column (${cols.detailed.length}), including the raw counts and the 95% ranges`}>Detailed</button>
          </div>
        )}
        <span className="balseg-count">{visible.length} of {rows.length} {noun}{filtering ? ' (filtered)' : ''}</span>
        {filtering && <button className="balrun balimp-more" onClick={clearFilters} data-tip="Show every group again">Clear filters</button>}
      </div>
      {visible.length === 0
        ? <div className="balempty">No {noun} match the groups picked above.</div>
        : view === 'chart'
          ? <ImpactChart rows={visible} keyOf={keyOf} nOf={nOf} tipOf={tipOf} noun={noun} group={group} baseline={baseline} />
          : (
            <DataTable
              key={density}
              cols={density === 'compact' ? cols.compact : cols.detailed}
              rows={visible}
              keyOf={keyOf}
              nameOf={nameOf}
              nameLabel={nameLabel}
              nameValue={nameValue}
              dimOf={dimBelow}
              tipOf={tipOf}
              defaultKey={defaultKey ?? 'impact'}
              defaultDir={1}
              dense={density === 'detailed'}
            />
          )}
    </>
  );
}

const CARD_COLSET = { compact: CARD_COMPACT, detailed: CARD_DETAILED };
const HERO_COLSET = { compact: HERO_COMPACT, detailed: HERO_DETAILED };
const RUNE_COLSET = { compact: RUNE_COMPACT, detailed: RUNE_DETAILED };
const TIER_COLSET = { compact: TIER_COMPACT, detailed: TIER_DETAILED };
const NO_STRIPS: StripDef<any>[] = [];
const idOf = (r: { id: string }): string => r.id;
const tierKey = (r: TierImpactRow): string => String(r.tier);
const tierN = (r: TierImpactRow): number => r.earlyRuns;
const tierOrder = (r: TierImpactRow): number => r.tier;
const cardN = (r: CardImpactRow): number => r.runsBought;
const heroN = (r: HeroImpactRow): number => r.runs;
const runeN = (r: RuneImpactRow): number => r.picked;

// ── The panel ──────────────────────────────────────────────────────────────────────────────────────────────

type SectionKey = 'minions' | 'spells' | 'heroes' | 'runes' | 'shopcurve' | 'economy' | 'upgrades';

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
  const [view, setView] = useState<SectionView>('table');
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
  const cardStrips = useMemo(() => {
    const strips = (list: CardImpactRow[]): StripDef<CardImpactRow>[] => [
      { what: 'Tier', groups: impactGroups(list, 'tier'), matches: (r, k) => String(r.tier) === k },
      { what: 'Tribe', groups: impactGroups(list, 'tribe'), matches: (r, k) => r.tribe === k || r.tribe2 === k },
    ];
    return { minions: strips(impact.minions), spells: strips(impact.spells) };
  }, [impact]);
  // Heroes read the WHOLE set slice: the hero picker slicing the hero table to one row against nobody answers
  // nothing, so the picker is disabled on this section and the legend says so.
  const heroes = useMemo(() => heroImpact(filtered.rows), [filtered]);
  const runes = useMemo(() => runeImpact(heroRows), [heroRows]);
  const runeStrips = useMemo((): StripDef<RuneImpactRow>[] => [{ what: 'Forge', groups: runeGroups(runes), matches: (r, k) => r.forge === k }], [runes]);
  const tiers = useMemo(() => tierImpact(heroRows), [heroRows]);
  const economy = useMemo(() => goldEconomy(heroRows), [heroRows]);
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
  const isDerived = sectionKey === 'economy' || sectionKey === 'upgrades';
  const hasData = heroRows.length > 0;
  const toggles = { view, setView, density, setDensity };
  const derivedHint = derived.length ? ` (${derived.length} runs)` : derivedLoading ? ' (loading)' : '';

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
              <option value="heroes">Heroes ({heroes.length})</option>
              <option value="runes">Runes ({runes.length})</option>
              <option value="shopcurve">Shop Tiers</option>
              <option value="economy">Gold Economy{derivedHint}</option>
              <option value="upgrades">Upgrade Timing{derivedHint}</option>
            </select>
            {/* HERO SLICE: re-aggregates the whole report for one hero (owner ask 2026-08-02). */}
            <select
              className="balpick"
              value={heroFilter}
              onChange={(e) => { sfx.pulse(); setHeroFilter(e.target.value); }}
              aria-label="Filter by hero"
              disabled={heroIds.length === 0 || sectionKey === 'heroes'}
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
            {heroFilter && sectionKey !== 'heroes' ? ` · ${getHero(heroFilter).name} only (${heroRows.length} runs)` : ''}
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
        ) : sectionKey === 'minions' || sectionKey === 'spells' ? (
          <ImpactSection
            key={sectionKey}
            rows={sectionKey === 'minions' ? impact.minions : impact.spells}
            cols={CARD_COLSET}
            strips={sectionKey === 'minions' ? cardStrips.minions : cardStrips.spells}
            keyOf={idOf} nOf={cardN} tipOf={cardTip}
            noun="cards" group="buyer runs" baseline="runs that did not buy it"
            legend={(
              <>
                Every column is PER RUN: a run that bought a card three times is one buyer run. <b>Delta</b> is the average placement
                of runs that bought the card minus runs that did not, so a negative delta (green) means its buyers finish better
                than the field and a positive one (red) worse. <b>Vs Tier</b> compares a card with its own tier, because a high
                tier is bought only by runs that survived long enough to reach it and reads green as a whole. <b>Impact</b> is the
                delta shrunk toward zero for a thin sample and is the default order. Rows under {SAMPLE_GATES.preliminary} buyer
                runs are dimmed. Hover any column header for its meaning, or a name for its row in plain words.
              </>
            )}
            {...toggles}
          />
        ) : sectionKey === 'heroes' ? (
          <ImpactSection
            key="heroes"
            rows={heroes}
            cols={HERO_COLSET}
            strips={NO_STRIPS}
            keyOf={idOf} nOf={heroN} tipOf={heroTip}
            noun="heroes" group="runs with the hero" baseline="every other run"
            legend={(
              <>
                One row per hero over every {set.name} run (the hero picker does not apply here). <b>Delta</b> is the average placement
                of runs with the hero minus every other run, so a negative delta (green) means the hero finishes better than the
                field. Every run has one hero, so the deltas balance out across the roster and there is no tier-style adjustment.
                <b> Impact</b> is the delta shrunk toward zero for a thin sample and is the default order. With {filtered.rows.length} runs
                across {heroes.length} heroes most rows sit under the {SAMPLE_GATES.preliminary}-run gate and are dimmed: read the 95%
                ranges before reading the deltas. Hover any column header for its meaning, or a name for its row in plain words.
              </>
            )}
            {...toggles}
          />
        ) : sectionKey === 'runes' ? (
          <ImpactSection
            key={`runes:${heroFilter}`}
            rows={runes}
            cols={RUNE_COLSET}
            strips={runeStrips}
            keyOf={idOf} nOf={runeN} tipOf={runeTip}
            noun="runes" group="taker runs" baseline="the runs offered it that skipped it"
            legend={(
              <>
                One row per rune, counted once per run. <b>Delta</b> is the average placement of runs that took the rune minus the
                runs that were <b>offered it and skipped it</b>. That baseline is the fair one: a rune is only offered to runs that
                survived to its forge (turn 6 for Basic, turn 9 for Epic), so against the whole field every rune reads green.
                <b> Vs Field</b> is that uncontrolled read, kept for reference. <b>Impact</b> is the delta shrunk toward zero for a
                thin sample and is the default order. Rows under {SAMPLE_GATES.preliminary} taker runs are dimmed. The Forge chips
                roll the runes up and filter the table. Hover any column header for its meaning, or a name for its row in plain words.
              </>
            )}
            {...toggles}
          />
        ) : sectionKey === 'shopcurve' ? (
          <>
            <ShopCurveChart curve={report.shopCurve} />
            <div className="balgap" />
            <ImpactSection
              key={`tiers:${heroFilter}`}
              rows={tiers}
              cols={TIER_COLSET}
              strips={NO_STRIPS}
              keyOf={tierKey} nOf={tierN} tipOf={tierTip}
              noun="tiers" group="early runs" baseline="runs that reached the tier later or never"
              defaultKey="name" nameLabel="Tier" nameValue={tierOrder}
              legend={(
                <>
                  One row per shop tier. <b>Reached</b> and <b>Avg Wave</b> say how many runs got there and when. <b>By Wave</b> is that
                  average rounded, and the <b>early runs</b> are the runs that reached the tier on or before it. <b>Delta</b> is the
                  average placement of the early runs minus the runs that reached the tier later or never, so a negative delta (green)
                  means leveling by that wave goes with a better finish. <b>Vs Never</b> compares everyone who reached the tier with
                  everyone who never did; it reads green for every tier, because the runs that never got there are the early
                  eliminations. Hover a tier name for its row in plain words.
                </>
              )}
              {...toggles}
            />
          </>
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
          ) : sectionKey === 'economy' ? <EconomySection key={heroFilter} economy={economy} {...toggles} />
            : <UpgradeTable runs={derived} />
        ) : null}
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

// ── The Gold economy ───────────────────────────────────────────────────────────────────────────────────────

const BUCKET_LABEL: Record<EconomyBucket, string> = { all: 'All runs', first: '1st place', top4: 'Top 4', bottom4: 'Bottom 4' };
const BUCKET_TIP: Record<EconomyBucket, string> = {
  all: 'Every run with a Gold ledger, placed or not',
  first: 'Runs that won the lobby',
  top4: 'Runs that placed 1st to 4th',
  bottom4: 'Runs that placed 5th to 8th',
};
const SPEND_LABEL: Record<SpendCategory, string> = { minion: 'Minions', spell: 'Spells', upgrade: 'Tier Ups', refresh: 'Rolls', rune: 'Runes', heroPower: 'Hero Pwr', other: 'Other' };
const SPEND_TIP: Record<SpendCategory, string> = {
  minion: 'Average Gold spent on minions this round.',
  spell: 'Average Gold spent on spells this round.',
  upgrade: 'Average Gold spent on shop tier-ups this round.',
  refresh: 'Average Gold spent rerolling the shop this round.',
  rune: 'Average Gold spent at the Runeforge this round, buys and rerolls.',
  heroPower: 'Average Gold spent on the hero power this round.',
  other: 'Average Gold spent on anything else (rubies, henchmen). No live run has used these.',
};
const gold1 = (n: number): string => (n === 0 ? '–' : n.toFixed(1));

const ECONOMY_COLS: Record<string, ColDef<EconomyWaveRow>> = {
  runs: { key: 'runs', label: 'Runs', tip: 'Runs of the picked bucket that played this round: the divisor of every average in the row.', value: (r) => r.runs, cell: (r) => ({ text: String(r.runs), cls: 'balnum baldim' }) },
  goldStart: { key: 'goldStart', label: 'Start', tip: 'Average Gold a player has when the round opens, after the refill. Wave 1 opens on 3.', value: (r) => r.goldStart, cell: (r) => ({ text: r.goldStart.toFixed(1), cls: 'balnum balwin' }) },
  income: { key: 'income', label: 'Income', tip: 'Average Gold that came in during the round from cards and hero effects. The refill is not counted here; it is the next round\'s Start.', value: (r) => r.income, cell: (r) => ({ text: gold1(r.income), cls: 'balnum' }) },
  sold: { key: 'sold', label: 'Sold', tip: 'Average Gold recovered by selling during the round.', value: (r) => r.sold, cell: (r) => ({ text: gold1(r.sold), cls: 'balnum' }) },
  spent: { key: 'spent', label: 'Spent', tip: 'Average Gold spent during the round, all categories. The split to the right says on what.', value: (r) => r.spent, cell: (r) => ({ text: r.spent.toFixed(1), cls: 'balnum balwin' }) },
  spentPct: { key: 'spentPct', label: 'Spent %', tip: 'Spent as a percent of what was available: Start plus Income plus Sold.', value: (r) => r.spentPct, cell: (r) => ({ text: pctOrDash(r.spentPct), cls: 'balnum' }) },
  unspent: { key: 'unspent', label: 'Unspent', tip: 'Average Gold left when the round ended. It is not carried over: the next round refills to the cap, so this Gold is lost.', value: (r) => r.unspent, cell: (r) => ({ text: r.unspent.toFixed(1), cls: `balnum${r.unspent >= 2 ? ' balwin cold' : r.unspent >= 1 ? ' balwin cool' : ''}` }) },
  ...Object.fromEntries(SPEND_CATEGORIES.map((c): [string, ColDef<EconomyWaveRow>] => [c, { key: c, label: SPEND_LABEL[c], tip: SPEND_TIP[c], value: (r) => r.split[c], cell: (r) => ({ text: gold1(r.split[c]), cls: 'balnum' }) }])),
};
const ECONOMY_COMPACT = pick(ECONOMY_COLS, ['runs', 'goldStart', 'spent', 'spentPct', 'unspent', 'minion', 'spell', 'upgrade', 'refresh']);
const ECONOMY_DETAILED = pick(ECONOMY_COLS, ['runs', 'goldStart', 'income', 'sold', 'spent', 'spentPct', 'unspent', 'minion', 'spell', 'upgrade', 'refresh', 'rune', 'heroPower', 'other']);
const waveKey = (r: EconomyWaveRow): string => String(r.wave);
const waveName = (r: EconomyWaveRow): string => `Wave ${r.wave}`;
const waveOrder = (r: EconomyWaveRow): number => r.wave;
const economyTip = (r: EconomyWaveRow): string =>
  `Wave ${r.wave}, ${r.runs} runs: a player opens on ${r.goldStart.toFixed(1)} Gold, spends ${r.spent.toFixed(1)} and leaves ${r.unspent.toFixed(1)} on the table.`;

/**
 * The Gold curve (owner ask 2026-09-22: "the average gold a player has/spends per round"). ONE table at a time:
 * a bucket switch (all runs, 1st place, top 4, bottom 4) above the per-round table, Compact / Detailed like the
 * impact tables, and a Chart view: a static SVG line chart of the Gold available and the Gold spent per round,
 * winners against everyone, so the curve of the two reads at a glance.
 */
function EconomySection({ economy, view, setView, density, setDensity }: { economy: GoldEconomy; view: SectionView; setView: (v: SectionView) => void; density: Density; setDensity: (d: Density) => void }) {
  const [bucket, setBucket] = useState<EconomyBucket>('all');
  const rows = economy.waves[bucket];
  return (
    <>
      <div className="balnote">
        Each row is one round, averaged over the runs of the picked bucket that played it. <b>Start</b> is the Gold a player has
        when the round opens, after the refill. <b>Spent</b> is everything paid out that round, split by what it bought.
        <b> Unspent</b> is what was left when the round ended; it is not carried over, so it is lost. Start plus Income plus
        Sold equals Spent plus Unspent for every run. Gold rules have not changed across builds, so every run with a ledger
        counts{economy.skipped > 0 ? `, except ${economy.skipped} left out because the ledger was partial or did not open on the game's 3 Gold (a dev build)` : ''}.
        Hover any column header for its meaning, or a wave for its row in plain words.
      </div>
      <div className="balseg-row">
        <div className="balseg" role="group" aria-label="Runs">
          {(Object.keys(BUCKET_LABEL) as EconomyBucket[]).map((b) => (
            <button key={b} className={bucket === b ? 'on' : ''} disabled={economy.runs[b] === 0} onClick={() => { sfx.tick(); setBucket(b); }} data-tip={`${BUCKET_TIP[b]} (${economy.runs[b]})`}>
              {BUCKET_LABEL[b]} ({economy.runs[b]})
            </button>
          ))}
        </div>
        <div className="balseg" role="group" aria-label="View">
          <button className={view === 'table' ? 'on' : ''} onClick={() => { sfx.tick(); setView('table'); }}>Table</button>
          <button className={view === 'chart' ? 'on' : ''} onClick={() => { sfx.tick(); setView('chart'); }}>Chart</button>
        </div>
        {view === 'table' && (
          <div className="balseg" role="group" aria-label="Columns">
            <button className={density === 'compact' ? 'on' : ''} onClick={() => { sfx.tick(); setDensity('compact'); }} data-tip="Start, spent, unspent and the four main spends">Compact</button>
            <button className={density === 'detailed' ? 'on' : ''} onClick={() => { sfx.tick(); setDensity('detailed'); }} data-tip="Every column, including income, sells and the rare spends">Detailed</button>
          </div>
        )}
      </div>
      {view === 'chart' ? <EconomyChart economy={economy} /> : rows.length === 0 ? <div className="balempty">No rounds in this bucket yet.</div> : (
        <DataTable
          key={`${bucket}:${density}`}
          cols={density === 'compact' ? ECONOMY_COMPACT : ECONOMY_DETAILED}
          rows={rows}
          keyOf={waveKey}
          nameOf={waveName}
          nameLabel="Round"
          nameValue={waveOrder}
          tipOf={economyTip}
          defaultKey="name"
          defaultDir={1}
          dense={density === 'detailed'}
        />
      )}
    </>
  );
}

/** A static SVG line chart of the Gold curve: what a player has (Start plus Income plus Sold) and what they
 *  spend, per round, for everyone and for the winners. Three series, direct-labelled at the line end, a legend
 *  beneath, hairline grid, no animation. The table is the twin. */
function EconomyChart({ economy }: { economy: GoldEconomy }) {
  const all = economy.waves.all;
  const first = economy.waves.first;
  if (all.length === 0) return <div className="balempty">No rounds to chart yet.</div>;
  const maxWave = all[all.length - 1]!.wave;
  const avail = (r: EconomyWaveRow): number => r.goldStart + r.income + r.sold;
  const series: { key: string; label: string; cls: string; points: [number, number][] }[] = [
    { key: 'avail', label: 'Gold available, all runs', cls: 'avail', points: all.map((r) => [r.wave, avail(r)]) },
    { key: 'spent', label: 'Gold spent, all runs', cls: 'spent', points: all.map((r) => [r.wave, r.spent]) },
    ...(first.length > 0 ? [{ key: 'spentwin', label: `Gold spent, 1st place (${economy.runs.first})`, cls: 'spentwin', points: first.map((r): [number, number] => [r.wave, r.spent]) }] : []),
  ];
  const maxGold = Math.max(4, ...series.flatMap((s) => s.points.map((p) => p[1])));
  // A tick step of 1, 2, 5, 10 or 20 Gold, whichever keeps the axis at eight labels or fewer.
  const step = [1, 2, 5, 10, 20].find((s) => maxGold / s <= 8) ?? 20;
  const top = Math.ceil(maxGold / step) * step;
  const W = 760, H = 400, padL = 56, padR = 130, padT = 22, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = (wave: number): number => padL + (maxWave === 1 ? plotW / 2 : ((wave - 1) / (maxWave - 1)) * plotW);
  const y = (g: number): number => padT + (1 - g / top) * plotH;
  const path = (pts: [number, number][]): string => pts.map(([w, g], i) => `${i === 0 ? 'M' : 'L'}${x(w).toFixed(1)} ${y(g).toFixed(1)}`).join(' ');
  const goldTicks: number[] = [];
  for (let g = 0; g <= top; g += step) goldTicks.push(g);
  const waveTicks: number[] = [];
  for (let w = 1; w <= maxWave; w++) if (maxWave <= 12 || w % 2 === 1 || w === maxWave) waveTicks.push(w);
  return (
    <div className="balchart">
      <svg viewBox={`0 0 ${W} ${H}`} className="balchart-svg" role="img" aria-label="Average Gold available and spent per round, all runs and winners">
        {goldTicks.map((g) => (
          <g key={`y${g}`}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} className="balchart-grid" />
            <text x={padL - 9} y={y(g) + 4} className="balchart-axl" textAnchor="end">{g}</text>
          </g>
        ))}
        {waveTicks.map((w) => (
          <text key={`x${w}`} x={x(w)} y={H - padB + 22} className="balchart-axl" textAnchor="middle">{w}</text>
        ))}
        <text x={padL + plotW / 2} y={H - 6} className="balchart-axt" textAnchor="middle">Wave</text>
        <text x={14} y={padT + plotH / 2} className="balchart-axt" textAnchor="middle" transform={`rotate(-90 14 ${padT + plotH / 2})`}>Gold</text>
        {series.map((s) => (
          <g key={s.key}>
            <path d={path(s.points)} className={`balchart-line ${s.cls}`} fill="none" />
            {s.points.map(([w, g]) => <circle key={w} cx={x(w)} cy={y(g)} r={3.4} className={`balchart-dot ${s.cls}`} />)}
            {/* A direct label at the line's end, so the reader never has to look the colour up. */}
            <text x={x(s.points[s.points.length - 1]![0]) + 8} y={y(s.points[s.points.length - 1]![1]) + 4} className={`balchart-ptl ${s.cls}`} textAnchor="start">{s.points[s.points.length - 1]![1].toFixed(1)}</text>
          </g>
        ))}
      </svg>
      <div className="balchart-legend">
        {series.map((s) => <span key={s.key} className={`balchart-key ${s.cls}`}>{s.label}</span>)}
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
