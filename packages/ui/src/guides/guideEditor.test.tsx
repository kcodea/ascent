// @vitest-environment jsdom
/**
 * THE GUIDE EDITOR. Pins: every field edits the draft; Save sends the server document and closes; a refused save
 * keeps the editor open with the author's text and a sentence; a missing card blocks the save until removed; a
 * conflict offers Load their version / Overwrite with mine; Cancel and Esc ask before discarding changes; Tab and Esc
 * never reach the game's own handlers (which would close the Compendium); the draft is kept on the device.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import type { GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import type { GuideDraftInput, GuideWriteResult } from './guidesRemote';

let saveAnswer: (g: GuideDraftInput) => GuideWriteResult<GuideRecord>;
let deleteAnswer: () => GuideWriteResult<true>;
let byIdAnswer: GuideRecord | null | undefined;
let gate: Promise<void> | null = null;
let deleteGate: Promise<void> | null = null;
let fetches = 0;
/** Hold the next save/delete at the server until the returned function is called. */
const hold = (): (() => void) => { let r!: () => void; gate = new Promise<void>((res) => { r = res; }); return r; };
const saves: GuideDraftInput[] = [];
const deletes: string[] = [];
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => ({ state: 'offline' }),
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchGuideById: async () => { fetches++; return byIdAnswer; },
  saveGuideRemote: async (g: GuideDraftInput) => { saves.push(g); if (gate) await gate; return saveAnswer(g); },
  deleteGuideRemote: async (rowId: string) => { deletes.push(rowId); if (deleteGate) await deleteGate; return deleteAnswer(); },
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
}));

const { GuideEditor } = await import('./GuideEditor');
const { draftFromGuide, emptyDraft } = await import('./guideDrafts');
const { loadLocalDraft, saveLocalDraft } = await import('./guideDraftStore');
const { useGame } = await import('../store');
const { GUIDES } = await import('./guides');
const { resetGuidesForTests, useGuides } = await import('./guidesStore');
const { currentIdentity, setIdentity } = await import('../identity');
const prevIdentity = currentIdentity();

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
/** What each close reported: true when a NEW guide of the player's own was just saved. */
const closedWith: boolean[] = [];
const open = (initial = { ...emptyDraft('Mike'), title: 'My guide', body: 'Play it.', core: ['grim'] }, canBeOfficial = false): HTMLElement => {
  ui = mount(<GuideEditor initial={initial} setId="set2" tribes={SETS.set2.tribes} run={undefined} userId="u-1" canBeOfficial={canBeOfficial} onClose={(savedNew) => { closed++; closedWith.push(savedNew); }} />);
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
/** Wait past the 400 ms pause after which a changed draft is written to the device. */
const pause = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 450)); }); };

beforeEach(() => {
  localStorage.clear();
  resetGuidesForTests();
  // The account at the keyboard is the one the editor is opened for (`userId="u-1"`): the guides store keeps a saved
  // player guide only for its author.
  setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
  saves.length = 0;
  deletes.length = 0;
  closed = 0;
  closedWith.length = 0;
  byIdAnswer = rec();
  gate = null;
  deleteGate = null;
  fetches = 0;
  saveAnswer = (g) => ({ ok: true, value: rec({ title: g.title, body: g.body, core: g.core }) });
  deleteAnswer = () => ({ ok: true, value: true });
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  vi.useRealTimers();
  setIdentity(prevIdentity);
  useGame.setState({ inspect: null, bugReportOpen: false });
});
const existing = (patch: Record<string, unknown> = {}) => draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1', ...patch });

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
  it('a tribe that is not in this set still has a pill, lit and marked, so it can be removed; once removed the pill is gone', () => {
    expect(SETS.set2.tribes).not.toContain('undead');
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], tribes: ['undead'] });
    const pills = (): HTMLButtonElement[] => [...c.querySelectorAll<HTMLButtonElement>('.gedit-tribes .book-runetribe')];
    const undead = (): HTMLButtonElement | undefined => pills().find((p) => p.textContent === 'Undead (not in this set)');
    expect(pills().some((p) => p.textContent === 'Undead')).toBe(false); // never the bare name: the text itself says it
    expect(pills().indexOf(undead()!)).toBe(SETS.set2.tribes.length); // after the set's own tribes
    expect(undead()!.getAttribute('aria-pressed')).toBe('true');
    expect(undead()!.classList.contains('on')).toBe(true);
    expect(undead()!.classList.contains('off-roster')).toBe(true);
    expect(undead()!.getAttribute('aria-description')).toBe('Not in this set. Press to remove.');
    expect(c.querySelectorAll('.gedit-tribes .off-roster')).toHaveLength(1); // the set's own pills are not marked
    for (const p of pills().filter((x) => !x.classList.contains('off-roster'))) expect(p.textContent).not.toContain('not in this set');
    click(undead()!);
    expect(undead()).toBeUndefined();
    expect(pills()).toHaveLength(SETS.set2.tribes.length);
  });
  it('a "pairs with" tribe that is not in this set is shown selected and named as such, and choosing None clears it', () => {
    expect(SETS.set2.tribes).not.toContain('spirit');
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], tribes: ['beast'], pairsWith: ['spirit'] });
    const sel = c.querySelector<HTMLSelectElement>('.gedit-pairs')!;
    expect(sel.value).toBe('spirit');
    expect(sel.selectedOptions[0]!.textContent).toBe('Spirits (not in this set)');
    act(() => { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(sel.value).toBe('');
    expect([...sel.options].map((o) => o.value)).not.toContain('spirit');
  });
  it('a guide holding tribes that are not in this set cannot be saved until they are removed; then Save sends it without them', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], tribes: ['beast', 'undead'], pairsWith: ['spirit'] });
    await press(c, 'Save');
    expect(saves).toHaveLength(0);
    expect(alertText(c)).toContain('tribes that are in this set');
    click([...c.querySelectorAll<HTMLButtonElement>('.gedit-tribes .book-runetribe')].find((p) => p.textContent === 'Undead (not in this set)')!);
    const sel = c.querySelector<HTMLSelectElement>('.gedit-pairs')!;
    act(() => { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    expect(saves[0]!.tribes).toEqual(['beast']);
    expect(saves[0]!.pairsWith).toEqual([]);
    expect(closed).toBe(1);
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
  it('the later arrow moves a card later', () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', 'b2_sunmane'] });
    const core = c.querySelector('.gedit-row[data-row="core"]')!;
    click(core.querySelector('.gedit-unit[data-card="grim"] .gedit-later')!);
    expect([...core.querySelectorAll('.gedit-unit')].map((u) => u.getAttribute('data-card'))).toEqual(['b2_sunmane', 'grim']);
  });
  it('a card keeps its portrait (the same element) when it is moved', () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', 'b2_sunmane'] });
    const core = c.querySelector('.gedit-row[data-row="core"]')!;
    const before = core.querySelector('.gedit-unit[data-card="grim"]');
    click(core.querySelector('.gedit-unit[data-card="grim"] .gedit-later')!);
    expect(core.querySelector('.gedit-unit[data-card="grim"]')).toBe(before);
  });
  it('after the picker closes, by a pick or by Esc, focus returns to the Add button of its row', () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'] });
    const add = c.querySelector<HTMLButtonElement>('.gedit-row[data-row="core"] .gedit-add')!;
    click(add);
    click(c.querySelector('.gpick .gpick-row')!);
    expect(document.activeElement).toBe(c.querySelector('.gedit-row[data-row="core"] .gedit-add'));
    click(c.querySelector('.gedit-row[data-row="enablers"] .gedit-add')!);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(c.querySelector('.gedit-row[data-row="enablers"] .gedit-add'));
  });
  it('a card that is in a row twice (a malformed kept draft) still renders both, without a duplicate-key warning', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', 'grim'] });
      expect(c.querySelectorAll('.gedit-row[data-row="core"] .gedit-unit')).toHaveLength(2);
      expect(spy.mock.calls.filter((a) => String(a[0]).includes('same key'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
  it('the Add button is disabled at the limit', () => {
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
  it('while a save is on its way nothing can be typed or added, and after a refusal the fields work again with the text intact', async () => {
    const release = hold();
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Keep me');
    await press(c, 'Save');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.matches(':disabled')).toBe(true);
    expect(c.querySelector<HTMLTextAreaElement>('.gedit-body')!.matches(':disabled')).toBe(true);
    expect([...c.querySelectorAll<HTMLButtonElement>('.gedit-add')].every((b) => b.matches(':disabled'))).toBe(true);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.matches(':disabled')).toBe(false);
    expect(c.querySelector<HTMLButtonElement>('.gedit-add')!.matches(':disabled')).toBe(false);
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Keep me');
  });
  it('a save that lands after the editor has gone still reaches the list and clears the kept draft, and closes nothing', async () => {
    const release = hold();
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Sent then closed');
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')!.title).toBe('Sent then closed');
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Sent then closed']);
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(closed).toBe(0);
  });
  it('a save that lands after its author signed out, or after another account signed in, is not added to that list', async () => {
    for (const next of [null, { userId: 'u-2', displayName: 'Other', anonymous: false, email: 'x@example.test' }]) {
      setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
      resetGuidesForTests();
      localStorage.clear();
      const release = hold();
      const c = open();
      type(c.querySelector('.gedit-title')!, 'Sent then left');
      await press(c, 'Save');
      ui!.unmount();
      ui = null;
      setIdentity(next); // the author is gone before the answer arrives
      await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
      expect(useGuides.getState().mine, String(next?.userId)).toEqual([]);
      expect(useGuides.getState().mineOwner, String(next?.userId)).toBeNull();
      // The guide did reach the server, so the author's own device slot no longer offers it as unsaved.
      expect(loadLocalDraft('u-1'), String(next?.userId)).toBeNull();
    }
  });
  it('a save that lands after the editor has gone leaves a different kept draft alone', async () => {
    const release = hold();
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Sent then closed');
    await press(c, 'Save');
    ui!.unmount();
    ui = null;
    saveLocalDraft('u-1', { ...emptyDraft('Mike'), title: 'Another editor wrote this' });
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Sent then closed']);
    expect(loadLocalDraft('u-1')!.title).toBe('Another editor wrote this');
  });
  it('a refused save that lands after the editor has gone leaves the kept draft and the list as they were', async () => {
    const release = hold();
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Sent then closed');
    await press(c, 'Save');
    ui!.unmount();
    ui = null;
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(loadLocalDraft('u-1')!.title).toBe('Sent then closed');
    expect(useGuides.getState().mine).toEqual([]);
    expect(closed).toBe(0);
  });
  it('a delete that lands after the editor has gone still removes the guide from the list and clears the kept draft', async () => {
    useGuides.setState({ mine: [{ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' }] });
    let release!: () => void;
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Changed');
    deleteGate = new Promise<void>((res) => { release = res; });
    await press(c, 'Delete');
    await press(c, 'Delete for good');
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')!.title).toBe('Changed');
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(useGuides.getState().mine).toEqual([]);
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(closed).toBe(0);
  });
  it('Load their version for a guide that is gone turns the text into a new guide', async () => {
    let n = 0;
    saveAnswer = (g) => (n++ === 0 ? { ok: false, code: 'conflict' } : { ok: true, value: rec({ title: g.title }) });
    byIdAnswer = null;
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    await press(c, 'Load their version');
    expect(alertText(c)).toBe('This guide was deleted. Press Save again to keep your text as a new guide.');
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Mine');
    await press(c, 'Save');
    expect(saves).toHaveLength(2);
    expect('id' in saves[1]!).toBe(false);
    expect('revision' in saves[1]!).toBe(false);
    expect(saves[1]).toMatchObject({ title: 'Mine' });
  });
  it('Overwrite with mine for a guide that is gone turns the text into a new guide', async () => {
    let n = 0;
    saveAnswer = (g) => (n++ === 0 ? { ok: false, code: 'conflict' } : { ok: true, value: rec({ title: g.title }) });
    byIdAnswer = null;
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    await press(c, 'Overwrite with mine');
    expect(alertText(c)).toBe('This guide was deleted. Press Save again to keep your text as a new guide.');
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Mine');
    expect(saves).toHaveLength(1);
    await press(c, 'Save');
    expect(saves).toHaveLength(2);
    expect('id' in saves[1]!).toBe(false);
    expect('revision' in saves[1]!).toBe(false);
  });
  it('a refetch that could not reach the server keeps the offline sentence', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = undefined;
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    await press(c, 'Load their version');
    expect(alertText(c)).toMatch(/kept on this device/);
  });
  it('the editor closes once, however many times it is asked to', () => {
    const c = open();
    const title = c.querySelector('.gedit-title')!;
    act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(closed).toBe(1);
  });
  it('an existing guide opened unchanged can be saved as it stands', async () => {
    const c = open(existing());
    expect(c.querySelector<HTMLButtonElement>('.gbtn-primary')!.disabled).toBe(false);
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ id: ROW, revision: 5 });
  });
  it('a save answered not found turns the text into a new guide, which the next Save sends without an id', async () => {
    let n = 0;
    saveAnswer = (g) => (n++ === 0 ? { ok: false, code: 'not_found' } : { ok: true, value: rec({ title: g.title }) });
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Still mine');
    await press(c, 'Save');
    expect(alertText(c)).toBe('This guide was deleted. Press Save again to keep your text as a new guide.');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Still mine');
    expect(closed).toBe(0);
    expect([...c.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Delete')).toBe(false);
    await press(c, 'Save');
    expect(saves).toHaveLength(2);
    expect('id' in saves[1]!).toBe(false);
    expect('revision' in saves[1]!).toBe(false);
    expect(saves[1]).toMatchObject({ title: 'Still mine' });
    expect(closed).toBe(1);
  });
  it('a half-typed nickname stops the save, whichever half is missing', async () => {
    const sentence = 'Finish or remove the nickname that is missing its word or its card.';
    for (const row of [{ word: 'cat', card: '' }, { word: '  ', card: 'grim' }]) {
      ui?.unmount();
      const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], aliases: [row] });
      await press(c, 'Save');
      expect(alertText(c)).toBe(sentence);
    }
    expect(saves).toEqual([]);
  });
  it('a refused save is written to the device at once', async () => {
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Keep me');
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')!.title).toBe('Keep me');
  });
  it('the conflict prompt takes focus itself, not a button, so a stray Enter does nothing', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    const active = document.activeElement as HTMLElement;
    expect(active.getAttribute('role')).toBe('alertdialog');
    expect(active.tagName).not.toBe('BUTTON');
    act(() => { active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Mine');
    expect(saves).toHaveLength(1);
    expect(fetches).toBe(0);
  });
  it('a save answered not found also drops the dead guide from the list', async () => {
    useGuides.setState({ mine: [{ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' }] });
    saveAnswer = () => ({ ok: false, code: 'not_found' });
    const c = open(existing());
    await press(c, 'Save');
    expect(useGuides.getState().mine).toEqual([]);
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
    await pause();
    expect(loadLocalDraft('u-1')!.title).toBe('Changed');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('Cancel closes without asking after Load their version', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    await press(c, 'Load their version');
    await press(c, 'Cancel');
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(closed).toBe(1);
  });
  it('the confirm bar takes focus on its safe button when it appears', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Changed');
    act(() => { c.querySelector('.gedit-title')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.activeElement?.textContent).toBe('Keep editing');
  });
  it('an unprompted close keeps the typed text on the device', () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Typed just now');
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')!.title).toBe('Typed just now');
  });
  it('closing with nothing changed writes nothing to the device', () => {
    open();
    ui!.unmount();
    ui = null;
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
    await pause();
    expect(loadLocalDraft('u-1')!.title).toBe('Changed');
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
  it('Esc with a card inspect open closes only the inspect, even with unsaved changes', () => {
    const c = open();
    const title = c.querySelector<HTMLInputElement>('.gedit-title')!;
    type(title, 'Changed');
    act(() => { useGame.setState({ inspect: { name: 'Looked at' } as never }); });
    const reached: string[] = [];
    const game = (e: KeyboardEvent): void => { reached.push(e.key); };
    window.addEventListener('keydown', game);
    try {
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    } finally {
      window.removeEventListener('keydown', game);
    }
    expect(useGame.getState().inspect).toBeNull();
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(closed).toBe(0);
    expect(reached).toEqual([]);
  });
  it('with the bug reporter open, Esc and Tab pass through and the editor does nothing', () => {
    const c = open();
    const title = c.querySelector<HTMLInputElement>('.gedit-title')!;
    type(title, 'Changed');
    act(() => { useGame.setState({ bugReportOpen: true }); });
    const reached: string[] = [];
    const game = (e: KeyboardEvent): void => { reached.push(e.key); };
    window.addEventListener('keydown', game);
    try {
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    } finally {
      window.removeEventListener('keydown', game);
    }
    expect(reached).toEqual(['Escape', 'Tab']);
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(closed).toBe(0);
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

describe('the device slot', () => {
  // The device keeps ONE in-progress guide, which may be another guide than the one open in the editor. The editor only
  // ever undoes or clears ITS OWN write to it.
  const X = { ...emptyDraft('Mike'), title: 'Other unsaved guide', body: 'x', core: ['grim'] };
  const resumed = { ...emptyDraft('Mike'), title: 'Resumed', body: 'B', core: ['grim'] };
  const title = (c: HTMLElement): HTMLInputElement => c.querySelector<HTMLInputElement>('.gedit-title')!;

  it('a new guide: type, pause, undo, Cancel leaves the slot empty', async () => {
    const c = open();
    type(title(c), 'My guidex');
    await pause();
    expect(loadLocalDraft('u-1')!.title).toBe('My guidex');
    type(title(c), 'My guide');
    await press(c, 'Cancel');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a saved guide: type, pause, undo, Cancel leaves the slot empty', async () => {
    const saved = existing();
    const c = open(saved);
    type(title(c), `${saved.title}x`);
    await pause();
    expect(loadLocalDraft('u-1')!.title).toBe(`${saved.title}x`);
    type(title(c), saved.title);
    await press(c, 'Cancel');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a saved guide: a refused save, then undo, Cancel leaves the slot empty', async () => {
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const saved = existing();
    const c = open(saved);
    type(title(c), `${saved.title}x`);
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')!.title).toBe(`${saved.title}x`);
    type(title(c), saved.title);
    await press(c, 'Cancel');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a saved guide opened unchanged whose save is refused writes nothing to the slot', async () => {
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open(existing());
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    expect(alertText(c)).toBe('Could not reach the server. Try again.'); // nothing was kept, so nothing says it was
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a resumed draft: change nothing, Cancel leaves it in the slot', async () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    await press(c, 'Cancel');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toEqual(resumed);
  });
  it('a resumed draft: type, pause, undo, Cancel puts it back in the slot', async () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    type(title(c), 'Resumedx');
    await pause();
    expect(loadLocalDraft('u-1')!.title).toBe('Resumedx');
    type(title(c), 'Resumed');
    await press(c, 'Cancel');
    expect(closed).toBe(1);
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(loadLocalDraft('u-1')).toEqual(resumed);
  });
  it('a resumed draft: type, pause, then an unprompted close keeps the typed draft in the slot', async () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    type(title(c), 'Resumedx');
    await pause();
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')).toEqual({ ...resumed, title: 'Resumedx' });
  });
  it('another guide in the slot survives a quick type-and-undo in a saved guide', async () => {
    saveLocalDraft('u-1', X);
    const saved = existing();
    const c = open(saved);
    type(title(c), `${saved.title}x`);
    type(title(c), saved.title);
    await press(c, 'Cancel');
    expect(closed).toBe(1);
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(loadLocalDraft('u-1')).toEqual(X);
  });
  it('another guide in the slot, overwritten after the pause, is put back when the change is undone', async () => {
    saveLocalDraft('u-1', X);
    const saved = existing();
    const c = open(saved);
    type(title(c), `${saved.title}x`);
    await pause();
    expect(loadLocalDraft('u-1')!.title).toBe(`${saved.title}x`); // one slot, by design
    type(title(c), saved.title);
    expect(loadLocalDraft('u-1')).toEqual(X);
  });
  it('another guide in the slot survives deleting an unchanged saved guide', async () => {
    saveLocalDraft('u-1', X);
    useGuides.setState({ mine: [{ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' }] });
    const c = open(existing());
    await press(c, 'Delete');
    await press(c, 'Delete for good');
    expect(deletes).toEqual([ROW]);
    expect(useGuides.getState().mine).toEqual([]);
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toEqual(X);
  });
  it('another guide in the slot survives an unchanged saved guide being opened and closed, saved, or reloaded from the server', async () => {
    saveLocalDraft('u-1', X);
    open(existing());
    ui!.unmount();
    expect(loadLocalDraft('u-1')).toEqual(X);
    let c = open(existing());
    await press(c, 'Save');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toEqual(X);
    ui!.unmount();
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    c = open(existing());
    await press(c, 'Save');
    await press(c, 'Load their version');
    expect(title(c).value).toBe('Theirs');
    expect(loadLocalDraft('u-1')).toEqual(X);
  });
  it('Load their version drops the editor\'s own write from the slot', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(existing());
    type(title(c), 'Mine');
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')!.title).toBe('Mine');
    await press(c, 'Load their version');
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('Load their version on a resumed draft that was not changed takes that stale draft out of the slot', async () => {
    // The author resumed an unsaved edit of a saved guide, pressed Save, and chose the server's version instead.
    const stale = existing({ title: 'My stale edit' });
    saveLocalDraft('u-1', stale);
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(stale);
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')).toEqual(stale); // still offered while the question is up
    await press(c, 'Load their version');
    expect(title(c).value).toBe('Theirs');
    expect(loadLocalDraft('u-1')).toBeNull();
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a resumed draft leaves the slot when it is saved', async () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a resumed draft leaves the slot when a change to it is discarded', async () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    type(title(c), 'Resumedx');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a save that lands after the editor closed takes a resumed draft out of the slot, and leaves another guide there alone', async () => {
    let release = hold();
    saveLocalDraft('u-1', resumed);
    let c = open(resumed);
    await press(c, 'Save');
    ui!.unmount();
    expect(loadLocalDraft('u-1')).toEqual(resumed);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(loadLocalDraft('u-1')).toBeNull();
    release = hold();
    saveLocalDraft('u-1', X);
    c = open(existing());
    await press(c, 'Save');
    ui!.unmount();
    ui = null;
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    expect(saves).toHaveLength(2);
    expect(loadLocalDraft('u-1')).toEqual(X);
    expect(closed).toBe(0);
  });
  it('a new guide: type, Save leaves the slot empty', async () => {
    const c = open();
    type(title(c), 'Brand new');
    await press(c, 'Save');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
    ui!.unmount();
    ui = null;
    expect(loadLocalDraft('u-1')).toBeNull();
  });
});

describe('what a refused save says about the device', () => {
  const title = (c: HTMLElement): HTMLInputElement => c.querySelector<HTMLInputElement>('.gedit-title')!;
  it('with unsaved changes the draft is written to the device, and the sentence says it is kept there', async () => {
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open();
    type(title(c), 'Keep me');
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')!.title).toBe('Keep me');
    expect(alertText(c)).toBe('Could not reach the server. Your guide is kept on this device.');
  });
  it('with nothing changed nothing is written, and the sentence does not say it was', async () => {
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open(existing());
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(alertText(c)).toBe('Could not reach the server. Try again.');
    expect(alertText(c)).not.toContain('kept on this device');
  });
  it('a resumed draft that was not changed is already on the device, so the sentence says it is kept', async () => {
    const resumed = { ...emptyDraft('Mike'), title: 'Resumed', body: 'B', core: ['grim'] };
    saveLocalDraft('u-1', resumed);
    saveAnswer = () => ({ ok: false, code: 'offline' });
    const c = open(resumed);
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')).toEqual(resumed);
    expect(alertText(c)).toBe('Could not reach the server. Your guide is kept on this device.');
  });
  it('when the device cannot keep anything (storage is refused), the sentence does not say it was kept', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      saveAnswer = () => ({ ok: false, code: 'offline' });
      const c = open();
      type(title(c), 'Keep me');
      await press(c, 'Save');
      expect(alertText(c)).toBe('Could not reach the server. Try again.');
      expect(title(c).value).toBe('Keep me'); // the text is still in the editor
    } finally {
      spy.mockRestore();
    }
  });
  it('a refetch that could not reach the server, with nothing changed, does not say anything was kept', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = undefined;
    const c = open(existing());
    await press(c, 'Save');
    await press(c, 'Load their version');
    expect(alertText(c)).toBe('Could not reach the server. Try again.');
  });
});

describe('a delete that cannot go through says so in its own words', () => {
  const guide = (): Record<string, unknown> => ({ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' });
  const tryDelete = async (answer: GuideWriteResult<true>): Promise<HTMLElement> => {
    ui?.unmount();
    deleteAnswer = () => answer;
    useGuides.setState({ mine: [guide() as never], mineOwner: 'u-1' });
    const c = open(existing());
    await press(c, 'Delete');
    await press(c, 'Delete for good');
    return c;
  };
  it('offline: the guide was not deleted, and nothing is said about saving or the device', async () => {
    const c = await tryDelete({ ok: false, code: 'offline' });
    expect(alertText(c)).toBe('Could not reach the server. The guide was not deleted.');
    expect(closed).toBe(0);
    expect(useGuides.getState().mine).toHaveLength(1);
    expect(c.querySelector('.gedit-ask')).toBeNull();
  });
  it('any other failure: it was not deleted', async () => {
    for (const code of ['server', 'guide_failed', 'rate_limited', 'unavailable']) {
      expect(alertText(await tryDelete({ ok: false, code })), code).toBe('Something went wrong deleting the guide. It was not deleted.');
    }
    expect(closed).toBe(0);
  });
  it('a refusal with a more exact sentence keeps it', async () => {
    expect(alertText(await tryDelete({ ok: false, code: 'not_allowed' }))).toBe('You cannot change this guide. Duplicate it to make your own.');
    expect(alertText(await tryDelete({ ok: false, code: 'unauthenticated' }))).toBe('Sign in to write guides.');
    expect(alertText(await tryDelete({ ok: false, code: 'sign_in_required' }))).toBe('Sign in to write guides.');
  });
});

describe('leaving a resumed guide that was never saved', () => {
  const WHOLE = 'Discard this unsaved guide? It cannot be brought back.';
  const resumed = { ...emptyDraft('Mike'), title: 'Resumed', body: 'B', core: ['grim'] };
  const title = (c: HTMLElement): HTMLInputElement => c.querySelector<HTMLInputElement>('.gedit-title')!;
  it('Cancel with changes asks the Resume bar\'s own question, because Discard removes the whole guide', async () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    type(title(c), 'Resumedx');
    await press(c, 'Cancel');
    expect(c.querySelector('.gedit-ask')!.textContent).toContain(WHOLE);
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(c.querySelector('.gedit-ask')!.getAttribute('aria-label')).toBe('Discard this unsaved guide?');
    await press(c, 'Discard');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('Esc with changes asks the same question', () => {
    saveLocalDraft('u-1', resumed);
    const c = open(resumed);
    type(title(c), 'Resumedx');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(c.querySelector('.gedit-ask')!.textContent).toContain(WHOLE);
    expect(c.textContent).not.toContain('Discard your changes?');
  });
  it('a new guide that did not come from the device still asks about its changes', async () => {
    const c = open();
    type(title(c), 'Changed');
    await press(c, 'Cancel');
    expect(c.textContent).toContain('Discard your changes?');
    expect(c.textContent).not.toContain(WHOLE);
  });
  it('a resumed edit of a guide that IS saved asks about its changes: the guide itself stays on the server', async () => {
    const stale = existing({ title: 'My unsaved edit' });
    saveLocalDraft('u-1', stale);
    const c = open(stale);
    type(title(c), 'My unsaved edit, more');
    await press(c, 'Cancel');
    expect(c.textContent).toContain('Discard your changes?');
    expect(c.textContent).not.toContain(WHOLE);
  });
  it('another guide waiting on the device does not change the question for a new guide', async () => {
    saveLocalDraft('u-1', { ...emptyDraft('Mike'), title: 'Other unsaved guide', body: 'x', core: ['grim'] });
    const c = open();
    type(title(c), 'Changed');
    await press(c, 'Cancel');
    expect(c.textContent).toContain('Discard your changes?');
  });
});

describe('Esc answers the question that is showing', () => {
  const esc = (): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }); };
  const title = (c: HTMLElement): HTMLInputElement => c.querySelector<HTMLInputElement>('.gedit-title')!;
  it('with the delete question up and nothing changed, Esc takes the question away and the editor stays', async () => {
    const c = open(existing());
    await press(c, 'Delete');
    expect(c.querySelector('.gedit-ask')).not.toBeNull();
    esc();
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(closed).toBe(0);
    expect(deletes).toEqual([]);
    esc(); // no question now, nothing changed: this one leaves
    expect(closed).toBe(1);
  });
  it('with the delete question up and unsaved changes, Esc takes the question away and asks nothing else', async () => {
    const c = open(existing());
    type(title(c), 'Changed');
    await press(c, 'Delete');
    esc();
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(closed).toBe(0);
    expect(title(c).value).toBe('Changed');
  });
  it('with the discard question up, Esc takes it away, keeps the text, and the next Esc asks again', async () => {
    const c = open();
    type(title(c), 'Changed');
    await press(c, 'Cancel');
    expect(c.textContent).toContain('Discard your changes?');
    esc();
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(closed).toBe(0);
    expect(title(c).value).toBe('Changed');
    esc();
    expect(c.textContent).toContain('Discard your changes?');
    expect(closed).toBe(0);
  });
  it('with the conflict question up, Esc takes it away: nothing is loaded, overwritten or discarded', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    const c = open(existing());
    type(title(c), 'Mine');
    await press(c, 'Save');
    expect(c.querySelector('.gedit-ask')!.textContent).toContain('Someone else saved this guide while you were editing.');
    esc();
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(c.textContent).not.toContain('Discard your changes?');
    expect(closed).toBe(0);
    expect(fetches).toBe(0);
    expect(saves).toHaveLength(1);
    expect(title(c).value).toBe('Mine');
    expect(loadLocalDraft('u-1')!.title).toBe('Mine');
  });
  it('the card picker still closes first, then the question, then the editor', async () => {
    const c = open(existing());
    await press(c, 'Delete');
    click(c.querySelector('.gedit-row[data-row="core"] .gedit-add')!);
    expect(c.querySelector('.gpick')).not.toBeNull();
    esc();
    expect(c.querySelector('.gpick')).toBeNull();
    expect(c.querySelector('.gedit-ask')).not.toBeNull();
    esc();
    expect(c.querySelector('.gedit-ask')).toBeNull();
    expect(closed).toBe(0);
  });
  it('a card inspect over a question closes first and leaves the question up', async () => {
    const c = open(existing());
    await press(c, 'Delete');
    act(() => { useGame.setState({ inspect: { name: 'Looked at' } as never }); });
    esc();
    expect(useGame.getState().inspect).toBeNull();
    expect(c.querySelector('.gedit-ask')).not.toBeNull();
  });
});

describe('the write-up is one paragraph, and the box says so', () => {
  const body = (c: HTMLElement): HTMLTextAreaElement => c.querySelector<HTMLTextAreaElement>('.gedit-body')!;
  it('Enter in the write-up adds no line break, and does nothing else', () => {
    const c = open();
    type(body(c), 'One line');
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => { body(c).dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(body(c).value).toBe('One line');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(closed).toBe(0);
    expect(saves).toEqual([]);
    expect(c.querySelector('.gedit-ask')).toBeNull();
  });
  it('Enter is left alone in the title, the tagline and the card search', () => {
    const c = open();
    click(c.querySelector('.gedit-row[data-row="enablers"] .gedit-add')!);
    for (const sel of ['.gedit-title', '.gedit-tagline', '.gedit-byline']) {
      const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      act(() => { c.querySelector(sel)!.dispatchEvent(e); });
      expect(e.defaultPrevented, sel).toBe(false);
    }
  });
  it('other keys in the write-up are left alone', () => {
    const c = open();
    for (const key of ['a', ' ', 'Backspace', 'ArrowDown']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => { body(c).dispatchEvent(e); });
      expect(e.defaultPrevented, key).toBe(false);
    }
  });
  it('a pasted two-line text is stored with one space where the break was', async () => {
    const c = open();
    type(body(c), 'First line.\nSecond line.');
    expect(body(c).value).toBe('First line. Second line.');
    await press(c, 'Save');
    expect(saves[0]!.body).toBe('First line. Second line.');
  });
  it('blank lines, Windows line ends and spaces around a break all become that one space', () => {
    const c = open();
    type(body(c), 'One.  \r\n\r\n   Two.\n\n\nThree.');
    expect(body(c).value).toBe('One. Two. Three.');
  });
  it('spaces that are not around a line break are left as typed', () => {
    const c = open();
    type(body(c), 'Two  spaces and a trailing one ');
    expect(body(c).value).toBe('Two  spaces and a trailing one ');
  });
});

describe('where the keyboard is when the editor opens', () => {
  it('the title box has focus', () => {
    const c = open();
    expect(document.activeElement).toBe(c.querySelector('.gedit-title'));
  });
  it('it is taken once: a question that takes focus later keeps it', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Changed');
    await press(c, 'Cancel');
    expect(document.activeElement?.textContent).toBe('Keep editing');
    type(c.querySelector('.gedit-tagline')!, 'More'); // a re-render does not pull focus back to the title
    expect(document.activeElement).not.toBe(c.querySelector('.gedit-title'));
  });
});

describe('what the editor reports when it closes', () => {
  it('a NEW guide of the player\'s own that was saved: yes', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Brand new');
    await press(c, 'Save');
    expect(closedWith).toEqual([true]);
  });
  it('a guide that became new because it was deleted elsewhere, then saved: yes', async () => {
    let n = 0;
    saveAnswer = (g) => (n++ === 0 ? { ok: false, code: 'not_found' } : { ok: true, value: rec({ title: g.title }) });
    const c = open(existing());
    await press(c, 'Save');
    await press(c, 'Save');
    expect(closedWith).toEqual([true]);
  });
  it('an edit of a guide the player already had: no', async () => {
    const c = open(existing());
    type(c.querySelector('.gedit-title')!, 'Edited');
    await press(c, 'Save');
    expect(closedWith).toEqual([false]);
  });
  it('a new Team Ascent guide: no (it does not go to My guides)', async () => {
    saveAnswer = (g) => ({ ok: true, value: rec({ official: true, byline: 'Team Ascent', title: g.title, authorId: null }) });
    const c = open(undefined, true);
    await press(c, 'Team Ascent guide');
    await press(c, 'Save');
    expect(closedWith).toEqual([false]);
  });
  it('Cancel, a confirmed discard and a delete: no', async () => {
    await press(open(), 'Cancel');
    ui!.unmount();
    let c = open();
    type(c.querySelector('.gedit-title')!, 'Changed');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    ui!.unmount();
    c = open(existing());
    await press(c, 'Delete');
    await press(c, 'Delete for good');
    expect(closedWith).toEqual([false, false, false]);
  });
});

describe('the look values the stylesheets must not drift back to', () => {
  const css = (name: string): string => readFileSync(join(__dirname, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the panels use the Compendium\'s chip background and its 7px corner; the badge its 12.5px text', () => {
    const both = css('guideEditor.css') + css('compendiumGuides.css');
    expect(both).not.toContain('rgba(0, 0, 0, 0.28)');
    expect(both).not.toMatch(/border-radius:\s*8px/);
    for (const rule of [/\.gpick \{[^}]*\}/, /\.gedit-ask \{[^}]*\}/, /\.gtool-note \{[^}]*\}/]) {
      const body = both.match(rule)?.[0] ?? '';
      expect(body, String(rule)).toContain('border-radius: 7px');
      expect(body, String(rule)).toContain('background: var(--ui-chip-bg)');
    }
    expect(both.match(/\.gedit-preview \{[^}]*\}/)![0]).toContain('border-radius: 7px');
    expect(both.match(/\.bookguide-badge \{[^}]*\}/)![0]).toContain('font-size: 12.5px');
  });
  it('the dashed off-roster rule, which could not be seen, is gone; and no stylesheet sets a cursor', () => {
    const both = css('guideEditor.css') + css('compendiumGuides.css');
    expect(both).not.toContain('off-roster');
    expect(both).not.toMatch(/cursor\s*:/);
  });
});

it('the editor carries no native tooltip', () => {
  expect(open().querySelector('[title]')).toBeNull();
});
