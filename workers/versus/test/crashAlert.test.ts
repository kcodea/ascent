/**
 * THE CRASH-SPIKE ALERT + DAILY SUMMARY (R-OPS-HEALTH-04; owner 2026-11-22). Spike detection (the floor, the
 * baseline multiple, a new build or kind), the rate limit (one message per platform per 2 hours while hot), recovery
 * (once, after a quiet half hour), the daily summary's text and its zero-crash skip, the quarter-hour and 06:20 timing,
 * scrubbing, and that nothing is asked, sent or stored without the webhook secret.
 */
import { describe, expect, it } from 'vitest';
import {
  CRASH_CLEAR_MS, CRASH_REMIND_MS, NEW_WINDOW_MS, SPIKE_MIN, crashTick, decideCrash, emptyCrashState, evalDue,
  formatDailySummary, healthLine, reasonsOf, scrub, spikeThreshold, summaryDue,
  type CrashAlertState, type CrashDayDigest, type CrashHourDigest, type CrashIo, type CrashPlatformHour,
} from '../src/health/crashAlert';
import type { AlertState } from '../src/health/healthAlert';

const T0 = Date.parse('2026-11-22T14:30:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const HOOK = 'https://discord.test/api/webhooks/1/secret-token';
const iso = (ms: number): string => new Date(ms).toISOString();

function plat(over: Partial<CrashPlatformHour> = {}): CrashPlatformHour {
  return {
    platform: 'phone', n: 2, users: 2,
    base: { total: 100, mean: 100 / 168, sd: 0.8, max: 4, hours: 168 },
    kinds: [{ kind: 'crash-session', n: 2, users: 2, first: iso(T0 - 6 * 24 * H) }],
    versions: [{ v: '0.41.3', n: 2, users: 2, first: iso(T0 - 6 * 24 * H) }],
    top: [{ kind: 'crash-session', msg: 'combat start', n: 2 }],
    ...over,
  };
}
const hour = (...platforms: CrashPlatformHour[]): CrashHourDigest => ({ mode: 'hour', platforms });
const spikey = (n = 14, over: Partial<CrashPlatformHour> = {}): CrashPlatformHour => plat({
  n, users: 9,
  kinds: [{ kind: 'crash-session', n: n - 2, users: 8, first: iso(T0 - 6 * 24 * H) }, { kind: 'error', n: 2, users: 1, first: iso(T0 - 3 * 24 * H) }],
  versions: [{ v: '0.41.3', n, users: 9, first: iso(T0 - 6 * 24 * H) }],
  top: [{ kind: 'crash-session', msg: 'combat start', n: 8 }, { kind: 'error', msg: 'TypeError: x is undefined', n: 2 }],
  ...over,
});

describe('spike detection', () => {
  it('the threshold is max(5, 3x the hourly mean)', () => {
    expect(spikeThreshold(0)).toBe(SPIKE_MIN);
    expect(spikeThreshold(0.6)).toBe(5);
    expect(spikeThreshold(2)).toBe(6);
    expect(spikeThreshold(4.1)).toBe(13);
    expect(spikeThreshold(Number.NaN)).toBe(5);
  });
  it('a normal hour is not hot; the floor and the multiple both have to be met', () => {
    expect(reasonsOf(plat({ n: 4 }), T0)).toEqual([]);
    expect(reasonsOf(plat({ n: 5 }), T0)).toEqual(['spike']);
    const busy = { total: 168 * 4, mean: 4, sd: 2, max: 9, hours: 168 };
    expect(reasonsOf(plat({ n: 11, base: busy }), T0)).toEqual([]);
    expect(reasonsOf(plat({ n: 12, base: busy }), T0)).toEqual(['spike']);
  });
  it('a NEW build with >= 3 reports from >= 2 players is hot below the spike line', () => {
    const v = (n: number, users: number, firstAgo: number) => plat({ n, versions: [{ v: '0.42.0', n, users, first: iso(T0 - firstAgo) }] });
    expect(reasonsOf(v(3, 2, 2 * H), T0)).toEqual(['new_version:0.42.0']);
    expect(reasonsOf(v(3, 1, 2 * H), T0)).toEqual([]); // one player is not a bad build
    expect(reasonsOf(v(2, 2, 2 * H), T0)).toEqual([]);
    expect(reasonsOf(v(3, 2, NEW_WINDOW_MS + H), T0)).toEqual([]); // seen for over a day: not new
    // An unknown version ('?', older clients) is never "new".
    expect(reasonsOf(plat({ n: 3, versions: [{ v: '?', n: 3, users: 3, first: iso(T0 - H) }] }), T0)).toEqual([]);
  });
  it('a NEW kind likewise', () => {
    const p = plat({ n: 3, kinds: [{ kind: 'renderer-gone', n: 3, users: 2, first: iso(T0 - 30 * MIN) }] });
    expect(reasonsOf(p, T0)).toEqual(['new_kind:renderer-gone']);
  });
});

describe('decideCrash: the rate limit and recovery', () => {
  it('quiet -> hot posts one spike message at once', () => {
    const d = decideCrash(emptyCrashState(), hour(spikey()), T0);
    expect(d.sends.map((s) => [s.platform, s.kind])).toEqual([['phone', 'spike']]);
    expect(d.next.platforms.phone).toMatchObject({ since: T0, lastAlertAt: T0, lastHotAt: T0, peak: 14, reasons: ['spike'] });
    expect(d.next.lastEvalAt).toBe(T0);
  });
  it('still hot: nothing for 2 hours, then one reminder, and the peak is kept', () => {
    let st = decideCrash(emptyCrashState(), hour(spikey()), T0).next;
    for (let t = T0 + 15 * MIN; t < T0 + CRASH_REMIND_MS; t += 15 * MIN) {
      const d = decideCrash(st, hour(spikey(t === T0 + 30 * MIN ? 30 : 14)), t);
      expect(d.sends).toEqual([]);
      st = d.next;
    }
    const d = decideCrash(st, hour(spikey(9)), T0 + CRASH_REMIND_MS);
    expect(d.sends.map((s) => s.kind)).toEqual(['still']);
    expect(d.next.platforms.phone).toMatchObject({ since: T0, lastAlertAt: T0 + CRASH_REMIND_MS, peak: 30 });
    expect(d.sends[0]!.text).toContain('still high');
    expect(d.sends[0]!.text).toContain('Peak this streak: 30 reports in an hour.');
  });
  it('a new build appearing mid-spike waits for the next message (one per platform per 2 hours)', () => {
    const st = decideCrash(emptyCrashState(), hour(spikey()), T0).next;
    const withBuild = spikey(14, { versions: [{ v: '0.42.0', n: 10, users: 6, first: iso(T0) }] });
    const d = decideCrash(st, hour(withBuild), T0 + 15 * MIN);
    expect(d.sends).toEqual([]);
    expect(d.next.platforms.phone!.reasons).toEqual(['spike', 'new_version:0.42.0']);
  });
  it('platforms are independent: a desktop spike during a phone spike posts its own message', () => {
    const st = decideCrash(emptyCrashState(), hour(spikey()), T0).next;
    const d = decideCrash(st, hour(spikey(), spikey(7, { platform: 'desktop' })), T0 + 15 * MIN);
    expect(d.sends.map((s) => [s.platform, s.kind])).toEqual([['desktop', 'spike']]);
  });
  it('recovery: one "back to normal" after a quiet 30 minutes, not after one quiet quarter-hour', () => {
    let st = decideCrash(emptyCrashState(), hour(spikey()), T0).next;
    // One quiet quarter, then hot again: no recovery, no new spike message (still the same streak).
    let d = decideCrash(st, hour(plat()), T0 + 15 * MIN);
    expect(d.sends).toEqual([]);
    st = d.next;
    d = decideCrash(st, hour(spikey()), T0 + 30 * MIN);
    expect(d.sends).toEqual([]);
    st = d.next;
    d = decideCrash(st, hour(plat()), T0 + 45 * MIN);
    expect(d.sends).toEqual([]);
    st = d.next;
    // The phone stops appearing at all (zero reports): still a quiet hour.
    d = decideCrash(st, hour(), T0 + 30 * MIN + CRASH_CLEAR_MS);
    expect(d.sends.map((s) => s.kind)).toEqual(['recovered']);
    expect(d.sends[0]!.text).toBe('**ASCENT crashes: phone back to normal** (2026-11-22 15:30 UTC)\nHigh since 2026-11-22 14:30 UTC; peaked at 14 reports in an hour. Last hour: 0.');
    expect(d.next.platforms).toEqual({});
    // Hot again later: a fresh spike message at once.
    expect(decideCrash(d.next, hour(spikey()), T0 + 2 * H).sends.map((s) => s.kind)).toEqual(['spike']);
  });
});

describe('the spike message', () => {
  it('names the platform, counts vs normal, kinds, version, players, top messages and how to look', () => {
    const p = spikey(14, { versions: [{ v: '0.42.0', n: 13, users: 8, first: '2026-11-22T13:52:00Z' }, { v: '0.41.3', n: 1, users: 1, first: iso(T0 - 6 * 24 * H) }] });
    const text = decideCrash(emptyCrashState(), hour(p), T0).sends[0]!.text;
    expect(text).toBe([
      '**ASCENT crashes: phone crash spike** (2026-11-22 14:30 UTC)',
      '14 reports in the last hour from 9 players. Normal: 0.6 an hour over the last 7 days (alert at 5).',
      'Kinds: crash-session 12, error 2',
      'App version: 0.42.0 (13), 0.41.3 (1)',
      'New build 0.42.0: 13 reports from 8 players, first seen 2026-11-22 13:52 UTC',
      'Top:',
      '- crash-session: combat start (8)',
      '- error: TypeError: x is undefined (2)',
      'How to look: the "Spikes" query in docs/ops/crash-reports.md (last 2 hours by kind, version and message).',
    ].join('\n'));
  });
  it('a new build below the spike line says so in the header', () => {
    const p = plat({ n: 3, users: 2, versions: [{ v: '0.42.0', n: 3, users: 2, first: iso(T0 - 10 * MIN) }] });
    expect(decideCrash(emptyCrashState(), hour(p), T0).sends[0]!.text).toMatch(/^\*\*ASCENT crashes: phone new build crashing\*\*/);
  });
  it('scrubs emails, ids, tokens, URL queries, mentions and backticks; stays under Discord\'s cap', () => {
    expect(scrub('fail for bob@example.com at https://x.test/a?token=abc `x` @everyone 0f8fad5b-d9cb-469f-a165-70867728950e'))
      .toBe("fail for [email] at https://x.test/a?[redacted] 'x' (at)everyone [id]");
    expect(scrub('k'.repeat(40))).toBe('[redacted]');
    expect(scrub('a\nb')).toBe('a b');
    const many = spikey(14, { top: Array.from({ length: 3 }, () => ({ kind: 'error', msg: 'y'.repeat(5000), n: 1 })) });
    const text = decideCrash(emptyCrashState(), hour(many), T0).sends[0]!.text;
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});

describe('the daily summary', () => {
  const green: AlertState = { failing: {}, since: null, lastAlertAt: null, lastRunAt: Date.parse('2026-11-23T06:17:04Z') };
  const NOW = Date.parse('2026-11-23T06:20:00Z');
  const day: CrashDayDigest = {
    mode: 'day', day: '2026-11-22', total: 37, users: 21, avg7: 41,
    platforms: [
      { platform: 'phone', n: 30, users: 17, avg7: 35, kinds: [{ kind: 'crash-session', n: 28 }, { kind: 'error', n: 2 }] },
      { platform: 'desktop', n: 7, users: 4, avg7: 6, kinds: [{ kind: 'renderer-gone', n: 4 }, { kind: 'error', n: 3 }] },
      { platform: 'web', n: 0, users: 0, avg7: 1.3, kinds: [] },
    ],
    top: [
      { platform: 'phone', kind: 'crash-session', msg: 'combat start', n: 11 },
      { platform: 'desktop', kind: 'renderer-gone', msg: 'oom', n: 4 },
      { platform: 'phone', kind: 'crash-session', msg: 'shop open', n: 3 },
    ],
  };
  it('one message: totals by platform and kind vs the 7-day average, top 3, the health line', () => {
    expect(formatDailySummary(day, green, NOW)).toBe([
      '**ASCENT daily, 2026-11-22**: 37 crash reports from 21 players (7-day average 41 a day)',
      '- phone 30 (avg 35): crash-session 28, error 2',
      '- desktop 7 (avg 6.0): renderer-gone 4, error 3',
      '- web 0 (avg 1.3)',
      'Top:',
      '- phone crash-session: combat start (11)',
      '- desktop renderer-gone: oom (4)',
      '- phone crash-session: shop open (3)',
      'Health check 06:17 UTC: all green.',
      'How to look: docs/ops/crash-reports.md',
    ].join('\n'));
  });
  it('a day with zero crashes posts nothing', () => {
    expect(formatDailySummary({ ...day, total: 0, users: 0, platforms: [], top: [] }, green, NOW)).toBeNull();
  });
  it('the health line: failing, missing, stale', () => {
    expect(healthLine({ ...green, failing: { hub: 'down', 'writes.lobby': 'x' } }, NOW)).toBe('Health check 06:17 UTC: 2 failing: `hub`, `writes.lobby` (see the health alert).');
    expect(healthLine(null, NOW)).toBe('Health check: no daily run recorded yet.');
    expect(healthLine({ ...green, lastRunAt: NOW - 30 * H }, NOW)).toMatch(/^Health check: no daily run since 2026-11-22 00:20 UTC/);
  });
});

describe('timing', () => {
  it('evaluates on the quarter-hour ticks only, never twice in 15 minutes', () => {
    const st = emptyCrashState();
    expect(evalDue(st, Date.parse('2026-11-22T14:00:00Z'))).toBe(true);
    expect(evalDue(st, Date.parse('2026-11-22T14:05:00Z'))).toBe(false);
    expect(evalDue(st, Date.parse('2026-11-22T14:10:00Z'))).toBe(false);
    expect(evalDue(st, Date.parse('2026-11-22T14:15:00Z'))).toBe(true);
    expect(evalDue({ ...st, lastEvalAt: Date.parse('2026-11-22T14:15:00Z') }, Date.parse('2026-11-22T14:15:30Z'))).toBe(false);
    expect(evalDue({ ...st, lastEvalAt: Date.parse('2026-11-22T14:15:00Z') }, Date.parse('2026-11-22T14:30:00Z'))).toBe(true);
  });
  it('the summary from 06:20 UTC until handled today', () => {
    const st = emptyCrashState();
    expect(summaryDue(st, Date.parse('2026-11-23T06:15:00Z'))).toBe(false);
    expect(summaryDue(st, Date.parse('2026-11-23T06:20:00Z'))).toBe(true);
    expect(summaryDue(st, Date.parse('2026-11-23T06:55:00Z'))).toBe(true);
    expect(summaryDue(st, Date.parse('2026-11-23T07:00:00Z'))).toBe(false);
    expect(summaryDue({ ...st, lastSummaryDay: '2026-11-23' }, Date.parse('2026-11-23T06:25:00Z'))).toBe(false);
  });
});

// ── the plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────
function io(over: { webhook?: string | undefined; state?: CrashAlertState | null; status?: number; now?: number; hour?: unknown; day?: unknown; summary?: boolean; failDigest?: boolean } = {}) {
  let state: CrashAlertState | null = over.state ?? null;
  const posts: { url: string; body: { username: string; content: string; allowed_mentions: unknown } }[] = [];
  const asked: string[] = [];
  const logs: string[] = [];
  let puts = 0;
  const x: CrashIo & { posts: typeof posts; asked: string[]; logs: string[]; state: () => CrashAlertState | null; puts: () => number } = {
    webhook: 'webhook' in over ? over.webhook : HOOK,
    now: over.now ?? T0,
    store: { get: async () => state, put: async (s) => { state = s; puts++; } },
    health: { get: async () => ({ failing: {}, since: null, lastAlertAt: null, lastRunAt: (over.now ?? T0) - 3 * MIN }), put: async () => {} },
    digest: async (mode) => {
      asked.push(mode);
      if (over.failDigest) throw new Error('ops_crash_digest 404');
      return mode === 'hour' ? (over.hour ?? hour(spikey())) : (over.day ?? { mode: 'day', day: '2026-11-22', total: 0, users: 0, avg7: 0, platforms: [], top: [] });
    },
    fetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: (over.status ?? 204) < 300, status: over.status ?? 204 }; },
    summary: over.summary,
    log: (l) => logs.push(l),
    posts, asked, logs, state: () => state, puts: () => puts,
  };
  return x;
}

describe('crashTick', () => {
  it('without the webhook secret: nothing asked, sent or stored', async () => {
    const x = io({ webhook: undefined });
    expect(await crashTick(x)).toEqual({ evaluated: false, sent: [], summary: null });
    expect(x.asked).toEqual([]);
    expect(x.posts).toEqual([]);
    expect(x.puts()).toBe(0);
  });
  it('a spike posts once, as ASCENT crashes, mentioning nobody, with nothing identifying', async () => {
    const x = io();
    expect((await crashTick(x)).sent).toEqual(['spike']);
    expect(x.posts).toHaveLength(1);
    expect(x.posts[0]!.url).toBe(HOOK);
    expect(x.posts[0]!.body.username).toBe('ASCENT crashes');
    expect(x.posts[0]!.body.allowed_mentions).toEqual({ parse: [] });
    expect(x.state()!.platforms.phone!.lastAlertAt).toBe(T0);
    expect(x.logs.join('\n')).not.toContain('secret-token');
  });
  it('off-quarter ticks do not ask Supabase', async () => {
    const x = io({ now: T0 + 5 * MIN });
    await crashTick(x);
    expect(x.asked).toEqual([]);
    expect(x.puts()).toBe(0);
  });
  it('an undelivered spike is retried at the next evaluation', async () => {
    const x = io({ status: 500 });
    expect((await crashTick(x)).sent).toEqual([]);
    expect(x.state()!.platforms).toEqual({});
    expect(x.state()!.lastEvalAt).toBe(T0);
    const y = io({ state: x.state(), now: T0 + 15 * MIN });
    expect((await crashTick(y)).sent).toEqual(['spike']);
  });
  it('a failing digest posts nothing, leaves the clock alone and logs no URL', async () => {
    const x = io({ failDigest: true });
    await crashTick(x);
    expect(x.posts).toEqual([]);
    expect(x.state()!.lastEvalAt).toBeNull();
    expect(x.logs.some((l) => l.includes('crash_alert_failed'))).toBe(true);
  });
  it('the 06:20 summary: a zero day is skipped and marked handled; a real day posts once', async () => {
    const at = Date.parse('2026-11-23T06:20:00Z');
    const zero = io({ now: at });
    expect((await crashTick(zero)).summary).toBe('skipped');
    expect(zero.posts).toEqual([]);
    expect(zero.state()!.lastSummaryDay).toBe('2026-11-23');

    const day: CrashDayDigest = { mode: 'day', day: '2026-11-22', total: 3, users: 2, avg7: 1, platforms: [{ platform: 'phone', n: 3, users: 2, avg7: 1, kinds: [{ kind: 'crash-session', n: 3 }] }], top: [] };
    const real = io({ now: at, day });
    expect((await crashTick(real)).summary).toBe('sent');
    expect(real.asked).toEqual(['day']); // 06:20 is not a quarter-hour tick
    expect(real.posts[0]!.body.content).toContain('Health check 06:17 UTC: all green.');
    const again = io({ now: at + 5 * MIN, day, state: real.state() });
    expect((await crashTick(again)).summary).toBeNull();
    expect(again.posts).toEqual([]);
  });
  it('the summary can be turned off', async () => {
    const x = io({ now: Date.parse('2026-11-23T06:20:00Z'), summary: false });
    await crashTick(x);
    expect(x.asked).toEqual([]);
  });
});
