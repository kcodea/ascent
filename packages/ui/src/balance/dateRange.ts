/**
 * THE BALANCE REPORT'S DATE RANGE (owner ask 2026-11-19: "we need the ability to filter data by date ranges").
 *
 * One `DateRange` value drives everything: the server fetch (`created_at >= from AND created_at < to`), the client scope
 * (`ReportScope.fromIso` / `toIso`, so every view, the detailed tables and the export read the same rows) and the header.
 *
 * MAPPING TO THE STORED TIMESTAMPS. `run_telemetry.created_at` is a UTC instant. A custom From / To pick is a pair of
 * LOCAL calendar days, both inclusive: From maps to local midnight at the start of that day, To to local midnight at
 * the start of the FOLLOWING day, used as an EXCLUSIVE bound. Both are converted to UTC ISO instants with
 * `Date#toISOString`, so a player in UTC-5 picking Nov 12 to Nov 19 reads 2026-11-12T05:00Z to 2026-11-20T05:00Z.
 * Presets are rolling (Last 24 hours = now minus 24 h, open-ended); "Since a patch" starts at local midnight of the
 * patch day. Pure: `now` is passed in.
 */
import { PATCH_NOTES } from '../patchNotes';

export type RangePreset = '24h' | '3d' | '7d' | '30d' | 'all';
export type DateRange =
  | { kind: 'preset'; preset: RangePreset }
  | { kind: 'since'; day: string; label: string }
  | { kind: 'custom'; from: string; to: string };

export const ALL_TIME: DateRange = { kind: 'preset', preset: 'all' };
export const PRESETS: { preset: RangePreset; label: string }[] = [
  { preset: '24h', label: 'Last 24 hours' }, { preset: '3d', label: 'Last 3 days' }, { preset: '7d', label: 'Last 7 days' },
  { preset: '30d', label: 'Last 30 days' }, { preset: 'all', label: 'All time' },
];
const HOURS: Record<Exclude<RangePreset, 'all'>, number> = { '24h': 24, '3d': 72, '7d': 168, '30d': 720 };

/** A YYYY-MM-DD local day as the local-midnight Date, or null when malformed. */
export function localDayStart(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The UTC instant bounds of a range: `fromIso` inclusive, `toIso` exclusive, null = open. */
export function rangeBounds(r: DateRange, now: Date): { fromIso: string | null; toIso: string | null } {
  if (r.kind === 'preset') {
    if (r.preset === 'all') return { fromIso: null, toIso: null };
    return { fromIso: new Date(now.getTime() - HOURS[r.preset] * 3600_000).toISOString(), toIso: null };
  }
  if (r.kind === 'since') {
    const d = localDayStart(r.day);
    return { fromIso: d ? d.toISOString() : null, toIso: null };
  }
  const from = r.from ? localDayStart(r.from) : null;
  const to = r.to ? localDayStart(r.to) : null;
  if (to) to.setDate(to.getDate() + 1); // the inclusive last day ends at the next local midnight (DST-safe: setDate)
  // A reversed pick is read in order rather than as an empty range.
  if (from && to && from.getTime() >= to.getTime()) {
    const a = localDayStart(r.to)!, b = localDayStart(r.from)!;
    b.setDate(b.getDate() + 1);
    return { fromIso: a.toISOString(), toIso: b.toISOString() };
  }
  return { fromIso: from ? from.toISOString() : null, toIso: to ? to.toISOString() : null };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 12" for a local day / instant. */
export const shortDay = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** The header's words for a range: "Last 7 days", "Since Ancients went live (Nov 17)", "Nov 12 to Nov 19". */
export function rangeLabel(r: DateRange): string {
  if (r.kind === 'preset') return PRESETS.find((p) => p.preset === r.preset)!.label;
  if (r.kind === 'since') { const d = localDayStart(r.day); return `Since ${r.label}${d ? ` (${shortDay(d)})` : ''}`; }
  const f = r.from ? localDayStart(r.from) : null, t = r.to ? localDayStart(r.to) : null;
  return `${f ? shortDay(f) : 'the start'} to ${t ? shortDay(t) : 'now'}`;
}

/** The "Since a patch" markers, newest first, built from the player-facing patch notes (never hand-maintained here):
 *  one per ship date, named by its label or its first change. */
export function patchMarkers(limit = 20): { day: string; label: string }[] {
  const seen = new Set<string>();
  const out: { day: string; label: string }[] = [];
  for (const n of PATCH_NOTES) {
    if (seen.has(n.date)) continue;
    seen.add(n.date);
    const first = n.label ?? n.changes[0]?.text ?? 'a patch';
    out.push({ day: n.date, label: first.length > 48 ? `${first.slice(0, 46).replace(/[\s,.:;]+$/, '')}…` : first.replace(/\.$/, '') });
    if (out.length >= limit) break;
  }
  return out;
}

const KEY = 'ascent.balance.range';
/** The last range this browser used (per-viewer convenience; any storage failure reads as All time). */
export function loadRange(): DateRange {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as DateRange | null;
    if (v && v.kind === 'preset' && PRESETS.some((p) => p.preset === v.preset)) return v;
    if (v && v.kind === 'since' && localDayStart(v.day) && typeof v.label === 'string') return v;
    if (v && v.kind === 'custom' && typeof v.from === 'string' && typeof v.to === 'string') return v;
  } catch { /* storage blocked or malformed: All time */ }
  return ALL_TIME;
}
export function saveRange(r: DateRange): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* storage blocked: the range just isn't remembered */ }
}
