// @vitest-environment jsdom
/**
 * THE COLLECTION SCREEN (relaid out 2026-09-28, owner: "i think the layout is horrible. research best in class
 * collection screens and mimic them"), rendered under jsdom with the network seam mocked and the crate theatre's
 * Pixi layer swapped for a no-op (jsdom has no WebGL):
 *  - routing (title plaque / sidebar / Career card) and Back;
 *  - the album: every catalog title, owned bright, missing dimmed with the rarity readable, the equipped ribbon;
 *  - the filters (Show x Rarity) with counts, and the no-match state;
 *  - category switching: the locked categories open a "coming soon" view; the crate bay stays in view;
 *  - the detail panel: nameplate, how to get it, the preview under your name, Equip / Take off / a refusal;
 *  - the crate bay: count, next crate, Open / Open all into the (unchanged) theatre, empty, off, loading;
 *  - the NEW badge: local only, clears on pick, survives a remount, returns for a newly found item;
 *  - guest mode, and the stage + performance tripwires on the screen's own stylesheet.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenCrateResult, ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { CrateFx } from './crateFx/crateFxPixi';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const openCrateRemote = vi.fn();
const equipTitleRemote = vi.fn();
const fetchOwnCrates = vi.fn(async () => undefined as unknown);
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  openCrateRemote: (id: string) => openCrateRemote(id),
  equipTitleRemote: (id: string | null) => equipTitleRemote(id),
  fetchOwnCrates: () => fetchOwnCrates(),
}));

import { CollectionPage, CollectionScreen } from './CollectionScreen';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { useGame } from '../store';

/** The Pixi layer as a no-op: every method does nothing, `mount` succeeds. A Proxy, so a method the opener's
 *  owner adds later (the opener is not this screen's file) never breaks these layout tests. */
const noopFx = (): CrateFx => new Proxy({}, {
  get: (_t, k) => (k === 'then' ? undefined : k === 'mount' ? async () => true : () => {}),
}) as CrateFx;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setCrateFxFactoryForTests(null); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  openCrateRemote.mockReset();
  equipTitleRemote.mockReset();
  setCrateFxFactoryForTests(noopFx);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, accountPanelOpen: false, showCollection: false, showCareer: false, playerName: 'Kevin' });
});

const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester', 'title_star_chaser'], ...over });
const opened = (crateId: string, rewardId: string, earnedLevel = 2, sealedRemaining = 0): OpenCrateResult => ({
  status: 'opened', rewardId, sealedRemaining, crate: { crateId, earnedLevel, state: 'opened', rewardId, earnedAt: 't0', openedAt: 't1' },
});
const crateList = [
  { crateId: 'c-1', earnedLevel: 1, state: 'opened' as const, rewardId: 'title_star_chaser', earnedAt: null, openedAt: null },
  { crateId: 'c-2', earnedLevel: 2, state: 'sealed' as const, rewardId: null, earnedAt: null, openedAt: null },
  { crateId: 'c-3', earnedLevel: 3, state: 'sealed' as const, rewardId: null, earnedAt: null, openedAt: null },
];
/** Seen ids pre-seeded so a test starts without NEW badges unless it wants them. */
function open(over: Partial<ProgressionProfile> = {}, opts: { seen?: string[]; crates?: typeof crateList | null; cratesOn?: 'on' | 'off' } = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(opts.seen ?? ['alpha_tester', 'title_star_chaser']));
  useProgression.setState({ capability: 'on', cratesCapability: opts.cratesOn ?? 'on', crateList: opts.crates === undefined ? crateList : opts.crates, mirror: { userId: 'u-1', ...profile(over) } });
  ui = mount(<CollectionPage reducedMotion />);
}

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const tileNames = (): string[] => $$('.colls-tile .colls-tile-name').map((n) => n.textContent ?? '');
const chip = (label: string): HTMLButtonElement => $$('.colls-chip').find((c) => c.textContent?.startsWith(label)) as HTMLButtonElement;
const tab = (label: string): HTMLButtonElement => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement;
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the Collection screen: routing', () => {
  it('the store flag (title plaque, sidebar, Career card) mounts it; Back closes it and returns to the Career', () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile() } });
    ui = mount(<CollectionScreen />);
    expect($('.colls-page')).toBeNull();
    act(() => { useGame.getState().goTo('collection'); });
    expect($('.colls-page')).not.toBeNull();
    expect($('.msb .sbbtn.active')?.textContent).toBe('Collection');
    act(() => { useGame.getState().goTo('career'); });
    expect($('.colls-page')).toBeNull();
    act(() => { useGame.getState().openCareer(); useGame.getState().openCollection(); });
    act(() => $('.msb-back')!.click());
    expect(useGame.getState().showCollection).toBe(false);
    expect(useGame.getState().showCareer).toBe(true);
  });
});

describe('the Collection screen: the album', () => {
  it('shows every title, owned or not, rarest first; owned bright, missing dimmed with a lock, the equipped one ribboned', () => {
    open();
    expect(tileNames()).toHaveLength(49);
    expect(tileNames()[0]).toBe('The Unbroken'); // Legendary leads the album
    expect(tile('Alpha Tester').className).toMatch(/\bowned\b/);
    expect(tile('Alpha Tester').className).toMatch(/\bworn\b/);
    expect(tile('Alpha Tester').querySelector('.colls-tile-ribbon')?.textContent).toBe('Equipped');
    expect(tile('Star Chaser').className).toMatch(/\bowned\b/);
    expect(tile('Star Chaser').querySelector('.colls-tile-ribbon')).toBeNull();
    const missing = tile('Kingbreaker');
    expect(missing.className).toMatch(/\bmissing\b/);
    expect(missing.className).toMatch(/\br-epic\b/); // the rarity frame stays readable
    expect(missing.querySelector('.colls-tile-rar')?.textContent).toBe('Epic');
    expect(missing.querySelector('.colls-tile-lock')).not.toBeNull();
    expect(missing.getAttribute('aria-label')).toBe('Kingbreaker, Epic, not owned');
    // "N / M collected" counts every live item: 16 titles + the 6 skins + 8 hero attacks (2026-09-28: Quake made it 24,
    // Arcana and Phantom Blades 26, Enraged Strike 27, Venom Volley 28, Frost Nova 29, Consecration 30; skins batch 2 +13 minion skins, 43)
    // + 33 hero titles (2026-09-29; each hero's golden master replaces its title once owned, so it never adds a slot), 76; Inferno (2026-09-29), 77; Grave Call (2026-09-29), 78; the Stampede (2026-09-29), 79; Oona's Banana Cannon (2026-09-29), 80
    expect(text('.colls-meter-num')).toBe('2 / 84');
    expect(text('.colls-tab.on .colls-tab-count')).toBe('2/49');
    clean();
  });

  it('the header shows the Account Level and its XP', () => {
    open();
    expect(text('.colls-level .colls-meter-lbl')).toMatch(/^Account Level \d+$/);
    expect(text('.colls-level-xp')).toMatch(/^\d+ \/ \d+ XP$/);
  });

  it('filters: Owned, Missing and a rarity, with counts; no match offers Show all', () => {
    open();
    expect(text('.colls-seg .colls-chip.on')).toBe('All49');
    act(() => chip('Owned').click());
    expect(tileNames()).toEqual(['Alpha Tester', 'Star Chaser']);
    act(() => chip('Missing').click());
    expect(tileNames()).toHaveLength(47);
    expect(tileNames()).not.toContain('Alpha Tester');
    act(() => chip('All').click());
    act(() => chip('Legendary').click());
    expect(tileNames()).toEqual(['The Unbroken']);
    expect(text('.colls-chip-r.r-legendary .colls-chip-n')).toBe('0/1');
    act(() => chip('Owned').click()); // owned + legendary: none
    expect($('.colls-nomatch')).not.toBeNull();
    expect(text('.colls-nomatch div')).toBe('Nothing matches these filters.');
    act(() => button('Show all')!.click());
    expect(tileNames()).toHaveLength(49);
  });
});

describe('hero titles in the Collection (owner 2026-09-29: "the master title should be a golden plate and embroidered text")', () => {
  it('a missing hero title says how to earn it; the master replaces it in place once owned, as the golden plate', () => {
    open();
    act(() => tile('Warded').click());
    expect(text('.colls-hint')).toBe('Finish 1st in 3 Ranked games as Warden.');
    expect(text('.colls-facts')).toContain('Finish 1st in 10 Ranked games as Warden to make it a golden plate.');
    expect($('.colls-tile .tb-master')).toBeNull(); // no master shows until one is owned
    ui?.unmount();
    open({ titles: ['alpha_tester', 'title_hero_warden', 'title_hero_warden_master'], equippedTitleId: 'title_hero_warden_master' }, { seen: ['alpha_tester', 'title_hero_warden', 'title_hero_warden_master'] });
    expect(tileNames().filter((n) => n === 'Warded')).toHaveLength(1); // one Warded, not two
    const warded = tile('Warded');
    expect(warded.querySelector('.titlebadge.tb-master')).not.toBeNull();
    expect(warded.className).toMatch(/\bworn\b/);
    expect(tileNames()).toHaveLength(49); // the master took the title's slot
    expect(tileNames().slice(0, 2)).toEqual(['The Unbroken', 'Warded']); // the Legendaries lead the album
    expect(text('.colls-meter-num')).toBe('2 / 84'); // Alpha Tester + Warded (the master stands for both tiers)
    // the detail panel's nameplate and the preview under your name are the plate too
    expect($('.colls-plate-name .titlebadge.tb-master')?.textContent).toBe('Warded');
    expect($('.colls-preview-title .titlebadge.tb-master')?.textContent).toBe('Warded');
    expect(text('.colls-facts')).toContain('Mastered.');
    clean();
  });
});

describe('the Collection screen: categories', () => {
  it('the switched-off categories are locked tabs that open a coming-soon view; the crate bay stays in view', () => {
    open();
    // Heroes and Minions went live with the skins (2026-09-28); Announcers is still switched off.
    expect(tab('Heroes').className).not.toMatch(/\blocked\b/);
    expect(tab('Announcers').className).toMatch(/\blocked\b/);
    expect(tab('Announcers').textContent).toContain('Soon');
    act(() => tab('Announcers').click());
    expect(tab('Announcers').getAttribute('aria-selected')).toBe('true');
    expect($$('.colls-tile')).toHaveLength(0);
    expect(text('.colls-soon-title')).toBe('Announcers');
    expect(text('.colls-soon-sub')).toBe('New voices to call your games. Coming soon.');
    expect($$('.colls-ghost')).toHaveLength(8);
    expect($('.colls-bay')).not.toBeNull();
    expect(button('Open')).toBeTruthy();
    act(() => tab('Titles').click());
    expect(tileNames()).toHaveLength(49);
    clean();
  });
});

describe('the Collection screen: the detail panel', () => {
  it('shows the selected item large, how to get it, and a preview under your name', () => {
    open();
    expect(text('.colls-plate-name')).toBe('Alpha Tester'); // the equipped title is selected first
    expect(text('.colls-preview-name')).toBe('Kevin');
    expect(text('.colls-preview-title')).toBe('Alpha Tester');
    expect($$('.colls-fact b').map((b) => b.textContent)).toEqual(['Equipped', 'Reach Level 2.']);
    act(() => tile('Kingbreaker').click());
    expect(tile('Kingbreaker').getAttribute('aria-pressed')).toBe('true');
    expect(text('.colls-plate-name')).toBe('Kingbreaker');
    expect(text('.colls-plate-rar')).toBe('Epic');
    expect($$('.colls-fact b').map((b) => b.textContent)).toEqual(['Not owned', 'Found in crates.']);
    expect(text('.colls-hint')).toBe('Open crates to find it.');
    expect(button('Equip')).toBeUndefined();
  });

  it('Equip goes through the server; the returned profile moves the equipped marker', async () => {
    open();
    equipTitleRemote.mockResolvedValue({ status: 'ok', value: null, profile: profile({ equippedTitleId: 'title_star_chaser', revision: 12 }) });
    act(() => tile('Star Chaser').click());
    act(() => button('Equip')!.click());
    await settle();
    expect(equipTitleRemote).toHaveBeenCalledWith('title_star_chaser');
    expect(text('.colls-tile.worn .colls-tile-name')).toBe('Star Chaser');
    expect(text('.colls-worn-tag')).toBe('Equipped');
  });

  it('Take off sends null; a refusal leaves the title as it was and says so', async () => {
    open();
    equipTitleRemote.mockResolvedValue({ status: 'ok', value: null, profile: profile({ equippedTitleId: null, revision: 12 }) });
    act(() => button('Take off')!.click());
    await settle();
    expect(equipTitleRemote).toHaveBeenCalledWith(null);
    expect($('.colls-tile.worn')).toBeNull();
    equipTitleRemote.mockResolvedValue({ status: 'error', reason: 'not_owned' });
    act(() => tile('Star Chaser').click());
    act(() => button('Equip')!.click());
    await settle();
    expect(text('.coll-error')).toBe('Could not change your title. Try again.');
    expect(useProgression.getState().mirror!.equippedTitleId).toBeNull();
  });
});

describe('the Collection screen: the crate bay', () => {
  it('shows the count and the next crate; Open plays the oldest in the theatre; the bay updates underneath', async () => {
    open();
    expect(text('.colls-hero-count')).toBe('2');
    expect(text('.colls-bay-sub')).toBe('2 ready. Next: Level 2 Crate');
    expect(button('Open all (2)')).toBeTruthy();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_hearthkeeper', 2, 1), profile: profile({ titles: ['alpha_tester', 'title_star_chaser', 'title_hearthkeeper'], revision: 10 }) });
    act(() => button('Open')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
    expect(text('.crate-reward-name')).toBe('Hearthkeeper');
    expect(text('.colls-bay-sub')).toBe('1 ready. Next: Level 3 Crate');
    act(() => button('Done')!.click());
    expect($('.crth')).toBeNull();
    expect(tile('Hearthkeeper').className).toMatch(/\bowned\b/);
  });

  it('Open all hands the whole queue to the theatre', async () => {
    open();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_wanderer', 2, 1), profile: profile() });
    act(() => button('Open all (2)')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
    expect($('.crth')).not.toBeNull();
  });

  it('no sealed crates names the next level; crates off and loading say so', () => {
    open({ accountXp: 0 }, { crates: [crateList[0]!] });
    expect(text('.colls-bay-sub')).toBe('None right now. Your next crate comes at Level 2.');
    // the published fixed odds (owner 2026-09-29: "make it 50/30/15/5 though") show whenever crates are on
    expect(text('.colls-bay-odds')).toBe('Crate odds: Common 50%, Rare 30%, Epic 15%, Legendary 5%');
    expect(button('Open')).toBeUndefined();
    ui!.unmount();
    open({}, { cratesOn: 'off' });
    expect(text('.colls-bay-sub')).toBe('Crates are coming soon.');
    expect($('.colls-bay-odds')).toBeNull(); // no odds while crates are off
    expect(tileNames()).toHaveLength(49); // the album still shows
    ui!.unmount();
    open({}, { crates: null });
    expect(text('.colls-bay-sub')).toBe('Loading');
  });
});

describe('the Collection screen: NEW', () => {
  it('an owned, unseen item wears NEW (and its tab counts it) until you pick it; the flag is local only', () => {
    open({ titles: ['alpha_tester', 'title_star_chaser', 'title_kingbreaker'] }, { seen: ['alpha_tester'] });
    expect($$('.colls-tile.fresh .colls-tile-name').map((n) => n.textContent).sort()).toEqual(['Kingbreaker', 'Star Chaser']);
    expect(text('.colls-tab.on .colls-tab-new')).toBe('2');
    expect(text('.colls-plate-name')).toBe('Alpha Tester'); // opening the page never clears a badge by itself
    act(() => tile('Kingbreaker').click());
    expect(tile('Kingbreaker').querySelector('.colls-new')).toBeNull();
    expect(text('.colls-tab.on .colls-tab-new')).toBe('1');
    expect(JSON.parse(localStorage.getItem('ascent.collection.seen.u-1')!)).toContain('title_kingbreaker');
    expect(equipTitleRemote).not.toHaveBeenCalled();
    expect(openCrateRemote).not.toHaveBeenCalled();
    ui!.unmount();
    ui = mount(<CollectionPage reducedMotion />); // survives a remount
    expect($$('.colls-tile.fresh .colls-tile-name').map((n) => n.textContent)).toEqual(['Star Chaser']);
  });

  it('peeking at a missing item does not spend its NEW: it still shows the day a crate gives it', () => {
    open({}, { seen: ['alpha_tester', 'title_star_chaser'] });
    act(() => tile('Ironbeard').click());
    expect(JSON.parse(localStorage.getItem('ascent.collection.seen.u-1')!)).not.toContain('title_ironbeard');
    act(() => { useProgression.setState({ mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester', 'title_star_chaser', 'title_ironbeard'], revision: 20 }) } }); });
    expect(tile('Ironbeard').querySelector('.colls-new')?.textContent).toBe('New');
  });
});

describe('the Collection screen: a guest', () => {
  it('shows a slim save row that opens the account panel', () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    open();
    expect(text('.colls-guest span')).toBe('Guest account. Save it to keep your collection.');
    act(() => button('Create account')!.click());
    expect(useGame.getState().accountPanelOpen).toBe(true);
    clean();
  });
});

describe('the Collection screen: stage and performance tripwires', () => {
  const css = readFileSync(join(__dirname, 'collection.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('no raw viewport units, no viewport @media, no plain cursor keywords', () => {
    expect(css).not.toMatch(/(?<![\w-])-?[\d.]+[dsl]?v[wh]\b/);
    expect(css).not.toMatch(/@media[^{]*\((min-|max-)?(width|height|aspect-ratio)\s*:/);
    expect(css).not.toMatch(/cursor\s*:/);
  });
  it('every looping animation moves only transform or opacity', () => {
    const looping = new Set([...css.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g)].map((m) => m[1]!));
    expect(looping.size).toBeGreaterThan(0);
    for (const name of looping) {
      const body = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?\\})\\s*\\}`))?.[1] ?? '';
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const p of props) expect(['transform', 'opacity'], `${name}: ${p}`).toContain(p);
    }
  });
  // Owner 2026-09-28: "blur unowned titles". A static blur on the name (tile, nameplate, preview), never animated.
  it('an unowned title name is blurred on the tile, the detail nameplate and the preview', () => {
    for (const sel of ['.colls-tile.missing .colls-tile-name', '.colls-detail.missing .colls-plate-name', '.colls-detail.missing .colls-preview-title']) {
      const rule = css.match(new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule, sel).toMatch(/filter:\s*blur\(\d+px\)/);
    }
    expect(css).not.toMatch(/transition:[^;]*filter/);
  });
});
