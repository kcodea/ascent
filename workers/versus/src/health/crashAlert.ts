/**
 * THE CRASH-SPIKE ALERT + THE DAILY SUMMARY (R-OPS-HEALTH-04; owner 2026-11-22: "Discord alerts for player CRASH
 * SPIKES, not one message per crash, through the same webhook, plus an optional daily summary").
 *
 * Every 15 minutes (the :00 / :15 / :30 / :45 ticks of the hub's 5-minute cron) the hub asks Supabase for the crash
 * digest (`public.ops_crash_digest`, key-gated, `supabase/migrations/2026-11-30-ops-crash-digest.sql`): per platform the
 * last hour's reports against that platform's trailing 7-day hourly mean. A platform is HOT when
 *   - SPIKE: the last hour has >= max(SPIKE_MIN, SPIKE_FACTOR x the hourly mean) reports, or
 *   - NEW BUILD / NEW KIND: an app version or a kind first seen in the last NEW_WINDOW_MS has >= NEW_MIN reports from
 *     >= NEW_MIN_PLAYERS players in the last hour.
 * A platform turning hot posts one message at once; while it stays hot, at most one more every CRASH_REMIND_MS; once it
 * has been quiet for CRASH_CLEAR_MS (so one quiet quarter-hour on a sliding hour does not flap it), one "back to normal".
 *
 * Once a day at 06:20 UTC (three minutes after the 06:17 health check) the hub posts yesterday's totals by platform and
 * kind, the top 3 messages and the 7-day average, with one line for this morning's health check result, read from the
 * health alert's own state (R-OPS-HEALTH-03). A day with no crash reports posts nothing.
 *
 * Same webhook secret as the health alert (`ALERT_DISCORD_WEBHOOK`): without it nothing is asked, sent or stored.
 * Messages mention nobody and carry counts, kinds, versions and the short already-redacted message only (scrubbed again
 * here): never an email, a user id, a user agent or a stack. State is one small record next to the health alert's in
 * the Live Games directory object (`CRASH_ALERT_STATE_KEY`). Decisions and messages are pure; the plumbing takes its
 * storage, `fetch` and the digest call as arguments, so the tests run on fakes.
 */
import { postDiscord, type AlertState, type AlertStore, type FetchLike } from './healthAlert';

// ── the tunables ──────────────────────────────────────────────────────────────────────────────────────────────────
/** A spike needs at least this many reports in the hour, whatever the baseline (one bad player is not a spike). */
export const SPIKE_MIN = 5;
/** ...and at least this many times the platform's normal hourly rate (the trailing 7-day mean). */
export const SPIKE_FACTOR = 3;
/** A new build or kind is alarming at this many reports in the hour... */
export const NEW_MIN = 3;
/** ...from at least this many players. */
export const NEW_MIN_PLAYERS = 2;
/** "New" = first seen in the trailing 7 days within this long (a build shipped this morning is still new tonight). */
export const NEW_WINDOW_MS = 24 * 3_600_000;
/** The evaluation runs at most this often. */
export const CRASH_EVAL_MS = 15 * 60_000;
/** While a platform stays hot, at most one message per this long. */
export const CRASH_REMIND_MS = 2 * 3_600_000;
/** A platform is back to normal after this long without being hot. */
export const CRASH_CLEAR_MS = 30 * 60_000;
/** The daily summary's tick (UTC): the first 5-minute tick at or after 06:20 that has not sent today's. */
export const SUMMARY_HOUR_UTC = 6;
export const SUMMARY_MINUTE_UTC = 20;
/** Where the state lives in the directory object's storage. */
export const CRASH_ALERT_STATE_KEY = 'ops:crash_alert';

const RUNBOOK = 'docs/ops/crash-reports.md';
const DISCORD_MAX = 2000;
const MAX_MSG = 90;
const USERNAME = 'ASCENT crashes';

// ── the digest (what `public.ops_crash_digest` answers) ───────────────────────────────────────────────────────────
export interface CrashCount { n: number; users: number; first?: string | null }
export interface CrashPlatformHour {
  platform: string;
  n: number;
  users: number;
  base: { total: number; mean: number; sd: number; max: number; hours: number };
  kinds: (CrashCount & { kind: string })[];
  versions: (CrashCount & { v: string })[];
  top: { kind: string; msg: string; n: number }[];
}
export interface CrashHourDigest { mode: 'hour'; at?: string; platforms: CrashPlatformHour[] }
export interface CrashDayDigest {
  mode: 'day';
  day: string;
  total: number;
  users: number;
  avg7: number;
  platforms: { platform: string; n: number; users: number; avg7: number; kinds: { kind: string; n: number }[] }[];
  top: { platform: string; kind: string; msg: string; n: number }[];
}

// ── the state ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CrashPlatformState {
  /** When this hot streak began (ms). */
  since: number;
  /** When the last message for this platform went out (ms). */
  lastAlertAt: number;
  /** When it was last hot (ms): the recovery clock. */
  lastHotAt: number;
  /** The most reports in an hour seen in this streak. */
  peak: number;
  /** Every reason seen in this streak: `spike`, `new_version:<v>`, `new_kind:<kind>`. */
  reasons: string[];
}
export interface CrashAlertState {
  lastEvalAt: number | null;
  /** Hot (or cooling) platforms only; a platform back to normal is removed. */
  platforms: Record<string, CrashPlatformState>;
  /** The UTC day (YYYY-MM-DD) whose morning summary was handled (sent, or skipped for zero crashes). */
  lastSummaryDay: string | null;
}
export const emptyCrashState = (): CrashAlertState => ({ lastEvalAt: null, platforms: {}, lastSummaryDay: null });

// ── the rule ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The report count that makes an hour a spike on this platform. */
export const spikeThreshold = (mean: number): number => Math.max(SPIKE_MIN, Math.ceil(SPIKE_FACTOR * (Number.isFinite(mean) ? mean : 0)));

const isNew = (c: CrashCount, now: number): boolean => {
  const first = c.first ? Date.parse(c.first) : NaN;
  return Number.isFinite(first) && now - first <= NEW_WINDOW_MS && c.n >= NEW_MIN && c.users >= NEW_MIN_PLAYERS;
};

/** Why this platform's hour is alarming (empty = it is not). */
export function reasonsOf(p: CrashPlatformHour, now: number): string[] {
  const out: string[] = [];
  if (p.n >= spikeThreshold(p.base?.mean ?? 0)) out.push('spike');
  for (const v of p.versions ?? []) if (v.v !== '?' && isNew(v, now)) out.push(`new_version:${v.v}`);
  for (const k of p.kinds ?? []) if (isNew(k, now)) out.push(`new_kind:${k.kind}`);
  return out;
}

export type CrashSendKind = 'spike' | 'still' | 'recovered';
export interface CrashSend { platform: string; kind: CrashSendKind; text: string }
export interface CrashDecision { sends: CrashSend[]; next: CrashAlertState }

/**
 * Per platform: not hot -> hot sends `spike` now; hot and the last message CRASH_REMIND_MS old sends `still`; hot
 * within that window sends nothing (new reasons wait for the next message); quiet for CRASH_CLEAR_MS sends `recovered`
 * once and forgets the platform. `next` assumes every send is delivered (`crashTick` puts back an undelivered one).
 */
export function decideCrash(prev: CrashAlertState, d: CrashHourDigest, now: number): CrashDecision {
  const platforms: Record<string, CrashPlatformState> = {};
  const sends: CrashSend[] = [];
  const byName = new Map((d.platforms ?? []).map((p) => [p.platform, p]));
  const names = [...new Set([...byName.keys(), ...Object.keys(prev.platforms)])].sort();
  for (const name of names) {
    const p = byName.get(name);
    const was = prev.platforms[name];
    const why = p ? reasonsOf(p, now) : [];
    if (why.length && p) {
      if (!was) {
        const st: CrashPlatformState = { since: now, lastAlertAt: now, lastHotAt: now, peak: p.n, reasons: why };
        platforms[name] = st;
        sends.push({ platform: name, kind: 'spike', text: formatSpike('spike', p, st, why, now) });
        continue;
      }
      const st: CrashPlatformState = { ...was, lastHotAt: now, peak: Math.max(was.peak, p.n), reasons: [...new Set([...was.reasons, ...why])] };
      if (now - was.lastAlertAt >= CRASH_REMIND_MS) {
        st.lastAlertAt = now;
        sends.push({ platform: name, kind: 'still', text: formatSpike('still', p, st, why, now) });
      }
      platforms[name] = st;
      continue;
    }
    if (!was) continue;
    if (now - was.lastHotAt >= CRASH_CLEAR_MS) {
      sends.push({ platform: name, kind: 'recovered', text: formatRecovered(name, was, p?.n ?? 0, now) });
      continue;
    }
    platforms[name] = was;
  }
  return { sends, next: { ...prev, lastEvalAt: now, platforms } };
}

// ── the messages ──────────────────────────────────────────────────────────────────────────────────────────────────
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const hhmm = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const rate = (x: number): string => (x >= 10 ? x.toFixed(0) : x.toFixed(1));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * A message line from the database, made safe for Discord again (the client already redacted it): no emails, ids,
 * long tokens, URL queries, mentions, backticks or newlines, and short.
 */
export function scrub(s: unknown, max = MAX_MSG): string {
  let t = typeof s === 'string' ? s : String(s ?? '');
  t = t.replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#]\S*/gi, '$1?[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .replace(/@/g, '(at)')
    .replace(/`/g, "'")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function clipMessage(lines: string[]): string {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > DISCORD_MAX - 20) { out.push('…'); break; }
    out.push(l);
    used += l.length + 1;
  }
  return out.join('\n');
}

const HOW_TO_LOOK = `How to look: the dashboard Health tab (crashes by build and last step), or the "Spikes" query in ${RUNBOOK}.`;

export function formatSpike(kind: 'spike' | 'still', p: CrashPlatformHour, st: CrashPlatformState, why: string[], now: number): string {
  const spike = why.includes('spike');
  const builds = why.filter((r) => r.startsWith('new_version:')).map((r) => r.slice('new_version:'.length));
  const kinds = why.filter((r) => r.startsWith('new_kind:')).map((r) => r.slice('new_kind:'.length));
  const what = spike ? 'crash spike' : builds.length ? 'new build crashing' : 'new crash kind';
  const name = scrub(p.platform, 20);
  const head = kind === 'spike'
    ? `**ASCENT crashes: ${name} ${what}** (${utc(now)})`
    : `**ASCENT crashes: ${name} still high** since ${hhmm(st.since)} (${utc(now)})`;
  const mean = p.base?.mean ?? 0;
  const lines = [
    head,
    `${plural(p.n, 'report')} in the last hour from ${plural(p.users, 'player')}. Normal: ${rate(mean)} an hour over the last 7 days (alert at ${spikeThreshold(mean)}).`,
  ];
  if (p.kinds?.length) lines.push(`Kinds: ${p.kinds.slice(0, 5).map((k) => `${scrub(k.kind, 32)} ${k.n}`).join(', ')}`);
  if (p.versions?.length) lines.push(`App version: ${p.versions.slice(0, 3).map((v) => `${scrub(v.v, 40)} (${v.n})`).join(', ')}`);
  for (const b of builds) {
    const v = p.versions.find((x) => x.v === b);
    if (v) lines.push(`New build ${scrub(b, 40)}: ${plural(v.n, 'report')} from ${plural(v.users, 'player')}, first seen ${v.first ? utc(Date.parse(v.first)) : 'today'}`);
  }
  for (const k of kinds) {
    const c = p.kinds.find((x) => x.kind === k);
    if (c) lines.push(`New kind ${scrub(k, 32)}: ${plural(c.n, 'report')} from ${plural(c.users, 'player')}`);
  }
  if (kind === 'still') lines.push(`Peak this streak: ${plural(st.peak, 'report')} in an hour.`);
  if (p.top?.length) {
    lines.push('Top:');
    for (const t of p.top.slice(0, 3)) lines.push(`- ${scrub(t.kind, 32)}: ${scrub(t.msg) || '(no message)'} (${t.n})`);
  }
  lines.push(HOW_TO_LOOK);
  return clipMessage(lines);
}

export function formatRecovered(platform: string, st: CrashPlatformState, lastHour: number, now: number): string {
  return [
    `**ASCENT crashes: ${scrub(platform, 20)} back to normal** (${utc(now)})`,
    `High since ${utc(st.since)}; peaked at ${plural(st.peak, 'report')} in an hour. Last hour: ${lastHour}.`,
  ].join('\n');
}

/** The morning's one line about the 06:17 health check, from the health alert's state (R-OPS-HEALTH-03). */
export function healthLine(h: AlertState | null, now: number): string {
  if (!h || h.lastRunAt == null) return 'Health check: no daily run recorded yet.';
  if (now - h.lastRunAt > 6 * 3_600_000) return `Health check: no daily run since ${utc(h.lastRunAt)} (the watchdog alerts at 26 h).`;
  const failing = Object.keys(h.failing ?? {}).sort();
  if (!failing.length) return `Health check ${hhmm(h.lastRunAt)}: all green.`;
  return `Health check ${hhmm(h.lastRunAt)}: ${failing.length} failing: ${failing.map((c) => `\`${scrub(c, 40)}\``).join(', ')} (see the health alert).`;
}

/** Yesterday in one message, or null when there were no crash reports (nothing is posted). */
export function formatDailySummary(d: CrashDayDigest, health: AlertState | null, now: number): string | null {
  if (!d || !(d.total > 0)) return null;
  const lines = [
    `**ASCENT daily, ${scrub(d.day, 10)}**: ${plural(d.total, 'crash report')} from ${plural(d.users, 'player')} (7-day average ${rate(d.avg7)} a day)`,
  ];
  for (const p of (d.platforms ?? []).slice(0, 5)) {
    const kinds = p.kinds?.length ? `: ${p.kinds.slice(0, 4).map((k) => `${scrub(k.kind, 32)} ${k.n}`).join(', ')}` : '';
    lines.push(`- ${scrub(p.platform, 20)} ${p.n} (avg ${rate(p.avg7)})${kinds}`);
  }
  if (d.top?.length) {
    lines.push('Top:');
    for (const t of d.top.slice(0, 3)) lines.push(`- ${scrub(t.platform, 20)} ${scrub(t.kind, 32)}: ${scrub(t.msg) || '(no message)'} (${t.n})`);
  }
  lines.push(healthLine(health, now));
  lines.push(`How to look: the dashboard Health tab, or ${RUNBOOK}`);
  return clipMessage(lines);
}

// ── when ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The quarter-hour ticks (:00, :15, :30, :45 of the 5-minute cron), and never twice inside CRASH_EVAL_MS. */
export function evalDue(st: CrashAlertState, now: number): boolean {
  if (new Date(now).getUTCMinutes() % 15 >= 5) return false;
  return st.lastEvalAt == null || now - st.lastEvalAt >= CRASH_EVAL_MS - 60_000;
}
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** From 06:20 UTC until it has been handled today (a Supabase failure retries on the next tick, until 07:00). */
export function summaryDue(st: CrashAlertState, now: number): boolean {
  const t = new Date(now);
  return t.getUTCHours() === SUMMARY_HOUR_UTC && t.getUTCMinutes() >= SUMMARY_MINUTE_UTC && st.lastSummaryDay !== dayOf(now);
}

// ── the plumbing, on injected storage, fetch and digest ───────────────────────────────────────────────────────────
export interface CrashStore {
  get(): Promise<CrashAlertState | null>;
  put(s: CrashAlertState): Promise<void>;
}
export interface CrashIo {
  /** The Worker secret `ALERT_DISCORD_WEBHOOK`. Absent = nothing is asked, sent or stored. */
  webhook: string | undefined;
  store: CrashStore;
  /** The health alert's state, read for the summary's health line. */
  health: AlertStore;
  /** `public.ops_crash_digest` with the hub's key. */
  digest: (mode: 'hour' | 'day') => Promise<unknown>;
  fetch: FetchLike;
  now: number;
  /** The daily summary (default on). */
  summary?: boolean;
  log?: (line: string) => void;
}
export interface CrashTickResult { evaluated: boolean; sent: CrashSend['kind'][]; summary: 'sent' | 'skipped' | null }

const asHour = (v: unknown): CrashHourDigest | null =>
  v && typeof v === 'object' && Array.isArray((v as CrashHourDigest).platforms) ? (v as CrashHourDigest) : null;
const asDay = (v: unknown): CrashDayDigest | null =>
  v && typeof v === 'object' && typeof (v as CrashDayDigest).total === 'number' && Array.isArray((v as CrashDayDigest).platforms) ? (v as CrashDayDigest) : null;

/** One 5-minute tick. Never throws. */
export async function crashTick(io: CrashIo): Promise<CrashTickResult> {
  const out: CrashTickResult = { evaluated: false, sent: [], summary: null };
  if (!io.webhook) return out;
  // The clock alone rules most ticks out: skip the directory read on them.
  if (!evalDue(emptyCrashState(), io.now) && !(io.summary !== false && summaryDue(emptyCrashState(), io.now))) return out;
  const log = io.log ?? console.log;
  try {
    let st = (await io.store.get()) ?? emptyCrashState();
    const wantEval = evalDue(st, io.now);
    const wantSummary = io.summary !== false && summaryDue(st, io.now);
    if (!wantEval && !wantSummary) return out;

    if (wantEval) {
      try {
        const d = asHour(await io.digest('hour'));
        if (!d) throw new Error('bad digest');
        const dec = decideCrash(st, d, io.now);
        const platforms = { ...dec.next.platforms };
        for (const s of dec.sends) {
          if (await postDiscord(io, s.text, USERNAME)) { out.sent.push(s.kind); continue; }
          // Undelivered: put this platform back as it was, so the next evaluation tries again.
          if (st.platforms[s.platform]) platforms[s.platform] = st.platforms[s.platform]!;
          else delete platforms[s.platform];
        }
        st = { ...dec.next, platforms };
        out.evaluated = true;
        if (dec.sends.length) log(JSON.stringify({ ev: 'crash_alert', sends: dec.sends.map((s) => `${s.platform}:${s.kind}`), delivered: out.sent.length }));
      } catch (e) {
        (io.log ?? console.warn)(JSON.stringify({ ev: 'crash_alert_failed', step: 'hour', error: String(e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200) }));
      }
    }

    if (wantSummary) {
      try {
        const d = asDay(await io.digest('day'));
        if (!d) throw new Error('bad digest');
        const text = formatDailySummary(d, await io.health.get(), io.now);
        if (!text) { out.summary = 'skipped'; st = { ...st, lastSummaryDay: dayOf(io.now) }; }
        else if (await postDiscord(io, text, USERNAME)) { out.summary = 'sent'; st = { ...st, lastSummaryDay: dayOf(io.now) }; }
      } catch (e) {
        (io.log ?? console.warn)(JSON.stringify({ ev: 'crash_alert_failed', step: 'day', error: String(e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200) }));
      }
    }

    await io.store.put(st);
  } catch (e) {
    (io.log ?? console.warn)(JSON.stringify({ ev: 'crash_alert_failed', error: String(e).slice(0, 200) }));
  }
  return out;
}
