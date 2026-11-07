// @vitest-environment jsdom
/**
 * R-PH-SIGNIN-NAV-01 (owner 2026-11-07): "put this in the top right of the main navigation bar when someone is not signed in".
 * The bar shows a Sign in pill only while signed out, last in its top-right group, and it opens the account panel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../../renderedText.mount';
import { useGame } from '../../store';
import { PhTopNav } from './PhTopNav';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const render = (account: { email: string | null; anonymous: boolean }): HTMLElement => {
  act(() => { useGame.setState((s) => ({ account: { ...s.account, userId: account.email ? 'u1' : null, ...account }, accountPanelOpen: false })); });
  ui = mount(<PhTopNav current="home" />);
  return ui.container;
};

describe('R-PH-SIGNIN-NAV-01: Sign in in the top nav', () => {
  it('signed out: a Sign in pill sits in the top-right group and opens the account panel', () => {
    const el = render({ email: null, anonymous: true });
    const btn = el.querySelector<HTMLButtonElement>('.ph-top > .ph-wallet > .ph-signin');
    expect(btn?.textContent).toBe('Sign in');
    act(() => { btn!.click(); });
    expect(useGame.getState().accountPanelOpen).toBe(true);
  });

  it('signed in: no Sign in pill', () => {
    const el = render({ email: 'a@b.c', anonymous: false });
    expect(el.querySelector('.ph-signin')).toBeNull();
  });
});
