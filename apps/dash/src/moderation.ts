// The Moderation tab (owner 2026-11-22: "build the reporting dash and account name and party name flags"): the DM report
// queue, the flagged names with a search over every account and team, and the action log. Reads GET
// /api/moderation/queue + /search, acts through POST /api/moderation/action (src/server/moderation.ts). Every name and
// message on this page was typed by a player, so every one goes through esc(). The confirm step for Reset name is
// built into the card (no window.confirm). PERFORMANCE: static paint, one delegated click listener, no layout reads.
import { esc } from './format';
import {
  ACTION_ERROR, KIND_LABEL, REASON_LABEL, clearAction, currentNameNote, handle, logLine, openCount, reportCountLabel, resetAction,
  resetConfirmText, reviewAction, when,
} from './modLogic';
import type { DmReport, ModAction, ModQueue, ModSearch, NameFlag, NamesFilter, ReportsFilter, Who } from './modTypes';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const POLL_MS = 60_000;

/** A Reset name waiting for its confirm: which card asked (so only that card shows the confirm panel). */
interface PendingReset { at: string; kind: 'account' | 'team'; targetId: string; name: string | null }

const mod = {
  queue: null as ModQueue | null,
  search: null as ModSearch | null,
  reports: 'open' as ReportsFilter,
  names: 'open' as NamesFilter,
  confirm: null as PendingReset | null,
  busy: null as string | null,
  seq: 0,
  onCount: (_n: number): void => {},
};

const ERROR_TEXT: Record<number, string> = {
  401: 'Not signed in through Cloudflare Access (or the login expired). Reload the page to sign in again.',
  403: 'This account is not on the dashboard allow-list.',
  500: 'The dashboard is not configured yet. See apps/dash/README.md for the secrets it needs.',
  502: 'The database did not answer. Try again in a minute.',
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let code = '';
    try { code = String(((await res.json()) as { error?: unknown }).error ?? ''); } catch { /* not JSON */ }
    throw Object.assign(new Error(ACTION_ERROR[code] ?? ERROR_TEXT[res.status] ?? `Request failed (${res.status}).`), { status: res.status, code });
  }
  return (await res.json()) as T;
}

function showError(e: unknown): void {
  const el = $('mod-error');
  el.textContent = e instanceof Error ? e.message : 'Something went wrong.';
  el.hidden = false;
}

/** Re-read the queue (fresh = skip the server's 60 s cache, after an action). */
export async function loadQueue(fresh = false): Promise<void> {
  const seq = ++mod.seq;
  const q = new URLSearchParams({ reports: mod.reports, names: mod.names });
  if (fresh) q.set('fresh', '1');
  try {
    const data = await call<ModQueue>(`/api/moderation/queue?${q}`);
    if (seq !== mod.seq) return;
    mod.queue = data;
    $('mod-error').hidden = true;
  } catch (e) {
    if (seq !== mod.seq) return;
    showError(e);
  }
  mod.onCount(openCount(mod.queue?.counts));
  render();
}

async function runSearch(q: string): Promise<void> {
  if (!q.trim()) { mod.search = null; renderSearch(); return; }
  try {
    mod.search = await call<ModSearch>(`/api/moderation/search?${new URLSearchParams({ q: q.trim() })}`);
  } catch (e) {
    showError(e);
  }
  renderSearch();
}

async function act(key: string, body: ModAction): Promise<void> {
  if (mod.busy) return;
  mod.busy = key;
  render();
  try {
    await call('/api/moderation/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dash-action': '1' },
      body: JSON.stringify(body),
    });
    mod.confirm = null;
    $('mod-error').hidden = true;
  } catch (e) {
    showError(e);
  } finally {
    mod.busy = null;
  }
  await loadQueue(true);
  const q = ($('mod-q') as HTMLInputElement).value;
  if (mod.search && q.trim()) await runSearch(q);
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────────────────
const chip = (text: string, cls = ''): string => `<span class="dk-chip${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;
const dis = (key: string): string => (mod.busy ? ' disabled' : '') + (mod.busy === key ? ' aria-busy="true"' : '');
const noteInput = (key: string, label: string): string =>
  `<label class="dk-notefield"><span class="dk-visually-hidden">${esc(label)}</span><input class="dk-well dk-note" type="text" maxlength="500" placeholder="Note (optional)" data-note="${esc(key)}" autocomplete="off" /></label>`;

function confirmPanel(at: string): string {
  const c = mod.confirm;
  if (!c || c.at !== at) return '';
  return `<div class="dk-confirm" role="group" aria-label="Confirm reset">
    <p>${esc(resetConfirmText(c.kind, c.name))}</p>
    <div class="dk-confirmrow">${noteInput(`confirm:${at}`, 'Note for the log')}
      <button type="button" class="dk-btn t-danger" data-act="confirm-reset"${dis(at)}>Reset name</button>
      <button type="button" class="dk-btn v-ghost" data-act="cancel-reset">Cancel</button></div>
  </div>`;
}

function whoLine(w: Who | null): string {
  return `<span class="dk-who">${esc(handle(w))}</span>`;
}

function reportCard(r: DmReport): string {
  const key = `report:${r.id}`;
  const lines = r.context.length ? r.context : [{ id: r.messageId, by: 'reported' as const, body: r.body, at: r.sentAt }];
  const convo = lines.map((l) => {
    const hit = l.id === r.messageId;
    const name = l.by === 'reported' ? handle(r.sender) : handle(r.reporter);
    return `<li class="by-${l.by}${hit ? ' is-hit' : ''}"><span class="dk-convowho">${esc(name)}</span>
      <span class="dk-convobody">${esc(l.body)}</span><span class="dk-convoat">${esc(when(l.at))}${hit ? ' · reported' : ''}</span></li>`;
  }).join('');
  const open = r.status === 'open';
  const acts = open
    ? `<div class="dk-cardacts">${noteInput(key, 'Review note')}
        <button type="button" class="dk-btn" data-act="review"${dis(key)}>Mark reviewed</button>
        ${r.sender ? `<button type="button" class="dk-btn v-ghost" data-act="ask-reset" data-kind="account" data-target="${esc(r.sender.id)}" data-name="${esc(r.sender.name ?? '')}">Reset sender name</button>` : ''}</div>`
    : `<p class="dk-hint dk-reviewed">Reviewed by ${esc(r.reviewedBy ?? 'someone')} ${esc(r.reviewedAt ? when(r.reviewedAt) : '')}${r.note ? `: ${esc(r.note)}` : '.'}</p>
       ${r.sender ? `<div class="dk-cardacts"><button type="button" class="dk-btn v-ghost" data-act="ask-reset" data-kind="account" data-target="${esc(r.sender.id)}" data-name="${esc(r.sender.name ?? '')}">Reset sender name</button></div>` : ''}`;
  return `<article class="dk-card${open ? '' : ' is-done'}" data-key="${esc(key)}" data-report="${esc(r.id)}">
    <header class="dk-cardhead">
      <div class="dk-cardwho"><span class="dk-label">Reported player</span><span class="dk-rowtitle">${esc(handle(r.sender))}</span>
        <span class="dk-rowsub">${esc(reportCountLabel(r))} · reported by ${whoLine(r.reporter)}</span></div>
      <div class="dk-cardchips">${chip(REASON_LABEL[r.reason] ?? r.reason, r.reason === 'abuse' ? 't-red' : '')}${chip(when(r.createdAt))}${open ? '' : chip('Reviewed', 't-ok')}</div>
    </header>
    <ol class="dk-convo" aria-label="The conversation around the reported message">${convo}</ol>
    ${acts}${confirmPanel(key)}
  </article>`;
}

function flagCard(f: NameFlag): string {
  const key = `flag:${f.id}`;
  const now = currentNameNote(f);
  const open = f.status === 'open';
  const status = { open: 'Open', cleared: 'Looks fine', reset: 'Reset', closed: 'Renamed' }[f.status];
  const resetBtn = f.canReset
    ? `<button type="button" class="dk-btn v-ghost" data-act="ask-reset" data-kind="${esc(f.kind)}" data-target="${esc(f.targetId)}" data-name="${esc(f.current.name ?? f.name)}"${dis(key)}>Reset name</button>`
    : '<span class="dk-hint">A room name lives only while the room is open, so it cannot be reset here.</span>';
  const acts = open
    ? `<div class="dk-cardacts">${noteInput(key, 'Note')}<button type="button" class="dk-btn" data-act="clear"${dis(key)}>Looks fine</button>${resetBtn}</div>`
    : `<p class="dk-hint dk-reviewed">${esc(status)} by ${esc(f.reviewedBy ?? 'someone')} ${esc(f.reviewedAt ? when(f.reviewedAt) : '')}${f.note ? `: ${esc(f.note)}` : '.'}</p>`;
  const members = f.kind === 'team' && f.current.members ? ` · ${f.current.members.map((m) => esc(handle(m))).join(' & ')}` : '';
  return `<article class="dk-card dk-namecard${open ? '' : ' is-done'}" data-key="${esc(key)}" data-flag="${esc(f.id)}">
    <header class="dk-cardhead">
      <div class="dk-cardwho"><span class="dk-label">${esc(KIND_LABEL[f.kind])}</span><span class="dk-rowtitle dk-flagname">${esc(f.name)}</span>
        <span class="dk-rowsub">Matched <b>${esc(f.term ?? '?')}</b> · ${f.kind === 'account' ? 'account' : 'owner'} ${whoLine(f.owner)}${members} · ${esc(when(f.createdAt))}${now ? ` · ${esc(now)}` : ''}</span></div>
      <div class="dk-cardchips">${f.severity === 'block' ? chip('Slur, stored before the filter', 't-red') : ''}${chip(status, open ? 't-gold' : 't-ok')}</div>
    </header>
    ${acts}${confirmPanel(key)}
  </article>`;
}

function renderSearch(): void {
  const s = mod.search;
  const el = $('mod-search');
  if (!s) { el.innerHTML = ''; return; }
  const row = (kind: 'account' | 'team', id: string, name: string | null, sub: string, verdict: string, openFlag: boolean): string => {
    const key = `search:${kind}:${id}`;
    const canReset = name != null && !(kind === 'account' && name === 'Player');
    return `<article class="dk-card dk-hit" data-key="${esc(key)}">
      <header class="dk-cardhead"><div class="dk-cardwho"><span class="dk-label">${esc(KIND_LABEL[kind])}</span><span class="dk-rowtitle">${esc(name ?? 'Default name')}</span><span class="dk-rowsub">${sub}</span></div>
        <div class="dk-cardchips">${verdict !== 'ok' ? chip(verdict === 'block' ? 'Filter: blocked' : 'Filter: flagged', verdict === 'block' ? 't-red' : 't-gold') : ''}${openFlag ? chip('Open flag') : ''}
        ${canReset ? `<button type="button" class="dk-btn v-ghost" data-act="ask-reset" data-kind="${kind}" data-target="${esc(id)}" data-name="${esc(name ?? '')}"${dis(key)}>Reset name</button>` : ''}</div></header>
      ${confirmPanel(key)}
    </article>`;
  };
  const accounts = s.accounts.map((a) => row('account', a.id, a.name, `${esc(a.tag ? `#${a.tag}` : 'no tag')} · ${esc(a.id.slice(0, 8))}`, a.verdict.verdict, a.openFlag));
  const teams = s.teams.map((t) => row('team', t.id, t.name, t.members.map((m) => esc(handle(m))).join(' & '), t.verdict.verdict, t.openFlag));
  el.innerHTML = accounts.length + teams.length === 0
    ? `<p class="dk-empty">No account or team matches "${esc(s.q)}".</p>`
    : `<p class="dk-hint">${accounts.length} account${accounts.length === 1 ? '' : 's'}, ${teams.length} team${teams.length === 1 ? '' : 's'} for "${esc(s.q)}"</p><div class="dk-cards">${[...accounts, ...teams].join('')}</div>`;
}

function filterTabs(el: HTMLElement, items: Array<[string, string]>, current: string): void {
  el.innerHTML = items.map(([v, l]) => `<button type="button" class="dk-tab" data-filter="${v}" aria-pressed="${v === current}">${esc(l)}</button>`).join('');
}

/** A re-render (the 60 s poll, another card's action) keeps any note being typed, and its focus. */
function render(): void {
  const view = $('view-moderation');
  const notes = new Map<string, string>();
  for (const el of view.querySelectorAll<HTMLInputElement>('input[data-note]')) if (el.value) notes.set(el.dataset.note ?? '', el.value);
  const focused = (document.activeElement as HTMLInputElement | null)?.dataset?.note;
  paint();
  for (const el of view.querySelectorAll<HTMLInputElement>('input[data-note]')) {
    const v = notes.get(el.dataset.note ?? '');
    if (v) el.value = v;
    if (focused && el.dataset.note === focused) el.focus();
  }
}

function paint(): void {
  const q = mod.queue;
  filterTabs($('mod-reports-filter'), [['open', `Open${q ? ` (${q.counts.reports})` : ''}`], ['reviewed', 'Reviewed'], ['all', 'All']], mod.reports);
  filterTabs($('mod-names-filter'), [['open', `Open${q ? ` (${q.counts.names})` : ''}`], ['done', 'Done'], ['all', 'All']], mod.names);
  $('mod-tile-reports').innerHTML = `<span class="dk-statlbl">Open DM reports</span><span class="dk-statval">${q ? q.counts.reports : 'n/a'}</span><span class="dk-statsub">Players reporting a message sent to them</span>`;
  $('mod-tile-names').innerHTML = `<span class="dk-statlbl">Open name flags</span><span class="dk-statval">${q ? q.counts.names : 'n/a'}</span><span class="dk-statsub">Accounts, Duos teams and Versus rooms</span>`;
  const last = q?.log[0];
  $('mod-tile-log').innerHTML = `<span class="dk-statlbl">Last action</span><span class="dk-statval dk-statsmall">${last ? esc(when(last.at)) : 'None yet'}</span><span class="dk-statsub">${last ? `${esc(last.actor)}: ${esc(logLine(last))}` : 'Every action is logged below'}</span>`;
  if (!q) return;
  $('mod-reports').innerHTML = q.reports.length
    ? `<div class="dk-cards">${q.reports.map(reportCard).join('')}</div>`
    : `<p class="dk-empty">${mod.reports === 'open' ? 'No open reports. Nice and quiet.' : 'Nothing here.'}</p>`;
  $('mod-names').innerHTML = q.names.length
    ? `<div class="dk-cards">${q.names.map(flagCard).join('')}</div>`
    : `<p class="dk-empty">${mod.names === 'open' ? 'No flagged names waiting.' : 'Nothing here.'}</p>`;
  $('mod-log').innerHTML = q.log.length
    ? `<table class="dk-logtable"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Note</th></tr></thead><tbody>${q.log.map((e) =>
      `<tr><td>${esc(when(e.at))}</td><td>${esc(e.actor)}</td><td class="dk-logwhat">${esc(logLine(e))}</td><td class="dk-lognote">${esc(e.note ?? '')}</td></tr>`).join('')}</tbody></table>`
    : '<p class="dk-empty">No actions yet.</p>';
  renderSearch();
}

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
const noteOf = (root: Element, key: string): string =>
  (root.querySelector<HTMLInputElement>(`input[data-note="${CSS.escape(key)}"]`)?.value ?? '').trim();

let pollTimer = 0;
function schedule(): void {
  clearTimeout(pollTimer);
  if (!document.hidden) pollTimer = window.setTimeout(() => { void loadQueue().then(schedule); }, POLL_MS);
}

export function wireModeration(onCount: (n: number) => void): void {
  mod.onCount = onCount;
  const view = $('view-moderation');
  view.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn || btn.disabled) return;
    const filter = btn.dataset.filter;
    if (filter && btn.closest('#mod-reports-filter')) { mod.reports = filter as ReportsFilter; void loadQueue(); return; }
    if (filter && btn.closest('#mod-names-filter')) { mod.names = filter as NamesFilter; void loadQueue(); return; }
    const card = btn.closest<HTMLElement>('[data-key]');
    const key = card?.dataset.key;
    if (!card || !key) return;
    switch (btn.dataset.act) {
      case 'review': if (card.dataset.report) void act(key, reviewAction(card.dataset.report, noteOf(card, key))); break;
      case 'clear': if (card.dataset.flag) void act(key, clearAction(card.dataset.flag, noteOf(card, key))); break;
      case 'ask-reset':
        mod.confirm = { at: key, kind: btn.dataset.kind === 'team' ? 'team' : 'account', targetId: btn.dataset.target ?? '', name: btn.dataset.name || null };
        render();
        view.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(key)}"] [data-act="confirm-reset"]`)?.focus();
        break;
      case 'cancel-reset': mod.confirm = null; render(); break;
      case 'confirm-reset': {
        const c = mod.confirm;
        if (c && c.at === key && c.targetId) void act(key, resetAction(c.kind, c.targetId, noteOf(card, `confirm:${key}`)));
        break;
      }
    }
  });
  view.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && mod.confirm) { mod.confirm = null; render(); } });
  $('mod-search-form').addEventListener('submit', (ev) => { ev.preventDefault(); void runSearch(($('mod-q') as HTMLInputElement).value); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadQueue().then(schedule); else clearTimeout(pollTimer); });
  void loadQueue().then(schedule); // the tab's count shows on the Analytics view too
}

/** The view became visible: read it now. */
export function showModeration(): void {
  void loadQueue();
}
