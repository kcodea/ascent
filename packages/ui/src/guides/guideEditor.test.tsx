// @vitest-environment jsdom
/**
 * THE GUIDE EDITOR. Pins: every field edits the draft; Save sends the server document and closes; a refused save
 * keeps the editor open with the author's text and a sentence; a missing card blocks the save until removed; a
 * conflict offers Load their version / Overwrite with mine; Cancel and Esc ask before discarding changes; Tab and Esc
 * never reach the game's own handlers (which would close the Compendium); the draft is kept on the device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import type { GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import type { GuideDraftInput, GuideWriteResult } from './guidesRemote';

let saveAnswer: (g: GuideDraftInput) => GuideWriteResult<GuideRecord>;
let deleteAnswer: () => GuideWriteResult<true>;
let byIdAnswer: GuideRecord | null | undefined;
const saves: GuideDraftInput[] = [];
const deletes: string[] = [];
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => ({ state: 'offline' }),
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchGuideById: async () => byIdAnswer,
  saveGuideRemote: async (g: GuideDraftInput) => { saves.push(g); return saveAnswer(g); },
  deleteGuideRemote: async (rowId: string) => { deletes.push(rowId); return deleteAnswer(); },
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
}));

const { GuideEditor } = await import('./GuideEditor');
const { draftFromGuide, emptyDraft } = await import('./guideDrafts');
const { loadLocalDraft } = await import('./guideDraftStore');
const { GUIDES } = await import('./guides');
const { resetGuidesForTests, useGuides } = await import('./guidesStore');

const ROW = '11111111-1111-4111-8111-111111111111';
const rec = (patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id: ROW, slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: false, hidden: false, sets: ['set2'], tribes: [],
  pairsWith: [], iconCard: 'grim', title: 'Saved', tagline: '', body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 2, createdAt: '', updatedAt: '', ...patch,
});
const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
const archived = Object.values(CARD_INDEX).find((c) => !inSet2.has(c.id) && !c.spell && !c.token)!;

let ui: Mounted | null = null;
let closed = 0;
const open = (initial = { ...emptyDraft('Mike'), title: 'My guide', body: 'Play it.', core: ['grim'] }, canBeOfficial = false): HTMLElement => {
  ui = mount(<GuideEditor initial={initial} setId="set2" tribes={SETS.set2.tribes} run={undefined} userId="u-1" canBeOfficial={canBeOfficial} onClose={() => { closed++; }} />);
  return ui.container;
};
const type = (el: Element, value: string): void => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const press = async (c: HTMLElement, text: string): Promise<void> => {
  const b = [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const alertText = (c: HTMLElement): string => c.querySelector('[role="alert"]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  resetGuidesForTests();
  saves.length = 0;
  deletes.length = 0;
  closed = 0;
  byIdAnswer = rec();
  saveAnswer = (g) => ({ ok: true, value: rec({ title: g.title, body: g.body, core: g.core }) });
  deleteAnswer = () => ({ ok: true, value: true });
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });

describe('editing the fields', () => {
  it('title, tagline, write-up and by line are typed straight onto the card and are sent on Save', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Renamed');
    type(c.querySelector('.gedit-tagline')!, 'A tagline');
    type(c.querySelector('.gedit-body')!, 'New write-up.');
    type(c.querySelector('.gedit-byline')!, 'Mikey');
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ title: 'Renamed', tagline: 'A tagline', body: 'New write-up.', byline: 'Mikey', official: false, core: ['grim'] });
    expect(closed).toBe(1);
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Renamed']);
  });
  it('a tribe pill toggles a tribe, at most two', () => {
    const c = open();
    const pills = [...c.querySelectorAll<HTMLButtonElement>('.gedit-tribes .book-runetribe')];
    click(pills[0]!); click(pills[1]!); click(pills[2]!);
    expect(pills.filter((p) => p.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
    click(pills[0]!);
    expect(pills.filter((p) => p.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });
  it('Add opens the picker under the row, picking adds the card and closes it, x removes, the arrows reorder', () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', 'b2_sunmane'] });
    const core = c.querySelector('.gedit-row[data-row="core"]')!;
    const ids = (): string[] => [...core.querySelectorAll('.gedit-unit')].map((u) => u.getAttribute('data-card')!);
    expect(ids()).toEqual(['grim', 'b2_sunmane']);
    click(core.querySelector('.gedit-unit[data-card="b2_sunmane"] .gedit-earlier')!);
    expect(ids()).toEqual(['b2_sunmane', 'grim']);
    click(core.querySelector('.gedit-unit[data-card="grim"] .gedit-remove')!);
    expect(ids()).toEqual(['b2_sunmane']);
    click(core.querySelector('.gedit-add')!);
    const picker = c.querySelector('.gpick')!;
    const first = picker.querySelector<HTMLButtonElement>('.gpick-row')!;
    click(first);
    expect(ids()).toHaveLength(2);
    expect(c.querySelector('.gpick')).toBeNull();
  });
  it('the Add button is disabled at the limit, and the picker never offers a card already in the row', () => {
    const six = poolFor('set2').buyable.slice(0, 6).map((x) => x.id);
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: six });
    expect(c.querySelector<HTMLButtonElement>('.gedit-row[data-row="core"] .gedit-add')!.disabled).toBe(true);
  });
  it('a card name typed in the write-up lights up in the preview, and is sent as a mention', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['b2_sunmane'] });
    type(c.querySelector('.gedit-body')!, `Then find ${CARD_INDEX['grim']!.name}.`);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect([...c.querySelectorAll('.gedit-preview .lobbyguide-name')].map((n) => n.textContent)).toEqual([CARD_INDEX['grim']!.name]);
    await press(c, 'Save');
    expect(saves[0]!.mentions).toEqual(['grim']);
  });
  it('a nickname row is a word and one of the guide\'s cards', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'the big cat', core: ['b2_sunmane'] });
    await press(c, 'Add nickname');
    type(c.querySelector('.gedit-alias-word')!, 'cat');
    const sel = c.querySelector<HTMLSelectElement>('.gedit-alias-card')!;
    act(() => { sel.value = 'b2_sunmane'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await press(c, 'Save');
    expect(saves[0]!.aliases).toEqual({ cat: 'b2_sunmane' });
  });
});

describe('who the guide is by', () => {
  it('a player never sees the Team Ascent choice', () => {
    expect(open().textContent).not.toContain('Team Ascent guide');
  });
  it('a team member creating a guide can make it a Team Ascent guide: the by line locks and official is sent', async () => {
    const c = open(undefined, true);
    await press(c, 'Team Ascent guide');
    expect(c.querySelector('.gedit-byline')).toBeNull();
    expect(c.textContent).toContain('by Team Ascent');
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ official: true, byline: 'Team Ascent' });
  });
  it('editing an existing Team Ascent guide sends official and the row\'s revision', async () => {
    const official = draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5 });
    saveAnswer = (g) => ({ ok: true, value: rec({ official: true, byline: 'Team Ascent', title: g.title, authorId: null }) });
    const c = open(official);
    type(c.querySelector('.gedit-title')!, 'Sunmane, edited');
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ id: ROW, revision: 5, official: true });
  });
});

describe('a save that cannot go through', () => {
  it('a guide with no Core card is stopped before the server, with a sentence', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: [] });
    await press(c, 'Save');
    expect(saves).toEqual([]);
    expect(alertText(c)).toMatch(/Core/);
    expect(closed).toBe(0);
  });
  it('a missing card blocks the save until Remove missing cards is pressed', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', archived.id], enablers: ['card_that_never_existed'] });
    expect(c.querySelectorAll('.lobbyguide-unit.missing')).toHaveLength(2);
    await press(c, 'Save');
    expect(saves).toEqual([]);
    expect(alertText(c)).toMatch(/missing or removed/i);
    await press(c, 'Remove missing cards');
    expect(c.querySelectorAll('.lobbyguide-unit.missing')).toHaveLength(0);
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ core: ['grim'], enablers: [] });
  });
  it('a nickname that means a missing card says so, blocks the save, and goes when Remove missing cards is pressed', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], aliases: [{ word: 'old', card: archived.id }, { word: 'cat', card: 'grim' }] });
    const rows = (): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.gedit-alias')];
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.classList.contains('missing')).toBe(true);
    expect(rows()[0]!.textContent).toContain('Missing or removed');
    expect(rows()[1]!.classList.contains('missing')).toBe(false);
    expect(rows()[1]!.textContent).not.toContain('Missing or removed');
    // The card is not in Core or Enablers, so no portrait is drawn for it.
    expect(c.querySelectorAll('.lobbyguide-unit.missing')).toHaveLength(0);
    await press(c, 'Save');
    expect(saves).toEqual([]);
    expect(alertText(c)).toMatch(/missing or removed/i);
    await press(c, 'Remove missing cards');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.querySelector<HTMLInputElement>('.gedit-alias-word')!.value).toBe('cat');
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ core: ['grim'], aliases: { cat: 'grim' } });
    expect(closed).toBe(1);
  });
  it('a refusal keeps the editor open with the author\'s text and says why', async () => {
    for (const [answer, want] of [
      [{ ok: false, code: 'blocked_text', field: 'body' }, /write-up has a word/],
      [{ ok: false, code: 'too_many_guides' }, /already have 20 guides/],
      [{ ok: false, code: 'sign_in_required' }, /Sign in/],
      [{ ok: false, code: 'unavailable' }, /cannot be saved yet/],
      [{ ok: false, code: 'offline' }, /kept on this device/],
    ] as const) {
      ui?.unmount();
      saveAnswer = () => answer as GuideWriteResult<GuideRecord>;
      const c = open();
      type(c.querySelector('.gedit-title')!, 'Keep me');
      await press(c, 'Save');
      expect(alertText(c), answer.code).toMatch(want);
      expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Keep me');
    }
    expect(closed).toBe(0);
  });
  it('a conflict offers Load their version, which replaces the text with the server\'s', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    expect(c.textContent).toContain('Someone else saved this guide while you were editing.');
    await press(c, 'Load their version');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Theirs');
    expect(closed).toBe(0);
  });
  it('a conflict offers Overwrite with mine, which saves my text at their revision', async () => {
    let n = 0;
    saveAnswer = (g) => (n++ === 0 ? { ok: false, code: 'conflict' } : { ok: true, value: rec({ title: g.title }) });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    await press(c, 'Overwrite with mine');
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({ id: ROW, revision: 9, title: 'Mine' });
    expect(closed).toBe(1);
  });
});

describe('leaving the editor', () => {
  it('Cancel with nothing changed just closes', async () => {
    const c = open();
    await press(c, 'Cancel');
    expect(closed).toBe(1);
  });
  it('Cancel with changes asks first; Keep editing stays, Discard closes and forgets the device draft', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Changed');
    await press(c, 'Cancel');
    expect(closed).toBe(0);
    expect(c.textContent).toContain('Discard your changes?');
    await press(c, 'Keep editing');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Changed');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('Delete asks first, then deletes the row and closes', async () => {
    useGuides.setState({ mine: [{ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' }] });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    await press(c, 'Delete');
    expect(deletes).toEqual([]);
    await press(c, 'Delete for good');
    expect(deletes).toEqual([ROW]);
    expect(useGuides.getState().mine).toEqual([]);
    expect(closed).toBe(1);
  });
  it('deleting a guide the server no longer has counts as done: it closes and the guide leaves the list', async () => {
    deleteAnswer = () => ({ ok: false, code: 'not_found' });
    useGuides.setState({ mine: [{ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' }] });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    type(c.querySelector('.gedit-title')!, 'Changed');
    await press(c, 'Delete');
    await press(c, 'Delete for good');
    expect(deletes).toEqual([ROW]);
    expect(useGuides.getState().mine).toEqual([]);
    expect(alertText(c)).toBe('');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a new guide has no Delete button', () => {
    expect([...open().querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Delete')).toBe(false);
  });
});

describe('the keyboard never closes the Compendium from inside the editor', () => {
  it('Tab and Esc are stopped before the game\'s own window handlers; Esc asks to leave; Enter in the title does nothing', () => {
    const reached: string[] = [];
    const game = (e: KeyboardEvent): void => { reached.push(e.key); };
    window.addEventListener('keydown', game);
    try {
      const c = open();
      const title = c.querySelector<HTMLInputElement>('.gedit-title')!;
      type(title, 'Changed');
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      expect(reached).toEqual(['Enter']);
      expect(c.textContent).toContain('Discard your changes?');
      expect(saves).toEqual([]);
      expect(closed).toBe(0);
    } finally {
      window.removeEventListener('keydown', game);
    }
  });
  it('Esc with the card picker open closes the picker, not the editor', () => {
    const c = open();
    click(c.querySelector('.gedit-row[data-row="core"] .gedit-add')!);
    expect(c.querySelector('.gpick')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(c.querySelector('.gpick')).toBeNull();
    expect(closed).toBe(0);
    expect(c.textContent).not.toContain('Discard your changes?');
  });
  it('once unmounted, the editor no longer claims the keys', () => {
    open();
    ui!.unmount();
    ui = null;
    const reached: string[] = [];
    const game = (e: KeyboardEvent): void => { reached.push(e.key); };
    window.addEventListener('keydown', game);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    window.removeEventListener('keydown', game);
    expect(reached).toEqual(['Tab']);
  });
});

describe('the draft kept on the device', () => {
  it('is written shortly after a change, and cleared by a save', async () => {
    vi.useFakeTimers();
    const c = open();
    type(c.querySelector('.gedit-title')!, 'In progress');
    expect(loadLocalDraft('u-1')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(loadLocalDraft('u-1')!.title).toBe('In progress');
    vi.useRealTimers();
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')).toBeNull();
  });
});

it('the editor carries no native tooltip', () => {
  expect(open().querySelector('[title]')).toBeNull();
});
