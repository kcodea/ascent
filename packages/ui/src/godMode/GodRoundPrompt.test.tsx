// packages/ui/src/godMode/GodRoundPrompt.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { GodRoundPrompt } from './GodRoundPrompt';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const show = (p: Partial<Parameters<typeof GodRoundPrompt>[0]> = {}) => {
  const onPick = vi.fn(); const onClose = vi.fn();
  ui = mount(<GodRoundPrompt lastRound={4} busy={false} message={null} onPick={onPick} onClose={onClose} {...p} />);
  return { el: document.body, onPick, onClose };
};

describe('GodRoundPrompt', () => {
  it('asks the question with buttons 1–15, last pick highlighted', () => {
    const { el } = show();
    expect(el.textContent).toContain('What round should your opponent board be on?');
    const btns = [...el.querySelectorAll<HTMLButtonElement>('.godround-btn')];
    expect(btns.map((b) => b.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => String(i + 1)));
    expect(btns[3]!.classList.contains('on')).toBe(true);
  });
  it('clicking a round picks it', () => {
    const { el, onPick } = show();
    act(() => { el.querySelectorAll<HTMLButtonElement>('.godround-btn')[6]!.click(); });
    expect(onPick).toHaveBeenCalledWith(7);
  });
  it('is inert while busy (Review Focus 1)', () => {
    const { el, onPick } = show({ busy: true });
    const btns = [...el.querySelectorAll<HTMLButtonElement>('.godround-btn')];
    expect(btns.every((b) => b.disabled)).toBe(true);
    act(() => { btns[0]!.click(); });
    expect(onPick).not.toHaveBeenCalled();
  });
  it('shows the no-boards message and closes on Esc', () => {
    const { el, onClose } = show({ message: 'No boards found for round 9 — try another' });
    expect(el.textContent).toContain('No boards found for round 9 — try another');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
  });
});
