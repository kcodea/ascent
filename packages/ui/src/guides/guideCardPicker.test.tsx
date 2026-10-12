// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, poolFor } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { GuideCardPicker } from './GuideCardPicker';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const type = (el: HTMLInputElement, value: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const rows = (c: HTMLElement): string[] => [...c.querySelectorAll('.gpick-row .gpick-name')].map((n) => n.textContent!);
const grim = CARD_INDEX['grim']!;

describe('the guide card picker', () => {
  it('lists this set\'s cards by name, at most twelve at a time', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={() => {}} />);
    const shown = rows(ui.container);
    expect(shown.length).toBe(12);
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b)));
    const inSet = new Set(poolFor('set2').all.map((c) => c.name));
    for (const n of shown) expect(inSet.has(n), n).toBe(true);
  });
  it('narrows as you type, every word must match, capitals ignored', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={() => {}} />);
    type(ui.container.querySelector('input')!, grim.name.toUpperCase());
    expect(rows(ui.container)).toContain(grim.name);
    type(ui.container.querySelector('input')!, 'zzzz no such card');
    expect(rows(ui.container)).toEqual([]);
    expect(ui.container.textContent).toContain('No card matches.');
  });
  it('leaves out the cards already in the row', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" exclude={['grim']} onPick={() => {}} />);
    type(ui.container.querySelector('input')!, grim.name);
    expect(rows(ui.container)).not.toContain(grim.name);
  });
  it('a click picks that card; Enter picks the top match', () => {
    const onPick = vi.fn();
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={onPick} />);
    const input = ui.container.querySelector('input')!;
    type(input, grim.name);
    act(() => { ui!.container.querySelector<HTMLButtonElement>('.gpick-row')!.click(); });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(['grim', 'grim']);
  });
  it('carries no native tooltip and labels its search box', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={() => {}} />);
    expect(ui.container.querySelector('[title]')).toBeNull();
    expect(ui.container.querySelector('input')!.getAttribute('aria-label')).toContain('Add a Core card');
  });
});
