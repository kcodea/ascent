// @vitest-environment jsdom
/**
 * THE COMPENDIUM GUIDES TAB WITH WRITING. Pins who sees which button (a guest, a player, a team member; a built-in
 * copy with no server row; an offline game), that New guide / Duplicate / Edit open the editor and hide the list,
 * the Team Ascent / My guides pills, the kept-draft Resume bar, the team-only import, and the rail's edit request.
 *
 * It also pins what the editor needs from its host: the device keeps ONE unsaved guide, so a second editor never
 * opens while one is waiting; an empty kept guide is not offered; Resume hands the editor the kept guide as it was
 * read; the editor closes when the account changes; and one open editor is never swapped for another.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SETS } from '@game/content';
import type { GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import type { GuideDraftInput, GuideWriteResult } from './guidesRemote';

const imports: GuideDraftInput[][] = [];
let officialCalls = 0;
const OFFLINE: GuideWriteResult<GuideRecord> = { ok: false, code: 'offline' };
let saveAnswer: GuideWriteResult<GuideRecord> = OFFLINE;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => { officialCalls++; return { state: 'offline' }; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  saveGuideRemote: async () => saveAnswer,
  deleteGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async (g: GuideDraftInput[]) => { imports.push(g); return { ok: true, value: { inserted: g.length, skipped: 0 } }; },
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));

const { CompendiumGuides } = await import('./CompendiumGuides');
const { GUIDES, canEditGuide, guidesFor } = await import('./guides');
const { emptyDraft } = await import('./guideDrafts');
const { loadLocalDraft, saveLocalDraft } = await import('./guideDraftStore');
const { requestGuideEdit, resetGuidesForTests, useGuides } = await import('./guidesStore');

const ROW = '11111111-1111-4111-8111-111111111111';
const serverList = GUIDES.map((g, i) => ({ ...g, rowId: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, revision: 1 }));
const mineGuide = { ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'My Sunmane', revision: 1 };

let ui: Mounted | null = null;
const prev = useGame.getState();
const as = (who: 'guest' | 'player' | 'team', patch: Partial<ReturnType<typeof useGuides.getState>> = {}): HTMLElement => {
  act(() => {
    useGame.setState({ account: { userId: who === 'guest' ? 'g-1' : 'u-1', email: who === 'guest' ? null : 'm@example.test', anonymous: who === 'guest', discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', list: serverList, team: who === 'team', mine: who === 'guest' ? [] : [mineGuide], ...patch });
  });
  const s = useGuides.getState();
  const shown = s.tab === 'mine' ? s.mine : guidesFor('set2', SETS.set2.tribes, s.list);
  ui = mount(<CompendiumGuides guides={shown} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" />);
  return ui.container;
};
const button = (c: Element, text: string): HTMLButtonElement | undefined => [...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = async (c: Element, text: string): Promise<void> => {
  const b = button(c, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const card = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`.bookguide[data-guide="${id}"]`)!;
const type = (el: Element, value: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
/** Make another account the signed-in one, as a sign-in or an account switch does. */
const becomeAccount = (userId: string | null, anonymous = false): void => {
  act(() => { useGame.setState({ account: { userId, email: anonymous || !userId ? null : 'other@example.test', anonymous, discriminator: null } }); });
};

/** A guide left unsaved on this device, with something in it. */
const kept = { ...emptyDraft('Mike'), title: 'Left behind', body: 'half', core: ['grim'] };
const RESUME_FIRST = 'Resume or discard your unsaved guide first.';

beforeEach(() => { localStorage.clear(); resetGuidesForTests(); imports.length = 0; officialCalls = 0; saveAnswer = OFFLINE; });
afterEach(() => { ui?.unmount(); ui = null; act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName, showBook: prev.showBook, accountPanelOpen: prev.accountPanelOpen }); }); });

describe('canEditGuide', () => {
  it('a Team Ascent guide: the team only, and only once it has a server row', () => {
    expect(canEditGuide(serverList[0]!, 'u-1', true)).toBe(true);
    expect(canEditGuide(serverList[0]!, 'u-1', false)).toBe(false);
    expect(canEditGuide(GUIDES[0]!, 'u-1', true)).toBe(false);
  });
  it('a player guide: its author only, never the team, never a guest', () => {
    expect(canEditGuide(mineGuide, 'u-1', false)).toBe(true);
    expect(canEditGuide(mineGuide, 'u-2', false)).toBe(false);
    expect(canEditGuide(mineGuide, 'u-2', true)).toBe(false);
    expect(canEditGuide(mineGuide, null, false)).toBe(false);
  });
});

describe('who sees which button', () => {
  it('every guide shows who it is by, and offers Duplicate', () => {
    const c = as('player');
    const first = card(c, serverList[0]!.id);
    expect(first.textContent).toContain('by Team Ascent');
    expect(button(first, 'Duplicate')).toBeDefined();
  });
  it('a player sees no Edit on a Team Ascent guide; a team member does', () => {
    expect(button(card(as('player'), serverList[0]!.id), 'Edit')).toBeUndefined();
    ui!.unmount();
    expect(button(card(as('team'), serverList[0]!.id), 'Edit')).toBeDefined();
  });
  it('a built-in copy with no server row has no Edit, even for the team', () => {
    const c = as('team', { source: 'bundled', list: GUIDES });
    expect(button(card(c, GUIDES[0]!.id), 'Edit')).toBeUndefined();
  });
  it('a player sees Edit on their own guide under My guides, with its Private badge', () => {
    const c = as('player', { tab: 'mine' });
    const own = card(c, ROW);
    expect(button(own, 'Edit')).toBeDefined();
    expect(own.textContent).toContain('Private');
    expect(own.textContent).toContain('by Mike');
  });
  it('a guide of mine that is not in the shown set says so', () => {
    const c = as('player', { tab: 'mine', mine: [{ ...mineGuide, sets: ['set3'] }] });
    expect(card(c, ROW).textContent).toContain('Not in this set');
  });
  it('My guides with nothing in it explains how to start, and still shows the toolbar', () => {
    const c = as('player', { tab: 'mine', mine: [] });
    expect(c.textContent).toContain('You have not written a guide yet.');
    expect(button(c, 'New guide')).toBeDefined();
  });
});

describe('starting to write', () => {
  it('New guide opens the editor and hides the list; closing the editor brings the list back', async () => {
    const c = as('player');
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.querySelector('.bookguide:not(.gedit)')).toBeNull();
    expect(c.querySelector<HTMLInputElement>('.gedit-byline')!.value).toBe('Mike');
    await press(c, 'Cancel');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelectorAll('.bookguide').length).toBeGreaterThan(0);
  });
  it('Duplicate opens the editor on a private copy named after the source', async () => {
    const c = as('player');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe(`${serverList[0]!.title} (copy)`);
    expect(c.querySelector('.gedit-byline')).not.toBeNull();
  });
  it('Edit opens the editor on that guide', async () => {
    const c = as('team');
    await press(card(c, serverList[1]!.id), 'Edit');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe(serverList[1]!.title);
  });
  it('a guest who presses New guide or Duplicate is asked to sign in; no editor opens', async () => {
    const c = as('guest');
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.textContent).toContain('Sign in to write your own guides.');
    await press(c, 'Create account');
    expect(useGame.getState().accountPanelOpen).toBe(true);
    expect(useGame.getState().showBook).toBe(false);
  });
  it('a guest who presses Duplicate is asked to sign in; no editor opens', async () => {
    const c = as('guest');
    expect(c.textContent).not.toContain('Sign in to write your own guides.');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.textContent).toContain('Sign in to write your own guides.');
  });
  it('when guides are not available, New guide and Duplicate are disabled and the tab says why', () => {
    for (const capability of ['unknown', 'off', 'offline', 'no-backend'] as const) {
      ui?.unmount();
      const c = as('player', { capability });
      expect(button(c, 'New guide')!.disabled, capability).toBe(true);
      expect(button(card(c, serverList[0]!.id), 'Duplicate')!.disabled, capability).toBe(true);
      expect(c.textContent, capability).toContain('Guides are offline.');
    }
  });
  it('the editor gets a scroll box of its own, so it opens at its top wherever the list was scrolled', async () => {
    const c = as('player');
    const list = c.querySelector('.bookguides');
    await press(c, 'New guide');
    const box = c.querySelector('.bookguides');
    expect(box).not.toBeNull();
    expect(box).not.toBe(list);
    expect(box!.querySelector('.gedit')).not.toBeNull();
  });
});

describe('the pills', () => {
  it('Team Ascent and My guides switch the store\'s pill; My guides shows how many', async () => {
    const c = as('player');
    expect(button(c, 'Team Ascent')!.getAttribute('aria-pressed')).toBe('true');
    expect(button(c, 'My guides (1)')).toBeDefined();
    await press(c, 'My guides (1)');
    expect(useGuides.getState().tab).toBe('mine');
  });
});

describe('the kept draft', () => {
  it('a draft left on this device is offered back; Resume opens it, Discard forgets it', async () => {
    saveLocalDraft('u-1', { ...emptyDraft('Mike'), title: 'Left behind', body: 'half', core: ['grim'] });
    const c = as('player');
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
    await press(c, 'Resume');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Left behind');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(c.textContent).not.toContain('You have an unsaved guide');
  });
  it('another account\'s draft is not offered', () => {
    saveLocalDraft('someone-else', { ...emptyDraft('X'), title: 'Not yours' });
    expect(as('player').textContent).not.toContain('You have an unsaved guide');
  });
  it('Discard forgets the kept guide on the device, not only on screen', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'Discard');
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a kept guide with nothing in it is not offered, is forgotten, and does not stop a new guide', async () => {
    // Only the "by" line (filled in for the author), a tagline and a tribe: no title, write-up, card or nickname.
    saveLocalDraft('u-1', { ...emptyDraft('Someone'), title: '   ', body: ' \n ', tagline: 'a line', tribes: ['beast'] });
    const c = as('player');
    expect(c.textContent).not.toContain('You have an unsaved guide');
    expect(loadLocalDraft('u-1')).toBeNull();
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.textContent).not.toContain(RESUME_FIRST);
  });
  it('a kept guide holding only a title, only a write-up, only a card or only a nickname row is offered', () => {
    for (const part of [{ title: 'T' }, { body: 'words' }, { core: ['grim'] }, { enablers: ['grim'] }, { aliases: [{ word: '', card: '' }] }]) {
      ui?.unmount();
      localStorage.clear();
      saveLocalDraft('u-1', { ...emptyDraft('Mike'), ...part });
      expect(as('player').textContent, JSON.stringify(part)).toContain('You have an unsaved guide');
      expect(loadLocalDraft('u-1'), JSON.stringify(part)).not.toBeNull();
    }
  });
  it('Resume hands the editor the kept guide as it was left: closing it unchanged leaves the guide on the device', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'Resume');
    await press(c, 'Cancel'); // nothing was changed, so the editor closes without asking
    expect(c.querySelector('.gedit')).toBeNull();
    expect(loadLocalDraft('u-1')).toEqual(kept);
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
  });
  it('a resumed guide that is saved leaves the device, and is no longer offered', async () => {
    saveLocalDraft('u-1', kept);
    saveAnswer = {
      ok: true,
      value: {
        id: ROW, slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: false, hidden: false, sets: ['set2'], tribes: [], pairsWith: [],
        iconCard: 'grim', title: 'Left behind', tagline: '', body: 'half', core: ['grim'], enablers: [], mentions: [], aliases: {}, forkedFrom: null,
        forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '',
      },
    };
    const c = as('player', { mine: [] });
    await press(c, 'Resume');
    await press(c, 'Save');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(c.textContent).not.toContain('You have an unsaved guide');
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Left behind']);
  });
});

describe('one unsaved guide at a time', () => {
  const blocked = (c: HTMLElement): void => {
    expect(c.querySelector('.gedit')).toBeNull();
    const bar = c.querySelector('.gtool-resume.gtool-resume-ask');
    expect(bar).not.toBeNull();
    const sentence = [...bar!.querySelectorAll('span')].find((s) => s.textContent === RESUME_FIRST);
    expect(sentence).toBeDefined();
    // The sentence sits before the bar's buttons.
    for (const b of bar!.querySelectorAll('button')) expect(sentence!.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(loadLocalDraft('u-1')).toEqual(kept); // and the waiting guide is untouched
  };
  it('the Resume bar does not ask for anything until a second guide is started', () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    expect(c.querySelector('.gtool-resume')).not.toBeNull();
    expect(c.querySelector('.gtool-resume-ask')).toBeNull();
    expect(c.textContent).not.toContain(RESUME_FIRST);
  });
  it('with an unsaved guide waiting, New guide opens no editor and points at the Resume bar', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'New guide');
    blocked(c);
  });
  it('with an unsaved guide waiting, Duplicate opens no editor and points at the Resume bar', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    blocked(c);
  });
  it('with an unsaved guide waiting, a team member\'s Edit opens no editor and points at the Resume bar', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('team');
    await press(card(c, serverList[0]!.id), 'Edit');
    blocked(c);
  });
  it('after Discard, New guide opens the editor', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'New guide');
    blocked(c);
    await press(c, 'Discard');
    expect(c.textContent).not.toContain(RESUME_FIRST);
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('');
  });
  it('Resume still opens the waiting guide after the bar has asked, and the bar stops asking', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'New guide');
    blocked(c);
    await press(c, 'Resume');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Left behind');
    await press(c, 'Cancel');
    expect(c.querySelector('.gtool-resume')).not.toBeNull();
    expect(c.querySelector('.gtool-resume-ask')).toBeNull();
  });
});

describe('the team-only import', () => {
  it('is offered only to the team, only while the built-in copies are showing, and sends the eleven guides', async () => {
    expect(button(as('player', { source: 'bundled', list: GUIDES }), 'Import built-in guides')).toBeUndefined();
    ui!.unmount();
    expect(button(as('team'), 'Import built-in guides')).toBeUndefined(); // the server already has guides
    ui!.unmount();
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.map((g) => g.slug)).toEqual(GUIDES.map((g) => g.id));
    expect(officialCalls).toBeGreaterThan(0); // it re-reads afterwards
    expect(c.textContent).toContain('Imported 11 guides.');
  });
  it('a team member cannot start a Team Ascent guide before the import', async () => {
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.textContent).not.toContain('Team Ascent guide');
  });
});

describe('the rail\'s edit request', () => {
  it('opens the editor on that guide and is used up', () => {
    act(() => { requestGuideEdit(ROW); });
    const c = as('player', { pendingEdit: ROW });
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('My Sunmane');
    expect(useGuides.getState().pendingEdit).toBeNull();
  });
  it('a request for a guide this account may not edit is dropped', () => {
    const c = as('player', { pendingEdit: serverList[0]!.rowId });
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().pendingEdit).toBeNull();
  });
  it('a request while an unsaved guide is waiting is used up, opens nothing, and points at the Resume bar', () => {
    saveLocalDraft('u-1', kept);
    const c = as('player', { pendingEdit: ROW });
    expect(useGuides.getState().pendingEdit).toBeNull();
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelector('.gtool-resume.gtool-resume-ask')!.textContent).toContain(RESUME_FIRST);
    expect(loadLocalDraft('u-1')).toEqual(kept);
  });
  it('a request that arrives while the editor is open is used up and ignored: the open guide stays as it is', async () => {
    const c = as('player');
    await press(c, 'New guide');
    const editor = c.querySelector('.gedit');
    type(c.querySelector('.gedit-title')!, 'Still here');
    act(() => { requestGuideEdit(ROW); });
    expect(useGuides.getState().pendingEdit).toBeNull();
    expect(c.querySelector('.gedit')).toBe(editor);
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Still here');
    expect(c.querySelector('.gtool-resume')).toBeNull();
  });
});

describe('the account changes while the editor is open', () => {
  it('the editor closes; what was typed is on the device under the account that typed it, and is not offered to the other account', async () => {
    const c = as('player');
    await press(c, 'New guide');
    type(c.querySelector('.gedit-title')!, 'Typed by one');
    becomeAccount('u-2');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(loadLocalDraft('u-1')?.title).toBe('Typed by one');
    expect(loadLocalDraft('u-2')).toBeNull();
    expect(c.textContent).not.toContain('You have an unsaved guide');
    expect(button(c, 'New guide')).toBeDefined(); // the list is back
  });
  it('the first account finds its guide offered back when it returns, and the editor stays closed until it asks', async () => {
    const c = as('player');
    await press(c, 'New guide');
    type(c.querySelector('.gedit-title')!, 'Typed by one');
    becomeAccount('u-2');
    becomeAccount('u-1');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.textContent).toContain('You have an unsaved guide: Typed by one');
    await press(c, 'Resume');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Typed by one');
  });
  it('signing out closes the editor and keeps what was typed for the account that typed it', async () => {
    const c = as('player');
    await press(c, 'New guide');
    type(c.querySelector('.gedit-title')!, 'Typed by one');
    becomeAccount(null, true);
    expect(c.querySelector('.gedit')).toBeNull();
    expect(loadLocalDraft('u-1')?.title).toBe('Typed by one');
    expect(c.textContent).not.toContain('You have an unsaved guide');
  });
  it('the same account turning into a guest closes the editor too', async () => {
    const c = as('player');
    await press(c, 'New guide');
    type(c.querySelector('.gedit-title')!, 'Typed by one');
    becomeAccount('u-1', true);
    expect(c.querySelector('.gedit')).toBeNull();
    expect(loadLocalDraft('u-1')?.title).toBe('Typed by one');
    expect(c.textContent).not.toContain('You have an unsaved guide'); // a guest is not offered a guide to write
  });
  it('an unsaved guide of the account that left is no longer offered, and stays on the device for it', () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
    becomeAccount('u-2');
    expect(c.textContent).not.toContain('You have an unsaved guide');
    expect(button(c, 'Resume')).toBeUndefined();
    expect(loadLocalDraft('u-1')).toEqual(kept);
  });
  it('a kept guide of the account that signs in is offered, with no editor open', () => {
    saveLocalDraft('u-2', { ...kept, title: 'Two left this' });
    const c = as('player');
    expect(c.textContent).not.toContain('You have an unsaved guide');
    becomeAccount('u-2');
    expect(c.textContent).toContain('You have an unsaved guide: Two left this');
    expect(c.querySelector('.gedit')).toBeNull();
  });
});

it('the tab carries no native tooltip', () => {
  expect(as('team').querySelector('[title]')).toBeNull();
});
