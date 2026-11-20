import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  ANCIENTS, ANCIENT_IDS, EVIDENCE_GATES, NEVER_MIN_OFFERED, RARE_MAX_RATE, RARE_MIN_OFFERED, RATE_MIN_OFFERED,
  ancientOutliers, ancientReach, clearOfZero, getHero, heroRerollCounts, neverOffered, offerShownCounts, outlierSentence, outliersFromCards,
  outliersFromHeroes, outliersFromRunes, pickGaps, questOutliers, rankOutliers, rankRates, rateRows, reportUniverse, soldCounts,
  type AncientId, type AncientReach, type CardImpactRow, type CohortRow, type EvidenceLabel, type HeroImpactRow, type OutlierItem,
  type OutlierKind, type PlayerKeyOf, type RateRow, type RuneImpactRow, type UniverseEntry,
} from '@game/sim';
import type { SetId } from '@game/content';
import { ancientArt, artFor, heroArt, questArt, runeArt } from '../art';
import { sfx } from '../sfx';
import './balanceOverview.css';

/**
 * THE AT-A-GLANCE BALANCE REPORT (owner asks 2026-11-19: "i want to immediately be able to recognize over or
 * underperforming cards/heroes/ancients, as well as options and cards that are simply never picked or purchased"; "make
 * sure this very clearly captures minion/spell/rune/hero offer / purchase / selection rates in the same way"; "is a
 * placement of +1 good or bad?"). Four views over the rows the panel already scoped:
 *  · OUTLIERS: per category, over- and under-performers by finish vs the comparable runs that passed, GATED on evidence.
 *  · PICK RATES: per category, items taken far more or less than their fair peer group (same tier, forge, ...).
 *  · NEVER PICKED: shown and never / rarely taken, and set content never shown at all.
 *  · ANCIENTS: the reach funnel, the six Ancients, the hero x Ancient matrix.
 * EVERY category uses the same columns (Offered runs, Shown, Bought / Picked / Chosen, Take rate per offer, Finish vs.
 * passed, Effect, Took / passed, Evidence). A placement difference is NEVER a bare signed number: it reads "1.1 better" /
 * "0.6 worse" (better = a higher finish, closer to 1st), grey "no clear difference" when the interval crosses zero or the
 * evidence is thin. All math is `@game/sim` (`reportOutliers.ts`), computed once per scope in the memos below.
 */

export type OverviewView = 'outliers' | 'rates' | 'gaps' | 'ancients';

const KIND_LABEL: Record<OutlierKind, string> = { minion: 'Minions', spell: 'Spells', hero: 'Heroes', ancient: 'Ancients', pairing: 'Hero × Ancient', rune: 'Runes', quest: 'Quests' };
const KIND_ONE: Record<OutlierKind, string> = { minion: 'minion', spell: 'spell', hero: 'hero', ancient: 'Ancient', pairing: 'pairing', rune: 'rune', quest: 'quest' };
/** The category's natural verb (owner 2026-11-19): Bought for cards, Chosen for heroes, Picked for the rest. */
const VERB: Record<OutlierKind, string> = { minion: 'Bought', spell: 'Bought', hero: 'Chosen', ancient: 'Picked', pairing: 'Picked', rune: 'Picked', quest: 'Picked' };
const EV_TEXT: Record<EvidenceLabel, string> = { supported: 'Supported', candidate: 'Candidate', insufficient: 'Thin' };
const COMPARISON: Record<OutlierKind, string> = {
  minion: 'bought vs offered and passed, inside the first affordable Shop offer, same round band and Shop tier',
  spell: 'bought vs offered and passed, inside the first affordable Shop offer, same round band and Shop tier',
  hero: 'chosen vs offered and chose another hero',
  ancient: 'picked vs offered and picked another, same round band of the offer',
  pairing: 'picked vs offered and picked another, same round band of the offer',
  rune: 'picked vs offered and skipped',
  quest: 'picked vs offered and skipped',
};
const ORDER: OutlierKind[] = ['minion', 'spell', 'hero', 'ancient', 'pairing', 'rune', 'quest'];
const FINISH_TIP = 'How many places better or worse runs that took it finished than comparable runs that were offered it and passed. Better = a higher finish (closer to 1st). Grey "no clear difference": the 95% interval crosses zero, or the evidence is thin.';

const capTribe = (t: string | undefined): string => (t ? t.split('/').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('/') : '');
const pct = (n: number | null): string => (n == null ? '–' : `${n}%`);
/** A places difference in words, never a bare sign. */
const placesWords = (g: number): string => (g > 0 ? `${g.toFixed(1)} better` : g < 0 ? `${Math.abs(g).toFixed(1)} worse` : 'even');
/** A finish read is "clear" when the interval clears zero and the evidence is not thin. */
const isClear = (it: OutlierItem): boolean => it.gain != null && it.evidence !== 'insufficient' && clearOfZero(it);
const ciWords = (ci: OutlierItem['ci']): string => (ci ? `${placesWords(ci.lo)} to ${placesWords(ci.hi)}` : 'not shown under 5 runs a side');

/** The art for an item, or undefined (the thumbnail then shows the initial). */
function artOf(kind: OutlierKind, id: string, heroId?: string): string | undefined {
  switch (kind) {
    case 'minion': case 'spell': return artFor(id);
    case 'hero': return heroArt(id);
    case 'ancient': return ancientArt(id);
    case 'pairing': return heroId ? heroArt(heroId) : undefined;
    case 'rune': return runeArt(id);
    case 'quest': return questArt(id);
  }
}

const Thumb = memo(function Thumb({ kind, id, heroId, ancientId, name }: { kind: OutlierKind; id: string; heroId?: string; ancientId?: string; name: string }) {
  const src = artOf(kind, id, heroId);
  const anc = ancientId ? ANCIENTS[ancientId as AncientId] : undefined;
  return (
    <span className={`bov-thumb k-${kind}`} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="bov-initial">{name.charAt(0)}</span>}
      {anc && kind === 'pairing' && <span className="bov-anc" style={{ background: anc.color }}>{anc.glyph}</span>}
    </span>
  );
});

/** The effect plot: a dot at the finish difference on a worse (left) to better (right) axis of two places each way,
 *  with its 95% whisker. Static SVG. Grey when the read is not clear. */
const SPAN = 2;
const EffectPlot = memo(function EffectPlot({ gain, ci, clear, evidence }: { gain: number | null; ci: OutlierItem['ci']; clear: boolean; evidence: EvidenceLabel }) {
  const W = 132, H = 20, mid = W / 2;
  const x = (v: number): number => mid + (Math.max(-SPAN, Math.min(SPAN, v)) / SPAN) * (mid - 6);
  const cls = gain == null ? 'none' : !clear ? 'unclear' : gain > 0 ? 'pos' : gain < 0 ? 'neg' : 'zero';
  return (
    <svg className={`bov-plot ev-${evidence} ${cls}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <line className="bov-axis" x1={6} x2={W - 6} y1={H / 2} y2={H / 2} />
      <line className="bov-zero" x1={mid} x2={mid} y1={2} y2={H - 2} />
      {[-1, 1].map((t) => <line key={t} className="bov-tick" x1={x(t)} x2={x(t)} y1={H / 2 - 3} y2={H / 2 + 3} />)}
      {gain != null && ci && <line className="bov-ci" x1={x(ci.lo)} x2={x(ci.hi)} y1={H / 2} y2={H / 2} />}
      {gain != null && <rect className="bov-bar" x={Math.min(mid, x(gain))} width={Math.abs(x(gain) - mid)} y={H / 2 - 2} height={4} />}
      {gain != null && <circle className="bov-dot" cx={x(gain)} cy={H / 2} r={4.5} />}
    </svg>
  );
});

/** The compact take-rate bar (per offer), with an optional peer-average tick. */
const RateBar = memo(function RateBar({ rate, peer }: { rate: number | null; peer?: number | null }) {
  return (
    <span className="bov-rate">
      <span className="bov-ratebar" aria-hidden="true">
        <span style={{ transform: `scaleX(${(rate ?? 0) / 100})` }} />
        {peer != null && <i style={{ left: `${peer}%` }} />}
      </span>
      <b>{pct(rate)}</b>
    </span>
  );
});

/** The finish cell: "1.1 better" (green) / "0.6 worse" (red), or grey "no clear difference" with what it leans to. */
function FinishCell({ it }: { it: OutlierItem }) {
  if (it.gain == null) return <span className="bov-fin none">–</span>;
  if (!isClear(it)) return <span className="bov-fin unclear"><b>no clear difference</b><small>leans {placesWords(it.gain)}</small></span>;
  const a = Math.abs(it.gain);
  const lvl = a >= 1 ? 3 : a >= 0.5 ? 2 : a >= 0.2 ? 1 : 0;
  return <span className={`bov-fin ${it.gain > 0 ? `hp${lvl}` : `hn${lvl}`}`}><b>{placesWords(it.gain)}</b><small>places</small></span>;
}

/** Matrix heat: a colour only when the read is clear. */
const heat = (it: OutlierItem): string => {
  if (!isClear(it)) return 'h0';
  const a = Math.abs(it.gain!);
  const lvl = a >= 1 ? 3 : a >= 0.5 ? 2 : a >= 0.2 ? 1 : 0;
  return `${it.gain! > 0 ? 'hp' : 'hn'}${lvl}`;
};

// ── The unified table ──────────────────────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'offered' | 'shown' | 'taken' | 'rate' | 'finish' | 'n' | 'evidence';
const EV_ORDER: Record<EvidenceLabel, number> = { supported: 2, candidate: 1, insufficient: 0 };
const SORT_VALUE: Record<Exclude<SortKey, 'name'>, (it: OutlierItem) => number | null> = {
  offered: (it) => it.offered, shown: (it) => it.shown, taken: (it) => it.takenEvents, rate: (it) => it.takeRate,
  finish: (it) => (isClear(it) ? it.gain : null), n: (it) => Math.min(it.takers, it.passers), evidence: (it) => EV_ORDER[it.evidence],
};

/** One expandable row. */
const ItemRow = memo(function ItemRow({ it, open, onToggle }: { it: OutlierItem; open: boolean; onToggle: (key: string) => void }) {
  const key = `${it.kind}:${it.id}`;
  return (
    <div className={`bov-row${open ? ' open' : ''}${it.evidence === 'insufficient' ? ' thin' : ''}`} role="row">
      <button type="button" className="bov-rowbtn" aria-expanded={open} onClick={() => { sfx.tick(); onToggle(key); }}>
        <span className="bov-c-name" role="cell">
          <Thumb kind={it.kind} id={it.id} heroId={it.heroId} ancientId={it.ancientId} name={it.name} />
          <span className="bov-nm">
            <b>{it.name}</b>
            {(it.tier != null || it.tribe) && <small>{it.tier != null ? `T${it.tier}` : ''}{it.tier != null && it.tribe ? ' · ' : ''}{capTribe(it.tribe)}</small>}
          </span>
        </span>
        <span className="bov-c-num" role="cell">{it.offered}</span>
        <span className="bov-c-num" role="cell">{it.shown}</span>
        <span className="bov-c-num" role="cell">{it.takenEvents}{it.sold != null && it.sold > 0 ? <small> sold {it.sold}</small> : null}</span>
        <span className="bov-c-rate" role="cell"><RateBar rate={it.takeRate} /></span>
        <span className="bov-c-fin" role="cell"><FinishCell it={it} /></span>
        <span className="bov-c-plot" role="cell"><EffectPlot gain={it.gain} ci={it.ci} clear={isClear(it)} evidence={it.evidence} /></span>
        <span className="bov-c-n" role="cell">{it.takers}<i>/</i>{it.passers}</span>
        <span className="bov-c-ev" role="cell"><span className={`bov-ev ev-${it.evidence}`}>{EV_TEXT[it.evidence]}</span></span>
      </button>
      {open && <RowDetail it={it} />}
    </div>
  );
});

function RowDetail({ it }: { it: OutlierItem }) {
  const v = VERB[it.kind].toLowerCase();
  const facts: [string, ReactNode][] = [
    ['Offered in (runs)', `${it.offered}`],
    [`${VERB[it.kind]} in (runs)`, `${it.taken} (${pct(it.runRate)} of those runs)`],
    ['Shown (times)', `${it.shown}`],
    [`${VERB[it.kind]} (times)`, `${it.takenEvents} (${pct(it.takeRate)} per offer)`],
    ...(it.shop ? [['Shop', `shown ${it.shop.shown}, bought ${it.shop.taken}`] as [string, ReactNode]] : []),
    ...(it.discover ? [['Discover', `shown ${it.discover.shown}, picked ${it.discover.taken}`] as [string, ReactNode]] : []),
    ...(it.sold !== undefined ? [['Sold (times)', it.sold == null ? 'not recorded in these runs' : `${it.sold}`] as [string, ReactNode]] : []),
    ...(it.finalBoardPct !== undefined ? [['On the final board', it.finalBoardPct == null ? '–' : `${it.finalBoardPct}% of copies`] as [string, ReactNode]] : []),
    ['Average finish', it.takerAvg != null && it.passerAvg != null ? `${it.takerAvg.toFixed(1)} (${v}) vs ${it.passerAvg.toFixed(1)} (passed)` : '–'],
    ['Finish vs. passed', it.gain == null ? '–' : `${placesWords(it.gain)} places${isClear(it) ? '' : ' (no clear difference)'}`],
    ['95% interval', ciWords(it.ci)],
    ['Placed runs: took / passed', `${it.takers} / ${it.passers}`],
    ['Players, smaller side', it.players == null ? 'n/a' : String(it.players)],
    ['Comparison', it.basis === 'exposed' ? 'bought vs saw it in the Shop and never bought (exposed diagnostic)' : COMPARISON[it.kind]],
  ];
  return (
    <div className="bov-detail">
      <p>{outlierSentence(it)}</p>
      <dl>{facts.map(([k, val]) => <div key={k} className={k === 'Comparison' ? 'wide' : undefined}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
    </div>
  );
}

function SortHead({ k, label, tip, sort, onSort, cls }: { k: SortKey; label: ReactNode; tip: string; sort: { key: SortKey | null; dir: 1 | -1 }; onSort: (k: SortKey) => void; cls: string }) {
  const on = sort.key === k;
  return (
    <button type="button" role="columnheader" className={`bov-sort ${cls}${on ? ' on' : ''}`} data-tip={tip} onClick={() => { sfx.tick(); onSort(k); }}>
      {label}{on ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
    </button>
  );
}

/** The ONE table every category uses: same columns, same order, same sort controls. `items` arrive in their list's own
 *  order (best first, worst first, ...); a header click re-sorts them (missing values sink). */
function ItemTable({ kind, items, open, onToggle, empty }: { kind: OutlierKind; items: OutlierItem[]; open: string | null; onToggle: (k: string) => void; empty?: string }) {
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 1 | -1 }>({ key: null, dir: -1 });
  const onSort = (k: SortKey): void => setSort((s) => (s.key === k ? { key: k, dir: s.dir === -1 ? 1 : -1 } : { key: k, dir: k === 'name' ? 1 : -1 }));
  const rows = useMemo(() => {
    if (!sort.key) return items;
    const arr = [...items];
    if (sort.key === 'name') return arr.sort((a, b) => a.name.localeCompare(b.name) * sort.dir);
    const f = SORT_VALUE[sort.key];
    return arr.sort((a, b) => {
      const va = f(a), vb = f(b);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (vb - va) * -sort.dir || a.name.localeCompare(b.name);
    });
  }, [items, sort]);
  const verb = VERB[kind];
  return (
    <div className="bov-table" role="table">
      <div className="bov-head" role="row">
        <SortHead k="name" cls="bov-c-name" label={KIND_LABEL[kind]} tip="Sort by name" sort={sort} onSort={onSort} />
        <SortHead k="offered" cls="bov-c-num" label="Offered" tip="Runs it was offered in (once per run)." sort={sort} onSort={onSort} />
        <SortHead k="shown" cls="bov-c-num" label="Shown" tip="Times it was shown (per offer: a card seen in four Shops counts four; a rune in two forge visits counts two). Older rows that did not record per-offer counts count one per run." sort={sort} onSort={onSort} />
        <SortHead k="taken" cls="bov-c-num" label={verb} tip={`Times ${verb.toLowerCase()} (per event: every buy counts, so a card bought, sold and bought again counts twice). Sold copies are noted beside it where recorded.`} sort={sort} onSort={onSort} />
        <SortHead k="rate" cls="bov-c-rate" label="Take rate" tip={`${verb} / shown: the percent of offers that were taken (per offer). The expanded row also gives the per-run rate.`} sort={sort} onSort={onSort} />
        <SortHead k="finish" cls="bov-c-fin" label="Finish vs. passed" tip={FINISH_TIP} sort={sort} onSort={onSort} />
        <span role="columnheader" className="bov-c-plot bov-axislbl" data-tip="The finish difference on a two-places-each-way axis, with its 95% interval as a whisker."><span>worse</span><span>better</span></span>
        <SortHead k="n" cls="bov-c-n" label="Took / passed" tip="Placed runs in the finish comparison: took it / passed. Sorts by the smaller side." sort={sort} onSort={onSort} />
        <SortHead k="evidence" cls="bov-c-ev" label="Evidence" tip={`Supported: ${EVIDENCE_GATES.supported.side} runs a side and ${EVIDENCE_GATES.supported.players} players. Candidate: ${EVIDENCE_GATES.candidate.side} a side and ${EVIDENCE_GATES.candidate.players} players. Thin: under that, never ranked.`} sort={sort} onSort={onSort} />
      </div>
      {rows.length === 0 ? <div className="bov-none">{empty ?? 'Nothing here.'}</div>
        : rows.map((it) => <ItemRow key={`${it.kind}:${it.id}`} it={it} open={open === `${it.kind}:${it.id}`} onToggle={onToggle} />)}
    </div>
  );
}

// ── The rate table ─────────────────────────────────────────────────────────────────────────────────────────

const rateSentence = (r: RateRow): string => {
  const it = r.item, v = VERB[it.kind].toLowerCase();
  const peer = r.peerRate == null ? 'It has no peers to compare with.' : `The other ${r.peerItems} ${r.item.peerLabel} average ${r.peerRate}% per offer.`;
  const ci = r.ci ? ` Its 95% range is ${r.ci.lo}% to ${r.ci.hi}%${r.peerRate == null ? '' : r.clear ? `, clear of the peer average (${r.diff! > 0 ? 'taken more' : 'taken less'})` : ', which includes the peer average: no clear difference'}.` : '';
  return `Shown ${it.shown} times, ${v} ${it.takenEvents} (${pct(it.takeRate)}).${it.sold != null && it.sold > 0 ? ` Sold ${it.sold} times.` : ''} ${peer}${ci}`;
};

const RateItemRow = memo(function RateItemRow({ r, open, onToggle }: { r: RateRow; open: boolean; onToggle: (k: string) => void }) {
  const it = r.item, key = `rate:${it.kind}:${it.id}`;
  const tone = r.diff == null ? 'h0' : !r.clear ? 'h0' : r.diff > 0 ? 'more' : 'less';
  return (
    <div className={`bov-row${open ? ' open' : ''}`} role="row">
      <button type="button" className="bov-rowbtn bov-raterow" aria-expanded={open} onClick={() => { sfx.tick(); onToggle(key); }}>
        <span className="bov-c-name" role="cell">
          <Thumb kind={it.kind} id={it.id} heroId={it.heroId} ancientId={it.ancientId} name={it.name} />
          <span className="bov-nm"><b>{it.name}</b><small>{it.peerLabel}</small></span>
        </span>
        <span className="bov-c-num" role="cell">{it.shown}</span>
        <span className="bov-c-num" role="cell">{it.takenEvents}{it.sold != null && it.sold > 0 ? <small> sold {it.sold}</small> : null}</span>
        <span className="bov-c-rate wide" role="cell"><RateBar rate={it.takeRate} peer={r.peerRate} /></span>
        <span className={`bov-c-vs ${tone}`} role="cell"><b>{pct(it.takeRate)}</b> vs {pct(r.peerRate)}<small>{r.diff == null ? '' : `${r.diff > 0 ? '+' : ''}${r.diff} pts${r.clear ? '' : ', not clear'}`}</small></span>
        <span className="bov-c-n" role="cell">{r.ci ? `${r.ci.lo}–${r.ci.hi}%` : '–'}</span>
      </button>
      {open && <div className="bov-detail"><p>{rateSentence(r)}</p></div>}
    </div>
  );
});

function RateTable({ kind, rows, open, onToggle, empty }: { kind: OutlierKind; rows: RateRow[]; open: string | null; onToggle: (k: string) => void; empty: string }) {
  return (
    <div className="bov-table" role="table">
      <div className="bov-head bov-raterow" role="row">
        <span role="columnheader" className="bov-c-name">{KIND_LABEL[kind]} · peer group</span>
        <span role="columnheader" className="bov-c-num" data-tip="Times shown (per offer).">Shown</span>
        <span role="columnheader" className="bov-c-num" data-tip={`Times ${VERB[kind].toLowerCase()} (per event).`}>{VERB[kind]}</span>
        <span role="columnheader" className="bov-c-rate wide" data-tip="Take rate per offer; the gold tick is the peer group's average.">Take rate · peer tick</span>
        <span role="columnheader" className="bov-c-vs" data-tip="This item's take rate against the peer group's (the other items of the same tier / forge / group, pooled), and the gap in percentage points.">vs peers</span>
        <span role="columnheader" className="bov-c-n" data-tip="The 95% range of this item's own take rate (Wilson). A peer average outside it is a clear gap.">95% range</span>
      </div>
      {rows.length === 0 ? <div className="bov-none">{empty}</div> : rows.map((r) => <RateItemRow key={r.item.id} r={r} open={open === `rate:${r.item.kind}:${r.item.id}`} onToggle={onToggle} />)}
    </div>
  );
}

// ── The views ──────────────────────────────────────────────────────────────────────────────────────────────

export interface OverviewProps {
  view: OverviewView;
  setId: SetId;
  setName: string;
  /** The card rows (minions and spells) over the hero slice. */
  cards: readonly CardImpactRow[];
  /** Heroes over the whole scope (the hero slice does not apply to heroes). */
  heroes: readonly HeroImpactRow[];
  runes: readonly RuneImpactRow[];
  /** The scoped rows behind the cards and runes (the hero slice when one is picked). */
  rows: readonly CohortRow[];
  keyOf: PlayerKeyOf;
  derivedLoading: boolean;
}

export function BalanceOverview(p: OverviewProps) {
  const [cat, setCat] = useState<OutlierKind | 'all'>('all');
  const [minEv, setMinEv] = useState<EvidenceLabel>('candidate');
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [showThin, setShowThin] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const onToggle = useMemo(() => (k: string) => setOpen((o) => (o === k ? null : k)), []);

  // EVERY derived list, once per scope.
  const items = useMemo(() => {
    const anc = ancientOutliers(p.rows, p.keyOf);
    const cards = outliersFromCards(p.cards, soldCounts(p.rows));
    return {
      minion: cards.filter((c) => c.kind === 'minion'), spell: cards.filter((c) => c.kind === 'spell'),
      hero: outliersFromHeroes(p.heroes, heroRerollCounts(p.rows)), rune: outliersFromRunes(p.runes, offerShownCounts(p.rows, 'rune')),
      quest: questOutliers(p.rows, p.keyOf), ancient: anc.ancients, pairing: anc.pairings,
    } as Record<OutlierKind, OutlierItem[]>;
  }, [p.cards, p.heroes, p.runes, p.rows, p.keyOf]);
  const rates = useMemo(() => Object.fromEntries(ORDER.map((k) => [k, rateRows(items[k])])) as Record<OutlierKind, RateRow[]>, [items]);
  const universe = useMemo(() => reportUniverse(p.setId), [p.setId]);
  const reach = useMemo(() => ancientReach(p.rows), [p.rows]);
  const q = query.trim().toLowerCase();
  const match = (it: { name: string }): boolean => !q || it.name.toLowerCase().includes(q);
  const kinds = cat === 'all' ? ORDER : [cat];

  const catChips = (
    <div className="bov-chips" role="tablist" aria-label="Category">
      {(['all', ...ORDER] as const).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={cat === k} className={`bov-chip${cat === k ? ' on' : ''}`} onClick={() => { sfx.tick(); setCat(k); }}>
          {k === 'all' ? 'All' : KIND_LABEL[k]}
          {k !== 'all' && <small>{items[k].length}</small>}
        </button>
      ))}
      <input className="bov-search" type="search" placeholder="Find by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find by name" />
    </div>
  );
  const moreBtn = (k: OutlierKind, needed: boolean) => (cat === 'all' && needed ? (
    <button type="button" className="bov-more" onClick={() => { sfx.tick(); setShowAll((s) => ({ ...s, [k]: !s[k] })); }}>{showAll[k] ? 'Top 6' : 'Show all'}</button>
  ) : null);

  if (p.view === 'outliers') {
    return (
      <div className="bov">
        <div className="bov-bar">
          {catChips}
          <div className="bov-chips" role="group" aria-label="Evidence">
            <button type="button" className={`bov-chip${minEv === 'candidate' ? ' on' : ''}`} onClick={() => { sfx.tick(); setMinEv('candidate'); }}>Candidate and up</button>
            <button type="button" className={`bov-chip${minEv === 'supported' ? ' on' : ''}`} onClick={() => { sfx.tick(); setMinEv('supported'); }}>Supported only</button>
            <button type="button" className={`bov-chip${showThin ? ' on' : ''}`} onClick={() => { sfx.tick(); setShowThin((v) => !v); }}>Show thin rows</button>
          </div>
        </div>
        <p className="bov-lede">
          <b>Finish vs. passed</b>: how many places <b className="pos">better</b> (a higher finish, closer to 1st) or <b className="neg">worse</b> runs that took it finished than
          comparable runs that were offered it and passed. <b className="mute">Grey</b> means no clear difference (the 95% interval crosses zero). Only rows with enough
          evidence are ranked; nothing is centred. Associations among the runs observed, not proven effects. <b>Shown</b> and <b>Bought</b> count every offer and every buy;
          <b> Offered</b> counts runs. Click a row for the full read.
        </p>
        {p.derivedLoading && <div className="bov-loading">Loading the derived streams: minion and spell comparisons fill in when they land.</div>}
        {kinds.map((k) => {
          const list = items[k].filter(match);
          const r = rankOutliers(list, minEv);
          const ranked = r.over.length + r.under.length + r.even.length;
          const all = !!showAll[k] || cat !== 'all';
          const lim = all ? Infinity : 6;
          return (
            <section key={k} className="bov-cat">
              <header>
                <h3>{KIND_LABEL[k]}</h3>
                <span className="bov-sum">{list.length} in the data · {ranked} ranked · {r.thin.length} thin</span>
                {moreBtn(k, r.over.length > 6 || r.under.length > 6)}
              </header>
              {ranked === 0 ? (
                <div className="bov-none">No {KIND_ONE[k]} has {minEv === 'supported' ? 'supported' : 'enough'} evidence yet ({list.length} with data). {r.thin.length > 0 ? 'See the thin rows.' : ''}</div>
              ) : (
                <>
                  <h4 className="pos">Finished better than passers <small>{r.over.length}</small></h4>
                  <ItemTable kind={k} items={r.over.slice(0, lim)} open={open} onToggle={onToggle} empty="None at this evidence." />
                  <h4 className="neg">Finished worse than passers <small>{r.under.length}</small></h4>
                  <ItemTable kind={k} items={r.under.slice(0, lim)} open={open} onToggle={onToggle} empty="None at this evidence." />
                </>
              )}
              {(showThin || cat !== 'all') && r.thin.length > 0 && (
                <div className="bov-thinwrap">
                  <h4>Thin: not ranked <small>{r.thin.length}</small></h4>
                  <ItemTable kind={k} items={r.thin.slice(0, all ? Infinity : 12)} open={open} onToggle={onToggle} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  if (p.view === 'rates') {
    return (
      <div className="bov">
        <div className="bov-bar">{catChips}</div>
        <p className="bov-lede">
          <b>Take rate per offer</b> against the item's <b>peer group</b> (the same Shop tier for minions and spells, the same forge for runes, the same quest tier,
          all heroes, all Ancients, the same hero's six pairings), pooled over the OTHER items so nothing props up its own average. Ranked only from {RATE_MIN_OFFERED} offers.
          The gold tick on each bar is the peer average; <b>not clear</b> means the peer average sits inside the item's own 95% range. Click a row for the read.
        </p>
        {kinds.map((k) => {
          const rr = rankRates(rates[k].filter((r) => match(r.item)));
          const all = !!showAll[`r${k}`] || cat !== 'all';
          const lim = all ? Infinity : 6;
          return (
            <section key={k} className="bov-cat">
              <header>
                <h3>{KIND_LABEL[k]}</h3>
                <span className="bov-sum">{rr.more.length + rr.less.length} ranked · {rr.thin} under {RATE_MIN_OFFERED} offers or without peers</span>
                {cat === 'all' && (rr.more.length > 6 || rr.less.length > 6) && (
                  <button type="button" className="bov-more" onClick={() => { sfx.tick(); setShowAll((s) => ({ ...s, [`r${k}`]: !s[`r${k}`] })); }}>{showAll[`r${k}`] ? 'Top 6' : 'Show all'}</button>
                )}
              </header>
              <h4 className="pos">Taken more than peers <small>{rr.more.length}</small></h4>
              <RateTable kind={k} rows={rr.more.slice(0, lim)} open={open} onToggle={onToggle} empty="None above their peers yet." />
              <h4 className="neg">Taken less than peers <small>{rr.less.length}</small></h4>
              <RateTable kind={k} rows={rr.less.slice(0, lim)} open={open} onToggle={onToggle} empty="None below their peers yet." />
            </section>
          );
        })}
      </div>
    );
  }

  if (p.view === 'gaps') {
    return (
      <div className="bov">
        <div className="bov-bar">{catChips}</div>
        <p className="bov-lede">
          <b>Never picked</b>: shown at least {NEVER_MIN_OFFERED} times and never taken. <b>Rarely picked</b>: shown at least {RARE_MIN_OFFERED} times and
          taken in {RARE_MAX_RATE}% of offers or fewer. <b>Never offered</b>: in the {p.setName} pool but never shown in these runs; a long list here, or a
          low-tier card on it, can mean a pool or gating bug.
        </p>
        {kinds.map((k) => {
          const list = items[k];
          const g = pickGaps(list);
          const never = g.never.filter(match), rarely = g.rarely.filter(match);
          const missing = neverOffered(universe.filter((u) => u.kind === k), list).filter(match);
          if (never.length + rarely.length + missing.length === 0 && cat === 'all') return null;
          const v = VERB[k].toLowerCase();
          return (
            <section key={k} className="bov-cat">
              <header><h3>{KIND_LABEL[k]}</h3><span className="bov-sum">{list.length} shown at least once · {universe.filter((u) => u.kind === k).length} in the pool</span></header>
              <div className="bov-gapgrid">
                <GapList title="Never picked" tone="neg" items={never} sub={(it) => `shown ${it.shown}×, ${v} 0`} empty="Everything shown enough was taken at least once." open={open} onToggle={onToggle} extra={g.neverThin > 0 ? `${g.neverThin} more never taken but shown under ${NEVER_MIN_OFFERED} times` : undefined} />
                <GapList title="Rarely picked" tone="warn" items={rarely} sub={(it) => `${v} ${it.takenEvents} of ${it.shown} offers (${pct(it.takeRate)})`} empty="Nothing under the rare gate." open={open} onToggle={onToggle} />
                <MissingList entries={missing} kind={k} />
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return <AncientsView items={items} reach={reach} open={open} onToggle={onToggle} universe={universe} setId={p.setId} />;
}

function GapList({ title, tone, items, sub, empty, open, onToggle, extra }: {
  title: string; tone: string; items: OutlierItem[]; sub: (it: OutlierItem) => string; empty: string; open: string | null; onToggle: (k: string) => void; extra?: string;
}) {
  return (
    <div className="bov-gap">
      <h4 className={tone}>{title} <small>{items.length}</small></h4>
      {items.length === 0 ? <div className="bov-none">{empty}</div> : (
        <ul>
          {items.map((it) => {
            const k = `${it.kind}:${it.id}`;
            return (
              <li key={k} className={open === k ? 'open' : ''}>
                <button type="button" className="bov-gapbtn" aria-expanded={open === k} onClick={() => { sfx.tick(); onToggle(k); }}>
                  <Thumb kind={it.kind} id={it.id} heroId={it.heroId} ancientId={it.ancientId} name={it.name} />
                  <span className="bov-nm"><b>{it.name}</b><small>{sub(it)}{it.tier != null ? ` · T${it.tier}` : ''}</small></span>
                </button>
                {open === k && <RowDetail it={it} />}
              </li>
            );
          })}
        </ul>
      )}
      {extra && <div className="bov-foot">{extra}</div>}
    </div>
  );
}

function MissingList({ entries, kind }: { entries: UniverseEntry[]; kind: OutlierKind }) {
  return (
    <div className="bov-gap">
      <h4 className="mute">Never offered <small>{entries.length}</small></h4>
      {entries.length === 0 ? <div className="bov-none">Every {KIND_ONE[kind]} in the pool was offered at least once.</div> : (
        <ul className="bov-missing">
          {entries.map((u) => (
            <li key={u.id}>
              <span className="bov-gapbtn static">
                <Thumb kind={u.kind} id={u.id} heroId={u.heroId} ancientId={u.ancientId} name={u.name} />
                <span className="bov-nm"><b>{u.name}</b><small>{u.tier != null ? `T${u.tier}` : ''}{u.tier != null && u.tribe ? ' · ' : ''}{capTribe(u.tribe)}</small></span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Ancients ───────────────────────────────────────────────────────────────────────────────────────────────

function AncientsView({ items, reach, open, onToggle, universe, setId }: {
  items: Record<OutlierKind, OutlierItem[]>; reach: AncientReach; open: string | null; onToggle: (k: string) => void; universe: UniverseEntry[]; setId: SetId;
}) {
  const [cell, setCell] = useState<string | null>(null);
  const pairById = useMemo(() => new Map(items.pairing.map((p) => [p.id, p])), [items.pairing]);
  const heroes = useMemo(() => {
    const ids = new Set(universe.filter((u) => u.kind === 'hero').map((u) => u.id));
    for (const p of items.pairing) if (p.heroId) ids.add(p.heroId);
    return [...ids].sort((a, b) => {
      const na = ANCIENT_IDS.reduce((s, x) => s + (pairById.get(`${a}|${x}`)?.offered ?? 0), 0);
      const nb = ANCIENT_IDS.reduce((s, x) => s + (pairById.get(`${b}|${x}`)?.offered ?? 0), 0);
      return nb - na || getHero(a).name.localeCompare(getHero(b).name);
    });
  }, [universe, items.pairing, pairById]);
  // Ranked (gated) Ancients by finish, then the thin ones: a thin row never tops the list.
  const ancRank = useMemo(() => { const r = rankOutliers(items.ancient, 'candidate'); return [...r.over, ...r.even, ...r.under.reverse(), ...r.thin]; }, [items.ancient]);
  if (reach.enabledRuns === 0) {
    return (
      <div className="bov">
        <div className="bov-none big">No runs in this scope played with Ancients{setId === 'set1' ? ' (Set 1 has no Ancients)' : ''}. Ancients went live on 2026-11-17; rows from before read as no data.</div>
      </div>
    );
  }
  const share = (n: number, d: number): string => (d > 0 ? `${Math.round((100 * n) / d)}%` : '–');
  const maxWave = Math.max(1, ...reach.offerWaves);
  const sel = cell ? pairById.get(cell) : undefined;
  return (
    <div className="bov">
      <div className="bov-funnel">
        <div><b>{reach.enabledRuns}</b><span>runs with Ancients on</span></div>
        <i aria-hidden="true">→</i>
        <div><b>{reach.reached}</b><span>reached the pick ({share(reach.reached, reach.enabledRuns)})</span></div>
        <i aria-hidden="true">→</i>
        <div><b>{reach.picked}</b><span>picked one</span></div>
        <div className="bov-funnel-sep" />
        <div><b>{reach.neverReached}</b><span>never filled the meter</span></div>
        <div><b>{reach.avgOfferWave ?? '–'}</b><span>average offer turn</span></div>
        <div className="bov-waves" aria-label="Offer turn spread">
          {reach.offerWaves.map((n, w) => (w === 0 ? null : <span key={w} className="bov-wave"><span style={{ transform: `scaleY(${n / maxWave})` }} /><small>{w}</small></span>))}
        </div>
      </div>
      <p className="bov-lede">
        Offers: {reach.offerLive} recorded live, {reach.offerRebuilt} rebuilt from the run seed (uploaded before live offer capture on 2026-11-19, exact because the
        offer is seeded){reach.pickNoOffer > 0 ? `, ${reach.pickNoOffer} picks with no offer record (counted, outside the comparison)` : ''}. Finish vs. passed compares the pick
        with runs offered the same Ancient that picked another, within the same round band of the offer. Never filling the meter is a survival outcome and is not compared.
      </p>
      <section className="bov-cat">
        <header><h3>Ancients</h3><span className="bov-sum">all six: ranked rows best finish first, thin rows last and dimmed</span></header>
        <ItemTable kind="ancient" items={ancRank} open={open} onToggle={onToggle} />
      </section>
      <section className="bov-cat">
        <header><h3>Hero × Ancient</h3><span className="bov-sum">pick rate when offered; colour = a clear finish difference (green better, red worse); ✕ = offered 3+ times, never picked</span></header>
        <div className="bov-matrix" role="grid" style={{ ['--bov-cols' as string]: ANCIENT_IDS.length }}>
          <div className="bov-mrow bov-mhead" role="row">
            <span className="bov-mhero" role="columnheader">Hero</span>
            {ANCIENT_IDS.map((a) => (
              <span key={a} role="columnheader" className="bov-mcol">
                <Thumb kind="ancient" id={a} name={ANCIENTS[a].name} />
                <small style={{ color: ANCIENTS[a].color }}>{ANCIENTS[a].name.replace(/^Ancient of /, '')}</small>
              </span>
            ))}
          </div>
          {heroes.map((h) => (
            <div key={h} className="bov-mrow" role="row">
              <span className="bov-mhero" role="rowheader"><Thumb kind="hero" id={h} name={getHero(h).name} /><b>{getHero(h).name}</b></span>
              {ANCIENT_IDS.map((a) => {
                const it = pairById.get(`${h}|${a}`);
                const never = !!it && it.taken === 0 && it.offered >= NEVER_MIN_OFFERED;
                const k = `${h}|${a}`;
                return (
                  <button key={a} type="button" role="gridcell" className={`bov-cell ${it ? heat(it) : 'h0'}${never ? ' never' : ''}${!it ? ' empty' : ''}${cell === k ? ' on' : ''}`}
                    disabled={!it} aria-label={it ? `${it.name}: ${it.takeRate ?? 0}% of ${it.offered} offers` : `${getHero(h).name} and ${ANCIENTS[a].name}: never offered`}
                    onClick={() => { sfx.tick(); setCell((c) => (c === k ? null : k)); }}>
                    {it ? (<><b>{never ? '✕' : `${it.takeRate ?? 0}%`}</b><small>{it.offered}</small></>) : <small>·</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {sel && <div className="bov-cellread"><b>{sel.name}</b><RowDetail it={sel} /></div>}
      </section>
    </div>
  );
}
