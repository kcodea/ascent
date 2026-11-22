// The page's date range: presets, free From/To, the URL hash (a link opens the same view) and whether it is live.
// Pure (no DOM), so it is unit tested. Dates are yyyy-mm-dd in the viewer's time zone; `from: null` = all time.
import { minusDays } from './format';

export const PRESETS = ['today', 'yesterday', '7d', '30d', '90d', 'all'] as const;
export type Preset = (typeof PRESETS)[number];

export interface Range {
  preset: Preset | null; // null = a custom From/To
  from: string | null; // null = all time
  to: string; // inclusive
}

export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Today', yesterday: 'Yesterday', '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time',
};

export const DEFAULT_PRESET: Preset = '7d';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string | null | undefined): d is string => !!d && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

export function presetRange(p: Preset, today: string): Range {
  switch (p) {
    case 'today': return { preset: p, from: today, to: today };
    case 'yesterday': { const y = minusDays(today, 1); return { preset: p, from: y, to: y }; }
    case '7d': return { preset: p, from: minusDays(today, 6), to: today };
    case '30d': return { preset: p, from: minusDays(today, 29), to: today };
    case '90d': return { preset: p, from: minusDays(today, 89), to: today };
    case 'all': return { preset: p, from: null, to: today };
  }
}

/** A custom range, ordered, never past today. */
export function customRange(from: string, to: string, today: string): Range {
  let a = from <= to ? from : to;
  let b = from <= to ? to : from;
  if (b > today) b = today;
  if (a > b) a = b;
  return { preset: null, from: a, to: b };
}

/** `#range=7d`, `#from=2026-11-01&to=2026-11-22`, either with `&build=<patch>`. Anything unreadable = the default. */
export function parseHash(hash: string, today: string): { range: Range; build: string } {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const build = q.get('build') ?? '';
  const preset = q.get('range');
  if (preset && (PRESETS as readonly string[]).includes(preset)) return { range: presetRange(preset as Preset, today), build };
  const from = q.get('from'), to = q.get('to');
  if (valid(from) && valid(to)) return { range: customRange(from, to, today), build };
  return { range: presetRange(DEFAULT_PRESET, today), build };
}

export function toHash(range: Range, build: string): string {
  const q = new URLSearchParams();
  if (range.preset) q.set('range', range.preset);
  else { q.set('from', range.from ?? ''); q.set('to', range.to); }
  if (build) q.set('build', build);
  return `#${q.toString()}`;
}

/** A range that reaches today keeps changing, so the page polls it. */
export const isLive = (range: Range, today: string): boolean => range.to >= today;

/** "today", "yesterday", "last 7 days", "all time", "1 Nov to 22 Nov". */
export function rangePhrase(range: Range, short: (d: string) => string): string {
  if (range.preset === 'today') return 'today';
  if (range.preset === 'yesterday') return 'yesterday';
  if (range.preset === 'all' || range.from === null) return 'all time';
  if (range.preset) return `last ${PRESET_LABEL[range.preset]}`;
  return range.from === range.to ? short(range.from) : `${short(range.from)} to ${short(range.to)}`;
}

/** Live polling never runs faster than the server's 60 s cache (src/server/handler.ts CACHE_TTL_MS). */
export const LIVE_POLL_MS = 60_000;
