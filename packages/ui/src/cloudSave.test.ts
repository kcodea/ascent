// @vitest-environment jsdom
/**
 * CROSS-DEVICE SAVES (owner ask 2026-09-30, R-PERSIST-CLOUD-01..03): the sync service against an in-memory
 * server with the SQL's accept / refuse rules. Two DEVICES are two localStorage snapshots swapped in and out
 * (the lease + device id live there, exactly as they do in a browser profile).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createCloudSave, decideAtTitle, loadLease, noteLocalClear, noteLocalSave, type CloudRowMeta, type CloudSave } from './cloudSave';
import { fakeCloudServer, type FakeServer } from './cloudSaveFake';

const SAVE_KEY = 'ascent.save';
const devices = new Map<string, Record<string, string>>();
let current = '';
function asDevice(name: string): void {
  if (current) {
    const snap: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; snap[k] = localStorage.getItem(k)!; }
    devices.set(current, snap);
  }
  localStorage.clear();
  for (const [k, v] of Object.entries(devices.get(name) ?? {})) localStorage.setItem(k, v);
  current = name;
}

let server: FakeServer;
let user: string | null;
let moved: Array<CloudRowMeta | null>;
let retries: Array<() => void>;
function service(): CloudSave {
  return createCloudSave({
    api: server.apiFor(() => user),
    userId: () => user,
    readLocal: () => localStorage.getItem(SAVE_KEY),
    seatRuns: () => undefined,
    onMoved: (m) => { moved.push(m); },
    setTimeout: (fn) => { retries.push(fn); },
  });
}
/** A local save write, as store.writeSave does it. */
function saveLocally(runKey: string, body: string): void {
  localStorage.setItem(SAVE_KEY, body);
  noteLocalSave(runKey);
}

beforeEach(() => {
  devices.clear(); current = ''; localStorage.clear();
  server = fakeCloudServer(); user = 'u-1'; moved = []; retries = [];
  asDevice('A');
});

describe('upload', () => {
  it('a signed-in save uploads the local save string verbatim', async () => {
    const svc = service();
    saveLocally('run:x', '{"run":"R1"}');
    await svc.requestUpload();
    const row = server.rows.get('u-1')!;
    expect(row.payload.save).toBe('{"run":"R1"}');
    expect(row.revision).toBe(1);
    expect(loadLease()).toMatchObject({ runKey: 'run:x', revision: 1, dirty: false, userId: 'u-1' });
  });

  it('a guest (no signed-in account) never uploads', async () => {
    user = null;
    const svc = service();
    saveLocally('run:x', '{"run":"R1"}');
    await svc.requestUpload();
    expect(server.calls).toEqual([]);
    expect(server.rows.size).toBe(0);
  });

  it('offline: the save stays local + dirty and syncs on retry', async () => {
    const svc = service();
    server.online = false;
    saveLocally('run:x', '{"run":"R1"}');
    await svc.requestUpload();
    expect(server.rows.size).toBe(0);
    expect(loadLease()!.dirty).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).toBe('{"run":"R1"}'); // local save untouched
    expect(retries.length).toBe(1);
    server.online = true;
    retries.shift()!();
    await svc.idle();
    expect(server.rows.get('u-1')!.payload.save).toBe('{"run":"R1"}');
    expect(loadLease()!.dirty).toBe(false);
  });

  it('SQL not deployed: switches itself off, local save unaffected', async () => {
    server.deployed = false;
    const svc = service();
    saveLocally('run:x', '{"run":"R1"}');
    await svc.requestUpload();
    expect(svc.active()).toBe(false);
    await svc.requestUpload();
    expect(server.calls).toEqual(['put:0']); // asked once, then silent
    expect(localStorage.getItem(SAVE_KEY)).toBe('{"run":"R1"}');
  });
});

describe('one device at a time', () => {
  it('B claims the run; A\'s stale save is refused and A is told the run moved (never overwrites)', async () => {
    const a = service();
    saveLocally('run:x', '{"run":"A-w3"}');
    await a.requestUpload(); // rev 1, device A

    // Device B: at the title, the cloud run is adopted, then Continue claims it.
    asDevice('B');
    const b = service();
    const seen = await b.checkAtTitle(null);
    expect(seen.decision).toBe('adopt');
    localStorage.setItem(SAVE_KEY, seen.row!.payload.save);
    b.adopted(seen.row!);
    expect(await b.claim()).toBe('ok');
    expect(server.rows.get('u-1')!.revision).toBe(2);
    saveLocally('run:x', '{"run":"B-w4"}');
    await b.requestUpload();
    expect(server.rows.get('u-1')!.payload.save).toBe('{"run":"B-w4"}');

    // Back on A (still in the run): its next save is refused.
    asDevice('A');
    saveLocally('run:x', '{"run":"A-w4-stale"}');
    await a.requestUpload();
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ runKey: 'run:x', revision: 3 });
    expect(server.rows.get('u-1')!.payload.save).toBe('{"run":"B-w4"}'); // newer progress kept

    // A's title then adopts B's newer copy.
    const back = await a.checkAtTitle('run:x');
    expect(back.decision).toBe('adopt');
    expect(back.row!.payload.save).toBe('{"run":"B-w4"}');
  });

  it('the tab-return check sees another device\'s claim', async () => {
    const a = service();
    saveLocally('run:x', 'A');
    await a.requestUpload();
    expect(await a.movedElsewhere()).toBe(false);
    asDevice('B');
    const b = service();
    const seen = await b.checkAtTitle(null);
    localStorage.setItem(SAVE_KEY, seen.row!.payload.save);
    b.adopted(seen.row!);
    await b.claim();
    asDevice('A');
    expect(await a.movedElsewhere()).toMatchObject({ revision: 2 });
  });
});

describe('run end', () => {
  it('clears the cloud row; a stale local copy of the SAME run on another device is discarded, not resurrected', async () => {
    const a = service();
    saveLocally('run:x', 'A');
    await a.requestUpload();
    asDevice('B');
    const b = service();
    const seen = await b.checkAtTitle(null);
    localStorage.setItem(SAVE_KEY, seen.row!.payload.save);
    b.adopted(seen.row!);
    await b.claim();
    await b.endRun(); // the run finished on B
    noteLocalClear();
    expect(server.rows.size).toBe(0);

    asDevice('A');
    const again = await a.checkAtTitle('run:x');
    expect(again.decision).toBe('discard-local');
    saveLocally('run:x', 'A2');
    await a.requestUpload(); // and a stray upload of it can't bring it back
    expect(server.rows.size).toBe(0);
    expect(moved).toEqual([null]);
  });

  it('a new run replaces an older one in the slot', async () => {
    const a = service();
    saveLocally('run:x', 'X');
    await a.requestUpload();
    saveLocally('run:y', 'Y');
    await a.requestUpload();
    expect(server.rows.get('u-1')).toMatchObject({ runKey: 'run:y', payload: { save: 'Y' } });
  });
});

describe('decideAtTitle', () => {
  const meta = (runKey: string, revision: number, updatedAt = '2026-09-30T12:00:00Z'): CloudRowMeta => ({ runKey, revision, deviceId: 'd', updatedAt });
  const lease = (runKey: string, revision: number, dirty = false, savedAt = 0) => ({ userId: 'u-1', runKey, revision, dirty, savedAt });
  it('no local → adopt the cloud; nothing anywhere → none', () => {
    expect(decideAtTitle(null, null, meta('run:x', 2))).toBe('adopt');
    expect(decideAtTitle(null, null, null)).toBe('none');
  });
  it('same run: newer cloud revision → adopt; same revision → none (dirty → push)', () => {
    expect(decideAtTitle('run:x', lease('run:x', 1), meta('run:x', 3))).toBe('adopt');
    expect(decideAtTitle('run:x', lease('run:x', 3), meta('run:x', 3))).toBe('none');
    expect(decideAtTitle('run:x', lease('run:x', 3, true), meta('run:x', 3))).toBe('push');
  });
  it('cloud gone: a synced local run ended elsewhere → discard; an unsynced one → push', () => {
    expect(decideAtTitle('run:x', lease('run:x', 2), null)).toBe('discard-local');
    expect(decideAtTitle('run:x', lease('run:x', 0, true), null)).toBe('push');
    expect(decideAtTitle('run:x', null, null)).toBe('push');
  });
  it('a different run in the cloud: a synced local run was superseded → adopt; an unsynced one competes on time', () => {
    expect(decideAtTitle('run:x', lease('run:x', 4), meta('run:y', 1))).toBe('adopt');
    expect(decideAtTitle('run:x', lease('run:x', 0, true, Date.parse('2026-09-30T13:00:00Z')), meta('run:y', 1))).toBe('push');
    expect(decideAtTitle('run:x', lease('run:x', 0, true, Date.parse('2026-09-30T11:00:00Z')), meta('run:y', 1))).toBe('adopt');
  });
});
