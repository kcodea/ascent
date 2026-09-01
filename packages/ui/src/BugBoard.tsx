import { useEffect, useMemo, useState } from 'react';

/**
 * BUG BOARD — the owner's in-game bug inbox (DEV MENU → 🐛 Bug Board).
 *
 * Lists every `bug_reports` row (minus the heavy `report` capsule) through the dev server's
 * `bugBoardPlugin` endpoints, so the owner can, without leaving the game:
 *   · read reports (each row self-contained: quoted player text, where it happened, patch, dupe count);
 *   · set status/severity with a click (each change POSTs `/__bugboard/update` immediately);
 *   · hand-pick a STACK — checkbox a row into the side panel, ▲▼ to order it;
 *   · SEND TO CLAUDE — the stack if one exists, else every open report in the current sort. One POST to
 *     `/__bugboard/work-order` stamps priority 1..N in Supabase and writes
 *     `.local/bug-reports/work-order.json`, then the board says the exact next step.
 *
 * Dev-only (mounted from DevMenu, stripped from production). Degrades gracefully: the endpoints 404 in a
 * prod build and 503 `not_configured` without the service key — both render as hints, never crashes.
 * Filters/sort are plain state, no persistence — the durable artifacts are Supabase + work-order.json.
 */

export interface BugBoardRow {
  id: string;
  created_at: string;
  status: string;
  severity: string | null;
  priority: number | null;
  issue_type: string;
  description: string;
  patch: string;
  mode: string;
  set_id: string;
  hero_id: string;
  seed: number;
  wave: number;
  phase: string;
  fingerprint: string | null;
  duplicate_of: string | null;
}

export type BugSort = 'priority' | 'newest' | 'dupes';

export const BUG_BOARD_STATUSES = ['new', 'triaged', 'reproduced', 'needs_info', 'fixed', 'closed', 'duplicate'] as const;
export const BUG_BOARD_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
/**
 * "Open" = still needs work. Drives BOTH what the board shows by default (owner ask 2026-08-31: *"the bug
 * board should only show unresolved bugs. any resolved/fixed bugs should go away"*) and what "Send to Claude"
 * ships when no stack is hand-picked.
 *
 * `reproduced` JOINED THIS LIST on 2026-08-31, and its absence was a quiet bug of its own: a report confirmed
 * to reproduce is the most actionable kind there is, and it was being left out of every default work order —
 * triaging a bug to `reproduced` silently removed it from the queue it most belonged in.
 *
 * The RESOLVED statuses are the complement: `fixed`, `closed`, `duplicate`. They are hidden by default, not
 * deleted — the `all` filter still reaches them, because a board that can't show you what was already fixed
 * can't tell you a bug came back.
 */
export const OPEN_STATUSES: readonly string[] = ['new', 'triaged', 'reproduced', 'needs_info'];
/** The filter value that means "every open status", as opposed to one named status or `all`. */
export const UNRESOLVED_FILTER = 'unresolved';

const ISSUE_ICONS: Record<string, string> = {
  mechanics: '⚙️', presentation: '🎬', text_mismatch: '📝', softlock: '🧊',
  performance: '🐢', ui: '🖱️', other: '❓',
};

const STATUS_COLORS: Record<string, string> = {
  new: '#c2503f', triaged: '#b8963f', reproduced: '#7a5fb0', needs_info: '#3f7fa8',
  fixed: '#3d7a4a', closed: '#5a5f70', duplicate: '#5a5f70',
};

/** Sort rows by the board's current sort. Pure (does not mutate). */
export function sortBoardRows(rows: BugBoardRow[], sort: BugSort, dupeCounts: Record<string, number>): BugBoardRow[] {
  const dupes = (r: BugBoardRow): number => (r.fingerprint ? dupeCounts[r.fingerprint] ?? 1 : 1);
  const newest = (a: BugBoardRow, b: BugBoardRow): number => b.created_at.localeCompare(a.created_at);
  const byPriority = (a: BugBoardRow, b: BugBoardRow): number => {
    if (a.priority === null && b.priority === null) return newest(a, b);
    if (a.priority === null) return 1;
    if (b.priority === null) return -1;
    return a.priority - b.priority || newest(a, b);
  };
  const cmp = sort === 'priority' ? byPriority
    : sort === 'dupes' ? (a: BugBoardRow, b: BugBoardRow): number => dupes(b) - dupes(a) || newest(a, b)
      : newest;
  return [...rows].sort(cmp);
}

/** The default work order when nothing is hand-picked: every open report, in the current sort. Pure. */
export function defaultStackOf(rows: BugBoardRow[], sort: BugSort, dupeCounts: Record<string, number>): string[] {
  return sortBoardRows(rows.filter((r) => OPEN_STATUSES.includes(r.status)), sort, dupeCounts).map((r) => r.id);
}

/** Move `id` one step up/down inside the picked stack. Pure (returns the same array when it can't move). */
export function moveInStack(stack: string[], id: string, dir: -1 | 1): string[] {
  const i = stack.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= stack.length) return stack;
  const next = [...stack];
  next[i] = next[j]!;
  next[j] = id;
  return next;
}

/** Row counts by status, for the header. Pure. */
export function statusCountsOf(rows: BugBoardRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

interface ListResponse { rows: BugBoardRow[]; dupeCounts: Record<string, number> }

export function BugBoard({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<BugBoardRow[]>([]);
  const [dupeCounts, setDupeCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null); // setup/availability hint — the board still renders
  const [error, setError] = useState<string | null>(null); // transient action error
  // Defaults to UNRESOLVED (owner ask 2026-08-31). A board that opens on everything ever filed buries the
  // handful of rows that still need work under the ones that don't.
  const [statusFilter, setStatusFilter] = useState<string>(UNRESOLVED_FILTER);
  const [typeFilter, setTypeFilter] = useState('all');
  const [patchFilter, setPatchFilter] = useState('all');
  const [sort, setSort] = useState<BugSort>('priority');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stack, setStack] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/__bugboard/list');
        if (!alive) return;
        if (res.status === 404) { setHint('Bug Board endpoints are dev-server-only — run the game via `npm run dev`.'); return; }
        const body = await res.json() as ListResponse & { error?: string; hint?: string; detail?: string };
        if (!alive) return;
        if (!res.ok) { setHint(body.hint ?? body.detail ?? body.error ?? 'list failed'); return; }
        setRows(body.rows);
        setDupeCounts(body.dupeCounts);
      } catch {
        if (alive) setHint('Bug Board endpoints unreachable — run the game via `npm run dev`.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const patches = useMemo(() => [...new Set(rows.map((r) => r.patch))].sort().reverse(), [rows]);
  const types = useMemo(() => [...new Set(rows.map((r) => r.issue_type))].sort(), [rows]);
  const counts = useMemo(() => statusCountsOf(rows), [rows]);

  const visible = useMemo(() => sortBoardRows(
    rows.filter((r) =>
      (statusFilter === 'all' || (statusFilter === UNRESOLVED_FILTER ? OPEN_STATUSES.includes(r.status) : r.status === statusFilter))
      && (typeFilter === 'all' || r.issue_type === typeFilter)
      && (patchFilter === 'all' || r.patch === patchFilter)),
    sort, dupeCounts,
  ), [rows, statusFilter, typeFilter, patchFilter, sort, dupeCounts]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const update = async (id: string, patch: { status?: string; severity?: string | null }): Promise<void> => {
    setError(null);
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); // optimistic — reverted on failure
    try {
      const res = await fetch('/__bugboard/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        setRows(prev);
        const body = await res.json() as { error?: string; hint?: string };
        setError(body.hint ?? body.error ?? 'update failed');
      }
    } catch {
      setRows(prev);
      setError('dev server unreachable — the board only writes while `npm run dev` is serving');
    }
  };

  const sendToClaude = async (): Promise<void> => {
    setError(null);
    setSent(null);
    const ids = stack.length > 0 ? stack : defaultStackOf(rows, sort, dupeCounts);
    if (ids.length === 0) { setError('nothing to send — no open reports'); return; }
    try {
      const res = await fetch('/__bugboard/work-order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedReportIds: ids }),
      });
      const body = await res.json() as { ok?: boolean; count?: number; error?: string; hint?: string; detail?: string };
      if (!res.ok) { setError(body.hint ?? body.detail ?? body.error ?? 'work order failed'); return; }
      setRows((rs) => rs.map((r) => {
        const i = ids.indexOf(r.id);
        return i >= 0 ? { ...r, priority: i + 1 } : r;
      }));
      setSent(`work-order.json written (${ids.length} bug${ids.length === 1 ? '' : 's'}) — tell Claude: "fix the bug stack"`);
    } catch {
      setError('dev server unreachable — the board only writes while `npm run dev` is serving');
    }
  };

  const toggleExpanded = (id: string): void => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const togglePicked = (id: string): void =>
    setStack((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(10, 12, 20, 0.96)', color: '#e8e4d8',
      display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #3a3f55', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 16 }}>🐛 Bug Board</strong>
        <span data-testid="status-counts" style={{ opacity: 0.75, fontSize: 13 }}>
          {rows.length === 0 ? 'no reports' : BUG_BOARD_STATUSES.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(' · ')}
        </span>
        <button onClick={() => void sendToClaude()} style={{ ...btn('#3d5a3d'), marginLeft: 'auto', fontSize: 13, padding: '6px 14px' }}>
          🚀 Send to Claude {stack.length > 0 ? `(stack of ${stack.length})` : '(all open)'}
        </button>
        <button onClick={onClose} style={btn('#6b3030')}>✕ Close</button>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid #2a2e40' }}>
        <span style={pillLabel}>status</span>
        <button onClick={() => setStatusFilter(UNRESOLVED_FILTER)} style={btn(statusFilter === UNRESOLVED_FILTER ? '#3d5a3d' : '#2a2e40')} title="Every report that still needs work — the default">
          unresolved ({OPEN_STATUSES.reduce((n, st) => n + (counts[st] ?? 0), 0)})
        </button>
        <button onClick={() => setStatusFilter('all')} style={btn(statusFilter === 'all' ? '#3d5a3d' : '#2a2e40')} title="Including fixed, closed and duplicates">all</button>
        {BUG_BOARD_STATUSES.filter((s) => counts[s]).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} style={btn(statusFilter === s ? '#3d5a3d' : '#2a2e40')}>{s} ({counts[s]})</button>
        ))}
        <span style={{ ...pillLabel, marginLeft: 10 }}>type</span>
        <button onClick={() => setTypeFilter('all')} style={btn(typeFilter === 'all' ? '#3d5a3d' : '#2a2e40')}>all</button>
        {types.map((t) => (
          <button key={t} onClick={() => setTypeFilter(t)} style={btn(typeFilter === t ? '#3d5a3d' : '#2a2e40')}>{ISSUE_ICONS[t] ?? '❓'} {t}</button>
        ))}
        <span style={{ ...pillLabel, marginLeft: 10 }}>patch</span>
        <button onClick={() => setPatchFilter('all')} style={btn(patchFilter === 'all' ? '#3d5a3d' : '#2a2e40')}>all</button>
        {patches.map((p) => (
          <button key={p} onClick={() => setPatchFilter(p)} style={btn(patchFilter === p ? '#3d5a3d' : '#2a2e40')}>{p}</button>
        ))}
        <span style={{ ...pillLabel, marginLeft: 10 }}>sort</span>
        {(['priority', 'newest', 'dupes'] as const).map((s) => (
          <button key={s} onClick={() => setSort(s)} style={btn(sort === s ? '#3d5a3d' : '#2a2e40')}>{s}</button>
        ))}
      </div>

      {hint && <div style={{ padding: '6px 16px', color: '#e6d9a8', fontSize: 13 }}>⚠ {hint}</div>}
      {error && <div style={{ padding: '6px 16px', color: '#ff9d9d', fontSize: 13 }}>{error}</div>}
      {sent && <div data-testid="sent-confirmation" style={{ padding: '6px 16px', color: '#a9c6a9', fontSize: 13 }}>✓ {sent}</div>}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 16px' }}>
          {loading && <div style={{ opacity: 0.6, padding: 30, textAlign: 'center' }}>Loading reports…</div>}
          {!loading && visible.length === 0 && (
            <div style={{ opacity: 0.6, padding: 30, textAlign: 'center' }}>
              {rows.length === 0 ? 'No bug reports yet.' : 'Nothing matches these filters.'}
            </div>
          )}
          {visible.map((r) => {
            const dupes = r.fingerprint ? dupeCounts[r.fingerprint] ?? 1 : 1;
            const long = r.description.length > 180;
            const open = expanded.has(r.id);
            const picked = stack.includes(r.id);
            return (
              <div key={r.id} data-testid={`bug-row-${r.id}`} style={{
                border: `1px solid ${picked ? '#5a7a5a' : '#3a3f55'}`, borderRadius: 8, padding: '8px 12px', marginBottom: 8,
                background: r.status === 'new' ? '#1c1620' : '#161a28',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11, opacity: 0.9 }}>
                    <input type="checkbox" checked={picked} onChange={() => togglePicked(r.id)} aria-label={`pick ${r.id}`} />
                    pick
                  </label>
                  <span title={r.issue_type} style={{ fontSize: 14 }}>{ISSUE_ICONS[r.issue_type] ?? '❓'}</span>
                  <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: STATUS_COLORS[r.status] ?? '#5a5f70', color: '#14151c', fontWeight: 700 }}>
                    {r.status}
                  </span>
                  {r.priority !== null && <span style={{ fontSize: 11, color: '#e6d9a8' }}>#{r.priority}</span>}
                  {dupes > 1 && (
                    <span title={`${dupes} reports share this fingerprint`} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#5a5030', color: '#f0e6c0', fontWeight: 700 }}>
                      ×{dupes}
                    </span>
                  )}
                  <span style={{ fontSize: 11, opacity: 0.65 }}>
                    {/* A MENU report carries sentinels only (hero 'none', seed/wave 0) — show a clean "menu"
                        badge line instead of the run identity. */}
                    {r.phase === 'menu'
                      ? `— · menu · ${r.set_id}`
                      : `${r.hero_id} · wave ${r.wave} · ${r.phase} · ${r.mode} · ${r.set_id} · seed ${r.seed}`}
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 'auto' }}>{r.patch} · {r.created_at.slice(0, 16).replace('T', ' ')}</span>
                </div>

                <div
                  onClick={long ? () => toggleExpanded(r.id) : undefined}
                  role={long ? 'button' : undefined}
                  style={{
                    fontSize: 12.5, margin: '6px 0 4px', padding: '5px 10px', borderLeft: '3px solid #3f7fa8',
                    background: '#131722', borderRadius: 4, lineHeight: 1.45, color: '#c9d4e4', fontStyle: 'italic',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  “{long && !open ? `${r.description.slice(0, 180)}…` : r.description}”
                  {long && <span style={{ fontStyle: 'normal', fontSize: 11, opacity: 0.6 }}> {open ? '(less)' : '(more)'}</span>}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center', opacity: 0.9 }}>
                    status
                    <select
                      value={r.status} aria-label={`status of ${r.id}`}
                      onChange={(e) => void update(r.id, { status: e.target.value })}
                      style={sel}
                    >
                      {BUG_BOARD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center', opacity: 0.9 }}>
                    severity
                    <select
                      value={r.severity ?? ''} aria-label={`severity of ${r.id}`}
                      onChange={(e) => void update(r.id, { severity: e.target.value === '' ? null : e.target.value })}
                      style={sel}
                    >
                      <option value="">—</option>
                      {BUG_BOARD_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  {r.duplicate_of && <span style={{ fontSize: 11, opacity: 0.6 }}>dupe of {r.duplicate_of.slice(0, 8)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {stack.length > 0 && (
          <div data-testid="stack-panel" style={{ width: 280, borderLeft: '1px solid #3a3f55', padding: '10px 12px', overflowY: 'auto', background: '#12151f' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>The stack — fix in this order</div>
            {stack.map((id, i) => {
              const r = byId.get(id);
              return (
                <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 12, border: '1px solid #3a3f55', borderRadius: 6, padding: '4px 8px', background: '#161a28' }}>
                  <span style={{ opacity: 0.7, minWidth: 18 }}>{i + 1}.</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r?.description}>
                    {ISSUE_ICONS[r?.issue_type ?? ''] ?? '❓'} {r?.description ?? id}
                  </span>
                  <button aria-label={`move ${id} up`} onClick={() => setStack((s) => moveInStack(s, id, -1))} style={btnTiny}>▲</button>
                  <button aria-label={`move ${id} down`} onClick={() => setStack((s) => moveInStack(s, id, 1))} style={btnTiny}>▼</button>
                  <button aria-label={`remove ${id}`} onClick={() => togglePicked(id)} style={{ ...btnTiny, background: '#6b3030' }}>✕</button>
                </div>
              );
            })}
            <button onClick={() => setStack([])} style={{ ...btn('#2a2e40'), marginTop: 6 }}>clear stack</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** House rule: never a bare `cursor: pointer` — the global button rule paints the gauntlet. */
const btn = (bg: string): React.CSSProperties => ({
  background: bg, color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6,
  padding: '5px 12px', fontSize: 12,
});

const btnTiny: React.CSSProperties = {
  background: '#2a2e40', color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 4,
  padding: '1px 6px', fontSize: 11,
};

const sel: React.CSSProperties = {
  background: '#0e1120', color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6,
  padding: '2px 6px', fontSize: 12,
};

const pillLabel: React.CSSProperties = { fontSize: 11, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.05em' };
