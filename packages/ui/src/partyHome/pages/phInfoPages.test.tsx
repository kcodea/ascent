// @vitest-environment jsdom
/**
 * THE INFO PAGES UNDER THE APP SHELL (party home prototype, DEV only; feat/ph-page-info): Patch Notes, Settings and the
 * Compendium in the shell's kit. Pins:
 *  - each page swaps in its shell version ONLY while the switch is on and the player is on the menus; switch off (or in
 *    the in-game menu) the old page renders exactly as before;
 *  - Patch Notes keeps both tabs, Summary / Detailed and newest-first, adds a patch index and a search (that also reads
 *    the details, and opens them when the match is only there);
 *  - Settings in the shell carries EVERY setting the old panel has (a parity check over switches and sliders), wired to
 *    the same stores;
 *  - the Compendium renders inside the kit page with its views as tabs, and the Guides view shows the guides' own filter
 *    even when Runes was lit before it (R-COMPENDIUM-GUIDES-FILTER-01);
 *  - the UI rules: no native tooltips, no own cursor, no looping animation, no em dashes, never "Oath" / "climb".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mount, type Mounted } from '../../renderedText.mount';

vi.mock('../../remoteBoards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../remoteBoards')>()),
  remoteEnabled: () => false,
}));

import { setPartyHome } from '../partyHomeFlag';
import { useGame } from '../../store';
import { PatchNotesPage } from '../../PatchNotesPage';
import { SettingsPage, SettingsPanel } from '../../EscMenu';
import { MinionBook } from '../../MinionBook';
import { PATCH_NOTES } from '../../patchNotes';
import { matchesWords, patchEntries, PhPatchNotes } from './PhPatchNotes';
import { PhSettings, SETTINGS_TABS } from './PhSettings';
import { PhCompendium } from './PhCompendium';
import { usePhShell } from '../shell/shellStore';

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CLOSED = { showPatchNotes: false, settingsOpen: false, gameMenuOpen: false, showBook: false, showTitle: true } as const;
let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
/** Let a lazy chunk resolve and render (up to 3 s). */
const settle = async (sel: string): Promise<void> => {
  for (let i = 0; i < 300 && !ui?.container.querySelector(sel); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};

beforeEach(() => { localStorage.clear(); act(() => { useGame.setState({ ...CLOSED } as never); }); });
afterEach(() => {
  ui?.unmount(); ui = null;
  act(() => { setPartyHome(false); useGame.setState({ ...CLOSED } as never); });
  localStorage.clear();
});

describe('the gate: shell pages only with the switch on, on the menus', () => {
  it('Patch Notes: shell page with the switch on; the old body with it off or in a game', async () => {
    act(() => { setPartyHome(true); useGame.setState({ showPatchNotes: true } as never); });
    ui = mount(<PatchNotesPage />);
    await settle('.phpn');
    expect(ui.container.querySelector('.pn-page .phpn')).not.toBeNull();
    expect(ui.container.querySelector('.pnbar')).toBeNull();
    ui.unmount();
    act(() => { useGame.setState({ gameMenuOpen: true } as never); });
    ui = mount(<PatchNotesPage />);
    await settle('.pnpatch');
    expect(ui.container.querySelector('.phpn'), 'in a game: the old page').toBeNull();
    expect(ui.container.querySelector('.pnpatch')).not.toBeNull();
    ui.unmount();
    act(() => { setPartyHome(false); useGame.setState({ gameMenuOpen: false } as never); });
    ui = mount(<PatchNotesPage />);
    await settle('.pnpatch');
    expect(ui.container.querySelector('.phpn'), 'switch off: the old page').toBeNull();
  });

  it('Settings: shell page with the switch on; the old panel with it off', async () => {
    act(() => { setPartyHome(true); useGame.setState({ settingsOpen: true } as never); });
    ui = mount(<SettingsPage />);
    await settle('.phs');
    expect(ui.container.querySelector('.set-page .phs')).not.toBeNull();
    expect(ui.container.querySelector('.escpanel')).toBeNull();
    ui.unmount();
    act(() => { setPartyHome(false); });
    ui = mount(<SettingsPage />);
    expect(ui.container.querySelector('.phs')).toBeNull();
    expect(ui.container.querySelector('.escpanel')).not.toBeNull();
  });

  it('Compendium: registers its page with the shell route on the menus; the window otherwise', async () => {
    act(() => { setPartyHome(true); useGame.setState({ showBook: true } as never); });
    ui = mount(<MinionBook />);
    for (let i = 0; i < 300 && usePhShell.getState().compendiumPage !== PhCompendium; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(usePhShell.getState().compendiumPage, 'the page the shell route (PhBookNav) mounts').toBe(PhCompendium);
    expect(ui.container.querySelector('.book-ov'), 'no window on the menus').toBeNull();
    ui.unmount();
    act(() => { useGame.setState({ showTitle: false } as never); });
    ui = mount(<MinionBook />);
    expect(ui.container.querySelector('.phc'), 'in a game: the window').toBeNull();
    expect(ui.container.querySelector('.book-ov .book-head')).not.toBeNull();
  });

  it('every shell page is DEV only (lazy, null in production)', () => {
    expect(here('../../PatchNotesPage.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/pages\/PhPatchNotes'\)/);
    expect(here('../../EscMenu.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/pages\/PhSettings'\)/);
    expect(here('../../MinionBook.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/pages\/PhCompendium'\)/);
  });
});

describe('Patch Notes in the shell', () => {
  it('search matches every word, in the summary or the details', () => {
    expect(matchesWords('Ranked Duos now ends', 'duos RANKED')).toBe(true);
    expect(matchesWords('Ranked Duos now ends', 'duos solo')).toBe(false);
    expect(matchesWords('anything', '  ')).toBe(true);
    const notes = [{ date: '2026-01-02', changes: [
      { category: 'Balance' as const, text: 'Alpha changed', details: ['Beta is now 3/3'] },
      { category: 'Balance' as const, text: 'Gamma changed' },
      { category: 'Systems' as const, text: 'Beta screen' },
    ] }];
    const hits = patchEntries('Balance', 'beta', notes);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.items.map((c) => c.text)).toEqual(['Alpha changed']);
    expect(patchEntries('Balance', '', notes)[0]!.items).toHaveLength(2);
    expect(patchEntries('Balance', 'nothing', notes)).toEqual([]);
  });

  it('renders the newest patch first, an index row per patch, and remembers the tab', () => {
    ui = mount(<PhPatchNotes />);
    const first = ui.container.querySelector('.phpn-patch h2')?.textContent;
    const newestBalance = PATCH_NOTES.find((n) => n.changes.some((c) => c.category === 'Balance'))!;
    expect(first).toContain(newestBalance.date.slice(0, 4));
    expect(ui.container.querySelectorAll('.phpn-idx').length).toBe(ui.container.querySelectorAll('.phpn-patch').length);
    click([...ui.container.querySelectorAll('.phk-tab')].find((b) => b.textContent === 'Systems'));
    expect(localStorage.getItem('ascent.patchnotes.tab')).toBe('Systems');
    // Detailed opens the sub-bullets.
    const before = ui.container.querySelectorAll('.phpn-sub').length;
    click([...ui.container.querySelectorAll('.phk-segbtn')].find((b) => b.textContent === 'Detailed'));
    expect(ui.container.querySelectorAll('.phpn-sub').length).toBeGreaterThan(before);
  });
});

describe('Settings in the shell', () => {
  /** The names of every switch and every slider a tree renders. */
  const controls = (root: HTMLElement, tabs: boolean): string[] => {
    const out = new Set<string>();
    const read = (): void => {
      for (const b of root.querySelectorAll<HTMLButtonElement>('button[role="switch"]')) {
        out.add(b.getAttribute('aria-label') ?? b.querySelector('.ebl')?.textContent ?? '');
      }
      for (const r of root.querySelectorAll<HTMLInputElement>('input[type="range"]')) out.add(r.getAttribute('aria-label') ?? '');
    };
    if (!tabs) { read(); return [...out].sort(); }
    for (const t of SETTINGS_TABS) { click([...root.querySelectorAll('.phk-tab')].find((b) => b.textContent === t.label)); read(); }
    return [...out].sort();
  };

  it('carries every switch and slider the old panel has', () => {
    localStorage.setItem('ascent.audiopanel', '1'); // the old panel's audio channels, unfolded
    ui = mount(<SettingsPanel />);
    const old = controls(ui.container, false);
    ui.unmount();
    ui = mount(<PhSettings />);
    const shell = controls(ui.container, true);
    expect(old.length).toBeGreaterThan(8);
    expect(shell).toEqual(old);
  });

  it('a switch (the kit PhSwitch: On / Off on it) writes the same store as before; its note is outside it', () => {
    act(() => { useGame.setState({ showOpponentSkins: true } as never); });
    ui = mount(<PhSettings initialTab="social" />);
    const sw = [...ui.container.querySelectorAll<HTMLButtonElement>('button[role="switch"]')].find((b) => b.getAttribute('aria-label') === 'Show opponent cosmetics')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.textContent, 'the word on the switch').toBe('On');
    const note = sw.closest('.phs-row')?.querySelector('.phk-seghint');
    expect(note?.textContent).toMatch(/Your own cosmetics always show/);
    expect(sw.contains(note!)).toBe(false);
    click(sw);
    expect(useGame.getState().showOpponentSkins).toBe(false);
  });

  it('remembers the last tab on this device', () => {
    ui = mount(<PhSettings />);
    click([...ui.container.querySelectorAll('.phk-tab')].find((b) => b.textContent === 'Audio'));
    expect(localStorage.getItem('ascent.settings.tab')).toBe('audio');
    ui.unmount();
    ui = mount(<PhSettings />);
    expect(ui.container.querySelector('.phk-tab.on')?.textContent).toBe('Audio');
  });
});

describe('the Compendium in the shell', () => {
  it('frames the book in the kit page with its views as tabs', () => {
    ui = mount(<PhCompendium />);
    expect(ui.container.querySelector('.phc h1')?.textContent).toBe('Compendium');
    expect([...ui.container.querySelectorAll('.phk-tab')].map((t) => t.textContent)).toEqual(['Cards', 'Glossary', 'Rules', 'Guides']);
    expect(ui.container.querySelector('.phc-book .book-rail')).not.toBeNull();
    click([...ui.container.querySelectorAll('.phk-tab')].find((b) => b.textContent === 'Glossary'));
    expect(ui.container.querySelector('.phc-book .book-gloss-body')).not.toBeNull();
    expect(ui.container.querySelector('.phc-actions'), 'a text panel drops the card controls').toBeNull();
  });

  it('R-COMPENDIUM-GUIDES-FILTER-01: Guides shows its own tribe filter even with Runes lit before it', () => {
    ui = mount(<PhCompendium />);
    click([...ui.container.querySelectorAll('.book-cat')].find((b) => b.textContent === 'Runes'));
    expect(ui.container.querySelector('.book-chart-cap')?.textContent).toBe('runes by tribe');
    click([...ui.container.querySelectorAll('.phk-tab')].find((b) => b.textContent === 'Guides'));
    expect(ui.container.querySelector('.book-chart-cap')?.textContent).toBe('guides by tribe');
  });
});

describe('the UI rules', () => {
  it('no native tooltips, no own cursor, no looping animation, no em dashes, never Oath or climb', () => {
    const tsx = ['./PhPatchNotes.tsx', './PhSettings.tsx', './PhCompendium.tsx'].map(here).join('\n');
    const css = ['./phPatchNotes.css', './phSettings.css', './phCompendium.css'].map(here).join('\n');
    expect(tsx).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\stitle=/);
    expect(css).not.toMatch(/cursor:/);
    expect(css).not.toMatch(/infinite/);
    for (const m of tsx.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
      expect(m[2]).not.toMatch(/—|\s--\s/);
      expect(m[2]).not.toMatch(/\b(Oath|climb)\b/i);
    }
  });
});
