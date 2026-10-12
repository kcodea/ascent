import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideRecord } from '@game/guides';
import type { OfficialGuidesAnswer } from './guidesRemote';

let answer: () => Promise<OfficialGuidesAnswer>;
let calls = 0;
let teamAnswer: boolean | undefined = false;
let mineAnswer: GuideRecord[] | undefined = [];
let mineHold: Promise<GuideRecord[] | undefined> | null = null; // when set, the NEXT guides-of-mine ask waits on it
const asked: string[] = [];
vi.mock('./guidesRemote', () => ({
  fetchOfficialGuides: () => { calls++; return answer(); },
  fetchTeamFlag: async (userId: string) => { asked.push(`team:${userId}`); return teamAnswer; },
  fetchMyGuides: async (userId: string) => {
    asked.push(`mine:${userId}`);
    if (mineHold) { const h = mineHold; mineHold = null; return h; }
    return mineAnswer;
  },
}));
let identity: { userId: string; anonymous: boolean } | null = null;
vi.mock('../identity', () => ({ currentIdentity: () => identity }));

const { GUIDES } = await import('./guides');
const { guideDeleted, guideSaved, loadGuides, requestGuideEdit, resetGuidesForTests, setGuidesTab, takePendingEdit, useGuides } = await import('./guidesStore');

const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: null, byline: 'Team Ascent', official: true, published: true, hidden: false, sets: ['set2'], tribes: ['beast'],
  pairsWith: [], iconCard: 'b2_sunmane', title: `Guide ${id}`, tagline: '', body: 'B', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});

beforeEach(() => {
  resetGuidesForTests();
  calls = 0;
  identity = null; teamAnswer = false; mineAnswer = []; mineHold = null; asked.length = 0;
  answer = async () => ({ state: 'on', guides: [rec('a'), rec('b', { sortOrder: 1 })] });
});

describe('the guides store', () => {
  it('starts on the built-in guides, capability unknown', () => {
    expect(useGuides.getState()).toMatchObject({ capability: 'unknown', source: 'bundled' });
    expect(useGuides.getState().list).toBe(GUIDES);
  });
  it('adopts the server\'s official guides once they load', async () => {
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ capability: 'on', source: 'server' });
    expect(useGuides.getState().list.map((g) => g.id)).toEqual(['a', 'b']);
  });
  it('zero usable official guides keeps the built-in ones (never an empty rail)', async () => {
    answer = async () => ({ state: 'on', guides: [] });
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ capability: 'on', source: 'bundled' });
    expect(useGuides.getState().list).toBe(GUIDES);
    answer = async () => ({ state: 'on', guides: [rec('x', { tribes: ['merfolk'] })] }); // every row unusable on this build
    await loadGuides();
    expect(useGuides.getState().list).toBe(GUIDES);
  });
  it('off, offline and no-backend keep the built-in guides and record why', async () => {
    for (const state of ['off', 'offline', 'no-backend'] as const) {
      resetGuidesForTests();
      answer = async () => ({ state });
      await loadGuides();
      expect(useGuides.getState(), state).toMatchObject({ capability: state, source: 'bundled' });
      expect(useGuides.getState().list).toBe(GUIDES);
    }
  });
  it('a dropped connection after a good load keeps the loaded list', async () => {
    await loadGuides();
    const loaded = useGuides.getState().list;
    answer = async () => ({ state: 'offline' });
    await loadGuides();
    expect(useGuides.getState().capability).toBe('offline');
    expect(useGuides.getState().source).toBe('server');
    expect(useGuides.getState().list).toBe(loaded);
  });
  it('an unchanged reload keeps the SAME list object, so nothing re-renders; a new revision replaces it', async () => {
    await loadGuides();
    const first = useGuides.getState().list;
    await loadGuides();
    expect(useGuides.getState().list).toBe(first);
    answer = async () => ({ state: 'on', guides: [rec('a', { revision: 2 }), rec('b', { sortOrder: 1 })] });
    await loadGuides();
    expect(useGuides.getState().list).not.toBe(first);
  });
  it('two callers at once share one request', async () => {
    let release: (a: OfficialGuidesAnswer) => void = () => {};
    answer = () => new Promise<OfficialGuidesAnswer>((r) => { release = r; });
    const p1 = loadGuides();
    const p2 = loadGuides();
    release({ state: 'on', guides: [rec('a')] });
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
});

describe('who I am: team flag and my guides', () => {
  const mineRec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => rec(id, { official: false, published: false, authorId: 'u-1', byline: 'Mike', ...patch });

  it('with no identity, or a guest, it asks for neither and holds no team flag and no guides', async () => {
    await loadGuides();
    identity = { userId: 'g-1', anonymous: true };
    await loadGuides();
    expect(asked).toEqual([]);
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
  });
  it('a signed-in account gets its team flag and its own guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1'), mineRec('m2')];
    await loadGuides();
    expect(asked.sort()).toEqual(['mine:u-1', 'team:u-1']);
    expect(useGuides.getState().team).toBe(true);
    expect(useGuides.getState().mine.map((g) => g.id)).toEqual(['m1', 'm2']);
  });
  it('an unanswerable read leaves what was known: a team member does not lose the flag on a blip', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    const before = useGuides.getState().mine;
    teamAnswer = undefined;
    mineAnswer = undefined;
    await loadGuides();
    expect(useGuides.getState().team).toBe(true);
    expect(useGuides.getState().mine).toBe(before);
  });
  it('signing out drops the flag and the guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    identity = { userId: 'g-2', anonymous: true };
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
  });
  it('signing out while the server cannot be reached still drops the flag and the guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    expect(useGuides.getState().team).toBe(true);
    answer = async () => ({ state: 'offline' });
    identity = { userId: 'g-2', anonymous: true };
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ capability: 'offline', team: false, mine: [] });
  });
  it('switching to another account clears the first account\'s guides before the new read answers', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    expect(useGuides.getState().mine).toHaveLength(1);
    let release: (a: OfficialGuidesAnswer) => void = () => {};
    answer = () => new Promise<OfficialGuidesAnswer>((r) => { release = r; });
    identity = { userId: 'u-2', anonymous: false };
    teamAnswer = false;
    mineAnswer = [];
    const p = loadGuides();
    expect(useGuides.getState().mine).toEqual([]);
    expect(useGuides.getState().team).toBe(false);
    release({ state: 'on', guides: [rec('a')] });
    await p;
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
  });
  it('a read that lands after the account changed does not apply the old account\'s guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    let releaseMine: (g: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { releaseMine = r; });
    const seen: number[] = [];
    useGuides.subscribe((s) => { seen.push(s.mine.length + (s.team ? 100 : 0)); });
    const p = loadGuides();
    identity = { userId: 'g-2', anonymous: true };
    void loadGuides(); // a different identity: queues one re-read
    releaseMine([mineRec('m1')]);
    await p;
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
    expect(seen.every((n) => n === 0)).toBe(true); // the old account's flag and guide never reached the store
  });
  it('signing out to NO session clears the flag and the guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    expect(useGuides.getState().team).toBe(true);
    const askedBefore = asked.length;
    identity = null;
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
    expect(asked.length).toBe(askedBefore);
  });
  it('the game store re-reads guides on EVERY identity change, including to none', () => {
    // Pinned as text: mounting the whole game store to observe a sign-out is far heavier than the one line it guards.
    const src = readFileSync(join(__dirname, '..', 'store.ts'), 'utf8');
    expect(src).not.toContain('if (id) void loadGuides()');
    expect(src.match(/void loadGuides\(\)/g)).toHaveLength(2);
  });
  it('a change of account drops a pending edit request and returns to the Team Ascent pill', async () => {
    identity = { userId: 'u-1', anonymous: false };
    await loadGuides();
    setGuidesTab('mine');
    requestGuideEdit('r1');
    identity = { userId: 'u-2', anonymous: false };
    void loadGuides();
    expect(useGuides.getState().pendingEdit).toBeNull();
    expect(useGuides.getState().tab).toBe('team');
  });
  it('a call for the SAME identity while a read is in flight joins it; a call for a DIFFERENT identity queues exactly one re-read', async () => {
    let release: (a: OfficialGuidesAnswer) => void = () => {};
    answer = () => new Promise<OfficialGuidesAnswer>((r) => { release = r; });
    identity = { userId: 'g-1', anonymous: true };
    const p1 = loadGuides();
    const p2 = loadGuides();              // same identity: joins
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [mineRec('m1')];
    const p3 = loadGuides();              // signed in mid-read: must not be lost
    expect(calls).toBe(1);
    answer = async () => ({ state: 'on', guides: [rec('a')] });
    release({ state: 'on', guides: [rec('a')] });
    await Promise.all([p1, p2, p3]);
    await vi.waitFor(() => expect(useGuides.getState().mine.map((g) => g.id)).toEqual(['m1']));
    expect(calls).toBe(2);
  });
});

describe('after a save or a delete, without a re-read', () => {
  const g = (patch: Partial<import('./guides').Guide>): import('./guides').Guide => ({ ...GUIDES[0]!, ...patch });

  it('a saved player guide is added to mine, or replaces the same row', () => {
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false, title: 'First', revision: 1 }));
    guideSaved(g({ id: 'r2', rowId: 'r2', official: false, title: 'Second', revision: 1 }));
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false, title: 'First, edited', revision: 2 }));
    expect(useGuides.getState().mine.map((x) => x.title)).toEqual(['First, edited', 'Second']);
  });
  it('a saved Team Ascent guide replaces the same row in the server list, keeping its place', async () => {
    await loadGuides(); // server list: a, b
    const list = useGuides.getState().list;
    guideSaved({ ...list[0]!, title: 'A, edited', revision: 2 });
    expect(useGuides.getState().list.map((x) => x.title)).toEqual(['A, edited', list[1]!.title]);
  });
  it('a read that was already in flight does not undo a save that landed meanwhile', async () => {
    identity = { userId: 'u-1', anonymous: false };
    let releaseMine: (g: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { releaseMine = r; });
    mineAnswer = [rec('r9', { official: false, published: false, authorId: 'u-1', byline: 'Mike' })]; // what the re-read finds
    const p = loadGuides();
    guideSaved(g({ id: 'r9', rowId: 'r9', official: false, title: 'Saved meanwhile' }));
    let sawEmpty = false;
    useGuides.subscribe((s) => { if (s.mine.length === 0) sawEmpty = true; });
    releaseMine([]); // the stale read answers with no guides
    await p;
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['r9']);
    await vi.waitFor(() => expect(asked.filter((a) => a === 'mine:u-1')).toHaveLength(2));
    await vi.waitFor(() => expect(useGuides.getState().mine.map((x) => x.id)).toEqual(['r9']));
    expect(sawEmpty).toBe(false);
  });
  it('a deleted guide leaves both lists', async () => {
    await loadGuides();
    const first = useGuides.getState().list[0]!;
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false }));
    guideDeleted('r1');
    guideDeleted(first.rowId!);
    expect(useGuides.getState().mine).toEqual([]);
    expect(useGuides.getState().list.map((x) => x.rowId)).not.toContain(first.rowId);
  });
});

describe('the Compendium pill and the rail\'s edit request', () => {
  it('starts on Team Ascent; the pill can be switched', () => {
    expect(useGuides.getState().tab).toBe('team');
    setGuidesTab('mine');
    expect(useGuides.getState().tab).toBe('mine');
  });
  it('an edit request is taken exactly once', () => {
    requestGuideEdit('r1');
    expect(useGuides.getState().pendingEdit).toBe('r1');
    expect(takePendingEdit()).toBe('r1');
    expect(takePendingEdit()).toBeNull();
  });
});
