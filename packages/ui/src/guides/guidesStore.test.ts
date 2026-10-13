import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideRecord } from '@game/guides';
import type { Guide } from './guides';
import type { OfficialGuidesAnswer } from './guidesRemote';

let answer: () => Promise<OfficialGuidesAnswer>;
let calls = 0;
let teamAnswer: boolean | undefined = false;
let mineAnswer: GuideRecord[] | undefined = [];
let bookmarkedAnswer: GuideRecord[] | undefined = [];
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
  fetchBookmarkedGuides: async (userId: string) => { asked.push(`bookmarked:${userId}`); return bookmarkedAnswer; },
}));
let identity: { userId: string; anonymous: boolean } | null = null;
vi.mock('../identity', () => ({ currentIdentity: () => identity }));

const { GUIDES } = await import('./guides');
const { guideBookmarked, guideDeleted, guideSaved, loadGuides, requestGuideEdit, rereadGuides, resetGuidesForTests, setGuidesTab, takePendingEdit, useGuides } = await import('./guidesStore');

const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: null, byline: 'Team Ascent', official: true, published: true, publishedAt: null, hidden: false, sets: ['set2'], tribes: ['beast'],
  pairsWith: [], iconCard: 'b2_sunmane', title: `Guide ${id}`, tagline: '', body: 'B', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});

beforeEach(() => {
  resetGuidesForTests();
  calls = 0;
  identity = null; teamAnswer = false; mineAnswer = []; bookmarkedAnswer = []; mineHold = null; asked.length = 0;
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
    expect(asked.sort()).toEqual(['bookmarked:u-1', 'mine:u-1', 'team:u-1']);
    expect(useGuides.getState().team).toBe(true);
    expect(useGuides.getState().mine.map((g) => g.id)).toEqual(['m1', 'm2']);
  });
  it('an unchanged, answered re-read keeps the same array of my guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    const before = useGuides.getState().mine;
    await loadGuides();
    expect(useGuides.getState().mine).toBe(before);
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
    // Three call sites: identity landing at boot, every identity change, and `signOutAccount` itself (a sign-out whose
    // request fails fires no identity change; guidesSignOut.test.ts drives that one for real).
    expect(src.match(/void loadGuides\(\)/g)).toHaveLength(3);
    const signOut = src.slice(src.indexOf('signOutAccount: async () => {'), src.indexOf('playerAvatar: loadPlayerAvatar()'));
    expect(signOut).toContain('void loadGuides();');
  });
  it('remembers whose guides it holds: the account they were read for, and nobody once they are cleared', async () => {
    expect(useGuides.getState().mineOwner).toBeNull();
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    expect(useGuides.getState().mineOwner).toBe('u-1');
    // A guest, and no session at all, own nothing.
    identity = { userId: 'g-2', anonymous: true };
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ mine: [], mineOwner: null });
    identity = { userId: 'u-2', anonymous: false };
    mineAnswer = [mineRec('m2', { authorId: 'u-2' })];
    await loadGuides();
    expect(useGuides.getState().mineOwner).toBe('u-2');
    identity = null;
    void loadGuides(); // cleared at once, before the read answers
    expect(useGuides.getState()).toMatchObject({ mine: [], mineOwner: null });
  });
  it('the owner is cleared with the guides when the account changes, before the new read answers', async () => {
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    let release: (a: OfficialGuidesAnswer) => void = () => {};
    answer = () => new Promise<OfficialGuidesAnswer>((r) => { release = r; });
    identity = { userId: 'u-2', anonymous: false };
    mineAnswer = [];
    const p = loadGuides();
    expect(useGuides.getState()).toMatchObject({ mine: [], mineOwner: null });
    release({ state: 'on', guides: [rec('a')] });
    await p;
    expect(useGuides.getState()).toMatchObject({ mine: [], mineOwner: 'u-2' });
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
  /** A player's own guide, as a save by account `author` answers it. */
  const own = (rowId: string, author: string, patch: Partial<import('./guides').Guide> = {}): import('./guides').Guide =>
    g({ id: rowId, rowId, official: false, published: false, authorId: author, byline: 'Mike', ...patch });

  it('a saved player guide is added to mine, or replaces the same row', () => {
    identity = { userId: 'u-1', anonymous: false };
    guideSaved(own('r1', 'u-1', { title: 'First', revision: 1 }));
    guideSaved(own('r2', 'u-1', { title: 'Second', revision: 1 }));
    guideSaved(own('r1', 'u-1', { title: 'First, edited', revision: 2 }));
    expect(useGuides.getState().mine.map((x) => x.title)).toEqual(['First, edited', 'Second']);
    expect(useGuides.getState().mineOwner).toBe('u-1');
  });
  it('a save that lands after ANOTHER account took over is not added to that account\'s guides', async () => {
    // Account A pressed Save on a slow connection and signed out; account B is signed in when the answer arrives.
    identity = { userId: 'u-2', anonymous: false };
    mineAnswer = [rec('b1', { official: false, published: false, authorId: 'u-2', byline: 'Other' })];
    await loadGuides();
    const before = useGuides.getState().mine;
    guideSaved(own('r1', 'u-1', { title: 'Private to the first account' }));
    expect(useGuides.getState().mine).toBe(before);
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['b1']);
    expect(useGuides.getState().mineOwner).toBe('u-2');
  });
  it('a save that lands with nobody signed in, or with a guest at the keyboard, is not kept', () => {
    identity = null;
    guideSaved(own('r1', 'u-1'));
    expect(useGuides.getState()).toMatchObject({ mine: [], mineOwner: null });
    identity = { userId: 'g-1', anonymous: true };
    guideSaved(own('r1', 'u-1'));
    guideSaved(own('r2', 'g-1')); // even one that names the guest: a guest holds no guides
    expect(useGuides.getState()).toMatchObject({ mine: [], mineOwner: null });
  });
  it('a guide with no author on it is not taken for the current account\'s', () => {
    identity = { userId: 'u-1', anonymous: false };
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false, authorId: null }));
    expect(useGuides.getState().mine).toEqual([]);
  });
  it('a save by the current account never joins guides the store still holds for another account', () => {
    // The guides of the account before were not cleared (a missed re-read): they are dropped, not added to.
    useGuides.setState({ mine: [own('a1', 'u-1')], mineOwner: 'u-1' });
    identity = { userId: 'u-2', anonymous: false };
    guideSaved(own('b1', 'u-2'));
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['b1']);
    expect(useGuides.getState().mineOwner).toBe('u-2');
  });
  it("a save by an account that did not hold the lists never keeps the last account's team flag or bookmarks", () => {
    // A missed re-read: the store still holds a team account's flag, guides and bookmarks when the next account saves.
    useGuides.setState({ team: true, mine: [own('a1', 'u-1')], bookmarked: [g({ id: 'bm1', rowId: 'bm1', official: false, authorId: 'u-9' })], mineOwner: 'u-1' });
    identity = { userId: 'u-2', anonymous: false };
    guideSaved(own('b1', 'u-2'));
    expect(useGuides.getState().mineOwner).toBe('u-2');
    expect(useGuides.getState().team).toBe(false);
    expect(useGuides.getState().bookmarked).toEqual([]);
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['b1']);
  });
  it('a save by the account that already holds the lists keeps its team flag and its bookmarks', () => {
    const marked = [g({ id: 'bm1', rowId: 'bm1', official: false, authorId: 'u-9' })];
    useGuides.setState({ team: true, mine: [own('a1', 'u-1')], bookmarked: marked, mineOwner: 'u-1' });
    identity = { userId: 'u-1', anonymous: false };
    guideSaved(own('a2', 'u-1'));
    expect(useGuides.getState().team).toBe(true);
    expect(useGuides.getState().bookmarked).toBe(marked);
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['a1', 'a2']);
  });
  it('a save that is not kept does not make a read in flight throw its answer away', async () => {
    identity = { userId: 'u-2', anonymous: false };
    let releaseMine: (g: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { releaseMine = r; });
    const p = loadGuides();
    guideSaved(own('r1', 'u-1')); // the first account's late save: ignored
    releaseMine([rec('b1', { official: false, published: false, authorId: 'u-2', byline: 'Other' })]);
    await p;
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['b1']);
    expect(asked.filter((a) => a === 'mine:u-2')).toHaveLength(1); // no second read was needed
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
    guideSaved(own('r9', 'u-1', { title: 'Saved meanwhile' }));
    let sawEmpty = false;
    useGuides.subscribe((s) => { if (s.mine.length === 0) sawEmpty = true; });
    releaseMine([]); // the stale read answers with no guides
    await p;
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['r9']);
    await vi.waitFor(() => expect(asked.filter((a) => a === 'mine:u-1')).toHaveLength(2));
    await vi.waitFor(() => expect(useGuides.getState().mine.map((x) => x.id)).toEqual(['r9']));
    expect(sawEmpty).toBe(false);
  });
  it('a read asked for after a change made elsewhere never settles for a read that began before it', async () => {
    // The team hid a guide: the server now says hidden. A read was already in flight and will answer the old state.
    identity = { userId: 'u-1', anonymous: false };
    const row = (hidden: boolean): GuideRecord => rec('r9', { official: false, published: true, authorId: 'u-1', byline: 'Mike', hidden });
    let releaseMine: (g: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { releaseMine = r; });
    const p = loadGuides();
    while (!asked.includes('mine:u-1')) await Promise.resolve();
    mineAnswer = [row(true)]; // what a read made now finds
    const again = rereadGuides();
    expect(again).toBe(p); // it joins the read in flight, and marks that read's answer as stale
    let sawOld = false;
    useGuides.subscribe((s) => { if (s.mine.some((x) => !x.hidden)) sawOld = true; });
    releaseMine([row(false)]); // the read that began before the hide answers the old state
    await p;
    await vi.waitFor(() => expect(asked.filter((a) => a === 'mine:u-1')).toHaveLength(2));
    await vi.waitFor(() => expect(useGuides.getState().mine.map((x) => [x.rowId, x.hidden])).toEqual([['r9', true]]));
    expect(sawOld).toBe(false);
  });
  it('with no read in flight, a read asked for after a change is one read', async () => {
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [rec('r9', { official: false, authorId: 'u-1', byline: 'Mike', hidden: true })];
    await rereadGuides();
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.filter((a) => a === 'mine:u-1')).toHaveLength(1);
    expect(useGuides.getState().mine.map((x) => x.hidden)).toEqual([true]);
  });
  it('a deleted guide leaves both lists', async () => {
    await loadGuides();
    const first = useGuides.getState().list[0]!;
    identity = { userId: 'u-1', anonymous: false };
    guideSaved(own('r1', 'u-1'));
    expect(useGuides.getState().mine).toHaveLength(1);
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

describe('bookmarks', () => {
  const other = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord =>
    rec(id, { official: false, authorId: 'u-9', byline: 'Ann', published: true, publishedAt: '2026-10-13T00:00:00Z', ...patch });

  it("loads this account's bookmarks with its own guides", async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1'), other('bm2')];
    await loadGuides();
    expect(useGuides.getState().bookmarked.map((g) => g.rowId)).toEqual(['bm1', 'bm2']);
    expect(useGuides.getState().mineOwner).toBe('u-1');
    expect(asked).toContain('bookmarked:u-1');
  });
  it('a guest and nobody have none, and are never asked for', async () => {
    identity = { userId: 'g-1', anonymous: true };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    expect(useGuides.getState().bookmarked).toEqual([]);
    expect(asked.some((a) => a.startsWith('bookmarked:'))).toBe(false);
  });
  it('a read that could not ask keeps the bookmarks already showing', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    const before = useGuides.getState().bookmarked;
    bookmarkedAnswer = undefined;
    await loadGuides();
    expect(useGuides.getState().bookmarked).toBe(before);
  });
  it('an unchanged re-read keeps the same array', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    const before = useGuides.getState().bookmarked;
    await loadGuides();
    expect(useGuides.getState().bookmarked).toBe(before);
  });
  it('an account change clears them at once, before any read answers, and the pill goes back to Team Ascent', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    setGuidesTab('bookmarked');
    identity = { userId: 'u-2', anonymous: false };
    bookmarkedAnswer = [];
    const p = loadGuides();
    expect(useGuides.getState().bookmarked).toEqual([]);
    expect(useGuides.getState().tab).toBe('team');
    await p;
    expect(useGuides.getState().bookmarked).toEqual([]);
  });
  it("a read that was in flight for the old account never fills the new account's bookmarks", async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    let releaseOld: (v: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { releaseOld = r; });
    const old = loadGuides(); // asks for u-1's bookmarks (answered at once with bm1), waits on u-1's guides
    while (!asked.includes('mine:u-1')) await Promise.resolve(); // all three asks are out
    identity = { userId: 'u-2', anonymous: false };
    bookmarkedAnswer = [other('bm2')];
    let releaseNew: (v: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { releaseNew = r; }); // u-2's read will wait here, so nothing can repair the store yet
    void loadGuides(); // the account changed: clears, queues one re-read
    releaseOld([]);
    await old; // the old read has applied, and the re-read for u-2 is now waiting on its guides
    expect(useGuides.getState().bookmarked).toEqual([]);
    expect(useGuides.getState().mineOwner).not.toBe('u-1');
    releaseNew([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(useGuides.getState().bookmarked.map((g) => g.rowId)).toEqual(['bm2']);
    expect(useGuides.getState().mineOwner).toBe('u-2');
  });
  it('signing out empties them at once', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    identity = null;
    void loadGuides();
    expect(useGuides.getState().bookmarked).toEqual([]);
    expect(useGuides.getState().mineOwner).toBeNull();
  });
  const bm = (id: string): Guide => ({ ...GUIDES[0]!, id, rowId: id, official: false, authorId: 'u-9' });

  it('a bookmark confirmed after the account that pressed it left is dropped, not filed under the next account', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    identity = { userId: 'u-2', anonymous: false }; // u-1 pressed Bookmark; u-2 is at the keyboard when the answer lands
    bookmarkedAnswer = [other('bm2')];
    await loadGuides();
    const before = useGuides.getState();
    guideBookmarked(bm('bm7'), true, 1, 'u-1');
    const after = useGuides.getState();
    expect(after.bookmarked).toBe(before.bookmarked);
    expect(after.bookmarked.map((x) => x.rowId)).toEqual(['bm2']);
    expect(after.mineOwner).toBe('u-2');
  });
  it('the same when the account that pressed has become a guest, or nobody', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    identity = { userId: 'g-1', anonymous: true };
    guideBookmarked(bm('bm7'), true, 1, 'u-1');
    guideBookmarked(bm('bm7'), true, 1, 'g-1');
    identity = null;
    guideBookmarked(bm('bm7'), true, 1, 'u-1');
    expect(useGuides.getState().bookmarked.map((x) => x.rowId)).toEqual(['bm1']);
    expect(useGuides.getState().mineOwner).toBe('u-1');
  });
  it('a null account does nothing', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    const before = useGuides.getState().bookmarked;
    guideBookmarked(bm('bm7'), true, 1, null);
    expect(useGuides.getState().bookmarked).toBe(before);
  });
  it('a refused bookmark does not throw away a read in flight', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    let release: (v: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { release = r; });
    const p = loadGuides();
    while (!asked.includes('mine:u-1')) await Promise.resolve();
    guideBookmarked(bm('bm7'), true, 1, 'u-2'); // not the account at the keyboard: nothing happens, no stale mark
    release([]);
    await p;
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1); // no second read was asked for
    expect(useGuides.getState().bookmarked.map((x) => x.rowId)).toEqual(['bm1']);
  });
  it("filing a bookmark drops another account's private guides the store still holds", async () => {
    identity = { userId: 'u-2', anonymous: false };
    mineAnswer = [rec('m2', { official: false, authorId: 'u-2', byline: 'Two' })];
    await loadGuides();
    expect(useGuides.getState().mine.map((x) => x.rowId)).toEqual(['m2']);
    expect(useGuides.getState().mineOwner).toBe('u-2');
    identity = { userId: 'u-1', anonymous: false }; // switched, loadGuides not yet called
    guideBookmarked(bm('bm7'), true, 1, 'u-1');
    expect(useGuides.getState().mine).toEqual([]);
    expect(useGuides.getState().mineOwner).toBe('u-1');
    expect(useGuides.getState().bookmarked.map((x) => x.rowId)).toEqual(['bm7']);
  });
  it("filing a bookmark for an account that did not hold the lists never keeps the last account's team flag", async () => {
    identity = { userId: 'u-2', anonymous: false };
    teamAnswer = true;
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-2' });
    identity = { userId: 'u-1', anonymous: false }; // switched, loadGuides not yet called
    guideBookmarked(bm('bm7'), true, 1, 'u-1');
    expect(useGuides.getState().mineOwner).toBe('u-1');
    expect(useGuides.getState().team).toBe(false);
    // The account the flag was read for keeps it across its own bookmarks.
    resetGuidesForTests();
    identity = { userId: 'u-2', anonymous: false };
    await loadGuides();
    guideBookmarked(bm('bm8'), true, 1, 'u-2');
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-2' });
  });
  it('guideBookmarked puts the guide first with its new count, and takes it out again', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    const g = { ...useGuides.getState().bookmarked[0]!, id: 'bm2', rowId: 'bm2', title: 'Second' };
    guideBookmarked(g, true, 7, 'u-1');
    expect(useGuides.getState().bookmarked.map((x) => [x.rowId, x.bookmarkCount])).toEqual([['bm2', 7], ['bm1', 0]]);
    guideBookmarked(g, true, 8, 'u-1'); // again: still once, count refreshed
    expect(useGuides.getState().bookmarked.map((x) => [x.rowId, x.bookmarkCount])).toEqual([['bm2', 8], ['bm1', 0]]);
    guideBookmarked(g, false, 7, 'u-1');
    expect(useGuides.getState().bookmarked.map((x) => x.rowId)).toEqual(['bm1']);
  });
  it('guideBookmarked does nothing for a guest or for nobody', () => {
    const g = bm('bm9');
    identity = null;
    guideBookmarked(g, true, 1, 'u-1');
    identity = { userId: 'g-1', anonymous: true };
    guideBookmarked(g, true, 1, 'g-1');
    expect(useGuides.getState().bookmarked).toEqual([]);
  });
  it('a bookmark made while a read was in flight is not undone by that read', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [];
    let release: (v: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { release = r; });
    const p = loadGuides();
    await Promise.resolve();
    guideBookmarked({ ...GUIDES[0]!, id: 'bm5', rowId: 'bm5', official: false, authorId: 'u-9' }, true, 1, 'u-1');
    bookmarkedAnswer = [other('bm5')];
    release([]);
    await p;
    await new Promise((r) => setTimeout(r, 0));
    expect(useGuides.getState().bookmarked.map((x) => x.rowId)).toEqual(['bm5']);
  });
  it('a deleted guide leaves the bookmarks too', async () => {
    identity = { userId: 'u-1', anonymous: false };
    bookmarkedAnswer = [other('bm1')];
    await loadGuides();
    guideDeleted('bm1');
    expect(useGuides.getState().bookmarked).toEqual([]);
  });
});

describe('a server change that does not bump the revision still reaches an open session', () => {
  it('a guide published elsewhere replaces the copy in My guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [rec('m1', { official: false, authorId: 'u-1', byline: 'Mike', published: false })];
    await loadGuides();
    expect(useGuides.getState().mine[0]!.published).toBe(false);
    mineAnswer = [rec('m1', { official: false, authorId: 'u-1', byline: 'Mike', published: true, publishedAt: '2026-10-13T00:00:00Z' })];
    await loadGuides();
    expect(useGuides.getState().mine[0]!.published).toBe(true);
    expect(useGuides.getState().mine[0]!.publishedAt).toBe('2026-10-13T00:00:00Z');
  });
  it('a changed bookmark count, or a guide the team hid, replaces the list', async () => {
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [rec('m1', { official: false, authorId: 'u-1', byline: 'Mike', published: true })];
    await loadGuides();
    mineAnswer = [rec('m1', { official: false, authorId: 'u-1', byline: 'Mike', published: true, bookmarkCount: 3 })];
    await loadGuides();
    expect(useGuides.getState().mine[0]!.bookmarkCount).toBe(3);
    mineAnswer = [rec('m1', { official: false, authorId: 'u-1', byline: 'Mike', published: true, bookmarkCount: 3, hidden: true })];
    await loadGuides();
    expect(useGuides.getState().mine[0]!.hidden).toBe(true);
  });
  it('a guide the team carried over to another set replaces the list, in every list the store holds', async () => {
    identity = { userId: 'u-1', anonymous: false };
    const own = { official: false, authorId: 'u-1', byline: 'Mike' };
    const theirs = { official: false, authorId: 'u-9', byline: 'Ann', published: true };
    answer = async () => ({ state: 'on', guides: [rec('a')] });
    mineAnswer = [rec('m1', own)];
    bookmarkedAnswer = [rec('bm1', theirs)];
    await loadGuides();
    const before = useGuides.getState();
    expect([before.list[0]!.sets, before.mine[0]!.sets, before.bookmarked[0]!.sets]).toEqual([['set2'], ['set2'], ['set2']]);
    // The same rows at the same revision: only their sets changed (a carry-over does not bump the revision).
    answer = async () => ({ state: 'on', guides: [rec('a', { sets: ['set2', 'set3'] })] });
    mineAnswer = [rec('m1', { ...own, sets: ['set2', 'set3'] })];
    bookmarkedAnswer = [rec('bm1', { ...theirs, sets: ['set2', 'set3'] })];
    await loadGuides();
    const after = useGuides.getState();
    expect([after.list[0]!.sets, after.mine[0]!.sets, after.bookmarked[0]!.sets]).toEqual([['set2', 'set3'], ['set2', 'set3'], ['set2', 'set3']]);
    // And a read that changes nothing still keeps the same arrays.
    await loadGuides();
    const again = useGuides.getState();
    expect(again.list).toBe(after.list);
    expect(again.mine).toBe(after.mine);
    expect(again.bookmarked).toBe(after.bookmarked);
  });
});

describe('the pills', () => {
  it('each can be chosen', () => {
    for (const tab of ['mine', 'bookmarked', 'community', 'reports', 'team'] as const) {
      setGuidesTab(tab);
      expect(useGuides.getState().tab).toBe(tab);
    }
  });
  it("an account change takes the team's Reports pill back to Team Ascent at once, before any read answers", async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    await loadGuides();
    setGuidesTab('reports');
    expect(useGuides.getState()).toMatchObject({ team: true, tab: 'reports' });
    identity = { userId: 'u-2', anonymous: false };
    teamAnswer = false;
    const p = loadGuides();
    expect(useGuides.getState()).toMatchObject({ team: false, tab: 'team', mineOwner: null });
    await p;
    expect(useGuides.getState()).toMatchObject({ team: false, tab: 'team', mineOwner: 'u-2' });
  });
});
