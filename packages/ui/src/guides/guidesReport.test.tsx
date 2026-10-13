// @vitest-environment jsdom
/**
 * REPORTING A GUIDE, AND THE TEAM'S HIDE / UNHIDE / DELETE, FROM A GUIDE'S CARD (step 4). Pins: a player is offered
 * Report on someone else's published guide; Report opens a small form on the card (a reason is needed, a note is
 * optional and limited); a sent report says thank you and cannot be sent twice; a refusal is a sentence on the card;
 * a guest is asked to sign in before any form opens. A team account is offered Hide (which asks first), Unhide (which
 * does not) and Delete on any player's guide, and never on a Team Ascent guide; a hide or a delete that worked asks
 * the Community list again, exactly once, from the first page, with the order the player chose; a hide whose answer
 * was lost is never told as a failure, and the sentence stays on the card.
 *
 * And what a keyboard player needs: the form takes focus on its first reason, Cancel hands focus back to Report, and
 * after a report is sent focus is on the sentence the card now shows (the button is switched off and cannot hold it).
 *
 * These tests never lay a page out, so the layout rules the report form depends on are pinned as stylesheet text.
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
const reports: Array<[string, string, string]> = [];
const hides: Array<[string, boolean]> = [];
const deleted: string[] = [];
let reportAnswer: () => GuideWriteResult<true>;
let hideAnswer: (hidden: boolean) => GuideWriteResult<GuideRecord>;
/** While set, a report does not answer until this resolves. */
let hold: Promise<void> | null = null;
/** How many times the guides were read again from the server (a hide reads them again). */
let reads = 0;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  // The server answers and has no Team Ascent rows; a read of the account's own lists cannot ask (`undefined`), so
  // the store keeps what each test set. A read after a hide therefore leaves the pill, the team flag and the lists.
  fetchOfficialGuides: async () => { reads++; return { state: 'on', guides: [] }; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchBookmarkedGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  communitySearch: (s: string) => s.trim().replace(/\s+/g, ' '),
  fetchCommunityPage: async (q: CommunityQuery) => { asked.push(q); return pageAnswer(q); },
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
  setPublishedRemote: async () => ({ ok: false, code: 'offline' }),
  bookmarkGuideRemote: async () => ({ ok: false, code: 'offline' }),
  reportGuideRemote: async (rowId: string, reason: string, note: string) => { reports.push([rowId, reason, note]); if (hold) await hold; return reportAnswer(); },
  setHiddenRemote: async (rowId: string, hidden: boolean) => { hides.push([rowId, hidden]); return hideAnswer(hidden); },
  deleteGuideRemote: async (rowId: string) => { deleted.push(rowId); return { ok: true, value: true }; },
  dismissReportsRemote: async () => ({ ok: true, value: 0 }),
  retagSetRemote: async () => ({ ok: true, value: 0 }),
  fetchOpenReports: async () => [],
  fetchHiddenGuides: async () => [],
  fetchGuideTags: async () => [],
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));

const { CompendiumGuides } = await import('./CompendiumGuides');
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
const asGuide = (id: string, patch: Partial<Guide> = {}): Guide =>
  ({ ...src, id, rowId: id, sets: ['set2'], official: false, published: true, authorId: 'u-9', byline: 'Ann', title: `Guide ${id}`, ...patch });

interface P { guides: readonly Guide[]; pillTribes: readonly Tribe[]; search: string }
function Host({ first }: { first: P }): JSX.Element {
  const [p] = useState(first);
  return <CompendiumGuides guides={p.guides} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" pillTribes={p.pillTribes} search={p.search} />;
}
let ui: Mounted | null = null;
const prev = useGame.getState();
/** Mount the tab on Community. `team` is the player u-1 with the team flag in the store. */
const show = (who: 'player' | 'guest' | 'team', patch: Partial<ReturnType<typeof useGuides.getState>> = {}, first: Partial<P> = {}, strict = false): HTMLElement => {
  const guest = who === 'guest';
  act(() => {
    useGame.setState({ account: { userId: guest ? 'g-1' : 'u-1', email: guest ? null : 'm@example.test', anonymous: guest, discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', team: who === 'team', mine: [], bookmarked: [], mineOwner: guest ? null : 'u-1', tab: 'community', ...patch });
  });
  setIdentity({ userId: guest ? 'g-1' : 'u-1', displayName: 'Mike', anonymous: guest, email: guest ? null : 'm@example.test' });
  const host = <Host first={{ guides: [], pillTribes: [], search: '', ...first }} />;
  ui = mount(strict ? <StrictMode>{host}</StrictMode> : host);
  return ui.container;
};
const settle = async (ms = 0): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const button = (el: Element, text: string): HTMLButtonElement | undefined => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = async (el: Element, text: string): Promise<void> => {
  const b = button(el, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const titles = (c: HTMLElement): string[] => [...c.querySelectorAll('.bookguide-title')].map((e) => e.textContent ?? '');
const card = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`.bookguide[data-guide="${id}"]`)!;
const badges = (el: Element): string[] => [...el.querySelectorAll('.bookguide-badge')].map((b) => b.textContent ?? '');
const type = (el: Element, value: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(async () => {
  localStorage.clear();
  resetGuidesForTests();
  asked.length = 0; reports.length = 0; hides.length = 0; deleted.length = 0;
  hold = null;
  pageAnswer = () => ({ guides: [rec('a'), rec('b')], more: false });
  reportAnswer = () => ({ ok: true, value: true });
  hideAnswer = (hidden) => ({ ok: true, value: rec('a', { hidden }) });
  // As the game does when an account lands: the store is told who is at the keyboard. A read asked for later (after a
  // hide) is then a refresh for the same account, not an account change that clears the pill and the team flag.
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  await loadGuides();
  reads = 0;
});
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName }); });
  setIdentity(prevIdentity);
});

describe('reporting a guide', () => {
  it("a player is offered Report on someone else's published guide, and not on their own", async () => {
    pageAnswer = () => ({ guides: [rec('a'), rec('mine', { authorId: 'u-1', byline: 'Mike' })], more: false });
    const c = show('player');
    await settle();
    expect(button(card(c, 'a'), 'Report')).toBeDefined();
    expect(button(card(c, 'mine'), 'Report')).toBeUndefined();
  });
  it('Report opens a form on the card; Send report is off until a reason is chosen; Cancel sends nothing', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    expect(card(c, 'a').textContent).toContain('Why are you reporting this guide?');
    for (const label of ['Offensive', 'Spam', 'Impersonation', 'Other']) expect(button(card(c, 'a'), label), label).toBeDefined();
    expect(button(card(c, 'a'), 'Send report')!.disabled).toBe(true);
    await press(card(c, 'a'), 'Cancel');
    expect(card(c, 'a').textContent).not.toContain('Why are you reporting this guide?');
    expect(reports).toEqual([]);
  });
  it('choosing a reason and sending calls the server with the reason and the note, then says thank you and cannot be sent twice', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    expect(button(card(c, 'a'), 'Spam')!.getAttribute('aria-pressed')).toBe('true');
    type(card(c, 'a').querySelector('.bookguide-ask input')!, 'A copy of my guide');
    await press(card(c, 'a'), 'Send report');
    expect(reports).toEqual([['a', 'spam', 'A copy of my guide']]);
    expect(card(c, 'a').querySelector('[role="status"]')!.textContent).toBe('Reported. Thank you.');
    expect(button(card(c, 'a'), 'Reported')!.disabled).toBe(true);
    expect(button(card(c, 'a'), 'Report')).toBeUndefined();
  });
  it('the note cannot be longer than the limit', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.maxLength).toBe(GUIDE_LIMITS.reportNote);
  });
  it('a refused report is a sentence on the card; "already reported" also turns the button off', async () => {
    reportAnswer = () => ({ ok: false, code: 'report_limit' });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Other');
    await press(card(c, 'a'), 'Send report');
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('That is a lot of reports. Try again tomorrow.');
    expect(button(card(c, 'a'), 'Report')).toBeDefined();
    reportAnswer = () => ({ ok: false, code: 'already_reported' });
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Other');
    await press(card(c, 'a'), 'Send report');
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('You already reported this guide.');
    expect(button(card(c, 'a'), 'Reported')!.disabled).toBe(true);
  });
  it('a guest who presses Report is asked to sign in, and no form opens', async () => {
    const c = show('guest');
    await settle();
    await press(card(c, 'a'), 'Report');
    expect(c.querySelector('.gtool-signin')).not.toBeNull();
    expect(card(c, 'a').textContent).not.toContain('Why are you reporting this guide?');
    expect(reports).toEqual([]);
  });
  it('focus goes to the first reason when the form opens, and back to Report on Cancel', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Offensive'));
    await press(card(c, 'a'), 'Cancel');
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Report'));
  });
  it('the form is a labelled group, its reasons are toggles, and its note has a name and a hint', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    const form = card(c, 'a').querySelector('.bookguide-ask')!;
    expect(form.getAttribute('role')).toBe('group');
    expect(form.getAttribute('aria-label')).toBe('Report this guide');
    for (const label of ['Offensive', 'Spam', 'Impersonation', 'Other']) expect(button(form, label)!.getAttribute('aria-pressed'), label).toBe('false');
    const input = form.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('A note for the team (optional)');
    expect(input.getAttribute('placeholder')).toBe('Anything the team should know (optional)');
    // One reason at a time.
    await press(form, 'Spam');
    await press(form, 'Other');
    expect(button(form, 'Spam')!.getAttribute('aria-pressed')).toBe('false');
    expect(button(form, 'Other')!.getAttribute('aria-pressed')).toBe('true');
    expect(button(form, 'Send report')!.disabled).toBe(false);
  });
  it('opening the form again starts it empty: no reason, no note', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    type(card(c, 'a').querySelector('.bookguide-ask input')!, 'half a thought');
    await press(card(c, 'a'), 'Cancel');
    await press(card(c, 'a'), 'Report');
    expect(button(card(c, 'a'), 'Spam')!.getAttribute('aria-pressed')).toBe('false');
    expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.value).toBe('');
    expect(button(card(c, 'a'), 'Send report')!.disabled).toBe(true);
  });
  it('after a report is sent focus is on the sentence the card shows, not lost to the page', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    await press(card(c, 'a'), 'Send report');
    // The button now reads Reported and is switched off: it cannot hold focus, so the sentence beside it does.
    expect(document.activeElement).toBe(card(c, 'a').querySelector('[role="status"]'));
  });
  it('after a refused report focus is back on Report; after "already reported" it is on the sentence', async () => {
    reportAnswer = () => ({ ok: false, code: 'report_limit' });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Other');
    await press(card(c, 'a'), 'Send report');
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Report'));
    reportAnswer = () => ({ ok: false, code: 'already_reported' });
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Other');
    await press(card(c, 'a'), 'Send report');
    expect(document.activeElement).toBe(card(c, 'a').querySelector('[role="alert"]'));
  });
  it('while a report is on its way the card is busy, the form is gone and nothing on the card can be pressed', async () => {
    let answer!: () => void;
    hold = new Promise<void>((r) => { answer = r; });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    await press(card(c, 'a'), 'Send report');
    expect(card(c, 'a').getAttribute('aria-busy')).toBe('true');
    expect(card(c, 'a').querySelector('.bookguide-ask')).toBeNull();
    for (const t of ['Bookmark', 'Report', 'Duplicate']) expect(button(card(c, 'a'), t)!.disabled, t).toBe(true);
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    expect(reports.length).toBe(1);
    expect(card(c, 'a').hasAttribute('aria-busy')).toBe(false);
    expect(button(card(c, 'a'), 'Reported')!.disabled).toBe(true);
    expect(button(card(c, 'a'), 'Bookmark')!.disabled).toBe(false);
  });
  it('a card drawn twice by React in development still comes back from a report', async () => {
    const c = show('player', {}, {}, true);
    await settle();
    await press(card(c, 'a'), 'Report');
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Offensive'));
    await press(card(c, 'a'), 'Spam');
    await press(card(c, 'a'), 'Send report');
    expect(reports).toEqual([['a', 'spam', '']]);
    expect(card(c, 'a').hasAttribute('aria-busy')).toBe(false);
    expect(card(c, 'a').querySelector('[role="status"]')!.textContent).toBe('Reported. Thank you.');
    expect(button(card(c, 'a'), 'Reported')!.disabled).toBe(true);
    expect(button(card(c, 'a'), 'Bookmark')!.disabled).toBe(false);
  });
  it('a report says thank you only when it was sent: with guides offline Send report cannot be pressed', async () => {
    const x = asGuide('x');
    const c = show('player', { tab: 'bookmarked', bookmarked: [x] }, { guides: [x] });
    await press(card(c, 'x'), 'Report');
    await press(card(c, 'x'), 'Spam');
    expect(button(card(c, 'x'), 'Send report')!.disabled).toBe(false);
    act(() => { useGuides.setState({ capability: 'offline' }); });
    expect(button(card(c, 'x'), 'Send report')!.disabled).toBe(true);
    expect(reports).toEqual([]);
    expect(card(c, 'x').querySelector('[role="status"]')).toBeNull();
  });
  it('what one account reported is not shown to the next account at the same screen', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    await press(card(c, 'a'), 'Send report');
    expect(button(card(c, 'a'), 'Reported')).toBeDefined();
    // Another account signs in and the store was not told (a missed read): the pill and the list stay as they were.
    act(() => {
      useGame.setState({ account: { userId: 'u-2', email: 'n@example.test', anonymous: false, discriminator: null } });
      useGuides.setState({ mineOwner: 'u-2' });
    });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(button(card(c, 'a'), 'Reported')).toBeUndefined();
    expect(button(card(c, 'a'), 'Report')!.disabled).toBe(false);
    expect(card(c, 'a').querySelector('[role="status"]')).toBeNull();
  });
  it('a hidden guide, a private guide and a Team Ascent guide offer no Report', () => {
    const three = [asGuide('h', { hidden: true }), asGuide('p', { published: false }), asGuide('o', { official: true, authorId: null, byline: 'Team Ascent' })];
    const c = show('player', { tab: 'bookmarked', bookmarked: three }, { guides: three });
    for (const id of ['h', 'p', 'o']) expect(button(card(c, id), 'Report'), id).toBeUndefined();
    // And a player is never shown the team's badge on someone else's guide.
    expect(badges(card(c, 'h'))).not.toContain('Hidden by Team Ascent');
  });
});

describe('the team on any player guide', () => {
  it('a team member is offered Hide and Delete on a player guide in Community; a player is offered neither', async () => {
    const c = show('team');
    await settle();
    expect(button(card(c, 'a'), 'Hide')).toBeDefined();
    expect(button(card(c, 'a'), 'Delete')).toBeDefined();
    ui!.unmount();
    const d = show('player');
    await settle();
    expect(button(card(d, 'a'), 'Hide')).toBeUndefined();
    expect(button(card(d, 'a'), 'Delete')).toBeUndefined();
  });
  it('Hide asks first; confirming calls the server and asks the list again', async () => {
    const c = show('team');
    await settle();
    const before = asked.length;
    await press(card(c, 'a'), 'Hide');
    expect(card(c, 'a').textContent).toContain('Hide this guide? Only its author and Team Ascent will be able to see it.');
    expect(hides).toEqual([]);
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle();
    expect(hides).toEqual([['a', true]]);
    expect(asked.length).toBe(before + 1);
    expect(asked[asked.length - 1]).toMatchObject({ offset: 0 });
  });
  it('a refused hide is a sentence on the card that does not claim it failed', async () => {
    hideAnswer = () => ({ ok: false, code: 'offline' });
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
  });
  it('the team deleting a player guide asks first, then removes it', async () => {
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Delete');
    expect(card(c, 'a').textContent).toContain('Delete this guide? It cannot be brought back.');
    await press(card(c, 'a'), 'Delete for good');
    await settle();
    expect(deleted).toEqual(['a']);
  });
  it('a Team Ascent guide offers the team no Hide', () => {
    const c = show('team', { tab: 'team' }, { guides: [{ ...asGuide('off'), official: true, byline: 'Team Ascent', authorId: null }] });
    expect(button(card(c, 'off'), 'Hide')).toBeUndefined();
  });
  it('a guide that is already hidden wears its badge for the team and offers Unhide, without asking', async () => {
    const hidden = { ...asGuide('h'), hidden: true };
    const c = show('team', { tab: 'bookmarked', bookmarked: [hidden] }, { guides: [hidden] });
    expect([...card(c, 'h').querySelectorAll('.bookguide-badge')].map((b) => b.textContent)).toContain('Hidden by Team Ascent');
    await press(card(c, 'h'), 'Unhide');
    expect(hides).toEqual([['h', false]]);
  });
  it('Hide puts focus on Cancel; Cancel hands it back to Hide and sends nothing', async () => {
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Hide');
    const ask = card(c, 'a').querySelector('.bookguide-ask')!;
    expect(ask.getAttribute('role')).toBe('group');
    expect(ask.getAttribute('aria-label')).toBe('Hide this guide');
    expect(document.activeElement).toBe(button(ask, 'Cancel'));
    await press(ask, 'Cancel');
    expect(card(c, 'a').querySelector('.bookguide-ask')).toBeNull();
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Hide'));
    expect(hides).toEqual([]);
  });
  it('a hide that worked reads the guides again and asks the list exactly once more, in the order the player chose', async () => {
    const c = show('team');
    await settle();
    expect(asked.length).toBe(1); // mounting asks once: the refresh does not fire on its own
    await press(c, 'Newest');
    expect(asked.length).toBe(2);
    // The server no longer lists the hidden guide.
    pageAnswer = () => ({ guides: [rec('b')], more: false });
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle(350);
    expect(hides).toEqual([['a', true]]);
    expect(reads).toBe(1);
    expect(asked.length).toBe(3);
    expect(asked[2]).toMatchObject({ sort: 'newest', offset: 0, search: '' });
    expect(button(c, 'Newest')!.getAttribute('aria-pressed')).toBe('true');
    expect(titles(c)).toEqual(['Guide b']);
  });
  it('a hide whose answer was lost reads the guides and asks the list again, and its sentence stays on the card', async () => {
    hideAnswer = () => ({ ok: false, code: 'offline' });
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle(350);
    expect(reads).toBe(1);
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: 0 });
    // The list was asked again and answered, and the card the sentence is on was never taken away meanwhile.
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
  });
  it('a hide the server refused asks for nothing again', async () => {
    hideAnswer = () => ({ ok: false, code: 'not_allowed' });
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle(350);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Only Team Ascent can do that.');
    expect(reads).toBe(0);
    expect(asked.length).toBe(1);
  });
  it('the guides stay on the screen while the list is asked again, and a list that could not be read again offers Try again from the start', async () => {
    const c = show('team');
    await settle();
    let release: (p: CommunityPage | undefined) => void = () => {};
    pageAnswer = () => new Promise<CommunityPage | undefined>((r) => { release = r; });
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    expect(asked.length).toBe(2);
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(c.textContent).not.toContain('Loading the Community guides.');
    await act(async () => { release(undefined); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(c.querySelector('.gcomm-note[role="alert"]')!.textContent).toContain('Could not load the Community guides.');
    pageAnswer = () => ({ guides: [rec('b')], more: false });
    await press(c, 'Try again');
    expect(asked.length).toBe(3);
    expect(asked[2]).toMatchObject({ offset: 0 });
    expect(titles(c)).toEqual(['Guide b']);
  });
  it('a delete that worked asks the list exactly once more', async () => {
    const c = show('team');
    await settle();
    pageAnswer = () => ({ guides: [rec('b')], more: false });
    await press(card(c, 'a'), 'Delete');
    await press(card(c, 'a'), 'Delete for good');
    await settle(350);
    expect(deleted).toEqual(['a']);
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: 0 });
    expect(titles(c)).toEqual(['Guide b']);
  });
  it('a delete made while the Community list is not shown costs it nothing: opening Community later asks once', async () => {
    const mine = asGuide('m', { authorId: 'u-1', byline: 'Mike', published: false });
    const c = show('team', { tab: 'mine', mine: [mine] }, { guides: [mine] });
    await press(card(c, 'm'), 'Delete');
    await press(card(c, 'm'), 'Delete for good');
    expect(deleted).toEqual(['m']);
    expect(asked).toEqual([]);
    await press(c, 'Community');
    await settle(350);
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatchObject({ offset: 0, sort: 'bookmarked' });
  });
  it('drawn twice by React in development, a hide still asks the list exactly once more and the card comes back', async () => {
    hideAnswer = () => ({ ok: false, code: 'offline' });
    const c = show('team', {}, {}, true);
    await settle();
    const before = asked.length;
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle(350);
    expect(hides).toEqual([['a', true]]);
    expect(asked.length).toBe(before + 1);
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    expect(card(c, 'a').hasAttribute('aria-busy')).toBe(false);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(button(card(c, 'a'), 'Hide')!.disabled).toBe(false);
  });
  it('a team member reports like any player, and is offered Bookmark, Report, Duplicate, Hide and Delete in that order', async () => {
    const c = show('team');
    await settle();
    expect([...card(c, 'a').querySelectorAll('.bookguide-actions button')].map((b) => b.textContent)).toEqual(['Bookmark', 'Report', 'Duplicate', 'Hide', 'Delete']);
    ui!.unmount();
    const d = show('player');
    await settle();
    expect([...card(d, 'a').querySelectorAll('.bookguide-actions button')].map((b) => b.textContent)).toEqual(['Bookmark', 'Report', 'Duplicate']);
  });
});

describe('the layout rules the report form depends on', () => {
  const strip = (file: string): string => readFileSync(join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (css: string, selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at + 1, css.indexOf('}', at) + 1);
  };
  it('the form is a row that wraps inside the card, and its text box takes a row of its own and can shrink', () => {
    const note = rule(strip('compendiumGuides.css'), '.gtool-note');
    expect(note).toContain('display: flex');
    expect(note).toContain('flex-wrap: wrap');
    const input = rule(strip('guideEditor.css'), '.gedit-input');
    expect(input).toContain('width: 100%');
    expect(input).toContain('min-width: 0');
    expect(input).toContain('box-sizing: border-box');
  });
  it('three or five buttons never trip the lone-button rule', () => {
    const css = strip('compendiumGuides.css');
    expect(rule(css, '.bookguide-actions')).toContain('grid-template-columns: repeat(2, auto)');
    expect(rule(css, '.bookguide-actions > :only-child')).toContain('grid-column: 1 / -1');
    expect(css).not.toMatch(/\.bookguide-actions > :(last|nth|first)/);
  });
});
