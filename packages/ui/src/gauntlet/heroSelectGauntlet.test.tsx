// @vitest-environment jsdom
/**
 * GAUNTLET HERO PICKER — a Gauntlet stage is not a scored ladder run: it has no Oath and never moves your Rating, so
 * the picker must not telegraph the "Rating X · Oath Y" line it shows for Ascent and Rift. Ascent keeps it
 * (regression).
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
  it('shows no Rating / Oath line', () => {
    const el = open('gauntlet');
    expect(el.querySelector('.hsprompt')).not.toBeNull();
    expect(el.querySelector('.hsline')).toBeNull();
    expect(el.textContent).not.toContain('Oath');
  });

  it('an Ascent run still shows it (regression)', () => {
    const el = open('ascent');
    expect(el.querySelector('.hsline')).not.toBeNull();
  });
});
