// @vitest-environment jsdom
/**
 * THE LOBBY RAIL'S GUIDES VIEW (owner ask 2026-10-09). Pins: the tab flips the rail between Opponents and Guides
 * (header follows); only this game's set + lobby tribes show; a card expands in place and shows real board
 * `Card` portraits in Core / Enablers rows; SIMPLE hides the write-up and FULL shows it, the mode persists in
 * localStorage and SIMPLE is the default; a new game starts on Opponents; the Tutorial has no tab; the tab goes
 * pointer-inert with the rail in combat; no `title=` anywhere in the guides view.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { useGame } from '../store';
import { GUIDES, guidesFor } from './guides';
import { resetGuidesForTests, useGuides } from './guidesStore';

let ui: Mounted | null = null;
const prevAccount = useGame.getState().account;
beforeEach(() => { try { localStorage.removeItem('ascent.guidesMode'); } catch { /* ignore */ } });
afterEach(() => {
  act(() => { resetGuidesForTests(); });
  act(() => { useGame.setState({ account: prevAccount, showBook: false }); });
  ui?.unmount(); ui = null;
});

const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
/** Account u-1 is signed in (the store holds `mine` for the account named in its `mineOwner`). */
const signInU1 = (): void => { act(() => { useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } }); }); };

/** Flip to Guides (the view is remembered per run for the session, so a re-used seed may already be there). */
const openGuides = (c: HTMLElement): void => {
  const tab = c.querySelector('.lobbyrailtab')!;
  if (tab.getAttribute('aria-pressed') !== 'true') click(tab);
};

const mountRail = (seed = 4242, mode?: 'tutorial'): HTMLElement => {
  const run = createLobbyRun(seed, 'warden');
  if (mode) run.mode = mode;
  act(() => { useGame.setState({ run, combatStaged: false }); });
  ui = mount(<LobbyPanel lobby={run.lobby!} />);
  return ui.container;
};

describe('lobby rail guides view', () => {
  it('the tab flips the rail to Guides and back; header follows', () => {
    const c = mountRail(1111);
    const tab = c.querySelector('.lobbyrailtab')!;
    expect(tab.getAttribute('aria-pressed')).toBe('false');
    expect(c.querySelector('.lobbyround')!.textContent).toMatch(/^Round/);
    click(tab);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guidesview')).toBe(true);
    expect(c.querySelector('.lobbyround')!.textContent).toBe('Guides');
    expect(c.querySelector('.lobbyseat')).toBeNull();
    const run = useGame.getState().run;
    expect(c.querySelectorAll('.lobbyguide').length).toBe(guidesFor(run.setId, run.tribes).length);
    click(c.querySelector('.lobbyrailtab')!);
    expect(c.querySelector('.lobbyseat')).not.toBeNull();
    expect(c.querySelector('.lobbyguide')).toBeNull();
  });

  it('a guide expands in place to Core / Enablers rows of real board cards; SIMPLE hides the write-up', () => {
    const c = mountRail(2024);
    openGuides(c);
    const first = c.querySelector('.lobbyguide')!;
    const head = first.querySelector('.lobbyguide-head')!;
    click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(first.querySelectorAll('.lobbyguide-unitslabel').length).toBeGreaterThan(0);
    expect(first.querySelectorAll('.lobbyguide-unit .card').length).toBeGreaterThan(0);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-simple')).toBe(true);
    expect(first.querySelector('.lobbyguide-text')).toBeNull();
    click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it("an open card's Detailed button widens the rail and shows the write-up; it is remembered; Simple folds back", () => {
    const c = mountRail(31337);
    openGuides(c);
    click(c.querySelector('.lobbyguide-head')!);
    const detailed = c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!;
    expect(detailed.textContent).toBe('Detailed');
    click(detailed);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-full')).toBe(true);
    expect(c.querySelector('.lobbyguide.open .lobbyguide-text')).not.toBeNull();
    expect(localStorage.getItem('ascent.guidesMode')).toBe('full');
    // ...and back.
    expect(c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!.textContent).toBe('Simple');
    click(c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-simple')).toBe(true);
    expect(c.querySelector('.lobbyguides-group')).toBeNull();
  });

  it('the write-up highlights mentioned cards and aliases (Eyes of Aresmar, Staff of Guel, "Oona")', () => {
    const run = createLobbyRun(5150, 'warden');
    run.tribes = ['beast', 'dragon', 'kobold', 'dwarf', 'demon'];
    act(() => { useGame.setState({ run, combatStaged: false }); });
    try { localStorage.setItem('ascent.guidesMode', 'full'); } catch { /* ignore */ }
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    const c = ui.container;
    openGuides(c);
    const guideNamed = (title: string): Element =>
      [...c.querySelectorAll('.lobbyguide')].find((g) => g.querySelector('.lobbyguide-head')!.textContent!.includes(title))!;
    const names = (title: string): string[] => {
      const g = guideNamed(title);
      if (!g.classList.contains('open')) click(g.querySelector('.lobbyguide-head')!);
      return [...g.querySelectorAll('.lobbyguide-text .lobbyguide-name')].map((n) => n.textContent!);
    };
    expect(names('Shout Dragons')).toEqual(expect.arrayContaining(['Eyes of Aresmar', 'Drakko']));
    expect(names('Oona')).toEqual(expect.arrayContaining(['Oona', 'Grim', 'Sylus']));
    expect(names('Consume')).toEqual(expect.arrayContaining(['Staff of Guel', 'Chipper', 'Bob Blart', 'Grevlin & Co.']));
  });

  it('a new game starts on Opponents', () => {
    const c = mountRail(4242);
    click(c.querySelector('.lobbyrailtab')!);
    ui!.unmount();
    const c2 = mountRail(777);
    expect(c2.querySelector('.lobbyseat')).not.toBeNull();
    expect(c2.querySelector('.lobbyrailtab')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the Tutorial has no Guides tab', () => {
    const c = mountRail(4242, 'tutorial');
    expect(c.querySelector('.lobbyrailtab')).toBeNull();
  });

  it('no native title tooltips; the tab goes inert with the rail in combat', () => {
    const c = mountRail(9001);
    openGuides(c);
    click(c.querySelector('.lobbyguide-head')!);
    expect(c.querySelector('[title]')).toBeNull();
    const css = readFileSync(join(__dirname, 'lobbyGuides.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.app\.staged \.lobbyrailtab \{[^}]*pointer-events: none;/);
    expect(css).not.toMatch(/cursor:/);
  });

  it('reads the guides store when the Guides view opens, and an open rail never reshuffles (owner 2026-10-11)', () => {
    const c = mountRail(7777);
    const run = useGame.getState().run;
    const builtIn = guidesFor(run.setId, run.tribes).map((g) => g.id);
    openGuides(c);
    const shown = (): string[] => [...c.querySelectorAll('.lobbyguide')].map((g) => g.getAttribute('data-guide')!);
    expect(shown()).toEqual(builtIn);

    // A refresh lands while the player is reading: one guide renamed and moved to the front.
    const first = GUIDES.find((g) => g.id === builtIn[builtIn.length - 1])!;
    const refreshed = [{ ...first, title: 'Renamed on the server', order: -1 }, ...GUIDES.filter((g) => g.id !== first.id)];
    act(() => { useGuides.setState({ list: refreshed, source: 'server', capability: 'on' }); });
    expect(shown()).toEqual(builtIn);
    expect(c.textContent).not.toContain('Renamed on the server');

    // Leaving and reopening the view picks the refresh up.
    const tab = c.querySelector('.lobbyrailtab')!;
    click(tab);
    click(tab);
    expect(c.textContent).toContain('Renamed on the server');
  });

  it('the player\'s own guides for this game follow Team Ascent\'s, under a "Your guides" label', () => {
    const c = mountRail(8181);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'My private build', sets: [run.setId ?? 'set1'], tribes: [run.tribes[0]!] };
    const elsewhere = { ...own, id: 'own-2', rowId: 'own-2', title: 'For another set', sets: [] };
    // Set before the Guides view opens: opening it is when the rail takes its snapshot.
    signInU1();
    act(() => { useGuides.setState({ mine: [own, elsewhere], mineOwner: 'u-1' }); });
    openGuides(c);
    const labels = [...c.querySelectorAll('.lobbyguides-sec')].map((n) => n.textContent);
    expect(labels).toEqual(['Your guides']);
    const ids = [...c.querySelectorAll('.lobbyguide')].map((g) => g.getAttribute('data-guide'));
    expect(ids[ids.length - 1]).toBe('own-1');
    expect(ids).not.toContain('own-2');
    expect(ids.slice(0, -1)).toEqual(guidesFor(run.setId, run.tribes).map((g) => g.id));
  });

  it('with no guides of their own there is no "Your guides" label', () => {
    const c = mountRail(8282);
    openGuides(c);
    expect(c.querySelector('.lobbyguides-sec')).toBeNull();
  });

  it('an open guide the player may edit has an Edit button that opens the Compendium on it; one they may not edit has none', () => {
    const c = mountRail(8383);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'Mine', sets: [run.setId ?? 'set1'], tribes: [] };
    act(() => {
      useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null }, showBook: false });
      useGuides.setState({ mine: [own], mineOwner: 'u-1', capability: 'on' });
    });
    openGuides(c);
    const head = (id: string): Element => c.querySelector(`.lobbyguide[data-guide="${id}"] .lobbyguide-head`)!;
    const official = guidesFor(run.setId, run.tribes)[0]!;
    click(head(official.id));
    expect(c.querySelector(`.lobbyguide[data-guide="${official.id}"] .lobbyguide-editbtn`)).toBeNull();
    click(head('own-1'));
    const edit = c.querySelector(`.lobbyguide[data-guide="own-1"] .lobbyguide-editbtn`)!;
    expect(edit.textContent).toBe('Edit');
    click(edit);
    expect(useGuides.getState().pendingEdit).toBe('own-1');
    expect(useGame.getState().showBook).toBe(true);
    act(() => { useGame.setState({ showBook: false }); });
  });

  it('without the guides server there is no Edit button, even on a guide the player owns', () => {
    const c = mountRail(8585);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'Mine', sets: [run.setId ?? 'set1'], tribes: [] };
    act(() => {
      useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } });
      useGuides.setState({ mine: [own], mineOwner: 'u-1', capability: 'off' });
    });
    openGuides(c);
    click(c.querySelector('.lobbyguide[data-guide="own-1"] .lobbyguide-head')!);
    expect(c.querySelector('.lobbyguide[data-guide="own-1"] .lobbyguide-modebtn')).not.toBeNull();
    expect(c.querySelector('.lobbyguide-editbtn')).toBeNull();
  });

  it('the rail takes its own guides as a snapshot too: a save that lands while it is open does not add a card', () => {
    const c = mountRail(8484);
    const run = useGame.getState().run;
    signInU1();
    openGuides(c);
    const before = c.querySelectorAll('.lobbyguide').length;
    act(() => { useGuides.setState({ mine: [{ ...GUIDES[0]!, id: 'late', rowId: 'late', official: false, authorId: 'u-1', sets: [run.setId ?? 'set1'], tribes: [] }], mineOwner: 'u-1' }); });
    expect(c.querySelectorAll('.lobbyguide').length).toBe(before);
    const tab = c.querySelector('.lobbyrailtab')!;
    click(tab);
    click(tab);
    expect(c.querySelectorAll('.lobbyguide').length).toBe(before + 1);
  });

  it('the header counts every card shown: Team Ascent\'s guides plus the player\'s own', () => {
    const c = mountRail(8686);
    const run = useGame.getState().run;
    const team = guidesFor(run.setId, run.tribes).length;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', title: 'Mine', sets: [run.setId ?? 'set1'], tribes: [] };
    signInU1();
    act(() => { useGuides.setState({ mine: [own], mineOwner: 'u-1' }); });
    openGuides(c);
    expect(c.querySelectorAll('.lobbyguide').length).toBe(team + 1);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe(`${team + 1} guides`);
  });

  it('the header says "1 guide" for a single card', () => {
    const c = mountRail(8787);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', title: 'Mine', sets: [run.setId ?? 'set1'], tribes: [] };
    // A set with no Team Ascent guides: only the player's own card shows.
    signInU1();
    act(() => { useGuides.setState({ list: [], mine: [own], mineOwner: 'u-1' }); });
    openGuides(c);
    expect(c.querySelectorAll('.lobbyguide').length).toBe(1);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe('1 guide');
  });

  it('the previous account\'s own guides leave the open rail when the account changes; Team Ascent\'s stay', () => {
    const c = mountRail(8888);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', title: 'Private build', sets: [run.setId ?? 'set1'], tribes: [] };
    act(() => {
      useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } });
      useGuides.setState({ mine: [own], mineOwner: 'u-1' });
    });
    openGuides(c);
    const team = guidesFor(run.setId, run.tribes).map((g) => g.id);
    const shown = (): (string | null)[] => [...c.querySelectorAll('.lobbyguide')].map((g) => g.getAttribute('data-guide'));
    expect(shown()).toEqual([...team, 'own-1']);
    expect(c.querySelector('.lobbyguides-sec')).not.toBeNull();

    // Another account signs in while the Guides view stays open.
    act(() => { useGame.setState({ account: { userId: 'u-2', email: 'x@example.test', anonymous: false, discriminator: null } }); });
    expect(shown()).toEqual(team);
    expect(c.querySelector('.lobbyguides-sec')).toBeNull();
    expect(c.textContent).not.toContain('Private build');
    expect(c.querySelector('.lobbyalive')!.textContent).toBe(`${team.length} guides`);

    // ...or a guest (no account id at all).
    act(() => { useGame.setState({ account: { userId: null, email: null, anonymous: true, discriminator: null } }); });
    expect(shown()).toEqual(team);
    expect(c.querySelector('.lobbyguides-sec')).toBeNull();
  });

  it('guides the store still holds for another account are never drawn: not for nobody, not for a second account, only for their owner', () => {
    // The store was never told the account changed (a missed re-read): it still holds account u-1's private guides.
    const run = createLobbyRun(8890, 'warden');
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', title: 'Private build', sets: [run.setId ?? 'set1'], tribes: [] };
    const team = guidesFor(run.setId, run.tribes).map((g) => g.id);
    const openAs = (account: { userId: string | null; email: string | null; anonymous: boolean; discriminator: null }): HTMLElement => {
      ui?.unmount();
      act(() => { useGame.setState({ run, combatStaged: false, account }); });
      act(() => { useGuides.setState({ mine: [own], mineOwner: 'u-1' }); });
      ui = mount(<LobbyPanel lobby={run.lobby!} />);
      openGuides(ui.container);
      return ui.container;
    };
    const shown = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll('.lobbyguide')].map((g) => g.getAttribute('data-guide'));
    for (const account of [
      { userId: null, email: null, anonymous: true, discriminator: null },                 // signed out
      { userId: 'g-9', email: null, anonymous: true, discriminator: null },                // a guest session
      { userId: 'u-2', email: 'x@example.test', anonymous: false, discriminator: null },   // another account
    ]) {
      const c = openAs(account);
      expect(shown(c), String(account.userId)).toEqual(team);
      expect(c.querySelector('.lobbyguides-sec'), String(account.userId)).toBeNull();
      expect(c.textContent, String(account.userId)).not.toContain('Private build');
      expect(c.querySelector('.lobbyalive')!.textContent, String(account.userId)).toBe(`${team.length} guides`);
      // Closing and reopening the view takes a new snapshot: still none.
      const tab = c.querySelector('.lobbyrailtab')!;
      click(tab);
      click(tab);
      expect(shown(c), String(account.userId)).toEqual(team);
    }
    const c = openAs({ userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null });
    expect(shown(c)).toEqual([...team, 'own-1']);
    expect(c.querySelector('.lobbyguides-sec')!.textContent).toBe('Your guides');
  });

  it('guides held for nobody (no owner recorded) are not drawn, even with nobody signed in', () => {
    const c = mountRail(8891);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', title: 'Private build', sets: [run.setId ?? 'set1'], tribes: [] };
    act(() => { useGame.setState({ account: { userId: null, email: null, anonymous: true, discriminator: null } }); });
    act(() => { useGuides.setState({ mine: [own], mineOwner: null }); });
    openGuides(c);
    expect(c.querySelector('.lobbyguides-sec')).toBeNull();
    expect(c.textContent).not.toContain('Private build');
  });

  it('Edit sets the Compendium request before it opens the Compendium, which reads it once on mount', () => {
    const c = mountRail(8989);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', title: 'Mine', sets: [run.setId ?? 'set1'], tribes: [] };
    act(() => {
      useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null }, showBook: false });
      useGuides.setState({ mine: [own], mineOwner: 'u-1', capability: 'on' });
    });
    openGuides(c);
    click(c.querySelector('.lobbyguide[data-guide="own-1"] .lobbyguide-head')!);
    let pendingWhenOpened: string | null | undefined;
    const unsubscribe = useGame.subscribe((st, prev) => {
      if (st.showBook && !prev.showBook && pendingWhenOpened === undefined) pendingWhenOpened = useGuides.getState().pendingEdit;
    });
    try {
      click(c.querySelector('.lobbyguide[data-guide="own-1"] .lobbyguide-editbtn')!);
    } finally {
      unsubscribe();
    }
    expect(pendingWhenOpened).toBe('own-1');
  });
});
