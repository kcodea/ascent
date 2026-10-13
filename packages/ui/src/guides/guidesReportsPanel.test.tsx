// @vitest-environment jsdom
/**
 * THE TEAM'S REPORTS PILL (step 4): open reports grouped by guide, hidden guides, and Carry guides over.
 *
 * Pins, through the real Compendium tab: the pill is drawn only for a team account, by the flag the store holds for
 * the account that is signed in, and only while guides are on; the panel is never mounted and no report is read for
 * anyone else; it goes the moment the account changes, whether or not the guides store was told. Open reports are
 * grouped by guide with a summary and the notes; Dismiss reports calls the server and reads the list again; the
 * guide's own card carries the team's Hide and Delete. Hidden guides carry Unhide and Delete, and Unhide works end to
 * end from here (the only place a player's hidden guide can be unhidden on screen). After any of these the lists are
 * read again and what is drawn stays until the new answer lands. Carry guides over checks first and writes nothing,
 * then sends the ids in batches, one after another, and stops at the first refusal.
 *
 * And, with the panel mounted on its own (so the host's unmount cannot hide a missing guard): an answer that lands
 * after the account changed is dropped, for the two lists, a dismiss, a check and a carry-over batch; an older answer
 * never overwrites a newer one; no further batch is sent for the next account or after the panel is gone; a double
 * press starts one dismiss and one run.
 *
 * These tests never lay a page out, so the layout rules the panel depends on are pinned as stylesheet text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, useState } from 'react';
import type { Tribe } from '@game/core';
import { SETS } from '@game/content';
import { GUIDE_LIMITS, type GuideRecord, type ReportReason } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import type { CommunityPage, GuideTagRow, GuideWriteResult, OpenReport } from './guidesRemote';

type Maybe<T> = T | Promise<T>;
let reportsAnswer: () => Maybe<OpenReport[] | undefined>;
let hiddenAnswer: () => Maybe<GuideRecord[] | undefined>;
let tagsAnswer: () => Maybe<GuideTagRow[] | undefined>;
const dismissed: string[] = [];
let dismissAnswer: () => Maybe<GuideWriteResult<number>>;
const retags: Array<[string, string[]]> = [];
let retagAnswer: (ids: string[]) => Maybe<GuideWriteResult<number>>;
const hides: Array<[string, boolean]> = [];
let hideAnswer: (hidden: boolean) => GuideWriteResult<GuideRecord>;
const deleted: string[] = [];
/** How often each read was asked. */
let reportsAsked = 0;
let hiddenAsked = 0;
let tagsAsked = 0;
/** How many times the guides were read again from the server (a hide reads them again), and the Team Ascent guides
 *  such a read answers (none: the store then keeps the list each test set). */
let reads = 0;
let officialAnswer: () => GuideRecord[];
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  // The server answers and has no Team Ascent rows; a read of the account's own lists cannot ask (`undefined`), so
  // the store keeps what each test set. A read after a hide therefore leaves the pill, the team flag and the lists.
  fetchOfficialGuides: async () => { reads++; return { state: 'on', guides: officialAnswer() }; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchBookmarkedGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  communitySearch: (s: string) => s.trim().replace(/\s+/g, ' '),
  fetchCommunityPage: async (): Promise<CommunityPage> => ({ guides: [], more: false }),
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
  setPublishedRemote: async () => ({ ok: false, code: 'offline' }),
  bookmarkGuideRemote: async () => ({ ok: false, code: 'offline' }),
  reportGuideRemote: async () => ({ ok: false, code: 'offline' }),
  setHiddenRemote: async (rowId: string, hidden: boolean) => { hides.push([rowId, hidden]); return hideAnswer(hidden); },
  deleteGuideRemote: async (rowId: string) => { deleted.push(rowId); return { ok: true, value: true }; },
  dismissReportsRemote: async (rowId: string) => { dismissed.push(rowId); return dismissAnswer(); },
  retagSetRemote: async (setId: string, ids: readonly string[]) => { retags.push([setId, [...ids]]); return retagAnswer([...ids]); },
  fetchOpenReports: async () => { reportsAsked++; return reportsAnswer(); },
  fetchHiddenGuides: async () => { hiddenAsked++; return hiddenAnswer(); },
  fetchGuideTags: async () => { tagsAsked++; return tagsAnswer(); },
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));
/** How many times a guide card has been drawn: the card works its tribe chips out once each time it renders. */
let cardDraws = 0;
vi.mock('./GuideParts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./GuideParts')>();
  return { ...real, guideChips: (...a: Parameters<typeof real.guideChips>) => { cardDraws++; return real.guideChips(...a); } };
});

const { CompendiumGuides } = await import('./CompendiumGuides');
const { ReportsPanel } = await import('./ReportsPanel');
const { GUIDES } = await import('./guides');
type Guide = (typeof GUIDES)[number];
const { loadGuides, resetGuidesForTests, useGuides } = await import('./guidesStore');
const { currentIdentity, setIdentity } = await import('../identity');
const prevIdentity = currentIdentity();

const src = GUIDES[0]!;
const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: 'u-9', byline: 'Ann', official: false, published: true, publishedAt: '2026-10-13T00:00:00Z', hidden: false,
  sets: ['set2'], tribes: [...src.tribes], pairsWith: [], iconCard: src.iconCard, title: `Guide ${id}`, tagline: '', body: 'Write-up.',
  core: [...src.core], enablers: [], mentions: [], aliases: {}, forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0,
  sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});
/** One open report of the guide `guideId`. */
const open = (id: string, guideId: string, reason: ReportReason, at: string, note = '', patch: Partial<GuideRecord> = {}): OpenReport =>
  ({ id, guideId, reason, note, createdAt: at, guide: rec(guideId, patch) });
const T1 = '2026-10-14T01:00:00Z';

interface P { guides: readonly Guide[]; pillTribes: readonly Tribe[]; search: string }
function Host({ first }: { first: P }): JSX.Element {
  const [p] = useState(first);
  return <CompendiumGuides guides={p.guides} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" pillTribes={p.pillTribes} search={p.search} />;
}
let ui: Mounted | null = null;
const prev = useGame.getState();
const U2 = { userId: 'u-2', email: 'k@example.test', anonymous: false, discriminator: null };
/** Mount the tab. `team` is the player u-1 with the team flag in the store. */
const show = (who: 'player' | 'team', patch: Partial<ReturnType<typeof useGuides.getState>> = {}, strict = false, guides: readonly Guide[] = []): HTMLElement => {
  act(() => {
    useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', team: who === 'team', mine: [], bookmarked: [], mineOwner: 'u-1', tab: 'community', ...patch });
  });
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  const host = <Host first={{ guides, pillTribes: [], search: '' }} />;
  ui = mount(strict ? <StrictMode>{host}</StrictMode> : host);
  return ui.container;
};
/** A stand-in card for the panel mounted on its own: the guide's id and title, nothing else. */
const plain = (g: Guide): JSX.Element => <article className="bookguide" data-guide={g.id}>{g.title}</article>;
/** Mount the panel on its own, for the account u-1. `again(n)` hands it a new `refreshKey`. */
const alone = (): { c: HTMLElement; again: (refreshKey: number) => void } => {
  act(() => { useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null }, playerName: 'Mike' }); });
  const tree = (refreshKey: number): JSX.Element => <div className="bookguides"><ReportsPanel setId="set2" refreshKey={refreshKey} renderCard={plain} root={null} /></div>;
  const m = mount(tree(0));
  ui = m;
  return { c: m.container, again: (refreshKey) => m.render(tree(refreshKey)) };
};
const settle = async (ms = 0): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const button = (el: Element, text: string): HTMLButtonElement | undefined => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = async (el: Element, text: string): Promise<void> => {
  const b = button(el, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
/** Two presses of the same button with nothing drawn in between, as a double click is. */
const pressTwice = async (el: Element, text: string): Promise<void> => {
  const b = button(el, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
};
const card = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`.bookguide[data-guide="${id}"]`)!;
const cards = (c: HTMLElement): Array<string | null> => [...c.querySelectorAll('.bookguide')].map((e) => e.getAttribute('data-guide'));
const sums = (c: HTMLElement): string[] => [...c.querySelectorAll('.greports-sum')].map((e) => e.textContent ?? '');
const heading = (c: HTMLElement, text: string): HTMLElement => [...c.querySelectorAll<HTMLElement>('h3')].find((h) => h.textContent === text)!;
const chooseSet = (c: HTMLElement, id: string): void => {
  const sel = c.querySelector<HTMLSelectElement>('select[aria-label="Set"]')!;
  act(() => { sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); });
};
/** An answer that does not come until `answer` is called. */
function later<T>(): { promise: Promise<T>; answer: (v: T) => Promise<void> } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, answer: async (v: T) => { await act(async () => { resolve(v); await new Promise((r) => setTimeout(r, 0)); }); } };
}
const nextAccount = (): void => { act(() => { useGame.setState({ account: U2 }); }); };
const tag = (id: string, patch: Partial<GuideTagRow> = {}): GuideTagRow =>
  ({ id, sets: ['set2'], tribes: [], pairsWith: [], core: [], enablers: [], mentions: [], ...patch });

beforeEach(async () => {
  localStorage.clear();
  resetGuidesForTests();
  dismissed.length = 0; retags.length = 0; hides.length = 0; deleted.length = 0;
  officialAnswer = () => [];
  reportsAnswer = () => [];
  hiddenAnswer = () => [];
  tagsAnswer = () => [];
  dismissAnswer = () => ({ ok: true, value: 1 });
  retagAnswer = (ids) => ({ ok: true, value: ids.length });
  hideAnswer = (hidden) => ({ ok: true, value: rec('h1', { hidden }) });
  // As the game does when an account lands: the store is told who is at the keyboard. A read asked for later (after a
  // hide) is then a refresh for the same account, not an account change that clears the pill and the team flag.
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  await loadGuides();
  reads = 0; reportsAsked = 0; hiddenAsked = 0; tagsAsked = 0; cardDraws = 0;
});
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName }); });
  setIdentity(prevIdentity);
});

describe('the Reports pill', () => {
  it('is drawn for a team account only, and cannot be pressed while guides are not on', async () => {
    expect(button(show('team', { tab: 'team' }), 'Reports')!.disabled).toBe(false);
    ui!.unmount();
    expect(button(show('player', { tab: 'team' }), 'Reports')).toBeUndefined();
    ui!.unmount();
    // Not on: drawn switched off, exactly as Bookmarked and Community are. Still the team's alone.
    const c = show('team', { tab: 'team', capability: 'offline' });
    for (const t of ['Bookmarked', 'Community', 'Reports']) expect(button(c, t)!.disabled, t).toBe(true);
    expect(button(c, 'Reports')!.className).toBe(button(c, 'Community')!.className);
    await press(c, 'Reports'); // a switched-off pill takes no press
    expect(useGuides.getState().tab).toBe('team');
    ui!.unmount();
    expect(button(show('player', { tab: 'team', capability: 'offline' }), 'Reports')).toBeUndefined();
  });
  it('is the fifth pill, after Community, and pressing it opens the panel and reads once', async () => {
    const c = show('team', { tab: 'team' });
    expect([...c.querySelectorAll('.gtool-pills button')].map((b) => b.textContent)).toEqual(['Team Ascent', 'My guides', 'Bookmarked', 'Community', 'Reports']);
    expect(button(c, 'Reports')!.getAttribute('aria-pressed')).toBe('false');
    expect(reportsAsked).toBe(0);
    await press(c, 'Reports');
    expect(useGuides.getState().tab).toBe('reports');
    expect(button(c, 'Reports')!.getAttribute('aria-pressed')).toBe('true');
    expect(c.textContent).toContain('Open reports');
    expect([reportsAsked, hiddenAsked, tagsAsked]).toEqual([1, 1, 0]);
  });
  it("is not drawn for the next account while the store still holds the last account's team flag", () => {
    const c = show('team', { tab: 'team' });
    expect(button(c, 'Reports')).toBeDefined();
    nextAccount(); // the game store's account changes and the guides store is not told (a missed read)
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1' });
    expect(button(c, 'Reports')).toBeUndefined();
  });
  it('a store left on Reports for an account that is not on the team shows Team Ascent instead, and asks for no reports', async () => {
    const c = show('player', { tab: 'reports' });
    await settle();
    expect(reportsAsked).toBe(0);
    expect(hiddenAsked).toBe(0);
    expect(c.textContent).not.toContain('Open reports');
    expect(useGuides.getState().tab).toBe('team');
  });
  it("a store left on Reports with the last account's team flag asks for no reports for the next account", async () => {
    act(() => { useGame.setState({ account: U2 }); });
    // Mounted for u-2 while the store still holds u-1's flag and pill.
    act(() => { useGuides.setState({ capability: 'on', source: 'server', team: true, mine: [], bookmarked: [], mineOwner: 'u-1', tab: 'reports' }); });
    ui = mount(<Host first={{ guides: [], pillTribes: [], search: '' }} />);
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([0, 0]);
    expect(ui.container.textContent).not.toContain('Open reports');
    expect(useGuides.getState().tab).toBe('team');
  });
  it('while guides are offline the panel is taken away and nothing is read; it comes back, and reads, when they are on again', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a private note')];
    const c = show('team', { tab: 'reports', capability: 'offline' });
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([0, 0]);
    expect(c.textContent).not.toContain('Open reports');
    expect(c.querySelector('.gtool-empty')!.textContent).toBe('Guides are offline.');
    expect(useGuides.getState().tab).toBe('reports');
    // The pill is still there, lit and switched off, so the tab still says which pill it is on.
    expect(button(c, 'Reports')!.disabled).toBe(true);
    expect(button(c, 'Reports')!.getAttribute('aria-pressed')).toBe('true');
    act(() => { useGuides.setState({ capability: 'on' }); });
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([1, 1]);
    expect(c.textContent).toContain('a private note');
  });
  it('a list handed in under the Reports pill is never drawn, with the panel or without it', async () => {
    const c = show('team', { tab: 'reports' }, false, [src]);
    await settle();
    expect(c.textContent).toContain('Open reports');
    expect(cards(c)).toEqual([]);
    act(() => { useGuides.setState({ capability: 'offline' }); });
    expect(c.textContent).not.toContain('Open reports');
    expect(cards(c)).toEqual([]);
    // The list is drawn under the pill it was handed in for.
    act(() => { useGuides.setState({ tab: 'team' }); });
    expect(cards(c)).toEqual([src.id]);
  });
  it('lists open reports grouped by guide, the most reported first, with a summary and the notes', async () => {
    reportsAnswer = () => [
      open('r1', 'a', 'spam', '2026-10-14T01:00:00Z', 'copy of mine'), open('r2', 'b', 'other', '2026-10-14T05:00:00Z'),
      open('r3', 'a', 'offensive', '2026-10-14T02:00:00Z'), open('r4', 'a', 'spam', '2026-10-14T03:00:00Z', 'again'),
    ];
    const c = show('team', { tab: 'reports' });
    await settle();
    const s = sums(c);
    expect(s[0]).toContain('3 reports: 2 Spam, 1 Offensive.');
    expect(s[0]).toContain('"again"');
    expect(s[0]).toContain('"copy of mine"');
    expect(s[1]).toContain('1 report: 1 Other.');
    expect(cards(c).slice(0, 2)).toEqual(['a', 'b']);
    expect(button(card(c, 'a'), 'Hide')).toBeDefined();
    expect(button(card(c, 'a'), 'Delete')).toBeDefined();
    // Each note is an element of its own (its own line: see the stylesheet pins), newest first.
    expect([...c.querySelectorAll('.greports-sum')[0]!.querySelectorAll('.greports-quote')].map((q) => q.textContent)).toEqual(['"again"', '"copy of mine"']);
  });
  it('a guide with more notes than are drawn says how many more there are, after the last one drawn', async () => {
    /** `n` reports of the guide `id`, each with a note, the later the newer. */
    const noted = (id: string, n: number): OpenReport[] =>
      Array.from({ length: n }, (_, i) => open(`${id}${i}`, id, 'spam', `2026-10-14T01:00:${String(i).padStart(2, '0')}Z`, `${id} note ${i}`));
    reportsAnswer = () => [...noted('a', 8), ...noted('b', 6), ...noted('c', 5), open('d0', 'd', 'other', T1)];
    const c = show('team', { tab: 'reports' });
    await settle();
    const group = (i: number): Element => c.querySelectorAll('.greports-sum')[i]!;
    const quotes = (i: number): Array<string | null> => [...group(i).querySelectorAll('.greports-quote:not(.greports-more)')].map((q) => q.textContent);
    const more = (i: number): Array<string | null> => [...group(i).querySelectorAll('.greports-more')].map((q) => q.textContent);
    expect(cards(c)).toEqual(['a', 'b', 'c', 'd']);
    expect(quotes(0)).toEqual(['"a note 7"', '"a note 6"', '"a note 5"', '"a note 4"', '"a note 3"']);
    expect(more(0)).toEqual(['and 3 more notes.']);
    expect(quotes(1).length).toBe(5);
    expect(more(1)).toEqual(['and 1 more note.']);
    // Five notes are all drawn, and a group with none says nothing about notes.
    expect(quotes(2).length).toBe(5);
    expect(more(2)).toEqual([]);
    expect(quotes(3)).toEqual([]);
    expect(more(3)).toEqual([]);
    // The line comes after the last note drawn and before the button, and is a line of its own as a note is (it
    // wears the note's class, which the stylesheet gives a whole row).
    const kids = [...group(0).children].map((k) => k.className || k.tagName);
    expect(kids).toEqual(['SPAN', 'greports-quote', 'greports-quote', 'greports-quote', 'greports-quote', 'greports-quote', 'greports-quote greports-more', 'gbtn']);
  });
  it('Dismiss reports calls the server for that guide and reads the list again', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', '2026-10-14T01:00:00Z')];
    const c = show('team', { tab: 'reports' });
    await settle();
    const before = reportsAsked;
    reportsAnswer = () => [];
    await press(c, 'Dismiss reports');
    await settle();
    expect(dismissed).toEqual(['a']);
    expect(reportsAsked).toBe(before + 1);
    expect(c.textContent).toContain('No open reports.');
  });
  it('after a dismiss the group stays on the screen until the new answer lands, with no loading line, and nothing can be dismissed twice', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)];
    const c = show('team', { tab: 'reports' });
    await settle();
    const again = later<OpenReport[] | undefined>();
    reportsAnswer = () => again.promise;
    await press(c.querySelectorAll('.greports-group')[0]!, 'Dismiss reports');
    expect(dismissed).toEqual(['a']);
    expect(sums(c).length).toBe(2);
    expect(cards(c)).toEqual(['a', 'b']);
    expect(c.textContent).not.toContain('Loading reports.');
    expect([...c.querySelectorAll('button')].filter((b) => b.textContent === 'Dismiss reports').every((b) => b.disabled)).toBe(true);
    await again.answer([open('r2', 'b', 'other', T1)]);
    expect(cards(c)).toEqual(['b']);
    expect(button(c, 'Dismiss reports')!.disabled).toBe(false);
  });
  it('a refused dismiss is a sentence, and the group stays', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', '2026-10-14T01:00:00Z')];
    dismissAnswer = () => ({ ok: false, code: 'not_allowed' });
    const c = show('team', { tab: 'reports' });
    await settle();
    const before = reportsAsked;
    await press(c, 'Dismiss reports');
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Only Team Ascent can do that.');
    expect(c.querySelectorAll('.greports-sum').length).toBe(1);
    expect(reportsAsked).toBe(before); // refused: nothing changed, nothing to read again
    expect(button(c, 'Dismiss reports')!.disabled).toBe(false);
  });
  it('a dismiss whose answer was lost, or could not be read, may have landed: it says to check and reads the list again', async () => {
    for (const [code, sentence] of [
      ['offline', 'Could not reach the server. Check again in a moment to see whether it changed.'],
      ['server', 'Something went wrong. Check again in a moment to see whether it changed.'],
    ] as const) {
      ui?.unmount();
      reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
      dismissAnswer = () => ({ ok: false, code });
      const c = show('team', { tab: 'reports' });
      await settle();
      const before = reportsAsked;
      await press(c, 'Dismiss reports');
      await settle();
      expect(c.querySelector('.greports-group [role="alert"]')!.textContent, code).toBe(sentence);
      expect(reportsAsked, code).toBe(before + 1);
      expect(sums(c).length, code).toBe(1);
    }
  });
  it('a dismiss answered with anything that is not a known refusal may have landed: it says to check and reads the list again', async () => {
    for (const code of ['guide_failed', 'guide_malformed', 'unavailable', 'something_new']) {
      ui?.unmount();
      reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
      dismissAnswer = () => ({ ok: false, code });
      const c = show('team', { tab: 'reports' });
      await settle();
      const before = reportsAsked;
      await press(c, 'Dismiss reports');
      await settle();
      expect(c.querySelector('.greports-group [role="alert"]')!.textContent, code).toBe('Something went wrong. Check again in a moment to see whether it changed.');
      expect(reportsAsked, code).toBe(before + 1);
      expect(button(c, 'Dismiss reports')!.disabled, code).toBe(false);
    }
    // A refusal the server is known to answer reads nothing again.
    for (const code of ['not_found', 'sign_in_required', 'unauthenticated']) {
      ui?.unmount();
      reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
      dismissAnswer = () => ({ ok: false, code });
      const c = show('team', { tab: 'reports' });
      await settle();
      const before = reportsAsked;
      await press(c, 'Dismiss reports');
      await settle();
      expect(c.querySelector('.greports-group [role="alert"]'), code).not.toBeNull();
      expect(reportsAsked, code).toBe(before);
    }
  });
  it('lists hidden guides, each with Unhide and Delete', async () => {
    hiddenAnswer = () => [rec('h1', { hidden: true }), rec('h2', { hidden: true })];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('Hidden guides');
    expect(button(card(c, 'h1'), 'Unhide')).toBeDefined();
    expect(button(card(c, 'h1'), 'Delete')).toBeDefined();
    expect([...card(c, 'h2').querySelectorAll('.bookguide-badge')].map((b) => b.textContent)).toContain('Hidden by Team Ascent');
  });
  it("a team member's own guide offers no Edit from the panel, as under Community", async () => {
    hiddenAnswer = () => [rec('h1', { hidden: true, authorId: 'u-1', byline: 'Mike' })];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect([...card(c, 'h1').querySelectorAll('.bookguide-actions button')].map((b) => b.textContent)).toEqual(['Duplicate', 'Unhide', 'Delete']);
  });
  it('Unhide on a hidden guide calls the server with false, reads the guides again, and the guide leaves the hidden list', async () => {
    hiddenAnswer = () => [rec('h1', { hidden: true }), rec('h2', { hidden: true })];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([1, 1]);
    hiddenAnswer = () => [rec('h2', { hidden: true })];
    await press(card(c, 'h1'), 'Unhide');
    await settle();
    expect(hides).toEqual([['h1', false]]);
    expect(reads).toBe(1); // the guides store read again
    expect([reportsAsked, hiddenAsked]).toEqual([2, 2]); // and so did the panel, once
    expect(cards(c)).toEqual(['h2']);
    hiddenAnswer = () => [];
    await press(card(c, 'h2'), 'Unhide');
    await settle();
    expect(hides).toEqual([['h1', false], ['h2', false]]);
    expect(c.textContent).toContain('No hidden guides.');
  });
  it('after an unhide the cards stay on the screen until the new answer lands, and a sentence on a card is kept', async () => {
    hiddenAnswer = () => [rec('h1', { hidden: true }), rec('h2', { hidden: true })];
    hideAnswer = () => ({ ok: false, code: 'offline' });
    const c = show('team', { tab: 'reports' });
    await settle();
    const again = later<GuideRecord[] | undefined>();
    hiddenAnswer = () => again.promise;
    await press(card(c, 'h1'), 'Unhide');
    expect(hiddenAsked).toBe(2);
    expect(cards(c)).toEqual(['h1', 'h2']);
    expect(c.textContent).not.toContain('Loading');
    expect(c.textContent).not.toContain('No hidden guides.');
    await again.answer([rec('h1', { hidden: true }), rec('h2', { hidden: true })]);
    expect(cards(c)).toEqual(['h1', 'h2']);
    expect(card(c, 'h1').querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
  });
  it('Hide on a reported guide reads the lists again: the guide leaves Open reports and is under Hidden guides, with Unhide', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)];
    hideAnswer = (hidden) => ({ ok: true, value: rec('a', { hidden }) });
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(cards(c)).toEqual(['a', 'b']);
    // As the server does it: hiding a guide closes its open reports, so only b's are still open.
    reportsAnswer = () => [open('r2', 'b', 'other', T1)];
    hiddenAnswer = () => [rec('a', { hidden: true })];
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle();
    expect(hides).toEqual([['a', true]]);
    expect([reportsAsked, hiddenAsked]).toEqual([2, 2]);
    expect(sums(c).length).toBe(1);
    expect([...c.querySelectorAll('.greports-group .bookguide')].map((e) => e.getAttribute('data-guide'))).toEqual(['b']);
    expect(cards(c)).toEqual(['b', 'a']); // a is drawn once, in the hidden list
    expect(button(card(c, 'a'), 'Unhide')).toBeDefined();
    expect(button(card(c, 'a'), 'Hide')).toBeUndefined();
  });
  it('Delete from the panel deletes the guide and reads the lists again', async () => {
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    const c = show('team', { tab: 'reports' });
    await settle();
    hiddenAnswer = () => [];
    await press(card(c, 'h1'), 'Delete');
    await press(card(c, 'h1'), 'Delete for good');
    await settle();
    expect(deleted).toEqual(['h1']);
    expect([reportsAsked, hiddenAsked]).toEqual([2, 2]);
    expect(c.textContent).toContain('No hidden guides.');
  });
  it('says so when there is nothing, and when the reports could not be read', async () => {
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('No open reports.');
    expect(c.textContent).toContain('No hidden guides.');
    ui!.unmount();
    reportsAnswer = () => undefined;
    const d = show('team', { tab: 'reports' });
    await settle();
    expect(d.querySelector('[role="alert"]')!.textContent).toContain('Could not load the reports.');
    reportsAnswer = () => [];
    await press(d, 'Try again');
    await settle();
    expect(d.textContent).toContain('No open reports.');
  });
  it('each list says it is loading until its first answer, and never after', async () => {
    const first = later<OpenReport[] | undefined>();
    reportsAnswer = () => first.promise;
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Loading reports.');
    expect([...c.querySelectorAll('.greports-row[role="status"]')].map((e) => e.textContent)).toEqual(['Loading reports.', 'Loading hidden guides.']);
    expect(c.textContent).not.toContain('No open reports.');
    expect(c.textContent).not.toContain('No hidden guides.');
    await first.answer([]);
    expect(c.textContent).not.toContain('Loading');
    expect(c.textContent).toContain('No open reports.');
    expect(c.textContent).toContain('No hidden guides.');
  });
  it('Try again on a hidden list that never loaded says it is loading again, and the list that did load says nothing of the kind', async () => {
    hiddenAnswer = () => undefined;
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('Could not load the hidden guides.');
    expect(c.textContent).not.toContain('Loading');
    const second = later<GuideRecord[] | undefined>();
    hiddenAnswer = () => second.promise;
    await press(c, 'Try again');
    expect([...c.querySelectorAll('.greports-row[role="status"]')].map((e) => e.textContent)).toEqual(['Loading hidden guides.']);
    expect(c.textContent).toContain('No open reports.');
    await second.answer([]);
    expect(c.textContent).not.toContain('Loading');
    expect(c.textContent).toContain('No hidden guides.');
  });
  it('when only one of the two lists could be read, the other is shown and the one that failed says so', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    hiddenAnswer = () => undefined;
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(sums(c).length).toBe(1);
    expect(c.textContent).not.toContain('Could not load the reports.');
    expect(c.textContent).not.toContain('No hidden guides.');
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Could not load the hidden guides.');
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    await press(c, 'Try again');
    await settle();
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(cards(c)).toEqual(['a', 'h1']);
    ui!.unmount();
    // The other way round.
    reportsAnswer = () => undefined;
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    const d = show('team', { tab: 'reports' });
    await settle();
    expect(d.querySelector('[role="alert"]')!.textContent).toContain('Could not load the reports.');
    expect(d.textContent).not.toContain('No open reports.');
    expect(d.textContent).not.toContain('Could not load the hidden guides.');
    expect(cards(d)).toEqual(['h1']);
  });
  it('a list that could not be read again keeps what it was showing', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a note')];
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    hideAnswer = () => ({ ok: false, code: 'offline' });
    const c = show('team', { tab: 'reports' });
    await settle();
    reportsAnswer = () => undefined;
    hiddenAnswer = () => undefined;
    await press(card(c, 'h1'), 'Unhide'); // its answer is lost: the lists are read again, and cannot be
    await settle();
    expect(cards(c)).toEqual(['a', 'h1']);
    expect(c.textContent).toContain('"a note"');
    expect(c.textContent).toContain('Could not load the reports.');
    expect(c.textContent).toContain('Could not load the hidden guides.');
  });
  it('the reports leave the screen the moment the account changes', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', '2026-10-14T01:00:00Z', 'a private note')];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('a private note');
    act(() => {
      useGame.setState({ account: { userId: 'u-2', email: 'k@example.test', anonymous: false, discriminator: null } });
      useGuides.setState({ team: false, tab: 'team', mineOwner: null, mine: [], bookmarked: [] });
    });
    expect(c.textContent).not.toContain('a private note');
    expect(c.textContent).not.toContain('Open reports');
  });
  it('the panel goes at once when the account changes and the guides store was not told, and nothing is read for the next account', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a private note')];
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('a private note');
    expect(cards(c)).toEqual(['a', 'h1']);
    const asked = [reportsAsked, hiddenAsked];
    act(() => { useGame.setState({ account: U2 }); });
    // No waiting: the very render the account changed in.
    expect(c.textContent).not.toContain('a private note');
    expect(c.textContent).not.toContain('Open reports');
    expect(c.textContent).not.toContain('Hidden guides');
    expect(cards(c)).toEqual([]);
    expect(button(c, 'Reports')).toBeUndefined();
    await settle();
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1', tab: 'team' }); // the flag was never u-2's
    expect([reportsAsked, hiddenAsked]).toEqual(asked);
  });
  it('one team account after another: the second is shown nothing the first read, and reads for itself', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a private note')];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('a private note');
    const second = later<OpenReport[] | undefined>();
    reportsAnswer = () => second.promise;
    // The second account is on the team too, and both stores change in one go: the pill never leaves Reports.
    act(() => {
      useGame.setState({ account: U2 });
      useGuides.setState({ mineOwner: 'u-2' });
    });
    expect(useGuides.getState().tab).toBe('reports');
    expect(c.textContent).not.toContain('a private note');
    expect(sums(c)).toEqual([]);
    expect(c.textContent).toContain('Loading reports.');
    expect(reportsAsked).toBe(2);
    await second.answer([]);
    expect(c.textContent).toContain('No open reports.');
  });
  it('nothing about reports is kept in the guides store or on the device', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a private note')];
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    tagsAnswer = () => [tag('fits1')];
    const c = show('team', { tab: 'reports' });
    await settle();
    await press(c, 'Check');
    await settle();
    expect(c.textContent).toContain('a private note');
    const held = JSON.stringify(useGuides.getState());
    expect(held).not.toContain('a private note');
    expect(held).not.toContain('"h1"');
    expect(held).not.toContain('fits1');
    expect(Object.keys(useGuides.getState()).sort()).toEqual(['bookmarked', 'capability', 'list', 'mine', 'mineOwner', 'pendingEdit', 'source', 'tab', 'team']);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('drawn twice by React in development, the panel still lists, and a dismiss is sent once', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    const c = show('team', { tab: 'reports' }, true);
    await settle();
    expect(sums(c).length).toBe(1);
    reportsAnswer = () => [];
    await press(c, 'Dismiss reports');
    await settle();
    expect(dismissed).toEqual(['a']);
    expect(c.textContent).toContain('No open reports.');
  });
  it('dismissing, checking and carrying over redraw no guide card', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)];
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    tagsAnswer = () => [tag('fits1'), tag('fits2')];
    dismissAnswer = () => ({ ok: false, code: 'not_allowed' });
    const c = show('team', { tab: 'reports' });
    await settle();
    const drawn = cardDraws;
    expect(drawn).toBeGreaterThan(0);
    await press(c, 'Dismiss reports'); // refused: a sentence, and the lists are not read again
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 2 guides');
    await settle();
    expect(c.textContent).toContain(`Carried over 2 guides to ${SETS.set3.name}.`);
    expect(cardDraws).toBe(drawn);
    // The counter does count: a card's own question is the card's own state.
    await press(card(c, 'h1'), 'Delete');
    expect(cardDraws).toBeGreaterThan(drawn);
  });
});

describe('the Reports pill, the fine print', () => {
  it('a refused dismiss is said in the group it is about, and in no other', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)];
    dismissAnswer = () => ({ ok: false, code: 'not_allowed' });
    const c = show('team', { tab: 'reports' });
    await settle();
    const groups = (): Element[] => [...c.querySelectorAll('.greports-group')];
    await press(groups()[1]!, 'Dismiss reports');
    expect(dismissed).toEqual(['b']);
    expect(groups()[1]!.querySelector('[role="alert"]')!.textContent).toBe('Only Team Ascent can do that.');
    expect(groups()[0]!.querySelector('[role="alert"]')).toBeNull();
    expect(c.querySelectorAll('[role="alert"]').length).toBe(1);
    // The next dismiss takes the old sentence away and says its own, in its own group.
    await press(groups()[0]!, 'Dismiss reports');
    expect(groups()[0]!.querySelector('[role="alert"]')!.textContent).toBe('Only Team Ascent can do that.');
    expect(groups()[1]!.querySelector('[role="alert"]')).toBeNull();
  });
  it('each of the four reasons has its own word in the summary', async () => {
    reportsAnswer = () => [open('r1', 'a', 'impersonation', T1), open('r2', 'b', 'offensive', T1), open('r3', 'd', 'spam', T1), open('r4', 'e', 'other', T1)];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(sums(c).map((s) => s.replace('Dismiss reports', ''))).toEqual(['1 report: 1 Impersonation.', '1 report: 1 Offensive.', '1 report: 1 Spam.', '1 report: 1 Other.']);
  });
  it('a list that was empty and cannot be read again says it could not be loaded, not that there is nothing', async () => {
    const { c, again } = alone();
    await settle();
    expect(c.textContent).toContain('No open reports.');
    expect(c.textContent).toContain('No hidden guides.');
    reportsAnswer = () => undefined;
    hiddenAnswer = () => undefined;
    again(1);
    await settle();
    expect(c.textContent).toContain('Could not load the reports.');
    expect(c.textContent).toContain('Could not load the hidden guides.');
    expect(c.textContent).not.toContain('No open reports.');
    expect(c.textContent).not.toContain('No hidden guides.');
  });
  it('the panel goes at once when the team flag is dropped, with nothing else changing', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a private note')];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('a private note');
    const asked = [reportsAsked, hiddenAsked];
    act(() => { useGuides.setState({ team: false }); });
    expect(c.textContent).not.toContain('a private note');
    expect(c.textContent).not.toContain('Open reports');
    expect(button(c, 'Reports')).toBeUndefined();
    await settle();
    expect(useGuides.getState()).toMatchObject({ team: false, mineOwner: 'u-1', tab: 'team' });
    expect([reportsAsked, hiddenAsked]).toEqual(asked);
  });
  it('a note that looks like markup is drawn as the text it is', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, '<b>bold</b> <img src=x onerror=alert(1)>')];
    const c = show('team', { tab: 'reports' });
    await settle();
    const quote = c.querySelector('.greports-quote')!;
    expect(quote.textContent).toBe('"<b>bold</b> <img src=x onerror=alert(1)>"');
    expect(quote.children.length).toBe(0);
    expect(c.querySelector('.greports-sum b, .greports-sum img')).toBeNull();
  });
  it('a read that throws is a read that failed: each list says so, and Try again reads again', async () => {
    reportsAnswer = () => { throw new Error('boom'); };
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.textContent).toContain('Could not load the reports.');
    expect(c.textContent).toContain('Could not load the hidden guides.');
    expect(c.textContent).not.toContain('Loading');
    reportsAnswer = () => [];
    await press(c, 'Try again');
    await settle();
    expect(c.textContent).toContain('No open reports.');
    expect(c.textContent).toContain('No hidden guides.');
  });
  it('a dismiss that throws may have landed: it says to check, the lists are read again, and the buttons come back', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    dismissAnswer = () => { throw new Error('boom'); };
    const c = show('team', { tab: 'reports' });
    await settle();
    const before = reportsAsked;
    await press(c, 'Dismiss reports');
    await settle();
    expect(c.querySelector('.greports-group [role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment to see whether it changed.');
    expect(reportsAsked).toBe(before + 1);
    expect(button(c, 'Dismiss reports')!.disabled).toBe(false);
  });
  it('a check that throws says the guides could not be read, and Check can be pressed again', async () => {
    tagsAnswer = () => { throw new Error('boom'); };
    const c = show('team', { tab: 'reports' });
    await settle();
    await press(c, 'Check');
    await settle();
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Could not read the guides. Try again.');
    expect(button(c, 'Check')!.disabled).toBe(false);
  });
  it('a batch that throws stops the run and says how far it got', async () => {
    tagsAnswer = () => [tag('fits1')];
    retagAnswer = () => { throw new Error('boom'); };
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 1 guide');
    await settle();
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment to see whether it changed.');
    expect(c.textContent).toContain('Carried over 0 of 1 so far. Press Check to continue.');
    expect(button(c, 'Check')!.disabled).toBe(false);
  });
  it('a card action that asks the lists again while a dismiss is being read back: the Dismiss buttons stay off until the newest read lands', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)];
    hideAnswer = (hidden) => ({ ok: true, value: rec('b', { hidden }) });
    const c = show('team', { tab: 'reports' });
    await settle();
    const waiting: Array<ReturnType<typeof later<OpenReport[] | undefined>>> = [];
    reportsAnswer = () => { const w = later<OpenReport[] | undefined>(); waiting.push(w); return w.promise; };
    const off = (): boolean[] => [...c.querySelectorAll<HTMLButtonElement>('button[data-dismiss]')].map((b) => b.disabled);
    const first = c.querySelectorAll('.greports-group')[0]!;
    button(first, 'Dismiss reports')!.focus();
    await press(first, 'Dismiss reports'); // a: dismissed, and the lists are asked again
    expect(dismissed).toEqual(['a']);
    expect(waiting.length).toBe(1);
    await press(card(c, 'b'), 'Hide');
    await press(card(c, 'b').querySelector('.bookguide-ask')!, 'Hide'); // b: hidden, and the lists are asked once more
    expect(waiting.length).toBe(2);
    (document.activeElement as HTMLElement | null)?.blur();
    // The older read lands first. It is not the newest: nothing is drawn from it, no button comes back, focus stays.
    await waiting[0]!.answer([open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)]);
    expect(off()).toEqual([true, true]);
    expect(document.activeElement).toBe(document.body);
    await waiting[1]!.answer([open('r2', 'b', 'other', T1)]);
    expect(cards(c)).toEqual(['b']);
    expect(off()).toEqual([false]);
    expect(document.activeElement).toBe(c.querySelector('button[data-dismiss="b"]'));
  });
});

describe('the Reports pill, by keyboard', () => {
  it('the three sections have headings that can take focus, and the set picker is named', async () => {
    const c = show('team', { tab: 'reports' });
    await settle();
    expect([...c.querySelectorAll('h3')].map((h) => [h.textContent, h.getAttribute('tabindex')])).toEqual([['Open reports', '-1'], ['Hidden guides', '-1'], ['Carry guides over', '-1']]);
    const sel = c.querySelector('select')!;
    expect(sel.getAttribute('aria-label')).toBe('Set');
    expect(sel.closest('label')!.textContent).toContain('Set');
    expect([...sel.querySelectorAll('option')].map((o) => [o.value, o.textContent])).toEqual(Object.values(SETS).map((s) => [s.id, s.name]));
    expect(sel.value).toBe('set2'); // the set the Compendium is showing
    expect(c.querySelector('[title]')).toBeNull();
  });
  it('after a dismiss removes a group, focus is on the Dismiss button of the group now in its place, and on the heading when none is left', async () => {
    const [a, b, d] = [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1), open('r3', 'd', 'other', T1)];
    reportsAnswer = () => [a, b, d];
    const c = show('team', { tab: 'reports' });
    await settle();
    const group = (i: number): Element => c.querySelectorAll('.greports-group')[i]!;
    const dismissOf = (id: string): HTMLButtonElement => c.querySelector<HTMLButtonElement>(`button[data-dismiss="${id}"]`)!;
    expect(cards(c)).toEqual(['a', 'b', 'd']);
    // The middle one goes: the one that was under it is now in its place.
    reportsAnswer = () => [a, d];
    dismissOf('b').focus();
    await press(group(1), 'Dismiss reports');
    await settle();
    expect(cards(c)).toEqual(['a', 'd']);
    expect(document.activeElement).toBe(dismissOf('d'));
    // The last one goes: the one above it.
    reportsAnswer = () => [a];
    await press(group(1), 'Dismiss reports');
    await settle();
    expect(document.activeElement).toBe(dismissOf('a'));
    // None left: the heading, not the page.
    reportsAnswer = () => [];
    await press(group(0), 'Dismiss reports');
    await settle();
    expect(dismissed).toEqual(['b', 'd', 'a']);
    expect(document.activeElement).toBe(heading(c, 'Open reports'));
  });
  it('each Dismiss button says which guide it is for', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1), open('r2', 'b', 'other', T1)];
    const c = show('team', { tab: 'reports' });
    await settle();
    expect([...c.querySelectorAll('button[data-dismiss]')].map((x) => x.getAttribute('aria-label'))).toEqual(['Dismiss reports of Guide a', 'Dismiss reports of Guide b']);
  });
  it('after a refused dismiss focus is on the button that was pressed; it is never pulled back from elsewhere', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    const answer = later<GuideWriteResult<number>>();
    dismissAnswer = () => answer.promise;
    const c = show('team', { tab: 'reports' });
    await settle();
    await press(c, 'Dismiss reports');
    (document.activeElement as HTMLElement | null)?.blur(); // a browser takes focus off a button that is switched off
    expect(document.activeElement).toBe(document.body);
    await answer.answer({ ok: false, code: 'not_allowed' });
    expect(document.activeElement).toBe(button(c, 'Dismiss reports'));
    // The player has moved on meanwhile: focus stays where they put it.
    const next = later<GuideWriteResult<number>>();
    dismissAnswer = () => next.promise;
    await press(c, 'Dismiss reports');
    const elsewhere = button(c, 'New guide')!;
    elsewhere.focus();
    await next.answer({ ok: false, code: 'not_allowed' });
    expect(document.activeElement).toBe(elsewhere);
  });
  it('Try again is taken away while the lists are read; focus goes back to it if it returns, or to its heading', async () => {
    reportsAnswer = () => undefined;
    const c = show('team', { tab: 'reports' });
    await settle();
    const second = later<OpenReport[] | undefined>();
    reportsAnswer = () => second.promise;
    button(c, 'Try again')!.focus();
    await press(c, 'Try again');
    expect(button(c, 'Try again')).toBeUndefined();
    expect(c.textContent).toContain('Loading reports.');
    expect(document.activeElement).toBe(document.body);
    await second.answer(undefined);
    expect(document.activeElement).toBe(button(c, 'Try again'));
    reportsAnswer = () => [];
    await press(c, 'Try again');
    await settle();
    expect(document.activeElement).toBe(heading(c, 'Open reports'));
  });
  it('after a check, and after a run, focus is back on Check', async () => {
    tagsAnswer = () => [tag('fits1')];
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    button(c, 'Check')!.focus();
    await press(c, 'Check');
    await settle();
    expect(document.activeElement).toBe(button(c, 'Check'));
    button(c, 'Carry over 1 guide')!.focus();
    await press(c, 'Carry over 1 guide');
    await settle();
    expect(c.textContent).toContain(`Carried over 1 guide to ${SETS.set3.name}.`);
    expect(document.activeElement).toBe(button(c, 'Check'));
  });
});

describe('Carry guides over', () => {
  it('says what it does, before anything is pressed', async () => {
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(c.querySelector('[role="group"][aria-label="Carry guides over"]')!.textContent)
      .toContain('When a new set goes live, add it to every guide whose cards and tribes are all in it. Guides that do not fit are left as they are.');
    expect(tagsAsked).toBe(0);
  });
  it('Check reads every guide and says how many carry over, stay behind and already have the set; nothing is written yet', async () => {
    tagsAnswer = () => [tag('fits1'), tag('fits2'), tag('has', { sets: ['set2', 'set3'] }), tag('stays', { core: ['no-such-card'] })];
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    expect(c.textContent).toContain(`2 guides carry over to ${SETS.set3.name}. 1 stays behind. 1 already has it.`);
    expect(retags).toEqual([]);
    expect(button(c, 'Carry over 2 guides')).toBeDefined();
  });
  it('the line a Check or a run answers with is brought into view, and an idle tool moves nothing', async () => {
    const seen: string[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: (o?: unknown) => void };
    const before = proto.scrollIntoView;
    proto.scrollIntoView = function scrollIntoView(this: Element, o?: unknown): void { seen.push(`${this.textContent ?? ''} ${JSON.stringify(o)}`); };
    try {
      tagsAnswer = () => [tag('fits1'), tag('fits2')];
      const c = show('team', { tab: 'reports' });
      await settle();
      expect(seen).toEqual([]);
      chooseSet(c, 'set3');
      await press(c, 'Check');
      await settle();
      expect(seen).toEqual([`2 guides carry over to ${SETS.set3.name}. 0 stay behind. 0 already have it. {"block":"nearest"}`]);
      await press(c, 'Carry over 2 guides');
      await settle();
      expect(seen[seen.length - 1]).toBe(`Carried over 2 guides to ${SETS.set3.name}. {"block":"nearest"}`);
      // Choosing another set puts the tool back to idle: nothing is scrolled for that.
      const n = seen.length;
      chooseSet(c, 'set2');
      await settle();
      expect(seen.length).toBe(n);
    } finally {
      if (before) proto.scrollIntoView = before; else delete proto.scrollIntoView;
    }
  });
  it('the result reads right for one guide and for many', async () => {
    tagsAnswer = () => [tag('fits1'), tag('has1', { sets: ['set3'] }), tag('has2', { sets: ['set3'] }), tag('stays1', { core: ['no-such-card'] }), tag('stays2', { tribes: ['no-such-tribe'] })];
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    expect(c.textContent).toContain(`1 guide carries over to ${SETS.set3.name}. 2 stay behind. 2 already have it.`);
    expect(button(c, 'Carry over 1 guide')).toBeDefined();
  });
  it('Carry over sends the ids in batches of the limit and reports the total', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    await settle();
    expect(retags.map((r) => [r[0], r[1].length])).toEqual([['set3', GUIDE_LIMITS.retagBatch], ['set3', 5]]);
    expect(retags.flatMap((r) => r[1])).toEqual(Array.from({ length: n }, (_, i) => `g${i}`));
    expect(c.textContent).toContain(`Carried over ${n} guides to ${SETS.set3.name}.`);
  });
  it("the done line says the server's number of guides changed, not how many ids were sent; the progress line counts ids sent", async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const waiting: Array<ReturnType<typeof later<GuideWriteResult<number>>>> = [];
    retagAnswer = () => { const w = later<GuideWriteResult<number>>(); waiting.push(w); return w.promise; };
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    // The server changed 3 of the first batch (the others had the set already, or are gone).
    await waiting[0]!.answer({ ok: true, value: 3 });
    expect(c.textContent).toContain(`Carried over ${GUIDE_LIMITS.retagBatch} of ${n}.`);
    await waiting[1]!.answer({ ok: true, value: 4 });
    expect(c.textContent).toContain(`Carried over 7 guides to ${SETS.set3.name}.`);
    expect(c.textContent).not.toContain(`Carried over ${n} guides`);
  });
  it('one guide changed reads as one; none changed says no guide needed it, never "Carried over 0 guides"', async () => {
    tagsAnswer = () => [tag('fits1'), tag('fits2')];
    retagAnswer = () => ({ ok: true, value: 1 });
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 2 guides');
    await settle();
    expect(c.textContent).toContain(`Carried over 1 guide to ${SETS.set3.name}.`);
    retagAnswer = () => ({ ok: true, value: 0 });
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 2 guides');
    await settle();
    expect([...c.querySelectorAll('.greports-row[role="status"]')].map((e) => e.textContent)).toEqual([`No guide needed carrying over to ${SETS.set3.name}.`]);
    expect(c.textContent).not.toContain('Carried over 0');
  });
  it('when a run ends the guides are read again, once, and the carried guides then show in the new set without a restart', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    // A Team Ascent guide the store holds, in Set 2 only.
    const held: Guide = { ...src, id: 'o1', rowId: 'o1', revision: 1, sets: ['set2'] };
    const c = show('team', { tab: 'reports', list: [held] });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    expect(reads).toBe(0);
    // What the server holds once the run has landed: the same row, at the same revision, now in Set 3 too.
    officialAnswer = () => [rec('o1', { official: true, authorId: null, byline: 'Team Ascent', sets: ['set2', 'set3'] })];
    await press(c, `Carry over ${n} guides`);
    await settle();
    expect(retags.length).toBe(2);
    expect(c.textContent).toContain(`Carried over ${n} guides to ${SETS.set3.name}.`);
    expect(reads).toBe(1);
    expect(useGuides.getState().list.map((g) => [g.rowId, [...g.sets]])).toEqual([['o1', ['set2', 'set3']]]);
  });
  it('a run that stopped after a batch had landed reads the guides again too; one that stopped before any had reads nothing', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    let call = 0;
    retagAnswer = (ids) => (++call === 2 ? { ok: false, code: 'offline' } : { ok: true, value: ids.length });
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    await settle();
    expect(c.textContent).toContain(`Carried over ${GUIDE_LIMITS.retagBatch} of ${n} so far. Press Check to continue.`);
    expect(reads).toBe(1);
    // Again, and this time the very first batch is refused: nothing landed, so there is nothing new to read.
    retagAnswer = () => ({ ok: false, code: 'not_allowed' });
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    await settle();
    expect(c.textContent).toContain(`Carried over 0 of ${n} so far. Press Check to continue.`);
    expect(reads).toBe(1);
  });
  it('a FIRST batch whose answer is lost, cannot be read, or is no known refusal may have landed: the guides are read again though the line says 0', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const held: Guide = { ...src, id: 'o1', rowId: 'o1', revision: 1, sets: ['set2'] };
    const c = show('team', { tab: 'reports', list: [held] });
    await settle();
    chooseSet(c, 'set3');
    // What the server holds if the batch did land: the same row, at the same revision, now in Set 3 too.
    officialAnswer = () => [rec('o1', { official: true, authorId: null, byline: 'Team Ascent', sets: ['set2', 'set3'] })];
    for (const [i, code] of ['offline', 'server', 'guide_failed', 'something_new'].entries()) {
      retags.length = 0;
      retagAnswer = () => ({ ok: false, code });
      await press(c, 'Check');
      await settle();
      await press(c, `Carry over ${n} guides`);
      await settle();
      expect(retags.length, code).toBe(1); // the run stopped at its first batch
      expect(c.textContent, code).toContain(`Carried over 0 of ${n} so far. Press Check to continue.`);
      expect(reads, code).toBe(i + 1);
    }
    // The read shows what the server holds: the guide is in the new set without a restart.
    expect(useGuides.getState().list.map((g) => [g.rowId, [...g.sets]])).toEqual([['o1', ['set2', 'set3']]]);
    // A refusal the server is known to answer wrote nothing: nothing is read again.
    for (const code of ['not_allowed', 'sign_in_required', 'unauthenticated']) {
      retagAnswer = () => ({ ok: false, code });
      await press(c, 'Check');
      await settle();
      await press(c, `Carry over ${n} guides`);
      await settle();
      expect(reads, code).toBe(4);
    }
  });
  it('a first batch that throws may have landed too: the guides are read again', async () => {
    tagsAnswer = () => [tag('fits1')];
    retagAnswer = () => { throw new Error('boom'); };
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 1 guide');
    await settle();
    expect(c.textContent).toContain('Carried over 0 of 1 so far. Press Check to continue.');
    expect(reads).toBe(1);
  });
  it('the batches go one after another, and the line says how far the run has got', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const waiting: Array<ReturnType<typeof later<GuideWriteResult<number>>>> = [];
    retagAnswer = () => { const w = later<GuideWriteResult<number>>(); waiting.push(w); return w.promise; };
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    expect(retags.length).toBe(1); // the second is not sent until the first is answered
    expect(c.textContent).toContain(`Carried over 0 of ${n}.`);
    // While a run is going neither Check nor the set can be changed.
    expect(button(c, 'Check')!.disabled).toBe(true);
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Set"]')!.disabled).toBe(true);
    await waiting[0]!.answer({ ok: true, value: GUIDE_LIMITS.retagBatch });
    expect(retags.length).toBe(2);
    expect(c.textContent).toContain(`Carried over ${GUIDE_LIMITS.retagBatch} of ${n}.`);
    await waiting[1]!.answer({ ok: true, value: 5 });
    expect(retags.length).toBe(2);
    expect(c.textContent).toContain(`Carried over ${n} guides to ${SETS.set3.name}.`);
    expect(button(c, 'Check')!.disabled).toBe(false);
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Set"]')!.disabled).toBe(false);
  });
  it('a batch that fails stops the run, says how far it got, and Check can be pressed again', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    let call = 0;
    retagAnswer = (ids) => (++call === 2 ? { ok: false, code: 'offline' } : { ok: true, value: ids.length });
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    await settle();
    expect(c.textContent).toContain(`Carried over ${GUIDE_LIMITS.retagBatch} of ${n} so far. Press Check to continue.`);
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Could not reach the server.');
    expect(button(c, 'Check')!.disabled).toBe(false);
  });
  it('the first refusal ends the run: no later batch is sent', async () => {
    const n = GUIDE_LIMITS.retagBatch * 2 + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    retagAnswer = () => ({ ok: false, code: 'not_allowed' });
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    await settle();
    expect(retags.length).toBe(1);
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Only Team Ascent can do that.');
    expect(c.textContent).toContain(`Carried over 0 of ${n} so far. Press Check to continue.`);
    expect([...c.querySelectorAll('button')].some((b) => /^Carry over \d/.test(b.textContent ?? ''))).toBe(false);
  });
  it('after a run that finished, and after one that stopped, Check reads every guide again', async () => {
    tagsAnswer = () => [tag('fits1'), tag('fits2')];
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    expect(tagsAsked).toBe(1);
    await press(c, 'Carry over 2 guides');
    await settle();
    expect(c.textContent).toContain(`Carried over 2 guides to ${SETS.set3.name}.`);
    // The server now holds the set on both.
    tagsAnswer = () => [tag('fits1', { sets: ['set2', 'set3'] }), tag('fits2', { sets: ['set2', 'set3'] }), tag('new')];
    await press(c, 'Check');
    await settle();
    expect(tagsAsked).toBe(2);
    expect(c.textContent).toContain(`1 guide carries over to ${SETS.set3.name}. 0 stay behind. 2 already have it.`);
    retagAnswer = () => ({ ok: false, code: 'offline' });
    await press(c, 'Carry over 1 guide');
    await settle();
    expect(c.textContent).toContain('Carried over 0 of 1 so far. Press Check to continue.');
    await press(c, 'Check');
    await settle();
    expect(tagsAsked).toBe(3);
    expect(c.textContent).not.toContain('so far');
  });
  it('choosing another set withdraws the result: nothing can be carried over to a set that was not checked', async () => {
    tagsAnswer = () => [tag('fits1')];
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    expect(button(c, 'Carry over 1 guide')).toBeDefined();
    chooseSet(c, 'set1');
    expect(button(c, 'Carry over 1 guide')).toBeUndefined();
    expect(c.textContent).not.toContain('carries over to');
    expect(retags).toEqual([]);
  });
  it('nothing to carry says so, and offers no button', async () => {
    tagsAnswer = () => [tag('has', { sets: ['set2', 'set3'] })];
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    expect(c.textContent).toContain(`No guide needs carrying over to ${SETS.set3.name}.`);
    expect([...c.querySelectorAll('button')].some((b) => /^Carry over \d/.test(b.textContent ?? ''))).toBe(false);
  });
  it('a read that fails says so', async () => {
    tagsAnswer = () => undefined;
    const c = show('team', { tab: 'reports' });
    await settle();
    await press(c, 'Check');
    await settle();
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Could not read the guides. Try again.');
  });
  it('the account changing in the middle of a run through the real tab: the run ends, and no batch is sent for the next account', async () => {
    const n = GUIDE_LIMITS.retagBatch + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const first = later<GuideWriteResult<number>>();
    retagAnswer = () => first.promise;
    const c = show('team', { tab: 'reports' });
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    expect(retags.length).toBe(1);
    nextAccount();
    expect(c.textContent).not.toContain('Carry guides over');
    await first.answer({ ok: true, value: GUIDE_LIMITS.retagBatch });
    await settle();
    expect(retags.length).toBe(1);
  });
});

describe("the panel's own guards, mounted on its own", () => {
  it('lists, with nothing else around it', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1, 'a note')];
    hiddenAnswer = () => [rec('h1', { hidden: true })];
    const { c } = alone();
    await settle();
    expect(sums(c).length).toBe(1);
    expect(cards(c)).toEqual(['a', 'h1']);
  });
  it('an answer to the two lists that lands after the account changed is dropped', async () => {
    const r = later<OpenReport[] | undefined>();
    const h = later<GuideRecord[] | undefined>();
    reportsAnswer = () => r.promise;
    hiddenAnswer = () => h.promise;
    const { c } = alone();
    await settle();
    nextAccount();
    await r.answer([open('r1', 'a', 'spam', T1, 'a private note')]);
    await h.answer([rec('h1', { hidden: true })]);
    expect(c.textContent).not.toContain('a private note');
    expect(sums(c)).toEqual([]);
    expect(cards(c)).toEqual([]);
    expect(c.textContent).not.toContain('No open reports.');
  });
  it('an older answer to the two lists never overwrites a newer one', async () => {
    const r1 = later<OpenReport[] | undefined>();
    const h1 = later<GuideRecord[] | undefined>();
    reportsAnswer = () => r1.promise;
    hiddenAnswer = () => h1.promise;
    const { c, again } = alone();
    await settle();
    const r2 = later<OpenReport[] | undefined>();
    const h2 = later<GuideRecord[] | undefined>();
    reportsAnswer = () => r2.promise;
    hiddenAnswer = () => h2.promise;
    again(1);
    expect([reportsAsked, hiddenAsked]).toEqual([2, 2]);
    await r2.answer([open('r2', 'b', 'other', T1)]);
    await h2.answer([rec('new', { hidden: true })]);
    expect(cards(c)).toEqual(['b', 'new']);
    await r1.answer([open('r1', 'a', 'spam', T1)]);
    await h1.answer([rec('old', { hidden: true })]);
    expect(cards(c)).toEqual(['b', 'new']);
  });
  it('the same refresh key asks nothing again, and each new one asks once', async () => {
    const { again } = alone();
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([1, 1]);
    again(0);
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([1, 1]);
    again(1);
    await settle();
    expect([reportsAsked, hiddenAsked]).toEqual([2, 2]);
  });
  it('a dismiss answered after the account changed sets nothing and reads nothing', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    const answer = later<GuideWriteResult<number>>();
    dismissAnswer = () => answer.promise;
    const { c } = alone();
    await settle();
    await press(c, 'Dismiss reports');
    expect(dismissed).toEqual(['a']);
    nextAccount();
    await answer.answer({ ok: false, code: 'offline' }); // for the account that asked, this reads the lists again
    await settle();
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(reportsAsked).toBe(1);
  });
  it('a dismiss answered after the panel is gone reads nothing', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    const answer = later<GuideWriteResult<number>>();
    dismissAnswer = () => answer.promise;
    const { c } = alone();
    await settle();
    await press(c, 'Dismiss reports');
    ui!.unmount(); ui = null;
    await answer.answer({ ok: true, value: 1 });
    await settle();
    expect(reportsAsked).toBe(1);
  });
  it('a double press of Dismiss reports sends one dismiss', async () => {
    reportsAnswer = () => [open('r1', 'a', 'spam', T1)];
    const { c } = alone();
    await settle();
    await pressTwice(c, 'Dismiss reports');
    await settle();
    expect(dismissed).toEqual(['a']);
  });
  it('a check answered after the account changed says nothing', async () => {
    const answer = later<GuideTagRow[] | undefined>();
    tagsAnswer = () => answer.promise;
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    nextAccount();
    await answer.answer([tag('fits1'), tag('fits2')]);
    expect(c.textContent).not.toContain('carry over to');
    expect([...c.querySelectorAll('button')].some((b) => /^Carry over \d/.test(b.textContent ?? ''))).toBe(false);
  });
  it('a double press of Check reads the guides once', async () => {
    tagsAnswer = () => [tag('fits1')];
    const { c } = alone();
    await settle();
    await pressTwice(c, 'Check');
    await settle();
    expect(tagsAsked).toBe(1);
  });
  it('a double press of Carry over starts one run', async () => {
    tagsAnswer = () => [tag('fits1'), tag('fits2')];
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await pressTwice(c, 'Carry over 2 guides');
    await settle();
    expect(retags).toEqual([['set3', ['fits1', 'fits2']]]);
    expect(c.textContent).toContain(`Carried over 2 guides to ${SETS.set3.name}.`);
  });
  it('the account changing in the middle of a run stops it without a word: no further batch is sent', async () => {
    const n = GUIDE_LIMITS.retagBatch * 2 + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const first = later<GuideWriteResult<number>>();
    retagAnswer = () => first.promise;
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    expect(retags.length).toBe(1);
    nextAccount();
    await first.answer({ ok: true, value: GUIDE_LIMITS.retagBatch });
    await settle();
    expect(retags.length).toBe(1);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.textContent).not.toContain('so far');
    expect(c.textContent).not.toContain(`Carried over ${n} guides`);
  });
  it('the account changing before a first batch whose answer is lost comes back: nothing is said, and the guides are not read again for the next account', async () => {
    tagsAnswer = () => [tag('fits1')];
    const first = later<GuideWriteResult<number>>();
    retagAnswer = () => first.promise;
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 1 guide');
    expect(retags.length).toBe(1);
    nextAccount();
    await first.answer({ ok: false, code: 'offline' });
    await settle();
    expect(reads).toBe(0);
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(c.textContent).not.toContain('so far');
  });
  it('the account changing after a batch has landed: no further batch, and the guides are not read again for the next account', async () => {
    const n = GUIDE_LIMITS.retagBatch * 2 + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const waiting: Array<ReturnType<typeof later<GuideWriteResult<number>>>> = [];
    retagAnswer = () => { const w = later<GuideWriteResult<number>>(); waiting.push(w); return w.promise; };
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    await waiting[0]!.answer({ ok: true, value: GUIDE_LIMITS.retagBatch });
    expect(retags.length).toBe(2);
    nextAccount();
    await waiting[1]!.answer({ ok: true, value: GUIDE_LIMITS.retagBatch });
    await settle();
    expect(retags.length).toBe(2);
    expect(reads).toBe(0);
    expect(c.textContent).not.toContain('so far');
  });
  it('the panel going in the middle of a run stops it: no further batch is sent', async () => {
    const n = GUIDE_LIMITS.retagBatch * 2 + 5;
    tagsAnswer = () => Array.from({ length: n }, (_, i) => tag(`g${i}`));
    const first = later<GuideWriteResult<number>>();
    retagAnswer = () => first.promise;
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, `Carry over ${n} guides`);
    expect(retags.length).toBe(1);
    ui!.unmount(); ui = null;
    await first.answer({ ok: true, value: GUIDE_LIMITS.retagBatch });
    await settle();
    expect(retags.length).toBe(1);
  });
  it('a carry-over only ever adds a set: every write names the chosen set and the ids the check found', async () => {
    tagsAnswer = () => [tag('fits1'), tag('has', { sets: ['set3'] }), tag('stays', { core: ['no-such-card'] })];
    const { c } = alone();
    await settle();
    chooseSet(c, 'set3');
    await press(c, 'Check');
    await settle();
    await press(c, 'Carry over 1 guide');
    await settle();
    expect(retags).toEqual([['set3', ['fits1']]]);
  });
});

describe('the layout rules the panel depends on', () => {
  const strip = (file: string): string => readFileSync(join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (css: string, selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at + 1, css.indexOf('}', at) + 1);
  };
  it("the panel's rows take the whole width of the list box, and a note is a line of its own that can wrap", () => {
    const css = strip('compendiumGuides.css');
    expect(rule(css, '.greports-head, .greports-row, .greports-group')).toContain('grid-column: 1 / -1');
    // A group is a guide's summary tied to its card: the small gap the note rows use, not the list's wide one.
    expect(rule(css, '.greports-group')).toContain('display: grid');
    expect(rule(css, '.greports-group')).toContain('row-gap: 10px');
    expect(rule(css, '.greports-group')).not.toContain('inherit');
    expect(rule(css, '.gtool-note')).toContain('gap: 10px');
    const quote = rule(css, '.greports-quote');
    expect(quote).toContain('flex: 1 1 100%');
    expect(quote).toContain('min-width: 0');
    expect(quote).toContain('overflow-wrap: anywhere');
    // No colour, radius or font size of its own, and no cursor.
    for (const sel of ['.greports-head, .greports-row, .greports-group', '.greports-group', '.greports-quote']) {
      expect(rule(css, sel), sel).not.toMatch(/color|radius|font-size|cursor/);
    }
  });
  it('the pills wrap, so a fifth one never pushes the toolbar wider than the list box', () => {
    const css = strip('compendiumGuides.css');
    expect(rule(css, '.gtool')).toContain('flex-wrap: wrap');
    expect(rule(css, '.gtool-pills, .gtool-actions')).toContain('flex-wrap: wrap');
  });
  it('the headings wear a heading class the Compendium stylesheet has, and the set picker the inline field the editor stylesheet has', async () => {
    expect(strip('../compendium.css')).toContain(':is(.gloss-grouphead, .wiki-grouphead) {');
    expect(rule(strip('guideEditor.css'), '.gedit-field-inline .gedit-input')).toContain('width: auto');
    const c = show('team', { tab: 'reports' });
    await settle();
    expect(heading(c, 'Open reports').className).toBe('gloss-grouphead greports-head');
    expect(c.querySelector('select')!.className).toBe('gedit-input');
    expect(c.querySelector('select')!.closest('label')!.className).toBe('gedit-field gedit-field-inline');
  });
});
