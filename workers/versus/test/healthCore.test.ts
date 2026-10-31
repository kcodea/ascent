/**
 * THE DAILY HEALTH CHECK (R-OPS-HEALTH-01; owner 2026-10-31: "a small daily health check that compares the Cloudflare
 * pool copy against Supabase, confirms the hub is up, and confirms the end-of-game writes are arriving"). Every check on
 * stubs: the hub and Versus Worker health, the current-revision lookup, pool parity (and how a mismatch is named),
 * write freshness against activity, the session flush, the writer key, and that a capability the hub does not
 * advertise makes its check n/a, never a failure.
 */
import { describe, expect, it } from 'vitest';
import {
  checkHub, checkPool, checkSession, checkVersus, checkWriterKey, checkWrites, comparePoolDigests, currentVersus, formatSummary,
  runHealth, type HealthDeps, type WriteProbe,
} from '../src/health/healthCore';
import { emptyHour, hourKey, poolDigestOf, type HealthResult, type HubActivity, type PoolDigest } from '../src/health/healthProtocol';

const NOW = Date.parse('2026-10-31T06:17:00Z');
const HUB = 'https://hub.test';
const SITE = 'https://site.test';
const VERSUS = 'https://ascent-versus-v1-abc123.team-ascent.workers.dev';

const probe = (over: Partial<WriteProbe> = {}): WriteProbe => ({
  since: new Date(NOW - 86_400_000).toISOString(), key_note: 'ascent-hub', writer_keys: ['versus', 'ascent-hub'],
  counts: { run_history: 12, boards: 80, lobby_fights: 60, run_telemetry: 12, versus_cf: 4, duos_history: 3, saved_runs: 40, in_game: 9 },
  latest: { run_history: '2026-10-31T05:00:00Z' }, latest_cf_revision: 'abc123', session: null, ...over,
});
const activity = (h: Partial<ReturnType<typeof emptyHour>>, at = NOW - 3_600_000): HubActivity => ({ hours: { [hourKey(at)]: { ...emptyHour(), ...h } } });
const digest = (rows: [number, string, string][]): PoolDigest => ({ count: rows.length, digest: rows.map((r) => r.join(':')).join(','), rows: rows.map(([run_id, rev, h]) => ({ run_id, rev, h })) });

function deps(over: Partial<HealthDeps> & { routes?: Record<string, { status: number; body: unknown }> } = {}): HealthDeps {
  const routes: Record<string, { status: number; body: unknown }> = {
    [`${HUB}/health`]: { status: 200, body: { hub: 3, min: 1, code: 'a1b2c3d4e5f60718', caps: ['live_dir', 'activity'] } },
    [`${SITE}/release.json`]: { status: 200, body: { sha: 'deadbee', contentRevision: 'abc123', versusWorker: VERSUS } },
    [`${VERSUS}/health`]: { status: 200, body: { cfProtocol: 1, protocol: 7, contentRevision: 'abc123' } },
    ...over.routes,
  };
  return {
    source: 'cron', now: NOW, hubUrl: HUB, siteUrl: SITE, cfProtocol: 1,
    getJson: async (url) => { const r = routes[url]; if (!r) throw new Error(`fetch failed: ${url}`); return r; },
    probe: async () => probe(),
    sqlPoolDigest: async () => digest([[1, 'r1', 'h1']]),
    mirrorPoolDigest: async () => digest([[1, 'r1', 'h1']]),
    activity: async () => activity({ lobby: 5, versus: 3, duos: 3, revs: { abc123: 5 } }),
    ...over,
  };
}
const byCheck = (rs: HealthResult[]): Record<string, HealthResult> => Object.fromEntries(rs.map((r) => [r.check, r]));

describe('hub', () => {
  it('ok with a sane protocol range and a deploy hash; reports caps', async () => {
    const { result, caps } = await checkHub(deps());
    expect(result.status).toBe('ok');
    expect(caps).toEqual(['live_dir', 'activity']);
  });
  it('fails when down, when the range is bad, or when it carries no deploy hash', async () => {
    expect((await checkHub(deps({ routes: { [`${HUB}/health`]: { status: 503, body: null } } }))).result.status).toBe('fail');
    expect((await checkHub(deps({ routes: { [`${HUB}/health`]: { status: 200, body: { hub: 1, min: 2, code: 'x' } } } }))).result.status).toBe('fail');
    const dev = await checkHub(deps({ routes: { [`${HUB}/health`]: { status: 200, body: { hub: 3, min: 1, code: 'dev' } } } }));
    expect(dev.result.status).toBe('fail');
    expect(dev.caps).toEqual([]);
    expect((await checkHub(deps({ getJson: async () => { throw new Error('offline'); } }))).result.detail.error).toMatch(/offline/);
  });
});

describe('the current Versus Worker', () => {
  it('reads the release record first', async () => {
    expect(await currentVersus(deps(), 'zzz', probe())).toEqual({ url: VERSUS, rev: 'abc123', source: 'release.json' });
  });
  it('falls back to the live lobby revision, then the newest Cloudflare match, then n/a', async () => {
    const d = deps({ routes: { [`${SITE}/release.json`]: { status: 200, body: null } } }); // the SPA fallback page: not JSON
    expect((await currentVersus(d, 'live9', probe()))?.source).toBe('live lobby games');
    expect((await currentVersus(d, 'live9', probe()))?.url).toBe('https://ascent-versus-v1-live9.team-ascent.workers.dev');
    expect((await currentVersus(d, null, probe()))?.rev).toBe('abc123');
    expect(await currentVersus(d, null, probe({ latest_cf_revision: null }))).toBeNull();
    expect((await checkVersus(d, null)).status).toBe('n/a');
  });
  it('ok when the Worker carries its own name; fails on a wrong revision or protocol, or when down', async () => {
    const cur = { url: VERSUS, rev: 'abc123', source: 'release.json' };
    expect((await checkVersus(deps(), cur)).status).toBe('ok');
    const wrong = await checkVersus(deps({ routes: { [`${VERSUS}/health`]: { status: 200, body: { cfProtocol: 1, protocol: 7, contentRevision: 'old' } } } }), cur);
    expect(wrong.status).toBe('fail');
    expect(String(wrong.detail.problems)).toMatch(/carries old/);
    expect((await checkVersus(deps({ routes: { [`${VERSUS}/health`]: { status: 200, body: { cfProtocol: 2, contentRevision: 'abc123' } } } }), cur)).status).toBe('fail');
    expect((await checkVersus(deps({ routes: { [`${VERSUS}/health`]: { status: 404, body: null } } }), cur)).status).toBe('fail');
  });
});

describe('pool parity', () => {
  it('is n/a until the hub advertises pool_mirror (no mirror call is made)', async () => {
    let called = false;
    const rs = await checkPool(deps({ mirrorPoolDigest: async () => { called = true; return digest([]); } }), ['live_dir']);
    expect(rs.map((r) => [r.check, r.status])).toEqual([['pool.whole', 'n/a'], ['pool.draw', 'n/a']]);
    expect(called).toBe(false);
  });
  it('ok when both sides agree, for the whole pool and the seeded draw', async () => {
    const seen: unknown[] = [];
    const rs = await checkPool(deps({ sqlPoolDigest: async (p) => { seen.push(p); return digest([[1, 'r1', 'h1']]); } }), ['pool_mirror']);
    expect(rs.every((r) => r.status === 'ok')).toBe(true);
    expect(seen).toEqual([null, { p_limit: 150, p_seed: 'health:2026-10-31' }]);
  });
  it('names what differs: missing, extra, stale (rev moved) and byte drift (same rev, other text)', () => {
    const sql = digest([[1, 'a', 'x'], [2, 'b', 'y'], [3, 'c', 'z'], [4, 'd', 'w']]);
    const mirror = digest([[1, 'a', 'x'], [2, 'B', 'y'], [3, 'c', 'Z'], [5, 'e', 'v']]);
    const c = comparePoolDigests(sql, mirror);
    expect(c.same).toBe(false);
    expect(c.detail).toMatchObject({ missing: [4], extra: [5], stale: [2], byteDrift: [3], orderDiffers: false });
    const reordered = comparePoolDigests(digest([[1, 'a', 'x'], [2, 'b', 'y']]), digest([[2, 'b', 'y'], [1, 'a', 'x']]));
    expect(reordered.detail.orderDiffers).toBe(true);
  });
  it('a mirror error is a failure of that check only', async () => {
    const rs = await checkPool(deps({ mirrorPoolDigest: async () => { throw new Error('mirror_cold'); } }), ['pool_mirror']);
    expect(rs.map((r) => r.status)).toEqual(['fail', 'fail']);
  });
  it('poolDigestOf: one line per run in draw order, boards hashed, rows carry 16 hex', async () => {
    const a = await poolDigestOf([{ run_id: 1, run_key: 'A|h|1', rev: 'r', boards: '[{"x": 1}]' }]);
    const b = await poolDigestOf([{ run_id: 1, run_key: 'A|h|1', rev: 'r', boards: '[{"x": 2}]' }]);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(a.digest).not.toBe(b.digest);
    expect(a.rows[0]!.h).toHaveLength(16);
  });
});

describe('write freshness', () => {
  const since = NOW - 86_400_000;
  it('ok when games were listed and every end-of-game table got rows', () => {
    const rs = byCheck(checkWrites(probe(), activity({ lobby: 5, versus: 3, duos: 3 }), since));
    expect(rs['writes.lobby']!.status).toBe('ok');
    expect(rs['writes.versus']!.status).toBe('ok');
    expect(rs['writes.duos']!.status).toBe('ok');
  });
  it('fails when lobby games were listed but no run_history (or boards, or lobby_fights) arrived', () => {
    const rs = byCheck(checkWrites(probe({ counts: { ...probe().counts, run_history: 0, lobby_fights: 0 } }), activity({ lobby: 5 }), since));
    expect(rs['writes.lobby']!.status).toBe('fail');
    expect(rs['writes.lobby']!.detail.missing).toEqual(['run_history', 'lobby_fights']);
  });
  it('fails when Versus or Duos rooms were listed but no match rows arrived', () => {
    const rs = byCheck(checkWrites(probe({ counts: { ...probe().counts, versus_cf: 0, duos_history: 0 } }), activity({ versus: 4, duos: 4 }), since));
    expect(rs['writes.versus']!.status).toBe('fail');
    expect(rs['writes.duos']!.status).toBe('fail');
  });
  it('a quiet day is n/a, not a failure', () => {
    const rs = byCheck(checkWrites(probe({ counts: { run_history: 0, boards: 0, lobby_fights: 0, versus_cf: 0, duos_history: 0 } }), activity({ lobby: 1, versus: 1 }), since));
    expect(Object.values(rs).map((r) => r.status)).toEqual(['n/a', 'n/a', 'n/a']);
  });
  it('only counts activity inside the window', () => {
    const old = activity({ lobby: 50 }, NOW - 30 * 3_600_000);
    expect(byCheck(checkWrites(probe({ counts: { run_history: 0 } }), old, since))['writes.lobby']!.status).toBe('n/a');
  });
  it('without the hub tally, the lobby check keys on cloud saves; Versus and Duos are n/a', () => {
    const busy = byCheck(checkWrites(probe({ counts: { saved_runs: 10, run_history: 0, boards: 3, lobby_fights: 3 } }), null, since));
    expect(busy['writes.lobby']!.status).toBe('fail');
    expect(busy['writes.versus']!.status).toBe('n/a');
    expect(byCheck(checkWrites(probe({ counts: { saved_runs: 1 } }), null, since))['writes.lobby']!.status).toBe('n/a');
  });
});

describe('session flush and writer key', () => {
  it('session: n/a until advertised and applied; fails on rejected writes', () => {
    expect(checkSession(probe({ session: { applied: 3, rejected: 2 } }), ['live_dir']).status).toBe('n/a');
    expect(checkSession(probe(), ['session']).status).toBe('n/a');
    expect(checkSession(probe({ session: { applied: 30, rejected: 0 } }), ['session']).status).toBe('ok');
    expect(checkSession(probe({ session: { applied: 30, rejected: 2 } }), ['session']).status).toBe('fail');
    expect(checkSession(null, ['session']).status).toBe('fail');
  });
  it('writer key: the cron proves its own key; the CLI checks the hub row exists', () => {
    expect(checkWriterKey('cron', probe(), null).status).toBe('ok');
    expect(checkWriterKey('cron', null, 'ops_health_probe 400: not_authorized').status).toBe('fail');
    expect(checkWriterKey('cli', probe({ key_note: undefined }), null).status).toBe('ok');
    expect(checkWriterKey('cli', probe({ key_note: undefined, writer_keys: ['versus'] }), null).status).toBe('fail');
  });
});

describe('the run', () => {
  it('a healthy day: every check ok or n/a; pool and session n/a until those capabilities ship', async () => {
    const rs = byCheck(await runHealth(deps()));
    expect(Object.keys(rs)).toEqual(['hub', 'versus_worker', 'pool.whole', 'pool.draw', 'writes.lobby', 'writes.versus', 'writes.duos', 'session.flush', 'writer_key']);
    expect(Object.values(rs).filter((r) => r.status === 'fail')).toEqual([]);
    expect(rs['pool.whole']!.status).toBe('n/a');
    expect(rs['session.flush']!.status).toBe('n/a');
  });
  it('a refused key fails the writer key and every write check, and the rest still run', async () => {
    const rs = byCheck(await runHealth(deps({ probe: async () => { throw new Error('ops_health_probe 400: not_authorized'); } })));
    expect(rs.writer_key!.status).toBe('fail');
    expect(rs['writes.lobby']!.status).toBe('fail');
    expect(rs.hub!.status).toBe('ok');
    expect(rs.versus_worker!.status).toBe('ok'); // the release record still names the Worker
  });
  it('the summary names the failing checks', async () => {
    const rs = await runHealth(deps({ routes: { [`${HUB}/health`]: { status: 500, body: null } } }));
    expect(formatSummary(rs)).toMatch(/^health: 1 FAILING \(hub\)/);
    expect(formatSummary(await runHealth(deps()))).toMatch(/^health: all good/);
  });
});
