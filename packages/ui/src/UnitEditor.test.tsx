// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { mount } from './renderedText.mount';
import { UnitEditor } from './UnitEditor';

const base = {
  value: { cardId: 'x', attack: 1, health: 1, keywords: [] },
  anchor: new DOMRect(0, 0, 10, 10),
  cards: [{ id: 'x', name: 'X' }],
  onChange: () => {},
  onToggleKeyword: () => {},
  onClose: () => {},
};

describe('UnitEditor golden toggle', () => {
  it('renders only when onToggleGolden is given, and calls it', () => {
    const none = mount(<UnitEditor {...base} />);
    expect(document.querySelector('.uned-golden')).toBeNull();
    none.unmount();

    const onToggleGolden = vi.fn();
    const m = mount(<UnitEditor {...base} golden onToggleGolden={onToggleGolden} />);
    const btn = document.querySelector('.uned-golden') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('on')).toBe(true);
    act(() => { btn.click(); });
    expect(onToggleGolden).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});

describe('UnitEditor locked keywords + card search', () => {
  it('a locked (printed) keyword shows on, is disabled and never toggles; the rest still toggle', () => {
    const onToggleKeyword = vi.fn();
    const m = mount(<UnitEditor {...base} value={{ ...base.value, keywords: ['T'] }} lockedKeywords={['T']} onToggleKeyword={onToggleKeyword} />);
    const btn = (label: string): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>('.uned-kwbtn')].find((b) => b.textContent === label)!;
    expect(btn('Taunt').disabled).toBe(true);
    expect(btn('Taunt').classList.contains('on')).toBe(true);
    act(() => { btn('Taunt').click(); });
    act(() => { btn('Ward').click(); });
    expect(onToggleKeyword.mock.calls).toEqual([['DS']]);
    m.unmount();
  });

  it('searchable: typing filters the cards and picking one swaps to it', () => {
    const onChange = vi.fn();
    const cards = [{ id: 'x', name: 'X' }, { id: 'imp', name: 'Imp', hay: 'imp demon' }, { id: 'rat', name: 'Rat' }];
    const m = mount(<UnitEditor {...base} cards={cards} searchable onChange={onChange} />);
    const input = document.querySelector<HTMLInputElement>('.uned-find')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, 'demon'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.uned-foundrow')];
    expect(rows.map((r) => r.textContent)).toEqual(['Imp']);
    act(() => { rows[0]!.click(); });
    expect(onChange).toHaveBeenCalledWith({ cardId: 'imp' });
    m.unmount();
  });
});
