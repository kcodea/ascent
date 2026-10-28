/**
 * THE RUN-END OUTBOX POLICY (R-NET-OUTBOX-01, Supabase cleanup 2.4). Pure: a fake store, sender, reporter and clock.
 * Pins "no silent drops, no silent downgrades": a write leaves only when the server took it or rejected it for good
 * (and then it is reported); a transient failure keeps it and retries later; a column is dropped only when the server
 * names it missing, and never `unrated` / `user_id`; items stay bound to their account; the send leaves in the same
 * tick as the submit (the Career row must still go out ahead of the rank request).
 */
import { describe, expect, it } from 'vitest';
import { classify, createOutbox, memoryOutboxStore, OUTBOX_MAX, REPORT_AFTER_ATTEMPTS, retryDelay, type OutboxDeps, type SendError } from './runOutbox';

interface Sent { table: string; rows: Record<string, unknown>[]; conflict: string | undefined }

function harness(opts: { user?: string | null; answers?: (SendError | null)[] } = {}) {
  let user: string | null = opts.user === undefined ? 'u1' : opts.user;
  let now = 1_000_000;
  const answers = [...(opts.answers ?? [])];
  const sent: Sent[] = [];
  const reports: { kind: string; key: string; error: string; detail: Record<string, unknown> }[] = [];
  const scheduled: number[] = [];
  const store = memoryOutboxStore();
  const deps: OutboxDeps = {
    store,
    send: async (table, rows, conflict) => { sent.push({ table, rows, conflict }); return { error: answers.length ? answers.shift()! : null }; },
    report: async (kind, key, error, detail) => { reports.push({ kind, key, error, detail }); },
    currentUserId: () => user,
    now: () => now,
    schedule: (at) => { scheduled.push(at); },
  };
  const ob = createOutbox(deps);
  return {
    ob, sent, reports, scheduled, store,
    setUser: (u: string | null) => { user = u; },
    advance: (ms: number) => { now += ms; },
    now: () => now,
    answer: (...e: (SendError | null)[]) => { answers.push(...e); },
  };
}

const boards = (key = 'boards:b1:1') => ({ kind: 'boards' as const, key, table: 'boards', rows: [{ wave: 1, unrated: false, snapshot: { id: 'b1' } }], conflict: 'user_id,upload_key' });

describe('classify', () => {
  it('reads Postgres / PostgREST errors into retry, reject, done and the two schema cases', () => {
    expect(classify({ code: '57014', message: 'canceling statement due to statement timeout' }).kind).toBe('retry');
    expect(classify({ code: '40P01' }).kind).toBe('retry');
    expect(classify({ message: 'TypeError: Failed to fetch' }).kind).toBe('retry');
    expect(classify({ code: 'XX000', status: 503 }).kind).toBe('retry');
    expect(classify({ code: 'PGRST301', message: 'JWT expired' }).kind).toBe('retry');
    expect(classify({ code: '42501', message: 'new row violates row-level security policy' }).kind).toBe('reject');
    expect(classify({ code: '22P02' }).kind).toBe('reject');
    expect(classify({ code: '23514' }).kind).toBe('reject');
    expect(classify({ code: '23505' }).kind).toBe('done');
    expect(classify({ code: '42P10' }).kind).toBe('noConflictTarget');
    expect(classify({ code: 'PGRST204', message: "Could not find the 'buy_events' column of 'run_telemetry' in the schema cache" })).toEqual({ kind: 'missingColumn', column: 'buy_events' });
    expect(classify({ code: '42703', message: 'column "upload_key" does not exist' })).toEqual({ kind: 'missingColumn', column: 'upload_key' });
  });
  it('backs off 5 s, doubling, to 30 minutes', () => {
    expect([1, 2, 3, 4].map(retryDelay)).toEqual([5000, 10000, 20000, 40000]);
    expect(retryDelay(40)).toBe(30 * 60_000);
  });
});

describe('submit + flush', () => {
  it('sends at once (same tick), stamps the account, and forgets the item when the server takes it', async () => {
    const h = harness();
    const p = h.ob.submit(boards());
    expect(h.sent).toHaveLength(1); // issued synchronously, before any storage await
    expect(await p).toBe('sent');
    expect(h.sent[0]).toEqual({ table: 'boards', rows: [{ wave: 1, unrated: false, snapshot: { id: 'b1' }, user_id: 'u1' }], conflict: 'user_id,upload_key' });
    expect(await h.ob.pending()).toHaveLength(0);
  });

  it('a timeout keeps the item, retries after the delay, and a later success clears it (never lost, never doubled)', async () => {
    const h = harness({ answers: [{ code: '57014' }] });
    expect(await h.ob.submit(boards())).toBe('queued');
    const [item] = await h.ob.pending();
    expect(item).toMatchObject({ attempts: 1, nextAt: h.now() + 5000, userId: 'u1' });
    expect(h.scheduled).toEqual([h.now() + 5000]);
    await h.ob.flush(); // not due yet
    expect(h.sent).toHaveLength(1);
    h.advance(5000);
    await h.ob.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.conflict).toBe('user_id,upload_key'); // the same idempotent upsert
    expect(await h.ob.pending()).toHaveLength(0);
    expect(h.reports).toHaveLength(0);
  });

  it('a permanent rejection removes the item and REPORTS it; a duplicate is simply done', async () => {
    const h = harness({ answers: [{ code: '42501', message: 'rls' }, { code: '23505' }] });
    expect(await h.ob.submit(boards('a'))).toBe('rejected');
    expect(h.reports).toMatchObject([{ kind: 'boards', key: 'a', detail: { rejected: true } }]);
    expect(await h.ob.submit(boards('b'))).toBe('sent');
    expect(await h.ob.pending()).toHaveLength(0);
  });

  it('drops ONLY a column the server names as missing, never `unrated` (no silent downgrade)', async () => {
    const tel = { kind: 'telemetry' as const, key: 't', table: 'run_telemetry', rows: [{ hero_id: 'h', buy_events: [], unrated: true }] };
    const h = harness({ answers: [{ code: 'PGRST204', message: "Could not find the 'buy_events' column of 'run_telemetry' in the schema cache" }] });
    expect(await h.ob.submit(tel)).toBe('sent');
    expect(h.sent[1]!.rows[0]).toEqual({ hero_id: 'h', unrated: true, user_id: 'u1' });
    // `unrated` missing: refused and reported, never re-sent without the tag.
    const h2 = harness({ answers: [{ code: 'PGRST204', message: "Could not find the 'unrated' column of 'boards' in the schema cache" }] });
    expect(await h2.ob.submit({ ...boards(), rows: [{ wave: 1, unrated: true }] })).toBe('rejected');
    expect(h2.sent).toHaveLength(1);
    expect(h2.reports).toHaveLength(1);
  });

  it('a backend without the idempotency key gets the plain insert (the old behaviour), remembered for the table', async () => {
    const h = harness({ answers: [{ code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' }] });
    expect(await h.ob.submit(boards('x'))).toBe('sent');
    expect(h.sent.map((s) => s.conflict)).toEqual(['user_id,upload_key', undefined]);
    await h.ob.submit(boards('y'));
    expect(h.sent[2]!.conflict).toBeUndefined();
    // A telemetry row that SENDS the key column: the column goes too.
    const h2 = harness({ answers: [{ code: 'PGRST204', message: "Could not find the 'upload_key' column of 'run_telemetry' in the schema cache" }] });
    await h2.ob.submit({ kind: 'telemetry', key: 't', table: 'run_telemetry', rows: [{ hero_id: 'h', upload_key: 'k' }], conflict: 'user_id,upload_key' });
    expect(h2.sent[1]).toEqual({ table: 'run_telemetry', rows: [{ hero_id: 'h', user_id: 'u1' }], conflict: undefined });
  });

  it('is account-bound: another account never sends it; a session-less item is adopted, its boards UNRATED', async () => {
    const h = harness({ user: null });
    expect(await h.ob.submit(boards('offline'))).toBe('queued');
    expect(h.sent).toHaveLength(0);
    h.setUser('u2');
    await h.ob.flush();
    expect(h.sent[0]!.rows[0]).toMatchObject({ user_id: 'u2', unrated: true });

    const h2 = harness({ user: 'u1', answers: [{ message: 'Failed to fetch' }] });
    await h2.ob.submit(boards('mine'));
    h2.setUser('u3');
    h2.advance(60_000);
    await h2.ob.flush();
    expect(h2.sent).toHaveLength(1); // parked under u1
    h2.setUser('u1');
    await h2.ob.flush();
    expect(h2.sent.map((s) => s.rows[0]!.user_id)).toEqual(['u1', 'u1']);
  });

  it('a flush goes oldest first and stops at the first transient failure', async () => {
    const h = harness({ user: null });
    for (const k of ['k1', 'k2', 'k3']) { await h.ob.submit(boards(k)); h.advance(1); }
    h.setUser('u1');
    h.answer(null, { message: 'Failed to fetch' });
    await h.ob.flush();
    expect(h.sent.map((s) => (s.rows[0] as { snapshot: { id: string } }).snapshot.id)).toEqual(['b1', 'b1']);
    const left = (await h.ob.pending()).map((i) => i.key).sort();
    expect(left).toEqual(['k2', 'k3']);
  });

  it('reports a write still failing after 5 tries (once) and keeps retrying it', async () => {
    const h = harness({ answers: Array.from({ length: 7 }, () => ({ code: '57014' })) });
    await h.ob.submit(boards());
    for (let i = 0; i < 6; i++) { h.advance(31 * 60_000); await h.ob.flush(); }
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]!.detail).toMatchObject({ attempts: REPORT_AFTER_ATTEMPTS, stillRetrying: true });
    expect(await h.ob.pending()).toHaveLength(1);
  });

  it('an overflowing outbox evicts the OLDEST item and reports it', async () => {
    const h = harness({ user: null });
    for (let i = 0; i <= OUTBOX_MAX; i++) { await h.ob.submit(boards(`k${i}`)); h.advance(1); }
    const keys = (await h.ob.pending()).map((i) => i.key);
    expect(keys).toHaveLength(OUTBOX_MAX);
    expect(keys).not.toContain('k0');
    expect(h.reports).toMatchObject([{ key: 'k0', error: 'evicted: outbox full' }]);
  });
});
