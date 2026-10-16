// @vitest-environment jsdom
/**
 * THE MODE PICKER (UI refinement WS-2, 2026-10-16; owner: "our play mode screen seems bad"). Pinned against the
 * real Title + store:
 *   - every mode is one click away on the picker (Play, Practice, Gauntlet, Learn; Versus when enabled), and Play,
 *     the ranked lobby, is the large tile carrying the one gold call to action;
 *   - descriptions are real text on every tile (not hover-only content);
 *   - the tiles never move; the mode you last launched wears a "Last played" tag (lastMode.ts), and launching a mode
 *     records it;
 *   - the picker's painted backdrop is mounted (the sidebar brings it), with no title= tooltips anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('./remoteBoards')>()), remoteEnabled: () => false }));

import { Title } from './Title';
import { useGame } from './store';
import { readLastMode, rememberMode } from './lastMode';

let ui: Mounted | null = null;
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const tiles = (): string[] => [...document.querySelectorAll<HTMLElement>('.mpgrid .modecard[data-mp]')].map((b) => b.dataset.mp ?? '');

beforeEach(() => {
  try { localStorage.removeItem('ascent.lastMode'); } catch { /* jsdom always has it */ }
  useGame.setState({ showTitle: true, titleView: 'modes', savedRun: null });
});
afterEach(() => { ui?.unmount(); ui = null; useGame.setState({ titleView: 'menu' }); });

describe('the mode picker', () => {
  it('shows every mode one click away, with Play as the large tile and the one gold call to action', () => {
    ui = mount(<Title onSettings={() => {}} />);
    expect(tiles()).toEqual(expect.arrayContaining(['play', 'practice', 'gauntlet', 'learn']));
    expect($('.mpgrid .mc-hero')?.dataset.mp).toBe('play');
    expect(document.querySelectorAll('.mpgrid .mc-cta')).toHaveLength(1);
    expect($('.mc-hero .mc-cta')?.textContent).toBe('Play');
    // Every tile states what it is in plain text, not behind a hover.
    for (const t of document.querySelectorAll('.mpgrid .modecard[data-mp]')) expect(t.querySelector('.mcdesc')?.textContent?.length).toBeGreaterThan(0);
    // The painted hall sits behind it; no native tooltips.
    expect($('.modepick .mbd[data-screen="modes"]')).not.toBeNull();
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('marks the mode last launched, and launching a mode remembers it (the tiles themselves never move)', () => {
    rememberMode('gauntlet');
    ui = mount(<Title onSettings={() => {}} />);
    const before = tiles();
    expect($('.modecard[data-mp="gauntlet"] .mclast')?.textContent).toBe('Last played');
    expect(document.querySelectorAll('.mclast')).toHaveLength(1);
    act(() => { $('.modecard[data-mp="practice"]')!.click(); });
    expect(readLastMode()).toBe('practice');
    act(() => { useGame.setState({ showTitle: true, titleView: 'modes', practiceSetupOpen: false }); });
    expect(tiles()).toEqual(before);
    expect($('.modecard[data-mp="practice"] .mclast')).not.toBeNull();
  });

  it('a sub-view (Gauntlet) carries a crumb back to the picker', () => {
    ui = mount(<Title onSettings={() => {}} />);
    act(() => { useGame.getState().setTitleView('gauntlet'); });
    const crumb = [...document.querySelectorAll<HTMLButtonElement>('.mpcrumb')].find((b) => b.textContent === 'Modes');
    expect(crumb).toBeDefined();
    act(() => { crumb!.click(); });
    expect(useGame.getState().titleView).toBe('modes');
  });
});

describe('lastMode', () => {
  it('ignores junk in storage', () => {
    localStorage.setItem('ascent.lastMode', 'nonsense');
    expect(readLastMode()).toBeNull();
  });
});

