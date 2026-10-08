// @vitest-environment jsdom
/**
 * GOD MODE (owner 2026-10-08): nothing from a God Mode game is saved, so the Esc menu's leave button must not
 * promise "Save & Quit … Continue picks up right here". A normal run keeps that button.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import { useGame } from './store';
import { EscMenu } from './EscMenu';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const openOver = (godMode: boolean): HTMLElement => {
  const run = useGame.getState().run;
  act(() => { useGame.setState({ showTitle: false, replaying: false, run: godMode ? { ...run, sandbox: true, godMode: true } : { ...run, sandbox: undefined, godMode: undefined } }); });
  ui = mount(<EscMenu onClose={() => {}} />);
  return ui.container;
};
const primary = (el: HTMLElement): string => el.querySelector('.escbtn-primary')?.textContent ?? '';

describe('Esc menu in God Mode', { timeout: 60_000 }, () => {
  it('offers a plain leave that says nothing is saved', () => {
    const text = primary(openOver(true));
    expect(text).toContain('Leave God Mode');
    expect(text).toContain('Nothing from this game is saved.');
    expect(text).not.toContain('Save');
  });
  it('a normal run keeps Save & Quit', () => {
    expect(primary(openOver(false))).toContain('Save & Quit');
  });
});
