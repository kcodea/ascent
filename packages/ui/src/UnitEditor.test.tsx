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
