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
 * Since the first review: a refused report keeps what was typed and the form comes back with it; the team's buttons
 * are drawn only while the store holds the team flag for the account that is signed in; a lost answer to a hide or a
 * delete is never told as a failure and the read that follows never settles for an older one; a question whose offer
 * went does not come back by itself; typing a report redraws the form and not the card.
 *
 * Since the whole-branch review: Tab and Escape inside the report form never reach the game's own key listeners (Tab
 * there closes the Compendium, and the report with it), and Escape is Cancel; the team's card says whether a guide is
 * published or private; no answer that is not a known refusal is told as "it was not done", and each one reads the
 * lists again.
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
let deleteAnswer: () => GuideWriteResult<true>;
/** While set, a report does not answer until this resolves. */
let hold: Promise<void> | null = null;
/** While set, a hide does not answer until this resolves. */
let hideHold: Promise<void> | null = null;
/** How many times the guides were read again from the server (a hide reads them again). */
let reads = 0;
/** What a read of the account's own guides answers (`undefined`: could not ask, the store keeps what it holds), and,
 *  while set, what the NEXT such read waits on instead. */
let mineRead: GuideRecord[] | undefined;
let mineHold: Promise<GuideRecord[] | undefined> | null = null;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  // The server answers and has no Team Ascent rows; a read of the account's own lists cannot ask (`undefined`), so
  // the store keeps what each test set. A read after a hide therefore leaves the pill, the team flag and the lists.
  fetchOfficialGuides: async () => { reads++; return { state: 'on', guides: [] }; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => { if (mineHold) { const h = mineHold; mineHold = null; return h; } return mineRead; },
  fetchBookmarkedGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  communitySearch: (s: string) => s.trim().replace(/\s+/g, ' '),
  fetchCommunityPage: async (q: CommunityQuery) => { asked.push(q); return pageAnswer(q); },
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
  setPublishedRemote: async () => ({ ok: false, code: 'offline' }),
  bookmarkGuideRemote: async () => ({ ok: false, code: 'offline' }),
  reportGuideRemote: async (rowId: string, reason: string, note: string) => { reports.push([rowId, reason, note]); if (hold) await hold; return reportAnswer(); },
  setHiddenRemote: async (rowId: string, hidden: boolean) => { hides.push([rowId, hidden]); if (hideHold) await hideHold; return hideAnswer(hidden); },
  deleteGuideRemote: async (rowId: string) => { deleted.push(rowId); return deleteAnswer(); },
  dismissReportsRemote: async () => ({ ok: true, value: 0 }),
  retagSetRemote: async () => ({ ok: true, value: 0 }),
  fetchOpenReports: async () => [],
  fetchHiddenGuides: async () => [],
  fetchGuideTags: async () => [],
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));
/** How many times a guide card has been drawn: the card works its tribe chips out once each time it renders. */
let cardDraws = 0;
vi.mock('./GuideParts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./GuideParts')>();
  return { ...real, guideChips: (...a: Parameters<typeof real.guideChips>) => { cardDraws++; return real.guideChips(...a); } };
});
/** What the host last handed each guide's card (by guide id). The real card is drawn; this only looks on, so a test
 *  can call a handler the card itself would not (its button is switched off) and pin the host's own guard. */
type CardProps = Parameters<(typeof import('./CompendiumGuideCard'))['CompendiumGuideCard']>[0];
const handed = new Map<string, CardProps>();
vi.mock('./CompendiumGuideCard', async (importOriginal) => {
  const real = await importOriginal<typeof import('./CompendiumGuideCard')>();
  const { createElement } = await import('react');
  return { CompendiumGuideCard: (props: CardProps) => { handed.set(props.guide.id, props); return createElement(real.CompendiumGuideCard, props); } };
});

const { CompendiumGuides } = await import('./CompendiumGuides');
const { GUIDES } = await import('./guides');
type Guide = (typeof GUIDES)[number];
const { loadGuides, requestGuideEdit, resetGuidesForTests, useGuides } = await import('./guidesStore');
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

interface P { guides: readonly Guide[]; pillTribes: readonly Tribe[]; search: string; /** Draw the store's own guides, as the Compendium does under My guides. */ fromStore: boolean }
function Host({ first }: { first: P }): JSX.Element {
  const [p] = useState(first);
  const mine = useGuides((s) => s.mine);
  return <CompendiumGuides guides={p.fromStore ? mine : p.guides} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" pillTribes={p.pillTribes} search={p.search} />;
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
  const host = <Host first={{ guides: [], pillTribes: [], search: '', fromStore: false, ...first }} />;
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
const PAGE = GUIDE_LIMITS.communityPage;
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
  hold = null; hideHold = null; mineHold = null; mineRead = undefined;
  handed.clear();
  pageAnswer = () => ({ guides: [rec('a'), rec('b')], more: false });
  reportAnswer = () => ({ ok: true, value: true });
  hideAnswer = (hidden) => ({ ok: true, value: rec('a', { hidden }) });
  deleteAnswer = () => ({ ok: true, value: true });
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
  it('after a refused report focus is back on Send report (the form is back); after "already reported" it is on the sentence', async () => {
    // The answer takes a moment, as it does over a network: the form is taken away while the card waits.
    let answer!: () => void;
    hold = new Promise<void>((r) => { answer = r; });
    reportAnswer = () => ({ ok: false, code: 'report_limit' });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Other');
    await press(card(c, 'a'), 'Send report');
    expect(card(c, 'a').querySelector('.bookguide-ask')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    hold = null;
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Send report'));
    // Cancel still hands focus back to Report.
    await press(card(c, 'a'), 'Cancel');
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Report'));
    reportAnswer = () => ({ ok: false, code: 'already_reported' });
    await press(card(c, 'a'), 'Report');
    expect(document.activeElement).toBe(button(card(c, 'a'), 'Offensive')); // a form opened by Report starts on its first reason
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
  it('a refused report keeps what was typed: the form is back with the reason and the note, the sentence under it, and trying again is one press', async () => {
    for (const [code, sentence] of [
      ['offline', 'Could not reach the server. Try again in a moment; if it says you already reported this guide, it went through.'],
      ['report_limit', 'That is a lot of reports. Try again tomorrow.'],
      ['bad_report', 'Check the report.'],
      ['server', 'Something went wrong. Try again in a moment.'],
      ['guide_failed', 'Something went wrong. Try again in a moment.'],
      ['something_new', 'Something went wrong. Try again in a moment.'],
    ] as const) {
      ui?.unmount();
      reports.length = 0;
      // The answer takes a moment, as it does over a network: the form is really taken away, and comes back.
      let answer!: () => void;
      hold = new Promise<void>((r) => { answer = r; });
      reportAnswer = () => ({ ok: false, code });
      const c = show('player');
      await settle();
      await press(card(c, 'a'), 'Report');
      await press(card(c, 'a'), 'Impersonation');
      type(card(c, 'a').querySelector('.bookguide-ask input')!, 'Says it is by the team');
      await press(card(c, 'a'), 'Send report');
      expect(card(c, 'a').querySelector('.bookguide-ask'), code).toBeNull();
      await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
      hold = null;
      const form = card(c, 'a').querySelector('.bookguide-ask[role="group"]');
      expect(form, code).not.toBeNull();
      expect(form!.getAttribute('aria-label'), code).toBe('Report this guide');
      expect(button(form!, 'Impersonation')!.getAttribute('aria-pressed'), code).toBe('true');
      expect(form!.querySelector('input')!.value, code).toBe('Says it is by the team');
      expect(card(c, 'a').querySelector('[role="alert"]')!.textContent, code).toBe(sentence);
      expect(button(card(c, 'a'), 'Report')!.disabled, code).toBe(false);
      // The server can be reached now: one press sends the same report.
      reportAnswer = () => ({ ok: true, value: true });
      await press(form!, 'Send report');
      expect(reports, code).toEqual([['a', 'impersonation', 'Says it is by the team'], ['a', 'impersonation', 'Says it is by the team']]);
      expect(card(c, 'a').querySelector('[role="alert"]'), code).toBeNull();
      expect(card(c, 'a').querySelector('[role="status"]')!.textContent, code).toBe('Reported. Thank you.');
      expect(card(c, 'a').querySelector('.bookguide-ask[role="group"]'), code).toBeNull();
    }
  });
  it('a refused report that is then cancelled is forgotten: the form opens empty', async () => {
    reportAnswer = () => ({ ok: false, code: 'report_limit' });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    type(card(c, 'a').querySelector('.bookguide-ask input')!, 'half a thought');
    await press(card(c, 'a'), 'Send report');
    expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.value).toBe('half a thought');
    await press(card(c, 'a'), 'Cancel');
    expect(card(c, 'a').querySelector('.bookguide-ask[role="group"]')).toBeNull();
    await press(card(c, 'a'), 'Report');
    expect(button(card(c, 'a'), 'Spam')!.getAttribute('aria-pressed')).toBe('false');
    expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.value).toBe('');
  });
  it('a half-written report is forgotten when the player leaves the form for another action on the card', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    type(card(c, 'a').querySelector('.bookguide-ask input')!, 'half a thought');
    // Another action on the card: the form goes. (This bookmark is refused, which is beside the point.)
    await press(card(c, 'a'), 'Bookmark');
    expect(card(c, 'a').querySelector('.bookguide-ask[role="group"]')).toBeNull();
    await press(card(c, 'a'), 'Report');
    expect(button(card(c, 'a'), 'Spam')!.getAttribute('aria-pressed')).toBe('false');
    expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.value).toBe('');
    expect(button(card(c, 'a'), 'Send report')!.disabled).toBe(true);
    expect(reports).toEqual([]);
  });
  it('a half-written report is forgotten when the player leaves the form for another question on the card', async () => {
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    type(card(c, 'a').querySelector('.bookguide-ask input')!, 'half a thought');
    await press(card(c, 'a'), 'Hide'); // another question takes the form's place
    expect(card(c, 'a').textContent).toContain('Hide this guide?');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Cancel');
    await press(card(c, 'a'), 'Report');
    expect(button(card(c, 'a'), 'Spam')!.getAttribute('aria-pressed')).toBe('false');
    expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.value).toBe('');
    expect(reports).toEqual([]);
    expect(hides).toEqual([]);
  });
  it('focus is not pulled into a form that comes back after the player has moved on', async () => {
    let answer!: () => void;
    hold = new Promise<void>((r) => { answer = r; });
    reportAnswer = () => ({ ok: false, code: 'report_limit' });
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    await press(card(c, 'a'), 'Send report');
    const elsewhere = button(c, 'New guide')!;
    elsewhere.focus();
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    expect(button(card(c, 'a'), 'Send report')).toBeDefined();
    expect(document.activeElement).toBe(elsewhere);
  });
  it('choosing a reason and typing the note redraw the form, never the card', async () => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    const drawn = cardDraws;
    expect(drawn).toBeGreaterThan(0);
    const input = card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!;
    type(input, 'A');
    type(input, 'A c');
    type(input, 'A copy');
    await press(card(c, 'a'), 'Spam');
    await press(card(c, 'a'), 'Other');
    expect(input.value).toBe('A copy');
    expect(button(card(c, 'a'), 'Other')!.getAttribute('aria-pressed')).toBe('true');
    expect(cardDraws).toBe(drawn);
    // The counter does count: Cancel is the card's own state, and the card is drawn again.
    await press(card(c, 'a'), 'Cancel');
    expect(cardDraws).toBeGreaterThan(drawn);
  });
  it('the host never answers "sent" for a report it could not ask for', async () => {
    // The card's own Send report is switched off while guides cannot be written, so this line of the host cannot be
    // reached by a press. It is the second guard: the handler is called here as a card would call it.
    const x = asGuide('x');
    show('player', { tab: 'bookmarked', bookmarked: [x], capability: 'offline' }, { guides: [x] });
    let said: string | null = null;
    await act(async () => { said = await handed.get('x')!.onReport(x, 'spam', 'a note'); });
    expect(said).toBe('Could not reach the server. Try again in a moment; if it says you already reported this guide, it went through.');
    expect(reports).toEqual([]);
  });
  it('the sign-in line a guest reads after pressing Report names reporting', async () => {
    const c = show('guest');
    await settle();
    await press(card(c, 'a'), 'Report');
    expect(c.querySelector('.gtool-signin')!.textContent).toContain('Sign in to write, bookmark and report guides. It is free and takes a minute.');
  });
});

describe("the report form and the game's own keys", () => {
  /**
   * Press a key on `el`, as a browser does: the event starts there and travels up to the window, where the game
   * listens (Game.tsx: Tab opens and closes the Compendium, Escape closes it). Says whether it got that far, and
   * whether anything stopped what the browser would do with the key (for Tab: move focus).
   */
  const key = (el: Element, init: KeyboardEventInit): { reached: boolean; prevented: boolean } => {
    let reached = false;
    const onKey = (): void => { reached = true; };
    window.addEventListener('keydown', onKey);
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => { el.dispatchEvent(ev); });
    window.removeEventListener('keydown', onKey);
    return { reached, prevented: ev.defaultPrevented };
  };
  const openForm = async (): Promise<{ c: HTMLElement; form: HTMLElement; input: HTMLInputElement }> => {
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    const form = card(c, 'a').querySelector<HTMLElement>('.bookguide-ask')!;
    const input = form.querySelector('input')!;
    type(input, 'A copy of my guide');
    return { c, form, input };
  };
  it('the listener these tests stand in for does hear a key pressed outside the form', async () => {
    const { c } = await openForm();
    expect(key(button(card(c, 'a'), 'Duplicate')!, { key: 'Tab' })).toEqual({ reached: true, prevented: false });
    expect(key(button(card(c, 'a'), 'Duplicate')!, { key: 'Escape' })).toEqual({ reached: true, prevented: false });
  });
  it('Tab and Shift+Tab inside the form move focus as usual and never reach the window: the report is still there', async () => {
    const { c, form, input } = await openForm();
    const from: Array<[string, Element]> = [['the note', input], ['a reason', button(form, 'Other')!], ['the chosen reason', button(form, 'Spam')!], ['Send report', button(form, 'Send report')!], ['Cancel', button(form, 'Cancel')!]];
    for (const [name, el] of from) {
      for (const shiftKey of [false, true]) {
        // Not stopped on its way to the browser either: Tab still moves focus.
        expect(key(el, { key: 'Tab', shiftKey }), `${name} ${shiftKey ? 'Shift+Tab' : 'Tab'}`).toEqual({ reached: false, prevented: false });
      }
    }
    const still = card(c, 'a').querySelector<HTMLElement>('.bookguide-ask[role="group"]')!;
    expect(still.getAttribute('aria-label')).toBe('Report this guide');
    expect(still.querySelector('input')!.value).toBe('A copy of my guide');
    expect(button(still, 'Spam')!.getAttribute('aria-pressed')).toBe('true');
    expect(reports).toEqual([]);
  });
  it('Escape inside the form is Cancel: the form closes, what was typed is forgotten, focus is back on Report, and the key never reaches the window', async () => {
    for (const where of ['the note', 'a reason'] as const) {
      ui?.unmount();
      const { c, form, input } = await openForm();
      expect(key(where === 'the note' ? input : button(form, 'Other')!, { key: 'Escape' }), where).toEqual({ reached: false, prevented: false });
      expect(card(c, 'a').querySelector('.bookguide-ask'), where).toBeNull();
      expect(document.activeElement, where).toBe(button(card(c, 'a'), 'Report'));
      expect(reports, where).toEqual([]);
      // Forgotten, as after Cancel: the form opens empty.
      await press(card(c, 'a'), 'Report');
      expect(button(card(c, 'a'), 'Spam')!.getAttribute('aria-pressed'), where).toBe('false');
      expect(card(c, 'a').querySelector<HTMLInputElement>('.bookguide-ask input')!.value, where).toBe('');
    }
  });
  it('no other key is kept from the game', async () => {
    const { input, form } = await openForm();
    for (const k of ['a', 'Enter', 'ArrowDown', ' ']) {
      expect(key(input, { key: k }).reached, k).toBe(true);
      expect(key(button(form, 'Other')!, { key: k }).reached, k).toBe(true);
    }
    expect(input.value).toBe('A copy of my guide');
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
  it("the next account is offered none of the team's buttons while the store still holds the last account's team flag", async () => {
    const next = (): void => { act(() => { useGame.setState({ account: { userId: 'u-2', email: 'n@example.test', anonymous: false, discriminator: null } }); }); };
    // Community: Hide and Delete on a player's guide.
    const c = show('team');
    await settle();
    expect(button(card(c, 'a'), 'Hide')).toBeDefined();
    expect(button(card(c, 'a'), 'Delete')).toBeDefined();
    next(); // the game store's account changes and the guides store is not told (a missed read)
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1', tab: 'community' });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
    for (const t of ['Hide', 'Unhide', 'Delete']) expect(button(card(c, 'a'), t), t).toBeUndefined();
    expect(button(card(c, 'a'), 'Report')).toBeDefined(); // what any player is offered is still there
    ui!.unmount();
    // Team Ascent pill, built-in copies showing: Edit on a Team Ascent guide, and the import.
    const official = asGuide('off', { official: true, byline: 'Team Ascent', authorId: null });
    const d = show('team', { tab: 'team', source: 'bundled' }, { guides: [official] });
    expect(button(card(d, 'off'), 'Edit')).toBeDefined();
    expect(button(d, 'Import built-in guides')).toBeDefined();
    next();
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1' });
    expect(button(card(d, 'off'), 'Edit')).toBeUndefined();
    expect(button(d, 'Import built-in guides')).toBeUndefined();
    expect(button(card(d, 'off'), 'Duplicate')).toBeDefined();
  });
  it("the rail's edit request for a Team Ascent guide opens nothing for the next account while the store still holds the last account's team flag", () => {
    const official = asGuide('off', { official: true, byline: 'Team Ascent', authorId: null });
    // For the team account itself the request opens the editor.
    const c = show('team', { tab: 'team', list: [official] }, { guides: [official] });
    act(() => { requestGuideEdit('off'); });
    expect(c.querySelector('.gedit')).not.toBeNull();
    ui!.unmount();
    const d = show('team', { tab: 'team', list: [official] }, { guides: [official] });
    act(() => { useGame.setState({ account: { userId: 'u-2', email: 'n@example.test', anonymous: false, discriminator: null } }); });
    act(() => { requestGuideEdit('off'); });
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1', pendingEdit: null }); // the request was taken
    expect(d.querySelector('.gedit')).toBeNull();
    expect(titles(d)).toEqual(['Guide off']);
  });
  it('while guides cannot be written the team is offered neither Hide nor Delete on a player guide', () => {
    const x = asGuide('x');
    const c = show('team', { tab: 'bookmarked', bookmarked: [x], capability: 'offline' }, { guides: [x] });
    expect(titles(c)).toEqual(['Guide x']);
    for (const t of ['Hide', 'Unhide', 'Delete']) expect(button(card(c, 'x'), t), t).toBeUndefined();
    act(() => { useGuides.setState({ capability: 'on' }); });
    expect(button(card(c, 'x'), 'Hide')).toBeDefined();
    expect(button(card(c, 'x'), 'Delete')).toBeDefined();
  });
  it('the hide question goes when its offer goes, and does not come back by itself to take focus', async () => {
    const x = asGuide('x');
    const c = show('team', { tab: 'bookmarked', bookmarked: [x] }, { guides: [x] });
    await press(card(c, 'x'), 'Hide');
    expect(card(c, 'x').querySelector('.bookguide-ask[role="group"]')).not.toBeNull();
    act(() => { useGuides.setState({ capability: 'offline' }); });
    expect(card(c, 'x').querySelector('.bookguide-ask[role="group"]')).toBeNull();
    const elsewhere = button(c, 'Team Ascent')!;
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
    act(() => { useGuides.setState({ capability: 'on' }); });
    expect(button(card(c, 'x'), 'Hide')).toBeDefined();
    expect(card(c, 'x').querySelector('.bookguide-ask[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    expect(hides).toEqual([]);
  });
  it('a hide whose answer came and could not be read may have landed too: it says to check, reads the guides and asks the list again', async () => {
    hideAnswer = () => ({ ok: false, code: 'server' });
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle(350);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment to see whether it changed.');
    expect(reads).toBe(1);
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: 0 });
  });
  it("the team's delete whose answer was lost is not told as a failure: it says to check, reads the guides and asks the list again", async () => {
    deleteAnswer = () => ({ ok: false, code: 'offline' });
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Delete');
    await press(card(c, 'a'), 'Delete for good');
    await settle(350);
    expect(deleted).toEqual(['a']);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Check again in a moment to see whether it was deleted.');
    expect(reads).toBe(1);
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: 0 });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
  });
  it("the team's delete whose answer came and could not be read may have landed too: it says to check, reads the guides and asks the list again", async () => {
    deleteAnswer = () => ({ ok: false, code: 'server' });
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Delete');
    await press(card(c, 'a'), 'Delete for good');
    await settle(350);
    expect(deleted).toEqual(['a']);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment to see whether it was deleted.');
    expect(reads).toBe(1);
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: 0 });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']);
  });
  it("the team's delete answered with anything that is not a known refusal may have landed: it says to check, reads the guides and asks the list again", async () => {
    // `guide_failed`: the function's call to the database failed or lost its answer. `guide_malformed`: the write was
    // made and what came back could not be read. `something_new`: a code this build does not know.
    for (const code of ['guide_failed', 'guide_malformed', 'something_new', 'unavailable']) {
      ui?.unmount();
      asked.length = 0; deleted.length = 0; reads = 0;
      deleteAnswer = () => ({ ok: false, code });
      const c = show('team');
      await settle();
      await press(card(c, 'a'), 'Delete');
      await press(card(c, 'a'), 'Delete for good');
      await settle(350);
      expect(deleted, code).toEqual(['a']);
      expect(card(c, 'a').querySelector('[role="alert"]')!.textContent, code).toBe('Something went wrong. Check again in a moment to see whether it was deleted.');
      expect(reads, code).toBe(1);
      expect(asked.length, code).toBe(2);
      expect(asked[1], code).toMatchObject({ offset: 0 });
    }
  });
  it('a delete the server answered and refused reads and asks nothing again', async () => {
    for (const [code, sentence] of [
      ['not_allowed', 'You cannot change this guide. Duplicate it to make your own.'],
      ['sign_in_required', 'Sign in to write guides.'],
      ['unauthenticated', 'Sign in to write guides.'],
    ] as const) {
      ui?.unmount();
      asked.length = 0; reads = 0;
      deleteAnswer = () => ({ ok: false, code });
      const c = show('team');
      await settle();
      await press(card(c, 'a'), 'Delete');
      await press(card(c, 'a'), 'Delete for good');
      await settle(350);
      expect(card(c, 'a').querySelector('[role="alert"]')!.textContent, code).toBe(sentence);
      expect(reads, code).toBe(0);
      expect(asked.length, code).toBe(1);
    }
  });
  it('a hide answered with anything that is not a known refusal may have landed: it says to check, reads the guides and asks the list again', async () => {
    for (const code of ['guide_malformed', 'guide_failed', 'something_new', 'unavailable']) {
      ui?.unmount();
      asked.length = 0; hides.length = 0; reads = 0;
      hideAnswer = () => ({ ok: false, code });
      const c = show('team');
      await settle();
      await press(card(c, 'a'), 'Hide');
      await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
      await settle(350);
      expect(hides, code).toEqual([['a', true]]);
      expect(card(c, 'a').querySelector('[role="alert"]')!.textContent, code).toBe('Something went wrong. Check again in a moment to see whether it changed.');
      expect(reads, code).toBe(1);
      expect(asked.length, code).toBe(2);
    }
    // A refusal the server is known to answer still reads and asks nothing.
    for (const code of ['not_found', 'sign_in_required', 'unauthenticated']) {
      ui?.unmount();
      asked.length = 0; reads = 0;
      hideAnswer = () => ({ ok: false, code });
      const c = show('team');
      await settle();
      await press(card(c, 'a'), 'Hide');
      await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
      await settle(350);
      expect(card(c, 'a').querySelector('[role="alert"]'), code).not.toBeNull();
      expect(reads, code).toBe(0);
      expect(asked.length, code).toBe(1);
    }
  });
  it('an action that throws is never told as "nothing was changed": the card says to check again, and can be used again', async () => {
    hideAnswer = () => { throw new Error('boom'); };
    const c = show('team');
    await settle();
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide');
    await settle();
    expect(hides).toEqual([['a', true]]);
    expect(card(c, 'a').querySelector('[role="alert"]')!.textContent).toBe('Something went wrong. Check again in a moment.');
    expect(card(c, 'a').hasAttribute('aria-busy')).toBe(false);
    expect(button(card(c, 'a'), 'Hide')!.disabled).toBe(false);
  });
  it('the team is told whether a guide is published or private, under every pill; a player is told nothing of the kind', async () => {
    // Community, as the team: a published guide says so.
    const c = show('team');
    await settle();
    expect(badges(card(c, 'a'))).toEqual(['Published']);
    ui!.unmount();
    // The same list for a player: no badge.
    const d = show('player');
    await settle();
    expect(badges(card(d, 'a'))).toEqual([]);
    ui!.unmount();
    // A guide the team hid and its author then took back to private: the team reads both, so an Unhide is no surprise.
    const list = [asGuide('hp', { hidden: true, published: false }), asGuide('h', { hidden: true }), asGuide('p', { published: false })];
    const e = show('team', { tab: 'bookmarked', bookmarked: list }, { guides: list });
    expect(badges(card(e, 'hp'))).toEqual(['Hidden by Team Ascent', 'Private']);
    expect(badges(card(e, 'h'))).toEqual(['Hidden by Team Ascent', 'Published']);
    expect(badges(card(e, 'p'))).toEqual(['Private']);
    ui!.unmount();
    // A player is shown none of it on those same guides.
    const f = show('player', { tab: 'bookmarked', bookmarked: list }, { guides: list });
    for (const id of ['hp', 'h', 'p']) expect(badges(card(f, id)), id).toEqual([]);
  });
  it("a team member's own guide under My guides says Published or Private once, never twice", () => {
    const own = [
      asGuide('m1', { authorId: 'u-1', byline: 'Mike', published: false }),
      asGuide('m2', { authorId: 'u-1', byline: 'Mike', published: true }),
      asGuide('m3', { authorId: 'u-1', byline: 'Mike', published: true, hidden: true }),
      asGuide('m4', { authorId: 'u-1', byline: 'Mike', published: false, sets: ['set1'] }),
    ];
    const c = show('team', { tab: 'mine', mine: own }, { guides: own });
    expect(badges(card(c, 'm1'))).toEqual(['Private']);
    expect(badges(card(c, 'm2'))).toEqual(['Published']);
    expect(badges(card(c, 'm3'))).toEqual(['Hidden by Team Ascent', 'Published']);
    expect(badges(card(c, 'm4'))).toEqual(['Private', 'Not in this set']);
    ui!.unmount();
    // A player's own guides read as they did: a hidden one says only that it is hidden.
    const d = show('player', { tab: 'mine', mine: own }, { guides: own });
    expect(badges(card(d, 'm1'))).toEqual(['Private']);
    expect(badges(card(d, 'm2'))).toEqual(['Published']);
    expect(badges(card(d, 'm3'))).toEqual(['Hidden by Team Ascent']);
    expect(badges(card(d, 'm4'))).toEqual(['Private', 'Not in this set']);
  });
  it('the host never answers "done" for a hide it could not ask for', async () => {
    // As for a report: no press can reach this (the buttons go with the connection), so the handler is called as a
    // card would call it. Null would be read as "it worked".
    const x = asGuide('x');
    show('team', { tab: 'bookmarked', bookmarked: [x], capability: 'offline' }, { guides: [x] });
    let said: string | null = null;
    await act(async () => { said = await handed.get('x')!.onHide(x, true); });
    expect(said).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(hides).toEqual([]);
    expect(reads).toBe(0);
  });
  it('a hide that finishes while an older read is still on its way ends with the hidden guide on the screen', async () => {
    const m = asGuide('m', { authorId: 'u-1', byline: 'Mike' });
    const row = (hidden: boolean): GuideRecord => rec('m', { authorId: 'u-1', byline: 'Mike', hidden });
    hideAnswer = (hidden) => ({ ok: true, value: row(hidden) });
    const c = show('team', { tab: 'mine', mine: [m] }, { fromStore: true });
    expect(button(card(c, 'm'), 'Hide')).toBeDefined();
    // A read begins before the hide. It will answer what was true when it was asked: not hidden.
    let release: (g: GuideRecord[] | undefined) => void = () => {};
    mineHold = new Promise((r) => { release = r; });
    let older: Promise<void> = Promise.resolve();
    await act(async () => { older = loadGuides(); await new Promise((r) => setTimeout(r, 0)); });
    mineRead = [row(true)]; // what a read made after the hide finds
    await press(card(c, 'm'), 'Hide');
    await press(card(c, 'm').querySelector('.bookguide-ask')!, 'Hide');
    expect(hides).toEqual([['m', true]]);
    await act(async () => { release([row(false)]); await older; await new Promise((r) => setTimeout(r, 0)); });
    await settle();
    expect(button(card(c, 'm'), 'Hide')).toBeUndefined();
    expect(button(card(c, 'm'), 'Unhide')).toBeDefined();
    expect(badges(card(c, 'm'))).toContain('Hidden by Team Ascent');
  });
  it('a refresh that lands while the first page of a new order is on its way: one more request, and the newer answer is the one shown', async () => {
    const c = show('team');
    await settle();
    let answerHide!: () => void;
    hideHold = new Promise<void>((r) => { answerHide = r; });
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide'); // the hide is on its way
    const waiting: Array<(p: CommunityPage) => void> = [];
    pageAnswer = () => new Promise<CommunityPage>((r) => { waiting.push(r); });
    await press(c, 'Newest'); // the first page of a new question, on its way
    expect(asked.length).toBe(2);
    await act(async () => { answerHide(); await new Promise((r) => setTimeout(r, 0)); }); // the hide lands: the list is asked again
    expect(asked.length).toBe(3);
    expect(asked[2]).toMatchObject({ sort: 'newest', offset: 0 });
    // The newer answer lands first, then the older one: the older one changes nothing.
    await act(async () => { waiting[1]!({ guides: [rec('b')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide b']);
    await act(async () => { waiting[0]!({ guides: [rec('a'), rec('b')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide b']);
    expect(asked.length).toBe(3);
  });
  it('a refresh that lands while a next page is on its way: one list, the newer answer, and no guide twice', async () => {
    pageAnswer = () => ({ guides: [rec('a'), rec('b')], more: true });
    const c = show('team');
    await settle();
    let answerHide!: () => void;
    hideHold = new Promise<void>((r) => { answerHide = r; });
    await press(card(c, 'a'), 'Hide');
    await press(card(c, 'a').querySelector('.bookguide-ask')!, 'Hide'); // the hide is on its way
    const waiting: Array<(p: CommunityPage) => void> = [];
    pageAnswer = () => new Promise<CommunityPage>((r) => { waiting.push(r); });
    await press(c, 'Show more guides'); // the next page, on its way
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatchObject({ offset: PAGE });
    await act(async () => { answerHide(); await new Promise((r) => setTimeout(r, 0)); }); // the hide lands: the list is asked again
    expect(asked.length).toBe(3);
    expect(asked[2]).toMatchObject({ offset: 0 });
    expect(titles(c)).toEqual(['Guide a', 'Guide b']); // what is shown stays until the new answer lands
    await act(async () => { waiting[1]!({ guides: [rec('b'), rec('c')], more: true }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide b', 'Guide c']);
    // The next page that was asked for before the refresh lands late: it is not added to the new list.
    await act(async () => { waiting[0]!({ guides: [rec('c'), rec('d')], more: false }); await new Promise((r) => setTimeout(r, 0)); });
    expect(titles(c)).toEqual(['Guide b', 'Guide c']);
    expect(button(c, 'Show more guides')!.disabled).toBe(false);
    expect(asked.length).toBe(3);
  });
  it("a team member's own guide under My guides has one Delete among its five buttons", () => {
    const m = asGuide('m', { authorId: 'u-1', byline: 'Mike', published: false });
    const c = show('team', { tab: 'mine', mine: [m] }, { guides: [m] });
    expect([...card(c, 'm').querySelectorAll('.bookguide-actions button')].map((b) => b.textContent)).toEqual(['Edit', 'Duplicate', 'Publish', 'Hide', 'Delete']);
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
  it('the reason pills wear the pill class the Compendium stylesheet has, and it has a pressed style', async () => {
    const css = strip('../compendium.css');
    expect(rule(css, '.book-runetribe')).toContain('height');
    expect(rule(css, '.book-runetribe.on')).toContain('var(--c)'); // the pressed pill is lit in the colour the form hands it
    const c = show('player');
    await settle();
    await press(card(c, 'a'), 'Report');
    await press(card(c, 'a'), 'Spam');
    const form = card(c, 'a').querySelector('.bookguide-ask')!;
    expect(button(form, 'Spam')!.className).toBe('book-runetribe on');
    expect(button(form, 'Other')!.className).toBe('book-runetribe');
    expect(button(form, 'Spam')!.style.getPropertyValue('--c')).toBe('var(--ui-title)');
  });
  it('three or five buttons never trip the lone-button rule', () => {
    const css = strip('compendiumGuides.css');
    expect(rule(css, '.bookguide-actions')).toContain('grid-template-columns: repeat(2, auto)');
    expect(rule(css, '.bookguide-actions > :only-child')).toContain('grid-column: 1 / -1');
    expect(css).not.toMatch(/\.bookguide-actions > :(last|nth|first)/);
  });
});
