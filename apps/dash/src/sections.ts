// The four round-two parts of Analytics (owner 2026-11-22): Players (retention + engagement), Live & social,
// Progression, Health & balance. Each renders its whole part from one RPC answer (src/types.ts), as HTML strings in the
// page's kit (dk-section / dk-stat / dk-row / tables) with the game's own art from the synced data. No inline style
// attributes (the CSP forbids them). Pure helpers at the top are unit tested.
import { heatmap, lines, meter, miniBar, stackedBars, trendSpark } from './charts';
import { bucketLabel, esc, int, pct, place, shortDay, titleCase } from './format';
import type { GameData, GameNames, HealthData, PlayersData, ProgressionData, SocialData, TrendItem } from './types';

// ── The parts and the URL ─────────────────────────────────────────────────────────────────────────────────────
export const SECTIONS = ['overview', 'players', 'social', 'progression', 'health'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  overview: 'Overview', players: 'Players', social: 'Live & social', progression: 'Progression', health: 'Health & balance',
};
/** The game medallion (apps/web/public/medallions) each part wears on its tab. */
export const SECTION_MEDALLION: Record<Section, string> = {
  overview: 'startCombat', players: 'rebirth', social: 'mode-versus', progression: 'mode-ranked', health: 'health',
};

/** `&sec=players` in the hash; anything else (or none) is the overview. */
export function sectionOfHash(hash: string): Section {
  const s = new URLSearchParams(hash.replace(/^#/, '')).get('sec');
  return (SECTIONS as readonly string[]).includes(s ?? '') ? (s as Section) : 'overview';
}
export function withSection(hash: string, sec: Section): string {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  if (sec === 'overview') q.delete('sec');
  else q.set('sec', sec);
  const s = q.toString();
  return s ? `#${s}` : '';
}

/** A rate that is only shown once there is something to divide by. */
export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
/** A sample this small reads as noise: shown, but dimmed. */
export const LOW_SAMPLE = 10;

// ── Kit pieces ───────────────────────────────────────────────────────────────────────────────────────────────
export interface Ctx {
  game: GameData | null;
  names: GameNames | null;
  heroCell(id: string): string;
  tribeCell(id: string): string;
  img(src: string, cls: string, size: number, eager?: boolean): string;
  /** Width a chart can use inside a section body. */
  chartWidth: number;
}

const section = (title: string, aside: string, body: string, extra = ''): string =>
  `<section class="dk-section dk-in ${extra}"><div class="dk-sechead"><h2>${esc(title)}</h2>${aside ? `<span class="dk-secaside">${aside}</span>` : ''}</div><div class="dk-secbody">${body}</div></section>`;
const stat = (label: string, value: string, sub = '', cls = ''): string =>
  `<article class="dk-stat dk-in ${cls}"><span class="dk-statlbl">${esc(label)}</span><span class="dk-statval">${value}</span>${sub ? `<span class="dk-statsub">${sub}</span>` : ''}</article>`;
const legend = (items: Array<[number, string]>): string => `<div class="dk-legend">${items.map(([s, l]) => `<span><i class="c${s}"></i>${esc(l)}</span>`).join('')}</div>`;
const barList = (rows: Array<{ label: string; n: number; lead?: string }>, unit: string): string => {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return `<div class="dk-bars">${rows.map((r) => `<div class="dk-bar">${r.lead ?? ''}<span class="dk-barlbl">${esc(r.label)}</span>${miniBar(r.n, max, 180)}<span class="dk-barn">${int(r.n)} <span class="dk-sub">${esc(unit)}</span></span></div>`).join('')}</div>`;
};
const pctOf = (r: { eligible: number; returned: number }): string => (r.eligible > 0 ? pct(r.returned / r.eligible) : 'n/a');

// ── Players: retention + engagement ─────────────────────────────────────────────────────────────────────────
export function renderPlayers(p: PlayersData, c: Ctx): string {
  const r = p.retention;
  const ret = (label: string, x: { eligible: number; returned: number }, days: string) =>
    stat(label, pctOf(x), x.eligible > 0 ? `<b>${int(x.returned)}</b> of ${int(x.eligible)} came back ${days}` : 'Too early to tell');
  const a = p.active;
  const cohorts = p.cohorts.length === 0 ? '<p class="dk-empty">No new players in this range.</p>'
    : `<div class="dk-tablewrap"><table><thead><tr><th>Week of</th><th>New players</th><th>Day 1</th><th>Day 7</th><th>Day 30</th></tr></thead><tbody>${p.cohorts.map((w) => {
      const cell = (n: number, e: number) => (e > 0 ? `${pct(n / e)} <span class="dk-sub">${n}/${e}</span>` : '<span class="dk-sub">too early</span>');
      return `<tr class="${w.players < LOW_SAMPLE ? 'low' : ''}"><td>${esc(shortDay(w.week))}</td><td class="dk-num">${int(w.players)}</td><td>${cell(w.d1, w.d1Eligible)}</td><td>${cell(w.d7, w.d7Eligible)}</td><td>${cell(w.d30, w.d30Eligible)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  const pt = p.playTime;
  return `
    <div class="dk-stats dk-stats-4">
      ${stat('New players', int(r.cohort), 'First finished game in this range')}
      ${ret('Back next day', r.d1, 'the next day')}
      ${ret('Back within 7 days', r.d7, 'within a week')}
      ${ret('Back within 30 days', r.d30, 'within 30 days')}
    </div>
    <div class="dk-stats dk-stats-4">
      ${stat('Daily active', int(a.dau), `On ${esc(shortDay(p.to))} · ${a.dauAvg30 == null ? '' : `${a.dauAvg30} a day over 30 days`}`)}
      ${stat('Weekly active', int(a.wau), '7 days to the range end')}
      ${stat('Monthly active', int(a.mau), '30 days to the range end')}
      ${stat('Stickiness', a.stickiness == null ? 'n/a' : pct(a.stickiness), 'Average daily ÷ monthly active')}
    </div>
    ${section('Return rate by first-game week', 'A player counts once their window has passed', cohorts)}
    <div class="dk-split">
      ${section('Games per player', `Mean <b>${p.gamesPerPlayer.mean ?? 'n/a'}</b> · median <b>${p.gamesPerPlayer.median ?? 'n/a'}</b>`,
        barList(p.gamesPerPlayer.buckets.map((b) => ({ label: `${b.label} game${b.label === '1' ? '' : 's'}`, n: b.players })), 'players'))}
      ${section('Play time', 'Active time in game, lobby + practice', `<div class="dk-mini">
        <div><span class="dk-statval">${pt.hours.toLocaleString('en-US')}</span><span class="dk-statlbl">hours played</span></div>
        <div><span class="dk-statval">${pt.avgMinutes ?? 'n/a'}</span><span class="dk-statlbl">minutes a game</span></div>
        <div><span class="dk-statval">${pt.games > 0 ? pct(pt.timedGames / pt.games, 0) : 'n/a'}</span><span class="dk-statlbl">games timed</span></div></div>
        <p class="dk-hint">${int(pt.timedGames)} of ${int(pt.games)} lobby and practice games carry a play clock (older games and Versus do not).</p>`)}
    </div>
    ${section('When games finish', `${esc(p.tz)} · darker is busier`, `<div class="dk-chart">${heatmap(p.heatmap, c.chartWidth)}</div>`)}`;
}

// ── Live now + social ───────────────────────────────────────────────────────────────────────────────────────
const VERSUS: Array<[string, string, number]> = [['versus_duel', 'Versus 1v1', 1], ['versus_group', 'Versus group', 2], ['versus_duos', 'Versus Duos', 3], ['ranked_duos', 'Ranked Duos', 4]];

export function renderSocial(s: SocialData, c: Ctx): string {
  const labels = s.series.map((p) => bucketLabel(p.t, s.bucket));
  const per = s.bucket;
  const at = new Date(s.now.at);
  const modes = Object.entries(s.now.byMode).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<span class="dk-chip">${esc(titleCase(m))} ${n}</span>`).join('');
  const t = s.totals;
  const versus = stackedBars(labels, s.series.map((p) => VERSUS.map(([k]) => (p.counts as Record<string, number>)[k] ?? 0)), VERSUS.map(([, , slot]) => slot), c.chartWidth);
  const social = lines(labels, [
    { label: 'Friend requests', values: s.series.map((p) => p.counts.friend_request ?? 0), slot: 1 },
    { label: 'Friends made', values: s.series.map((p) => p.counts.friend_accept ?? 0), slot: 3, area: false },
    { label: 'Game invites', values: s.series.map((p) => (p.counts.invite_versus ?? 0) + (p.counts.invite_duos ?? 0)), slot: 2, area: false },
  ], c.chartWidth);
  const dmSince = s.dmOldest ? `kept since ${new Date(s.dmOldest).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'none kept';
  return `
    <div class="dk-now dk-in">
      <div class="dk-nowhead"><span class="dk-live"><i aria-hidden="true"></i>Right now</span><span class="dk-sub">as of ${esc(at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}: online = seen by the friends hub in the last 5 minutes</span></div>
      <div class="dk-stats dk-stats-3">
        ${stat('Online', int(s.now.online), 'Connected to the friends hub')}
        ${stat('In a game', int(s.now.inGame), modes || 'Nobody in a game')}
        ${stat('Watching', int(s.now.watching), 'Spectating a live game')}
      </div>
    </div>
    ${section(`Versus matches per ${per}`, `<b>${int(VERSUS.reduce((a, [k]) => a + ((t as Record<string, number>)[k] ?? 0), 0))}</b> finished`,
      `${legend(VERSUS.map(([, l, slot]) => [slot, l]))}<div class="dk-chart">${versus}</div>`)}
    ${section(`Friends and invites per ${per}`, '', `${legend([[1, 'Friend requests'], [3, 'Friends made'], [2, 'Game invites']])}<div class="dk-chart">${social}</div>`)}
    <div class="dk-stats dk-stats-4">
      ${stat('Friendships', int(s.friendships.accepted), `${int(s.friendships.pending)} requests pending (all time)`)}
      ${stat('Invites accepted', s.invites.sent > 0 ? pct(s.invites.accepted / s.invites.sent) : 'n/a', `${int(s.invites.accepted)} of ${int(s.invites.sent)} sent`)}
      ${stat('Duos teams formed', int(t.duos_team ?? 0), 'New pairs in this range')}
      ${stat('Messages sent', int(t.dm ?? 0), `Counted only, never read. Messages are kept one day (${esc(dmSince)}).`)}
    </div>`;
}

// ── Progression + ladder ────────────────────────────────────────────────────────────────────────────────────
const MEDALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'];

export function renderProgression(p: ProgressionData, c: Ctx): string {
  const divName = (d: number) => c.game?.divisions?.[d] ?? `${MEDALS[Math.min(5, Math.floor(d / 3))]} ${(d % 3) + 1}`;
  const total = p.divisions.reduce((a, d) => a + d.players, 0);
  const max = Math.max(1, ...p.divisions.map((d) => d.players));
  const ladder = total === 0 ? '<p class="dk-empty">No ranked players this season yet.</p>' : `<div class="dk-ladder">${MEDALS.map((m, mi) => {
    const art = c.game?.medals[m];
    const divs = [0, 1, 2].map((k) => mi * 3 + k).filter((d) => d < 18);
    const n = p.divisions.filter((d) => d.medal === m).reduce((a, d) => a + d.players, 0);
    return `<div class="dk-rung"><div class="dk-rungmedal">${art ? c.img(art, 'dk-crest', 48) : ''}<span class="dk-rowtitle">${esc(m)}</span><span class="dk-sub">${int(n)} · ${total ? pct(n / total, 0) : ''}</span></div>
      <div class="dk-rungdivs">${divs.map((d) => { const v = p.divisions.find((x) => x.division === d)?.players ?? 0; return `<div class="dk-bar"><span class="dk-barlbl">${esc(divName(d))}</span>${miniBar(v, max, 160)}<span class="dk-barn">${int(v)}</span></div>`; }).join('')}</div></div>`;
  }).join('')}</div>`;
  const mv = p.movement;
  const labels = mv.series.map((x) => bucketLabel(x.t, p.bucket));
  const ach = p.achievements;
  const achName = (id: string) => c.names?.achievements[id] ?? id;
  const cosName = (id: string) => c.names?.cosmetics[id]?.name ?? titleCase(id);
  const cosCat = (id: string, cat: string | null) => titleCase(c.names?.cosmetics[id]?.category ?? cat ?? '');
  const titleName = (id: string) => c.names?.titles[id] ?? titleCase(id);
  const list = (rows: Array<{ id: string; players: number }>, name: (id: string) => string, sub?: (id: string) => string) =>
    `<ol class="dk-rank">${rows.map((r) => `<li><span class="dk-rankname">${esc(name(r.id))}${sub ? ` <span class="dk-sub">${esc(sub(r.id))}</span>` : ''}</span><span class="dk-num">${int(r.players)}</span></li>`).join('')}</ol>`;
  return `
    ${section(`Ladder now, season ${p.season ?? 'n/a'}`, `<b>${int(total)}</b> ranked players this season`, ladder)}
    <div class="dk-stats dk-stats-4">
      ${stat('Ranked games', int(mv.games), `${int(mv.players)} players in this range`)}
      ${stat('Net points', `${mv.netPoints >= 0 ? '+' : ''}${int(mv.netPoints)}`, `Average ${mv.avgDelta == null ? 'n/a' : `${mv.avgDelta >= 0 ? '+' : ''}${mv.avgDelta}`} a game`)}
      ${stat('Promotions', int(mv.promotions), 'Division or medal gates passed')}
      ${stat('Demotions', int(mv.demotions), 'Dropped a division')}
    </div>
    <div class="dk-split">
      ${section(`Ranked games per ${p.bucket}`, '', `${legend([[1, 'Ranked games'], [3, 'Promotions']])}<div class="dk-chart">${lines(labels, [
        { label: 'Ranked games', values: mv.series.map((x) => x.games), slot: 1 },
        { label: 'Promotions', values: mv.series.map((x) => x.promotions), slot: 3, area: false }], Math.round(c.chartWidth / 2 - 12) < 300 ? c.chartWidth : Math.round(c.chartWidth / 2 - 12))}</div>`)}
      ${section('Points by medal', 'Average points a game, by the medal going in', `<div class="dk-rows">${mv.byMedal.map((m) => {
        const art = c.game?.medals[m.medal];
        return `<div class="dk-row slim"><div class="dk-rowmain"><span class="dk-rowlead">${art ? c.img(art, 'dk-crest sm', 36) : ''}</span><div class="dk-rowwho"><span class="dk-rowtitle">${esc(m.medal)}</span><span class="dk-rowsub">${int(m.games)} games</span></div></div>
          <div class="dk-rowright"><span class="dk-rownum ${m.avgDelta >= 0 ? 'pos' : 'neg'}">${m.avgDelta >= 0 ? '+' : ''}${m.avgDelta}</span><span class="dk-rownumlbl">a game</span></div></div>`;
      }).join('') || '<p class="dk-empty">No ranked games in this range.</p>'}</div>`)}
    </div>
    <div class="dk-split">
      ${section('Account levels', `<b>${int(p.levels.players)}</b> players · median ${p.levels.median ?? 'n/a'} · top ${p.levels.max ?? 'n/a'}`,
        barList(p.levels.buckets.map((b) => ({ label: `Level ${b.label}`, n: b.players })), 'players'))}
      ${section(`Achievements per ${p.bucket}`, `<b>${int(ach.inRange)}</b> unlocked`, `<div class="dk-chart">${lines(ach.series.map((x) => bucketLabel(x.t, p.bucket)), [
        { label: 'Achievements', values: ach.series.map((x) => x.n), slot: 2 }], Math.round(c.chartWidth / 2 - 12) < 300 ? c.chartWidth : Math.round(c.chartWidth / 2 - 12), 180)}</div>`)}
    </div>
    <div class="dk-split">
      ${section('Most common achievements', `of ${int(ach.players)} players with any`, list(ach.most, achName))}
      ${section('Rarest achievements', 'All time', list(ach.least, achName))}
    </div>
    <div class="dk-split">
      ${section('Most equipped cosmetics', 'Players wearing it now', p.equipped.length ? list(p.equipped, cosName, (id) => cosCat(id, p.equipped.find((e) => e.id === id)?.category ?? null)) : '<p class="dk-empty">Nothing equipped yet.</p>')}
      ${section('Most worn titles', 'Players wearing it now', p.titles.length ? list(p.titles, titleName) : '<p class="dk-empty">No titles worn yet.</p>')}
    </div>`;
}

// ── Health + balance trends ─────────────────────────────────────────────────────────────────────────────────
export const TREND_KINDS = ['hero', 'tribe', 'rune', 'ancient'] as const;
export type TrendKind = (typeof TREND_KINDS)[number];
const TREND_LABEL: Record<TrendKind, string> = { hero: 'Heroes', tribe: 'Tribes', rune: 'Runes', ancient: 'Ancients' };

const mb = (b: number) => `${(b / 1048576).toFixed(b >= 104857600 ? 0 : 1)} MB`;
const statusPill = (s: string) => {
  const k = s === 'ok' ? 'ok' : s === 'fail' ? 'bad' : 'na';
  const label = s === 'ok' ? 'OK' : s === 'fail' ? 'Failing' : 'n/a';
  return `<span class="dk-pill ${k}"><i aria-hidden="true"></i>${label}</span>`;
};

/** First to last bucket's average place: lower is better, so a fall reads as an improvement. */
export function driftOf(series: Array<{ avgPlacement: number }>): number | null {
  if (series.length < 2) return null;
  return Math.round((series[series.length - 1]!.avgPlacement - series[0]!.avgPlacement) * 100) / 100;
}
const drift = (r: TrendItem): string => {
  const d = driftOf(r.series);
  if (d == null || d === 0) return '<span class="dk-sub">steady</span>';
  return `<span class="dk-drift ${d < 0 ? 'pos' : 'neg'}">${d < 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}</span>`;
};

export function renderHealth(h: HealthData, c: Ctx, trend: TrendKind): string {
  const labels = h.crashes.series.map((x) => bucketLabel(x.t, h.bucket));
  const st = h.ops.status;
  const failing = st?.failing_checks?.length ?? 0;
  const ops = h.ops.latest.length === 0 ? '<p class="dk-empty">No health check has reported yet.</p>' : `<div class="dk-checks">${h.ops.latest.map((x) =>
    `<div class="dk-check"><span class="dk-rowtitle">${esc(x.check)}</span>${statusPill(x.status)}<span class="dk-sub">${esc(x.source)} · ${esc(new Date(x.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span></div>`).join('')}</div>`;
  const db = h.database;
  const items = h.trends[trend] ?? [];
  const lead = (id: string): string => {
    if (trend === 'hero') return c.heroCell(id);
    if (trend === 'tribe') return c.tribeCell(id);
    const n = trend === 'rune' ? c.names?.runes[id] : c.names?.ancients[id];
    return `<span class="dk-hero">${n?.art ? c.img(n.art, 'dk-icon', 36) : ''}<span class="dk-heroname">${esc(n?.name ?? titleCase(id))}</span></span>`;
  };
  const trendRows = (rows: TrendItem[]) => rows.length === 0 ? `<p class="dk-empty">No ranked ${TREND_LABEL[trend].toLowerCase()} data in this range.</p>`
    : `<div class="dk-tablewrap"><table><thead><tr><th>${TREND_LABEL[trend].replace(/s$/, '')}</th><th>Games</th><th>Avg place</th><th>Top 4</th><th>Avg place per ${h.trendBucket} <span class="dk-sub">(up is better)</span></th></tr></thead><tbody>${rows.map((r) =>
      `<tr class="${r.games < LOW_SAMPLE ? 'low' : ''}"><td>${lead(r.id)}</td><td class="dk-num">${int(r.games)}</td><td>${place(r.avgPlacement)}</td><td>${pct(r.top4Rate)}</td><td><span class="dk-trendcell">${trendSpark(r.series, 140)}${drift(r)}</span></td></tr>`).join('')}</tbody></table></div>`;
  const rules = h.ops.retentionRules;
  const runs = h.ops.retentionRuns ?? [];
  return `
    <div class="dk-split">
      ${section('Daily health check', st?.last_cron_at ? `last run ${esc(new Date(st.last_cron_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : 'not reported',
        `<div class="dk-healthhead">${st?.cron_overdue ? statusPill('fail') + '<span>The daily run is overdue</span>' : failing ? statusPill('fail') + `<span>${failing} check${failing === 1 ? '' : 's'} failing</span>` : statusPill(st ? 'ok' : 'n/a') + `<span>${st ? 'All checks passing' : 'Not set up'}</span>`}</div>${ops}`)}
      ${section('Database', `Free plan: ${mb(db.limitBytes)}`, `<div class="dk-dbhead"><span class="dk-statval">${mb(db.bytes)}</span><span class="dk-sub">${pct(db.bytes / db.limitBytes, 0)} of the limit</span></div>
        <div class="dk-meterwrap">${meter(db.bytes, db.limitBytes, 360)}</div>
        ${barList(db.tables.map((t) => ({ label: t.table, n: Math.round(t.bytes / 1048576) })), 'MB')}`)}
    </div>
    ${section(`Crash and bug reports per ${h.bucket}`, `<b>${int(h.crashes.total)}</b> crashes · <b>${int(h.bugs.total)}</b> bug reports`,
      `${legend([[5, 'Crash reports'], [2, 'Bug reports']])}<div class="dk-chart">${lines(labels, [
        { label: 'Crash reports', values: h.crashes.series.map((x) => x.crashes), slot: 5 },
        { label: 'Bug reports', values: h.crashes.series.map((x) => x.bugs), slot: 2, area: false }], c.chartWidth, 180)}</div>
      <div class="dk-split inner">
        <div><h3 class="dk-h3">Crashes by build</h3>${barList(h.crashes.byBuild.map((x) => ({ label: x.build, n: x.n })), '')}</div>
        <div><h3 class="dk-h3">Crashes by last step</h3>${barList(h.crashes.byStep.map((x) => ({ label: x.step, n: x.n })), '')}</div>
        <div><h3 class="dk-h3">Bug reports</h3><div class="dk-chips">${Object.entries(h.bugs.byStatus).map(([k, n]) => `<span class="dk-chip">${esc(k)} ${n}</span>`).join('')}</div>
          <div class="dk-chips">${Object.entries(h.bugs.bySeverity).map(([k, n]) => `<span class="dk-chip">${esc(k)} ${n}</span>`).join('')}</div></div>
      </div>`)}
    ${section('Retention cleanup', rules ? 'The nightly delete run (ops.retention_rules)' : 'Not set up', rules ? `<div class="dk-tablewrap"><table><thead><tr><th>Rule</th><th>Keeps</th><th>Last run</th><th>Last deleted</th><th>Total deleted</th><th>Status</th></tr></thead><tbody>${rules.map((x) =>
      `<tr><td>${esc(x.rule)}</td><td>${x.keepDays} days</td><td>${x.lastCheckedAt ? esc(new Date(x.lastCheckedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) : 'never'}${x.lastDryRun ? ' <span class="dk-sub">dry run</span>' : ''}</td><td>${x.lastDeleted == null ? 'n/a' : int(x.lastDeleted)}</td><td class="dk-num">${int(x.totalDeleted)}</td><td>${x.lastError ? statusPill('fail') : x.enabled ? statusPill('ok') : statusPill('n/a')}</td></tr>`).join('')}</tbody></table></div>
      ${runs.length ? `<p class="dk-hint">Recent runs: ${runs.map((r) => `${esc(new Date(r.at).toLocaleDateString([], { day: 'numeric', month: 'short' }))} ${r.kind === 'error' ? 'failed' : r.kind === 'dry_run' ? 'dry run' : `deleted ${int(Number(r.deleted ?? 0))}`}`).join(' · ')}</p>` : ''}` : '<p class="dk-empty">The retention migration is not applied.</p>')}
    ${section('Balance trends', `Ranked lobby games · per ${h.trendBucket} · dim rows have fewer than ${LOW_SAMPLE} games`,
      `<div class="dk-tabs" id="trend-kind" role="group" aria-label="Trend">${TREND_KINDS.map((k) => `<button type="button" class="dk-tab" data-v="${k}" aria-pressed="${k === trend}">${TREND_LABEL[k]}</button>`).join('')}</div>${trendRows(items)}`)}`;
}
