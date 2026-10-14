// @vitest-environment jsdom
/**
 * GAUNTLET HERO PICKER — a Gauntlet stage is not a scored ladder run: it never moves your Rating, so the picker
 * must not telegraph the "Rating X" line it shows for Ascent and Rift. Ascent keeps it (regression), and since
 * 2026-10-14 (R-TERM-01) that line no longer carries the retired Oath pill.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const open = (pendingMode: 'gauntlet' | 'ascent'): HTMLElement => {
  act(() => { useGame.setState({ pendingMode, heroChoices: ['aster', 'warden'] }); });
  ui = mount(<HeroSelect />);
  return ui.container;
};

describe('HeroSelect in a Gauntlet', () => {
  it('shows no Rating line', () => {
    const el = open('gauntlet');
    expect(el.querySelector('.hsprompt')).not.toBeNull();
    expect(el.querySelector('.hsline')).toBeNull();
    expect(el.textContent).not.toContain('Oath');
  });

  it('an Ascent run still shows it (regression)', () => {
    const el = open('ascent');
    expect(el.querySelector('.hsline')).not.toBeNull();
    expect(el.textContent).not.toMatch(/oath/i);
  });
});
