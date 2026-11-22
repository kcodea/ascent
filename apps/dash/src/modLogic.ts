// The Moderation tab's pure logic (no DOM), so it is unit tested: names, labels, the confirm text, the action bodies,
// the log lines, the tab's count and the view in the URL hash.
import type { DmReport, FlagKind, LogEntry, ModAction, NameFlag, Who } from './modTypes';

export type View = 'analytics' | 'moderation';

/** `#range=7d&view=moderation` -> moderation; anything else is the analytics view. */
export function viewOfHash(hash: string): View {
  return new URLSearchParams(hash.replace(/^#/, '')).get('view') === 'moderation' ? 'moderation' : 'analytics';
}
/** The analytics hash with the view added (the analytics view keeps its hash exactly as before). */
export function withView(hash: string, view: View): string {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  if (view === 'moderation') q.set('view', 'moderation');
  else q.delete('view');
  const s = q.toString();
  return s ? `#${s}` : '#';
}

/** `Kevin#1111`, `Kevin` with no tag, or a short id when the account has no name at all. */
export function handle(w: Who | null | undefined): string {
  if (!w) return 'Unknown player';
  if (w.name) return w.tag ? `${w.name}#${w.tag}` : w.name;
  return `No name (${w.id.slice(0, 8)})`;
}

/** The open items the Moderation tab's count shows (reports + names). */
export const openCount = (c: { reports: number; names: number } | null | undefined): number => (c ? c.reports + c.names : 0);

export const KIND_LABEL: Record<FlagKind, string> = { account: 'Account', team: 'Duos team', room: 'Versus room' };
export const REASON_LABEL: Record<DmReport['reason'], string> = { abuse: 'Abuse', spam: 'Spam', cheating: 'Cheating', other: 'Other' };

/** What a reset does, said before it happens (the in-page confirm step). */
export function resetConfirmText(kind: 'account' | 'team', name: string | null): string {
  const was = name ? `"${name}"` : 'this name';
  return kind === 'account'
    ? `Reset ${was} to "Player"? The #tag stays unless Player already has it. They cannot take this name back. This is logged.`
    : `Clear the team name ${was}? The team shows its default "Name & Name" again. They cannot take this name back. This is logged.`;
}

/** The current name of a flag's target, when it moved since the flag (renamed, or already reset). */
export function currentNameNote(f: NameFlag): string | null {
  if (f.kind === 'room') return null;
  if (!f.current.exists) return 'Gone (deleted)';
  const now = f.current.name ?? null;
  if (now === f.name) return null;
  if (now == null) return f.kind === 'team' ? 'Now: the default name' : 'Now: no name';
  return `Now: ${f.kind === 'account' && f.current.tag ? `${now}#${f.current.tag}` : now}`;
}

const trimNote = (note: string | undefined): string | undefined => {
  const t = (note ?? '').trim();
  return t ? t.slice(0, 500) : undefined;
};
export const reviewAction = (reportId: string, note?: string): ModAction => ({ action: 'review', reportId, ...(trimNote(note) ? { note: trimNote(note) } : {}) });
export const clearAction = (flagId: string, note?: string): ModAction => ({ action: 'clear', flagId, ...(trimNote(note) ? { note: trimNote(note) } : {}) });
export const resetAction = (kind: 'account' | 'team', targetId: string, note?: string): ModAction =>
  ({ action: 'reset', kind, targetId, ...(trimNote(note) ? { note: trimNote(note) } : {}) });

/** The SQL's refusals (409) and the guard's, in plain words. */
export const ACTION_ERROR: Record<string, string> = {
  not_found: 'That item is gone. The list has been refreshed.',
  not_open: 'Someone already handled that one. The list has been refreshed.',
  bad_kind: 'A Versus room cannot be reset from here. It lives only while the room is open.',
  bad_target: 'That id is not valid.',
  no_free_tag: 'No free #tag for "Player" right now. Try again.',
  name_blocked: 'That name is not allowed.',
};

const nameOf = (v: Record<string, unknown> | null): string => {
  if (!v) return '';
  const n = v.name == null ? 'the default name' : String(v.name);
  return v.tag ? `${n}#${String(v.tag)}` : n;
};

/** One log row as a plain sentence. */
export function logLine(e: LogEntry): string {
  switch (e.action) {
    case 'review_report': return 'Marked a DM report reviewed';
    case 'clear_flag': return `Cleared the flag on ${(KIND_LABEL[(e.kind ?? 'account') as FlagKind] ?? String(e.kind)).toLowerCase()} "${nameOf(e.before)}"`;
    case 'reset_name': return `Reset ${e.kind === 'team' ? 'team' : 'account'} name "${nameOf(e.before)}" to ${e.kind === 'team' ? 'the default name' : `"${nameOf(e.after)}"`}`;
    default: return String(e.action);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `22 Nov 14:05` in the viewer's clock; `5m ago` style when it is recent. */
export function when(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((nowMs - t) / 1000);
  if (s >= 0 && s < 60) return 'just now';
  if (s >= 0 && s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s >= 0 && s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Reported 3 times (2 open)" for the sender. */
export function reportCountLabel(r: DmReport): string {
  const n = r.senderReports;
  const base = n === 1 ? 'First report' : `Reported ${n} times`;
  return r.senderOpen > 1 ? `${base} (${r.senderOpen} open)` : base;
}
