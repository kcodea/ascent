// @vitest-environment jsdom
/**
 * The account panel's "email already has an account" warning (owner-flagged 2026-09-29 with the crate sign-in gate):
 * a guest who types an email that already belongs to ANOTHER account signs into that account instead of upgrading
 * this one, so the guest's crates and progress stay behind. The code step says so before the code is typed. A
 * brand-new email keeps the "nothing is lost" note.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

import { AccountPanel } from './AccountPanel';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
beforeEach(() => {
  useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null }, accountPanelOpen: true, showTitle: true });
});

const typeEmail = (value: string): void => {
  act(() => {
    const input = document.querySelector('input[type="email"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const send = async (): Promise<void> => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Email me a code')!;
  await act(async () => { btn.click(); await Promise.resolve(); await Promise.resolve(); });
};

describe('AccountPanel: signing in with an email that already has an account', () => {
  it('warns that the guest crates and progress stay behind', async () => {
    useGame.setState({ sendMagicLink: async () => ({ ok: true, existing: true }) });
    ui = mount(<AccountPanel />);
    typeEmail('old@example.com');
    await send();
    expect(document.querySelector('.acctpanel-warn')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('This email already has an account. Signing in switches to it. Crates and progress earned as a guest stay on this guest.');
    expect(document.body.textContent).not.toMatch(/nothing is lost/);
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it('a new email keeps the upgrade note and shows no warning', async () => {
    useGame.setState({ sendMagicLink: async () => ({ ok: true }) });
    ui = mount(<AccountPanel />);
    typeEmail('new@example.com');
    await send();
    expect(document.querySelector('.acctpanel-warn')).toBeNull();
    expect(document.body.textContent).toMatch(/nothing is lost/);
  });
});
