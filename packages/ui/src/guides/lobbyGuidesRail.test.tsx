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
import { CARD_INDEX, SETS, type SetId } from '@game/content';
import type { Tribe } from '@game/core';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyPanel } from '../LobbyPanel';
import { useGame } from '../store';
import { GUIDES, guidesFor, type Guide } from './guides';
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

  // Owner 2026-10-12: "when in the detailed view, clicking outside of the guide area should automatically collapse
  // back to the simple view".
  const press = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };
  const openDetailed = (seed: number): HTMLElement => {
    const c = mountRail(seed);
    openGuides(c);
    click(c.querySelector('.lobbyguide-head')!);
    click(c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-full')).toBe(true);
    return c;
  };

  it('Detailed folds back to Simple on a press outside the rail; the open card stays open', () => {
    const c = openDetailed(60601);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      press(outside);
      expect(c.querySelector('.lobbyrail')!.classList.contains('guides-simple')).toBe(true);
      expect(c.querySelector('.lobbyrail')!.classList.contains('guides-full')).toBe(false);
      expect(c.querySelector('.lobbyguide.open')).not.toBeNull();
      expect(c.querySelector('.lobbyguide.open .lobbyguide-text')).toBeNull();
      expect(c.querySelector('.lobbyguide.open .lobbyguide-modebtn')!.textContent).toBe('Detailed');
      expect(localStorage.getItem('ascent.guidesMode')).toBe('simple');
      // It is still the Guides view: only the mode changed.
      expect(c.querySelector('.lobbyround')!.textContent).toBe('Guides');
    } finally { outside.remove(); }
  });

  it('a press inside the rail, on its view tab or on its header keeps Detailed', () => {
    const c = openDetailed(60602);
    press(c.querySelector('.lobbyguide.open .lobbyguide-text')!);
    press(c.querySelector('.lobbyguide-head')!);
    press(c.querySelector('.lobbyrailtab')!);
    press(c.querySelector('.lobbyrailhead')!);
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-full')).toBe(true);
    expect(localStorage.getItem('ascent.guidesMode')).toBe('full');
  });

  it('a press outside changes nothing while the rail shows Opponents: the Detailed choice is kept for next time', () => {
    const c = openDetailed(60603);
    click(c.querySelector('.lobbyrailtab')!); // back to Opponents
    expect(c.querySelector('.lobbyseat')).not.toBeNull();
    press(document.body);
    expect(localStorage.getItem('ascent.guidesMode')).toBe('full');
    click(c.querySelector('.lobbyrailtab')!); // Guides again
    expect(c.querySelector('.lobbyrail')!.classList.contains('guides-full')).toBe(true);
  });

  it('stops listening when the rail goes away', () => {
    openDetailed(60604);
    ui!.unmount(); ui = null;
    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(localStorage.getItem('ascent.guidesMode')).toBe('full');
  });

  it('the write-up highlights every mentioned card and every nickname the guide has', () => {
    const run = createLobbyRun(5150, 'warden');
    run.tribes = ['beast', 'dragon', 'kobold', 'dwarf', 'demon'];
    act(() => { useGame.setState({ run, combatStaged: false }); });
    try { localStorage.setItem('ascent.guidesMode', 'full'); } catch { /* ignore */ }
    // The examples come from the guides on show: those that name a card or hold a nickname. Which they are does not
    // matter. If none does (the built-in guides name nothing one day), a guide that does is built here and shown instead.
    let withNames = guidesFor(run.setId, run.tribes).filter((g) => (g.mentions ?? []).length > 0 || Object.keys(g.aliases ?? {}).length > 0);
    if (withNames.length === 0) {
      const made: Guide = {
        ...GUIDES[0]!, id: 'made-up', tribes: [], sets: [run.setId ?? 'set1'], core: ['b2_oona'], enablers: [], mentions: ['grim'], aliases: { king: 'b2_oona' },
        body: `Open on ${CARD_INDEX['grim']!.name} and bring the king.`,
      };
      act(() => { useGuides.setState({ list: [made], source: 'server', capability: 'on' }); });
      withNames = [made];
    }
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    const c = ui.container;
    openGuides(c);
    for (const guide of withNames) {
      const el = [...c.querySelectorAll('.lobbyguide')].find((x) => x.getAttribute('data-guide') === guide.id)!;
      if (!el.classList.contains('open')) click(el.querySelector('.lobbyguide-head')!);
      const shown = [...el.querySelectorAll('.lobbyguide-text .lobbyguide-name')].map((n) => n.textContent!.toLowerCase());
      for (const id of guide.mentions ?? []) expect(shown, `${guide.id}: ${id}`).toContain(CARD_INDEX[id]!.name.toLowerCase());
      for (const word of Object.keys(guide.aliases ?? {})) expect(shown, `${guide.id}: nickname ${word}`).toContain(word.toLowerCase());
    }
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

  it("a Team Ascent guide's Edit is drawn only for the team account the store holds the flag for, never for the next account at the same rail", () => {
    const c = mountRail(8389);
    const run = useGame.getState().run;
    // Team Ascent guides as the server lists them (each has a row), for this game's set and tribes.
    const official = guidesFor(run.setId, run.tribes).map((g) => ({ ...g, rowId: `row-${g.id}` }));
    expect(official.length).toBeGreaterThan(0);
    act(() => {
      useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } });
      useGuides.setState({ list: official, source: 'server', team: true, mineOwner: 'u-1', capability: 'on' });
    });
    openGuides(c);
    const first = official[0]!;
    click(c.querySelector(`.lobbyguide[data-guide="${first.id}"] .lobbyguide-head`)!);
    const open = (): Element | null => c.querySelector(`.lobbyguide[data-guide="${first.id}"] .lobbyguide-modebtn`);
    expect(open()).not.toBeNull();
    expect(c.querySelector('.lobbyguide-editbtn')).not.toBeNull();
    // Another account signs in and the guides store is not told (a missed read): it still holds u-1's team flag.
    act(() => { useGame.setState({ account: { userId: 'u-2', email: 'x@example.test', anonymous: false, discriminator: null } }); });
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1' });
    expect(open()).not.toBeNull(); // the guide is still open: Team Ascent's guides are everyone's
    expect(c.querySelector('.lobbyguide-editbtn')).toBeNull();
    // ...or a guest (no account id at all).
    act(() => { useGame.setState({ account: { userId: null, email: null, anonymous: true, discriminator: null } }); });
    expect(c.querySelector('.lobbyguide-editbtn')).toBeNull();
    // Back to the account the flag is held for: Edit is offered again.
    act(() => { useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } }); });
    expect(c.querySelector('.lobbyguide-editbtn')).not.toBeNull();
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

  // Step 3: the guides a player bookmarked, for this game's set and tribes, follow their own.
  const bm = (id: string, tribe: Tribe | null, patch: Partial<Guide> = {}): Guide => ({
    ...GUIDES[0]!, id, rowId: id, official: false, published: true, authorId: 'u-9', byline: 'Ann', title: `Bookmark ${id}`, tribes: tribe ? [tribe] : [], ...patch,
  });

  it("bookmarked guides for this game follow the player's own, under a 'Bookmarked' label, and are counted", () => {
    // Every lobby of the live set holds all of that set's tribes today, so no seed leaves one out. Take one out by
    // hand, as a set with more tribes than a lobby would: the "not for a tribe outside the lobby" case below must run.
    const run = createLobbyRun(9191, 'warden');
    run.tribes = run.tribes.slice(0, -1);
    act(() => { useGame.setState({ run, combatStaged: false }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    const c = ui.container;
    signInU1();
    const set: SetId = run.setId ?? 'set1';
    const team = guidesFor(run.setId, run.tribes).length;
    const outside = SETS[set].tribes.find((t) => !run.tribes.includes(t));
    // Fail loudly rather than skip the case: without a tribe outside the lobby it would pass without being tried.
    expect(outside, 'no tribe of the set is outside this lobby').toBeDefined();
    act(() => {
      useGuides.setState({
        mineOwner: 'u-1',
        bookmarked: [
          bm('bm-in', run.tribes[0]!, { sets: [set] }), bm('bm-neutral', null, { sets: [set] }),
          bm('bm-otherset', run.tribes[0]!, { sets: [] }), bm('bm-outside', outside!, { sets: [set] }),
        ],
      });
    });
    openGuides(c);
    const labels = [...c.querySelectorAll('.lobbyguides-sec')].map((e) => e.textContent);
    expect(labels).toContain('Bookmarked');
    const shown = [...c.querySelectorAll('.lobbyguide')].map((e) => e.getAttribute('data-guide'));
    expect(shown).toContain('bm-in');
    expect(shown).toContain('bm-neutral');
    expect(shown).not.toContain('bm-otherset');
    expect(shown).not.toContain('bm-outside');
    expect(shown.indexOf('bm-in')).toBeGreaterThanOrEqual(team);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe(`${team + 2} guides`);
  });

  it("a bookmarked guide has no Edit button, and one that is also the player's own or Team Ascent's is drawn once", () => {
    const c = mountRail(9292);
    const run = useGame.getState().run;
    signInU1();
    const set: SetId = run.setId ?? 'set1';
    const own = bm('own-1', run.tribes[0]!, { sets: [set], authorId: 'u-1', byline: 'Mike' });
    act(() => { useGuides.setState({ capability: 'on', mineOwner: 'u-1', mine: [own], bookmarked: [own, bm('bm-1', run.tribes[0]!, { sets: [set] })] }); });
    openGuides(c);
    expect(c.querySelectorAll('.lobbyguide[data-guide="own-1"]').length).toBe(1);
    click(c.querySelector('.lobbyguide[data-guide="bm-1"] .lobbyguide-head')!);
    expect(c.querySelector('.lobbyguide[data-guide="bm-1"] .lobbyguide-editbtn')).toBeNull();
  });

  it('bookmarks held for another account, or for nobody, are never drawn; they leave an open rail when the account changes', () => {
    const c = mountRail(9393);
    const run = useGame.getState().run;
    const set: SetId = run.setId ?? 'set1';
    act(() => { useGuides.setState({ mineOwner: 'u-2', bookmarked: [bm('bm-1', run.tribes[0]!, { sets: [set] })] }); });
    signInU1();
    openGuides(c);
    expect(c.querySelector('.lobbyguide[data-guide="bm-1"]')).toBeNull();
    click(c.querySelector('.lobbyrailtab')!); // back to Opponents
    act(() => { useGuides.setState({ mineOwner: 'u-1' }); });
    openGuides(c);
    expect(c.querySelector('.lobbyguide[data-guide="bm-1"]')).not.toBeNull();
    act(() => { useGame.setState({ account: { userId: 'u-2', email: 'k@example.test', anonymous: false, discriminator: null } }); });
    expect(c.querySelector('.lobbyguide[data-guide="bm-1"]')).toBeNull();
    expect([...c.querySelectorAll('.lobbyguides-sec')].map((e) => e.textContent)).not.toContain('Bookmarked');
  });

  it('the header says "1 guide" when the only card shown is a bookmark', () => {
    const c = mountRail(9595);
    const run = useGame.getState().run;
    signInU1();
    // No Team Ascent guide for this lobby and none of the player's own: the one card is the bookmark.
    act(() => { useGuides.setState({ list: [], mine: [], mineOwner: 'u-1', bookmarked: [bm('bm-only', null, { sets: [run.setId ?? 'set1'] })] }); });
    openGuides(c);
    expect([...c.querySelectorAll('.lobbyguide')].map((e) => e.getAttribute('data-guide'))).toEqual(['bm-only']);
    expect([...c.querySelectorAll('.lobbyguides-sec')].map((e) => e.textContent)).toEqual(['Bookmarked']);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe('1 guide');
  });

  it('when the account changes with the Guides view open, the header count drops by the bookmarked rows', () => {
    const c = mountRail(9696);
    const run = useGame.getState().run;
    const set: SetId = run.setId ?? 'set1';
    const team = guidesFor(run.setId, run.tribes).length;
    signInU1();
    act(() => { useGuides.setState({ mineOwner: 'u-1', bookmarked: [bm('bm-1', run.tribes[0]!, { sets: [set] }), bm('bm-2', null, { sets: [set] })] }); });
    openGuides(c);
    expect(c.querySelectorAll('.lobbyguide').length).toBe(team + 2);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe(`${team + 2} guides`);
    // Another account signs in while the view stays open: the two bookmarked rows go, and the count with them.
    act(() => { useGame.setState({ account: { userId: 'u-2', email: 'k@example.test', anonymous: false, discriminator: null } }); });
    expect(c.querySelectorAll('.lobbyguide').length).toBe(team);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe(`${team} guides`);
  });

  it("a bookmark whose id is a Team Ascent guide's id is drawn once, and counted once", () => {
    const c = mountRail(9797);
    const run = useGame.getState().run;
    const set: SetId = run.setId ?? 'set1';
    const teamGuides = guidesFor(run.setId, run.tribes);
    expect(teamGuides.length).toBeGreaterThan(0);
    const twin = teamGuides[0]!;
    signInU1();
    // Same id as a Team Ascent guide on the rail, and for this game's set and a lobby tribe: it would be drawn if it were not already.
    act(() => { useGuides.setState({ mineOwner: 'u-1', bookmarked: [bm(twin.id, run.tribes[0]!, { sets: [set] }), bm('bm-1', run.tribes[0]!, { sets: [set] })] }); });
    openGuides(c);
    expect(c.querySelectorAll(`.lobbyguide[data-guide="${twin.id}"]`).length).toBe(1);
    expect(c.querySelector('.lobbyguide[data-guide="bm-1"]')).not.toBeNull();
    expect(c.querySelectorAll('.lobbyguide').length).toBe(teamGuides.length + 1);
    expect(c.querySelector('.lobbyalive')!.textContent).toBe(`${teamGuides.length + 1} guides`);
  });

  it('a bookmark made while the rail is open does not add a card under the reader', () => {
    const c = mountRail(9494);
    const run = useGame.getState().run;
    signInU1();
    act(() => { useGuides.setState({ mineOwner: 'u-1', bookmarked: [] }); });
    openGuides(c);
    const before = c.querySelectorAll('.lobbyguide').length;
    act(() => { useGuides.setState({ bookmarked: [bm('bm-late', run.tribes[0]!, { sets: [run.setId ?? 'set1'] })] }); });
    expect(c.querySelectorAll('.lobbyguide').length).toBe(before);
  });
});
