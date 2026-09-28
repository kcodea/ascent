// @vitest-environment jsdom
/**
 * LEVEL CRATES + THE COLLECTION (2026-09-28), rendered under jsdom with the network seam mocked: the post-game
 * "Crate earned" row and its OPTIONAL Open button, the reveal (reduced motion and the animated shake), several
 * crates in a row, pool_exhausted keeping the crate sealed, a failed open, the guest save prompt, the feature
 * flag hiding everything, and the Collection (sealed crates, owned titles, equip through the server). No native
 * tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { OpenCrateResult, ProgressionProfile, ProgressionResult } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';

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

import { ProgressionPostgame } from './ProgressionPostgame';
import { CollectionPanel } from './CollectionPanel';
import { CrateOpener } from './CrateOpener';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { useGame } from '../store';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });
beforeEach(() => {
  resetProgressionForTests();
  openCrateRemote.mockReset();
  equipTitleRemote.mockReset();
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, accountPanelOpen: false });
});

const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'], ...over });
const result = (over: Partial<ProgressionResult> = {}): ProgressionResult => ({
  runId: 'run-1', mode: 'ranked', rulesVersion: 1, placement: 6, comeback: false,
  xp: { base: 100, topFour: 0, firstPlace: 0, comeback: 0, total: 100 },
  before: { lifetimeXp: 225, level: 1 }, after: { lifetimeXp: 325, level: 2 }, unlockedTitles: [], cratesAwarded: 1, crateIds: ['c-2'],
  revisionAfter: 8, settledAt: new Date().toISOString(), ...over,
});
const opened = (crateId: string, rewardId: string, earnedLevel = 2, sealedRemaining = 0): OpenCrateResult => ({
  status: 'opened', rewardId, sealedRemaining, crate: { crateId, earnedLevel, state: 'opened', rewardId, earnedAt: 't0', openedAt: 't1' },
});
function setup(r: ProgressionResult, crates: 'on' | 'off' = 'on'): void {
  useProgression.setState({
    capability: 'on', cratesCapability: crates, crateList: null,
    mirror: { userId: 'u-1', ...profile() },
    current: { localKey: '42', mode: 'ranked', runId: 'run-1', state: 'confirmed', result: r, deduped: false, error: null },
  });
}
const $ = (sel: string): HTMLElement | null => ui!.container.querySelector<HTMLElement>(sel);
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (): HTMLButtonElement[] => [...ui!.container.querySelectorAll<HTMLButtonElement>('button')];
const button = (label: string): HTMLButtonElement | undefined => buttons().find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('the post-game crate', () => {
  it('a level-up shows "Crate earned" with an optional Open button; nothing is opened until it is pressed', () => {
    setup(result());
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect(text('.acctxp-crates-head')).toBe('Crate earned');
    expect(text('.acctxp-crates-sub')).toBe('Open now, or later from your Career.');
    expect(button('Open')).toBeTruthy();
    expect(openCrateRemote).not.toHaveBeenCalled();
    expect(ui.container.querySelector('[title]')).toBeNull();
    expect(ui.container.textContent).not.toMatch(/[—–]/);
  });

  it('Open reveals the reward chosen by the server (name, rarity) and adopts the returned profile', async () => {
    setup(result());
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_stormcaller'), profile: profile({ titles: ['alpha_tester', 'title_stormcaller'], revision: 10 }) });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
    expect(text('.crate-reward-kind')).toBe('New title');
    expect(text('.crate-reward-name')).toBe('Stormcaller');
    expect(text('.crate-reward-rarity')).toBe('Rare');
    expect($('.crate-reward')!.className).toContain('r-rare');
    expect(useProgression.getState().mirror!.titles).toEqual(['alpha_tester', 'title_stormcaller']);
    expect(useProgression.getState().crateList!.map((c) => [c.crateId, c.state])).toEqual([['c-2', 'opened']]);
    expect(button('Open next')).toBeUndefined();
  });

  it('several crates: "2 crates earned", then "Open next" after the first reveal', async () => {
    setup(result({ before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 250, level: 2 }, cratesAwarded: 2, crateIds: ['c-1', 'c-2'], mode: 'tutorial', runId: 'learn-ascent:v1' }));
    useProgression.setState({ current: { ...useProgression.getState().current!, mode: 'tutorial', runId: 'learn-ascent:v1' } });
    openCrateRemote.mockResolvedValueOnce({ status: 'ok', value: opened('c-1', 'title_wanderer', 1, 1), profile: profile() });
    openCrateRemote.mockResolvedValueOnce({ status: 'ok', value: opened('c-2', 'title_the_unbroken', 2, 0), profile: profile() });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect(text('.acctxp-crates-head')).toBe('2 crates earned');
    act(() => button('Open')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenLastCalledWith('c-1');
    expect(text('.crate-name')).toBe('Welcome Crate');
    expect(text('.crate-reward-name')).toBe('Wanderer');
    act(() => button('Open next')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenLastCalledWith('c-2');
    expect(text('.crate-name')).toBe('Level 2 Crate');
    expect(text('.crate-reward-name')).toBe('The Unbroken');
    expect(text('.crate-reward-rarity')).toBe('Legendary');
    expect(button('Open next')).toBeUndefined();
  });

  it('pool exhausted: said plainly, the crate stays sealed, no reward shown', async () => {
    setup(result());
    openCrateRemote.mockResolvedValue({ status: 'ok', profile: profile(), value: { status: 'pool_exhausted', rewardId: null, sealedRemaining: 1, crate: { crateId: 'c-2', earnedLevel: 2, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null } } });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-note')).toBe('You own every reward for now. This crate stays sealed until new rewards arrive.');
    expect($('.crate-reward')).toBeNull();
    expect(useProgression.getState().crateList!.map((c) => c.state)).toEqual(['sealed']);
  });

  it('a failed open says so and offers Try again', async () => {
    setup(result());
    openCrateRemote.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    openCrateRemote.mockResolvedValueOnce({ status: 'ok', value: opened('c-2', 'title_ironbeard'), profile: profile() });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-note')).toBe('Could not open the crate. Try again.');
    act(() => button('Try again')!.click());
    await settle();
    expect(text('.crate-reward-name')).toBe('Ironbeard');
  });

  it('hidden while the crates switch is off, and when the game created no crate', () => {
    setup(result(), 'off');
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
    expect($('.acctxp')).not.toBeNull(); // the XP panel itself still shows
    ui.unmount();
    setup(result({ cratesAwarded: 0, crateIds: [], after: { lifetimeXp: 325, level: 1 } }));
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
  });

  it('a crate already opened elsewhere is not offered again', () => {
    setup(result());
    useProgression.setState({ crateList: [{ crateId: 'c-2', earnedLevel: 2, state: 'opened', rewardId: 'title_wanderer', earnedAt: null, openedAt: null }] });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
  });

  it('a guest who earns a crate gets the same save prompt', () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    setup(result({ before: { lifetimeXp: 300, level: 2 }, after: { lifetimeXp: 510, level: 3 }, crateIds: ['c-3'] }));
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect(text('.acctxp-save-head')).toBe('Save your progress');
  });
});

describe('the reveal motion', () => {
  it('animated: the crate shakes while opening (at least the minimum), then the lid comes off and the reward pops in', async () => {
    vi.useFakeTimers();
    useProgression.setState({ capability: 'on', cratesCapability: 'on', mirror: { userId: 'u-1', ...profile() } });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_kingbreaker', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion={false} minShakeMs={500} />);
    expect($('.crate-box')!.className).not.toContain('shaking');
    act(() => button('Open')!.click());
    await settle();
    expect($('.crate-box')!.className).toContain('shaking');
    expect($('.crate-reward')).toBeNull();
    act(() => { vi.advanceTimersByTime(520); });
    expect($('.crate-box')!.className).toContain('open');
    expect($('.crate-box')!.className).not.toContain('shaking');
    expect(text('.crate-reward-name')).toBe('Kingbreaker');
    expect($('.crate-burst')).not.toBeNull();
    expect($('.crate')!.className).not.toContain('reduced');
  });

  it('reduced motion: no hold, marked reduced (no float, shake or burst in CSS)', async () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', mirror: { userId: 'u-1', ...profile() } });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_kingbreaker', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion />);
    expect($('.crate')!.className).toContain('reduced');
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-reward-name')).toBe('Kingbreaker');
  });
});

describe('the Collection', () => {
  const crateList = [
    { crateId: 'c-1', earnedLevel: 1, state: 'opened' as const, rewardId: 'title_star_chaser', earnedAt: null, openedAt: null },
    { crateId: 'c-2', earnedLevel: 2, state: 'sealed' as const, rewardId: null, earnedAt: null, openedAt: null },
    { crateId: 'c-3', earnedLevel: 3, state: 'sealed' as const, rewardId: null, earnedAt: null, openedAt: null },
  ];
  function open(over: Partial<ProgressionProfile> = {}): ReturnType<typeof vi.fn> {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList, mirror: { userId: 'u-1', ...profile({ titles: ['alpha_tester', 'title_star_chaser'], ...over }) } });
    const onClose = vi.fn();
    ui = mount(<CollectionPanel onClose={onClose} reducedMotion />);
    return onClose;
  }

  it('lists sealed crates (count + the oldest ready to open) and owned titles with rarity and the equipped one marked', () => {
    open();
    expect(text('.coll-sec[aria-label="Crates"] .coll-count')).toBe('2 sealed');
    expect(text('.crate-name')).toBe('Level 2 Crate');
    expect(text('.coll-sec[aria-label="Titles"] .coll-count')).toBe('2 of 16 found');
    const rows = [...ui!.container.querySelectorAll('.coll-titlerow')].map((r) => [r.querySelector('.coll-titlename')!.textContent, r.querySelector('.coll-rarity')!.textContent, r.querySelector('button')!.textContent]);
    expect(rows).toEqual([['Alpha Tester', 'Rare', 'Equipped'], ['Star Chaser', 'Rare', 'Equip']]);
    expect(ui!.container.querySelector('[title]')).toBeNull();
    expect(ui!.container.textContent).not.toMatch(/[—–]/);
  });

  it('Equip goes through the server, and the returned profile moves the equipped marker', async () => {
    open();
    equipTitleRemote.mockResolvedValue({ status: 'ok', value: null, profile: profile({ equippedTitleId: 'title_star_chaser', titles: ['alpha_tester', 'title_star_chaser'], revision: 12 }) });
    act(() => button('Equip')!.click());
    await settle();
    expect(equipTitleRemote).toHaveBeenCalledWith('title_star_chaser');
    expect(useProgression.getState().mirror!.equippedTitleId).toBe('title_star_chaser');
    expect(text('.coll-titlerow.worn .coll-titlename')).toBe('Star Chaser');
  });

  it('a refused equip leaves the title as it was and says so', async () => {
    open();
    equipTitleRemote.mockResolvedValue({ status: 'error', reason: 'not_owned' });
    act(() => button('Equip')!.click());
    await settle();
    expect(text('.coll-error')).toBe('Could not change your title. Try again.');
    expect(useProgression.getState().mirror!.equippedTitleId).toBe('alpha_tester');
  });

  it('opening the LAST sealed crate keeps its reveal on show; then no crate is offered', async () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [crateList[1]!], mirror: { userId: 'u-1', ...profile() } });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_hearthkeeper'), profile: profile({ titles: ['alpha_tester', 'title_hearthkeeper'] }) });
    ui = mount(<CollectionPanel onClose={() => {}} reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-reward-name')).toBe('Hearthkeeper');
    expect(text('.coll-sec[aria-label="Crates"] .coll-count')).toBe('0 sealed');
    expect(button('Open next')).toBeUndefined();
    expect([...ui!.container.querySelectorAll('.coll-titlename')].map((n) => n.textContent)).toEqual(['Alpha Tester', 'Hearthkeeper']);
  });

  it('Escape and the close button dismiss it; a guest sees the save reminder', () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    const onClose = open();
    expect(text('.coll-save span')).toBe('Playing as a guest. Create an account to keep your crates and titles.');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => ui!.container.querySelector<HTMLButtonElement>('.coll-close')!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
