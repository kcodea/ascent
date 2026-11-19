import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  ANCIENTS, ANCIENT_IDS, EVIDENCE_GATES, NEVER_MIN_OFFERED, RARE_MAX_RATE, RARE_MIN_OFFERED,
  ancientOutliers, ancientReach, getHero, neverOffered, outlierSentence, outliersFromCards, outliersFromHeroes, outliersFromRunes,
  pickGaps, questOutliers, rankOutliers, reportUniverse,
  type AncientId, type AncientReach, type CardImpactRow, type CohortRow, type EvidenceLabel, type HeroImpactRow, type OutlierItem,
  type OutlierKind, type PlayerKeyOf, type RuneImpactRow, type UniverseEntry,
} from '@game/sim';
import type { SetId } from '@game/content';
import { ancientArt, artFor, heroArt, questArt, runeArt } from '../art';
import { sfx } from '../sfx';
import './balanceOverview.css';

/**
 * THE AT-A-GLANCE BALANCE REPORT (owner ask 2026-11-19: "i want to immediately be able to recognize over or
 * underperforming cards/heroes/ancients, as well as options and cards that are simply never picked or purchased").
 * Three views over the rows the panel already scoped (set, epoch, window, regime, build, sensitivity, hero slice):
 *  · OUTLIERS: per category, the over- and under-performers by `gain` (places better than the comparable runs that
 *    passed), GATED on evidence so a thin row is never ranked. Each row expands to its plain-words read.
 *  · NEVER PICKED: offered and never / rarely taken, and set content never offered at all (a pool-bug tripwire).
 *  · ANCIENTS: the reach funnel, the six Ancients, and the hero x Ancient pick-rate matrix.
 * All math is `@game/sim` (`reportOutliers.ts`), computed once per scope in the memos below; rows are memoised.
 */

export type OverviewView = 'outliers' | 'gaps' | 'ancients';

const KIND_LABEL: Record<OutlierKind, string> = { minion: 'Minions', spell: 'Spells', hero: 'Heroes', ancient: 'Ancients', pairing: 'Hero × Ancient', rune: 'Runes', quest: 'Quests' };
const KIND_ONE: Record<OutlierKind, string> = { minion: 'minion', spell: 'spell', hero: 'hero', ancient: 'Ancient', pairing: 'pairing', rune: 'rune', quest: 'quest' };
const TAKE_WORD: Record<OutlierKind, string> = { minion: 'Buy rate', spell: 'Buy rate', hero: 'Pick rate', ancient: 'Pick rate', pairing: 'Pick rate', rune: 'Take rate', quest: 'Take rate' };
const EV_TEXT: Record<EvidenceLabel, string> = { supported: 'Supported', candidate: 'Candidate', insufficient: 'Thin' };
const COMPARISON: Record<OutlierKind, string> = {
  minion: 'bought vs offered and passed, inside the first affordable Shop offer, same round band and Shop tier',
  spell: 'bought vs offered and passed, inside the first affordable Shop offer, same round band and Shop tier',
  hero: 'chosen vs offered and chose another hero',
  ancient: 'picked vs offered and picked another, same round band of the offer',
  pairing: 'picked vs offered and picked another, same round band of the offer',
  rune: 'taken vs offered and skipped',
  quest: 'taken vs offered and skipped',
};
const ORDER: OutlierKind[] = ['minion', 'spell', 'hero', 'ancient', 'pairing', 'rune', 'quest'];

const capTribe = (t: string | undefined): string => (t ? t.split('/').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('/') : '');
const signed1 = (n: number | null): string => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(1)}`);

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

/** The diverging effect plot: a dot at the gain on a fixed -2 to +2 places axis, with its 95% whisker. Static SVG. */
const SPAN = 2;
const EffectPlot = memo(function EffectPlot({ gain, ci, evidence }: { gain: number | null; ci: OutlierItem['ci']; evidence: EvidenceLabel }) {
  const W = 132, H = 20, mid = W / 2;
  const x = (v: number): number => mid + (Math.max(-SPAN, Math.min(SPAN, v)) / SPAN) * (mid - 6);
  const cls = gain == null ? 'none' : gain > 0 ? 'pos' : gain < 0 ? 'neg' : 'zero';
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

const RateBar = memo(function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="bov-rate">
      <span className="bov-ratebar" aria-hidden="true"><span style={{ transform: `scaleX(${(rate ?? 0) / 100})` }} /></span>
      <b>{rate == null ? '–' : `${rate}%`}</b>
    </span>
  );
});

/** A heat class on the size of the gain, read only for ranked (gated) rows. */
const heat = (it: OutlierItem): string => {
  if (it.gain == null || it.evidence === 'insufficient') return 'h0';
  const a = Math.abs(it.gain);
  const lvl = a >= 1 ? 3 : a >= 0.5 ? 2 : a >= 0.2 ? 1 : 0;
  return `${it.gain > 0 ? 'hp' : 'hn'}${lvl}`;
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
        <span className="bov-c-plot" role="cell"><EffectPlot gain={it.gain} ci={it.ci} evidence={it.evidence} /></span>
        <span className={`bov-c-gain ${heat(it)}`} role="cell">{signed1(it.gain)}</span>
        <span className="bov-c-rate" role="cell"><RateBar rate={it.takeRate} /></span>
        <span className="bov-c-n" role="cell">{it.takers}<i>/</i>{it.passers}</span>
        <span className="bov-c-ev" role="cell"><span className={`bov-ev ev-${it.evidence}`}>{EV_TEXT[it.evidence]}</span></span>
      </button>
      {open && <RowDetail it={it} />}
    </div>
  );
});

function RowDetail({ it }: { it: OutlierItem }) {
  const facts: [string, ReactNode][] = [
    ['Offered in', `${it.offered} runs`],
    [it.kind === 'minion' || it.kind === 'spell' ? 'Bought in' : 'Taken in', `${it.taken} runs${it.takeRate == null ? '' : ` (${it.takeRate}%)`}`],
    ['Placed runs that took it', String(it.takers)],
    ['Placed runs that passed', String(it.passers)],
    ['Players, smaller side', it.players == null ? 'n/a' : String(it.players)],
    ['Places better', signed1(it.gain)],
    ['95% interval', it.ci ? `${signed1(it.ci.lo)} to ${signed1(it.ci.hi)}` : 'not shown under 5 runs a side'],
    ['Comparison', it.basis === 'exposed' ? 'bought vs saw it in the Shop and never bought (exposed diagnostic)' : COMPARISON[it.kind]],
  ];
  return (
    <div className="bov-detail">
      <p>{outlierSentence(it)}</p>
      <dl>{facts.map(([k, v]) => <div key={k} className={k === 'Comparison' ? 'wide' : undefined}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}

function TableHead({ kind }: { kind: OutlierKind }) {
  return (
    <div className="bov-head" role="row">
      <span role="columnheader" className="bov-c-name">{KIND_LABEL[kind]}</span>
      <span role="columnheader" className="bov-c-plot" data-tip="Places better than the comparable runs that passed, on a -2 to +2 axis, with the 95% interval as a whisker. Right and green: taking it went with a higher finish.">Effect</span>
      <span role="columnheader" className="bov-c-gain" data-tip="Places better on average than the comparable runs that passed. Positive is better.">Places</span>
      <span role="columnheader" className="bov-c-rate" data-tip={`Of the runs offered it, the percent that took it (${TAKE_WORD[kind].toLowerCase()}).`}>{TAKE_WORD[kind]}</span>
      <span role="columnheader" className="bov-c-n" data-tip="Placed runs in the comparison: took it / passed.">Took / passed</span>
      <span role="columnheader" className="bov-c-ev" data-tip={`Supported: ${EVIDENCE_GATES.supported.side} runs a side and ${EVIDENCE_GATES.supported.players} players. Candidate: ${EVIDENCE_GATES.candidate.side} a side and ${EVIDENCE_GATES.candidate.players} players. Thin: under that, never ranked.`}>Evidence</span>
    </div>
  );
}

function ItemTable({ kind, items, open, onToggle, empty }: { kind: OutlierKind; items: OutlierItem[]; open: string | null; onToggle: (k: string) => void; empty?: string }) {
  return (
    <div className="bov-table" role="table">
      <TableHead kind={kind} />
      {items.length === 0 ? <div className="bov-none">{empty ?? 'Nothing here.'}</div>
        : items.map((it) => <ItemRow key={`${it.kind}:${it.id}`} it={it} open={open === `${it.kind}:${it.id}`} onToggle={onToggle} />)}
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
    const cards = outliersFromCards(p.cards);
    return {
      minion: cards.filter((c) => c.kind === 'minion'), spell: cards.filter((c) => c.kind === 'spell'),
      hero: outliersFromHeroes(p.heroes), rune: outliersFromRunes(p.runes), quest: questOutliers(p.rows, p.keyOf),
      ancient: anc.ancients, pairing: anc.pairings,
    } as Record<OutlierKind, OutlierItem[]>;
  }, [p.cards, p.heroes, p.runes, p.rows, p.keyOf]);
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
          <b className="pos">Green, right</b> means runs that took it finished higher than comparable runs that were offered it and passed;
          <b className="neg"> red, left</b> means lower. Only rows with enough evidence are ranked; thin rows sit apart, never ranked.
          Nothing is centred, so a category can read all green. Associations among the runs observed, not proven effects. Click a row for the full read.
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
                {cat === 'all' && (r.over.length > 6 || r.under.length > 6) && (
                  <button type="button" className="bov-more" onClick={() => { sfx.tick(); setShowAll((s) => ({ ...s, [k]: !s[k] })); }}>{showAll[k] ? 'Top 6' : 'Show all'}</button>
                )}
              </header>
              {ranked === 0 ? (
                <div className="bov-none">No {KIND_ONE[k]} has {minEv === 'supported' ? 'supported' : 'enough'} evidence yet ({list.length} with data). {r.thin.length > 0 ? 'See the thin rows.' : ''}</div>
              ) : (
                <div className="bov-split">
                  <div>
                    <h4 className="pos">Over-performing <small>{r.over.length}</small></h4>
                    <ItemTable kind={k} items={r.over.slice(0, lim)} open={open} onToggle={onToggle} empty="None above zero at this evidence." />
                  </div>
                  <div>
                    <h4 className="neg">Under-performing <small>{r.under.length}</small></h4>
                    <ItemTable kind={k} items={r.under.slice(0, lim)} open={open} onToggle={onToggle} empty="None below zero at this evidence." />
                  </div>
                </div>
              )}
              {showThin && r.thin.length > 0 && (
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

  if (p.view === 'gaps') {
    return (
      <div className="bov">
        <div className="bov-bar">{catChips}</div>
        <p className="bov-lede">
          <b>Never picked</b>: offered in at least {NEVER_MIN_OFFERED} runs and never taken. <b>Rarely picked</b>: offered in at least {RARE_MIN_OFFERED} runs and
          taken in {RARE_MAX_RATE}% or fewer. <b>Never offered</b>: in the {p.setName} pool but never shown in these runs; a long list here, or a
          low-tier card on it, can mean a pool or gating bug. Offer counts are once per run.
        </p>
        {kinds.map((k) => {
          const list = items[k];
          const g = pickGaps(list);
          const never = g.never.filter(match), rarely = g.rarely.filter(match);
          const missing = neverOffered(universe.filter((u) => u.kind === k), list).filter(match);
          if (never.length + rarely.length + missing.length === 0 && cat === 'all') return null;
          return (
            <section key={k} className="bov-cat">
              <header><h3>{KIND_LABEL[k]}</h3><span className="bov-sum">{list.length} offered at least once · {universe.filter((u) => u.kind === k).length} in the pool</span></header>
              <div className="bov-gapgrid">
                <GapList title="Never picked" tone="neg" items={never} sub={(it) => `offered ${it.offered}×, taken 0`} empty="Everything offered enough was taken at least once." open={open} onToggle={onToggle} extra={g.neverThin > 0 ? `${g.neverThin} more never taken but offered under ${NEVER_MIN_OFFERED} times` : undefined} />
                <GapList title="Rarely picked" tone="warn" items={rarely} sub={(it) => `${it.takeRate}% of ${it.offered} offers`} empty="Nothing under the rare gate." open={open} onToggle={onToggle} />
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
  // Ranked (gated) Ancients by places better, then the thin ones: a thin row never tops the list.
  const ancRank = useMemo(() => { const r = rankOutliers(items.ancient, 'candidate'); return [...r.over, ...r.even, ...r.under.reverse(), ...r.thin]; }, [items.ancient]);
  if (reach.enabledRuns === 0) {
    return (
      <div className="bov">
        <div className="bov-none big">No runs in this scope played with Ancients{setId === 'set1' ? ' (Set 1 has no Ancients)' : ''}. Ancients went live on 2026-11-17; rows from before read as no data.</div>
      </div>
    );
  }
  const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((100 * n) / d)}%` : '–');
  const maxWave = Math.max(1, ...reach.offerWaves);
  const sel = cell ? pairById.get(cell) : undefined;
  return (
    <div className="bov">
      <div className="bov-funnel">
        <div><b>{reach.enabledRuns}</b><span>runs with Ancients on</span></div>
        <i aria-hidden="true">→</i>
        <div><b>{reach.reached}</b><span>reached the pick ({pct(reach.reached, reach.enabledRuns)})</span></div>
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
        offer is seeded){reach.pickNoOffer > 0 ? `, ${reach.pickNoOffer} picks with no offer record (counted, outside the comparison)` : ''}. Comparisons are the pick against
        the runs offered the same Ancient that picked another, within the same round band of the offer. Never filling the meter is a survival outcome and is not compared.
      </p>
      <section className="bov-cat">
        <header><h3>Ancients</h3><span className="bov-sum">all six: ranked rows best first, thin rows last and dimmed</span></header>
        <ItemTable kind="ancient" items={ancRank} open={open} onToggle={onToggle} />
      </section>
      <section className="bov-cat">
        <header><h3>Hero × Ancient</h3><span className="bov-sum">pick rate when offered; colour = places better when the evidence allows; ✕ = offered 3+ times, never picked</span></header>
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
                const gated = !!it && it.gain != null && it.evidence !== 'insufficient';
                const k = `${h}|${a}`;
                return (
                  <button key={a} type="button" role="gridcell" className={`bov-cell ${gated ? heat(it!) : 'h0'}${never ? ' never' : ''}${!it ? ' empty' : ''}${cell === k ? ' on' : ''}`}
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
