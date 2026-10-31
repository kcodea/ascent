/**
 * The Live Games directory's activity tally (R-OPS-HEALTH-01): the health check's "were games played?". Counts by kind
 * and hour, the lobby games' content revisions, a bounded keep window, and the window sum the freshness check reads.
 */
import { describe, expect, it } from 'vitest';
import { ActivityTally, activityKind, activitySince } from '../src/core/liveActivity';
import { ACTIVITY_KEEP_HOURS } from '../src/health/healthProtocol';

const T0 = Date.parse('2026-10-31T10:05:00Z');
const H = 3_600_000;

describe('activity tally', () => {
  it('counts each kind', () => {
    expect([null, 'casual', 'practice', 'duel', 'group', 'duos', 'ranked_duos'].map((mode) => activityKind({ mode: mode as never })))
      .toEqual(['lobby', 'casual', 'practice', 'versus', 'versus', 'duos', 'duos']);
  });
  it('tallies per UTC hour, with the lobby games\' revisions', () => {
    const t = new ActivityTally();
    expect(t.note({ mode: null, live_host: 'cf:abc123' }, T0)).toBe('2026-10-31T10');
    t.note({ mode: null, live_host: 'cf:abc123' }, T0 + 60_000);
    t.note({ mode: 'duel', live_host: null }, T0 + H);
    t.note({ mode: null, live_host: 'not a host' }, T0 + H);
    const snap = t.snapshot(T0 + H);
    expect(snap.hours['2026-10-31T10']).toMatchObject({ lobby: 2, revs: { abc123: 2 } });
    expect(snap.hours['2026-10-31T11']).toMatchObject({ lobby: 1, versus: 1, revs: {} });
  });
  it('keeps only the window', () => {
    const t = new ActivityTally();
    t.note({ mode: null, live_host: null }, T0);
    t.note({ mode: null, live_host: null }, T0 + 10 * H);
    expect(t.prune(T0 + ACTIVITY_KEEP_HOURS * H)).toEqual(['2026-10-31T10']);
    expect(Object.keys(t.snapshot(T0 + ACTIVITY_KEEP_HOURS * H).hours)).toEqual(['2026-10-31T20']);
  });
  it('bounds one hour\'s revisions', () => {
    const t = new ActivityTally();
    for (let i = 0; i < 40; i++) t.note({ mode: null, live_host: `cf:r${i}` }, T0);
    expect(Object.keys(t.hours.get('2026-10-31T10')!.revs).length).toBeLessThanOrEqual(16);
  });
  it('sums a window and names the newest revision', () => {
    const t = new ActivityTally();
    t.note({ mode: null, live_host: 'cf:old' }, T0 - 30 * H);
    t.note({ mode: null, live_host: 'cf:old' }, T0 - 2 * H);
    t.note({ mode: null, live_host: 'cf:new' }, T0);
    t.note({ mode: 'ranked_duos', live_host: null }, T0);
    const s = activitySince(t.snapshot(T0), T0 - 24 * H);
    expect(s).toMatchObject({ lobby: 2, duos: 1, latestRev: 'new' });
  });
});
