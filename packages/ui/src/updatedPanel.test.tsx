// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';
import { UpdatedPanel } from './UpdatedPanel';
import { UpdateReadyNotice } from './UpdateReadyNotice';
import { readUpdateSeen, writeUpdateSeen } from './updateNotes';

let ui: Mounted | null = null;
type Hooks = { isDesktop: true; quit(): void; toggleFullscreen(): void; onUpdateReady(cb: (v: string) => void): () => void };
let fire: ((v: string) => void) | null = null;
const setDesktop = (): void => {
  (globalThis as { ascentDesktop?: Hooks }).ascentDesktop = {
    isDesktop: true, quit() {}, toggleFullscreen() {},
    onUpdateReady(cb) { fire = cb; return () => { fire = null; }; },
  };
};
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };

afterEach(() => {
  ui?.unmount(); ui = null; fire = null;
  (globalThis as { ascentDesktop?: unknown }).ascentDesktop = undefined;
  localStorage.clear(); document.getElementById('stage')?.remove();
});

describe('UpdatedPanel', () => {
  it('shows "Updated to v…" with the notes, and Continue records the current build', async () => {
    setDesktop();
    writeUpdateSeen({ version: '0.0.1', buildDate: '2026-01-01' });
    ui = mount(<UpdatedPanel />);
    await flush();
    const text = document.body.textContent ?? '';
    expect(text).toContain(`Updated to v${__APP_VERSION__}`);
    expect(document.querySelector('.pnlist > li')).not.toBeNull();
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    act(() => { btn.click(); });
    expect(readUpdateSeen()).toEqual({ version: __APP_VERSION__, buildDate: __BUILD_DATE__.slice(0, 10) });
    expect(document.body.textContent).not.toContain('Updated to v');
  });

  it('first ever desktop launch shows nothing but records the version', async () => {
    setDesktop();
    ui = mount(<UpdatedPanel />);
    await flush();
    expect(document.body.textContent).not.toContain('Updated to v');
    expect(readUpdateSeen()?.version).toBe(__APP_VERSION__);
  });

  it('never shows or records in the browser build', async () => {
    writeUpdateSeen({ version: '0.0.1', buildDate: '2026-01-01' });
    ui = mount(<UpdatedPanel />);
    await flush();
    expect(document.body.textContent).not.toContain('Updated to v');
    expect(readUpdateSeen()?.version).toBe('0.0.1');
  });
});

describe('UpdateReadyNotice', () => {
  it('appears when the shell reports a downloaded update, and has no button', async () => {
    setDesktop();
    ui = mount(<UpdateReadyNotice />);
    expect(document.body.textContent).not.toContain('downloaded');
    act(() => { fire!('0.9.9'); });
    expect(document.body.textContent).toContain('Update v0.9.9 downloaded. It installs next time you start Ascent.');
    expect(document.querySelector('.updnotice button')).toBeNull();
  });
  it('renders nothing in the browser', () => {
    ui = mount(<UpdateReadyNotice />);
    expect(document.querySelector('.updnotice')).toBeNull();
  });
});
