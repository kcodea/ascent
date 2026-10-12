// @vitest-environment jsdom
/**
 * THE BOOKMARKED AND COMMUNITY PILLS (step 3). Pins: the Community list asks the server for one set's public guides
 * with the tribe rule, the sort and the search text; one question is one request; it grows by pages and never shows a
 * guide twice; a slow answer to an old question never replaces the answer to a newer one; a card there offers Bookmark
 * and Duplicate, never Edit; a guest is asked to sign in; the Bookmarked pill draws the store's bookmarks, only for
 * their owner; with guides offline the server is never asked and the tab says so.
 *
 * And two things a player would feel: typing in the search box under Team Ascent never redraws the guide cards, and
 * a keyboard player's focus comes back to the Bookmark button once the server has answered.
 *
 * These tests never lay a page out, so the one layout rule the new rows depend on is pinned as stylesheet text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, useState } from 'react';
import type { Tribe } from '@game/core';
import { SETS } from '@game/content';
import { GUIDE_LIMITS, type GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import type { CommunityPage, CommunityQuery, GuideWriteResult } from './guidesRemote';

const asked: CommunityQuery[] = [];
let pageAnswer: (q: CommunityQuery) => Promise<CommunityPage | undefined> | CommunityPage | undefined;
const bookmarks: Array<[string, boolean]> = [];
let bookmarkAnswer: (on: boolean) => GuideWriteResult<{ bookmarked: boolean; count: number }>;
/** While set, a bookmark does not answer until this resolves. */
let hold: Promise<void> | null = null;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => ({ state: 'offline' }),
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchBookmarkedGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  communitySearch: (s: string) => s.trim().replace(/\s+/g, ' '),
  fetchCommunityPage: async (q: CommunityQuery) => { asked.push(q); return pageAnswer(q); },
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  deleteGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
  setPublishedRemote: async () => ({ ok: false, code: 'offline' }),
  bookmarkGuideRemote: async (rowId: string, on: boolean) => { bookmarks.push([rowId, on]); if (hold) await hold; return bookmarkAnswer(on); },
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));
/** How many times a guide card has been drawn: the card works its tribe chips out once each time it renders. */
let cardDraws = 0;
vi.mock('./GuideParts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./GuideParts')>();
  return { ...real, guideChips: (...a: Parameters<typeof real.guideChips>) => { cardDraws++; return real.guideChips(...a); } };
});

const { CompendiumGuides } = await import('./CompendiumGuides');
const { GUIDES } = await import('./guides');
type Guide = (typeof GUIDES)[number];
const { resetGuidesForTests, useGuides } = await import('./guidesStore');
const { currentIdentity, setIdentity } = await import('../identity');
const prevIdentity = currentIdentity();

const src = GUIDES[0]!;
const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: 'u-9', byline: 'Ann', official: false, published: true, publishedAt: '2026-10-13T00:00:00Z', hidden: false,
  sets: ['set2'], tribes: [...src.tribes], pairsWith: [], iconCard: src.iconCard, title: `Guide ${id}`, tagline: '', body: 'Write-up.',
  core: [...src.core], enablers: [], mentions: [], aliases: {}, forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0,
  sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});
const asGuide = (id: string, patch: Partial<Guide> = {}): Guide =>
  ({ ...src, id, rowId: id, sets: ['set2'], official: false, published: true, authorId: 'u-9', byline: 'Ann', title: `Guide ${id}`, ...patch });

interface P { guides: readonly Guide[]; pillTribes: readonly Tribe[]; search: string }
let setProps: (p: Partial<P>) => void = () => {};
function Host({ first }: { first: P }): JSX.Element {
  const [p, set] = useState(first);
  setProps = (x) => set((c) => ({ ...c, ...x }));
  return <CompendiumGuides guides={p.guides} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" pillTribes={p.pillTribes} search={p.search} />;
}
let ui: Mounted | null = null;
const prev = useGame.getState();
const show = (who: 'player' | 'guest', patch: Partial<ReturnType<typeof useGuides.getState>> = {}, first: Partial<P> = {}, strict = false): HTMLElement => {
  act(() => {
    useGame.setState({ account: { userId: who === 'guest' ? 'g-1' : 'u-1', email: who === 'guest' ? null : 'm@example.test', anonymous: who === 'guest', discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', team: false, mine: [], bookmarked: [], mineOwner: who === 'guest' ? null : 'u-1', tab: 'community', ...patch });
  });
  setIdentity({ userId: who === 'guest' ? 'g-1' : 'u-1', displayName: 'Mike', anonymous: who === 'guest', email: who === 'guest' ? null : 'm@example.test' });
  const host = <Host first={{ guides: [], pillTribes: [], search: '', ...first }} />;
  ui = mount(strict ? <StrictMode>{host}</StrictMode> : host);
  return ui.container;
};
const settle = async (ms = 0): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
/** A browser takes focus off a button that has just been switched off; this test environment leaves it there (and
 *  will not blur it). So move focus to the page the way a browser would. */
const dropFocus = (): void => {
  const t = document.createElement('button');
  document.body.appendChild(t);
  t.focus();
  t.blur();
  t.remove();
};
const button = (el: Element, text: string): HTMLButtonElement | undefined => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = async (el: Element, text: string): Promise<void> => {
  const b = button(el, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const titles = (c: HTMLElement): string[] => [...c.querySelectorAll('.bookguide-title')].map((e) => e.textContent ?? '');
const card = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`.bookguide[data-guide="${id}"]`)!;
const PAGE = GUIDE_LIMITS.communityPage;

beforeEach(() => {
  localStorage.clear();
  resetGuidesForTests();
  asked.length = 0; bookmarks.length = 0;
  hold = null;
  pageAnswer = () => ({ guides: [rec('a'), rec('b')], more: false });
  bookmarkAnswer = (on) => ({ ok: true, value: { bookmarked: on, count: on ? 1 : 0 } });
});
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName }); });
  setIdentity(prevIdentity);
});

describe('the pills', () => {
  it('there are four, and choosing one sets the store', async () => {
    const c = show('player', { tab: 'team' });
    const pills = [...c.querySelectorAll('.gtool-pills button')].map((b) => b.textContent);
    expect(pills).toEqual(['Team Ascent', 'My guides', 'Bookmarked', 'Community']);
    await press(c, 'Community');
    expect(useGuides.getState().tab).toBe('community');
    await press(c, 'Bookmarked');
    expect(useGuides.getState().tab).toBe('bookmarked');
  });
  it('the Bookmarked pill counts the bookmarks for this set', () => {
    const c = show('player', { tab: 'team', bookmarked: [asGuide('x'), asGuide('y'), asGuide('z', { sets: ['set3'] })] });
    expect(button(c, 'Bookmarked (2)')).toBeDefined();
  });
  it('bookmarks the store still holds for another account are not counted', () => {
    const c = show('player', { tab: 'team', bookmarked: [asGuide('x')], mineOwner: 'u-2' });
    expect(button(c, 'Bookmarked')).toBeDefined();
  });
  it('offline, Bookmarked and Community cannot be chosen', () => {
    const c = show('player', { tab: 'team', capability: 'offline' });
    expect(button(c, 'Bookmarked')!.disabled).toBe(true);
    expect(button(c, 'Community')!.disabled).toBe(true);
    expect(button(c, 'Team Ascent')!.disabled).toBe(false);
    expect(button(c, 'My guides')!.disabled).toBe(false);
    expect(c.textContent).toContain('Guides are offline. You can read the built-in guides; writing, bookmarks and the Community list need a connection.');
  });
});

describe('the Community list', () => {
  it('asks once for this set, the whole roster and Neutral, most bookmarked first, from the start', async () => {
    const c = show('player');
    expect(c.querySelector('.gcomm-note[role="status"]')!.textContent).toBe('Loading the Community guides.');
    await settle();
    expect(asked).toEqual([{ setId: 'set2', tribes: [...SETS.set2.tribes], neutral: true, search: '', sort: 'bookmarked', offset: 0 }]);
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(card(c, 'a').textContent).toContain('by Ann');
    expect(c.querySelector('.gcomm-note')).toBeNull();
    expect(button(c, 'Most bookmarked')!.getAttribute('aria-pressed')).toBe('true');
    // Nothing else asks: no second request while the answer is on the screen.
    await settle(350);
    expect(asked.length).toBe(1);
  });
  it('lit tribe pills narrow the question; the Neutral pill asks for guides with no tribe', async () => {
    show('player', {}, { pillTribes: ['dragon'] });
    await settle();
    expect(asked[0]).toMatchObject({ tribes: ['dragon'], neutral: false });
    act(() => { setProps({ pillTribes: ['neutral'] }); });
    await settle();
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ tribes: [], neutral: true, offset: 0 });
    act(() => { setProps({ pillTribes: ['dragon', 'neutral'] }); });
    await settle();
    expect(asked.length).toBe(3);
    expect(asked[2]).toMatchObject({ tribes: ['dragon'], neutral: true });
  });
  it('a list it is handed is never drawn there: the Community list is only what the server answered', async () => {
    const c = show('player', {}, { guides: [asGuide('handed')] });
    await settle();
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
  });
  it('a card offers Bookmark and Duplicate, and never Edit, Publish or Delete', async () => {
    const c = show('player');
    await settle();
    expect(button(card(c, 'a'), 'Bookmark')).toBeDefined();
    expect(button(card(c, 'a'), 'Duplicate')).toBeDefined();
    for (const t of ['Edit', 'Publish', 'Unpublish', 'Delete']) expect(button(card(c, 'a'), t), t).toBeUndefined();
  });
  it("the player's own published guide has no Bookmark button, and is not edited, unpublished or deleted from here", async () => {
    pageAnswer = () => ({ guides: [rec('a', { authorId: 'u-1', byline: 'Mike' })], more: false });
    const c = show('player');
    await settle();
    expect(button(card(c, 'a'), 'Duplicate')).toBeDefined();
    for (const t of ['Bookmark', 'Bookmarked', 'Edit', 'Publish', 'Unpublish', 'Delete']) expect(button(card(c, 'a'), t), t).toBeUndefined();
  });
  it('Bookmark calls the server, then reads Bookmarked, and the guide is in the store; pressing again removes it', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Bookmark');
    expect(bookmarks).toEqual([['a', true]]);
    expect(button(card(c, 'a'), 'Bookmarked')!.getAttribute('aria-pressed')).toBe('true');
    expect(useGuides.getState().bookmarked.map((g) => g.rowId)).toEqual(['a']);
    expect(button(c, 'Bookmarked (1)')).toBeDefined(); // the pill counts it
    expect(button(card(c, 'b'), 'Bookmark')).toBeDefined(); // and only that card changed
    await press(card(c, 'a'), 'Bookmarked');
    expect(bookmarks).toEqual([['a', true], ['a', false]]);
    expect(useGuides.getState().bookmarked).toEqual([]);
    expect(button(card(c, 'a'), 'Bookmark')).toBeDefined();
    // A bookmark redraws the list; it asks the server for nothing.
    expect(asked.length).toBe(1);
  });
  it('the Bookmark button says its state once: one name in both states, and pressed or not carries the state', async () => {
    const c = show('player');
    await settle();
    const off = button(card(c, 'a'), 'Bookmark')!;
    expect(off.getAttribute('aria-label')).toBe('Bookmark Guide a');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    await press(card(c, 'a'), 'Bookmark');
    const on = button(card(c, 'a'), 'Bookmarked')!;
    expect(on.getAttribute('aria-label')).toBe('Bookmark Guide a');
    expect(on.getAttribute('aria-pressed')).toBe('true');
  });
  it("another account's bookmarks never light Bookmarked on a card", async () => {
    // The store still holds u-2's bookmark of guide a (a missed re-read after an account change); u-1 is signed in.
    const c = show('player', { bookmarked: [asGuide('a')], mineOwner: 'u-2' });
    await settle();
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(button(card(c, 'a'), 'Bookmarked')).toBeUndefined();
    expect(button(card(c, 'a'), 'Bookmark')!.getAttribute('aria-pressed')).toBe('false');
    expect(button(card(c, 'a'), 'Bookmark')!.className).not.toContain(' on');
  });
  it('the order chosen survives the editor: Newest, Duplicate, Cancel, and the list asks for Newest again', async () => {
    const c = show('player');
    await settle();
    await press(c, 'Newest');
    expect(asked.length).toBe(2);
    await press(card(c, 'a'), 'Duplicate');
    const editor = c.querySelector('.gedit');
    expect(editor).not.toBeNull();
    expect(c.querySelector('.gcomm-sort')).toBeNull(); // the editor has taken the tab over: the list is gone
    await press(editor!, 'Cancel');
    await settle();
    expect(c.querySelector('.gedit')).toBeNull();
    expect(asked.length).toBe(3);
    expect(asked[2]).toMatchObject({ sort: 'newest', offset: 0 });
    expect(button(c, 'Newest')!.getAttribute('aria-pressed')).toBe('true');
    expect(button(c, 'Most bookmarked')!.getAttribute('aria-pressed')).toBe('false');
  });
  it('a refused bookmark is a sentence on the card', async () => {
    bookmarkAnswer = () => ({ ok: false, code: 'too_many_bookmarks' });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Bookmark');
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe(`You already have ${GUIDE_LIMITS.bookmarksPerPlayer} bookmarks. Remove one to make room.`);
    expect(useGuides.getState().bookmarked).toEqual([]);
  });
  it('a guest who presses Bookmark is asked to sign in, and the server is not called', async () => {
    const c = show('guest');
    await settle();
    await press(card(c, 'a'), 'Bookmark');
    expect(bookmarks).toEqual([]);
    expect(c.querySelector('.gtool-signin')!.textContent).toContain('Sign in to write and bookmark guides.');
  });
  it('while a bookmark is on its way the button cannot be pressed again, and focus comes back to it once it is answered', async () => {
    let answer!: () => void;
    hold = new Promise<void>((r) => { answer = r; });
    const c = show('player');
    await settle();
    const b = button(card(c, 'a'), 'Bookmark')!;
    b.focus();
    await press(card(c, 'a'), 'Bookmark');
    expect(button(card(c, 'a'), 'Bookmark')!.disabled).toBe(true);
    dropFocus();
    expect(document.activeElement).toBe(document.body);
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    expect(bookmarks).toEqual([['a', true]]);
    expect(button(card(c, 'a'), 'Bookmarked')!.disabled).toBe(false);
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Bookmarked'));
  });
  it('Show more asks for the next page and adds it, without showing a guide twice', async () => {
    pageAnswer = (q) => (q.offset === 0
      ? { guides: Array.from({ length: PAGE }, (_, i) => rec(`p${i}`)), more: true }
      : { guides: [rec(`p${PAGE - 1}`), rec('last')], more: false });
    const c = show('player');
    await settle();
    expect(titles(c).length).toBe(PAGE);
    await press(c, 'Show more guides');
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: PAGE, sort: 'bookmarked' });
    // No IntersectionObserver here, so every slot has mounted its card: a slot is a card.
    expect(c.querySelectorAll('.bookguide-slot').length).toBe(PAGE + 1);
    expect(titles(c).length).toBe(PAGE + 1);
    expect(new Set(titles(c)).size).toBe(PAGE + 1);
    expect(titles(c)[PAGE]).toBe('Guide last');
    expect(button(c, 'Show more guides')).toBeUndefined();
  });
  it('while the next page is on its way Show more cannot be pressed, and the guides already shown stay', async () => {
    let release: (p: CommunityPage) => void = () => {};
    pageAnswer = (q) => (q.offset === 0 ? { guides: [rec('a')], more: true } : new Promise<CommunityPage>((r) => { release = r; }));
    const c = show('player');
    await settle();
    await press(c, 'Show more guides');
    expect(button(c, 'Show more guides')!.disabled).toBe(true);
    expect(titles(c)).toEqual(['Guide a']);
    expect(c.querySelector('.gcomm-note')).toBeNull();
    await act(async () => { release({ guides: [rec('b')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
  });
  it('by keyboard: when the next page lands focus is back on Show more, unless the player has moved on', async () => {
    let release: (p: CommunityPage) => void = () => {};
    pageAnswer = (q) => (q.offset === 0 ? { guides: [rec('a')], more: true } : new Promise<CommunityPage>((r) => { release = r; }));
    const c = show('player');
    await settle();
    button(c, 'Show more guides')!.focus();
    await press(c, 'Show more guides');
    dropFocus(); // the button was switched off: a browser drops focus to the page
    await act(async () => { release({ guides: [rec('b')], more: true }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(document.activeElement).toBe(button(c, 'Show more guides'));
    // Moved on meanwhile: focus is left where the player put it.
    await press(c, 'Show more guides');
    const elsewhere = button(c, 'New guide')!;
    elsewhere.focus();
    await act(async () => { release({ guides: [rec('d')], more: true }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide a', 'Guide b', 'Guide d']);
    expect(document.activeElement).toBe(elsewhere);
  });
  it('by keyboard: a page that could not be read puts focus on Try again', async () => {
    pageAnswer = (q) => (q.offset === 0 ? { guides: [rec('a')], more: true } : undefined);
    const c = show('player');
    await settle();
    button(c, 'Show more guides')!.focus();
    await press(c, 'Show more guides');
    expect(document.activeElement).toBe(button(c, 'Try again'));
  });
  it('a next page that could not be read keeps what is shown, and Try again asks for that page', async () => {
    pageAnswer = (q) => (q.offset === 0 ? { guides: [rec('a')], more: true } : undefined);
    const c = show('player');
    await settle();
    await press(c, 'Show more guides');
    expect(titles(c)).toEqual(['Guide a']);
    expect(c.querySelector('.gcomm-note[role="alert"]')!.textContent).toContain('Could not load the Community guides.');
    expect(button(c, 'Show more guides')).toBeUndefined();
    pageAnswer = () => ({ guides: [rec('b')], more: false });
    await press(c, 'Try again');
    expect(asked[asked.length - 1]).toMatchObject({ offset: PAGE });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(c.querySelector('.gcomm-note')).toBeNull();
  });
  it('Newest asks again from the start', async () => {
    const c = show('player');
    await settle();
    await press(c, 'Newest');
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ sort: 'newest', offset: 0 });
    expect(button(c, 'Newest')!.getAttribute('aria-pressed')).toBe('true');
    expect(button(c, 'Most bookmarked')!.getAttribute('aria-pressed')).toBe('false');
    // Pressing the order already chosen asks nothing.
    await press(c, 'Newest');
    expect(asked.length).toBe(2);
  });
  it('a new question shows that it is loading, never "no guides match", until it is answered', async () => {
    let release: (p: CommunityPage) => void = () => {};
    pageAnswer = (q) => (q.sort === 'bookmarked' ? { guides: [], more: false } : new Promise<CommunityPage>((r) => { release = r; }));
    const c = show('player');
    await settle();
    expect(c.querySelector('.gtool-empty')).not.toBeNull();
    await press(c, 'Newest');
    expect(c.querySelector('.gtool-empty')).toBeNull();
    expect(c.querySelector('.gcomm-note[role="status"]')!.textContent).toBe('Loading the Community guides.');
    await act(async () => { release({ guides: [rec('n')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide n']);
  });
  it('typing in the search box asks once, after a pause, with the text', async () => {
    show('player');
    await settle();
    const before = asked.length;
    act(() => { setProps({ search: 'i' }); });
    act(() => { setProps({ search: 'im' }); });
    act(() => { setProps({ search: 'imp' }); });
    await settle(50);
    expect(asked.length).toBe(before);
    await settle(350);
    expect(asked.length).toBe(before + 1);
    expect(asked[asked.length - 1]).toMatchObject({ search: 'imp', offset: 0 });
  });
  it('text that cleans to the same search asks nothing', async () => {
    show('player');
    await settle();
    act(() => { setProps({ search: '   ' }); });
    await settle(350);
    expect(asked.length).toBe(1);
  });
  it('a slow answer to an old question never replaces the answer to a newer one', async () => {
    let releaseOld: (p: CommunityPage) => void = () => {};
    pageAnswer = (q) => (q.sort === 'bookmarked' ? new Promise<CommunityPage>((r) => { releaseOld = r; }) : { guides: [rec('new')], more: false });
    const c = show('player');
    await settle();
    await press(c, 'Newest');
    expect(titles(c)).toEqual(['Guide new']);
    await act(async () => { releaseOld({ guides: [rec('old')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide new']);
  });
  it('a list that could not be read says so and offers Try again', async () => {
    pageAnswer = () => undefined;
    const c = show('player');
    await settle();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Could not load the Community guides.');
    expect(c.querySelector('.gtool-empty')).toBeNull();
    pageAnswer = () => ({ guides: [rec('a')], more: false });
    await press(c, 'Try again');
    expect(asked[asked.length - 1]).toMatchObject({ offset: 0 });
    expect(titles(c)).toEqual(['Guide a']);
  });
  it('an empty answer invites the player to publish', async () => {
    pageAnswer = () => ({ guides: [], more: false });
    const c = show('player');
    await settle();
    expect(c.querySelector('.gtool-empty')!.textContent).toBe('No Community guides match. Publish one of yours from My guides to be the first.');
  });
  it('a list drawn twice by React in development still shows its answer', async () => {
    const c = show('player', {}, {}, true);
    await settle();
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(c.querySelector('.gcomm-note')).toBeNull();
    await press(c, 'Newest');
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(asked[asked.length - 1]).toMatchObject({ sort: 'newest', offset: 0 });
  });
});

describe('the Community pill while guides cannot be reached', () => {
  it('the server is never asked: the tab says guides are offline', async () => {
    for (const capability of ['off', 'offline', 'no-backend'] as const) {
      ui?.unmount();
      // Even handed a list: under this pill only the server's answer is ever drawn, and there is none.
      const c = show('player', { capability }, { guides: [asGuide('handed')] });
      await settle(350);
      expect(asked, capability).toEqual([]);
      expect(titles(c), capability).toEqual([]);
      expect(c.querySelector('.gtool-empty')!.textContent, capability).toBe('Guides are offline.');
      expect(c.textContent, capability).toContain('Guides are offline. You can read the built-in guides; writing, bookmarks and the Community list need a connection.');
      expect(c.textContent, capability).not.toContain('Loading the Community guides.');
      expect(c.querySelector('.gcomm-sort'), capability).toBeNull();
    }
  });
  it('the connection is lost with the pill open: the list goes, a late answer draws nothing, and it asks again when back', async () => {
    let release: (p: CommunityPage) => void = () => {};
    pageAnswer = () => new Promise<CommunityPage>((r) => { release = r; });
    const c = show('player');
    await settle();
    expect(asked.length).toBe(1);
    act(() => { useGuides.setState({ capability: 'offline' }); });
    expect(c.querySelector('.gtool-empty')!.textContent).toBe('Guides are offline.');
    expect(c.textContent).not.toContain('Loading the Community guides.');
    await act(async () => { release({ guides: [rec('late')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual([]);
    expect(asked.length).toBe(1);
    pageAnswer = () => ({ guides: [rec('a')], more: false });
    act(() => { useGuides.setState({ capability: 'on' }); });
    await settle();
    expect(asked.length).toBe(2);
    expect(titles(c)).toEqual(['Guide a']);
  });
});

describe('the Bookmarked pill', () => {
  it('draws the bookmarks it is handed, each with a Bookmarked button, only for the account that owns them', () => {
    const two = [asGuide('x'), asGuide('y')];
    const c = show('player', { tab: 'bookmarked', bookmarked: two }, { guides: two });
    expect(titles(c)).toEqual(['Guide x', 'Guide y']);
    expect(button(card(c, 'x'), 'Bookmarked')!.getAttribute('aria-pressed')).toBe('true');
    for (const t of ['Edit', 'Publish', 'Unpublish', 'Delete']) expect(button(card(c, 'x'), t), t).toBeUndefined();
    expect(asked).toEqual([]);
    ui!.unmount();
    const d = show('player', { tab: 'bookmarked', bookmarked: two, mineOwner: 'u-2' }, { guides: two });
    expect(titles(d)).toEqual([]);
  });
  it('removing a bookmark there takes the guide out of the store', async () => {
    const two = [asGuide('x'), asGuide('y')];
    const c = show('player', { tab: 'bookmarked', bookmarked: two }, { guides: two });
    await press(card(c, 'x'), 'Bookmarked');
    expect(bookmarks).toEqual([['x', false]]);
    expect(useGuides.getState().bookmarked.map((g) => g.rowId)).toEqual(['y']);
  });
  it('offline, the bookmarks can still be read, and none can be removed', () => {
    const two = [asGuide('x'), asGuide('y')];
    const c = show('player', { tab: 'bookmarked', bookmarked: two, capability: 'offline' }, { guides: two });
    expect(titles(c)).toEqual(['Guide x', 'Guide y']);
    expect(button(card(c, 'x'), 'Bookmarked')!.disabled).toBe(true);
  });
  it('with none, it says how to get one', () => {
    const c = show('player', { tab: 'bookmarked' });
    expect(c.querySelector('.gtool-empty')!.textContent).toBe('No bookmarks yet. Press Bookmark on a Community guide to keep it here and in your lobby rail.');
  });
  it('with some that the filters all hide, it says the filters hide them', () => {
    const c = show('player', { tab: 'bookmarked', bookmarked: [asGuide('x')] });
    expect(c.querySelector('.gtool-empty')!.textContent).toBe('No guides match these filters.');
  });
  it('a guest is told what signing in is for', () => {
    const c = show('guest', { tab: 'bookmarked' });
    expect(c.querySelector('.gtool-empty')!.textContent).toBe('Sign in to bookmark guides. Your bookmarks also show in the lobby rail.');
  });
});

describe('what the search box costs', () => {
  it('typing under Team Ascent or My guides does not draw the guide cards again', () => {
    const two = [asGuide('x'), asGuide('y')];
    for (const tab of ['team', 'mine'] as const) {
      ui?.unmount();
      const c = show('player', { tab, mine: two }, { guides: two });
      expect(titles(c)).toEqual(['Guide x', 'Guide y']);
      const drawn = cardDraws;
      expect(drawn, tab).toBeGreaterThan(0);
      act(() => { setProps({ search: 'g' }); });
      act(() => { setProps({ search: 'gu' }); });
      // The same two guides, in a new list, as the Compendium hands them over after a keystroke.
      act(() => { setProps({ search: 'gui', guides: [...two] }); });
      expect(titles(c), tab).toEqual(['Guide x', 'Guide y']);
      expect(cardDraws, tab).toBe(drawn);
      // The counter does count: a bookmark changes what that guide's card is told, and it is drawn again.
      act(() => { useGuides.setState({ bookmarked: [asGuide('x')] }); });
      expect(cardDraws, tab).toBeGreaterThan(drawn);
    }
  });
});

describe('the layout rule the Community rows depend on', () => {
  const css = readFileSync(join(__dirname, 'compendiumGuides.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the list box is a grid, and the sort row, a note and the Show more row each take a whole row of it, as the toolbar does', () => {
    const box = css.slice(css.indexOf('\n.bookguides {'), css.indexOf('}', css.indexOf('\n.bookguides {')));
    expect(box).toContain('display: grid');
    const at = css.indexOf('\n.gtool-empty, .gcomm-sort, .gcomm-note, .gcomm-more {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('grid-column: 1 / -1');
    expect(rule).not.toMatch(/color|background|border|font|cursor/);
  });
});
