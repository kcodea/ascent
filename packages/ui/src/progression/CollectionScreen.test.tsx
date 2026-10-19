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
 *  - the NEW badge: saved on the account (with a copy on the device); clears on pick at once and on view once you
 *    leave the tab, never on the equipped item, returns for a newly found item; the device-only fallback;
 *  - guest mode, and the stage + performance tripwires on the screen's own stylesheet.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuyCrateResult, CrateRow, OpenCrateResult, ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { CrateFx } from './crateFx/crateFxPixi';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const openCrateRemote = vi.fn();
const buyCrateRemote = vi.fn();
const equipTitleRemote = vi.fn();
const fetchOwnCrates = vi.fn(async () => undefined as unknown);
const fetchSeenCosmeticIds = vi.fn(async (): Promise<string[] | 'unsupported' | undefined> => undefined);
const markCosmeticsSeenRemote = vi.fn(async (_ids: readonly string[]) => true);
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
// The account backend's presence (the crate sign-in gate says "unavailable" without one). On unless a test turns it off.
const backend = vi.hoisted(() => ({ on: true }));
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), remoteEnabled: () => backend.on }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  openCrateRemote: (id: string) => openCrateRemote(id),
  buyCrateRemote: (req: unknown) => buyCrateRemote(req),
  fetchAetherEconomy: async () => undefined,
  equipTitleRemote: (id: string | null) => equipTitleRemote(id),
  fetchOwnCrates: () => fetchOwnCrates(),
  fetchSeenCosmeticIds: () => fetchSeenCosmeticIds(),
  markCosmeticsSeenRemote: (ids: readonly string[]) => markCosmeticsSeenRemote(ids),
}));

import { CollectionPage, CollectionScreen } from './CollectionScreen';
import { refreshSeenList, resetProgressionForTests, useProgression } from './progressionStore';
import { queueNewCrate, resetNewRewardsForTests } from './newRewards';
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
  buyCrateRemote.mockReset();
  equipTitleRemote.mockReset();
  fetchSeenCosmeticIds.mockReset().mockResolvedValue(undefined);
  markCosmeticsSeenRemote.mockReset().mockResolvedValue(true);
  setCrateFxFactoryForTests(noopFx);
  backend.on = true;
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
/** Seen ids pre-seeded so a test starts without NEW badges unless it wants them, on a device that already knows
 *  what the account has seen (the marker): without it the page shows no badge at all. */
function open(over: Partial<ProgressionProfile> = {}, opts: { seen?: string[]; crates?: CrateRow[] | null; cratesOn?: 'on' | 'off'; aether?: boolean } = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(opts.seen ?? ['alpha_tester', 'title_star_chaser']));
  localStorage.setItem('ascent.collection.baseline.u-1', '1');
  useProgression.setState({ capability: 'on', cratesCapability: opts.cratesOn ?? 'on', aetherCapability: opts.aether ? 'on' : 'off', crateList: opts.crates === undefined ? crateList : opts.crates, mirror: { userId: 'u-1', ...profile(over) } });
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
  it('the store flag (title plaque, sidebar, Career card) mounts it; the rail\'s Career plaque returns to the Career', () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile() } });
    ui = mount(<CollectionScreen />);
    expect($('.colls-page')).toBeNull();
    act(() => { useGame.getState().goTo('collection'); });
    expect($('.colls-page')).not.toBeNull();
    expect($('.msb .sbbtn.active')?.textContent).toBe('Collection');
    act(() => { useGame.getState().goTo('career'); });
    expect($('.colls-page')).toBeNull();
    act(() => { useGame.getState().openCareer(); useGame.getState().openCollection(); });
    act(() => ([...document.querySelectorAll<HTMLButtonElement>('.msb .sbbtn')].find((b) => b.textContent?.trim() === 'Career'))!.click());
    expect(useGame.getState().showCollection).toBe(false);
    expect(useGame.getState().showCareer).toBe(true);
  });
});

describe('the Collection screen: the album', () => {
  it('shows every title, owned or not, rarest first; owned bright, missing dimmed with a lock, the equipped one ribboned', () => {
    open();
    expect(tileNames()).toHaveLength(58);
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
    // + 33 hero titles (2026-09-29; each hero's golden master replaces its title once owned, so it never adds a slot), 76; Inferno (2026-09-29), 77; Grave Call (2026-09-29), 78; the Stampede (2026-09-29), 79; Oona's Banana Cannon (2026-09-29), 80; Hemorrhage (2026-09-29), 81; the Epics Card Shark and Storm Call (2026-09-29), 83; skins batch 3 (2026-09-29, +4 minion skins and a Frantic Frank hero skin) +5; skins batch 4 (2026-09-30, +16 minion and +16 hero skins) +32; skins batch 5 (2026-09-30, +11 minion skins and Influencer Indy) +12; skins batch 6 (2026-10-01, +9 minion skins) +9; skins + frames batch 3 (2026-10-01, +3 hero skins and +10 portrait frames) +13; frames batch 4 (2026-10-01, +5 portrait frames) +5; frames batch 5 (2026-10-02, Simple Ring and Void) +2; frames batch 6 (2026-10-02, Cherry Blossom) +1; Rayse's hero title (2026-10-02, un-archived) +1; the six Ancient frames (2026-10-02) +6; skins batch 8 + frames batch 7 (2026-10-03, +11 hero skins and +7 portrait frames) +18; frames batch 8 (2026-10-06, Cosmic Glass) +1; skins batch 9 (2026-10-07, Canyon Drake and Thunderchorus Drake) +2; frames batch 9 (2026-10-07, Blossom, Neonpunk, Solar Flare, Color Doodle, Neon Ring) +5
    expect(text('.colls-meter-num')).toBe('3 / 318'); // 2026-10-18: nine more crate emotes made it 299. 2026-10-17: Phoenix removed made it 290; Goop made it 291; three more card plates made it 290; thirteen before that made it 287. 2026-10-16: the Chrome card plate made it 274. 2026-10-16: seven more card plates made it 273. 2026-10-15: Sad Wrangler retired made it 266. 2026-10-15: thirteen more card plates made it 267. 2026-10-15: Zen Brian back as the one starter emote, owned by all, 3 / 254. 2026-10-15: emotes became crate drops (no starters owned; thirteen crate emotes in the total) and Angry Mushy retired, 2 / 254. 2026-10-15: the six Legendary card plates made it 245. 2026-10-15: six re-enabled heroes' titles made it 6 / 239. 2026-10-13: the four starter emotes, owned by everyone, made it 6 / 233. 2026-10-11: the first announcer (Lemon) made the total 227
    expect(text('.colls-tab.on .colls-tab-count')).toBe('2/58');
    clean();
  });

  it('the header shows the Account Level and its XP', () => {
    open();
    expect(text('.colls-level .colls-meter-lbl')).toMatch(/^Account Level \d+$/);
    expect(text('.colls-level-xp')).toMatch(/^\d+ \/ \d+ XP$/);
  });

  it('filters: Owned, Missing and a rarity, with counts; no match offers Show all', () => {
    open();
    expect(text('.colls-seg .colls-chip.on')).toBe('All58');
    act(() => chip('Owned').click());
    expect(tileNames()).toEqual(['Alpha Tester', 'Star Chaser']);
    act(() => chip('Missing').click());
    expect(tileNames()).toHaveLength(56);
    expect(tileNames()).not.toContain('Alpha Tester');
    act(() => chip('All').click());
    act(() => chip('Legendary').click());
    expect(tileNames()).toEqual(['The Unbroken']);
    expect(text('.colls-chip-r.r-legendary .colls-chip-n')).toBe('0/1');
    act(() => chip('Owned').click()); // owned + legendary: none
    expect($('.colls-nomatch')).not.toBeNull();
    expect(text('.colls-nomatch div')).toBe('Nothing matches these filters.');
    act(() => button('Show all')!.click());
    expect(tileNames()).toHaveLength(58);
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
    expect(tileNames()).toHaveLength(58); // the master took the title's slot
    expect(tileNames().slice(0, 2)).toEqual(['The Unbroken', 'Warded']); // the Legendaries lead the album
    expect(text('.colls-meter-num')).toBe('3 / 318'); // Alpha Tester + Warded (the master stands for both tiers) + Zen Brian, the one starter emote (2026-10-15)
    // the detail panel's nameplate and the preview under your name are the plate too
    expect($('.colls-plate-name .titlebadge.tb-master')?.textContent).toBe('Warded');
    expect($('.colls-preview-title .titlebadge.tb-master')?.textContent).toBe('Warded');
    expect(text('.colls-facts')).toContain('Mastered.');
    clean();
  });
});

describe('the Collection screen: categories', () => {
  it('Announcers is a live tab (owner 2026-10-11): its first voice, Lemon, is a Legendary you can hear before you own it', () => {
    open();
    // Heroes and Minions went live with the skins (2026-09-28); Announcers with its first voice (2026-10-11).
    expect(tab('Heroes').className).not.toMatch(/\blocked\b/);
    expect(tab('Announcers').className).not.toMatch(/\blocked\b/);
    expect(tab('Announcers').textContent).not.toContain('Soon');
    act(() => tab('Announcers').click());
    expect(tab('Announcers').getAttribute('aria-selected')).toBe('true');
    expect(text('.colls-tab.on .colls-tab-count')).toBe('0/3');
    expect($$('.colls-tile')).toHaveLength(3); // Lemon, Underdweller, Little Inu
    expect($$('.colls-ghost')).toHaveLength(0);
    expect($('.colls-tile')!.getAttribute('aria-label')).toBe('Lemon, Legendary, not owned');
    expect(text('.colls-kicker')).toBe('Announcer');
    expect(text('.colls-facts')).toContain('Only you hear it');
    expect(button('Hear a line')?.getAttribute('aria-label')).toBe('Hear a line from Lemon'); // not owned, still previewable
    expect($('.colls-equip')).toBeNull();
    expect($('.colls-bay')).not.toBeNull();
    expect(button('Open')).toBeTruthy();
    act(() => tab('Titles').click());
    expect(tileNames()).toHaveLength(58);
    clean();
  });
  it('an OWNED announcer can be equipped', () => {
    open({ cosmetics: ['title_alpha_tester', 'announcer_lemon'] });
    act(() => tab('Announcers').click());
    expect(text('.colls-tab.on .colls-tab-count')).toBe('1/3');
    expect($('.colls-tile')!.getAttribute('aria-label')).toContain('Lemon, Legendary');
    expect($('.colls-equip')?.getAttribute('aria-label')).toBe('Equip Lemon');
    clean();
  });
  it('a WORN announcer shows as equipped and offers the default voice back', () => {
    open({ cosmetics: ['title_alpha_tester', 'announcer_lemon'], loadout: { announcer: 'announcer_lemon' } });
    act(() => tab('Announcers').click());
    expect($('.colls-tile')!.className.split(' ')).toContain('worn');
    expect(button('Use default announcer')?.getAttribute('aria-label')).toBe('Use the default announcer');
    expect($('.colls-equip')).toBeNull();
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
    // Missing: the hint says how to get it, once (the How to get fact only shows on an owned item, 2026-10-16).
    expect($$('.colls-fact b').map((b) => b.textContent)).toEqual(['Not owned']);
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
    // the published fixed odds (owner 2026-10-02: Ancient at 3%, so 35/31/22/9/3) show whenever crates are on
    expect(text('.colls-bay-odds')).toBe('Crate odds: Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%');
    expect(button('Open')).toBeUndefined();
    ui!.unmount();
    open({}, { cratesOn: 'off' });
    expect(text('.colls-bay-sub')).toBe('Crates are coming soon.');
    expect($('.colls-bay-odds')).toBeNull(); // no odds while crates are off
    expect(tileNames()).toHaveLength(58); // the album still shows
    ui!.unmount();
    open({}, { crates: null });
    expect(text('.colls-bay-sub')).toBe('Loading');
  });
});

describe('the Collection screen: NEW', () => {
  const seenList = (): string[] => JSON.parse(localStorage.getItem('ascent.collection.seen.u-1') ?? '[]') as string[];
  const freshNames = (): string[] => $$('.colls-tile.fresh .colls-tile-name').map((n) => n.textContent ?? '').sort();
  const three = ['alpha_tester', 'title_star_chaser', 'title_kingbreaker'];
  /** The account's list lands (what the probe does once identity is known). */
  const accountSays = async (seen: string[] | 'unsupported' | undefined, p: ProgressionProfile | null = null): Promise<void> => {
    fetchSeenCosmeticIds.mockResolvedValueOnce(seen);
    await act(async () => { await refreshSeenList('u-1', p); });
  };
  /** Mount on a device that has NEVER had an answer about this account (no copy, no marker). */
  const openCold = (over: Partial<ProgressionProfile> = {}): void => {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile(over) } });
    ui = mount(<CollectionPage reducedMotion />);
  };

  it('an owned, unseen item wears NEW (and its tab counts it); a pick clears it at once', () => {
    open({ titles: three }, { seen: ['alpha_tester'] });
    expect(freshNames()).toEqual(['Kingbreaker', 'Star Chaser']);
    expect(text('.colls-tab.on .colls-tab-new')).toBe('2');
    expect(text('.colls-plate-name')).toBe('Alpha Tester'); // opening the page never hides a badge before you have looked
    act(() => tile('Kingbreaker').click());
    expect(tile('Kingbreaker').querySelector('.colls-new')).toBeNull();
    expect(text('.colls-tab.on .colls-tab-new')).toBe('1');
    expect(seenList()).toContain('title_kingbreaker');
    expect(freshNames()).toEqual(['Star Chaser']); // the rest of the tab keeps its badges for this visit
    expect(equipTitleRemote).not.toHaveBeenCalled();
    expect(openCrateRemote).not.toHaveBeenCalled();
  });

  // Owner 2026-10-11: "whenever i load the game, all of my stuff that i already own shows up as 'new'".
  it('CLEAR ON VIEW: a tab you have opened shows its badges for that visit, then they are gone the next time', () => {
    open({ titles: three }, { seen: ['alpha_tester'] });
    expect(freshNames()).toEqual(['Kingbreaker', 'Star Chaser']); // still shown: you are looking at them now
    ui!.unmount();
    ui = mount(<CollectionPage reducedMotion />); // the next load: nothing you already saw is NEW again
    expect(freshNames()).toEqual([]);
    expect($('.colls-tab.on .colls-tab-new')).toBeNull();
  });

  it('CLEAR ON VIEW under StrictMode (the dev build re-runs effects): the open tab still keeps its badges for this visit', () => {
    localStorage.setItem('ascent.collection.baseline.u-1', '1');
    localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester']));
    useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester', 'title_star_chaser'] }) } });
    ui = mount(<StrictMode><CollectionPage reducedMotion /></StrictMode>);
    expect(freshNames()).toEqual(['Star Chaser']);
    expect(seenList()).toContain('title_star_chaser'); // stored as seen, for the next visit
  });

  it('CLEAR ON VIEW is per tab: leaving a tab clears it; a tab you never opened keeps its count', () => {
    open({ titles: ['alpha_tester', 'title_star_chaser'], cosmetics: ['alpha_tester', 'title_star_chaser', 'skin_albus_1'] }, { seen: ['alpha_tester'] });
    expect(freshNames()).toEqual(['Star Chaser']);
    expect(text('.colls-tab.on .colls-tab-new')).toBe('1');
    expect(tab('Heroes').querySelector('.colls-tab-new')?.textContent).toBe('1');
    ui!.unmount();
    ui = mount(<CollectionPage reducedMotion />); // Heroes was never opened: its badge survives the reload
    expect(tab('Heroes').querySelector('.colls-tab-new')?.textContent).toBe('1');
    expect(tab('Titles').querySelector('.colls-tab-new')).toBeNull();
    act(() => tab('Heroes').click());
    expect($$('.colls-tile.fresh')).toHaveLength(1); // shown while you look
    act(() => tab('Titles').click());
    expect(tab('Heroes').querySelector('.colls-tab-new')).toBeNull(); // and cleared once you leave
    act(() => tab('Heroes').click());
    expect($$('.colls-tile.fresh')).toHaveLength(0);
  });

  it('the EQUIPPED item never wears NEW, and its tab does not count it', () => {
    open({ titles: three, equippedTitleId: 'title_kingbreaker' }, { seen: ['alpha_tester'] });
    expect(tile('Kingbreaker').querySelector('.colls-new')).toBeNull();
    expect(freshNames()).toEqual(['Star Chaser']);
    expect(text('.colls-tab.on .colls-tab-new')).toBe('1');
  });

  // Owner 2026-10-15: "remove the angry mushy emote", then "remove all emotes as 'given' and put them in various loot
  // tiers between rare and legendary", then "all emotes are crate only except give all players the zen brian emote and
  // show the empty emote slots", then "remove the sad wrangler". The Emotes tab lists the twenty-one, rarest first; only owned
  // ones are bright. A retired emote the player OWNS (Sad Wrangler here) is hidden and left out of the counts.
  it('the Emotes tab: twenty-one emotes, rarest first; Zen Brian owned by everyone; Angry Mushy and an owned Sad Wrangler gone', () => {
    open({ titles: ['alpha_tester'], cosmetics: ['alpha_tester', 'emote_sad_wrangler'] });
    act(() => tab('Emotes').click());
    expect(tileNames()).toHaveLength(21);
    expect(tileNames()).not.toContain('Angry Mushy');
    expect(tileNames()).not.toContain('Sad Wrangler');
    expect(tileNames().slice(0, 3)).toEqual(['Rich Pimm', 'Baby Rubies', 'Mad Tormentor']);
    expect(text('.colls-tab.on .colls-tab-count')).toBe('1/21');
    expect(tile('Zen Brian').className).toMatch(/\bowned\b/);
    expect(tile('Flirty Midas').className).toMatch(/\bmissing\b/);
  });

  it('an emote\x27s detail shows YOUR four menu slots: Zen Brian in slot 1, three visibly EMPTY slots', () => {
    open({ titles: ['alpha_tester'], cosmetics: ['alpha_tester', 'emote_nervous_jensen'] });
    act(() => tab('Emotes').click());
    act(() => tile('Nervous Jensen').click());
    // Owned emotes fill the menu without placing: Zen Brian (the starter), then Nervous Jensen, then two empty slots.
    const slots = (): HTMLElement[] => $$('.colls-emote-slots .emote-pick');
    expect(slots()).toHaveLength(4);
    expect(slots().map((b) => b.classList.contains('emote-slot-empty'))).toEqual([false, false, true, true]);
    expect(slots().map((b) => b.getAttribute('aria-label'))).toEqual(['Put Nervous Jensen in slot 1', 'Nervous Jensen is in slot 2', 'Put Nervous Jensen in slot 3', 'Put Nervous Jensen in slot 4']);
    expect(slots()[2]!.textContent).toBe('3Empty');
    // An emote you do not own: the same row, read-only (no buttons); the empty slots carry the crates hint.
    act(() => tile('Flirty Midas').click());
    expect($$('.colls-emote-slots button')).toHaveLength(0);
    const empty = $$('.colls-emote-slots .emote-slot-empty');
    expect(empty.map((e) => e.getAttribute('aria-label'))).toEqual(['Slot 3 is empty', 'Slot 4 is empty']);
    expect(empty[0]!.getAttribute('data-tip')).toBe('Empty slot. Find more emotes in crates.');
    expect(empty[0]!.hasAttribute('title')).toBe(false);
  });

  // Owner 2026-10-11: "we should also create a button that 'Marks all as seen'. when a player clicks that, all
  // 'new' pills go away."
  it('MARK ALL AS SEEN: one press clears every badge on every tab, and the button leaves with them', () => {
    open({ titles: ['alpha_tester', 'title_star_chaser'], cosmetics: ['alpha_tester', 'title_star_chaser', 'skin_albus_1'] }, { seen: ['alpha_tester'] });
    expect(freshNames()).toEqual(['Star Chaser']);
    expect(tab('Heroes').querySelector('.colls-tab-new')?.textContent).toBe('1');
    act(() => button('Mark all as seen')!.click());
    expect($$('.colls-tile.fresh')).toHaveLength(0); // the open tab: gone now, not on the next visit
    expect($$('.colls-tab-new')).toHaveLength(0); // and every other tab's count
    expect(button('Mark all as seen')).toBeUndefined();
    expect(seenList().sort()).toEqual(['alpha_tester', 'emote_zen_brian', 'skin_albus_1', 'title_star_chaser']); // Zen Brian, the one starter emote, is everyone's (2026-10-15)
    act(() => tab('Heroes').click());
    expect($$('.colls-tile.fresh')).toHaveLength(0);
    ui!.unmount();
    ui = mount(<CollectionPage reducedMotion />); // and it stays that way
    expect($$('.colls-tab-new')).toHaveLength(0);
    expect(button('Mark all as seen')).toBeUndefined();
    clean();
  });

  it('MARK ALL AS SEEN is only offered while something is NEW, and returns with the next find', () => {
    open(); // everything owned has been seen
    expect(button('Mark all as seen')).toBeUndefined();
    act(() => { useProgression.setState({ mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester', 'title_star_chaser', 'title_ironbeard'], revision: 20 }) } }); });
    expect(button('Mark all as seen')).toBeDefined();
  });

  it('peeking at a missing item does not spend its NEW: it still shows the day a crate gives it', () => {
    open({}, { seen: ['alpha_tester', 'title_star_chaser'] });
    act(() => tile('Ironbeard').click());
    expect(seenList()).not.toContain('title_ironbeard');
    act(() => { useProgression.setState({ mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester', 'title_star_chaser', 'title_ironbeard'], revision: 20 }) } }); });
    expect(tile('Ironbeard').querySelector('.colls-new')?.textContent).toBe('New');
  });

  // Owner 2026-10-11: "i want to save the 'seen' on the account level, though".
  describe('the list lives on the ACCOUNT', () => {
    it('a device that has never had an answer shows NO badge (an empty copy is "not asked yet"), and marks nothing', () => {
      openCold({ titles: three });
      expect(freshNames()).toEqual([]);
      expect($$('.colls-tab-new')).toHaveLength(0);
      expect(localStorage.getItem('ascent.collection.seen.u-1')).toBeNull();
      expect(markCosmeticsSeenRemote).not.toHaveBeenCalled();
    });

    it('a new device: the account\'s answer lands, and only what the ACCOUNT has not seen wears NEW', async () => {
      openCold({ titles: three });
      await accountSays(['alpha_tester', 'title_star_chaser']);
      expect(freshNames()).toEqual(['Kingbreaker']); // the open page corrects itself
      // You are looking at the tab: its unseen item is written to the account, once, and only that one.
      expect(markCosmeticsSeenRemote.mock.calls).toEqual([[['title_kingbreaker']]]);
      ui!.unmount();
      ui = mount(<CollectionPage reducedMotion />);
      expect(freshNames()).toEqual([]);
      expect(markCosmeticsSeenRemote).toHaveBeenCalledTimes(1);
    });

    it('an item you looked at on ANOTHER device is not NEW here', async () => {
      open({ titles: three }, { seen: ['alpha_tester'] }); // this device's copy is behind
      expect(freshNames()).toEqual(['Kingbreaker', 'Star Chaser']);
      await accountSays(['alpha_tester', 'title_star_chaser']);
      expect(freshNames()).toEqual(['Kingbreaker']);
      expect(text('.colls-tab.on .colls-tab-new')).toBe('1');
    });

    it('a pick writes that one item to the account; an item already there is never sent', async () => {
      localStorage.setItem('ascent.collection.baseline.u-1', '1');
      await accountSays(['alpha_tester']);
      useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester'], cosmetics: ['alpha_tester', 'skin_albus_1'] }) } });
      ui = mount(<CollectionPage reducedMotion />);
      expect(markCosmeticsSeenRemote).not.toHaveBeenCalled(); // Titles holds nothing the account has not seen
      act(() => tab('Heroes').click());
      expect(markCosmeticsSeenRemote.mock.calls).toEqual([[['skin_albus_1']]]);
      act(() => $$('.colls-tile.fresh')[0]!.click());
      expect(markCosmeticsSeenRemote).toHaveBeenCalledTimes(1); // the view already sent it
    });

    it('MARK ALL AS SEEN writes every unseen item to the account in one call, other tabs included', async () => {
      localStorage.setItem('ascent.collection.baseline.u-1', '1');
      await accountSays(['alpha_tester']);
      useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester'], cosmetics: ['alpha_tester', 'skin_albus_1', 'skin_blackbelt_1'] }) } });
      ui = mount(<CollectionPage reducedMotion />);
      expect(markCosmeticsSeenRemote).not.toHaveBeenCalled(); // Titles holds nothing new; the skins are on other tabs
      act(() => button('Mark all as seen')!.click());
      expect(markCosmeticsSeenRemote).toHaveBeenCalledTimes(1);
      expect([...markCosmeticsSeenRemote.mock.calls[0]![0]].sort()).toEqual(['emote_zen_brian', 'skin_albus_1', 'skin_blackbelt_1']); // + Zen Brian, the one starter emote everyone owns (2026-10-15)
      expect($$('.colls-tab-new')).toHaveLength(0);
    });

    it('a write that did not get through is sent again the next time you look', async () => {
      localStorage.setItem('ascent.collection.baseline.u-1', '1');
      await accountSays(['alpha_tester']);
      markCosmeticsSeenRemote.mockResolvedValueOnce(false);
      open({ titles: ['alpha_tester', 'title_star_chaser'] }, { seen: ['alpha_tester'] });
      await settle();
      expect(markCosmeticsSeenRemote.mock.calls).toEqual([[['title_star_chaser']]]);
      act(() => tab('Heroes').click());
      act(() => tab('Titles').click());
      expect(markCosmeticsSeenRemote.mock.calls).toEqual([[['title_star_chaser']], [['title_star_chaser']]]);
      expect(freshNames()).toEqual([]); // seen on this device either way
    });

    it('NO ANSWER (offline, timeout): nothing changes, and no baseline is taken on a guess', async () => {
      openCold({ titles: three, cosmetics: three });
      await accountSays(undefined, profile({ cosmetics: three }));
      expect(freshNames()).toEqual([]);
      expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBeNull();
      expect(localStorage.getItem('ascent.collection.seen.u-1')).toBeNull();
    });

    it('A SERVER FROM BEFORE THE MIGRATION: the list is this device\'s, with a one-time baseline of what you own', async () => {
      const owned = [...three, 'skin_albus_1'];
      openCold({ titles: three, cosmetics: owned });
      await accountSays('unsupported', profile({ cosmetics: owned }));
      expect(seenList().sort()).toEqual([...owned].sort());
      expect($$('.colls-tab-new')).toHaveLength(0);
      expect(freshNames()).toEqual([]);
      // Only what is earned AFTER the baseline is NEW, and nothing is ever sent.
      act(() => { useProgression.setState({ mirror: { userId: 'u-1', ...profile({ titles: [...three, 'title_ironbeard'], cosmetics: [...owned, 'title_ironbeard'], revision: 20 }) } }); });
      expect(freshNames()).toEqual(['Ironbeard']);
      // Taken once: the next read does not swallow the new find. An unreadable ownership list never burns it.
      await accountSays('unsupported', profile({ cosmetics: [...owned, 'title_ironbeard'] }));
      ui!.unmount();
      localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(owned)); // (the view marked Ironbeard; put it back)
      ui = mount(<CollectionPage reducedMotion />);
      expect(freshNames()).toEqual(['Ironbeard']);
      expect(markCosmeticsSeenRemote).not.toHaveBeenCalled();
    });

    it('before the migration, an ownership list that could not be read does not burn the baseline', async () => {
      await accountSays('unsupported', null);
      await accountSays('unsupported', profile({ titles: [] }));
      expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBeNull();
      await accountSays('unsupported', profile({ cosmetics: ['alpha_tester'] }));
      expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBe('1');
      expect(seenList()).toEqual(['alpha_tester']);
    });
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

describe('the Collection screen: the crate sign-in gate (owner 2026-09-29, a hard gate)', () => {
  const guest = (): void => { useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } }); };
  const gateTitle = (): string => text('#crgate-title');

  it('a guest still sees the sealed crates, with a lock on Open and a line saying why', () => {
    guest();
    open();
    expect(text('.colls-bay-sub')).toBe('2 ready. Next: Level 2 Crate');
    expect(text('.colls-bay-guest')).toBe('Create a free account to open them.');
    expect(button('Open')!.querySelector('.colls-lock')).not.toBeNull();
    expect(button('Open')!.getAttribute('aria-label')).toBe('Open (needs an account)');
    clean();
  });

  it('a guest pressing Open (or Open all) gets the gate, and nothing opens', async () => {
    guest();
    open();
    act(() => button('Open')!.click());
    await settle();
    expect(gateTitle()).toBe('Create an account to open crates');
    expect(text('.crgate-lead')).toBe('Your crates, level and collection are saved to your account.');
    expect(text('.crgate-body .nrw-note')).toBe('It is free and takes a minute. You only need an email.');
    expect(text('.crgate-warn')).toBe('Already have an account? Signing in switches to it. Crates earned as a guest stay on this guest.');
    expect($('.crth')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
    clean();
    act(() => button('Not now')!.click());
    expect($('.crgate-panel')).toBeNull();
    act(() => button('Open all (2)')!.click());
    await settle();
    expect(gateTitle()).toBe('Create an account to open crates');
    expect($('.crth')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
  });

  it('Create account closes the gate and opens the account panel; Esc closes it too', () => {
    guest();
    open();
    act(() => button('Open')!.click());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect($('.crgate-panel')).toBeNull();
    expect(useGame.getState().accountPanelOpen).toBe(false);
    act(() => button('Open')!.click());
    act(() => document.querySelector<HTMLButtonElement>('.crgate-foot .cv2-btn')!.click());
    expect($('.crgate-panel')).toBeNull();
    expect(useGame.getState().accountPanelOpen).toBe(true);
  });

  it('once the account is created (anonymous flips false) the open gate closes and Open goes straight through, no reload', async () => {
    guest();
    open();
    act(() => button('Open')!.click());
    expect($('.crgate-panel')).not.toBeNull();
    act(() => { useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } }); });
    expect($('.crgate-panel')).toBeNull();
    expect($('.colls-bay-guest')).toBeNull();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_hearthkeeper', 2, 1), profile: profile() });
    act(() => button('Open')!.click());
    await settle();
    expect($('.crgate-panel')).toBeNull();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
  });

  it('a signed-in player never sees the gate', async () => {
    open();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_hearthkeeper', 2, 1), profile: profile() });
    expect($('.colls-bay-guest')).toBeNull();
    expect(button('Open')!.querySelector('.colls-lock')).toBeNull();
    act(() => button('Open')!.click());
    await settle();
    expect($('.crgate-panel')).toBeNull();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
  });

  it('no account backend: the gate says accounts are unavailable instead of opening a panel that cannot work', () => {
    backend.on = false;
    guest();
    open();
    act(() => button('Open')!.click());
    expect(gateTitle()).toBe('Accounts are unavailable');
    expect(text('.crgate-lead')).toBe('You need an account to open crates, and accounts cannot be reached right now.');
    expect($('.crgate-foot')!.textContent).toBe('OK');
    act(() => button('OK')!.click());
    expect($('.crgate-panel')).toBeNull();
    expect(useGame.getState().accountPanelOpen).toBe(false);
    expect(openCrateRemote).not.toHaveBeenCalled();
    clean();
  });
});

describe('the Collection screen: Aether and the Crate Shop (2026-10-18)', () => {
  const milestone: CrateRow = { crateId: 'c-m10', earnedLevel: null, state: 'sealed', rewardId: null, earnedAt: null, openedAt: null, source: 'milestone:10', floor: 'legendary' };
  const shopBuy = (): HTMLButtonElement => $('.colls-shop:not(.milestone) .colls-shop-buy') as HTMLButtonElement;
  const milestoneOpen = (): HTMLButtonElement => $('.colls-shop.milestone .colls-shop-buy') as HTMLButtonElement;
  const back = (): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('.colls-shop.milestone button')].find((b) => b.textContent?.trim() === 'Back');
  const bought = (crateId: string, rewardId: string): BuyCrateResult => ({
    status: 'opened', rewardId, sealedRemaining: 0, aether: 1100,
    crate: { crateId, earnedLevel: null, state: 'opened', rewardId, earnedAt: 't0', openedAt: 't1', source: `shop:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, floor: 'common' },
    quote: { tier: 'standard', floor: 'common', focus: null, crate: 100, fee: 0, total: 100, remaining: 50 },
  });

  it('wallet chip shows the balance', () => {
    open({ aether: 1200 }, { aether: true });
    expect(text('[aria-label="Aether balance"]')).toBe('◆ 1200 Aether');
    act(() => { useProgression.setState({ mirror: { userId: 'u-1', ...profile({ aether: 900, revision: 10 }) } }); });
    expect(text('[aria-label="Aether balance"]')).toBe('◆ 900 Aether');
    clean();
  });

  it('the shop mounts when Aether is on: a purchase plays in the theatre, and the wallet takes the new balance', async () => {
    open({ aether: 1200 }, { aether: true });
    expect($('.colls-shop[aria-label="Crate Shop"]')).not.toBeNull();
    expect($('.colls-bay')).not.toBeNull(); // beside the bay, not instead of it
    const result = bought('c-shop', 'title_hearthkeeper');
    buyCrateRemote.mockResolvedValue({ status: 'ok', value: result, profile: profile({ aether: 1100, revision: 10, titles: ['alpha_tester', 'title_star_chaser', 'title_hearthkeeper'] }) });
    act(() => shopBuy().click());
    await settle();
    expect(buyCrateRemote).toHaveBeenCalledWith(expect.objectContaining({ tier: 'standard', focus: null, expectedTotal: 100 }));
    expect($('.crth')).not.toBeNull();
    expect(text('.crate-reward-name')).toBe('Hearthkeeper');
    expect(openCrateRemote).not.toHaveBeenCalled(); // the theatre plays the purchase it already has
    expect(text('[aria-label="Aether balance"]')).toBe('◆ 1100 Aether');
    act(() => button('Done')!.click());
    expect($('.crth')).toBeNull();
    clean();
  });

  it("a milestone crate's Open shows the focus step", async () => {
    open({ aether: 1200 }, { aether: true, crates: [milestone] });
    expect(text('.colls-bay-sub')).toBe('1 ready. Next: Level 10 Legendary Crate');
    act(() => button('Open')!.click());
    expect($('.colls-shop.milestone')).not.toBeNull();
    expect($('.colls-bay')).toBeNull(); // the bay panel swapped for the focus step
    expect($('.crth')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
    expect(text('.colls-shop.milestone .colls-shop-name')).toBe('Level 10 Legendary Crate');
    // Back puts the bay back.
    act(() => back()!.click());
    expect($('.colls-shop.milestone')).toBeNull();
    expect($('.colls-bay')).not.toBeNull();
    // Open (free, unfocused) hands the theatre this one crate and swaps the focus step out in the same update.
    act(() => button('Open')!.click());
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-m10', 'title_hearthkeeper', 2, 0), profile: profile({ revision: 10 }) });
    act(() => milestoneOpen().click());
    expect($('.colls-shop.milestone')).toBeNull();
    await settle();
    expect(openCrateRemote).toHaveBeenCalledTimes(1);
    expect(openCrateRemote).toHaveBeenCalledWith('c-m10');
    expect($('.crth')).not.toBeNull();
    clean();
  });

  it('a level crate ahead of a milestone crate: the bay\'s Open stops BEFORE the milestone, so "Open next" never opens it unfocused', async () => {
    // fetchOwnCrates sorts by earned_level, nulls last: a pre-Aether sealed level crate comes before a backdated milestone.
    open({ aether: 1200 }, { aether: true, crates: [crateList[1]!, milestone] });
    expect(text('.colls-bay-sub')).toBe('2 ready. Next: Level 2 Crate');
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_hearthkeeper', 2, 1), profile: profile({ revision: 10 }) });
    act(() => button('Open')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
    expect($('.colls-shop.milestone')).toBeNull();
    // The theatre held only the level crate: nothing to open next, and the milestone crate was never asked for.
    expect([...document.querySelectorAll<HTMLButtonElement>('.crth button')].some((b) => b.textContent?.startsWith('Open next'))).toBe(false);
    expect(openCrateRemote.mock.calls.map((c) => c[0])).not.toContain('c-m10');
    act(() => button('Done')!.click());
    // The level crate is opened now: the next Open reaches the milestone crate's focus step.
    expect(text('.colls-bay-sub')).toBe('1 ready. Next: Level 10 Legendary Crate');
    act(() => button('Open')!.click());
    expect($('.colls-shop.milestone')).not.toBeNull();
    expect(openCrateRemote.mock.calls.map((c) => c[0])).not.toContain('c-m10');
  });

  // RULING 2026-10-19 (revising "a free crate opened in bulk"): every milestone crate is opened one at a time through its
  // focus step; Open all skips them.
  it('Open all on [milestone, level] opens only the level crate; the milestone crate stays sealed for its focus step', async () => {
    open({ aether: 1200 }, { aether: true, crates: [milestone, { ...crateList[1]! }] });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_wanderer', 2, 1), profile: profile({ revision: 10 }) });
    act(() => button('Open all (1)')!.click());
    await settle();
    expect($('.colls-shop.milestone')).toBeNull();
    expect($('.crth')).not.toBeNull();
    expect(openCrateRemote.mock.calls.map((c) => c[0])).toEqual(['c-2']);
    expect([...document.querySelectorAll<HTMLButtonElement>('.crth button')].some((b) => b.textContent?.startsWith('Open next'))).toBe(false);
  });

  it('Open all on [level, milestone] opens only the level crate', async () => {
    open({ aether: 1200 }, { aether: true, crates: [crateList[1]!, milestone] });
    expect(button('Open all (2)')).toBeUndefined();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_wanderer', 2, 1), profile: profile({ revision: 10 }) });
    act(() => button('Open all (1)')!.click());
    await settle();
    expect(openCrateRemote.mock.calls.map((c) => c[0])).toEqual(['c-2']);
    act(() => button('Done')!.click());
    // The milestone crate is still sealed, and the next Open is its focus step.
    expect(text('.colls-bay-sub')).toBe('1 ready. Next: Level 10 Legendary Crate');
    act(() => button('Open')!.click());
    expect($('.colls-shop.milestone')).not.toBeNull();
    expect(openCrateRemote.mock.calls.map((c) => c[0])).not.toContain('c-m10');
  });

  it("the New rewards pop-up's Open is the bay's: a milestone crate first gets its focus step", async () => {
    resetNewRewardsForTests();
    queueNewCrate('u-1', milestone);
    open({ aether: 1200 }, { aether: true, crates: [milestone] });
    expect($('.nrw-panel')).not.toBeNull();
    act(() => ($('.nrw-panel .crate-btn') as HTMLButtonElement).click());
    await settle();
    expect($('.nrw-panel')).toBeNull();
    expect($('.colls-shop.milestone')).not.toBeNull();
    expect($('.crth')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
    resetNewRewardsForTests();
  });

  it("the New rewards pop-up's Open all skips milestone crates, and is not offered when every crate is one", async () => {
    resetNewRewardsForTests();
    const m20: CrateRow = { ...milestone, crateId: 'c-m20', source: 'milestone:20' };
    queueNewCrate('u-1', milestone);
    queueNewCrate('u-1', m20);
    open({ aether: 1200 }, { aether: true, crates: [milestone, m20] });
    expect($('.nrw-panel')).not.toBeNull();
    expect([...document.querySelectorAll<HTMLButtonElement>('.nrw-panel button')].some((b) => b.textContent?.startsWith('Open all'))).toBe(false);
    act(() => ($('.nrw-panel .crate-btn') as HTMLButtonElement).click());
    await settle();
    expect($('.colls-shop.milestone')).not.toBeNull(); // the single Open: the first milestone crate's focus step
    expect(openCrateRemote).not.toHaveBeenCalled();
    ui!.unmount();
    // A level crate beside a milestone crate: Open all opens the level crate only.
    resetNewRewardsForTests();
    queueNewCrate('u-1', milestone);
    queueNewCrate('u-1', crateList[1]!);
    open({ aether: 1200 }, { aether: true, crates: [crateList[1]!, milestone] });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_wanderer', 2, 1), profile: profile({ revision: 10 }) });
    const all = [...document.querySelectorAll<HTMLButtonElement>('.nrw-panel button')].find((b) => b.textContent === 'Open all (1)')!;
    act(() => all.click());
    await settle();
    expect(openCrateRemote.mock.calls.map((c) => c[0])).toEqual(['c-2']);
    resetNewRewardsForTests();
  });

  it('every sealed crate a milestone crate: no Open all; the single Open leads to the focus step', async () => {
    open({ aether: 1200 }, { aether: true, crates: [milestone, { ...milestone, crateId: 'c-m20', source: 'milestone:20' }] });
    expect(text('.colls-bay-sub')).toBe('2 ready. Next: Level 10 Legendary Crate');
    expect([...document.querySelectorAll<HTMLButtonElement>('.colls-bay button')].some((b) => b.textContent?.startsWith('Open all'))).toBe(false);
    act(() => button('Open')!.click());
    expect($('.colls-shop.milestone')).not.toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
  });

  it("the bay names the next milestone level, and its odds are the first sealed crate's", () => {
    open({ accountXp: 0, aether: 0 }, { aether: true, crates: [crateList[0]!] });
    expect(text('.colls-bay-sub')).toBe('None right now. Your next crate comes at Level 10.');
    expect(text('.colls-bay-odds')).toBe('Crate odds: Legendary 75%, Ancient 25%'); // the next crate IS a milestone Legendary
    ui!.unmount();
    open({ aether: 0 }, { aether: true, crates: [milestone] });
    expect(text('.colls-bay-odds')).toBe('Crate odds: Legendary 75%, Ancient 25%');
    ui!.unmount();
    open({ aether: 0 }, { aether: true }); // old level crates: no floor, so every rarity at the published odds
    expect(text('.colls-bay-odds')).toBe('Crate odds: Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%');
  });

  it("Aether off renders today's bay", async () => {
    open();
    // Verbatim the bay as it rendered before the Crate Shop (captured from 1f31f5feb).
    expect($('.colls-bay')!.outerHTML).toBe(
      '<section class="colls-panel colls-bay ready" aria-label="Sealed crates"><div class="colls-bay-art" aria-hidden="true"><span class="colls-hero-glow"></span><span class="colls-crate"></span><span class="colls-hero-count">2</span></div><div class="colls-bay-body"><div class="colls-bay-head">Sealed crates</div><div class="colls-bay-sub"><b>2</b> ready. Next: Level 2 Crate</div><div class="colls-bay-actions"><button type="button" class="cv2-btn pressable colls-open">Open</button><button type="button" class="colls-quiet pressable quiet">Open all (2)</button></div><div class="colls-bay-odds">Crate odds: Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%</div></div></section>',
    );
    expect(text('.colls-bay')).toBe('2Sealed crates2 ready. Next: Level 2 CrateOpenOpen all (2)Crate odds: Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%');
    expect($('[aria-label="Aether balance"]')).toBeNull();
    expect($('.colls-shop')).toBeNull();
    ui!.unmount();
    // A milestone crate with Aether off opens straight into the theatre, unfocused; the next crate is the next level.
    open({ accountXp: 0 }, { crates: [crateList[0]!] });
    expect(text('.colls-bay-sub')).toBe('None right now. Your next crate comes at Level 2.');
    ui!.unmount();
    open({}, { crates: [milestone] });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-m10', 'title_hearthkeeper', 2, 0), profile: profile({ revision: 10 }) });
    act(() => button('Open')!.click());
    await settle();
    expect($('.colls-shop')).toBeNull();
    expect(openCrateRemote).toHaveBeenCalledWith('c-m10');
    expect($('.crth')).not.toBeNull();
  });

  it("a purchase in flight holds the milestone panel's Back and Open (nothing can pull the shop away or start a second theatre)", async () => {
    open({ aether: 1200 }, { aether: true, crates: [milestone] });
    let answer!: (o: unknown) => void;
    buyCrateRemote.mockImplementation(() => new Promise((r) => { answer = r; }));
    act(() => button('Open')!.click());
    expect(back()!.disabled).toBe(false);
    act(() => shopBuy().click());
    expect(text('.colls-shop:not(.milestone) .colls-shop-buy')).toBe('Buying…');
    expect(back()!.disabled).toBe(true);
    expect(milestoneOpen().disabled).toBe(true);
    act(() => back()!.click());
    act(() => milestoneOpen().click());
    expect($('.colls-shop.milestone')).not.toBeNull();
    expect($('.crth')).toBeNull();
    await act(async () => { answer({ status: 'ok', value: bought('c-shop', 'title_hearthkeeper'), profile: profile({ aether: 1100, revision: 10 }) }); await Promise.resolve(); });
    await settle();
    expect($('.crth')).not.toBeNull(); // the charged player gets the reveal
    expect(openCrateRemote).not.toHaveBeenCalled();
    act(() => button('Done')!.click());
    expect(back()!.disabled).toBe(false);
    expect(milestoneOpen().disabled).toBe(false);
  });

  it("a purchase in flight holds the bay's Open and Open all (a second theatre would replace the reveal)", async () => {
    open({ aether: 1200 }, { aether: true });
    buyCrateRemote.mockImplementation(() => new Promise(() => {}));
    act(() => shopBuy().click());
    expect(button('Open')!.disabled).toBe(true);
    expect(button('Open all (2)')!.disabled).toBe(true);
    act(() => button('Open')!.click());
    await settle();
    expect($('.crth')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
  });

  it("a guest's Buy opens the sign-in gate and never reaches the server", async () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    open({ aether: 0 }, { aether: true });
    expect(text('[aria-label="Aether balance"]')).toBe('◆ 0 Aether'); // a guest earns and sees Aether
    act(() => shopBuy().click());
    await settle();
    expect($('.crgate-panel')).not.toBeNull();
    expect(buyCrateRemote).not.toHaveBeenCalled();
    expect($('.crth')).toBeNull();
  });

  it("a guest's Open on a milestone crate is the sign-in gate, never the focus step", async () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    open({ aether: 0 }, { aether: true, crates: [milestone] });
    act(() => button('Open')!.click());
    await settle();
    expect($('.crgate-panel')).not.toBeNull();
    expect($('.colls-shop.milestone')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
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
  // UI refinement WS-6 (2026-10-16), superseding the 2026-09-28 "blur unowned titles": an unowned title is DIMMED but readable, never blurred.
  it('an unowned title name is dimmed, never blurred, on the tile, the detail nameplate and the preview', () => {
    for (const sel of ['.colls-tile.missing .colls-tile-name', '.colls-detail.missing .colls-plate-name', '.colls-detail.missing .colls-preview-title']) {
      const rule = css.match(new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule, sel).not.toBe('');
      expect(rule, sel).not.toMatch(/blur\(/);
    }
    expect(css).not.toMatch(/transition:[^;]*filter/);
  });
});
