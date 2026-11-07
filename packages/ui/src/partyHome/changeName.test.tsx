// @vitest-environment jsdom
/**
 * CHANGE NAME ON YOUR OWN BANNER (R-PH-CHANGE-NAME-01, owner 2026-11-07: "we need a change name option").
 * Pins:
 *  - your banner's menu reads Change name, Change portrait, View Career, and each item runs its own action;
 *  - PartyHome builds your menu from `selfCardMenu` and mounts the Change name window;
 *  - the window saves through the store's `setPlayerName` (the title chip's own path: 24 characters, trimmed), Enter
 *    saves, Cancel leaves the name alone; a guest can rename here too (no sign-in gate, same as the title chip);
 *  - UI rules: no native tooltip (no rendered `title`), no bare cursor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mount, type Mounted } from '../renderedText.mount';

vi.mock('../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../remoteBoards')>()),
  remoteEnabled: () => false,
  claimHandle: async () => null,
}));

import { useGame } from '../store';
import { ChangeNameDialog, PLAYER_NAME_MAX, selfCardMenu } from './ChangeName';

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
let ui: Mounted | null = null;
const prev = { playerName: useGame.getState().playerName, account: useGame.getState().account };

beforeEach(() => { localStorage.clear(); act(() => { useGame.setState({ playerName: 'IronFox87' }); }); });
afterEach(() => { ui?.unmount(); ui = null; act(() => { useGame.setState(prev); }); localStorage.clear(); });

const input = (): HTMLInputElement => document.body.querySelector<HTMLInputElement>('.phk-fieldinput')!;
const type = (v: string): void => {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const button = (label: string): HTMLButtonElement =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;

describe('your banner menu', () => {
  it('reads Change name, Change portrait, View Career, each running its own action', () => {
    const calls: string[] = [];
    const menu = selfCardMenu({ changeName: () => calls.push('name'), changePortrait: () => calls.push('portrait'), viewCareer: () => calls.push('career') });
    expect(menu.map((m) => m.label)).toEqual(['Change name', 'Change portrait', 'View Career']);
    menu.forEach((m) => m.run!());
    expect(calls).toEqual(['name', 'portrait', 'career']);
  });

  it('PartyHome builds your menu from selfCardMenu and mounts the Change name window', () => {
    const src = here('./PartyHome.tsx');
    expect(src).toMatch(/m\.self\s*\?\s*selfCardMenu\(\{\s*changeName: \(\) => setRenameOpen\(true\)/);
    expect(src).toContain('{renameOpen && <ChangeNameDialog onClose={() => setRenameOpen(false)} />}');
  });
});

describe('the Change name window', () => {
  it('starts on your current name and saves through setPlayerName (trimmed)', () => {
    const onClose = vi.fn();
    ui = mount(<ChangeNameDialog onClose={onClose} />);
    expect(input().value).toBe('IronFox87');
    expect(input().maxLength).toBe(PLAYER_NAME_MAX);
    type('  StoneWarden  ');
    act(() => { button('Save').click(); });
    expect(useGame.getState().playerName).toBe('StoneWarden');
    expect(localStorage.getItem('ascent.playername')).toBe('StoneWarden');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter saves; Cancel leaves the name alone', () => {
    const onClose = vi.fn();
    ui = mount(<ChangeNameDialog onClose={onClose} />);
    type('Kingbreaker');
    act(() => { input().form!.requestSubmit(); });
    expect(useGame.getState().playerName).toBe('Kingbreaker');
    ui.unmount();
    ui = mount(<ChangeNameDialog onClose={onClose} />);
    type('Nope');
    act(() => { button('Cancel').click(); });
    expect(useGame.getState().playerName).toBe('Kingbreaker');
  });

  it('a guest renames here too, the same as on the title chip', () => {
    act(() => { useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } }); });
    ui = mount(<ChangeNameDialog onClose={() => {}} />);
    type('GuestName');
    act(() => { button('Save').click(); });
    expect(useGame.getState().playerName).toBe('GuestName');
  });

  it('no native tooltip, no bare cursor', () => {
    ui = mount(<ChangeNameDialog onClose={() => {}} />);
    expect(document.body.querySelector('[title]')).toBeNull();
    expect(here('./ChangeName.tsx')).not.toMatch(/cursor:\s*pointer/);
  });
});
