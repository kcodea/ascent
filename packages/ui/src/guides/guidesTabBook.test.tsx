// @vitest-environment jsdom
/**
 * THE GUIDES TAB INSIDE THE REAL COMPENDIUM. The tab's own tests hand it its guides; these go through `MinionBook`,
 * which decides which guides the tab is given and which view the Compendium opens on. Pins: the My guides pill lists
 * every guide the player owns, whatever its set or tribe (so one that did not carry over to this set can be found and
 * repaired), and a guide the lobby rail asked to edit opens the Compendium straight on Guides, in the editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SETS, activeSet, type SetId } from '@game/content';
import type { GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import type { CommunityQuery } from './guidesRemote';

let mineRows: GuideRecord[] = [];
/** What the server holds as this player's bookmarks. */
let bookmarkedRows: GuideRecord[] = [];
/** Every question the Community list asked the server. */
const communityAsked: CommunityQuery[] = [];
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  // The server answers, has no Team Ascent rows yet (so the built-in guides keep showing), and knows this player's guides.
  fetchOfficialGuides: async () => ({ state: 'on', guides: [] }),
  fetchTeamFlag: async () => false,
  fetchMyGuides: async () => mineRows,
  fetchBookmarkedGuides: async () => bookmarkedRows,
  fetchGuideById: async () => undefined,
  fetchCommunityPage: async (q: CommunityQuery) => { communityAsked.push(q); return { guides: [], more: false }; },
  communitySearch: (s: string) => s.trim(),
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  deleteGuideRemote: async () => ({ ok: false, code: 'offline' }),
  setPublishedRemote: async () => ({ ok: false, code: 'offline' }),
  bookmarkGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
}));

const { MinionBook } = await import('../MinionBook');
const { useGame } = await import('../store');
const { currentIdentity, setIdentity } = await import('../identity');
const { guidesFor } = await import('./guides');
const { loadGuides, requestGuideEdit, resetGuidesForTests, useGuides } = await import('./guidesStore');

const ROW = '33333333-3333-4333-8333-333333333333';
const live = activeSet();
const other = (Object.keys(SETS) as SetId[]).find((id) => id !== live.id)!;
/** A tribe the other set has and the shown one does not, when there is one: the guide is then off this set's roster too. */
const foreignTribe = SETS[other].tribes.find((t) => !live.tribes.includes(t));
/** A guide this player wrote in ANOTHER set: it does not show in the set the Compendium opens on. */
const elsewhere: GuideRecord = {
  id: ROW, slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: false, publishedAt: null, hidden: false, sets: [other],
  tribes: foreignTribe ? [foreignTribe] : [], pairsWith: [], iconCard: 'grim', title: 'Written elsewhere', tagline: 'From another set', body: 'Words.',
  core: ['grim'], enablers: [], mentions: [], aliases: {}, forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0,
  revision: 3, createdAt: '', updatedAt: '',
};

const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el: Element): Promise<void> => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const button = (c: Element, text: string): HTMLButtonElement | undefined => [...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const guidesButton = (c: HTMLElement): Element => [...c.querySelectorAll('.book-head .book-gloss')].find((b) => b.textContent?.trim() === 'Guides')!;
const shownIds = (c: HTMLElement): string[] => [...c.querySelectorAll('.bookguide:not(.gedit)')].map((g) => g.getAttribute('data-guide')!);

let m: Mounted | null = null;
const prevGame = useGame.getState();
const prevIdentity = currentIdentity();

beforeEach(async () => {
  localStorage.clear();
  resetGuidesForTests();
  mineRows = [elsewhere];
  bookmarkedRows = [];
  communityAsked.length = 0;
  // A signed-in player, as the game has it once identity has landed: the store has read this account's guides.
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  act(() => { useGame.setState({ showTitle: true, playerName: 'Mike', account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } }); });
  await act(async () => { await loadGuides(); });
});
afterEach(() => {
  m?.unmount();
  m = null;
  setIdentity(prevIdentity);
  act(() => { useGame.setState({ showTitle: prevGame.showTitle, playerName: prevGame.playerName, account: prevGame.account, showBook: prevGame.showBook }); });
  resetGuidesForTests();
});

describe('the dimmed surround closes the Compendium only for a press that began on it', () => {
  const fire = (el: Element, type: 'mousedown' | 'click'): void => { act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true })); }); };
  const openBook = async (): Promise<{ surround: Element; inside: Element }> => {
    act(() => { useGame.setState({ showBook: true }); });
    m = mount(<MinionBook />);
    await settle();
    return { surround: m.container.querySelector('.book-ov')!, inside: m.container.querySelector('.book .book-head')! };
  };
  it('a press and a click on the surround itself close it', async () => {
    const { surround } = await openBook();
    fire(surround, 'mousedown');
    fire(surround, 'click');
    expect(useGame.getState().showBook).toBe(false);
  });
  it('a press that began inside the window and ended on the surround (a text selection dragged out) does not', async () => {
    const { surround, inside } = await openBook();
    fire(inside, 'mousedown');
    fire(surround, 'click');
    expect(useGame.getState().showBook).toBe(true);
    // The next real press on the surround still closes it.
    fire(surround, 'mousedown');
    fire(surround, 'click');
    expect(useGame.getState().showBook).toBe(false);
  });
  it('a click inside the window never closes it, wherever the press began', async () => {
    const { surround, inside } = await openBook();
    fire(surround, 'mousedown');
    fire(inside, 'click');
    expect(useGame.getState().showBook).toBe(true);
  });
  it('dragging a selection out of the guide editor leaves the editor open with its text', async () => {
    act(() => { requestGuideEdit(ROW); });
    const { surround } = await openBook();
    const body = m!.container.querySelector<HTMLTextAreaElement>('.gedit .gedit-body')!;
    fire(body, 'mousedown');
    fire(surround, 'click');
    expect(useGame.getState().showBook).toBe(true);
    expect(m!.container.querySelector('.gedit')).not.toBeNull();
  });
});

describe('the Guides tab in the Compendium', () => {
  it('My guides lists a guide the player owns that is not in the shown set, and it says so', async () => {
    expect(useGuides.getState().mine.map((g) => g.rowId)).toEqual([ROW]);
    m = mount(<MinionBook />);
    await settle();
    await click(guidesButton(m.container));
    // Team Ascent: the shown set's guides, by set and tribe. The player's guide from the other set is not among them.
    expect(shownIds(m.container)).toEqual(guidesFor(live.id, live.tribes).map((g) => g.id));
    expect(shownIds(m.container)).not.toContain(ROW);
    await click(button(m.container, 'My guides (1)')!);
    expect(shownIds(m.container)).toEqual([ROW]);
    const own = m.container.querySelector<HTMLElement>(`.bookguide[data-guide="${ROW}"]`)!;
    expect(own.querySelector('.bookguide-title')!.textContent).toBe('Written elsewhere');
    expect(own.textContent).toContain('Not in this set');
    expect(own.textContent).toContain('Private');
    expect(button(own, 'Edit')).toBeDefined();
    // And back: the pill is the only thing that changed.
    await click(button(m.container, 'Team Ascent')!);
    expect(shownIds(m.container)).not.toContain(ROW);
  });

  it('a guide the rail asked to edit opens the Compendium straight on Guides, in the editor', async () => {
    act(() => { requestGuideEdit(ROW); });
    m = mount(<MinionBook />);
    await settle();
    expect(guidesButton(m.container).getAttribute('aria-pressed')).toBe('true');
    expect(m.container.querySelector<HTMLInputElement>('.gedit .gedit-title')!.value).toBe('Written elsewhere');
    expect(useGuides.getState().pendingEdit).toBeNull();
  });

  it('with no such request the Compendium opens on its cards, as before', async () => {
    m = mount(<MinionBook />);
    await settle();
    expect(guidesButton(m.container).getAttribute('aria-pressed')).toBe('false');
    expect(m.container.querySelector('.bookguides')).toBeNull();
  });
});

describe('the pills in the real Compendium', () => {
  const openGuidesTab = async (): Promise<HTMLElement> => {
    act(() => { useGame.setState({ showBook: true }); });
    m = mount(<MinionBook />);
    await settle();
    await click(guidesButton(m.container));
    return m.container;
  };
  const sub = (c: HTMLElement): string => c.querySelector('.book-sub')!.textContent ?? '';
  /** Type into the Compendium's search box, then wait past the Community list's pause. */
  const type = async (c: HTMLElement, text: string): Promise<void> => {
    const box = c.querySelector<HTMLInputElement>('.book-search')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    // Two steps: the keystroke is drawn first (the pause starts when the list is handed the new text), then the wait.
    act(() => {
      setValue.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  };
  it('Community asks with the set shown, every tribe and Neutral, and the subtitle says what the pill shows', async () => {
    const c = await openGuidesTab();
    expect(communityAsked).toEqual([]);
    await click(button(c, 'Community')!);
    await settle();
    expect(communityAsked.length).toBe(1);
    expect(communityAsked[0]!.setId).toBe(live.id);
    expect(communityAsked[0]!.tribes).toEqual([...live.tribes]);
    expect(communityAsked[0]!.neutral).toBe(true);
    expect(communityAsked[0]!.search).toBe('');
    expect(communityAsked[0]!.offset).toBe(0);
    expect(sub(c)).toBe(`Community guides for ${live.name}.`);
    expect(c.textContent).not.toContain('0 results');
    expect(c.textContent).toContain('No Community guides match.');
  });
  it('under Community the search box and a lit tribe pill go to the server, and the subtitle never reads "0 results"', async () => {
    const c = await openGuidesTab();
    await click(button(c, 'Community')!);
    await settle();
    await type(c, 'imp');
    expect(communityAsked.length).toBe(2);
    expect(communityAsked[1]).toMatchObject({ search: 'imp', offset: 0, neutral: true });
    expect(sub(c)).toBe(`Community guides for ${live.name}.`);
    expect(c.textContent).not.toContain('0 results');
    await click(c.querySelector('.book-runetribes [aria-label="Neutral guides"]')!);
    await settle();
    expect(communityAsked.length).toBe(3);
    expect(communityAsked[2]).toMatchObject({ search: 'imp', tribes: [], neutral: true, offset: 0 });
  });
  it("My guides counts the player's own guides in the subtitle, not Team Ascent's build lines", async () => {
    const c = await openGuidesTab();
    expect(sub(c)).toContain(`Build lines for ${live.name}.`);
    await click(button(c, 'My guides (1)')!);
    expect(sub(c)).toBe('1 guide of yours.');
    expect(c.textContent).not.toContain('Build lines for');
  });
  it('guides the store still holds for another account are not counted in the subtitle', async () => {
    const c = await openGuidesTab();
    // A missed re-read after an account change: the store holds a guide and a bookmark, but they are u-2's.
    const held = useGuides.getState().mine[0]!;
    act(() => { useGuides.setState({ mineOwner: 'u-2', bookmarked: [{ ...held, id: 'kept', rowId: 'kept', sets: [live.id], tribes: [], published: true, authorId: 'u-9' }] }); });
    await click(button(c, 'My guides')!);
    expect(shownIds(c)).toEqual([]);
    expect(sub(c)).toBe('0 guides of yours.');
    await click(button(c, 'Bookmarked')!);
    expect(shownIds(c)).toEqual([]);
    expect(sub(c)).toBe(`0 bookmarked guides for ${live.name}.`);
  });
  it('a search under My guides still counts results, with the words searched for', async () => {
    const c = await openGuidesTab();
    await click(button(c, 'My guides (1)')!);
    await type(c, 'elsewhere');
    expect(sub(c)).toBe('1 result for "elsewhere"');
    await type(c, 'nothing has this');
    expect(sub(c)).toBe('0 results for "nothing has this"');
  });
  it('Bookmarked with none says how to get one', async () => {
    const c = await openGuidesTab();
    await click(button(c, 'Bookmarked')!);
    expect(c.textContent).toContain('No bookmarks yet.');
    expect(sub(c)).toBe(`0 bookmarked guides for ${live.name}.`);
    expect(communityAsked).toEqual([]);
  });
  it('Bookmarked lists the bookmarks for the shown set only, and counts them', async () => {
    const HERE = '44444444-4444-4444-8444-444444444444';
    const THERE = '55555555-5555-4555-8555-555555555555';
    const base: GuideRecord = { ...elsewhere, authorId: 'u-9', byline: 'Ann', published: true, publishedAt: '2026-10-13T00:00:00Z', tribes: [] };
    bookmarkedRows = [{ ...base, id: HERE, title: 'Kept here', sets: [live.id] }, { ...base, id: THERE, title: 'Kept there', sets: [other] }];
    await act(async () => { await loadGuides(); });
    expect(useGuides.getState().bookmarked.map((g) => g.rowId)).toEqual([HERE, THERE]);
    const c = await openGuidesTab();
    await click(button(c, 'Bookmarked (1)')!);
    expect(shownIds(c)).toEqual([HERE]);
    expect(sub(c)).toBe(`1 bookmarked guide for ${live.name}.`);
  });
});
