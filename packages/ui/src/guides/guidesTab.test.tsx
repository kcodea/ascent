// @vitest-environment jsdom
/**
 * THE COMPENDIUM GUIDES TAB WITH WRITING. Pins who sees which button (a guest, a player, a team member; a built-in
 * copy with no server row; an offline game), that New guide / Duplicate / Edit open the editor and hide the list,
 * the Team Ascent / My guides pills, the kept-draft Resume bar, the team-only import, and the rail's edit request.
 *
 * It also pins what the editor needs from its host: the device keeps ONE unsaved guide, so a second editor never
 * opens while one is waiting; an empty kept guide is not offered; Resume hands the editor the kept guide as it was
 * read; the editor closes when the account changes; and one open editor is never swapped for another.
 *
 * And what a player must be able to see and find: an ask (sign in; resume or discard first) is scrolled into view and
 * takes keyboard focus; the Resume bar's Discard asks before it deletes; a newly saved guide is shown under My guides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SETS } from '@game/content';
import { GUIDE_LIMITS, type GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import type { GuideDraftInput, GuideWriteResult } from './guidesRemote';

const imports: GuideDraftInput[][] = [];
type ImportAnswer = GuideWriteResult<{ inserted: number; skipped: number }>;
/** What the import answers. Null: it imports everything it was sent. */
let importAnswer: (() => ImportAnswer) | null = null;
let accounts = true;
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
  importBuiltInsRemote: async (g: GuideDraftInput[]): Promise<ImportAnswer> => {
    imports.push(g);
    return importAnswer ? importAnswer() : { ok: true, value: { inserted: g.length, skipped: 0 } };
  },
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => accounts }));

const { CompendiumGuides } = await import('./CompendiumGuides');
const { GUIDES, canEditGuide, guidesFor } = await import('./guides');
type Guide = (typeof GUIDES)[number];
const { emptyDraft } = await import('./guideDrafts');
const { clearLocalDraft, loadLocalDraft, saveLocalDraft } = await import('./guideDraftStore');
const { requestGuideEdit, resetGuidesForTests, useGuides } = await import('./guidesStore');
const { currentIdentity, setIdentity } = await import('../identity');
const prevIdentity = currentIdentity();

const ROW = '11111111-1111-4111-8111-111111111111';
const serverList = GUIDES.map((g, i) => ({ ...g, rowId: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, revision: 1 }));
const mineGuide = { ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'My Sunmane', revision: 1 };

let ui: Mounted | null = null;
const prev = useGame.getState();
const as = (who: 'guest' | 'player' | 'team', patch: Partial<ReturnType<typeof useGuides.getState>> = {}, guides?: readonly Guide[]): HTMLElement => {
  act(() => {
    useGame.setState({ account: { userId: who === 'guest' ? 'g-1' : 'u-1', email: who === 'guest' ? null : 'm@example.test', anonymous: who === 'guest', discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', list: serverList, team: who === 'team', mine: who === 'guest' ? [] : [mineGuide], mineOwner: who === 'guest' ? null : 'u-1', ...patch });
  });
  setIdentity({ userId: who === 'guest' ? 'g-1' : 'u-1', displayName: 'Mike', anonymous: who === 'guest', email: who === 'guest' ? null : 'm@example.test' });
  const s = useGuides.getState();
  const shown = guides ?? (s.tab === 'mine' ? s.mine : guidesFor('set2', SETS.set2.tribes, s.list));
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

/** The server's answer to a save: the guide as a row this player owns. */
const savedRow = (patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id: '22222222-2222-4222-8222-222222222222', slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: false, hidden: false, sets: ['set2'],
  tribes: [], pairsWith: [], iconCard: 'grim', title: 'Left behind', tagline: '', body: 'half', core: ['grim'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});

/** A guide left unsaved on this device, with something in it. */
const kept = { ...emptyDraft('Mike'), title: 'Left behind', body: 'half', core: ['grim'] };
const RESUME_FIRST = 'Resume or discard your unsaved guide first.';

beforeEach(() => { localStorage.clear(); resetGuidesForTests(); imports.length = 0; officialCalls = 0; saveAnswer = OFFLINE; importAnswer = null; accounts = true; });
afterEach(() => { ui?.unmount(); ui = null; setIdentity(prevIdentity); act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName, showBook: prev.showBook, accountPanelOpen: prev.accountPanelOpen }); }); });

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
  it('a card\'s Edit and Duplicate say which guide they act on, for a screen reader', () => {
    const first = card(as('team'), serverList[0]!.id);
    expect(button(first, 'Edit')!.getAttribute('aria-label')).toBe(`Edit ${serverList[0]!.title}`);
    expect(button(first, 'Duplicate')!.getAttribute('aria-label')).toBe(`Duplicate ${serverList[0]!.title}`);
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
  it('My guides with guides that the filters all hide says the filters hide them, not that none was written', () => {
    const c = as('player', { tab: 'mine' }, []);
    expect(button(c, 'My guides (1)')).toBeDefined();
    expect(c.textContent).toContain('No guides match these filters.');
    expect(c.textContent).not.toContain('You have not written a guide yet.');
  });
  it('Team Ascent with nothing to show says no guides match, even for a player who has written none', () => {
    const c = as('player', { mine: [] }, []);
    expect(c.textContent).toContain('No guides match these filters.');
    expect(c.textContent).not.toContain('You have not written a guide yet.');
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
      // Not known yet is not offline: nothing is said until the first read has answered.
      if (capability === 'unknown') expect(c.textContent, capability).not.toContain('Guides are offline.');
      else expect(c.textContent, capability).toContain('Guides are offline.');
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
    await press(c, 'Discard for good');
    expect(c.textContent).not.toContain('You have an unsaved guide');
  });
  it('another account\'s draft is not offered', () => {
    saveLocalDraft('someone-else', { ...emptyDraft('X'), title: 'Not yours' });
    expect(as('player').textContent).not.toContain('You have an unsaved guide');
  });
  it('Discard asks first: Keep it changes nothing, Discard for good forgets the guide on the device and the bar goes', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'Discard');
    expect(c.textContent).toContain('Discard this unsaved guide? It cannot be brought back.');
    expect(loadLocalDraft('u-1')).toEqual(kept);
    expect(document.activeElement).toBe(button(c, 'Keep it')); // the safe answer takes focus
    await press(c, 'Keep it');
    expect(c.textContent).not.toContain('Discard this unsaved guide?');
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
    expect(loadLocalDraft('u-1')).toEqual(kept);
    expect(document.activeElement).toBe(button(c, 'Discard'));
    await press(c, 'Discard');
    await press(c, 'Discard for good');
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(c.querySelector('.gtool-resume')).toBeNull();
  });
  it('the Discard question does not outlive the bar: a bar that hides and comes back shows Resume and Discard again', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'Discard');
    expect(c.textContent).toContain('Discard this unsaved guide? It cannot be brought back.');
    act(() => { useGuides.setState({ capability: 'offline' }); }); // the connection drops: the bar hides
    expect(c.querySelector('.gtool-resume')).toBeNull();
    act(() => { useGuides.setState({ capability: 'on' }); });      // ...and comes back
    expect(c.querySelector('.gtool-resume')).not.toBeNull();
    expect(c.textContent).not.toContain('Discard this unsaved guide?');
    expect(button(c, 'Discard for good')).toBeUndefined();
    expect(button(c, 'Resume')).toBeDefined();
    expect(button(c, 'Discard')).toBeDefined();
    expect(loadLocalDraft('u-1')).toEqual(kept);
  });
  it('Resume reads the device again: a guide that was saved or cleared meanwhile is not opened, and the bar goes', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    expect(button(c, 'Resume')).toBeDefined();
    clearLocalDraft('u-1'); // behind the tab's back, as a save landing late does
    await press(c, 'Resume');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelector('.gtool-resume')).toBeNull();
    expect(c.textContent).toContain('That guide was already saved.');
    await press(c, 'New guide'); // and nothing is waiting any more
    expect(c.querySelector('.gedit')).not.toBeNull();
  });
  it('Resume opens the guide the device holds NOW, when that is a different one than the bar was showing', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
    const newer = { ...kept, title: 'Written since', body: 'more of it' };
    saveLocalDraft('u-1', newer); // behind the tab's back, as another window of the game does
    await press(c, 'Resume');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Written since');
    expect(c.textContent).not.toContain('That guide was already saved.');
    // It was handed over as it was read: closing it unchanged leaves it on the device, and the bar now names it.
    await press(c, 'Cancel');
    expect(loadLocalDraft('u-1')).toEqual(newer);
    expect(c.textContent).toContain('You have an unsaved guide: Written since');
    expect(c.textContent).not.toContain('That guide was already saved.');
  });
  it('Resume, when the device now holds only an empty guide, opens nothing and drops the bar', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    saveLocalDraft('u-1', emptyDraft('Mike'));
    await press(c, 'Resume');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelector('.gtool-resume')).toBeNull();
  });
  it('a kept guide with nothing in it is not offered, is forgotten, and does not stop a new guide', async () => {
    // Only the "by" line (filled in for the author), tribes and an art icon: no title, tagline, write-up, card or nickname.
    saveLocalDraft('u-1', { ...emptyDraft('Someone'), title: '   ', tagline: ' ', body: ' \n ', tribes: ['beast'], pairsWith: ['dragon'], iconCard: 'grim' });
    const c = as('player');
    expect(c.textContent).not.toContain('You have an unsaved guide');
    expect(loadLocalDraft('u-1')).toBeNull();
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.textContent).not.toContain(RESUME_FIRST);
  });
  it('a kept guide holding only a title, only a tagline, only a write-up, only a card or only a nickname row is offered', () => {
    for (const part of [{ title: 'T' }, { tagline: 'a line' }, { body: 'words' }, { core: ['grim'] }, { enablers: ['grim'] }, { aliases: [{ word: '', card: '' }] }]) {
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
    saveAnswer = { ok: true, value: savedRow() };
    const c = as('player', { mine: [] });
    await press(c, 'Resume');
    await press(c, 'Save');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(c.textContent).not.toContain('You have an unsaved guide');
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Left behind']);
  });
});

/** `n` guides this player owns. */
const manyGuides = (n: number): Guide[] => Array.from({ length: n }, (_, i) => ({ ...mineGuide, id: `own-${i}`, rowId: `own-${i}`, title: `Mine ${i}` }));
const CAP_SENTENCE = 'You already have 20 guides. Delete one to make room.';

describe('the 20-guide cap is said before the guide is written', () => {
  const cap = GUIDE_LIMITS.guidesPerPlayer;
  it('the sentence carries the number from the shared limits', () => {
    expect(cap).toBe(20);
    expect(CAP_SENTENCE).toBe(`You already have ${cap} guides. Delete one to make room.`);
  });
  it('at the cap, New guide opens no editor and says why', async () => {
    const c = as('player', { mine: manyGuides(cap) });
    expect(c.querySelector('.gtool-cap')).toBeNull(); // nothing is said until the player asks
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelector('.gtool-cap')!.textContent).toBe(CAP_SENTENCE);
  });
  it('at the cap, Duplicate opens no editor and says why', async () => {
    const c = as('player', { mine: manyGuides(cap) });
    await press(card(c, serverList[0]!.id), 'Duplicate');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelector('.gtool-cap')!.textContent).toBe(CAP_SENTENCE);
  });
  it('over the cap (a guide was made elsewhere) is stopped the same way', async () => {
    const c = as('player', { mine: manyGuides(cap + 1) });
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelector('.gtool-cap')).not.toBeNull();
  });
  it('at one under the cap, New guide and Duplicate both open the editor', async () => {
    let c = as('player', { mine: manyGuides(cap - 1) });
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.textContent).not.toContain(CAP_SENTENCE);
    ui!.unmount();
    c = as('player', { mine: manyGuides(cap - 1) });
    await press(card(c, serverList[0]!.id), 'Duplicate');
    expect(c.querySelector('.gedit')).not.toBeNull();
  });
  it('a team account is not stopped', async () => {
    let c = as('team', { mine: manyGuides(cap) });
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    ui!.unmount();
    c = as('team', { mine: manyGuides(cap) });
    await press(card(c, serverList[0]!.id), 'Duplicate');
    expect(c.querySelector('.gedit')).not.toBeNull();
  });
  it('Edit is never stopped by the cap, so a guide can be opened and deleted to make room', async () => {
    const mine = manyGuides(cap);
    const c = as('player', { mine, tab: 'mine' });
    await press(card(c, mine[0]!.id), 'Edit');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Mine 0');
  });
  it('Resume is never stopped by the cap', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player', { mine: manyGuides(cap) });
    await press(c, 'Resume');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Left behind');
  });
  it('the note goes once there is room again', async () => {
    const c = as('player', { mine: manyGuides(cap) });
    await press(c, 'New guide');
    expect(c.querySelector('.gtool-cap')).not.toBeNull();
    act(() => { useGuides.setState({ mine: manyGuides(cap - 1) }); }); // one was deleted (here, or on another device and re-read)
    expect(c.querySelector('.gtool-cap')).toBeNull();
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
  });
});

describe('guides the store still holds for another account', () => {
  // The store was never told the account changed (a missed re-read): it still holds account u-1's private guides,
  // and the Compendium is handed them as the My guides list.
  const openAs = (userId: string | null, anonymous: boolean): HTMLElement => {
    ui?.unmount();
    act(() => {
      useGame.setState({ account: { userId, email: anonymous || !userId ? null : 'x@example.test', anonymous, discriminator: null }, playerName: 'Mike' });
      useGuides.setState({ capability: 'on', source: 'server', list: serverList, team: false, mine: [mineGuide], mineOwner: 'u-1', tab: 'mine' });
    });
    ui = mount(<CompendiumGuides guides={[mineGuide]} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" />);
    return ui.container;
  };
  it('My guides draws none of them and counts none, for a second account, a guest and nobody', () => {
    for (const [userId, anonymous] of [['u-2', false], ['g-9', true], [null, true]] as const) {
      const c = openAs(userId, anonymous);
      expect(c.querySelector('.bookguide'), String(userId)).toBeNull();
      expect(c.textContent, String(userId)).not.toContain('My Sunmane');
      expect(button(c, 'My guides'), String(userId)).toBeDefined();
      expect(button(c, 'My guides (1)'), String(userId)).toBeUndefined();
      expect(c.textContent, String(userId)).toContain('You have not written a guide yet.');
    }
  });
  it('their owner sees them', () => {
    const c = openAs('u-1', false);
    expect(card(c, ROW).textContent).toContain('My Sunmane');
    expect(button(c, 'My guides (1)')).toBeDefined();
  });
  it('they do not count toward the cap of the account that is signed in', async () => {
    act(() => { useGame.setState({ account: { userId: 'u-2', email: 'x@example.test', anonymous: false, discriminator: null }, playerName: 'Mike' }); });
    act(() => { useGuides.setState({ capability: 'on', source: 'server', list: serverList, team: false, mine: manyGuides(GUIDE_LIMITS.guidesPerPlayer), mineOwner: 'u-1' }); });
    ui = mount(<CompendiumGuides guides={guidesFor('set2', SETS.set2.tribes, serverList)} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" />);
    await press(ui.container, 'New guide');
    expect(ui.container.querySelector('.gedit')).not.toBeNull();
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
    await press(c, 'Discard for good');
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
  it('a successful import is said quietly, not as an alert', async () => {
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect([...c.querySelectorAll('[role="status"]')].some((n) => n.textContent === 'Imported 11 guides.')).toBe(true);
  });
  it('a refused import is announced, and the button can be pressed again', async () => {
    importAnswer = () => ({ ok: false, code: 'not_allowed' });
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Something went wrong importing the guides. Nothing was imported.');
    expect(c.textContent).not.toContain('Imported');
    expect(officialCalls).toBe(0); // nothing changed, so nothing is read again
    expect(button(c, 'Import built-in guides')!.disabled).toBe(false);
  });
  it('an import that could not reach the server says nothing was imported, not that a guide is kept on the device', async () => {
    importAnswer = () => ({ ok: false, code: 'offline' });
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('Could not reach the server. Nothing was imported.');
    expect(officialCalls).toBe(0);
  });
  it('an import that breaks is announced, and the button can be pressed again', async () => {
    importAnswer = () => { throw new Error('boom'); };
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    expect(c.querySelector('[role="alert"]')!.textContent).toBe('The import did not finish. Try again.');
    expect(button(c, 'Import built-in guides')!.disabled).toBe(false);
  });
  it('a team member cannot start a Team Ascent guide before the import', async () => {
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.textContent).not.toContain('Team Ascent guide');
  });
});

describe('what a screen reader is told', () => {
  it('the toolbar is marked busy while it is not yet known whether guides can be written, and not after', () => {
    let c = as('player', { capability: 'unknown' });
    expect(c.querySelector('.gtool')!.getAttribute('aria-busy')).toBe('true');
    for (const capability of ['on', 'off', 'offline', 'no-backend'] as const) {
      ui!.unmount();
      c = as('player', { capability });
      expect(c.querySelector('.gtool')!.hasAttribute('aria-busy'), capability).toBe(false);
    }
  });
  it('the mark goes the moment the answer arrives, without remounting the toolbar', () => {
    const c = as('player', { capability: 'unknown' });
    const bar = c.querySelector('.gtool')!;
    act(() => { useGuides.setState({ capability: 'on' }); });
    expect(c.querySelector('.gtool')).toBe(bar);
    expect(bar.hasAttribute('aria-busy')).toBe(false);
  });
  /** The toolbar note that says exactly `text` (the offline line and the Resume bar are notes too). */
  const said = (c: HTMLElement, text: string): Element | undefined => [...c.querySelectorAll('.gtool-note')].find((n) => n.textContent === text);
  it('an error that replaces a status is a new element, so it is announced', async () => {
    saveAnswer = { ok: true, value: savedRow({ title: 'A copy' }) };
    const c = as('team', { source: 'bundled', list: GUIDES, mine: [] });
    await press(card(c, GUIDES[0]!.id), 'Duplicate');
    await press(c, 'Save');
    const status = said(c, 'Saved to My guides.')!;
    expect(status.getAttribute('role')).toBe('status');
    importAnswer = () => ({ ok: false, code: 'offline' });
    await press(c, 'Import built-in guides');
    const alert = said(c, 'Could not reach the server. Nothing was imported.')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert).not.toBe(status);
    expect(said(c, 'Saved to My guides.')).toBeUndefined(); // it replaced the status: still one note
  });
  it('a status that replaces an error is a new element too; the same kind twice keeps the element', async () => {
    importAnswer = () => ({ ok: false, code: 'offline' });
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    const first = said(c, 'Could not reach the server. Nothing was imported.')!;
    expect(first.getAttribute('role')).toBe('alert');
    importAnswer = () => ({ ok: false, code: 'not_allowed' });
    await press(c, 'Import built-in guides');
    expect(said(c, 'Something went wrong importing the guides. Nothing was imported.')).toBe(first); // another error: the same alert, new words
    importAnswer = null;
    await press(c, 'Import built-in guides');
    const status = said(c, 'Imported 11 guides.')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status).not.toBe(first);
    expect(c.querySelector('.gtool-note[role="alert"]')).toBeNull();
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
    expect(document.activeElement).toBe(button(c, 'Resume'));
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
  it('a second account writing a guide of its own leaves the first account\'s waiting guide on the device, untouched', async () => {
    // The first account left an unsaved guide. The second has nothing waiting, so New guide opens for it.
    saveLocalDraft('u-1', kept);
    const c = as('player');
    becomeAccount('u-2');
    expect(c.textContent).not.toContain('You have an unsaved guide');
    await press(c, 'New guide');
    type(c.querySelector('.gedit-title')!, 'Typed by two');
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); }); // past the pause after which a change is written
    expect(loadLocalDraft('u-2')?.title).toBe('Typed by two');
    expect(loadLocalDraft('u-1')).toEqual(kept);
    // The second account discards its guide: the first account's is still there, and offered to it alone.
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(loadLocalDraft('u-2')).toBeNull();
    expect(loadLocalDraft('u-1')).toEqual(kept);
    becomeAccount('u-1');
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
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

describe('an ask is brought into view', () => {
  // jsdom does not scroll: stand in for the element method and note what it was asked.
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  const real = Object.getOwnPropertyDescriptor(proto, 'scrollTo');
  let scrolls: Array<{ el: Element; top: unknown }> = [];
  beforeEach(() => {
    scrolls = [];
    Object.defineProperty(proto, 'scrollTo', { configurable: true, writable: true, value(this: Element, o?: { top?: number }) { scrolls.push({ el: this, top: o?.top }); } });
  });
  afterEach(() => {
    if (real) Object.defineProperty(proto, 'scrollTo', real); else delete proto.scrollTo;
  });
  const away = (): void => { act(() => { (document.activeElement as HTMLElement | null)?.blur(); }); };

  it('a guest who presses Duplicate far down the list: the tab scrolls to its top and Create account takes focus', async () => {
    const c = as('guest');
    await press(card(c, serverList[5]!.id), 'Duplicate');
    expect(scrolls).toEqual([{ el: c.querySelector('.bookguides'), top: 0 }]);
    expect(document.activeElement).toBe(button(c, 'Create account'));
  });
  it('pressing again while the ask is already showing brings it into view again', async () => {
    const c = as('guest');
    await press(card(c, serverList[5]!.id), 'Duplicate');
    away();
    expect(document.activeElement).not.toBe(button(c, 'Create account'));
    await press(card(c, serverList[5]!.id), 'Duplicate');
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]).toEqual({ el: c.querySelector('.bookguides'), top: 0 });
    expect(document.activeElement).toBe(button(c, 'Create account'));
  });
  it('when accounts cannot be reached there is no button to focus, so the sign-in line itself takes focus', async () => {
    accounts = false;
    const c = as('guest');
    await press(c, 'New guide');
    expect(button(c, 'Create account')).toBeUndefined();
    const line = c.querySelector<HTMLElement>('.gtool-signin')!;
    expect(line.textContent).toContain('Accounts cannot be reached right now.');
    expect(document.activeElement).toBe(line);
    expect(scrolls).toHaveLength(1);
  });
  it('with an unsaved guide waiting, New guide scrolls to the top and Resume takes focus, each time it is pressed', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'New guide');
    expect(scrolls).toEqual([{ el: c.querySelector('.bookguides'), top: 0 }]);
    expect(document.activeElement).toBe(button(c, 'Resume'));
    away();
    await press(card(c, serverList[5]!.id), 'Duplicate');
    expect(scrolls).toHaveLength(2);
    expect(document.activeElement).toBe(button(c, 'Resume'));
  });
  it('asked while the bar is confirming a discard, the bar goes back to Resume and Discard, and Resume takes focus', async () => {
    saveLocalDraft('u-1', kept);
    const c = as('player');
    await press(c, 'Discard');
    await press(c, 'New guide');
    expect(c.textContent).not.toContain('Discard this unsaved guide?');
    expect(c.textContent).toContain(RESUME_FIRST);
    expect(document.activeElement).toBe(button(c, 'Resume'));
    expect(loadLocalDraft('u-1')).toEqual(kept);
  });
  it('at the 20-guide cap, New guide scrolls to the top and the note that says why takes focus, each time it is pressed', async () => {
    const c = as('player', { mine: manyGuides(GUIDE_LIMITS.guidesPerPlayer) });
    await press(c, 'New guide');
    expect(scrolls).toEqual([{ el: c.querySelector('.bookguides'), top: 0 }]);
    const note = c.querySelector<HTMLElement>('.gtool-cap')!;
    expect(note.textContent).toBe(CAP_SENTENCE);
    expect(document.activeElement).toBe(note);
    away();
    await press(card(c, serverList[5]!.id), 'Duplicate');
    expect(scrolls).toHaveLength(2);
    expect(document.activeElement).toBe(c.querySelector('.gtool-cap'));
  });
  it('opening the editor does not scroll or ask', async () => {
    const c = as('player');
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(scrolls).toHaveLength(0);
  });
});

describe('a newly saved guide is shown', () => {
  it('Duplicate from Team Ascent, then Save: the pill moves to My guides and the tab says where it went', async () => {
    saveAnswer = { ok: true, value: savedRow({ title: `${serverList[0]!.title} (copy)` }) };
    const c = as('player');
    expect(useGuides.getState().tab).toBe('team');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    await press(c, 'Save');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().mine).toHaveLength(2);
    expect(useGuides.getState().tab).toBe('mine');
    expect(button(c, 'My guides (2)')!.getAttribute('aria-pressed')).toBe('true');
    expect([...c.querySelectorAll('[role="status"]')].some((n) => n.textContent === 'Saved to My guides.')).toBe(true);
  });
  it('Duplicate, then Cancel: the pill stays and nothing is said', async () => {
    const c = as('player');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    await press(c, 'Cancel');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().tab).toBe('team');
    expect(c.textContent).not.toContain('Saved to My guides.');
  });
  it('saving an edit of a guide the player already owns moves nothing and says nothing', async () => {
    saveAnswer = { ok: true, value: savedRow({ id: ROW, title: 'My Sunmane', revision: 2 }) };
    const c = as('player');
    act(() => { requestGuideEdit(ROW); }); // the player's own guide, opened while the Team Ascent pill is showing
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('My Sunmane');
    await press(c, 'Save');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().mine).toHaveLength(1);
    expect(useGuides.getState().tab).toBe('team');
    expect(c.textContent).not.toContain('Saved to My guides.');
  });
  it('a background re-read that finds one more guide while the editor is open is not a save: Cancel says nothing', async () => {
    const c = as('player');
    await press(c, 'New guide');
    // The list is read again while the editor is open and finds a guide written on another device.
    act(() => { useGuides.setState({ mine: [mineGuide, { ...mineGuide, id: 'other-device', rowId: 'other-device', title: 'From my phone' }] }); });
    await press(c, 'Cancel');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().tab).toBe('team');
    expect(c.textContent).not.toContain('Saved to My guides.');
  });
  it('a new guide saved while the list shrank for another reason is still shown where it went', async () => {
    saveAnswer = { ok: true, value: savedRow({ title: 'A copy' }) };
    const c = as('player');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    act(() => { useGuides.setState({ mine: [] }); }); // the guide the player had was deleted on another device
    await press(c, 'Save');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['A copy']); // one guide before, one now
    expect(useGuides.getState().tab).toBe('mine');
    expect([...c.querySelectorAll('[role="status"]')].some((n) => n.textContent === 'Saved to My guides.')).toBe(true);
  });
  it('a team member saving a Team Ascent guide stays on Team Ascent', async () => {
    saveAnswer = { ok: true, value: savedRow({ id: serverList[1]!.rowId, official: true, authorId: null, byline: 'Team Ascent', published: true, title: serverList[1]!.title, revision: 2 }) };
    const c = as('team');
    await press(card(c, serverList[1]!.id), 'Edit');
    await press(c, 'Save');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().tab).toBe('team');
    expect(c.textContent).not.toContain('Saved to My guides.');
  });
});

it('the tab carries no native tooltip', () => {
  expect(as('team').querySelector('[title]')).toBeNull();
});
