// @vitest-environment jsdom
/**
 * PATCH NOTES TABS (owner ask 2026-09-23): "tabs that carry game related balance/cards/heroes etc and then a
 * systems tab that carries dev updates and systems changes." Pins: the viewer opens on the Game tab; the Game
 * tab lists ONLY `Balance` changes and hides every dated entry that has none; the Systems tab is the converse;
 * the per-change category chip is gone (the tab already says it) while the date + label header stays; the
 * chosen tab is written to `ascent.patchnotes.tab` and honoured on the next open; the Summary / Detailed
 * toggle keeps working on either tab; the tablist is keyboard-reachable (role="tablist" / "tab" with
 * aria-selected, arrow keys move); no `title=` attribute anywhere (the owner banned native tooltips).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import { PATCH_NOTES, type PatchCategory, type PatchNote } from './patchNotes';
import { sfx } from './sfx';
import { useGame } from './store';
import { PATCH_TAB_STORAGE_KEY, PatchNotes, notesForTab } from './PatchNotesOverlay';

let ui: Mounted | null = null;

const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
// jsdom has no PointerEvent constructor; React routes by event NAME, so a plain bubbling Event reaches onPointerDown.
const pointerDown = (el: Element | null | undefined): void => {
  act(() => { el!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
};
const tabs = (root: ParentNode): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const selectedTab = (root: ParentNode): string => (root.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? '').trim();
const listedTexts = (root: ParentNode): string[] =>
  [...root.querySelectorAll('.pnlist > li')].map((li) => {
    // The change's own summary line is the li's first text node (its sub-list, when open, is a child element).
    const first = [...li.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    return (first?.textContent ?? '').trim();
  });
const headers = (root: ParentNode): string[] => [...root.querySelectorAll('.pnpatch .pnpatchhead')].map((h) => (h.textContent ?? '').trim());

const textsOf = (cat: PatchCategory, notes: PatchNote[]): Set<string> =>
  new Set(notes.flatMap((n) => n.changes.filter((c) => c.category === cat).map((c) => c.text)));
const entriesWith = (cat: PatchCategory, notes: PatchNote[]): number => notes.filter((n) => n.changes.some((c) => c.category === cat)).length;

function open(): Mounted {
  useGame.setState({ showPatchNotes: true });
  ui = mount(<PatchNotes />);
  return ui;
}

beforeEach(() => {
  try { localStorage.removeItem(PATCH_TAB_STORAGE_KEY); } catch { /* jsdom storage is always there */ }
  vi.spyOn(sfx, 'tick').mockImplementation(() => {});
});
afterEach(() => {
  ui?.unmount(); ui = null;
  vi.restoreAllMocks();
  useGame.setState({ showPatchNotes: false });
  try { localStorage.removeItem(PATCH_TAB_STORAGE_KEY); } catch { /* ignore */ }
});

describe('PatchNotes tabs', () => {
  it('the real data has at least one entry in each bucket, so the tab assertions below are not vacuous', () => {
    expect(entriesWith('Balance', PATCH_NOTES)).toBeGreaterThan(0);
    expect(entriesWith('Systems', PATCH_NOTES)).toBeGreaterThan(0);
    // And at least one entry is single-bucket, so "hidden on the other tab" is actually exercised.
    expect(PATCH_NOTES.some((n) => n.changes.every((c) => c.category === 'Systems'))).toBe(true);
  });

  it('notesForTab keeps only the changes of that category and drops entries with none of them', () => {
    const notes: PatchNote[] = [
      { date: '2026-09-23', label: 'Both', changes: [{ category: 'Balance', text: 'b1' }, { category: 'Systems', text: 's1' }, { category: 'Balance', text: 'b2' }] },
      { date: '2026-09-22', label: 'Sys only', changes: [{ category: 'Systems', text: 's2' }] },
      { date: '2026-09-21', label: 'Game only', changes: [{ category: 'Balance', text: 'b3' }] },
    ];
    const game = notesForTab('Balance', notes);
    expect(game.map((e) => e.note.label)).toEqual(['Both', 'Game only']);
    expect(game.map((e) => e.items.map((c) => c.text))).toEqual([['b1', 'b2'], ['b3']]);
    const sys = notesForTab('Systems', notes);
    expect(sys.map((e) => e.note.label)).toEqual(['Both', 'Sys only']);
    expect(sys.map((e) => e.items.map((c) => c.text))).toEqual([['s1'], ['s2']]);
  });

  it('opens on the Game tab by default and lists only Balance changes, hiding Balance-less entries', () => {
    const { container } = open();
    expect(tabs(container).map((t) => t.textContent)).toEqual(['Game', 'Systems']);
    expect(selectedTab(container)).toBe('Game');
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelectorAll('.pnpatch').length).toBe(entriesWith('Balance', PATCH_NOTES));
    const balance = textsOf('Balance', PATCH_NOTES);
    const listed = listedTexts(container);
    expect(listed.length).toBe(PATCH_NOTES.flatMap((n) => n.changes).filter((c) => c.category === 'Balance').length);
    for (const t of listed) expect(balance.has(t), `Game tab listed a non-Balance change: ${t}`).toBe(true);
    // The category chip is gone; the date + label header stays.
    expect(container.querySelector('.pntag')).toBeNull();
    expect(headers(container).length).toBe(entriesWith('Balance', PATCH_NOTES));
    expect(headers(container)[0]).toMatch(/\d{4}/);
  });

  it('the Systems tab lists only Systems changes and hides Systems-less entries', () => {
    const { container } = open();
    click(tabs(container)[1]);
    expect(selectedTab(container)).toBe('Systems');
    expect(container.querySelectorAll('.pnpatch').length).toBe(entriesWith('Systems', PATCH_NOTES));
    const systems = textsOf('Systems', PATCH_NOTES);
    const listed = listedTexts(container);
    expect(listed.length).toBe(PATCH_NOTES.flatMap((n) => n.changes).filter((c) => c.category === 'Systems').length);
    for (const t of listed) expect(systems.has(t), `Systems tab listed a non-Systems change: ${t}`).toBe(true);
    expect(container.querySelector('.pntag')).toBeNull();
  });

  it('remembers the chosen tab in localStorage and honours it on the next open', () => {
    const first = open();
    click(tabs(first.container)[1]);
    expect(localStorage.getItem(PATCH_TAB_STORAGE_KEY)).toBe('Systems');
    first.unmount(); ui = null;

    const second = open();
    expect(selectedTab(second.container)).toBe('Systems');
    click(tabs(second.container)[0]);
    expect(localStorage.getItem(PATCH_TAB_STORAGE_KEY)).toBe('Balance');
  });

  it('ignores a garbage stored value and falls back to Game', () => {
    localStorage.setItem(PATCH_TAB_STORAGE_KEY, 'nonsense');
    const { container } = open();
    expect(selectedTab(container)).toBe('Game');
  });

  it('the Summary / Detailed toggle works on either tab and survives a tab switch', () => {
    const { container } = open();
    expect(container.querySelector('.pnsublist')).toBeNull();
    const detailedBtn = [...container.querySelectorAll('.pntoggle-btn')].find((b) => b.textContent === 'Detailed');
    pointerDown(detailedBtn);
    const balanceWithDetails = PATCH_NOTES.flatMap((n) => n.changes).filter((c) => c.category === 'Balance' && (c.details?.length ?? 0) > 0).length;
    expect(container.querySelectorAll('.pnsublist').length).toBe(balanceWithDetails);
    click(tabs(container)[1]);
    const systemsWithDetails = PATCH_NOTES.flatMap((n) => n.changes).filter((c) => c.category === 'Systems' && (c.details?.length ?? 0) > 0).length;
    expect(container.querySelectorAll('.pnsublist').length).toBe(systemsWithDetails);
    expect(container.querySelector('.pntoggle-btn.on')?.textContent).toBe('Detailed');
  });

  it('arrow keys move between tabs and the tabpanel is labelled by the selected tab', () => {
    const { container } = open();
    const [game, systems] = tabs(container);
    expect(game.tabIndex).toBe(0);
    expect(systems.tabIndex).toBe(-1);
    act(() => { game.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(selectedTab(container)).toBe('Systems');
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs(container)[1].id);
    act(() => { tabs(container)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
    expect(selectedTab(container)).toBe('Game');
  });

  it('carries no native title= tooltip anywhere in the viewer', () => {
    const { container } = open();
    expect(container.querySelectorAll('[title]').length).toBe(0);
  });
});
