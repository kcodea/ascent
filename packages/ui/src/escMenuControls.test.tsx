// @vitest-environment jsdom
/**
 * SETTINGS CONTROLS (owner asks 2026-10-08). Pins:
 *  - a button carries only its label; its explanation is a note beside it on the same line, linked by aria-describedby;
 *  - an on/off setting is a toggle SWITCH row (role="switch", aria-checked; `.is-on` drives knob right / green),
 *    never a checkmark in the label;
 *  - Performance is ONE "Max Frame Rate" dropdown (a listbox), not a row of buttons; picking an option sets the cap
 *    and closes the list; a press outside closes it too.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import { EscMenu } from './EscMenu';
import { useGame } from './store';

let ui: Mounted | null = null;
const press = (el: Element | null | undefined): void => {
  act(() => { el!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
};
const switchNamed = (root: ParentNode, label: string): HTMLButtonElement | null =>
  [...root.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find((b) => b.querySelector('.ebl')?.textContent === label) ?? null;

beforeEach(() => {
  localStorage.clear();
  useGame.setState({ showTitle: false, replaying: false, combatRampUp: false, showOpponentSkins: true, fpsCap: 0 });
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  localStorage.clear();
});

describe('Settings controls', () => {
  it('on/off settings are switches with their note outside the button', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    const ramp = switchNamed(ui.container, 'Auto-ramp speed');
    expect(ramp).not.toBeNull();
    expect(ramp!.getAttribute('aria-checked')).toBe('false');
    expect(ramp!.classList.contains('is-on')).toBe(false);
    expect(ramp!.textContent).toBe('Auto-ramp speed');
    expect(ramp!.textContent).not.toMatch(/✓/);
    const note = document.getElementById(ramp!.getAttribute('aria-describedby')!);
    expect(note?.textContent).toMatch(/Long fights speed up/);
    expect(ramp!.contains(note)).toBe(false);
    expect(note!.parentElement).toBe(ramp!.parentElement);

    press(ramp);
    expect(useGame.getState().combatRampUp).toBe(true);
    const after = switchNamed(ui.container, 'Auto-ramp speed')!;
    expect(after.getAttribute('aria-checked')).toBe('true');
    expect(after.classList.contains('is-on')).toBe(true);

    const cos = switchNamed(ui.container, 'Show opponent cosmetics')!;
    expect(cos.getAttribute('aria-checked')).toBe('true');
    press(cos);
    expect(useGame.getState().showOpponentSkins).toBe(false);
  });

  it('no button carries supporting text inside it', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    expect(ui.container.querySelectorAll('.ebs')).toHaveLength(0);
    const primary = ui.container.querySelector('.escbtn-primary');
    expect(primary?.textContent).toBe('Save & Quit');
  });

  it('Max Frame Rate is one dropdown: open, pick, closed; a press outside closes it', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    expect(ui.container.querySelector('#esc-fps-label')?.textContent).toBe('Max Frame Rate');
    expect(ui.container.querySelectorAll('.escfpsopt')).toHaveLength(0);
    const trigger = ui.container.querySelector<HTMLButtonElement>('.escselect-trigger')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(ui.container.querySelector('[role="listbox"]')).toBeNull();

    press(trigger);
    const opts = [...ui.container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(opts[0]!.textContent).toMatch(/^Display/);
    expect(opts.slice(1).map((o) => o.textContent)).toEqual(['60 FPS', '120 FPS', '144 FPS', '240 FPS', '360 FPS']);
    expect(opts[0]!.getAttribute('aria-selected')).toBe('true');

    press(opts[1]);
    expect(useGame.getState().fpsCap).toBe(60);
    expect(localStorage.getItem('ascent.fpscap')).toBe('60');
    expect(ui.container.querySelector('[role="listbox"]')).toBeNull();
    expect(ui.container.querySelector('.escselect-value')?.textContent).toBe('60 FPS');

    press(ui.container.querySelector('.escselect-trigger'));
    expect(ui.container.querySelector('[role="listbox"]')).not.toBeNull();
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(ui.container.querySelector('[role="listbox"]')).toBeNull();
  });
});
