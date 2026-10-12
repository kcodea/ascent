import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideRecord } from '@game/guides';
import type { OfficialGuidesAnswer } from './guidesRemote';

let answer: () => Promise<OfficialGuidesAnswer>;
let calls = 0;
vi.mock('./guidesRemote', () => ({ fetchOfficialGuides: () => { calls++; return answer(); } }));

const { GUIDES } = await import('./guides');
const { loadGuides, resetGuidesForTests, useGuides } = await import('./guidesStore');

const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: null, byline: 'Team Ascent', official: true, published: true, hidden: false, sets: ['set2'], tribes: ['beast'],
  pairsWith: [], iconCard: 'b2_sunmane', title: `Guide ${id}`, tagline: '', body: 'B', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});

beforeEach(() => {
  resetGuidesForTests();
  calls = 0;
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
