import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  aggregatePlayerReport, applyReportFilters, buildBalanceExport, buildCardCsv, cardImpactWithCoverage, dataQuality, defaultEpoch, epochsOf, getHero,
  goldEconomy, heroImpact, impactGroups, mostProlificPlayer, performanceSortValue, playerKeyFor, runeGroups, runeImpact, scopeReport, tierDecisions, tierImpact,
  upgradeShape, ALL_EPOCHS, EPOCH_MIN_RUNS, EVIDENCE_GATES, LEGACY_SET, SAMPLE_GATES, SPEND_CATEGORIES, WELCH_MIN_N,
  type AdjustedStats, type CardImpactRow, type CohortCoverage, type DataQuality, type DerivedRun, type EconomyBucket, type EconomyWaveRow, type EpochInfo,
  type EvidenceLabel, type GoldEconomy, type HeroImpactRow, type ImpactGroupRow, type Interval, type PlacementStats, type PlayerKeyBasis, type ReportScope, type RuneImpactRow,
  type RunTelemetryRow, type SampleGate, type ShopCurve, type SpendCategory, type TierDecisionRow, type TierImpactRow,
} from '@game/sim';
import { activeSet, contentRevision } from '@game/content';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchRunDerived, fetchRunTelemetry, remoteEnabled, BALANCE_FLAT_CAP, BALANCE_FLAT_PAGE } from './remoteBoards';

/**
 * Balance Report (owner request 2026-07-13) — the REAL-PLAYER balance report, opened from the home screen. It
 * fetches finished-run telemetry (`run_telemetry`) and aggregates it client-side. This is PLAYER data, not
 * simulation — the seeded greedy-bot report still lives at `npm run report` (CLI). DEV-only (owner 2026-08-24).
 *
 * Redesign (owner 2026-07-14): ONE table at a time, full-screen + large text, picked from a dropdown, and every
 * column (Name included) is click-to-sort.
 *
 * Rework (owner ask 2026-09-22): "it should only have data for the active set in it, and nothing from scene
 * builder. also make the export export everything so that an ai can analyze all of the data for me at once."
 *  · The DATA filters live in `@game/sim` (`applyReportFilters`): ladder rows only, the ACTIVE set only, a row
 *    with no set stamp read as set 1 and never as the live set.
 *  · "Export all" writes ONE JSON file (`buildBalanceExport`) from the SAME filtered rows the screen renders.
 *  · The fetch is TWO stages: the flat rows first (rendered at once), then the derived payloads BY ID.
 *
 * Round 2 (owner ask 2026-09-22): `ImpactSection` is GENERIC over any row carrying `PlacementStats`; heroes,
 * runes and shop tiers feed it; the Gold economy is rebuilt from the derived ledgers.
 *
 * THE HONEST-ASSOCIATIONS PASS (owner audit handoff 2026-09-22). The raw arithmetic was right; the labels and the
 * comparison groups were not: buyers against ALL other runs rewards survival and card access (a run out on wave 4
 * never saw the wave-12 card it is counted against). What changed on this screen:
 *  · HONEST LABELS: Delta is the Raw buyer association, Impact the Sample-weighted association, Vs Tier the
 *    Relative raw association within tier. No unconditional overpowered / underpowered claim anywhere; the
 *    count-only actionable / confident badges are gone; a thin row is dimmed and described, not judged.
 *  · COUNTS SHOWN SEPARATELY: placed buyers, placed controls, unique players (by the server-side player key, a hash
 *    of the account id; the display name is a labelled proxy only on an un-migrated backend), missing placement.
 *  · THE EVIDENCE BANNER above every table: eligible runs, players, period, epoch, flat / derived coverage with
 *    the exact caps and truncation, the integrity counts, and the one-sentence limitation.
 *  · FILTERS shared with the export: the balance epoch (content revision; defaults to the build's own or the
 *    newest, and shows "insufficient current data" with an explicit historical toggle rather than pooling old
 *    runs silently), the date window, and the sensitivity toggle that excludes the most prolific player.
 *  · THE FOUR VIEWS on Minions / Spells: Demand, Performance (raw, exposed diagnostic and adjusted association
 *    side by side, each with its own Welch interval, evidence label first), Role and timing, Evidence. One table
 *    at a time; the Performance order puts rows with a supported comparison first and never ranks an
 *    insufficient row as the worst card.
 *  · HEROES compare chosen against offered-not-chosen; RUNES keep the offered-and-skipped baseline (replay-
 *    derived offers, said so); SHOP TIERS keep the replay-derived table under a disclosure and add the decision
 *    table (took against declined among runs that could afford it); the ECONOMY states both denominators.
 *  · The fetch pages the flat rows and reports its exact coverage; the export carries schema version 2.
 *  All cohort math runs ONCE per rows / filter version in the memo chain below; rows are memoised.
 */

const fmtNum = (n: number | null): string => (n === null ? '–' : String(n));
const pctOrDash = (n: number | null): string => (n === null ? '–' : `${n}%`);
const signed = (n: number | null, dp = 2): string => (n === null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}`);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '?');

/** Avg-placement heat: a LOW number is a good finish. */
function placeHeat(avg: number | null): string {
  if (avg === null) return '';
  if (avg <= 3) return ' hot';
  if (avg >= 5.5) return ' cold';
  return '';
}
/** Association heat: negative = the group finishes better than its comparison (green), positive = worse (red).
 *  Heat is a reading aid on the number's sign and size, never a verdict on the card. */
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

const EVIDENCE_TEXT: Record<EvidenceLabel, string> = { insufficient: 'Insufficient', candidate: 'Candidate', supported: 'Supported' };
const EVIDENCE_LONG: Record<EvidenceLabel, string> = { insufficient: 'Insufficient evidence', candidate: 'Candidate for review', supported: 'Supported association' };
const EVIDENCE_RANK: Record<EvidenceLabel, number> = { supported: 0, candidate: 1, insufficient: 2 };
const evidenceTip = `${EVIDENCE_LONG.insufficient}: under ${EVIDENCE_GATES.candidate.side} runs on a side or under ${EVIDENCE_GATES.candidate.players} players. ${EVIDENCE_LONG.candidate}: ${EVIDENCE_GATES.candidate.side} a side and ${EVIDENCE_GATES.candidate.players} players. ${EVIDENCE_LONG.supported}: ${EVIDENCE_GATES.supported.side} a side and ${EVIDENCE_GATES.supported.players} players. Players are counted by the server-side player key (a hash of the account id); the banner says when a backend without it makes the count a display-name proxy. None of the three means confirmed overpowered or underpowered.`;
const ciText = (ci: Interval | null): string => (ci ? `${signed(ci.lo, 1)} to ${signed(ci.hi, 1)}` : '–');

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
  /** A thin row renders dimmed. */
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

const THIN_TIP = `Rows under ${SAMPLE_GATES.preliminary} are dimmed: a thin sample, described, not judged.`;

/** The columns every impact table shares, worded for its own group and comparison. The numbers come from the
 *  one `placementImpact` helper in the sim, so the columns are the same object with different words. The
 *  raw association is what it always was (audit continuity); the LABELS now say what it is. */
function placementCols<R extends PlacementStats>(group: string, baseline: string, rawLabel = 'Raw association'): Record<string, ColDef<R>> {
  return {
    placedN: { key: 'placedN', label: 'Placed n', tip: `${cap(group)} that carry a placement: the runs behind the placement columns. A run with no placement supports no placement finding.`, value: (r) => r.placedN, cell: (r) => ({ text: String(r.placedN), cls: 'balnum baldim' }) },
    controls: { key: 'controls', label: 'Placed controls', tip: `Placed runs on the other side of the raw comparison: ${baseline}.`, value: (r) => r.baselineN, cell: (r) => ({ text: String(r.baselineN), cls: 'balnum baldim' }) },
    avgPlace: { key: 'avgPlace', label: 'Avg Place', tip: `Average final placement of ${group}. 1 is best, 8 is worst.`, value: (r) => r.avgPlace, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgPlace), cls: `balnum${r.avgPlace === null ? '' : ` balwin${placeHeat(r.avgPlace)}`}` }) },
    firstPct: { key: 'firstPct', label: '1st %', tip: `Percent of ${group} that won the lobby.`, value: (r) => r.firstRate, cell: (r) => ({ text: pctOrDash(r.firstRate), cls: 'balnum' }) },
    top4: { key: 'top4', label: 'Top 4 %', tip: `Percent of ${group} that finished in the top four. Detailed shows its 95% range.`, value: (r) => r.top4Rate, cell: (r) => ({ text: pctOrDash(r.top4Rate), cls: 'balnum' }) },
    top4Ci: { key: 'top4Ci', label: 'Top 4 95%', tip: 'The 95% range the true top-four rate is likely to sit in (Wilson). Sorts by the bottom of the range.', value: (r) => (r.top4Ci ? r.top4Ci.lo : null), cell: (r) => ({ text: r.top4Ci ? `${r.top4Ci.lo}% to ${r.top4Ci.hi}%` : '–', cls: 'balnum baldim' }) },
    lastPct: { key: 'lastPct', label: '8th %', tip: `Percent of ${group} that finished 8th.`, value: (r) => r.lastRate, cell: (r) => ({ text: pctOrDash(r.lastRate), cls: 'balnum' }) },
    baseline: { key: 'baseline', label: 'Control Avg', tip: `Average placement of ${baseline}: the other side of the raw association, with their count.`, value: (r) => r.baselineAvgPlace, firstDir: 1, cell: (r) => ({ text: r.baselineAvgPlace === null ? '–' : `${r.baselineAvgPlace} (${r.baselineN})`, cls: 'balnum baldim' }) },
    delta: { key: 'delta', label: rawLabel, tip: `Average placement of ${group} minus ${baseline}. Negative means ${group} finished better among the runs observed. It is an association, not a guaranteed benefit: it rewards surviving long enough to make the choice.`, value: (r) => r.delta, firstDir: 1, cell: (r) => ({ text: signed(r.delta), cls: `balnum${r.delta === null ? '' : ` balwin${deltaHeat(r.delta)}`}` }) },
    deltaRanked: { key: 'deltaRanked', label: rawLabel, tip: `Average placement of ${group} minus ${baseline}. Negative means ${group} finished better among the runs that had the choice. Sorts rows with candidate or supported evidence first; insufficient rows sit below, alphabetical, never ranked as worst.`, value: (r) => ((r as unknown as { evidence?: EvidenceLabel }).evidence === 'insufficient' ? null : r.delta), firstDir: 1, cell: (r) => ({ text: signed(r.delta), cls: `balnum${r.delta === null ? '' : ` balwin${deltaHeat(r.delta)}`}` }) },
    deltaCi: { key: 'deltaCi', label: 'Raw 95%', tip: `Welch 95% range of the raw association (unequal variances). Shown only with ${WELCH_MIN_N} or more runs on each side; a range that crosses zero is not a finding. Sorts by the top of the range.`, value: (r) => (r.deltaWelch ? r.deltaWelch.hi : null), firstDir: 1, cell: (r) => ({ text: ciText(r.deltaWelch), cls: 'balnum baldim' }) },
    impact: { key: 'impact', label: 'Sample-weighted association', tip: `The raw association shrunk toward zero for a small sample: raw times n / (n + ${SAMPLE_GATES.preliminary}) over placed ${group}. A heuristic weighting, not a correction for who got to make the choice.`, value: (r) => r.impact, firstDir: 1, cell: (r) => ({ text: signed(r.impact), cls: `balnum${r.impact === null ? '' : ` balwin${deltaHeat(r.impact)}`}` }) },
  };
}

const pick = <R,>(cols: Record<string, ColDef<R>>, keys: string[]): ColDef<R>[] => keys.map((k) => cols[k]!);
const dimBelow = (r: { gate: SampleGate }): boolean => r.gate === 'below';
const better = (d: number | null): string => ((d ?? 0) <= 0 ? 'better' : 'worse');
const abs2 = (d: number | null): string => Math.abs(d ?? 0).toFixed(2);
const ciWords = (ci: Interval | null): string => (ci ? ` (95% ${signed(ci.lo, 1)} to ${signed(ci.hi, 1)})` : '');
const evidenceCol = <R extends { evidence: EvidenceLabel }>(): ColDef<R> => ({
  key: 'evidence', label: 'Evidence', tip: evidenceTip, value: (r) => EVIDENCE_RANK[r.evidence], firstDir: 1,
  cell: (r) => ({ text: EVIDENCE_TEXT[r.evidence], cls: `balnum balev balev-${r.evidence}` }),
});
const adjustedText = (a: AdjustedStats): string => (a.association === null ? 'insufficient' : signed(a.association));
const adjustedCls = (a: AdjustedStats): string => (a.association === null ? 'balnum baldim' : `balnum balwin${deltaHeat(a.association)}`);
/** The card Performance cell: the adjusted association, or, when a row clears the candidate gate on the exposed
 *  diagnostic alone, THAT number marked "exposed", because it is what ranks the row under this header. A cell
 *  never prints "insufficient" while a hidden number sorts it. */
const cardAdjustedCell = (r: CardImpactRow): { text: string; cls: string } => {
  if (r.adjusted.association === null && r.evidence !== 'insufficient' && r.evidenceBasis === 'exposed' && r.exposed.delta !== null) {
    return { text: `exposed ${signed(r.exposed.delta)}`, cls: `balnum baldim balwin${deltaHeat(r.exposed.delta)}` };
  }
  return { text: adjustedText(r.adjusted), cls: adjustedCls(r.adjusted) };
};

/** A named column set: one of the four views of a card section, or Compact / Detailed elsewhere. The table
 *  opens on `defaultKey` in that column's own first direction (biggest first for a count, most negative first
 *  for an association), so a count view never opens on its emptiest rows. */
interface ColSet<R> { key: string; label: string; tip: string; cols: ColDef<R>[]; defaultKey: string; dense?: boolean }
/** The direction a column set opens in: its default column's `firstDir`, the name column A to Z. */
const defaultDirOf = <R,>(set: ColSet<R>): 1 | -1 => (set.defaultKey === 'name' ? 1 : (set.cols.find((c) => c.key === set.defaultKey)?.firstDir ?? -1));

// ── Minions / Spells: the card columns ─────────────────────────────────────────────────────────────────────

const CARD_COLS: Record<string, ColDef<CardImpactRow>> = {
  ...placementCols<CardImpactRow>('buyer runs', 'every other placed run', 'Raw buyer association'),
  tier: { key: 'tier', label: 'Tier', tip: 'The card\'s CURRENT shop tier. Evidence shows the tiers the shop actually offered it at in these runs.', value: (r) => r.tier, firstDir: 1, cell: (r) => ({ text: r.observedTiers.some((t) => t !== r.tier) ? `T${r.tier} (was T${r.observedTiers.filter((t) => t !== r.tier).join('/T')})` : `T${r.tier}`, cls: 'balnum baldim' }) },
  tribe: { key: 'tribe', label: 'Tribe', tip: 'The card\'s tribe. Two names for a dual-tribe card.', value: (r) => r.tribe, firstDir: 1, cell: (r) => ({ text: r.tribe2 ? `${cap(r.tribe)}/${cap(r.tribe2)}` : cap(r.tribe), cls: 'balnum baldim' }) },
  n: { key: 'n', label: 'Raw buyers', tip: `Runs that acquired the card by the upload-time arrays, once per run. Those arrays can carry earlier runs of the same session; Buyers this run is the honest count. ${THIN_TIP}`, value: (r) => r.runsBought, cell: (r) => ({ text: String(r.runsBought), cls: 'balnum' }) },
  segBuyers: { key: 'segBuyers', label: 'Buyers this run', tip: 'Runs whose OWN derived streams (last segment) show the card acquired by shop or Discover. Where it is lower than Raw buyers, the difference bought the card in an earlier run of the same session.', value: (r) => r.segmentedBuyers, cell: (r) => ({ text: String(r.segmentedBuyers), cls: 'balnum' }) },
  runsSeen: { key: 'runsSeen', label: 'Runs Seen', tip: 'Runs where the card showed up at all, in the shop or a Discover (upload-time arrays).', value: (r) => r.runsSeen, cell: (r) => ({ text: String(r.runsSeen), cls: 'balnum' }) },
  shopSeen: { key: 'shopSeen', label: 'Shop Seen', tip: 'Shop sightings. A card seen four times in one run counts four.', value: (r) => r.shopSeen, cell: (r) => ({ text: String(r.shopSeen), cls: 'balnum' }) },
  shopBought: { key: 'shopBought', label: 'Shop Buy', tip: 'Shop purchases, one per buy.', value: (r) => r.shopBought, cell: (r) => ({ text: String(r.shopBought), cls: 'balnum' }) },
  buypct: { key: 'buypct', label: 'Buy %', tip: 'Shop purchases as a percent of shop sightings. Do players want it when they see it.', value: (r) => r.shopBuyRate, cell: (r) => ({ text: pctOrDash(r.shopBuyRate), cls: 'balnum' }) },
  discSeen: { key: 'discSeen', label: 'Disc Seen', tip: 'Times offered as a Discover option.', value: (r) => r.discSeen, cell: (r) => ({ text: String(r.discSeen), cls: 'balnum' }) },
  discBought: { key: 'discBought', label: 'Disc Pick', tip: 'Times picked from a Discover.', value: (r) => r.discBought, cell: (r) => ({ text: String(r.discBought), cls: 'balnum' }) },
  discpct: { key: 'discpct', label: 'Disc %', tip: 'Discover picks as a percent of Discover offers.', value: (r) => r.discRate, cell: (r) => ({ text: pctOrDash(r.discRate), cls: 'balnum' }) },
  episodes: { key: 'episodes', label: 'Affordable offers', tip: 'Runs with a primary shop decision for the card: the first wave it was on offer and affordable, before any prior copy. One per run, however many copies or rerolls.', value: (r) => r.episodes, cell: (r) => ({ text: String(r.episodes), cls: 'balnum' }) },
  episodePct: { key: 'episodePct', label: 'Decision buy %', tip: 'Of those affordable first offers, the percent bought in that wave.', value: (r) => (r.episodes > 0 ? Math.round((100 * r.episodeBuyers) / r.episodes) : null), cell: (r) => ({ text: r.episodes > 0 ? `${Math.round((100 * r.episodeBuyers) / r.episodes)}%` : '–', cls: 'balnum' }) },
  vsTier: { key: 'vsTier', label: 'Relative raw association within tier', tip: 'The raw buyer association minus the buyer-weighted average of the card\'s tier (minions against minions, spells against spells). A secondary read of who stands out within a tier. Not a survival correction: the whole tier still carries the survival bias.', value: (r) => r.tierDelta, firstDir: 1, cell: (r) => ({ text: signed(r.tierDelta), cls: `balnum${r.tierDelta === null ? '' : ` balwin${deltaHeat(r.tierDelta)}`}` }) },
  buyWave: { key: 'buyWave', label: 'Buy Wave', tip: 'Average wave the card was acquired on.', value: (r) => r.avgBuyWave, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgBuyWave), cls: 'balnum baldim' }) },
  missing: { key: 'missing', label: 'Missing placement', tip: 'Buyer runs with no placement. They count toward demand only and never toward a placement finding.', value: (r) => r.missingPlacement, cell: (r) => ({ text: String(r.missingPlacement), cls: 'balnum baldim' }) },
  buyerPlayers: { key: 'buyerPlayers', label: 'Buyer players', tip: 'Distinct players among the placed buyer runs, by the player key the banner names.', value: (r) => r.buyerPlayers, cell: (r) => ({ text: r.buyerPlayers === null ? 'n/a' : String(r.buyerPlayers), cls: 'balnum baldim' }) },
  controlPlayers: { key: 'controlPlayers', label: 'Control players', tip: 'Distinct players among the placed control runs (every other placed run).', value: (r) => r.controlPlayers, cell: (r) => ({ text: r.controlPlayers === null ? 'n/a' : String(r.controlPlayers), cls: 'balnum baldim' }) },
  expBuyers: { key: 'expBuyers', label: 'Exposed buyers', tip: 'Placed runs whose own shop offers included the card and that acquired it (shop or Discover) in that run.', value: (r) => r.exposed.buyers, cell: (r) => ({ text: String(r.exposed.buyers), cls: 'balnum' }) },
  expSkippers: { key: 'expSkippers', label: 'Exposed skippers', tip: 'Placed runs whose own shop offers included the card and that never acquired it.', value: (r) => r.exposed.skippers, cell: (r) => ({ text: String(r.exposed.skippers), cls: 'balnum' }) },
  exposed: { key: 'exposed', label: 'Exposed diagnostic', tip: 'Average placement of exposed buyers minus exposed skippers: both sides saw the card. Negative means buyers finished better than the runs that saw it and passed. A diagnostic only: a sighting at any time is not a comparable decision.', value: (r) => r.exposed.delta, firstDir: 1, cell: (r) => ({ text: r.exposed.delta === null ? '–' : signed(r.exposed.delta), cls: `balnum${r.exposed.delta === null ? '' : ` balwin${deltaHeat(r.exposed.delta)}`}` }) },
  exposedCi: { key: 'exposedCi', label: 'Exposed 95%', tip: `Welch 95% range of the exposed diagnostic. Shown only with ${WELCH_MIN_N} or more runs on each side.`, value: (r) => (r.exposed.ci ? r.exposed.ci.hi : null), firstDir: 1, cell: (r) => ({ text: ciText(r.exposed.ci), cls: 'balnum baldim' }) },
  notExposed: { key: 'notExposed', label: 'Buyers unseen', tip: 'Placed buyer runs with no recorded shop sighting of the card (a Discover pick, or a sighting the streams missed). A coverage mismatch, reported rather than repaired.', value: (r) => r.exposed.notExposedBuyers, cell: (r) => ({ text: String(r.exposed.notExposedBuyers), cls: 'balnum baldim' }) },
  adjN: { key: 'adjN', label: 'Comparable buy / pass', tip: 'Placed runs in the supported strata (round band by shop tier, each holding both a buyer and a passer): the runs the adjusted association actually compares. Sorts by the smaller side.', value: (r) => Math.min(r.adjusted.buyersInSupport, r.adjusted.skippersInSupport), cell: (r) => ({ text: `${r.adjusted.buyersInSupport} / ${r.adjusted.skippersInSupport}`, cls: 'balnum' }) },
  adjusted: { key: 'adjusted', label: 'Adjusted association', tip: 'Buy against pass inside the first affordable shop offer, among runs in the same round band and shop tier, weighted by where buyers were. Negative means buying went with a better finish in those situations. "insufficient" means no stratum holds both a buyer and a passer: a valid answer, not zero. The default order: rows with candidate or supported evidence first by this number, then rows whose evidence rests on the exposed diagnostic alone (their cell prints that number, marked exposed); insufficient rows below, never ranked as worst.', value: performanceSortValue, firstDir: 1, cell: cardAdjustedCell },
  adjustedCi: { key: 'adjustedCi', label: 'Adjusted 95%', tip: `A stratified Welch-type 95% range of the adjusted association. Shown only with ${WELCH_MIN_N} or more comparable runs on each side and two or more on each side of every supported stratum.`, value: (r) => (r.adjusted.ci ? r.adjusted.ci.hi : null), firstDir: 1, cell: (r) => ({ text: ciText(r.adjusted.ci), cls: 'balnum baldim' }) },
  outside: { key: 'outside', label: 'Buyers outside support %', tip: 'Percent of placed buyer decisions in a stratum with no passer to compare with. High means the adjusted number speaks for few of the buyers.', value: (r) => r.adjusted.outsideSupportPct, cell: (r) => ({ text: pctOrDash(r.adjusted.outsideSupportPct), cls: 'balnum baldim' }) },
  strata: { key: 'strata', label: 'Strata (used / seen)', tip: 'Round band by shop tier strata holding both sides, over strata seen at all.', value: (r) => r.adjusted.supportedStrata, cell: (r) => ({ text: `${r.adjusted.supportedStrata} / ${r.adjusted.strata}`, cls: 'balnum baldim' }) },
  crossover: { key: 'crossover', label: 'Crossover', tip: 'Passes followed by a later acquisition of the card. Reported; the pass is never relabelled as a buy.', value: (r) => r.adjusted.crossover, cell: (r) => ({ text: String(r.adjusted.crossover), cls: 'balnum baldim' }) },
  unaffordable: { key: 'unaffordable', label: 'Unaffordable offers', tip: 'Offer waves skipped because no copy was affordable at sighting (base cost against Gold at first sighting: approximate, a discount can make a copy affordable that reads unaffordable here). An unaffordable offer is not a rejection.', value: (r) => r.episodeExclusions.unaffordable, cell: (r) => ({ text: String(r.episodeExclusions.unaffordable), cls: 'balnum baldim' }) },
  prior: { key: 'prior', label: 'Prior owned', tip: 'Runs offered the card after already owning a copy (any source), so they had no first decision. Plus runs where a grant landed in the offer wave (ambiguous, excluded).', value: (r) => r.episodeExclusions.priorAcquisition + r.episodeExclusions.sameWaveGrant, cell: (r) => ({ text: String(r.episodeExclusions.priorAcquisition + r.episodeExclusions.sameWaveGrant), cls: 'balnum baldim' }) },
  tiersSeen: { key: 'tiersSeen', label: 'Tiers seen', tip: 'The card tiers the shop actually offered the card at in these runs. A moved tier shows here; the Tier column is the current one.', value: (r) => (r.observedTiers.length ? r.observedTiers.join('/') : null), firstDir: 1, cell: (r) => ({ text: r.observedTiers.length ? r.observedTiers.map((t) => `T${t}`).join(' ') : '–', cls: 'balnum baldim' }) },
  early: { key: 'early', label: 'Early buyers', tip: 'Buyer runs (this run) whose first copy came in waves 1 to 4.', value: (r) => r.role.earlyBuyers, cell: (r) => ({ text: String(r.role.earlyBuyers), cls: 'balnum' }) },
  mid: { key: 'mid', label: 'Mid buyers', tip: 'Buyer runs whose first copy came in waves 5 to 8.', value: (r) => r.role.midBuyers, cell: (r) => ({ text: String(r.role.midBuyers), cls: 'balnum' }) },
  late: { key: 'late', label: 'Late buyers', tip: 'Buyer runs whose first copy came in wave 9 or later.', value: (r) => r.role.lateBuyers, cell: (r) => ({ text: String(r.role.lateBuyers), cls: 'balnum' }) },
  acqs: { key: 'acqs', label: 'Copies', tip: 'Copies acquired by shop or Discover across these runs (this run only).', value: (r) => r.role.acquisitions, cell: (r) => ({ text: String(r.role.acquisitions), cls: 'balnum baldim' }) },
  played: { key: 'played', label: 'Played %', tip: 'Percent of copies played to the board.', value: (r) => r.role.playedPct, cell: (r) => ({ text: pctOrDash(r.role.playedPct), cls: 'balnum' }) },
  finalBoard: { key: 'finalBoard', label: 'Final board %', tip: 'Percent of copies that survived to the run\'s final board. Descriptive: an economy minion that did its job and was sold is not a failure.', value: (r) => r.role.finalBoardPct, cell: (r) => ({ text: pctOrDash(r.role.finalBoardPct), cls: 'balnum' }) },
  sold: { key: 'sold', label: 'Sold %', tip: 'Percent of copies sold at some point.', value: (r) => r.role.soldPct, cell: (r) => ({ text: pctOrDash(r.role.soldPct), cls: 'balnum' }) },
  nextWin: { key: 'nextWin', label: 'Next combat won %', tip: 'Percent of copies whose same-wave combat (the next fight after acquiring it) was won. Descriptive, not causal.', value: (r) => r.role.nextCombatWinPct, cell: (r) => ({ text: pctOrDash(r.role.nextCombatWinPct), cls: 'balnum' }) },
  evidence: evidenceCol<CardImpactRow>(),
};
const CARD_VIEWS: ColSet<CardImpactRow>[] = [
  { key: 'demand', label: 'Demand', tip: 'Do players want it when it is offered: sightings, buys, conversion, the first affordable decision', cols: pick(CARD_COLS, ['tier', 'tribe', 'n', 'segBuyers', 'runsSeen', 'shopSeen', 'shopBought', 'buypct', 'discSeen', 'discpct', 'episodes', 'episodePct', 'buyWave']), defaultKey: 'segBuyers', dense: true },
  { key: 'performance', label: 'Performance', tip: 'Three comparisons side by side: raw buyer association, exposed diagnostic, adjusted association, each with its own 95% range, evidence first', cols: pick(CARD_COLS, ['tier', 'n', 'placedN', 'controls', 'delta', 'deltaCi', 'impact', 'vsTier', 'expBuyers', 'expSkippers', 'exposed', 'exposedCi', 'adjN', 'adjusted', 'adjustedCi', 'evidence']), defaultKey: 'adjusted', dense: true },
  { key: 'role', label: 'Role and timing', tip: 'When it is bought and what happens to it: descriptive, never causal', cols: pick(CARD_COLS, ['tier', 'tribe', 'buyWave', 'early', 'mid', 'late', 'acqs', 'played', 'finalBoard', 'sold', 'nextWin']), defaultKey: 'acqs', dense: true },
  { key: 'evidence', label: 'Evidence', tip: 'How much to trust each row: samples, players, missingness, overlap, coverage mismatches', cols: pick(CARD_COLS, ['n', 'segBuyers', 'placedN', 'missing', 'controls', 'buyerPlayers', 'controlPlayers', 'notExposed', 'strata', 'outside', 'crossover', 'unaffordable', 'prior', 'tiersSeen', 'evidence']), defaultKey: 'evidence', dense: true },
];
const cardTip = (r: CardImpactRow): string => {
  const raw = r.delta === null ? 'no raw placement read yet' : `raw: buyers finished ${abs2(r.delta)} places ${better(r.delta)} than every other run${ciWords(r.deltaWelch)}`;
  const exp = r.exposed.delta === null ? 'no exposed comparison' : `exposed: ${abs2(r.exposed.delta)} places ${better(r.exposed.delta)} than the ${r.exposed.skippers} runs that saw it and passed${ciWords(r.exposed.ci)}`;
  const adj = r.adjusted.association === null ? 'adjusted: insufficient comparable data' : `adjusted: ${abs2(r.adjusted.association)} places ${better(r.adjusted.association)} than passers in the same round band and shop tier (${r.adjusted.buyersInSupport} buy vs ${r.adjusted.skippersInSupport} pass)${ciWords(r.adjusted.ci)}`;
  return `${r.name}: ${r.runsBought} raw buyer runs (${r.segmentedBuyers} this run), ${r.placedN} placed. ${EVIDENCE_LONG[r.evidence]}. ${cap(raw)}. ${cap(exp)}. ${cap(adj)}.`;
};

// ── Heroes ─────────────────────────────────────────────────────────────────────────────────────────────────

const HERO_COLS: Record<string, ColDef<HeroImpactRow>> = {
  ...placementCols<HeroImpactRow>('runs with the hero', 'every other run'),
  n: { key: 'n', label: 'Runs', tip: `Runs that picked the hero. ${THIN_TIP}`, value: (r) => r.runs, cell: (r) => ({ text: String(r.runs), cls: 'balnum' }) },
  offered: { key: 'offered', label: 'Offered', tip: 'Runs whose recorded hero picker offered it.', value: (r) => r.offered, cell: (r) => ({ text: String(r.offered), cls: 'balnum' }) },
  offer: { key: 'offer', label: 'Offer %', tip: 'Percent of all runs where the picker offered it.', value: (r) => r.offerRate, cell: (r) => ({ text: pctOrDash(r.offerRate), cls: 'balnum' }) },
  pick: { key: 'pick', label: 'Pick %', tip: 'Percent of offers that were taken. Do players want it when they see it.', value: (r) => r.pickRate, cell: (r) => ({ text: pctOrDash(r.pickRate), cls: 'balnum' }) },
  avgWins: { key: 'avgWins', label: 'Round Wins', tip: 'Average combat rounds won per run with it.', value: (r) => r.avgWins, cell: (r) => ({ text: fmtNum(r.avgWins), cls: 'balnum' }) },
  offSkip: { key: 'offSkip', label: 'Offered, chose other', tip: 'Placed runs whose recorded trio offered the hero and that picked another one: the comparison group of the offered association. Runs with no recorded trio cannot be here.', value: (r) => r.offeredSkippers, cell: (r) => ({ text: String(r.offeredSkippers), cls: 'balnum' }) },
  offDelta: { key: 'offDelta', label: 'Offered association', tip: 'Average placement of runs with the hero minus runs that were offered it and chose another. Negative means choosing it went with a better finish among runs that had the choice. Picking a hero is selected behaviour, not a random treatment. Sorts rows with candidate or supported evidence first; insufficient rows sit below, alphabetical, never ranked as worst.', value: (r) => (r.evidence === 'insufficient' ? null : r.offeredDelta), firstDir: 1, cell: (r) => ({ text: signed(r.offeredDelta), cls: `balnum${r.offeredDelta === null ? '' : ` balwin${deltaHeat(r.offeredDelta)}`}` }) },
  offCi: { key: 'offCi', label: 'Offered 95%', tip: `Welch 95% range of the offered association. Shown only with ${WELCH_MIN_N} or more runs on each side.`, value: (r) => (r.offeredCi ? r.offeredCi.hi : null), firstDir: 1, cell: (r) => ({ text: ciText(r.offeredCi), cls: 'balnum baldim' }) },
  players: { key: 'players', label: 'Players', tip: 'Distinct players among the placed runs with the hero, and among the offered runs that chose another.', value: (r) => r.players, cell: (r) => ({ text: `${r.players === null ? 'n/a' : r.players} / ${r.skipperPlayers === null ? 'n/a' : r.skipperPlayers}`, cls: 'balnum baldim' }) },
  evidence: evidenceCol<HeroImpactRow>(),
};
const HERO_VIEWS: ColSet<HeroImpactRow>[] = [
  { key: 'compact', label: 'Compact', tip: 'The columns that answer the question', cols: pick(HERO_COLS, ['n', 'offer', 'pick', 'avgWins', 'avgPlace', 'top4', 'offSkip', 'offDelta', 'offCi', 'delta', 'evidence']), defaultKey: 'offDelta' },
  { key: 'detailed', label: 'Detailed', tip: 'Every column, including the raw counts and the 95% ranges', cols: pick(HERO_COLS, ['offered', 'n', 'offer', 'pick', 'avgWins', 'placedN', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'offSkip', 'offDelta', 'offCi', 'baseline', 'delta', 'deltaCi', 'impact', 'players', 'evidence']), defaultKey: 'offDelta', dense: true },
];
const heroTip = (r: HeroImpactRow): string =>
  `${r.name}: ${r.runs} runs, average place ${fmtNum(r.avgPlace)}. ${EVIDENCE_LONG[r.evidence]}. Offered comparison: ${r.offeredDelta === null ? 'no offered runs that chose another yet' : `${abs2(r.offeredDelta)} places ${better(r.offeredDelta)} than the ${r.offeredSkippers} runs offered it that chose another${ciWords(r.offeredCi)}`}. Raw: ${abs2(r.delta)} places ${better(r.delta)} than every other run.`;

// ── Runes ──────────────────────────────────────────────────────────────────────────────────────────────────

const RUNE_COLS: Record<string, ColDef<RuneImpactRow>> = {
  ...placementCols<RuneImpactRow>('taker runs', 'the runs offered it that skipped it', 'Offered association'),
  forge: { key: 'forge', label: 'Forge', tip: 'Which Runeforge offers it: Basic on turn 6, Epic on turn 9.', value: (r) => (r.forge === 'basic' ? 0 : 1), firstDir: 1, cell: (r) => ({ text: cap(r.forge), cls: 'balnum baldim' }) },
  cost: { key: 'cost', label: 'Cost', tip: 'The rune\'s Gold cost.', value: (r) => r.cost, firstDir: 1, cell: (r) => ({ text: fmtNum(r.cost), cls: 'balnum baldim' }) },
  tribe: { key: 'tribe', label: 'Tribe', tip: 'The rune\'s tribe gate, when it has one. Most runes have none.', value: (r) => (r.tribes.length ? r.tribes.join('/') : null), firstDir: 1, cell: (r) => ({ text: r.tribes.length ? r.tribes.map(cap).join('/') : '–', cls: 'balnum baldim' }) },
  offered: { key: 'offered', label: 'Offered', tip: 'Runs the Runeforge offered it to, counted once per run. Replay-derived: the offers come from re-running the action log, which is not guaranteed faithful for a lobby run.', value: (r) => r.offered, cell: (r) => ({ text: String(r.offered), cls: 'balnum' }) },
  n: { key: 'n', label: 'Takers', tip: `Runs that took the rune, counted once per run. ${THIN_TIP}`, value: (r) => r.picked, cell: (r) => ({ text: String(r.picked), cls: 'balnum' }) },
  pick: { key: 'pick', label: 'Pick %', tip: 'Percent of runs offered it that took it.', value: (r) => r.pickRate, cell: (r) => ({ text: pctOrDash(r.pickRate), cls: 'balnum' }) },
  vsField: { key: 'vsField', label: 'Raw association vs field', tip: 'The uncontrolled read: average placement of taker runs minus every other run in the report, including runs eliminated before any forge. Reads green for most runes, because only a run that survived to turn 6 or 9 is offered one.', value: (r) => r.fieldDelta, firstDir: 1, cell: (r) => ({ text: signed(r.fieldDelta), cls: `balnum${r.fieldDelta === null ? '' : ` balwin${deltaHeat(r.fieldDelta)}`}` }) },
  players: { key: 'players', label: 'Players', tip: 'Distinct players among the placed takers, and among the offered runs that skipped.', value: (r) => r.players, cell: (r) => ({ text: `${r.players === null ? 'n/a' : r.players} / ${r.skipperPlayers === null ? 'n/a' : r.skipperPlayers}`, cls: 'balnum baldim' }) },
  evidence: evidenceCol<RuneImpactRow>(),
};
const RUNE_VIEWS: ColSet<RuneImpactRow>[] = [
  { key: 'compact', label: 'Compact', tip: 'The columns that answer the question', cols: pick(RUNE_COLS, ['forge', 'cost', 'offered', 'n', 'pick', 'avgPlace', 'top4', 'deltaRanked', 'deltaCi', 'vsField', 'evidence']), defaultKey: 'deltaRanked' },
  { key: 'detailed', label: 'Detailed', tip: 'Every column, including the raw counts and the 95% ranges', cols: pick(RUNE_COLS, ['forge', 'cost', 'tribe', 'offered', 'n', 'pick', 'placedN', 'controls', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'baseline', 'deltaRanked', 'deltaCi', 'impact', 'vsField', 'players', 'evidence']), defaultKey: 'deltaRanked', dense: true },
];
const runeTip = (r: RuneImpactRow): string =>
  `${r.name}: taken in ${r.picked} of the ${r.offered} runs offered it. ${EVIDENCE_LONG[r.evidence]}. Takers average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)} for the ${r.baselineN} placed runs that skipped it, so takers finished ${abs2(r.delta)} places ${better(r.delta)}${ciWords(r.deltaWelch)}.`;

// ── Shop tiers ─────────────────────────────────────────────────────────────────────────────────────────────

const TIER_COLS: Record<string, ColDef<TierImpactRow>> = {
  ...placementCols<TierImpactRow>('early runs', 'runs that reached the tier later or never'),
  reached: { key: 'reached', label: 'Reached', tip: 'Runs whose replay-derived shop tier ever reached this tier.', value: (r) => r.runsReached, cell: (r) => ({ text: String(r.runsReached), cls: 'balnum' }) },
  reachPct: { key: 'reachPct', label: 'Reach %', tip: 'Percent of all runs that reached this tier.', value: (r) => r.reachRate, cell: (r) => ({ text: pctOrDash(r.reachRate), cls: 'balnum' }) },
  avgWave: { key: 'avgWave', label: 'Avg Wave', tip: 'The average wave a run first reached this tier, over the runs that did.', value: (r) => r.avgWaveReached, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgWaveReached), cls: 'balnum' }) },
  reachedPlaced: { key: 'reachedPlaced', label: 'Reached Placed', tip: 'Runs that reached the tier and carry a placement.', value: (r) => r.reachedPlacedN, cell: (r) => ({ text: String(r.reachedPlacedN), cls: 'balnum baldim' }) },
  reachedAvg: { key: 'reachedAvg', label: 'Reached Avg', tip: 'Average final placement of every run that reached this tier, early or late.', value: (r) => r.reachedAvgPlace, firstDir: 1, cell: (r) => ({ text: fmtNum(r.reachedAvgPlace), cls: `balnum${r.reachedAvgPlace === null ? '' : ` balwin${placeHeat(r.reachedAvgPlace)}`}` }) },
  vsNever: { key: 'vsNever', label: 'Reached vs never', tip: 'Average placement of runs that reached the tier minus runs that never did. A survival statistic: the runs that never got there are the early eliminations.', value: (r) => r.reachedDelta, firstDir: 1, cell: (r) => ({ text: signed(r.reachedDelta), cls: `balnum${r.reachedDelta === null ? '' : ` balwin${deltaHeat(r.reachedDelta)}`}` }) },
  cut: { key: 'cut', label: 'By Wave', tip: 'The cut that defines early: the average wave rounded. Early runs reached the tier on or before this wave.', value: (r) => r.cutWave, firstDir: 1, cell: (r) => ({ text: r.cutWave === null ? '–' : `wave ${r.cutWave}`, cls: 'balnum baldim' }) },
  early: { key: 'early', label: 'Early Runs', tip: `Runs that reached the tier by the cut wave: the sample behind the placement columns. ${THIN_TIP}`, value: (r) => r.earlyRuns, cell: (r) => ({ text: String(r.earlyRuns), cls: 'balnum' }) },
};
const TIER_VIEWS: ColSet<TierImpactRow>[] = [
  { key: 'compact', label: 'Compact', tip: 'The columns that answer the question', cols: pick(TIER_COLS, ['reached', 'reachPct', 'avgWave', 'reachedAvg', 'vsNever', 'cut', 'early', 'avgPlace', 'delta', 'deltaCi']), defaultKey: 'name' },
  { key: 'detailed', label: 'Detailed', tip: 'Every column, including the raw counts and the 95% ranges', cols: pick(TIER_COLS, ['reached', 'reachPct', 'avgWave', 'reachedPlaced', 'reachedAvg', 'vsNever', 'cut', 'early', 'placedN', 'controls', 'avgPlace', 'firstPct', 'top4', 'top4Ci', 'lastPct', 'baseline', 'delta', 'deltaCi', 'impact']), defaultKey: 'name', dense: true },
];
const tierTip = (r: TierImpactRow): string => {
  if (r.cutWave === null) return `${r.name}: no run reached this tier.`;
  if (r.delta === null) return `${r.name}: ${r.earlyRuns} runs reached it by wave ${r.cutWave}. No placement to compare yet.`;
  return `Runs that reached ${r.name} by wave ${r.cutWave} (${r.earlyRuns} runs) finished ${abs2(r.delta)} places ${better(r.delta)} than runs that reached it later or never: average place ${fmtNum(r.avgPlace)} vs ${fmtNum(r.baselineAvgPlace)}${ciWords(r.deltaWelch)}. Replay-derived; read the decision table for the live view.`;
};

const TIERDEC_COLS: ColDef<TierDecisionRow>[] = [
  { key: 'decisions', label: 'Decisions', tip: 'Runs with a primary decision: the first wave a tier-up to this tier was affordable (taken, or still affordable when the wave ended and not taken). Runs that never could afford it are in neither group.', value: (r) => r.decisions, cell: (r) => ({ text: String(r.decisions), cls: 'balnum' }) },
  { key: 'took', label: 'Took', tip: 'Runs that took the tier-up in that wave.', value: (r) => r.took, cell: (r) => ({ text: String(r.took), cls: 'balnum' }) },
  { key: 'declined', label: 'Declined', tip: 'Runs that ended that wave with the tier-up still affordable and did not take it. A run that spent its Gold on cards first is not a decliner. The bracket counts idle declines: waves the run bought no card either, a run holding its Gold or one the player stopped acting in. Early-wave declines are mostly the second kind, so a strong-looking early interval is not a finding. Disclosed, never excluded: dropping them would guess at intent.', value: (r) => r.declined, cell: (r) => ({ text: r.declinedIdle > 0 ? `${r.declined} (${r.declinedIdle} idle)` : String(r.declined), cls: 'balnum' }) },
  { key: 'crossover', label: 'Crossover', tip: 'Declines followed by a take in a later wave. Reported; the decline is never relabelled.', value: (r) => r.crossover, cell: (r) => ({ text: String(r.crossover), cls: 'balnum baldim' }) },
  { key: 'avgWave', label: 'Avg Wave', tip: 'Mean wave of the primary decision.', value: (r) => r.avgWave, firstDir: 1, cell: (r) => ({ text: fmtNum(r.avgWave), cls: 'balnum baldim' }) },
  { key: 'tookAvg', label: 'Took Avg', tip: 'Average placement of the placed runs that took it, with their count in Decisions.', value: (r) => r.tookAvg, firstDir: 1, cell: (r) => ({ text: r.tookAvg === null ? '–' : `${r.tookAvg} (${r.tookPlaced})`, cls: 'balnum' }) },
  { key: 'declinedAvg', label: 'Declined Avg', tip: 'Average placement of the placed runs that declined.', value: (r) => r.declinedAvg, firstDir: 1, cell: (r) => ({ text: r.declinedAvg === null ? '–' : `${r.declinedAvg} (${r.declinedPlaced})`, cls: 'balnum' }) },
  { key: 'rawDelta', label: 'Raw association', tip: 'Took average minus declined average, among runs that had the decision. Negative means taking went with a better finish.', value: (r) => r.rawDelta, firstDir: 1, cell: (r) => ({ text: signed(r.rawDelta), cls: `balnum${r.rawDelta === null ? '' : ` balwin${deltaHeat(r.rawDelta)}`}` }) },
  { key: 'rawCi', label: 'Raw 95%', tip: `Welch 95% range of the raw association. Shown only with ${WELCH_MIN_N} or more runs on each side.`, value: (r) => (r.rawCi ? r.rawCi.hi : null), firstDir: 1, cell: (r) => ({ text: ciText(r.rawCi), cls: 'balnum baldim' }) },
  { key: 'adjN', label: 'Comparable took / declined', tip: 'Placed runs in strata (round band by spare Gold after paying) that hold both a taker and a decliner.', value: (r) => Math.min(r.adjusted.buyersInSupport, r.adjusted.skippersInSupport), cell: (r) => ({ text: `${r.adjusted.buyersInSupport} / ${r.adjusted.skippersInSupport}`, cls: 'balnum' }) },
  { key: 'adjusted', label: 'Adjusted association', tip: 'Took against declined among runs alive at the same round band with similar spare Gold, taker weighted. "insufficient" means no stratum holds both.', value: (r) => r.adjusted.association, firstDir: 1, cell: (r) => ({ text: adjustedText(r.adjusted), cls: adjustedCls(r.adjusted) }) },
  { key: 'adjustedCi', label: 'Adjusted 95%', tip: 'A stratified Welch-type 95% range, shown only with enough runs on each side of every supported stratum.', value: (r) => (r.adjusted.ci ? r.adjusted.ci.hi : null), firstDir: 1, cell: (r) => ({ text: ciText(r.adjusted.ci), cls: 'balnum baldim' }) },
  evidenceCol<TierDecisionRow>(),
];
const tierDecTip = (r: TierDecisionRow): string =>
  `${r.name}: ${r.decisions} runs had the decision, ${r.took} took it and ${r.declined} declined${r.declinedIdle > 0 ? ` (${r.declinedIdle} of them idle: no card bought that wave either, a run holding its Gold or one that stopped acting)` : ''}. ${EVIDENCE_LONG[r.evidence]}. ${r.adjusted.association === null ? 'Insufficient comparable data for an adjusted read.' : `Among comparable runs, taking went with a finish ${abs2(r.adjusted.association)} places ${better(r.adjusted.association)}${ciWords(r.adjusted.ci)}.`}`;

// ── The generic impact section ─────────────────────────────────────────────────────────────────────────────

/** The plain-words read of a group chip, for its hover. */
function groupTip(g: ImpactGroupRow, what: string, noun: string, sample: string, baseline: string): string {
  const head = `${what} ${g.label}: ${g.cards} ${noun}, ${g.runsBought} ${sample} (incidences summed over the ${noun}, not unique runs: a run that bought five counts five).`;
  if (g.delta === null) return `${head} No placement data yet.`;
  return `${head} Raw association: ${Math.abs(g.delta).toFixed(2)} places ${g.delta <= 0 ? 'better' : 'worse'} than ${baseline} on average.`;
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
      <span className="balstrip-label" data-tip="Card-buyer incidences: each chip sums its rows, so a run that bought several counts several times">{what}</span>
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
 * The ranked diverging bar chart of the RAW association: bars grow LEFT (green) when a row's group finishes
 * better than its comparison and RIGHT (red) when worse, strongest at the top, and FADE with a thin sample so a
 * 3-run outlier never reads as a finding. Plain HTML bars (thin, rounded data-end, a hairline baseline),
 * every bar a hover target, the table beside it the WCAG twin. The chart says which metric it draws.
 */
function ImpactChart<R extends BarRow>({ rows, keyOf, nOf, tipOf, noun, group, baseline, metric }: {
  rows: R[]; keyOf: (r: R) => string; nOf: (r: R) => number; tipOf: (r: R) => string;
  noun: string; group: string; baseline: string; metric: string;
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
        Each bar is the row's <b>{metric}</b>: the average placement of {group} minus {baseline}.
        A bar to the <b>left</b> means they finished better among the runs observed, to the <b>right</b> worse. This is the raw read, not the
        adjusted one: it rewards surviving long enough to make the choice. Bars fade with a thin sample and are solid at {SAMPLE_GATES.actionable} {group}. Hover a bar for its numbers.
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
 * toggles, and the table or the chart over the same rows. The column sets are the section's VIEWS (the four
 * card views, or Compact / Detailed), one table at a time. The strip filters are the section's own state: the
 * panel keys the section by its kind, so switching kinds starts clean, and a filter that leaves nothing shows
 * a Clear filters control instead of an empty table.
 */
function ImpactSection<R extends BarRow>({ rows, views, strips, keyOf, nOf, tipOf, legend, noun, group, baseline, metric, nameLabel, nameValue, view, setView }: {
  rows: R[];
  views: ColSet<R>[];
  strips: StripDef<R>[];
  keyOf: (r: R) => string;
  nOf: (r: R) => number;
  tipOf: (r: R) => string;
  legend: ReactNode;
  /** The plural noun of the rows (cards, heroes, runes, tiers), the group's runs (buyer runs, taker runs,
   *  ...) and the baseline, in plain words, for every hover and the chart's axis; `metric` names the chart's bar. */
  noun: string; group: string; baseline: string; metric: string;
  nameLabel?: string;
  nameValue?: (r: R) => number;
  view: SectionView; setView: (v: SectionView) => void;
}) {
  const [filters, setFilters] = useState<(string | null)[]>(() => strips.map(() => null));
  const [viewKey, setViewKey] = useState<string>(views[0]!.key);
  const colset = views.find((v) => v.key === viewKey) ?? views[0]!;
  const visible = useMemo(() => rows.filter((r) => strips.every((s, i) => filters[i] == null || s.matches(r, filters[i]!))), [rows, strips, filters]);
  const filtering = filters.some((f) => f !== null);
  const clearFilters = (): void => { sfx.tick(); setFilters(strips.map(() => null)); };
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
            {views.map((v) => (
              <button key={v.key} className={colset.key === v.key ? 'on' : ''} onClick={() => { sfx.tick(); setViewKey(v.key); }} data-tip={`${v.tip} (${v.cols.length} columns)`}>{v.label}</button>
            ))}
          </div>
        )}
        <span className="balseg-count">{visible.length} of {rows.length} {noun}{filtering ? ' (filtered)' : ''}</span>
        {filtering && <button className="balrun balimp-more" onClick={clearFilters} data-tip="Show every group again">Clear filters</button>}
      </div>
      {visible.length === 0
        ? <div className="balempty">No {noun} match the groups picked above.</div>
        : view === 'chart'
          ? <ImpactChart rows={visible} keyOf={keyOf} nOf={nOf} tipOf={tipOf} noun={noun} group={group} baseline={baseline} metric={metric} />
          : (
            <DataTable
              key={colset.key}
              cols={colset.cols}
              rows={visible}
              keyOf={keyOf}
              nameOf={nameOfRow}
              nameLabel={nameLabel}
              nameValue={nameValue}
              dimOf={dimBelow}
              tipOf={tipOf}
              defaultKey={colset.defaultKey}
              defaultDir={defaultDirOf(colset)}
              dense={!!colset.dense}
            />
          )}
    </>
  );
}

const NO_STRIPS: StripDef<any>[] = [];
const idOf = (r: { id: string }): string => r.id;
/** Module-level so DataTable's sort memo sees a stable reference (an inline arrow re-sorted on every render). */
const nameOfRow = (r: { name: string }): string => r.name;
const tierKey = (r: { tier: number }): string => String(r.tier);
const tierN = (r: TierImpactRow): number => r.earlyRuns;
const tierOrder = (r: { tier: number }): number => r.tier;
const cardN = (r: CardImpactRow): number => r.runsBought;
const heroN = (r: HeroImpactRow): number => r.runs;
const runeN = (r: RuneImpactRow): number => r.picked;

// ── The evidence banner ────────────────────────────────────────────────────────────────────────────────────

interface FetchState { flatFetched: number; flatTruncated: boolean; derivedRequested: number; derivedFetched: number; playerKeyBasis: PlayerKeyBasis }

/**
 * What the tables below can and cannot support, above every table: eligible runs and players, the period, the
 * epoch and revisions, flat and derived coverage with the exact caps, the integrity counts, and the comparison
 * limitation in one plain sentence. Every figure carries its meaning on hover.
 */
function EvidenceBanner({ setName, runs, sliced, quality, coverage, scope, epochs, fetch, derivedCap, derivedLoading, prolific, oldest, newest }: {
  setName: string; runs: number; sliced: string | null; quality: DataQuality; coverage: CohortCoverage; scope: ReportScope; epochs: EpochInfo[];
  fetch: FetchState; derivedCap: number; derivedLoading: boolean; prolific: { key: string; runs: number } | null; oldest: string | null; newest: string | null;
}) {
  const epochLabel = scope.epoch === ALL_EPOCHS ? `all ${epochs.length} content revisions (historical)` : `content revision ${scope.epoch} (1 of ${epochs.length} in the set)`;
  const windowLabel = scope.from || scope.to ? `window ${scope.from ?? 'oldest'} to ${scope.to ?? 'newest'}` : 'no date window';
  const proxy = fetch.playerKeyBasis === 'displayName';
  const players = coverage.uniquePlayers === null ? 'n/a players' : `${coverage.uniquePlayers} ${proxy ? 'display names' : 'players'}`;
  const derivedDropped = fetch.derivedRequested - fetch.derivedFetched;
  return (
    <div className="balbanner" role="note" aria-label="Evidence summary">
      <div className="balbanner-row">
        <b>{setName}</b>
        <span data-tip={`Ladder runs of the active set inside the epoch and window, after dropping duplicate ids and clearing malformed placements${sliced ? `. The hero picker is on: every figure on this banner and every table except Heroes reads the ${sliced} runs only` : ''}`}>{runs} eligible runs{sliced ? ` (${sliced} only)` : ''}</span>
        <span data-tip={proxy ? 'Distinct display names across those runs. A PROXY: this backend has not run the 2026-09-23 player-key migration, so accounts cannot be told apart. A name can change and can be shared. Unique players sit on every evidence label.' : 'Distinct players across those runs, by the server-side player key: a hash of the account id, one per account, stable across renames. Unique players sit on every evidence label.'}>{players}{proxy ? ' (proxy: backend not migrated)' : ''}</span>
        <span data-tip="The oldest and newest run in scope">{day(oldest)} to {day(newest)}</span>
        <span data-tip="The balance epoch is the content revision the runs were played under. It is a filter, never a stratum.">{epochLabel}</span>
        <span>{windowLabel}</span>
        {prolific && <span className="balwarn" data-tip="The sensitivity toggle is on: every table below leaves this player's runs out">excluding {prolific.runs} runs of the most prolific player</span>}
      </div>
      <div className="balbanner-row balbanner-dim">
        <span data-tip={`Flat rows are paged from the database, ${BALANCE_FLAT_PAGE} a page, up to ${BALANCE_FLAT_CAP}. Truncated means the cap stopped the walk and the report is a bounded preview.`}>flat rows {fetch.flatFetched} fetched, cap {BALANCE_FLAT_CAP}, {fetch.flatTruncated ? 'TRUNCATED' : 'complete'}</span>
        <span data-tip={`Derived payloads are fetched by id for the newest ${derivedCap} in-set rows. Dropped = asked for and not returned. The exposed and adjusted reads need them.`}>derived {derivedLoading ? 'loading' : `${fetch.derivedFetched} of ${fetch.derivedRequested} requested`}, cap {derivedCap}{derivedDropped > 0 && !derivedLoading ? `, ${derivedDropped} dropped` : ''}</span>
        <span data-tip="Runs in scope with a usable derived payload; the rest are left out of the exposed and adjusted reads and counted, never invented">{coverage.withDerived} of {runs} with usable streams</span>
        <span data-tip="Payloads whose streams carried earlier runs of the same browser session in front of their own. Read by their last segment. The upload-time card arrays stack the same way and cannot be cut, which is why Raw buyers can exceed Buyers this run.">{quality.stackedStreams} stacked payloads</span>
        <span data-tip="Rows whose replay-derived tier-by-wave does not match the live final wave, short or long. The Shop Tiers reach table and the shop curve are unreliable for them.">{quality.replayDisagree} replay tier tables disagree</span>
        <span data-tip="Rows with no placement, rows whose placement was not an integer 1 to 8 (cleared), and rows dropped for a duplicate id">{quality.placementMissing} missing placement, {quality.placementMalformed} malformed, {quality.duplicateIds} duplicate ids</span>
        <span data-tip="Rows with no recorded hero picker trio; they cannot enter the offered-not-chosen hero comparison">{quality.heroOfferMissing} without a hero trio</span>
        {quality.diverged > 0 && <span data-tip="Partial payloads, left out of every derived read">{quality.diverged} diverged</span>}
      </div>
      <div className="balbanner-row balbanner-dim">
        <span>Every number below is an association among the runs observed, not a measured effect: comparing buyers with all other runs rewards survival and card access, the exposed and adjusted reads narrow the comparison to runs that had the chance, and no label here means confirmed overpowered or underpowered.</span>
        <span data-tip="Stage C of the analytics correction (a player-cluster bootstrap that recomputes the whole estimate, and false-discovery screening across every card) is deferred on purpose. Both need many independent players; over a handful they would manufacture confidence. The Welch ranges and the evidence labels are the whole uncertainty read for now.">No bootstrap or multiple-comparison screening is run: over {players} it would manufacture confidence, so each 95% range stands alone and is not a screened discovery.</span>
      </div>
    </div>
  );
}

// ── The panel ──────────────────────────────────────────────────────────────────────────────────────────────

type SectionKey = 'minions' | 'spells' | 'heroes' | 'runes' | 'shopcurve' | 'economy' | 'upgrades';

/** How many of the newest in-set rows get their derived payload fetched (~100 KB each today). Stated on the
 *  banner and in the export meta; a slice past it is bounded, never silently short. */
const DERIVED_CAP = 800;

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
  const [fetchState, setFetchState] = useState<FetchState>({ flatFetched: 0, flatTruncated: false, derivedRequested: 0, derivedFetched: 0, playerKeyBasis: 'playerKey' });
  const [loading, setLoading] = useState(false);
  const [sectionKey, setSectionKey] = useState<SectionKey>('minions');
  // HERO FILTER (owner ask 2026-08-02: "what minions does Robin buy vs Guardian"). Re-AGGREGATES from the raw
  // rows rather than filtering the finished tables, so the denominators are that hero's too. A VIEW filter:
  // the export always carries every hero.
  const [heroFilter, setHeroFilter] = useState<string>('');
  const [view, setView] = useState<SectionView>('table');
  const [density, setDensity] = useState<Density>('compact');
  // THE SCOPE (A4): the balance epoch (null = the default, decided from the data), the date window, the thin-
  // epoch override, and the sensitivity toggle. Data filters: the export follows them.
  const [epochPick, setEpochPick] = useState<string | null>(null);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [showThin, setShowThin] = useState(false);
  const [excludeProlific, setExcludeProlific] = useState(false);
  // STAGE TWO of the load (the derived payloads) is in flight: the derived sections and Export all wait for it.
  const [derivedLoading, setDerivedLoading] = useState(false);
  // A Refresh that overtakes an earlier one wins: a stale completion is dropped, never merged.
  const loadSeq = useRef(0);

  const load = (): void => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setDerivedLoading(false);
    void (async () => {
      const flat = await fetchRunTelemetry();
      if (seq !== loadSeq.current) return;
      setRows(flat.rows);
      setFetchState({ flatFetched: flat.fetched, flatTruncated: flat.truncated, derivedRequested: 0, derivedFetched: 0, playerKeyBasis: flat.playerKeyBasis });
      setLoading(false);
      // STAGE TWO: the derived payloads, BY ID, only for the rows the report reads (ladder rows of the active
      // set), newest first, after the flat rows have rendered. Pre-migration that is no rows and no bytes; with
      // data it keeps a multi-megabyte parse off the frame that paints the flat report.
      const ids = applyReportFilters(flat.rows, activeSet().id).rows.map((r) => r.id).filter((id): id is number => id != null).slice(0, DERIVED_CAP);
      if (ids.length === 0) return;
      setDerivedLoading(true);
      const byId = await fetchRunDerived(ids);
      if (seq !== loadSeq.current) return;
      if (byId.size > 0) setRows((prev) => prev.map((r) => (r.id != null && byId.has(r.id) ? { ...r, derived: byId.get(r.id)! } : r)));
      setFetchState((f) => ({ ...f, derivedRequested: ids.length, derivedFetched: byId.size }));
      setDerivedLoading(false);
    })();
  };
  useEffect(() => { if (show) load(); }, [show]);

  // THE DATA FILTERS: ladder rows only, the active set only (a row with no set stamp is set 1, never the
  // live set), then the epoch and window scope. Pure functions in @game/sim, shared with the export.
  const set = activeSet();
  const buildRev = contentRevision();
  const filtered = useMemo(() => applyReportFilters(rows, set.id), [rows, set.id]);
  const epochs = useMemo(() => epochsOf(filtered.rows), [filtered]);
  const epoch = epochPick ?? defaultEpoch(epochs, buildRev);
  const scope = useMemo((): ReportScope => ({ epoch, from: from || null, to: to || null }), [epoch, from, to]);
  const scoped = useMemo(() => scopeReport(filtered, scope), [filtered, scope]);
  const insufficient = scope.epoch !== ALL_EPOCHS && scoped.rows.length < EPOCH_MIN_RUNS && !showThin;
  // THE PLAYER KEY (2026-09-23): the account key when the backend has it, else the display-name proxy the banner labels.
  const keyOf = useMemo(() => playerKeyFor(fetchState.playerKeyBasis), [fetchState.playerKeyBasis]);
  const prolific = useMemo(() => mostProlificPlayer(scoped.rows, keyOf), [scoped, keyOf]);
  const baseRows = useMemo(() => (excludeProlific && prolific ? scoped.rows.filter((r) => keyOf(r) !== prolific.key) : scoped.rows), [scoped, excludeProlific, prolific, keyOf]);
  const heroRows = useMemo(() => (heroFilter ? baseRows.filter((r) => r.heroId === heroFilter) : baseRows), [baseRows, heroFilter]);
  const quality = useMemo(() => dataQuality(baseRows), [baseRows]);
  // The banner and the replay note describe the rows the tables below actually read: the hero slice when a hero is
  // picked, so "eligible runs", the coverage and the players never mix the whole scope with one hero's runs.
  const tableQuality = useMemo(() => (heroFilter ? dataQuality(heroRows) : quality), [heroFilter, heroRows, quality]);
  const report = useMemo(() => aggregatePlayerReport(heroRows), [heroRows]);
  // ALL cohort math for the cards, once per rows / filter version.
  const impactRes = useMemo(() => cardImpactWithCoverage(heroRows, keyOf), [heroRows, keyOf]);
  const impact = useMemo(() => ({ minions: impactRes.rows.filter((r) => !r.spell), spells: impactRes.rows.filter((r) => r.spell) }), [impactRes]);
  const cardStrips = useMemo(() => {
    const strips = (list: CardImpactRow[]): StripDef<CardImpactRow>[] => [
      { what: 'Tier', groups: impactGroups(list, 'tier'), matches: (r, k) => String(r.tier) === k },
      { what: 'Tribe', groups: impactGroups(list, 'tribe'), matches: (r, k) => r.tribe === k || r.tribe2 === k },
    ];
    return { minions: strips(impact.minions), spells: strips(impact.spells) };
  }, [impact]);
  // Heroes read the WHOLE scope: the hero picker slicing the hero table to one row against nobody answers
  // nothing, so the picker is disabled on this section and the legend says so.
  const heroes = useMemo(() => heroImpact(baseRows, keyOf), [baseRows, keyOf]);
  const runes = useMemo(() => runeImpact(heroRows, keyOf), [heroRows, keyOf]);
  const runeStrips = useMemo((): StripDef<RuneImpactRow>[] => [{ what: 'Forge', groups: runeGroups(runes), matches: (r, k) => r.forge === k }], [runes]);
  const tiers = useMemo(() => tierImpact(heroRows), [heroRows]);
  const tierDec = useMemo(() => tierDecisions(heroRows, keyOf), [heroRows, keyOf]);
  const economy = useMemo(() => goldEconomy(heroRows), [heroRows]);
  const derived = useMemo(() => heroRows.map((r) => r.derived).filter((d): d is DerivedRun => d != null), [heroRows]);
  // Every hero that actually appears in the slice, so the dropdown never offers an empty choice.
  const heroIds = useMemo(() => [...new Set(scoped.rows.map((r) => r.heroId))].sort(), [scoped]);
  const dates = useMemo(() => { const d = baseRows.map((r) => r.createdAt).filter((x): x is string => !!x).sort(); return { oldest: d[0] ?? null, newest: d[d.length - 1] ?? null }; }, [baseRows]);

  // EXPORT ALL (owner ask 2026-09-22): ONE JSON file from the SAME scoped rows the screen renders (every hero;
  // the hero / tier / tribe pickers are view filters). Meta + readme + aggregates + raw rows + derived.
  const exportAll = (): void => {
    sfx.pulse();
    const data = buildBalanceExport(baseRows, {
      activeSet: { id: set.id, name: set.name },
      appVersion: `${__APP_VERSION__}+${__BUILD_SHA__}`,
      generatedAt: new Date().toISOString(),
      contentRevision: buildRev,
      counts: scoped.counts,
      filters: scoped.applied,
      scope,
      epochs,
      fetch: {
        flatCap: BALANCE_FLAT_CAP, flatPageSize: BALANCE_FLAT_PAGE, flatFetched: fetchState.flatFetched, flatTruncated: fetchState.flatTruncated,
        derivedCap: DERIVED_CAP, derivedRequested: fetchState.derivedRequested, derivedFetched: fetchState.derivedFetched, derivedDropped: fetchState.derivedRequested - fetchState.derivedFetched,
      },
      excludedProlificRuns: excludeProlific && prolific ? prolific.runs : 0,
      playerKeyBasis: fetchState.playerKeyBasis,
    });
    download(JSON.stringify(data), `ascent-balance-${set.id}-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  // The per-card CSV (owner ask 2026-07-16) stays as the second button, over the same rows.
  const exportCsv = (): void => {
    sfx.pulse();
    download(buildCardCsv(baseRows), `ascent-cards-${set.id}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  };

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const refresh = (): void => { sfx.pulse(); load(); };
  const pickSection = (k: SectionKey): void => { sfx.pulse(); setSectionKey(k); };
  const pickEpoch = (v: string): void => { sfx.pulse(); setEpochPick(v); setShowThin(false); };
  const counts = scoped.counts;
  const isDerived = sectionKey === 'economy' || sectionKey === 'upgrades';
  const hasData = heroRows.length > 0;
  const toggles = { view, setView };
  const derivedHint = derived.length ? ` (${derived.length} runs)` : derivedLoading ? ' (loading)' : '';
  const epochOption = (e: EpochInfo): string => `${e.rev === buildRev ? 'This build: ' : ''}${e.rev} (${e.runs} ${e.runs === 1 ? 'run' : 'runs'}, ${day(e.oldest)} to ${day(e.newest)})`;
  const revisionWord = scope.epoch === ALL_EPOCHS ? 'all revisions' : `revision ${scope.epoch}`;

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
            <button className="balrun" disabled={loading || derivedLoading || baseRows.length === 0} onClick={exportAll}
              data-tip={derivedLoading ? 'Waits for the derived streams to land, so the file holds everything it can' : `Downloads the runs in scope (${revisionWord}, the window, the sensitivity toggle) as one JSON file: the tables, the raw rows and the derived streams, with a readme, the caps and the exclusions inside. Schema version 2.`}>
              {derivedLoading ? 'Export (loading)' : 'Export all'}
            </button>
            <button className="balrun" disabled={loading || baseRows.length === 0} onClick={exportCsv}
              data-tip="Downloads the per-card spreadsheet (buy turns, win lift, source split) over the same runs">
              Export CSV
            </button>
          </div>
          {/* THE SCOPE (A4): epoch, window, sensitivity. Shared with the export. */}
          <div className="balcontrols balscope">
            <select className="balpick" value={epoch} onChange={(e) => pickEpoch(e.target.value)} aria-label="Balance epoch" disabled={epochs.length === 0}>
              {epochs.map((e) => <option key={e.rev} value={e.rev}>{epochOption(e)}</option>)}
              {!epochs.some((e) => e.rev === buildRev) && <option value={buildRev}>This build: {buildRev} (0 runs)</option>}
              <option value={ALL_EPOCHS}>All revisions, historical ({filtered.rows.length} runs, {epochs.length} revisions)</option>
            </select>
            <label className="ballabel">from <input className="balpick baldate" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Window start" /></label>
            <label className="ballabel">to <input className="balpick baldate" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Window end" /></label>
            <button className={`balchip${excludeProlific ? ' on' : ''}`} disabled={!prolific} onClick={() => { sfx.tick(); setExcludeProlific((v) => !v); }}
              data-tip={prolific ? `Sensitivity view: leave out the ${prolific.runs} runs of the most prolific player${fetchState.playerKeyBasis === 'displayName' ? ' (by display name, a proxy on this backend)' : ''}. If a conclusion reverses, it rested on one player.` : 'No player to exclude yet'}>
              {excludeProlific ? 'Prolific player excluded' : 'Exclude most prolific player'}
            </button>
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
        ) : counts.inSet === 0 ? (
          <div className="balempty">
            {counts.ladder === 0 ? 'No player data yet. Finished lobby runs upload their telemetry to run_telemetry; this report fills once runs have banked.'
              : `No ${set.name} runs yet. ${counts.ladder} ladder runs were fetched and none is stamped ${set.name}; ${counts.unstamped} carry no stamp and count as Set 1. The 2026-09-22 devlog runbook stamps them by SQL.`}
          </div>
        ) : insufficient ? (
          <div className="balempty">
            <b>Insufficient current data.</b> {scoped.rows.length} of {filtered.rows.length} {set.name} runs were played on {scope.epoch === buildRev ? 'this build\'s content revision' : 'content revision'} {scope.epoch}{scope.from || scope.to ? ' inside the window' : ''}; a revision needs {EPOCH_MIN_RUNS} to be read on its own.
            Older revisions are not pooled in on their own: choose it.
            <div className="balseg-row">
              <button className="balrun" onClick={() => { sfx.pulse(); setEpochPick(ALL_EPOCHS); }} data-tip={`Read every revision together (${filtered.rows.length} runs across ${epochs.length}). Cards, heroes and runes may have changed between them; the tables then show mixed versions under current names and tiers.`}>Include historical ({filtered.rows.length} runs)</button>
              {scoped.rows.length > 0 && <button className="balrun" onClick={() => { sfx.pulse(); setShowThin(true); }} data-tip="Read this revision alone anyway. Every table will be thin.">Show these {scoped.rows.length} runs anyway</button>}
            </div>
          </div>
        ) : !hasData ? (
          <div className="balempty">{heroFilter ? `No ${set.name} runs for ${getHero(heroFilter).name} in this scope.` : `No ${set.name} runs in this scope.`}</div>
        ) : (
          <>
            <EvidenceBanner setName={set.name} runs={heroRows.length} sliced={heroFilter ? getHero(heroFilter).name : null} quality={tableQuality} coverage={impactRes.coverage} scope={scope} epochs={epochs}
              fetch={fetchState} derivedCap={DERIVED_CAP} derivedLoading={derivedLoading} prolific={excludeProlific ? prolific : null} oldest={dates.oldest} newest={dates.newest} />
            {heroFilter && sectionKey !== 'heroes' && <div className="balsub">{getHero(heroFilter).name} only ({heroRows.length} runs)</div>}
            {sectionKey === 'minions' || sectionKey === 'spells' ? (
              <ImpactSection
                key={sectionKey}
                rows={sectionKey === 'minions' ? impact.minions : impact.spells}
                views={CARD_VIEWS}
                strips={sectionKey === 'minions' ? cardStrips.minions : cardStrips.spells}
                keyOf={idOf} nOf={cardN} tipOf={cardTip}
                noun="cards" group="buyer runs" baseline="every other placed run" metric="Raw buyer association"
                legend={(
                  <>
                    Every column is PER RUN. Four views, one table at a time. <b>Performance</b> puts three comparisons side by side: the <b>Raw buyer
                    association</b> (buyers minus every other run: it rewards surviving long enough to see the card, which is why most cards read
                    green), the <b>Exposed diagnostic</b> (buyers minus the runs that saw the card and passed) and the <b>Adjusted association</b>
                    (buy minus pass inside the first affordable shop offer, among runs in the same round band and shop tier). Each has its own
                    95% range and none is causal. <b>Evidence</b> comes first: rows with a supported comparison sort to the top and insufficient
                    rows sit below, never ranked as worst. The tier and tribe chips sum card-buyer incidences, not unique runs. Rows under
                    {' '}{SAMPLE_GATES.preliminary} raw buyer runs are dimmed. Hover any header or name for its meaning.
                  </>
                )}
                {...toggles}
              />
            ) : sectionKey === 'heroes' ? (
              <ImpactSection
                key="heroes"
                rows={heroes}
                views={HERO_VIEWS}
                strips={NO_STRIPS}
                keyOf={idOf} nOf={heroN} tipOf={heroTip}
                noun="heroes" group="runs with the hero" baseline="every other run" metric="Raw association"
                legend={(
                  <>
                    One row per hero over every run in scope (the hero picker does not apply here). The <b>Offered association</b> compares runs
                    that chose the hero with runs whose picker offered it and that chose another: the runs that had the choice. The <b>Raw
                    association</b> against every other run is kept beside it. Picking a hero is a choice, not a random treatment, and
                    {' '}{quality.heroOfferMissing} runs have no recorded trio. With {baseRows.length} runs across {heroes.length} heroes most rows are
                    thin: read the evidence label and the 95% ranges before the numbers.
                  </>
                )}
                {...toggles}
              />
            ) : sectionKey === 'runes' ? (
              <ImpactSection
                key={`runes:${heroFilter}`}
                rows={runes}
                views={RUNE_VIEWS}
                strips={runeStrips}
                keyOf={idOf} nOf={runeN} tipOf={runeTip}
                noun="runes" group="taker runs" baseline="the runs offered it that skipped it" metric="Offered association"
                legend={(
                  <>
                    One row per rune, counted once per run. The <b>Offered association</b> is takers minus the runs that were <b>offered it and
                    skipped it</b>: equivalent forge access, so surviving to turn 6 or 9 does not make every rune look good. The uncontrolled read
                    against the whole field is kept as <b>Raw association vs field</b>. The offers are replay-derived (re-running the action
                    log, which is not guaranteed faithful for a lobby run), so reaching the forge is inferred, not observed. With {heroRows.length}
                    {' '}runs across {runes.length} runes most rows are thin: read the evidence label and the 95% ranges first. The Forge chips
                    sum rune-picker incidences and filter the table.
                  </>
                )}
                {...toggles}
              />
            ) : sectionKey === 'shopcurve' ? (
              <>
                <div className="balnote balwarn">
                  The curve and the reach table below are REPLAY-derived: the run is re-run without its lobby seats, and on {tableQuality.replayDisagree} of
                  {' '}{heroRows.length} runs the replayed tier-by-wave does not match the live final wave (short or long). The decision table further down reads the
                  live upgrade rows instead.
                </div>
                <ShopCurveChart curve={report.shopCurve} />
                <div className="balgap" />
                <ImpactSection
                  key={`tiers:${heroFilter}`}
                  rows={tiers}
                  views={TIER_VIEWS}
                  strips={NO_STRIPS}
                  keyOf={tierKey} nOf={tierN} tipOf={tierTip}
                  noun="tiers" group="early runs" baseline="runs that reached the tier later or never" metric="Raw association"
                  nameLabel="Tier" nameValue={tierOrder}
                  legend={(
                    <>
                      One row per shop tier, replay-derived. <b>Reached</b> and <b>Avg Wave</b> say how many runs got there and when. <b>By Wave</b> is
                      that average rounded, and the <b>early runs</b> reached the tier on or before it. The <b>Raw association</b> is the early runs
                      minus the runs that reached the tier later or never. <b>Reached vs never</b> is a survival statistic (the never-reached runs
                      are the early eliminations), kept for reference.
                    </>
                  )}
                  {...toggles}
                />
                <div className="balgap" />
                <div className="balnote">
                  <b>Tier-ups as decisions</b>, from the live upgrade rows (last segment): one primary decision per run per tier, the first wave a
                  tier-up to it was affordable, took or declined. A decline means the run ended that wave still able to afford it; a run that
                  spent its Gold on cards first is in neither group, and a later take never relabels a decline. An idle decline (the bracket
                  in Declined) is a wave the run bought no card either: a run holding its Gold, or one the player stopped acting in. In the
                  early waves it is mostly the second, so an early row's strong-looking interval is not a finding. They are disclosed, not
                  excluded, because dropping them would guess at intent. The <b>Adjusted association</b>
                  compares took with declined among runs in the same round band with similar spare Gold. Most rows read insufficient: players
                  who can afford a tier-up almost always take it.
                </div>
                {tierDec.length === 0 ? <div className="balempty">No upgrade rows in these runs yet.</div> : (
                  <DataTable
                    cols={TIERDEC_COLS}
                    rows={tierDec}
                    keyOf={tierKey}
                    nameOf={nameOfRow}
                    nameLabel="Tier"
                    nameValue={tierOrder}
                    tipOf={tierDecTip}
                    defaultKey="name"
                    defaultDir={1}
                    dense
                  />
                )}
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
              ) : sectionKey === 'economy' ? <EconomySection key={heroFilter} economy={economy} view={view} setView={setView} density={density} setDensity={setDensity} />
                : <UpgradeTable runs={derived} />
            ) : null}
          </>
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
  other: 'Average Gold spent on anything else (rubies, henchmen). A dash means nothing in this bucket used them.',
};
const gold1 = (n: number): string => (n === 0 ? '–' : n.toFixed(1));

const ECONOMY_COLS: Record<string, ColDef<EconomyWaveRow>> = {
  runs: { key: 'runs', label: 'Runs', tip: 'Runs of the picked bucket whose ledger reached this round: the divisor of every average in the row. A run counts for every round up to its last wave, whether or not Gold moved.', value: (r) => r.runs, cell: (r) => ({ text: String(r.runs), cls: 'balnum baldim' }) },
  moved: { key: 'moved', label: 'Moved', tip: 'Runs of the bucket with at least one Gold movement logged this round. Not the divisor; shown because "runs with a logged Gold movement" and "runs alive at the round" are different counts.', value: (r) => r.moved, cell: (r) => ({ text: String(r.moved), cls: 'balnum baldim' }) },
  goldStart: { key: 'goldStart', label: 'Start', tip: 'Average Gold a player has when the round opens, after the refill. Wave 1 opens on 3.', value: (r) => r.goldStart, cell: (r) => ({ text: r.goldStart.toFixed(1), cls: 'balnum balwin' }) },
  income: { key: 'income', label: 'Income', tip: 'Average Gold that came in during the round from cards and hero effects. The refill is not counted here; it is the next round\'s Start.', value: (r) => r.income, cell: (r) => ({ text: gold1(r.income), cls: 'balnum' }) },
  sold: { key: 'sold', label: 'Sold', tip: 'Average Gold recovered by selling during the round.', value: (r) => r.sold, cell: (r) => ({ text: gold1(r.sold), cls: 'balnum' }) },
  spent: { key: 'spent', label: 'Spent', tip: 'Average Gold spent during the round, all categories. The split to the right says on what.', value: (r) => r.spent, cell: (r) => ({ text: r.spent.toFixed(1), cls: 'balnum balwin' }) },
  spentPct: { key: 'spentPct', label: 'Spent %', tip: 'Spent as a percent of what was available: Start plus Income plus Sold.', value: (r) => r.spentPct, cell: (r) => ({ text: pctOrDash(r.spentPct), cls: 'balnum' }) },
  unspent: { key: 'unspent', label: 'Unspent', tip: 'Average Gold left when the round ended. It is not carried over: the next round refills to the cap, so this Gold is lost.', value: (r) => r.unspent, cell: (r) => ({ text: r.unspent.toFixed(1), cls: `balnum${r.unspent >= 2 ? ' balwin cold' : r.unspent >= 1 ? ' balwin cool' : ''}` }) },
  ...Object.fromEntries(SPEND_CATEGORIES.map((c): [string, ColDef<EconomyWaveRow>] => [c, { key: c, label: SPEND_LABEL[c], tip: SPEND_TIP[c], value: (r) => r.split[c], cell: (r) => ({ text: gold1(r.split[c]), cls: 'balnum' }) }])),
};
const ECONOMY_COMPACT = pick(ECONOMY_COLS, ['runs', 'goldStart', 'spent', 'spentPct', 'unspent', 'minion', 'spell', 'upgrade', 'refresh']);
const ECONOMY_DETAILED = pick(ECONOMY_COLS, ['runs', 'moved', 'goldStart', 'income', 'sold', 'spent', 'spentPct', 'unspent', 'minion', 'spell', 'upgrade', 'refresh', 'rune', 'heroPower', 'other']);
const waveKey = (r: EconomyWaveRow): string => String(r.wave);
const waveName = (r: EconomyWaveRow): string => `Wave ${r.wave}`;
const waveOrder = (r: EconomyWaveRow): number => r.wave;
const economyTip = (r: EconomyWaveRow): string =>
  `Wave ${r.wave}, ${r.runs} runs reached it (${r.moved} moved Gold): a player opens on ${r.goldStart.toFixed(1)} Gold, spends ${r.spent.toFixed(1)} and leaves ${r.unspent.toFixed(1)} on the table.`;

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
        Sold equals Spent plus Unspent for every run. <b>Runs</b> is the divisor: runs whose ledger reached the round, whether or not Gold
        moved that round (Detailed shows <b>Moved</b>, the runs with a logged movement, beside it). Every run with a ledger in scope
        counts{economy.skipped > 0 ? `, except ${economy.skipped} left out because the ledger was partial or did not open on the game's 3 Gold (a dev build)` : ''}; the
        rows pool every content revision in scope, and Gold rules are assumed unchanged across them, not checked.
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
  // The direct end labels: the series converge at the last wave, so labels closer than 12 px are pushed apart,
  // top to bottom, keeping their order by value. The dots stay where the data is; only the text moves.
  const LABEL_GAP = 12;
  const endLabelY = new Map<string, number>();
  const ends = series.map((s) => ({ key: s.key, y: y(s.points[s.points.length - 1]![1]) })).sort((a, b) => a.y - b.y);
  for (let i = 0; i < ends.length; i++) {
    const prev = i > 0 ? endLabelY.get(ends[i - 1]!.key)! : -Infinity;
    endLabelY.set(ends[i]!.key, Math.max(ends[i]!.y, prev + LABEL_GAP));
  }
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
            <text x={x(s.points[s.points.length - 1]![0]) + 8} y={endLabelY.get(s.key)! + 4} className={`balchart-ptl ${s.cls}`} textAnchor="start">{s.points[s.points.length - 1]![1].toFixed(1)}</text>
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
      <div className="balnote">Turns where a tier-up was affordable or visible, and what players did. Declines are data too. Read as stored: a payload that carries earlier runs of the same session counts them here as well.</div>
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
