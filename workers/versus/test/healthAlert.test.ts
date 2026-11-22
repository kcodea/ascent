/**
 * THE HEALTH CHECK'S ALERT (R-OPS-HEALTH-03; owner 2026-11-22: the daily check failed two days running unnoticed).
 * The transition rule (into failing, a new failing check, a reminder at most once per daily run, one recovery), the
 * message, the cron_overdue watchdog, and that nothing is posted or stored without the webhook secret.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALERT_REMIND_MS, CRON_OVERDUE_MS, OVERDUE_CHECK, RECORD_CHECK, alertAfterRun, alertWatchdog, decideAlert, emptyAlertState,
  failingOf, formatAlert, resetAlertWarningForTests, type AlertIo, type AlertState,
} from '../src/health/healthAlert';
import type { HealthResult } from '../src/health/healthProtocol';

const T0 = Date.parse('2026-11-22T06:17:03Z');
const H = 3_600_000;
const DAY = 24 * H;
const HOOK = 'https://discord.test/api/webhooks/1/secret-token';

const ok = (check: string): HealthResult => ({ check, status: 'ok', detail: {} });
const fail = (check: string, detail: Record<string, unknown>): HealthResult => ({ check, status: 'fail', detail });

function io(over: Partial<AlertIo> & { state?: AlertState | null; status?: number } = {}) {
  let state: AlertState | null = over.state ?? null;
  const posts: { url: string; body: { content: string; allowed_mentions: unknown } }[] = [];
  const logs: string[] = [];
  const x: AlertIo & { posts: typeof posts; logs: string[]; state: () => AlertState | null } = {
    webhook: 'webhook' in over ? over.webhook : HOOK,
    now: over.now ?? T0,
    store: { get: async () => state, put: async (s) => { state = s; } },
    fetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: (over.status ?? 204) < 300, status: over.status ?? 204 }; },
    log: (l) => logs.push(l),
    posts, logs, state: () => state,
  };
  return x;
}

describe('decideAlert: the transition rule', () => {
  it('green -> green sends nothing', () => {
    expect(decideAlert(emptyAlertState(), {}, T0).send).toBeNull();
  });
  it('green -> failing alerts at once and starts the streak', () => {
    const d = decideAlert(emptyAlertState(), { hub: 'down' }, T0);
    expect(d.send).toBe('failing');
    expect(d.fresh).toEqual(['hub']);
    expect(d.next).toMatchObject({ failing: { hub: 'down' }, since: T0, lastAlertAt: T0 });
  });
  it('the same failure the next day reminds; within the reminder window it stays quiet', () => {
    const s = decideAlert(emptyAlertState(), { hub: 'down' }, T0).next;
    expect(decideAlert(s, { hub: 'down' }, T0 + H).send).toBeNull();
    expect(decideAlert(s, { hub: 'down' }, T0 + ALERT_REMIND_MS - 1).send).toBeNull();
    // The next daily run, a few seconds EARLY on the clock, still reminds (a strict 24 h would skip it).
    const next = decideAlert(s, { hub: 'down' }, T0 + DAY - 5_000);
    expect(next.send).toBe('still_failing');
    expect(next.next.since).toBe(T0);
    expect(next.next.lastAlertAt).toBe(T0 + DAY - 5_000);
  });
  it('a check joining the failing set alerts at once, even inside the reminder window', () => {
    const s = decideAlert(emptyAlertState(), { hub: 'down' }, T0).next;
    const d = decideAlert(s, { hub: 'down', 'writes.lobby': '["run_history"]' }, T0 + H);
    expect(d.send).toBe('failing');
    expect(d.fresh).toEqual(['writes.lobby']);
    expect(d.next.since).toBe(T0);
  });
  it('a check leaving a still-failing set is quiet; all green recovers once and clears the streak', () => {
    const s = decideAlert(emptyAlertState(), { hub: 'down', pool: 'x' }, T0).next;
    expect(decideAlert(s, { hub: 'down' }, T0 + H).send).toBeNull();
    const r = decideAlert(s, {}, T0 + DAY);
    expect(r.send).toBe('recovered');
    expect(r.next).toMatchObject({ failing: {}, since: null, lastAlertAt: null });
    expect(decideAlert(r.next, {}, T0 + 2 * DAY).send).toBeNull();
  });
});

describe('failingOf + formatAlert: the message', () => {
  const results = [ok('hub'), fail('writes.lobby', { missing: ['run_history', 'boards'] }), fail('versus_worker', { error: 'fetch `failed`' }), ok('writer_key')];

  it('takes each failing check\'s short why, and a refused record as one more', () => {
    expect(failingOf(results, true)).toEqual({ 'writes.lobby': '["run_history","boards"]', versus_worker: 'fetch `failed`' });
    expect(failingOf([ok('hub')], false, 'ops_health_record 401: nope')[RECORD_CHECK]).toContain('401');
    expect(failingOf([fail('x', { error: 'e'.repeat(500) })], true).x.length).toBeLessThanOrEqual(160);
  });

  it('a failing message names the checks, their error, the run time and how to look', () => {
    const d = decideAlert(emptyAlertState(), failingOf(results, true), T0);
    const text = formatAlert(d, emptyAlertState(), T0);
    expect(text).toBe([
      '**ASCENT health check: 2 failing** (run 2026-11-22 06:17 UTC)',
      '- `versus_worker`: fetch \'failed\'',
      '- `writes.lobby`: ["run_history","boards"]',
      'How to look: `select source, ts, check_name, status, detail from ops.health_latest;` (docs/ops/health-check.md).',
    ].join('\n'));
  });

  it('a reminder says since when; a new check is marked; a recovery names what was failing', () => {
    const s = decideAlert(emptyAlertState(), { hub: 'down' }, T0).next;
    expect(formatAlert(decideAlert(s, { hub: 'down' }, T0 + DAY), s, T0 + DAY)).toMatch(/^\*\*ASCENT health check: still 1 failing\*\* since 2026-11-22 06:17 UTC \(run 2026-11-23 06:17 UTC\)/);
    expect(formatAlert(decideAlert(s, { hub: 'down', pool: 'p' }, T0 + H), s, T0 + H)).toContain('- `pool` (new): p');
    expect(formatAlert(decideAlert(s, {}, T0 + DAY), s, T0 + DAY)).toBe(
      '**ASCENT health check: all green again** (run 2026-11-23 06:17 UTC)\nWas failing since 2026-11-22 06:17 UTC: `hub`');
  });

  it('stays under Discord\'s 2000-character cap', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i++) many[`check.${String(i).padStart(2, '0')}`] = 'x'.repeat(160);
    const text = formatAlert(decideAlert(emptyAlertState(), many, T0), emptyAlertState(), T0);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/- and \d+ more\nHow to look/);
  });
});

describe('alertAfterRun / alertWatchdog: the plumbing', () => {
  beforeEach(() => resetAlertWarningForTests());

  it('without the webhook secret: no request, nothing stored, one log line per isolate', async () => {
    const x = io({ webhook: undefined });
    expect(await alertAfterRun(x, [fail('hub', { error: 'down' })], true)).toBeNull();
    expect(await alertAfterRun(x, [fail('hub', { error: 'down' })], true)).toBeNull();
    expect(await alertWatchdog(x)).toBeNull();
    expect(x.posts).toHaveLength(0);
    expect(x.state()).toBeNull();
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0]).toContain('health_alert_off');
    expect(x.logs[0]).not.toContain('discord');
  });

  it('posts a failing message once, mentions nobody, then stays quiet the same day', async () => {
    const x = io();
    expect(await alertAfterRun(x, [fail('hub', { error: 'down' })], true)).toBe('failing');
    expect(x.posts).toHaveLength(1);
    expect(x.posts[0].url).toBe(HOOK);
    expect(x.posts[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(x.state()).toMatchObject({ failing: { hub: 'down' }, lastRunAt: T0 });
    const y = io({ state: x.state(), now: T0 + H });
    expect(await alertAfterRun(y, [fail('hub', { error: 'down' })], true)).toBeNull();
    expect(y.posts).toHaveLength(0);
  });

  it('a refused delivery keeps the old state, so the next run retries; the URL is never logged', async () => {
    const x = io({ status: 500 });
    expect(await alertAfterRun(x, [fail('hub', { error: 'down' })], true)).toBeNull();
    expect(x.state()).toMatchObject({ failing: {}, lastRunAt: T0 });
    expect(x.logs.join('\n')).not.toContain('secret-token');
    const y = io({ state: x.state(), now: T0 + H });
    expect(await alertAfterRun(y, [fail('hub', { error: 'down' })], true)).toBe('failing');
  });

  it('a thrown fetch never throws out and never logs the URL', async () => {
    const x = io();
    x.fetch = async () => { throw new Error(`connect failed ${HOOK}`); };
    expect(await alertAfterRun(x, [fail('hub', { error: 'down' })], true)).toBeNull();
    expect(x.logs.join('\n')).not.toContain('secret-token');
  });

  it('the watchdog starts its clock, alerts cron_overdue after 26 h, and the next good run recovers', async () => {
    const a = io({ now: T0 });
    expect(await alertWatchdog(a)).toBeNull();
    expect(a.state()?.lastRunAt).toBe(T0);
    expect(a.posts).toHaveLength(0);

    const b = io({ state: a.state(), now: T0 + CRON_OVERDUE_MS });
    expect(await alertWatchdog(b)).toBeNull();
    const c = io({ state: a.state(), now: T0 + CRON_OVERDUE_MS + H });
    expect(await alertWatchdog(c)).toBe('failing');
    expect(c.posts[0].body.content).toContain(`\`${OVERDUE_CHECK}\``);
    expect(c.posts[0].body.content).toContain('ascent-hub.team-ascent.workers.dev/health');
    expect(c.state()?.lastRunAt).toBe(T0);

    const d = io({ state: c.state(), now: T0 + CRON_OVERDUE_MS + 2 * H });
    expect(await alertWatchdog(d)).toBeNull();

    const e = io({ state: c.state(), now: T0 + 2 * DAY });
    expect(await alertAfterRun(e, [ok('hub')], true)).toBe('recovered');
    expect(e.state()).toMatchObject({ failing: {}, lastRunAt: T0 + 2 * DAY });
  });
});
