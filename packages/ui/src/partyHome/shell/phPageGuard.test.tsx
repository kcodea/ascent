// @vitest-environment jsdom
/** A page whose chunk fails says so in place, with a way out; the app's crash screen stays out of it (owner 2026-11-04). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, lazy } from 'react';
import { PhPageGuard } from './PhPageGuard';
import { mount, type Mounted } from '../../renderedText.mount';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.restoreAllMocks(); });

describe('PhPageGuard', () => {
  it('a failed chunk shows the plain message, the nav it was given, and Back to Play', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Stale = lazy((): Promise<{ default: () => JSX.Element }> => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const back = vi.fn();
    await act(async () => { ui = mount(<PhPageGuard onBack={back} nav={<nav id="n" />}><Stale /></PhPageGuard>); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.querySelector('.ph-pagefail')?.textContent).toContain('This page did not load.');
    expect(document.querySelector('#n')).toBeTruthy();
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Back to Play')!;
    b.click();
    expect(back).toHaveBeenCalled();
  });
});
