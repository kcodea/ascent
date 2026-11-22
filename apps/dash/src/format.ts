// Pure formatting + grouping helpers for the page (no DOM), so they can be unit tested.
import type { GameMode, OverviewDay } from './types';

export const MODE_LABEL: Record<GameMode, string> = {
  ranked: 'Ranked lobby',
  unrated_lobby: 'Unrated lobby',
  practice: 'Practice',
  versus_duel: 'Versus 1v1',
  versus_group: 'Versus group',
  versus_duos: 'Versus Duos',
  ranked_duos: 'Ranked Duos',
  tutorial: 'Tutorial',
  other: 'Other (legacy)',
};

/** The daily chart's six stacked series, in fixed colour order (slot n = class f<n>/c<n>). */
export const SERIES: ReadonlyArray<{ key: string; label: string; modes: GameMode[]; slot: number }> = [
  { key: 'ranked', label: 'Ranked lobby', modes: ['ranked'], slot: 1 },
  { key: 'practice', label: 'Practice', modes: ['practice'], slot: 2 },
  { key: 'versus', label: 'Versus', modes: ['versus_duel', 'versus_group', 'versus_duos'], slot: 3 },
  { key: 'ranked_duos', label: 'Ranked Duos', modes: ['ranked_duos'], slot: 4 },
  { key: 'unrated', label: 'Unrated lobby', modes: ['unrated_lobby'], slot: 5 },
  { key: 'other', label: 'Tutorial + other', modes: ['tutorial', 'other'], slot: 6 },
];

export function seriesValues(day: OverviewDay): number[] {
  return SERIES.map((s) => s.modes.reduce((a, m) => a + (day.byMode[m] ?? 0), 0));
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const int = (n: number | null | undefined): string => (n == null ? 'n/a' : Math.round(n).toLocaleString('en-US'));
export const pct = (x: number | null | undefined, digits = 1): string => (x == null ? 'n/a' : `${(x * 100).toFixed(digits)}%`);
export const place = (x: number | null | undefined): string => (x == null ? 'n/a' : x.toFixed(2));

/** `disco_dan` -> `Disco Dan`. Hero and tribe ids are shown by id (the page imports no game content). */
export const titleCase = (id: string): string =>
  id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-11-22` -> `22 Nov`. */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}

/** The calendar date in a time zone, as yyyy-mm-dd. */
export function dateIn(tz: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** yyyy-mm-dd minus n days. */
export function minusDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "Top half" reads as Top 4 in an 8-seat game and as a win in a 1v1. */
export function topHalfLabel(seats: number): string {
  if (seats >= 8) return 'Top 4';
  if (seats <= 2) return 'Win';
  return `Top ${Math.floor(seats / 2)}`;
}

/** A nice axis maximum and step for a value range starting at 0. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const stepInt = Math.max(1, Math.round(step));
  return { max: Math.ceil(max / stepInt) * stepInt, step: stepInt };
}
