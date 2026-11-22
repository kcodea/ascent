import './styles.css';
import { lines, miniBar, sparkline, stackedBars } from './charts';
import { MODE_ART, MODE_LABEL, SERIES, bucketLabel, dateIn, esc, int, place, pct, seriesValues, shortDay, titleCase, topHalfLabel } from './format';
import { LIVE_POLL_MS, customRange, isLive, parseHash, presetRange, rangePhrase, toHash, type Preset, type Range } from './range';
import type { Breakdown, GameData, GameMode, HeroRow, Overview, TribeRow } from './types';
import { showModeration, wireModeration } from './moderation';
import { viewOfHash, withView, type View } from './modLogic';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();
const today = (): string => dateIn(TZ);

const initial = parseHash(location.hash, today());
const state = {
  game: null as GameData | null,
  overview: null as Overview | null,
  breakdown: null as Breakdown | null,
  range: initial.range as Range,
  patch: initial.build,
  heroMode: 'ranked' as GameMode,
  heroBand: 'all',
  heroSort: { key: 'games' as keyof HeroRow | 'offer', dir: -1 },
  tribeMode: 'ranked' as GameMode,
  sample: false,
  updatedAt: 0,
  seq: 0, // the newest request; an older answer that lands late is dropped
};

// ── The game's names + art (public/game-data.json, from scripts/sync-game.mts) ──────────────────────────────
const heroName = (id: string): string => state.game?.heroes[id]?.name ?? titleCase(id);
const tribeName = (id: string): string => state.game?.tribes[id]?.name ?? titleCase(id);
const img = (src: string, cls: string, size: number, eager = false): string =>
  `<img class="${cls}" src="${esc(src)}" alt="" width="${size}" height="${size}" decoding="async"${eager ? '' : ' loading="lazy"'} />`;

function heroCell(id: string): string {
  const art = state.game?.heroes[id]?.art;
  return `<span class="dk-hero"><span class="portring"><span class="hero">${art ? img(art, '', 48) : ''}</span></span><span class="dk-heroname">${esc(heroName(id))}</span></span>`;
}
function tribeCell(id: string): string {
  const icon = state.game?.tribes[id]?.icon ?? ''; // static SVG markup generated from the game's own Icon set
  return `<span class="dk-tribe tr-${esc(id.replace(/[^a-z0-9_-]/gi, ''))}"><span class="dk-tglyph">${icon}</span>${esc(tribeName(id))}</span>`;
}
const medalArt = (medal: string): string | undefined => state.game?.medals[medal];

// ── Data ─────────────────────────────────────────────────────────────────────────────────────────────────
const ERROR_TEXT: Record<number, string> = {
  401: 'Not signed in through Cloudflare Access (or the login expired). Reload the page to sign in again.',
  403: 'This account is not on the dashboard allow-list.',
  500: 'The dashboard is not configured yet. See apps/dash/README.md for the secrets it needs.',
  502: 'The database did not answer. Try Refresh in a minute.',
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
  if (res.headers.get('x-dash-fixture') === '1') state.sample = true;
  if (!res.ok) throw Object.assign(new Error(ERROR_TEXT[res.status] ?? `Request failed (${res.status}).`), { status: res.status });
  return (await res.json()) as T;
}

function showError(e: unknown): void {
  const el = $('error');
  el.textContent = e instanceof Error ? e.message : 'Something went wrong.';
  el.hidden = false;
}

async function loadGame(): Promise<void> {
  try {
    state.game = await getJson<GameData>('/game-data.json');
  } catch {
    state.game = null; // names fall back to the ids; the numbers still show
  }
}

function rangeQuery(): URLSearchParams {
  const q = new URLSearchParams({ to: state.range.to, tz: TZ });
  if (state.range.from) q.set('from', state.range.from); // no from = all time
  return q;
}

/** Both reads follow the selected range. A live range re-reads every LIVE_POLL_MS (the server's cache length). */
async function refresh(): Promise<void> {
  const seq = ++state.seq;
  clearTimeout(liveTimer);
  $('error').hidden = true;
  const q = rangeQuery();
  const bq = rangeQuery();
  if (state.patch) bq.set('patch', state.patch);
  try {
    const [o, b] = await Promise.all([getJson<Overview>(`/api/overview?${q}`), getJson<Breakdown>(`/api/breakdown?${bq}`)]);
    if (seq !== state.seq) return;
    state.overview = o;
    state.breakdown = b;
    state.updatedAt = Date.now();
  } catch (e) {
    if (seq !== state.seq) return;
    showError(e);
  }
  render();
  scheduleLive();
}

// ── Live (a range that reaches today) ──────────────────────────────────────────────────────────────────────
let liveTimer = 0;
const live = (): boolean => isLive(state.range, today());
function scheduleLive(): void {
  clearTimeout(liveTimer);
  $('live').hidden = !live();
  if (live() && !document.hidden) liveTimer = window.setTimeout(() => void refresh(), LIVE_POLL_MS);
}
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}
function tickUpdated(): void {
  $('updated').textContent = state.updatedAt ? `Updated ${ago(Date.now() - state.updatedAt)}` : '';
}

// ── Headline tiles + series charts (all follow the range) ───────────────────────────────────────────────────
function versus(now: number, before: number | undefined, label: string): string {
  if (before == null) return '';
  const d = now - before;
  return ` · <b>${d >= 0 ? '+' : ''}${int(d)}</b> vs ${esc(label)}`;
}
function previousLabel(r: Range, o: Overview): string {
  if (r.preset === 'today') return 'yesterday so far';
  if (r.preset === 'yesterday') return 'the day before';
  const span = Math.round((Date.parse(o.to) - Date.parse(o.from)) / 86_400_000) + 1;
  return span === 1 ? 'the day before' : `the ${span} days before`;
}

function renderTiles(o: Overview): void {
  const phrase = rangePhrase(state.range, shortDay);
  const prevLbl = previousLabel(state.range, o);
  const w = Math.max(120, Math.round($('tile-games').clientWidth - 48));
  const t = o.totals;
  $('tile-games').innerHTML = `<span class="dk-statlbl">Games · ${esc(phrase)}</span><span class="dk-statval">${int(t.games)}</span>
    <span class="dk-statsub">Finished, every mode${versus(t.games, o.previous?.games, prevLbl)}</span>${sparkline(o.series.map((d) => d.games), w)}`;
  $('tile-accounts').innerHTML = `<span class="dk-statlbl">Accounts active · ${esc(phrase)}</span><span class="dk-statval">${int(t.accounts)}</span>
    <span class="dk-statsub">Distinct, finished a game${versus(t.accounts, o.previous?.accounts, prevLbl)}</span>${sparkline(o.series.map((d) => d.accounts), w)}`;
  $('tile-new').innerHTML = `<span class="dk-statlbl">New accounts · ${esc(phrase)}</span><span class="dk-statval">${int(t.newEmail + t.newGuest)}</span>
    <span class="dk-statsub"><b>${int(t.newEmail)}</b> email · <b>${int(t.newGuest)}</b> guest · <b>${int(t.firstGame)}</b> played a first game</span>${sparkline(o.series.map((d) => d.newEmail + d.newGuest), w)}`;
}

function renderSeries(o: Overview): void {
  const labels = o.series.map((p) => bucketLabel(p.t, o.bucket));
  const per = o.bucket === 'hour' ? 'hour' : o.bucket;
  $('games-title').textContent = `Games per ${per}`;
  $('accounts-title').textContent = `Accounts per ${per}`;
  $('games-aside').textContent = o.from === o.to ? `${shortDay(o.from)}, every mode` : `${shortDay(o.from)} to ${shortDay(o.to)}, every mode`;
  $('games-legend').innerHTML = SERIES.map((s) => `<span><i class="c${s.slot}"></i>${esc(s.label)}</span>`).join('');
  $('chart-games').innerHTML = stackedBars(labels, o.series.map(seriesValues), SERIES.map((s) => s.slot), Math.max(280, $('chart-games').clientWidth));
  $('accounts-legend').innerHTML = '<span><i class="c1 ln"></i>Active accounts</span><span><i class="c3 ln"></i>First game ever</span>';
  $('chart-accounts').innerHTML = lines(labels, [
    { label: 'Active accounts', values: o.series.map((d) => d.accounts), slot: 1 },
    { label: 'First game ever', values: o.series.map((d) => d.firstGame), slot: 3, dashed: true },
  ], Math.max(280, $('chart-accounts').clientWidth));
}

// ── Tooltip ──────────────────────────────────────────────────────────────────────────────────────────────
function tipHtml(chart: 'games' | 'accounts', i: number): string {
  const o = state.overview;
  const d = o?.series[i];
  if (!o || !d) return '';
  const when = esc(bucketLabel(d.t, o.bucket, true));
  if (chart === 'games') {
    const v = seriesValues(d);
    const rows = SERIES.map((s, k) => `<div class="row"><span><i class="c${s.slot}"></i>${esc(s.label)}</span><span>${v[k]}</span></div>`).join('');
    return `<div class="head">${when}: ${d.games} games</div>${rows}`;
  }
  return `<div class="head">${when}</div>
    <div class="row"><span><i class="c1"></i>Active accounts</span><span>${d.accounts}</span></div>
    <div class="row"><span><i class="c3"></i>First game ever</span><span>${d.firstGame}</span></div>
    <div class="row"><span>New email accounts</span><span>${d.newEmail}</span></div>
    <div class="row"><span>New guest accounts</span><span>${d.newGuest}</span></div>`;
}

function wireTips(): void {
  const tip = $('tip');
  for (const chart of ['games', 'accounts'] as const) {
    const el = $(`chart-${chart}`);
    el.addEventListener('pointermove', (ev) => {
      const t = ev.target as Element;
      const i = t instanceof SVGElement && t.dataset.i != null ? Number(t.dataset.i) : NaN;
      if (Number.isNaN(i)) { tip.hidden = true; return; }
      tip.innerHTML = tipHtml(chart, i);
      tip.hidden = false;
      const r = tip.getBoundingClientRect(); // the tip only, once per move; never the chart's layout
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX + 14))}px`;
      tip.style.top = `${Math.max(8, ev.clientY - r.height - 12)}px`;
    });
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
}

// ── Tabs (the kit's flat tabs: the current one white with the gold underline) ───────────────────────────────
function tabs(el: HTMLElement, items: Array<{ value: string; label: string; art?: string }>, current: string): string {
  const pick = items.some((o) => o.value === current) ? current : (items[0]?.value ?? '');
  el.innerHTML = items.map((o) => `<button type="button" class="dk-tab" data-v="${esc(o.value)}" aria-pressed="${o.value === pick}">${o.art ? img(o.art, '', 26, true) : ''}${esc(o.label)}</button>`).join('');
  return pick;
}

// ── Detail ───────────────────────────────────────────────────────────────────────────────────────────────
function renderFilters(b: Breakdown | null): void {
  ($('from') as HTMLInputElement).value = state.range.from ?? state.overview?.from ?? '';
  ($('to') as HTMLInputElement).value = state.range.to;
  ($('from') as HTMLInputElement).max = today();
  ($('to') as HTMLInputElement).max = today();
  for (const btn of $('range-presets').querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.preset === state.range.preset));
  const patches = b?.patches ?? [];
  const items = [{ value: '', label: 'All builds' }, ...patches.map((p) => ({ value: p.patch, label: `${p.patch}  ·  ${shortDay(p.firstSeen.slice(0, 10))}  ·  ${p.games} games` }))];
  if (state.patch && !patches.some((p) => p.patch === state.patch)) items.push({ value: state.patch, label: state.patch });
  ($('patch') as HTMLSelectElement).innerHTML = items.map((o) => `<option value="${esc(o.value)}"${o.value === state.patch ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}

function renderModes(b: Breakdown): void {
  $('modes-hint').textContent = `${shortDay(b.from)} to ${shortDay(b.to)}${b.patch ? `, build ${b.patch}` : ''}`;
  if (b.modes.length === 0) { $('modes').innerHTML = '<p class="dk-empty">No finished games in this range.</p>'; return; }
  $('modes').innerHTML = `<div class="dk-rows">${b.modes.map((m, i) => {
    const art = state.game?.modes[MODE_ART[m.mode] ?? ''];
    return `<div class="dk-row">${art ? img(art, 'dk-rowart', 480, i < 2) : ''}
      <div class="dk-rowmain"><span class="dk-rowcount"><span class="dk-rownum">${int(m.games)}</span><span class="dk-rownumlbl">games</span></span>
        <div class="dk-rowwho"><span class="dk-rowtitle">${esc(MODE_LABEL[m.mode] ?? m.mode)}</span>
        <span class="dk-rowsub">${int(m.accounts)} accounts${m.avgPlacement == null ? '' : ` · avg place ${place(m.avgPlacement)} of ${m.seats}`}</span></div></div></div>`;
  }).join('')}</div>`;
}

const LOW_SAMPLE = 10;
const MEDAL_ORDER = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'];

function renderHeroes(b: Breakdown): void {
  const modes = [...new Set(b.heroes.map((h) => h.mode))];
  state.heroMode = tabs($('hero-mode'), modes.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m })), state.heroMode) as GameMode;
  const bands = [...new Set(b.heroes.filter((h) => h.mode === state.heroMode).map((h) => h.band))]
    .sort((a, z) => (a === 'all' ? -1 : z === 'all' ? 1 : MEDAL_ORDER.indexOf(a) - MEDAL_ORDER.indexOf(z)));
  state.heroBand = bands.length > 1
    ? tabs($('hero-band'), bands.map((x) => ({ value: x, label: x === 'all' ? 'All medals' : x, art: x === 'all' ? undefined : medalArt(x) })), state.heroBand)
    : (($('hero-band').innerHTML = ''), 'all');
  const seats = b.modes.find((m) => m.mode === state.heroMode)?.seats ?? 8;
  const lobby = state.heroMode === 'ranked' || state.heroMode === 'unrated_lobby';
  const offers = new Map(b.heroOffers.map((o) => [o.heroId, o]));
  const rows = b.heroes.filter((h) => h.mode === state.heroMode && h.band === state.heroBand);
  const { key, dir } = state.heroSort;
  const val = (h: HeroRow): number | string => {
    if (key === 'offer') return offers.get(h.heroId)?.offerPickRate ?? -1;
    if (key === 'heroId') return heroName(h.heroId);
    const v = h[key];
    return typeof v === 'string' ? v : (v ?? (dir < 0 ? -Infinity : Infinity));
  };
  rows.sort((a, z) => {
    const x = val(a), y = val(z);
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * dir;
  });
  const total = rows.reduce((a, h) => a + h.games, 0);
  $('heroes-hint').textContent = rows.length === 0 ? '' :
    `${int(total)} hero picks. Pick share is the hero's share of picks here.` +
    (lobby ? ' Picked when offered: how often it was taken when it was one of the three offered (all lobby games).' : '') +
    ` Dim rows have fewer than ${LOW_SAMPLE} games.`;
  if (rows.length === 0) { $('heroes').innerHTML = '<p class="dk-empty">No hero data for this mode and range.</p>'; return; }
  const maxShare = Math.max(...rows.map((h) => h.pickRate ?? 0));
  const th = (k: typeof key, label: string) =>
    `<th${k === key ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${String(k)}">${label}</button></th>`;
  $('heroes').innerHTML = `<table><thead><tr>${th('heroId', 'Hero')}${th('games', 'Games')}${th('pickRate', 'Pick share')}${lobby ? th('offer', 'Picked when offered') : ''}${th('avgPlacement', 'Avg place')}${th('topHalfRate', topHalfLabel(seats))}${th('firstRate', '1st')}</tr></thead><tbody>${rows.map((h) => {
    const o = offers.get(h.heroId);
    return `<tr class="${h.games < LOW_SAMPLE ? 'low' : ''}"><td>${heroCell(h.heroId)}</td><td class="dk-num">${int(h.games)}</td>
      <td><span class="bar">${pct(h.pickRate)}${miniBar(h.pickRate, maxShare)}</span></td>
      ${lobby ? `<td>${o ? `${pct(o.offerPickRate)} <span class="dk-sub">${o.picked}/${o.offered}</span>` : 'n/a'}</td>` : ''}
      <td>${place(h.avgPlacement)}</td><td>${pct(h.topHalfRate)}</td><td>${pct(h.firstRate)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function renderTribes(b: Breakdown): void {
  const modes = [...new Set([...b.tribesInRun, ...b.tribesFinal].map((t) => t.mode))];
  state.tribeMode = tabs($('tribe-mode'), modes.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m })), state.tribeMode) as GameMode;
  const inRun = b.tribesInRun.filter((t) => t.mode === state.tribeMode);
  const fin = new Map(b.tribesFinal.filter((t) => t.mode === state.tribeMode).map((t) => [t.tribe, t]));
  const names = [...new Set([...inRun.map((t) => t.tribe), ...fin.keys()])];
  if (names.length === 0) { $('tribes').innerHTML = '<p class="dk-empty">No tribe data for this mode and range.</p>'; return; }
  const run = new Map(inRun.map((t) => [t.tribe, t]));
  names.sort((a, z) => (fin.get(z)?.games ?? 0) - (fin.get(a)?.games ?? 0) || (run.get(z)?.games ?? 0) - (run.get(a)?.games ?? 0));
  const cells = (t: TribeRow | undefined, first: boolean) => {
    const s = first ? ' class="sep"' : '';
    return t
      ? `<td${s}><span class="dk-num">${int(t.games)}</span></td><td>${pct(t.rate)}</td><td>${place(t.avgPlacement)}</td><td>${pct(t.top4Rate)}</td><td>${pct(t.firstRate)}</td>`
      : `<td${s}>n/a</td><td></td><td></td><td></td><td></td>`;
  };
  const head = (first: boolean) => `<th${first ? ' class="sep"' : ''}>Games</th><th>Share</th><th>Avg place</th><th>Top 4</th><th>1st</th>`;
  $('tribes').innerHTML = `<table><thead><tr><th></th><th class="group sep" colspan="5">Final board top tribe</th><th class="group sep" colspan="5">In run</th></tr>
    <tr><th>Tribe</th>${head(true)}${head(true)}</tr></thead><tbody>${names.map((n) => `<tr><td>${tribeCell(n)}</td>${cells(fin.get(n), true)}${cells(run.get(n), true)}</tr>`).join('')}</tbody></table>`;
}

function renderMedals(b: Breakdown): void {
  if (b.medals.length === 0) { $('medals').innerHTML = '<p class="dk-empty">No ranked games with a known medal in this range.</p>'; return; }
  $('medals').innerHTML = `<div class="dk-rows">${b.medals.map((m) => {
    const art = medalArt(m.medal);
    return `<div class="dk-row"><div class="dk-rowmain"><span class="dk-rowlead">${art ? img(art, 'dk-crest', 52) : ''}</span>
      <div class="dk-rowwho"><span class="dk-rowtitle">${esc(m.medal)}</span><span class="dk-rowsub">avg place ${place(m.avgPlacement)} of 8</span></div></div>
      <div class="dk-rowright"><span class="dk-rownum">${int(m.games)}</span><span class="dk-rownumlbl">games</span></div></div>`;
  }).join('')}</div>`;
}

function render(): void {
  $('sample').hidden = !state.sample;
  $('tz').textContent = state.overview?.tz ?? TZ;
  if (state.game) $('setline').textContent = `Live set: ${state.game.setId.replace(/^set/, 'Set ')} · ${state.game.activeTribes.map(tribeName).join(', ')}`;
  renderFilters(state.breakdown);
  if (state.overview) { renderTiles(state.overview); renderSeries(state.overview); }
  if (state.breakdown) {
    renderModes(state.breakdown);
    renderHeroes(state.breakdown);
    renderTribes(state.breakdown);
    renderMedals(state.breakdown);
  }
  tickUpdated();
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────────────
const tabValue = (ev: Event): string | undefined => (ev.target as HTMLElement).closest('button')?.dataset.v;

/** The range (and build) live in the URL hash, so a link opens the same view. */
function setRange(range: Range): void {
  state.range = range;
  history.replaceState(null, '', hashNow());
  renderFilters(state.breakdown);
  void refresh();
}

function wire(): void {
  $('range-presets').addEventListener('click', (ev) => {
    const p = (ev.target as HTMLElement).closest('button')?.dataset.preset as Preset | undefined;
    if (p) setRange(presetRange(p, today()));
  });
  const dateChange = () => {
    const f = ($('from') as HTMLInputElement).value;
    const t = ($('to') as HTMLInputElement).value;
    if (f && t) setRange(customRange(f, t, today()));
  };
  $('from').addEventListener('change', dateChange);
  $('to').addEventListener('change', dateChange);
  $('patch').addEventListener('change', () => { state.patch = ($('patch') as HTMLSelectElement).value; setRange(state.range); });
  $('refresh').addEventListener('click', () => void refresh());
  window.addEventListener('hashchange', () => {
    const next = parseHash(location.hash, today());
    state.patch = next.build;
    state.range = next.range;
    void refresh();
  });
  // Live: no polling while the tab is hidden; one read on return, then the timer resumes.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(liveTimer); return; }
    if (live()) void refresh();
    tickUpdated();
  });
  window.setInterval(() => { if (!document.hidden) tickUpdated(); }, 1000);
  $('hero-mode').addEventListener('click', (ev) => { const v = tabValue(ev); if (!v || !state.breakdown) return; state.heroMode = v as GameMode; state.heroBand = 'all'; renderHeroes(state.breakdown); });
  $('hero-band').addEventListener('click', (ev) => { const v = tabValue(ev); if (!v || !state.breakdown) return; state.heroBand = v; renderHeroes(state.breakdown); });
  $('heroes').addEventListener('click', (ev) => {
    const k = (ev.target as HTMLElement).closest('button')?.dataset.sort as typeof state.heroSort.key | undefined;
    if (!k || !state.breakdown) return;
    state.heroSort = { key: k, dir: state.heroSort.key === k ? -state.heroSort.dir : k === 'heroId' || k === 'avgPlacement' ? 1 : -1 };
    renderHeroes(state.breakdown);
  });
  $('tribe-mode').addEventListener('click', (ev) => { const v = tabValue(ev); if (!v || !state.breakdown) return; state.tribeMode = v as GameMode; renderTribes(state.breakdown); });
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (state.overview) { renderTiles(state.overview); renderSeries(state.overview); } });
  });
  wireTips();
}

// ── The two views (Analytics | Moderation), in the nav; the view rides the URL hash with the range ───────────────
let view: View = viewOfHash(location.hash);
const hashNow = (): string => withView(toHash(state.range, state.patch), view);
function setView(v: View, push = true): void {
  view = v;
  $('view-analytics').hidden = v !== 'analytics';
  $('view-moderation').hidden = v !== 'moderation';
  document.body.dataset.view = v; // the range chips (Live, time zone, Updated) belong to Analytics only
  for (const b of $('views').querySelectorAll<HTMLButtonElement>('button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  document.title = v === 'moderation' ? 'ASCENT Moderation' : 'ASCENT Analytics';
  if (push) history.replaceState(null, '', hashNow());
  if (v === 'moderation') { if (push) showModeration(); }
  else if (state.overview) { renderTiles(state.overview); renderSeries(state.overview); } // sized now that it shows
}
$('views').addEventListener('click', (ev) => {
  const v = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]')?.dataset.view;
  if (v === 'analytics' || v === 'moderation') setView(v);
});
window.addEventListener('hashchange', () => { const v = viewOfHash(location.hash); if (v !== view) setView(v, false); });

wire();
wireModeration((n) => {
  const el = $('mod-count');
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = n === 0;
  $('views').querySelector('[data-view="moderation"]')?.setAttribute('aria-label', n ? `Moderation, ${n} open` : 'Moderation');
});
setView(view, false);
history.replaceState(null, '', hashNow());
renderFilters(null);
void loadGame().then(() => refresh());
