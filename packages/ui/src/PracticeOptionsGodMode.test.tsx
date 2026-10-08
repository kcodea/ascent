// @vitest-environment jsdom
/**
 * The Practice screen's two modes (owner sketch 2026-10-08): God Mode (left) and Sandbox Mode (right), each with a
 * Select button and a description; the Sandbox options sit under Sandbox Mode, greyed and inert until it is selected.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import { useGame } from './store';
import { PracticeOptions } from './PracticeOptions';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const open = (godMode: boolean): HTMLElement => {
  act(() => { useGame.setState({ practiceSetupOpen: true, practiceDraft: { ...useGame.getState().practiceDraft, godMode } }); });
  ui = mount(<PracticeOptions />);
  return ui.container;
};
const col = (el: HTMLElement, mode: 'god' | 'sandbox') => el.querySelector<HTMLElement>(`.pomode[data-mode="${mode}"]`)!;
const select = (el: HTMLElement, mode: 'god' | 'sandbox') => col(el, mode).querySelector<HTMLButtonElement>('.pomode-select')!;
const rowButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.posandbox .poseg-btn')];
// jsdom has no PointerEvent; React's onPointerDown listens for the event TYPE, so a MouseEvent named 'pointerdown' drives it.
const press = (b: HTMLElement): void => { act(() => { b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };

describe('Practice screen — God Mode | Sandbox Mode', { timeout: 60_000 }, () => {
  it('shows both modes, each with a Select button and a description', () => {
    const el = open(false);
    expect(col(el, 'god').textContent).toContain('God Mode');
    expect(col(el, 'god').textContent).toContain('Nothing is saved.');
    expect(col(el, 'sandbox').textContent).toContain('Sandbox Mode');
    expect(select(el, 'god')).not.toBeNull();
    expect(select(el, 'sandbox')).not.toBeNull();
  });
  it('Sandbox selected: its options are live', () => {
    const el = open(false);
    expect(col(el, 'sandbox').classList.contains('on')).toBe(true);
    expect(rowButtons(el).length).toBeGreaterThan(0);
    expect(rowButtons(el).every((b) => !b.disabled)).toBe(true);
    expect(el.querySelector('.posandbox')!.classList.contains('off')).toBe(false);
  });
  it('God Mode selected: every Sandbox option is greyed out and inert', () => {
    const el = open(true);
    expect(col(el, 'god').classList.contains('on')).toBe(true);
    expect(el.querySelector('.posandbox')!.classList.contains('off')).toBe(true);
    expect(rowButtons(el).length).toBeGreaterThan(0);
    expect(rowButtons(el).every((b) => b.disabled)).toBe(true);
    const health = useGame.getState().practiceDraft.health;
    press(rowButtons(el).find((b) => b.textContent === 'Normal')!);
    expect(useGame.getState().practiceDraft.health).toBe(health);
  });
  it('Sandbox Mode sits on the left, God Mode on the right (owner 2026-10-08)', () => {
    const el = open(false);
    const order = [...el.querySelectorAll<HTMLElement>('.pomode')].map((c) => c.dataset.mode);
    expect(order).toEqual(['sandbox', 'god']);
  });
  it('opening Practice pre-selects Sandbox Mode, keeping the rest of the draft', () => {
    act(() => { useGame.setState({ practiceSetupOpen: false, practiceDraft: { ...useGame.getState().practiceDraft, godMode: true, timeMult: 2 } }); });
    act(() => { useGame.getState().startPractice(); });
    expect(useGame.getState().practiceDraft.godMode).toBe(false);
    expect(useGame.getState().practiceDraft.timeMult).toBe(2);
    ui = mount(<PracticeOptions />);
    expect(col(ui.container, 'sandbox').classList.contains('on')).toBe(true);
    expect(select(ui.container, 'sandbox').textContent).toBe('Selected');
    expect(rowButtons(ui.container).every((b) => !b.disabled)).toBe(true);
  });
  it('Select switches the mode', () => {
    const el = open(false);
    press(select(el, 'god'));
    expect(useGame.getState().practiceDraft.godMode).toBe(true);
    press(select(el, 'sandbox'));
    expect(useGame.getState().practiceDraft.godMode).toBe(false);
  });
});
