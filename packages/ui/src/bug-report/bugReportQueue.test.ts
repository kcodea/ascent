// @vitest-environment jsdom
/**
 * BUG REPORTER (PR 2) — queue + upload reliability (blueprint §14.4).
 *
 * Covers, in order: persistence-before-close (through the real store), reload survival (a minimal in-memory
 * IndexedDB stub backing two separate `indexedDbBugReportStore` instances — jsdom itself has no IDB), success
 * removes the item, failure increments attempts and retains, idempotent retries via the stable reportId
 * (200 and 201 both count as success), and the 25-report retention cap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRun } from '@game/sim';
import { buildBugReportEnvelope, buildClientContext, captureIncidentCapsule } from './bugReportCapture';
import type { BugReportEnvelope } from './bugReportTypes';
import {
  backoffMs,
  BUG_QUEUE_MAX,
  bugReportQueue,
  capOverflow,
  indexedDbBugReportStore,
  memoryBugReportStore,
  toQueued,
} from './bugReportQueue';
import { attemptBugReportUpload, enqueueBugReport, flushBugReportQueue, trimEnvelope, type BugUploadOutcome } from './bugReportUpload';
import { useGame } from '../store';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────────────

function makeCapsule() {
  return captureIncidentCapsule({
    run: createRun(777),
    replayActions: [],
    replayFrames: [],
    inspect: null,
    showLeaderboard: false, showRankings: false, showRecentGames: false, showCareer: false,
    showBook: false, showBalance: false, showPatchNotes: false,
    combatSpeed: 1,
  });
}

const CAPSULE = makeCapsule();

function makeEnvelope(description = 'The Echo did not trigger on my left-most minion.'): BugReportEnvelope {
  return buildBugReportEnvelope(
    CAPSULE,
    description,
    'mechanics',
    buildClientContext({ account: { userId: 'u-test' }, playerName: 'Tester', setId: CAPSULE.setId }),
  );
}

const ok = (id: string): BugUploadOutcome => ({ kind: 'success', id });

// ── A minimal in-memory IndexedDB stub (just what bugReportQueue.ts calls) ────────────────────────────────

type Handler = ((this: unknown, ev: unknown) => unknown) | null;

class FakeRequest {
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
  result: unknown = undefined;
  succeed(v: unknown): void {
    this.result = v;
    queueMicrotask(() => { this.onsuccess?.call(this, {}); });
  }
}

function keyOf(value: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], value);
}

class FakeObjectStore {
  constructor(private data: Map<unknown, unknown>, private keyPath: string) {}
  put(v: unknown): FakeRequest {
    const req = new FakeRequest();
    this.data.set(keyOf(v, this.keyPath), structuredClone(v));
    req.succeed(undefined);
    return req;
  }
  get(k: unknown): FakeRequest {
    const req = new FakeRequest();
    req.succeed(this.data.has(k) ? structuredClone(this.data.get(k)) : undefined);
    return req;
  }
  getAll(): FakeRequest {
    const req = new FakeRequest();
    req.succeed([...this.data.values()].map((v) => structuredClone(v)));
    return req;
  }
  delete(k: unknown): FakeRequest {
    const req = new FakeRequest();
    this.data.delete(k);
    req.succeed(undefined);
    return req;
  }
}

class FakeDb {
  stores = new Map<string, { data: Map<unknown, unknown>; keyPath: string }>();
  objectStoreNames = { contains: (n: string): boolean => this.stores.has(n) };
  createObjectStore(name: string, opts: { keyPath: string }): void {
    this.stores.set(name, { data: new Map(), keyPath: opts.keyPath });
  }
  transaction(names: string[] | string): { objectStore: (n: string) => FakeObjectStore; oncomplete: Handler; onerror: Handler; onabort: Handler } {
    void names;
    const tx = {
      oncomplete: null as Handler,
      onerror: null as Handler,
      onabort: null as Handler,
      objectStore: (n: string): FakeObjectStore => {
        const s = this.stores.get(n)!;
        return new FakeObjectStore(s.data, s.keyPath);
      },
    };
    // Complete after the caller's synchronous ops + their microtask callbacks have run.
    setTimeout(() => { tx.oncomplete?.call(tx, {}); }, 0);
    return tx;
  }
}

/** Databases persist across `open` calls for the lifetime of the stub — a fresh store instance over the same
 *  stub is "the same browser after a reload". */
function fakeIndexedDb(): { open: (name: string, version: number) => FakeRequest } {
  const dbs = new Map<string, FakeDb>();
  return {
    open(name: string): FakeRequest {
      const req = new FakeRequest();
      let db = dbs.get(name);
      const isNew = !db;
      if (!db) { db = new FakeDb(); dbs.set(name, db); }
      req.result = db;
      queueMicrotask(() => {
        if (isNew) req.onupgradeneeded?.call(req, {});
        req.onsuccess?.call(req, {});
      });
      return req;
    },
  };
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

// ── §14.4: report is persisted before modal closure is considered successful ─────────────────────────────

describe('submitBugReport (store seam)', () => {
  it('persists to the queue before the modal closes, then reports the offline confirmation', async () => {
    // Drain anything a previous test left in the shared (memory) queue.
    for (const i of await bugReportQueue.all()) await bugReportQueue.remove(i.envelope.reportId);
    useGame.setState({
      run: createRun(4242),
      replayActions: [], replayFrames: [],
      showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, presentationTx: null,
      bugReportOpen: false, bugReportDraft: null, bugReportToast: null,
    });
    useGame.getState().openBugReport();
    expect(useGame.getState().bugReportOpen).toBe(true);
    useGame.getState().updateBugReportDraft({ description: 'My minion attacked twice in one beat.' });

    await useGame.getState().submitBugReport();
    // The awaited submit has persisted BEFORE closing — the queue already holds the report.
    expect(useGame.getState().bugReportOpen).toBe(false);
    const queued = await bugReportQueue.all();
    expect(queued.length).toBe(1);
    expect(queued[0]!.envelope.description).toBe('My minion attacked twice in one beat.');

    // Tests run with neither IndexedDB (jsdom has none → the queue write lands 'memory') nor a backend (the
    // upload fails) — exactly the §13 "IndexedDB unavailable" row, so the toast is its non-blocking WARNING
    // rather than the §1.3 offline confirmation (which needs a durable write). Either way the report is
    // RETAINED in the queue.
    for (let i = 0; i < 20 && useGame.getState().bugReportToast === null; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(useGame.getState().bugReportToast).toBe('Report could not be saved on this device. It will send only if you stay connected this session.');
    expect((await bugReportQueue.all()).length).toBe(1);
    for (const i of await bugReportQueue.all()) await bugReportQueue.remove(i.envelope.reportId);
    useGame.setState({ bugReportToast: null, showTitle: true });
  });
});

// ── §14.4: offline submission survives reload ─────────────────────────────────────────────────────────────

describe('IndexedDB store', () => {
  it('a queued report written by one session is read back by a fresh store instance (reload)', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDb();
    const env = makeEnvelope();
    const before = indexedDbBugReportStore();
    expect(await before.put(toQueued(env, 1000))).toBe('durable');

    const afterReload = indexedDbBugReportStore(); // fresh instance, same (stubbed) browser storage
    const items = await afterReload.all();
    expect(items.length).toBe(1);
    expect(items[0]!.envelope.reportId).toBe(env.reportId);
    expect(items[0]!.envelope.context.serializedRun).toBe(env.context.serializedRun);
  });

  it('degrades to the memory mirror (and says so) when IndexedDB is unavailable', async () => {
    // No global indexedDB in this test → every write lands on the §13 in-memory fallback.
    const store = indexedDbBugReportStore();
    const env = makeEnvelope();
    expect(await store.put(toQueued(env, 1000))).toBe('memory');
    expect((await store.all()).length).toBe(1);
  });
});

// ── §14.4: success removes; failure increments attempts and retains ──────────────────────────────────────

describe('upload flow', () => {
  it('deletes the queued item only after the server returns an id', async () => {
    const store = memoryBugReportStore();
    const env = makeEnvelope();
    await enqueueBugReport(env, store);
    const outcome = await attemptBugReportUpload(env.reportId, store, async () => ok('server-uuid-1'));
    expect(outcome).toEqual({ kind: 'success', id: 'server-uuid-1', duplicateOf: undefined });
    expect(await store.all()).toEqual([]);
  });

  it('a failed upload increments attempts, records the error, parks with backoff, and RETAINS the report', async () => {
    const store = memoryBugReportStore();
    const env = makeEnvelope();
    await enqueueBugReport(env, store, 5000);
    const out1 = await attemptBugReportUpload(env.reportId, store, async () => ({ kind: 'retryable', error: 'http_500' }), 5000);
    expect(out1.kind).toBe('retryable');
    let [item] = await store.all();
    expect(item!.status).toBe('failed');
    expect(item!.attempts).toBe(1);
    expect(item!.lastError).toBe('http_500');
    expect(item!.nextAttemptAt).toBe(5000 + backoffMs(1));

    const out2 = await attemptBugReportUpload(env.reportId, store, async () => ({ kind: 'retryable', error: 'http_500' }), 9000);
    expect(out2.kind).toBe('retryable');
    [item] = await store.all();
    expect(item!.attempts).toBe(2);
    expect(item!.nextAttemptAt).toBe(9000 + backoffMs(2)); // exponential: 2nd park is longer
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1));
  });

  it('a server schema rejection (422) retains the report and records the code', async () => {
    const store = memoryBugReportStore();
    const env = makeEnvelope();
    await enqueueBugReport(env, store);
    const out = await attemptBugReportUpload(env.reportId, store, async () => ({ kind: 'rejected', error: 'http_422:unsupported_schema_version' }));
    expect(out.kind).toBe('rejected');
    const [item] = await store.all();
    expect(item).toBeTruthy(); // retained, never discarded
    expect(item!.lastError).toBe('http_422:unsupported_schema_version');
  });

  it('no-session failures burn no attempt and leave the report queued for the auth trigger', async () => {
    const store = memoryBugReportStore();
    const env = makeEnvelope();
    await enqueueBugReport(env, store);
    await attemptBugReportUpload(env.reportId, store, async () => ({ kind: 'retryable', error: 'no_session' }));
    const [item] = await store.all();
    expect(item!.status).toBe('queued');
    expect(item!.attempts).toBe(0);
    expect(item!.nextAttemptAt).toBe(0);
  });

  // §14.4: duplicate retries are idempotent through client_report_id — the retried upload posts the SAME
  // reportId and the server's 200 (dedupe hit) counts as success exactly like the original 201.
  it('a retry after a transient failure posts the same reportId and a 200-dedupe success clears the queue', async () => {
    const store = memoryBugReportStore();
    const env = makeEnvelope();
    await enqueueBugReport(env, store);
    const posted: string[] = [];
    let calls = 0;
    const send = async (e: BugReportEnvelope): Promise<BugUploadOutcome> => {
      posted.push(e.reportId);
      calls += 1;
      // 1st: the insert landed server-side but the response was lost (network). 2nd: server dedupes → 200.
      return calls === 1 ? { kind: 'retryable', error: 'network_error' } : ok('server-uuid-dedupe');
    };
    await attemptBugReportUpload(env.reportId, store, send);
    expect((await store.all()).length).toBe(1);
    await flushBugReportQueue(store, send, Date.now() + backoffMs(1) + 1);
    expect(posted).toEqual([env.reportId, env.reportId]); // identical client_report_id both times
    expect(await store.all()).toEqual([]);
  });
});

// ── §14.4: retention cap — and a large report never evicts unrelated upload data ─────────────────────────

describe('retention', () => {
  it('keeps at most 25 reports, evicting the oldest', async () => {
    const store = memoryBugReportStore();
    const envs = Array.from({ length: BUG_QUEUE_MAX + 1 }, () => makeEnvelope());
    for (let i = 0; i < envs.length; i++) await store.put(toQueued(envs[i]!, 1000 + i));
    const items = await store.all();
    expect(items.length).toBe(BUG_QUEUE_MAX);
    const ids = new Set(items.map((i) => i.envelope.reportId));
    expect(ids.has(envs[0]!.reportId)).toBe(false); // the oldest fell off
    expect(ids.has(envs[envs.length - 1]!.reportId)).toBe(true);
  });

  it('capOverflow never evicts merely for failed attempts', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...toQueued(makeEnvelope(), 1000 + i),
      status: 'failed' as const,
      attempts: 10,
    }));
    expect(capOverflow(items, 25)).toEqual([]); // under the cap → nothing evicted, however often they failed
  });

  it('bug reports live in their own store — the localStorage upload queue is untouched', async () => {
    localStorage.setItem('ascent.uploadqueue', JSON.stringify([{ kind: 'boards', payload: [], at: 'x' }]));
    const store = memoryBugReportStore();
    await enqueueBugReport(makeEnvelope(), store);
    expect(localStorage.getItem('ascent.uploadqueue')).toBe(JSON.stringify([{ kind: 'boards', payload: [], at: 'x' }]));
    localStorage.removeItem('ascent.uploadqueue');
  });
});

// ── §3.5 trim ladder ──────────────────────────────────────────────────────────────────────────────────────

describe('trimEnvelope', () => {
  it('returns the envelope untouched when under the limit', () => {
    const env = makeEnvelope();
    expect(trimEnvelope(env)).toBe(env);
  });

  it('drops previous-wave frames first and records the truncation', () => {
    const env = makeEnvelope();
    const fat = {
      ...env,
      context: {
        ...structuredClone(env.context),
        previousWaveFrames: [{ kind: 'shop', wave: 1, tMs: 0, pad: 'x'.repeat(600_000) } as never],
      },
    };
    const trimmed = trimEnvelope(fat, 500_000);
    expect(trimmed).not.toBeNull();
    expect(trimmed!.context.previousWaveFrames).toEqual([]);
    expect(trimmed!.context.contextTruncated).toContain('previousWaveFrames');
    // The authoritative sections survive.
    expect(trimmed!.context.serializedRun).toBe(env.context.serializedRun);
    expect(trimmed!.context.currentWaveFrames).toEqual(env.context.currentWaveFrames);
  });
});
