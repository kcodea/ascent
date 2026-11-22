/**
 * THE HEALTH CHECK'S ALERT (R-OPS-HEALTH-03; owner 2026-11-22: the daily check failed two days running and nobody was
 * told). After each daily cron run the hub posts a short Discord message when a check FAILS (the transition into
 * failing, a newly failing check, then a reminder at most once a day while it stays failing) and one message when it
 * RECOVERS (back to all green). An hourly watchdog on the hub's 5-minute cron also alerts when the daily run itself has
 * not completed in 26 hours (`cron_overdue`).
 *
 * The webhook URL is the Worker secret `ALERT_DISCORD_WEBHOOK`: never in the repo, never logged. Without it nothing is
 * sent and nothing is stored (one log line per isolate says so).
 *
 * The decision (`decideAlert`) and the message (`formatAlert`) are pure; `alertAfterRun` / `alertWatchdog` take their
 * storage and `fetch` as arguments, so the tests run them on fakes. The state lives in the Live Games directory's
 * Durable Object storage (`ALERT_STATE_KEY`, one small record), not Supabase: the watchdog reads it every hour, and
 * Supabase's free-tier egress is the scarcer budget.
 */
import { failReason } from './healthCore';
import type { HealthResult } from './healthProtocol';

/** A reminder while still failing comes at most this often. 23 h, not 24: the daily cron fires at 06:17 give or take a
 *  few seconds, so a strict 24 h would skip every other day. Still at most one reminder per daily run. */
export const ALERT_REMIND_MS = 23 * 3_600_000;
/** The daily run is overdue after this long without completing (the same 26 h `ops.health_status` uses). */
export const CRON_OVERDUE_MS = 26 * 3_600_000;
/** The pseudo-check the watchdog raises, named like the `ops.health_status` column. */
export const OVERDUE_CHECK = 'cron_overdue';
/** The pseudo-check raised when Supabase refused the run's record (the lead's query would then show cron_overdue). */
export const RECORD_CHECK = 'record';
/** Where the state lives in the directory object's storage. */
export const ALERT_STATE_KEY = 'ops:health_alert';

const RUNBOOK = 'docs/ops/health-check.md';
const HUB_HEALTH_URL = 'https://ascent-hub.team-ascent.workers.dev/health';
const MAX_LINES = 12;
const MAX_REASON = 160;
/** Discord's content cap. */
const DISCORD_MAX = 2000;

export interface AlertState {
  /** The failing checks at the last evaluation: check -> short error. Empty = all green. */
  failing: Record<string, string>;
  /** When the current failing streak began (ms), null while green. */
  since: number | null;
  /** When the last FAILING message was sent (ms), null while green. */
  lastAlertAt: number | null;
  /** When the daily run last completed (ms): the watchdog's clock. null until the first run or watchdog tick. */
  lastRunAt: number | null;
}

export const emptyAlertState = (): AlertState => ({ failing: {}, since: null, lastAlertAt: null, lastRunAt: null });

export type AlertKind = 'failing' | 'still_failing' | 'recovered';

export interface AlertDecision {
  /** null = send nothing. */
  send: AlertKind | null;
  /** Checks failing now that were not failing before (empty for a reminder or a recovery). */
  fresh: string[];
  /** The state to keep if the message (if any) was delivered. */
  next: AlertState;
}

/**
 * The rule. `failing` is every check failing NOW (check -> short error).
 *   - green -> failing, or a check joins the failing set: send `failing` now.
 *   - the same checks still failing: send `still_failing` when the last message is ALERT_REMIND_MS old, else nothing.
 *   - failing -> green: send `recovered` once.
 *   - green -> green: nothing.
 */
export function decideAlert(prev: AlertState, failing: Record<string, string>, now: number): AlertDecision {
  const was = Object.keys(prev.failing);
  const cur = Object.keys(failing);
  if (!cur.length) {
    return { send: was.length ? 'recovered' : null, fresh: [], next: { ...prev, failing: {}, since: null, lastAlertAt: null } };
  }
  const fresh = cur.filter((c) => !(c in prev.failing)).sort();
  const since = was.length && prev.since != null ? prev.since : now;
  if (fresh.length) return { send: 'failing', fresh, next: { ...prev, failing, since, lastAlertAt: now } };
  if (prev.lastAlertAt == null || now - prev.lastAlertAt >= ALERT_REMIND_MS) {
    return { send: 'still_failing', fresh: [], next: { ...prev, failing, since, lastAlertAt: now } };
  }
  return { send: null, fresh: [], next: { ...prev, failing, since } };
}

/** A daily run's failing checks, with the record write as one more when Supabase refused it. */
export function failingOf(results: HealthResult[], recorded: boolean, recordError?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of results) if (r.status === 'fail') out[r.check] = clip(failReason(r) || 'failed');
  if (!recorded) out[RECORD_CHECK] = clip(`Supabase refused ops_health_record${recordError ? `: ${recordError}` : ''}`);
  return out;
}

const clip = (s: string, n = MAX_REASON): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const utc = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
/** Keep backticks out of a reason so it cannot break the code span it sits next to. */
const plain = (s: string): string => s.replace(/`/g, "'");

/** The Discord message. Short: a header, a line per failing check, and how to look. */
export function formatAlert(d: AlertDecision, prev: AlertState, now: number): string {
  if (d.send === 'recovered') {
    const was = Object.keys(prev.failing).sort();
    return [
      `**ASCENT health check: all green again** (run ${utc(now)})`,
      `Was failing${prev.since != null ? ` since ${utc(prev.since)}` : ''}: ${was.map((c) => `\`${c}\``).join(', ')}`,
    ].join('\n');
  }
  const f = d.next.failing;
  const checks = Object.keys(f).sort();
  const head = d.send === 'failing'
    ? `**ASCENT health check: ${checks.length} failing** (run ${utc(now)})`
    : `**ASCENT health check: still ${checks.length} failing** since ${utc(d.next.since ?? now)} (run ${utc(now)})`;
  const hint = checks.length === 1 && checks[0] === OVERDUE_CHECK
    ? `How to look: open ${HUB_HEALTH_URL}, then the ascent-hub logs in the Cloudflare dashboard (${RUNBOOK}).`
    : `How to look: \`select source, ts, check_name, status, detail from ops.health_latest;\` (${RUNBOOK}).`;
  const marked = d.send === 'failing' && Object.keys(prev.failing).length > 0;
  // Lines until the cap: MAX_LINES, and Discord's length with room left for the "and N more" line and the hint.
  const budget = DISCORD_MAX - head.length - hint.length - 40;
  const lines: string[] = [];
  let used = 0;
  for (const c of checks) {
    const line = `- \`${c}\`${marked && d.fresh.includes(c) ? ' (new)' : ''}: ${plain(f[c])}`;
    if (lines.length >= MAX_LINES || used + line.length + 1 > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (checks.length > lines.length) lines.push(`- and ${checks.length - lines.length} more`);
  return [head, ...lines, hint].join('\n');
}

// ── the plumbing, on injected storage and fetch ─────────────────────────────────────────────────────────────────

export interface AlertStore {
  get(): Promise<AlertState | null>;
  put(s: AlertState): Promise<void>;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;
export interface AlertIo {
  /** The Worker secret `ALERT_DISCORD_WEBHOOK`. Absent = no alerts. */
  webhook: string | undefined;
  store: AlertStore;
  fetch: FetchLike;
  now: number;
  log?: (line: string) => void;
}

let warnedNoWebhook = false;
/** Tests: forget the once-per-isolate warning. */
export function resetAlertWarningForTests(): void { warnedNoWebhook = false; }

function noWebhook(io: AlertIo): boolean {
  if (io.webhook) return false;
  if (!warnedNoWebhook) {
    warnedNoWebhook = true;
    (io.log ?? console.log)(JSON.stringify({ ev: 'health_alert_off', reason: 'ALERT_DISCORD_WEBHOOK is not set' }));
  }
  return true;
}

/** POST one message. Never throws, never logs the URL (it carries the webhook's token). */
export async function postDiscord(io: AlertIo, content: string): Promise<boolean> {
  try {
    const res = await io.fetch(io.webhook as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // allowed_mentions: an error text that happens to contain @everyone pings nobody.
      body: JSON.stringify({ username: 'ASCENT health', content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) (io.log ?? console.warn)(JSON.stringify({ ev: 'health_alert_failed', status: res.status }));
    return res.ok;
  } catch (e) {
    (io.log ?? console.warn)(JSON.stringify({ ev: 'health_alert_failed', error: String(e).replace(/https?:\/\/\S+/g, '<url>').slice(0, 200) }));
    return false;
  }
}

/** Decide, send, and keep the state. An undelivered message keeps the old alert state, so the next evaluation retries. */
async function evaluate(io: AlertIo, prev: AlertState, failing: Record<string, string>, runAt: number | null): Promise<AlertKind | null> {
  const d = decideAlert(prev, failing, io.now);
  let delivered = true;
  if (d.send) delivered = await postDiscord(io, formatAlert(d, prev, io.now));
  const kept = delivered ? d.next : prev;
  await io.store.put({ ...kept, lastRunAt: runAt ?? prev.lastRunAt });
  if (d.send) (io.log ?? console.log)(JSON.stringify({ ev: 'health_alert', kind: d.send, delivered, failing: Object.keys(failing) }));
  return delivered ? d.send : null;
}

/** After a daily run (`runAndRecord`). Returns what was delivered. Never throws. */
export async function alertAfterRun(io: AlertIo, results: HealthResult[], recorded: boolean, recordError?: string): Promise<AlertKind | null> {
  if (noWebhook(io)) return null;
  try {
    const prev = (await io.store.get()) ?? emptyAlertState();
    return await evaluate(io, prev, failingOf(results, recorded, recordError), io.now);
  } catch (e) {
    (io.log ?? console.warn)(JSON.stringify({ ev: 'health_alert_failed', error: String(e).slice(0, 200) }));
    return null;
  }
}

/**
 * The watchdog (hourly, on the hub's 5-minute cron): alerts `cron_overdue` when the daily run has not completed in
 * CRON_OVERDUE_MS. Only raises; the next daily run that completes clears it (its failing set replaces this one). The
 * first tick after this ships has no clock yet and only starts it. Never throws.
 */
export async function alertWatchdog(io: AlertIo): Promise<AlertKind | null> {
  if (!io.webhook) return null;
  try {
    const prev = (await io.store.get()) ?? emptyAlertState();
    if (prev.lastRunAt == null) { await io.store.put({ ...prev, lastRunAt: io.now }); return null; }
    if (io.now - prev.lastRunAt <= CRON_OVERDUE_MS) return null;
    const failing = { ...prev.failing, [OVERDUE_CHECK]: `no daily health run has completed since ${utc(prev.lastRunAt)}` };
    return await evaluate(io, prev, failing, null);
  } catch (e) {
    (io.log ?? console.warn)(JSON.stringify({ ev: 'health_alert_failed', error: String(e).slice(0, 200) }));
    return null;
  }
}
