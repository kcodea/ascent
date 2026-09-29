// @vitest-environment jsdom
/**
 * GUEST SIGN-IN (owner ask 2026-09-29: "add a "sign in!" button that slow flashes/blinks in the top right to the left
 * of the player icon/name. don't let non-signed in players change the portrait either, they need to sign in for
 * that."). Rendered on the real Title screen under jsdom with the account backend's presence mocked:
 *  - the "Sign in!" button: guests only, left of the portrait, opens the account panel, gone the moment the account
 *    is real (no reload), hidden with no backend;
 *  - the portrait lock: a guest's portrait click opens the portrait sign-in gate, never the avatar picker; a
 *    signed-in player's opens the picker; no backend says accounts are unavailable;
 *  - the perf + cursor tripwires on the blink's CSS (opacity-only loop, reduced motion, no plain cursor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const backend = vi.hoisted(() => ({ on: true }));
vi.mock('./remoteBoards', async (orig) => ({ ...(await orig<typeof import('./remoteBoards')>()), remoteEnabled: () => backend.on }));

import { Title } from './Title';
import { AvatarPicker } from './AvatarPicker';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const guest = (): void => { useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } }); };
const signedIn = (): void => { useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } }); };

beforeEach(() => {
  backend.on = true;
  useGame.setState({ showTitle: true, titleView: 'menu', accountPanelOpen: false, avatarPickerOpen: false, playerName: 'Kevin' });
  guest();
});

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
const render = (): void => { ui = mount(<><Title onSettings={() => {}} /><AvatarPicker /></>); };

describe('the guest "Sign in!" button (owner 2026-09-29)', () => {
  it('a guest sees it, seated in the account corner BEFORE (left of) the portrait', () => {
    render();
    const btn = $('.guestsignin');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('Sign in!');
    expect(btn!.getAttribute('aria-label')).toBe('Sign in to save your progress');
    expect(btn!.hasAttribute('title')).toBe(false);
    const corner = $('.titleaccount')!;
    const kids = [...corner.children];
    expect(kids.indexOf(btn!.closest('.guestsignin-seat')!)).toBeLessThan(kids.indexOf($('.titleportrait')!));
  });

  it('clicking it opens the account panel', () => {
    render();
    act(() => $('.guestsignin')!.click());
    expect(useGame.getState().accountPanelOpen).toBe(true);
  });

  it('a signed-in player never sees it, and it disappears the moment the guest signs in (no reload)', () => {
    render();
    expect($('.guestsignin')).not.toBeNull();
    act(() => signedIn());
    expect($('.guestsignin')).toBeNull();
    ui!.unmount(); ui = null;
    render();
    expect($('.guestsignin')).toBeNull();
  });

  it('hidden with no account backend (nothing to sign into), or with no session', () => {
    backend.on = false;
    render();
    expect($('.guestsignin')).toBeNull();
    ui!.unmount(); ui = null;
    backend.on = true;
    useGame.setState({ account: { userId: null, email: null, anonymous: true, discriminator: null } });
    render();
    expect($('.guestsignin')).toBeNull();
  });
});

describe('the portrait lock: guests sign in to change their portrait (owner 2026-09-29)', () => {
  it('a guest clicking the portrait gets the sign-in gate, never the avatar picker', () => {
    render();
    const portrait = $('.titleportrait')!;
    expect(portrait.getAttribute('aria-label')).toBe('Sign in to change your portrait');
    act(() => portrait.click());
    expect(useGame.getState().avatarPickerOpen).toBe(false);
    expect($('.avatarpick')).toBeNull();
    expect($('#pfgate-title')!.textContent).toBe('Sign in to change your portrait');
    expect($('.pfgate-lead')!.textContent).toBe('Picking a portrait is part of your free account.');
    act(() => button('Not now')!.click());
    expect($('.pfgate-panel')).toBeNull();
    expect(useGame.getState().accountPanelOpen).toBe(false);
  });

  it('Create account closes the gate and opens the account panel; Esc closes it too', () => {
    render();
    act(() => $('.titleportrait')!.click());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect($('.pfgate-panel')).toBeNull();
    act(() => $('.titleportrait')!.click());
    act(() => button('Create account')!.click());
    expect($('.pfgate-panel')).toBeNull();
    expect(useGame.getState().accountPanelOpen).toBe(true);
  });

  it('the gate closes itself once the guest signs in, and the portrait then opens the picker', () => {
    render();
    act(() => $('.titleportrait')!.click());
    expect($('.pfgate-panel')).not.toBeNull();
    act(() => signedIn());
    expect($('.pfgate-panel')).toBeNull();
    act(() => $('.titleportrait')!.click());
    expect(useGame.getState().avatarPickerOpen).toBe(true);
    expect($('.avatarpick')).not.toBeNull();
  });

  it('a signed-in player changes their portrait as normal', () => {
    signedIn();
    render();
    expect($('.titleportrait')!.getAttribute('aria-label')).toBe('Change your avatar');
    act(() => $('.titleportrait')!.click());
    expect($('.pfgate-panel')).toBeNull();
    expect($('.avatarpick')).not.toBeNull();
    const before = useGame.getState().playerAvatar;
    act(() => document.querySelector<HTMLButtonElement>('.avatarpick-opt:not(.default)')!.click());
    expect(useGame.getState().playerAvatar).not.toBe(before);
  });

  it('the picker refuses to render for a guest even if something opens it directly', () => {
    render();
    act(() => useGame.getState().openAvatarPicker());
    expect($('.avatarpick')).toBeNull();
  });

  it('no account backend: the gate says accounts are unavailable', () => {
    backend.on = false;
    render();
    act(() => $('.titleportrait')!.click());
    expect($('#pfgate-title')!.textContent).toBe('Accounts are unavailable');
    expect($('.pfgate-foot')!.textContent).toBe('OK');
    act(() => button('OK')!.click());
    expect($('.pfgate-panel')).toBeNull();
    expect(useGame.getState().accountPanelOpen).toBe(false);
    expect($('.avatarpick')).toBeNull();
  });
});

describe('the blink: perf + cursor tripwires', () => {
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the looping keyframes animate opacity only, on a slow (2 to 2.5 s) cycle, and reduced motion stills it', () => {
    const kf = css.match(/@keyframes guestsigninblink \{([\s\S]*?\})\s*\}/)![1];
    expect(kf.match(/[a-z-]+(?=\s*:)/g)!.every((p) => p === 'opacity')).toBe(true);
    const glow = css.match(/\.guestsignin-glow \{([^}]*)\}/)![1];
    const secs = Number(glow.match(/animation: guestsigninblink ([\d.]+)s/)![1]);
    expect(secs).toBeGreaterThanOrEqual(2);
    expect(secs).toBeLessThanOrEqual(2.5);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.guestsignin-glow \{ animation: none;/);
  });
  it('no plain cursor keyword on the button (the global rule paints the gauntlet)', () => {
    const rules = css.match(/\.guestsignin[^{]*\{[^}]*\}/g)!;
    expect(rules.some((r) => /cursor\s*:/.test(r))).toBe(false);
  });
});
