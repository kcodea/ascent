import './styles.css';
import { lines, miniBar, sparkline, stackedBars } from './charts';
import { MODE_LABEL, SERIES, dateIn, esc, int, minusDays, pct, place, seriesValues, shortDay, titleCase, topHalfLabel } from './format';
import type { Breakdown, GameMode, HeroRow, Overview, TribeRow } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

const state = {
  overview: null as Overview | null,
  breakdown: null as Breakdown | null,
  from: minusDays(dateIn(TZ), 6),
  to: dateIn(TZ),
  patch: '',
  heroMode: 'ranked' as GameMode,
  heroBand: 'all',
  heroSort: { key: 'games' as keyof HeroRow | 'offer', dir: -1 },
  tribeMode: 'ranked' as GameMode,
  sample: false,
};

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

async function loadOverview(): Promise<void> {
  state.overview = await getJson<Overview>(`/api/overview?days=30&tz=${encodeURIComponent(TZ)}`);
}

async function loadBreakdown(): Promise<void> {
  const q = new URLSearchParams({ from: state.from, to: state.to, tz: TZ });
  if (state.patch) q.set('patch', state.patch);
  state.breakdown = await getJson<Breakdown>(`/api/breakdown?${q.toString()}`);
}

async function refresh(which: 'all' | 'breakdown' = 'all'): Promise<void> {
  $('error').hidden = true;
  try {
    await Promise.all([which === 'all' ? loadOverview() : Promise.resolve(), loadBreakdown()]);
  } catch (e) {
    showError(e);
  }
  render();
  $('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Headline tiles + daily charts ────────────────────────────────────────────────────────────────────────
function renderTiles(o: Overview): void {
  const today = o.daily[o.daily.length - 1];
  const yesterday = o.daily[o.daily.length - 2];
  const delta = (a: number, b: number | undefined) => (b == null ? '' : ` (${a - b >= 0 ? '+' : ''}${a - b} vs yesterday)`);
  const games = o.daily.map((d) => d.games);
  const acc = o.daily.map((d) => d.accounts);
  const fresh = o.daily.map((d) => d.newEmail + d.newGuest);
  const w = Math.max(120, Math.round($('tile-games').clientWidth - 36));
  $('tile-games').innerHTML = `<span class="k">Games finished today</span><span class="v">${int(today?.games)}</span>
    <span class="sub"><b>${int(o.windows.d7.games)}</b> in 7 days · <b>${int(o.windows.d30.games)}</b> in 30 days${esc(delta(today?.games ?? 0, yesterday?.games))}</span>${sparkline(games, w)}`;
  $('tile-accounts').innerHTML = `<span class="k">Accounts active today</span><span class="v">${int(today?.accounts)}</span>
    <span class="sub"><b>${int(o.windows.d7.accounts)}</b> in 7 days · <b>${int(o.windows.d30.accounts)}</b> in 30 days (distinct)</span>${sparkline(acc, w)}`;
  $('tile-new').innerHTML = `<span class="k">New accounts today</span><span class="v">${int((today?.newEmail ?? 0) + (today?.newGuest ?? 0))}</span>
    <span class="sub"><b>${int(today?.newEmail)}</b> email · <b>${int(today?.newGuest)}</b> guest · <b>${int(today?.firstGame)}</b> played a first game</span>${sparkline(fresh, w)}`;
}

function renderDaily(o: Overview): void {
  const days = o.daily.map((d) => d.day);
  const gw = Math.max(280, $('chart-games').clientWidth);
  $('games-legend').innerHTML = SERIES.map((s) => `<span><i class="c${s.slot}"></i>${esc(s.label)}</span>`).join('');
  $('chart-games').innerHTML = stackedBars(days, o.daily.map(seriesValues), SERIES.map((s) => s.slot), gw);
  const aw = Math.max(280, $('chart-accounts').clientWidth);
  $('accounts-legend').innerHTML = '<span><i class="c1 ln"></i>Active accounts</span><span><i class="c3 ln"></i>First game ever</span>';
  $('chart-accounts').innerHTML = lines(days, [
    { label: 'Active accounts', values: o.daily.map((d) => d.accounts), slot: 1 },
    { label: 'First game ever', values: o.daily.map((d) => d.firstGame), slot: 3, dashed: true },
  ], aw);
}

// ── Tooltip ──────────────────────────────────────────────────────────────────────────────────────────────
function tipHtml(chart: 'games' | 'accounts', i: number): string {
  const d = state.overview?.daily[i];
  if (!d) return '';
  if (chart === 'games') {
    const v = seriesValues(d);
    const rows = SERIES.map((s, k) => `<div class="row"><span><i class="c${s.slot}"></i>${esc(s.label)}</span><span>${v[k]}</span></div>`).join('');
    return `<div class="head">${esc(shortDay(d.day))}: ${d.games} games</div>${rows}`;
  }
  return `<div class="head">${esc(shortDay(d.day))}</div>
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
      const x = Math.min(window.innerWidth - r.width - 8, ev.clientX + 14);
      const y = Math.max(8, ev.clientY - r.height - 12);
      tip.style.left = `${Math.max(8, x)}px`;
      tip.style.top = `${y}px`;
    });
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
}

// ── Detail tables ────────────────────────────────────────────────────────────────────────────────────────
function options(sel: HTMLSelectElement, items: Array<{ value: string; label: string }>, current: string): string {
  sel.innerHTML = items.map((o) => `<option value="${esc(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return items.some((o) => o.value === current) ? current : (items[0]?.value ?? '');
}

function renderFilters(b: Breakdown): void {
  ($('from') as HTMLInputElement).value = state.from;
  ($('to') as HTMLInputElement).value = state.to;
  const span = Math.round((Date.parse(state.to) - Date.parse(state.from)) / 86_400_000) + 1;
  for (const btn of $('range-presets').querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.days) === span && state.to === dateIn(TZ)));
  }
  const items = [{ value: '', label: 'All builds' }, ...b.patches.map((p) => ({
    value: p.patch,
    label: `${p.patch}  ·  ${shortDay(p.firstSeen.slice(0, 10))}  ·  ${p.games} games`,
  }))];
  if (state.patch && !b.patches.some((p) => p.patch === state.patch)) items.push({ value: state.patch, label: state.patch });
  options($('patch') as HTMLSelectElement, items, state.patch);
}

function renderModes(b: Breakdown): void {
  $('modes-hint').textContent = `${b.from} to ${b.to}${b.patch ? `, build ${b.patch}` : ''}`;
  if (b.modes.length === 0) { $('modes').innerHTML = '<p class="empty">No finished games in this range.</p>'; return; }
  const max = Math.max(...b.modes.map((m) => m.games));
  $('modes').innerHTML = `<table><thead><tr><th>Mode</th><th>Games</th><th></th><th>Accounts</th><th>Avg place</th></tr></thead><tbody>${b.modes.map((m) => `
    <tr><td>${esc(MODE_LABEL[m.mode] ?? m.mode)}</td><td>${int(m.games)}</td><td>${miniBar(m.games, max, 90)}</td><td>${int(m.accounts)}</td>
    <td>${m.avgPlacement == null ? 'n/a' : `${place(m.avgPlacement)} <span class="label">of ${m.seats}</span>`}</td></tr>`).join('')}</tbody></table>`;
}

const LOW_SAMPLE = 10;

function renderHeroes(b: Breakdown): void {
  const modes = [...new Set(b.heroes.map((h) => h.mode))];
  state.heroMode = options($('hero-mode') as HTMLSelectElement, modes.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m })), state.heroMode) as GameMode;
  const bands = [...new Set(b.heroes.filter((h) => h.mode === state.heroMode).map((h) => h.band))];
  $('hero-band-wrap').hidden = bands.length <= 1;
  state.heroBand = options($('hero-band') as HTMLSelectElement, bands.map((x) => ({ value: x, label: x === 'all' ? 'All medals' : x })), state.heroBand);
  const seats = b.modes.find((m) => m.mode === state.heroMode)?.seats ?? 8;
  const lobby = state.heroMode === 'ranked' || state.heroMode === 'unrated_lobby';
  const offers = new Map(b.heroOffers.map((o) => [o.heroId, o]));
  const rows = b.heroes.filter((h) => h.mode === state.heroMode && h.band === state.heroBand);
  const { key, dir } = state.heroSort;
  const val = (h: HeroRow): number | string => {
    if (key === 'offer') return offers.get(h.heroId)?.offerPickRate ?? -1;
    const v = h[key];
    return typeof v === 'string' ? v : (v ?? (dir < 0 ? -Infinity : Infinity));
  };
  rows.sort((a, z) => {
    const x = val(a), y = val(z);
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * dir;
  });
  const total = rows.reduce((a, h) => a + h.games, 0);
  $('heroes-hint').textContent = rows.length === 0 ? '' :
    `${int(total)} hero picks. Pick share = this hero's share of picks in the mode${state.heroBand !== 'all' ? ' and medal' : ''}.` +
    (lobby ? ' Offered = how often it was picked when one of the three offered (all lobby games, from telemetry).' : '') +
    ` Grey rows have fewer than ${LOW_SAMPLE} games.`;
  if (rows.length === 0) { $('heroes').innerHTML = '<p class="empty">No hero data for this mode and range.</p>'; return; }
  const maxShare = Math.max(...rows.map((h) => h.pickRate ?? 0));
  const th = (k: typeof key, label: string) =>
    `<th${k === key ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${String(k)}">${label}</button></th>`;
  $('heroes').innerHTML = `<table><thead><tr>${th('heroId', 'Hero')}${th('games', 'Games')}${th('pickRate', 'Pick share')}${lobby ? th('offer', 'Picked when offered') : ''}${th('avgPlacement', 'Avg place')}${th('topHalfRate', topHalfLabel(seats))}${th('firstRate', '1st')}</tr></thead><tbody>${rows.map((h) => {
    const o = offers.get(h.heroId);
    return `<tr class="${h.games < LOW_SAMPLE ? 'low' : ''}"><td>${esc(titleCase(h.heroId))}</td><td>${int(h.games)}</td>
      <td><span class="bar">${pct(h.pickRate)}${miniBar(h.pickRate, maxShare)}</span></td>
      ${lobby ? `<td>${o ? `${pct(o.offerPickRate)} <span class="label">${o.picked}/${o.offered}</span>` : 'n/a'}</td>` : ''}
      <td>${place(h.avgPlacement)}</td><td>${pct(h.topHalfRate)}</td><td>${pct(h.firstRate)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function renderTribes(b: Breakdown): void {
  const modes = [...new Set([...b.tribesInRun, ...b.tribesFinal].map((t) => t.mode))];
  state.tribeMode = options($('tribe-mode') as HTMLSelectElement, modes.map((m) => ({ value: m, label: MODE_LABEL[m] ?? m })), state.tribeMode) as GameMode;
  const inRun = b.tribesInRun.filter((t) => t.mode === state.tribeMode);
  const fin = new Map(b.tribesFinal.filter((t) => t.mode === state.tribeMode).map((t) => [t.tribe, t]));
  const names = [...new Set([...inRun.map((t) => t.tribe), ...fin.keys()])];
  if (names.length === 0) { $('tribes').innerHTML = '<p class="empty">No tribe data for this mode and range.</p>'; return; }
  const run = new Map(inRun.map((t) => [t.tribe, t]));
  names.sort((a, z) => (run.get(z)?.games ?? 0) - (run.get(a)?.games ?? 0));
  const cells = (t: TribeRow | undefined) => t
    ? `<td>${int(t.games)}</td><td>${pct(t.rate)}</td><td>${place(t.avgPlacement)}</td><td>${pct(t.top4Rate)}</td><td>${pct(t.firstRate)}</td>`
    : '<td>n/a</td><td></td><td></td><td></td><td></td>';
  const head = '<th>Games</th><th>Share</th><th>Avg place</th><th>Top 4</th><th>1st</th>';
  $('tribes').innerHTML = `<table><thead><tr><th></th><th class="group" colspan="5">In run</th><th class="group" colspan="5">Final board top tribe</th></tr>
    <tr><th>Tribe</th>${head}${head}</tr></thead><tbody>${names.map((n) => `<tr><td>${esc(titleCase(n))}</td>${cells(run.get(n))}${cells(fin.get(n))}</tr>`).join('')}</tbody></table>`;
}

function renderMedals(b: Breakdown): void {
  if (b.medals.length === 0) { $('medals').innerHTML = '<p class="empty">No ranked games with a known medal in this range.</p>'; return; }
  const max = Math.max(...b.medals.map((m) => m.games));
  $('medals').innerHTML = `<table><thead><tr><th>Medal</th><th>Games</th><th></th><th>Avg place</th></tr></thead><tbody>${b.medals.map((m) =>
    `<tr><td>${esc(m.medal)}</td><td>${int(m.games)}</td><td>${miniBar(m.games, max, 90)}</td><td>${place(m.avgPlacement)}</td></tr>`).join('')}</tbody></table>`;
}

function render(): void {
  $('sample').hidden = !state.sample;
  $('tz').textContent = `Time zone: ${state.overview?.tz ?? TZ}`;
  if (state.overview) { renderTiles(state.overview); renderDaily(state.overview); }
  if (state.breakdown) {
    renderFilters(state.breakdown);
    renderModes(state.breakdown);
    renderHeroes(state.breakdown);
    renderTribes(state.breakdown);
    renderMedals(state.breakdown);
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────────────
function wire(): void {
  $('range-presets').addEventListener('click', (ev) => {
    const days = Number((ev.target as HTMLElement).closest('button')?.dataset.days);
    if (!days) return;
    state.to = dateIn(TZ);
    state.from = minusDays(state.to, days - 1);
    void refresh('breakdown');
  });
  const dateChange = () => {
    const f = ($('from') as HTMLInputElement).value;
    const t = ($('to') as HTMLInputElement).value;
    if (!f || !t) return;
    state.from = f <= t ? f : t;
    state.to = f <= t ? t : f;
    void refresh('breakdown');
  };
  $('from').addEventListener('change', dateChange);
  $('to').addEventListener('change', dateChange);
  $('patch').addEventListener('change', () => { state.patch = ($('patch') as HTMLSelectElement).value; void refresh('breakdown'); });
  $('refresh').addEventListener('click', () => void refresh('all'));
  $('hero-mode').addEventListener('change', () => { state.heroMode = ($('hero-mode') as HTMLSelectElement).value as GameMode; state.heroBand = 'all'; if (state.breakdown) renderHeroes(state.breakdown); });
  $('hero-band').addEventListener('change', () => { state.heroBand = ($('hero-band') as HTMLSelectElement).value; if (state.breakdown) renderHeroes(state.breakdown); });
  $('heroes').addEventListener('click', (ev) => {
    const k = (ev.target as HTMLElement).closest('button')?.dataset.sort as typeof state.heroSort.key | undefined;
    if (!k) return;
    state.heroSort = { key: k, dir: state.heroSort.key === k ? -state.heroSort.dir : k === 'heroId' || k === 'avgPlacement' ? 1 : -1 };
    if (state.breakdown) renderHeroes(state.breakdown);
  });
  $('tribe-mode').addEventListener('change', () => { state.tribeMode = ($('tribe-mode') as HTMLSelectElement).value as GameMode; if (state.breakdown) renderTribes(state.breakdown); });
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (state.overview) { renderTiles(state.overview); renderDaily(state.overview); } });
  });
  wireTips();
}

wire();
void refresh('all');
