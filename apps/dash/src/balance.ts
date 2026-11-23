// THE DEV BALANCE VIEW (owner 2026-11-22: "this will become our new dev balance view"): heroes, tribes, Ancients from
// ranked Career rows; minions, spells and runes from run telemetry at EQUAL ACCESS. The method and the words are the
// in-game Balance Report's (packages/sim/src/reportCohorts.ts, playerReport.ts; owner ruling 2026-09-22): a "had it vs
// everyone else" gap is a survival statistic, so a card is compared with the runs that were OFFERED it and passed, a rune
// with the runs offered it at the forge that skipped it. These are RAW associations at equal access, not causal and not
// round-band adjusted; the page says so. The evidence gates and the Welch interval are the report's own numbers.
import { miniBar, trendSpark } from './charts';
import { esc, int, minusDays, pct, place, titleCase } from './format';
import { LOW_SAMPLE, section, stat, type Ctx } from './sections';
import type { BalanceData, BalanceRow, TrendItem } from './types';

// ── The report's gates (packages/sim/src/playerReport.ts) ──────────────────────────────────────────────────────
export const WELCH_MIN_N = 5;
export const EVIDENCE_GATES = { candidate: { n: 10, players: 3 }, supported: { n: 20, players: 5 } } as const;
export type Evidence = 'insufficient' | 'candidate' | 'supported';

export interface Item {
  id: string; seen: number; taken: number; takenPlayers: number; takenAvg: number | null; takenVar: number | null; takenTop4: number | null;
  passed: number; passedPlayers: number; passedAvg: number | null; passedVar: number | null;
  finalN: number; finalAvg: number | null; finalGolden: number; series: Array<{ t: string; games: number; avgPlacement: number }>;
}
export const itemOf = (r: BalanceRow): Item => ({
  id: r[0], seen: r[1], taken: r[2], takenPlayers: r[3], takenAvg: r[4], takenVar: r[5], takenTop4: r[6], passed: r[7], passedPlayers: r[8],
  passedAvg: r[9], passedVar: r[10], finalN: r[11], finalAvg: r[12], finalGolden: r[13], series: (r[14] ?? []).map(([t, games, avg]) => ({ t, games, avgPlacement: avg })),
});

/** Evidence: both sides need the runs AND distinct players (one player's many runs is still one voice). */
export function evidenceOf(i: Pick<Item, 'taken' | 'passed' | 'takenPlayers' | 'passedPlayers'>): Evidence {
  const ok = (g: { n: number; players: number }) => i.taken >= g.n && i.passed >= g.n && i.takenPlayers >= g.players && i.passedPlayers >= g.players;
  return ok(EVIDENCE_GATES.supported) ? 'supported' : ok(EVIDENCE_GATES.candidate) ? 'candidate' : 'insufficient';
}

/** Passed minus taken average place (positive = taken finished HIGHER) with a 95% Welch interval; null under 5 a side. */
export function welch(i: Pick<Item, 'taken' | 'passed' | 'takenAvg' | 'passedAvg' | 'takenVar' | 'passedVar'>): { diff: number; lo: number; hi: number } | null {
  if (i.taken < WELCH_MIN_N || i.passed < WELCH_MIN_N || i.takenAvg == null || i.passedAvg == null) return null;
  const se = Math.sqrt((i.takenVar ?? 0) / i.taken + (i.passedVar ?? 0) / i.passed);
  const diff = i.passedAvg - i.takenAvg;
  return { diff, lo: diff - 1.96 * se, hi: diff + 1.96 * se };
}

/** The report's v2 wording: "1.1 better" / "0.6 worse" (places), "no clear difference", or "insufficient comparable data". */
export function verdictOf(i: Item): { text: string; cls: 'pos' | 'neg' | 'flat' | 'na'; evidence: Evidence } {
  const evidence = evidenceOf(i);
  const w = welch(i);
  if (!w || i.passed === 0) return { text: 'insufficient comparable data', cls: 'na', evidence };
  if (evidence === 'insufficient' || (w.lo <= 0 && w.hi >= 0)) return { text: 'no clear difference', cls: 'flat', evidence };
  return w.diff > 0 ? { text: `${w.diff.toFixed(1)} better`, cls: 'pos', evidence } : { text: `${Math.abs(w.diff).toFixed(1)} worse`, cls: 'neg', evidence };
}

// ── Views, filters, sorting ───────────────────────────────────────────────────────────────────────────────────
export const BAL_VIEWS = ['heroes', 'tribes', 'ancients', 'minions', 'spells', 'runes'] as const;
export type BalView = (typeof BAL_VIEWS)[number];
export const BAL_VIEW_LABEL: Record<BalView, string> = { heroes: 'Heroes', tribes: 'Tribes', ancients: 'Ancients', minions: 'Minions', spells: 'Spells', runes: 'Runes' };
export const BAL_MODES = [['ranked', 'Ranked lobby'], ['unrated', 'Unrated lobby'], ['all', 'All lobby']] as const;

export interface BalFilter { view: BalView; tribe: string; tier: number; min: number; sort: string; dir: number }
export const DEFAULT_FILTER: BalFilter = { view: 'minions', tribe: '', tier: 0, min: 10, sort: 'taken', dir: -1 };

export interface CardMeta { name: string; tier: number; tribe: string; tribe2?: string; spell: boolean; art: string | null }

/** The cards / runes the current view shows: kind, set, tribe, tier and minimum-sample filters, then the sort. */
export function rowsFor(b: BalanceData, f: BalFilter, cards: Record<string, CardMeta> | undefined, setCards: string[] | null): Item[] {
  const kind = f.view === 'runes' ? 'rune' : 'card';
  let items = (b.items[kind] ?? []).map(itemOf);
  if (kind === 'card') {
    const inSet = setCards ? new Set(setCards) : null;
    items = items.filter((i) => {
      const m = cards?.[i.id];
      if (!m) return f.view === 'minions' && !inSet; // unknown ids only when no set is chosen
      if ((f.view === 'spells') !== m.spell) return false;
      if (inSet && !inSet.has(i.id)) return false;
      if (f.tribe && m.tribe !== f.tribe && m.tribe2 !== f.tribe) return false;
      if (f.tier && m.tier !== f.tier) return false;
      return true;
    });
  }
  items = items.filter((i) => i.taken + i.passed >= f.min);
  const key = (i: Item): number | string => {
    switch (f.sort) {
      case 'name': return (kind === 'card' ? cards?.[i.id]?.name : undefined) ?? i.id;
      case 'pick': return i.seen ? i.taken / i.seen : -1;
      case 'takenAvg': return i.takenAvg ?? 99;
      case 'diff': return welch(i)?.diff ?? -99;
      case 'players': return i.takenPlayers;
      case 'final': return i.finalN;
      case 'tier': return cards?.[i.id]?.tier ?? 0;
      default: return i.taken;
    }
  };
  return items.sort((a, z) => {
    const x = key(a), y = key(z);
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * f.dir || z.taken - a.taken;
  });
}

/** The rollup keeps up to 10 distinct players a day, so the count is exact below 10 (all the 3 / 5-player gates need). */
export const playersText = (n: number): string => (n >= 10 ? '10+' : int(n));

// ── Render ───────────────────────────────────────────────────────────────────────────────────────────────────
const EVIDENCE_LABEL: Record<Evidence, string> = { insufficient: 'Insufficient evidence', candidate: 'Candidate', supported: 'Supported' };

function trendTable(kind: 'hero' | 'tribe' | 'ancient', rows: TrendItem[], b: BalanceData, c: Ctx): string {
  const lead = (id: string) => kind === 'hero' ? c.heroCell(id) : kind === 'tribe' ? c.tribeCell(id)
    : `<span class="dk-hero">${c.names?.ancients[id]?.art ? c.img(c.names.ancients[id]!.art!, 'dk-icon', 36) : ''}<span class="dk-heroname">${esc(c.names?.ancients[id]?.name ?? titleCase(id))}</span></span>`;
  if (rows.length === 0) return '<p class="dk-empty">Nothing in this range.</p>';
  const field = b.field.avg;
  return `<div class="dk-tablewrap"><table><thead><tr><th>${kind === 'hero' ? 'Hero' : kind === 'tribe' ? 'Final-board tribe' : 'Ancient'}</th><th>Games</th><th>Avg place</th><th>vs field</th><th>Top 4</th><th>Avg place per ${b.trendBucket} <span class="dk-sub">(up is better)</span></th></tr></thead><tbody>${rows.map((r) => {
    const d = field == null ? null : field - r.avgPlacement;
    return `<tr class="${r.games < LOW_SAMPLE ? 'low' : ''}"><td>${lead(r.id)}</td><td class="dk-num">${int(r.games)}</td><td>${place(r.avgPlacement)}</td>
      <td>${d == null ? 'n/a' : `<span class="dk-drift ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${d.toFixed(2)}</span>`}</td><td>${pct(r.top4Rate)}</td><td>${trendSpark(r.series, 140)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function itemTable(view: BalView, items: Item[], f: BalFilter, c: Ctx, cards: Record<string, CardMeta> | undefined): string {
  if (items.length === 0) return `<p class="dk-empty">No ${BAL_VIEW_LABEL[view].toLowerCase()} with ${f.min}+ observations under these filters.</p>`;
  const rune = view === 'runes';
  const lead = (id: string) => {
    if (rune) { const n = c.names?.runes[id]; return `<span class="dk-hero">${n?.art ? c.img(n.art, 'dk-icon', 36) : ''}<span class="dk-heroname">${esc(n?.name ?? titleCase(id))}</span></span>`; }
    const m = cards?.[id];
    const tribes = m ? [m.tribe, m.tribe2].filter((t): t is string => !!t && t !== 'neutral') : [];
    return `<span class="dk-hero">${m?.art ? c.img(m.art, 'dk-icon', 36) : ''}<span class="dk-cardwho"><span class="dk-heroname">${esc(m?.name ?? id)}</span>
      <span class="dk-sub">${m ? `Tier ${m.tier}${tribes.length ? ` · ${tribes.map((t) => esc(titleCase(t))).join(' / ')}` : ''}` : 'not in this build'}</span></span></span>`;
  };
  const maxPick = Math.max(...items.map((i) => (i.seen ? i.taken / i.seen : 0)));
  const th = (k: string, label: string) => `<th${f.sort === k ? ` aria-sort="${f.dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-bsort="${k}">${label}</button></th>`;
  const takenWord = rune ? 'Picked' : 'Taken';
  return `<div class="dk-tablewrap"><table class="dk-baltable"><thead><tr>${th('name', rune ? 'Rune' : 'Card')}${th('taken', `${takenWord} runs`)}${th('pick', rune ? 'Pick rate' : 'Take rate')}${th('players', 'Players')}${th('takenAvg', `Avg place ${takenWord.toLowerCase()}`)}<th>Avg place ${rune ? 'skipped' : 'passed'}</th>${th('diff', 'Raw association at equal access')}${rune ? '' : th('final', 'On final board')}<th>${takenWord} per bucket</th></tr></thead><tbody>${items.map((i) => {
    const v = verdictOf(i);
    const pick = i.seen ? i.taken / i.seen : null;
    return `<tr class="${v.evidence === 'insufficient' ? 'low' : ''}"><td>${lead(i.id)}</td><td class="dk-num">${int(i.taken)} <span class="dk-sub">of ${int(i.seen)}</span></td>
      <td><span class="bar">${pct(pick)}${miniBar(pick, maxPick)}</span></td><td>${playersText(i.takenPlayers)}</td>
      <td>${place(i.takenAvg)}</td><td>${place(i.passedAvg)} <span class="dk-sub">n ${int(i.passed)}</span></td>
      <td><span class="dk-verdict ${v.cls}">${esc(v.text)}</span><span class="dk-ev ${v.evidence}">${EVIDENCE_LABEL[v.evidence]}</span></td>
      ${rune ? '' : `<td>${i.finalN ? `${int(i.finalN)} <span class="dk-sub">avg ${place(i.finalAvg)}${i.finalGolden ? ` · ${int(i.finalGolden)} golden` : ''}</span>` : '<span class="dk-sub">none</span>'}</td>`}
      <td>${i.series.length > 1 ? trendSpark(i.series, 120) : '<span class="dk-sub">under 10 runs</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/** Cards and runes come from the nightly rollup (one UTC day at a time) plus today live: say which days that covers when
 *  the history is still filling (null = nothing rolled up yet), so a thin read is never mistaken for a quiet game. */
export function rollupNote(b: Pick<BalanceData, 'rolledThrough' | 'rolledFrom' | 'to'>, f: Pick<BalFilter, 'view'>): string {
  if (f.view !== 'minions' && f.view !== 'spells' && f.view !== 'runes') return '';
  if (!b.rolledThrough) return '<div class="dk-note dk-warn"><b>Card and rune history is still being rolled up.</b> Only today shows for now; the nightly job adds up to 14 past days a night.</div>';
  // behind = the last rolled-up day is before the day before the range end (the nightly run fills yesterday at 03:47 UTC)
  if (b.rolledThrough < minusDays(b.to, 1)) return `<div class="dk-note dk-warn"><b>Card and rune history covers ${esc(b.rolledFrom ?? '?')} to ${esc(b.rolledThrough)} (UTC) plus today</b>; the days after that fill in nightly (up to 14 a night).</div>`;
  return '';
}

export function renderBalance(b: BalanceData, c: Ctx, f: BalFilter, opts: { set: string; liveSet: string }): string {
  const cards = c.names?.cards;
  const setCards = opts.set ? c.names?.setCards?.[opts.set] ?? null : null;
  const sets = c.names?.sets ?? {};
  const isCard = f.view === 'minions' || f.view === 'spells';
  const tribes = Object.keys(c.game?.tribes ?? {}).filter((t) => t !== 'neutral');
  const select = (id: string, label: string, opts2: Array<[string, string]>, cur: string) =>
    `<label class="dk-field"><span class="dk-label">${label}</span><select class="dk-well" id="${id}">${opts2.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const items = isCard || f.view === 'runes' ? rowsFor(b, f, cards, setCards) : [];
  const trendKind = f.view === 'heroes' ? 'hero' : f.view === 'tribes' ? 'tribe' : 'ancient';
  const body = isCard || f.view === 'runes' ? itemTable(f.view, items, f, c, cards) : trendTable(trendKind, b.trends[trendKind] ?? [], b, c);
  const method = f.view === 'runes'
    ? 'Runs that picked the rune against runs offered it at the forge that skipped it (equal forge access).'
    : isCard ? 'Runs that took the card (shop or Discover) against runs whose shop or Discovers showed it and passed (equal access). One observation per run.'
      : f.view === 'tribes' ? 'Every ranked game by the final board\'s top tribe, against the field.' : 'Every game with it, against the field.';
  return `
    ${rollupNote(b, f)}
    <div class="dk-note dk-in"><b>Association, not causation.</b> ${esc(method)} These are raw associations: not adjusted for the round the card was offered or the shop tier
      (the in-game Balance Report does that from each run's replay). Read a difference only when the evidence is Candidate or Supported and the interval clears zero.
      Lower place is better; "better" means the takers finished higher.</div>
    <div class="dk-filterrow dk-balfilters">
      <div class="dk-field"><span class="dk-label">Mode</span><div class="dk-tabs" id="bal-mode" role="group" aria-label="Mode">${BAL_MODES.map(([v, l]) => `<button type="button" class="dk-tab" data-v="${v}" aria-pressed="${v === b.mode}">${l}</button>`).join('')}</div></div>
      ${select('bal-set', 'Set', [['', 'All sets'], ...Object.entries(sets).map(([id, s]): [string, string] => [id, `${s.name}${id === opts.liveSet ? ' (live)' : ''}`])], opts.set)}
      ${isCard ? select('bal-tribe', 'Tribe', [['', 'Any tribe'], ...tribes.map((t): [string, string] => [t, c.game?.tribes[t]?.name ?? titleCase(t)]), ['neutral', 'Neutral']], f.tribe) : ''}
      ${isCard ? select('bal-tier', 'Tier', [['0', 'Any tier'], ...[...new Set(Object.values(cards ?? {}).map((m) => m.tier))].sort((a, z) => a - z).map((t): [string, string] => [String(t), `Tier ${t}`])], String(f.tier)) : ''}
      ${isCard || f.view === 'runes' ? select('bal-min', 'Min sample', [5, 10, 20, 50].map((n): [string, string] => [String(n), `${n}+ runs`]), String(f.min)) : ''}
    </div>
    <div class="dk-stats dk-stats-4">
      ${stat('Lobby runs read', int(b.runs), 'Run telemetry: cards and runes')}
      ${stat('Career games read', int(b.games), 'Heroes, tribes, Ancients, final boards')}
      ${stat('Field average place', place(b.field.avg), `Top 4 ${pct(b.field.top4)} of runs`)}
      ${stat(isCard || f.view === 'runes' ? `${BAL_VIEW_LABEL[f.view]} shown` : 'Trend', isCard || f.view === 'runes' ? int(items.length) : b.trendBucket === 'week' ? 'Weekly' : 'Monthly', isCard || f.view === 'runes' ? `${items.filter((i) => evidenceOf(i) !== 'insufficient').length} with enough evidence` : 'Average place per bucket')}
    </div>
    ${section('Balance', `${esc(BAL_MODES.find(([v]) => v === b.mode)?.[1] ?? b.mode)} · ${esc(opts.set ? sets[opts.set]?.name ?? opts.set : 'all sets')} · dim rows: insufficient evidence`,
      `<div class="dk-tabs" id="bal-view" role="group" aria-label="Balance view">${BAL_VIEWS.map((v) => `<button type="button" class="dk-tab" data-v="${v}" aria-pressed="${v === f.view}">${BAL_VIEW_LABEL[v]}</button>`).join('')}</div>${body}`)}`;
}
